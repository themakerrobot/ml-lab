// ═══════════════════════════════════════════════════════════
// 운전 활동 — 화면 로직
// ═══════════════════════════════════════════════════════════
// 흐름: 내가 운전(센서 + 내가 고른 운전을 기록) → 배우기 → AI 운전 → 새 트랙 · 대회 트랙에서 시험
// AI가 운전하는 중에 내가 키를 누르면 내 운전이 이기고, 그 장면도 기록된다
// (고쳐 가르치기 — 모방학습의 DAgger 와 같은 생각). 대회 트랙에서는 끼어들 수 없다.
//
// 초급: 방향만 (센서 7개 → 왼쪽 · 곧게 · 오른쪽), 차는 늘 1배.
// 고급: 방향 + 빠르기 (센서 7개 + 빠르기 → 방향 3 · 빠르기 3). edge-lab 자동차 가르치기와 같은 계산.
// 두 모드는 AI 가 보는 숫자 개수가 달라(7 · 8) 모은 운전 · AI · 기록을 따로 가진다.

import { TRACKS, CONTEST, WORLD_W, WORLD_H, buildTrack, centerline } from './track.js?v=8';
import { Car, RAY_DEG, RAY_MAX, DT, drive as raceDrive } from './sim.js?v=8';
import { Policy, savePolicy, loadPolicy } from './policy.js?v=7';

const T = s => (typeof GL_T === 'function' ? GL_T(s) : s);
const $ = id => document.getElementById(id);

const RECORD_EVERY = 3;        // 3번 움직일 때마다 한 장면 기록 (초당 20장)
// 사람은 보고 나서 키를 누르기까지 0.1~0.3초 걸린다. 그래서 "지금 누른 키"를
// "지금 센서"가 아니라 "조금 전 센서"와 짝지어 기록한다. 그러지 않으면 AI는
// 늘 한 박자 늦게 도는 법을 배워서 곧 부딪힌다 (DEVELOP.md 의 잰 결과 참고).
const REACT_STEPS = 6;         // 6걸음 = 0.1초
const AI_LAPS = 3;             // AI는 3바퀴 돌면 완주
const EPOCHS = 60;
const MIN_SAMPLES = 30;
// 왼쪽·오른쪽으로 도는 장면이 각각 이만큼은 있어야 처음 보는 트랙에서도 잘 돈다.
// 사람처럼 늦게 반응하는 가상 학생으로 재 보니 바퀴 수보다 이 균형이 중요했다:
// 둥근 트랙만 돌며 왼쪽이 6~15장면이면 다른 트랙에서 곧 부딪혔고,
// 양쪽이 각각 30장면을 넘으면 구불구불 트랙 반 바퀴로도 24개 코스를 모두 돌았다.
// 다만 쉬운 트랙(둥근·경기장)만 양방향으로 돌면 양쪽 장면은 넉넉해도 급한 커브를
// 못 배워 산길·콩 트랙에서 부딪혔다 — 그래서 쉬운 트랙에서만 모았으면 따로 알려 준다.
const READY_TURNS = 30;
const READY_THR = 20;          // 고급: 가속 · 감속 장면도 각각 이만큼
const ACT_LABEL = ['왼쪽', '곧게', '오른쪽'];
const ACT_ICON = ['fa-arrow-left', 'fa-arrow-up', 'fa-arrow-right'];
const THR_LABEL = ['감속', '그대로', '가속'];
const THR_ICON = ['fa-angles-down', 'fa-equals', 'fa-angles-up'];
const LEVEL_LABEL = ['', '쉬움', '보통', '어려움'];

// ── 상태 ────────────────────────────────────────────────────
// 트랙 번호: 0~11 연습 트랙(TRACKS), 12~14 대회 트랙(CONTEST)
const ALL = [...TRACKS, ...CONTEST];
const isRace = i => !!ALL[i].contest;
// 트랙은 고를 때 만든다 (마스크 만들기가 무거워서 처음에 다 만들지 않는다)
const builtCache = new Map();
function getTrack(i, rev) {
  const key = i + (rev ? 'r' : 'f');
  if (!builtCache.has(key)) builtCache.set(key, buildTrack(ALL[i], rev));
  return builtCache.get(key);
}
let trackIdx = 0, reverse = false;
let track = getTrack(0, false);
const car = new Car(track);

const newMode = () => ({ data: { X: [], Y: [], L: [] }, policy: null, lastAcc: null, hist: [], runs: [], trainedOn: 0, race: null });
const MODES = { basic: newMode(), pro: newMode() };
let mode = 'basic', M = MODES.basic;
const pro = () => mode === 'pro';
const race = () => isRace(trackIdx);
const sense = () => (pro() ? car.sense2() : car.sense());

let who = 'me';                 // 'me' | 'ai'
let running = false, fast = false, training = false, racing = false;
let tick = 0;
const keys = { left: false, right: false, up: false, down: false };
let lastSense = car.sense(), lastAction = 1, lastByMe = false, cutIns = 0;
let senseHist = [];             // 최근 센서값 (REACT_STEPS+1 개까지)

// ── 도우미 ──────────────────────────────────────────────────
let toastTimer = 0;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2400);
}
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function setStep(n) {
  for (let i = 1; i <= 4; i++) {
    $('s' + i).classList.toggle('on', i === n);
    $('s' + i).classList.toggle('done', i < n);
  }
}
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
const f1 = v => (+v).toFixed(1);
const trackName = (t = track) => T(t.def.label) + (t.reverse ? ` (${T('거꾸로')})` : '');
const curStep = () => [1, 2, 3, 4].find(i => $('s' + i).classList.contains('on')) || 1;

// 같은 씨앗이면 늘 같은 수 — 풀 자리가 그릴 때마다 바뀌지 않게
function seeded(str) {
  let s = 0;
  for (const ch of str) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// ── 초급 · 고급 ─────────────────────────────────────────────
function paintMode() {
  $('modeSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  $('modeHint').textContent = pro()
    ? T('방향과 빠르기를 함께 가르쳐요. ↑ 가속 · ↓ 감속. 빠를수록 크게 돌아서, 커브 앞에서 줄여야 해요.')
    : T('방향만 가르쳐요. 차는 늘 같은 빠르기로 달려요.');
  $('dataTip').textContent = pro()
    ? T('직선에서 가속, 커브 앞에서 감속하는 장면을 골고루 보여 주세요. 감속을 안 보여 주면 AI도 안 줄여요.')
    : T('바퀴 수보다 왼쪽·오른쪽으로 도는 장면이 골고루 있는 게 중요해요. 둥근 트랙은 한쪽으로만 돌아요.');
  $('keyHint').textContent = pro()
    ? T('← → 방향 · ↑ ↓ 가속/감속 (W A S D 도 돼요). 아무것도 안 누르면 곧게 · 그대로 가요.')
    : T('← → 키로 운전해요. 아무것도 안 누르면 곧게 가요.');
  $('sensTitle').textContent = pro() ? T('AI가 보는 숫자 — 센서 7개 + 빠르기') : T('AI가 보는 숫자 — 센서 7개');
  $('padsUD').hidden = !pro();
}
$('modeSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  const m = b.dataset.mode;
  if (m === mode || training || racing) return;
  if (running) stop();
  mode = m; M = MODES[mode];
  if (who === 'ai' && !M.policy && !race()) who = 'me';
  car.reset(track); lastSense = sense(); overlay('');
  setStep(M.policy ? 3 : 1);
  paintMode(); paintTrain(); paintWho(); refreshCounts(); paintRuns(); paintRace(); refreshLive(); drawChart(); draw();
}));

// ── 트랙 고르기 (미니 그림 카드) ────────────────────────────
function drawThumb(c, def) {
  const g = c.getContext('2d'), sc = c.width / WORLD_W;
  g.fillStyle = css('--ok-soft'); g.fillRect(0, 0, c.width, c.height);
  g.setTransform(sc, 0, 0, sc, 0, 0);
  const pts = centerline(def);
  g.beginPath();
  pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y));
  g.closePath();
  g.lineJoin = 'round';
  g.strokeStyle = css('--line'); g.lineWidth = def.width + 16; g.stroke();
  g.strokeStyle = css('--line-soft'); g.lineWidth = def.width; g.stroke();
  const [x0, y0] = pts[0], th = Math.atan2(pts[1][1] - y0, pts[1][0] - x0);
  g.strokeStyle = css('--ink'); g.lineWidth = 14;
  g.beginPath();
  g.moveTo(x0 - Math.sin(th) * def.width / 2, y0 + Math.cos(th) * def.width / 2);
  g.lineTo(x0 + Math.sin(th) * def.width / 2, y0 - Math.cos(th) * def.width / 2);
  g.stroke();
}
ALL.forEach((def, i) => {
  const el = document.createElement('div');
  el.className = 'tcard' + (i === 0 ? ' on' : '');
  const tag = def.contest ? `<i class="fa-solid fa-trophy"></i> ${T('대회')} · `
    : def.unseen ? `<i class="fa-solid fa-flag-checkered"></i> ${T('시험용')} · ` : '';
  el.innerHTML = `<canvas width="160" height="104"></canvas>
    <div class="tn"><span>${T(def.label)}</span></div>
    <div class="tl${def.unseen || def.contest ? ' test' : ''}">${tag}${T(LEVEL_LABEL[def.level])}</div>`;
  el.addEventListener('click', () => { if (!racing) pickTrack(i, reverse); });
  $(def.contest ? 'contestPick' : 'trackPick').appendChild(el);
  drawThumb(el.querySelector('canvas'), def);
});
$('dirSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  if (race() || racing) return;
  pickTrack(trackIdx, b.dataset.r === '1');
}));
const allCards = () => [...$('trackPick').children, ...$('contestPick').children];
// 대회 트랙은 기본 방향만 (거꾸로 없음 — 방향 고르기를 숨긴다). 연습 트랙에서 고른 방향은 기억해 둔다.
function pickTrack(i, rev) {
  if (running) stop();
  trackIdx = i;
  if (!isRace(i)) reverse = rev;
  track = getTrack(i, isRace(i) ? false : reverse);
  car.reset(track);
  if (race()) who = 'ai';                       // 대회 트랙은 AI 만
  allCards().forEach((el, j) => el.classList.toggle('on', j === i));
  $('dirSeg').querySelectorAll('button').forEach(o => o.classList.toggle('on', (o.dataset.r === '1') === reverse));
  $('dirBox').hidden = race();
  $('panTitle').textContent = trackName();
  if ((track.def.unseen || race()) && M.policy) setStep(4);
  roadCache = null;
  overlay('');
  paintWho();
  refreshLive();
  draw();
}

// ── 누가 운전할까 ───────────────────────────────────────────
function paintWho() {
  $('whoSeg').querySelectorAll('button').forEach(b => {
    b.classList.toggle('on', b.dataset.who === who);
    b.disabled = race() && b.dataset.who === 'me';
  });
  $('whoHint').textContent = race()
    ? T('대회 트랙에서는 AI만 달려요. 끼어들 수 없어요 — 연습 트랙에서 가르친 실력 그대로예요.')
    : who === 'me' ? T('내가 운전하는 동안 AI가 보고 배워요.')
    : T('AI가 운전해요. 키를 누르면 내가 끼어들어 고쳐 가르쳐요.');
}
$('whoSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  if (b.disabled) return;
  if (b.dataset.who === 'ai' && !M.policy) { toast(T('먼저 배우기를 해 주세요')); return; }
  if (running) stop();
  who = b.dataset.who;
  car.reset(track); overlay(''); paintWho(); draw();
}));

// ── 모은 운전 ───────────────────────────────────────────────
function bars(c, labels, icons) {
  const max = Math.max(1, ...c);
  return c.map((n, k) => `
    <div class="bar"><div class="bl"><span><i class="fa-solid ${icons[k]}"></i> ${T(labels[k])}</span>
      <span class="num">${n}</span></div>
      <div class="bt"><div class="bf" style="width:${n / max * 100}%"></div></div></div>`).join('');
}
function refreshCounts() {
  const { Y, L } = M.data, c = [0, 0, 0], v = [0, 0, 0];
  Y.forEach(y => { c[y % 3]++; v[(y / 3) | 0]++; });
  $('counts').innerHTML = pro()
    ? `<div class="grp">${T('방향')}</div>${bars(c, ACT_LABEL, ACT_ICON)}<div class="grp">${T('빠르기')}</div>${bars(v, THR_LABEL, THR_ICON)}`
    : bars(c, ACT_LABEL, ACT_ICON);
  $('totalCnt').textContent = T('모두 {n}장면').replace('{n}', Y.length);
  $('trainBtn').disabled = training || racing || Y.length < MIN_SAMPLES;
  // 언제 배우기를 누르면 되나 — 도는 장면이 양쪽 다 충분한지, (고급) 가속·감속도 있는지, 급한 커브도 보여 줬는지
  const need = [0, 2].filter(k => c[k] < READY_TURNS).map(k => T('{dir}으로 도는 장면이 더 필요해요 ({n}/{need})')
    .replace('{dir}', T(ACT_LABEL[k])).replace('{n}', c[k]).replace('{need}', READY_TURNS));
  if (pro()) need.push(...[0, 2].filter(k => v[k] < READY_THR).map(k => T('{thr} 장면이 더 필요해요 ({n}/{need})')
    .replace('{thr}', T(THR_LABEL[k])).replace('{n}', v[k]).replace('{need}', READY_THR)));
  const r = $('readyHint');
  if (!Y.length) { r.className = 'ready'; r.textContent = T('운전을 시작하면 장면이 쌓여요.'); }
  else if (need.length) { r.className = 'ready'; r.textContent = need.join(' '); }
  else if (Math.max(...L) < 2) {
    r.className = 'ready';
    r.textContent = T('양쪽 장면은 넉넉해요. 그런데 쉬운 트랙에서만 모았어요 — 커브가 급한 트랙(보통·어려움)에서도 조금 보여 주세요.');
  } else { r.className = 'ready ok'; r.textContent = T('양쪽으로 도는 장면이 넉넉해요. 배우기를 눌러 봐요!'); }
}
$('clearBtn').addEventListener('click', () => {
  if (!M.data.Y.length || !confirm(T('보여 준 운전을 모두 지울까요?'))) return;
  M.data.X = []; M.data.Y = []; M.data.L = []; refreshCounts();
});

// ── 운전 입력 (키보드 · 화면 버튼) ──────────────────────────
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
};
const typing = e => e.target && e.target.matches && e.target.matches('input,textarea,select');
addEventListener('keydown', e => {
  if (typing(e) || e.ctrlKey || e.altKey || e.metaKey) return;
  if (KEYMAP[e.code]) { keys[KEYMAP[e.code]] = true; e.preventDefault(); }
  else if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) running ? stop() : go(); }
});
addEventListener('keyup', e => { if (KEYMAP[e.code]) keys[KEYMAP[e.code]] = false; });
const PADS = [['padL', 'left'], ['padR', 'right'], ['padU', 'up'], ['padD', 'down']];
addEventListener('blur', () => {
  for (const [id, k] of PADS) { keys[k] = false; $(id).classList.remove('on'); }
});
for (const [id, k] of PADS) {
  const b = $(id);
  const on = e => { e.preventDefault(); keys[k] = true; b.classList.add('on'); };
  const off = () => { keys[k] = false; b.classList.remove('on'); };
  b.addEventListener('pointerdown', on);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, off));
}
// 내가 고른 운전: 초급 0~2, 고급 빠르기 × 3 + 방향 (아무것도 안 누르면 곧게 · 그대로)
function myAction() {
  const dir = keys.left && !keys.right ? 0 : keys.right && !keys.left ? 2 : 1;
  if (!pro()) return dir;
  const thr = keys.up && !keys.down ? 2 : keys.down && !keys.up ? 0 : 1;
  return thr * 3 + dir;
}
const pressing = () => keys.left !== keys.right || (pro() && keys.up !== keys.down);

// ── 달리기 ──────────────────────────────────────────────────
function go() {
  if (training || racing) return;
  if (who === 'ai' && !M.policy) { toast(T('먼저 배우기를 해 주세요')); return; }
  if (car.crashed || (who === 'ai' && car.progress >= AI_LAPS)) car.reset(track);
  senseHist = [];
  if (car.progress === 0) cutIns = 0;
  running = true; overlay('');
  $('goBtn').disabled = true; $('stopBtn').disabled = false;
  if (who === 'me') setStep(Math.max(1, curStep()));
  if (who === 'ai') setStep(track.def.unseen || race() ? 4 : 3);
  last = performance.now(); acc = 0;
  requestAnimationFrame(loop);
}
function stop() {
  running = false;
  $('goBtn').disabled = training || racing; $('stopBtn').disabled = true;
}
$('goBtn').addEventListener('click', go);
$('stopBtn').addEventListener('click', stop);
// 빨리 감기: AI 가 운전할 때만 한 프레임에 걸음을 3배로 돌린다. 물리 · 기록 · 바퀴 시간(게임 시간)은 그대로
$('fastBtn').addEventListener('click', () => { fast = !fast; $('fastBtn').classList.toggle('on', fast); });
// 보기 속도: 게임 시간을 느리게 흘린다. 차의 물리·센서·학습은 그대로라 배운 AI도 똑같이 달린다.
// (0.35~1배 모두에서 "0.1초 전 센서와 짝짓기(6걸음)" 로 배운 AI가 완주하는 것을 확인했다 — DEVELOP.md)
let speed = 0.55;
$('speedSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  speed = +b.dataset.s;
  $('speedSeg').querySelectorAll('button').forEach(o => o.classList.toggle('on', o === b));
}));

let last = 0, acc = 0;
function loop(now) {
  if (!running) return;
  acc += Math.min(0.1, (now - last) / 1000) * speed; last = now;
  const mult = who === 'ai' && fast ? 3 : 1;
  let n = 0;
  while (acc >= DT && n < 12 * mult) {
    for (let m = 0; m < mult && running; m++) stepOnce();
    acc -= DT; n++;
  }
  refreshLive(); draw();
  if (running) requestAnimationFrame(loop);
}

function stepOnce() {
  const s = sense();
  senseHist.push(s);
  if (senseHist.length > REACT_STEPS + 1) senseHist.shift();
  let a, byMe;
  // 대회 트랙에서는 끼어들 수 없다 — 키를 눌러도 AI 가 운전하고, 장면도 모이지 않는다
  if (who === 'me' || (pressing() && !race())) { a = myAction(); byMe = true; }
  else { a = M.policy.act(s); byMe = false; }
  if (byMe && tick % RECORD_EVERY === 0) {
    M.data.X.push(senseHist[0]); M.data.Y.push(a);     // 0.1초 전 장면 + 지금 누른 키
    M.data.L.push(track.def.level);
    if (who === 'ai') cutIns++;
    refreshCounts();
  }
  tick++;
  lastSense = s; lastAction = a; lastByMe = byMe;
  if (pro() ? car.step2(a) : car.step(a)) {
    stop();
    overlay(`<i class="fa-solid fa-car-burst"></i> ${T('쾅! 길 밖으로 나갔어요')}`, 'bad');
    if (who === 'ai') logRun(false);
  } else if (who === 'ai' && car.progress >= AI_LAPS) {
    stop();
    const lt = car.lapTimes();
    overlay(`<i class="fa-solid fa-flag-checkered"></i> ${pro()
      ? T('{n}바퀴 완주! 가장 빠른 바퀴 {t}초').replace('{n}', AI_LAPS).replace('{t}', f1(Math.min(...lt)))
      : AI_LAPS + T('바퀴 완주!')}`, 'good');
    logRun(true);
  }
}

// ── AI 운전 기록 ────────────────────────────────────────────
function logRun(done) {
  const lt = car.lapTimes();
  M.runs.unshift({
    name: trackName(), done, prog: Math.max(0, car.progress), cutIns,
    best: lt.length ? Math.min(...lt) : null,
    avg: lt.length ? lt.reduce((a, b) => a + b, 0) / lt.length : null, vMax: car.vMax,
  });
  M.runs.length = Math.min(M.runs.length, 6);
  paintRuns();
}
function runText(r) {
  const parts = [r.done ? T('완주') : `${f1(r.prog)}${T('바퀴에서 멈춤')}`];
  if (r.best != null) parts.push(T('가장 빠른 바퀴 {t}초').replace('{t}', f1(r.best)));
  if (r.avg != null && r.done) parts.push(T('평균 {t}초').replace('{t}', f1(r.avg)));
  if (pro()) parts.push(T('최고 속도 {v}배').replace('{v}', f1(r.vMax)));
  if (r.cutIns) parts.push(`${T('끼어들기')} ${r.cutIns}`);
  return parts.join(' · ');
}
function paintRuns() {
  $('runLog').innerHTML = M.runs.length ? M.runs.map(r => `
    <div class="saved"><i class="fa-solid ${r.done ? 'fa-flag-checkered' : 'fa-car-burst'}" style="color:var(${r.done ? '--ok' : '--warn'})"></i>
      <span class="nm">${r.name}</span>
      <span class="mt">${runText(r)}</span></div>`).join('')
    : `<div class="hint" style="margin-top:0">${T('아직 없어요')}</div>`;
}

// ── 배우기 ──────────────────────────────────────────────────
function paintTrain() {
  $('saveAiBtn').disabled = !M.policy || training;
  $('loadAiBtn').disabled = training || racing;
  $('raceBtn').disabled = !M.policy || training || racing;
  $('raceBtn').innerHTML = `<i class="fa-solid fa-trophy"></i> ${racing ? T('달리는 중…') : T('대회 트랙 3개 달리기')}`;
  if (training) return;
  $('prgFill').style.width = M.policy ? '100%' : '0%'; $('prgPct').textContent = '';
  $('prgLabel').textContent = M.policy ? `${T('다 배웠어요')} · ${T('맞힌 비율')} ${M.lastAcc}%` : T('아직 안 배웠어요');
  $('trainHint').textContent = M.policy
    ? T('장면 {n}개로 배웠어요.').replace('{n}', M.trainedOn) + ' ' + T('이제 AI에게 운전을 맡겨 봐요.')
    : T('운전을 조금 보여 준 뒤에 눌러요.');
}
$('trainBtn').addEventListener('click', async () => {
  const Y = M.data.Y;
  if (new Set(Y.map(y => y % 3)).size < 2) { toast(T('왼쪽이나 오른쪽으로 도는 운전도 보여 주세요')); return; }
  if (pro() && new Set(Y.map(y => (y / 3) | 0)).size < 2) { toast(T('가속이나 감속하는 운전도 보여 주세요')); return; }
  if (running) stop();
  const m = M, isPro = pro();
  training = true; refreshCounts(); paintTrain(); $('goBtn').disabled = true;
  $('prgLabel').textContent = T('배우는 중'); setStep(2);
  const p = isPro ? new Policy(8, { heads: [3, 3] }) : new Policy();
  m.hist = [];
  const X = m.data.X.slice(), YY = Y.slice();
  let r;
  for (let e = 0; e < EPOCHS; e++) {
    r = p.fitEpoch(X, YY, { balance: isPro });   // 고급: 드문 행동(감속)에 무게
    m.hist.push(r);
    const pct = Math.round((e + 1) / EPOCHS * 100);
    $('prgFill').style.width = pct + '%'; $('prgPct').textContent = pct + '%';
    drawChart();
    if (e % 3 === 2) await nextFrame();
  }
  m.policy = p; m.trainedOn = X.length; m.lastAcc = Math.round(r.acc * 100); m.race = null;
  training = false; $('goBtn').disabled = running;
  refreshCounts(); paintTrain(); paintRace();
  setStep(3);
  refreshLive();
});

function drawChart() {
  const c = $('chart'), dpr = devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight;
  if (!W || !H) return;
  c.width = W * dpr; c.height = H * dpr;
  const g = c.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, W, H);
  const hist = M.hist;
  if (hist.length < 2) return;
  const maxL = Math.max(...hist.map(h => h.loss));
  const line = (vals, color) => {
    g.strokeStyle = color; g.lineWidth = 2; g.beginPath();
    vals.forEach((v, i) => {
      const x = 6 + i / (EPOCHS - 1) * (W - 12), y = H - 6 - v * (H - 12);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.stroke();
  };
  line(hist.map(h => h.acc), css('--acc'));
  line(hist.map(h => h.loss / maxL), css('--warn'));
}

// ── AI 파일 — 저장하면 다른 컴퓨터(edge-lab 포함)에서 불러와도 똑같이 운전한다 ──
$('saveAiBtn').addEventListener('click', () => {
  if (!M.policy) return;
  const now = new Date(), pad = n => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const o = savePolicy(M.policy, { mode, scenes: M.trainedOn, acc: M.lastAcc, saved: now.toISOString() });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(o)], { type: 'application/json' }));
  a.download = `car-ai-${mode}-${stamp}.json`;     // 이름은 영문 — 한글 이름을 버리는 브라우저가 있다
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$('loadAiBtn').addEventListener('click', () => { if (!training && !racing) $('aiFile').click(); });
$('aiFile').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    let o;
    try { o = JSON.parse(await f.text()); } catch { throw new Error('운전 AI 파일이 아니에요'); }
    const pol = loadPolicy(o), m = pol.nIn === 8 ? 'pro' : 'basic';
    if (o.mode && o.mode !== m) throw new Error('운전 AI 파일이 아니에요');
    if (running) stop();
    Object.assign(MODES[m], {
      policy: pol, trainedOn: o.scenes | 0, lastAcc: Number.isFinite(o.acc) ? o.acc : '—', hist: [], race: null,
    });
    mode = m; M = MODES[m];
    car.reset(track); lastSense = sense(); overlay('');
    setStep(3);
    paintMode(); paintTrain(); paintWho(); refreshCounts(); paintRuns(); paintRace(); refreshLive(); drawChart(); draw();
    toast(T('{mode} AI를 불러왔어요 (장면 {n}개로 배운 것)').replace('{mode}', T(m === 'pro' ? '고급' : '초급')).replace('{n}', M.trainedOn));
  } catch (err) {
    const msg = T(err.message || '운전 AI 파일이 아니에요') + (err.part ? ` (${err.part})` : '');
    toast(`${T('불러오지 못했어요')}: ${msg}`);
  }
});

// ── 대회 — 대회 트랙 3개를 화면 없이 AI 만 3바퀴씩. 트랙 하나마다 화면에 한 번 돌려준다 ──
$('raceBtn').addEventListener('click', () => {
  if (!M.policy || training || racing) return;
  if (running) stop();
  racing = true; paintTrain(); refreshCounts(); $('goBtn').disabled = true;
  const m = M, md = mode, out = [];
  let k = 0;
  const next = () => {
    if (k < CONTEST.length) {
      out.push({ name: T(CONTEST[k].label), r: raceDrive(getTrack(TRACKS.length + k, false), m.policy, md, AI_LAPS) });
      k++; setTimeout(next, 0); return;
    }
    m.race = out; racing = false; $('goBtn').disabled = running;
    paintTrain(); refreshCounts(); paintRace();
  };
  setTimeout(next, 0);
});
function paintRace() {
  const b = $('raceBoard');
  $('raceHint').textContent = M.race
    ? (pro() ? T('순위: 완주가 많을수록 · 같으면 걸린 시간 합이 짧을수록') : T('순위: 간 거리가 길수록 · 같으면 배운 장면이 적을수록'))
    : T('대회 트랙마다 AI만 3바퀴 달려요. 같은 AI면 어느 컴퓨터에서 해도 결과가 같아요.');
  if (!M.race) { b.innerHTML = M.policy ? '' : `<div class="hint" style="margin-top:0">${T('AI를 배운 뒤 눌러 봐요.')}</div>`; return; }
  const rows = M.race.map(({ name, r }) => {
    let txt = r.ok ? T('완주') : `${f1(r.prog)}${T('바퀴에서 멈춤')}`;
    if (pro() && r.ok) txt += ` · ${T('{n}초').replace('{n}', f1(r.t))} · ${T('가장 빠른 바퀴 {t}초').replace('{t}', f1(r.best))}`;
    if (pro()) txt += ` · ${T('최고 속도 {v}배').replace('{v}', f1(r.vMax))}`;
    return `<div class="saved"><i class="fa-solid ${r.ok ? 'fa-flag-checkered' : 'fa-car-burst'}" style="color:var(${r.ok ? '--ok' : '--warn'})"></i>
      <span class="nm">${name}</span><span class="mt">${txt}</span></div>`;
  }).join('');
  const rs = M.race.map(x => x.r), done = rs.filter(r => r.ok);
  const tot = pro()
    ? T('완주 {c} / 3 · 걸린 시간 합 {t}초 · 최고 속도 {v}배').replace('{c}', done.length)
      .replace('{t}', f1(done.reduce((a, r) => a + r.t, 0))).replace('{v}', f1(Math.max(...rs.map(r => r.vMax))))
    : T('간 거리 {p} / 9바퀴 · 배운 장면 {n}개').replace('{p}', f1(rs.reduce((a, r) => a + r.prog, 0))).replace('{n}', M.trainedOn);
  b.innerHTML = rows + `<div class="race-tot">${tot}</div>`;
}

// ── 오른쪽 실시간 패널 ─────────────────────────────────────
function group(P, off, labels, icons) {
  let best = 0;
  for (let k = 1; k < 3; k++) if (P[off + k] > P[off + best]) best = k;
  return labels.map((nm, k) => {
    const v = P[off + k];
    return `<div class="bar${k === best ? ' top' : ''}"><div class="bl">
      <span><i class="fa-solid ${icons[k]}"></i> ${T(nm)}</span><span class="num">${Math.round(v * 100)}%</span></div>
      <div class="bt"><div class="bf" style="width:${v * 100}%"></div></div></div>`;
  }).join('');
}
function refreshLive() {
  if (!running) lastSense = sense();
  $('sensors').innerHTML = lastSense.map((v, i) => `
    <div class="sensor"><span class="sn num">${i < RAY_DEG.length ? `${RAY_DEG[i] > 0 ? '+' : ''}${RAY_DEG[i]}°` : T('빠르기')}</span>
      <div class="bt"><div class="bf" style="width:${v * 100}%"></div></div>
      <span class="sv num">${v.toFixed(2)}</span></div>`).join('');
  if (!M.policy) { $('choice').innerHTML = `<div class="hint" style="margin-top:0">${T('배운 뒤에 보여요')}</div>`; return; }
  const P = M.policy.predict(lastSense);
  $('choice').innerHTML = (pro()
    ? `<div class="grp">${T('방향')}</div>${group(P, 0, ACT_LABEL, ACT_ICON)}<div class="grp">${T('빠르기')}</div>${group(P, 3, THR_LABEL, THR_ICON)}`
    : group(P, 0, ACT_LABEL, ACT_ICON))
    + (running && who === 'ai' && lastByMe ? `<div class="hint">${T('지금은 내가 끼어들어 운전 중이에요')}</div>` : '');
}

// ── 그리기 ──────────────────────────────────────────────────
// 색은 모두 디자인 토큰에서 가져온다: 잔디 --ok-soft, 길 --line-soft(옅은 회색), 가장자리 선 --line,
// 가운데 점선 --panel, 연석 --warn/--panel 줄무늬, 내 차 --acc, AI 차 --ok, 부딪힌 차 --warn.
// 그림은 꾸밈일 뿐 — 길 판정은 track.js 의 마스크(폭 = def.width)만 쓴다.
const cv = $('cv');
let roadCache = null, scale = 1;

function sizeCanvas() {
  const box = $('trackBox'), w = box.clientWidth, dpr = devicePixelRatio || 1;
  if (!w) return;                 // 아직 화면에 자리가 안 잡혔다 — ResizeObserver 가 다시 부른다
  const h = w * WORLD_H / WORLD_W;
  cv.style.height = h + 'px';
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  scale = cv.width / WORLD_W;
  roadCache = null;
}

// 트랙은 바뀔 때만 따로 그려 두고, 매 장면에는 복사만 한다 (저사양 PC 배려)
function renderRoad() {
  const c = document.createElement('canvas');
  c.width = cv.width; c.height = cv.height;
  const g = c.getContext('2d');
  const W = track.def.width, hw = track.hw;
  const rnd = seeded(track.def.id);
  // 잔디
  g.fillStyle = css('--ok-soft'); g.fillRect(0, 0, c.width, c.height);
  g.setTransform(scale, 0, 0, scale, 0, 0);
  g.strokeStyle = css('--ok'); g.lineWidth = 1; g.globalAlpha = 0.22;
  for (let k = 0; k < 260; k++) {
    const x = rnd() * WORLD_W, y = rnd() * WORLD_H;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x - 1.5, y - 4); g.moveTo(x, y); g.lineTo(x + 1.5, y - 4); g.stroke();
  }
  g.globalAlpha = 1;

  const path = () => {
    g.beginPath();
    track.pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y));
    g.closePath();
  };
  g.lineJoin = 'round'; g.lineCap = 'butt';
  // 연석: 흰 바탕 위에 빨간 줄무늬 → 길 양쪽에 빨강·흰색 띠
  path(); g.strokeStyle = css('--panel'); g.lineWidth = W + 10; g.stroke();
  path(); g.strokeStyle = css('--warn'); g.setLineDash([9, 9]); g.stroke(); g.setLineDash([]);
  // 길: 옅은 회색 — 진한 차(--acc)와 센서 선이 잘 보이게
  path(); g.strokeStyle = css('--line-soft'); g.lineWidth = W; g.stroke();
  // 가장자리 선: 회색 띠를 그리고 가운데를 다시 길 색으로 덮는다
  path(); g.strokeStyle = css('--line'); g.lineWidth = W - 5; g.stroke();
  path(); g.strokeStyle = css('--line-soft'); g.lineWidth = W - 8; g.stroke();
  // 가운데 점선
  path(); g.strokeStyle = css('--panel'); g.lineWidth = 2.5; g.setLineDash([14, 12]); g.stroke();
  g.setLineDash([]);

  // 출발선: 체크무늬 두 줄
  const [x0, y0] = track.pts[0], th = track.start.th;
  g.save(); g.translate(x0, y0); g.rotate(th);
  const sq = 5, rows = Math.ceil(W / sq);
  for (let j = 0; j < rows; j++) {
    for (let k = 0; k < 2; k++) {
      g.fillStyle = (j + k) % 2 ? css('--ink') : css('--panel');
      g.fillRect(-sq + k * sq, -hw + j * sq, sq, Math.min(sq, hw * 2 - j * sq));
    }
  }
  // 달리는 방향 화살표 (출발선 바로 앞)
  g.fillStyle = css('--line'); g.globalAlpha = 0.8;
  for (const ax of [22, 40]) {
    g.beginPath(); g.moveTo(ax + 7, 0); g.lineTo(ax - 3, -8); g.lineTo(ax - 3, 8); g.closePath(); g.fill();
  }
  g.restore();
  g.globalAlpha = 1;
  return c;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

// 차: 길이 24 · 폭 13 을 1.2배로 그린다 (작은 화면에서도 차 모양이 보이게).
// 판정은 가운데와 앞쪽 9 지점 두 점뿐이라, 부딪힐 때 앞코가 연석에 조금 걸쳐 보인다.
function drawCar(g) {
  const body = car.crashed ? css('--warn') : (who === 'ai' && !lastByMe ? css('--ok') : css('--acc'));
  const steer = car.crashed ? 0 : (lastAction % 3 - 1) * 0.4;    // 앞바퀴를 도는 쪽으로 꺾어 그린다
  g.save(); g.translate(car.x, car.y); g.rotate(car.th); g.scale(1.2, 1.2);
  // 그림자
  g.fillStyle = css('--ink'); g.globalAlpha = 0.25;
  roundRect(g, -11, -5.5, 24, 13, 4); g.fill();
  g.globalAlpha = 1;
  // 바퀴 넷
  g.fillStyle = css('--ink');
  for (const [wx, wy, st] of [[-7, -6.8, 0], [-7, 6.8, 0], [7, -6.8, steer], [7, 6.8, steer]]) {
    g.save(); g.translate(wx, wy); g.rotate(st); g.fillRect(-3, -1.6, 6, 3.2); g.restore();
  }
  // 차체
  g.fillStyle = body;
  roundRect(g, -12, -6.5, 24, 13, 4); g.fill();
  // 지붕 (조금 어둡게)
  g.fillStyle = css('--ink'); g.globalAlpha = 0.22;
  roundRect(g, -6, -5, 9, 10, 2.5); g.fill();
  g.globalAlpha = 1;
  // 앞유리 · 뒷유리
  g.fillStyle = css('--acc-soft');
  g.beginPath(); g.moveTo(3, -5); g.lineTo(6.5, -5.6); g.lineTo(6.5, 5.6); g.lineTo(3, 5); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(-6, -4.6); g.lineTo(-8, -5); g.lineTo(-8, 5); g.lineTo(-6, 4.6); g.closePath(); g.fill();
  // 전조등 · 미등
  g.fillStyle = css('--paper');
  g.fillRect(10.5, -5, 1.5, 3); g.fillRect(10.5, 2, 1.5, 3);
  g.fillStyle = css('--warn');
  g.fillRect(-12, -5, 1.2, 2.6); g.fillRect(-12, 2.4, 1.2, 2.6);
  g.restore();
}

function draw() {
  if (!cv.width) sizeCanvas();
  if (!cv.width) return;
  if (!roadCache) roadCache = renderRoad();
  const g = cv.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(roadCache, 0, 0);
  g.setTransform(scale, 0, 0, scale, 0, 0);
  // 센서 광선 — 선 + 끝점 (고급의 8번째 숫자 "빠르기" 는 광선이 아니다)
  g.lineWidth = 1.4;
  lastSense.slice(0, RAY_DEG.length).forEach((v, i) => {
    const a = car.th + RAY_DEG[i] * Math.PI / 180, r = v * RAY_MAX;
    const ex = car.x + Math.cos(a) * r, ey = car.y + Math.sin(a) * r;
    g.strokeStyle = css('--ok'); g.globalAlpha = 0.75;
    g.beginPath(); g.moveTo(car.x, car.y); g.lineTo(ex, ey); g.stroke();
    g.globalAlpha = 1;
    g.fillStyle = css('--ok'); g.strokeStyle = css('--panel');
    g.beginPath(); g.arc(ex, ey, 2.8, 0, Math.PI * 2); g.fill(); g.stroke();
  });
  drawCar(g);
  // 배지: 바퀴 · 달린 시간(게임 시간 — 보기 속도 · 빨리 감기 · PC 성능과 상관없다) · 고급은 지금 빠르기
  $('lapBadge').textContent = [`${f1(Math.max(0, car.progress))}${T('바퀴')}`, T('{n}초').replace('{n}', f1(car.t))]
    .concat(pro() ? [T('{n}배').replace('{n}', f1(car.v))] : []).join(' · ');
}

function overlay(html, kind) {
  const o = $('overlay');
  o.innerHTML = html; o.className = html ? 'on ' + (kind || '') : '';
}

new ResizeObserver(() => { sizeCanvas(); draw(); }).observe($('trackBox'));
addEventListener('resize', drawChart);

// ── 시작 ────────────────────────────────────────────────────
$('panTitle').textContent = trackName();
$('engine').textContent = T('인터넷 없이 이 컴퓨터에서 배워요');
paintMode(); paintTrain(); paintWho(); refreshCounts(); paintRuns(); paintRace();
sizeCanvas(); refreshLive(); draw();
