// 移動の道具と、変形（Ctrl+T）の道具。
import type { Studio } from "../engine/studio";
import { FloatTransform, type P2, type Quad } from "../engine/transform";
import type { Ptr, Tool } from "./types";

export class MoveTool implements Tool {
  readonly id = "move";
  cursor = "move";
  private ft: FloatTransform | null = null;
  private start: { x: number; y: number } | null = null;
  constructor(private s: Studio) {}
  down(e: Ptr): void {
    this.ft = FloatTransform.begin(this.s);
    this.start = { x: e.x, y: e.y };
  }
  move(e: Ptr): void {
    if (!this.ft || !this.start) return;
    let dx = Math.round(e.x - this.start.x);
    let dy = Math.round(e.y - this.start.y);
    if (e.shift) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    const src = this.ft.src;
    this.ft.setQuad([
      [src.x + dx, src.y + dy],
      [src.x + src.w + dx, src.y + dy],
      [src.x + src.w + dx, src.y + src.h + dy],
      [src.x + dx, src.y + src.h + dy],
    ]);
  }
  up(e: Ptr): void {
    if (!this.ft) return;
    this.move(e);
    const moved = this.ft.quad[0][0] !== this.ft.src.x || this.ft.quad[0][1] !== this.ft.src.y;
    if (moved) this.ft.commit("移動");
    else this.ft.cancel();
    this.ft = null;
  }
  cancel(): void {
    this.ft?.cancel();
    this.ft = null;
  }
  key(name: string): boolean {
    const step = name.startsWith("shift+") ? 10 : 1;
    const k = name.replace("shift+", "");
    const d: Record<string, [number, number]> = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] };
    if (!d[k]) return false;
    const ft = FloatTransform.begin(this.s);
    if (!ft) return true;
    ft.translate(d[k][0], d[k][1]);
    ft.commit("移動");
    return true;
  }
}

type Drag = { kind: "move" | "corner" | "edge" | "rotate" | "free"; idx: number; start: P2; quad: Quad; angle0: number };

/** 変形: 四隅で拡大縮小（Shift で縦横比を保つ）、辺で片方向、外側で回転、Ctrl+四隅で自由変形。 */
export class TransformTool implements Tool {
  readonly id = "transform";
  cursor = "default";
  ft: FloatTransform | null = null;
  private drag: Drag | null = null;
  private prevTool: string | null = null;
  constructor(private s: Studio) {}

  /** 変形を始める（メニュー・Ctrl+T）。 */
  start(): boolean {
    if (this.ft) return true;
    const ft = FloatTransform.begin(this.s);
    if (!ft) return false;
    this.ft = ft;
    this.prevTool = this.s.tool;
    this.s.emit("ui");
    return true;
  }

  private center(q: Quad): P2 {
    return [(q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4];
  }

  private scr(p: P2): P2 {
    return this.s.view.toScreen(p[0], p[1]);
  }

  private hit(e: Ptr): Drag | null {
    const ft = this.ft;
    if (!ft) return null;
    const q = ft.quad;
    const sp = q.map((p) => this.scr(p));
    const near = (a: P2) => Math.hypot(a[0] - e.sx, a[1] - e.sy) < 10;
    for (let i = 0; i < 4; i++) if (near(sp[i])) return { kind: e.ctrl ? "free" : "corner", idx: i, start: [e.x, e.y], quad: q.map((p) => [...p]) as Quad, angle0: 0 };
    for (let i = 0; i < 4; i++) {
      const a = sp[i];
      const b = sp[(i + 1) % 4];
      if (near([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])) return { kind: "edge", idx: i, start: [e.x, e.y], quad: q.map((p) => [...p]) as Quad, angle0: 0 };
    }
    // 内側なら移動、外側なら回転
    let inside = false;
    for (let i = 0, j = 3; i < 4; j = i++) {
      const [xi, yi] = sp[i];
      const [xj, yj] = sp[j];
      if (yi > e.sy !== yj > e.sy && e.sx < ((xj - xi) * (e.sy - yi)) / (yj - yi) + xi) inside = !inside;
    }
    const c = this.center(q);
    return { kind: inside ? "move" : "rotate", idx: -1, start: [e.x, e.y], quad: q.map((p) => [...p]) as Quad, angle0: Math.atan2(e.y - c[1], e.x - c[0]) };
  }

  down(e: Ptr): void {
    if (!this.ft && !this.start()) return;
    this.drag = this.hit(e);
  }

  move(e: Ptr): void {
    const ft = this.ft;
    const dr = this.drag;
    if (!ft || !dr) return;
    const q0 = dr.quad;
    const dx = e.x - dr.start[0];
    const dy = e.y - dr.start[1];
    if (dr.kind === "move") {
      ft.setQuad(q0.map(([x, y]) => [x + dx, y + dy]) as Quad);
    } else if (dr.kind === "free") {
      const q = q0.map((p) => [...p]) as Quad;
      q[dr.idx] = [q0[dr.idx][0] + dx, q0[dr.idx][1] + dy];
      ft.setQuad(q);
    } else if (dr.kind === "rotate") {
      const c = this.center(q0);
      let a = Math.atan2(e.y - c[1], e.x - c[0]) - dr.angle0;
      if (e.shift) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
      const cs = Math.cos(a);
      const sn = Math.sin(a);
      ft.setQuad(q0.map(([x, y]) => [c[0] + cs * (x - c[0]) - sn * (y - c[1]), c[1] + sn * (x - c[0]) + cs * (y - c[1])]) as Quad);
    } else {
      // 拡大縮小: 反対側を固定し、四角の向き（u: 0→1、v: 0→3）に沿って伸ばす
      const ux: P2 = [q0[1][0] - q0[0][0], q0[1][1] - q0[0][1]];
      const vx: P2 = [q0[3][0] - q0[0][0], q0[3][1] - q0[0][1]];
      const ul = Math.hypot(ux[0], ux[1]) || 1;
      const vl = Math.hypot(vx[0], vx[1]) || 1;
      const un: P2 = [ux[0] / ul, ux[1] / ul];
      const vn: P2 = [vx[0] / vl, vx[1] / vl];
      // 各角の (u,v) 符号: 0=(0,0) 1=(1,0) 2=(1,1) 3=(0,1)
      const uv: P2[] = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ];
      let su = 1;
      let sv = 1;
      let fixU = 0;
      let fixV = 0;
      const du = dx * un[0] + dy * un[1];
      const dv = dx * vn[0] + dy * vn[1];
      if (dr.kind === "corner") {
        const [cu, cv] = uv[dr.idx];
        fixU = 1 - cu;
        fixV = 1 - cv;
        su = (ul + (cu ? du : -du)) / ul;
        sv = (vl + (cv ? dv : -dv)) / vl;
        if (e.shift) {
          const m = Math.abs(su) > Math.abs(sv) ? su : sv;
          su = Math.sign(su || 1) * Math.abs(m);
          sv = Math.sign(sv || 1) * Math.abs(m);
        }
      } else {
        // 辺 i は角 i と i+1 の間: 0=上 1=右 2=下 3=左
        if (dr.idx === 0) {
          fixV = 1;
          sv = (vl - dv) / vl;
        } else if (dr.idx === 2) {
          fixV = 0;
          sv = (vl + dv) / vl;
        } else if (dr.idx === 1) {
          fixU = 0;
          su = (ul + du) / ul;
        } else {
          fixU = 1;
          su = (ul - du) / ul;
        }
      }
      if (e.alt) {
        fixU = 0.5;
        fixV = 0.5;
      }
      const anchor: P2 = [q0[0][0] + ux[0] * fixU + vx[0] * fixV, q0[0][1] + ux[1] * fixU + vx[1] * fixV];
      const q = q0.map(([x, y]) => {
        const rx = x - anchor[0];
        const ry = y - anchor[1];
        const pu = rx * un[0] + ry * un[1];
        const pv = rx * vn[0] + ry * vn[1];
        const nu = pu * su;
        const nv = pv * sv;
        return [anchor[0] + un[0] * nu + vn[0] * nv, anchor[1] + un[1] * nu + vn[1] * nv];
      }) as Quad;
      ft.setQuad(q);
    }
  }

  up(): void {
    this.drag = null;
  }

  cancel(): void {
    this.drag = null;
  }

  commit(): void {
    this.ft?.commit("変形");
    this.ft = null;
    this.back();
  }

  abort(): void {
    this.ft?.cancel();
    this.ft = null;
    this.back();
  }

  private back(): void {
    const t = this.prevTool;
    this.prevTool = null;
    if (t && t !== "transform") this.s.setTool(t as never);
    this.s.emit("ui");
  }

  flip(axis: "h" | "v"): void {
    const ft = this.ft;
    if (!ft) return;
    const q = ft.quad;
    ft.setQuad(axis === "h" ? [q[1], q[0], q[3], q[2]] : [q[3], q[2], q[1], q[0]]);
  }

  rotate90(dir: 1 | -1): void {
    const ft = this.ft;
    if (!ft) return;
    const q = ft.quad;
    const c = this.center(q);
    const a = (dir * Math.PI) / 2;
    const cs = Math.round(Math.cos(a));
    const sn = Math.round(Math.sin(a));
    ft.setQuad(q.map(([x, y]) => [c[0] + cs * (x - c[0]) - sn * (y - c[1]), c[1] + sn * (x - c[0]) + cs * (y - c[1])]) as Quad);
  }

  key(name: string): boolean {
    if (!this.ft) return false;
    if (name === "enter") {
      this.commit();
      return true;
    }
    if (name === "escape") {
      this.abort();
      return true;
    }
    return false;
  }

  deactivate(): void {
    if (this.ft) this.commit();
  }

  hover(e: Ptr): void {
    const h = this.hit(e);
    this.cursor = !h ? "default" : h.kind === "move" ? "move" : h.kind === "rotate" ? "alias" : h.kind === "free" ? "crosshair" : "nwse-resize";
  }

  overlay(ctx: CanvasRenderingContext2D): void {
    const ft = this.ft;
    if (!ft) return;
    const sp = ft.quad.map((p) => this.scr(p));
    ctx.beginPath();
    sp.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = "#fa512c";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    const dot = (x: number, y: number, r: number) => {
      ctx.beginPath();
      ctx.rect(x - r, y - r, r * 2, r * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = "#fa512c";
      ctx.stroke();
    };
    sp.forEach(([x, y]) => dot(x, y, 4.5));
    for (let i = 0; i < 4; i++) {
      const a = sp[i];
      const b = sp[(i + 1) % 4];
      dot((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 3.5);
    }
  }
}
