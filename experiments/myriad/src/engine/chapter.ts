import { Group } from "three/webgpu";
import type { PerspectiveCamera, Scene, WebGPURenderer } from "three/webgpu";
import type { Post } from "./post";
import type { Rig } from "./rig";
import { Track } from "./rig";

export type Tier = "ultra" | "high" | "mid" | "low";

/** Particle-count multiplier per tier (1 = desktop with a strong GPU). */
export const TIER_SCALE: Record<Tier, number> = { ultra: 1, high: 0.6, mid: 0.36, low: 0.18 };

export interface Ctx {
  renderer: WebGPURenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  rig: Rig;
  post: Post;
  tier: Tier;
  /** Count multiplier for the tier. */
  q: number;
  reduced: boolean;
}

/** What the post-processing and lens should look like at a moment. */
export interface Look {
  bloom: [number, number, number];
  exposure: number;
  vignette: number;
  focus: number;
  aperture: number;
  near: number;
  far: number;
  sky: number;
  warp: number;
  flash: number;
  flashColor: [number, number, number];
  impact: number;
  bloomGain: number;
}

export const defaultLook = (): Look => ({
  bloom: [0.9, 0.55, 0.3],
  exposure: 1,
  vignette: 0.55,
  focus: 20,
  aperture: 0,
  near: 0.05,
  far: 6000,
  sky: 1,
  warp: 0,
  flash: 0,
  flashColor: [1, 1, 1],
  impact: 0,
  bloomGain: 1,
});

/** Smooth 0→1 ramp of t between a and b. */
export const ramp = (t: number, a: number, b: number) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

/** A pulse that rises over `rise` s from `at` and decays with `decay` s. */
export const pulse = (t: number, at: number, rise: number, decay: number) => {
  if (t < at) return 0;
  const u = t - at;
  return u < rise ? u / rise : Math.exp(-(u - rise) / decay);
};

export abstract class Chapter {
  abstract readonly id: string;
  /** Roman numeral shown in the UI ("" for the prologue). */
  abstract readonly numeral: string;
  abstract readonly name: string;
  abstract readonly caption: string;
  abstract readonly duration: number;
  /** Technique numbers (1..31) this chapter shows. */
  abstract readonly techniques: number[];
  readonly group = new Group();
  track: Track = new Track([{ t: 0, pos: [0, 0, 10], look: [0, 0, 0] }]);
  /** Where a loop re-enters this chapter (seconds). */
  loopEntry = 0;
  /** Fade from / to black at the chapter edges (seconds, 0 = none). */
  fadeIn = 0.6;
  fadeOut = 0.6;
  /** Moments the soundtrack punctuates (local seconds). */
  events: { t: number; name: string }[] = [];

  abstract build(ctx: Ctx): void | Promise<void>;
  /** Called when the chapter becomes active (also on seeks). */
  enter(_ctx: Ctx, _t: number): void {}
  exit(_ctx: Ctx): void {}
  /** Compute passes that advance a simulation (only while time runs). */
  simulate(_ctx: Ctx, _t: number, _dt: number): void {}
  /** Compute passes every frame needs, even when paused (e.g. culling). */
  prepare(_ctx: Ctx): void {}
  /** Uniforms and object state for local time t. */
  abstract update(ctx: Ctx, t: number, dt: number): void;
  /** Post / lens settings for local time t. */
  abstract look(t: number, out: Look): void;
}
