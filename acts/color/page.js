// ═══════════════════════════════════════════════════════════
// 색 활동 — 화면 로직
// ═══════════════════════════════════════════════════════════
// 1차시 투명 망토: 사진 위에 "망토 / 망토 아님" 을 칠해 가르치면, AI가 픽셀마다 판정해
//                망토 픽셀을 배경으로 바꾼다.
// 2차시 색 지도: 색상환 위에 AI가 그은 경계. 가까운 이웃(k) vs 작은 신경망.
// 3차시 색 고르기 로봇: 컨베이어 블록을 색으로 분류. 조명이 바뀌면 틀리고,
//                그 조명 사진으로 더 가르치면 나아진다 (로봇 시험 표로 비교).
// 칠하기가 끝날 때마다 모델을 새로 만들고 답표(LUT)를 다시 만든다 (colorcore.js).

import { KNN, ColorMLP, buildLUT, qIndex, thin, rgb2hsv, hsv2rgb } from './colorcore.js';
import { LIGHTS, BLOCKS, blocksScene, blockPatch, roomScenes, seeded } from './scenes.js';
import { classifyPatch, runRobotTest } from './robot.js';

const T = s => (typeof GL_T === 'function' ? GL_T(s) : s);
const $ = id => document.getElementById(id);

const MAX_SAMPLES = 20000;      // 이보다 많이 칠하면 더 받지 않는다 (사진 3장을 다 칠해도 남는다)
const KNN_MAX = 1500;           // 가까운 이웃 답표를 만들 때 쓰는 예시 수 (많으면 느리다)
const MLP_MAX = 3000;

const MODES = {
  cloak: {
    classes: ['망토 아님', '망토'], sel: 1, views: [['paint', '칠하기'], ['result', '투명 망토'], ['mask', 'AI가 본 것']],
    srcs: [['room', '예시 방 사진'], ['cam', '카메라']],
  },
  robot: {
    classes: ['바탕', ...BLOCKS.map(b => b.label)], sel: 1, views: [['paint', '칠하기'], ['mask', 'AI가 본 것']],
    srcs: [['normal', '보통 조명 사진'], ['dark', '어두운 조명 사진'], ['sunset', '노을 조명 사진'], ['cam', '카메라']],
  },
};
const VIEW_HINT = {
  paint: '종류를 고르고 사진 위를 칠해요. 칠한 점이 AI의 예시예요.',
  result: 'AI가 망토라고 고른 픽셀을 배경으로 바꿨어요.',
  mask: 'AI가 픽셀마다 고른 종류를, 그 종류의 색으로 칠했어요.',
};

// ── 상태 ────────────────────────────────────────────────────
let mode = 'cloak', view = 'paint', modelKind = 'knn';
const st = {};
for (const m of Object.keys(MODES)) {
  st[m] = { X: [], Y: [], dots: [], strokes: [], sel: MODES[m].sel, src: MODES[m].srcs[0][0], lut: null, swatch: [], painted: {} };
}
const S = () => st[mode];

// 예시 사진은 처음 볼 때 한 번만 만든다
const rooms = roomScenes(seeded(3));
const blocks = {};
const blockImage = light => (blocks[light] ||= blocksScene(light, seeded(11)).image);

// 카메라
let stream = null, frozen = null, freezeId = 0, camBg = null;
const camCv = document.createElement('canvas'); camCv.width = 320; camCv.height = 240;
const camG = camCv.getContext('2d', { willReadFrequently: true });

// ── 도우미 ──────────────────────────────────────────────────
let toastTimer = 0;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2400);
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const hexRgb = hex => { const h = hex.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
function setStep(n) {
  for (let i = 1; i <= 3; i++) {
    $('s' + i).classList.toggle('on', i === n);
    $('s' + i).classList.toggle('done', i < n);
  }
}
const curStep = () => [1, 2, 3].find(i => $('s' + i).classList.contains('on')) || 1;

// 지금 칠하고 보는 사진 (ImageData 모양)
function currentImage() {
  const s = S();
  if (s.src === 'cam') {
    if (frozen) return frozen;
    if (!stream || $('camVid').readyState < 2) return null;
    camG.drawImage($('camVid'), 0, 0, 320, 240);
    return camG.getImageData(0, 0, 320, 240);
  }
  return mode === 'cloak' ? rooms.person : blockImage(s.src);
}
const imageKey = () => S().src === 'cam' ? 'cam' + freezeId : mode + ':' + S().src;
const canPaint = () => S().src !== 'cam' || !!frozen;

// ── 왼쪽: 무엇을 · 사진 · 종류 ─────────────────────────────
$('modeSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.mode === mode) return;
  camStop();
  mode = b.dataset.mode;
  if (S().src === 'cam') S().src = MODES[mode].srcs[0][0];
  view = 'paint';
  $('modeSeg').querySelectorAll('button').forEach(o => o.classList.toggle('on', o === b));
  renderLeft(); renderViewSeg(); renderPhoto(); renderWheel();
  $('beltSec').style.display = mode === 'robot' ? '' : 'none';
  $('testSec').style.display = mode === 'robot' ? '' : 'none';
  setStep(mode === 'robot' && S().lut ? 3 : S().lut ? 2 : 1);
}));

function renderLeft() {
  const s = S();
  $('srcPick').innerHTML = MODES[mode].srcs.map(([id, label]) =>
    `<button class="db${s.src === id ? ' on' : ''}" data-src="${id}" type="button">
      <i class="fa-solid ${id === 'cam' ? 'fa-video' : 'fa-image'}"></i> ${T(label)}</button>`).join('');
  $('srcPick').querySelectorAll('button').forEach(b => b.addEventListener('click', () => pickSrc(b.dataset.src)));
  $('camRow').style.display = s.src === 'cam' ? '' : 'none';
  $('bgBtn').style.display = mode === 'cloak' ? '' : 'none';
  renderClasses();
  $('panTitle').textContent = T(MODES[mode].srcs.find(x => x[0] === s.src)[1]);
}

function renderClasses() {
  const s = S(), counts = MODES[mode].classes.map((_, c) => 0);
  s.Y.forEach(y => counts[y]++);
  $('clsList').innerHTML = MODES[mode].classes.map((label, c) => {
    const sw = s.swatch[c];
    return `<div class="cls clsrow${c === s.sel ? ' on' : ''}" data-c="${c}">
      <div class="top"><span class="swatch" style="${sw ? `background:rgb(${sw.join(',')})` : ''}"></span>
        <span class="nm">${T(label)}</span><span class="ct num">${counts[c]}</span></div></div>`;
  }).join('');
  $('clsList').querySelectorAll('.cls').forEach(el => el.addEventListener('click', () => { s.sel = +el.dataset.c; renderClasses(); }));
}

async function pickSrc(id) {
  const s = S();
  if (id === s.src) return;
  if (id === 'cam') { if (!(await camStart())) return; }
  else camStop();
  s.src = id;
  renderLeft(); renderPhoto();
}

// ── 카메라 ──────────────────────────────────────────────────
async function camStart() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
    const v = $('camVid'); v.srcObject = stream; await v.play();
    frozen = null; $('freezeBtn').innerHTML = `<i class="fa-solid fa-camera"></i> ${T('멈추고 칠하기')}`;
    requestAnimationFrame(camLoop);
    return true;
  } catch (e) {
    toast(T('카메라를 쓸 수 없어요. 예시 사진으로 해 보세요'));
    return false;
  }
}
function camStop() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null; frozen = null; $('camVid').srcObject = null;
}
let camLast = 0;
function camLoop(now) {
  if (!stream) return;
  requestAnimationFrame(camLoop);
  if (frozen || now - camLast < 66) return;       // 초당 15번 (저사양 PC 배려)
  camLast = now;
  renderPhoto();
}
$('freezeBtn').addEventListener('click', () => {
  if (frozen) { frozen = null; $('freezeBtn').innerHTML = `<i class="fa-solid fa-camera"></i> ${T('멈추고 칠하기')}`; return; }
  const im = currentImage(); if (!im) return;
  frozen = im; freezeId++;
  view = 'paint'; renderViewSeg();
  $('freezeBtn').innerHTML = `<i class="fa-solid fa-play"></i> ${T('다시 움직이기')}`;
  renderPhoto();
});
$('bgBtn').addEventListener('click', () => {
  const im = frozen || currentImage(); if (!im) return;
  camBg = im; toast(T('배경을 찍었어요. 이제 망토를 들고 서 보세요'));
});

// ── 칠하기 ──────────────────────────────────────────────────
const photo = $('photo');
let stroke = null;
function toImg(e) {
  const r = photo.getBoundingClientRect();
  return [Math.floor((e.clientX - r.left) * photo.width / r.width), Math.floor((e.clientY - r.top) * photo.height / r.height)];
}
photo.addEventListener('pointerdown', e => {
  if (!canPaint()) { toast(T('카메라는 "멈추고 칠하기" 를 누른 뒤 칠해요')); return; }
  photo.setPointerCapture(e.pointerId);
  stroke = { seen: new Set(), n: 0 };
  if (view !== 'paint') { view = 'paint'; renderViewSeg(); }
  dab(toImg(e));
});
photo.addEventListener('pointermove', e => { if (stroke) dab(toImg(e)); });
['pointerup', 'pointercancel'].forEach(ev => photo.addEventListener(ev, () => {
  if (!stroke) return;
  if (stroke.n) { S().strokes.push(stroke.n); rebuildSoon(); }
  stroke = null;
}));
function dab([cx, cy]) {
  const s = S(), im = currentImage(); if (!im) return;
  if (s.X.length >= MAX_SAMPLES) { toast(T('충분히 칠했어요. 되돌리기나 지우기를 써 보세요')); return; }
  const r = +$('brush').value, key = imageKey();
  for (let dy = -r; dy <= r; dy += 2) for (let dx = -r; dx <= r; dx += 2) {
    if (dx * dx + dy * dy > r * r) continue;
    const x = cx + dx, y = cy + dy;
    if (x < 0 || y < 0 || x >= im.width || y >= im.height) continue;
    const i = y * im.width + x;
    if (stroke.seen.has(i)) continue;
    stroke.seen.add(i);
    const d = im.data;
    s.X.push([d[i * 4] / 255, d[i * 4 + 1] / 255, d[i * 4 + 2] / 255]); s.Y.push(s.sel);
    s.dots.push({ key, x, y, c: s.sel, src: s.src });
    stroke.n++;
  }
  drawDots();
}
$('undoBtn').addEventListener('click', () => {
  const s = S(), n = s.strokes.pop(); if (!n) return;
  s.X.length -= n; s.Y.length -= n; s.dots.length -= n;
  rebuildSoon();
});
$('clearBtn').addEventListener('click', () => {
  const s = S(); if (!s.X.length || !confirm(T('칠한 것을 모두 지울까요?'))) return;
  s.X = []; s.Y = []; s.dots = []; s.strokes = [];
  rebuildSoon();
});
$('brush').addEventListener('input', () => { $('brushVal').textContent = $('brush').value; });

// ── 모델 다시 만들기 ────────────────────────────────────────
let rebuildTimer = 0;
function rebuildSoon() { clearTimeout(rebuildTimer); $('busy').style.display = ''; rebuildTimer = setTimeout(rebuild, 30); }
function rebuild() {
  const s = S(), nClass = MODES[mode].classes.length;
  // 종류별 평균 색 = 화면에 쓰는 그 종류의 색
  const sum = Array.from({ length: nClass }, () => [0, 0, 0, 0]);
  s.X.forEach((x, n) => { const a = sum[s.Y[n]]; a[0] += x[0]; a[1] += x[1]; a[2] += x[2]; a[3]++; });
  s.swatch = sum.map(a => a[3] ? a.slice(0, 3).map(v => Math.round(v / a[3] * 255)) : null);
  s.painted = {};
  s.dots.forEach(d => { s.painted[d.src] = (s.painted[d.src] || 0) + 1; });
  const withData = sum.filter(a => a[3]).length;
  if (withData < 2) s.lut = null;
  else if (modelKind === 'knn') {
    const t = thin(s.X, s.Y, KNN_MAX);
    s.lut = buildLUT(new KNN(+$('k').value).fit(t.X, t.Y, nClass));
  } else {
    const t = thin(s.X, s.Y, MLP_MAX), m = new ColorMLP(nClass);
    m.fit(t.X, t.Y, { epochs: 40 });
    s.lut = buildLUT(m);
  }
  $('busy').style.display = 'none';
  if (s.lut && curStep() === 1) setStep(2);
  renderClasses(); renderPhoto(); renderWheel();
}

// ── AI 고르기 ───────────────────────────────────────────────
$('modelSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  modelKind = b.dataset.model;
  $('modelSeg').querySelectorAll('button').forEach(o => o.classList.toggle('on', o === b));
  $('kRow').style.display = modelKind === 'knn' ? '' : 'none';
  $('modelHint').textContent = modelKind === 'knn'
    ? T('가장 비슷한 색 k개를 찾아 많은 쪽으로 골라요.')
    : T('칠한 색으로 작은 신경망을 배워요. 경계가 매끈해져요.');
  rebuildSoon();
}));
$('k').addEventListener('input', () => { $('kVal').textContent = $('k').value; });
$('k').addEventListener('change', rebuildSoon);

// ── 가운데: 보기 ────────────────────────────────────────────
function renderViewSeg() {
  $('viewSeg').innerHTML = MODES[mode].views.map(([id, label]) =>
    `<button type="button" data-view="${id}" class="${view === id ? 'on' : ''}">${T(label)}</button>`).join('');
  $('viewSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    view = b.dataset.view; renderViewSeg(); renderPhoto();
  }));
  $('viewHint').textContent = T(VIEW_HINT[view]);
}

const work = { im: null };
function renderPhoto() {
  const im = currentImage();
  const g = photo.getContext('2d');
  if (!im) { g.fillStyle = css('--panel2'); g.fillRect(0, 0, photo.width, photo.height); return; }
  if (photo.width !== im.width || photo.height !== im.height) { photo.width = im.width; photo.height = im.height; }
  const s = S(), lut = s.lut;
  if (view === 'paint' || !lut) { g.putImageData(toImageData(im), 0, 0); drawDots(); return; }
  if (!work.im || work.im.width !== im.width || work.im.height !== im.height) work.im = g.createImageData(im.width, im.height);
  const src = im.data, out = work.im.data, n = im.width * im.height;
  const bg = mode === 'cloak' ? (s.src === 'cam' ? camBg : rooms.background) : null;
  const paper = hexRgb(css('--panel2')), acc = hexRgb(css('--acc'));
  for (let i = 0; i < n; i++) {
    const c = lut.cls[qIndex(src[i * 4], src[i * 4 + 1], src[i * 4 + 2])];
    let r = src[i * 4], gg = src[i * 4 + 1], b = src[i * 4 + 2];
    if (view === 'result') {
      if (c === 1) {
        if (bg) { r = bg.data[i * 4]; gg = bg.data[i * 4 + 1]; b = bg.data[i * 4 + 2]; }
        else [r, gg, b] = paper;
      }
    } else if (mode === 'cloak') {
      // AI가 본 것: 망토 = 남색 펜, 나머지 = 흐리게
      if (c === 1) [r, gg, b] = acc;
      else { r = (r + 2 * 255) / 3; gg = (gg + 2 * 255) / 3; b = (b + 2 * 255) / 3; }
    } else {
      const sw = s.swatch[c] || paper;
      [r, gg, b] = sw;
    }
    out[i * 4] = r; out[i * 4 + 1] = gg; out[i * 4 + 2] = b; out[i * 4 + 3] = 255;
  }
  g.putImageData(work.im, 0, 0);
}
function toImageData(im) {
  if (im instanceof ImageData) return im;
  const out = new ImageData(im.width, im.height); out.data.set(im.data); return out;
}
function drawDots() {
  if (view !== 'paint') return;
  const s = S(), key = imageKey(), g = photo.getContext('2d');
  g.lineWidth = 1; g.strokeStyle = css('--panel');
  for (const d of s.dots) {
    if (d.key !== key) continue;
    const sw = s.swatch[d.c];
    g.fillStyle = sw ? `rgb(${sw.join(',')})` : css('--acc');
    g.fillRect(d.x - 1, d.y - 1, 2, 2);
  }
}

// ── 오른쪽: 색 지도 ─────────────────────────────────────────
const wheel = $('wheel');
function renderWheel() {
  const g = wheel.getContext('2d'), W = wheel.width, R = W / 2 - 4, c0 = W / 2;
  const s = S(), lut = s.lut, v = +$('v').value / 100;
  const im = g.createImageData(W, W), cls = new Int16Array(W * W).fill(-1);
  const paper = hexRgb(css('--panel')), line = hexRgb(css('--ink'));
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const dx = x - c0, dy = y - c0, r = Math.hypot(dx, dy), i = y * W + x;
    let col = paper;
    if (r <= R) {
      const h = (Math.atan2(dy, dx) / (2 * Math.PI) + 1) % 1;
      const rgb = hsv2rgb(h, r / R, v).map(u => Math.round(u * 255));
      if (lut) { const k = lut.cls[qIndex(rgb[0], rgb[1], rgb[2])]; cls[i] = k; col = s.swatch[k] || rgb; }
      else col = rgb;
    }
    im.data.set([col[0], col[1], col[2], 255], i * 4);
  }
  // 경계선: 옆 칸과 종류가 다르면 진하게
  if (lut) for (let y = 1; y < W - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (cls[i] < 0) continue;
    if ((cls[i + 1] >= 0 && cls[i + 1] !== cls[i]) || (cls[i + W] >= 0 && cls[i + W] !== cls[i])) im.data.set([...line, 255], i * 4);
  }
  g.putImageData(im, 0, 0);
  // 칠한 예시 중 지금 밝기와 비슷한 것만 점으로
  g.lineWidth = 1; g.strokeStyle = css('--ink');
  let shown = 0;
  for (let n = 0; n < s.X.length && shown < 500; n += Math.max(1, Math.floor(s.X.length / 500))) {
    const [h, sat, val] = rgb2hsv(...s.X[n]);
    if (Math.abs(val - v) > 0.12) continue;
    const a = h * 2 * Math.PI, px = c0 + Math.cos(a) * sat * R, py = c0 + Math.sin(a) * sat * R;
    g.fillStyle = `rgb(${s.X[n].map(u => Math.round(u * 255)).join(',')})`;
    g.beginPath(); g.arc(px, py, 2.6, 0, Math.PI * 2); g.fill(); g.stroke();
    shown++;
  }
}
$('v').addEventListener('input', () => { $('vVal').textContent = $('v').value + '%'; renderWheel(); });

// ── 로봇 시험 ───────────────────────────────────────────────
const testRows = [];
const LIGHT_IDS = Object.keys(LIGHTS);
const LIGHT_SHORT = { normal: '보통', dark: '어둡게', sunset: '노을' };
$('testBtn').addEventListener('click', () => {
  const s = st.robot;
  if (!s.lut) { toast(T('먼저 두 가지 이상 칠해서 가르쳐 주세요')); return; }
  const r = runRobotTest(s.lut);
  const taught = ['normal', 'dark', 'sunset', 'cam'].filter(k => s.painted[k]).map(k => T(k === 'cam' ? '카메라' : LIGHT_SHORT[k]));
  testRows.push({ model: modelKind === 'knn' ? `${T('이웃')} k=${$('k').value}` : T('신경망'), taught: taught.join('+'), r });
  const pct = v => `<td class="num${v < 0.8 ? ' low' : ''}">${Math.round(v * 100)}%</td>`;
  $('testTable').innerHTML = `<table class="mk-table exam">
    <tr><th>${T('AI')}</th><th>${T('가르친 사진')}</th>${LIGHT_IDS.map(l => `<th>${T(LIGHT_SHORT[l])}</th>`).join('')}</tr>
    ${testRows.map(t => `<tr><td class="nm">${esc(t.model)}</td><td class="nm">${esc(t.taught)}</td>${LIGHT_IDS.map(l => pct(t.r[l])).join('')}</tr>`).join('')}
  </table>`;
  const w = r.worst;
  $('testNote').textContent = w
    ? T('가장 많이 틀린 것: {light}에서 {truth} → {got} ({n}번)')
        .replace('{light}', T(LIGHTS[w[0]].label)).replace('{truth}', T(MODES.robot.classes[w[1]]))
        .replace('{got}', T(MODES.robot.classes[w[2]])).replace('{n}', w[3])
    : T('모든 조명에서 다 맞혔어요!');
  setStep(3);
});

// ── 컨베이어 (구경용) ──────────────────────────────────────
let beltLight = 'normal', beltRun = null;
$('beltLight').innerHTML = LIGHT_IDS.map(l => `<button type="button" data-l="${l}" class="${l === beltLight ? 'on' : ''}">${T(LIGHT_SHORT[l])}</button>`).join('');
$('beltLight').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  beltLight = b.dataset.l; $('beltLight').querySelectorAll('button').forEach(o => o.classList.toggle('on', o === b));
}));
const patchCv = document.createElement('canvas'); patchCv.width = patchCv.height = 24;
// 벨트 속도 (픽셀/초). 블록 간격이 70이라 보통이면 1초에 한 개씩 로봇 눈을 지난다.
// 예전 110 은 0.64초마다 하나라 맞았는지(○×) 읽기 전에 다음 블록이 왔다.
let beltSpeed = 70;
$('beltSpeed').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  beltSpeed = +b.dataset.s;
  $('beltSpeed').querySelectorAll('button').forEach(o => o.classList.toggle('on', o === b));
}));
$('beltGo').addEventListener('click', () => {
  if (!st.robot.lut) { toast(T('먼저 두 가지 이상 칠해서 가르쳐 주세요')); return; }
  const rnd = seeded((Math.random() * 1e9) | 0);
  beltRun = { t0: performance.now(), items: [], light: beltLight, ok: 0, done: 0, rnd, total: 12 };
  for (let n = 0; n < beltRun.total; n++) {
    const b = (rnd() * BLOCKS.length) | 0;
    const p = blockPatch(BLOCKS[b].rgb, LIGHTS[beltLight], rnd);
    const cv = document.createElement('canvas'); cv.width = cv.height = 24;
    cv.getContext('2d').putImageData(new ImageData(p.data, 24, 24), 0, 0);
    beltRun.items.push({ b, p, cv, x: 60 - n * 70, got: null });   // 첫 블록은 벨트 위에서 출발 (느리게여도 4초 안에 로봇 눈에 닿는다)
  }
  requestAnimationFrame(beltLoop);
  setStep(3);
});
function beltLoop(now) {
  if (!beltRun) return;
  const cv = $('belt'), g = cv.getContext('2d'), W = cv.width, H = cv.height, run = beltRun;
  const dt = Math.min(0.05, (now - (run.last || now)) / 1000); run.last = now;
  const L = LIGHTS[run.light];
  const belt = [0.36, 0.36, 0.38].map((c, i) => Math.round(Math.min(1, c * L.rgb[i] * L.k) * 255));
  g.fillStyle = css('--panel2'); g.fillRect(0, 0, W, H);
  g.fillStyle = `rgb(${belt.join(',')})`; g.fillRect(0, 44, W, 56);
  const scanX = W / 2;
  g.strokeStyle = css('--acc'); g.setLineDash([4, 4]); g.lineWidth = 2;
  g.strokeRect(scanX - 22, 38, 44, 68); g.setLineDash([]);
  g.fillStyle = css('--ink3'); g.font = '11px sans-serif'; g.textAlign = 'center';
  g.fillText(T('로봇 눈'), scanX, 116);
  for (const it of run.items) {
    it.x += beltSpeed * dt;
    if (it.got === null && it.x >= scanX - 18) {
      it.got = classifyPatch(st.robot.lut, it.p);
      run.done++; if (it.got === it.b + 1) run.ok++;
      $('beltScore').textContent = `${run.ok} / ${run.done}`;
    }
    if (it.x > -40 && it.x < W + 40) {
      g.imageSmoothingEnabled = false;
      g.drawImage(it.cv, it.x, 54, 36, 36);
      if (it.got !== null) {
        const ok = it.got === it.b + 1;
        g.fillStyle = ok ? css('--ok') : css('--warn');
        g.font = 'bold 12px sans-serif';
        g.fillText(`${T(MODES.robot.classes[it.got])} ${ok ? '○' : '×'}`, it.x + 18, 30);
      }
    }
  }
  if (run.items[run.items.length - 1].x > W + 40) { beltRun = null; return; }
  requestAnimationFrame(beltLoop);
}

// ── 시작 ────────────────────────────────────────────────────
$('engine').textContent = T('인터넷 없이 이 컴퓨터에서 배워요');
renderLeft(); renderViewSeg(); renderPhoto(); renderWheel();
