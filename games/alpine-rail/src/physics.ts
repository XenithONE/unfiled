// Longitudinal train dynamics for one electric locomotive + four panorama
// coaches on metre gauge. Forces in newtons, speed in m/s. Pure; the node test
// drives it directly.

import type { Track } from "./track";
import { clamp } from "./noise";

export const POWER_NOTCHES = 5;
export const BRAKE_NOTCHES = 7;
export const EB_NOTCH = -(BRAKE_NOTCHES + 1);

export const TRAIN = {
  locoLength: 15.5,
  coachLength: 18.2,
  coaches: 4,
  gap: 0.9,
  massT: 62 + 4 * 21.5 + 14, // loco + coaches + passengers
  maxTractionN: 200_000,
  powerW: 2_400_000,
  rotatingFactor: 1.08,
  serviceDecel: 0.86, // m/s² at B7 on the level
  emergencyDecel: 1.2,
};

export const TRAIN_LENGTH = TRAIN.locoLength + TRAIN.coaches * (TRAIN.coachLength + TRAIN.gap);

export interface TrainState {
  s: number; // front of the train, metres along the line
  v: number; // m/s, negative when rolling back
  a: number;
  notch: number; // EB_NOTCH..-1 brake, 0 neutral, 1..5 power
  traction: number; // 0..1 motor current actually flowing
  brake: number; // 0..~1.4 brake cylinder fill (1 = B7)
  tractionN: number;
  brakeN: number;
  resistN: number;
  gradeN: number;
  jerk: number;
  energyKWh: number;
  atpWarn: boolean;
  atpTrip: boolean; // penalty brake latched until stand-still
  wheelSlip: number;
  odometer: number;
}

export function newTrain(s: number): TrainState {
  return {
    s,
    v: 0,
    a: 0,
    notch: -4,
    traction: 0,
    brake: 4 / BRAKE_NOTCHES,
    tractionN: 0,
    brakeN: 0,
    resistN: 0,
    gradeN: 0,
    jerk: 0,
    energyKWh: 0,
    atpWarn: false,
    atpTrip: false,
    wheelSlip: 0,
    odometer: 0,
  };
}

const G = 9.81;

/** Brake cylinder target for a notch: 1.0 = full service. */
export function brakeTarget(notch: number): number {
  if (notch === EB_NOTCH) return TRAIN.emergencyDecel / TRAIN.serviceDecel;
  return notch < 0 ? -notch / BRAKE_NOTCHES : 0;
}

/** Average gradient under the whole train (rise per metre). */
export function trainGrade(track: Track, s: number): number {
  let sum = 0;
  const n = 6;
  for (let i = 0; i < n; i++) sum += track.gradeAt(s - (TRAIN_LENGTH * i) / (n - 1));
  return sum / n;
}

export function tractiveForce(v: number, level: number): number {
  const av = Math.max(Math.abs(v), 0.5);
  return level * Math.min(TRAIN.maxTractionN, TRAIN.powerW / av);
}

/** Davis-style running resistance plus curve resistance (Röckl, metre gauge). */
export function resistance(track: Track, s: number, v: number): number {
  const kmh = Math.abs(v) * 3.6;
  const tunnel = track.tunnelFactor(s);
  const perTonKgf = 1.3 + 0.011 * kmh + 0.00032 * kmh * kmh * (1 + 0.9 * tunnel);
  const k = Math.abs(track.curvatureAt(s - TRAIN_LENGTH * 0.5));
  const r = k > 1e-5 ? 1 / k : 1e9;
  const curvePerMille = r < 1e8 ? 400 / Math.max(r - 20, 40) : 0;
  return TRAIN.massT * G * (perTonKgf + curvePerMille);
}

export interface StepInput {
  atpLimitKmh: number; // current permitted speed
  forceStop?: boolean; // red signal / buffer — handled by ATP as a trip
}

export function stepTrain(t: TrainState, track: Track, dt: number, input: StepInput): void {
  const m = TRAIN.massT * 1000;
  // Motor current rises over ~1.2 s and drops faster; air brakes lag.
  const wantTraction = t.atpTrip || t.notch <= 0 ? 0 : t.notch / POWER_NOTCHES;
  const up = wantTraction > t.traction ? 0.85 : 1.6;
  t.traction += clamp(wantTraction - t.traction, -up * dt, up * dt);
  const wantBrake = t.atpTrip ? brakeTarget(EB_NOTCH) : brakeTarget(t.notch);
  const tau = wantBrake > t.brake ? (t.notch === EB_NOTCH || t.atpTrip ? 0.45 : 0.9) : 1.7;
  t.brake += (wantBrake - t.brake) * (1 - Math.exp(-dt / tau));
  if (t.brake < 0.002) t.brake = 0;

  const grade = trainGrade(track, t.s);
  const gradeN = m * G * grade; // opposes forward motion when climbing
  let traction = tractiveForce(t.v, t.traction);
  // Wheel slip: past the adhesion limit on the loco's 62 t, current is cut.
  const adhesion = 0.33 * 62_000 * G;
  t.wheelSlip = Math.max(0, t.wheelSlip - dt * 1.5);
  if (traction > adhesion) {
    t.wheelSlip = 1;
    traction = adhesion * 0.92;
  }
  const brakeCap = t.brake * TRAIN.serviceDecel * m;
  const resist = resistance(track, t.s, t.v);
  const mEff = m * TRAIN.rotatingFactor;

  const drive = traction - gradeN; // forces that do not depend on direction
  const friction = brakeCap + resist; // always opposes motion
  let v = t.v;
  const aPrev = t.a;
  if (Math.abs(v) < 0.02 && Math.abs(drive) <= friction) {
    v = 0;
    t.a = 0;
  } else {
    const dir = Math.abs(v) < 0.02 ? Math.sign(drive) : Math.sign(v);
    const a = (drive - dir * friction) / mEff;
    const nv = v + a * dt;
    // Friction cannot reverse the motion by itself.
    if (dir !== 0 && Math.sign(nv) !== dir && Math.abs(drive) <= friction) v = 0;
    else v = nv;
    t.a = a;
  }
  // Felt jerk, low-passed like a passenger's body does.
  const rawJerk = (t.a - aPrev) / Math.max(dt, 1e-4);
  t.jerk += (rawJerk - t.jerk) * (1 - Math.exp(-dt / 0.3));
  const ds = (t.v + v) * 0.5 * dt;
  t.v = v;
  t.s += ds;
  t.odometer += Math.abs(ds);
  t.tractionN = traction;
  t.brakeN = brakeCap;
  t.resistN = resist;
  t.gradeN = gradeN;
  if (traction > 0) t.energyKWh += (traction * Math.abs(v) * dt) / 3.6e6 / 0.88;

  // ATP: warn above the limit, trip the penalty brake well above it.
  const kmh = Math.abs(t.v) * 3.6;
  t.atpWarn = kmh > input.atpLimitKmh + 3;
  if (kmh > input.atpLimitKmh + 8 || input.forceStop) t.atpTrip = true;
  if (t.atpTrip && t.v === 0) {
    // Latched until the driver goes back to neutral or brake.
    if (t.notch <= 0) t.atpTrip = false;
  }
}

/** Steady-state acceleration a notch would give right now (autopilot helper). */
export function predictAccel(track: Track, s: number, v: number, notch: number): number {
  const m = TRAIN.massT * 1000;
  const traction = notch > 0 ? Math.min(tractiveForce(v, notch / POWER_NOTCHES), 0.33 * 62_000 * G * 0.92) : 0;
  const brake = brakeTarget(notch) * TRAIN.serviceDecel * m * (v > 0.05 ? 1 : 0);
  const gradeN = m * G * trainGrade(track, s);
  return (traction - gradeN - brake - resistance(track, s, v)) / (m * TRAIN.rotatingFactor);
}
