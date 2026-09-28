// ═══════════════════════════════════════════════════════════
// 헤더 / 탭 네비게이션 — Sense Lab lib/nav.js 와 같은 구조
// ═══════════════════════════════════════════════════════════
// 각 페이지의 <header data-tab="..."> 를 파이보 랩 헤더 마크업(h1 + .navlink)과
// 같은 구조로 채운다. 클래스 이름·DOM 구조를 바꾸지 말 것 —
// css/themaker-ui.css 가 그대로 입혀진다.
// 탭 하나 = 활동 하나 = HTML 한 장. 연 활동의 코드만 불러오게 하려는 것이다.

(function () {
  // soon: 아직 준비 중 — 헤더에는 안 보이고 홈 카드로만 들어간다 (폰 헤더가 넘치지 않게).
  // 그 페이지 안에서는 자기 탭이 보이도록 남긴다.
  const TABS = [
    { href: 'index.html', label: '홈' },
    { href: 'drive.html', label: '운전' },
    { href: 'eye.html', label: 'AI 눈' },
    { href: 'word.html', label: '문장' },
    { href: 'cleaner.html', label: '청소', soon: true },
    { href: 'fair.html', label: '공정', soon: true },
    { href: 'evolve.html', label: '진화', soon: true },
  ];

  const header = document.querySelector('header[data-tab]');
  if (!header) return;
  const cur = header.getAttribute('data-tab');

  const h1 = document.createElement('h1');
  const logo = document.createElement('img');
  logo.src = 'assets/img/pibo-logo.png';
  logo.alt = '';
  h1.appendChild(logo);
  // 글자는 span 으로 감싼다 — 아주 좁은 화면에서 로고만 남기기 위해
  const txt = document.createElement('span');
  txt.className = 'brand-txt';
  txt.textContent = 'ML Lab';
  h1.appendChild(txt);
  header.appendChild(h1);

  TABS.forEach(function (t) {
    if (t.soon && t.href !== cur) return;
    let el;
    if (t.href === cur) {
      el = document.createElement('span');
      el.className = 'navlink on';
    } else {
      el = document.createElement('a');
      el.className = 'navlink';
      el.href = t.href;
    }
    el.textContent = t.label;
    header.appendChild(el);
  });

  const sp = document.createElement('span');
  sp.style.flex = '1';
  header.appendChild(sp);

  // 페이지가 상태를 적는 자리 (예: "CPU 로 배워요")
  const engine = document.createElement('span');
  engine.id = 'engine';
  engine.style.cssText = 'font-size:11px;color:var(--ink3,#96A5AE);font-weight:600';
  header.appendChild(engine);

  // 전체화면 (지원하는 브라우저에서만 — 아이폰 사파리는 미지원)
  // 탭을 옮기면 브라우저가 전체화면을 풀기 때문에, 켜 둔 상태를 기억했다가
  // 다음 페이지의 첫 터치에서 다시 켠다.
  if (document.documentElement.requestFullscreen) {
    const FS_KEY = 'ml-fs';
    const remember = v => { try { v ? sessionStorage.setItem(FS_KEY, '1') : sessionStorage.removeItem(FS_KEY); } catch (e) {} };
    const wanted = () => { try { return sessionStorage.getItem(FS_KEY) === '1'; } catch (e) { return false; } };

    const fs = document.createElement('button');
    fs.className = 'hbtn';
    fs.id = 'fsBtn';
    fs.type = 'button';
    fs.title = '전체화면';
    fs.innerHTML = '<i class="fa-solid fa-expand"></i>';
    fs.addEventListener('click', function () {
      if (document.fullscreenElement) { remember(false); document.exitFullscreen(); }
      else document.documentElement.requestFullscreen().catch(function () {});
    });
    document.addEventListener('fullscreenchange', function () {
      const on = !!document.fullscreenElement;
      remember(on);
      fs.innerHTML = on
        ? '<i class="fa-solid fa-compress"></i>'
        : '<i class="fa-solid fa-expand"></i>';
    });
    header.appendChild(fs);

    // 터치 기기에서 pointerdown 은 사용자 활성화 권한이 없어 거부된다 — touchend/click 에 건다
    if (wanted()) {
      const revive = function () {
        document.removeEventListener('click', revive, true);
        document.removeEventListener('touchend', revive, true);
        if (!document.fullscreenElement && wanted()) {
          document.documentElement.requestFullscreen().catch(function () {});
        }
      };
      document.addEventListener('click', revive, true);
      document.addEventListener('touchend', revive, true);
    }
  }
})();
