// Original effects synthesized with Web Audio. No network audio or autoplay.
export class ComicSound {
  constructor(context) {
    this.context = context;
    this.enabled = true;
    this.sources = new Map();
    this.master = context.createGain();
    this.master.gain.value = 0.55;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 10;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.2;
    this.master.connect(compressor).connect(context.destination);
    this.noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    // Deterministic noise permits reproducible offline checks of the actual effects.
    let seed = 761203;
    const samples = this.noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      samples[i] = (seed / 4294967296) * 2 - 1;
    }
  }
  track(source, nodes, group) {
    this.sources.set(source, { nodes, group });
    source.onended = () => {
      source.disconnect();
      for (const node of nodes) node.disconnect();
      this.sources.delete(source);
    };
  }
  tone(frequency, duration, gain = 0.1, delay = 0, type = 'sine', endFrequency = frequency, group = 'fx') {
    if (!this.enabled) return;
    const ctx = this.context;
    const at = ctx.currentTime + delay;
    const source = ctx.createOscillator();
    const envelope = ctx.createGain();
    source.type = type;
    source.frequency.setValueAtTime(frequency, at);
    source.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), at + duration);
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(gain, at + Math.min(0.006, duration / 5));
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(envelope).connect(this.master);
    this.track(source, [envelope], group);
    source.start(at);
    source.stop(at + duration + 0.025);
  }
  hiss(frequency, duration, gain = 0.12, delay = 0, q = 0.8, group = 'fx') {
    if (!this.enabled) return;
    const ctx = this.context;
    const at = ctx.currentTime + delay;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass'; filter.frequency.value = frequency; filter.Q.value = q;
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(gain, at + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter).connect(envelope).connect(this.master);
    this.track(source, [filter, envelope], group);
    source.start(at); source.stop(at + duration + 0.025);
  }
  play(cue) {
    if (!this.enabled) return;
    if (cue === 'shatter') {
      this.tone(340, 0.13, 0.16, 0, 'triangle', 85);
      this.hiss(4200, 0.18, 0.42);
      [1431, 2249, 3491, 4711, 5857, 2867, 3953, 1709].forEach((f, i) => {
        this.tone(f, 0.28 + i * 0.04, 0.11 / (1 + i * .35), i * .023);
        this.hiss(f, 0.08, 0.08, 0.14 + i * 0.051, 2);
      });
    } else if (cue === 'phone') {
      this.stop('phone');
      for (let ring = 0; ring < 2; ring++) {
        for (let strike = 0; strike < 15; strike++) {
          const delay = ring * 1.3 + strike * .063;
          this.tone(strike % 2 ? 1590 : 1245, 0.12, 0.12, delay, 'sine', strike % 2 ? 1578 : 1239, 'phone');
          this.tone(2490, 0.075, 0.035, delay, 'triangle', 2470, 'phone');
        }
      }
    } else if (cue === 'silence') {
      this.stop('phone'); this.hiss(550, .25, .025);
    } else if (cue === 'knock' || cue === 'ladder') {
      [0, .24, ...(cue === 'ladder' ? [.65] : [])].forEach((t, i) => {
        this.tone(155 + i * 31, .17, .20, t, 'sine', 49);
        this.hiss(750, .07, .14, t, 1.7);
      });
    } else if (cue === 'attic') {
      this.hiss(380, 1.7, .06); this.tone(74, 1.5, .04, 0, 'sine', 62);
    } else if (cue === 'head') {
      this.hiss(2300, .13, .27); this.tone(290, .13, .18, 0, 'triangle', 70);
    } else if (cue === 'step') {
      this.tone(180, .2, .3, 0, 'sine', 48); this.hiss(1150, .16, .26);
    } else if (cue === 'rush') {
      this.hiss(1800, .18, .33); this.tone(320, .2, .12, 0, 'sawtooth', 680);
    } else if (cue === 'impact') {
      this.stop();
      this.tone(105, .85, .8, 0, 'sine', 31);
      this.tone(440, .48, .21, 0, 'sawtooth', 95);
      this.tone(467, .46, .16, 0, 'sawtooth', 119);
      this.hiss(1800, .7, .55);
      this.hiss(5100, .24, .32);
    }
  }
  setEnabled(enabled) {
    this.enabled = enabled;
    this.master.gain.setTargetAtTime(enabled ? .55 : 0, this.context.currentTime, .012);
    if (!enabled) this.stop();
  }
  stop(group) {
    for (const [source, value] of this.sources) {
      if (!group || value.group === group) {
        try { source.stop(); } catch { /* Already ended. */ }
        source.disconnect();
        for (const node of value.nodes) node.disconnect();
        this.sources.delete(source);
      }
    }
  }
}
