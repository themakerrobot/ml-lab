// ═══════════════════════════════════════════════════════════
// 공정 활동 — 화면 로직
// ═══════════════════════════════════════════════════════════
// 1차시 지난 기록으로 결정 나무 AI 만들기, 나무 읽기
// 2차시 올해 지원자(두 반 실력 같음)로 반별 합격률 비교 → "반" 빼기 → 버스가 대신(대리 변수)
//       지원자 한 명 넣어 보기: 실력은 그대로 두고 반·버스만 바꾸기
// 3차시 기록 고치기(실력 기준으로 다시 심사) · 2반 기록 늘리기 → 비교표로 정리

import { FEATURES, pastData, thisYear, buildTree, predict, audit, usedFeatures } from './fair.js';

const T = s => (typeof GL_T === 'function' ? GL_T(s) : s);
const $ = id => document.getElementById(id);

const BIAS_LEVELS = [[0, '없음'], [0.12, '조금'], [0.25, '많이'], [0.35, '아주 많이']];
const FEAT = Object.fromEntries(FEATURES.map(f => [f.id, f]));
const test = thisYear();

let rows = [], tree = null, treeFeats = [];
const logRows = [];

// ── 도우미 ──────────────────────────────────────────────────
let toastTimer = 0;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2400);
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = v => Math.round(v * 100) + '%';
function setStep(n) {
  for (let i = 1; i <= 3; i++) {
    $('s' + i).classList.toggle('on', i === n);
    $('s' + i).classList.toggle('done', i < n);
  }
}
const curStep = () => [1, 2, 3].find(i => $('s' + i).classList.contains('on')) || 1;
const labelKey = () => $('fixLabel').checked ? 'fit' : 'passed';

// 질문 문장: 숫자는 "5시간 이상?", 예/아니요는 "2반인가?"
function question(f, th) {
  const d = FEAT[f];
  if (d.kind === 'bool') return f === 'class2' ? T('2반인가?') : T('통학 버스를 타나?');
  return `${T(d.label)} ${Math.ceil(th)}${T(d.unit)} ${T('이상?')}`;
}

// ── 지난 기록 ───────────────────────────────────────────────
function makeRows() {
  const bias = BIAS_LEVELS[+$('bias').value][0];
  rows = pastData({ n2: +$('n2').value, bias });
  $('n2Val').textContent = `${$('n2').value}${T('명')}`;
  $('biasVal').textContent = T(BIAS_LEVELS[+$('bias').value][1]);
  const lk = labelKey(), g = [0, 1].map(c => rows.filter(r => r.class2 === c));
  const rate = a => a.length ? a.reduce((s, r) => s + r[lk], 0) / a.length : 0;
  $('dataSummary').innerHTML = `
    <div class="sumrow"><span>${T('1반')} ${g[0].length}${T('명')}</span><div class="bt"><div class="bf" style="width:${rate(g[0]) * 100}%"></div></div><span class="num">${T('합격')} ${pct(rate(g[0]))}</span></div>
    <div class="sumrow"><span>${T('2반')} ${g[1].length}${T('명')}</span><div class="bt"><div class="bf" style="width:${rate(g[1]) * 100}%"></div></div><span class="num">${T('합격')} ${pct(rate(g[1]))}</span></div>`;
  // 앞쪽 몇 명 (두 반 섞어서)
  const sample = [];
  for (let i = 0; sample.length < 8 && i < rows.length; i++) {
    const r = rows[(i * 37) % rows.length];
    if (!sample.includes(r)) sample.push(r);
  }
  $('dataTable').innerHTML = `<tr><th>${T('반')}</th><th>${T('버스')}</th><th>${T('연습')}</th><th>${T('작품')}</th><th>${T('출석')}</th><th>${T('결과')}</th></tr>` +
    sample.map(r => `<tr><td>${r.class2 ? 2 : 1}</td><td>${r.bus ? '○' : ''}</td><td class="num">${r.practice}</td><td class="num">${r.works}</td>
      <td class="num">${r.attend}</td><td class="${r[lk] ? 'ok' : 'low'}">${r[lk] ? T('합격') : T('불합격')}</td></tr>`).join('');
}
['n2', 'bias'].forEach(id => $(id).addEventListener('input', () => { makeRows(); if (tree) setStep(3); }));
$('fixLabel').addEventListener('change', () => { makeRows(); if (tree) setStep(3); });

// ── 특징 고르기 ─────────────────────────────────────────────
$('feats').innerHTML = FEATURES.map(f => `
  <label class="feat${f.id === 'class2' || f.id === 'bus' ? ' warnish' : ''}"><input type="checkbox" data-f="${f.id}" checked>
    <i class="fa-solid ${{ practice: 'fa-clock', works: 'fa-laptop-code', attend: 'fa-calendar-check', class2: 'fa-users', bus: 'fa-bus' }[f.id]}"></i> ${T(f.label)}</label>`).join('');
$('depth').addEventListener('input', () => { $('depthVal').textContent = $('depth').value; });

// ── AI 만들기 ───────────────────────────────────────────────
$('trainBtn').addEventListener('click', () => {
  treeFeats = [...$('feats').querySelectorAll('input:checked')].map(i => i.dataset.f);
  if (!treeFeats.length) { toast(T('볼 수 있는 정보를 하나 이상 골라 주세요')); return; }
  tree = buildTree(rows, labelKey(), treeFeats, { maxDepth: +$('depth').value });
  renderTree(); renderResult(); renderWhatIf();
  if (curStep() === 1) setStep(2);
});

function renderTree() {
  const node = t => {
    if (t.leaf) {
      return `<div class="tnode leaf ${t.pass ? 'pass' : 'fail'}"><b>${t.pass ? T('합격') : T('불합격')}</b>
        <span class="num">${T('기록')} ${t.n}${T('명')} ${T('중')} ${T('합격')} ${t.pos}</span></div>`;
    }
    return `<div class="tnode q${t.f === 'class2' || t.f === 'bus' ? ' flag' : ''}">${esc(question(t.f, t.th))}</div>
      <div class="tkids">
        <div class="tkid"><div class="tedge">${T('예')}</div>${node(t.yes)}</div>
        <div class="tkid"><div class="tedge">${T('아니요')}</div>${node(t.no)}</div>
      </div>`;
  };
  const used = usedFeatures(tree);
  $('tree').innerHTML = `<div class="treewrap"><div class="tree">${node(tree)}</div></div>
    <div class="hint">${T('AI가 쓴 정보')}: ${[...used].map(f => T(FEAT[f].label)).join(', ') || T('없음')}
    ${used.has('class2') || used.has('bus') ? `<br><b class="warnt">${T('실력과 상관없는 정보로 고르고 있어요!')}</b>` : ''}</div>`;
}

function renderResult() {
  const a = audit(tree, test);
  const bar = (label, v, cls = '') => `<div class="bar${cls}"><div class="bl"><span>${label}</span><span class="num">${pct(v)}</span></div>
    <div class="bt"><div class="bf" style="width:${v * 100}%"></div></div></div>`;
  $('result').innerHTML = `
    <div class="pb-label" style="margin-top:10px">${T('반별 합격률')}</div>
    ${bar(T('1반'), a.pass1)}${bar(T('2반'), a.pass2)}
    <div class="gap ${Math.abs(a.gap) >= 0.1 ? 'bad' : 'good'}">${T('차이')} ${Math.round(Math.abs(a.gap) * 100)}%p
      ${Math.abs(a.gap) >= 0.1 ? T('— 실력이 같은데 차이가 커요') : T('— 거의 같아요')}</div>
    <div class="pb-label" style="margin-top:10px">${T('실력이 되는데 떨어진 친구')}</div>
    ${bar(T('1반'), a.missed1)}${bar(T('2반'), a.missed2)}
    <div class="pb-label" style="margin-top:10px">${T('실력대로 맞게 고른 비율 (정확도)')}</div>
    ${bar('', a.accuracy, ' top')}`;
  const bias = BIAS_LEVELS[+$('bias').value][1];
  logRows.unshift({
    info: `${T('정보')}: ${treeFeats.length === 5 ? T('전부') : treeFeats.map(f => T(FEAT[f].label)).join('·')}`,
    data: $('fixLabel').checked ? T('고친 기록') : `${T('편향')} ${T(bias)} · ${T('2반')} ${$('n2').value}${T('명')}`,
    a,
  });
  logRows.length = Math.min(logRows.length, 10);
  $('log').innerHTML = `<table class="mk-table exam">
    <tr><th>${T('설정')}</th><th>${T('정확도')}</th><th>1${T('반')}</th><th>2${T('반')}</th><th>${T('차이')}</th></tr>
    ${logRows.map(r => `<tr><td class="nm">${esc(r.info)}<div class="sub">${esc(r.data)}</div></td>
      <td class="num">${pct(r.a.accuracy)}</td><td class="num">${pct(r.a.pass1)}</td><td class="num">${pct(r.a.pass2)}</td>
      <td class="num${Math.abs(r.a.gap) >= 0.1 ? ' low' : ''}">${Math.round(Math.abs(r.a.gap) * 100)}%p</td></tr>`).join('')}
  </table>`;
}

// ── 지원자 한 명 넣어 보기 (반사실 시험) ─────────────────────
const W_UNITS = { wPractice: '시간', wWorks: '개', wAttend: '%' };
const wLabel = id => { $(id + 'Val').textContent = $(id).value + T(W_UNITS[id]); };
for (const id of Object.keys(W_UNITS)) { wLabel(id); $(id).addEventListener('input', () => { wLabel(id); renderWhatIf(); }); }
function renderWhatIf() {
  if (!tree) { $('wiRow').innerHTML = `<div class="hint" style="margin-top:0">${T('AI를 만들면 시험해 볼 수 있어요')}</div>`; return; }
  const base = { practice: +$('wPractice').value, works: +$('wWorks').value, attend: +$('wAttend').value };
  const who = [[0, 0, '1반 · 걸어서'], [1, 1, '2반 · 버스'], [1, 0, '2반 · 걸어서']];
  const res = who.map(([c, b, label]) => ({ label, pass: predict(tree, { ...base, class2: c, bus: b }) }));
  $('wiRow').innerHTML = res.map(r => `<div class="wi ${r.pass ? 'pass' : 'fail'}">
      <i class="fa-solid fa-user-graduate"></i><span>${T(r.label)}</span>
      <b>${r.pass ? T('합격') : T('불합격')}</b></div>`).join('') +
    (new Set(res.map(r => r.pass)).size > 1 ? `<div class="hint warnt">${T('실력은 똑같은데 결과가 달라요!')}</div>` : `<div class="hint">${T('실력이 같으면 결과도 같아요.')}</div>`);
}

// ── 시작 ────────────────────────────────────────────────────
$('engine').textContent = T('인터넷 없이 이 컴퓨터에서 배워요');
makeRows(); renderWhatIf();
