/**
 * Camera choreography: per-chapter keyframe tracks (non-uniform Catmull–Rom
 * in time), plus the viewer's drag-to-look offset and a little shake.
 */
import { MathUtils, PerspectiveCamera, Quaternion, Vector3 } from "three/webgpu";

export type V3 = [number, number, number];

export interface Key {
  t: number;
  pos: V3;
  look: V3;
  fov?: number;
  roll?: number;
}

export interface Pose {
  pos: Vector3;
  look: Vector3;
  fov: number;
  roll: number;
}

/**
 * Monotone cubic (Fritsch–Carlson) tangents for one channel: smooth like a
 * spline but never overshooting a key, so the camera cannot back up.
 */
function pchipTangents(t: number[], y: number[]): number[] {
  const n = y.length;
  const m = new Array<number>(n).fill(0);
  if (n < 2) return m;
  const h: number[] = [];
  const d: number[] = [];
  for (let k = 0; k < n - 1; k++) {
    h.push(Math.max(1e-6, t[k + 1] - t[k]));
    d.push((y[k + 1] - y[k]) / h[k]);
  }
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let k = 1; k < n - 1; k++) {
    if (d[k - 1] * d[k] <= 0) m[k] = 0;
    else {
      const w1 = 2 * h[k] + h[k - 1];
      const w2 = h[k] + 2 * h[k - 1];
      m[k] = (w1 + w2) / (w1 / d[k - 1] + w2 / d[k]);
    }
  }
  return m;
}

const CHANNELS: ((k: Key) => number)[] = [
  (k) => k.pos[0],
  (k) => k.pos[1],
  (k) => k.pos[2],
  (k) => k.look[0],
  (k) => k.look[1],
  (k) => k.look[2],
  (k) => k.fov ?? 50,
  (k) => k.roll ?? 0,
];

export class Track {
  readonly keys: Key[];
  private times: number[];
  private values: number[][];
  private tangents: number[][];

  constructor(keys: Key[]) {
    if (keys.length === 0) throw new Error("empty track");
    this.keys = [...keys].sort((a, b) => a.t - b.t);
    this.times = this.keys.map((k) => k.t);
    this.values = CHANNELS.map((sel) => this.keys.map(sel));
    this.tangents = this.values.map((v) => pchipTangents(this.times, v));
  }

  get end() {
    return this.times[this.times.length - 1];
  }

  sample(t: number, out: Pose): Pose {
    const k = this.keys;
    const n = k.length;
    if (n === 1 || t <= k[0].t) return this.assign(k[0], out);
    if (t >= k[n - 1].t) return this.assign(k[n - 1], out);
    let i = 0;
    while (i < n - 2 && t > this.times[i + 1]) i++;
    const h = this.times[i + 1] - this.times[i];
    const s = (t - this.times[i]) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1;
    const h10 = s3 - 2 * s2 + s;
    const h01 = -2 * s3 + 3 * s2;
    const h11 = s3 - s2;
    const v = this.values.map(
      (y, c) => h00 * y[i] + h10 * h * this.tangents[c][i] + h01 * y[i + 1] + h11 * h * this.tangents[c][i + 1],
    );
    out.pos.set(v[0], v[1], v[2]);
    out.look.set(v[3], v[4], v[5]);
    out.fov = v[6];
    out.roll = v[7];
    return out;
  }

  private assign(key: Key, out: Pose): Pose {
    out.pos.set(...key.pos);
    out.look.set(...key.look);
    out.fov = key.fov ?? 50;
    out.roll = key.roll ?? 0;
    return out;
  }

  /** Whether the camera cuts (jumps) between local times a and b. */
  cutBetween(_a: number, _b: number): boolean {
    return false;
  }
}

/** Several tracks played back to back, with hard cuts between them. */
export class Shots extends Track {
  private readonly parts: Track[];
  private readonly cuts: number[];

  constructor(parts: Key[][]) {
    super(parts.flat());
    this.parts = parts.map((k) => new Track(k));
    this.cuts = this.parts.slice(1).map((p) => p.keys[0].t);
  }

  sample(t: number, out: Pose): Pose {
    let i = 0;
    while (i < this.cuts.length && t >= this.cuts[i]) i++;
    return this.parts[i].sample(t, out);
  }

  cutBetween(a: number, b: number): boolean {
    return this.cuts.some((c) => a < c && b >= c);
  }
}

export const makePose = (): Pose => ({ pos: new Vector3(), look: new Vector3(), fov: 50, roll: 0 });

const _fwd = new Vector3();
const _right = new Vector3();
const _up = new Vector3();
const _q = new Quaternion();
const _prev = new Vector3();

/** Applies a pose plus look-around offsets and shake to the real camera. */
export class Rig {
  readonly camera: PerspectiveCamera;
  /** Viewer look-around (radians), eased back to zero when idle. */
  yaw = 0;
  pitch = 0;
  yawTarget = 0;
  pitchTarget = 0;
  dragging = false;
  idleTime = 0;
  shake = 0;
  readonly velocity = new Vector3();
  private time = 0;
  private skipVelocity = true;
  reduced = false;

  constructor(camera: PerspectiveCamera) {
    this.camera = camera;
  }

  apply(pose: Pose, dt: number) {
    this.time += dt;
    const cam = this.camera;
    _prev.copy(cam.position);

    if (!this.dragging) {
      this.idleTime += dt;
      if (this.idleTime > 2.5) {
        const k = 1 - Math.exp(-dt * 0.9);
        this.yawTarget += (0 - this.yawTarget) * k;
        this.pitchTarget += (0 - this.pitchTarget) * k;
      }
    } else {
      this.idleTime = 0;
    }
    const e = 1 - Math.exp(-dt * 8);
    this.yaw += (this.yawTarget - this.yaw) * e;
    this.pitch += (this.pitchTarget - this.pitch) * e;

    cam.position.copy(pose.pos);
    _fwd.copy(pose.look).sub(pose.pos).normalize();
    _right.crossVectors(_fwd, cam.up.set(0, 1, 0)).normalize();
    if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
    _up.crossVectors(_right, _fwd).normalize();

    // look-around: yaw about the local up, pitch about the local right
    _q.setFromAxisAngle(_up, this.yaw);
    _fwd.applyQuaternion(_q);
    _right.applyQuaternion(_q);
    _q.setFromAxisAngle(_right, this.pitch);
    _fwd.applyQuaternion(_q);

    // shake: two incommensurate sines per axis (cheap, smooth)
    const s = this.reduced ? this.shake * 0.25 : this.shake;
    if (s > 1e-4) {
      const t = this.time;
      const jx = (Math.sin(t * 37.1) * 0.6 + Math.sin(t * 61.7) * 0.4) * s * 0.012;
      const jy = (Math.sin(t * 43.3 + 1.7) * 0.6 + Math.sin(t * 71.9) * 0.4) * s * 0.012;
      _fwd.addScaledVector(_right, jx).addScaledVector(_up, jy).normalize();
    }

    cam.up.copy(_up).applyAxisAngle(_fwd, pose.roll);
    _fwd.add(cam.position);
    cam.lookAt(_fwd);
    if (Math.abs(cam.fov - pose.fov) > 1e-3) {
      cam.fov = pose.fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
    if (this.skipVelocity) {
      this.velocity.set(0, 0, 0);
      this.skipVelocity = false;
    } else if (dt > 0) {
      this.velocity.copy(cam.position).sub(_prev).divideScalar(dt);
    }
  }

  /** After a cut the position jump is not a velocity. */
  cut() {
    this.skipVelocity = true;
  }

  drag(dx: number, dy: number) {
    this.dragging = true;
    this.idleTime = 0;
    this.yawTarget = MathUtils.clamp(this.yawTarget - dx * 0.0035, -1.1, 1.1);
    this.pitchTarget = MathUtils.clamp(this.pitchTarget - dy * 0.0035, -0.75, 0.75);
  }

  release() {
    this.dragging = false;
  }
}
