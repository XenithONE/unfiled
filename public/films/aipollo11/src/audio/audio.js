// 音の入口：全編の音（音楽＋効果音）をコードだけで作る。
//   ・film.cues / film.marks / film.shots / film.duration から、その場で組み立てる（時刻の決め打ちなし）
//   ・OfflineAudioContext で全編を一度に合成 → 音量を −16 LUFS にそろえ、ピークを抑える
//   ・再生は、その合成結果を流す（書き出しとまったく同じ音。どの時刻からでも正確に頭出しできる）
//   ・合成には数十秒かかるので、tools/audio.mjs が保存した out/audio.wav が「いまのカット割り」と
//     一致していれば、それを読み込んで使う（一致しなければ、その場で合成する）
import { Kit } from './synth.js';
import { buildSfx } from './sfx.js';
import { buildMusic } from './music.js';
import { master, wavBlob } from './master.js';

/** 音づくりのコードを変えたら上げる（保存済みの音を古いまま使わないため） */
export const AUDIO_VERSION = 11;

function fnv(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, '0'); }

/**
 * @param film  { cues:[{t,name,p}], marks:{名前:開始秒}, shots:[{name,t0,t1,dur}], duration }
 * @param opt   { prepare: すぐ裏で用意を始める / fresh: 保存済みを使わず必ず合成 / save: 合成した音をサーバーに保存（既定：ローカルのみ） }
 *              opt.cacheJson / opt.cacheAudio：保存済みの音の場所（既定は開発サーバーの /out/audio.json と /out/audio.wav。
 *              公開版では、合成した結果を圧縮した audio.opus を同梱して、すぐ再生できるようにしている）
 *              opt.debug は調整用（保存済みは使わなくなる）：{ noSfx, noMusic, noReverb, noComp, raw（仕上げ前の音）, from, to（この秒の間の発音だけ） }
 */
export async function createAudio(film, opt = {}) {
  const snapshot = () => ({
    duration: film.duration,
    cues: (film.cues || []).map((c) => ({ t: c.t, name: c.name, p: c.p || {} })).sort((a, b) => a.t - b.t),
    marks: { ...(film.marks || {}) },
    shots: (film.shots || []).map((s) => ({ name: s.name, t0: s.t0, t1: s.t1, dur: s.dur })),
  });
  const signature = (f = snapshot()) => fnv(JSON.stringify([AUDIO_VERSION, f.duration.toFixed(3), f.cues.map((c) => [c.t.toFixed(3), c.name, c.p]), Object.keys(f.marks).sort().map((k) => [k, f.marks[k].toFixed(3)]), f.shots.map((q) => [q.name, q.t0.toFixed(3), q.t1.toFixed(3)])]));
  const local = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  let rendered = null, pending = null;
  const cacheJson = opt.cacheJson || '/out/audio.json', cacheAudio = opt.cacheAudio || '/out/audio.wav';
  const nocache = local ? { cache: 'no-store' } : {};

  /** 保存済みの out/audio.wav が、いまのカット割りと同じものなら読み込む */
  async function fromCache(sig, sr) {
    try {
      const j = await (await fetch(cacheJson + (local ? '?' + Date.now() : ''), nocache)).json();
      if (!j || j.sig !== sig || j.sampleRate !== sr) return null;
      const buf = await (await fetch(cacheAudio + '?' + sig, nocache)).arrayBuffer();
      if (!/\.wav$/i.test(cacheAudio)) {   // 圧縮した音：ブラウザーに復号してもらう
        const dec = await new OfflineAudioContext(2, 1, sr).decodeAudioData(buf);
        if (Math.abs(dec.duration - j.info.duration) > 0.3) return null;
        const L = dec.getChannelData(0).slice(), R = (dec.numberOfChannels > 1 ? dec.getChannelData(1) : dec.getChannelData(0)).slice();
        return { sr, sig, ch: [L, R], info: { ...j.info, cached: true } };
      }
      const v = new DataView(buf);
      if (v.getUint16(20, true) !== 3 || v.getUint16(22, true) !== 2 || v.getUint32(24, true) !== sr) return null;
      const f = new Float32Array(buf, 44), n = f.length >> 1, L = new Float32Array(n), R = new Float32Array(n);
      for (let i = 0; i < n; i++) { L[i] = f[2 * i]; R[i] = f[2 * i + 1]; }
      return { sr, sig, ch: [L, R], info: { ...j.info, cached: true } };
    } catch { return null; }
  }
  async function toCache(R) {
    try {
      await fetch('/__save?dir=out&name=audio.wav', { method: 'POST', body: wavBlob(R.ch, R.sr) });
      await fetch('/__save?dir=out&name=audio.json', { method: 'POST', body: JSON.stringify({ sig: R.sig, sampleRate: R.sr, info: R.info }) });
    } catch { /* 保存先が無い環境（静的な公開先など）では何もしない */ }
  }

  /** 全編を合成する */
  async function synth(f, sr) {
    const dur = f.duration, t0 = performance.now(), tm = {};
    const ctx = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
    const dbg = opt.debug || {};
    const K = new Kit(ctx, dur, 1969, dbg);
    const nSfx = dbg.noSfx ? 0 : buildSfx(K, f);
    if (!dbg.noMusic) buildMusic(K, f);
    K.applyDucks();
    const nVoices = K.schedule();
    // 最後の 1 秒は無音で終える
    K.out.gain.setValueAtTime(1, Math.max(0, dur - 1.7));
    K.out.gain.linearRampToValueAtTime(0, Math.max(0.01, dur - 1.05));
    tm.build = performance.now() - t0;
    const buf = await ctx.startRendering();
    tm.render = performance.now() - t0 - tm.build;
    const ch = [buf.getChannelData(0).slice(), buf.getChannelData(1).slice()];
    const info = dbg.raw ? { raw: true } : master(ch, sr, -16);   // raw：仕上げ前の音（釣り合いの確認用）
    const z = Math.max(0, Math.floor((dur - 1.0) * sr));
    for (const x of ch) x.fill(0, z);
    tm.master = performance.now() - t0 - tm.build - tm.render;
    for (const k in tm) tm[k] = +(tm[k] / 1000).toFixed(2);
    return { sr, sig: signature(f), ch, info: { ...info, timing: tm, duration: dur, sampleRate: sr, sfxCues: nSfx, voices: nVoices, renderSeconds: +((performance.now() - t0) / 1000).toFixed(2) } };
  }

  /** 音を用意する（保存済みがあれば読み込み、無ければ合成。同じ条件なら 1 回だけ） */
  function render(sr = 48000, fresh = false) {
    if (rendered && rendered.sr === sr && !(fresh && rendered.info.cached)) return Promise.resolve(rendered);
    if (pending && pending.sr === sr && pending.fresh >= fresh) return pending.promise;
    const promise = (async () => {
      const f = snapshot();
      let R = null;
      const useCache = !fresh && !opt.fresh && !opt.debug;
      if (useCache) R = await fromCache(signature(f), sr);
      if (!R) {
        R = await synth(f, sr);
        if (useCache && (opt.save ?? local)) toCache(R);
      }
      rendered = R; pending = null;
      return R;
    })();
    pending = { sr, fresh, promise };
    return promise;
  }

  let actx = null, src = null, buffer = null, bufferOf = null, startedAt = 0, offset = 0, playing = false;
  const api = {
    get playing() { return playing; },
    /** 合成の結果（音量・ピークなど）。まだなら null */
    get info() { return rendered ? rendered.info : null; },
    /** いまのカット割りの署名（保存済みの音と照合するための値） */
    get signature() { return rendered ? rendered.sig : signature(); },
    /** 先に用意だけ済ませておく */
    prepare: () => render().then((r) => r.info),
    /** カットを書き換えたあとに呼ぶと、次回は作り直す */
    invalidate() { rendered = null; buffer = null; },
    /** 全編の秒 t から再生（再生中なら頭出しし直す） */
    async start(t = 0) {
      const R = await render();
      api.stop();
      if (!actx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        try { actx = new AC({ sampleRate: R.sr, latencyHint: 'interactive' }); } catch { actx = new AC(); }
      }
      if (actx.state === 'suspended') { try { await actx.resume(); } catch { /* 操作前は鳴らせないことがある */ } }
      if (!buffer || bufferOf !== R) { buffer = actx.createBuffer(2, R.ch[0].length, R.sr); buffer.copyToChannel(R.ch[0], 0); buffer.copyToChannel(R.ch[1], 1); bufferOf = R; }
      offset = Math.max(0, Math.min(t, R.info.duration - 0.02));
      const node = actx.createBufferSource();
      node.buffer = buffer; node.connect(actx.destination);
      startedAt = actx.currentTime + 0.03;
      node.start(startedAt, offset);
      node.onended = () => { if (src === node) { offset = api.time(); playing = false; src = null; } };
      src = node; playing = true;
    },
    stop() {
      if (src) { offset = api.time(); const n = src; src = null; try { n.onended = null; n.stop(); n.disconnect(); } catch { /* すでに止まっている */ } }
      playing = false;
    },
    /** いま鳴っている位置（全編の秒）。映像はこれに合わせる */
    time() {
      if (!playing || !actx) return offset;
      const lat = (actx.outputLatency || actx.baseLatency || 0);
      return Math.min(rendered ? rendered.info.duration : Infinity, offset + Math.max(0, actx.currentTime - startedAt - lat));
    },
    /** 全編を 32 bit 浮動小数のステレオ WAV にして返す。o.fresh で必ず合成し直す */
    async renderOffline(sampleRate = 48000, o = {}) { const R = await render(sampleRate, !!o.fresh); return wavBlob(R.ch, R.sr); },
  };
  if (opt.prepare) render().catch((e) => console.error('audio render failed', e));
  return api;
}
