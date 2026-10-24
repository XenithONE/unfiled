/**
 * III — 星の川. A river of a million grains meets a colossal knot.
 *
 * #28 SDF volume collision: the knot's distance field (gradient + distance)
 *     is baked once by a compute pass into a 3D texture; every grain reads it
 *     and is pushed out along the normal, so the river parts and wraps.
 * #29 history ring buffer: one big buffer indexed [id × H + frame % H] holds
 *     the last H positions of 4096 tracers — long ribbons, no ping-pong.
 * #27 screen-space collision: the rain compares its next position with last
 *     frame's depth buffer and bounces off whatever is on screen.
 * #11 cylindrical billboards for the rain, locked to the fall direction.
 * #15 analytic curl noise drives the river; #2 grains touching the knot glow.
 */
import {
  AdditiveBlending,
  HalfFloatType,
  Matrix3,
  Mesh,
  MeshBasicNodeMaterial,
  RGBAFormat,
  Storage3DTexture,
  TorusKnotGeometry,
  Vector3,
} from "three/webgpu";
import type { DepthTexture } from "three/webgpu";
import {
  Fn,
  If,
  Loop,
  abs,
  cameraFar,
  cameraNear,
  clamp,
  cross,
  dot,
  exp,
  float,
  instanceIndex,
  instancedArray,
  ivec2,
  length,
  max,
  min,
  mix,
  normalView,
  normalize,
  perspectiveDepthToViewZ,
  pow,
  reflect,
  screenUV,
  select,
  smoothstep,
  storageTexture3D,
  texture3D,
  textureLoad,
  textureStore,
  uint,
  uniform,
  uvec3,
  varying,
  vec2,
  vec3,
  vec4,
  viewportDepthTexture,
  fract,
  uv,
} from "../tsl/t";
import type { Ctx, Look } from "../engine/chapter";
import { Chapter, ramp } from "../engine/chapter";
import { particleMesh } from "../engine/quad";
import { Track } from "../engine/rig";
import type { N } from "../tsl/common";
import { G, T, rnd } from "../tsl/common";
import { curlNoise } from "../tsl/noise";
import { glowShape, spriteVertex } from "../tsl/sprite";

// knot geometry (local space): TorusKnot(radius, tube, p = 2, q = 3)
const KR = 27;
const KT = 6.2;
const BOUNDS_MIN = new Vector3(-48, -48, -24);
const BOUNDS_SIZE = new Vector3(96, 96, 48);
const RES = [128, 128, 64] as const;
const CURVE_N = 1024;

// river domain
const X0 = -170;
const X1 = 170;
const RIVER_R = 30;
const HIST = 48;

function knotCurve(u: number, out: Vector3) {
  const p = 2;
  const q = 3;
  const cu = Math.cos(u);
  const su = Math.sin(u);
  const quOverP = (q / p) * u;
  const cs = Math.cos(quOverP);
  out.set(KR * (2 + cs) * 0.5 * cu, KR * (2 + cs) * su * 0.5, KR * Math.sin(quOverP) * 0.5);
  return out;
}

export class KnotChapter extends Chapter {
  readonly id = "knot";
  readonly numeral = "III";
  readonly name = "星の川";
  readonly caption = "百万の粒の川が、巨大な結び目にぶつかって分かれる。";
  readonly duration = 26;
  readonly techniques = [28, 29, 27, 11, 15, 2, 12, 31];

  private sdf!: Storage3DTexture;
  private bakeNode: unknown;
  private baked = false;
  private streamSim: unknown;
  private tracerSim: unknown;
  private rainSim: unknown;
  private streamInit: unknown;
  private tracerInit: unknown;
  private rainInit: unknown;
  private knot!: Mesh;
  private readonly knotRot = uniform(new Matrix3());
  private readonly knotRotInv = uniform(new Matrix3());
  private readonly flow = uniform(15);
  private readonly swirl = uniform(7);
  private readonly level = uniform(1);
  private readonly rainOn = uniform(0);
  private readonly frameSlot = uniform(0, "uint");
  private readonly P00 = uniform(1);
  private readonly P11 = uniform(1);
  private depthTex!: DepthTexture;
  private nStream = 0;
  private nTracers = 0;
  private nRain = 0;
  private frameCount = 0;
  private needsInit = true;
  private rainA: N = null;

  constructor() {
    super();
    this.fadeIn = 0;
    this.fadeOut = 0;
  }

  build(ctx: Ctx) {
    this.nStream = Math.round(1_200_000 * ctx.q);
    this.nTracers = ctx.q >= 0.6 ? 3072 : 1536;
    this.nRain = Math.round(48_000 * Math.max(0.3, ctx.q));
    this.depthTex = ctx.post.scenePass.getTexture("depth") as DepthTexture;
    this.buildSdf();
    this.buildKnot();
    this.buildStream();
    this.buildRibbons();
    this.buildRain();

    this.track = new Track([
      { t: 0, pos: [-128, 34, 86], look: [0, 0, 0], fov: 50 },
      { t: 5, pos: [-78, 14, 62], look: [0, 0, 0], fov: 52 },
      { t: 9.5, pos: [-36, 44, 70], look: [4, 0, 0], fov: 56 },
      { t: 14, pos: [34, 74, 74], look: [0, 0, 0], fov: 56 },
      { t: 18.5, pos: [96, 30, 92], look: [0, 0, 0], fov: 52 },
      { t: 22.5, pos: [96, 16, 30], look: [150, 0, 0], fov: 58 },
      { t: 26, pos: [150, 2, 2], look: [400, 0, 0], fov: 74 },
    ]);
  }

  /* -------------------------------------------------------------------- */
  /* #28 — bake the knot's distance field into a 3D texture               */
  /* -------------------------------------------------------------------- */

  private buildSdf() {
    const [rx, ry, rz] = RES;
    const tex = new Storage3DTexture(rx, ry, rz);
    tex.format = RGBAFormat;
    tex.type = HalfFloatType;
    tex.generateMipmaps = false;
    this.sdf = tex;

    const pts = new Float32Array(CURVE_N * 4);
    const v = new Vector3();
    // TorusKnotGeometry walks u over [0, 2πp] (p = 2)
    for (let k = 0; k < CURVE_N; k++) {
      knotCurve((k / CURVE_N) * Math.PI * 4, v);
      pts.set([v.x, v.y, v.z, 0], k * 4);
    }
    const curve = instancedArray(pts, "vec4");
    const count = uniform(CURVE_N, "int");
    const store = storageTexture3D(tex);

    this.bakeNode = Fn(() => {
      const i = instanceIndex;
      const x = i.mod(uint(rx));
      const y = i.div(uint(rx)).mod(uint(ry));
      const z = i.div(uint(rx * ry));
      const uvw = vec3(x.toFloat().add(0.5).div(rx), y.toFloat().add(0.5).div(ry), z.toFloat().add(0.5).div(rz));
      const p = vec3(BOUNDS_MIN.x, BOUNDS_MIN.y, BOUNDS_MIN.z).add(uvw.mul(vec3(BOUNDS_SIZE.x, BOUNDS_SIZE.y, BOUNDS_SIZE.z))).toVar();
      const best = float(1e9).toVar();
      const nearest = vec3(0).toVar();
      // the loop bound is a uniform so the compiler keeps it a loop
      Loop(count, ({ i: k }: { i: N }) => {
        const c = curve.element(k).xyz;
        const d = dot(p.sub(c), p.sub(c));
        If(d.lessThan(best), () => {
          best.assign(d);
          nearest.assign(c);
        });
      });
      const dist = best.sqrt().sub(KT);
      const grad = normalize(p.sub(nearest).add(vec3(0, 0, 1e-5)));
      textureStore(store, uvec3(x, y, z), vec4(grad, dist));
    })().compute(rx * ry * rz, [64]);
  }

  /** Samples the baked field at a world position: vec4(world normal, distance). */
  private field(p: N): N {
    const local = this.knotRotInv.mul(p);
    const uvw = local.sub(vec3(BOUNDS_MIN.x, BOUNDS_MIN.y, BOUNDS_MIN.z)).div(vec3(BOUNDS_SIZE.x, BOUNDS_SIZE.y, BOUNDS_SIZE.z));
    const inside = uvw.x.greaterThan(0.004).and(uvw.x.lessThan(0.996))
      .and(uvw.y.greaterThan(0.004)).and(uvw.y.lessThan(0.996))
      .and(uvw.z.greaterThan(0.008)).and(uvw.z.lessThan(0.992));
    const s = texture3D(this.sdf, clamp(uvw, 0.0, 1.0)).level(0);
    const n = normalize(this.knotRot.mul(s.xyz).add(vec3(0, 1e-5, 0)));
    return select(inside, vec4(n, s.w), vec4(0, 1, 0, 99));
  }

  /** Velocity of the river at p (#15 analytic curl noise on a bulk flow). */
  private flowAt(p: N): N {
    const q = p.mul(0.021).add(vec3(G.time.mul(0.035), 0, G.time.mul(0.02)));
    // laminar upstream, a turbulent wake behind the knot
    const wake = smoothstep(-46, 30, p.x).mul(0.85).add(0.15);
    const swirl = curlNoise(q).mul(this.swirl.mul(T(15)).mul(wake));
    // gentle pull back toward the river's axis
    const r = length(vec2(p.y, p.z));
    const contain = vec3(0, p.y, p.z).mul(smoothstep(RIVER_R * 0.7, RIVER_R, r).mul(-0.4));
    return vec3(this.flow, 0, 0).add(swirl).add(contain);
  }

  /** #28 response: slide along the surface, never enter it. */
  private collide(p: N, v: N, margin: number) {
    const f = this.field(p).toVar();
    const n = f.xyz;
    const d = f.w;
    const near = float(1).sub(smoothstep(0.0, margin, d)).mul(T(28));
    const vn = dot(v, n);
    const vOut = v.sub(n.mul(min(vn, 0).mul(near))).add(n.mul(near.mul(4)));
    const pOut = p.add(n.mul(max(float(0.6).sub(d), 0).mul(T(28))));
    return { v: vOut, p: pOut, d };
  }

  /* -------------------------------------------------------------------- */
  /* river                                                                */
  /* -------------------------------------------------------------------- */

  private spawn(i: N, k: number, xMin: number, xMax: number): N {
    const ang = rnd(i, k).mul(Math.PI * 2);
    const rr = rnd(i, k + 1).sqrt().mul(RIVER_R * 0.85);
    return vec3(mix(float(xMin), float(xMax), rnd(i, k + 2)), ang.cos().mul(rr), ang.sin().mul(rr).mul(0.8));
  }

  private buildStream() {
    const n = this.nStream;
    const A = instancedArray(n, "vec4");
    const B = instancedArray(n, "vec4");

    this.streamInit = Fn(() => {
      const i = instanceIndex;
      const p = this.spawn(i, 0, X0, X1);
      A.element(i).assign(vec4(p, rnd(i, 3)));
      B.element(i).assign(vec4(this.flow, 0, 0, 0));
    })().compute(n, [256]);

    this.streamSim = Fn(() => {
      const i = instanceIndex;
      const a = A.element(i);
      const b = B.element(i);
      const p = a.xyz.toVar();
      const seed = a.w.toVar();
      const v = b.xyz.toVar();
      const target = this.flowAt(p).toVar();
      const v1 = mix(v, target, float(1).sub(exp(G.dt.mul(-1.6)))).toVar();
      const c = this.collide(p, v1, 3.5);
      const v2 = c.v.toVar();
      const p2 = c.p.add(v2.mul(G.dt)).toVar();
      const touch = exp(max(c.d, 0).mul(-0.9)).toVar();
      // recycle at the outlet, re-enter at the inlet
      const out = p2.x.greaterThan(X1).or(length(vec2(p2.y, p2.z)).greaterThan(RIVER_R * 1.25));
      const respawn = vec3(float(X0).add(rnd(i, 5).mul(8)), this.spawn(i, 6, 0, 1).y, this.spawn(i, 6, 0, 1).z);
      const pNew = select(out, respawn, p2).toVar();
      const vNew = select(out, vec3(this.flow, 0, 0), v2).toVar();
      a.assign(vec4(pNew, seed));
      b.assign(vec4(vNew, touch));
    })().compute(n, [256]);

    // render: tiny grains (#31), colour by speed, glow at the knot surface (#2)
    const pos = A.toAttribute().xyz;
    const vel = B.toAttribute();
    const speed = length(vel.xyz);
    const seed = A.toAttribute().w;
    const sprite = spriteVertex({ center: pos, radius: seed.mul(0.05).add(0.035), minPx: 0.65, maxPx: 40, edgeFade: true });
    const slow = vec3(0.2, 0.42, 1.0);
    const fast = vec3(1.0, 0.78, 0.45);
    const hot = vec3(1.0, 0.95, 0.9);
    const col = mix(slow, fast, smoothstep(10, 22, speed));
    const sheath = vel.w;
    const base = varying(mix(col, hot, sheath.mul(0.8)).mul(sheath.mul(2.5).add(0.45)).mul(this.level));
    const viewZ = varying(G.viewMatrix.mul(vec4(pos, 1)).z);
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = Fn(() => {
      const d = viewportDepthTexture(screenUV).x;
      const sceneZ = perspectiveDepthToViewZ(d, cameraNear, cameraFar);
      const touch = float(1).sub(smoothstep(0.0, 2.2, abs(sceneZ.sub(viewZ)))).mul(T(2));
      return base.add(vec3(0.6, 0.9, 1.0).mul(touch).mul(1.8));
    })();
    mat.opacityNode = glowShape(sprite, 0.3).mul(sprite.energy);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    this.group.add(particleMesh(n, mat, 4));
  }

  /* -------------------------------------------------------------------- */
  /* #29 ribbons from one ring buffer                                     */
  /* -------------------------------------------------------------------- */

  private buildRibbons() {
    const n = this.nTracers;
    const P = instancedArray(n, "vec4");
    const V = instancedArray(n, "vec4");
    const H = instancedArray(n * HIST, "vec4");

    this.tracerInit = Fn(() => {
      const i = instanceIndex;
      P.element(i).assign(vec4(this.spawn(i, 20, X0, X1), 0));
      V.element(i).assign(vec4(this.flow, 0, 0, 0));
      Loop(HIST, ({ i: k }: { i: N }) => {
        H.element(i.mul(uint(HIST)).add(uint(k))).assign(vec4(0));
      });
    })().compute(n, [64]);

    this.tracerSim = Fn(() => {
      const i = instanceIndex;
      const p = P.element(i).xyz.toVar();
      const v = V.element(i).xyz.toVar();
      const target = this.flowAt(p);
      const v1 = mix(v, target, float(1).sub(exp(G.dt.mul(-1.6)))).toVar();
      const c = this.collide(p, v1, 3.5);
      const v2 = c.v.toVar();
      const p2 = c.p.add(v2.mul(G.dt)).toVar();
      const out = p2.x.greaterThan(X1).or(length(vec2(p2.y, p2.z)).greaterThan(RIVER_R * 1.25));
      const pNew = select(out, this.spawn(i, 24, X0, X0 + 10), p2).toVar();
      P.element(i).assign(vec4(pNew, 0));
      V.element(i).assign(vec4(select(out, vec3(this.flow, 0, 0), v2), 0));
      // write this frame's slot; w = 0 marks a break (respawn) so no segment
      // is drawn across the jump
      const slot = i.mul(uint(HIST)).add(this.frameSlot);
      H.element(slot).assign(vec4(pNew, select(out, float(0), float(1))));
    })().compute(n, [64]);

    // one quad per segment: instance → (tracer, age k); slots wrap mod HIST
    const segs = HIST - 1;
    const inst = instanceIndex;
    const tr = inst.div(uint(segs));
    const k = inst.mod(uint(segs));
    const headSlot = this.frameSlot.add(uint(HIST)).sub(k).mod(uint(HIST));
    const tailSlot = this.frameSlot.add(uint(HIST * 2)).sub(k).sub(uint(1)).mod(uint(HIST));
    const head = H.element(tr.mul(uint(HIST)).add(headSlot));
    const tail = H.element(tr.mul(uint(HIST)).add(tailSlot));
    const ok = head.w.mul(tail.w).mul(select(length(head.xyz.sub(tail.xyz)).lessThan(6), float(1), float(0)));
    const age = k.toFloat().div(segs);
    const sprite = spriteVertex({
      center: head.xyz,
      radius: float(0.05),
      tail: tail.xyz,
      streakKeep: 1,
      minPx: 0.8,
      maxPx: 12,
      visible: ok.mul(T(29)),
    });
    const tint = mix(vec3(0.45, 0.95, 1.0), vec3(0.95, 0.4, 1.0), age);
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = varying(tint.mul(pow(float(1).sub(age), 1.6)).mul(0.6).mul(this.level));
    mat.opacityNode = glowShape(sprite, 0.6).mul(sprite.energy);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    this.group.add(particleMesh(n * segs, mat, 5));
  }

  /* -------------------------------------------------------------------- */
  /* #27 rain that bounces off the depth buffer, #11 drawn as streaks     */
  /* -------------------------------------------------------------------- */

  private buildRain() {
    const n = this.nRain;
    const A = instancedArray(n, "vec4");
    const B = instancedArray(n, "vec4");
    this.rainA = A;
    const top = 76;
    const spawnRain = (i: N, k: number): N => {
      const ang = rnd(i, k).mul(Math.PI * 2);
      const rr = rnd(i, k + 1).sqrt().mul(40);
      return vec3(ang.cos().mul(rr), float(top).add(rnd(i, k + 2).mul(70)), ang.sin().mul(rr));
    };

    this.rainInit = Fn(() => {
      const i = instanceIndex;
      const p = spawnRain(i, 0);
      A.element(i).assign(vec4(p.x, p.y.sub(rnd(i, 3).mul(150)), p.z, 0));
      B.element(i).assign(vec4(0, -42, 0, 0));
    })().compute(n, [256]);

    const depth = this.depthTex;
    this.rainSim = Fn(() => {
      const i = instanceIndex;
      const a = A.element(i);
      const b = B.element(i);
      const p = a.xyz.toVar();
      const flash = a.w.toVar();
      const v = b.xyz.toVar();
      v.addAssign(vec3(0.6, -14, 0).mul(G.dt));
      const next = p.add(v.mul(G.dt)).toVar();

      // #27: project the next position with last frame's camera and compare
      // it with last frame's depth
      const clip = G.prevViewProj.mul(vec4(next, 1)).toVar();
      const ndc = clip.xyz.div(clip.w.max(1e-4)).toVar();
      const uvS = vec2(ndc.x.mul(0.5).add(0.5), float(0.5).sub(ndc.y.mul(0.5))).toVar();
      const onScreen = clip.w.greaterThan(0.1)
        .and(uvS.x.greaterThan(0.002)).and(uvS.x.lessThan(0.998))
        .and(uvS.y.greaterThan(0.002)).and(uvS.y.lessThan(0.998));
      const px = ivec2(uvS.mul(G.screen)).toVar();
      const dC = textureLoad(depth, px).x.toVar();
      const sceneZ = perspectiveDepthToViewZ(dC, G.near, G.far).toVar();
      const partZ = clip.w.negate();
      const hit = onScreen.and(dC.lessThan(0.99999)).and(partZ.lessThan(sceneZ.sub(0.02))).and(partZ.greaterThan(sceneZ.sub(3.0))).and(T(27).greaterThan(0.5)).and(this.rainOn.greaterThan(0.5));

      If(hit, () => {
        // normal from the depth gradient (view space), then to world
        const viewAt = (q: N, dd: N): N => {
          const z = perspectiveDepthToViewZ(dd, G.near, G.far);
          const nd = vec2(q.x.toFloat().add(0.5).div(G.screen.x).mul(2).sub(1), float(1).sub(q.y.toFloat().add(0.5).div(G.screen.y).mul(2)));
          return vec3(nd.x.mul(z.negate()).div(this.P00), nd.y.mul(z.negate()).div(this.P11), z);
        };
        const pxR = px.add(ivec2(2, 0));
        const pxU = px.add(ivec2(0, -2));
        const c0 = viewAt(px, dC);
        const cR = viewAt(pxR, textureLoad(depth, pxR).x);
        const cU = viewAt(pxU, textureLoad(depth, pxU).x);
        const nV = normalize(cross(cR.sub(c0), cU.sub(c0)).add(vec3(0, 0, 1e-6)));
        const nVf = select(nV.z.lessThan(0), nV.negate(), nV);
        const nW = normalize(G.invView.mul(vec4(nVf, 0)).xyz);
        v.assign(reflect(v, nW).mul(0.42).add(nW.mul(1.5)));
        flash.assign(1);
      }).Else(() => {
        p.assign(next);
      });
      flash.assign(flash.mul(exp(G.dt.mul(-2.2))));
      const reset = p.y.lessThan(-70).or(this.rainOn.lessThan(0.5).and(p.y.lessThan(top)));
      const pr = spawnRain(i, 8);
      a.assign(select(reset, vec4(pr, 0), vec4(p, flash)));
      b.assign(select(reset, vec4(0, -42, 0, 0), vec4(v, 0)));
    })().compute(n, [256]);

    const pos = A.toAttribute();
    const vel = B.toAttribute().xyz;
    const speed = length(vel).max(1e-3);
    const sprite = spriteVertex({
      center: pos.xyz,
      radius: float(0.018).mul(pos.w.mul(5).add(1)),
      axis: vel.div(speed),
      axisHalf: speed.mul(0.028).add(0.05),
      minPx: 0.8,
      visible: this.rainOn,
    });
    const glow = pos.w;
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = varying(mix(vec3(0.55, 0.7, 1.0).mul(0.22), vec3(1.0, 0.85, 0.6).mul(5), glow).mul(this.level));
    mat.opacityNode = glowShape(sprite, 0.5).mul(sprite.energy);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    this.group.add(particleMesh(n, mat, 6));
  }

  /* -------------------------------------------------------------------- */
  /* the knot                                                             */
  /* -------------------------------------------------------------------- */

  private buildKnot() {
    const geo = new TorusKnotGeometry(KR, KT, 720, 64, 2, 3);
    const mat = new MeshBasicNodeMaterial();
    mat.colorNode = Fn(() => {
      const n = normalize(normalView);
      const fres = pow(float(1).sub(abs(n.z)), 3);
      // hull panels: rings along the tube and seams around it (geometry uv)
      const u = uv().x.mul(240);
      const v = uv().y.mul(8);
      const ring = float(1).sub(smoothstep(0.0, 0.035, abs(fract(u).sub(0.5)).sub(0.46).abs()));
      const seam = float(1).sub(smoothstep(0.0, 0.03, abs(fract(v).sub(0.5)).sub(0.47).abs()));
      const grid = max(ring.mul(0.5), seam);
      // light pulses running along the seams
      const run = pow(fract(uv().x.mul(6).sub(G.clock.mul(0.18))), 18);
      const vein = vec3(0.35, 0.85, 1.0).mul(seam.mul(run.mul(5).add(0.25)).add(ring.mul(0.06)));
      const hull = vec3(0.012, 0.014, 0.02).add(vec3(0.25, 0.36, 0.55).mul(fres).mul(0.35));
      const sheen = pow(max(dot(n, vec3(0.3, 0.6, 0.74)), 0), 30).mul(0.18);
      return hull.mul(float(1).sub(grid.mul(0.4))).add(vein).add(sheen);
    })();
    const knot = new Mesh(geo, mat);
    this.knot = knot;
    this.group.add(knot);
  }

  /* -------------------------------------------------------------------- */

  enter(ctx: Ctx) {
    this.needsInit = true;
    this.updateKnot(0);
    this.ensureInit(ctx);
  }

  private ensureInit(ctx: Ctx) {
    if (!this.baked) {
      ctx.renderer.compute(this.bakeNode as never);
      this.baked = true;
    }
    if (!this.needsInit) return;
    this.needsInit = false;
    ctx.renderer.compute(this.streamInit as never);
    ctx.renderer.compute(this.tracerInit as never);
    ctx.renderer.compute(this.rainInit as never);
    // let the river settle around the knot before it is seen
    const dt = G.dt.value as number;
    G.dt.value = 1 / 30;
    for (let k = 0; k < 45; k++) {
      ctx.renderer.compute(this.streamSim as never);
      this.stepTracers(ctx);
    }
    G.dt.value = dt;
  }

  private stepTracers(ctx: Ctx) {
    this.frameCount++;
    this.frameSlot.value = this.frameCount % HIST;
    ctx.renderer.compute(this.tracerSim as never);
  }

  private updateKnot(t: number) {
    const k = this.knot;
    k.rotation.set(0.26, 1.05 + t * 0.035, 0.12 + t * 0.06, "YXZ");
    k.updateMatrixWorld();
    const m = new Matrix3().setFromMatrix4(k.matrixWorld);
    this.knotRot.value.copy(m);
    this.knotRotInv.value.copy(m).transpose();
  }

  update(ctx: Ctx, t: number) {
    this.updateKnot(t);
    this.rainOn.value = t > 9 && t < 24.5 ? 1 : 0;
    this.level.value = 1;
    const P = ctx.camera.projectionMatrix.elements;
    this.P00.value = P[0];
    this.P11.value = P[5];
  }

  simulate(ctx: Ctx) {
    this.ensureInit(ctx);
    ctx.renderer.compute(this.streamSim as never);
    this.stepTracers(ctx);
    ctx.renderer.compute(this.rainSim as never);
  }

  /** Test hook: how many raindrops are glowing from a bounce right now. */
  async rainBounces(ctx: Ctx) {
    const buf = new Float32Array(await ctx.renderer.getArrayBufferAsync(this.rainA.value));
    let lit = 0;
    for (let k = 3; k < buf.length; k += 4) if (buf[k] > 0.1) lit++;
    return { drops: buf.length / 4, lit };
  }

  look(t: number, out: Look) {
    out.bloom = [0.9, 0.5, 0.45];
    out.sky = 0.6;
    out.near = 0.1;
    out.far = 6000;
    out.focus = 60;
    out.aperture = 0;
    out.warp = (1 - ramp(t, 0, 1.6)) * 0.7 + ramp(t, 24.2, 26) * 0.6;
    out.flash = (1 - ramp(t, 0, 1.2)) * 1.1 + ramp(t, 25.0, 26) * 1.0;
    out.flashColor = [0.75, 0.85, 1.0];
  }
}
