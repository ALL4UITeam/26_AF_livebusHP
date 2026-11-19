/**
 * 서비스 시연 — 장면 안 정보 (버스 번호·도착정보·위치 핀·연결선·정보 카드)
 *
 * - 모두 infoLayer 의 점으로 그린다 → 장면 이미지와 같은 점 크기·색·발광·시차. 따로 밀리거나 흔들리지 않음
 * - 원본 이미지에서 이 정보가 있던 자리는 tools/build_scenes.py 의 clean 으로 지웠다 → 중복 없음
 * - 모든 표시는 demo.js 시간표의 함수(장면 시간 t). 나타날 때는 점이 반짝이며 채워지고, 떠날 때(ctx.out)는 흩어짐
 * - 상호작용(BMS 핀 선택)은 보이지 않는 단추(.sp-stage, 키보드·터치 가능)로 받고, 읽기 보조 문구는 ui.live 로 내보냄
 */
import { slot } from './infoLayer.js';
import { STOP, BUSES, LIVEBUS, BMS, BIT, BIS } from './demo.js';

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const HOT = [0.7, 0.97, 1.05], DIM = [0.36, 0.66, 0.95];
function along(pts, s) { // 꺾은선 위 위치 (s: 구간 번호 + 소수)
  const k = Math.min(pts.length - 2, Math.max(0, Math.floor(s))), f = clamp01(s - k);
  return [pts[k][0] + (pts[k + 1][0] - pts[k][0]) * f, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * f];
}
/** 꺾은선 길이 기준 위치 (거리 d, px) — 도로를 따라 움직이는 데이터 입자용 */
function arc(pts) {
  const L = [0]; for (let k = 1; k < pts.length; k++) L.push(L[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  return {
    len: L[L.length - 1],
    at(d) { d = Math.max(0, Math.min(L[L.length - 1], d)); let k = 1; while (k < L.length - 1 && L[k] < d) k++; const f = (d - L[k - 1]) / (L[k] - L[k - 1] || 1); return [pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * f, pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * f]; },
    near(x, y) { let best = 0, bd = Infinity; for (let k = 0; k < pts.length - 1; k++) { const a = pts[k], b = pts[k + 1], vx = b[0] - a[0], vy = b[1] - a[1], u = clamp01(((x - a[0]) * vx + (y - a[1]) * vy) / (vx * vx + vy * vy)), qx = a[0] + vx * u - x, qy = a[1] + vy * u - y, dd = qx * qx + qy * qy; if (dd < bd) { bd = dd; best = L[k] + u * (L[k + 1] - L[k]); } } return best; },
  };
}
const fhash = (i) => { const v = Math.sin(i * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
/** 흩어진 빛 알갱이가 한 점으로 모임 (q: 0 → 1). 정보가 바뀌는 자리에 잠깐 모이는 효과 */
function gather(info, x, y, q, n, spread, seed, k = 1) {
  if (q <= 0 || q >= 1.4) return;
  const e = 1 - Math.pow(1 - Math.min(1, q), 3), fade = q < 1 ? Math.min(1, q * 3) : 1 - (q - 1) / 0.4;
  for (let j = 0; j < n; j++) { const a = fhash(seed + j) * 6.283, r = spread * (0.45 + 0.55 * fhash(seed + j + 50)); info.spark(x + Math.cos(a) * r * (1 - e), y + Math.sin(a) * r * 0.55 * (1 - e), (0.5 + 0.6 * fhash(seed + j + 90)) * fade * k); }
}
/**
 * 장면 데이터에 저장된 실제 노선 곡선(scenes.json routes, 점으로 다시 그린 노선과 같은 선) 위의 위치.
 * s = 기준점 번호 + 소수 (기존 along 과 같은 뜻) → 곡선 길이로 바꿔 곡선 위 좌표. 핀·신호가 노선에서 벗어나지 않음
 */
function curvePath(curve, nodes) {
  const R = arc(curve), at = nodes.map(([x, y]) => R.near(x, y));
  const d = (s) => { const k = Math.min(at.length - 2, Math.max(0, Math.floor(s))), f = clamp01(s - k); return at[k] + (at[k + 1] - at[k]) * f; };
  return {
    along: (s) => R.at(d(s)),
    sub(s0, s1) { const a = d(s0), b = d(s1), n = Math.max(2, Math.ceil(Math.abs(b - a) / 3)), o = []; for (let i = 0; i <= n; i++) o.push(R.at(a + ((b - a) * i) / n)); return o; },
  };
}
function sub(pts, s0, s1) { // 꺾은선 일부 (s0 → s1)
  const out = [along(pts, s0)];
  for (let k = Math.ceil(s0 + 1e-6); k < s1; k++) out.push(pts[k]);
  out.push(along(pts, s1));
  return out;
}
/** 사변형 화면(TL, TR, BR, BL) → 로컬 축 m 과 크기 */
function frameOf(q) {
  const [a, b, , d] = q, w = Math.hypot(b[0] - a[0], b[1] - a[1]), h = Math.hypot(d[0] - a[0], d[1] - a[1]);
  return { o: a, w, h, m: [(b[0] - a[0]) / w, (b[1] - a[1]) / w, (d[0] - a[0]) / h, (d[1] - a[1]) / h] };
}
const toWorld = (F, x, y) => [F.o[0] + x * F.m[0] + y * F.m[2], F.o[1] + x * F.m[1] + y * F.m[3]];

export function createOverlays(stage, meta, conf, poses, { reduce, info, small = false }) {
  const at = poses.at;
  const ui = { selected: BMS.selected, holding: false, live: '' };
  const scenes = [livebus(), bms(), bit(), bis()];
  return {
    ui,
    enter(k) { scenes[k]?.enter(); },
    leave(k) { scenes[k]?.leave(); ui.holding = false; },
    /** ctx: { livebusPose, bmsPose, setHighlight, out (0..1 떠나는 중) } */
    update(k, t, ctx) { scenes[k]?.update(t, ctx); },
  };

  // 공통: 장면이 자리 잡은 뒤 점이 반짝이며 채워짐 (t0 부터 dur 동안)
  function rv(t, t0, dur = 0.7) { return reduce ? 1 : clamp01((t - t0) / dur); }

  // ── LIVEBUS ─────────────────────────────────────────────────────
  function livebus() {
    const S = 'libus-1', A = conf.scenes[S].anchors;
    const RM = meta.scenes[S].routes?.[0];
    // 기준점: 장면 데이터의 노선 곡선 위 정류장 자리 (빌더가 정류장을 옮겨 그린 위치와 같음)
    const nodes = RM?.nodes?.length ? RM.nodes : A.route.map(([x, y]) => at(S, x, y)), stopN = A.stopNode;
    const RC = meta.scenes[S].routes?.[0]?.curve, rp = RC ? curvePath(RC, nodes) : { along: (s) => along(nodes, s) };
    // 안내판 화면: 원본 화면 네 모서리(원근) → 화면 안 좌표 BW×BH 를 그 사변형에 맞춰 그림
    const BQ = A.boardQuad.map(([x, y]) => at(S, x, y));
    const BW = 104, BH = 104 * (Math.hypot(BQ[3][0] - BQ[0][0], BQ[3][1] - BQ[0][1]) / Math.hypot(BQ[1][0] - BQ[0][0], BQ[1][1] - BQ[0][1]));
    const bmap = info.homography(BW, BH, BQ), BOX = [3, 3, BW - 3, BH - 3];
    const PAD = 9, ROW = (BH - 34) / 2, R1 = 34 + ROW * 0.5, R2 = 34 + ROW * 1.5; // 제목 34, 두 행
    const rowSlots = [slot(), slot()];
    const sign = frameOf(A.sign.map(([x, y]) => at(S, x, y)));
    const roof = at(S, ...A.busRoof);
    const eta = slot();
    return {
      enter() { eta.reset(); rowSlots.forEach((x) => x.reset()); },
      leave() {},
      update(t, ctx) {
        const T = reduce ? 7.2 : t, st = LIVEBUS.state(T), out = ctx.out || 0;
        const R = (t0, d) => rv(t, t0, d);
        const o = (k, extra) => ({ k, out, ...extra });
        // 지도: 지명, 정류장, 종점 핀
        info.put(info.text('시청', 13, { align: 'center' }), nodes[0][0], nodes[0][1] - 16, o(0.8, { reveal: R(0.1) }));
        info.put(info.text(STOP, 13, { align: 'center' }), nodes[stopN][0] + 4, nodes[stopN][1] + 26, o(st.stopped ? 1.05 : 0.85, { reveal: R(0.2), tint: st.stopped ? HOT : undefined }));
        info.put(info.text('터미널', 13, { align: 'center' }), nodes[6][0] + 2, nodes[6][1] - 30, o(0.8, { reveal: R(0.3) }));
        info.put(info.pin(13), nodes[6][0], nodes[6][1], o(0.7, { reveal: R(0.3) }));
        // 노선 위 100번 위치 (버스와 같은 진행도)
        const [px, py] = rp.along(st.pinP);
        info.put(info.pin(20), px, py, o(1.05, { reveal: R(0.4) }));
        info.put(info.text('100', 11, { num: true, align: 'center' }), px, py - 40, o(0.95, { reveal: R(0.5) }));
        if (!out && !reduce) {
          // 위치 갱신: 버스 지붕 → 지도 핀 (처음 한 번), 핀 → 정류장 (문구가 바뀌기 0.8초 전부터)
          const [rx, ry] = poses.apply(ctx.livebusPose, ...roof);
          const u0 = (T - 0.3) / 0.8;
          if (u0 > 0 && u0 < 1) { const e = ease(u0); for (let k = 0; k < 3; k++) { const f = clamp01(e - k * 0.04); info.spark(rx + (px - rx) * f, ry + (py - 10 - ry) * f - Math.sin(f * Math.PI) * 40, 1.3 - k * 0.35); } }
          for (const [ta] of LIVEBUS.eta.slice(1)) {
            const u = (T - (ta - 0.8)) / 0.8; if (u <= 0 || u >= 1) continue;
            const s0 = st.pinP, e = ease(u);
            for (let k = 0; k < 3; k++) { const [x, y] = rp.along(s0 + (stopN - s0) * clamp01(e - k * 0.05)); info.spark(x, y, 1.3 - k * 0.35); }
          }
          if (st.stopped) { const q = (T - LIVEBUS.move.arrive) / 1.1; if (q < 1) info.ring(nodes[stopN][0], nodes[stopN][1], 6.5 + q * 16, 6.5 + q * 16, { k: (1 - q) * 0.9 }); }
        }
        // 정류장 안내판: 제목·구분선·번호·도착시간·강조를 모두 같은 원근 변환으로, 화면 안(BOX)으로 잘라 그림
        const scr = R(LIVEBUS.screenOn, 0.6);
        const bo = (k, extra) => ({ k, out, map: bmap, box: BOX, reveal: scr, ...extra });
        const bline = (y, k) => { if (!out) info.line([bmap(PAD - 2, y), bmap(BW - PAD + 2, y)], { k: k * scr, step: 2.2 }); };
        info.put(info.text(`${STOP} 도착정보`, 11, { align: 'center' }), BW / 2, 15, bo(0.9));
        bline(30, 0.38); bline(34 + ROW, 0.22);
        const hotK = st.arrivedHot ? rv(T, LIVEBUS.move.arrive, 0.5) * (1 - clamp01((T - (LIVEBUS.next.at - 0.5)) / 0.5)) : 0;
        if (hotK > 0.01) info.put(info.frame(BW - 2 * PAD + 6, ROW - 8, 3), PAD - 3, 34 + 4, bo(0.5 * hotK));
        const row = (y, no, v, hot, sl) => sl.draw(info, T, `${no}|${v}`, (val, q) => {
          const [n, e] = val.split('|'), op = { reveal: Math.min(scr, q.reveal), out: Math.max(out, q.out) };
          info.put(info.busIcon(11), PAD + 5, y, bo(0.75, op));
          info.put(info.text(n, 14, { num: true }), PAD + 14, y, bo(hot ? 1.15 : 1, op));
          info.put(info.text(e, 12.5, { align: 'right' }), BW - PAD, y, bo(hot ? 1.2 : 0.95, { ...op, tint: hot ? HOT : undefined }));
        });
        row(R1, '100', st.eta, st.arrivedHot, rowSlots[0]);
        row(R2, '201', st.row2, false, rowSlots[1]);
        // 바퀴 휠 표시 5개: 원본 휠은 동심원이라 돌아도 티가 나지 않아, 회전을 읽을 수 있게 휠 안쪽에 작은 점을 보완 (바퀴와 같은 각·원근)
        if (!reduce) { const ang = poses.wheelAngle(st.u), P0 = ctx.livebusPose;
          poses.wheels.forEach((Wl, w) => { for (let j = 0; j < 5; j++) { const a2 = ang + j * 1.2566, [x, y] = poses.apply(P0, Wl.cx + Math.cos(a2) * 0.5 * Wl.rx, Wl.cy + Math.sin(a2) * 0.5 * Wl.ry); info.spark(x, y, (w ? 0.45 : 0.6) * R(0.2, 0.6) * (1 - out)); } }); }
        // 버스 앞 전광판 '100': 버스 자세를 그대로 따름 (기울기·크기)
        const P = ctx.livebusPose, [cx0, cy0] = toWorld(sign, sign.w / 2, sign.h / 2), [wx, wy] = poses.apply(P, cx0, cy0);
        info.put(info.text('100', 21, { num: true, align: 'center' }), wx, wy + 1, o(1.15, { reveal: R(0.15, 0.6), m: sign.m.map((v) => v * P.sc), tint: HOT }));
        ui.live = `${STOP} 정류장 100번 ${st.eta}`;
      },
    };
  }

  // ── BMS ─────────────────────────────────────────────────────────
  function bms() {
    const S = 'bms-2', C = conf.scenes[S];
    const roads = C.roads.map((r) => r.map(([x, y]) => at(S, x, y)));
    const roadOf = [1, 0, 0, 0]; // 버스별 도로 (busAnchors 순서)
    const pinBase = C.busAnchors.map(([x, y]) => at(S, x + C.pinOffset[0], y + C.pinOffset[1]));
    const busBase = C.busAnchors.map(([x, y]) => at(S, x + 110, y - 60)); // 버스 차체 가운데 (도로 위)
    const roadArc = roads.map(arc);
    const state = slot();
    let sel = BMS.selected, selAt = -9;
    const items = BMS.buses.map((b) => {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'sp-pinbtn'; btn.tabIndex = -1; btn.hidden = true;
      btn.setAttribute('aria-label', `${b.id}번 버스 운행 정보`);
      stage.appendChild(btn);
      const pick = () => { ui.selected = b.id; };
      let tm = 0; // 터치: 누른 뒤 4초 동안 카드 유지
      btn.addEventListener('mouseenter', () => { pick(); ui.holding = true; });
      btn.addEventListener('mouseleave', () => { ui.holding = false; });
      btn.addEventListener('focus', () => { pick(); ui.holding = true; });
      btn.addEventListener('blur', () => { ui.holding = false; });
      btn.addEventListener('click', () => { pick(); ui.holding = true; clearTimeout(tm); tm = setTimeout(() => { if (document.activeElement !== btn) ui.holding = false; }, 4000); });
      return { b, btn };
    });
    return {
      enter() { ui.selected = BMS.selected; sel = ui.selected; selAt = -9; state.reset(); items.forEach((it) => { it.btn.tabIndex = 0; it.btn.hidden = false; }); },
      leave() { items.forEach((it) => { it.btn.tabIndex = -1; it.btn.blur(); it.btn.hidden = true; }); },
      update(t, ctx) {
        const T = reduce ? 4.0 : t, st = BMS.state(T), out = ctx.out || 0;
        if (ui.selected !== sel) { sel = ui.selected; selAt = t; state.reset(); }
        const kk = parseFloat(stage.style.getPropertyValue('--k')) || 1;
        let selXY = null, selI = 0;
        items.forEach((it, i) => {
          const s = st[i], [x, y] = poses.apply(ctx.bmsPose[i], ...pinBase[i]);
          const on = rv(t, 0.15 + i * 0.22, 0.6), isSel = sel === s.id;
          info.put(info.pin(26), x, y, { k: isSel ? 1.2 : 0.8, reveal: on, out, tint: isSel ? HOT : undefined });
          // 위치 보고: 상태가 바뀔 때 핀 아래에서 한 번 퍼짐
          if (!out && !reduce && s.report >= 0) { const q = (T - s.reportAt) / 0.9; if (q >= 0 && q < 1) info.ring(x, y + 2, 5 + q * 24, 2 + q * 10, { k: (1 - q) * 0.9 * on }); }
          it.btn.style.transform = `translate(${x - 18}px,${y - 46}px)`;
          if (isSel) { selXY = [x, y]; selI = i; }
        });
        // 선택 버스 정보 카드 (점) — 핀 옆, 화면 안쪽으로. 세로 화면에서는 --k 만큼 키움
        if (selXY) {
          const s = st[selI], B = BUSES[s.id], [x, y] = selXY, sc = kk;
          const right = kk > 1 ? x < 780 : x < 1150, W = 150, H = 64;
          const cx = right ? x + 16 : x - 16 - W * sc, cy = y - 68 * Math.min(sc, 1.4);
          const show = Math.min(rv(t, 1.0, 0.6), selAt > 0 ? rv(t, selAt, 0.45) : 1);
          const m = [sc, 0, 0, sc];
          info.put(info.frame(W, H, 6), cx, cy, { k: 0.5, reveal: show, out, m });
          info.put(info.text(`${s.id}번 · 차량 ${B.vehicle}`, 13), cx + 10 * sc, cy + 15 * sc, { k: 1.05, reveal: show, out, m });
          info.put(info.text(B.dir, 10.5, { weight: 500 }), cx + 10 * sc, cy + 32 * sc, { k: 0.7, reveal: show, out, m, tint: DIM });
          state.draw(info, T, s.status, (v, q) => info.put(info.text(v, 13), cx + 10 * sc, cy + 49 * sc, { k: v === '운행 중' ? 0.95 : 1.2, reveal: Math.min(show, q.reveal), out: Math.max(out, q.out), m, tint: v === '운행 중' ? undefined : HOT }));
          ui.live = `${s.id}번 버스 ${s.status}`;
        }
        if (!out && !reduce) { // 데이터 입자: 도로를 따라 흐르다가, 위치를 보고할 때는 해당 버스 쪽으로 모여 들어가고 핀이 반응
          roadArc.forEach((R, r) => { const n = small ? 2 : 4; for (let j = 0; j < n; j++) { const d = ((T * 70 + (j / n) * R.len + r * 97) % R.len); const [x, y] = R.at(d); info.spark(x, y, 0.45); } });
          st.forEach((s, i) => {
            const R = roadArc[roadOf[i]], [bx, by] = poses.apply(ctx.bmsPose[i], ...busBase[i]), sB = R.near(bx, by);
            for (const ta of [s.reportAt]) { const u = (T - (ta - 0.9)) / 0.9; if (u <= 0 || u >= 1) continue; for (let k2 = 0; k2 < 3; k2++) { const [x, y] = R.at(sB - 150 * (1 - ease(Math.max(0, u - k2 * 0.05)))); info.spark(x, y, (1.3 - k2 * 0.35) * Math.min(1, (1 - u) * 6, u * 6)); } }
          });
        }
        ctx.setHighlight(roads[roadOf[BMS.buses.findIndex((b) => b.id === sel)]]);
      },
    };
  }

  // ── BIT ─────────────────────────────────────────────────────────
  function bit() {
    const S = 'bit-3', A = conf.scenes[S].anchors;
    const F = frameOf(A.screen.map(([x, y]) => at(S, x, y)));
    const sig = A.signal.map(([x, y]) => at(S, x, y));
    const pins = A.pins.map(([x, y]) => at(S, x, y)), minis = A.minis.map(([x, y]) => at(S, x, y));
    const slots = new Map();
    const HEAD = 30, ROW = (F.h - HEAD - 52) / 3, LIST0 = HEAD + 6;
    const prog = { '2분': 0.2, '1분': 0.5, '곧 도착': 0.78, '도착': 1 };
    return {
      enter() { slots.clear(); },
      leave() {},
      update(t, ctx) {
        const T = reduce ? 7.4 : t, rows = BIT.state(T), out = ctx.out || 0, scr = rv(t, BIT.screenOn, 0.7);
        const put = (s, x, y, o = {}) => { const [wx, wy] = toWorld(F, x, y); info.put(s, wx, wy, { reveal: scr, m: F.m, ...o, out: Math.max(out, o.out || 0) }); };
        // 머리: 정류장 이름 + 도착 예정
        put(info.text(STOP, 15), 10, 15, { k: 1.05 });
        put(info.text('도착 예정', 10, { weight: 500, align: 'right' }), F.w - 10, 16, { k: 0.7, tint: DIM });
        const [l0x, l0y] = toWorld(F, 8, HEAD), [l1x, l1y] = toWorld(F, F.w - 8, HEAD);
        if (!out) info.line([[l0x, l0y], [l1x, l1y]], { k: 0.35 * scr, step: 2.2 });
        // 목록: 도착 예정 순. 행 위치는 시간표가 계산 (사라짐 → 위로 이동 → 새 행)
        for (const r of rows) {
          if (r.leaving >= 1) continue;
          const y = LIST0 + r.y * ROW, ry = y + ROW / 2;
          const clip = [-1e4, LIST0 - 4 - ry, 1e4, LIST0 + ROW * 3 + 2 - ry]; // 목록 영역 위아래로만 자름
          const base = { out: r.leaving, reveal: Math.min(scr, r.entering) };
          const o = (k, extra) => ({ ...base, k, ...extra });
          if (r.hot) put(info.frame(F.w - 12, ROW - 6, 4), 6, y + 3, o(0.5, { reveal: Math.min(base.reveal, rv(T, 4.8, 0.5)) }));
          put(info.busIcon(13), 17, ry, o(0.8, { clip }));
          put(info.text(r.no, 18, { num: true }), 28, ry - 6, o(1.05, { clip }));
          put(info.text(BUSES[r.no].dir, 9.5, { weight: 500 }), 29, ry + 10, o(0.65, { tint: DIM, clip }));
          if (!slots.has(r.no)) slots.set(r.no, slot());
          slots.get(r.no).draw(info, T, r.eta, (v, q) => put(info.text(v, 16, { align: 'right' }), F.w - 9, ry, o(r.hot ? 1.2 : 1, { clip, reveal: Math.min(base.reveal, q.reveal), out: Math.max(base.out, q.out), tint: r.hot ? HOT : undefined })));
        }
        // 아래: 100번 위치 막대 (도착정보와 같은 단계)
        const by = F.h - 22, r100 = rows.find((x) => x.no === '100');
        const [a0x, a0y] = toWorld(F, 14, by), [a1x, a1y] = toWorld(F, F.w - 14, by);
        if (!out) {
          info.line([[a0x, a0y], [a1x, a1y]], { k: 0.4 * scr, step: 2.6 });
          for (let k = 0; k < 5; k++) { const [x, y] = toWorld(F, 14 + ((F.w - 28) * k) / 4, by); info.ring(x, y, 2.4, 2.4, { k: 0.6 * scr, step: 1.6 }); }
        }
        if (r100 && r100.leaving < 1) {
          const p = prog[r100.eta] ?? 0.2;
          put(info.busIcon(11), 14 + (F.w - 28) * p, by - 9, { k: 1.1, out: r100.leaving, tint: HOT });
        }
        if (out || reduce) return;
        // 바뀌는 행(100번 도착 예정)에 빛 알갱이가 잠깐 모임 → 그 순간 숫자가 바뀜
        for (const ta of BIT.signals) { const q = (T - (ta - 0.7)) / 0.7; const [gx, gy] = toWorld(F, F.w - 34, LIST0 + ROW / 2); gather(info, gx, gy, q, small ? 10 : 18, 80, ta * 10, 1.25); }
        // 갱신 신호: 태양광 패널 → 기둥 → 화면 (도착하는 순간 숫자가 바뀜)
        for (const ta of BIT.signals) {
          const u = (T - (ta - 1.1)) / 1.1; if (u <= 0 || u >= 1) continue;
          for (let k = 0; k < 3; k++) { const f = clamp01(ease(u) - k * 0.05) * (sig.length - 1); const [x, y] = along(sig, f); info.spark(x, y, 1.4 - k * 0.4); }
        }
        // 주변 작은 정류장도 같은 정보를 받음: 갱신 직후 차례로 핀이 반응
        for (const ta of BIT.signals) pins.forEach(([x, y], i) => {
          const q = (T - ta - 0.25 - i * 0.22) / 0.9; if (q < 0 || q >= 1) return;
          info.ring(x, y + 30 * meta.scenes[S].s, 4 + q * 14, 2 + q * 5, { k: (1 - q) * 0.85 });
          info.spark(minis[i][0], minis[i][1], 1.1 * (1 - q));
        });
      },
    };
  }

  // ── BIS ─────────────────────────────────────────────────────────
  function bis() {
    const S = 'bis-4', A = conf.scenes[S].anchors;
    const route = A.phoneRoute.map(([x, y]) => at(S, x, y)), target = route[6];
    const RC = meta.scenes[S].routes?.[0]?.curve, rp = RC ? curvePath(RC, route) : { along: (s) => along(route, s), sub: (a, b) => sub(route, a, b) };
    const cards = A.cards.map(([x0, y0, x1, y1]) => [...at(S, x0, y0), ...at(S, x1, y1)]);
    const txt = slot();
    return {
      enter() { txt.reset(); },
      leave() {},
      update(t, ctx) {
        const T = reduce ? 9 : t, st = BIS.state(T), out = ctx.out || 0, scr = rv(t, BIS.screenOn, 0.7);
        const o = (k, extra) => ({ k, out, reveal: scr, ...extra });
        // 휴대폰 지도: 목표 정류장 + 이름, 201번 위치
        info.put(info.text(STOP, 12), target[0] + 13, target[1] + 2, o(st.arrived ? 1.1 : 0.85, { tint: st.arrived ? HOT : undefined }));
        const [x, y] = rp.along(st.s);
        info.put(info.pin(19), x, y, o(1.1, { tint: HOT }));
        info.put(info.text('201', 11, { num: true, align: 'center' }), x, y - 40, o(0.95));
        if (!out && !reduce) {
          if (st.ripple > 0 && st.ripple < 1) info.ring(target[0], target[1], 7 + st.ripple * 22, 7 + st.ripple * 22, { k: (1 - st.ripple) * 0.9 });
          // 버스 위치에서 정류장까지 남은 구간을 짧게 밝힘 (2.6초마다)
          const lt = (T % 2.6) / 1.2;
          if (!st.arrived && lt < 1) info.line(rp.sub(st.s, 6), { k: 0.9 * Math.sin(lt * Math.PI), step: 3, from: Math.max(0, lt - 0.3), to: lt });
        }
        // 카드 (원본 카드 자리)
        const [c0, c1] = cards, hot = !reduce && ((T - st.updatedAt < 1.4 && st.updatedAt > 0) || st.arrived);
        info.put(info.text(`201 · ${STOP} 방면`, 14), c0[0] + 14, c0[1] + (c0[3] - c0[1]) * 0.34, o(1.05));
        if (!out && !reduce) for (const ta of [2.6, 4.6, 8.1]) gather(info, c0[0] + 60, c0[1] + (c0[3] - c0[1]) * 0.67, (T - (ta - 0.7)) / 0.7, small ? 8 : 16, 80, ta * 13, 1.1); // 도착정보가 바뀌는 자리
        txt.draw(info, T, st.text, (v, q) => info.put(info.text(v, 12, { weight: 600 }), c0[0] + 14, c0[1] + (c0[3] - c0[1]) * 0.67, { k: hot ? 1.2 : 0.9, reveal: Math.min(scr, q.reveal), out: Math.max(out, q.out), tint: hot ? HOT : DIM }));
        info.put(info.text(`305 · ${STOP} 방면`, 14), c1[0] + 14, c1[1] + (c1[3] - c1[1]) * 0.34, o(0.85));
        info.put(info.text('6개 정류장 전 · 6분', 12, { weight: 600 }), c1[0] + 14, c1[1] + (c1[3] - c1[1]) * 0.67, o(0.7, { tint: DIM }));
        ui.live = `201번 ${st.text}`;
      },
    };
  }
}
