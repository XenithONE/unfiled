import type { SoundName } from "./sim";
import { clamp } from "./util";

/** Procedural Web Audio effects: nothing is loaded from disk. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private rollGain: GainNode | null = null;
  private rollFilter: BiquadFilterNode | null = null;
  private grindGain: GainNode | null = null;
  private grindOscGain: GainNode | null = null;
  private white: AudioBuffer | null = null;
  private brown: AudioBuffer | null = null;
  muted = false;

  /** Create (or resume) the context. Must be called from a user gesture. */
  unlock(): void {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return;
      }
      this.build();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx)
      this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.02);
  }

  private build(): void {
    const ctx = this.ctx!;
    const seconds = 2;
    const n = ctx.sampleRate * seconds;
    this.white = ctx.createBuffer(1, n, ctx.sampleRate);
    this.brown = ctx.createBuffer(1, n, ctx.sampleRate);
    const w = this.white.getChannelData(0);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const v = Math.random() * 2 - 1;
      w[i] = v;
      last = (last + 0.02 * v) / 1.02;
      b[i] = last * 3.5;
    }
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(ctx.destination);

    const roll = ctx.createBufferSource();
    roll.buffer = this.brown;
    roll.loop = true;
    this.rollFilter = ctx.createBiquadFilter();
    this.rollFilter.type = "lowpass";
    this.rollFilter.frequency.value = 220;
    this.rollGain = ctx.createGain();
    this.rollGain.gain.value = 0;
    roll.connect(this.rollFilter).connect(this.rollGain).connect(this.master);
    roll.start();

    const grind = ctx.createBufferSource();
    grind.buffer = this.white;
    grind.loop = true;
    const gf = ctx.createBiquadFilter();
    gf.type = "bandpass";
    gf.frequency.value = 1500;
    gf.Q.value = 5;
    this.grindGain = ctx.createGain();
    this.grindGain.gain.value = 0;
    grind.connect(gf).connect(this.grindGain).connect(this.master);
    grind.start();
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 96;
    this.grindOscGain = ctx.createGain();
    this.grindOscGain.gain.value = 0;
    osc.connect(this.grindOscGain).connect(this.master);
    osc.start();
  }

  update(speed: number, rolling: boolean, grinding: boolean): void {
    if (!this.ctx || !this.rollGain || !this.rollFilter || !this.grindGain || !this.grindOscGain)
      return;
    const t = this.ctx.currentTime;
    const rollTarget = rolling ? clamp(speed / 14, 0, 1) * 0.32 : 0;
    this.rollGain.gain.setTargetAtTime(rollTarget, t, 0.08);
    this.rollFilter.frequency.setTargetAtTime(200 + speed * 70, t, 0.1);
    this.grindGain.gain.setTargetAtTime(grinding ? 0.22 : 0, t, 0.05);
    this.grindOscGain.gain.setTargetAtTime(grinding ? 0.05 : 0, t, 0.05);
  }

  play(name: SoundName): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.white || this.muted) return;
    const t = ctx.currentTime;
    switch (name) {
      case "pop":
        this.burst(t, 0.07, 0.5, "highpass", 1400);
        break;
      case "push":
        this.burst(t, 0.09, 0.18, "lowpass", 900);
        break;
      case "land":
        this.thump(t, 90, 42, 0.13, 0.5);
        this.burst(t, 0.06, 0.25, "lowpass", 600);
        break;
      case "grind":
        this.burst(t, 0.05, 0.3, "bandpass", 2200);
        break;
      case "swish":
        this.sweep(t, 2600, 700, 0.16, 0.25);
        break;
      case "bail":
        this.burst(t, 0.35, 0.4, "bandpass", 500);
        this.thump(t, 260, 70, 0.3, 0.14, "square");
        break;
      case "bank":
        this.blip(t, 880, 0.09, 0.16);
        this.blip(t + 0.09, 1320, 0.11, 0.16);
        break;
      case "bigbank":
        this.blip(t, 660, 0.08, 0.16);
        this.blip(t + 0.08, 880, 0.08, 0.16);
        this.blip(t + 0.16, 1320, 0.14, 0.18);
        break;
    }
  }

  private burst(t: number, dur: number, gain: number, type: BiquadFilterType, freq: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.02);
  }

  private thump(
    t: number,
    f0: number,
    f1: number,
    dur: number,
    gain: number,
    type: OscillatorType = "sine",
  ): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private sweep(t: number, f0: number, f1: number, dur: number, gain: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 2.5;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }

  private blip(t: number, freq: number, dur: number, gain: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
}
