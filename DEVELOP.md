# 개발·배포 안내 (for developers)

사용자용 소개는 [README.md](./README.md)를 보세요. 이 문서는 개발·운영 전용입니다.

## 원칙

- 백엔드 없음 — 전부 정적 파일. 외부 CDN 금지, 라이브러리·글꼴 전부 셀프호스팅
- 빌드 단계 없음 — 저장소 루트를 그대로 서빙한다 (GitHub Pages / Cloudflare)
- **저사양 교실 PC 기준** — WebGL/WebGPU 를 전제하지 않는다. 모델은 순수 JS(Float32Array)로 짜고
  무거운 계산은 Web Worker 에서 돌린다
- 탭 하나 = 활동 하나 = HTML 한 장. 연 활동의 코드만 불러온다
- 코드·README 에 계정명·절대 URL 하드코딩 금지 (전부 상대경로)
- 디자인은 자매 서비스와 동일 — `css/themaker-ui.css` 는
  **[themakerrobot/themaker-ui](https://github.com/themakerrobot/themaker-ui)** 의 복사본이다. **직접 고치지 말 것.**
  고쳐야 하면 킷을 고치고 태그를 올린 뒤 여기로 다시 복사한다 (CI 가 어긋남을 잡는다)

## 실행

`file://` 로는 열 수 없습니다(모듈 워커). 반드시 http 로 서빙하세요.

```bash
python3 -m http.server 8080
node --test tests/*.test.mjs     # 모델 검사
```

## 구조

```
index.html            홈 — 활동 카드 5개
word.html             문장 (언어모델)
drive.html / cleaner.html / fair.html / evolve.html    준비 중 화면
css/
  themaker-ui.css     공용 디자인 킷 복사본 (수정 금지)
  app.css             ML Lab 전용
  all.min.css         Font Awesome (webfonts/)
lib/
  nav.js              헤더 탭 · 전체화면 — 탭 목록은 여기 TABS
  i18n.js             한/영 토글 (한국어 원문이 키, Sense Lab 과 같은 방식)
  tour.js             파이보 말풍선 튜토리얼 — 페이지별 단계는 여기 TOURS
acts/word/
  charmlp.js          작은 신경망 (앞 ctx글자 → 임베딩 → tanh → softmax)
  minigpt.js          미니 Transformer (pre-LN, 인과 멀티헤드 어텐션)
  worker.js           학습·추론 워커 (두 모델을 같은 약속으로)
  page.js             화면 로직
  presets.js          예시 글 (한/영)
tests/                node --test — 역전파 수치 미분 검사, 학습 검사
assets/               글꼴(Pretendard) · 파이보 이미지 · 앱 아이콘
```

새 활동을 붙일 때: `acts/<이름>/` 를 만들고, `<이름>.html` 을 채우고,
`lib/nav.js` 탭·`lib/tour.js` 안내·`lib/i18n.js` 사전·`index.html` 카드 배지를 고친다.

## 문장 활동: 모델

TF.js 를 쓰지 않는다. 같은 작은 MLP 를 WebGL 없는 환경에서 재 보면
TF.js cpu 백엔드가 손으로 짠 JS 보다 약 13배 느렸다 (배치마다 드는 부담 때문).

```
연습 문제 218개 × 30에폭 (헤드리스 크로미움, WebGL 없음)
  TF.js 4.22 cpu 백엔드   13.8초
  charmlp.js               1.0초
```

| 모델 | 설정 | 파라미터 (글자 50종) | 한 번 "배우기" |
|---|---|---|---|
| 작은 신경망 | ctx 1~8, 임베딩 24, 은닉 128 | 약 3.2만 | 1500번 × 배치 32 |
| Transformer | ctx 32, d 32, 헤드 2, 2층 | 약 2.9만 | 400번 × 배치 8 |

- 글자 단위는 **음절**. 글자 종류는 300개까지(`MAX_VOCAB`) — 출력층 크기라 속도를 좌우한다.
  드문 글자는 `?` 로 묶는다.
- 글은 앞쪽 5000글자까지만 쓴다 (`page.js` 의 `MAX_CHARS`).
- Transformer 학습 시간은 글 길이가 아니라 **연습 횟수**로 정해진다 — 수업 시간을 맞추기 쉽다.
- 역전파는 `tests/` 에서 float64 로 바꿔 수치 미분과 비교한다 (상대오차 1e-4 미만이어야 통과).

### 잰 시간 (참고)

개발용 클라우드 서버(Xeon 2.8GHz, 4코어) + 헤드리스 크로미움, 동물 예시 글:

| | 한 번 "배우기" |
|---|---|
| 작은 신경망 | 약 8초 |
| Transformer | 약 16초 |

**교실 PC(셀러론·구형 i3)에서는 아직 재지 않았다.** 느리면 `worker.js` 의 배치·`page.js` 의
`STEPS` 를 줄이고, 그래도 부족하면 Transformer 의 `ctx` 를 16 으로 줄인다
(어텐션 계산량은 길이의 제곱).

## 배포 (자매 서비스와 동일)

- `main` 에 작업 → GitHub Pages 테스트 → 통과하면 `release` 브랜치 머지 → Cloudflare 자동 배포
- Cloudflare 는 Workers 방식: `wrangler.toml` + `.assetsignore` (잠금 없음 — 자산만 서빙)
- 캐시 버스팅: 코드 파일만 `?v=N`
- `.nojekyll` — GitHub Pages 가 파일을 거르지 않게 둔다
