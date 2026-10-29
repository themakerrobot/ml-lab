// ═══════════════════════════════════════════════════════════
// 운전 활동 검사 — node --test tests/*.test.mjs
// ═══════════════════════════════════════════════════════════
// 1. AI 운전사(Policy) 역전파 = 수치 미분
// 2. 사람처럼 늦게 반응하는 학생의 운전을 "0.1초 전 센서"와 짝지어 배우면
//    가르칠 때 안 쓴 트랙까지 완주한다 (화면의 기록 방식과 같다)
// 3. 곧게만 가르치면 곧 부딪힌다 — 수업에서 보여 주는 바로 그 현상
// 4. 바퀴 수보다 좌우 균형, 그리고 급한 커브도 보여 줘야 한다 (화면의 "언제 배우기를 누르나" 안내)
// 연습 트랙은 12개 × 두 방향 = 24코스. 트랙을 더하면 아래 검사가 모든 코스에서 다시 돈다.
// 5. 고급 모드 · 대회 트랙 · AI 파일 (edge-lab 자동차 가르치기에서 되가져온 것)
//    두 갈래 역전파 · 1배는 예전과 비트 단위로 같음 · 대회 트랙 조건 · 고급 흐름 · 드문 행동 무게 ·
//    AI 파일 왕복 · 대회는 결정적

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS, CONTEST, buildTrack, onRoad, nearestIdx } from '../acts/drive/track.js';
import { Car, teacher, teacher2, drive, SPEED, TURN, DT, ACTIONS } from '../acts/drive/sim.js';
import { Policy, savePolicy, loadPolicy } from '../acts/drive/policy.js';

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

test('선생님 운전은 24코스(12트랙 × 두 방향)를 모두 돈다', () => {
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
  // 구불구불 트랙 반 바퀴를 자주 고치며 운전 → 양쪽이 넉넉하고 24코스를 모두 돈다
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

// ════════ 고급 모드 · 대회 트랙 · AI 파일 ════════

const contest = CONTEST.map(d => buildTrack(d));

test('두 갈래 역전파 = 수치 미분 (무게 있을 때 · 없을 때)', () => inF64(() => {
  const pol = new Policy(8, { hid: 5, heads: [3, 3], seed: 9 });
  const X = [[0.1, 0.9, 0.3, 0.5, 0.2, 0.7, 0.4, 0.6], [0.7, 0.2, 0.8, 0.1, 0.9, 0.3, 0.5, 0.2], [0.4, 0.4, 0.6, 0.9, 0.1, 0.2, 0.8, 0.9]];
  const Y = [5, 0, 7], idx = [0, 1, 2];
  for (const w of [null, Float64Array.from([1.5, 0.7, 2, 3, 0.4, 1.2])]) {
    pol.grad(X, Y, idx, w);
    const loss = () => idx.reduce((a, n) => {
      const P = pol.predict(X[n]);
      return a - pol.targets(Y[n]).reduce((b, c) => b + (w ? w[c] : 1) * Math.log(P[c] + 1e-9), 0);
    }, 0) / idx.length;
    let worst = 0;
    for (const k in pol.p) {
      const p = pol.p[k];
      for (let i = 0; i < p.length; i += Math.max(1, (p.length / 6) | 0)) {
        const old = p[i], eps = 1e-5;
        p[i] = old + eps; const lp = loss();
        p[i] = old - eps; const lm = loss();
        p[i] = old;
        const num = (lp - lm) / (2 * eps), a = pol.g[k][i];
        worst = Math.max(worst, Math.abs(num - a) / Math.max(1e-6, Math.abs(num) + Math.abs(a)));
      }
    }
    assert.ok(worst < 1e-4, `${w ? '무게 있음' : '무게 없음'}: 최대 상대오차 ${worst}`);
  }
}));

// 예전(고급 모드 전) Car.step 그대로 — 1배가 바뀌지 않았는지 비교하는 기준
function oldStep(c, action) {
  if (c.crashed) return true;
  c.th += ACTIONS[action] * TURN * DT;
  c.x += Math.cos(c.th) * SPEED * DT;
  c.y += Math.sin(c.th) * SPEED * DT;
  c.dist += SPEED * DT;
  const fx = c.x + Math.cos(c.th) * 9, fy = c.y + Math.sin(c.th) * 9;
  if (!onRoad(c.track, c.x, c.y) || !onRoad(c.track, fx, fy)) c.crashed = true;
  const n = c.track.n, prev = c.idx;
  c.idx = nearestIdx(c.track, c.x, c.y, prev);
  if (prev > n * 0.8 && c.idx < n * 0.2) c.laps++;
  else if (prev < n * 0.2 && c.idx > n * 0.8) c.laps--;
  return c.crashed;
}

test('1배는 예전 계산과 비트 단위로 같다 (24코스 × 4000걸음)', () => {
  for (const t of courses) {
    const a = new Car(t), b = new Car(t), c = new Car(t), rnd = seeded(5);
    for (let i = 0; i < 4000; i++) {
      // 선생님 운전에 가끔 엉뚱한 운전을 섞어 부딪히는 경우도 비교한다 (부딪히면 다시 출발)
      const act = rnd() < 0.15 ? (rnd() * 3) | 0 : teacher(a.sense());
      const ra = a.step(act), rb = b.step(act, 1), rc = oldStep(c, act);
      for (const o of [b, c]) {
        assert.ok(a.x === o.x && a.y === o.y && a.th === o.th && a.laps === o.laps && a.idx === o.idx && a.dist === o.dist,
          `${name(t)} ${i}걸음에서 다름`);
      }
      assert.ok(ra === rb && ra === rc);
      if (ra) { a.reset(t); b.reset(t); c.reset(t); }
    }
  }
});

test('대회 트랙 조건: 판 안 · 떨어진 길끼리 안 붙음 · 선생님(초급 · 고급)이 3바퀴', () => {
  for (const t of contest) {
    const { pts, n, hw } = t;
    for (const [x, y] of pts) assert.ok(x - hw >= 0 && x + hw <= 800 && y - hw >= 0 && y + hw <= 520, `${t.def.id} 가 화면 밖`);
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
    const c1 = new Car(t), c2 = new Car(t);
    for (let i = 0; i < 60 * 300 && !c1.crashed && c1.progress < 3; i++) c1.step(teacher(c1.sense()));
    for (let i = 0; i < 60 * 300 && !c2.crashed && c2.progress < 3; i++) c2.step2(teacher2(c2.sense2()));
    assert.ok(!c1.crashed && c1.progress >= 3, `${t.def.id} 초급 선생님 ${c1.progress.toFixed(2)}바퀴`);
    assert.ok(!c2.crashed && c2.progress >= 3, `${t.def.id} 고급 선생님 ${c2.progress.toFixed(2)}바퀴`);
    assert.ok(c2.t < c1.t && c2.vMax > 2, `${t.def.id} 고급이 더 빨라야 함 (${c2.t.toFixed(1)}초 · ${c2.vMax.toFixed(2)}배)`);
    assert.equal(c2.lapTimes().length, 3);
  }
});

// 고급 학생: 반응 lag 걸음 늦고 키는 hold 걸음 유지. 방향은 teacher, 빠르기는 thr(s) 규칙
function proStudent(track, rnd, thr, { lagMin = 4, lagMax = 9, hold = 4, laps = 1 } = {}) {
  const car = new Car(track), hist = [], rec = [];
  let act = 4, held = 0;
  for (let i = 0; i < 60 * 120; i++) {
    const s = car.sense2(); hist.push(s);
    if (held <= 0) {
      const v = hist[Math.max(0, hist.length - 1 - (lagMin + Math.floor(rnd() * (lagMax - lagMin + 1))))];
      const next = thr(v) * 3 + teacher(v);
      if (next !== act) { act = next; held = hold; }
    } else held--;
    if (i % RECORD_EVERY === 0) rec.push([hist[Math.max(0, hist.length - 1 - REACT_STEPS)], act]);
    if (car.step2(act) || car.progress >= laps) break;
  }
  return { car, rec };
}
const thrTeacher = s => (teacher2(s) / 3) | 0;                                    // 감속이 장면의 15~20%
const thrRare = s => (s[3] > 0.9 && s[7] < 0.9 ? 2 : s[3] < 0.4 && s[7] > 0.4 ? 0 : 1);   // 늦게 · 드물게 감속
// 섞기 난수도 고정한다 — 같은 seed 면 늘 같은 AI
function fitPro(rec, { seed = 1, balance = true } = {}) {
  const pol = new Policy(8, { heads: [3, 3], seed }), rnd = seeded(seed * 101);
  const X = rec.map(r => r[0]), Y = rec.map(r => r[1]);
  let r; for (let e = 0; e < 60; e++) r = pol.fitEpoch(X, Y, { balance, rnd });
  return { pol, ...r };
}

test('고급 흐름: 늦게 반응하는 학생이 연습 트랙 2개를 1바퀴씩 → 대회 트랙 3개 완주, 초급 선생님보다 빠르다', () => {
  const rnd = seeded(42), rec = [];
  for (const id of ['wavy', 'snake']) {
    const { car, rec: r } = proStudent(byId(id), rnd, thrTeacher);
    assert.ok(!car.crashed, `학생이 ${id} 에서 부딪힘`);
    rec.push(...r);
  }
  const thr = [0, 1, 2].map(k => rec.filter(r => ((r[1] / 3) | 0) === k).length);
  assert.ok(thr[0] >= 20 && thr[2] >= 20, `감속/그대로/가속 ${thr}`);
  const { pol } = fitPro(rec);
  for (const t of contest) {
    const r = drive(t, pol, 'pro');
    assert.ok(r.ok, `${t.def.id}: ${r.prog.toFixed(2)}바퀴에서 멈춤`);
    assert.ok(r.t < 56 && r.vMax > 1.8, `${t.def.id}: ${r.t.toFixed(1)}초 · ${r.vMax.toFixed(2)}배`);   // 초급 선생님 51~57초
  }
});

test('드문 행동 무게: 감속을 드물게 보여 주면 무게 없이는 거의 안 줄이고, 무게가 있으면 줄인다', () => {
  const rnd = seeded(7), rec = [];
  for (const id of ['wavy', 'snake', 'city']) rec.push(...proStudent(byId(id), rnd, thrRare).rec);
  const brakes = rec.filter(r => ((r[1] / 3) | 0) === 0);
  assert.ok(brakes.length / rec.length < 0.15, `감속 장면 ${brakes.length}/${rec.length}`);
  // 학생이 감속한 장면에서 AI 도 감속을 고르는 비율
  const recall = pol => brakes.filter(r => ((pol.act(r[0]) / 3) | 0) === 0).length / brakes.length;
  // 씨앗 10개로 재 보니 무게 없음 0.22~0.67 (대회 3 에서 늘 부딪힘), 있음 0.78~1.00 (대회 3개 모두 완주)
  for (const seed of [1, 2, 3]) {
    const plain = fitPro(rec, { seed, balance: false }).pol, weighted = fitPro(rec, { seed, balance: true }).pol;
    const pr = recall(plain), wr = recall(weighted);
    assert.ok(pr < 0.7 && wr > 0.85, `seed ${seed}: 감속 재현 무게 없음 ${pr.toFixed(2)} · 있음 ${wr.toFixed(2)}`);
    assert.ok(!drive(contest[2], plain, 'pro').ok, `seed ${seed}: 무게 없는 AI 가 대회 3 을 완주함`);
    for (const t of contest) assert.ok(drive(t, weighted, 'pro').ok, `seed ${seed}: 무게 있는 AI 가 ${t.def.id} 에서 멈춤`);
  }
});

test('AI 파일: 저장 → 불러오기 왕복, edge-lab 파일도 읽힘, 망가진 파일은 알림', () => {
  const rnd = seeded(3), rec = [];
  for (const id of ['wavy']) rec.push(...proStudent(byId(id), rnd, thrTeacher).rec);
  const pro = fitPro(rec).pol, basic = new Policy();
  for (const [pol, mode] of [[pro, 'pro'], [basic, 'basic']]) {
    const o = JSON.parse(JSON.stringify(savePolicy(pol, { mode, scenes: rec.length, acc: 80 })));
    assert.equal(o.kind, 'edge-lab-drive'); assert.equal(o.mode, mode);   // edge-lab 이 그대로 읽는 형식
    for (const kind of ['ml-lab-drive', 'edge-lab-drive']) {
      const back = loadPolicy({ ...o, kind });
      assert.deepEqual(back.heads, pol.heads);
      for (const [x] of rec.slice(0, 200)) {
        const xx = mode === 'pro' ? x : x.slice(0, 7);
        assert.equal(back.act(xx), pol.act(xx));
      }
      // 대회 기록도 같다
      const t = contest[0];
      assert.deepEqual(drive(t, back, mode), drive(t, pol, mode));
    }
  }
  const o = savePolicy(pro);
  assert.throws(() => loadPolicy({ ...o, kind: 'something-else' }), /운전 AI 파일이 아니에요/);
  assert.throws(() => loadPolicy(null), /운전 AI 파일이 아니에요/);
  assert.throws(() => loadPolicy({ ...o, p: { ...o.p, W1: o.p.W1.slice(1) } }), e => e.part === 'W1' && /망가졌어요/.test(e.message));
  assert.throws(() => loadPolicy({ ...o, p: { ...o.p, b2: o.p.b2.map(() => 'x') } }), e => e.part === 'b2');
  assert.throws(() => loadPolicy({ ...o, nIn: 9 }), /운전 AI 파일이 아니에요/);
});

test('대회는 결정적: 같은 AI 로 두 번 달리면 기록이 똑같다', () => {
  const rnd = seeded(11), rec = [];
  rec.push(...proStudent(byId('snake'), rnd, thrTeacher).rec);
  const pol = fitPro(rec).pol;
  const basic = fit(studentDrive(byId('wavy'), seeded(11)).rec).pol;
  for (const t of contest) {
    assert.deepEqual(drive(t, pol, 'pro'), drive(t, pol, 'pro'));
    assert.deepEqual(drive(t, basic, 'basic'), drive(t, basic, 'basic'));
  }
});
