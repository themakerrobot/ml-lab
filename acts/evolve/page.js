// ═══════════════════════════════════════════════════════════
// 진화 활동 — 화면 로직
// ═══════════════════════════════════════════════════════════
// 1차시 몸을 고르고 30세대 진화 → 걷는 법을 찾는 과정 (세대마다 가장 잘한 생물을 다시 보여 줌)
// 2차시 상 바꾸기: "멀리 가기" 만 주면 굴러가는 꾀, "높이 뛰기" 는 튕겨 오르는 꾀 → 상을 고친다
// 3차시 평지에서 진화한 생물을 오르막·울퉁불퉁 땅에 보내기, 돌연변이 크기 바꾸기
// 계산은 life.js(DOM 없음), 진화는 worker.js.

import { BODIES, TERRAINS, REWARDS, Creature, SIM_SECONDS, DT } from './life.js';

const T = s => (typeof GL_T === 'function' ? GL_T(s) : s);
const $ = id => document.getElementById(id);

const GENS = 30;
const SIGMAS = [[0.03, '작게'], [0.15, '보통'], [0.6, '크게']];
const REWARD_HINT = {
  far: '몸 가운데가 오른쪽으로 간 거리가 점수예요.',
  upright: '멀리 간 거리 × 똑바로 서 있던 시간 비율(세제곱)이 점수예요.',
  high: '몸 가운데가 가장 높이 올라간 높이가 점수예요.',
};

// ── 상태 ────────────────────────────────────────────────────
let bodyId = 'table', rewardId = 'far', terrainId = 'flat', testTerrain = null;
let best = null, hist = [], running = false, gen = 0;
let replay = null;
const logRows = [];

// ── 도우미 ──────────────────────────────────────────────────
let toastTimer = 0;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2400);
}
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function setStep(n) {
  for (let i = 1; i <= 3; i++) {
    $('s' + i).classList.toggle('on', i === n);
    $('s' + i).classList.toggle('done', i < n);
  }
}
const curStep = () => [1, 2, 3].find(i => $('s' + i).classList.contains('on')) || 1;

// ── 고르기 ──────────────────────────────────────────────────
function pickList(el, items, cur, onPick, icon) {
  el.innerHTML = items.map(([id, label, sub]) => `
    <div class="mradio${id === cur ? ' on' : ''}" data-id="${id}"><i class="fa-solid ${icon}"></i>
      <span class="nm">${T(label)}</span>${sub ? `<span class="mt">${T(sub)}</span>` : ''}</div>`).join('');
  el.querySelectorAll('.mradio').forEach(d => d.addEventListener('click', () => onPick(d.dataset.id)));
}
function renderPicks() {
  pickList($('bodyPick'), Object.entries(BODIES).map(([id, b]) => [id, b.label]), bodyId, id => { if (running) return; bodyId = id; fresh(); }, 'fa-bug');
  pickList($('rewardPick'), Object.entries(REWARDS).map(([id, r]) => [id, r.label]), rewardId, id => {
    if (running) return; rewardId = id; fresh(); if (gen || logRows.length) setStep(Math.max(2, curStep()));
  }, 'fa-trophy');
  $('rewardPick').insertAdjacentHTML('beforeend', `<div class="hint">${T(REWARD_HINT[rewardId])}</div>`);
  $('terrainSeg').innerHTML = Object.entries(TERRAINS).map(([id, t]) => `<button type="button" data-t="${id}" class="${id === terrainId ? 'on' : ''}">${T(t.label)}</button>`).join('');
  $('terrainSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { if (running) return; terrainId = b.dataset.t; fresh(); }));
  $('testSeg').innerHTML = Object.entries(TERRAINS).map(([id, t]) => `<button type="button" data-t="${id}" class="${id === (testTerrain || terrainId) ? 'on' : ''}">${T(t.label)}</button>`).join('');
  $('testSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    if (!best) { toast(T('먼저 진화시켜 주세요')); return; }
    testTerrain = b.dataset.t; startReplay(); renderPicks();
    if (testTerrain !== terrainId) setStep(3);
  }));
  $('panTitle').textContent = `${T(BODIES[bodyId].label)} · ${T(REWARDS[rewardId].label)}`;
}
$('sigma').addEventListener('input', () => { $('sigmaVal').textContent = T(SIGMAS[+$('sigma').value][1]); if (gen) setStep(3); });

// 설정이 바뀌면 처음부터
function fresh() {
  worker.postMessage({ type: 'stop' });
  best = null; hist = []; gen = 0; testTerrain = null; freshNext = true;
  $('genBadge').textContent = `0${T('세대')}`; $('stats').innerHTML = '';
  drawChart(); renderPicks();
  // 진화 전에는 근육이 움직이지 않는 몸만 보여 준다
  replay = new Creature(BODIES[bodyId], { amp: BODIES[bodyId].muscles.map(() => 0), phase: BODIES[bodyId].muscles.map(() => 0), freq: 1, grip: BODIES[bodyId].nodes.map(() => 0.5) }, TERRAINS[terrainId]);
  replay.dummy = true;
}
let freshNext = true;

// ── 진화 ────────────────────────────────────────────────────
const worker = new Worker('acts/evolve/worker.js', { type: 'module' });
worker.onerror = e => { toast(T('불러오지 못했어요. 새로고침해 주세요')); console.error(e); };
$('goBtn').addEventListener('click', () => {
  running = true; $('goBtn').disabled = true; $('stopBtn').disabled = false;
  worker.postMessage({ type: 'start', fresh: freshNext, body: bodyId, reward: rewardId, terrain: terrainId,
    sigma: SIGMAS[+$('sigma').value][0], gens: GENS, seed: (Math.random() * 1e9) | 0 });
  freshNext = false;
});
$('stopBtn').addEventListener('click', () => worker.postMessage({ type: 'stop' }));
$('resetBtn').addEventListener('click', () => { if (running) worker.postMessage({ type: 'stop' }); fresh(); });

worker.onmessage = ({ data: m }) => {
  if (m.type === 'gen') {
    gen = m.gen; hist.push(m); best = m;
    $('genBadge').textContent = `${gen}${T('세대')}`;
    drawChart();
    // 다시 보기는 한 바퀴(6초)가 끝날 때 새 챔피언으로 바꾼다 — 매 세대 바꾸면 너무 어지럽다
    if (!replay || replay.dummy || replay.done) startReplay();
  } else if (m.type === 'done') {
    running = false; $('goBtn').disabled = false; $('stopBtn').disabled = true;
    if (best) {
      logRows.unshift({
        body: T(BODIES[bodyId].label), reward: T(REWARDS[rewardId].label), terrain: T(TERRAINS[terrainId].label),
        gen, dist: best.distance, upright: best.upright, height: best.height,
      });
      logRows.length = Math.min(logRows.length, 10);
      renderLog();
      startReplay();
      if (curStep() === 1 && gen >= GENS) toast(T('진화를 마쳤어요. 상을 바꿔 보면 어떻게 될까요?'));
    }
  }
};

function renderLog() {
  $('log').innerHTML = `<table class="mk-table exam">
    <tr><th>${T('몸 · 상')}</th><th>${T('세대')}</th><th>${T('거리')}</th><th>${T('똑바로')}</th></tr>
    ${logRows.map(r => `<tr><td class="nm">${esc(r.body)}<div class="sub">${esc(r.reward)} · ${esc(r.terrain)}</div></td>
      <td class="num">${r.gen}</td><td class="num">${r.dist.toFixed(1)}m</td>
      <td class="num${r.upright < 0.7 ? ' low' : ''}">${Math.round(r.upright * 100)}%</td></tr>`).join('')}
  </table>`;
}

// ── 다시 보기 ───────────────────────────────────────────────
function startReplay() {
  if (!best) return;
  const t = TERRAINS[testTerrain || terrainId];
  replay = new Creature(BODIES[bodyId], best.bestGenome, t);
  replay.done = false;
}
function stats() {
  if (!replay || !best) { $('stats').innerHTML = ''; return; }
  const onTest = testTerrain && testTerrain !== terrainId;
  $('stats').innerHTML = `
    <span class="badge num">${T('거리')} ${replay.distance.toFixed(1)}m</span>
    <span class="badge num">${T('똑바로')} ${Math.round(replay.uprightRatio * 100)}%</span>
    <span class="badge num">${T('가장 높이')} ${replay.maxH.toFixed(2)}m</span>
    <span class="badge num">${Math.min(SIM_SECONDS, replay.t).toFixed(1)}/${SIM_SECONDS}${T('초')}</span>
    ${onTest ? `<span class="badge">${T('시험 중인 땅')}: ${T(TERRAINS[testTerrain].label)}</span>` : ''}`;
}

const stage = $('stage');
let last = 0, accT = 0;
// 다시 보기 속도. 30세대 뒤 생물은 다리를 1초에 2.5번까지 흔들고 초속 5m 넘게 구르기도 해서
// 실제 속도로는 어떻게 움직이는지 보기 어렵다. 기본은 0.5배 (초 표시는 생물 시간 그대로).
let playSpeed = 0.5;
$('playSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  playSpeed = +b.dataset.s;
  $('playSeg').querySelectorAll('button').forEach(o => o.classList.toggle('on', o === b));
}));
function frame(now) {
  requestAnimationFrame(frame);
  accT += Math.min(0.1, (now - (last || now)) / 1000) * playSpeed; last = now;
  if (replay) {
    while (accT >= DT) {
      accT -= DT;
      if (replay.t < SIM_SECONDS) replay.step();
      else if (!replay.done) { replay.done = true; replay.hold = 0; }
      else if ((replay.hold += DT) > 1) { startReplay(); if (!best) break; }
    }
  }
  draw(); stats();
}

function sizeStage() {
  const w = $('stageBox').clientWidth; if (!w) return;
  const dpr = devicePixelRatio || 1, h = Math.round(w * 0.42);
  stage.style.height = h + 'px'; stage.width = w * dpr; stage.height = h * dpr;
}
new ResizeObserver(sizeStage).observe($('stageBox'));

function draw() {
  if (!stage.width || !replay) return;
  const g = stage.getContext('2d'), dpr = devicePixelRatio || 1, W = stage.width / dpr, H = stage.height / dpr;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const S = Math.min(W / 7, 110);                        // 1m = S 픽셀
  const cx = replay.cx(), camX = cx - W / S * 0.35;       // 생물을 왼쪽 1/3 쯤에 둔다
  const terr = replay.terrain, groundY = H * 0.8;
  const sx = x => (x - camX) * S, sy = y => groundY - (y - terr.h(cx)) * S;
  g.fillStyle = css('--panel2'); g.fillRect(0, 0, W, H);
  // 땅
  g.fillStyle = css('--line-soft'); g.beginPath(); g.moveTo(0, H);
  for (let px = 0; px <= W; px += 4) g.lineTo(px, sy(terr.h(camX + px / S)));
  g.lineTo(W, H); g.closePath(); g.fill();
  g.strokeStyle = css('--line'); g.lineWidth = 1.5; g.beginPath();
  for (let px = 0; px <= W; px += 4) { const y = sy(terr.h(camX + px / S)); px ? g.lineTo(px, y) : g.moveTo(px, y); }
  g.stroke();
  // 1m 눈금
  g.fillStyle = css('--ink3'); g.font = '10px sans-serif'; g.textAlign = 'center';
  for (let m = Math.ceil(camX); m < camX + W / S; m++) {
    const x = sx(m), y = sy(terr.h(m));
    g.fillRect(x, y, 1, 6); g.fillText(`${m}m`, x, y + 16);
  }
  // 출발선
  const x0 = sx(replay.x0); g.fillStyle = css('--ink'); g.fillRect(x0, sy(terr.h(replay.x0)) - 40, 2, 40);
  // 몸
  const p = replay.p, body = replay.body;
  g.lineCap = 'round';
  g.strokeStyle = css('--ink2'); g.lineWidth = 5;
  for (const [a, b] of body.bones) { g.beginPath(); g.moveTo(sx(p[a][0]), sy(p[a][1])); g.lineTo(sx(p[b][0]), sy(p[b][1])); g.stroke(); }
  g.strokeStyle = css('--acc'); g.lineWidth = 3.5;
  for (const [a, b] of body.muscles) { g.beginPath(); g.moveTo(sx(p[a][0]), sy(p[a][1])); g.lineTo(sx(p[b][0]), sy(p[b][1])); g.stroke(); }
  const ink = css('--ink'), paper = css('--panel');
  p.forEach(([x, y], i) => {
    g.fillStyle = paper; g.strokeStyle = ink; g.lineWidth = 1.5;
    g.beginPath(); g.arc(sx(x), sy(y), 7, 0, Math.PI * 2); g.fill(); g.stroke();
    g.globalAlpha = replay.genome.grip[i]; g.fillStyle = ink;
    g.beginPath(); g.arc(sx(x), sy(y), 5.5, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
  });
}

function drawChart() {
  const c = $('chart'), dpr = devicePixelRatio || 1, Wc = c.clientWidth, Hc = c.clientHeight;
  if (!Wc || !Hc) return;
  c.width = Wc * dpr; c.height = Hc * dpr;
  const g = c.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, Wc, Hc);
  if (hist.length < 2) return;
  const all = hist.flatMap(h => [h.best, h.avg]), mx = Math.max(...all), mn = Math.min(0, ...all), span = mx - mn || 1;
  const n = Math.max(GENS, hist.length);
  const line = (key, color) => {
    g.strokeStyle = color; g.lineWidth = 2; g.beginPath();
    hist.forEach((h, i) => { const x = 6 + i / (n - 1) * (Wc - 12), y = Hc - 6 - (h[key] - mn) / span * (Hc - 12); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
  };
  line('avg', css('--warn')); line('best', css('--acc'));
}
addEventListener('resize', drawChart);

// ── 시작 ────────────────────────────────────────────────────
$('engine').textContent = T('인터넷 없이 이 컴퓨터에서 배워요');
fresh();
requestAnimationFrame(frame);
