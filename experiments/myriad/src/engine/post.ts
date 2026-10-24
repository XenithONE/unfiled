/**
 * Post-processing: bloom, warp (radial zoom blur), chromatic fringe,
 * impact frames (#14), flash, fade, vignette and grain.
 */
import { Color, RenderPipeline } from "three/webgpu";
import type { PassNode, PerspectiveCamera, Scene, TextureNode, WebGPURenderer } from "three/webgpu";
import {
  Fn,
  If,
  dot,
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
} from "../tsl/t";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { lensflare } from "three/addons/tsl/display/LensflareNode.js";
import type { N } from "../tsl/common";
import { T } from "../tsl/common";

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
  readonly grain = uniform(0.018);
  readonly aberration = uniform(0.0012);
  readonly bloomGain = uniform(1);
  /** Strength of the lens ghosts (#33). */
  readonly flare = uniform(0.6);
  readonly time = uniform(0);

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

    const output = Fn(() => {
      const uv0: N = screenUV;
      const c = uv0.sub(0.5);
      const radial = length(c.mul(vec2(1, 1.1)));

      // warp: radial zoom blur toward the centre (chapter transitions)
      const base = color.rgb.toVar();
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
      ).mul(this.bloomGain);
      let out: N = base.add(glow).add(vec3(ghosts.rgb).mul(this.flare.mul(T(33))));

      // #14 impact frame: a stark two-tone negative held for a frame or two
      const lum = dot(out, vec3(0.2126, 0.7152, 0.0722));
      const twoTone = mix(vec3(1.0, 0.97, 0.92).mul(2.2), vec3(0.02, 0.0, 0.03), smoothstep(0.05, 0.25, lum));
      out = mix(out, twoTone, this.impact);

      const vig = float(1).sub(smoothstep(float(0.35), float(1.1), radial));
      out = out.mul(mix(float(1).sub(this.vignette), float(1), vig));
      out = out.mul(this.fade).add(vec3(this.flashColor).mul(this.flash));
      const seed = uv0.mul(screenSize).add(this.time.mul(117.3).fract().mul(1000));
      const grain = hash(seed.x.add(seed.y.mul(1931)).toUint()).sub(0.5).mul(this.grain);
      return vec4(out.add(grain), 1);
    });
    this.pipeline = new RenderPipeline(renderer, output());
  }

  render() {
    this.pipeline.render();
  }

  dispose() {
    this.pipeline.dispose();
  }
}
