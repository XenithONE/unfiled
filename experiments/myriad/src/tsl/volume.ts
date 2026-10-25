/**
 * Volumes for MYRIAD (#41).
 *
 * A tileable 3D noise texture is baked once by a compute pass: periodic
 * gradient (Perlin) fBm, an inverted Worley fBm (billows) and a second fBm for
 * fine erosion and warping. Raymarched media then read noise as one filtered
 * texture fetch per step instead of evaluating a dozen noise octaves, which is
 * what makes a hundred steps per pixel affordable.
 */
import { LinearFilter, RepeatWrapping, RGBAFormat, HalfFloatType, Storage3DTexture } from "three/webgpu";
import {
  Fn,
  Loop,
  abs,
  dot,
  float,
  floor,
  fract,
  hash,
  instanceIndex,
  min,
  mix,
  sqrt,
  storageTexture3D,
  textureStore,
  uint,
  uniform,
  uvec3,
  vec2,
  vec3,
  vec4,
} from "./t";
import type { N } from "./common";

/** Hash of an integer lattice cell (cells wrap at `period`), 0..1. */
function cellHash(c: N, period: number, salt: number): N {
  const w = c.sub(floor(c.div(period)).mul(period));
  const x = uint(w.x);
  const y = uint(w.y);
  const z = uint(w.z);
  return hash(x.add(y.mul(uint(1031))).add(z.mul(uint(1062599))).add(uint(salt * 7919)));
}

/** Unit gradient of a lattice cell. */
function cellGrad(c: N, period: number, salt: number): N {
  const a = cellHash(c, period, salt).mul(Math.PI * 2);
  const z = cellHash(c, period, salt + 1).mul(2).sub(1);
  const r = sqrt(float(1).sub(z.mul(z)).max(0));
  return vec3(r.mul(a.cos()), r.mul(a.sin()), z);
}

/** Periodic gradient noise, ~[-1, 1]; p in lattice units, wraps at `period`. */
function perlin(p: N, period: number, salt: number): N {
  const i0 = floor(p).toVar();
  const f = fract(p).toVar();
  const u = f.mul(f).mul(f).mul(f.mul(f.mul(6).sub(15)).add(10)).toVar();
  const corner = (dx: number, dy: number, dz: number) => {
    const o = vec3(dx, dy, dz);
    return dot(cellGrad(i0.add(o), period, salt), f.sub(o));
  };
  const x00 = mix(corner(0, 0, 0), corner(1, 0, 0), u.x);
  const x10 = mix(corner(0, 1, 0), corner(1, 1, 0), u.x);
  const x01 = mix(corner(0, 0, 1), corner(1, 0, 1), u.x);
  const x11 = mix(corner(0, 1, 1), corner(1, 1, 1), u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z).mul(1.6);
}

/** Periodic Worley F1 (distance to the nearest feature point), 0..~1. */
function worley(p: N, period: number, salt: number): N {
  const i0 = floor(p).toVar();
  const f = fract(p).toVar();
  const best = float(9).toVar();
  Loop(27, ({ i }: { i: N }) => {
    const k = i.toFloat();
    const o = vec3(k.mod(3).sub(1), floor(k.div(3)).mod(3).sub(1), floor(k.div(9)).sub(1));
    const c = i0.add(o);
    const fp = vec3(cellHash(c, period, salt), cellHash(c, period, salt + 1), cellHash(c, period, salt + 2));
    const d = o.add(fp).sub(f);
    best.assign(min(best, dot(d, d)));
  });
  return sqrt(best);
}

export interface NoiseVolume {
  texture: Storage3DTexture;
  size: number;
  /** Compute node that fills the texture (run once). */
  bake: unknown;
  baked: boolean;
}

let shared: NoiseVolume | null = null;

/** The one noise volume every chapter shares (baked on first use). */
export function sharedNoise(): NoiseVolume {
  if (!shared) shared = makeNoiseVolume(96);
  return shared;
}

/** Bakes the shared noise if it has not been baked yet. */
export function ensureNoise(renderer: { compute(node: never): unknown }): NoiseVolume {
  const nv = sharedNoise();
  if (!nv.baked) {
    renderer.compute(nv.bake as never);
    nv.baked = true;
  }
  return nv;
}

/**
 * RGBA = (Perlin fBm, billows = 1 − Worley fBm, fine fBm, warp fBm), each
 * tiling every `size` texels.
 */
export function makeNoiseVolume(size = 96): NoiseVolume {
  const tex = new Storage3DTexture(size, size, size);
  tex.format = RGBAFormat;
  tex.type = HalfFloatType;
  tex.generateMipmaps = false;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.wrapR = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  const store = storageTexture3D(tex);
  const n = uniform(size, "uint");

  const bake = Fn(() => {
    const i = instanceIndex;
    const x = i.mod(n);
    const y = i.div(n).mod(n);
    const z = i.div(n.mul(n));
    const uvw = vec3(x.toFloat(), y.toFloat(), z.toFloat()).add(0.5).div(size).toVar();
    // gradient fBm: octaves at 4, 8, 16, 32, 64 cells per tile
    let fbm: N = float(0);
    let amp = 0.5;
    for (const per of [4, 8, 16, 32, 64]) {
      fbm = fbm.add(perlin(uvw.mul(per), per, per).mul(amp));
      amp *= 0.5;
    }
    // billows: 1 − Worley at 3 scales
    const w1 = worley(uvw.mul(4), 4, 101);
    const w2 = worley(uvw.mul(8), 8, 211);
    const w3 = worley(uvw.mul(16), 16, 307);
    const billow = float(1).sub(w1.mul(0.55).add(w2.mul(0.3)).add(w3.mul(0.15)));
    // fine erosion: higher octaves only
    const fine = perlin(uvw.mul(24), 24, 401).mul(0.6).add(perlin(uvw.mul(48), 48, 409).mul(0.3)).add(abs(perlin(uvw.mul(96), 96, 419)).mul(0.25));
    const warp = perlin(uvw.mul(6), 6, 503).mul(0.66).add(perlin(uvw.mul(12), 12, 509).mul(0.34));
    textureStore(store, uvec3(x, y, z), vec4(fbm, billow, fine, warp));
  })().compute(size * size * size, [64]);

  return { texture: tex, size, bake, baked: false };
}

/** Ray–box slab test: vec2(tNear, tFar) (tFar < tNear when missed). */
export function rayBox(ro: N, rd: N, bmin: N, bmax: N): N {
  const inv = vec3(1).div(rd.add(vec3(1e-7)));
  const t0 = bmin.sub(ro).mul(inv);
  const t1 = bmax.sub(ro).mul(inv);
  const tmin = t0.min(t1);
  const tmax = t0.max(t1);
  const near = tmin.x.max(tmin.y).max(tmin.z);
  const far = tmax.x.min(tmax.y).min(tmax.z);
  return vec2(near, far);
}
