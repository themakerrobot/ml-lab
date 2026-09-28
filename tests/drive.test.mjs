// ═══════════════════════════════════════════════════════════
// 운전 활동 검사 — node --test tests/*.test.mjs
// ═══════════════════════════════════════════════════════════
// 1. AI 운전사(Policy) 역전파 = 수치 미분
// 2. 사람처럼 늦게 반응하는 학생의 운전을 "0.1초 전 센서"와 짝지어 배우면
//    가르칠 때 안 쓴 트랙까지 완주한다 (화면의 기록 방식과 같다)
// 3. 곧게만 가르치면 곧 부딪힌다 — 수업에서 보여 주는 바로 그 현상

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS, buildTrack } from '../acts/drive/track.js';
import { Car, teacher } from '../acts/drive/sim.js';
import { Policy } from '../acts/drive/policy.js';

const tracks = TRACKS.map(buildTrack);
const REACT_STEPS = 6, RECORD_EVERY = 3;   // acts/drive/page.js 와 같은 값

function inF64(fn) {
  const F32 = globalThis.Float32Array;
  globalThis.Float32Array = Float64Array;
  try { return fn(); } finally { globalThis.Float32Array = F32; }
}

// 난수를 고정해 결과가 매번 같게 한다
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// 사람 흉내: 반응이 lagMin~lagMax 걸음 늦고, 한번 누른 키는 hold 걸음 동안 유지한다
function studentDrive(track, rnd, { lagMin = 8, lagMax = 16, hold = 6, steps = 60 * 40 } = {}) {
  const car = new Car(track), hist = [], rec = [];
  let act = 1, held = 0;
  for (let i = 0; i < steps; i++) {
    const s = car.sense(); hist.push(s);
    if (held <= 0) {
      const lag = lagMin + Math.floor(rnd() * (lagMax - lagMin + 1));
      const next = teacher(hist[Math.max(0, hist.length - 1 - lag)]);
      if (next !== act) { act = next; held = hold; }
    } else held--;
    if (i % RECORD_EVERY === 0) rec.push([hist[Math.max(0, hist.length - 1 - REACT_STEPS)], act]);
    if (car.step(act) || car.progress >= 2) break;
  }
  return { car, rec };
}

function aiDrive(track, pol, laps = 2) {
  const car = new Car(track);
  for (let i = 0; i < 60 * 90; i++) {
    const P = pol.predict(car.sense());
    if (car.step(P.indexOf(Math.max(...P))) || car.progress >= laps) break;
  }
  return car;
}

function fit(rec, seed = 1, epochs = 60) {
  const pol = new Policy(7, { seed });
  const X = rec.map(r => r[0]), Y = rec.map(r => r[1]);
  let r; for (let e = 0; e < epochs; e++) r = pol.fitEpoch(X, Y);
  return { pol, ...r };
}

test('Policy 역전파 = 수치 미분', () => inF64(() => {
  const pol = new Policy(4, { hid: 5, nOut: 3, seed: 7 });
  const X = [[0.1, 0.9, 0.3, 0.5], [0.7, 0.2, 0.8, 0.1], [0.4, 0.4, 0.6, 0.9]], Y = [2, 0, 1], idx = [0, 1, 2];
  pol.grad(X, Y, idx);
  const loss = () => idx.reduce((a, n) => a - Math.log(pol.predict(X[n])[Y[n]]), 0) / idx.length;
  let worst = 0;
  for (const k in pol.p) {
    const w = pol.p[k];
    for (let i = 0; i < w.length; i += Math.max(1, (w.length / 6) | 0)) {
      const old = w[i], eps = 1e-5;
      w[i] = old + eps; const lp = loss();
      w[i] = old - eps; const lm = loss();
      w[i] = old;
      const num = (lp - lm) / (2 * eps), a = pol.g[k][i];
      worst = Math.max(worst, Math.abs(num - a) / Math.max(1e-6, Math.abs(num) + Math.abs(a)));
    }
  }
  assert.ok(worst < 1e-4, `최대 상대오차 ${worst}`);
}));

test('선생님 운전은 세 트랙을 모두 돈다', () => {
  for (const t of tracks) {
    const car = new Car(t);
    for (let i = 0; i < 60 * 60 && !car.crashed && car.progress < 2; i++) car.step(teacher(car.sense()));
    assert.ok(!car.crashed && car.progress >= 2, `${t.def.id}: ${car.progress.toFixed(2)}바퀴`);
  }
});

test('늦게 반응하는 학생의 운전으로 배운 AI가 처음 보는 트랙까지 완주한다', () => {
  const rnd = seeded(42), rec = [];
  for (const t of tracks.filter(t => !t.def.unseen)) {
    const { car, rec: r } = studentDrive(t, rnd);
    assert.ok(!car.crashed, `학생이 ${t.def.id} 에서 부딪힘`);
    rec.push(...r);
  }
  const { pol, acc } = fit(rec);
  assert.ok(acc > 0.8, `맞힌 비율 ${acc}`);
  for (const t of tracks) {
    const car = aiDrive(t, pol);
    assert.ok(!car.crashed, `AI가 ${t.def.id} 에서 ${car.progress.toFixed(2)}바퀴 만에 부딪힘`);
  }
});

test('곧게만 가르치면 첫 커브 전에 부딪힌다', () => {
  const rnd = seeded(7), rec = [];
  for (const t of tracks.filter(t => !t.def.unseen)) rec.push(...studentDrive(t, rnd).rec);
  const straight = rec.filter(r => r[1] === 1);
  // 한 종류만 있으면 분류기가 늘 "곧게" 를 고른다
  const { pol } = fit(straight, 3, 20);
  for (const t of tracks) {
    const car = aiDrive(t, pol);
    assert.ok(car.crashed && car.progress < 0.5, `${t.def.id}: ${car.progress.toFixed(2)}바퀴`);
  }
});
