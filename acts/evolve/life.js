// ═══════════════════════════════════════════════════════════
// 진화 활동 — 가상 생물 · 물리 · 진화 (DOM 없음)
// ═══════════════════════════════════════════════════════════
// 생물 = 점(발) + 뼈(길이가 안 바뀌는 막대) + 근육(주기적으로 늘었다 줄었다 하는 막대).
// 유전자 = 근육마다 [세기, 박자] + 전체 빠르기 + 점마다 미끄러움.
// 물리는 위치 기반(Verlet + 막대 길이 맞추기)이라 튼튼하다. y 는 위쪽이 +, 땅은 y = 지형 높이.
//
// 진화: 한 세대 24마리를 똑같은 시간 동안 움직여 보고, "상" 점수가 높은 6마리를 남긴 뒤
//       그 유전자를 조금씩 바꿔(돌연변이) 다음 세대를 채운다.

export const DT = 1 / 60, SIM_SECONDS = 6, ITER = 6, GRAVITY = 9.8;

export function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const gauss = rnd => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return (u - 3) / Math.sqrt(0.5); };

// ── 몸 ──────────────────────────────────────────────────────
// nodes: [x, y] (미터), bones: [a, b], muscles: [a, b]. top: "머리" 점 (뒤집힘 판정)
export const BODIES = {
  crawler: {
    label: '애벌레',
    nodes: [[0, 0.05], [0.4, 0.05], [0.8, 0.05], [0.2, 0.35], [0.6, 0.35]],
    bones: [[0, 3], [1, 3], [1, 4], [2, 4], [3, 4]],
    muscles: [[0, 1], [1, 2], [0, 4], [2, 3]],
    top: [3, 4],
  },
  table: {
    label: '네발이',
    nodes: [[0, 0.05], [0.9, 0.05], [0.15, 0.5], [0.75, 0.5], [0.45, 0.55]],
    bones: [[2, 4], [4, 3], [2, 3]],
    muscles: [[0, 2], [1, 3], [0, 4], [1, 4], [0, 3], [1, 2]],
    top: [4],
  },
  triangle: {
    label: '세모',
    nodes: [[0, 0.05], [0.8, 0.05], [0.4, 0.6]],
    bones: [[0, 1]],
    muscles: [[0, 2], [1, 2]],
    top: [2],
  },
};

// ── 지형: x → 땅 높이 ───────────────────────────────────────
export const TERRAINS = {
  flat: { label: '평지', h: () => 0 },
  hill: { label: '오르막', h: x => Math.max(0, x - 1) * 0.12 },
  bumpy: { label: '울퉁불퉁', h: x => 0.06 * (1 - Math.cos(x * 5)) },
};

// ── 유전자 ──────────────────────────────────────────────────
// { amp[m] 0~0.4, phase[m] 0~2π, freq 0.5~2.5 Hz, grip[n] 0.05~1 (클수록 안 미끄러짐) }
export function randomGenome(body, rnd) {
  return {
    amp: body.muscles.map(() => rnd() * 0.4),
    phase: body.muscles.map(() => rnd() * Math.PI * 2),
    freq: 0.5 + rnd() * 2,
    grip: body.nodes.map(() => 0.05 + rnd() * 0.95),
  };
}
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export function mutate(g, sigma, rnd) {
  return {
    amp: g.amp.map(v => clamp(v + gauss(rnd) * sigma * 0.4, 0, 0.4)),
    phase: g.phase.map(v => v + gauss(rnd) * sigma * Math.PI),
    freq: clamp(g.freq + gauss(rnd) * sigma * 2, 0.5, 2.5),
    grip: g.grip.map(v => clamp(v + gauss(rnd) * sigma, 0.05, 1)),
  };
}

// ── 한 마리 움직이기 ────────────────────────────────────────
export class Creature {
  constructor(body, genome, terrain = TERRAINS.flat) {
    Object.assign(this, { body, genome, terrain });
    this.p = body.nodes.map(([x, y]) => [x, y + terrain.h(x)]);
    this.q = this.p.map(v => v.slice());                        // 이전 위치
    const len = ([a, b]) => Math.hypot(body.nodes[a][0] - body.nodes[b][0], body.nodes[a][1] - body.nodes[b][1]);
    this.boneLen = body.bones.map(len);
    this.musLen = body.muscles.map(len);
    this.t = 0;
    this.x0 = this.cx();
    this.maxH = -Infinity; this.upright = 0; this.frames = 0;
  }
  cx() { return this.p.reduce((s, v) => s + v[0], 0) / this.p.length; }
  cy() { return this.p.reduce((s, v) => s + v[1], 0) / this.p.length; }
  // "머리" 점이 다른 점들 평균보다 위에 있으면 똑바로 선 것
  isUpright() {
    const top = this.body.top, others = this.p.filter((_, i) => !top.includes(i));
    const ty = top.reduce((s, i) => s + this.p[i][1], 0) / top.length;
    return ty > others.reduce((s, v) => s + v[1], 0) / others.length;
  }
  step() {
    const { p, q, body, genome, terrain } = this;
    // Verlet: 속도 = 지금 - 이전 (조금 줄여 공기 저항)
    for (let i = 0; i < p.length; i++) {
      const vx = (p[i][0] - q[i][0]) * 0.995, vy = (p[i][1] - q[i][1]) * 0.995;
      q[i][0] = p[i][0]; q[i][1] = p[i][1];
      p[i][0] += vx; p[i][1] += vy - GRAVITY * DT * DT;
    }
    const w = 2 * Math.PI * genome.freq * this.t;
    for (let it = 0; it < ITER; it++) {
      const fix = (a, b, L, k) => {
        const dx = p[b][0] - p[a][0], dy = p[b][1] - p[a][1], d = Math.hypot(dx, dy) || 1e-6;
        const c = (d - L) / d * 0.5 * k;
        p[a][0] += dx * c; p[a][1] += dy * c; p[b][0] -= dx * c; p[b][1] -= dy * c;
      };
      body.bones.forEach(([a, b], k) => fix(a, b, this.boneLen[k], 1));
      body.muscles.forEach(([a, b], k) => fix(a, b, this.musLen[k] * (1 + genome.amp[k] * Math.sin(w + genome.phase[k])), 0.6));
      // 땅: 파고들면 위로 밀고, 닿아 있으면 미끄럼(grip)만큼 옆 움직임을 줄인다
      for (let i = 0; i < p.length; i++) {
        const g = terrain.h(p[i][0]);
        if (p[i][1] < g) {
          p[i][1] = g;
          const gr = genome.grip[i];
          p[i][0] = q[i][0] + (p[i][0] - q[i][0]) * (1 - gr);
        }
      }
    }
    this.t += DT; this.frames++;
    this.maxH = Math.max(this.maxH, this.cy() - terrain.h(this.cx()));
    if (this.isUpright()) this.upright++;
  }
  get distance() { return this.cx() - this.x0; }
  get uprightRatio() { return this.frames ? this.upright / this.frames : 1; }
}

// ── 상 (무엇을 잘하면 점수를 줄까) ──────────────────────────
export const REWARDS = {
  far: { label: '멀리 가기', score: c => c.distance },
  upright: { label: '뒤집히지 않고 멀리 가기', score: c => c.distance * Math.pow(c.uprightRatio, 3) },
  high: { label: '높이 뛰기', score: c => c.maxH },
};

export function simulate(body, genome, terrain, seconds = SIM_SECONDS) {
  const c = new Creature(body, genome, terrain);
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) c.step();
  return c;
}

// ── 진화 ────────────────────────────────────────────────────
export class Evolution {
  constructor(body, { pop = 24, keep = 6, sigma = 0.15, reward = 'far', terrain = 'flat', seed = 1 } = {}) {
    Object.assign(this, { body, pop, keep, sigma, reward, terrain });
    this.rnd = seeded(seed);
    this.genomes = Array.from({ length: pop }, () => randomGenome(body, this.rnd));
    this.gen = 0; this.history = [];
  }
  // 한 세대: 모두 재고 → 상위 keep 남기고 → 돌연변이로 채우기. 반환 { best, avg, bestGenome, bestStats }
  step() {
    const T = TERRAINS[this.terrain], R = REWARDS[this.reward];
    const scored = this.genomes.map(g => { const c = simulate(this.body, g, T); return { g, s: R.score(c), c }; })
      .sort((a, b) => b.s - a.s);
    const elite = scored.slice(0, this.keep).map(o => o.g);
    const avg = scored.reduce((a, o) => a + o.s, 0) / scored.length;
    const best = scored[0];
    this.genomes = [...elite];
    while (this.genomes.length < this.pop) this.genomes.push(mutate(elite[(this.rnd() * elite.length) | 0], this.sigma, this.rnd));
    this.gen++;
    const rec = { gen: this.gen, best: best.s, avg, bestGenome: best.g, distance: best.c.distance, upright: best.c.uprightRatio, height: best.c.maxH };
    this.history.push(rec);
    return rec;
  }
}
