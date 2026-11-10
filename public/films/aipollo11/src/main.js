// 入口：読み込み → 再生 / 静止画の撮影 / 動画の書き出し
import { Engine, FILM_W, FILM_H } from './core/engine.js';
import { World } from './world.js';
import { buildFilm } from './film/index.js';

const qs = new URLSearchParams(location.search);
const mode = qs.get('mode') || 'play';
const F = (window.__film = { ready: false, error: null });
const $ = (id) => document.getElementById(id);
const FPS = 60;

async function main() {
  if (mode !== 'play') $('start').hidden = true;
  if (!navigator.gpu) {
    const b = $('play'); if (b) b.textContent = 'WebGPU が必要です';
    $('msg').textContent = 'この作品は WebGPU を使って、その場で描いています。\nパソコンの Chrome か Edge の最新版で開いてください。';
    F.error = 'WebGPU unavailable'; return;
  }
  const engine = await new Engine().init($('view'));
  const world = new World(engine);
  await world.build(qs);
  const film = buildFilm(engine, world, qs);
  Object.assign(F, { engine, world, film, duration: film.duration });

  F.shots = () => film.shots.map((s) => [s.name, +s.t0.toFixed(2), +s.t1.toFixed(2)]);

  // ---- 静止画（1 枚または一覧）を撮ってサーバーに保存
  F.still = async ({ times, w = 1280, h = 720, cols = 1, name = 'still', label = true }) => {
    const rows = Math.ceil(times.length / cols);
    const sheet = document.createElement('canvas');
    sheet.width = w * cols; sheet.height = h * rows;
    const sctx = sheet.getContext('2d');
    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      const shot = film.frame(t);
      await engine.renderPixels(w, h, Math.round(t * FPS), t);   // 空撮り（後処理の準備）
      const px = await engine.renderPixels(w, h, Math.round(t * FPS), t);
      const img = new ImageData(new Uint8ClampedArray(px.buffer, px.byteOffset, px.byteLength), w, h);
      const x = (i % cols) * w, y = Math.floor(i / cols) * h;
      sctx.putImageData(img, x, y);
      if (label) {
        const txt = `${t.toFixed(2)}s  ${shot.name}`;
        sctx.font = `${Math.max(12, Math.round(h / 30))}px Consolas, monospace`;
        sctx.fillStyle = 'rgba(0,0,0,0.6)'; sctx.fillRect(x, y, sctx.measureText(txt).width + 12, Math.round(h / 22));
        sctx.fillStyle = '#ff0'; sctx.textBaseline = 'top'; sctx.fillText(txt, x + 6, y + 3);
      }
    }
    const blob = await new Promise((r) => sheet.toBlob(r, 'image/jpeg', 0.9));
    const res = await fetch(`/__save?name=${encodeURIComponent(name)}.jpg`, { method: 'POST', body: blob });
    return { ok: res.ok, name: name + '.jpg', n: times.length, w: sheet.width, h: sheet.height };
  };

  // ---- 動画の書き出し：1/60 秒ずつ進めて全コマをサーバーの ffmpeg へ
  F.exportFilm = async ({ from = 0, to = film.duration, fps = FPS, w = FILM_W, h = FILM_H, name = 'video_only.mp4', crf = 16 } = {}) => {
    const total = Math.round((to - from) * fps);
    await fetch(`/__film/start?w=${w}&h=${h}&fps=${fps}&crf=${crf}&name=${encodeURIComponent(name)}`, { method: 'POST' });
    let chain = Promise.resolve();
    const t0 = performance.now();
    F.progress = { done: 0, total };
    for (let k = 0; k < 3; k++) { film.frame(from); await engine.renderPixels(w, h, 0, from); }   // 空撮り
    for (let i = 0; i < total; i++) {
      const t = from + i / fps;
      film.frame(t);
      const px = await engine.renderPixels(w, h, Math.round(t * FPS), t);
      // 応答は必ず読み切る（読まずに捨てると、送ったコマ（約 8 MB）がブラウザーの中に残り続け、1000 コマあたりでメモリが尽きて止まる）
      chain = chain.then(async () => { const r = await fetch('/__film/frame', { method: 'POST', body: px }); await r.arrayBuffer(); });
      if (i % 4 === 3) await chain;
      F.progress.done = i + 1;
      F.progress.fps = (i + 1) / ((performance.now() - t0) / 1000);
    }
    await chain;
    const res = await (await fetch('/__film/end', { method: 'POST' })).json();
    return { ...res, seconds: (performance.now() - t0) / 1000 };
  };

  // 音（あれば）：再生では同期して鳴らし、書き出しでは別に WAV を作る
  if (mode === 'play') {
    try {
      const mod = await import('./audio/audio.js');
      // ?audio=live を付けると、保存済みの音を使わず、その場で合成する（数十秒かかる）
      window.__audio = await mod.createAudio(film, { prepare: true, fresh: qs.get('audio') === 'live', cacheJson: window.__AUDIO_JSON, cacheAudio: window.__AUDIO_FILE });
    } catch (e) { console.warn('音の準備ができませんでした', e); }
    setupPlayer(engine, film);
  }
  F.ready = true;
}

function setupPlayer(engine, film) {
  const canvas = $('view'), hud = $('hud'), btn = $('play');
  let playing = false, t = Number(qs.get('t') || 0), last = performance.now(), audio = null;
  const ready = () => { btn.disabled = false; btn.textContent = '▶ 再生'; if (qs.has('auto')) startPlay(); };
  if (window.__audio) { btn.textContent = '音を準備中…'; window.__audio.prepare().catch((e) => { console.warn('音の合成に失敗しました', e); window.__audio = null; }).finally(() => ready()); }
  else setTimeout(ready, 0);
  const startPlay = async () => {
    $('start').hidden = true;
    if (window.__audio) { audio = window.__audio; await audio.start(t); }
    playing = true; last = performance.now();
  };
  btn.addEventListener('click', startPlay);
  const seek = async (nt) => {
    t = Math.max(0, Math.min(film.duration - 0.01, nt));
    if (audio && playing) await audio.start(t);
  };
  addEventListener('keydown', async (e) => {
    if (e.code === 'Space') { e.preventDefault(); playing = !playing; last = performance.now(); if (audio) { if (playing) await audio.start(t); else audio.stop(); } }
    else if (e.code === 'ArrowRight') seek(t + 5);
    else if (e.code === 'ArrowLeft') seek(t - 5);
    else if (e.code === 'KeyH') hud.hidden = !hud.hidden;
    else if (e.code === 'KeyF') { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); }
    else if (e.code === 'Home') seek(0);
  });
  const STEPS = [1, 0.84, 0.67, 0.5];
  let step = 0, acc = 0, cnt = 0, lastUp = 0;
  const loop = (now) => {
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (playing) {
      t = audio && audio.playing ? audio.time() : t + dt;
      if (t >= film.duration) { t = film.duration - 0.001; playing = false; if (audio) audio.stop(); $('start').hidden = false; btn.textContent = '▶ もう一度'; t = 0; }
    }
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (cw < 8 || ch < 8) return;
    // 描画が追いつかないときは、内部の解像度を段階的に下げる（音に合わせて進むので、遅いとコマが飛ぶだけ）
    if (playing && !qs.has('fixed')) {
      acc += dt; cnt++;
      if (cnt >= 45) {
        const avg = acc / cnt; acc = 0; cnt = 0;
        if (avg > 1 / 26 && step < STEPS.length - 1) step++;
        else if (avg < 1 / 52 && step > 0 && now - lastUp > 6000) { step--; lastUp = now; }
      }
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(Math.min(FILM_W, Math.round(cw * dpr)) * STEPS[step] / 2) * 2, h = Math.round(w * 9 / 32) * 2;
    engine.setSize(w, h);
    const shot = film.frame(t);
    engine.render(Math.round(t * FPS), t);
    if (!hud.hidden) hud.textContent = `${t.toFixed(2)} / ${film.duration.toFixed(1)}s  ${shot.name}  ${w}x${h}`;
  };
  requestAnimationFrame(loop);
}

main().catch((e) => {
  F.error = String((e && e.stack) || e);
  console.error(e);
  const m = $('msg');
  if (m) m.textContent = '読み込みに失敗しました\n' + F.error;
});
