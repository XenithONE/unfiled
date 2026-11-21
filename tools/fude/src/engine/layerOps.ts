// レイヤーの画素をまとめて扱う操作（結合・統合・マスク・消去・塗り・反転）。
import { BLEND_GLSL } from "./blend";
import { hexToRgb } from "./compositor";
import type { Layer } from "./doc";
import type { Program, Rect, Tex } from "./gl";
import { HEADER, RECT_VS } from "./shaders";
import type { Studio } from "./studio";

const PIX_FS = `${HEADER}
uniform sampler2D u_layer;
uniform sampler2D u_sel;
uniform int u_hasSel;
uniform int u_op;
uniform vec4 u_color;
uniform int u_alphaLock;
uniform int u_flip;
uniform vec2 u_size;
out vec4 o;
${BLEND_GLSL}
void main() {
  ivec2 cp = ivec2(gl_FragCoord.xy);
  float m = u_hasSel == 1 ? texelFetch(u_sel, cp, 0).r : 1.0;
  if (u_op == 2) {
    // 反転（選択範囲なしの全体）
    ivec2 q = cp;
    if (u_flip == 0) q.x = int(u_size.x) - 1 - cp.x;
    else q.y = int(u_size.y) - 1 - cp.y;
    o = texelFetch(u_layer, q, 0);
    return;
  }
  vec4 L = texelFetch(u_layer, cp, 0);
  if (u_op == 0) {
    o = L * (1.0 - m);
  } else if (u_op == 3) {
    // マスク用: m を掛ける（マスクの適用）
    o = L * texelFetch(u_sel, cp, 0).r;
  } else {
    vec4 S = vec4(u_color.rgb, 1.0) * u_color.a * m;
    o = u_alphaLock == 1 ? blendAtop(L, S, 0) : blendOver(L, S, 0);
  }
}
`;

let prog: Program | null = null;
function pixProg(s: Studio): Program {
  if (!prog) prog = s.g.program("pixop", RECT_VS, PIX_FS);
  return prog;
}

/** 全面の画素処理を、取り消しを保存しながら行う（tmp に描いてから写し戻す）。 */
function pixelPass(s: Studio, l: Layer, channel: "color" | "mask", rect: Rect, setup: (p: Program) => void): void {
  const g = s.g;
  const tex = channel === "mask" ? l.maskTex : l.tex;
  if (!tex) return;
  s.hist.save(l, channel, rect);
  const tmp = g.createTex(s.doc.w, s.doc.h, tex.format, "pixTmp", { filter: "nearest" });
  g.target(tmp, rect);
  g.blend("none");
  const p = pixProg(s).use();
  p.f("u_rect", 0, 0, s.doc.w, s.doc.h).f("u_tsize", s.doc.w, s.doc.h);
  p.t("u_layer", tex).f("u_size", s.doc.w, s.doc.h);
  p.t("u_sel", s.doc.selection ?? tex).i("u_hasSel", s.doc.selection ? 1 : 0);
  setup(p);
  g.drawQuad();
  g.gl.disable(g.gl.SCISSOR_TEST);
  g.copy(tmp, tex, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y);
  g.deleteTex(tmp);
  l.touch(rect);
  s.comp.mark(rect);
}

function selRect(s: Studio): Rect {
  const d = s.doc;
  return d.selection && d.selBounds ? d.selBounds : { x: 0, y: 0, w: d.w, h: d.h };
}

/** 選択範囲（なければ全体）を消す。 */
export function clearArea(s: Studio): void {
  const l = s.paintableLayer();
  if (!l) return;
  const ch = s.doc.editMask ? "mask" : "color";
  s.hist.begin("消去");
  pixelPass(s, l, ch, selRect(s), (p) => {
    if (ch === "mask") p.i("u_op", 1).fv("u_color", new Float32Array([0, 0, 0, 1]));
    p.i("u_op", ch === "mask" ? 0 : 0);
  });
  s.hist.end();
  s.emit("pixels");
  s.requestFrame();
}

/** 選択範囲（なければ全体）を色で塗る。 */
export function fillArea(s: Studio, hex: string, opacity = 1): void {
  const l = s.paintableLayer();
  if (!l) return;
  const ch = s.doc.editMask ? "mask" : "color";
  const c = ch === "mask" ? [1, 1, 1] : hexToRgb(hex);
  s.hist.begin("塗りつぶし");
  pixelPass(s, l, ch, selRect(s), (p) => {
    p.i("u_op", 1).fv("u_color", new Float32Array([c[0], c[1], c[2], opacity])).i("u_alphaLock", l.props.alphaLock && ch === "color" ? 1 : 0);
  });
  s.hist.end();
  s.emit("pixels");
  s.requestFrame();
}

export function flipLayer(s: Studio, axis: "h" | "v"): void {
  const l = s.paintableLayer();
  if (!l) return;
  const d = s.doc;
  s.hist.begin(axis === "h" ? "左右反転" : "上下反転");
  for (const ch of ["color", "mask"] as const) {
    if (ch === "mask" && !l.maskTex) continue;
    pixelPass(s, l, ch, { x: 0, y: 0, w: d.w, h: d.h }, (p) => p.i("u_op", 2).i("u_flip", axis === "h" ? 0 : 1).i("u_hasSel", 0));
  }
  if (l.bounds) l.bounds = axis === "h" ? { ...l.bounds, x: d.w - l.bounds.x - l.bounds.w } : { ...l.bounds, y: d.h - l.bounds.y - l.bounds.h };
  s.hist.end();
  s.emit("pixels");
  s.requestFrame();
}

/** 下のレイヤーと結合。 */
export function mergeDown(s: Studio, id?: string): void {
  const d = s.doc;
  const a = d.find(id ?? d.activeId);
  if (!a || !a.parent) return;
  const sib = a.parent.children;
  const i = sib.indexOf(a);
  const b = sib[i - 1];
  if (!b || b.isGroup || a.isGroup || !b.tex) {
    s.toast("下に結合できるレイヤーがありません（フォルダーは先に結合してください）", "warn");
    return;
  }
  if (b.props.locked) {
    s.toast("下のレイヤーがロックされています", "warn");
    return;
  }
  s.hist.begin("下のレイヤーと結合");
  s.hist.struct();
  const rect = { x: 0, y: 0, w: d.w, h: d.h };
  writeComposed(s, b, [b, a], rect, true);
  d.detach(a);
  d.activeId = b.id;
  s.hist.end();
  s.emitLayers();
  s.emit("pixels");
}

/** layers を重ねた結果を target のテクスチャへ書く（取り消し保存つき）。 */
function writeComposed(s: Studio, target: Layer, layers: Layer[], area: Rect, plainFirst: boolean): void {
  const T = s.tile;
  s.hist.save(target, "color", area);
  for (let y = area.y; y < area.y + area.h; y += T) {
    for (let x = area.x; x < area.x + area.w; x += T) {
      const r = { x, y, w: Math.min(T, area.x + area.w - x), h: Math.min(T, area.y + area.h - y) };
      const tile = s.comp.composeLayers(layers, r, { plainFirst });
      s.comp.writeTile(tile, r, target.tex!);
      s.comp.releaseTile(tile);
    }
  }
  target.touch(area);
}

/** 見えているレイヤーを 1 枚にしたコピーを一番上に作る（元はそのまま）。 */
export function mergeVisibleCopy(s: Studio): void {
  const d = s.doc;
  s.hist.begin("表示レイヤーのコピーを結合");
  s.hist.struct();
  const l = d.createRaster("結合したレイヤー");
  const T = s.tile;
  for (let y = 0; y < d.h; y += T)
    for (let x = 0; x < d.w; x += T) {
      const r = { x, y, w: Math.min(T, d.w - x), h: Math.min(T, d.h - y) };
      const tile = s.comp.acquireTile();
      s.comp.composeInto(tile, r, false);
      s.comp.writeTile(tile, r, l.tex!);
      s.comp.releaseTile(tile);
    }
  l.touch({ x: 0, y: 0, w: d.w, h: d.h });
  d.insert(l, d.root, d.root.children.length);
  d.activeId = l.id;
  s.hist.end();
  s.emitLayers();
}

/** 画像を統合（全レイヤーを 1 枚に・用紙も含める）。 */
export function flatten(s: Studio): void {
  const d = s.doc;
  s.hist.begin("画像を統合");
  s.hist.struct();
  const l = d.createRaster("背景");
  const T = s.tile;
  for (let y = 0; y < d.h; y += T)
    for (let x = 0; x < d.w; x += T) {
      const r = { x, y, w: Math.min(T, d.w - x), h: Math.min(T, d.h - y) };
      const tile = s.comp.acquireTile();
      s.comp.composeInto(tile, r, true);
      s.comp.writeTile(tile, r, l.tex!);
      s.comp.releaseTile(tile);
    }
  l.touch({ x: 0, y: 0, w: d.w, h: d.h });
  for (const c of [...d.root.children]) d.detach(c);
  d.insert(l, d.root, 0);
  d.paper.visible = false;
  d.activeId = l.id;
  s.hist.end();
  s.emitLayers();
}

/** レイヤーマスクを作る（選択範囲があればその形で）。 */
export function addMask(s: Studio, id?: string, hideAll = false): void {
  const d = s.doc;
  const l = d.find(id ?? d.activeId);
  if (!l) return;
  if (l.props.hasMask) {
    s.toast("すでにマスクがあります", "warn");
    return;
  }
  s.hist.begin("レイヤーマスクを作成");
  s.hist.struct();
  if (!l.mask) l.mask = s.g.createTex(d.w, d.h, "r8", "mask", { filter: "nearest" });
  l.props.hasMask = true;
  l.props.maskEnabled = true;
  s.hist.save(l, "mask", { x: 0, y: 0, w: d.w, h: d.h });
  if (d.selection) s.g.copy(d.selection, l.mask, 0, 0, d.w, d.h, 0, 0);
  else s.g.clear(l.mask, hideAll ? 0 : 1, 0, 0, 1);
  l.touch(null);
  d.editMask = true;
  s.hist.end();
  s.emitLayers();
}

export function deleteMask(s: Studio, id?: string, apply = false): void {
  const d = s.doc;
  const l = d.find(id ?? d.activeId);
  if (!l || !l.maskTex) return;
  s.hist.begin(apply ? "マスクを適用" : "マスクを削除");
  s.hist.struct();
  if (apply && l.tex) {
    const mask = l.maskTex;
    s.hist.save(l, "color", { x: 0, y: 0, w: d.w, h: d.h });
    const tmp = s.g.createTex(d.w, d.h, "rgba8", "applyMask", { filter: "nearest" });
    s.g.target(tmp);
    const p = pixProg(s).use();
    p.f("u_rect", 0, 0, d.w, d.h).f("u_tsize", d.w, d.h).t("u_layer", l.tex).t("u_sel", mask).i("u_hasSel", 1).i("u_op", 3);
    s.g.drawQuad();
    s.g.copy(tmp, l.tex, 0, 0, d.w, d.h, 0, 0);
    s.g.deleteTex(tmp);
  }
  l.props.hasMask = false;
  d.editMask = false;
  l.touch({ x: 0, y: 0, w: d.w, h: d.h });
  s.hist.end();
  s.emitLayers();
  s.emit("pixels");
}

/** 新しいレイヤーに画像（ImageBitmap など）を置く。 */
export function addImageLayer(s: Studio, img: CanvasImageSource & { width: number; height: number }, name: string, place?: { x: number; y: number; w: number; h: number }, opacity = 1): Layer {
  const d = s.doc;
  return s.structOp("画像を読み込む", () => {
    const l = d.createRaster(name);
    const c = document.createElement("canvas");
    c.width = d.w;
    c.height = d.h;
    const ctx = c.getContext("2d")!;
    const iw = img.width;
    const ih = img.height;
    let r = place;
    if (!r) {
      const k = Math.min(1, d.w / iw, d.h / ih);
      r = { w: iw * k, h: ih * k, x: (d.w - iw * k) / 2, y: (d.h - ih * k) / 2 };
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, r.x, r.y, r.w, r.h);
    s.g.deleteTex(l.tex);
    l.tex = s.g.texFromImage(c, d.w, d.h, `layer:${name}`);
    l.props.opacity = opacity;
    l.touch({ x: Math.floor(r.x), y: Math.floor(r.y), w: Math.ceil(r.w) + 1, h: Math.ceil(r.h) + 1 });
    d.insertAboveActive(l);
    d.activeId = l.id;
    return l;
  });
}

export function layerTexOrNull(l: Layer | null): Tex | null {
  return l?.tex ?? null;
}
