import * as THREE from 'three';
import { EDGE, LIGHT, SURF } from '../builder.js';

/**
 * 시내버스 (단위 m): 차체(둥근 모서리), 지붕 위 장치, 앞유리·행선지판, 옆 창문과 창틀,
 * 앞·중간 출입문, 바퀴(타이어·림·스포크)와 휠 아치, 사이드미러, 전조등·그릴·번호판, 바닥 반사.
 * +x 앞, +y 위, +z 오른쪽(출입문 쪽, 카메라 쪽).
 * @param {import('../builder.js').PointBuilder} b
 */
export function buildBus(b) {
  const L = 12;
  const W = 2.55;
  const H = 3.25;
  const Y0 = 0.38;
  const hx = L / 2;
  const hz = W / 2;
  const wheelR = 0.52;
  const wheels = [3.55, -3.35];
  const archR = 0.72;

  const inArch = (x, y) => wheels.some((wx) => (x - wx) ** 2 + (y - wheelR) ** 2 < archR ** 2);
  const winY0 = 1.45;
  const winY1 = 2.7;
  // 오른쪽(카메라 쪽) 옆면의 열린 부분: 창문·출입문
  const doors = [
    { x0: 4.15, x1: 5.45 },
    { x0: -1.65, x1: -0.45 },
  ];
  const winSegs = [
    [-5.55, -1.85, 3],
    [-0.25, 3.95, 4],
  ];
  const windows = [];
  for (const [a, c, n] of winSegs) {
    const gap = 0.14;
    const w = (c - a - gap * (n - 1)) / n;
    for (let i = 0; i < n; i++) windows.push({ x0: a + i * (w + gap), x1: a + i * (w + gap) + w });
  }
  const isOpen = (x, y) =>
    (y > winY0 - 0.04 && y < winY1 + 0.04 && windows.some((w) => x > w.x0 - 0.04 && x < w.x1 + 0.04)) ||
    doors.some((d) => x > d.x0 - 0.04 && x < d.x1 + 0.04 && y < winY1 + 0.08);

  // ── 차체 면 (옆면 두 개, 지붕, 뒷면, 앞면 아래쪽) ──
  for (const side of [1, -1]) {
    b.quad([0, (Y0 + H) / 2, side * hz], [1, 0, 0], [0, 1, 0], L, H - Y0, {
      density: side > 0 ? 4.5 : 1.8,
      mask: (x, y) => !inArch(x, y + (Y0 + H) / 2) && (side < 0 || !isOpen(x, y + (Y0 + H) / 2)),
    });
  }
  b.quad([0, H, 0], [1, 0, 0], [0, 0, 1], L, W, { density: 2.5 });
  b.quad([-hx, (Y0 + H) / 2, 0], [0, 0, 1], [0, 1, 0], W, H - Y0, { density: 1.5 });
  b.quad([hx, (Y0 + 1.15) / 2, 0], [0, 0, 1], [0, 1, 0], W, 1.15 - Y0, { density: 4 });

  // ── 차체 윤곽 (둥근 지붕 모서리 + 세로 모서리 + 하단) ──
  const rr = 0.28;
  for (const side of [1, -1]) {
    const z = side * hz;
    const d = side > 0 ? 12 : 5;
    b.line([-hx + rr, H, z - side * 0.02], [hx - rr, H, z - side * 0.02], { density: d });
    b.line([-hx, H - rr, z], [hx, H - rr, z], { density: d * 0.6 });
    b.line([-hx, Y0, z], [hx, Y0, z], { density: d * 0.8 });
    b.line([-hx, Y0, z], [-hx, H - rr, z], { density: d });
    b.line([hx, Y0, z], [hx, H - rr, z], { density: d * 1.2 });
    b.arc([hx - rr, H - rr, z], [1, 0, 0], [0, 1, 0], rr, 0, Math.PI / 2, { density: d });
    b.arc([-hx + rr, H - rr, z], [1, 0, 0], [0, 1, 0], rr, Math.PI / 2, Math.PI, { density: d });
  }
  b.line([hx, H - 0.02, -hz + 0.1], [hx, H - 0.02, hz - 0.1], { density: 10 });
  b.line([-hx, H - 0.02, -hz + 0.1], [-hx, H - 0.02, hz - 0.1], { density: 6 });
  b.line([hx, Y0, -hz], [hx, Y0, hz], { density: 10 });

  // ── 지붕 위 장치 (에어컨·배터리 팩) ──
  for (const [x, len] of [
    [-3.4, 2.4],
    [0.6, 3.2],
  ]) {
    b.push({ position: [x, H + 0.18, 0] });
    b.roundRect([0, 0, 0.75], [1, 0, 0], [0, 1, 0], len, 0.38, 0.15, { density: 8 });
    b.roundRect([0, 0, -0.75], [1, 0, 0], [0, 1, 0], len, 0.38, 0.15, { density: 4 });
    b.quad([0, 0.19, 0], [1, 0, 0], [0, 0, 1], len - 0.2, 1.5, { density: 2.5 });
    b.line([-len / 2 + 0.15, 0.19, 0.75], [-len / 2 + 0.15, 0.19, -0.75], { density: 5 });
    b.line([len / 2 - 0.15, 0.19, 0.75], [len / 2 - 0.15, 0.19, -0.75], { density: 5 });
    b.pop();
  }

  // ── 옆 창문 (창틀 촘촘히) + 가운데 가로 창틀 ──
  for (const side of [1, -1]) {
    const z = side * (hz + 0.005);
    const d = side > 0 ? 14 : 4;
    for (const w of windows) {
      b.roundRect([(w.x0 + w.x1) / 2, (winY0 + winY1) / 2, z], [1, 0, 0], [0, 1, 0], w.x1 - w.x0, winY1 - winY0, 0.08, {
        density: d,
        b: side > 0 ? EDGE + 0.04 : 0.62,
      });
      if (side > 0) b.line([w.x0, winY0 + 0.75, z], [w.x1, winY0 + 0.75, z], { density: 8, b: 0.8 });
    }
  }
  // 창문 위아래 띠
  b.line([-hx, winY1 + 0.14, hz + 0.004], [hx, winY1 + 0.14, hz + 0.004], { density: 6, b: 0.8 });
  b.line([-hx, winY0 - 0.12, hz + 0.004], [3.98, winY0 - 0.12, hz + 0.004], { density: 6, b: 0.8 });

  // ── 출입문: 문틀 + 접이식 유리 두 장 ──
  for (const d of doors) {
    const z = hz + 0.01;
    const cx = (d.x0 + d.x1) / 2;
    b.rect([cx, (Y0 + 0.05 + winY1 + 0.08) / 2, z], [1, 0, 0], [0, 1, 0], d.x1 - d.x0, winY1 + 0.03 - Y0, { density: 16 });
    const half = (d.x1 - d.x0) / 2;
    for (const s of [-1, 1]) {
      const gx = cx + (s * half) / 2;
      b.roundRect([gx, 1.55, z + 0.005], [1, 0, 0], [0, 1, 0], half - 0.14, 1.95, 0.05, { density: 12, b: 0.86 });
      b.line([gx - half / 2 + 0.1, 1.0, z + 0.005], [gx + half / 2 - 0.1, 1.0, z + 0.005], { density: 8, b: 0.75 });
    }
    b.line([cx, Y0 + 0.05, z + 0.01], [cx, winY1 + 0.05, z + 0.01], { density: 10 });
  }

  // ── 앞면: 큰 앞유리 + 행선지판 + 전조등 + 그릴·엠블럼 + 번호판 + 범퍼 ──
  b.push({ position: [hx + 0.01, 0, 0] });
  const F = (y, z) => [0, y, z];
  b.roundRect(F(2.0, 0), [0, 0, -1], [0, 1, 0], 2.3, 1.55, 0.18, { density: 16 }); // 앞유리
  b.line(F(1.95, -0.05), F(2.65, -0.05), { density: 2, b: 0.6 });
  b.roundRect(F(2.95, 0), [0, 0, -1], [0, 1, 0], 1.9, 0.26, 0.05, { density: 16 }); // 행선지판 테두리
  b.quad(F(2.95, 0), [0, 0, 1], [0, 1, 0], 1.8, 0.18, { density: 25, b: 0.9 });
  // 와이퍼
  b.line(F(1.28, 0.3), F(1.95, -0.25), { density: 5, b: 0.7 });
  b.line(F(1.28, -0.65), F(1.9, -1.0), { density: 5, b: 0.7 });
  // 전조등 (양쪽 아래 모서리) — 렌즈 테두리 + 밝은 심
  for (const s of [1, -1]) {
    b.roundRect(F(0.82, s * 0.92), [0, 0, -1], [0, 1, 0], 0.55, 0.26, 0.1, { density: 20, b: 0.95 });
    for (const dz of [0.1, -0.12]) b.cloud(F(0.83, s * (0.92 + dz)), [0.004, 0.035, 0.035], { count: 26, b: LIGHT });
    b.cloud(F(0.55, s * 0.95), [0.003, 0.025, 0.06], { count: 14, b: LIGHT }); // 안개등
  }
  b.arc(F(0.92, 0), [0, 0, 1], [0, 1, 0], 0.1, 0, Math.PI * 2, { density: 22, b: 0.95 }); // 엠블럼
  for (const y of [0.72, 0.62]) b.line(F(y, -0.55), F(y, 0.55), { density: 8, b: 0.75 }); // 그릴
  b.rect(F(0.42, 0), [0, 0, 1], [0, 1, 0], 0.62, 0.15, { density: 18, b: 0.9 }); // 번호판
  b.line(F(Y0 + 0.08, -hz), F(Y0 + 0.08, hz), { density: 10 }); // 범퍼
  b.line(F(1.15, -hz), F(1.15, hz), { density: 6, b: 0.8 });
  b.pop();

  // ── 바퀴: 타이어(짙은 점) + 바깥 원(윤곽) + 림 + 스포크, 휠 아치 ──
  for (const wx of wheels) {
    for (const side of [1, -1]) {
      const z = side * (hz - 0.08);
      const d = side > 0 ? 1 : 0.15;
      b.arc([wx, wheelR, z], [1, 0, 0], [0, 1, 0], wheelR, 0, Math.PI * 2, { density: 22 * d });
      b.arc([wx, wheelR, z - side * 0.28], [1, 0, 0], [0, 1, 0], wheelR, Math.PI * 0.9, Math.PI * 2.1, { density: 8 * d, b: 0.6 });
      b.arc([wx, wheelR, z + side * 0.01], [1, 0, 0], [0, 1, 0], 0.32, 0, Math.PI * 2, { density: 18 * d });
      b.arc([wx, wheelR, z + side * 0.02], [1, 0, 0], [0, 1, 0], 0.1, 0, Math.PI * 2, { density: 22 * d, b: 0.95 });
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        b.line(
          [wx + Math.cos(a) * 0.12, wheelR + Math.sin(a) * 0.12, z + side * 0.02],
          [wx + Math.cos(a) * 0.3, wheelR + Math.sin(a) * 0.3, z + side * 0.02],
          { density: 16 * d, b: 0.85 },
        );
      }
      // 타이어 고무 (짙은 점)
      b.add(3 * d, (n, emit) => {
        for (let i = 0; i < n; i++) {
          const a = b.rand() * Math.PI * 2;
          const r = b.r(0.34, wheelR);
          emit(new THREE.Vector3(wx + Math.cos(a) * r, wheelR + Math.sin(a) * r, z), 0.22);
        }
      });
      const a0 = Math.asin((Y0 - wheelR) / archR);
      b.arc([wx, wheelR, side * (hz + 0.005)], [1, 0, 0], [0, 1, 0], archR, a0, Math.PI - a0, { density: 14 * d });
    }
  }

  // ── 사이드미러: 앞 위 모서리에서 앞으로 뻗은 팔 + 세로로 긴 거울 ──
  for (const s of [1, -1]) {
    const z0 = s * hz;
    b.polyline(
      [
        [hx - 0.1, 2.75, z0],
        [hx + 0.35, 2.85, z0 + s * 0.15],
        [hx + 0.55, 2.7, z0 + s * 0.32],
      ],
      { density: 16 },
    );
    b.roundRect([hx + 0.58, 2.25, z0 + s * 0.36], [0, 0, 1], [0, 1, 0], 0.2, 0.6, 0.07, { density: 22, b: 0.95 });
    b.quad([hx + 0.58, 2.25, z0 + s * 0.36], [0, 0, 1], [0, 1, 0], 0.16, 0.56, { density: 18 });
  }

  // ── 바닥 반사·먼지 점 (버스 아래 타원) ──
  b.add(55, (n, emit) => {
    for (let i = 0; i < n; i++) {
      const a = b.rand() * Math.PI * 2;
      const r = Math.sqrt(b.rand());
      emit(new THREE.Vector3(Math.cos(a) * r * 8, 0.01, Math.sin(a) * r * 3.2 + 0.4), 0.2 + b.rand() * 0.25);
    }
  });
  for (const s of [1, -1]) b.cloud([hx + 0.6, 0.01, s * 0.92], [0.5, 0.002, 0.12], { count: 10, b: 0.8 });
}

/** 앞오른쪽 사선: 전면과 출입문 쪽 측면이 함께 */
export const busCamera = {
  target: [0.6, 1.6, 0],
  dir: [1.2, 0.22, 1],
  fov: 34,
  fit: 'dist',
  margin: { landscape: [0.84, 0.78], portrait: [0.95, 0.6] },
};
