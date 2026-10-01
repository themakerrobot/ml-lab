// ═══════════════════════════════════════════════════════════
// 운전 활동 검사 — node --test tests/*.test.mjs
// ═══════════════════════════════════════════════════════════
// 1. AI 운전사(Policy) 역전파 = 수치 미분
// 2. 사람처럼 늦게 반응하는 학생의 운전을 "0.1초 전 센서"와 짝지어 배우면
//    가르칠 때 안 쓴 트랙까지 완주한다 (화면의 기록 방식과 같다)
// 3. 곧게만 가르치면 곧 부딪힌다 — 수업에서 보여 주는 바로 그 현상
// 4. 바퀴 수보다 좌우 균형, 그리고 급한 커브도 보여 줘야 한다 (화면의 "언제 배우기를 누르나" 안내)
// 트랙은 10개 × 두 방향 = 20코스. 트랙을 더하면 아래 검사가 모든 코스에서 다시 돈다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS, buildTrack } from '../acts/drive/track.js';
import { Car, teacher } from '../acts/drive/sim.js';
import { Policy } from '../acts/drive/policy.js';

const tracks = TRACKS.map(d => buildTrack(d));
const courses = TRACKS.flatMap(d => [buildTrack(d), buildTrack(d, true)]);
const byId = (id, rev = false) => buildTrack(TRACKS.find(d => d.id === id), rev);
const name = t => t.def.id + (t.reverse ? '(거꾸로)' : '');
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
  for (let i = 0; i < 60 * 120; i++) {
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

test('트랙 모양: 화면 안에 있고, 떨어진 길끼리 붙지 않는다', () => {
  for (const t of tracks) {
    const { pts, n, hw } = t;
    for (const [x, y] of pts) assert.ok(x - hw >= 0 && x + hw <= 800 && y - hw >= 0 && y + hw <= 520, `${t.def.id} 가 화면 밖 (${x | 0},${y | 0})`);
    // 길을 따라 250 이상 떨어진 두 곳은 폭 + 18 보다 멀어야 한다 (사이에 잔디가 보이게)
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const len = cum[n - 1];
    let dmin = Infinity;
    for (let i = 0; i < n; i += 2) for (let j = i + 1; j < n; j += 2) {
      const arc = cum[j] - cum[i];
      if (Math.min(arc, len - arc) < 250) continue;
      dmin = Math.min(dmin, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]));
    }
    assert.ok(dmin > t.def.width + 18, `${t.def.id}: 가장 가까운 두 길 ${dmin.toFixed(0)}`);
  }
});

test('선생님 운전은 20코스(10트랙 × 두 방향)를 모두 돈다', () => {
  for (const t of courses) {
    const car = new Car(t);
    for (let i = 0; i < 60 * 90 && !car.crashed && car.progress < 2; i++) car.step(teacher(car.sense()));
    assert.ok(!car.crashed && car.progress >= 2, `${name(t)}: ${car.progress.toFixed(2)}바퀴`);
  }
});

test('거꾸로 = 같은 길, 반대 방향', () => {
  const f = byId('oval'), r = byId('oval', true);
  assert.equal(f.mask, r.mask);
  assert.deepEqual(f.pts[0], r.pts[0]);
  // 둥근 트랙: 기본 방향은 오른쪽, 거꾸로는 왼쪽으로만 돈다
  const turns = t => { const car = new Car(t), c = [0, 0, 0]; for (let i = 0; i < 600; i++) { const a = teacher(car.sense()); c[a]++; car.step(a); } return c; };
  const a = turns(f), b = turns(r);
  assert.ok(a[2] > a[0] && b[0] > b[2], `기본 ${a} / 거꾸로 ${b}`);
});

test('늦게 반응하는 학생의 운전으로 배운 AI가 처음 보는 트랙까지 완주한다', () => {
  const rnd = seeded(42), rec = [];
  // 둥근 트랙 + 구불구불 트랙에서만 가르친다
  for (const id of ['oval', 'wavy']) {
    const { car, rec: r } = studentDrive(byId(id), rnd);
    assert.ok(!car.crashed, `학생이 ${id} 에서 부딪힘`);
    rec.push(...r);
  }
  const { pol, acc } = fit(rec);
  assert.ok(acc > 0.8, `맞힌 비율 ${acc}`);
  for (const t of courses) {
    const car = aiDrive(t, pol);
    assert.ok(!car.crashed, `AI가 ${name(t)} 에서 ${car.progress.toFixed(2)}바퀴 만에 부딪힘`);
  }
});

test('곧게만 가르치면 첫 커브 전에 부딪힌다', () => {
  const rnd = seeded(7), rec = [];
  for (const id of ['oval', 'wavy']) rec.push(...studentDrive(byId(id), rnd).rec);
  const straight = rec.filter(r => r[1] === 1);
  // 한 종류만 있으면 분류기가 늘 "곧게" 를 고른다
  const { pol } = fit(straight, 3, 20);
  for (const t of courses) {
    const car = aiDrive(t, pol);
    assert.ok(car.crashed && car.progress < 0.5, `${name(t)}: ${car.progress.toFixed(2)}바퀴`);
  }
});

// 필요할 때만 키를 누르는 학생 (차이가 dead 보다 클 때만 돌린다)
function smoothDrive(track, rnd, laps, dead) {
  const car = new Car(track), hist = [], rec = [];
  let act = 1, held = 0;
  for (let i = 0; i < 60 * 300; i++) {
    const s = car.sense(); hist.push(s);
    if (held <= 0) {
      const v = hist[Math.max(0, hist.length - 1 - (5 + Math.floor(rnd() * 6)))];
      const diff = (v[4] + v[5]) - (v[1] + v[2]);
      const next = v[3] < 0.3 ? (diff > 0 ? 2 : 0) : diff > dead ? 2 : diff < -dead ? 0 : 1;
      if (next !== act) { act = next; held = 3; }
    } else held--;
    if (i % RECORD_EVERY === 0) rec.push([hist[Math.max(0, hist.length - 1 - REACT_STEPS)], act]);
    if (car.step(act) || car.progress >= laps) break;
  }
  return rec;
}

test('바퀴 수보다 좌우 균형: 둥근 트랙에서 한쪽만 돌면 다른 트랙에서 부딪힌다', () => {
  // 둥근 트랙 한 바퀴를 필요할 때만 돌며 운전 → 한쪽 장면이 30개가 안 된다
  const oneSided = smoothDrive(byId('oval'), seeded(11), 1, 0.5);
  const c = [0, 1, 2].map(k => oneSided.filter(r => r[1] === k).length);
  assert.ok(Math.min(c[0], c[2]) < 30, `왼/곧/오 ${c}`);
  const a = fit(oneSided).pol;
  assert.ok(!aiDrive(byId('oval'), a).crashed, '가르친 둥근 트랙은 돈다');
  assert.ok(aiDrive(byId('wavy'), a).crashed && aiDrive(byId('test'), a).crashed, '다른 트랙에서는 부딪힌다');
  // 구불구불 트랙 반 바퀴를 자주 고치며 운전 → 양쪽이 넉넉하고 20코스를 모두 돈다
  const balanced = smoothDrive(byId('wavy'), seeded(12), 0.5, 0.3);
  const d = [0, 1, 2].map(k => balanced.filter(r => r[1] === k).length);
  assert.ok(Math.min(d[0], d[2]) >= 30, `왼/곧/오 ${d}`);
  const b = fit(balanced).pol;
  for (const t of courses) assert.ok(!aiDrive(t, b).crashed, `${name(t)} 에서 부딪힘`);
});

test('쉬운 트랙만 양방향으로 돌면 양쪽은 넉넉해도 급한 커브에서 부딪힌다', () => {
  // 둥근 트랙을 기본 방향 1바퀴 + 거꾸로 1바퀴 → 왼쪽·오른쪽 모두 30장면 넘음
  const rec = [...smoothDrive(byId('oval'), seeded(11), 1, 0.5), ...smoothDrive(byId('oval', true), seeded(13), 1, 0.5)];
  const c = [0, 1, 2].map(k => rec.filter(r => r[1] === k).length);
  assert.ok(Math.min(c[0], c[2]) >= 30, `왼/곧/오 ${c}`);
  const pol = fit(rec).pol;
  assert.ok(!aiDrive(byId('oval'), pol).crashed && !aiDrive(byId('oval', true), pol).crashed, '둥근 트랙은 양쪽 다 돈다');
  const failed = courses.filter(t => aiDrive(t, pol).crashed);
  assert.ok(failed.some(t => t.def.level === 3), `부딪힌 코스: ${failed.map(name).join(', ') || '없음'}`);
});
