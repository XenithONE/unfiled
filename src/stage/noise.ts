/**
 * Small tileable data textures generated on the CPU at start-up. Sampling a
 * filtered, mip-mapped texture a few times is far cheaper (and smoother) than
 * evaluating procedural noise per pixel, which matters because the sky is
 * shaded twice: once overhead and once mirrored in the water.
 */
import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RGBAFormat,
  RepeatWrapping,
  UnsignedByteType,
} from "three/webgpu";
import { rng } from "./rng";

function finish(data: Uint8Array, size: number, anisotropy: number) {
  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.colorSpace = NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** One tileable octave of smooth value noise on an n × n lattice. */
function valueOctave(size: number, cells: number, rand: () => number) {
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
  const out = new Float32Array(size * size);
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * cells;
    const y0 = Math.floor(fy);
    const ty = fade(fy - y0);
    const ya = (y0 % cells) * cells;
    const yb = ((y0 + 1) % cells) * cells;
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const x0 = Math.floor(fx);
      const tx = fade(fx - x0);
      const xa = x0 % cells;
      const xb = (x0 + 1) % cells;
      const top = lattice[ya + xa] + (lattice[ya + xb] - lattice[ya + xa]) * tx;
      const bottom = lattice[yb + xa] + (lattice[yb + xb] - lattice[yb + xa]) * tx;
      out[y * size + x] = top + (bottom - top) * ty;
    }
  }
  return out;
}

/**
 * RGBA noise, tileable: each channel is an independent four-octave fbm. The
 * shaders add two or three more lookups at other scales on top.
 */
export function makeNoiseTexture(size = 512, seed = 20261122) {
  const rand = rng(seed);
  const data = new Uint8Array(size * size * 4);
  for (let c = 0; c < 4; c++) {
    const sum = new Float32Array(size * size);
    let amp = 0.5;
    let total = 0;
    for (const cells of [6, 12, 24, 48]) {
      const o = valueOctave(size, cells, rand);
      for (let i = 0; i < sum.length; i++) sum[i] += o[i] * amp;
      total += amp;
      amp *= 0.5;
    }
    // stretch to use the full 8-bit range
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < sum.length; i++) {
      const v = sum[i] / total;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    for (let i = 0; i < sum.length; i++)
      data[i * 4 + c] = Math.round((255 * (sum[i] / total - lo)) / (hi - lo));
  }
  return finish(data, size, 4);
}

/**
 * Tileable ripple field for the water: RG = surface slope (x, z) packed to
 * 0..1 around 0.5, B = height, A = a second, finer height for glints.
 * Built from sine waves with whole wave numbers so it repeats exactly.
 */
export function makeRippleTexture(size = 512, seed = 7) {
  const rand = rng(seed);
  interface Wave {
    kx: number;
    ky: number;
    amp: number;
    phase: number;
  }
  const waves: Wave[] = [];
  const wind = 0.6; // radians; ripples run mostly across this heading
  for (let i = 0; i < 56; i++) {
    const k = 2 + Math.floor(Math.pow(rand(), 1.6) * 46);
    // directions cluster around the wind, with a broad spread
    const spread = (rand() + rand() + rand() - 1.5) * 1.5;
    const angle = wind + spread + (rand() < 0.5 ? Math.PI : 0);
    const kx = Math.round(Math.cos(angle) * k);
    const ky = Math.round(Math.sin(angle) * k);
    if (kx === 0 && ky === 0) continue;
    const mag = Math.hypot(kx, ky);
    waves.push({ kx, ky, amp: (0.5 + rand() * 0.5) / Math.pow(mag, 1.35), phase: rand() * 6.2832 });
  }
  const sx = new Float32Array(size * size);
  const sy = new Float32Array(size * size);
  const h = new Float32Array(size * size);
  const h2 = new Float32Array(size * size);
  const tau = Math.PI * 2;
  for (const w of waves) {
    const fine = Math.hypot(w.kx, w.ky) > 18;
    for (let y = 0; y < size; y++) {
      const py = (y / size) * w.ky;
      for (let x = 0; x < size; x++) {
        const a = tau * ((x / size) * w.kx + py) + w.phase;
        const c = Math.cos(a) * w.amp;
        const i = y * size + x;
        sx[i] += c * w.kx;
        sy[i] += c * w.ky;
        const s = Math.sin(a) * w.amp;
        h[i] += s;
        if (fine) h2[i] += s;
      }
    }
  }
  const norm = (arr: Float32Array, target: number) => {
    let sq = 0;
    for (let i = 0; i < arr.length; i++) sq += arr[i] * arr[i];
    const rms = Math.sqrt(sq / arr.length) || 1;
    const k = target / rms;
    for (let i = 0; i < arr.length; i++) arr[i] *= k;
  };
  // slopes: rms 0.26 leaves the tails inside ±1 after packing
  const slopeRms = Math.sqrt(
    (sx.reduce((a, v) => a + v * v, 0) + sy.reduce((a, v) => a + v * v, 0)) / (2 * sx.length),
  );
  const ks = 0.26 / (slopeRms || 1);
  norm(h, 0.25);
  norm(h2, 0.25);
  const data = new Uint8Array(size * size * 4);
  const pack = (v: number) => Math.max(0, Math.min(255, Math.round((v * 0.5 + 0.5) * 255)));
  for (let i = 0; i < sx.length; i++) {
    data[i * 4] = pack(sx[i] * ks);
    data[i * 4 + 1] = pack(sy[i] * ks);
    data[i * 4 + 2] = pack(h[i]);
    data[i * 4 + 3] = pack(h2[i]);
  }
  return finish(data, size, 16);
}
