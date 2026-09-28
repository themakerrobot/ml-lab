// ═══════════════════════════════════════════════════════════
// 청소 활동 검사 — node --test tests/*.test.mjs
// ═══════════════════════════════════════════════════════════
// 1. 먼지 나침반: 거리가 같으면 앞을 먼저 가리킨다 (고치기 전에는 늘 "북쪽" 을 골라 학습이 망가졌다)
// 2. 배우는 청소기(기본 상)가 규칙 청소기 셋보다 150걸음 동안 더 많이 치운다
// 3. "움직이면 상, 청소 상 0" 으로 배우면 기본 상보다 덜 치운다 (상을 잘못 주면 엉뚱하게 배운다)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROOMS, RULES, QAgent, Sim, evaluate, DEFAULT_REWARD, seeded, W, H } from '../acts/cleaner/world.js';

const rooms = Object.fromEntries(Object.entries(ROOMS).map(([k, v]) => [k, v.make()]));

function train(seed, reward, { useCompass = true, episodes = 600 } = {}) {
  const ag = new QAgent(), rnd = seeded(seed), g = rooms.living, floors = [];
  for (let i = 0; i < W * H; i++) if (!g[i]) floors.push(i);
  for (let e = 0; e < episodes; e++) {
    const i = floors[(rnd() * floors.length) | 0];
    ag.episode(g, reward, { rnd, useCompass, start: [i % W, (i / W) | 0, (rnd() * 4) | 0], eps: Math.max(0.05, 0.3 * (1 - e / episodes)) });
  }
  return ag;
}
const score = (ag, room) => evaluate(rooms[room], r => ag.policy(r), { steps: 150 }).coverage;

test('먼지 나침반은 거리가 같으면 앞을 가리킨다', () => {
  const sim = new Sim(rooms.living, [5, 6, 1]);      // 동쪽을 보고, 사방이 먼지
  assert.equal(sim.compass(), 0);
  sim.dir = 2;                                       // 남쪽을 봐도 앞
  assert.equal(sim.compass(), 0);
});

test('배우는 청소기가 규칙 청소기보다 더 많이 치운다', () => {
  const bestRule = Math.max(...Object.values(RULES).map(r => evaluate(rooms.living, rnd => r.make(rnd), { steps: 150 }).coverage));
  let learned = 0;
  for (const seed of [1, 2, 3]) learned += score(train(seed, DEFAULT_REWARD), 'living') / 3;
  assert.ok(learned > 0.9, `배우는 청소기 ${learned}`);
  assert.ok(learned > bestRule + 0.2, `배우는 ${learned} vs 규칙 최고 ${bestRule}`);
});

test('청소에 상을 안 주고 움직임에 상을 주면 덜 치운다', () => {
  for (const seed of [1, 2, 3]) {
    const good = score(train(seed, DEFAULT_REWARD), 'living');
    const hacked = score(train(seed, { clean: 0, step: 0.1, bump: -0.5 }), 'living');
    assert.ok(hacked < good - 0.2, `시드 ${seed}: 기본 ${good} vs 움직임 상 ${hacked}`);
  }
});
