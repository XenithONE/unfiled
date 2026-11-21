// 塗りつぶし・自動選択のための CPU 処理（GPU に触らない・Node でも試せる）。
// 入力は乗算済み RGBA。結果は 0..255 のマスク。

export interface FloodOpts {
  /** 色の誤差 0..100 */
  tolerance: number;
  /** 隙間閉じ（画素） */
  gap: number;
  /** 領域拡縮（画素、負で縮める） */
  expand: number;
  contiguous: boolean;
  antialias: boolean;
}

export interface MaskResult {
  mask: Uint8Array;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  count: number;
}

/** 二値マスクを正方形に太らせる（半径 r）。行ごと・列ごとの累積和で O(N)。 */
export function dilate(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return src.slice();
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  const pre = new Int32Array(Math.max(w, h) + 1);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    pre[0] = 0;
    for (let x = 0; x < w; x++) pre[x + 1] = pre[x] + (src[o + x] ? 1 : 0);
    for (let x = 0; x < w; x++) {
      const a = Math.max(0, x - r);
      const b = Math.min(w, x + r + 1);
      tmp[o + x] = pre[b] - pre[a] > 0 ? 1 : 0;
    }
  }
  for (let x = 0; x < w; x++) {
    pre[0] = 0;
    for (let y = 0; y < h; y++) pre[y + 1] = pre[y] + tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      const a = Math.max(0, y - r);
      const b = Math.min(h, y + r + 1);
      out[y * w + x] = pre[b] - pre[a] > 0 ? 1 : 0;
    }
  }
  return out;
}

export function erode(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return src.slice();
  const inv = new Uint8Array(w * h);
  for (let i = 0; i < inv.length; i++) inv[i] = src[i] ? 0 : 1;
  const d = dilate(inv, w, h, r);
  for (let i = 0; i < d.length; i++) d[i] = d[i] ? 0 : 1;
  return d;
}

/** 0..255 のマスクをぼかす（箱ぼかし 3 回 ≒ ガウス）。 */
export function blurMask(src: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  if (radius < 0.5) return src.slice();
  const r = Math.max(1, Math.round(radius / 1.7));
  const a = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) a[i] = src[i];
  const b = new Float32Array(src.length);
  const pre = new Float64Array(Math.max(w, h) + 1);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      const o = y * w;
      pre[0] = 0;
      for (let x = 0; x < w; x++) pre[x + 1] = pre[x] + a[o + x];
      for (let x = 0; x < w; x++) {
        const lo = Math.max(0, x - r);
        const hi = Math.min(w, x + r + 1);
        b[o + x] = (pre[hi] - pre[lo]) / (hi - lo);
      }
    }
    for (let x = 0; x < w; x++) {
      pre[0] = 0;
      for (let y = 0; y < h; y++) pre[y + 1] = pre[y] + b[y * w + x];
      for (let y = 0; y < h; y++) {
        const lo = Math.max(0, y - r);
        const hi = Math.min(h, y + r + 1);
        a[y * w + x] = (pre[hi] - pre[lo]) / (hi - lo);
      }
    }
    // 横は a→b、縦は b→a。1 回ごとに結果は a に入る
  }
  const out = new Uint8Array(src.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(Math.min(255, Math.max(0, a[i])));
  return out;
}

function similar(px: Uint8Array, i: number, r: number, g: number, b: number, a: number, tol: number): boolean {
  const j = i * 4;
  return Math.abs(px[j] - r) <= tol && Math.abs(px[j + 1] - g) <= tol && Math.abs(px[j + 2] - b) <= tol && Math.abs(px[j + 3] - a) <= tol;
}

/** 走査線の塗りつぶし。can[i] が 1 の所だけ広がる。 */
function scanFill(can: Uint8Array, w: number, h: number, sx: number, sy: number): Uint8Array {
  const out = new Uint8Array(w * h);
  if (!can[sy * w + sx]) return out;
  const stack: number[] = [sx, sy];
  while (stack.length) {
    const y = stack.pop()!;
    let x = stack.pop()!;
    let i = y * w + x;
    if (out[i] || !can[i]) continue;
    while (x > 0 && can[i - 1] && !out[i - 1]) {
      x--;
      i--;
    }
    let up = false;
    let dn = false;
    while (x < w && can[i] && !out[i]) {
      out[i] = 1;
      if (y > 0) {
        const u = i - w;
        if (can[u] && !out[u]) {
          if (!up) {
            stack.push(x, y - 1);
            up = true;
          }
        } else up = false;
      }
      if (y < h - 1) {
        const d = i + w;
        if (can[d] && !out[d]) {
          if (!dn) {
            stack.push(x, y + 1);
            dn = true;
          }
        } else dn = false;
      }
      x++;
      i++;
    }
  }
  return out;
}

/**
 * (sx,sy) から似た色の範囲を求める。隙間閉じ → 塗る → 戻す → 拡縮 → アンチエイリアス。
 * px は乗算済み RGBA（参照する絵）。
 */
export function floodMask(px: Uint8Array, w: number, h: number, sx: number, sy: number, o: FloodOpts): MaskResult | null {
  sx = Math.floor(sx);
  sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;
  const s0 = (sy * w + sx) * 4;
  const r = px[s0];
  const g = px[s0 + 1];
  const b = px[s0 + 2];
  const a = px[s0 + 3];
  const tol = Math.round((o.tolerance / 100) * 255);
  const N = w * h;
  const match = new Uint8Array(N);
  for (let i = 0; i < N; i++) match[i] = similar(px, i, r, g, b, a, tol) ? 1 : 0;
  let region: Uint8Array;
  if (!o.contiguous) {
    region = match;
  } else if (o.gap > 0) {
    // 線（＝合わない所）を太らせて隙間をふさいでから塗る
    const wall = new Uint8Array(N);
    for (let i = 0; i < N; i++) wall[i] = match[i] ? 0 : 1;
    const thick = dilate(wall, w, h, o.gap);
    const can = new Uint8Array(N);
    for (let i = 0; i < N; i++) can[i] = thick[i] ? 0 : 1;
    let filled = can[sy * w + sx] ? scanFill(can, w, h, sx, sy) : scanFill(match, w, h, sx, sy);
    if (can[sy * w + sx]) {
      // 太らせた分を、合う所の中だけ戻す
      const grown = dilate(filled, w, h, o.gap + 1);
      for (let i = 0; i < N; i++) grown[i] = grown[i] && match[i] ? 1 : 0;
      // 戻した所のうち、元の領域とつながっている所だけ
      filled = scanFill(grown, w, h, sx, sy);
    }
    region = filled;
  } else {
    region = scanFill(match, w, h, sx, sy);
  }
  if (o.expand > 0) region = dilate(region, w, h, Math.round(o.expand));
  else if (o.expand < 0) region = erode(region, w, h, Math.round(-o.expand));
  let mask: Uint8Array = new Uint8Array(N);
  for (let i = 0; i < N; i++) mask[i] = region[i] ? 255 : 0;
  if (o.antialias) mask = antialias(mask, w, h);
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  let count = 0;
  for (let y = 0; y < h; y++) {
    const off = y * w;
    for (let x = 0; x < w; x++) {
      if (mask[off + x]) {
        count++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (count === 0) return null;
  return { mask, x0, y0, x1: x1 + 1, y1: y1 + 1, count };
}

/** 境目だけ 3×3 の平均でなめらかに。 */
export function antialias(m: Uint8Array, w: number, h: number): Uint8Array {
  const out = m.slice();
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = m[i];
      if (m[i - 1] === v && m[i + 1] === v && m[i - w] === v && m[i + w] === v) continue;
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += m[i + dy * w + dx];
      out[i] = Math.max(v === 255 ? 128 : 0, Math.round(s / 9));
    }
  }
  return out;
}

/** マスクの範囲（何もなければ null）。 */
export function maskBounds(m: Uint8Array, w: number, h: number): { x: number; y: number; w: number; h: number } | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let any = false;
    for (let x = 0; x < w; x++) {
      if (m[o + x]) {
        any = true;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
      }
    }
    if (any) {
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
