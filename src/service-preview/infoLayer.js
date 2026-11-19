/**
 * 장면 안 정보(글자·핀·연결선·링·강조 테두리)를 이미지와 같은 "점"으로 그리는 층
 *
 * - 글자·핀 모양은 2D 캔버스에 한 번 그려 점으로 뽑아 두고(캐시), 매 프레임 위치·밝기만 바꿔 버퍼에 담는다.
 * - main.js 가 장면 점과 같은 셰이더(빛 번짐 + 점)로 그린다 → 질감·발광·시차가 장면과 똑같이 움직임
 * - 나타남/사라짐/값 바뀜: 점마다 다른 문턱값으로 반짝이며 채워지고, 흩어지며 사라짐 (HTML 페이드·blur 아님)
 * - 좌표는 무대(1600×900). put() 의 m = [ux, uy, vx, vy] 로 기울어진 화면(전광판·안내판)에 맞춰 붙임
 */
const FONT = '"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif';
const NUM = '"DM Sans","Malgun Gothic",Arial,sans-serif';
const R = 3; // 무대 1px 당 래스터 px
const hash = (i) => { let x = (i * 2654435761) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; return (x >>> 0) / 4294967296; };

export function createInfo(max = 48000) {
  const pos = new Float32Array(max * 2), col = new Float32Array(max * 3);
  let n = 0;
  const cache = new Map();
  const cv = document.createElement('canvas');
  const cx = cv.getContext('2d', { willReadFrequently: true });
  let excl = []; // 점을 찍지 않을 영역 (소개 글 등), 무대 좌표 [x0,y0,x1,y1]
  let push = null; // 커서 밀어내기 (장면 점과 같은 느낌)
  let scatter = null; // 장면 전환: 장면 점과 함께 바깥으로 흩어짐 { cx, cy, k }

  /** 2D 그림 → 점 (밝기 = 알파). step: 점 간격(무대 px) */
  function rasterize(key, w, h, draw, step = 0.95, density = 1) {
    if (cache.has(key)) return cache.get(key);
    const W = Math.ceil(w * R) + 8, H = Math.ceil(h * R) + 8;
    cv.width = W; cv.height = H;
    cx.clearRect(0, 0, W, H); cx.save(); cx.translate(4, 4); cx.scale(R, R); cx.fillStyle = '#fff'; cx.strokeStyle = '#fff'; draw(cx); cx.restore();
    const a = cx.getImageData(0, 0, W, H).data;
    const xs = [], ys = [], bs = [];
    let k = 0;
    for (let gy = 0; gy < h; gy += step) for (let gx = 0; gx < w; gx += step) {
      const jx = gx + (hash(k * 2 + 1) - 0.5) * step * 0.7, jy = gy + (hash(k * 2 + 7) - 0.5) * step * 0.7; k++;
      const px = Math.round(jx * R) + 4, py = Math.round(jy * R) + 4;
      if (px < 0 || py < 0 || px >= W || py >= H) continue;
      const al = a[(py * W + px) * 4 + 3] / 255;
      if (al < 0.18 || hash(k * 5 + 3) > al * density) continue;
      xs.push(jx); ys.push(jy); bs.push(0.55 + 0.45 * al);
    }
    const m = xs.length, s = { n: m, x: new Float32Array(xs), y: new Float32Array(ys), b: new Float32Array(bs), r: new Float32Array(m), w, h };
    for (let i = 0; i < m; i++) s.r[i] = hash(i * 13 + key.length * 7);
    cache.set(key, s);
    return s;
  }

  /** 글자 모양. 기준점: align(왼/가운데/오른) × 세로 가운데 */
  function text(str, size, { weight = 700, align = 'left', num = false } = {}) {
    const key = `t|${str}|${size}|${weight}|${align}|${num}`;
    if (cache.has(key)) return cache.get(key);
    const f = `${weight} ${size}px ${num ? NUM : FONT}`;
    cx.font = f; const w = Math.ceil(cx.measureText(str).width) + 2, h = Math.ceil(size * 1.4);
    const s = rasterize(key, w, h, (c) => { c.font = f; c.textBaseline = 'middle'; c.fillText(str, 1, h / 2); }, size >= 18 ? 0.95 : 0.8);
    s.ox = align === 'left' ? 0 : align === 'center' ? -w / 2 : -w; s.oy = -h / 2;
    return s;
  }
  /** 위치 핀 (끝이 기준점). 윤곽 + 안쪽 고리, 안은 성기게 */
  function pin(size = 22) {
    const key = `p|${size}`;
    if (cache.has(key)) return cache.get(key);
    const k = size / 22, w = 26 * k, h = 36 * k;
    const s = rasterize(key, w, h, (c) => {
      c.translate(w / 2, h - 1); c.scale(k, k);
      const p = new Path2D('M0,0 C-3,-6 -11,-12 -11,-21 A11,11 0 1 1 11,-21 C11,-12 3,-6 0,0 Z');
      c.globalAlpha = 0.28; c.fill(p); c.globalAlpha = 1; c.lineWidth = 1.7; c.stroke(p);
      c.beginPath(); c.arc(0, -21, 4.2, 0, Math.PI * 2); c.lineWidth = 1.6; c.stroke();
    }, 0.9);
    s.ox = -w / 2; s.oy = -h + 1;
    return s;
  }
  /** 작은 버스 아이콘 */
  function busIcon(size = 16) {
    const key = `b|${size}`;
    if (cache.has(key)) return cache.get(key);
    const k = size / 16;
    const s = rasterize(key, size + 2, size + 2, (c) => {
      c.translate(1, 1); c.scale(k, k); c.lineWidth = 1.5;
      c.beginPath(); c.roundRect(2, 1, 12, 12, 2); c.stroke();
      c.beginPath(); c.moveTo(2, 5.5); c.lineTo(14, 5.5); c.stroke();
      c.fillRect(4, 13, 2, 2); c.fillRect(10, 13, 2, 2);
    }, 0.8);
    s.ox = -(size + 2) / 2; s.oy = -(size + 2) / 2;
    return s;
  }
  /** 둥근 사각 테두리 (행 강조) */
  function frame(w, h, rad = 4) {
    const key = `f|${Math.round(w)}|${Math.round(h)}|${rad}`;
    if (cache.has(key)) return cache.get(key);
    const s = rasterize(key, w + 2, h + 2, (c) => { c.lineWidth = 1.1; c.beginPath(); c.roundRect(1, 1, w, h, rad); c.stroke(); c.globalAlpha = 0.16; c.fill(); }, 1.1);
    s.ox = -1; s.oy = -1;
    return s;
  }

  // ── 버퍼 채우기 ────────────────────────────────────────────────
  const TINT = [0.52, 0.86, 1.0];
  function emit(x, y, b, tint) {
    if (n >= max) return;
    if (scatter) { const k = scatter.k; x += (x - scatter.cx) * k * 0.7 + (hash(n * 3 + 11) - 0.5) * k * 160; y += (y - scatter.cy) * k * 0.7 + (hash(n * 3 + 17) - 0.5) * k * 160; }
    if (push) { const dx = x - push.x, dy = y - push.y, d2 = dx * dx + dy * dy; if (d2 < push.r2) { const d = Math.sqrt(d2) + 0.01, k = 1 - d / push.r; x += (dx / d) * k * k * push.s; y += (dy / d) * k * k * push.s; } }
    for (let e = 0; e < excl.length; e++) { const q = excl[e]; if (x > q[0] && x < q[2] && y > q[1] && y < q[3]) return; }
    pos[n * 2] = x; pos[n * 2 + 1] = y;
    col[n * 3] = tint[0] * b; col[n * 3 + 1] = tint[1] * b; col[n * 3 + 2] = tint[2] * b; n++;
  }
  /**
   * 모양을 (x, y) 에 찍음
   * o.k 밝기, o.tint 색, o.m 축 [ux,uy,vx,vy] (기본 가로·세로 1), o.sc 배율
   * o.reveal 0→1 (점마다 다른 때에 반짝이며 나타남), o.out 0→1 (흩어지며 사라짐), o.dy 사라질 때 이동 방향
   * o.clip [x0,y0,x1,y1] 로컬(m 적용 전, 기준점 기준) 좌표에서 자르기
   */
  function put(s, x, y, o = {}) {
    const k = o.k ?? 1; if (k <= 0.003) return;
    const tint = o.tint || TINT, m = o.m, sc = o.sc ?? 1, rv = o.reveal ?? 1, out = o.out ?? 0, clip = o.clip, sh = o.shimmer ?? 0, t = o.t ?? 0;
    for (let i = 0; i < s.n; i++) {
      const r = s.r[i];
      let a = 1;
      if (rv < 1) { const q = (rv - r * 0.8) / 0.2; if (q <= 0) continue; a = Math.min(1, q); }
      let lx = (s.x[i] + s.ox) * sc, ly = (s.y[i] + s.oy) * sc;
      if (out > 0) { const q = (out - r * 0.7) / 0.3; if (q >= 1) continue; if (q > 0) { a *= 1 - q; const d = q * q * 7; lx += (hash(i * 3 + 1) - 0.5) * d; ly += (o.dy ?? -1) * d + (hash(i * 3 + 2) - 0.5) * d * 0.6; } }
      if (clip && (lx < clip[0] || lx > clip[2] || ly < clip[1] || ly > clip[3])) continue;
      let b = s.b[i] * k * a;
      if (sh) b *= 1 - sh + sh * (0.75 + 0.25 * Math.sin(t * 2.3 + r * 40));
      if (o.map) { // 원근 화면: (x, y) 는 화면 안 좌표, map 이 화면 네 모서리에 맞춘 원근 변환. box 밖은 그리지 않음 (마스킹)
        const ux = x + lx, uy = y + ly, bx = o.box;
        if (bx && (ux < bx[0] || ux > bx[2] || uy < bx[1] || uy > bx[3])) continue;
        const [X, Y] = o.map(ux, uy); emit(X, Y, b, tint); continue;
      }
      const X = m ? x + lx * m[0] + ly * m[2] : x + lx, Y = m ? y + lx * m[1] + ly * m[3] : y + ly;
      emit(X, Y, b, tint);
    }
  }
  /** 꺾은선을 점으로 (from..to: 0..1 구간만) */
  function line(pts, { k = 0.7, step = 3.2, from = 0, to = 1, tint, jitter = 0.5, seed = 1 } = {}) {
    let L = 0; const seg = [];
    for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); seg.push(l); L += l; }
    const a0 = from * L, a1 = to * L; let acc = 0, j = 0;
    for (let i = 0; i < seg.length; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], l = seg[i];
      for (let d = Math.ceil(acc / step) * step - acc; d < l; d += step, j++) {
        const u = acc + d; if (u < a0 || u > a1) continue;
        const f = d / l, h1 = hash(j * 7 + seed), h2 = hash(j * 11 + seed);
        emit(x0 + (x1 - x0) * f + (h1 - 0.5) * jitter, y0 + (y1 - y0) * f + (h2 - 0.5) * jitter, k * (0.75 + 0.25 * h1), tint || TINT);
      }
      acc += l;
    }
  }
  /** 점선 원 (rx, ry) */
  function ring(x, y, rx, ry, { k = 0.8, step = 3.4, tint } = {}) {
    if (k <= 0.003) return;
    const c = Math.max(8, Math.round((Math.PI * (rx + ry)) / step));
    for (let i = 0; i < c; i++) { const a = (i / c) * Math.PI * 2; emit(x + Math.cos(a) * rx, y + Math.sin(a) * ry, k * (0.8 + 0.2 * hash(i)), tint || TINT); }
  }
  /** 빛 알갱이 하나 (신호) */
  function spark(x, y, k = 1.4, tint) { emit(x, y, k, tint || [0.75, 0.97, 1.0]); emit(x + 0.8, y + 0.3, k * 0.6, tint || [0.75, 0.97, 1.0]); }

  return {
    pos, col, get count() { return n; },
    begin() { n = 0; },
    setExclude(r) { excl = r; },
    setPush(p) { push = p; },
    setScatter(v) { scatter = v; },
    text, pin, busIcon, frame, put, line, ring, spark,
    /** 사각형(0..w, 0..h) → 사변형 Q(TL,TR,BR,BL) 원근 변환 */
    homography,
  };
}

function homography(w, h, Q) {
  // 단위 정사각형 → 사변형 (Heckbert) 후 (x/w, y/h) 적용
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = Q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1, g = (sx * dy2 - dx2 * sy) / den, hh = (dx1 * sy - sx * dy1) / den;
  const a = x1 - x0 + g * x1, b = x3 - x0 + hh * x3, d = y1 - y0 + g * y1, e = y3 - y0 + hh * y3;
  return (x, y) => { const u = x / w, v = y / h, z = g * u + hh * v + 1; return [(a * u + b * v + x0) / z, (d * u + e * v + y0) / z]; };
}
/**
 * 바뀌는 값: 이전 값은 흩어지며 사라지고 새 값이 반짝이며 채워짐 (0.7초)
 * 시간 t 는 장면 시간 → 같은 장면에서는 결과가 시간의 함수
 */
export function slot() {
  let cur = null, prev = null, at = -1;
  return {
    reset() { cur = prev = null; at = -1; },
    draw(info, t, value, fn) { // fn(value, {reveal, out})
      if (t < at) { cur = prev = null; at = -1; }
      if (value !== cur) { prev = cur; cur = value; at = cur !== null && prev !== null ? t : -9; }
      const p = (t - at) / 0.7;
      if (prev !== null && p < 1) fn(prev, { out: Math.min(1, p * 1.6), reveal: 1 });
      fn(cur, { reveal: p >= 1 ? 1 : Math.max(0, (p - 0.25) / 0.75), out: 0 });
    },
  };
}
