/**
 * 첫 장면 구체 — Figma 원화(sphere-figma.png)의 점을 그대로 쓰되, 점이 구 표면 위에서 움직이게 한다.
 *
 * - 원화의 윤곽·물결 띠 간격·색이 기본 모습. 각 점을 정사영 구 좌표(경도·위도)로 바꿔 둔다.
 * - 표면(r < RIM): 경도를 천천히 앞뒤로 밀어 무늬가 곡면을 타고 흐르게 하고, 가장자리로 넘어가는 점은 흐려진다.
 *   커서 방향(yaw/pitch)도 같은 방식으로 더해져 구체가 커서 쪽으로 살짝 돌아보는 느낌.
 * - 테두리(RIM 근처): 실루엣 빛이므로 회전과 무관하게 제자리 → 둥근 윤곽이 항상 또렷.
 * - 바깥 잔점(r > 1): 멀수록 어둡게, 아주 먼 점은 일부만 남기고, 흔들림은 아주 작게.
 * - 첫 로드: 점이 살짝 회전·확대된 상태에서 제자리로 모이고, 밝은 고리가 중심에서 바깥으로 한 번 훑는다.
 */
const RIM = 0.972; // 이보다 바깥은 테두리·잔점 (회전하지 않음)
const HALO = { start: 1.0, end: 1.32, keepFar: 0.45, dim: 0.88, wobble: 0.006 };
const FLOW = { idle: 0.16, idleSpeed: 0.42, tiltIdle: 0.06, cursorYaw: 0.55, cursorPitch: 0.55 };

export function createSphere(count, order, dots, random) {
  const visible = Math.min(count, dots.count);
  const lon = new Float32Array(visible), lat = new Float32Array(visible);
  const x0 = new Float32Array(visible), y0 = new Float32Array(visible);
  const radius = new Float32Array(visible), seed = new Float32Array(visible);
  const rgb = new Float32Array(visible * 3);
  const sourceRadius = dots.width * 0.192;
  for (let j = 0; j < visible; j++) {
    const sample = Math.floor((j + random()) * dots.count / visible);
    const x = (dots.x[sample] - dots.width * 0.488) / sourceRadius;
    const y = (dots.y[sample] - dots.height * 0.537) / sourceRadius;
    x0[j] = x; y0[j] = y;
    radius[j] = Math.hypot(x, y);
    // 정사영 역변환: 화면 (x, y) → 구 표면 (경도, 위도)
    const la = Math.asin(Math.max(-1, Math.min(1, y)));
    const c = Math.cos(la) || 1e-4;
    lat[j] = la;
    lon[j] = Math.asin(Math.max(-1, Math.min(1, x / c)));
    seed[j] = random();
    rgb.set(dots.rgb.subarray(sample * 3, sample * 3 + 3), j * 3);
  }

  function update({ t, cx, cy, R, yaw, pitch, introT, speed }, xy, col) {
    const time = t * speed;
    // 무늬가 곡면을 타고 좌우로 흐르는 양 + 커서 방향
    const dLon = Math.sin(time * FLOW.idleSpeed) * FLOW.idle + yaw * FLOW.cursorYaw;
    const dLat = Math.sin(time * 0.29) * FLOW.tiltIdle + pitch * FLOW.cursorPitch;
    const cl = Math.cos(dLat), sl = Math.sin(dLat);
    // 다음 장면용 예비 입자는 중심에 숨겨 둠
    for (let j = visible; j < count; j++) { const idx = order[j] * 2; xy[idx] = cx; xy[idx + 1] = cy; }

    for (let j = 0; j < visible; j++) {
      const idx = order[j], r = radius[j];
      const arrival = Math.min(1, Math.max(0, (introT - seed[j] * 0.34) / 1.12));
      const loose = (1 - arrival) ** 3;
      let px, py, light = 1;

      if (r < RIM) {
        // 표면: 경도 이동 → 위도 기울임 → 다시 정사영. 가장자리 너머로 가는 점은 흐려짐
        // 위도마다 테두리 안쪽까지의 경도 폭(lonMax) 안에서 무늬를 민다.
        // 한쪽 끝으로 나간 점은 반대쪽 끝에서 다시 들어오고, 양 끝은 흐리게 → 테두리 안쪽에 빈 틈이 생기지 않음
        const la = lat[j];
        const xMax = Math.sqrt(Math.max(1e-4, RIM * RIM - Math.sin(la) ** 2));
        const lonMax = Math.asin(Math.min(1, xMax / (Math.cos(la) || 1e-4)));
        let u = (lon[j] + dLon + 0.03 * Math.sin(time * 0.7 + la * 6)) / lonMax; // 띠마다 조금씩 다른 흐름
        u = ((((u + 1) % 2) + 2) % 2) - 1;
        light *= smooth(1.0, 0.94, Math.abs(u));
        const lo = u * lonMax;
        let X = Math.cos(la) * Math.sin(lo), Y = Math.sin(la), Z = Math.cos(la) * Math.cos(lo);
        const Y2 = Y * cl + Z * sl, Z2 = -Y * sl + Z * cl;
        Y = Y2; Z = Z2;
        light *= smooth(0.0, 0.16, Z); // 가장자리를 돌아 뒤로 가는 점은 사라짐
        // 테두리 안쪽에 머물도록 (윤곽과 겹쳐 뭉치지 않게)
        const rr = Math.hypot(X, Y), lim = RIM * 1.0;
        if (rr > lim) { X *= lim / rr; Y *= lim / rr; }
        px = X; py = Y;
      } else {
        // 테두리·바깥 잔점: 제자리 + 아주 작은 흔들림
        const halo = smooth(HALO.start, HALO.end, r);
        const w = HALO.wobble * halo * Math.sin(time * 0.8 + seed[j] * 6.28);
        px = x0[j] * (1 + w); py = y0[j] * (1 + w);
        light *= 1 - HALO.dim * halo;
        if (r > HALO.end && seed[j] > HALO.keepFar) light = 0; // 아주 먼 점은 일부만
      }

      // 첫 로드: 살짝 돌아가고 커진 상태에서 제자리로
      if (loose > 0.0005) {
        const tw = loose * (0.7 + seed[j]), c = Math.cos(tw), s = Math.sin(tw);
        const st = 1 + loose * (0.24 + seed[j] * 0.42);
        const qx = (px * c - py * s) * st, qy = (px * s + py * c) * st;
        px = qx; py = qy;
      }
      xy[idx * 2] = cx + R * px;
      xy[idx * 2 + 1] = cy + R * py;

      const crest = Math.max(0, Math.cos(Math.atan2(y0[j], x0[j]) * 2 - time * 1.8 + r * 5)) ** 9 * (r < 1.02 ? 1 : 0);
      const sweep = Math.max(0, 1 - Math.abs(r - introT * 0.96) * 8);
      light *= (0.48 + 0.52 * arrival) * (0.88 + crest * 0.4 + sweep * 0.9);
      for (let k = 0; k < 3; k++) col[idx * 3 + k] = rgb[j * 3 + k] * light;
    }
  }
  return { update };
}

function smooth(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
