// ═══════════════════════════════════════════════════════════
// AI 눈 활동 — 학습 워커
// ═══════════════════════════════════════════════════════════
// 메인 → { type:'train', X, Y, nClass, aug, epochs }
// 워커 → { type:'progress', epoch, epochs, loss, acc }
//        { type:'done', model, acc, wrong, exam }
//
// exam = "속이기 시험" (exam.js)

import { TinyCNN } from './cnn.js';
import { makeAugment } from './imgops.js';
import { runExam } from './exam.js';

onmessage = async ({ data: m }) => {
  if (m.type !== 'train') return;
  const X = m.X.map(a => Float32Array.from(a)), Y = m.Y;
  const model = new TinyCNN(m.nClass, { seed: (Math.random() * 1e9) | 0 });
  const aug = makeAugment(m.aug);
  for (let e = 0; e < m.epochs; e++) {
    const loss = model.fitEpoch(X, Y, { aug });
    const acc = (e % 5 === 4 || e === m.epochs - 1) ? model.accuracy(X, Y) : null;
    postMessage({ type: 'progress', epoch: e + 1, epochs: m.epochs, loss, acc });
    await new Promise(r => setTimeout(r, 0));
  }
  // 틀린 그림 번호 (배운 그림 그대로 물었는데도 틀린 것)
  const wrong = [];
  X.forEach((x, n) => {
    const o = model.predict(x), a = o.indexOf(Math.max(...o));
    if (a !== Y[n]) wrong.push([n, a]);
  });
  postMessage({ type: 'done', model: model.toJSON(), acc: model.accuracy(X, Y), wrong, exam: runExam(model, X, Y) });
};
