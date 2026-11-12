import { BUS, LOGO, type LogoMask } from './busGeometry';

export interface LogoDots {
  /** 점 글자 좌표 (x, y, z) * count — 버스 가까운 옆면 위 */
  positions: Float32Array;
  count: number;
  /** 차체 도색 입자를 비울 영역 판정 (0 바깥, 1 여백, 2 획) */
  mask: LogoMask;
}

/**
 * 'LIVE BUS'를 캔버스에 그린 뒤, 일정한 간격(육각 격자)으로 획 안쪽만 샘플링해
 * 차체 입자와 같은 재질의 점 글자를 만든다.
 *
 * @param pitch 점 간격 (월드 단위). 작을수록 획이 촘촘해진다.
 * @param halo  글자 둘레에서 도색 입자를 비우는 폭 (월드 단위)
 */
export function createLogoDots(text = 'LIVE BUS', pitch = 0.05, halo = 0.05): LogoDots {
  const PX = 220; // 월드 1 단위당 캔버스 픽셀
  const W = Math.round(LOGO.w * PX);
  const H = Math.round(LOGO.h * PX);
  const family = '"Arial Black", "Segoe UI Black", "Helvetica Neue", "Noto Sans", Arial, sans-serif';

  const draw = (stroke: number) => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    const setFont = (size: number) => {
      ctx.font = `900 ${size}px ${family}`;
      if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${Math.round(size * 0.05)}px`;
    };
    // 대문자 높이 ≈ 영역 높이의 80%, 폭이 넘치면 줄임
    let size = H;
    setFont(size);
    let m = ctx.measureText(text);
    size *= Math.min((H * 0.8) / m.actualBoundingBoxAscent, (W * 0.96) / m.width);
    setFont(size);
    m = ctx.measureText(text);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const y = H / 2 + m.actualBoundingBoxAscent / 2;
    ctx.fillStyle = '#fff';
    ctx.fillText(text, W / 2, y);
    if (stroke > 0) {
      ctx.strokeStyle = '#fff';
      ctx.lineJoin = 'round';
      ctx.lineWidth = stroke * 2;
      ctx.strokeText(text, W / 2, y);
    }
    return ctx.getImageData(0, 0, W, H).data;
  };

  const fill = draw(0);
  const grown = draw(halo * PX);
  const x0 = LOGO.cx - LOGO.w / 2;
  const yTop = LOGO.cy + LOGO.h / 2;
  const alphaAt = (data: Uint8ClampedArray, x: number, y: number) => {
    const u = Math.floor((x - x0) * PX);
    const v = Math.floor((yTop - y) * PX);
    if (u < 0 || v < 0 || u >= W || v >= H) return 0;
    return data[(v * W + u) * 4 + 3];
  };

  const mask: LogoMask = (x, y) => {
    if (alphaAt(fill, x, y) > 100) return 2;
    if (alphaAt(grown, x, y) > 40) return 1;
    return 0;
  };

  // 육각 격자 샘플링 → 일정한 간격의 점
  const pts: number[] = [];
  const rowH = pitch * Math.sqrt(3) * 0.5;
  const z = BUS.W / 2 + 0.008;
  let row = 0;
  for (let y = yTop - rowH / 2; y > LOGO.cy - LOGO.h / 2; y -= rowH, row++) {
    const shift = row % 2 ? pitch / 2 : 0;
    for (let x = x0 + pitch / 2 + shift; x < x0 + LOGO.w; x += pitch) {
      if (alphaAt(fill, x, y) > 127) pts.push(x, y, z);
    }
  }
  return { positions: new Float32Array(pts), count: pts.length / 3, mask };
}
