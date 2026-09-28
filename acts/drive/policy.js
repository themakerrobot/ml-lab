// ═══════════════════════════════════════════════════════════
// 운전 활동 — AI 운전사 (작은 신경망 분류기, 의존성 없음)
// ═══════════════════════════════════════════════════════════
// 센서 7개 → Dense(hid, tanh) → Dense(3) → softmax → 왼쪽 / 곧게 / 오른쪽
// 데이터가 수천 개 수준이라 한 번 학습에 1초도 안 걸린다 — 워커 없이 화면 스레드에서
// 한 에폭씩 끊어 돌린다 (fitEpoch).

export class Policy {
  constructor(nIn = 7, { hid = 24, nOut = 3, seed = 1 } = {}) {
    Object.assign(this, { nIn, hid, nOut });
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

  // x: 길이 nIn → { h, P }
  forward(x) {
    const { nIn, hid, nOut, p } = this;
    const h = new Float32Array(hid), P = new Float32Array(nOut);
    for (let j = 0; j < hid; j++) {
      let s = p.b1[j];
      for (let i = 0; i < nIn; i++) s += x[i] * p.W1[i * hid + j];
      h[j] = Math.tanh(s);
    }
    let mx = -Infinity;
    for (let k = 0; k < nOut; k++) {
      let s = p.b2[k];
      for (let j = 0; j < hid; j++) s += h[j] * p.W2[j * nOut + k];
      P[k] = s; if (s > mx) mx = s;
    }
    let sum = 0;
    for (let k = 0; k < nOut; k++) { P[k] = Math.exp(P[k] - mx); sum += P[k]; }
    for (let k = 0; k < nOut; k++) P[k] /= sum;
    return { h, P };
  }

  predict(x) { return this.forward(x).P; }

  // 배치 기울기를 this.g 에 쌓고 평균 loss 를 돌려준다
  grad(X, Y, idx) {
    const { nIn, hid, nOut, p, g } = this;
    for (const k in g) g[k].fill(0);
    const B = idx.length, dh = new Float32Array(hid);
    let loss = 0;
    for (const n of idx) {
      const x = X[n], y = Y[n], { h, P } = this.forward(x);
      loss -= Math.log(P[y] + 1e-9);
      for (let k = 0; k < nOut; k++) {
        const d = (P[k] - (k === y ? 1 : 0)) / B;
        g.b2[k] += d;
        for (let j = 0; j < hid; j++) g.W2[j * nOut + k] += h[j] * d;
      }
      for (let j = 0; j < hid; j++) {
        let s = 0;
        for (let k = 0; k < nOut; k++) s += p.W2[j * nOut + k] * ((P[k] - (k === y ? 1 : 0)) / B);
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

  // 한 에폭: 섞어서 batch 씩. 반환 { loss, acc } (acc 는 이번 에폭 전체에 대한 맞힌 비율)
  fitEpoch(X, Y, { batch = 32, lr = 0.01 } = {}) {
    const N = X.length, order = Array.from({ length: N }, (_, i) => i);
    for (let i = N - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [order[i], order[j]] = [order[j], order[i]]; }
    let tot = 0, nb = 0;
    for (let s = 0; s < N; s += batch) {
      tot += this.grad(X, Y, order.slice(s, s + batch)); nb++;
      this.adam(lr);
    }
    let ok = 0;
    for (let n = 0; n < N; n++) {
      const P = this.predict(X[n]);
      if (P.indexOf(Math.max(...P)) === Y[n]) ok++;
    }
    return { loss: tot / nb, acc: ok / N };
  }
}
