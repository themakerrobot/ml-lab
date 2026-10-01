// ═══════════════════════════════════════════════════════════
// 운전 활동 — 화면 로직
// ═══════════════════════════════════════════════════════════
// 흐름: 내가 운전(센서 7개 + 내가 고른 운전을 기록) → 배우기 → AI 운전 → 새 트랙에서 시험
// AI가 운전하는 중에 내가 키를 누르면 내 운전이 이기고, 그 장면도 기록된다
// (고쳐 가르치기 — 모방학습의 DAgger 와 같은 생각).

import { TRACKS, WORLD_W, WORLD_H, buildTrack, centerline } from './track.js';
import { Car, RAY_DEG, RAY_MAX, DT } from './sim.js';
import { Policy } from './policy.js';

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
// 양쪽이 각각 30장면을 넘으면 구불구불 트랙 반 바퀴로도 20개 코스를 모두 돌았다.
// 다만 쉬운 트랙(둥근·경기장)만 양방향으로 돌면 양쪽 장면은 넉넉해도 급한 커브를
// 못 배워 산길·콩 트랙에서 부딪혔다 — 그래서 쉬운 트랙에서만 모았으면 따로 알려 준다.
const READY_TURNS = 30;
const ACT_LABEL = ['왼쪽', '곧게', '오른쪽'];
const ACT_ICON = ['fa-arrow-left', 'fa-arrow-up', 'fa-arrow-right'];
const LEVEL_LABEL = ['', '쉬움', '보통', '어려움'];

// ── 상태 ────────────────────────────────────────────────────
// 트랙은 고를 때 만든다 (마스크 만들기가 무거워서 처음에 10개를 다 만들지 않는다)
const builtCache = new Map();
function getTrack(i, rev) {
  const key = i + (rev ? 'r' : 'f');
  if (!builtCache.has(key)) builtCache.set(key, buildTrack(TRACKS[i], rev));
  return builtCache.get(key);
}
let trackIdx = 0, reverse = false;
let track = getTrack(0, false);
const car = new Car(track);
let who = 'me';                 // 'me' | 'ai'
let running = false, fast = false;
let tick = 0;
const keys = { left: false, right: false };
const data = { X: [], Y: [], L: [] };  // 센서 7개 → 0/1/2, L = 그 장면을 모은 트랙의 난이도
let policy = null, training = false;
let lastSense = car.sense(), lastAction = 1, lastByMe = false, cutIns = 0;
let senseHist = [];             // 최근 센서값 (REACT_STEPS+1 개까지)
const runs = [];

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
const argmax = P => P.indexOf(Math.max(...P));
const trackName = (t = track) => T(t.def.label) + (t.reverse ? ` (${T('거꾸로')})` : '');

// 같은 씨앗이면 늘 같은 수 — 나무·풀 자리가 그릴 때마다 바뀌지 않게
function seeded(str) {
  let s = 0;
  for (const ch of str) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

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
TRACKS.forEach((def, i) => {
  const el = document.createElement('div');
  el.className = 'tcard' + (i === 0 ? ' on' : '');
  el.innerHTML = `<canvas width="160" height="104"></canvas>
    <div class="tn"><span>${T(def.label)}</span></div>
    <div class="tl${def.unseen ? ' test' : ''}">${def.unseen ? `<i class="fa-solid fa-flag-checkered"></i> ${T('시험용')} · ` : ''}${T(LEVEL_LABEL[def.level])}</div>`;
  el.addEventListener('click', () => pickTrack(i, reverse));
  $('trackPick').appendChild(el);
  drawThumb(el.querySelector('canvas'), def);
});
$('dirSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  pickTrack(trackIdx, b.dataset.r === '1');
}));
function pickTrack(i, rev) {
  if (running) stop();
  trackIdx = i; reverse = rev;
  track = getTrack(i, rev);
  car.reset(track);
  [...$('trackPick').children].forEach((el, j) => el.classList.toggle('on', j === i));
  $('dirSeg').querySelectorAll('button').forEach(o => o.classList.toggle('on', (o.dataset.r === '1') === rev));
  $('panTitle').textContent = trackName();
  if (track.def.unseen && policy) setStep(4);
  roadCache = null;
  overlay('');
  refreshLive();
  draw();
}

// ── 누가 운전할까 ───────────────────────────────────────────
$('whoSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.who === 'ai' && !policy) { toast(T('먼저 배우기를 해 주세요')); return; }
  if (running) stop();
  who = b.dataset.who;
  $('whoSeg').querySelectorAll('button').forEach(o => o.classList.toggle('on', o === b));
  $('whoHint').textContent = who === 'me'
    ? T('내가 운전하는 동안 AI가 보고 배워요.')
    : T('AI가 운전해요. 키를 누르면 내가 끼어들어 고쳐 가르쳐요.');
  car.reset(track); overlay(''); draw();
}));

// ── 모은 운전 ───────────────────────────────────────────────
function refreshCounts() {
  const c = [0, 0, 0];
  data.Y.forEach(y => c[y]++);
  const max = Math.max(1, ...c);
  $('counts').innerHTML = c.map((n, k) => `
    <div class="bar"><div class="bl"><span><i class="fa-solid ${ACT_ICON[k]}"></i> ${T(ACT_LABEL[k])}</span>
      <span class="num">${n}</span></div>
      <div class="bt"><div class="bf" style="width:${n / max * 100}%"></div></div></div>`).join('');
  $('totalCnt').textContent = T('모두 {n}장면').replace('{n}', data.Y.length);
  $('trainBtn').disabled = training || data.Y.length < MIN_SAMPLES;
  // 언제 배우기를 누르면 되나 — 도는 장면이 양쪽 다 충분한지, 급한 커브도 보여 줬는지
  const short = [0, 2].filter(k => c[k] < READY_TURNS);
  const r = $('readyHint');
  if (!data.Y.length) { r.className = 'ready'; r.textContent = T('운전을 시작하면 장면이 쌓여요.'); }
  else if (short.length) {
    r.className = 'ready';
    r.textContent = short.map(k => T('{dir}으로 도는 장면이 더 필요해요 ({n}/{need})')
      .replace('{dir}', T(ACT_LABEL[k])).replace('{n}', c[k]).replace('{need}', READY_TURNS)).join(' ');
  } else if (Math.max(...data.L) < 2) {
    r.className = 'ready';
    r.textContent = T('양쪽 장면은 넉넉해요. 그런데 쉬운 트랙에서만 모았어요 — 커브가 급한 트랙(보통·어려움)에서도 조금 보여 주세요.');
  } else { r.className = 'ready ok'; r.textContent = T('양쪽으로 도는 장면이 넉넉해요. 배우기를 눌러 봐요!'); }
}
$('clearBtn').addEventListener('click', () => {
  if (!data.Y.length || !confirm(T('보여 준 운전을 모두 지울까요?'))) return;
  data.X = []; data.Y = []; data.L = []; refreshCounts();
});

// ── 운전 입력 (키보드 · 화면 버튼) ──────────────────────────
const KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
addEventListener('keydown', e => {
  if (e.target.matches && e.target.matches('input,textarea')) return;
  if (KEYMAP[e.code]) { keys[KEYMAP[e.code]] = true; e.preventDefault(); }
  else if (e.code === 'Space') { e.preventDefault(); running ? stop() : go(); }
});
addEventListener('keyup', e => { if (KEYMAP[e.code]) keys[KEYMAP[e.code]] = false; });
addEventListener('blur', () => { keys.left = keys.right = false; });
for (const [id, k] of [['padL', 'left'], ['padR', 'right']]) {
  const b = $(id);
  const on = e => { e.preventDefault(); keys[k] = true; b.classList.add('on'); };
  const off = () => { keys[k] = false; b.classList.remove('on'); };
  b.addEventListener('pointerdown', on);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, off));
}
function myAction() {
  if (keys.left && !keys.right) return 0;
  if (keys.right && !keys.left) return 2;
  return 1;
}
const pressing = () => keys.left !== keys.right;

// ── 달리기 ──────────────────────────────────────────────────
function go() {
  if (who === 'ai' && !policy) { toast(T('먼저 배우기를 해 주세요')); return; }
  if (car.crashed || (who === 'ai' && car.progress >= AI_LAPS)) car.reset(track);
  senseHist = [];
  if (car.progress === 0) cutIns = 0;
  running = true; overlay('');
  $('goBtn').disabled = true; $('stopBtn').disabled = false;
  if (who === 'me') setStep(Math.max(1, curStep()));
  if (who === 'ai') setStep(track.def.unseen ? 4 : 3);
  last = performance.now(); acc = 0;
  requestAnimationFrame(loop);
}
function stop() {
  running = false;
  $('goBtn').disabled = false; $('stopBtn').disabled = true;
}
$('goBtn').addEventListener('click', go);
$('stopBtn').addEventListener('click', stop);
$('fastBtn').addEventListener('click', () => { fast = !fast; $('fastBtn').classList.toggle('on', fast); });
// 속도: 게임 시간을 느리게 흘린다. 차의 물리·센서·학습은 그대로라 배운 AI도 똑같이 달린다.
// (0.35~1배 모두에서 "0.1초 전 센서와 짝짓기(6걸음)" 로 배운 AI가 완주하는 것을 확인했다 — DEVELOP.md)
let speed = 0.55;
$('speedSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  speed = +b.dataset.s;
  $('speedSeg').querySelectorAll('button').forEach(o => o.classList.toggle('on', o === b));
}));
const curStep = () => [1, 2, 3, 4].find(i => $('s' + i).classList.contains('on')) || 1;

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
  const s = car.sense();
  senseHist.push(s);
  if (senseHist.length > REACT_STEPS + 1) senseHist.shift();
  let a, byMe;
  if (who === 'me' || pressing()) { a = myAction(); byMe = true; }
  else { a = argmax(policy.predict(s)); byMe = false; }
  if (byMe && tick % RECORD_EVERY === 0) {
    data.X.push(senseHist[0]); data.Y.push(a);     // 0.1초 전 장면 + 지금 누른 키
    data.L.push(track.def.level);
    if (who === 'ai') cutIns++;
    refreshCounts();
  }
  tick++;
  lastSense = s; lastAction = a; lastByMe = byMe;
  if (car.step(a)) {
    stop();
    overlay(`<i class="fa-solid fa-car-burst"></i> ${T('쾅! 길 밖으로 나갔어요')}`, 'bad');
    if (who === 'ai') logRun(false);
  } else if (who === 'ai' && car.progress >= AI_LAPS) {
    stop();
    overlay(`<i class="fa-solid fa-flag-checkered"></i> ${AI_LAPS}${T('바퀴 완주!')}`, 'good');
    logRun(true);
  }
}

function logRun(done) {
  const p = Math.max(0, car.progress);
  runs.unshift({ name: trackName(), done, prog: p, cutIns });
  runs.length = Math.min(runs.length, 6);
  $('runLog').innerHTML = runs.map(r => `
    <div class="saved"><i class="fa-solid ${r.done ? 'fa-flag-checkered' : 'fa-car-burst'}" style="color:var(${r.done ? '--ok' : '--warn'})"></i>
      <span class="nm">${r.name}</span>
      <span class="mt">${r.done ? T('완주') : `${r.prog.toFixed(1)}${T('바퀴에서 멈춤')}`}${r.cutIns ? ` · ${T('끼어들기')} ${r.cutIns}` : ''}</span></div>`).join('');
}

// ── 배우기 ──────────────────────────────────────────────────
let hist = [];
$('trainBtn').addEventListener('click', async () => {
  const kinds = new Set(data.Y).size;
  if (kinds < 2) { toast(T('왼쪽이나 오른쪽으로 도는 운전도 보여 주세요')); return; }
  if (running) stop();
  training = true; refreshCounts();
  $('prgLabel').textContent = T('배우는 중'); setStep(2);
  const p = new Policy();
  hist = [];
  const X = data.X.slice(), Y = data.Y.slice();
  let r;
  for (let e = 0; e < EPOCHS; e++) {
    r = p.fitEpoch(X, Y);
    hist.push(r);
    const pct = Math.round((e + 1) / EPOCHS * 100);
    $('prgFill').style.width = pct + '%'; $('prgPct').textContent = pct + '%';
    drawChart();
    if (e % 3 === 2) await nextFrame();
  }
  policy = p; training = false; refreshCounts();
  $('prgPct').textContent = '';
  $('prgLabel').textContent = `${T('다 배웠어요')} · ${T('맞힌 비율')} ${Math.round(r.acc * 100)}%`;
  $('trainHint').textContent = T('장면 {n}개로 배웠어요.').replace('{n}', X.length) + ' ' + T('이제 AI에게 운전을 맡겨 봐요.');
  setStep(3);
  refreshLive();
});

function drawChart() {
  const c = $('chart'), dpr = devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight;
  if (!W || !H) return;
  c.width = W * dpr; c.height = H * dpr;
  const g = c.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, W, H);
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

// ── 오른쪽 실시간 패널 ─────────────────────────────────────
function refreshLive() {
  if (!running) lastSense = car.sense();
  $('sensors').innerHTML = lastSense.map((v, i) => `
    <div class="sensor"><span class="sn num">${RAY_DEG[i] > 0 ? '+' : ''}${RAY_DEG[i]}°</span>
      <div class="bt"><div class="bf" style="width:${v * 100}%"></div></div>
      <span class="sv num">${v.toFixed(2)}</span></div>`).join('');
  if (!policy) return;
  const P = policy.predict(lastSense), best = argmax(P);
  $('choice').innerHTML = Array.from(P).map((v, k) => `
    <div class="bar${k === best ? ' top' : ''}"><div class="bl">
      <span><i class="fa-solid ${ACT_ICON[k]}"></i> ${T(ACT_LABEL[k])}</span><span class="num">${Math.round(v * 100)}%</span></div>
      <div class="bt"><div class="bf" style="width:${v * 100}%"></div></div></div>`).join('')
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
  const steer = car.crashed ? 0 : (lastAction - 1) * 0.4;    // 앞바퀴를 도는 쪽으로 꺾어 그린다
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
  // 센서 광선 — 선 + 끝점
  g.lineWidth = 1.4;
  lastSense.forEach((v, i) => {
    const a = car.th + RAY_DEG[i] * Math.PI / 180, r = v * RAY_MAX;
    const ex = car.x + Math.cos(a) * r, ey = car.y + Math.sin(a) * r;
    g.strokeStyle = css('--ok'); g.globalAlpha = 0.75;
    g.beginPath(); g.moveTo(car.x, car.y); g.lineTo(ex, ey); g.stroke();
    g.globalAlpha = 1;
    g.fillStyle = css('--ok'); g.strokeStyle = css('--panel');
    g.beginPath(); g.arc(ex, ey, 2.8, 0, Math.PI * 2); g.fill(); g.stroke();
  });
  drawCar(g);
  $('lapBadge').textContent = `${Math.max(0, car.progress).toFixed(1)}${T('바퀴')}`;
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
refreshCounts();
sizeCanvas(); refreshLive(); draw();
