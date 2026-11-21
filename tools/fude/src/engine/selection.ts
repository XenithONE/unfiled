// 選択範囲の操作。中身は R8 のテクスチャ（doc.selection）。計算は CPU で行い、上げ直す。
import { blurMask, dilate, erode, floodMask, maskBounds, type FloodOpts } from "./flood";
import type { Layer } from "./doc";
import type { Rect } from "./gl";
import { rasterPolys, type Poly } from "./raster";
import type { Studio } from "./studio";

export type SelMode = "replace" | "add" | "subtract" | "intersect";

let lastSelection: { data: Uint8Array; w: number; h: number } | null = null;

export function readSelection(s: Studio): Uint8Array | null {
  const d = s.doc;
  if (!d.selection) return null;
  return s.g.read(d.selection);
}

/** 全面のマスクを選択範囲にする（null で解除）。手順の中で呼ぶこと。 */
function write(s: Studio, full: Uint8Array | null): void {
  const d = s.doc;
  const b = full ? maskBounds(full, d.w, d.h) : null;
  if (!full || !b) {
    if (d.selection) {
      const old = readSelection(s);
      if (old) lastSelection = { data: old, w: d.w, h: d.h };
    }
    s.g.deleteTex(d.selection);
    d.selection = null;
    d.selBounds = null;
    return;
  }
  if (!d.selection) d.selection = s.g.createTex(d.w, d.h, "r8", "selection", { filter: "nearest" });
  s.g.upload(d.selection, full);
  d.selBounds = b;
}

function change(s: Studio, label: string, fn: () => void): void {
  s.hist.begin(label);
  s.hist.selection();
  try {
    fn();
  } finally {
    s.hist.end();
    s.emit("selection");
    s.requestFrame();
  }
}

function combine(prev: Uint8Array | null, region: { data: Uint8Array; rect: Rect }, W: number, H: number, mode: SelMode): Uint8Array {
  const out = mode === "replace" || !prev ? new Uint8Array(W * H) : prev.slice();
  const { data, rect } = region;
  if (mode === "intersect") {
    // 範囲の外は消える
    const res = new Uint8Array(W * H);
    if (!prev) return res;
    for (let y = 0; y < rect.h; y++)
      for (let x = 0; x < rect.w; x++) {
        const i = (rect.y + y) * W + rect.x + x;
        res[i] = Math.round((prev[i] * data[y * rect.w + x]) / 255);
      }
    return res;
  }
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const i = (rect.y + y) * W + rect.x + x;
      const v = data[y * rect.w + x];
      if (mode === "subtract") out[i] = Math.round((out[i] * (255 - v)) / 255);
      else out[i] = Math.max(out[i], v);
    }
  }
  return out;
}

export function selectMask(s: Studio, region: { data: Uint8Array; rect: Rect }, mode: SelMode, feather: number, label = "選択範囲"): void {
  const d = s.doc;
  change(s, label, () => {
    let reg = region;
    if (feather > 0) {
      // ぼかし分の余白をつけてからぼかす
      const pad = Math.ceil(feather * 1.5);
      const x0 = Math.max(0, reg.rect.x - pad);
      const y0 = Math.max(0, reg.rect.y - pad);
      const x1 = Math.min(d.w, reg.rect.x + reg.rect.w + pad);
      const y1 = Math.min(d.h, reg.rect.y + reg.rect.h + pad);
      const w = x1 - x0;
      const h = y1 - y0;
      const big = new Uint8Array(w * h);
      for (let y = 0; y < reg.rect.h; y++) big.set(reg.data.subarray(y * reg.rect.w, (y + 1) * reg.rect.w), (reg.rect.y - y0 + y) * w + (reg.rect.x - x0));
      reg = { data: blurMask(big, w, h, feather), rect: { x: x0, y: y0, w, h } };
    }
    const prev = mode === "replace" ? null : readSelection(s);
    write(s, combine(prev, reg, d.w, d.h, mode));
  });
}

export function selectPolys(s: Studio, polys: Poly[], mode: SelMode, feather = 0, rule: "nonzero" | "evenodd" = "nonzero"): void {
  const d = s.doc;
  const r = rasterPolys(polys, d.w, d.h, rule, 1);
  if (!r) {
    if (mode === "replace") deselect(s);
    return;
  }
  selectMask(s, r, mode, feather);
}

export function selectAll(s: Studio): void {
  const d = s.doc;
  change(s, "すべてを選択", () => {
    const m = new Uint8Array(d.w * d.h);
    m.fill(255);
    write(s, m);
  });
}

export function deselect(s: Studio): void {
  if (!s.doc.selection) return;
  change(s, "選択を解除", () => write(s, null));
}

export function reselect(s: Studio): void {
  const d = s.doc;
  if (!lastSelection || lastSelection.w !== d.w || lastSelection.h !== d.h) return;
  const m = lastSelection.data;
  change(s, "再選択", () => write(s, m));
}

export function invertSelection(s: Studio): void {
  const d = s.doc;
  change(s, "選択範囲を反転", () => {
    const prev = readSelection(s);
    const m = new Uint8Array(d.w * d.h);
    if (prev) for (let i = 0; i < m.length; i++) m[i] = 255 - prev[i];
    else m.fill(255);
    write(s, m);
  });
}

export function growSelection(s: Studio, px: number): void {
  const d = s.doc;
  const prev = readSelection(s);
  if (!prev || px === 0) return;
  change(s, px > 0 ? "選択範囲を拡張" : "選択範囲を縮小", () => {
    const bin = new Uint8Array(d.w * d.h);
    for (let i = 0; i < bin.length; i++) bin[i] = prev[i] >= 128 ? 1 : 0;
    const r = px > 0 ? dilate(bin, d.w, d.h, Math.round(px)) : erode(bin, d.w, d.h, Math.round(-px));
    const m = new Uint8Array(d.w * d.h);
    for (let i = 0; i < m.length; i++) m[i] = r[i] ? 255 : 0;
    write(s, m);
  });
}

export function featherSelection(s: Studio, px: number): void {
  const d = s.doc;
  const prev = readSelection(s);
  if (!prev || px <= 0) return;
  change(s, "選択範囲をぼかす", () => write(s, blurMask(prev, d.w, d.h, px)));
}

/** レイヤーの描いてある所（不透明度）を選択範囲に。 */
export function selectLayerAlpha(s: Studio, l: Layer, mode: SelMode = "replace"): void {
  const d = s.doc;
  if (!l.tex) return;
  const px = s.g.read(l.tex);
  const m = new Uint8Array(d.w * d.h);
  for (let i = 0; i < m.length; i++) m[i] = px[i * 4 + 3];
  selectMask(s, { data: m, rect: { x: 0, y: 0, w: d.w, h: d.h } }, mode, 0, "レイヤーから選択範囲");
}

/** 塗りつぶし・自動選択の参照する絵（乗算済み RGBA）。 */
export function referencePixels(s: Studio, refer: "layer" | "all" | "ref"): Uint8Array {
  const d = s.doc;
  if (refer === "layer") {
    const l = d.paintTarget();
    if (l?.tex) return s.g.read(l.tex);
  }
  const filter = refer === "ref" ? (l: Layer) => l.props.isRef : (l: Layer) => !l.props.isDraft;
  const any = refer === "ref" && !d.allLayers().some((l) => l.props.isRef);
  const img = s.readComposite(undefined, false, any ? (l) => !l.props.isDraft : filter);
  // readComposite は乗算を外した値なので戻す
  const out = new Uint8Array(img.data.length);
  for (let i = 0; i < out.length; i += 4) {
    const a = img.data[i + 3];
    out[i] = (img.data[i] * a) / 255;
    out[i + 1] = (img.data[i + 1] * a) / 255;
    out[i + 2] = (img.data[i + 2] * a) / 255;
    out[i + 3] = a;
  }
  return out;
}

export function magicWand(s: Studio, x: number, y: number, mode: SelMode): boolean {
  const d = s.doc;
  const f = s.ui.fill;
  const px = referencePixels(s, f.refer);
  const opts: FloodOpts = { tolerance: f.tolerance, gap: f.gap, expand: f.expand, contiguous: f.contiguous, antialias: true };
  const r = floodMask(px, d.w, d.h, x, y, opts);
  if (!r) return false;
  selectMask(s, { data: r.mask, rect: { x: 0, y: 0, w: d.w, h: d.h } }, mode, s.ui.select.feather, "自動選択");
  return true;
}

/** 選択範囲の中身（全面の 0..255）。選択が無ければ null。 */
export function selectionOrNull(s: Studio): Uint8Array | null {
  return readSelection(s);
}
