// 決まった道筋（図形・AI の線）を、人の筆と同じエンジンで描く。
import type { BrushSettings } from "./brush/presets";
import type { Sample } from "./brush/stroke";
import { hexToRgb } from "./compositor";
import type { Studio, StrokeHandle } from "./studio";

export type PPt = [number, number, number?];

/** 点列（筆圧つきも可）を細かく打ち直した入力の列にする。 */
export function toSamples(pts: PPt[], step = 2, msPerPx = 1.2): Sample[] {
  const out: Sample[] = [];
  if (!pts.length) return out;
  let t = 0;
  const p0 = pts[0];
  out.push({ x: p0[0], y: p0[1], p: p0[2] ?? 1, tx: 0, ty: 0, t });
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 1; k <= n; k++) {
      const u = k / n;
      t += (len / n) * msPerPx;
      const pa = a[2] ?? 1;
      const pb = b[2] ?? 1;
      out.push({ x: a[0] + (b[0] - a[0]) * u, y: a[1] + (b[1] - a[1]) * u, p: pa + (pb - pa) * u, tx: 0, ty: 0, t });
    }
  }
  return out;
}

export interface PathStrokeOpts {
  brush: BrushSettings;
  color: string;
  erase?: boolean;
  label?: string;
  /** 手順を外で開いているとき true */
  keepStep?: boolean;
  /** 散らし筆などの乱数の種（同じ台本なら同じ絵にする） */
  seed?: number;
}

/** すぐに描き切る。 */
export function strokeNow(s: Studio, pts: PPt[], o: PathStrokeOpts): boolean {
  const smp = toSamples(pts);
  if (smp.length < 1) return false;
  const h = s.beginStroke(smp[0], { brush: o.brush, color: hexToRgb(o.color), stabilize: 0, taper: true, label: o.label, keepStep: o.keepStep, erase: o.erase, seed: o.seed });
  if (!h) return false;
  if (smp.length === 1) h.add({ ...smp[0], x: smp[0].x + 0.01, t: smp[0].t + 1 });
  for (let i = 1; i < smp.length; i++) h.add(smp[i]);
  h.end();
  return true;
}

/** 少しずつ描く（AI の再生用）。advance(px) で進め、done で終わり。 */
export class PathPlayer {
  private smp: Sample[];
  private i = 1;
  private h: StrokeHandle | null;
  private acc = 0;
  readonly total: number;
  pos: [number, number];
  constructor(s: Studio, pts: PPt[], o: PathStrokeOpts) {
    this.smp = toSamples(pts);
    let L = 0;
    for (let k = 1; k < this.smp.length; k++) L += Math.hypot(this.smp[k].x - this.smp[k - 1].x, this.smp[k].y - this.smp[k - 1].y);
    this.total = L;
    this.pos = this.smp.length ? [this.smp[0].x, this.smp[0].y] : [0, 0];
    this.h = this.smp.length ? s.beginStroke(this.smp[0], { brush: o.brush, color: hexToRgb(o.color), stabilize: 0, taper: true, label: o.label, keepStep: o.keepStep, erase: o.erase, seed: o.seed }) : null;
    if (this.h && this.smp.length === 1) this.smp.push({ ...this.smp[0], x: this.smp[0].x + 0.01, t: this.smp[0].t + 1 });
  }
  get ok(): boolean {
    return this.h !== null;
  }
  get done(): boolean {
    return !this.h || this.i >= this.smp.length;
  }
  /** 距離 px ぶん進める。 */
  advance(px: number): void {
    if (!this.h) return;
    this.acc += px;
    while (this.i < this.smp.length) {
      const a = this.smp[this.i - 1];
      const b = this.smp[this.i];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (this.acc < d) break;
      this.acc -= d;
      this.h.add(b);
      this.pos = [b.x, b.y];
      this.i++;
    }
  }
  finish(): void {
    if (!this.h) return;
    while (this.i < this.smp.length) this.h.add(this.smp[this.i++]);
    this.h.end();
    this.h = null;
  }
  cancel(): void {
    this.h?.cancel();
    this.h = null;
  }
}
