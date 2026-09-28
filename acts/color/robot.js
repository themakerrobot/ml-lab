// ═══════════════════════════════════════════════════════════
// 색 활동 — 색 고르기 로봇 (DOM 없음)
// ═══════════════════════════════════════════════════════════
// 컨베이어에 블록이 오면 카메라 칸(블록 한 개)의 픽셀을 모두 답표(LUT)로 판정하고,
// "바탕" 을 뺀 가장 많은 표를 받은 색으로 고른다 (다수결).
// runRobotTest: 조명마다 같은 블록 순서(시드 고정)로 시험 — 학습마다 같은 시험지.

import { qIndex } from './colorcore.js';
import { BLOCKS, LIGHTS, blockPatch, seeded } from './scenes.js';

// 반환: 고른 종류 번호 (1~BLOCKS.length), 모두 바탕이면 0
export function classifyPatch(lut, patch) {
  const votes = new Int32Array(BLOCKS.length + 1), d = patch.data;
  for (let i = 0; i < patch.width * patch.height; i++) votes[lut.cls[qIndex(d[i * 4], d[i * 4 + 1], d[i * 4 + 2])]]++;
  let best = 0;                                      // 0 = 아무 색도 표를 못 받음
  for (let k = 1; k < votes.length; k++) if (votes[k] > (best ? votes[best] : 0)) best = k;
  return best;
}

export function runRobotTest(lut, { perLight = 32, seed = 777 } = {}) {
  const out = {}, mistakes = {};
  for (const light of Object.keys(LIGHTS)) {
    const rnd = seeded(seed);
    let ok = 0;
    for (let n = 0; n < perLight; n++) {
      const b = n % BLOCKS.length;                     // 색마다 같은 수
      const got = classifyPatch(lut, blockPatch(BLOCKS[b].rgb, LIGHTS[light], rnd));
      if (got === b + 1) ok++;
      else { const key = `${light}:${b + 1}:${got}`; mistakes[key] = (mistakes[key] || 0) + 1; }
    }
    out[light] = ok / perLight;
  }
  // 가장 많이 틀린 것 하나: [조명, 진짜 색 번호, 고른 번호, 횟수]
  const worst = Object.entries(mistakes).sort((a, b) => b[1] - a[1])[0];
  out.worst = worst ? [...worst[0].split(':').map((v, i) => i ? +v : v), worst[1]] : null;
  return out;
}
