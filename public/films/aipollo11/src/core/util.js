// 時間で決まる動き（どのコマも「時刻 t の関数」）を書くための小道具
export const TAU = Math.PI * 2;
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
/** 区間 [a,b] の進み具合 0..1 */
export const seg = (t, a, b) => clamp((t - a) / (b - a));
export const smooth = (x) => x * x * (3 - 2 * x);

export const ease = {
  lin: (x) => x,
  in: (x) => x * x,
  out: (x) => 1 - (1 - x) * (1 - x),
  io: (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2),
  in3: (x) => x * x * x,
  out3: (x) => 1 - Math.pow(1 - x, 3),
  io3: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  out5: (x) => 1 - Math.pow(1 - x, 5),
  in5: (x) => Math.pow(x, 5),
  back: (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
  backIn: (x) => { const c1 = 1.70158, c3 = c1 + 1; return c3 * x * x * x - c1 * x * x; },
  elastic: (x) => (x === 0 ? 0 : x === 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * (TAU / 3)) + 1),
  bounce: (x) => {
    const n1 = 7.5625, d1 = 2.75;
    if (x < 1 / d1) return n1 * x * x;
    if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
    if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
    return n1 * (x -= 2.625 / d1) * x + 0.984375;
  },
  smooth,
};

/** キーの列 [[時刻, 値, イージング名?], ...] から時刻 t の値。値は数か配列。 */
export function key(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (t >= last[0]) return last[1];
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i];
    if (t <= b[0]) {
      const a = keys[i - 1];
      let u = (t - a[0]) / (b[0] - a[0]);
      const e = b[2] ? (typeof b[2] === 'function' ? b[2] : ease[b[2]]) : ease.io;
      u = e(u);
      if (typeof a[1] === 'number') return a[1] + (b[1] - a[1]) * u;
      return a[1].map((v, k) => v + (b[1][k] - v) * u);
    }
  }
  return last[1];
}

/** 0→1→0 の山（t0 から dur 秒） */
export const bump = (t, t0, dur) => { const u = (t - t0) / dur; return u <= 0 || u >= 1 ? 0 : Math.sin(u * Math.PI); };
/** ぽんっと出る（行き過ぎて戻る）拡大 0→1 */
export const pop = (t, t0, dur = 0.32) => (t <= t0 ? 0 : ease.back(seg(t, t0, t0 + dur)));
/** 出て、居て、引っ込む（0→1→0） */
export const popInOut = (t, t0, t1, dIn = 0.3, dOut = 0.18) => (t <= t0 || t >= t1 ? 0 : Math.min(ease.back(seg(t, t0, t0 + dIn)), 1 - ease.in(seg(t, t1 - dOut, t1))));

export function hash1(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return s - Math.floor(s); }
export function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** なめらかな 1 次元ノイズ −1..1 */
export function vnoise(t, seed = 0) {
  const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f);
  return lerp(hash1(i + seed * 57.31), hash1(i + 1 + seed * 57.31), u) * 2 - 1;
}
/** 放物線の跳ね（u: 0..1 → 高さ 0..1..0） */
export const arc = (u) => (u <= 0 || u >= 1 ? 0 : 4 * u * (1 - u));
/** 自然なまばたき（たまに 2 回）。開き具合 1..0 */
export function blink(t, seed = 0, period = 3.1) {
  const k = Math.floor(t / period + seed * 0.37);
  const off = 0.4 + hash1(k + seed * 13.7) * (period - 0.8);
  const local = t - (k - seed * 0.37) * period - off;
  const one = (x) => (x < 0 || x > 0.16 ? 1 : 1 - Math.sin((x / 0.16) * Math.PI) * 0.95);
  let v = one(local);
  if (hash1(k * 3.3 + seed) > 0.7) v = Math.min(v, one(local - 0.26));
  return v;
}
export const deg = (d) => (d * Math.PI) / 180;
