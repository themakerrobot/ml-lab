// ═══════════════════════════════════════════════════════════
// 운전 활동 — 화면 로직
// ═══════════════════════════════════════════════════════════
// 흐름: 내가 운전(센서 7개 + 내가 고른 운전을 기록) → 배우기 → AI 운전 → 새 트랙에서 시험
// AI가 운전하는 중에 내가 키를 누르면 내 운전이 이기고, 그 장면도 기록된다
// (고쳐 가르치기 — 모방학습의 DAgger 와 같은 생각).

import { TRACKS, WORLD_W, WORLD_H, buildTrack } from './track.js';
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
const ACT_LABEL = ['왼쪽', '곧게', '오른쪽'];
const ACT_ICON = ['fa-arrow-left', 'fa-arrow-up', 'fa-arrow-right'];

// ── 상태 ────────────────────────────────────────────────────
const built = TRACKS.map(buildTrack);
let track = built[0];
const car = new Car(track);
let who = 'me';                 // 'me' | 'ai'
let running = false, fast = false;
let tick = 0;
const keys = { left: false, right: false };
const data = { X: [], Y: [] };  // 센서 7개 → 0/1/2
let policy = null, training = false;
let lastSense = car.sense(), lastAction = 1, lastByMe = false, cutIns = 0;
let senseHist = [];             // 최근 센서값 (REACT_STEPS+1 개까지)
const runs = [];

// ── 도우미 ──────────────────────────────────────────────────
let toastTimer = 0;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2200);
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

// ── 트랙 고르기 ─────────────────────────────────────────────
built.forEach((t, i) => {
  const el = document.createElement('div');
  el.className = 'mradio' + (i === 0 ? ' on' : '');
  el.innerHTML = `<i class="fa-solid ${t.def.unseen ? 'fa-flag-checkered' : 'fa-road'}"></i>
    <span class="nm">${T(t.def.label)}</span>
    <span class="mt">${t.def.unseen ? T('시험용') : ''}</span>`;
  el.addEventListener('click', () => pickTrack(i));
  $('trackPick').appendChild(el);
});
function pickTrack(i) {
  if (running) stop();
  track = built[i];
  car.reset(track);
  [...$('trackPick').children].forEach((el, j) => el.classList.toggle('on', j === i));
  $('panTitle').textContent = T(track.def.label);
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
}
$('clearBtn').addEventListener('click', () => {
  if (!data.Y.length || !confirm(T('보여 준 운전을 모두 지울까요?'))) return;
  data.X = []; data.Y = []; refreshCounts();
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
const curStep = () => [1, 2, 3, 4].find(i => $('s' + i).classList.contains('on')) || 1;

let last = 0, acc = 0;
function loop(now) {
  if (!running) return;
  acc += Math.min(0.1, (now - last) / 1000); last = now;
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
  runs.unshift({
    track: track.def.label, unseen: !!track.def.unseen, done,
    prog: p, cutIns, samples: data.Y.length,
  });
  runs.length = Math.min(runs.length, 6);
  $('runLog').innerHTML = runs.map(r => `
    <div class="saved"><i class="fa-solid ${r.done ? 'fa-flag-checkered' : 'fa-car-burst'}" style="color:var(${r.done ? '--ok' : '--warn'})"></i>
      <span class="nm">${T(r.track)}</span>
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
  g.fillStyle = css('--panel2'); g.fillRect(0, 0, c.width, c.height);
  g.setTransform(scale, 0, 0, scale, 0, 0);
  const path = () => {
    g.beginPath();
    track.pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y));
    g.closePath();
  };
  g.lineJoin = 'round';
  path(); g.strokeStyle = css('--line'); g.lineWidth = track.def.width + 4; g.stroke();
  path(); g.strokeStyle = css('--line-soft'); g.lineWidth = track.def.width; g.stroke();
  path(); g.strokeStyle = css('--panel'); g.lineWidth = 1.5; g.setLineDash([8, 10]); g.stroke(); g.setLineDash([]);
  // 출발선
  const [x0, y0] = track.pts[0], th = track.start.th, nx = -Math.sin(th), ny = Math.cos(th);
  g.strokeStyle = css('--ink'); g.lineWidth = 4;
  g.beginPath(); g.moveTo(x0 + nx * track.hw, y0 + ny * track.hw); g.lineTo(x0 - nx * track.hw, y0 - ny * track.hw); g.stroke();
  return c;
}

function draw() {
  if (!cv.width) sizeCanvas();
  if (!cv.width) return;
  if (!roadCache) roadCache = renderRoad();
  const g = cv.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(roadCache, 0, 0);
  g.setTransform(scale, 0, 0, scale, 0, 0);
  // 센서 광선
  g.strokeStyle = css('--ok'); g.fillStyle = css('--ok'); g.lineWidth = 1.2; g.globalAlpha = 0.7;
  lastSense.forEach((v, i) => {
    const a = car.th + RAY_DEG[i] * Math.PI / 180, r = v * RAY_MAX;
    const ex = car.x + Math.cos(a) * r, ey = car.y + Math.sin(a) * r;
    g.beginPath(); g.moveTo(car.x, car.y); g.lineTo(ex, ey); g.stroke();
    g.beginPath(); g.arc(ex, ey, 2.5, 0, Math.PI * 2); g.fill();
  });
  g.globalAlpha = 1;
  // 차
  g.save(); g.translate(car.x, car.y); g.rotate(car.th);
  g.fillStyle = car.crashed ? css('--warn') : (who === 'ai' && !lastByMe ? css('--ok') : css('--acc'));
  g.fillRect(-11, -6, 22, 12);
  g.fillStyle = css('--panel'); g.fillRect(3, -4, 5, 8);   // 앞유리 = 앞쪽 표시
  g.restore();
  $('lapBadge').textContent = `${Math.max(0, car.progress).toFixed(1)}${T('바퀴')}`;
}

function overlay(html, kind) {
  const o = $('overlay');
  o.innerHTML = html; o.className = html ? 'on ' + (kind || '') : '';
}

new ResizeObserver(() => { sizeCanvas(); draw(); }).observe($('trackBox'));
addEventListener('resize', drawChart);

// ── 시작 ────────────────────────────────────────────────────
$('panTitle').textContent = T(track.def.label);
$('engine').textContent = T('인터넷 없이 이 컴퓨터에서 배워요');
refreshCounts();
sizeCanvas(); refreshLive(); draw();
