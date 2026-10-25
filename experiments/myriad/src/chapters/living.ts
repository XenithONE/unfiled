/**
 * 命の星 — a living world: oceans, weather, cities, aurorae.
 *
 * Everything on the planet is computed per pixel from simplex noise; #15's
 * analytic gradients double as the light on the mountain relief. The
 * atmosphere is a real single-scattering integral (Rayleigh + Mie) marched
 * through the shell with a planet-shadow test per sample (#34): the blue
 * limb, the red terminator and the glow round the rising sun all come out of
 * it, with no texture. Clouds wind into cyclones, cast shadows and flicker
 * with lightning at night; cities, highways and glowing seas light the night
 * side; aurorae are curtains of radial streaks (#11) folded by curl noise;
 * meteors burn up in the upper air (#9).
 */
import {
  AdditiveBlending,
  CustomBlending,
  Mesh,
  MeshBasicNodeMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  SphereGeometry,
  Vector3,
} from "three/webgpu";
import {
  Fn,
  If,
  Loop,
  abs,
  acos,
  asin,
  cameraPosition,
  clamp,
  cos,
  cross,
  dot,
  exp,
  float,
  floor,
  fract,
  hash,
  instanceIndex,
  length,
  max,
  min,
  mix,
  normalLocal,
  normalWorld,
  normalize,
  positionWorld,
  pow,
  select,
  sin,
  smoothstep,
  sqrt,
  uint,
  uniform,
  varying,
  vec3,
  vec4,
} from "../tsl/t";
import type { Ctx, Look } from "../engine/chapter";
import { Chapter, ramp } from "../engine/chapter";
import { particleMesh } from "../engine/quad";
import type { Key, V3 } from "../engine/rig";
import { Shots } from "../engine/rig";
import type { N } from "../tsl/common";
import { G, T, gauss, rnd } from "../tsl/common";
import { curlNoise, snoiseGrad } from "../tsl/noise";
import { glowShape, ign, spriteVertex } from "../tsl/sprite";
import { sunSprite } from "../tsl/sun";
import { voronoi3d as voronoi3dTyped } from "three/addons/tsl/math/voronoiNoise.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const voronoi3d: any = voronoi3dTyped;

export const RP = 120;
const RC = RP * 1.012;
export const RA = RP * 1.07;
/** Toward the sun: low in the southern sky, so the north pole sits in its winter night. */
const L = new Vector3(0.75, -0.3, -0.59).normalize();
const POLE = new Vector3(-0.1, 1, 0.12).normalize();

/* the shots are laid out in a frame round the sun: L, W (up the sunrise horizon), K */
const PSI = 1.25;
const W1 = new Vector3(0, 1, 0).projectOnPlane(L).normalize();
const K1 = new Vector3().crossVectors(W1, L).normalize();
const W = W1.clone().multiplyScalar(Math.cos(PSI)).addScaledVector(K1, Math.sin(PSI)).normalize();
const K = new Vector3().crossVectors(W, L).normalize();
/** A unit direction from its parts along L, W and K. */
const dir = (l: number, w: number, k: number) =>
  new Vector3().addScaledVector(L, l).addScaledVector(W, w).addScaledVector(K, k).normalize();
const a3 = (v: Vector3): V3 => [v.x, v.y, v.z];
const v3 = (v: Vector3) => vec3(v.x, v.y, v.z);

const DEG = Math.PI / 180;
/** Angular radius of the sun (radians). */
const SUN_R = 0.0075;
const SUNRISE_T = 2.2;

/** The roll that turns the rig's world-up framing until `up` points up on screen. */
export function rollFor(pos: Vector3, look: Vector3, up: Vector3) {
  const fwd = look.clone().sub(pos).normalize();
  const right = new Vector3().crossVectors(fwd, new Vector3(0, 1, 0)).normalize();
  const camUp = new Vector3().crossVectors(right, fwd).normalize();
  const want = up.clone().projectOnPlane(fwd).normalize();
  return Math.atan2(new Vector3().crossVectors(camUp, want).dot(fwd), camUp.dot(want));
}

/**
 * A camera at radius r above unit direction c, heading along f (⊥ c), looking
 * at the horizon raised by `lift` degrees and turned by `yaw`, horizon level.
 */
function horizonKey(t: number, c: Vector3, r: number, f: Vector3, lift: number, yaw: number, fov: number): Key {
  const sb = RP / r;
  const cb = Math.sqrt(1 - sb * sb);
  const h = new Vector3().addScaledVector(c, -cb).addScaledVector(f, sb);
  const up = new Vector3().addScaledVector(c, sb).addScaledVector(f, cb);
  const look = h.multiplyScalar(Math.cos(lift * DEG)).addScaledVector(up, Math.sin(lift * DEG)).applyAxisAngle(up, yaw * DEG);
  const pos = c.clone().multiplyScalar(r);
  const at = pos.clone().addScaledVector(look, 100);
  return { t, pos: a3(pos), look: a3(at), fov, roll: rollFor(pos, at, c) };
}

/* low orbit at sunrise: the sun sits on the horizon straight ahead when e = 0 */
const R_LOW = 136;
const BETA = Math.asin(RP / R_LOW);
const C0 = new Vector3().addScaledVector(L, -Math.cos(BETA)).addScaledVector(W, Math.sin(BETA));
const F0 = new Vector3().addScaledVector(L, Math.sin(BETA)).addScaledVector(W, Math.cos(BETA));
const AXIS = new Vector3().crossVectors(C0, L).normalize();

/** The low-orbit camera with the sun `e` degrees above the horizon. */
const sunriseKey = (t: number, e: number, fov: number) =>
  horizonKey(t, C0.clone().applyAxisAngle(AXIS, e * DEG), R_LOW, F0.clone().applyAxisAngle(AXIS, e * DEG), 9, 12, fov);

/** A key looking from `pos` at `at` with `up` turned to the top of the frame. */
export function upKey(t: number, pos: Vector3, at: Vector3, up: Vector3, fov: number): Key {
  return { t, pos: a3(pos), look: a3(at), fov, roll: rollFor(pos, at, up) };
}

/** Where to look to see the sun glint off the sea from a camera direction. */
const glintPoint = (c: Vector3) => c.clone().add(L).normalize().multiplyScalar(RP);

const DAY_A = dir(0.32, 0.62, -0.72);
const DAY_B = dir(0.5, 0.56, -0.66);
/** Cyclones: centre, angular radius (rad) and twist at the eye (rad). */
const CYCLONES = [
  { d: dir(0.62, 0.7, -0.36), r: 0.12, k: 3.4 },
  { d: dir(0.3, 0.25, -0.92), r: 0.1, k: -3.0 },
  { d: dir(-0.5, -0.55, 0.67), r: 0.11, k: 3.2 },
];
/** The point that shows at (x, y) in NDC, `dist` away, from a camera key with `up` up. */
function onScreen(pos: Vector3, at: Vector3, up: Vector3, fov: number, x: number, y: number, dist: number) {
  const fwd = at.clone().sub(pos).normalize();
  const u = up.clone().projectOnPlane(fwd).normalize();
  const r = new Vector3().crossVectors(fwd, u);
  const ty = Math.tan((fov * DEG) / 2);
  const ray = fwd.addScaledVector(r, x * ty * (16 / 9)).addScaledVector(u, y * ty).normalize();
  return pos.clone().addScaledVector(ray, dist);
}

/* the closing wide shot, and the moon beyond the planet in it */
const WIDE_A = dir(-0.62, 0.42, 0.66).multiplyScalar(300);
const WIDE_B = dir(-0.55, 0.44, 0.71).multiplyScalar(600);
const WIDE_AT_A = K.clone().multiplyScalar(25);
const WIDE_AT_B = K.clone().multiplyScalar(60);
const MOON = onScreen(WIDE_B, WIDE_AT_B, POLE, 40, -0.48, 0.4, 1150);

/** fBm of the simplex basis, rotated between octaves. */
function fbm(p: N, octaves: number): N {
  let sum: N = float(0);
  let amp = 0.5;
  let q: N = p;
  for (let o = 0; o < octaves; o++) {
    sum = sum.add(snoiseGrad(q).w.mul(amp));
    q = vec3(q.y.mul(1.62).add(q.z.mul(0.32)), q.z.mul(1.62).sub(q.x.mul(0.32)), q.x.mul(1.62).add(q.y.mul(0.32))).add(5.2);
    amp *= 0.5;
  }
  return sum;
}

/* fbm's octave step q' = M·q + 5.2, and the gradient carried back through it */
const OCT: number[][] = [
  [0, 1.62, 0.32],
  [-0.32, 0, 1.62],
  [1.62, 0.32, 0],
];
const matMul = (a: number[][], b: number[][]) => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));

/** fBm (as `fbm`) and its analytic gradient with respect to p. */
function fbmD(p: N, octaves: number): { v: N; g: N } {
  let v: N = float(0);
  let g: N = vec3(0);
  let amp = 0.5;
  let q: N = p;
  let J = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let o = 0; o < octaves; o++) {
    const s = snoiseGrad(q).toVar();
    v = v.add(s.w.mul(amp));
    // ∇p = Jᵀ·∇q, with J = dq/dp = M^o
    const col = (j: number) => vec3(J[0][j], J[1][j], J[2][j]);
    g = g.add(vec3(dot(col(0), s.xyz), dot(col(1), s.xyz), dot(col(2), s.xyz)).mul(amp));
    q = vec3(q.y.mul(1.62).add(q.z.mul(0.32)), q.z.mul(1.62).sub(q.x.mul(0.32)), q.x.mul(1.62).add(q.y.mul(0.32))).add(5.2);
    J = matMul(OCT, J);
    amp *= 0.5;
  }
  return { v, g };
}

/** Random 0..1 per lattice cell (cells may be negative). */
function cellHash(cell: N, salt: number): N {
  const x = uint(cell.x.add(1024));
  const y = uint(cell.y.add(1024));
  const z = uint(cell.z.add(1024));
  return hash(x.add(y.mul(uint(2053))).add(z.mul(uint(4206193))).add(uint(salt)));
}

/** 1 while a feature of `size` world units still spans a few pixels, 0 once it would alias. */
function resolved(size: number): N {
  const perPx = length(positionWorld.sub(cameraPosition)).div(G.pxPerUnit);
  return float(1).sub(smoothstep(size / 4, size, perPx));
}

/** Continents, mountain ranges and the gradient that lights their relief. */
function ground(n: N): { h: N; land: N; slope: N } {
  const warp = snoiseGrad(n.mul(1.1).add(3.7)).xyz.mul(0.16);
  const q = n.mul(1.45).add(warp).toVar();
  const base = snoiseGrad(q);
  const h0 = base.w.mul(0.62).add(fbm(q.mul(2.3).add(1.3), 4).mul(0.38)).sub(0.06).toVar();
  // ridged ranges inland (a softened |n| keeps the crests from drawing hard lines),
  // with a finer ridged octave branching off the main crests like eroded spurs
  const r = snoiseGrad(q.mul(6.5).add(11.0));
  const s1 = sqrt(r.w.mul(r.w).add(0.004));
  const ridge = float(1).sub(s1);
  const r2 = snoiseGrad(q.mul(15).add(23.0));
  const s2 = sqrt(r2.w.mul(r2.w).add(0.004));
  const spur = float(1).sub(s2);
  const inland = smoothstep(0.03, 0.22, h0);
  const h = h0.add(ridge.mul(ridge).mul(0.2).add(ridge.mul(spur.mul(spur)).mul(0.1)).mul(inland)).toVar();
  // ∇ by the chain rule: d(ridge) = −(n/|n|)·∇n·6.5, d(spur) = −(n₂/|n₂|)·∇n₂·15
  const dRidge = r.xyz.mul(r.w.div(s1).negate()).mul(6.5);
  const dSpur = r2.xyz.mul(r2.w.div(s2).negate()).mul(15);
  const dMount = dRidge.mul(ridge.mul(0.4).add(spur.mul(spur).mul(0.1))).add(dSpur.mul(ridge.mul(spur).mul(0.2)));
  const slope = dMount.mul(inland).add(base.xyz.mul(0.62));
  return { h, land: smoothstep(-0.004, 0.01, h), slope };
}

/**
 * City lights as a point process: one candidate per lattice cell (the eight
 * nearest cells are checked, so there are no seams), kept with probability
 * `keep`, with a power-law size; f is the lattice frequency on the sphere.
 */
function cities(n: N, f: number, keep: number, salt: number): N {
  const p = n.mul(f).toVar();
  const base = floor(p.sub(0.5)).toVar();
  let sum: N = float(0);
  for (let k = 0; k < 8; k++) {
    const c = base.add(vec3(k & 1, (k >> 1) & 1, (k >> 2) & 1));
    const a = cellHash(c, salt);
    const b = cellHash(c, salt + 7);
    const jitter = vec3(b, fract(b.mul(61.7)), fract(b.mul(173.3))).sub(0.5).mul(0.8);
    const d = p.sub(normalize(c.add(0.5).add(jitter)).mul(f));
    const pop = pow(fract(a.mul(97.1)), 3);
    const size = pop.mul(0.22).add(0.05);
    const glow = exp(dot(d, d).div(size.mul(size)).negate()).mul(pop.mul(1.8).add(0.35));
    sum = sum.add(select(a.lessThan(keep), glow, float(0)));
  }
  return sum;
}

/** Rotates p about the unit axis k by angle a (Rodrigues). */
const rotateAbout = (p: N, k: N, a: N): N =>
  p.mul(cos(a)).add(cross(k, p).mul(sin(a))).add(k.mul(dot(k, p).mul(float(1).sub(cos(a)))));

/**
 * The living planet itself — ground, clouds and air — shared by the chapters
 * that visit it. `flashPos`/`flashPower` light it from a point (a fireball).
 */
export class LivingWorld {
  readonly level = uniform(1);
  readonly sun = uniform(L.clone());
  readonly spin = uniform(0);
  readonly flashPos = uniform(new Vector3());
  readonly flashPower = uniform(0);
  /** A shock front racing out through the cloud deck from flashPos. */
  readonly ringRadius = uniform(0);
  readonly ringPower = uniform(0);
  readonly meshes: Mesh[];

  constructor(sun: Vector3 = L) {
    this.sun.value.copy(sun).normalize();
    this.meshes = [this.buildSurface(), this.buildClouds(), this.buildAtmosphere()];
  }

  /** Light from the point source at a world position (inverse square, soft core). */
  private flashAt(p: N): N {
    const d = p.sub(this.flashPos);
    return vec3(1.0, 0.82, 0.6).mul(this.flashPower.div(dot(d, d).add(30)));
  }

  private buildSurface(): Mesh {
    const geo = new SphereGeometry(RP, 384, 256);
    const mat = new MeshBasicNodeMaterial();
    mat.colorNode = Fn(() => {
      const n = normalize(normalLocal);
      const { h, land, slope } = ground(n);
      const lat = abs(n.y);
      // deserts gather in the subtropics (~25°), forests in the wet tropics and temperate belts
      const subtropic = exp(lat.sub(0.42).div(0.15).pow(2).negate());
      const nearSea = float(1).sub(smoothstep(0.0, 0.16, h));
      const moist = fbm(n.mul(2.2).add(9.1), 3).mul(0.5).add(0.5).sub(subtropic.mul(0.15)).add(nearSea.mul(0.12)).add(0.1);
      const tone = snoiseGrad(n.mul(16).add(2.2)).w.mul(0.5).add(0.5);
      const speckle = mix(float(1), snoiseGrad(n.mul(70).add(5.5)).w.mul(0.25).add(1), resolved(1.5));
      // biomes from warmth, moisture and height
      // the shelf widens and narrows along the coast (no even outline round every shore)
      const shelf = snoiseGrad(n.mul(9).add(31)).w.mul(0.5).add(0.5).pow(2).mul(0.16).add(0.025);
      const ocean = mix(vec3(0.003, 0.018, 0.055), vec3(0.01, 0.1, 0.15), smoothstep(shelf.negate(), 0.0, h).pow(1.6));
      const warm = float(1).sub(smoothstep(0.35, 0.8, lat));
      const dry = mix(vec3(0.13, 0.12, 0.05), vec3(0.45, 0.29, 0.14), smoothstep(0.5, 0.26, moist));
      const wet = mix(vec3(0.04, 0.075, 0.035), vec3(0.015, 0.065, 0.02), warm);
      // sand seas, dark lava fields and red earth break up the dry lands
      const patch = snoiseGrad(n.mul(8).add(13.7)).w;
      const dryVaried = mix(mix(dry, dry.mul(vec3(0.55, 0.5, 0.45)), smoothstep(0.35, 0.7, patch)), dry.mul(vec3(1.2, 0.85, 0.65)), smoothstep(-0.3, -0.7, patch));
      let g: N = mix(dryVaried, wet, smoothstep(0.4, 0.6, moist)).mul(tone.mul(0.36).add(0.82)).mul(speckle);
      g = mix(g, vec3(0.19, 0.18, 0.14), smoothstep(0.66, 0.82, lat));
      // highlands brown, high ranges bare rock, snow only on the peaks and near the poles
      g = mix(g, g.mul(vec3(1.15, 0.95, 0.8)), smoothstep(0.25, 0.45, h));
      g = mix(g, vec3(0.22, 0.19, 0.16).mul(tone.mul(0.4).add(0.8)), smoothstep(0.5, 0.75, h));
      // snowcaps over the high ground (broad, broken by the wind), not lines along the crests
      const snowN = snoiseGrad(n.mul(34).add(7.7)).w.mul(0.05);
      g = mix(g, vec3(0.8, 0.83, 0.88), smoothstep(0.68, 0.84, h.add(lat.mul(0.32)).add(snowN)));
      const ice = smoothstep(0.9, 0.95, lat.add(fbm(n.mul(6), 2).mul(0.05)));
      const albedo = mix(mix(ocean, g, land), vec3(0.84, 0.89, 0.95), ice).toVar();
      const sea = float(1).sub(land).mul(float(1).sub(ice)).toVar();

      const nW = normalize(normalWorld);
      const mu = dot(nW, this.sun).toVar();
      const view = normalize(cameraPosition.sub(positionWorld));
      const col = albedo.mul(vec3(0.5, 0.6, 0.85)).mul(0.012).mul(smoothstep(0.05, -0.1, mu)).toVar();

      // day: relief, cloud shadows, the glint of the sun on the sea
      If(mu.greaterThan(-0.12), () => {
        // relief light from the analytic slope, its tilt capped so steep ranges stay rock, not gloss
        const tang = slope.sub(nW.mul(dot(slope, nW))).mul(land.mul(0.03));
        const bn = normalize(nW.sub(tang.mul(min(float(1), float(0.2).div(length(tang).max(1e-4))))));
        const day = smoothstep(-0.06, 0.2, mu).mul(max(dot(bn, this.sun), 0).mul(0.9).add(0.1));
        const shade = float(1).sub(this.cloudDensity(normalize(n.add(this.sun.mul(0.014))), 3).mul(0.62));
        const ripple = snoiseGrad(n.mul(240).add(G.clock.mul(0.12))).xyz.mul(resolved(1.2).mul(0.03));
        const nh = max(dot(normalize(nW.add(ripple)), normalize(this.sun.add(view))), 0);
        const glint = pow(nh, 420).mul(10).add(pow(nh, 48).mul(0.32));
        const fres = pow(float(1).sub(max(dot(nW, view), 0)), 5);
        const skyRefl = vec3(0.05, 0.12, 0.26).mul(fres).mul(smoothstep(-0.1, 0.3, mu));
        const spec = vec3(1.0, 0.93, 0.84).mul(glint).mul(smoothstep(-0.02, 0.12, mu)).add(skyRefl);
        col.addAssign(albedo.mul(day).add(spec.mul(sea)).mul(shade).mul(1.3));
      });

      // night: cities clustered along coasts and lowlands, and glowing seas
      const night = smoothstep(0.04, -0.12, mu);
      If(night.greaterThan(0.002), () => {
        const coast = float(1).sub(smoothstep(0.0, 0.12, h));
        const settled = land.mul(float(1).sub(ice)).mul(float(1).sub(smoothstep(0.18, 0.4, h)));
        const developed = smoothstep(0.38, 0.72, fbm(n.mul(3.2).add(21), 3).mul(0.5).add(0.5).add(coast.mul(0.22)));
        const big = cities(n, 26, 0.55, 100).mul(1.3);
        const mid = mix(float(0.012), cities(n, 80, 0.45, 200), resolved(3.0));
        const small = mix(float(0.01), cities(n, 240, 0.42, 300), resolved(1.0)).mul(0.6);
        const lights = big.add(mid).add(small).mul(developed).mul(settled).toVar();
        const grain = mix(float(1), snoiseGrad(n.mul(900)).w.mul(0.45).add(0.75), resolved(0.25));
        const city = mix(vec3(1.0, 0.52, 0.2), vec3(1.0, 0.85, 0.62), smoothstep(0.8, 2.2, lights)).mul(lights).mul(grain).mul(0.9);
        const current = n.mul(7).add(curlNoise(n.mul(2.5)).mul(0.08));
        const bloomZone = smoothstep(0.6, 0.8, fbm(n.mul(2.0).add(77), 2).mul(0.5).add(0.5));
        const bio = smoothstep(0.55, 0.85, fbm(current, 3).mul(0.5).add(0.5)).mul(bloomZone).mul(sea);
        col.addAssign(city.add(vec3(0.04, 0.75, 0.7).mul(bio).mul(0.32)).mul(night));
      });
      col.addAssign(albedo.mul(this.flashAt(positionWorld)));
      return col.mul(this.level);
    })();
    return new Mesh(geo, mat);
  }

  /**
   * The cloud field at a unit direction: cover 0..1 and, when asked, the
   * gradient of the underlying noise in the same frame as n (for relief
   * shading). `fine` adds the small-scale octaves while they are resolved.
   */
  private cloudField(n: N, octaves: number, fine: boolean, withGrad: boolean): { dens: N; grad: N } {
    const a = this.spin;
    const q0 = vec3(n.x.mul(cos(a)).sub(n.z.mul(sin(a))), n.y, n.x.mul(sin(a)).add(n.z.mul(cos(a)))).toVar();
    // cyclones wind the large systems into spiral bands round a clear eye; the
    // small-scale detail turns only a little, so shear never smears it flat
    let q: N = q0;
    let qd: N = q0;
    let eye: N = float(1);
    const turns: { axis: N; angle: N }[] = [];
    for (const c of CYCLONES) {
      const cv = v3(c.d);
      const ang = acos(clamp(dot(q, cv), -1, 1)).toVar();
      const w = float(1).sub(clamp(ang.div(c.r), 0, 1));
      const angle = w.mul(w).mul(c.k).toVar();
      q = rotateAbout(q, cv, angle).toVar();
      qd = rotateAbout(qd, cv, angle.mul(0.3)).toVar();
      turns.push({ axis: cv, angle: angle.mul(0.3) });
      eye = eye.mul(smoothstep(0.005, 0.012, ang));
    }
    // a gentle divergence-free flow (#15) bends the systems
    const flow = curlNoise(q.mul(1.6).add(3.1)).mul(0.012).toVar();
    const qs = q.add(flow);
    const qq = qd.add(flow).toVar();
    // climate belts: cloudy equator, clear subtropics, stormy mid-latitudes
    const lat = abs(asin(clamp(q0.y, -1, 1)));
    const belts = exp(lat.div(0.12).pow(2).negate())
      .mul(0.12)
      .sub(exp(lat.sub(0.45).div(0.15).pow(2).negate()).mul(0.16))
      .add(exp(lat.sub(0.9).div(0.2).pow(2).negate()).mul(0.12));
    // large systems (fronts, the comma clouds) and fractal detail on top
    const systems = fbm(qs.mul(1.9).add(11), 3);
    const body = fbmD(qq.mul(6.5).add(vec3(0, 0, G.clock.mul(0.004))), octaves);
    let d: N = systems.mul(0.55).add(body.v.mul(0.6)).add(belts);
    let g: N = body.g.mul(6.5 * 0.6);
    if (fine) {
      // honeycomb decks of stratocumulus in the subtropics (r186's moving 3D Voronoi, #32);
      // the 27-cell search runs only where a deck is there and resolved
      const decks = smoothstep(0.55, 0.75, fbm(qq.mul(2.4).add(40), 2).mul(0.5).add(0.5)).mul(exp(lat.sub(0.45).div(0.18).pow(2).negate())).mul(resolved(4.0)).toVar();
      const deckTerm = float(0).toVar();
      If(decks.greaterThan(0.002), () => {
        const cells = smoothstep(0.5, 0.12, voronoi3d(qq.mul(130), G.clock.mul(0.03)));
        deckTerm.assign(cells.sub(0.5).mul(decks).mul(0.22));
      });
      d = d.add(deckTerm);
      // the fine octaves only while they span pixels
      const k1 = resolved(2.0).mul(0.18).toVar();
      const fineV = float(0).toVar();
      const fineG = vec3(0).toVar();
      If(k1.greaterThan(0.002), () => {
        const f1 = fbmD(qq.mul(60).add(3.3), 3);
        fineV.assign(f1.v.mul(k1).add(snoiseGrad(qq.mul(240)).w.mul(resolved(0.5).mul(0.06))));
        fineG.assign(f1.g.mul(k1.mul(60 * 0.35)));
      });
      d = d.add(fineV);
      g = g.add(fineG);
    }
    const dens = smoothstep(0.1, 0.3, d).mul(eye);
    if (!withGrad) return { dens, grad: vec3(0) };
    // back through the cyclone turns and the drift, into n's frame
    for (let k = turns.length - 1; k >= 0; k--) g = rotateAbout(g, turns[k].axis, turns[k].angle.negate());
    g = vec3(g.x.mul(cos(a)).add(g.z.mul(sin(a))), g.y, g.z.mul(cos(a)).sub(g.x.mul(sin(a))));
    return { dens, grad: g };
  }

  /** Cloud cover 0..1 at a unit direction (shared by the clouds and their shadows). */
  private cloudDensity(n: N, octaves: number): N {
    return this.cloudField(n, octaves, false, false).dens;
  }

  private buildClouds(): Mesh {
    const geo = new SphereGeometry(RC, 360, 220);
    const mat = new MeshBasicNodeMaterial();
    mat.colorNode = Fn(() => {
      const n = normalize(normalLocal);
      const field = this.cloudField(n, 6, true, true);
      const dens = field.dens.toVar();
      const nW = normalize(normalWorld);
      const mu = dot(nW, this.sun);
      // relief: the cloud tops are a height field of the noise, tilted by its gradient
      // (the tilt is capped: where cyclones twist the field the gradient runs wild)
      const tilt = field.grad.sub(nW.mul(dot(field.grad, nW))).mul(0.02);
      const tiltCapped = tilt.mul(min(float(1), float(0.22).div(length(tilt).max(1e-4))));
      const top = normalize(nW.sub(tiltCapped));
      // sunlit, plus a faint moonlit grey on the night side
      const lit = smoothstep(-0.1, 0.25, mu)
        .mul(max(dot(top, this.sun), 0).mul(0.8).add(0.2))
        .add(smoothstep(0.05, -0.15, mu).mul(0.007));
      // thick towers brighter, thin veils greyer; the sunset light is red
      const body = mix(float(0.72), float(1.06), dens);
      const dusk = exp(mu.sub(0.03).div(0.11).pow(2).negate());
      const tint = mix(vec3(1.0, 0.99, 0.97), vec3(1.0, 0.5, 0.25), dusk.mul(0.85));
      // lightning: soft flashes inside storm cells on the night side
      const cp = n.mul(42);
      const id = cellHash(floor(cp), 17);
      const storm = smoothstep(0.58, 0.78, fbm(n.mul(3.0).add(40), 2).mul(0.5).add(0.5));
      const tick = floor(G.clock.mul(5).add(id.mul(31)));
      const strike = smoothstep(0.994, 1.0, hash(uint(tick.mul(7919).add(id.mul(65536)))));
      const seed = uint(id.mul(1e6));
      const off = vec3(rnd(seed, 1), rnd(seed, 2), rnd(seed, 3)).sub(0.5).mul(0.5);
      const local = fract(cp).sub(0.5).sub(off);
      const blob = exp(dot(local, local).mul(-14));
      const flick = sin(G.clock.mul(73).add(id.mul(40))).mul(0.5).add(0.5);
      const night = smoothstep(0.08, -0.08, mu);
      const bolt = vec3(0.65, 0.75, 1.0).mul(strike.mul(blob).mul(flick).mul(storm).mul(night).mul(6));
      // the shock front through the deck: a broad, torn swell, not a drawn circle
      const torn = snoiseGrad(n.mul(60)).w.mul(1.6);
      const shock = exp(length(positionWorld.sub(this.flashPos)).sub(this.ringRadius).add(torn).div(3.2).pow(2).negate()).mul(this.ringPower).mul(dens.mul(0.7).add(0.3));
      const flashLit = this.flashAt(positionWorld).mul(body).add(vec3(1.0, 0.9, 0.8).mul(shock));
      return vec4(tint.mul(lit).mul(body).add(bolt).add(flashLit).mul(this.level), dens.mul(0.94).add(shock.mul(0.3)).min(1));
    })();
    mat.transparent = true;
    mat.depthWrite = false;
    const mesh = new Mesh(geo, mat);
    mesh.renderOrder = 1;
    return mesh;
  }

  /**
   * #34 single scattering: march the view ray through the shell; from each
   * sample, sunlight is tested against the planet (its shadow) and dimmed
   * along the chord to space. Rayleigh gives the blue limb and the red
   * terminator, a forward-peaked Mie lobe the glow round the sun. The surface
   * behind is dimmed by the transmittance (premultiplied "over").
   */
  private buildAtmosphere(): Mesh {
    const geo = new SphereGeometry(RA, 192, 128);
    const mat = new MeshBasicNodeMaterial();
    const Hr = (RA - RP) * 0.25;
    const Hm = (RA - RP) * 0.09;
    // Earth-like vertical optical depths: Rayleigh 0.046 / 0.108 / 0.265, Mie 0.02
    const bR = [5.8, 13.5, 33.1].map((v) => (v / 33.1) * (0.265 / Hr));
    const betaR = vec3(bR[0], bR[1], bR[2]);
    const betaM = 0.02 / Hm;
    // the same sunlight as the ground's (albedo · E/π = albedo · 1.3)
    const sunI = 1.3 * Math.PI;
    const g = 0.72;
    // airglow: a thin emitting layer high in the shell (green, seen edge-on)
    const hGlow = (RA - RP) * 0.62;
    const wGlow = (RA - RP) * 0.03;
    mat.colorNode = Fn(() => {
      const ro = cameraPosition;
      const rd = normalize(positionWorld.sub(ro)).toVar();
      const b = dot(ro, rd);
      const r2 = dot(ro, ro);
      const sq = sqrt(max(b.mul(b).sub(r2.sub(RA * RA)), 0));
      const t0 = max(b.negate().sub(sq), 0).toVar();
      const t1 = b.negate().add(sq);
      const dp = b.mul(b).sub(r2.sub(RP * RP));
      const tHit = b.negate().sub(sqrt(max(dp, 0)));
      const tEnd = select(dp.greaterThan(0).and(tHit.greaterThan(0)), tHit, t1);
      const steps = 22;
      const seg = max(tEnd.sub(t0), 0).div(steps).toVar();
      const jit = ign();
      const sumR = vec3(0).toVar();
      const sumM = vec3(0).toVar();
      const odR = float(0).toVar();
      const odM = float(0).toVar();
      const airglow = float(0).toVar();
      Loop(steps, ({ i }: { i: N }) => {
        const p = ro.add(rd.mul(t0.add(seg.mul(float(i).add(jit))))).toVar();
        const hgt = length(p).sub(RP).toVar();
        const dR = exp(hgt.div(-Hr)).mul(seg);
        const dM = exp(hgt.div(-Hm)).mul(seg);
        airglow.addAssign(exp(hgt.sub(hGlow).div(wGlow).pow(2).negate()).mul(seg));
        // sunlight reaching p: blocked by the planet, dimmed along the chord to space
        const bl = dot(p, this.sun);
        const perp = sqrt(max(dot(p, p).sub(bl.mul(bl)), 0));
        const lit = select(bl.greaterThan(0), float(1), smoothstep(RP * 0.995, RP * 1.012, perp));
        const tl = bl.negate().add(sqrt(max(bl.mul(bl).sub(dot(p, p).sub(RA * RA)), 0)));
        const lR = float(0).toVar();
        const lM = float(0).toVar();
        for (let k = 0; k < 5; k++) {
          const hq = length(p.add(this.sun.mul(tl.mul((k + 0.5) / 5)))).sub(RP);
          lR.addAssign(exp(hq.div(-Hr)));
          lM.addAssign(exp(hq.div(-Hm)));
        }
        const segL = tl.div(5);
        const tau = betaR
          .mul(odR.add(dR.mul(0.5)).add(lR.mul(segL)))
          .add(vec3(betaM * 1.1).mul(odM.add(dM.mul(0.5)).add(lM.mul(segL))));
        const att = exp(tau.negate()).mul(lit);
        sumR.addAssign(att.mul(dR));
        sumM.addAssign(att.mul(dM));
        odR.addAssign(dR);
        odM.addAssign(dM);
      });
      const mu = dot(rd, this.sun);
      const phaseR = mu.mul(mu).add(1).mul(3 / (16 * Math.PI));
      const phaseM = mu
        .mul(mu)
        .add(1)
        .mul((3 * (1 - g * g)) / (8 * Math.PI * (2 + g * g)))
        .div(pow(max(float(1 + g * g).sub(mu.mul(2 * g)), 1e-4), 1.5));
      const inscatter = sumR
        .mul(betaR)
        .mul(phaseR)
        .add(sumM.mul(phaseM.mul(betaM)))
        .mul(sunI)
        .add(vec3(0.3, 1.0, 0.45).mul(airglow.mul(0.0028)));
      const trans = exp(betaR.mul(odR).add(vec3(betaM * 1.1).mul(odM)).negate());
      const alpha = float(1).sub(dot(trans, vec3(0.27, 0.5, 0.23)));
      // #34 off: a plain fresnel rim instead of the integral
      const nW = normalize(normalWorld);
      const rim = pow(float(1).sub(abs(dot(nW, rd))), 2.5);
      const rimCol = vec3(0.3, 0.55, 1.0).mul(rim).mul(smoothstep(-0.3, 0.4, dot(nW, this.sun))).mul(0.9);
      const on = T(34);
      return vec4(mix(rimCol, inscatter, on).mul(this.level), alpha.mul(on));
    })();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = CustomBlending;
    mat.blendSrc = OneFactor;
    mat.blendDst = OneMinusSrcAlphaFactor;
    const mesh = new Mesh(geo, mat);
    mesh.renderOrder = 3;
    return mesh;
  }
}

export class LivingChapter extends Chapter {
  readonly id = "living";
  readonly numeral = "";
  readonly name = "命の星";
  readonly caption = "海と雲と灯り。生きている星は、夜も眠らない。";
  readonly duration = 28;
  readonly techniques = [34, 37, 39, 11, 9, 15, 4, 12, 31];

  private readonly world = new LivingWorld();
  private readonly level = this.world.level;
  private readonly sun = this.world.sun;

  constructor() {
    super();
    this.fadeIn = 1.0;
  }

  build(ctx: Ctx) {
    this.group.add(...this.world.meshes, this.buildMoon());
    // the sun hides behind the limb and reddens through the same air as the sky
    this.group.add(sunSprite({ dir: this.sun, level: this.level, planet: RP, airScale: (RA - RP) * 0.25, size: SUN_R }));
    this.group.add(this.buildAurora(Math.round(260_000 * Math.max(0.35, ctx.q))));
    this.group.add(this.buildMeteors(Math.round(5_000 * Math.max(0.5, ctx.q))));

    // over the polar night, just short of the auroral oval, facing the pole
    const midnight = L.clone().negate().projectOnPlane(POLE).normalize();
    const dusk = new Vector3().crossVectors(POLE, midnight);
    const polar = (phi: number) =>
      POLE.clone()
        .multiplyScalar(Math.cos(0.54))
        .addScaledVector(midnight.clone().multiplyScalar(Math.cos(phi)).addScaledVector(dusk, Math.sin(phi)), Math.sin(0.54))
        .normalize();
    const poleward = (c: Vector3) => POLE.clone().projectOnPlane(c).normalize();
    this.track = new Shots([
      [sunriseKey(0, -2.6, 54), sunriseKey(SUNRISE_T, 0, 53), sunriseKey(6.6, 5.2, 50)],
      [
        upKey(6.6, DAY_A.clone().multiplyScalar(262), glintPoint(DAY_A).multiplyScalar(0.92), POLE, 44),
        upKey(13.2, DAY_B.clone().multiplyScalar(236), glintPoint(DAY_B).multiplyScalar(0.9), POLE, 42),
      ],
      [
        horizonKey(13.2, polar(-0.22), 140, poleward(polar(-0.22)), 5, -6, 58),
        horizonKey(20.6, polar(0.18), 144, poleward(polar(0.18)), 6, 6, 56),
      ],
      [
        upKey(20.6, WIDE_A, WIDE_AT_A, POLE, 46),
        upKey(28, WIDE_B, WIDE_AT_B, POLE, 40),
      ],
    ]);
  }

  /* ------------------------------------------------------------------ */

  private buildMoon(): Mesh {
    const geo = new SphereGeometry(34, 128, 96);
    const mat = new MeshBasicNodeMaterial();
    mat.colorNode = Fn(() => {
      const n = normalize(normalLocal);
      const maria = smoothstep(0.1, 0.35, fbm(n.mul(1.6).add(4), 3));
      const pits = snoiseGrad(n.mul(14)).w.mul(0.5).add(snoiseGrad(n.mul(37)).w.mul(0.25));
      const albedo = mix(vec3(0.42, 0.41, 0.4), vec3(0.17, 0.17, 0.18), maria).mul(pits.mul(0.18).add(1));
      const ndl = dot(normalize(normalWorld), this.sun);
      return albedo.mul(smoothstep(-0.04, 0.25, ndl).mul(max(ndl, 0).mul(0.85).add(0.15))).mul(1.5).mul(this.level);
    })();
    const m = new Mesh(geo, mat);
    m.position.copy(MOON);
    return m;
  }


  /**
   * Aurorae: curtains round the magnetic poles. Each grain is a short radial
   * streak (#11, locked to the local vertical); the curtain folds ripple with
   * curl noise (#15); green below, red and violet above.
   */
  private buildAurora(count: number): Mesh {
    const i = instanceIndex;
    const south = rnd(i, 0).lessThan(0.15);
    const poleN = select(south, normalize(vec3(0.08, -1, 0.05)), v3(POLE));
    const e1 = normalize(cross(poleN, vec3(0.3, 0.1, 1)));
    const e2 = cross(poleN, e1);
    const phi = rnd(i, 1).mul(Math.PI * 2);
    const curtain = floor(rnd(i, 2).mul(2));
    const t = G.time;
    // the oval: a colatitude that wanders with the folds of each curtain
    const fold = sin(phi.mul(5).add(curtain.mul(2.1)).add(t.mul(0.35)))
      .mul(0.035)
      .add(sin(phi.mul(13).sub(t.mul(0.8)).add(curtain)).mul(0.012));
    const col0 = float(0.33).add(curtain.mul(0.03)).add(fold);
    const flat = e1.mul(cos(phi)).add(e2.mul(sin(phi)));
    const base = normalize(poleN.mul(cos(col0)).add(flat.mul(sin(col0))));
    const curl = curlNoise(base.mul(9).add(vec3(0, t.mul(0.08), 0))).mul(0.0035).mul(T(15));
    const n = normalize(base.add(curl));
    const alt = rnd(i, 3).pow(1.8);
    const pos = n.mul(float(RP + 1.6).add(alt.mul(9)));
    // rays: irregular striations along the curtain, each with its own strength
    const stripe = smoothstep(0.4, 1.0, sin(phi.mul(420).add(snoiseGrad(n.mul(30).add(t.mul(0.4))).w.mul(6))).mul(0.5).add(0.5));
    const strength = smoothstep(0.3, 1.0, snoiseGrad(vec3(phi.mul(60), t.mul(0.3), curtain.mul(5))).w.mul(0.5).add(0.5));
    const ray = stripe.mul(0.6).add(0.4).mul(strength);
    const pulseA = snoiseGrad(vec3(phi.mul(3), curtain, t.mul(0.5))).w.mul(0.5).add(0.6);
    // substorm activity: some arcs blaze while others are barely there
    const activity = smoothstep(0.15, 0.85, snoiseGrad(vec3(cos(phi).mul(1.8), sin(phi).mul(1.8), t.mul(0.12).add(curtain.mul(3.1)))).w.mul(0.5).add(0.5));
    const tint = mix(mix(vec3(0.25, 1.0, 0.5), vec3(1.0, 0.25, 0.45), smoothstep(0.35, 0.8, alt)), vec3(0.55, 0.35, 1.0), smoothstep(0.85, 1.0, alt).mul(0.6));
    const bottom = exp(alt.mul(-3.2)).mul(1.6).add(0.25);
    const night = smoothstep(0.15, -0.1, dot(n, this.sun));
    const sprite = spriteVertex({ center: pos, radius: float(0.09), axis: n, axisHalf: float(0.7), minPx: 0.8, visible: night });
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = varying(tint.mul(ray.mul(0.85).add(0.15)).mul(bottom).mul(pulseA).mul(activity.mul(1.4).add(0.06)).mul(night).mul(0.07).mul(this.level));
    mat.opacityNode = glowShape(sprite, 0.2).mul(sprite.energy);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    return particleMesh(count, mat, 6);
  }

  /** Meteors burning in the upper air; one in a hundred is a bolide (#9). */
  private buildMeteors(count: number): Mesh {
    const i = instanceIndex;
    const start = rnd(i, 0).mul(this.duration);
    const life = rnd(i, 1).mul(0.9).add(0.35);
    const tl = G.time.sub(start).toVar();
    const u = clamp(tl.div(life), 0, 1).toVar();
    const alive = tl.greaterThan(0).and(tl.lessThan(life.add(1.6)));
    const bolide = rnd(i, 2).lessThan(0.012);
    const entry = normalize(vec3(gauss(i, 3), gauss(i, 5), gauss(i, 7)));
    const travel = normalize(cross(entry, normalize(vec3(gauss(i, 9), gauss(i, 11), gauss(i, 13)))));
    const heading = normalize(travel.sub(entry.mul(0.45)));
    const p0 = entry.mul(RP + 9);
    const speed = float(14).mul(select(bolide, float(0.7), float(1)));
    const head = p0.add(heading.mul(speed.mul(min(tl, life))));
    const tail = p0.add(heading.mul(speed.mul(max(min(tl, life).sub(0.18), 0))));
    // brightness: rises, peaks and dies; the train lingers dimly
    const burn = sin(u.mul(Math.PI)).mul(select(tl.lessThan(life), float(1), float(0)));
    const train = exp(tl.sub(life).max(0).mul(-1.6)).mul(0.12);
    const night = smoothstep(0.1, -0.1, dot(entry, this.sun)).mul(0.85).add(0.15);
    const hue = rnd(i, 14);
    const tint = mix(mix(vec3(0.45, 1.0, 0.55), vec3(1.0, 0.7, 0.35), smoothstep(0.4, 0.7, hue)), vec3(0.75, 0.6, 1.0), smoothstep(0.85, 1.0, hue));
    const big = select(bolide, float(4), float(1));
    const sprite = spriteVertex({
      center: head,
      radius: float(0.08).mul(big),
      tail: mix(head, tail, T(9)),
      streakKeep: 1,
      minPx: 0.8,
      maxPx: 80,
      visible: select(alive, float(1), float(0)),
    });
    const flash = select(bolide, exp(u.sub(0.7).div(0.08).pow(2).negate()).mul(8), float(0));
    // one burning right past the lens would only be a smear: let those go
    const near = smoothstep(8, 30, length(head.sub(cameraPosition)));
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = varying(tint.mul(burn.mul(big).add(train).add(flash)).mul(night).mul(near).mul(1.4).mul(this.level));
    mat.opacityNode = glowShape(sprite, 0.5).mul(sprite.energy);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    return particleMesh(count, mat, 7);
  }

  /* ------------------------------------------------------------------ */

  update(_ctx: Ctx, t: number) {
    this.level.value = 1;
    this.world.spin.value = t * 0.004;
  }

  look(t: number, out: Look) {
    // the aurora is bright everywhere at once: less bloom while it fills the frame
    const polar = t >= 13.2 && t < 20.6 ? 1 : 0;
    out.bloom = [0.75 - polar * 0.35, 0.55 - polar * 0.2, 0.9];
    out.exposure = 1.0;
    out.flare = 0.5;
    out.sky = 0.5;
    out.near = 0.2;
    out.far = 20000;
    out.focus = 200;
    out.aperture = 0;
    out.flash = 0;
    out.flashColor = [1.0, 0.9, 0.78];
    out.warp = (1 - ramp(t, 0, 1.0)) * 0.5 + ramp(t, 26.8, 28) * 0.5;
    // #39 the rising sun throws shafts across the limb
    const sunrise = 1 - ramp(t, 5.4, 6.6);
    const s = this.sun.value as Vector3;
    out.rays = 0.55 * sunrise;
    out.raysDir = [s.x, s.y, s.z];
    out.raysColor = [1.0, 0.82, 0.6];
  }
}
