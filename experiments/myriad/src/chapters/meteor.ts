/**
 * 猛る隕石 — a mountain of rock falls on the living world.
 *
 * The asteroid is a real mesh, built once on the CPU (lumps, craters with
 * raised rims, boulders strewn over it), under a real sun with a shadow map;
 * its finest craters and grit are a screen-space bump from r186's moving 3D
 * Voronoi (#32). Entering the air, its leading face glows black-body (#20), a
 * sheath of plasma flows round it into a long wake of streaks (#9), and the
 * trail it sheds hangs in the air, rising and cooling. It breaks apart, and
 * the pieces explode high over the clouds, lighting them from inside while
 * a shock front races out through the deck.
 */
import {
  AdditiveBlending,
  AmbientLight,
  DirectionalLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  Quaternion,
  Vector3,
} from "three/webgpu";
import type { BufferGeometry } from "three/webgpu";
import { voronoi3d as voronoi3dTyped } from "three/addons/tsl/math/voronoiNoise.js";
import {
  abs,
  cameraPosition,
  clamp,
  cos,
  cross,
  dFdx,
  dFdy,
  dot,
  exp,
  float,
  instanceIndex,
  max,
  mix,
  normalView,
  normalWorld,
  normalize,
  positionLocal,
  positionView,
  select,
  sign,
  sin,
  smoothstep,
  sqrt,
  uint,
  uniform,
  uniformArray,
  varying,
  vec3,
} from "../tsl/t";
import type { Ctx, Look } from "../engine/chapter";
import { Chapter, pulse, ramp } from "../engine/chapter";
import { particleMesh } from "../engine/quad";
import type { Key } from "../engine/rig";
import { Shots } from "../engine/rig";
import { asteroidRock, boulderGeometry, makeRandom } from "../engine/rock";
import type { N } from "../tsl/common";
import { G, T, gauss, rnd } from "../tsl/common";
import { curlNoise, fbm2, snoiseGrad } from "../tsl/noise";
import { emberColor } from "../tsl/palette";
import { glowShape, spriteVertex } from "../tsl/sprite";
import { sunSprite } from "../tsl/sun";
import { LivingWorld, RA, RP, rollFor } from "./living";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const voronoi3d: any = voronoi3dTyped;

/* the flight: down at 30° onto a point over the night side, near the dawn line */
const B_HAT = new Vector3(0.18, 0.42, 0.89).normalize();
const T0 = new Vector3(1, 0, 0).projectOnPlane(B_HAT).normalize();
const S = new Vector3().crossVectors(B_HAT, T0).normalize();
const ENTRY = (30 * Math.PI) / 180;
/** Direction of flight, and "up" across it (away from the planet). */
const D = T0.clone().multiplyScalar(Math.cos(ENTRY)).addScaledVector(B_HAT, -Math.sin(ENTRY)).normalize();
const UP = new Vector3().crossVectors(S, D).normalize();
/** Where it explodes. */
const B = B_HAT.clone().multiplyScalar(RP + 3.5);
/** Toward the sun: low behind the dawn line, lighting the rock from the side. */
const L2 = new Vector3().addScaledVector(B_HAT, -0.2).addScaledVector(T0, -0.5).addScaledVector(S, 0.84).normalize();
const T_FRAG = 18.6;
const T_BURST = 23.2;
const N_FRAG = 7;
/** Each fragment's heading round the axis, sideways speed and drag (shared by CPU and GPU). */
const FRAGS = (() => {
  const rand = makeRandom(5);
  return Array.from({ length: N_FRAG }, (_, k) => ({ a: (k / N_FRAG) * Math.PI * 2 + (rand() - 0.5) * 1.1, v: 0.45 + rand() * 0.9, drag: 0.35 + rand() * 0.6 }));
})();
/** Where fragment k has drifted from the main body, tau seconds after the break-up. */
function fragOffsetAt(k: number, tau: number, out = new Vector3()) {
  const f = FRAGS[k];
  const dir = UP.clone().multiplyScalar(Math.cos(f.a)).addScaledVector(S, Math.sin(f.a));
  return out.copy(dir).multiplyScalar(f.v * tau + 0.25 * tau * tau).addScaledVector(D, -f.drag * tau * tau);
}
/** A per-fragment constant as a node (k is a uint node). */
const pick = (k: N, values: number[]): N => values.slice(1).reduce((acc: N, v, j) => select(k.equal(uint(j + 1)), float(v), acc), float(values[0]));

/** Distance still to fly; it jumps at the cuts (the shots compress time). */
function toGo(t: number) {
  if (t < 7.5) return 2600 - t * 0.3;
  if (t < 13) return 70 - (t - 7.5) * (36 / 5.5);
  if (t < 20.5) return 22 - (t - 13) * (16 / 7.5);
  return Math.max(0, 6 - (t - 20.5) * (6 / 2.7));
}
/** The same for the shots in the air (t ≥ 13), as a node. */
const toGoNode = (t: N): N => select(t.lessThan(20.5), float(22).sub(t.sub(13).mul(16 / 7.5)), max(float(6).sub(t.sub(20.5).mul(6 / 2.7)), 0));
const rockAt = (t: number, out = new Vector3()) => out.copy(B).addScaledVector(D, -toGo(t));
/** How hot the air has made it: from the top of the atmosphere down. */
const heatAt = (t: number) => (t < 13 ? 0 : ramp(toGo(t), 24, 3) * (t < T_BURST ? 1 : 0));

const v3 = (v: Vector3) => vec3(v.x, v.y, v.z);
const a3 = (v: Vector3): [number, number, number] => [v.x, v.y, v.z];

/**
 * Bump mapping without a texture (Mikkelsen's surface gradient): the screen
 * derivatives of a procedural height tilt the view-space normal.
 */
function bumpNormal(h: N, scale: number): N {
  const sx = dFdx(positionView);
  const sy = dFdy(positionView);
  const nrm = normalize(normalView);
  const r1 = cross(sy, nrm);
  const r2 = cross(nrm, sx);
  const det = dot(sx, r1);
  const grad = sign(det).mul(dFdx(h).mul(scale).mul(r1).add(dFdy(h).mul(scale).mul(r2)));
  return normalize(abs(det).mul(nrm).sub(grad));
}

export class MeteorChapter extends Chapter {
  readonly id = "meteor";
  readonly numeral = "";
  readonly name = "猛る隕石";
  readonly caption = "山ほどの岩が、空気に灼かれながら落ちてくる。";
  readonly duration = 26;
  readonly techniques = [36, 32, 20, 9, 15, 33, 38, 31];

  private readonly level = uniform(1);
  private readonly sun = uniform(L2.clone());
  private readonly heat = uniform(0);
  private readonly rockPos = uniform(new Vector3());
  private readonly flight = uniform(D.clone());
  private readonly fragOn = uniform(0);
  private readonly fragPos = uniformArray(Array.from({ length: N_FRAG }, () => new Vector3()));
  private readonly burstT = uniform(-1);
  private readonly world = new LivingWorld(L2);
  private rock!: Mesh;
  private rubble!: InstancedMesh;
  private frags!: InstancedMesh;
  private light!: DirectionalLight;
  private rubbleState: { o: Vector3; axis: Vector3; w: number; s: number; q: Quaternion }[] = [];
  private fragState: { s: number; q: Quaternion; spin: Vector3 }[] = [];

  constructor() {
    super();
    this.fadeIn = 0.9;
    this.fadeOut = 0;
    this.events = [{ t: T_BURST, name: "burst" }];
  }

  build(ctx: Ctx) {
    ctx.renderer.shadowMap.enabled = true;
    this.group.add(...this.world.meshes);
    this.group.add(sunSprite({ dir: this.sun, level: this.level, planet: RP, airScale: (RA - RP) * 0.25, size: 0.0075, distance: 250 }));

    const boulder = boulderGeometry(5);
    this.rock = this.buildRock(boulder);
    this.group.add(this.rock);
    this.rubble = this.buildRubble(boulder, 260);
    this.frags = this.buildFragments(boulder);
    this.group.add(this.rubble, this.frags);
    this.group.add(this.buildDust(Math.round(5000 * Math.max(0.5, ctx.q))));
    this.group.add(this.buildPlasma(Math.round(160_000 * Math.max(0.3, ctx.q))));
    this.group.add(this.buildTrail(Math.round(320_000 * Math.max(0.3, ctx.q))));
    this.group.add(this.buildFireball(Math.round(90_000 * Math.max(0.3, ctx.q))));

    // a real sun with a tight shadow map that follows the rock
    const light = new DirectionalLight(0xfff4e8, 6.2);
    light.castShadow = true;
    light.shadow.mapSize.set(4096, 4096);
    const sc = light.shadow.camera;
    sc.left = -2.6;
    sc.right = 2.6;
    sc.top = 2.6;
    sc.bottom = -2.6;
    sc.near = 0.5;
    sc.far = 24;
    light.shadow.bias = -0.0004;
    light.shadow.normalBias = 0.01;
    this.light = light;
    this.group.add(light, light.target, new AmbientLight(0x6a7894, 0.05));

    // shots, framed round the rock as it flies (D ahead, UP away from the planet, S to the side)
    const rel = (t: number, d: number, u: number, s: number) => rockAt(t).addScaledVector(D, d).addScaledVector(UP, u).addScaledVector(S, s);
    const key = (t: number, pos: Vector3, at: Vector3, up: Vector3, fov: number): Key => ({ t, pos: a3(pos), look: a3(at), fov, roll: rollFor(pos, at, up) });
    // (the last key is placed from just before the cut: the rock jumps at it)
    const follow = (t0: number, t1: number, cam: (t: number) => Vector3, at: (t: number) => Vector3, up: Vector3, f0: number, f1: number) =>
      [t0, (t0 + t1) / 2, t1].map((t, k) => {
        const tt = k === 2 ? t1 - 1e-4 : t;
        return key(t, cam(tt), at(tt), up, f0 + ((f1 - f0) * k) / 2);
      });
    const high = B.clone().addScaledVector(B_HAT, 48).addScaledVector(D, -30).addScaledVector(S, 22);
    const higher = B.clone().addScaledVector(B_HAT, 58).addScaledVector(D, -40).addScaledVector(S, 30);
    const below = B.clone().addScaledVector(D, 3).addScaledVector(B_HAT, -1);
    this.track = new Shots([
      // close by the rock in deep space, gliding along its flank; the sun grazes it from the side
      follow(0, 7.5, (t) => rel(t, -2.9 + t * 0.6, 3.0, 0.9), (t) => rel(t, 0.25, 0, 0), S, 40, 38),
      // behind it: the living world ahead, filling the sky
      follow(7.5, 13, (t) => rel(t, -6.5, 2.2, 1.6), (t) => rel(t, 30, -4, 0), B_HAT, 54, 50),
      // alongside, through the burning air
      follow(13, 20.5, (t) => rel(t, -2.8, 1.4, 4.6), (t) => rel(t, 1.2, 0, 0), B_HAT, 50, 54),
      // from high above: the fall, the break-up, the blast
      [key(20.5, high, below, B_HAT, 46), key(26, higher, below, B_HAT, 50)],
    ]);
  }

  /* ------------------------------------------------------------------ */

  /** Fine relief: small craters (#32) and grit; height in rock units. */
  private fineHeight(n: N): N {
    const crater = (p: N, rc: number): N => {
      const d = sqrt(voronoi3d(p, float(0)));
      const bowl = float(1).sub(smoothstep(rc * 0.7, rc, d)).negate();
      const rim = exp(d.sub(rc).div(rc * 0.25).pow(2).negate()).mul(0.4);
      return bowl.add(rim).mul(rc);
    };
    return crater(n.mul(14), 0.32)
      .mul(0.05)
      .add(crater(n.mul(38).add(3), 0.3).mul(0.025))
      .add(snoiseGrad(n.mul(120)).w.mul(0.004))
      .add(snoiseGrad(n.mul(310).add(7)).w.mul(0.0018));
  }

  /** The surface heat: the leading face glows white, the rest dull red. */
  private glow(front: N): N {
    const flicker = snoiseGrad(positionLocal.mul(9).add(vec3(0, G.time.mul(3), 0))).w.mul(0.25).add(1);
    const age = clamp(float(0.66).sub(this.heat.mul(0.42)).sub(front.mul(0.12)), 0, 1);
    return emberColor(age).mul(this.heat).mul(front.mul(0.65).add(0.04)).mul(flicker);
  }

  private buildRock(boulder: BufferGeometry): Mesh {
    const rock = asteroidRock(7, 110);
    const mat = new MeshStandardNodeMaterial();
    mat.roughnessNode = float(0.93);
    mat.metalnessNode = float(0);
    const n = normalize(positionLocal);
    const h = this.fineHeight(n);
    const tone = fbm2(n.mul(3)).mul(0.5).add(0.5);
    const base = mix(vec3(0.05, 0.048, 0.047), vec3(0.1, 0.092, 0.084), tone);
    // rims catch fresh, brighter rock; bowls hold dark dust; bluish weathered patches
    const weathered = smoothstep(0.55, 0.75, fbm2(n.mul(1.7).add(5)).mul(0.5).add(0.5));
    mat.colorNode = base.mul(h.mul(9).add(1)).mul(mix(vec3(1, 1, 1), vec3(0.88, 0.95, 1.08), weathered));
    mat.normalNode = bumpNormal(h.mul(T(36)), 1);
    mat.emissiveNode = this.glow(smoothstep(-0.1, 0.8, dot(normalWorld, this.flight)));
    const mesh = new Mesh(rock.geometry, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // boulders strewn over it, half sunk in the regolith
    const count = 520;
    const bmat = new MeshStandardNodeMaterial();
    bmat.roughnessNode = float(0.95);
    const bn = normalize(positionLocal);
    const bh = this.fineHeight(bn.mul(0.6).add(4.4));
    bmat.colorNode = vec3(0.06, 0.056, 0.052).mul(bh.mul(8).add(1));
    bmat.normalNode = bumpNormal(bh.mul(0.05).mul(T(36)), 1);
    bmat.emissiveNode = this.glow(smoothstep(-0.1, 0.8, dot(normalWorld, this.flight)));
    const stones = new InstancedMesh(boulder, bmat, count);
    const rand = makeRandom(91);
    const m = new Matrix4();
    const q = new Quaternion();
    const v = new Vector3();
    const p = new Vector3();
    const s = new Vector3();
    for (let k = 0; k < count; k++) {
      const z = rand() * 2 - 1;
      const a = rand() * Math.PI * 2;
      v.set(Math.sqrt(1 - z * z) * Math.cos(a), Math.sqrt(1 - z * z) * Math.sin(a), z);
      const r = rock.radiusAt(v);
      const size = 0.006 + rand() ** 3 * 0.04;
      p.set(v.x * r * rock.stretch.x, v.y * r * rock.stretch.y, v.z * r * rock.stretch.z).addScaledVector(v, -size * 0.35);
      q.setFromAxisAngle(new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(), rand() * Math.PI * 2);
      s.setScalar(size);
      stones.setMatrixAt(k, m.compose(p, q, s));
    }
    stones.castShadow = true;
    stones.receiveShadow = true;
    mesh.add(stones);
    return mesh;
  }

  /** Loose rubble drifting with the rock (CPU-placed instances, real shadows). */
  private buildRubble(boulder: BufferGeometry, count: number): InstancedMesh {
    const mat = new MeshStandardNodeMaterial();
    mat.roughnessNode = float(0.95);
    // the same dark regolith and pitted relief as the big rock
    const n = normalize(positionLocal);
    const h = this.fineHeight(n.mul(0.6).add(2.2));
    mat.colorNode = vec3(0.052, 0.049, 0.046).mul(h.mul(8).add(1)).mul(fbm2(n.mul(2.5)).mul(0.25).add(1));
    mat.normalNode = bumpNormal(h.mul(0.12).mul(T(36)), 1);
    const mesh = new InstancedMesh(boulder, mat, count);
    const rand = makeRandom(17);
    for (let k = 0; k < count; k++) {
      const r = 1.9 + rand() ** 1.6 * 5;
      const o = new Vector3(rand() - 0.5, (rand() - 0.5) * 0.6, rand() - 0.5).normalize().multiplyScalar(r);
      this.rubbleState.push({
        o,
        axis: new Vector3(rand() - 0.5, 1, rand() - 0.5).normalize(),
        w: (rand() - 0.5) * 0.05,
        s: 0.012 + rand() ** 4 * 0.09,
        q: new Quaternion().setFromAxisAngle(new Vector3(rand(), rand(), rand()).normalize(), rand() * 6),
      });
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  }

  /** The pieces it breaks into. */
  private buildFragments(boulder: BufferGeometry): InstancedMesh {
    const mat = new MeshStandardNodeMaterial();
    mat.roughnessNode = float(0.9);
    mat.colorNode = vec3(0.1, 0.09, 0.08);
    mat.emissiveNode = this.glow(smoothstep(-0.3, 0.7, dot(normalWorld, this.flight)).mul(0.8).add(0.2));
    const mesh = new InstancedMesh(boulder, mat, N_FRAG);
    const rand = makeRandom(6);
    for (let k = 0; k < N_FRAG; k++) {
      this.fragState.push({ s: 0.12 + rand() * 0.2, q: new Quaternion(), spin: new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize() });
    }
    mesh.frustumCulled = false;
    return mesh;
  }

  /** Fine dust round the rock, glittering toward the sun. */
  private buildDust(count: number): Mesh {
    const i = instanceIndex;
    const o = vec3(gauss(i, 0), gauss(i, 2).mul(0.5), gauss(i, 4)).mul(3.2);
    const drift = curlNoise(o.mul(0.4).add(G.time.mul(0.02))).mul(0.05);
    const pos = this.rockPos.add(o).add(drift);
    const phase = pow4(dot(normalize(pos.sub(cameraPosition)), this.sun).mul(0.5).add(0.5)).mul(1.4).add(0.08);
    const sprite = spriteVertex({ center: pos, radius: rnd(i, 6).mul(0.006).add(0.003), minPx: 0.7, maxPx: 6, visible: float(1).sub(this.heat.mul(4)).max(0) });
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = varying(vec3(1.0, 0.92, 0.8).mul(phase).mul(0.45).mul(this.level));
    mat.opacityNode = glowShape(sprite, 0.6).mul(sprite.energy);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    return particleMesh(count, mat, 4);
  }

  /**
   * The plasma sheath: grains flowing from the stagnation point over the
   * front of the body and back into a widening wake, each a streak along the
   * flow (#9). 70 % wrap the main body, the rest the fragments.
   */
  private buildPlasma(count: number): Mesh {
    const i = instanceIndex;
    const main = rnd(i, 0).lessThan(0.7);
    const k = i.mod(uint(N_FRAG));
    const centre = select(main, this.rockPos, this.fragPos.element(k));
    const size = select(main, float(1), float(0.3));
    const hot = this.heat.mul(this.heat.sqrt());
    const on = select(main, hot, hot.mul(this.fragOn));
    const d = this.flight;
    const e1 = normalize(cross(d, vec3(0.2, 1, 0.1)));
    const e2 = cross(d, e1);
    const speed = rnd(i, 1).mul(0.6).add(0.9);
    const s = G.time.mul(speed).add(rnd(i, 2)).fract().toVar();
    const th = rnd(i, 3).mul(Math.PI * 2);
    const len = rnd(i, 4).mul(10).add(8);
    // along the flow: from 1.5 ahead (the bow) to `len` behind
    const z = mix(float(1.5), len.negate(), s.pow(1.25));
    const bow = sqrt(max(float(1).sub(z.div(1.6).pow(2)), 0)).mul(1.45).add(0.12);
    const wake = sqrt(z.negate().max(0)).mul(0.32).add(1.0);
    const rho = select(z.greaterThan(0), bow, wake);
    const wobble = snoiseGrad(vec3(th.mul(2), z.mul(0.4), G.time.mul(1.5))).w.mul(0.18).add(1);
    const radial = e1.mul(cos(th)).add(e2.mul(sin(th)));
    const pos = centre.add(d.mul(z.mul(size))).add(radial.mul(rho.mul(wobble).mul(size)));
    const vel = d.mul(-1).add(radial.mul(select(z.greaterThan(0), float(0.6), float(0.08))));
    const fresh = float(1).sub(s).pow(1.4);
    const sprite = spriteVertex({
      center: pos,
      radius: rnd(i, 5).mul(0.06).add(0.035).mul(size),
      tail: pos.sub(vel.mul(0.35).mul(size).mul(T(9))),
      streakKeep: 0.7,
      minPx: 0.8,
      maxPx: 40,
      visible: on,
    });
    const col = mix(emberColor(float(0.5)), mix(vec3(1.0, 0.95, 0.9), vec3(0.75, 0.7, 1.0), rnd(i, 7).mul(0.6)), fresh.pow(2)).mul(fresh.mul(1.5).add(0.15));
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = varying(col.mul(on).mul(0.009).mul(this.level));
    mat.opacityNode = glowShape(sprite, 0.3).mul(sprite.energy);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    return particleMesh(count, mat, 6);
  }

  /**
   * The trail: grains shed along the path from the top of the air down. Each
   * stays where it was shed, rising, swelling and cooling (#20); after the
   * break-up a share follows the fragments' tracks instead.
   */
  private buildTrail(count: number): Mesh {
    const i = instanceIndex;
    const t = G.time;
    const tb = mix(float(13), float(T_BURST), rnd(i, 0)).toVar();
    const age = t.sub(tb).toVar();
    const alive = age.greaterThan(0).and(tb.lessThan(T_BURST));
    const shed = v3(B).sub(v3(D).mul(toGoNode(tb)));
    const k = i.mod(uint(N_FRAG));
    // after the break-up a third of the grains come off the fragments
    const fromFrag = tb.greaterThan(T_FRAG).and(rnd(i, 1).lessThan(0.35));
    const lateral = this.fragOffset(k, tb);
    const origin = shed.add(select(fromFrag, lateral, vec3(0)));
    const jitter = vec3(gauss(i, 2), gauss(i, 4), gauss(i, 6)).mul(select(fromFrag, float(0.12), float(0.38)));
    const swirl = curlNoise(origin.mul(0.35).add(vec3(0, age.mul(0.15), 0))).mul(age.mul(0.25));
    const pos = origin.add(jitter.mul(age.mul(0.5).add(1))).add(v3(D).mul(float(1).sub(exp(age.mul(-3))).mul(0.6))).add(v3(B_HAT).mul(age.mul(0.12))).add(swirl);
    const heat = exp(age.mul(-0.55));
    const sprite = spriteVertex({ center: pos, radius: rnd(i, 8).mul(0.12).add(0.06).mul(age.mul(0.35).add(1)), minPx: 0.8, maxPx: 60, visible: select(alive, float(1), float(0)) });
    const col = emberColor(float(1).sub(heat).mul(0.9)).mul(heat.mul(heat)).add(vec3(0.05, 0.045, 0.05).mul(float(1).sub(heat)));
    // grains streaming past the lens would only be a glare: let them go
    const near = smoothstep(1.5, 6, pos.sub(cameraPosition).length());
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = varying(col.mul(near).mul(0.016).mul(this.level));
    mat.opacityNode = glowShape(sprite, 0.1).mul(sprite.energy);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    return particleMesh(count, mat, 5);
  }

  /** fragOffsetAt as a node of the shed time. */
  private fragOffset(k: N, t: N): N {
    const a = pick(k, FRAGS.map((f) => f.a));
    const dir = v3(UP).mul(cos(a)).add(v3(S).mul(sin(a)));
    const tau = max(t.sub(T_FRAG), 0);
    return dir.mul(pick(k, FRAGS.map((f) => f.v)).mul(tau).add(tau.mul(tau).mul(0.25))).sub(v3(D).mul(pick(k, FRAGS.map((f) => f.drag)).mul(tau.mul(tau))));
  }

  /** The blast: a white core, then a ball of fire that swells, rises and cools (#20). */
  private buildFireball(count: number): Mesh {
    const i = instanceIndex;
    const tau = G.time.sub(this.burstT);
    const alive = this.burstT.greaterThan(0).and(tau.greaterThan(0));
    const dir = normalize(vec3(gauss(i, 0), gauss(i, 2), gauss(i, 4)));
    const reach = float(1).sub(exp(tau.mul(-1.6))).mul(7.5);
    const r = rnd(i, 6).pow(0.4).mul(reach);
    const churn = curlNoise(dir.mul(2).add(tau.mul(0.2))).mul(tau.mul(0.25));
    const pos = v3(B).add(dir.mul(r)).add(v3(B_HAT).mul(tau.mul(tau).mul(0.18))).add(churn);
    const age = tau.mul(0.16).add(rnd(i, 7).mul(0.18)).add(r.div(reach.max(0.1)).mul(0.15));
    const fade = exp(tau.mul(-0.35));
    const sprite = spriteVertex({ center: pos, radius: rnd(i, 8).mul(0.5).add(0.35).mul(tau.mul(0.3).add(1)), minPx: 1, maxPx: 160, visible: select(alive, float(1), float(0)) });
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = varying(emberColor(age).mul(fade).mul(0.035).mul(this.level));
    mat.opacityNode = glowShape(sprite, 0.05).mul(sprite.energy);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    return particleMesh(count, mat, 7);
  }

  /* ------------------------------------------------------------------ */

  update(ctx: Ctx, t: number) {
    this.level.value = 1;
    this.world.spin.value = t * 0.004;
    const A = rockAt(t);
    const heat = heatAt(t);
    this.heat.value = heat;
    this.rockPos.value.copy(A);
    const burst = t >= T_BURST;
    this.burstT.value = burst ? T_BURST : -1;

    // the rock tumbles slowly; it is gone in the blast
    this.rock.position.copy(A);
    this.rock.quaternion.setFromAxisAngle(new Vector3(0.3, 1, 0.2).normalize(), 0.3 + t * 0.1);
    this.rock.visible = !burst;
    this.light.position.copy(A).addScaledVector(L2, 12);
    this.light.target.position.copy(A);
    this.light.target.updateMatrixWorld();

    // rubble drifts along in the vacuum, and is left behind once in the air
    this.rubble.visible = t < 13;
    if (this.rubble.visible) {
      const m = new Matrix4();
      const p = new Vector3();
      const q = new Quaternion();
      const s = new Vector3();
      this.rubbleState.forEach((r, k) => {
        p.copy(r.o).applyAxisAngle(r.axis, r.w * t).add(A);
        q.copy(r.q).multiply(new Quaternion().setFromAxisAngle(r.axis, t * 0.3));
        s.setScalar(r.s);
        this.rubble.setMatrixAt(k, m.compose(p, q, s));
      });
      this.rubble.instanceMatrix.needsUpdate = true;
    }

    // the break-up
    const split = t >= T_FRAG && !burst;
    this.frags.visible = split;
    this.fragOn.value = split ? ramp(t, T_FRAG, T_FRAG + 0.5) : 0;
    if (split) {
      const tau = t - T_FRAG;
      const m = new Matrix4();
      const p = new Vector3();
      this.fragState.forEach((f, k) => {
        p.copy(A).add(fragOffsetAt(k, tau));
        (this.fragPos.array[k] as Vector3).copy(p);
        f.q.setFromAxisAngle(f.spin, tau * 2.4);
        this.frags.setMatrixAt(k, m.compose(p, f.q, new Vector3().setScalar(f.s)));
      });
      this.frags.instanceMatrix.needsUpdate = true;
    }

    // the fireball lights the clouds it passes over; the blast lights them all
    const w = this.world;
    const tau = t - T_BURST;
    if (!burst) {
      w.flashPos.value.copy(A);
      w.flashPower.value = heat * heat * 60;
      w.ringPower.value = 0;
    } else {
      w.flashPos.value.copy(B);
      w.flashPower.value = 420 * pulse(t, T_BURST, 0.05, 0.5) + 90 * Math.exp(-tau * 0.4);
      w.ringRadius.value = tau * 9;
      w.ringPower.value = (1 - ramp(t, T_BURST + 0.8, T_BURST + 3.2)) * ramp(t, T_BURST, T_BURST + 0.2) * 1.2;
    }
    ctx.rig.shake = (t >= 13 && t < 20.5 ? heat * 0.9 : 0) + pulse(t, T_BURST, 0.05, 1.2) * 1.6;
  }

  look(t: number, out: Look) {
    const space = t < 7.5;
    out.bloom = [0.7 + this.heat.value * 0.3 + pulse(t, T_BURST, 0.05, 1.0) * 0.5, 0.6, 0.85];
    out.exposure = space ? 1.15 : 1.0;
    // big bright areas (the burning sheath, the blast) throw oversized ghosts (#33)
    out.flare = t < 13 ? 0.5 : t < T_BURST - 0.3 ? 0.18 : 0.06;
    out.sky = space ? 0.75 : 0.45;
    // in deep space the planet is out of the shot: a tight depth range
    out.near = space ? 0.02 : 0.05;
    out.far = space ? 320 : 2400;
    out.focus = 4;
    out.aperture = 0;
    // the blast's light swells to white at the end: the next chapter opens out of white
    out.flash = pulse(t, T_BURST, 0.02, 0.1) * 0.8 + ramp(t, 24.8, 26) * 1.1;
    out.flashColor = [1.0, 0.9, 0.78];
    out.warp = ramp(t, 24.9, 26) * 0.5;
  }
}

/** x⁴ without a pow (sharper glints). */
function pow4(x: N): N {
  const x2 = x.mul(x);
  return x2.mul(x2);
}
