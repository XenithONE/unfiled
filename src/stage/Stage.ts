/**
 * Stage — the whole 3D experience behind UNFILED: renderer, camera, the
 * particle Field, the Slabs rail, post-processing and the choreography that
 * ties them to the page (hero → archive → end, detail view, pointer).
 */
import {
  ACESFilmicToneMapping,
  Color,
  PerspectiveCamera,
  RenderPipeline,
  Scene,
  Vector2,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import type { TextureNode } from "three/webgpu";
import {
  float,
  hash,
  length,
  mix,
  pass,
  screenSize,
  screenUV,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { Field } from "./Field";
import type { FieldTarget } from "./Field";
import { Slabs } from "./Slabs";
import type { SlabItem } from "./Slabs";
import type { TextOptions } from "./targets";

export type Tier = "ultra" | "high" | "mid" | "low";
export type Mode = "hero" | "archive" | "end";

export interface StageStats {
  backend: "webgpu" | "webgl2";
  count: number;
  fps: number;
  renderScale: number;
  gpu: string;
}

const TIER_GRID: Record<Tier, [number, number]> = {
  ultra: [1024, 1024],
  high: [768, 768],
  mid: [512, 512],
  low: [384, 384],
};

const CAMERA_Z = 10;
const FOV = 36;
const SPACING = 4.6;

const clampNum = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

export class Stage {
  readonly canvas: HTMLCanvasElement;
  private renderer!: WebGPURenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(FOV, 1, 0.1, 120);
  private pipeline!: RenderPipeline;
  field!: Field;
  slabs!: Slabs;

  tier: Tier = "mid";
  backend: "webgpu" | "webgl2" = "webgpu";
  gpuName = "";

  // post uniforms
  private uTime = uniform(0);
  private uGrain = uniform(0.012);
  private uVignette = uniform(0.55);
  private uAberration = uniform(0.0018);
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
  private frameAccum = 0;
  private frameCount = 0;
  private fps = 0;
  private slowWindows = 0;
  private statsCb: ((s: StageStats) => void) | null = null;
  private lostCb: ((reason: string) => void) | null = null;
  private debug = new Set(
    (new URLSearchParams(window.location.search).get("dbg") ?? "")
      .split(",")
      .filter(Boolean),
  );

  // choreography
  private mode: Mode = "hero";
  private progress = -1;
  private smoothProgress = -1;
  private progressVel = 0;
  private activeIndex: number | null = null;
  private detailOpen = false;
  private heroDissolve = 0;
  private heroOffset = 0;
  private fovKick = 0;
  private items: SlabItem[] = [];
  private releaseTimer: number | null = null;
  private pointerTarget = new Vector2();
  private pointerSmoothed = new Vector2();
  private pointerEnergy = 0;
  private lastPointerClient = new Vector2(NaN, NaN);
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

    renderer.setClearColor(0x050608, 1);
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    this.camera.position.set(0, 0, CAMERA_Z);
    this.camera.lookAt(0, 0, 0);

    this.field = new Field(
      {
        scene: this.scene,
        camera: this.camera,
        pixelsPerUnit: () =>
          (this.size.y * this.dpr * this.renderScale) / this.visibleHeight,
      },
      TIER_GRID[this.tier],
    );
    this.slabs = new Slabs(this.scene, this.camera);
    this.buildPost();
    this.field.setReducedMotion(this.reduced);
    this.resize();
    void this.showText("hero");

    return {
      backend: this.backend,
      count: this.field.count,
      tier: this.tier,
      gpu: this.gpuName,
    };
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

  private buildPost() {
    const scenePass = pass(this.scene, this.camera);
    const color = scenePass.getTextureNode("output");
    this.bloomNode = bloom(color, 0.55, 0.55, 0.35);
    const uvN = screenUV;
    const centered = uvN.sub(0.5);
    const radial = length(centered.mul(vec2(1, 1.15)));
    const aberr = centered.mul(this.uAberration.mul(radial.mul(8)));
    // runtime method is getTextureNode(); the typings still say getTexture()
    const bloomTex = (
      this.bloomNode as unknown as { getTextureNode(): TextureNode }
    ).getTextureNode();
    const glow = vec3(
      bloomTex.sample(uvN.add(aberr)).r,
      bloomTex.sample(uvN).g,
      bloomTex.sample(uvN.sub(aberr)).b,
    );
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
  get narrow() {
    return this.size.x < 900;
  }

  /** Where the active slab (and the particle formation) sits. */
  private focusPoint() {
    const vw = this.visibleWidth;
    const vh = this.visibleHeight;
    return this.narrow ? new Vector3(0, vh * 0.17, 0) : new Vector3(vw * 0.235, 0, 0);
  }

  /** World height of a slab / cover formation at the focus point. */
  private slabHeight(aspect: number) {
    const vw = this.visibleWidth;
    const vh = this.visibleHeight;
    let width = vw * (this.narrow ? 0.86 : 0.46);
    let height = width / aspect;
    const maxH = vh * (this.narrow ? 0.36 : 0.74);
    if (height > maxH) {
      height = maxH;
      width = height * aspect;
    }
    return height;
  }

  private detailPose() {
    const vw = this.visibleWidth;
    const vh = this.visibleHeight;
    // closer to the camera: world units at z=2.5 are 0.75× as large on screen
    return this.narrow
      ? { position: new Vector3(0, vh * 0.2, 2.5), scale: 0.78 }
      : { position: new Vector3(-vw * 0.19, 0, 2.5), scale: 0.86 };
  }

  private textLayout(kind: "hero" | "end", aspect: number) {
    const vw = this.visibleWidth;
    const vh = this.visibleHeight;
    if (kind === "hero") {
      let width = vw * (this.narrow ? 0.94 : 0.9);
      let height = width / aspect;
      const maxH = vh * (this.narrow ? 0.34 : 0.46);
      if (height > maxH) {
        height = maxH;
        width = height * aspect;
      }
      return { center: [0, vh * (this.narrow ? 0.14 : 0.1), 0] as [number, number, number], height };
    }
    let width = vw * (this.narrow ? 0.92 : 0.46);
    let height = width / aspect;
    const maxH = vh * (this.narrow ? 0.26 : 0.4);
    if (height > maxH) {
      height = maxH;
      width = height * aspect;
    }
    const center: [number, number, number] = this.narrow
      ? [0, -vh * 0.22, 0]
      : [vw * 0.235, 0, 0];
    return { center, height };
  }

  /* ------------------------------------------------------------------ */
  /* choreography API                                                    */
  /* ------------------------------------------------------------------ */

  setWorks(items: SlabItem[]) {
    this.items = items;
    this.slabs.setItems(items);
    this.applySlabPose();
  }

  setMode(mode: Mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.clearReleaseTimer();
    if (mode === "hero") {
      this.activeIndex = null;
      this.slabs.setActive(null);
      void this.showText("hero");
    } else if (mode === "end") {
      this.activeIndex = null;
      this.slabs.setActive(null);
      void this.showText("end");
    } else {
      this.field.setFormedScale(1);
      if (this.activeIndex === null) this.field.scatter();
    }
  }

  /** Continuous position along the rail (0 = first work at the focus). */
  setProgress(p: number) {
    this.progress = p;
  }

  /** The work at the focus point; null scatters the field. */
  setActive(index: number | null) {
    if (index === this.activeIndex && this.mode === "archive") return;
    this.activeIndex = index;
    this.clearReleaseTimer();
    if (index === null) {
      this.slabs.setActive(null);
      this.field.scatter();
      return;
    }
    const item = this.items[index];
    if (!item) return;
    this.fovKick = this.reduced ? 0 : 1;
    this.slabs.setActive(index, 0.5);
    for (let d = 1; d <= 3; d++) this.slabs.prefetch(index + d);
    this.field.setFormedScale(1);
    void this.field.painter.paintImageUrl(item.url).then((painted) => {
      if (this.activeIndex !== index || this.mode !== "archive") return;
      const focus = this.focusPoint();
      const height = this.slabHeight(painted.aspect);
      const tint = new Color(item.accent).lerp(new Color(1, 1, 1), 0.82);
      this.field.setTarget({
        key: `cover:${item.id}`,
        aspect: painted.aspect,
        uvScale: painted.uvScale,
        center: [focus.x, focus.y, focus.z],
        height,
        lumLow: 0.03,
        lumHigh: 0.3,
        relief: 0.45,
        thickness: 0.18,
        feather: 0.05,
        tint,
        gain: this.narrow ? 1.3 : 1.7,
        cover: painted.cover,
      });
      // once the picture has condensed, let most of the dust go again so the
      // crisp slab shows through a shimmering veil
      this.releaseTimer = window.setTimeout(() => {
        if (this.activeIndex === index && !this.detailOpen) this.field.setFormedScale(0.32);
      }, 1700);
    });
  }

  setDetail(open: boolean) {
    if (open === this.detailOpen) return;
    this.detailOpen = open;
    this.slabs.setDetail(open);
    const pose = this.detailPose();
    this.slabs.setDetailPose(pose.position, pose.scale);
    if (open) {
      this.clearReleaseTimer();
      this.field.setFormedScale(0);
      this.pulse(0.8);
    } else if (this.activeIndex !== null) {
      this.field.setFormedScale(0.32);
    }
  }

  /** 0..1 — how far the hero wordmark has dissolved (scroll driven). */
  setHeroDissolve(v: number, offsetY: number) {
    this.heroDissolve = clampNum(v, 0, 1);
    this.heroOffset = offsetY;
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
    this.pointerTarget.set(nx, ny);
    const last = this.lastPointerClient;
    if (!Number.isNaN(last.x)) {
      const moved = Math.hypot(clientX - last.x, clientY - last.y);
      this.pointerEnergy = Math.min(1, this.pointerEnergy + moved * 0.012);
    }
    last.set(clientX, clientY);
  }

  pulse(strength = 1) {
    this.pointerEnergy = Math.min(1.6, this.pointerEnergy + strength);
  }

  setReducedMotion(reduced: boolean) {
    this.reduced = reduced;
    this.field?.setReducedMotion(reduced);
    this.uGrain.value = reduced ? 0.006 : 0.012;
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
  get isLost() {
    return this.lost;
  }
  get activeCount() {
    return this.field?.activeCount ?? 0;
  }
  get currentMode() {
    return this.mode;
  }

  /* ------------------------------------------------------------------ */
  /* text targets                                                        */
  /* ------------------------------------------------------------------ */

  private async showText(kind: "hero" | "end") {
    const key = kind === "hero" ? "wordmark" : "tagline";
    const opts: TextOptions =
      kind === "hero"
        ? {
            font: "800 400px Syne, 'Arial Black', sans-serif",
            width: 2048,
            height: 520,
            letterSpacing: "-0.035em",
            fill: ["#fff4e4", "#ffb48a"],
          }
        : {
            font: '600 220px "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, "Noto Sans JP", sans-serif',
            width: 2048,
            height: 384,
            fill: ["#eef2ff", "#f3efe6"],
          };
    const text = kind === "hero" ? "UNFILED" : "好奇心に、完成はない。";
    const painted = await this.field.painter.paintText(key, text, opts);
    if (this.mode !== kind) return;
    const layout = this.textLayout(kind, painted.aspect);
    const target: FieldTarget = {
      key: `text:${key}`,
      aspect: painted.aspect,
      uvScale: painted.uvScale,
      center: layout.center,
      height: layout.height,
      lumLow: 0.08,
      lumHigh: 0.5,
      relief: kind === "hero" ? 0.05 : 0.03,
      thickness: kind === "hero" ? 0.5 : 0.3,
      feather: 0.01,
      gain: kind === "hero" ? 1.3 : 1.2,
      cover: painted.cover,
    };
    this.field.setTarget(target);
    this.field.setFormedScale(kind === "hero" ? 1 - this.heroDissolve : 1);
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
    if (changed) {
      this.applySlabPose();
      this.relayoutTarget();
    }
    this.field.applyDensity();
    return true;
  }

  private applySlabPose() {
    const focus = this.focusPoint();
    this.slabs.setPose({
      focus,
      height: this.slabHeight(1.5),
      sway: this.narrow ? 0.45 : 1,
    });
    const pose = this.detailPose();
    this.slabs.setDetailPose(pose.position, pose.scale);
  }

  private relayoutTarget() {
    const t = this.field.target;
    if (!t) return;
    if (t.key.startsWith("text:")) {
      const kind = t.key === "text:wordmark" ? "hero" : "end";
      const layout = this.textLayout(kind, t.aspect);
      this.field.setTarget({ ...t, center: layout.center, height: layout.height });
    } else {
      const focus = this.focusPoint();
      this.field.setTarget({
        ...t,
        center: [focus.x, focus.y, focus.z],
        height: this.slabHeight(t.aspect),
      });
    }
  }

  private frame(dtRaw: number) {
    if (this.disposed || this.lost) return;
    if (!this.resize()) return;
    const dt = clampNum(dtRaw, 1 / 240, 1 / 30);
    this.simTime += dt;
    this.uTime.value = this.simTime;

    // rail motion: smoothed progress, velocity feeds the dust stream
    const prev = this.smoothProgress;
    const k = 1 - Math.exp(-dt * (this.reduced ? 9 : 5.5));
    this.smoothProgress += (this.progress - this.smoothProgress) * k;
    this.progressVel = (this.smoothProgress - prev) / dt;
    this.slabs.setProgress(this.smoothProgress);
    const flowZ = clampNum(this.progressVel * SPACING * 0.9, -14, 14);
    this.field.setFlow(0, 0, this.mode === "hero" ? 0.3 : flowZ + 0.25);
    this.slabs.setHeroDim(this.mode === "hero" ? 1 - this.heroDissolve * 0.6 : 0);

    // hero wordmark rides and dissolves with the page
    if (this.mode === "hero") {
      this.field.setFormedScale(1 - this.heroDissolve);
      this.field.setOffset(0, this.heroOffset, 0);
    } else {
      this.field.setOffset(0, 0, 0);
    }

    // pointer: parallax camera, repulsion in world units at the focus plane
    this.pointerSmoothed.lerp(this.pointerTarget, 1 - Math.exp(-dt * 10));
    const px = this.pointerSmoothed.x;
    const py = this.pointerSmoothed.y;
    this.pointerEnergy *= Math.exp(-dt * 2.4);
    this.field.setPointer(
      (px * this.visibleWidth) / 2,
      (py * this.visibleHeight) / 2,
      this.pointerEnergy,
    );
    this.slabs.setTilt(px, py);
    const par = this.reduced ? 0.08 : 0.3;
    this.camera.position.set(px * par, py * par * 0.7, CAMERA_Z);
    this.camera.lookAt(px * par * 0.35, py * par * 0.25, 0);
    this.fovKick *= Math.exp(-dt * 3.2);
    const fov = FOV - this.fovKick * 2.6;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    // scroll kick stirs the field
    const sv = this.scrollVelocity;
    this.scrollVelocity *= Math.exp(-dt * 6);
    this.field.setScrollKick(
      clampNum(
        (Math.abs(sv) / Math.max(1, this.size.y)) * (this.reduced ? 1.5 : 5),
        0,
        this.reduced ? 0.6 : 2.2,
      ),
    );

    if (!this.debug.has("nosim")) this.field.update(this.renderer as never, this.simTime, dt);
    this.slabs.update(dt, this.simTime);
    if (this.debug.has("nopost")) this.renderer.render(this.scene, this.camera);
    else this.pipeline.render();

    // adaptive quality (frames after a stall are not counted)
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
            if (this.field.activeCount > 262144) {
              this.field.setActiveCount(
                Math.max(262144, Math.floor(this.field.activeCount * 0.6)),
              );
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
        count: this.field.activeCount,
        fps: this.fps,
        renderScale: this.renderScale,
        gpu: this.gpuName,
      });
    }
  }

  private clearReleaseTimer() {
    if (this.releaseTimer !== null) {
      window.clearTimeout(this.releaseTimer);
      this.releaseTimer = null;
    }
  }

  /** Progress velocity in works per second (for the soundscape). */
  get velocity() {
    return this.progressVel;
  }

  /** Read a particle buffer back (tests). */
  readBuffer(name: string) {
    return this.field.readBuffer(this.renderer as never, name);
  }

  get tuning() {
    return {
      ...this.field.tuning,
      bloom: this.bloomNode,
      grain: this.uGrain,
      vignette: this.uVignette,
      aberration: this.uAberration,
      camera: this.camera,
    };
  }

  dispose() {
    this.disposed = true;
    this.stop();
    this.clearReleaseTimer();
    this.slabs?.dispose();
    this.field?.dispose();
    this.pipeline?.dispose();
    this.renderer?.dispose();
  }
}
