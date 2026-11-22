/**
 * TSL, loosely typed. @types/three types every node precisely, which fights
 * generic shader helpers (a vec3 built by arithmetic is inferred as a float,
 * and so on); the WGSL / GLSL compiler checks these shaders at runtime.
 */
import * as TSL from "three/tsl";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const L: any = TSL;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type N = any;

export const {
  Fn,
  If,
  Loop,
  abs,
  atan,
  cameraPosition,
  cameraViewMatrix,
  clamp,
  cos,
  cross,
  dot,
  exp,
  float,
  floor,
  fract,
  hash,
  instanceIndex,
  instancedArray,
  length,
  luminance,
  max,
  min,
  mix,
  modelViewMatrix,
  mx_noise_vec3,
  normalLocal,
  normalWorld,
  normalize,
  pass,
  positionLocal,
  positionWorld,
  pow,
  reflect,
  reflector,
  renderOutput,
  screenSize,
  screenUV,
  select,
  sin,
  smoothstep,
  sqrt,
  step,
  texture,
  uint,
  uniform,
  uniformArray,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} = L;
