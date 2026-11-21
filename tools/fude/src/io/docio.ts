// FUDE の文書 ⇔ 読み書き用の形（IODoc）。PSD・ORA の両方がこれを使う。
import { isBlendMode } from "../engine/blend";
import type { Layer } from "../engine/doc";
import { hexToRgb } from "../engine/compositor";
import type { Studio } from "../engine/studio";
import type { IODoc, IOLayer } from "./psd";

function unpremul(px: Uint8Array): Uint8Array {
  const out = new Uint8Array(px.length);
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3];
    if (a === 0) continue;
    const k = 255 / a;
    out[i] = Math.min(255, Math.round(px[i] * k));
    out[i + 1] = Math.min(255, Math.round(px[i + 1] * k));
    out[i + 2] = Math.min(255, Math.round(px[i + 2] * k));
    out[i + 3] = a;
  }
  return out;
}

/** paperLayer: 用紙を一番下の「用紙」レイヤーとして入れる（他のソフトで同じ見た目にするため）。 */
export function docToIO(s: Studio, paperLayer: boolean): IODoc {
  const d = s.doc;
  const g = s.g;
  const conv = (l: Layer): IOLayer => {
    const base: IOLayer = { name: l.props.name, kind: l.isGroup ? "group" : "raster", visible: l.props.visible, opacity: l.props.opacity, blend: l.props.blend, clip: l.props.clip, alphaLock: l.props.alphaLock, x: 0, y: 0, w: 0, h: 0, rgba: null, mask: null, children: [], expanded: l.props.expanded };
    if (l.maskTex) {
      base.mask = { x: 0, y: 0, w: d.w, h: d.h, data: g.read(l.maskTex), defaultColor: 255, enabled: l.props.maskEnabled };
    }
    if (l.isGroup) {
      base.children = l.children.map(conv);
      return base;
    }
    if (l.tex && l.bounds) {
      const x0 = Math.max(0, Math.floor(l.bounds.x));
      const y0 = Math.max(0, Math.floor(l.bounds.y));
      const x1 = Math.min(d.w, Math.ceil(l.bounds.x + l.bounds.w));
      const y1 = Math.min(d.h, Math.ceil(l.bounds.y + l.bounds.h));
      if (x1 > x0 && y1 > y0) {
        const px = unpremul(g.read(l.tex, x0, y0, x1 - x0, y1 - y0));
        // 空の縁を詰める
        let a0 = x1 - x0;
        let b0 = y1 - y0;
        let a1 = -1;
        let b1 = -1;
        const w = x1 - x0;
        const h = y1 - y0;
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++)
            if (px[(y * w + x) * 4 + 3]) {
              if (x < a0) a0 = x;
              if (x > a1) a1 = x;
              if (y < b0) b0 = y;
              if (y > b1) b1 = y;
            }
        if (a1 >= 0) {
          const cw = a1 - a0 + 1;
          const chh = b1 - b0 + 1;
          const crop = new Uint8Array(cw * chh * 4);
          for (let y = 0; y < chh; y++) crop.set(px.subarray(((b0 + y) * w + a0) * 4, ((b0 + y) * w + a0 + cw) * 4), y * cw * 4);
          base.x = x0 + a0;
          base.y = y0 + b0;
          base.w = cw;
          base.h = chh;
          base.rgba = crop;
        }
      }
    }
    return base;
  };
  const layers = d.root.children.map(conv);
  if (paperLayer && d.paper.visible) {
    const [r, gg, b] = hexToRgb(d.paper.color).map((v) => Math.round(v * 255));
    const rgba = new Uint8Array(d.w * d.h * 4);
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = r;
      rgba[i + 1] = gg;
      rgba[i + 2] = b;
      rgba[i + 3] = 255;
    }
    layers.unshift({ name: "用紙", kind: "raster", visible: true, opacity: 1, blend: "normal", clip: false, alphaLock: false, x: 0, y: 0, w: d.w, h: d.h, rgba, mask: null, children: [], expanded: true });
  }
  const comp = s.readComposite(undefined, true);
  return { w: d.w, h: d.h, layers, composite: new Uint8Array(comp.data.buffer) };
}

/** 読み込んだ形から新しい文書を作る。 */
export function ioToDoc(s: Studio, io: IODoc, name: string): void {
  const max = Math.min(8192, s.g.maxTex);
  if (io.w > max || io.h > max) throw new Error(`大きすぎます（${io.w}×${io.h}・この端末では最大 ${max}）`);
  let layers = io.layers;
  let paper: string | null = null;
  // 一番下の「用紙」（一色で塗りつぶされたレイヤー）は用紙の色に戻す
  const bottom = layers[0];
  if (bottom && bottom.kind === "raster" && /^(用紙|paper|背景)$/i.test(bottom.name) && bottom.rgba && bottom.w === io.w && bottom.h === io.h) {
    const p = bottom.rgba;
    let same = true;
    for (let i = 4; i < p.length && same; i += 4 * 97) if (p[i] !== p[0] || p[i + 1] !== p[1] || p[i + 2] !== p[2] || p[i + 3] !== 255) same = false;
    if (same && p[3] === 255) {
      paper = "#" + [p[0], p[1], p[2]].map((v) => v.toString(16).padStart(2, "0")).join("");
      layers = layers.slice(1);
    }
  }
  if (!layers.length && io.composite) {
    layers = [{ name: "背景", kind: "raster", visible: true, opacity: 1, blend: "normal", clip: false, alphaLock: false, x: 0, y: 0, w: io.w, h: io.h, rgba: io.composite, mask: null, children: [], expanded: true }];
  }
  s.newDocument(io.w, io.h, { empty: true, paper, name });
  const d = s.doc;
  const g = s.g;
  const build = (n: IOLayer, parent: Layer) => {
    let l: Layer;
    if (n.kind === "group") l = d.createGroup(n.name);
    else l = d.createRaster(n.name);
    l.props.visible = n.visible;
    l.props.opacity = n.opacity;
    l.props.blend = n.kind === "group" ? (n.blend === "pass" || isBlendMode(n.blend) ? n.blend : "pass") : isBlendMode(n.blend) ? n.blend : "normal";
    l.props.clip = n.clip;
    l.props.alphaLock = n.alphaLock;
    l.props.expanded = n.expanded;
    d.insert(l, parent, parent.children.length);
    if (l.tex && n.rgba && n.w > 0 && n.h > 0) {
      // 画面の外にはみ出した部分は切る
      const x0 = Math.max(0, n.x);
      const y0 = Math.max(0, n.y);
      const x1 = Math.min(d.w, n.x + n.w);
      const y1 = Math.min(d.h, n.y + n.h);
      if (x1 > x0 && y1 > y0) {
        const w = x1 - x0;
        const h = y1 - y0;
        const pm = new Uint8Array(w * h * 4);
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const si = ((y + y0 - n.y) * n.w + (x + x0 - n.x)) * 4;
            const di = (y * w + x) * 4;
            const a = n.rgba[si + 3];
            pm[di] = (n.rgba[si] * a + 127) / 255;
            pm[di + 1] = (n.rgba[si + 1] * a + 127) / 255;
            pm[di + 2] = (n.rgba[si + 2] * a + 127) / 255;
            pm[di + 3] = a;
          }
        g.upload(l.tex, pm, x0, y0, w, h);
        l.touch({ x: x0, y: y0, w, h });
      }
    }
    if (n.mask) {
      l.mask = g.createTex(d.w, d.h, "r8", "mask", { filter: "nearest" });
      const full = new Uint8Array(d.w * d.h).fill(n.mask.defaultColor);
      const m = n.mask;
      for (let y = 0; y < m.h; y++) {
        const yy = y + m.y;
        if (yy < 0 || yy >= d.h) continue;
        for (let x = 0; x < m.w; x++) {
          const xx = x + m.x;
          if (xx < 0 || xx >= d.w) continue;
          full[yy * d.w + xx] = m.data[y * m.w + x] ?? n.mask.defaultColor;
        }
      }
      g.upload(l.mask, full);
      l.props.hasMask = true;
      l.props.maskEnabled = n.mask.enabled;
    }
    for (const c of n.children) build(c, l);
  };
  for (const n of layers) build(n, d.root);
  const all = d.allLayers().filter((x) => !x.isGroup);
  d.activeId = all.length ? all[all.length - 1].id : d.allLayers()[0]?.id ?? "";
  if (!d.activeId) {
    const l = d.createRaster("レイヤー 1");
    d.insert(l, d.root, 0);
    d.activeId = l.id;
  }
  s.hist.reset();
  s.comp.markAll();
  s.view.fit();
  s.emit("doc", "layers", "pixels", "history");
  s.requestFrame();
}
