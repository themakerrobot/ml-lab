// ═══════════════════════════════════════════════════════════
// 튜토리얼 — 파이보가 말풍선으로 화면을 한 바퀴 안내한다 (Sense Lab 과 같은 방식)
// ═══════════════════════════════════════════════════════════
//  · 페이지별 첫 방문에 자동으로 시작한다 (localStorage 로 1회 기억)
//  · 헤더의 ? 버튼으로 언제든 다시 볼 수 있다
//  · 강조는 스포트라이트(구멍 뚫린 어두운 막) 방식 — 대상 요소는 건드리지 않는다

(function () {
  const T = s => (typeof GL_T === 'function' ? GL_T(s) : s);
  const header = document.querySelector('header[data-tab]');
  if (!header) return;
  const PAGE = header.getAttribute('data-tab');

  // 단계: [강조할 요소 선택자(없으면 가운데), 말풍선 문구(한국어 키)]
  const TOURS = {
    'index.html': [
      [null, '안녕! 여기는 ML Lab이에요.\nAI가 배우는 방법을 놀면서 알아봐요.'],
      ['#actGrid', '해 보고 싶은 활동을 골라요.\n위쪽 탭으로도 갈 수 있어요.'],
    ],
    'drive.html': [
      [null, '여기서는 AI에게 운전을 가르쳐요.\n내가 운전하면 AI가 보고 따라 배워요.'],
      ['.padrow', '← → 키나 이 버튼으로 운전해요.\n출발을 눌러 봐요.'],
      ['#dataSec', '내가 보여 준 운전이 여기 쌓여요.\n왼쪽·오른쪽도 골고루!'],
      ['#sensors', 'AI는 이 숫자 7개만 보고 운전해요.'],
      ['#trainBtn', '다 모으면 배우기 시작!\n그다음 AI에게 운전을 맡겨요.'],
      ['#trackPick', '처음 보는 트랙에서도\n잘 달릴까요?'],
    ],
    'word.html': [
      [null, '여기서는 AI에게 문장을 가르쳐요.\n다음 글자를 맞히는 AI예요.'],
      ['#corpus', '가르칠 글을 넣어요.\n예시 글을 골라도 돼요.'],
      ['#modelPick', 'AI 종류를 골라요.\n두 가지를 비교해 봐요.'],
      ['#trainBtn', '배우기 시작을 눌러요.'],
      ['#genBtn', 'AI가 글을 이어 써요.'],
      ['#lookPan', 'AI가 어느 글자를 보고\n골랐는지 들여다봐요.'],
      ['#duelSec', '나와 AI, 누가 더 잘 맞힐까요?'],
    ],
  };

  const steps = TOURS[PAGE];
  if (!steps) return;

  const SEEN_KEY = 'ml-tour-' + PAGE;
  let idx = -1, box = null;

  function el(tag, cls, parent) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  }

  function stop() {
    if (box) { box.remove(); box = null; }
    window.removeEventListener('resize', place);
    idx = -1;
    try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) {}
  }

  function place() {
    if (!box || idx < 0) return;
    const [sel] = steps[idx];
    const spot = box.querySelector('.tour-spot');
    const bub = box.querySelector('.tour-bubble');
    const target = sel ? document.querySelector(sel) : null;

    if (target && target.offsetParent !== null) {
      target.scrollIntoView({ block: 'center' });
      const r = target.getBoundingClientRect();
      const pad = 6;
      spot.style.display = '';
      spot.style.left = (r.left - pad) + 'px';
      spot.style.top = (r.top - pad) + 'px';
      spot.style.width = (r.width + pad * 2) + 'px';
      spot.style.height = (r.height + pad * 2) + 'px';

      // 말풍선: 대상 아래, 안 되면 위, 그것도 안 되면 화면 아래
      const bw = Math.min(320, window.innerWidth - 24);
      bub.style.width = bw + 'px';
      bub.style.left = Math.max(12, Math.min(r.left, window.innerWidth - bw - 12)) + 'px';
      const bh = bub.offsetHeight || 150;
      if (r.bottom + pad + bh + 20 < window.innerHeight) {
        bub.style.top = (r.bottom + pad + 12) + 'px'; bub.style.bottom = '';
      } else if (r.top - pad - bh - 20 > 0) {
        bub.style.top = (r.top - pad - bh - 12) + 'px'; bub.style.bottom = '';
      } else {
        bub.style.top = ''; bub.style.bottom = '16px';
      }
    } else {
      spot.style.display = 'none';
      const bw = Math.min(320, window.innerWidth - 24);
      bub.style.width = bw + 'px';
      bub.style.left = Math.round((window.innerWidth - bw) / 2) + 'px';
      bub.style.top = Math.round(window.innerHeight * 0.3) + 'px';
      bub.style.bottom = '';
    }
  }

  function show(i) {
    idx = i;
    if (!box) {
      box = el('div', 'tour');
      el('div', 'tour-spot', box);
      const bub = el('div', 'tour-bubble', box);
      const img = el('img', 'tour-char', bub);
      img.src = 'assets/img/pibo-hello.png';
      img.alt = '';
      el('div', 'tour-text', bub);
      const foot = el('div', 'tour-foot', bub);
      el('div', 'tour-dots', foot);
      const skip = el('button', 'db tour-skip', foot);
      skip.type = 'button';
      skip.textContent = T('그만 볼래요');
      skip.addEventListener('click', stop);
      const next = el('button', 'db go tour-next', foot);
      next.type = 'button';
      next.addEventListener('click', () => {
        if (idx + 1 >= steps.length) stop();
        else show(idx + 1);
      });
      document.body.appendChild(box);
      window.addEventListener('resize', place);
    }
    box.querySelector('.tour-text').textContent = T(steps[i][1]);
    const dots = box.querySelector('.tour-dots');
    dots.innerHTML = '';
    steps.forEach((_, d) => el('span', 'dot' + (d === i ? ' on' : ''), dots));
    box.querySelector('.tour-next').textContent = i + 1 >= steps.length ? T('다 봤어요') : T('다음');
    box.querySelector('.tour-skip').style.display = i + 1 >= steps.length ? 'none' : '';
    place();
    requestAnimationFrame(place);
  }

  function start() { if (idx < 0) show(0); }

  const help = el('button', 'hbtn');
  help.id = 'helpBtn';
  help.type = 'button';
  help.title = '도움말';
  help.innerHTML = '<i class="fa-solid fa-question"></i>';
  help.addEventListener('click', start);
  const fsBtn = document.getElementById('fsBtn');
  if (fsBtn) header.insertBefore(help, fsBtn);
  else header.appendChild(help);

  let seen = false;
  try { seen = localStorage.getItem(SEEN_KEY) === '1'; } catch (e) {}
  if (!seen) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(start, 600));
    } else setTimeout(start, 600);
  }
})();
