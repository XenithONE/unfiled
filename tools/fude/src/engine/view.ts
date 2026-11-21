// 表示の変換（拡大・移動・回転・左右反転）と、画面への描画。
import type { GL, Program, Tex } from "./gl";
import { DISPLAY_FS, DISPLAY_VS } from "./shaders";

export class View {
  /** 画面の中央に来るキャンバス座標 */
  cx = 0;
  cy = 0;
  zoom = 1;
  rot = 0;
  flip = false;
  /** 画面（CSS 画素） */
  sw = 1;
  sh = 1;
  dpr = 1;
  cw = 1;
  ch = 1;
  onChange: (() => void) | null = null;
  /** 全体表示のまま（利用者が動かしていない）なら、画面の大きさが変わったとき合わせ直す */
  fitted = true;

  setCanvas(w: number, h: number): void {
    this.cw = w;
    this.ch = h;
  }

  toCanvas(sx: number, sy: number): [number, number] {
    const f = this.flip ? -1 : 1;
    const dx = (sx - this.sw / 2) / this.zoom;
    const dy = (sy - this.sh / 2) / this.zoom;
    const c = Math.cos(this.rot);
    const s = Math.sin(this.rot);
    // p = c + F R(-rot) (s - C)/zoom
    const rx = c * dx + s * dy;
    const ry = -s * dx + c * dy;
    return [this.cx + f * rx, this.cy + ry];
  }

  toScreen(x: number, y: number): [number, number] {
    const f = this.flip ? -1 : 1;
    const dx = f * (x - this.cx) * this.zoom;
    const dy = (y - this.cy) * this.zoom;
    const c = Math.cos(this.rot);
    const s = Math.sin(this.rot);
    return [this.sw / 2 + c * dx - s * dy, this.sh / 2 + s * dx + c * dy];
  }

  /** 画面（デバイス画素・y 下向き）→ キャンバスの列優先 3×3。 */
  inverseDevice(): Float32Array {
    const f = this.flip ? -1 : 1;
    const k = 1 / (this.zoom * this.dpr);
    const c = Math.cos(this.rot);
    const s = Math.sin(this.rot);
    const a00 = f * c * k;
    const a01 = f * s * k;
    const a10 = -s * k;
    const a11 = c * k;
    const Cx = this.sw / 2;
    const Cy = this.sh / 2;
    const b0 = this.cx - (f * (c * Cx + s * Cy)) / this.zoom;
    const b1 = this.cy - (-s * Cx + c * Cy) / this.zoom;
    return new Float32Array([a00, a10, 0, a01, a11, 0, b0, b1, 1]);
  }

  fit(margin = 40): void {
    const c = Math.abs(Math.cos(this.rot));
    const s = Math.abs(Math.sin(this.rot));
    const bw = this.cw * c + this.ch * s;
    const bh = this.cw * s + this.ch * c;
    this.zoom = Math.max(0.01, Math.min((this.sw - margin * 2) / bw, (this.sh - margin * 2) / bh));
    this.cx = this.cw / 2;
    this.cy = this.ch / 2;
    this.fitted = true;
    this.onChange?.();
  }

  actual(): void {
    this.fitted = false;
    this.zoom = 1;
    this.onChange?.();
  }

  /** 画面の点 (sx,sy) を固定したまま拡大率を変える。 */
  zoomAt(z: number, sx: number, sy: number): void {
    this.fitted = false;
    const nz = Math.max(0.01, Math.min(64, z));
    const [px, py] = this.toCanvas(sx, sy);
    this.zoom = nz;
    const [qx, qy] = this.toCanvas(sx, sy);
    this.cx += px - qx;
    this.cy += py - qy;
    this.onChange?.();
  }

  panBy(dsx: number, dsy: number): void {
    this.fitted = false;
    const [ax, ay] = this.toCanvas(this.sw / 2, this.sh / 2);
    const [bx, by] = this.toCanvas(this.sw / 2 - dsx, this.sh / 2 - dsy);
    this.cx += bx - ax;
    this.cy += by - ay;
    this.onChange?.();
  }

  rotateAt(rad: number, sx: number, sy: number): void {
    this.fitted = false;
    const [px, py] = this.toCanvas(sx, sy);
    this.rot = rad;
    const [qx, qy] = this.toCanvas(sx, sy);
    this.cx += px - qx;
    this.cy += py - qy;
    this.onChange?.();
  }

  setFlip(flip: boolean): void {
    this.fitted = false;
    const [px, py] = this.toCanvas(this.sw / 2, this.sh / 2);
    this.flip = flip;
    this.cx = px;
    this.cy = py;
    this.onChange?.();
  }
}

export class Display {
  private g: GL;
  private prog: Program;
  private mipFor: Tex | null = null;
  constructor(g: GL) {
    this.g = g;
    this.prog = g.program("display", DISPLAY_VS, DISPLAY_FS);
  }

  draw(view: View, comp: Tex, sel: Tex | null, mipsDirty: boolean, time: number, bg: [number, number, number]): void {
    const g = this.g;
    const gl = g.gl;
    const dw = Math.round(view.sw * view.dpr);
    const dh = Math.round(view.sh * view.dpr);
    // 縮小表示ではミップマップでちらつきを抑える
    g.bindUtil(comp);
    if (view.zoom < 0.99) {
      if (mipsDirty || this.mipFor !== comp) {
        gl.generateMipmap(gl.TEXTURE_2D);
        this.mipFor = comp;
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      if (mipsDirty) this.mipFor = null;
    }
    g.target(null, undefined, { w: dw, h: dh });
    g.blend("none");
    const p = this.prog.use();
    p.t("u_comp", comp);
    p.t("u_sel", sel ?? comp).i("u_hasSel", sel ? 1 : 0);
    p.m3("u_inv", view.inverseDevice());
    p.f("u_screen", dw, dh).f("u_canvas", view.cw, view.ch);
    p.f("u_zoom", view.zoom * view.dpr).f("u_time", time).f("u_bg", ...bg);
    p.i("u_smoothPix", view.zoom >= 2 ? 1 : 0);
    g.drawQuad();
  }
}
