/**
 * A sun seen from close by: a white disc with a glow, six diffraction spikes
 * and a lens streak (#4). The glare exists only while the disc itself is in
 * sight past a planet at the origin, and light grazing that planet's air is
 * reddened by it (a Chapman grazing optical depth of the Rayleigh layer).
 */
import { AdditiveBlending, MeshBasicNodeMaterial } from "three/webgpu";
import type { Mesh } from "three/webgpu";
import { Fn, abs, atan, cameraPosition, cos, dot, exp, float, length, max, pow, select, smoothstep, sqrt, vec3 } from "./t";
import type { N } from "./common";
import { T } from "./common";
import { particleMesh } from "../engine/quad";
import { spriteVertex } from "./sprite";

export interface SunSpec {
  /** Unit direction towards the sun (uniform). */
  dir: N;
  level: N;
  /** Radius of the planet at the origin that can hide it. */
  planet: number;
  /** Rayleigh scale height of that planet's air (omit for none). */
  airScale?: number;
  /** Angular radius in radians. */
  size?: number;
  tint?: [number, number, number];
  /** How far from the camera the disc is drawn (keep it inside the far plane). */
  distance?: number;
}

export function sunSprite(spec: SunSpec): Mesh {
  const d = spec.distance ?? 9000;
  const span = 14;
  const size = spec.size ?? 0.0075;
  const tint = spec.tint ?? [1.0, 0.94, 0.84];
  const sprite = spriteVertex({ center: cameraPosition.add(spec.dir.mul(d)), radius: float(d * size * span), minPx: 4, maxPx: 4000, anamorphic: float(16) });
  const mat = new MeshBasicNodeMaterial();
  mat.vertexNode = sprite.clip;
  mat.colorNode = Fn(() => {
    // how much of the disc clears the planet, and the air its light crosses
    const ro = cameraPosition;
    const b = dot(ro, spec.dir);
    const miss = sqrt(max(dot(ro, ro).sub(b.mul(b)), 0));
    const reach = abs(b).mul(size);
    const behind = b.lessThan(0);
    const vis = select(behind, smoothstep(float(spec.planet).sub(reach), float(spec.planet).add(reach), miss), float(1));
    let light: N = vec3(tint[0], tint[1], tint[2]).mul(vis);
    if (spec.airScale) {
      const H = spec.airScale;
      const chapman = Math.sqrt((2 * Math.PI * spec.planet) / H);
      const graze = select(behind, max(miss.sub(spec.planet), 0), float(1e4));
      const tau = vec3(5.8, 13.5, 33.1).mul((0.265 / 33.1) * chapman).mul(exp(graze.div(-H)));
      light = light.mul(exp(tau.negate()));
    }
    // local is in radius units and round; only the streak uses the stretched width
    const p = sprite.local;
    const lq = length(p);
    const r = lq.mul(span);
    const edge = float(1).sub(smoothstep(0.6, 1.0, lq));
    const disc = smoothstep(1.06, 0.94, r).mul(60);
    const glow = exp(r.mul(-0.8)).mul(2.5).add(exp(r.mul(-0.22)).mul(0.25)).mul(edge);
    const a = atan(p.y, p.x);
    const spikes = pow(abs(cos(a.mul(3))), 160).mul(exp(r.mul(-0.2))).mul(2.0).mul(edge);
    const along = abs(p.x).div(sprite.stretch);
    const streak = exp(abs(p.y).mul(-1.4 * span))
      .mul(exp(along.mul(-3.6)))
      .mul(1.8)
      .mul(float(1).sub(smoothstep(0.7, 1.0, along)))
      .mul(T(4));
    return light.mul(disc.add(glow).add(spikes).add(streak)).mul(spec.level);
  })();
  mat.transparent = true;
  mat.depthWrite = false;
  mat.blending = AdditiveBlending;
  return particleMesh(1, mat, -4);
}
