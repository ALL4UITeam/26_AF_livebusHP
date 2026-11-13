import { EDGE, LIGHT, SURF } from '../builder.js';

/**
 * 버스 정류장 (단위 m): 바닥 플랫폼, 뒤쪽 투명 가림막 프레임, 왼쪽 안내판, 기둥, 지붕(아래 조명),
 * 오른쪽 벤치, 양옆 나무와 뒤쪽 펜스.
 * +x 오른쪽, +y 위, +z 정류장 앞(도로 쪽).
 * @param {import('../builder.js').PointBuilder} b
 */
export function buildBusStop(b) {
  const roofY = 2.8;
  const back = -1.3; // 가림막 z
  const front = 1.15; // 앞 기둥 z

  // ── 바닥 플랫폼 + 연석 + 젖은 노면 반사 ──
  b.quad([0, 0.12, 0], [1, 0, 0], [0, 0, 1], 9, 3.4, { density: 1.6, b: SURF - 0.05 });
  b.line([-4.5, 0.12, 1.7], [4.5, 0.12, 1.7], { density: 9 });
  b.line([-4.5, 0, 1.75], [4.5, 0, 1.75], { density: 5 });
  b.line([-4.5, 0.12, 1.7], [-4.5, 0.12, -1.7], { density: 3 });
  b.quad([0, 0.0, 3.2], [1, 0, 0], [0, 0, 1], 11, 2.6, { density: 0.9, b: SURF - 0.1 }); // 앞 도로
  // 조명 아래 바닥 반사 (세로 줄무늬)
  for (const x of [-2.4, -0.8, 0.8, 2.4]) {
    b.cloud([x, 0.13, 0.9], [0.06, 0.005, 0.5], { count: 18, b: 0.72 });
  }

  // ── 뒤쪽 투명 가림막: 프레임은 촘촘한 시안 선, 유리는 옅은 점 ──
  const gx0 = -1.95;
  const gx1 = 3.9;
  b.quad([(gx0 + gx1) / 2, 1.35, back], [1, 0, 0], [0, 1, 0], gx1 - gx0, 2.3, { density: 0.9, b: SURF - 0.1 });
  b.rect([(gx0 + gx1) / 2, 1.35, back], [1, 0, 0], [0, 1, 0], gx1 - gx0, 2.3, { density: 9 });
  for (let i = 1; i < 4; i++) {
    const x = gx0 + ((gx1 - gx0) * i) / 4;
    b.line([x, 0.2, back], [x, 2.5, back], { density: 8 });
  }
  b.line([gx0, 0.55, back], [gx1, 0.55, back], { density: 5 }); // 하단 띠
  // 오른쪽 옆 가림막
  b.rect([gx1, 1.35, (back + 0.2) / 2], [0, 0, 1], [0, 1, 0], 1.5, 2.3, { density: 6 });
  b.quad([gx1, 1.35, (back + 0.2) / 2], [0, 0, 1], [0, 1, 0], 1.5, 2.3, { density: 0.6, b: SURF - 0.12 });

  // ── 왼쪽 안내판 (두께 있는 상자 + 화면 + 버스 픽토그램 + 노선 목록) ──
  const sx = -2.85;
  const sz = -0.95;
  b.box([sx, 1.3, sz], [1.5, 2.3, 0.22], { surf: 0.6, edge: 9 });
  const fz = sz + 0.115; // 앞면
  b.roundRect([sx, 1.32, fz], [1, 0, 0], [0, 1, 0], 1.22, 2.0, 0.06, { density: 10 });
  b.quad([sx, 1.32, fz], [1, 0, 0], [0, 1, 0], 1.18, 1.95, { density: 3, b: SURF - 0.08 });
  // 버스 픽토그램 (앞모습)
  b.roundRect([sx, 1.95, fz + 0.01], [1, 0, 0], [0, 1, 0], 0.62, 0.52, 0.1, { density: 22, b: 0.97 });
  b.rect([sx, 2.03, fz + 0.01], [1, 0, 0], [0, 1, 0], 0.46, 0.2, { density: 18, b: 0.95 });
  b.line([sx - 0.31, 1.82, fz + 0.01], [sx + 0.31, 1.82, fz + 0.01], { density: 14, b: 0.95 });
  for (const dx of [-0.2, 0.2]) {
    b.arc([sx + dx, 1.86, fz + 0.01], [1, 0, 0], [0, 1, 0], 0.035, 0, Math.PI * 2, { density: 30, b: LIGHT });
    b.line([sx + dx, 1.69, fz + 0.01], [sx + dx, 1.62, fz + 0.01], { density: 25, b: 0.95 });
  }
  // 노선 목록: 아이콘 + 막대
  for (let i = 0; i < 6; i++) {
    const y = 1.48 - i * 0.16;
    b.rect([sx - 0.42, y, fz + 0.01], [1, 0, 0], [0, 1, 0], 0.13, 0.07, { density: 22, b: 0.92 });
    const len = 0.35 + ((i * 37) % 5) * 0.06;
    b.line([sx - 0.27, y, fz + 0.01], [sx - 0.27 + len, y, fz + 0.01], { density: 22, b: 0.9 });
    b.line([sx + 0.28, y, fz + 0.01], [sx + 0.45, y, fz + 0.01], { density: 18, b: 0.85 });
  }

  // ── 기둥 (앞 2, 뒤 2) ──
  for (const [x, z] of [
    [-4.0, front],
    [4.15, front],
    [-3.7, back],
    [4.0, back],
  ]) {
    b.cylinder([x, 0.12, z], [x, roofY - 0.12, z], 0.09, { surf: 2, edge: 3, lines: 3 });
  }
  // 앞 왼쪽 기둥의 이음매 장식 (레퍼런스의 마디)
  for (let y = 0.6; y < 2.6; y += 0.5) b.arc([-4.0, y, front], [1, 0, 0], [0, 0, 1], 0.11, 0, Math.PI * 2, { density: 6 });

  // ── 지붕: 두께 있는 판 + 앞쪽 처마 + 아래 리브 + 조명 ──
  b.push({ position: [0.1, roofY, -0.05], rotation: [0.04, 0, 0] });
  b.box([0, 0.12, 0], [9.2, 0.24, 3.6], { surf: 1.1, edge: 14 });
  // 지붕 앞 처마(테두리 강조 이중선)
  b.line([-4.6, -0.02, 1.83], [4.6, -0.02, 1.83], { density: 10 });
  // 아래 리브 (앞뒤 방향)
  for (let i = -2; i <= 2; i++) b.line([i * 1.8, -0.01, -1.7], [i * 1.8, -0.01, 1.7], { density: 5, b: 0.78 });
  b.line([-4.5, -0.01, 0], [4.5, -0.01, 0], { density: 4, b: 0.7 });
  // 조명 띠 (빛 번짐)
  for (const x of [-2.55, -0.85, 0.85, 2.55]) {
    b.line([x - 0.45, -0.03, 0.45], [x + 0.45, -0.03, 0.15], { density: 60, b: LIGHT, jitter: 0.012 });
  }
  b.pop();

  // ── 벤치 (오른쪽, 두 칸) ──
  b.push({ position: [1.55, 0, -0.75] });
  const bw = 2.6;
  for (let i = 0; i < 4; i++) b.line([-bw / 2, 0.48, -0.15 + i * 0.1], [bw / 2, 0.48, -0.15 + i * 0.1], { density: 12 });
  b.line([-bw / 2, 0.44, 0.2], [bw / 2, 0.44, 0.2], { density: 14 }); // 앞 모서리
  for (let i = 0; i < 4; i++) {
    const y = 0.62 + i * 0.1;
    b.line([-bw / 2, y, -0.22 - i * 0.025], [bw / 2, y, -0.22 - i * 0.025], { density: 11 });
  }
  for (const x of [-bw / 2, 0, bw / 2]) {
    b.polyline(
      [
        [x, 0.13, 0.12],
        [x, 0.48, 0.12],
        [x, 0.48, -0.2],
        [x, 0.95, -0.3],
      ],
      { density: 12 },
    );
    b.line([x, 0.13, -0.18], [x, 0.48, -0.18], { density: 10 });
    b.polyline(
      [
        [x, 0.48, 0.15],
        [x, 0.66, 0.15],
        [x, 0.66, -0.2],
      ],
      { density: 8 },
    ); // 팔걸이
  }
  b.quad([0, 0.48, 0], [1, 0, 0], [0, 0, 1], bw, 0.38, { density: 4, b: SURF + 0.05 });
  b.pop();

  // ── 나무 (양옆 뒤) + 펜스 ──
  for (const [x, z, s] of [
    [-5.6, -2.4, 1],
    [5.9, -2.2, 1.05],
  ]) {
    b.line([x, 0, z], [x, 2.6 * s, z], { density: 5, b: 0.65 });
    b.line([x, 1.6 * s, z], [x - 0.6 * s, 2.5 * s, z], { density: 4, b: 0.55 });
    b.line([x, 1.8 * s, z], [x + 0.7 * s, 2.7 * s, z], { density: 4, b: 0.55 });
    b.cloud([x, 3.3 * s, z], [1.25 * s, 1.0 * s, 0.9 * s], { count: 90 * s, b: 0.26 });
  }
  b.line([-7, 0.9, -3], [7, 0.9, -3], { density: 3, b: 0.6 });
  b.line([-7, 0.5, -3], [7, 0.5, -3], { density: 2.5, b: 0.55 });
  for (let x = -7; x <= 7; x += 0.7) b.line([x, 0, -3], [x, 0.95, -3], { density: 3, b: 0.5 });
}

/** 왼쪽 앞, 눈높이(지붕 아래)에서 → 지붕 밑면과 벤치 앞면이 함께 보이는 사선 구도 */
export const busStopCamera = {
  target: [0.2, 1.4, 0],
  dir: [-0.95, -0.05, 1],
  fov: 60,
  keyMin: 0.62, // 나무·펜스는 맞춤 계산에서 제외 (정류장 본체 기준)
  fit: 'dist',
  margin: { landscape: [0.86, 0.84], portrait: [0.95, 0.62] },
};
