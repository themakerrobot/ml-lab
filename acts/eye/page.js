// ═══════════════════════════════════════════════════════════
// AI 눈 활동 — 화면 로직
// ═══════════════════════════════════════════════════════════
// 흐름: 종류 만들기 → 예시 모으기(그리기 · 카메라 · 예시 그림) → 배우기(워커)
//       → 들여다보기(필터 · 특징 지도) → 속이기(바꾼 그림 · 속이기 시험 · 데이터 늘리기)
// 카메라 영상과 그림은 이 컴퓨터 밖으로 나가지 않는다.

import { TinyCNN, IMG, OUT, K } from './cnn.js';
import { transform, drawShape } from './imgops.js';

const T = s => (typeof GL_T === 'function' ? GL_T(s) : s);
const LANG = (typeof GL_LANG === 'string') ? GL_LANG : 'ko';
const $ = id => document.getElementById(id);

const MAX_CLASS = 6, MIN_PER_CLASS = 5, SAMPLE_N = 20;
const EXAM_COLS = [['straight', '똑바로'], ['tilt', '기울이기'], ['small', '작게'], ['dark', '어둡게']];
const AUG_NAME = { rotate: '돌리기', shift: '옮기기·크기', bright: '밝기' };

// ── 상태 ────────────────────────────────────────────────────
const classes = [];            // { name, xs: Float32Array[] }
let sel = -1;
let src = 'draw';
let model = null, modelNames = [], training = false;
let notes = Array(8).fill('');
const examRows = [];
let hist = [];

// ── 도우미 ──────────────────────────────────────────────────
let toastTimer = 0;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2400);
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const rgb = hex => { const h = hex.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
function setStep(n) {
  for (let i = 1; i <= 4; i++) {
    $('s' + i).classList.toggle('on', i === n);
    $('s' + i).classList.toggle('done', i < n);
  }
}
const argmax = a => { let b = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[b]) b = i; return b; };

// 32×32 흑백 → 작은 그림 주소 (썸네일)
const thumbCv = document.createElement('canvas'); thumbCv.width = thumbCv.height = IMG;
const urlCache = new WeakMap();
function toURL(x) {
  if (urlCache.has(x)) return urlCache.get(x);
  const g = thumbCv.getContext('2d'), im = g.createImageData(IMG, IMG);
  for (let i = 0; i < IMG * IMG; i++) {
    const v = Math.round(x[i] * 255);
    im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  const u = thumbCv.toDataURL();
  urlCache.set(x, u);
  return u;
}

// ── 종류 ────────────────────────────────────────────────────
function addClass(name) {
  name = name.trim();
  if (!name) return -1;
  if (classes.some(c => c.name === name)) { toast(T('같은 이름이 이미 있어요')); return -1; }
  if (classes.length >= MAX_CLASS) { toast(T('종류는 6개까지 만들 수 있어요')); return -1; }
  classes.push({ name, xs: [] });
  classesChanged();
  return classes.length - 1;
}
$('clsAdd').addEventListener('click', () => { const i = addClass($('clsName').value); if (i >= 0) { $('clsName').value = ''; pick(i); } });
$('clsName').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) $('clsAdd').click(); });

function pick(i) { sel = i; renderClasses(); }

// 종류가 늘거나 줄면 배운 모델은 더 이상 맞지 않는다
function classesChanged() {
  if (model && modelNames.length !== classes.length) dropModel();
  renderClasses();
}
function dropModel() {
  model = null; modelNames = [];
  $('saveBtn').disabled = true;
  $('pred').innerHTML = `<div class="hint" style="margin-top:0">${T('종류가 바뀌어서 다시 배워야 해요')}</div>`;
  $('filters').innerHTML = ''; $('maps').innerHTML = '';
  $('prgLabel').textContent = T('아직 안 배웠어요'); $('prgFill').style.width = '0';
}

function renderClasses() {
  $('clsList').innerHTML = classes.map((c, i) => `
    <div class="cls${i === sel ? ' on' : ''}" data-i="${i}">
      <div class="top"><span class="nm">${esc(c.name)}</span><span class="ct num">${c.xs.length}${T('장')}</span>
        <button class="del" data-del="${i}" title="${T('지우기')}"><i class="fa-solid fa-xmark"></i></button></div>
      <div class="thumbs">${c.xs.slice(-48).map((x, j) => `<img src="${toURL(x)}" data-c="${i}" data-j="${c.xs.length - Math.min(48, c.xs.length) + j}" alt="" title="${T('누르면 이 예시를 지워요')}">`).join('')}</div>
    </div>`).join('');
  $('clsList').querySelectorAll('.cls').forEach(el => el.addEventListener('click', e => {
    const d = e.target.closest('[data-del]'), im = e.target.closest('img');
    if (d) {
      e.stopPropagation();
      const i = +d.dataset.del;
      if (classes[i].xs.length && !confirm(T('이 종류와 예시를 지울까요?'))) return;
      classes.splice(i, 1);
      if (sel >= classes.length) sel = classes.length - 1;
      classesChanged(); return;
    }
    if (im) { e.stopPropagation(); classes[+im.dataset.c].xs.splice(+im.dataset.j, 1); renderClasses(); return; }
    pick(+el.dataset.i);
  }));
  const c = classes[sel];
  $('selInfo').textContent = c ? `${T('고른 종류')}: ${c.name}` : T('종류를 골라 주세요');
  $('selInfo').classList.toggle('on', !!c);
  $('capBtn').disabled = !c;
  const ready = classes.filter(k => k.xs.length >= MIN_PER_CLASS).length >= 2;
  $('trainBtn').disabled = training || !ready;
}

// 예시 그림 세트
const SAMPLE_KINDS = [['circle', '동그라미', 'Circle'], ['triangle', '세모', 'Triangle'], ['star', '별', 'Star']];
$('sampleBtn').addEventListener('click', () => {
  for (const [kind, ko, en] of SAMPLE_KINDS) {
    const name = LANG === 'ko' ? ko : en;
    let i = classes.findIndex(c => c.name === name);
    if (i < 0) i = addClass(name);
    if (i < 0) continue;
    for (let n = 0; n < SAMPLE_N; n++) classes[i].xs.push(drawShape(kind));
  }
  if (sel < 0) sel = 0;
  renderClasses();
  toast(T('종류마다 예시 그림 20장을 넣었어요'));
});

// ── 입력: 그리기 판 ─────────────────────────────────────────
const pad = $('pad'), pg = pad.getContext('2d');
function clearPad() { pg.fillStyle = '#FFFFFF'; pg.fillRect(0, 0, pad.width, pad.height); }
clearPad();
let drawing = false, lastPt = null;
const padPt = e => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * pad.width / r.width, (e.clientY - r.top) * pad.height / r.height]; };
pad.addEventListener('pointerdown', e => { drawing = true; lastPt = padPt(e); pad.setPointerCapture(e.pointerId); stroke(lastPt); });
pad.addEventListener('pointermove', e => { if (drawing) { const p = padPt(e); stroke(p); lastPt = p; } });
['pointerup', 'pointercancel'].forEach(ev => pad.addEventListener(ev, () => { drawing = false; }));
function stroke(p) {
  // 32칸으로 줄이면 선 굵기가 1.5칸쯤 된다 — 예시 그림의 펜 굵기와 비슷하게
  pg.strokeStyle = '#1A1A1A'; pg.lineWidth = 12; pg.lineCap = 'round'; pg.lineJoin = 'round';
  pg.beginPath(); pg.moveTo(lastPt[0], lastPt[1]); pg.lineTo(p[0] + 0.01, p[1]); pg.stroke();
}
$('padClear').addEventListener('click', clearPad);

// ── 입력: 카메라 ────────────────────────────────────────────
const vid = $('camVid');
let stream = null;
async function camOn() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
    vid.srcObject = stream; await vid.play();
    $('camOff').style.display = 'none';
    return true;
  } catch (e) {
    toast(T('카메라를 쓸 수 없어요. 그리기나 예시 그림으로 해 보세요'));
    return false;
  }
}
function camOff() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null; vid.srcObject = null; $('camOff').style.display = '';
}
$('srcSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', async () => {
  const want = b.dataset.src;
  if (want === src) return;
  if (want === 'cam' && !(await camOn())) return;
  if (want === 'draw') camOff();
  src = want;
  $('srcSeg').querySelectorAll('button').forEach(o => o.classList.toggle('on', o === b));
  $('camBox').style.display = src === 'cam' ? '' : 'none';
  $('drawBox').style.display = src === 'draw' ? '' : 'none';
  capLabel();
}));
function capLabel() {
  $('capBtn').innerHTML = src === 'cam'
    ? `<i class="fa-solid fa-camera-retro"></i> ${T('꾹 눌러서 예시 모으기')}`
    : `<i class="fa-solid fa-plus"></i> ${T('이 그림 넣기')}`;
}

// 지금 보이는 것 → 32×32 흑백 (0 검정 ~ 1 흰색)
const smallCv = document.createElement('canvas'); smallCv.width = smallCv.height = IMG;
const sg = smallCv.getContext('2d', { willReadFrequently: true });
function grab() {
  sg.imageSmoothingEnabled = true; sg.imageSmoothingQuality = 'high';
  if (src === 'cam') {
    if (!stream || vid.readyState < 2) return null;
    const vw = vid.videoWidth, vh = vid.videoHeight, s = Math.min(vw, vh) * 0.7;   // 가운데 네모 (화면의 점선 칸)
    sg.drawImage(vid, (vw - s) / 2, (vh - s) / 2, s, s, 0, 0, IMG, IMG);
  } else {
    sg.drawImage(pad, 0, 0, IMG, IMG);
  }
  const d = sg.getImageData(0, 0, IMG, IMG).data, x = new Float32Array(IMG * IMG);
  for (let i = 0; i < IMG * IMG; i++) x[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
  return x;
}

// ── 예시 모으기 ────────────────────────────────────────────
let capTimer = 0;
function capOnce() {
  const c = classes[sel]; if (!c) return;
  const x = grab(); if (!x) { toast(T('카메라를 켜 주세요')); return; }
  c.xs.push(x);
  renderClasses();
}
$('capBtn').addEventListener('pointerdown', e => {
  if ($('capBtn').disabled) return;
  if (src === 'draw') { capOnce(); clearPad(); return; }       // 그림은 한 장씩 넣고 판을 비운다
  e.preventDefault(); capOnce();
  capTimer = setInterval(capOnce, 200);                        // 카메라는 누르는 동안 초당 5장
});
['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => $('capBtn').addEventListener(ev, () => clearInterval(capTimer)));

// ── 배우기 ──────────────────────────────────────────────────
const worker = new Worker('acts/eye/worker.js', { type: 'module' });
worker.onerror = e => { training = false; renderClasses(); toast(T('불러오지 못했어요. 새로고침해 주세요')); console.error(e); };

$('trainBtn').addEventListener('click', () => {
  const X = [], Y = [];
  classes.forEach((c, i) => c.xs.forEach(x => { X.push(Array.from(x)); Y.push(i); }));
  const aug = {};
  $('augs').querySelectorAll('input').forEach(i => { aug[i.dataset.aug] = i.checked; });
  const anyAug = Object.values(aug).some(Boolean);
  training = true; renderClasses();
  hist = []; drawChart();
  $('prgLabel').textContent = T('배우는 중'); setStep(2);
  pendingNames = classes.map(c => c.name);
  pendingAug = aug;
  worker.postMessage({ type: 'train', X, Y, nClass: classes.length, aug, epochs: anyAug ? 40 : 20 });
});
let pendingNames = [], pendingAug = {};

worker.onmessage = ({ data: m }) => {
  if (m.type === 'progress') {
    hist.push(m);
    const pct = Math.round(m.epoch / m.epochs * 100);
    $('prgFill').style.width = pct + '%'; $('prgPct').textContent = pct + '%';
    drawChart();
  } else if (m.type === 'done') {
    training = false;
    model = TinyCNN.fromJSON(m.model); modelNames = pendingNames;
    $('prgPct').textContent = '';
    $('prgLabel').textContent = `${T('다 배웠어요')} · ${T('맞힌 비율')} ${Math.round(m.acc * 100)}%`;
    $('saveBtn').disabled = false;
    const on = Object.keys(pendingAug).filter(k => pendingAug[k]).map(k => T(AUG_NAME[k]));
    examRows.push({ aug: on.length ? on.join('+') : T('안 흔듦'), exam: m.exam });
    renderExam(); renderWrong(m.wrong); renderFilters();
    renderClasses(); setStep(3);
  }
};

function drawChart() {
  const c = $('chart'), dpr = devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight;
  if (!W || !H) return;
  c.width = W * dpr; c.height = H * dpr;
  const g = c.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, W, H);
  if (hist.length < 2) return;
  const n = hist[0].epochs, maxL = Math.max(...hist.map(h => h.loss));
  const line = (pts, color) => {
    g.strokeStyle = color; g.lineWidth = 2; g.beginPath();
    pts.forEach(([i, v], k) => { const x = 6 + (i - 1) / (n - 1) * (W - 12), y = H - 6 - v * (H - 12); k ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
  };
  line(hist.filter(h => h.acc !== null).map(h => [h.epoch, h.acc]), css('--acc'));
  line(hist.map(h => [h.epoch, h.loss / maxL]), css('--warn'));
}
addEventListener('resize', drawChart);

function renderExam() {
  const pct = v => `<td class="num${v < 0.6 ? ' low' : ''}">${Math.round(v * 100)}%</td>`;
  $('exam').innerHTML = `<table class="mk-table exam">
    <tr><th>${T('흔들기')}</th>${EXAM_COLS.map(([, ko]) => `<th>${T(ko)}</th>`).join('')}</tr>
    ${examRows.map(r => `<tr><td class="nm">${esc(r.aug)}</td>${EXAM_COLS.map(([k]) => pct(r.exam[k])).join('')}</tr>`).join('')}
  </table>`;
}

function renderWrong(wrong) {
  if (!wrong.length) { $('wrongWrap').innerHTML = ''; return; }
  const all = []; classes.forEach((c, i) => c.xs.forEach(x => all.push([x, i])));
  $('wrongWrap').innerHTML = `<div class="pb-label" style="margin-top:10px">${T('배운 그림인데도 틀린 것')} (${wrong.length})</div>
    <div class="thumbs">${wrong.slice(0, 24).map(([n, a]) =>
      `<img src="${toURL(all[n][0])}" alt="" title="${esc(classes[all[n][1]].name)} → ${esc(modelNames[a])}">`).join('')}</div>`;
}

// ── 들여다보기: 필터 · 특징 지도 ────────────────────────────
function renderFilters() {
  if (!model) return;
  const W = model.p.W, F = model.F;
  $('filters').innerHTML = Array.from({ length: F }, (_, f) => `
    <div class="fcell"><canvas width="${K}" height="${K}" data-f="${f}"></canvas><span class="fno num">${f + 1}</span></div>`).join('');
  const pos = rgb(css('--acc')), neg = rgb(css('--warn')), bg = rgb(css('--panel'));
  $('filters').querySelectorAll('canvas').forEach(cv => {
    const f = +cv.dataset.f, g = cv.getContext('2d'), im = g.createImageData(K, K);
    let mx = 1e-6;
    for (let i = 0; i < K * K; i++) mx = Math.max(mx, Math.abs(W[f * K * K + i]));
    for (let i = 0; i < K * K; i++) {
      const v = W[f * K * K + i] / mx, col = v >= 0 ? pos : neg, a = Math.abs(v);
      for (let ch = 0; ch < 3; ch++) im.data[i * 4 + ch] = Math.round(bg[ch] + (col[ch] - bg[ch]) * a);
      im.data[i * 4 + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  });
  // 해석 메모는 특징 지도 밑에 둔다 — 5×5 무늬보다 "어떤 그림에서 켜지나"가 훨씬 읽기 쉽다
  $('maps').innerHTML = Array.from({ length: F }, (_, f) => `
    <div class="fcell"><canvas width="${OUT}" height="${OUT}" data-m="${f}"></canvas>
      <input class="inp note" data-n="${f}" maxlength="12" placeholder="${f + 1}. ${T('무엇을 찾나?')}" value="${esc(notes[f] || '')}"></div>`).join('');
  $('maps').querySelectorAll('.note').forEach(inp => inp.addEventListener('input', () => { notes[+inp.dataset.n] = inp.value; }));
}

function drawMaps(Z) {
  const cvs = $('maps').querySelectorAll('canvas');
  if (!cvs.length) return;
  let mx = 1e-6;
  for (let i = 0; i < Z.length; i++) if (Z[i] > mx) mx = Z[i];      // 여덟 장을 같은 잣대로 — 어느 필터가 더 반응했는지 비교
  const acc = rgb(css('--acc')), bg = rgb(css('--panel'));
  cvs.forEach((cv, f) => {
    const g = cv.getContext('2d'), im = g.createImageData(OUT, OUT);
    for (let i = 0; i < OUT * OUT; i++) {
      const a = Z[f * OUT * OUT + i] / mx;
      for (let ch = 0; ch < 3; ch++) im.data[i * 4 + ch] = Math.round(bg[ch] + (acc[ch] - bg[ch]) * a);
      im.data[i * 4 + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  });
}

// ── 속이기 ──────────────────────────────────────────────────
function trick() {
  return { rot: +$('rot').value * Math.PI / 180, scale: +$('scl').value / 100, bright: +$('brt').value / 100 };
}
const tricked = () => +$('rot').value !== 0 || +$('scl').value !== 100 || +$('brt').value !== 100;
for (const [id, out, unit] of [['rot', 'rotVal', '°'], ['scl', 'sclVal', '%'], ['brt', 'brtVal', '%']]) {
  $(id).addEventListener('input', () => { $(out).textContent = $(id).value + unit; if (model) setStep(4); });
}
$('trickReset').addEventListener('click', () => {
  $('rot').value = 0; $('scl').value = 100; $('brt').value = 100;
  $('rotVal').textContent = '0°'; $('sclVal').textContent = '100%'; $('brtVal').textContent = '100%';
});

// ── 실시간: AI가 보는 그림 · 답 · 특징 지도 ─────────────────
const see = $('seeCv'), seeG = see.getContext('2d');
let lastT = 0;
function live(now) {
  requestAnimationFrame(live);
  if (now - lastT < 80) return;                 // 초당 12번이면 충분하다 (저사양 PC 배려)
  lastT = now;
  let x = grab();
  if (!x) return;
  if (tricked()) x = transform(x, trick());
  const im = seeG.createImageData(IMG, IMG);
  for (let i = 0; i < IMG * IMG; i++) {
    const v = Math.round(x[i] * 255);
    im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255;
  }
  seeG.putImageData(im, 0, 0);
  if (!model) return;
  const { Z, out } = model.forward(x), best = argmax(out);
  $('pred').innerHTML = Array.from(out).map((v, c) => `
    <div class="bar${c === best ? ' top' : ''}"><div class="bl"><span>${esc(modelNames[c] ?? '?')}</span>
      <span class="num">${Math.round(v * 100)}%</span></div>
      <div class="bt"><div class="bf" style="width:${(v * 100).toFixed(1)}%"></div></div></div>`).join('');
  drawMaps(Z);
}
requestAnimationFrame(live);

// ── 모델 주고받기 ───────────────────────────────────────────
$('saveBtn').addEventListener('click', () => {
  if (!model) return;
  const body = JSON.stringify({ app: 'ml-lab-eye', v: 1, names: modelNames, notes, model: model.toJSON() });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
  a.download = `ai-eye-${modelNames.join('-').slice(0, 30) || 'model'}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('loadBtn').addEventListener('click', () => $('loadFile').click());
$('loadFile').addEventListener('change', async () => {
  const f = $('loadFile').files[0]; $('loadFile').value = '';
  if (!f) return;
  try {
    const o = JSON.parse(await f.text());
    if (o.app !== 'ml-lab-eye' || !o.model || !Array.isArray(o.names) || o.names.length !== o.model.nClass) throw new Error('bad');
    model = TinyCNN.fromJSON(o.model); modelNames = o.names.map(String);
    notes = Array.from({ length: model.F }, (_, i) => String((o.notes || [])[i] || ''));
    $('saveBtn').disabled = false;
    $('prgLabel').textContent = `${T('불러온 모델')}: ${modelNames.join(' · ')}`;
    renderFilters(); setStep(3);
    toast(T('모델을 불러왔어요. 내 그림으로 시험해 봐요'));
  } catch (e) {
    toast(T('파일을 읽지 못했어요. 내보낸 모델 파일이 맞는지 확인해 주세요'));
  }
});

// ── 시작 ────────────────────────────────────────────────────
$('engine').textContent = T('인터넷 없이 이 컴퓨터에서 배워요');
capLabel();
renderClasses();
