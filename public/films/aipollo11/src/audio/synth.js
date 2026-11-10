// 音づくりの道具箱：WebAudio のノードだけで楽器と打楽器を組む（音源ファイルなし）
// 時刻はすべて「全編の秒」＝ OfflineAudioContext の時刻。

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** 音名（'C4' 'F#3' 'Bb2'）→ MIDI 番号 */
export function nn(s) {
  if (typeof s === 'number') return s;
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(s);
  return SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) + 1) * 12;
}
export const hz = (note) => 440 * Math.pow(2, (nn(note) - 69) / 12);
export const db = (d) => Math.pow(10, d / 20);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export class Kit {
  constructor(ctx, dur, seed = 1969, dbg = {}) {
    this.ctx = ctx; this.dur = dur; this.sr = ctx.sampleRate; this.rnd = mulberry(seed); this.dbg = dbg;
    this.nz = { white: this._noise('white'), pink: this._noise('pink'), brown: this._noise('brown') };
    this.nzM = {};
    for (const k in this.nz) { const b = this.nz[k], m = ctx.createBuffer(1, b.length, this.sr); m.copyToChannel(b.getChannelData(0), 0); this.nzM[k] = m; }
    this.crackle = this._crackle();
    this.out = this.g(1);
    this.musicBus = this.g(1); this.duckNode = this.g(1); this.sfxBus = this.g(1); this.ambBus = this.g(1);
    this.musicBus.connect(this.duckNode); this.duckNode.connect(this.out); this.sfxBus.connect(this.out); this.ambBus.connect(this.out);
    this.hall = this._reverb(3.0, 0.014, 0.54, 11);
    this.room = this._reverb(0.55, 0.003, 0.5, 29, { decay: 6.4, bright: [0.9, 1.0, 0.2], hp: 220, early: 14, span: 0.045 });
    {
      const cin = this.g(1), lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 2600; cin.connect(this.hall.in); cin.connect(lp);
      for (const [d, lv] of [[0.293, 0.55], [0.611, 0.34], [0.947, 0.2], [1.31, 0.11]]) { const dl = ctx.createDelay(1.5), g = this.g(lv); dl.delayTime.value = d; lp.connect(dl); dl.connect(g); g.connect(this.hall.in); }
      this.cath = { in: cin };
    }
    // マスター：超低域カット → 空気感の棚 → ゆるいコンプレッサー
    // （WebAudio の lowpass / highpass の Q は dB 表記。−3 dB で、こぶのない素直な切れ方になる）
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 32; hp.Q.value = -3;
    const hp2 = ctx.createBiquadFilter(); hp2.type = 'highpass'; hp2.frequency.value = 32; hp2.Q.value = -3;
    const air = ctx.createBiquadFilter(); air.type = 'highshelf'; air.frequency.value = 6500; air.gain.value = 2;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -19; comp.knee.value = 14; comp.ratio.value = 2.2; comp.attack.value = 0.025; comp.release.value = 0.3;
    this.out.connect(hp); hp.connect(hp2); hp2.connect(air);
    if (dbg.noComp) air.connect(ctx.destination); else { air.connect(comp); comp.connect(ctx.destination); }
    this.strips = new Map(); this.ducks = []; this.waves = {};
    // ひずみ（tanh）の曲線
    const n = 2048, c1 = new Float32Array(n), c2 = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c1[i] = Math.tanh(x * 2.2) / Math.tanh(2.2); c2[i] = Math.tanh(x * 7) / Math.tanh(7); }
    this.curveSoft = c1; this.curveHard = c2;
    // ---- 発音の予約：ノードを最初に全部つなぐと合成が極端に遅くなるので、
    //      「鳴る直前」に作る。楽器の関数は呼ばれた時点では予約だけして、合成が進んだら実行する。
    this.events = []; this.live = false; this._gc = [];
    const VOICES = ['tone', 'nzv', 'mbox', 'celesta', 'marimba', 'pizz', 'sq', 'bell', 'gbass', 'brass', 'strings', 'choir', 'pad', 'lead', 'sub',
      'timp', 'timpRoll', 'kick', 'snare', 'snareRoll', 'hat', 'clap', 'wood', 'shaker', 'crash', 'boomSub'];
    const LOOSE = { mbox: 0.004, celesta: 0.004, marimba: 0.004, pizz: 0.005, bell: 0.004 };
    for (const name of VOICES) {
      const f = this[name].bind(this), loose = LOOSE[name];
      this[name] = (dest, T, ...rest) => {
        if (this.live) return f(dest, T, ...rest);
        if (loose && T > 0.05) { const h = Math.sin(T * 127.1 + nn(rest[0]) * 311.7) * 43758.5453; T += (h - Math.floor(h) - 0.5) * 2 * loose; }
        this.defer(T, () => f(dest, T, ...rest));
        return undefined;
      };
    }
    const sw = this.swell.bind(this);
    this.swell = (dest, T, len = 1.2, ...rest) => { if (this.live) return sw(dest, T, len, ...rest); this.defer(T - len, () => sw(dest, T, len, ...rest)); return undefined; };
  }
  /** 鳴り終わったノードを合成グラフから外す予約（外さないと、無音でも最後まで計算され続けて遅くなる） */
  gc(node, stop) { this._gc.push([stop, node]); }
  /** 時刻 t の直前に fn を実行する（fn の中で実際のノードを作る） */
  defer(t, fn) { if (this.live) { fn(); return; } this.events.push({ t: Math.max(0, t) - 0.002, i: this.events.length, fn }); }
  /** 予約した発音を、合成の進みに合わせて少しずつ作る（OfflineAudioContext を小刻みに止めて足す） */
  schedule() {
    let ev = this.events.sort((a, b) => a.t - b.t || a.i - b.i);
    const ctx = this.ctx;
    if (this.dbg.from !== undefined) ev = ev.filter((e) => e.t >= this.dbg.from && e.t < this.dbg.to);
    const step = 1.5, look = 0.1, q = 128 / this.sr;
    let idx = 0;
    const pump = (now) => {
      const keep = [];
      for (const e of this._gc) { if (e[0] < now - 0.02) { try { e[1].disconnect(); } catch { /* すでに外れている */ } } else keep.push(e); }
      this._gc = keep;
      this.live = true;
      while (idx < ev.length && ev[idx].t < now + step + look) {
        try { ev[idx].fn(); } catch (e) { if (!this._warned) { this._warned = true; console.warn('[audio] 発音を 1 つ飛ばしました:', e); } }
        idx++;
      }
      this.live = false;
    };
    pump(0);
    for (let t = step; t < this.dur - q; t += step) { const ts = Math.floor(t / q) * q; ctx.suspend(ts).then(() => { try { pump(ts); } finally { ctx.resume(); } }); }
    return ev.length;
  }

  // ---------- 基本
  g(v = 1) { const n = this.ctx.createGain(); n.gain.value = v; return n; }
  T(t) { return Math.max(0, t); }
  _noise(kind) {
    const sr = this.sr, len = Math.floor(sr * 5), b = this.ctx.createBuffer(2, len, sr), r = this.rnd;
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      if (kind === 'white') { for (let i = 0; i < len; i++) d[i] = r() * 2 - 1; }
      else if (kind === 'pink') {
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (let i = 0; i < len; i++) {
          const w = r() * 2 - 1;
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
        }
      } else { let y = 0; for (let i = 0; i < len; i++) { y = (y + 0.02 * (r() * 2 - 1)) / 1.02; d[i] = y * 3.5; } }
      // つなぎ目を目立たなくする
      const f = Math.floor(sr * 0.05);
      for (let i = 0; i < f; i++) { const k = i / f; d[i] = d[i] * k + d[len - f + i] * (1 - k); }
    }
    return b;
  }
  /** ばりばり（ロケットの轟音の粒立ち）用の変調波形 */
  _crackle() {
    const sr = this.sr, len = Math.floor(sr * 6), b = this.ctx.createBuffer(1, len, sr), d = b.getChannelData(0), r = this.rnd;
    let i = 0, y = 0;
    while (i < len) {
      const hold = Math.floor(sr * (0.002 + Math.pow(r(), 2.5) * 0.03));
      const v = Math.pow(r(), 3.2) * 2.4;
      for (let k = 0; k < hold && i < len; k++, i++) { y += (v - y) * 0.35; d[i] = y; }
    }
    return b;
  }
  /** 残響（雑音に減衰と、だんだん暗くなる濾波をかけた手づくりの響き） */
  _reverb(sec, pre, level, seed, o = {}) {
    const ctx = this.ctx, sr = this.sr, len = Math.floor(sr * sec), b = ctx.createBuffer(2, len, sr), r = mulberry(seed);
    const p0 = Math.floor(pre * sr), B = o.bright || [0.85, 1.6, 0.1];
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let y = 0;
      for (let i = p0; i < len; i++) {
        const t = (i - p0) / sr, k = t / sec;
        const a = B[0] * Math.pow(1 - k, B[1]) + B[2];
        y += a * ((r() * 2 - 1) - y);
        d[i] = y * Math.exp(-(o.decay ?? 6.8) * k) * (1 - Math.exp(-t * 90));
      }
      for (let e = 0; e < (o.early ?? 7); e++) { const i = p0 + Math.floor(sr * (0.004 + r() * (o.span ?? 0.07))); d[i] += (r() * 2 - 1) * 0.5; }
    }
    const inp = this.g(1), ret = this.g(level);
    if (this.dbg.noReverb) return { in: inp, ret };
    const conv = ctx.createConvolver(); conv.buffer = b;
    const lc = ctx.createBiquadFilter(); lc.type = 'highpass'; lc.frequency.value = o.hp ?? 140;
    inp.connect(lc); lc.connect(conv); conv.connect(ret); ret.connect(this.out);
    return { in: inp, ret };
  }
  /**
   * 楽器ごとの通り道（定位と残響の量）。同じ key は使い回す。
   * 入口のチャンネル数は固定する。固定しないと、ステレオの雑音が鳴っている間だけ定位の計算式が切り替わり、
   * 同じ通り道の音がいっせいに 3 dB 跳ねる（ぷつっという段差になる）。
   *   既定      … モノラルの入口 → 定位（等パワー）
   *   o.stereo  … ステレオのまま通す（轟音や空気感の、左右の広がりを残す）
   *   o.spread  … 中央のほかに左・右の入口（.L / .R）を持つ。重ねた発振器を左右に振り分けて、合奏の広がりを出す
   */
  strip(key, o = {}) {
    let s = this.strips.get(key);
    if (s) return s;
    const ctx = this.ctx, outs = [];
    const mono = (pan) => {
      const inp = this.g(o.gain ?? 1), pn = ctx.createStereoPanner();
      inp.channelCountMode = 'explicit'; inp.channelCount = 1;
      pn.pan.value = clamp(pan, -1, 1);
      inp.connect(pn); outs.push(pn);
      return inp;
    };
    let inp;
    if (o.stereo) {
      inp = this.g((o.gain ?? 1) * Math.SQRT1_2); inp.channelCountMode = 'explicit'; inp.channelCount = 2; inp._stereo = true; outs.push(inp);
    } else {
      inp = mono(o.pan ?? 0);
      if (o.spread) { inp.L = mono((o.pan ?? 0) - o.spread); inp.R = mono((o.pan ?? 0) + o.spread); }
    }
    let post = outs[0];
    if (outs.length > 1) { post = this.g(1); for (const n of outs) n.connect(post); }
    post.connect(o.dest || this[(o.bus || 'music') + 'Bus']);
    if (o.hall) { const sg = this.g(o.hall); post.connect(sg); sg.connect(this.hall.in); }
    if (o.cath) { const sg = this.g(o.cath); post.connect(sg); sg.connect(this.cath.in); }
    if (o.room) { const sg = this.g(o.room); post.connect(sg); sg.connect(this.room.in); }
    this.strips.set(key, inp);
    // 場面が終わったら、その場面専用の通り道ごと外す
    if (o.until !== undefined) this.gc(post, o.until);
    return inp;
  }
  /** 1 音ずつ鳴らす楽器の置き場所：広がりのある通り道なら、音名ごとに左・中央・右へ散らす */
  at(dest, note) { if (!dest.L) return dest; const k = 'LRLRCCLRLRCC'[((Math.round(nn(note)) % 12) + 12) % 12]; return k === 'L' ? dest.L : k === 'R' ? dest.R : dest; }
  /** 重ねる発振器の振り分け先：広がりのある通り道なら a を左・b を右へ、そうでなければ全部を中央へ */
  sides(dest, a, b) { return dest.L ? [[dest.L, a, Math.SQRT1_2], [dest.R, b, Math.SQRT1_2]] : [[dest, [...a, ...b], 1]]; }
  /** 打楽器・撥弦の包絡（すぐ立ち上がって減衰） */
  perc(p, T, peak, decay, a = 0.002) { p.setValueAtTime(0, T); p.linearRampToValueAtTime(peak, T + a); p.setTargetAtTime(0, T + a, decay / 4.6); return T + a + decay * 1.5 + 0.02; }
  /** のびる音の包絡。戻り値は発音を止めてよい時刻 */
  adsr(p, T, dur, peak, a = 0.01, d = 0.1, s = 0.8, r = 0.15) {
    p.setValueAtTime(0, T); p.linearRampToValueAtTime(peak, T + a); p.setTargetAtTime(peak * s, T + a, d / 3);
    const off = T + Math.max(dur, a + 0.005);
    p.setTargetAtTime(0, off, r / 4);
    return off + r * 1.7 + 0.02;
  }
  wave(name) {
    if (this.waves[name]) return this.waves[name];
    const N = 48, re = new Float32Array(N), im = new Float32Array(N);
    if (name.startsWith('pulse')) { const D = Number(name.slice(5)) / 100; for (let n = 1; n < N; n++) re[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * D); }
    else if (name === 'organ') { [1, 0.5, 0.3, 0.12, 0.08, 0.05, 0.03, 0.02].forEach((v, i) => { im[i + 1] = v; }); }
    else if (name === 'soft') { for (let n = 1; n < N; n++) im[n] = 1 / Math.pow(n, 1.7); }
    return (this.waves[name] = this.ctx.createPeriodicWave(re, im));
  }
  /** 発振器 1 本。o: {type|wave, f, f1, ft, detune, vib:[深さcent,速さHz,遅れs]} */
  osc(dest, T, stop, o) {
    const ctx = this.ctx, os = ctx.createOscillator();
    if (o.wave) os.setPeriodicWave(this.wave(o.wave)); else os.type = o.type || 'sine';
    os.frequency.setValueAtTime(o.f, T);
    if (o.f1) os.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), T + (o.ft ?? 0.1));
    if (o.detune) os.detune.value = o.detune;
    if (o.vib) { const l = ctx.createOscillator(), lg = this.g(0); l.frequency.value = o.vib[1]; lg.gain.setValueAtTime(0, T); lg.gain.linearRampToValueAtTime(o.f * (Math.pow(2, o.vib[0] / 1200) - 1), T + (o.vib[2] ?? 0.2) + 0.25); l.connect(lg); lg.connect(os.frequency); l.start(T); l.stop(stop); }
    os.connect(dest); os.start(T); os.stop(stop);
    return os;
  }
  /** 音程のある 1 音（発振器 → 包絡）。o: osc の指定 + {peak, decay | (dur,a,d,s,r)} */
  tone(dest, T, o) {
    T = this.T(T);
    const g = this.g(0); g.connect(dest);
    const stop = o.decay ? this.perc(g.gain, T, o.peak ?? 0.5, o.decay, o.a ?? 0.002) : this.adsr(g.gain, T, o.dur ?? 0.2, o.peak ?? 0.5, o.a, o.d, o.s, o.r);
    this.gc(g, stop);
    this.osc(g, T, stop, o);
    return g;
  }
  /** 雑音 1 発。o: {kind, ftype, f, f1, q, peak, decay | (dur,a,r), mod:[深さ,速さ]} */
  nzv(dest, T, o) {
    T = this.T(T);
    const ctx = this.ctx, src = ctx.createBufferSource();
    src.buffer = (dest._stereo ? this.nz : this.nzM)[o.kind || 'white']; src.loop = true;
    const dur = o.dur ?? 0.2, pk = (o.peak ?? 0.5) * Math.SQRT2;
    let node = src, lfo = null;
    if (o.f) {
      const fl = ctx.createBiquadFilter(); fl.type = o.ftype || 'bandpass'; fl.Q.value = o.q ?? 1;
      fl.frequency.setValueAtTime(o.f, T);
      if (o.f1) fl.frequency.exponentialRampToValueAtTime(o.f1, T + (o.ft ?? (o.decay ?? dur)));
      if (o.f2) fl.frequency.exponentialRampToValueAtTime(o.f2, T + (o.decay ?? dur));
      node.connect(fl); node = fl;
    }
    if (o.hp) { const h = ctx.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = o.hp; node.connect(h); node = h; }
    // ゆらぎは包絡の手前でかける（包絡が 0 になれば、ゆらぎごと消える）
    if (o.mod) { const tg = this.g(1), lg = this.g(o.mod[0]); lfo = ctx.createOscillator(); lfo.frequency.value = o.mod[1]; lfo.connect(lg); lg.connect(tg.gain); node.connect(tg); node = tg; }
    const g = this.g(0); node.connect(g); g.connect(dest);
    const stop = o.decay ? this.perc(g.gain, T, pk, o.decay, o.a ?? 0.002) : this.adsr(g.gain, T, dur, pk, o.a ?? 0.03, 0.05, 1, o.r ?? 0.12);
    this.gc(g, stop);
    if (lfo) { lfo.start(T); lfo.stop(stop); }
    src.start(T, this.rnd() * 4); src.stop(stop);
    return { g, node };
  }
  /** 音楽を一時的に下げる（大きな効果音の下にもぐらせる） */
  duck(T, depthDb, hold = 0.5, attack = 0.08, release = 0.6) { this.ducks.push([T, depthDb, hold, attack, release]); }
  applyDucks() {
    const hz = 100, n = Math.ceil(this.dur * hz) + 2, c = new Float32Array(n).fill(1);
    for (const [T, depth, hold, att, rel] of this.ducks) {
      const g = db(-Math.abs(depth));
      for (let i = Math.max(0, Math.floor((T - att) * hz)); i < n && i / hz < T + hold + rel; i++) {
        const t = i / hz;
        const k = t < T ? (t - (T - att)) / att : t < T + hold ? 1 : 1 - (t - T - hold) / rel;
        const v = 1 - (1 - g) * (k * k * (3 - 2 * k));
        if (v < c[i]) c[i] = v;
      }
    }
    const p = this.duckNode.gain;
    let on = false;
    for (let i = 1; i < n - 1; i++) {
      const t = i / hz;
      if (c[i] < 0.9995 || c[i + 1] < 0.9995) { if (!on) { p.setValueAtTime(1, (i - 1) / hz); on = true; } p.linearRampToValueAtTime(c[i], t); }
      else if (on) { p.linearRampToValueAtTime(1, t); on = false; }
    }
  }

  // ---------- 楽器
  /** オルゴール／チェレスタ風 */
  mbox(dest, T, note, vel = 0.5, bright = 1) {
    const f = hz(note); dest = this.at(dest, note);
    this.tone(dest, T, { f, peak: vel * 0.5, decay: 1.5 });
    this.tone(dest, T, { f: f * 2.76, peak: vel * 0.16 * bright, decay: 0.45 });
    this.tone(dest, T, { f: f * 5.4, peak: vel * 0.07 * bright, decay: 0.16 });
    if (f * 8.93 < 15000) this.tone(dest, T, { f: f * 8.93, peak: vel * 0.035 * bright, decay: 0.07 });
    this.nzv(dest, T, { f: Math.min(9000, 3500 + f * 2), q: 1.2, peak: vel * 0.05 * bright, decay: 0.014, a: 0.001 });   // 櫛歯をはじく音
  }
  celesta(dest, T, note, vel = 0.5) {
    const f = hz(note); dest = this.at(dest, note);
    this.tone(dest, T, { f, peak: vel * 0.45, decay: 1.2, a: 0.004 });
    this.tone(dest, T, { f: f * 2, peak: vel * 0.12, decay: 0.7 });
    this.tone(dest, T, { f: f * 4.02, peak: vel * 0.07, decay: 0.3 });
    if (f * 6.3 < 15000) this.tone(dest, T, { f: f * 6.3, peak: vel * 0.03, decay: 0.09 });
    this.nzv(dest, T, { f: 5000, q: 1, peak: vel * 0.03, decay: 0.012, a: 0.001 });   // 槌が当たる音
  }
  marimba(dest, T, note, vel = 0.5) {
    const f = hz(note); dest = this.at(dest, note);
    this.tone(dest, T, { f, peak: vel * 0.6, decay: 0.42 });
    this.tone(dest, T, { f: f * 4, peak: vel * 0.16, decay: 0.09 });
    this.tone(dest, T, { f: f * 9.2, peak: vel * 0.05, decay: 0.04 });
  }
  /** ピチカート／つまびく弦 */
  pizz(dest, T, note, vel = 0.5, decay = 0.28) {
    T = this.T(T); dest = this.at(dest, note);
    const ctx = this.ctx, f = hz(note), fl = ctx.createBiquadFilter(), g = this.g(0);
    fl.type = 'lowpass'; fl.Q.value = 1.2;
    fl.frequency.setValueAtTime(Math.min(9000, f * 9), T); fl.frequency.setTargetAtTime(f * 1.6, T, decay / 5);
    fl.connect(g); g.connect(dest);
    const stop = this.perc(g.gain, T, vel * 0.55, decay, 0.003);
    this.gc(g, stop);
    this.osc(fl, T, stop, { type: 'sawtooth', f });
    this.osc(fl, T, stop, { type: 'triangle', f, detune: 4 });
  }
  /** 矩形波（チップチューン風）。GPT の音色 */
  sq(dest, T, note, dur = 0.1, vel = 0.4, duty = 25) {
    T = this.T(T); dest = this.at(dest, note);
    const g = this.g(0), lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200;
    lp.connect(g); g.connect(dest);
    const stop = this.adsr(g.gain, T, dur, vel * 0.3, 0.003, 0.05, 0.6, 0.04);
    this.gc(g, stop);
    this.osc(lp, T, stop, { wave: 'pulse' + duty, f: hz(note) });
  }
  /** ガラスのような鐘（FM）。Gemini の音色 */
  bell(dest, T, note, vel = 0.5, decay = 1.4, ratio = 3.5) {
    T = this.T(T); dest = this.at(dest, note);
    const ctx = this.ctx, f = hz(note), g = this.g(0), car = ctx.createOscillator(), mod = ctx.createOscillator(), mg = this.g(0);
    g.connect(dest);
    const stop = this.perc(g.gain, T, vel * 0.4, decay, 0.002);
    this.gc(g, stop);
    car.frequency.value = f; mod.frequency.value = f * ratio;
    mg.gain.setValueAtTime(f * 2.4, T); mg.gain.setTargetAtTime(f * 0.15, T, decay / 6);
    mod.connect(mg); mg.connect(car.frequency); car.connect(g);
    car.start(T); mod.start(T); car.stop(stop); mod.stop(stop);
    this.tone(dest, T, { f: f * 2, peak: vel * 0.08, decay: decay * 0.6 });
  }
  /** ひずんだ低音（ゴムまりのように弾む）。Grok の音色 */
  gbass(dest, T, note, dur = 0.2, vel = 0.6, hard = false) {
    T = this.T(T);
    const ctx = this.ctx, f = hz(note), fl = ctx.createBiquadFilter(), ws = ctx.createWaveShaper(), g = this.g(0), pre = this.g(hard ? 2.2 : 1.2);
    fl.type = 'lowpass'; fl.Q.value = 7;
    fl.frequency.setValueAtTime(f * 12, T); fl.frequency.setTargetAtTime(f * 2.4, T, 0.07);
    ws.curve = hard ? this.curveHard : this.curveSoft; ws.oversample = hard ? '2x' : 'none';
    const post = ctx.createBiquadFilter(); post.type = 'lowpass'; post.frequency.value = hard ? 2800 : 3600; post.Q.value = -2;
    pre.connect(fl); fl.connect(ws); ws.connect(post); post.connect(g); g.connect(dest);
    const stop = this.adsr(g.gain, T, dur, vel * 0.42, 0.004, 0.08, 0.75, 0.05);
    this.gc(g, stop);
    this.osc(pre, T, stop, { type: 'sawtooth', f: f * 0.84, f1: f, ft: 0.05 });
    if (f >= 70) { const sg = this.g(0.3); sg.connect(pre); this.osc(sg, T, stop, { wave: 'pulse50', f: f * 0.5 * 0.84, f1: f * 0.5, ft: 0.05 }); }
  }
  /** 金管ふう（のこぎり波の重ね＋開いていくフィルター）。notes は和音でもよい */
  brass(dest, T, dur, notes, vel = 0.5, o = {}) {
    T = this.T(T);
    const ctx = this.ctx, br = o.bright ?? 1, top = 3000 * br * (0.55 + vel);
    for (const [out, specs] of this.sides(dest, [[-6, [9, 5.2, 0.25]]], [[7, null]])) {
      const fl = ctx.createBiquadFilter(), g = this.g(0);
      fl.type = 'lowpass'; fl.Q.value = 0.9;
      fl.frequency.setValueAtTime(380, T); fl.frequency.linearRampToValueAtTime(top, T + (o.a ?? 0.06) + 0.03); fl.frequency.setTargetAtTime(top * 0.62, T + 0.12, 0.25);
      fl.connect(g); g.connect(out);
      const stop = this.adsr(g.gain, T, dur, vel * 0.3 / Math.sqrt(notes.length), o.a ?? 0.05, 0.12, 0.85, o.r ?? 0.16);
      this.gc(g, stop);
      const ft = Math.min(0.045, dur * 0.3);
      for (const nt of notes) for (const [det, vib] of specs) { const f = hz(nt); this.osc(fl, T, stop, { type: 'sawtooth', f: f * 0.986, f1: f, ft, detune: det, vib: vib || undefined }); }
      this.nzv(out, T, { f: 1700, q: 0.8, peak: vel * 0.035, decay: 0.07, a: 0.008 });
    }
  }
  /** 弦楽ふう（ゆっくり立ち上がる）。o: {a, r, trem(Hz), bright, stac} */
  strings(dest, T, dur, notes, vel = 0.5, o = {}) {
    T = this.T(T);
    const ctx = this.ctx, br = o.bright ?? 1, rich = !o.stac && dur > 0.35;
    const pk = vel * 0.26 / Math.sqrt(notes.length) * (rich ? Math.SQRT1_2 : 1);
    let lfo = null, end = T;
    // 広がりのある通り道では、高い音は左右に分け、低い音（ド3 より下）は中央にまとめる（低音が左右に割れないように）
    const dA = rich ? [-14, 4] : [-9], dB = rich ? [-5, 12] : [8];
    const low = dest.L ? notes.filter((n) => nn(n) < 50) : [], high = dest.L ? notes.filter((n) => nn(n) >= 50) : notes;
    const chains = dest.L ? [[dest.L, dA, high], [dest.R, dB, high], [dest, [...dA, ...dB], low]] : [[dest, [...dA, ...dB], notes]];
    for (const [out, dets, ns] of chains) {
      if (!ns.length) continue;
      const fl = ctx.createBiquadFilter(), hp = ctx.createBiquadFilter(), g = this.g(0);
      fl.type = 'lowpass'; fl.frequency.value = 3300 * br; fl.Q.value = 0.5;
      hp.type = 'highpass'; hp.frequency.value = 110;
      fl.connect(hp);
      let node = hp;
      // 弓をふるわせる（トレモロ）。包絡の手前でかける
      if (o.trem) { const tg = this.g(1), lg = this.g(0.45); if (!lfo) { lfo = ctx.createOscillator(); lfo.frequency.value = o.trem; } lfo.connect(lg); lg.connect(tg.gain); hp.connect(tg); node = tg; }
      node.connect(g); g.connect(out);
      const stop = o.stac ? this.perc(g.gain, T, pk * 1.5, o.stac, 0.012) : this.adsr(g.gain, T, dur, pk, o.a ?? 0.3, 0.2, 0.9, o.r ?? 0.5);
      this.gc(g, stop); end = stop;
      // のびる音には、弓のこすれる息づかいをごく小さく足す
      if (!o.stac && dur > 0.5) {
        const bs = ctx.createBufferSource(), nf = ctx.createBiquadFilter(), ng = this.g(0.0425 * Math.sqrt(ns.length * dets.length) * br);
        bs.buffer = this.nzM.white; bs.loop = true; nf.type = 'bandpass'; nf.frequency.value = 6000; nf.Q.value = 0.6;
        bs.connect(nf); nf.connect(ng); ng.connect(g); bs.start(T, this.rnd() * 4); bs.stop(stop);
      }
      for (const nt of ns) for (const det of dets) this.osc(fl, T, stop, { type: 'sawtooth', f: hz(nt), detune: det });
    }
    if (lfo) { lfo.start(T); lfo.stop(end); }
  }
  /** 合唱ふう（「アー」の響き：共鳴帯を 3 つ） */
  choir(dest, T, dur, notes, vel = 0.4, vowel = 'a') {
    T = this.T(T);
    const ctx = this.ctx;
    const F = vowel === 'o' ? [[420, 1.0], [820, 0.5], [2700, 0.12]] : [[760, 1.0], [1180, 0.6], [2850, 0.18]];
    for (const [out, specs, share] of this.sides(dest, [[-11, [14, 5.5, 0.5]]], [[9, [10, 4.9, 0.65]]])) {
      const g = this.g(0), mix = this.g(1);
      for (const [fc, lv] of F) { const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = fc; b.Q.value = 6; const bg = this.g(lv); mix.connect(b); b.connect(bg); bg.connect(g); }
      g.connect(out);
      const stop = this.adsr(g.gain, T, dur, vel * 0.9 / Math.sqrt(notes.length), 0.45, 0.3, 0.9, 0.6);
      this.gc(g, stop);
      for (const nt of notes) for (const [det, vib] of specs) this.osc(mix, T, stop, { type: 'sawtooth', f: hz(nt), detune: det, vib });
      // 息の成分
      const bn = ctx.createBufferSource(), bf = ctx.createBiquadFilter(), bg = this.g(0.035 * Math.sqrt(notes.length) * share);
      bn.buffer = this.nzM.white; bn.loop = true; bf.type = 'bandpass'; bf.frequency.value = 5200; bf.Q.value = 0.8;
      bn.connect(bf); bf.connect(bg); bg.connect(g); bn.start(T, this.rnd() * 4); bn.stop(stop);
    }
  }
  /** やわらかいパッド */
  pad(dest, T, dur, notes, vel = 0.4, o = {}) {
    T = this.T(T);
    const ctx = this.ctx;
    for (const [out, dets, share] of this.sides(dest, [-7], [6])) {
      const fl = ctx.createBiquadFilter(), g = this.g(0), og = this.g(share < 1 ? 0.6 : 1);
      fl.type = 'lowpass'; fl.Q.value = 0.4;
      fl.frequency.setValueAtTime(o.f0 ?? 600, T); fl.frequency.linearRampToValueAtTime(o.f1 ?? 1700, T + dur * 0.6);
      fl.connect(g); g.connect(out); og.connect(fl);
      const stop = this.adsr(g.gain, T, dur, vel * 0.22 / Math.sqrt(notes.length), o.a ?? 1.2, 0.3, 0.9, o.r ?? 1.6);
      this.gc(g, stop);
      for (const nt of notes) {
        const f = hz(nt);
        for (const det of dets) this.osc(fl, T, stop, { wave: 'soft', f, detune: det });
        this.osc(og, T, stop, { type: 'sine', f: f * 2, detune: share < 1 ? dets[0] * 0.5 : 3 });   // 1 オクターブ上をうっすら
      }
    }
  }
  /** リード（のこぎり＋矩形）。モンタージュの主旋律 */
  lead(dest, T, dur, note, vel = 0.5) {
    T = this.T(T);
    const ctx = this.ctx, fl = ctx.createBiquadFilter(), g = this.g(0), f = hz(note);
    fl.type = 'lowpass'; fl.Q.value = 2; fl.frequency.setValueAtTime(900, T); fl.frequency.linearRampToValueAtTime(3800, T + 0.05); fl.frequency.setTargetAtTime(2200, T + 0.05, 0.2);
    fl.connect(g); g.connect(dest);
    const stop = this.adsr(g.gain, T, dur, vel * 0.22, 0.012, 0.1, 0.8, 0.1);
    this.gc(g, stop);
    this.osc(fl, T, stop, { type: 'sawtooth', f, detune: -8, vib: [10, 5.5, 0.18] });
    this.osc(fl, T, stop, { wave: 'pulse35', f, detune: 7 });
  }
  /** 低い正弦波の土台 */
  sub(dest, T, dur, note, vel = 0.5, a = 0.05, r = 0.3) {
    T = this.T(T);
    const g = this.g(0); g.connect(dest);
    const stop = this.adsr(g.gain, T, dur, vel * 0.5, a, 0.1, 1, r);
    this.gc(g, stop);
    const f = hz(note), h = this.g(f < 60 ? 0.9 : 0.45), s0 = this.g(f < 45 ? 0.5 : 0.8);
    h.connect(g); s0.connect(g);
    this.osc(s0, T, stop, { type: 'sine', f });
    this.osc(h, T, stop, { wave: 'organ', f: f * 2, detune: 3 });
    return g;
  }
  // ---------- 打楽器
  timp(dest, T, note, vel = 0.7) {
    T = this.T(T);
    const f = hz(note);
    this.tone(dest, T, { f: f * 1.5, f1: f, ft: 0.04, peak: vel * 0.75, decay: 1.3, a: 0.003 });
    this.tone(dest, T, { f: f * 1.5, peak: vel * 0.2, decay: 0.7 });
    this.tone(dest, T, { f: f * 1.99, peak: vel * 0.12, decay: 0.45 });
    this.nzv(dest, T, { kind: 'pink', ftype: 'lowpass', f: 420, peak: vel * 0.5, decay: 0.09 });
  }
  timpRoll(dest, T, dur, note, v0 = 0.15, v1 = 0.7, rate = 17) {
    const n = Math.floor(dur * rate);
    for (let i = 0; i < n; i++) { const k = i / Math.max(1, n - 1); this.timp(dest, T + i / rate + (this.rnd() - 0.5) * 0.008, note, v0 + (v1 - v0) * k * k); }
  }
  kick(dest, T, vel = 0.8) {
    T = this.T(T);
    this.tone(dest, T, { f: 150, f1: 46, ft: 0.11, peak: vel * 0.9, decay: 0.3, a: 0.001 });
    this.nzv(dest, T, { ftype: 'lowpass', f: 2500, peak: vel * 0.2, decay: 0.015 });
  }
  snare(dest, T, vel = 0.6) {
    T = this.T(T);
    this.nzv(dest, T, { ftype: 'highpass', f: 1400, peak: vel * 0.45, decay: 0.16 });
    this.tone(dest, T, { type: 'triangle', f: 230, f1: 170, ft: 0.05, peak: vel * 0.35, decay: 0.09 });
  }
  snareRoll(dest, T, dur, v0 = 0.08, v1 = 0.6, rate = 24) {
    const n = Math.floor(dur * rate);
    for (let i = 0; i < n; i++) { const k = i / Math.max(1, n - 1); this.snare(dest, T + i / rate + (this.rnd() - 0.5) * 0.006, v0 + (v1 - v0) * k * k); }
  }
  hat(dest, T, vel = 0.3, open = false) { this.nzv(dest, T, { ftype: 'highpass', f: 7500, peak: vel * 0.3, decay: open ? 0.22 : 0.035 }); }
  clap(dest, T, vel = 0.5) { for (let i = 0; i < 3; i++) this.nzv(dest, T + i * 0.011, { f: 1500, q: 1.2, peak: vel * 0.3, decay: i === 2 ? 0.14 : 0.02 }); }
  wood(dest, T, f = 820, vel = 0.4) { this.tone(dest, T, { f, peak: vel * 0.5, decay: 0.06 }); this.tone(dest, T, { f: f * 2.4, peak: vel * 0.2, decay: 0.03 }); }
  shaker(dest, T, vel = 0.2) { this.nzv(dest, T, { f: 6500, q: 1.5, peak: vel * 0.25, decay: 0.05, a: 0.01 }); }
  crash(dest, T, vel = 0.6, decay = 1.8) {
    this.nzv(dest, T, { ftype: 'highpass', f: 4200, peak: vel * 0.4, decay });
    this.nzv(dest, T, { f: 9000, q: 0.8, peak: vel * 0.25, decay: decay * 0.6 });
  }
  /** だんだん大きくなる（逆シンバル）。T は山の時刻 */
  swell(dest, T, len = 1.2, vel = 0.4, f = 5000) {
    const t0 = this.T(T - len), ctx = this.ctx, src = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = this.g(0);
    src.buffer = (dest._stereo ? this.nz : this.nzM).white; src.loop = true; fl.type = 'highpass'; fl.frequency.setValueAtTime(f * 0.4, t0); fl.frequency.exponentialRampToValueAtTime(f, T);
    src.connect(fl); fl.connect(g); g.connect(dest);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vel * 0.4 * Math.SQRT2, T); g.gain.setTargetAtTime(0, T, 0.03);
    src.start(t0, this.rnd() * 4); src.stop(T + 0.3);
    this.gc(g, T + 0.35);
  }
  /** 腹にひびく低い一撃 */
  boomSub(dest, T, vel = 0.8, decay = 1.4, f0 = 95, f1 = 30) { this.tone(dest, T, { f: f0, f1, ft: decay * 0.5, peak: vel, decay, a: 0.004 }); }
}
export { clamp };
