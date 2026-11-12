import * as THREE from 'three';
import './style.css';
import { BUS, HEADS, SIGN, SIGNAL_LAMPS, KIND_BODY, generateBus } from './busGeometry.js';
import { createLogoDots } from './logo.js';
import { createCourse } from './drive.js';

// ── 설정 ────────────────────────────────────────────────────────
const isSmallScreen = Math.min(window.innerWidth, window.innerHeight) < 600;
const COUNT = isSmallScreen ? 4500 : 6000;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// 조립
const ASSEMBLE_DUR = reduceMotion ? 0.8 : 2.2; // 개별 입자 이동 시간
const MAX_DELAY = reduceMotion ? 0.2 : 0.8; // 입자별 출발 지연 → 전체 약 3초
const TOTAL_TIME = ASSEMBLE_DUR + MAX_DELAY;

// 조립 완료 → 짧은 정지 → 전조등 '빵, 빵' → 출발
const PAUSE = 0.45;
const F1 = TOTAL_TIME + PAUSE; // 첫 번째 전조등 (짧고 선명)
const F1_DUR = 0.12;
const F2 = F1 + F1_DUR + 0.14; // 두 번째 전조등 (조금 길게)
const F2_DUR = 0.25;
const T_BOUNCE = F2; // 차체 반동은 두 번째 전조등과 같은 박자
const T_GO = F2 + F2_DUR + 0.04; // 두 번째 빛이 잦아들기 시작할 때 바퀴가 구르기 시작
const HEAD_STEADY = 0.3; // 주행 중 상시등 세기
const DUST_DUR = 0.5; // 출발 직후 먼지
const LEAD = BUS.L * 0.05; // 화면 오른쪽으로 전진하는 거리 (차체 길이의 5%)
const LEAD_DUR = 3.2;
const ACCEL_DUR = 3.5; // 바퀴가 천천히 돌기 시작해 순항 속도에 이르는 시간

// 주행 코스: 긴 직선 4개 + 완만한 90° 좌회전 4개로 이어진 닫힌 블록을 계속 돈다.
// 매 코너: 왼쪽 깜빡이 2회 → 완만한 감속 → 좌회전 → 조향 복귀·재가속
// 반지름은 위에서 내려다본 검증(뒷바퀴 안쪽 궤적 + 앞 범퍼 바깥 모서리 궤적)으로
// 차체·바퀴가 차로 경계선 안쪽(여유 약 0.14)에 머무는 크기로 정했다.
const LANE_WIDTH = 4.0;
const course = createCourse({
  laneWidth: LANE_WIDTH,
  straight: 40, // 코너 사이 직선 → 순항 약 4~6초
  radius: 38, // 12m 차체가 차로를 벗어나지 않는 완만한 코너
  ease: 8, // 직선↔원호 완화곡선 (조향이 서서히 들어가고 풀림)
  cruise: reduceMotion ? 3 : 8,
  cornerSpeed: reduceMotion ? 2.6 : 6.8,
  decelLen: 16,
  accelLen: 18,
  launchDur: ACCEL_DUR,
  refX: 3.15, // 차로 중심선을 따라가는 차체 기준점 (앞뒤 궤적이 좌우 대칭이 되는 위치)
  rearX: BUS.rearWheelX,
  frontAxleX: BUS.frontWheelX,
  startU: 8,
  blinkLead: 6,
});
const CAM_LAG = 14; // 카메라 방향이 코스를 따라오는 지연 거리 → 코너 초입엔 기존 시점 유지 후 살짝 늦게 따라옴
const BLINK_ON = 0.38;
const BLINK_OFF = 0.3;
const BLINK_END = T_GO + course.tauAtU(course.blinkU[0]) + BLINK_ON * 2 + BLINK_OFF;

// 차체 도색: 파랑 → 초록 → 빨강. 첫 파랑은 좌회전 깜빡이가 끝날 때까지 유지(호박색 대비가 가장 좋음),
// 이후 각 5초 유지 + 1초 전환
const PAINT_FIRST_HOLD = BLINK_END + 0.8;
const PAINT_HOLD = 5;
const PAINT_FADE = 1;
const PAINT_COLORS = [
  new THREE.Color(0.2, 0.48, 1.0), // 간선(파랑)
  new THREE.Color(0.2, 0.86, 0.38), // 지선(초록)
  new THREE.Color(1.0, 0.26, 0.22), // 광역(빨강)
];

const POINTER_RADIUS = 0.9; // 반발 반경 (월드 단위)
const POINTER_STRENGTH = 0.3; // 최대 밀림 거리

// ── 렌더러 / 씬 / 카메라 ──────────────────────────────────────────
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x05070c, 1);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.1, 400);

// 버스 중심 & 카메라 방향: 옆면(+z)이 넓게, 앞(+x) 유리가 살짝 보이도록
const TARGET = new THREE.Vector3(0.25, BUS.H * 0.5 + 0.05, 0);
const VIEW_DIR = new THREE.Vector3(0.78, 0.2, 1).normalize();

// 장면 구조
//  busGroup (경로 위치·방향: position / rotation.y)
//   ├─ points        단일 Points — 차체는 uBody, 바퀴는 각 차축 기준 회전 (셰이더)
//   └─ bodyGroup     차체 서스펜션 반동 (uBody 와 동일한 변환) → 로고/전광판이 함께 움직임
const busGroup = new THREE.Group();
const bodyGroup = new THREE.Group();
scene.add(busGroup);
busGroup.add(bodyGroup);

// ── 입자 데이터 (한 번만 계산) ─────────────────────────────────────
// 점 글자 'LIVE BUS' + 차체를 하나의 버퍼로 합친다
const logoDots = createLogoDots('LIVE BUS', 0.05, 0.05);
const bus = generateBus(COUNT - logoDots.count, 7, logoDots.mask);
const target = new Float32Array(COUNT * 3); // 버스 표면 목표 좌표
const colorsAll = new Float32Array(COUNT * 3);
const sizesAll = new Float32Array(COUNT);
const kindsAll = new Float32Array(COUNT);
const axlesAll = new Float32Array(COUNT * 2);
{
  target.set(bus.positions);
  colorsAll.set(bus.colors);
  sizesAll.set(bus.sizes);
  kindsAll.set(bus.kinds);
  axlesAll.set(bus.axles);
  const o = bus.count;
  target.set(logoDots.positions, o * 3);
  for (let i = 0; i < logoDots.count; i++) {
    // 글자 점: 차체와 같은 크기, 밝기는 한 단계 높은 흰색
    colorsAll.set([0.86, 0.88, 0.9], (o + i) * 3);
    sizesAll[o + i] = 0.95;
    kindsAll[o + i] = KIND_BODY;
  }
}
const start = new Float32Array(COUNT * 3); // 흩어진 시작 좌표
const swirl = new Float32Array(COUNT * 3); // 이동 경로를 살짝 휘게 하는 오프셋
const delay = new Float32Array(COUNT);
const seeds = new Float32Array(COUNT);
const offset = new Float32Array(COUNT * 3); // 마우스 반발 변위 (스프링)

for (let i = 0; i < COUNT; i++) {
  const i3 = i * 3;
  // 화면 전체를 덮는 넓은 타원체 안에 흩뿌림
  const u = Math.random() * Math.PI * 2;
  const v = Math.acos(2 * Math.random() - 1);
  const r = 6 + Math.pow(Math.random(), 0.6) * 22;
  start[i3] = Math.cos(u) * Math.sin(v) * r * 1.3;
  start[i3 + 1] = TARGET.y + Math.cos(v) * r * 0.75;
  start[i3 + 2] = Math.sin(u) * Math.sin(v) * r * 0.9;

  const s = 1.2 + Math.random() * 2.2;
  swirl[i3] = (Math.random() - 0.5) * s;
  swirl[i3 + 1] = (Math.random() - 0.5) * s;
  swirl[i3 + 2] = (Math.random() - 0.5) * s;

  // 버스 앞쪽부터 살짝 먼저 모이도록 x 기반 지연 + 랜덤
  const xNorm = (target[i3] + BUS.L / 2) / BUS.L; // 0(뒤) ~ 1(앞)
  delay[i] = MAX_DELAY * (0.55 * (1 - xNorm) + 0.45 * Math.random());
  seeds[i] = Math.random();
}

const geometry = new THREE.BufferGeometry();
const posAttr = new THREE.BufferAttribute(new Float32Array(start), 3);
posAttr.setUsage(THREE.DynamicDrawUsage);
geometry.setAttribute('position', posAttr);
geometry.setAttribute('aColor', new THREE.BufferAttribute(colorsAll, 3));
geometry.setAttribute('aSize', new THREE.BufferAttribute(sizesAll, 1));
geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
geometry.setAttribute('aKind', new THREE.BufferAttribute(kindsAll, 1));
geometry.setAttribute('aAxle', new THREE.BufferAttribute(axlesAll, 2));
geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 60);

// 크기 관련 uniform 은 차선 입자와 공유
const sizeUniforms = {
  uSize: { value: 0.06 },
  uProj: { value: 1 },
};

const material = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    ...sizeUniforms,
    uTime: { value: 0 },
    uProgress: { value: 0 },
    uPaint: { value: PAINT_COLORS[0].clone() },
    uHead: { value: 0 },
    uBody: { value: new THREE.Matrix4() },
    uWheelAngle: { value: 0 },
    uSteer: { value: 0 },
    uSignal: { value: 0 },
  },
  vertexShader: /* glsl */ `
    attribute vec3 aColor;
    attribute float aSize;
    attribute float aSeed;
    attribute float aKind;   // 0 고정색, 1 바퀴, 2 도색, 3 전조등, 4 왼쪽 방향지시등
    attribute vec2 aAxle;    // 바퀴 입자의 차축 중심 (x, y)
    uniform float uTime;
    uniform float uProgress;
    uniform float uSize;
    uniform float uProj;
    uniform vec3 uPaint;
    uniform float uHead;
    uniform mat4 uBody;
    uniform float uWheelAngle;
    uniform float uSteer;    // 앞바퀴 조향각 (좌 +)
    uniform float uSignal;   // 방향지시등 세기
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      vec3 p = position;
      if (aKind > 0.5 && aKind < 1.5) {
        // 바퀴: 자기 차축을 중심으로 회전 (차체 반동은 받지 않음)
        vec2 d = p.xy - aAxle;
        float c = cos(uWheelAngle);
        float s = sin(uWheelAngle);
        p.xy = aAxle + vec2(c * d.x - s * d.y, s * d.x + c * d.y);
        // 앞바퀴: 바퀴 중심의 수직축으로 조향
        if (aAxle.x > 0.0) {
          float zc = sign(p.z) * ${(BUS.W / 2 - 0.26).toFixed(3)};
          vec2 q = vec2(p.x - aAxle.x, p.z - zc);
          float cs = cos(uSteer);
          float sn = sin(uSteer);
          p.x = aAxle.x + q.x * cs + q.y * sn;
          p.z = zc - q.x * sn + q.y * cs;
        }
      } else {
        // 차체: 서스펜션 반동
        p = (uBody * vec4(p, 1.0)).xyz;
      }
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      // 흩어져 있을 땐 작고 은은하게, 모이면 선명하게
      bool isHead = aKind > 2.5 && aKind < 3.5;
      bool isSignal = aKind > 3.5;
      float size = uSize * aSize * mix(0.75, 1.0, uProgress)
        * (isHead ? 1.0 + 0.7 * uHead : 1.0) * (isSignal ? 1.0 + 0.6 * uSignal : 1.0);
      gl_PointSize = max(1.0, size * uProj / -mv.z);
      // 먼 쪽 면은 어둡게 → 창문 너머가 덜 막혀 보임
      float sideFade = mix(0.28, 1.0, smoothstep(-1.2, 1.0, position.z));
      sideFade = mix(1.0, sideFade, uProgress);
      if (isSignal) sideFade = mix(0.45, 1.0, uSignal); // 왼쪽 램프는 깜빡일 때 차체 너머로도 보이게
      float twinkle = 0.86 + 0.14 * sin(uTime * 1.6 + aSeed * 40.0);
      vec3 col = aColor;
      if (aKind > 1.5 && aKind < 2.5) col = uPaint * aColor.r;
      if (isHead) col = aColor * (0.45 + 1.8 * uHead);
      if (isSignal) col = aColor * (0.28 + 1.9 * uSignal);
      vColor = mix(vec3(0.6, 0.75, 1.0), col, uProgress);
      vAlpha = sideFade * twinkle * mix(0.85, 1.0, uProgress);
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      vec2 c = gl_PointCoord - 0.5;
      float d = length(c);
      if (d > 0.5) discard;
      float core = smoothstep(0.5, 0.0, d);
      float a = pow(core, 1.6) * vAlpha;
      gl_FragColor = vec4(vColor * (0.7 + 0.5 * core), a);
    }
  `,
});

const points = new THREE.Points(geometry, material);
busGroup.add(points);

// ── 행선지 LED 전광판 (도트 매트릭스 느낌의 호박색 '시청행') ─────────────
function makeSignTexture(label) {
  const sw = SIGN.x1 - SIGN.x0;
  const sh = SIGN.y1 - SIGN.y0;
  const W = 1024;
  const H = Math.round((W * sh) / sw);
  const mask = document.createElement('canvas');
  mask.width = W;
  mask.height = H;
  const mctx = mask.getContext('2d');
  mctx.fillStyle = '#fff';
  mctx.textAlign = 'center';
  mctx.textBaseline = 'middle';
  mctx.font = `800 ${Math.round(H * 0.86)}px "Pretendard", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", "Noto Sans CJK KR", sans-serif`;
  mctx.fillText(label, W / 2, H / 2 + H * 0.04);
  const data = mctx.getImageData(0, 0, W, H).data;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const pitch = Math.max(3, Math.round(H / 22));
  for (let y = pitch / 2; y < H; y += pitch) {
    for (let x = pitch / 2; x < W; x += pitch) {
      const on = data[(Math.floor(y) * W + Math.floor(x)) * 4 + 3] > 110;
      ctx.fillStyle = on ? 'rgba(255, 178, 60, 1)' : 'rgba(255, 150, 40, 0.1)';
      ctx.beginPath();
      ctx.arc(x, y, pitch * (on ? 0.48 : 0.32), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

const signMat = new THREE.MeshBasicMaterial({
  map: makeSignTexture('시청행'),
  transparent: true,
  opacity: 0,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
});
const sign = new THREE.Mesh(new THREE.PlaneGeometry(SIGN.x1 - SIGN.x0, SIGN.y1 - SIGN.y0), signMat);
sign.position.set(BUS.L / 2 + 0.02, (SIGN.y0 + SIGN.y1) / 2, (SIGN.x0 + SIGN.x1) / 2);
sign.rotation.y = Math.PI / 2; // 앞(+x)을 향하도록
sign.renderOrder = 2;
bodyGroup.add(sign);

// ── 전조등: 램프 중심 글로우 + 바로 앞 노면 빛 번짐 ───────────────────
function radialTexture(stops, w = 128, h = 128) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const glowTex = radialTexture([
  [0, 'rgba(255,250,236,1)'],
  [0.18, 'rgba(255,236,200,0.85)'],
  [0.45, 'rgba(255,214,160,0.25)'],
  [1, 'rgba(255,200,140,0)'],
]);
const headGlows = HEADS.map((h) => {
  const sp = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0,
    }),
  );
  sp.position.set(BUS.L / 2 + 0.06, (h.y0 + h.y1) / 2, (h.x0 + h.x1) / 2);
  sp.renderOrder = 3;
  bodyGroup.add(sp);
  return sp;
});

// 왼쪽 앞·뒤 방향지시등 글로우 (호박색)
const signalTex = radialTexture([
  [0, 'rgba(255,236,190,1)'],
  [0.16, 'rgba(255,170,50,0.9)'],
  [0.45, 'rgba(255,130,20,0.25)'],
  [1, 'rgba(255,110,0,0)'],
]);
const signalGlows = [
  [SIGNAL_LAMPS.frontLeft, 0.08],
  [SIGNAL_LAMPS.rearLeft, -0.08],
].map(([lamp, dx]) => {
  const sp = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: signalTex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0,
    }),
  );
  sp.position.set(lamp.x + dx, lamp.y, lamp.z - 0.1);
  sp.renderOrder = 3;
  bodyGroup.add(sp);
  return sp;
});

// 노면 빛 번짐: 두 램프 앞쪽으로 길게 퍼지는 따뜻한 타원 (전면 주변에만)
const spillTex = (() => {
  // 두 램프 앞쪽으로 퍼지는 타원형 빛 — 가장자리는 완전히 0 이 되도록 픽셀 단위로 계산
  const N = 256;
  const c = document.createElement('canvas');
  c.width = N;
  c.height = N;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const v = y / N; // 0 = 버스 앞면 쪽
      const u = x / N;
      let a = 0;
      for (const zc of [0.3, 0.7]) {
        const du = (u - zc) / (0.13 + v * 0.18);
        const dv = (v - 0.05) / 0.42;
        a += Math.exp(-(du * du + dv * dv) * 2.2);
      }
      const edge = Math.min(1, u * 6, (1 - u) * 6, (1 - v) * 3);
      const i = (y * N + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 228;
      img.data[i + 2] = 185;
      img.data[i + 3] = Math.round(255 * Math.min(1, a * 0.75) * Math.max(0, edge));
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
})();
const spillMat = new THREE.MeshBasicMaterial({
  map: spillTex,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  opacity: 0,
  toneMapped: false,
});
const SPILL_LEN = 3.4;
const spill = new THREE.Mesh(new THREE.PlaneGeometry(BUS.W + 0.6, SPILL_LEN), spillMat);
// 평면의 v(위쪽)가 버스 앞면 쪽 → 앞으로 갈수록 옅어짐
spill.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
spill.position.set(BUS.L / 2 + SPILL_LEN / 2 - 0.05, 0.004, 0);
spill.renderOrder = 1;
busGroup.add(spill);

// ── 출발 먼지: 뒷바퀴 접지점에서 뒤로 밀렸다가 사라짐 ──────────────────
const DUST_N = 46;
const dustOrigin = new Float32Array(DUST_N * 3);
const dustVel = new Float32Array(DUST_N * 3);
const dustTime = new Float32Array(DUST_N * 2); // delay, life
for (let i = 0; i < DUST_N; i++) {
  // 카메라 쪽 뒷바퀴에서만 (반대편 먼지는 차체를 통해 비쳐 로고 주변에 얼룩처럼 보임)
  const side = 1;
  dustOrigin.set(
    [BUS.rearWheelX + (Math.random() - 0.3) * 0.35, 0.03, side * (BUS.W / 2 - 0.2 + Math.random() * 0.18)],
    i * 3,
  );
  dustVel.set([-(1.6 + Math.random() * 2.2), 0.3 + Math.random() * 0.7, side * (0.1 + Math.random() * 0.4)], i * 3);
  dustTime.set([Math.random() * 0.14, 0.22 + Math.random() * 0.16], i * 2);
}
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustOrigin, 3));
dustGeo.setAttribute('aVel', new THREE.BufferAttribute(dustVel, 3));
dustGeo.setAttribute('aTime', new THREE.BufferAttribute(dustTime, 2));
dustGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);
const dustMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: { ...sizeUniforms, uDustT: { value: -1 } },
  vertexShader: /* glsl */ `
    attribute vec3 aVel;
    attribute vec2 aTime;
    uniform float uDustT;
    uniform float uSize;
    uniform float uProj;
    varying float vAlpha;
    void main() {
      float age = uDustT - aTime.x;
      float k = clamp(age / aTime.y, 0.0, 1.0);
      vec3 p = position + aVel * age * (1.0 - 0.45 * k);
      p.y = max(0.01, p.y - 1.4 * age * age);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = max(1.5, uSize * (1.2 + 1.0 * k) * uProj / -mv.z);
      vAlpha = (age > 0.0 && age < aTime.y) ? pow(1.0 - k, 1.2) * 0.95 : 0.0;
    }
  `,
  fragmentShader: /* glsl */ `
    varying float vAlpha;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      if (d > 0.5 || vAlpha <= 0.0) discard;
      gl_FragColor = vec4(vec3(0.92, 0.88, 0.8), smoothstep(0.5, 0.0, d) * vAlpha);
    }
  `,
});
const dust = new THREE.Points(dustGeo, dustMat);
busGroup.add(dust);

// ── 차로 경계선: 도로에 고정된 정적 점선 ─────────────────────────────
// 차로 중심선에서 좌우로 차로 폭의 절반씩 떨어진 두 선. 코너에선 안쪽(왼쪽) 선의 반지름이 작고
// 바깥쪽(오른쪽) 선의 반지름이 크다. 점선은 각 선의 '실제 길이' 기준으로 일정 간격 배치하고,
// 한 바퀴에 정수 개가 들어가도록 간격을 미세 조정해 이음매가 없다.
// 버스와 카메라가 이 위를 지나가며, 셰이더는 버스 주변만 보이도록 거리로 페이드한다.
const LANE_PERIOD = 5;
const LANE_DASH = 2.0;
const LANE_DOT_GAP = 0.12;
const lanePts = [];
const laneSide = [];
for (const side of [1, -1]) {
  const off = side * (LANE_WIDTH / 2);
  // 이 경계선의 누적 길이표
  const DU = 0.05;
  const n = Math.ceil(course.lapLength / DU);
  const us = [];
  const ls = [];
  let len = 0;
  let prev = course.centerAt(0);
  for (let i = 0; i <= n; i++) {
    const uu = Math.min(i * DU, course.lapLength);
    const c = course.centerAt(uu);
    const x = c.x + c.nx * off;
    const z = c.z + c.nz * off;
    if (i > 0) len += Math.hypot(x - (prev.x + prev.nx * off), z - (prev.z + prev.nz * off));
    us.push(uu);
    ls.push(len);
    prev = c;
  }
  const count = Math.round(len / LANE_PERIOD);
  const period = len / count;
  let j = 0;
  for (let d = 0; d < count; d++) {
    for (let q = 0; q * LANE_DOT_GAP <= LANE_DASH; q++) {
      const target = d * period + q * LANE_DOT_GAP;
      while (j < ls.length - 2 && ls[j + 1] < target) j++;
      const f = (target - ls[j]) / Math.max(1e-9, ls[j + 1] - ls[j]);
      const c = course.centerAt(us[j] + (us[j + 1] - us[j]) * f);
      for (const w of [-0.05, 0.05]) {
        lanePts.push(c.x + c.nx * (off + w), 0.002, c.z + c.nz * (off + w));
        laneSide.push(side);
      }
    }
    j = Math.max(0, j - 2);
  }
}
const laneGeo = new THREE.BufferGeometry();
laneGeo.setAttribute('position', new THREE.Float32BufferAttribute(lanePts, 3));
laneGeo.setAttribute('aSide', new THREE.Float32BufferAttribute(laneSide, 1));
laneGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
const laneMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    ...sizeUniforms,
    uAlpha: { value: 0 },
    uBusPos: { value: new THREE.Vector2() },
    uFade: { value: new THREE.Vector2(26, 52) },
  },
  vertexShader: /* glsl */ `
    attribute float aSide;
    uniform float uAlpha;
    uniform float uSize;
    uniform float uProj;
    uniform vec2 uBusPos;
    uniform vec2 uFade;
    varying float vAlpha;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = max(1.0, uSize * 0.85 * uProj / -mv.z);
      float near = 1.0 - smoothstep(uFade.x, uFade.y, distance(position.xz, uBusPos));
      vAlpha = uAlpha * near * (aSide > 0.0 ? 0.95 : 0.85);
    }
  `,
  fragmentShader: /* glsl */ `
    varying float vAlpha;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      if (d > 0.5) discard;
      gl_FragColor = vec4(vec3(0.82, 0.86, 0.92), pow(smoothstep(0.5, 0.0, d), 1.4) * vAlpha);
    }
  `,
});
const lanes = new THREE.Points(laneGeo, laneMat);
scene.add(lanes);

// ── 카메라 거리 자동 맞춤 (데스크톱/모바일 세로 모두 잘리지 않게) ──────
// 카메라는 버스를 따라가는 '리그' 좌표계에 있다. 리그는 버스 위치를 따라가고,
// 방향(yaw)만 경로를 CAM_LAG 만큼 늦게 따라간다. 그 차이(φ = 버스 yaw − 카메라 yaw)만큼
// 버스가 리그 안에서 돌아가 보이므로, φ 별로 버스 전체가 들어오는 거리·주시점을 미리 계산해 둔다.
// 전진(LEAD)과 차체 반동까지 포함한 범위를 화면 안에 넣는다.
const bboxLocal = [];
{
  const xs = [-BUS.L / 2 - 0.05, BUS.L / 2 + LEAD + 0.12];
  const ys = [0, BUS.H + 0.45];
  const zs = [-BUS.W / 2 - 0.05, BUS.W / 2 + 0.05];
  for (const x of xs) for (const y of ys) for (const z of zs) bboxLocal.push(new THREE.Vector3(x, y, z));
}
const bboxCorners = bboxLocal.map((v) => v.clone());
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3();

const aim = TARGET.clone(); // 화면 중앙에 오도록 보정되는 실제 주시점 (리그 좌표)
const camRight = new THREE.Vector3();
const camUp = new THREE.Vector3();

function fitsInView(dist, mx, my) {
  camera.position.copy(aim).addScaledVector(VIEW_DIR, dist);
  camera.lookAt(aim);
  camera.updateMatrixWorld(true);
  for (const c of bboxCorners) {
    tmpV.copy(c).project(camera);
    if (Math.abs(tmpV.x) > mx || Math.abs(tmpV.y) > my || tmpV.z > 1) return false;
  }
  return true;
}

/** 리그 기준 φ 만큼 돌아간 버스가 화면에 맞는 (거리, 주시점) */
function fitFor(phi, mx, my, aspect) {
  bboxLocal.forEach((v, i) => bboxCorners[i].copy(v).applyAxisAngle(Y_AXIS, phi));
  aim.copy(TARGET).applyAxisAngle(Y_AXIS, phi);
  let hi = 300;
  // 거리 맞춤 → 투영된 범위의 중심을 화면 중앙으로 이동, 을 몇 번 반복
  for (let iter = 0; iter < 4; iter++) {
    let lo = 2;
    hi = 300;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (fitsInView(mid, mx, my)) hi = mid;
      else lo = mid;
    }
    fitsInView(hi, mx, my);
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const c of bboxCorners) {
      tmpV.copy(c).project(camera);
      x0 = Math.min(x0, tmpV.x);
      x1 = Math.max(x1, tmpV.x);
      y0 = Math.min(y0, tmpV.y);
      y1 = Math.max(y1, tmpV.y);
    }
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * hi;
    camRight.setFromMatrixColumn(camera.matrixWorld, 0);
    camUp.setFromMatrixColumn(camera.matrixWorld, 1);
    aim.addScaledVector(camRight, ((x0 + x1) / 2) * halfH * aspect);
    aim.addScaledVector(camUp, ((y0 + y1) / 2) * halfH);
  }
  return { dist: hi, aim: aim.clone() };
}

const PHI_STEP = 0.05;
const PHI_MAX = 1.0;
let fitTable = [];
const camAim = new THREE.Vector3();
let camDist = 30;
function fitAt(phi) {
  const f = THREE.MathUtils.clamp(phi, 0, PHI_MAX) / PHI_STEP;
  const i = Math.min(Math.floor(f), fitTable.length - 2);
  const t = f - i;
  camDist = fitTable[i].dist + (fitTable[i + 1].dist - fitTable[i].dist) * t;
  camAim.lerpVectors(fitTable[i].aim, fitTable[i + 1].aim, t);
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const aspect = w / h;
  renderer.setSize(w, h);
  camera.aspect = aspect;
  // 세로 화면에서는 시야각을 조금 넓혀 버스가 너무 작아지지 않게
  camera.fov = aspect < 1 ? 40 : 32;
  camera.updateProjectionMatrix();

  // 화면 여백: 좌우 8%, 상하 18% (세로 화면은 좌우 4%)
  const mx = aspect < 1 ? 0.96 : 0.84;
  const my = 0.72;
  fitTable = [];
  for (let phi = 0; phi <= PHI_MAX + 1e-6; phi += PHI_STEP) fitTable.push(fitFor(phi, mx, my, aspect));
  const base = fitTable[0];

  // 포인트 크기: 화면에 보이는 버스 길이에 비례 → 작은 화면에서도 점이 겹쳐 창문을 막지 않음 (φ=0 기준)
  bboxLocal.forEach((v, i) => bboxCorners[i].copy(v));
  aim.copy(base.aim);
  fitsInView(base.dist, mx, my);
  const dpr = renderer.getPixelRatio();
  const proj = (h * dpr) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  let minX = Infinity;
  let maxX = -Infinity;
  for (const c of bboxCorners) {
    tmpV.copy(c).project(camera);
    minX = Math.min(minX, tmpV.x);
    maxX = Math.max(maxX, tmpV.x);
  }
  const busLenPx = ((maxX - minX) / 2) * w * dpr;
  const desiredPx = THREE.MathUtils.clamp(busLenPx * 0.0036, 2.0 * dpr, 7 * dpr);
  sizeUniforms.uProj.value = proj;
  sizeUniforms.uSize.value = (desiredPx * base.dist) / proj;
}
window.addEventListener('resize', resize);
resize();

// ── 포인터 ──────────────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let pointerActive = false;

function setPointer(e) {
  ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  pointerActive = true;
}
renderer.domElement.addEventListener('pointermove', setPointer);
renderer.domElement.addEventListener('pointerdown', setPointer);
renderer.domElement.addEventListener('pointerleave', () => (pointerActive = false));
renderer.domElement.addEventListener('pointerup', (e) => {
  if (e.pointerType !== 'mouse') pointerActive = false;
});

// ── 타임라인 상태 ────────────────────────────────────────────────
// 모든 움직임(위치·조향·깜빡이·카메라)은 시작 후 경과시간 t 의 함수 → R 로 정확히 처음부터 재생
let startTime = -1; // 첫 프레임에서 시작 (로딩 지연과 무관하게 처음부터 재생)

// R 키로 다시 재생
window.addEventListener('keydown', (e) => {
  if (e.key === 'r' || e.key === 'R') {
    startTime = -1;
    offset.fill(0);
  }
});

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, v) => {
  const x = clamp01((v - a) / (b - a));
  return x * x * (3 - 2 * x);
};

function paintColorAt(t, out) {
  const period = PAINT_HOLD + PAINT_FADE;
  // 첫 파랑을 PAINT_FIRST_HOLD 까지 유지한 뒤 기존 주기로
  const tt = t < PAINT_FIRST_HOLD ? 0 : t - PAINT_FIRST_HOLD + PAINT_HOLD;
  const idx = Math.floor(tt / period);
  const local = tt - idx * period;
  const a = PAINT_COLORS[idx % 3];
  const b = PAINT_COLORS[(idx + 1) % 3];
  out.copy(a).lerp(b, smooth(PAINT_HOLD, period, local));
}

/** 짧은 빛: start 에서 빠르게 켜지고 dur 동안 유지, release 동안 꺼짐 */
const pulse = (t, start, dur, attack, release) =>
  smooth(start, start + attack, t) * (1 - smooth(start + dur, start + dur + release, t));

/** 전조등 세기: '빵(짧게), 빵(조금 길게)' → 은은한 상시등 */
function headIntensity(t) {
  const f1 = pulse(t, F1, F1_DUR, 0.02, 0.06);
  const f2 = pulse(t, F2, F2_DUR, 0.025, 0.32);
  const steady = HEAD_STEADY * smooth(F2 + F2_DUR, F2 + F2_DUR + 0.35, t);
  return { flash: Math.max(f1, f2), level: Math.max(f1, f2, steady) };
}

/** 왼쪽 방향지시등: 매 코너 앞에서 두 번 깜빡 (가장 최근에 지난 깜빡이 지점 기준) */
function signalIntensity(tau, uNow) {
  const L = course.lapLength;
  let ub = -Infinity;
  for (const b of course.blinkU) {
    const k = Math.floor((uNow - b) / L);
    ub = Math.max(ub, b + k * L);
  }
  if (ub < 8) return 0; // 출발 지점 이전
  const tb = course.tauAtU(ub);
  return Math.max(pulse(tau, tb, BLINK_ON, 0.04, 0.1), pulse(tau, tb + BLINK_ON + BLINK_OFF, BLINK_ON, 0.04, 0.1));
}

// 위에서 내려다보는 검증용 시점: ?view=top  (선택: &speed=4 로 빠르게 재생)
const params = new URLSearchParams(location.search);
const TOP_VIEW = params.get('view') === 'top';
const TIME_SCALE = Number(params.get('speed')) || 1;
const TOP_FOLLOW = TOP_VIEW && params.has('follow'); // 버스를 따라가며 가까이 내려다봄
if (TOP_VIEW) {
  laneMat.uniforms.uFade.value.set(1e4, 2e4);
  // 코스 전체가 들어오도록
  let x0 = Infinity,
    x1 = -Infinity,
    z0 = Infinity,
    z1 = -Infinity;
  for (let q = 0; q < course.lapLength; q += 2) {
    const c = course.centerAt(q);
    x0 = Math.min(x0, c.x);
    x1 = Math.max(x1, c.x);
    z0 = Math.min(z0, c.z);
    z1 = Math.max(z1, c.z);
  }
  camera.fov = 30;
  camera.updateProjectionMatrix();
  const tanH = Math.tan(THREE.MathUtils.degToRad(15));
  const hgt = Math.max((z1 - z0 + 14) / 2 / tanH, (x1 - x0 + 14) / 2 / (tanH * camera.aspect));
  camera.up.set(0, 0, -1); // 화면 위쪽 = -z
  camera.position.set((x0 + x1) / 2, hgt, (z0 + z1) / 2);
  camera.lookAt((x0 + x1) / 2, 0, (z0 + z1) / 2);
}

// ── 애니메이션 ───────────────────────────────────────────────────
const pos = posAttr.array;
const rayO = new THREE.Vector3();
const rayD = new THREE.Vector3();
const invBus = new THREE.Matrix4();
const pBus = { x: 0, z: 0, yaw: 0, steer: 0, k: 0 };
const pCam = { x: 0, z: 0, yaw: 0, steer: 0, k: 0 };
const pYaw = { x: 0, z: 0, yaw: 0, steer: 0, k: 0 };
const rigPos = new THREE.Vector3();
const lookAt = new THREE.Vector3();
let settledFrames = 0;

function tick(now) {
  if (startTime < 0) startTime = now;
  const t = ((now - startTime) / 1000) * TIME_SCALE;

  const progress = Math.min(1, t / TOTAL_TIME);
  const u = material.uniforms;
  u.uTime.value = now / 1000;
  u.uProgress.value = easeInOutCubic(progress);
  paintColorAt(t, u.uPaint.value);

  // ── 전조등 ──
  const head = headIntensity(t);
  u.uHead.value = head.level;
  for (const g of headGlows) {
    g.material.opacity = Math.min(1, head.level * 1.1);
    g.scale.setScalar(0.35 + 0.75 * head.level);
  }
  spillMat.opacity = 0.6 * head.flash + 0.12 * (Math.min(head.level, HEAD_STEADY) / HEAD_STEADY) * (1 - head.flash);

  // ── 출발 & 주행: 경로 위 위치·방향 ──
  const tau = Math.max(0, t - T_GO);
  const d = course.uAt(tau); // 차체 기준점이 차로 중심선을 따라 간 누적 거리
  const speed = course.speedAt(tau);
  course.poseAt(d, pBus);
  busGroup.position.set(pBus.x, 0, pBus.z);
  busGroup.rotation.y = pBus.yaw;
  busGroup.updateMatrixWorld();

  // 바퀴: 주행 거리만큼 굴러가고, 앞바퀴는 앞차축이 실제로 움직이는 방향으로 꺾임
  // (앞차축이 코너에 먼저 들어가므로 차체보다 먼저 꺾이고, 빠져나오며 서서히 복귀)
  u.uWheelAngle.value = -d / BUS.wheelR;
  u.uSteer.value = pBus.steer;

  // 차선: 도로에 고정 — 버스 주변만 보이게
  laneMat.uniforms.uBusPos.value.set(pBus.x, pBus.z);
  laneMat.uniforms.uAlpha.value = smooth(TOTAL_TIME - 0.2, T_GO + 0.8, t);

  // 왼쪽 방향지시등
  const sig = t >= T_GO ? signalIntensity(tau, d) : 0;
  u.uSignal.value = sig;
  for (const g of signalGlows) {
    g.material.opacity = sig;
    g.scale.setScalar(0.3 + 0.45 * sig);
  }

  // ── 카메라: 버스 위치를 따라가는 리그, 방향은 CAM_LAG 만큼 늦게 → 회전 초입엔 기존 시점 유지 ──
  const lead = LEAD * easeInOutCubic(clamp01(tau / LEAD_DUR)); // 출발 시 화면 오른쪽으로 5% 전진
  const sCam = d - lead;
  course.poseAt(sCam, pCam);
  course.poseAt(sCam - CAM_LAG, pYaw);
  const camYaw = pYaw.yaw;
  rigPos.set(pCam.x, 0, pCam.z);
  if (TOP_FOLLOW) {
    camera.position.set(pBus.x, 34, pBus.z);
    camera.lookAt(pBus.x, 0, pBus.z);
  } else if (!TOP_VIEW) {
    fitAt(pBus.yaw - camYaw);
    camera.position.copy(camAim).addScaledVector(VIEW_DIR, camDist).applyAxisAngle(Y_AXIS, camYaw).add(rigPos);
    lookAt.copy(camAim).applyAxisAngle(Y_AXIS, camYaw).add(rigPos);
    camera.lookAt(lookAt);
  }

  // 먼지: 출발 직후 0.5초
  dustMat.uniforms.uDustT.value = t >= T_GO && t < T_GO + DUST_DUR + 0.1 ? t - T_GO : -1;

  // 차체에만 주는 반동 — 두 번째 전조등과 같은 박자: 뒤가 살짝 내려앉으며 앞이 들렸다가 되돌아옴
  const tb = Math.max(0, t - T_BOUNCE);
  const env = t > T_BOUNCE ? Math.exp(-2.6 * tb) : 0;
  const osc = Math.sin(6.2 * tb);
  // + 감속 땐 앞이 살짝 숙여지고, 코너에선 바깥쪽(오른쪽)으로 살짝 기울어짐
  const motion = reduceMotion ? 0 : 1;
  const accel = THREE.MathUtils.clamp(course.accelAt(tau), -2, 2);
  const lateral = speed * speed * pBus.k;
  bodyGroup.rotation.z = motion * (0.012 * env * osc + 0.004 * accel);
  bodyGroup.rotation.x = motion * 0.02 * lateral;
  bodyGroup.position.y = motion * -0.02 * env * Math.abs(osc);
  bodyGroup.updateMatrix();
  u.uBody.value.copy(bodyGroup.matrix);

  // 전광판은 조립이 끝날 무렵 나타남
  signMat.opacity = smooth(TOTAL_TIME - 0.5, TOTAL_TIME + 0.2, t);

  const assembled = t >= TOTAL_TIME;
  // 조립 직후부터 0.5초 동안 상호작용 세기를 서서히 켬
  const interact = assembled ? Math.min(1, (t - TOTAL_TIME) / 0.5) : 0;
  const usePointer = pointerActive && interact > 0;
  if (usePointer) {
    raycaster.setFromCamera(ndc, camera);
    // 버스 로컬 좌표로
    invBus.copy(busGroup.matrixWorld).invert();
    rayO.copy(raycaster.ray.origin).applyMatrix4(invBus);
    rayD.copy(raycaster.ray.direction).transformDirection(invBus);
  }

  let moving = !assembled;
  const R2 = POINTER_RADIUS * POINTER_RADIUS;

  for (let i = 0; i < COUNT; i++) {
    const i3 = i * 3;
    const tx = target[i3];
    const ty = target[i3 + 1];
    const tz = target[i3 + 2];

    // 마우스 반발 (모인 뒤에만)
    let px = 0;
    let py = 0;
    let pz = 0;
    if (usePointer) {
      const vx = tx - rayO.x;
      const vy = ty - rayO.y;
      const vz = tz - rayO.z;
      const along = vx * rayD.x + vy * rayD.y + vz * rayD.z;
      const dx = vx - rayD.x * along;
      const dy = vy - rayD.y * along;
      const dz = vz - rayD.z * along;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < R2) {
        const d = Math.sqrt(d2) + 1e-4;
        const f = (1 - d / POINTER_RADIUS) ** 2 * POINTER_STRENGTH * interact;
        px = (dx / d) * f;
        py = (dy / d) * f;
        pz = (dz / d) * f;
      }
    }
    const pushing = px !== 0 || py !== 0 || pz !== 0;
    const k = pushing ? 0.2 : 0.07; // 밀릴 땐 빠르게, 돌아올 땐 부드럽게
    offset[i3] += (px - offset[i3]) * k;
    offset[i3 + 1] += (py - offset[i3 + 1]) * k;
    offset[i3 + 2] += (pz - offset[i3 + 2]) * k;
    if (Math.abs(offset[i3]) + Math.abs(offset[i3 + 1]) + Math.abs(offset[i3 + 2]) > 1e-4) moving = true;
    else offset[i3] = offset[i3 + 1] = offset[i3 + 2] = 0;

    if (assembled) {
      pos[i3] = tx + offset[i3];
      pos[i3 + 1] = ty + offset[i3 + 1];
      pos[i3 + 2] = tz + offset[i3 + 2];
      continue;
    }

    // 시작 → 목표 보간 + 곡선 경로 + 대기 중 미세한 부유
    const local = clamp01((t - delay[i]) / ASSEMBLE_DUR);
    const e = easeInOutCubic(local);
    const arc = Math.sin(Math.PI * e);
    const drift = (1 - e) * 0.35;
    const ph = now * 0.0006 + seeds[i] * 50;
    pos[i3] = start[i3] + (tx - start[i3]) * e + swirl[i3] * arc + Math.sin(ph) * drift;
    pos[i3 + 1] = start[i3 + 1] + (ty - start[i3 + 1]) * e + swirl[i3 + 1] * arc + Math.cos(ph * 1.3) * drift;
    pos[i3 + 2] = start[i3 + 2] + (tz - start[i3 + 2]) * e + swirl[i3 + 2] * arc;
  }

  // 입자 좌표가 더 이상 변하지 않으면 버퍼 업로드 생략 (바퀴/반동은 셰이더에서 처리)
  if (moving) settledFrames = 0;
  else settledFrames++;
  if (settledFrames < 2) posAttr.needsUpdate = true;

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
