import * as THREE from "three";
import type { Course, Rail, RoadPoint, TerrainSample } from "./course";
import { TAU, angleDiff, clamp, moveToward } from "./util";

export interface InputState {
  steer: number;
  push: boolean;
  brake: boolean;
  crouch: boolean;
  jump: boolean;
  kickflip: boolean;
  heelflip: boolean;
  shove: boolean;
  reset: boolean;
}
export const emptyInput = (): InputState => ({
  steer: 0,
  push: false,
  brake: false,
  crouch: false,
  jump: false,
  kickflip: false,
  heelflip: false,
  shove: false,
  reset: false,
});

export type SoundName =
  | "pop"
  | "land"
  | "bail"
  | "grind"
  | "swish"
  | "bank"
  | "bigbank"
  | "push"
  | "boost"
  | "wall";
export type SimEvent =
  | { type: "trick"; name: string; points: number }
  | { type: "land"; combo: number; count: number; total: number }
  | { type: "bail" }
  | { type: "boost"; label: string }
  | { type: "respawn" }
  | { type: "sound"; name: SoundName };

export const G = 15;
const MAX_SPEED = 46;
const PUSH_ACC = 9;
const PUSH_MAX = 12;
export const PUSH_TIME = 0.6;
const BRAKE = 12;
const ROLL_ROAD = 0.18;
const ROLL_OFF = 2.4;
const DRAG = 0.00125;
const TUCK_DRAG = 0.6;
const TURN_RATE = 2.3;
const AIR_SPIN = 6.5;
const GRIP_LOW = 9;
const GRIP_HIGH = 3.5;
const PUMP = 12;
const POP_MIN = 5.5;
const POP_MAX = 9.0;
export const CHARGE_MAX = 0.32;
const FLIP_TIME = 0.4;
const SHOVE_TIME = 0.34;
const RAIL_CATCH_R = 0.4;
const STEP_MAX = 0.14;
const WALL_NY = 0.2;
const WALL_BAIL_SPEED = 7;
export const BAIL_TIME = 1.4;
const SUBSTEP = 0.004;
const SPIN_POINTS = [100, 250, 450, 700];

const up = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3();
const rp: RoadPoint = { x: 0, z: 0, h: 0, dx: 0, dz: 0 };

export class Skater {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  grounded = true;
  readonly normal = new THREE.Vector3(0, 1, 0);
  readonly sample: TerrainSample = { h: 0, road: 1, lat: 0, s: 0, piece: 0, d: 0 };
  rail: Rail | null = null;
  railName = "";
  readonly railDir = new THREE.Vector3();
  balance = 0;
  grindTime = 0;
  airTime = 0;
  spin = 0;
  flipAngle = 0;
  flipTarget = 0;
  shoveAngle = 0;
  shoveTarget = 0;
  grabbing = false;
  charging = false;
  charge = 0;
  pushTimer = 0;
  bail = 0;
  landImpulse = 0;
  wallRiding = false;
  progress = 0;
  score = 0;
  comboScore = 0;
  comboCount = 0;
  readonly combo: string[] = [];
  steer = 0;
  crouchHeld = false;

  private balanceDrift = 0;
  private grindTick = 0;
  private wallTime = 0;
  private wallTick = 0;
  private groundedTime = 0;
  private stuckTime = 0;
  private railCooldownId = -1;
  private railCooldown = 0;
  private grabTime = 0;
  private takeoffPiece = 0;
  private takeoffY = 0;
  private maxAirY = 0;
  private readonly takeoff = new THREE.Vector3();
  private readonly trickCounts = new Map<string, number>();
  private readonly padCooldown = new Map<number, number>();
  private readonly missCooldown = new Map<number, number>();
  private readonly prev = new THREE.Vector3();
  private readonly n = new THREE.Vector3();

  get speed(): number {
    return this.vel.length();
  }
  get horizontalSpeed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }
  get inAir(): boolean {
    return !this.grounded && !this.rail;
  }
  get kmh(): number {
    return this.speed * 3.6;
  }

  /** Put the skater back on the road, a little behind the furthest point reached. */
  respawn(course: Course, atS?: number): void {
    const sq = atS ?? Math.max(course.startS, this.progress - 10);
    course.roadPoint(sq, rp);
    this.pos.set(rp.x, course.height(rp.x, rp.z), rp.z);
    this.vel.set(0, 0, 0);
    this.yaw = Math.atan2(rp.dx, rp.dz);
    this.grounded = true;
    this.normal.set(0, 1, 0);
    course.sample(this.pos.x, this.pos.z, this.sample);
    this.rail = null;
    this.railName = "";
    this.clearAir();
    this.bail = 0;
    this.charging = false;
    this.charge = 0;
    this.pushTimer = 0;
    this.landImpulse = 0;
    this.balance = 0;
    this.wallRiding = false;
    this.wallTime = 0;
    this.groundedTime = 0;
    this.stuckTime = 0;
    this.progress = Math.max(this.progress, sq);
    this.resetCombo();
  }

  resetRun(course: Course): void {
    this.progress = 0;
    this.score = 0;
    this.padCooldown.clear();
    this.missCooldown.clear();
    this.respawn(course, course.startS);
  }

  step(frameDt: number, inp: InputState, course: Course, ev: SimEvent[]): void {
    const dt = Math.min(frameDt, 0.05);
    this.steer = inp.steer;
    this.crouchHeld = inp.crouch;
    this.railCooldown -= dt;
    this.landImpulse = Math.max(0, this.landImpulse - dt * 3);
    for (const [k, v] of this.padCooldown) {
      if (v - dt <= 0) this.padCooldown.delete(k);
      else this.padCooldown.set(k, v - dt);
    }
    for (const [k, v] of this.missCooldown) {
      if (v - dt <= 0) this.missCooldown.delete(k);
      else this.missCooldown.set(k, v - dt);
    }
    if (inp.reset) {
      this.respawn(course);
      ev.push({ type: "respawn" });
    }

    const n = Math.max(1, Math.ceil(dt / SUBSTEP));
    const h = dt / n;

    if (this.bail > 0) {
      this.bail -= dt;
      this.charging = false;
      this.charge = 0;
      for (let i = 0; i < n; i++) this.stepBail(h, course);
      if (this.bail <= 0) {
        this.bail = 0;
        this.vel.set(0, 0, 0);
      }
      this.trackProgress(course);
      return;
    }

    if (this.inAir) {
      if (inp.kickflip) {
        this.flipTarget += TAU;
        this.addTrick("KICKFLIP", 100, ev);
        ev.push({ type: "sound", name: "swish" });
      }
      if (inp.heelflip) {
        this.flipTarget -= TAU;
        this.addTrick("HEELFLIP", 100, ev);
        ev.push({ type: "sound", name: "swish" });
      }
      if (inp.shove) {
        this.shoveTarget += Math.PI;
        this.addTrick("POP SHOVE-IT", 80, ev);
        ev.push({ type: "sound", name: "swish" });
      }
    }

    // Ollie: hold to crouch, release to pop.
    if (inp.jump && !this.inAir) {
      this.charging = true;
      this.charge = Math.min(this.charge + dt, CHARGE_MAX);
    } else if (this.charging) {
      this.charging = false;
      if (!this.inAir) this.pop(ev);
      this.charge = 0;
    }
    if (this.inAir) {
      this.charging = false;
      this.charge = 0;
    }

    for (let i = 0; i < n; i++) {
      if (this.bail > 0) break;
      if (this.rail) this.stepRail(h, inp, course, ev);
      else if (this.grounded) this.stepGround(h, inp, course, ev);
      else this.stepAir(h, inp, course, ev);
    }

    this.trackProgress(course);
    this.checkPads(course, ev);
    this.checkNearMisses(course, ev);

    // Fell off the world or wedged somewhere: back to the road.
    course.roadPoint(this.progress, rp);
    const stuck = this.grounded && this.speed < 0.4 && this.sample.road < 0.5 && this.bail <= 0;
    this.stuckTime = stuck ? this.stuckTime + dt : 0;
    if (this.pos.y < rp.h - 90 || this.stuckTime > 3) {
      this.respawn(course);
      ev.push({ type: "respawn" });
    }
  }

  // ---------------------------------------------------------------- states

  private stepGround(h: number, inp: InputState, course: Course, ev: SimEvent[]): void {
    const sp = this.vel.length();
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.yaw -= inp.steer * TURN_RATE * Math.min(1, hs / 2.5) * (1 / (1 + hs / 60)) * h;
    this.vel.y -= G * h;

    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    if (hs > 0.01) {
      const along = this.vel.x * fx + this.vel.z * fz;
      const sgn = along >= 0 ? 1 : -1;
      const grip = GRIP_LOW + (GRIP_HIGH - GRIP_LOW) * clamp(hs / 35, 0, 1);
      const k = 1 - Math.exp(-grip * h);
      this.vel.x += (fx * hs * sgn - this.vel.x) * k;
      this.vel.z += (fz * hs * sgn - this.vel.z) * k;
    }
    if (hs > 0.001) {
      const roll = this.sample.road > 0.5 ? ROLL_ROAD : ROLL_OFF;
      const drag = DRAG * (inp.crouch ? TUCK_DRAG : 1);
      const dec = (roll + drag * sp * sp) * h;
      const f = Math.max(0, 1 - dec / hs);
      this.vel.x *= f;
      this.vel.z *= f;
    }
    if (inp.push && !inp.brake && this.pushTimer <= 0 && hs < PUSH_MAX && !this.charging) {
      this.pushTimer = PUSH_TIME;
      ev.push({ type: "sound", name: "push" });
    }
    if (this.pushTimer > 0) {
      this.pushTimer -= h;
      if (this.pushTimer > PUSH_TIME - 0.32) {
        this.vel.x += fx * PUSH_ACC * h;
        this.vel.z += fz * PUSH_ACC * h;
      }
    }
    if (inp.brake && hs > 0.01) {
      const d = Math.min(hs, BRAKE * h);
      this.vel.x -= (this.vel.x / hs) * d;
      this.vel.z -= (this.vel.z / hs) * d;
    }
    if (inp.crouch && this.normal.y < 0.94 && sp > 0.5) {
      const boost = PUMP * (1 - this.normal.y) * h;
      this.vel.addScaledVector(this.vel, boost / sp);
    }
    const sp2 = this.vel.length();
    if (sp2 > MAX_SPEED) this.vel.multiplyScalar(MAX_SPEED / sp2);

    this.prev.copy(this.pos);
    this.pos.addScaledVector(this.vel, h);
    this.resolveContact(course, ev);
    this.resolveObstacles(course, ev);
    if (!this.grounded || this.bail > 0) return;

    // Wall rides and the bank-on-solid-ground rule.
    if (this.normal.y < 0.55 && this.speed > 6) {
      this.wallTime += h;
      this.groundedTime = 0;
      if (!this.wallRiding && this.wallTime > 0.12) {
        this.wallRiding = true;
        this.wallTick = 0;
        this.addTrick("WALL RIDE", 100, ev);
        ev.push({ type: "sound", name: "wall" });
      }
      if (this.wallRiding) {
        this.wallTick += h;
        if (this.wallTick >= 0.5) {
          this.wallTick -= 0.5;
          this.comboScore += 25;
        }
      }
    } else if (this.normal.y > 0.6) {
      this.wallRiding = false;
      this.wallTime = 0;
      this.groundedTime += h;
      if (this.groundedTime > 0.45 && this.comboCount > 0) this.bank(ev);
    }
  }

  private stepAir(h: number, inp: InputState, course: Course, ev: SimEvent[]): void {
    const dy = -inp.steer * AIR_SPIN * h;
    this.yaw += dy;
    this.spin += dy;
    this.vel.y -= G * h;
    const sp = this.vel.length();
    if (sp > 0.01) this.vel.multiplyScalar(Math.max(0, 1 - DRAG * 0.4 * sp * h));
    this.airTime += h;
    this.maxAirY = Math.max(this.maxAirY, this.pos.y);
    this.groundedTime = 0;
    this.wallRiding = false;
    this.wallTime = 0;

    if (inp.crouch) {
      this.grabTime += h;
      if (!this.grabbing && this.grabTime > 0.2) {
        this.grabbing = true;
        this.addTrick("INDY GRAB", 60, ev);
        ev.push({ type: "sound", name: "swish" });
      }
    } else if (this.grabbing) {
      this.grabbing = false;
      if (this.grabTime > 1.0) this.addTrick("LONG GRAB", 40, ev);
      this.grabTime = 0;
    } else {
      this.grabTime = 0;
    }
    this.advanceFlips(h);

    this.prev.copy(this.pos);
    this.pos.addScaledVector(this.vel, h);
    this.resolveContact(course, ev);
    if (this.inAir && this.bail <= 0) this.tryCatchRail(course, ev);
    this.resolveObstacles(course, ev);
  }

  private stepRail(h: number, inp: InputState, course: Course, ev: SimEvent[]): void {
    const rail = this.rail!;
    const difficulty = 1 + this.grindTime * 0.25;
    this.balanceDrift = clamp(this.balanceDrift + (Math.random() - 0.5) * 5 * h, -1, 1);
    this.balance += (this.balanceDrift * 0.75 * difficulty + inp.steer * 2.2) * h;
    if (Math.abs(this.balance) > 1) {
      this.startBail(ev);
      return;
    }
    let s = this.vel.dot(this.railDir);
    s -= G * this.railDir.y * h;
    s *= Math.max(0, 1 - 0.08 * h);
    if (Math.abs(s) < 1.5) s = (s < 0 ? -1 : 1) * 1.5;
    this.vel.copy(this.railDir).multiplyScalar(s);
    this.pos.addScaledVector(this.vel, h);

    const abx = rail.b.x - rail.a.x;
    const abz = rail.b.z - rail.a.z;
    const len2 = abx * abx + abz * abz;
    const t = ((this.pos.x - rail.a.x) * abx + (this.pos.z - rail.a.z) * abz) / len2;
    if (t < 0 || t > 1) {
      // Polyline rails: slide straight onto the next segment if one continues here.
      const end = t > 1 ? rail.b : rail.a;
      const next = course.rails.find(
        (r) =>
          r !== rail &&
          r.kind === rail.kind &&
          (r.a.distanceToSquared(end) < 0.01 || r.b.distanceToSquared(end) < 0.01),
      );
      if (next) {
        const forward = next.a.distanceToSquared(end) < 0.01;
        this.rail = next;
        this.railDir.subVectors(next.b, next.a).normalize();
        const speed = Math.abs(s);
        this.vel.copy(this.railDir).multiplyScalar(forward ? speed : -speed);
        this.pos.copy(end);
        return;
      }
      this.leaveRail();
      return;
    }
    this.pos.set(
      rail.a.x + abx * t,
      rail.a.y + (rail.b.y - rail.a.y) * t,
      rail.a.z + abz * t,
    );
    this.grindTime += h;
    this.grindTick += h;
    if (this.grindTick >= 0.5) {
      this.grindTick -= 0.5;
      this.comboScore += 15;
    }
    this.groundedTime = 0;
    this.advanceFlips(h);
  }

  private stepBail(h: number, course: Course): void {
    this.vel.y -= G * h;
    const f = Math.max(0, 1 - 3.5 * h);
    this.vel.x *= f;
    this.vel.z *= f;
    this.prev.copy(this.pos);
    this.pos.addScaledVector(this.vel, h);
    course.sample(this.pos.x, this.pos.z, this.sample);
    const hgt = this.sample.h;
    if (hgt - this.pos.y > STEP_MAX && this.prev.y >= hgt - STEP_MAX) {
      this.pos.copy(this.prev);
      this.vel.x *= -0.2;
      this.vel.z *= -0.2;
      return;
    }
    if (this.pos.y <= hgt) {
      this.pos.y = hgt;
      course.normal(this.pos.x, this.pos.z, this.n);
      const vn = this.vel.dot(this.n);
      if (vn < 0) this.vel.addScaledVector(this.n, -vn);
      this.grounded = true;
      this.normal.copy(this.n);
    }
  }

  // -------------------------------------------------------------- contacts

  private resolveContact(course: Course, ev: SimEvent[]): void {
    course.sample(this.pos.x, this.pos.z, this.sample);
    const hgt = this.sample.h;
    const pen = hgt - this.pos.y;
    course.normal(this.pos.x, this.pos.z, this.n);
    if (pen > STEP_MAX && this.n.y < WALL_NY) {
      // Sheer wall: back off and bounce.
      const hs = Math.hypot(this.vel.x, this.vel.z);
      this.pos.copy(this.prev);
      this.vel.x *= -0.15;
      this.vel.z *= -0.15;
      if (hs > WALL_BAIL_SPEED) this.startBail(ev);
      return;
    }
    if (this.grounded) {
      const vn = this.vel.dot(this.n);
      if (-pen > 0.02 && vn > 0.6) {
        this.leaveGround();
        return;
      }
      this.pos.y = hgt;
      if (vn < 0) this.vel.addScaledVector(this.n, -vn);
      this.normal.copy(this.n);
    } else if (pen >= 0) {
      this.land(course, ev);
    }
  }

  private land(course: Course, ev: SimEvent[]): void {
    const n = this.n;
    const vn = this.vel.dot(n);
    const impact = Math.max(0, -vn);
    this.pos.y = this.sample.h;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    let bail = false;
    const flipRem = Math.abs(this.flipTarget - this.flipAngle);
    const shoveRem = Math.abs(this.shoveTarget - this.shoveAngle);
    if (flipRem > 1.1 || shoveRem > 0.7) bail = true;
    else if (n.y < 0.15 && impact > 4) bail = true;
    else if (hs > 2 && this.airTime > 0.12) {
      const d = angleDiff(this.yaw, Math.atan2(this.vel.x, this.vel.z));
      const m = Math.abs(d) % Math.PI;
      if (Math.min(m, Math.PI - m) > 0.8) bail = true;
    }
    if (vn < 0) this.vel.addScaledVector(n, -vn);
    this.grounded = true;
    this.normal.copy(n);
    if (bail) {
      this.startBail(ev);
      return;
    }
    if (hs > 1) {
      const d = angleDiff(this.yaw, Math.atan2(this.vel.x, this.vel.z));
      if (Math.abs(d) > Math.PI / 2) this.yaw += Math.PI;
    }
    if (this.airTime > 0.12) {
      this.awardAir(course, ev);
      if (this.comboCount === 0 && this.airTime > 0.35) this.addTrick("OLLIE", 10, ev);
      ev.push({ type: "sound", name: "land" });
    }
    this.landImpulse = Math.min(1, impact / 9);
    this.groundedTime = 0;
    this.clearAir();
  }

  private tryCatchRail(course: Course, ev: SimEvent[]): void {
    if (this.vel.y > 0.5) return;
    for (const r of course.rails) {
      if (r.id === this.railCooldownId && this.railCooldown > 0) continue;
      const abx = r.b.x - r.a.x;
      const abz = r.b.z - r.a.z;
      const len2 = abx * abx + abz * abz;
      if (len2 < 1e-6) continue;
      const t = ((this.pos.x - r.a.x) * abx + (this.pos.z - r.a.z) * abz) / len2;
      if (t < 0 || t > 1) continue;
      const cx = r.a.x + abx * t;
      const cz = r.a.z + abz * t;
      if (Math.hypot(this.pos.x - cx, this.pos.z - cz) > RAIL_CATCH_R) continue;
      const ry = r.a.y + (r.b.y - r.a.y) * t;
      const dy = this.pos.y - ry;
      if (dy < -0.12 || dy > 0.45) continue;

      const flipRem = Math.abs(this.flipTarget - this.flipAngle);
      const shoveRem = Math.abs(this.shoveTarget - this.shoveAngle);
      if (flipRem > 1.1 || shoveRem > 0.7) {
        this.startBail(ev);
        return;
      }
      this.rail = r;
      this.pos.set(cx, ry, cz);
      this.railDir.subVectors(r.b, r.a).normalize();
      let s = this.vel.dot(this.railDir);
      if (Math.abs(s) < 1.5) {
        const f = tmpV.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        s = (f.dot(this.railDir) < 0 ? -1 : 1) * 1.5;
      }
      this.vel.copy(this.railDir).multiplyScalar(s);
      const fwdDot =
        Math.abs(Math.sin(this.yaw) * this.railDir.x + Math.cos(this.yaw) * this.railDir.z) /
        Math.max(1e-6, Math.hypot(this.railDir.x, this.railDir.z));
      const fiftyFifty = fwdDot > 0.6;
      this.railName = fiftyFifty ? "50-50 GRIND" : "BOARDSLIDE";
      this.balance = 0;
      this.balanceDrift = (Math.random() - 0.5) * 0.6;
      this.grindTime = 0;
      this.grindTick = 0;
      this.grounded = false;
      if (this.airTime > 0.12) this.awardAir(course, ev);
      this.addTrick(this.railName, fiftyFifty ? 50 : 70, ev);
      ev.push({ type: "sound", name: "grind" });
      this.clearAir();
      return;
    }
  }

  private resolveObstacles(course: Course, ev: SimEvent[]): void {
    for (const c of course.obstacles) {
      const dx = this.pos.x - c.x;
      const dz = this.pos.z - c.z;
      const d = Math.hypot(dx, dz);
      if (d >= c.r || d < 1e-6) continue;
      if (this.pos.y > course.height(c.x, c.z) + (c.kind === "rock" ? 1.6 : 3.5)) continue;
      const nx = dx / d;
      const nz = dz / d;
      this.pos.x = c.x + nx * c.r;
      this.pos.z = c.z + nz * c.r;
      const vn = this.vel.x * nx + this.vel.z * nz;
      if (vn < 0) {
        this.vel.x -= nx * vn;
        this.vel.z -= nz * vn;
        if (-vn > 5) this.startBail(ev);
      }
    }
  }

  private checkPads(course: Course, ev: SimEvent[]): void {
    if (this.bail > 0 || !this.grounded) return;
    for (const p of course.boosts) {
      if (this.padCooldown.has(p.id)) continue;
      if (Math.hypot(this.pos.x - p.x, this.pos.z - p.z) > 3.2 || Math.abs(this.pos.y - p.y) > 1.5)
        continue;
      this.padCooldown.set(p.id, 2.5);
      this.boost(8);
      ev.push({ type: "boost", label: "BOOST!" });
      ev.push({ type: "sound", name: "boost" });
    }
  }

  private checkNearMisses(course: Course, ev: SimEvent[]): void {
    if (this.bail > 0 || this.speed < 14) return;
    for (const o of course.obstacles) {
      if (this.missCooldown.has(o.id)) continue;
      const gap = Math.hypot(this.pos.x - o.x, this.pos.z - o.z) - o.r;
      if (gap < 0.05 || gap > 1.1) continue;
      if (Math.abs(this.pos.y - course.height(o.x, o.z)) > 2) continue;
      this.missCooldown.set(o.id, 4);
      this.addTrick("NEAR MISS", 40, ev);
    }
  }

  // ------------------------------------------------------------ transitions

  private boost(v: number): void {
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    this.vel.x += fx * v;
    this.vel.z += fz * v;
    const sp = this.vel.length();
    if (sp > MAX_SPEED) this.vel.multiplyScalar(MAX_SPEED / sp);
  }

  private pop(ev: SimEvent[]): void {
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const v = POP_MIN + (POP_MAX - POP_MIN) * (this.charge / CHARGE_MAX) + 0.04 * hs;
    if (this.rail) {
      this.vel.y += v * 0.9;
      this.leaveRail();
    } else {
      tmpV.copy(this.normal).addScaledVector(up, 0.6).normalize();
      this.vel.addScaledVector(tmpV, v);
      this.leaveGround();
      this.pos.y += 0.02;
    }
    this.pushTimer = 0;
    ev.push({ type: "sound", name: "pop" });
  }

  private leaveGround(): void {
    this.grounded = false;
    this.takeoff.copy(this.pos);
    this.takeoffPiece = this.sample.piece;
    this.takeoffY = this.pos.y;
    this.maxAirY = this.pos.y;
    this.airTime = 0;
    this.spin = 0;
    this.grabTime = 0;
    this.grabbing = false;
    this.groundedTime = 0;
    this.wallRiding = false;
    this.wallTime = 0;
  }

  private leaveRail(): void {
    if (this.rail) {
      this.railCooldownId = this.rail.id;
      this.railCooldown = 0.4;
    }
    this.rail = null;
    this.railName = "";
    this.grounded = false;
    this.takeoff.copy(this.pos);
    this.takeoffPiece = this.sample.piece;
    this.takeoffY = this.pos.y;
    this.maxAirY = this.pos.y;
    this.airTime = 0;
    this.spin = 0;
    this.grabTime = 0;
    this.grabbing = false;
  }

  private clearAir(): void {
    this.airTime = 0;
    this.spin = 0;
    this.grabTime = 0;
    this.grabbing = false;
    this.flipAngle = 0;
    this.flipTarget = 0;
    this.shoveAngle = 0;
    this.shoveTarget = 0;
  }

  private advanceFlips(h: number): void {
    this.flipAngle = moveToward(this.flipAngle, this.flipTarget, (TAU / FLIP_TIME) * h);
    this.shoveAngle = moveToward(this.shoveAngle, this.shoveTarget, (Math.PI / SHOVE_TIME) * h);
  }

  private startBail(ev: SimEvent[]): void {
    if (this.bail > 0) return;
    this.bail = BAIL_TIME;
    this.rail = null;
    this.railName = "";
    this.charging = false;
    this.charge = 0;
    this.pushTimer = 0;
    this.wallRiding = false;
    this.wallTime = 0;
    this.clearAir();
    this.resetCombo();
    ev.push({ type: "bail" });
    ev.push({ type: "sound", name: "bail" });
  }

  private trackProgress(course: Course): void {
    course.sample(this.pos.x, this.pos.z, this.sample);
    // Only count progress while actually near the road, to keep respawns sane.
    if (this.sample.d < 12 && this.sample.s > this.progress) this.progress = this.sample.s;
  }

  // ---------------------------------------------------------------- scoring

  private awardAir(course: Course, ev: SimEvent[]): void {
    const turns = Math.round(Math.abs(this.spin) / Math.PI);
    if (turns >= 1) {
      const pts = SPIN_POINTS[Math.min(turns, 4) - 1] + Math.max(0, turns - 4) * 300;
      this.addTrick(`${turns * 180} SPIN`, pts, ev);
    }
    if (this.grabbing && this.grabTime > 1.0) this.addTrick("LONG GRAB", 40, ev);
    if (this.airTime > 2.2) this.addTrick("MEGA AIR", 400, ev);
    else if (this.airTime > 1.3) this.addTrick("BIG AIR", 120, ev);
    if (this.maxAirY - this.takeoffY > 6) this.addTrick("SKY HIGH", 150, ev);
    if (this.takeoffY - this.pos.y > 8 && this.airTime > 0.6) this.addTrick("CLIFF DROP", 200, ev);
    const skipped = this.sample.piece - this.takeoffPiece;
    if (skipped >= 2 && this.sample.d < 30) {
      const levels = Math.floor(skipped / 2);
      this.addTrick(levels > 1 ? `MEGA SHORTCUT ×${levels}` : "SHORTCUT", 300 * levels, ev);
    }
    void course;
  }

  private addTrick(name: string, base: number, ev: SimEvent[]): void {
    const c = this.trickCounts.get(name) ?? 0;
    const pts = Math.max(10, Math.round((base * Math.pow(0.5, c)) / 10) * 10);
    this.trickCounts.set(name, c + 1);
    this.comboScore += pts;
    this.comboCount += 1;
    this.combo.push(name);
    ev.push({ type: "trick", name, points: pts });
  }

  private bank(ev: SimEvent[]): void {
    if (this.comboCount === 0) return;
    const total = this.comboScore * this.comboCount;
    this.score += total;
    ev.push({ type: "land", combo: this.comboScore, count: this.comboCount, total });
    ev.push({ type: "sound", name: total >= 600 ? "bigbank" : "bank" });
    if (total >= 200) {
      this.boost(3);
      ev.push({ type: "boost", label: "TRICK BOOST" });
    }
    this.resetCombo();
  }

  private resetCombo(): void {
    this.comboScore = 0;
    this.comboCount = 0;
    this.combo.length = 0;
    this.trickCounts.clear();
    this.groundedTime = 0;
  }
}
