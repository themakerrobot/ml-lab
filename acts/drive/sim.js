// ═══════════════════════════════════════════════════════════
// 운전 활동 — 차와 센서 (DOM 없음)
// ═══════════════════════════════════════════════════════════
// 차는 일정한 속도로 달리고, 운전은 세 가지 중 하나만 한다:
//   0 = 왼쪽, 1 = 곧게, 2 = 오른쪽
// 센서는 차 앞쪽으로 부채꼴 광선 7개. 도로 끝까지의 거리를 0~1 로 준다 (1 = 멀다).
// AI는 이 숫자 7개만 보고 운전을 고른다 — 사람이 보는 트랙 그림은 못 본다.

import { onRoad, nearestIdx } from './track.js';

export const RAY_DEG = [-90, -60, -30, 0, 30, 60, 90];
export const RAY_MAX = 160;           // 센서가 볼 수 있는 가장 먼 거리
export const SPEED = 120;             // 초당 이동 (세계 좌표)
export const TURN = 2.8;              // 초당 회전 (라디안)
export const DT = 1 / 60;             // 한 번 움직이는 시간
export const ACTIONS = [-1, 0, 1];    // 왼쪽 · 곧게 · 오른쪽 (화면 y 가 아래쪽이라 왼쪽이 -)

export class Car {
  constructor(track) { this.reset(track); }

  reset(track) {
    this.track = track;
    Object.assign(this, { x: track.start.x, y: track.start.y, th: track.start.th });
    this.idx = 0; this.laps = 0; this.dist = 0; this.crashed = false;
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

  // action: 0/1/2. 반환: 부딪혔는지
  step(action) {
    if (this.crashed) return true;
    this.th += ACTIONS[action] * TURN * DT;
    this.x += Math.cos(this.th) * SPEED * DT;
    this.y += Math.sin(this.th) * SPEED * DT;
    this.dist += SPEED * DT;
    // 차 앞머리와 가운데가 도로 위에 있어야 한다
    const fx = this.x + Math.cos(this.th) * 9, fy = this.y + Math.sin(this.th) * 9;
    if (!onRoad(this.track, this.x, this.y) || !onRoad(this.track, fx, fy)) this.crashed = true;
    // 진행도: 중심선 번호가 끝에서 처음으로 넘어가면 한 바퀴
    const n = this.track.n, prev = this.idx;
    this.idx = nearestIdx(this.track, this.x, this.y, prev);
    if (prev > n * 0.8 && this.idx < n * 0.2) this.laps++;
    else if (prev < n * 0.2 && this.idx > n * 0.8) this.laps--;
    return this.crashed;
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
