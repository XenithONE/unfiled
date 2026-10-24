/**
 * Prologue — the word MYRIAD is a picture, and every pixel of it a grain.
 *
 * #26 one texture, many attributes: RGB is the colour, luminance the size
 *     (black pixels get size 0 and vanish), R and G the burst velocity.
 * #16 morph between two point sets with a per-particle hashed delay.
 * #18 the analytic damped spring e^(−at)·cos(ωt) snaps grains into place.
 * #22 the grains change shape with age: square pixel → disc → star.
 * #9  velocity stretch while they fly; #14 impact frames on 12 fps time.
 */
import { AdditiveBlending, CanvasTexture, MeshBasicNodeMaterial, NoColorSpace, Vector3 } from "three/webgpu";
import type { Mesh } from "three/webgpu";
import {
  abs,
  clamp,
  cos,
  exp,
  float,
  floor,
  instanceIndex,
  length,
  luminance,
  max,
  mix,
  normalize,
  pow,
  select,
  sign,
  smoothstep,
  texture,
  uint,
  uniform,
  vec2,
  vec3,
} from "../tsl/t";
import type { Ctx, Look } from "../engine/chapter";
import { Chapter, pulse, ramp } from "../engine/chapter";
import { particleMesh } from "../engine/quad";
import { Track } from "../engine/rig";
import { G, T, gauss, rnd } from "../tsl/common";
import { snoiseGrad } from "../tsl/noise";
import { fillSdf, morphSdf, spriteVertex } from "../tsl/sprite";

const WORD = "MYRIAD";

/** Paints the word with an RG ramp (R = x, G = y) and textured luminance. */
function paintWord(W: number, H: number): HTMLCanvasElement {
  const mask = document.createElement("canvas");
  mask.width = W;
  mask.height = H;
  const g = mask.getContext("2d", { willReadFrequently: true })!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, W, H);
  let size = H * 0.8;
  g.font = `800 ${size}px Syne, "Arial Black", sans-serif`;
  const w = g.measureText(WORD).width;
  size *= Math.min(1, (W * 0.94) / w);
  g.font = `800 ${size}px Syne, "Arial Black", sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#fff";
  g.fillText(WORD, W / 2, H * 0.53);
  const src = g.getImageData(0, 0, W, H);

  const out = g.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const m = src.data[i] / 255;
      if (m < 0.02) continue;
      const u = x / W;
      const v = 1 - y / H;
      // luminance texture inside the glyphs: soft waves + rare sparkles
      const wave = 0.72 + 0.28 * Math.sin(u * 37 + Math.sin(v * 9) * 2.2) * Math.sin(v * 23 + u * 5);
      const sparkle = Math.random() < 0.018 ? 1.35 : 1;
      const k = m * Math.min(1.35, wave * sparkle);
      out.data[i] = Math.min(255, (0.28 + 0.72 * u) * 255 * k);
      out.data[i + 1] = Math.min(255, (0.28 + 0.72 * v) * 255 * k);
      out.data[i + 2] = Math.min(255, 0.92 * 255 * k);
      out.data[i + 3] = 255;
    }
  }
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  c.getContext("2d")!.putImageData(out, 0, 0);
  return c;
}

export class TitleField {
  readonly mesh: Mesh;
  readonly W: number;
  readonly H: number;
  /** Seconds since assembly began (negative: still at the source). */
  readonly assemble = uniform(-1);
  /** Seconds since the burst (negative: no burst yet). */
  readonly burst = uniform(-1);
  readonly level = uniform(0);
  /** 0: born from a point; 1: from a sphere shell. */
  readonly mode = uniform(0);
  readonly srcCenter = uniform(new Vector3());
  readonly srcRadius = uniform(0.12);
  readonly textCenter = uniform(new Vector3());
  readonly width = uniform(18);
  /** 1 while impact frames run (#14). */
  readonly quant = uniform(0);
  readonly speed = uniform(30);
  readonly tex: CanvasTexture;

  constructor(ctx: Ctx) {
    this.W = ctx.q >= 0.6 ? 2048 : ctx.q >= 0.3 ? 1536 : 1024;
    this.H = this.W / 4;
    this.tex = new CanvasTexture(paintWord(this.W, this.H));
    this.tex.colorSpace = NoColorSpace;
    this.mesh = this.build();
    this.mesh.visible = false;
    ctx.scene.add(this.mesh);
  }

  private build(): Mesh {
    const { W, H } = this;
    const i = instanceIndex;
    const ix = i.mod(uint(W)).toFloat();
    const iy = i.div(uint(W)).toFloat();
    const uvT = vec2(ix.add(0.5).div(W), iy.add(0.5).div(H)).toVar();
    const c = texture(this.tex, uvT).level(0).rgb.toVar();
    const lum = luminance(c).toVar(); // #26 luminance → size

    const texel = this.width.div(W);
    const textPos = this.textCenter
      .add(vec3(uvT.x.sub(0.5).mul(this.width), uvT.y.sub(0.5).mul(this.width.mul(H / W)), rnd(i, 0).sub(0.5).mul(this.width.mul(0.014))))
      .toVar();

    // source: a point (prologue) or a sphere shell (finale)
    const dir = normalize(vec3(gauss(i, 1), gauss(i, 3), gauss(i, 5)).add(vec3(0, 0, 1e-4)));
    const shellR = mix(this.srcRadius.mul(rnd(i, 7).pow(0.33)), this.srcRadius, this.mode);
    const src = this.srcCenter.add(dir.mul(shellR));

    // #16 morph with hashed delay (+ a left-to-right sweep); #18 damped spring
    const delay = mix(float(0), rnd(i, 8).mul(0.9).add(uvT.x.mul(0.75)), T(16));
    const tau = max(this.assemble.sub(delay), 0).mul(0.95).toVar();
    const spring = float(1).sub(exp(tau.mul(-4.2)).mul(cos(tau.mul(8.8))));
    const eased = smoothstep(0, 1, tau.mul(0.8));
    const x = mix(eased, spring, T(18));
    const assembled = mix(src, textPos, select(this.assemble.lessThan(0), float(0), x)).toVar();
    const shimmer = snoiseGrad(textPos.mul(0.55).add(vec3(0, 0, G.clock.mul(0.3)))).xyz.mul(texel.mul(0.9));
    const rest = assembled.add(shimmer.mul(smoothstep(0.6, 1.6, tau)));

    // burst: R and G are the velocity (#26); shock ring leaves the centre first
    const tbRaw = this.burst.sub(rnd(i, 9).mul(0.12)).sub(length(uvT.sub(0.5)).mul(0.22));
    const tq = floor(tbRaw.mul(12)).div(12);
    const useQ = this.quant.mul(T(14)).greaterThan(0.5).and(tbRaw.lessThan(0.55));
    const tb = max(select(useQ, tq, tbRaw), 0).toVar();
    const jitter = vec3(gauss(i, 10), gauss(i, 12), gauss(i, 14)).mul(0.08);
    const vel0 = vec3(c.r.sub(0.64).mul(2.4), c.g.sub(0.64).mul(2.4), c.b.sub(0.42).mul(1.5)).add(jitter).mul(this.speed).toVar();
    const flown = rest.add(vel0.mul(tb.add(tb.mul(tb).mul(0.42))));
    const velNow = vel0.mul(tb.mul(0.84).add(1));
    const bursting = this.burst.greaterThan(0);
    const pos = select(bursting, flown, rest).toVar();

    const sizeK = smoothstep(0.02, 0.5, lum).sqrt();
    const radius = texel.mul(0.62).mul(sizeK).mul(tb.mul(0.9).add(1));
    const tail = pos.sub(velNow.mul(0.045).mul(T(9)));
    const sprite = spriteVertex({
      center: pos,
      radius,
      tail: select(bursting, tail, pos),
      streakKeep: 0.55,
      minPx: 0.6,
      maxPx: 120,
      visible: select(lum.greaterThan(0.02), float(1), float(0)),
    });

    // #22 square pixel → round grain → four-pointed star as the grain ages
    const m = clamp(tb.mul(1.7), 0, 2);
    const p = sprite.local;
    const pc = vec2(max(abs(p.x).sub(sprite.halfLen), 0).mul(sign(p.x)), p.y);
    const d = morphSdf(pc, m);
    const shape = fillSdf(d, 0.08).add(exp(d.mul(d).mul(-3)).mul(0.35));

    const linear = pow(c, vec3(2.2));
    const heat = select(bursting, exp(tb.mul(-3.5)).mul(2.6).add(0.9), float(0.85));
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = linear.mul(heat).mul(this.level).mul(G.fade);
    mat.opacityNode = shape.mul(sprite.energy);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    return particleMesh(W * H, mat, 5);
  }
}

export class Prologue extends Chapter {
  readonly id = "prologue";
  readonly numeral = "";
  readonly name = "点火";
  readonly caption = "ひとつの言葉が、無数の粒になる。";
  readonly duration = 12;
  readonly techniques = [26, 16, 18, 22, 9, 14, 12, 31];
  readonly title: TitleField;
  private burstAt = 6.6;
  private onSubtitle: ((visible: boolean) => void) | null = null;
  private subtitleShown = false;

  constructor(title: TitleField) {
    super();
    this.title = title;
    this.loopEntry = 4.0;
    this.fadeIn = 0;
    this.fadeOut = 0;
    this.events = [{ t: this.burstAt, name: "burst" }];
  }

  build(_ctx: Ctx) {
    this.track = new Track([
      { t: 0, pos: [0, 0, 36], look: [0, 0, 0], fov: 38 },
      { t: 6.6, pos: [0, 0, 31], look: [0, 0, 0], fov: 38 },
      { t: 8.4, pos: [0.2, 0.3, 17], look: [0, 0, -10], fov: 46 },
      { t: 12, pos: [0.6, 0.9, -34], look: [0.6, 0.6, -80], fov: 58 },
    ]);
  }

  setSubtitleHandler(fn: (visible: boolean) => void) {
    this.onSubtitle = fn;
  }

  enter(_ctx: Ctx, _t: number) {
    const f = this.title;
    f.mode.value = 0;
    f.srcCenter.value.set(0, 0, 0);
    f.srcRadius.value = 0.12;
    f.textCenter.value.set(0, 0, 0);
    f.width.value = 18;
    f.mesh.visible = true;
  }

  exit(_ctx: Ctx) {
    this.title.mesh.visible = false;
    this.title.quant.value = 0;
    this.setSubtitle(false);
  }

  private setSubtitle(v: boolean) {
    if (v === this.subtitleShown) return;
    this.subtitleShown = v;
    this.onSubtitle?.(v);
  }

  update(ctx: Ctx, t: number, _dt: number) {
    const f = this.title;
    f.mesh.visible = true;
    f.level.value = ramp(t, 0, 1.4) * (1 - ramp(t, 10.6, 12));
    f.assemble.value = t < 1.2 ? -1 : t - 1.2;
    f.burst.value = t < this.burstAt ? -1 : t - this.burstAt;
    f.quant.value = t >= this.burstAt && t < this.burstAt + 0.6 && !ctx.reduced ? 1 : 0;
    this.setSubtitle(t > 4.3 && t < 6.4);
    ctx.rig.shake = pulse(t, this.burstAt, 0.05, 0.6) * 2.2;
  }

  look(t: number, out: Look) {
    const b = this.burstAt;
    out.bloom = [0.75 + pulse(t, b, 0.05, 0.6) * 0.8, 0.55, 0.42];
    out.sky = ramp(t, b + 0.6, b + 3.5) * 0.9;
    out.near = 0.05;
    out.far = 6000;
    out.focus = 30;
    out.aperture = 0;
    out.flash = pulse(t, b, 0.03, 0.16) * 1.1 + ramp(t, 11.3, 12) * 1.2;
    // #14 impact frames: on, on, off, on — counted on 12 fps time
    const frame = Math.floor((t - b) * 12);
    out.impact = t >= b && frame >= 0 && frame < 5 && frame !== 2 ? 1 : 0;
    out.warp = ramp(t, b + 1.2, b + 4.5) * 0.35;
  }
}
