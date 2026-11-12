/**
 * 시내버스 표면 위의 입자 목표 좌표를 코드로 생성한다. (외부 모델/이미지 없음)
 *
 * 좌표계: +x = 버스 앞쪽, +y = 위, +z = 오른쪽(승객 출입문 쪽, 카메라가 보는 면)
 * 지면은 y = 0, 버스 중심은 x = 0, z = 0.
 */

// ── 버스 치수 (단위: m 느낌의 월드 단위) ─────────────────────────────
export const BUS = {
  L: 12, // 전장
  W: 2.5, // 전폭
  H: 3.2, // 지붕 높이
  Y0: 0.38, // 차체 하단
  roofR: 0.24, // 지붕 모서리 라운드
  wheelR: 0.54, // 타이어 반지름
  wheelY: 0.54, // 바퀴 중심 높이
  archR: 0.74, // 휠 아치 반지름
  frontWheelX: 3.75,
  rearWheelX: -3.35,
  winY0: 1.58, // 옆 창문 하단
  winY1: 2.8, // 옆 창문 상단
};

const HALF_L = BUS.L / 2;
const HALF_W = BUS.W / 2;

export const KIND_BODY = 0;
export const KIND_WHEEL = 1;
/** 도색 입자: 색은 셰이더 uniform(uPaint), colors 의 r 값은 밝기 배율 */
export const KIND_PAINT = 2;
/** 전조등 입자: 셰이더 uniform(uHead)으로 밝기 변화 */
export const KIND_HEAD = 3;

/** 앞쪽 x 위치(앞면) 기준 전조등 (u = z, v = y) */
export const HEADS = [
  { x0: 0.68, x1: 1.08, y0: 0.62, y1: 0.84 },
  { x0: -1.08, x1: -0.68, y0: 0.62, y1: 0.84 },
];

/** 왼쪽 방향지시등 입자: 셰이더 uniform(uSignal)으로 깜빡임 */
export const KIND_SIGNAL = 4;

/** 방향지시등 램프 중심 (앞·뒤, 좌우). 왼쪽 = -z */
export const SIGNAL_LAMPS = {
  frontLeft: { x: 6.0, y: 0.96, z: -1.0 },
  rearLeft: { x: -6.0, y: 1.22, z: -0.98 },
};

/**
 * LIVE BUS 점 글자 판정: 0 바깥, 1 글자 주변 여백, 2 글자 획
 * @typedef {(x: number, y: number) => number} LogoMask
 */

/**
 * generateBus 결과
 * @typedef {object} BusPoints
 * @property {Float32Array} positions 목표 좌표 (x, y, z) * count
 * @property {Float32Array} colors 입자 색 (r, g, b) * count
 * @property {Float32Array} sizes 입자 크기 배율 * count
 * @property {Float32Array} kinds 입자 종류 (KIND_*)
 * @property {Float32Array} axles 바퀴 입자의 차축 중심 (x, y) * count — 바퀴가 아니면 0
 * @property {number} count
 */

// 앞 출입문 (오른쪽 면, 앞바퀴 앞)
const DOOR = { x0: 4.5, x1: 5.62, y0: BUS.Y0 + 0.04, y1: 2.88 };
// 접이식 문 유리 두 장
const DOOR_GLASS = [
  { x0: 4.6, x1: 5.0, y0: 0.72, y1: 2.76 },
  { x0: 5.12, x1: 5.52, y0: 0.72, y1: 2.76 },
];

/** 일정한 간격의 옆 창문 목록 */
function sideWindows(includeDriver) {
  const start = -5.5;
  const end = 4.3;
  const n = 7;
  const pillar = 0.2;
  const w = (end - start - pillar * (n - 1)) / n;
  const out = [];
  for (let i = 0; i < n; i++) {
    const x0 = start + i * (w + pillar);
    out.push({ x0, x1: x0 + w, y0: BUS.winY0, y1: BUS.winY1 });
  }
  if (includeDriver) {
    // 반대편(운전석 쪽) — 문 대신 운전석 창
    out.push({ x0: 4.5, x1: 5.6, y0: BUS.winY0, y1: BUS.winY1 });
  }
  return out;
}

/** 두 바퀴 사이, 창문 아래 패널의 'LIVE BUS' 로고 영역 (휠 아치 사이라 패널 높이를 다 쓸 수 있음) */
const LOGO_Y0 = BUS.Y0 + 0.14;
const LOGO_Y1 = BUS.winY0 - 0.13;
export const LOGO = {
  cx: (BUS.rearWheelX + BUS.archR + BUS.frontWheelX - BUS.archR) / 2,
  cy: (LOGO_Y0 + LOGO_Y1) / 2,
  w: BUS.frontWheelX - BUS.rearWheelX - BUS.archR * 2 - 0.3,
  h: LOGO_Y1 - LOGO_Y0,
};
/** 앞유리 위 LED 행선지 전광판 (앞면 기준 u = z, v = y) */
export const SIGN = { x0: -0.95, x1: 0.95, y0: 2.88, y1: 3.08 };

const NEAR_WINDOWS = sideWindows(false);
const FAR_WINDOWS = sideWindows(true);
const WHEEL_XS = [BUS.frontWheelX, BUS.rearWheelX];

// ── 시드 고정 난수 ─────────────────────────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// C_BODY(넓은 면) / C_LINE(모서리) 은 생성 시 도색 입자로 바뀐다 → 밝기 배율만 의미
const C_BODY = [0.5, 0.57, 0.68];
const C_LINE = [0.92, 0.97, 1.0];
const PAINT_PANEL = 1.35; // 넓은 패널: 중간 밝기
const PAINT_EDGE = 1.75; // 모서리·테두리: 조금 밝게
const C_WIPER = [0.35, 0.38, 0.42];
const C_GLASS_FRAME = [0.7, 0.71, 0.7]; // 회백색 창틀 (도색보다 튀지 않게)
const C_TIRE = [0.26, 0.28, 0.32]; // 짙은 타이어
const C_TIRE_EDGE = [0.42, 0.45, 0.5];
const C_SPOKE = [1.0, 1.0, 1.0];
const C_MARK = [1.0, 0.85, 0.35]; // 회전이 보이도록 비대칭 표시
const C_SIGN = [1.0, 0.72, 0.32];
const C_HEAD = [1.0, 0.96, 0.85];
const C_TAIL = [1.0, 0.36, 0.3];

function insideRoundRect(x, y, r, rad, pad = 0) {
  const x0 = r.x0 - pad;
  const x1 = r.x1 + pad;
  const y0 = r.y0 - pad;
  const y1 = r.y1 + pad;
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + rad), x1 - rad);
  const cy = Math.min(Math.max(y, y0 + rad), y1 - rad);
  return (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad;
}

function inArch(x, y, pad = 0) {
  for (const wx of WHEEL_XS) {
    if ((x - wx) ** 2 + (y - BUS.wheelY) ** 2 < (BUS.archR + pad) ** 2) return true;
  }
  return false;
}

/**
 * @param {number} total 생성할 입자 수
 * @param {number} [seed] 난수 시드
 * @param {LogoMask} [logoMask] 점 글자 자리를 비울 판정 함수
 * @returns {BusPoints}
 */
export function generateBus(total, seed = 7, logoMask) {
  const rand = mulberry32(seed);
  const rr = (a, b) => a + (b - a) * rand();
  const gauss = () => (rand() + rand() + rand() - 1.5) / 1.5; // 근사 정규분포 (-1..1)

  // 각 부위를 "가중치 + 생성 함수"로 정의한 뒤, 총 입자 수에 맞춰 개수를 배분한다.

  const parts = [];
  // 부위를 정의하는 동안의 "현재 종류/차축" — 각 Part 에 기록된다
  let curKind = KIND_BODY;
  let curAx = 0;
  let curAy = 0;
  const addPart = (p) => parts.push({ ...p, kind: curKind, ax: curAx, ay: curAy });

  // 공통 헬퍼 -------------------------------------------------------
  /** 마스크로 걸러내는 면적 샘플링 */
  const area = (w, sample, color, size = 1) =>
    addPart({
      w,
      gen: (n, emit) => {
        let made = 0;
        let guard = 0;
        while (made < n && guard < n * 60) {
          guard++;
          const p = sample();
          if (!p) continue;
          emit(p, color, size * rr(0.8, 1.15));
          made++;
        }
      },
    });

  /** 폴리라인 위 균일 샘플링 (선 굵기만큼 지터) */
  const line = (w, pts, color, jitter = 0.012, size = 1.05) =>
    addPart({
      w,
      gen: (n, emit) => {
        const segLen = [];
        let totalLen = 0;
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i];
          const b = pts[i + 1];
          const l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
          segLen.push(l);
          totalLen += l;
        }
        for (let k = 0; k < n; k++) {
          // 층화 샘플링으로 선이 끊기지 않고 고르게
          let d = ((k + rand()) / n) * totalLen;
          let i = 0;
          while (i < segLen.length - 1 && d > segLen[i]) {
            d -= segLen[i];
            i++;
          }
          const t = segLen[i] > 0 ? d / segLen[i] : 0;
          const a = pts[i];
          const b = pts[i + 1];
          emit(
            [
              a[0] + (b[0] - a[0]) * t + gauss() * jitter,
              a[1] + (b[1] - a[1]) * t + gauss() * jitter,
              a[2] + (b[2] - a[2]) * t + gauss() * jitter,
            ],
            color,
            size * rr(0.85, 1.15),
          );
        }
      },
    });

  /** 2D(xy 또는 zy) 둥근 사각형 외곽선을 3D 폴리라인으로 */
  const roundRectPath = (r, rad, to3) => {
    const out = [];
    const seg = 5;
    const corners = [
      [r.x1 - rad, r.y1 - rad, 0],
      [r.x0 + rad, r.y1 - rad, Math.PI / 2],
      [r.x0 + rad, r.y0 + rad, Math.PI],
      [r.x1 - rad, r.y0 + rad, (3 * Math.PI) / 2],
    ];
    for (const [cx, cy, a0] of corners) {
      for (let i = 0; i <= seg; i++) {
        const a = a0 + (i / seg) * (Math.PI / 2);
        out.push(to3(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad));
      }
    }
    out.push(out[0]);
    return out;
  };

  const arcPath = (cx, cy, rad, a0, a1, z, seg = 40) => {
    const out = [];
    for (let i = 0; i <= seg; i++) {
      const a = a0 + ((a1 - a0) * i) / seg;
      out.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, z]);
    }
    return out;
  };

  // ── 1. 옆면 (가까운 면 z=+W/2, 먼 면 z=-W/2) ──────────────────────
  const sideTop = BUS.H - BUS.roofR;
  const nearZ = HALF_W;
  const farZ = -HALF_W;

  const sideSample = (z, wins, withDoor) => () => {
    const x = rr(-HALF_L, HALF_L);
    const y = rr(BUS.Y0, sideTop);
    if (inArch(x, y, 0.06)) return null;
    // 점 글자 획과 그 둘레는 비워서 글자가 도색 위에 또렷하게
    if (withDoor && logoMask && logoMask(x, y) > 0) return null;
    for (const w of wins) if (insideRoundRect(x, y, w, 0.12, 0.07)) return null;
    if (withDoor) {
      for (const g of DOOR_GLASS) if (insideRoundRect(x, y, g, 0.06, 0.06)) return null;
      // 문 틈 주변은 약간 비워서 문이 분리돼 보이게
      if (x > DOOR.x0 - 0.05 && x < DOOR.x0 + 0.05 && y < DOOR.y1) return null;
      if (x > DOOR.x1 - 0.05 && x < DOOR.x1 + 0.05 && y < DOOR.y1) return null;
    }
    return [x, y, z];
  };

  area(14, sideSample(nearZ, NEAR_WINDOWS, true), C_BODY, 0.95);
  area(2.6, sideSample(farZ, FAR_WINDOWS, false), C_BODY, 0.85);

  // 창틀: 가까운 면은 촘촘하게 (두 겹 테두리)
  for (const w of NEAR_WINDOWS) {
    line(
      1.35,
      roundRectPath(w, 0.12, (u, v) => [u, v, nearZ + 0.005]),
      C_GLASS_FRAME,
      0.01,
      1.15,
    );
    const outer = { x0: w.x0 - 0.05, x1: w.x1 + 0.05, y0: w.y0 - 0.05, y1: w.y1 + 0.05 };
    line(
      0.7,
      roundRectPath(outer, 0.16, (u, v) => [u, v, nearZ]),
      C_LINE,
      0.008,
      0.9,
    );
  }
  // 먼 면 창틀: 가볍게
  for (const w of FAR_WINDOWS) {
    line(
      0.55,
      roundRectPath(w, 0.12, (u, v) => [u, v, farZ - 0.005]),
      C_GLASS_FRAME,
      0.01,
      0.9,
    );
  }

  // 앞 출입문: 문 테두리 + 유리 테두리 + 가운데 틈
  line(
    1.3,
    roundRectPath(DOOR, 0.06, (u, v) => [u, v, nearZ + 0.01]),
    C_LINE,
    0.008,
    1.1,
  );
  for (const g of DOOR_GLASS) {
    line(
      0.9,
      roundRectPath(g, 0.06, (u, v) => [u, v, nearZ + 0.012]),
      C_GLASS_FRAME,
      0.008,
    );
  }
  line(
    0.35,
    [
      [(DOOR.x0 + DOOR.x1) / 2, DOOR.y0, nearZ + 0.012],
      [(DOOR.x0 + DOOR.x1) / 2, DOOR.y1, nearZ + 0.012],
    ],
    C_LINE,
    0.006,
  );

  // 휠 아치 테두리 (차체 하단 아래로 넘어가는 부분 제외)
  const archA = Math.asin((BUS.Y0 - BUS.wheelY) / BUS.archR); // 음수
  for (const wx of WHEEL_XS) {
    line(1.0, arcPath(wx, BUS.wheelY, BUS.archR, archA, Math.PI - archA, nearZ + 0.01), C_LINE, 0.008, 1.1);
    line(0.45, arcPath(wx, BUS.wheelY, BUS.archR + 0.07, archA, Math.PI - archA, nearZ), C_LINE, 0.008, 0.85);
    line(0.4, arcPath(wx, BUS.wheelY, BUS.archR, archA, Math.PI - archA, farZ - 0.01), C_LINE, 0.01, 0.9);
  }

  // 벨트라인(창문 아래), 하단 스커트 라인 — 아치/문 구간은 끊어서
  const brokenHLine = (y, z, w, skipDoor, col) => {
    const cuts = [];
    if (y < BUS.wheelY + BUS.archR + 0.05) {
      for (const wx of WHEEL_XS) {
        const dy = y - BUS.wheelY;
        const half = Math.sqrt(Math.max(0, (BUS.archR + 0.05) ** 2 - dy * dy));
        cuts.push([wx - half, wx + half]);
      }
    }
    if (skipDoor) cuts.push([DOOR.x0 - 0.04, skipDoor === 'front' ? HALF_L + 1 : DOOR.x1 + 0.04]);
    cuts.sort((a, b) => a[0] - b[0]);
    let x = -HALF_L;
    const segs = [];
    for (const [a, b] of cuts) {
      if (a > x) segs.push([x, a]);
      x = Math.max(x, b);
    }
    if (x < HALF_L) segs.push([x, HALF_L]);
    const totalLen = segs.reduce((s, [a, b]) => s + (b - a), 0);
    for (const [a, b] of segs)
      line(
        (w * (b - a)) / totalLen,
        [
          [a, y, z],
          [b, y, z],
        ],
        col,
        0.008,
      );
  };
  brokenHLine(BUS.Y0 + 0.02, nearZ + 0.004, 0.9, false, C_LINE);
  brokenHLine(BUS.winY1 + 0.16, nearZ + 0.004, 0.5, true, C_LINE);
  brokenHLine(BUS.Y0 + 0.02, farZ - 0.004, 0.45, false, C_LINE);

  // ── 2. 지붕 (둥근 모서리 단면) ─────────────────────────────────
  area(3.0, () => [rr(-HALF_L, HALF_L), BUS.H, rr(-HALF_W + BUS.roofR, HALF_W - BUS.roofR)], C_BODY, 0.85);
  // 지붕 라운드 면
  for (const s of [1, -1]) {
    area(
      s > 0 ? 1.6 : 0.9,
      () => {
        const a = rr(0, Math.PI / 2);
        return [
          rr(-HALF_L, HALF_L),
          sideTop + Math.sin(a) * BUS.roofR,
          s * (HALF_W - BUS.roofR + Math.cos(a) * BUS.roofR),
        ];
      },
      C_LINE,
      0.95,
    );
  }
  // 지붕 위 에어컨/CNG 박스
  const box = { x0: -2.0, x1: 1.4, y0: BUS.H, y1: BUS.H + 0.3, z0: -0.9, z1: 0.9 };
  const boxEdges = [
    [
      [box.x0, box.y1, box.z1],
      [box.x1, box.y1, box.z1],
      [box.x1, box.y1, box.z0],
      [box.x0, box.y1, box.z0],
      [box.x0, box.y1, box.z1],
    ],
    [
      [box.x0, box.y0, box.z1],
      [box.x1, box.y0, box.z1],
    ],
    [
      [box.x0, box.y0, box.z1],
      [box.x0, box.y1, box.z1],
    ],
    [
      [box.x1, box.y0, box.z1],
      [box.x1, box.y1, box.z1],
    ],
    [
      [box.x1, box.y0, box.z0],
      [box.x1, box.y1, box.z0],
    ],
  ];
  boxEdges.forEach((e, i) => line(i === 0 ? 0.7 : 0.18, e, C_LINE, 0.008, 0.95));
  area(0.5, () => [rr(box.x0, box.x1), rr(box.y0, box.y1), box.z1], C_BODY, 0.8);
  area(0.5, () => [rr(box.x0, box.x1), box.y1, rr(box.z0, box.z1)], C_BODY, 0.8);

  // ── 3. 앞면 (x = +L/2) : 앞유리, 행선지 LED, 헤드라이트 ──────────────
  const frontX = HALF_L;
  const WIND = { x0: -1.08, x1: 1.08, y0: 1.18, y1: 2.78 }; // (u=z, v=y)
  area(
    3.6,
    () => {
      const z = rr(-HALF_W, HALF_W);
      const y = rr(BUS.Y0, sideTop);
      if (insideRoundRect(z, y, WIND, 0.14, 0.06)) return null;
      if (insideRoundRect(z, y, SIGN, 0.03, 0.04)) return null;
      for (const h of HEADS) if (insideRoundRect(z, y, h, 0.05, 0.03)) return null;
      return [frontX, y, z];
    },
    C_BODY,
    0.95,
  );
  line(
    1.6,
    roundRectPath(WIND, 0.14, (u, v) => [frontX + 0.005, v, u]),
    C_GLASS_FRAME,
    0.01,
    1.1,
  );
  line(
    0.6,
    roundRectPath({ x0: -1.15, x1: 1.15, y0: 1.11, y1: 2.85 }, 0.18, (u, v) => [frontX, v, u]),
    C_LINE,
    0.008,
    0.9,
  );
  // 와이퍼
  line(
    0.12,
    [
      [frontX + 0.01, 1.24, 0.15],
      [frontX + 0.01, 1.85, -0.35],
    ],
    C_WIPER,
    0.006,
    0.8,
  );
  line(
    0.12,
    [
      [frontX + 0.01, 1.24, -0.75],
      [frontX + 0.01, 1.85, -1.0],
    ],
    C_WIPER,
    0.006,
    0.8,
  );
  // 행선지 LED (채워진 밝은 띠)
  // 전광판 글자는 main.ts 의 CanvasTexture 가 그리고, 입자는 테두리만
  line(
    0.35,
    roundRectPath({ x0: SIGN.x0 - 0.03, x1: SIGN.x1 + 0.03, y0: SIGN.y0 - 0.03, y1: SIGN.y1 + 0.03 }, 0.03, (u, v) => [
      frontX + 0.01,
      v,
      u,
    ]),
    C_SIGN,
    0.004,
    0.8,
  );
  curKind = KIND_HEAD;
  for (const h of HEADS) area(0.6, () => [frontX + 0.01, rr(h.y0, h.y1), rr(h.x0, h.x1)], C_HEAD, 1.0);
  curKind = KIND_BODY;
  // 범퍼
  line(
    0.45,
    [
      [frontX + 0.01, 0.48, -HALF_W],
      [frontX + 0.01, 0.48, HALF_W],
    ],
    C_LINE,
    0.008,
  );
  line(
    0.25,
    [
      [frontX + 0.01, 1.0, -0.5],
      [frontX + 0.01, 1.0, 0.5],
    ],
    C_LINE,
    0.006,
    0.9,
  );

  // ── 4. 뒷면 (x = -L/2) ────────────────────────────────────────
  const rearX = -HALF_L;
  const RWIN = { x0: -0.95, x1: 0.95, y0: 2.0, y1: 2.85 };
  const TAILS = [
    { x0: 0.85, x1: 1.12, y0: 0.62, y1: 1.1 },
    { x0: -1.12, x1: -0.85, y0: 0.62, y1: 1.1 },
  ];
  area(
    1.2,
    () => {
      const z = rr(-HALF_W, HALF_W);
      const y = rr(BUS.Y0, sideTop);
      if (insideRoundRect(z, y, RWIN, 0.1, 0.05)) return null;
      return [rearX, y, z];
    },
    C_BODY,
    0.85,
  );
  line(
    0.6,
    roundRectPath(RWIN, 0.1, (u, v) => [rearX - 0.005, v, u]),
    C_GLASS_FRAME,
    0.01,
  );
  for (const t of TAILS) area(0.3, () => [rearX - 0.01, rr(t.y0, t.y1), rr(t.x0, t.x1)], C_TAIL, 1.05);

  // ── 5. 차체 모서리 (세로 4개, 하단 앞뒤) ─────────────────────────
  for (const x of [HALF_L, -HALF_L]) {
    for (const z of [HALF_W, -HALF_W]) {
      const near = z > 0;
      line(
        near ? 0.5 : 0.3,
        [
          [x, BUS.Y0, z],
          [x, sideTop, z],
        ],
        C_LINE,
        0.01,
        1.05,
      );
    }
    line(
      0.3,
      [
        [x, BUS.Y0, -HALF_W],
        [x, BUS.Y0, HALF_W],
      ],
      C_LINE,
      0.01,
    );
    // 지붕 앞뒤 라운드 테두리
    const prof = [];
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * (Math.PI / 2);
      prof.push([x, sideTop + Math.sin(a) * BUS.roofR, HALF_W - BUS.roofR + Math.cos(a) * BUS.roofR]);
    }
    for (let i = 8; i >= 0; i--) {
      const a = (i / 8) * (Math.PI / 2);
      prof.push([x, sideTop + Math.sin(a) * BUS.roofR, -(HALF_W - BUS.roofR + Math.cos(a) * BUS.roofR)]);
    }
    line(0.45, prof, C_LINE, 0.01);
  }

  // ── 5-1. 방향지시등 (앞·뒤 모서리, 면과 옆으로 감싸듯) ─────────────────
  // 왼쪽(-z)만 깜빡이는 종류, 오른쪽은 꺼진 호박색
  const C_SIGNAL = [1.0, 0.62, 0.12];
  const C_SIGNAL_OFF = [0.42, 0.28, 0.1];
  for (const side of [-1, 1]) {
    curKind = side < 0 ? KIND_SIGNAL : KIND_BODY;
    const col = side < 0 ? C_SIGNAL : C_SIGNAL_OFF;
    const w = side < 0 ? 0.32 : 0.12;
    // 앞
    area(w, () => [HALF_L + 0.012, rr(0.9, 1.02), side * rr(0.8, 1.17)], col, 1.0);
    area(w * 0.5, () => [rr(5.72, 5.98), rr(0.9, 1.02), side * (HALF_W + 0.006)], col, 1.0);
    // 뒤
    area(w, () => [-HALF_L - 0.012, rr(1.15, 1.3), side * rr(0.84, 1.14)], col, 1.0);
    area(w * 0.5, () => [rr(-5.98, -5.72), rr(1.15, 1.3), side * (HALF_W + 0.006)], col, 1.0);
  }
  curKind = KIND_BODY;

  // ── 6. 바퀴: 짙은 타이어 + 밝은 림·스포크 + 비대칭 표시 (각자 차축 기준 회전) ──
  const wheel = (wx, side, scale) => {
    curKind = KIND_WHEEL;
    curAx = wx;
    curAy = BUS.wheelY;
    const zFace = side * (HALF_W - 0.1);
    const zIn = side * (HALF_W - 0.42);
    const R = BUS.wheelR;
    const cy = BUS.wheelY;
    const zf = (d) => zFace + side * d;
    // 타이어 바깥 둘레
    line(0.8 * scale, arcPath(wx, cy, R, 0, Math.PI * 2, zFace, 72), C_TIRE_EDGE, 0.01, 1.1);
    // 타이어 옆면 (짙은 고무 링)
    area(
      0.75 * scale,
      () => {
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(rr(0.38 ** 2, (R - 0.03) ** 2));
        return [wx + Math.cos(a) * r, cy + Math.sin(a) * r, zFace];
      },
      C_TIRE,
      0.9,
    );
    // 림 테두리
    line(0.5 * scale, arcPath(wx, cy, 0.35, 0, Math.PI * 2, zf(0.01), 48), C_LINE, 0.006, 1.0);
    // 허브
    line(0.18 * scale, arcPath(wx, cy, 0.1, 0, Math.PI * 2, zf(0.02), 20), C_LINE, 0.005, 1.0);
    // 짧고 밝은 스포크 5개
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + 0.3;
      const c = Math.cos(a);
      const s2 = Math.sin(a);
      line(
        0.11 * scale,
        [
          [wx + c * 0.12, cy + s2 * 0.12, zf(0.02)],
          [wx + c * 0.33, cy + s2 * 0.33, zf(0.02)],
        ],
        C_SPOKE,
        0.006,
        1.2,
      );
    }
    // 비대칭 표시: 타이어 옆면의 밝은 점 덩어리 + 림 위의 짧은 호
    const ma = 0.3 + Math.PI / 5;
    area(
      0.1 * scale,
      () => {
        const r = rr(0.42, 0.49);
        const a = ma + rr(-0.12, 0.12);
        return [wx + Math.cos(a) * r, cy + Math.sin(a) * r, zf(0.015)];
      },
      C_MARK,
      1.15,
    );
    line(
      0.07 * scale,
      arcPath(wx, cy, 0.4, ma + Math.PI - 0.35, ma + Math.PI + 0.35, zf(0.015), 10),
      C_MARK,
      0.004,
      1.0,
    );
    // 트레드 (원통 면)
    area(
      0.45 * scale,
      () => {
        const a = rand() * Math.PI * 2;
        return [wx + Math.cos(a) * R, cy + Math.sin(a) * R, rr(zIn, zFace)];
      },
      C_TIRE,
      0.85,
    );
    curKind = KIND_BODY;
    curAx = 0;
    curAy = 0;
  };
  for (const wx of WHEEL_XS) {
    wheel(wx, 1, 1.0);
    wheel(wx, -1, 0.4);
  }

  // ── 배분 & 생성 ───────────────────────────────────────────────
  const wSum = parts.reduce((s, p) => s + p.w, 0);
  const counts = parts.map((p) => Math.max(1, Math.round((p.w / wSum) * total)));
  // 반올림 오차는 가장 큰 파트(가까운 옆면)에서 보정
  counts[0] += total - counts.reduce((s, c) => s + c, 0);

  const positions = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  const sizes = new Float32Array(total);
  const kinds = new Float32Array(total);
  const axles = new Float32Array(total * 2);
  let idx = 0;
  let part = parts[0];
  const emit = (p, c, s) => {
    if (idx >= total) return;
    let kind = part.kind;
    // 차체 면/모서리 → 도색 입자 (색은 uPaint, 밝기만 기록)
    if (kind === KIND_BODY && (c === C_BODY || c === C_LINE)) {
      const b = c === C_BODY ? PAINT_PANEL : PAINT_EDGE;
      c = [b, b, b];
      kind = KIND_PAINT;
    }
    positions.set(p, idx * 3);
    colors.set(c, idx * 3);
    sizes[idx] = s;
    kinds[idx] = kind;
    axles[idx * 2] = part.ax;
    axles[idx * 2 + 1] = part.ay;
    idx++;
  };
  parts.forEach((p, i) => {
    part = p;
    p.gen(counts[i], emit);
  });
  part = parts[0];
  // (거의 일어나지 않지만) 마스크 거절로 모자란 경우 가까운 옆면에서 채움
  const fill = sideSample(nearZ, NEAR_WINDOWS, true);
  while (idx < total) {
    const p = fill();
    if (p) emit(p, C_BODY, 0.95);
  }

  return { positions, colors, sizes, kinds, axles, count: total };
}
