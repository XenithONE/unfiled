/**
 * Soundscape — the air over the mirror, with no audio assets: wind that
 * rises with the walk, water lapping somewhere close, a slow chord that
 * changes with the hour, and small bells when a work wakes. Off until the
 * visitor turns it on (browsers require a gesture anyway); the choice is
 * remembered.
 */
const STORAGE_KEY = "unfiled:sound";

/** Four voices per chord (Hz), keyed by the hour (0 sunset … 1 sunrise). */
const CHORDS: Array<{ until: number; notes: [number, number, number, number] }> = [
  { until: 0.12, notes: [146.83, 220.0, 329.63, 369.99] }, // D add9: the last light
  { until: 0.36, notes: [123.47, 185.0, 293.66, 440.0] }, // B minor 7: blue hour
  { until: 0.7, notes: [98.0, 146.83, 246.94, 369.99] }, // G major 7: night
  { until: 0.94, notes: [110.0, 164.81, 246.94, 329.63] }, // A sus2: first light
  { until: 2, notes: [146.83, 220.0, 369.99, 587.33] }, // D major: sunrise
];

/** D major pentatonic, for the bells. */
const BELLS = [293.66, 329.63, 369.99, 440.0, 493.88, 587.33, 659.25];

export class Soundscape {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private wet: GainNode | null = null;
  private wind: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private padGain: GainNode | null = null;
  private padFilter: BiquadFilterNode | null = null;
  private voices: OscillatorNode[] = [];
  private noise: AudioBuffer | null = null;
  private intensity = 0;
  private hour = 0;
  private chord = -1;
  private enabled = false;
  private lastTick = 0;
  private lapTimer: number | null = null;

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
    this.master!.gain.linearRampToValueAtTime(0.5, now + 1.8);
    this.scheduleLap();
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    try {
      localStorage.setItem(STORAGE_KEY, "off");
    } catch {
      /* private mode */
    }
    if (this.lapTimer !== null) window.clearTimeout(this.lapTimer);
    this.lapTimer = null;
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

  /** 0..1 — how fast the walk is moving; the wind rises with it. */
  setIntensity(v: number) {
    this.intensity = Math.max(0, Math.min(1, v));
    if (!this.ctx || !this.wind || !this.windFilter) return;
    const now = this.ctx.currentTime;
    this.wind.gain.setTargetAtTime(0.035 + this.intensity * 0.2, now, 0.15);
    this.windFilter.frequency.setTargetAtTime(420 + this.intensity * 1500, now, 0.2);
  }

  /** 0 sunset … 0.5 deep night … 1 sunrise: the chord follows the sky. */
  setHour(t: number) {
    this.hour = Math.max(0, Math.min(1, t));
    if (!this.ctx || !this.padFilter || !this.padGain) return;
    const index = CHORDS.findIndex((c) => this.hour < c.until);
    const now = this.ctx.currentTime;
    if (index !== this.chord) {
      this.chord = index;
      CHORDS[index].notes.forEach((f, i) => {
        // glide: the harmony turns over slowly, like the light
        this.voices[i * 2]?.frequency.setTargetAtTime(f, now, 1.6);
        this.voices[i * 2 + 1]?.frequency.setTargetAtTime(f * 1.003, now, 1.6);
      });
    }
    // the night is darker and quieter than the two ends of the day
    const night = Math.max(0, 1 - Math.abs(this.hour - 0.53) / 0.4);
    this.padFilter.frequency.setTargetAtTime(1500 - night * 800, now, 0.8);
    this.padGain.gain.setTargetAtTime(0.085 - night * 0.025, now, 0.8);
  }

  /** A bell when the walk reaches a work (the pitch follows the index). */
  tick(index: number) {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastTick < 0.1) return;
    this.lastTick = now;
    this.bell(BELLS[index % BELLS.length] * (index % 2 ? 1 : 0.5), now, 0.07, 1.6);
  }

  /** Opening a work: two bells rising. */
  open() {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    this.bell(BELLS[1], now, 0.07, 1.4);
    this.bell(BELLS[4], now + 0.09, 0.07, 1.8);
  }

  /** Closing: the same two, falling. */
  close() {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    this.bell(BELLS[4] * 0.5, now, 0.05, 1.1);
    this.bell(BELLS[1] * 0.5, now + 0.08, 0.05, 1.3);
  }

  /** A touch on the water. */
  drop() {
    if (!this.enabled || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(980, now);
    osc.frequency.exponentialRampToValueAtTime(360, now + 0.11);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.09, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    osc.connect(gain);
    gain.connect(this.master);
    if (this.wet) gain.connect(this.wet);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  /** A struck bar: a sine with one inharmonic partial, into the reverb. */
  private bell(freq: number, at: number, level: number, length: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    for (const [ratio, amp] of [
      [1, 1],
      [2.76, 0.28],
    ] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq * ratio, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(level * amp, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + length / ratio);
      osc.connect(gain);
      gain.connect(this.master);
      if (this.wet) gain.connect(this.wet);
      osc.start(at);
      osc.stop(at + length + 0.1);
    }
  }

  /** Water lapping: a soft filtered wash, every few seconds, off to one side. */
  private scheduleLap() {
    if (!this.enabled) return;
    this.lapTimer = window.setTimeout(
      () => {
        this.lap();
        this.scheduleLap();
      },
      2200 + Math.random() * 3800,
    );
  }

  private lap() {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 1.4;
    filter.frequency.setValueAtTime(420 + Math.random() * 200, now);
    filter.frequency.exponentialRampToValueAtTime(1200 + Math.random() * 600, now + 0.5);
    const gain = ctx.createGain();
    const level = 0.035 + Math.random() * 0.035;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(level, now + 0.22);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.95);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    src.connect(filter).connect(gain).connect(pan).connect(this.master);
    src.start(now, Math.random() * 3);
    src.stop(now + 1);
  }

  private buildGraph() {
    const ctx = new AudioContext();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.ratio.value = 6;
    master.connect(limiter).connect(ctx.destination);
    this.master = master;

    // shared noise: brown-ish, a few seconds, looped where needed
    const seconds = 4;
    const noise = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    this.noise = noise;

    // a small hall: decaying noise as the impulse
    const tail = ctx.createBuffer(2, ctx.sampleRate * 3, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = tail.getChannelData(ch);
      for (let i = 0; i < d.length; i++)
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.6);
    }
    const reverb = ctx.createConvolver();
    reverb.buffer = tail;
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    wet.connect(reverb).connect(master);
    this.wet = wet;

    // wind
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = noise;
    windSrc.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 420;
    windFilter.Q.value = 0.6;
    const wind = ctx.createGain();
    wind.gain.value = 0.035;
    windSrc.connect(windFilter).connect(wind).connect(master);
    windSrc.start();
    const gust = ctx.createOscillator();
    gust.frequency.value = 0.09;
    const gustDepth = ctx.createGain();
    gustDepth.gain.value = 130;
    gust.connect(gustDepth).connect(windFilter.frequency);
    gust.start();
    this.wind = wind;
    this.windFilter = windFilter;

    // the chord: four notes, two slightly detuned voices each
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = "lowpass";
    padFilter.frequency.value = 1400;
    padFilter.Q.value = 0.4;
    const padGain = ctx.createGain();
    padGain.gain.value = 0.08;
    padFilter.connect(padGain);
    padGain.connect(master);
    padGain.connect(wet);
    const start = CHORDS[0].notes;
    start.forEach((f, i) => {
      for (const detune of [1, 1.003]) {
        const osc = ctx.createOscillator();
        osc.type = i < 2 ? "triangle" : "sine";
        osc.frequency.value = f * detune;
        const voice = ctx.createGain();
        voice.gain.value = i < 2 ? 0.22 : 0.14;
        // each note breathes at its own pace
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.05 + i * 0.023 + (detune - 1) * 9;
        const depth = ctx.createGain();
        depth.gain.value = voice.gain.value * 0.6;
        lfo.connect(depth).connect(voice.gain);
        osc.connect(voice).connect(padFilter);
        osc.start();
        lfo.start();
        this.voices.push(osc);
      }
    });
    this.padFilter = padFilter;
    this.padGain = padGain;
    this.chord = 0;
    this.setHour(this.hour);
    this.setIntensity(this.intensity);
  }

  dispose() {
    this.enabled = false;
    if (this.lapTimer !== null) window.clearTimeout(this.lapTimer);
    this.lapTimer = null;
    void this.ctx?.close();
    this.ctx = null;
  }
}
