// ═══════════════════════════════════════════════════════════
// 운전 활동 — 트랙 (DOM 없음: 브라우저·node 양쪽에서 쓴다)
// ═══════════════════════════════════════════════════════════
// 트랙 = 닫힌 중심선(Catmull-Rom 곡선) + 폭.
// 도로 판정은 픽셀 마스크(Uint8Array)로 한다 — 센서 광선을 쏠 때 O(1) 로 본다.
// 세계 좌표는 800×520 고정. 화면에서는 캔버스 크기에 맞춰 늘린다.

export const WORLD_W = 800, WORLD_H = 520;

// 조절점(시계 방향이든 반대든 상관없다 — 차는 pts[0] 에서 pts[1] 쪽으로 출발한다)
export const TRACKS = [
  {
    id: 'oval', label: '둥근 트랙', width: 74,
    ctrl: Array.from({ length: 12 }, (_, i) => {
      const a = i / 12 * Math.PI * 2;
      return [400 + 300 * Math.cos(a), 260 + 180 * Math.sin(a)];
    }),
  },
  {
    id: 'wavy', label: '구불구불 트랙', width: 70,
    ctrl: [[110, 130], [300, 90], [400, 200], [500, 90], [690, 120], [720, 300],
           [640, 440], [470, 390], [330, 450], [140, 410], [90, 270]],
  },
  {
    id: 'test', label: '처음 보는 트랙', width: 70, unseen: true,
    ctrl: [[100, 250], [190, 100], [350, 130], [420, 250], [560, 110], [720, 170],
           [710, 400], [540, 450], [420, 380], [270, 450], [120, 420]],
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

export function buildTrack(def) {
  const pts = spline(def.ctrl), n = pts.length, hw = def.width / 2;
  const mask = new Uint8Array(WORLD_W * WORLD_H);
  // 선분마다 주변 상자만 훑어서 도로 픽셀을 칠한다
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - hw)), x1 = Math.min(WORLD_W - 1, Math.ceil(Math.max(ax, bx) + hw));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - hw)), y1 = Math.min(WORLD_H - 1, Math.ceil(Math.max(ay, by) + hw));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        let t = ((x - ax) * dx + (y - ay) * dy) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = ax + t * dx - x, ey = ay + t * dy - y;
        if (ex * ex + ey * ey <= hw * hw) mask[y * WORLD_W + x] = 1;
      }
    }
  }
  const start = { x: pts[0][0], y: pts[0][1], th: Math.atan2(pts[1][1] - pts[0][1], pts[1][0] - pts[0][0]) };
  return { def, pts, n, hw, mask, start };
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
