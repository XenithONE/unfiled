/**
 * II — 砕ける月. The moon of the ringed giant breaks apart.
 *
 * Every piece is stateless: position = p0 + v·(1 − e^(−kτ))/k, so the whole
 * catastrophe can be scrubbed, and an earlier moment is one more evaluation:
 * #44 the pieces are real shards — convex rocks cut by random planes, flat
 *     fracture faces and sharp edges — drawn instanced; the vertex stage of
 *     each copy evaluates its own flight and tumble, so nine thousand solid
 *     rocks catch a real sun, cast real shadows on each other and hold their
 *     glowing cracks (#24, #20 cooling black-body) in their own frame.
 * #8  stateless afterimage — chunk trails drawn from p(τ − Δ) to p(τ)
 * #9  sparks stretched along their analytic velocity
 * #5  pieces drifting through the camera dissolve by dithering
 * #7  screen-space shadow: the dust marches toward the sun through the depth
 *     buffer, so the chunks cut shafts of shadow into the cloud
 * #2  (ring) grains touching a chunk surface light up instead of fading
 */
import {
  AdditiveBlending,
  AmbientLight,
  DirectionalLight,
  InstancedBufferGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  Vector2,
  Vector3,
} from "three/webgpu";
import type { BufferGeometry } from "three/webgpu";
import {
  Fn,
  cameraFar,
  cameraNear,
  cameraViewMatrix,
  clamp,
  cos,
  cross,
  dot,
  exp,
  float,
  instanceIndex,
  length,
  max,
  mix,
  normalLocal,
  normalize,
  perspectiveDepthToViewZ,
  positionGeometry,
  pow,
  screenSize,
  screenUV,
  select,
  sin,
  smoothstep,
  uint,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
  viewportDepthTexture,
} from "../tsl/t";
import type { Ctx, Look } from "../engine/chapter";
import { Chapter, pulse, ramp } from "../engine/chapter";
import { particleMesh } from "../engine/quad";
import { Track } from "../engine/rig";
import { shardGeometry } from "../engine/rock";
import type { N } from "../tsl/common";
import { G, T, gauss, rnd } from "../tsl/common";
import { impostorSphere, voronoiCracks } from "../tsl/impostor";
import { snoiseGrad } from "../tsl/noise";
import { blackbody, emberColor } from "../tsl/palette";
import { ditherKeep, glowShape, spriteVertex } from "../tsl/sprite";
import type { PlanetSystem } from "./planet";
import { MOON_POS, MOON_R, SUN } from "./planet";

const SHATTER = 3.0;

/** Random unit vector for particle i from three normal streams. */
function dirOf(i: N, k: number): N {
  return normalize(vec3(gauss(i, k), gauss(i, k + 2), gauss(i, k + 4)).add(vec3(0, 0, 1e-5)));
}

/** Rotates p about the unit axis k by angle a (Rodrigues). */
const rot = (p: N, k: N, a: N): N => p.mul(cos(a)).add(cross(k, p).mul(sin(a))).add(k.mul(dot(k, p).mul(float(1).sub(cos(a)))));

export class Debris {
  /** Seconds since the shatter (negative before). */
  readonly tau = uniform(-1);
  readonly level = uniform(1);
  readonly sunDir2D = uniform(new Vector2(1, 0));
  readonly center = uniform(MOON_POS.clone());
  readonly chunks: Mesh[];
  readonly trails: Mesh;
  readonly sparks: Mesh;
  readonly dust: Mesh;
  readonly core: Mesh;
  /** A real sun for the shards, with a shadow map that follows the cloud. */
  readonly sun: DirectionalLight;
  readonly fill: DirectionalLight;
  readonly ambient: AmbientLight;
  /** Ids below this are the large pieces. */
  private readonly nBig: number;
  private sys: PlanetSystem;

  constructor(ctx: Ctx, sys: PlanetSystem) {
    this.sys = sys;
    const nChunks = Math.round(9000 * Math.max(0.4, ctx.q));
    this.nBig = Math.round(nChunks * 0.14);
    this.chunks = this.buildChunks(nChunks);
    this.trails = this.buildTrails(Math.round(nChunks * 0.3));
    this.sparks = this.buildSparks(Math.round(130000 * ctx.q));
    this.dust = this.buildDust(Math.round(90000 * Math.max(0.3, ctx.q)));
    this.core = this.buildCore();

    const sun = new DirectionalLight(0xfff0e0, 3.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(ctx.q >= 0.6 ? 4096 : 2048, ctx.q >= 0.6 ? 4096 : 2048);
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.02;
    sun.position.copy(MOON_POS).addScaledVector(SUN, 150);
    sun.target.position.copy(MOON_POS);
    this.sun = sun;
    // the giant's warm light from the other side, and a little sky
    this.fill = new DirectionalLight(0xffc89a, 0.22);
    this.fill.position.copy(MOON_POS).multiplyScalar(0.2);
    this.fill.target.position.copy(MOON_POS);
    this.ambient = new AmbientLight(0x6a7896, 0.07);
    sys.group.add(...this.chunks, this.trails, this.sparks, this.dust, this.core, sun, sun.target, this.fill, this.fill.target, this.ambient);
    this.setVisible(false);
  }

  setVisible(v: boolean) {
    for (const c of this.chunks) c.visible = v;
    this.trails.visible = v;
    this.sparks.visible = v;
    this.dust.visible = v;
    this.core.visible = v;
    this.sun.visible = v;
    this.fill.visible = v;
    this.ambient.visible = v;
  }

  /** Keeps the shadow map round the spreading cloud. */
  updateShadow(tau: number) {
    const half = Math.min(170, 26 + Math.max(0, tau) * 6.5);
    const sc = this.sun.shadow.camera;
    sc.left = -half;
    sc.right = half;
    sc.top = half;
    sc.bottom = -half;
    sc.near = 1;
    sc.far = 150 + half * 2;
    sc.updateProjectionMatrix();
  }

  /** Chunk i's state at time τ: [position, radius, speed]. */
  private chunkAt(i: N, tau: N) {
    const dir = dirOf(i, 0);
    const big = i.lessThan(uint(this.nBig));
    const u = select(big, rnd(i, 6).mul(0.2).add(0.8), rnd(i, 6).mul(0.8));
    const radius = u.pow(6).mul(1.45).add(0.05).toVar();
    const p0 = this.center.add(dir.mul(rnd(i, 7).pow(0.33).mul(MOON_R * 0.88)));
    const speed = mix(float(14), float(2.6), u.pow(0.5)).mul(rnd(i, 8).mul(0.5).add(0.75));
    const v = dir.mul(speed).add(dirOf(i, 9).mul(0.6));
    const k = 0.08;
    const s = float(1).sub(exp(tau.mul(-k))).div(k);
    return { pos: p0.add(v.mul(s)), radius, speed };
  }

  /** Large pieces in three shapes, the rest in two coarser ones. */
  private buildChunks(count: number): Mesh[] {
    const nb = this.nBig;
    const out: Mesh[] = [];
    const per = Math.ceil(nb / 3);
    for (let s = 0; s < 3; s++) {
      const start = s * per;
      const n = Math.min(per, nb - start);
      if (n > 0) out.push(this.chunkMesh(shardGeometry(11 + s, 2, 10), start, n));
    }
    const ns = count - nb;
    const half = Math.ceil(ns / 2);
    out.push(this.chunkMesh(shardGeometry(21, 1, 8), nb, half));
    out.push(this.chunkMesh(shardGeometry(23, 1, 7), nb + half, ns - half));
    return out;
  }

  /** #44 one shard shape drawn `count` times, each copy placed by its own vertex stage. */
  private chunkMesh(src: BufferGeometry, start: number, count: number): Mesh {
    const geo = new InstancedBufferGeometry();
    geo.setAttribute("position", src.getAttribute("position"));
    geo.setAttribute("normal", src.getAttribute("normal"));
    geo.instanceCount = count;
    const id = instanceIndex.add(uint(start));
    const tau = max(this.tau, 0);
    const c = this.chunkAt(id, tau);
    // each piece tumbles about its own axis, the small ones faster
    const axis = dirOf(id, 20);
    const ang = rnd(id, 26).mul(6.283).add(tau.mul(rnd(id, 27).sub(0.5).mul(2.4)).div(c.radius.add(0.35)));
    const on = select(this.tau.greaterThan(0), float(1), float(0));
    const mat = new MeshStandardNodeMaterial();
    mat.positionNode = rot(positionGeometry.mul(c.radius.mul(on)), axis, ang).add(c.pos);
    const nW = varying(rot(normalLocal, axis, ang));
    mat.normalNode = normalize(cameraViewMatrix.mul(vec4(nW, 0)).xyz);
    // the rock in its own frame: dark basalt with lighter, dusty old surface patches
    const pG = varying(positionGeometry);
    const seed = varying(rnd(id, 10).mul(60));
    const tone = snoiseGrad(pG.mul(2.6).add(seed)).w.mul(0.5).add(0.5);
    mat.colorNode = mix(vec3(0.11, 0.1, 0.095), vec3(0.3, 0.28, 0.26), tone.mul(0.7).add(0.15)).mul(this.level);
    mat.roughnessNode = float(0.92);
    mat.metalnessNode = float(0);
    // #24 cracks on every piece, #20 cooling from white to dull red
    // (a few seams per piece, the small ones cool first; half the pieces broke clean)
    const heat = varying(clamp(tau.div(c.radius.mul(5).add(2.2)).add(0.15), 0, 1));
    const seamy = varying(select(rnd(id, 28).lessThan(0.55), float(1), float(0.15)));
    const cracks = voronoiCracks(pG.mul(1.15).add(seed), float(0.045));
    mat.emissiveNode = blackbody(heat).mul(cracks).mul(seamy).mul(1.3).mul(this.level);
    // #5 pieces drifting through the camera dissolve by dithering
    const dist = length(c.pos.sub(G.camPos));
    const near = varying(smoothstep(c.radius.mul(1.6).add(0.3), c.radius.mul(2.6).add(1.0), dist));
    mat.maskNode = ditherKeep(near);
    const mesh = new Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    return mesh;
  }

  /** #8 trails: the same function evaluated Δ seconds earlier is the tail. */
  private buildTrails(count: number): Mesh {
    const i = instanceIndex;
    const tau = max(this.tau, 0);
    const lag = float(0.9);
    const head = this.chunkAt(i, tau);
    const tail = this.chunkAt(i, max(tau.sub(lag), 0)).pos;
    const heat = clamp(tau.div(head.radius.mul(9).add(5)), 0, 1);
    const sprite = spriteVertex({
      center: head.pos,
      radius: head.radius.mul(0.55),
      tail: mix(head.pos, tail, T(8)),
      streakKeep: 1,
      minPx: 0.8,
      maxPx: 400,
      visible: select(this.tau.greaterThan(0.05), float(1), float(0)),
    });
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    const along = clamp(sprite.local.x.div(sprite.halfLen.add(1)).mul(0.5).add(0.5), 0, 1);
    mat.colorNode = varying(emberColor(heat.mul(0.6).add(0.3)).mul(0.22).mul(this.level));
    mat.opacityNode = glowShape(sprite, 0).mul(sprite.energy).mul(along.pow(1.5));
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    return particleMesh(count, mat, 6);
  }

  private buildSparks(count: number): Mesh {
    const i = instanceIndex;
    const birth = rnd(i, 0).pow(2).mul(2.6);
    const tl = max(this.tau.sub(birth), 0).toVar();
    const life = rnd(i, 1).mul(3.5).add(1.4);
    const age = tl.div(life).toVar();
    const dir = dirOf(i, 2);
    const p0 = this.center.add(dir.mul(4.4));
    const v = dir.mul(rnd(i, 8).pow(0.5).mul(24).add(5));
    const k = 0.55;
    const pos = p0.add(v.mul(float(1).sub(exp(tl.mul(-k))).div(k)));
    const vel = v.mul(exp(tl.mul(-k)));
    const alive = this.tau.greaterThan(birth).and(age.lessThan(1));
    const sprite = spriteVertex({
      center: pos,
      radius: rnd(i, 9).pow(2).mul(0.045).add(0.014),
      tail: pos.sub(vel.mul(0.07).mul(T(9))),
      streakKeep: 0.7,
      minPx: 0.7,
      maxPx: 50,
      visible: select(alive, float(1), float(0)),
    });
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = varying(emberColor(age.mul(0.85).add(0.08)).mul(float(1).sub(smoothstep(0.7, 1, age))).mul(this.level).mul(0.55));
    mat.opacityNode = glowShape(sprite, 0.4).mul(sprite.energy);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    return particleMesh(count, mat, 7);
  }

  /** Crust dust: sunlit, shadowed by the chunks through the depth buffer (#7). */
  private buildDust(count: number): Mesh {
    const i = instanceIndex;
    const tau = max(this.tau, 0);
    const dir = dirOf(i, 0);
    const p0 = this.center.add(dir.mul(rnd(i, 6).pow(0.25).mul(MOON_R)));
    const v = dir.mul(rnd(i, 7).mul(4.2).add(0.6));
    const k = 0.12;
    const drift = snoiseGrad(p0.mul(0.15).add(vec3(0, tau.mul(0.04), 0))).xyz.mul(tau.mul(0.35));
    const pos = p0.add(v.mul(float(1).sub(exp(tau.mul(-k))).div(k))).add(drift).toVar();
    const sprite = spriteVertex({
      center: pos,
      radius: rnd(i, 8).mul(0.3).add(0.12),
      minPx: 1,
      maxPx: 120,
      edgeFade: true,
      visible: select(this.tau.greaterThan(0.02), float(1), float(0)),
    });
    const viewZ = varying(G.viewMatrix.mul(vec4(pos, 1)).z);
    const thin = varying(float(1).sub(smoothstep(4, 22, tau)).mul(0.65).add(0.35));
    // dust scatters forward: brightest when the sun is behind it
    const g = dot(normalize(pos.sub(G.camPos)), this.sys.sun);
    const phase = varying(pow(max(g, 0), 6).mul(3.5).add(0.4));
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = Fn(() => {
      // #7 march toward the sun on screen; anything nearer than us blocks it
      const stepUv = this.sunDir2D.mul(vec2(9, 9)).div(screenSize);
      const shadow = float(0).toVar();
      for (let s = 1; s <= 7; s++) {
        const uvS = screenUV.add(stepUv.mul(s * s * 0.5 + s));
        const d = viewportDepthTexture(uvS).x;
        const sceneZ = perspectiveDepthToViewZ(d, cameraNear, cameraFar);
        const blocked = sceneZ.greaterThan(viewZ.add(0.4)).and(d.lessThan(0.99999));
        shadow.addAssign(select(blocked, float(1 / 7), float(0)));
      }
      const lit = mix(float(1), float(1).sub(shadow.mul(0.92)), T(7));
      const sunTint = vec3(1.0, 0.86, 0.66);
      return sunTint.mul(lit).mul(0.016).mul(phase).mul(thin).mul(this.level);
    })();
    mat.opacityNode = glowShape(sprite, 0).mul(sprite.energy);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    return particleMesh(count, mat, 8);
  }

  /** The exposed molten core: convection cells (#24) in black-body colour (#20). */
  private buildCore(): Mesh {
    const tau = max(this.tau, 0);
    const radius = float(4.2).add(tau.mul(0.06));
    const sprite = spriteVertex({ center: this.center, radius, minPx: 2, maxPx: 2000, visible: select(this.tau.greaterThan(0), float(1), float(0)) });
    const viewC = varying(G.viewMatrix.mul(vec4(this.center, 1)).xyz);
    const imp = impostorSphere(sprite.local, viewC, varying(radius), float(0.6), float(7));
    const cool = varying(clamp(tau.div(26), 0, 1));
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = Fn(() => {
      const n = imp.normal;
      const cells = voronoiCracks(n.mul(3.2).add(vec3(0, tau.mul(0.05), 0)), float(0.22));
      const fine = voronoiCracks(n.mul(8.5).add(vec3(1.7, tau.mul(0.08), 0)), float(0.12));
      const temp = mix(float(0.1), float(0.5), float(1).sub(cells.max(fine.mul(0.6)))).add(cool.mul(0.45));
      const limb = pow(n.z, 0.6);
      return blackbody(temp).mul(limb.mul(0.7).add(0.3)).mul(1.6).mul(this.level);
    })();
    mat.depthNode = imp.depth;
    mat.maskNode = imp.inside;
    return particleMesh(1, mat, 1);
  }
}

export class MoonChapter extends Chapter {
  readonly id = "moon";
  readonly numeral = "II";
  readonly name = "砕ける月";
  readonly caption = "月が割れ、溶けた芯がのぞく。";
  readonly duration = 24;
  readonly techniques = [44, 24, 20, 8, 9, 7, 2, 5, 10, 39, 31];
  private sys: PlanetSystem;
  private debris: Debris | null = null;
  private sunNdc = new Vector3();

  constructor(sys: PlanetSystem) {
    super();
    this.sys = sys;
    this.fadeIn = 0;
    this.fadeOut = 0;
    this.events = [{ t: SHATTER, name: "shatter" }];
  }

  build(ctx: Ctx) {
    this.debris = new Debris(ctx, this.sys);
    const M = MOON_POS;
    this.track = new Track([
      { t: 0, pos: [168, 58, 206], look: [36, -2, -18], fov: 42 },
      { t: 1.4, pos: [160, 50, 150], look: [M.x, M.y, M.z], fov: 32 },
      { t: SHATTER, pos: [135, 24, -30], look: [M.x, M.y, M.z], fov: 40 },
      { t: 6.5, pos: [152, 28, -64], look: [M.x, M.y, M.z], fov: 48 },
      { t: 10.5, pos: [141, 15, -126], look: [M.x - 3, M.y, M.z - 4], fov: 52 },
      { t: 14.5, pos: [112, 5, -140], look: [60, 0, -60], fov: 54 },
      { t: 19, pos: [80, 22, -182], look: [24, 0, -34], fov: 50 },
      { t: 24, pos: [30, 70, -280], look: [10, 0, -20], fov: 46 },
    ]);
  }

  enter(_ctx: Ctx) {
    this.sys.group.visible = true;
    this.debris?.setVisible(true);
    this.sys.contact.value = 1;
  }

  exit(_ctx: Ctx) {
    this.sys.group.visible = false;
    this.debris?.setVisible(false);
    this.sys.moon.visible = true;
    this.sys.contact.value = 0;
  }

  update(ctx: Ctx, t: number) {
    const s = this.sys;
    const d = this.debris!;
    s.orbitT.value = 26 + t;
    s.level.value = 1;
    s.nearLevel.value = 0;
    s.dropLevel.value = 0;
    s.boulderLevel.value = 0;
    s.moonCrack.value = ramp(t, 0.2, SHATTER);
    s.moon.visible = t < SHATTER;
    d.tau.value = t - SHATTER;
    d.updateShadow(t - SHATTER);
    ctx.rig.shake = pulse(t, SHATTER, 0.04, 0.9) * 2.6 + ramp(t, SHATTER - 1.2, SHATTER) * 0.4 * (t < SHATTER ? 1 : 0);

    // sun direction on screen for the dust's shadow march (#7)
    const cam = ctx.camera;
    this.sunNdc.copy(cam.position).addScaledVector(s.sun.value as Vector3, 1000).project(cam);
    const mx = new Vector3(MOON_POS.x, MOON_POS.y, MOON_POS.z).project(cam);
    const dx = this.sunNdc.x - mx.x;
    const dy = -(this.sunNdc.y - mx.y);
    const behind = this.sunNdc.z > 1 ? -1 : 1;
    const len = Math.hypot(dx, dy) || 1;
    d.sunDir2D.value.set((dx / len) * behind, (dy / len) * behind);
  }

  look(t: number, out: Look) {
    out.bloom = [0.85 + pulse(t, SHATTER, 0.05, 1.0) * 0.6, 0.6, 0.6];
    out.sky = 0.85;
    out.near = 0.05;
    out.far = 5200;
    out.focus = 30;
    out.aperture = 0;
    out.exposure = 1 - ramp(t, 14, 18) * 0.18;
    out.flash = pulse(t, SHATTER, 0.03, 0.2) * 0.55 + ramp(t, 22.6, 24) * 1.1;
    out.flashColor = t > 20 ? [0.8, 0.88, 1.0] : [1.0, 0.75, 0.5];
    out.warp = ramp(t, 22.3, 24) * 0.9;
    out.rays = 0.35;
    out.raysDir = [SUN.x, SUN.y, SUN.z];
    out.grade = { lift: [0.004, 0.004, 0.008], gamma: [1, 1, 1], gain: [1.02, 1, 0.97], saturation: 1.05 };
  }
}
