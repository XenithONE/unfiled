import * as THREE from "three";
import { ROAD_HALF_WIDTH, SURF, type Course, type Rail, type RoadPoint, type TerrainSample } from "./course";
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
  | "wall"
  | "splash";
export type SimEvent =
  | { type: "trick"; name: string; points: number }
  | { type: "land"; combo: number; count: number; total: number }
  | { type: "bail" }
  | { type: "bump" }
  | { type: "sketchy" }
  | { type: "boost"; label: string }
  | { type: "trap"; kmh: number }
  | { type: "respawn" }
  | { type: "sound"; name: SoundName };

export const G = 15;
const MAX_SPEED = 46;
const PUSH_ACC = 13;
const PUSH_MAX = 15;
export const PUSH_TIME = 0.6;
const BRAKE = 12;
const DRIFT_BRAKE = 3;
const ROLL = { road: 0.18, dirt: 0.5, grass: 1.3, berm: 0.25, skim: 0.3, sink: 6 };
const DRAG = 0.00125;
const TUCK_DRAG = 0.5;
const TUCK_ACC = 0.8;
const TURN_RATE = 3.0;
const AIR_SPIN = 5.5;
const ALIGN_RATE = 4.5;
const ALIGN_RATE_LATE = 9;
const AIR_STEER = 0.55;
const GRIP_LOW = 9;
const GRIP_HIGH = 5.5;
const GRIP_DRIFT = 2.2;
const PUMP = 12;
const POP_MIN = 6.5;
const POP_MAX = 11.5;
export const CHARGE_MAX = 0.26;
const FLIP_TIME = 0.34;
const SHOVE_TIME = 0.3;
const RAIL_CATCH_R = 0.75;
const STEP_MAX = 0.14;
const WALL_NY = 0.2;
export const BAIL_TIME = 0.8;
const SUBSTEP = 0.004;
const SPIN_POINTS = [100, 250, 450, 700];

const up = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3();
const rp: RoadPoint = { x: 0, z: 0, h: 0, dx: 0, dz: 0 };
const w = ROAD_HALF_WIDTH;

export class Skater {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  grounded = true;
  readonly normal = new THREE.Vector3(0, 1, 0);
  readonly sample: TerrainSample = { h: 0, road: 1, surface: SURF.road, lat: 0, s: 0, t: 0, piece: 0, d: 0, bump: 0 };
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
  drifting = false;
  progress = 0;
  score = 0;
  comboScore = 0;
  comboCount = 0;
  readonly combo: string[] = [];
  /** filtered steer for animation and camera */
  steer = 0;
  crouchHeld = false;
  wobble = 0;

  private steerF = 0;
  private driftTime = 0;
  private balanceDrift = 0;
  private grindTick = 0;
  private grindStartS = 0;
  private tunnelDone = false;
  private wallTime = 0;
  private wallTick = 0;
  private groundedTime = 0;
  private stuckTime = 0;
  private railCooldownId = -1;
  private railCooldown = 0;
  private grabTime = 0;
  private takeoffPiece = 0;
  private takeoffT = 0;
  private takeoffLat = 0;
  private takeoffTag = "";
  private takeoffY = 0;
  private maxAirY = 0;
  private bailSpeed = 0;
  private padChain = 0;
  private padTimer = 0;
  private gateCount = 0;
  private gateSlow = false;
  private lastS = 0;
  private trapDone = false;
  private bowlTimer = 0;
  private skimTimer = 0;
  private rockHopDone = false;
  private readonly gatesPassed = new Set<number>();
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

  /** Put the skater back on the road, a little behind the furthest point reached, rolling. */
  respawn(course: Course, atS?: number): void {
    const sq = atS ?? Math.max(course.startS, this.progress - 10);
    course.roadPoint(sq, rp);
    this.pos.set(rp.x, course.height(rp.x, rp.z), rp.z);
    this.yaw = Math.atan2(rp.dx, rp.dz);
    const v0 = atS === undefined ? 8 : 0;
    this.vel.set(rp.dx * v0, 0, rp.dz * v0);
    this.grounded = true;
    this.normal.set(0, 1, 0);
    course.sample(this.pos.x, this.pos.z, this.sample);
    this.lastS = this.sample.s;
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
    this.drifting = false;
    this.driftTime = 0;
    this.wobble = 0;
    this.progress = Math.max(this.progress, sq);
    this.resetCombo();
  }

  resetRun(course: Course): void {
    this.progress = 0;
    this.score = 0;
    this.padCooldown.clear();
    this.missCooldown.clear();
    this.gatesPassed.clear();
    this.gateCount = 0;
    this.gateSlow = false;
    this.trapDone = false;
    this.rockHopDone = false;
    this.padChain = 0;
    this.padTimer = 0;
    this.bowlTimer = 0;
    this.skimTimer = 0;
    this.respawn(course, course.startS);
  }

  step(frameDt: number, inp: InputState, course: Course, ev: SimEvent[]): void {
    const dt = Math.min(frameDt, 0.05);
    this.crouchHeld = inp.crouch;
    this.steerF =
      Math.abs(inp.steer) > Math.abs(this.steerF)
        ? moveToward(this.steerF, inp.steer, dt / 0.14)
        : moveToward(this.steerF, inp.steer, dt / 0.07);
    this.steer = this.steerF;
    this.railCooldown -= dt;
    this.landImpulse = Math.max(0, this.landImpulse - dt * 3);
    this.wobble = Math.max(0, this.wobble - dt * 2);
    this.padTimer = Math.max(0, this.padTimer - dt);
    this.bowlTimer = Math.max(0, this.bowlTimer - dt);
    this.skimTimer = Math.max(0, this.skimTimer - dt);
    if (this.padTimer <= 0) this.padChain = 0;
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
        const v = Math.max(4, 0.35 * this.bailSpeed);
        if (this.sample.road > 0.5) {
          course.roadPoint(this.sample.s, rp);
          const forward = rp.dx * Math.sin(this.yaw) + rp.dz * Math.cos(this.yaw) >= 0;
          this.yaw = Math.atan2(forward ? rp.dx : -rp.dx, forward ? rp.dz : -rp.dz);
        }
        this.vel.set(Math.sin(this.yaw) * v, 0, Math.cos(this.yaw) * v);
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
    this.checkGates(course, ev);
    this.checkLandmarks(course, ev);
    this.lastS = this.sample.s;

    // Fell off the world or wedged somewhere: back to the road.
    course.roadPoint(this.progress, rp);
    const sunk = this.sample.surface === SURF.water && this.speed < 6;
    const stuck = this.grounded && (this.speed < 0.4 || sunk) && this.sample.road < 0.5 && this.bail <= 0;
    this.stuckTime = stuck ? this.stuckTime + dt : 0;
    if (this.pos.y < rp.h - 90 || this.stuckTime > (sunk ? 0.8 : 1.5)) {
      if (sunk) ev.push({ type: "sound", name: "splash" });
      this.respawn(course);
      ev.push({ type: "respawn" });
    }
  }

  // ---------------------------------------------------------------- states

  private rolling(): number {
    const sf = this.sample.surface;
    if (sf === SURF.road || sf === SURF.torn) return ROLL.road;
    if (sf === SURF.dirt) return ROLL.dirt;
    if (sf === SURF.berm) return ROLL.berm;
    if (sf === SURF.water) return this.speed > 12 ? ROLL.skim : ROLL.sink;
    return ROLL.grass;
  }

  private stepGround(h: number, inp: InputState, course: Course, ev: SimEvent[]): void {
    const sp = this.vel.length();
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const onRoad = this.sample.road > 0.5;
    const wasDrifting = this.drifting;
    this.drifting = inp.brake && Math.abs(this.steerF) > 0.5 && hs > 9 && onRoad;
    if (this.drifting) this.driftTime += h;
    else if (wasDrifting) {
      if (this.driftTime > 0.45) {
        this.boost(clamp(this.driftTime * 6, 2, 7));
        ev.push({ type: "boost", label: "DRIFT BOOST" });
        ev.push({ type: "sound", name: "boost" });
        if (this.driftTime > 0.6) this.addTrick("POWERSLIDE", 60, ev);
      }
      this.driftTime = 0;
    }
    const wobbleTurn = 1 - 0.7 * Math.min(1, this.wobble);
    const yawRate = TURN_RATE * (this.drifting ? 1.8 : 1) * wobbleTurn * Math.min(1, hs / 2.5) * (1 / (1 + hs / 140));
    this.yaw -= this.steerF * yawRate * h;
    this.vel.y -= G * h;

    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    if (hs > 0.01) {
      const along = this.vel.x * fx + this.vel.z * fz;
      const sgn = along >= 0 ? 1 : -1;
      const grip = this.drifting ? GRIP_DRIFT : GRIP_LOW + (GRIP_HIGH - GRIP_LOW) * clamp(hs / 35, 0, 1);
      const k = 1 - Math.exp(-grip * h);
      this.vel.x += (fx * hs * sgn - this.vel.x) * k;
      this.vel.z += (fz * hs * sgn - this.vel.z) * k;
    }
    if (hs > 0.001) {
      const drag = DRAG * (inp.crouch ? TUCK_DRAG : 1);
      const dec = (this.rolling() + drag * sp * sp) * h;
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
      const d = Math.min(hs, (this.drifting ? DRIFT_BRAKE : BRAKE) * h);
      this.vel.x -= (this.vel.x / hs) * d;
      this.vel.z -= (this.vel.z / hs) * d;
    }
    if (inp.crouch && sp > 0.5) {
      if (this.normal.y < 0.94) {
        const boost = PUMP * (1 - this.normal.y) * h;
        this.vel.addScaledVector(this.vel, boost / sp);
      }
      if (onRoad && hs > 8) {
        this.vel.x += fx * TUCK_ACC * h;
        this.vel.z += fz * TUCK_ACC * h;
      }
    }
    const sp2 = this.vel.length();
    if (sp2 > MAX_SPEED) this.vel.multiplyScalar(MAX_SPEED / sp2);

    this.prev.copy(this.pos);
    this.pos.addScaledVector(this.vel, h);
    this.resolveContact(course, ev);
    this.resolveObstacles(course, ev);
    if (!this.grounded || this.bail > 0) return;

    // Wall / berm rides and the bank-on-solid-ground rule.
    if (this.normal.y < 0.55 && this.speed > 6) {
      this.wallTime += h;
      this.groundedTime = 0;
      if (!this.wallRiding && this.wallTime > 0.12) {
        this.wallRiding = true;
        this.wallTick = 0;
        const arc = course.pieces[this.sample.piece].kind === "arc";
        this.addTrick(arc ? "BERM RIDE" : "WALL RIDE", 100, ev);
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
      if (this.groundedTime > 0.7 && this.comboCount > 0) this.bank(ev);
    }

    // Water: skim it fast, sink slow.
    if (this.sample.surface === SURF.water && this.speed > 15 && this.skimTimer <= 0) {
      this.skimTimer = 6;
      this.addTrick("WATER SKIM", 150, ev);
      ev.push({ type: "sound", name: "splash" });
    }
    // Island bowl cut-through
    const piece = course.pieces[this.sample.piece];
    if (piece.kind === "arc" && piece.bowlIsland && this.sample.surface === SURF.dirt && this.speed > 15) {
      if (this.bowlTimer <= 0) this.bowlTimer = 4;
    } else if (this.bowlTimer > 0 && onRoad && this.sample.piece >= piece.index) {
      this.bowlTimer = 0;
      this.addTrick("BOWL CARVE", 120, ev);
    }
  }

  private stepAir(h: number, inp: InputState, course: Course, ev: SimEvent[]): void {
    this.drifting = false;
    this.driftTime = 0;
    const dy = -inp.steer * AIR_SPIN * h;
    this.yaw += dy;
    this.spin += dy;
    // time to the ground under the current position
    const gap = Math.max(0, this.pos.y - this.sample.h);
    const tl = (this.vel.y + Math.sqrt(this.vel.y * this.vel.y + 2 * G * gap)) / G;
    if (Math.abs(inp.steer) < 0.1 && this.airTime > 0.15) {
      // Auto-align: drift the board toward the travel direction (or its reverse), faster near the ground.
      if (Math.hypot(this.vel.x, this.vel.z) > 1) {
        let d = angleDiff(this.yaw, Math.atan2(this.vel.x, this.vel.z));
        if (Math.abs(d) > Math.PI / 2) d -= Math.sign(d) * Math.PI;
        const rate = tl < 0.35 ? ALIGN_RATE_LATE : ALIGN_RATE;
        this.yaw += clamp(d, -rate * h, rate * h);
      }
    } else if (Math.abs(inp.steer) >= 0.1) {
      // Air control: bend the flight path a little so landings can be aimed.
      const a = -inp.steer * AIR_STEER * h;
      const vx = this.vel.x;
      const vz = this.vel.z;
      this.vel.x = vx * Math.cos(a) + vz * Math.sin(a);
      this.vel.z = -vx * Math.sin(a) + vz * Math.cos(a);
    }
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
    // Late flips finish faster near the ground.
    this.advanceFlips(h * (1 + 2 * clamp((0.3 - tl) / 0.3, 0, 1)));

    // Rock hop: flying over the rolling boulder.
    const b = course.boulder;
    if (b.active && !this.rockHopDone && Math.hypot(this.pos.x - b.x, this.pos.z - b.z) < b.r + 1.2) {
      this.rockHopDone = true;
      this.addTrick("ROCK HOP", 120, ev);
    }

    this.prev.copy(this.pos);
    this.pos.addScaledVector(this.vel, h);
    this.resolveContact(course, ev);
    if (this.inAir && this.bail <= 0) this.tryCatchRail(course, ev);
    this.resolveObstacles(course, ev);
  }

  private stepRail(h: number, inp: InputState, course: Course, ev: SimEvent[]): void {
    const rail = this.rail!;
    this.drifting = false;
    if (rail.kind !== "wire") {
      const difficulty = 1 + this.grindTime * 0.08;
      this.balanceDrift = clamp(this.balanceDrift + (Math.random() - 0.5) * 3 * h, -1, 1);
      this.balance += (this.balanceDrift * 0.35 * difficulty + inp.steer * 2.6) * h;
      if (Math.abs(inp.steer) < 0.1) this.balance -= this.balance * 1.2 * h;
      if (Math.abs(this.balance) > 1) {
        // Lost it: slip off sideways, keep the points.
        this.vel.y += 1.5;
        const side = Math.sign(this.balance);
        this.vel.x += -this.railDir.z * side * 1.5;
        this.vel.z += this.railDir.x * side * 1.5;
        this.leaveRail();
        ev.push({ type: "sound", name: "pop" });
        return;
      }
    }
    let s = this.vel.dot(this.railDir);
    s -= G * this.railDir.y * h;
    s *= Math.max(0, 1 - 0.08 * h);
    if (Math.abs(s) < 3) s = (s < 0 ? -1 : 1) * 3;
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
    this.pos.set(rail.a.x + abx * t, rail.a.y + (rail.b.y - rail.a.y) * t, rail.a.z + abz * t);
    this.grindTime += h;
    this.grindTick += h;
    if (this.grindTick >= 0.5) {
      this.grindTick -= 0.5;
      this.comboScore += rail.kind === "wire" ? 40 : rail.kind === "coping" ? 20 : 15;
    }
    this.groundedTime = 0;
    this.advanceFlips(h);
    // Tunnel pipe: a grind that carries through the pencil tunnel.
    if (rail.kind === "pipe" && !this.tunnelDone) {
      const tunnel = course.landmarks.find((l) => l.kind === "tunnel");
      course.sample(this.pos.x, this.pos.z, this.sample);
      if (tunnel && this.grindStartS < tunnel.s - 15 && this.sample.s > tunnel.s + 15) {
        this.tunnelDone = true;
        this.addTrick("TUNNEL PIPE", 150, ev);
      }
    }
  }

  private stepBail(h: number, course: Course): void {
    this.vel.y -= G * h;
    const f = Math.max(0, 1 - 1.5 * h);
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
      // Sheer wall: back off and slide along it. Never a bail.
      this.pos.copy(this.prev);
      const nl = Math.hypot(this.n.x, this.n.z);
      if (nl > 1e-6) {
        const nx = this.n.x / nl;
        const nz = this.n.z / nl;
        const vn = this.vel.x * nx + this.vel.z * nz;
        if (vn < 0) {
          this.vel.x -= nx * vn;
          this.vel.z -= nz * vn;
          if (-vn > 6) {
            this.wobble = 0.5;
            ev.push({ type: "bump" });
          }
        }
      }
      this.vel.x *= 0.9;
      this.vel.z *= 0.9;
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
    const hs = Math.hypot(this.vel.x, this.vel.z);
    // Edge catch: landing just past the uphill road edge pulls you back onto the asphalt.
    if (this.sample.road < 0.5 && this.sample.lat > 0 && this.sample.d < w + 1.5 && hs > 8) {
      const p = course.railAt(this.sample.s, w - 0.3, 0);
      this.pos.x = p.x;
      this.pos.z = p.z;
      course.sample(this.pos.x, this.pos.z, this.sample);
      course.normal(this.pos.x, this.pos.z, this.n);
    }
    const n = this.n;
    const vn = this.vel.dot(n);
    const impact = Math.max(0, -vn);
    this.pos.y = this.sample.h;
    // Flips always catch: snap whatever rotation is left.
    this.flipAngle = this.flipTarget;
    this.shoveAngle = this.shoveTarget;
    let sketchy = false;
    if (hs > 6 && this.airTime > 0.12) {
      const d = angleDiff(this.yaw, Math.atan2(this.vel.x, this.vel.z));
      const m = Math.abs(d) % Math.PI;
      if (Math.min(m, Math.PI - m) > 1.15) sketchy = true;
    }
    if (vn < 0) this.vel.addScaledVector(n, -vn);
    this.grounded = true;
    this.normal.copy(n);
    if (hs > 1) {
      const velDir = Math.atan2(this.vel.x, this.vel.z);
      const k = Math.round(angleDiff(velDir, this.yaw) / Math.PI);
      this.yaw = velDir + k * Math.PI;
    }
    if (sketchy) {
      this.vel.x *= 0.8;
      this.vel.z *= 0.8;
      this.wobble = 0.6;
      ev.push({ type: "sketchy" });
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
      const catchR = r.kind === "wire" ? 1.2 : RAIL_CATCH_R;
      if (Math.hypot(this.pos.x - cx, this.pos.z - cz) > catchR) continue;
      const ry = r.a.y + (r.b.y - r.a.y) * t;
      const dy = this.pos.y - ry;
      if (dy < -0.3 || dy > (r.kind === "wire" ? 1.4 : 0.9)) continue;

      this.flipAngle = this.flipTarget;
      this.shoveAngle = this.shoveTarget;
      this.rail = r;
      this.pos.set(cx, ry, cz);
      this.railDir.subVectors(r.b, r.a).normalize();
      let s = this.vel.dot(this.railDir);
      if (Math.abs(s) < 3) {
        const f = tmpV.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        s = (f.dot(this.railDir) < 0 ? -1 : 1) * 3;
      }
      this.vel.copy(this.railDir).multiplyScalar(s);
      const fwdDot =
        Math.abs(Math.sin(this.yaw) * this.railDir.x + Math.cos(this.yaw) * this.railDir.z) /
        Math.max(1e-6, Math.hypot(this.railDir.x, this.railDir.z));
      const fiftyFifty = fwdDot > 0.6;
      let pts = fiftyFifty ? 50 : 70;
      this.railName = fiftyFifty ? "50-50 GRIND" : "BOARDSLIDE";
      if (r.kind === "wire") {
        this.railName = "ZIPLINE";
        pts = 300;
      } else if (r.kind === "coping") {
        this.railName = "COPING GRIND";
        pts = 90;
      }
      this.balance = 0;
      this.balanceDrift = (Math.random() - 0.5) * 0.6;
      this.grindTime = 0;
      this.grindTick = 0;
      this.grindStartS = this.sample.s;
      this.tunnelDone = false;
      this.grounded = false;
      if (this.airTime > 0.12) this.awardAir(course, ev);
      this.addTrick(this.railName, pts, ev);
      ev.push({ type: "sound", name: "grind" });
      this.clearAir();
      return;
    }
  }

  private resolveObstacles(course: Course, ev: SimEvent[]): void {
    for (const c of course.obstacles) {
      if (!c.active) continue;
      const dx = this.pos.x - c.x;
      const dz = this.pos.z - c.z;
      const d = Math.hypot(dx, dz);
      if (d >= c.r || d < 1e-6) continue;
      const top = c.kind === "rock" ? 1.6 : c.kind === "boulder" ? 2.4 : c.kind === "post" ? 5 : 3.5;
      if (this.pos.y > course.height(c.x, c.z) + top) continue;
      const nx = dx / d;
      const nz = dz / d;
      this.pos.x = c.x + nx * c.r;
      this.pos.z = c.z + nz * c.r;
      const vn = this.vel.x * nx + this.vel.z * nz;
      if (vn < 0) {
        this.vel.x -= nx * vn;
        this.vel.z -= nz * vn;
        if (-vn > 20 && c.kind !== "post") {
          this.startBail(ev);
        } else if (-vn > 4) {
          // Bonk: bounce off and wobble instead of falling.
          this.vel.x -= nx * vn * 0.6;
          this.vel.z -= nz * vn * 0.6;
          this.vel.x *= 0.7;
          this.vel.z *= 0.7;
          this.wobble = 0.6;
          ev.push({ type: "bump" });
          ev.push({ type: "sound", name: "land" });
        }
      }
    }
  }

  private checkPads(course: Course, ev: SimEvent[]): void {
    if (this.bail > 0) return;
    for (const p of course.boosts) {
      if (this.padCooldown.has(p.id)) continue;
      if (Math.hypot(this.pos.x - p.x, this.pos.z - p.z) > 3.6 || Math.abs(this.pos.y - p.y) > 1.8) continue;
      this.padCooldown.set(p.id, 2.5);
      this.padChain = this.padTimer > 0 ? this.padChain + 1 : 1;
      this.padTimer = 3;
      this.boost(9 + 2 * (this.padChain - 1));
      ev.push({ type: "boost", label: this.padChain > 1 ? `CHAIN ×${this.padChain}` : "BOOST!" });
      ev.push({ type: "sound", name: "boost" });
    }
  }

  private checkNearMisses(course: Course, ev: SimEvent[]): void {
    if (this.bail > 0 || this.speed < 14) return;
    for (const o of course.obstacles) {
      if (!o.active || o.kind === "post" || this.missCooldown.has(o.id)) continue;
      const gap = Math.hypot(this.pos.x - o.x, this.pos.z - o.z) - o.r;
      if (gap < 0.05 || gap > 1.1) continue;
      if (Math.abs(this.pos.y - course.height(o.x, o.z)) > 2) continue;
      this.missCooldown.set(o.id, 4);
      this.addTrick(o.kind === "boulder" ? "DODGE" : "NEAR MISS", o.kind === "boulder" ? 80 : 40, ev);
    }
  }

  private checkGates(course: Course, ev: SimEvent[]): void {
    if (this.bail > 0 || this.sample.d > w + 1) return;
    for (const g of course.gates) {
      if (this.gatesPassed.has(g.id)) continue;
      if (this.lastS < g.s && this.sample.s >= g.s) {
        this.gatesPassed.add(g.id);
        if (this.speed >= g.minSpeed) {
          this.gateCount += 1;
          this.addTrick(`TORII ×${this.gateCount}`, 20 * this.gateCount, ev);
          if (this.gateCount === course.gates.length && !this.gateSlow) this.addTrick("RUSH!", 200, ev);
        } else {
          this.gateSlow = true;
        }
      }
    }
  }

  private checkLandmarks(course: Course, ev: SimEvent[]): void {
    if (this.trapDone) return;
    const trap = course.landmarks.find((l) => l.kind === "trap");
    if (trap && this.lastS < trap.s && this.sample.s >= trap.s && this.sample.d < w + 2) {
      this.trapDone = true;
      ev.push({ type: "trap", kmh: this.kmh });
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
    let v = POP_MIN + (POP_MAX - POP_MIN) * (this.charge / CHARGE_MAX) + 0.04 * hs;
    if (this.rail) {
      this.vel.y += v * 0.9;
      this.leaveRail();
    } else {
      if (this.normal.y < 0.975 && this.sample.road > 0.5 && this.sample.bump > 0.05) {
        v *= 1.3;
        this.addTrick("LIP POP", 30, ev);
      }
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
    this.takeoffT = this.sample.t;
    this.takeoffLat = this.sample.lat;
    this.takeoffTag = this.sample.bump > 0.05 ? "bump" : "";
    this.takeoffY = this.pos.y;
    this.maxAirY = this.pos.y;
    this.airTime = 0;
    this.spin = 0;
    this.grabTime = 0;
    this.grabbing = false;
    this.groundedTime = 0;
    this.wallRiding = false;
    this.wallTime = 0;
    this.drifting = false;
    this.driftTime = 0;
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
    this.takeoffT = this.sample.t;
    this.takeoffLat = this.sample.lat;
    this.takeoffTag = "";
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
    this.bailSpeed = this.horizontalSpeed;
    this.rail = null;
    this.railName = "";
    this.charging = false;
    this.charge = 0;
    this.pushTimer = 0;
    this.wallRiding = false;
    this.wallTime = 0;
    this.drifting = false;
    this.driftTime = 0;
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
    const landedPiece = this.sample.piece;
    const skipped = landedPiece - this.takeoffPiece;
    const onRoad = this.sample.road > 0.5;
    if (skipped >= 2 && this.sample.d < 30) {
      const levels = Math.floor(skipped / 2);
      if (levels === 1 && onRoad && this.takeoffTag === "bump" && this.takeoffT > 100) {
        this.addTrick("HAIRPIN HOP", 500, ev);
      } else {
        this.addTrick(levels > 1 ? `MEGA SHORTCUT ×${levels}` : "SHORTCUT", 300 * levels, ev);
      }
    }
    if (skipped === 0 && onRoad) {
      // same straight: gaps, logs and half-pipe transfers
      for (const b of course.bumps) {
        if (b.piece !== this.takeoffPiece) continue;
        if (b.tag === "gap" && this.takeoffT < b.t0 && this.sample.t > b.t1 - 2) this.addTrick("GAP", 250, ev);
        if (b.tag === "log" && this.takeoffT < b.t0 && this.sample.t > b.t1) this.addTrick("LOG HOP", 60, ev);
        if (
          b.tag === "pipe" &&
          this.airTime > 0.5 &&
          this.takeoffT > b.t0 &&
          this.takeoffT < b.t1 &&
          Math.abs(this.takeoffLat) > 3 &&
          Math.abs(this.sample.lat) > 3 &&
          Math.sign(this.sample.lat) !== Math.sign(this.takeoffLat)
        )
          this.addTrick("TRANSFER", 150, ev);
      }
    }
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
      this.boost(clamp(total / 250, 3, 7));
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
