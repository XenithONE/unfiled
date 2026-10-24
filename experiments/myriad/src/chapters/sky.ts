/**
 * The distant sky shared by the "real space" chapters: stars and a faint
 * galactic band at a fixed distance around the camera.
 *
 * #4 anamorphic flares on bright stars, #9 velocity stretch during warps,
 * #12 minimum pixel size, #31 the tiny grains themselves.
 */
import { AdditiveBlending, Matrix3, MeshBasicNodeMaterial } from "three/webgpu";
import type { Mesh } from "three/webgpu";
import {
  cameraPosition,
  float,
  instanceIndex,
  mix,
  normalize,
  pow,
  select,
  sin,
  smoothstep,
  uniform,
  vec3,
} from "../tsl/t";
import type { Ctx } from "../engine/chapter";
import { particleMesh } from "../engine/quad";
import type { N } from "../tsl/common";
import { G, gauss, rnd } from "../tsl/common";
import { flareShape, glowShape, spriteVertex } from "../tsl/sprite";

export class Sky {
  readonly level = uniform(0);
  readonly rotation = uniform(new Matrix3());
  readonly distance = uniform(4000);
  readonly stars: Mesh;
  readonly haze: Mesh;

  constructor(ctx: Ctx) {
    const nStars = Math.max(30000, Math.round(160000 * ctx.q));
    const nHaze = Math.max(6000, Math.round(26000 * ctx.q));
    this.stars = this.buildStars(nStars);
    this.haze = this.buildHaze(nHaze);
    ctx.scene.add(this.stars, this.haze);
  }

  /** Direction of star i: 45 % in a tilted band, the rest uniform. */
  private direction(i: N, k: number): N {
    const inBand = rnd(i, k).lessThan(0.45);
    const z = rnd(i, k + 1).mul(2).sub(1);
    const phi = rnd(i, k + 2).mul(Math.PI * 2);
    const rxy = float(1).sub(z.mul(z)).max(0).sqrt();
    const uniformDir = vec3(rxy.mul(phi.cos()), z, rxy.mul(phi.sin()));
    const lat = gauss(i, k + 3).mul(0.11);
    const bandDir = vec3(phi.cos().mul(lat.cos()), lat.sin(), phi.sin().mul(lat.cos()));
    return this.rotation.mul(normalize(mix(uniformDir, bandDir, select(inBand, float(1), float(0)))));
  }

  private buildStars(count: number): Mesh {
    const i = instanceIndex;
    const dir = this.direction(i, 0);
    const center = cameraPosition.add(dir.mul(this.distance));
    const u = rnd(i, 6);
    const bright = pow(u, 10).mul(9).add(0.12).toVar();
    const temp = rnd(i, 7);
    const hot = vec3(0.68, 0.8, 1.0);
    const sun = vec3(1.0, 0.92, 0.8);
    const cool = vec3(1.0, 0.62, 0.38);
    const color = mix(mix(cool, sun, smoothstep(0.0, 0.45, temp)), hot, smoothstep(0.55, 1.0, temp));
    const radius = this.distance.mul(0.00034).mul(bright.sqrt().mul(0.6).add(0.55));

    // #9: during a warp the tail trails back along the camera's motion
    const vdir = normalize(G.camVel.add(vec3(0, 0, 1e-4)));
    const tail = center.sub(vdir.mul(this.distance.mul(0.3).mul(G.warp)));
    const sprite = spriteVertex({
      center,
      radius,
      tail,
      streakKeep: 0.6,
      minPx: 0.75,
      anamorphic: smoothstep(1.4, 6.0, bright).mul(5),
    });
    const twinkle = sin(G.clock.mul(rnd(i, 8).mul(3).add(1.5)).add(rnd(i, 9).mul(40))).mul(0.18).add(0.88);
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = color.mul(bright).mul(twinkle).mul(this.level);
    mat.opacityNode = flareShape(sprite).mul(sprite.energy);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    return particleMesh(count, mat, -20);
  }

  private buildHaze(count: number): Mesh {
    const i = instanceIndex;
    // haze lives only in the band, with lumpy density
    const phi = rnd(i, 1).mul(Math.PI * 2);
    const lat = gauss(i, 2).mul(0.075);
    const dir = this.rotation.mul(vec3(phi.cos().mul(lat.cos()), lat.sin(), phi.sin().mul(lat.cos())));
    const center = cameraPosition.add(dir.mul(this.distance.mul(1.02)));
    const radius = this.distance.mul(rnd(i, 4).mul(0.04).add(0.02));
    const sprite = spriteVertex({ center, radius, minPx: 1 });
    const lump = sin(phi.mul(7).add(sin(phi.mul(3)).mul(2))).mul(0.5).add(0.5);
    const tint = mix(vec3(0.55, 0.42, 0.34), vec3(0.32, 0.4, 0.62), rnd(i, 5));
    const mat = new MeshBasicNodeMaterial();
    mat.vertexNode = sprite.clip;
    mat.colorNode = tint.mul(lump.mul(0.7).add(0.3)).mul(0.006).mul(this.level);
    mat.opacityNode = glowShape(sprite, 0).mul(sprite.energy);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    return particleMesh(count, mat, -21);
  }

  setVisible(v: boolean) {
    this.stars.visible = v;
    this.haze.visible = v;
  }
}
