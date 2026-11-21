// 選択範囲・自動選択・塗りつぶし・グラデーション・図形の道具。
import { smoothPolyline } from "../ai/svgpath";
import type { Layer } from "../engine/doc";
import type { Rect } from "../engine/gl";
import { bucketFill, paintGradient, paintPolys, type GradStop } from "../engine/paintOps";
import { ellipsePoly, rectPoly, type Poly } from "../engine/raster";
import { deselect, magicWand, selectPolys, type SelMode } from "../engine/selection";
import { strokeNow } from "../engine/strokePath";
import type { Studio } from "../engine/studio";
import type { Ptr, Tool } from "./types";

function modeFrom(s: Studio, e: Ptr): SelMode {
  if (e.shift && e.alt) return "intersect";
  if (e.shift) return "add";
  if (e.alt) return "subtract";
  return s.ui.select.mode;
}

/** 画面座標で点線を描く（動く点線）。 */
function ants(ctx: CanvasRenderingContext2D, s: Studio, pts: [number, number][], closed: boolean): void {
  if (pts.length < 2) return;
  ctx.beginPath();
  pts.forEach(([x, y], i) => {
    const [sx, sy] = s.view.toScreen(x, y);
    if (i) ctx.lineTo(sx, sy);
    else ctx.moveTo(sx, sy);
  });
  if (closed) ctx.closePath();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#000";
  ctx.setLineDash([]);
  ctx.stroke();
  ctx.strokeStyle = "#fff";
  ctx.setLineDash([5, 5]);
  ctx.lineDashOffset = -((s.time * 24) % 10);
  ctx.stroke();
  ctx.setLineDash([]);
}

function boxFrom(a: [number, number], b: [number, number], square: boolean, center: boolean): Rect {
  let w = b[0] - a[0];
  let h = b[1] - a[1];
  if (square) {
    const m = Math.max(Math.abs(w), Math.abs(h));
    w = Math.sign(w || 1) * m;
    h = Math.sign(h || 1) * m;
  }
  if (center) return { x: a[0] - Math.abs(w), y: a[1] - Math.abs(h), w: Math.abs(w) * 2, h: Math.abs(h) * 2 };
  return { x: Math.min(a[0], a[0] + w), y: Math.min(a[1], a[1] + h), w: Math.abs(w), h: Math.abs(h) };
}

export class SelectTool implements Tool {
  readonly id = "select";
  cursor = "crosshair";
  private a: [number, number] | null = null;
  private b: [number, number] | null = null;
  private pts: [number, number][] = [];
  private mode: SelMode = "replace";
  private poly = false;
  private square = false;
  private center = false;
  constructor(private s: Studio) {}
  private shape() {
    return this.s.ui.select.shape;
  }
  down(e: Ptr): void {
    const sh = this.shape();
    if (sh === "polygon") {
      if (!this.poly) {
        this.poly = true;
        this.mode = modeFrom(this.s, e);
        this.pts = [[e.x, e.y]];
      }
      const f = this.pts[0];
      const [fx, fy] = this.s.view.toScreen(f[0], f[1]);
      if (this.pts.length > 2 && Math.hypot(fx - e.sx, fy - e.sy) < 10) {
        this.finishPoly();
        return;
      }
      this.pts.push([e.x, e.y]);
      this.s.requestFrame();
      return;
    }
    this.mode = modeFrom(this.s, e);
    this.a = [e.x, e.y];
    this.b = [e.x, e.y];
    this.pts = [[e.x, e.y]];
  }
  move(e: Ptr): void {
    if (this.poly) return;
    if (!this.a) return;
    this.b = [e.x, e.y];
    this.square = e.shift && this.mode === "replace";
    this.center = e.alt && this.mode === "replace";
    if (this.shape() === "lasso") this.pts.push([e.x, e.y]);
    this.s.requestFrame();
  }
  hover(e: Ptr): void {
    if (this.poly && this.pts.length) {
      this.pts[this.pts.length - 1] = [e.x, e.y];
      this.s.requestFrame();
    }
  }
  up(e: Ptr): void {
    if (this.poly || !this.a) return;
    const a = this.a;
    const b: [number, number] = [e.x, e.y];
    this.a = null;
    const tiny = Math.hypot(b[0] - a[0], b[1] - a[1]) * this.s.view.zoom < 3;
    if (tiny && this.shape() !== "lasso") {
      if (this.mode === "replace") deselect(this.s);
      return;
    }
    let poly: Poly;
    const sh = this.shape();
    if (sh === "lasso") {
      if (this.pts.length < 3) {
        if (this.mode === "replace") deselect(this.s);
        return;
      }
      poly = this.pts;
    } else {
      const r = boxFrom(a, b, this.square, this.center);
      poly = sh === "ellipse" ? ellipsePoly(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2) : rectPoly(r.x, r.y, r.w, r.h);
    }
    selectPolys(this.s, [poly], this.mode, this.s.ui.select.feather);
    this.pts = [];
  }
  private finishPoly(): void {
    const pts = this.pts.slice(0, -1);
    this.poly = false;
    this.pts = [];
    if (pts.length >= 3) selectPolys(this.s, [pts], this.mode, this.s.ui.select.feather);
    this.s.requestFrame();
  }
  key(name: string): boolean {
    if (!this.poly) return false;
    if (name === "enter") {
      this.finishPoly();
      return true;
    }
    if (name === "escape") {
      this.poly = false;
      this.pts = [];
      this.s.requestFrame();
      return true;
    }
    return false;
  }
  cancel(): void {
    this.a = null;
    this.poly = false;
    this.pts = [];
  }
  deactivate(): void {
    this.cancel();
  }
  overlay(ctx: CanvasRenderingContext2D): void {
    const sh = this.shape();
    if (this.poly) {
      ants(ctx, this.s, this.pts, false);
      return;
    }
    if (!this.a || !this.b) return;
    if (sh === "lasso") {
      ants(ctx, this.s, this.pts, true);
      return;
    }
    const r = boxFrom(this.a, this.b, this.square, this.center);
    const poly = sh === "ellipse" ? ellipsePoly(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2) : rectPoly(r.x, r.y, r.w, r.h);
    ants(ctx, this.s, poly, true);
  }
}

export class WandTool implements Tool {
  readonly id = "wand";
  cursor = "crosshair";
  constructor(private s: Studio) {}
  down(e: Ptr): void {
    if (!magicWand(this.s, e.x, e.y, modeFrom(this.s, e))) this.s.toast("その場所では選べませんでした", "warn");
  }
  move(): void {}
  up(): void {}
  cancel(): void {}
}

export class FillTool implements Tool {
  readonly id = "fill";
  cursor = "crosshair";
  constructor(private s: Studio) {}
  down(e: Ptr): void {
    const s = this.s;
    s.hist.begin("塗りつぶし");
    let ok = false;
    try {
      ok = bucketFill(s, e.x, e.y, s.colors.main);
    } finally {
      s.hist.end();
    }
    if (ok) {
      s.pushColorHistory(s.colors.main);
      s.emit("pixels");
    } else s.toast("塗れる場所がありません（キャンバスの外か、もう同じ色です）", "warn");
    s.requestFrame();
  }
  move(): void {}
  up(): void {}
  cancel(): void {}
}

export function gradientStops(s: Studio): GradStop[] {
  const g = s.ui.gradient.stops;
  const m = s.colors.main;
  const b = s.colors.sub;
  if (g === "main-sub") return [{ color: m, alpha: 1, pos: 0 }, { color: b, alpha: 1, pos: 1 }];
  if (g === "sub-main") return [{ color: b, alpha: 1, pos: 0 }, { color: m, alpha: 1, pos: 1 }];
  if (g === "rainbow")
    return ["#ff3b3b", "#ffa53b", "#fff03b", "#4be35a", "#3bb6ff", "#5b4bff", "#c84bff"].map((c, i) => ({ color: c, alpha: 1, pos: i / 6 }));
  return [{ color: m, alpha: 1, pos: 0 }, { color: m, alpha: 0, pos: 1 }];
}

export class GradientTool implements Tool {
  readonly id = "gradient";
  cursor = "crosshair";
  private a: [number, number] | null = null;
  private b: [number, number] | null = null;
  constructor(private s: Studio) {}
  down(e: Ptr): void {
    this.a = [e.x, e.y];
    this.b = [e.x, e.y];
  }
  move(e: Ptr): void {
    if (!this.a) return;
    let b: [number, number] = [e.x, e.y];
    if (e.shift) {
      const dx = b[0] - this.a[0];
      const dy = b[1] - this.a[1];
      const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      const L = Math.hypot(dx, dy);
      b = [this.a[0] + Math.cos(ang) * L, this.a[1] + Math.sin(ang) * L];
    }
    this.b = b;
    this.s.requestFrame();
  }
  up(): void {
    const s = this.s;
    const a = this.a;
    const b = this.b;
    this.a = null;
    this.b = null;
    if (!a || !b || Math.hypot(b[0] - a[0], b[1] - a[1]) < 1) return;
    const l = s.paintableLayer();
    if (!l) return;
    s.hist.begin("グラデーション");
    try {
      paintGradient(s, l, a, b, gradientStops(s), s.ui.gradient.kind, { opacity: s.ui.gradient.opacity, erase: s.colors.transparent });
    } finally {
      s.hist.end();
    }
    s.emit("pixels");
    s.requestFrame();
  }
  cancel(): void {
    this.a = null;
  }
  overlay(ctx: CanvasRenderingContext2D): void {
    if (!this.a || !this.b) return;
    const [ax, ay] = this.s.view.toScreen(...this.a);
    const [bx, by] = this.s.view.toScreen(...this.b);
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    for (const [x, y] of [
      [ax, ay],
      [bx, by],
    ]) {
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#fa512c";
      ctx.fill();
      ctx.stroke();
    }
    if (this.s.ui.gradient.kind === "radial") {
      ctx.beginPath();
      ctx.arc(ax, ay, Math.hypot(bx - ax, by - ay), 0, Math.PI * 2);
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

/** 図形: 直線・長方形・楕円・多角形・曲線。線は「ペン」の筆、塗りは描画色。 */
export class ShapeTool implements Tool {
  readonly id = "shape";
  cursor = "crosshair";
  private a: [number, number] | null = null;
  private b: [number, number] | null = null;
  private pts: [number, number][] = [];
  private multi = false;
  private square = false;
  private center = false;
  constructor(private s: Studio) {}
  private kind() {
    return this.s.ui.shape.kind;
  }
  down(e: Ptr): void {
    const k = this.kind();
    if (k === "polygon" || k === "curve") {
      if (!this.multi) {
        this.multi = true;
        this.pts = [[e.x, e.y]];
      }
      const f = this.pts[0];
      const [fx, fy] = this.s.view.toScreen(f[0], f[1]);
      if (this.pts.length > 2 && Math.hypot(fx - e.sx, fy - e.sy) < 10) {
        this.finishMulti(true);
        return;
      }
      this.pts.push([e.x, e.y]);
      this.s.requestFrame();
      return;
    }
    this.a = [e.x, e.y];
    this.b = [e.x, e.y];
  }
  move(e: Ptr): void {
    if (!this.a) return;
    let b: [number, number] = [e.x, e.y];
    if (this.kind() === "line" && e.shift) {
      const dx = b[0] - this.a[0];
      const dy = b[1] - this.a[1];
      const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      const L = Math.hypot(dx, dy);
      b = [this.a[0] + Math.cos(ang) * L, this.a[1] + Math.sin(ang) * L];
    }
    this.b = b;
    this.square = e.shift;
    this.center = e.alt;
    this.s.requestFrame();
  }
  hover(e: Ptr): void {
    if (this.multi && this.pts.length) {
      this.pts[this.pts.length - 1] = [e.x, e.y];
      this.s.requestFrame();
    }
  }
  private outline(): { pts: [number, number][]; closed: boolean } | null {
    const k = this.kind();
    if (k === "polygon" || k === "curve") {
      const p = this.pts;
      return { pts: k === "curve" ? (smoothPolyline(p) as [number, number][]) : p, closed: false };
    }
    if (!this.a || !this.b) return null;
    if (k === "line") return { pts: [this.a, this.b], closed: false };
    const r = boxFrom(this.a, this.b, this.square, this.center);
    const poly = k === "ellipse" ? ellipsePoly(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2) : rectPoly(r.x, r.y, r.w, r.h);
    return { pts: poly, closed: true };
  }
  private apply(pts: [number, number][], closed: boolean): void {
    const s = this.s;
    const l: Layer | null = s.paintableLayer();
    if (!l || pts.length < 2) return;
    const ui = s.ui.shape;
    s.hist.begin("図形");
    try {
      if (ui.fill && closed) paintPolys(s, l, [pts], s.colors.main, { erase: s.colors.transparent });
      if (ui.stroke || !closed) {
        const line = closed ? [...pts, pts[0]] : pts;
        strokeNow(s, line, { brush: { ...s.brushFor("pen"), taperIn: closed ? 0 : s.brushFor("pen").taperIn, taperOut: closed ? 0 : s.brushFor("pen").taperOut }, color: s.colors.main, keepStep: true, erase: s.colors.transparent });
      }
    } finally {
      s.hist.end();
    }
    s.emit("pixels");
    s.requestFrame();
  }
  up(e: Ptr): void {
    if (this.multi || !this.a) return;
    this.move(e);
    const o = this.outline();
    this.a = null;
    this.b = null;
    if (o && o.pts.length >= 2) {
      const [x0, y0] = o.pts[0];
      const [x1, y1] = o.pts[o.pts.length > 2 ? 2 : 1];
      if (Math.hypot(x1 - x0, y1 - y0) * this.s.view.zoom >= 2) this.apply(o.pts, o.closed);
    }
  }
  private finishMulti(close: boolean): void {
    const k = this.kind();
    let pts = this.pts.slice(0, -1);
    this.multi = false;
    this.pts = [];
    if (pts.length < 2) return;
    if (k === "curve") pts = smoothPolyline(pts) as [number, number][];
    this.apply(pts, close && k === "polygon");
  }
  key(name: string): boolean {
    if (!this.multi) return false;
    if (name === "enter") {
      this.finishMulti(this.kind() === "polygon");
      return true;
    }
    if (name === "escape") {
      this.multi = false;
      this.pts = [];
      this.s.requestFrame();
      return true;
    }
    return false;
  }
  cancel(): void {
    this.a = null;
    this.multi = false;
    this.pts = [];
  }
  deactivate(): void {
    this.cancel();
  }
  overlay(ctx: CanvasRenderingContext2D): void {
    const o = this.outline();
    if (!o) return;
    const s = this.s;
    ctx.beginPath();
    o.pts.forEach(([x, y], i) => {
      const [sx, sy] = s.view.toScreen(x, y);
      if (i) ctx.lineTo(sx, sy);
      else ctx.moveTo(sx, sy);
    });
    if (o.closed) ctx.closePath();
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = s.colors.main;
    ctx.lineWidth = Math.max(1, s.brushFor("pen").size * s.view.zoom);
    ctx.globalAlpha = 0.85;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
