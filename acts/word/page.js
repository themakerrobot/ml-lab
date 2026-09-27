// ═══════════════════════════════════════════════════════════
// 문장 활동 — 화면 로직
// ═══════════════════════════════════════════════════════════
// 흐름: 글 넣기 → 배우기(워커) → 이어 쓰기 → 들여다보기 / 맞히기 대결
// 계산은 전부 worker.js 에서 한다. 여기서는 화면만 다룬다.

import { PRESETS } from './presets.js';

const T = s => (typeof GL_T === 'function' ? GL_T(s) : s);
const LANG = (typeof GL_LANG === 'string') ? GL_LANG : 'ko';
const $ = id => document.getElementById(id);

const MAX_CHARS = 5000;                      // 저사양 PC 에서 한 수업 안에 끝나는 크기
const STEPS = { mlp: 1500, gpt: 400 };       // 한 번 "배우기"에 하는 연습 횟수

// ── 워커 RPC ────────────────────────────────────────────────
const worker = new Worker('acts/word/worker.js', { type: 'module' });
let seq = 0;
const pending = new Map();
function call(type, body = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, type, ...body });
  });
}
worker.onmessage = ({ data: m }) => {
  if (m.id) {
    const p = pending.get(m.id); pending.delete(m.id);
    m.ok ? p.resolve(m) : p.reject(new Error(m.error));
  } else if (m.type === 'progress') onProgress(m);
  else if (m.type === 'done') onDone(m);
};
worker.onerror = e => { toast(T('불러오지 못했어요. 새로고침해 주세요')); console.error(e); };

// ── 상태 ────────────────────────────────────────────────────
let kind = 'mlp';
let trained = null;          // { kind, corpus } — 배운 모델의 정보
let training = false;
let losses = [];             // [step, loss]
let lastTarget = 0;
let duel = null, score = { me: 0, ai: 0 };

// ── 공통 도우미 ─────────────────────────────────────────────
let toastTimer = 0;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2200);
}
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const shown = ch => ch === '\n' ? '↵' : ch === ' ' ? '␣' : ch;

function setStep(n) {
  for (let i = 1; i <= 4; i++) {
    const el = $('s' + i);
    el.classList.toggle('on', i === n);
    el.classList.toggle('done', i < n);
  }
}

// ── 1. 글 넣기 ──────────────────────────────────────────────
const presets = PRESETS[LANG] || PRESETS.ko;
presets.forEach((p, i) => {
  const b = document.createElement('button');
  b.className = 'db'; b.type = 'button'; b.textContent = p.label;
  b.addEventListener('click', () => usePreset(i));
  $('presetRow').appendChild(b);
});
function usePreset(i) {
  $('corpus').value = presets[i].text;
  $('seed').value = presets[i].seed;
  [...$('presetRow').children].forEach((b, j) => b.classList.toggle('on', j === i));
  corpusInfo();
}
function corpusInfo() {
  const t = $('corpus').value;
  const kinds = new Set(Array.from(t.replace(/\n/g, ''))).size;
  $('corpusInfo').textContent = `${T('글자')} ${Array.from(t).length.toLocaleString()} · ${T('글자 종류')} ${kinds}`
    + (Array.from(t).length > MAX_CHARS ? ` — ${T('앞쪽 5000글자만 배워요')}` : '');
}
$('corpus').addEventListener('input', () => {
  [...$('presetRow').children].forEach(b => b.classList.remove('on'));
  corpusInfo();
});
usePreset(0);

// AI 고르기
document.querySelectorAll('#modelPick .mradio').forEach(el => {
  el.addEventListener('click', () => {
    if (training) return;
    kind = el.dataset.kind;
    document.querySelectorAll('#modelPick .mradio').forEach(o => o.classList.toggle('on', o === el));
    $('ctxRow').style.display = kind === 'mlp' ? '' : 'none';
  });
});
$('ctx').addEventListener('input', () => { $('ctxVal').textContent = $('ctx').value; });

// ── 2. 배우기 ───────────────────────────────────────────────
function setTraining(on) {
  training = on;
  $('trainBtn').disabled = on;
  $('stopBtn').disabled = !on;
  $('moreBtn').disabled = on || !trained;
  document.querySelectorAll('#modelPick .mradio').forEach(o => o.classList.toggle('lock', on));
  $('ctx').disabled = on;
  $('corpus').disabled = on;
  [...$('presetRow').children].forEach(b => { b.disabled = on; });
}

$('trainBtn').addEventListener('click', async () => {
  let text = $('corpus').value.trim();
  if (Array.from(text).length > MAX_CHARS) text = Array.from(text).slice(0, MAX_CHARS).join('');
  const lines = text.split('\n').filter(l => l.trim());
  if (Array.from(text).length < 20 || !lines.length) { toast(T('글이 너무 짧아요. 조금 더 써 주세요')); return; }

  losses = []; drawChart();
  trained = null; resetOutputs();
  setTraining(true); setStep(2);
  $('prgLabel').textContent = T('배우는 중');
  const ctx = +$('ctx').value;
  try {
    const info = await call('train', { kind, text, ctx, steps: STEPS[kind] });
    lastTarget = STEPS[kind];
    trained = { kind, corpus: text, ctx: info.ctx };
    $('trainInfo').textContent =
      `${T('글자 종류')} ${info.vocab} · ${T('AI 속 숫자')} ${info.params.toLocaleString()}`;
  } catch (e) {
    setTraining(false); toast(T('배우다가 멈췄어요. 다시 해 보세요'));
  }
});

$('moreBtn').addEventListener('click', async () => {
  if (!trained || training) return;
  setTraining(true);
  $('prgLabel').textContent = T('더 배우는 중');
  lastTarget = STEPS[trained.kind];
  await call('more', { steps: STEPS[trained.kind] });
});

$('stopBtn').addEventListener('click', () => call('stop'));

let runStart = 0;
function onProgress(m) {
  if (!losses.length || m.step < losses[losses.length - 1][0]) runStart = m.step - 10;
  losses.push([m.step, m.loss]);
  const done = m.step - (m.target - lastTarget);
  const pct = Math.min(100, Math.round(done / lastTarget * 100));
  $('prgFill').style.width = pct + '%';
  $('prgPct').textContent = pct + '%';
  drawChart();
}

function onDone(m) {
  setTraining(false);
  $('prgFill').style.width = '100%';
  $('prgPct').textContent = '';
  $('prgLabel').textContent = m.stopped ? T('멈췄어요. 지금까지 배운 걸로 해 봐요') : T('다 배웠어요');
  $('trainInfo').textContent += ` · ${T('연습')} ${m.step.toLocaleString()}${T('번')} · ${m.sec.toFixed(1)}${T('초')}`;
  ['genBtn', 'stepBtn', 'duelNew'].forEach(id => { $(id).disabled = false; });
  setStep(3);
  refresh();
  newDuel();
}

// 학습 곡선 — 공통 규격 색(토큰)만 쓴다
function drawChart() {
  const c = $('chart'), dpr = window.devicePixelRatio || 1;
  const W = c.clientWidth, H = c.clientHeight;
  if (!W || !H) return;
  c.width = W * dpr; c.height = H * dpr;
  const g = c.getContext('2d'); g.scale(dpr, dpr);
  g.clearRect(0, 0, W, H);
  if (losses.length < 2) return;
  const css = getComputedStyle(document.documentElement);
  const maxS = losses[losses.length - 1][0], maxL = Math.max(...losses.map(l => l[1]));
  g.strokeStyle = css.getPropertyValue('--acc').trim() || '#1F5F7A';
  g.lineWidth = 2; g.beginPath();
  losses.forEach(([s, l], i) => {
    const x = 6 + s / maxS * (W - 12), y = H - 6 - l / maxL * (H - 12);
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  });
  g.stroke();
}
window.addEventListener('resize', drawChart);

// ── 3. 이어 쓰기 ────────────────────────────────────────────
function resetOutputs() {
  $('out').className = 'answer idk';
  $('out').textContent = T('배운 뒤에 이어 쓸 수 있어요');
  $('madeNote').style.display = 'none';
  $('probs').innerHTML = `<div class="hint" style="margin-top:0">${T('배운 뒤에 보여요')}</div>`;
  $('look').innerHTML = `<div class="hint" style="margin-top:0">${T('배운 뒤에 AI가 어느 글자를 보는지 나와요')}</div>`;
  $('unkNote').style.display = 'none';
  ['genBtn', 'stepBtn', 'duelNew', 'duelGo'].forEach(id => { $(id).disabled = true; });
  $('duelIn').disabled = true;
}

$('temp').addEventListener('input', () => { $('tempVal').textContent = (+$('temp').value).toFixed(1); });

// 문장 단위로 잘라서, 가르친 글에 없는 문장에 밑줄을 친다 (환각 보기)
// 반환: 밑줄 칠 [시작, 끝) 범위들 (full 의 글자 위치)
function madeRanges(full, seedLen) {
  const corpus = trained.corpus.replace(/\s+/g, ' ');
  const out = [], re = /[^.!?\n]+[.!?]*/g;
  let m;
  while ((m = re.exec(full))) {
    const s = m[0].trim().replace(/\s+/g, ' ');
    const end = m.index + m[0].length;
    // 끝나지 않은 마지막 조각도 따진다. 사용자가 쓴 부분 안에서 끝나는 조각은 뺀다
    if (end > seedLen && s.length > 1 && !corpus.includes(s)) out.push([Math.max(m.index, seedLen), end]);
  }
  return out;
}

$('genBtn').addEventListener('click', async () => {
  const seed = $('seed').value;
  const r = await call('generate', { seed, temp: +$('temp').value });
  const full = seed + r.text;
  const made = madeRanges(full, seed.length);
  const inMade = i => made.some(([a, b]) => i >= a && i < b);
  // 글자마다 [사용자 글 / 지어낸 문장] 표시가 같은 것끼리 묶어서 그린다
  let html = '', cur = null, buf = '';
  const flush = () => { if (!buf) return;
    html += cur === 'seed' ? `<span class="seedtxt">${esc(buf)}</span>` : cur === 'made' ? `<span class="made">${esc(buf)}</span>` : esc(buf);
    buf = ''; };
  for (let i = 0; i < full.length; i++) {
    const c = i < seed.length ? 'seed' : inMade(i) ? 'made' : 'gen';
    if (c !== cur) { flush(); cur = c; }
    buf += full[i];
  }
  flush();
  $('out').className = 'answer gen';
  $('out').innerHTML = html || esc(full);
  $('madeNote').style.display = made.length ? '' : 'none';
  setStep(4);
});

$('stepBtn').addEventListener('click', async () => {
  const seed = $('seed').value;
  const r = await call('step', { seed, temp: +$('temp').value });
  if (r.ch === '\n') { toast(T('여기서 문장이 끝났대요')); return; }
  $('seed').value = seed + r.ch;
  refresh();
});

let refreshTimer = 0;
$('seed').addEventListener('input', () => {
  clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 150);
});

async function refresh() {
  if (!trained || training) return;
  const seed = $('seed').value;
  const [p, l] = await Promise.all([call('probs', { prefix: seed, k: 5 }), call('look', { text: seed })]);
  $('probs').innerHTML = p.top.map(([ch, v], i) => `
    <div class="bar${i === 0 ? ' top' : ''}">
      <div class="bl"><span class="ch">${esc(shown(ch))}</span><span class="num">${(v * 100).toFixed(1)}%</span></div>
      <div class="bt"><div class="bf" style="width:${(v * 100).toFixed(1)}%"></div></div>
    </div>`).join('');
  if (p.unknown.length) {
    $('unkNote').style.display = '';
    $('unkNote').textContent = `${T('배운 적 없는 글자예요')}: ${p.unknown.join(' ')}`;
  } else $('unkNote').style.display = 'none';
  drawLook(l);
}

// ── 4. 들여다보기 ───────────────────────────────────────────
let lookLayer = 0, lookHead = 0, lastLook = null;

function drawLook(l) {
  lastLook = l;
  if (l.kind === 'mlp') {
    $('look').innerHTML = `
      <div class="pb-label">${T('AI가 보는 글자')}</div>
      <div class="chips">${l.window.map(ch => `<span class="chip on">${esc(shown(ch))}</span>`).join('')}
        <span class="chip q">?</span></div>
      <div class="hint">${T('작은 신경망은 바로 앞 글자 몇 개만 봐요.')}<br>
        ${T('· 는 줄 앞의 빈칸이에요.')} ${T('더 앞의 글자는 몰라요.')}</div>`;
    return;
  }
  const { chars, A } = l;
  const tabs = [];
  A.forEach((heads, li) => heads.forEach((_, hi) => tabs.push([li, hi])));
  const M = A[lookLayer][lookHead], last = M.length - 1;
  const head = `<tr><th></th>${chars.map(c => `<th>${esc(shown(c))}</th>`).join('')}</tr>`;
  const rows = M.map((row, t) => `<tr class="${t === last ? 'last' : ''}"><th>${esc(shown(chars[t]))}</th>${row.map((v, s) =>
    s <= t ? `<td title="${(v * 100).toFixed(0)}%"><i style="opacity:${v.toFixed(3)}"></i></td>` : '<td class="off"></td>').join('')}</tr>`).join('');
  // 마지막 글자가 가장 많이 본 글자
  const best = M[last].indexOf(Math.max(...M[last]));
  $('look').innerHTML = `
    <div class="seg" id="headSeg">${tabs.map(([li, hi]) =>
      `<button type="button" data-l="${li}" data-h="${hi}" class="${li === lookLayer && hi === lookHead ? 'on' : ''}">${li + 1}${T('층')}·${T('눈')}${hi + 1}</button>`).join('')}</div>
    <div class="att-wrap"><table class="att">${head}${rows}</table></div>
    <div class="hint">${T('줄마다 그 글자가 앞의 어느 글자를 봤는지예요.')}
      ${T('진할수록 많이 봤어요.')}<br>
      ${T('가장 많이 본 글자: {a} → {b}')
        .replace('{a}', `<b>${esc(shown(chars[last]))}</b>`)
        .replace('{b}', `<b>${esc(shown(chars[best]))}</b>`)} (${(M[last][best] * 100).toFixed(0)}%)</div>`;
  $('headSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    lookLayer = +b.dataset.l; lookHead = +b.dataset.h; drawLook(lastLook);
  }));
}

// ── 맞히기 대결 ────────────────────────────────────────────
// 문제는 지금 문장만 보여 준다 (앞 문장은 … 로). AI에게는 줄 처음부터 준다
function duelShown(prefix) {
  const cut = Math.max(prefix.lastIndexOf('. '), prefix.lastIndexOf('? '), prefix.lastIndexOf('! '));
  return cut >= 0 ? '… ' + prefix.slice(cut + 2) : prefix;
}

function newDuel() {
  if (!trained) return;
  const lines = trained.corpus.split('\n').map(s => s.trim()).filter(s => Array.from(s).length >= 4);
  const line = Array.from(lines[(Math.random() * lines.length) | 0]);
  // 답이 될 자리: 빈칸·문장부호·기호(× =)가 아니고, 지금 문장 안에서 앞에 2글자 이상 있는 곳
  const cand = [];
  let sentStart = 0;
  for (let i = 0; i < line.length; i++) {
    if (i > 0 && /[.!?]/.test(line[i - 1])) sentStart = i + (line[i] === ' ' ? 1 : 0);
    const lone = line[i - 1] === ' ' && line[i + 1] === ' ';    // 영어 구구단의 x 같은 홀로 선 기호
    if (i - sentStart >= 2 && !lone && !/[\s.!?,×=]/.test(line[i])) cand.push(i);
  }
  const k = cand.length ? cand[(Math.random() * cand.length) | 0] : line.length - 1;
  duel = { prefix: line.slice(0, k).join(''), answer: line[k] };
  $('duelQ').innerHTML = `${esc(duelShown(duel.prefix))}<span class="blank">?</span>`;
  $('duelIn').value = ''; $('duelIn').disabled = false; $('duelGo').disabled = false;
  $('duelMsg').textContent = T('다음 글자를 써 보세요');
}

async function playDuel() {
  if (!duel) return;
  const mine = Array.from($('duelIn').value.trim())[0];
  if (!mine) { toast(T('한 글자를 써 주세요')); return; }
  const p = await call('probs', { prefix: duel.prefix, k: 1 });
  const [aiCh, aiP] = p.top[0];
  const meOk = mine === duel.answer, aiOk = aiCh === duel.answer;
  if (meOk) score.me++;
  if (aiOk) score.ai++;
  $('scoreMe').textContent = score.me; $('scoreAi').textContent = score.ai;
  $('duelQ').innerHTML = `${esc(duelShown(duel.prefix))}<span class="blank ok">${esc(shown(duel.answer))}</span>`;
  $('duelMsg').textContent =
    `${T('정답')} '${shown(duel.answer)}' · ${T('나')} '${mine}' ${meOk ? '○' : '×'} · ` +
    `AI '${shown(aiCh)}' (${(aiP * 100).toFixed(0)}%) ${aiOk ? '○' : '×'}`;
  $('duelIn').disabled = true; $('duelGo').disabled = true;
  duel = null;
}
$('duelNew').addEventListener('click', newDuel);
$('duelGo').addEventListener('click', playDuel);
$('duelIn').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) playDuel(); });

$('engine').textContent = T('인터넷 없이 이 컴퓨터에서 배워요');
setTraining(false);
