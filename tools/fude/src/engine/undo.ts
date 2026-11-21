// 取り消しとやり直し。画素は 256px の区画ごとに「変える前」を GPU のアトラスへ写す。
import type { Doc, Layer, TreeSnap } from "./doc";
import type { GL, Rect, Tex } from "./gl";

const TILE = 256;
const PAGE = 2048;
const PER_ROW = PAGE / TILE;
const PER_PAGE = PER_ROW * PER_ROW;

interface Slot {
  page: number;
  idx: number;
}

class TilePool {
  readonly format: "rgba8" | "r8";
  private g: GL;
  readonly pages: Tex[] = [];
  private free: Slot[] = [];
  used = 0;
  constructor(g: GL, format: "rgba8" | "r8") {
    this.g = g;
    this.format = format;
  }
  alloc(): Slot {
    let s = this.free.pop();
    if (!s) {
      const page = this.pages.length;
      this.pages.push(this.g.createTex(PAGE, PAGE, this.format, `undo:${this.format}:${page}`, { filter: "nearest" }));
      for (let i = PER_PAGE - 1; i > 0; i--) this.free.push({ page, idx: i });
      s = { page, idx: 0 };
    }
    this.used++;
    return s;
  }
  release(s: Slot): void {
    this.free.push(s);
    this.used--;
  }
  xy(s: Slot): [number, number] {
    return [(s.idx % PER_ROW) * TILE, Math.floor(s.idx / PER_ROW) * TILE];
  }
  tex(s: Slot): Tex {
    return this.pages[s.page];
  }
  get bytes(): number {
    return this.used * TILE * TILE * (this.format === "r8" ? 1 : 4);
  }
  dispose(): void {
    for (const p of this.pages) this.g.deleteTex(p);
    this.pages.length = 0;
    this.free = [];
    this.used = 0;
  }
}

interface TileRec {
  x: number;
  y: number;
  w: number;
  h: number;
  before: Slot;
  after: Slot | null;
}

interface PixelRec {
  kind: "pixel";
  layerId: string;
  channel: "color" | "mask";
  pool: TilePool;
  tiles: Map<number, TileRec>;
}

interface StructRec {
  kind: "struct";
  before: TreeSnap;
  after: TreeSnap | null;
  activeBefore: string;
  activeAfter: string;
  paperBefore: { color: string; visible: boolean };
  paperAfter: { color: string; visible: boolean } | null;
}

interface SelRec {
  kind: "sel";
  before: Tex | null;
  beforeBounds: Rect | null;
  after: Tex | null;
  afterBounds: Rect | null;
  done: boolean;
}

type Rec = PixelRec | StructRec | SelRec;

export interface Step {
  label: string;
  recs: Rec[];
  time: number;
}

export interface HistoryHost {
  doc: Doc;
  /** 画素が戻ったとき（合成のやり直し・サムネイル）。 */
  pixelsChanged(layer: Layer, rect: Rect): void;
  structChanged(): void;
  selectionChanged(): void;
}

export class History {
  private g: GL;
  private host: HistoryHost;
  private rgba: TilePool;
  private r8: TilePool;
  steps: Step[] = [];
  index = 0;
  private open: Step | null = null;
  private openDepth = 0;
  budget: number;
  truncated = false;
  onChange: (() => void) | null = null;

  constructor(g: GL, host: HistoryHost, budget: number) {
    this.g = g;
    this.host = host;
    this.budget = budget;
    this.rgba = new TilePool(g, "rgba8");
    this.r8 = new TilePool(g, "r8");
  }

  get doc(): Doc {
    return this.host.doc;
  }

  get canUndo(): boolean {
    return this.index > 0 && !this.open;
  }
  get canRedo(): boolean {
    return this.index < this.steps.length && !this.open;
  }
  get isOpen(): boolean {
    return this.open !== null;
  }

  get bytes(): number {
    let sel = 0;
    for (const s of this.steps) for (const r of s.recs) if (r.kind === "sel") sel += (r.before?.bytes ?? 0) + (r.after?.bytes ?? 0);
    return this.rgba.bytes + this.r8.bytes + sel;
  }

  /** 手順を始める。入れ子にできる（外側だけが 1 手順になる）。 */
  begin(label: string): void {
    if (this.open) {
      this.openDepth++;
      return;
    }
    this.discardRedo();
    this.open = { label, recs: [], time: Date.now() };
    this.openDepth = 1;
  }

  end(): void {
    if (!this.open) return;
    this.openDepth--;
    if (this.openDepth > 0) return;
    const st = this.open;
    this.open = null;
    for (const r of st.recs) {
      if (r.kind === "struct" && !r.after) {
        r.after = this.doc.snapshot();
        r.activeAfter = this.doc.activeId;
        r.paperAfter = { ...this.doc.paper };
      }
      if (r.kind === "sel" && !r.done) this.finishSel(r);
    }
    if (st.recs.length === 0) return;
    this.steps.push(st);
    this.index = this.steps.length;
    this.enforce();
    this.onChange?.();
  }

  /** 開いている手順を、記録ごと捨てて元に戻す（取り消せない途中の失敗用）。 */
  abort(): void {
    if (!this.open) return;
    const st = this.open;
    this.open = null;
    this.openDepth = 0;
    this.applyStep(st, "undo");
    this.freeStep(st);
    this.collect();
    this.onChange?.();
  }

  private discardRedo(): void {
    if (this.index >= this.steps.length) return;
    const gone = this.steps.splice(this.index);
    for (const s of gone) this.freeStep(s);
    this.collect();
  }

  private freeStep(s: Step): void {
    for (const r of s.recs) {
      if (r.kind === "pixel") {
        for (const t of r.tiles.values()) {
          r.pool.release(t.before);
          if (t.after) r.pool.release(t.after);
        }
        r.tiles.clear();
      } else if (r.kind === "sel") {
        this.g.deleteTex(r.before);
        this.g.deleteTex(r.after);
      }
    }
  }

  /** どの記録からも、今の木からも参照されないレイヤーの資源を捨てる。 */
  collect(): void {
    const keep = new Set<string>();
    const add = (s: TreeSnap) => {
      keep.add(s.id);
      s.children.forEach(add);
    };
    add(this.doc.snapshot());
    const all = this.open ? [...this.steps, this.open] : this.steps;
    for (const st of all)
      for (const r of st.recs) {
        if (r.kind === "struct") {
          add(r.before);
          if (r.after) add(r.after);
        } else if (r.kind === "pixel") keep.add(r.layerId);
      }
    for (const [id, l] of [...this.doc.registry]) if (!keep.has(id)) this.doc.freeLayer(l);
  }

  private enforce(): void {
    this.truncated = false;
    while (this.bytes > this.budget && this.steps.length > 1) {
      const s = this.steps.shift()!;
      this.index = Math.max(0, this.index - 1);
      this.freeStep(s);
      this.truncated = true;
    }
    if (this.truncated) this.collect();
  }

  private rec<T extends Rec["kind"]>(kind: T, match: (r: Rec) => boolean): Extract<Rec, { kind: T }> | null {
    if (!this.open) return null;
    for (const r of this.open.recs) if (r.kind === kind && match(r)) return r as Extract<Rec, { kind: T }>;
    return null;
  }

  /** 画素を変える前に呼ぶ。rect の区画のうち、この手順でまだ保存していない所を保存する。 */
  save(layer: Layer, channel: "color" | "mask", rect: Rect): void {
    if (!this.open) throw new Error("history.save: 手順が開いていない");
    const tex = channel === "mask" ? layer.mask : layer.tex;
    if (!tex) return;
    let r = this.rec("pixel", (x) => (x as PixelRec).layerId === layer.id && (x as PixelRec).channel === channel);
    if (!r) {
      r = { kind: "pixel", layerId: layer.id, channel, pool: tex.format === "r8" ? this.r8 : this.rgba, tiles: new Map() };
      this.open.recs.push(r);
    }
    const W = tex.w;
    const H = tex.h;
    const cols = Math.ceil(W / TILE);
    const x0 = Math.max(0, Math.floor(rect.x / TILE));
    const y0 = Math.max(0, Math.floor(rect.y / TILE));
    const x1 = Math.min(cols - 1, Math.floor((rect.x + rect.w - 1) / TILE));
    const y1 = Math.min(Math.ceil(H / TILE) - 1, Math.floor((rect.y + rect.h - 1) / TILE));
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const key = ty * cols + tx;
        if (r.tiles.has(key)) continue;
        const x = tx * TILE;
        const y = ty * TILE;
        const w = Math.min(TILE, W - x);
        const h = Math.min(TILE, H - y);
        const slot = r.pool.alloc();
        const [sx, sy] = r.pool.xy(slot);
        this.g.copy(tex, r.pool.tex(slot), x, y, w, h, sx, sy);
        r.tiles.set(key, { x, y, w, h, before: slot, after: null });
      }
    }
  }

  /** レイヤーの木（並び・属性・追加・削除）を変える前に呼ぶ。 */
  struct(): void {
    if (!this.open) throw new Error("history.struct: 手順が開いていない");
    if (this.rec("struct", () => true)) return;
    this.open.recs.push({
      kind: "struct",
      before: this.doc.snapshot(),
      after: null,
      activeBefore: this.doc.activeId,
      activeAfter: this.doc.activeId,
      paperBefore: { ...this.doc.paper },
      paperAfter: null,
    });
  }

  /** 選択範囲を変える前に呼ぶ。 */
  selection(): void {
    if (!this.open) throw new Error("history.selection: 手順が開いていない");
    if (this.rec("sel", () => true)) return;
    const d = this.doc;
    let before: Tex | null = null;
    if (d.selection) {
      before = this.g.createTex(d.w, d.h, "r8", "undo:sel", { filter: "nearest" });
      this.g.copy(d.selection, before, 0, 0, d.w, d.h, 0, 0);
    }
    this.open.recs.push({ kind: "sel", before, beforeBounds: d.selBounds ? { ...d.selBounds } : null, after: null, afterBounds: null, done: false });
  }

  private finishSel(r: SelRec): void {
    const d = this.doc;
    if (d.selection) {
      r.after = this.g.createTex(d.w, d.h, "r8", "undo:sel", { filter: "nearest" });
      this.g.copy(d.selection, r.after, 0, 0, d.w, d.h, 0, 0);
    }
    r.afterBounds = d.selBounds ? { ...d.selBounds } : null;
    r.done = true;
  }

  undo(): string | null {
    if (!this.canUndo) return null;
    this.index--;
    const st = this.steps[this.index];
    this.applyStep(st, "undo");
    this.onChange?.();
    return st.label;
  }

  redo(): string | null {
    if (!this.canRedo) return null;
    const st = this.steps[this.index];
    this.index++;
    this.applyStep(st, "redo");
    this.onChange?.();
    return st.label;
  }

  private applyStep(st: Step, dir: "undo" | "redo"): void {
    const recs = dir === "undo" ? [...st.recs].reverse() : st.recs;
    // 木を先に戻す（画素の記録が消したレイヤーを指していても、木に戻ってから画素を戻す）
    for (const r of recs) if (r.kind === "struct") this.applyStruct(r, dir);
    for (const r of recs) {
      if (r.kind === "pixel") this.applyPixel(r, dir);
      else if (r.kind === "sel") this.applySel(r, dir);
    }
  }

  private applyStruct(r: StructRec, dir: "undo" | "redo"): void {
    const d = this.doc;
    if (dir === "undo") {
      d.restore(r.before);
      d.activeId = r.activeBefore;
      d.paper = { ...r.paperBefore };
    } else if (r.after) {
      d.restore(r.after);
      d.activeId = r.activeAfter;
      if (r.paperAfter) d.paper = { ...r.paperAfter };
    }
    if (!d.find(d.activeId)) {
      const all = d.allLayers();
      d.activeId = all.length ? all[all.length - 1].id : "";
    }
    this.host.structChanged();
  }

  private applyPixel(r: PixelRec, dir: "undo" | "redo"): void {
    const l = this.doc.registry.get(r.layerId);
    if (!l) return;
    const tex = r.channel === "mask" ? l.mask : l.tex;
    if (!tex) return;
    let dirty: Rect | null = null;
    for (const t of r.tiles.values()) {
      if (dir === "undo") {
        if (!t.after) {
          t.after = r.pool.alloc();
          const [ax, ay] = r.pool.xy(t.after);
          this.g.copy(tex, r.pool.tex(t.after), t.x, t.y, t.w, t.h, ax, ay);
        }
        const [bx, by] = r.pool.xy(t.before);
        this.g.copy(r.pool.tex(t.before), tex, bx, by, t.w, t.h, t.x, t.y);
      } else if (t.after) {
        const [ax, ay] = r.pool.xy(t.after);
        this.g.copy(r.pool.tex(t.after), tex, ax, ay, t.w, t.h, t.x, t.y);
      }
      const rr = { x: t.x, y: t.y, w: t.w, h: t.h };
      dirty = dirty ? { x: Math.min(dirty.x, rr.x), y: Math.min(dirty.y, rr.y), w: Math.max(dirty.x + dirty.w, rr.x + rr.w) - Math.min(dirty.x, rr.x), h: Math.max(dirty.y + dirty.h, rr.y + rr.h) - Math.min(dirty.y, rr.y) } : rr;
    }
    if (dirty) {
      // 範囲は広めに取る（戻した区画が今の bounds の外でも合成されるよう）
      l.touch(dirty);
      this.host.pixelsChanged(l, dirty);
    }
  }

  private applySel(r: SelRec, dir: "undo" | "redo"): void {
    const d = this.doc;
    const src = dir === "undo" ? r.before : r.after;
    const bounds = dir === "undo" ? r.beforeBounds : r.afterBounds;
    if (!src) {
      this.g.deleteTex(d.selection);
      d.selection = null;
      d.selBounds = null;
    } else {
      if (!d.selection) d.selection = this.g.createTex(d.w, d.h, "r8", "selection", { filter: "nearest" });
      this.g.copy(src, d.selection, 0, 0, d.w, d.h, 0, 0);
      d.selBounds = bounds ? { ...bounds } : null;
    }
    this.host.selectionChanged();
  }

  /** 文書を作り直したとき（新規・読み込み）。 */
  reset(): void {
    for (const s of this.steps) this.freeStep(s);
    if (this.open) this.freeStep(this.open);
    this.steps = [];
    this.index = 0;
    this.open = null;
    this.openDepth = 0;
    this.rgba.dispose();
    this.r8.dispose();
    this.onChange?.();
  }

  labels(): { label: string; done: boolean }[] {
    return this.steps.map((s, i) => ({ label: s.label, done: i < this.index }));
  }
}
