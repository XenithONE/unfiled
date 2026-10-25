/**
 * V — 銀河. Two million stars on differentially rotating orbits.
 *
 * Stars are stateless: angle = θ0 + Ω(r)·t. The spiral arms are a density
 * wave — a pattern that turns at its own speed — so young stars light up as
 * they pass through an arm while the arms themselves never wind up. Young
 * stars are born in clusters strung along the arms and shear apart as they
 * orbit; the old disk is a smooth warm sheet and the bulge a golden spheroid.
 * #42 dust lanes by analytic absorption: every star works out where its line
 *     of sight to the lens crosses the dusty mid-plane, reads the dust map
 *     there (lanes on the inner edge of the arms, torn into filaments) and is
 *     dimmed and reddened by e^(−τ). The disk's smooth light and the bulge do
 *     the same per pixel, so the lanes stand dark against them.
 * #8  time-lapse star trails: each star is drawn from its position Δt ago
 * #19 a 1-pixel ring marks where we live, at any distance
 * #17 stars twinkle with their own band of the soundtrack's spectrum
 * Behind it all, the deep field: thousands of faraway galaxies, each a tiny
 * tilted disc, a spiral once it is big enough on screen.
 */
import { AdditiveBlending, DoubleSide, Mesh, MeshBasicNodeMaterial, PlaneGeometry, Vector3 } from "three/webgpu";
import {
  Fn,
  abs,
  atan,
  cameraPosition,
  clamp,
  cos,
  dot,
  exp,
  float,
  floor,
  instanceIndex,
  length,
  log,
  max,
  min,
  mix,
  mod,
  normalize,
  positionWorld,
  pow,
  screenUV,
  select,
  sin,
  smoothstep,
  sqrt,
  texture3D,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from "../tsl/t";
import type { Ctx, Look } from "../engine/chapter";
import { Chapter, ramp } from "../engine/chapter";
import { particleMesh } from "../engine/quad";
import { Track } from "../engine/rig";
import type { N } from "../tsl/common";
import { G, T, fftAt, gauss, rnd } from "../tsl/common";
import { glowShape, outlineSdf, spriteVertex } from "../tsl/sprite";
import { ensureNoise, sharedNoise } from "../tsl/volume";

const R_DISK = 95; // exponential scale length
const R_MAX = 430;
const PITCH = Math.tan((21 * Math.PI) / 180);
const R0 = 22;
const V0 = 1.0; // flat rotation speed (units per galactic time)
const RC = 18;
const OMEGA_P = 0.0028; // pattern speed
const N_ASSOC = 5200;
/** Scale height of the dust layer. */
const HD = 1.7;
/** Where the marker ring sits (our sun). */
export const SUN_R = 0.56 * 300;

export class GalaxyChapter extends Chapter {
  readonly id = "galaxy";
  readonly numeral = "V";
  readonly name = "銀河";
  readonly caption = "二百万の星が、それぞれの速さで回っている。";
  readonly duration = 26;
  readonly techniques = [42, 8, 19, 17, 12, 4, 40, 31];

  /** Galactic time (accelerates during the time-lapse). */
  private readonly tg = uniform(0);
  private readonly lag = uniform(0);
  private readonly level = uniform(1);
  private readonly markerLevel = uniform(0);
  /** 0..1 how deep into the time-lapse we are. */
  private readonly lapse = uniform(0);
  /** Projection terms for rebuilding a pixel's ray. */
  private readonly p00 = uniform(1);
  private readonly p11 = uniform(1);
  private tgValue = 0;
  private onMarker: ((x: number, y: number, visible: boolean) => void) | null = null;
  private sunPos = new Vector3();

  setMarkerHandler(fn: (x: number, y: number, visible: boolean) => void) {
    this.onMarker = fn;
  }

  build(ctx: Ctx) {
    this.group.add(
      this.buildDeepField(Math.round(3200 * Math.max(0.5, ctx.q))),
      this.buildGlow(),
      this.buildStars(Math.round(2_100_000 * ctx.q)),
      this.buildHII(Math.round(30_000 * Math.max(0.4, ctx.q))),
      this.buildGlobulars(),
      this.buildCore(),
      this.buildMarker(),
    );
    this.track = new Track([
      { t: 0, pos: [160, 40, 140], look: [120, 0, 30], fov: 60 },
      { t: 5, pos: [320, 180, 450], look: [30, 0, 0], fov: 52 },
      { t: 10, pos: [150, 640, 470], look: [0, 0, 0], fov: 50 },
      { t: 15, pos: [-470, 380, 470], look: [0, 0, 0], fov: 48 },
      { t: 20, pos: [-690, 100, 120], look: [0, 0, 0], fov: 44 },
      { t: 26, pos: [-2400, 820, 1380], look: [0, 0, 0], fov: 40 },
    ]);
  }

  /* -------------------------------------------------------------------- */
  /* structure                                                            */
  /* -------------------------------------------------------------------- */

  /** Angular speed for a flat rotation curve. */
  private omega(r: N): N {
    return float(V0).div(sqrt(r.mul(r).add(RC * RC)));
  }

  /** Crest angle of arm k (0..3) at radius r, in the pattern frame: two major, two minor. */
  private armAt(r: N, k: N): N {
    const base = log(max(r, 4).div(R0)).div(PITCH);
    const off = select(k.lessThan(1.5), k.mul(Math.PI), k.sub(2).mul(Math.PI).add(Math.PI / 2 + 0.35));
    return base.add(off);
  }

  /** Radius of an exponential disk (gamma-2) from random streams k, k+1 of id. */
  private diskR(id: N, k: number, scale: number, add: number): N {
    return rnd(id, k).max(1e-6).log().add(rnd(id, k + 1).max(1e-6).log()).negate().mul(scale).add(add).min(R_MAX);
  }

  private position(r: N, theta0: N, z: N, t: N): N {
    const th = theta0.add(this.omega(r).mul(t));
    return vec3(r.mul(cos(th)), z, r.mul(sin(th)));
  }

  /** Pattern-frame coordinates of a point in the disk plane. */
  private patternXZ(xz: N): N {
    const a = this.tg.mul(OMEGA_P);
    const c = cos(a);
    const s = sin(a);
    return vec2(xz.x.mul(c).add(xz.y.mul(s)), xz.y.mul(c).sub(xz.x.mul(s)));
  }

  /** Angle from the nearest crest of the major arms (period π) or the minor ones. */
  private armPhase(xz: N, offset: number): N {
    const r = length(xz);
    const th = atan(xz.y, xz.x).sub(this.tg.mul(OMEGA_P));
    const phi = th.sub(log(max(r, 4).div(R0)).div(PITCH)).sub(offset);
    return mod(phi.add(Math.PI / 2), Math.PI).sub(Math.PI / 2);
  }

  /**
   * #42 vertical optical depth of the dust at a point of the plane: lanes on the
   * inner (upstream) edge of the arms, torn into filaments and feathers that
   * turn with the pattern; none in the very centre.
   */
  private dustSigma(xz: N): N {
    const r = length(xz).toVar();
    const lane = exp(this.armPhase(xz, -0.13).div(0.085).pow(2).negate());
    const lane2 = exp(this.armPhase(xz, Math.PI / 2 + 0.35 - 0.12).div(0.065).pow(2).negate()).mul(0.45);
    const pp = this.patternXZ(xz);
    const n1 = texture3D(sharedNoise().texture, vec3(pp.mul(1 / 130), 0.31)).level(0);
    const n2 = texture3D(sharedNoise().texture, vec3(pp.mul(1 / 60), 0.77)).level(0);
    const fil = smoothstep(-0.3, 0.45, n1.x.add(n2.w.mul(0.6)));
    const feather = smoothstep(0.86, 0.97, float(1).sub(abs(n2.w))).mul(smoothstep(0.2, 0.6, n1.y)).mul(0.6);
    const radial = exp(r.div(-170)).mul(smoothstep(12, 48, r)).mul(float(1).sub(smoothstep(330, 420, r)));
    // (plus a continuous dusty disk: edge-on it is the dark band along the mid-plane)
    return lane.add(lane2).mul(fil.mul(1.15).add(0.12)).mul(1.6).add(feather.mul(0.35)).add(fil.mul(0.25).add(0.22)).mul(radial).mul(2.2);
  }

  /** Smooth step of the dust layer's column below height y (0 below .. 1 above). */
  private layer(y: N): N {
    return float(0.5).add(y.div(sqrt(y.mul(y).add(HD * HD))).mul(0.5));
  }

  /** #42 transmittance (reddened) of the dust between the lens and a point. */
  private absorb(pos: N): N {
    const ro = cameraPosition;
    const seg = pos.sub(ro);
    const dir = normalize(seg);
    const sy = select(abs(seg.y).lessThan(1e-4), float(1e-4), seg.y);
    const tc = clamp(ro.y.negate().div(sy), 0, 1);
    const xz = vec2(ro.x, ro.z).add(vec2(seg.x, seg.z).mul(tc));
    const frac = abs(this.layer(pos.y).sub(this.layer(ro.y)));
    const tau = this.dustSigma(xz).mul(frac).div(max(abs(dir.y), 0.045)).mul(T(42));
    return exp(vec3(1.35, 1.0, 0.7).mul(tau).negate());
  }

  /** The direction of the ray through this pixel (screen → world). */
  private pixelRay(): N {
    const ndc = vec2(screenUV.x.mul(2).sub(1), float(1).sub(screenUV.y.mul(2)));
    const rv = normalize(vec3(ndc.x.div(this.p00), ndc.y.div(this.p11), -1));
    return normalize(G.invView.mul(vec4(rv, 0)).xyz);
  }

  /* -------------------------------------------------------------------- */
  /* stars                                                                */
  /* -------------------------------------------------------------------- */

  private buildStars(count: number): Mesh {
    const i = instanceIndex;
    const kind = rnd(i, 9);
    const isBulge = kind.lessThan(0.14);
    const isYoung = kind.greaterThanEqual(0.14).and(kind.lessThan(0.45));
    // old disk: a broad, smooth sheet that still follows the arms a little
    const rOld = this.diskR(i, 0, R_DISK * 0.5, 6);
    const thOld = this.armAt(rOld, floor(rnd(i, 2).mul(4))).add(gauss(i, 4).mul(0.95));
    const zOld = gauss(i, 6).mul(5.0).mul(exp(rOld.div(-240)).mul(0.6).add(0.4));
    // young: members of an association strung along an arm (mostly a major one)
    const j = floor(rnd(i, 30).mul(N_ASSOC)).toUint();
    const rA = this.diskR(j, 40, R_DISK * 0.55, 14);
    const kA = select(rnd(j, 42).lessThan(0.7), floor(rnd(j, 43).mul(2)), floor(rnd(j, 44).mul(2)).add(2));
    const thA = this.armAt(rA, kA).add(gauss(j, 46).mul(0.15)).add(0.05);
    const spread = rnd(j, 48).mul(4.5).add(1.5);
    const rY = rA.add(gauss(i, 50).mul(spread)).max(8);
    const thY = thA.add(gauss(i, 52).mul(spread).div(rA));
    const zY = gauss(i, 54).mul(1.1);
    // bulge: a flattened spheroid of old stars
    const bdir = vec3(gauss(i, 10), gauss(i, 12).mul(0.55), gauss(i, 14));
    const br = rnd(i, 16).pow(2.2).mul(70).add(1);
    const bulgeR = length(vec2(bdir.x, bdir.z)).mul(br).div(length(bdir).max(1e-4));
    const bulgeZ = bdir.y.mul(br).div(length(bdir).max(1e-4));
    const bulgeTh = atan(bdir.z, bdir.x);
    const r = select(isBulge, bulgeR, select(isYoung, rY, rOld)).toVar();
    const th0 = select(isBulge, bulgeTh, select(isYoung, thY, thOld)).toVar();
    const z = select(isBulge, bulgeZ, select(isYoung, zY, zOld)).toVar();
    const pos = this.position(r, th0, z, this.tg).toVar();
    // #8: the same orbit Δt earlier; inner stars get a shorter Δt so no trail
    // sweeps more than ~0.6 rad (a chord across the bulge would read as fog)
    const lagR = this.lag.min(float(0.6).div(this.omega(r)));
    const past = this.position(r, th0, z, this.tg.sub(lagR.mul(T(8))));

    // density wave: young stars blaze while they are in an arm, fade as they drift out
    const inArm = exp(this.armPhase(vec2(pos.x, pos.z), 0).div(0.2).pow(2).negate())
      .max(exp(this.armPhase(vec2(pos.x, pos.z), Math.PI / 2 + 0.35).div(0.18).pow(2).negate()).mul(0.6));
    const temp = rnd(i, 20);
    const youngCol = mix(vec3(1.0, 0.95, 0.9), vec3(0.55, 0.7, 1.0), smoothstep(0.3, 0.95, temp));
    const oldCol = mix(vec3(1.0, 0.66, 0.38), vec3(1.0, 0.9, 0.76), temp);
    const bulgeCol = mix(vec3(1.0, 0.6, 0.32), vec3(1.0, 0.86, 0.66), temp.mul(0.7));
    const col = select(isBulge, bulgeCol, select(isYoung, youngCol, oldCol));
    const base = rnd(i, 21).pow(6);
    const bright = select(
      isYoung,
      base.mul(2.6).add(0.2).mul(inArm.mul(2.4).add(0.12)),
      base.mul(1.5).add(0.25).mul(select(isBulge, float(0.6), float(1.0))),
    ).toVar();
    // during the time-lapse the fast inner orbits would smear into a blinding core
    const calm = select(isBulge, float(1).sub(this.lapse.mul(0.88)), float(1).sub(this.lapse.mul(0.55)));
    // #17: every star owns a band of the spectrum
    const beat = fftAt(i).mul(T(17)).mul(1.4);
    // seen edge-on, a disk of additive stars piles up into a white bar; treat
    // it as optically thick: scale by (1 − e^(−τ/μ)) / (τ/μ) along grazing rays
    const mu = max(abs(normalize(pos.sub(cameraPosition)).y), 0.03);
    const tau = exp(r.div(-150)).mul(0.45).add(0.02).div(mu);
    const thick = float(1).sub(exp(tau.negate())).div(tau);
    const sprite = spriteVertex({
      center: pos,
      radius: float(0.42).mul(bright.sqrt().mul(0.5).add(0.6)),
      tail: past,
      streakKeep: 0.3,
      maxStreakPx: 500,
      minPx: 0.7,
      maxPx: 24,
    });
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = varying(col.mul(bright.mul(beat.add(1))).mul(calm).mul(thick).mul(this.absorb(pos)).mul(0.062).mul(this.level));
    mat.opacityNode = glowShape(sprite, 0.35).mul(sprite.energy);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    return particleMesh(count, mat, 4);
  }

  /**
   * The disk's unresolved light: a plane in the galaxy that glows with the
   * exponential profile and the arms, seen through its own dust (#42).
   */
  private buildGlow(): Mesh {
    const geo = new PlaneGeometry(R_MAX * 2.1, R_MAX * 2.1, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new MeshBasicNodeMaterial();
    mat.colorNode = Fn(() => {
      const xz = vec2(positionWorld.x, positionWorld.z);
      const r = length(xz).toVar();
      const arms = exp(this.armPhase(xz, 0).div(0.32).pow(2).negate()).add(exp(this.armPhase(xz, Math.PI / 2 + 0.35).div(0.26).pow(2).negate()).mul(0.5));
      // a bright inner disk that fades into the arms
      const profile = exp(r.div(-62)).mul(1.4).add(exp(r.div(-R_DISK * 1.4)).mul(0.45));
      const surface = profile.mul(arms.mul(0.7).add(0.45)).mul(float(1).sub(smoothstep(R_MAX * 0.6, R_MAX, r)));
      const col = mix(vec3(1.0, 0.8, 0.56), vec3(0.62, 0.74, 1.0), smoothstep(50, 240, r).mul(arms.min(1)).mul(0.8));
      const rd = normalize(positionWorld.sub(cameraPosition));
      const tau = this.dustSigma(xz).div(max(abs(rd.y), 0.045)).mul(T(42));
      const trans = exp(vec3(1.35, 1.0, 0.7).mul(tau).negate());
      // most of the layer's light shows the dust in front of it; a thin sheet brightens toward edge-on
      const incl = min(float(1).div(max(abs(rd.y), 0.05)), 3.5);
      return col.mul(surface).mul(trans.mul(0.85).add(0.15)).mul(incl).mul(0.34).mul(float(1).sub(this.lapse.mul(0.5))).mul(this.level);
    })();
    mat.side = DoubleSide;
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    const mesh = new Mesh(geo, mat);
    mesh.renderOrder = 3;
    return mesh;
  }

  /** Pink star-forming regions strung like beads just downstream of the dust lanes. */
  private buildHII(count: number): Mesh {
    const i = instanceIndex;
    const j = floor(rnd(i, 0).mul(900)).toUint();
    const r = this.diskR(j, 1, R_DISK * 0.5, 30);
    const k = select(rnd(j, 3).lessThan(0.75), floor(rnd(j, 4).mul(2)), floor(rnd(j, 5).mul(2)).add(2));
    const th = this.armAt(r, k).add(0.06).add(gauss(j, 6).mul(0.05)).add(this.tg.mul(OMEGA_P));
    const centre = vec3(r.mul(cos(th)), gauss(j, 8).mul(0.8), r.mul(sin(th)));
    const size = rnd(j, 9).mul(2.6).add(1.0);
    const pos = centre.add(vec3(gauss(i, 10), gauss(i, 12).mul(0.4), gauss(i, 14)).mul(size));
    const core = exp(length(pos.sub(centre)).div(size).pow(2).negate());
    const sprite = spriteVertex({ center: pos, radius: rnd(i, 16).pow(2).mul(2.2).add(0.6), minPx: 0.8, maxPx: 120 });
    const tint = mix(vec3(1.0, 0.3, 0.5), vec3(1.0, 0.8, 0.9), core.mul(0.6));
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = varying(tint.mul(core.mul(0.12).add(0.04)).mul(this.absorb(pos)).mul(float(1).sub(this.lapse.mul(0.6))).mul(this.level));
    mat.opacityNode = glowShape(sprite, 0).mul(sprite.energy);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    return particleMesh(count, mat, 5);
  }

  /** Globular clusters: fuzzy balls of old stars in the halo. */
  private buildGlobulars(): Mesh {
    const i = instanceIndex;
    const dir = normalize(vec3(gauss(i, 0), gauss(i, 2), gauss(i, 4)));
    const pos = dir.mul(rnd(i, 6).pow(1.6).mul(360).add(45));
    const sprite = spriteVertex({ center: pos, radius: rnd(i, 7).mul(1.6).add(1.4), minPx: 1.2, maxPx: 60 });
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    const d = length(sprite.local);
    mat.colorNode = vec3(1.0, 0.86, 0.68).mul(this.level).mul(0.5);
    mat.opacityNode = exp(d.mul(d).mul(-7)).mul(0.9).add(exp(d.mul(-6)).mul(0.25)).mul(sprite.energy);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    return particleMesh(160, mat, 5);
  }

  /** The bulge's glow, per pixel, with the dust lanes in front of it (#42). */
  private buildCore(): Mesh {
    const sprite = spriteVertex({ center: vec3(0, 0, 0), radius: float(120), minPx: 4, maxPx: 4000 });
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = Fn(() => {
      const p = sprite.local;
      const d2 = dot(p, p);
      const bulge = exp(d2.mul(-22)).mul(0.5).add(exp(sqrt(d2).mul(-7)).mul(0.07)).add(exp(d2.mul(-220)).mul(1.2));
      const ro = cameraPosition;
      const rd = this.pixelRay();
      // the share of the bulge's light that lies beyond the dusty mid-plane
      const tcen = dot(ro, rd).negate();
      const ry = select(abs(rd.y).lessThan(1e-4), float(1e-4), rd.y);
      const tp = ro.y.negate().div(ry);
      const gap = tcen.sub(tp);
      const behind = select(tp.greaterThan(0), gap.div(sqrt(gap.mul(gap).add(30 * 30))).mul(0.5).add(0.5), float(0));
      const xz = vec2(ro.x, ro.z).add(vec2(rd.x, rd.z).mul(max(tp, 0)));
      const tau = this.dustSigma(xz).div(max(abs(rd.y), 0.045)).mul(T(42));
      const trans = exp(vec3(1.35, 1.0, 0.7).mul(tau).negate());
      const seen = float(1).sub(behind).add(trans.mul(behind));
      return vec3(1.0, 0.8, 0.56).mul(bulge).mul(seen).mul(float(1).sub(this.lapse.mul(0.6))).mul(this.level);
    })();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    return particleMesh(1, mat, 6);
  }

  /**
   * The deep field: faraway galaxies on the sky round the camera. Each is a
   * tilted disc (an ellipse); one in three grows two spiral arms once it is a
   * few pixels across.
   */
  private buildDeepField(count: number): Mesh {
    const i = instanceIndex;
    const zr = rnd(i, 0).mul(2).sub(1);
    const ph = rnd(i, 1).mul(Math.PI * 2);
    const rxy = float(1).sub(zr.mul(zr)).max(0).sqrt();
    const dir = vec3(rxy.mul(cos(ph)), zr, rxy.mul(sin(ph)));
    const dist = 9000;
    const center = cameraPosition.add(dir.mul(dist));
    const size = rnd(i, 2).pow(3.5).mul(110).add(14);
    const sprite = spriteVertex({ center, radius: size, minPx: 0.8, maxPx: 60 });
    const ang = varying(rnd(i, 3).mul(Math.PI * 2));
    const q = varying(rnd(i, 4).mul(0.75).add(0.2));
    const spiral = varying(select(rnd(i, 5).lessThan(0.35), float(1), float(0)));
    const tint = mix(vec3(1.0, 0.78, 0.55), vec3(0.72, 0.8, 1.0), spiral.mul(0.8).add(rnd(i, 6).mul(0.2)));
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = varying(tint.mul(rnd(i, 7).pow(2).mul(0.22).add(0.05)).mul(this.level));
    mat.opacityNode = Fn(() => {
      const l = sprite.local;
      const lp = vec2(l.x.mul(cos(ang)).sub(l.y.mul(sin(ang))), l.x.mul(sin(ang)).add(l.y.mul(cos(ang))));
      const e = length(vec2(lp.x, lp.y.div(q))).toVar();
      const body = exp(e.mul(e).mul(-7)).mul(0.8).add(exp(e.mul(-5)).mul(0.25));
      // two log-spiral arms in the disc's own plane, only once it is resolved
      const a = atan(lp.y.div(q), lp.x);
      const arms = pow(cos(a.sub(log(e.add(0.06)).div(0.32))).mul(0.5).add(0.5), 3).mul(exp(e.mul(-2.6))).mul(smoothstep(3, 7, sprite.rpx));
      return body.add(arms.mul(spiral).mul(0.6)).mul(float(1).sub(smoothstep(0.85, 1.0, e))).mul(sprite.energy);
    })();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    return particleMesh(count, mat, -10);
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

  enter(ctx: Ctx, t: number) {
    ensureNoise(ctx.renderer);
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
    // trails as long as ~0.5 s of the time-lapse's extra rate (none at the gentle drift)
    const rate = 220 * ramp(t, 9, 13) * (1 - ramp(t, 17, 20));
    this.lag.value = rate * 0.3;
    this.lapse.value = ramp(t, 9, 13) * (1 - ramp(t, 17, 20));
    this.level.value = 1;
    const P = ctx.camera.projectionMatrix.elements;
    this.p00.value = P[0];
    this.p11.value = P[5];
    const m = ramp(t, 13.5, 15) * (1 - ramp(t, 22, 23.5));
    this.markerLevel.value = m;
    this.group.updateMatrixWorld();
    const p = this.markerWorld(this.sunPos).project(ctx.camera);
    const vis = m > 0.02 && p.z < 1 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1;
    this.onMarker?.(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5, vis);
  }

  look(t: number, out: Look) {
    const lapse = ramp(t, 9, 13) * (1 - ramp(t, 17, 20));
    out.bloom = [0.55 - lapse * 0.2, 0.55, 0.75 + lapse * 0.3];
    out.sky = 0;
    out.near = 0.5;
    out.far = 20000;
    out.focus = 600;
    out.aperture = 0;
    out.exposure = 1.0;
    // the bright core would throw a huge ghost across the frame
    out.flare = 0.03;
    out.streak = 0.12;
    out.warp = (1 - ramp(t, 0, 1.4)) * 0.5 + ramp(t, 24.6, 26) * 0.5;
    out.grade = { lift: [0.006, 0.004, 0.012], gamma: [1, 1, 1], gain: [1.03, 1, 0.98], saturation: 1.12 };
  }
}
