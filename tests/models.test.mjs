// ═══════════════════════════════════════════════════════════
// 문장 활동 모델 검사 — node --test tests/*.test.mjs
// ═══════════════════════════════════════════════════════════
// 1. 기울기 검사: 손으로 짠 역전파가 수치 미분과 같은가 (float64 로 바꿔서 잰다)
// 2. 학습 검사: 예시 글로 조금 배우면 loss 가 확실히 내려가는가
//
// float32 로는 수치 미분 오차가 커서 판정이 흔들린다. 모델은 Float32Array 를
// 실행할 때 찾으므로, 기울기 검사 동안만 Float64Array 로 바꿔 둔다.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const gpt = await import('../acts/word/minigpt.js');
const mlp = await import('../acts/word/charmlp.js');

function inF64(fn) {
  const F32 = globalThis.Float32Array;
  globalThis.Float32Array = Float64Array;
  try { return fn(); } finally { globalThis.Float32Array = F32; }
}

const TEXT = [
  '토끼는 산에서 뛰어요. 토끼는 풀을 먹어요.',
  '강아지는 마당에서 뛰어요. 강아지는 뼈를 먹어요.',
  '고양이는 지붕에서 자요. 고양이는 생선을 먹어요.',
].join('\n');

function relErr(a, b) { return Math.abs(a - b) / Math.max(1e-6, Math.abs(a) + Math.abs(b)); }

test('MiniGPT 역전파 = 수치 미분', () => inF64(() => {
  const m = new gpt.MiniGPT(7, { ctx: 6, d: 8, heads: 2, layers: 2, seed: 3 });
  // LayerNorm 게인·바이어스가 1·0 그대로면 검사가 약해지므로 흔들어 둔다
  for (const k in m.p) if (/ln|bo|b1|b2|bout/.test(k))
    for (let i = 0; i < m.p[k].length; i++) m.p[k][i] += Math.sin(i * 7 + k.length) * 0.3;
  const xs = [[1, 2, 3, 4, 5, 6], [0, 3, 3, 1, 2]], ys = [[2, 3, 4, 5, 6, 0], [3, 3, 1, 2, 4]];
  m.lossAndGrad(xs, ys);
  const loss = () => {
    let s = 0, n = 0;
    for (let b = 0; b < xs.length; b++) {
      const c = m.forward(xs[b]);
      for (let t = 0; t < c.T; t++) { s -= Math.log(c.P[t * m.V + ys[b][t]]); n++; }
    }
    return s / n;
  };
  let worst = 0;
  for (const k in m.p) {
    const w = m.p[k];
    for (let r = 0; r < Math.min(6, w.length); r++) {
      const i = (r * 37 + 11) % w.length, old = w[i], eps = 1e-5;
      w[i] = old + eps; const lp = loss();
      w[i] = old - eps; const lm = loss();
      w[i] = old;
      worst = Math.max(worst, relErr((lp - lm) / (2 * eps), m.g[k][i]));
    }
  }
  assert.ok(worst < 1e-4, `최대 상대오차 ${worst}`);
}));

test('CharMLP 역전파 = 수치 미분', () => inF64(() => {
  const V = 9, ctx = 3, B = 4;
  const m = new mlp.CharMLP(V, { ctx, emb: 5, hid: 7, seed: 5 });
  const x = Int32Array.from({ length: B * ctx }, (_, i) => (i * 5 + 1) % V);
  const y = Int32Array.from({ length: B }, (_, i) => (i * 3 + 2) % V);
  const loss = () => {
    const { P } = m.forward(x, B);
    let s = 0; for (let b = 0; b < B; b++) s -= Math.log(P[b * V + y[b]]);
    return s / B;
  };
  // step() 은 곧바로 Adam 까지 하므로, 기울기만 보려고 adam 을 잠시 막는다
  const adam = m.adam; m.adam = () => {};
  m.step(x, y, B);
  m.adam = adam;
  let worst = 0;
  for (const k in m.p) {
    const w = m.p[k];
    for (let r = 0; r < Math.min(6, w.length); r++) {
      const i = (r * 29 + 3) % w.length, old = w[i], eps = 1e-5;
      w[i] = old + eps; const lp = loss();
      w[i] = old - eps; const lm = loss();
      w[i] = old;
      // E 는 쓰인 글자 줄만 기울기가 있다. 0 끼리 비교는 건너뛴다
      const num = (lp - lm) / (2 * eps);
      if (Math.abs(num) < 1e-9 && Math.abs(m.g[k][i]) < 1e-9) continue;
      worst = Math.max(worst, relErr(num, m.g[k][i]));
    }
  }
  assert.ok(worst < 1e-4, `최대 상대오차 ${worst}`);
}));

test('MiniGPT 는 예시 글을 배운다', () => {
  const data = gpt.prepare(TEXT);
  const m = new gpt.MiniGPT(data.itos.length, { ctx: 16, d: 16, heads: 2, layers: 1, seed: 1 });
  const first = [];
  const end = gpt.train(m, data, { steps: 150, batch: 4, every: 10, onProgress: (s, l) => first.push(l) });
  assert.ok(end < first[0] * 0.5, `loss ${first[0].toFixed(2)} → ${end.toFixed(2)}`);
  const out = gpt.generate(m, data, '강아지는', { temp: 0.3, maxLen: 10 });
  assert.ok(out.startsWith('강아지는') && out.length > 4);
});

test('CharMLP 는 예시 글을 배운다', () => {
  const data = mlp.prepare(TEXT, { ctx: 6 });
  const m = new mlp.CharMLP(data.itos.length, { ctx: 6 });
  const ls = [];
  mlp.train(m, data, { epochs: 20, batch: 32, onEpoch: (e, l) => ls.push(l) });
  assert.ok(ls.at(-1) < ls[0] * 0.5, `loss ${ls[0].toFixed(2)} → ${ls.at(-1).toFixed(2)}`);
});

test('attention() 은 층·헤드마다 아래삼각 확률표를 준다', () => {
  const data = gpt.prepare(TEXT);
  const m = new gpt.MiniGPT(data.itos.length, { ctx: 16, d: 16, heads: 2, layers: 2 });
  const { chars, A } = gpt.attention(m, data, '토끼는');
  assert.equal(chars.length, 4);                     // 줄 시작 + 3글자
  assert.equal(A.length, 2); assert.equal(A[0].length, 2);
  for (const row of A[1][1]) {
    const s = row.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(s - 1) < 1e-5);
  }
  assert.equal(A[0][0][0][1], 0);                    // 미래 글자는 보지 않는다
});
