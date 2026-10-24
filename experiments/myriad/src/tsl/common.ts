/**
 * Shared TSL plumbing for MYRIAD: the per-frame uniforms every material reads
 * and the switches for the 31 techniques (each one is a 0/1 uniform so a
 * technique can be compared on/off live without recompiling anything).
 */
import { Color, DataTexture, Matrix4, RedFormat, UnsignedByteType, Vector2, Vector3 } from "three/webgpu";
import { float, hash, texture, uint, uniform, vec2 } from "./t";

/**
 * TSL nodes are typed very precisely by @types/three; shader code here is
 * verified by the WGSL compiler at runtime, so node values are kept loose.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type N = any;

export const FFT_BINS = 128;
export const fftData = new Uint8Array(FFT_BINS);
export const fftTexture = new DataTexture(fftData, FFT_BINS, 1, RedFormat, UnsignedByteType);
fftTexture.needsUpdate = true;

/** Per-frame values written by the engine before every render. */
export const G = {
  /** Chapter-local time in seconds (quantised in stop-motion mode, #14). */
  time: uniform(0),
  /** Unquantised chapter-local time. */
  smoothTime: uniform(0),
  /** Seconds since the page started (never quantised; for shimmer/noise). */
  clock: uniform(0),
  dt: uniform(1 / 60),
  /** Drawing-buffer size in device pixels. */
  screen: uniform(new Vector2(1, 1)),
  /** Device pixels covered by one world unit at view distance 1. */
  pxPerUnit: uniform(800),
  /** Focus distance and aperture (in pixels of blur at infinity) for #1. */
  focus: uniform(20),
  aperture: uniform(0),
  /** Chapter visibility (fades the active chapter in/out). */
  fade: uniform(1),
  /** Overall energy of the soundtrack 0..1 (#17). */
  level: uniform(0),
  /** Camera data for compute shaders (no camera exists there). */
  camPos: uniform(new Vector3()),
  viewProj: uniform(new Matrix4()),
  prevViewProj: uniform(new Matrix4()),
  viewMatrix: uniform(new Matrix4()),
  invView: uniform(new Matrix4()),
  near: uniform(0.1),
  far: uniform(1000),
  /** Camera velocity in world units / s (warp streaks of the sky, #9). */
  camVel: uniform(new Vector3()),
  warp: uniform(0),
  frame: uniform(0, "uint"),
  tint: uniform(new Color(1, 1, 1)),
};

export const fft = texture(fftTexture);

/** Magnitude 0..1 of the FFT bin a particle id is assigned to (#17). */
export function fftAt(id: N, lo = 2, hi = 72): N {
  const bin = hash(id.add(uint(9001))).mul(hi - lo).add(lo).floor();
  return fft.sample(vec2(bin.add(0.5).div(FFT_BINS), 0.5)).r;
}

/* ---------------------------------------------------------------------- */
/* technique switches                                                      */
/* ---------------------------------------------------------------------- */

const switches = new Map<number, ReturnType<typeof uniform>>();

/** 0/1 uniform for technique n (1..31). */
export function T(n: number): N {
  let u = switches.get(n);
  if (!u) {
    u = uniform(1);
    switches.set(n, u);
  }
  return u;
}

export function setTechnique(n: number, on: boolean) {
  T(n).value = on ? 1 : 0;
}

export function techniqueOn(n: number) {
  return (T(n).value as number) > 0.5;
}

/* ---------------------------------------------------------------------- */
/* random streams                                                          */
/* ---------------------------------------------------------------------- */

/** Independent uniform random number k (0..31) of particle i. */
export function rnd(i: N, k: number): N {
  return hash(i.mul(uint(32)).add(uint(k)));
}

/** Standard normal sample built from two random streams (Box–Muller). */
export function gauss(i: N, k: number): N {
  const u1 = rnd(i, k).max(1e-6);
  const u2 = rnd(i, k + 1);
  return float(-2).mul(u1.log()).sqrt().mul(u2.mul(Math.PI * 2).cos());
}
