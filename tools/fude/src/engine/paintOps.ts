// 形で塗る・グラデーション・塗りつぶし。どれも筆跡バッファに描いてから、筆と同じ確定の仕組みでレイヤーへ。
import { blendIndex } from "./blend";
import type { MergeOptions } from "./brush/render";
import { hexToRgb } from "./compositor";
import type { Layer } from "./doc";
import { floodMask, type FloodOpts } from "./flood";
import type { Program, Rect, Tex } from "./gl";
import { rectClip } from "./gl";
import { rasterPolys, type Poly } from "./raster";
import { referencePixels } from "./selection";
import { HEADER, RECT_VS } from "./shaders";
import type { Studio } from "./studio";

const MASKPAINT_FS = `${HEADER}
uniform sampler2D u_mask;
uniform ivec2 u_off;
uniform vec4 u_color;
uniform sampler2D u_grain;
uniform int u_hasGrain;
uniform float u_grainScale;
uniform float u_grainStrength;
out vec4 o;
void main() {
  ivec2 cp = ivec2(gl_FragCoord.xy);
  float m = texelFetch(u_mask, cp - u_off, 0).r * u_color.a;
  if (u_hasGrain == 1) {
    float g = texture(u_grain, vec2(cp) / (512.0 * u_grainScale)).r;
    m *= mix(1.0, smoothstep(0.15, 0.75, g), u_grainStrength);
  }
  o = vec4(u_color.rgb * m, m);
}
`;

const GRAD_FS = `${HEADER}
uniform vec2 u_a;
uniform vec2 u_b;
uniform int u_kind;
uniform int u_n;
uniform vec4 u_col[8];
uniform float u_pos[8];
out vec4 o;
void main() {
  vec2 p = gl_FragCoord.xy;
  vec2 ab = u_b - u_a;
  float t;
  if (u_kind == 1) t = length(p - u_a) / max(length(ab), 1e-3);
  else t = dot(p - u_a, ab) / max(dot(ab, ab), 1e-6);
  t = clamp(t, 0.0, 1.0);
  vec4 c = u_col[0];
  for (int i = 1; i < 8; i++) {
    if (i >= u_n) break;
    float p0 = u_pos[i - 1];
    float p1 = u_pos[i];
    if (t >= p0) {
      float k = clamp((t - p0) / max(p1 - p0, 1e-5), 0.0, 1.0);
      c = mix(u_col[i - 1], u_col[i], k);
    }
  }
  o = vec4(c.rgb * c.a, c.a);
}
`;

let maskProg: Program | null = null;
let gradProg: Program | null = null;
let maskTex: Tex | null = null;

function mergeOpts(s: Studio, l: Layer, channel: "color" | "mask", opacity: number, blend: string, erase: boolean): MergeOptions {
  return {
    mode: blendIndex(blend),
    erase,
    alphaLock: channel === "color" && l.props.alphaLock,
    maskTarget: channel === "mask",
    opacity,
    sel: s.doc.selection,
    wetEdge: 0,
    wetRadius: 0,
    grain: null,
    grainScale: 1,
  };
}

/** 筆跡バッファの rect をレイヤーへ確定（取り消し保存つき）。手順は呼ぶ側が開く。 */
function commit(s: Studio, l: Layer, channel: "color" | "mask", rect: Rect, mo: MergeOptions): void {
  const tex = channel === "mask" ? l.maskTex : l.tex;
  if (!tex) return;
  s.hist.save(l, channel, rect);
  s.br.commit(rect, tex, mo);
  s.br.clearStroke(rect);
  l.touch(rect);
  s.comp.mark(rect);
}

export interface PaintOpts {
  opacity?: number;
  blend?: string;
  erase?: boolean;
  grain?: string;
  grainStrength?: number;
  grainScale?: number;
}

/** マスク（rect の範囲）で色を塗る。 */
export function paintMask(s: Studio, l: Layer, region: { data: Uint8Array; rect: Rect }, hex: string, o: PaintOpts = {}): void {
  const g = s.g;
  const d = s.doc;
  const channel = d.editMask && l.id === d.activeId ? "mask" : "color";
  const r = rectClip(region.rect, d.w, d.h);
  if (!r) return;
  const R = region.rect;
  if (!maskTex || maskTex.w < R.w || maskTex.h < R.h) {
    g.deleteTex(maskTex);
    maskTex = g.createTex(Math.max(R.w, 256), Math.max(R.h, 256), "r8", "paintMask", { filter: "nearest" });
  }
  g.upload(maskTex, region.data, 0, 0, R.w, R.h);
  if (!maskProg) maskProg = g.program("maskpaint", RECT_VS, MASKPAINT_FS);
  g.target(s.br.stroke, r);
  g.blend("none");
  const p = maskProg.use();
  p.f("u_rect", r.x, r.y, r.w, r.h).f("u_tsize", d.w, d.h);
  p.t("u_mask", maskTex);
  g.gl.uniform2i(p.loc("u_off"), R.x, R.y);
  const c = hexToRgb(hex);
  p.f("u_color", c[0], c[1], c[2], 1);
  const grain = o.grain && o.grain !== "none" ? s.tex.grains.get(o.grain as never) ?? null : null;
  p.t("u_grain", grain ?? maskTex).i("u_hasGrain", grain ? 1 : 0).f("u_grainScale", o.grainScale ?? 1).f("u_grainStrength", o.grainStrength ?? 0.5);
  g.drawQuad();
  g.gl.disable(g.gl.SCISSOR_TEST);
  commit(s, l, channel, r, mergeOpts(s, l, channel, o.opacity ?? 1, o.blend ?? "normal", o.erase ?? false));
}

/** 多角形（AI の fill・図形の塗り）で塗る。feather はぼかし（画素）。 */
export function paintPolys(s: Studio, l: Layer, polys: Poly[], hex: string, o: PaintOpts & { feather?: number; rule?: "nonzero" | "evenodd" } = {}): Rect | null {
  const d = s.doc;
  const feather = o.feather ?? 0;
  const r = rasterPolys(polys, d.w, d.h, o.rule ?? "nonzero", Math.ceil(feather * 2) + 1);
  if (!r) return null;
  if (feather > 0) {
    // 小さい範囲なので CPU でぼかす
    r.data = blur(r.data, r.rect.w, r.rect.h, feather);
  }
  paintMask(s, l, r, hex, o);
  return r.rect;
}

function blur(src: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const rad = Math.max(1, Math.round(radius / 1.7));
  const a = new Float32Array(src);
  const b = new Float32Array(src.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      let acc = 0;
      const o = y * w;
      for (let x = -rad; x <= rad; x++) acc += a[o + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        b[o + x] = acc / (2 * rad + 1);
        acc += a[o + Math.min(w - 1, x + rad + 1)] - a[o + Math.max(0, x - rad)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -rad; y <= rad; y++) acc += b[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = acc / (2 * rad + 1);
        acc += b[Math.min(h - 1, y + rad + 1) * w + x] - b[Math.max(0, y - rad) * w + x];
      }
    }
  }
  const out = new Uint8Array(src.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(Math.min(255, Math.max(0, a[i])));
  return out;
}

export interface GradStop {
  color: string;
  alpha: number;
  pos: number;
}

/** グラデーション（選択範囲があればその中だけ）。 */
export function paintGradient(s: Studio, l: Layer, a: [number, number], b: [number, number], stops: GradStop[], kind: "linear" | "radial", o: PaintOpts = {}): void {
  const g = s.g;
  const d = s.doc;
  const channel = d.editMask && l.id === d.activeId ? "mask" : "color";
  const rect: Rect = d.selBounds ? { ...d.selBounds } : { x: 0, y: 0, w: d.w, h: d.h };
  if (!gradProg) gradProg = g.program("gradient", RECT_VS, GRAD_FS);
  g.target(s.br.stroke, rect);
  g.blend("none");
  const p = gradProg.use();
  p.f("u_rect", rect.x, rect.y, rect.w, rect.h).f("u_tsize", d.w, d.h);
  p.f("u_a", a[0], a[1]).f("u_b", b[0], b[1]).i("u_kind", kind === "radial" ? 1 : 0);
  const st = [...stops].sort((x, y) => x.pos - y.pos).slice(0, 8);
  const cols = new Float32Array(32);
  const pos = new Float32Array(8);
  st.forEach((c, i) => {
    const rgb = hexToRgb(c.color);
    cols.set([rgb[0], rgb[1], rgb[2], c.alpha], i * 4);
    pos[i] = c.pos;
  });
  for (let i = st.length; i < 8; i++) pos[i] = 1;
  g.gl.uniform4fv(p.loc("u_col[0]"), cols);
  g.gl.uniform1fv(p.loc("u_pos[0]"), pos);
  p.i("u_n", st.length);
  g.drawQuad();
  g.gl.disable(g.gl.SCISSOR_TEST);
  commit(s, l, channel, rect, mergeOpts(s, l, channel, o.opacity ?? 1, o.blend ?? "normal", o.erase ?? false));
}

/** 塗りつぶし（バケツ）。塗ったら true。 */
export function bucketFill(s: Studio, x: number, y: number, hex: string, opts?: Partial<FloodOpts> & { refer?: "layer" | "all" | "ref"; opacity?: number; erase?: boolean }): boolean {
  const d = s.doc;
  const l = s.paintableLayer();
  if (!l) return false;
  const f = { ...s.ui.fill, ...opts };
  const px = referencePixels(s, f.refer);
  const r = floodMask(px, d.w, d.h, x, y, { tolerance: f.tolerance, gap: f.gap, expand: f.expand, contiguous: f.contiguous, antialias: f.antialias });
  if (!r) return false;
  const rect = { x: r.x0, y: r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0 };
  const data = new Uint8Array(rect.w * rect.h);
  for (let j = 0; j < rect.h; j++) data.set(r.mask.subarray((rect.y + j) * d.w + rect.x, (rect.y + j) * d.w + rect.x + rect.w), j * rect.w);
  paintMask(s, l, { data, rect }, hex, { opacity: opts?.opacity ?? 1, erase: opts?.erase ?? s.colors.transparent });
  return true;
}

/** 文字の多角形などで使う、手順込みの「塗る」。 */
export function withStep(s: Studio, label: string, fn: () => void): void {
  s.hist.begin(label);
  try {
    fn();
  } finally {
    s.hist.end();
    s.emit("pixels");
    s.requestFrame();
  }
}
