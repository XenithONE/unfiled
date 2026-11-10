// 第 5 幕：月着陸 → テレビ中継 → 最初の一歩 → あの言葉 → エンドクレジット
import * as L from './lib.js';
import { showEarth } from '../sets/earth.js';
const { seg, ease, pop, popInOut, lerp, mv, camK, hop, leap, aim, NAMES, SEATS, MOUND, fades, OV, Puffs, clamp, bump, arc, vnoise } = L;

export function seq5(film, W) {
  const E = W.engine;
  const MSUN = [0.6, 0.22, 0.65];   // 低い太陽（長い影。実際の月面活動も朝の低い日差しだった）
  const ED = (() => { const v = [-0.65, 0.3, -0.7], n = Math.hypot(...v); return v.map((x) => x / n); })();
  const moonEnv = (center, size = 26, o = {}) => {
    W.moon.root.visible = true;
    W.env('space', 'space', 0, { sunDir: MSUN, size, center, dist: 150, sunMul: 1.9, hemiMul: 1.3, fillDir: [-0.6, 0.25, -0.5], fillColor: 0x9aa6c0, fillI: 0.25, streak: 0.4, ...o });
    W.sky.U.twinkle.value = 0; W.sky.U.stars.value = o.stars ?? 0.7;
    W.clip(0.1, 30000);
  };
  const earthSky = (dir = ED, r = 330, rotY = 2.2) => {
    const c = W.camera.position, e = W.earth;
    e.visible = true; e.position.set(c.x + dir[0] * 9000, c.y + dir[1] * 9000, c.z + dir[2] * 9000); e.scale.setScalar(r); e.rotation.set(0.41, rotY, 0); e.userData.setNear(false);
  };
  const landerDown = (open = 0) => { const Lr = W.lander.root; Lr.visible = true; Lr.position.set(0, W.moon.h(0, 0) + 0.02, 0); W.lander.open(open); };

  // ---- H1：着陸船、切り離し
  film.shot('h1_sep', 4.6, (t) => {
    W.cam(mv([9, 3.5, 23], [11, 2.5, 21], ease.io(seg(t, 0, 4.6))), [3, -0.4, 0], 34);
    W.env('space', 'space', 0, { sunDir: [0.55, 0.38, 0.75], size: 18, center: [3, 0, 0], dist: 160, hemiMul: 0.7, fillDir: [0, -1, 0.2], fillColor: 0x8a8f9c, fillI: 0.5 });
    W.sky.U.twinkle.value = 0; W.clip(0.5, 30000);
    const m = W.moonGlobe; m.visible = true; m.scale.setScalar(1500); m.position.set(0, -1500 - 150, -220); m.rotation.set(0.2, 1.2 + t * 0.002, 0.3);
    const A = [1, 0, 0], O = [-3, 0, 0];
    W.csm.visible = true; W.csm.position.set(O[0] - 2.84, O[1], O[2]); aim(W.csm, A); W.csm.rotateY(0.6);
    const d = 7 * ease.io(seg(t, 0.4, 2.2));
    const turn = ease.io(seg(t, 1.6, 3.3));
    const up = [-(1 - turn), turn, 0];
    const drop = t > 3.3 ? (t - 3.3) ** 2 * 0.9 : 0;
    const Lr = W.lander.root; Lr.visible = true;
    const top = [O[0] + d, O[1] - drop, O[2]];
    const n = Math.hypot(up[0], up[1]);
    Lr.position.set(top[0] - (up[0] / n) * 4.9 * (1 - turn) + (turn) * 2.2, top[1] - (up[1] / n) * 4.9 * turn, top[2]);
    aim(Lr, up);
    if (t > 3.2) W.lander.fire(t, ease.out(seg(t, 3.2, 3.6)), 1.0);
    fades(W, t, 4.6, 0.5, 0);
    if (t > 0.5 && t < 4.2) OV.subtitle(E, '着陸船、切り離し。月面へ。', Math.min(seg(t, 0.5, 0.8), 1 - seg(t, 3.9, 4.2)));
  }, [[0.4, 'sep'], [3.2, 'ignite2'], [0, 'space', { dur: 4.6 }]]);

  // ---- H2：警報 1202（実際のアポロ 11 号でも鳴った）→ GPT が直す
  film.shot('h2_alarm', 4.8, (t) => {
    W.cabin.root.visible = true; W.cabin.uT.value = t;
    const al = t > 0.4 && t < 2.9;
    W.cabin.alarm.value = al ? 1 : 0;
    const red = al ? 0.5 + 0.5 * Math.sin(t * 19) : 0;
    W.light({ sunDir: [0.15, 0.7, 1.0], sunI: 1.15, sunColor: al ? 0xffb0a0 : 0xfff4e6, hemiI: 0.2, sky: al ? 0xc08a8a : 0x9fb0d6, ground: 0x4a4f5c, size: 9, center: [0, 1, 0], fillDir: [-0.9, 0.2, 0.4], fillColor: al ? 0xff4030 : 0xcfd3dc, fillI: al ? 0.3 + red * 0.7 : 0.2 });   // 船内は作業灯と窓の光が主役
    W.cabin.window(0.72, 0.72, 0.76, 0.6);
    const sh = 0.02 + (al ? 0.015 : 0);
    NAMES.forEach((n, i) => W[n].at(SEATS[i] + vnoise(t * 23, i) * sh, 0.5 + vnoise(t * 27, i + 9) * sh, 0.15).helm());
    W.gemini.float(0.02, false);
    const fix = t > 1.5 && t < 2.9, ok = t >= 2.9;
    W.claude.eyes(ok ? 'happy' : al ? 'wide' : 'open').gaze(al ? 0.4 : 0, 0);
    W.gemini.eyes(ok ? 'happy' : al ? 'wide' : 'open');
    W.grok.eyes(ok ? 'happy' : al ? 'wide' : 'straight').look(al ? -0.5 : 0, 0.1);
    W.gpt.face(ok ? 'check' : fix ? 'code' : al ? 'bang' : 'eyes', { scroll: t * 14 }).arms(0.1, 0.1, fix ? 1.1 + Math.sin(t * 43) * 0.3 : 0, fix ? 1.1 + Math.cos(t * 39) * 0.3 : 0);
    if (ok) NAMES.forEach((n, i) => hop(W[n], t, 3.0 + i * 0.07, 0.35, 0.12));
    W.cam([0, 1.75, 4.7], [0, 1.4, 0], 44); W.clip(0.1, 60); W.shake(sh * 0.6);
    W.post.focus.value = 4.6; W.post.focal.value = 6.5; W.post.bokeh.value = 2.0;
    if (al) OV.line(E, 'ALARM 1202', { y: 110, s: 12, color: (t * 4) % 1 < 0.6 ? '#ff5548' : '#7a1f1a' });
    if (ok && t < 4.5) OV.line(E, 'GO FOR LANDING', { y: 110, s: 10, color: '#6dff9c', a: seg(t, 2.9, 3.05) });
    if (al) OV.subtitle(E, '警報 1202 —— コンピューターが過負荷！', seg(t, 0.5, 0.7));
    if (ok) OV.subtitle(E, 'GPT が 1.4 秒で修正。着陸、続行。', Math.min(seg(t, 2.95, 3.15), 1 - seg(t, 4.5, 4.75)));
  }, [[0.4, 'alarm', { dur: 2.5 }], [1.5, 'type', { dur: 1.3 }], [2.9, 'ding'], [3.0, 'yay']]);

  // ---- H3：着陸
  const yL = (t) => (t >= 5.2 ? 0 : 15 * Math.pow(1 - t / 5.2, 1.7));
  const landDust = new Puffs(520, (i, rnd) => {
    const t0 = 1.6 + (i / 520) * 3.8, a = rnd() * 6.283, k = clamp(1.6 - yL(t0) / 9, 0.3, 1.5);
    const sp = (7 + rnd() * 13) * k;
    // 空気がないので、砂は舞い上がらず、地面に沿って低く・まっすぐ・速く放射状に飛ぶ
    return { t: t0, life: 0.8 + rnd() * 0.9, size: (0.22 + rnd() * 0.4) * k, p: [Math.cos(a) * (0.6 + rnd()), 0.05, Math.sin(a) * (0.6 + rnd())], v: [Math.cos(a) * sp * 1.5, 0.1 + rnd() * 0.5, Math.sin(a) * sp * 1.5], drag: 0.1, rise: 0 };
  }, { colA: 0xd8d4cc, colB: 0xb9b5ad, grav: 1.62, floor: -0.25, start: 0.6, seed: 301, lump: 0.3, opacity: 0.3, soft: 0.4, dust: true, aspect: [2.1, 0.42] });
  W.add(landDust.mesh);
  film.shot('h3_touch', 8.2, (t) => {
    const y = yL(t);
    W.cam(mv([11, 1.3, 14.5], [9.5, 1.1, 12.5], ease.io(seg(t, 0, 8.2))), [0.2 * (1 - seg(t, 0, 5)), lerp(7.5, 2.7, ease.io(seg(t, 0, 5.4))), 0], 36);
    moonEnv([0, 2, 0], 28);
    earthSky(ED, 300);
    const Lr = W.lander.root; Lr.visible = true;
    const sway = (1 - seg(t, 0, 5.2));
    Lr.position.set(1.2 * sway * sway + 0.12 * Math.sin(t * 2.1) * sway, W.moon.h(0, 0) + 0.02 + y - 0.1 * bump(t, 5.2, 0.35), 0.5 * sway * sway);
    Lr.rotation.set(0.03 * Math.sin(t * 1.7) * sway, 0.25 * sway, 0.03 * Math.cos(t * 1.3) * sway);
    if (t < 5.3) W.lander.fire(t, 1 - seg(t, 5.15, 5.3), 1.0 + 0.1 * Math.sin(t * 17));
    landDust.show(t);
    W.shake(t < 5.3 ? 0.02 + 0.03 * seg(t, 2, 5) : 0.06 * bump(t, 5.2, 0.3));
    fades(W, t, 8.2, 0.5, 0);
    if (t > 6.0) OV.line(E, 'THE EAGLE HAS LANDED.', { y: 120, s: 9, typed: seg(t, 6.0, 7.0), a: 1 - seg(t, 7.9, 8.2) });
    if (t > 6.2) OV.subtitle(E, '着陸、成功。', Math.min(seg(t, 6.2, 6.5), 1 - seg(t, 7.9, 8.2)));
  }, [[0, 'descent', { dur: 5.3 }], [5.2, 'thud'], [5.3, 'silence'], [6.0, 'type', { dur: 1.0 }], [6.0, 'quindar']]);

  // ---- I1：テレビ中継（白黒）。ハッチが開き、はしごを降りる
  const R = W.lander.rungs;
  const stops = [[2.74, 2.05], [2.3 - 0.0, R[0][1] + 0.38], [R[2][0], R[2][1] + 0.38], [R[4][0], R[4][1] + 0.38], [R[6][0], R[6][1] + 0.38], [0.14, 3.32]];
  const hopT = [2.9, 3.7, 4.5, 5.3, 6.1];
  const ladderPos = (t) => {
    if (t < 2.6) { const u = ease.io(seg(t, 1.2, 2.6)); return [lerp(2.74, 2.74, u), lerp(0.7, 2.05, u), 0]; }
    let i = 0; while (i < hopT.length && t >= hopT[i] + 0.5) i++;
    if (i >= hopT.length) return [stops[5][0], stops[5][1], 0];
    const u = clamp((t - hopT[i]) / 0.5);
    return [lerp(stops[i][0], stops[i + 1][0], u), lerp(stops[i][1], stops[i + 1][1], u), u > 0 && u < 1 ? arc(u) * 0.28 : 0];
  };
  film.shot('i1_tv', 7.6, (t) => {
    W.cam([6.6, 1.5, 7.2], [0.3, 1.75, 2.7], 30);
    moonEnv([0, 2, 2], 14, { stars: 0.2 });
    landerDown(ease.io(seg(t, 0.4, 1.5)));
    const g0 = W.moon.h(0, 3);
    const [py, pz, ay] = ladderPos(t);
    W.claude.at(0, g0 + py + ay, pz, Math.PI).helm().eyes('keen');
    if (t > 2.6 && ay > 0) W.claude.squash(1 + 0.1 * Math.cos((ay / 0.28) * Math.PI));
    if (t < 1.25) W.claude.hide();
    W.post.tv.value = 1; W.post.grain.value = 0.0; W.post.vignette.value = 0;
    OV.tvChyron(E, seg(t, 0.2, 0.6), (t * 1.2) % 1 < 0.6);
    fades(W, t, 7.6, 0.3, 0);
  }, [[0, 'static', { dur: 7.6 }], [0.2, 'quindar'], [0.4, 'servo', { dur: 1.1 }], ...hopT.map((x) => [x + 0.5, 'tap'])]);

  // ---- I2：最後の一段。考える……確認、よし
  film.shot('i2_pause', 5.0, (t) => {
    W.cam(mv([2.9, 0.6, 7.0], [2.5, 0.55, 6.6], ease.io(seg(t, 0, 5))), [0, 0.85, 3.4], 30);
    moonEnv([0, 1, 3], 12);
    earthSky(ED, 300);
    landerDown(1);
    const g0 = W.moon.h(0, 3.3);
    const c = W.claude;
    const turn = ease.io(seg(t, 0.1, 0.7));
    c.at(0, g0 + 0.14, 3.32, Math.PI * (1 - turn)).helm();
    const think = t > 1.0 && t < 2.6, ok = t >= 2.6;
    c.eyes(ok ? 'keen' : 'open').gaze(0, ok ? 0 : -0.35).lean(ok ? 0 : 0.14, 0);
    if (think) {
      const s = W.spark; s.visible = true; s.position.set(0, g0 + 2.05, 3.32); s.quaternion.copy(W.camera.quaternion); s.rotateZ(-t * 3.2); s.scale.setScalar(0.75 * pop(t, 1.0, 0.25));
    }
    W.say('check', c, popInOut(t, 2.6, 3.6), { size: 0.85, dy: 0.55 });
    // しゃがんで……跳ぶ
    if (t > 3.7 && t < 4.15) c.squash(1 - 0.22 * Math.sin(((t - 3.7) / 0.45) * Math.PI * 0.5));
    if (t >= 4.15) { const u = (t - 4.15) / 0.85; c.root.position.y += 0.9 * u - 0.25 * u * u; c.root.position.z += 0.55 * u; c.squash(1.12); }
    W.post.bars.value = 0.105 * ease.out(seg(t, 0.2, 1.0));
    W.post.focus.value = 4.3; W.post.focal.value = 5; W.post.bokeh.value = 3;
  }, [[0.05, 'tone'], [1.0, 'think', { dur: 1.6 }], [2.6, 'ding'], [4.15, 'whoosh']]);

  // ---- I3：最初の一歩（月の砂・ゆっくり）
  const Z0 = 4.2;
  const stepDust = new Puffs(1500, (i, rnd) => {
    const leg = [-0.54, -0.3, 0.3, 0.54][i % 4], a = rnd() * 6.283, sp = 0.35 + rnd() * 1.5;
    return { t: 1.6 + rnd() * 0.05, life: 1.6 + rnd() * 1.4, size: 0.0022 + rnd() * rnd() * 0.008, p: [leg + (rnd() - 0.5) * 0.1, 0.01, Z0 + (rnd() - 0.5) * 0.3], v: [Math.cos(a) * sp, 0.5 + rnd() * 1.5, Math.sin(a) * sp], drag: 0.05, rise: 0 };
  }, { colA: 0xa59f96, colB: 0x8a857c, grav: 1.62, floor: -0.05, start: 0.8, seed: 311, fadeAt: 0.8, opacity: 0.85, soft: 0.05, lump: 0.1, grain: true });
  const walkDust = new Puffs(240, (i, rnd) => {
    const k = i < 120 ? 0 : 1, a = rnd() * 6.283, sp = 0.2 + rnd() * 0.8;
    return { t: (k ? 4.05 : 3.45) + rnd() * 0.05, life: 1.2 + rnd(), size: 0.003 + rnd() * 0.007, p: [(rnd() - 0.5) * 1.1, 0.01, Z0 + 0.5 + k * 0.5], v: [Math.cos(a) * sp, 0.3 + rnd() * 0.9, Math.sin(a) * sp], drag: 0.05, rise: 0 };
  }, { colA: 0xa59f96, colB: 0x8a857c, grav: 1.62, floor: -0.05, start: 0.8, seed: 312, opacity: 0.85, soft: 0.05, lump: 0.1, grain: true });
  W.add(stepDust.mesh); W.add(walkDust.mesh);
  film.shot('i3_step', 5.2, (t) => {
    W.cam(mv([2.6, 0.26, 8.4], [2.3, 0.3, 8.8], ease.io(seg(t, 0, 5.2))), [0, 0.22, Z0 + 0.4], 17);
    W.post.focus.value = 4.9; W.post.focal.value = 3.4; W.post.bokeh.value = 3;
    moonEnv([0, 0.5, 4], 8, { stars: 0.3 });
    landerDown(1);
    const g0 = W.moon.h(0, Z0);
    const c = W.claude;
    const fall = t < 1.6 ? 1.15 * Math.pow(1 - t / 1.6, 1.5) : 0;
    let z = Z0, bob = 0;
    if (t > 3.0) { const u = seg(t, 3.0, 4.6); z = Z0 + u * 1.0; bob = 0.08 * Math.abs(Math.sin(u * Math.PI * 2)); c.walk(u * Math.PI * 2 + 0.2, 0.9); }
    c.at(0, g0 + fall + bob, z, 0).helm().eyes('keen');
    if (t >= 1.6 && t < 2.3) c.squash(1 - 0.2 * Math.sin(((t - 1.6) / 0.7) * Math.PI));
    if (t >= 1.6) W.moon.step4(0, Z0, 0);
    if (t >= 3.45) W.moon.step4(0, Z0 + 0.5, 0);
    if (t >= 4.05) W.moon.step4(0, Z0 + 1.0, 0);
    stepDust.mesh.position.y = g0; walkDust.mesh.position.y = g0;
    stepDust.show(t); walkDust.show(t);
    W.post.bars.value = 0.105;
    if (t > 1.6) W.post.flash.value = 0.12 * Math.exp(-(t - 1.6) * 20);
  }, [[1.6, 'step'], [1.6, 'bighit'], [3.45, 'tap'], [4.05, 'tap']]);

  // ---- I4：月の丘の上、地球を見上げて。あの言葉。
  const TOP = [MOUND.x, W.moon.h(MOUND.x, MOUND.z), MOUND.z];
  const V = [-0.68, 0, -0.73];
  const RT = [-V[2], 0, V[0]];           // カメラから見て右
  const YAW = Math.atan2(V[0], V[2]);
  const at2 = (side, fwd) => { const x = TOP[0] + RT[0] * side + V[0] * fwd, z = TOP[2] + RT[2] * side + V[2] * fwd; return [x, W.moon.h(x, z), z]; };
  const LAND = { gpt: at2(-1.55, -0.2), gemini: at2(1.5, -0.15), grok: at2(2.85, 0.1) };
  const FROM = { gpt: at2(-9.5, -7), gemini: at2(8.5, -8), grok: at2(12, -6) };
  const LT = { gpt: [7.4, 2.3], gemini: [7.9, 2.3], grok: [8.4, 2.2] };
  const leapDust = new Puffs(150, (i, rnd) => {
    const n = ['gpt', 'gemini', 'grok'][i % 3], p = LAND[n], a = rnd() * 6.283, sp = 0.5 + rnd() * 2.2;
    return { t: LT[n][0] + LT[n][1] + rnd() * 0.05, life: 1.8 + rnd() * 1.6, size: 0.03 + rnd() * 0.07, p: [p[0], p[1] + 0.03, p[2]], v: [Math.cos(a) * sp, 0.6 + rnd() * 2.0, Math.sin(a) * sp], drag: 0.05, rise: 0 };
  }, { colA: 0xa59f96, colB: 0x8a857c, grav: 1.62, start: 0.8, seed: 321, opacity: 0.8, soft: 0.05, lump: 0.1, grain: true });
  W.add(leapDust.mesh);
  const FLAG = at2(-3.3, 0.5);
  film.shot('i4_final', 18.5, (t) => {
    const k = ease.io(seg(t, 0, 18.5));
    const dist = lerp(64, 57, k);
    const cp = [TOP[0] - V[0] * dist, TOP[1] - 2.1, TOP[2] - V[2] * dist];
    W.cam(cp, [TOP[0], TOP[1] + 2.75, TOP[2]], 11);
    moonEnv(TOP, 16, { stars: 0.45 });
    // 地球（大きく、真ん中の上）
    const el = 5.55 * Math.PI / 180;
    earthSky([V[0] * Math.cos(el), Math.sin(el), V[2] * Math.cos(el)], 9000 * Math.tan(3.1 * Math.PI / 180), 2.35 + t * 0.003);
    showEarth(W.earth, W.camera, 12, 128 - t * 0.25, -8);   // 日本・アジア・オーストラリアの見える向き
    // Claude：丘をのぼって、立ち止まり、見上げる
    const c = W.claude;
    const u = ease.out(seg(t, 0, 3.6));
    const fw = lerp(-14, 0, u);
    const p = at2(0, fw);
    // 月の重力：ふわりと弾みながら丘をのぼる
    const bound = u < 1 ? Math.abs(Math.sin(fw * 1.55)) * 0.32 : 0;
    c.at(p[0], p[1] + bound, p[2], YAW).helm().eyes('open');
    if (u < 1) c.walk(fw * 3.1, 0.7);
    for (let i = 0; i < 9; i++) { const f = -14 + i * 2.03 * 0.777; if (fw > f + 0.3) { const q = at2(0, f); W.moon.step4(q[0], q[2], YAW); } }
    if (t > 3.6) c.lean(-0.2 * ease.io(seg(t, 3.7, 4.5)), 0);
    // 仲間たちの「大きな跳躍」
    for (const n of ['gpt', 'gemini', 'grok']) {
      const [t0, d] = LT[n];
      if (t < t0) continue;
      const a = W[n];
      a.root.visible = true;
      const uu = leap(a, t, t0, d, FROM[n], LAND[n], n === 'grok' ? 5.5 : 4.6);
      a.root.rotation.y = YAW; a.helm();
      if (uu < 1) { if (n === 'gpt') a.face('wide').arms(1.3, 1.3).lean(0, Math.sin(t * 5) * 0.3); if (n === 'gemini') a.eyes('happy').tilt(0, t * 5, 0); if (n === 'grok') a.eyes('happy'); }
      else {
        const s = t - t0 - d;
        if (s < 0.5) a.squash(1 - 0.2 * Math.sin((s / 0.5) * Math.PI));
        if (n === 'grok' && s < 1.1) a.root.position.y += arc(clamp(s / 1.1)) * 1.3;
        if (n === 'gpt') a.face('happy'); if (n === 'gemini') a.eyes('happy'); if (n === 'grok') a.eyes('happy').look(0, 0.5);
      }
    }
    leapDust.show(t);
    // 旗
    if (t > 12.0) { const f = W.moon.flag; f.visible = true; f.position.set(FLAG[0], FLAG[1] - 2.3 * (1 - ease.back(seg(t, 12.0, 12.7))), FLAG[2]); f.rotation.y = YAW + Math.PI; W.moon.flagWave.value = 1.5 * Math.exp(-(t - 12.7) * 1.3); W.moon.flagT.value = t; }
    // あの言葉
    OV.quote(E, { l1: "THAT'S ONE SMALL STEP FOR AN AI,", l2: 'ONE GIANT LEAP FOR MANKIND.', t1: seg(t, 4.7, 7.1), t2: seg(t, 10.7, 12.9), a: 1 - seg(t, 17.6, 18.3) });
    if (t > 5.2) OV.subtitle(E, t < 10.9 ? 'これは一つの AI にとっては小さな一歩だが、' : 'これは一つの AI にとっては小さな一歩だが、\n人類にとっては偉大な飛躍である。', Math.min(seg(t, 5.2, 5.6), 1 - seg(t, 17.6, 18.3)));
    W.post.bars.value = 0.105 * (1 - seg(t, 16.5, 18));
    fades(W, t, 18.5, 0.8, 0.9);
  }, [[0.2, 'steps', { dur: 3.3 }], [4.5, 'quindar'], [4.7, 'type', { dur: 2.4, soft: 1 }], ...['gpt', 'gemini', 'grok'].map((n) => [LT[n][0], 'whoosh']), ...['gpt', 'gemini', 'grok'].map((n) => [LT[n][0] + LT[n][1], 'step']), [10.7, 'type', { dur: 2.2, soft: 1 }], [12.0, 'flag'], [12.9, 'quindar2']]);

  // ---- I5：足あと → エンドクレジット
  film.shot('i5_end', 10, (t) => {
    W.cam(mv([0.5, 1.5, 6.2], [0.3, 1.7, 6.0], ease.io(seg(t, 0, 4))), [0, 0, 4.75], 30);
    moonEnv([0, 0, 4.7], 6, { stars: 0 });
    for (let i = 0; i < 3; i++) W.moon.step4(0, Z0 + i * 0.5, 0);
    const dark = seg(t, 2.2, 3.4);
    W.post.fade.value = Math.max(1 - seg(t, 0, 0.8), dark * 0.86, seg(t, 9.0, 10));
    W.post.bars.value = 0.105 * (1 - dark);
    if (t > 3.0) OV.credits(E, Math.min(seg(t, 3.0, 3.8), 1 - seg(t, 9.0, 9.8)), t < 4.2 ? 0 : t < 5.2 ? 1 : t < 6.2 ? 2 : 3);
  }, [[0, 'end']]);
}
