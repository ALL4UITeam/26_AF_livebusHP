/**
 * 한 블록을 계속 도는 닫힌 코스와 버스 운동.
 *
 * 코스(차로 중심선): [긴 직선 → 완화곡선 → 원호 → 완화곡선] × 4 = 좌회전 4번의 닫힌 사각 루프.
 *   곡률이 0 → 1/R → 0 으로 선형으로 바뀌어 위치·방향·곡률이 모두 끊김 없이 이어진다.
 *
 * 버스: 차체의 기준점(REF, 앞차축 근처)이 차로 중심선을 정확히 따라가고,
 *   뒷차축은 그 기준점을 끌려가듯 따라온다(트랙트릭스 = 바퀴가 옆으로 미끄러지지 않는 조건).
 *   그래서 코너에서 뒷바퀴는 저절로 안쪽으로 파고들고, 앞 범퍼 바깥 모서리는 크게 돈다.
 *   기준점 위치는 그 두 궤적이 차로 중심에서 좌우 대칭이 되도록 고른다.
 *
 * 시간: 속도는 "코스 위 위치"의 함수(직선 순항 → 코너 앞 완만한 감속 → 탈출하며 재가속)
 *   라서 출발 가속이 끝난 뒤부터는 매 바퀴가 똑같이 반복된다. 첫 바퀴 이후는 주기로 이어 붙여
 *   몇 바퀴를 돌아도 위치·방향이 튀지 않는다.
 *
 * 좌표: 처음 진행 방향 +x, 좌회전은 -z 쪽(위에서 보면 반시계). yaw 는 왼쪽이 + (바퀴마다 2π 증가).
 */

/**
 * @typedef {object} CourseOptions
 * @property {number} laneWidth 차로 폭
 * @property {number} straight 코너 사이 직선 길이 (차로 중심선)
 * @property {number} radius 코너 원호 반지름 (차로 중심선)
 * @property {number} ease 직선↔원호 완화곡선 길이
 * @property {number} cruise 직선 순항 속도
 * @property {number} cornerSpeed 코너 속도 (완만한 감속)
 * @property {number} decelLen 코너 진입 전 감속 구간 길이
 * @property {number} accelLen 코너 탈출 후 재가속 구간 길이
 * @property {number} launchDur 최초 출발 가속 시간
 * @property {number} refX 차로 중심선을 따라가는 차체 기준점의 x (버스 로컬)
 * @property {number} rearX 뒷차축 x (버스 로컬)
 * @property {number} frontAxleX 앞차축 x (버스 로컬)
 * @property {number} startU 출발 시 기준점의 코스 위치
 * @property {number} blinkLead 감속 시작보다 이만큼 앞에서 깜빡이 시작
 */

/**
 * @typedef {object} BusPose
 * @property {number} x 버스 원점 x
 * @property {number} z 버스 원점 z
 * @property {number} yaw 누적 yaw (좌 +, 바퀴마다 2π 증가)
 * @property {number} steer 앞바퀴 조향각 (좌 +)
 * @property {number} k 기준점 경로 곡률
 */

/**
 * @typedef {object} CoursePlan
 * @property {number} lapLength 차로 중심선 한 바퀴 길이
 * @property {(tau: number) => number} uAt 출발(τ=0) 후 기준점이 코스를 따라 간 누적 거리 (startU 포함)
 * @property {(tau: number) => number} speedAt
 * @property {(tau: number) => number} accelAt
 * @property {(u: number, out: BusPose) => BusPose} poseAt 누적 거리 u 에서의 버스 자세
 * @property {(u: number) => {x: number, z: number, yaw: number, nx: number, nz: number, k: number}} centerAt
 *   차로 중심선 위 점과 오른쪽 법선 (u 는 한 바퀴 안으로 접힘)
 * @property {(u: number) => number} tauAtU 기준점이 u 를 지나는 시각 τ
 * @property {number[]} cornerStarts 코너 시작 위치(차로 중심선, 한 바퀴 안)
 * @property {number} cornerLength
 * @property {number[]} blinkU 깜빡이 시작 위치 (한 바퀴 안)
 * @property {{x: number, z: number}} originOffset 월드 좌표 보정 (출발 시 버스 원점이 원점이 되도록)
 * @property {number} lapTime 출발 가속 이후 한 바퀴 시간
 */

const smooth = (a, b, v) => {
  const x = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return x * x * (3 - 2 * x);
};
const mod = (a, n) => ((a % n) + n) % n;

/**
 * @param {CourseOptions} o
 * @returns {CoursePlan}
 */
export function createCourse(o) {
  const k0 = 1 / o.radius;
  const arcLen = Math.PI / 2 / k0 - o.ease;
  const cornerLength = 2 * o.ease + arcLen;
  const seg = o.straight + cornerLength;
  const L = seg * 4;
  const cornerStarts = [0, 1, 2, 3].map((i) => i * seg + o.straight);

  const curv = (u) => {
    const w = mod(u, seg) - o.straight;
    if (w <= 0 || w >= cornerLength) return 0;
    if (w < o.ease) return (k0 * w) / o.ease;
    if (w < o.ease + arcLen) return k0;
    return (k0 * (cornerLength - w)) / o.ease;
  };

  // ── 차로 중심선 (한 바퀴, ds = 0.02) ──
  const DS = 0.02;
  const nC = Math.ceil(L / DS) + 2;
  const cx = new Float64Array(nC);
  const cz = new Float64Array(nC);
  const cy = new Float64Array(nC);
  {
    let x = 0;
    let z = 0;
    let yaw = 0;
    for (let i = 0; i < nC; i++) {
      cx[i] = x;
      cz[i] = z;
      cy[i] = yaw;
      const kMid = curv(i * DS + DS / 2);
      const yMid = yaw + (kMid * DS) / 2;
      x += Math.cos(yMid) * DS;
      z -= Math.sin(yMid) * DS;
      yaw += kMid * DS;
    }
  }
  const centerRaw = (u) => {
    const uu = mod(u, L);
    const f = uu / DS;
    const i = Math.min(Math.floor(f), nC - 2);
    const t = f - i;
    const yaw = cy[i] + (cy[i + 1] - cy[i]) * t;
    return {
      x: cx[i] + (cx[i + 1] - cx[i]) * t,
      z: cz[i] + (cz[i + 1] - cz[i]) * t,
      yaw,
      nx: Math.sin(yaw), // 진행 방향의 오른쪽
      nz: Math.cos(yaw),
      k: curv(uu),
    };
  };

  // ── 버스 자세: 기준점이 중심선을 따라가고 뒷차축은 끌려옴 (3바퀴 시뮬레이션) ──
  const Lp = o.refX - o.rearX; // 뒷차축 ~ 기준점 거리
  const WB = o.frontAxleX - o.rearX;
  const DU = 0.02;
  const laps = 3;
  const nB = Math.ceil((laps * L) / DU) + 2;
  const bx = new Float64Array(nB); // 버스 원점
  const bz = new Float64Array(nB);
  const byaw = new Float64Array(nB);
  const bsteer = new Float64Array(nB);
  {
    const p0 = centerRaw(o.startU);
    let rx = p0.x - Math.cos(p0.yaw) * Lp;
    let rz = p0.z + Math.sin(p0.yaw) * Lp;
    let prevYaw = 0;
    let yawAcc = 0;
    let fxPrev = 0;
    let fzPrev = 0;
    for (let i = 0; i < nB; i++) {
      const p = centerRaw(o.startU + i * DU);
      // 뒷차축은 기준점 쪽으로만 움직인다 (옆으로 미끄러지지 않음)
      let dx = p.x - rx;
      let dz = p.z - rz;
      let d = Math.hypot(dx, dz);
      rx = p.x - (dx / d) * Lp;
      rz = p.z - (dz / d) * Lp;
      dx = p.x - rx;
      dz = p.z - rz;
      d = Math.hypot(dx, dz);
      const hx = dx / d;
      const hz = dz / d;
      const yawRaw = Math.atan2(-hz, hx);
      // 누적 yaw (바퀴마다 2π 씩 증가)
      if (i === 0) yawAcc = yawRaw;
      else {
        let dy = yawRaw - prevYaw;
        dy = mod(dy + Math.PI, Math.PI * 2) - Math.PI;
        yawAcc += dy;
      }
      prevYaw = yawRaw;
      byaw[i] = yawAcc;
      bx[i] = rx - hx * o.rearX;
      bz[i] = rz - hz * o.rearX;
      // 앞차축 속도 방향 − 차체 방향 = 앞바퀴 조향각
      const fx = rx + hx * WB;
      const fz = rz + hz * WB;
      if (i > 0) {
        const vyaw = Math.atan2(-(fz - fzPrev), fx - fxPrev);
        const st = mod(vyaw - yawRaw + Math.PI, Math.PI * 2) - Math.PI;
        bsteer[i] = st;
        if (i === 1) bsteer[0] = st;
      }
      fxPrev = fx;
      fzPrev = fz;
    }
  }

  // 출발 시 버스 원점이 월드 원점이 되도록
  const originOffset = { x: bx[0], z: bz[0] };

  const poseAt = (u, out) => {
    let w = u - o.startU;
    let lap = 0;
    // 3바퀴 표를 넘으면 세 번째 바퀴 구간(출발 직후 과도 상태가 사라진 구간)을 반복
    const wMax = 3 * L - DU * 4;
    if (w > wMax) {
      lap = Math.ceil((w - wMax) / L);
      w -= lap * L;
    }
    if (w < 0) w = 0;
    const f = w / DU;
    const i = Math.min(Math.floor(f), nB - 2);
    const t = f - i;
    out.x = bx[i] + (bx[i + 1] - bx[i]) * t - originOffset.x;
    out.z = bz[i] + (bz[i + 1] - bz[i]) * t - originOffset.z;
    out.yaw = byaw[i] + (byaw[i + 1] - byaw[i]) * t + lap * Math.PI * 2;
    out.steer = bsteer[i] + (bsteer[i + 1] - bsteer[i]) * t;
    out.k = curv(u);
    return out;
  };

  const centerAt = (u) => {
    const c = centerRaw(u);
    c.x -= originOffset.x;
    c.z -= originOffset.z;
    return c;
  };

  // ── 속도: 코스 위치의 함수 (+ 최초 출발 가속) ──
  const profile = (u) => {
    let w = 0;
    for (let c = 0; c < 4; c++) {
      // 가장 가까운 반복 위치의 코너 기준
      const cs = cornerStarts[c] + Math.round((u - cornerStarts[c]) / L) * L;
      const ce = cs + cornerLength;
      const wc = smooth(cs - o.decelLen, cs, u) * (1 - smooth(ce - o.ease * 0.5, ce + o.accelLen, u));
      w = Math.max(w, wc);
    }
    return o.cruise + (o.cornerSpeed - o.cruise) * w;
  };

  const DT = 0.005;
  const uTab = [];
  const vTab = [];
  {
    let u = o.startU;
    let tau = 0;
    while (u < o.startU + laps * L) {
      const v = profile(u) * smooth(0, o.launchDur, tau);
      uTab.push(u);
      vTab.push(v);
      u += Math.max(v, 1e-4) * DT;
      tau += DT;
    }
    uTab.push(u);
    vTab.push(profile(u));
  }
  const nT = uTab.length;
  const findTau = (u) => {
    // 이진 탐색 (uTab 은 단조 증가)
    let lo = 0;
    let hi = nT - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (uTab[m] <= u) lo = m;
      else hi = m;
    }
    const t = (u - uTab[lo]) / Math.max(1e-9, uTab[hi] - uTab[lo]);
    return (lo + Math.min(1, Math.max(0, t))) * DT;
  };
  const uEnd = o.startU + 3 * L - 1; // 표가 확실히 덮는 끝
  const tau2 = findTau(o.startU + 2 * L);
  const tau3 = findTau(o.startU + 3 * L);
  const T_LAP = tau3 - tau2; // 출발 가속이 끝난 뒤 한 바퀴 시간
  const tauEnd = findTau(uEnd);

  const fold = (tau) => {
    // τ 를 표 범위로 접고, 몇 바퀴를 건너뛰었는지
    if (tau <= tauEnd) return { tau, laps: 0 };
    const k = Math.ceil((tau - tauEnd) / T_LAP);
    return { tau: tau - k * T_LAP, laps: k };
  };
  const lerpTab = (tab, tau) => {
    const f = tau / DT;
    const i = Math.min(Math.floor(f), nT - 2);
    const t = f - i;
    return tab[i] + (tab[i + 1] - tab[i]) * t;
  };
  const uAt = (tau) => {
    if (tau <= 0) return o.startU;
    const f = fold(tau);
    return lerpTab(uTab, f.tau) + f.laps * L;
  };
  const speedAt = (tau) => {
    if (tau <= 0) return 0;
    return lerpTab(vTab, fold(tau).tau);
  };
  const accelAt = (tau) => (speedAt(tau + 0.05) - speedAt(tau - 0.05)) / 0.1;
  const tauAtU = (u) => {
    if (u <= o.startU) return 0;
    if (u <= uEnd) return findTau(u);
    const k = Math.ceil((u - uEnd) / L);
    return findTau(u - k * L) + k * T_LAP;
  };

  const blinkU = cornerStarts.map((cs) => cs - o.decelLen - o.blinkLead);

  return {
    lapLength: L,
    uAt,
    speedAt,
    accelAt,
    poseAt,
    centerAt,
    tauAtU,
    cornerStarts,
    cornerLength,
    blinkU,
    originOffset,
    lapTime: T_LAP,
  };
}
