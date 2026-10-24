/**
 * 灼熱の星 — a star seen close enough to feel its weather.
 *
 * New in r186: the animated 3D Voronoi of `three/addons/tsl/math` boils the
 * surface into granules whose cells drift and merge (#32). Sunspots carry
 * penumbral filaments, the limb darkens and reddens, faculae brighten toward
 * the edge. Magnetic loops (prominences) are stateless particle ropes that
 * twist (#13) and stream; one of them erupts into a flare and a coronal mass
 * ejection whose grains stretch along their velocity (#9).
 */
import { AdditiveBlending, Mesh, MeshBasicNodeMaterial, SphereGeometry, Vector3 } from "three/webgpu";
import { voronoi3d as voronoi3dTyped } from "three/addons/tsl/math/voronoiNoise.js";
import {
  Fn,
  abs,
  acos,
  atan,
  cameraPosition,
  clamp,
  cos,
  cross,
  dot,
  exp,
  float,
  floor,
  fract,
  instanceIndex,
  length,
  max,
  mix,
  normalLocal,
  normalWorld,
  normalize,
  positionWorld,
  pow,
  select,
  sin,
  smoothstep,
  uint,
  uniform,
  varying,
  vec2,
  vec3,
} from "../tsl/t";
import type { Ctx, Look } from "../engine/chapter";
import { Chapter, pulse, ramp } from "../engine/chapter";
import { particleMesh } from "../engine/quad";
import { Track } from "../engine/rig";
import type { N } from "../tsl/common";
import { G, T, gauss, rnd } from "../tsl/common";
import { fbm2, snoiseGrad } from "../tsl/noise";
import { glowShape, spriteVertex } from "../tsl/sprite";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const voronoi3d: any = voronoi3dTyped;

const R = 300;
/** The active region: flare, eruption and CME all start here. */
const E = new Vector3(0.94, 0.3, 0.14).normalize();
const FLARE_T = 12.6;
const CME_T = 13.4;

function dirFromLatLon(lat: number, lon: number) {
  return new Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
}
const SPOTS = [
  { c: E.clone().add(new Vector3(-0.05, -0.04, 0.03)).normalize(), r: 0.07 },
  { c: E.clone().add(new Vector3(0.07, -0.02, -0.06)).normalize(), r: 0.045 },
  { c: dirFromLatLon(-0.28, 1.2), r: 0.055 },
  { c: dirFromLatLon(0.18, 1.9), r: 0.035 },
  { c: dirFromLatLon(-0.12, 0.35), r: 0.03 },
];

interface Loop {
  a: Vector3;
  b: Vector3;
  h: number;
  w: number;
}
const LOOPS: Loop[] = [
  // the one that erupts (index 0)
  { a: E.clone().add(new Vector3(-0.09, 0.02, 0.07)).normalize(), b: E.clone().add(new Vector3(0.09, -0.03, -0.06)).normalize(), h: 0.24 * R, w: 30 },
  { a: dirFromLatLon(0.55, 0.9), b: dirFromLatLon(0.42, 1.35), h: 0.32 * R, w: 34 },
  { a: dirFromLatLon(-0.5, 0.6), b: dirFromLatLon(-0.62, 1.15), h: 0.2 * R, w: 24 },
  { a: dirFromLatLon(0.05, 1.55), b: dirFromLatLon(-0.12, 1.85), h: 0.13 * R, w: 16 },
  { a: dirFromLatLon(0.32, 0.2), b: dirFromLatLon(0.12, 0.45), h: 0.16 * R, w: 20 },
  { a: dirFromLatLon(-0.2, 2.2), b: dirFromLatLon(0.02, 2.45), h: 0.27 * R, w: 30 },
];

const v3 = (v: Vector3) => vec3(v.x, v.y, v.z);

export class SunChapter extends Chapter {
  readonly id = "sun";
  readonly numeral = "";
  readonly name = "灼熱の星";
  readonly caption = "表面は沸き立ち、磁場の弧が炎を吊り上げる。";
  readonly duration = 23;
  readonly techniques = [32, 33, 20, 13, 9, 4, 12, 31];

  private readonly level = uniform(1);
  private readonly flare = uniform(0);
  private readonly wave = uniform(0);
  private readonly erupt = uniform(0);
  private readonly cme = uniform(-1);
  private transit!: Mesh;

  constructor() {
    super();
    this.fadeIn = 0;
    this.fadeOut = 0;
    this.events = [{ t: FLARE_T, name: "burst" }];
  }

  build(ctx: Ctx) {
    this.group.add(this.buildPhotosphere(), this.buildChromosphere(), this.buildCorona());
    this.group.add(this.buildLoops(Math.round(360_000 * Math.max(0.3, ctx.q))));
    this.group.add(this.buildArcade(Math.round(260_000 * Math.max(0.3, ctx.q))));
    this.group.add(this.buildCme(Math.round(420_000 * Math.max(0.3, ctx.q))));
    this.transit = this.buildTransit();
    this.group.add(this.transit);
    this.track = new Track([
      { t: 0, pos: [0, 80, 2800], look: [0, 0, 0], fov: 28 },
      { t: 6, pos: [-150, 160, 1500], look: [40, 20, 0], fov: 34 },
      { t: 11, pos: [-260, 200, 1000], look: [210, 90, 0], fov: 42 },
      { t: 13.5, pos: [-280, 210, 1060], look: [240, 100, 10], fov: 44 },
      { t: 17, pos: [-220, 270, 1350], look: [430, 170, 60], fov: 50 },
      { t: 20.2, pos: [1450, 720, 900], look: [300, 110, 0], fov: 58 },
      { t: 24, pos: [1720, 800, 780], look: [220, 70, 0], fov: 72 },
    ]);
  }

  /* ---------------------------------------------------------------- */

  private buildPhotosphere(): Mesh {
    const geo = new SphereGeometry(R, 384, 256);
    const mat = new MeshBasicNodeMaterial();
    mat.colorNode = Fn(() => {
      const n = normalize(normalLocal);
      const t = G.time;
      // #32 granulation: two scales of animated 3D Voronoi cells
      const g1 = voronoi3d(n.mul(74), t.mul(0.45));
      const g2 = voronoi3d(n.mul(190), t.mul(0.7));
      const gran = mix(float(0.36), float(1.35), float(1).sub(smoothstep(0.05, 0.75, g1)))
        .mul(mix(float(0.84), float(1.06), float(1).sub(smoothstep(0.1, 0.85, g2))));
      const sup = fbm2(n.mul(5.5).add(t.mul(0.01))).mul(0.08).add(1);
      let I: N = gran.mul(sup);
      // sunspots with penumbral filaments
      let active: N = float(0);
      for (const s of SPOTS) {
        const c = v3(s.c);
        const ang = acos(clamp(dot(n, c), -1, 1));
        const umbra = float(1).sub(smoothstep(s.r * 0.36, s.r * 0.5, ang));
        const pen = float(1).sub(smoothstep(s.r * 0.86, s.r * 1.12, ang));
        const e1 = normalize(cross(c, vec3(0, 1, 0)));
        const e2 = cross(c, e1);
        const u = n.sub(c.mul(dot(n, c)));
        const az = atan(dot(u, e2), dot(u, e1));
        const fil = sin(az.mul(38).add(snoiseGrad(n.mul(260)).w.mul(2.5))).mul(0.5).add(0.5);
        I = I.mul(mix(float(1), mix(fil.mul(0.32).add(0.36), float(0.05), umbra), pen));
        active = max(active, float(1).sub(smoothstep(s.r * 1.2, s.r * 3.2, ang)));
      }
      // faculae: bright mottles around active regions, clearest near the limb
      const view = normalize(cameraPosition.sub(positionWorld));
      const mu = clamp(dot(normalize(normalWorld), view), 0, 1);
      const fac = smoothstep(0.55, 0.85, fbm2(n.mul(90)).mul(0.5).add(0.5)).mul(active).mul(float(1).sub(mu)).mul(0.9);
      I = I.add(fac);
      // flare ribbons and the shock wave that runs across the surface
      const angE = acos(clamp(dot(n, v3(E)), -1, 1));
      const e1E = normalize(cross(v3(E), vec3(0, 1, 0)));
      const across = dot(n.sub(v3(E).mul(dot(n, v3(E)))), e1E);
      const ribbonMask = float(1).sub(smoothstep(0.03, 0.06, angE));
      const ribbons = exp(across.sub(0.012).div(0.003).pow(2).negate()).add(exp(across.add(0.012).div(0.003).pow(2).negate()));
      const flare = ribbons.mul(ribbonMask).mul(this.flare).mul(14);
      const ring = exp(angE.sub(this.wave).div(0.012).pow(2).negate()).mul(smoothstep(0.0, 0.05, this.wave)).mul(float(1).sub(smoothstep(0.25, 0.6, this.wave))).mul(1.6);
      // limb darkening and reddening
      const ld = float(1).sub(float(1).sub(mu).mul(0.58)).sub(float(1).sub(mu).pow(2).mul(0.2));
      const col = mix(vec3(1.0, 0.16, 0.02), vec3(1.0, 0.55, 0.16), pow(mu, 0.5));
      return col.mul(I.mul(ld).add(ring)).mul(1.1).add(vec3(1.0, 0.95, 0.88).mul(flare)).mul(this.level);
    })();
    const mesh = new Mesh(geo, mat);
    mesh.renderOrder = -5;
    return mesh;
  }

  /** H-alpha fringe with spicules at the limb. */
  private buildChromosphere(): Mesh {
    const geo = new SphereGeometry(R * 1.012, 256, 128);
    const mat = new MeshBasicNodeMaterial();
    mat.colorNode = Fn(() => {
      const n = normalize(normalLocal);
      const view = normalize(cameraPosition.sub(positionWorld));
      const mu = abs(dot(normalize(normalWorld), view));
      const rim = pow(float(1).sub(mu), 7);
      const spic = snoiseGrad(vec3(n.x.mul(420), n.y.mul(60), n.z.mul(420))).w.mul(0.5).add(0.5);
      return vec3(1.0, 0.3, 0.22).mul(rim).mul(spic.mul(1.2).add(0.4)).mul(2.2).mul(this.level);
    })();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    const mesh = new Mesh(geo, mat);
    mesh.renderOrder = 2;
    return mesh;
  }

  /** The corona: a soft halo with ray-like streamers. */
  private buildCorona(): Mesh {
    const sprite = spriteVertex({ center: vec3(0, 0, 0), radius: float(R * 4.2), minPx: 8, maxPx: 6000 });
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    const p = sprite.local;
    const r = length(p).mul(4.2);
    const a = atan(p.y, p.x);
    // irregular streamers: noise around the rim at three angular scales
    const ring = vec3(a.cos(), a.sin(), G.time.mul(0.01));
    const streak = snoiseGrad(ring.mul(vec3(1.6, 1.6, 1))).w.mul(0.5).add(snoiseGrad(ring.mul(vec3(5.2, 5.2, 1)).add(7)).w.mul(0.3)).add(snoiseGrad(ring.mul(vec3(13, 13, 1)).add(3)).w.mul(0.2)).mul(0.5).add(0.5).pow(3);
    const fall = exp(r.sub(1).mul(-3.4)).mul(0.55).add(exp(r.sub(1).mul(-0.85)).mul(0.08));
    const outside = smoothstep(0.985, 1.02, r);
    mat.colorNode = vec3(1.0, 0.86, 0.66).mul(this.level);
    mat.opacityNode = fall.mul(streak.mul(2.2).add(0.35)).mul(outside).mul(float(1).sub(smoothstep(3.6, 4.2, r))).mul(0.7);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    return particleMesh(1, mat, -3);
  }

  /**
   * Prominences: ropes of cool plasma held up by magnetic loops. Each rope is
   * a bundle of threads whose offsets wander coherently along the loop (a
   * noise field sampled at the thread's own seed), the whole bundle turning
   * once along its length (#13). Plasma streams along; some drains back.
   */
  private buildLoops(count: number): Mesh {
    const per = Math.floor(count / LOOPS.length);
    const i = instanceIndex;
    const k = i.div(uint(per)).min(uint(LOOPS.length - 1));
    const pick = (f: (l: Loop) => Vector3 | number): N => {
      let out: N = typeof f(LOOPS[0]) === "number" ? float(f(LOOPS[0]) as number) : v3(f(LOOPS[0]) as Vector3);
      for (let j = 1; j < LOOPS.length; j++) {
        const v = f(LOOPS[j]);
        out = select(k.equal(uint(j)), typeof v === "number" ? float(v) : v3(v), out);
      }
      return out;
    };
    const A = pick((l) => l.a);
    const B = pick((l) => l.b);
    const H = pick((l) => l.h);
    const W = pick((l) => l.w);
    const isErupting = k.equal(uint(0));
    const speed = rnd(i, 1).mul(0.04).add(0.015).mul(select(rnd(i, 2).lessThan(0.55), float(1), float(-1)));
    const s = fract(rnd(i, 0).add(G.time.mul(speed))).toVar();
    const lift = select(isErupting, float(1).add(this.erupt), float(1));
    const base = normalize(mix(A, B, s));
    const h = H.mul(sin(s.mul(Math.PI))).mul(lift);
    const up = base;
    const side = normalize(cross(normalize(B.sub(A)), up));
    // thread j: an offset that wanders coherently along s
    const thread = floor(rnd(i, 3).mul(28));
    const seed = thread.mul(17.31).add(k.toFloat().mul(101.7));
    const wob = vec2(
      snoiseGrad(vec3(s.mul(2.6), seed, G.time.mul(0.06))).w,
      snoiseGrad(vec3(s.mul(2.6), seed.add(40), G.time.mul(0.06))).w,
    );
    const swell = sin(s.mul(Math.PI)).mul(0.7).add(0.3).mul(lift.sqrt());
    const turn = s.mul(Math.PI * 2 * 0.8).mul(T(13));
    const ox = wob.x.mul(cos(turn)).sub(wob.y.mul(sin(turn)));
    const oy = wob.x.mul(sin(turn)).add(wob.y.mul(cos(turn)));
    const jitter = vec3(gauss(i, 4), gauss(i, 6), gauss(i, 8)).mul(W.mul(0.06));
    const off = side.mul(ox).add(up.mul(oy)).mul(W.mul(swell)).add(jitter);
    const pos = base.mul(float(R).add(h)).add(off).toVar();
    // knots of denser, hotter plasma along the threads
    const knot = snoiseGrad(vec3(s.mul(9), seed.mul(0.37), G.time.mul(0.2))).w.mul(0.5).add(0.5);
    const hot = mix(vec3(1.0, 0.18, 0.05), vec3(1.0, 0.55, 0.22), knot.pow(2));
    const foot = float(1).sub(smoothstep(0.0, 0.12, s.min(float(1).sub(s))));
    const sprite = spriteVertex({ center: pos, radius: rnd(i, 5).mul(1.8).add(1.2), minPx: 0.75, maxPx: 60 });
    const fadeErupt = select(isErupting, float(1).sub(smoothstep(1.5, 5.0, this.erupt)), float(1));
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = varying(hot.mul(knot.mul(1.4).add(0.3)).mul(foot.mul(1.5).add(1)).mul(fadeErupt).mul(0.032).mul(this.level));
    mat.opacityNode = glowShape(sprite, 0.15).mul(sprite.energy);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    return particleMesh(per * LOOPS.length, mat, 4);
  }

  /**
   * The active region's loop arcade: hundreds of thin golden arcs nested over
   * the polarity line (the way the corona looks in extreme ultraviolet). After
   * the flare they flare up too (post-flare loops).
   */
  private buildArcade(count: number): Mesh {
    const loops = 720;
    const per = Math.max(64, Math.floor(count / loops));
    const i = instanceIndex;
    const l = i.div(uint(per)).toFloat();
    const e = v3(E);
    const e1 = normalize(cross(e, vec3(0, 1, 0)));
    const e2 = cross(e, e1);
    // position along the polarity line and how wide the loop stands
    const along = rnd(l.toUint(), 0).sub(0.5).mul(0.3);
    const width = rnd(l.toUint(), 1).pow(1.6).mul(0.09).add(0.018);
    const tilt = rnd(l.toUint(), 2).sub(0.5).mul(0.5);
    const mid = normalize(e.add(e2.mul(along)));
    const A = normalize(mid.sub(e1.mul(width)).add(e2.mul(width.mul(tilt))));
    const B = normalize(mid.add(e1.mul(width)).sub(e2.mul(width.mul(tilt))));
    const s = rnd(i, 3).toVar();
    const base = normalize(mix(A, B, s));
    const height = width.mul(R * 1.05);
    const pos = base.mul(float(R).add(height.mul(sin(s.mul(Math.PI))))).add(vec3(gauss(i, 4), gauss(i, 6), gauss(i, 8)).mul(0.35));
    const bright = rnd(l.toUint(), 4).pow(3).mul(2).add(0.4);
    const foot = float(1).sub(smoothstep(0.0, 0.1, s.min(float(1).sub(s))));
    const sprite = spriteVertex({ center: pos, radius: float(0.55), minPx: 0.7, maxPx: 20 });
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    const glow = float(1).add(this.flare.mul(2.5));
    mat.colorNode = varying(vec3(1.0, 0.74, 0.32).mul(bright).mul(foot.mul(1.2).add(1)).mul(glow).mul(0.11).mul(this.level));
    mat.opacityNode = glowShape(sprite, 0.4).mul(sprite.energy);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    return particleMesh(loops * per, mat, 4);
  }

  /**
   * The coronal mass ejection: a bubble that balloons away from the active
   * region. Grains sit on its shell; the shell is brightest where we look
   * along it (the "light-bulb" CME), and the leading grains stretch (#9).
   */
  private buildCme(count: number): Mesh {
    const i = instanceIndex;
    const e = v3(E);
    const tl = max(this.cme.sub(rnd(i, 2).mul(0.25)), 0).toVar();
    // the bubble: centre rides out along E while its radius grows
    const rb = tl.mul(80).add(tl.mul(tl).mul(4)).add(20);
    const centre = e.mul(float(R).add(rb.mul(0.9)));
    const u = normalize(vec3(gauss(i, 3), gauss(i, 5), gauss(i, 7)));
    // no shell on the side that still touches the star
    const keep = dot(u, e).greaterThan(-0.55);
    const fil = snoiseGrad(u.mul(5.5).add(tl.mul(0.05))).w.mul(0.5).add(0.5);
    const shell = rb.mul(fil.mul(0.18).add(0.92)).add(gauss(i, 9).mul(rb.mul(0.012)));
    const pos = centre.add(u.mul(shell)).toVar();
    const vel = e.mul(95).add(u.mul(95 * 0.9));
    const view = normalize(pos.sub(cameraPosition));
    const limb = pow(float(1).sub(abs(dot(u, view))), 3);
    // grains sweeping past the camera blaze as they go by
    const near = smoothstep(260, 30, length(pos.sub(cameraPosition)));
    const alive = this.cme.greaterThan(0).and(keep);
    const age = clamp(tl.div(14), 0, 1);
    // grains sweeping past the lens are thin streaks of light, not blobs
    const sprite = spriteVertex({
      center: pos,
      radius: rnd(i, 10).mul(1.0).add(0.7).mul(tl.mul(0.05).add(1)).mul(mix(float(1), float(0.3), near)),
      tail: pos.sub(vel.mul(mix(float(0.05), float(0.14), near)).mul(T(9))),
      streakKeep: 0.6,
      minPx: 0.8,
      maxPx: 70,
      visible: select(alive, float(1), float(0)),
    });
    // dim plasma reads silvery like the corona (not brown); the bright rim is gold
    const col = mix(vec3(0.7, 0.76, 0.92), vec3(1.0, 0.86, 0.62), limb.mul(fil.add(0.5)).add(near.mul(0.5)).min(1));
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = varying(col.mul(limb.mul(5).add(0.16).add(near.mul(3))).mul(fil.pow(2).mul(2.2).add(0.15)).mul(float(1).sub(age.mul(0.7)).pow(1.2)).mul(0.09).mul(this.level));
    mat.opacityNode = glowShape(sprite, 0.25).mul(sprite.energy);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    return particleMesh(count, mat, 5);
  }
  /** A small world crossing the disk: for scale. */
  private buildTransit(): Mesh {
    const geo = new SphereGeometry(7, 64, 32);
    const mat = new MeshBasicNodeMaterial();
    mat.colorNode = Fn(() => {
      const view = normalize(cameraPosition.sub(positionWorld));
      const rim = pow(float(1).sub(abs(dot(normalize(normalWorld), view))), 6);
      return vec3(0.35, 0.6, 1.0).mul(rim).mul(0.6);
    })();
    return new Mesh(geo, mat);
  }

  /* ---------------------------------------------------------------- */

  update(_ctx: Ctx, t: number) {
    this.level.value = 1;
    this.flare.value = pulse(t, FLARE_T, 0.25, 2.2);
    this.wave.value = t > FLARE_T ? (t - FLARE_T) * 0.06 : 0;
    this.erupt.value = t > FLARE_T - 1.2 ? Math.exp((t - (FLARE_T - 1.2)) * 0.8) - 1 : 0;
    this.cme.value = t > CME_T ? t - CME_T : -1;
    // the transit: a dark dot sliding across the disk early on
    const u = Math.min(1, Math.max(0, t / 9));
    this.transit.position.set(-130 + 260 * u, 40 - 30 * u, 1750);
    this.transit.visible = t < 9.5;
  }

  look(t: number, out: Look) {
    out.bloom = [0.55 + this.flareBoost(t), 0.6, 1.05];
    out.exposure = 1.0;
    out.flare = 0.5;
    out.sky = 0.3;
    out.near = 0.5;
    out.far = 12000;
    out.focus = 800;
    out.aperture = 0;
    // the flare is a blink; the end is the shell of the ejection sweeping over us
    out.flash = pulse(t, FLARE_T, 0.04, 0.12) * 0.14 + (1 - ramp(t, 0, 1.0)) * 1.2 + ramp(t, 22.0, 23) * 1.1;
    out.flashColor = [1.0, 0.92, 0.8];
    out.warp = ramp(t, 20.5, 23) * 0.8;
  }

  private flareBoost(t: number) {
    return pulse(t, FLARE_T, 0.2, 1.5) * 0.4;
  }
}

