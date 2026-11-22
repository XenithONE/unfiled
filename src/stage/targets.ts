/**
 * Targets the motes can gather into: the wordmark, the works' covers and a
 * closing line of text.
 *
 * Everything is painted into ONE persistent canvas texture (bottom-left
 * aligned) so the compute shader's texture binding never changes — only the
 * canvas content and a uv scale do. Swapping texture objects under a compute
 * pass is fragile; redrawing a canvas and bumping `needsUpdate` is not.
 */
import { CanvasTexture, LinearFilter, SRGBColorSpace } from "three/webgpu";
import { loadImage } from "./images";
import outlines from "./wordmark.json";

export interface TextOptions {
  font: string;
  width?: number;
  height?: number;
  fill?: string | [string, string];
}

export interface Painted {
  aspect: number;
  uvScale: [number, number];
  /** Share of the content area that binds motes (0..1, weighted). */
  cover: number;
  /** Mean linear luminance of the content area. */
  mean: number;
}

export interface PaintOptions {
  /** Linear luminance over which a mote goes from free to bound. */
  lum?: [number, number];
  /**
   * Asked just before the canvas is touched. Painting is shared, and a
   * picture that loaded too late must not paint over the one now wanted.
   */
  wanted?: () => boolean;
}

const SRGB_TO_LINEAR = (() => {
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    lut[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }
  return lut;
})();

async function ensureFont(font: string) {
  try {
    if ("fonts" in document) await document.fonts.load(font);
  } catch {
    /* fall back to whatever the browser substitutes */
  }
}

function fillStyle(
  ctx: CanvasRenderingContext2D,
  width: number,
  fill: string | [string, string] | undefined,
) {
  if (Array.isArray(fill)) {
    const g = ctx.createLinearGradient(0, 0, width, 0);
    g.addColorStop(0, fill[0]);
    g.addColorStop(1, fill[1]);
    return g;
  }
  return fill ?? "#fff";
}

/** Rasterise a line of text to an offscreen canvas (light on black). */
export async function rasterText(text: string, opts: TextOptions) {
  const width = opts.width ?? 2048;
  const height = opts.height ?? 512;
  await ensureFont(opts.font);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // "600 220px Family, fallback" → weight / size / family
  const parsed = opts.font.match(/^\s*(?:(\d{3}|bold|normal)\s+)?([0-9.]+)px\s+(.+)$/);
  let size = parsed ? Number.parseFloat(parsed[2]) : 300;
  const family = parsed ? parsed[3] : opts.font;
  const weight = parsed?.[1] ?? "400";
  // Fit: shrink until the text fits 94% of the width and 86% of the height.
  for (let i = 0; i < 12; i++) {
    ctx.font = `${weight} ${size}px ${family}`;
    const m = ctx.measureText(text);
    const h =
      (m.actualBoundingBoxAscent || size * 0.7) + (m.actualBoundingBoxDescent || size * 0.2);
    if (m.width <= width * 0.94 && h <= height * 0.86) break;
    size *= Math.min((width * 0.94) / m.width, (height * 0.86) / h) * 0.985;
  }
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.fillStyle = fillStyle(ctx, width, opts.fill);
  const metrics = ctx.measureText(text);
  const yOffset = (metrics.actualBoundingBoxDescent - metrics.actualBoundingBoxAscent) / 2;
  ctx.fillText(text, width / 2, height / 2 - yOffset || height / 2);
  return canvas;
}

type Command = [string, ...number[]];

/**
 * The wordmark, drawn from the very outlines the steel letters are extruded
 * from, so the motes land exactly on their faces. The canvas spans the
 * glyphs' bounding box edge to edge.
 */
export function rasterWordmark(width = 2048, fill: [string, string] = ["#fff4e4", "#ffb48a"]) {
  const data = outlines as unknown as {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
    glyphs: Array<{ paths: Command[][] }>;
  };
  const scale = width / (data.xMax - data.xMin);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.ceil((data.yMax - data.yMin) * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const X = (x: number) => (x - data.xMin) * scale;
  const Y = (y: number) => (data.yMax - y) * scale;
  ctx.fillStyle = fillStyle(ctx, width, fill);
  for (const glyph of data.glyphs) {
    ctx.beginPath();
    for (const contour of glyph.paths) {
      for (const cmd of contour) {
        if (cmd[0] === "M") ctx.moveTo(X(cmd[1]), Y(cmd[2]));
        else if (cmd[0] === "L") ctx.lineTo(X(cmd[1]), Y(cmd[2]));
        else if (cmd[0] === "Q") ctx.quadraticCurveTo(X(cmd[1]), Y(cmd[2]), X(cmd[3]), Y(cmd[4]));
        else ctx.closePath();
      }
    }
    ctx.fill();
  }
  return canvas;
}

/** Bounding box of the wordmark's outlines, in em (y up, baseline 0). */
export const WORDMARK_BOX = (() => {
  const d = outlines as unknown as { xMin: number; xMax: number; yMin: number; yMax: number };
  return { xMin: d.xMin, xMax: d.xMax, yMin: d.yMin, yMax: d.yMax };
})();

export class TargetPainter {
  readonly width: number;
  readonly height: number;
  readonly canvas: HTMLCanvasElement;
  readonly texture: CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private cache = new Map<string, HTMLCanvasElement>();
  private probe = document.createElement("canvas");
  private probeCtx: CanvasRenderingContext2D;
  /** What the canvas holds right now (painting it again would change nothing). */
  private held: { key: string; painted: Painted } | null = null;

  constructor(width = 2048, height = 1024) {
    this.width = width;
    this.height = height;
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: false })!;
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, width, height);
    const texture = new CanvasTexture(this.canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.generateMipmaps = false;
    this.texture = texture;
    this.probe.width = 64;
    this.probe.height = 64;
    this.probeCtx = this.probe.getContext("2d", { willReadFrequently: true })!;
  }

  /**
   * How much of a picture binds motes, and how light it is on the whole
   * (a cheap 64×64 estimate, in linear light like the shader's own reading).
   */
  private measure(source: CanvasImageSource, sw: number, sh: number, lum: [number, number]) {
    const ctx = this.probeCtx;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, 64, 64);
    ctx.drawImage(source, 0, 0, sw, sh, 0, 0, 64, 64);
    const data = ctx.getImageData(0, 0, 64, 64).data;
    const span = Math.max(1e-4, lum[1] - lum[0]);
    let bound = 0;
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      const y =
        SRGB_TO_LINEAR[data[i]] * 0.2126 +
        SRGB_TO_LINEAR[data[i + 1]] * 0.7152 +
        SRGB_TO_LINEAR[data[i + 2]] * 0.0722;
      const t = Math.max(0, Math.min(1, (y - lum[0]) / span));
      bound += t * t * (3 - 2 * t);
      total += y;
    }
    const n = data.length / 4;
    return { cover: bound / n, mean: total / n };
  }

  /**
   * Paint any drawable, bottom-left aligned, as large as fits. With a `key`,
   * asking again for what the canvas already holds costs nothing (layouts
   * are redone often, and every repaint is a texture upload).
   */
  paint(
    source: CanvasImageSource,
    sw: number,
    sh: number,
    lum: [number, number] = [0.08, 0.5],
    key = "",
  ): Painted {
    const id = key ? `${key}|${lum[0]}|${lum[1]}` : "";
    if (id && this.held?.key === id) return this.held.painted;
    const aspect = sw / Math.max(1, sh);
    let w = this.width;
    let h = w / aspect;
    if (h > this.height) {
      h = this.height;
      w = h * aspect;
    }
    w = Math.floor(w);
    h = Math.floor(h);
    const ctx = this.ctx;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, this.height - h, w, h);
    this.texture.needsUpdate = true;
    const { cover, mean } = this.measure(source, sw, sh, lum);
    const painted: Painted = { aspect, uvScale: [w / this.width, h / this.height], cover, mean };
    this.held = id ? { key: id, painted } : null;
    return painted;
  }

  /** Load (cached) and paint a cover image; null if it is no longer wanted. */
  async paintImageUrl(url: string, opts: PaintOptions = {}): Promise<Painted | null> {
    const img = await loadImage(url);
    if (opts.wanted && !opts.wanted()) return null;
    return this.paint(img, img.width, img.height, opts.lum, `image:${url}`);
  }

  async paintText(
    key: string,
    text: string,
    opts: TextOptions,
    paint: PaintOptions = {},
  ): Promise<Painted | null> {
    let raster = this.cache.get(key);
    if (!raster) {
      raster = await rasterText(text, opts);
      this.cache.set(key, raster);
    }
    if (paint.wanted && !paint.wanted()) return null;
    return this.paint(raster, raster.width, raster.height, paint.lum, `text:${key}`);
  }

  paintWordmark(lum?: [number, number]): Painted {
    let raster = this.cache.get("wordmark");
    if (!raster) {
      raster = rasterWordmark();
      this.cache.set("wordmark", raster);
    }
    return this.paint(raster, raster.width, raster.height, lum, "wordmark");
  }
}
