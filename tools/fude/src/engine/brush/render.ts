// 筆を GPU で描く。stamp / water は筆跡バッファへ、mix / smudge / blur はレイヤーを直接書き換える。
import type { GL, Program, Rect, Tex } from "../gl";
import { rectClip, rectUnion } from "../gl";
import { BLUR_FS, HASH_GLSL, HEADER, MERGE_FS, RECT_VS } from "../shaders";
import type { Dab } from "./stroke";
import type { BrushTextures } from "./textures";
import { GRAIN_SIZE, TIP_GRID } from "./textures";

const FLOATS_PER_DAB = 12;
const MAX_BATCH = 4096;

const DAB_VS = `#version 300 es
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec4 a0;
layout(location = 2) in vec4 a1;
layout(location = 3) in vec4 a2;
uniform vec2 u_tsize;
uniform vec2 u_origin;
out vec2 v_local;
out vec2 v_canvas;
flat out vec4 v_a1;
flat out vec4 v_a2;
flat out vec4 v_a0;
flat out float v_as;
void main() {
  float r0 = a0.z;
  float r = max(r0, 0.6);
  float rnd = max(a1.x, 0.05);
  vec2 corner = a_pos * 2.0 - 1.0;
  vec2 l = vec2(corner.x * (r + 1.5), corner.y * (r + 1.5 / rnd));
  vec2 sq = vec2(l.x, l.y * rnd);
  float c = cos(a0.w), s = sin(a0.w);
  vec2 rot = vec2(c * sq.x - s * sq.y, s * sq.x + c * sq.y);
  vec2 p = a0.xy + rot;
  v_canvas = p;
  v_local = l / r;
  v_a0 = a0;
  v_a1 = a1;
  v_a2 = a2;
  v_as = r0 < 0.6 ? max(r0, 0.0) / 0.6 : 1.0;
  gl_Position = vec4((p - u_origin) / u_tsize * 2.0 - 1.0, 0.0, 1.0);
}
`;

const SHAPE_GLSL = `
uniform sampler2D u_tips;
uniform sampler2D u_grain;
uniform int u_hasGrain;
uniform float u_grainScale;
uniform float u_grainStrength;
float dabShape(vec2 local, float hard, float tipI) {
  float d = length(local);
  float aa = max(fwidth(d), 1e-4);
  float m;
  if (tipI < 0.5) {
    float edge = clamp((1.0 - d) / aa + 0.5, 0.0, 1.0);
    if (hard >= 0.985) m = edge;
    else {
      float t = clamp((d - hard) / max(1.0 - hard, 1e-3), 0.0, 1.0);
      m = (1.0 - t * t * (3.0 - 2.0 * t)) * edge;
    }
  } else {
    if (max(abs(local.x), abs(local.y)) > 1.0) return 0.0;
    vec2 uv = clamp(local * 0.5 + 0.5, 0.004, 0.996);
    vec2 cell = vec2(mod(tipI, ${TIP_GRID}.0), floor(tipI / ${TIP_GRID}.0));
    m = texture(u_tips, (cell + uv) / ${TIP_GRID}.0).r;
    if (hard < 0.985) {
      float t = clamp((d - hard) / max(1.0 - hard, 1e-3), 0.0, 1.0);
      m *= 1.0 - t * t * (3.0 - 2.0 * t);
    }
  }
  return m;
}
float grainAt(vec2 canvasPos, float depth) {
  if (u_hasGrain == 0) return 1.0;
  float g = texture(u_grain, canvasPos / (${GRAIN_SIZE}.0 * u_grainScale)).r;
  float th = 1.0 - depth;
  float gm = smoothstep(th - 0.22, th + 0.22, g);
  return mix(1.0, gm, u_grainStrength);
}
`;

const DAB_FS = `${HEADER}
in vec2 v_local;
in vec2 v_canvas;
flat in vec4 v_a1;
flat in vec4 v_a2;
flat in vec4 v_a0;
flat in float v_as;
uniform int u_carry;
uniform sampler2D u_carryTex;
uniform float u_mix;
out vec4 o;
${SHAPE_GLSL}
void main() {
  float m = dabShape(v_local, v_a1.z, v_a1.w);
  if (m <= 0.0) discard;
  m *= grainAt(v_canvas, v_a2.w);
  float a = m * v_a1.y * v_as;
  vec3 col = v_a2.rgb;
  if (u_carry == 1) {
    vec4 c = texelFetch(u_carryTex, ivec2(0), 0);
    vec3 cc = c.a > 1e-4 ? clamp(c.rgb / c.a, 0.0, 1.0) : col;
    col = mix(col, cc, u_mix * clamp(c.a, 0.0, 1.0));
  }
  o = vec4(col * a, a);
}
`;

/** 判子 1 個ぶん、レイヤーを直接書き換える（指先・ぼかし・油彩）。 */
const MIX_FS = `${HEADER}
in vec2 v_local;
in vec2 v_canvas;
flat in vec4 v_a1;
flat in vec4 v_a2;
flat in vec4 v_a0;
flat in float v_as;
uniform sampler2D u_src;
uniform ivec2 u_srcOrigin;
uniform vec2 u_srcSize;
uniform sampler2D u_smudge;
uniform sampler2D u_sel;
uniform int u_hasSel;
uniform int u_kind;
uniform float u_strength;
uniform float u_paint;
uniform float u_blurR;
uniform int u_alphaLock;
uniform float u_dither;
out vec4 o;
${SHAPE_GLSL}
${HASH_GLSL}
vec4 srcAt(vec2 canvasPx) { return texture(u_src, (canvasPx - vec2(u_srcOrigin)) / u_srcSize); }
void main() {
  ivec2 cp = ivec2(gl_FragCoord.xy);
  vec4 S = texelFetch(u_src, cp - u_srcOrigin, 0);
  float m = dabShape(v_local, v_a1.z, v_a1.w) * v_a1.y * v_as;
  m *= grainAt(v_canvas, v_a2.w);
  if (u_hasSel == 1) m *= texelFetch(u_sel, cp, 0).r;
  if (m <= 0.0) { o = S; return; }
  vec4 R;
  if (u_kind == 1) {
    vec4 acc = vec4(0.0);
    float ws = 0.0;
    vec2 c = vec2(cp) + 0.5;
    for (int i = 0; i < 16; i++) {
      float a = float(i) * 2.39996;
      float rr = sqrt((float(i) + 0.5) / 16.0) * u_blurR;
      vec2 q = c + vec2(cos(a), sin(a)) * rr;
      acc += srcAt(q);
      ws += 1.0;
    }
    vec4 B = acc / ws;
    R = mix(S, B, clamp(m * u_strength, 0.0, 1.0));
  } else {
    vec4 C = texture(u_smudge, clamp(v_local * 0.5 + 0.5, 0.0, 1.0));
    if (u_kind == 2) {
      vec4 paint = vec4(v_a2.rgb, 1.0);
      vec4 P = mix(C, paint, u_paint);
      R = mix(S, P, clamp(m, 0.0, 1.0));
    } else {
      R = mix(S, C, clamp(m * u_strength, 0.0, 1.0));
    }
  }
  if (u_alphaLock == 1) {
    vec3 c = R.a > 1e-5 ? R.rgb / R.a : S.rgb / max(S.a, 1e-5);
    R = vec4(clamp(c, 0.0, 1.0) * S.a, S.a);
  }
  if (u_dither > 0.0) {
    float n = (hash12(vec2(cp) + 0.61) - 0.5) / 255.0 * u_dither;
    R = clamp(R + vec4(n), 0.0, 1.0);
    R.rgb = min(R.rgb, vec3(R.a));
  }
  o = R;
}
`;

/** 指先の「運ぶ絵の具」を更新する。u_first なら下の絵をそのまま拾う。 */
const SMUDGE_FS = `${HEADER}
uniform sampler2D u_prev;
uniform sampler2D u_src;
uniform ivec2 u_srcOrigin;
uniform vec2 u_srcSize;
uniform vec4 u_d0;
uniform float u_round;
uniform float u_pickup;
uniform int u_first;
uniform float u_size;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / u_size;
  vec2 l = uv * 2.0 - 1.0;
  float c = cos(u_d0.w), s = sin(u_d0.w);
  vec2 sq = vec2(l.x * u_d0.z, l.y * u_d0.z * u_round);
  vec2 p = u_d0.xy + vec2(c * sq.x - s * sq.y, s * sq.x + c * sq.y);
  vec4 cur = texture(u_src, (p - vec2(u_srcOrigin)) / u_srcSize);
  vec4 prev = texture(u_prev, uv);
  o = u_first == 1 ? cur : mix(prev, cur, u_pickup);
}
`;

/** 混色の「運ぶ色」（1 画素）。判子の下の 9 点の平均を混ぜていく。 */
const CARRY_FS = `${HEADER}
uniform sampler2D u_prev;
uniform sampler2D u_layer;
uniform vec2 u_canvas;
uniform vec3 u_dab;
uniform float u_pickup;
uniform int u_first;
out vec4 o;
void main() {
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 9; i++) {
    float a = float(i) * 0.6981317;
    float rr = i == 0 ? 0.0 : u_dab.z * 0.55;
    vec2 q = u_dab.xy + vec2(cos(a), sin(a)) * rr;
    acc += texture(u_layer, q / u_canvas);
  }
  vec4 cur = acc / 9.0;
  vec4 prev = texelFetch(u_prev, ivec2(0), 0);
  o = u_first == 1 ? cur : mix(prev, cur, u_pickup);
}
`;

export interface StampOptions {
  accumulate: "over" | "max";
  grain: Tex | null;
  grainScale: number;
  grainStrength: number;
}

export interface MixOptions extends StampOptions {
  kind: "smudge" | "blur" | "paint";
  strength: number;
  paint: number;
  pickup: number;
  alphaLock: boolean;
  sel: Tex | null;
}

export interface MergeOptions {
  mode: number;
  erase: boolean;
  alphaLock: boolean;
  maskTarget: boolean;
  opacity: number;
  sel: Tex | null;
  wetEdge: number;
  wetRadius: number;
  grain: Tex | null;
  grainScale: number;
}

/** 判子の外接矩形（キャンバス座標）。楕円でも回転しても半径 r+1.5 の円に収まる。 */
export function dabRect(d: Dab, pad = 2): Rect {
  const e = Math.max(d.r, 0.6) + 1.5 + pad;
  return { x: d.x - e, y: d.y - e, w: 2 * e, h: 2 * e };
}

export class BrushRenderer {
  private g: GL;
  readonly W: number;
  readonly H: number;
  readonly tex: BrushTextures;
  stroke: Tex;
  private vao: WebGLVertexArrayObject;
  private inst: WebGLBuffer;
  private data = new Float32Array(MAX_BATCH * FLOATS_PER_DAB);
  private dabProg: Program;
  private mixProg: Program;
  private smudgeProg: Program;
  private carryProg: Program;
  private mergeProg: Program;
  private blurProg: Program;
  private scratch: Tex | null = null;
  private smudgeA: Tex;
  private smudgeB: Tex;
  private carryA: Tex;
  private carryB: Tex;
  private tempRGBA: Tex | null = null;
  private tempR8: Tex | null = null;
  private wetA: Tex | null = null;
  private wetB: Tex | null = null;
  readonly T: number;
  static readonly SMUDGE = 128;
  static readonly WETPAD = 32;

  constructor(g: GL, tex: BrushTextures, W: number, H: number, tile: number) {
    this.g = g;
    this.W = W;
    this.H = H;
    this.T = tile;
    this.tex = tex;
    const gl = g.gl;
    this.stroke = g.createTex(W, H, g.hiFormat, "stroke", { filter: "nearest" });
    g.clear(this.stroke);
    this.inst = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.quadBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    for (let i = 0; i < 3; i++) {
      gl.enableVertexAttribArray(1 + i);
      gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, FLOATS_PER_DAB * 4, i * 16);
      gl.vertexAttribDivisor(1 + i, 1);
    }
    gl.bindVertexArray(null);
    this.dabProg = g.program("dab", DAB_VS, DAB_FS);
    this.mixProg = g.program("mixdab", DAB_VS, MIX_FS);
    this.smudgeProg = g.program("smudge", RECT_VS, SMUDGE_FS);
    this.carryProg = g.program("carry", RECT_VS, CARRY_FS);
    this.mergeProg = g.program("merge", RECT_VS, MERGE_FS);
    this.blurProg = g.program("blur", RECT_VS, BLUR_FS);
    const S = BrushRenderer.SMUDGE;
    this.smudgeA = g.createTex(S, S, g.hiFormat, "smudgeA");
    this.smudgeB = g.createTex(S, S, g.hiFormat, "smudgeB");
    this.carryA = g.createTex(1, 1, g.hiFormat, "carryA", { filter: "nearest" });
    this.carryB = g.createTex(1, 1, g.hiFormat, "carryB", { filter: "nearest" });
    // 筆先・紙の目はミップマップで縮小時のちらつきを抑える
    for (const t of [tex.tips, ...tex.grains.values()]) {
      g.bindUtil(t);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    }
  }

  dispose(): void {
    const g = this.g;
    for (const t of [this.stroke, this.scratch, this.smudgeA, this.smudgeB, this.carryA, this.carryB, this.tempRGBA, this.tempR8, this.wetA, this.wetB]) g.deleteTex(t);
    g.gl.deleteBuffer(this.inst);
    g.gl.deleteVertexArray(this.vao);
  }

  private pack(dabs: Dab[], start: number, n: number): void {
    const f = this.data;
    for (let i = 0; i < n; i++) {
      const d = dabs[start + i];
      const o = i * FLOATS_PER_DAB;
      f[o] = d.x;
      f[o + 1] = d.y;
      f[o + 2] = d.r;
      f[o + 3] = d.angle;
      f[o + 4] = d.round;
      f[o + 5] = d.alpha;
      f[o + 6] = d.hard;
      f[o + 7] = d.tip;
      f[o + 8] = d.cr;
      f[o + 9] = d.cg;
      f[o + 10] = d.cb;
      f[o + 11] = d.depth;
    }
    const gl = this.g.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, f, 0, n * FLOATS_PER_DAB);
  }

  private bindShape(p: Program, o: StampOptions): void {
    p.t("u_tips", this.tex.tips);
    p.t("u_grain", o.grain ?? this.tex.tips);
    p.i("u_hasGrain", o.grain && o.grainStrength > 0 ? 1 : 0);
    p.f("u_grainScale", o.grainScale);
    p.f("u_grainStrength", o.grainStrength);
  }

  /** 判子を筆跡バッファへまとめて押す。戻り値は汚れた矩形。 */
  stamp(dabs: Dab[], o: StampOptions): Rect | null {
    if (!dabs.length) return null;
    const g = this.g;
    const gl = g.gl;
    g.target(this.stroke);
    g.blend(o.accumulate === "max" ? "max" : "over");
    const p = this.dabProg.use();
    p.f("u_tsize", this.W, this.H).f("u_origin", 0, 0);
    p.i("u_carry", 0);
    p.t("u_carryTex", this.carryA);
    this.bindShape(p, o);
    gl.bindVertexArray(this.vao);
    let dirty: Rect | null = null;
    for (let s = 0; s < dabs.length; s += MAX_BATCH) {
      const n = Math.min(MAX_BATCH, dabs.length - s);
      this.pack(dabs, s, n);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    }
    gl.bindVertexArray(null);
    g.blend("none");
    for (const d of dabs) dirty = rectUnion(dirty, dabRect(d));
    return dirty ? rectClip(dirty, this.W, this.H) : null;
  }

  /** 混色つきの判子（水彩）: 1 個ずつ「運ぶ色」を更新しながら押す。 */
  stampCarry(dabs: Dab[], o: StampOptions, layer: Tex, mix: number, pickup: number, first: boolean): Rect | null {
    if (!dabs.length) return null;
    const g = this.g;
    const gl = g.gl;
    let dirty: Rect | null = null;
    for (let i = 0; i < dabs.length; i++) {
      const d = dabs[i];
      // 運ぶ色の更新（1×1 のピンポン）
      g.target(this.carryB);
      g.blend("none");
      const c = this.carryProg.use();
      c.f("u_rect", 0, 0, 1, 1).f("u_tsize", 1, 1);
      c.t("u_prev", this.carryA).t("u_layer", layer);
      c.f("u_canvas", this.W, this.H).f("u_dab", d.x, d.y, Math.max(1, d.r));
      c.f("u_pickup", pickup).i("u_first", first && i === 0 ? 1 : 0);
      g.drawQuad();
      [this.carryA, this.carryB] = [this.carryB, this.carryA];
      // 判子
      g.target(this.stroke);
      g.blend(o.accumulate === "max" ? "max" : "over");
      const p = this.dabProg.use();
      p.f("u_tsize", this.W, this.H).f("u_origin", 0, 0);
      p.i("u_carry", 1).f("u_mix", mix);
      p.t("u_carryTex", this.carryA);
      this.bindShape(p, o);
      gl.bindVertexArray(this.vao);
      this.pack(dabs, i, 1);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 1);
      gl.bindVertexArray(null);
      g.blend("none");
      dirty = rectUnion(dirty, dabRect(d));
    }
    return dirty ? rectClip(dirty, this.W, this.H) : null;
  }

  private ensureScratch(w: number, h: number): Tex {
    const need = Math.max(w, h);
    if (this.scratch && this.scratch.w >= need) return this.scratch;
    let s = 256;
    while (s < need) s *= 2;
    this.g.deleteTex(this.scratch);
    this.scratch = this.g.createTex(s, s, "rgba8", "mixScratch");
    return this.scratch;
  }

  /**
   * 判子 1 個ぶんレイヤーを直接書き換える。save は書き換える前に呼ばれる（取り消し用）。
   * first は一筆の最初の判子（運ぶ絵の具を拾うだけで塗らない）。
   */
  mixDab(d: Dab, layer: Tex, o: MixOptions, first: boolean, save: (r: Rect) => void): Rect | null {
    const g = this.g;
    const gl = g.gl;
    const blurR = o.kind === "blur" ? Math.max(1.5, d.r * 0.35) : 0;
    const base = dabRect(d, 2 + Math.ceil(blurR));
    const R = rectClip(base, this.W, this.H);
    if (!R) return null;
    const sc = this.ensureScratch(R.w, R.h);
    g.copy(layer, sc, R.x, R.y, R.w, R.h, 0, 0);
    if (!(first && o.kind !== "blur")) {
      const dr = rectClip(dabRect(d), this.W, this.H);
      if (dr) {
        save(dr);
        g.target(layer, dr);
        g.blend("none");
        const p = this.mixProg.use();
        p.f("u_tsize", this.W, this.H).f("u_origin", 0, 0);
        p.t("u_src", sc);
        gl.uniform2i(p.loc("u_srcOrigin"), R.x, R.y);
        p.f("u_srcSize", sc.w, sc.h);
        p.t("u_smudge", this.smudgeA);
        p.t("u_sel", o.sel ?? this.carryA).i("u_hasSel", o.sel ? 1 : 0);
        p.i("u_kind", o.kind === "blur" ? 1 : o.kind === "paint" ? 2 : 0);
        p.f("u_strength", o.strength).f("u_paint", o.paint).f("u_blurR", blurR);
        p.i("u_alphaLock", o.alphaLock ? 1 : 0).f("u_dither", 1);
        this.bindShape(p, o);
        gl.bindVertexArray(this.vao);
        this.pack([d], 0, 1);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 1);
        gl.bindVertexArray(null);
        gl.disable(gl.SCISSOR_TEST);
      }
    }
    if (o.kind !== "blur") {
      // 運ぶ絵の具を、塗る前の下の絵から拾う
      const S = BrushRenderer.SMUDGE;
      g.target(this.smudgeB);
      const s = this.smudgeProg.use();
      s.f("u_rect", 0, 0, S, S).f("u_tsize", S, S);
      s.t("u_prev", this.smudgeA).t("u_src", sc);
      gl.uniform2i(s.loc("u_srcOrigin"), R.x, R.y);
      s.f("u_srcSize", sc.w, sc.h);
      s.f("u_d0", d.x, d.y, Math.max(1, d.r), d.angle).f("u_round", d.round);
      s.f("u_pickup", first ? 1 : o.pickup).i("u_first", first ? 1 : 0).f("u_size", S);
      g.drawQuad();
      [this.smudgeA, this.smudgeB] = [this.smudgeB, this.smudgeA];
    }
    return rectClip(dabRect(d), this.W, this.H);
  }

  clearStroke(rect: Rect | null): void {
    if (!rect) return;
    this.g.clear(this.stroke, 0, 0, 0, 0, rect);
  }

  private ensureTemp(format: "rgba8" | "r8"): Tex {
    if (format === "r8") {
      if (!this.tempR8) this.tempR8 = this.g.createTex(this.T, this.T, "r8", "mergeR8", { filter: "nearest" });
      return this.tempR8;
    }
    if (!this.tempRGBA) this.tempRGBA = this.g.createTex(this.T, this.T, "rgba8", "mergeRGBA", { filter: "nearest" });
    return this.tempRGBA;
  }

  private ensureWet(): [Tex, Tex] {
    const S = this.T + BrushRenderer.WETPAD * 2;
    if (!this.wetA) this.wetA = this.g.createTex(S, S, this.g.hiFormat, "wetA", { filter: "nearest" });
    if (!this.wetB) this.wetB = this.g.createTex(S, S, this.g.hiFormat, "wetB", { filter: "nearest" });
    return [this.wetA, this.wetB];
  }

  /** 筆跡の不透明度をぼかして wetB に入れる（タイル r の周りに WETPAD の余白）。 */
  private wetBlur(r: Rect, radius: number): { tex: Tex; off: [number, number] } {
    const g = this.g;
    const [A, B] = this.ensureWet();
    const P = BrushRenderer.WETPAD;
    const x0 = Math.max(0, r.x - P);
    const y0 = Math.max(0, r.y - P);
    const x1 = Math.min(this.W, r.x + r.w + P);
    const y1 = Math.min(this.H, r.y + r.h + P);
    const w = x1 - x0;
    const h = y1 - y0;
    const rad = Math.max(1, Math.min(P, Math.round(radius)));
    const p = this.blurProg.use();
    // 横
    g.target(A);
    g.blend("none");
    p.f("u_rect", 0, 0, w, h).f("u_tsize", A.w, A.h);
    p.t("u_src", this.stroke);
    g.gl.uniform2i(p.loc("u_off"), x0, y0);
    g.gl.uniform2i(p.loc("u_srcMax"), this.W - 1, this.H - 1);
    g.gl.uniform2i(p.loc("u_dir"), 1, 0);
    p.i("u_radius", rad).f("u_sigma", Math.max(0.8, rad / 2));
    g.drawQuad();
    // 縦
    g.target(B);
    p.f("u_rect", 0, 0, w, h).f("u_tsize", B.w, B.h);
    p.t("u_src", A);
    g.gl.uniform2i(p.loc("u_off"), 0, 0);
    g.gl.uniform2i(p.loc("u_srcMax"), w - 1, h - 1);
    g.gl.uniform2i(p.loc("u_dir"), 0, 1);
    g.drawQuad();
    // B の (0,0) はキャンバスの (x0,y0)。merge で読むときのずれ = r.xy - (x0,y0)
    return { tex: B, off: [r.x - x0, r.y - y0] };
  }

  private bindMerge(o: MergeOptions, layer: Tex, origin: [number, number], wet: { tex: Tex; off: [number, number] } | null, dither: number): Program {
    const gl = this.g.gl;
    const p = this.mergeProg.use();
    p.t("u_layer", layer).t("u_stroke", this.stroke);
    p.t("u_sel", o.sel ?? this.stroke).i("u_hasSel", o.sel ? 1 : 0);
    p.t("u_wet", wet ? wet.tex : this.stroke).i("u_hasWet", wet ? 1 : 0);
    gl.uniform2i(p.loc("u_wetOff"), wet ? wet.off[0] : 0, wet ? wet.off[1] : 0);
    p.f("u_wetEdge", o.wetEdge);
    p.t("u_grain", o.grain ?? this.tex.tips).f("u_grainScale", o.grainScale);
    gl.uniform2i(p.loc("u_origin"), origin[0], origin[1]);
    p.i("u_mode", o.mode).i("u_erase", o.erase ? 1 : 0).i("u_alphaLock", o.alphaLock ? 1 : 0);
    p.i("u_maskTarget", o.maskTarget ? 1 : 0).f("u_opacity", o.opacity).f("u_dither", dither);
    return p;
  }

  /** 表示用: rect（キャンバス座標）の「レイヤー＋筆跡」を dst（タイル）の (0,0) から描く。 */
  preview(dst: Tex, rect: Rect, layer: Tex, o: MergeOptions): void {
    const g = this.g;
    g.target(dst);
    g.blend("none");
    const p = this.bindMerge({ ...o, wetEdge: 0 }, layer, [rect.x, rect.y], null, 0);
    p.f("u_rect", 0, 0, rect.w, rect.h).f("u_tsize", dst.w, dst.h);
    g.drawQuad();
  }

  /** 確定: 筆跡をレイヤーへ書き込む（rect をタイルに分けて）。 */
  commit(rect: Rect, layer: Tex, o: MergeOptions): void {
    const g = this.g;
    const T = this.T;
    const temp = this.ensureTemp(layer.format === "r8" ? "r8" : "rgba8");
    for (let y = rect.y; y < rect.y + rect.h; y += T) {
      for (let x = rect.x; x < rect.x + rect.w; x += T) {
        const r: Rect = { x, y, w: Math.min(T, rect.x + rect.w - x), h: Math.min(T, rect.y + rect.h - y) };
        const wet = o.wetEdge > 0 && !o.erase && !o.maskTarget ? this.wetBlur(r, o.wetRadius) : null;
        g.target(temp);
        g.blend("none");
        const p = this.bindMerge(o, layer, [r.x, r.y], wet, 1);
        p.f("u_rect", 0, 0, r.w, r.h).f("u_tsize", temp.w, temp.h);
        g.drawQuad();
        g.copy(temp, layer, 0, 0, r.w, r.h, r.x, r.y);
      }
    }
  }
}
