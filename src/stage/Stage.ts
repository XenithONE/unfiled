/**
 * Stage — the world behind UNFILED: a shallow mirror of water at the end of
 * a day, the works standing in it as lit slabs, and one night passing while
 * the visitor walks from the sunset to the sunrise.
 *
 * This class owns the renderer, the camera's walk (hero → one stop per work
 * → the ending), the clock that turns scroll progress into the hour, the
 * post-processing and the pointer (ripples, hover, picking).
 */
import {
  Color,
  NeutralToneMapping,
  PerspectiveCamera,
  Plane,
  Raycaster,
  RenderPipeline,
  Scene,
  Vector2,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import {
  Fn,
  float,
  hash,
  length,
  mix,
  pass,
  renderOutput,
  screenSize,
  screenUV,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vec4,
} from "./tsl";
import type { N } from "./tsl";
import { Monoliths, THICK } from "./Monoliths";
import { Motes } from "./Motes";
import { WORDMARK_BOX } from "./targets";
import type { WorkItem } from "./Monoliths";
import { Sky } from "./sky";
import { Water } from "./Water";
import { DEPTH_EM, Wordmark } from "./Wordmark";
import { makeNoiseTexture, makeRippleTexture } from "./noise";
import {
  DEG,
  SLAB_FOOT,
  Tour,
  azimuthAt,
  buildMonument,
  buildSlabs,
  detailPose,
  endPose,
  heroPose,
  monumentGap,
  stationPose,
} from "./layout";
import type { CamPose, MonumentPose, SlabPose, View } from "./layout";
import { HERO_PROGRESS } from "../types";

export type Tier = "ultra" | "high" | "mid" | "low";
export type Mode = "hero" | "archive" | "end";

export interface StageStats {
  backend: "webgpu" | "webgl2";
  fps: number;
  renderScale: number;
  gpu: string;
  /** The hour over the mirror, "18:42" … "05:52". */
  clock: string;
  phase: string;
  /** How many motes are in the air. */
  motes: number;
}

interface TierSpec {
  dpr: number;
  reflection: number;
  detail: 0 | 1 | 2;
  salt: boolean;
  texture: number;
  /** Grid of the mote field (columns × rows = how many motes). */
  motes: [number, number];
}

const TIERS: Record<Tier, TierSpec> = {
  ultra: { dpr: 2, reflection: 0.75, detail: 2, salt: true, texture: 1280, motes: [640, 640] },
  high: { dpr: 1.5, reflection: 0.6, detail: 2, salt: true, texture: 1024, motes: [512, 512] },
  mid: { dpr: 1.5, reflection: 0.5, detail: 1, salt: true, texture: 768, motes: [384, 384] },
  low: { dpr: 1, reflection: 0.4, detail: 0, salt: false, texture: 512, motes: [256, 256] },
};

/** Progress value of the opening shot (station 0 is 0, one unit per work). */
const HERO_P = HERO_PROGRESS;

/**
 * Linear luminance over which a mote binds to a picture. Lettering is white on
 * black; a cover binds almost everywhere, so even its shadows are drawn.
 */
const LUM_TEXT: [number, number] = [0.08, 0.5];
const LUM_COVER: [number, number] = [0.004, 0.05];

/**
 * The gust that crosses the wordmark at rest: how much clings between gusts,
 * how much more under the gust, its width and reach (shares of the wordmark's
 * width), and its timing in seconds.
 */
const GUST = { rest: 0.1, amount: 0.9, width: 0.2, reach: 0.95, travel: 8, period: 12.5 };

const clampNum = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smoothJs = (a: number, b: number, x: number) => {
  const t = clampNum((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeOut = (t: number) => 1 - Math.pow(1 - clampNum(t, 0, 1), 3);
const easeInOut = (t: number) => {
  const x = clampNum(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

export class Stage {
  readonly canvas: HTMLCanvasElement;
  private renderer!: WebGPURenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(48, 1, 0.2, 20000);
  private pipeline!: RenderPipeline;
  private sky!: Sky;
  private water!: Water;
  private monoliths!: Monoliths;
  private wordmark!: Wordmark;
  private motes!: Motes;

  tier: Tier = "mid";
  backend: "webgpu" | "webgl2" = "webgpu";
  gpuName = "";

  // post uniforms
  private uTime = uniform(0);
  private uGrain = uniform(0.022);
  private uVignette = uniform(0.34);
  private uScrim = uniform(0.4);
  private uScrimBand = uniform(0);
  private uFade = uniform(0);
  private bloomNode!: ReturnType<typeof bloom>;

  // runtime
  private running = false;
  private disposed = false;
  private lost = false;
  private lastTs = 0;
  private simTime = 0;
  private reduced = false;
  private size = new Vector2(0, 0);
  private dpr = 1;
  private renderScale = 1;
  private appliedRatio = 0;
  private frameAccum = 0;
  private frameCount = 0;
  private fps = 0;
  private slowWindows = 0;
  private statsCb: ((s: StageStats) => void) | null = null;
  private lostCb: ((reason: string) => void) | null = null;
  private hoverCb: ((index: number | null) => void) | null = null;
  private debug = new Set(
    (new URLSearchParams(window.location.search).get("dbg") ?? "").split(",").filter(Boolean),
  );

  // world
  private items: WorkItem[] = [];
  private slabPoses: SlabPose[] = [];
  private monument: MonumentPose = buildMonument();
  private tour: Tour | null = null;
  private prevTour: Tour | null = null;
  private tourBlend = 1;
  private details: CamPose[] = [];
  private viewKey = "";

  // choreography
  private mode: Mode = "hero";
  private progress = HERO_P;
  private smoothProgress = HERO_P;
  private progressVel = 0;
  private activeIndex: number | null = null;
  private detailGoal = 0;
  private detailT = 0;
  private detailIndex = 0;
  private introGoal = 0;
  private introT = 0;
  private fovKick = 0;
  private fixedTau: number | null = null;
  private cloudDrift = 0;

  // the motes: what they are gathering into, and how firmly
  private gathering: "none" | "wordmark" | "cover" | "tagline" = "none";
  private coverHold = 1;
  private veilTimer: number | null = null;
  private endView: { pose: CamPose; view: View } | null = null;
  private forward = new Vector3(0, 0, -1);
  private pointerEnergy = 0;
  private lastPointerClient = new Vector2(NaN, NaN);
  private focus = 12;

  // pointer
  private pointerTarget = new Vector2();
  private pointerSmoothed = new Vector2();
  private pointerNdc = new Vector2(2, 2);
  private pointerDirty = false;
  private pointerInside = false;
  private lastDrop = new Vector3(1e6, 0, 1e6);
  private lastDropTime = -10;
  private raycaster = new Raycaster();
  private waterPlane = new Plane(new Vector3(0, 1, 0), 0);
  private hit = new Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  /* ------------------------------------------------------------------ */
  /* setup                                                               */
  /* ------------------------------------------------------------------ */

  async init(opts: { forceWebGL?: boolean; tier?: Tier } = {}) {
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const renderer = new WebGPURenderer({
      canvas: this.canvas,
      // multisampling has to be chosen before the backend is known: desktops
      // get it, and so does anyone who asks for a high tier by name
      antialias: opts.tier ? opts.tier === "ultra" || opts.tier === "high" : fine,
      alpha: false,
      forceWebGL: opts.forceWebGL ?? false,
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
    const spec = TIERS[this.tier];

    // the mirror pass must clear to nothing: the sky is added analytically
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = NeutralToneMapping;
    renderer.toneMappingExposure = 1;

    const noise = makeNoiseTexture();
    const ripples = makeRippleTexture();
    this.sky = new Sky(noise, { detail: spec.detail });
    this.sky.mesh.layers.set(1);
    this.camera.layers.enable(1);
    this.scene.add(this.sky.mesh);

    this.water = new Water(this.sky, ripples, noise, {
      reflectionScale: spec.reflection,
      salt: spec.salt,
      soften: spec.detail > 0,
    });
    this.scene.add(this.water.mesh);
    this.water.bindCamera(this.camera);

    this.monoliths = new Monoliths(this.scene, this.sky, this.water.uFog, spec.texture);
    this.monoliths.onAspect = () => {
      this.viewKey = "";
    };
    this.wordmark = new Wordmark(this.scene, this.sky, this.water.uFog);
    this.motes = new Motes(
      {
        scene: this.scene,
        pixelAngle: () =>
          (2 * Math.tan((this.camera.fov * DEG) / 2)) /
          Math.max(1, this.size.y * this.dpr * this.renderScale),
      },
      spec.motes,
    );
    this.motes.setMirror(spec.reflection);

    this.buildPost();
    this.setReducedMotion(this.reduced);
    this.camera.rotation.order = "YXZ";
    this.resize();

    return { backend: this.backend, tier: this.tier, gpu: this.gpuName };
  }

  private pickTier(): Tier {
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const coarse = !fine || Math.min(window.screen.width, window.screen.height) < 700;
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
        adapter?: { info?: { vendor?: string; architecture?: string } };
        gl?: WebGL2RenderingContext;
      };
      if (backend.isWebGPUBackend) {
        const info = backend.adapter?.info;
        if (info?.vendor) return [info.vendor, info.architecture].filter(Boolean).join(" / ");
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

  private buildPost() {
    const scenePass = pass(this.scene, this.camera);
    const colour = scenePass.getTextureNode("output");
    this.bloomNode = bloom(colour, 0.3, 0.6, 0.9);
    (this.bloomNode as unknown as { smoothWidth: { value: number } }).smoothWidth.value = 0.3;
    const { uTime, uGrain, uVignette, uScrim, uScrimBand, uFade } = this;
    // runtime method is getTextureNode(); the typings still say getTexture()
    const glow = (this.bloomNode as unknown as { getTextureNode(): N }).getTextureNode();

    const output = Fn(() => {
      const p = screenUV;
      const centred = p.sub(0.5);
      const radial = length(centred.mul(vec2(1, 1.12)));
      const hdr = colour.rgb.add(glow.sample(p).rgb).toVar();

      // a soft shade behind the page text: the lower-left corner on wide
      // screens, the foot of the frame on narrow ones
      const corner = smoothstep(
        0.12,
        1.02,
        length(vec2(p.x, float(1).sub(p.y)).mul(vec2(1.05, 1.5))),
      ).oneMinus();
      const band = smoothstep(0.36, 0.92, p.y).mul(1.25);
      hdr.mulAssign(float(1).sub(mix(corner, band, uScrimBand).mul(uScrim)));

      const vignette = float(1).sub(smoothstep(0.34, 1.0, radial).mul(uVignette));
      hdr.mulAssign(vignette);

      const mapped = renderOutput(vec4(hdr, 1)).rgb.toVar();
      // film grain doubles as dither for the long sky gradients
      const seed = p.mul(screenSize).add(uTime.mul(131.7));
      const grain = hash(seed.x.add(seed.y.mul(1931)).toUint()).sub(0.5);
      mapped.addAssign(vec3(grain.mul(uGrain)));
      mapped.mulAssign(uFade);
      return vec4(mapped, 1);
    });

    this.pipeline = new RenderPipeline(this.renderer, output());
    this.pipeline.outputColorTransform = false;
  }

  /* ------------------------------------------------------------------ */
  /* layout                                                              */
  /* ------------------------------------------------------------------ */

  private view(): View {
    const aspect = this.size.x / Math.max(1, this.size.y);
    // the same rule as the page (App.useNarrow): narrow and upright
    return { aspect, narrow: this.size.x < 900 && aspect <= 1.05 };
  }

  /** Rebuild slab sizes, camera stops and the sun's path for this frame shape. */
  private relayout() {
    const view = this.view();
    const count = this.items.length;
    this.monument = buildMonument();
    this.wordmark.setPose(this.monument);
    const aspects =
      this.monoliths.count === count ? this.monoliths.aspects() : this.items.map(() => 1.5);
    this.slabPoses = buildSlabs(aspects);
    if (this.monoliths.count === count) this.monoliths.setPoses(this.slabPoses);

    const hero = heroPose(this.monument, view);
    const stops = this.slabPoses.map((s) => stationPose(s, view));
    const end = endPose(Math.max(1, count), view);
    const knots = [HERO_P, ...stops.map((_, i) => i), count + 0.25];
    // a cover that turns out taller or wider moves its stop: ease over to it
    this.prevTour = this.tour;
    this.tourBlend = this.tour ? 0 : 1;
    this.tour = new Tour(knots, [hero, ...stops, end]);
    this.details = this.slabPoses.map((s) => detailPose(s, view));

    // the sun leaves through the gap between two letters and returns ahead
    // of the last shot, having gone round behind the walk
    const gap = monumentGap(this.monument);
    const azStart = Math.atan2(gap.x - hero.x, -(gap.z - hero.z));
    let azEnd = azimuthAt(end, view, view.narrow ? 0 : 0.3);
    while (azEnd > azStart) azEnd -= Math.PI * 2;
    this.sky.setSunPath(azStart, azEnd);
    this.uScrimBand.value = view.narrow ? 1 : 0;
    this.endView = { pose: end, view };
    this.arrange();
  }

  /** Scroll progress → the hour (0 sunset … 1 sunrise). */
  private tauFor(p: number) {
    const n = this.items.length;
    const first = 0.045;
    const last = 0.93;
    if (n <= 1) return first * smoothJs(HERO_P, 0, p);
    if (p <= 0) return first * smoothJs(HERO_P, 0, p);
    if (p <= n - 1) return first + (last - first) * (p / (n - 1));
    return last + (1 - last) * smoothJs(n - 1, n + 0.25, p);
  }

  /* ------------------------------------------------------------------ */
  /* choreography API                                                    */
  /* ------------------------------------------------------------------ */

  setWorks(items: WorkItem[]) {
    this.items = items;
    this.slabPoses = buildSlabs(items.map(() => 1.5));
    this.monoliths.setItems(items, this.slabPoses);
    this.viewKey = "";
  }

  setMode(mode: Mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.arrange();
  }

  /** Continuous position along the walk (0 = first work; one unit per work). */
  setProgress(p: number) {
    this.progress = p;
  }

  /** The work the camera has stopped at. */
  setActive(index: number | null) {
    if (index === this.activeIndex) return;
    this.activeIndex = index;
    this.monoliths.setActive(index);
    this.arrange();
    if (index === null) return;
    this.fovKick = this.reduced ? 0 : 1;
    const pose = this.slabPoses[index];
    if (pose && !this.reduced) {
      // the slab wakes: a ring leaves its foot
      this.water.drop(pose.x + Math.sin(pose.yaw) * 0.4, pose.z + Math.cos(pose.yaw) * 0.4, 0.03);
    }
  }

  setDetail(open: boolean) {
    this.detailGoal = open ? 1 : 0;
    if (open && this.activeIndex !== null) this.detailIndex = this.activeIndex;
  }

  /** Start the opening move (called when the loader lifts). */
  intro() {
    this.introGoal = 1;
  }

  setPointer(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((clientY - rect.top) / rect.height) * 2 - 1);
    this.pointerTarget.set(nx, ny);
    this.pointerNdc.set(nx, ny);
    this.pointerDirty = true;
    this.pointerInside = true;
    // a moving pointer stirs the motes; a still one lets them settle
    const last = this.lastPointerClient;
    if (!Number.isNaN(last.x)) {
      const moved = Math.hypot(clientX - last.x, clientY - last.y);
      this.pointerEnergy = Math.min(1, this.pointerEnergy + moved * 0.012);
    }
    last.set(clientX, clientY);
  }

  clearPointer() {
    this.pointerInside = false;
    this.pointerDirty = true;
  }

  /** The work under a point of the page, if any. */
  pick(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((clientY - rect.top) / rect.height) * 2 - 1);
    return this.monoliths.pick(nx, ny, this.camera);
  }

  /** A touch on the water: a ring wave where the pointer is. */
  pulse(strength = 1) {
    this.pointerEnergy = Math.min(1.6, this.pointerEnergy + 0.9 * strength);
    if (!this.waterPoint(this.pointerNdc)) return false;
    this.water.drop(this.hit.x, this.hit.z, 0.045 * strength * (this.reduced ? 0.5 : 1));
    return true;
  }

  private waterPoint(ndc: Vector2) {
    this.raycaster.setFromCamera(ndc, this.camera);
    const point = this.raycaster.ray.intersectPlane(this.waterPlane, this.hit);
    return point !== null && point.distanceTo(this.camera.position) < 70;
  }

  setReducedMotion(reduced: boolean) {
    this.reduced = reduced;
    this.uGrain.value = reduced ? 0.012 : 0.022;
    this.sky?.setReducedMotion(reduced);
    this.water?.setReducedMotion(reduced);
    this.motes?.setReducedMotion(reduced);
    this.arrange();
  }

  setPaused(paused: boolean) {
    if (paused) this.stop();
    else this.start();
  }

  onStats(cb: ((s: StageStats) => void) | null) {
    this.statsCb = cb;
  }
  onLost(cb: ((reason: string) => void) | null) {
    this.lostCb = cb;
  }
  onHover(cb: ((index: number | null) => void) | null) {
    this.hoverCb = cb;
  }
  get isLost() {
    return this.lost;
  }
  /** Progress velocity in works per second (for the soundscape). */
  get velocity() {
    return this.progressVel;
  }
  /** 0 sunset … 1 sunrise. */
  get hour() {
    return this.sky?.tau ?? 0;
  }

  /* ------------------------------------------------------------------ */
  /* the motes: what they gather into                                    */
  /* ------------------------------------------------------------------ */

  /** Decide what the motes should be gathering into right now. */
  private arrange() {
    if (!this.motes) return;
    // With reduced motion nothing swarms across the frame: beyond the
    // opening's sprinkle on the letters, the motes stay in the air.
    const still = this.reduced || this.debug.has("nomotes");
    if (this.mode === "hero") this.gatherWordmark();
    else if (this.mode === "end" && !still) void this.gatherTagline();
    else if (this.mode === "archive" && this.activeIndex !== null && !still)
      void this.gatherCover(this.activeIndex);
    else {
      this.clearVeilTimer();
      this.gathering = "none";
      this.motes.scatter();
    }
  }

  /** Opening: the motes cling to the faces of the steel letters. */
  private gatherWordmark() {
    this.clearVeilTimer();
    const painted = this.motes.painter.paintWordmark(LUM_TEXT);
    const m = this.monument;
    const em = m.width / (WORDMARK_BOX.xMax - WORDMARK_BOX.xMin);
    const right = new Vector3(Math.cos(m.yaw), 0, -Math.sin(m.yaw));
    const normal = new Vector3(Math.sin(m.yaw), 0, Math.cos(m.yaw));
    // the letters stand with their baseline a little under the water
    const baseline = -(-WORDMARK_BOX.yMin + 0.012) * em;
    const centre = new Vector3(
      m.x,
      baseline + ((WORDMARK_BOX.yMin + WORDMARK_BOX.yMax) / 2) * em,
      m.z,
    ).addScaledVector(normal, (DEPTH_EM / 2) * em + 0.14);
    this.gathering = "wordmark";
    this.motes.setTarget({
      key: "text:wordmark",
      aspect: painted.aspect,
      uvScale: painted.uvScale,
      center: centre,
      right,
      up: new Vector3(0, 1, 0),
      width: m.width,
      lumLow: LUM_TEXT[0],
      lumHigh: LUM_TEXT[1],
      relief: 0.05,
      thickness: 0.34,
      feather: 0.004,
      gain: 0.8,
      cover: painted.cover,
    });
  }

  /** At a stop: the motes fly to the slab and draw its cover in light. */
  private async gatherCover(index: number) {
    const item = this.items[index];
    if (!item || !this.slabPoses[index]) return;
    // the walk may move on while the picture loads
    const wanted = () =>
      !this.disposed && this.mode === "archive" && this.activeIndex === index;
    let painted;
    try {
      painted = await this.motes.painter.paintImageUrl(item.url, { lum: LUM_COVER, wanted });
    } catch {
      return; // the cover did not load: the motes stay where they are
    }
    const pose = this.slabPoses[index];
    if (!painted || !pose) return;
    const right = new Vector3(Math.cos(pose.yaw), 0, -Math.sin(pose.yaw));
    const normal = new Vector3(Math.sin(pose.yaw), 0, Math.cos(pose.yaw));
    const centre = new Vector3(pose.x, SLAB_FOOT + pose.height / 2, pose.z).addScaledVector(
      normal,
      THICK / 2 + 0.08,
    );
    const fresh = this.gathering !== "cover" || this.motes.target?.key !== `cover:${item.id}`;
    this.gathering = "cover";
    this.motes.setTarget({
      key: `cover:${item.id}`,
      aspect: painted.aspect,
      uvScale: painted.uvScale,
      center: centre,
      right,
      up: new Vector3(0, 1, 0),
      width: pose.width,
      lumLow: LUM_COVER[0],
      lumHigh: LUM_COVER[1],
      relief: 0.1,
      thickness: 0.12,
      feather: 0.03,
      tint: new Color(item.accent).lerp(new Color(1, 1, 1), 0.9),
      // drawn in light: a dark cover is lifted so its points still read,
      // and a white one is held back so it does not flood the frame
      gain: 0.9 * Math.min(2.4, Math.max(0.6, (0.2 / Math.max(0.01, painted.mean)) ** 0.6)),
      cover: painted.cover,
      delayRand: 0.25,
      delaySweep: 0.4,
    });
    if (!fresh) return;
    // the slab's own light steps back while the motes draw its cover
    this.monoliths.draw(index);
    // once the picture has drawn itself, most of the motes let go again and
    // only a shimmering veil stays on the glass
    this.clearVeilTimer();
    this.coverHold = 1;
    this.veilTimer = window.setTimeout(() => {
      this.veilTimer = null;
      this.coverHold = 0.07;
    }, 1850);
  }

  /** Ending: the motes write the last line into the dawn sky. */
  private async gatherTagline() {
    this.clearVeilTimer();
    // On a narrow screen the closing words fill the frame: there is no sky
    // left to write on, so the motes stay in the air.
    if (this.endView?.view.narrow) {
      this.gathering = "none";
      this.motes.scatter();
      return;
    }
    const painted = await this.motes.painter.paintText(
      "tagline",
      "好奇心に、完成はない。",
      {
        font: '600 220px "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, "Noto Sans JP", sans-serif',
        width: 2048,
        height: 384,
        fill: ["#f2f4ff", "#fff0dc"],
      },
      { lum: LUM_TEXT, wanted: () => !this.disposed && this.mode === "end" },
    );
    if (!painted || !this.endView) return;
    const { pose, view } = this.endView;
    const v = (pose.fov * DEG) / 2;
    const h = Math.atan(Math.tan(v) * view.aspect);
    const cy = Math.cos(pose.yaw);
    const sy = Math.sin(pose.yaw);
    const cp = Math.cos(pose.pitch);
    const sp = Math.sin(pose.pitch);
    const forward = new Vector3(-sy * cp, sp, -cy * cp);
    const right = new Vector3(cy, 0, -sy);
    const up = new Vector3(sy * sp, cp, cy * sp);
    // high in the frame, where the sky is still dark enough to write on
    const distance = 42;
    const x0 = 0.4;
    const y0 = 0.5;
    const centre = new Vector3(pose.x, pose.y, pose.z)
      .addScaledVector(forward, distance)
      .addScaledVector(right, x0 * Math.tan(h) * distance)
      .addScaledVector(up, y0 * Math.tan(v) * distance);
    this.gathering = "tagline";
    this.motes.setTarget({
      key: "text:tagline",
      aspect: painted.aspect,
      uvScale: painted.uvScale,
      center: centre,
      right,
      up,
      width: 2 * Math.tan(h) * distance * 0.5,
      lumLow: LUM_TEXT[0],
      lumHigh: LUM_TEXT[1],
      relief: 0.03,
      thickness: 0.5,
      feather: 0.004,
      gain: 1.4,
      cover: painted.cover,
      // written from left to right, like a hand
      delayRand: 0.2,
      delaySweep: 1.4,
    });
  }

  private clearVeilTimer() {
    if (this.veilTimer !== null) {
      window.clearTimeout(this.veilTimer);
      this.veilTimer = null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* loop                                                                */
  /* ------------------------------------------------------------------ */

  start() {
    if (this.running || this.disposed || this.lost) return;
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
    this.renderer?.setAnimationLoop(null);
  }

  /** One frame by hand (tests, captures); `advance` moves the scene clock. */
  step(dt = 1 / 60) {
    // outside the animation loop the node frame does not advance by itself
    const nodes = (this.renderer as unknown as { _nodes?: { nodeFrame?: { update(): void } } })
      ._nodes;
    nodes?.nodeFrame?.update();
    this.frame(dt);
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return false;
    this.dpr = Math.min(window.devicePixelRatio || 1, TIERS[this.tier].dpr);
    const changed = this.size.x !== w || this.size.y !== h;
    this.size.set(w, h);
    this.camera.aspect = w / h;
    // resizing the drawing buffer is not free: only when something changed
    const ratio = this.dpr * this.renderScale;
    if (changed || ratio !== this.appliedRatio) {
      this.appliedRatio = ratio;
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(w, h, false);
    }
    const view = this.view();
    const key = `${view.aspect.toFixed(3)}|${view.narrow}|${this.items.length}`;
    if (changed || key !== this.viewKey) {
      this.viewKey = key;
      this.relayout();
    }
    return true;
  }

  private frame(dtRaw: number) {
    if (this.disposed || this.lost) return;
    if (!this.resize()) return;
    const dt = clampNum(dtRaw, 1 / 240, 1 / 20);
    this.simTime += dt;
    const time = this.simTime;
    this.uTime.value = time;

    // --- the walk ---------------------------------------------------------
    const prev = this.smoothProgress;
    const k = 1 - Math.exp(-dt * (this.reduced ? 9 : 4.2));
    this.smoothProgress += (this.progress - this.smoothProgress) * k;
    this.progressVel = (this.smoothProgress - prev) / dt;
    this.detailT += (this.detailGoal - this.detailT) * (1 - Math.exp(-dt * (this.reduced ? 12 : 4.6)));
    if (this.introGoal > this.introT)
      this.introT = Math.min(1, this.introT + dt / (this.reduced ? 0.4 : 3.4));
    this.uFade.value = easeOut(this.introT * 2.2);

    // --- the hour ---------------------------------------------------------
    const tau = this.fixedTau ?? this.tauFor(this.smoothProgress);
    this.sky.setTime(tau);
    // the sky hurries while the walk moves: a night goes by in a few steps
    this.cloudDrift +=
      dt * (this.reduced ? 0.3 : 1 + Math.min(14, Math.abs(this.progressVel) * 9));
    this.sky.update(time, this.cloudDrift, -this.camera.rotation.y);
    this.uScrim.value = this.debug.has("scrim")
      ? 1.6
      : this.sky.scrim * (this.mode === "end" ? 1 : 0.92);
    (this.bloomNode as unknown as { strength: { value: number } }).strength.value =
      0.2 + 0.24 * this.sky.starlight;

    // --- camera -----------------------------------------------------------
    const tour = this.tour;
    if (tour) {
      const pose = tour.at(this.smoothProgress);
      if (this.tourBlend < 1 && this.prevTour) {
        this.tourBlend = Math.min(1, this.tourBlend + dt / 0.7);
        const from = this.prevTour.at(this.smoothProgress);
        const b = easeInOut(this.tourBlend);
        let fromYaw = from.yaw;
        while (fromYaw - pose.yaw > Math.PI) fromYaw -= Math.PI * 2;
        while (fromYaw - pose.yaw < -Math.PI) fromYaw += Math.PI * 2;
        pose.x = from.x + (pose.x - from.x) * b;
        pose.y = from.y + (pose.y - from.y) * b;
        pose.z = from.z + (pose.z - from.z) * b;
        pose.yaw = fromYaw + (pose.yaw - fromYaw) * b;
        pose.pitch = from.pitch + (pose.pitch - from.pitch) * b;
        pose.fov = from.fov + (pose.fov - from.fov) * b;
        if (this.tourBlend >= 1) this.prevTour = null;
      }
      const d = easeInOut(this.detailT);
      const detail = this.details[this.detailIndex];
      if (d > 0.001 && detail) {
        let yaw = detail.yaw;
        while (yaw - pose.yaw > Math.PI) yaw -= Math.PI * 2;
        while (yaw - pose.yaw < -Math.PI) yaw += Math.PI * 2;
        pose.x += (detail.x - pose.x) * d;
        pose.y += (detail.y - pose.y) * d;
        pose.z += (detail.z - pose.z) * d;
        pose.yaw += (yaw - pose.yaw) * d;
        pose.pitch += (detail.pitch - pose.pitch) * d;
        pose.fov += (detail.fov - pose.fov) * d;
      }
      // opening: come down out of the sky's reflection to eye level
      const lift = 1 - easeOut(this.introT);
      pose.y += lift * 7;
      pose.pitch -= lift * 15 * DEG;
      pose.fov += lift * 8;

      this.pointerSmoothed.lerp(this.pointerTarget, 1 - Math.exp(-dt * 5));
      const px = this.pointerSmoothed.x;
      const py = this.pointerSmoothed.y;
      const sway = this.reduced ? 0 : 1;
      const look = this.reduced ? 0.3 : 1;
      const rightX = Math.cos(pose.yaw);
      const rightZ = -Math.sin(pose.yaw);
      const shift = px * 0.22 * look + Math.sin(time * 0.31) * 0.035 * sway;
      this.camera.position.set(
        pose.x + rightX * shift,
        Math.max(0.25, pose.y + py * 0.05 * look + Math.sin(time * 0.43) * 0.012 * sway),
        pose.z + rightZ * shift,
      );
      this.camera.rotation.set(
        pose.pitch + py * 0.9 * DEG * look + Math.sin(time * 0.27) * 0.08 * DEG * sway,
        pose.yaw - px * 1.5 * DEG * look + Math.sin(time * 0.19) * 0.12 * DEG * sway,
        Math.sin(time * 0.23) * 0.06 * DEG * sway,
      );
      this.fovKick *= Math.exp(-dt * 3);
      const fov = pose.fov - this.fovKick * 1.4;
      if (Math.abs(this.camera.fov - fov) > 0.005) this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
      this.camera.updateMatrixWorld();
    }
    this.sky.followCamera(this.camera.position);
    this.sky.setPixelAngle(
      (this.camera.fov * DEG) / Math.max(1, this.size.y * this.dpr * this.renderScale),
    );

    // --- pointer: hover and ripples ---------------------------------------
    if (this.pointerDirty) {
      this.pointerDirty = false;
      const hover =
        this.pointerInside && this.detailGoal === 0
          ? this.monoliths.pick(this.pointerNdc.x, this.pointerNdc.y, this.camera)
          : null;
      if (hover !== this.monoliths.hovered) {
        this.monoliths.setHover(hover);
        this.hoverCb?.(hover);
      }
      if (this.pointerInside && !this.reduced && this.waterPoint(this.pointerNdc)) {
        const moved = this.hit.distanceTo(this.lastDrop);
        if (moved > 0.7 && time - this.lastDropTime > 0.09) {
          this.water.drop(this.hit.x, this.hit.z, clampNum(moved * 0.006, 0.006, 0.016));
          this.lastDrop.copy(this.hit);
          this.lastDropTime = time;
        }
      }
    }

    this.monoliths.setFocus(clampNum(Math.round(this.smoothProgress), 0, Math.max(0, this.items.length - 1)));
    this.monoliths.update(dt, time);
    this.water.update(time, this.camera, this.sky);
    this.updateMotes(dt, time);

    if (this.debug.has("nopost")) this.renderer.render(this.scene, this.camera);
    else this.pipeline.render();

    // --- adaptive quality (frames after a stall are not counted) -----------
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
          if (this.slowWindows >= 3 && this.renderScale > 0.5) {
            this.slowWindows = 0;
            this.renderScale = Math.max(0.5, this.renderScale - 0.12);
          }
        } else {
          this.slowWindows = 0;
          if (avg < 1 / 75 && this.renderScale < 1)
            this.renderScale = Math.min(1, this.renderScale + 0.08);
        }
      }
      this.emitStats();
    }
  }

  /** The motes: how firmly they hold their picture, the pointer, the hour. */
  private updateMotes(dt: number, time: number) {
    const motes = this.motes;
    let wave = 0;
    let wavePos = 0;
    if (this.debug.has("nomotes")) {
      motes.setFormedScale(0);
      motes.scatter();
    } else if (this.gathering === "wordmark") {
      // Gathered on the letters while the curtain is down; once the camera
      // lands only a sprinkle stays, and now and then a gust of them crosses
      // the letters and lets go again. All gone as the walk leaves.
      const settle = smoothJs(0.72, 1, this.introT);
      const stay = 1 - smoothJs(HERO_P, HERO_P * 0.45, this.smoothProgress);
      motes.setFormedScale((1 - settle * (1 - GUST.rest)) * stay);
      if (!this.reduced) {
        const phase = (time % GUST.period) / GUST.travel;
        wave = GUST.amount * settle * stay;
        wavePos = -GUST.reach + 2 * GUST.reach * Math.min(1, phase);
      }
    } else if (this.gathering === "cover") {
      motes.setFormedScale(this.detailGoal ? 0.03 : this.coverHold);
    } else if (this.gathering === "tagline") {
      motes.setFormedScale(1);
    }
    motes.setWave(wave, wavePos, GUST.width);

    // the pointer, as a ray through the scene
    this.pointerEnergy *= Math.exp(-dt * 2.4);
    this.raycaster.setFromCamera(this.pointerSmoothed, this.camera);
    motes.setPointer(
      this.raycaster.ray.origin,
      this.raycaster.ray.direction,
      this.pointerInside ? this.pointerEnergy : 0,
    );
    motes.setStir(this.reduced ? 0 : clampNum(Math.abs(this.progressVel) * 0.8, 0, 2.2));
    motes.setAmbient(this.sky.starlight, this.sky.sunDirection, this.sky.glitterColor);

    // the lens follows what the motes are doing: near for a cover, far otherwise
    const target = motes.target;
    const want =
      this.gathering !== "none" && target ? this.camera.position.distanceTo(target.center) : 14;
    this.focus += (want - this.focus) * (1 - Math.exp(-dt * 2.5));
    motes.setFocus(this.focus);

    this.forward.set(-Math.sin(this.camera.rotation.y), 0, -Math.cos(this.camera.rotation.y));
    motes.update(this.renderer as never, time, dt, this.camera, this.forward);
  }

  private emitStats() {
    this.statsCb?.({
      backend: this.backend,
      fps: this.fps,
      renderScale: this.renderScale,
      gpu: this.gpuName,
      clock: this.sky.clock,
      phase: this.sky.phase,
      motes: this.debug.has("nomotes") ? 0 : (this.motes?.count ?? 0),
    });
  }

  /** Handles for tuning and tests. */
  get tuning() {
    return {
      bloom: this.bloomNode,
      grain: this.uGrain,
      vignette: this.uVignette,
      scrim: this.uScrim,
      camera: this.camera,
      sky: this.sky,
      water: this.water,
      monoliths: this.monoliths,
      motes: this.motes,
      slabs: this.slabPoses,
      /** Freeze the hour (0..1) regardless of scroll; null follows the walk. */
      setHour: (tau: number | null) => {
        this.fixedTau = tau;
      },
      /** Jump without easing (captures). */
      snap: () => {
        this.smoothProgress = this.progress;
        this.detailT = this.detailGoal;
        this.introT = this.introGoal;
      },
    };
  }

  dispose() {
    this.disposed = true;
    this.stop();
    this.clearVeilTimer();
    this.motes?.dispose();
    this.monoliths?.dispose();
    this.wordmark?.dispose();
    this.water?.dispose();
    this.sky?.dispose();
    this.pipeline?.dispose();
    this.renderer?.dispose();
  }
}
