// ═══════════════════════════════════════════════════════════
// 진화 활동 — 진화 워커 (한 세대에 수십 ms — 화면이 멈추지 않게 여기서)
// ═══════════════════════════════════════════════════════════
// 메인 → { type:'start', body, reward, terrain, sigma, gens, seed } | { type:'stop' }
// 워커 → { type:'gen', gen, best, avg, bestGenome, distance, upright, height } | { type:'done' }

import { BODIES, Evolution } from './life.js';

let ev = null, stop = false, running = false;

onmessage = async ({ data: m }) => {
  if (m.type === 'stop') { stop = true; return; }
  if (m.type !== 'start') return;
  if (m.fresh || !ev || ev.bodyId !== m.body || ev.reward !== m.reward || ev.terrain !== m.terrain) {
    ev = new Evolution(BODIES[m.body], { reward: m.reward, terrain: m.terrain, sigma: m.sigma, seed: m.seed });
    ev.bodyId = m.body;
  }
  ev.sigma = m.sigma;
  if (running) return;
  running = true; stop = false;
  for (let g = 0; g < m.gens && !stop; g++) {
    postMessage({ type: 'gen', ...ev.step() });
    await new Promise(r => setTimeout(r, 0));
  }
  running = false;
  postMessage({ type: 'done' });
};
