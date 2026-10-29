// ═══════════════════════════════════════════════════════════
// 운전 활동 — 차와 센서 (DOM 없음)
// ═══════════════════════════════════════════════════════════
// 초급: 차는 일정한 속도로 달리고, 운전은 세 가지 중 하나만 한다:
//   0 = 왼쪽, 1 = 곧게, 2 = 오른쪽
// 센서는 차 앞쪽으로 부채꼴 광선 7개. 도로 끝까지의 거리를 0~1 로 준다 (1 = 멀다).
// AI는 이 숫자 7개만 보고 운전을 고른다 — 사람이 보는 트랙 그림은 못 본다.
//
// 고급: 방향에 빠르기(감속 · 그대로 · 가속)를 더한다. 행동 = 빠르기 × 3 + 방향 (0~8),
// AI 는 센서 7개 + 지금 빠르기를 본다. 고급 계산은 edge-lab view_project/lib/drive.js 와 같다
// (같은 AI 파일이면 두 저장소에서 같은 대회 기록이 나오게).

import { onRoad, nearestIdx } from './track.js?v=7';

export const RAY_DEG = [-90, -60, -30, 0, 30, 60, 90];
export const RAY_MAX = 160;           // 센서가 볼 수 있는 가장 먼 거리
export const SPEED = 120;             // 초당 이동 (세계 좌표)
export const TURN = 2.8;              // 초당 회전 (라디안)
export const DT = 1 / 60;             // 한 번 움직이는 시간
export const ACTIONS = [-1, 0, 1];    // 왼쪽 · 곧게 · 오른쪽 (화면 y 가 아래쪽이라 왼쪽이 -)

// 고급 모드: 빠르기 k 배. 회전은 √k 배까지만 는다 (빠를수록 크게 돈다 — 타이어가 버티는 만큼).
// 그래서 직선에서 밟고 커브 앞에서 줄여야 빨라진다.
export const V_MIN = 0.5, V_MAX = 3, V0 = 1;   // 빠르기 범위 · 출발 빠르기 (배)
const ACCEL = 1, BRAKE = 2;                    // 초당 +1배 · −2배 (브레이크가 더 세다)
const THR = [-1, 0, 1];                        // 감속 · 그대로 · 가속

export class Car {
  constructor(track) { this.reset(track); }

  reset(track) {
    this.track = track;
    Object.assign(this, { x: track.start.x, y: track.start.y, th: track.start.th });
    this.idx = 0; this.laps = 0; this.dist = 0; this.crashed = false;
    this.t = 0; this.lapAt = [];          // 달린 시간(초, 게임 시간) · 바퀴를 넘은 시각들
    this.v = V0; this.vMax = V0;          // 고급 모드의 지금 빠르기 · 가장 빨랐던 빠르기 (배)
  }

  // 센서 값 7개 (0~1)
  sense() {
    return RAY_DEG.map(d => {
      const a = this.th + d * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      let r = 0;
      while (r < RAY_MAX && onRoad(this.track, this.x + c * r, this.y + s * r)) r += 2;
      return Math.min(r, RAY_MAX) / RAY_MAX;
    });
  }

  // 고급 모드 센서: 센서 7개 + 지금 빠르기 (0~1)
  sense2() {
    const s = this.sense();
    s.push((this.v - V_MIN) / (V_MAX - V_MIN));
    return s;
  }

  // action: 0/1/2, k: 빠르기 배수 (초급은 늘 1). 반환: 부딪혔는지
  // 판단은 1/60초에 한 번, 움직임만 ceil(k) 번으로 잘게 나눠 길을 건너뛰지 않게 한다.
  // k = 1 이면 예전 계산과 비트 단위로 같다 (식의 계산 순서까지 그대로 — tests/drive.test.mjs 가 24코스로 비교).
  step(action, k = 1) {
    if (this.crashed) return true;
    const sub = Math.ceil(k);
    this.t += DT;
    for (let q = 0; q < sub; q++) {
      this.th += ACTIONS[action] * TURN * Math.sqrt(k) * DT / sub;
      this.x += Math.cos(this.th) * SPEED * k * DT / sub;
      this.y += Math.sin(this.th) * SPEED * k * DT / sub;
      this.dist += SPEED * k * DT / sub;
      // 차 앞머리와 가운데가 도로 위에 있어야 한다
      const fx = this.x + Math.cos(this.th) * 9, fy = this.y + Math.sin(this.th) * 9;
      if (!onRoad(this.track, this.x, this.y) || !onRoad(this.track, fx, fy)) this.crashed = true;
      // 진행도: 중심선 번호가 끝에서 처음으로 넘어가면 한 바퀴
      const n = this.track.n, prev = this.idx;
      this.idx = nearestIdx(this.track, this.x, this.y, prev);
      if (prev > n * 0.8 && this.idx < n * 0.2) { this.laps++; if (this.laps > this.lapAt.length) this.lapAt.push(this.t); }
      else if (prev < n * 0.2 && this.idx > n * 0.8) this.laps--;
      if (this.crashed) break;
    }
    return this.crashed;
  }

  // 고급 모드 한 걸음: a2 = 빠르기 × 3 + 방향 (0~8). 빠르기를 바꾼 뒤 그 빠르기로 간다
  step2(a2) {
    const thr = THR[(a2 / 3) | 0];
    this.v += (thr > 0 ? ACCEL : thr < 0 ? -BRAKE : 0) * DT;
    this.v = Math.max(V_MIN, Math.min(V_MAX, this.v));
    if (this.v > this.vMax) this.vMax = this.v;
    return this.step(a2 % 3, this.v);
  }

  // 바퀴마다 걸린 시간(초). 출발선에서 첫 바퀴 끝까지가 첫 값
  lapTimes() {
    let prev = 0;
    return this.lapAt.map(t => { const d = t - prev; prev = t; return d; });
  }

  // 지금까지 간 정도 (바퀴 단위, 1.5 = 한 바퀴 반)
  get progress() { return this.laps + this.idx / this.track.n; }
}

// 시험용 "선생님" 운전: 왼쪽·오른쪽 센서를 비교해 넓은 쪽으로 튼다.
// 화면에는 나오지 않는다 — tests/ 에서 전체 흐름(운전→학습→AI 운전)을 검사할 때 쓴다.
export function teacher(s) {
  const left = s[1] + s[2], right = s[4] + s[5];
  const diff = right - left;
  if (s[3] < 0.35) return diff > 0 ? 2 : 0;        // 앞이 막히면 크게 튼다
  if (diff > 0.12) return 2;
  if (diff < -0.12) return 0;
  return 1;
}

// 시험용 고급 선생님: 방향은 teacher, 빠르기는 앞이 트였으면 밟고 막혀 오면 줄인다
export function teacher2(s) {
  const dir = teacher(s), v = s[7], f = s[3];
  const thr = f > 0.9 && v < 0.9 ? 2 : (f < 0.55 && v > 0.15 ? 0 : 1);
  return thr * 3 + dir;
}

// 대회: AI 만 laps 바퀴 (화면 없이). mode 'basic' (1배, 방향만) · 'pro' (가속 · 감속도).
// 계산에 난수가 없어 어느 PC 에서나 결과가 같다. 시간은 게임 시간(초).
export function drive(track, pol, mode, laps = 3, maxSec = 300) {
  const car = new Car(track), pro = mode === 'pro';
  while (car.t < maxSec) {
    const crash = pro ? car.step2(pol.act(car.sense2())) : car.step(pol.act(car.sense()));
    if (crash || car.progress >= laps) break;
  }
  const times = car.lapTimes(), ok = car.progress >= laps && !car.crashed;
  return {
    ok, prog: Math.min(laps, Math.max(0, car.progress)), t: car.t, laps: times,
    best: times.length ? Math.min(...times) : null,
    avg: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null,
    vMax: car.vMax,
  };
}
