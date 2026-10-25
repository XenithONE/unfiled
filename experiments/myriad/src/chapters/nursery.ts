/**
 * IV — 星の揺籃. Pillars of dust in a stellar nursery, lit from above.
 *
 * #41 The nebula is a raymarched volume. The pillars are an analytic field —
 *     bent, tapered columns with lumpy heads, globules at their tips and a dark
 *     bank at their feet — roughened by a tileable noise texture baked once by
 *     compute. A second compute pass marches from every cell of a 3D grid
 *     toward the young cluster and stores how much of its light gets through.
 *     Per pixel the ray takes long steps through empty space and short ones
 *     near the dust (the field is a distance), so a hundred and sixty steps
 *     reach from the glowing wall to the lens. Gas glows where the cluster's
 *     light reaches it; dust scatters it on the lit skin and swallows it inside.
 * The grains of gas are a compute simulation (#15 curl noise) that reads last
 * frame's depth buffer (depth-only stand-ins for the pillars) once per frame:
 * #7  marching toward the light on screen; a pillar in front means shadow;
 * #2  a pillar surface at its own depth lights it up (an ionisation front).
 * #25 atomicAdd counts grains into a 3D grid; crowded cells glow white-hot.
 * #13 the protostars' jets twist with height; #3 heat shimmer bends the frame.
 */
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  CapsuleGeometry,
  CustomBlending,
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  NormalBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  RGBAFormat,
  Storage3DTexture,
  Vector2,
  Vector3,
} from "three/webgpu";
import type { DepthTexture } from "three/webgpu";
import {
  Break,
  Fn,
  If,
  Loop,
  abs,
  atomicAdd,
  atomicLoad,
  atomicStore,
  cameraPosition,
  clamp,
  cos,
  cross,
  dot,
  exp,
  float,
  floor,
  instanceIndex,
  instancedArray,
  ivec2,
  length,
  max,
  min,
  mix,
  normalize,
  perspectiveDepthToViewZ,
  positionLocal,
  positionWorld,
  pow,
  screenUV,
  select,
  sin,
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
  viewportSharedTexture,
} from "../tsl/t";
import type { Ctx, Look } from "../engine/chapter";
import { Chapter, ramp } from "../engine/chapter";
import { particleMesh } from "../engine/quad";
import { Track } from "../engine/rig";
import type { N } from "../tsl/common";
import { G, T, gauss, rnd } from "../tsl/common";
import { curlNoise, snoiseGrad } from "../tsl/noise";
import { flareShape, glowShape, ign, spriteVertex } from "../tsl/sprite";
import { ensureNoise, rayBox, sharedNoise } from "../tsl/volume";

interface Pillar {
  a: Vector3;
  b: Vector3;
  ra: number;
  rb: number;
  /** Sideways bow of the spine at mid-height. */
  bend: Vector3;
}

const PILLARS: Pillar[] = [
  { a: new Vector3(-62, -70, 0), b: new Vector3(-36, 96, -12), ra: 24, rb: 12, bend: new Vector3(-9, 0, 5) },
  { a: new Vector3(8, -70, 22), b: new Vector3(16, 58, 8), ra: 19, rb: 9.5, bend: new Vector3(6, 0, -4) },
  { a: new Vector3(72, -70, -12), b: new Vector3(58, 26, -22), ra: 15, rb: 7.5, bend: new Vector3(5, 0, 3) },
];
/** Small dense globules at the pillar tips (the "EGGs"), as (centre, radius). */
const GLOBULES: [number, number, number, number][] = [
  [-41, 109, -9, 3.6],
  [-30, 106, -16, 2.6],
  [-47, 102, -3, 2.2],
  [12, 69, 12, 2.8],
  [21, 66, 4, 2.0],
  [55, 34, -18, 2.3],
  [63, 31, -26, 1.7],
];
const CLUSTER = new Vector3(18, 205, -95);
const BOX_MIN = new Vector3(-190, -90, -95);
const BOX_SIZE = new Vector3(380, 270, 200);
const GX = 64;
const GY = 48;
const GZ = 44;
/** The raymarched nebula, and the grid that holds the cluster's light. */
const VMIN = new Vector3(-600, -150, -380);
const VMAX = new Vector3(600, 380, 160);
const LMIN = new Vector3(-150, -125, -90);
const LMAX = new Vector3(150, 150, 85);
const LRES: [number, number, number] = [128, 120, 76];

const v3 = (v: Vector3) => vec3(v.x, v.y, v.z);

/** Polynomial smooth minimum. */
function smin(a: N, b: N, k: number): N {
  const h = max(float(k).sub(abs(a.sub(b))), 0).div(k);
  return min(a, b).sub(h.mul(h).mul(k * 0.25));
}

export class NurseryChapter extends Chapter {
  readonly id = "nursery";
  readonly numeral = "IV";
  readonly name = "星の揺籃";
  readonly caption = "塵の柱の先で、星が生まれようとしている。";
  readonly duration = 26;
  readonly techniques = [41, 15, 7, 2, 25, 13, 3, 39, 4, 12, 31];

  private readonly level = uniform(1);
  private readonly sunUv = uniform(new Vector2(0.5, 0));
  private readonly sunOnScreen = uniform(1);
  private readonly clusterPos = uniform(CLUSTER.clone());
  private readonly steps = uniform(170, "int");
  private depthTex!: DepthTexture;
  private nGas = 0;
  private gasInit: unknown;
  private gasSim: unknown;
  private gridClear: unknown;
  private gridCount: unknown;
  private lightBake: unknown;
  private lightBaked = false;
  private light!: Storage3DTexture;
  private needsInit = true;
  private tmp = new Vector3();

  constructor() {
    super();
    this.fadeIn = 0;
  }

  build(ctx: Ctx) {
    this.nGas = Math.round(1_100_000 * ctx.q);
    this.depthTex = ctx.post.scenePass.getTexture("depth") as DepthTexture;
    this.steps.value = ctx.q >= 0.6 ? 128 : ctx.q >= 0.3 ? 100 : 80;
    for (const p of PILLARS) this.group.add(this.buildProxy(p));
    this.buildLight();
    this.group.add(this.buildNebula());
    this.buildGas();
    this.buildCluster();
    this.buildJets();
    this.track = new Track([
      { t: 0, pos: [-24, -32, 190], look: [-6, 70, -40], fov: 56 },
      { t: 6, pos: [-98, 18, 78], look: [-40, 74, -12], fov: 50 },
      { t: 11, pos: [-14, 104, 44], look: [-36, 98, -12], fov: 46 },
      { t: 16, pos: [48, 74, 64], look: [16, 60, 8], fov: 48 },
      { t: 21, pos: [70, 44, 240], look: [0, 40, -20], fov: 52 },
      { t: 26, pos: [10, 70, 460], look: [0, 40, 0], fov: 50 },
    ]);
  }

  /* -------------------------------------------------------------------- */
  /* the field                                                            */
  /* -------------------------------------------------------------------- */

  /** Noise (Perlin fBm, billows, fine, warp) at p in texture tiles. */
  private noise(p: N): N {
    return texture3D(sharedNoise().texture, p).level(0);
  }

  /** Distance to the smooth pillars (before roughening). */
  private pillarDist(p: N): N {
    let d: N = float(1e5);
    for (const pl of PILLARS) {
      const a = v3(pl.a);
      const ba = v3(pl.b.clone().sub(pl.a));
      const h = clamp(dot(p.sub(a), ba).div(dot(ba, ba)), 0, 1);
      // bowed spine, a waist and a swollen head
      const bow = v3(pl.bend).mul(sin(h.mul(Math.PI)));
      const head = exp(h.sub(0.94).div(0.07).pow(2).negate()).mul(pl.rb * 0.4);
      const waist = sin(h.mul(7.0).add(pl.ra)).mul(0.08).add(1);
      const r = mix(float(pl.ra), float(pl.rb), pow(h, 0.8)).mul(waist).add(head);
      d = smin(d, length(p.sub(a).sub(ba.mul(h)).sub(bow)).sub(r), 7);
    }
    for (const [x, y, z, r] of GLOBULES) d = smin(d, length(p.sub(vec3(x, y, z))).sub(r), 2.5);
    return d;
  }

  /** The dark cloud the pillars rise from: a low, lumpy mound under them only. */
  private bankDist(p: N): N {
    const e = length(vec2(p.x.div(150), p.z.sub(-10).div(85)));
    return p.y.sub(-90).add(max(e.sub(1), 0).mul(90));
  }

  /** Coarse distance to any dust for the bake (the bank's crests reach 32 higher, the big billows 12). */
  private coarseDist(p: N, dp: N): N {
    return min(dp, this.bankDist(p).sub(32)).sub(12);
  }

  /**
   * Dust density 0..1 at p: the pillars and the bank, carved by the baked
   * noise — bulbous billows on columns stretched along the height, then finer
   * fBm erosion — with a crisp edge.
   */
  private dust(p: N, rough: N, fine: boolean): N {
    return smoothstep(0.4, -1.1, this.dustDist(p, rough, fine));
  }

  /**
   * The large shape, baked into the grid: pillars and bank merged, carved by
   * the big billows (the bank's crests only where it is near).
   */
  private roughDist(p: N): N {
    const bd = this.bankDist(p).toVar();
    const bank = bd.add(40).toVar();
    If(bd.lessThan(46), () => {
      const nb = this.noise(vec3(p.x.mul(1 / 160), 0.37, p.z.mul(1 / 160)));
      bank.assign(bd.sub(nb.x.mul(24)).sub(nb.y.mul(10)));
    });
    const d1 = smin(this.pillarDist(p), bank, 18);
    const n1 = this.noise(p.mul(vec3(1 / 56, 1 / 200, 1 / 56)).add(vec3(0.13, 0.71, 0.29)));
    return d1.add(float(0.58).sub(n1.y).mul(10)).add(n1.x.mul(5));
  }

  /** The roughened distance to the dust (dust where it is below ~0), from the large shape. */
  private dustDist(p: N, rough: N, fine: boolean): N {
    // mid detail stretched along the height: striations, not bubbles
    const n2 = this.noise(p.mul(vec3(1 / 18, 1 / 64, 1 / 18)).add(vec3(0.53, 0.11, 0.87)));
    let d: N = rough.add(n2.x.mul(3.6)).add(n2.z.mul(1.6));
    if (fine) d = d.add(this.noise(p.mul(1 / 7.5).add(vec3(0.21, 0.67, 0.43))).z.mul(0.45));
    return d;
  }

  /**
   * The baked grid at p: vec3(transmittance of the cluster's light, distance to
   * the smooth pillars, distance to the grid). Outside the grid the light is
   * unblocked and the pillars are at least as far as the grid.
   */
  private field(p: N): N {
    const lmin = v3(LMIN);
    const lmax = v3(LMAX);
    const uvw = p.sub(lmin).div(lmax.sub(lmin));
    const outside = max(max(lmin.sub(p), p.sub(lmax)), vec3(0));
    const dBox = length(outside);
    const s = texture3D(this.light, clamp(uvw, 0, 1)).level(0);
    return select(dBox.greaterThan(0), vec3(1, dBox.add(8), dBox), vec3(s.x, s.y, 0));
  }

  /** The cluster's light at p: the baked transmittance times the fall-off with distance. */
  private falloff(p: N): N {
    const dc = length(p.sub(this.clusterPos)).div(185);
    return float(1).div(dc.mul(dc).add(1));
  }

  /* -------------------------------------------------------------------- */
  /* #41 — the cluster's light, baked once                                */
  /* -------------------------------------------------------------------- */

  private buildLight() {
    const [rx, ry, rz] = LRES;
    const tex = new Storage3DTexture(rx, ry, rz);
    tex.format = RGBAFormat;
    tex.type = HalfFloatType;
    tex.generateMipmaps = false;
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearFilter;
    this.light = tex;
    const store = storageTexture3D(tex);
    const steps = uniform(56, "int");
    const lmin = v3(LMIN);
    const lsize = v3(LMAX.clone().sub(LMIN));
    this.lightBake = Fn(() => {
      const i = instanceIndex;
      const x = i.mod(uint(rx));
      const y = i.div(uint(rx)).mod(uint(ry));
      const z = i.div(uint(rx * ry));
      const p = lmin.add(vec3(x.toFloat(), y.toFloat(), z.toFloat()).add(0.5).div(vec3(rx, ry, rz)).mul(lsize)).toVar();
      const toC = this.clusterPos.sub(p);
      const dist = length(toC);
      const dir = toC.div(dist).toVar();
      // only the stretch inside the grid can hold dust
      const exit = rayBox(p, dir, lmin, v3(LMAX)).y;
      const span = min(exit, dist).max(0);
      const ds = span.div(steps.toFloat()).toVar();
      const tau = float(0).toVar();
      Loop(steps, ({ i: k }: { i: N }) => {
        const q = p.add(dir.mul(k.toFloat().add(0.5).mul(ds))).toVar();
        If(this.coarseDist(q, this.pillarDist(q)).lessThan(6), () => {
          tau.addAssign(this.dust(q, this.roughDist(q), false).mul(ds));
        });
      });
      // the cell's own dust shades it a little too (no hard self-lit skin);
      // the large carved shape is stored beside it for the raymarch
      const rough = this.roughDist(p).toVar();
      const self = this.dust(p, rough, false);
      const tr = exp(tau.add(self.mul(1.2)).mul(-0.42));
      textureStore(store, uvec3(x, y, z), vec4(tr, rough, 0, 1));
    })().compute(rx * ry * rz, [64]);
  }

  /* -------------------------------------------------------------------- */
  /* #41 — the raymarched nebula                                          */
  /* -------------------------------------------------------------------- */

  private buildNebula(): Mesh {
    const size = VMAX.clone().sub(VMIN);
    const geo = new BoxGeometry(size.x, size.y, size.z);
    const mat = new MeshBasicNodeMaterial();
    const bmin = v3(VMIN);
    const bmax = v3(VMAX);
    mat.colorNode = Fn(() => {
      const ro = cameraPosition;
      const rd = normalize(positionWorld.sub(ro)).toVar();
      const hit = rayBox(ro, rd, bmin, bmax);
      const t0 = max(hit.x, 0);
      const t1 = hit.y;
      // the distance to the front of the wall along the ray (no stride may leap it)
      const toWall = (q: N): N => select(rd.z.lessThan(-0.01), q.z.add(40).div(rd.z.negate()), float(1e4)).max(0);
      const stride = (q: N, f: N, minStep: N): N => {
        // in the grid: short near the dust (the fine carving reaches 5.6 in); outside
        // it: up to the grid or the wall
        const inGrid = clamp(f.y.sub(5.6).mul(0.8), minStep, float(14));
        const empty = select(q.z.lessThan(-40), float(15), clamp(min(f.z.add(1), toWall(q).add(1)), minStep, float(40)));
        return select(f.z.greaterThan(0), empty, inGrid);
      };
      // jitter the start by up to one whole first stride (no bands, only fine grain)
      const pStart = ro.add(rd.mul(t0)).toVar();
      const t = t0.add(ign().mul(stride(pStart, this.field(pStart), float(0.6)))).toVar();
      const tr = float(1).toVar();
      const L = vec3(0).toVar();
      Loop(this.steps, () => {
        If(t.greaterThan(t1).or(tr.lessThan(0.008)), () => {
          Break();
        });
        const p = ro.add(rd.mul(t)).toVar();
        // (transmittance of the cluster's light, distance to the carved shape, distance to the grid)
        const f = this.field(p).toVar();
        const dp = f.y;
        // long strides through empty space, short ones in the dust
        const minStep = t.mul(0.004).add(0.6);
        const ds = stride(p, f, minStep).toVar();
        const dust = float(0).toVar();
        If(dp.lessThan(6), () => {
          const dd = this.dustDist(p, dp, true);
          dust.assign(smoothstep(0.4, -1.1, dd));
          // outside the carved surface the true gap is known: stride across most of it
          ds.assign(max(dd.sub(0.4).mul(0.45), minStep));
        });
        // the wall behind: a thick cloud whose face toward the cluster glows; dark
        // lanes of dust lie across it
        const gasWall = float(0).toVar();
        const wallDust = float(0).toVar();
        const tone = float(0).toVar();
        const lit = float(1).toVar();
        const deep = float(0).toVar();
        If(p.z.lessThan(-40), () => {
          // (only features broader than the 15-unit strides here: no speckle)
          const nw = this.noise(p.mul(1 / 340).add(vec3(0.41, 0.06, 0.77)));
          const nw2 = this.noise(p.mul(1 / 190).add(vec3(0.17, 0.45, 0.23)));
          const front = float(-130).add(nw.w.mul(110)).add(nw2.w.mul(22));
          const depth = front.sub(p.z);
          const sides = float(1).sub(smoothstep(380, 560, abs(p.x)));
          const wall = smoothstep(-16, 34, depth).mul(smoothstep(-380, -300, p.z)).mul(sides);
          const billow = smoothstep(0.25, 0.85, nw.y);
          gasWall.assign(wall.mul(billow.mul(0.8).add(0.2)).mul(nw2.w.mul(0.8).add(0.9)).mul(smoothstep(-150, -80, p.y)));
          // the glow lives in the skin facing the cluster; deeper in, the gas is in its own shade
          lit.assign(exp(max(depth, 0).mul(-0.012)));
          // a few broad, soft clouds of dust in front of the glow
          wallDust.assign(smoothstep(0.15, 0.65, nw.x.mul(0.6).add(nw2.w.mul(0.4))).mul(smoothstep(-30, 0, depth)).mul(float(1).sub(smoothstep(10, 40, depth))).mul(0.5));
          tone.assign(nw2.w);
          // far inside the wall nothing more reaches the lens worth the steps
          deep.assign(select(depth.greaterThan(170), float(1), float(0)));
        });
        // photo-evaporating flows: wisps off the lit heads, streaming toward the cluster
        const flow = float(0).toVar();
        If(dp.lessThan(26), () => {
          const flowN = this.noise(p.mul(vec3(1 / 36, 1 / 16, 1 / 36)).add(G.time.mul(vec3(0, -0.004, 0))));
          flow.assign(exp(max(dp, 0).div(-6)).mul(smoothstep(0.55, 0.9, flowN.y)).mul(smoothstep(-10, 60, p.y)));
        });
        // the light also thins toward the bottom of the cloud (gas in between soaks it up)
        const I = f.x.mul(this.falloff(p)).mul(lit).mul(smoothstep(-120, 30, p.y).mul(0.8).add(0.2)).toVar();
        // colour of the glowing gas: H-alpha red low, S II gold, O III teal near the cluster
        const hgt = clamp(p.y.add(150).div(470), 0, 1).add(tone.mul(0.14));
        const gasCol = mix(mix(vec3(0.95, 0.3, 0.18), vec3(1.0, 0.66, 0.34), smoothstep(0.12, 0.45, hgt)), vec3(0.24, 0.76, 0.88), smoothstep(0.45, 0.82, hgt));
        // the lit skin of the dust: rust deep in, gold to white only where the light is full
        const skin = mix(vec3(0.3, 0.11, 0.05), vec3(1.0, 0.82, 0.58), smoothstep(0.05, 0.7, I));
        // (per unit length: thin gas adds up along the ray, thick dust saturates at emit / sigma)
        // a thin ionised layer hugs every lit surface: seen edge-on it is a bright rim
        const rimGas = exp(max(dp, 0).div(-2.5)).mul(float(1).sub(dust)).mul(I.mul(I));
        const emit = gasCol.mul(gasWall.mul(0.012).add(flow.mul(0.02))).mul(I.mul(0.9).add(0.04))
          .add(vec3(1.0, 0.8, 0.55).mul(rimGas.mul(0.09)))
          .add(skin.mul(dust.mul(pow(I, 2.4)).mul(2.6)))
          .add(vec3(0.006, 0.0032, 0.0026).mul(dust));
        const sigma = dust.mul(0.42).add(gasWall.mul(0.003)).add(wallDust.mul(0.05)).add(flow.mul(0.003)).toVar();
        const a = exp(sigma.mul(ds).negate());
        L.addAssign(emit.mul(tr).mul(float(1).sub(a)).div(sigma.max(1e-4)));
        tr.mulAssign(a);
        t.addAssign(ds);
        If(deep.greaterThan(0.5), () => {
          Break();
        });
      });
      return vec4(L.mul(this.level), float(1).sub(tr));
    })();
    mat.side = BackSide;
    mat.transparent = true;
    mat.depthWrite = false;
    mat.depthTest = false;
    mat.blending = CustomBlending;
    mat.blendSrc = OneFactor;
    mat.blendDst = OneMinusSrcAlphaFactor;
    const mesh = new Mesh(geo, mat);
    mesh.position.copy(VMIN).add(VMAX).multiplyScalar(0.5);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    return mesh;
  }

  /**
   * Depth-only stand-ins for the pillars, a little slimmer than the visible
   * dust: they let the grains (#7, #2) and the stars find the pillars in the
   * depth buffer.
   */
  private buildProxy(pl: Pillar): Mesh {
    const axis = pl.b.clone().sub(pl.a);
    const len = axis.length();
    const geo = new CapsuleGeometry(1, len, 12, 48, 64);
    const mat = new MeshBasicNodeMaterial();
    const half = len / 2;
    mat.positionNode = Fn(() => {
      const y = positionLocal.y;
      const h = clamp(y.div(len).add(0.5), 0, 1);
      const r = mix(float(pl.ra), float(pl.rb), pow(h, 0.8)).mul(0.78);
      const capY = select(abs(y).greaterThan(half), y.sign().mul(abs(y).sub(half).mul(r).add(half)), y);
      const bow = vec3(pl.bend.x, 0, pl.bend.z).mul(sin(h.mul(Math.PI)));
      return vec3(positionLocal.x.mul(r), capY, positionLocal.z.mul(r)).add(bow);
    })();
    mat.colorWrite = false;
    const mesh = new Mesh(geo, mat);
    mesh.position.copy(pl.a).add(pl.b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), axis.normalize());
    return mesh;
  }

  /* -------------------------------------------------------------------- */
  /* gas grains                                                           */
  /* -------------------------------------------------------------------- */

  /** Signed distance to the pillars as the grains see them (tapered capsules). */
  private grainDist(p: N): N {
    let d: N = float(1e5);
    for (const pl of PILLARS) {
      const a = v3(pl.a);
      const ba = v3(pl.b.clone().sub(pl.a));
      const h = clamp(dot(p.sub(a), ba).div(dot(ba, ba)), 0, 1);
      const r = mix(float(pl.ra), float(pl.rb), h);
      d = min(d, length(p.sub(a).sub(ba.mul(h))).sub(r));
    }
    return d;
  }

  private buildGas() {
    const n = this.nGas;
    const A = instancedArray(n, "vec4"); // position, size seed
    const B = instancedArray(n, "vec4"); // light (#7), front (#2), density (#25), hue
    const cells = GX * GY * GZ;
    const grid = instancedArray(cells, "uint").toAtomic();
    const boxMin = v3(BOX_MIN);
    const boxSize = v3(BOX_SIZE);
    const cellOf = (p: N): N => {
      const g = clamp(p.sub(boxMin).div(boxSize), 0, 0.9999).mul(vec3(GX, GY, GZ));
      const c = floor(g);
      return uint(c.x).add(uint(c.y).mul(uint(GX))).add(uint(c.z).mul(uint(GX * GY)));
    };
    const randomInBox = (i: N, k: number): N => boxMin.add(vec3(rnd(i, k), rnd(i, k + 1), rnd(i, k + 2)).mul(boxSize));

    this.gasInit = Fn(() => {
      const i = instanceIndex;
      // denser near the pillars: pull some samples toward the closest surface
      const p = randomInBox(i, 0).toVar();
      const d = this.grainDist(p);
      const near = rnd(i, 3).lessThan(0.55);
      const pulled = p.add(vec3(gauss(i, 4), gauss(i, 6), gauss(i, 8)).mul(6));
      const toward = mix(p, pulled, select(near.and(d.lessThan(40)), float(0.9), float(0)));
      A.element(i).assign(vec4(toward, rnd(i, 10)));
      B.element(i).assign(vec4(1, 0, 0, rnd(i, 11)));
    })().compute(n, [256]);

    this.gridClear = Fn(() => {
      atomicStore(grid.element(instanceIndex), uint(0));
    })().compute(cells, [256]);

    this.gridCount = Fn(() => {
      atomicAdd(grid.element(cellOf(A.element(instanceIndex).xyz)), uint(1));
    })().compute(n, [256]);

    const depth = this.depthTex;
    const toCluster = (p: N) => normalize(this.clusterPos.sub(p));
    this.gasSim = Fn(() => {
      const i = instanceIndex;
      const a = A.element(i);
      const b = B.element(i);
      const p = a.xyz.toVar();
      const seed = a.w.toVar();
      const hue = b.w.toVar();

      // motion: curl swirl (#15) + a wind blowing away from the cluster
      const q = p.mul(0.012).add(vec3(0, G.time.mul(0.02), G.time.mul(0.012)));
      const swirl = curlNoise(q).mul(2.2).mul(T(15));
      const d = this.grainDist(p).toVar();
      const wind = toCluster(p).mul(-1.4).mul(smoothstep(30, 0, d).mul(2).add(0.3));
      const v = swirl.add(wind).toVar();
      const pNext = p.add(v.mul(G.dt)).toVar();
      // stay outside the pillars
      const dn = this.grainDist(pNext);
      const eps = 0.5;
      const grad = normalize(
        vec3(
          this.grainDist(pNext.add(vec3(eps, 0, 0))).sub(dn),
          this.grainDist(pNext.add(vec3(0, eps, 0))).sub(dn),
          this.grainDist(pNext.add(vec3(0, 0, eps))).sub(dn),
        ).add(vec3(0, 1e-5, 0)),
      );
      pNext.addAssign(grad.mul(max(float(1.5).sub(dn), 0)));
      // wrap inside the box
      const rel = pNext.sub(boxMin).div(boxSize);
      const wrapped = boxMin.add(rel.sub(floor(rel)).mul(boxSize));

      // #25 density from last frame's count
      const count = atomicLoad(grid.element(cellOf(wrapped))).toFloat();

      // #7 / #2 from last frame's depth buffer
      const clip = G.prevViewProj.mul(vec4(wrapped, 1)).toVar();
      const ndc = clip.xyz.div(clip.w.max(1e-4));
      const uvP = vec2(ndc.x.mul(0.5).add(0.5), float(0.5).sub(ndc.y.mul(0.5))).toVar();
      const partZ = clip.w.negate().toVar();
      const light = float(1).toVar();
      const front = float(0).toVar();
      const on = clip.w.greaterThan(0.5).and(uvP.x.greaterThan(0.001)).and(uvP.x.lessThan(0.999)).and(uvP.y.greaterThan(0.001)).and(uvP.y.lessThan(0.999));
      If(on, () => {
        const here = textureLoad(depth, ivec2(uvP.mul(G.screen))).x;
        const sceneHere = perspectiveDepthToViewZ(here, G.near, G.far);
        front.assign(float(1).sub(smoothstep(0.0, 3.0, abs(sceneHere.sub(partZ)))).mul(select(here.lessThan(0.99999), float(1), float(0))));
        const toSun = this.sunUv.sub(uvP);
        const span = length(toSun.mul(vec2(G.screen.x.div(G.screen.y), 1)));
        const dir = toSun.div(max(length(toSun), 1e-4));
        const reach = min(span, float(0.28));
        const shadow = float(0).toVar();
        for (let s = 1; s <= 8; s++) {
          const uvS = clamp(uvP.add(dir.mul(reach.mul(s / 8))), 0.0, 0.999);
          const dS = textureLoad(depth, ivec2(uvS.mul(G.screen))).x;
          const zS = perspectiveDepthToViewZ(dS, G.near, G.far);
          shadow.addAssign(select(zS.greaterThan(partZ.add(1.0)).and(dS.lessThan(0.99999)), float(1 / 8), float(0)));
        }
        light.assign(float(1).sub(shadow.mul(0.95)));
      });
      const lightOut = mix(float(1), light, T(7).mul(this.sunOnScreen));
      a.assign(vec4(wrapped, seed));
      b.assign(vec4(lightOut, front.mul(T(2)), count, hue));
    })().compute(n, [256]);

    // render: fine motes over the volume (the volume carries the bulk of the light)
    const pos = A.toAttribute();
    const st = B.toAttribute();
    const size = pos.w.pow(3).mul(0.2).add(0.06);
    const sprite = spriteVertex({ center: pos.xyz, radius: size, minPx: 0.7, maxPx: 14, edgeFade: true });
    const hgt = clamp(pos.y.add(90).div(260), 0, 1);
    const wob = snoiseGrad(pos.xyz.mul(0.012)).w.mul(0.25).add(st.w.mul(0.2));
    const halpha = vec3(0.95, 0.3, 0.3);
    const oiii = vec3(0.3, 0.82, 0.88);
    const sii = vec3(1.0, 0.6, 0.3);
    const emit = mix(mix(halpha, sii, smoothstep(0.25, 0.55, hgt.add(wob))), oiii, smoothstep(0.5, 0.85, hgt.add(wob)));
    const dens = clamp(st.z.div(60), 0, 1).mul(T(25));
    const hot = mix(emit, vec3(1, 0.96, 0.9), dens.mul(0.85));
    // lit grains shine, shadowed ones (#7) almost vanish: the shafts read
    const lit = mix(float(0.05), float(1), st.x);
    const bright = lit.mul(float(0.022).add(dens.mul(0.22))).add(st.y.mul(0.25));
    const col = varying(hot.mul(bright).mul(this.level));
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = col;
    mat.opacityNode = glowShape(sprite, 0.2).mul(sprite.energy);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    this.group.add(particleMesh(n, mat, 4));
  }

  /* -------------------------------------------------------------------- */
  /* light source and jets                                                */
  /* -------------------------------------------------------------------- */

  private buildCluster() {
    const i = instanceIndex;
    const center = this.clusterPos.add(vec3(gauss(i, 0), gauss(i, 2), gauss(i, 4)).mul(9));
    const big = rnd(i, 6).pow(6);
    const sprite = spriteVertex({ center, radius: big.mul(1.6).add(0.4), minPx: 1.2, maxPx: 400, anamorphic: smoothstep(0.5, 0.95, big).mul(7) });
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = varying(mix(vec3(0.7, 0.85, 1.0), vec3(1, 1, 1), rnd(i, 7)).mul(big.mul(30).add(4)).mul(this.level));
    mat.opacityNode = flareShape(sprite).mul(sprite.energy);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    this.group.add(particleMesh(60, mat, 0));

    // the cluster's halo (drawn before the nebula, which dims it where gas lies in front)
    const hs = spriteVertex({ center: this.clusterPos, radius: float(70), minPx: 6, maxPx: 2400 });
    const hm = new MeshBasicNodeMaterial();
    hm.vertexNode = hs.clip;
    const r = length(hs.local);
    hm.colorNode = vec3(0.75, 0.88, 1.0).mul(exp(r.mul(-6)).mul(0.7).add(exp(r.mul(-2.2)).mul(0.08))).mul(this.level);
    hm.transparent = true;
    hm.depthWrite = false;
    hm.blending = AdditiveBlending;
    this.group.add(particleMesh(1, hm, 0));
  }

  private buildJets() {
    const stars = [
      { at: PILLARS[0].b.clone().add(new Vector3(0, PILLARS[0].rb * 0.4, 0)), axis: new Vector3(0.82, 0.25, 0.5).normalize(), len: 70 },
      { at: PILLARS[1].b.clone().add(new Vector3(0, PILLARS[1].rb * 0.4, 0)), axis: new Vector3(-0.4, 0.3, 0.86).normalize(), len: 52 },
    ];
    const perStar = 26000;
    const i = instanceIndex;
    const star = i.div(uint(perStar));
    const pick = (a: Vector3, b: Vector3) => select(star.equal(uint(0)), v3(a), v3(b));
    const at = pick(stars[0].at, stars[1].at);
    const axis = pick(stars[0].axis, stars[1].axis);
    const len = select(star.equal(uint(0)), float(stars[0].len), float(stars[1].len));
    // jet frame
    const side = normalize(cross(select(abs(axis.y).lessThan(0.9), vec3(0, 1, 0), vec3(1, 0, 0)), axis));
    const up = cross(axis, side);
    const dirSign = select(rnd(i, 0).lessThan(0.5), float(1), float(-1));
    const s = rnd(i, 1).add(G.time.mul(0.11)).fract().pow(1.4).mul(len); // streams outward
    const strand = floor(rnd(i, 2).mul(3)).mul((Math.PI * 2) / 3);
    const r = s.mul(0.075).add(0.35).mul(rnd(i, 3).mul(0.5).add(0.75));
    // #13 twist: the rotation angle grows with distance along the jet
    const twist = s.mul(0.11).add(G.time.mul(0.9)).mul(T(13));
    const ang = strand.add(gauss(i, 4).mul(0.22)).add(twist);
    const off = side.mul(cos(ang).mul(r)).add(up.mul(sin(ang).mul(r)));
    const pos = at.add(axis.mul(s.mul(dirSign))).add(off);
    const fade = smoothstep(0, 2, s).mul(float(1).sub(smoothstep(len.mul(0.7), len, s)));
    // knots of shocked gas along the jet (Herbig–Haro objects)
    const knots = smoothstep(0.6, 1.0, sin(s.mul(0.55).sub(G.time.mul(1.4))).mul(0.5).add(0.5)).mul(1.6).add(0.5);
    const sprite = spriteVertex({ center: pos, radius: float(0.2), minPx: 0.8, maxPx: 30 });
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = varying(mix(vec3(0.45, 0.7, 1.0), vec3(1.0, 0.42, 0.62), s.div(len)).mul(fade).mul(knots).mul(0.26).mul(this.level));
    mat.opacityNode = glowShape(sprite, 0.2).mul(sprite.energy);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    this.group.add(particleMesh(perStar * 2, mat, 5));

    // protostar cores
    for (const st of stars) {
      const sp = spriteVertex({ center: v3(st.at), radius: float(1.6), minPx: 2, maxPx: 300, anamorphic: float(3) });
      const m = new MeshBasicNodeMaterial();
      m.vertexNode = sp.clip;
      m.colorNode = vec3(1.0, 0.92, 0.85).mul(7).mul(this.level);
      m.opacityNode = flareShape(sp).mul(sp.energy);
      m.transparent = true;
      m.depthWrite = false;
      m.blending = AdditiveBlending;
      this.group.add(particleMesh(1, m, 6));
    }

    // #3 heat shimmer: refraction sprites riding the jets near the stars
    const nShim = 160;
    const j = instanceIndex;
    const sj = j.div(uint(nShim / 2));
    const atS = select(sj.equal(uint(0)), v3(stars[0].at), v3(stars[1].at));
    const axS = select(sj.equal(uint(0)), v3(stars[0].axis), v3(stars[1].axis));
    const sS = rnd(j, 1).add(G.time.mul(0.05)).fract().mul(14);
    const pS = atS.add(axS.mul(sS.mul(select(rnd(j, 0).lessThan(0.5), float(1), float(-1))))).add(vec3(gauss(j, 2), gauss(j, 4), gauss(j, 6)).mul(1.2));
    const spS = spriteVertex({ center: pS, radius: rnd(j, 8).mul(2.5).add(2), minPx: 4, maxPx: 260 });
    const sm = new MeshBasicNodeMaterial();
    sm.vertexNode = spS.clip;
    sm.colorNode = Fn(() => {
      const w = snoiseGrad(vec3(spS.local.mul(1.6), G.clock.mul(2.4))).xy;
      const offset = w.mul(spS.rpx).div(G.screen).mul(0.12).mul(T(3));
      return viewportSharedTexture(screenUV.add(offset)).rgb;
    })();
    sm.opacityNode = glowShape(spS, 0).mul(0.85);
    sm.transparent = true;
    sm.depthWrite = false;
    sm.blending = NormalBlending;
    this.group.add(particleMesh(nShim, sm, 30));
  }

  /* -------------------------------------------------------------------- */

  enter(ctx: Ctx) {
    ensureNoise(ctx.renderer);
    if (!this.lightBaked) {
      ctx.renderer.compute(this.lightBake as never);
      this.lightBaked = true;
    }
    this.needsInit = true;
    this.ensureInit(ctx);
  }

  private ensureInit(ctx: Ctx) {
    if (!this.needsInit) return;
    this.needsInit = false;
    ctx.renderer.compute(this.gasInit as never);
    ctx.renderer.compute(this.gridClear as never);
    ctx.renderer.compute(this.gridCount as never);
  }

  update(ctx: Ctx, _t: number) {
    this.level.value = 1;
    // where the cluster is on screen, for the shadow march (#7)
    const cam = ctx.camera;
    this.tmp.copy(CLUSTER).project(cam);
    const behind = this.tmp.z > 1;
    this.sunUv.value.set(this.tmp.x * 0.5 + 0.5, 0.5 - this.tmp.y * 0.5);
    this.sunOnScreen.value = behind ? 0 : 1;
  }

  simulate(ctx: Ctx) {
    this.ensureInit(ctx);
    ctx.renderer.compute(this.gasSim as never);
    ctx.renderer.compute(this.gridClear as never);
    ctx.renderer.compute(this.gridCount as never);
  }

  look(t: number, out: Look) {
    out.bloom = [0.7, 0.6, 0.55];
    out.sky = 0.35;
    out.near = 0.1;
    out.far = 6000;
    out.focus = 80;
    out.aperture = 0;
    out.warp = ramp(t, 24.5, 26) * 0.5;
    out.exposure = 1.05;
    out.flash = (1 - ramp(t, 0, 1.4)) * 1.0;
    out.flashColor = [0.8, 0.95, 1.0];
    out.rays = 0.5;
    out.raysAt = [CLUSTER.x, CLUSTER.y, CLUSTER.z];
    out.raysColor = [0.75, 0.88, 1.0];
    out.grade = { lift: [0.004, 0.006, 0.012], gamma: [1, 1, 1.02], gain: [1.02, 1, 0.98], saturation: 1.08 };
  }
}
