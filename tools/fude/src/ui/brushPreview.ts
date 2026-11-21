// 筆の見本（一覧の小さな筆跡）を、本物の筆のエンジンで描いて画像にする。
import { BrushRenderer } from "../engine/brush/render";
import type { BrushSettings } from "../engine/brush/presets";
import { Compositor } from "../engine/compositor";
import { Doc } from "../engine/doc";
import { StrokeSession } from "../engine/painter";
import type { Studio } from "../engine/studio";
import { History } from "../engine/undo";

const cache = new Map<string, string>();
const W = 232;
const H = 46;

function key(b: BrushSettings, color: string): string {
  return JSON.stringify(b) + color;
}

export function brushPreview(s: Studio, b: BrushSettings, color = "#2a2a30"): string {
  const k = key(b, color);
  const hit = cache.get(k);
  if (hit) return hit;
  const g = s.g;
  const doc = new Doc(g, W, H);
  const layer = doc.createRaster("p");
  doc.insert(layer, doc.root, 0);
  const comp = new Compositor(g, doc, 256);
  const br = new BrushRenderer(g, s.tex, W, H, 256);
  const hist = new History(g, { doc, pixelsChanged() {}, structChanged() {}, selectionChanged() {} }, 64 * 1024 * 1024);
  const ctx = { doc, comp, br, hist, grain: (id: string) => s.tex.grains.get(id as never) ?? null };
  hist.begin("preview");
  const draw = (brush: BrushSettings, rgb: [number, number, number], path: (t: number) => [number, number, number], n = 80) => {
    const ss = new StrokeSession(ctx, layer, brush, rgb, { target: "color", pressureGamma: 1, taper: true, symmetry: null, seed: 7 });
    const p0 = path(0);
    ss.begin({ x: p0[0], y: p0[1], p: p0[2], tx: 0, ty: 0, t: 0 });
    for (let i = 1; i <= n; i++) {
      const [x, y, p] = path(i / n);
      ss.add({ x, y, p, tx: 0, ty: 0, t: i * 8 });
    }
    ss.end();
  };
  const hex = (h: string): [number, number, number] => {
    const n = parseInt(h.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  };
  const preset = { ...b };
  const big = preset.particle > 0 || preset.tool === "deco";
  preset.size = big ? H * 1.1 : Math.max(2, Math.min(H * 0.62, preset.size));
  preset.stabilize = 0;
  // 混ぜる筆・消しゴムは、下に色の帯を敷いてから
  const needsBase = preset.engine === "smudge" || preset.engine === "blur" || preset.erase || preset.engine === "mix";
  if (needsBase) {
    const base: BrushSettings = { ...preset, engine: "stamp", erase: false, tip: "round", hardness: 0.9, size: H * 0.4, sizePressure: false, opacity: 1, flow: 1, accumulate: "max", grain: "none", particle: 0, taperIn: 0, taperOut: 0, blend: "normal", angleMode: "fixed", roundness: 1, hueJitter: 0, satJitter: 0, valJitter: 0, sizeJitter: 0, opacityJitter: 0 };
    const cols = ["#e8505b", "#f9d56e", "#3fa7d6"];
    cols.forEach((c, i) => draw(base, hex(c), (t) => [10 + t * (W - 20), H * (0.28 + i * 0.22), 1], 40));
  }
  const rgb = hex(preset.tool === "eraser" ? "#000000" : color);
  draw(preset, rgb, (t) => {
    const x = 12 + t * (W - 24);
    const y = H / 2 + Math.sin(t * Math.PI * 2) * H * (big ? 0.1 : 0.22);
    const p = big ? 1 : 0.25 + 0.75 * Math.sin(t * Math.PI);
    return [x, y, p];
  });
  hist.end();
  const raw = g.read(layer.tex!);
  const img = new ImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const a = raw[i * 4 + 3];
    if (a === 0) continue;
    const kk = 255 / a;
    img.data[i * 4] = raw[i * 4] * kk;
    img.data[i * 4 + 1] = raw[i * 4 + 1] * kk;
    img.data[i * 4 + 2] = raw[i * 4 + 2] * kk;
    img.data[i * 4 + 3] = a;
  }
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  c.getContext("2d")!.putImageData(img, 0, 0);
  const url = c.toDataURL("image/png");
  hist.reset();
  comp.dispose();
  br.dispose();
  doc.dispose();
  cache.set(k, url);
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return url;
}
