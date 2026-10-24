/**
 * The particle quad: every visible grain in MYRIAD is an instanced quad whose
 * corners are placed in screen space by this vertex function, so the
 * screen-space tricks can all live in one place.
 *
 * #1  screen-space bokeh — size and edge width grow with |depth − focus|
 * #4  pseudo-anamorphic flare — x-only stretch with depth / brightness
 * #6  screen-edge vignette erase — size → 0 near the frame edges
 * #8  stateless afterimage — the tail is the position at time − Δ
 * #9  velocity stretch — the tail is position − velocity·k
 * #11 cylindrical billboard — locked to a world axis via cross(axis, toCamera)
 * #12 distance LOD scaling — a minimum pixel radius with energy conservation
 * #19 1px outline from fwidth of an SDF
 * #22 SDF shapes (circle, square, star) that morph into each other
 * #5  dithered transparency for opaque particles (no sorting)
 */
import {
  abs,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  cross,
  dot,
  exp,
  float,
  fract,
  fwidth,
  length,
  max,
  min,
  mix,
  normalize,
  positionGeometry,
  pow,
  screenCoordinate,
  select,
  smoothstep,
  varying,
  vec2,
  vec3,
  vec4,
} from "./t";
import type { N } from "./common";
import { G, T } from "./common";

export interface SpriteSpec {
  /** World-space centre (the head of a streak). */
  center: N;
  /** World-space radius. */
  radius: N;
  /** World-space tail of a streak (#8 / #9). */
  tail?: N;
  /** Fraction of streak light kept (1 = no dimming as it stretches). */
  streakKeep?: number;
  maxStreakPx?: number;
  /** World axis (unit) + half length for a cylindrical billboard (#11). */
  axis?: N;
  axisHalf?: N;
  minPx?: number;
  maxPx?: number;
  edgeFade?: boolean;
  bokeh?: boolean;
  /** Extra brightness kept by defocused discs (0 = strict energy). */
  bokehFloor?: number;
  /** Horizontal stretch amount (#4); 0 disables. */
  anamorphic?: N;
  /** 0 hides the instance. */
  visible?: N;
}

export interface SpriteOut {
  clip: N;
  /** Radius units; the round part of the shape has radius 1. */
  local: N;
  /** Capsule half length in radius units. */
  halfLen: N;
  /** Brightness factor from size changes (energy conservation). */
  energy: N;
  /** 0..1 defocus amount. */
  coc: N;
  /** Final radius in pixels. */
  rpx: N;
  /** Anamorphic stretch factor (>= 1). */
  stretch: N;
}

const HIDDEN = vec4(2, 2, 2, 1);

export function spriteVertex(spec: SpriteSpec): SpriteOut {
  const corner = positionGeometry.xy;
  const minPx = spec.minPx ?? 0.7;
  const maxPx = spec.maxPx ?? 360;

  if (spec.axis) return cylindrical(spec, corner, minPx);

  const view = cameraViewMatrix.mul(vec4(spec.center, 1)).toVar();
  const depth = view.z.negate().toVar();
  const clip = cameraProjectionMatrix.mul(view).toVar();
  const ndc = clip.xy.div(clip.w.max(1e-5)).toVar();
  const r0 = spec.radius.mul(G.pxPerUnit).div(depth.max(1e-4)).toVar();

  // #1 bokeh: the circle of confusion grows with distance from the focus plane
  let r1: N = r0;
  let energy: N = float(1);
  let coc: N = float(0);
  if (spec.bokeh) {
    const cocPx = abs(depth.sub(G.focus)).div(depth.max(1e-3)).mul(G.aperture).mul(T(1)).toVar();
    r1 = max(r0, cocPx).toVar();
    const strict = r0.div(r1.max(1e-4)).pow(2);
    energy = max(strict, float(spec.bokehFloor ?? 0.015).mul(smoothstep(0, 1, cocPx.div(r0.add(1)))));
    coc = clamp(cocPx.div(r0.add(2)).sub(0.25), 0, 1);
  }

  // #12 a floor on the pixel radius; the light is spread instead of lost
  const rMin = max(r1, float(minPx)).toVar();
  const r2 = mix(r1, rMin, T(12)).toVar();
  energy = energy.mul(mix(float(1), r1.div(r2.max(1e-4)).pow(2), T(12)));

  // #6 shrink towards the edges so frustum culling never pops visibly
  let r3: N = min(r2, float(maxPx));
  if (spec.edgeFade) {
    const ax = float(1).sub(smoothstep(0.78, 1.04, abs(ndc.x)));
    const ay = float(1).sub(smoothstep(0.78, 1.04, abs(ndc.y)));
    r3 = r3.mul(mix(float(1), ax.mul(ay), T(6)));
  }
  r3 = r3.toVar();

  // #4 anamorphic flare: stretch along x only
  const stretch = spec.anamorphic ? float(1).add(spec.anamorphic.mul(T(4))).toVar() : float(1);

  let axisA: N = vec2(1, 0);
  let axisB: N = vec2(0, 1);
  let extA: N = r3.mul(stretch);
  const extB: N = r3;
  let centerNdc: N = ndc;
  let halfLen: N = float(0);

  if (spec.tail) {
    // #8 / #9 streak from the projected tail to the head
    const tview = cameraViewMatrix.mul(vec4(spec.tail, 1));
    const tclip = cameraProjectionMatrix.mul(tview);
    const tw = tclip.w.max(depth.mul(0.2)).max(1e-4);
    const tndc = tclip.xy.div(tw);
    const dPx = ndc.sub(tndc).mul(G.screen).mul(0.5).toVar();
    const lenRaw = length(dPx);
    const len = min(lenRaw, float(spec.maxStreakPx ?? 900)).toVar();
    const dir = select(lenRaw.greaterThan(0.001), dPx.div(lenRaw.max(1e-5)), vec2(1, 0)).toVar();
    const hl = len.mul(0.5).toVar();
    centerNdc = ndc.sub(dir.mul(hl).mul(2).div(G.screen));
    axisA = dir;
    axisB = vec2(dir.y.negate(), dir.x);
    extA = hl.add(r3);
    halfLen = hl.div(r3.max(1e-4));
    const keep = float(spec.streakKeep ?? 0.35);
    energy = energy.mul(mix(keep, float(1), r3.div(r3.add(hl))));
  }

  const offsetPx = axisA.mul(corner.x.mul(extA)).add(axisB.mul(corner.y.mul(extB)));
  const outXY = centerNdc.add(offsetPx.mul(2).div(G.screen)).mul(clip.w);
  let ok: N = depth.greaterThan(G.near).and(r3.greaterThan(0.01));
  if (spec.visible !== undefined) ok = ok.and(spec.visible.greaterThan(0.001));
  const clipOut = select(ok, vec4(outXY, clip.z, clip.w), HIDDEN);

  return {
    clip: clipOut,
    local: varying(vec2(corner.x.mul(extA), corner.y.mul(extB)).div(r3.max(1e-4))),
    halfLen: varying(halfLen),
    energy: varying(energy),
    coc: varying(coc),
    rpx: varying(r3),
    stretch: varying(stretch),
  };
}

/** #11 — a quad locked to a world axis, turned to face the camera around it. */
function cylindrical(spec: SpriteSpec, corner: N, minPx: number): SpriteOut {
  const c = spec.center;
  const axis = spec.axis;
  const half = spec.axisHalf ?? float(1);
  const toCam = normalize(cameraPosition.sub(c));
  const side = cross(axis, toCam);
  const sideLen = length(side);
  const right = select(sideLen.greaterThan(1e-4), side.div(sideLen.max(1e-6)), vec3(1, 0, 0));
  const view = cameraViewMatrix.mul(vec4(c, 1));
  const depth = view.z.negate().max(1e-4);
  const wPx = spec.radius.mul(G.pxPerUnit).div(depth);
  // #12 keep thin streaks at least minPx wide; dim them to compensate
  const wUse = mix(wPx, max(wPx, float(minPx)), T(12));
  const width = spec.radius.mul(wUse.div(wPx.max(1e-5)));
  const energy = mix(float(1), wPx.div(wUse.max(1e-5)), T(12));
  const along = half.add(width);
  const world = c.add(axis.mul(corner.y.mul(along))).add(right.mul(corner.x.mul(width)));
  const clip = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(world, 1)));
  let ok: N = depth.greaterThan(G.near);
  if (spec.visible !== undefined) ok = ok.and(spec.visible.greaterThan(0.001));
  return {
    clip: select(ok, clip, HIDDEN),
    local: varying(vec2(corner.y.mul(along), corner.x.mul(width)).div(width.max(1e-5))),
    halfLen: varying(half.div(width.max(1e-5))),
    energy: varying(energy),
    coc: varying(float(0)),
    rpx: varying(wUse),
    stretch: varying(float(1)),
  };
}

/* ---------------------------------------------------------------------- */
/* fragment shapes                                                         */
/* ---------------------------------------------------------------------- */

/** Distance in radius units from the capsule core (0 = centre line). */
export function capsuleDist(s: SpriteOut): N {
  const p = s.local;
  return length(vec2(max(abs(p.x).sub(s.halfLen), 0), p.y));
}

/** Soft glowing grain; `hard` 0 = very soft, 1 = crisp edge. */
export function glowShape(s: SpriteOut, hard = 0.5): N {
  const d = capsuleDist(s);
  const aa = float(1.2).div(s.rpx.max(0.5));
  const soft = exp(d.mul(d).mul(-4.5));
  const disc = float(1).sub(smoothstep(float(1).sub(aa).sub(0.25), float(1), d));
  return mix(soft, disc, hard).mul(float(1).sub(smoothstep(0.95, 1.0, d)));
}

/**
 * #1 bokeh-aware shape: a soft dot in focus, a disc with a widening soft edge
 * (and a faint bright rim) out of focus.
 */
export function bokehShape(s: SpriteOut): N {
  const d = capsuleDist(s);
  const aa = float(1.5).div(s.rpx.max(0.5));
  const edge = clamp(aa.add(s.coc.mul(0.3)), 0.02, 1);
  const disc = float(1).sub(smoothstep(float(1).sub(edge), float(1), d));
  const rim = smoothstep(0.45, 0.95, d).mul(0.35).add(0.75);
  const focused = exp(d.mul(d).mul(-5.0));
  const k = smoothstep(0.0, 0.35, s.coc);
  return mix(focused, disc.mul(rim), k);
}

/** #4 a bright core plus a thin horizontal streak (anamorphic flare look). */
export function flareShape(s: SpriteOut): N {
  const p = s.local;
  const core = exp(dot(p, p).mul(-6.0));
  const streak = exp(abs(p.y).mul(-9.0)).mul(exp(abs(p.x).div(s.stretch).mul(-2.6)));
  const flare = streak.mul(s.stretch.sub(1).min(1));
  return core.add(flare.mul(0.55)).mul(float(1).sub(smoothstep(0.9, 1.0, abs(p.x).div(s.stretch))));
}

/** #22 SDFs — all return 1 on the outline. */
export const sdSquare = (p: N): N => max(abs(p.x), abs(p.y)).mul(1.25);
export const sdCircle = (p: N): N => length(p);
/** Four-pointed star (an astroid / superellipse with exponent 1/2). */
export const sdStar = (p: N): N => {
  const a = abs(p).max(1e-5);
  return pow(pow(a.x, 0.5).add(pow(a.y, 0.5)), 2).mul(0.82);
};

/** #22 morph: 0 = square, 1 = circle, 2 = star. */
export function morphSdf(p: N, m: N): N {
  const toCircle = clamp(m, 0, 1);
  const toStar = clamp(m.sub(1), 0, 1);
  const off = sdCircle(p);
  const morphed = mix(mix(sdSquare(p), sdCircle(p), toCircle), sdStar(p), toStar);
  return mix(off, morphed, T(22));
}

/** Filled SDF with an anti-aliased edge (screen-space width via fwidth). */
export function fillSdf(d: N, soft = 0.0): N {
  const w = fwidth(d).max(1e-4);
  return float(1).sub(smoothstep(float(1).sub(w).sub(soft), float(1).add(w), d));
}

/** #19 a line exactly ~1 device pixel wide on the d = 1 contour. */
export function outlineSdf(d: N, px = 1): N {
  const w = fwidth(d).max(1e-5);
  const line = float(1).sub(smoothstep(w.mul(px * 0.5), w.mul(px * 0.5 + 1), abs(d.sub(1))));
  // with #19 off: a line of constant world width (thick near, vanishing far)
  const naive = float(1).sub(smoothstep(0.0, 0.06, abs(d.sub(1))));
  return mix(naive, line, T(19));
}

/** Interleaved gradient noise in [0, 1) from the pixel coordinate. */
export function ign(): N {
  const c = screenCoordinate.xy;
  return fract(float(52.9829189).mul(fract(dot(c, vec2(0.06711056, 0.00583715)))));
}

/**
 * #5 — coverage as a screen-space dither (opaque, depth-writing particles
 * fade without sorting). Off: a hard 50 % cut that pops.
 */
export function ditherKeep(alpha: N): N {
  const threshold = mix(float(0.5), ign(), T(5));
  return alpha.greaterThan(threshold);
}
