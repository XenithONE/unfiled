/**
 * The soundtrack, synthesised live (no audio files): a slowly gliding pad on
 * each chapter's chord, a sub, star-like sparkles, a wind that follows the
 * camera's speed, and booms for the big events.
 *
 * The analyser taps the mix before the master volume, so the spectrum keeps
 * driving the particles (#17) even when the viewer chose silence.
 */
import { FFT_BINS, G, fftData, fftTexture } from "../tsl/common";

const CHORDS: number[][] = [
  [38, 50, 57, 62, 64], // prologue: D sus2
  [34, 46, 53, 57, 60, 64], // sun: B♭ maj9♯11
  [36, 48, 51, 55, 62], // impact: C m(add9)
  [41, 53, 57, 60, 64, 67], // living: F maj9
  [44, 56, 63, 66, 70], // meteor: A♭ sus2 (♭7)
  [43, 55, 59, 62, 66, 69], // rings: G maj9
  [41, 53, 56, 60, 63], // moon: F m7
  [36, 48, 55, 62, 65], // knot: C sus
  [45, 57, 61, 64, 68], // nursery: A maj7
  [40, 52, 59, 63, 66, 71], // galaxy: E maj9
  [37, 49, 56, 61, 63], // web: C♯ sus2
  [50, 57, 62, 66, 69, 74], // foam: D major
];
const SPARKLE_RATE = [0.6, 1.4, 0.8, 2.0, 1.0, 2.4, 1.2, 1.8, 2.0, 3.0, 2.6, 3.4];

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

interface Voice {
  oscs: OscillatorNode[];
  gain: GainNode;
}

export class Score {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private bus!: GainNode;
  private analyser!: AnalyserNode;
  private reverb!: ConvolverNode;
  private padFilter!: BiquadFilterNode;
  private voices: Voice[] = [];
  private sub!: OscillatorNode;
  private subGain!: GainNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private chapter = -1;
  private muted = true;
  private sparkleClock = 0;
  private time = 0;
  private bins = new Uint8Array(FFT_BINS);

  get running() {
    return this.ctx !== null;
  }

  get isMuted() {
    return this.muted;
  }

  /** Must be called from a user gesture. */
  async start(withSound: boolean) {
    if (this.ctx) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor({ latencyHint: "playback" });
    this.ctx = ctx;

    this.bus = ctx.createGain();
    this.bus.gain.value = 1;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = FFT_BINS * 2;
    this.analyser.smoothingTimeConstant = 0.78;
    this.bus.connect(comp);
    comp.connect(this.analyser);
    comp.connect(this.master);
    this.master.connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(5.5);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverb.connect(wet);
    wet.connect(this.bus);

    // pad: five voices of two detuned saws through one slow low-pass
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = "lowpass";
    this.padFilter.frequency.value = 700;
    this.padFilter.Q.value = 0.6;
    const padGain = ctx.createGain();
    padGain.gain.value = 0.11;
    this.padFilter.connect(padGain);
    padGain.connect(this.bus);
    padGain.connect(this.reverb);
    for (let v = 0; v < 6; v++) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.padFilter);
      const oscs = [-7, 7].map((cents) => {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.detune.value = cents;
        o.frequency.value = hz(CHORDS[0][v % CHORDS[0].length]);
        o.connect(gain);
        o.start();
        return o;
      });
      this.voices.push({ oscs, gain });
    }

    // sub
    this.sub = ctx.createOscillator();
    this.sub.type = "sine";
    this.sub.frequency.value = hz(CHORDS[0][0] - 12);
    this.subGain = ctx.createGain();
    this.subGain.gain.value = 0.0;
    this.sub.connect(this.subGain);
    this.subGain.connect(this.bus);
    this.sub.start();

    // wind: looping noise through a moving band-pass
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer(3);
    noise.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.9;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.0;
    noise.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.bus);
    this.windGain.connect(this.reverb);
    noise.start();

    this.setMuted(!withSound);
    if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(m ? 0 : 0.85, now, 0.35);
    if (!m && this.ctx.state === "suspended") void this.ctx.resume();
  }

  /** Glides the pad to the chapter's chord. */
  setChapter(index: number) {
    if (!this.ctx || index === this.chapter) return;
    this.chapter = index;
    const chord = CHORDS[index % CHORDS.length];
    const now = this.ctx.currentTime;
    this.voices.forEach((v, k) => {
      const note = chord[k % chord.length] + (k >= chord.length ? 12 : 0);
      v.oscs.forEach((o) => o.frequency.setTargetAtTime(hz(note), now, 1.4));
      const level = k === 0 ? 0.55 : 0.32 / (1 + k * 0.15);
      v.gain.gain.setTargetAtTime(level, now, 2.2);
    });
    this.sub.frequency.setTargetAtTime(hz(chord[0] - 12), now, 1.8);
    this.subGain.gain.setTargetAtTime(index === 0 ? 0.05 : 0.16, now, 2.5);
  }

  /** One-off hits: "burst", "shatter", "pop", "warp". */
  event(name: string) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const big = name === "burst" || name === "shatter";
    // boom: a falling sine and a puff of filtered noise
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(big ? 110 : 220, now);
    o.frequency.exponentialRampToValueAtTime(big ? 28 : 80, now + (big ? 1.6 : 0.6));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(big ? 0.75 : 0.25, now + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, now + (big ? 2.4 : 0.9));
    o.connect(g);
    g.connect(this.bus);
    o.start(now);
    o.stop(now + 2.6);
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer(1.5);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(name === "pop" ? 5000 : 2200, now);
    f.frequency.exponentialRampToValueAtTime(120, now + 1.2);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(big ? 0.5 : 0.18, now);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + 1.3);
    n.connect(f);
    f.connect(ng);
    ng.connect(this.bus);
    ng.connect(this.reverb);
    n.start(now);
  }

  /** Per frame: sparkles, wind, pad brightness, and the spectrum texture. */
  update(dt: number, warp: number, speed: number) {
    const ctx = this.ctx;
    if (!ctx) {
      G.level.value = 0;
      return;
    }
    this.time += dt;
    const now = ctx.currentTime;
    const ch = Math.max(0, this.chapter);
    this.sparkleClock += dt * SPARKLE_RATE[ch % SPARKLE_RATE.length];
    while (this.sparkleClock > 1) {
      this.sparkleClock -= 1 + Math.random() * 0.6;
      this.sparkle(now + Math.random() * 0.2);
    }
    const w = Math.min(1, warp + Math.min(1, speed / 400) * 0.35);
    this.windGain.gain.setTargetAtTime(0.012 + w * 0.12, now, 0.25);
    this.windFilter.frequency.setTargetAtTime(380 + w * 1600, now, 0.3);
    this.padFilter.frequency.setTargetAtTime(520 + Math.sin(this.time * 0.11) * 220 + w * 900, now, 0.6);

    this.analyser.getByteFrequencyData(this.bins);
    let sum = 0;
    for (let k = 0; k < FFT_BINS; k++) {
      // lift the quiet top end so every band has something to say
      const lifted = Math.min(255, this.bins[k] * (1 + k / 48));
      fftData[k] = lifted;
      sum += lifted;
    }
    fftTexture.needsUpdate = true;
    G.level.value = sum / (FFT_BINS * 255);
  }

  private sparkle(at: number) {
    const ctx = this.ctx!;
    const chord = CHORDS[Math.max(0, this.chapter) % CHORDS.length];
    const note = chord[1 + Math.floor(Math.random() * (chord.length - 1))] + (Math.random() < 0.5 ? 24 : 36);
    const o = ctx.createOscillator();
    o.type = Math.random() < 0.5 ? "triangle" : "sine";
    o.frequency.value = hz(note);
    const g = ctx.createGain();
    const peak = 0.02 + Math.random() * 0.035;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 1.2 + Math.random() * 1.6);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    o.connect(g);
    g.connect(pan);
    pan.connect(this.bus);
    pan.connect(this.reverb);
    o.start(at);
    o.stop(at + 3.2);
  }

  private noiseBuffer(seconds: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let k = 0; k < len; k++) {
      // gently pinked white noise
      b = 0.97 * b + 0.03 * (Math.random() * 2 - 1);
      d[k] = b * 6;
    }
    return buf;
  }

  private impulse(seconds: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let k = 0; k < len; k++) d[k] = (Math.random() * 2 - 1) * Math.pow(1 - k / len, 3.2);
    }
    return buf;
  }
}
