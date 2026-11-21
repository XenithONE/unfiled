// 変形（移動・拡大縮小・回転・反転・自由変形）。選択範囲があればその中身だけ、なければレイヤー全体。
// 変形中はレイヤーを直接変えず、合成の差し替えで見せる。確定したときに初めて書き込む。
import type { Layer } from "./doc";
import type { Program, Rect, Tex } from "./gl";
import { rectClip, rectUnion } from "./gl";
import { HEADER, RECT_VS } from "./shaders";
import type { Studio } from "./studio";

export type P2 = [number, number];
export type Quad = [P2, P2, P2, P2];

const EXTRACT_FS = `${HEADER}
uniform sampler2D u_layer;
uniform sampler2D u_sel;
uniform int u_hasSel;
uniform int u_mode;
uniform ivec2 u_off;
out vec4 o;
void main() {
  ivec2 cp = ivec2(gl_FragCoord.xy) + u_off;
  vec4 L = texelFetch(u_layer, cp, 0);
  float m = u_hasSel == 1 ? texelFetch(u_sel, cp, 0).r : 1.0;
  o = u_mode == 0 ? L * m : L * (1.0 - m);
}
`;

const XFORM_FS = `${HEADER}
uniform sampler2D u_base;
uniform int u_hasBase;
uniform sampler2D u_float;
uniform mat3 u_inv;
uniform ivec2 u_origin;
uniform int u_r8;
out vec4 o;
void main() {
  ivec2 cp = ivec2(gl_FragCoord.xy) + u_origin;
  vec4 B = u_hasBase == 1 ? texelFetch(u_base, cp, 0) : vec4(0.0);
  vec3 q = u_inv * vec3(vec2(cp) + 0.5, 1.0);
  vec2 uv = q.xy / q.z;
  vec4 F = vec4(0.0);
  if (q.z > 0.0) {
    F = texture(u_float, uv);
    vec2 fw = max(fwidth(uv), vec2(1e-6));
    float e = min(min(uv.x, 1.0 - uv.x) / fw.x, min(uv.y, 1.0 - uv.y) / fw.y);
    F *= clamp(e + 0.5, 0.0, 1.0);
  }
  if (u_r8 == 1) {
    float v = F.r + B.r * (1.0 - F.r);
    o = vec4(v, v, v, 1.0);
  } else {
    o = F + B * (1.0 - F.a);
  }
}
`;

let extractProg: Program | null = null;
let xformProg: Program | null = null;

/** 単位正方形 → quad の射影変換（3×3・行優先）。 */
export function squareToQuad(q: Quad): number[] {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  let g = 0;
  let h = 0;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    const den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) > 1e-12) {
      g = (dx3 * dy2 - dx2 * dy3) / den;
      h = (dx1 * dy3 - dx3 * dy1) / den;
    }
  }
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + h * x3;
  const c = x0;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + h * y3;
  const f = y0;
  return [a, b, c, d, e, f, g, h, 1];
}

export function invert3(m: number[]): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const k = 1 / det;
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k];
}

export function quadBounds(q: Quad): Rect {
  const xs = q.map((p) => p[0]);
  const ys = q.map((p) => p[1]);
  const x0 = Math.floor(Math.min(...xs)) - 1;
  const y0 = Math.floor(Math.min(...ys)) - 1;
  return { x: x0, y: y0, w: Math.ceil(Math.max(...xs)) + 1 - x0, h: Math.ceil(Math.max(...ys)) + 1 - y0 };
}

export class FloatTransform {
  readonly s: Studio;
  readonly layer: Layer;
  readonly src: Rect;
  private float: Tex;
  private floatSel: Tex | null = null;
  private base: Tex | null = null;
  quad: Quad;
  private done = false;

  static begin(s: Studio): FloatTransform | null {
    const l = s.paintableLayer("color");
    if (!l || !l.tex) return null;
    const d = s.doc;
    const src = d.selection && d.selBounds ? rectClip(d.selBounds, d.w, d.h) : l.bounds ? rectClip(l.bounds, d.w, d.h) : null;
    if (!src) {
      s.toast("動かす物がありません（レイヤーが空です）", "warn");
      return null;
    }
    return new FloatTransform(s, l, src);
  }

  private constructor(s: Studio, l: Layer, src: Rect) {
    this.s = s;
    this.layer = l;
    this.src = src;
    const g = s.g;
    const d = s.doc;
    if (!extractProg) extractProg = g.program("extract", RECT_VS, EXTRACT_FS);
    if (!xformProg) xformProg = g.program("xform", RECT_VS, XFORM_FS);
    const sel = d.selection;
    // 中身（src の大きさ）
    this.float = g.createTex(src.w, src.h, "rgba8", "float");
    this.extract(this.float, l.tex!, sel, 0, src);
    const gl = g.gl;
    g.bindUtil(this.float);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    if (sel) {
      // 穴のあいた残り（全面）と、選択範囲の形
      this.base = g.createTex(d.w, d.h, "rgba8", "floatBase", { filter: "nearest" });
      this.extract(this.base, l.tex!, sel, 1, { x: 0, y: 0, w: d.w, h: d.h });
      this.floatSel = g.createTex(src.w, src.h, "r8", "floatSel");
      g.copy(sel, this.floatSel, src.x, src.y, src.w, src.h, 0, 0);
    }
    this.quad = [
      [src.x, src.y],
      [src.x + src.w, src.y],
      [src.x + src.w, src.y + src.h],
      [src.x, src.y + src.h],
    ];
    s.comp.overrides.set(l.id, (dst, rect) => this.render(dst, rect, false));
    s.hideAnts = true;
    s.comp.mark(this.dirty());
    s.requestFrame();
  }

  private extract(dst: Tex, layer: Tex, sel: Tex | null, mode: 0 | 1, area: Rect): void {
    const g = this.s.g;
    g.target(dst);
    g.blend("none");
    const p = extractProg!.use();
    p.f("u_rect", 0, 0, area.w, area.h).f("u_tsize", dst.w, dst.h);
    p.t("u_layer", layer).t("u_sel", sel ?? layer).i("u_hasSel", sel ? 1 : 0).i("u_mode", mode);
    g.gl.uniform2i(p.loc("u_off"), area.x, area.y);
    g.drawQuad();
  }

  private invMatrix(): Float32Array | null {
    // canvas → uv: H は uv → canvas
    const H = squareToQuad(this.quad);
    const inv = invert3(H);
    if (!inv) return null;
    // 行優先 → GLSL の列優先
    return new Float32Array([inv[0], inv[3], inv[6], inv[1], inv[4], inv[7], inv[2], inv[5], inv[8]]);
  }

  /** dst（タイル or 全面）の rect へ変形結果を描く。full=true は全面テクスチャへ直接。 */
  private render(dst: Tex, rect: Rect, full: boolean, floatTex: Tex = this.float, base: Tex | null = this.base, r8 = false): void {
    const g = this.s.g;
    const inv = this.invMatrix();
    g.target(dst, full ? rect : undefined);
    g.blend("none");
    const p = xformProg!.use();
    if (full) p.f("u_rect", rect.x, rect.y, rect.w, rect.h).f("u_tsize", dst.w, dst.h);
    else p.f("u_rect", 0, 0, rect.w, rect.h).f("u_tsize", dst.w, dst.h);
    p.t("u_base", base ?? floatTex).i("u_hasBase", base ? 1 : 0);
    p.t("u_float", floatTex).i("u_r8", r8 ? 1 : 0);
    p.m3("u_inv", inv ?? new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 1]));
    g.gl.uniform2i(p.loc("u_origin"), full ? 0 : rect.x, full ? 0 : rect.y);
    g.drawQuad();
    g.gl.disable(g.gl.SCISSOR_TEST);
  }

  private dirty(): Rect {
    const d = this.s.doc;
    return rectClip(rectUnion(this.src, quadBounds(this.quad))!, d.w, d.h) ?? { x: 0, y: 0, w: 1, h: 1 };
  }

  setQuad(q: Quad): void {
    const before = this.dirty();
    this.quad = q;
    this.s.comp.mark(before);
    this.s.comp.mark(this.dirty());
    this.s.requestFrame();
  }

  translate(dx: number, dy: number): void {
    this.setQuad(this.quad.map(([x, y]) => [x + dx, y + dy]) as Quad);
  }

  commit(label = "変形"): void {
    if (this.done) return;
    this.done = true;
    const s = this.s;
    const d = s.doc;
    const area = rectClip(rectUnion(this.src, quadBounds(this.quad))!, d.w, d.h);
    s.comp.overrides.delete(this.layer.id);
    s.hist.begin(label);
    try {
      if (area) {
        s.hist.save(this.layer, "color", area);
        this.render(this.layer.tex!, area, true);
        this.layer.touch(quadBounds(this.quad));
        s.comp.mark(area);
      }
      if (this.floatSel && d.selection) {
        s.hist.selection();
        const nsel = s.g.createTex(d.w, d.h, "r8", "selection", { filter: "nearest" });
        s.g.clear(nsel, 0, 0, 0, 1);
        this.render(nsel, { x: 0, y: 0, w: d.w, h: d.h }, true, this.floatSel, null, true);
        s.g.deleteTex(d.selection);
        d.selection = nsel;
        d.selBounds = rectClip(quadBounds(this.quad), d.w, d.h);
        s.emit("selection");
      }
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
    this.s.comp.mark(this.dirty());
    this.cleanup();
  }

  private cleanup(): void {
    const g = this.s.g;
    g.deleteTex(this.float);
    g.deleteTex(this.base);
    g.deleteTex(this.floatSel);
    this.s.hideAnts = false;
    this.s.requestFrame();
  }

  get finished(): boolean {
    return this.done;
  }
}
