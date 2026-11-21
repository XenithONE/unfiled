// 多角形（点列）を塗ったマスクにする（Canvas 2D で。範囲だけの小さなキャンバスを使う）。
import type { Rect } from "./gl";

export type Poly = [number, number][];

let cv: HTMLCanvasElement | null = null;

function canvasOf(w: number, h: number): CanvasRenderingContext2D {
  if (!cv) cv = document.createElement("canvas");
  if (cv.width < w || cv.height < h) {
    cv.width = Math.max(cv.width, w);
    cv.height = Math.max(cv.height, h);
  }
  return cv.getContext("2d", { willReadFrequently: true })!;
}

export function polysBounds(polys: Poly[]): Rect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of polys)
    for (const [x, y] of p) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  if (!Number.isFinite(x0)) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * polys を塗ったマスク（rect の範囲・1 画素 1 バイト）。canvasW/H で切る。
 * pad は外側の余白（ぼかし用）。
 */
export function rasterPolys(polys: Poly[], canvasW: number, canvasH: number, rule: "nonzero" | "evenodd" = "nonzero", pad = 1): { data: Uint8Array; rect: Rect } | null {
  const b = polysBounds(polys);
  if (!b) return null;
  const x0 = Math.max(0, Math.floor(b.x - pad));
  const y0 = Math.max(0, Math.floor(b.y - pad));
  const x1 = Math.min(canvasW, Math.ceil(b.x + b.w + pad));
  const y1 = Math.min(canvasH, Math.ceil(b.y + b.h + pad));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return null;
  const ctx = canvasOf(w, h);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.translate(-x0, -y0);
  const path = new Path2D();
  for (const p of polys) {
    if (p.length < 2) continue;
    path.moveTo(p[0][0], p[0][1]);
    for (let i = 1; i < p.length; i++) path.lineTo(p[i][0], p[i][1]);
    path.closePath();
  }
  ctx.fillStyle = "#fff";
  ctx.fill(path, rule);
  const img = ctx.getImageData(0, 0, w, h).data;
  const data = new Uint8Array(w * h);
  for (let i = 0; i < data.length; i++) data[i] = img[i * 4 + 3];
  return { data, rect: { x: x0, y: y0, w, h } };
}

/** 楕円・長方形を多角形に。 */
export function ellipsePoly(cx: number, cy: number, rx: number, ry: number, rot = 0): Poly {
  const n = Math.max(24, Math.min(512, Math.ceil(Math.sqrt(Math.max(rx, ry)) * 10)));
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const out: Poly = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const x = Math.cos(t) * rx;
    const y = Math.sin(t) * ry;
    out.push([cx + c * x - s * y, cy + s * x + c * y]);
  }
  return out;
}

export function rectPoly(x: number, y: number, w: number, h: number, r = 0): Poly {
  if (r <= 0) {
    return [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ];
  }
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  const out: Poly = [];
  const corner = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= 8; i++) {
      const a = a0 + (i / 8) * (Math.PI / 2);
      out.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
  };
  corner(x + w - rr, y + rr, -Math.PI / 2);
  corner(x + w - rr, y + h - rr, 0);
  corner(x + rr, y + h - rr, Math.PI / 2);
  corner(x + rr, y + rr, Math.PI);
  return out;
}
