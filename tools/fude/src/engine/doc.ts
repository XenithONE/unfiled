// 文書とレイヤーの木。
import type { GL, Rect, Tex } from "./gl";

export type LayerKind = "raster" | "group" | "text";

export interface LayerProps {
  name: string;
  visible: boolean;
  opacity: number;
  /** 合成モード id。フォルダーは "pass"（通過）も可。 */
  blend: string;
  locked: boolean;
  alphaLock: boolean;
  clip: boolean;
  isRef: boolean;
  isDraft: boolean;
  expanded: boolean;
  /** レイヤーマスクがあるか（テクスチャは一度作ったら残し、取り消しで出し入れする） */
  hasMask: boolean;
  maskEnabled: boolean;
  /** レイヤーカラー（線を青鉛筆のように見せる）。null で無効。 */
  tint: string | null;
}

export interface TextProps {
  text: string;
  x: number;
  y: number;
  size: number;
  font: string;
  color: string;
  vertical: boolean;
  bold: boolean;
  italic: boolean;
  lineHeight: number;
  letterSpacing: number;
  align: "start" | "center" | "end";
  strokeWidth: number;
  strokeColor: string;
}

export function defaultProps(name: string, kind: LayerKind): LayerProps {
  return {
    name,
    visible: true,
    opacity: 1,
    blend: kind === "group" ? "pass" : "normal",
    locked: false,
    alphaLock: false,
    clip: false,
    isRef: false,
    isDraft: false,
    expanded: true,
    hasMask: false,
    maskEnabled: true,
    tint: null,
  };
}

let idCounter = 0;
export function newId(prefix = "L"): string {
  idCounter++;
  return `${prefix}${Date.now().toString(36).slice(-4)}${idCounter.toString(36)}`;
}

export class Layer {
  id: string;
  kind: LayerKind;
  props: LayerProps;
  tex: Tex | null = null;
  mask: Tex | null = null;
  children: Layer[] = [];
  parent: Layer | null = null;
  text: TextProps | null = null;
  /** 中身のおおよその範囲（合成の省略用）。null は空。 */
  bounds: Rect | null = null;
  /** 画素が変わるたびに増える（サムネイル・自動保存の目印）。 */
  version = 0;
  constructor(kind: LayerKind, name: string, id?: string) {
    this.id = id ?? newId(kind === "group" ? "G" : "L");
    this.kind = kind;
    this.props = defaultProps(name, kind);
  }
  get isGroup(): boolean {
    return this.kind === "group";
  }
  /** 有効なマスク（無ければ null）。 */
  get maskTex(): Tex | null {
    return this.props.hasMask ? this.mask : null;
  }
  touch(rect: Rect | null): void {
    this.version++;
    if (!rect) return;
    if (!this.bounds) this.bounds = { ...rect };
    else {
      const x0 = Math.min(this.bounds.x, rect.x);
      const y0 = Math.min(this.bounds.y, rect.y);
      const x1 = Math.max(this.bounds.x + this.bounds.w, rect.x + rect.w);
      const y1 = Math.max(this.bounds.y + this.bounds.h, rect.y + rect.h);
      this.bounds = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
  }
}

export interface TreeSnap {
  id: string;
  props: LayerProps;
  text: TextProps | null;
  children: TreeSnap[];
}

export class Doc {
  readonly w: number;
  readonly h: number;
  readonly gl: GL;
  root: Layer;
  paper = { color: "#ffffff", visible: true };
  activeId = "";
  /** マスクを編集中か（レイヤーマスクのサムネイルを選んだ状態）。 */
  editMask = false;
  /** 選択範囲（R8・キャンバスと同寸）。null は「選択なし」。 */
  selection: Tex | null = null;
  selBounds: Rect | null = null;
  /** 取り消しの記録が参照するレイヤーもここに残る。 */
  readonly registry = new Map<string, Layer>();
  name = "無題";
  docId: string;
  created = Date.now();

  constructor(gl: GL, w: number, h: number, docId?: string) {
    this.gl = gl;
    this.w = w;
    this.h = h;
    this.docId = docId ?? newId("D");
    this.root = new Layer("group", "root", "root");
    this.registry.set(this.root.id, this.root);
  }

  get active(): Layer | null {
    return this.registry.get(this.activeId) ?? null;
  }

  find(id: string): Layer | null {
    const l = this.registry.get(id);
    return l && this.isLive(l) ? l : null;
  }

  isLive(l: Layer): boolean {
    let p: Layer | null = l;
    while (p) {
      if (p === this.root) return true;
      p = p.parent;
    }
    return false;
  }

  findByName(name: string): Layer | null {
    let hit: Layer | null = null;
    this.walk((l) => {
      if (!hit && l.props.name === name) hit = l;
    });
    return hit;
  }

  /** 上から下の順ではなく、木の下（奥）から上（手前）の順で全部たどる。 */
  walk(fn: (l: Layer, depth: number) => void, node: Layer = this.root, depth = 0): void {
    for (const c of node.children) {
      fn(c, depth);
      if (c.isGroup) this.walk(fn, c, depth + 1);
    }
  }

  allLayers(): Layer[] {
    const out: Layer[] = [];
    this.walk((l) => out.push(l));
    return out;
  }

  createRaster(name: string): Layer {
    const l = new Layer("raster", name);
    l.tex = this.gl.createTex(this.w, this.h, "rgba8", `layer:${name}`);
    this.gl.clear(l.tex);
    this.registry.set(l.id, l);
    return l;
  }

  createGroup(name: string): Layer {
    const l = new Layer("group", name);
    this.registry.set(l.id, l);
    return l;
  }

  createText(name: string, text: TextProps): Layer {
    const l = new Layer("text", name);
    l.text = { ...text };
    l.tex = this.gl.createTex(this.w, this.h, "rgba8", `text:${name}`);
    this.gl.clear(l.tex);
    this.registry.set(l.id, l);
    return l;
  }

  /** parent の index 番目（0 = 一番下）に入れる。 */
  insert(l: Layer, parent: Layer, index: number): void {
    if (l.parent) this.detach(l);
    const i = Math.max(0, Math.min(parent.children.length, index));
    parent.children.splice(i, 0, l);
    l.parent = parent;
  }

  /** 選択中のレイヤーのすぐ上に入れる。 */
  insertAboveActive(l: Layer): void {
    const a = this.active;
    if (a && a.parent) {
      if (a.isGroup && a.props.expanded) this.insert(l, a, a.children.length);
      else this.insert(l, a.parent, a.parent.children.indexOf(a) + 1);
    } else this.insert(l, this.root, this.root.children.length);
  }

  detach(l: Layer): void {
    const p = l.parent;
    if (!p) return;
    const i = p.children.indexOf(l);
    if (i >= 0) p.children.splice(i, 1);
    l.parent = null;
  }

  snapshot(node: Layer = this.root): TreeSnap {
    return {
      id: node.id,
      props: { ...node.props },
      text: node.text ? { ...node.text } : null,
      children: node.children.map((c) => this.snapshot(c)),
    };
  }

  restore(s: TreeSnap): void {
    const build = (snap: TreeSnap, parent: Layer | null): Layer => {
      const l = this.registry.get(snap.id);
      if (!l) throw new Error(`restore: layer ${snap.id} missing`);
      l.props = { ...snap.props };
      l.text = snap.text ? { ...snap.text } : null;
      l.parent = parent;
      l.children = snap.children.map((c) => build(c, l));
      return l;
    };
    build(s, null);
    if (!this.find(this.activeId)) {
      const all = this.allLayers().filter((x) => !x.isGroup);
      this.activeId = all.length ? all[all.length - 1].id : this.allLayers()[0]?.id ?? "";
    }
  }

  /** 木の中にもう居ず、取り消しにも使われないレイヤーの GPU 資源を捨てる。 */
  freeLayer(l: Layer): void {
    this.gl.deleteTex(l.tex);
    this.gl.deleteTex(l.mask);
    l.tex = null;
    l.mask = null;
    this.registry.delete(l.id);
  }

  dispose(): void {
    for (const l of this.registry.values()) {
      this.gl.deleteTex(l.tex);
      this.gl.deleteTex(l.mask);
    }
    this.registry.clear();
    this.gl.deleteTex(this.selection);
    this.selection = null;
  }

  /** 選択中のレイヤーのうち、描き込めるもの（ラスター／テキスト）。 */
  paintTarget(): Layer | null {
    const a = this.active;
    if (!a || a.isGroup) return null;
    return a;
  }

  /** そのレイヤーが実際に見えているか（親のフォルダーも含めて）。 */
  isVisible(l: Layer): boolean {
    let p: Layer | null = l;
    while (p && p !== this.root) {
      if (!p.props.visible) return false;
      p = p.parent;
    }
    return true;
  }

  /** 一覧（UI 用）: 上（手前）から下の順・深さつき。畳んだフォルダーの中身は省く。 */
  listForPanel(): { layer: Layer; depth: number }[] {
    const out: { layer: Layer; depth: number }[] = [];
    const rec = (node: Layer, depth: number) => {
      for (let i = node.children.length - 1; i >= 0; i--) {
        const c = node.children[i];
        out.push({ layer: c, depth });
        if (c.isGroup && c.props.expanded) rec(c, depth + 1);
      }
    };
    rec(this.root, 0);
    return out;
  }
}
