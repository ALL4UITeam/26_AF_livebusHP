/**
 * 장면 이미지(PNG)에서 "점" 하나하나의 위치와 색을 뽑는다.
 *
 * 원본 이미지는 작은 빛 점들로 그려져 있으므로, 점의 중심(국소 최대 밝기)을 그대로 파티클 자리로 쓴다.
 * 1. 밝기 = RGB 중 가장 밝은 채널. 아주 약하게 흐려서(3×3) 노이즈를 줄인다.
 * 2. 3×3 이웃 중 가장 밝은 픽셀(국소 최대)이면서 밝기 > 45 → 점 하나.
 * 3. 선·램프처럼 밝게 이어진 부분은 점만으로는 성겨서, 밝은 픽셀을 일정 확률로 더 뽑는다.
 * 결과 좌표는 원본 이미지 픽셀 단위(왼쪽 위 0,0)이고 색은 그 픽셀의 RGB(0~1)다.
 */

const DOT_MIN = 45; // 점으로 인정할 최소 밝기 (0~255)
const MID = { min: 110, max: 200, p: 0.06 }; // 중간 밝기 픽셀 추가 샘플 확률
const HI = { min: 200, p: 0.3 }; // 아주 밝은 픽셀(선·램프) 추가 샘플 확률

/** 시드 고정 난수 — 새로고침해도 같은 점 배치 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/**
 * @param {HTMLImageElement} img
 * @param {number} seed
 * @returns {{ width: number, height: number, x: Float32Array, y: Float32Array, rgb: Float32Array, count: number }}
 */
export function sampleDots(img, seed) {
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, W, H).data;

  const lum = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const a = px[i * 4 + 3] / 255;
    lum[i] = Math.max(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]) * a;
  }

  // 약한 가우시안(σ≈0.6) 3×3, 가로·세로 분리
  const K0 = 0.668, K1 = 0.166;
  const tmp = new Float32Array(W * H);
  const sm = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      tmp[i] = lum[i] * K0 + (lum[i - (x > 0)] + lum[i + (x < W - 1)]) * K1;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      sm[i] = tmp[i] * K0 + (tmp[y > 0 ? i - W : i] + tmp[y < H - 1 ? i + W : i]) * K1;
    }
  }

  const rand = mulberry32(seed);
  const xs = [];
  const ys = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const v = sm[i];
      if (v > DOT_MIN) {
        let isMax = true;
        for (let dy = -1; dy <= 1 && isMax; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= H) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= W) continue;
            if (sm[yy * W + xx] > v) { isMax = false; break; }
          }
        }
        if (isMax) { xs.push(x); ys.push(y); }
      }
      const l = lum[i];
      if ((l > MID.min && l <= MID.max && rand() < MID.p) || (l > HI.min && rand() < HI.p)) {
        xs.push(x);
        ys.push(y);
      }
    }
  }

  const n = xs.length;
  const out = { width: W, height: H, count: n, x: new Float32Array(n), y: new Float32Array(n), rgb: new Float32Array(n * 3) };
  for (let k = 0; k < n; k++) {
    const i = ys[k] * W + xs[k];
    out.x[k] = xs[k] + 0.5;
    out.y[k] = ys[k] + 0.5;
    out.rgb[k * 3] = px[i * 4] / 255;
    out.rgb[k * 3 + 1] = px[i * 4 + 1] / 255;
    out.rgb[k * 3 + 2] = px[i * 4 + 2] / 255;
  }
  return out;
}

/**
 * 장면마다 점 개수가 다르므로 가장 많은 개수 N 에 맞춘다.
 * 모자란 자리는 그 장면의 기존 점 위치에 "보이지 않는 점(색 0)"으로 채우고,
 * 장면 사이 짝짓기는 무작위로 섞는다 → 전환 때 점이 고르게 흩어졌다가 모인다.
 */
export function equalize(list, seed) {
  const N = Math.max(...list.map((s) => s.count));
  const rand = mulberry32(seed);
  const scenes = list.map((s) => {
    const xy = new Float32Array(N * 2);
    const col = new Float32Array(N * 3);
    const order = new Uint32Array(N);
    for (let i = 0; i < N; i++) order[i] = i;
    for (let i = N - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = order[i]; order[i] = order[j]; order[j] = t;
    }
    for (let i = 0; i < N; i++) {
      const dst = order[i];
      const src = i < s.count ? i : Math.floor(rand() * s.count);
      xy[dst * 2] = s.x[src];
      xy[dst * 2 + 1] = s.y[src];
      if (i < s.count) {
        col[dst * 3] = s.rgb[src * 3];
        col[dst * 3 + 1] = s.rgb[src * 3 + 1];
        col[dst * 3 + 2] = s.rgb[src * 3 + 2];
      }
    }
    return { xy, col };
  });
  return { N, scenes };
}

// ─────────────────────────────────────────────────────────────────
// 네모난 경계 지우기
// ─────────────────────────────────────────────────────────────────

/** 부드러운 2D 값 노이즈 (0~1) — 경계를 불규칙하게 */
function makeNoise(seed) {
  const h = (x, y) => {
    let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const s = (t) => t * t * (3 - 2 * t);
  const v = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = s(x - xi), yf = s(y - yi);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
  return (x, y, scale) => 0.65 * v(x / scale, y / scale) + 0.35 * v(x / (scale * 0.4) + 17.3, y / (scale * 0.4) - 9.1);
}

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * 이미지 장면의 점 가장자리를 녹인다.
 *  1. 점이 깔린 영역(사각형)의 경계에서 안쪽으로 margin 만큼, 노이즈로 들쭉날쭉하게
 *     흐린 점은 밀도·밝기를 줄이고, 윤곽(밝은 점)은 더 좁은 폭에서만 살짝 줄인다.
 *  2. 장면별 흐름 방향(cfg.flow)을 따라 경계 밖으로 흐린 점을 흩뿌린다.
 *     버스 = 노면을 따라 좌우, 정류장 = 나뭇잎 주변, 도로 = 소실점에서 차선 원근을 따라 바깥으로.
 * @param {ReturnType<typeof sampleDots>} d
 * @param {{ margin: number, flow: (x:number,y:number,box:object)=>null|{dx:number,dy:number,w:number}, spread: number, seed: number }} cfg
 */
export function featherScene(d, cfg) {
  const rand = mulberry32(cfg.seed);
  const noise = makeNoise(cfg.seed);
  // 점 영역: 0.3~99.7 백분위
  const xs = Array.from(d.x).sort((a, b) => a - b), ys = Array.from(d.y).sort((a, b) => a - b);
  const q = (a, p) => a[Math.floor((a.length - 1) * p)];
  const box = { x0: q(xs, 0.003), x1: q(xs, 0.997), y0: q(ys, 0.003), y1: q(ys, 0.997) };
  box.cx = (box.x0 + box.x1) / 2; box.cy = (box.y0 + box.y1) / 2; box.w = box.x1 - box.x0; box.h = box.y1 - box.y0;
  const M = cfg.margin;

  const ox = [], oy = [], oc = [];
  const push = (x, y, r, g, b) => { ox.push(x); oy.push(y); oc.push(r, g, b); };
  for (let i = 0; i < d.count; i++) {
    const x = d.x[i], y = d.y[i];
    const r = d.rgb[i * 3], g = d.rgb[i * 3 + 1], b = d.rgb[i * 3 + 2];
    const lum = Math.max(r, g, b);
    // 사각형 경계까지 거리 + 모서리를 둥글게 깎는 거리(초타원) 중 작은 값 → 네 귀퉁이가 먼저 녹음
    const ux = Math.abs(x - box.cx) / (box.w / 2), uy = Math.abs(y - box.cy) / (box.h / 2);
    const eRound = (1 - Math.cbrt(ux * ux * ux + uy * uy * uy)) * Math.min(box.w, box.h) * 0.5 * 1.6;
    const e = Math.min(x - box.x0, box.x1 - x, y - box.y0, box.y1 - y, eRound);
    const n = noise(x, y, 70);
    const reach = M * (0.35 + 1.1 * n); // 경계에서 녹는 폭 (불규칙)
    const outline = sstep(0.55, 0.8, lum); // 1 = 윤곽(밝은 선)
    const f = sstep(0, reach, e);
    const fLine = sstep(0, reach * 0.75, e);
    const keep = outline > 0.5 ? 0.12 + 0.88 * fLine : Math.pow(f, 1.4);
    if (rand() > keep) continue;
    const k = outline > 0.5 ? 0.4 + 0.6 * fLine : 0.35 + 0.65 * f;
    push(x, y, r * k, g * k, b * k);

    // 경계 근처의 흐린 점 → 흐름 방향을 따라 바깥으로 흩뿌림
    if (e < M * 1.2 && outline < 0.5) {
      const fl = cfg.flow(x, y, box);
      if (!fl || rand() > fl.w * cfg.spread) continue;
      const copies = 1 + (rand() < 0.4 ? 1 : 0);
      for (let c = 0; c < copies; c++) {
        const s = M * (0.15 + 2.0 * Math.pow(rand(), 1.6));
        const jx = (rand() - 0.5) * 0.5, jy = (rand() - 0.5) * 0.5;
        const nx = x + (fl.dx + jx * Math.abs(fl.dy) + jx * 0.2) * s;
        const ny = y + (fl.dy + jy * Math.abs(fl.dx) + jy * 0.2) * s;
        const fade = 0.7 * Math.exp(-s / (M * 1.0)) * (0.6 + 0.4 * noise(nx, ny, 40));
        push(nx, ny, r * fade + 0.01, g * fade + 0.02, b * fade + 0.04);
      }
    }
  }
  const nn = ox.length;
  const out = { width: d.width, height: d.height, count: nn, x: new Float32Array(ox), y: new Float32Array(oy), rgb: new Float32Array(oc), box };
  return out;
}

/** 장면별 흩어지는 방향 */
export const FLOWS = {
  // 버스: 아래쪽 노면 띠에서는 좌우로 길게, 나머지는 중심에서 바깥으로 약하게
  bus: (x, y, b) => {
    const floor = y > b.y1 - b.h * 0.2;
    if (floor) { const s = Math.sign(x - b.cx) || 1; return { dx: s, dy: 0.08, w: 1 }; }
    const dx = x - b.cx, dy = (y - b.cy) * 1.4, l = Math.hypot(dx, dy) || 1;
    return { dx: dx / l, dy: dy / l, w: 0.35 };
  },
  // 정류장: 좌우 위쪽 나뭇잎 부근에서 많이, 바닥은 좌우로, 나머지는 적게
  'bus-stop': (x, y, b) => {
    const side = Math.abs(x - b.cx) > b.w * 0.28;
    const upper = y < b.cy + b.h * 0.15;
    const dx = x - b.cx, dy = y - b.cy, l = Math.hypot(dx, dy) || 1;
    if (side && upper) return { dx: dx / l, dy: dy / l - 0.15, w: 1 };
    if (y > b.y1 - b.h * 0.18) return { dx: Math.sign(dx) || 1, dy: 0.12, w: 0.7 };
    return { dx: dx / l, dy: dy / l, w: 0.25 };
  },
  // 도로: 먼 커브(소실점)에서 바깥으로 — 화면 아래로 갈수록 크게 벌어짐
  road: (x, y, b) => {
    const vx = b.x0 + b.w * 0.66, vy = b.y0 + b.h * 0.33;
    const dx = x - vx, dy = y - vy, l = Math.hypot(dx, dy) || 1;
    const low = y > b.cy;
    return { dx: dx / l, dy: dy / l, w: low ? 1 : 0.4 };
  },
};
