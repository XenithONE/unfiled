/**
 * Post-processing: bloom, warp (radial zoom blur), chromatic fringe,
 * impact frames (#14), flash, fade, vignette and grain — and the lens itself:
 * #38 dirt on the glass that lights up in the glare, a horizontal anamorphic
 *     streak from the hottest points, and red halation round highlights;
 * #39 shafts of light: the glow is gathered along the line to the light's
 *     place on screen, so occluders cut dark rays into it;
 * #40 a grade after tone mapping: lift / gamma / gain and saturation per
 *     chapter, then grain and a dither in display space.
 */
import { Color, RenderPipeline, Vector2, Vector3 } from "three/webgpu";
import type { PassNode, PerspectiveCamera, Scene, TextureNode, WebGPURenderer } from "three/webgpu";
import {
  Fn,
  If,
  dot,
  float,
  hash,
  length,
  luminance,
  max,
  mix,
  pass,
  pow,
  renderOutput,
  screenSize,
  screenUV,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "../tsl/t";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { gaussianBlur } from "three/addons/tsl/display/GaussianBlurNode.js";
import { lensflare } from "three/addons/tsl/display/LensflareNode.js";
import type { N } from "../tsl/common";
import { T } from "../tsl/common";
import { ign } from "../tsl/sprite";
import { makeLensDirt } from "./lens";

export class Post {
  readonly scenePass: PassNode;
  readonly pipeline: RenderPipeline;
  readonly bloom: ReturnType<typeof bloom>;
  readonly warp = uniform(0);
  readonly flash = uniform(0);
  readonly flashColor = uniform(new Color(1, 1, 1));
  readonly fade = uniform(1);
  readonly impact = uniform(0);
  readonly vignette = uniform(0.55);
  readonly grain = uniform(0.022);
  readonly aberration = uniform(0.0012);
  readonly bloomGain = uniform(1);
  /** Strength of the lens ghosts (#33). */
  readonly flare = uniform(0.6);
  readonly time = uniform(0);
  /** #38 lens dirt, anamorphic streak and halation strengths. */
  readonly dirt = uniform(0.5);
  readonly streak = uniform(0.2);
  readonly streakTint = uniform(new Color(0.45, 0.66, 1.0));
  readonly halation = uniform(0.12);
  /** #39 light shafts: strength, the light's place on screen (0..1, y down), colour. */
  readonly rays = uniform(0);
  readonly raysPos = uniform(new Vector2(0.5, 0.5));
  readonly raysColor = uniform(new Color(1, 0.92, 0.8));
  /** #40 the grade (display space). */
  readonly lift = uniform(new Vector3(0, 0, 0));
  readonly gamma = uniform(new Vector3(1, 1, 1));
  readonly gain = uniform(new Vector3(1, 1, 1));
  readonly saturation = uniform(1);

  constructor(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera) {
    const sp = pass(scene, camera);
    this.scenePass = sp;
    const color: N = sp.getTextureNode("output");
    this.bloom = bloom(color, 0.9, 0.55, 0.32);
    // runtime method is getTextureNode(); the typings still say getTexture()
    const bloomTex: N = (this.bloom as unknown as { getTextureNode(): TextureNode }).getTextureNode();
    // #33 lens ghosts: the bloom mirrored through the centre (r18x LensflareNode);
    // a high threshold, so only intense points (a sun, a blast) throw ghosts
    const ghosts: N = lensflare(bloomTex, {
      ghostTint: vec3(1.0, 0.8, 0.64),
      threshold: float(2.0),
      ghostSamples: float(5),
      ghostSpacing: float(0.27),
      ghostAttenuationFactor: float(18),
      downSampleRatio: 4,
    });
    // #38 the anamorphic streak: only the hottest points, smeared sideways at
    // quarter resolution (a horizontal-only Gaussian: the vertical pass has a
    // zero direction)
    const hot = Fn(() => {
      const c = color.sample(uv()).rgb;
      return vec4(c.mul(smoothstep(3.0, 9.0, luminance(c))), 1);
    })();
    const streakTex: N = (gaussianBlur(hot, vec2(1.6, 0), 30, { resolutionScale: 0.25 }) as unknown as { getTextureNode(): TextureNode }).getTextureNode();
    const dirt: N = texture(makeLensDirt());

    const output = Fn(() => {
      const uv0: N = screenUV;
      const c = uv0.sub(0.5);
      const radial = length(c.mul(vec2(1, 1.1)));

      // the glass: a slight lateral colour split that grows toward the corners
      const lat = c.mul(radial.mul(radial).mul(this.aberration.mul(2.6)));
      const base = vec3(color.sample(uv0.add(lat)).r, color.sample(uv0).g, color.sample(uv0.sub(lat)).b).toVar();
      // warp: radial zoom blur toward the centre (chapter transitions)
      If(this.warp.greaterThan(0.002), () => {
        const taps = 12;
        let acc: N = vec3(0);
        for (let i = 0; i < taps; i++) {
          const s = float(1).sub(this.warp.mul((i / taps) * 0.42));
          acc = acc.add(color.sample(c.mul(s).add(0.5)).rgb);
        }
        base.assign(acc.div(taps));
      });

      const ab = c.mul(this.aberration.add(this.warp.mul(0.012)).mul(radial.mul(5)));
      const glow = vec3(
        bloomTex.sample(uv0.add(ab)).r,
        bloomTex.sample(uv0).g,
        bloomTex.sample(uv0.sub(ab)).b,
      ).mul(this.bloomGain).toVar();
      let out: N = base.add(glow).add(vec3(ghosts.rgb).mul(this.flare.mul(T(33))));

      // #38 the lens: dirt lit by the glow, the streak, red halation
      const lens = T(38);
      const smudge = dirt.sample(uv0).r;
      out = out.add(glow.mul(smudge.mul(this.dirt).mul(2.2).mul(lens)));
      out = out.add(vec3(this.streakTint).mul(luminance(streakTex.sample(uv0).rgb)).mul(this.streak.mul(lens)));
      out = out.add(glow.mul(vec3(1.0, 0.32, 0.12)).mul(this.halation.mul(lens)));

      // #39 shafts: gather the glow along the line toward the light
      const shafts = vec3(0).toVar();
      If(this.rays.mul(T(39)).greaterThan(0.002), () => {
        const toL = this.raysPos.sub(uv0);
        const taps = 36;
        const jit = ign();
        let acc: N = vec3(0);
        for (let i = 0; i < taps; i++) {
          const f = float(i).add(jit).div(taps);
          // near samples matter most; the far end of the line fades out
          const w = Math.pow(0.955, i);
          acc = acc.add(bloomTex.sample(uv0.add(toL.mul(f.mul(0.92)))).rgb.mul(w));
        }
        const reach = float(1).sub(smoothstep(0.2, 1.3, length(toL.mul(vec2(screenSize.x.div(screenSize.y), 1)))));
        shafts.assign(acc.mul(this.rays.div(taps * 0.45)).mul(reach.mul(0.7).add(0.3)).mul(this.raysColor));
      });
      out = out.add(shafts);

      // #14 impact frame: a stark two-tone negative held for a frame or two
      const lum = dot(out, vec3(0.2126, 0.7152, 0.0722));
      const twoTone = mix(vec3(1.0, 0.97, 0.92).mul(2.2), vec3(0.02, 0.0, 0.03), smoothstep(0.05, 0.25, lum));
      out = mix(out, twoTone, this.impact);

      const vig = float(1).sub(smoothstep(float(0.35), float(1.1), radial));
      out = out.mul(mix(float(1).sub(this.vignette), float(1), vig));
      out = out.mul(this.fade).add(vec3(this.flashColor).mul(this.flash));

      // tone map here (the pipeline's own transform is off), then grade the picture
      const mapped = renderOutput(vec4(out, 1)).rgb.toVar();
      const g0 = mapped.mul(this.gain).add(vec3(this.lift).mul(float(1).sub(mapped)));
      const g1 = pow(max(g0, vec3(0)), vec3(1).div(this.gamma));
      const graded = mix(mapped, mix(vec3(luminance(g1)), g1, this.saturation), T(40));
      // film grain, strongest in the mid-tones, plus a sub-step dither against banding
      const seed = uv0.mul(screenSize).add(this.time.mul(117.3).fract().mul(1000));
      const n1 = hash(seed.x.add(seed.y.mul(1931)).toUint());
      const n2 = hash(seed.x.mul(7.13).add(seed.y.mul(3307)).add(17).toUint());
      const ml = luminance(graded);
      const grain = n1.sub(0.5).mul(this.grain).mul(smoothstep(0.0, 0.25, ml).mul(float(1).sub(smoothstep(0.6, 1.0, ml)).mul(0.8).add(0.35)));
      const dither = n1.add(n2).sub(1).div(255);
      return vec4(graded.add(grain).add(dither), 1);
    });
    this.pipeline = new RenderPipeline(renderer, output());
    this.pipeline.outputColorTransform = false;
  }

  render() {
    this.pipeline.render();
  }

  dispose() {
    this.pipeline.dispose();
  }
}
