// ═══════════════════════════════════════════════════════════
// 색 활동 — 예시 장면 (DOM 없음, 카메라 없는 교실용)
// ═══════════════════════════════════════════════════════════
// 픽셀 = 물건 색(반사율) × 조명 색 × 밝기 × 그늘 + 잡음.
// 조명을 바꾸면 같은 블록도 카메라에 다른 숫자로 찍힌다 — 3차시의 핵심.
// 반환 형식은 ImageData 와 같다: { width, height, data: Uint8ClampedArray(RGBA) }

export const LIGHTS = {
  normal: { label: '보통 조명', rgb: [1, 1, 1], k: 1.0 },
  dark: { label: '어두운 조명', rgb: [1, 1, 1], k: 0.26 },
  sunset: { label: '노을 조명', rgb: [1.0, 0.55, 0.25], k: 0.9 },
};

export const BLOCKS = [
  { id: 'red', label: '빨강', rgb: [0.80, 0.13, 0.10] },
  { id: 'green', label: '초록', rgb: [0.16, 0.62, 0.22] },
  { id: 'blue', label: '파랑', rgb: [0.12, 0.26, 0.78] },
  { id: 'yellow', label: '노랑', rgb: [0.92, 0.80, 0.16] },
];
export const BELT = [0.36, 0.36, 0.38];

export function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function img(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
function put(im, x, y, c, light, shade, rnd, noise = 0.035) {
  const i = (y * im.width + x) * 4;
  for (let ch = 0; ch < 3; ch++) {
    const v = c[ch] * light.rgb[ch] * light.k * shade + (rnd() - 0.5) * 2 * noise;
    im.data[i + ch] = Math.round(Math.min(1, Math.max(0, v)) * 255);
  }
  im.data[i + 3] = 255;
}

// 블록 한 개 (윗면이 밝고 오른쪽 옆면이 어둡다) — 컨베이어 위 물건
export function blockPatch(color, light, rnd, size = 24) {
  const im = img(size, size), side = Math.round(size * 0.3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const shade = x >= size - side ? 0.62 : y < 3 ? 1.08 : 0.95 - 0.1 * (y / size);
    put(im, x, y, color, light, shade, rnd);
  }
  return im;
}

// 컨베이어 위 블록 여러 개 — 칠해서 가르치는 사진. truth[y*w+x] = 종류 번호 (0=바탕, 1~=BLOCKS 순서)
export function blocksScene(lightId, rnd, { w = 320, h = 200 } = {}) {
  const light = LIGHTS[lightId], im = img(w, h), truth = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const stripe = ((x + y * 0.3) | 0) % 40 < 3 ? 0.85 : 1;      // 벨트 줄무늬
    put(im, x, y, BELT, light, stripe * (0.9 + 0.1 * y / h), rnd);
  }
  const size = 46;
  BLOCKS.forEach((b, i) => {
    for (let n = 0; n < 2; n++) {
      const x0 = 14 + i * 76 + (n ? 10 : 0), y0 = n ? 112 : 26;
      const p = blockPatch(b.rgb, light, rnd, size);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const X = x0 + x, Y = y0 + y, s = (y * size + x) * 4, d = (Y * w + X) * 4;
        for (let ch = 0; ch < 4; ch++) im.data[d + ch] = p.data[s + ch];
        truth[Y * w + X] = i + 1;
      }
    }
  });
  return { image: im, truth };
}

// 투명 망토용 방: 배경 사진과, 같은 방에 초록 망토를 두른 사람이 선 사진
export function roomScenes(rnd, { w = 320, h = 240, cloak = [0.18, 0.60, 0.26], shirt = [0.30, 0.52, 0.30] } = {}) {
  const light = LIGHTS.normal;
  const bg = img(w, h), fg = img(w, h), truth = new Uint8Array(w * h);   // truth: 1 = 망토
  const wall = [0.86, 0.82, 0.72], floor = [0.55, 0.42, 0.30], shelf = [0.45, 0.30, 0.20], plant = [0.20, 0.45, 0.20];
  const skin = [0.90, 0.72, 0.60], hair = [0.15, 0.12, 0.10], pants = [0.20, 0.22, 0.35];
  const back = (x, y) => {
    if (y > h * 0.72) return [floor, 0.9 + 0.1 * (y / h)];
    if (x > w * 0.72 && x < w * 0.92 && y > h * 0.25 && y < h * 0.7) return [shelf, 0.95];
    if (x > w * 0.06 && x < w * 0.16 && y > h * 0.45 && y < h * 0.72) return [plant, 1];   // 초록 화분 — 망토와 헷갈리는 함정
    return [wall, 0.92 + 0.08 * (x / w)];
  };
  const cx = w * 0.45;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const r2 = rnd;
    const [bc, bs] = back(x, y);
    const nb = rnd();
    put(bg, x, y, bc, light, bs, () => nb);
    let c = bc, s = bs, isCloak = false;
    const dx = x - cx;
    if ((dx ** 2) / 22 ** 2 + ((y - h * 0.2) ** 2) / 26 ** 2 < 1) { c = y < h * 0.14 ? hair : skin; s = 1; }
    else if (y > h * 0.3 && y < h * 0.78 && Math.abs(dx) < 34 + (y - h * 0.3) * 0.35) {
      // 망토: 주름 그늘. 가운데 아래 셔츠가 조금 보인다 (비슷한 초록 — 두 번째 함정)
      if (Math.abs(dx) < 10 && y > h * 0.35 && y < h * 0.55) { c = shirt; s = 0.95; }
      else { c = cloak; s = 0.78 + 0.22 * Math.sin(dx / 6) ** 2; isCloak = true; }
    } else if (y >= h * 0.78 && Math.abs(dx) < 26 && Math.abs(dx) > 4) { c = pants; s = 0.9; }
    put(fg, x, y, c, light, s, r2);
    truth[y * w + x] = isCloak ? 1 : 0;
  }
  return { background: bg, person: fg, truth };
}
