// WebGL2 の下回り。テクスチャ・FBO・プログラム・全画面の四角形。
// 座標の約束: テクスチャの 0 行目＝キャンバスの最上段（DESIGN.md）。

export type TexFormat = "rgba8" | "rgba16f" | "r8";

export interface Tex {
  tex: WebGLTexture;
  w: number;
  h: number;
  format: TexFormat;
  fbo: WebGLFramebuffer | null;
  bytes: number;
  label: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const BYTES: Record<TexFormat, number> = { rgba8: 4, rgba16f: 8, r8: 1 };
/** テクスチャの作成・転送・写しに使う専用のユニット（描画用の結び付けを壊さない）。 */
export const UTIL_UNIT = 15;

export class Program {
  readonly p: WebGLProgram;
  private locs = new Map<string, WebGLUniformLocation | null>();
  private units = new Map<string, number>();
  private gl: WebGL2RenderingContext;
  constructor(gl: WebGL2RenderingContext, p: WebGLProgram) {
    this.gl = gl;
    this.p = p;
  }
  use(): this {
    this.gl.useProgram(this.p);
    return this;
  }
  loc(name: string): WebGLUniformLocation | null {
    let l = this.locs.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.p, name);
      this.locs.set(name, l);
    }
    return l;
  }
  f(name: string, ...v: number[]): this {
    const l = this.loc(name);
    if (!l) return this;
    const gl = this.gl;
    if (v.length === 1) gl.uniform1f(l, v[0]);
    else if (v.length === 2) gl.uniform2f(l, v[0], v[1]);
    else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]);
    else gl.uniform4f(l, v[0], v[1], v[2], v[3]);
    return this;
  }
  i(name: string, v: number): this {
    const l = this.loc(name);
    if (l) this.gl.uniform1i(l, v);
    return this;
  }
  m3(name: string, m: Float32Array | number[]): this {
    const l = this.loc(name);
    if (l) this.gl.uniformMatrix3fv(l, false, m);
    return this;
  }
  fv(name: string, v: Float32Array): this {
    const l = this.loc(name);
    if (l) this.gl.uniform4fv(l, v);
    return this;
  }
  /** サンプラーにテクスチャを結ぶ。ユニットは名前ごとに固定で振る。 */
  t(name: string, tex: Tex | WebGLTexture | null): this {
    let u = this.units.get(name);
    if (u === undefined) {
      u = this.units.size;
      this.units.set(name, u);
    }
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + u);
    const t = tex === null ? null : "tex" in (tex as Tex) ? (tex as Tex).tex : (tex as WebGLTexture);
    gl.bindTexture(gl.TEXTURE_2D, t);
    const l = this.loc(name);
    if (l) gl.uniform1i(l, u);
    return this;
  }
}

export class GL {
  readonly gl: WebGL2RenderingContext;
  readonly canFloat: boolean;
  readonly maxTex: number;
  readonly hiFormat: TexFormat;
  private quadVao: WebGLVertexArrayObject;
  private quadBuf: WebGLBuffer;
  private progs = new Map<string, Program>();
  private readFbo: WebGLFramebuffer;
  private live = new Set<Tex>();
  bytes = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.canFloat = !!gl.getExtension("EXT_color_buffer_float");
    gl.getExtension("OES_texture_float_linear");
    this.hiFormat = this.canFloat ? "rgba16f" : "rgba8";
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    // 単位正方形（0..1）。三角形ストリップ。
    this.quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    this.quadVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.quadVao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.readFbo = gl.createFramebuffer()!;
  }

  get quadBuffer(): WebGLBuffer {
    return this.quadBuf;
  }

  createTex(w: number, h: number, format: TexFormat, label: string, opts?: { filter?: "linear" | "nearest"; wrap?: "clamp" | "repeat"; data?: ArrayBufferView | null }): Tex {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0 + UTIL_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const filter = opts?.filter === "nearest" ? gl.NEAREST : gl.LINEAR;
    const wrap = opts?.wrap === "repeat" ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    const data = opts?.data ?? null;
    if (format === "rgba8") gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    else if (format === "r8") gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, data);
    const t: Tex = { tex, w, h, format, fbo: null, bytes: w * h * BYTES[format], label };
    this.bytes += t.bytes;
    this.live.add(t);
    return t;
  }

  /** 画像（ImageBitmap / Canvas）を RGBA8 のテクスチャへ（乗算済みにして）上げる。 */
  texFromImage(src: TexImageSource, w: number, h: number, label: string): Tex {
    const gl = this.gl;
    const t = this.createTex(w, h, "rgba8", label);
    gl.activeTexture(gl.TEXTURE0 + UTIL_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    return t;
  }

  upload(t: Tex, data: ArrayBufferView, x = 0, y = 0, w = t.w, h = t.h): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + UTIL_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    if (t.format === "r8") gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RED, gl.UNSIGNED_BYTE, data);
    else if (t.format === "rgba8") gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
    else gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RGBA, gl.HALF_FLOAT, data);
  }

  /** 描画用の結び付けを壊さずに、テクスチャを操作用に結ぶ。 */
  bindUtil(t: Tex | WebGLTexture): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + UTIL_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, "tex" in (t as Tex) ? (t as Tex).tex : (t as WebGLTexture));
  }

  deleteTex(t: Tex | null | undefined): void {
    if (!t || !this.live.has(t)) return;
    const gl = this.gl;
    if (t.fbo) gl.deleteFramebuffer(t.fbo);
    gl.deleteTexture(t.tex);
    this.bytes -= t.bytes;
    this.live.delete(t);
  }

  fbo(t: Tex): WebGLFramebuffer {
    if (t.fbo) return t.fbo;
    const gl = this.gl;
    const f = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`FBO incomplete (${t.label}, ${t.format}): ${st}`);
    t.fbo = f;
    return f;
  }

  /** 描画先を決める。rect を渡すとビューポートとシザーをその範囲に。 */
  target(t: Tex | null, rect?: Rect, screen?: { w: number; h: number }): void {
    const gl = this.gl;
    if (t) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo(t));
      gl.viewport(0, 0, t.w, t.h);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (screen) gl.viewport(0, 0, screen.w, screen.h);
    }
    if (rect) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(rect.x, rect.y, rect.w, rect.h);
    } else gl.disable(gl.SCISSOR_TEST);
  }

  clear(t: Tex, r = 0, g = 0, b = 0, a = 0, rect?: Rect): void {
    const gl = this.gl;
    this.target(t, rect);
    gl.clearColor(r, g, b, a);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.SCISSOR_TEST);
  }

  /** src の (sx,sy,w,h) を dst の (dx,dy) へ写す。形式は同じか dst が src の成分の部分集合であること。 */
  copy(src: Tex, dst: Tex, sx: number, sy: number, w: number, h: number, dx: number, dy: number): void {
    if (w <= 0 || h <= 0) return;
    const gl = this.gl;
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.readFbo);
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, src.tex, 0);
    gl.activeTexture(gl.TEXTURE0 + UTIL_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, dst.tex);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, dx, dy, sx, sy, w, h);
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  }

  /** RGBA8 / R8 のテクスチャを読む（R8 は 1 画素 1 バイト）。 */
  read(t: Tex, x = 0, y = 0, w = t.w, h = t.h): Uint8Array {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo(t));
    if (t.format === "r8") {
      // R8 の読み出しは RGBA でしか保証されない
      const tmp = new Uint8Array(w * h * 4);
      gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, tmp);
      const out = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) out[i] = tmp[i * 4];
      return out;
    }
    if (t.format === "rgba16f") throw new Error("read: rgba16f は直接読まない");
    const out = new Uint8Array(w * h * 4);
    gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return out;
  }

  program(key: string, vs: string, fs: string): Program {
    const got = this.progs.get(key);
    if (got) return got;
    const gl = this.gl;
    const mk = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        const lines = src.split("\n").map((l, i) => `${i + 1}: ${l}`).join("\n");
        throw new Error(`shader ${key}: ${log}\n${lines}`);
      }
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, "a_pos");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`link ${key}: ${gl.getProgramInfoLog(p)}`);
    const prog = new Program(gl, p);
    this.progs.set(key, prog);
    return prog;
  }

  /** 単位正方形を描く（a_pos = 0..1）。 */
  drawQuad(): void {
    const gl = this.gl;
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  blend(mode: "none" | "over" | "max" | "add" | "erase"): void {
    const gl = this.gl;
    if (mode === "none") {
      gl.disable(gl.BLEND);
      return;
    }
    gl.enable(gl.BLEND);
    if (mode === "over") {
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } else if (mode === "max") {
      gl.blendEquation(gl.MAX);
      gl.blendFunc(gl.ONE, gl.ONE);
    } else if (mode === "add") {
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE);
    } else {
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
    }
  }

  liveCount(): number {
    return this.live.size;
  }
}

// ---- 矩形の小道具 ----
export function rectUnion(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w);
  const y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function rectClip(r: Rect, w: number, h: number): Rect | null {
  const x0 = Math.max(0, Math.floor(r.x));
  const y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(w, Math.ceil(r.x + r.w));
  const y1 = Math.min(h, Math.ceil(r.y + r.h));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function rectIntersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function rectPad(r: Rect, p: number): Rect {
  return { x: r.x - p, y: r.y - p, w: r.w + 2 * p, h: r.h + 2 * p };
}
