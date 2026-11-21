// フィルターと色調補正。結果を全面のテクスチャに作り、選択範囲と透明ピクセルのロックを守って元と混ぜる。
// 試している間は合成の差し替えで見せ、決定したときにレイヤーへ書く（取り消し 1 回分）。
import { hexToRgb } from "./compositor";
import type { Layer } from "./doc";
import type { Program, Rect, Tex } from "./gl";
import { HASH_GLSL, HEADER, RECT_VS } from "./shaders";
import type { Studio } from "./studio";

export interface ParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  def: number;
  unit?: string;
}

export interface FilterDef {
  id: string;
  name: string;
  group: "adjust" | "filter";
  params: ParamDef[];
  /** 色の並び（グラデーションマップ・フチの色）を使うか */
  colors?: "gradient" | "single";
}

const P = (key: string, label: string, min: number, max: number, def: number, step = 0.01, unit?: string): ParamDef => ({ key, label, min, max, def, step, unit });

export const FILTERS: FilterDef[] = [
  { id: "brightness", name: "明るさ・コントラスト", group: "adjust", params: [P("brightness", "明るさ", -1, 1, 0), P("contrast", "コントラスト", -1, 1, 0)] },
  { id: "hsl", name: "色相・彩度・明度", group: "adjust", params: [P("hue", "色相", -180, 180, 0, 1, "°"), P("saturation", "彩度", -1, 1, 0), P("lightness", "明度", -1, 1, 0)] },
  { id: "levels", name: "レベル補正", group: "adjust", params: [P("inBlack", "入力の黒", 0, 1, 0), P("inWhite", "入力の白", 0, 1, 1), P("gamma", "中間", 0.1, 4, 1), P("outBlack", "出力の黒", 0, 1, 0), P("outWhite", "出力の白", 0, 1, 1)] },
  { id: "curves", name: "トーンカーブ", group: "adjust", params: [P("c0", "暗部（0%）", 0, 1, 0), P("c25", "25%", 0, 1, 0.25), P("c50", "中間（50%）", 0, 1, 0.5), P("c75", "75%", 0, 1, 0.75), P("c100", "明部（100%）", 0, 1, 1)] },
  { id: "color_balance", name: "カラーバランス", group: "adjust", params: [P("r", "シアン ↔ レッド", -1, 1, 0), P("g", "マゼンタ ↔ グリーン", -1, 1, 0), P("b", "イエロー ↔ ブルー", -1, 1, 0)] },
  { id: "invert", name: "階調の反転", group: "adjust", params: [] },
  { id: "posterize", name: "ポスタリゼーション", group: "adjust", params: [P("levels", "階調の数", 2, 32, 6, 1)] },
  { id: "threshold", name: "2 値化", group: "adjust", params: [P("level", "しきい値", 0, 1, 0.5)] },
  { id: "gradient_map", name: "グラデーションマップ", group: "adjust", params: [P("amount", "強さ", 0, 1, 1)], colors: "gradient" },
  { id: "luma_to_alpha", name: "輝度を透明度に変換（白を透明に）", group: "adjust", params: [] },
  { id: "blur", name: "ぼかし（ガウス）", group: "filter", params: [P("radius", "半径", 0.5, 200, 6, 0.5, "px")] },
  { id: "motion_blur", name: "移動ぼかし", group: "filter", params: [P("radius", "長さ", 1, 300, 30, 1, "px"), P("angle", "向き", -180, 180, 0, 1, "°")] },
  { id: "radial_blur", name: "放射ぼかし（ズーム）", group: "filter", params: [P("amount", "強さ", 0, 0.5, 0.08), P("cx", "中心 x（%）", 0, 100, 50, 1), P("cy", "中心 y（%）", 0, 100, 50, 1)] },
  { id: "sharpen", name: "シャープ（アンシャープマスク）", group: "filter", params: [P("amount", "量", 0, 3, 0.8), P("radius", "半径", 0.5, 20, 2, 0.5, "px")] },
  { id: "noise", name: "ノイズ", group: "filter", params: [P("amount", "量", 0, 1, 0.12), P("color", "色の混じり", 0, 1, 0)] },
  { id: "mosaic", name: "モザイク", group: "filter", params: [P("size", "マスの大きさ", 2, 200, 16, 1, "px")] },
  { id: "glow", name: "発光（グロー）", group: "filter", params: [P("radius", "広がり", 1, 200, 24, 1, "px"), P("strength", "強さ", 0, 3, 1), P("threshold", "明るさの境目", 0, 1, 0.6)] },
  { id: "chromatic", name: "色収差", group: "filter", params: [P("amount", "ずれ", 0, 40, 6, 0.5, "px")] },
  { id: "vignette", name: "周辺減光", group: "filter", params: [P("amount", "強さ", 0, 1, 0.45), P("size", "大きさ", 0.2, 1.5, 0.8)] },
  { id: "lineart", name: "線画抽出", group: "filter", params: [P("strength", "線の拾い方", 0, 1, 0.5), P("thickness", "太さ", 0.5, 6, 1.2, 0.1, "px"), P("darkOnly", "暗い所だけ", 0, 1, 0.5)] },
  { id: "outline", name: "フチ（境界効果）", group: "filter", params: [P("width", "幅", 1, 60, 6, 1, "px"), P("softness", "やわらかさ", 0, 1, 0.2)], colors: "single" },
];

export const GRADIENT_MAPS: { name: string; stops: string[] }[] = [
  { name: "夕焼け", stops: ["#1b1035", "#7a2a5b", "#e0644e", "#f9c784", "#fff4d6"] },
  { name: "セピア", stops: ["#1f140c", "#6b4a2b", "#c79a63", "#f3e2c2"] },
  { name: "夜の青", stops: ["#05070f", "#16264a", "#3d6aa8", "#a8d0f0", "#f4fbff"] },
  { name: "青写真", stops: ["#0b2a5a", "#2f6fb5", "#e9f2ff"] },
  { name: "モノクロ", stops: ["#000000", "#ffffff"] },
  { name: "新緑", stops: ["#0d1f14", "#2f6b3a", "#9fd36b", "#f2f7c8"] },
  { name: "ネオン", stops: ["#0a0420", "#4b14a8", "#ff2ea6", "#ffe066"] },
];

const PIX_FS = `${HEADER}
uniform sampler2D u_src;
uniform sampler2D u_lut;
uniform int u_type;
uniform vec4 u_a;
uniform vec4 u_b;
uniform vec2 u_size;
uniform int u_n;
uniform vec3 u_cols[8];
out vec4 o;
${HASH_GLSL}
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 rgb2hsl(vec3 c) {
  float mx = max(max(c.r, c.g), c.b), mn = min(min(c.r, c.g), c.b);
  float l = (mx + mn) * 0.5;
  float d = mx - mn;
  float h = 0.0, s = 0.0;
  if (d > 1e-5) {
    s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
    if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h /= 6.0;
  }
  return vec3(h, s, l);
}
float hue2(float p, float q, float t) {
  t = fract(t);
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}
vec3 hsl2rgb(vec3 h) {
  if (h.y < 1e-5) return vec3(h.z);
  float q = h.z < 0.5 ? h.z * (1.0 + h.y) : h.z + h.y - h.z * h.y;
  float p = 2.0 * h.z - q;
  return vec3(hue2(p, q, h.x + 1.0 / 3.0), hue2(p, q, h.x), hue2(p, q, h.x - 1.0 / 3.0));
}
vec3 gmap(float t) {
  vec3 c = u_cols[0];
  for (int i = 1; i < 8; i++) {
    if (i >= u_n) break;
    float p0 = float(i - 1) / float(u_n - 1);
    float p1 = float(i) / float(u_n - 1);
    if (t >= p0) c = mix(u_cols[i - 1], u_cols[i], clamp((t - p0) / (p1 - p0), 0.0, 1.0));
  }
  return c;
}
void main() {
  ivec2 cp = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(u_src, cp, 0);
  if (u_type == 13) {
    // モザイク: マスの中心の色
    float m = max(1.0, u_a.x);
    vec2 c = (floor(vec2(cp) / m) + 0.5) * m;
    o = texture(u_src, min(c, u_size - 1.0) / u_size);
    return;
  }
  if (u_type == 14) {
    // 色収差: 中心から外へ R と B をずらす
    vec2 p = vec2(cp) + 0.5;
    vec2 dir = normalize(p - u_size * 0.5 + 1e-4) * u_a.x * (length(p - u_size * 0.5) / length(u_size * 0.5));
    vec4 r = texture(u_src, (p + dir) / u_size);
    vec4 b = texture(u_src, (p - dir) / u_size);
    o = vec4(r.r, s.g, b.b, max(max(r.a, s.a), b.a));
    o.rgb = min(o.rgb, vec3(o.a));
    return;
  }
  if (u_type == 17) {
    // 放射ぼかし
    vec2 c = u_b.xy * u_size;
    vec2 p = vec2(cp) + 0.5;
    vec4 acc = vec4(0.0);
    for (int i = 0; i < 32; i++) {
      float k = 1.0 - u_a.x * float(i) / 31.0;
      acc += texture(u_src, (c + (p - c) * k) / u_size);
    }
    o = acc / 32.0;
    return;
  }
  float a = s.a;
  vec3 c = a > 1e-5 ? s.rgb / a : vec3(0.0);
  if (u_type == 0) {
    c = c + u_a.x;
    float k = u_a.y >= 0.0 ? 1.0 / max(1e-3, 1.0 - u_a.y) : 1.0 + u_a.y;
    c = (c - 0.5) * k + 0.5;
  } else if (u_type == 1) {
    vec3 h = rgb2hsl(clamp(c, 0.0, 1.0));
    h.x = fract(h.x + u_a.x / 360.0);
    h.y = clamp(u_a.y >= 0.0 ? h.y + (1.0 - h.y) * u_a.y : h.y * (1.0 + u_a.y), 0.0, 1.0);
    c = hsl2rgb(h);
    c = u_a.z >= 0.0 ? mix(c, vec3(1.0), u_a.z) : c * (1.0 + u_a.z);
  } else if (u_type == 2) {
    c = clamp((c - u_a.x) / max(1e-3, u_a.y - u_a.x), 0.0, 1.0);
    c = pow(c, vec3(1.0 / max(0.05, u_a.z)));
    c = mix(vec3(u_a.w), vec3(u_b.x), c);
  } else if (u_type == 3) {
    c = vec3(texture(u_lut, vec2(clamp(c.r, 0.0, 1.0) * 255.0 / 256.0 + 0.5 / 256.0, 0.5)).r,
             texture(u_lut, vec2(clamp(c.g, 0.0, 1.0) * 255.0 / 256.0 + 0.5 / 256.0, 0.5)).r,
             texture(u_lut, vec2(clamp(c.b, 0.0, 1.0) * 255.0 / 256.0 + 0.5 / 256.0, 0.5)).r);
  } else if (u_type == 4) {
    float l = lum(c);
    float mid = 1.0 - abs(l - 0.5) * 2.0;
    c += u_a.xyz * (0.35 + 0.4 * mid);
  } else if (u_type == 5) {
    c = 1.0 - c;
  } else if (u_type == 6) {
    float n = max(2.0, u_a.x);
    c = floor(c * n) / (n - 1.0);
    c = min(c, vec3(1.0));
  } else if (u_type == 7) {
    c = vec3(step(u_a.x, lum(c)));
  } else if (u_type == 8) {
    c = mix(c, gmap(clamp(lum(c), 0.0, 1.0)), u_a.x);
  } else if (u_type == 9) {
    // 白を透明に（GIMP の color to alpha と同じ考え方）
    vec3 cc = clamp(c, 0.0, 1.0);
    float na = max(max(1.0 - cc.r, 1.0 - cc.g), 1.0 - cc.b);
    vec3 x = na > 1e-4 ? (cc - (1.0 - na)) / na : vec3(0.0);
    o = vec4(clamp(x, 0.0, 1.0) * na * a, na * a);
    return;
  } else if (u_type == 10) {
    float n = hash12(vec2(cp) * 1.37 + u_a.z) - 0.5;
    vec3 nc = vec3(hash12(vec2(cp) + 11.3), hash12(vec2(cp) + 47.1), hash12(vec2(cp) + 91.7)) - 0.5;
    c += mix(vec3(n), nc, u_a.y) * u_a.x;
  } else if (u_type == 15) {
    vec2 p = (vec2(cp) + 0.5) / u_size - 0.5;
    float d = length(p * vec2(u_size.x / max(u_size.x, u_size.y), u_size.y / max(u_size.x, u_size.y))) / max(0.05, u_a.y);
    c *= 1.0 - u_a.x * smoothstep(0.35, 0.9, d);
  }
  c = clamp(c, 0.0, 1.0);
  o = vec4(c * a, a);
}
`;

/** 2 枚から作る（シャープ・発光・線画・フチ）。 */
const COMBINE_FS = `${HEADER}
uniform sampler2D u_src;
uniform sampler2D u_blur;
uniform int u_type;
uniform vec4 u_a;
uniform vec3 u_color;
out vec4 o;
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  ivec2 cp = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(u_src, cp, 0);
  vec4 b = texelFetch(u_blur, cp, 0);
  if (u_type == 0) {
    // シャープ
    o = clamp(s + (s - b) * u_a.x, 0.0, 1.0);
    o.rgb = min(o.rgb, vec3(o.a));
  } else if (u_type == 1) {
    // 発光: 明るい所をぼかしたもの（b）を足す
    vec3 add = b.rgb * u_a.y;
    o = vec4(min(s.rgb + add, vec3(1.0)), max(s.a, min(1.0, lum(add))));
    o.rgb = min(o.rgb, vec3(o.a));
  } else if (u_type == 2) {
    // 線画抽出: 明るさのくぼみ（ぼかしより暗い所）を線に
    float ls = s.a > 0.0 ? lum(s.rgb / max(s.a, 1e-4)) * s.a + (1.0 - s.a) : 1.0;
    float lb = b.a > 0.0 ? lum(b.rgb / max(b.a, 1e-4)) * b.a + (1.0 - b.a) : 1.0;
    float edge = clamp((lb - ls) * (4.0 + 26.0 * u_a.x), 0.0, 1.0);
    float dark = clamp((0.85 - ls) * 2.0, 0.0, 1.0);
    float v = max(edge, dark * u_a.y);
    o = vec4(vec3(0.0), smoothstep(0.08, 0.9, v));
  } else {
    // フチ: 太らせた不透明度（b.a）を色で塗り、その上に元の絵
    float k = smoothstep(0.0, max(0.02, 1.0 - u_a.y * 0.95), b.a);
    vec4 edge = vec4(u_color, 1.0) * k;
    o = s + edge * (1.0 - s.a);
  }
}
`;

/** 不透明度を太らせる（フチ用）: 半径内の最大。 */
const DILATE_FS = `${HEADER}
uniform sampler2D u_src;
uniform float u_r;
uniform vec2 u_size;
out vec4 o;
void main() {
  vec2 p = gl_FragCoord.xy;
  float m = 0.0;
  for (int i = 0; i < 48; i++) {
    float a = float(i) * 0.1309;
    for (int j = 1; j <= 4; j++) {
      vec2 q = p + vec2(cos(a), sin(a)) * u_r * float(j) / 4.0;
      m = max(m, texture(u_src, q / u_size).a);
    }
  }
  m = max(m, texture(u_src, p / u_size).a);
  o = vec4(0.0, 0.0, 0.0, m);
}
`;

const BLUR2_FS = `${HEADER}
uniform sampler2D u_src;
uniform vec2 u_dir;
uniform float u_sigma;
uniform int u_r;
uniform vec2 u_size;
uniform int u_bright;
uniform float u_th;
out vec4 o;
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec4 pick(vec2 q) {
  vec4 c = texture(u_src, q / u_size);
  if (u_bright == 1) {
    float l = c.a > 0.0 ? lum(c.rgb / c.a) : 0.0;
    c *= smoothstep(u_th, min(1.0, u_th + 0.15), l);
  }
  return c;
}
void main() {
  vec2 p = gl_FragCoord.xy;
  vec4 acc = vec4(0.0);
  float ws = 0.0;
  for (int i = -48; i <= 48; i++) {
    if (i < -u_r || i > u_r) continue;
    float w = exp(-float(i * i) / (2.0 * u_sigma * u_sigma));
    acc += pick(p + u_dir * float(i)) * w;
    ws += w;
  }
  o = acc / ws;
}
`;

const MIX_FS = `${HEADER}
uniform sampler2D u_layer;
uniform sampler2D u_res;
uniform sampler2D u_sel;
uniform int u_hasSel;
uniform int u_alphaLock;
uniform ivec2 u_origin;
out vec4 o;
void main() {
  ivec2 cp = ivec2(gl_FragCoord.xy) + u_origin;
  vec4 L = texelFetch(u_layer, cp, 0);
  vec4 R = texelFetch(u_res, cp, 0);
  if (u_alphaLock == 1) {
    vec3 c = R.a > 1e-5 ? R.rgb / R.a : vec3(0.0);
    R = vec4(clamp(c, 0.0, 1.0) * L.a, L.a);
  }
  float m = u_hasSel == 1 ? texelFetch(u_sel, cp, 0).r : 1.0;
  o = mix(L, R, m);
}
`;

interface Progs {
  pix: Program;
  comb: Program;
  dil: Program;
  blur: Program;
  mix: Program;
}
let progs: Progs | null = null;
function getProgs(s: Studio): Progs {
  if (!progs) {
    const g = s.g;
    progs = {
      pix: g.program("f:pix", RECT_VS, PIX_FS),
      comb: g.program("f:comb", RECT_VS, COMBINE_FS),
      dil: g.program("f:dil", RECT_VS, DILATE_FS),
      blur: g.program("f:blur", RECT_VS, BLUR2_FS),
      mix: g.program("f:mix", RECT_VS, MIX_FS),
    };
  }
  return progs;
}

const PIX_TYPE: Record<string, number> = { brightness: 0, hsl: 1, levels: 2, curves: 3, color_balance: 4, invert: 5, posterize: 6, threshold: 7, gradient_map: 8, luma_to_alpha: 9, noise: 10, mosaic: 13, chromatic: 14, vignette: 15, radial_blur: 17 };

/** 単調な 3 次補間で 5 点のカーブを 256 段の表に。 */
function curveLut(pts: number[]): Uint8Array {
  const xs = [0, 0.25, 0.5, 0.75, 1];
  const n = xs.length;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((pts[i + 1] - pts[i]) / (xs[i + 1] - xs[i]));
  const m: number[] = [d[0]];
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  const out = new Uint8Array(256);
  for (let k = 0; k < 256; k++) {
    const x = k / 255;
    let i = Math.min(n - 2, Math.floor(x / 0.25));
    if (i < 0) i = 0;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    const y = (2 * t3 - 3 * t2 + 1) * pts[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * pts[i + 1] + (t3 - t2) * h * m[i + 1];
    out[k] = Math.round(Math.min(1, Math.max(0, y)) * 255);
  }
  return out;
}

export class FilterSession {
  readonly s: Studio;
  readonly layer: Layer;
  readonly def: FilterDef;
  private A: Tex;
  private B: Tex;
  private C: Tex | null = null;
  result: Tex;
  private lut: Tex | null = null;
  private done = false;

  static begin(s: Studio, id: string): FilterSession | null {
    const def = FILTERS.find((f) => f.id === id);
    if (!def) return null;
    const l = s.paintableLayer("color");
    if (!l || !l.tex) return null;
    return new FilterSession(s, l, def);
  }

  private constructor(s: Studio, l: Layer, def: FilterDef) {
    this.s = s;
    this.layer = l;
    this.def = def;
    const g = s.g;
    const d = s.doc;
    this.A = g.createTex(d.w, d.h, g.hiFormat, "fA");
    this.B = g.createTex(d.w, d.h, g.hiFormat, "fB");
    this.result = this.A;
    s.comp.overrides.set(l.id, (dst, rect) => this.mixInto(dst, rect, false));
  }

  private full(): Rect {
    return { x: 0, y: 0, w: this.s.doc.w, h: this.s.doc.h };
  }

  private pass(p: Program, dst: Tex): void {
    const g = this.s.g;
    g.target(dst);
    g.blend("none");
    p.use();
    p.f("u_rect", 0, 0, dst.w, dst.h).f("u_tsize", dst.w, dst.h).f("u_size", dst.w, dst.h);
  }

  /** 方向つきぼかし（大きい半径は何回かに分ける）。src → dst。tmp を使う。 */
  private blur(src: Tex, dst: Tex, tmp: Tex, radius: number, dirAngle: number | null, bright = false, th = 0): void {
    const pr = getProgs(this.s).blur;
    const sigmaTotal = Math.max(0.5, radius / 2);
    const passes = Math.max(1, Math.ceil(sigmaTotal / 16));
    const sigma = sigmaTotal / Math.sqrt(passes);
    const r = Math.min(48, Math.ceil(sigma * 2.6));
    let cur = src;
    for (let k = 0; k < passes; k++) {
      const dirs: [number, number][] = dirAngle === null ? [[1, 0], [0, 1]] : [[Math.cos(dirAngle), Math.sin(dirAngle)]];
      for (let j = 0; j < dirs.length; j++) {
        const last = k === passes - 1 && j === dirs.length - 1;
        const out = last ? dst : cur === tmp ? dst : tmp;
        this.pass(pr, out);
        pr.t("u_src", cur).f("u_dir", dirs[j][0], dirs[j][1]).f("u_sigma", sigma).i("u_r", r).i("u_bright", bright && k === 0 && j === 0 ? 1 : 0).f("u_th", th);
        this.s.g.drawQuad();
        cur = out;
      }
    }
    if (cur !== dst) this.s.g.copy(cur, dst, 0, 0, dst.w, dst.h, 0, 0);
  }

  private ensureC(): Tex {
    if (!this.C) this.C = this.s.g.createTex(this.s.doc.w, this.s.doc.h, this.s.g.hiFormat, "fC");
    return this.C;
  }

  /** 設定を変えて作り直す。 */
  update(params: Record<string, number>, colors: string[] = []): void {
    const s = this.s;
    const g = s.g;
    const pr = getProgs(s);
    const src = this.layer.tex!;
    const id = this.def.id;
    const v = (k: string) => params[k] ?? this.def.params.find((p) => p.key === k)?.def ?? 0;
    if (id in PIX_TYPE) {
      const p = pr.pix;
      this.pass(p, this.A);
      p.t("u_src", src).i("u_type", PIX_TYPE[id]);
      let a = [0, 0, 0, 0];
      let b = [0, 0, 0, 0];
      if (id === "brightness") a = [v("brightness") * 0.5, v("contrast"), 0, 0];
      else if (id === "hsl") a = [v("hue"), v("saturation"), v("lightness"), 0];
      else if (id === "levels") {
        a = [v("inBlack"), v("inWhite"), v("gamma"), v("outBlack")];
        b = [v("outWhite"), 0, 0, 0];
      } else if (id === "color_balance") a = [v("r") * 0.3, v("g") * 0.3, v("b") * 0.3, 0];
      else if (id === "posterize") a = [Math.round(v("levels")), 0, 0, 0];
      else if (id === "threshold") a = [v("level"), 0, 0, 0];
      else if (id === "gradient_map") a = [v("amount"), 0, 0, 0];
      else if (id === "noise") a = [v("amount"), v("color"), Math.random() * 100, 0];
      else if (id === "mosaic") a = [v("size"), 0, 0, 0];
      else if (id === "chromatic") a = [v("amount"), 0, 0, 0];
      else if (id === "vignette") a = [v("amount"), v("size"), 0, 0];
      else if (id === "radial_blur") {
        a = [v("amount"), 0, 0, 0];
        b = [v("cx") / 100, v("cy") / 100, 0, 0];
      }
      p.f("u_a", a[0], a[1], a[2], a[3]).f("u_b", b[0], b[1], b[2], b[3]);
      if (id === "curves") {
        const lut = curveLut([v("c0"), v("c25"), v("c50"), v("c75"), v("c100")]);
        if (!this.lut) this.lut = g.createTex(256, 1, "r8", "lut", { data: lut });
        else g.upload(this.lut, lut);
      }
      p.t("u_lut", this.lut ?? src);
      const cols = (colors.length ? colors : GRADIENT_MAPS[0].stops).slice(0, 8);
      const arr = new Float32Array(24);
      cols.forEach((c, i) => arr.set(hexToRgb(c), i * 3));
      g.gl.uniform3fv(p.loc("u_cols[0]"), arr);
      p.i("u_n", cols.length);
      g.drawQuad();
      this.result = this.A;
    } else if (id === "blur" || id === "motion_blur") {
      // src（RGBA8）→ A へ写してからぼかす
      this.copyIn(src, this.B);
      this.blur(this.B, this.A, this.ensureC(), v("radius"), id === "motion_blur" ? (v("angle") * Math.PI) / 180 : null);
      this.result = this.A;
    } else if (id === "sharpen" || id === "glow" || id === "lineart") {
      this.copyIn(src, this.B);
      const C = this.ensureC();
      const radius = id === "glow" ? v("radius") : id === "lineart" ? v("thickness") * 2.2 : v("radius");
      this.blur(this.B, C, this.A, radius, null, id === "glow", v("threshold"));
      const p = pr.comb;
      this.pass(p, this.A);
      p.t("u_src", this.B).t("u_blur", C).i("u_type", id === "sharpen" ? 0 : id === "glow" ? 1 : 2);
      p.f("u_a", id === "sharpen" ? v("amount") : v("strength"), id === "glow" ? v("strength") : v("darkOnly"), 0, 0).f("u_color", 0, 0, 0);
      g.drawQuad();
      this.result = this.A;
    } else if (id === "outline") {
      this.copyIn(src, this.B);
      const C = this.ensureC();
      const dp = pr.dil;
      this.pass(dp, C);
      dp.t("u_src", this.B).f("u_r", v("width"));
      g.drawQuad();
      const p = pr.comb;
      this.pass(p, this.A);
      const col = hexToRgb(colors[0] ?? "#ffffff");
      p.t("u_src", this.B).t("u_blur", C).i("u_type", 3).f("u_a", 0, v("softness"), 0, 0).f("u_color", col[0], col[1], col[2]);
      g.drawQuad();
      this.result = this.A;
    }
    s.comp.mark(this.full());
    s.requestFrame();
  }

  private copyIn(src: Tex, dst: Tex): void {
    const g = this.s.g;
    const p = getProgs(this.s).mix;
    // MIX_FS で「結果 = src」にする（選択なし・混ぜ率 1）
    g.target(dst);
    g.blend("none");
    p.use();
    p.f("u_rect", 0, 0, dst.w, dst.h).f("u_tsize", dst.w, dst.h);
    p.t("u_layer", src).t("u_res", src).t("u_sel", src).i("u_hasSel", 0).i("u_alphaLock", 0);
    g.gl.uniform2i(p.loc("u_origin"), 0, 0);
    g.drawQuad();
  }

  /** 元と結果を選択範囲で混ぜて dst へ（タイルなら origin 付き）。 */
  private mixInto(dst: Tex, rect: Rect, full: boolean): void {
    const g = this.s.g;
    const p = getProgs(this.s).mix;
    g.target(dst, full ? rect : undefined);
    g.blend("none");
    p.use();
    if (full) p.f("u_rect", rect.x, rect.y, rect.w, rect.h).f("u_tsize", dst.w, dst.h);
    else p.f("u_rect", 0, 0, rect.w, rect.h).f("u_tsize", dst.w, dst.h);
    const sel = this.s.doc.selection;
    p.t("u_layer", this.layer.tex!).t("u_res", this.result).t("u_sel", sel ?? this.result).i("u_hasSel", sel ? 1 : 0).i("u_alphaLock", this.layer.props.alphaLock ? 1 : 0);
    g.gl.uniform2i(p.loc("u_origin"), full ? 0 : rect.x, full ? 0 : rect.y);
    g.drawQuad();
    g.gl.disable(g.gl.SCISSOR_TEST);
  }

  commit(label?: string): void {
    if (this.done) return;
    this.done = true;
    const s = this.s;
    const d = s.doc;
    s.comp.overrides.delete(this.layer.id);
    const area = d.selBounds ? { ...d.selBounds } : this.full();
    s.hist.begin(label ?? this.def.name);
    try {
      s.hist.save(this.layer, "color", area);
      const tmp = s.g.createTex(d.w, d.h, "rgba8", "fOut", { filter: "nearest" });
      this.mixInto(tmp, area, true);
      s.g.copy(tmp, this.layer.tex!, area.x, area.y, area.w, area.h, area.x, area.y);
      s.g.deleteTex(tmp);
      this.layer.touch(area);
      // フチ・発光・ぼかしは描いてある範囲の外へ広がる
      if (["outline", "glow", "blur", "motion_blur", "radial_blur", "chromatic"].includes(this.def.id)) this.layer.touch({ x: 0, y: 0, w: d.w, h: d.h });
      s.comp.mark(this.full());
    } finally {
      s.hist.end();
    }
    this.cleanup();
    s.emit("pixels");
  }

  cancel(): void {
    if (this.done) return;
    this.done = true;
    this.s.comp.overrides.delete(this.layer.id);
    this.s.comp.mark(this.full());
    this.cleanup();
  }

  private cleanup(): void {
    const g = this.s.g;
    g.deleteTex(this.A);
    g.deleteTex(this.B);
    g.deleteTex(this.C);
    g.deleteTex(this.lut);
    this.s.requestFrame();
  }
}

/** すぐに適用する（AI・台本用）。params は設定の名前と値。 */
export function applyFilterNow(s: Studio, id: string, params: Record<string, unknown>): void {
  const fs = FilterSession.begin(s, id);
  if (!fs) throw new Error(`効果「${id}」はありません`);
  const nums: Record<string, number> = {};
  for (const [k, v] of Object.entries(params)) if (typeof v === "number") nums[k] = v;
  let colors: string[] = [];
  const st = params.stops ?? params.colors ?? params.color;
  if (Array.isArray(st)) colors = st.map((c) => (Array.isArray(c) ? String(c[0]) : String(c))).filter((c) => /^#?[0-9a-f]{3,6}$/i.test(c)).map((c) => (c.startsWith("#") ? c : `#${c}`));
  else if (typeof st === "string") colors = [st];
  fs.update(nums, colors);
  fs.commit();
}
