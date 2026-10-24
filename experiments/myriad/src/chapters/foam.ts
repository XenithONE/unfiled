/**
 * VII — 泡の海. Our universe is one bubble in a foam of universes.
 *
 * #21 structural colour: each bubble's film is a thin-film interference tint
 *     from the fake normal's Fresnel term and a slowly swirling thickness.
 * #19 every rim is one device pixel wide, near or far, via fwidth.
 * #10 the bubbles are impostor spheres (one quad each).
 * #16 / #18 at the end our bubble bursts and its film becomes the word
 *     MYRIAD — the morph of the prologue, run from a sphere shell — and the
 *     loop closes on the prologue's held title.
 */
import { AdditiveBlending, MeshBasicNodeMaterial, Vector3 } from "three/webgpu";
import type { Mesh } from "three/webgpu";
import {
  Fn,
  dot,
  float,
  instanceIndex,
  instancedArray,
  length,
  max,
  pow,
  select,
  smoothstep,
  sqrt,
  uint,
  uniform,
  varying,
  vec2,
  vec3,
} from "../tsl/t";
import type { Ctx, Look } from "../engine/chapter";
import { Chapter, ramp } from "../engine/chapter";
import { particleMesh } from "../engine/quad";
import type { Key } from "../engine/rig";
import { Track, makePose } from "../engine/rig";
import { G, T, gauss, rnd } from "../tsl/common";
import { snoiseGrad } from "../tsl/noise";
import { thinFilm } from "../tsl/palette";
import { glowShape, outlineSdf, spriteVertex } from "../tsl/sprite";
import type { Prologue, TitleField } from "./title";

const HERO_R = 16;
const GLITTER = 320;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Loosely packed bubbles that do not overlap each other or the hero. */
function packBubbles(n: number) {
  const rand = mulberry32(7310);
  const out: { c: Vector3; r: number }[] = [{ c: new Vector3(0, 0, 0), r: HERO_R }];
  let guard = 0;
  while (out.length < n && guard++ < 60000) {
    const r = 4 + Math.pow(rand(), 3.2) * 110;
    const c = new Vector3((rand() - 0.5) * 1500, (rand() - 0.5) * 900, (rand() - 0.5) * 1500 - 200);
    // keep a clear corridor for the camera near the hero
    if (Math.hypot(c.x, c.y * 1.2) < r + 40 && c.z > -60 && c.z < 320) continue;
    if (out.some((b) => b.c.distanceTo(c) < b.r + r + 2)) continue;
    out.push({ c, r });
  }
  const data = new Float32Array(out.length * 4);
  out.forEach((b, i) => data.set([b.c.x, b.c.y, b.c.z, b.r], i * 4));
  return { data, n: out.length };
}

export class FoamChapter extends Chapter {
  readonly id = "foam";
  readonly numeral = "VII";
  readonly name = "泡の海";
  readonly caption = "わたしたちの宇宙は、泡のひとつにすぎない。";
  readonly duration = 20;
  readonly techniques = [21, 19, 10, 16, 18, 22, 31];

  private readonly level = uniform(1);
  private readonly heroLevel = uniform(1);
  private title: TitleField;
  private prologue: Prologue;
  private nBubbles = 0;

  constructor(title: TitleField, prologue: Prologue) {
    super();
    this.title = title;
    this.prologue = prologue;
    this.fadeOut = 0;
    this.events = [{ t: 17.2, name: "pop" }];
  }

  build(ctx: Ctx) {
    const packed = packBubbles(ctx.q >= 0.6 ? 260 : 160);
    this.nBubbles = packed.n;
    const bub = instancedArray(packed.data, "vec4");
    this.group.add(this.buildBubbles(bub), this.buildGlitter(bub));

    // end exactly where the prologue's held title is framed (seamless loop)
    const pose = makePose();
    this.prologue.track.sample(this.prologue.loopEntry, pose);
    const end: Key = {
      t: 20,
      pos: [pose.pos.x, pose.pos.y, pose.pos.z],
      look: [pose.look.x, pose.look.y, pose.look.z],
      fov: pose.fov,
    };
    this.track = new Track([
      { t: 0, pos: [0, 3, 22], look: [0, 0, 0], fov: 60 },
      { t: 4, pos: [30, 60, 330], look: [0, 0, 0], fov: 56 },
      { t: 8.5, pos: [-260, 120, 420], look: [-80, 20, -150], fov: 54 },
      { t: 12.5, pos: [-140, 40, 220], look: [0, 0, 0], fov: 50 },
      { t: 16.5, pos: [0, 4, 70], look: [0, 0, 0], fov: 44 },
      end,
    ]);
  }

  private buildBubbles(bub: ReturnType<typeof instancedArray>): Mesh {
    const i = instanceIndex;
    const b = bub.element(i);
    const isHero = i.equal(uint(0));
    const sprite = spriteVertex({ center: b.xyz, radius: b.w, minPx: 2, maxPx: 4000, visible: select(isHero, this.heroLevel, float(1)) });
    const seed = varying(rnd(i, 1).mul(50));
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = Fn(() => {
      const p = sprite.local;
      const r2 = dot(p, p);
      const nz = sqrt(max(float(1).sub(r2), 0));
      // #21 thin film: thickness swirls slowly over the surface
      const swirl = snoiseGrad(vec3(p.mul(1.4), seed.add(G.clock.mul(0.05)))).w;
      const thick = swirl.mul(0.5).add(0.5);
      const film = thinFilm(nz, thick);
      const plain = vec3(0.85, 0.9, 1.0);
      const tint = film.mul(T(21)).add(plain.mul(float(1).sub(T(21))));
      const fres = pow(float(1).sub(nz), 2.4);
      const spec = pow(max(float(1).sub(length(p.sub(vec2(-0.38, 0.42))).mul(3.2)), 0), 4).mul(1.5);
      // #19 a one-pixel rim at any distance
      const rim = outlineSdf(sqrt(r2), 1);
      const body = tint.mul(fres.mul(1.1));
      return body.add(vec3(1, 1, 1).mul(spec.mul(0.7))).add(vec3(0.9, 0.95, 1.0).mul(rim).mul(0.75)).mul(this.level);
    })();
    mat.opacityNode = Fn(() => {
      const r2 = dot(sprite.local, sprite.local);
      return select(r2.lessThan(1.06), float(1), float(0)).mul(0.9);
    })();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    return particleMesh(this.nBubbles, mat, 6);
  }

  /** Inside every bubble, a faint glitter of its own galaxies. */
  private buildGlitter(bub: ReturnType<typeof instancedArray>): Mesh {
    const i = instanceIndex;
    const k = i.div(uint(GLITTER));
    const b = bub.element(k);
    const dir = vec3(gauss(i, 0), gauss(i, 2), gauss(i, 4));
    const r = rnd(i, 6).pow(0.33).mul(b.w.mul(0.86));
    const pos = b.xyz.add(dir.div(length(dir).max(1e-4)).mul(r));
    const isHero = k.equal(uint(0));
    const sprite = spriteVertex({ center: pos, radius: b.w.mul(0.012).add(0.08), minPx: 0.7, maxPx: 20, visible: select(isHero, this.heroLevel, float(1)) });
    const hue = rnd(i, 7);
    const col = vec3(0.6, 0.75, 1.0).mul(float(1).sub(hue)).add(vec3(1.0, 0.7, 0.85).mul(hue));
    const tw = smoothstep(0.2, 1.0, snoiseGrad(pos.mul(0.05).add(G.clock.mul(0.2))).w.mul(0.5).add(0.5));
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = varying(col.mul(tw.mul(0.8).add(0.2)).mul(select(isHero, float(0.9), float(0.35))).mul(this.level));
    mat.opacityNode = glowShape(sprite, 0.3).mul(sprite.energy);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    return particleMesh(this.nBubbles * GLITTER, mat, 5);
  }

  enter(_ctx: Ctx) {
    const f = this.title;
    f.mode.value = 1;
    f.srcCenter.value.set(0, 0, 0);
    f.srcRadius.value = HERO_R;
    f.textCenter.value.set(0, 0, 0);
    f.width.value = 18;
    f.burst.value = -1;
    f.quant.value = 0;
  }

  exit(_ctx: Ctx) {
    this.title.mesh.visible = false;
  }

  update(_ctx: Ctx, t: number) {
    // the foam recedes once our bubble has burst, leaving the word alone
    this.level.value = 1 - ramp(t, 17.6, 19.7);
    // the hero bubble bursts into the grains of the title
    const pop = 17.2;
    this.heroLevel.value = 1 - ramp(t, pop - 0.25, pop + 0.15);
    const f = this.title;
    f.mesh.visible = t > pop - 0.3;
    f.level.value = ramp(t, pop - 0.3, pop + 0.2);
    f.assemble.value = t - pop;
    f.burst.value = -1;
  }

  look(t: number, out: Look) {
    out.bloom = [0.55, 0.5, 0.7];
    out.sky = 0;
    out.near = 0.1;
    out.far = 6000;
    out.focus = 60;
    out.aperture = 0;
    out.warp = (1 - ramp(t, 0, 1.2)) * 0.5;
    out.flash = Math.max(0, 1 - Math.abs(t - 17.2) / 0.3) * 0.22;
    out.flashColor = [0.85, 0.9, 1.0];
  }
}
