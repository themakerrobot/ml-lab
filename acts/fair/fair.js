// ═══════════════════════════════════════════════════════════
// 공정 활동 — 가상 지원자 데이터 · 결정트리 · 공정성 재기 (DOM 없음)
// ═══════════════════════════════════════════════════════════
// 이야기: 코딩 동아리가 "지난 몇 년의 선발 결과" 로 선발 AI를 만든다.
//  · 실력 = 연습 시간 · 만든 작품 · 출석률로 정해진다 (반·통학 버스와는 상관없다)
//  · 그런데 지난 심사는 2반에 불리했다 (편향 세기 bias)
//  · 통학 버스는 2반 학생이 주로 탄다 → "반" 을 빼도 버스가 대신 드러낸다 (대리 변수)
// 올해 지원자(시험 데이터)는 두 반의 실력 분포가 똑같다. 그래서 공정한 AI라면
// 두 반의 합격률이 거의 같아야 한다.

export const FEATURES = [
  { id: 'practice', label: '연습 시간', unit: '시간', kind: 'num' },
  { id: 'works', label: '만든 작품', unit: '개', kind: 'num' },
  { id: 'attend', label: '출석률', unit: '%', kind: 'num' },
  { id: 'class2', label: '2반인가', kind: 'bool' },
  { id: 'bus', label: '통학 버스', kind: 'bool' },
];

export function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const gauss = rnd => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return (u - 3) / Math.sqrt(0.5); };

// 지원자 한 명
function person(rnd, class2) {
  const practice = Math.round(rnd() * 10);
  const works = Math.min(5, Math.max(0, Math.round(practice / 2.5 + gauss(rnd) * 1.1)));
  const attend = Math.min(100, Math.max(55, Math.round(78 + gauss(rnd) * 10)));
  const bus = class2 ? rnd() < 0.9 : rnd() < 0.1;   // 2반의 90%, 1반의 10% 가 버스를 탄다
  const merit = 0.5 * practice / 10 + 0.3 * works / 5 + 0.2 * (attend - 55) / 45 + gauss(rnd) * 0.05;
  return { practice, works, attend, class2: class2 ? 1 : 0, bus: bus ? 1 : 0, merit, fit: merit > 0.5 ? 1 : 0 };
}

// 지난 선발 기록. n1·n2 = 반별 사람 수, bias = 2반에 불리했던 정도 (0 = 공정)
export function pastData({ n1 = 120, n2 = 60, bias = 0.25, seed = 1 } = {}) {
  const rnd = seeded(seed), rows = [];
  for (let i = 0; i < n1 + n2; i++) {
    const p = person(rnd, i >= n1);
    p.passed = p.merit - (p.class2 ? bias : 0) > 0.5 ? 1 : 0;   // 지난 심사 결과 (편향 있음)
    rows.push(p);
  }
  return rows;
}
// 올해 지원자: 두 반 같은 수, 같은 실력 분포
export function thisYear({ n = 200, seed = 99 } = {}) {
  const rnd = seeded(seed), rows = [];
  for (let i = 0; i < n; i++) rows.push(person(rnd, i % 2 === 1));
  return rows;
}

// ── 결정트리 (CART, 지니) ───────────────────────────────────
const gini = (a, b) => { const n = a + b; if (!n) return 0; const p = a / n; return 1 - p * p - (1 - p) * (1 - p); };

export function buildTree(rows, label, feats, { maxDepth = 3, minLeaf = 5 } = {}, depth = 0) {
  const pos = rows.reduce((s, r) => s + r[label], 0), n = rows.length;
  const leaf = { leaf: true, n, pos, pass: pos * 2 >= n ? 1 : 0 };
  if (depth >= maxDepth || n < 2 * minLeaf || pos === 0 || pos === n) return leaf;
  let best = null;
  const base = gini(pos, n - pos);
  for (const f of feats) {
    const vals = [...new Set(rows.map(r => r[f]))].sort((a, b) => a - b);
    for (let i = 1; i < vals.length; i++) {
      const th = (vals[i - 1] + vals[i]) / 2;
      let ln = 0, lp = 0;
      for (const r of rows) if (r[f] < th) { ln++; lp += r[label]; }
      const rn = n - ln, rp = pos - lp;
      if (ln < minLeaf || rn < minLeaf) continue;
      const g = base - (ln / n) * gini(lp, ln - lp) - (rn / n) * gini(rp, rn - rp);
      if (!best || g > best.gain + 1e-12) best = { f, th, gain: g };
    }
  }
  if (!best || best.gain < 1e-4) return leaf;
  const L = rows.filter(r => r[best.f] < best.th), R = rows.filter(r => r[best.f] >= best.th);
  return {
    f: best.f, th: best.th, n, pos,
    no: buildTree(L, label, feats, { maxDepth, minLeaf }, depth + 1),        // 기준보다 작음
    yes: buildTree(R, label, feats, { maxDepth, minLeaf }, depth + 1),       // 기준 이상
  };
}

export function predict(tree, r) {
  let t = tree;
  while (!t.leaf) t = r[t.f] >= t.th ? t.yes : t.no;
  return t.pass;
}

// 나무가 쓴 특징들
export function usedFeatures(tree, out = new Set()) {
  if (!tree.leaf) { out.add(tree.f); usedFeatures(tree.no, out); usedFeatures(tree.yes, out); }
  return out;
}

// 올해 지원자로 재기: 실력 기준 정확도, 반별 합격률, 실력이 되는데 떨어진 비율(반별)
export function audit(tree, rows) {
  const g = [0, 1].map(() => ({ n: 0, pass: 0, fit: 0, fitRejected: 0 }));
  let ok = 0;
  for (const r of rows) {
    const p = predict(tree, r), c = g[r.class2];
    c.n++; c.pass += p;
    if (r.fit) { c.fit++; if (!p) c.fitRejected++; }
    if (p === r.fit) ok++;
  }
  const rate = c => c.n ? c.pass / c.n : 0;
  return {
    accuracy: ok / rows.length,
    pass1: rate(g[0]), pass2: rate(g[1]),
    gap: rate(g[0]) - rate(g[1]),
    missed1: g[0].fit ? g[0].fitRejected / g[0].fit : 0,      // 실력이 되는데 떨어진 비율
    missed2: g[1].fit ? g[1].fitRejected / g[1].fit : 0,
  };
}
