// 効果音：カットが出す合図（film.cues）ごとに、発振器と雑音から音を合成する
import { hz } from './synth.js';

export function buildSfx(K, film) {
  const ctx = K.ctx, r = K.rnd, shots = film.shots || [], cues = film.cues || [];
  const C = K.strip('sfx.c', { bus: 'sfx', hall: 0.08, room: 0.14, gain: 1.3 });
  const Lf = K.strip('sfx.l', { bus: 'sfx', pan: -0.5, hall: 0.08, room: 0.14, gain: 1.3 });
  const Rt = K.strip('sfx.r', { bus: 'sfx', pan: 0.5, hall: 0.08, room: 0.14, gain: 1.3 });
  const Dry = K.strip('sfx.dry', { bus: 'sfx', gain: 1.3 });
  const Big = K.strip('sfx.big', { bus: 'sfx', hall: 0.22, cath: 0.16, stereo: true });
  const Amb = K.strip('amb.c', { bus: 'amb', hall: 0.05, gain: 1.4, stereo: true });
  const AmbL = K.strip('amb.l', { bus: 'amb', pan: -0.7, hall: 0.06, gain: 1.4 });
  const AmbR = K.strip('amb.r', { bus: 'amb', pan: 0.7, hall: 0.06, gain: 1.4 });
  // 無線・テレビのスピーカーを通した音
  const Radio = K.g(1);
  {
    const h = ctx.createBiquadFilter(), l = ctx.createBiquadFilter();
    h.type = 'highpass'; h.frequency.value = 350; h.Q.value = -3; l.type = 'lowpass'; l.frequency.value = 3300; l.Q.value = -1;
    Radio.connect(h); h.connect(l); l.connect(Dry);
  }
  const side = () => (r() < 0.5 ? Lf : Rt);

  // ---- キャラクターの「声」（ひとこと分）
  const voice = {
    claude(T, sh = 0, v = 1) { [64, 67, 72].forEach((n, i) => K.marimba(C, T + i * 0.1, n + sh, 0.5 * v)); },
    gpt(T, sh = 0, v = 1) { [72, 76, 79, 84, 88].forEach((n, i) => K.sq(C, T + i * 0.05, n + sh, 0.045, 0.42 * v)); },
    gemini(T, sh = 0, v = 1) { [81, 88, 93].forEach((n, i) => K.bell(Big, T + i * 0.075, n + sh, 0.34 * v, 0.9, 3.5)); },
    grok(T, sh = 0, v = 1) { K.gbass(C, T, 40 + sh, 0.12, 0.7 * v, true); K.gbass(C, T + 0.16, 43 + sh, 0.16, 0.7 * v, true); },
  };
  const tromb = (t, note, dur, last, v = 1) => K.defer(t, () => {
    const f = hz(note), fl = ctx.createBiquadFilter(), g = K.g(0), os = ctx.createOscillator(), os2 = ctx.createOscillator();
    fl.type = 'lowpass'; fl.Q.value = 9;
    fl.frequency.setValueAtTime(480, t); fl.frequency.linearRampToValueAtTime(1350, t + 0.07); fl.frequency.linearRampToValueAtTime(last ? 400 : 720, t + dur);
    os.type = os2.type = 'sawtooth'; os2.detune.value = 9;
    for (const o of [os, os2]) { o.frequency.setValueAtTime(f * 1.018, t); o.frequency.linearRampToValueAtTime(f, t + 0.06); if (last) o.frequency.linearRampToValueAtTime(f * 0.88, t + dur); o.connect(fl); }
    if (last) { const l = ctx.createOscillator(), lg = K.g(0); l.frequency.value = 5.6; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(30, t + dur * 0.8); l.connect(lg); lg.connect(os.detune); lg.connect(os2.detune); l.start(t); l.stop(t + dur + 0.4); }
    fl.connect(g); g.connect(Big);
    const stop = K.adsr(g.gain, t, dur, 0.3 * v, 0.03, 0.08, 0.85, 0.1);
    K.gc(g, stop);
    os.start(t); os2.start(t); os.stop(stop); os2.stop(stop);
  });
  /**
   * ロケットの轟音：地鳴り＋胴鳴り＋轟き＋ばりばりという粒立ち＋腹にくる低音。
   * o.lift（離床の時刻）があれば、点火からそこへ向けて大きくなり、
   * 上昇とともに遠ざかる（高い成分から先に消えて、低い地鳴りが残る）。
   */
  const rocket = (T0, d, G, o = {}) => K.defer(T0, () => {
    const T = K.T(T0), end = T + d + 0.2, big = o.lift !== undefined && d > 10;
    const env = K.g(0), lo = K.g(1), hi = K.g(1), post = K.g(1.2), ws = ctx.createWaveShaper(); ws.curve = K.curveSoft; ws.oversample = '2x';
    lo.connect(env); hi.connect(env); env.connect(ws); ws.connect(post); post.connect(Big);
    const p = env.gain, rel = o.rel ?? 0.4;
    p.setValueAtTime(0, T);
    if (big) {
      const tl = Math.min(Math.max(o.lift, T + 2), T + d - 6), span = T + d - tl;
      p.linearRampToValueAtTime(G * 0.5, T + 0.9); p.linearRampToValueAtTime(G * 0.72, tl - 0.5); p.linearRampToValueAtTime(G, tl + 0.3);
      hi.gain.setValueAtTime(1, tl + span * 0.02); hi.gain.linearRampToValueAtTime(0.55, tl + span * 0.13); hi.gain.linearRampToValueAtTime(0.3, tl + span * 0.3); hi.gain.linearRampToValueAtTime(0.18, tl + span * 0.55); hi.gain.linearRampToValueAtTime(0.12, T + d);
      lo.gain.setValueAtTime(1, tl + span * 0.1); lo.gain.linearRampToValueAtTime(0.7, tl + span * 0.33); lo.gain.linearRampToValueAtTime(0.42, tl + span * 0.85);
    } else p.linearRampToValueAtTime(G, T + (o.attack ?? 0.9));
    p.setValueAtTime(G, T + d - rel); p.linearRampToValueAtTime(0, T + d + 0.05);
    const layer = (dst, kind, type, f, q, lv, f1, cut) => {
      const src = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = K.g(lv);
      src.buffer = K.nz[kind]; src.loop = true; fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f, T);
      if (f1) fl.frequency.linearRampToValueAtTime(f1, T + 2.5);
      src.connect(fl);
      if (cut) { const c = ctx.createBiquadFilter(); c.type = cut[0]; c.frequency.value = cut[1]; c.Q.value = -3; fl.connect(c); c.connect(g); } else fl.connect(g);
      g.connect(dst); src.start(T, r() * 4); src.stop(end);
      return g;
    };
    layer(lo, 'brown', 'lowpass', 100, 0.7, 1.2, 220, ['highpass', 42]);   // 地鳴り
    layer(lo, 'pink', 'bandpass', 250, 0.7, 1.0, 320);                      // 胴鳴り
    layer(hi, 'pink', 'bandpass', 620, 0.5, 1.05, 800);                     // 轟き
    // ばりばり：帯域を絞った雑音の音量を、でたらめな階段波でゆらす
    const ck = o.crackle ?? 0.3;
    const cs = ctx.createBufferSource(); cs.buffer = K.crackle; cs.loop = true; cs.start(T, r() * 5); cs.stop(end);
    const cg = layer(hi, 'white', 'bandpass', 1900, 0.7, 0.0, 0, ['lowpass', 9000]), cd = K.g(ck * 0.9); cs.connect(cd); cd.connect(cg.gain);
    const cg2 = layer(hi, 'brown', 'lowpass', 600, 0.6, 0.0, 0, ['highpass', 70]), cd2 = K.g(ck * 2.4); cs.connect(cd2); cd2.connect(cg2.gain);
    // 腹にくる低音
    const so = ctx.createOscillator(), sg = K.g(0.16), sl = ctx.createOscillator(), slg = K.g(5);
    so.frequency.value = 44; sl.frequency.value = 0.9; sl.connect(slg); slg.connect(so.frequency); so.connect(sg); sg.connect(lo);
    so.start(T); sl.start(T); so.stop(end); sl.stop(end);
    K.gc(post, end + 0.05);
  });

  // 失敗の「しょんぼりトロンボーン」。4 回それぞれ、少しずつ違う落ち込み方をする
  const FAIL = [
    { n: [58, 57, 56, 55], v: 1 },                 // 半音ずつ、とぼとぼ下がる
    { n: [55, 54, 53, 52], v: 0.85, low: true },   // 爆発のあと：1 オクターブ下も重ねて、どんより
    { n: [62, 60, 58, 56], v: 0.95, bell: true },  // きらめきのあと：全音ずつ下がり、ずれた鐘がひとつ
    { n: [57, 56, 55], v: 0.8 },                   // 寝落ち：音数も少なく、力なく
  ];
  let nFail = 0;
  // 着陸して音が消える瞬間（これより後は月面＝空気がない）
  const tMoon = (cues.find((c) => c.name === 'silence') || { t: Infinity }).t;

  const fx = {
    // ---- 空気感
    amb_night(T, p) {
      const d = p.dur ?? 10;
      K.nzv(Amb, T, { kind: 'brown', ftype: 'lowpass', f: 320, peak: 0.09, dur: d, a: 1.5, r: 1.5, mod: [0.35, 0.13] });
      for (const [f0, st, off] of [[4300, AmbL, 0], [4750, AmbR, 0.37]]) {
        for (let t = T + 0.4 + off; t < T + d - 0.5; t += 0.72 + r() * 0.5) {
          const n = 2 + Math.floor(r() * 3);
          for (let i = 0; i < n; i++) K.tone(st, t + i * 0.055, { f: f0 * (1 + (r() - 0.5) * 0.01), peak: 0.016, decay: 0.035, a: 0.004 });
        }
      }
    },
    amb_day(T, p) {
      const d = p.dur ?? 10;
      K.nzv(Amb, T, { kind: 'pink', ftype: 'bandpass', f: 600, q: 0.4, peak: 0.03, dur: d, a: 1.2, r: 1.5, mod: [0.4, 0.11] });
      for (let t = T + 0.8; t < T + d - 0.5; t += 1.4 + r() * 2.6) {
        const n = 2 + Math.floor(r() * 4), f0 = 2600 + r() * 1800, st = r() < 0.5 ? AmbL : AmbR;
        for (let i = 0; i < n; i++) K.tone(st, t + i * (0.09 + r() * 0.03), { f: f0 * (1 + r() * 0.2), f1: f0 * (1.25 + r() * 0.4), ft: 0.06, peak: 0.018, decay: 0.07, a: 0.008 });
      }
    },
    amb_dawn(T, p) {
      const d = p.dur ?? 10;
      K.nzv(Amb, T, { kind: 'pink', ftype: 'bandpass', f: 450, q: 0.4, peak: 0.035, dur: d, a: 1.5, r: 2, mod: [0.4, 0.09] });
      K.tone(Amb, T, { f: 60, dur: d, peak: 0.012, a: 1, r: 1 });
      for (let t = T + 1.2; t < T + d - 0.5; t += 2.2 + r() * 3) { const f0 = 2900 + r() * 1400; for (let i = 0; i < 3; i++) K.tone(r() < 0.5 ? AmbL : AmbR, t + i * 0.1, { f: f0, f1: f0 * 1.3, ft: 0.06, peak: 0.014, decay: 0.07, a: 0.008 }); }
    },
    space(T, p) {
      const d = p.dur ?? 6;
      K.tone(Amb, T, { f: 55, dur: d, peak: 0.022, a: 1.5, r: 1.5 }); K.tone(Amb, T, { f: 82.6, dur: d, peak: 0.014, a: 1.5, r: 1.5 });
      K.nzv(Amb, T, { kind: 'pink', f: 2400, q: 0.4, peak: 0.01, dur: d, a: 1.5, r: 1.5 });
    },
    fire(T, p) {
      const d = p.dur ?? 8;
      K.nzv(Amb, T, { kind: 'brown', ftype: 'lowpass', f: 480, peak: 0.085, dur: d, a: 0.8, r: 1.0, mod: [0.4, 0.7] });
      for (let t = T + 0.1; t < T + d; t += -Math.log(1 - r() * 0.95) * 0.16 + 0.02) K.nzv(r() < 0.5 ? AmbL : AmbR, t, { f: 2200 + r() * 4500, q: 2.5, peak: 0.03 + Math.pow(r(), 3) * 0.14, decay: 0.008 + r() * 0.02 });
    },
    static(T, p) {
      const d = p.dur ?? 5;
      K.nzv(Radio, T, { f: 1800, q: 0.5, peak: 0.12, dur: d, a: 0.2, r: 0.3, mod: [0.35, 0.9] });
      K.tone(Radio, T, { f: 120, dur: d, peak: 0.03, a: 0.3, r: 0.3 });
      for (let t = T + 0.3; t < T + d; t += 0.3 + r() * 1.1) K.nzv(Radio, t, { f: 1200 + r() * 1800, q: 1, peak: 0.09 + r() * 0.11, decay: 0.015 + r() * 0.04 });
    },
    // ---- 画面の文字・吹き出し
    type(T, p) {
      const d = p.dur ?? 1;
      for (let t = T; t < T + d; t += p.soft ? 0.085 + r() * 0.04 : 0.055 + r() * 0.07) {
        if (p.soft) K.tone(Dry, t, { type: 'triangle', f: 1250 + r() * 200, peak: 0.028, decay: 0.03 });
        else { K.nzv(C, t, { f: 2600 + r() * 1800, q: 2.5, peak: 0.1, decay: 0.018 }); K.tone(C, t, { f: 180 + r() * 60, peak: 0.045, decay: 0.03 }); }
      }
    },
    pop(T) { K.tone(C, T, { f: 320, f1: 880, ft: 0.06, peak: 0.24, decay: 0.09 }); K.nzv(C, T, { f: 2400, q: 2, peak: 0.05, decay: 0.02 }); },
    key(T) { K.nzv(C, T, { f: 2200, q: 2, peak: 0.22, decay: 0.025 }); K.tone(C, T, { f: 150, f1: 90, ft: 0.05, peak: 0.2, decay: 0.08 }); },
    stamp(T) { K.boomSub(C, T, 0.5, 0.18, 120, 55); K.nzv(C, T, { f: 900, q: 0.8, peak: 0.28, decay: 0.05 }); K.tone(C, T, { f: 240, peak: 0.1, decay: 0.12 }); },
    ding(T) { K.tone(Big, T, { f: 1760, peak: 0.2, decay: 0.9 }); K.tone(Big, T, { f: 2637, peak: 0.1, decay: 0.6 }); K.tone(Big, T, { f: 3520, peak: 0.04, decay: 0.3 }); },
    tick(T) { K.nzv(C, T, { f: 3800, q: 3, peak: 0.09, decay: 0.012 }); K.tone(C, T + 0.01, { f: 1568, peak: 0.08, decay: 0.07 }); K.tone(C, T + 0.07, { f: 2093, peak: 0.07, decay: 0.1 }); },
    ticks(T, p) { const d = p.dur ?? 2; let i = 0; for (let t = T; t < T + d; t += 0.075 + r() * 0.03, i++) { K.nzv(side(), t, { f: 3200 + r() * 1500, q: 3, peak: 0.06, decay: 0.012 }); if (i % 4 === 0) K.tone(C, t, { f: 1568, peak: 0.024, decay: 0.03 }); } },
    beep(T) { K.tone(C, T, { type: 'triangle', f: 880, dur: 0.11, peak: 0.16, a: 0.005, r: 0.03 }); },
    beepHi(T) { K.tone(C, T, { type: 'triangle', f: 1760, dur: 0.45, peak: 0.17, a: 0.005, r: 0.05 }); },
    blink(T) { K.tone(Dry, T, { f: 1900, peak: 0.05, decay: 0.03 }); K.tone(Dry, T + 0.05, { f: 2500, peak: 0.04, decay: 0.03 }); },
    data(T, p) { const d = p.dur ?? 1, sc = [84, 88, 91, 95, 98]; for (let t = T; t < T + d; t += 0.05) K.sq(side(), t, sc[Math.floor(r() * 5)], 0.03, 0.14); },
    // ---- キャラクター
    voice_claude(T) { voice.claude(T); }, voice_gpt(T) { voice.gpt(T); }, voice_gemini(T) { voice.gemini(T); }, voice_grok(T) { voice.grok(T); },
    argue(T) { const w = ['claude', 'gpt', 'gemini', 'grok']; for (let i = 0; i < 15; i++) voice[w[i % 4]](T + i * 0.115, [0, 3, -2, 5, 2, -4][Math.floor(r() * 6)], 0.75); },
    yay(T) { [84, 88, 91, 96].forEach((n, i) => K.bell(Big, T + i * 0.07, n, 0.28, 0.7, 2)); K.nzv(C, T, { ftype: 'highpass', f: 6000, peak: 0.035, dur: 0.4, a: 0.05, r: 0.3 }); },
    jump(T) { K.tone(C, T, { f: 190, f1: 430, ft: 0.13, peak: 0.11, decay: 0.2, a: 0.01 }); },
    sigh(T) { K.nzv(C, T, { kind: 'pink', f: 1100, f1: 600, q: 1.2, peak: 0.12, dur: 0.6, a: 0.15, r: 0.4 }); K.tone(C, T, { f: 520, f1: 330, ft: 0.6, peak: 0.045, dur: 0.6, a: 0.1, r: 0.3 }); },
    snore(T) {
      K.nzv(C, T, { kind: 'pink', f: 320, f1: 520, q: 2.5, peak: 0.42, dur: 0.6, a: 0.25, r: 0.1, mod: [0.8, 26] });
      K.tone(C, T + 0.8, { f: 1300, f1: 950, ft: 0.5, peak: 0.055, dur: 0.5, a: 0.1, r: 0.2 }); K.nzv(C, T + 0.8, { f: 2500, q: 2, peak: 0.045, dur: 0.5, a: 0.1, r: 0.2 });
    },
    think(T, p) { const d = p.dur ?? 1.5; let i = 0; for (let t = T; t < T + d; t += 0.125, i++) K.tone(C, t, { f: (i % 2 ? 880 : 660) * (1 + ((t - T) / d) * 0.12), peak: 0.035, decay: 0.06 }); },
    steps(T, p) {
      const d = p.dur ?? 3, moon = T > tMoon;
      let i = 0;
      for (let t = T; t < T + d; t += (moon ? 0.5 : 0.27) + r() * 0.06, i++) {
        const st = i % 2 ? Lf : Rt;
        if (moon) { K.tone(st, t, { f: 95 + r() * 20, f1: 50, ft: 0.07, peak: 0.2, decay: 0.11, a: 0.006 }); K.nzv(st, t, { kind: 'brown', ftype: 'lowpass', f: 320, peak: 0.16, decay: 0.09, a: 0.006 }); continue; }
        K.tone(st, t, { f: 115 + r() * 40, f1: 62, ft: 0.05, peak: 0.24, decay: 0.07 });
        K.nzv(st, t, { f: 850 + r() * 200, q: 1.5, peak: 0.22, decay: 0.035 }); K.nzv(st, t + 0.004, { f: 3000, q: 2, peak: 0.07, decay: 0.012 });
      }
    },
    tap(T) { K.tone(C, T, { f: 1150, peak: 0.06, decay: 0.07 }); K.tone(C, T, { f: 2380, peak: 0.028, decay: 0.04 }); K.tone(C, T, { f: 120, f1: 70, ft: 0.05, peak: 0.11, decay: 0.08 }); },
    whistle(T) {
      T = K.T(T);
      K.defer(T, () => {
        const o = ctx.createOscillator(), l = ctx.createOscillator(), lg = K.g(190), g = K.g(0);
        o.frequency.value = 2900; l.frequency.value = 32; l.connect(lg); lg.connect(o.frequency); o.connect(g); g.connect(C);
        const stop = K.adsr(g.gain, T, 0.4, 0.12, 0.01, 0.05, 0.9, 0.05);
        K.gc(g, stop);
        o.start(T); l.start(T); o.stop(stop); l.stop(stop);
      });
      K.nzv(C, T, { ftype: 'highpass', f: 4500, peak: 0.03, dur: 0.4, a: 0.01, r: 0.05 });
    },
    // ---- 物の音
    snap(T, p) { const k = p.up !== undefined ? p.up : Math.floor(r() * 8); const f = 520 * Math.pow(2, (k % 28) / 14); K.tone(C, T, { type: 'triangle', f, peak: 0.18, decay: 0.07 }); K.nzv(C, T, { f: 3500, q: 2, peak: 0.09, decay: 0.012 }); K.tone(C, T, { f: 140, peak: 0.1, decay: 0.05 }); },
    ping(T) { K.tone(side(), T, { f: 2400 + r() * 900, peak: 0.09, decay: 0.16 }); K.tone(C, T, { f: 5200, peak: 0.025, decay: 0.05 }); },
    clank(T) {
      const st = side();
      for (const [f, v, d] of [[523, 0.16, 0.22], [811, 0.12, 0.17], [1307, 0.1, 0.12], [1723, 0.06, 0.08]]) K.tone(st, T, { type: 'square', f: f * (0.9 + r() * 0.25), peak: v * 0.55, decay: d });
      K.nzv(st, T, { f: 2800, q: 1.2, peak: 0.15, decay: 0.03 }); K.tone(st, T, { f: 95, peak: 0.18, decay: 0.07 });
    },
    thud(T) { K.boomSub(C, T, 0.55, 0.28, 95, 42); K.nzv(C, T, { kind: 'brown', ftype: 'lowpass', f: 500, peak: 0.4, decay: 0.12 }); },
    thunk(T) { K.boomSub(Big, T, 0.6, 0.45, 85, 38); fx.clank(T); K.nzv(Big, T, { kind: 'brown', ftype: 'lowpass', f: 700, peak: 0.3, decay: 0.15 }); },
    crash(T) { for (let i = 0; i < 5; i++) fx.clank(T + i * 0.07 + r() * 0.03); K.nzv(Big, T, { f: 1800, q: 0.5, peak: 0.28, decay: 0.5 }); fx.thud(T); },
    bonk(T) { K.tone(C, T, { f: 540, peak: 0.28, decay: 0.09 }); K.tone(C, T, { f: 1290, peak: 0.11, decay: 0.05 }); K.tone(C, T, { f: 160, f1: 90, ft: 0.08, peak: 0.28, decay: 0.12 }); },
    roll(T) { K.nzv(C, T, { kind: 'brown', ftype: 'lowpass', f: 180, f1: 420, peak: 0.28, dur: 0.4, a: 0.1, r: 0.05, mod: [0.6, 13] }); },
    wobble(T) {
      T = K.T(T);
      K.nzv(C, T, { f: 700, q: 0.8, peak: 0.07, dur: 0.6, a: 0.05, r: 0.1, mod: [0.8, 7] });
      K.defer(T, () => {
      const o = ctx.createOscillator(), tg = K.g(1), g = K.g(0), l = ctx.createOscillator(), lg = K.g(0.8);
      o.type = 'triangle'; o.frequency.setValueAtTime(150, T); o.frequency.linearRampToValueAtTime(95, T + 0.7);
      l.frequency.setValueAtTime(10, T); l.frequency.linearRampToValueAtTime(3.5, T + 0.7); l.connect(lg); lg.connect(tg.gain);
      o.connect(tg); tg.connect(g); g.connect(C); g.gain.setValueAtTime(0, T); g.gain.linearRampToValueAtTime(0.13, T + 0.02); g.gain.linearRampToValueAtTime(0, T + 0.75);
      o.start(T); l.start(T); o.stop(T + 0.8); l.stop(T + 0.8); K.gc(g, T + 0.82);
      });
    },
    unroll(T, p) { const d = p.dur ?? 2; K.nzv(C, T, { f: 2600, f1: 4200, q: 0.9, peak: 0.09, dur: d, a: 0.15, r: 0.25, mod: [0.7, 27] }); K.nzv(C, T, { kind: 'brown', ftype: 'lowpass', f: 220, peak: 0.11, dur: d, a: 0.2, r: 0.3, mod: [0.5, 6] }); },
    slide(T, p) { K.nzv(C, T, { f: 1800, f1: 2600, q: 0.8, peak: 0.06, dur: p.dur ?? 1, a: 0.2, r: 0.3 }); },
    push(T, p) { const d = p.dur ?? 1; K.nzv(C, T, { kind: 'brown', f: 180, q: 0.8, peak: 0.28, dur: d, a: 0.1, r: 0.15, mod: [0.5, 11] }); K.nzv(C, T, { f: 1400, q: 1.5, peak: 0.035, dur: d, a: 0.1, r: 0.15, mod: [0.8, 17] }); },
    servo(T, p) {
      const d = p.dur ?? 1; T = K.T(T);
      K.defer(T, () => {
      const o = ctx.createOscillator(), bp = ctx.createBiquadFilter(), g = K.g(0);
      o.type = 'sawtooth'; o.frequency.setValueAtTime(110, T); o.frequency.linearRampToValueAtTime(205, T + 0.25); o.frequency.setValueAtTime(205, T + d - 0.25); o.frequency.linearRampToValueAtTime(120, T + d);
      bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 2.5; o.connect(bp); bp.connect(g); g.connect(C);
      const stop = K.adsr(g.gain, T, d, 0.06, 0.1, 0.1, 1, 0.1); o.start(T); o.stop(stop); K.gc(g, stop);
      });
    },
    cricket(T, p) { const d = p.dur ?? 1; for (let t = T; t < T + d; t += 0.45) for (let i = 0; i < 3; i++) K.tone(Rt, t + i * 0.055, { f: 4500, peak: 0.03, decay: 0.035, a: 0.004 }); },
    lapse(T, p) { const d = p.dur ?? 4; K.nzv(Big, T, { kind: 'pink', f: 500, f1: 2400, ft: d * 0.5, f2: 300, q: 1.2, peak: 0.06, dur: d, a: d * 0.3, r: 0.6 }); },
    whoosh(T) { K.nzv(Big, T, { f: 350, f1: 2200, ft: 0.25, f2: 500, q: 1.1, peak: 0.15, dur: 0.5, a: 0.15, r: 0.25 }); },
    zip(T) { K.tone(C, T, { f: 500, f1: 3200, ft: 0.28, peak: 0.14, dur: 0.28, a: 0.02, r: 0.08 }); K.nzv(C, T, { f: 800, f1: 5000, q: 1.5, peak: 0.11, dur: 0.3, a: 0.05, r: 0.1 }); },
    float(T) { K.tone(Big, T, { f: 300, f1: 620, ft: 0.8, dur: 0.8, peak: 0.06, a: 0.2, r: 0.5 }); K.tone(Big, T, { f: 452, f1: 930, ft: 0.8, dur: 0.8, peak: 0.035, a: 0.2, r: 0.5 }); K.nzv(Big, T, { ftype: 'highpass', f: 6000, peak: 0.02, dur: 0.8, a: 0.3, r: 0.5 }); },
    flag(T) { K.boomSub(C, T, 0.3, 0.2, 100, 50); K.nzv(C, T, { f: 1300, q: 0.9, peak: 0.09, dur: 0.6, a: 0.05, r: 0.3, mod: [0.8, 12] }); [79, 84, 88].forEach((n, i) => K.celesta(Big, T + 0.25 + i * 0.09, n, 0.32)); },
    tone(T) { K.bell(Big, T, 84, 0.16, 2.6, 2); K.bell(Big, T + 0.02, 91, 0.09, 2.2, 2); },
    step(T) { K.boomSub(Big, T, 0.42, 0.5, 70, 36); K.nzv(Big, T, { kind: 'pink', ftype: 'lowpass', f: 900, peak: 0.15, decay: 0.35, a: 0.02 }); },
    // ---- きらめき・魔法
    sparkle(T, p) { const d = p.dur ?? 1, sc = [84, 86, 88, 91, 93, 96, 98, 100, 103]; for (let t = T; t < T + d; t += 0.05 + r() * 0.05) K.bell(side(), t, sc[Math.floor(r() * sc.length)], 0.1 + 0.08 * r(), 0.5, 2 + r() * 3); K.nzv(Big, T, { ftype: 'highpass', f: 7000, peak: 0.02, dur: d, a: d * 0.5, r: 0.3 }); },
    magic(T) { [60, 64, 67, 72, 76, 79, 84, 88, 91, 96].forEach((n, i) => K.pizz(Big, T - 0.3 + i * 0.03, n, 0.34, 0.5)); [84, 88, 91, 96].forEach((n) => K.bell(Big, T, n, 0.32, 1.6)); K.crash(Big, T, 0.22, 1.5); },
    wonder(T) { K.swell(Big, T, 1.6, 0.28, 6000); K.boomSub(Big, T, 0.32, 2.2, 55, 30); [86, 90, 93].forEach((n, i) => K.bell(Big, T + i * 0.12, n, 0.18, 2.2, 2)); },
    title(T) { K.boomSub(Big, T, 0.45, 1.6, 70, 34); },
    fail(T) {
      const F = FAIL[nFail++ % FAIL.length], k = F.n.length - 1;
      const nx = shots.find((q) => q.t0 > T + 0.3);
      const avail = Math.min(2.3, (nx ? nx.t0 : K.dur) - T);          // 次のカットまでに言い終える
      const q = Math.min(0.27, Math.max(0.18, (avail - 0.85) / k)), last = Math.min(1.1, Math.max(0.6, avail - k * q - 0.1));
      F.n.forEach((n, i) => {
        const t = T + 0.1 + i * q, fin = i === k, dd = fin ? last : q * 0.9;
        tromb(t, n, dd, fin, F.v);
        if (F.low) tromb(t, n - 12, dd, fin, F.v * 0.6);
      });
      K.pizz(Big, T + 0.1 + k * q, F.n[k] - 24, 0.5, 0.5);            // 最後の音の下で、低い弦がぽつり
      if (F.bell) K.bell(Big, T + 0.1 + k * q + 0.14, F.n[k] + 25, 0.2, 1.2, 3.7);
    },
    hit(T) {
      K.brass(Big, T, 0.9, ['C3', 'G3', 'C4', 'E4', 'G4', 'C5'], 0.9, { a: 0.02, r: 0.5 });
      K.strings(Big, T, 1.0, ['C2', 'G2', 'C3', 'E4', 'G4', 'C5', 'E5'], 0.8, { a: 0.03, r: 0.7 });
      K.timp(Big, T, 'C2', 0.9); K.crash(Big, T, 0.45, 2.0); K.boomSub(Big, T, 0.45, 1.0, 80, 33);
    },
    // ---- 無線・警報
    quindar(T) { K.tone(Radio, T, { f: 2525, dur: 0.25, peak: 0.16, a: 0.004, r: 0.01 }); K.nzv(Radio, T - 0.06, { f: 1800, q: 0.7, peak: 0.05, dur: 0.42, a: 0.02, r: 0.1 }); },
    quindar2(T) { K.tone(Radio, T, { f: 2475, dur: 0.25, peak: 0.16, a: 0.004, r: 0.01 }); K.nzv(Radio, T - 0.06, { f: 1800, q: 0.7, peak: 0.05, dur: 0.42, a: 0.02, r: 0.1 }); },
    alarm(T, p) { const d = p.dur ?? 2; let i = 0; for (let t = T; t < T + d - 0.05; t += 0.25, i++) { K.tone(C, t, { wave: 'pulse50', f: i % 2 ? 660 : 880, dur: 0.2, peak: 0.085, a: 0.006, r: 0.02 }); K.tone(C, t, { type: 'sine', f: i % 2 ? 660 : 880, dur: 0.2, peak: 0.085, a: 0.006, r: 0.02 }); } K.duck(T, 3, d, 0.1, 0.4); },
    // ---- ロケット
    ignite(T) { K.nzv(Big, T, { ftype: 'highpass', f: 900, peak: 0.45, decay: 0.35 }); K.boomSub(Big, T, 0.6, 0.8, 110, 40); K.nzv(Big, T, { kind: 'brown', ftype: 'lowpass', f: 300, f1: 900, peak: 0.45, dur: 0.6, a: 0.05, r: 0.4 }); K.duck(T, 5, 0.6); },
    rumble(T, p) {
      const d = p.dur ?? 3, G = p.gain ?? 1, big = d > 10;
      const lc = big ? cues.find((c) => c.name === 'liftoff' && c.t > T + 1 && c.t < T + d - 6) : undefined;
      const lift = big ? (lc ? lc.t : T + Math.min(5, d * 0.25)) : undefined;
      rocket(T, d, (big ? 0.6 : 0.42) * G, { attack: 0.5, crackle: big ? 0.36 : 0.24, rel: big ? 2.2 : 0.25, lift });
      if (big) K.duck(T, 6, Math.max(0.5, lift - T - 0.8), 0.4, 1.0); else K.duck(T, 6, d, 0.2, 0.5);
    },
    release(T) { fx.clank(T); K.nzv(Big, T, { ftype: 'highpass', f: 2500, peak: 0.22, decay: 0.5 }); K.boomSub(Big, T, 0.6, 0.5, 90, 35); },
    liftoff(T) { K.nzv(Big, T, { kind: 'brown', ftype: 'lowpass', f: 180, f1: 1400, ft: 2.2, peak: 0.5, dur: 5, a: 1.2, r: 3 }); K.boomSub(Big, T, 0.55, 1.8, 72, 38); },
    roar(T, p) { const d = p.dur ?? 3; K.nzv(Big, T, { kind: 'brown', ftype: 'lowpass', f: 650, peak: 0.36, dur: d, a: 0.3, r: 0.5, mod: [0.25, 7] }); K.nzv(Big, T, { kind: 'pink', f: 1100, q: 0.5, peak: 0.1, dur: d, a: 0.3, r: 0.5, mod: [0.5, 23] }); },
    scream(T, p) {
      const d = p.dur ?? 2; T = K.T(T);
      K.defer(T, () => {
      const os = ctx.createOscillator(), bp = ctx.createBiquadFilter(), g = K.g(0), lfo = ctx.createOscillator(), lg = K.g(260);
      os.type = 'sawtooth'; os.frequency.setValueAtTime(420, T); os.frequency.exponentialRampToValueAtTime(1500, T + d * 0.55); os.frequency.exponentialRampToValueAtTime(2300, T + d);
      lfo.frequency.setValueAtTime(5, T); lfo.frequency.linearRampToValueAtTime(11, T + d); lfo.connect(lg); lg.connect(os.frequency);
      bp.type = 'bandpass'; bp.Q.value = 3; bp.frequency.setValueAtTime(900, T); bp.frequency.exponentialRampToValueAtTime(3200, T + d);
      os.connect(bp); bp.connect(g); g.connect(Big);
      g.gain.setValueAtTime(0, T); g.gain.linearRampToValueAtTime(0.09, T + 0.2); g.gain.linearRampToValueAtTime(0.18, T + d - 0.02); g.gain.linearRampToValueAtTime(0, T + d + 0.03);
      os.start(T); lfo.start(T); os.stop(T + d + 0.1); lfo.stop(T + d + 0.1); K.gc(g, T + d + 0.12);
      });
      K.nzv(Big, T, { f: 700, f1: 2600, q: 0.7, peak: 0.22, dur: d, a: 0.2, r: 0.03, mod: [0.5, 9] });
    },
    boom(T, p) {
      const s = p.size ?? 1;
      K.nzv(Big, T, { peak: 0.6 * s, decay: 0.05 });
      K.boomSub(Big, T, 0.95 * Math.min(1.2, s), 1.6 * s, 130, 28);
      K.nzv(Big, T, { kind: 'brown', ftype: 'lowpass', f: 2600, f2: 120, peak: 0.9 * s, decay: 1.8 * s });
      K.nzv(Big, T + 0.03, { f: 1200, q: 0.5, peak: 0.32 * s, decay: 0.7 });
      for (let i = 0; i < 26; i++) { const t = T + 0.15 + Math.pow(r(), 1.5) * 1.8; K.nzv(side(), t, { f: 1500 + r() * 4000, q: 3, peak: 0.07 * (1 - (t - T) / 2.2), decay: 0.02 + r() * 0.03 }); }
      K.duck(T, 12, 1.2 * s, 0.03, 1.2);
    },
    sep(T) { K.nzv(Big, T, { peak: 0.45, decay: 0.04 }); K.boomSub(Big, T, 0.5, 0.35, 110, 45); K.nzv(Big, T + 0.02, { ftype: 'highpass', f: 3000, peak: 0.18, decay: 0.7 }); K.tone(Big, T, { type: 'square', f: 660, peak: 0.045, decay: 0.3 }); },
    ignite2(T) { K.nzv(Big, T, { kind: 'brown', ftype: 'lowpass', f: 200, f1: 520, peak: 0.36, dur: 0.7, a: 0.2, r: 0.6 }); K.nzv(Big, T, { ftype: 'highpass', f: 4000, peak: 0.06, dur: 0.6, a: 0.1, r: 0.4 }); },
    hum(T, p) { const d = p.dur ?? 3; K.tone(Big, T, { f: 55, dur: d, peak: 0.15, a: 0.5, r: 1 }); K.tone(Big, T, { type: 'triangle', f: 110.6, dur: d, peak: 0.045, a: 0.5, r: 1 }); K.nzv(Big, T, { kind: 'brown', ftype: 'lowpass', f: 300, peak: 0.11, dur: d, a: 0.6, r: 1, mod: [0.3, 4] }); },
    descent(T, p) { const d = p.dur ?? 4; K.nzv(Big, T, { kind: 'brown', ftype: 'lowpass', f: 160, f1: 260, peak: 0.5, dur: d, a: 0.6, r: 0.12, mod: [0.2, 9] }); K.nzv(Big, T, { kind: 'pink', f: 700, q: 0.5, peak: 0.26, dur: d, a: 0.6, r: 0.1, mod: [0.5, 21] }); K.tone(Big, T, { f: 50, dur: d, peak: 0.09, a: 0.6, r: 0.15 }); },
  };

  let n = 0;
  for (const c of cues) {
    const f = fx[c.name];
    if (!f || !(c.t < K.dur)) continue;
    try { f(Math.max(0, c.t), c.p || {}); n++; } catch (e) { console.warn('[audio] 効果音を飛ばしました:', c.name, e); }
  }
  return n;
}
