// 第 3 幕：夜の焚き火 → ひらめき → 4 つの案をひとつに → 組み立て
import * as L from './lib.js';
const { seg, ease, pop, popInOut, lerp, mv, camK, place4, hop, hops, walk, leap, poofs, NAMES, PAD, DECK, dayYard, nightYard, fades, OV, Puffs, Sparkles, glowSprite, clamp, bump, NIGHT_MOON, SAT } = L;

export function seq3(film, W) {
  const E = W.engine;
  const FIRE = [0, 0, 4.4];
  const SITD = { claude: [-2.0, 0, 3.1], gpt: [-0.75, 0, 2.6], gemini: [0.8, 0, 2.6], grok: [2.0, 0, 3.2] };
  const S0 = { claude: [-1.75, 5.7, 0.4], gpt: [-0.6, 6.1, -0.3], gemini: [0.55, 6.0, 0.25], grok: [1.7, 5.6, -0.5] };
  const S1 = { claude: [-0.77, 5.37, 0], gpt: [0.77, 5.37, 0], gemini: [-0.77, 6.43, 0], grok: [0.77, 6.43, 0] };
  const sheets = (k, final = 0) => {
    for (const n of NAMES) {
      const a = S0[n], b = S1[n], m = W.sheets[n];
      m.visible = final < 1; m.position.set(lerp(a[0], b[0], k), 0.02 + 0.01 * NAMES.indexOf(n), lerp(a[1], b[1], k)); m.rotation.set(-Math.PI / 2, 0, lerp(a[2], b[2], k)); m.scale.setScalar(1);
    }
    const f = W.sheets.final; f.visible = final > 0;
    if (final > 0) { f.position.set(0, 0.06 + 0.5 * bump(final, 0, 1) * 0, 5.9); f.rotation.set(-Math.PI / 2, 0, 0); f.scale.setScalar(2.05 * (0.9 + 0.1 * ease.back(clamp(final)))); }
  };
  W.campfire.prewarm(W, film.duration);   // 再生のとき、焚き火の場面の頭で止まらないように先に用意する
  const campNight = (t, o = {}) => {
    nightYard(W, { fillI: 0.3, size: 14, center: [0, 0, 4], ...o });
    W.yard.blueprint('goal');
    W.campfire.root.position.set(...FIRE); W.campfire.burn(W.T, o.fire ?? 1, W);   // 通しの時刻で燃やす（カットをまたいで炎が続く）
    W.safe.root.visible = true; W.safe.root.position.set(0, 0.3, -15);
  };
  const sadFaces = () => { W.claude.eyes('sad'); W.gpt.face('sad'); W.gemini.eyes('sad').float(0.05, false); W.grok.eyes('sad').look(0, -0.2); };

  // ---- D1：焚き火を囲んで、しょんぼり
  film.shot('d1_sad', 6, (t) => {
    campNight(t);
    place4(W, SITD, [0, 4.8]);
    sadFaces();
    sheets(0);
    W.say('dots', W.gemini, popInOut(t, 1.2, 3.0));
    if (t > 3.4) { const k = ease.io(seg(t, 3.4, 4.3)); W.claude.eyes('open').gaze(0, 0.35 * k).lean(-0.22 * k, 0); }
    camK(W, ease.io(seg(t, 0, 6)), { p: [0.3, 1.0, 12.4], t: [0, 2.2, 3], f: 34 }, { p: [0.2, 1.0, 11.2], t: [0, 2.1, 3], f: 34 });
    fades(W, t, 6, 0.5, 0);
  }, [[0, 'amb_night', { dur: 18 }], [0, 'fire', { dur: 18 }], [1.2, 'pop'], [2.0, 'sigh']]);

  // ---- D2：Claude、考える……ひらめく
  film.shot('d2_think', 4, (t) => {
    campNight(t);
    place4(W, SITD, [0, 4.8]);
    sadFaces();
    sheets(0);
    const idea = t > 2.7;
    const c = W.claude;
    c.eyes(idea ? (t > 3.0 ? 'happy' : 'wide') : 'open').gaze(t < 1.0 ? 0 : 0.2, t < 1.0 ? 0.35 : -0.3).lean(t < 1.0 ? -0.22 : 0.15, 0);
    if (idea) { hop(c, t, 2.75, 0.4, 0.4); c.arms(1.0, 1.0); }
    camK(W, ease.io(seg(t, 0, 4)), { p: [0.2, 1.0, 7.0], t: [-1.8, 1.0, 3.1], f: 26 }, { p: [-0.05, 1.0, 6.6], t: [-1.8, 1.05, 3.1], f: 26 });   // 手前の炎は画面の右端にかかる程度に
    W.post.focus.value = 4.6; W.post.focal.value = 4.5; W.post.bokeh.value = 3.5;
    // 考え中の印（回る）→ ひらめきで光る
    const k = pop(t, 1.0, 0.3);
    if (k > 0) {
      const s = W.spark; s.visible = true;
      s.position.set(SITD.claude[0], 1.5 + (idea ? 0.1 * bump(t, 2.7, 0.5) : 0), SITD.claude[2]);
      s.quaternion.copy(W.camera.quaternion); s.rotateZ(idea ? 0 : -t * 3.2);
      s.scale.setScalar(k * (idea ? 0.95 + 0.4 * bump(t, 2.7, 0.35) : 0.7 + 0.06 * Math.sin(t * 9)));
    }
    if (idea) W.post.flash.value = 0.25 * Math.exp(-(t - 2.7) * 14);
  }, [[1.0, 'think', { dur: 1.7 }], [2.7, 'ding']]);

  // ---- D3：4 つの案を、ひとつに
  const mergeFx = new Sparkles(120, (i, rnd) => {
    const th = rnd() * 6.283, sp = 1.5 + rnd() * 4;
    return { t: 2.25 + rnd() * 0.12, life: 0.6 + rnd() * 0.7, size: 0.2 + rnd() * 0.35, p: [0, 0.2, 5.9], v: [Math.cos(th) * sp, 1 + rnd() * 3, Math.sin(th) * sp], drag: 2.2 };
  }, { rainbow: true, seed: 91, gain: 2.4 });
  W.add(mergeFx.mesh);
  film.shot('d3_merge', 4.6, (t) => {
    campNight(t, { fillI: 0.5 });
    place4(W, SITD, [0, 5.9]);
    const k = ease.io(seg(t, 0.5, 2.0));
    const fin = seg(t, 2.25, 2.7);
    sheets(k, fin);
    mergeFx.show(t);
    if (t > 2.25) W.post.flash.value = 0.55 * Math.exp(-(t - 2.25) * 12);
    // 押し寄せる 4 人
    const near = { claude: [-2.5, 0, 5.2], gpt: [-1.1, 0, 3.9], gemini: [1.1, 0, 3.9], grok: [2.5, 0, 5.3] };
    NAMES.forEach((n, i) => { const a = W[n]; const u = ease.io(seg(t, 0.2 + i * 0.1, 1.4 + i * 0.1)); const p = mv(SITD[n], near[n], u); a.at(p[0], 0, p[2]).faceTo(0, 5.9); if (u > 0 && u < 1 && a.walk) a.walk(t * 14); });
    const wow = t > 2.3;
    W.claude.eyes(wow ? 'happy' : 'keen').arms(0.2, wow ? 1.0 : 0.3); W.gpt.face(wow ? 'wide' : 'eyes'); W.gemini.eyes(wow ? 'wide' : 'open'); W.grok.eyes(wow ? 'wide' : 'straight').look(0, -0.3);
    if (wow) NAMES.forEach((n, i) => hop(W[n], t, 2.9 + i * 0.1, 0.4, 0.35));
    const ic = { claude: 'list', gpt: 'code', gemini: 'star', grok: 'fire' };
    NAMES.forEach((n, i) => { const a = S0[n], b = S1[n]; W.sayAt(ic[n], [lerp(a[0], b[0], k), 0.3, lerp(a[1], b[1], k)], popInOut(t, 0.6 + i * 0.15, 2.2), { size: 0.6, tail: 'none' }); });
    camK(W, ease.io(seg(t, 0, 4.6)), { p: [0, 6.6, 9.6], t: [0, 0, 5.6], f: 30 }, { p: [0, 5.6, 9.9], t: [0, 0.2, 5.5], f: 30 });
    if (t > 2.6) OV.subtitle(E, 'それぞれの得意を、ひとつに。', seg(t, 2.6, 2.9));
  }, [[0.5, 'slide', { dur: 1.5 }], [0.6, 'pop'], [0.75, 'pop'], [0.9, 'pop'], [1.05, 'pop'], [2.25, 'magic'], [2.9, 'jump']]);

  // ---- D4：手を重ねる
  const teamFx = new Sparkles(150, (i, rnd) => {
    const th = rnd() * 6.283, ph = rnd() * 1.4, sp = 2 + rnd() * 6;
    return { t: 1.75 + rnd() * 0.1, life: 0.7 + rnd() * 0.8, size: 0.25 + rnd() * 0.4, p: [0, 1.0, 3.0], v: [Math.cos(th) * Math.cos(ph) * sp, Math.sin(ph) * sp, Math.sin(th) * Math.cos(ph) * sp], drag: 2.2 };
  }, { rainbow: true, seed: 95, gain: 2.6 });
  W.add(teamFx.mesh);
  film.shot('d4_team', 3.4, (t) => {
    campNight(t, { fillI: 0.55, fire: 0.78 });   // 手前の炎が手を重ねる芝居にかからない高さに
    W.yard.blueprint('final');
    const C = [0, 0, 3.0];
    const from = { claude: [-2.6, 0, 3.4], gpt: [-1.2, 0, 1.4], gemini: [1.2, 0, 1.4], grok: [2.6, 0, 3.5] };
    const to = { claude: [-1.25, 0, 3.15], gpt: [-0.55, 0, 2.0], gemini: [0.6, 0, 2.0], grok: [0.95, 0, 3.2] };
    NAMES.forEach((n, i) => { const a = W[n]; const u = ease.out3(seg(t, 0.15 + i * 0.12, 1.2 + i * 0.12)); const p = mv(from[n], to[n], u); a.at(p[0], 0, p[2]).faceTo(C[0], C[2]); if (u > 0 && u < 1 && a.walk) a.walk(t * 14); });
    const hit = 1.75, k = ease.out(seg(t, 1.3, hit));
    W.claude.eyes('happy').arms(0, 0.2 + 0.5 * k, 0, 0.9 * k);
    W.gpt.face('happy').arms(0.4 * k, 0, 1.1 * k, 0);
    W.gemini.eyes('happy').hands(mv([-0.42, 0.42, 0.12], [-0.25, 0.35, 0.9], k), null);
    W.grok.eyes('happy').look(-0.4, 0.2);
    if (t > hit) { NAMES.forEach((n, i) => hop(W[n], t, hit + 0.05 + i * 0.05, 0.45, 0.5)); W.post.flash.value = 0.7 * Math.exp(-(t - hit) * 10); }
    teamFx.show(t);
    camK(W, ease.io(seg(t, 0, 3.4)), { p: [0, 3.2, 9.4], t: [0, 0.9, 3.0], f: 32 }, { p: [0, 2.6, 8.4], t: [0, 0.95, 3.0], f: 32 });
    W.post.fade.value = seg(t, 3.0, 3.4); W.post.fadeColor.value.setRGB(1, 1, 1);
  }, [[1.75, 'hit'], [1.75, 'yay'], [1.8, 'jump']]);

  // =====================================================================
  // E：組み立て（それぞれの持ち場）
  // =====================================================================
  const tag = (t, txt, t0 = 0.3, t1 = 99) => { if (t > t0 && t < t1) OV.subtitle(E, txt, Math.min(seg(t, t0, t0 + 0.25), 1 - seg(t, t1 - 0.2, t1))); };

  // ---- E1：GPT が誘導プログラムを書く
  const bits = new Sparkles(60, (i, rnd) => {
    const t0 = 0.4 + (i / 60) * 2.0;
    return { t: t0, life: 0.5, size: 0.14 + rnd() * 0.1, p: [-0.3 + (rnd() - 0.5) * 0.2, 1.05, 1.2], v: [3.4, 2.2 * (0.6 + rnd() * 0.8), -0.4 + (rnd() - 0.5) * 0.6], drag: 0.6, hue: 0.0 };
  }, { color: 0x74ecff, seed: 97, gain: 2.6 });
  W.add(bits.mesh);
  film.shot('e1_code', 3.6, (t) => {
    dayYard(W, { size: 12 });
    W.yard.blueprint('final');
    const done = t > 2.6;
    W.gpt.at(-1.15, 0, 1.3, 1.2);
    W.crate.visible = true; W.crate.position.set(-0.3, 0.31, 1.2);
    W.laptop.root.visible = true; W.laptop.root.position.set(-0.3, 0.62, 1.2); W.laptop.root.rotation.y = -1.57 + 0.0;
    W.computer.root.visible = true; W.computer.root.position.set(1.45, 0, 0.9); W.computer.root.rotation.y = -0.25;
    if (!done) { W.gpt.face('code', { scroll: t * 12 }).arms(0.1, 0.1, 1.15 + Math.sin(t * 43) * 0.3, 1.15 + Math.cos(t * 39) * 0.3); W.laptop.screen('code', t * 12); W.computer.show('LOADING', '#74ecff', seg(t, 0.4, 2.5)); }
    else { W.gpt.face('check').arms(1.2, 1.2).yaw(0.5); hop(W.gpt, t, 2.65, 0.4, 0.35); W.laptop.screen('ok'); W.computer.show('GO', '#6dff9c'); W.say('check', W.gpt, pop(t, 2.65)); }
    bits.show(Math.min(t, 2.5));
    camK(W, ease.io(seg(t, 0, 3.6)), { p: [1.4, 1.2, 5.6], t: [0.15, 0.85, 1.0], f: 32 }, { p: [1.0, 1.15, 5.1], t: [0.15, 0.85, 1.0], f: 32 });
    W.post.focus.value = 4.6; W.post.focal.value = 7; W.post.bokeh.value = 2.5;
    tag(t, '誘導プログラム：GPT');
    fades(W, t, 3.6, 0.3, 0); W.post.fadeColor.value.setRGB(1, 1, 1);
  }, [[0, 'amb_day', { dur: 8 }], [0.2, 'type', { dur: 2.3 }], [0.4, 'data', { dur: 2.0 }], [2.65, 'ding'], [2.65, 'jump']]);

  // ---- E2：Grok がエンジンを運ぶ（Claude「5 基まで」）
  film.shot('e2_engines', 4.4, (t) => {
    dayYard(W, { size: 14, sunDir: [-0.3, 0.75, 0.6] });
    W.yard.blueprint('final');
    const xs = [-2.6, -1.3, 0, 1.3, 2.6];
    for (let i = 0; i < 4; i++) { const e = W.engines[i]; e.visible = true; e.position.set(xs[i], 0, 0.2); }
    // 5 基目を押してくる
    const u5 = ease.out(seg(t, 0.1, 1.1));
    const e5 = W.engines[4]; e5.visible = true; e5.position.set(lerp(6.2, xs[4], u5), 0, 0.2);
    // 6 基目をこっそり
    const u6 = ease.io(seg(t, 1.4, 2.2)), back = ease.io(seg(t, 3.0, 4.2));
    const x6 = lerp(lerp(7.5, 3.95, u6), 8.5, back);
    const e6 = W.engines[5]; e6.visible = true; e6.position.set(x6, 0, 0.2);
    const gx = t < 1.2 ? lerp(7.1, xs[4] + 0.95, u5) : x6 + (back > 0 ? -0.95 : 0.95);
    W.grok.at(gx, 0, 0.2).eyes(t < 2.3 ? 'angry' : t < 2.9 ? 'wide' : 'flat').look(back > 0 ? 0.6 : -0.6, t > 2.9 ? 0.5 : 0.1).squash(1 - 0.06 * Math.abs(Math.sin(t * 16)));
    // Claude が「5」の札で止める
    const stop = t > 2.2;
    const cu = ease.out3(seg(t, 2.0, 2.3));
    W.claude.at(lerp(-4.2, 3.2, 0) + 0, 0, 1.6).yaw(0.5);
    W.claude.at(-4.0 + 0 * cu, 0, 1.5, 0.6).eyes(stop ? 'keen' : 'open').arms(0.1, stop ? 1.15 : 0.2);
    if (stop) hop(W.claude, t, 2.2, 0.35, 0.3);
    const sg = W.sign5; sg.visible = true; sg.position.set(-3.25, 0.5 + (stop ? 0.5 : 0) * cu + 0.0, 1.62); sg.rotation.set(0, 0.5, stop ? -0.15 : -0.5);
    W.say('cross', W.claude, popInOut(t, 2.25, 3.2), { size: 0.9, dy: 0.5 });
    W.say('sweat', W.grok, popInOut(t, 2.5, 3.3), { size: 0.8 });
    camK(W, ease.io(seg(t, 0, 4.4)), { p: [0.4, 1.6, 11.6], t: [0.5, 0.9, 0.3], f: 36 }, { p: [0.9, 1.5, 10.8], t: [0.8, 0.9, 0.3], f: 36 });
    tag(t, 'エンジン：Grok（5 基まで）');
  }, [[0.1, 'push', { dur: 1.0 }], [1.1, 'clank'], [1.4, 'push', { dur: 0.8 }], [2.2, 'whistle'], [2.25, 'pop'], [3.0, 'push', { dur: 1.2 }]]);

  // ---- E3：Gemini が航路を描く
  const twk = new Sparkles(50, (i, rnd) => ({ t: 0.3 + rnd() * 2.8, life: 0.7 + rnd() * 0.6, size: 0.12 + rnd() * 0.2, p: [(rnd() - 0.5) * 4.2, 1.3 + rnd() * 2.2, 1.2 + (rnd() - 0.5) * 1.2], v: [0, 0.15, 0], drag: 1 }), { rainbow: true, seed: 99, gain: 2.2 });
  W.add(twk.mesh);
  film.shot('e3_nav', 3.8, (t) => {
    W.yard.root.visible = true; W.clouds.root.visible = true; W.yard.launch.visible = false;
    W.env('sunset', 'night', 0.45, { sunDir: [-0.8, 0.14, 0.35], size: 12, fillDir: [0.3, 0.5, 1], fillColor: 0x8fa6e6, fillI: 0.5 });
    W.yard.blueprint('final');
    W.gemini.at(0, 0, 0.9, 0).eyes('happy').hands([-0.75 + 0.1 * Math.sin(t * 3), 1.25, 0.45], [0.75 - 0.1 * Math.sin(t * 3), 1.25, 0.45]);
    W.holo.show(t, seg(t, 0.3, 2.6)); W.holo.root.position.set(0, 2.35, 1.5); W.holo.root.scale.setScalar(1.15); W.holo.root.rotation.y = Math.sin(t * 0.8) * 0.12;
    twk.show(t);
    camK(W, ease.io(seg(t, 0, 3.8)), { p: [-1.6, 1.3, 6.4], t: [0, 1.75, 1.2], f: 34 }, { p: [1.2, 1.4, 6.0], t: [0, 1.8, 1.2], f: 34 });
    W.post.focus.value = 5.6; W.post.focal.value = 8; W.post.bokeh.value = 2.5;
    tag(t, '航路の計算：Gemini');
  }, [[0.3, 'sparkle', { dur: 2.3 }], [2.6, 'ding']]);

  // ---- E4：Claude の最終確認（今度は 3 秒）
  const lamp = W.add(glowSprite(0xffd28a, 3.0, { gain: 0.8, pow: 2.4 }));
  film.shot('e4_check', 3.6, (t) => {
    nightYard(W, { fillI: 1.7, size: 12, light: { fillDir: [-0.5, 0.5, 1], fillColor: 0xffc890 } });
    W.yard.blueprint('final');
    W.claude.at(-0.3, 0, 1.3, 0.2).eyes(t > 2.0 ? 'happy' : 'keen').arms(0.1, t > 2.0 ? 1.1 : 0.7 + 0.25 * Math.abs(Math.sin(t * 9)));
    W.clipboard.visible = true; W.clipboard.position.set(0.62, 0.95, 1.55); W.clipboard.rotation.set(-0.2, 0.1, 0.1);
    lamp.visible = true; lamp.position.set(-1.6, 1.5, 2.0);
    for (let i = 0; i < 3; i++) W.sayAt('check', [-1.2 + i * 1.0, 1.42, 1.3], popInOut(t, 0.45 + i * 0.42, 2.9), { size: 0.7, tail: 'none' });
    if (t > 1.95) { hop(W.claude, t, 2.0, 0.4, 0.4); OV.bigNumber(E, 'GO', 0.42 + 0.3 * pop(t, 1.95, 0.25), 1 - seg(t, 3.2, 3.5), '#6dff9c', 330); }
    camK(W, ease.io(seg(t, 0, 3.6)), { p: [1.9, 1.1, 5.7], t: [0.1, 1.1, 1.3], f: 32 }, { p: [1.6, 1.1, 5.3], t: [0.1, 1.1, 1.3], f: 32 });
    W.post.focus.value = 4.4; W.post.focal.value = 6; W.post.bokeh.value = 3;
    tag(t, '最終確認：Claude（今度は 3 秒）');
  }, [[0.45, 'tick'], [0.87, 'tick'], [1.29, 'tick'], [1.95, 'stamp'], [1.95, 'ding'], [2.0, 'jump']]);

  // ---- E5：積み上げ（夜明け前）
  const R0 = [PAD[0], DECK, PAD[2]];
  const drops = [[0.15, 0.95], [1.15, 1.95], [2.1, 2.8], [2.95, 3.5]];
  const thunk = poofs(W, drops.map(([a, b], i) => ({ t: b, p: [R0[0], R0[1] + [SAT.s2Bot, SAT.s3Bot, SAT.slaTop, SAT.cmTop][i], R0[2]], n: 14, size: 0.5, speed: 3.2, life: 0.8, up: 0.1 })), { colA: 0xf4f4f4, colB: 0xcfd3d8, seed: 101 });
  film.shot('e5_stack', 5.2, (t) => {
    W.yard.root.visible = true; W.clouds.root.visible = true; W.yard.launch.visible = true;
    const k = seg(t, 2.6, 5.2);
    W.env('night', 'dawn', ease.io(k), { sunDir: mv([-0.092, 0.309, -0.947], [0.75, 0.16, 0.5], ease.io(k)), size: 46, center: [PAD[0], DECK + 14, PAD[2]], dist: 160, fillDir: [0.3, 0.5, 1], fillColor: 0x8fa6e6, fillI: 0.5 * (1 - k) });
    W.yard.setNight(1 - 0.75 * k);
    const S = W.saturn; S.root.visible = true; S.root.position.set(...R0);
    S.stages.forEach((st, i) => {
      if (i === 0) return;
      const [a, b] = drops[i - 1];
      const u = seg(t, a, b);
      st.visible = u > 0;
      st.position.y = st.userData.home + (1 - ease.out3(u)) * 9 + (u >= 1 ? -0.12 * bump(t, b, 0.25) : 0);
    });
    W.yard.hook.scale.y = 1 + 6 * (1 - seg(t, 0, 3.5));
    // 塔のアームは、段が据わるたびに閉じて機体を抱える（1 段目の下のアームは最初から）
    [[1, 0.95], [2, 1.15], [3, 2.8], [4, 2.95]].forEach(([g, t0]) => W.yard.swing(1 - ease.io(seg(t, t0 + 0.05, t0 + 0.65)), g));
    thunk.show(t);
    W.shake(0.05 * drops.reduce((m, d) => Math.max(m, bump(t, d[1], 0.25)), 0));
    camK(W, ease.io(seg(t, 0, 5.2)), { p: [PAD[0] + 36, 8, PAD[2] + 60], t: [PAD[0] - 1.5, DECK + 11.8, PAD[2]], f: 36 }, { p: [PAD[0] + 32, 5, PAD[2] + 54], t: [PAD[0] - 1.5, DECK + 13.2, PAD[2]], f: 36 });
    tag(t, '組み立て：全員', 0.3, 4.6);
    W.post.fade.value = seg(t, 4.8, 5.2);
  }, [...drops.map((d) => [d[1], 'thunk']), [0, 'servo', { dur: 3.5 }]]);
}
