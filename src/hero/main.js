/**
 * LIVEBUS 첫 화면 — 스크롤하지 않으면 구체 → 버스 → 정류장 → 도로 → 구체가 반복되고,
 * 아래로 스크롤하면 어느 장면에서든 도로로 모이며 Core Technology 문구(세 줄 전체)가 단계별로 선명해진다.
 *
 * - 구체: Figma 원화(sphere-figma.png)의 점을 구 표면 좌표로 바꿔 무늬가 곡면을 타고 흐르게 함 (sphere.js).
 *         테두리는 제자리라 둥근 윤곽이 또렷, 바깥 잔점은 어둡고 거의 흔들리지 않음. 커서 쪽으로 살짝 돌아봄.
 * - 버스·정류장·도로: 장면 PNG 의 빛 점 중심을 파티클 자리로 (sampleDots.js),
 *         네모난 경계는 노이즈로 들쭉날쭉하게 녹이고 장면별 방향으로 바깥에 흐린 점을 흩뿌림 (featherScene).
 * - 전환: 장면 사이 "팡" 퍼졌다 모이는 전환(CFG.burst, 2.6초). 스크롤 진입은 전환 중이어도 지금 위치에서 바로 도로로(CFG.skip).
 *         도로 완성 후 CFG.road.hold 초 뒤 먼 커브에서 소수의 밝은 입자가 S자 도로를 따라 다가옴.
 * - Technology: 아래로 스크롤마다 한 줄씩 추가(새 줄만 0 → 100%), 위로 스크롤하면 역순으로 한 줄씩 제거, ① 이 사라지면 첫 화면 UI·루프 복귀.
 *         스크롤은 제스처 한 번 = 한 단계 (CFG.gesture: 같은 방향 관성은 무시, 반대 방향은 바로 받음).
 * - 첫 로드(한 번만): 첫 페인트부터 UI 숨김 → 구체 첫 프레임 뒤 헤더 → 티커 '지지직' → 소개 제목·본문 → SCROLL (index.html 인라인 CSS + style.css 의 intro-*)
 * - 확인용: ?scene=sphere|bus|bus-stop|road (또는 0~3) 시작 장면, ?capture 인트로·자동 전환 없음,
 *           ?manual 자동 재생 없이 window.__livebusHero.step(dt) / advance(±1) 로 한 프레임·한 단계씩 (영상 캡처용)
 */
import '../style.css';
import { loadImage, sampleDots, equalize, featherScene, FLOWS, mulberry32 } from './sampleDots.js';
import { createSphere } from './sphere.js';
import sphereArtwork from '../assets/scenes/sphere-figma.png';
import busPng from '../assets/scenes/bus.png';
import busStopPng from '../assets/scenes/bus-stop.png';
import roadPng from '../assets/scenes/road.png';

const SCENES = [
  { name: 'sphere', label: '구체' },
  { name: 'bus', label: '버스', png: busPng, margin: 110, spread: 0.55 },
  { name: 'bus-stop', label: '정류장', png: busStopPng, margin: 170, spread: 0.9 },
  { name: 'road', label: '도로', png: roadPng, margin: 190, spread: 1.0 },
];
const ROAD = 3; // 도로 장면 번호 — 여기서 자동 재생이 멈추고, 이후 스크롤은 Core Technology 문구를 한 줄씩

/**
 * 도로의 S자 경로 (이미지 좌표, 먼 커브 → 화면 아래 바깥).
 * 흐르는 입자는 이 중심선에서 차선 간격(LANE)만큼 옆으로 떨어져 이동한다.
 */
const ROAD_PATH = [[790, 268], [860, 285], [905, 305], [880, 330], [830, 355], [760, 385], [705, 420], [675, 470], [660, 540], [650, 620], [645, 720], [640, 900]];
const LANE = { y: [268, 300, 350, 420, 500, 580, 700, 900], w: [5, 10, 22, 60, 120, 170, 240, 360] }; // 깊이(y)별 차선 간격
const LANES = [-0.5, 0.5, -0.5, 0.5, -1.25, 1.25]; // 차선 중심 (가운데 두 차선이 더 자주)

const CFG = {
  auto: 6.0, // 장면 완성 후 자동 전환까지 (초)
  sphereSize: { landscape: 0.28, portrait: 0.78, maxH: 0.50 },
  burst: { dur: 2.6, stagger: 0.16, outer: 1.15, inner: 0.65, flash: 0.45 },
  skip: 1.4, // 스크롤로 Technology 에 들어갈 때 도로로 이어지는 시간 (초) — 터지는 효과 없이 부드럽게
  core: 2.3, glow: 9.0, glowAlpha: 0.1, haze: 0.8,
  // 도로: 완성 후 hold 초 동안은 정지 화면 → 먼 커브에서 소수의 밝은 입자가 나타나 S자 도로를 따라 다가옴
  road: { hold: 1.4, ramp: 2.5, travelers: 12, trail: 3, spawnEvery: 0.55, durMin: 4.2, durMax: 5.4, accel: 1.7, dimWithText: 0.4 },
  // 스크롤 한 번 = 한 단계 (아래 wheel 처리 참고). gap: 입력이 이만큼 끊기면 새 제스처, kick·rise: 관성 중 다시 크게 튀면 새 제스처
  gesture: { threshold: 30, gap: 140, kick: 30, rise: 2.2, flip: 300 },
  cursor: { yaw: 0.28, pitch: 0.18, omega: 3.0, r: 85, push: 5.0, spring: 0.07, damping: 0.8, maxOff: 34 },
};

const q = new URLSearchParams(location.search);
const MANUAL = q.has('manual');
const CAPTURE = q.has('capture') || MANUAL;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const mount = document.getElementById('app');

(async () => {
  // ── 데이터 ────────────────────────────────────────────────────
  const imgScenes = SCENES.filter(scene => scene.png);
  const [sphereImage, ...imgs] = await Promise.all([sphereArtwork, ...imgScenes.map(s => s.png)].map(loadImage));
  const dots = imgs.map((im, i) => featherScene(sampleDots(im, 11 + i * 97), { margin: imgScenes[i].margin, spread: imgScenes[i].spread, flow: FLOWS[imgScenes[i].name], seed: 301 + i * 53 }));
  const IW = imgs[0].naturalWidth, IH = imgs[0].naturalHeight;
  const eq = equalize(dots, 2026);
  const N = eq.N;
  // 장면 배열: 0 = 구체(매 프레임 계산), 1~3 = 이미지 장면
  const sphereXY = new Float32Array(N * 2), sphereCol = new Float32Array(N * 3);
  const scenes = [{ xy: sphereXY, col: sphereCol }, ...eq.scenes];
  // 구체에서 보이는 점은 버스의 밝은 자리로 가는 입자에 우선 배정 → 구체의 띠가 그대로 버스 윤곽이 됨
  const busCol = eq.scenes[0].col;
  const order = new Uint32Array(N);
  for (let i = 0; i < N; i++) order[i] = i;
  const busB = (i) => Math.max(busCol[i * 3], busCol[i * 3 + 1], busCol[i * 3 + 2]);
  const rnd = mulberry32(77);
  const key = new Float32Array(N); for (let i = 0; i < N; i++) key[i] = busB(i) + rnd() * 0.25;
  order.sort((a, b) => key[b] - key[a]);
  const sphere = createSphere(N, order, sampleDots(sphereImage, 4242), mulberry32(4242));

  // 피사체 영역 (세로 화면 맞춤용)
  const BOX = (() => {
    const xs = [], ys = [];
    for (const d of dots) for (let i = 0; i < d.count; i += 3) if (Math.max(d.rgb[i * 3], d.rgb[i * 3 + 1], d.rgb[i * 3 + 2]) > 0.35) { xs.push(d.x[i]); ys.push(d.y[i]); }
    xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
    const p = (a, t) => a[Math.floor((a.length - 1) * t)];
    const x0 = p(xs, 0.01), x1 = p(xs, 0.99), y0 = p(ys, 0.01), y1 = p(ys, 0.99);
    return { w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  })();

  // ── WebGL ─────────────────────────────────────────────────────
  const canvas = document.createElement('canvas');
  mount.appendChild(canvas);
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: MANUAL });
  const mk = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw gl.getShaderInfoLog(o); return o; };
  const link = (v, f) => { const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, v)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, f)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw gl.getProgramInfoLog(p); return p; };

  const prog = link(`
    attribute vec2 aPos; attribute vec3 aCol;
    uniform vec2 uView; uniform float uFit; uniform vec2 uOff; uniform float uSize; uniform float uDpr; uniform float uGlow;
    varying vec3 vCol; varying float vB;
    void main(){
      vec2 s = aPos * uFit + uOff;
      gl_Position = vec4(s.x / uView.x * 2.0 - 1.0, 1.0 - s.y / uView.y * 2.0, 0.0, 1.0);
      float b = max(aCol.r, max(aCol.g, aCol.b));
      vCol = aCol; vB = b;
      float sz = uSize * uFit * uDpr;
      gl_PointSize = uGlow > 0.5 ? sz * (0.35 + 0.65 * min(b, 1.0)) : max(1.0, sz * (0.6 + 0.6 * min(b, 2.6)));
    }`, `
    precision highp float;
    uniform float uGlow; uniform float uGA; varying vec3 vCol; varying float vB;
    void main(){
      float r = length(gl_PointCoord - 0.5) * 2.0;
      if (r > 1.0) discard;
      if (uGlow > 0.5) {
        float a = exp(-r * r * 3.5) * uGA * vB * vB;
        vec3 hue = mix(vec3(0.04, 0.40, 1.0), vCol / max(vB, 1e-3), 0.25);
        gl_FragColor = vec4(hue * a, 1.0);
      } else {
        float a = smoothstep(1.0, 0.35, r);
        gl_FragColor = vec4(vCol * vec3(0.78, 0.94, 1.06) * a, 1.0);
      }
    }`);
  const hprog = link(`
    attribute vec2 aQ; uniform vec2 uView; uniform float uFit; uniform vec2 uOff; uniform vec2 uImg; varying vec2 vUv;
    void main(){ vUv = aQ; vec2 s = aQ * uImg * uFit + uOff; gl_Position = vec4(s.x / uView.x * 2.0 - 1.0, 1.0 - s.y / uView.y * 2.0, 0.0, 1.0); }`, `
    precision highp float; uniform sampler2D uT; uniform float uK; varying vec2 vUv;
    void main(){ gl_FragColor = vec4(texture2D(uT, vUv).rgb * uK, 1.0); }`);
  const U = (p) => (n) => gl.getUniformLocation(p, n);
  const PU = U(prog), HU = U(hprog);

  const pos = new Float32Array(N * 2), col = new Float32Array(N * 3);
  const bPos = gl.createBuffer(), bCol = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bPos); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, bCol); gl.bufferData(gl.ARRAY_BUFFER, col, gl.DYNAMIC_DRAW);
  const LA = [gl.getAttribLocation(prog, 'aPos'), gl.getAttribLocation(prog, 'aCol')];
  const qb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, qb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const aQ = gl.getAttribLocation(hprog, 'aQ');
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);

  // 빛 번짐 레이어: 경계를 녹인 점들을 저해상도로 찍고 흐림 → 네모난 번짐이 생기지 않음
  const HW = Math.round(IW / 2), HH = Math.round(IH / 2);
  const hazeTex = [null, ...dots.map((d) => {
    const acc = new Float32Array(HW * HH * 3);
    for (let i = 0; i < d.count; i++) {
      const x = Math.floor(d.x[i] / 2), y = Math.floor(d.y[i] / 2);
      if (x < 0 || y < 0 || x >= HW || y >= HH) continue;
      const j = (y * HW + x) * 3;
      acc[j] += d.rgb[i * 3] * 0.8; acc[j + 1] += d.rgb[i * 3 + 1] * 0.8; acc[j + 2] += d.rgb[i * 3 + 2] * 0.8;
    }
    boxBlur(acc, HW, HH, 3); boxBlur(acc, HW, HH, 3); boxBlur(acc, HW, HH, 3);
    const u8 = new Uint8Array(HW * HH * 3);
    for (let i = 0; i < u8.length; i++) u8[i] = Math.min(255, Math.max(0, acc[i] * 255 - 4));
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, HW, HH, 0, gl.RGB, gl.UNSIGNED_BYTE, u8);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return t;
  })];

  let W, H, dpr, fit, offX, offY, sR, sCX, sCY;
  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); gl.viewport(0, 0, canvas.width, canvas.height);
    // 가로 화면: 원본 비율 그대로 / 세로 화면: 피사체 영역이 폭의 94%
    if (W >= H) { fit = Math.min(W / IW, H / IH); offX = (W - IW * fit) / 2; offY = (H - IH * fit) / 2; }
    else { fit = Math.min((W * 0.94) / BOX.w, (H * 0.8) / BOX.h); offX = W / 2 - BOX.cx * fit; offY = H / 2 - BOX.cy * fit; }
    // 구체: 화면 너비 대비 지름, 중심은 화면 가운데
    const S = CFG.sphereSize;
    const diam = Math.min(W * (W >= H ? S.landscape : S.portrait), H * S.maxH);
    sR = diam / 2 / fit; sCX = (W * 0.492 - offX) / fit; sCY = (H * 0.482 - offY) / fit;
  }
  addEventListener('resize', resize); resize();

  // ── 상태 ─────────────────────────────────────────────────────
  const rand = Math.random;
  const ph = new Float32Array(N), sp = new Float32Array(N), delay = new Float32Array(N), sdx = new Float32Array(N), sdy = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    ph[i] = rand() * 6.283; sp[i] = 0.6 + rand() * 1.6; delay[i] = rand();
    const a = rand() * 6.283, r = 0.35 + rand() * 0.65; sdx[i] = Math.cos(a) * r; sdy[i] = Math.sin(a) * r;
  }
  const bx = new Float32Array(N), by = new Float32Array(N); // 전환 순간 튀어나가는 벡터
  const ax = new Float32Array(N * 2), ac = new Float32Array(N * 3); // 전환 시작 시점의 출발 위치·색 (구체는 움직이므로 저장)
  const off = new Float32Array(N * 2), vel = new Float32Array(N * 2);

  let cur = 0, from = 0, tStart = -1e9, idleSince = 0, clock = 0, introStart = 0, style = 'burst';
  if (q.has('scene')) { const v = q.get('scene'); const k = /^\d+$/.test(v) ? +v : SCENES.findIndex((s) => s.name === v); if (k >= 0 && k < SCENES.length) cur = from = k; }
  if ((q.has('capture') && !q.has('intro')) || reduce || cur !== 0) introStart = -100; // ?manual 은 인트로 재생 // 인트로 생략
  canvas.setAttribute('role', 'img');
  const isSphere = (index) => index === 0;
  // Core Technology 문구 (도로 위에 한 줄씩)
  const technology = document.querySelector('.technology');
  const techLines = [...technology.querySelectorAll('.tech-line')];
  let textStep = 0;
  // n 줄까지 보이게: 새로 켜지는 줄만 0 → 100% 페이드인, 이전 줄은 100% 유지 / 위로 가면 마지막 줄부터 꺼짐
  function setText(n) {
    textStep = Math.max(0, Math.min(techLines.length, n));
    techLines.forEach((el, i) => el.classList.toggle('is-on', i < textStep));
    technology.setAttribute('aria-hidden', String(textStep === 0));
    document.body.dataset.tech = String(textStep);
    canvas.setAttribute('aria-label', textStep ? 'Core Technology' : SCENES[cur].label);
  }
  const label = () => { document.body.dataset.scene = SCENES[cur].name; canvas.setAttribute('aria-label', SCENES[cur].label); };
  label(); setText(0);

  const trDur = () => (style === 'burst' ? CFG.burst.dur : style === 'skip' ? CFG.skip : 0.6);
  const busy = () => clock - tStart < trDur();
  /** force: 전환 중이어도 지금 보이는 위치에서 바로 출발 (스크롤로 Technology 진입) */
  function go(i, force = false) {
    i = (i + SCENES.length) % SCENES.length;
    if (i === cur) return; // 이미 그 장면이거나 그 장면으로 가는 중
    if (!force && busy()) return;
    if (cur === ROAD && i !== ROAD) { setText(0); leaveRoad(); }
    from = cur; cur = i; tStart = clock;
    style = reduce ? 'fade' : force ? 'skip' : 'burst';
    // 출발 상태 저장 + 튀어나갈 방향 (출발 장면의 중심에서 바깥으로, 바깥 점일수록 멀리)
    const A = scenes[from];
    let cx = sCX, cy = sCY, R = sR;
    if (!isSphere(from)) { const b = dots[from - 1].box; cx = b.cx; cy = b.cy; R = Math.max(b.w, b.h) / 2; }
    for (let i2 = 0; i2 < N; i2++) {
      const x = pos[i2 * 2], y = pos[i2 * 2 + 1];
      ax[i2 * 2] = x; ax[i2 * 2 + 1] = y;
      ac[i2 * 3] = col[i2 * 3]; ac[i2 * 3 + 1] = col[i2 * 3 + 1]; ac[i2 * 3 + 2] = col[i2 * 3 + 2];
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1;
      const rr = Math.min(1.3, d / R);
      const a = Math.atan2(dy, dx) + (rand() - 0.5) * 0.7;
      const m = R * (CFG.burst.inner + CFG.burst.outer * Math.pow(rr, 1.6) * (0.6 + 0.6 * rand()));
      bx[i2] = Math.cos(a) * m; by[i2] = Math.sin(a) * m;
    }
    void A;
    if ((style === 'burst' || style === 'skip') && !isSphere(cur)) matchTargets(cx, cy, R); // 방향이 같은 자리끼리 짝지어 엉키지 않게
    label();
  }

  /**
   * 전환 짝 다시 맞추기: 지금 보이는 점은 다음 장면의 밝은 자리(윤곽)로, 숨은 점은 흐린 자리로.
   * 각 그룹 안에서는 화면상 방향(각도)·거리 순으로 맞춰서, 왼쪽 위 점은 왼쪽 위로 가게 한다.
   * → 무작위 짝일 때 생기는 '뭉개진 구름' 없이 튀었다가 곧바로 윤곽이 잡힌다. (다음 장면 배열을 재배치)
   */
  function matchTargets(cx, cy, R) {
    const B = scenes[cur];
    const bb = cur === 0 ? { cx: sCX, cy: sCY, w: sR * 2, h: sR * 2 } : dots[cur - 1].box;
    const tb = (j) => Math.max(B.col[j * 3], B.col[j * 3 + 1], B.col[j * 3 + 2]);
    const vis = [], hid = [];
    for (let i = 0; i < N; i++) (Math.max(col[i * 3], col[i * 3 + 1], col[i * 3 + 2]) > 0.02 ? vis : hid).push(i);
    const tgt = Array.from({ length: N }, (_, j) => j).sort((a, b) => tb(b) - tb(a));
    const tv = tgt.slice(0, vis.length), th = tgt.slice(vis.length);
    const keyA = (i) => { const dx = (ax[i * 2] - cx) / R, dy = (ax[i * 2 + 1] - cy) / R; return Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * 48) * 10 + Math.min(9.9, Math.hypot(dx, dy) * 4); };
    const keyB = (j) => { const dx = (B.xy[j * 2] - bb.cx) / (bb.w / 2), dy = (B.xy[j * 2 + 1] - bb.cy) / (bb.h / 2); return Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * 48) * 10 + Math.min(9.9, Math.hypot(dx, dy) * 4); };
    const map = new Int32Array(N);
    for (const [src, dst] of [[vis, tv], [hid, th]]) {
      const a = src.map((i) => [keyA(i), i]).sort((p, q2) => p[0] - q2[0]);
      const b = dst.map((j) => [keyB(j), j]).sort((p, q2) => p[0] - q2[0]);
      for (let k = 0; k < a.length; k++) map[a[k][1]] = b[k][1];
    }
    if (cur === 0) return; // 구체는 위치가 계산되므로 재배치하지 않음
    const nxy = new Float32Array(N * 2), ncol = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { const j = map[i]; nxy[i * 2] = B.xy[j * 2]; nxy[i * 2 + 1] = B.xy[j * 2 + 1]; ncol[i * 3] = B.col[j * 3]; ncol[i * 3 + 1] = B.col[j * 3 + 1]; ncol[i * 3 + 2] = B.col[j * 3 + 2]; }
    B.xy.set(nxy); B.col.set(ncol);
  }

  // 스크롤 · 스와이프 · 키보드 — 제스처 한 번에 한 단계
  // 루프와 스크롤 진입 분리: 스크롤하지 않으면 구체 → 버스 → 정류장 → 도로 → 구체 반복.
  // 아래로 스크롤하면 어느 장면(전환 중 포함)에서든 바로 도로로 모이며 Technology 시작. 도로가 배경으로 유지됨.
  // Technology 안에서는 아래로 = 한 줄 추가(① → ② → ③), 위로 = 마지막 줄부터 하나씩 제거, ① 이 사라지면 첫 화면 UI·루프 복귀.
  function advance(dir) {
    if (dir < 0 && textStep === 0) return false; // 첫 화면에서 위로: 아무 일 없음 (루프 계속)
    if (dir > 0 && textStep === 0 && (cur !== ROAD || busy())) go(ROAD, true);
    setText(textStep + Math.sign(dir));
    if (textStep === 0) idleSince = Math.max(clock, tStart + trDur()); // 첫 섹션으로 돌아오면 그 장면부터 루프 다시 셈
    return true;
  }
  document.querySelector('.scroll-next')?.addEventListener('click', () => advance(1));
  document.querySelector('.brand')?.addEventListener('click', () => { setText(0); idleSince = clock; go(0, true); }); // 전환 중에도 바로 구체로
  /**
   * 휠 제스처 → 한 단계. 휠 한 칸·짧은 스와이프 한 번 = 한 단계.
   *  - 한 단계 넘긴 뒤 같은 방향 입력은 '관성'으로 보고 무시 (잠금)
   *  - 잠금 해제: ① 반대 방향 입력 (관성은 방향이 바뀌지 않으므로 의도적인 전환) → 바로 받음
   *              ② 입력이 G.gap ms 끊겼다가 다시 옴 (휠 한 칸씩 끊어 굴림)
   *              ③ 줄어들던 입력(관성)이 바닥에서 다시 크게 올라옴 (관성 꼬리 중 새 스와이프)
   */
  const G = CFG.gesture, gs = { locked: false, dir: 0, last: -1e9, acc: 0, peak: 0, valley: 0, revAt: -1e9 };
  addEventListener('wheel', (e) => {
    e.preventDefault();
    const now = performance.now();
    const d = e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? innerHeight : 1);
    if (!d) return;
    const dir = Math.sign(d), ad = Math.abs(d);
    const gap = now - gs.last;
    gs.last = now;
    // 방향을 바꾼 직후 들어오는 이전 방향의 작은 관성 꼬리는 무시
    if (now - gs.revAt < G.flip && dir !== gs.dir && ad < G.kick) return;
    if (gs.locked) {
      const reversed = dir !== gs.dir;
      if (reversed) gs.revAt = now;
      // 관성은 정점 이후 줄어들기만 함 → 바닥(valley)에서 다시 크게 올라오면 새 스와이프
      const fresh = gap > G.gap || (ad > G.kick && ad > gs.valley * G.rise);
      if (!reversed && !fresh) {
        if (ad >= gs.peak) gs.peak = gs.valley = ad; else gs.valley = Math.min(gs.valley, ad);
        return;
      }
      gs.locked = false; gs.acc = 0;
    } else if (gap > G.gap || Math.sign(gs.acc) !== dir) gs.acc = 0;
    gs.acc += d;
    if (Math.abs(gs.acc) >= G.threshold) { advance(dir); gs.locked = true; gs.dir = dir; gs.acc = 0; gs.peak = gs.valley = ad; }
  }, { passive: false });
  let ty0 = null;
  addEventListener('touchstart', (e) => { ty0 = e.touches[0].clientY; }, { passive: true });
  addEventListener('touchend', (e) => { if (ty0 === null) return; const d = ty0 - e.changedTouches[0].clientY; if (Math.abs(d) > 40) advance(Math.sign(d)); ty0 = null; }, { passive: true });
  addEventListener('keydown', (e) => { if (e.repeat || e.target.closest?.('button, a')) return; if (['ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); advance(1); } if (['ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); advance(-1); } });

  // ── 도로를 따라 흐르는 입자 ────────────────────────────────────
  // 도로 장면의 가장 흐린 점 몇 개를 빌려 와서, 먼 커브에서 작고 느리게 시작해 가까울수록 빨라지며 화면 아래로 빠져나가게 한다.
  const RC = CFG.road;
  const pathLen = [0];
  for (let k = 1; k < ROAD_PATH.length; k++) pathLen.push(pathLen[k - 1] + Math.hypot(ROAD_PATH[k][0] - ROAD_PATH[k - 1][0], ROAD_PATH[k][1] - ROAD_PATH[k - 1][1]));
  const totalLen = pathLen[pathLen.length - 1];
  function pathAt(s, out) { // s: 0..1 → 위치·접선 (모서리는 이웃 구간과 섞어 부드럽게)
    const L = s * totalLen;
    let k = 1; while (k < pathLen.length - 1 && pathLen[k] < L) k++;
    const a = ROAD_PATH[k - 1], b = ROAD_PATH[k], t = (L - pathLen[k - 1]) / (pathLen[k] - pathLen[k - 1] || 1);
    out.x = a[0] + (b[0] - a[0]) * t; out.y = a[1] + (b[1] - a[1]) * t;
    const c = ROAD_PATH[Math.min(ROAD_PATH.length - 1, k + 1)], tx0 = b[0] - a[0], ty0_ = b[1] - a[1], tx1 = c[0] - b[0], ty1 = c[1] - b[1];
    out.tx = tx0 * (1 - t) + tx1 * t; out.ty = ty0_ * (1 - t) + ty1 * t;
    const l = Math.hypot(out.tx, out.ty) || 1; out.tx /= l; out.ty /= l;
    return out;
  }
  const laneW = (y) => { const Y = LANE.y, Wd = LANE.w; if (y <= Y[0]) return Wd[0]; for (let k = 1; k < Y.length; k++) if (y < Y[k]) return Wd[k - 1] + (Wd[k] - Wd[k - 1]) * (y - Y[k - 1]) / (Y[k] - Y[k - 1]); return Wd[Wd.length - 1]; };
  const trSlot = new Int16Array(N).fill(-1); // 입자 → (주자 번호 * trail + 꼬리 순번)
  const runners = Array.from({ length: RC.travelers }, () => ({ on: false, t0: 0, dur: 5, lane: 0, jitter: 0 }));
  let roadAt = -1, nextSpawn = 0, trDim = 1;
  const pt = { x: 0, y: 0, tx: 0, ty: 1 };
  function enterRoad() {
    roadAt = clock; nextSpawn = clock + RC.hold;
    const R3 = scenes[ROAD].col, idx = [];
    for (let i = 0; i < N; i++) idx.push(i);
    idx.sort((a, b) => (R3[a * 3] + R3[a * 3 + 1] + R3[a * 3 + 2]) - (R3[b * 3] + R3[b * 3 + 1] + R3[b * 3 + 2]));
    trSlot.fill(-1);
    for (let k = 0; k < RC.travelers * RC.trail; k++) trSlot[idx[k]] = k;
    runners.forEach((r) => (r.on = false));
  }
  function leaveRoad() { roadAt = -1; trSlot.fill(-1); runners.forEach((r) => (r.on = false)); }
  function updateRunners() {
    if (roadAt < 0) return;
    const since = clock - roadAt - RC.hold;
    if (since > 0 && clock >= nextSpawn) {
      const free = runners.find((r) => !r.on);
      if (free) {
        free.on = true; free.t0 = clock; free.dur = RC.durMin + rand() * (RC.durMax - RC.durMin);
        free.lane = LANES[Math.floor(rand() * LANES.length)]; free.jitter = (rand() - 0.5) * 0.25;
      }
      const rate = Math.max(0.45, Math.min(1, since / RC.ramp)); // 처음엔 드물게, 점점 일정한 간격으로
      nextSpawn = clock + (RC.spawnEvery * (0.6 + 0.8 * rand())) / rate;
    }
    for (const r of runners) if (r.on && clock - r.t0 > r.dur) r.on = false;
    trDim += ((textStep > 0 ? RC.dimWithText : 1) - trDim) * 0.06;
  }
  /** 흐르는 입자 위치·밝기 (없으면 false) */
  function runnerAt(k, o) {
    const r = runners[Math.floor(k / RC.trail)], tail = k % RC.trail;
    if (!r.on) return false;
    const u = (clock - r.t0) / r.dur;
    const s0 = Math.pow(u, RC.accel); // 멀리서 느리게 → 가까울수록 빨라짐
    const s = Math.max(0, s0 - tail * 0.014 * (0.35 + 1.4 * s0)); // 꼬리: 가까울수록 길게
    pathAt(s, pt);
    const off = (r.lane + r.jitter) * laneW(pt.y);
    o.x = pt.x - pt.ty * off; o.y = pt.y + pt.tx * off;
    const fade = Math.min(1, u / 0.14) * (tail === 0 ? 1 : tail === 1 ? 0.45 : 0.2);
    o.b = fade * (1.0 + 1.6 * s) * trDim; // 밝기가 크기도 정함: 멀리 작게 → 가까이 크게
    return true;
  }
  const ro = { x: 0, y: 0, b: 0 };

  // 커서: 화면 기준 -1..1 (방향 회전용) + 이미지 좌표 (점 갈라짐용)
  const m = { nx: 0, ny: 0, x: -1e4, y: -1e4, on: false, speed: 0, lx: null, ly: null };
  function setPointer(cx, cy) {
    const x = (cx - offX) / fit, y = (cy - offY) / fit;
    if (m.lx !== null) m.speed = Math.min(1, m.speed + Math.hypot(x - m.lx, y - m.ly) / 90);
    m.lx = x; m.ly = y; m.x = x; m.y = y; m.on = true;
    m.nx = (cx / W) * 2 - 1; m.ny = (cy / H) * 2 - 1;
  }
  addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') setPointer(e.clientX, e.clientY); }, { passive: true });
  document.addEventListener('pointerleave', () => { m.on = false; });
  const spring = { yaw: 0, pitch: 0, vy: 0, vp: 0 };

  const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

  function step(dt) {
    clock += dt;
    if (!busy()) {
      if (idleSince < tStart + trDur()) idleSince = clock;
      if (cur === ROAD && roadAt < 0) enterRoad();
      if (!CAPTURE && !textStep && clock - idleSince > CFG.auto) go(cur + 1);
    }
    updateRunners();
    const T = clock - tStart;

    // 커서 → 구체 방향 (임계 감쇠 스프링, 커서가 화면 밖이면 정면으로)
    const C = CFG.cursor, w = C.omega;
    const tyaw = m.on ? m.nx * C.yaw : 0, tpit = m.on ? m.ny * C.pitch : 0;
    spring.vy += (w * w * (tyaw - spring.yaw) - 2 * w * spring.vy) * dt; spring.yaw += spring.vy * dt;
    spring.vp += (w * w * (tpit - spring.pitch) - 2 * w * spring.vp) * dt; spring.pitch += spring.vp * dt;
    m.speed *= Math.exp(-dt * 4.5);

    // 구체 (보이는 장면이거나 전환 상대일 때만 계산)
    if (isSphere(cur) || isSphere(from)) {
      sphere.update({ t: clock, cx: sCX, cy: sCY, R: sR, yaw: spring.yaw, pitch: spring.pitch, introT: clock - introStart, speed: reduce ? 0.3 : 1 }, sphereXY, sphereCol);
    }

    const B = scenes[cur];
    const R2 = C.r * C.r, push = C.push * m.speed;
    const moving = from !== cur && busy();
    const BU = CFG.burst;
    for (let i = 0; i < N; i++) {
      const i2 = i * 2, i3 = i * 3;
      let x, y, cr, cg, cb;
      const tb = Math.max(B.col[i3], B.col[i3 + 1], B.col[i3 + 2]);
      if (!moving) {
        x = B.xy[i2]; y = B.xy[i2 + 1]; cr = B.col[i3]; cg = B.col[i3 + 1]; cb = B.col[i3 + 2];
        if (!reduce && !isSphere(cur)) {
          const u = x / IW, v = y / IH;
          let light = 1;
          if (cur === 1) {
            const front = u > 0.4;
            const rx = front ? 0.025 : 0.014, ry = front ? 0.062 : 0.045;
            const dx = (u - (front ? 0.493 : 0.279)) / rx;
            const dy = (v - (front ? 0.715 : 0.705)) / ry;
            if (dx * dx + dy * dy < 1) {
              const angle = clock * 1.8;
              x += ((Math.cos(angle)-1)*dx - Math.sin(angle)*dy) * IW * rx;
              y += (Math.sin(angle)*dx + (Math.cos(angle)-1)*dy) * IH * ry;
            } else if (v > 0.81) {
              x -= 85 * ((clock * 0.65 + delay[i]) % 1);
            } else if (v > 0.38 && v < 0.63) {
              light += 0.7 * Math.pow(Math.max(0, Math.cos(u * 14 + clock * 2)), 12);
            }
          } else if (cur === 2) {
            if (v > 0.72 || (v > 0.28 && v < 0.43))
              light += 0.85 * Math.pow(Math.max(0, Math.cos(u * 19 - clock * 1.6)), 5);
            if ((u < 0.29 || u > 0.71) && v < 0.63)
              x += 4 * Math.sin(clock * 1.5 + v * 11);
          }
          cr *= light; cg *= light; cb *= light;
        }
      } else if (style === 'burst') {
        const p = clamp01((T - delay[i] * BU.stagger) / (BU.dur - BU.stagger));
        const e = easeIO(clamp01((p - 0.31) / 0.69));
        const pulse = (1 - Math.pow(1 - clamp01(p / 0.27), 3)) * (1 - e);
        x = ax[i2] + (B.xy[i2] - ax[i2]) * e + bx[i] * pulse;
        y = ax[i2 + 1] + (B.xy[i2 + 1] - ax[i2 + 1]) * e + by[i] * pulse;
        const lift = 1 + BU.flash * pulse;
        cr = (ac[i3] + (B.col[i3] - ac[i3]) * e) * lift; cg = (ac[i3 + 1] + (B.col[i3 + 1] - ac[i3 + 1]) * e) * lift; cb = (ac[i3 + 2] + (B.col[i3 + 2] - ac[i3 + 2]) * e) * lift;
      } else {
        // skip(스크롤 진입): 터지지 않고 지금 위치에서 도로 자리로 부드럽게 (점마다 출발을 조금씩 어긋냄) / fade: 동작 줄이기
        const e = style === 'skip' ? easeIO(clamp01((T - delay[i] * 0.25) / (CFG.skip - 0.25))) : clamp01(T / 0.6);
        x = ax[i2] + (B.xy[i2] - ax[i2]) * e; y = ax[i2 + 1] + (B.xy[i2 + 1] - ax[i2 + 1]) * e;
        cr = ac[i3] + (B.col[i3] - ac[i3]) * e; cg = ac[i3 + 1] + (B.col[i3 + 1] - ac[i3 + 1]) * e; cb = ac[i3 + 2] + (B.col[i3 + 2] - ac[i3 + 2]) * e;
      }
      // 도로: 빌려 온 점은 S자 도로를 따라 흐르는 입자로 (차선·가드레일·가로등은 제자리)
      if (!moving && cur === ROAD && trSlot[i] >= 0) {
        if (runnerAt(trSlot[i], ro)) { x = ro.x; y = ro.y; cr = 0.82 * ro.b; cg = 0.97 * ro.b; cb = ro.b; } else { cr = cg = cb = 0; }
      }
      // 커서가 스치면 근처 점만 갈라졌다가 스프링으로 복귀 (커서가 멈추면 힘 없음)
      let vx = vel[i2] - off[i2] * C.spring, vy = vel[i2 + 1] - off[i2 + 1] * C.spring;
      if (m.on && push > 0.01) {
        const dx = x + off[i2] - m.x, dy = y + off[i2 + 1] - m.y, d2 = dx * dx + dy * dy;
        if (d2 < R2) { const d = Math.sqrt(d2) + 0.01, k = 1 - d / C.r, f = (k * k * push) / d; vx += dx * f; vy += dy * f; }
      }
      vx *= C.damping; vy *= C.damping; vel[i2] = vx; vel[i2 + 1] = vy;
      let ox = off[i2] + vx, oy = off[i2 + 1] + vy; const om = Math.hypot(ox, oy); if (om > C.maxOff) { ox *= C.maxOff / om; oy *= C.maxOff / om; }
      off[i2] = ox; off[i2 + 1] = oy;
      pos[i2] = x + ox; pos[i2 + 1] = y + oy;
      const tw = cur === 0 && !moving ? 1 : 0.86 + 0.14 * Math.sin(clock * sp[i] * 1.8 + ph[i]);
      col[i3] = cr * tw; col[i3 + 1] = cg * tw; col[i3 + 2] = cb * tw;
    }
    render(moving ? clamp01(T / trDur()) : 1);
  }

  function drawHaze(tex, k) {
    if (!tex || k <= 0.001) return;
    gl.useProgram(hprog);
    gl.uniform2f(HU('uView'), W, H); gl.uniform1f(HU('uFit'), fit); gl.uniform2f(HU('uOff'), offX, offY); gl.uniform2f(HU('uImg'), IW, IH); gl.uniform1f(HU('uK'), k);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(HU('uT'), 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, qb); gl.enableVertexAttribArray(aQ); gl.vertexAttribPointer(aQ, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  function render(hp) {
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    // 빛 번짐: 이전 장면은 전환 앞부분에서 사라지고, 다음 장면은 뒷부분에서 나타남
    if (from !== cur && hp < 1) drawHaze(hazeTex[from], CFG.haze * Math.max(0, 1 - hp * 3));
    drawHaze(hazeTex[cur], CFG.haze * (from === cur || hp >= 1 ? 1 : clamp01((hp - 0.55) / 0.45)));
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, bPos); gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos); gl.enableVertexAttribArray(LA[0]); gl.vertexAttribPointer(LA[0], 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bCol); gl.bufferSubData(gl.ARRAY_BUFFER, 0, col); gl.enableVertexAttribArray(LA[1]); gl.vertexAttribPointer(LA[1], 3, gl.FLOAT, false, 0, 0);
    gl.uniform2f(PU('uView'), W, H); gl.uniform1f(PU('uFit'), fit); gl.uniform2f(PU('uOff'), offX, offY); gl.uniform1f(PU('uDpr'), dpr);
    gl.uniform1f(PU('uGlow'), 1); gl.uniform1f(PU('uGA'), CFG.glowAlpha); gl.uniform1f(PU('uSize'), CFG.glow); gl.drawArrays(gl.POINTS, 0, N);
    gl.uniform1f(PU('uGlow'), 0); gl.uniform1f(PU('uSize'), CFG.core); gl.drawArrays(gl.POINTS, 0, N);
  }

  // 첫 프레임 위치 확정 (전환 출발점이 비지 않게)
  step(0);
  /**
   * 첫 로드 한 번: index.html 이 첫 페인트부터 UI 를 숨겨 둔다(intro-pending).
   * 구체 첫 프레임이 화면에 그려진 다음 프레임에 intro-play 를 붙여 헤더 → 티커 글리치 → 소개 문구 → SCROLL 순으로 보여 주고,
   * 마지막(SCROLL) 애니메이션이 끝나면 두 클래스를 모두 뗀다 → 다시 재생되지 않음. 고정 타이머로 먼저 드러내지 않는다.
   */
  const root = document.documentElement;
  function startIntro() {
    if (!root.classList.contains('intro-pending')) return;
    if (introStart !== 0) { root.classList.remove('intro-pending'); return; } // 인트로 없는 시작(?scene=, 동작 줄이기)
    glitchTicker();
    root.classList.add('intro-play');
    const last = document.querySelector('.scroll-next');
    const done = (e) => { if (e && e.animationName !== 'intro-scroll') return; root.classList.remove('intro-play', 'intro-pending'); last?.removeEventListener('animationend', done); };
    last ? last.addEventListener('animationend', done) : done();
  }
  /**
   * 티커 '지지직': 티커를 두 장 더 겹쳐 얇은 가로 조각만 보이게 하고(clip-path), 그 조각을 좌우로 한두 번 어긋냈다가 맞춘 뒤 지운다.
   * 겹친 조각은 원래 티커의 흐름(marquee)과 같은 시점으로 맞춰서, 자리 잡은 뒤 흐름이 끊기지 않는다. 첫 로드에만.
   */
  function glitchTicker() {
    const head = document.querySelector('.headline'), base = head?.querySelector('.ticker');
    if (!base || reduce) return;
    const baseAnim = base.getAnimations()[0];
    ['a', 'b'].forEach((k) => {
      const slice = base.cloneNode(true);
      slice.classList.add('ticker-slice', `ticker-slice-${k}`);
      head.appendChild(slice);
      const marquee = slice.getAnimations().find((a) => a.animationName === 'marquee');
      if (marquee && baseAnim) marquee.currentTime = baseAnim.currentTime;
      slice.addEventListener('animationend', (e) => { if (e.animationName.startsWith('ticker-slice')) slice.remove(); });
    });
  }

  window.__livebusHero = { go, step, advance, get textStep() { return textStep; }, get runners() { return runners.filter((r) => r.on).length; }, setPointer, parted: () => { let n = 0; for (let i = 0; i < N; i++) if (Math.hypot(off[i * 2], off[i * 2 + 1]) > 4) n++; return n; }, get scene() { return SCENES[cur].name; }, get busy() { return busy(); }, N };
  if (!MANUAL) {
    let last = performance.now(), frames = 0;
    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now; step(dt);
      if (++frames === 1) startIntro(); // 구체 첫 프레임이 그려진 뒤
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  } else startIntro();
})().catch((err) => {
  // 로딩 실패(이미지·WebGL 등): 숨겨 둔 UI 를 그대로 보여 줘서 내용은 읽을 수 있게
  document.documentElement.classList.remove('intro-pending', 'intro-play');
  console.error('[livebus hero]', err);
});

/** 가로·세로 박스 블러 (반지름 r) — 세 번 겹치면 가우시안에 가까움 */
function boxBlur(a, w, h, r) {
  const tmp = new Float32Array(a.length), n = 2 * r + 1;
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < h; y++) {
      let s = 0;
      for (let x = -r; x <= r; x++) s += a[(y * w + Math.min(w - 1, Math.max(0, x))) * 3 + c];
      for (let x = 0; x < w; x++) {
        tmp[(y * w + x) * 3 + c] = s / n;
        s += a[(y * w + Math.min(w - 1, x + r + 1)) * 3 + c] - a[(y * w + Math.max(0, x - r)) * 3 + c];
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let y = -r; y <= r; y++) s += tmp[(Math.min(h - 1, Math.max(0, y)) * w + x) * 3 + c];
      for (let y = 0; y < h; y++) {
        a[(y * w + x) * 3 + c] = s / n;
        s += tmp[(Math.min(h - 1, y + r + 1) * w + x) * 3 + c] - tmp[(Math.max(0, y - r) * w + x) * 3 + c];
      }
    }
  }
}
