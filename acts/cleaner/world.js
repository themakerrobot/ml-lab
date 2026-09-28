// ═══════════════════════════════════════════════════════════
// 청소 활동 — 방 · 청소기 · 규칙 청소기 · 배우는 청소기 (DOM 없음)
// ═══════════════════════════════════════════════════════════
// 방은 칸(격자). 0 = 바닥, 1 = 벽·가구. 모든 바닥은 처음에 더럽다.
// 청소기는 자기 기준으로 본다 (앞 · 왼쪽 · 오른쪽 칸이 벽/깨끗/더러움) + 먼지 나침반
// (가장 가까운 먼지가 앞/왼/오른/뒤 어느 쪽인지, 없으면 없음).
// 할 수 있는 것: 0 앞으로, 1 왼쪽으로 돌아 한 칸, 2 오른쪽으로 돌아 한 칸, 3 뒤돌아 한 칸.
//
// 규칙 청소기 셋과, 같은 센서로 Q-러닝을 하는 배우는 청소기를 겨룬다.

export const W = 14, H = 10;
export const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];      // 북 동 남 서 (화면 y 아래)
export const ACTIONS = ['앞으로', '왼쪽으로', '오른쪽으로', '뒤로'];
const TURN = [0, 3, 1, 2];                                    // 행동 → 방향 바꾸기 (오른쪽 +1)

export function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// ── 방 ──────────────────────────────────────────────────────
export function emptyRoom() {
  const g = new Uint8Array(W * H);
  for (let x = 0; x < W; x++) { g[x] = 1; g[(H - 1) * W + x] = 1; }
  for (let y = 0; y < H; y++) { g[y * W] = 1; g[y * W + W - 1] = 1; }
  return g;
}
function box(g, x0, y0, w, h) { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) g[y * W + x] = 1; }
export const ROOMS = {
  living: { label: '거실', make: () => { const g = emptyRoom(); box(g, 4, 3, 3, 2); box(g, 9, 6, 2, 2); box(g, 10, 1, 1, 2); return g; } },
  study: { label: '공부방', make: () => { const g = emptyRoom(); box(g, 1, 4, 5, 1); box(g, 8, 2, 1, 5); box(g, 11, 6, 2, 1); return g; } },
  maze: { label: '처음 보는 방', unseen: true, make: () => { const g = emptyRoom(); box(g, 3, 1, 1, 5); box(g, 6, 4, 1, 5); box(g, 9, 1, 1, 5); box(g, 11, 6, 2, 2); return g; } },
};

// 연습용 무작위 방: 가구 4개를 아무 데나
export function randomRoom(rnd) {
  const g = emptyRoom();
  for (let k = 0; k < 4; k++) {
    const w = 1 + ((rnd() * 3) | 0), h = 1 + ((rnd() * 4) | 0);
    box(g, 1 + ((rnd() * (W - 2 - w)) | 0), 1 + ((rnd() * (H - 2 - h)) | 0), w, h);
  }
  return g;
}

// ── 한 판 ───────────────────────────────────────────────────
export class Sim {
  // useCompass: 먼지 나침반 센서를 켤지 (끄면 늘 "없음" 으로 보인다 — 3차시 실험)
  constructor(room, start = null, { useCompass = true } = {}) {
    this.room = room; this.useCompass = useCompass;
    this.dirty = new Uint8Array(W * H);
    let floor = 0;
    for (let i = 0; i < W * H; i++) if (!room[i]) { this.dirty[i] = 1; floor++; }
    this.floor = floor; this.cleaned = 0;
    const s = start || this.firstFloor();
    this.x = s[0]; this.y = s[1]; this.dir = s[2] ?? 1;
    this.clean(this.x, this.y);
    this.steps = 0; this.bumps = 0;
  }
  firstFloor() { for (let i = 0; i < W * H; i++) if (!this.room[i]) return [i % W, (i / W) | 0, 1]; return [1, 1, 1]; }
  wall(x, y) { return x < 0 || y < 0 || x >= W || y >= H || this.room[y * W + x] === 1; }
  clean(x, y) { const i = y * W + x; if (this.dirty[i]) { this.dirty[i] = 0; this.cleaned++; return true; } return false; }
  get coverage() { return this.cleaned / this.floor; }

  // 칸 상태: 0 벽, 1 깨끗, 2 더러움
  cell(d) {
    const [dx, dy] = DIRS[d], x = this.x + dx, y = this.y + dy;
    return this.wall(x, y) ? 0 : this.dirty[y * W + x] ? 2 : 1;
  }
  // 가장 가까운 먼지 쪽 (벽을 돌아가는 거리, BFS): 0 앞 1 왼 2 오른 3 뒤 4 없음
  compass() {
    const seen = new Int16Array(W * H).fill(-1), q = [];
    const start = this.y * W + this.x;
    seen[start] = 4;
    // 거리가 같으면 앞 → 왼 → 오른 → 뒤 순서로 (먼저 넣은 쪽이 먼저 나온다)
    for (const d of [this.dir, (this.dir + 3) % 4, (this.dir + 1) % 4, (this.dir + 2) % 4]) {
      const [dx, dy] = DIRS[d], x = this.x + dx, y = this.y + dy;
      if (this.wall(x, y)) continue;
      const i = y * W + x; seen[i] = d; q.push(i);
    }
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      if (this.dirty[i]) {
        const d = seen[i];                           // 첫걸음 방향(절대)
        return [0, 2, 3, 1][(d - this.dir + 4) % 4];  // 앞 오른 뒤 왼 → 앞0 왼1 오른2 뒤3
      }
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (this.wall(nx, ny)) continue;
        const j = ny * W + nx;
        if (seen[j] < 0) { seen[j] = seen[i]; q.push(j); }
      }
    }
    return 4;
  }
  // 상태 번호: 앞·왼·오른 칸(각 3) × 나침반(5) = 135
  state() {
    const f = this.cell(this.dir), l = this.cell((this.dir + 3) % 4), r = this.cell((this.dir + 1) % 4);
    return ((f * 3 + l) * 3 + r) * 5 + (this.useCompass ? this.compass() : 4);
  }
  // 반환: { cleaned, bumped }
  act(a) {
    this.dir = (this.dir + TURN[a]) % 4;
    const [dx, dy] = DIRS[this.dir], x = this.x + dx, y = this.y + dy;
    this.steps++;
    if (this.wall(x, y)) { this.bumps++; return { cleaned: false, bumped: true }; }
    this.x = x; this.y = y;
    return { cleaned: this.clean(x, y), bumped: false };
  }
}
export const N_STATES = 135;

// ── 규칙 청소기 ─────────────────────────────────────────────
// 무작위 튕기기: 곧게 가다가 부딪히면 아무 쪽으로
export function ruleBounce(rnd) {
  let hit = false;
  return {
    pick(sim) { if (hit || sim.cell(sim.dir) === 0) { hit = false; return 1 + ((rnd() * 3) | 0); } return 0; },
    after(r) { hit = r.bumped; },
  };
}
// 지그재그: 가로로 끝까지 → 한 칸 내려가서 반대로. 막히면 아무 쪽
export function ruleZigzag(rnd) {
  let phase = 0;                       // 0 가로로 가는 중, 1 아래로 한 칸 간 뒤 돌기
  return {
    pick(sim) {
      const horiz = sim.dir === 1 || sim.dir === 3;
      if (phase === 1) { phase = 0; return sim.dir === 2 ? (sim.lastH === 1 ? 2 : 1) : 0; }
      if (horiz && sim.cell(sim.dir) !== 0) return 0;
      if (horiz) {                     // 끝에 닿음 → 아래로 돌기
        sim.lastH = sim.dir;
        const down = sim.dir === 1 ? 2 : 1;          // 동쪽이면 오른쪽 돌면 남, 서쪽이면 왼쪽 돌면 남
        if (sim.cell(2) !== 0) { phase = 1; return down; }
        return 3;
      }
      if (sim.cell(sim.dir) !== 0 && rnd() < 0.3) return 0;
      return 1 + ((rnd() * 2) | 0);
    },
    after() {},
  };
}
// 벽 따라가기 (오른손): 오른쪽이 열려 있으면 오른쪽, 아니면 앞, 아니면 왼쪽, 아니면 뒤
export function ruleWall() {
  return {
    pick(sim) {
      if (sim.cell((sim.dir + 1) % 4) !== 0) return 2;
      if (sim.cell(sim.dir) !== 0) return 0;
      if (sim.cell((sim.dir + 3) % 4) !== 0) return 1;
      return 3;
    },
    after() {},
  };
}
export const RULES = {
  bounce: { label: '무작위 튕기기', make: ruleBounce },
  zigzag: { label: '지그재그', make: ruleZigzag },
  wall: { label: '벽 따라가기', make: ruleWall },
};

// ── 배우는 청소기 (Q-러닝) ──────────────────────────────────
export const DEFAULT_REWARD = { clean: 1, step: -0.05, bump: -0.5 };

export class QAgent {
  constructor({ alpha = 0.2, gamma = 0.9 } = {}) {
    this.Q = new Float32Array(N_STATES * 4);
    Object.assign(this, { alpha, gamma });
    this.episodes = 0;
  }
  best(s) { let b = 0; for (let a = 1; a < 4; a++) if (this.Q[s * 4 + a] > this.Q[s * 4 + b]) b = a; return b; }
  values(s) { return Array.from(this.Q.subarray(s * 4, s * 4 + 4)); }
  // 한 판 배우기. 반환: 이번 판에서 받은 상 합계와 청소 비율
  episode(room, reward, { steps = 250, eps = 0.1, rnd = Math.random, start = null, useCompass = true } = {}) {
    const sim = new Sim(room, start, { useCompass });
    let s = sim.state(), total = 0;
    for (let t = 0; t < steps && sim.cleaned < sim.floor; t++) {
      const a = rnd() < eps ? (rnd() * 4) | 0 : this.best(s);
      const r = sim.act(a);
      const rw = reward.step + (r.cleaned ? reward.clean : 0) + (r.bumped ? reward.bump : 0);
      const s2 = sim.state();
      const q = this.Q, i = s * 4 + a;
      let mx = q[s2 * 4]; for (let k = 1; k < 4; k++) mx = Math.max(mx, q[s2 * 4 + k]);
      q[i] += this.alpha * (rw + this.gamma * mx - q[i]);
      s = s2; total += rw;
    }
    this.episodes++;
    return { total, coverage: sim.coverage };
  }
  // 실제로 청소할 때도 5% 는 아무거나 해 본다 — 같은 칸을 맴도는 고리에서 빠져나오게
  // (0 으로 두면 시드에 따라 한곳에서 계속 부딪히며 멈추는 일이 잦았다. DEVELOP.md)
  policy(rnd = Math.random, eps = 0.05) {
    return { pick: sim => rnd() < eps ? (rnd() * 4) | 0 : this.best(sim.state()), after() {} };
  }
}

// 여러 출발점에서 steps 걸음 동안 평균 청소 비율 · 부딪힌 수
export function evaluate(room, makeBot, { steps = 250, starts = 6, seed = 5, useCompass = true } = {}) {
  const rnd = seeded(seed), floors = [];
  for (let i = 0; i < W * H; i++) if (!room[i]) floors.push(i);
  let cov = 0, bumps = 0;
  for (let k = 0; k < starts; k++) {
    const i = floors[(rnd() * floors.length) | 0];
    const sim = new Sim(room, [i % W, (i / W) | 0, (rnd() * 4) | 0], { useCompass });
    const bot = makeBot(seeded(seed + k));
    for (let t = 0; t < steps && sim.cleaned < sim.floor; t++) bot.after(sim.act(bot.pick(sim)));
    cov += sim.coverage / starts; bumps += sim.bumps / starts;
  }
  return { coverage: cov, bumps };
}
