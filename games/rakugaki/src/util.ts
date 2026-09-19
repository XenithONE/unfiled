import * as THREE from "three";

export const TAU = Math.PI * 2;
export const clamp = (v: number, a: number, b: number): number =>
  Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number): number =>
  a + (b - a) * t;
/** Frame-rate independent exponential approach. */
export const damp = (a: number, b: number, k: number, dt: number): number =>
  lerp(a, b, 1 - Math.exp(-k * dt));
export const rand = (a: number, b: number): number => a + Math.random() * (b - a);
export const moveToward = (v: number, target: number, step: number): number =>
  Math.abs(target - v) <= step ? target : v + Math.sign(target - v) * step;

/** Signed shortest rotation that takes angle a to angle b. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export const UP = new THREE.Vector3(0, 1, 0);
const dir = new THREE.Vector3();

/** Stretch a unit-length, Y-aligned object so that it spans a → b. */
export function placeBetween(
  obj: THREE.Object3D,
  a: THREE.Vector3,
  b: THREE.Vector3,
  thickness = 1,
): void {
  dir.subVectors(b, a);
  const len = dir.length();
  if (len < 1e-6) return;
  dir.divideScalar(len);
  obj.position.copy(a).addScaledVector(dir, len * 0.5);
  obj.quaternion.setFromUnitVectors(UP, dir);
  obj.scale.set(thickness, len, thickness);
}

const seg = new THREE.Vector3();
const perp = new THREE.Vector3();

/** Two-bone analytic IK. Writes the middle joint (knee / elbow) into `out`. */
export function solveTwoBone(
  root: THREE.Vector3,
  target: THREE.Vector3,
  l1: number,
  l2: number,
  hint: THREE.Vector3,
  out: THREE.Vector3,
): void {
  seg.subVectors(target, root);
  let d = seg.length();
  if (d < 1e-5) {
    out.copy(root).addScaledVector(hint, l1);
    return;
  }
  seg.divideScalar(d);
  d = clamp(d, Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.01);
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  perp.copy(hint).addScaledVector(seg, -hint.dot(seg));
  if (perp.lengthSq() < 1e-8) perp.set(seg.y, -seg.x, 0);
  perp.normalize();
  out
    .copy(root)
    .addScaledVector(seg, cosA * l1)
    .addScaledVector(perp, sinA * l1);
}

export const formatScore = (n: number): string => Math.round(n).toLocaleString("en-US");
