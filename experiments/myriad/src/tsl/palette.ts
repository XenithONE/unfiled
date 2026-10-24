/**
 * Colour without textures.
 *
 * #20 Cosine palette black-body: one line of cosines turns a 0..1 age into
 * white → yellow → red → black, the cooling of an ember.
 * #21 Structural colour: thin-film interference from a fake normal's Fresnel
 * term plus scrolling noise, the rainbow sheen of oil films and bubbles.
 */
import { Fn, clamp, cos, float, min, mix, pow, vec3 } from "./t";
import type { N } from "./common";
import { T } from "./common";

/** #20 — age 0 (hot) .. 1 (cold); returns linear HDR colour. */
export const blackbody = /*@__PURE__*/ Fn(([age]: [N]) => {
  const t = clamp(age, 0, 1);
  // each channel is half a cosine that reaches zero at a different age
  const c = cos(min(t.mul(vec3(1.0, 1.65, 2.6)), 1).mul(Math.PI)).mul(0.5).add(0.5);
  const heat = pow(float(1).sub(t), 1.5).mul(3.2).add(0.25);
  return c.mul(c).mul(heat);
}).setLayout({ name: "blackbody", type: "vec3", inputs: [{ name: "age", type: "float" }] });

/** Flat fallback used when #20 is switched off (same brightness curve). */
export function emberColor(age: N): N {
  const t = clamp(age, 0, 1);
  const flat = vec3(1.0, 0.55, 0.2).mul(pow(float(1).sub(t), 1.5).mul(3.2).add(0.25));
  return mix(flat, blackbody(t), T(20));
}

/** Inigo Quilez cosine palette a + b·cos(2π(c·t + d)). */
export function cosPalette(t: N, a: number[], b: number[], c: number[], d: number[]): N {
  const v = (x: number[]) => vec3(x[0], x[1], x[2]);
  return v(a).add(v(b).mul(cos(v(c).mul(t).add(v(d)).mul(Math.PI * 2))));
}

/**
 * #21 — thin-film colour. `cosTheta` is N·V of a (fake) normal, `thickness`
 * a 0..1 film thickness (scrolled noise). Returns an interference tint.
 */
export const thinFilm = /*@__PURE__*/ Fn(([cosTheta, thickness]: [N, N]) => {
  // optical path difference grows as the view grazes the film
  const path = thickness.mul(2.2).add(0.35).mul(float(1.6).sub(cosTheta.mul(0.6)));
  const phase = path.mul(vec3(1.0, 1.18, 1.38)).mul(Math.PI * 2);
  return cos(phase).mul(0.5).add(0.5);
}).setLayout({
  name: "thinFilm",
  type: "vec3",
  inputs: [
    { name: "cosTheta", type: "float" },
    { name: "thickness", type: "float" },
  ],
});
