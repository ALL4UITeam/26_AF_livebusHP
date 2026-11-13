import * as THREE from 'three';
import { EDGE, LIGHT, SURF } from '../builder.js';

/**
 * 굽은 도로 (단위 m): 굽은 3D 경로를 따라 노면, 차선(점선), 가장자리 실선, 양쪽 가드레일,
 * 왼쪽 가로등, 길가 나무, 먼 도시 빌딩. 카메라 가까이에선 넓고 멀수록 좁아지는 원근은
 * 실제 3D 배치와 원근 카메라에서 그대로 나온다.
 * 경로 진행 방향은 -z(화면 안쪽), 오른쪽으로 굽어 들어간다.
 * @param {import('../builder.js').PointBuilder} b
 */
export function buildRoad(b) {
  const curve = new THREE.CatmullRomCurve3(
    [
      [0, 0, 6],
      [0, 0, -6],
      [-1.5, 0, -20],
      [2.5, 0.4, -34],
      [11, 1.2, -44],
      [17, 1.8, -56],
      [15, 2.2, -70],
    ].map((p) => new THREE.Vector3(...p)),
  );
  const L = curve.getLength();
  const W = 11; // 도로 폭 (3차로)
  /** 경로 거리 s, 횡 위치 x(오른쪽 +), 높이 y → 월드 좌표 */
  const at = (s, x, y = 0) => {
    const u = Math.min(1, Math.max(0, s / L));
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u);
    const right = new THREE.Vector3(-t.z, 0, t.x).normalize();
    return [p.x + right.x * x, p.y + y, p.z + right.z * x];
  };
  const along = (x, y, s0 = 0, s1 = L, step = 0.5) => {
    const pts = [];
    for (let s = s0; s <= s1; s += step) pts.push(at(s, x, y));
    return pts;
  };

  // 노면: 경로를 따라 고르게 (먼 곳일수록 화면에서 촘촘해짐)
  b.add(L * W * 5, (n, emit) => {
    for (let i = 0; i < n; i++) {
      const p = at(b.rand() * L, b.r(-W / 2, W / 2), 0);
      emit(new THREE.Vector3(...p), SURF - 0.06 + b.g() * 0.08);
    }
  });

  // 가장자리 실선 + 차선 점선 (가까울수록 넓은 띠: 여러 줄로)
  for (const x of [-W / 2 + 0.3, W / 2 - 0.3]) b.polyline(along(x, 0.01), { density: 7 });
  for (const lane of [-W / 6, W / 6]) {
    for (let s = 1; s < L - 2; s += 7) {
      for (const w of [-0.16, -0.08, 0, 0.08, 0.16]) b.polyline(along(lane + w, 0.01, s, s + 3.8, 0.2), { density: 9, b: 0.95 });
    }
  }

  // 가드레일 (양쪽): 레일 2줄 + 기둥
  for (const side of [-1, 1]) {
    const x = side * (W / 2 + 0.7);
    b.polyline(along(x, 0.95), { density: 6 });
    b.polyline(along(x, 0.6), { density: 4, b: 0.8 });
    for (let s = 0; s < L; s += 2.2) b.line(at(s, x, 0), at(s, x, 1.0), { density: 6, b: 0.8 });
  }

  // 왼쪽 가로등: 기둥 + 도로 쪽으로 휜 팔 + 등(빛 번짐)
  for (let s = 2; s < L - 4; s += 11) {
    const x = -W / 2 - 1.3;
    b.polyline([at(s, x, 0), at(s, x, 7.2), at(s, x + 0.5, 7.7), at(s, x + 1.8, 7.8)], { density: 12 });
    const lamp = at(s, x + 1.9, 7.7);
    b.cloud(lamp, [0.25, 0.08, 0.25], { count: 90, b: LIGHT });
    b.cloud([lamp[0], 0.02, lamp[2]], [1.4, 0.01, 2.2], { count: 40, b: 0.7 }); // 노면에 비친 불빛
  }
  // 오른쪽 먼 곳 가로등 (레퍼런스의 반대편 불빛)
  for (let s = 30; s < L - 4; s += 9) {
    const x = W / 2 + 1.3;
    b.polyline([at(s, x, 0), at(s, x, 6.2), at(s, x - 1.2, 6.5)], { density: 4, b: 0.75 });
    b.cloud(at(s, x - 1.3, 6.4), [0.18, 0.06, 0.18], { count: 22, b: LIGHT });
  }

  // 길가 나무 (양쪽, 가드레일 바깥)
  for (let s = 0; s < L - 6; s += 3.2) {
    for (const side of [-1, 1]) {
      const x = side * (W / 2 + 3 + b.r(0, 3));
      const p = at(s, x, 0);
      const h = b.r(2.5, 4.2);
      b.line(p, [p[0], p[1] + h * 0.6, p[2]], { density: 3, b: 0.5 });
      b.cloud([p[0], p[1] + h, p[2]], [1.3, 1.1, 1.3], { count: 55, b: 0.33 });
    }
  }

  // 먼 도시: 경로 끝 너머의 빌딩 (모서리 + 창문 점)
  const end = at(L, 0, 0);
  const rnd = b.rand;
  for (let i = 0; i < 16; i++) {
    const bx = end[0] - 14 + i * 2.6 + (rnd() - 0.5);
    const bz = end[2] - 10 - rnd() * 14;
    const h = 7 + rnd() * 18 * (i > 6 && i < 12 ? 1.4 : 0.8);
    const w = 1.6 + rnd() * 1.8;
    b.box([bx, end[1] + h / 2, bz], [w, h, w], { surf: 0.25, edge: 4, b: 0.92 });
    // 창문 점 (앞면 격자)
    b.add(w * h * 0.6, (n, emit) => {
      for (let k = 0; k < n; k++) {
        const cx = Math.round(b.r(-0.4, 0.4) * w * 3) / 3;
        const cy = Math.round(b.r(0.05, 0.95) * h * 2.5) / 2.5;
        emit(new THREE.Vector3(bx + cx, end[1] + cy, bz + w / 2 + 0.02), 0.78 + b.rand() * 0.15);
      }
    });
  }
}

/** 도로 가까이 낮은 시점에서 도시 쪽을 내려다봄 */
export const roadCamera = {
  target: [3.5, 2.6, -30],
  position: [-0.3, 3.4, 9],
  fov: 50,
  fit: 'fov',
  keyMin: 0.6, // 노면 점·나무는 맞춤 계산에서 제외 (윤곽·가로등·도시 기준)
  // 카메라 바로 앞 도로는 화면 아래로 흘러나가는 게 자연스러우므로 맞춤에서 제외
  keyFilter: (x, y, z) => z < -6,
  margin: { landscape: [0.8, 0.86], portrait: [0.96, 0.7] },
};
