/**
 * 서비스 시연 — 공통 예시 운행 데이터와 장면별 시간표
 *
 * 네 서비스가 같은 정류장(중앙시장)과 같은 버스(100·201·305·402)를 본다.
 * 시간 흐름은 축약했다 (화면에 ‘서비스 시연 · 시간 흐름을 축약한 예시’ 표시).
 * 모든 상태는 장면 시간 t(초)의 순수 함수 → 언제 장면을 떠나거나 다시 들어와도 같은 상태로 다시 그려진다.
 * 숫자는 사건(버스가 다가옴)에 따라서만 바뀌고, 바뀐 뒤에는 읽을 수 있게 머문다.
 */
export const STOP = '중앙시장';
export const BUSES = {
  100: { no: '100', vehicle: '7014', dir: '터미널 방면' },
  201: { no: '201', vehicle: '7022', dir: '시청 방면' },
  305: { no: '305', vehicle: '7109', dir: '터미널 방면' },
  402: { no: '402', vehicle: '7133', dir: '시청 방면' },
};
export const NOTE = '서비스 시연 · 시간 흐름을 축약한 예시';

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const easeOut = (x) => 1 - Math.pow(1 - clamp01(x), 2.4); // 다가와서 부드럽게 감속
const easeIn = (x) => Math.pow(clamp01(x), 2.2); // 출발: 천천히 가속

const step = (list, t) => { let v = list[0][1]; for (const [at, x] of list) if (t >= at) v = x; return v; };
const lastAt = (list, t) => { let v = -9; for (const [at] of list) if (t >= at && at > 0) v = at; return v; };

// ── LIVEBUS: 100번이 도로를 따라 다가와 감속해 정류장에 정차 ─────────────
// 위치·문구가 같은 진행도에서 나옴. 문구는 바뀐 뒤 1.8초 이상 머묾. 정차한 채로 장면이 끝남 (반복 시 점프 없음)
export const LIVEBUS = {
  hold: 11.0,
  screenOn: 0.35,
  // 장면이 완성되고 1.4초 동안 버스·노선·안내판을 읽을 시간 → 다가와 6.6초에 정차 (안내판 '도착'과 같은 순간)
  move: { start: 1.4, arrive: 6.6 },
  eta: [[0, '2분 후'], [2.8, '1분 후'], [4.9, '곧 도착'], [6.6, '도착']],
  // 정차 뒤 2.6초 동안 '도착' 강조 → 다음 정보: 201번이 한 단계 가까워짐
  next: { at: 9.4, row2: ['4분 후', '3분 후'] },
  state(t) {
    const M = this.move, x = clamp01((t - M.start) / (M.arrive - M.start));
    // 서서히 출발 → 일정하게 → 정류장 앞에서 길게 감속 (속도가 0에서 시작해 0으로 끝남)
    const q = (() => { // 가속 구간(0~0.22) 2차, 이후 감속은 1-(1-u)^2.3 으로 이어 붙인 진행도
      const a0 = 0.22, v = 1 / (a0 / 2 + (1 - a0) / 2.3); // 최고 속도 (정규화)
      if (x < a0) return (v * x * x) / (2 * a0);
      const u = (x - a0) / (1 - a0); return (v * a0) / 2 + (v * (1 - a0) / 2.3) * (1 - Math.pow(1 - u, 2.3));
    })();
    const eta = step(this.eta, t);
    const hot = t >= M.arrive && t < this.next.at;
    return { u: 1 - q, p: q, stopped: t >= M.arrive, eta, changedAt: lastAt(this.eta, t), arrivedHot: hot, row2: t >= this.next.at ? this.next.row2[1] : this.next.row2[0], pinP: 2.7 + 2.3 * q };
  },
};

// ── BMS: 네 버스가 각자 도로에서 다른 박자로 달리고 멈춤 ─────────────────
// off: 버스 진행 방향 이동량 (원본 px). -back → 0(정차 위치, 원본 그림 위치) → +ahead
export const BMS = {
  hold: 10.0,
  // 짧은 구간만: 뒤에서 출발 → 정류장(원본 위치)에 정차 → 조금 더 나아가 멈춤
  buses: [
    { id: '402', back: 46, ahead: 30, go: 0.5, stop: 3.4, stopFor: 2.2, speed: 16 },
    { id: '201', back: 54, ahead: 26, go: 1.3, stop: 4.6, stopFor: 2.0, speed: 15 },
    { id: '100', back: 50, ahead: 28, go: 0.9, stop: 4.0, stopFor: 2.6, speed: 14, stopName: STOP },
    { id: '305', back: 40, ahead: 24, go: 1.8, stop: 5.0, stopFor: 1.8, speed: 15 },
  ],
  selected: '100',
  state(t) {
    return this.buses.map((b) => {
      const end = b.stop + b.stopFor;
      let off, status;
      if (t < b.go) { off = -b.back; status = '운행 중'; }
      else if (t < b.stop) { off = -b.back + b.back * smooth((t - b.go) / (b.stop - b.go)); status = '운행 중'; }
      else if (t < end) { off = 0; status = b.stopName ? `${b.stopName} 정차` : '정류장 정차'; }
      else { off = b.ahead * smooth((t - end) / (b.ahead / b.speed * 1.6)); status = '운행 중'; }
      const report = t >= end ? 2 : t >= b.stop ? 1 : t >= b.go ? 0 : -1; // 상태가 바뀔 때 위치 보고
      const reportAt = report === 2 ? end : report === 1 ? b.stop : b.go;
      return { id: b.id, off, status, report, reportAt };
    });
  },
};

// ── BIT: 태양광 패널 → 기둥 → 화면으로 정보가 들어와 목록이 갱신됨 ─────
// 숫자 변경과 목록 재정렬 사이에 읽을 시간을 둠
export const BIT = {
  hold: 11.8,
  screenOn: 0.35,
  charge: [0.2, 1.6], // 패널을 지나는 빛
  events: [
    { at: 2.6, set: { 100: '1분' } },
    { at: 4.8, set: { 100: '곧 도착' } },
    { at: 6.8, set: { 100: '도착' } },
    { at: 8.4, remove: '100' },
    { at: 9.9, add: { no: '402', eta: '9분' } },
  ],
  initial: [{ no: '100', eta: '2분' }, { no: '201', eta: '4분' }, { no: '305', eta: '6분' }],
  /** 갱신 신호: 패널 → 기둥 → 화면 (도착 시각 = 사건 시각) */
  get signals() { return this.events.filter((e) => e.set).map((e) => e.at); },
  state(t) {
    const rows = this.initial.map((r) => ({ ...r, hot: false, leaving: 0, entering: 1 }));
    for (const e of this.events) {
      if (t < e.at) break;
      if (e.set) for (const k in e.set) { const r = rows.find((x) => x.no === k); if (r) r.eta = e.set[k]; }
      if (e.remove) { const r = rows.find((x) => x.no === e.remove); if (r) { r.leaving = clamp01((t - e.at) / 0.6); r.collapse = smooth((t - e.at - 0.6) / 0.7); } }
      if (e.add) rows.push({ ...e.add, hot: false, leaving: 0, entering: clamp01((t - e.at) / 0.7) });
    }
    const r100 = rows.find((x) => x.no === '100');
    if (r100 && (r100.eta === '곧 도착' || r100.eta === '도착')) r100.hot = true;
    // 사라진 행이 다 흩어진 뒤(0.6초) 남은 행이 0.7초에 걸쳐 위로
    let y = 0;
    for (const r of rows) { r.y = y; y += 1 - (r.collapse || 0); }
    return rows;
  },
};

// ── BIS: 휴대폰 지도에서 201번이 중앙시장으로 다가옴 ─────────────────────
export const BIS = {
  hold: 10.5,
  screenOn: 0.5,
  bus: '201',
  // 노선(정류장 사이 구간 0..6) 위 위치. 정류장에서 잠깐 멈춤
  keys: [[0, 0.2], [1.0, 0.2], [2.6, 1.0], [3.2, 1.0], [4.6, 2.0], [5.2, 2.0], [7.6, 5.0], [8.1, 6.0]],
  stops: [1, 2, 5, 6], // 6 = 중앙시장(목표)
  state(t) {
    const K = this.keys;
    let s = K[K.length - 1][1];
    for (let i = 0; i < K.length - 1; i++) {
      if (t < K[i + 1][0]) { const [t0, s0] = K[i], [t1, s1] = K[i + 1]; s = t < t0 ? s0 : s0 + (s1 - s0) * smooth((t - t0) / (t1 - t0)); break; }
    }
    const ahead = this.stops.filter((k) => k > s + 0.02 && k < 6).length; // 목표 전까지 남은 정류장
    const arrived = s >= 5.99;
    const text = arrived ? '도착' : ahead >= 3 ? '3개 정류장 전 · 3분' : ahead === 2 ? '2개 정류장 전 · 2분' : '곧 도착';
    const changes = [0, 2.6, 4.6, 8.1].filter((x) => x <= t);
    return { s, arrived, text, updatedAt: changes[changes.length - 1], ripple: arrived ? clamp01((t - 8.1) / 1.0) : 0 };
  },
};
