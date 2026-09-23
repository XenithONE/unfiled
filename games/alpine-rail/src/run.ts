// One service from Lagrina to Alp Glatscher: timetable, doors, exit signals,
// station stops, ATP penalties, scoring, and the autopilot used for the
// sightseeing mode, the timetable itself and the tests. Pure logic.

import { clamp } from "./noise";
import { EB_NOTCH, POWER_NOTCHES, newTrain, predictAccel, stepTrain, type TrainState } from "./physics";
import type { Track } from "./track";

export type Phase = "dwell" | "running" | "finished";
export type MsgKind = "info" | "good" | "warn" | "bad";
export interface RunMessage {
  kind: MsgKind;
  text: string;
  sub?: string;
}

export interface StopResult {
  station: string;
  kana: string;
  stopError: number;
  lateBy: number; // seconds, negative = early
  stopPoints: number;
  timePoints: number;
  skipped: boolean;
}

export interface Schedule {
  arr: number[]; // seconds after the run starts, per station (index 0 unused)
  dep: number[];
}

const STOP_WINDOW_SHORT = -12; // allowed stop error range, metres
const STOP_WINDOW_OVER = 6;
const OVERRUN_LIMIT = 40;
const MIN_DWELL = 16;
const FIRST_DEPARTURE = 20;
const SIGNAL_AHEAD = 22; // exit signal beyond the platform end

export class Run {
  readonly track: Track;
  readonly train: TrainState;
  readonly schedule: Schedule;
  time = 0;
  phase: Phase = "dwell";
  at = 0; // index of the station we are standing at (or last departed)
  dwellLeft = FIRST_DEPARTURE;
  doorsOpen = true;
  doorAnim = 1; // 0 closed .. 1 open
  signalGreen = false;
  results: StopResult[] = [];
  penalty = 0;
  atpWarnings = 0;
  atpTrips = 0;
  comfortSeconds = 0;
  ebUses = 0;
  crashed = false;
  autopilot = false;
  private apNotch = -4;
  private apHold = 0;
  private prevWarn = false;
  private prevTrip = false;
  private shortHintAt = -99;

  constructor(track: Track, schedule: Schedule) {
    this.track = track;
    this.schedule = schedule;
    this.train = newTrain(track.stations[0].stopS);
  }

  get nextIndex(): number {
    return this.phase === "running" ? this.at + 1 : this.at;
  }

  exitSignalS(i: number): number {
    return this.track.stations[i].platformTo + SIGNAL_AHEAD;
  }

  /** Exit signal aspect for station i. */
  signalAt(i: number): boolean {
    if (i !== this.at) return true;
    return this.phase === "running" ? true : this.signalGreen;
  }

  setNotch(n: number): void {
    const t = this.train;
    const next = clamp(Math.round(n), EB_NOTCH, POWER_NOTCHES);
    if (next === EB_NOTCH && t.notch !== EB_NOTCH && Math.abs(t.v) > 1 && !this.autopilot) {
      this.ebUses++;
      this.penalty += 10;
    }
    t.notch = next;
  }

  step(dt: number): RunMessage[] {
    const msgs: RunMessage[] = [];
    if (this.phase === "finished") {
      this.time += dt;
      stepTrain(this.train, this.track, dt, { atpLimitKmh: 999 });
      return msgs;
    }
    const t = this.train;
    const tr = this.track;
    this.time += dt;
    if (this.autopilot) this.setNotch(this.autoNotch(dt));

    // Doors: interlock traction while any door is open.
    const doorTarget = this.doorsOpen ? 1 : 0;
    this.doorAnim = clamp(this.doorAnim + Math.sign(doorTarget - this.doorAnim) * dt / 2.2, 0, 1);
    if (this.doorAnim > 0 && t.notch > 0) t.notch = 0;

    if (this.phase === "dwell") {
      this.dwellLeft -= dt;
      if (this.doorsOpen && this.dwellLeft <= 3) {
        this.doorsOpen = false;
        msgs.push({ kind: "info", text: "ドアが閉まります", sub: "Türen schliessen" });
      }
      if (!this.doorsOpen && this.doorAnim === 0 && !this.signalGreen) {
        this.signalGreen = true;
        const last = this.at === tr.stations.length - 1;
        if (!last) msgs.push({ kind: "good", text: "出発信号 進行", sub: "発車してください — Abfahrt" });
      }
      if (this.signalGreen && t.v > 0.3) {
        this.phase = "running";
        this.signalGreen = false;
      }
    }

    const redAhead = this.phase === "dwell" && !this.signalGreen;
    const passedRed = redAhead && t.s > this.exitSignalS(this.at);
    const bufferHit = t.s > tr.bufferS;

    stepTrain(t, tr, dt, { atpLimitKmh: tr.limitAt(t.s), forceStop: passedRed || bufferHit });

    if (passedRed && !this.prevTrip) {
      msgs.push({ kind: "bad", text: "信号冒進 — 非常ブレーキ", sub: "Signal überfahren  −40" });
      this.penalty += 40;
    }
    if (bufferHit && !this.crashed) {
      this.crashed = true;
      t.v = 0;
      t.s = tr.bufferS;
      this.penalty += 100;
      msgs.push({ kind: "bad", text: "車止めに衝突しました", sub: "Prellbock  −100" });
    }
    if (t.atpWarn && !this.prevWarn) {
      this.atpWarnings++;
      this.penalty += 5;
      msgs.push({ kind: "warn", text: "速度超過", sub: `ZUB 警報 — 制限 ${tr.limitAt(t.s)} km/h  −5` });
    }
    if (t.atpTrip && !this.prevTrip && !passedRed && !bufferHit) {
      this.atpTrips++;
      this.penalty += 30;
      msgs.push({ kind: "bad", text: "ATP 動作 — 非常ブレーキ", sub: "停止後、ハンドルを N か B へ  −30" });
    }
    this.prevWarn = t.atpWarn;
    this.prevTrip = t.atpTrip;
    if (Math.abs(t.jerk) > 2 && Math.abs(t.v) > 0.5) {
      this.comfortSeconds += dt;
      this.penalty += dt * 2;
    }

    if (this.phase === "running") {
      const idx = this.at + 1;
      const st = tr.stations[idx];
      const err = t.s - st.stopS;
      if (t.v === 0 && err >= STOP_WINDOW_SHORT && err <= OVERRUN_LIMIT) {
        this.arrive(idx, err, msgs);
      } else if (err > OVERRUN_LIMIT) {
        // Ran through the station.
        this.results.push({ station: st.name, kana: st.kana, stopError: err, lateBy: 0, stopPoints: 0, timePoints: 0, skipped: true });
        this.penalty += 50;
        msgs.push({ kind: "bad", text: `${st.kana} を通過してしまいました`, sub: "−50" });
        this.at = idx;
        if (idx === tr.stations.length - 1) this.phase = "finished";
      } else if (t.v === 0 && err < STOP_WINDOW_SHORT && err > -300 && this.time - this.shortHintAt > 6) {
        this.shortHintAt = this.time;
        msgs.push({ kind: "info", text: `停止位置まで あと ${Math.round(-err)} m`, sub: "ゆっくり進めてください" });
      }
    }
    return msgs;
  }

  private arrive(idx: number, err: number, msgs: RunMessage[]): void {
    const tr = this.track;
    const st = tr.stations[idx];
    const late = this.time - this.schedule.arr[idx];
    const overrun = err > STOP_WINDOW_OVER;
    const stopPoints = overrun ? 0 : Math.round(50 * clamp(1 - Math.abs(err) / 8, 0, 1));
    let timePoints: number;
    if (late >= -30 && late <= 15) timePoints = 50;
    else if (late > 15) timePoints = Math.round(50 * clamp(1 - (late - 15) / 105, 0, 1));
    else timePoints = Math.round(50 * clamp(1 - (-late - 30) / 90, 0, 1));
    if (overrun) this.penalty += 10;
    this.results.push({ station: st.name, kana: st.kana, stopError: err, lateBy: late, stopPoints, timePoints, skipped: false });
    const accuracy = Math.abs(err) < 0.5 ? "ピタリ停車！" : Math.abs(err) < 2 ? "いい停車" : overrun ? "オーバーラン" : "停車";
    const errText = `${err >= 0 ? "+" : "−"}${Math.abs(err).toFixed(1)} m`;
    const lateText = Math.abs(late) < 5 ? "定時" : late > 0 ? `${Math.round(late)} 秒遅れ` : `${Math.round(-late)} 秒早着`;
    msgs.push({ kind: overrun ? "warn" : stopPoints >= 40 ? "good" : "info", text: `${accuracy}  ${errText}`, sub: `${st.kana} — ${lateText}` });
    this.at = idx;
    if (idx === tr.stations.length - 1) {
      this.phase = "finished";
      this.doorsOpen = true;
      msgs.push({ kind: "good", text: "終点 アルプ・グラッチャー", sub: "お疲れさまでした" });
      return;
    }
    this.phase = "dwell";
    this.signalGreen = false;
    this.doorsOpen = true;
    const planned = this.schedule.dep[idx] - this.time;
    this.dwellLeft = clamp(planned, MIN_DWELL, 45);
  }

  get score(): number {
    const base = this.results.reduce((a, r) => a + r.stopPoints + r.timePoints, 0);
    return Math.max(0, Math.round(base - this.penalty));
  }

  get maxScore(): number {
    return (this.track.stations.length - 1) * 100;
  }

  /** Speed the autopilot is aiming for right now, m/s. */
  targetSpeed(): number {
    const t = this.train;
    const tr = this.track;
    let vt = tr.limitAt(t.s) / 3.6 - 0.8;
    for (let d = 10; d < 1000; d += 10) {
      const lim = tr.limitAt(t.s + d) / 3.6 - 0.8;
      vt = Math.min(vt, Math.sqrt(lim * lim + 2 * 0.38 * Math.max(0, d - 25)));
    }
    const idx = this.phase === "running" ? this.at + 1 : this.at;
    const st = tr.stations[idx];
    if (st && this.phase === "running") {
      const d = st.stopS - t.s - 0.15;
      vt = Math.min(vt, d > 0 ? Math.sqrt(2 * 0.42 * d) + (d > 3 ? 0.4 : 0) : 0);
    }
    return Math.max(0, vt);
  }

  private autoNotch(dt: number): number {
    const t = this.train;
    if (this.phase !== "running" && !(this.phase === "dwell" && this.signalGreen)) return -4;
    const vt = this.targetSpeed();
    if (vt === 0 && t.v < 0.3) return -4;
    let aDes = clamp((vt - t.v) * 0.55, -0.9, 0.6);
    // Final approach: brake for the stop mark directly, allowing for the air
    // brake's lag by looking a little ahead.
    const st = this.track.stations[this.at + 1];
    if (st && this.phase === "running") {
      const d = st.stopS - t.s - t.v * 0.7;
      const aStop = -(t.v * t.v) / (2 * Math.max(d, 0.25));
      if (aStop < -0.3) aDes = Math.min(aDes, aStop * 1.05);
      if (d < 0.3 && t.v < 1.2) return -5;
    }
    this.apHold -= dt;
    const current = predictAccel(this.track, t.s, t.v, this.apNotch);
    if (this.apHold > 0 && Math.abs(current - aDes) < 0.12) return this.apNotch;
    let best = 0;
    let bestErr = 1e9;
    for (let n = -7; n <= POWER_NOTCHES; n++) {
      const e = Math.abs(predictAccel(this.track, t.s, t.v, n) - aDes) + (n === this.apNotch ? 0 : 0.015);
      if (e < bestErr) {
        bestErr = e;
        best = n;
      }
    }
    // Never power while above the target; never brake hard below it.
    if (t.v > vt + 0.3 && best > 0) best = 0;
    this.apNotch = best;
    this.apHold = 0.5;
    return best;
  }
}

/** Timetable from a headless autopilot run, padded like a real one. */
export function buildSchedule(track: Track): Schedule {
  const n = track.stations.length;
  const probe = new Run(track, { arr: new Array(n).fill(0), dep: new Array(n).fill(0) });
  probe.autopilot = true;
  const legs: number[] = new Array(n).fill(0);
  let departed = 0;
  let prevPhase: Phase = probe.phase;
  const dt = 1 / 20;
  for (let i = 0; i < 20 * 60 * 40 && probe.phase !== "finished"; i++) {
    probe.step(dt);
    if (prevPhase === "dwell" && probe.phase === "running") departed = probe.time;
    if (prevPhase === "running" && probe.phase !== "running") legs[probe.at] = probe.time - departed;
    prevPhase = probe.phase;
  }
  // Pad each running time by 2 % and round to the quarter minute; dwell 30 s.
  const out: Schedule = { arr: new Array(n).fill(0), dep: new Array(n).fill(0) };
  out.dep[0] = FIRST_DEPARTURE;
  for (let i = 1; i < n; i++) {
    out.arr[i] = out.dep[i - 1] + Math.ceil((legs[i] * 1.02 + 4) / 15) * 15;
    out.dep[i] = out.arr[i] + 30;
  }
  return out;
}
