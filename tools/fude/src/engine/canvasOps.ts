// キャンバスの大きさ変更・画像の拡大縮小・キャンバスの回転と反転。
// 文書を作り直すので取り消しには積まず、実行前に元の絵のコピーを作品一覧へ残す。
import { Doc, Layer } from "./doc";
import type { Studio } from "./studio";

export type Placer = (ctx: CanvasRenderingContext2D, src: HTMLCanvasElement) => void;

function layerCanvas(s: Studio, l: Layer, mask: boolean): HTMLCanvasElement {
  const d = s.doc;
  const c = document.createElement("canvas");
  c.width = d.w;
  c.height = d.h;
  const tex = mask ? l.maskTex : l.tex;
  if (!tex) return c;
  const raw = s.g.read(tex);
  const img = new ImageData(d.w, d.h);
  if (mask) {
    for (let i = 0; i < d.w * d.h; i++) {
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = raw[i];
      img.data[i * 4 + 3] = 255;
    }
  } else {
    for (let i = 0; i < raw.length; i += 4) {
      const a = raw[i + 3];
      if (!a) continue;
      const k = 255 / a;
      img.data[i] = raw[i] * k;
      img.data[i + 1] = raw[i + 1] * k;
      img.data[i + 2] = raw[i + 2] * k;
      img.data[i + 3] = a;
    }
  }
  c.getContext("2d")!.putImageData(img, 0, 0);
  return c;
}

/** すべてのレイヤーを place で新しい大きさへ写した文書に置き換える。 */
export function rebuildDoc(s: Studio, nw: number, nh: number, place: Placer, keepText: ((l: Layer) => void) | null): void {
  const old = s.doc;
  const g = s.g;
  const max = Math.min(8192, g.maxTex);
  nw = Math.max(16, Math.min(max, Math.round(nw)));
  nh = Math.max(16, Math.min(max, Math.round(nh)));
  const nd = new Doc(g, nw, nh, old.docId);
  nd.name = old.name;
  nd.created = old.created;
  nd.paper = { ...old.paper };
  const out = document.createElement("canvas");
  out.width = nw;
  out.height = nh;
  const octx = out.getContext("2d", { willReadFrequently: true })!;
  octx.imageSmoothingQuality = "high";
  const copy = (src: Layer, parent: Layer) => {
    let n: Layer;
    if (src.isGroup) n = nd.createGroup(src.props.name);
    else n = nd.createRaster(src.props.name);
    n.props = { ...src.props };
    if (src.kind === "text" && src.text && keepText) {
      n.kind = "text";
      n.text = { ...src.text };
    }
    nd.registry.delete(n.id);
    n.id = src.id;
    nd.registry.set(n.id, n);
    nd.insert(n, parent, parent.children.length);
    if (!src.isGroup && src.tex) {
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, nw, nh);
      octx.save();
      place(octx, layerCanvas(s, src, false));
      octx.restore();
      g.deleteTex(n.tex);
      n.tex = g.texFromImage(out, nw, nh, `layer:${n.props.name}`);
      n.bounds = { x: 0, y: 0, w: nw, h: nh };
      n.version++;
    }
    if (src.maskTex) {
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.fillStyle = "#fff";
      octx.fillRect(0, 0, nw, nh);
      octx.save();
      place(octx, layerCanvas(s, src, true));
      octx.restore();
      const px = octx.getImageData(0, 0, nw, nh).data;
      const m = new Uint8Array(nw * nh);
      for (let i = 0; i < m.length; i++) m[i] = px[i * 4];
      n.mask = g.createTex(nw, nh, "r8", "mask", { filter: "nearest" });
      g.upload(n.mask, m);
    } else n.props.hasMask = false;
    if (n.kind === "text") keepText?.(n);
    for (const c of src.children) copy(c, n);
  };
  for (const c of old.root.children) copy(c, nd.root);
  nd.activeId = nd.find(old.activeId) ? old.activeId : nd.allLayers().pop()?.id ?? "";
  s.attachDoc(nd);
  s.view.fit();
  s.comp.markAll();
  s.emit("doc", "layers", "pixels", "history", "selection");
  s.requestFrame();
}

/** キャンバスの大きさ（ax, ay は 0..1 の基準位置: 0=左/上、0.5=中央、1=右/下）。 */
export function resizeCanvas(s: Studio, w: number, h: number, ax: number, ay: number): void {
  const d = s.doc;
  const dx = Math.round((w - d.w) * ax);
  const dy = Math.round((h - d.h) * ay);
  rebuildDoc(s, w, h, (ctx, src) => ctx.drawImage(src, dx, dy), (l) => {
    if (l.text) {
      l.text.x += dx;
      l.text.y += dy;
    }
  });
}

/** 画像の大きさ（全部を拡大縮小）。 */
export function resizeImage(s: Studio, w: number, h: number): void {
  const d = s.doc;
  const kx = w / d.w;
  const ky = h / d.h;
  rebuildDoc(s, w, h, (ctx, src) => {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, w, h);
  }, (l) => {
    if (l.text) {
      l.text.x *= kx;
      l.text.y *= ky;
      l.text.size *= Math.sqrt(kx * ky);
      l.text.strokeWidth *= Math.sqrt(kx * ky);
    }
  });
}

/** キャンバスごと回転・反転。 */
export function rotateCanvas(s: Studio, kind: "cw" | "ccw" | "180" | "flipH" | "flipV"): void {
  const d = s.doc;
  const W = d.w;
  const H = d.h;
  const swap = kind === "cw" || kind === "ccw";
  const nw = swap ? H : W;
  const nh = swap ? W : H;
  rebuildDoc(s, nw, nh, (ctx, src) => {
    if (kind === "cw") ctx.setTransform(0, 1, -1, 0, nw, 0);
    else if (kind === "ccw") ctx.setTransform(0, -1, 1, 0, 0, nh);
    else if (kind === "180") ctx.setTransform(-1, 0, 0, -1, nw, nh);
    else if (kind === "flipH") ctx.setTransform(-1, 0, 0, 1, nw, 0);
    else ctx.setTransform(1, 0, 0, -1, 0, nh);
    ctx.drawImage(src, 0, 0);
  }, null);
}
