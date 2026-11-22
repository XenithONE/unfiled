/**
 * Layout — where everything stands on the mirror, and where the camera stops.
 *
 * The works line a U-shaped walk: it leaves toward the sunset, turns through
 * the night and comes back facing the place the sun will rise. Slabs stand to
 * the right of the walk, angled back toward whoever approaches. Camera stops
 * are derived from the slabs (not the other way round), so a different aspect
 * ratio only re-frames the same world.
 *
 * Conventions: metres, y up, water at y = 0. A yaw of 0 looks down -z and a
 * positive yaw turns left; an azimuth of 0 is -z and grows clockwise (to +x).
 */
import { rng } from "./rng";

export const DEG = Math.PI / 180;

export interface SlabPose {
  x: number;
  z: number;
  /** Rotation about y; the picture faces local +z. */
  yaw: number;
  /** Size of the picture itself (the body adds a bezel and a foot). */
  width: number;
  height: number;
}

export interface CamPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  fov: number;
}

export interface View {
  aspect: number;
  narrow: boolean;
}

export interface MonumentPose {
  x: number;
  z: number;
  yaw: number;
  width: number;
  /** Cap height in metres for a monument of `width`. */
  height: number;
}

/** Picture starts this far above the water (the slab's foot). */
export const SLAB_FOOT = 0.14;

const L0 = 60;
const RADIUS = 110;
const FIRST = 30;
// a stop stands about ten metres before its slab, so the previous slab has
// to be well behind that: slabs are spaced wider than the viewing distance
const STEP = 15;

/** Width / cap-height of the wordmark (from wordmark.json). */
const MONUMENT_ASPECT = 7.182 / 0.64;

function baseline(u: number) {
  if (u <= L0) return { x: 0, z: -u, tx: 0, tz: -1 };
  const arc = Math.PI * RADIUS;
  if (u <= L0 + arc) {
    const th = (u - L0) / RADIUS;
    return {
      x: RADIUS - RADIUS * Math.cos(th),
      z: -L0 - RADIUS * Math.sin(th),
      tx: Math.sin(th),
      tz: -Math.cos(th),
    };
  }
  return { x: 2 * RADIUS, z: -L0 + (u - L0 - arc), tx: 0, tz: 1 };
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The walk itself: the U with a lazy meander laid over it. */
export function walk(u: number) {
  const b = baseline(u);
  const m = (5 * Math.sin(u / 19 + 0.6) + 1.6 * Math.sin(u / 8.3 + 2.1)) * smooth(10, 44, u);
  // right of the heading is (-tz, tx)
  return { x: b.x - b.tz * m, z: b.z + b.tx * m, tx: b.tx, tz: b.tz };
}

/** Picture size for a cover of the given aspect: equal area, sane limits. */
export function slabSize(aspect: number, scale = 1) {
  const area = 15.4;
  const height = Math.max(2.85, Math.min(4.1, Math.sqrt(area / aspect))) * scale;
  return { width: height * aspect, height };
}

export function buildSlabs(aspects: number[], seed = 35): SlabPose[] {
  const rand = rng(seed);
  return aspects.map((aspect, i) => {
    const u = FIRST + i * STEP;
    const p = walk(u);
    const lateral = 5.6 + rand() * 1.6;
    const x = p.x - p.tz * lateral;
    const z = p.z + p.tx * lateral;
    // Turned well toward the walk, like pictures along a corridor: a visitor
    // stops a little left of the walk, looks at the slab from there, and then
    // carries straight on with the slab's near edge several metres clear.
    const from = walk(u - 6.5);
    const ax = from.x + from.tz * 1.6;
    const az = from.z - from.tx * 1.6;
    const yaw = Math.atan2(ax - x, az - z) + (rand() - 0.5) * 8 * DEG;
    const size = slabSize(aspect, 0.95 + rand() * 0.13);
    return { x, z, yaw, ...size };
  });
}

export function buildMonument(): MonumentPose {
  const x = -30;
  const z = -48;
  const width = 46;
  return { x, z, yaw: Math.atan2(2 - x, 8 - z), width, height: width / MONUMENT_ASPECT };
}

/** The notch of the L (above its foot, before the E): the sun starts there. */
export function monumentGap(m: MonumentPose) {
  const along = (0.637 - 0.5) * m.width;
  return { x: m.x + Math.cos(m.yaw) * along, z: m.z - Math.sin(m.yaw) * along };
}

const halfFov = (fov: number, view: View) => {
  const v = (fov * DEG) / 2;
  return { v, h: Math.atan(Math.tan(v) * view.aspect) };
};

const fovFor = (view: View) => (view.narrow ? 62 : 48);

/** A world point in a pose's frame: [ndc x, ndc y, depth]. */
export function project(pose: CamPose, view: View, x: number, y: number, z: number) {
  const cy = Math.cos(pose.yaw);
  const sy = Math.sin(pose.yaw);
  const cp = Math.cos(pose.pitch);
  const sp = Math.sin(pose.pitch);
  const dx = x - pose.x;
  const dy = y - pose.y;
  const dz = z - pose.z;
  const depth = dx * (-sy * cp) + dy * sp + dz * (-cy * cp);
  const right = dx * cy - dz * sy;
  const up = dx * (sy * sp) + dy * cp + dz * (cy * sp);
  const { v, h } = halfFov(pose.fov, view);
  return [right / depth / Math.tan(h), up / depth / Math.tan(v), depth] as const;
}

/** The part of the frame (in NDC) a slab is allowed to fill. */
interface Window {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Count the slab's mirror image as part of the block. */
  mirror: boolean;
  /** Camera offset from the slab's axis, toward its right-hand edge. */
  delta: number;
}

function windowFor(view: View, detail: boolean): Window {
  if (view.narrow) {
    // the caption (or the detail sheet) owns the foot of a narrow screen
    return detail
      ? { x0: -0.86, x1: 0.86, y0: 0.2, y1: 0.82, mirror: false, delta: 0 }
      : { x0: -0.86, x1: 0.86, y0: 0.02, y1: 0.76, mirror: false, delta: 0 };
  }
  // wide: the slab beside the words, standing on its own reflection
  return detail
    ? { x0: -0.92, x1: -0.03, y0: -0.97, y1: 0.82, mirror: true, delta: -8 * DEG }
    : { x0: 0.07, x1: 0.89, y0: -0.97, y1: 0.86, mirror: true, delta: 7 * DEG };
}

/**
 * Stand in front of a slab so that it fills its window of the frame. Angles
 * add up quickly off-axis in a rectilinear picture, so instead of trusting a
 * formula the corners are projected and the camera backs off until they fit.
 */
function slabPose(s: SlabPose, view: View, detail: boolean): CamPose {
  const fov = fovFor(view);
  const { v, h } = halfFov(fov, view);
  const eye = view.narrow ? 0.8 : 0.62;
  const win = windowFor(view, detail);
  const nx = Math.sin(s.yaw);
  const nz = Math.cos(s.yaw);
  // local +x in world space
  const rx = Math.cos(s.yaw);
  const rz = -Math.sin(s.yaw);
  const top = SLAB_FOOT + s.height;
  const corners: Array<[number, number, number]> = [];
  for (const side of [-0.5, 0.5]) {
    const cx = s.x + rx * s.width * side;
    const cz = s.z + rz * s.width * side;
    corners.push([cx, top, cz], [cx, SLAB_FOOT, cz]);
    if (win.mirror) corners.push([cx, -top, cz]);
  }
  const pose: CamPose = { x: 0, y: eye, z: 0, yaw: 0, pitch: 0, fov };
  let dist = 5.5;
  for (let grow = 0; grow < 40; grow++) {
    pose.x = s.x + nx * dist * Math.cos(win.delta) + rx * dist * Math.sin(win.delta);
    pose.z = s.z + nz * dist * Math.cos(win.delta) + rz * dist * Math.sin(win.delta);
    pose.yaw = Math.atan2(-(s.x - pose.x), -(s.z - pose.z));
    pose.pitch = 0;
    let w = 0;
    let hgt = 0;
    for (let aim = 0; aim < 4; aim++) {
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const c of corners) {
        const [px, py] = project(pose, view, c[0], c[1], c[2]);
        x0 = Math.min(x0, px);
        x1 = Math.max(x1, px);
        y0 = Math.min(y0, py);
        y1 = Math.max(y1, py);
      }
      w = x1 - x0;
      hgt = y1 - y0;
      // turning left moves things right; looking up moves them down
      pose.yaw -= Math.atan(((x0 + x1) / 2 - (win.x0 + win.x1) / 2) * Math.tan(h));
      pose.pitch += Math.atan(((y0 + y1) / 2 - (win.y0 + win.y1) / 2) * Math.tan(v));
    }
    if (w <= win.x1 - win.x0 && hgt <= win.y1 - win.y0) break;
    dist *= 1.04;
  }
  return pose;
}

export const stationPose = (s: SlabPose, view: View) => slabPose(s, view, false);
export const detailPose = (s: SlabPose, view: View) => slabPose(s, view, true);

/** Opening shot: the wordmark against the last light. */
export function heroPose(m: MonumentPose, view: View): CamPose {
  const fov = fovFor(view);
  const { v, h } = halfFov(fov, view);
  const dist = m.width / 2 / Math.tan(h * (view.narrow ? 0.9 : 0.69));
  const x = m.x + Math.sin(m.yaw) * dist;
  const z = m.z + Math.cos(m.yaw) * dist;
  const yawToIt = Math.atan2(-(m.x - x), -(m.z - z));
  // wide: the wordmark sits left of centre so the first works show beside it
  const x0 = view.narrow ? 0 : -0.17;
  const horizon = view.narrow ? 0.3 : 0.07;
  return {
    x,
    y: 0.5,
    z,
    yaw: yawToIt + Math.atan(x0 * Math.tan(h)),
    pitch: -Math.atan(horizon * Math.tan(v)),
    fov,
  };
}

/** Last shot: open water toward the coming sunrise. */
export function endPose(count: number, view: View): CamPose {
  const u = FIRST + (count - 1) * STEP + 17;
  const p = walk(u);
  const fov = fovFor(view);
  const { v } = halfFov(fov, view);
  return {
    x: p.x + p.tz * 1.5,
    y: 0.62,
    z: p.z - p.tx * 1.5,
    yaw: Math.atan2(-p.tx, -p.tz),
    pitch: -Math.atan((view.narrow ? -0.2 : -0.04) * Math.tan(v)),
    fov,
  };
}

/** Azimuth the camera of a pose looks along, plus a shift in screen space. */
export function azimuthAt(pose: CamPose, view: View, ndcX: number) {
  const { h } = halfFov(pose.fov, view);
  return -pose.yaw + Math.atan(ndcX * Math.tan(h));
}

/* ---------------------------------------------------------------------- */
/* interpolation                                                           */
/* ---------------------------------------------------------------------- */

/** Monotone cubic (Fritsch–Carlson): never overshoots uneven keys. */
export function pchip(xs: number[], ys: number[]) {
  const n = xs.length;
  const d = new Array<number>(n).fill(0);
  if (n > 1) {
    const h: number[] = [];
    const delta: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      h.push(xs[i + 1] - xs[i]);
      delta.push((ys[i + 1] - ys[i]) / h[i]);
    }
    d[0] = delta[0];
    d[n - 1] = delta[n - 2];
    for (let i = 1; i < n - 1; i++) {
      if (delta[i - 1] * delta[i] <= 0) d[i] = 0;
      else {
        const w1 = 2 * h[i] + h[i - 1];
        const w2 = h[i] + 2 * h[i - 1];
        d[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
      }
    }
  }
  return (x: number) => {
    if (n === 1 || x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i] +
      (t3 - 2 * t2 + t) * h * d[i] +
      (-2 * t3 + 3 * t2) * ys[i + 1] +
      (t3 - t2) * h * d[i + 1]
    );
  };
}

/** A camera path through poses placed at the given progress values. */
export class Tour {
  private fx: (p: number) => number;
  private fy: (p: number) => number;
  private fz: (p: number) => number;
  private fyaw: (p: number) => number;
  private fpitch: (p: number) => number;
  private ffov: (p: number) => number;

  constructor(knots: number[], poses: CamPose[]) {
    // unwrap yaw so the path never spins the long way round
    const yaws: number[] = [];
    poses.forEach((pose, i) => {
      let y = pose.yaw;
      if (i > 0) {
        const prev = yaws[i - 1];
        while (y - prev > Math.PI) y -= Math.PI * 2;
        while (y - prev < -Math.PI) y += Math.PI * 2;
      }
      yaws.push(y);
    });
    this.fx = pchip(knots, poses.map((p) => p.x));
    this.fy = pchip(knots, poses.map((p) => p.y));
    this.fz = pchip(knots, poses.map((p) => p.z));
    this.fyaw = pchip(knots, yaws);
    this.fpitch = pchip(knots, poses.map((p) => p.pitch));
    this.ffov = pchip(knots, poses.map((p) => p.fov));
  }

  at(p: number): CamPose {
    return {
      x: this.fx(p),
      y: this.fy(p),
      z: this.fz(p),
      yaw: this.fyaw(p),
      pitch: this.fpitch(p),
      fov: this.ffov(p),
    };
  }
}
