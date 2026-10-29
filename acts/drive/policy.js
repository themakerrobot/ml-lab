// ═══════════════════════════════════════════════════════════
// 운전 활동 — AI 운전사 (작은 신경망 분류기, 의존성 없음)
// ═══════════════════════════════════════════════════════════
// 초급: 센서 7개 → Dense(24, tanh) → Dense(3) → softmax → 왼쪽 / 곧게 / 오른쪽
// 고급: 센서 7개 + 빠르기 → Dense(24, tanh) → 출력 두 갈래(heads [3, 3]) — 방향 3 · 빠르기 3 을 따로 softmax.
//       한 갈래 9개(방향 × 빠르기)로 하면 "감속하며 왼쪽" 같은 드문 짝을 따로 배워야 해서
//       edge-lab 에서 대회 트랙을 거의 못 돌았다.
// 답(Y)은 숫자 하나: 갈래가 둘이면 빠르기 × 3 + 방향.
// 데이터가 수천 개 수준이라 한 번 학습에 1초도 안 걸린다 — 워커 없이 화면 스레드에서
// 한 에폭씩 끊어 돌린다 (fitEpoch).

const argmax = P => { let b = 0; for (let i = 1; i < P.length; i++) if (P[i] > P[b]) b = i; return b; };

export class Policy {
  constructor(nIn = 7, { hid = 24, nOut = 3, heads = null, seed = 1 } = {}) {
    heads = heads ? heads.slice() : [nOut];
    nOut = heads.reduce((a, b) => a + b, 0);
    Object.assign(this, { nIn, hid, nOut, heads });
    let s = seed >>> 0;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 - 0.5; };
    const U = (n, sc) => Float32Array.from({ length: n }, () => rnd() * 2 * sc);
    this.p = {
      W1: U(nIn * hid, 1 / Math.sqrt(nIn)), b1: new Float32Array(hid),
      W2: U(hid * nOut, 1 / Math.sqrt(hid)), b2: new Float32Array(nOut),
    };
    this.g = {}; this.m = {}; this.v = {}; this.t = 0;
    for (const k in this.p) {
      const n = this.p[k].length;
      this.g[k] = new Float32Array(n); this.m[k] = new Float32Array(n); this.v[k] = new Float32Array(n);
    }
  }

  get numParams() { return Object.values(this.p).reduce((a, x) => a + x.length, 0); }

  // 답 하나(y) → 갈래마다 정답 칸 번호 (출력 전체에서의 자리)
  targets(y) {
    if (this.heads.length === 1) return [y];
    return [y % 3, this.heads[0] + ((y / 3) | 0)];
  }

  // x: 길이 nIn → { h, P } (P 는 갈래마다 따로 softmax)
  forward(x) {
    const { nIn, hid, nOut, p, heads } = this;
    const h = new Float32Array(hid), P = new Float32Array(nOut);
    for (let j = 0; j < hid; j++) {
      let s = p.b1[j];
      for (let i = 0; i < nIn; i++) s += x[i] * p.W1[i * hid + j];
      h[j] = Math.tanh(s);
    }
    for (let k = 0; k < nOut; k++) {
      let s = p.b2[k];
      for (let j = 0; j < hid; j++) s += h[j] * p.W2[j * nOut + k];
      P[k] = s;
    }
    for (let q = 0, o = 0; q < heads.length; o += heads[q], q++) {
      const e = o + heads[q];
      let mx = -Infinity, sum = 0;
      for (let k = o; k < e; k++) if (P[k] > mx) mx = P[k];
      for (let k = o; k < e; k++) { P[k] = Math.exp(P[k] - mx); sum += P[k]; }
      for (let k = o; k < e; k++) P[k] /= sum;
    }
    return { h, P };
  }

  predict(x) { return this.forward(x).P; }

  // 고를 행동 하나 — 초급 0~2, 고급 빠르기 × 3 + 방향 (0~8)
  act(x) {
    const P = this.predict(x);
    if (this.heads.length === 1) return argmax(P);
    return argmax(P.subarray(3, 6)) * 3 + argmax(P.subarray(0, 3));
  }

  // 배치 기울기를 this.g 에 쌓고 평균 loss 를 돌려준다.
  // w: 출력 칸마다 무게 (드문 행동을 크게) — 없으면 모두 1. loss = Σ갈래 −w[c]·log P[c]
  grad(X, Y, idx, w = null) {
    const { nIn, hid, nOut, p, g, heads } = this;
    for (const k in g) g[k].fill(0);
    const B = idx.length, dh = new Float32Array(hid), dz = new Float32Array(nOut);
    let loss = 0;
    for (const n of idx) {
      const x = X[n], { h, P } = this.forward(x), T = this.targets(Y[n]);
      for (let q = 0, o = 0; q < heads.length; o += heads[q], q++) {
        const c = T[q], wt = w ? w[c] : 1;
        loss -= wt * Math.log(P[c] + 1e-9);
        for (let k = o; k < o + heads[q]; k++) dz[k] = wt * (P[k] - (k === c ? 1 : 0)) / B;
      }
      for (let k = 0; k < nOut; k++) {
        g.b2[k] += dz[k];
        for (let j = 0; j < hid; j++) g.W2[j * nOut + k] += h[j] * dz[k];
      }
      for (let j = 0; j < hid; j++) {
        let s = 0;
        for (let k = 0; k < nOut; k++) s += p.W2[j * nOut + k] * dz[k];
        dh[j] = s * (1 - h[j] * h[j]);
      }
      for (let j = 0; j < hid; j++) {
        g.b1[j] += dh[j];
        for (let i = 0; i < nIn; i++) g.W1[i * hid + j] += x[i] * dh[j];
      }
    }
    return loss / B;
  }

  adam(lr = 0.01, b1 = 0.9, b2 = 0.999, eps = 1e-8) {
    this.t++;
    const c1 = 1 - Math.pow(b1, this.t), c2 = 1 - Math.pow(b2, this.t);
    for (const k in this.p) {
      const w = this.p[k], g = this.g[k], m = this.m[k], v = this.v[k];
      for (let i = 0; i < w.length; i++) {
        m[i] = b1 * m[i] + (1 - b1) * g[i];
        v[i] = b2 * v[i] + (1 - b2) * g[i] * g[i];
        w[i] -= lr * (m[i] / c1) / (Math.sqrt(v[i] / c2) + eps);
      }
    }
  }

  // 출력 칸마다 무게: 그 갈래에서 드물수록 크게 (전체 / (갈래 칸 수 × 그 칸 개수)), 최대 5배. 개수 0 이면 1.
  // 고급의 "감속" 은 전체의 5% 남짓이라 무게 없이 배우면 AI 가 거의 줄이지 않고 커브로 들어간다.
  balance(Y) {
    const cnt = new Float32Array(this.nOut), w = new Float32Array(this.nOut);
    for (const y of Y) for (const c of this.targets(y)) cnt[c]++;
    for (let q = 0, o = 0; q < this.heads.length; o += this.heads[q], q++) {
      for (let k = o; k < o + this.heads[q]; k++)
        w[k] = cnt[k] ? Math.min(5, Y.length / (this.heads[q] * cnt[k])) : 1;
    }
    return w;
  }

  // 한 에폭: 섞어서 batch 씩. 반환 { loss, acc } (acc = 이번 에폭 전체에서 맞힌 비율 —
  // 고급은 방향 · 빠르기 둘 다 맞아야 맞힌 것). balance: 드문 행동에 무게 (고급에서 쓴다)
  // rnd: 섞기용 난수 — 화면은 Math.random, tests/ 는 결과를 고정하려고 씨앗 난수를 넘긴다
  fitEpoch(X, Y, { batch = 32, lr = 0.01, balance = false, rnd = Math.random } = {}) {
    const N = X.length, order = Array.from({ length: N }, (_, i) => i);
    const w = balance ? this.balance(Y) : null;
    for (let i = N - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [order[i], order[j]] = [order[j], order[i]]; }
    let tot = 0, nb = 0;
    for (let s = 0; s < N; s += batch) {
      tot += this.grad(X, Y, order.slice(s, s + batch), w); nb++;
      this.adam(lr);
    }
    let ok = 0;
    for (let n = 0; n < N; n++) if (this.act(X[n]) === Y[n]) ok++;
    return { loss: tot / nb, acc: ok / N };
  }
}

// ── AI 파일 ─────────────────────────────────────────────────
// 배운 AI 를 JSON 으로. 계산에 난수가 없어 다른 PC 에서 불러와도 같은 운전을 한다.
// edge-lab 자동차 가르치기와 형식까지 같게 저장한다 (kind 'edge-lab-drive') — edge-lab 이 고치지 않고 바로 읽는다.
// 트랙 · 물리가 같아 같은 AI 면 두 서비스에서 같은 대회 기록이 나온다. 읽을 때는 예전 ml-lab 파일('ml-lab-drive')도 받는다.
export const AI_KINDS = ['edge-lab-drive', 'ml-lab-drive'];

export function savePolicy(pol, info = {}) {
  const o = { kind: 'edge-lab-drive', v: 1, nIn: pol.nIn, hid: pol.hid, heads: pol.heads.slice(), p: {} };
  for (const k in pol.p) o.p[k] = Array.from(pol.p[k], v => +v.toPrecision(7));
  return Object.assign(o, info);
}

// 망가진 파일이면 Error (message 는 화면에 그대로 보여 줄 한국어 문장 — 화면에서 T() 로 옮긴다)
export function loadPolicy(o) {
  if (!o || !AI_KINDS.includes(o.kind) || !o.p) throw new Error('운전 AI 파일이 아니에요');
  const heads = Array.isArray(o.heads) ? o.heads : [o.nOut || 3];
  if (!(o.nIn === 7 && heads.length === 1 && heads[0] === 3) && !(o.nIn === 8 && heads.length === 2 && heads[0] === 3 && heads[1] === 3))
    throw new Error('운전 AI 파일이 아니에요');
  const pol = new Policy(o.nIn, { hid: o.hid | 0 || 24, heads });
  for (const k in pol.p) {
    const src = o.p[k];
    if (!Array.isArray(src) || src.length !== pol.p[k].length || !src.every(Number.isFinite))
      throw Object.assign(new Error('AI 파일이 망가졌어요'), { part: k });
    pol.p[k].set(src);
  }
  return pol;
}
