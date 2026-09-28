// ═══════════════════════════════════════════════════════════
// AI 눈 활동 검사 — node --test tests/*.test.mjs
// ═══════════════════════════════════════════════════════════
// 1. TinyCNN 역전파 = 수치 미분 (합성곱·ReLU·최대 풀링·완전연결 모두)
// 2. 예시 그림 세트(○△☆)를 배우면 새 예시 그림도 맞힌다
// 3. 수업 3차시의 핵심: 기울인 그림에 속던 AI가 "돌리기" 로 배우면 덜 속는다
// 4. 데이터 늘리기 transform 은 아무것도 안 바꾸면 그림도 그대로다

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TinyCNN, IMG } from '../acts/eye/cnn.js';
import { drawShape, makeAugment, transform } from '../acts/eye/imgops.js';
import { runExam, seeded } from '../acts/eye/exam.js';

const KINDS = ['circle', 'triangle', 'star'];
function shapes(n, rnd) {
  const X = [], Y = [];
  KINDS.forEach((k, c) => { for (let i = 0; i < n; i++) { X.push(drawShape(k, rnd)); Y.push(c); } });
  return { X, Y };
}

function inF64(fn) {
  const F32 = globalThis.Float32Array;
  globalThis.Float32Array = Float64Array;
  try { return fn(); } finally { globalThis.Float32Array = F32; }
}

test('TinyCNN 역전파 = 수치 미분', () => inF64(() => {
  const rnd = seeded(3);
  const m = new TinyCNN(3, { filters: 3, seed: 5 });
  for (let i = 0; i < m.p.b.length; i++) m.p.b[i] = 0.05;         // ReLU 가 모두 꺼지지 않게
  const X = [drawShape('star', rnd), drawShape('circle', rnd)], Y = [2, 0];
  m.zeroGrad();
  X.forEach((x, n) => m.accumulate(x, Y[n], 1 / X.length));
  const loss = () => X.reduce((a, x, n) => a - Math.log(m.predict(x)[Y[n]]), 0) / X.length;
  let worst = 0, checked = 0;
  for (const k in m.p) {
    const w = m.p[k];
    for (let r = 0; r < 8; r++) {
      const i = (r * 97 + 13) % w.length, old = w[i], eps = 1e-6;
      w[i] = old + eps; const lp = loss();
      w[i] = old - eps; const lm = loss();
      w[i] = old;
      const num = (lp - lm) / (2 * eps), a = m.g[k][i];
      if (Math.abs(num) < 1e-9 && Math.abs(a) < 1e-9) continue;
      worst = Math.max(worst, Math.abs(num - a) / Math.max(1e-7, Math.abs(num) + Math.abs(a)));
      checked++;
    }
  }
  assert.ok(checked > 20, `검사한 수 ${checked}`);
  assert.ok(worst < 1e-3, `최대 상대오차 ${worst}`);
}));

test('예시 그림 세트를 배우면 처음 보는 예시 그림도 맞힌다', () => {
  const rnd = seeded(11);
  const tr = shapes(20, rnd), te = shapes(20, rnd);
  const m = new TinyCNN(3, { seed: 1 });
  for (let e = 0; e < 20; e++) m.fitEpoch(tr.X, tr.Y);
  const acc = m.accuracy(te.X, te.Y);
  assert.ok(acc >= 0.9, `맞힌 비율 ${acc}`);
});

test('돌리기로 배우면 기울인 그림에 덜 속는다', () => {
  const rnd = seeded(21);
  const tr = shapes(20, rnd);
  let plain = 0, rot = 0;
  for (const seed of [1, 2]) {
    const a = new TinyCNN(3, { seed });
    for (let e = 0; e < 20; e++) a.fitEpoch(tr.X, tr.Y);
    plain += runExam(a, tr.X, tr.Y).tilt / 2;
    const b = new TinyCNN(3, { seed });
    const aug = makeAugment({ rotate: true }, seeded(seed + 100));
    for (let e = 0; e < 40; e++) b.fitEpoch(tr.X, tr.Y, { aug });
    rot += runExam(b, tr.X, tr.Y).tilt / 2;
  }
  assert.ok(rot - plain > 0.2, `기울이기 ${Math.round(plain * 100)}% → ${Math.round(rot * 100)}%`);
});

test('transform 기본값은 그림을 바꾸지 않는다', () => {
  const x = drawShape('triangle', seeded(4));
  const y = transform(x, {});
  let d = 0; for (let i = 0; i < IMG * IMG; i++) d = Math.max(d, Math.abs(x[i] - y[i]));
  assert.ok(d < 1e-6, `차이 ${d}`);
});
