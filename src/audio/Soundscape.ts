/**
 * Soundscape — a generative ambience with no audio assets: a low detuned
 * drone, filtered air that swells with scroll speed, and small ticks when
 * the archive moves. Off until the visitor turns it on (browsers require a
 * gesture anyway); the choice is remembered.
 */
const STORAGE_KEY = "unfiled:sound";

export class Soundscape {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private air: GainNode | null = null;
  private airFilter: BiquadFilterNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private intensity = 0;
  private enabled = false;
  private lastTick = 0;

  static remembered() {
    try {
      return localStorage.getItem(STORAGE_KEY) === "on";
    } catch {
      return false;
    }
  }

  get isEnabled() {
    return this.enabled;
  }

  async enable() {
    if (this.enabled) return;
    this.enabled = true;
    try {
      localStorage.setItem(STORAGE_KEY, "on");
    } catch {
      /* private mode */
    }
    if (!this.ctx) this.buildGraph();
    const ctx = this.ctx!;
    if (ctx.state === "suspended") await ctx.resume();
    const now = ctx.currentTime;
    this.master!.gain.cancelScheduledValues(now);
    this.master!.gain.setValueAtTime(this.master!.gain.value, now);
    this.master!.gain.linearRampToValueAtTime(0.42, now + 1.6);
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    try {
      localStorage.setItem(STORAGE_KEY, "off");
    } catch {
      /* private mode */
    }
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + 0.6);
    window.setTimeout(() => {
      if (!this.enabled && this.ctx?.state === "running") void this.ctx.suspend();
    }, 700);
  }

  toggle() {
    if (this.enabled) this.disable();
    else void this.enable();
    return this.enabled;
  }

  /** 0..1 — how fast the archive is moving; drives the air swell. */
  setIntensity(v: number) {
    this.intensity = Math.max(0, Math.min(1, v));
    if (!this.ctx || !this.air || !this.airFilter || !this.droneFilter) return;
    const now = this.ctx.currentTime;
    this.air.gain.setTargetAtTime(0.03 + this.intensity * 0.22, now, 0.12);
    this.airFilter.frequency.setTargetAtTime(600 + this.intensity * 1800, now, 0.15);
    this.droneFilter.frequency.setTargetAtTime(180 + this.intensity * 220, now, 0.3);
  }

  /** A soft tick when the active work changes (pitch follows the index). */
  tick(index: number) {
    if (!this.enabled || !this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    if (now - this.lastTick < 0.08) return;
    this.lastTick = now;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    const base = 420 + (index % 7) * 55;
    osc.frequency.setValueAtTime(base * 2, now);
    osc.frequency.exponentialRampToValueAtTime(base, now + 0.09);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  /** Opening a work: a two-note chime. */
  open() {
    this.chord([660, 990], 0.9);
  }

  /** Closing: the chime inverted. */
  close() {
    this.chord([495, 330], 0.6);
  }

  hover() {
    if (!this.enabled || !this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    if (now - this.lastTick < 0.05) return;
    this.lastTick = now;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(1400, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.05, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  private chord(freqs: number[], length: number) {
    if (!this.enabled || !this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    freqs.forEach((f, i) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(f, now + i * 0.07);
      gain.gain.setValueAtTime(0.0001, now + i * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.12, now + i * 0.07 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.07 + length);
      osc.connect(gain).connect(this.master!);
      osc.start(now + i * 0.07);
      osc.stop(now + i * 0.07 + length + 0.05);
    });
  }

  private buildGraph() {
    const ctx = new AudioContext();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    this.master = master;

    // drone: two detuned saws through a slow-moving lowpass
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = "lowpass";
    droneFilter.frequency.value = 180;
    droneFilter.Q.value = 0.8;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.16;
    droneFilter.connect(droneGain).connect(master);
    for (const [freq, detune] of [
      [55, -6],
      [55, 7],
      [110, 3],
    ]) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = freq;
      osc.detune.value = detune;
      osc.connect(droneFilter);
      osc.start();
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 60;
    lfo.connect(lfoGain).connect(droneFilter.frequency);
    lfo.start();
    this.droneFilter = droneFilter;

    // air: looping noise through a bandpass, swelling with motion
    const seconds = 4;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02; // brown-ish
      data[i] = last * 3.5;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = "bandpass";
    airFilter.frequency.value = 700;
    airFilter.Q.value = 0.7;
    const air = ctx.createGain();
    air.gain.value = 0.03;
    noise.connect(airFilter).connect(air).connect(master);
    noise.start();
    this.airFilter = airFilter;
    this.air = air;
  }

  dispose() {
    this.enabled = false;
    void this.ctx?.close();
    this.ctx = null;
  }
}
