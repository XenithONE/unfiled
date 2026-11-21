// レイヤーの合成。汚れた矩形だけをタイル（T×T）単位で合成し直し、結果を comp（全面）へ写す。
import { blendIndex } from "./blend";
import type { Doc, Layer } from "./doc";
import type { GL, Program, Rect, Tex } from "./gl";
import { rectClip, rectIntersects, rectUnion } from "./gl";
import { COMP_FS, COPY_FS, LERP_FS, RECT_VS } from "./shaders";

/** レイヤーの中身を差し替えて見せる（描画中の筆跡・フィルターの試し・変形の試し）。 */
export type ContentFn = (dst: Tex, rect: Rect) => void;

interface Pair {
  a: Tex;
  b: Tex;
}

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [0, 0, 0];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export class Compositor {
  private g: GL;
  doc: Doc;
  readonly T: number;
  comp: Tex;
  private free: Tex[] = [];
  private all: Tex[] = [];
  private dirty: Rect | null = null;
  readonly overrides = new Map<string, ContentFn>();
  readonly maskOverrides = new Map<string, ContentFn>();
  private compProg: Program;
  private copyProg: Program;
  private lerpProg: Program;
  mipsDirty = true;
  /** 直近の合成にかかった時間（ms）。 */
  lastMs = 0;
  /** 合成の中から呼ばれる、レイヤーの描画を避ける判定（下描き・非表示など）。 */
  skip: ((l: Layer) => boolean) | null = null;

  constructor(g: GL, doc: Doc, tile: number) {
    this.g = g;
    this.doc = doc;
    this.T = tile;
    this.comp = g.createTex(doc.w, doc.h, g.hiFormat, "composite");
    this.compProg = g.program("comp", RECT_VS, COMP_FS);
    this.copyProg = g.program("copy", RECT_VS, COPY_FS);
    this.lerpProg = g.program("lerp", RECT_VS, LERP_FS);
    this.markAll();
  }

  dispose(): void {
    this.g.deleteTex(this.comp);
    for (const t of this.all) this.g.deleteTex(t);
    this.all = [];
    this.free = [];
  }

  markAll(): void {
    this.dirty = { x: 0, y: 0, w: this.doc.w, h: this.doc.h };
  }

  mark(r: Rect | null): void {
    if (!r) return;
    const c = rectClip(r, this.doc.w, this.doc.h);
    if (c) this.dirty = rectUnion(this.dirty, c);
  }

  get isDirty(): boolean {
    return this.dirty !== null;
  }

  private acquire(): Tex {
    const t = this.free.pop();
    if (t) return t;
    const n = this.g.createTex(this.T, this.T, this.g.hiFormat, "compTile", { filter: "nearest" });
    this.all.push(n);
    return n;
  }

  private release(t: Tex): void {
    this.free.push(t);
  }

  private pair(clear: [number, number, number, number] | null, rect: Rect): Pair {
    const p = { a: this.acquire(), b: this.acquire() };
    if (clear) this.g.clear(p.a, clear[0], clear[1], clear[2], clear[3], { x: 0, y: 0, w: rect.w, h: rect.h });
    return p;
  }

  private releasePair(p: Pair): void {
    this.release(p.a);
    this.release(p.b);
  }

  /** 汚れた所を合成し直す。何かしたら true。 */
  update(): boolean {
    if (!this.dirty) return false;
    const t0 = performance.now();
    const d = this.dirty;
    this.dirty = null;
    const T = this.T;
    for (let y = d.y; y < d.y + d.h; y += T) {
      for (let x = d.x; x < d.x + d.w; x += T) {
        const r: Rect = { x, y, w: Math.min(T, d.x + d.w - x), h: Math.min(T, d.y + d.h - y) };
        this.composeRect(r);
      }
    }
    this.mipsDirty = true;
    this.lastMs = performance.now() - t0;
    return true;
  }

  /** rect の合成結果を作って comp へ写す。 */
  private composeRect(rect: Rect): void {
    const paper = this.doc.paper;
    const bg: [number, number, number, number] = paper.visible ? [...hexToRgb(paper.color), 1] : [0, 0, 0, 0];
    const p = this.pair(bg, rect);
    this.composeList(this.doc.root.children, p, rect);
    this.g.copy(p.a, this.comp, 0, 0, rect.w, rect.h, rect.x, rect.y);
    this.releasePair(p);
  }

  /** rect の合成結果だけを（用紙なしで）dst へ。書き出しやスポイト用。 */
  composeInto(dst: Tex, rect: Rect, withPaper: boolean, filter?: (l: Layer) => boolean): void {
    const paper = this.doc.paper;
    const bg: [number, number, number, number] = withPaper && paper.visible ? [...hexToRgb(paper.color), 1] : [0, 0, 0, 0];
    const p = this.pair(bg, rect);
    const prev = this.skip;
    if (filter) this.skip = (l) => (prev ? prev(l) : false) || !filter(l);
    this.composeList(this.doc.root.children, p, rect);
    this.skip = prev;
    this.g.copy(p.a, dst, 0, 0, rect.w, rect.h, 0, 0);
    this.releasePair(p);
  }

  private visible(l: Layer): boolean {
    if (!l.props.visible || l.props.opacity <= 0) return false;
    if (this.skip && !l.isGroup && this.skip(l)) return false;
    return true;
  }

  private composeList(children: Layer[], p: Pair, rect: Rect): void {
    let i = 0;
    while (i < children.length) {
      const base = children[i];
      let j = i + 1;
      const clipped: Layer[] = [];
      while (j < children.length && children[j].props.clip) {
        clipped.push(children[j]);
        j++;
      }
      i = j;
      if (!this.visible(base)) continue;
      const vis = clipped.filter((c) => this.visible(c));
      if (!vis.length) {
        this.layerOnto(p, base, rect, false);
        continue;
      }
      // クリッピング: 土台の中身を透明なタイルに作り、その上へ atop で重ね、最後に土台の合成モードで重ねる
      const bp = this.pair([0, 0, 0, 0], rect);
      if (base.isGroup) {
        this.composeList(base.children, bp, rect);
      } else {
        this.layerOnto(bp, base, rect, false, true);
      }
      for (const c of vis) this.layerOnto(bp, c, rect, true);
      // 土台のマスクは最後にまとめて掛ける（atop は土台の不透明度に比例するので結果は同じ）
      this.blendTile(p, bp.a, rect, base.props.blend === "pass" ? 0 : blendIndex(base.props.blend), base.props.opacity, this.maskFor(base, rect), false, null);
      this.releasePair(bp);
    }
  }

  /** マスク（キャンバス全面の R8）。描画中のマスクの差し替えがあればタイルに描いて返す。 */
  private maskFor(l: Layer, rect: Rect): { tex: Tex; off: [number, number]; tmp: Tex | null } | null {
    if (!l.maskTex || !l.props.maskEnabled) return null;
    const mov = this.maskOverrides.get(l.id);
    if (mov) {
      const t = this.acquire();
      mov(t, rect);
      return { tex: t, off: [0, 0], tmp: t };
    }
    return { tex: l.maskTex, off: [rect.x, rect.y], tmp: null };
  }

  /**
   * レイヤー l を p へ重ねる。atop はクリッピングの重ね方。
   * plain は「中身だけ」（不透明度 1・通常）で置く（クリッピングの土台用）。
   */
  private layerOnto(p: Pair, l: Layer, rect: Rect, atop: boolean, plain = false): void {
    if (l.isGroup) {
      // 通過（マスクなし）: 中身をそのまま重ねる。不透明度があれば元の絵と混ぜる。マスクありは分離して重ねる。
      if (l.props.blend === "pass" && !atop && !plain && !(l.maskTex && l.props.maskEnabled)) {
        if (l.props.opacity >= 0.999) {
          this.composeList(l.children, p, rect);
          return;
        }
        const cp = this.pair(null, rect);
        this.copyTile(p.a, cp.a, rect);
        this.composeList(l.children, cp, rect);
        this.lerpTile(p, cp.a, rect, l.props.opacity);
        this.releasePair(cp);
        return;
      }
      const gp = this.pair([0, 0, 0, 0], rect);
      this.composeList(l.children, gp, rect);
      const mode = plain || l.props.blend === "pass" ? 0 : blendIndex(l.props.blend);
      const mask = plain ? null : this.maskFor(l, rect);
      this.blendTile(p, gp.a, rect, mode, plain ? 1 : l.props.opacity, mask, atop, null);
      if (mask?.tmp) this.release(mask.tmp);
      this.releasePair(gp);
      return;
    }
    const ov = this.overrides.get(l.id);
    const hasMov = this.maskOverrides.has(l.id);
    if (!ov && !hasMov && (!l.bounds || !rectIntersects(l.bounds, rect))) return;
    if (!l.tex) return;
    let srcTex: Tex = l.tex;
    let srcOff: [number, number] = [rect.x, rect.y];
    let tmp: Tex | null = null;
    if (ov) {
      tmp = this.acquire();
      ov(tmp, rect);
      srcTex = tmp;
      srcOff = [0, 0];
    }
    const mask = plain ? null : this.maskFor(l, rect);
    const tint = l.props.tint ? hexToRgb(l.props.tint) : null;
    this.blendTile(p, srcTex, rect, plain ? 0 : blendIndex(l.props.blend), plain ? 1 : l.props.opacity, mask, atop, tint, srcOff);
    if (tmp) this.release(tmp);
    if (mask?.tmp) this.release(mask.tmp);
  }

  private blendTile(p: Pair, src: Tex, rect: Rect, mode: number, opacity: number, mask: { tex: Tex; off: [number, number] } | null, atop: boolean, tint: [number, number, number] | null, srcOff: [number, number] = [0, 0]): void {
    const g = this.g;
    const gl = g.gl;
    g.target(p.b);
    g.blend("none");
    const pr = this.compProg.use();
    pr.f("u_rect", 0, 0, rect.w, rect.h).f("u_tsize", this.T, this.T);
    pr.t("u_dst", p.a).t("u_src", src);
    gl.uniform2i(pr.loc("u_srcOff"), srcOff[0], srcOff[1]);
    pr.t("u_mask", mask ? mask.tex : src).i("u_hasMask", mask ? 1 : 0);
    gl.uniform2i(pr.loc("u_maskOff"), mask ? mask.off[0] : 0, mask ? mask.off[1] : 0);
    pr.i("u_mode", mode).f("u_opacity", opacity).i("u_atop", atop ? 1 : 0);
    pr.i("u_tint", tint ? 1 : 0).f("u_tintColor", ...(tint ?? [0, 0, 0]));
    g.drawQuad();
    const t = p.a;
    p.a = p.b;
    p.b = t;
  }

  private copyTile(src: Tex, dst: Tex, rect: Rect): void {
    this.g.copy(src, dst, 0, 0, rect.w, rect.h, 0, 0);
  }

  private lerpTile(p: Pair, other: Tex, rect: Rect, t: number): void {
    const g = this.g;
    g.target(p.b);
    g.blend("none");
    const pr = this.lerpProg.use();
    pr.f("u_rect", 0, 0, rect.w, rect.h).f("u_tsize", this.T, this.T);
    pr.t("u_a", p.a).t("u_b", other).f("u_t", t);
    g.drawQuad();
    const x = p.a;
    p.a = p.b;
    p.b = x;
  }

  /** src（キャンバス全面）を、rect の範囲だけタイルへ写す小道具（外から使う）。 */
  copyToTile(src: Tex, dst: Tex, rect: Rect): void {
    const g = this.g;
    g.target(dst);
    g.blend("none");
    const pr = this.copyProg.use();
    pr.f("u_rect", 0, 0, rect.w, rect.h).f("u_tsize", dst.w, dst.h);
    pr.t("u_src", src);
    g.gl.uniform2i(pr.loc("u_off"), rect.x, rect.y);
    g.drawQuad();
  }

  /** 決まったレイヤーの並び（下から）だけを透明な下地に重ね、結果のタイルを返す（呼んだ側が releaseTile）。 */
  composeLayers(layers: Layer[], rect: Rect, opts?: { plainFirst?: boolean }): Tex {
    const p = this.pair([0, 0, 0, 0], rect);
    layers.forEach((l, i) => {
      if (!this.visible(l) && !(i === 0 && opts?.plainFirst)) return;
      if (i === 0 && opts?.plainFirst) {
        if (l.isGroup) this.composeList(l.children, p, rect);
        else this.layerOnto(p, l, rect, false, true);
      } else this.layerOnto(p, l, rect, l.props.clip && i > 0);
    });
    this.release(p.b);
    return p.a;
  }

  /** タイル（hiFormat）の (0,0,w,h) を、キャンバス全面のテクスチャ dst の rect へ描き込む（形式の変換つき）。 */
  writeTile(tile: Tex, rect: Rect, dst: Tex): void {
    const g = this.g;
    g.target(dst, rect);
    g.blend("none");
    const pr = this.copyProg.use();
    pr.f("u_rect", rect.x, rect.y, rect.w, rect.h).f("u_tsize", dst.w, dst.h);
    pr.t("u_src", tile);
    g.gl.uniform2i(pr.loc("u_off"), -rect.x, -rect.y);
    g.drawQuad();
    g.gl.disable(g.gl.SCISSOR_TEST);
  }

  acquireTile(): Tex {
    return this.acquire();
  }

  releaseTile(t: Tex): void {
    this.release(t);
  }
}
