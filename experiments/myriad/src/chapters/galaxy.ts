/**
 * V — 銀河. Two million stars on differentially rotating orbits.
 *
 * Stars are stateless: angle = θ0 + Ω(r)·t. The spiral arms are a density
 * wave — a pattern that turns at its own speed — so young stars light up as
 * they pass through an arm while the arms themselves never wind up.
 * #8  time-lapse star trails: each star is drawn from its position Δt ago
 *     to now (one more evaluation, no history buffer)
 * #5  dust lanes are opaque, depth-writing grains that fade by dithering
 * #19 a 1-pixel ring marks where we live, at any distance
 * #17 stars twinkle with their own band of the soundtrack's spectrum
 */
import { AdditiveBlending, MeshBasicNodeMaterial, Vector3 } from "three/webgpu";
import type { Mesh } from "three/webgpu";
import {
  abs,
  atan,
  cameraPosition,
  normalize,
  cos,
  exp,
  float,
  instanceIndex,
  length,
  log,
  max,
  mix,
  mod,
  select,
  sin,
  smoothstep,
  sqrt,
  uniform,
  varying,
  vec2,
  vec3,
  dot,
} from "../tsl/t";
import type { Ctx, Look } from "../engine/chapter";
import { Chapter, ramp } from "../engine/chapter";
import { particleMesh } from "../engine/quad";
import { Track } from "../engine/rig";
import type { N } from "../tsl/common";
import { T, fftAt, gauss, rnd } from "../tsl/common";
import { snoiseGrad } from "../tsl/noise";
import { ditherKeep, glowShape, outlineSdf, spriteVertex } from "../tsl/sprite";

const R_DISK = 95; // exponential scale length
const R_MAX = 430;
const PITCH = Math.tan((15 * Math.PI) / 180);
const R0 = 22;
const V0 = 1.0; // flat rotation speed (units per galactic time)
const RC = 18;
const OMEGA_P = 0.0028; // pattern speed
/** Where the marker ring sits (our sun). */
export const SUN_R = 0.56 * 300;

export class GalaxyChapter extends Chapter {
  readonly id = "galaxy";
  readonly numeral = "V";
  readonly name = "銀河";
  readonly caption = "二百万の星が、それぞれの速さで回っている。";
  readonly duration = 26;
  readonly techniques = [8, 5, 19, 17, 12, 4, 31];

  /** Galactic time (accelerates during the time-lapse). */
  private readonly tg = uniform(0);
  private readonly lag = uniform(0);
  private readonly level = uniform(1);
  private readonly markerLevel = uniform(0);
  /** 0..1 how deep into the time-lapse we are. */
  private readonly lapse = uniform(0);
  private tgValue = 0;
  private onMarker: ((x: number, y: number, visible: boolean) => void) | null = null;
  private sunPos = new Vector3();

  setMarkerHandler(fn: (x: number, y: number, visible: boolean) => void) {
    this.onMarker = fn;
  }

  build(ctx: Ctx) {
    this.group.add(
      this.buildStars(Math.round(2_100_000 * ctx.q)),
      this.buildDust(Math.round(260_000 * Math.max(0.35, ctx.q))),
      this.buildHII(Math.round(26_000 * Math.max(0.4, ctx.q))),
      this.buildCore(),
      this.buildMarker(),
    );
    this.track = new Track([
      { t: 0, pos: [160, 40, 140], look: [120, 0, 30], fov: 60 },
      { t: 5, pos: [380, 220, 560], look: [40, 0, 0], fov: 52 },
      { t: 10, pos: [200, 900, 650], look: [0, 0, 0], fov: 50 },
      { t: 15, pos: [-650, 520, 650], look: [0, 0, 0], fov: 48 },
      { t: 20, pos: [-950, 160, 160], look: [0, 0, 0], fov: 44 },
      { t: 26, pos: [-2600, 900, 1500], look: [0, 0, 0], fov: 40 },
    ]);
  }

  /* angular speed for a flat rotation curve */
  private omega(r: N): N {
    return float(V0).div(sqrt(r.mul(r).add(RC * RC)));
  }

  /** Disk star i: radius, base angle, height, kind. */
  private disk(i: N) {
    // exponential disk via inverse CDF of r·e^(−r/h) (gamma-2): sum of two exponentials
    const u1 = rnd(i, 0).max(1e-6);
    const u2 = rnd(i, 1).max(1e-6);
    const r = u1.log().add(u2.log()).negate().mul(R_DISK * 0.5).add(6).min(R_MAX).toVar();
    // which arm and how tightly a star hugs it depends on its age
    const arm = rnd(i, 2).mul(4).floor();
    const major = arm.lessThan(2);
    const armAngle = log(r.div(R0)).div(PITCH).add(arm.mul(Math.PI / 2)).add(select(major, float(0), float(0.55)));
    const young = rnd(i, 3).lessThan(0.32);
    const spread = select(young, float(0.18), float(0.9)).mul(select(major, float(1), float(1.6)));
    const theta0 = armAngle.add(gauss(i, 4).mul(spread));
    const z = gauss(i, 6).mul(select(young, float(1.6), float(5.5))).mul(exp(r.div(-240)).mul(0.6).add(0.4));
    return { r, theta0, z, young, armAngle };
  }

  private position(r: N, theta0: N, z: N, t: N): N {
    const th = theta0.add(this.omega(r).mul(t));
    return vec3(r.mul(cos(th)), z, r.mul(sin(th)));
  }

  private buildStars(count: number): Mesh {
    const i = instanceIndex;
    const isBulge = rnd(i, 9).lessThan(0.16);
    const d = this.disk(i);
    // bulge: a flattened spheroid of old stars
    const bdir = vec3(gauss(i, 10), gauss(i, 12).mul(0.55), gauss(i, 14));
    const br = rnd(i, 16).pow(2.2).mul(70).add(1);
    const bulgeR = length(vec2(bdir.x, bdir.z)).mul(br).div(length(bdir).max(1e-4));
    const bulgeZ = bdir.y.mul(br).div(length(bdir).max(1e-4));
    const bulgeTh = atan(bdir.z, bdir.x);
    const r = select(isBulge, bulgeR, d.r).toVar();
    const th0 = select(isBulge, bulgeTh, d.theta0).toVar();
    const z = select(isBulge, bulgeZ, d.z).toVar();
    const pos = this.position(r, th0, z, this.tg).toVar();
    // #8: the same orbit Δt earlier; inner stars get a shorter Δt so no trail
    // sweeps more than ~0.6 rad (a chord across the bulge would read as fog)
    const lagR = this.lag.min(float(0.6).div(this.omega(r)));
    const past = this.position(r, th0, z, this.tg.sub(lagR.mul(T(8))));

    // density wave: how close is the star to an arm in the pattern frame?
    const thNow = th0.add(this.omega(r).mul(this.tg)).sub(this.tg.mul(OMEGA_P));
    const delta = mod(thNow.sub(d.armAngle).add(Math.PI / 2 * 0.5), Math.PI / 2).sub(Math.PI / 4);
    const inArm = exp(delta.mul(delta).mul(-26));
    const young = d.young.and(isBulge.not());
    const temp = select(young, rnd(i, 20).mul(0.4).add(0.6), rnd(i, 20).mul(0.45));
    const blue = vec3(0.5, 0.68, 1.0);
    const white = vec3(1.0, 0.95, 0.88);
    const amber = vec3(1.0, 0.66, 0.36);
    const col = mix(mix(amber, white, smoothstep(0.2, 0.55, temp)), blue, smoothstep(0.6, 0.95, temp));
    // old disk stars make a dim smooth sheet; young ones crowd the arms
    const youngGlow = select(young, inArm.mul(4.5).add(0.04), float(0.3));
    const bright = rnd(i, 21).pow(6).mul(4).add(0.3).mul(youngGlow).mul(select(isBulge, float(1.4), float(1))).toVar();
    // during the time-lapse the fast inner orbits would smear into a blinding core
    const calm = select(isBulge, float(1).sub(this.lapse.mul(0.88)), float(1).sub(this.lapse.mul(0.55)));
    // #17: every star owns a band of the spectrum
    const beat = fftAt(i).mul(T(17)).mul(1.4);
    // seen edge-on, a disk of additive stars piles up into a white bar; treat
    // it as optically thick: scale by (1 − e^(−τ/μ)) / (τ/μ) along grazing rays
    const mu = max(abs(normalize(pos.sub(cameraPosition)).y), 0.03);
    const tau = exp(r.div(-150)).mul(0.9).add(0.04).div(mu);
    const thick = float(1).sub(exp(tau.negate())).div(tau);
    const sprite = spriteVertex({
      center: pos,
      radius: float(0.45).mul(bright.sqrt().mul(0.5).add(0.6)),
      tail: past,
      streakKeep: 0.3,
      maxStreakPx: 500,
      minPx: 0.7,
      maxPx: 24,
    });
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = varying(col.mul(bright.mul(beat.add(1))).mul(calm).mul(thick).mul(0.065).mul(this.level));
    mat.opacityNode = glowShape(sprite, 0.35).mul(sprite.energy);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    return particleMesh(count, mat, 4);
  }

  /** #5 dust lanes: opaque grains on the inner edge of the arms, dithered. */
  private buildDust(count: number): Mesh {
    const i = instanceIndex;
    const u1 = rnd(i, 0).max(1e-6);
    const u2 = rnd(i, 1).max(1e-6);
    const r = u1.log().add(u2.log()).negate().mul(R_DISK * 0.45).add(20).min(R_MAX * 0.85).toVar();
    const arm = rnd(i, 2).mul(2).floor();
    const armAngle = log(r.div(R0)).div(PITCH).add(arm.mul(Math.PI / 2)).sub(0.16);
    const th0 = armAngle.add(gauss(i, 4).mul(0.08));
    const z = gauss(i, 6).mul(0.9);
    const pos = this.position(r, th0, z, this.tg.mul(0)).toVar();
    // keep the lanes with the pattern: rotate the whole lane set at Ωp
    const ang = this.tg.mul(OMEGA_P);
    const rot = vec3(pos.x.mul(cos(ang)).sub(pos.z.mul(sin(ang))), pos.y, pos.x.mul(sin(ang)).add(pos.z.mul(cos(ang))));
    const size = rnd(i, 7).mul(2.2).add(1.4);
    const sprite = spriteVertex({ center: rot, radius: size, minPx: 0.8, maxPx: 200 });
    const lump = snoiseGrad(rot.mul(0.03)).w.mul(0.5).add(0.5);
    // grains near the camera dissolve (#5) instead of filling the view with tiles
    const near = smoothstep(30, 110, length(rot.sub(cameraPosition)));
    const alpha = varying(smoothstep(0.25, 0.75, lump).mul(0.85).mul(near).mul(this.level));
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = vec3(0.035, 0.022, 0.016);
    const shape = glowShape(sprite, 0);
    mat.maskNode = ditherKeep(shape.mul(alpha));
    mat.transparent = false;
    mat.depthWrite = true;
    return particleMesh(count, mat, 1);
  }

  /** Pink star-forming knots that ride the arm pattern. */
  private buildHII(count: number): Mesh {
    const i = instanceIndex;
    const u1 = rnd(i, 0).max(1e-6);
    const u2 = rnd(i, 1).max(1e-6);
    const r = u1.log().add(u2.log()).negate().mul(R_DISK * 0.5).add(30).min(R_MAX * 0.8).toVar();
    const arm = rnd(i, 2).mul(2).floor();
    const armAngle = log(r.div(R0)).div(PITCH).add(arm.mul(Math.PI / 2));
    const th = armAngle.add(gauss(i, 4).mul(0.1)).add(this.tg.mul(OMEGA_P));
    const pos = vec3(r.mul(cos(th)), gauss(i, 6).mul(1.2), r.mul(sin(th)));
    const sprite = spriteVertex({ center: pos, radius: rnd(i, 7).mul(3).add(1.2), minPx: 0.8, maxPx: 120 });
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = varying(mix(vec3(1.0, 0.3, 0.55), vec3(0.55, 0.7, 1.0), rnd(i, 8).mul(0.35)).mul(0.11).mul(this.level));
    mat.opacityNode = glowShape(sprite, 0).mul(sprite.energy);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    return particleMesh(count, mat, 5);
  }

  private buildCore(): Mesh {
    const sprite = spriteVertex({ center: vec3(0, 0, 0), radius: float(70), minPx: 4, maxPx: 3000 });
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    const p = sprite.local;
    mat.colorNode = vec3(1.0, 0.82, 0.6).mul(this.level).mul(float(1).sub(this.lapse.mul(0.6)));
    mat.opacityNode = exp(dot(p, p).mul(-9)).mul(0.2).add(exp(length(p).mul(-4.5)).mul(0.03));
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    return particleMesh(1, mat, 6);
  }

  /** #19 the "you are here" ring: always one device pixel wide. */
  private buildMarker(): Mesh {
    const th = log(float(SUN_R / R0)).div(PITCH).add(0.35).add(this.tg.mul(this.omega(float(SUN_R))));
    const center = vec3(float(SUN_R).mul(cos(th)), 0, float(SUN_R).mul(sin(th)));
    const sprite = spriteVertex({ center, radius: float(14), minPx: 10, maxPx: 400 });
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = vec3(0.75, 0.95, 1.0).mul(2.2).mul(this.markerLevel);
    const d = length(sprite.local).mul(1.25);
    const ring = outlineSdf(d, 1);
    const tick = outlineSdf(length(sprite.local).mul(3.2), 1).mul(0.6);
    mat.opacityNode = max(ring, tick).mul(this.markerLevel);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.depthTest = false;
    mat.blending = AdditiveBlending;
    return particleMesh(1, mat, 50);
  }

  /** Marker position in galaxy space at the current galactic time. */
  private markerWorld(out: Vector3) {
    const th = Math.log(SUN_R / R0) / PITCH + 0.35 + this.tgValue * (V0 / Math.sqrt(SUN_R * SUN_R + RC * RC));
    out.set(SUN_R * Math.cos(th), 0, SUN_R * Math.sin(th));
    return this.group.localToWorld(out);
  }

  enter(_ctx: Ctx, t: number) {
    this.tgValue = this.timeAt(t);
  }

  exit(_ctx: Ctx) {
    this.onMarker?.(0, 0, false);
  }

  /** Galactic time: slow drift, a time-lapse in the middle. */
  private timeAt(t: number) {
    // integral of rate(t) = 6 + 220·ramp(9,13)·(1 − ramp(17,20))
    let acc = 0;
    const steps = 120;
    for (let k = 0; k < steps; k++) {
      const s = ((k + 0.5) / steps) * t;
      acc += (6 + 220 * ramp(s, 9, 13) * (1 - ramp(s, 17, 20))) * (t / steps);
    }
    return acc;
  }

  update(ctx: Ctx, t: number) {
    this.tgValue = this.timeAt(t);
    this.tg.value = this.tgValue;
    // trails as long as ~0.5 s of the current galactic rate
    const rate = 6 + 220 * ramp(t, 9, 13) * (1 - ramp(t, 17, 20));
    this.lag.value = rate * 0.3;
    this.lapse.value = ramp(t, 9, 13) * (1 - ramp(t, 17, 20));
    this.level.value = 1;
    const m = ramp(t, 13.5, 15) * (1 - ramp(t, 22, 23.5));
    this.markerLevel.value = m;
    this.group.updateMatrixWorld();
    const p = this.markerWorld(this.sunPos).project(ctx.camera);
    const vis = m > 0.02 && p.z < 1 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1;
    this.onMarker?.(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5, vis);
  }

  look(t: number, out: Look) {
    const lapse = ramp(t, 9, 13) * (1 - ramp(t, 17, 20));
    out.bloom = [0.6 - lapse * 0.25, 0.55, 0.7 + lapse * 0.3];
    out.sky = 0;
    out.near = 0.5;
    out.far = 20000;
    out.focus = 600;
    out.aperture = 0;
    out.exposure = 1.0;
    out.warp = (1 - ramp(t, 0, 1.4)) * 0.5 + ramp(t, 24.6, 26) * 0.5;
  }
}

