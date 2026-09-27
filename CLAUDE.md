# ml-lab

어린이·수업용 머신러닝 놀이터. themakerrobot 라인업(teach-lab, sense-lab, edge-lab, factory-lab)의 자매 서비스.

## 범위
- 탭 = 활동 = HTML 한 장: 홈 / 운전(모방학습) / 청소(규칙 vs 강화학습) / 문장(언어모델) / 공정(편향·결정트리) / 진화(보상 설계)
- 기기(로봇·센서·카메라·마이크) 없이 PC 브라우저만으로 되는 활동만 둔다

## 제약
- 정적 웹(GitHub Pages), 서버·클라우드 API 없음, 외부 CDN 없음 (전부 셀프호스팅)
- 저사양 교실 PC 기준: WebGL/WebGPU 전제 금지. 모델은 순수 JS + Web Worker
- 디자인은 sense-lab 과 같다. `css/themaker-ui.css` 는 themakerrobot/themaker-ui 복사본 — 직접 수정 금지
- UI 문구 한국어 우선(해요체, 초등 눈높이), 영어는 `lib/i18n.js` 사전 (한국어 원문이 키)
- 새 모델·역전파는 `tests/` 에 수치 미분 검사를 붙인다

자세한 구조와 잰 수치는 DEVELOP.md.
