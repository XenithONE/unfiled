/**
 * Rock shapes built once on the CPU: a seeded gradient noise, and an asteroid
 * mesh — a lumpy ellipsoid scarred by craters with raised rims — whose
 * normals are computed from the displaced geometry so real lights and
 * shadows fall on it correctly.
 */
import { BufferGeometry, IcosahedronGeometry, Vector3 } from "three/webgpu";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

/** Seeded 3D gradient (improved Perlin) noise, roughly −1..1. */
export function makeNoise3(seed = 1): (x: number, y: number, z: number) => number {
  const p = Array.from({ length: 256 }, (_, i) => i);
  let s = seed >>> 0;
  const rand = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const grad = (h: number, x: number, y: number, z: number) => {
    const k = h & 15;
    const u = k < 8 ? x : y;
    const v = k < 4 ? y : k === 12 || k === 14 ? x : z;
    return ((k & 1) === 0 ? u : -u) + ((k & 2) === 0 ? v : -v);
  };
  return (x, y, z) => {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);
    const u = fade(x);
    const v = fade(y);
    const w = fade(z);
    const A = perm[X] + Y;
    const AA = perm[A] + Z;
    const AB = perm[A + 1] + Z;
    const B = perm[X + 1] + Y;
    const BA = perm[B] + Z;
    const BB = perm[B + 1] + Z;
    return lerp(
      lerp(lerp(grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z), u), lerp(grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z), u), v),
      lerp(
        lerp(grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1), u),
        lerp(grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1), u),
        v,
      ),
      w,
    );
  };
}

/** A small seeded random generator (0..1). */
export function makeRandom(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

interface Crater {
  dir: Vector3;
  /** Angular radius (radians). */
  size: number;
  depth: number;
}

export interface Rock {
  geometry: BufferGeometry;
  /** Surface radius along a unit direction (before the ellipsoid stretch). */
  radiusAt(dir: Vector3): number;
  /** The ellipsoid stretch applied after the radius. */
  stretch: Vector3;
}

/**
 * An asteroid of unit size: an ellipsoid with fractal lumps and grooves,
 * `big` large and `small` small craters (bowls with raised rims).
 */
export function asteroidRock(seed: number, detail = 100, big = 18, small = 140, stretch = new Vector3(1.38, 0.84, 0.97)): Rock {
  const noise = makeNoise3(seed);
  const rand = makeRandom(seed * 7919 + 13);
  const craters: Crater[] = [];
  const randomDir = () => {
    const z = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    return new Vector3(r * Math.cos(a), r * Math.sin(a), z);
  };
  for (let k = 0; k < big; k++) craters.push({ dir: randomDir(), size: 0.12 + rand() ** 1.5 * 0.3, depth: 0 });
  for (let k = 0; k < small; k++) craters.push({ dir: randomDir(), size: 0.025 + rand() ** 2 * 0.06, depth: 0 });
  for (const c of craters) c.depth = c.size * (0.38 + rand() * 0.2);

  const fbm = (x: number, y: number, z: number, oct: number) => {
    let sum = 0;
    let amp = 0.5;
    let f = 1;
    for (let o = 0; o < oct; o++) {
      sum += amp * noise(x * f + o * 17.1, y * f - o * 9.3, z * f + o * 3.7);
      amp *= 0.5;
      f *= 2.03;
    }
    return sum;
  };

  const radiusAt = (v: Vector3) => {
    let r = 1 + 0.32 * fbm(v.x * 1.3, v.y * 1.3, v.z * 1.3, 5);
    const g = 1 - Math.abs(noise(v.x * 3.1 + 4, v.y * 3.1, v.z * 3.1));
    r += 0.05 * g * g;
    for (const c of craters) {
      const cos = v.dot(c.dir);
      if (cos < Math.cos(c.size * 1.8)) continue;
      const d = Math.acos(Math.min(1, cos)) / c.size;
      // flat-floored bowl, then a raised rim that fades into the plain
      r += c.depth * Math.max(d * d - 1, -0.72) * (d < 1 ? 1 : 0);
      r += c.depth * 0.32 * Math.exp(-(((d - 1) / 0.24) ** 2));
    }
    return r;
  };

  let geo: BufferGeometry = new IcosahedronGeometry(1, detail);
  geo.deleteAttribute("normal");
  geo.deleteAttribute("uv");
  geo = mergeVertices(geo);
  const pos = geo.getAttribute("position");
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const r = radiusAt(v);
    pos.setXYZ(i, v.x * r * stretch.x, v.y * r * stretch.y, v.z * r * stretch.z);
  }
  geo.computeVertexNormals();
  return { geometry: geo, radiusAt, stretch };
}

/**
 * A shard of broken rock: a sphere cut by random planes (each vertex is pulled
 * in to the nearest plane along its direction), so the pieces have flat
 * fracture faces and sharp edges, then a faint roughness. Flat-shaded.
 */
export function shardGeometry(seed: number, detail = 2, planes = 9): BufferGeometry {
  const rand = makeRandom(seed * 131 + 7);
  const noise = makeNoise3(seed + 3);
  const cuts: { n: Vector3; d: number }[] = [];
  for (let k = 0; k < planes; k++) {
    const z = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    cuts.push({ n: new Vector3(r * Math.cos(a), r * Math.sin(a), z), d: 0.5 + rand() * 0.42 });
  }
  const stretch = new Vector3(1 + rand() * 0.5, 0.65 + rand() * 0.3, 0.85 + rand() * 0.3);
  let geo: BufferGeometry = new IcosahedronGeometry(1, detail);
  geo.deleteAttribute("normal");
  geo.deleteAttribute("uv");
  geo = mergeVertices(geo);
  const pos = geo.getAttribute("position");
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let r = 1.2;
    for (const c of cuts) {
      const cos = v.dot(c.n);
      if (cos > 1e-3) r = Math.min(r, c.d / cos);
    }
    r *= 1 + 0.035 * noise(v.x * 3.3, v.y * 3.3, v.z * 3.3);
    pos.setXYZ(i, v.x * r * stretch.x, v.y * r * stretch.y, v.z * r * stretch.z);
  }
  geo = geo.toNonIndexed();
  geo.computeVertexNormals();
  return geo;
}

/** A small boulder: a lumpy, low-poly unit rock. */
export function boulderGeometry(seed: number, detail = 3): BufferGeometry {
  const noise = makeNoise3(seed);
  let geo: BufferGeometry = new IcosahedronGeometry(1, detail);
  geo.deleteAttribute("normal");
  geo.deleteAttribute("uv");
  geo = mergeVertices(geo);
  const pos = geo.getAttribute("position");
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const r = 1 + 0.28 * noise(v.x * 1.7, v.y * 1.7, v.z * 1.7) + 0.1 * noise(v.x * 4.1 + 3, v.y * 4.1, v.z * 4.1);
    pos.setXYZ(i, v.x * r * 1.2, v.y * r * 0.8, v.z * r);
  }
  geo.computeVertexNormals();
  return geo;
}
