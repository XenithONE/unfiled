/**
 * 巨大衝突 — a Mars-sized world strikes the young Earth.
 *
 * The debris lives in a struct storage buffer (TSL `struct`, #35): position,
 * heat, velocity and birth time per grain, integrated by a compute pass under
 * the planet's gravity. Grains launch in waves — the jet, the plume, the
 * vapour — fall back or go into orbit; collisions, faked as a damping towards
 * circular orbits, flatten what stays into a disk where a clump gathers: the
 * Moon. Hot grains glow black-body (#20) and stretch with speed (#9). Both
 * worlds crack along glowing plate borders (#24); after the hit a magma ocean
 * spreads over the Earth in churning moving-Voronoi cells (r186, #32).
 */
import { AdditiveBlending, DoubleSide, Mesh, MeshBasicNodeMaterial, RingGeometry, SphereGeometry, Vector3 } from "three/webgpu";
import { voronoi3d as voronoi3dTyped } from "three/addons/tsl/math/voronoiNoise.js";
import {
  Fn,
  If,
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
  instanceIndex,
  instancedArray,
  length,
  log,
  max,
  min,
  mix,
  modelWorldMatrix,
  normalLocal,
  normalWorld,
  normalize,
  positionLocal,
  positionWorld,
  select,
  sin,
  smoothstep,
  sqrt,
  struct,
  uint,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from "../tsl/t";
import type { Ctx, Look } from "../engine/chapter";
import { Chapter, pulse, ramp } from "../engine/chapter";
import { particleMesh } from "../engine/quad";
import type { Key, V3 } from "../engine/rig";
import { Shots } from "../engine/rig";
import type { N } from "../tsl/common";
import { G, T, gauss, rnd } from "../tsl/common";
import { voronoiCracks } from "../tsl/impostor";
import { curlNoise, fbm2, snoiseGrad } from "../tsl/noise";
import { emberColor } from "../tsl/palette";
import { glowShape, spriteVertex } from "../tsl/sprite";
import { sunSprite } from "../tsl/sun";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const voronoi3d: any = voronoi3dTyped;

const R1 = 100;
const R2 = 54;
const T_HIT = 6.2;
const GM = 1.3e6;
/** The plane the debris settles into, and where on it the worlds touch. */
const AX = new Vector3(0.12, 1, 0.08).normalize();
const HIT = new Vector3(0.82, 0.12, -0.56).projectOnPlane(AX).normalize();
/** Prograde along the surface at the contact; Theia comes in at 45° to it. */
const FWD = new Vector3().crossVectors(AX, HIT).normalize();
const VDIR = FWD.clone().multiplyScalar(Math.SQRT1_2).addScaledVector(HIT, -Math.SQRT1_2);
/** Toward the young sun: behind Theia's approach and high, so both worlds are lit. */
const SUN = new Vector3().addScaledVector(HIT, -0.14).addScaledVector(FWD, -0.85).addScaledVector(AX, 0.5).normalize();
const V_T = 72;
const C_HIT = HIT.clone().multiplyScalar(R1 + R2);
/** After contact Theia ploughs on, slowing, as it is torn apart. */
const SINK = 1.4;
/** The proto-Moon gathers on this orbit. */
const R_MOON = 240;
const W_MOON = Math.sqrt(GM / R_MOON ** 3);
const T_MOON = 18.5;

const v3 = (v: Vector3) => vec3(v.x, v.y, v.z);
const a3 = (v: Vector3): V3 => [v.x, v.y, v.z];

/** Theia's centre at time t (seconds, chapter time). */
function theiaAt(t: number, out = new Vector3()) {
  if (t <= T_HIT) return out.copy(C_HIT).addScaledVector(VDIR, V_T * (t - T_HIT));
  return out.copy(C_HIT).addScaledVector(VDIR, (V_T / SINK) * (1 - Math.exp(-SINK * (t - T_HIT))));
}

/** One debris grain: 32 bytes. */
const GRAIN = struct({ pos: "vec3", heat: "float", vel: "vec3", born: "float" }, "Grain");

export class ImpactChapter extends Chapter {
  readonly id = "impact";
  readonly numeral = "";
  readonly name = "巨大衝突";
  readonly caption = "若い地球に、火星ほどの星がぶつかる。砕けた岩はやがて月になる。";
  readonly duration = 26;
  readonly techniques = [35, 32, 24, 20, 9, 14, 40, 31];

  private readonly level = uniform(1);
  private readonly sun = uniform(SUN.clone());
  private readonly simT = uniform(0);
  private readonly simDt = uniform(1 / 60);
  private readonly settle = uniform(0);
  private readonly moonPos = uniform(new Vector3());
  private readonly moonVel = uniform(new Vector3());
  private readonly moonOn = uniform(0);
  private readonly theiaC = uniform(new Vector3());
  private readonly theiaR = uniform(R2);
  private readonly contact = uniform(0);
  private readonly strain = uniform(0);
  private readonly melt = uniform(0);
  private readonly front = uniform(0);
  private readonly cooling = uniform(0);
  private readonly coreHeat = uniform(0);
  private readonly coreR = uniform(0.2);
  private readonly wave = uniform(0);
  private readonly waveOn = uniform(0);
  private readonly diskOn = uniform(0);
  private theia!: Mesh;
  private moonGlow!: Mesh;
  private moonBody!: Mesh;
  private debrisInit: unknown;
  private debrisStep: unknown;
  private simTime = 0;

  constructor() {
    super();
    this.fadeIn = 0;
    this.events = [{ t: T_HIT, name: "burst" }];
  }

  build(ctx: Ctx) {
    this.group.add(this.buildEarth());
    this.theia = this.buildTheia();
    this.group.add(this.theia);
    this.group.add(this.buildDebris(Math.round(1_600_000 * Math.max(0.25, ctx.q))));
    this.moonGlow = this.buildMoonGlow();
    this.moonBody = this.buildMoonBody();
    this.group.add(this.moonGlow, this.moonBody);
    this.group.add(this.buildDust(Math.round(160_000 * Math.max(0.4, ctx.q))));
    this.group.add(this.buildDiskGlow());
    this.group.add(sunSprite({ dir: this.sun, level: this.level, planet: R1, size: 0.006, tint: [0.95, 0.97, 1.0] }));

    // shots, in the frame of the hit (HIT out, FWD along Theia's path, AX up):
    // the approach and the hit, the plume wrapping round, the disk
    const at = (h: number, f: number, a: number) => new Vector3().addScaledVector(HIT, h).addScaledVector(FWD, f).addScaledVector(AX, a);
    const key = (t: number, pos: Vector3, look: Vector3, fov: number): Key => ({ t, pos: a3(pos), look: a3(look), fov });
    // over Theia's shoulder: behind it on its path, above, and to the outside
    const inward = new Vector3().crossVectors(AX, VDIR).normalize();
    const over = (t: number) => theiaAt(t).addScaledVector(VDIR, -130).addScaledVector(AX, 80).addScaledVector(inward, -60);
    this.track = new Shots([
      [key(0, over(0), at(40, 0, 0), 48), key(2.7, over(2.7), at(50, 0, 0), 46), key(5.4, over(5.4), at(70, 0, 0), 44)],
      // high and to the front: the contact, the jet, the plume fanning out below
      [key(5.4, at(330, 60, 380), at(110, 40, 0), 48), key(12, at(380, 110, 430), at(90, 110, 20), 52)],
      // from above: the plume wraps round the planet
      [key(12, at(220, -160, 560), at(30, 40, 0), 50), key(19, at(120, -260, 640), at(0, 0, 0), 50)],
      // above the disk, the Moon gathering in it: high enough to see the ring as a ring
      [key(19, at(140, 540, 230), at(0, 110, -10), 46), key(26, at(230, 720, 330), at(0, 90, -10), 42)],
    ]);
  }

  /* ------------------------------------------------------------------ */

  /**
   * Dark basalt crust lit by the young sun; glowing fissures (#24) open only
   * in the active provinces (`active` widens them), with lava lakes between.
   */
  private crust(n: N, tint: N, active: N): N {
    const nW = normalize(normalWorld);
    const rough = fbm2(n.mul(6)).mul(0.5).add(0.5);
    const grit = snoiseGrad(n.mul(26)).w.mul(0.18).add(1).mul(snoiseGrad(n.mul(70).add(1.3)).w.mul(0.1).add(1));
    // craters at two scales: distance to the nearest Voronoi centre (r186, #32)
    const crater = (d: N, rc: number): N => {
      const bowl = float(1).sub(smoothstep(rc * 0.65, rc, d));
      const rim = exp(d.sub(rc).div(rc * 0.2).pow(2).negate());
      return bowl.mul(-0.38).add(rim.mul(0.3));
    };
    const relief = crater(sqrt(voronoi3d(n.mul(6.5), float(0))), 0.3).add(crater(sqrt(voronoi3d(n.mul(17).add(2.5), float(0))), 0.26).mul(0.7));
    // dark, glassy young basalt (warm black), not the grey of an old moon
    const rock = mix(vec3(0.035, 0.028, 0.025), vec3(0.1, 0.075, 0.06), rough).mul(grit).mul(relief.mul(0.7).add(1)).mul(tint);
    const ndl = dot(nW, this.sun);
    // the young sun's light is a cool white against the red of the melt
    const lit = rock.mul(vec3(0.92, 0.96, 1.06)).mul(smoothstep(-0.05, 0.3, ndl).mul(max(ndl, 0).mul(1.3).add(0.04)).add(0.01));
    // a young, violent crust: wide volcanic provinces, glowing fissures and lava lakes
    const province = smoothstep(float(0.5).sub(active.mul(0.5)), float(0.72).sub(active.mul(0.5)), fbm2(n.mul(2.4).add(1.7)).mul(0.5).add(0.5));
    const fissures = max(voronoiCracks(n.mul(3.2), float(0.03)), voronoiCracks(n.mul(8.5).add(3), float(0.022)).mul(0.65)).mul(province.mul(0.8).add(0.2));
    const lakes = smoothstep(0.68, 0.84, fbm2(n.mul(5).add(9)).mul(0.5).add(0.5)).mul(province.mul(0.7).add(0.3));
    return lit.mul(float(1).sub(lakes.mul(0.8))).add(emberColor(float(0.55)).mul(fissures.mul(0.42))).add(emberColor(float(0.62)).mul(lakes.mul(0.35)));
  }

  /**
   * A magma ocean: a churning temperature field (domain-warped noise) with hot
   * upwellings at the moving cells of r186's 3D Voronoi (#32); where it cools
   * below a threshold, dark rafts of crust float with glowing seams (#24).
   */
  private magma(n: N, heat: N): N {
    const t = G.time;
    const flow = snoiseGrad(n.mul(1.5).add(vec3(0, t.mul(0.05), 0))).xyz.mul(0.16);
    const q = n.add(flow).toVar();
    // large, legible structure: broad hot and cool provinces, hot upwellings
    const cells = voronoi3d(q.mul(4.2), t.mul(0.35));
    const temp = fbm2(q.mul(2.4).add(vec3(t.mul(0.03), 0, 0))).mul(0.3)
      .add(float(1).sub(smoothstep(0.0, 0.28, cells)).mul(0.32))
      .add(0.36)
      .add(heat)
      .toVar();
    // most of it skins over: black rafts split by glowing seams, open melt where it runs hot
    const raft = smoothstep(0.62, 0.52, temp);
    const seams = max(voronoiCracks(q.mul(3.6), float(0.06)), voronoiCracks(q.mul(8.5).add(2.1), float(0.05)).mul(0.55)).mul(raft);
    const melt = emberColor(clamp(float(1.05).sub(temp), 0.02, 1)).mul(0.5);
    const crustRaft = vec3(0.03, 0.022, 0.02).mul(snoiseGrad(q.mul(30)).w.mul(0.3).add(1)).add(emberColor(float(0.4)).mul(seams.mul(0.9)));
    return mix(melt, crustRaft, raft.mul(0.94));
  }

  private buildEarth(): Mesh {
    const geo = new SphereGeometry(R1, 320, 220);
    const mat = new MeshBasicNodeMaterial();
    mat.colorNode = Fn(() => {
      const n = normalize(normalLocal);
      const ang = acos(clamp(dot(n, v3(HIT)), -1, 1)).toVar();
      const solid = this.crust(n, vec3(1, 1, 1), float(0.45));
      // the magma ocean spreads from the impact, hottest near the wound
      const molten = smoothstep(this.front, this.front.sub(0.15), ang);
      const sea = this.magma(n, exp(ang.mul(-1.6)).mul(0.25).sub(this.cooling));
      // white heat at the wound, the shock ring, and where Theia presses in
      const core = exp(ang.div(this.coreR).pow(2).negate()).mul(this.coreHeat);
      // the shock front: a broad, ragged swell of heat rather than a thin hoop
      const ragged = snoiseGrad(n.mul(9).add(G.time.mul(0.3))).w.mul(0.025);
      const ring = exp(ang.add(ragged).sub(this.wave).div(0.07).pow(2).negate()).mul(this.waveOn);
      const seam = smoothstep(16, 0, length(positionWorld.sub(this.theiaC)).sub(this.theiaR)).mul(this.contact);
      return mix(solid, sea, molten)
        .add(vec3(1, 0.8, 0.55).mul(core.mul(2.5)))
        .add(emberColor(float(0.3)).mul(ring.mul(0.7)))
        .add(vec3(1, 0.88, 0.7).mul(seam.mul(2.5)))
        .mul(this.level);
    })();
    return new Mesh(geo, mat);
  }

  private buildTheia(): Mesh {
    const geo = new SphereGeometry(R2, 256, 180);
    const mat = new MeshBasicNodeMaterial();
    // whatever part of Theia would pass inside the Earth is squashed flat on
    // its surface instead: it pancakes against the planet as it ploughs in
    mat.positionNode = Fn(() => {
      const w = modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz;
      const flat = normalize(w).mul(R1 * 1.004);
      const local = flat.sub(this.theiaC).div(max(this.theiaR.div(R2), 1e-3));
      return select(length(w).lessThan(R1 * 1.004), local, positionLocal);
    })();
    mat.colorNode = Fn(() => {
      const n = normalize(normalLocal);
      // tidal strain opens its fissures as it nears; after the hit it melts through
      const solid = this.crust(n.add(7.7), vec3(1.15, 0.95, 0.85), this.strain.mul(0.9).add(0.1));
      const sea = this.magma(n.add(3.3), float(0.12));
      const seam = smoothstep(14, 0, length(positionWorld).sub(R1)).mul(this.contact);
      return mix(solid, sea, this.melt).add(vec3(1, 0.88, 0.7).mul(seam.mul(3))).mul(this.level);
    })();
    return new Mesh(geo, mat);
  }

  /**
   * #35 the debris: a struct buffer stepped by compute. Kinds by index: the
   * jet (first 8 %), the vapour (next 5 %), the plume (the rest).
   */
  private buildDebris(n: number): Mesh {
    const buf = instancedArray(n, GRAIN);
    const nJet = Math.floor(n * 0.08);
    const nVap = Math.floor(n * 0.05);
    const kindOf = (i: N): N => select(i.lessThan(uint(nJet)), float(0), select(i.lessThan(uint(nJet + nVap)), float(2), float(1)));
    const launchOf = (i: N, kind: N): N => {
      const u = rnd(i, 20);
      const delay = select(kind.lessThan(0.5), u.mul(0.7), select(kind.greaterThan(1.5), u.mul(2.4), u.pow(1.4).mul(4.4).add(0.15)));
      return float(T_HIT).add(delay);
    };

    this.debrisInit = Fn(() => {
      const g = buf.element(instanceIndex);
      g.get("pos").assign(vec3(0, -1e6, 0));
      g.get("vel").assign(vec3(0));
      g.get("heat").assign(float(0));
      g.get("born").assign(float(-1));
    })().compute(n, [256]);

    this.debrisStep = Fn(() => {
      const i = instanceIndex;
      const g = buf.element(i);
      const kind = kindOf(i).toVar();
      const isJet = kind.lessThan(0.5);
      const isVap = kind.greaterThan(1.5);
      const born = g.get("born").toVar();
      const t = this.simT;
      const dt = this.simDt;
      If(born.lessThan(-0.5).and(born.greaterThan(-1.5)), () => {
        const launch = launchOf(i, kind);
        If(t.greaterThanEqual(launch), () => {
          // where Theia is when this grain leaves: the contact slides forward
          const tau = launch.sub(T_HIT);
          const c = v3(C_HIT).add(v3(VDIR).mul(float(V_T / SINK).mul(float(1).sub(exp(tau.mul(-SINK))))));
          const up = normalize(c);
          const fw = normalize(v3(VDIR).sub(up.mul(dot(v3(VDIR), up))));
          const sd = cross(up, fw);
          const gx = gauss(i, 1);
          const gy = gauss(i, 3);
          const gz = gauss(i, 5);
          const u1 = rnd(i, 7);
          const u2 = rnd(i, 8);
          const u3 = rnd(i, 9);
          const base = up.mul(R1);
          // the jet skims forward, fast, flat and white-hot
          const pJet = base.add(up.mul(3)).add(sd.mul(gx.mul(5))).add(fw.mul(gy.mul(4)));
          const vJet = fw.mul(u1.mul(90).add(190)).add(up.mul(u2.mul(45).add(20))).add(sd.mul(gz.mul(30)));
          // the plume: a broad fountain from the whole merging zone
          const pPl = base.add(up.mul(u2.mul(10).add(2))).add(sd.mul(gx.mul(R2 * 0.27))).add(fw.mul(gy.mul(R2 * 0.27)));
          // speeds and directions spread softly (no hard-edged cone)
          const vPl = up
            .mul(u1.pow(0.7).mul(80).add(35))
            .add(fw.mul(gauss(i, 17).mul(45).add(95)))
            .add(sd.mul(gz.mul(30).add(gauss(i, 19).mul(gz.abs()).mul(22))));
          // the vapour: slower, swelling
          const pVa = base.add(up.mul(u2.mul(8).add(4))).add(vec3(gx, gy, gz).mul(10));
          const vVa = up.mul(u1.mul(60).add(25)).add(fw.mul(u3.mul(70))).add(vec3(gauss(i, 11), gauss(i, 13), gauss(i, 15)).mul(22));
          g.get("pos").assign(select(isJet, pJet, select(isVap, pVa, pPl)));
          g.get("vel").assign(select(isJet, vJet, select(isVap, vVa, vPl)));
          g.get("heat").assign(select(isJet.or(isVap), float(1), rnd(i, 10).mul(0.3).add(0.7)));
          g.get("born").assign(t);
        });
      }).ElseIf(born.greaterThanEqual(0), () => {
        const p = g.get("pos").toVar();
        const v = g.get("vel").toVar();
        const r = length(p).toVar();
        const up = p.div(r);
        const age = t.sub(born);
        // gravity (the vapour is buoyed by its own pressure)
        const a = up.mul(float(-GM).div(r.mul(r))).mul(select(isVap, float(0.35), float(1))).toVar();
        // the plume's pressure lofts it for the first moments, and it billows (#15)
        a.addAssign(up.mul(exp(age.mul(-2.5)).mul(select(isJet, float(0), float(70)))));
        a.addAssign(curlNoise(p.mul(0.018).add(vec3(0, t.mul(0.15), 0))).mul(exp(age.mul(-0.45)).mul(select(isJet, float(8), float(26)))));
        // collisions: damping towards a circular prograde orbit, flattened to the disk
        const ax = v3(AX);
        const vc = normalize(cross(ax, p)).mul(sqrt(float(GM).div(r)));
        const k = this.settle.mul(smoothstep(R1 * 1.08, R1 * 1.6, r));
        a.addAssign(vc.sub(v).mul(k));
        a.subAssign(ax.mul(dot(p, ax)).mul(this.settle.mul(0.6)));
        // the Moon gathers what drifts close
        const dm = this.moonPos.sub(p);
        const dl = length(dm);
        const pull = smoothstep(110, 8, dl).mul(this.moonOn).toVar();
        a.addAssign(dm.div(max(dl, 1)).mul(pull.mul(200)));
        a.addAssign(this.moonVel.sub(v).mul(pull.mul(1.2)));
        const v2 = v.add(a.mul(dt)).mul(select(isVap, exp(dt.mul(-0.9)), float(1))).toVar();
        const p2 = p.add(v2.mul(dt)).toVar();
        g.get("vel").assign(v2);
        g.get("pos").assign(p2);
        // cooling (slower once settled in the disk); grains falling into the young Moon heat up again
        const settled = smoothstep(R1 * 1.4, R1 * 1.9, r).mul(this.settle.div(0.7));
        const cool = select(isJet, float(0.24), select(isVap, float(0.3), rnd(i, 12).mul(0.1).add(0.1))).mul(float(1).sub(settled.mul(0.75)));
        g.get("heat").assign(clamp(g.get("heat").sub(cool.mul(dt)).add(pull.mul(0.6).mul(dt)), 0, 1));
        // swallowed by the planet, gone for good, or (vapour) thinned away to nothing
        If(length(p2).lessThan(R1 * 0.995).or(length(p2).greaterThan(4000)).or(isVap.and(age.greaterThan(5))), () => {
          g.get("born").assign(float(-2));
        });
      });
    })().compute(n, [256]);

    // drawing: every grain is a quad reading its own struct
    const i = instanceIndex;
    const g = buf.element(i);
    const pos = g.get("pos");
    const vel = g.get("vel");
    const heat = g.get("heat");
    const born = g.get("born");
    const kind = kindOf(i);
    const isJet = kind.lessThan(0.5);
    const isVap = kind.greaterThan(1.5);
    const age = this.simT.sub(born);
    const size = select(isJet, rnd(i, 30).mul(0.3).add(0.3), select(isVap, rnd(i, 30).mul(6).add(4).mul(min(age, 4).mul(0.8).add(1)), rnd(i, 30).pow(4).mul(1.4).add(0.25)));
    const sprite = spriteVertex({
      center: pos,
      radius: size,
      tail: pos.sub(vel.mul(0.045).mul(T(9))),
      streakKeep: 0.45,
      minPx: 0.8,
      maxPx: 160,
      visible: select(born.greaterThanEqual(0), float(1), float(0)),
    });
    // hot: black-body glow; cold: dark rock catching the sun
    const hot = emberColor(float(1).sub(heat));
    const phase = dot(normalize(cameraPosition.sub(pos)), this.sun).mul(0.5).add(0.5);
    const rock = vec3(0.3, 0.27, 0.25).mul(phase.mul(0.9).add(0.1));
    // grains settled in the disk are spread thin round it: give them more light
    const inDisk = smoothstep(R1 * 1.4, R1 * 1.9, length(pos)).mul(this.settle.div(0.7)).mul(4.5).add(1);
    const grainCol = hot.mul(heat.pow(1.5)).mul(0.022).mul(inDisk).add(rock.mul(float(1).sub(heat).pow(2).mul(0.008)));
    const vapCol = mix(vec3(1, 0.42, 0.12), vec3(1, 0.9, 0.7), heat).mul(heat.pow(2)).mul(0.0025).mul(exp(age.mul(-0.4)));
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = varying(select(isVap, vapCol, grainCol).mul(this.level));
    mat.opacityNode = glowShape(sprite, 0.35).mul(sprite.energy);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    return particleMesh(n, mat, 5);
  }

  /** The young Moon's own glow while it gathers. */
  private buildMoonGlow(): Mesh {
    const sprite = spriteVertex({ center: this.moonPos, radius: float(40), minPx: 2, maxPx: 900 });
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    const r = length(sprite.local);
    mat.colorNode = vec3(1.0, 0.55, 0.25).mul(exp(r.mul(-5)).mul(0.22)).mul(this.moonOn).mul(this.level);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    return particleMesh(1, mat, 6);
  }

  /** The proto-Moon itself: a molten ball that swells as the clump gathers. */
  private buildMoonBody(): Mesh {
    const geo = new SphereGeometry(1, 128, 96);
    const mat = new MeshBasicNodeMaterial();
    mat.colorNode = Fn(() => {
      const n = normalize(normalLocal);
      const nW = normalize(normalWorld);
      const lit = max(dot(nW, this.sun), 0).mul(0.25);
      return this.magma(n.add(5.5), float(0.08)).add(vec3(0.12, 0.1, 0.09).mul(lit)).mul(this.level);
    })();
    return new Mesh(geo, mat);
  }

  /**
   * The protolunar disk's own glow: the hot debris settling into the plane is
   * too fine to resolve, so a ring of light in that plane (wound into spiral
   * wakes by the forming Moon) carries it.
   */
  private buildDiskGlow(): Mesh {
    const geo = new RingGeometry(R1 * 1.25, R_MOON * 1.55, 160, 1);
    const mat = new MeshBasicNodeMaterial();
    const e1 = v3(HIT);
    const e2 = v3(FWD);
    mat.colorNode = Fn(() => {
      const p = positionWorld;
      const x = dot(p, e1);
      const y = dot(p, e2);
      const r = length(vec2(x, y));
      const th = atan(y, x);
      // spiral wakes trailing the Moon, and fine streaks of debris
      const wake = sin(th.mul(2).sub(log(r).mul(9)).add(this.simT.mul(0.6))).mul(0.5).add(0.5);
      const streaks = snoiseGrad(vec3(r.mul(0.08), th.mul(3), 0.5)).w.mul(0.5).add(0.5);
      const radial = smoothstep(R1 * 1.25, R1 * 1.9, r).mul(float(1).sub(smoothstep(R_MOON * 1.1, R_MOON * 1.55, r)));
      const heat = float(1).sub(this.cooling.mul(4)).max(0.2);
      const col = emberColor(float(0.45).sub(heat.mul(0.15)));
      const view = normalize(cameraPosition.sub(p));
      const incl = min(float(1).div(abs(dot(view, v3(AX))).max(0.08)), 4);
      return col.mul(radial).mul(wake.mul(0.6).add(0.4)).mul(streaks.mul(0.8).add(0.2)).mul(incl).mul(this.diskOn).mul(0.05).mul(this.level);
    })();
    mat.side = DoubleSide;
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    const mesh = new Mesh(geo, mat);
    // the ring's plane is the debris plane (AX up)
    mesh.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), AX);
    mesh.renderOrder = 4;
    return mesh;
  }

  /** The young system's debris disk, far off: a broad dusty band across the sky. */
  private buildDust(count: number): Mesh {
    const i = instanceIndex;
    const ax = normalize(vec3(0.3, 1, -0.2));
    const e1 = normalize(cross(ax, vec3(0, 0, 1)));
    const e2 = cross(ax, e1);
    const r = rnd(i, 0).pow(0.6).mul(3500).add(1600);
    const th = rnd(i, 1).mul(Math.PI * 2);
    const h = gauss(i, 2).mul(r.mul(0.045));
    const pos = e1.mul(cos(th)).add(e2.mul(sin(th))).mul(r).add(ax.mul(h));
    // forward scattering: the dust glows toward the sun
    const phase = smoothstep(-0.2, 1.0, dot(normalize(pos.sub(cameraPosition)), this.sun)).pow(3).mul(0.9).add(0.1);
    const lane = snoiseGrad(vec3(cos(th).mul(3), sin(th).mul(3), r.mul(0.002))).w.mul(0.5).add(0.5);
    const sprite = spriteVertex({ center: pos, radius: rnd(i, 3).mul(14).add(6), minPx: 1, maxPx: 120 });
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = varying(mix(vec3(0.55, 0.62, 0.85), vec3(1.0, 0.82, 0.62), lane).mul(phase).mul(lane.mul(1.4).add(0.2)).mul(0.0025).mul(this.level));
    mat.opacityNode = glowShape(sprite, 0).mul(sprite.energy);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    return particleMesh(count, mat, -2);
  }

  /* ------------------------------------------------------------------ */

  enter(ctx: Ctx, t: number) {
    ctx.renderer.compute(this.debrisInit as never);
    this.simTime = 0;
    // seeking: replay the debris from the moment of impact in fixed steps
    if (t > T_HIT) {
      this.simTime = T_HIT - 0.02;
      while (this.simTime < t) this.advance(ctx, Math.min(1 / 60, t - this.simTime));
    } else {
      this.simTime = t;
    }
    this.simT.value = this.simTime;
  }

  private advance(ctx: Ctx, dt: number) {
    this.simTime += dt;
    this.simT.value = this.simTime;
    this.simDt.value = dt;
    this.setForces(this.simTime);
    if (this.simTime > T_HIT - 0.05) ctx.renderer.compute(this.debrisStep as never);
  }

  simulate(ctx: Ctx, t: number, dt: number) {
    if (dt <= 0) return;
    // a few fixed-size substeps so the fast jet integrates stably
    const target = Math.max(t, this.simTime);
    const steps = Math.min(6, Math.max(1, Math.ceil((target - this.simTime) / (1 / 90))));
    const h = (target - this.simTime) / steps;
    if (h <= 0) return;
    for (let k = 0; k < steps; k++) this.advance(ctx, h);
  }

  private setForces(t: number) {
    this.settle.value = ramp(t, T_HIT + 0.8, T_HIT + 4.5) * 0.7;
    const on = ramp(t, T_MOON, T_MOON + 3);
    this.moonOn.value = on;
    const a = W_MOON * t + 0.9;
    const radial = HIT.clone().multiplyScalar(Math.cos(a)).addScaledVector(FWD, Math.sin(a));
    this.moonPos.value.copy(radial).multiplyScalar(R_MOON);
    this.moonVel.value.copy(FWD.clone().multiplyScalar(Math.cos(a)).addScaledVector(HIT, -Math.sin(a))).multiplyScalar(W_MOON * R_MOON);
  }

  update(ctx: Ctx, t: number) {
    this.level.value = 1;
    const tau = t - T_HIT;
    const c = theiaAt(t);
    const s = tau <= 0 ? 1 : Math.pow(1 - ramp(t, T_HIT, T_HIT + 4.8), 0.6);
    this.theia.position.copy(c);
    this.theia.scale.setScalar(Math.max(s, 1e-3));
    this.theia.visible = s > 0.01;
    this.theiaC.value.copy(c);
    this.theiaR.value = R2 * s;
    this.contact.value = ramp(t, T_HIT - 0.25, T_HIT) * (1 - ramp(t, T_HIT + 3, T_HIT + 5.5));
    this.strain.value = ramp(t, 0, T_HIT) ** 2;
    this.melt.value = ramp(t, T_HIT, T_HIT + 1.6);
    this.front.value = tau <= 0 ? 0 : 0.15 + Math.PI * Math.pow(ramp(t, T_HIT, T_HIT + 13), 0.8);
    this.cooling.value = Math.max(0, tau) * 0.008;
    this.coreHeat.value = tau <= 0 ? 0 : pulse(t, T_HIT, 0.15, 3.5);
    this.coreR.value = 0.12 + Math.max(0, tau) * 0.05;
    this.wave.value = Math.max(0, tau) * 0.55;
    this.waveOn.value = tau <= 0 ? 0 : (1 - ramp(t, T_HIT + 2, T_HIT + 6)) * ramp(t, T_HIT, T_HIT + 0.3);
    this.moonGlow.visible = t > T_MOON;
    this.diskOn.value = ramp(t, T_HIT + 4, T_HIT + 9);
    // the Moon's orbit is a closed form, so the body can follow it exactly
    this.setForces(t);
    const grow = ramp(t, T_MOON + 0.8, T_MOON + 6.5);
    this.moonBody.visible = grow > 0.01;
    this.moonBody.position.copy(this.moonPos.value);
    this.moonBody.scale.setScalar(Math.max(1e-3, 19 * Math.pow(grow, 0.6)));
    // the shaking of the hit
    ctx.rig.shake = pulse(t, T_HIT, 0.05, 1.4) * 2.0;
  }

  look(t: number, out: Look) {
    // the contact is blinding: a tight bloom, so the frame does not wash out to grey
    const hit = pulse(t, T_HIT, 0.05, 0.8);
    out.bloom = [0.8 + hit * 0.25, 0.6 - hit * 0.25, 0.9 + hit * 0.6];
    out.exposure = 1.0;
    // the plume is a huge bright area: its lens ghosts (#33) would swamp the frame
    out.flare = t > T_HIT - 0.5 && t < T_HIT + 6 ? 0.03 : 0.12;
    out.dirt = 0.25;
    out.halation = 0.2;
    out.grade = { lift: [0.006, 0.003, 0.002], gamma: [1, 1, 1], gain: [1.03, 0.99, 0.95], saturation: 1.1 };
    out.sky = 0.55;
    out.near = 0.5;
    out.far = 16000;
    out.focus = 400;
    out.aperture = 0;
    // a short blink on contact (a long one only lifts the blacks into a beige fog)
    out.flash = (1 - ramp(t, 0, 0.8)) * 1.0 + pulse(t, T_HIT, 0.02, 0.045) * 0.7;
    out.flashColor = [1.0, 0.9, 0.78];
    // #14 a two-frame impact frame on contact
    out.impact = t >= T_HIT && t < T_HIT + 0.07 ? 1 : 0;
    out.warp = ramp(t, 24.8, 26) * 0.5;
  }
}
