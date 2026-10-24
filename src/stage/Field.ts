/**
 * Field — the GPU particle system of UNFILED.
 *
 * Up to 1,048,576 sprites simulated by TSL compute shaders (WebGPU, or WebGL2
 * through transform feedback). Free particles live in a long tube of dust
 * around the camera axis and stream past the viewer as the archive moves;
 * bound particles are pulled to a target — a texel of a cover image or of a
 * rasterised word — so pictures assemble out of dust and dissolve back.
 *
 * Backend constraints baked into the layout:
 * - WebGL2 transform feedback allows 4 separate buffers per pass, so the
 *   whole state is 4 × vec4 (A pos+switchAt, B vel+weight, C colour+packed
 *   target colour, D target+oldWeight);
 * - storage writes are always whole-element (a.w = x is lost on WebGPU);
 * - swizzle assignments are split per component, so every intermediate is a
 *   variable (`toVar`).
 */
import type { Node, PerspectiveCamera, Scene } from "three/webgpu";
import {
  AdditiveBlending,
  Color,
  Sprite,
  SpriteNodeMaterial,
  Vector2,
  Vector3,
} from "three/webgpu";
import {
  Fn,
  abs,
  clamp,
  exp,
  float,
  hash,
  instanceIndex,
  instancedArray,
  length,
  luminance,
  mix,
  modelViewMatrix,
  mx_noise_vec3,
  normalize,
  pow,
  select,
  smoothstep,
  texture,
  uint,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { TargetPainter } from "./targets";

export interface FieldTarget {
  /** Unique key; the same key only relayouts (no burst). */
  key: string;
  aspect: number;
  uvScale: [number, number];
  center: [number, number, number];
  /** World height of the formation. */
  height: number;
  lumLow?: number;
  lumHigh?: number;
  relief?: number;
  thickness?: number;
  tint?: Color;
  gain?: number;
  feather?: number;
  /** Fraction of the formation area that is bright (binds particles). */
  cover?: number;
}

export interface FieldHost {
  scene: Scene;
  camera: PerspectiveCamera;
  /** Device pixels per world unit at the focus plane (for sprite sizing). */
  pixelsPerUnit: () => number;
}

/** Depth extent of the dust tube: particles wrap between these z values. */
export const TUBE_FRONT = 10.5;
export const TUBE_BACK = -34;
const TUBE_LENGTH = TUBE_FRONT - TUBE_BACK;

export class Field {
  readonly count: number;
  readonly grid: [number, number];
  readonly painter = new TargetPainter();
  activeCount = 0;

  private host: FieldHost;
  private sprite!: Sprite;
  private material!: SpriteNodeMaterial;
  private simNode: unknown;
  private retargetNode: unknown;
  private coverTex = texture(this.painter.texture);
  buffers: Record<string, { value: unknown }> = {};

  private pendingRetarget = false;
  private retargetKind: "switch" | "relayout" = "switch";
  private current: FieldTarget | null = null;
  private currentLayoutKey = "";
  private formedGoal = 0;
  private formedScale = 1;
  private formedValue = 0;
  private gain = 1;
  private reduced = false;

  // simulation uniforms
  private uTime = uniform(0);
  private uDt = uniform(1 / 60);
  private uFormed = uniform(0);
  private uOffset = uniform(new Vector3());
  private uFlow = uniform(new Vector3());
  private uBreathe = uniform(0.035);
  private uStiffness = uniform(26);
  private uTurbulence = uniform(1.1);
  private uNoiseScale = uniform(0.42);
  private uDampFree = uniform(0.9);
  private uDampFormed = uniform(7.5);
  private uMaxSpeed = uniform(9);
  private uPointer = uniform(new Vector3());
  private uPointerRadius = uniform(1.6);
  private uPointerStrength = uniform(0);
  private uPointerPush = uniform(26);
  private uPointerSwirl = uniform(18);
  private uBurst = uniform(3.2);
  private uContain = uniform(0.05);
  private uTubeRadius = uniform(7);
  private uDrift = uniform(new Vector3(0.12, 0.05, 0.08));
  private uScrollKick = uniform(0);

  // retarget uniforms
  private uAspect = uniform(1.5);
  private uHeight = uniform(3);
  private uCenter = uniform(new Vector3());
  private uLumLow = uniform(0.05);
  private uLumHigh = uniform(0.35);
  private uRelief = uniform(0.35);
  private uThickness = uniform(0.25);
  private uTint = uniform(new Color(1, 1, 1));
  private uSwitchBase = uniform(0);
  private uDelayRand = uniform(0.55);
  private uDelaySweep = uniform(0.45);
  private uFeather = uniform(0.05);
  private uUvScale = uniform(new Vector2(1, 1));
  private uRows = uniform(1024);

  // render uniforms
  private uBaseSize = uniform(0.01);
  private uFocus = uniform(10);
  private uBokeh = uniform(0.85);
  private uIntensityFree = uniform(0.4);
  private uIntensityBound = uniform(0.2);
  private coverFrac = 0.3;

  constructor(host: FieldHost, grid: [number, number]) {
    this.host = host;
    this.grid = grid;
    this.count = grid[0] * grid[1];
    this.build();
    this.setActiveCount(this.count);
    // First pass against the (still black) painter: every particle gets its
    // ambient colour and zero weight, so the dust is visible before any
    // target arrives.
    this.retargetKind = "relayout";
    this.pendingRetarget = true;
  }

  /* ------------------------------------------------------------------ */
  /* shaders                                                             */
  /* ------------------------------------------------------------------ */

  private build() {
    const count = this.count;
    const [W] = this.grid;

    // Initial state: dust filling the tube so the first formation visibly
    // condenses out of it.
    const initialA = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const r = Math.sqrt(Math.random()) * 7.5;
      const theta = Math.random() * Math.PI * 2;
      initialA[i * 4] = r * Math.cos(theta) * 1.4;
      initialA[i * 4 + 1] = r * Math.sin(theta) * 0.8;
      initialA[i * 4 + 2] = TUBE_BACK + Math.random() * TUBE_LENGTH;
      initialA[i * 4 + 3] = -1; // switchAt in the past
    }
    const bufA = instancedArray(initialA, "vec4");
    const bufB = instancedArray(count, "vec4");
    const bufC = instancedArray(count, "vec4");
    const bufD = instancedArray(count, "vec4");
    this.buffers = { pos: bufA, vel: bufB, col: bufC, tgt: bufD } as unknown as Record<
      string,
      { value: unknown }
    >;

    const {
      uTime,
      uDt,
      uFormed,
      uOffset,
      uFlow,
      uBreathe,
      uStiffness,
      uTurbulence,
      uNoiseScale,
      uDampFree,
      uDampFormed,
      uMaxSpeed,
      uPointer,
      uPointerRadius,
      uPointerStrength,
      uPointerPush,
      uPointerSwirl,
      uBurst,
      uContain,
      uTubeRadius,
      uDrift,
      uScrollKick,
      uAspect,
      uHeight,
      uCenter,
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

    // Colours ride in one float: 3 × 8 bit over a 0..2 range (exact in fp32).
    const packColor = Fn(([c]: [Node<"vec3">]) => {
      const q = clamp(c.mul(0.5), 0, 1).mul(255).floor();
      return q.x.mul(65536).add(q.y.mul(256)).add(q.z);
    });
    const unpackColor = Fn(([p]: [Node<"float">]) => {
      const r = p.div(65536).floor();
      const rest = p.sub(r.mul(65536));
      const g = rest.div(256).floor();
      const b = rest.sub(g.mul(256));
      return vec3(r, g, b).div(255).mul(2);
    });

    // Ambient palette for released particles: cool dust with rare warm sparks.
    const ambientColor = Fn(([seed]: [Node<"float">]) => {
      const h = hash(seed.add(101));
      const warm = vec3(1.0, 0.42, 0.22);
      const cool = vec3(0.55, 0.7, 0.95);
      const pale = vec3(0.86, 0.84, 0.8);
      const base = mix(cool, pale, hash(seed.add(211)));
      const spark = smoothstep(0.972, 0.995, h);
      return mix(base.mul(0.12), warm.mul(1.6), spark);
    });

    // Curl of a 3D Perlin field (forward differences, 4 noise evaluations).
    const curl = Fn(([p]: [Node<"vec3">]) => {
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
      const uvp = vec2(
        col.add(jitter.x).div(float(W)),
        row.add(jitter.y).div(uRows),
      );
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
      const planar = vec3(uvp.x.sub(0.5).mul(uAspect), uvp.y.sub(0.5), 0).mul(
        uHeight,
      );
      const posT = planar.add(vec3(0, 0, 1).mul(depth)).add(uCenter);
      const delay = hash(i.add(uint(3)))
        .mul(uDelayRand)
        .add(uvp.x.mul(uDelaySweep));

      const ambient = ambientColor(i.toFloat());
      const picture = texel.rgb.mul(uTint);
      const tcol = mix(ambient, picture, weight).toVar();
      const oldWeight = b.w.toVar();
      const packed = packColor(tcol).toVar();
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
      const weight = select(switched, weightRaw, float(0)).mul(uFormed).toVar();
      const hold = select(switched, float(0), d.w).mul(uFormed).toVar();
      const bound = weight.max(hold).toVar();
      const free = float(1).sub(bound).toVar();

      const breathe = mx_noise_vec3(
        goal.mul(0.7).add(vec3(uTime.mul(0.11), uTime.mul(0.07), 0)),
      ).mul(uBreathe);
      const goalPos = goal.add(uOffset).add(breathe).toVar();
      const spring = goalPos.sub(pos).mul(uStiffness).mul(weight).toVar();

      const turbAmt = uTurbulence
        .mul(mix(float(1), float(0.05), bound))
        .add(uScrollKick)
        .toVar();
      const flow = curl(pos.mul(uNoiseScale).add(uDrift.mul(uTime)))
        .mul(turbAmt)
        .toVar();

      // Keep free dust inside a tube around the camera axis.
      const radial = length(pos.xy);
      const outside = smoothstep(uTubeRadius.mul(0.6), uTubeRadius, radial);
      const contain = vec3(pos.xy.mul(uContain.negate().mul(outside.add(0.15))), 0)
        .mul(free)
        .toVar();

      const dp = pos.xy.sub(uPointer.xy);
      const r = length(dp);
      const nearPlane = float(1).sub(smoothstep(float(2.5), float(6), abs(pos.z)));
      const infl = smoothstep(uPointerRadius, float(0), r)
        .mul(uPointerStrength)
        .mul(nearPlane);
      const dir = dp.div(r.add(0.02));
      const swirl = vec2(dir.y, dir.x.negate());
      const repel = vec3(
        dir.mul(infl.mul(uPointerPush)).add(swirl.mul(infl.mul(uPointerSwirl))),
        infl.mul(uPointerPush).mul(0.35).mul(hash(i.add(uint(55))).sub(0.5)),
      ).toVar();

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

      const acc = spring.add(flow).add(contain).add(repel).add(uFlow.mul(free)).toVar();
      const v1 = vel.add(acc.mul(uDt)).add(burst).toVar();
      const damp = exp(uDt.negate().mul(mix(uDampFree, uDampFormed, bound)));
      const v2 = v1.mul(damp).toVar();
      const spd = length(v2).toVar();
      const newVel = select(
        spd.greaterThan(uMaxSpeed),
        v2.mul(uMaxSpeed.div(spd.max(1e-5))),
        v2,
      ).toVar();
      const moved = pos.add(newVel.mul(uDt)).toVar();

      // Wrap free dust along the tube so the stream never runs dry; bound
      // particles never travel that far.
      const wrappedZ = select(
        moved.z.greaterThan(float(TUBE_FRONT)),
        moved.z.sub(TUBE_LENGTH),
        select(moved.z.lessThan(float(TUBE_BACK)), moved.z.add(TUBE_LENGTH), moved.z),
      );
      const newPos = vec3(moved.xy, wrappedZ).toVar();

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
    material.blending = AdditiveBlending;

    const posAttr = bufA.toAttribute().xyz;
    const colAttr = bufC.toAttribute().xyz;
    const weightAttr = bufB.toAttribute().w;
    material.positionNode = posAttr;

    const viewPos = modelViewMatrix.mul(vec4(posAttr, 1)).xyz;
    const coc = abs(viewPos.z.negate().sub(this.uFocus)).mul(this.uBokeh);
    const sizeVar = hash(instanceIndex.add(uint(99))).mul(0.8).add(0.6);
    material.scaleNode = this.uBaseSize.mul(sizeVar).mul(float(1).add(coc));

    const cocV = varying(coc);
    const colV = varying(colAttr);
    const intensity = varying(
      mix(this.uIntensityFree, this.uIntensityBound, clamp(weightAttr, 0, 1)),
    );
    const dd = uv().sub(0.5).length().mul(2);
    const core = float(1).sub(smoothstep(float(0), float(1), dd));
    const sharp = pow(core, mix(float(2.6), float(0.7), clamp(cocV, 0, 1)));
    const energy = float(1).div(pow(float(1).add(cocV), 1.7));
    material.colorNode = vec4(colV.mul(intensity).mul(energy), 1);
    material.opacityNode = sharp;

    const sprite = new Sprite(material);
    sprite.count = count;
    sprite.frustumCulled = false;
    sprite.renderOrder = 10;
    this.host.scene.add(sprite);
    this.sprite = sprite;
    this.material = material;
  }

  /* ------------------------------------------------------------------ */
  /* API                                                                 */
  /* ------------------------------------------------------------------ */

  /** Assemble into a target (switch bursts, same key only relayouts). */
  setTarget(spec: FieldTarget) {
    this.formedGoal = 1;
    const same = this.current?.key === spec.key;
    this.current = spec;
    this.queueRetarget(same ? "relayout" : "switch");
  }

  /** Release everything into the dust stream. */
  scatter() {
    this.formedGoal = 0;
  }

  get target() {
    return this.current;
  }

  /** 0..1 multiplier on formation strength. */
  setFormedScale(v: number) {
    this.formedScale = Math.max(0, Math.min(1, v));
  }

  setOffset(x: number, y: number, z = 0) {
    this.uOffset.value.set(x, y, z);
  }

  /** Bulk velocity of the dust stream (world units / s). */
  setFlow(x: number, y: number, z: number) {
    this.uFlow.value.set(x, y, z);
  }

  setPointer(worldX: number, worldY: number, strength: number) {
    this.uPointer.value.set(worldX, worldY, 0);
    this.uPointerStrength.value = strength;
  }

  setScrollKick(v: number) {
    this.uScrollKick.value = v;
  }

  setFocus(distance: number) {
    this.uFocus.value = distance;
  }

  setReducedMotion(reduced: boolean) {
    this.reduced = reduced;
    this.uTurbulence.value = reduced ? 0.28 : 1.1;
    this.uBreathe.value = reduced ? 0.012 : 0.035;
    this.uPointerPush.value = reduced ? 10 : 26;
    this.uPointerSwirl.value = reduced ? 4 : 18;
    this.uBurst.value = reduced ? 0.6 : 3.2;
    this.uDelayRand.value = reduced ? 0.3 : 0.55;
    this.uDelaySweep.value = reduced ? 0.25 : 0.45;
  }

  get isReduced() {
    return this.reduced;
  }

  /** Use only the first n particles (whole rows of the grid). */
  setActiveCount(n: number) {
    const [W, H] = this.grid;
    const rows = Math.max(16, Math.min(H, Math.floor(n / W)));
    const count = rows * W;
    if (count === this.activeCount) return;
    this.activeCount = count;
    this.uRows.value = rows;
    (this.simNode as { count: number }).count = count;
    (this.retargetNode as { count: number }).count = count;
    this.sprite.count = count;
    this.applyDensity();
    if (this.current) {
      this.currentLayoutKey = "";
      this.queueRetarget("relayout");
    }
  }

  /**
   * Per-particle size and brightness follow the on-screen density: sprites
   * keep a near-constant pixel size; free dust has a fixed brightness; bound
   * particles are normalised by how many of them (the bright share of the
   * target) land on each pixel of the formation.
   */
  applyDensity() {
    const count = Math.max(1, this.activeCount);
    const pxPerUnit = Math.max(1, this.host.pixelsPerUnit());
    const spritePx = 1.8 * Math.pow(1048576 / count, 0.2);
    this.uBaseSize.value = spritePx / pxPerUnit;
    this.uIntensityFree.value = 0.4 * Math.pow(1048576 / count, 0.25);
    const widthUnits = this.uHeight.value * this.uAspect.value;
    const areaPx =
      Math.max(0.5, widthUnits * pxPerUnit) *
      Math.max(0.5, this.uHeight.value * pxPerUnit);
    const bound = count * Math.max(0.02, this.coverFrac);
    const density = (bound * spritePx * spritePx) / areaPx;
    this.uIntensityBound.value = (this.gain * 0.3) / Math.max(0.4, density);
  }

  private queueRetarget(kind: "switch" | "relayout") {
    const spec = this.current;
    if (!spec) return;
    const [cx, cy, cz] = spec.center;
    const layoutKey = `${spec.key}|${cx.toFixed(3)}|${cy.toFixed(3)}|${cz.toFixed(3)}|${spec.height.toFixed(3)}`;
    if (kind === "relayout" && layoutKey === this.currentLayoutKey) return;
    this.currentLayoutKey = layoutKey;
    this.uUvScale.value.set(spec.uvScale[0], spec.uvScale[1]);
    this.uAspect.value = spec.aspect;
    this.uHeight.value = spec.height;
    this.uCenter.value.set(cx, cy, cz);
    this.uLumLow.value = spec.lumLow ?? 0.05;
    this.uLumHigh.value = spec.lumHigh ?? 0.35;
    this.uRelief.value = spec.relief ?? 0.35;
    this.uThickness.value = spec.thickness ?? 0.25;
    this.uTint.value.copy(spec.tint ?? new Color(1, 1, 1));
    this.uFeather.value = spec.feather ?? 0.05;
    this.gain = spec.gain ?? 1;
    this.coverFrac = spec.cover ?? 0.3;
    this.applyDensity();
    this.retargetKind = kind;
    this.pendingRetarget = true;
  }

  /** Advance the simulation one frame; call before rendering. */
  update(renderer: { compute: (node: never) => unknown }, time: number, dt: number) {
    this.uTime.value = time;
    this.uDt.value = dt;
    const goal = this.formedGoal * this.formedScale;
    const k = 1 - Math.exp(-dt * (goal > this.formedValue ? 2.2 : 3.5));
    this.formedValue += (goal - this.formedValue) * k;
    this.uFormed.value = this.formedValue;

    if (this.pendingRetarget) {
      this.pendingRetarget = false;
      const sweep = this.retargetKind === "switch";
      this.uSwitchBase.value = sweep ? time : time - 1;
      if (!sweep) {
        const dr = this.uDelayRand.value;
        const ds = this.uDelaySweep.value;
        this.uDelayRand.value = 0;
        this.uDelaySweep.value = 0;
        renderer.compute(this.retargetNode as never);
        this.uDelayRand.value = dr;
        this.uDelaySweep.value = ds;
      } else {
        renderer.compute(this.retargetNode as never);
      }
    }
    renderer.compute(this.simNode as never);
  }

  /** Read a storage buffer back to the CPU (tests only; slow). */
  async readBuffer(
    renderer: { getArrayBufferAsync: (a: never) => Promise<ArrayBuffer> },
    name: string,
  ) {
    const node = this.buffers[name];
    if (!node) throw new Error(`unknown buffer ${name}`);
    const data = await renderer.getArrayBufferAsync(node.value as never);
    return new Float32Array(data);
  }

  dispose() {
    this.material.dispose();
    this.host.scene.remove(this.sprite);
  }

  get tuning() {
    return {
      stiffness: this.uStiffness,
      turbulence: this.uTurbulence,
      noiseScale: this.uNoiseScale,
      dampFree: this.uDampFree,
      dampFormed: this.uDampFormed,
      maxSpeed: this.uMaxSpeed,
      pointerRadius: this.uPointerRadius,
      pointerPush: this.uPointerPush,
      pointerSwirl: this.uPointerSwirl,
      burst: this.uBurst,
      contain: this.uContain,
      tubeRadius: this.uTubeRadius,
      baseSize: this.uBaseSize,
      focus: this.uFocus,
      bokeh: this.uBokeh,
      intensityFree: this.uIntensityFree,
      intensityBound: this.uIntensityBound,
      breathe: this.uBreathe,
      flow: this.uFlow,
      formed: this.uFormed,
    };
  }
}
