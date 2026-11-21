// 筆先の形（アトラス）と紙の目（くり返し模様）を、その場でコードで作る。素材ファイルは使わない。
import type { GL, Tex } from "../gl";
import { GRAIN_IDS, TIP_IDS, type GrainId, type TipId } from "./presets";

export const TIP_CELL = 128;
export const TIP_GRID = 4;
export const GRAIN_SIZE = 512;

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function canvas2d(w: number, h: number): CanvasRenderingContext2D {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c.getContext("2d", { willReadFrequently: true })!;
}

type TipDraw = (ctx: CanvasRenderingContext2D, s: number, r: () => number) => void;

const TIP_DRAW: Record<TipId, TipDraw> = {
  round(ctx, s) {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "#fff");
    g.addColorStop(0.92, "#fff");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  },
  chalk(ctx, s, r) {
    for (let i = 0; i < 900; i++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * s * 0.46;
      const x = s / 2 + Math.cos(a) * d;
      const y = s / 2 + Math.sin(a) * d;
      ctx.fillStyle = `rgba(255,255,255,${0.12 + r() * 0.3})`;
      ctx.beginPath();
      ctx.arc(x, y, 1 + r() * 5, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  bristle(ctx, s, r) {
    // 毛束: 進む向き（局所 y）に沿った筋を、やわらかい楕円の中に。筋の濃さは控えめに揺らす。
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(s / 2, s / 2, s * 0.47, s * 0.47, 0, 0, Math.PI * 2);
    ctx.clip();
    for (let x = 0; x < s; x += 2) {
      const edge = Math.abs(x + 1 - s / 2) / (s / 2);
      const al = (0.62 + r() * 0.38) * (1 - Math.pow(edge, 3) * 0.6);
      const len = s * (0.78 + r() * 0.18) * Math.sqrt(Math.max(0, 1 - edge * edge));
      const y0 = s / 2 - len / 2 + (r() - 0.5) * s * 0.08;
      const g = ctx.createLinearGradient(0, y0, 0, y0 + len);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.18, `rgba(255,255,255,${al})`);
      g.addColorStop(0.82, `rgba(255,255,255,${al})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x, y0, 2, len);
    }
    ctx.restore();
  },
  flat(ctx, s, r) {
    // 毛は進む向き（局所 y）に沿って並ぶ。幅は局所 x いっぱい。
    for (let x = 4; x < s - 4; x += 2) {
      const al = 0.35 + r() * 0.65;
      const y0 = s * (0.18 + r() * 0.08);
      const y1 = s * (0.82 - r() * 0.08);
      const g = ctx.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.15, `rgba(255,255,255,${al})`);
      g.addColorStop(0.85, `rgba(255,255,255,${al})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x, y0, 2, y1 - y0);
    }
  },
  star(ctx, s) {
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 === 0 ? s * 0.46 : s * 0.19;
      ctx.lineTo(s / 2 + Math.cos(a) * rr, s / 2 + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  },
  leaf(ctx, s) {
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(s / 2, s * 0.04);
    ctx.bezierCurveTo(s * 0.9, s * 0.3, s * 0.85, s * 0.75, s / 2, s * 0.96);
    ctx.bezierCurveTo(s * 0.15, s * 0.75, s * 0.1, s * 0.3, s / 2, s * 0.04);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = s * 0.025;
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.moveTo(s / 2, s * 0.12);
    ctx.lineTo(s / 2, s * 0.92);
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
  },
  sparkle(ctx, s) {
    const c = s / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, s * 0.25);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = "#fff";
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
    ]) {
      ctx.beginPath();
      ctx.moveTo(c - dx * s * 0.48, c - dy * s * 0.48);
      ctx.lineTo(c + dy * s * 0.035, c + dx * s * 0.035);
      ctx.lineTo(c + dx * s * 0.48, c + dy * s * 0.48);
      ctx.lineTo(c - dy * s * 0.035, c - dx * s * 0.035);
      ctx.closePath();
      ctx.fill();
    }
  },
  splatter(ctx, s, r) {
    ctx.fillStyle = "#fff";
    for (let i = 0; i < 60; i++) {
      const a = r() * Math.PI * 2;
      const d = Math.pow(r(), 0.7) * s * 0.44;
      ctx.beginPath();
      ctx.arc(s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, 0.8 + Math.pow(r(), 3) * 8, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  grass(ctx, s, r) {
    ctx.fillStyle = "#fff";
    for (let i = 0; i < 7; i++) {
      const bx = s * (0.3 + r() * 0.4);
      const tip = s * (0.05 + r() * 0.3);
      const lean = (r() - 0.5) * s * 0.5;
      const w = s * (0.025 + r() * 0.025);
      ctx.beginPath();
      ctx.moveTo(bx - w, s * 0.98);
      ctx.quadraticCurveTo(bx - w * 0.5 + lean * 0.3, s * 0.5, bx + lean, tip);
      ctx.quadraticCurveTo(bx + w * 0.5 + lean * 0.3, s * 0.5, bx + w, s * 0.98);
      ctx.closePath();
      ctx.fill();
    }
  },
  heart(ctx, s) {
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(s / 2, s * 0.88);
    ctx.bezierCurveTo(s * 0.05, s * 0.55, s * 0.12, s * 0.12, s / 2, s * 0.3);
    ctx.bezierCurveTo(s * 0.88, s * 0.12, s * 0.95, s * 0.55, s / 2, s * 0.88);
    ctx.fill();
  },
  cloud(ctx, s, r) {
    for (let i = 0; i < 9; i++) {
      const x = s * (0.25 + r() * 0.5);
      const y = s * (0.35 + r() * 0.3);
      const rr = s * (0.12 + r() * 0.12);
      const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
      g.addColorStop(0, "rgba(255,255,255,0.9)");
      g.addColorStop(0.7, "rgba(255,255,255,0.75)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }
  },
  square(ctx, s) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(s * 0.08, s * 0.08, s * 0.84, s * 0.84);
  },
  petal(ctx, s) {
    const g = ctx.createLinearGradient(0, s * 0.05, 0, s * 0.95);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0.65)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(s / 2, s * 0.95);
    ctx.bezierCurveTo(s * 0.1, s * 0.6, s * 0.2, s * 0.08, s * 0.42, s * 0.06);
    ctx.quadraticCurveTo(s / 2, s * 0.14, s * 0.58, s * 0.06);
    ctx.bezierCurveTo(s * 0.8, s * 0.08, s * 0.9, s * 0.6, s / 2, s * 0.95);
    ctx.fill();
  },
  dryink(ctx, s, r) {
    // 毛筆のかすれ: 進む向き（局所 y）に沿う毛。ところどころ切れる。
    for (let x = 6; x < s - 6; x += 3) {
      const edge = Math.abs(x - s / 2) / (s / 2);
      if (r() < edge * 0.55) continue;
      const al = 0.55 + r() * 0.45;
      ctx.fillStyle = `rgba(255,255,255,${al})`;
      const h = s * (0.62 - edge * 0.3);
      ctx.fillRect(x, s / 2 - h / 2 + (r() - 0.5) * 6, 3, h);
    }
  },
};

/** くり返しになる値ノイズ（周期 p）。 */
function periodicNoise(size: number, period: number, r: () => number): Float32Array {
  const lat = new Float32Array(period * period);
  for (let i = 0; i < lat.length; i++) lat[i] = r();
  const out = new Float32Array(size * size);
  const sc = period / size;
  for (let y = 0; y < size; y++) {
    const fy = y * sc;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    const sy = ty * ty * (3 - 2 * ty);
    const ya = (y0 % period) * period;
    const yb = ((y0 + 1) % period) * period;
    for (let x = 0; x < size; x++) {
      const fx = x * sc;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const sx = tx * tx * (3 - 2 * tx);
      const xa = x0 % period;
      const xb = (x0 + 1) % period;
      const a = lat[ya + xa] + (lat[ya + xb] - lat[ya + xa]) * sx;
      const c = lat[yb + xa] + (lat[yb + xb] - lat[yb + xa]) * sx;
      out[y * size + x] = a + (c - a) * sy;
    }
  }
  return out;
}

function fbm(size: number, periods: number[], weights: number[], r: () => number): Float32Array {
  const out = new Float32Array(size * size);
  periods.forEach((p, i) => {
    const n = periodicNoise(size, p, r);
    for (let k = 0; k < out.length; k++) out[k] += n[k] * weights[i];
  });
  return out;
}

function normalize(f: Float32Array, gamma = 1): Uint8Array {
  // 2〜98% の範囲を 0..255 へ広げる
  const sorted = Float32Array.from(f).sort();
  const lo = sorted[Math.floor(sorted.length * 0.02)];
  const hi = sorted[Math.floor(sorted.length * 0.98)];
  const out = new Uint8Array(f.length);
  const d = Math.max(1e-6, hi - lo);
  for (let i = 0; i < f.length; i++) {
    const v = Math.min(1, Math.max(0, (f[i] - lo) / d));
    out[i] = Math.round(Math.pow(v, gamma) * 255);
  }
  return out;
}

const GRAIN_BUILD: Record<Exclude<GrainId, "none">, (s: number, r: () => number) => Uint8Array> = {
  paper(s, r) {
    const f = fbm(s, [128, 256, 512], [0.25, 0.4, 0.35], r);
    // 繊維: 斜めの細い筋を少し
    for (let i = 0; i < 260; i++) {
      let x = r() * s;
      let y = r() * s;
      const a = r() * Math.PI;
      const len = 10 + r() * 40;
      for (let t = 0; t < len; t++) {
        x += Math.cos(a);
        y += Math.sin(a);
        const xi = ((Math.round(x) % s) + s) % s;
        const yi = ((Math.round(y) % s) + s) % s;
        f[yi * s + xi] += 0.12;
      }
    }
    return normalize(f, 0.9);
  },
  canvas(s, r) {
    const f = fbm(s, [32, 64, 256], [0.35, 0.3, 0.25], r);
    const threads = 128; // 512 を割り切る本数（くり返しの継ぎ目が出ない）
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const u = (x / s) * threads * Math.PI * 2;
        const v = (y / s) * threads * Math.PI * 2;
        const warp = Math.sin(u) * 0.5 + 0.5;
        const weft = Math.sin(v) * 0.5 + 0.5;
        const over = (Math.floor((x / s) * threads) + Math.floor((y / s) * threads)) % 2 === 0;
        f[y * s + x] += (over ? warp * 0.8 + weft * 0.3 : weft * 0.8 + warp * 0.3) * 0.32;
      }
    }
    return normalize(f, 1);
  },
  rough(s, r) {
    const f = fbm(s, [16, 32, 64, 128], [0.4, 0.3, 0.2, 0.1], r);
    return normalize(f, 1.15);
  },
  noise(s, r) {
    const f = fbm(s, [256, 512], [0.3, 0.7], r);
    return normalize(f, 1);
  },
  streak(s, r) {
    // 横に伸びたノイズ（周期は横 16・縦 256）
    const lat = new Float32Array(16 * 256);
    for (let i = 0; i < lat.length; i++) lat[i] = r();
    const out = new Float32Array(s * s);
    for (let y = 0; y < s; y++) {
      const fy = (y / s) * 256;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      for (let x = 0; x < s; x++) {
        const fx = (x / s) * 16;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const g = (yy: number, xx: number) => lat[(yy % 256) * 16 + (xx % 16)];
        const a = g(y0, x0) + (g(y0, x0 + 1) - g(y0, x0)) * sx;
        const c = g(y0 + 1, x0) + (g(y0 + 1, x0 + 1) - g(y0 + 1, x0)) * sx;
        out[y * s + x] = a + (c - a) * ty;
      }
    }
    return normalize(out, 1);
  },
};

export interface BrushTextures {
  tips: Tex;
  grains: Map<GrainId, Tex>;
}

export function buildBrushTextures(gl: GL): BrushTextures {
  const S = TIP_CELL;
  const ctx = canvas2d(S * TIP_GRID, S * TIP_GRID);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, S * TIP_GRID, S * TIP_GRID);
  TIP_IDS.forEach((id, i) => {
    const cx = (i % TIP_GRID) * S;
    const cy = Math.floor(i / TIP_GRID) * S;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx, cy, S, S);
    ctx.clip();
    ctx.translate(cx, cy);
    TIP_DRAW[id](ctx, S, rng(1000 + i * 77));
    ctx.restore();
  });
  const img = ctx.getImageData(0, 0, S * TIP_GRID, S * TIP_GRID).data;
  const r8 = new Uint8Array(S * TIP_GRID * S * TIP_GRID);
  for (let i = 0; i < r8.length; i++) {
    // 白の上の明るさ × 不透明度
    r8[i] = Math.round((img[i * 4] * img[i * 4 + 3]) / 255);
  }
  const tips = gl.createTex(S * TIP_GRID, S * TIP_GRID, "r8", "brush:tips", { data: r8 });
  const grains = new Map<GrainId, Tex>();
  for (const id of GRAIN_IDS) {
    if (id === "none") continue;
    const data = GRAIN_BUILD[id](GRAIN_SIZE, rng(5000 + id.length * 131 + id.charCodeAt(0)));
    grains.set(id, gl.createTex(GRAIN_SIZE, GRAIN_SIZE, "r8", `grain:${id}`, { data, wrap: "repeat" }));
  }
  return { tips, grains };
}

export function tipIndex(id: TipId): number {
  return Math.max(0, TIP_IDS.indexOf(id));
}
