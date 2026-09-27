// ═══════════════════════════════════════════════════════════
// 다국어 (한국어 / English) — Sense Lab lib/i18n.js 와 같은 방식
// ═══════════════════════════════════════════════════════════
//  · 한국어 원문을 그대로 '키' 로 쓴다 → 사전에 없으면 한국어가 그대로 나오므로
//    번역이 빠져도 화면이 깨지지 않는다.
//  · HTML 은 손대지 않는다. 페이지가 뜨면 DOM 을 훑어서 텍스트를 바꾼다.
//  · 언어 설정은 자매 서비스와 같은 localStorage 키 'language' 를 쓴다.
//  · 학생이 쓴 글은 사전에 없으므로 번역되지 않는다 (의도된 동작).

const GL_LANG = (function () {
  try {
    const saved = localStorage.getItem('language');
    if (saved === 'ko' || saved === 'en') return saved;
  } catch (e) {}
  const nav = (navigator.language || navigator.userLanguage || 'ko');
  return nav.toLowerCase().indexOf('ko') === 0 ? 'ko' : 'en';
})();

const GL_I18N = {
  // ── 페이지 / 헤더 ──
  'ML Lab — 홈': 'ML Lab — Home',
  'ML Lab — 운전': 'ML Lab — Drive',
  'ML Lab — 청소': 'ML Lab — Clean',
  'ML Lab — 문장': 'ML Lab — Words',
  'ML Lab — 공정': 'ML Lab — Fair',
  'ML Lab — 진화': 'ML Lab — Evolve',
  '홈': 'Home',
  '운전': 'Drive',
  '청소': 'Clean',
  '문장': 'Words',
  '공정': 'Fair',
  '진화': 'Evolve',
  '전체화면': 'Full screen',
  '도움말': 'Help',
  '불러오지 못했어요. 새로고침해 주세요': 'Could not load. Please refresh',
  '인터넷 없이 이 컴퓨터에서 배워요': 'Learns on this computer, no internet',

  // ── 홈 ──
  'AI는 어떻게 배울까요?': 'How does AI learn?',
  '따라 하며 배우고, 상을 받으며 배우고, 글을 읽으며 배워요.': 'By copying, by rewards, and by reading.',
  '설치도 가입도 없어요. 모든 계산은 이 컴퓨터 안에서 해요.': 'No install, no sign-up. Everything runs on this computer.',
  '따라 배우기': 'Learning by copying',
  '규칙 vs 학습': 'Rules vs learning',
  '언어모델': 'Language model',
  '데이터와 편향': 'Data and bias',
  '상 주며 배우기': 'Learning from rewards',
  '내가 운전하면 AI가 보고 따라 배워요.': 'You drive, and the AI learns by watching.',
  '커브만 가르치지 않으면 어떻게 될까요?': 'What if you never teach it the curves?',
  '규칙대로 도는 청소기와 스스로 배운 청소기.': 'A rule-following cleaner vs one that learned.',
  '누가 더 깨끗이 치울까요?': 'Which one cleans better?',
  '글을 가르치면 AI가 다음 글자를 맞혀요.': 'Teach it some text and it guesses the next letter.',
  'AI는 어느 글자를 보고 골랐을까요?': 'Which letters did the AI look at?',
  '한쪽 데이터만 많으면 AI는 어떻게 판단할까요?': 'What happens when the data is one-sided?',
  'AI가 고른 까닭도 봐요.': 'See why the AI chose.',
  '가상 생물이 걷는 법을 스스로 찾아요.': 'A virtual creature finds out how to walk.',
  '무엇에 상을 줄지 내가 정해요.': 'You decide what earns a reward.',
  '준비 중': 'Coming soon',
  '해 보기': 'Try it',
  '크롬·엣지에서 가장 잘 돌아가요. 카메라와 마이크는 쓰지 않아요.': 'Works best in Chrome or Edge. No camera or mic needed.',

  // ── 준비 중 화면 ──
  '준비 중이에요': 'Coming soon',
  '운전 — 따라 배우기': 'Drive — Learning by copying',
  '청소 — 규칙 vs 학습': 'Clean — Rules vs learning',
  '공정 — 데이터와 편향': 'Fair — Data and bias',
  '진화 — 상 주며 배우기': 'Evolve — Learning from rewards',
  '내가 키보드로 운전하면 AI가 보고 따라 배워요.': 'You drive with the keyboard, and the AI learns by watching.',
  '직진만 가르치면 커브에서 어떻게 될까요? 데이터가 곧 실력이라는 걸 알아봐요.': 'Teach it only straight roads — what happens at a curve? Data is skill.',
  '규칙대로 도는 청소기와 스스로 배운 청소기를 겨뤄요.': 'A rule-following cleaner races one that learned.',
  '방을 그리고, 두 청소기가 얼마나 깨끗이 치우는지 비교해요.': 'Draw a room and compare how well each one cleans.',
  '한쪽 데이터만 많으면 AI의 판단이 어떻게 바뀔까요?': 'How does one-sided data change the AI’s decisions?',
  'AI가 무엇을 보고 골랐는지 나무 그림으로 봐요.': 'See what the AI looked at, as a tree.',
  '무엇에 상을 줄지 내가 정해요. 엉뚱한 꾀를 부리면 어떻게 할까요?': 'You decide the reward. What if it finds a sneaky trick?',
  '문장 활동 해 보기': 'Try the Words activity',

  // ── 튜토리얼 ──
  '그만 볼래요': 'Skip',
  '다음': 'Next',
  '다 봤어요': 'Done',
  '안녕! 여기는 ML Lab이에요.\nAI가 배우는 방법을 놀면서 알아봐요.': 'Hi! This is ML Lab.\nLet’s play and see how AI learns.',
  '해 보고 싶은 활동을 골라요.\n위쪽 탭으로도 갈 수 있어요.': 'Pick an activity.\nThe tabs at the top work too.',
  '여기서는 AI에게 문장을 가르쳐요.\n다음 글자를 맞히는 AI예요.': 'Here you teach the AI sentences.\nIt guesses the next letter.',
  '가르칠 글을 넣어요.\n예시 글을 골라도 돼요.': 'Put in some text.\nOr pick an example.',
  'AI 종류를 골라요.\n두 가지를 비교해 봐요.': 'Pick a kind of AI.\nCompare the two.',
  '배우기 시작을 눌러요.': 'Press Start teaching.',
  'AI가 글을 이어 써요.': 'The AI keeps writing.',
  'AI가 어느 글자를 보고\n골랐는지 들여다봐요.': 'Peek at which letters\nthe AI looked at.',
  '나와 AI, 누가 더 잘 맞힐까요?': 'You vs the AI — who guesses better?',

  // ── 문장: 단계 ──
  '글 넣기': 'Add text',
  '배우기': 'Teach',
  '이어 쓰기': 'Write on',
  '들여다보기': 'Look inside',

  // ── 문장: 글 ──
  '가르칠 글': 'Text to teach',
  '예시 글': 'Examples',
  '여기에 글을 써요. 줄마다 한 문장씩!': 'Write here. One sentence per line!',
  '글자': 'Letters',
  '글자 종류': 'Kinds of letters',
  '앞쪽 5000글자만 배워요': 'Only the first 5000 letters are used',
  '글이 너무 짧아요. 조금 더 써 주세요': 'Too short. Please write a bit more',

  // ── 문장: AI 고르기 ──
  'AI 고르기': 'Pick an AI',
  '작은 신경망': 'Small neural net',
  '앞 몇 글자만 봐요': 'Sees a few letters back',
  '앞 글을 다 봐요': 'Sees everything before',
  '앞을 몇 글자 볼까요?': 'How many letters back?',

  // ── 문장: 배우기 ──
  '배우기 시작': 'Start teaching',
  '더 배우기': 'Teach more',
  '멈추기': 'Stop',
  '아직 안 배웠어요': 'Not taught yet',
  '배우는 중': 'Learning',
  '더 배우는 중': 'Learning more',
  '다 배웠어요': 'All done learning',
  '멈췄어요. 지금까지 배운 걸로 해 봐요': 'Stopped. Try what it learned so far',
  '배우다가 멈췄어요. 다시 해 보세요': 'Learning stopped. Please try again',
  '틀린 정도 (낮을수록 잘 맞혀요)': 'Mistakes (lower is better)',
  'AI 속 숫자': 'Numbers inside the AI',
  '연습': 'Practice',
  '번': '',
  '초': 's',

  // ── 문장: 이어 쓰기 ──
  '시작 글자': 'Start with',
  '예: 강아지는': 'e.g. The dog',
  '한 글자만 이어 쓰기': 'Write just one letter',
  '한 글자': 'One letter',
  '온도 — 높을수록 엉뚱해요': 'Temperature — higher is wilder',
  '배운 뒤에 이어 쓸 수 있어요': 'Teach it first, then it can write',
  '밑줄': 'Underlined',
  '= 가르친 글에 없는 문장이에요. AI가 지어냈어요.': '= not in your text. The AI made it up.',
  '다음 글자 후보': 'Next letter guesses',
  '배운 뒤에 보여요': 'Shows up after teaching',
  '배운 적 없는 글자예요': 'Never learned these letters',
  '여기서 문장이 끝났대요': 'The AI says the sentence ends here',

  // ── 문장: 들여다보기 ──
  '배운 뒤에 AI가 어느 글자를 보는지 나와요': 'After teaching, see which letters the AI looks at',
  'AI가 보는 글자': 'Letters the AI sees',
  '작은 신경망은 바로 앞 글자 몇 개만 봐요.': 'The small net only sees a few letters back.',
  '· 는 줄 앞의 빈칸이에요.': '· is empty space before the line.',
  '더 앞의 글자는 몰라요.': 'It can’t see further back.',
  '층': 'Layer ',
  '눈': 'Eye ',
  '줄마다 그 글자가 앞의 어느 글자를 봤는지예요.': 'Each row shows which earlier letters that letter looked at.',
  '진할수록 많이 봤어요.': 'Darker means it looked more.',
  '가장 많이 본 글자: {a} → {b}': 'Looked at most: {a} → {b}',

  // ── 문장: 맞히기 대결 ──
  '맞히기 대결 — 나 vs AI': 'Guessing game — you vs AI',
  '문제를 내 볼까요?': 'Ready for a question?',
  '다음 글자': 'Next letter',
  '내기': 'Go',
  '새 문제': 'New question',
  '나': 'Me',
  '다음 글자를 써 보세요': 'Write the next letter',
  '한 글자를 써 주세요': 'Please write one letter',
  '정답': 'Answer',
};

// 한국어 원문 → 현재 언어. 사전에 없으면 원문 그대로.
function GL_T(ko) {
  if (GL_LANG === 'ko') return ko;
  const v = GL_I18N[ko];
  return (v === undefined) ? ko : v;
}

// ── 화면(HTML) 자동 번역 ──
// HTML 파일은 손대지 않는다. 텍스트 노드와 title/placeholder 만 바꿔치기한다.
function localizeDOM(root) {
  if (GL_LANG === 'ko') return;
  const scope = root || document.body;
  if (!scope) return;

  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null);
  const hits = [];
  let n;
  while ((n = walker.nextNode())) {
    const tag = n.parentNode && n.parentNode.nodeName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA') continue;
    const raw = n.nodeValue.trim();
    if (!raw || GL_I18N[raw] === undefined) continue;
    hits.push([n, n.nodeValue.replace(raw, GL_I18N[raw])]);
  }
  hits.forEach(h => { h[0].nodeValue = h[1]; });

  ['title', 'placeholder'].forEach(attr => {
    scope.querySelectorAll('[' + attr + ']').forEach(el => {
      const v = GL_I18N[el.getAttribute(attr).trim()];
      if (v !== undefined) el.setAttribute(attr, v);
    });
  });

  if (document.title && GL_I18N[document.title.trim()] !== undefined)
    document.title = GL_I18N[document.title.trim()];
  document.documentElement.lang = 'en';
}

// ── 언어 토글 버튼 (자매 서비스와 같은 버튼·위치) ──
function setLanguage(v) {
  try { localStorage.setItem('language', v); } catch (e) {}
  location.reload();
}

function mountLangToggle() {
  const bar = document.querySelector('header');
  if (!bar || document.getElementById('langToggle')) return;
  const toKo = (GL_LANG !== 'ko');
  const b = document.createElement('button');
  b.id = 'langToggle';
  b.type = 'button';
  b.textContent = toKo ? '한' : 'EN';
  b.title = '한국어 / English';
  b.addEventListener('click', function () { setLanguage(toKo ? 'ko' : 'en'); });
  bar.appendChild(b);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () { localizeDOM(); mountLangToggle(); });
} else {
  localizeDOM(); mountLangToggle();
}
