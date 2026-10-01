// ═══════════════════════════════════════════════════════════
// 운전 활동 — 트랙 (DOM 없음: 브라우저·node 양쪽에서 쓴다)
// ═══════════════════════════════════════════════════════════
// 트랙 = 닫힌 중심선(Catmull-Rom 곡선) + 폭.
// 도로 판정은 픽셀 마스크(Uint8Array)로 한다 — 센서 광선을 쏠 때 O(1) 로 본다.
// 세계 좌표는 800×520 고정. 화면에서는 캔버스 크기에 맞춰 늘린다.
//
// 차는 1초에 2.8라디안까지만 돌 수 있어서(sim.js) 반지름 43보다 급한 커브는 못 돈다.
// 새 트랙은 tests/drive.test.mjs 의 "선생님 운전" 검사(양쪽 방향 2바퀴)를 통과해야 한다.

export const WORLD_W = 800, WORLD_H = 520;

// 거북이 그리기: 앞으로 F, 왼쪽 L·오른쪽 R 로 (각도, 반지름) 만큼 돈다.
// 곧은 길과 반듯한 커브가 섞인 트랙(경기장·머리핀·도시)을 손으로 맞추기 쉽다.
// 화면은 y 가 아래쪽이라 heading 90° 가 아래, -90° 가 위다.
function turtle(x, y, headingDeg, cmds, step = 40) {
  let th = headingDeg * Math.PI / 180;
  const out = [[x, y]];
  for (const [c, a, r] of cmds) {
    if (c === 'F') {
      const k = Math.max(1, Math.round(a / step));
      for (let i = 0; i < k; i++) { x += Math.cos(th) * a / k; y += Math.sin(th) * a / k; out.push([x, y]); }
    } else {
      const sg = c === 'L' ? -1 : 1, tot = a * Math.PI / 180;
      const k = Math.max(2, Math.round(r * tot / step));
      // 커브 중심은 차의 왼쪽(L) 또는 오른쪽(R)
      const cx = x + Math.cos(th + sg * Math.PI / 2) * r, cy = y + Math.sin(th + sg * Math.PI / 2) * r;
      const a0 = Math.atan2(y - cy, x - cx);
      for (let i = 1; i <= k; i++) {
        const ai = a0 + sg * tot * i / k;
        out.push([cx + Math.cos(ai) * r, cy + Math.sin(ai) * r]);
      }
      x = out[out.length - 1][0]; y = out[out.length - 1][1]; th += sg * tot;
    }
  }
  out.pop();                      // 마지막 점 = 첫 점 (닫힌 길)
  return out.map(([a, b]) => [Math.round(a * 10) / 10, Math.round(b * 10) / 10]);
}

// level: 1 쉬움 · 2 보통 · 3 어려움. unseen: 연습에 쓰지 말고 시험에 쓰는 트랙.
// 조절점 방향은 상관없다 — 차는 pts[0] 에서 pts[1] 쪽으로 출발하고, "거꾸로" 를 고르면 반대로 돈다.
// 처음 세 트랙(oval·wavy·test)은 DEVELOP.md 의 잰 결과가 기대는 트랙이라 모양을 바꾸지 않는다.
export const TRACKS = [
  {
    id: 'oval', label: '둥근 트랙', width: 74, level: 1,
    ctrl: Array.from({ length: 12 }, (_, i) => {
      const a = i / 12 * Math.PI * 2;
      return [400 + 300 * Math.cos(a), 260 + 180 * Math.sin(a)];
    }),
  },
  {
    id: 'wavy', label: '구불구불 트랙', width: 70, level: 2,
    ctrl: [[110, 130], [300, 90], [400, 200], [500, 90], [690, 120], [720, 300],
           [640, 440], [470, 390], [330, 450], [140, 410], [90, 270]],
  },
  {
    id: 'test', label: '처음 보는 트랙', width: 70, level: 2, unseen: true,
    ctrl: [[100, 250], [190, 100], [350, 130], [420, 250], [560, 110], [720, 170],
           [710, 400], [540, 450], [420, 380], [270, 450], [120, 420]],
  },
  {
    // 긴 직선 두 개 + 반원 두 개. 곧게 가는 장면이 아주 많다
    id: 'stadium', label: '경기장 트랙', width: 74, level: 1, per: 8,
    ctrl: turtle(250, 440, 0, [['F', 300], ['L', 180, 170], ['F', 300], ['L', 180, 170]]),
  },
  {
    // 뱀처럼 왼쪽·오른쪽 커브가 번갈아 나온다
    id: 'snake', label: '뱀 트랙', width: 70, level: 2,
    ctrl: [[90, 110], [240, 80], [330, 160], [270, 260], [340, 350], [470, 370],
           [540, 280], [490, 180], [570, 90], [710, 100], [730, 260], [700, 430],
           [420, 465], [140, 450], [70, 290]],
  },
  {
    // 바깥으로 크게 돌다가 안쪽으로 한 번 움푹 들어간다 (반대쪽 커브가 하나)
    id: 'bean', label: '콩 트랙', width: 72, level: 2,
    ctrl: [[180, 110], [400, 80], [620, 110], [730, 260], [640, 430], [500, 440],
           [400, 330], [300, 440], [160, 430], [70, 280]],
  },
  {
    // 네모난 길모퉁이 — 직각 커브가 왼쪽·오른쪽으로 모두 있다
    id: 'city', label: '도시 블록', width: 70, level: 2, per: 8,
    ctrl: turtle(120, 380, -90, [
      ['F', 140], ['R', 90, 55], ['F', 70], ['L', 90, 55], ['R', 90, 55], ['F', 250],
      ['R', 90, 55], ['F', 140], ['R', 90, 55], ['F', 50], ['L', 90, 55], ['R', 90, 55],
      ['F', 270], ['R', 90, 55],
    ]),
  },
  {
    // 산을 오르내리는 지그재그 + 아래쪽 긴 직선
    id: 'mountain', label: '산길 트랙', width: 70, level: 3,
    ctrl: [[100, 420], [90, 230], [170, 110], [260, 210], [345, 110], [430, 210],
           [515, 110], [600, 210], [690, 120], [730, 260], [700, 420], [400, 460]],
  },
  {
    // 바늘처럼 U자로 꺾이는 커브 네 번 — 가장 어렵다
    id: 'hairpin', label: '머리핀 트랙', width: 70, level: 3, per: 8,
    ctrl: turtle(110, 410, -90, [
      ['F', 260], ['R', 180, 62], ['F', 150], ['L', 180, 62], ['F', 150], ['R', 180, 62],
      ['F', 150], ['L', 180, 62], ['F', 150], ['R', 180, 55], ['F', 260], ['R', 90, 50],
      ['F', 506], ['R', 90, 50],
    ]),
  },
  {
    id: 'test2', label: '처음 보는 트랙 2', width: 70, level: 3, unseen: true,
    ctrl: [[400, 70], [560, 120], [600, 230], [720, 280], [700, 430], [560, 420],
           [470, 330], [400, 450], [240, 430], [100, 420], [120, 280], [210, 230],
           [180, 110]],
  },
];

// 닫힌 Catmull-Rom 곡선 → 촘촘한 점들
function spline(ctrl, per = 24) {
  const n = ctrl.length, out = [];
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
    for (let s = 0; s < per; s++) {
      const t = s / per, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  return out;
}

// 중심선 점들 (미니 그림용 — 마스크를 안 만들어서 가볍다)
export function centerline(def, reverse = false) {
  const pts = spline(def.ctrl, def.per || 24);
  // 거꾸로: 출발점은 그대로 두고 도는 방향만 바꾼다
  return reverse ? [pts[0], ...pts.slice(1).reverse()] : pts;
}

function buildMask(pts, hw) {
  const n = pts.length, mask = new Uint8Array(WORLD_W * WORLD_H);
  // 선분마다 주변 상자만 훑어서 도로 픽셀을 칠한다
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - hw)), x1 = Math.min(WORLD_W - 1, Math.ceil(Math.max(ax, bx) + hw));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - hw)), y1 = Math.min(WORLD_H - 1, Math.ceil(Math.max(ay, by) + hw));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (mask[y * WORLD_W + x]) continue;
        let t = ((x - ax) * dx + (y - ay) * dy) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = ax + t * dx - x, ey = ay + t * dy - y;
        if (ex * ex + ey * ey <= hw * hw) mask[y * WORLD_W + x] = 1;
      }
    }
  }
  return mask;
}

// 같은 트랙의 두 방향은 마스크를 함께 쓴다 (만들기가 가장 무거운 부분)
const maskCache = new Map();
export function buildTrack(def, reverse = false) {
  const pts = centerline(def, reverse), n = pts.length, hw = def.width / 2;
  let mask = maskCache.get(def.id);
  if (!mask) { mask = buildMask(pts, hw); maskCache.set(def.id, mask); }
  const start = { x: pts[0][0], y: pts[0][1], th: Math.atan2(pts[1][1] - pts[0][1], pts[1][0] - pts[0][0]) };
  return { def, reverse, pts, n, hw, mask, start };
}

export function onRoad(track, x, y) {
  const xi = x | 0, yi = y | 0;
  if (xi < 0 || yi < 0 || xi >= WORLD_W || yi >= WORLD_H) return false;
  return track.mask[yi * WORLD_W + xi] === 1;
}

// 지난번 위치 근처에서 가장 가까운 중심선 점 번호 (한 바퀴 진행도 계산용)
export function nearestIdx(track, x, y, around) {
  const { pts, n } = track;
  let best = around, bd = Infinity;
  for (let k = -12; k <= 30; k++) {
    const i = ((around + k) % n + n) % n;
    const d = (pts[i][0] - x) ** 2 + (pts[i][1] - y) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
