// FUDE の司令塔。文書・合成・筆・取り消し・表示・道具の状態をまとめる。
// 画面（React）と AI の操作口（ai/api.ts）は、どちらもここのメソッドを呼ぶ。
import { buildBrushTextures, type BrushTextures } from "./brush/textures";
import { BrushRenderer } from "./brush/render";
import { cloneBrush, PRESETS, type BrushSettings, type ToolGroup } from "./brush/presets";
import { Stabilizer, type Sample } from "./brush/stroke";
import { Compositor, hexToRgb } from "./compositor";
import { Doc, Layer, type LayerProps, type TextProps } from "./doc";
import { Emitter, type Topic } from "./events";
import { GL, type Rect, type Tex } from "./gl";
import { StrokeSession, type SymmetryFn } from "./painter";
import { History } from "./undo";
import { Display, View } from "./view";

export type ToolId =
  | "move"
  | "select"
  | "wand"
  | "eyedropper"
  | ToolGroup
  | "fill"
  | "gradient"
  | "shape"
  | "text"
  | "hand"
  | "zoom"
  | "rotate"
  | "transform";

export const BRUSH_TOOLS: ToolGroup[] = ["pen", "pencil", "brush", "airbrush", "deco", "eraser", "blend"];

export function isBrushTool(t: ToolId): t is ToolGroup {
  return (BRUSH_TOOLS as string[]).includes(t);
}

export interface SymmetrySettings {
  enabled: boolean;
  mode: "vertical" | "horizontal" | "both" | "radial";
  count: number;
  mirror: boolean;
  cx: number;
  cy: number;
}

export interface PerspectiveSettings {
  enabled: boolean;
  snap: boolean;
  points: { x: number; y: number }[];
  horizonVisible: boolean;
}

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "warn" | "error";
}

export interface UIState {
  dialog: { id: string; data?: unknown } | null;
  /** 狭い画面で開いている引き出し */
  drawer: "left" | "right" | null;
  /** パネルを隠す（Tab） */
  hidePanels: boolean;
  /** AI の再生中 */
  aiPlaying: boolean;
  /** 塗りつぶし・スポイトなどの「参照先」 */
  sample: "canvas" | "layer";
  fill: { refer: "layer" | "all" | "ref"; tolerance: number; gap: number; expand: number; antialias: boolean; contiguous: boolean };
  gradient: { kind: "linear" | "radial"; stops: "main-sub" | "main-clear" | "sub-main" | "rainbow"; opacity: number };
  select: { shape: "rect" | "ellipse" | "lasso" | "polygon"; mode: "replace" | "add" | "subtract" | "intersect"; feather: number };
  shape: { kind: "line" | "rect" | "ellipse" | "polygon" | "curve"; fill: boolean; stroke: boolean };
  text: { font: string; size: number; vertical: boolean; bold: boolean; strokeWidth: number; lineHeight: number };
}

export interface StrokeHandle {
  add(s: Sample): void;
  end(): void;
  cancel(): void;
  readonly session: StrokeSession;
}

const STORE_KEY = "fude:settings:v1";

function safeLoad(): Record<string, unknown> {
  try {
    const s = localStorage.getItem(STORE_KEY);
    return s ? (JSON.parse(s) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function safeSave(v: Record<string, unknown>): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(v));
  } catch {
    /* 保存できない環境（プライベートモードなど）では覚えない */
  }
}

export class Studio {
  readonly g: GL;
  readonly canvas: HTMLCanvasElement;
  readonly ev = new Emitter();
  readonly view = new View();
  readonly tex: BrushTextures;
  private display: Display;
  doc!: Doc;
  comp!: Compositor;
  br!: BrushRenderer;
  hist!: History;
  tile = 1024;

  tool: ToolId = "pen";
  /** 道具ごとの選択中の筆 */
  activeBrush: Record<ToolGroup, string> = { pen: "gpen", pencil: "pencil", brush: "watercolor", airbrush: "airsoft", deco: "stars", eraser: "erhard", blend: "finger" };
  /** 筆の設定（初期値から変えた物） */
  brushes = new Map<string, BrushSettings>();
  colors = { main: "#24222a", sub: "#ffffff", transparent: false };
  colorHistory: string[] = [];
  pressureGamma = 1;
  stabilizeBoost = 0;
  symmetry: SymmetrySettings = { enabled: false, mode: "vertical", count: 6, mirror: true, cx: 0, cy: 0 };
  perspective: PerspectiveSettings = { enabled: false, snap: true, points: [], horizonVisible: true };
  /** 指で描く（ペンを一度使ったら、手のひらで描かないよう指は移動だけになる） */
  fingerDraw = true;
  ui: UIState = {
    dialog: null,
    drawer: null,
    hidePanels: false,
    aiPlaying: false,
    sample: "canvas",
    fill: { refer: "all", tolerance: 12, gap: 2, expand: 1, antialias: true, contiguous: true },
    gradient: { kind: "linear", stops: "main-clear", opacity: 1 },
    select: { shape: "rect", mode: "replace", feather: 0 },
    shape: { kind: "line", fill: false, stroke: true },
    text: { font: "sans-serif", size: 48, vertical: false, bold: false, strokeWidth: 0, lineHeight: 1.4 },
  };
  toasts: Toast[] = [];
  private toastId = 0;
  private rafId = 0;

  private overlayDraw: ((ctx: CanvasRenderingContext2D) => void)[] = [];
  overlay: HTMLCanvasElement | null = null;
  private time0 = performance.now();
  /** 合成と表示をした回数（検査用）。 */
  frames = 0;
  lastStrokeEnd: { x: number; y: number } | null = null;
  contextLost = false;
  /** 表示パネルの都合で外から足す、毎フレームの後処理 */
  afterFrame: (() => void) | null = null;
  /** 道具や部品の置き場（変形の道具など） */
  ext: Record<string, unknown> = {};
  /** 変形中など、選択範囲の点線を隠す */
  hideAnts = false;
  /** 今の道具にキーを先に渡す（変形の Enter/Esc など）。 */
  toolKeyHook: ((name: string, e: KeyboardEvent) => boolean) | null = null;
  readonly bg: [number, number, number] = [0.165, 0.169, 0.18];

  static create(canvas: HTMLCanvasElement): Studio | string {
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: true, desynchronized: true, powerPreference: "high-performance" });
    if (!gl) return "この端末のブラウザでは WebGL2 が使えないため、FUDE を動かせません。最新の Chrome・Edge・Safari・Firefox でお試しください。";
    return new Studio(canvas, gl);
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.g = new GL(gl);
    this.tex = buildBrushTextures(this.g);
    this.display = new Display(this.g);
    this.loadSettings();
    this.view.onChange = () => {
      this.ev.emit("view");
      this.requestFrame();
    };
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.contextLost = true;
      this.toast("描画の仕組み（GPU）が止まりました。自動保存から読み直してください。", "error");
    });
  }

  // ---------- 設定の保存 ----------
  private loadSettings(): void {
    const s = safeLoad();
    const br = s.brushes as Record<string, Partial<BrushSettings>> | undefined;
    if (br) {
      for (const [id, patch] of Object.entries(br)) {
        const base = PRESETS.find((p) => p.id === id) ?? (patch as BrushSettings);
        if (!base || !base.tool) continue;
        this.brushes.set(id, { ...cloneBrush(base as BrushSettings), ...patch, id });
      }
    }
    const ab = s.activeBrush as Partial<Record<ToolGroup, string>> | undefined;
    if (ab) Object.assign(this.activeBrush, ab);
    const c = s.colors as { main?: string; sub?: string } | undefined;
    if (c?.main) this.colors.main = c.main;
    if (c?.sub) this.colors.sub = c.sub;
    if (Array.isArray(s.colorHistory)) this.colorHistory = (s.colorHistory as string[]).slice(0, 24);
    if (typeof s.pressureGamma === "number") this.pressureGamma = s.pressureGamma;
    if (typeof s.fingerDraw === "boolean") this.fingerDraw = s.fingerDraw;
  }

  saveSettings(): void {
    const brushes: Record<string, Partial<BrushSettings>> = {};
    for (const [id, b] of this.brushes) brushes[id] = b;
    safeSave({ brushes, activeBrush: this.activeBrush, colors: { main: this.colors.main, sub: this.colors.sub }, colorHistory: this.colorHistory, pressureGamma: this.pressureGamma, fingerDraw: this.fingerDraw });
  }

  // ---------- 文書 ----------
  newDocument(w: number, h: number, opts?: { paper?: string | null; name?: string; empty?: boolean }): void {
    const max = Math.min(this.g.maxTex, 8192);
    w = Math.max(16, Math.min(max, Math.round(w)));
    h = Math.max(16, Math.min(max, Math.round(h)));
    this.disposeDoc();
    this.tile = Math.min(1024, Math.ceil(Math.max(w, h) / 64) * 64);
    const doc = new Doc(this.g, w, h);
    if (opts?.name) doc.name = opts.name;
    if (opts?.paper === null) doc.paper.visible = false;
    else if (opts?.paper) doc.paper.color = opts.paper;
    this.attachDoc(doc);
    if (!opts?.empty) {
      const l = doc.createRaster("レイヤー 1");
      doc.insert(l, doc.root, 0);
      doc.activeId = l.id;
    }
    this.view.setCanvas(w, h);
    this.view.rot = 0;
    this.view.flip = false;
    this.view.fit();
    this.comp.markAll();
    this.ev.emit("doc", "layers", "history", "selection", "view");
    this.requestFrame();
  }

  /** 読み込んだ文書（io から）を使う。 */
  attachDoc(doc: Doc): void {
    if (this.doc && this.doc !== doc) this.disposeDoc();
    this.doc = doc;
    this.tile = Math.min(1024, Math.ceil(Math.max(doc.w, doc.h) / 64) * 64);
    this.comp = new Compositor(this.g, doc, this.tile);
    this.br = new BrushRenderer(this.g, this.tex, doc.w, doc.h, this.tile);
    const budget = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 220 * 1024 * 1024 : 640 * 1024 * 1024;
    this.hist = new History(
      this.g,
      {
        doc,
        pixelsChanged: (_l, r) => {
          this.comp.mark(r);
          this.ev.emit("pixels");
          this.requestFrame();
        },
        structChanged: () => {
          this.comp.markAll();
          this.ev.emit("layers");
          this.requestFrame();
        },
        selectionChanged: () => {
          this.ev.emit("selection");
          this.requestFrame();
        },
      },
      budget,
    );
    this.hist.onChange = () => this.ev.emit("history");
    this.symmetry.cx = doc.w / 2;
    this.symmetry.cy = doc.h / 2;
    this.view.setCanvas(doc.w, doc.h);
  }

  private disposeDoc(): void {
    if (!this.doc) return;
    this.hist?.reset();
    this.comp?.dispose();
    this.br?.dispose();
    this.doc.dispose();
  }

  // ---------- 描画ループ ----------
  requestFrame(): void {

    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      this.frame();
    });
  }

  /** 合成と表示をすぐに行う（rAF が止まる環境・検査・AI 用）。 */
  flush(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.frame();
  }

  private frame(): void {
    if (this.contextLost || !this.doc) return;

    this.comp.update();
    const t = (performance.now() - this.time0) / 1000;
    this.display.draw(this.view, this.comp.comp, this.hideAnts ? null : this.doc.selection, this.comp.mipsDirty, t, this.bg);
    this.comp.mipsDirty = false;
    this.frames++;
    this.drawOverlay();
    this.afterFrame?.();
    // 選択範囲の点線は動かし続ける
    if (this.doc.selection) {
      setTimeout(() => this.requestFrame(), 120);
    }
  }

  setOverlay(c: HTMLCanvasElement): void {
    this.overlay = c;
  }

  addOverlay(fn: (ctx: CanvasRenderingContext2D) => void): () => void {
    this.overlayDraw.push(fn);
    return () => {
      this.overlayDraw = this.overlayDraw.filter((f) => f !== fn);
    };
  }

  private drawOverlay(): void {
    const c = this.overlay;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const v = this.view;
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.clearRect(0, 0, v.sw, v.sh);
    for (const f of this.overlayDraw) {
      ctx.save();
      f(ctx);
      ctx.restore();
    }
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    const v = this.view;
    const first = v.sw <= 1;
    v.sw = Math.max(1, cssW);
    v.sh = Math.max(1, cssH);
    v.dpr = dpr;
    const dw = Math.round(cssW * dpr);
    const dh = Math.round(cssH * dpr);
    if (this.canvas.width !== dw || this.canvas.height !== dh) {
      this.canvas.width = dw;
      this.canvas.height = dh;
    }
    if (this.overlay && (this.overlay.width !== dw || this.overlay.height !== dh)) {
      this.overlay.width = dw;
      this.overlay.height = dh;
    }
    if ((first || v.fitted) && this.doc) v.fit();
    this.requestFrame();
  }

  setUI(patch: Partial<UIState>): void {
    this.ui = { ...this.ui, ...patch };
    this.ev.emit("ui");
  }

  openDialog(id: string, data?: unknown): void {
    this.setUI({ dialog: { id, data } });
  }

  closeDialog(): void {
    this.setUI({ dialog: null });
  }

  // ---------- お知らせ ----------
  toast(text: string, kind: Toast["kind"] = "info"): void {
    const t = { id: ++this.toastId, text, kind };
    this.toasts = [...this.toasts.slice(-3), t];
    this.ev.emit("status");
    setTimeout(() => {
      this.toasts = this.toasts.filter((x) => x.id !== t.id);
      this.ev.emit("status");
    }, kind === "error" ? 6000 : 2600);
  }

  // ---------- 道具と筆 ----------
  setTool(t: ToolId): void {
    if (this.tool === t) return;
    this.tool = t;
    this.ev.emit("tool");
    this.requestFrame();
  }

  brushFor(group: ToolGroup, id?: string): BrushSettings {
    const bid = id ?? this.activeBrush[group];
    const got = this.brushes.get(bid);
    if (got) return got;
    const p = PRESETS.find((x) => x.id === bid) ?? PRESETS.find((x) => x.tool === group)!;
    return p;
  }

  /** 今の道具の筆（筆の道具でなければ直近の筆の道具）。 */
  currentBrush(): BrushSettings {
    const g = isBrushTool(this.tool) ? this.tool : "pen";
    return this.brushFor(g);
  }

  setBrushParam<K extends keyof BrushSettings>(key: K, value: BrushSettings[K], group?: ToolGroup): void {
    const g = group ?? (isBrushTool(this.tool) ? this.tool : "pen");
    const cur = this.brushFor(g);
    const next = { ...cur, [key]: value };
    this.brushes.set(next.id, next);
    this.ev.emit("brush");
    this.saveSettingsSoon();
  }

  resetBrush(id: string): void {
    const p = PRESETS.find((x) => x.id === id);
    if (p) this.brushes.delete(id);
    this.ev.emit("brush");
    this.saveSettingsSoon();
  }

  selectBrush(group: ToolGroup, id: string): void {
    this.activeBrush[group] = id;
    if (this.tool !== group) this.tool = group;
    this.ev.emit("brush", "tool");
    this.saveSettingsSoon();
  }

  /** 筆を複製して自分用の筆にする。 */
  duplicateBrush(id: string): BrushSettings {
    const src = this.brushFor(this.brushGroupOf(id), id);
    const nid = `u${Date.now().toString(36)}`;
    const copy = { ...src, id: nid, name: `${src.name} のコピー` };
    this.brushes.set(nid, copy);
    this.activeBrush[copy.tool] = nid;
    this.ev.emit("brush");
    this.saveSettingsSoon();
    return copy;
  }

  deleteBrush(id: string): void {
    if (PRESETS.some((p) => p.id === id)) return;
    const b = this.brushes.get(id);
    this.brushes.delete(id);
    if (b && this.activeBrush[b.tool] === id) this.activeBrush[b.tool] = PRESETS.find((p) => p.tool === b.tool)!.id;
    this.ev.emit("brush");
    this.saveSettingsSoon();
  }

  brushGroupOf(id: string): ToolGroup {
    return (this.brushes.get(id) ?? PRESETS.find((p) => p.id === id))?.tool ?? "pen";
  }

  brushesOf(group: ToolGroup): BrushSettings[] {
    const out = PRESETS.filter((p) => p.tool === group).map((p) => this.brushes.get(p.id) ?? p);
    for (const b of this.brushes.values()) if (b.tool === group && !PRESETS.some((p) => p.id === b.id)) out.push(b);
    return out;
  }

  private saveTimer = 0;
  saveSettingsSoon(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveSettings(), 400);
  }

  setColor(hex: string, which: "main" | "sub" = "main"): void {
    const h = normHex(hex);
    if (!h) return;
    this.colors[which] = h;
    if (which === "main") this.colors.transparent = false;
    this.ev.emit("color");
    this.saveSettingsSoon();
  }

  swapColors(): void {
    const { main, sub } = this.colors;
    this.colors.main = sub;
    this.colors.sub = main;
    this.ev.emit("color");
  }

  pushColorHistory(hex: string): void {
    const h = normHex(hex);
    if (!h) return;
    this.colorHistory = [h, ...this.colorHistory.filter((c) => c !== h)].slice(0, 24);
    this.ev.emit("color");
  }

  // ---------- レイヤー ----------
  emitLayers(): void {
    this.comp.markAll();
    this.ev.emit("layers");
    this.requestFrame();
  }

  /** 木を変える操作を 1 手順として包む。 */
  structOp<T>(label: string, fn: () => T): T {
    this.hist.begin(label);
    this.hist.struct();
    try {
      return fn();
    } finally {
      this.hist.end();
      this.emitLayers();
    }
  }

  addLayer(opts?: { name?: string; above?: Layer | null; props?: Partial<LayerProps>; parent?: Layer; index?: number }): Layer {
    return this.structOp("新しいレイヤー", () => {
      const d = this.doc;
      const name = opts?.name ?? this.nextLayerName("レイヤー");
      const l = d.createRaster(name);
      if (opts?.props) Object.assign(l.props, opts.props);
      if (opts?.parent) d.insert(l, opts.parent, opts.index ?? opts.parent.children.length);
      else d.insertAboveActive(l);
      d.activeId = l.id;
      d.editMask = false;
      return l;
    });
  }

  addGroup(name?: string): Layer {
    return this.structOp("新しいフォルダー", () => {
      const d = this.doc;
      const g = d.createGroup(name ?? this.nextLayerName("フォルダー"));
      d.insertAboveActive(g);
      d.activeId = g.id;
      return g;
    });
  }

  addTextLayer(text: TextProps, name?: string): Layer {
    return this.structOp("テキスト", () => {
      const d = this.doc;
      const l = d.createText(name ?? text.text.slice(0, 16).replace(/\s+/g, " ") ?? "テキスト", text);
      d.insertAboveActive(l);
      d.activeId = l.id;
      this.renderTextLayer?.(l);
      return l;
    });
  }

  /** テキストの描画（ops/text.ts が差し込む）。 */
  renderTextLayer: ((l: Layer) => void) | null = null;

  nextLayerName(base: string): string {
    const names = new Set(this.doc.allLayers().map((l) => l.props.name));
    let i = 1;
    while (names.has(`${base} ${i}`)) i++;
    return `${base} ${i}`;
  }

  setActive(id: string, editMask = false): void {
    if (!this.doc.find(id)) return;
    this.doc.activeId = id;
    this.doc.editMask = editMask && !!this.doc.find(id)?.maskTex;
    this.ev.emit("layers");
  }

  setLayerProps(id: string, patch: Partial<LayerProps>, label = "レイヤーの設定"): void {
    const l = this.doc.find(id);
    if (!l) return;
    this.structOp(label, () => {
      Object.assign(l.props, patch);
    });
  }

  /** 不透明度の連続変更などは手順にまとめたい: begin/commit で包む。 */
  setLayerPropsLive(id: string, patch: Partial<LayerProps>): void {
    const l = this.doc.find(id);
    if (!l) return;
    Object.assign(l.props, patch);
    this.emitLayers();
  }

  deleteLayer(id: string): void {
    const l = this.doc.find(id);
    if (!l) return;
    if (this.doc.allLayers().filter((x) => !x.isGroup).length <= 1 && !l.isGroup) {
      this.toast("最後のレイヤーは消せません", "warn");
      return;
    }
    this.structOp("レイヤーを削除", () => {
      const parent = l.parent!;
      const i = parent.children.indexOf(l);
      this.doc.detach(l);
      const below = parent.children[Math.max(0, i - 1)] ?? parent.children[0] ?? (parent !== this.doc.root ? parent : null);
      const any = this.doc.allLayers();
      this.doc.activeId = below ? below.id : any.length ? any[any.length - 1].id : "";
    });
  }

  moveLayer(id: string, parentId: string, index: number): void {
    const l = this.doc.find(id);
    const parent = parentId === "root" ? this.doc.root : this.doc.find(parentId);
    if (!l || !parent || !parent.isGroup) return;
    // 自分の中へは入れない
    let p: Layer | null = parent;
    while (p) {
      if (p === l) return;
      p = p.parent;
    }
    this.structOp("レイヤーの移動", () => {
      const sameParent = l.parent === parent;
      const oldIndex = parent.children.indexOf(l);
      this.doc.detach(l);
      let idx = index;
      if (sameParent && oldIndex >= 0 && oldIndex < index) idx--;
      this.doc.insert(l, parent, idx);
    });
  }

  duplicateLayer(id: string): Layer | null {
    const src = this.doc.find(id);
    if (!src) return null;
    return this.structOp("レイヤーを複製", () => {
      const d = this.doc;
      const copy = (s: Layer): Layer => {
        let n: Layer;
        if (s.isGroup) {
          n = d.createGroup(s.props.name);
          for (const c of s.children) {
            const cc = copy(c);
            d.insert(cc, n, n.children.length);
          }
        } else if (s.kind === "text" && s.text) {
          n = d.createText(s.props.name, s.text);
          this.g.copy(s.tex!, n.tex!, 0, 0, d.w, d.h, 0, 0);
        } else {
          n = d.createRaster(s.props.name);
          this.g.copy(s.tex!, n.tex!, 0, 0, d.w, d.h, 0, 0);
        }
        n.props = { ...s.props };
        n.bounds = s.bounds ? { ...s.bounds } : null;
        if (s.mask) {
          n.mask = this.g.createTex(d.w, d.h, "r8", "mask");
          this.g.copy(s.mask, n.mask, 0, 0, d.w, d.h, 0, 0);
        }
        return n;
      };
      const n = copy(src);
      n.props.name = `${src.props.name} のコピー`;
      d.insert(n, src.parent!, src.parent!.children.indexOf(src) + 1);
      d.activeId = n.id;
      return n;
    });
  }

  // ---------- 一筆 ----------
  /** 描けるかを確かめ、だめなら理由をお知らせして null。 */
  paintableLayer(target: "color" | "mask" = this.doc.editMask ? "mask" : "color"): Layer | null {
    // レイヤーが 1 枚も無ければ作る（台本が途中で止まった空の文書など）
    if (!this.doc.allLayers().some((x) => !x.isGroup)) this.addLayer();
    const l = this.doc.paintTarget();
    if (!l) {
      this.toast("フォルダーには直接描けません。中のレイヤーを選んでください", "warn");
      return null;
    }
    if (l.props.locked) {
      this.toast("このレイヤーはロックされています", "warn");
      return null;
    }
    if (target === "mask" && !l.maskTex) return null;
    if (l.kind === "text" && target === "color") this.rasterize(l);
    return l;
  }

  rasterize(l: Layer): void {
    if (l.kind !== "text") return;
    this.structOp("テキストを画像に変換", () => {
      l.kind = "raster";
      l.text = null;
    });
    this.toast("テキストレイヤーを画像に変換しました（元に戻すと文字に戻ります）");
  }

  symmetryFn(): SymmetryFn | null {
    const s = this.symmetry;
    if (!s.enabled) return null;
    const cx = s.cx;
    const cy = s.cy;
    if (s.mode === "radial") {
      const n = Math.max(2, Math.min(32, Math.round(s.count)));
      return (d) => {
        const out = [];
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const c = Math.cos(a);
          const sn = Math.sin(a);
          const dx = d.x - cx;
          const dy = d.y - cy;
          out.push({ ...d, x: cx + c * dx - sn * dy, y: cy + sn * dx + c * dy, angle: d.angle + a });
          if (s.mirror) {
            // 線で折り返してから回す
            const mx = -dx;
            out.push({ ...d, x: cx + c * mx - sn * dy, y: cy + sn * mx + c * dy, angle: Math.PI - d.angle + a });
          }
        }
        return out;
      };
    }
    return (d) => {
      const out = [d];
      if (s.mode === "vertical" || s.mode === "both") out.push({ ...d, x: 2 * cx - d.x, angle: Math.PI - d.angle });
      if (s.mode === "horizontal" || s.mode === "both") out.push({ ...d, y: 2 * cy - d.y, angle: -d.angle });
      if (s.mode === "both") out.push({ ...d, x: 2 * cx - d.x, y: 2 * cy - d.y, angle: d.angle + Math.PI });
      return out;
    };
  }

  /** 今の筆の色（0..1）。透明色なら消しゴムとして扱う。 */
  paintColor(): [number, number, number] {
    return hexToRgb(this.colors.main);
  }

  /**
   * 一筆を始める。手順（取り消し）を開き、終わりで閉じる。
   * opts.brush を渡すとその筆で（AI・図形）。stabilize は入力用（AI は 0）。
   */
  beginStroke(s: Sample, opts?: { brush?: BrushSettings; color?: [number, number, number]; stabilize?: number; taper?: boolean; label?: string; keepStep?: boolean; erase?: boolean; seed?: number }): StrokeHandle | null {
    const target = this.doc.editMask ? "mask" : "color";
    const layer = this.paintableLayer(target);
    if (!layer) return null;
    let brush = opts?.brush ?? this.currentBrush();
    if (opts?.erase || (this.colors.transparent && !opts?.brush && brush.engine !== "smudge" && brush.engine !== "blur")) brush = { ...brush, erase: true };
    if (brush.erase && brush.engine !== "stamp" && brush.engine !== "water") brush = { ...brush, engine: "stamp" };
    if (!this.doc.isVisible(layer)) this.toast("非表示のレイヤーに描いています", "warn");
    const color = opts?.color ?? this.paintColor();
    if (!opts?.keepStep) this.hist.begin(opts?.label ?? brush.name);
    let session: StrokeSession;
    try {
      session = new StrokeSession(
        { doc: this.doc, comp: this.comp, br: this.br, hist: this.hist, grain: (id) => this.tex.grains.get(id as never) ?? null },
        layer,
        brush,
        color,
        { target, pressureGamma: opts?.brush ? 1 : this.pressureGamma, taper: opts?.taper ?? true, symmetry: this.symmetryFn(), seed: opts?.seed ?? (Math.random() * 1e9) | 0 },
      );
    } catch (e) {
      if (!opts?.keepStep) this.hist.end();
      const m = String((e as Error)?.message ?? e);
      this.toast(/[぀-ヿ一-鿿]/.test(m) ? m : "このレイヤーには描けませんでした", "error");
      return null;
    }
    const stab = new Stabilizer(Math.min(100, (opts?.stabilize ?? brush.stabilize) + this.stabilizeBoost));
    session.begin(stab.push(s));
    this.requestFrame();
    const studio = this;
    let last = s;
    return {
      session,
      add(x: Sample) {
        last = x;
        session.add(stab.push(x));
        studio.requestFrame();
      },
      end() {
        for (const f of stab.flush()) session.add(f);
        session.end();
        if (!opts?.keepStep) studio.hist.end();
        studio.lastStrokeEnd = { x: last.x, y: last.y };
        if (!brush.erase && brush.engine !== "smudge" && brush.engine !== "blur") studio.pushColorHistory(studio.colors.main);
        studio.ev.emit("pixels");
        studio.requestFrame();
      },
      cancel() {
        session.cancel();
        if (!opts?.keepStep) studio.hist.end();
        studio.requestFrame();
      },
    };
  }

  // ---------- 取り消し ----------
  undo(): void {
    const l = this.hist.undo();
    if (l) this.toast(`取り消し: ${l}`);
    this.requestFrame();
  }

  redo(): void {
    const l = this.hist.redo();
    if (l) this.toast(`やり直し: ${l}`);
    this.requestFrame();
  }

  // ---------- 読み出し（スポイト・書き出し） ----------
  /** キャンバス全体（または一部）の合成を RGBA8（乗算済みではない値）で読む。 */
  readComposite(rect?: Rect, withPaper = true, filter?: (l: Layer) => boolean): { data: Uint8ClampedArray<ArrayBuffer>; w: number; h: number } {
    const d = this.doc;
    const r = rect ?? { x: 0, y: 0, w: d.w, h: d.h };
    const out = new Uint8ClampedArray(r.w * r.h * 4);
    const T = this.tile;
    const tmp = this.g.createTex(T, T, "rgba8", "readTmp", { filter: "nearest" });
    for (let y = r.y; y < r.y + r.h; y += T) {
      for (let x = r.x; x < r.x + r.w; x += T) {
        const rr = { x, y, w: Math.min(T, r.x + r.w - x), h: Math.min(T, r.y + r.h - y) };
        // 合成は hiFormat のタイルで作り、RGBA8 へ写して読む
        const hi = this.comp.acquireTile();
        this.comp.composeInto(hi, rr, withPaper, filter);
        this.comp.copyToTile(hi, tmp, { x: 0, y: 0, w: rr.w, h: rr.h });
        this.comp.releaseTile(hi);
        const px = this.g.read(tmp, 0, 0, rr.w, rr.h);
        for (let j = 0; j < rr.h; j++) {
          for (let i = 0; i < rr.w; i++) {
            const s = (j * rr.w + i) * 4;
            const o = ((y - r.y + j) * r.w + (x - r.x + i)) * 4;
            const a = px[s + 3];
            if (a === 0) continue;
            const k = 255 / a;
            out[o] = px[s] * k;
            out[o + 1] = px[s + 1] * k;
            out[o + 2] = px[s + 2] * k;
            out[o + 3] = a;
          }
        }
      }
    }
    this.g.deleteTex(tmp);
    return { data: out, w: r.w, h: r.h };
  }

  /** 1 画素の色（表示の合成から）。 */
  pick(x: number, y: number, sample: "canvas" | "layer" = "canvas"): string | null {
    const d = this.doc;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= d.w || iy >= d.h) return null;
    let px: Uint8ClampedArray | Uint8Array;
    if (sample === "layer") {
      const l = d.paintTarget();
      if (!l?.tex) return null;
      const raw = this.g.read(l.tex, ix, iy, 1, 1);
      if (raw[3] === 0) return null;
      const k = 255 / raw[3];
      px = new Uint8ClampedArray([raw[0] * k, raw[1] * k, raw[2] * k, raw[3]]);
    } else {
      px = this.readComposite({ x: ix, y: iy, w: 1, h: 1 }, true).data;
      if (px[3] === 0) return null;
    }
    return "#" + [px[0], px[1], px[2]].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  }

  /** 表示中の合成（用紙込み）を縮めた画像。ナビゲーターや AI に見せる用（GPU で縮めるので軽い）。 */
  previewImage(maxSize: number): ImageData {
    this.comp.update();
    return this.shrinkTex(this.comp.comp, maxSize);
  }

  private shrinkTex(src: Tex, maxSize: number): ImageData {
    const d = this.doc;
    const s = Math.min(1, maxSize / Math.max(d.w, d.h));
    const tw = Math.max(1, Math.round(d.w * s));
    const th = Math.max(1, Math.round(d.h * s));
    const tmp = this.g.createTex(tw, th, "rgba8", "shrink", { filter: "nearest" });
    const prog = this.thumbProg();
    this.g.target(tmp);
    this.g.blend("none");
    prog.use();
    prog.f("u_rect", 0, 0, tw, th).f("u_tsize", tw, th);
    prog.t("u_src", src).f("u_scale", d.w / tw, d.h / th);
    this.g.drawQuad();
    const raw = this.g.read(tmp, 0, 0, tw, th);
    this.g.deleteTex(tmp);
    const img = new ImageData(tw, th);
    for (let i = 0; i < tw * th; i++) {
      const a = raw[i * 4 + 3];
      if (a === 0) continue;
      const k = 255 / a;
      img.data[i * 4] = raw[i * 4] * k;
      img.data[i * 4 + 1] = raw[i * 4 + 1] * k;
      img.data[i * 4 + 2] = raw[i * 4 + 2] * k;
      img.data[i * 4 + 3] = a;
    }
    return img;
  }

  /** レイヤーのサムネイル（RGBA・乗算を外した値）。 */
  thumbnail(l: Layer, maxSize: number): ImageData | null {
    const src = l.isGroup ? null : l.tex;
    const d = this.doc;
    const s = Math.min(1, maxSize / Math.max(d.w, d.h));
    const tw = Math.max(1, Math.round(d.w * s));
    const th = Math.max(1, Math.round(d.h * s));
    const tmp = this.g.createTex(tw, th, "rgba8", "thumb", { filter: "nearest" });
    const prog = this.thumbProg();
    this.g.target(tmp);
    this.g.blend("none");
    prog.use();
    prog.f("u_rect", 0, 0, tw, th).f("u_tsize", tw, th);
    let srcTex: Tex;
    let hi: Tex | null = null;
    if (src) srcTex = src;
    else {
      // フォルダーは中身を合成して縮める
      hi = this.g.createTex(d.w, d.h, this.g.hiFormat, "thumbGroup");
      this.g.clear(hi);
      const T = this.tile;
      const only = new Set<string>();
      const add = (x: Layer) => {
        only.add(x.id);
        x.children.forEach(add);
      };
      add(l);
      for (let y = 0; y < d.h; y += T)
        for (let x = 0; x < d.w; x += T) {
          const rr = { x, y, w: Math.min(T, d.w - x), h: Math.min(T, d.h - y) };
          const t = this.comp.acquireTile();
          this.comp.composeInto(t, rr, false, (z) => only.has(z.id));
          this.g.copy(t, hi, 0, 0, rr.w, rr.h, x, y);
          this.comp.releaseTile(t);
        }
      srcTex = hi;
    }
    prog.t("u_src", srcTex).f("u_scale", d.w / tw, d.h / th);
    this.g.drawQuad();
    const raw = this.g.read(tmp, 0, 0, tw, th);
    this.g.deleteTex(tmp);
    this.g.deleteTex(hi);
    const img = new ImageData(tw, th);
    for (let i = 0; i < tw * th; i++) {
      const a = raw[i * 4 + 3];
      if (a === 0) continue;
      const k = 255 / a;
      img.data[i * 4] = raw[i * 4] * k;
      img.data[i * 4 + 1] = raw[i * 4 + 1] * k;
      img.data[i * 4 + 2] = raw[i * 4 + 2] * k;
      img.data[i * 4 + 3] = a;
    }
    return img;
  }

  private _thumb: ReturnType<GL["program"]> | null = null;
  private thumbProg() {
    if (this._thumb) return this._thumb;
    this._thumb = this.g.program(
      "thumb",
      `#version 300 es
layout(location = 0) in vec2 a_pos;
uniform vec4 u_rect;
uniform vec2 u_tsize;
void main() { vec2 p = u_rect.xy + a_pos * u_rect.zw; gl_Position = vec4(p / u_tsize * 2.0 - 1.0, 0.0, 1.0); }`,
      `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec2 u_scale;
out vec4 o;
void main() {
  // 縮小は 4×4 の平均（乗算済みなので平均してよい）
  vec2 base = floor(gl_FragCoord.xy) * u_scale;
  vec2 sz = vec2(textureSize(u_src, 0));
  vec4 acc = vec4(0.0);
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
    vec2 q = base + (vec2(float(i), float(j)) + 0.5) * u_scale / 4.0;
    acc += texture(u_src, q / sz);
  }
  o = acc / 16.0;
}`,
    );
    return this._thumb;
  }

  /** 経過時間（秒）。選択範囲の点線などの動きに使う。 */
  get time(): number {
    return (performance.now() - this.time0) / 1000;
  }

  emit(...t: Topic[]): void {
    this.ev.emit(...t);
  }

  /** 検査・AI 用の小さな状態。 */
  memoryMB(): number {
    return Math.round((this.g.bytes + (this.hist?.bytes ?? 0)) / (1024 * 1024));
  }
}

export function normHex(hex: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1].toLowerCase();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return `#${h}`;
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
