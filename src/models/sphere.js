import * as THREE from 'three';
import { EDGE, SURF } from '../builder.js';

/** 구체 반지름 — 셰이더의 물결·림 계산에도 사용 */
export const SPHERE_R = 4.5;

/** 전체 입자 중 구체에서 실제로 보이는 비율. 나머지는 구면 위에 숨겨 두었다가 다음 장면으로 갈 때 나타난다. */
const VISIBLE = 0.38;

/**
 * 구체: 구면의 균일한 푸른 점 + 위도·경도를 따라 흐르는 물결 윤곽선 + 바깥의 흩날리는 잔입자.
 * (물결의 흐름·밝기 변화, 앞뒤 깊이감, 밝은 테두리, 커서에 따른 회전은 셰이더에서 계산)
 * 화면에서 작게 보이는 구체가 점으로 뭉개지지 않도록, 장면 공통 입자 수 중 일부만 보이게 쓴다.
 * @param {import('../builder.js').PointBuilder} b
 */
export function buildSphere(b) {
  const R = SPHERE_R;
  // 구면 점
  b.sphere([0, 0, 0], R, { density: 4.2, b: SURF + 0.06 });

  // 물결 윤곽선: 위도가 경도에 따라 출렁이는 곡선 여러 줄
  for (let k = 0; k < 11; k++) {
    const base = -1.15 + (k / 10) * 2.3; // 위도 (라디안)
    const amp = 0.16 + 0.1 * Math.sin(k * 1.7);
    const freq = 2 + (k % 3);
    const ph = k * 0.9;
    const pts = [];
    for (let i = 0; i <= 160; i++) {
      const lon = (i / 160) * Math.PI * 2;
      const lat = base + amp * Math.sin(freq * lon + ph) + 0.06 * Math.sin(5 * lon - ph);
      const c = Math.cos(lat);
      pts.push([R * c * Math.cos(lon), R * Math.sin(lat), R * c * Math.sin(lon)]);
    }
    b.polyline(pts, { density: 1.0, b: 0.66 + (k % 3) * 0.05, jitter: 0.015 });
  }

  // 큰 S 자 물결 띠 두 줄 (레퍼런스의 밝은 대각 흐름)
  for (const s of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 200; i++) {
      const lon = (i / 200) * Math.PI * 2;
      const lat = s * 0.35 + 0.55 * Math.sin(lon + s * 0.8);
      const c = Math.cos(lat);
      pts.push([R * 1.005 * c * Math.cos(lon), R * 1.005 * Math.sin(lat), R * 1.005 * c * Math.sin(lon)]);
    }
    b.polyline(pts, { density: 2, b: EDGE, jitter: 0.015 });
  }

  // 바깥으로 흩날리는 잔입자 (구에서 멀어질수록 드묾)
  b.add(R * R * 14, (n, emit) => {
    for (let i = 0; i < n; i++) {
      const u = b.r(-1, 1);
      const a = b.rand() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const rr = R * (1.03 + Math.pow(b.rand(), 2.2) * 0.65);
      emit(new THREE.Vector3(s * Math.cos(a) * rr, u * rr, s * Math.sin(a) * rr), 0.14 + b.rand() * 0.14);
    }
  });

  // 숨겨 둔 예비 입자 (밝기 0): 구면 위에 고르게
  const visW = b.parts.reduce((s, p) => s + p.w, 0);
  b.add((visW * (1 - VISIBLE)) / VISIBLE, (n, emit) => {
    for (let i = 0; i < n; i++) {
      const u = b.r(-1, 1);
      const a = b.rand() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      emit(new THREE.Vector3(s * Math.cos(a) * R, u * R, s * Math.sin(a) * R), 0);
    }
  });
}

/**
 * 정면 구도. 크기는 '화면 너비 대비 구체 지름'으로 맞춘다.
 * 레퍼런스(스컹크웍스 메인 첫 화면)를 같은 뷰포트에서 잰 값:
 *   1440×900 에서 약 0.35~0.4, 390×844 에서 약 0.8~0.9
 * 바깥 잔입자는 지름 계산에서 제외 (윤곽 기준).
 */
export const sphereCamera = {
  target: [0, 0, 0],
  dir: [0, 0.06, 1],
  fov: 34,
  fit: 'diameter',
  diameter: { landscape: 0.36, portrait: 0.8 }, // 화면 너비 대비
  maxHeight: 0.6, // 화면 높이 대비 상한 (가로로 아주 넓은 화면)
  sway: 0, // 구체는 커서로 반응하므로 자동 옆 이동 없음
  margin: { landscape: [0.9, 0.8], portrait: [0.86, 0.6] },
};
