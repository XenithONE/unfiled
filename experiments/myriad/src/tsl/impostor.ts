/**
 * Rock and ember particles that look solid.
 *
 * #10 impostor sphere: a flat quad whose fragment invents the normal
 *     (x, y, √(1 − x² − y²)) and writes the sphere's real depth.
 * #23 fake MatCap: that invented normal, taken to view space, indexes a
 *     MatCap texture (drawn procedurally here) for metal / ice / clay looks.
 * #24 Voronoi crack glow: a dynamic cellular field on the surface; only the
 *     cell borders light up, like magma between plates.
 */
import { CanvasTexture, SRGBColorSpace } from "three/webgpu";
import {
  abs,
  cameraFar,
  cameraNear,
  cameraProjectionMatrix,
  cameraViewMatrix,
  dot,
  float,
  max,
  mix,
  mx_worley_noise_vec2,
  normalize,
  smoothstep,
  sqrt,
  texture,
  vec2,
  vec3,
  vec4,
  viewZToPerspectiveDepth,
} from "./t";
import type { N } from "./common";
import { T } from "./common";
import { snoiseGrad } from "./noise";

export interface ImpostorFrag {
  /** False outside the sphere silhouette (discard). */
  inside: N;
  /** View-space normal (#10, or a flat facing normal when #10 is off). */
  normal: N;
  /** Fragment depth for the material's depthNode. */
  depth: N;
}

/**
 * #10 — `local` is the quad coordinate in −1..1, `viewCenter` the sphere
 * centre in view space (varying), `radius` its world radius (varying).
 * `bump` perturbs the normal with noise for rocky lumps; `seed` varies it.
 */
export function impostorSphere(local: N, viewCenter: N, radius: N, bump: N = float(0), seed: N = float(0)): ImpostorFrag {
  const r2 = dot(local, local);
  // irregular rim for rocks: noise on the silhouette threshold
  const rimNoise = snoiseGrad(vec3(local.mul(1.3), seed)).w.mul(bump).mul(0.2);
  const inside = r2.lessThan(float(1).sub(rimNoise.max(0)));
  const z = sqrt(max(float(1).sub(r2), 0));
  const sphereN = vec3(local, z);
  const lumps = snoiseGrad(sphereN.mul(1.9).add(seed)).xyz.mul(0.22)
    .add(snoiseGrad(sphereN.mul(5.3).add(seed.mul(1.7))).xyz.mul(0.07))
    .mul(bump);
  const nOn = normalize(sphereN.add(lumps));
  const normal = mix(vec3(0, 0, 1), nOn, T(10));
  const surfaceZ = viewCenter.z.add(z.mul(radius).mul(T(10)));
  const depth = viewZToPerspectiveDepth(surfaceZ, cameraNear, cameraFar);
  return { inside, normal, depth };
}

/** Projects a view-space point (helper for varyings). */
export function viewOf(world: N): N {
  return cameraViewMatrix.mul(vec4(world, 1));
}
export function clipOfView(view: N): N {
  return cameraProjectionMatrix.mul(view);
}

/* ---------------------------------------------------------------------- */
/* #23 procedural MatCaps                                                  */
/* ---------------------------------------------------------------------- */

type MatcapStyle = "ice" | "rockice" | "basalt" | "chrome";

/** Draws a MatCap ball into a canvas (view-space lit sphere). */
export function makeMatcap(style: MatcapStyle, size = 256): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const img = g.createImageData(size, size);
  const light = [0.55, 0.62, 0.56];
  const ll = Math.hypot(light[0], light[1], light[2]);
  const L = light.map((v) => v / ll);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size * 2 - 1;
      const ny = 1 - (y + 0.5) / size * 2;
      const r2 = nx * nx + ny * ny;
      const i = (y * size + x) * 4;
      if (r2 > 1) {
        img.data[i + 3] = 255;
        continue;
      }
      const nz = Math.sqrt(1 - r2);
      const ndl = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
      const hx = L[0];
      const hy = L[1];
      const hz = L[2] + 1;
      const hl = Math.hypot(hx, hy, hz);
      const ndh = Math.max(0, (nx * hx + ny * hy + nz * hz) / hl);
      const fres = Math.pow(1 - nz, 3);
      let rgb: number[];
      if (style === "ice") {
        const spec = Math.pow(ndh, 60) * 1.2;
        const base = [0.32 + 0.4 * ndl, 0.42 + 0.42 * ndl, 0.55 + 0.4 * ndl];
        rgb = base.map((v, k) => v + spec + fres * [0.25, 0.5, 0.8][k]);
      } else if (style === "rockice") {
        // frosted rock: matte, slightly cool, a soft sheen and a cold rim
        const grit = 0.92 + 0.08 * Math.sin(nx * 41 + ny * 17) * Math.sin(ny * 33 - nx * 9);
        const spec = Math.pow(ndh, 18) * 0.28;
        const base = [0.5 + 0.42 * ndl, 0.52 + 0.42 * ndl, 0.56 + 0.4 * ndl];
        rgb = base.map((v, k) => v * grit + spec + fres * [0.12, 0.2, 0.32][k]);
      } else if (style === "basalt") {
        const spec = Math.pow(ndh, 24) * 0.35;
        const base = [0.07 + 0.22 * ndl, 0.065 + 0.2 * ndl, 0.07 + 0.19 * ndl];
        rgb = base.map((v, k) => v + spec + fres * [0.12, 0.1, 0.1][k]);
      } else {
        // chrome: a horizon band, sky above, dark ground below
        const sky = ny > 0 ? 0.55 + 0.45 * ny : 0.08 + 0.1 * (1 + ny);
        const band = Math.exp(-Math.pow(ny * 7, 2)) * 0.9;
        const spec = Math.pow(ndh, 90) * 2;
        rgb = [sky * 0.85 + band + spec, sky * 0.9 + band * 0.8 + spec, sky + band * 0.6 + spec];
      }
      img.data[i] = Math.min(255, rgb[0] * 255);
      img.data[i + 1] = Math.min(255, rgb[1] * 255);
      img.data[i + 2] = Math.min(255, rgb[2] * 255);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/**
 * #23 — lit colour from a MatCap: the view-space normal's xy is the lookup.
 * Off: plain Lambert with the same light.
 */
export function matcapShade(tex: CanvasTexture, normal: N, lightView: N, base: N): N {
  const uvm = normal.xy.mul(0.49).add(0.5);
  const mc = texture(tex, vec2(uvm.x, uvm.y)).rgb;
  const lambert = base.mul(max(dot(normal, lightView), 0).mul(0.9).add(0.06));
  return mix(lambert, mc.mul(base.mul(1.6)), T(23));
}

/* ---------------------------------------------------------------------- */
/* #24 Voronoi crack glow                                                  */
/* ---------------------------------------------------------------------- */

/**
 * Returns 0..1 crack intensity at a 3D surface point: F2 − F1 of a Worley
 * field is small only along cell borders.
 */
export function voronoiCracks(p: N, width: N): N {
  // the TSL Worley returns squared distances (F1², F2²)
  const f = mx_worley_noise_vec2(p);
  const edge = abs(sqrt(f.y).sub(sqrt(f.x)));
  const crack = float(1).sub(smoothstep(float(0), width, edge));
  return crack.mul(T(24));
}
