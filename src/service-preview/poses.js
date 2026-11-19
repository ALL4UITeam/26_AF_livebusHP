/**
 * 움직이는 물체(버스)의 자세 — main.js(점)와 overlays.js(전광판 글자·핀)가 같은 값을 쓴다.
 * 좌표는 무대(1600×900). 자세 = 기준점(ax, ay) 둘레로 배율 sc, 그다음 (dx, dy) 이동.
 */
export function makePoses(meta, conf) {
  const tr = (scene) => meta.scenes[scene];
  const at = (scene, x, y) => { const s = tr(scene); return [x * s.s + s.ox, y * s.s + s.oy]; };
  const L = conf.scenes['libus-1'], B = conf.scenes['bms-2'];
  // LIVEBUS: 도로 소실점(버스 차체 윤곽선이 모이는 쪽)을 중심으로 축소 → 멀어지면 작아지면서 도로 안쪽으로 (원근 일치)
  const lbVP = at('libus-1', ...(L.anchors.vp || [2950, 1170]));
  const lbFar = L.anchors.far || 0.8;
  const bmsDir = B.roadDir, bmsS = tr('bms-2').s;
  const bmsAnchors = B.busAnchors.map(([x, y]) => at('bms-2', x, y));

  return {
    at,
    /** LIVEBUS 바퀴 (무대 좌표, 정차 위치 기준 타원): 측면에서 비스듬히 보여 가로가 좁은 타원 */
    wheels: (L.anchors.wheels || []).map(([x, y, rx, ry]) => { const [cx, cy] = at('libus-1', x, y), s = tr('libus-1').s; return { cx, cy, rx: rx * s, ry: ry * s }; }),
    /** 바퀴 회전각: 버스가 실제로 이동한 거리 ÷ 바퀴 반지름 (정차하면 멈춤). 앞으로(왼쪽) 갈 때 바퀴 윗부분이 앞으로 → 음의 각 */
    wheelAngle(u) {
      const A = at('libus-1', 1400, 1330), P = this.livebus(1), far = this.apply(P, A[0], A[1]);
      const D = Math.hypot(far[0] - A[0], far[1] - A[1]), R = (L.anchors.wheels?.[0]?.[3] || 40) * tr('libus-1').s * (1 + lbFar) / 2;
      return -(D * (1 - Math.max(0, Math.min(1, u)))) / R;
    },
    /** LIVEBUS 버스: u = 1 멀리 → 0 정류장(원본 위치) */
    livebus(u) {
      return { ax: lbVP[0], ay: lbVP[1], sc: 1 - (1 - lbFar) * Math.max(0, u), dx: 0, dy: 0 };
    },
    /** BMS 버스 i: off = 진행 방향 이동량 (원본 px) */
    bms(i, off) {
      const a = bmsAnchors[i];
      return { ax: a[0], ay: a[1], sc: 1, dx: bmsDir[0] * off * bmsS, dy: bmsDir[1] * off * bmsS };
    },
    apply(p, x, y) { return [p.ax + (x - p.ax) * p.sc + p.dx, p.ay + (y - p.ay) * p.sc + p.dy]; },
  };
}
