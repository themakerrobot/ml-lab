// ═══════════════════════════════════════════════════════════
// AI 눈 활동 — 속이기 시험 (DOM 없음)
// ═══════════════════════════════════════════════════════════
// 모은 그림을 정해진 방법으로 바꿔서 몇 %를 맞히는지 잰다.
// 흔드는 값은 시드로 고정 — 학습을 여러 번 해도 같은 시험지로 비교된다 (수업 3차시의 전후 비교표).

import { transform } from './imgops.js';

export const EXAMS = {
  straight: () => ({}),
  tilt: r => ({ rot: (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.4) }),                  // 30~50° 기울이기
  small: r => ({ scale: 0.6, dx: (r() - 0.5) * 10, dy: (r() - 0.5) * 10 }),        // 작게, 구석에
  dark: () => ({ bright: 0.35 }),                                                   // 어두운 방
};

export function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export function runExam(model, X, Y) {
  const out = {};
  for (const [name, make] of Object.entries(EXAMS)) {
    const r = seeded(12345);
    out[name] = model.accuracy(X.map(x => transform(x, make(r))), Y);
  }
  return out;
}
