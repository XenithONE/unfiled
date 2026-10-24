import "@fontsource/syne/800.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "./style.css";
import {
  ACESFilmicToneMapping,
  Matrix4,
  PerspectiveCamera,
  RenderTarget,
  Scene,
  UnsignedByteType,
  Vector2,
  WebGPURenderer,
} from "three/webgpu";
import type { Chapter, Ctx, Look, Tier } from "./engine/chapter";
import { TIER_SCALE, defaultLook, ramp } from "./engine/chapter";
import { Score } from "./engine/audio";
import { Post } from "./engine/post";
import { Rig, makePose } from "./engine/rig";
import { G, setTechnique, techniqueOn } from "./tsl/common";
import { FoamChapter } from "./chapters/foam";
import { GalaxyChapter } from "./chapters/galaxy";
import { ImpactChapter } from "./chapters/impact";
import { KnotChapter } from "./chapters/knot";
import { LivingChapter } from "./chapters/living";
import { MeteorChapter } from "./chapters/meteor";
import { MoonChapter } from "./chapters/moon";
import { NurseryChapter } from "./chapters/nursery";
import { PlanetSystem } from "./chapters/planet";
import { RingsChapter } from "./chapters/rings";
import { Sky } from "./chapters/sky";
import { SunChapter } from "./chapters/sun";
import { WebChapter } from "./chapters/web";
import { Prologue, TitleField } from "./chapters/title";
import { Ui } from "./ui";

interface Hooks {
  step(dt?: number, n?: number): void;
  seek(chapter: number, local?: number): void;
  info(): Record<string, unknown>;
  setTechnique(n: number, on: boolean): void;
  /** Debug: hold the camera at a pose (null releases it). */
  cam(pos: [number, number, number] | null, look?: [number, number, number], fov?: number): void;
  engine: Engine;
}
declare global {
  interface Window {
    __myriad?: Hooks;
  }
}

const params = new URLSearchParams(window.location.search);
const ui = new Ui();
const _buf = new Vector2();

function pickTier(): Tier {
  const q = params.get("tier");
  if (q === "ultra" || q === "high" || q === "mid" || q === "low") return q;
  const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const small = Math.min(window.screen.width, window.screen.height) < 700;
  const memory = (navigator as { deviceMemory?: number }).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 4;
  if (!fine || small) return memory >= 8 && cores >= 8 ? "mid" : "low";
  return memory >= 8 && cores >= 8 ? "ultra" : "high";
}

function reducedMotion() {
  const m = params.get("motion");
  if (m === "full") return false;
  if (m === "reduce") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

class Engine {
  readonly ctx: Ctx;
  readonly chapters: Chapter[];
  readonly sky: Sky;
  readonly starts: number[] = [];
  readonly total: number;
  time = 0;
  playing = true;
  stopMotion = false;
  current = -1;
  private forceEnter = false;
  private prevLocal = 0;
  readonly score: Score;
  renderScale = 1;
  fps = 0;
  /** Debug camera hold. */
  override: { pos: [number, number, number]; look: [number, number, number]; fov: number } | null = null;
  private pose = makePose();
  private look: Look = defaultLook();
  private running = false;
  private lastTs = 0;
  private size = { w: 0, h: 0 };
  private frameAcc = 0;
  private frameN = 0;
  private slow = 0;
  private viewProj = new Matrix4();
  private lastFar = 0;
  private lastNear = 0;

  constructor(ctx: Ctx, chapters: Chapter[], sky: Sky, score: Score) {
    this.ctx = ctx;
    this.score = score;
    this.chapters = chapters;
    this.sky = sky;
    let acc = 0;
    for (const c of chapters) {
      this.starts.push(acc);
      acc += c.duration;
    }
    this.total = acc;
    for (const c of chapters) {
      c.group.visible = false;
      ctx.scene.add(c.group);
    }
  }

  locate(time: number) {
    let i = this.chapters.length - 1;
    while (i > 0 && time < this.starts[i]) i--;
    return { index: i, local: time - this.starts[i] };
  }

  seek(index: number, local = 0) {
    const i = Math.max(0, Math.min(this.chapters.length - 1, index));
    this.time = this.starts[i] + Math.max(0, Math.min(this.chapters[i].duration - 0.01, local));
    this.forceEnter = true;
  }

  stepChapter(dir: 1 | -1) {
    const { index } = this.locate(this.time);
    this.seek((index + dir + this.chapters.length) % this.chapters.length);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTs = 0;
    this.ctx.renderer
      .setAnimationLoop((ts: number) => {
        const dt = this.lastTs ? (ts - this.lastTs) / 1000 : 1 / 60;
        this.lastTs = ts;
        this.frame(dt);
      })
      ?.catch?.((err: unknown) => console.error("MYRIAD: loop stopped", err));
  }

  private resize(): boolean {
    const canvas = this.ctx.renderer.domElement;
    let w = canvas.clientWidth;
    let h = canvas.clientHeight;
    if (w === 0 || h === 0) {
      // a hidden page reports 0×0; keep rendering at the last real size
      w = this.size.w || 1280;
      h = this.size.h || 720;
    }
    if (w !== this.size.w || h !== this.size.h) {
      this.size = { w, h };
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.ctx.renderer.setPixelRatio(dpr * this.renderScale);
      this.ctx.renderer.setSize(w, h, false);
      this.ctx.camera.aspect = w / h;
      this.ctx.camera.updateProjectionMatrix();
    }
    return true;
  }

  private switchTo(index: number, local: number) {
    const ctx = this.ctx;
    const prev = this.chapters[this.current];
    if (prev) {
      prev.exit(ctx);
      prev.group.visible = false;
    }
    this.current = index;
    const next = this.chapters[index];
    next.group.visible = true;
    next.enter(ctx, local);
    ctx.rig.cut();
    ui.chapter(index);
    this.score.setChapter(index);
    this.prevLocal = local;
  }

  /**
   * Frame-scoped nodes (the scene pass) only refresh when the renderer's
   * frame id moves, which only the animation loop does. Manual steps (tests,
   * captures, a hidden page) advance it here.
   */
  private bumpFrame() {
    const nodes = (this.ctx.renderer as unknown as { _nodes?: { nodeFrame?: { update(): void; frameId: number } } })._nodes;
    if (!nodes?.nodeFrame) return;
    nodes.nodeFrame.update();
    (this.ctx.renderer.info as { frame: number }).frame = nodes.nodeFrame.frameId;
  }

  frame(dtRaw: number, manual = false) {
    const ctx = this.ctx;
    if (manual) this.bumpFrame();
    if (!this.resize()) return;
    const dt = Math.min(Math.max(dtRaw, 1 / 240), 1 / 20);
    if (this.playing) {
      this.time += dt;
      if (this.time >= this.total) this.time = this.starts[0] + this.chapters[0].loopEntry;
    }
    const { index, local } = this.locate(this.time);
    if (index !== this.current || this.forceEnter) {
      this.forceEnter = false;
      this.switchTo(index, local);
    }
    const ch = this.chapters[index];
    const sdt = this.playing ? dt : 0;
    if (this.playing) {
      for (const e of ch.events) if (this.prevLocal < e.t && local >= e.t) this.score.event(e.name);
    }
    // a hard cut inside a chapter is not camera motion either
    if (ch.track.cutBetween(this.prevLocal, local)) ctx.rig.cut();
    this.prevLocal = local;

    // #14 stop-motion: animation time advances in 1/12 s steps, camera stays smooth
    const tAnim = this.stopMotion ? Math.floor(local * 12) / 12 : local;
    G.time.value = tAnim;
    G.smoothTime.value = local;
    G.clock.value += dt;
    G.dt.value = sdt;
    ch.update(ctx, tAnim, sdt);

    ch.track.sample(local, this.pose);
    if (this.override) {
      this.pose.pos.set(...this.override.pos);
      this.pose.look.set(...this.override.look);
      this.pose.fov = this.override.fov;
      this.pose.roll = 0;
    }
    ctx.rig.apply(this.pose, dt);

    const look = this.look;
    Object.assign(look, defaultLook());
    ch.look(local, look);
    this.applyLook(ch, local, look);
    this.score.update(dt, look.warp, ctx.rig.velocity.length());

    const cam = ctx.camera;
    cam.updateMatrixWorld();
    this.viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    G.prevViewProj.value.copy(G.viewProj.value);
    G.viewProj.value.copy(this.viewProj);
    G.viewMatrix.value.copy(cam.matrixWorldInverse);
    G.invView.value.copy(cam.matrixWorld);
    G.camPos.value.copy(cam.position);
    G.camVel.value.copy(ctx.rig.velocity);
    G.screen.value.copy(ctx.renderer.getDrawingBufferSize(_buf));
    G.pxPerUnit.value = (0.5 * G.screen.value.y) / Math.tan((cam.fov * Math.PI) / 360);
    G.near.value = cam.near;
    G.far.value = cam.far;

    if (sdt > 0 || this.stopMotion) ch.simulate(ctx, tAnim, sdt);
    ch.prepare(ctx);
    ctx.post.time.value = G.clock.value;
    ctx.post.render();
    G.frame.value = (G.frame.value as number) + 1;
    ui.tick(index, local, this.total);
    this.adapt(dtRaw);
  }

  private captureTarget: RenderTarget | null = null;

  get viewSize() {
    return this.size;
  }

  /**
   * Renders the current state once more into an off-screen target and reads
   * it back (independent of whether the page is being composited).
   */
  async capture(width = 1280) {
    const r = this.ctx.renderer;
    const w = 64 * Math.max(1, Math.round(width / 64));
    const h = Math.max(1, Math.round((w * Math.max(1, this.size.h)) / Math.max(1, this.size.w)));
    let rt = this.captureTarget;
    if (!rt || rt.width !== w || rt.height !== h) {
      rt?.dispose();
      rt = new RenderTarget(w, h, { type: UnsignedByteType });
      this.captureTarget = rt;
    }
    this.bumpFrame();
    r.setRenderTarget(rt);
    this.ctx.post.render();
    r.setRenderTarget(null);
    const px = (await r.readRenderTargetPixelsAsync(rt, 0, 0, w, h)) as Uint8Array;
    const data = new Uint8ClampedArray(w * h * 4);
    data.set(px.subarray(0, w * h * 4));
    return new ImageData(data, w, h);
  }

  private applyLook(ch: Chapter, local: number, look: Look) {
    const { post, camera, renderer } = this.ctx;
    const b = post.bloom as unknown as {
      strength: { value: number };
      radius: { value: number };
      threshold: { value: number };
    };
    b.strength.value = look.bloom[0];
    b.radius.value = look.bloom[1];
    b.threshold.value = look.bloom[2];
    post.bloomGain.value = look.bloomGain;
    post.flare.value = look.flare;
    post.vignette.value = look.vignette;
    post.warp.value = this.ctx.reduced ? look.warp * 0.4 : look.warp;
    post.flash.value = this.ctx.reduced ? look.flash * 0.35 : look.flash;
    post.flashColor.value.setRGB(...look.flashColor);
    post.impact.value = !this.ctx.reduced && techniqueOn(14) ? look.impact : 0;
    const fadeIn = ch.fadeIn > 0 ? ramp(local, 0, ch.fadeIn) : 1;
    const fadeOut = ch.fadeOut > 0 ? 1 - ramp(local, ch.duration - ch.fadeOut, ch.duration) : 1;
    post.fade.value = fadeIn * fadeOut;
    G.fade.value = 1;
    renderer.toneMappingExposure = look.exposure;
    G.focus.value = look.focus;
    G.aperture.value = look.aperture;
    G.warp.value = look.warp;
    this.sky.level.value = look.sky;
    this.sky.setVisible(look.sky > 0.001);
    if (look.near !== this.lastNear || look.far !== this.lastFar) {
      camera.near = look.near;
      camera.far = look.far;
      camera.updateProjectionMatrix();
      this.sky.distance.value = look.far * 0.8;
      this.lastNear = look.near;
      this.lastFar = look.far;
    }
  }

  private adapt(dtRaw: number) {
    if (dtRaw > 0.25 || !this.running) return;
    this.frameAcc += dtRaw;
    this.frameN++;
    if (this.frameN < 60) return;
    const avg = this.frameAcc / this.frameN;
    this.fps = Math.round(1 / Math.max(avg, 1e-3));
    this.frameAcc = 0;
    this.frameN = 0;
    if (avg > 1 / 40) {
      if (++this.slow >= 2 && this.renderScale > 0.5) {
        this.renderScale = Math.max(0.5, this.renderScale - 0.1);
        this.size = { w: 0, h: 0 };
        this.slow = 0;
      }
    } else {
      this.slow = 0;
      if (avg < 1 / 70 && this.renderScale < 1) {
        this.renderScale = Math.min(1, this.renderScale + 0.05);
        this.size = { w: 0, h: 0 };
      }
    }
  }
}

async function boot() {
  const canvas = document.getElementById("c") as HTMLCanvasElement;
  if (!("gpu" in navigator) || !window.isSecureContext) {
    ui.noGpu();
    return;
  }
  ui.progress(0.04, "GPU に接続しています…");
  const renderer = new WebGPURenderer({ canvas, antialias: false, alpha: false });
  try {
    await renderer.init();
  } catch (err) {
    console.error(err);
    ui.noGpu();
    return;
  }
  if (!(renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend) {
    ui.noGpu();
    return;
  }
  renderer.setClearColor(0x000000, 1);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;

  const tier = pickTier();
  const reduced = reducedMotion();
  const scene = new Scene();
  const camera = new PerspectiveCamera(50, 1, 0.05, 6000);
  camera.position.set(0, 0, 30);
  const rig = new Rig(camera);
  rig.reduced = reduced;
  const post = new Post(renderer, scene, camera);
  const ctx: Ctx = { renderer, scene, camera, rig, post, tier, q: TIER_SCALE[tier], reduced };
  renderer.onDeviceLost = (info: { message?: string }) => {
    console.error("MYRIAD: device lost", info);
    ui.toast("GPU との接続が切れました。ページを再読み込みしてください。");
  };

  ui.progress(0.08, "文字を用意しています…");
  try {
    await document.fonts.load("800 200px Syne");
  } catch {
    /* fall back to the system face */
  }

  const sky = new Sky(ctx);
  const title = new TitleField(ctx);
  const prologue = new Prologue(title);
  prologue.setSubtitleHandler((v) => ui.subtitle(v));
  const planet = new PlanetSystem(ctx);
  const galaxy = new GalaxyChapter();
  galaxy.setMarkerHandler((x, y, v) => ui.marker(x, y, v));
  const web = new WebChapter();
  web.setCountHandler((v, n) => ui.counter(v, n));
  const chapters: Chapter[] = [prologue, new SunChapter(), new ImpactChapter(), new LivingChapter(), new MeteorChapter(), new RingsChapter(planet), new MoonChapter(planet), new KnotChapter(), new NurseryChapter(), galaxy, web, new FoamChapter(title, prologue)];

  for (let k = 0; k < chapters.length; k++) {
    ui.progress(0.1 + (0.4 * k) / chapters.length, `場面をつくっています… ${k + 1}/${chapters.length}`);
    await chapters[k].build(ctx);
  }

  const score = new Score();
  const engine = new Engine(ctx, chapters, sky, score);

  // compile every chapter's pipelines up front (one chapter visible at a time)
  for (let k = 0; k < chapters.length; k++) {
    ui.progress(0.5 + (0.5 * k) / chapters.length, `シェーダーを準備しています… ${k + 1}/${chapters.length}`);
    const c = chapters[k];
    for (const o of chapters) o.group.visible = o === c;
    title.mesh.visible = c.id === "prologue";
    c.enter(ctx, 0);
    try {
      await renderer.compileAsync(scene, camera);
    } catch (err) {
      console.warn("MYRIAD: precompile", err);
    }
    c.exit(ctx);
  }
  for (const c of chapters) c.group.visible = false;

  const startCh = Number(params.get("ch") ?? 0);
  const startT = Number(params.get("t") ?? 0);
  engine.seek(startCh, startT);

  window.__myriad = {
    step(dt = 1 / 60, n = 1) {
      for (let k = 0; k < n; k++) engine.frame(dt, true);
    },
    seek(chapter: number, local = 0) {
      engine.seek(chapter, local);
    },
    info() {
      const { index, local } = engine.locate(engine.time);
      const cam = camera.position;
      return {
        chapter: chapters[index].id,
        local: Number(local.toFixed(3)),
        tier,
        q: ctx.q,
        fps: engine.fps,
        renderScale: engine.renderScale,
        camera: [cam.x, cam.y, cam.z].map((v) => Number(v.toFixed(2))),
        reduced,
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
      };
    },
    setTechnique(n: number, on: boolean) {
      setTechnique(n, on);
    },
    cam(pos, look = [0, 0, 0], fov = 50) {
      engine.override = pos ? { pos, look, fov } : null;
    },
    engine,
  };
  if (import.meta.env.DEV) {
    // contact sheet for review: renders each shot and posts one JPEG
    (window.__myriad as unknown as Record<string, unknown>).sheet = async (
      name: string,
      shots: { ch: number; t: number; cam?: [[number, number, number], [number, number, number], number] }[],
      cols = 3,
      w = 480,
    ) => {
      const hk = window.__myriad!;
      const wasPlaying = engine.playing;
      engine.playing = false;
      const images: ImageData[] = [];
      for (const s of shots) {
        hk.seek(s.ch, s.t);
        hk.cam(s.cam ? s.cam[0] : null, s.cam?.[1], s.cam?.[2]);
        hk.step(1 / 60, 3);
        images.push(await engine.capture(w));
      }
      const hh = Math.round((w * images[0].height) / images[0].width);
      const out = document.createElement("canvas");
      out.width = w * cols;
      out.height = hh * Math.ceil(shots.length / cols);
      const g = out.getContext("2d")!;
      const tmp = document.createElement("canvas");
      const tg = tmp.getContext("2d")!;
      images.forEach((img, k) => {
        tmp.width = img.width;
        tmp.height = img.height;
        tg.putImageData(img, 0, 0);
        const x = (k % cols) * w;
        const y = Math.floor(k / cols) * hh;
        g.drawImage(tmp, x, y, w, hh);
        g.fillStyle = "#0f0";
        g.font = "13px monospace";
        g.fillText(`${shots[k].ch}:${shots[k].t}`, x + 6, y + 15);
      });
      hk.cam(null);
      engine.playing = wasPlaying;
      const res = await fetch(`/__capture?name=${encodeURIComponent(name)}`, { method: "POST", body: out.toDataURL("image/jpeg", 0.86) });
      return res.text();
    };
  }

  const start = (withSound: boolean) => {
    ui.begin(
      chapters.map((c) => ({
        numeral: c.numeral,
        name: c.name,
        caption: c.caption,
        duration: c.duration,
        techniques: c.techniques,
      })),
      withSound,
    );
    // inside the click: browsers only allow audio to begin from a gesture
    void score.start(withSound);
    engine.start();
  };

  ui.ready({
    start,
    seekChapter: (i) => engine.seek(i),
    togglePlay: () => (engine.playing = !engine.playing),
    toggleSound: () => {
      if (!score.running) void score.start(true);
      else score.setMuted(!score.isMuted);
      return !score.isMuted;
    },
    setTechnique: (n, on) => setTechnique(n, on),
    techniqueOn: (n) => techniqueOn(n),
    toggleStopMotion: () => (engine.stopMotion = !engine.stopMotion),
    step: (dir) => engine.stepChapter(dir),
    drag: (dx, dy) => rig.drag(dx, dy),
    release: () => rig.release(),
  });

  if (params.get("autostart") === "1") start(false);
}

void boot().catch((err) => {
  console.error(err);
  ui.noGpu(`起動できませんでした：${String((err as Error)?.message ?? err)}`);
});
