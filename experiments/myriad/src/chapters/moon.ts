/**
 * II — 砕ける月. The moon of the ringed giant breaks apart.
 *
 * Every piece is stateless: position = p0 + v·(1 − e^(−kτ))/k, so the whole
 * catastrophe can be scrubbed, and an earlier moment is one more evaluation:
 * #8  stateless afterimage — chunk trails drawn from p(τ − Δ) to p(τ)
 * #9  sparks stretched along their analytic velocity
 * #10 / #23 impostor rock chunks with a basalt MatCap
 * #24 Voronoi borders glowing on every chunk, #20 cooling black-body colour
 * #7  screen-space shadow: the dust marches toward the sun through the depth
 *     buffer, so the chunks cut shafts of shadow into the cloud
 * #2  (ring) grains touching a chunk surface light up instead of fading
 */
import { AdditiveBlending, MeshBasicNodeMaterial, Vector2, Vector3 } from "three/webgpu";
import type { Mesh } from "three/webgpu";
import {
  Fn,
  cameraFar,
  cameraNear,
  clamp,
  dot,
  exp,
  float,
  instanceIndex,
  length,
  max,
  mix,
  normalize,
  perspectiveDepthToViewZ,
  pow,
  screenSize,
  screenUV,
  select,
  smoothstep,
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
import type { N } from "../tsl/common";
import { G, T, gauss, rnd } from "../tsl/common";
import { impostorSphere, makeMatcap, matcapShade, voronoiCracks } from "../tsl/impostor";
import { snoiseGrad } from "../tsl/noise";
import { blackbody, emberColor } from "../tsl/palette";
import { ditherKeep, glowShape, spriteVertex } from "../tsl/sprite";
import type { PlanetSystem } from "./planet";
import { MOON_POS, MOON_R } from "./planet";

const SHATTER = 3.0;

/** Random unit vector for particle i from three normal streams. */
function dirOf(i: N, k: number): N {
  return normalize(vec3(gauss(i, k), gauss(i, k + 2), gauss(i, k + 4)).add(vec3(0, 0, 1e-5)));
}

export class Debris {
  /** Seconds since the shatter (negative before). */
  readonly tau = uniform(-1);
  readonly level = uniform(1);
  readonly sunDir2D = uniform(new Vector2(1, 0));
  readonly center = uniform(MOON_POS.clone());
  readonly chunks: Mesh;
  readonly trails: Mesh;
  readonly sparks: Mesh;
  readonly dust: Mesh;
  readonly core: Mesh;
  private sys: PlanetSystem;

  constructor(ctx: Ctx, sys: PlanetSystem) {
    this.sys = sys;
    const nChunks = Math.round(9000 * Math.max(0.4, ctx.q));
    this.chunks = this.buildChunks(nChunks);
    this.trails = this.buildTrails(Math.round(nChunks * 0.3));
    this.sparks = this.buildSparks(Math.round(130000 * ctx.q));
    this.dust = this.buildDust(Math.round(90000 * Math.max(0.3, ctx.q)));
    this.core = this.buildCore();
    sys.group.add(this.chunks, this.trails, this.sparks, this.dust, this.core);
    this.setVisible(false);
  }

  setVisible(v: boolean) {
    this.chunks.visible = v;
    this.trails.visible = v;
    this.sparks.visible = v;
    this.dust.visible = v;
    this.core.visible = v;
  }

  /** Chunk i's state at time τ: [position, radius, speed]. */
  private chunkAt(i: N, tau: N) {
    const dir = dirOf(i, 0);
    const u = rnd(i, 6);
    const radius = u.pow(6).mul(1.45).add(0.05).toVar();
    const p0 = this.center.add(dir.mul(rnd(i, 7).pow(0.33).mul(MOON_R * 0.88)));
    const speed = mix(float(14), float(2.6), u.pow(0.5)).mul(rnd(i, 8).mul(0.5).add(0.75));
    const v = dir.mul(speed).add(dirOf(i, 9).mul(0.6));
    const k = 0.08;
    const s = float(1).sub(exp(tau.mul(-k))).div(k);
    return { pos: p0.add(v.mul(s)), radius, speed };
  }

  private buildChunks(count: number): Mesh {
    const i = instanceIndex;
    const tau = max(this.tau, 0);
    const c = this.chunkAt(i, tau);
    const pos = c.pos.toVar();
    const dist = length(pos.sub(G.camPos));
    const near = smoothstep(c.radius.mul(1.5).add(0.3), c.radius.mul(2.4).add(1.0), dist);
    const sprite = spriteVertex({ center: pos, radius: c.radius, minPx: 0.8, maxPx: 1400, visible: select(this.tau.greaterThan(0), float(1), float(0)) });
    const viewC = varying(G.viewMatrix.mul(vec4(pos, 1)).xyz);
    const seed = varying(rnd(i, 10).mul(60));
    const ang = varying(rnd(i, 11).mul(6.283).add(tau.mul(rnd(i, 12).sub(0.5).mul(1.6))));
    const asp = varying(rnd(i, 13).mul(0.6).add(1));
    const l = sprite.local;
    const lp = vec2(l.x.mul(ang.cos()).sub(l.y.mul(ang.sin())), l.x.mul(ang.sin()).add(l.y.mul(ang.cos()))).mul(vec2(1, asp));
    const imp = impostorSphere(lp, viewC, varying(c.radius), float(0.8), seed);
    const sunView = normalize(G.viewMatrix.mul(vec4(this.sys.sun, 0)).xyz);
    const basalt = makeMatcap("basalt");
    const shade = matcapShade(basalt, imp.normal, sunView, vec3(0.7, 0.66, 0.62));
    const direct = smoothstep(-0.05, 0.6, dot(imp.normal, sunView)).mul(1.4);
    // #24 cracks in the chunk's own (tumbling) frame; #20 cools with time
    const tumble = varying(tau.mul(rnd(i, 14).mul(0.8).add(0.2)));
    const nObj = vec3(
      imp.normal.x.mul(tumble.cos()).sub(imp.normal.z.mul(tumble.sin())),
      imp.normal.y,
      imp.normal.x.mul(tumble.sin()).add(imp.normal.z.mul(tumble.cos())),
    );
    const cracks = voronoiCracks(nObj.mul(2.4).add(seed), float(0.055));
    const heat = varying(clamp(tau.div(c.radius.mul(7).add(3.5)).add(0.12), 0, 1));
    const glow = blackbody(heat).mul(cracks).mul(1.3);
    const col = shade.mul(direct.mul(1.2).add(0.05)).add(glow).mul(this.level);
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = col;
    mat.depthNode = imp.depth;
    // #5 chunks drifting through the camera dissolve by dithering
    mat.maskNode = imp.inside.and(ditherKeep(varying(near)));
    return particleMesh(count, mat, 1);
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
      const temp = mix(float(0.12), float(0.5), float(1).sub(cells)).add(cool.mul(0.45));
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
  readonly techniques = [10, 23, 24, 20, 8, 9, 7, 2, 5, 31];
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
    s.moonCrack.value = ramp(t, 0.4, SHATTER);
    s.moon.visible = t < SHATTER;
    d.tau.value = t - SHATTER;
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
  }
}
