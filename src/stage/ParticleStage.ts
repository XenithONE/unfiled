/**
 * ParticleStage — the GPU particle field behind UNFILED.
 *
 * A million sprites simulated with TSL compute shaders (WebGPU, or WebGL2 via
 * transform feedback). Every particle owns a target: a texel of a cover image
 * or of a rasterised word. Bright texels pull their particle into formation,
 * dark texels release it into the ambient curl-noise field, so pictures
 * assemble out of dust and dissolve back into it.
 *
 * Constraints respected on purpose:
 * - each compute pass writes at most 3 storage buffers (WebGL2 transform
 *   feedback allows 4 separate varyings);
 * - a particle only reads its own element, never a neighbour's (transform
 *   feedback cannot gather);
 * - points are never used (WebGPU points are 1px) — instanced sprites instead.
 */
import type { Node, TextureNode } from "three/webgpu";
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  Color,
  PerspectiveCamera,
  RenderPipeline,
  Scene,
  Sprite,
  SpriteNodeMaterial,
  Vector2,
  Vector3,
  WebGPURenderer,
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
  pass,
  pow,
  screenSize,
  screenUV,
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
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { TargetPainter, coverSpec, loadImage, textSpec } from "./targets";
import type { TextOptions } from "./targets";

export type Anchor = "hero" | "side" | "center";

export interface TargetSpec {
  /** Unique key; re-setting the same key only relayouts. */
  key: string;
  /** width / height of the painted content. */
  aspect: number;
  /** Fraction of the painter canvas the content occupies (bottom-left). */
  uvScale: [number, number];
  anchor: Anchor;
  /** Luminance below which a texel releases its particle (0..1). */
  lumLow?: number;
  /** Luminance above which a texel fully binds its particle (0..1). */
  lumHigh?: number;
  /** Depth relief from luminance, world units. */
  relief?: number;
  /** Random z thickness, world units. */
  thickness?: number;
  /** Colour multiplier. */
  tint?: Color;
  /** Brightness multiplier for this target. */
  gain?: number;
  /** Edge feather in uv units (keeps rectangles from reading as frames). */
  feather?: number;
}

export interface StageStats {
  backend: "webgpu" | "webgl2";
  count: number;
  fps: number;
  renderScale: number;
  gpu: string;
}

export type Tier = "ultra" | "high" | "mid" | "low";

const TIER_GRID: Record<Tier, [number, number]> = {
  ultra: [1024, 1024],
  high: [768, 768],
  mid: [512, 512],
  low: [384, 384],
};

const CAMERA_Z = 10;
const FOV = 38;

const clampNum = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

export class ParticleStage {
  readonly canvas: HTMLCanvasElement;
  private renderer!: WebGPURenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(FOV, 1, 0.1, 100);
  private pipeline!: RenderPipeline;
  private sprite!: Sprite;
  private material!: SpriteNodeMaterial;

  private grid: [number, number] = [512, 512];
  count = 0;
  tier: Tier = "mid";
  backend: "webgpu" | "webgl2" = "webgpu";
  gpuName = "";

  // compute nodes
  buffers: Record<string, { value: unknown }> = {};
  private simNode: unknown;
  private retargetNode: unknown;
  readonly painter = new TargetPainter();
  private coverTex = texture(this.painter.texture);
  private uUvScale = uniform(new Vector2(1, 1));
  private pendingRetarget = false;
  private current: TargetSpec | null = null;
  private currentLayoutKey = "";

  // uniforms (simulation)
  private uTime = uniform(0);
  private uDt = uniform(1 / 60);
  private uFormed = uniform(0);
  private uOffset = uniform(new Vector3());
  private uBreathe = uniform(0.035);
  private uStiffness = uniform(26);
  private uTurbulence = uniform(1.1);
  private uNoiseScale = uniform(0.42);
  private uDampFree = uniform(0.9);
  private uDampFormed = uniform(7.5);
  private uMaxSpeed = uniform(9);
  private uPointer = uniform(new Vector3(0, 0, 0));
  private uPointerRadius = uniform(1.6);
  private uPointerStrength = uniform(0);
  private uPointerPush = uniform(26);
  private uPointerSwirl = uniform(18);
  private uBurst = uniform(0);
  private uContain = uniform(0.06);
  private uDrift = uniform(new Vector3(0.12, 0.05, 0.08));
  private uScrollKick = uniform(0);

  // uniforms (retarget)
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
  /** Active rows of the particle grid (count / W); shrinks on weak GPUs. */
  private uRows = uniform(1024);
  private activeCount = 0;
  private slowWindows = 0;
  /** ?dbg=nosim,noretarget,nopost — bisection switches for backend bugs. */
  private debug = new Set(
    (new URLSearchParams(window.location.search).get("dbg") ?? "")
      .split(",")
      .filter(Boolean),
  );
  private lost = false;
  private lostCb: ((reason: string) => void) | null = null;

  // uniforms (render)
  private uBaseSize = uniform(0.01);
  private uFocus = uniform(CAMERA_Z);
  private uBokeh = uniform(0.85);
  private uIntensity = uniform(0.1);
  private uGain = 1;
  private uGrain = uniform(0.012);
  private uVignette = uniform(0.55);
  private uAberration = uniform(0.0018);
  private bloomNode!: ReturnType<typeof bloom>;

  // runtime
  private running = false;
  private disposed = false;
  private lastTs = 0;
  private simTime = 0;
  private reduced = false;
  private pointerTarget = new Vector3();
  private pointerSmoothed = new Vector3();
  private pointerEnergy = 0;
  private lastPointerClient = new Vector2(NaN, NaN);
  private renderScale = 1;
  private frameAccum = 0;
  private frameCount = 0;
  private fps = 0;
  private statsCb: ((s: StageStats) => void) | null = null;
  private size = new Vector2(0, 0);
  private dpr = 1;
  private formedGoal = 1;
  private formedValue = 0;
  private scrollVelocity = 0;
  private lastScroll = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  /* ------------------------------------------------------------------ */
  /* setup                                                               */
  /* ------------------------------------------------------------------ */

  async init(opts: { forceWebGL?: boolean; tier?: Tier } = {}) {
    const renderer = new WebGPURenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: false,
      forceWebGL: opts.forceWebGL ?? false,
      powerPreference: "high-performance",
    });
    this.renderer = renderer;
    renderer.onDeviceLost = (info) => {
      if (this.lost) return;
      this.lost = true;
      console.error("UNFILED: graphics device lost", info);
      this.stop();
      this.lostCb?.(info?.message ?? info?.reason ?? "device lost");
    };
    await renderer.init();
    const backend = renderer.backend as { isWebGPUBackend?: boolean };
    this.backend = backend.isWebGPUBackend ? "webgpu" : "webgl2";
    this.gpuName = await this.describeGpu();

    this.tier = opts.tier ?? this.pickTier();
    this.grid = TIER_GRID[this.tier];
    this.count = this.grid[0] * this.grid[1];

    renderer.setClearColor(0x07080a, 1);
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    this.camera.position.set(0, 0, CAMERA_Z);
    this.camera.lookAt(0, 0, 0);

    this.buildParticles();
    this.buildPost();
    this.applyMotionProfile();
    this.setActiveCount(this.count);
    this.resize();

    return {
      backend: this.backend,
      count: this.count,
      tier: this.tier,
      gpu: this.gpuName,
    };
  }

  private pickTier(): Tier {
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const coarse =
      !fine || Math.min(window.screen.width, window.screen.height) < 700;
    const memory = (navigator as { deviceMemory?: number }).deviceMemory ?? 8;
    const cores = navigator.hardwareConcurrency ?? 4;
    const weak = memory <= 4 || cores <= 4;
    if (this.backend === "webgpu") {
      if (coarse) return weak ? "low" : "mid";
      return weak ? "high" : "ultra";
    }
    if (coarse) return "low";
    return weak ? "mid" : "high";
  }

  private async describeGpu() {
    try {
      const backend = this.renderer.backend as {
        isWebGPUBackend?: boolean;
        adapter?: {
          info?: { vendor?: string; architecture?: string };
        };
        gl?: WebGL2RenderingContext;
      };
      if (backend.isWebGPUBackend) {
        const info = backend.adapter?.info;
        if (info?.vendor)
          return [info.vendor, info.architecture].filter(Boolean).join(" / ");
        return "webgpu adapter";
      }
      const gl = backend.gl;
      if (gl) {
        const ext = gl.getExtension("WEBGL_debug_renderer_info");
        const name = ext
          ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))
          : String(gl.getParameter(gl.RENDERER));
        return name.replace(/^ANGLE \((.*)\)$/, "$1").slice(0, 60);
      }
    } catch {
      /* informational only */
    }
    return "";
  }

  private buildParticles() {
    const count = this.count;
    const [W] = this.grid;

    // Four vec4 buffers hold the whole particle state. WebGL2 transform
    // feedback allows at most four separate buffers per pass, so reads and
    // writes of a compute pass must all fit in these:
    //   A = position.xyz, switchAt      (sim writes xyz, retarget writes w)
    //   B = velocity.xyz, weightNew     (sim writes xyz, retarget writes w)
    //   C = colour.rgb,   packedTarget  (sim writes rgb, retarget writes w)
    //   D = target.xyz,   weightOld     (retarget writes)
    const initialA = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const r = 2.2 + Math.cbrt(Math.random()) * 4.5;
      const theta = Math.random() * Math.PI * 2;
      const z = Math.random() * 2 - 1;
      const sxy = Math.sqrt(1 - z * z);
      initialA[i * 4] = r * sxy * Math.cos(theta) * 1.5;
      initialA[i * 4 + 1] = r * sxy * Math.sin(theta) * 0.8;
      initialA[i * 4 + 2] = r * z * 0.8;
      initialA[i * 4 + 3] = -1; // already "switched" to the (empty) target
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
      const cool = vec3(0.58, 0.68, 0.9);
      const pale = vec3(0.86, 0.84, 0.8);
      const base = mix(cool, pale, hash(seed.add(211)));
      const spark = smoothstep(0.972, 0.995, h);
      return mix(base.mul(0.11), warm.mul(1.6), spark);
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
      // smoothstep with equal edges is undefined in WGSL, so keep a floor.
      const fe = uFeather.max(0.002);
      const feather = smoothstep(float(0), fe, uvp.x)
        .mul(smoothstep(float(1), float(1).sub(fe), uvp.x))
        .mul(smoothstep(float(0), fe, uvp.y))
        .mul(smoothstep(float(1), float(1).sub(fe), uvp.y));
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

      // Whole-element writes only: a single-component store (a.w = x) lands
      // in a temporary on the WebGPU path and is silently lost.
      // The old binding strength moves to D.w so the particle can hold its
      // place until its switch time; the new target replaces D.xyz.
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
      // Swizzle assignments are split per component by TSL, so every input
      // and every result is materialised in a variable first; otherwise the
      // expression would be evaluated three times against half-updated state.
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

      const breathe = mx_noise_vec3(
        goal.mul(0.7).add(vec3(uTime.mul(0.11), uTime.mul(0.07), 0)),
      ).mul(uBreathe);
      const goalPos = goal.add(uOffset).add(breathe).toVar();
      const toGoal = goalPos.sub(pos);
      const spring = toGoal.mul(uStiffness).mul(weight).toVar();

      const turbAmt = uTurbulence
        .mul(mix(float(1), float(0.05), bound))
        .add(uScrollKick)
        .toVar();
      const flow = curl(pos.mul(uNoiseScale).add(uDrift.mul(uTime)))
        .mul(turbAmt)
        .toVar();

      const contain = pos.mul(uContain.negate()).mul(float(1).sub(bound));

      const dp = pos.xy.sub(uPointer.xy);
      const r = length(dp);
      const infl = smoothstep(uPointerRadius, float(0), r).mul(uPointerStrength);
      const dir = dp.div(r.add(0.02));
      const swirl = vec2(dir.y, dir.x.negate());
      const repel = vec3(
        dir.mul(infl.mul(uPointerPush)).add(swirl.mul(infl.mul(uPointerSwirl))),
        infl.mul(uPointerPush).mul(0.35).mul(hash(i.add(uint(55))).sub(0.5)),
      );

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
      );

      const acc = spring.add(flow).add(contain).add(repel).toVar();
      const v1 = vel.add(acc.mul(uDt)).add(burst).toVar();
      const damp = exp(uDt.negate().mul(mix(uDampFree, uDampFormed, bound)));
      const v2 = v1.mul(damp).toVar();
      const spd = length(v2).toVar();
      const newVel = select(
        spd.greaterThan(uMaxSpeed),
        v2.mul(uMaxSpeed.div(spd.max(1e-5))),
        v2,
      ).toVar();
      const newPos = pos.add(newVel.mul(uDt)).toVar();
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
    material.depthTest = false;
    material.blending = AdditiveBlending;

    const posAttr = bufA.toAttribute().xyz;
    const colAttr = bufC.toAttribute().xyz;
    material.positionNode = posAttr;

    const viewPos = modelViewMatrix.mul(vec4(posAttr, 1)).xyz;
    const coc = abs(viewPos.z.negate().sub(this.uFocus)).mul(this.uBokeh);
    const sizeVar = hash(instanceIndex.add(uint(99))).mul(0.8).add(0.6);
    material.scaleNode = this.uBaseSize.mul(sizeVar).mul(float(1).add(coc));

    const cocV = varying(coc);
    const colV = varying(colAttr);
    const dd = uv().sub(0.5).length().mul(2);
    const core = float(1).sub(smoothstep(float(0), float(1), dd));
    const sharp = pow(core, mix(float(2.6), float(0.7), clamp(cocV, 0, 1)));
    const energy = float(1).div(pow(float(1).add(cocV), 1.7));
    material.colorNode = vec4(colV.mul(this.uIntensity).mul(energy), 1);
    material.opacityNode = sharp;

    const sprite = new Sprite(material);
    sprite.count = count;
    sprite.frustumCulled = false;
    this.scene.add(sprite);
    this.sprite = sprite;
    this.material = material;
  }

  private buildPost() {
    const scenePass = pass(this.scene, this.camera);
    const color = scenePass.getTextureNode("output");
    this.bloomNode = bloom(color, 0.55, 0.55, 0.35);

    // Subtle chromatic spread of the glow, vignette and film grain.
    const uvN = screenUV;
    const centered = uvN.sub(0.5);
    const radial = length(centered.mul(vec2(1, 1.15)));
    const aberr = centered.mul(this.uAberration.mul(radial.mul(8)));
    // runtime method is getTextureNode(); the typings still say getTexture()
    const bloomTex = (
      this.bloomNode as unknown as { getTextureNode(): TextureNode }
    ).getTextureNode();
    const bloomR = bloomTex.sample(uvN.add(aberr)).r;
    const bloomG = bloomTex.sample(uvN).g;
    const bloomB = bloomTex.sample(uvN.sub(aberr)).b;
    const glow = vec3(bloomR, bloomG, bloomB);
    let out = color.rgb.add(glow);
    const vig = float(1).sub(smoothstep(float(0.3), float(1.05), radial));
    out = out.mul(mix(float(1).sub(this.uVignette), float(1), vig));
    const grainSeed = screenUV.mul(screenSize).add(this.uTime.mul(131.7));
    const grain = hash(grainSeed.x.add(grainSeed.y.mul(1931)).toUint())
      .sub(0.5)
      .mul(this.uGrain);
    out = out.add(grain);
    this.pipeline = new RenderPipeline(this.renderer, vec4(out, 1));
  }

  /* ------------------------------------------------------------------ */
  /* layout                                                              */
  /* ------------------------------------------------------------------ */

  get visibleHeight() {
    return 2 * CAMERA_Z * Math.tan((FOV * Math.PI) / 360);
  }
  get visibleWidth() {
    return this.visibleHeight * this.camera.aspect;
  }

  private layoutFor(spec: TargetSpec) {
    const vh = this.visibleHeight;
    const vw = this.visibleWidth;
    const narrow = this.size.x < 900;
    const aspect = spec.aspect;
    let cx = 0,
      cy = 0,
      height = 1;
    if (spec.anchor === "hero") {
      let width = vw * (narrow ? 0.94 : 0.9);
      height = width / aspect;
      const maxH = vh * (narrow ? 0.34 : 0.46);
      if (height > maxH) {
        height = maxH;
        width = height * aspect;
      }
      cy = vh * (narrow ? 0.14 : 0.1);
    } else if (spec.anchor === "side" && !narrow) {
      let width = vw * 0.46;
      height = width / aspect;
      const maxH = vh * 0.74;
      if (height > maxH) {
        height = maxH;
        width = height * aspect;
      }
      cx = vw * 0.235;
      cy = 0;
    } else {
      // Centre anchor. On narrow screens the list scrolls over the field, so
      // covers sit in the upper third and text in the lower third.
      const isCover = spec.key.startsWith("cover:");
      let width = vw * (narrow ? 0.92 : 0.6);
      height = width / aspect;
      const maxH = vh * (narrow ? (isCover ? 0.36 : 0.26) : 0.66);
      if (height > maxH) {
        height = maxH;
        width = height * aspect;
      }
      cy = narrow ? (isCover ? vh * 0.2 : vh * -0.22) : 0;
    }
    return { cx, cy, height };
  }

  /* ------------------------------------------------------------------ */
  /* public API                                                          */
  /* ------------------------------------------------------------------ */

  private showSeq = 0;

  /** Paint a cover image and assemble into it (stale requests are dropped). */
  async showCover(id: string, url: string, accent: string, anchor: Anchor) {
    const seq = ++this.showSeq;
    try {
      const img = await loadImage(url);
      if (seq !== this.showSeq || this.disposed) return;
      const painted = this.painter.paintImage(img);
      this.setTarget(coverSpec(id, painted, accent, anchor));
    } catch {
      if (seq === this.showSeq) this.setTarget(null);
    }
  }

  /** Rasterise a line of text and assemble into it. */
  async showText(
    key: string,
    text: string,
    opts: TextOptions,
    anchor: Anchor,
    extra: Partial<TargetSpec> = {},
  ) {
    const seq = ++this.showSeq;
    const painted = await this.painter.paintText(key, text, opts);
    if (seq !== this.showSeq || this.disposed) return;
    this.setTarget(textSpec(`text:${key}`, painted, anchor, extra));
  }

  /** Scatter the field (also cancels pending show* requests). */
  scatter() {
    this.showSeq++;
    this.setTarget(null);
  }

  /** Warm the image cache for a cover. */
  prefetchCover(url: string) {
    loadImage(url).catch(() => undefined);
  }

  /** Make the field assemble into a target, or scatter when null. */
  setTarget(spec: TargetSpec | null) {
    if (spec === null) {
      this.formedGoal = 0;
      return;
    }
    this.formedGoal = 1;
    const sameTexture = this.current?.key === spec.key;
    this.current = spec;
    this.queueRetarget(sameTexture ? "relayout" : "switch");
  }

  /** 0..1 multiplier on formation (hero dissolve while scrolling). */
  setFormedScale(v: number) {
    this.formedScale = clampNum(v, 0, 1);
  }
  private formedScale = 1;

  /** World-space offset applied to every target (parallax with the page). */
  setOffset(x: number, y: number, z = 0) {
    this.uOffset.value.set(x, y, z);
  }

  setScroll(y: number) {
    const dy = y - this.lastScroll;
    this.lastScroll = y;
    this.scrollVelocity += dy;
  }

  setPointer(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((clientY - rect.top) / rect.height) * 2 - 1);
    const vh = this.visibleHeight;
    const vw = this.visibleWidth;
    this.pointerTarget.set((nx * vw) / 2, (ny * vh) / 2, 0);
    const last = this.lastPointerClient;
    if (!Number.isNaN(last.x)) {
      const moved = Math.hypot(clientX - last.x, clientY - last.y);
      this.pointerEnergy = Math.min(1, this.pointerEnergy + moved * 0.012);
    }
    last.set(clientX, clientY);
  }

  /** A deliberate shove: the field explodes outward from the pointer. */
  pulse(strength = 1) {
    this.pointerEnergy = Math.min(1.6, this.pointerEnergy + strength);
  }

  setPaused(paused: boolean) {
    if (paused) this.stop();
    else this.start();
  }

  setReducedMotion(reduced: boolean) {
    this.reduced = reduced;
    this.applyMotionProfile();
  }

  onStats(cb: ((s: StageStats) => void) | null) {
    this.statsCb = cb;
  }

  /** Called once if the GPU device / WebGL context is lost. */
  onLost(cb: ((reason: string) => void) | null) {
    this.lostCb = cb;
  }

  get isLost() {
    return this.lost;
  }

  start() {
    if (this.running || this.disposed) return;
    this.running = true;
    this.lastTs = 0;
    const loop = (ts: number) => {
      if (!this.running) return;
      const dt = this.lastTs ? (ts - this.lastTs) / 1000 : 1 / 60;
      this.lastTs = ts;
      this.frame(dt);
    };
    this.renderer.setAnimationLoop(loop).catch?.((err: unknown) => {
      console.error("UNFILED stage loop stopped", err);
    });
  }

  stop() {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  /** Advance the simulation by hand (used by tests and when paused). */
  step(dt = 1 / 60) {
    this.frame(dt);
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return false;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const changed = this.size.x !== w || this.size.y !== h;
    this.size.set(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.dpr * this.renderScale);
    this.renderer.setSize(w, h, false);
    if (changed && this.current) this.queueRetarget("relayout");
    this.applyDensity();
    return true;
  }

  dispose() {
    this.disposed = true;
    this.stop();
    this.pipeline?.dispose();
    this.material?.dispose();
    this.renderer?.dispose();
  }

  /* ------------------------------------------------------------------ */
  /* internals                                                           */
  /* ------------------------------------------------------------------ */

  private applyMotionProfile() {
    const r = this.reduced;
    this.uTurbulence.value = r ? 0.28 : 1.1;
    this.uBreathe.value = r ? 0.012 : 0.035;
    this.uPointerPush.value = r ? 10 : 26;
    this.uPointerSwirl.value = r ? 4 : 18;
    this.uBurst.value = r ? 0.6 : 3.2;
    this.uDelayRand.value = r ? 0.3 : 0.55;
    this.uDelaySweep.value = r ? 0.25 : 0.45;
    this.uGrain.value = r ? 0.006 : 0.012;
  }

  private queueRetarget(kind: "switch" | "relayout") {
    const spec = this.current;
    if (!spec) return;
    const { cx, cy, height } = this.layoutFor(spec);
    const layoutKey = `${spec.key}|${cx.toFixed(3)}|${cy.toFixed(3)}|${height.toFixed(3)}`;
    if (kind === "relayout" && layoutKey === this.currentLayoutKey) return;
    this.currentLayoutKey = layoutKey;
    this.uUvScale.value.set(spec.uvScale[0], spec.uvScale[1]);
    this.uAspect.value = spec.aspect;
    this.uHeight.value = height;
    this.uCenter.value.set(cx, cy, 0);
    this.uLumLow.value = spec.lumLow ?? 0.05;
    this.uLumHigh.value = spec.lumHigh ?? 0.35;
    this.uRelief.value = spec.relief ?? 0.35;
    this.uThickness.value = spec.thickness ?? 0.25;
    this.uTint.value.copy(spec.tint ?? new Color(1, 1, 1));
    const narrowCover = this.size.x < 900 && spec.key.startsWith("cover:");
    this.uGain = (spec.gain ?? 1) * (narrowCover ? 0.75 : 1);
    this.applyDensity();
    this.uFeather.value = spec.feather ?? 0.05;
    // "switch" bursts particles in a sweep; "relayout" moves them silently.
    this.retargetKind = kind;
    this.pendingRetarget = true;
  }
  private retargetKind: "switch" | "relayout" = "switch";

  private frame(dtRaw: number) {
    if (this.disposed || this.lost) return;
    if (!this.resize()) return; // hidden pane → nothing to draw
    const dt = clampNum(dtRaw, 1 / 240, 1 / 30);
    this.simTime += dt;
    this.uTime.value = this.simTime;
    this.uDt.value = dt;

    // formation ramp
    const goal = this.formedGoal * this.formedScale;
    const k = 1 - Math.exp(-dt * (goal > this.formedValue ? 2.2 : 3.5));
    this.formedValue += (goal - this.formedValue) * k;
    this.uFormed.value = this.formedValue;

    // pointer smoothing and decay
    this.pointerSmoothed.lerp(this.pointerTarget, 1 - Math.exp(-dt * 14));
    this.uPointer.value.copy(this.pointerSmoothed);
    this.pointerEnergy *= Math.exp(-dt * 2.4);
    this.uPointerStrength.value = this.pointerEnergy;

    // scroll kick: fast scrolling stirs the field
    const sv = this.scrollVelocity;
    this.scrollVelocity *= Math.exp(-dt * 6);
    this.uScrollKick.value = clampNum(
      Math.abs(sv) / Math.max(1, this.size.y) * (this.reduced ? 1.5 : 6),
      0,
      this.reduced ? 0.6 : 2.5,
    );

    if (this.pendingRetarget && !this.debug.has("noretarget")) {
      this.pendingRetarget = false;
      const sweep = this.retargetKind === "switch";
      this.uSwitchBase.value = sweep ? this.simTime : this.simTime - 1;
      if (!sweep) {
        // temporarily silence delay so every particle switches at once
        const dr = this.uDelayRand.value;
        const ds = this.uDelaySweep.value;
        this.uDelayRand.value = 0;
        this.uDelaySweep.value = 0;
        this.renderer.compute(this.retargetNode as never);
        this.uDelayRand.value = dr;
        this.uDelaySweep.value = ds;
      } else {
        this.renderer.compute(this.retargetNode as never);
      }
    }

    if (!this.debug.has("nosim")) this.renderer.compute(this.simNode as never);
    if (this.debug.has("nopost")) this.renderer.render(this.scene, this.camera);
    else this.pipeline.render();

    // adaptive resolution + fps (frames after a stall are not counted)
    if (dtRaw > 0.25) return;
    this.frameAccum += dtRaw;
    this.frameCount++;
    if (this.frameCount >= 45) {
      const avg = this.frameAccum / this.frameCount;
      this.fps = Math.round(1 / Math.max(avg, 1e-3));
      this.frameAccum = 0;
      this.frameCount = 0;
      if (this.running) {
        if (avg > 1 / 42) {
          this.slowWindows++;
          if (this.slowWindows >= 3) {
            this.slowWindows = 0;
            if (this.activeCount > 262144) {
              this.setActiveCount(Math.max(262144, Math.floor(this.activeCount * 0.6)));
            } else if (this.renderScale > 0.55) {
              this.renderScale = Math.max(0.55, this.renderScale - 0.12);
              this.size.set(0, 0);
            }
          }
        } else {
          this.slowWindows = 0;
          if (avg < 1 / 75 && this.renderScale < 1) {
            this.renderScale = Math.min(1, this.renderScale + 0.08);
            this.size.set(0, 0);
          }
        }
      }
      this.statsCb?.({
        backend: this.backend,
        count: this.activeCount,
        fps: this.fps,
        renderScale: this.renderScale,
        gpu: this.gpuName,
      });
    }
  }

  /** Use only the first n particles (rows of the grid). */
  setActiveCount(n: number) {
    const [W] = this.grid;
    const rows = Math.max(16, Math.min(this.grid[1], Math.floor(n / W)));
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
   * Per-particle size and brightness follow the on-screen density:
   * sprites keep a near-constant pixel size, and brightness is normalised by
   * how many sprite-pixels land on each pixel of the current formation.
   */
  private applyDensity() {
    const count = Math.max(1, this.activeCount);
    const bufferH = Math.max(1, this.size.y * this.dpr * this.renderScale);
    const pxPerUnit = bufferH / this.visibleHeight;
    const spritePx = 1.8 * Math.pow(1048576 / count, 0.2);
    this.uBaseSize.value = spritePx / pxPerUnit;
    const widthUnits = this.uHeight.value * this.uAspect.value;
    const areaPx =
      Math.max(0.5, widthUnits * pxPerUnit) *
      Math.max(0.5, this.uHeight.value * pxPerUnit);
    const density = (count * spritePx * spritePx) / areaPx;
    this.uIntensity.value = (this.uGain * 0.9) / Math.max(0.6, density);
  }

  /** Read a storage buffer back to the CPU (tests only; slow). */
  async readBuffer(name: string) {
    const node = this.buffers[name];
    if (!node) throw new Error(`unknown buffer ${name}`);
    const attribute = (node as unknown as { value: { array: Float32Array } }).value;
    const data = await this.renderer.getArrayBufferAsync(
      attribute as never,
    );
    return new Float32Array(data);
  }

  /* exposed for tuning from the console / tests */
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
      baseSize: this.uBaseSize,
      focus: this.uFocus,
      bokeh: this.uBokeh,
      intensity: this.uIntensity,
      grain: this.uGrain,
      vignette: this.uVignette,
      aberration: this.uAberration,
      bloom: this.bloomNode,
      breathe: this.uBreathe,
      sprite: this.sprite,
    };
  }
}
