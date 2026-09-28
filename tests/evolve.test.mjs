// ═══════════════════════════════════════════════════════════
// 진화 활동 검사 — node --test tests/*.test.mjs
// ═══════════════════════════════════════════════════════════
// 1. 물리가 터지지 않는다 (가만히 둔 몸은 땅 위에 머문다, 값이 유한하다)
// 2. 30세대 진화하면 첫 세대보다 멀리 간다 (세 몸 모두)
// 3. "멀리 가기" 만 주면 굴러가는 꾀가 나오고(똑바로 선 시간이 짧다),
//    "뒤집히지 않고 멀리 가기" 로 바꾸면 똑바로 서서 간다

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BODIES, TERRAINS, Evolution, Creature, simulate } from '../acts/evolve/life.js';

test('근육이 쉬면 몸은 땅 위에 가만히 있다', () => {
  for (const b of Object.values(BODIES)) {
    const g = { amp: b.muscles.map(() => 0), phase: b.muscles.map(() => 0), freq: 1, grip: b.nodes.map(() => 0.5) };
    const c = simulate(b, g, TERRAINS.flat);
    assert.ok(Math.abs(c.distance) < 0.05, `${b.label} 움직임 ${c.distance}`);
    assert.ok(c.p.every(([x, y]) => Number.isFinite(x) && y >= -1e-9), `${b.label} 땅 밑으로`);
  }
});

function evolve(body, reward, seed, gens = 30) {
  const ev = new Evolution(BODIES[body], { reward, seed });
  let first, last;
  for (let g = 0; g < gens; g++) { last = ev.step(); if (!g) first = last; }
  return { first, last };
}

test('진화하면 멀리 간다', () => {
  for (const body of Object.keys(BODIES)) {
    const { first, last } = evolve(body, 'far', 1);
    assert.ok(last.distance > first.distance * 1.5 && last.distance > 5, `${body}: ${first.distance} → ${last.distance}`);
  }
});

test('"멀리 가기" 는 굴러가고, "뒤집히지 않고" 는 똑바로 간다', () => {
  for (const body of ['crawler', 'table']) {
    for (const seed of [1, 2]) {
      const far = evolve(body, 'far', seed).last, up = evolve(body, 'upright', seed).last;
      assert.ok(far.upright < 0.7, `${body}/${seed} 멀리 가기 똑바로 ${far.upright}`);
      assert.ok(up.upright > 0.7 && up.distance > 5, `${body}/${seed} 뒤집히지 않고: 똑바로 ${up.upright}, 거리 ${up.distance}`);
    }
  }
});

test('같은 유전자면 같은 움직임 (다시 보기가 진화 결과와 같다)', () => {
  const { last } = evolve('crawler', 'far', 3, 5);
  const a = simulate(BODIES.crawler, last.bestGenome, TERRAINS.flat).distance;
  const b = simulate(BODIES.crawler, last.bestGenome, TERRAINS.flat).distance;
  assert.equal(a, b);
  assert.ok(Math.abs(a - last.distance) < 1e-9);
  assert.ok(new Creature(BODIES.crawler, last.bestGenome).isUpright());
});
