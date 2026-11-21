// 一筆（ストローク）の進行役。入力 → 判子 → GPU → 確定と取り消しの保存。
import { blendIndex } from "./blend";
import type { BrushRenderer, MergeOptions, MixOptions, StampOptions } from "./brush/render";
import { dabRect } from "./brush/render";
import type { BrushSettings } from "./brush/presets";
import type { Dab, Sample } from "./brush/stroke";
import { StrokeBuilder } from "./brush/stroke";
import type { Compositor } from "./compositor";
import type { Doc, Layer } from "./doc";
import type { Rect, Tex } from "./gl";
import { rectClip, rectUnion } from "./gl";
import type { History } from "./undo";

export interface PaintCtx {
  doc: Doc;
  comp: Compositor;
  br: BrushRenderer;
  hist: History;
  grain(id: string): Tex | null;
}

export type SymmetryFn = (d: Dab) => Dab[];

export interface SessionOptions {
  target: "color" | "mask";
  pressureGamma: number;
  taper: boolean;
  symmetry: SymmetryFn | null;
  seed: number;
}

export class StrokeSession {
  private c: PaintCtx;
  readonly layer: Layer;
  readonly brush: BrushSettings;
  private builder: StrokeBuilder;
  private o: SessionOptions;
  private bbox: Rect | null = null;
  private engine: "stamp" | "water" | "direct";
  private stampOpt: StampOptions;
  private mixOpt: MixOptions | null = null;
  private firstDirect = true;
  private firstCarry = true;
  private tex: Tex;
  private done = false;
  dabCount = 0;

  constructor(c: PaintCtx, layer: Layer, brush: BrushSettings, color: [number, number, number], o: SessionOptions) {
    this.c = c;
    this.layer = layer;
    this.brush = brush;
    this.o = o;
    const tex = o.target === "mask" ? layer.maskTex : layer.tex;
    if (!tex) throw new Error("このレイヤーには描けません");
    this.tex = tex;
    const eng = brush.engine;
    if (o.target === "mask" || brush.erase) this.engine = "stamp";
    else if (eng === "water") this.engine = "water";
    else if (eng === "stamp") this.engine = "stamp";
    else this.engine = "direct";
    const grain = brush.grain !== "none" ? c.grain(brush.grain) : null;
    this.stampOpt = { accumulate: brush.accumulate, grain, grainScale: brush.grainScale, grainStrength: brush.grainStrength };
    if (this.engine === "direct") {
      this.mixOpt = {
        ...this.stampOpt,
        kind: eng === "blur" ? "blur" : eng === "smudge" ? "smudge" : "paint",
        strength: brush.strength,
        paint: brush.mixAmount,
        pickup: brush.pickup,
        alphaLock: layer.props.alphaLock,
        sel: c.doc.selection,
      };
    }
    this.builder = new StrokeBuilder({ brush, color, pressureGamma: o.pressureGamma, seed: o.seed, taper: o.taper });
    if (this.engine !== "direct") {
      const merge = this.mergeOptions();
      const fn = (dst: Tex, rect: Rect) => c.br.preview(dst, rect, this.tex, merge);
      if (o.target === "mask") c.comp.maskOverrides.set(layer.id, fn);
      else c.comp.overrides.set(layer.id, fn);
    }
  }

  private mergeOptions(): MergeOptions {
    const b = this.brush;
    const wetR = Math.max(2, Math.min(24, b.size * 0.12));
    return {
      mode: blendIndex(b.blend),
      erase: b.erase,
      alphaLock: this.o.target === "color" && this.layer.props.alphaLock,
      maskTarget: this.o.target === "mask",
      opacity: b.opacity,
      sel: this.c.doc.selection,
      wetEdge: this.engine === "water" ? b.wetEdge : 0,
      wetRadius: wetR,
      grain: this.c.grain(b.grain === "none" ? "rough" : b.grain),
      grainScale: b.grainScale,
    };
  }

  begin(s: Sample): void {
    this.builder.begin(s);
    this.flush();
  }

  add(s: Sample): void {
    if (this.done) return;
    this.builder.add(s);
    this.flush();
  }

  private expand(dabs: Dab[]): Dab[] {
    const sym = this.o.symmetry;
    if (!sym) return dabs;
    const out: Dab[] = [];
    for (const d of dabs) for (const e of sym(d)) out.push(e);
    return out;
  }

  private flush(): void {
    const raw = this.builder.take();
    if (!raw.length) return;
    const dabs = this.expand(raw);
    this.dabCount += dabs.length;
    const c = this.c;
    let dirty: Rect | null = null;
    if (this.engine === "stamp") {
      dirty = c.br.stamp(dabs, this.stampOpt);
    } else if (this.engine === "water") {
      dirty = c.br.stampCarry(dabs, this.stampOpt, this.tex, this.brush.mixAmount, this.brush.pickup, this.firstCarry);
      this.firstCarry = false;
    } else {
      const mo = this.mixOpt!;
      const op = this.brush.opacity;
      for (const d0 of dabs) {
        const d = op < 1 ? { ...d0, alpha: d0.alpha * op } : d0;
        if (mo.kind === "paint" && this.brush.paintLoad > 0) mo.paint = this.brush.mixAmount * Math.exp(-d.dist / this.brush.paintLoad);
        const r = c.br.mixDab(d, this.tex, mo, this.firstDirect, (rr) => c.hist.save(this.layer, this.o.target, rr));
        this.firstDirect = false;
        dirty = rectUnion(dirty, r);
      }
      if (dirty) this.layer.touch(dirty);
    }
    if (dirty) {
      this.bbox = rectUnion(this.bbox, dirty);
      c.comp.mark(dirty);
    }
  }

  /** 一筆の終わり。確定して取り消しに積む（手順の開閉は呼ぶ側）。 */
  end(): Rect | null {
    if (this.done) return null;
    this.done = true;
    const changed = this.builder.end();
    this.flush();
    const c = this.c;
    if (this.engine === "direct") return this.bbox;
    if (changed && this.bbox) {
      // 抜きを反映して描き直す
      c.br.clearStroke(this.bbox);
      const all = this.expand(this.builder.dabs);
      if (this.engine === "water") c.br.stampCarry(all, this.stampOpt, this.tex, this.brush.mixAmount, this.brush.pickup, true);
      else c.br.stamp(all, this.stampOpt);
      let bb: Rect | null = null;
      for (const d of all) bb = rectUnion(bb, dabRect(d));
      this.bbox = bb ? rectClip(bb, c.doc.w, c.doc.h) : this.bbox;
    }
    const bbox = this.bbox;
    if (bbox) {
      // 水彩の縁は少し外までにじむので広げて確定する
      const pad = this.engine === "water" ? 4 : 0;
      const r = rectClip({ x: bbox.x - pad, y: bbox.y - pad, w: bbox.w + 2 * pad, h: bbox.h + 2 * pad }, c.doc.w, c.doc.h)!;
      c.hist.save(this.layer, this.o.target, r);
      c.br.commit(r, this.tex, this.mergeOptions());
      c.br.clearStroke(r);
      this.layer.touch(r);
      c.comp.mark(r);
    }
    this.release();
    return bbox;
  }

  cancel(): void {
    if (this.done) return;
    this.done = true;
    if (this.bbox && this.engine !== "direct") {
      this.c.br.clearStroke(this.bbox);
      this.c.comp.mark(this.bbox);
    }
    this.release();
  }

  private release(): void {
    this.c.comp.overrides.delete(this.layer.id);
    this.c.comp.maskOverrides.delete(this.layer.id);
  }

  get length(): number {
    return this.builder.length;
  }
}
