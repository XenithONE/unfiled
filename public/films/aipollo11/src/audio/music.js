// 音楽：カットの開始時刻（film.marks）と合図（film.cues）から、場面ごとの曲を組み立てる。
// 主題はオリジナル。引用は 2 つだけ（どちらも著作権の切れた古典）：
//   ・ヨハン・シュトラウス 2 世「美しく青きドナウ」（月へ向かう航行）
//   ・リヒャルト・シュトラウス「ツァラトゥストラはかく語りき」冒頭（最初の一歩）
import { nn, mulberry } from './synth.js';

// 主題（ハ長調・4/4）。[音, 拍, 長さ]。最初の 2 音は弱起。
const THEME = [
  ['G4', -1, 0.5], ['A4', -0.5, 0.5],
  ['C5', 0, 1.5], ['D5', 1.5, 0.5], ['E5', 2, 2],
  ['D5', 4, 1.5], ['C5', 5.5, 0.5], ['G4', 6, 1], ['G4', 7, 0.5], ['A4', 7.5, 0.5],
  ['C5', 8, 1.5], ['D5', 9.5, 0.5], ['E5', 10, 1], ['G5', 11, 1],
  ['F5', 12, 1.5], ['E5', 13.5, 0.5], ['D5', 14, 2],
  ['E5', 16, 1.5], ['F5', 17.5, 0.5], ['G5', 18, 2],
  ['A5', 20, 1.5], ['G5', 21.5, 0.5], ['E5', 22, 1], ['C5', 23, 1],
  ['D5', 24, 1.5], ['E5', 25.5, 0.5], ['F5', 26, 1], ['D5', 27, 1],
  ['C5', 28, 4],
];
// 和音：[低音, 中域の 3 音]
const CH = {
  C: ['C2', ['E3', 'G3', 'C4']], 'G/B': ['B1', ['D3', 'G3', 'B3']], Am7: ['A1', ['E3', 'G3', 'C4']], Am: ['A1', ['E3', 'A3', 'C4']],
  F: ['F1', ['F3', 'A3', 'C4']], G: ['G1', ['D3', 'G3', 'B3']], 'C/E': ['E2', ['G3', 'C4', 'E4']], Dm7: ['D2', ['F3', 'A3', 'C4']],
  G7: ['G1', ['F3', 'B3', 'D4']], Em: ['E2', ['E3', 'G3', 'B3']], 'Em/G': ['G1', ['E3', 'G3', 'B3']], Fmaj7: ['F1', ['E3', 'A3', 'C4']],
};
const PROG = ['C', 'G/B', 'Am7', ['F', 'G'], 'C/E', 'F', ['Dm7', 'G7'], 'C'];
const SAD = ['Am', 'G/B', 'F', 'G', 'C/E', 'F', ['Dm7', 'G7'], 'C'];
const halves = (c) => (Array.isArray(c) ? c : [c, c]);

export function buildMusic(K, film) {
  const M = film.marks || {}, shots = film.shots || [], cues = film.cues || [];
  const has = (n) => M[n] !== undefined;
  const shot = (n) => shots.find((s) => s.name === n);
  const endOf = (n) => { const s = shot(n); return s ? s.t1 : undefined; };
  const cueT = (name, a = 0, b = Infinity) => { const c = cues.find((q) => q.name === name && q.t >= a - 1e-6 && q.t < b); return c ? c.t : undefined; };
  /** 場面ごとの出口（入りと終わりをなめらかにする音量） */
  const sec = (t0, t1, fin = 0.02, fout = 0.3) => {
    const g = K.g(0); t0 = Math.max(0, t0);
    g.gain.setValueAtTime(0, Math.max(0, t0 - 0.002)); g.gain.linearRampToValueAtTime(1, t0 + fin);
    g.gain.setValueAtTime(1, Math.max(t0 + fin, t1 - fout)); g.gain.linearRampToValueAtTime(0, t1);
    g.connect(K.musicBus);
    g._end = t1; K.gc(g, t1 + 0.2);
    return g;
  };
  const st = (key, dest, o = {}) => K.strip(key, { ...o, dest, until: dest._end + 0.1 });
  /** 主題を鳴らす：fn(音, 時刻, 長さ, 番号)。b0〜b1 小節ぶん */
  const theme = (fn, T0, beat, b0 = 0, b1 = 8, tr = 0) => {
    THEME.forEach(([n, s, d], i) => { if (s >= b0 * 4 - (b0 === 0 ? 1.01 : 0.01) && s < b1 * 4 - 0.01) fn(nn(n) + tr, T0 + (s - b0 * 4) * beat, d * beat, i); });
  };
  const r = mulberry(2001);
  /** 場面ひとつぶんを組む。その場面で例外が出ても、ほかの場面は鳴らす */
  const part = (name, on, fn) => { if (!on) return; try { fn(); } catch (e) { console.warn('[audio] 音楽の場面を飛ばしました:', name, e); } };

  // =====================================================================
  // A：月を見上げる夜 → 題字
  // =====================================================================
  part('a1_night', has('a1_night'), () => {
    const t0 = M.a1_night, t1 = has('b1_board') ? M.b1_board : (endOf('a3_title') ?? t0 + 18);
    const tc = cueT('title', t0, t1) ?? (t1 - 4.2);
    const G = sec(t0, t1, 0.6, 0.3);
    const pad = st('A.pad', G, { hall: 0.3, cath: 0.25, spread: 0.8 }), mb = st('A.mb', G, { hall: 0.35, cath: 0.2, pan: 0.1, spread: 0.5 });
    const br = st('A.br', G, { hall: 0.32, cath: 0.25, spread: 0.45 }), sr = st('A.str', G, { hall: 0.3, cath: 0.2, spread: 0.7 }), pc = st('A.pc', G, { hall: 0.3, cath: 0.2 });
    const L = (tc - 0.4 - t0) / 3;
    [['C3', 'G3', 'D4', 'E4'], ['F2', 'C3', 'A3', 'E4'], ['A2', 'E3', 'G3', 'C4']].forEach((c, i) => K.pad(pad, t0 + i * L, L + 0.9, c, 0.38));
    K.sub(pad, t0 + 0.5, tc - t0 - 0.5, 'C2', 0.12, 2, 1);
    for (const [k, ns, sp] of [[0.14, [79, 81, 84], 0.55], [0.36, [86, 88], 0.6], [0.55, [79, 81, 84, 86, 88], 0.42], [0.82, [91, 88, 84], 0.45]]) ns.forEach((n, i) => K.mbox(mb, t0 + (tc - t0) * k + i * sp, n, 0.42 - i * 0.03));
    // 題字：あたたかいファンファーレ（主題の頭）
    K.timpRoll(pc, tc - 0.9, 0.9, 'G2', 0.06, 0.45);
    K.swell(pc, tc, 1.4, 0.3);
    K.brass(br, tc - 0.5, 0.22, ['G4'], 0.55); K.brass(br, tc - 0.25, 0.22, ['A4'], 0.6);
    K.brass(br, tc, 1.15, ['C5'], 0.75); K.brass(br, tc + 1.2, 0.36, ['D5'], 0.7); K.brass(br, tc + 1.6, 2.3, ['E5'], 0.8, { r: 0.9 });
    K.brass(br, tc, 1.5, ['C3', 'G3', 'C4', 'E4'], 0.55, { bright: 0.7 }); K.brass(br, tc + 1.6, 2.3, ['C3', 'G3', 'C4', 'G4'], 0.55, { bright: 0.7, r: 0.9 });
    K.strings(sr, tc, 3.9, ['C2', 'G2', 'E3', 'G3', 'C4', 'E4', 'G4'], 0.65, { a: 0.12, r: 1.3 });
    K.timp(pc, tc, 'C2', 0.75); K.crash(pc, tc, 0.42, 2.6); K.timp(pc, tc + 1.6, 'C2', 0.5);
    [84, 88, 91, 96].forEach((n, i) => K.mbox(mb, tc + 2.2 + i * 0.16, n, 0.4));
  });

  // ---- 弾むような伴奏 1 小節（低音のピチカート＋マリンバの裏打ち）
  const groove = (S, tb, bt, chord, lv = 1, perc = true) => {
    halves(chord).forEach((cn, h) => {
      const [root, tri] = CH[cn], t = tb + h * 2 * bt, rm = nn(root) + 12;
      K.pizz(S.bass, t, rm, 0.8 * lv, 0.32); K.pizz(S.bass, t + bt, rm + 7, 0.6 * lv, 0.26);
      for (const o of [0.5, 1.5]) tri.forEach((n) => K.marimba(S.mar, t + o * bt, nn(n) + 12, 0.24 * lv));
      if (perc) { K.wood(S.pc, t + bt, 900, 0.3 * lv); for (let i = 0; i < 4; i++) K.shaker(S.pc, t + i * bt * 0.5, (i % 2 ? 0.22 : 0.12) * lv); }
    });
  };
  // ---- キャラクターごとの音色
  const leadFn = {
    claude: (s, t, n, d, v) => K.marimba(s, t, n, v),
    gpt: (s, t, n, d, v) => K.sq(s, t, n, d * 0.8, v * 0.9),
    gemini: (s, t, n, d, v) => K.bell(s, t, n + 12, v * 0.75, 0.9),
    grok: (s, t, n, d, v) => K.gbass(s, t, n - 24, d * 0.9, v, true),
  };
  const LICK = {
    claude: [[65, 0, 0.5], [69, 0.5, 0.5], [72, 1, 0.5], [69, 1.5, 0.5], [77, 2, 1], [72, 3, 1]],
    gpt: [67, 71, 74, 79, 83, 86, 83, 79, 74, 79, 83, 86, 91, 86, 83, 79].map((n, i) => [n, i * 0.25, 0.25]),
    gemini: [[69, 0, 0.5], [72, 0.5, 0.5], [76, 1, 0.5], [81, 1.5, 0.5], [84, 2, 0.5], [81, 2.5, 0.5], [88, 3, 1]],
    grok: [[65, 0, 0.5], [65, 0.5, 0.5], [68, 1, 0.5], [69, 1.5, 0.5], [67, 2, 0.75], [67, 2.75, 0.25], [70, 3, 0.5], [71, 3.5, 0.5]],
  };
  const LCHORD = { claude: 'F', gpt: 'G', gemini: 'Am', grok: ['F', 'G'] };

  // =====================================================================
  // B：それぞれの案（弾む・たのしい）
  // =====================================================================
  part('b1_board', has('b1_board'), () => {
    const t0 = M.b1_board, t1 = has('c1_build') ? M.c1_build : (endOf('b3_argue') ?? t0 + 15);
    const bt = 0.5, G = sec(t0, t1, 0.02, 0.06);
    const S = { bass: st('B.bass', G, { hall: 0.06, room: 0.1 }), mar: st('B.mar', G, { hall: 0.12, room: 0.24, pan: -0.2, spread: 0.55 }), pc: st('B.pc', G, { hall: 0.08, room: 0.25, pan: 0.35 }) };
    const ld = st('B.lead', G, { hall: 0.14, room: 0.2, pan: 0.1, spread: 0.4 });
    const tb3 = M.b3_argue ?? t1;
    const zipT = cueT('zip', tb3, t1) ?? t1;
    // b1：2 小節のたのしい節
    const b2s = shots.filter((s) => s.name.startsWith('b2_'));
    const tB2 = b2s.length ? b2s[0].t0 : tb3;
    const nb1 = Math.max(1, Math.round((tB2 - t0) / (bt * 4)));
    const RIFF = [[72, 0, 0.5], [76, 0.5, 0.5], [79, 1, 0.5], [76, 1.5, 0.5], [84, 2, 1], [79, 3, 1], [81, 4, 0.5], [79, 4.5, 0.5], [76, 5, 0.5], [79, 5.5, 0.5], [74, 6, 1], [72, 7, 0.75]];
    for (let b = 0; b < nb1; b++) groove(S, t0 + b * bt * 4, bt, 'C');
    for (const [n, s, d] of RIFF) if (s < nb1 * 4) { K.marimba(ld, t0 + s * bt, n, 0.6); K.pizz(ld, t0 + s * bt, n - 12, 0.3, 0.2); }
    // b2：1 人 1 小節、その人の音色で
    for (const s of b2s) {
      const who = s.name.slice(3);
      if (!LICK[who]) continue;
      groove(S, s.t0, bt, LCHORD[who], 0.9);
      for (const [n, b, d] of LICK[who]) leadFn[who](ld, s.t0 + b * bt, n, d * bt, 0.6);
    }
    // b3：4 つの音色がぶつかる
    for (let tb = tb3, i = 0; tb < zipT - 0.2; tb += bt * 4, i++) {
      groove(S, tb, bt, i % 2 ? ['F', 'G'] : 'C', 1.05);
      ['claude', 'gpt', 'gemini', 'grok'].forEach((who, k) => { for (const [n, b, d] of LICK[who]) { const t = tb + b * bt + k * 0.03; if (t < zipT - 0.05) leadFn[who](ld, t, n + (k % 2 ? 1 : 0), d * bt, 0.42); } });
    }
  });

  // =====================================================================
  // C：4 回の試行（それぞれの音色の変奏。失敗の音のために間をあける）
  // =====================================================================
  for (let k = 1; k <= 4; k++) part('C' + k, true, () => {
    const ss = shots.filter((s) => s.name.startsWith('c' + k + '_'));
    if (!ss.length) return;
    const who = ['gpt', 'grok', 'gemini', 'claude'][k - 1];
    const first = ss[0], last = ss[ss.length - 1];
    const tFail = cueT('fail', last.t0, last.t1) ?? last.t0 + 1.1;
    const G = sec(first.t0, tFail, 0.02, 0.1);
    const S = { bass: st('C' + k + '.bass', G, { hall: 0.06, room: 0.1 }), mar: st('C' + k + '.mar', G, { hall: 0.12, room: 0.22, pan: -0.2, spread: 0.55 }), pc: st('C' + k + '.pc', G, { hall: 0.08, room: 0.25, pan: 0.35 }) };
    const ld = st('C' + k + '.lead', G, { hall: 0.14, room: 0.2, pan: 0.1, spread: 0.45 }), dr = st('C' + k + '.dr', G, { hall: 0.05, room: 0.2 });
    const bt = who === 'claude' ? 0.5 : 60 / 132;
    const tEnd = first.t1;
    let b = 0;
    for (let tb = first.t0; tb < tEnd - 0.15; tb += bt * 4, b++) {
      const ch = ['C', 'F', 'G', 'C'][b % 4];
      if (who === 'gpt') {
        groove(S, tb, bt, ch, 1.1);
        const tones = [...CH[ch][1].map((n) => nn(n) + 12), ...CH[ch][1].map((n) => nn(n) + 24)];
        const div = b === 0 ? 4 : 8;   // だんだん速くなる
        for (let i = 0; i < 4 * div; i++) { const t = tb + (i / div) * bt; if (t < tEnd - 0.05) K.sq(ld, t, tones[(i + b) % tones.length] + (b >= 2 ? 12 : 0), bt / div, 0.62); }
      } else if (who === 'grok') {
        const riff = [40, 40, 43, 40, 46, 45, 43, 40];
        riff.forEach((n, i) => { const t = tb + i * bt * 0.5; if (t < tEnd - 0.05) K.gbass(S.bass, t, n, bt * 0.42, 0.7, true); });
        for (let i = 0; i < 4; i++) { const t = tb + i * bt; if (t < tEnd - 0.05) { K.kick(dr, t, 0.8); if (i % 2) K.snare(dr, t, 0.55); K.hat(dr, t + bt * 0.5, 0.3); } }
      } else if (who === 'gemini') {
        const tones = (b % 2 ? [65, 69, 72, 76, 81, 84] : [60, 64, 67, 71, 76, 79]);
        for (let i = 0; i < 12; i++) { const t = tb + (i / 3) * bt; if (t < tEnd - 0.05) K.bell(ld, t, tones[i % 6] + 12, 0.34, 1.1, 3.5); }
        K.pad(S.mar, tb, bt * 4, b % 2 ? ['F3', 'A3', 'C4', 'E4'] : ['C3', 'E3', 'G3', 'B3'], 0.5, { a: 0.3, r: 0.6 });
      } else {
        halves(ch).forEach((cn, h) => { const t = tb + h * 2 * bt; K.pizz(S.bass, t, nn(CH[cn][0]) + 12, 0.7, 0.3); });
        for (let i = 0; i < 4; i++) { const t = tb + i * bt; if (t < tEnd - 0.05) { K.wood(S.pc, t, i % 2 ? 620 : 930, 0.4); K.marimba(ld, t, [60, 62, 64, 65, 67, 69, 71, 72][(b * 4 + i) % 8] + 12, 0.5); } }
      }
    }
    // 途中のカット：そろりそろり（点火の前は小太鼓のロール）
    const ign = cues.filter((c) => c.name === 'ignite' && c.t >= first.t0 && c.t < last.t0).map((c) => c.t);
    const mids = ss.slice(1, -1);
    if (who === 'claude') {
      // 確認が終わらない：チクタクがだんだん遅くなり、オルゴールの子守歌に
      const a = mids.length ? mids[0].t0 : tEnd;
      let t = a, i = 0, gap = 0.5;
      while (t < tFail - 0.3) { K.wood(S.pc, t, i % 2 ? 620 : 930, 0.34 * Math.max(0.35, 1 - (t - a) / 9)); t += gap; gap *= 1.045; i++; }
      const beat = (tFail - a - 0.8) / 9;
      theme((n, tt, d) => { if (tt < tFail - 0.2) K.mbox(ld, tt, n + 12, 0.42); }, a + 1.0 + beat, beat, 0, 2);
      K.pad(S.mar, a + 0.6, tFail - a - 0.8, ['A2', 'E3', 'G3', 'C4'], 0.4, { a: 1.5, r: 0.5 });
    } else {
      for (const m of mids) {
        const stop = Math.min(m.t1, ...[cueT('beepHi', m.t0, m.t1), cueT('bonk', m.t0, m.t1)].filter((x) => x !== undefined), ...ign.filter((x) => x >= m.t0 - 1e-6).map((x) => x - 1.25));
        const pat = [48, 51, 54, 55, 54, 51];
        let i = 0;
        for (let t = m.t0 + 0.1; t < stop - 0.1; t += 0.5, i++) { K.pizz(S.bass, t, pat[i % 6], 0.5, 0.24); K.wood(S.pc, t + 0.25, 1100, 0.14); }
      }
      for (const ti of ign) { if (ti - 1.25 < first.t0) continue; K.snareRoll(dr, ti - 1.25, 1.25, 0.05, 0.5); K.timp(dr, ti, 'C2', 0.6); }
    }
  });

  // =====================================================================
  // D：焚き火の夜（主題を、ゆっくり・やさしく）→ ひとつに
  // =====================================================================
  part('d1_sad', has('d1_sad'), () => {
    const t0 = M.d1_sad, t1 = has('e1_code') ? M.e1_code : (endOf('d4_team') ?? t0 + 18);
    const tm = M.d3_merge ?? (t0 + (t1 - t0) * 0.55);
    const td = M.d4_team ?? (t0 + (t1 - t0) * 0.8);
    const th = cueT('hit', td, t1) ?? (td + (t1 - td) * 0.5);
    const G = sec(t0, t1, 0.4, 0.15);
    const mb = st('D.mb', G, { hall: 0.3, cath: 0.2, pan: 0.1, spread: 0.5 }), sr = st('D.str', G, { hall: 0.3, cath: 0.22, spread: 0.7 }), bs = st('D.bass', G, { hall: 0.15 }), hp = st('D.harp', G, { hall: 0.28, pan: -0.15, spread: 0.55 }), pc = st('D.pc', G, { hall: 0.3, cath: 0.15 });
    // 前半（1〜4 小節）：しょんぼり
    const b1 = (tm - (t0 + 1.4)) / 16, T1 = t0 + 1.4;
    theme((n, t, d) => K.mbox(mb, t, n, 0.42), T1, b1, 0, 4);
    for (let b = 0; b < 4; b++) halves(SAD[b]).forEach((cn, h) => {
      const [root, tri] = CH[cn], t = T1 + (b * 4 + h * 2) * b1;
      K.strings(sr, t, b1 * 2 + 0.2, tri, 0.34, { a: 0.5, r: 0.8, bright: 0.6 }); K.pizz(bs, t, nn(root) + 12, 0.42, 0.9);
    });
    // 後半（5〜7 小節）：希望がふくらむ → 手を重ねる瞬間に主和音
    const b2 = (th - tm) / 12;
    theme((n, t, d) => { K.mbox(mb, t, n, 0.55); K.strings(sr, t, d + 0.1, [n - 12], 0.35 + 0.25 * ((t - tm) / (th - tm)), { a: 0.12, r: 0.3 }); }, tm, b2, 4, 7);
    for (let b = 4; b < 7; b++) halves(SAD[b]).forEach((cn, h) => {
      const [root, tri] = CH[cn], t = tm + ((b - 4) * 4 + h * 2) * b2, k = (t - tm) / (th - tm);
      K.strings(sr, t, b2 * 2 + 0.2, [root, ...tri, nn(tri[2]) + 12], 0.5 + 0.35 * k, { a: 0.3, r: 0.6 }); K.pizz(bs, t, nn(root) + 12, 0.6, 0.9);
      tri.forEach((n, i) => { for (let o = 0; o < 2; o++) K.pizz(hp, t + (i + o * 3) * b2 / 3, nn(n) + 12 + o * 12, 0.3 + 0.2 * k, 0.6); });
    });
    K.timpRoll(pc, th - 1.1, 1.1, 'G2', 0.05, 0.5); K.swell(pc, th, 1.3, 0.3);
    K.strings(sr, th, t1 - th + 0.3, ['C2', 'G2', 'E3', 'G3', 'C4', 'E4', 'G4', 'C5'], 0.8, { a: 0.05, r: 0.5 });
    [72, 76, 79, 84].forEach((n, i) => K.mbox(mb, th + 0.05 + i * 0.1, n + 12, 0.5));
  });

  // =====================================================================
  // E：組み立て（のりのいいモンタージュ。カットごとに音が増える）
  // =====================================================================
  part('e1_code', has('e1_code'), () => {
    const t0 = M.e1_code, t1 = has('f1_walkup') ? M.f1_walkup : (endOf('e5_stack') ?? t0 + 20);
    const es = shots.filter((s) => s.name.startsWith('e') && s.t0 >= t0 - 1e-6 && s.t0 < t1);
    const layerAt = (t) => { let n = 0; for (const s of es) if (t >= s.t0 - 0.01) n++; return n - 1; };
    const bt = 60 / 126, bar = bt * 4, G = sec(t0, t1, 0.02, 0.05);
    const dr = st('E.dr', G, { hall: 0.05, room: 0.18 }), bs = st('E.bass', G, { room: 0.06 }), arp = st('E.arp', G, { hall: 0.12, room: 0.15, pan: -0.25, spread: 0.6 }), bl = st('E.bell', G, { hall: 0.25, pan: 0.3, spread: 0.5 });
    const mar = st('E.mar', G, { hall: 0.12, room: 0.2, pan: 0.15, spread: 0.5 }), ld = st('E.lead', G, { hall: 0.25, cath: 0.08 }), pd = st('E.pad', G, { hall: 0.25, spread: 0.8 });
    const nb = Math.floor((t1 - t0) / bar + 0.02);
    const lead0 = Math.max(0, nb - 8 - 1);          // 主題は終わりの 1 小節前に終わるように
    for (let b = 0; b < nb + 1; b++) {
      const tb = t0 + b * bar;
      if (tb > t1 - 0.2) break;
      const ch = b >= lead0 ? PROG[(b - lead0) % 8] : 'C';
      const lastBar = b >= nb - 1;
      halves(ch).forEach((cn, h) => {
        const [root, tri] = CH[cn], th = tb + h * 2 * bt, rm = nn(root) + 12;
        for (let i = 0; i < 4; i++) {
          const t = th + i * bt * 0.5, L = layerAt(t);
          if (t > t1 - 0.03) continue;
          K.gbass(bs, t, rm - 12 + (i % 2 ? 12 : 0), bt * 0.4, L >= 1 ? 0.6 : 0.42, L >= 1);
          K.hat(dr, t, i % 2 ? 0.34 : 0.2, L >= 3 && i === 3);
          for (let j = 0; j < 2; j++) K.sq(arp, t + j * bt * 0.25, nn(tri[(i * 2 + j) % 3]) + 12 + ((i * 2 + j) % 4 >= 2 ? 12 : 0), bt * 0.2, 0.36);
          if (L >= 2) K.bell(bl, t, nn(tri[(i + 1) % 3]) + 24, 0.2, 0.7, 3.5);
          if (L >= 3 && i % 2) tri.forEach((n) => K.marimba(mar, t, nn(n) + 12, 0.3));
        }
        for (let i = 0; i < 2; i++) { const t = th + i * bt, L = layerAt(t); if (t > t1 - 0.03) continue; K.kick(dr, t, 0.85); if (L >= 1 && i === 1) { K.snare(dr, t, 0.55); if (L >= 3) K.clap(dr, t, 0.4); } }
        if (layerAt(th) >= 2) K.pad(pd, th, bt * 2, [root, ...tri].map((n) => nn(n) + 12), 0.5, { a: 0.1, r: 0.3 });
      });
      if (lastBar) { K.snareRoll(dr, tb + bar * 0.5, bar * 0.5, 0.08, 0.6, 16); K.swell(dr, tb + bar, bar, 0.4); }
    }
    theme((n, t, d) => { if (t < t1 - 0.1) { K.lead(ld, t, d * 0.92, n, 0.75); K.lead(ld, t, d * 0.92, n + 12, 0.3); } }, t0 + lead0 * bar, bt, 0, 8);
  });

  // =====================================================================
  // F：発射台へ → 秒読み → 点火 → 上昇（堂々と）
  // =====================================================================
  part('f1_walkup', has('f1_walkup'), () => {
    const t0 = M.f1_walkup;
    const tCab = M.f2_cabin ?? t0 + 7, tCnt = M.f3_count ?? tCab + 4, tIgn = M.f4_ignite ?? tCnt + 4.2, tLift = M.f5_liftoff ?? tIgn + 3.8;
    const t1 = has('g1_stage') ? M.g1_stage : (endOf('f6_sky') ?? tLift + 12.8);
    const tHit = cueT('hit', tLift, t1) ?? (tLift + 1.2);
    const G = sec(t0, t1 + 1.2, 0.05, 1.4);
    const br = st('F.br', G, { hall: 0.28, cath: 0.2, spread: 0.45 }), hn = st('F.hn', G, { hall: 0.3, cath: 0.2, pan: -0.2, spread: 0.35 }), sr = st('F.str', G, { hall: 0.25, cath: 0.15, pan: 0.15, spread: 0.65 });
    const lo = st('F.low', G, { hall: 0.15 }), pc = st('F.pc', G, { hall: 0.25, cath: 0.15 }), sn = st('F.sn', G, { hall: 0.14, room: 0.15, pan: 0.15 }), ch = st('F.choir', G, { hall: 0.3, cath: 0.3, spread: 0.75 });
    // f1：ゆっくりした行進。ホルンが主題の頭をうたう
    const bt = 0.7;
    for (let t = t0, i = 0; t < tCab - 0.1; t += bt * 0.5, i++) { K.strings(lo, t, 0.2, [i % 8 === 6 ? 'G1' : 'C2', i % 8 === 6 ? 'G2' : 'C3'], 0.75, { stac: 0.28 }); if (i % 4 === 0) K.timp(pc, t, i % 8 === 0 ? 'C2' : 'G2', 0.42); }
    for (let t = t0 + bt; t < tCab - 0.1; t += bt * 2) { K.snare(sn, t, 0.2); K.snare(sn, t + bt * 0.75, 0.12); K.snare(sn, t + bt, 0.22); }
    theme((n, t, d) => { if (t < tCab + 0.3) K.brass(hn, t, d * 0.95, [n - 12], 0.62, { bright: 0.6, a: 0.07, r: 0.3 }); }, t0 + 0.9 + bt, bt, 0, 2);
    K.strings(sr, t0 + 0.3, tCab - t0, ['C3', 'G3', 'E4'], 0.4, { a: 1.2, r: 0.8 });
    // f2：船内。弦の持続と静かな鼓動
    K.strings(sr, tCab, (tCnt - tCab) * 0.5 + 0.2, ['A2', 'E3', 'G3', 'C4'], 0.42, { a: 0.5, r: 0.6 });
    K.strings(sr, tCab + (tCnt - tCab) * 0.5, (tCnt - tCab) * 0.5 + 0.2, ['F2', 'C3', 'F3', 'A3', 'C4'], 0.48, { a: 0.5, r: 0.6 });
    for (let t = tCab, i = 0; t < tCnt - 0.1; t += bt * 0.5, i++) K.strings(lo, t, 0.2, [t < tCab + (tCnt - tCab) * 0.5 ? 'A1' : 'F1'], 0.5, { stac: 0.24 });
    // f3：秒読み。属音の上で張りつめる
    K.strings(sr, tCnt, tLift - tCnt + 0.3, ['G2', 'D3', 'G3', 'D4', 'G4'], 0.55, { a: 0.4, r: 0.4, trem: 7.5 });
    K.sub(lo, tCnt, tLift - tCnt, 'G1', 0.35, 0.6, 0.4);
    for (const c of cues) if ((c.name === 'beep' || c.name === 'beepHi') && c.t >= tCnt - 1e-6 && c.t < tIgn) { K.kick(pc, c.t, 0.55); K.timp(pc, c.t, 'G1', 0.3); }
    const tI = cueT('ignite', tCnt, tLift) ?? tIgn;
    K.snareRoll(sn, tI, tHit - tI - 0.02, 0.06, 0.62, 22);
    K.timpRoll(pc, tIgn, tHit - tIgn - 0.02, 'G1', 0.12, 0.75);
    K.brass(br, tIgn, tHit - tIgn - 0.1, ['G2', 'D3', 'G3', 'B3', 'D4', 'F4'], 0.5, { a: (tHit - tIgn) * 0.8, r: 0.1, bright: 0.8 });
    K.swell(pc, tHit, 2.2, 0.45);
    // f5〜：離床。主題を全合奏で（轟音に負けないよう、専用の通り道で少し持ち上げる）
    const bb = 0.625;
    const brT = st('F.brT', G, { hall: 0.28, cath: 0.2, spread: 0.45, gain: 1.3 }), srT = st('F.strT', G, { hall: 0.25, cath: 0.15, pan: 0.1, spread: 0.7, gain: 1.3 });
    theme((n, t, d) => { if (t < t1 + 0.6) { K.brass(brT, t, d * 0.95, [n, n - 12], 1.0, { a: 0.04, r: 0.25 }); K.strings(srT, t, d, [n + 12], 0.7, { a: 0.08, r: 0.3 }); } }, tHit, bb, 0, 4);
    for (let b = 0; b < 5; b++) halves(PROG[b]).forEach((cn, h) => {
      const [root, tri] = CH[cn], t = tHit + (b * 4 + h * 2) * bb;
      if (t > t1 + 0.4) return;
      K.brass(hn, t, bb * 2, tri, 0.7, { bright: 0.7, a: 0.05, r: 0.2 });
      K.choir(ch, t, bb * 2 + 0.2, tri.map((n) => nn(n) + 12), 0.55);
      K.sub(lo, t, bb * 2, root, 0.42, 0.03, 0.15); K.timp(pc, t, nn(root) + 12, 0.7);
      for (let i = 0; i < 8; i++) K.strings(sr, t + i * bb * 0.25, 0.1, [nn(tri[i % 3]) + 12], 0.55, { stac: 0.16, thin: true });
      for (let i = 0; i < 2; i++) { K.snare(sn, t + (i + 0.5) * bb, 0.26); K.snare(sn, t + (i + 0.75) * bb, 0.14); }
    });
    K.crash(pc, tHit, 0.55, 2.6); K.crash(pc, tHit + 8 * bb, 0.4, 2.2);
  });

  // =====================================================================
  // G：宇宙（切り離し → 無重力 → 「美しく青きドナウ」→ 地球の出）
  // =====================================================================
  part('g1_stage', has('g1_stage'), () => {
    const t0 = M.g1_stage, t1 = has('g3_coast') ? M.g3_coast : (endOf('g2_zero') ?? t0 + 11.6);
    const G = sec(t0, t1, 1.0, 0.5);
    const cl = st('G.cel', G, { hall: 0.3, cath: 0.3, pan: 0.1, spread: 0.5 }), pd = st('G.pad', G, { hall: 0.3, cath: 0.35, spread: 0.8 }), ar = st('G.arp', G, { hall: 0.3, cath: 0.3, pan: -0.1, spread: 0.65 });
    const T1 = t0 + 2.2, bar = Math.max(1.6, (t1 - T1 - 0.6) / 4), bt = bar / 4;
    theme((n, t, d) => { if (t < t1 - 0.1) { K.celesta(cl, t, n + 12, 0.42); K.celesta(cl, t, n, 0.18); } }, T1, bt, 4, 8);
    [['E3', 'G3', 'C4', 'B4'], ['F3', 'A3', 'C4', 'E4'], ['D3', 'F3', 'A3', 'C4'], ['C3', 'G3', 'D4', 'E4']].forEach((c, i) => K.pad(pd, T1 + i * bar, bar + 0.6, c, 0.4, { a: 0.6, r: 1.0 }));
    for (let t = t0 + 0.8; t < t1 - 0.3; t += 0.42 + r() * 0.5) K.bell(ar, t, [84, 86, 88, 91, 93, 96][Math.floor(r() * 6)], 0.1 + r() * 0.06, 1.4, 2);
  });
  part('g3_coast', has('g3_coast'), () => {
    // ---- ワルツ「美しく青きドナウ」（ニ長調）
    const t0 = M.g3_coast, t1 = has('g4_earthrise') ? M.g4_earthrise : (endOf('g3_coast') ?? t0 + 8);
    const G = sec(t0, t1 + 0.8, 0.3, 1.2);
    const vs = st('W.str', G, { hall: 0.32, cath: 0.22, pan: -0.1, spread: 0.6 }), bl = st('W.bell', G, { hall: 0.35, cath: 0.2, pan: 0.25, spread: 0.5 }), bs = st('W.bass', G, { hall: 0.12 }), ac = st('W.acc', G, { hall: 0.25, pan: 0.1, spread: 0.45 });
    const nPh = Math.max(1, Math.round((t1 - t0 - 0.45) / (12 * 0.31)));
    const q = Math.min(0.34, Math.max(0.27, (t1 - t0 - 0.45) / (12 * nPh))), bar = q * 3;
    // 和音：[低音, 伴奏の和音, ゆらめく弦]。句：[弱起からの 5 音, こだま 1, こだま 2, 前半 2 小節の和音, 後半 2 小節の和音]
    const DD = ['D2', [66, 69, 74], ['D4', 'F#4', 'A4']], A7 = ['A1', [67, 69, 73], ['C#4', 'E4', 'G4']], GG = ['G1', [67, 71, 74], ['D4', 'G4', 'B4']];
    const PH = [
      [[62, 62, 66, 69, 69], [78, 81], [74, 78], DD, DD], [[62, 62, 66, 69, 69], [78, 81], [76, 79], DD, A7],
      [[61, 61, 64, 71, 71], [79, 83], [76, 79], A7, A7], [[61, 61, 64, 71, 71], [79, 83], [78, 81], A7, DD],
      [[62, 62, 66, 69, 74], [81, 86], [78, 81], DD, DD], [[62, 62, 66, 69, 74], [81, 86], [79, 83], DD, GG],
    ];
    const tr = st('W.trem', G, { hall: 0.35, cath: 0.25, spread: 0.8 });
    K.strings(vs, t0, 0.5 + q, ['D4', 'F#4', 'A4'], 0.3, { a: 0.2, r: 0.3, trem: 9 });
    for (let p = 0; p < Math.min(nPh, PH.length); p++) {
      const tp = t0 + 0.45 + p * bar * 4;       // 弱起の時刻
      if (tp + q * 4 > t1 + 0.05) break;
      const [mel, e1, e2, hA, hB] = PH[p], b1 = tp + q;
      const play = (n, t, d) => { K.strings(vs, t, d, [n, n + 12], 0.95, { a: 0.07, r: 0.22 }); K.celesta(bl, t, n + 12, 0.24); };
      play(mel[0], tp, q * 0.9); play(mel[1], b1, q * 0.9); play(mel[2], b1 + q, q * 0.9); play(mel[3], b1 + 2 * q, q * 0.95); play(mel[4], b1 + 3 * q, q * 2.6);
      for (const [e, tb] of [[e1, b1 + bar], [e2, b1 + bar * 2]]) for (const o of [1, 2]) e.forEach((n) => K.bell(bl, tb + o * q, n, 0.46, 0.5, 2));
      for (let b = 0; b < 4; b++) {
        const tb = b1 + b * bar, [bass, acc] = b < 2 ? hA : hB;
        K.pizz(bs, tb, nn(bass) + (b % 2 ? 7 : 0) + 12, 0.85, 0.5);
        for (const o of [1, 2]) acc.forEach((n) => K.strings(ac, tb + o * q, 0.1, [n - 12], 0.48, { stac: 0.16 }));
      }
      // ゆらめく弦（トレモロ）をうすく敷く
      [hA, hB].forEach((h, k) => K.strings(tr, b1 + k * 2 * bar - 0.05, bar * 2 + 0.1, h[2], 0.2, { a: 0.35, r: 0.45, trem: 9.5 }));
    }
  });
  part('g4_earthrise', has('g4_earthrise'), () => {
    const t0 = M.g4_earthrise, t1 = endOf('g4_earthrise') ?? t0 + 7;
    const tw = cueT('wonder', t0, t1) ?? t0 + 2.2;
    const G = sec(t0, t1 + 0.6, 0.8, 1.2);
    const pd = st('R.pad', G, { hall: 0.3, cath: 0.4, spread: 0.8 }), cho = st('R.choir', G, { hall: 0.3, cath: 0.45, spread: 0.75 }), lo = st('R.low', G, { hall: 0.1 });
    K.pad(pd, t0, tw - t0 + 1, ['D3', 'A3', 'E4', 'F#4'], 0.6, { a: 1.2, r: 1.5 });
    K.sub(lo, t0 + 0.4, t1 - t0, 'D2', 0.3, 1.2, 1.0);
    K.choir(cho, tw - 0.4, t1 - tw + 0.4, ['F#4', 'A4', 'D5'], 0.45); K.choir(cho, tw + 0.4, t1 - tw - 0.4, ['A3', 'D4'], 0.38, 'o');
    K.strings(pd, tw, t1 - tw, ['D3', 'A3', 'F#4', 'A4', 'C#5', 'E5'], 0.6, { a: 1.6, r: 1.2 });
    [86, 90, 93, 97].forEach((n, i) => K.celesta(pd, tw + 1.0 + i * 0.5, n, 0.4));
  });

  // =====================================================================
  // H：月着陸（張りつめた鼓動。着陸の直後に、すべての音が止まる）
  // =====================================================================
  part('h1_sep', has('h1_sep'), () => {
    const t0 = M.h1_sep;
    const tA = M.h2_alarm ?? t0 + 4.6, tT = M.h3_touch ?? tA + 4.8;
    const tS = cueT('silence', t0) ?? ((endOf('h3_touch') ?? tT + 8) - 2.9);
    const G = sec(t0, tS + 0.02, 0.5, 0.12);
    const bs = st('H.bass', G, {}), sr = st('H.str', G, { hall: 0.22, cath: 0.15, spread: 0.7 }), dr = st('H.dr', G, { hall: 0.08, room: 0.15, pan: 0.2 }), br = st('H.br', G, { hall: 0.25, cath: 0.15, spread: 0.45 });
    const s16 = 60 / 138 / 4;
    const acc = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0];
    for (let t = t0 + 0.4, i = 0; t < tS - 0.05; t += s16, i++) {
      const a = acc[i % 16], tense = t >= tA ? 1 : 0;
      // レの連打。警報からは、ところどころ半音上（ミ♭）をはさんで、とがらせる
      K.gbass(bs, t, tense && (i % 16 === 7 || i % 16 === 15) ? 39 : 38, s16 * 0.7, (a ? 0.62 : 0.3) * (0.8 + 0.25 * tense), false);
      if (i % 2 === 0) K.hat(dr, t, i % 4 === 2 ? 0.26 : 0.14);
      if (tense && i % 16 === 0) K.kick(dr, t, 0.6);
    }
    K.strings(sr, t0 + 0.2, tA - t0, ['D3', 'A3', 'D4', 'F4'], 0.45, { a: 0.8, r: 0.5, trem: 8 });
    K.strings(sr, tA, tT - tA, ['D3', 'A3', 'Eb4', 'F4'], 0.55, { a: 0.2, r: 0.4, trem: 9 });
    for (let t = tA + 0.4; t < tT - 0.3; t += 60 / 138 * 2) K.brass(br, t, 0.14, ['D3', 'A3', 'D4', 'Eb4'], 0.6, { a: 0.01, r: 0.08 });
    // h3：降下。上の音が半音ずつせり上がる
    const steps = Math.max(3, Math.floor((tS - tT) / 1.0)), L = (tS - tT) / steps;
    for (let i = 0; i < steps; i++) K.strings(sr, tT + i * L, L + 0.1, ['D3', 'A3', nn('F4') + i, nn('A4') + i], 0.5 + 0.06 * i, { a: 0.15, r: 0.2, trem: 9 + i * 0.5 });
    K.timpRoll(dr, tS - 1.6, 1.5, 'D2', 0.08, 0.6);
    K.sub(bs, tT, tS - tT, 'D1', 0.3, 1.5, 0.05);
  });

  // =====================================================================
  // I：中継 → 最後の一段 → 最初の一歩 → あの言葉 → エンド
  // =====================================================================
  part('i1_tv', has('i1_tv'), () => {
    const t0 = M.i1_tv, t1 = M.i2_pause ?? (endOf('i1_tv') ?? t0 + 7.6);
    const G = sec(t0, t1 + 0.3, 1.0, 0.6);
    const dn = st('I.drone', G, { hall: 0.1, cath: 0.2 });
    K.sub(dn, t0, t1 - t0, 'C2', 0.11, 1.5, 0.8); K.sub(dn, t0, t1 - t0, 'G2', 0.05, 1.5, 0.8);
  });
  const tBig = cueT('bighit') ?? (has('i3_step') ? M.i3_step + 1.6 : undefined);
  part('bighit', tBig !== undefined, () => {
    const t0 = M.i2_pause ?? tBig - 6.5, tF = M.i4_final ?? tBig + 3.6;
    const G = sec(t0, tF + 3.0, 0.6, 2.6);
    const hi = st('Z.hi', G, { hall: 0.3, cath: 0.35, pan: 0.2, spread: 0.5 }), og = st('Z.org', G, { hall: 0.2, cath: 0.3 }), tp = st('Z.tp', G, { hall: 0.3, cath: 0.3 });
    const br = st('Z.br', G, { hall: 0.3, cath: 0.3, gain: 1.3, spread: 0.5 }), pc = st('Z.pc', G, { hall: 0.3, cath: 0.3, gain: 1.2 }), sr = st('Z.str', G, { hall: 0.3, cath: 0.3, gain: 1.3, spread: 0.75 });
    const tpC = st('Z.tpC', G, { hall: 0.3, cath: 0.3, gain: 1.3, spread: 0.4 });
    // 息をのむ高い弦と、低い持続音
    K.strings(hi, t0 + 0.3, tBig - t0 - 0.5, ['G6'], 0.2, { a: 1.5, r: 0.3, trem: 8, thin: true });
    K.sub(og, Math.max(t0 + 0.8, tBig - 6.2), tBig - Math.max(t0 + 0.8, tBig - 6.2) + 3.5, 'C1', 0.5, 2.0, 1.5);
    K.pad(og, tBig - 5.2, 8.6, ['C2', 'C3'], 0.5, { a: 2, r: 1.5, f0: 200, f1: 500 });
    // ツァラトゥストラ：ド ― ソ ― ド ……
    const D = 1.5;
    [['C4', 0.55], ['G4', 0.65], ['C5', 0.8]].forEach(([n, v], i) => K.brass(tp, tBig - D * (3 - i), D * 0.97, [n], v, { a: 0.09, r: 0.12, bright: 0.9 + i * 0.1 }));
    K.timpRoll(pc, tBig - 1.3, 1.05, 'C2', 0.05, 0.4);
    // 短調の和音を一瞬 → 長調の大きな和音（最初の一歩）
    K.brass(br, tBig - 0.24, 0.2, ['C3', 'G3', 'C4', 'Eb4', 'G4', 'C5', 'Eb5'], 0.85, { a: 0.015, r: 0.03 });
    K.brass(br, tBig, 3.3, ['C3', 'G3', 'C4', 'E4', 'G4', 'C5', 'E5'], 1.0, { a: 0.02, r: 1.2 });
    K.brass(tpC, tBig, 3.3, ['E5', 'G5', 'C6'], 0.75, { a: 0.02, r: 1.2, bright: 1.2 });
    K.strings(sr, tBig, 3.6, ['C2', 'G2', 'C3', 'E4', 'G4', 'C5', 'E5', 'G5'], 0.95, { a: 0.03, r: 1.4 });
    K.crash(pc, tBig, 0.7, 3.2); K.boomSub(og, tBig, 0.75, 2.2, 66, 32.7);
    K.timp(pc, tBig, 'C2', 1.0);
    for (let i = 0; i < 12; i++) K.timp(pc, tBig + 0.5 + i * 0.235, i % 2 ? 'G1' : 'C2', 0.85 * Math.pow(0.9, i));
  });
  part('i4_final', has('i4_final'), () => {
    const t0 = M.i4_final, t1 = M.i5_end ?? (endOf('i4_final') ?? t0 + 18.5);
    const G = sec(t0, t1 + 0.4, 0.8, 1.6);
    const mb = st('L.mb', G, { hall: 0.3, cath: 0.25, pan: 0.1, spread: 0.5 }), sr = st('L.str', G, { hall: 0.3, cath: 0.25, spread: 0.75 }), br = st('L.br', G, { hall: 0.3, cath: 0.25, spread: 0.45 }), hn = st('L.hn', G, { hall: 0.3, cath: 0.25, pan: -0.2, spread: 0.35 });
    const cho = st('L.choir', G, { hall: 0.3, cath: 0.4, spread: 0.75 }), lo = st('L.low', G, { hall: 0.12 }), pc = st('L.pc', G, { hall: 0.3, cath: 0.25 }), hp = st('L.harp', G, { hall: 0.3, pan: -0.15, spread: 0.55 });
    const bar = Math.min(2.6, Math.max(1.7, (t1 - t0 - 2.6) / 8)), bt = bar / 4, T1 = t0 + 1.0;
    // 前半：静かに（オルゴールと弦）
    theme((n, t, d) => { K.mbox(mb, t, n, 0.5); K.strings(sr, t, d, [n], 0.3, { a: 0.15, r: 0.35, thin: true }); }, T1, bt, 0, 4);
    // 後半：大きく（金管と合唱）
    theme((n, t, d) => { K.brass(br, t, d * 0.96, [n, n - 12], 0.82, { a: 0.05, r: 0.3 }); K.strings(sr, t, d, [n + 12], 0.5, { a: 0.1, r: 0.35 }); K.mbox(mb, t, n + 12, 0.35); }, T1 + 4 * bar, bt, 4, 8);
    for (let b = 0; b < 8; b++) halves(PROG[b]).forEach((cn, h) => {
      const [root, tri] = CH[cn], t = T1 + (b * 4 + h * 2) * bt, big = b >= 4, lastBar = b === 7;
      const len = lastBar ? (h ? 0 : t1 - t + 0.2) : bt * 2 + 0.15;
      if (!len) return;
      K.strings(sr, t, len, [root, ...tri, ...(big ? tri.map((n) => nn(n) + 12) : [])], big ? 0.75 : 0.45, { a: big ? 0.15 : 0.5, r: lastBar ? 1.6 : 0.5 });
      K.sub(lo, t, len, root, big ? 0.4 : 0.22, 0.08, lastBar ? 1.5 : 0.3);
      tri.forEach((n, i) => K.pizz(hp, t + i * bt * 0.5, nn(n) + 12, big ? 0.4 : 0.3, 0.7));
      if (big) { K.brass(hn, t, len, tri, 0.55, { bright: 0.7, a: 0.08, r: lastBar ? 1.4 : 0.25 }); K.choir(cho, t, len + 0.2, tri.map((n) => nn(n) + 12), 0.36); K.timp(pc, t, nn(root) + 12, 0.6); }
    });
    K.swell(pc, T1 + 4 * bar, 1.8, 0.4); K.crash(pc, T1 + 4 * bar, 0.5, 2.6); K.crash(pc, T1 + 7 * bar, 0.4, 3.0);
    K.timpRoll(pc, T1 + 4 * bar - 1.2, 1.15, 'C2', 0.05, 0.5);
  });
  part('i5_end', has('i5_end'), () => {
    const t0 = M.i5_end, t1 = Math.min(K.dur, endOf('i5_end') ?? t0 + 10);
    const G = sec(t0, t1 - 1.0, 0.6, 1.6);
    const mb = st('X.mb', G, { hall: 0.32, cath: 0.3, pan: 0.05, spread: 0.55 }), pd = st('X.pad', G, { hall: 0.3, cath: 0.3, spread: 0.8 });
    const bt = Math.min(0.6, Math.max(0.42, (t1 - t0 - 3.4) / 13));
    theme((n, t, d) => K.mbox(mb, t, n, 0.38), t0 + 0.7 + bt, bt, 0, 2);
    [72, 76, 79, 84].forEach((n, i) => K.mbox(mb, t0 + 0.7 + bt + 8 * bt + i * bt * 0.5, n, 0.36 - i * 0.03));
    K.pad(pd, t0 + 0.3, 4 * bt + 0.3, ['C3', 'G3', 'E4'], 0.36, { a: 1, r: 1 }); K.pad(pd, t0 + 0.7 + 5 * bt, 4 * bt, ['B2', 'G3', 'D4'], 0.32, { a: 0.6, r: 1 });
    K.pad(pd, t0 + 0.7 + 9 * bt, Math.max(0.5, t1 - 2.4 - (t0 + 0.7 + 9 * bt)), ['C3', 'G3', 'C4', 'E4'], 0.36, { a: 0.5, r: 1.2 });
  });
}
