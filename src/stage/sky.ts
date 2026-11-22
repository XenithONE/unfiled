/**
 * Sky — one night over the mirror, as shader functions.
 *
 * Nothing here is a texture of a sky: the gradient, the sun, the stars, the
 * Milky Way and the cloud deck are evaluated per pixel from a view direction,
 * so the very same function lights the dome overhead, the water (with the
 * reflected direction) and the glass and steel of the monoliths.
 *
 * The look is keyed by `tau` (0 = sunset … 0.5 = deep night … 1 = sunrise);
 * `setTime` interpolates hand-tuned keyframes on the CPU into uniforms.
 */
import {
  BackSide,
  Color,
  Matrix3,
  Mesh,
  MeshBasicNodeMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three/webgpu";
import type { Texture } from "three/webgpu";
import {
  Fn,
  abs,
  atan,
  cameraPosition,
  clamp,
  dot,
  exp,
  float,
  floor,
  hash,
  length,
  max,
  mix,
  normalize,
  positionWorld,
  pow,
  sin,
  smoothstep,
  step,
  texture,
  uint,
  uniform,
  vec2,
  vec3,
  vec4,
} from "./tsl";
import type { N } from "./tsl";

type RGB = [number, number, number];

/** sRGB hex (as it should read on screen) → linear RGB, times a gain. */
function c(hex: number, gain = 1): RGB {
  const k = new Color(hex);
  return [k.r * gain, k.g * gain, k.b * gain];
}

interface SkyKey {
  t: number;
  /** Sun elevation in degrees (negative: below the horizon). */
  elev: number;
  zenith: RGB;
  midSun: RGB;
  midAnti: RGB;
  horSun: RGB;
  horAnti: RGB;
  glow: RGB;
  glowK: number;
  sun: RGB;
  stars: number;
  cloudLit: RGB;
  cloudDark: RGB;
  cloudRim: RGB;
  cover: number;
  /** Emissive gain of the works (a lit panel reads dimmer under a bright sky). */
  slab: number;
  /** How dark the scrim behind the page text has to be. */
  scrim: number;
}

const BLACK: RGB = [0, 0, 0];

const NIGHT = {
  elev: -28,
  zenith: c(0x02040a),
  midSun: c(0x060b18),
  midAnti: c(0x050914),
  horSun: c(0x18263f),
  horAnti: c(0x131d33),
  glow: BLACK,
  glowK: 6,
  sun: BLACK,
  stars: 1,
  cloudLit: c(0x0c1020),
  cloudDark: c(0x030409),
  cloudRim: BLACK,
  cover: 0.2,
  slab: 0.86,
  scrim: 0.14,
} satisfies Omit<SkyKey, "t">;

const KEYS: SkyKey[] = [
  {
    // the sun rests in the notch of the L
    t: 0,
    elev: 2.4,
    zenith: c(0x2a5590, 0.9),
    midSun: c(0xd9c0a0, 0.86),
    midAnti: c(0x6680ae, 0.88),
    horSun: c(0xffb45e, 1.1),
    horAnti: c(0xa394a8, 0.75),
    glow: c(0xff9a44, 1.3),
    glowK: 60,
    sun: c(0xffd9a0, 13),
    stars: 0,
    cloudLit: c(0xffc79a),
    cloudDark: c(0x56506e, 0.8),
    cloudRim: c(0xffe6c4, 1.5),
    cover: 0.4,
    slab: 1.25,
    scrim: 0.66,
  },
  {
    // just gone
    t: 0.05,
    elev: -0.8,
    zenith: c(0x1d3a66, 0.9),
    midSun: c(0xe8a070, 0.85),
    midAnti: c(0x5a6a9a, 0.85),
    horSun: c(0xffa24a, 1.12),
    horAnti: c(0x8a7a98, 0.7),
    glow: c(0xff8a3a, 1.1),
    glowK: 38,
    sun: c(0xffb070, 5),
    stars: 0,
    cloudLit: c(0xff9a6a),
    cloudDark: c(0x4a3f5a, 0.8),
    cloudRim: c(0xffd0a0, 1.3),
    cover: 0.42,
    slab: 1.2,
    scrim: 0.62,
  },
  {
    t: 0.1,
    elev: -3.5,
    zenith: c(0x142a55),
    midSun: c(0xc88a7a, 0.9),
    midAnti: c(0x3f4f84),
    horSun: c(0xff7e3e, 1.05),
    horAnti: c(0x5d5a86, 0.7),
    glow: c(0xff5a2a, 0.8),
    glowK: 20,
    sun: BLACK,
    stars: 0.05,
    cloudLit: c(0xff6a5a, 1.05),
    cloudDark: c(0x2c2a44),
    cloudRim: c(0xff9a7a, 0.8),
    cover: 0.44,
    slab: 1.1,
    scrim: 0.55,
  },
  {
    t: 0.19,
    elev: -7.5,
    zenith: c(0x0b1736),
    midSun: c(0x36508c, 0.9),
    midAnti: c(0x1c2a58),
    horSun: c(0xc8684a, 0.55),
    horAnti: c(0x283462, 0.8),
    glow: c(0xb84a3a, 0.3),
    glowK: 12,
    sun: BLACK,
    stars: 0.35,
    cloudLit: c(0x6a5078, 0.5),
    cloudDark: c(0x10162c),
    cloudRim: BLACK,
    cover: 0.4,
    slab: 1,
    scrim: 0.34,
  },
  {
    t: 0.3,
    elev: -13,
    zenith: c(0x050a1a),
    midSun: c(0x101c3c),
    midAnti: c(0x0a1228),
    horSun: c(0x3a3050, 0.55),
    horAnti: c(0x101a34, 0.8),
    glow: c(0x6a3a4a, 0.06),
    glowK: 6,
    sun: BLACK,
    stars: 0.8,
    cloudLit: c(0x1a1e34),
    cloudDark: c(0x05070f),
    cloudRim: BLACK,
    cover: 0.3,
    slab: 0.94,
    scrim: 0.2,
  },
  { t: 0.42, ...NIGHT },
  { t: 0.64, ...NIGHT },
  {
    t: 0.75,
    elev: -13,
    zenith: c(0x050a1c),
    midSun: c(0x121e40),
    midAnti: c(0x0a1228),
    horSun: c(0x3a3458, 0.6),
    horAnti: c(0x101a34, 0.8),
    glow: c(0x5a3a5a, 0.06),
    glowK: 6,
    sun: BLACK,
    stars: 0.8,
    cloudLit: c(0x1a2038),
    cloudDark: c(0x05070f),
    cloudRim: BLACK,
    cover: 0.28,
    slab: 0.94,
    scrim: 0.2,
  },
  {
    t: 0.86,
    elev: -6.5,
    zenith: c(0x0e1a3e),
    midSun: c(0x4a5e98, 0.95),
    midAnti: c(0x1e2c5c),
    horSun: c(0xff9c7c, 0.75),
    horAnti: c(0x2c3868),
    glow: c(0xff7a5a, 0.4),
    glowK: 12,
    sun: BLACK,
    stars: 0.3,
    cloudLit: c(0xff8f9a, 0.6),
    cloudDark: c(0x141a34),
    cloudRim: BLACK,
    cover: 0.4,
    slab: 1,
    scrim: 0.36,
  },
  {
    t: 0.94,
    elev: -2,
    zenith: c(0x1b3566),
    midSun: c(0xf0b090, 0.9),
    midAnti: c(0x4a5c90),
    horSun: c(0xffb070, 1.1),
    horAnti: c(0x7a7898, 0.75),
    glow: c(0xff9a5a, 0.9),
    glowK: 22,
    sun: BLACK,
    stars: 0.03,
    cloudLit: c(0xffb098, 1.05),
    cloudDark: c(0x3a3852),
    cloudRim: c(0xffe0c0, 1.1),
    cover: 0.42,
    slab: 1.1,
    scrim: 0.56,
  },
  {
    t: 1,
    elev: 1.6,
    zenith: c(0x26487e, 0.95),
    midSun: c(0xf6c898, 0.92),
    midAnti: c(0x6478a6, 0.9),
    horSun: c(0xffc070, 1.15),
    horAnti: c(0x9a8fa8, 0.8),
    glow: c(0xffb060, 1.3),
    glowK: 55,
    sun: c(0xffe6b8, 12),
    stars: 0,
    cloudLit: c(0xffd0aa),
    cloudDark: c(0x4a4660, 0.9),
    cloudRim: c(0xfff0d0, 1.5),
    cover: 0.42,
    slab: 1.25,
    scrim: 0.66,
  },
];

const PHASES: Array<[number, string]> = [
  [0.035, "GOLDEN HOUR"],
  [0.075, "SUNSET"],
  [0.14, "AFTERGLOW"],
  [0.25, "BLUE HOUR"],
  [0.36, "DUSK"],
  [0.7, "NIGHT"],
  [0.81, "FIRST LIGHT"],
  [0.91, "BLUE HOUR"],
  [0.975, "DAWN"],
  [2, "SUNRISE"],
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const DEG = Math.PI / 180;

export class Sky {
  readonly mesh: Mesh;
  private noise: Texture;
  private material: MeshBasicNodeMaterial;

  // state the rest of the stage reads
  tau = 0;
  slabGain = 1;
  scrim = 0.5;
  /** 0 by day … 1 in the dead of night. */
  starlight = 0;
  readonly sunDirection = new Vector3(0, 0.1, -1);
  /** Colour of the glints the low sun lays on the water. */
  readonly glitterColor = new Vector3();
  /** Rough sky light reaching the ground (for what lies under the water). */
  readonly ambientColor = new Vector3();

  private azStart = -0.38;
  private azEnd = -Math.PI;

  private uSunDir = uniform(new Vector3(0, 0.02, -1));
  private uSunXZ = uniform(new Vector2(0, -1));
  private uZenith = uniform(new Vector3());
  private uMidSun = uniform(new Vector3());
  private uMidAnti = uniform(new Vector3());
  private uHorSun = uniform(new Vector3());
  private uHorAnti = uniform(new Vector3());
  private uGlow = uniform(new Vector3());
  private uGlowK = uniform(12);
  private uSun = uniform(new Vector3());
  private uStars = uniform(0);
  private uCloudLit = uniform(new Vector3());
  private uCloudDark = uniform(new Vector3());
  private uCloudRim = uniform(new Vector3());
  private uCovLo = uniform(0.5);
  private uCirrus = uniform(1);
  private uWind = uniform(new Vector2());
  private uTime = uniform(0);
  private uStarRot = uniform(new Matrix3());
  private uStarRadius = uniform(0.22);
  private uTwinkle = uniform(1);
  private uMeteorA = uniform(new Vector3(0, 1, 0));
  private uMeteorB = uniform(new Vector3(0.1, 1, 0));
  private uMeteorT = uniform(0);
  private uMeteorOn = uniform(0);
  private meteorNext = 6;
  private meteorStart = -10;
  private reduced = false;

  /** Gradient + sun glow only (cheap; for reflections on glass and metal). */
  readonly base: (dir: N) => N;
  /** Colour of the haze at the horizon in a given direction (for fog). */
  readonly horizon: (dir: N) => N;
  /** The whole sky; `starGain` dims the stars (their image in the water). */
  readonly full: (dir: N, starGain?: N) => N;

  constructor(noise: Texture, opts: { detail: 0 | 1 | 2 }) {
    this.noise = noise;
    const {
      uSunDir,
      uSunXZ,
      uZenith,
      uMidSun,
      uMidAnti,
      uHorSun,
      uHorAnti,
      uGlow,
      uGlowK,
      uSun,
      uStars,
      uCloudLit,
      uCloudDark,
      uCloudRim,
      uCovLo,
      uCirrus,
      uWind,
      uTime,
      uStarRot,
      uStarRadius,
      uTwinkle,
      uMeteorA,
      uMeteorB,
      uMeteorT,
      uMeteorOn,
    } = this;
    const noiseTex = (uvNode: N) => texture(this.noise, uvNode);

    const base = Fn(([d]: [N]) => {
      const ha = abs(d.y);
      const ca = dot(d.xz, uSunXZ).div(max(length(d.xz), 1e-4));
      const side = pow(ca.mul(0.5).add(0.5), 1.6);
      const k1 = exp(ha.mul(-14));
      const k2 = exp(ha.mul(-5));
      const mid = mix(uMidAnti, uMidSun, side);
      const hor = mix(uHorAnti, uHorSun, side);
      const col = mix(mix(uZenith, mid, k2), hor, k1).toVar();
      const cs = dot(d, uSunDir);
      col.addAssign(uGlow.mul(exp(cs.sub(1).mul(uGlowK))));
      return col;
    });
    this.base = (dir) => base(dir);

    const horizon = Fn(([d]: [N]) => {
      const flat = normalize(vec3(d.x, 0.012, d.z));
      return base(flat);
    });
    this.horizon = (dir) => horizon(dir);

    /** One shell of point stars: a random point in every lattice cell. */
    const starLayer = Fn(([d, scale, radius, density]: [N, N, N, N]) => {
      const p = d.mul(scale);
      const cell = floor(p);
      const f = p.sub(cell);
      const ci = cell.add(1024);
      const seed = ci.x
        .toUint()
        .add(ci.y.toUint().mul(uint(1031)))
        .add(ci.z.toUint().mul(uint(1048583)))
        .toVar();
      const r1 = hash(seed);
      const r2 = hash(seed.add(uint(1)));
      const r3 = hash(seed.add(uint(2)));
      const r4 = hash(seed.add(uint(3)));
      const r5 = hash(seed.add(uint(4)));
      const pos = vec3(r1, r2, r3).mul(0.6).add(0.2);
      const dist = length(f.sub(pos));
      const present = step(density.oneMinus(), r4);
      const mag = pow(max(r5, 0.0016), -0.9).mul(0.022).min(4.2).toVar();
      const size = radius.mul(smoothstep(0.4, 3.2, mag).mul(0.55).add(1));
      const core = smoothstep(size, size.mul(0.2), dist);
      const twinkle = sin(uTime.mul(r1.mul(3).add(1.5)).add(r2.mul(6.2832)))
        .mul(0.22)
        .mul(uTwinkle)
        .add(0.88);
      const tint = mix(vec3(0.72, 0.84, 1.0), vec3(1.0, 0.84, 0.66), r3.mul(r3));
      return tint.mul(core.mul(present).mul(mag).mul(twinkle));
    });

    const full = Fn(([d, starGain]: [N, N]) => {
      const col = base(d).toVar();
      const hc = max(d.y, 0).toVar();
      const cs = dot(d, uSunDir).toVar();

      // --- clouds: one fbm deck on a flattened dome -------------------------
      const pp = d.xz.div(hc.add(0.11));
      // stretched along one heading: long bars of high cloud
      const ps = vec2(pp.x.mul(0.8).add(pp.y.mul(0.6)), pp.y.mul(0.8).sub(pp.x.mul(0.6)).mul(1.6));
      const uvc = ps.mul(0.05).add(uWind).toVar();
      const warp = noiseTex(uvc.mul(0.55).add(vec2(0.31, 0.17))).ba.sub(0.5);
      const q = uvc.add(warp.mul(0.07)).toVar();
      const fine = noiseTex(q.mul(8.3).add(uWind.mul(1.4)))
        .b.mul(0.15)
        .add(noiseTex(q.mul(21.7).add(uWind.mul(2.3))).a.mul(0.07))
        .toVar();
      // mid-sized clumps break the big masses up into a flock
      const clump =
        opts.detail > 0
          ? noiseTex(q.mul(4.7).add(vec2(0.57, 0.23)).add(uWind.mul(0.9)))
              .a.sub(0.5)
              .mul(0.17)
          : float(0);
      const shape = (at: N) =>
        noiseTex(at)
          .r.mul(0.5)
          .add(noiseTex(at.mul(2.9).add(vec2(0.13, 0.71)).add(uWind.mul(0.6))).g.mul(0.28))
          .add(fine);
      const n = shape(q).add(clump).toVar();
      const cov = smoothstep(uCovLo, uCovLo.add(0.13), n).toVar();
      const nLit = shape(q.add(uSunXZ.mul(0.014))).add(clump);
      // A cloud is bright where it is thin and where it faces the sun, dark
      // in its body; all of it brighter the nearer it hangs to the sun.
      const near = pow(max(cs, 0), 1.5).mul(0.65).add(0.35);
      const thick = smoothstep(uCovLo.add(0.05), uCovLo.add(0.27), n).toVar();
      const toward = clamp(n.sub(nLit).mul(10).add(0.5), 0, 1);
      const shade = clamp(thick.oneMinus().mul(0.55).add(toward.mul(0.6)).sub(0.05), 0, 1).mul(near);
      const rim = pow(max(cs, 0), 6).mul(cov.oneMinus()).mul(cov).mul(4);
      // low cloud is seen through more air: it takes the colour of the horizon
      const low = smoothstep(0.34, 0.03, d.y);
      const lit = mix(uCloudLit, uHorSun.mul(0.92), low.mul(0.55));
      const cloud = mix(uCloudDark, lit, shade).add(uCloudRim.mul(rim)).toVar();
      const veil = cov
        .mul(thick.mul(0.42).add(0.52))
        .mul(smoothstep(0.012, 0.15, d.y))
        .toVar();

      // a second, higher layer: thin streaks of ice on another heading
      const pc = vec2(
        pp.x.mul(0.5).sub(pp.y.mul(0.87)),
        pp.x.mul(0.87).add(pp.y.mul(0.5)).mul(3.4),
      );
      const cirrus = float(0).toVar();
      if (opts.detail > 0) {
        const wisp = noiseTex(pc.mul(0.027).add(uWind.mul(0.4)).add(vec2(0.4, 0.8)))
          .a.mul(0.68)
          .add(noiseTex(pc.mul(0.12).add(uWind.mul(0.7))).r.mul(0.42));
        cirrus.assign(smoothstep(0.5, 0.86, wisp).mul(smoothstep(0.04, 0.3, d.y)).mul(uCirrus));
      }
      col.assign(mix(col, mix(uCloudLit, uZenith, 0.15).mul(near.mul(0.5).add(0.6)), cirrus.mul(0.4)));

      // --- stars and the Milky Way ------------------------------------------
      const dr = uStarRot.mul(d).toVar();
      const lat = dr.y;
      const band = exp(lat.mul(lat).mul(-13)).toVar();
      const stars = starLayer(dr, float(230), uStarRadius, float(0.6))
        .mul(band.mul(1.4).add(0.8))
        .toVar();
      stars.addAssign(starLayer(dr, float(71), float(0.07), float(0.22)).mul(1.5));
      if (opts.detail > 0) {
        // unresolved starlight: a band with a warm bulge at the core, torn
        // by dark dust that keeps to the midline
        const lon = atan(dr.z, dr.x);
        const uvm = vec2(lon.mul(0.36), lat.mul(1.15));
        const m1 = noiseTex(uvm.add(vec2(0.2, 0.4))).r;
        const m2 = noiseTex(uvm.mul(2.6).add(vec2(0.7, 0.1))).g;
        const m3 = noiseTex(uvm.mul(7.1).add(vec2(0.33, 0.52))).b;
        const bulge = exp(lon.mul(lon).mul(-2.6).sub(lat.mul(lat).mul(46)));
        const arm = exp(lat.mul(lat).mul(-26)).mul(exp(lon.mul(lon).mul(-0.3)).mul(0.8).add(0.2));
        const rift = lat.add(m1.sub(0.5).mul(0.1));
        const lanes = smoothstep(0.36, 0.66, m2.mul(0.65).add(m3.mul(0.35)))
          .mul(exp(rift.mul(rift).mul(-90)))
          .mul(0.92);
        // mottled, never smooth: clouds of stars too faint to tell apart
        const mottle = m1.mul(1.5).add(0.1).mul(m3.mul(m3).mul(1.6).add(0.35));
        const glow = arm.mul(mottle).add(bulge.mul(0.9)).mul(lanes.oneMinus());
        const milky = mix(vec3(0.56, 0.66, 0.96), vec3(1.0, 0.86, 0.68), bulge.mul(1.3).min(1));
        stars.addAssign(milky.mul(glow).mul(0.06));
      }
      // a shooting star: a short streak sliding along a chord of the dome
      const tail = mix(uMeteorA, uMeteorB, uMeteorT.sub(0.3).max(0));
      const head = mix(uMeteorA, uMeteorB, uMeteorT);
      const seg = head.sub(tail);
      const along = clamp(dot(d.sub(tail), seg).div(max(dot(seg, seg), 1e-6)), 0, 1);
      const off = length(d.sub(normalize(tail.add(seg.mul(along)))));
      const streak = smoothstep(0.0026, 0.0, off)
        .mul(along.mul(along))
        .mul(uMeteorT.mul(3.1416).sin().max(0));
      stars.addAssign(vec3(0.85, 0.93, 1.0).mul(streak).mul(uMeteorOn).mul(3.5));
      // stars drown in the haze near the horizon and behind the clouds
      const clear = smoothstep(0.0, 0.2, hc)
        .mul(veil.mul(0.95).oneMinus())
        .mul(cirrus.mul(0.5).oneMinus());
      col.addAssign(stars.mul(uStars).mul(clear).mul(starGain));

      col.assign(mix(col, cloud, veil));

      // --- the sun's disc ---------------------------------------------------
      const disc = smoothstep(0.99991, 0.99997, cs).mul(smoothstep(-0.004, 0.006, d.y));
      col.addAssign(uSun.mul(disc).mul(veil.mul(0.85).oneMinus()));
      return col;
    });
    this.full = (dir, starGain = float(1)) => full(dir, starGain);

    const material = new MeshBasicNodeMaterial();
    material.side = BackSide;
    // Drawn last and depth-tested: the dome only shades the pixels nothing
    // else has claimed (the water alone hides half of it).
    material.depthTest = true;
    material.depthWrite = false;
    material.fog = false;
    material.colorNode = vec4(full(normalize(positionWorld.sub(cameraPosition)), float(1)), 1);
    this.material = material;
    const mesh = new Mesh(new SphereGeometry(1, 48, 24), material);
    mesh.scale.setScalar(9000);
    mesh.frustumCulled = false;
    mesh.renderOrder = 100;
    this.mesh = mesh;

    this.setStarFrame(0);
    this.setTime(0);
  }

  /** Where the sun sets and where it comes back up (azimuth, radians). */
  setSunPath(azStart: number, azEnd: number) {
    this.azStart = azStart;
    this.azEnd = azEnd;
    this.setTime(this.tau);
  }

  /** Star size follows the pixel pitch so points neither vanish nor shimmer. */
  setPixelAngle(radiansPerPixel: number) {
    this.uStarRadius.value = Math.max(0.1, Math.min(0.42, radiansPerPixel * 230 * 1.2));
  }

  setReducedMotion(reduced: boolean) {
    this.reduced = reduced;
    this.uTwinkle.value = reduced ? 0.25 : 1;
  }

  private setStarFrame(tau: number) {
    // the Milky Way climbs out of the horizon ahead of the night leg of the
    // walk and leans back over the left shoulder; the sky turns a little
    const turn = (tau - 0.5) * 0.35;
    const dir = (az: number, el: number) =>
      new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    const core = dir(2.1 + turn, 0.16);
    const along = dir(0.95 + turn, 1.02);
    const pole = new Vector3().crossVectors(core, along).normalize();
    const third = new Vector3().crossVectors(core, pole).normalize();
    this.uStarRot.value.set(
      core.x, core.y, core.z,
      pole.x, pole.y, pole.z,
      third.x, third.y, third.z,
    );
  }

  setTime(tau: number) {
    const t = Math.max(0, Math.min(1, tau));
    this.tau = t;
    let i = 0;
    while (i < KEYS.length - 2 && t > KEYS[i + 1].t) i++;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const raw = (t - a.t) / Math.max(1e-6, b.t - a.t);
    const f = raw * raw * (3 - 2 * raw);
    const mix3 = (u: { value: Vector3 }, x: RGB, y: RGB) =>
      u.value.set(lerp(x[0], y[0], f), lerp(x[1], y[1], f), lerp(x[2], y[2], f));
    mix3(this.uZenith, a.zenith, b.zenith);
    mix3(this.uMidSun, a.midSun, b.midSun);
    mix3(this.uMidAnti, a.midAnti, b.midAnti);
    mix3(this.uHorSun, a.horSun, b.horSun);
    mix3(this.uHorAnti, a.horAnti, b.horAnti);
    mix3(this.uGlow, a.glow, b.glow);
    mix3(this.uSun, a.sun, b.sun);
    mix3(this.uCloudLit, a.cloudLit, b.cloudLit);
    mix3(this.uCloudDark, a.cloudDark, b.cloudDark);
    mix3(this.uCloudRim, a.cloudRim, b.cloudRim);
    this.uGlowK.value = lerp(a.glowK, b.glowK, f);
    this.uStars.value = lerp(a.stars, b.stars, f);
    this.starlight = this.uStars.value;
    this.uCovLo.value = 0.74 - lerp(a.cover, b.cover, f) * 0.46;
    // the high ice cloud all but vanishes against a dark sky
    this.uCirrus.value = 1 - this.starlight * 0.8;
    this.slabGain = lerp(a.slab, b.slab, f);
    this.scrim = lerp(a.scrim, b.scrim, f);
    this.glitterColor.copy(this.uHorSun.value).multiplyScalar(1.5);
    // mostly the cool light from overhead: the warm band is too low to reach down
    this.ambientColor
      .copy(this.uZenith.value)
      .multiplyScalar(1.6)
      .addScaledVector(this.uHorAnti.value, 0.9)
      .addScaledVector(this.uHorSun.value, 0.25);

    const elev = lerp(a.elev, b.elev, raw) * DEG;
    const az = lerp(this.azStart, this.azEnd, t);
    this.sunDirection.set(
      Math.sin(az) * Math.cos(elev),
      Math.sin(elev),
      -Math.cos(az) * Math.cos(elev),
    );
    this.uSunDir.value.copy(this.sunDirection);
    this.uSunXZ.value.set(Math.sin(az), -Math.cos(az));
    this.setStarFrame(t);
  }

  /** Clock on the instrument panel: one night, 18:42 → 05:52. */
  get clock() {
    const minutes = (18 * 60 + 42 + this.tau * 670) % 1440;
    const h = Math.floor(minutes / 60);
    const m = Math.floor(minutes % 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  get phase() {
    for (const [limit, name] of PHASES) if (this.tau < limit) return name;
    return "NIGHT";
  }

  /**
   * `drift` is how far the clouds have travelled (the stage advances it
   * faster while the visitor walks: hours pass in a few steps).
   */
  update(time: number, drift: number, viewAzimuth = 0) {
    this.uTime.value = time;
    this.uWind.value.set(drift * 0.0016, drift * 0.0007);

    // shooting stars: only in the dark, somewhere ahead of the camera
    const duration = 0.8;
    const age = time - this.meteorStart;
    if (age >= 0 && age <= duration) {
      this.uMeteorT.value = age / duration;
      this.uMeteorOn.value = this.starlight;
      return;
    }
    this.uMeteorOn.value = 0;
    if (time < this.meteorNext) return;
    this.meteorNext = time + 7 + Math.random() * 12;
    if (this.starlight < 0.6 || this.reduced) return;
    const dir = (az: number, el: number, out: Vector3) =>
      out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    const az = viewAzimuth + (Math.random() - 0.5) * 1.2;
    const el = 0.32 + Math.random() * 0.45;
    const side = Math.random() < 0.5 ? -1 : 1;
    dir(az, el, this.uMeteorA.value);
    dir(
      az + side * (0.12 + Math.random() * 0.16),
      el - (0.07 + Math.random() * 0.12),
      this.uMeteorB.value,
    );
    this.meteorStart = time;
  }

  followCamera(position: Vector3) {
    this.mesh.position.copy(position);
  }

  dispose() {
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}
