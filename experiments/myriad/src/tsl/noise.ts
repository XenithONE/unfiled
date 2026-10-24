/**
 * Noise for MYRIAD.
 *
 * #15 Analytical curl noise: simplex noise whose gradient is written out as
 * the exact partial derivatives (no finite differences, no extra samples).
 * Two gradients crossed give a divergence-free "bitangent" field — the swirl
 * of a curl field from a single analytic evaluation per gradient.
 */
import { Fn, abs, cross, dot, float, floor, max, min, step, vec2, vec3, vec4 } from "./t";
import type { N } from "./common";

const mod289 = (x: N): N => x.sub(floor(x.mul(1 / 289)).mul(289));
const permute = (x: N): N => mod289(x.mul(34).add(1).mul(x));
const taylorInvSqrt = (r: N): N => float(1.79284291400159).sub(r.mul(0.85373472095314));

/** 3D simplex noise; returns vec4(dn/dx, dn/dy, dn/dz, n) with n in ~[-1, 1]. */
export const snoiseGrad = /*@__PURE__*/ Fn(([vIn]: [N]) => {
  const v = vec3(vIn).toVar();
  const C = vec2(1 / 6, 1 / 3);
  const i = floor(v.add(dot(v, vec3(C.y)))).toVar();
  const x0 = v.sub(i).add(dot(i, vec3(C.x))).toVar();
  const g = step(x0.yzx, x0.xyz).toVar();
  const l = vec3(1).sub(g).toVar();
  const i1 = min(g, l.zxy).toVar();
  const i2 = max(g, l.zxy).toVar();
  const x1 = x0.sub(i1).add(C.x).toVar();
  const x2 = x0.sub(i2).add(C.y).toVar();
  const x3 = x0.sub(0.5).toVar();

  const ii = mod289(i).toVar();
  const p = permute(
    permute(permute(ii.z.add(vec4(0, i1.z, i2.z, 1))).add(ii.y).add(vec4(0, i1.y, i2.y, 1)))
      .add(ii.x)
      .add(vec4(0, i1.x, i2.x, 1)),
  ).toVar();

  // 7×7 gradient points over a square, mapped onto an octahedron
  const nsx = 2 / 7;
  const nsy = 0.5 / 7 - 1;
  const nsz = 1 / 7;
  const j = p.sub(floor(p.mul(nsz * nsz)).mul(49)).toVar();
  const xq = floor(j.mul(nsz)).toVar();
  const yq = floor(j.sub(xq.mul(7))).toVar();
  const x = xq.mul(nsx).add(nsy).toVar();
  const y = yq.mul(nsx).add(nsy).toVar();
  const h = vec4(1).sub(abs(x)).sub(abs(y)).toVar();
  const b0 = vec4(x.xy, y.xy).toVar();
  const b1 = vec4(x.zw, y.zw).toVar();
  const s0 = floor(b0).mul(2).add(1).toVar();
  const s1 = floor(b1).mul(2).add(1).toVar();
  const sh = step(h, vec4(0)).negate().toVar();
  const a0 = b0.xzyw.add(s0.xzyw.mul(sh.xxyy)).toVar();
  const a1 = b1.xzyw.add(s1.xzyw.mul(sh.zzww)).toVar();
  const q0 = vec3(a0.xy, h.x).toVar();
  const q1 = vec3(a0.zw, h.y).toVar();
  const q2 = vec3(a1.xy, h.z).toVar();
  const q3 = vec3(a1.zw, h.w).toVar();
  const norm = taylorInvSqrt(vec4(dot(q0, q0), dot(q1, q1), dot(q2, q2), dot(q3, q3))).toVar();
  const p0 = q0.mul(norm.x).toVar();
  const p1 = q1.mul(norm.y).toVar();
  const p2 = q2.mul(norm.z).toVar();
  const p3 = q3.mul(norm.w).toVar();

  const m = max(vec4(0.6).sub(vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3))), 0).toVar();
  const m2 = m.mul(m).toVar();
  const m4 = m2.mul(m2).toVar();
  const pdotx = vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)).toVar();
  const t = m2.mul(m).mul(pdotx).toVar();
  const grad = x0
    .mul(t.x)
    .add(x1.mul(t.y))
    .add(x2.mul(t.z))
    .add(x3.mul(t.w))
    .mul(-8)
    .add(p0.mul(m4.x))
    .add(p1.mul(m4.y))
    .add(p2.mul(m4.z))
    .add(p3.mul(m4.w))
    .mul(42);
  const n = dot(m4, pdotx).mul(42);
  return vec4(grad, n);
}).setLayout({
  name: "snoiseGrad",
  type: "vec4",
  inputs: [{ name: "v", type: "vec3" }],
});

/**
 * Divergence-free swirl: ∇n₁ × ∇n₂ (both gradients analytic). Magnitude is
 * roughly 0..4; callers scale it.
 */
export const curlNoise = /*@__PURE__*/ Fn(([p]: [N]) => {
  const a = snoiseGrad(p).xyz;
  const b = snoiseGrad(p.add(vec3(31.416, -47.853, 12.679))).xyz;
  return cross(a, b);
}).setLayout({
  name: "curlNoise",
  type: "vec3",
  inputs: [{ name: "p", type: "vec3" }],
});

/** Fractal value from the same simplex basis (2 octaves), ~[-1, 1]. */
export const fbm2 = /*@__PURE__*/ Fn(([p]: [N]) => {
  const a = snoiseGrad(p).w;
  const b = snoiseGrad(p.mul(2.03).add(17.1)).w;
  return a.mul(0.66).add(b.mul(0.34));
}).setLayout({
  name: "fbm2",
  type: "float",
  inputs: [{ name: "p", type: "vec3" }],
});
