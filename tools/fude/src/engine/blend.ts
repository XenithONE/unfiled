// 合成モード（CLIP STUDIO PAINT の並びに合わせた 28 種）と、その GLSL。
// psd = PSD の合成キー、ora = OpenRaster の composite-op。

export interface BlendInfo {
  id: string;
  name: string;
  psd: string;
  ora: string;
}

export const BLEND_MODES: readonly BlendInfo[] = [
  { id: "normal", name: "通常", psd: "norm", ora: "svg:src-over" },
  { id: "darken", name: "比較（暗）", psd: "dark", ora: "svg:darken" },
  { id: "multiply", name: "乗算", psd: "mul ", ora: "svg:multiply" },
  { id: "colorBurn", name: "焼き込みカラー", psd: "idiv", ora: "svg:color-burn" },
  { id: "linearBurn", name: "焼き込み（リニア）", psd: "lbrn", ora: "fude:linear-burn" },
  { id: "subtract", name: "減算", psd: "fsub", ora: "fude:subtract" },
  { id: "lighten", name: "比較（明）", psd: "lite", ora: "svg:lighten" },
  { id: "screen", name: "スクリーン", psd: "scrn", ora: "svg:screen" },
  { id: "colorDodge", name: "覆い焼きカラー", psd: "div ", ora: "svg:color-dodge" },
  { id: "glowDodge", name: "覆い焼き（発光）", psd: "div ", ora: "fude:glow-dodge" },
  { id: "add", name: "加算", psd: "lddg", ora: "svg:plus" },
  { id: "addGlow", name: "加算（発光）", psd: "lddg", ora: "fude:add-glow" },
  { id: "overlay", name: "オーバーレイ", psd: "over", ora: "svg:overlay" },
  { id: "softLight", name: "ソフトライト", psd: "sLit", ora: "svg:soft-light" },
  { id: "hardLight", name: "ハードライト", psd: "hLit", ora: "svg:hard-light" },
  { id: "difference", name: "差の絶対値", psd: "diff", ora: "svg:difference" },
  { id: "vividLight", name: "ビビッドライト", psd: "vLit", ora: "fude:vivid-light" },
  { id: "linearLight", name: "リニアライト", psd: "lLit", ora: "fude:linear-light" },
  { id: "pinLight", name: "ピンライト", psd: "pLit", ora: "fude:pin-light" },
  { id: "hardMix", name: "ハードミックス", psd: "hMix", ora: "fude:hard-mix" },
  { id: "exclusion", name: "除外", psd: "smud", ora: "fude:exclusion" },
  { id: "darkerColor", name: "カラー比較（暗）", psd: "dkCl", ora: "fude:darker-color" },
  { id: "lighterColor", name: "カラー比較（明）", psd: "lgCl", ora: "fude:lighter-color" },
  { id: "divide", name: "除算", psd: "fdiv", ora: "fude:divide" },
  { id: "hue", name: "色相", psd: "hue ", ora: "svg:hue" },
  { id: "saturation", name: "彩度", psd: "sat ", ora: "svg:saturation" },
  { id: "color", name: "カラー", psd: "colr", ora: "svg:color" },
  { id: "luminosity", name: "輝度", psd: "lum ", ora: "svg:luminosity" },
];

export type BlendMode = (typeof BLEND_MODES)[number]["id"];

const INDEX = new Map(BLEND_MODES.map((b, i) => [b.id, i]));

export function blendIndex(id: string): number {
  return INDEX.get(id) ?? 0;
}

export function isBlendMode(id: string): boolean {
  return INDEX.has(id);
}

export function blendName(id: string): string {
  return BLEND_MODES[blendIndex(id)].name;
}

/** PSD の合成キーから。重複するキー（div / lddg）は通常の方へ。 */
export function blendFromPsd(key: string): string {
  if (key === "pass") return "pass";
  for (const b of BLEND_MODES) if (b.psd === key) return b.id;
  return "normal";
}

export function blendFromOra(op: string): string {
  for (const b of BLEND_MODES) if (b.ora === op) return b.id;
  if (op === "krita:linear_burn") return "linearBurn";
  return "normal";
}

/** 合成の GLSL。色は乗算済み (premultiplied) で受け、乗算済みで返す。 */
export const BLEND_GLSL = /* glsl */ `
float lum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
vec3 clipColor(vec3 c) {
  float l = lum(c);
  float n = min(min(c.r, c.g), c.b);
  float x = max(max(c.r, c.g), c.b);
  if (n < 0.0) c = l + (c - l) * l / max(l - n, 1e-6);
  if (x > 1.0) c = l + (c - l) * (1.0 - l) / max(x - l, 1e-6);
  return c;
}
vec3 setLum(vec3 c, float l) { return clipColor(c + (l - lum(c))); }
float sat(vec3 c) { return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b); }
vec3 setSat(vec3 c, float s) {
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  if (mx - mn < 1e-6) return vec3(0.0);
  return (c - mn) * s / (mx - mn);
}
float burn1(float b, float s) { if (b >= 1.0) return 1.0; if (s <= 0.0) return 0.0; return 1.0 - min(1.0, (1.0 - b) / s); }
float dodge1(float b, float s) { if (b <= 0.0) return 0.0; if (s >= 1.0) return 1.0; return min(1.0, b / (1.0 - s)); }
float soft1(float b, float s) {
  if (s <= 0.5) return b - (1.0 - 2.0 * s) * b * (1.0 - b);
  float d = b <= 0.25 ? ((16.0 * b - 12.0) * b + 4.0) * b : sqrt(b);
  return b + (2.0 * s - 1.0) * (d - b);
}
float vivid1(float b, float s) { return s <= 0.5 ? burn1(b, 2.0 * s) : dodge1(b, 2.0 * (s - 0.5)); }
vec3 burn3(vec3 b, vec3 s) { return vec3(burn1(b.r, s.r), burn1(b.g, s.g), burn1(b.b, s.b)); }
vec3 dodge3(vec3 b, vec3 s) { return vec3(dodge1(b.r, s.r), dodge1(b.g, s.g), dodge1(b.b, s.b)); }
vec3 soft3(vec3 b, vec3 s) { return vec3(soft1(b.r, s.r), soft1(b.g, s.g), soft1(b.b, s.b)); }
vec3 vivid3(vec3 b, vec3 s) { return vec3(vivid1(b.r, s.r), vivid1(b.g, s.g), vivid1(b.b, s.b)); }
vec3 hard3(vec3 b, vec3 s) {
  vec3 m = 2.0 * s * b;
  vec3 sc = 1.0 - 2.0 * (1.0 - s) * (1.0 - b);
  return mix(m, sc, step(0.5, s));
}
vec3 blendFn(int mode, vec3 b, vec3 s) {
  if (mode == 1) return min(b, s);
  if (mode == 2) return b * s;
  if (mode == 3) return burn3(b, s);
  if (mode == 4) return max(b + s - 1.0, 0.0);
  if (mode == 5) return max(b - s, 0.0);
  if (mode == 6) return max(b, s);
  if (mode == 7) return b + s - b * s;
  if (mode == 8 || mode == 9) return dodge3(b, s);
  if (mode == 10 || mode == 11) return min(b + s, 1.0);
  if (mode == 12) return hard3(s, b);
  if (mode == 13) return soft3(b, s);
  if (mode == 14) return hard3(b, s);
  if (mode == 15) return abs(b - s);
  if (mode == 16) return vivid3(b, s);
  if (mode == 17) return clamp(b + 2.0 * s - 1.0, 0.0, 1.0);
  if (mode == 18) return mix(min(b, 2.0 * s), max(b, 2.0 * s - 1.0), step(0.5, s));
  if (mode == 19) return step(1.0, b + s);
  if (mode == 20) return b + s - 2.0 * b * s;
  if (mode == 21) return lum(s) < lum(b) ? s : b;
  if (mode == 22) return lum(s) > lum(b) ? s : b;
  if (mode == 23) return vec3(s.r > 0.0 ? min(1.0, b.r / s.r) : 1.0, s.g > 0.0 ? min(1.0, b.g / s.g) : 1.0, s.b > 0.0 ? min(1.0, b.b / s.b) : 1.0);
  if (mode == 24) return setLum(setSat(s, sat(b)), lum(b));
  if (mode == 25) return setLum(setSat(b, sat(s)), lum(b));
  if (mode == 26) return setLum(s, lum(b));
  if (mode == 27) return setLum(b, lum(s));
  return s;
}
vec3 unpremul(vec4 c) { return c.a > 1e-5 ? clamp(c.rgb / c.a, 0.0, 1.0) : vec3(0.0); }
// dst の上に src を重ねる（W3C の合成式）。
vec4 blendOver(vec4 dst, vec4 src, int mode) {
  if (mode == 0) return src + dst * (1.0 - src.a);
  float ab = dst.a, as = src.a;
  if (mode == 11) {
    float ao = as + ab - as * ab;
    return vec4(min(dst.rgb + src.rgb, vec3(ao)), ao);
  }
  vec3 cb = unpremul(dst);
  vec3 cs = unpremul(src);
  if (mode == 9) {
    vec3 bd = dodge3(cb, clamp(src.rgb, 0.0, 1.0));
    float ao = as + ab * (1.0 - as);
    return vec4(bd * ab + src.rgb * (1.0 - ab), ao);
  }
  vec3 B = blendFn(mode, cb, cs);
  vec3 co = src.rgb * (1.0 - ab) + as * ab * B + dst.rgb * (1.0 - as);
  return vec4(co, as + ab * (1.0 - as));
}
// クリッピング用: dst の不透明度を保ったまま src を重ねる（source-atop）。
vec4 blendAtop(vec4 dst, vec4 src, int mode) {
  float ab = dst.a, as = src.a;
  vec3 cb = unpremul(dst);
  vec3 cs = unpremul(src);
  vec3 B = mode == 0 ? cs : (mode == 11 ? min(cb + cs, 1.0) : blendFn(mode, cb, cs));
  return vec4(as * ab * B + dst.rgb * (1.0 - as), ab);
}
`;
