/**
 * Targets the particle field can assemble into: rasterised words and the
 * works' cover images.
 *
 * Everything is painted into ONE persistent canvas texture (bottom-left
 * aligned) so the compute shader's texture binding never changes — only the
 * canvas content and a uv scale do. Swapping texture objects under a compute
 * pass is fragile; redrawing a canvas and bumping `needsUpdate` is not.
 */
import {
  CanvasTexture,
  Color,
  ImageLoader,
  LinearFilter,
  SRGBColorSpace,
} from "three/webgpu";
import type { TargetSpec } from "./ParticleStage";

export interface TextOptions {
  font: string;
  width?: number;
  height?: number;
  letterSpacing?: string;
  fill?: string | [string, string];
  /** Horizontal stretch (Anton reads better slightly widened). */
  stretch?: number;
  weight?: string;
}

export interface Painted {
  aspect: number;
  uvScale: [number, number];
}

async function ensureFont(font: string) {
  try {
    if ("fonts" in document) await document.fonts.load(font);
  } catch {
    /* fall back to whatever the browser substitutes */
  }
}

/** Rasterise a line of text to an offscreen canvas (white on black). */
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
  if (opts.letterSpacing && "letterSpacing" in ctx)
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
      opts.letterSpacing;
  const stretch = opts.stretch ?? 1;
  // "600 220px Family, fallback" → weight / size / family
  const parsed = opts.font.match(
    /^\s*(?:(\d{3}|bold|normal)\s+)?([0-9.]+)px\s+(.+)$/,
  );
  let size = parsed ? Number.parseFloat(parsed[2]) : 300;
  const family = parsed ? parsed[3] : opts.font;
  const weight = opts.weight ?? parsed?.[1] ?? "400";
  // Fit: shrink until the text fits 92% of the width and 86% of the height.
  for (let i = 0; i < 12; i++) {
    ctx.font = `${weight} ${size}px ${family}`;
    const m = ctx.measureText(text);
    const w = m.width * stretch;
    const h =
      (m.actualBoundingBoxAscent || size * 0.7) +
      (m.actualBoundingBoxDescent || size * 0.2);
    if (w <= width * 0.92 && h <= height * 0.86) break;
    size *= Math.min((width * 0.92) / w, (height * 0.86) / h) * 0.985;
  }
  ctx.font = `${weight} ${size}px ${family}`;
  if (Array.isArray(opts.fill)) {
    const g = ctx.createLinearGradient(0, 0, width, 0);
    g.addColorStop(0, opts.fill[0]);
    g.addColorStop(1, opts.fill[1]);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = opts.fill ?? "#fff";
  }
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.scale(stretch, 1);
  const metrics = ctx.measureText(text);
  const yOffset =
    (metrics.actualBoundingBoxDescent - metrics.actualBoundingBoxAscent) / 2;
  ctx.fillText(text, 0, -yOffset || 0);
  ctx.restore();
  return canvas;
}

export class TargetPainter {
  readonly width: number;
  readonly height: number;
  readonly canvas: HTMLCanvasElement;
  readonly texture: CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private textCache = new Map<string, HTMLCanvasElement>();

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
  }

  /** Paint any drawable, bottom-left aligned, as large as fits. */
  paint(source: CanvasImageSource, sw: number, sh: number): Painted {
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
    return { aspect, uvScale: [w / this.width, h / this.height] };
  }

  paintImage(img: HTMLImageElement | ImageBitmap): Painted {
    return this.paint(img, img.width, img.height);
  }

  async paintText(key: string, text: string, opts: TextOptions): Promise<Painted> {
    let raster = this.textCache.get(key);
    if (!raster) {
      raster = await rasterText(text, opts);
      this.textCache.set(key, raster);
    }
    return this.paint(raster, raster.width, raster.height);
  }
}

/* ---------------------------------------------------------------------- */

const imageLoader = new ImageLoader();
const imageCache = new Map<string, Promise<HTMLImageElement>>();

export function loadImage(url: string) {
  let entry = imageCache.get(url);
  if (!entry) {
    entry = imageLoader.loadAsync(url);
    imageCache.set(url, entry);
    entry.catch(() => imageCache.delete(url));
  }
  return entry;
}

export function coverSpec(
  id: string,
  painted: Painted,
  accent: string,
  anchor: TargetSpec["anchor"],
): TargetSpec {
  const tint = new Color(accent).lerp(new Color(1, 1, 1), 0.82);
  return {
    key: `cover:${id}`,
    aspect: painted.aspect,
    uvScale: painted.uvScale,
    anchor,
    lumLow: 0.03,
    lumHigh: 0.3,
    relief: 0.45,
    thickness: 0.18,
    feather: 0.05,
    tint,
    gain: 1.7,
  };
}

export function textSpec(
  key: string,
  painted: Painted,
  anchor: TargetSpec["anchor"],
  extra: Partial<TargetSpec> = {},
): TargetSpec {
  return {
    key,
    aspect: painted.aspect,
    uvScale: painted.uvScale,
    anchor,
    lumLow: 0.08,
    lumHigh: 0.5,
    relief: 0.08,
    thickness: 0.42,
    feather: 0.01,
    gain: 1.0,
    ...extra,
  };
}
