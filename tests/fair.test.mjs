// ═══════════════════════════════════════════════════════════
// 공정 활동 검사 — node --test tests/*.test.mjs
// ═══════════════════════════════════════════════════════════
// 수업에서 보여 주는 네 장면이 늘 나오는지 (시드 여섯 개):
// 1. 편향된 기록으로 배우면 "2반인가" 를 묻고, 올해 두 반 합격률 차이가 크다
// 2. "2반인가" 를 빼도 "통학 버스" 가 대신 쓰여 차이가 남는다 (대리 변수)
// 3. 반·버스를 모두 빼거나, 기록을 실력 기준으로 고치면 차이가 작아진다
// 4. 편향된 기록을 많이 모아도(2반 기록 2배) 차이는 줄지 않는다
// (시드에 따라 나무가 우연히 반을 안 쓰는 판도 가끔 있다 — 60명 기록 8판 중 1판. DEVELOP.md)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pastData, thisYear, buildTree, audit, usedFeatures, predict } from '../acts/fair/fair.js';

const ALL = ['practice', 'works', 'attend', 'class2', 'bus'], MERIT = ['practice', 'works', 'attend'];
const SEEDS = [1, 2, 3, 4, 5, 6], year = thisYear();
const run = (opt, feats, label = 'passed') => SEEDS.map(seed => {
  const t = buildTree(pastData({ ...opt, seed }), label, feats, { maxDepth: 3 });
  return { a: audit(t, year), used: usedFeatures(t) };
});

test('결정 나무는 기록을 그대로 따라 한다', () => {
  const rows = [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 }, { x: 5, y: 0 },
    { x: 6, y: 1 }, { x: 7, y: 1 }, { x: 8, y: 1 }, { x: 9, y: 1 }, { x: 10, y: 1 }];
  const t = buildTree(rows, 'y', ['x'], { maxDepth: 2, minLeaf: 2 });
  assert.equal(t.f, 'x'); assert.ok(t.th > 5 && t.th < 6);
  assert.equal(predict(t, { x: 3 }), 0); assert.equal(predict(t, { x: 9 }), 1);
});

test('편향된 기록으로 배우면 반을 따지고 차이가 크다', () => {
  for (const r of run({}, ALL)) {
    assert.ok(r.used.has('class2') || r.used.has('bus'), [...r.used].join());
    assert.ok(r.a.gap > 0.15, `차이 ${r.a.gap}`);
  }
});

test('반을 빼도 버스가 대신해서 차이가 남는다', () => {
  for (const r of run({}, ALL.filter(f => f !== 'class2'))) {
    assert.ok(r.used.has('bus'), [...r.used].join());
    assert.ok(r.a.gap > 0.15, `차이 ${r.a.gap}`);
  }
});

test('반·버스를 빼거나 기록을 고치면 차이가 작아진다', () => {
  for (const r of [...run({}, MERIT), ...run({}, ALL, 'fit')]) assert.ok(Math.abs(r.a.gap) < 0.12, `차이 ${r.a.gap}`);
});

test('편향된 기록을 더 모아도 차이는 줄지 않는다', () => {
  for (const r of run({ n2: 120 }, ALL)) assert.ok(r.a.gap > 0.15, `차이 ${r.a.gap}`);
});
