// OpenRaster（.ora）の読み書き。Krita・MyPaint・GIMP（追加機能）で開ける。
// FUDE だけの情報（クリッピング・透明ピクセルのロック・マスク）は fude: の属性で持つ（他のソフトは読み飛ばす）。
import { BLEND_MODES, blendFromOra } from "../engine/blend";
import type { IODoc, IOLayer } from "./psd";
import { readZip, writeZip, type ZipEntry } from "./zip";

const NS = "https://xenithone.github.io/unfiled/tools/fude/";

async function pngOf(rgba: Uint8Array, w: number, h: number): Promise<Uint8Array> {
  const c = document.createElement("canvas");
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  if (w > 0 && h > 0) {
    const img = new ImageData(w, h);
    img.data.set(rgba.subarray(0, w * h * 4));
    c.getContext("2d")!.putImageData(img, 0, 0);
  }
  const b = await new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
  if (!b) throw new Error("PNG にできませんでした");
  return new Uint8Array(await b.arrayBuffer());
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function oraOp(blend: string): string {
  return BLEND_MODES.find((b) => b.id === blend)?.ora ?? "svg:src-over";
}

export async function writeOra(doc: IODoc, thumb: { rgba: Uint8Array; w: number; h: number }): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const files: ZipEntry[] = [{ name: "mimetype", data: enc.encode("image/openraster") }];
  let n = 0;
  const pngs: ZipEntry[] = [];
  const xmlOf = async (l: IOLayer, indent: string): Promise<string> => {
    const common = `name="${esc(l.name)}" opacity="${l.opacity.toFixed(3)}" visibility="${l.visible ? "visible" : "hidden"}"${l.clip ? ` fude:clip="true"` : ""}${l.alphaLock ? ` fude:alpha-lock="true"` : ""}`;
    let maskAttr = "";
    if (l.mask) {
      const mname = `data/mask${++n}.png`;
      const m = l.mask;
      const rgba = new Uint8Array(m.w * m.h * 4);
      for (let i = 0; i < m.w * m.h; i++) {
        rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = m.data[i];
        rgba[i * 4 + 3] = 255;
      }
      pngs.push({ name: mname, data: await pngOf(rgba, m.w, m.h) });
      maskAttr = ` fude:mask="${mname}" fude:mask-x="${m.x}" fude:mask-y="${m.y}" fude:mask-enabled="${m.enabled}"`;
    }
    if (l.kind === "group") {
      const kids: string[] = [];
      for (let i = l.children.length - 1; i >= 0; i--) kids.push(await xmlOf(l.children[i], indent + "  "));
      const pass = l.blend === "pass";
      return `${indent}<stack ${common} composite-op="${pass ? "svg:src-over" : oraOp(l.blend)}" isolation="${pass ? "auto" : "isolate"}"${maskAttr}>\n${kids.join("\n")}\n${indent}</stack>`;
    }
    const src = `data/layer${++n}.png`;
    pngs.push({ name: src, data: await pngOf(l.rgba ?? new Uint8Array(4), l.rgba ? l.w : 1, l.rgba ? l.h : 1) });
    return `${indent}<layer ${common} src="${src}" x="${l.x}" y="${l.y}" composite-op="${oraOp(l.blend)}"${maskAttr}/>`;
  };
  const items: string[] = [];
  for (let i = doc.layers.length - 1; i >= 0; i--) items.push(await xmlOf(doc.layers[i], "    "));
  const xml = `<?xml version='1.0' encoding='UTF-8'?>\n<image w="${doc.w}" h="${doc.h}" version="0.0.5" xmlns:fude="${NS}">\n  <stack>\n${items.join("\n")}\n  </stack>\n</image>\n`;
  files.push({ name: "stack.xml", data: enc.encode(xml) });
  files.push(...pngs);
  if (doc.composite) files.push({ name: "mergedimage.png", data: await pngOf(doc.composite, doc.w, doc.h) });
  files.push({ name: "Thumbnails/thumbnail.png", data: await pngOf(thumb.rgba, thumb.w, thumb.h) });
  return writeZip(files);
}

async function decodePng(data: Uint8Array): Promise<{ rgba: Uint8Array; w: number; h: number }> {
  const bmp = await createImageBitmap(new Blob([data as BlobPart], { type: "image/png" }), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
  bmp.close?.();
  return { rgba: new Uint8Array(img.data.buffer), w: img.width, h: img.height };
}

export async function readOra(buf: Uint8Array): Promise<IODoc> {
  const files = await readZip(buf);
  const xmlBytes = files.get("stack.xml");
  if (!xmlBytes) throw new Error("stack.xml がありません（ORA ではないかもしれません）");
  const dom = new DOMParser().parseFromString(new TextDecoder().decode(xmlBytes), "application/xml");
  const img = dom.querySelector("image");
  if (!img) throw new Error("stack.xml が読めません");
  const W = Number(img.getAttribute("w"));
  const H = Number(img.getAttribute("h"));
  const attr = (el: Element, k: string) => el.getAttribute(k) ?? el.getAttributeNS(NS, k.replace("fude:", ""));
  const conv = async (el: Element): Promise<IOLayer | null> => {
    const tag = el.tagName.toLowerCase();
    const name = el.getAttribute("name") ?? (tag === "stack" ? "フォルダー" : "レイヤー");
    const opacity = Number(el.getAttribute("opacity") ?? "1");
    const visible = (el.getAttribute("visibility") ?? "visible") !== "hidden";
    const op = el.getAttribute("composite-op") ?? "svg:src-over";
    const clip = attr(el, "fude:clip") === "true";
    const alphaLock = attr(el, "fude:alpha-lock") === "true";
    let mask: IOLayer["mask"] = null;
    const msrc = attr(el, "fude:mask");
    if (msrc && files.get(msrc)) {
      const m = await decodePng(files.get(msrc)!);
      const data = new Uint8Array(m.w * m.h);
      for (let i = 0; i < data.length; i++) data[i] = m.rgba[i * 4];
      mask = { x: Number(attr(el, "fude:mask-x") ?? 0), y: Number(attr(el, "fude:mask-y") ?? 0), w: m.w, h: m.h, data, defaultColor: 255, enabled: attr(el, "fude:mask-enabled") !== "false" };
    }
    if (tag === "stack") {
      const kids: IOLayer[] = [];
      const els = [...el.children].filter((c) => /^(layer|stack)$/i.test(c.tagName));
      for (let i = els.length - 1; i >= 0; i--) {
        const k = await conv(els[i]);
        if (k) kids.push(k);
      }
      const iso = el.getAttribute("isolation") ?? "auto";
      return { name, kind: "group", visible, opacity, blend: iso === "isolate" ? blendFromOra(op) : "pass", clip, alphaLock: false, x: 0, y: 0, w: 0, h: 0, rgba: null, mask, children: kids, expanded: true };
    }
    if (tag !== "layer") return null;
    const src = el.getAttribute("src");
    const data = src ? files.get(src) : undefined;
    let rgba: Uint8Array | null = null;
    let w = 0;
    let h = 0;
    if (data) {
      const p = await decodePng(data);
      rgba = p.rgba;
      w = p.w;
      h = p.h;
    }
    return { name, kind: "raster", visible, opacity, blend: blendFromOra(op), clip, alphaLock, x: Number(el.getAttribute("x") ?? 0), y: Number(el.getAttribute("y") ?? 0), w, h, rgba, mask, children: [], expanded: true };
  };
  const top = dom.querySelector("image > stack");
  const layers: IOLayer[] = [];
  if (top) {
    const els = [...top.children].filter((c) => /^(layer|stack)$/i.test(c.tagName));
    for (let i = els.length - 1; i >= 0; i--) {
      const l = await conv(els[i]);
      if (l) layers.push(l);
    }
  }
  return { w: W, h: H, layers, composite: null };
}
