/**
 * The ringed giant shared by chapters I and II: the planet, two million ring
 * grains on Kepler orbits, ice boulders, the dust and water drops around the
 * camera, and the moon that will break.
 *
 * Ring grains are stateless — their position is a function of time — so the
 * whole ring costs no memory and can be scrubbed to any moment.
 */
import {
  AdditiveBlending,
  DataTexture,
  Group,
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  NormalBlending,
  RGBAFormat,
  SphereGeometry,
  Vector3,
} from "three/webgpu";
import {
  Fn,
  abs,
  acos,
  asin,
  cameraPosition,
  clamp,
  dot,
  exp,
  float,
  instanceIndex,
  length,
  max,
  mix,
  mod,
  normalWorld,
  normalize,
  positionWorld,
  pow,
  screenSize,
  screenUV,
  select,
  sin,
  smoothstep,
  sqrt,
  texture,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
  viewportDepthTexture,
  viewportSharedTexture,
  cameraFar,
  cameraNear,
  perspectiveDepthToViewZ,
} from "../tsl/t";
import type { Ctx } from "../engine/chapter";
import { particleMesh } from "../engine/quad";
import type { N } from "../tsl/common";
import { G, T, gauss, rnd } from "../tsl/common";
import { impostorSphere, makeMatcap, matcapShade, voronoiCracks } from "../tsl/impostor";
import { fbm2, snoiseGrad } from "../tsl/noise";
import { blackbody } from "../tsl/palette";
import { voronoi3d as voronoi3dTyped } from "three/addons/tsl/math/voronoiNoise.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const voronoi3d: any = voronoi3dTyped;
import { bokehShape, ditherKeep, flareShape, spriteVertex } from "../tsl/sprite";

export const RP = 60;
export const RING_IN = 76;
export const RING_OUT = 146;
/** Direction toward the sun (world). */
export const SUN = new Vector3(-0.62, -0.17, -0.77).normalize();
export const MOON_R = 7.5;
export const MOON_POS = new Vector3(113, 10, -91);
const K_ORBIT = 0.052 * Math.pow(110, 1.5); // rad/s at r = 110 is 0.052

/** Ring optical density 0..1 at radius r (units): C, B, Cassini, A, Encke, F. */
function ringDensity(r: number) {
  const s = (a: number, b: number, w = 0.6) => {
    const x = Math.min(1, Math.max(0, (r - a) / w));
    const y = Math.min(1, Math.max(0, (b - r) / w));
    return Math.min(x, y);
  };
  const ringlets = 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(r * 4.7) * Math.sin(r * 1.31 + 2) * Math.sin(r * 0.37));
  let d = 0;
  d += s(RING_IN, 92) * (0.16 + 0.08 * Math.sin(r * 2.9) ** 2);
  d += s(92, 117.2) * (0.88 + 0.12 * Math.sin(r * 1.7 + 1));
  d += s(117.2, 121.4, 0.4) * 0.035;
  d += s(121.4, 138.5) * (0.56 + 0.08 * Math.sin(r * 2.3));
  d -= s(133.0, 134.0, 0.15) * 0.53;
  d += s(141.6, 142.4, 0.25) * 0.75;
  return Math.max(0, d * ringlets);
}

/** Grey-blue C ring, creamy B ring, neutral A ring. */
function ringWarmth(r: number) {
  if (r < 92) return 0.15;
  if (r < 117) return 0.85;
  if (r < 140) return 0.55;
  return 0.4;
}

function makeRingTextures() {
  const n = 1024;
  const profile = new Float32Array(n * 4);
  const cdf = new Float64Array(n + 1);
  for (let k = 0; k < n; k++) {
    const r = RING_IN + ((k + 0.5) / n) * (RING_OUT - RING_IN);
    const d = ringDensity(r);
    profile[k * 4] = d;
    profile[k * 4 + 1] = Math.min(1, 0.35 + d * 0.75);
    profile[k * 4 + 2] = ringWarmth(r);
    profile[k * 4 + 3] = 1;
    cdf[k + 1] = cdf[k] + d * r;
  }
  // inverse CDF: u → normalised radius (particles follow density × area)
  const inv = new Float32Array(n * 4);
  let j = 0;
  for (let k = 0; k < n; k++) {
    const target = ((k + 0.5) / n) * cdf[n];
    while (j < n - 1 && cdf[j + 1] < target) j++;
    const span = Math.max(1e-9, cdf[j + 1] - cdf[j]);
    const x = (j + (target - cdf[j]) / span) / n;
    inv[k * 4] = x;
    inv[k * 4 + 3] = 1;
  }
  // half floats are filterable everywhere; full floats may not be
  return { profileTex: half(profile, n), invTex: half(inv, n) };
}

function half(data: Float32Array, n: number) {
  const out = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = toHalf(data[i]);
  const t = new DataTexture(out, n, 1, RGBAFormat, HalfFloatType);
  t.magFilter = LinearFilter;
  t.minFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}

const _f = new Float32Array(1);
const _i = new Uint32Array(_f.buffer);
function toHalf(v: number) {
  _f[0] = v;
  const x = _i[0];
  const sign = (x >> 16) & 0x8000;
  let e = ((x >> 23) & 0xff) - 127 + 15;
  let m = x & 0x7fffff;
  if (e <= 0) {
    if (e < -10) return sign;
    m = (m | 0x800000) >> (1 - e);
    return sign | (m >> 13);
  }
  if (e >= 31) return sign | 0x7c00;
  e = e << 10;
  return sign | e | (m >> 13);
}

export class PlanetSystem {
  readonly group = new Group();
  /** Orbital time (s), continuous through chapters I and II. */
  readonly orbitT = uniform(0);
  readonly level = uniform(1);
  readonly sun = uniform(SUN.clone());
  readonly sunColor = vec3(1.0, 0.95, 0.88);
  readonly moonCrack = uniform(0);
  readonly moonVisible = uniform(1);
  readonly nearLevel = uniform(1);
  readonly dropLevel = uniform(1);
  readonly boulderLevel = uniform(1);
  /** 1 while debris can touch the ring (#2 contact glow). */
  readonly contact = uniform(0);
  readonly profileTex: DataTexture;
  readonly invTex: DataTexture;
  readonly planet: Mesh;
  readonly rings: Mesh;
  readonly boulders: Mesh;
  readonly near: Mesh;
  readonly drops: Mesh;
  readonly moon: Mesh;
  readonly sunDisc: Mesh;

  constructor(ctx: Ctx) {
    const tex = makeRingTextures();
    this.profileTex = tex.profileTex;
    this.invTex = tex.invTex;
    this.planet = this.buildPlanet();
    this.rings = this.buildRings(Math.round(2_000_000 * ctx.q));
    this.boulders = this.buildBoulders(Math.round(30_000 * Math.max(0.4, ctx.q)));
    this.near = this.buildNearDust(Math.round(9_000 * Math.max(0.5, ctx.q)));
    this.drops = this.buildDrops(Math.round(220 * Math.max(0.5, ctx.q)));
    this.moon = this.buildMoon();
    this.sunDisc = this.buildSun();
    this.group.add(this.planet, this.rings, this.boulders, this.near, this.drops, this.moon, this.sunDisc);
    this.group.visible = false;
    ctx.scene.add(this.group);
  }

  /** Ring profile at a radius: (density, brightness, warmth). */
  profileAt(r: N): N {
    const rn = clamp(r.sub(RING_IN).div(RING_OUT - RING_IN), 0, 1);
    const inside = r.greaterThan(RING_IN).and(r.lessThan(RING_OUT));
    return select(inside, texture(this.profileTex, vec2(rn, 0.5)).level(0).rgb, vec3(0));
  }

  /** 1 in sunlight, 0 inside the planet's shadow cylinder (soft edge). */
  planetShadow(p: N): N {
    const s = dot(p, this.sun);
    const perp = length(p.sub(this.sun.mul(s)));
    const shade = smoothstep(RP + 1.5, RP - 1.5, perp).mul(smoothstep(0, -4, s));
    return float(1).sub(shade);
  }

  /** Position of a ring-orbiting grain with radius r, phase θ0, height y. */
  orbit(r: N, theta0: N, y: N): N {
    const omega = float(K_ORBIT).div(pow(r, 1.5));
    const th = theta0.add(omega.mul(this.orbitT));
    return vec3(r.mul(th.cos()), y, r.mul(th.sin()));
  }

  /** Forward-scattering phase: dust glows when you look toward the sun. */
  phase(p: N): N {
    const view = normalize(p.sub(cameraPosition));
    const g = dot(view, this.sun);
    return pow(max(g, 0), 10).mul(1.25).add(pow(max(g, 0), 2).mul(0.45)).add(0.36);
  }

  /** Brief sun glints on ice facets (#4 is applied to these). */
  glint(i: N, k: number): N {
    const is = rnd(i, k).lessThan(0.028);
    const w = sin(G.clock.mul(rnd(i, k + 1).mul(2.2).add(0.6)).add(rnd(i, k + 2).mul(60))).mul(0.5).add(0.5);
    return select(is, pow(w, 28).mul(9), float(0));
  }

  private buildPlanet(): Mesh {
    const geo = new SphereGeometry(RP, 256, 160);
    const mat = new MeshBasicNodeMaterial();
    mat.colorNode = Fn(() => {
      const p = positionWorld;
      const n = normalize(normalWorld);
      const lat = asin(clamp(n.y, -1, 1));
      const t = this.orbitT.mul(0.004);
      const q = vec3(n.x.mul(t.cos()).sub(n.z.mul(t.sin())), n.y, n.x.mul(t.sin()).add(n.z.mul(t.cos())));
      const warp = fbm2(q.mul(vec3(1.6, 7.0, 1.6))).mul(0.32).add(fbm2(q.mul(vec3(5, 22, 5)).add(3.1)).mul(0.09));
      const b = lat.mul(9.5).add(warp.mul(3.2));
      const band = sin(b).mul(0.5).add(0.5);
      const band2 = sin(b.mul(2.7).add(1.3)).mul(0.5).add(0.5);
      const cream = vec3(0.88, 0.8, 0.62);
      const tan = vec3(0.72, 0.58, 0.4);
      const pale = vec3(0.92, 0.88, 0.78);
      const umber = vec3(0.5, 0.38, 0.27);
      let col: N = mix(mix(tan, cream, band), mix(umber, pale, band2), 0.32);
      const polar = smoothstep(0.78, 0.92, abs(n.y));
      col = mix(col, vec3(0.42, 0.52, 0.6), polar.mul(0.7));
      const ndl = dot(n, this.sun);
      const day = smoothstep(-0.1, 0.32, ndl).mul(max(ndl, 0).mul(0.75).add(0.25));
      // ring shadow on the cloud tops: march to the ring plane toward the sun
      const tr = p.y.negate().div(this.sun.y);
      const hit = p.add(this.sun.mul(tr));
      const rh = length(vec2(hit.x, hit.z));
      const ringOpacity = this.profileAt(rh).x.mul(0.86);
      const ringShadow = select(tr.greaterThan(0), float(1).sub(ringOpacity), float(1));
      const view = normalize(cameraPosition.sub(p));
      const fres = pow(float(1).sub(max(dot(n, view), 0)), 4);
      const rim = vec3(0.55, 0.72, 1.0).mul(fres).mul(smoothstep(-0.35, 0.5, ndl)).mul(1.6);
      // sun behind the planet: the whole atmosphere limb lights up
      const behind = pow(max(dot(view, this.sun).negate(), 0), 5);
      const halo = vec3(1.0, 0.8, 0.6).mul(pow(fres, 1.6)).mul(behind).mul(2.4);
      const ringshine = vec3(0.6, 0.55, 0.5).mul(0.012).mul(smoothstep(0.2, -0.2, ndl));
      const lit = col.mul(day).mul(ringShadow).mul(this.sunColor).mul(1.0);
      return lit.add(rim).add(halo).add(ringshine).mul(this.level);
    })();
    const mesh = new Mesh(geo, mat);
    mesh.renderOrder = -5;
    return mesh;
  }

  private buildRings(count: number): Mesh {
    const i = instanceIndex;
    const u = rnd(i, 0);
    const rn = texture(this.invTex, vec2(u, 0.5)).level(0).x;
    const r = mix(float(RING_IN), float(RING_OUT), rn).add(gauss(i, 1).mul(0.04)).toVar();
    const prof = this.profileAt(r).toVar();
    const th0 = rnd(i, 3).mul(Math.PI * 2);
    const y = gauss(i, 4).mul(0.28).mul(rnd(i, 6).mul(0.8).add(0.6));
    const pos = this.orbit(r, th0, y).toVar();
    const dist = length(pos.sub(cameraPosition)).toVar();
    // near: individual ice grains; far: each grain stands for a patch of ring
    // so the disc reads as a solid sheet (optical depth ~1)
    const near = rnd(i, 7).pow(3).mul(0.032).add(0.011);
    const far = rnd(i, 7).mul(0.05).add(0.075);
    const size = mix(near, far, smoothstep(8, 70, dist));
    const glint = this.glint(i, 8);
    const sprite = spriteVertex({
      center: pos,
      radius: size,
      minPx: 0.75,
      bokeh: true,
      bokehFloor: 0.02,
      edgeFade: true,
      anamorphic: smoothstep(0.5, 4, glint).mul(5),
      maxPx: 90,
    });
    const lit = this.planetShadow(pos);
    const hue = mix(vec3(0.72, 0.84, 1.0), vec3(1.0, 0.84, 0.6), rnd(i, 12));
    const tint = mix(vec3(0.62, 0.68, 0.76), vec3(1.0, 0.9, 0.74), prof.z).mul(hue);
    const nearFade = smoothstep(2.0, 5.5, dist);
    // additive grains cannot occlude each other; emulate an optically thick
    // slab: scale each grain by (1 − e^(−τ/μ)) / (τ/μ) along grazing rays
    const mu = max(abs(normalize(pos.sub(cameraPosition)).y), 0.015);
    const tau = prof.x.mul(1.6).add(0.05).div(mu);
    const thick = float(1).sub(exp(tau.negate())).div(tau);
    const occl = mix(float(1), thick, smoothstep(6, 30, dist));
    const bright = prof.y.mul(this.phase(pos)).mul(lit).mul(occl).add(glint.mul(lit));
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    const base = varying(tint.mul(bright).mul(this.sunColor).mul(nearFade).mul(this.level).mul(0.85));
    const viewZ = varying(G.viewMatrix.mul(vec4(pos, 1)).z);
    // #2 grains that graze a solid surface (a moon chunk) light up instead
    // of being softened away
    mat.colorNode = Fn(() => {
      const d = viewportDepthTexture(screenUV).x;
      const sceneZ = perspectiveDepthToViewZ(d, cameraNear, cameraFar);
      const gap = abs(sceneZ.sub(viewZ));
      const touch = float(1).sub(smoothstep(0.0, 1.4, gap)).mul(this.contact).mul(T(2));
      return base.add(vec3(1.0, 0.55, 0.25).mul(touch).mul(2.2));
    })();
    mat.opacityNode = mix(bokehShape(sprite), flareShape(sprite), smoothstep(1.2, 2.0, sprite.stretch)).mul(sprite.energy);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    return particleMesh(count, mat, 2);
  }

  private buildBoulders(count: number): Mesh {
    const i = instanceIndex;
    const r = mix(float(92), float(139), rnd(i, 0).pow(0.9)).toVar();
    const prof = this.profileAt(r);
    const th0 = rnd(i, 1).mul(Math.PI * 2);
    const y = gauss(i, 2).mul(0.32);
    const pos = this.orbit(r, th0, y).toVar();
    const radius = rnd(i, 3).pow(9).mul(0.95).add(0.03).mul(prof.x.mul(0.6).add(0.4)).toVar();
    const dist = length(pos.sub(cameraPosition));
    const nearFade = smoothstep(radius.mul(3).add(1.5), radius.mul(3.6).add(2.6), dist);
    const alpha = float(1).sub(smoothstep(68, 84, dist)).mul(nearFade).mul(this.boulderLevel);
    const sprite = spriteVertex({ center: pos, radius, minPx: 0.6, maxPx: 900 });
    const viewC = varying(G.viewMatrix.mul(vec4(pos, 1)).xyz);
    // irregular rocks: each impostor is squashed and turned in its own way
    const ang = varying(rnd(i, 5).mul(Math.PI * 2));
    const asp = varying(rnd(i, 6).mul(0.7).add(1));
    const l = sprite.local;
    const lp = vec2(l.x.mul(ang.cos()).sub(l.y.mul(ang.sin())), l.x.mul(ang.sin()).add(l.y.mul(ang.cos()))).mul(vec2(1, asp));
    const imp = impostorSphere(lp, viewC, varying(radius), float(1.6), varying(rnd(i, 4).mul(40)));
    const sunView = normalize(G.viewMatrix.mul(vec4(this.sun, 0)).xyz);
    const lit = varying(this.planetShadow(pos));
    const ice = makeMatcap("rockice");
    const shade = matcapShade(ice, imp.normal, sunView, vec3(0.86, 0.87, 0.9));
    const direct = max(dot(imp.normal, sunView), 0).mul(lit);
    // backlit ice: a thin bright crescent on the edge that faces the sun
    const back = max(sunView.z.negate(), 0);
    const towardSun = max(dot(normalize(imp.normal.xy.add(vec2(1e-4, 0))), normalize(sunView.xy.add(vec2(1e-4, 0)))), 0);
    const rim = pow(float(1).sub(imp.normal.z), 5).mul(towardSun).mul(back).mul(lit).mul(1.1);
    const col = shade.mul(direct.mul(0.95).add(0.025)).add(vec3(1.0, 0.92, 0.8).mul(rim)).mul(this.level);
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = col;
    mat.depthNode = imp.depth;
    mat.maskNode = imp.inside.and(ditherKeep(varying(alpha)));
    mat.transparent = false;
    mat.depthWrite = true;
    return particleMesh(count, mat, 0);
  }

  /** Dust in a box that travels with the camera (wraps around it). */
  private wrapped(i: N, box: number, ySigma: number, k: number): N {
    const half = box / 2;
    const p0 = vec3(rnd(i, k).mul(box), gauss(i, k + 1).mul(ySigma), rnd(i, k + 3).mul(box));
    const drift = vec3(0.06, 0, 0.11).mul(G.clock);
    const rel = p0.add(drift).sub(cameraPosition);
    const wx = mod(rel.x.add(half), box).sub(half);
    const wz = mod(rel.z.add(half), box).sub(half);
    return vec3(cameraPosition.x.add(wx), p0.y, cameraPosition.z.add(wz));
  }

  private buildNearDust(count: number): Mesh {
    const i = instanceIndex;
    const pos = this.wrapped(i, 18, 0.55, 0).toVar();
    const size = rnd(i, 5).pow(2).mul(0.012).add(0.003);
    const glint = this.glint(i, 6);
    const sprite = spriteVertex({
      center: pos,
      radius: size,
      bokeh: true,
      bokehFloor: 0.035,
      edgeFade: true,
      minPx: 0.7,
      maxPx: 150,
      anamorphic: smoothstep(0.5, 4, glint).mul(6),
    });
    const prof = this.profileAt(length(vec2(pos.x, pos.z)));
    const lit = this.planetShadow(pos);
    const edge = float(1).sub(smoothstep(6, 9, length(pos.sub(cameraPosition))));
    const bright = prof.x.mul(0.8).add(0.2).mul(this.phase(pos)).add(glint).mul(lit).mul(edge);
    const hue = mix(vec3(0.7, 0.84, 1.0), vec3(1.0, 0.82, 0.58), rnd(i, 9));
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = varying(hue.mul(bright).mul(this.nearLevel).mul(this.level).mul(0.7));
    mat.opacityNode = mix(bokehShape(sprite), flareShape(sprite), smoothstep(1.2, 2.0, sprite.stretch)).mul(sprite.energy);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    return particleMesh(count, mat, 3);
  }

  /** #3 water / ice drops that refract the frame behind them. */
  private buildDrops(count: number): Mesh {
    const i = instanceIndex;
    const pos = this.wrapped(i, 11, 0.7, 10).toVar();
    const radius = rnd(i, 15).pow(2).mul(0.05).add(0.018);
    const sprite = spriteVertex({ center: pos, radius, minPx: 1.5, maxPx: 120 });
    const dist = length(pos.sub(cameraPosition));
    const vis = varying(smoothstep(0.25, 0.6, dist).mul(float(1).sub(smoothstep(3.5, 5.5, dist))).mul(this.dropLevel));
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = Fn(() => {
      const p = sprite.local;
      const r2 = dot(p, p);
      const nz = sqrt(max(float(1).sub(r2), 0));
      // centre of the drop on screen, then look through it upside down
      const px = vec2(p.x, p.y.negate()).mul(sprite.rpx).div(screenSize);
      const center = screenUV.sub(px);
      const through = center.sub(px.mul(2.6));
      const bent = viewportSharedTexture(through).rgb;
      const plain = viewportSharedTexture(screenUV).rgb;
      const fres = pow(float(1).sub(nz), 3);
      const spec = pow(max(float(1).sub(length(p.sub(vec2(-0.35, 0.4))).mul(2.6)), 0), 6).mul(2.5);
      const refr = mix(plain.mul(1.04).add(0.02), bent.mul(1.15), T(3));
      return refr.add(vec3(0.75, 0.85, 1.0).mul(fres.mul(0.55).add(spec)));
    })();
    mat.opacityNode = Fn(() => {
      const p = sprite.local;
      const r2 = dot(p, p);
      const aa = float(1.5).div(sprite.rpx.max(1));
      return float(1).sub(smoothstep(float(1).sub(aa), float(1), sqrt(r2))).mul(vis);
    })();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = NormalBlending;
    return particleMesh(count, mat, 40);
  }

  /** The sun: a white-hot disc with a long anamorphic streak (#4). */
  private buildSun(): Mesh {
    const d = 4200;
    const center = cameraPosition.add(this.sun.mul(d));
    const sprite = spriteVertex({ center, radius: float(d * 0.012), minPx: 2, maxPx: 900, anamorphic: float(26) });
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    const p = sprite.local;
    const core = exp(dot(p, p).mul(-2.2)).mul(60);
    const halo = exp(length(p).mul(-0.9)).mul(2.5);
    const streak = exp(abs(p.y).mul(-5)).mul(exp(abs(p.x).div(sprite.stretch).mul(-3.5))).mul(9);
    mat.colorNode = vec3(1.0, 0.93, 0.82).mul(this.level);
    mat.opacityNode = core.add(halo.mul(0.4)).add(streak.mul(T(4))).mul(float(1).sub(smoothstep(0.8, 1, abs(p.x).div(sprite.stretch))));
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    return particleMesh(1, mat, -4);
  }

  private buildMoon(): Mesh {
    const geo = new SphereGeometry(MOON_R, 192, 128);
    const mat = new MeshBasicNodeMaterial();
    // the fractures start on the side that faces the giant (tidal stress) and spread
    const o = MOON_POS.clone().negate().normalize();
    const origin = vec3(o.x, o.y, o.z);
    mat.colorNode = Fn(() => {
      const n = normalize(normalWorld).toVar();
      // highlands and dark maria, craters at two scales (bowls with raised rims)
      const maria = smoothstep(0.05, 0.35, fbm2(n.mul(1.7).add(4)));
      const crater = (d: N, rc: number): N => {
        const bowl = float(1).sub(smoothstep(rc * 0.62, rc, d));
        const rim = exp(d.sub(rc).div(rc * 0.22).pow(2).negate());
        return bowl.mul(-0.32).add(rim.mul(0.28));
      };
      const relief = crater(sqrt(voronoi3d(n.mul(5.5), float(0))), 0.32).add(crater(sqrt(voronoi3d(n.mul(14).add(2.5), float(0))), 0.28).mul(0.6));
      const grit = snoiseGrad(n.mul(40)).w.mul(0.08).add(1);
      const albedo = mix(vec3(0.46, 0.45, 0.43), vec3(0.19, 0.19, 0.2), maria).mul(relief.add(1)).mul(grit);
      const ndl = dot(n, this.sun);
      const lit = smoothstep(-0.05, 0.25, ndl).mul(max(ndl, 0).mul(0.8).add(0.2));
      // #24 the fracture front: big plates crack first, finer splits follow behind it
      const w = n.add(snoiseGrad(n.mul(2.2)).xyz.mul(0.07)).toVar();
      const ang = acos(clamp(dot(n, origin), -1, 1));
      const front = this.moonCrack.mul(3.4);
      const reveal = smoothstep(front, front.sub(0.45), ang);
      const revealFine = smoothstep(front.sub(0.6), front.sub(1.3), ang).mul(smoothstep(0.45, 0.8, this.moonCrack));
      const width = this.moonCrack.mul(0.03).add(0.007);
      const big = voronoiCracks(w.mul(2.4), width).mul(reveal);
      const fine = voronoiCracks(w.mul(6.5).add(1.3), width.mul(0.5)).mul(revealFine).mul(0.6);
      const halo = voronoiCracks(w.mul(2.4), width.mul(3)).mul(reveal).mul(0.12);
      // dull red at first, orange, then white-hot just before it bursts
      const glow = blackbody(float(1).sub(this.moonCrack.mul(0.72))).mul(max(big, fine).add(halo)).mul(this.moonCrack.mul(1.8).add(0.4));
      return albedo.mul(lit).mul(this.sunColor).add(glow).mul(this.level);
    })();
    const mesh = new Mesh(geo, mat);
    mesh.position.copy(MOON_POS);
    return mesh;
  }
}
