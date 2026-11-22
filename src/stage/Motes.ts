/**
 * Motes — the particles of the old hub, come to live over the water.
 *
 * Up to 409,600 sprites simulated by TSL compute shaders (WebGPU, or WebGL2
 * through transform feedback). Left alone they are dust in the last light
 * and fireflies after dark, drifting in a block of air that follows the
 * camera. Called, they fly to a target — a texel of a cover image or of a
 * rasterised word — so pictures assemble out of light and scatter again.
 *
 * Backend constraints baked into the layout (unchanged from the old field):
 * - WebGL2 transform feedback allows 4 separate buffers per pass, so the
 *   whole state is 4 × vec4 (A pos+switchAt, B vel+weight, C colour+packed
 *   target colour, D target+oldWeight);
 * - storage writes are always whole-element (a.w = x is lost on WebGPU);
 * - swizzle assignments are split per component, so every intermediate is a
 *   variable (`toVar`).
 */
import {
  AddEquation,
  Color,
  CustomBlending,
  OneFactor,
  Sprite,
  SpriteNodeMaterial,
  SrcAlphaFactor,
  Vector2,
  Vector3,
  ZeroFactor,
} from "three/webgpu";
import type { Scene } from "three/webgpu";
import {
  Fn,
  abs,
  cameraPosition,
  clamp,
  cross,
  dot,
  exp,
  float,
  hash,
  instanceIndex,
  instancedArray,
  length,
  luminance,
  max,
  mix,
  modelViewMatrix,
  mx_noise_vec3,
  normalize,
  pow,
  select,
  sin,
  smoothstep,
  step,
  texture,
  uint,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from "./tsl";
import type { N } from "./tsl";
import { TargetPainter } from "./targets";

/** A flat picture in the world for the motes to gather into. */
export interface MoteTarget {
  /** Unique key; the same key only relays out (no burst). */
  key: string;
  /** Aspect of the painted content and where it sits in the painter. */
  aspect: number;
  uvScale: [number, number];
  center: Vector3;
  right: Vector3;
  up: Vector3;
  /** World width of the formation (its height follows from the aspect). */
  width: number;
  lumLow?: number;
  lumHigh?: number;
  /** How far bright texels stand off the plane, and the plane's thickness. */
  relief?: number;
  thickness?: number;
  tint?: Color;
  /** Brightness of the gathered picture (1 = about as bright as its source). */
  gain?: number;
  feather?: number;
  /** Seconds over which motes set off: at random, and swept left to right. */
  delayRand?: number;
  delaySweep?: number;
  /** Fraction of the formation area that is bright (binds motes). */
  cover?: number;
}

export interface MotesHost {
  scene: Scene;
  /** Radians per device pixel at the centre of the frame. */
  pixelAngle: () => number;
}

/** The block of air the free motes live in (metres); it follows the camera. */
const BOX = new Vector3(60, 6.4, 60);
const BOX_Y = 3.3;

export class Motes {
  readonly count: number;
  readonly grid: [number, number];
  readonly painter = new TargetPainter();

  private host: MotesHost;
  private sprite!: Sprite;
  private material!: SpriteNodeMaterial;
  private simNode: unknown;
  private retargetNode: unknown;
  private coverTex = texture(this.painter.texture);

  private pendingRetarget = false;
  private retargetKind: "switch" | "relayout" = "switch";
  private current: MoteTarget | null = null;
  private currentLayoutKey = "";
  private formedGoal = 0;
  private formedScale = 1;
  private formedValue = 0;
  private gain = 1;
  private coverFrac = 0.3;
  private delayRand = 0.55;
  private delaySweep = 0.45;
  private calm = 1;
  private formationDistance = 10;

  // simulation
  private uTime = uniform(0);
  private uDt = uniform(1 / 60);
  private uFormed = uniform(0);
  private uBoxCenter = uniform(new Vector3(0, BOX_Y, 0));
  private uFlow = uniform(new Vector3(0.16, 0.012, 0.09));
  private uBreathe = uniform(0.03);
  private uStiffness = uniform(26);
  private uTurbulence = uniform(0.5);
  private uDampFree = uniform(0.9);
  private uDampFormed = uniform(7.5);
  private uMaxFree = uniform(3.2);
  private uMaxBound = uniform(30);
  private uRayO = uniform(new Vector3());
  private uRayD = uniform(new Vector3(0, 0, -1));
  private uPointerStrength = uniform(0);
  private uPointerPush = uniform(24);
  private uPointerSwirl = uniform(16);
  private uBurst = uniform(2.6);
  private uStir = uniform(0);
  // a wave of gathering that can travel across the picture (see setWave)
  private uWaveAmp = uniform(0);
  private uWavePos = uniform(-2);
  private uWaveWidth = uniform(0.12);

  // retarget
  private uCenter = uniform(new Vector3());
  private uRight = uniform(new Vector3(1, 0, 0));
  private uUp = uniform(new Vector3(0, 1, 0));
  private uNormal = uniform(new Vector3(0, 0, 1));
  private uWidth = uniform(4);
  private uHeight = uniform(3);
  private uLumLow = uniform(0.05);
  private uLumHigh = uniform(0.35);
  private uRelief = uniform(0.08);
  private uThickness = uniform(0.1);
  private uTint = uniform(new Color(1, 1, 1));
  private uSwitchBase = uniform(0);
  private uDelayRand = uniform(0.55);
  private uDelaySweep = uniform(0.45);
  private uFeather = uniform(0.05);
  private uUvScale = uniform(new Vector2(1, 1));
  private uRows = uniform(512);

  // look
  private uWorldSize = uniform(0.024);
  private uPixelAngle = uniform(0.001);
  private uMinPx = uniform(1.25);
  private uFocus = uniform(10);
  private uBokeh = uniform(0.014);
  private uIntensityBound = uniform(0.2);
  private uDust = uniform(new Vector3(1, 0.7, 0.4));
  private uSpark = uniform(new Vector3(1, 0.8, 0.45));
  private uDustGain = uniform(0.08);
  private uSparkGain = uniform(0.7);
  private uSparkFrac = uniform(0.008);
  private uSunDir = uniform(new Vector3(0, 0.05, -1));
  private uSunBoost = uniform(10);
  private uBlink = uniform(1);
  private uFlight = uniform(2.2);
  private uTwinkle = uniform(0.6);
  /** Size of a mote on screen once it has reached its picture (pixels). */
  private uSpritePx = uniform(2);
  /** How much larger a mote is drawn in the water's mirror pass (see setMirror). */
  private uMirrorGrow = uniform(3);

  constructor(host: MotesHost, grid: [number, number]) {
    this.host = host;
    this.grid = grid;
    this.count = grid[0] * grid[1];
    this.uRows.value = grid[1];
    this.build();
    // First pass against the (still black) painter: every mote gets zero
    // weight, so the air is alive before any target arrives.
    this.retargetKind = "relayout";
    this.pendingRetarget = true;
  }

  /* ------------------------------------------------------------------ */
  /* shaders                                                             */
  /* ------------------------------------------------------------------ */

  private build() {
    const count = this.count;
    const [W] = this.grid;

    const initialA = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      initialA[i * 4] = (Math.random() - 0.5) * BOX.x;
      initialA[i * 4 + 1] = BOX_Y + (Math.random() - 0.5) * BOX.y;
      initialA[i * 4 + 2] = (Math.random() - 0.5) * BOX.z;
      initialA[i * 4 + 3] = -1; // switchAt in the past
    }
    const bufA = instancedArray(initialA, "vec4");
    const bufB = instancedArray(count, "vec4");
    const bufC = instancedArray(count, "vec4");
    const bufD = instancedArray(count, "vec4");

    const {
      uTime,
      uDt,
      uFormed,
      uBoxCenter,
      uFlow,
      uBreathe,
      uStiffness,
      uTurbulence,
      uDampFree,
      uDampFormed,
      uMaxFree,
      uMaxBound,
      uRayO,
      uRayD,
      uPointerStrength,
      uPointerPush,
      uPointerSwirl,
      uBurst,
      uStir,
      uWaveAmp,
      uWavePos,
      uWaveWidth,
      uCenter,
      uRight,
      uUp,
      uNormal,
      uWidth,
      uHeight,
      uLumLow,
      uLumHigh,
      uRelief,
      uThickness,
      uTint,
      uSwitchBase,
      uDelayRand,
      uDelaySweep,
      uFeather,
      uUvScale,
      uRows,
      coverTex,
    } = this;
    const box = vec3(BOX.x, BOX.y, BOX.z);

    // How firmly the mote whose place is `goal` is held: the overall hold,
    // plus a wave that can travel across the picture from left to right.
    const formedAt = (goal: N) => {
      const along = dot(goal.sub(uCenter), uRight).div(uWidth);
      const x = along.sub(uWavePos).div(uWaveWidth);
      return clamp(uFormed.add(uWaveAmp.mul(exp(x.mul(x).negate()))), 0, 1);
    };

    // Colours ride in one float: 3 × 8 bit over a 0..2 range (exact in fp32).
    const packColor = Fn(([c]: [N]) => {
      const q = clamp(c.mul(0.5), 0, 1).mul(255).floor();
      return q.x.mul(65536).add(q.y.mul(256)).add(q.z);
    });
    const unpackColor = Fn(([p]: [N]) => {
      const r = p.div(65536).floor();
      const rest = p.sub(r.mul(65536));
      const g = rest.div(256).floor();
      const b = rest.sub(g.mul(256));
      return vec3(r, g, b).div(255).mul(2);
    });

    // Curl of a 3D Perlin field (forward differences, 4 noise evaluations).
    const curl = Fn(([p]: [N]) => {
      const e = float(0.12);
      const n0 = mx_noise_vec3(p);
      const nx = mx_noise_vec3(p.add(vec3(e, 0, 0)));
      const ny = mx_noise_vec3(p.add(vec3(0, e, 0)));
      const nz = mx_noise_vec3(p.add(vec3(0, 0, e)));
      const x = ny.z.sub(n0.z).sub(nz.y.sub(n0.y));
      const y = nz.x.sub(n0.x).sub(nx.z.sub(n0.z));
      const z = nx.y.sub(n0.y).sub(ny.x.sub(n0.x));
      return vec3(x, y, z).div(e);
    });

    /* --------------------------- retarget --------------------------- */
    this.retargetNode = Fn(() => {
      const i = instanceIndex;
      const a = bufA.element(i);
      const b = bufB.element(i);
      const c = bufC.element(i);
      const d = bufD.element(i);

      const col = i.mod(uint(W)).toFloat();
      const row = i.div(uint(W)).toFloat();
      const jitter = vec2(hash(i.add(uint(1))), hash(i.add(uint(7))));
      const uvp = vec2(col.add(jitter.x).div(float(W)), row.add(jitter.y).div(uRows));
      const texel = coverTex.sample(uvp.mul(uUvScale));
      const lum = luminance(texel.rgb);
      const fe = uFeather.max(0.002);
      const feather = smoothstep(float(0), fe, uvp.x)
        .mul(float(1).sub(smoothstep(float(1).sub(fe), float(1), uvp.x)))
        .mul(smoothstep(float(0), fe, uvp.y))
        .mul(float(1).sub(smoothstep(float(1).sub(fe), float(1), uvp.y)));
      const weight = smoothstep(uLumLow, uLumHigh, lum).mul(feather);
      const depth = lum
        .sub(0.5)
        .mul(uRelief)
        .add(hash(i.add(uint(13))).sub(0.5).mul(uThickness));
      const posT = uCenter
        .add(uRight.mul(uvp.x.sub(0.5).mul(uWidth)))
        .add(uUp.mul(uvp.y.sub(0.5).mul(uHeight)))
        .add(uNormal.mul(depth));
      const delay = hash(i.add(uint(3))).mul(uDelayRand).add(uvp.x.mul(uDelaySweep));

      const oldWeight = b.w.toVar();
      const packed = packColor(texel.rgb.mul(uTint)).toVar();
      const switchAt = uSwitchBase.add(delay).toVar();
      const w = weight.toVar();
      const posNow = a.xyz.toVar();
      const velNow = b.xyz.toVar();
      const colNow = c.xyz.toVar();

      d.assign(vec4(posT, oldWeight));
      a.assign(vec4(posNow, switchAt));
      b.assign(vec4(velNow, w));
      c.assign(vec4(colNow, packed));
    })().compute(count);

    /* --------------------------- simulate --------------------------- */
    this.simNode = Fn(() => {
      const i = instanceIndex;
      const a = bufA.element(i);
      const b = bufB.element(i);
      const c = bufC.element(i);
      const d = bufD.element(i);
      const pos = a.xyz.toVar();
      const vel = b.xyz.toVar();
      const col = c.xyz.toVar();
      const switchAt = a.w.toVar();
      const weightRaw = b.w.toVar();
      const packedRaw = c.w.toVar();
      const goal = d.xyz.toVar();

      const switched = uTime.greaterThanEqual(switchAt);
      const gate = hash(i.add(uint(71))).mul(0.9);
      const held = smoothstep(gate, gate.add(0.1), formedAt(goal)).toVar();
      const weight = select(switched, weightRaw, float(0)).mul(held).toVar();
      const hold = select(switched, float(0), d.w).mul(held).toVar();
      const bound = weight.max(hold).toVar();
      const free = float(1).sub(bound).toVar();

      const breathe = mx_noise_vec3(
        goal.mul(0.7).add(vec3(uTime.mul(0.11), uTime.mul(0.07), 0)),
      ).mul(uBreathe);
      const spring = goal.add(breathe).sub(pos).mul(uStiffness).mul(weight).toVar();

      // the air itself: slow curl, a little wind, stirred when the walk moves
      const turbAmt = uTurbulence.mul(mix(float(1), float(0.05), bound)).add(uStir).toVar();
      const flow = curl(pos.mul(0.21).add(vec3(0.05, 0.02, 0.035).mul(uTime)))
        .mul(turbAmt)
        .toVar();

      // the pointer is a ray through the scene: motes near it are pushed off
      // the line of sight and sent round it
      const rel = pos.sub(uRayO).toVar();
      const along = dot(rel, uRayD).toVar();
      const perp = rel.sub(uRayD.mul(along)).toVar();
      const r = length(perp).toVar();
      const reach = along.mul(0.045).add(0.35);
      const infl = smoothstep(float(0), reach, r)
        .oneMinus()
        .mul(uPointerStrength)
        .mul(smoothstep(0.2, 1.2, along))
        .mul(float(1).sub(smoothstep(45, 75, along)));
      const dir = perp.div(r.add(0.02)).toVar();
      const repel = dir
        .mul(infl.mul(uPointerPush))
        .add(cross(uRayD, dir).mul(infl.mul(uPointerSwirl)))
        .toVar();

      const justSwitched = switched.and(uTime.sub(switchAt).lessThan(uDt));
      const burstDir = normalize(
        vec3(
          hash(i.add(uint(21))).sub(0.5),
          hash(i.add(uint(33))).sub(0.5),
          hash(i.add(uint(45))).sub(0.5),
        ),
      );
      const burst = select(
        justSwitched,
        burstDir.mul(uBurst).mul(hash(i.add(uint(57))).add(0.3)),
        vec3(0),
      ).toVar();

      const acc = spring.add(flow).add(repel).add(uFlow.mul(free)).toVar();
      const v1 = vel.add(acc.mul(uDt)).add(burst).toVar();
      const damp = exp(uDt.negate().mul(mix(uDampFree, uDampFormed, bound)));
      const v2 = v1.mul(damp).toVar();
      const spd = length(v2).toVar();
      const limit = mix(uMaxFree, uMaxBound, bound).toVar();
      const newVel = select(spd.greaterThan(limit), v2.mul(limit.div(spd.max(1e-5))), v2).toVar();
      const moved = pos.add(newVel.mul(uDt)).toVar();

      // Free motes wrap round a block of air that travels with the camera,
      // so the walk never runs out of them. A mote still on its way to or
      // from a picture is left alone (it fades where it is before wrapping).
      const local = moved.sub(uBoxCenter).toVar();
      const wrapped = uBoxCenter.add(local.sub(local.div(box).add(0.5).floor().mul(box))).toVar();
      const newPos = select(bound.lessThan(0.02), wrapped, moved).toVar();

      const colRate = float(1).sub(exp(uDt.negate().mul(3.5)));
      const newCol = mix(col, unpackColor(packedRaw), colRate).toVar();
      a.assign(vec4(newPos, switchAt));
      b.assign(vec4(newVel, weightRaw));
      c.assign(vec4(newCol, packedRaw));
    })().compute(count);

    /* ---------------------------- render ---------------------------- */
    const material = new SpriteNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = true;
    // Light added to light, and no alpha written: the water's mirror pass
    // reads alpha as "something solid stands here", and a mote is not solid.
    material.blending = CustomBlending;
    material.blendEquation = AddEquation;
    material.blendSrc = SrcAlphaFactor;
    material.blendDst = OneFactor;
    material.blendSrcAlpha = ZeroFactor;
    material.blendDstAlpha = OneFactor;
    material.fog = false;

    const posAttr = bufA.toAttribute().xyz;
    const colAttr = bufC.toAttribute().xyz;
    const velAttr = bufB.toAttribute().xyz;
    const weightAttr = bufB.toAttribute().w;
    const goalAttr = bufD.toAttribute().xyz;
    material.positionNode = posAttr;

    const seed = instanceIndex;
    const viewPos = modelViewMatrix.mul(vec4(posAttr, 1)).xyz;
    const depth = max(viewPos.z.negate(), 0.05);
    const gate = hash(seed.add(uint(71))).mul(0.9);
    const bound = clamp(weightAttr, 0, 1).mul(smoothstep(gate, gate.add(0.1), formedAt(goalAttr)));

    // size: a real size in the world, never below a pixel or so; out of
    // focus a mote opens into a soft disc (and thins out accordingly)
    const sizeVar = hash(seed.add(uint(99))).mul(0.9).add(0.55);
    const base = this.uWorldSize.mul(sizeVar);
    const pixel = depth.mul(this.uPixelAngle);
    const seen = max(base, pixel.mul(this.uMinPx));
    // The water's mirror is drawn smaller than the frame, from a camera under
    // the surface. A point of light finer than its texels turns into blocks
    // there, so in that pass a mote is drawn wider and as much dimmer.
    const mirrored = step(cameraPosition.y, 0);
    const sharp = max(seen, pixel.mul(this.uMinPx).mul(this.uMirrorGrow).mul(mirrored));
    const widened = seen.div(sharp);
    const blur = this.uBokeh
      .mul(abs(float(1).div(depth).sub(float(1).div(this.uFocus))))
      .mul(depth)
      .mul(2)
      .mul(bound.oneMinus())
      .min(0.55);
    const size = sharp.add(blur);
    material.scaleNode = size;

    // a mote too small to draw keeps its energy by dimming instead
    const subPixel = clamp(base.div(pixel.mul(this.uMinPx)), 0, 1);
    const spread = sharp.div(size);
    const energy = spread
      .mul(spread)
      .mul(widened.mul(widened))
      .mul(mix(subPixel.mul(subPixel), float(1), bound));

    // free motes: mostly dust, a few sparks that pulse like fireflies
    const pick = hash(seed.add(uint(101)));
    const spark = smoothstep(float(1).sub(this.uSparkFrac).sub(0.002), float(1).sub(this.uSparkFrac), pick);
    const phase = hash(seed.add(uint(211))).mul(6.2832);
    const pace = hash(seed.add(uint(307))).mul(1.1).add(0.6);
    const pulse = pow(sin(this.uTime.mul(pace).add(phase)).mul(0.5).add(0.5), 3)
      .mul(this.uBlink)
      .add(float(1).sub(this.uBlink).mul(0.5));
    const toMote = normalize(posAttr.sub(cameraPosition));
    const backlit = pow(max(dot(toMote, this.uSunDir), 0), 26).mul(this.uSunBoost).add(1);
    const dust = this.uDust.mul(this.uDustGain).mul(backlit);
    const glow = this.uSpark.mul(this.uSparkGain).mul(pulse.mul(0.9).add(0.1));
    // the block of air has no walls: motes fade toward its faces, and right
    // in front of the lens
    const local = posAttr.sub(this.uBoxCenter).div(box.mul(0.5)).abs();
    const inside = smoothstep(0.8, 1.0, local.x)
      .oneMinus()
      .mul(smoothstep(0.8, 1.0, local.z).oneMinus())
      .mul(smoothstep(0.84, 1.0, local.y).oneMinus())
      .mul(smoothstep(0.3, 1.1, depth));
    const freeColour = mix(dust, glow, spark).mul(inside);
    // a gathered picture is made of points that differ: a few brilliant,
    // most quiet; and a mote on its way there burns brighter the faster it flies
    const glint = pow(hash(seed.add(uint(401))), 3).mul(2.6).add(0.35);
    const flight = smoothstep(2.5, 18, length(velAttr)).mul(this.uFlight).add(1);
    // ... and each point shimmers in its own time (mean 1)
    const twinkle = mix(float(1), pulse.mul(1.6).add(0.5), this.uTwinkle);
    // The picture's brightness is set for motes at the picture's distance.
    // One still on its way, close to the lens, is drawn larger: it keeps its
    // light, not its brightness, or the flight in would white the frame out.
    const near = clamp(this.uSpritePx.div(seen.div(pixel)), 0, 1);
    const picture = colAttr
      .mul(this.uIntensityBound)
      .mul(glint)
      .mul(flight)
      .mul(twinkle)
      .mul(near.mul(near));
    const colour = mix(freeColour, picture, bound).mul(energy);

    const softV = varying(clamp(blur.div(sharp), 0, 1));
    const colV = varying(colour);
    const dd = uv().sub(0.5).length().mul(2);
    const core = float(1).sub(smoothstep(float(0), float(1), dd));
    material.colorNode = vec4(colV, 1);
    material.opacityNode = pow(core, mix(float(2.4), float(0.7), softV));

    const sprite = new Sprite(material);
    sprite.count = count;
    sprite.frustumCulled = false;
    sprite.renderOrder = 200;
    this.host.scene.add(sprite);
    this.sprite = sprite;
    this.material = material;
  }

  /* ------------------------------------------------------------------ */
  /* API                                                                 */
  /* ------------------------------------------------------------------ */

  /** Gather into a target (a new key bursts, the same key only relays out). */
  setTarget(spec: MoteTarget) {
    this.formedGoal = 1;
    const same = this.current?.key === spec.key;
    this.current = spec;
    this.queueRetarget(same ? "relayout" : "switch");
  }

  /** Let everything go back to the air. */
  scatter() {
    this.formedGoal = 0;
  }

  get target() {
    return this.current;
  }

  /** 0..1 multiplier on how firmly the picture is held. */
  setFormedScale(v: number) {
    this.formedScale = Math.max(0, Math.min(1, v));
  }

  /**
   * A wave of gathering across the picture: motes whose place lies near
   * `position` (-0.5 at its left edge, 0.5 at its right) are held `amount`
   * more firmly than the rest. `width` is the wave's, as a share of the
   * picture's.
   */
  setWave(amount: number, position = 0, width = 0.12) {
    this.uWaveAmp.value = Math.max(0, amount);
    this.uWavePos.value = position;
    this.uWaveWidth.value = Math.max(0.01, width);
  }

  /**
   * The water's mirror pass is drawn at `scale` of the frame's resolution:
   * there a mote is at least a couple of its texels wide.
   */
  setMirror(scale: number) {
    this.uMirrorGrow.value = Math.max(1, 2.4 / (Math.max(0.1, scale) * this.uMinPx.value));
  }

  /** The pointer as a ray through the scene, and how much it stirs. */
  setPointer(origin: Vector3, direction: Vector3, strength: number) {
    this.uRayO.value.copy(origin);
    this.uRayD.value.copy(direction);
    this.uPointerStrength.value = strength;
  }

  /** Extra turbulence while the walk is moving. */
  setStir(v: number) {
    this.uStir.value = v;
  }

  /**
   * The free motes take their colours from the hour: warm dust that flares
   * against the low sun, then fireflies once it is dark (`night` 0..1).
   */
  setAmbient(night: number, sunDirection: Vector3, warm: Vector3) {
    const n = Math.max(0, Math.min(1, night));
    const peak = Math.max(warm.x, warm.y, warm.z, 1e-3);
    this.uDust.value.set(
      (warm.x / peak) * (1 - n) + 0.42 * n,
      (warm.y / peak) * (1 - n) + 0.52 * n,
      (warm.z / peak) * (1 - n) + 0.74 * n,
    );
    this.uSpark.value.set(1 - 0.34 * n, 0.78 + 0.22 * n, 0.44 - 0.1 * n);
    this.uDustGain.value = 0.05 * (1 - n) + 0.028 * n;
    this.uSparkGain.value = 0.6 + 0.75 * n;
    this.uSparkFrac.value = 0.005 + 0.007 * n;
    this.uSunBoost.value = 11 * (1 - n) * Math.max(0, Math.min(1, (sunDirection.y + 0.08) / 0.1));
    this.uSunDir.value.copy(sunDirection);
  }

  setReducedMotion(reduced: boolean) {
    this.uTurbulence.value = reduced ? 0.16 : 0.5;
    this.uBreathe.value = reduced ? 0.01 : 0.03;
    this.uPointerPush.value = reduced ? 9 : 24;
    this.uPointerSwirl.value = reduced ? 4 : 16;
    this.uBurst.value = reduced ? 0.5 : 2.6;
    this.calm = reduced ? 0.55 : 1;
    this.uBlink.value = reduced ? 0.3 : 1;
  }

  /** The lens: where it is focused (metres). */
  setFocus(distance: number) {
    this.uFocus.value = Math.max(1, distance);
  }

  private queueRetarget(kind: "switch" | "relayout") {
    const spec = this.current;
    if (!spec) return;
    const c = spec.center;
    const layoutKey = `${spec.key}|${c.x.toFixed(2)}|${c.y.toFixed(2)}|${c.z.toFixed(2)}|${spec.width.toFixed(2)}|${spec.right.x.toFixed(3)}|${spec.right.z.toFixed(3)}`;
    if (kind === "relayout" && layoutKey === this.currentLayoutKey) return;
    this.currentLayoutKey = layoutKey;
    this.uUvScale.value.set(spec.uvScale[0], spec.uvScale[1]);
    this.uWidth.value = spec.width;
    this.uHeight.value = spec.width / spec.aspect;
    this.uCenter.value.copy(c);
    this.uRight.value.copy(spec.right);
    this.uUp.value.copy(spec.up);
    this.uNormal.value.crossVectors(spec.right, spec.up).normalize();
    this.uLumLow.value = spec.lumLow ?? 0.05;
    this.uLumHigh.value = spec.lumHigh ?? 0.35;
    this.uRelief.value = spec.relief ?? 0.08;
    this.uThickness.value = spec.thickness ?? 0.1;
    this.uTint.value.copy(spec.tint ?? new Color(1, 1, 1));
    this.uFeather.value = spec.feather ?? 0.05;
    this.gain = spec.gain ?? 1;
    this.coverFrac = spec.cover ?? 0.3;
    this.delayRand = spec.delayRand ?? 0.55;
    this.delaySweep = spec.delaySweep ?? 0.45;
    this.retargetKind = kind;
    this.pendingRetarget = true;
  }

  /**
   * Brightness of a gathered picture follows how many motes land on each
   * of its pixels, so it reads the same at any size, distance or count.
   */
  private applyDensity() {
    const spec = this.current;
    if (!spec) return;
    const pixelAngle = Math.max(1e-6, this.uPixelAngle.value);
    const pxPerMetre = 1 / (Math.max(1, this.formationDistance) * pixelAngle);
    const spritePx = Math.max(this.uWorldSize.value * pxPerMetre, this.uMinPx.value);
    const areaPx =
      Math.max(0.5, this.uWidth.value * pxPerMetre) * Math.max(0.5, this.uHeight.value * pxPerMetre);
    const boundCount = this.count * Math.max(0.02, this.coverFrac);
    // sprites per pixel, by their square size; a sprite's disc covers 0.785
    // of that square at a mean opacity of 0.144, hence the 8.8
    const density = (boundCount * spritePx * spritePx) / areaPx;
    this.uSpritePx.value = spritePx;
    this.uIntensityBound.value = Math.min(3.2, (this.gain * 8.8) / Math.max(0.4, density));
  }

  /** Advance one frame; call before rendering. */
  update(
    renderer: { compute: (node: never) => unknown },
    time: number,
    dt: number,
    camera: { position: Vector3 },
    forward: Vector3,
  ) {
    this.uTime.value = time;
    this.uDt.value = dt;
    this.uPixelAngle.value = this.host.pixelAngle();
    // the block of air sits a little ahead of the camera
    this.uBoxCenter.value.set(
      camera.position.x + forward.x * 15,
      BOX_Y,
      camera.position.z + forward.z * 15,
    );
    const goal = this.formedGoal * this.formedScale;
    const k = 1 - Math.exp(-dt * (goal > this.formedValue ? 2.2 : 3.2));
    this.formedValue += (goal - this.formedValue) * k;
    this.uFormed.value = this.formedValue;
    if (this.current) {
      this.formationDistance = camera.position.distanceTo(this.current.center);
      this.applyDensity();
    }

    if (this.pendingRetarget) {
      this.pendingRetarget = false;
      const sweep = this.retargetKind === "switch";
      this.uSwitchBase.value = sweep ? time : time - 1;
      // a relayout moves the picture at once; a new picture sets off in waves
      this.uDelayRand.value = sweep ? this.delayRand * this.calm : 0;
      this.uDelaySweep.value = sweep ? this.delaySweep * this.calm : 0;
      renderer.compute(this.retargetNode as never);
    }
    renderer.compute(this.simNode as never);
  }

  get formed() {
    return this.formedValue;
  }

  dispose() {
    this.material.dispose();
    this.host.scene.remove(this.sprite);
  }
}
