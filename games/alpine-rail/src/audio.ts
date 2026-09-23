// All sound is synthesised with Web Audio: traction motor and inverter,
// rolling noise, rail joints, flange squeal, wind, the two-tone horn, brake
// release, door chime, the ZUB buzzer and cowbells at the stations.

export interface SoundState {
  v: number; // m/s
  traction: number; // 0..1
  brake: number; // 0..1.4
  curvature: number; // 1/m
  tunnel: number; // 0..1
  atp: boolean;
  inCab: boolean;
  odometer: number;
}

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private motorA!: OscillatorNode;
  private motorB!: OscillatorNode;
  private motorGain!: GainNode;
  private motorFilter!: BiquadFilterNode;
  private whine!: OscillatorNode;
  private whineGain!: GainNode;
  private roll!: AudioBufferSourceNode;
  private rollGain!: GainNode;
  private rollFilter!: BiquadFilterNode;
  private wind!: AudioBufferSourceNode;
  private windGain!: GainNode;
  private squeal!: OscillatorNode;
  private squealGain!: GainNode;
  private buzzer!: OscillatorNode;
  private buzzerGain!: GainNode;
  private hornGain!: GainNode;
  private hornOn = false;
  private noise!: AudioBuffer;
  private lastJoint = 0;
  private prevBrake = 0;
  private bellTimer = 3;
  muted = false;

  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b0 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.985 * b0 + 0.15 * w; // brown-ish
      d[i] = b0 * 0.9 + w * 0.1;
    }

    this.motorFilter = ctx.createBiquadFilter();
    this.motorFilter.type = "lowpass";
    this.motorFilter.frequency.value = 600;
    this.motorGain = ctx.createGain();
    this.motorGain.gain.value = 0;
    this.motorA = ctx.createOscillator();
    this.motorA.type = "sawtooth";
    this.motorB = ctx.createOscillator();
    this.motorB.type = "square";
    this.motorA.connect(this.motorFilter);
    const bG = ctx.createGain();
    bG.gain.value = 0.35;
    this.motorB.connect(bG).connect(this.motorFilter);
    this.motorFilter.connect(this.motorGain).connect(this.master);
    this.motorA.start();
    this.motorB.start();

    this.whine = ctx.createOscillator();
    this.whine.type = "sine";
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whine.connect(this.whineGain).connect(this.master);
    this.whine.start();

    const loop = (gain: GainNode, filter?: BiquadFilterNode) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.playbackRate.value = 0.9 + Math.random() * 0.2;
      if (filter) src.connect(filter).connect(gain);
      else src.connect(gain);
      gain.connect(this.master);
      src.start();
      return src;
    };
    this.rollFilter = ctx.createBiquadFilter();
    this.rollFilter.type = "bandpass";
    this.rollFilter.frequency.value = 260;
    this.rollFilter.Q.value = 0.7;
    this.rollGain = ctx.createGain();
    this.rollGain.gain.value = 0;
    this.roll = loop(this.rollGain, this.rollFilter);
    const wf = ctx.createBiquadFilter();
    wf.type = "highpass";
    wf.frequency.value = 900;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.wind = loop(this.windGain, wf);

    this.squeal = ctx.createOscillator();
    this.squeal.type = "triangle";
    this.squeal.frequency.value = 3100;
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    this.squeal.connect(this.squealGain).connect(this.master);
    this.squeal.start();

    this.buzzer = ctx.createOscillator();
    this.buzzer.type = "square";
    this.buzzer.frequency.value = 1050;
    this.buzzerGain = ctx.createGain();
    this.buzzerGain.gain.value = 0;
    const bf = ctx.createBiquadFilter();
    bf.type = "lowpass";
    bf.frequency.value = 2400;
    this.buzzer.connect(bf).connect(this.buzzerGain).connect(this.master);
    this.buzzer.start();

    // Two-tone horn: two detuned pairs through a formant filter.
    this.hornGain = ctx.createGain();
    this.hornGain.gain.value = 0;
    const hf = ctx.createBiquadFilter();
    hf.type = "bandpass";
    hf.frequency.value = 900;
    hf.Q.value = 0.8;
    for (const f of [311, 313.5, 392, 394.5]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.25;
      o.connect(g).connect(hf);
      o.start();
    }
    hf.connect(this.hornGain).connect(this.master);
  }

  get running(): boolean {
    return !!this.ctx && this.ctx.state === "running";
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }

  horn(on: boolean): void {
    if (!this.ctx || this.hornOn === on) return;
    this.hornOn = on;
    const t = this.ctx.currentTime;
    this.hornGain.gain.cancelScheduledValues(t);
    this.hornGain.gain.setTargetAtTime(on ? 0.5 : 0, t, on ? 0.03 : 0.08);
  }

  private burst(freq: number, q: number, gain: number, dur: number, type: BiquadFilterType = "highpass"): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private tone(freq: number, gain: number, dur: number, at = 0, type: OscillatorType = "sine"): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime + at;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Door closing: warning beeps. */
  doors(): void {
    if (!this.ctx) return;
    for (let i = 0; i < 4; i++) this.tone(1320, 0.08, 0.16, i * 0.32, "square");
    this.burst(1800, 0.5, 0.12, 0.9);
  }

  /** Arrival / departure chime. */
  chime(): void {
    if (!this.ctx) return;
    this.tone(659, 0.16, 1.2, 0);
    this.tone(523, 0.16, 1.4, 0.45);
  }

  cowbell(): void {
    if (!this.ctx) return;
    const f = 520 + Math.random() * 260;
    for (const [m, g] of [[1, 0.05], [2.76, 0.03], [5.4, 0.015]] as const) this.tone(f * m, g, 1.1 + Math.random() * 0.6, 0, "sine");
  }

  update(st: SoundState, dt: number): void {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const v = Math.abs(st.v);
    const kmh = v * 3.6;
    const cab = st.inCab ? 1 : 0.7;
    const tunnel = st.tunnel;
    // Traction motor: pitch with speed, loudness with current.
    const mf = 38 + kmh * 5.2;
    this.motorA.frequency.setTargetAtTime(mf, t, 0.1);
    this.motorB.frequency.setTargetAtTime(mf * 2.01, t, 0.1);
    this.motorFilter.frequency.setTargetAtTime(380 + kmh * 14 + st.traction * 600, t, 0.2);
    const regen = st.brake > 0.05 && v > 3 ? Math.min(1, st.brake) * 0.4 : 0;
    this.motorGain.gain.setTargetAtTime((0.012 + st.traction * 0.1 + regen * 0.05) * (v > 0.05 || st.traction > 0.05 ? 1 : 0.2) * cab, t, 0.12);
    // Inverter whine: rises through the low speeds, fades above ~45 km/h.
    const wOn = (st.traction + regen) * Math.max(0, 1 - kmh / 55);
    this.whine.frequency.setTargetAtTime(420 + kmh * 42, t, 0.1);
    this.whineGain.gain.setTargetAtTime(wOn * 0.028 * cab, t, 0.15);
    // Rolling noise and wind; tunnels make everything louder and duller.
    this.rollFilter.frequency.setTargetAtTime(150 + kmh * 5 - tunnel * 60, t, 0.3);
    this.rollGain.gain.setTargetAtTime(Math.min(1, Math.pow(kmh / 80, 0.8)) * (0.34 + tunnel * 0.4) * cab, t, 0.2);
    this.windGain.gain.setTargetAtTime(Math.pow(kmh / 90, 2) * (0.05 + tunnel * 0.12) * (st.inCab ? 0.6 : 1), t, 0.3);
    this.roll.playbackRate.setTargetAtTime(0.8 + kmh / 200, t, 0.3);
    this.wind.playbackRate.setTargetAtTime(0.7 + kmh / 150, t, 0.3);
    // Flange squeal on tight curves.
    const k = Math.abs(st.curvature);
    const sq = k > 1 / 320 && kmh > 12 ? Math.min(1, (k * 320 - 1) * 0.8) * Math.min(1, kmh / 40) : 0;
    this.squeal.frequency.setTargetAtTime(2600 + Math.sin(t * 7) * 240 + kmh * 12, t, 0.05);
    this.squealGain.gain.setTargetAtTime(sq * 0.018 * (0.6 + 0.4 * Math.sin(t * 3.1)), t, 0.2);
    // Rail joints every 24 m: two axles of the leading bogie.
    if (st.odometer - this.lastJoint > 24 && v > 1) {
      this.lastJoint = st.odometer;
      const gap = 1.9 / v;
      const loud = Math.min(0.5, 0.12 + kmh / 200) * (1 + tunnel * 0.6);
      this.burst(1200, 0.9, loud, 0.07, "bandpass");
      window.setTimeout(() => this.ctx && this.burst(1100, 0.9, loud * 0.9, 0.07, "bandpass"), gap * 1000);
      const gap2 = (9.8 / v) * 1000;
      if (gap2 < 2500) {
        window.setTimeout(() => this.ctx && this.burst(900, 0.9, loud * 0.6, 0.07, "bandpass"), gap2);
        window.setTimeout(() => this.ctx && this.burst(850, 0.9, loud * 0.55, 0.07, "bandpass"), gap2 + gap * 1000);
      }
    }
    // Brake release hiss.
    if (this.prevBrake - st.brake > 0.08) {
      this.burst(2500, 0.4, 0.07 * Math.min(1, (this.prevBrake - st.brake) * 4), 0.8);
      this.prevBrake = st.brake;
    } else if (st.brake > this.prevBrake) this.prevBrake = st.brake;
    // ZUB buzzer.
    this.buzzerGain.gain.setTargetAtTime(st.atp && Math.floor(t * 4) % 2 === 0 ? 0.05 : 0, t, 0.01);
    // Cowbells when stopped out in the meadows.
    if (v < 0.5 && tunnel < 0.1) {
      this.bellTimer -= dt;
      if (this.bellTimer < 0) {
        this.bellTimer = 1.5 + Math.random() * 5;
        this.cowbell();
      }
    }
  }
}
