// ═══════════════════════════════════════════════════════════
// 색 로봇 활동 검사 — node --test tests/*.test.mjs
// ═══════════════════════════════════════════════════════════
// 1. ColorMLP 역전파 = 수치 미분
// 2. 답표(LUT) 칸 번호와 가운데 색이 서로 맞는다, KNN 다수결이 맞다
// 3. 투명 망토: 칠하지 않은 초록 화분은 망토로 착각하고, 화분을 "망토 아님" 으로 칠하면 고쳐진다
// 4. 로봇: 보통 조명으로만 가르치면 다른 조명에서 틀리고, 그 조명 사진으로 더 가르치면 나아진다
//    (화면의 칠하기처럼 사진 위에서 픽셀을 골라 가르친다)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KNN, ColorMLP, buildLUT, qIndex, cellCenter, thin, LUT_SIZE, rgb2hsv, hsv2rgb } from '../acts/color/colorcore.js';
import { blocksScene, roomScenes, seeded } from '../acts/color/scenes.js';
import { runRobotTest } from '../acts/color/robot.js';

function inF64(fn) {
  const F32 = globalThis.Float32Array;
  globalThis.Float32Array = Float64Array;
  try { return fn(); } finally { globalThis.Float32Array = F32; }
}

test('ColorMLP 역전파 = 수치 미분', () => inF64(() => {
  const m = new ColorMLP(3, { hid: 5, seed: 2 });
  const X = [[0.9, 0.1, 0.1], [0.1, 0.8, 0.2], [0.2, 0.3, 0.9], [0.5, 0.5, 0.5]], Y = [0, 1, 2, 1], idx = [0, 1, 2, 3];
  m.grad(X, Y, idx);
  const loss = () => idx.reduce((a, n) => a - Math.log(m.predict(X[n])[Y[n]]), 0) / idx.length;
  let worst = 0;
  for (const k in m.p) {
    const w = m.p[k];
    for (let i = 0; i < w.length; i++) {
      const old = w[i], eps = 1e-6;
      w[i] = old + eps; const lp = loss();
      w[i] = old - eps; const lm = loss();
      w[i] = old;
      const num = (lp - lm) / (2 * eps), a = m.g[k][i];
      worst = Math.max(worst, Math.abs(num - a) / Math.max(1e-7, Math.abs(num) + Math.abs(a)));
    }
  }
  assert.ok(worst < 1e-4, `최대 상대오차 ${worst}`);
}));

test('답표 칸 번호와 색이 맞고, KNN 다수결이 맞다', () => {
  assert.equal(qIndex(255, 255, 255), LUT_SIZE - 1);
  assert.equal(qIndex(0, 0, 0), 0);
  for (const i of [0, 1234, 20000, LUT_SIZE - 1]) {
    const [r, g, b] = cellCenter(i).map(v => Math.floor(v * 256));
    assert.equal(qIndex(r, g, b), i);
  }
  const knn = new KNN(3).fit([[1, 0, 0], [0.9, 0.1, 0], [0, 0, 1], [0.8, 0, 0.1]], [0, 0, 1, 1], 2);
  const o = knn.predict([0.95, 0.05, 0]);           // 가까운 셋: 0,0,1 → 0 이 2/3
  assert.ok(Math.abs(o[0] - 2 / 3) < 1e-6 && Math.abs(o[1] - 1 / 3) < 1e-6);
  const [h, s, v] = rgb2hsv(0.2, 0.6, 0.4), back = hsv2rgb(h, s, v);
  assert.ok(back.every((c, i) => Math.abs(c - [0.2, 0.6, 0.4][i]) < 1e-9));
});

// 사진에서 영역별로 픽셀을 골라 가르친다 (칠하기 흉내)
const px = (im, i) => [im.data[i * 4] / 255, im.data[i * 4 + 1] / 255, im.data[i * 4 + 2] / 255];

test('투명 망토: 초록 화분을 망토로 착각하고, 칠해 주면 고쳐진다', () => {
  const room = roomScenes(seeded(3)), W = 320, H = 240, rnd = seeded(4);
  const inPlant = i => { const x = i % W, y = (i / W) | 0; return x > W * 0.06 && x < W * 0.16 && y > H * 0.45 && y < H * 0.72; };
  const inShirt = i => { const x = i % W, y = (i / W) | 0; return Math.abs(x - W * 0.45) < 10 && y > H * 0.35 && y < H * 0.55; };
  const cloak = [], other = [], plant = [];
  room.truth.forEach((t, i) => { if (t) cloak.push(i); else if (inPlant(i)) plant.push(i); else if (!inShirt(i)) other.push(i); });
  const pick = (a, n) => Array.from({ length: n }, () => a[(rnd() * a.length) | 0]);
  const X = [], Y = [];
  pick(cloak, 300).forEach(i => { X.push(px(room.person, i)); Y.push(1); });
  pick(other, 400).forEach(i => { X.push(px(room.person, i)); Y.push(0); });
  const rate = (lut, a) => a.filter(i => lut.cls[qIndex(...[0, 1, 2].map(c => room.person.data[i * 4 + c]))] === 1).length / a.length;
  const before = buildLUT(new KNN(1).fit(X, Y, 2));
  assert.ok(rate(before, cloak) > 0.95, `망토 ${rate(before, cloak)}`);
  assert.ok(rate(before, plant) > 0.8, `칠하기 전 화분 → 망토 ${rate(before, plant)}`);
  pick(plant, 150).forEach(i => { X.push(px(room.person, i)); Y.push(0); });
  const after = buildLUT(new KNN(1).fit(X, Y, 2));
  assert.ok(rate(after, plant) < 0.3, `칠한 뒤 화분 → 망토 ${rate(after, plant)}`);
  assert.ok(rate(after, cloak) > 0.85, `칠한 뒤 망토 ${rate(after, cloak)}`);
});

test('로봇: 다른 조명에서 틀리다가, 그 조명 사진으로 더 가르치면 나아진다', () => {
  const rnd = seeded(9), X = [], Y = [];
  function paint(light) {
    const { image, truth } = blocksScene(light, seeded(11)), by = {};
    truth.forEach((c, i) => (by[c] ||= []).push(i));
    for (const c in by) for (let n = 0; n < 150; n++) { X.push(px(image, by[c][(rnd() * by[c].length) | 0])); Y.push(+c); }
  }
  const knnLut = () => { const t = thin(X, Y, 1500, seeded(1)); return buildLUT(new KNN(1).fit(t.X, t.Y, 5)); };
  paint('normal');
  const a = runRobotTest(knnLut());
  assert.equal(a.normal, 1);
  assert.ok(a.dark < 0.9 && a.sunset < 0.9, `보통만: 어둡게 ${a.dark} 노을 ${a.sunset}`);
  paint('dark');
  const b = runRobotTest(knnLut());
  assert.ok(b.dark > a.dark && b.dark >= 0.95, `+어둡게: 어둡게 ${a.dark} → ${b.dark}`);
  paint('sunset');
  const c = runRobotTest(knnLut());
  assert.ok(c.normal >= 0.95 && c.dark >= 0.95 && c.sunset >= 0.9, `+노을: ${JSON.stringify(c)}`);
});
