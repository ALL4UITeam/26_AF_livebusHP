/**
 * LIVEBUS 서비스 시연 시안 — /index.html
 *   LIVEBUS → BMS → BIT → BIS → LIVEBUS … 자동 반복. 기존 메인(/, src/hero)과 코드·이미지를 공유하지 않는다.
 *   (도로 배경 이미지 road.png 만 읽기 전용으로 가져와 Technology 배경으로 쓴다)
 *
 * - 장면 점 데이터: tools/build_scenes.py 가 원본 이미지에서 미리 만든 data/*.bin (피사체 기준 크기·중심, 밝기·색조 맞춤)
 * - 무대 좌표 1600×900. 장면 안 정보(글자·핀·선)도 infoLayer 의 점으로 같은 셰이더에서 그린다 → 질감·시차가 이미지와 같음.
 *   .sp-stage 에는 상호작용용 보이지 않는 단추만 있고, 캔버스와 같은 변환으로 맞춘다.
 * - 전환: 확산 0.4초 → 관성 0.3초 → 재결합 1.3초 (CFG.burst). 밝은 윤곽이 먼저, 노선·안내판은 이어서 선명해짐.
 *   전환이 시작되면 이전 장면 웹 요소가 사라지고, 형상이 잡힌 뒤 다음 장면 웹 요소가 나타남 (overlays.js).
 * - 스크롤: 어느 장면에서든 아래로 → 도로 배경 + Core Technology 한 줄씩. ① 이 사라지면 떠났던 장면으로 돌아가 루프 재개.
 * - 확인용: ?scene=0~3 시작 장면, ?manual 자동 재생 없이 window.__sp.step(dt) 로 한 프레임씩
 */
import './style.css'; // 기존 src/style.css 를 복사해 시안 전용 규칙을 더한 파일 (기존 메인과 공유하지 않음)
import meta from './data/scenes.json';
import { loadImage, sampleDots, featherScene, FLOWS } from './lib/sampleDots.js';
import { createOverlays } from './overlays.js';
import { createInfo } from './infoLayer.js';
import { playLogo } from './entry.js';
import { SERVICE_COPY } from './copy.js';
import { createSphere } from '../hero/sphere.js'; // 기존 메인의 구 (읽기 전용으로 재사용)
import sphereArtwork from '../assets/scenes/sphere-figma.png';
import { makePoses } from './poses.js';
import { LIVEBUS, BMS, BIT, BIS, NOTE } from './demo.js';
import conf from './scenes.config.json';

const STORY = { 'libus-1': LIVEBUS, 'bms-2': BMS, 'bit-3': BIT, 'bis-4': BIS };
// 장면별 시간표(demo.js)가 끝나는 시점에 다음 장면으로. 중요한 변화 사이에는 읽을 수 있는 정지 시간이 들어 있다
const LOOP = conf.order.map((name) => ({ name, label: conf.scenes[name].label, hold: STORY[name].hold }));
const INTRO = LOOP.length; // (예전 첫 로드용 흩어진 점 — 지금은 짝 맞추기 예열에만 사용)
const SPHERE = INTRO + 1; // 구 화면 (기존 메인의 구, 매 프레임 계산)

const CFG = {
  burst: { spread: 0.4, coast: 0.3, regroup: 1.3, out: 0.55, coastGain: 0.22, silhouette: 0.35, flash: 0.35 },
  intro: 1.7,
  core: 2.1, glow: 8.5, glowAlpha: 0.1, haze: 0.75,
  parallax: 7, // 커서 시차 (무대 px)
  cursor: { r: 56, push: 1.5, spring: 0.08, damping: 0.8, maxOff: 5 }, // 커서 주변 점: 약하게만 밀림 (형태가 끊어지지 않게 최대 5px)
  gain: 2.3, // 새 입자: 가우시안 중심의 밝기 보정 (개선 전과 전체 밝기를 맞춤)
  infoCore: 1.75, // 장면 안 글자 점 크기 (장면 점 core 2.1 보다 조금 작게: 흐리되 읽히게)
  gesture: { threshold: 30, gap: 220, kick: 30, rise: 2.2, flip: 300 }, // gap: 이만큼 입력이 끊겨야 새 제스처 (관성 꼬리 오인 방지)
};

const q = new URLSearchParams(location.search);
const MANUAL = q.has('manual');
// 입자 표현: 기본은 깊이·빛을 가진 입자(FX). ?fx=old 로 개선 전 표현과 비교
const FX = q.get('fx') !== 'old';
const SMALL = matchMedia('(max-width:700px)').matches || (navigator.hardwareConcurrency || 8) <= 2; // 모바일·저사양: 입자 수·보조 효과 줄임
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
const SW = meta.stage[0], SH = meta.stage[1];

// ── 첫 진입 단계 ──────────────────────────────────────────────────
// html[data-stage]: boot(검정) → logo(로고 한 글자씩) → sphere(구, 스크롤 전까지 유지) → service(LIVEBUS 부터 서비스 루프)
// 로고는 데이터를 받는 동안 바로 시작하고, 구는 로고가 끝나고 + 장면 데이터·구 첫 프레임이 준비된 뒤에 나타난다.
const ROOT = document.documentElement;
const START = ROOT.dataset.stage || 'service';
const logoDone = START === 'boot' ? playLogo({ reduce }) : Promise.resolve();
// Freesentation 600과 Adobe Fonts의 Termina 700을 모두 기다린 뒤 텍스트 표시.
// CSS 등록 전 load()가 빈 배열로 완료되는 일을 막고, 장애 시 최대 4초 후 대체 서체로 표시한다.
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function loadFonts(limit = 4000) {
  const t0 = performance.now();
  const pending = new Set(['freesentation', 'termina']);
  const loading = [];
  while (performance.now() - t0 < limit) {
    for (const family of pending) {
      const faces = [...(document.fonts || [])].filter((f) => f.family.replace(/["']/g, '').toLowerCase() === family);
      if (faces.length) {
        loading.push(...faces.map((f) => f.load().catch(() => null)));
        pending.delete(family);
      }
    }
    if (!pending.size) break;
    await pause(40);
  }
  await Promise.race([Promise.all(loading), pause(Math.max(0, limit - (performance.now() - t0)))]);
}
const fontsReady = loadFonts().then(() => ROOT.classList.add('sp-fonts'));

(async () => {
  // ── 데이터 ─────────────────────────────────────────────────────
  const binUrl = (n) => new URL(`./data/${n}.bin`, import.meta.url).href;
  const hazeUrl = (n) => new URL(`./data/${n}.jpg`, import.meta.url).href;
  const [bins, hazeImgs, sphereImg] = await Promise.all([
    Promise.all(LOOP.map((s) => fetch(binUrl(s.name)).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }))),
    Promise.all(LOOP.map((s) => loadImage(hazeUrl(s.name)))),
    loadImage(sphereArtwork),
  ]);
  const raw = bins.map((buf, k) => {
    const c = meta.scenes[LOOP[k].name].count, u8 = new Uint8Array(buf);
    const x = new Uint16Array(buf, 0, c), y = new Uint16Array(buf, c * 2, c), rgb = u8.subarray(c * 4, c * 7), tag = u8.subarray(c * 7, c * 8), grp = u8.subarray(c * 8, c * 9);
    const o = { count: c, x: new Float32Array(c), y: new Float32Array(c), rgb: new Float32Array(c * 3), tag: new Uint8Array(tag), grp: new Uint8Array(grp) };
    for (let i = 0; i < c; i++) { o.x[i] = x[i] / 32; o.y[i] = y[i] / 32; }
    for (let i = 0; i < c * 3; i++) o.rgb[i] = (rgb[i] / 255) * 1.3;
    return o;
  });
  const N = Math.max(...raw.map((r) => r.count));
  const rnd = mulberry32(2026);
  const scenes = raw.map((s) => {
    const xy = new Float32Array(N * 2), col = new Float32Array(N * 3), tag = new Uint8Array(N), grp = new Uint8Array(N);
    // 점 순서를 섞어 둠 → 앞에서부터 일부만 그려도(모바일) 장면 전체에서 고르게 빠짐 (버스 같은 분리 그룹이 통째로 빠지지 않게)
    const perm = new Uint32Array(N); for (let i = 0; i < N; i++) perm[i] = i;
    for (let i = N - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)), t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
    for (let i = 0; i < N; i++) {
      const pi = perm[i], real = pi < s.count, src = real ? pi : Math.floor(rnd() * s.count); // 모자란 자리는 숨은 점(색 0)
      xy[i * 2] = s.x[src]; xy[i * 2 + 1] = s.y[src]; tag[i] = s.tag[src]; grp[i] = real ? s.grp[src] : 0;
      if (real) { col[i * 3] = s.rgb[src * 3]; col[i * 3 + 1] = s.rgb[src * 3 + 1]; col[i * 3 + 2] = s.rgb[src * 3 + 2]; }
    }
    return { xy, col, tag, grp };
  });
  // 첫 로드용: 피사체 상자 주변에 흩어진 점
  const B = meta.box;
  scenes.push((() => {
    const xy = new Float32Array(N * 2), col = new Float32Array(N * 3), tag = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const a = rnd() * Math.PI * 2, r = 0.45 + Math.sqrt(rnd()) * 0.75;
      xy[i * 2] = B.cx + Math.cos(a) * r * B.w * 0.62; xy[i * 2 + 1] = B.cy + Math.sin(a) * r * B.h * 0.62;
      const k = 0.08 + rnd() * 0.18; col[i * 3] = 0.05 * k; col[i * 3 + 1] = 0.45 * k; col[i * 3 + 2] = k;
    }
    return { xy, col, tag, grp: new Uint8Array(N) };
  })());

  // 구: 기존 메인과 같은 점·움직임(sphere.js). 위치·크기는 기존 메인과 같은 화면 비율 (resize 에서 무대 좌표로)
  const sphereXY = new Float32Array(N * 2), sphereCol = new Float32Array(N * 3);
  const sphereOrder = new Uint32Array(N); for (let i = 0; i < N; i++) sphereOrder[i] = i;
  const sphere = createSphere(N, sphereOrder, sampleDots(sphereImg, 4242), mulberry32(4242));
  scenes.push({ xy: sphereXY, col: sphereCol, tag: new Uint8Array(N), grp: new Uint8Array(N) });
  const SPH = { size: { landscape: 0.28, portrait: 0.78, maxH: 0.5 }, cursor: { yaw: 0.28, pitch: 0.18, omega: 3.0 } }; // src/hero/main.js CFG 와 같은 값
  let sR = 1, sCX = SW / 2, sCY = SH / 2, introStart = START === 'boot' ? 1e9 : -100;
  const spring = { yaw: 0, vy: 0, pitch: 0, vp: 0 };

  // ── WebGL ──────────────────────────────────────────────────────
  const info = createInfo(); // 장면 안 정보 점 (글자·핀·선)
  const mount = document.getElementById('app');
  const canvas = document.createElement('canvas');
  mount.appendChild(canvas);
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: MANUAL });
  if (!gl) throw new Error('webgl');
  const mk = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw gl.getShaderInfoLog(o); return o; };
  const link = (v, f) => { const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, v)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, f)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw gl.getProgramInfoLog(p); return p; };
  // 입자: 중심은 작고 선명한 가우시안 + 밝은 점에만 옅은 테두리 빛. 깊이(aD: 0 먼 곳 → 1 가까운 곳)에 따라 크기·밝기·선명도·시차가 조금씩 다름.
  // 빛 번짐 패스(uGlow)는 밝은 점만 (어두운 면은 번지지 않아 뿌옇게 뭉치지 않음). uFx = 0 이면 개선 전 표현.
  const prog = link(`
    attribute vec2 aPos; attribute vec3 aCol; attribute float aD;
    uniform vec2 uView; uniform float uFit; uniform vec2 uOff; uniform float uSize; uniform float uDpr; uniform float uGlow; uniform float uFx; uniform vec2 uPar;
    varying vec3 vCol; varying float vB; varying float vD;
    void main(){
      float d = clamp(aD, 0.0, 1.0);
      vec2 p = aPos + uPar * (d - 0.5) * uFx;
      vec2 s = p * uFit + uOff;
      gl_Position = vec4(s.x / uView.x * 2.0 - 1.0, 1.0 - s.y / uView.y * 2.0, 0.0, 1.0);
      float b = max(aCol.r, max(aCol.g, aCol.b));
      float dk = mix(1.0, 0.72 + 0.42 * d, uFx);
      vCol = aCol * dk; vB = b * dk; vD = d;
      float sz = uSize * uFit * uDpr;
      if (uGlow > 0.5) gl_PointSize = sz * (0.35 + 0.65 * min(b, 1.0)) * mix(1.0, 0.8 + 0.35 * d, uFx);
      else gl_PointSize = mix(max(1.0, sz * (0.6 + 0.6 * min(b, 2.0))), max(1.5, sz * (0.95 + 0.5 * min(b, 1.6)) * (0.82 + 0.4 * d)), uFx);
    }`, `
    precision highp float;
    uniform float uGlow; uniform float uGA; uniform float uFx; uniform float uGain; varying vec3 vCol; varying float vB; varying float vD;
    void main(){
      float r = length(gl_PointCoord - 0.5) * 2.0;
      if (r > 1.0) discard;
      if (uGlow > 0.5) {
        float a = exp(-r * r * 3.5) * uGA * mix(vB * vB, 1.7 * vB * smoothstep(0.55, 1.25, vB), uFx);
        vec3 hue = mix(vec3(0.04, 0.40, 1.0), vCol / max(vB, 1e-3), 0.25);
        gl_FragColor = vec4(hue * a, 1.0);
      } else {
        float old = smoothstep(1.0, 0.35, r);
        float k = mix(5.5, 9.0, vD);                           // 가까울수록 또렷한 중심, 멀수록 조금 부드럽게
        float core = exp(-r * r * k) * uGain;
        float rim = exp(-r * r * 2.6) * 0.24 * smoothstep(0.35, 1.0, vB); // 밝은 점만 옅은 테두리
        float nw = (core + rim) * smoothstep(1.0, 0.82, r);
        gl_FragColor = vec4(vCol * vec3(0.8, 0.95, 1.05) * mix(old, nw, uFx), 1.0);
      }
    }`);
  const hprog = link(`
    attribute vec2 aQ; uniform vec2 uView; uniform float uFit; uniform vec2 uOff; uniform vec2 uImg; varying vec2 vUv;
    void main(){ vUv = aQ; vec2 s = aQ * uImg * uFit + uOff; gl_Position = vec4(s.x / uView.x * 2.0 - 1.0, 1.0 - s.y / uView.y * 2.0, 0.0, 1.0); }`, `
    precision highp float; uniform sampler2D uT; uniform float uK; varying vec2 vUv;
    void main(){ gl_FragColor = vec4(max(texture2D(uT, vUv).rgb - 0.015, 0.0) * uK, 1.0); }`);
  const U = (p) => (n) => gl.getUniformLocation(p, n);
  const PU = U(prog), HU = U(hprog);
  const pos = new Float32Array(N * 2), col = new Float32Array(N * 3);
  const bPos = gl.createBuffer(), bCol = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bPos); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, bCol); gl.bufferData(gl.ARRAY_BUFFER, col, gl.DYNAMIC_DRAW);
  const LA = [gl.getAttribLocation(prog, 'aPos'), gl.getAttribLocation(prog, 'aCol'), gl.getAttribLocation(prog, 'aD')];
  const dep = new Float32Array(N), idep = new Float32Array(info.pos.length / 2); // 입자별 깊이 (장면 점·정보 점)
  const bDep = gl.createBuffer(), iDep = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bDep); gl.bufferData(gl.ARRAY_BUFFER, dep, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, iDep); gl.bufferData(gl.ARRAY_BUFFER, idep.byteLength, gl.DYNAMIC_DRAW);
  const NDRAW = SMALL ? Math.round(N * 0.85) : N; // 모바일·저사양은 입자 85%만 계산·표시 (무작위로 고르게 빠짐)
  const iPos = gl.createBuffer(), iCol = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, iPos); gl.bufferData(gl.ARRAY_BUFFER, info.pos.byteLength, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, iCol); gl.bufferData(gl.ARRAY_BUFFER, info.col.byteLength, gl.DYNAMIC_DRAW);
  const qb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, qb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const aQ = gl.getAttribLocation(hprog, 'aQ');
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
  const texOf = (src) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, src);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v); return t; };
  const hazeTex = [...hazeImgs.map(texOf), null];

  // ── 화면 맞춤 (캔버스 + 웹 요소 무대) ──────────────────────────────
  const stage = document.querySelector('.sp-stage');
  let W, H, dpr, fit, baseX, baseY, offX, offY;
  const par = { x: 0, y: 0, tx: 0, ty: 0 };
  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); gl.viewport(0, 0, canvas.width, canvas.height);
    if (W >= H) { fit = Math.min(W / SW, H / SH); baseX = (W - SW * fit) / 2; baseY = (H - SH * fit) / 2; }
    else { fit = (W * 0.96) / B.w; baseX = W / 2 - B.cx * fit; baseY = H * 0.44 - B.cy * fit; } // 세로 화면: 피사체 상자가 폭의 96%
    if (offX === undefined) { offX = baseX; offY = baseY; }
    // 구: 기존 메인과 같은 화면 비율 (지름 = 가로 화면 폭 28%·세로 화면 폭 78%, 높이 50% 이하 / 중심 49.2%, 48.2%)
    const diam = Math.min(W * (W >= H ? SPH.size.landscape : SPH.size.portrait), H * SPH.size.maxH);
    sR = diam / 2 / fit; sCX = (W * 0.492 - baseX) / fit; sCY = (H * 0.482 - baseY) / fit;
    if (ROOT.dataset.stage === 'logo' || ROOT.dataset.stage === 'boot') window.__logoFit?.(); // 첫 로드 큰 로고 위치·배율 (index.html 인라인 스크립트와 같은 계산)
    stage?.style.setProperty('--k', W < H ? Math.min(2.4, 0.9 / fit).toFixed(2) : '1');
    layout();
  }
  // 서비스 화면 배치: 왼쪽은 설명(Technology 와 같은 왼쪽 여백), 오른쪽은 서비스 이미지. 세로 화면은 이미지 위·설명 아래
  // 장면 점·정보 점·BMS 단추가 모두 같은 변환(vfit, offX, offY)을 써서 함께 옮겨짐. lay 0 = 기본(구·도로), 1 = 서비스 배치
  const LAY = { s: 1, x: 0, y: 0 };
  let lay = 0, vfit = 1;
  function layout() {
    if (W >= H) {
      let tr = W * 0.0625;
      document.querySelectorAll('.sp-copy').forEach((n) => { tr = Math.max(tr, n.getBoundingClientRect().left + n.scrollWidth); });
      const gap = W * 0.03, half = (B.w / 2) * fit;
      const s = Math.max(0.55, Math.min(0.92, (W - tr - gap * 2) / (half * 2)));
      LAY.s = s; LAY.x = tr + gap + half * s - B.cx * fit * s; LAY.y = baseY + B.cy * fit * (1 - s);
    } else { LAY.s = 1; LAY.x = W / 2 - B.cx * fit; LAY.y = H * 0.39 - B.cy * fit; }
    measureExclude();
  }
  // 정보 점을 찍지 않을 화면 영역 (헤더·설명·시연 표기·SCROLL). 화면 좌표로 재 두고 매 프레임 지금 변환으로 무대 좌표로 바꿈
  let exclScreen = [];
  function measureExclude() {
    exclScreen = [];
    for (const sel of ['.portal-header', '.sp-copy.is-active', '.sp-demo', '.scroll-next']) {
      const n = document.querySelector(sel); if (!n) continue;
      const r = n.getBoundingClientRect(); if (!r.width) continue;
      exclScreen.push([r.left - 16, r.top - 16, Math.max(r.right, r.left + n.scrollWidth) + 16, r.bottom + 16]);
    }
  }
  function applyExclude() { info.setExclude(exclScreen.map(([a, b, c, d]) => [(a - offX) / vfit, (b - offY) / vfit, (c - offX) / vfit, (d - offY) / vfit])); }
  addEventListener('resize', resize); resize();
  document.fonts?.ready.then(layout);

  // ── 상태 ───────────────────────────────────────────────────────
  const rand = Math.random;
  const ph = new Float32Array(N), sp = new Float32Array(N), delay = new Float32Array(N);
  const spd = new Float32Array(N), jit = new Float32Array(N), drift = new Float32Array(N), dph = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    ph[i] = rand() * 6.283; sp[i] = 0.6 + rand() * 1.6; delay[i] = rand();
    spd[i] = 0.82 + rand() * 0.36; // 전환: 입자마다 퍼지는 세기·모이는 시점이 조금씩 다름
    jit[i] = 0; // 깊이는 위치의 매끄러운 함수만 (점마다 다르게 주면 마우스 시차에서 윤곽이 갈라짐)
    drift[i] = rand() < 0.03 ? 1.5 + rand() * 2.0 : 0; dph[i] = rand() * 6.283; // 외곽의 소수 점만 조금 더 멀리 떠돌다 돌아옴
  }
  const bx = new Float32Array(N), by = new Float32Array(N), ax = new Float32Array(N * 2), ac = new Float32Array(N * 3);
  const off = new Float32Array(N * 2), vel = new Float32Array(N * 2);

  // 처음은 구 (로고 단계에서는 캔버스가 숨겨져 있음). ?scene=0~3 이면 그 서비스 장면에서 바로 시작 (확인용)
  let cur = SPHERE, from = SPHERE, tStart = -1e9, clock = 0, style = 'burst', readyAt = -1;
  if (q.has('scene')) { const k = +q.get('scene'); if (k >= 0 && k < LOOP.length) cur = from = k; }
  let stageName = START === 'boot' ? 'logo' : START; // logo → sphere → service
  let inputLock = 0; // 이 시각(ms)까지 스크롤 입력 무시 (단계 전환 직후 관성으로 여러 단계를 건너뛰지 않게)
  const poses = makePoses(meta, conf);
  const overlays = createOverlays(stage, meta, conf, poses, { reduce, info, small: SMALL });
  const live = document.querySelector('.sp-live');
  let leaving = null; // 떠나는 장면의 정보 점: { k, t } (흩어지며 사라짐)
  document.querySelectorAll('.sp-demo').forEach((n) => (n.textContent = NOTE));
  const sceneName = () => (cur === SPHERE ? 'sphere' : LOOP[cur].name);
  const label = () => { document.body.dataset.scene = sceneName(); canvas.setAttribute('aria-label', cur === SPHERE ? 'LIVEBUS 구' : `${LOOP[cur].label} (서비스 시연)`); };
  label();
  if (from === INTRO) { ax.set(scenes[INTRO].xy); ac.set(scenes[INTRO].col); }

  const D = CFG.burst, DUR = D.spread + D.coast + D.regroup;
  const trDur = () => (style === 'burst' ? DUR : style === 'intro' ? CFG.intro : 0.6);
  const busy = () => clock - tStart < trDur();
  const sceneFrame = (k) => (k === SPHERE ? { cx: sCX, cy: sCY, R: sR } : { cx: B.cx, cy: B.cy, R: Math.max(B.w, B.h) / 2 });

  function go(i, mode) {
    if (i === cur) return;
    if (!mode && busy()) return;
    const t0 = performance.now();
    leaving = cur < LOOP.length && readyAt >= 0 ? { k: cur, t: reduce ? STATIC_T[LOOP[cur].name] : clock - readyAt } : null;
    if (cur < LOOP.length) overlays.leave(cur);
    from = cur; cur = i; tStart = clock; readyAt = -1;
    style = reduce ? 'fade' : mode || 'burst';
    const { cx, cy, R } = sceneFrame(from);
    for (let k = 0; k < N; k++) {
      const x = pos[k * 2], y = pos[k * 2 + 1];
      ax[k * 2] = x; ax[k * 2 + 1] = y; ac[k * 3] = col[k * 3]; ac[k * 3 + 1] = col[k * 3 + 1]; ac[k * 3 + 2] = col[k * 3 + 2];
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1, rr = Math.min(1.3, d / R);
      const a = Math.atan2(dy, dx) + (rand() - 0.5) * 0.8;
      const m = R * D.out * (0.35 + 0.9 * Math.pow(rr, 1.3)) * (0.55 + 0.6 * rand());
      bx[k] = Math.cos(a) * m; by[k] = Math.sin(a) * m;
    }
    if (!(prep.ready && prep.from === from && prep.to === cur && clock - prep.at < 1)) computeMap(cur, ax, cx, cy, R);
    applyMap(cur);
    prep.ready = false;
    goMs = performance.now() - t0;
    label();
  }

  // 짝 맞추기: 지금 보이는 점 ↔ 다음 장면의 밝은 자리, 화면 방향·거리 순 (버킷 정렬, 작업 버퍼 재사용)
  const prep = { ready: false, from: -1, to: -1, at: -1e9 };
  let goMs = 0;
  const MB = 4800;
  const MT = { bkey: new Uint16Array(N), order: new Uint32Array(N), cnt: new Uint32Array(MB + 1), src: new Uint32Array(N), dst: new Uint32Array(N), dstSorted: new Uint32Array(N),
    tmp: new Uint32Array(N), map: new Int32Array(N), nxy: new Float32Array(N * 2), ncol: new Float32Array(N * 3), ntag: new Uint8Array(N), ngrp: new Uint8Array(N), vis: new Uint8Array(N) };
  const angBin = (dx, dy) => Math.min(47, Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * 48)) * 100 + Math.min(99, Math.floor(Math.hypot(dx, dy) * 40));
  function bucketSort(list, n, nb, out) {
    const c = MT.cnt; c.fill(0, 0, nb + 1);
    for (let k = 0; k < n; k++) c[MT.bkey[list[k]] + 1]++;
    for (let b = 0; b < nb; b++) c[b + 1] += c[b];
    for (let k = 0; k < n; k++) out[c[MT.bkey[list[k]]]++] = list[k];
  }
  function computeMap(t, srcXY, cx, cy, R) {
    const S = scenes[t], bb = sceneFrame(t);
    for (let j = 0; j < N; j++) { MT.order[j] = j; MT.bkey[j] = 1023 - Math.min(1023, Math.floor(Math.max(S.col[j * 3], S.col[j * 3 + 1], S.col[j * 3 + 2]) * 787)); }
    bucketSort(MT.order, N, 1024, MT.tmp);
    let nVis = 0;
    for (let i = 0; i < N; i++) { const v = Math.max(col[i * 3], col[i * 3 + 1], col[i * 3 + 2]) > 0.02; MT.vis[i] = v ? 1 : 0; if (v) nVis++; }
    const map = MT.map, A = MT.order, Bs = MT.dst, out = MT.src;
    for (const vis of [1, 0]) {
      let a = 0;
      for (let i = 0; i < N; i++) if (MT.vis[i] === vis) { A[a++] = i; MT.bkey[i] = angBin((srcXY[i * 2] - cx) / R, (srcXY[i * 2 + 1] - cy) / R); }
      bucketSort(A, a, MB, out);
      const lo = vis ? 0 : nVis, hi = vis ? nVis : N;
      let b = 0;
      for (let k = lo; k < hi; k++) Bs[b++] = MT.tmp[k];
      for (let k = 0; k < b; k++) { const j = Bs[k]; MT.bkey[j] = angBin((S.xy[j * 2] - bb.cx) / bb.R, (S.xy[j * 2 + 1] - bb.cy) / bb.R); }
      bucketSort(Bs, b, MB, MT.dstSorted);
      for (let k = 0; k < a; k++) map[out[k]] = MT.dstSorted[k];
    }
  }
  function applyMap(t) {
    const S = scenes[t], map = MT.map, { nxy, ncol, ntag } = MT;
    for (let i = 0; i < N; i++) { const j = map[i]; nxy[i * 2] = S.xy[j * 2]; nxy[i * 2 + 1] = S.xy[j * 2 + 1]; ncol[i * 3] = S.col[j * 3]; ncol[i * 3 + 1] = S.col[j * 3 + 1]; ncol[i * 3 + 2] = S.col[j * 3 + 2]; ntag[i] = S.tag[j]; MT.ngrp[i] = S.grp[j]; }
    S.xy.set(nxy); S.col.set(ncol); S.tag.set(ntag); S.grp.set(MT.ngrp);
  }
  // 첫 전환의 지연 방지: 짝 맞추기 코드를 미리 한 번씩 실행 (결과는 쓰지 않음)
  for (let k = 0; k < LOOP.length; k++) { const f = sceneFrame(0); computeMap(k, scenes[INTRO].xy, f.cx, f.cy, f.R); }

  // ── 스크롤 · Technology ────────────────────────────────────────
  // ── 스크롤 단계 ────────────────────────────────────────────────
  // 구 → LIVEBUS → BMS → BIT → BIS (끝, 여기서 멈춤). 위로 스크롤하면 거꾸로, LIVEBUS 에서 더 올리면 구.
  // 스크롤 한 번(제스처) = 서비스 하나. 설명(sp-copy)은 서비스에 들어오면 한 글자씩 저절로 나타남 (추가 스크롤 없음)
  let svc = 0; // 지금 서비스 번호
  const LAST = LOOP.length - 1;
  function setStage(name) {
    stageName = name; ROOT.dataset.stage = name;
    document.querySelector('.scroll-next')?.setAttribute('aria-label', name === 'sphere' ? '서비스 보기' : '다음 서비스 보기');
    renderCopy();
  }
  const LOCK = { service: 900, stage: 1100, max: 2200 }; // 단계별 최소 입력 잠금 (ms)
  let lockFrom = 0;
  const lockInput = (ms) => { lockFrom = performance.now(); inputLock = lockFrom + ms; };
  function headline(dir) { // 구 화면 티커: 나갈 때·돌아올 때 '찌직'
    ROOT.classList.remove('sp-head-in', 'sp-head-out', 'sp-entering');
    void document.querySelector('.headline')?.offsetWidth;
    ROOT.classList.add(dir > 0 ? 'sp-head-out' : 'sp-head-in');
    glitchTicker(dir > 0 ? 'out' : 'in');
  }
  /** 구 → LIVEBUS */
  function enterService() { headline(1); svc = 0; setStage('service'); go(0, 'burst'); lockInput(LOCK.stage); }
  /** LIVEBUS → 구 (로고 인트로는 다시 재생하지 않음) */
  function backToSphere() { headline(-1); setStage('sphere'); go(SPHERE, 'burst'); lockInput(LOCK.stage); }
  function toService(k) { svc = k; renderCopy(); go(k, 'burst'); lockInput(LOCK.service); }
  function advance(dir) {
    if (stageName === 'logo' || performance.now() < inputLock) return false;
    if (stageName === 'sphere') { if (dir > 0) { enterService(); return true; } return false; }
    if (dir > 0) { if (svc < LAST) { toService(svc + 1); return true; } return false; } // BIS 가 마지막: 그대로 유지 (처음으로 돌아가지 않음)
    if (svc > 0) { toService(svc - 1); return true; }
    backToSphere(); return true;
  }
  // 서비스 설명 (copy.js 데이터). 글자(자소가 아닌 음절·문자 단위)마다 span → CSS 로 0 → 1 페이드, 시작 시각만 조금씩 늦춤.
  // 모든 글자가 처음부터 자리를 차지하므로 나타나는 동안 레이아웃이 움직이지 않음. 읽기 보조용 전체 문장은 따로 둠.
  // 장면 전환(2초)에서 형상이 읽히기 시작하는 0.9초부터 문구도 시작. 글자 간격은 문장 길이에 맞춰 15~25ms → 문구 전체 약 0.8~1.2초
  // dimIn: 이미지가 모이기 시작하는 0.7초부터 0.25초 동안 문구 전체 0 → 0.1, 그 마지막 50ms(0.9초)부터 첫 글자가 밝아짐
  const TYPE = { dimIn: 700, dim: 250, start: 900, fade: 190, lineGap: 60, total: 950, min: 15, max: 25 }; // ms (fade·dim 은 style.css 와 같음)
  const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('ko', { granularity: 'grapheme' }) : null;
  const graphemes = (t) => (seg ? [...seg.segment(t)].map((x) => x.segment) : Array.from(t));
  const copyWrap = document.createElement('div');
  copyWrap.className = 'sp-copies';
  const copies = LOOP.map(({ name }) => {
    const c = SERVICE_COPY[name] || { title: '', lines: [] };
    const sec = document.createElement('section'); sec.className = 'sp-copy'; sec.dataset.scene = name; sec.style.setProperty('--in', `${TYPE.dimIn}ms`); sec.setAttribute('aria-hidden', 'true');
    const nChars = [c.title, ...c.lines].reduce((a, t) => a + graphemes(t).filter((g) => g.trim()).length, 0);
    const step = Math.max(TYPE.min, Math.min(TYPE.max, (TYPE.total - TYPE.fade - TYPE.lineGap * c.lines.length) / Math.max(1, nChars)));
    let d = TYPE.start;
    const typed = (tag, cls, text) => {
      const el = document.createElement(tag); el.className = cls;
      const sr = document.createElement('span'); sr.className = 'sp-sr'; sr.textContent = text; el.appendChild(sr);
      const vis = document.createElement('span'); vis.setAttribute('aria-hidden', 'true');
      for (const g of graphemes(text)) {
        const ch = document.createElement('span'); ch.className = 'sp-ch'; ch.textContent = g;
        if (g.trim()) { ch.style.setProperty('--d', `${Math.round(d)}ms`); d += step; } // 공백은 기다리지 않음
        vis.appendChild(ch);
      }
      el.appendChild(vis); d += TYPE.lineGap;
      return el;
    };
    sec.appendChild(typed('h2', 'sp-copy-title', c.title));
    const p = document.createElement('p'); p.className = 'sp-copy-body';
    c.lines.forEach((t) => p.appendChild(typed('span', 'sp-line', t)));
    sec.appendChild(p); copyWrap.appendChild(sec);
    return { sec };
  });
  document.querySelector('.scroll-next')?.before(copyWrap);
  if (q.has('scene') && cur < LOOP.length) svc = cur; // 확인용 시작 장면
  /** 활성 서비스의 설명만 처음부터 재생. 떠나는 설명은 대기 중인 글자까지 바로 취소되고 짧게 사라짐 */
  function renderCopy() {
    const show = stageName === 'service';
    copies.forEach(({ sec }, i) => {
      const on = show && i === svc, was = sec.classList.contains('is-active');
      if (on && !was) {
        sec.classList.remove('is-play'); sec.classList.add('is-reset'); void sec.offsetWidth; sec.classList.remove('is-reset');
        const token = (sec.dataset.token = String(+sec.dataset.token + 1 || 1));
        // 서체가 준비된 뒤에 재생 (그 사이 떠났거나 다시 들어왔으면 이 예약은 버림)
        fontsReady.then(() => { if (sec.dataset.token === token && sec.classList.contains('is-active')) sec.classList.add('is-play'); });
      }
      if (!on) sec.classList.remove('is-play');
      sec.classList.toggle('is-active', on); sec.setAttribute('aria-hidden', String(!on));
    });
    ROOT.toggleAttribute('data-last', show && svc === LAST); // 마지막 서비스: SCROLL 안내 숨김
    measureExclude();
  }
  document.querySelector('.scroll-next')?.addEventListener('click', () => advance(1));
  document.querySelector('.brand')?.addEventListener('click', () => { if (stageName === 'service' && !busy()) backToSphere(); });
  const G = CFG.gesture, gs = { locked: false, dir: 0, last: -1e9, lastAd: 0, acc: 0, peak: 0, valley: 0, revAt: -1e9 };
  addEventListener('wheel', (e) => {
    e.preventDefault();
    // 이벤트가 만들어진 시각 기준 (화면이 바빠 처리가 밀려도 관성의 실제 간격으로 판단)
    const now = e.timeStamp > 0 ? Math.min(e.timeStamp, performance.now()) : performance.now();
    const d = e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? innerHeight : 1);
    if (!d) return;
    const dir = Math.sign(d), ad = Math.abs(d), gap = now - gs.last, prevAd = gs.lastAd;
    gs.last = now; gs.lastAd = ad;
    // 로고 재생 중이거나 단계 전환 직후: 입력을 쌓지 않고, 이어지는 관성은 같은 제스처로 묶어 둠 → 끝난 직후 화면을 건너뛰지 않음
    if (stageName === 'logo' || now < inputLock) {
      // 같은 방향의 약해지는 관성이 이어지면 잠금을 조금씩 연장 (최대 LOCK.max), 새로 세게 미는 입력은 연장하지 않음
      const kick = ad > G.kick && ad > gs.valley * G.rise; // 관성 중 다시 세게 밂 = 새 제스처
      if (stageName !== 'logo' && dir === gs.dir && !kick) inputLock = Math.min(lockFrom + LOCK.max, Math.max(inputLock, now + 200));
      if (dir !== gs.dir || kick) gs.peak = gs.valley = ad; else gs.valley = Math.min(gs.valley, ad);
      gs.locked = true; gs.dir = dir; gs.acc = 0; return;
    }
    if (now - gs.revAt < G.flip && dir !== gs.dir && ad < G.kick) return;
    if (gs.locked) {
      const reversed = dir !== gs.dir;
      if (reversed) gs.revAt = now;
      // 새 제스처: 오래 멈췄다 다시 밀었거나, 잠깐 끊겼어도 값이 줄지 않고 다시 커짐, 또는 관성 중 세게 다시 밂. (관성 꼬리는 계속 작아짐)
      const fresh = gap > 450 || (gap > G.gap && ad > prevAd) || (ad > G.kick && ad > gs.valley * G.rise);
      if (!reversed && !fresh) { if (ad >= gs.peak) gs.peak = gs.valley = ad; else gs.valley = Math.min(gs.valley, ad); return; }
      gs.locked = false; gs.acc = 0;
    } else if (gap > G.gap || Math.sign(gs.acc) !== dir) gs.acc = 0;
    gs.acc += d;
    if (Math.abs(gs.acc) >= G.threshold) { advance(dir); gs.locked = true; gs.dir = dir; gs.acc = 0; gs.peak = gs.valley = ad; }
  }, { passive: false });
  let ty0 = null;
  addEventListener('touchstart', (e) => { ty0 = stageName === 'logo' || performance.now() < inputLock ? null : e.touches[0].clientY; }, { passive: true });
  addEventListener('touchmove', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false }); // 페이지 자체는 움직이지 않게 (당겨서 새로고침 방지)
  addEventListener('touchend', (e) => { if (ty0 === null) return; const d = ty0 - e.changedTouches[0].clientY; if (Math.abs(d) > 40) advance(Math.sign(d)); ty0 = null; }, { passive: true });
  addEventListener('keydown', (e) => { if (e.repeat || e.target.closest?.('button, a')) return; if (['ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); advance(1); } if (['ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); advance(-1); } });


  // ── 커서 ───────────────────────────────────────────────────────
  const m = { x: -1e4, y: -1e4, on: false, speed: 0, lx: null, ly: null, nx: 0, ny: 0 };
  function setPointer(cx, cy) {
    const x = (cx - offX) / vfit, y = (cy - offY) / vfit;
    if (m.lx !== null) m.speed = Math.min(1, m.speed + Math.hypot(x - m.lx, y - m.ly) / 90);
    m.lx = x; m.ly = y; m.x = x; m.y = y; m.on = true; m.nx = (cx / W) * 2 - 1; m.ny = (cy / H) * 2 - 1;
    par.tx = ((cx / W) * 2 - 1) * CFG.parallax; par.ty = ((cy / H) * 2 - 1) * CFG.parallax * 0.6;
  }
  if (fine) addEventListener('pointermove', (e) => setPointer(e.clientX, e.clientY), { passive: true });
  // ── 커서: 작은 청백색 점 + 얇은 청색 링 (마우스·트랙패드에서만) ──
  // 점은 포인터를 그대로 따라가고 링만 살짝 늦게. 누를 수 있는 요소 위에서는 링이 조금 커지고 밝아짐.
  // 준비 중 오류가 나면 클래스를 붙이지 않아 기본 커서가 그대로 쓰임. 터치에서는 만들지 않음. 키보드 포커스 표시는 건드리지 않음
  if (fine && !q.has('nocursor')) {
    try {
      const cur = document.createElement('div'); cur.className = 'sp-cursor'; cur.setAttribute('aria-hidden', 'true');
      cur.innerHTML = '<span class="sp-cursor-ring"></span><span class="sp-cursor-dot"></span>';
      document.body.appendChild(cur);
      const dot = cur.lastChild, ring = cur.firstChild, c = { x: -100, y: -100, rx: -100, ry: -100, seen: false };
      addEventListener('pointermove', (e) => {
        if (e.pointerType === 'touch') return;
        c.x = e.clientX; c.y = e.clientY;
        dot.style.transform = `translate3d(${c.x}px,${c.y}px,0)`;
        if (!c.seen) { c.seen = true; c.rx = c.x; c.ry = c.y; ROOT.classList.add('sp-cursor-on'); }
        cur.classList.toggle('is-hover', !!e.target.closest?.('button, a, [role="button"], .sp-pinbtn'));
      }, { passive: true });
      document.addEventListener('pointerleave', () => cur.classList.add('is-out'));
      document.addEventListener('pointerenter', () => cur.classList.remove('is-out'));
      addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') ROOT.classList.remove('sp-cursor-on'); }, { passive: true });
      const tick = () => {
        const k = reduce ? 1 : 0.22; c.rx += (c.x - c.rx) * k; c.ry += (c.y - c.ry) * k; // 링만 약한 지연
        ring.style.transform = `translate3d(${c.rx.toFixed(1)}px,${c.ry.toFixed(1)}px,0)`;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch (err) { ROOT.classList.remove('sp-cursor-on'); console.warn('[cursor]', err); }
  }
  document.addEventListener('pointerleave', () => { m.on = false; par.tx = par.ty = 0; });

  // ── 장면별 움직임 ─────────────────────────────────────────────────
  // 태그: 1 노선, 2 버스 차체, 3 전조등, 4 안내 화면 테두리, 5 도로망, 6 기둥, 7 바닥 파동
  // 그룹(grp>0): 배경에서 분리한 버스. poses.js 의 자세로 움직이고, 그 뒤의 배경 점은 가려진 만큼 어둡게
  const STATIC_T = { 'libus-1': 7.2, 'bms-2': 4.0, 'bit-3': 7.4, 'bis-4': 9.0 }; // 동작 줄이기: 정보가 다 보이는 정지 상태
  const LB = (() => { const [rx0] = poses.at('libus-1', 760, 0), [rx1] = poses.at('libus-1', 1700, 0), [bx0, by0] = poses.at('libus-1', 1150, 1020), [bx1, by1] = poses.at('libus-1', 1645, 1355); return { rx0, rx1, bx0, bx1, by0, by1 }; })();
  const BT = (() => { const P = conf.scenes['bit-3'].anchors.panel.map(([x, y]) => poses.at('bit-3', x, y)); const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]); return { px0: Math.min(...xs), px1: Math.max(...xs), py0: Math.min(...ys), py1: Math.max(...ys) }; })();
  const busPolys = { 'libus-1': conf.scenes['libus-1'].layers.map((L) => L.poly.map(([x, y]) => poses.at('libus-1', x, y))),
    'bms-2': conf.scenes['bms-2'].busAnchors.map(([ax0, ay0], i) => (conf.scenes['bms-2'].busPolys?.[i] || conf.scenes['bms-2'].busTemplate).map(([x, y]) => poses.at('bms-2', ax0 + x, ay0 + y))) };
  function scenePoses(name, t) {
    if (name === 'libus-1') return [null, poses.livebus(LIVEBUS.state(t).u)];
    if (name === 'bms-2') return [null, ...BMS.state(t).map((b, i) => poses.bms(i, b.off))];
    return [null];
  }
  function occluders(name, gp) {
    const polys = busPolys[name]; if (!polys) return [];
    return polys.map((poly, i) => {
      // 분리할 때 다각형을 조금 넓혔으므로(LAYER_PAD) 가림 영역도 중심에서 4% 넓힘 → 버스 가장자리 뒤 배경이 비쳐 이중선이 생기지 않게
      const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length, cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
      const pts = poly.map(([x, y]) => poses.apply(gp[i + 1], cx + (x - cx) * 1.04, cy + (y - cy) * 1.04)); const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); return { pts, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; });
  }
  function inside(o, x, y) {
    if (x < o.x0 || x > o.x1 || y < o.y0 || y > o.y1) return false;
    let c = false; const P = o.pts;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > y) !== (P[j][1] > y) && x < ((P[j][0] - P[i][0]) * (y - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) c = !c;
    return c;
  }
  // BMS: 선택한 버스의 도로 강조 (선택이 바뀔 때만 다시 계산)
  const hl = { road: null, key: null, boost: new Float32Array(N), scene: -1 };
  function setHighlight(road) { hl.road = road; }
  function refreshHighlight(S) {
    const key = hl.road ? hl.road.map((p) => p.join()).join('|') + cur : null;
    if (key === hl.key) return; hl.key = key; hl.boost.fill(0); if (!hl.road) return;
    for (let i = 0; i < N; i++) {
      if (S.grp[i] || S.tag[i] !== 5) continue;
      const x = S.xy[i * 2], y = S.xy[i * 2 + 1]; let d = Infinity;
      for (let k = 0; k < hl.road.length - 1; k++) { const a = hl.road[k], b = hl.road[k + 1], vx = b[0] - a[0], vy = b[1] - a[1], u = clamp01(((x - a[0]) * vx + (y - a[1]) * vy) / (vx * vx + vy * vy)); d = Math.min(d, Math.hypot(a[0] + vx * u - x, a[1] + vy * u - y)); }
      hl.boost[i] = Math.max(0, 1 - d / 34);
    }
  }
  // ── 깊이 (0 먼 곳 → 1 가까운 곳) ── 원화가 평면이라 위치로 추정: 바닥 원근(아래가 가깝고 위가 멂) + 주 피사체(안내기·휴대폰·카드)는 앞으로.
  // 위치의 매끄러운 함수라 점이 움직이거나 전환 중이어도 깊이가 튀지 않고, 같은 자리의 글자·마커도 같은 깊이 → 함께 움직임
  const BISQ = conf.scenes['bis-4'].anchors.screen.map(([x, y]) => poses.at('bis-4', x, y));
  const BISC = conf.scenes['bis-4'].anchors.cards.map(([x0, y0, x1, y1]) => [...poses.at('bis-4', x0, y0), ...poses.at('bis-4', x1, y1)]);
  // BIT: 태양광 패널·안내 화면·기둥(주 피사체) 영역은 앞으로
  const BITR = (() => { const A = conf.scenes['bit-3'].anchors, P = [...A.panel, ...A.screen].map(([x, y]) => poses.at('bit-3', x, y)), xs = P.map((p) => p[0]), ys = P.map((p) => p[1]); return [Math.min(...xs) - 8, Math.min(...ys) - 8, Math.max(...xs) + 8, Math.max(...ys) + 8]; })();
  const BITX = (BITR[0] + BITR[2]) / 2;
  function inQuad(Q, x, y) { let sg = 0; for (let k = 0; k < 4; k++) { const a = Q[k], b = Q[(k + 1) % 4], c = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]); sg |= c > 0 ? 1 : c < 0 ? 2 : 0; if (sg === 3) return false; } return true; }
  const WHEELS = poses.wheels;
  // 영역 안쪽 정도 0~1 (경계에서 ±18px 에 걸쳐 부드럽게) → 깊이가 경계에서 계단처럼 바뀌지 않아 시차에 윤곽이 갈라지지 않음
  const soft = (dd) => { const t = clamp01((dd + 18) / 36); return t * t * (3 - 2 * t); };
  const rectIn = (r, x, y) => soft(Math.min(x - r[0], r[2] - x, y - r[1], r[3] - y));
  function quadIn(Q, x, y) { let m = Infinity; for (let k = 0; k < 4; k++) { const a = Q[k], b = Q[(k + 1) % 4], ex = b[0] - a[0], ey = b[1] - a[1], L = Math.hypot(ex, ey); m = Math.min(m, ((x - a[0]) * ey - (y - a[1]) * ex) / L * QS); } return soft(m); }
  const QS = (() => { const Q = BISQ; let A = 0; for (let k = 0; k < 4; k++) { const a = Q[k], b = Q[(k + 1) % 4]; A += a[0] * b[1] - b[0] * a[1]; } return A > 0 ? -1 : 1; })(); // 꼭짓점 순서에 따른 안/밖 부호
  function depthOf(k, x, y) {
    if (k === SPHERE) { const dx = (x - sCX) / sR, dy = (y - sCY) / sR, r2 = dx * dx + dy * dy; return r2 < 1 ? 0.42 + 0.5 * Math.sqrt(1 - r2) : 0.32; }
    if (k >= LOOP.length) return 0.5;
    const n = LOOP[k].name, v = Math.min(1, Math.max(0, (y - 120) / 700));
    if (n === 'libus-1') return 0.18 + 0.72 * v; // 위의 노선 지도는 멀리, 아래 정류장·버스·도로는 가까이
    if (n === 'bms-2') return 0.15 + 0.75 * v;
    if (n === 'bit-3') { const base = 0.2 + 0.45 * v + 0.2 * Math.max(0, 1 - Math.abs(x - BITX) / 60); return base + (0.86 - base) * rectIn(BITR, x, y); } // 안내기(패널·화면·기둥)는 앞, 주변 마을은 뒤
    if (n === 'bis-4') { let d = 0.18 + 0.35 * v; d += (0.82 - d) * quadIn(BISQ, x, y); for (const c of BISC) d += (0.94 - d) * rectIn(c, x, y); return d; }
    return 0.5;
  }
  function sceneLight(name, i, bxp, byp, t, tg) { // 장면 완성 후 점 밝기 배율 (bxp, byp = 움직이기 전 위치)
    if (name === 'libus-1') {
      if (tg === 1) { const head = LB.rx0 + (LB.rx1 - LB.rx0 + 120) * clamp01((t - 0.15) / 1.3); return 0.25 + 0.75 * clamp01((head - bxp) / 90); }
      if (tg === 2) { // 차체 일부에 가끔 가느다란 빛 (5.2초마다 1.1초)
        const c = (t + 3.0) % 5.2; if (c > 1.1) return 1;
        const u = (bxp - LB.bx0) / (LB.bx1 - LB.bx0) - ((byp - LB.by0) / (LB.by1 - LB.by0)) * 0.35, band = -0.35 + (c / 1.1) * 1.7;
        return 1 + 0.6 * Math.exp(-((u - band) ** 2) / 0.003);
      }
      if (tg === 3) return 1.25 + 0.07 * Math.sin(t * 1.3); // 전조등: 약하게
      if (tg === 4) return 0.6 + 0.4 * clamp01((t - 0.3) / 0.7);
    } else if (name === 'bms-2') {
      if (tg === 5) return 0.92 + 0.5 * hl.boost[i];
    } else if (name === 'bit-3') {
      // 8 태양광 패널: 처음 한 번 빛이 비스듬히 지나가고, 갱신 신호가 출발할 때 은은하게 밝아짐
      if (tg === 8) {
        const [c0, c1] = BIT.charge, u = (t - c0) / (c1 - c0), band = (bxp - BT.px0) / (BT.px1 - BT.px0) + (byp - BT.py0) / (BT.py1 - BT.py0) * 0.5;
        let k = 0.9 + (u > 0 && u < 1 ? 0.7 * Math.exp(-((band - (-0.3 + u * 1.9)) ** 2) / 0.012) : 0);
        for (const ta of BIT.signals) { const q = (t - ta + 1.25) / 0.5; if (q > 0 && q < 1) k += 0.25 * Math.sin(q * Math.PI); }
        return k;
      }
      if (tg === 6) return 0.6; // 기둥: 낮춰서 화면이 중심
      if (tg === 7) return 0.42; // 바닥
      if (tg === 4) { let p = 0; for (const s0 of BIT.signals) { const q = (t - s0) / 0.9; if (q >= 0 && q < 1) p = Math.max(p, 1 - q); } return 1 + 0.25 * p; }
    } else if (name === 'bis-4') {
      if (tg === 1) return 0.95 + 0.05 * Math.sin(t * 1.2 - bxp * 0.03); // 노선: 밝기 변화는 아주 약하게 (끊겨 보이지 않게)
    }
    return 1;
  }

  const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

  function step(dt) {
    clock += dt;
    const T = clock - tStart, moving = busy();
    // 형상이 잡힌 순간 → 다음 장면 웹 요소 시작
    if (!moving && readyAt < 0) { readyAt = clock; if (cur < LOOP.length) overlays.enter(cur); }
    // 서비스 사이 이동은 스크롤로만 (자동 전환 없음). 장면 안 시연 애니메이션은 계속 재생
    // 구: 커서 쪽으로 살짝 돌아봄 (기존 메인과 같은 임계 감쇠 스프링) + 표면 무늬 흐름
    if (cur === SPHERE) {
      const w = SPH.cursor.omega, tyaw = m.on ? m.nx * SPH.cursor.yaw : 0, tpit = m.on ? m.ny * SPH.cursor.pitch : 0;
      spring.vy += (w * w * (tyaw - spring.yaw) - 2 * w * spring.vy) * dt; spring.yaw += spring.vy * dt;
      spring.vp += (w * w * (tpit - spring.pitch) - 2 * w * spring.vp) * dt; spring.pitch += spring.vp * dt;
      sphere.update({ t: clock, cx: sCX, cy: sCY, R: sR, yaw: spring.yaw, pitch: spring.pitch, introT: clock - introStart, speed: reduce ? 0.3 : 1 }, sphereXY, sphereCol);
    }
    const name = cur < LOOP.length ? LOOP[cur].name : null;
    const st = readyAt >= 0 ? clock - readyAt : -1; // 장면 완성 후 시간
    const tS = reduce && name ? STATIC_T[name] : Math.max(0, st);
    const gp = name ? scenePoses(name, moving ? (reduce ? tS : 0) : tS) : [null];
    const wAng = name === 'libus-1' && !reduce ? poses.wheelAngle(LIVEBUS.state(moving ? 0 : tS).u) : 0;
    const occ = !moving && name ? occluders(name, gp) : [];
    // 장면 안 정보 (점). 전환 중에는 떠나는 장면의 정보가 흩어지며 사라지고, 다음 장면 정보는 형상이 잡힌 뒤 나타남
    info.begin();
    info.setScatter(null);
    info.setPush(m.on && m.speed > 0.01 ? { x: m.x, y: m.y, r: CFG.cursor.r, r2: CFG.cursor.r ** 2, s: Math.min(CFG.cursor.maxOff, CFG.cursor.push * m.speed * 3) } : null);
    if (st >= 0 && name) overlays.update(cur, st, { livebusPose: gp[1], bmsPose: gp.slice(1), setHighlight });
    else if (leaving && moving && T < 0.6) { info.setScatter({ cx: B.cx, cy: B.cy, k: easeOut(clamp01(T / 0.6)) * 0.45 }); const lp = scenePoses(LOOP[leaving.k].name, leaving.t); overlays.update(leaving.k, leaving.t, { livebusPose: lp[1], bmsPose: lp.slice(1), setHighlight() {}, out: clamp01(T / 0.5) }); }
    if (FX) { const ip = info.pos; for (let j = 0, n = info.count; j < n; j++) idep[j] = depthOf(cur, ip[j * 2], ip[j * 2 + 1]); } // 글자·마커는 놓인 물체와 같은 깊이
    if (live && overlays.ui.live !== live.textContent && st >= 0 && name) live.textContent = overlays.ui.live;
    // 시차 (부드럽게)
    par.x += (par.tx - par.x) * Math.min(1, dt * 3); par.y += (par.ty - par.y) * Math.min(1, dt * 3);
    const layT = cur < LOOP.length ? 1 : 0; // 서비스 장면이면 서비스 배치로 (전환과 함께 부드럽게)
    lay += (layT - lay) * (reduce ? 1 : Math.min(1, dt * 2.6));
    vfit = fit * (1 + (LAY.s - 1) * lay);
    const pg = FX ? 0.45 : 1; // 시차: 전체는 조금만, 나머지는 깊이별로 (셰이더 uPar)
    offX = baseX + (LAY.x - baseX) * lay + par.x * vfit * pg; offY = baseY + (LAY.y - baseY) * lay + par.y * vfit * pg;
    stage.style.transform = `translate(${offX}px,${offY}px) scale(${vfit})`;
    applyExclude();

    const S = scenes[cur], C = CFG.cursor, R2 = C.r * C.r, push = C.push * m.speed;
    if (name === 'bms-2') refreshHighlight(S); else if (hl.key) { hl.key = null; hl.road = null; hl.boost.fill(0); }
    m.speed *= Math.exp(-dt * 4.5);
    for (let i = 0; i < NDRAW; i++) {
      const i2 = i * 2, i3 = i * 3;
      let x, y, cr, cg, cb;
      const tb = Math.max(S.col[i3], S.col[i3 + 1], S.col[i3 + 2]), tg = S.tag[i], g = S.grp[i];
      // 목표 위치: 분리한 버스는 지금 자세로
      let txp = S.xy[i2], typ = S.xy[i2 + 1];
      // LIVEBUS 바퀴: 타이어 안쪽(휠) 점만 바퀴 타원 좌표에서 회전 → 차축·타이어 외곽·타원 원근은 그대로, 차체와 함께 이동
      if (g === 1 && wAng) for (let w = 0; w < WHEELS.length; w++) {
        const Wl = WHEELS[w], ux = (txp - Wl.cx) / Wl.rx, uy = (typ - Wl.cy) / Wl.ry;
        if (ux * ux + uy * uy < 0.62) { const c = Math.cos(wAng), sn = Math.sin(wAng); txp = Wl.cx + (ux * c - uy * sn) * Wl.rx; typ = Wl.cy + (ux * sn + uy * c) * Wl.ry; break; }
      }
      if (g && gp[g]) { const P = gp[g]; txp = P.ax + (txp - P.ax) * P.sc + P.dx; typ = P.ay + (typ - P.ay) * P.sc + P.dy; }
      if (!moving) {
        x = txp; y = typ; cr = S.col[i3]; cg = S.col[i3 + 1]; cb = S.col[i3 + 2];
        let k = 1;
        if (!reduce) {
          // 점마다 다른 위상·속도로 제자리 주변을 아주 작고 느리게 (형태를 만드는 밝은 점은 더 안정적, 움직이는 버스는 흔들지 않음)
          const wob = g || cur === SPHERE ? 0 : tb < 0.4 ? (FX ? 0.26 : 0.35) : FX ? 0.07 : 0.1;
          x += Math.sin(clock * sp[i] * 0.7 + ph[i]) * wob; y += Math.cos(clock * sp[i] * 0.6 + ph[i] * 1.3) * wob;
          k = FX ? 0.93 + 0.07 * Math.sin(clock * sp[i] * 0.9 + ph[i]) : 0.94 + 0.06 * Math.sin(clock * sp[i] * 1.6 + ph[i]); // 밝기도 천천히, 동시에 깜빡이지 않게
          if (FX && drift[i] && tb < 0.12 && !g && cur !== SPHERE) { // 아주 흐린(윤곽이 아닌) 소수 점: 조금 더 멀리 떠돌았다가 형상으로 돌아옴 (주기 10~25초)
            const w = clock * (0.25 + 0.12 * sp[i]), a = drift[i] * (SMALL ? 0.6 : 1);
            x += a * (Math.sin(w + dph[i]) + 0.35 * Math.sin(w * 2.3 + ph[i])); y += a * 0.7 * (Math.cos(w * 0.8 + dph[i]) + 0.3 * Math.sin(w * 1.7 + ph[i]));
            k *= 0.8 + 0.2 * Math.sin(w * 1.3 + dph[i]);
          }
        }
        if (name && st >= 0) k *= sceneLight(name, i, S.xy[i2], S.xy[i2 + 1], tS, tg);
        if (!g && occ.length) for (let o = 0; o < occ.length; o++) if (inside(occ[o], x, y)) { k *= 0.22; break; } // 버스 뒤 배경은 가려짐
        cr *= k; cg *= k; cb *= k;
      } else {
        let e, sx = 0, sy = 0, lift = 1;
        if (style === 'burst') {
          // 확산(빠르게) → 관성으로 조금 더 펼쳐짐 → 재결합 (밝은 윤곽이 먼저, 노선·안내판·흐린 점은 이어서)
          const sp0 = FX ? spd[i] : 1; // 입자마다 퍼지는 세기·모이는 시점이 조금씩 다름 (관성 → 감속하며 재결합)
          const sOut = (T < D.spread ? easeOut(T / D.spread) : 1 + D.coastGain * (1 - Math.exp(-(T - D.spread) / 0.18))) * sp0;
          const late = (tb > 0.6 ? 0 : D.silhouette * (0.4 + 0.6 * delay[i])) + (tg === 1 || tg === 4 ? 0.15 : 0) + (sp0 - 1) * 0.5;
          const r0 = D.spread + D.coast + late * 0.6, r1 = tb > 0.6 && tg !== 1 && tg !== 4 ? D.spread + D.coast + D.regroup * 0.7 : DUR;
          const u = clamp01((T - r0) / (r1 - r0));
          e = 1 - Math.pow(1 - u, 2.6) * (1 - 0.35 * u);
          sx = bx[i] * sOut * (1 - e); sy = by[i] * sOut * (1 - e);
          lift = 1 + D.flash * Math.exp(-((T - D.spread * 0.6) ** 2) / 0.05);
        } else if (style === 'intro') {
          const late = tb > 0.6 ? 0 : 0.45 * delay[i];
          e = easeOut(clamp01((T - late) / (CFG.intro - late)));
        } else if (style === 'skip') {
          e = easeIO(clamp01((T - delay[i] * 0.25) / (CFG.skip - 0.25)));
        } else e = clamp01(T / 0.6);
        x = ax[i2] + (txp - ax[i2]) * e + sx; y = ax[i2 + 1] + (typ - ax[i2 + 1]) * e + sy;
        const k = from === INTRO ? e : 1; // 첫 로드: 다음 장면 색으로 서서히
        cr = (ac[i3] + (S.col[i3] - ac[i3]) * e * k) * lift; cg = (ac[i3 + 1] + (S.col[i3 + 1] - ac[i3 + 1]) * e * k) * lift; cb = (ac[i3 + 2] + (S.col[i3 + 2] - ac[i3 + 2]) * e * k) * lift;
        if (name === 'libus-1' && tg === 1) { cr *= 0.3 + 0.7 * (1 - e); cg *= 0.3 + 0.7 * (1 - e); cb *= 0.3 + 0.7 * (1 - e); } // 노선은 도착 후 차례로 밝힘
        if (name === 'bit-3' && (tg === 6 || tg === 7)) { const kk = 1 - 0.5 * e; cr *= kk; cg *= kk; cb *= kk; }
      }
      let vx = vel[i2] - off[i2] * C.spring, vy = vel[i2 + 1] - off[i2 + 1] * C.spring;
      if (m.on && push > 0.01) {
        const dx = x + off[i2] - m.x, dy = y + off[i2 + 1] - m.y, d2 = dx * dx + dy * dy;
        if (d2 < R2) { const d = Math.sqrt(d2) + 0.01, kk = 1 - d / C.r, f = (kk * kk * push) / d; vx += dx * f; vy += dy * f; }
      }
      vx *= C.damping; vy *= C.damping; vel[i2] = vx; vel[i2 + 1] = vy;
      let ox = off[i2] + vx, oy = off[i2 + 1] + vy; const om = Math.hypot(ox, oy); if (om > C.maxOff) { ox *= C.maxOff / om; oy *= C.maxOff / om; }
      off[i2] = ox; off[i2 + 1] = oy;
      pos[i2] = x + ox; pos[i2 + 1] = y + oy;
      dep[i] = FX ? depthOf(cur, x, y) + jit[i] : 0.5;
      col[i3] = cr; col[i3 + 1] = cg; col[i3 + 2] = cb;
    }
    render(moving ? clamp01(T / trDur()) : 1);
  }

  function drawHaze(tex, k) {
    if (!tex || k <= 0.001) return;
    if (offX === undefined) { offX = baseX; offY = baseY; }
    gl.useProgram(hprog);
    gl.uniform2f(HU('uView'), W, H); gl.uniform1f(HU('uFit'), vfit); gl.uniform2f(HU('uOff'), offX, offY); gl.uniform2f(HU('uImg'), SW, SH); gl.uniform1f(HU('uK'), k);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(HU('uT'), 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, qb); gl.enableVertexAttribArray(aQ); gl.vertexAttribPointer(aQ, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  const hazeK = (k) => (k < LOOP.length ? conf.scenes[LOOP[k].name].haze ?? 1 : 1); // 장면별 빛 번짐 (밝은 윤곽이 많은 장면은 낮춤)
  function render(hp) {
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    if (from !== cur && hp < 1) drawHaze(hazeTex[from], CFG.haze * hazeK(from) * Math.max(0, 1 - hp * 3));
    drawHaze(hazeTex[cur], CFG.haze * hazeK(cur) * (from === cur || hp >= 1 ? 1 : clamp01((hp - 0.6) / 0.4)));
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, bPos); gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos); gl.enableVertexAttribArray(LA[0]); gl.vertexAttribPointer(LA[0], 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bCol); gl.bufferSubData(gl.ARRAY_BUFFER, 0, col); gl.enableVertexAttribArray(LA[1]); gl.vertexAttribPointer(LA[1], 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bDep); gl.bufferSubData(gl.ARRAY_BUFFER, 0, dep); gl.enableVertexAttribArray(LA[2]); gl.vertexAttribPointer(LA[2], 1, gl.FLOAT, false, 0, 0);
    gl.uniform2f(PU('uView'), W, H); gl.uniform1f(PU('uFit'), vfit); gl.uniform2f(PU('uOff'), offX, offY); gl.uniform1f(PU('uDpr'), dpr);
    gl.uniform1f(PU('uFx'), FX ? 1 : 0); gl.uniform2f(PU('uPar'), par.x * 1.6, par.y * 1.6); gl.uniform1f(PU('uGain'), CFG.gain);
    // 구: 기존 메인과 같은 점 크기(core 2.3 · glow 9.0)로, 전환 중에는 서서히 서비스 값으로
    const sph = cur === SPHERE ? (from === SPHERE || hp >= 1 ? 1 : hp) : from === SPHERE && hp < 1 ? 1 - hp : 0;
    gl.uniform1f(PU('uGlow'), 1); gl.uniform1f(PU('uGA'), CFG.glowAlpha); gl.uniform1f(PU('uSize'), CFG.glow + 0.5 * sph); gl.drawArrays(gl.POINTS, 0, NDRAW);
    gl.uniform1f(PU('uGlow'), 0); gl.uniform1f(PU('uSize'), CFG.core + 0.2 * sph); gl.drawArrays(gl.POINTS, 0, NDRAW);
    // 장면 안 정보 점: 같은 셰이더·같은 변환
    const n = info.count; if (!n) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, iPos); gl.bufferSubData(gl.ARRAY_BUFFER, 0, info.pos.subarray(0, n * 2)); gl.vertexAttribPointer(LA[0], 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, iCol); gl.bufferSubData(gl.ARRAY_BUFFER, 0, info.col.subarray(0, n * 3)); gl.vertexAttribPointer(LA[1], 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, iDep); gl.bufferSubData(gl.ARRAY_BUFFER, 0, idep.subarray(0, n)); gl.vertexAttribPointer(LA[2], 1, gl.FLOAT, false, 0, 0);
    gl.uniform1f(PU('uGlow'), 1); gl.uniform1f(PU('uSize'), CFG.glow * 0.8); gl.drawArrays(gl.POINTS, 0, n);
    gl.uniform1f(PU('uGlow'), 0); gl.uniform1f(PU('uSize'), CFG.infoCore); gl.drawArrays(gl.POINTS, 0, n);
  }

  // ── 첫 로드 ────────────────────────────────────────────────────
  // 미리 준비: 장면별 빛 번짐 텍스처를 한 번씩 GPU 에 올려 둠 (첫 전환 때 올리느라 멈추지 않게, 화면에는 안 남음)
  for (const t of hazeTex) drawHaze(t, 0.002);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  step(0);
  const root = document.documentElement;
  /** 로고가 끝나면 구 화면: 로고가 헤더 가운데로 올라가고, 캔버스가 밝아지며 구의 점이 제자리로 모임 → 티커 → SCROLL */
  let entered = false;
  async function enterSphereOnce() {
    await logoDone;
    // 서체는 기다리지 않음: 티커·설명은 style.css 의 html:not(.sp-fonts) 규칙으로 서체가 준비될 때까지만 숨겨짐 (로고 이동이 서체 로딩에 묶이지 않게)
    if (entered || stageName !== 'logo') return; entered = true;
    introStart = clock; // 구의 첫 모임 (sphere.js introT) — 페이지 로드당 한 번
    ROOT.classList.add('sp-entering');
    setStage('sphere');
    glitchTicker();
    const last = document.querySelector('.scroll-next');
    const done = (e) => { if (e && e.animationName !== 'intro-scroll') return; ROOT.classList.remove('sp-entering'); last?.removeEventListener('animationend', done); };
    last ? last.addEventListener('animationend', done) : done();
    lockInput(reduce ? 300 : 900); // 로고 동안 들어온 스크롤이 이어져 바로 서비스로 넘어가지 않게
  }
  /** 티커 '찌직': 얇은 가로 조각 두 개가 어긋났다 사라짐 (mode: 'in' 등장, 'out' 퇴장). 이전 조각은 먼저 지움 → 빠른 역방향에도 잔상 없음 */
  function glitchTicker(mode = 'in') {
    const head = document.querySelector('.headline'), base = head?.querySelector('.ticker');
    head?.querySelectorAll('.ticker-slice').forEach((n) => n.remove());
    if (!base || reduce) return;
    const baseAnim = base.getAnimations()[0];
    ['a', 'b'].forEach((k) => {
      const slice = base.cloneNode(true);
      slice.classList.add('ticker-slice', `ticker-slice-${k}`, `ticker-slice--${mode}`);
      head.appendChild(slice);
      const mq = slice.getAnimations().find((a) => a.animationName === 'marquee');
      if (mq && baseAnim) mq.currentTime = baseAnim.currentTime;
      slice.addEventListener('animationend', (e) => { if (e.animationName.startsWith('ticker-slice')) slice.remove(); });
    });
  }
  window.__sp = { step, go, advance, setPointer, get stage() { return stageName; }, get clock() { return clock; }, get readyAt() { return readyAt; }, get scene() { return sceneName(); }, get busy() { return busy(); }, get goMs() { return goMs; }, N };
  if (!MANUAL) {
    let last = performance.now(), frames = 0;
    const frame = (now) => { const dt = Math.min(0.05, (now - last) / 1000); last = now; step(dt); if (++frames === 2) enterSphereOnce(); requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
  } else enterSphereOnce();
  setStage(stageName === 'logo' ? 'logo' : stageName);
})().catch((err) => {
  delete document.documentElement.dataset.stage; // 실패하면 숨김을 풀어 바로 보이게
  console.error('[service preview]', err);
});

function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function boxBlur(a, w, h, r) {
  const tmp = new Float32Array(a.length), n = 2 * r + 1;
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < h; y++) { let s = 0; for (let x = -r; x <= r; x++) s += a[(y * w + Math.min(w - 1, Math.max(0, x))) * 3 + c]; for (let x = 0; x < w; x++) { tmp[(y * w + x) * 3 + c] = s / n; s += a[(y * w + Math.min(w - 1, x + r + 1)) * 3 + c] - a[(y * w + Math.max(0, x - r)) * 3 + c]; } }
    for (let x = 0; x < w; x++) { let s = 0; for (let y = -r; y <= r; y++) s += tmp[(Math.min(h - 1, Math.max(0, y)) * w + x) * 3 + c]; for (let y = 0; y < h; y++) { a[(y * w + x) * 3 + c] = s / n; s += tmp[(Math.min(h - 1, y + r + 1) * w + x) * 3 + c] - tmp[(Math.max(0, y - r) * w + x) * 3 + c]; } }
  }
}
