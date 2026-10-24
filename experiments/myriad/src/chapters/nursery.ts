/**
 * IV — 星の揺籃. Pillars of dust in a stellar nursery, lit from above.
 *
 * The gas is a compute-simulated cloud moved by analytic curl noise (#15).
 * Each grain looks at last frame's depth buffer once per frame:
 * #7  it marches toward the light on screen; a pillar in front means shadow,
 *     so the pillars cast shafts through the cloud;
 * #2  if a pillar surface sits at its own depth it is on an ionisation front
 *     and lights up instead of being faded away.
 * #25 grains are counted into a 3D grid with atomicAdd; crowded cells glow
 *     white-hot.
 * #13 the protostars' jets are twisted by a rotation that grows with height;
 * #3  heat shimmer bends the frame behind the jets.
 */
import { AdditiveBlending, CapsuleGeometry, Mesh, MeshBasicNodeMaterial, NormalBlending, Vector2, Vector3 } from "three/webgpu";
import type { DepthTexture } from "three/webgpu";
import {
  Fn,
  If,
  abs,
  atomicAdd,
  atomicLoad,
  atomicStore,
  clamp,
  cos,
  cross,
  dot,
  float,
  floor,
  instanceIndex,
  instancedArray,
  ivec2,
  length,
  max,
  min,
  mix,
  cameraPosition,
  normalLocal,
  normalWorld,
  normalize,
  positionWorld,
  perspectiveDepthToViewZ,
  positionLocal,
  pow,
  screenUV,
  select,
  sin,
  smoothstep,
  textureLoad,
  uint,
  uniform,
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
import { curlNoise, fbm2, snoiseGrad } from "../tsl/noise";
import { cosPalette } from "../tsl/palette";
import { flareShape, glowShape, spriteVertex } from "../tsl/sprite";

interface Pillar {
  a: Vector3;
  b: Vector3;
  ra: number;
  rb: number;
}

const PILLARS: Pillar[] = [
  { a: new Vector3(-62, -70, 0), b: new Vector3(-36, 96, -12), ra: 24, rb: 12 },
  { a: new Vector3(8, -70, 22), b: new Vector3(16, 58, 8), ra: 19, rb: 9.5 },
  { a: new Vector3(72, -70, -12), b: new Vector3(58, 26, -22), ra: 15, rb: 7.5 },
];
const CLUSTER = new Vector3(18, 205, -95);
const BOX_MIN = new Vector3(-190, -90, -95);
const BOX_SIZE = new Vector3(380, 270, 200);
const GX = 64;
const GY = 48;
const GZ = 44;

export class NurseryChapter extends Chapter {
  readonly id = "nursery";
  readonly numeral = "IV";
  readonly name = "星の揺籃";
  readonly caption = "塵の柱の先で、星が生まれようとしている。";
  readonly duration = 26;
  readonly techniques = [15, 7, 2, 25, 13, 3, 4, 20, 12, 31];

  private readonly level = uniform(1);
  private readonly sunUv = uniform(new Vector2(0.5, 0));
  private readonly sunOnScreen = uniform(1);
  private readonly clusterPos = uniform(CLUSTER.clone());
  private depthTex!: DepthTexture;
  private nGas = 0;
  private gasInit: unknown;
  private gasSim: unknown;
  private gridClear: unknown;
  private gridCount: unknown;
  private needsInit = true;
  private tmp = new Vector3();

  constructor() {
    super();
    this.fadeIn = 0;
  }

  build(ctx: Ctx) {
    this.nGas = Math.round(1_100_000 * ctx.q);
    this.depthTex = ctx.post.scenePass.getTexture("depth") as DepthTexture;
    for (const p of PILLARS) this.group.add(this.buildPillar(p));
    this.buildBackdrop(Math.round(12000 * Math.max(0.5, ctx.q)));
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

  /** Signed distance to the pillars (tapered capsules), analytic. */
  private pillarDist(p: N): N {
    let d: N = float(1e5);
    for (const pl of PILLARS) {
      const a = vec3(pl.a.x, pl.a.y, pl.a.z);
      const ba = vec3(pl.b.x - pl.a.x, pl.b.y - pl.a.y, pl.b.z - pl.a.z);
      const h = clamp(dot(p.sub(a), ba).div(dot(ba, ba)), 0, 1);
      const r = mix(float(pl.ra), float(pl.rb), h);
      d = min(d, length(p.sub(a).sub(ba.mul(h))).sub(r));
    }
    return d;
  }

  private buildPillar(pl: Pillar): Mesh {
    const axis = pl.b.clone().sub(pl.a);
    const len = axis.length();
    const geo = new CapsuleGeometry(1, len, 24, 160, 220);
    const mat = new MeshBasicNodeMaterial();
    const toCluster = CLUSTER.clone().sub(pl.b).normalize();
    // taper along the height (round caps stay round) and roughen with
    // low-frequency fractal noise along the normal
    const half = len / 2;
    mat.positionNode = Fn(() => {
      const y = positionLocal.y;
      const h = clamp(y.div(len).add(0.5), 0, 1);
      const r = mix(float(pl.ra), float(pl.rb), h);
      const capY = select(abs(y).greaterThan(half), y.sign().mul(abs(y).sub(half).mul(r).add(half)), y);
      const base = vec3(positionLocal.x.mul(r), capY, positionLocal.z.mul(r));
      const q = base.mul(0.028).add(pl.ra);
      const bump = fbm2(q).mul(r.mul(0.38)).add(fbm2(q.mul(2.7)).mul(r.mul(0.1)));
      return base.add(normalLocal.mul(bump));
    })();
    const tc = vec3(toCluster.x, toCluster.y, toCluster.z);
    mat.colorNode = Fn(() => {
      const nW = normalize(normalWorld);
      const q = positionWorld.mul(0.05);
      // a gentle texture on the lighting only; the silhouette uses the smooth
      // normal so the rim never breaks into blotches
      const nn = normalize(nW.add(snoiseGrad(q).xyz.mul(0.1)));
      const lit = smoothstep(0.05, 0.8, dot(nn, tc));
      const view = normalize(cameraPosition.sub(positionWorld));
      const edge = pow(float(1).sub(abs(dot(nW, view))), 3);
      const fil = fbm2(q.mul(2.3)).mul(0.5).add(0.5);
      const dust = vec3(0.022, 0.013, 0.01).mul(fil.mul(0.8).add(0.5));
      const front = cosPalette(fil, [0.85, 0.5, 0.3], [0.15, 0.15, 0.12], [1, 1, 1], [0.0, 0.1, 0.2]);
      const glow = front.mul(lit.mul(edge.mul(1.7).add(0.05)));
      // light leaking through the thin edges on the shadow side
      const leak = vec3(0.8, 0.3, 0.2).mul(edge.mul(float(1).sub(lit))).mul(0.1);
      return dust.add(glow).add(leak).mul(this.level);
    })();
    const mesh = new Mesh(geo, mat);
    mesh.position.copy(pl.a).add(pl.b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), axis.normalize());
    return mesh;
  }

  /* -------------------------------------------------------------------- */
  /* gas                                                                  */
  /* -------------------------------------------------------------------- */

  private buildGas() {
    const n = this.nGas;
    const A = instancedArray(n, "vec4"); // position, size seed
    const B = instancedArray(n, "vec4"); // light (#7), front (#2), density (#25), hue
    const cells = GX * GY * GZ;
    const grid = instancedArray(cells, "uint").toAtomic();
    const boxMin = vec3(BOX_MIN.x, BOX_MIN.y, BOX_MIN.z);
    const boxSize = vec3(BOX_SIZE.x, BOX_SIZE.y, BOX_SIZE.z);
    const cellOf = (p: N): N => {
      const g = clamp(p.sub(boxMin).div(boxSize), 0, 0.9999).mul(vec3(GX, GY, GZ));
      const c = floor(g);
      return uint(c.x).add(uint(c.y).mul(uint(GX))).add(uint(c.z).mul(uint(GX * GY)));
    };
    const randomInBox = (i: N, k: number): N =>
      boxMin.add(vec3(rnd(i, k), rnd(i, k + 1), rnd(i, k + 2)).mul(boxSize));

    this.gasInit = Fn(() => {
      const i = instanceIndex;
      // denser near the pillars: pull some samples toward the closest surface
      const p = randomInBox(i, 0).toVar();
      const d = this.pillarDist(p);
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
      const d = this.pillarDist(p).toVar();
      const wind = toCluster(p).mul(-1.4).mul(smoothstep(30, 0, d).mul(2).add(0.3));
      const v = swirl.add(wind).toVar();
      const pNext = p.add(v.mul(G.dt)).toVar();
      // stay outside the pillars
      const dn = this.pillarDist(pNext);
      const eps = 0.5;
      const grad = normalize(vec3(
        this.pillarDist(pNext.add(vec3(eps, 0, 0))).sub(dn),
        this.pillarDist(pNext.add(vec3(0, eps, 0))).sub(dn),
        this.pillarDist(pNext.add(vec3(0, 0, eps))).sub(dn),
      ).add(vec3(0, 1e-5, 0)));
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
      const on = clip.w.greaterThan(0.5)
        .and(uvP.x.greaterThan(0.001)).and(uvP.x.lessThan(0.999))
        .and(uvP.y.greaterThan(0.001)).and(uvP.y.lessThan(0.999));
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

    // render
    const pos = A.toAttribute();
    const st = B.toAttribute();
    const size = pos.w.pow(3).mul(0.4).add(0.12);
    const sprite = spriteVertex({ center: pos.xyz, radius: size, minPx: 0.75, maxPx: 26, edgeFade: true });
    // emission lines follow the height like the nebula wall behind:
    // O III teal near the cluster, H-alpha red and S II amber lower down
    const hgt = clamp(pos.y.add(90).div(260), 0, 1);
    const wob = snoiseGrad(pos.xyz.mul(0.012)).w.mul(0.25).add(st.w.mul(0.2));
    const halpha = vec3(0.95, 0.3, 0.3);
    const oiii = vec3(0.3, 0.82, 0.88);
    const sii = vec3(1.0, 0.6, 0.3);
    const emit = mix(mix(halpha, sii, smoothstep(0.25, 0.55, hgt.add(wob))), oiii, smoothstep(0.5, 0.85, hgt.add(wob)));
    const dens = clamp(st.z.div(60), 0, 1).mul(T(25));
    const hot = mix(emit, vec3(1, 0.96, 0.9), dens.mul(0.85));
    // lit grains shine, shadowed ones (#7) almost vanish: the shafts read
    const lit = mix(float(0.06), float(1), st.x);
    const bright = lit.mul(float(0.09).add(dens.mul(0.5))).add(st.y.mul(0.35));
    const col = varying(hot.mul(bright).mul(this.level));
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = col;
    mat.opacityNode = glowShape(sprite, 0).mul(sprite.energy);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    this.group.add(particleMesh(n, mat, 4));
  }

  /** The glowing wall of the nebula behind the pillars: big, faint sprites. */
  private buildBackdrop(count: number) {
    const i = instanceIndex;
    const p = vec3(mix(float(-340), float(340), rnd(i, 0)), mix(float(-130), float(310), rnd(i, 1)), mix(float(-320), float(-95), rnd(i, 2))).toVar();
    const f = fbm2(p.mul(0.0055)).mul(0.5).add(0.5);
    const ridge = float(1).sub(abs(fbm2(p.mul(0.011).add(5.0))));
    const w = smoothstep(0.42, 0.82, f).mul(ridge.mul(0.6).add(0.4));
    const hgt = clamp(p.y.add(130).div(440), 0, 1);
    const low = vec3(0.95, 0.32, 0.2);
    const mid = vec3(0.85, 0.55, 0.35);
    const high = vec3(0.22, 0.72, 0.86);
    const col = mix(mix(low, mid, smoothstep(0.0, 0.45, hgt)), high, smoothstep(0.4, 0.9, hgt));
    const sprite = spriteVertex({ center: p, radius: mix(float(9), float(24), rnd(i, 3)), minPx: 2, maxPx: 90 });
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = varying(col.mul(w).mul(0.06).mul(this.level));
    mat.opacityNode = glowShape(sprite, 0).mul(sprite.energy);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    this.group.add(particleMesh(count, mat, 2));
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
    this.group.add(particleMesh(60, mat, 3));
  }

  private buildJets() {
    const stars = [
      { at: PILLARS[0].b.clone().add(new Vector3(0, PILLARS[0].rb * 0.4, 0)), axis: new Vector3(0.82, 0.25, 0.5).normalize(), len: 70 },
      { at: PILLARS[1].b.clone().add(new Vector3(0, PILLARS[1].rb * 0.4, 0)), axis: new Vector3(-0.4, 0.3, 0.86).normalize(), len: 52 },
    ];
    const perStar = 26000;
    const i = instanceIndex;
    const star = i.div(uint(perStar));
    const pick = (a: Vector3, b: Vector3) => select(star.equal(uint(0)), vec3(a.x, a.y, a.z), vec3(b.x, b.y, b.z));
    const at = pick(stars[0].at, stars[1].at);
    const axis = pick(stars[0].axis, stars[1].axis);
    const len = select(star.equal(uint(0)), float(stars[0].len), float(stars[1].len));
    // jet frame
    const side = normalize(cross(select(abs(axis.y).lessThan(0.9), vec3(0, 1, 0), vec3(1, 0, 0)), axis));
    const up = cross(axis, side);
    const dirSign = select(rnd(i, 0).lessThan(0.5), float(1), float(-1));
    const s = rnd(i, 1).add(G.time.mul(0.11)).fract().pow(1.4).mul(len); // streams outward
    const strand = floor(rnd(i, 2).mul(3)).mul(Math.PI * 2 / 3);
    const r = s.mul(0.075).add(0.35).mul(rnd(i, 3).mul(0.5).add(0.75));
    // #13 twist: the rotation angle grows with distance along the jet
    const twist = s.mul(0.11).add(G.time.mul(0.9)).mul(T(13));
    const ang = strand.add(gauss(i, 4).mul(0.22)).add(twist);
    const off = side.mul(cos(ang).mul(r)).add(up.mul(sin(ang).mul(r)));
    const pos = at.add(axis.mul(s.mul(dirSign))).add(off);
    const fade = smoothstep(0, 2, s).mul(float(1).sub(smoothstep(len.mul(0.7), len, s)));
    const sprite = spriteVertex({ center: pos, radius: float(0.22), minPx: 0.8, maxPx: 30 });
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = varying(mix(vec3(0.45, 0.7, 1.0), vec3(0.9, 0.45, 0.85), s.div(len)).mul(fade).mul(0.32).mul(this.level));
    mat.opacityNode = glowShape(sprite, 0.2).mul(sprite.energy);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    this.group.add(particleMesh(perStar * 2, mat, 5));

    // protostar cores
    for (const st of stars) {
      const sp = spriteVertex({ center: vec3(st.at.x, st.at.y, st.at.z), radius: float(1.6), minPx: 2, maxPx: 300, anamorphic: float(3) });
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
    const atS = select(sj.equal(uint(0)), vec3(stars[0].at.x, stars[0].at.y, stars[0].at.z), vec3(stars[1].at.x, stars[1].at.y, stars[1].at.z));
    const axS = select(sj.equal(uint(0)), vec3(stars[0].axis.x, stars[0].axis.y, stars[0].axis.z), vec3(stars[1].axis.x, stars[1].axis.y, stars[1].axis.z));
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
    out.bloom = [0.9, 0.6, 0.4];
    out.sky = 0.35;
    out.near = 0.1;
    out.far = 6000;
    out.focus = 80;
    out.aperture = 0;
    out.warp = ramp(t, 24.5, 26) * 0.5;
    out.exposure = 1.05;
    out.flash = (1 - ramp(t, 0, 1.4)) * 1.0;
    out.flashColor = [0.8, 0.95, 1.0];
  }
}

