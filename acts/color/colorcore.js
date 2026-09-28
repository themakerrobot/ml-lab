// ═══════════════════════════════════════════════════════════
// 색 활동 — 색 분류기 (DOM 없음)
// ═══════════════════════════════════════════════════════════
// 픽셀 하나 = RGB 숫자 3개. 이 3개로 "무슨 종류의 색인가" 를 고른다.
//  · KNN  : 가르친 점 중 가장 가까운 k개의 다수결 (배우는 과정 없음, k 로 경계가 매끈해진다)
//  · ColorMLP : 3 → 은닉 12(tanh) → 종류 수 (손으로 짠 역전파)
// 매 프레임 모든 픽셀을 모델에 넣으면 느리다. 그래서 RGB 를 32단계씩(32³ = 32,768칸)
// 나눈 "답표(LUT)" 를 한 번 만들어 두고, 프레임마다 표만 찾는다 — 저사양 PC 배려.

export const Q = 32;                       // 한 색 축을 32단계로
export const LUT_SIZE = Q * Q * Q;

export const qIndex = (r, g, b) => ((r >> 3) * Q + (g >> 3)) * Q + (b >> 3);   // 0~255 입력
export function cellCenter(i) {
  const b = i % Q, g = ((i / Q) | 0) % Q, r = (i / (Q * Q)) | 0;
  return [(r + 0.5) / Q, (g + 0.5) / Q, (b + 0.5) / Q];
}

// ── 가까운 이웃 ─────────────────────────────────────────────
export class KNN {
  constructor(k = 5) { this.k = k; this.X = []; this.Y = []; this.nClass = 0; }
  fit(X, Y, nClass) { this.X = X; this.Y = Y; this.nClass = nClass; return this; }
  // 점수 = 가까운 k개 중 그 종류의 비율
  predict(x) {
    const { X, Y, k, nClass } = this, n = X.length, kk = Math.min(k, n);
    const bd = new Float64Array(kk).fill(Infinity), bc = new Int32Array(kk).fill(-1);
    for (let i = 0; i < n; i++) {
      const p = X[i], d = (p[0] - x[0]) ** 2 + (p[1] - x[1]) ** 2 + (p[2] - x[2]) ** 2;
      if (d >= bd[kk - 1]) continue;
      let j = kk - 1;
      while (j > 0 && bd[j - 1] > d) { bd[j] = bd[j - 1]; bc[j] = bc[j - 1]; j--; }
      bd[j] = d; bc[j] = Y[i];
    }
    const out = new Float32Array(nClass);
    for (let j = 0; j < kk; j++) if (bc[j] >= 0) out[bc[j]] += 1 / kk;
    return out;
  }
}

// ── 작은 신경망 ─────────────────────────────────────────────
export class ColorMLP {
  constructor(nClass, { hid = 12, seed = 1 } = {}) {
    Object.assign(this, { nClass, hid });
    let s = seed >>> 0;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 - 0.5; };
    const U = (n, sc) => Float32Array.from({ length: n }, () => rnd() * 2 * sc);
    this.p = { W1: U(3 * hid, 1), b1: U(hid, 0.5), W2: U(hid * nClass, 1 / Math.sqrt(hid)), b2: new Float32Array(nClass) };
    this.g = {}; this.m = {}; this.v = {}; this.t = 0;
    for (const k in this.p) {
      const n = this.p[k].length;
      this.g[k] = new Float32Array(n); this.m[k] = new Float32Array(n); this.v[k] = new Float32Array(n);
    }
  }
  forward(x) {
    const { hid, nClass, p } = this, h = new Float32Array(hid), o = new Float32Array(nClass);
    // 입력을 -1~1 로 옮겨서 넣는다
    const a = x[0] * 2 - 1, b = x[1] * 2 - 1, c = x[2] * 2 - 1;
    for (let j = 0; j < hid; j++) h[j] = Math.tanh(p.b1[j] + a * p.W1[j] + b * p.W1[hid + j] + c * p.W1[2 * hid + j]);
    let mx = -Infinity;
    for (let k = 0; k < nClass; k++) {
      let s = p.b2[k];
      for (let j = 0; j < hid; j++) s += h[j] * p.W2[j * nClass + k];
      o[k] = s; if (s > mx) mx = s;
    }
    let sum = 0;
    for (let k = 0; k < nClass; k++) { o[k] = Math.exp(o[k] - mx); sum += o[k]; }
    for (let k = 0; k < nClass; k++) o[k] /= sum;
    return { h, o, in: [a, b, c] };
  }
  predict(x) { return this.forward(x).o; }
  // 배치 기울기를 this.g 에 채우고 평균 loss 를 돌려준다
  grad(X, Y, idx) {
    const { hid, nClass, p, g } = this;
    for (const k in g) g[k].fill(0);
    let loss = 0;
    const B = idx.length, dh = new Float32Array(hid);
    for (const n of idx) {
      const { h, o, in: xin } = this.forward(X[n]), y = Y[n];
      loss -= Math.log(o[y] + 1e-9);
      for (let j = 0; j < hid; j++) dh[j] = 0;
      for (let k = 0; k < nClass; k++) {
        const d = (o[k] - (k === y ? 1 : 0)) / B;
        g.b2[k] += d;
        for (let j = 0; j < hid; j++) { g.W2[j * nClass + k] += h[j] * d; dh[j] += p.W2[j * nClass + k] * d; }
      }
      for (let j = 0; j < hid; j++) {
        const dz = dh[j] * (1 - h[j] * h[j]);
        g.b1[j] += dz;
        for (let i = 0; i < 3; i++) g.W1[i * hid + j] += xin[i] * dz;
      }
    }
    return loss / B;
  }
  step(X, Y, idx, lr = 0.02) {
    const loss = this.grad(X, Y, idx), { p, g } = this;
    this.t++;
    const c1 = 1 - Math.pow(0.9, this.t), c2 = 1 - Math.pow(0.999, this.t);
    for (const k in p) {
      const w = p[k], gg = g[k], m = this.m[k], v = this.v[k];
      for (let i = 0; i < w.length; i++) {
        m[i] = 0.9 * m[i] + 0.1 * gg[i]; v[i] = 0.999 * v[i] + 0.001 * gg[i] * gg[i];
        w[i] -= lr * (m[i] / c1) / (Math.sqrt(v[i] / c2) + 1e-8);
      }
    }
    return loss;
  }
  fit(X, Y, { epochs = 60, batch = 32 } = {}) {
    const N = X.length, order = Array.from({ length: N }, (_, i) => i);
    let loss = 0;
    for (let e = 0; e < epochs; e++) {
      for (let i = N - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [order[i], order[j]] = [order[j], order[i]]; }
      loss = 0; let nb = 0;
      for (let s = 0; s < N; s += batch) { loss += this.step(X, Y, order.slice(s, s + batch)); nb++; }
      loss /= nb;
    }
    return loss;
  }
}

// 답표: 칸마다 1등 종류 번호 (Uint8Array) + 1등 점수 (확신, 0~255)
export function buildLUT(model) {
  const cls = new Uint8Array(LUT_SIZE), conf = new Uint8Array(LUT_SIZE);
  for (let i = 0; i < LUT_SIZE; i++) {
    const o = model.predict(cellCenter(i));
    let b = 0; for (let k = 1; k < o.length; k++) if (o[k] > o[b]) b = k;
    cls[i] = b; conf[i] = Math.round(o[b] * 255);
  }
  return { cls, conf };
}

// 가르친 점이 너무 많으면 KNN 답표 만들기가 느려진다 — 종류마다 고르게 줄인다
export function thin(X, Y, max, rnd = Math.random) {
  if (X.length <= max) return { X, Y };
  const idx = Array.from({ length: X.length }, (_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [idx[i], idx[j]] = [idx[j], idx[i]]; }
  const keep = idx.slice(0, max);
  return { X: keep.map(i => X[i]), Y: keep.map(i => Y[i]) };
}

// ── 색 바꾸기 도우미 ───────────────────────────────────────
export function rgb2hsv(r, g, b) {                 // 0~1 → h 0~1, s, v
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6; if (h < 0) h += 1;
  }
  return [h, mx ? d / mx : 0, mx];
}
export function hsv2rgb(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6];
}
