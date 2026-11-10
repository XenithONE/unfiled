// 第 1 幕：月を見上げる夜 → 依頼 → 題字 → それぞれの案
import * as L from './lib.js';
const { seg, ease, key, pop, popInOut, lerp, mv, camK, place4, hop, hops, NAMES, NIGHT_MOON, nightYard, dayYard, fades, OV } = L;

export function seq1(film, W) {
  const E = W.engine;
  const SIT = { claude: [-2.1, 0, 2.0], gpt: [-0.7, 0, 2.2], gemini: [0.7, 0, 2.2], grok: [2.1, 0, 2.0] };
  const CP = [0.6, 1.2, 10.6];

  // ---- A1：夜。月を見上げる 4 人の後ろ姿
  film.shot('a1_night', 6, (t) => {
    nightYard(W, { open: true, fillI: 0.7 });
    place4(W, SIT, Math.PI);
    W.gemini.float(0.12);
    W.grok.look(0, 0.5).eyes('straight'); W.gpt.face('eyes');
    camK(W, ease.io(seg(t, 0.5, 5.5)), { p: [0.6, 1.2, 11.6], t: [-4.4, 17.5, -40], f: 40 }, { p: CP, t: [0, 2.35, 0], f: 40 });
    if (t > 4.3) W.claude.arms(0, lerp(0, 1.0, ease.out(seg(t, 4.3, 4.8))));
    fades(W, t, 6, 2.2, 0);
  }, [[0, 'amb_night', { dur: 17 }]]);

  // ---- A2：人間からの依頼が届く
  film.shot('a2_prompt', 6.5, (t) => {
    nightYard(W, { open: true, fillI: 0.15 });
    place4(W, SIT, Math.PI);
    W.gemini.float(0.12);
    camK(W, ease.io(seg(t, 0, 6.5)), { p: [0.5, 1.0, -4.9], t: [0, 0.45, 2], f: 36 }, { p: [0.2, 1.0, -4.3], t: [0, 0.5, 2], f: 36 });
    W.post.focus.value = 7.0; W.post.focal.value = 10; W.post.bokeh.value = 2.5;
    OV.promptBox(E, { k: seg(t, 0.15, 0.6) * (1 - seg(t, 5.9, 6.3)), text: 'GO TO THE MOON.', typed: seg(t, 0.6, 2.3), blinkOn: (t * 2.5) % 1 < 0.6 });
    if (t > 1.7 && t < 6.2) OV.subtitle(E, '月へ行って。', seg(t, 1.7, 2.0));
    W.say('moon', W.claude, popInOut(t, 2.8, 4.5)); W.say('q', W.gpt, popInOut(t, 3.1, 4.5)); W.say('q', W.gemini, popInOut(t, 3.4, 4.5)); W.say('bangq', W.grok, popInOut(t, 3.7, 4.5));
    for (const a of W.actors) W.say('rocket', a, popInOut(t, 4.7, 6.5));
    const glad = t > 4.6, surprised = t > 2.6;
    W.claude.eyes(glad ? 'happy' : surprised ? 'wide' : 'open');
    W.gpt.face(glad ? 'happy' : surprised ? 'wide' : 'eyes');
    W.gemini.eyes(glad ? 'happy' : surprised ? 'wide' : 'open');
    W.grok.look(0, 0.25).eyes(glad ? 'happy' : surprised ? 'wide' : 'straight');
    W.actors.forEach((a, i) => { hop(a, t, 4.75 + i * 0.07, 0.45, 0.45); hop(a, t, 5.45 + i * 0.07, 0.45, 0.5); });
    if (glad) W.claude.arms(0.9, 0.9);
  }, [[0.6, 'type', { dur: 1.7 }], [2.8, 'pop'], [3.1, 'pop'], [3.4, 'pop'], [3.7, 'pop'], [4.7, 'yay'], [4.75, 'jump'], [5.45, 'jump']]);

  // ---- A3：題字
  film.shot('a3_title', 5.5, (t) => {
    nightYard(W, { open: true, fillI: 0.7 });
    place4(W, SIT, Math.PI);
    W.gemini.float(0.12);
    const k = ease.io(seg(t, 0, 1.8));
    W.cam(CP, mv([0, 2.35, 0], [NIGHT_MOON[0], 128, NIGHT_MOON[2]], k), lerp(40, 21, ease.io(seg(t, 0.1, 5.2))));
    OV.title(E, seg(t, 1.3, 2.4), 1 - seg(t, 4.8, 5.3));
    fades(W, t, 5.5, 0, 0.45);
  }, [[1.3, 'title']]);

  // ---- B1：昼。作業場で設計図を囲む
  const ROW = { claude: [-2.7, 0, 0.9], gpt: [-0.9, 0, 1.1], gemini: [0.9, 0, 1.1], grok: [2.7, 0, 0.9] };
  film.shot('b1_board', 4, (t) => {
    dayYard(W, { size: 20 });
    W.yard.blueprint('goal');
    place4(W, ROW, [0, -2.7]);
    W.grok.look(0, 0.4).eyes('straight'); W.gpt.face('eyes');
    camK(W, ease.out3(seg(t, 0, 4)), { p: [9.5, 6.4, 13.5], t: [0, 1.6, -1], f: 34 }, { p: [5.0, 2.6, 9.6], t: [0, 1.7, -1], f: 34 });
    W.actors.forEach((a, i) => hop(a, t, 2.3 + i * 0.12, 0.4, 0.25));
    fades(W, t, 4, 0.25, 0);
  }, [[0, 'amb_day', { dur: 60 }], [2.3, 'jump']]);

  // ---- B2：それぞれの案（1 人 2 秒）
  const singles = [
    ['claude', 'list', (a, t) => { a.eyes('keen'); a.arms(0.15, 0.95 + Math.sin(t * 9) * 0.1); }],
    ['gpt', 'code', (a, t) => { a.face('code', { scroll: t * 9 }); a.arms(0.2, 0.2, 1.0 + Math.sin(t * 40) * 0.3, 1.0 + Math.cos(t * 37) * 0.3); }],
    ['gemini', 'star', (a, t) => { a.eyes('happy'); a.tilt(0, ease.io(seg(t, 0.45, 1.3)) * Math.PI * 2); a.hands([-0.5, 0.78, 0.2], [0.5, 0.78, 0.2]); }],
    ['grok', ['fire', 't:X27'], (a, t) => { a.eyes('angry').look(0.12, 0.2); hops(a, t, 0.4, 4, 0.36, 0.3); }],
  ];
  singles.forEach(([name, icon, act]) => {
    film.shot('b2_' + name, 2, (t) => {
      dayYard(W, { size: 12 });
      W.yard.blueprint(name);
      const a = W[name];
      a.at(0, 0, 1.0, 0.25);
      act(a, t);
      camK(W, ease.out(seg(t, 0, 2)), { p: [1.9, 1.0, 5.3], t: [-0.25, 1.2, 0.2], f: 32 }, { p: [1.6, 1.0, 4.9], t: [-0.25, 1.2, 0.2], f: 32 });
      W.say(icon, a, pop(t, 0.25));
      W.post.focus.value = 4.7; W.post.focal.value = 7; W.post.bokeh.value = 3;
    }, [[0.25, 'pop'], [0.3, 'voice_' + name]]);
  });

  // ---- B3：言い合い → GPT が飛び出す
  film.shot('b3_argue', 3, (t) => {
    dayYard(W, { size: 16 });
    W.yard.blueprint('goal');
    place4(W, ROW, 0);
    W.cam([0.4, 1.5, 8.4], [0, 1.3, 0.6], 32);
    const icons = { claude: 'list', gpt: 'code', gemini: 'star', grok: 'fire' };
    NAMES.forEach((n, i) => {
      const a = W[n];
      a.yaw((i < 2 ? 0.55 : -0.55) * (0.6 + 0.4 * Math.sin(t * 5 + i)));
      hops(a, t, 0.1 + i * 0.13, 5, 0.36, 0.22);
      const ph = Math.floor(t * 3 + i * 0.5) % 2;
      if (!(n === 'gpt' && t > 1.85)) W.say(ph ? 'anger' : icons[n], a, popInOut(t, 0.05 + i * 0.08, 2.7));
    });
    W.claude.eyes('keen'); W.gpt.face('strain'); W.gemini.eyes('sad'); W.grok.eyes('angry').look(-0.4, 0.2);
    if (t > 1.85) {
      const u = ease.in(seg(t, 2.1, 2.95));
      W.gpt.at(lerp(ROW.gpt[0], 13, u), 0, lerp(ROW.gpt[2], -3, u), 1.25).face('bang');
      if (u > 0) W.gpt.walk(t * 30);
      W.say('bang', W.gpt, popInOut(t, 1.85, 2.4));
    }
    if (t > 2.3) for (const n of ['claude', 'gemini', 'grok']) W[n].yaw(0.9);
  }, [[0.1, 'argue'], [1.85, 'pop'], [2.1, 'zip']]);
}
