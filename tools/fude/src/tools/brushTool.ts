// 筆の道具（ペン・鉛筆・筆・エアブラシ・デコレーション・消しゴム・色混ぜ）。
import type { Studio, StrokeHandle } from "../engine/studio";
import type { Ptr, Tool } from "./types";
import { toSample } from "./types";

/** パース定規・対称の吸着。start から見て一番近い向きへ点を寄せる。 */
export class Snapper {
  private dir: [number, number] | null = null;
  private start: { x: number; y: number } | null = null;
  constructor(private studio: Studio) {}
  reset(x: number, y: number): void {
    this.start = { x, y };
    this.dir = null;
  }
  apply(x: number, y: number): [number, number] {
    const ps = this.studio.perspective;
    const st = this.start;
    if (!ps.enabled || !ps.snap || !st || ps.points.length === 0) return [x, y];
    const dx = x - st.x;
    const dy = y - st.y;
    const len = Math.hypot(dx, dy);
    if (!this.dir) {
      if (len * this.studio.view.zoom < 8) return [st.x, st.y];
      const cands: [number, number][] = [
        [1, 0],
        [0, 1],
      ];
      for (const vp of ps.points) {
        const vx = vp.x - st.x;
        const vy = vp.y - st.y;
        const vl = Math.hypot(vx, vy);
        if (vl > 1e-3) cands.push([vx / vl, vy / vl]);
      }
      let best = cands[0];
      let bv = -1;
      for (const c of cands) {
        const v = Math.abs((dx * c[0] + dy * c[1]) / len);
        if (v > bv) {
          bv = v;
          best = c;
        }
      }
      this.dir = best;
    }
    const t = dx * this.dir[0] + dy * this.dir[1];
    return [st.x + this.dir[0] * t, st.y + this.dir[1] * t];
  }
}

export class BrushTool implements Tool {
  readonly id = "brush";
  cursor = "none";
  private h: StrokeHandle | null = null;
  private studio: Studio;
  private hoverPos: { sx: number; sy: number } | null = null;
  private snap: Snapper;
  constructor(studio: Studio) {
    this.studio = studio;
    this.snap = new Snapper(studio);
  }

  down(e: Ptr): void {
    const s = this.studio;
    this.hoverPos = { sx: e.sx, sy: e.sy };
    if (e.shift && s.lastStrokeEnd) {
      // Shift + クリック: 前の線の終わりから直線
      const a = s.lastStrokeEnd;
      const h = s.beginStroke({ x: a.x, y: a.y, p: e.p, tx: e.tx, ty: e.ty, t: e.t - 16 }, { stabilize: 0, label: "直線" });
      if (!h) return;
      const n = Math.max(2, Math.ceil(Math.hypot(e.x - a.x, e.y - a.y) / 4));
      for (let i = 1; i <= n; i++) h.add({ x: a.x + ((e.x - a.x) * i) / n, y: a.y + ((e.y - a.y) * i) / n, p: e.p, tx: e.tx, ty: e.ty, t: e.t - 16 + i });
      h.end();
      return;
    }
    this.snap.reset(e.x, e.y);
    this.h = s.beginStroke(toSample(e));
  }

  move(e: Ptr): void {
    this.hoverPos = { sx: e.sx, sy: e.sy };
    if (!this.h) return;
    const [x, y] = this.snap.apply(e.x, e.y);
    this.h.add({ ...toSample(e), x, y });
  }

  up(e: Ptr): void {
    if (!this.h) return;
    const [x, y] = this.snap.apply(e.x, e.y);
    this.h.add({ ...toSample(e), x, y });
    this.h.end();
    this.h = null;
  }

  cancel(): void {
    this.h?.cancel();
    this.h = null;
  }

  get drawing(): boolean {
    return this.h !== null;
  }

  hover(e: Ptr): void {
    this.hoverPos = { sx: e.sx, sy: e.sy };
    this.studio.requestFrame();
  }

  leave(): void {
    this.hoverPos = null;
    this.studio.requestFrame();
  }

  overlay(ctx: CanvasRenderingContext2D): void {
    const p = this.hoverPos;
    if (!p) return;
    const s = this.studio;
    const b = s.currentBrush();
    const r = (b.size / 2) * s.view.zoom;
    ctx.lineWidth = 1;
    if (r >= 3) {
      ctx.beginPath();
      if (b.roundness < 0.98 && b.angleMode === "fixed") {
        ctx.ellipse(p.sx, p.sy, r, r * b.roundness, ((b.angle * Math.PI) / 180) + s.view.rot, 0, Math.PI * 2);
      } else ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.stroke();
      ctx.beginPath();
      if (b.roundness < 0.98 && b.angleMode === "fixed") {
        ctx.ellipse(p.sx, p.sy, Math.max(1, r - 1), Math.max(1, (r - 1) * b.roundness), ((b.angle * Math.PI) / 180) + s.view.rot, 0, Math.PI * 2);
      } else ctx.arc(p.sx, p.sy, Math.max(1, r - 1), 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.stroke();
    }
    // 中心の十字（小さい筆でも位置が分かるように）
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.moveTo(p.sx - 4, p.sy);
    ctx.lineTo(p.sx + 4, p.sy);
    ctx.moveTo(p.sx, p.sy - 4);
    ctx.lineTo(p.sx, p.sy + 4);
    ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.beginPath();
    ctx.moveTo(p.sx - 3, p.sy + 0.5);
    ctx.lineTo(p.sx + 3, p.sy + 0.5);
    ctx.stroke();
  }
}

export class EyedropperTool implements Tool {
  readonly id = "eyedropper";
  cursor = "crosshair";
  private on = false;
  constructor(private studio: Studio, private sample: () => "canvas" | "layer") {}
  private pick(e: Ptr): void {
    const c = this.studio.pick(e.x, e.y, this.sample());
    if (c) this.studio.setColor(c, e.button === 2 ? "sub" : "main");
  }
  down(e: Ptr): void {
    this.on = true;
    this.pick(e);
  }
  move(e: Ptr): void {
    if (this.on) this.pick(e);
  }
  up(): void {
    if (this.on) this.studio.pushColorHistory(this.studio.colors.main);
    this.on = false;
  }
  cancel(): void {
    this.on = false;
  }
}

export class HandTool implements Tool {
  readonly id = "hand";
  cursor = "grab";
  private last: { sx: number; sy: number } | null = null;
  constructor(private studio: Studio) {}
  down(e: Ptr): void {
    this.last = { sx: e.sx, sy: e.sy };
    this.cursor = "grabbing";
  }
  move(e: Ptr): void {
    if (!this.last) return;
    this.studio.view.panBy(e.sx - this.last.sx, e.sy - this.last.sy);
    this.last = { sx: e.sx, sy: e.sy };
  }
  up(): void {
    this.last = null;
    this.cursor = "grab";
  }
  cancel(): void {
    this.last = null;
  }
}

export class ZoomTool implements Tool {
  readonly id = "zoom";
  cursor = "zoom-in";
  private start: { sx: number; sy: number; z: number } | null = null;
  private moved = false;
  constructor(private studio: Studio) {}
  down(e: Ptr): void {
    this.start = { sx: e.sx, sy: e.sy, z: this.studio.view.zoom };
    this.moved = false;
  }
  move(e: Ptr): void {
    if (!this.start) return;
    const dx = e.sx - this.start.sx;
    if (Math.abs(dx) > 3) this.moved = true;
    if (this.moved) this.studio.view.zoomAt(this.start.z * Math.pow(2, dx / 150), this.start.sx, this.start.sy);
  }
  up(e: Ptr): void {
    if (this.start && !this.moved) {
      const v = this.studio.view;
      v.zoomAt(e.alt ? v.zoom / 1.5 : v.zoom * 1.5, e.sx, e.sy);
    }
    this.start = null;
  }
  cancel(): void {
    this.start = null;
  }
}

export class RotateTool implements Tool {
  readonly id = "rotate";
  cursor = "alias";
  private start: { a: number; rot: number } | null = null;
  constructor(private studio: Studio) {}
  private angle(e: Ptr): number {
    const v = this.studio.view;
    return Math.atan2(e.sy - v.sh / 2, e.sx - v.sw / 2);
  }
  down(e: Ptr): void {
    this.start = { a: this.angle(e), rot: this.studio.view.rot };
  }
  move(e: Ptr): void {
    if (!this.start) return;
    const v = this.studio.view;
    let r = this.start.rot + (this.angle(e) - this.start.a);
    if (e.shift) r = Math.round(r / (Math.PI / 12)) * (Math.PI / 12);
    v.rotateAt(r, v.sw / 2, v.sh / 2);
  }
  up(): void {
    this.start = null;
  }
  cancel(): void {
    this.start = null;
  }
}
