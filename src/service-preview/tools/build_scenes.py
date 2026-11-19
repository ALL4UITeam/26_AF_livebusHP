"""
서비스 시연 장면 데이터 만들기 (개발용, 런타임에는 쓰지 않음)
설정: ../scenes.config.json   원본: ../assets/source/*.png (2048×2048)

장면마다
  1) clean   : 웹 요소로 바꿀 영역(로고·지명·핀·안내 화면 글자 등)을 지움
  2) layers  : 움직일 물체(버스)를 다각형으로 잘라 별도 점 그룹으로 만들고, 그 자리 배경은 주변으로 메움(inpaint)
  3) 크기     : 검은 여백이 아니라 피사체 면적 기준으로 배율을 정해 장면 간 시각적 크기를 맞춤
  4) 질감     : 첫 장면(LIVEBUS)을 기준으로 — 넓은 면보다 모서리·윤곽에 점을 모으고(가장자리 가중),
               점 밝기 분포를 LIVEBUS 에 맞추고(분위 맞춤), 색을 공통 청색 팔레트 쪽으로 당김
  5) synth   : 지운 핀 아래 끊긴 노선 등은 점으로 다시 그림
결과: ../data/<scene>.bin  [u16 x*32][u16 y*32][u8 rgb×3][u8 tag][u8 group]  (필드별로 이어 붙임)
     ../data/<scene>.jpg  배경 빛 번짐 (움직이는 물체 제외)
     ../data/scenes.json  장면별 개수·이미지→무대 변환
실행: cd src/service-preview && python3 tools/build_scenes.py   (numpy, Pillow, opencv-python, scipy)
"""
import json, os
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFilter
from scipy.ndimage import gaussian_filter, sobel

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CONF = json.load(open(os.path.join(ROOT, 'scenes.config.json'), encoding='utf-8'))
SRC = os.path.join(ROOT, 'assets', 'source')
OUT = os.path.join(ROOT, 'data')
STAGE_W, STAGE_H = 1600, 900
BOX = dict(cx=900, cy=470, w=980, h=540)
TARGET_AREA = 490000   # 피사체 면적(무대 px²) 목표 — LIVEBUS 기준
MAX_W, MAX_H = 1250, 760
COUNT = 30000
LAYER_PAD = 4  # 분리한 버스 다각형을 원본 px 만큼 넓힘
EDGE = {'libus-1': 0.0}  # 가장자리 가중 (기준 장면은 0, 나머지 0.8)
TINT = {'libus-1': 0.45}  # 공통 팔레트 쪽으로 당기는 정도 (나머지 0.7)
TAG_NAMES = {0: 'base', 1: 'route', 2: 'bus', 3: 'light', 4: 'screen', 5: 'network', 6: 'pole', 7: 'base-ring', 8: 'solar', 9: 'small-stop', 10: 'small-bus', 11: 'shelter'}


def shape_mask(shape, size):
    m = Image.new('L', size, 0)
    d = ImageDraw.Draw(m)
    kind, a = shape
    if kind == 'rect':
        d.rectangle(a, fill=255)
    elif kind == 'ell':
        x, y, rx, ry = a
        d.ellipse((x - rx, y - ry, x + rx, y + ry), fill=255)
    elif kind == 'poly':
        d.polygon([tuple(p) for p in a], fill=255)
    return np.asarray(m) > 0


def catmull(P, step=1.0):
    """기준점들을 지나는 매끄러운 곡선 (균등 Catmull-Rom), step px 간격으로 촘촘히"""
    P = np.asarray(P, float); P = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        n = max(2, int(np.hypot(*(p2 - p1)) / step))
        t = np.linspace(0, 1, n, endpoint=False)[:, None]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t ** 2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(P[-2][None]); return np.vstack(out)


def resample(C, ds):
    """곡선을 실제 길이 기준 ds 간격으로 다시 나눔 (곡선·정류장 주변에서도 간격 일정)"""
    L = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(C, axis=0).T))])
    u = np.arange(0, L[-1], ds)
    return np.stack([np.interp(u, L, C[:, 0]), np.interp(u, L, C[:, 1])], 1)


def trace_route(lum, R):
    """노선 중심선 찾기: 기준 곡선의 법선 방향으로 밝은 노선 픽셀의 무게중심을 구해 곡선을 원본 노선에 맞춤 → 매끄럽게"""
    G = resample(catmull(R['guide']), 2.0)
    T = np.gradient(G, axis=0); T /= np.hypot(*T.T)[:, None] + 1e-9; Nn = np.stack([-T[:, 1], T[:, 0]], 1)
    band = R.get('band', 22); H, W = lum.shape
    t = np.arange(-band, band + 1, 0.5)
    off = np.full(len(G), np.nan)
    st = np.array(R.get('stations', []), float).reshape(-1, 2)
    for i, (g, nv) in enumerate(zip(G, Nn)):
        if len(st) and np.min(np.hypot(*(st - g).T)) < 22: continue  # 정류장 원 안은 원 테두리 때문에 건너뜀 (앞뒤로 보간)
        if any(x0 <= g[0] <= x1 and y0 <= g[1] <= y1 for x0, y0, x1, y1 in R.get('skip', [])): continue  # 지운 핀 자리 등은 건너뜀
        q = g + t[:, None] * nv
        xi, yi = np.clip(q[:, 0].round().astype(int), 0, W - 1), np.clip(q[:, 1].round().astype(int), 0, H - 1)
        w = np.clip(lum[yi, xi] - R.get('thr', 0.45), 0, None) ** 2
        if w.sum() > 0.05: off[i] = (w * t).sum() / w.sum()
    ok = ~np.isnan(off); off = np.interp(np.arange(len(G)), np.nonzero(ok)[0], off[ok])
    off = gaussian_filter(off, 6, mode='nearest')
    return G + Nn * off[:, None]


def find_rings(lum, stations):
    """정류장 원: 기준점 주변 밝은 테두리 픽셀로 중심·반지름을 잼"""
    out = []
    for x, y in stations:
        ys, xs = np.mgrid[int(y) - 24:int(y) + 25, int(x) - 24:int(x) + 25]
        v = lum[ys, xs]; m = v > 0.75
        cx, cy = (xs[m] * v[m]).sum() / v[m].sum(), (ys[m] * v[m]).sum() / v[m].sum()
        d = np.hypot(xs - cx, ys - cy); mm = m & (d < 22) & (d > 3)
        r = float(np.median(d[mm])) if mm.sum() > 8 else 9.0
        out.append((float(cx), float(cy), r))
    return out


def palette(l):
    r = 0.04 + 0.62 * l ** 2.4
    g = 0.30 + 0.62 * l ** 1.1
    b = np.ones_like(l)
    return np.stack([r, g, b], -1) * l[..., None]


def layer_polys(name, c):
    if name == 'bms-2':
        polys = c.get('busPolys') or [c['busTemplate']] * len(c['busAnchors'])  # 버스마다 실제 윤곽에 맞춘 다각형 (차체 기준 상대 좌표)
        return [dict(name=f'bus{i}', tag=2, poly=(np.array(t, float) + a).tolist(), lights=[]) for i, (t, a) in enumerate(zip(polys, c['busAnchors']))]
    return c.get('layers', [])


def sample(weight, n, rng):
    flat = weight.ravel()
    idx = np.nonzero(flat > 0)[0]
    if len(idx) == 0 or n <= 0:
        return np.zeros(0, int)
    p = flat[idx] / flat[idx].sum()
    return rng.choice(idx, size=min(n, len(idx)), replace=False, p=p)


REF = {}  # LIVEBUS 점 밝기 분포 (분위 맞춤 기준)


def build(name, rng):
    c = CONF['scenes'][name]
    im = Image.open(os.path.join(SRC, name + '.png')).convert('RGB')
    a = np.asarray(im).astype(np.float32) / 255
    H, W = a.shape[:2]
    for sh in c.get('clean', []):  # 웹/점 글자로 바꿀 화면 안쪽: 비움
        a[shape_mask(sh, (W, H))] = 0
    if c.get('heal'):  # 지운 핀·지명 자리: 비우지 않고 주변 지도·도로 무늬로 메움 (검은 구멍이 생기지 않게)
        hm = np.zeros((H, W), bool)
        for sh in c['heal']:
            hm |= shape_mask(sh, (W, H))
        u8 = np.clip(a * 255, 0, 255).astype(np.uint8)
        a = np.where(hm[..., None], cv2.inpaint(u8, hm.astype(np.uint8) * 255, 6, cv2.INPAINT_TELEA).astype(np.float32) / 255 * 0.35, a)
    lum0 = a.max(2)  # 피사체 크기·위치는 노선·지도를 다시 그리기 전 원본 기준 (배율이 바뀌지 않게)
    # 지도 배경 도로(mapGrid): 끊긴 점선 조각을 직선으로 찾아(Hough) 같은 방향·위치끼리 합치고, 원본 조각은 지운 뒤 아래에서 가늘고 어두운 연속선으로 다시 그림
    grid_lines = []
    if c.get('mapGrid'):
        Gc = c['mapGrid']; X0, Y0, X1, Y1 = Gc['rect']
        lum_g = a.max(2); mk = np.zeros((H, W), np.uint8); mk[Y0:Y1, X0:X1] = (lum_g[Y0:Y1, X0:X1] > Gc.get('thr', 0.35))
        for X0_, Y0_, X1_, Y1_ in Gc.get('ignore', []): mk[Y0_:Y1_, X0_:X1_] = 0
        for R in c.get('routes', []): cv2.polylines(mk, [np.array(R['guide'], np.int32)], False, 0, thickness=40)
        L = cv2.HoughLinesP(cv2.dilate(mk, np.ones((3, 3), np.uint8)), 1, np.pi / 360, threshold=Gc.get('votes', 18), minLineLength=Gc.get('minLen', 70), maxLineGap=Gc.get('maxGap', 34))
        L = [] if L is None else L.reshape(-1, 4).astype(float)
        groups = []  # (각도, 법선 거리) 가 비슷한 선분끼리 하나로
        if len(L) and Gc.get('dirs'):  # 지도 격자의 주 방향(가장 긴 선들의 각도 2~3개)과 맞지 않는 선은 버림 → 엇갈린 가짜 선 제거
            ang = np.degrees(np.arctan2(L[:, 3] - L[:, 1], L[:, 2] - L[:, 0])) % 180; ln = np.hypot(L[:, 2] - L[:, 0], L[:, 3] - L[:, 1])
            hist = np.zeros(180)
            for a_, l_ in zip(ang, ln): hist[int(a_) % 180] += l_
            hist = np.convolve(np.r_[hist[-4:], hist, hist[:4]], np.ones(9), 'valid')
            peaks = []
            for _ in range(Gc['dirs']):
                p_ = int(np.argmax(hist)); peaks.append(p_)
                for d_ in range(-15, 16): hist[(p_ + d_) % 180] = 0
            L = L[[min(abs(((a_ - p_) + 90) % 180 - 90) for p_ in peaks) < Gc.get('dirTol', 7) for a_ in ang]]
        for x1_, y1_, x2_, y2_ in L:
            th = np.arctan2(y2_ - y1_, x2_ - x1_) % np.pi; d = np.array([np.cos(th), np.sin(th)]); nv = np.array([-d[1], d[0]])
            rho = nv @ [x1_, y1_]; t1, t2 = sorted([d @ [x1_, y1_], d @ [x2_, y2_]])
            for g in groups:
                dth = abs(((th - g['th']) + np.pi / 2) % np.pi - np.pi / 2)
                if dth < np.radians(Gc.get('angTol', 4)) and abs(rho - g['rho']) < Gc.get('rhoTol', 9) and t1 < g['t2'] + Gc.get('join', 40) and t2 > g['t1'] - Gc.get('join', 40):
                    g['t1'], g['t2'] = min(g['t1'], t1), max(g['t2'], t2); break
            else: groups.append(dict(th=th, rho=rho, t1=t1, t2=t2))
        for g in groups:
            d = np.array([np.cos(g['th']), np.sin(g['th'])]); nv = np.array([-d[1], d[0]])
            ext = Gc.get('extend', 10)
            grid_lines.append((nv * g['rho'] + d * (g['t1'] - ext), nv * g['rho'] + d * (g['t2'] + ext)))
        er = np.zeros((H, W), np.uint8); er[Y0:Y1, X0:X1] = 1  # 원본 점선은 지움 (남길 곳 제외)
        for X0_, Y0_, X1_, Y1_ in Gc.get('keep', []): er[Y0_:Y1_, X0_:X1_] = 0
    # 노선: 원본 노선·정류장 원을 지우고 아래(synth)에서 일정한 간격의 점으로 다시 그림
    routes = []
    for R in c.get('routes', []):
        lum_r = a.max(2)
        C = trace_route(lum_r, R)
        rings = find_rings(lum_r, R.get('stations', []))
        m = np.zeros((H, W), np.uint8)
        cv2.polylines(m, [C.round().astype(np.int32)], False, 1, thickness=2 * R.get('half', 8) + 1)
        for cx, cy, r in rings: cv2.circle(m, (round(cx), round(cy)), round(r + 6), 1, -1)
        a[m > 0] = 0
        if R.get('stationsX'):  # 정류장을 옮겨 그릴 때: 곡선 위에서 x 가 가장 가까운 자리 (원본 원은 위에서 지움)
            rings = [(float(C[np.argmin(np.abs(C[:, 0] - x)), 0]), float(C[np.argmin(np.abs(C[:, 0] - x)), 1]), float(r)) for x, r in R['stationsX']]
        routes.append((R, C, rings))
    if grid_lines: a[er > 0] = 0  # 노선을 찾은 뒤에 지도 원본 점선을 지움
    # 피사체 영역 & 면적 기준 배율
    ys, xs = np.nonzero(lum0 > 0.16)
    x0, x1 = np.percentile(xs, [0.6, 99.4]); y0, y1 = np.percentile(ys, [0.6, 99.4])
    w, h = x1 - x0, y1 - y0
    s = np.sqrt(TARGET_AREA / (w * h)) * c.get('scaleBias', 1.0)
    s = min(s, MAX_W / w, c.get('maxH', MAX_H) / h)
    ox = BOX['cx'] - (x0 + x1) / 2 * s
    oy = BOX['cy'] - (y0 + y1) / 2 * s

    # 움직일 물체(버스) 분리 + 배경 메우기
    layers = layer_polys(name, c)
    layer_masks = []
    hole = np.zeros((H, W), bool)
    for L in layers:
        m = shape_mask(('poly', L['poly']), (W, H))
        m = cv2.dilate(m.astype(np.uint8), np.ones((LAYER_PAD * 2 + 1, LAYER_PAD * 2 + 1), np.uint8)) > 0  # 윤곽선이 다각형 밖으로 살짝 나가도 차체에 포함 → 잘린 경계 없음
        layer_masks.append(m)
        hole |= m
    bg = a.copy()
    if hole.any():
        # 버스 둘레의 빛 번짐(halo)까지 넓게 지우고 그 바깥 도로·배경 무늬로 메움 → 버스가 떠난 자리에 밝은 잔상이 남지 않음
        k = cv2.dilate(hole.astype(np.uint8) * 255, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (21, 21)))
        u8 = np.clip(a * 255, 0, 255).astype(np.uint8)
        filled = cv2.inpaint(u8, k, 5, cv2.INPAINT_TELEA).astype(np.float32) / 255
        bg = np.where(k[..., None] > 0, filled * 0.5, a)
        if c.get('fillVP'):  # 원근 복원: 소실점을 중심으로 키우거나 줄인 원본(같은 길의 더 가깝거나 먼 부분)으로 메움 → 도로·차선·보도·나무가 원근에 맞게 이어짐
            vx, vy = c['fillVP']['vp']; todo = k > 0
            gx, gy = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
            for kk in c['fillVP']['scales']:
                mx, my = vx + (gx - vx) * kk, vy + (gy - vy) * kk
                src = cv2.remap(a, mx, my, cv2.INTER_LINEAR, borderValue=(0, 0, 0))
                ok = cv2.remap((k == 0).astype(np.uint8), mx, my, cv2.INTER_NEAREST, borderValue=0) > 0
                use = todo & ok
                bg[use] = src[use] * c['fillVP'].get('gain', 0.95)
                todo &= ~use
        if c.get('fillShift'):  # 도로를 따라 가장 가까운 거리만큼 옮긴 무늬로 메움 (가까운 것부터) → 버스가 비운 자리에서도 도로 선이 끊기지 않고 이어짐
            todo = k > 0
            for dx, dy in c['fillShift']:
                M = np.float32([[1, 0, dx], [0, 1, dy]])
                src = cv2.warpAffine(a, M, (W, H), flags=cv2.INTER_NEAREST, borderValue=(0, 0, 0))
                ok = cv2.warpAffine((k == 0).astype(np.uint8), M, (W, H), flags=cv2.INTER_NEAREST, borderValue=0) > 0
                use = todo & ok
                bg[use] = src[use] * 0.9
                todo &= ~use

    # 샘플링: 무대 해상도(점 1개 ≈ 무대 1px)로 줄인 뒤 저불일치(R2) 문턱값 디더링.
    #  - 예전: 원본 해상도에서 가중 무작위 추출 → 같은 선 위에서도 점이 뭉치거나 비어 윤곽이 끊겨 보였음
    #  - 지금: 선·면의 밝기(가중치)에 비례한 밀도로 고르게 퍼진 점. 한 무대 px 에 최대 1개 → 밝은 선은 1px 간격으로 이어짐
    #  - 줄일 때 블록 최댓값을 써서 1px 짜리 가는 선이 평균에 묻혀 사라지지 않게 함
    E = EDGE.get(name, 0.8)
    Ws, Hs = int(np.ceil(W * s)), int(np.ceil(H * s))
    kd = max(1, int(np.ceil(1 / s)))
    def to_stage(img):
        img = np.ascontiguousarray(img.astype(np.float32))
        if kd > 1:
            img = cv2.dilate(img, np.ones((kd, kd), np.uint8))
        return cv2.resize(img, (Ws, Hs), interpolation=cv2.INTER_NEAREST)
    a_s, bg_s = to_stage(a), to_stage(bg)
    m_s = [cv2.resize(m.astype(np.uint8), (Ws, Hs), interpolation=cv2.INTER_NEAREST) > 0 for m in layer_masks]

    def weight_of(img):
        lum = img.max(2)
        wgt = np.clip((lum - 0.1) / 0.9, 0, 1) ** 1.35
        if E > 0:
            g = gaussian_filter(lum, 0.8)
            mag = np.hypot(sobel(g, 0), sobel(g, 1))
            edge = np.clip(mag / (np.percentile(mag[lum > 0.15], 97) + 1e-6), 0, 1) ** 0.7
            wgt = wgt * ((1 - E) + E * edge)
        return wgt

    w_bg = weight_of(bg_s)
    w_layers = [weight_of(a_s) * m for m in m_s]
    maps = [w_bg] + w_layers
    lo, hi = 0.0, 1e5  # 전체 점 수가 COUNT 가 되도록 배율 찾기 (한 px 최대 1개)
    for _ in range(50):
        g = (lo + hi) / 2
        tot = sum(np.minimum(1, g * m).sum() for m in maps)
        lo, hi = (g, hi) if tot < COUNT else (lo, g)
    gain = (lo + hi) / 2
    yy, xx = np.mgrid[0:Hs, 0:Ws].astype(np.float32)
    R2 = (xx * 0.7548776662 + yy * 0.5698402910) % 1.0

    def dither(wm, salt):
        t = (R2 + salt + rng.random(R2.shape).astype(np.float32) * 0.18) % 1.0  # 규칙 무늬가 보이지 않게 약간의 흔들림
        sy_, sx_ = np.nonzero(np.minimum(1, gain * wm) > t)
        return sx_, sy_

    pts = []  # (px, py, rgb, tag, group) — px, py 는 원본 좌표 (아래 태그·무대 변환은 그대로)
    def add(sx_, sy_, src, tg, gi):
        jx, jy = rng.random(len(sx_)) * 0.7 + 0.15, rng.random(len(sy_)) * 0.7 + 0.15
        pts.append(((sx_ + jx) / s, (sy_ + jy) / s, src[sy_, sx_], tg, np.full(len(sx_), gi, np.uint8)))
    sx_, sy_ = dither(w_bg, 0.0)
    add(sx_, sy_, bg_s, np.zeros(len(sx_), np.uint8), 0)
    for gi, (L, wl) in enumerate(zip(layers, w_layers), start=1):
        sx_, sy_ = dither(wl, 0.37 * gi)
        px_, py_ = (sx_ + 0.5) / s, (sy_ + 0.5) / s
        tg = np.full(len(sx_), L.get('tag', 2), np.uint8)
        for lx, ly, rx, ry in L.get('lights', []):
            tg[((px_ - lx) / rx) ** 2 + ((py_ - ly) / ry) ** 2 <= 1] = 3
        add(sx_, sy_, a_s, tg, gi)
    # 노선 다시 그리기: 실제 길이 기준 일정 간격(무대 0.8px), 3줄(가운데 밝게), 정류장 원과 겹치는 부분은 비움 → 두께·밝기·간격이 일정
    route_meta = []
    for R, C, rings in routes:
        ds = R.get('spacing', 0.8) / s
        Q = resample(C, ds)
        T = np.gradient(Q, axis=0); T /= np.hypot(*T.T)[:, None] + 1e-9; Nn = np.stack([-T[:, 1], T[:, 0]], 1)
        keep = np.ones(len(Q), bool)
        for cx, cy, r in rings: keep &= np.hypot(Q[:, 0] - cx, Q[:, 1] - cy) > r + 2.5
        b0 = R.get('b', 0.95)
        hq = (np.arange(len(Q)) * 0.6180339) % 1.0
        for lane, bb in R.get('lanes', [[-1.15, 0.55], [0.0, 1.0], [1.15, 0.55]]):
            q = Q[keep] + Nn[keep] * ((lane + (hq[keep] - 0.5) * 0.35) / s)[:, None]
            q = q + T[keep] * ((((hq[keep] * 7.3) % 1.0) - 0.5) * 0.4 * ds)[:, None]
            rgb = palette(np.full(len(q), b0 * bb))
            pts.append((q[:, 0], q[:, 1], rgb, np.full(len(q), R.get('tag', 1), np.uint8), np.zeros(len(q), np.uint8)))
        for cx, cy, r in rings:  # 정류장 원: 같은 간격의 두 겹 테두리
            for rr, bb in ((r - 0.7 / s, 0.9), (r + 0.5 / s, 0.6)):
                k = max(12, int(2 * np.pi * rr / ds)); ang = np.arange(k) / k * 2 * np.pi
                q = np.stack([cx + rr * np.cos(ang), cy + rr * np.sin(ang)], 1)
                pts.append((q[:, 0], q[:, 1], palette(np.full(k, b0 * bb)), np.full(k, R.get('tag', 1), np.uint8), np.zeros(k, np.uint8)))
        nodes = []
        for nd in R.get('nodesX', []):  # 핀·신호용 기준점: x 만 주면 곡선 위로
            if len(nd) == 1: j = np.argmin(np.abs(C[:, 0] - nd[0])); nd = [C[j, 0], C[j, 1]]
            nodes.append([round(nd[0] * s + ox, 2), round(nd[1] * s + oy, 2)])
        route_meta.append({'name': R.get('name', ''), 'nodes': nodes, 'curve': [[round(x * s + ox, 2), round(y * s + oy, 2)] for x, y in resample(C, 3 / s)],
                           'stations': [[round(x * s + ox, 2), round(y * s + oy, 2), round(r * s, 2)] for x, y, r in rings]})
    if grid_lines:  # 지도 배경 도로: 노선보다 가늘고 어둡게, 일정 간격(무대 1.1px), 끝은 서서히
        Gc = c['mapGrid']; ds = Gc.get('spacing', 1.1) / s
        for P0, P1 in grid_lines:
            L_ = np.hypot(*(P1 - P0)); n_ = max(2, int(L_ / ds)); u = (np.arange(n_) + 0.5) / n_
            q = P0[None] + (P1 - P0)[None] * u[:, None]
            hq = (np.arange(n_) * 0.618) % 1.0
            q += np.array([-(P1 - P0)[1], (P1 - P0)[0]])[None] / L_ * ((hq - 0.5) * 0.5 / s)[:, None]
            # 노선과 겹치는 부분은 비움
            ok = np.ones(n_, bool)
            for R_, C_, _ in routes:
                dmin = np.min(np.hypot(q[:, None, 0] - C_[None, ::4, 0], q[:, None, 1] - C_[None, ::4, 1]), 1); ok &= dmin > 9
            fade = np.clip(np.minimum(u, 1 - u) * L_ / Gc.get('fade', 18), 0, 1)
            bb = Gc.get('b', 0.34) * (0.85 + 0.15 * ((hq * 5.3) % 1.0)) * fade
            q, bb = q[ok], bb[ok]
            pts.append((q[:, 0], q[:, 1], palette(np.clip(bb, 0, 1)), np.zeros(len(q), np.uint8), np.zeros(len(q), np.uint8)))
    # 다시 그리는 선 (지운 핀 아래 노선 등)
    for sy in c.get('synth', []):
        P = np.array(sy['poly'], float)
        seg = np.diff(P, axis=0); ln = np.hypot(*seg.T); n = int(ln.sum() / 1.3)
        u = np.sort(rng.random(n)) * ln.sum(); cum = np.concatenate([[0], np.cumsum(ln)])
        k = np.clip(np.searchsorted(cum, u) - 1, 0, len(seg) - 1); f = (u - cum[k]) / ln[k]
        q = P[k] + seg[k] * f[:, None]
        nrm = np.stack([-seg[k][:, 1], seg[k][:, 0]], 1) / ln[k][:, None]
        q += nrm * (rng.normal(0, sy['width'] / 4, n))[:, None]
        q += rng.normal(0, 0.6, (n, 2))
        b = sy['b'] * (0.7 + 0.3 * rng.random(n))
        rgb = palette(np.clip(b, 0, 1))
        pts.append((q[:, 0], q[:, 1], rgb, np.full(n, sy['tag'], np.uint8), np.zeros(n, np.uint8)))

    px = np.concatenate([p[0] for p in pts]).astype(float); py = np.concatenate([p[1] for p in pts]).astype(float)
    col = np.concatenate([p[2] for p in pts]); tag = np.concatenate([p[3] for p in pts]); grp = np.concatenate([p[4] for p in pts])
    n = len(px)
    # 역할 태그 (먼저 맞는 것)
    done = tag > 0
    for t, sh in c.get('tags', []):
        m = shape_mask(sh, (W, H))[np.clip(py.astype(int), 0, H - 1), np.clip(px.astype(int), 0, W - 1)] & ~done
        tag[m] = t; done |= m
    if name == 'bms-2':
        tag[tag == 0] = 5
    # 밝기 분위 맞춤 → LIVEBUS 와 같은 밝기 분포
    l = col.max(1)
    if name == 'libus-1':
        REF['q'] = np.sort(l)
        target = l
    else:
        rank = np.argsort(np.argsort(l)) / max(n - 1, 1)
        target = np.interp(rank, np.linspace(0, 1, len(REF['q'])), REF['q'])
    # 주변 요소는 낮춰서 주인공(태그로 지정)에 시선이 모이게
    if 'dimOutside' in c:
        keep_t = np.isin(tag, c['dimOutside']['tags'])
        target = np.where(keep_t, target, target * c['dimOutside']['k'])
    for tg_, g_ in c.get('tagGain', {}).items():  # 두껍게 빛나는 윤곽 낮춤
        target = np.where(tag == int(tg_), target * g_, target)
    col = col * (target / np.maximum(l, 1e-4))[:, None]
    T = TINT.get(name, 0.7)
    tone = (1 - T) * np.clip(col, 0, 1.3) + T * palette(np.clip(target, 0, 1))
    # 무대 좌표
    jx, jy = rng.random(n) - 0.5, rng.random(n) - 0.5
    sx = (px + jx) * s + ox; sy = (py + jy) * s + oy
    keep = (sx >= 0) & (sx < STAGE_W) & (sy >= 0) & (sy < STAGE_H)
    sx, sy, tone, tag, grp = sx[keep], sy[keep], tone[keep], tag[keep], grp[keep]
    n = len(sx)
    buf = b''.join([
        np.round(sx * 32).astype('<u2').tobytes(), np.round(sy * 32).astype('<u2').tobytes(),
        np.clip(tone * 255 / 1.3, 0, 255).astype(np.uint8).tobytes(), tag.tobytes(), grp.tobytes(),
    ])
    open(os.path.join(OUT, name + '.bin'), 'wb').write(buf)
    # 빛 번짐: 배경만 (움직이는 물체는 빼서 물체가 이동해도 번짐이 남지 않게)
    lvl = float(np.median(target) / max(np.median(l), 1e-3))
    haze = Image.fromarray(np.clip(bg * min(lvl, 1.2) * 255, 0, 255).astype(np.uint8))
    stage = Image.new('RGB', (STAGE_W, STAGE_H))
    stage.paste(haze.resize((round(W * s), round(H * s)), Image.LANCZOS), (round(ox), round(oy)))
    stage.resize((800, 450), Image.LANCZOS).filter(ImageFilter.GaussianBlur(5)).save(os.path.join(OUT, name + '.jpg'), quality=82)
    print(f'{name}: 점 {n}, 배율 {s:.4f}, 피사체 {round(w)}×{round(h)} → 무대 {round(w * s)}×{round(h * s)}, 그룹 {int(grp.max())}')
    return dict(count=int(n), s=float(s), ox=float(ox), oy=float(oy), routes=route_meta)


def main():
    os.makedirs(OUT, exist_ok=True)
    rng = np.random.default_rng(2026)
    meta = {'stage': [STAGE_W, STAGE_H], 'box': BOX, 'tagNames': TAG_NAMES, 'scenes': {}}
    for name in CONF['order']:
        meta['scenes'][name] = build(name, rng)
    json.dump(meta, open(os.path.join(OUT, 'scenes.json'), 'w'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
