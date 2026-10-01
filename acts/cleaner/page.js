// ═══════════════════════════════════════════════════════════
// 청소 활동 — 화면 로직
// ═══════════════════════════════════════════════════════════
// 1차시 규칙 청소기 시합 (150걸음) · 방 고르기 · 가구 그리기
// 2차시 배우는 청소기 (Q-러닝): 상과 벌점을 정하고 연습 → 시합. "청소기의 생각" 보기
// 3차시 센서 끄기(먼지 나침반), 여러 방에서 연습, 처음 보는 방 시합
// 계산은 world.js (DOM 없음). 연습 600판은 0.3~0.5초라 화면 스레드에서 나눠 돌린다.

import { W, H, ROOMS, RULES, QAgent, Sim, randomRoom, seeded, DIRS } from './world.js';

const T = s => (typeof GL_T === 'function' ? GL_T(s) : s);
const $ = id => document.getElementById(id);

const RACE_STEPS = 150, EPISODES = 600;
const ACT_LABEL = ['앞으로', '왼쪽으로', '오른쪽으로', '뒤로'];
const ACT_ICON = ['fa-arrow-up', 'fa-arrow-left', 'fa-arrow-right', 'fa-arrow-down'];

// ── 상태 ────────────────────────────────────────────────────
let roomId = 'living';
const rooms = Object.fromEntries(Object.entries(ROOMS).map(([k, v]) => [k, v.make()]));
let bot = 'bounce';
let agent = null, agentInfo = null;
let sim = new Sim(rooms[roomId]);
let running = false, botImpl = null, raceRnd = null;
// 초당 걸음 수. 느리게 2 · 보통 5 (한 판 30초) · 아주 빠르게 60 (한 판 2.5초)
// 보통이 예전 8걸음이었을 때는 "배우는 청소기의 생각" 막대가 너무 빨리 바뀌어 읽기 어려웠다.
let stepsPerSec = 5;
const logRows = [];
let curve = [];

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
const reward = () => ({ clean: +$('rClean').value, step: +$('rStep').value, bump: +$('rBump').value });
const useCompass = () => $('compass').checked;
const roomLabel = id => T(id === 'custom' ? '내가 그린 방' : ROOMS[id].label);

// ── 방 고르기 · 그리기 ──────────────────────────────────────
function renderRooms() {
  const ids = [...Object.keys(ROOMS), ...(rooms.custom ? ['custom'] : [])];
  $('roomPick').innerHTML = ids.map(id => `
    <div class="mradio${id === roomId ? ' on' : ''}" data-r="${id}">
      <i class="fa-solid ${id === 'maze' ? 'fa-flag-checkered' : id === 'custom' ? 'fa-pen' : 'fa-house'}"></i>
      <span class="nm">${roomLabel(id)}</span><span class="mt">${ROOMS[id]?.unseen ? T('시험용') : ''}</span></div>`).join('');
  $('roomPick').querySelectorAll('.mradio').forEach(el => el.addEventListener('click', () => {
    if (running) stop();
    roomId = el.dataset.r; resetSim(); renderRooms();
    if (ROOMS[roomId]?.unseen && agent) setStep(3);
  }));
  $('panTitle').textContent = roomLabel(roomId);
}
function resetSim() { sim = new Sim(rooms[roomId], null, { useCompass: useCompass() }); draw(); badges(); }

const cv = $('roomCv');
let cell = 30;
function sizeCanvas() {
  const w = $('roomBox').clientWidth; if (!w) return;
  cell = Math.floor(w / W);
  const dpr = devicePixelRatio || 1;
  cv.style.width = cell * W + 'px'; cv.style.height = cell * H + 'px';
  cv.width = cell * W * dpr; cv.height = cell * H * dpr;
  draw();
}
new ResizeObserver(sizeCanvas).observe($('roomBox'));

cv.addEventListener('pointerdown', e => {
  if (!$('editRoom').checked) return;
  if (running) stop();
  const r = cv.getBoundingClientRect();
  const x = Math.floor((e.clientX - r.left) / (r.width / W)), y = Math.floor((e.clientY - r.top) / (r.height / H));
  if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) return;
  if (roomId !== 'custom') { rooms.custom = rooms[roomId].slice(); roomId = 'custom'; }
  const g = rooms.custom;
  g[y * W + x] = g[y * W + x] ? 0 : 1;
  if (sim.x === x && sim.y === y) g[y * W + x] = 0;       // 청소기 자리는 비워 둔다
  resetSim(); renderRooms();
});

// ── 청소기 고르기 ───────────────────────────────────────────
const BOT_HINT = {
  bounce: '곧게 가다가 부딪히면 아무 쪽으로 돌아요.',
  zigzag: '가로로 끝까지 간 뒤 한 칸 내려와 반대로 가요.',
  wall: '오른쪽 벽을 손으로 짚듯 따라가요.',
  learn: '규칙 없이, 상과 벌점으로 스스로 배워요. 먼저 연습시켜요.',
};
function renderBots() {
  const ids = [...Object.keys(RULES), 'learn'];
  $('botPick').innerHTML = ids.map(id => `
    <div class="mradio${id === bot ? ' on' : ''}" data-b="${id}">
      <i class="fa-solid ${id === 'learn' ? 'fa-graduation-cap' : 'fa-list-ol'}"></i>
      <span class="nm">${T(id === 'learn' ? '배우는 청소기' : RULES[id].label)}</span>
      <span class="mt">${id === 'learn' ? (agent ? T('연습함') : T('연습 전')) : T('규칙')}</span></div>`).join('');
  $('botPick').querySelectorAll('.mradio').forEach(el => el.addEventListener('click', () => {
    if (running) stop();
    bot = el.dataset.b; renderBots(); resetSim();
    if (bot === 'learn') setStep(Math.max(2, curStep()));
  }));
  $('botHint').textContent = T(BOT_HINT[bot]);
  $('thinkSec').style.display = bot === 'learn' && agent ? '' : 'none';
}
const curStep = () => [1, 2, 3].find(i => $('s' + i).classList.contains('on')) || 1;

// ── 시합 ────────────────────────────────────────────────────
$('raceBtn').addEventListener('click', () => {
  if (bot === 'learn' && !agent) { toast(T('먼저 연습하기를 눌러 주세요')); return; }
  if (running) stop();
  raceRnd = seeded((Math.random() * 1e9) | 0);
  resetSim();
  botImpl = bot === 'learn' ? agent.policy(raceRnd) : RULES[bot].make(raceRnd);
  running = true; $('raceBtn').disabled = true; $('stopBtn').disabled = false;
  lastT = performance.now(); acc = 0;
  requestAnimationFrame(loop);
});
$('stopBtn').addEventListener('click', stop);
$('speedSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  stepsPerSec = +b.dataset.s;
  $('speedSeg').querySelectorAll('button').forEach(o => o.classList.toggle('on', o === b));
}));
function stop() { running = false; $('raceBtn').disabled = false; $('stopBtn').disabled = true; }

let lastT = 0, acc = 0;
function loop(now) {
  if (!running) return;
  acc += Math.min(0.25, (now - lastT) / 1000); lastT = now;   // 탭을 잠깐 떠났다 와도 한꺼번에 몰아 달리지 않게
  const per = 1 / stepsPerSec;
  while (acc >= per && running) {
    acc -= per;
    botImpl.after(sim.act(botImpl.pick(sim)));
    if (sim.steps >= RACE_STEPS || sim.cleaned >= sim.floor) { finish(); break; }
  }
  draw(); badges(); think();
  if (running) requestAnimationFrame(loop);
}
function finish() {
  stop();
  logRows.unshift({
    bot: bot === 'learn' ? T('배우는 청소기') : T(RULES[bot].label),
    extra: bot === 'learn' ? agentInfo : '',
    room: roomLabel(roomId), cov: sim.coverage, bumps: sim.bumps, steps: sim.steps,
  });
  logRows.length = Math.min(logRows.length, 10);
  $('log').innerHTML = `<table class="mk-table exam">
    <tr><th>${T('청소기')}</th><th>${T('방')}</th><th>${T('치운 비율')}</th><th>${T('부딪힘')}</th></tr>
    ${logRows.map(r => `<tr><td class="nm">${esc(r.bot)}${r.extra ? `<div class="sub">${esc(r.extra)}</div>` : ''}</td>
      <td class="nm">${esc(r.room)}</td><td class="num${r.cov < 0.6 ? ' low' : ''}">${Math.round(r.cov * 100)}%</td>
      <td class="num">${r.bumps}</td></tr>`).join('')}
  </table>`;
}
function badges() {
  $('stepBadge').textContent = `${sim.steps}${T('걸음')}`;
  $('covBadge').textContent = `${Math.round(sim.coverage * 100)}%`;
  $('bumpBadge').textContent = `${T('부딪힘')} ${sim.bumps}`;
}

// 배우는 청소기의 생각: 지금 상태에서 네 가지 할 일의 점수
const CELL_NAME = ['벽', '깨끗', '먼지'];
const COMPASS_NAME = ['앞', '왼쪽', '오른쪽', '뒤', '없음'];
function think() {
  if (bot !== 'learn' || !agent) return;
  const s = sim.state(), q = agent.values(s), best = agent.best(s);
  const mn = Math.min(...q), mx = Math.max(...q), span = mx - mn || 1;
  $('think').innerHTML = q.map((v, a) => `
    <div class="bar${a === best ? ' top' : ''}"><div class="bl"><span><i class="fa-solid ${ACT_ICON[a]}"></i> ${T(ACT_LABEL[a])}</span>
      <span class="num">${v.toFixed(2)}</span></div>
      <div class="bt"><div class="bf" style="width:${((v - mn) / span * 100).toFixed(0)}%"></div></div></div>`).join('');
  const f = sim.cell(sim.dir), l = sim.cell((sim.dir + 3) % 4), r = sim.cell((sim.dir + 1) % 4);
  $('senseLine').textContent = `${T('청소기가 보는 것')}: ${T('앞')} ${T(CELL_NAME[f])} · ${T('왼쪽')} ${T(CELL_NAME[l])} · ${T('오른쪽')} ${T(CELL_NAME[r])} · ${T('먼지 나침반')} ${useCompass() ? T(COMPASS_NAME[sim.compass()]) : T('꺼짐')}`;
}

// ── 연습 ────────────────────────────────────────────────────
for (const [id, out, fmt] of [['rClean', 'rCleanVal', v => '+' + v], ['rStep', 'rStepVal', v => (v > 0 ? '+' : '') + v], ['rBump', 'rBumpVal', v => v]]) {
  $(id).addEventListener('input', () => { $(out).textContent = fmt(+(+$(id).value).toFixed(2)); });
}
$('compass').addEventListener('change', () => { if (!running) resetSim(); if (agent) setStep(3); });
$('manyRooms').addEventListener('change', () => { if (agent) setStep(3); });

$('trainBtn').addEventListener('click', async () => {
  if (running) stop();
  $('trainBtn').disabled = true;
  const ag = new QAgent(), rw = reward(), comp = useCompass(), many = $('manyRooms').checked;
  const rnd = seeded((Math.random() * 1e9) | 0), home = rooms[roomId];
  curve = []; let avg = null;
  for (let e = 0; e < EPISODES; e++) {
    const g = many ? randomRoom(rnd) : home;
    const floors = []; for (let i = 0; i < W * H; i++) if (!g[i]) floors.push(i);
    const i = floors[(rnd() * floors.length) | 0];
    const r = ag.episode(g, rw, { rnd, useCompass: comp, start: [i % W, (i / W) | 0, (rnd() * 4) | 0], eps: Math.max(0.05, 0.3 * (1 - e / EPISODES)) });
    avg = avg === null ? r.coverage : 0.9 * avg + 0.1 * r.coverage;
    if (e % 10 === 9) {
      curve.push(avg);
      const pct = Math.round((e + 1) / EPISODES * 100);
      $('prgFill').style.width = pct + '%'; $('prgPct').textContent = pct + '%';
      drawChart();
      await new Promise(r2 => requestAnimationFrame(r2));
    }
  }
  agent = ag;
  const bits = [`${T('청소')}${rw.clean >= 0 ? '+' : ''}${rw.clean}`, `${T('걸음')}${rw.step > 0 ? '+' : ''}${rw.step}`, `${T('부딪힘')}${rw.bump}`];
  if (!comp) bits.push(T('나침반 끔'));
  bits.push(many ? T('여러 방') : roomLabel(roomId));
  agentInfo = bits.join(' · ');
  $('prgPct').textContent = '';
  $('prgLabel').textContent = `${T('연습 끝')} · ${agentInfo}`;
  $('trainBtn').disabled = false;
  bot = 'learn'; renderBots(); resetSim();
  setStep(Math.max(2, curStep()));
  toast(T('연습을 마쳤어요. 시합을 해 봐요'));
});

function drawChart() {
  const c = $('chart'), dpr = devicePixelRatio || 1, Wc = c.clientWidth, Hc = c.clientHeight;
  if (!Wc || !Hc) return;
  c.width = Wc * dpr; c.height = Hc * dpr;
  const g = c.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, Wc, Hc);
  if (curve.length < 2) return;
  g.strokeStyle = css('--acc'); g.lineWidth = 2; g.beginPath();
  const n = EPISODES / 10;
  curve.forEach((v, i) => { const x = 6 + i / (n - 1) * (Wc - 12), y = Hc - 6 - v * (Hc - 12); i ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.stroke();
}

// ── 그리기 ──────────────────────────────────────────────────
function draw() {
  if (!cv.width) return;
  const g = cv.getContext('2d'), dpr = devicePixelRatio || 1;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const room = rooms[roomId];
  const wall = css('--ink2'), dirt = css('--line-soft'), clean = css('--panel'), grid = css('--line-soft');
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    g.fillStyle = room[i] ? wall : sim.dirty[i] ? dirt : clean;
    g.fillRect(x * cell, y * cell, cell, cell);
    if (!room[i] && sim.dirty[i]) {                      // 먼지 점 몇 개
      g.fillStyle = css('--line');
      for (const [ox, oy] of [[0.3, 0.35], [0.65, 0.6], [0.4, 0.72]]) g.fillRect(x * cell + ox * cell, y * cell + oy * cell, 2, 2);
    }
  }
  g.strokeStyle = grid; g.lineWidth = 1;
  for (let x = 0; x <= W; x++) { g.beginPath(); g.moveTo(x * cell + 0.5, 0); g.lineTo(x * cell + 0.5, H * cell); g.stroke(); }
  for (let y = 0; y <= H; y++) { g.beginPath(); g.moveTo(0, y * cell + 0.5); g.lineTo(W * cell, y * cell + 0.5); g.stroke(); }
  // 청소기: 동그라미 + 앞쪽 표시
  const cx = (sim.x + 0.5) * cell, cy = (sim.y + 0.5) * cell, [dx, dy] = DIRS[sim.dir];
  g.fillStyle = bot === 'learn' ? css('--ok') : css('--acc');
  g.beginPath(); g.arc(cx, cy, cell * 0.38, 0, Math.PI * 2); g.fill();
  g.fillStyle = css('--panel');
  g.beginPath(); g.arc(cx + dx * cell * 0.2, cy + dy * cell * 0.2, cell * 0.1, 0, Math.PI * 2); g.fill();
}

// ── 시작 ────────────────────────────────────────────────────
$('engine').textContent = T('인터넷 없이 이 컴퓨터에서 배워요');
renderRooms(); renderBots(); sizeCanvas(); badges();
