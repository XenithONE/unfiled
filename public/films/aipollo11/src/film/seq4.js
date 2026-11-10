// 第 4 幕：発射台へ → 秒読み → 点火 → 上昇 → 切り離し → 地球を背に月へ
import * as L from './lib.js';
const { seg, ease, pop, popInOut, lerp, mv, camK, place4, hop, hops, walk, poofs, aim, NAMES, PAD, DECK, SEATS, SAT, fades, OV, Puffs, Sparkles, Debris, glowSprite, clamp, bump, vnoise } = L;
import * as THREE from 'three/webgpu';
import { step } from 'three/tsl';
import { Fluid } from '../fx/fluid.js';
import { padSolid } from '../sets/pad.js';
import { faceEarth } from '../sets/earth.js';

export function seq4(film, W) {
  const E = W.engine;
  const S = W.saturn;
  const R0 = [PAD[0], DECK, PAD[2]];
  const DAWN_SUN = [-0.82, 0.17, -0.55];
  const dawn = (o = {}) => {
    W.yard.root.visible = true; W.clouds.root.visible = true; W.yard.launch.visible = true;
    W.yard.setNight(o.night ?? 0.3);
    // 逆光の夜明け：空に露出を合わせて白飛びを抑え、機体は空の青い照り返しで起こす（輪郭に朝日が回る）
    return W.env('dawn', 'day', o.k ?? 0, { sunDir: o.sunDir ?? DAWN_SUN, size: o.size ?? 48, center: o.center ?? [PAD[0], DECK + 14, PAD[2]], dist: 180, fillDir: [0.6, 0.35, 0.75], fillColor: 0xbfd0ff, fillI: o.fillI ?? 1.5, exposure: o.exposure ?? 0.8, fogMul: o.fogMul ?? 0.75, ...o.light });
  };
  const rocketOnPad = () => { S.root.visible = true; S.root.position.set(...R0); S.frost(1); };   // 燃料を入れた姿：極低温タンクの外に霜

  // ---- F1：4 人、ロケットへ歩く（見上げるほど大きい）
  const WX = { claude: -1.3, gpt: -3.2, gemini: 1.1, grok: 3.0 };
  film.shot('f1_walkup', 7, (t) => {
    dawn();
    rocketOnPad();
    const z = lerp(PAD[2] + 58, PAD[2] + 45, seg(t, 0, 7));
    NAMES.forEach((n, i) => {
      const a = W[n];
      a.at(WX[n], 0, z - (i % 2) * 0.8, Math.PI).helm();
      if (n === 'claude') a.walk(t * 6.5, 0.9); else if (n === 'gpt') a.walk(t * 6.5 + 1, 0.9); else if (n === 'grok') a.squash(1 - 0.05 * Math.abs(Math.sin(t * 5))); else a.float(0.22);
    });
    W.grok.look(0, 0.5).eyes('straight'); W.gpt.face('eyes'); W.claude.eyes('keen');
    const k = ease.io(seg(t, 1.2, 6.6));
    W.cam(mv([PAD[0] + 1.2, 0.55, PAD[2] + 66], [PAD[0] + 2.8, 0.85, PAD[2] + 58], k), mv([PAD[0], 1.4, PAD[2] + 50], [PAD[0] - 1.2, DECK + 5.6, PAD[2]], k), lerp(44, 43, k));
    W.post.bars.value = 0.105 * ease.out(seg(t, 0.2, 1.2));
    fades(W, t, 7, 0.6, 0);
  }, [[0, 'amb_dawn', { dur: 16 }], [0, 'steps', { dur: 7 }]]);

  // ---- F2：船内。全員、準備よし
  const cabinCrew = (t, shake = 0) => {
    W.cabin.root.visible = true; W.cabin.uT.value = t;
    W.light({ sunDir: [0.15, 0.7, 1.0], sunI: 1.25, sunColor: 0xfff0dd, hemiI: 0.2, sky: 0x9fb0d6, ground: 0x4a4f5c, size: 9, center: [0, 1, 0], fillDir: [-0.8, 0.2, 0.5], fillColor: 0x79b8ff, fillI: 0.15 });   // 船内は作業灯と窓の光が主役（Cabin が自前の灯りを持つ）
    NAMES.forEach((n, i) => {
      const a = W[n];
      a.at(SEATS[i] + vnoise(t * 23, i) * shake, 0.5 + vnoise(t * 27, i + 9) * shake, 0.15).helm();
    });
    W.gemini.float(0.02, false);
    W.cam([0, 1.75, 4.7], [0, 1.4, 0], 44);
    W.clip(0.1, 60);
    W.post.focus.value = 4.6; W.post.focal.value = 6.5; W.post.bokeh.value = 2.0;
    W.shake(shake * 0.5);
  };
  film.shot('f2_cabin', 4, (t) => {
    cabinCrew(t, 0.012 * seg(t, 3.2, 4));
    W.cabin.window(1.0, 0.72, 0.5, 0.6); W.cabin.time(-9.6);   // 時計は打ち上げまでの秒読み（次のカットの「5」へつながる）
    W.claude.eyes('keen'); W.gpt.face('eyes'); W.gemini.eyes('open'); W.grok.eyes('angry').look(0, 0.1);
    W.say('check', W.claude, popInOut(t, 0.4, 2.3), { size: 0.75 });
    W.say('check', W.gpt, popInOut(t, 0.8, 2.3), { size: 0.75 });
    W.say('check', W.gemini, popInOut(t, 1.2, 2.3), { size: 0.75 });
    W.say('fire', W.grok, popInOut(t, 1.6, 2.3), { size: 0.75 });
    if (t > 2.3) { W.claude.eyes('happy'); W.gpt.face('happy'); W.gemini.eyes('happy'); W.grok.eyes('happy'); NAMES.forEach((n, i) => hop(W[n], t, 2.4 + i * 0.08, 0.35, 0.12)); }
    if (t > 2.3) OV.subtitle(E, '全システム、よし。', Math.min(seg(t, 2.3, 2.5), 1 - seg(t, 3.7, 3.95)));
  }, [[0.4, 'tick'], [0.8, 'tick'], [1.2, 'tick'], [1.6, 'pop'], [2.4, 'ding']]);

  // ---- 打ち上げの共通時計 τ（0＝点火、REL＝離床）。煙は流体シミュレーションで流す。
  const REL = 2.2;
  const hL = (tau) => (tau < REL ? 0 : 0.75 * Math.pow(tau - REL, 2.2));
  const HI = W.quality === 'high';
  const fluid = new Fluid(E.renderer, {
    n: HI ? [128, 192, 128] : [64, 96, 64], origin: [R0[0] - 80, 0, R0[2] - 80], size: [160, 240, 160], jacobi: HI ? 24 : 16,
    buoy: 2.4, weight: 0.3, turb: HI ? 18 : 11, sigma: 1.25, shadowK: HI ? 2.0 : 1.0, detail: 0.85, detailScale: 0.12, edge0: 0.05, edge1: 0.3, glow: 2.6, vort: HI ? 0.75 : 0.45, marchSteps: HI ? 460 : 280,
    // 固体：台地（火炎溝をのぞく）と発射台の箱（炎の穴をのぞく）。噴流は穴から溝へ落ち、左右（±X）へ流れる
    solid: padSolid,
  });
  W.add(fluid.mesh);
  fluid.source = (tau) => {
    const on = ease.out(seg(tau, 0, 0.9));
    const dip = 2.9;   // 発生源の球（半径 2.7）がノズルの出口より上へ出ないように（機体の根元を薄い煙の殻が覆うと点々に見える）
    return { pos: [R0[0], R0[1] + hL(tau) - dip, R0[2]], vel: [0, -58, 0], r: 2.7, on, dens: 30 * on, heat: 1.9 * on, flameI: 1.1 * on, densFade: 0.018, tempFade: 1.7, velFade: 0.36 };
  };
  const ice = new Debris(90, (i, rnd) => {
    const t0 = REL - 0.2 + rnd() * 3.6, a = rnd() * 6.283, hgt = 5 + rnd() * 22;
    return { t: t0, life: 2.6, size: 0.1 + rnd() * 0.2, p: [R0[0] + Math.cos(a) * 1.75, R0[1] + hL(t0) + hgt, R0[2] + Math.sin(a) * 1.75], v: [Math.cos(a) * (0.6 + rnd() * 1.6), 0.5, Math.sin(a) * (0.6 + rnd() * 1.6)], color: 0xffffff };
  }, { seed: 203, white: 1.2 });
  W.add(ice.mesh);
  const launchState = (tau, T) => {
    rocketOnPad();
    const h = hL(tau);
    S.root.position.y = R0[1] + h;
    S.root.rotation.y = 0.5 * ease.io(seg(tau, 6, 13));
    const p = ease.out(seg(tau, 0, 1.3));
    S.fire1(tau, p, (0.55 + 1.05 * seg(tau, 0.2, 2.0)) * (1 + 0.04 * Math.sin(tau * 23)));
    ice.show(tau);
    fluid.seek(Math.max(0, tau));
    const e = W.sky.cur.light;
    fluid.show({ sunDir: W.sunDirNow, sunCol: new THREE.Color().copy(e.sunColor).multiplyScalar(e.sunI * 0.17), ambCol: new THREE.Color().copy(e.sky).multiplyScalar(0.22) }, Math.round(T * 60));
    W.yard.swing(1);
    W.yard.scorchU.value = 0;
    return h;
  };

  // ---- F3：秒読み（5・4・3）→「2」で点火
  const digit = (t, t0, txt, col = '#ffffff') => { if (t >= t0 && t < t0 + 0.8) OV.bigNumber(E, txt, 0.7 + 0.3 * pop(t, t0, 0.18), 1 - seg(t, t0 + 0.62, t0 + 0.8), col, 300); };
  film.shot('f3_count', 2.8, (t, shot, T) => {
    dawn({ k: 0.15 });
    const tau = t - 2.4;
    rocketOnPad();
    if (tau > 0) launchState(tau, T); else fluid.seek(0);
    W.yard.swing(ease.io(seg(t, 0.1, 1.0)), 4);
    for (let i = 0; i < 4; i++) W.yard.swing(ease.io(seg(t, 1.1 + i * 0.1, 2.0 + i * 0.1)), i);
    digit(t, 0, '5'); digit(t, 0.8, '4'); digit(t, 1.6, '3'); digit(t, 2.4, '2', '#ffb04a');
    camK(W, ease.io(seg(t, 0, 2.8)), { p: [R0[0] + 20, DECK + 5.3, R0[2] + 30], t: [R0[0] - 2, DECK + 9.3, R0[2]], f: 38 }, { p: [R0[0] + 18, DECK + 4.0, R0[2] + 27], t: [R0[0] - 2, DECK + 7.8, R0[2]], f: 38 });
    W.shake(tau > 0 ? 0.03 + 0.07 * seg(tau, 0, 1.4) : 0);
    W.post.bars.value = 0.105;
  }, [[0, 'beep'], [0.8, 'beep'], [1.6, 'beep'], [2.4, 'beep'], [0.1, 'servo', { dur: 2.0 }], [2.4, 'ignite'], [2.4, 'rumble', { dur: 22, gain: 1.4 }]]);

  // ---- F4：エンジン（間近・火炎溝を横から）。「1」「0」→ 離床
  film.shot('f4_ignite', 4.2, (t, shot, T) => {
    dawn({ k: 0.2, size: 30, center: [R0[0], DECK + 3.8, R0[2]] });
    const tau = 0.4 + t;
    const h = launchState(tau, T);
    digit(tau, 0.8, '1', '#ffb04a'); digit(tau, 1.6, '0', '#ff6a3a');
    camK(W, ease.io(seg(t, 0, 4.2)), { p: [R0[0] + 3.5, DECK + 1.5, R0[2] + 21], t: [R0[0], DECK + 2.6, R0[2]], f: 38 }, { p: [R0[0] + 5, DECK + 2.4, R0[2] + 25], t: [R0[0], DECK + 4.2 + h * 0.6, R0[2]], f: 38 });
    W.shake(0.1 + 0.08 * seg(tau, 0.4, 2.2));
    W.engine.bloom.strength.value = 0.36;
    W.post.bars.value = 0.105;
  }, [[0.4, 'beep'], [1.2, 'beepHi'], [1.8, 'release']]);

  // ---- F5：離床（広い画）。塔を越えて、空へ
  film.shot('f5_liftoff', 8, (t, shot, T) => {
    const k = seg(t, 0, 8);
    dawn({ k: 0.25 + 0.3 * k, size: 60, center: [R0[0], DECK + 18 + 30 * k, R0[2]], light: { cover: 0.22 * (1 - ease.io(seg(t, 1.0, 4.5))) } });   // 見上げる空は雲を払って青く
    const tau = 4.6 + t;
    const h = launchState(tau, T);
    const ty = lerp(DECK + hL(4.6) + 13, DECK + h + 13, ease.io(seg(t, 0.0, 2.4)));
    W.cam([R0[0] + 64, 4.0, R0[2] + 108], [R0[0] - 1.5 * (1 - k), ty, R0[2]], lerp(25, 29, k));
    W.shake(0.11 * (1 - 0.5 * k));
    W.engine.bloom.strength.value = 0.34;
    W.post.bars.value = 0.105 * (1 - seg(t, 7.2, 8));
    if (t > 0.5 && t < 3.6) OV.line(E, 'LIFTOFF!', { y: 150, s: 12, a: Math.min(seg(t, 0.5, 0.7), 1 - seg(t, 3.2, 3.6)), color: '#ffffff' });
    if (t > 0.6 && t < 3.8) OV.subtitle(E, 'リフトオフ！', Math.min(seg(t, 0.6, 0.8), 1 - seg(t, 3.4, 3.8)));
  }, [[0.2, 'liftoff'], [0.5, 'hit'], [4.5, 'yay']]);

  // ---- F6：はるか上空。空が暗くなり、星が出る
  const skyPath = (s) => [-60 + s * 34 + s * s * 2.2, 40 + s * 46 - s * s * 1.6, -40 - s * 6];
  const skyTrail = new Puffs(380, (i, rnd) => {
    // 炎の先のほう（機体の 0.62 秒うしろ）から、乱れながら広がる煙。炎に下から照らされ、日なたと日かげの差が出る
    const s = (i / 380) * 5.2, q = skyPath(s - 0.62);
    return { t: s, life: 2.6 + rnd() * 2.2, size: 2.4 + rnd() * 3.0, p: [q[0] + (rnd() - 0.5) * 5, q[1] + (rnd() - 0.5) * 5, q[2] + (rnd() - 0.5) * 5], v: [(rnd() - 0.5) * 4 - 5, (rnd() - 0.5) * 4 - 6, (rnd() - 0.5) * 4], drag: 1.0, rise: 0.2 };
  }, { colA: 0xdccfbe, colB: 0x8f8a84, fire: 0.9, fireEnd: 0.1, colAt: 0.5, start: 0.35, opacity: 0.42, contrast: 1.5, turb: 1.6, seed: 211, low: true });
  W.add(skyTrail.mesh);
  film.shot('f6_sky', 4.8, (t) => {
    const k = ease.io(seg(t, 0, 4.8));
    W.env('day', 'space', 0.25 + 0.6 * k, { sunDir: [-0.5, 0.45, 0.7], size: 40, center: skyPath(t), dist: 200 });
    W.sky.U.starFloor.value = 1;
    const p = skyPath(t), p2 = skyPath(t + 0.05);
    S.root.visible = true; S.root.position.set(p[0], p[1], p[2]);
    aim(S.root, [p2[0] - p[0], p2[1] - p[1], p2[2] - p[2]]);
    S.fire1(t, 1, 2.3 + 0.1 * Math.sin(t * 19)); for (const f of S.f1) f.vac(0.3 + 0.5 * k);   // 上空：外気が薄く、炎が広がる
    skyTrail.show(t);
    { const fd = [p2[0] - p[0], p2[1] - p[1], p2[2] - p[2]], fn = Math.hypot(fd[0], fd[1], fd[2]) || 1; W.flame = { pos: [p[0] - (fd[0] / fn) * 10, p[1] - (fd[1] / fn) * 10, p[2] - (fd[2] / fn) * 10], color: 0xffb070, I: 3 }; }   // 炎が煙の尾を照らす
    const cp = mv([p[0] + 46, p[1] - 6, p[2] + 70], [p[0] + 30, p[1] + 4, p[2] + 60], k);
    W.cam(cp, [p[0] - 4, p[1] - 2, p[2]], 30);
    W.shake(0.05);
    W.engine.bloom.strength.value = 0.45;
    W.post.fade.value = seg(t, 4.4, 4.8);
  }, [[0, 'roar', { dur: 4.8 }]]);

  // =====================================================================
  // G：宇宙
  // =====================================================================
  const SUNS = [0.62, 0.3, 0.72];
  const space = (o = {}) => {
    const sd = o.sunDir ?? SUNS;
    W.env('space', 'space', 0, { sunDir: sd, size: o.size ?? 22, center: o.center ?? [0, 0, 0], dist: 160, hemiMul: o.hemiMul ?? 0.7, fillDir: o.fillDir ?? [-0.6, -0.5, 0.3], fillColor: o.fillColor ?? 0x4f7fd8, fillI: o.fillI ?? 0.5 });
    W.sky.U.twinkle.value = 0;
    W.clip(0.5, 30000);
    const c = W.camera.position;
    const n = Math.hypot(sd[0], sd[1], sd[2]);
    W.sunFlare.visible = o.flare !== false; W.sunFlare.position.set(c.x + (sd[0] / n) * 9000, c.y + (sd[1] / n) * 9000, c.z + (sd[2] / n) * 9000); W.sunFlare.scale.setScalar(o.flareSize ?? 3400);
  };
  const earthAt = (pos, r, rotY = 0, cloud = 0, detail = 1) => { const e = W.earth; e.visible = true; e.position.set(pos[0], pos[1], pos[2]); e.scale.setScalar(r); e.rotation.set(0.41, rotY, 0); e.userData.U.cloud.value = cloud; e.userData.setNear(detail > 1); };

  // ---- G1：1 段目を切り離す（眼下に地球）
  const AX = (() => { const v = [0.86, 0.42, -0.3], n = Math.hypot(...v); return v.map((x) => x / n); })();
  const sepPuff = new Puffs(60, (i, rnd) => { const a = rnd() * 6.283; return { t: 1.5 + rnd() * 0.15, life: 0.9 + rnd() * 0.6, size: 0.5 + rnd() * 0.7, p: [0, 0, 0], v: [Math.cos(a) * (2 + rnd() * 4), (rnd() - 0.5) * 3, Math.sin(a) * (2 + rnd() * 4)], drag: 1.2 }; }, { colA: 0xffffff, colB: 0xd9dde3, seed: 221, low: true });
  S.root.add(sepPuff.mesh); sepPuff.mesh.position.y = SAT.s2Bot;
  film.shot('g1_stage', 6.4, (t) => {
    W.cam(mv([14, 6, 34], [22, 9, 40], ease.io(seg(t, 0, 6.4))), mv([2, 1, 0], [6, 3, 0], ease.io(seg(t, 0, 6.4))), 34);
    space({ sunDir: [0.3, 0.85, 0.45], size: 30 });
    earthAt([-300, -4420, -900], 4000, 0, t * 0.0006, 7);
    faceEarth(W.earth, W.camera, 21, -17, 19 - t * 0.3, 14);   // アフリカ西岸の沖：左が大西洋、右がサハラ
    const drift = t * 3.0;
    S.root.visible = true; S.root.position.set(AX[0] * drift - 4, AX[1] * drift - 2, AX[2] * drift);
    aim(S.root, AX); S.root.rotateY(0.5 + t * 0.05);
    const MECO = 1.1, SEP = 1.5, IGN2 = 2.5;
    if (t < MECO) { S.fire1(t, 1 - seg(t, 0.8, MECO), 2.2); for (const f of S.f1) f.vac(1); }
    if (t > SEP) {
      const d = t - SEP;
      S.s1.position.y = S.s1.userData.home - d * 5 - d * d * 1.2;
      S.s1.rotation.set(d * 0.22, 0, d * 0.16);
      S.s1.position.x = -d * 0.8;
      sepPuff.mesh.visible = true; sepPuff.show(t);
    }
    if (t > IGN2) S.fire2(t, ease.out(seg(t, IGN2, IGN2 + 0.5)), 1.5);
    const LES = 4.6;
    if (t > LES) { const d = t - LES; S.les.position.y = S.les.userData.home + d * 9 + d * d * 6; S.les.position.x = d * d * 2.5; S.les.rotation.z = -d * 0.9; }
    W.shake(t < MECO ? 0.04 : 0.012);
    fades(W, t, 6.4, 0.5, 0);
    if (t > 1.6 && t < 4.4) OV.subtitle(E, '第 1 段、切り離し。', Math.min(seg(t, 1.6, 1.85), 1 - seg(t, 4.1, 4.4)));
  }, [[0, 'roar', { dur: 1.1 }], [1.5, 'sep'], [2.5, 'ignite2'], [2.5, 'hum', { dur: 4 }], [4.6, 'zip']]);

  // ---- G2：無重力
  film.shot('g2_zero', 5.2, (t) => {
    W.cabin.root.visible = true; W.cabin.uT.value = t;
    W.light({ sunDir: [0.15, 0.7, 1.0], sunI: 0.95, sunColor: 0xfff4e6, hemiI: 0.2, sky: 0x9fb0d6, ground: 0x4a4f5c, size: 9, center: [0, 1, 0], fillDir: [-0.9, 0.2, 0.4], fillColor: 0x5fa8ff, fillI: 0.25 });
    W.cabin.window(0.16, 0.42, 1.0, 0.75); W.cabin.sunbeam(1); W.cabin.time(705);   // 左の窓から太陽の光が斜めに差し込む。打ち上げから約 12 分
    const k = ease.out(seg(t, 0.3, 2.2));
    // それぞれの浮き方
    W.claude.at(SEATS[0] + 0.15 * Math.sin(t * 0.9), 0.5 + 0.55 * k + 0.08 * Math.sin(t * 1.4), 0.25, 0.1 * Math.sin(t * 0.8)).helm().eyes(t < 1.4 ? 'wide' : 'happy').arms(0.9 * k, 0.9 * k).lean(0.1 * Math.sin(t * 1.1), 0.25 * Math.sin(t * 0.7) * k);
    W.gpt.at(SEATS[1] + 0.25 * k, 0.5 + 0.9 * k + 0.1 * Math.sin(t * 1.7), 0.5, 0).helm().face(t < 1.6 ? 'wide' : 'happy').arms(1.2 * k, 0.7 * k, 0.5, 0.2).lean(0, t * 0.9 * k);
    W.gemini.at(SEATS[2] + 0.1, 0.5 + 0.45 * k, 0.3).helm().eyes('happy').float(0.25).tilt(0, t * 2.4 * k, 0);
    const gx = SEATS[3] - 1.0 * Math.abs(((t * 0.45) % 2) - 1) * k, gy = 0.5 + (0.4 + 1.5 * Math.abs(((t * 0.62 + 0.3) % 2) - 1)) * k;
    W.grok.at(gx, gy, 0.6).helm().eyes('happy').look(Math.sin(t * 2) * 0.4, Math.cos(t * 1.7) * 0.3);
    W.laptop.root.visible = true; W.laptop.root.position.set(SEATS[1] - 0.8 - 0.3 * k, 1.0 + 1.3 * k + 0.1 * Math.sin(t * 2), 1.2); W.laptop.root.rotation.set(t * 0.8, t * 0.5, t * 0.3); W.laptop.screen('code', t * 6);
    W.clipboard.visible = true; W.clipboard.position.set(SEATS[0] + 1.0, 1.1 + 1.0 * k, 1.0); W.clipboard.rotation.set(t * 0.6, t * 0.9, 0.3);
    W.cam([0, 1.9, 4.9], [0, 1.65, 0], 46);
    W.clip(0.1, 60);
    W.post.focus.value = 4.5; W.post.focal.value = 6.5; W.post.bokeh.value = 2.0;
    if (t > 0.5 && t < 4.6) OV.subtitle(E, '無重力。', Math.min(seg(t, 0.5, 0.8), 1 - seg(t, 4.2, 4.6)));
  }, [[0.3, 'float'], [1.0, 'yay']]);

  // ---- G3：地球を背に、月へ（美しい長回し）
  const craft = (O, A, roll = 0) => {
    W.csm.visible = true; W.csm.position.set(O[0] - A[0] * 2.84, O[1] - A[1] * 2.84, O[2] - A[2] * 2.84); aim(W.csm, A); W.csm.rotateY(roll);
    const Lr = W.lander.root; Lr.visible = true; Lr.position.set(O[0] + A[0] * 4.9, O[1] + A[1] * 4.9, O[2] + A[2] * 4.9); aim(Lr, [-A[0], -A[1], -A[2]]); Lr.rotateY(-roll);
  };
  film.shot('g3_coast', 8, (t) => {
    const k = ease.io(seg(t, 0, 8));
    const A = [-0.94, 0.18, -0.28];
    const O = [lerp(9, -7, k), lerp(-1.5, 1.2, k), 0];
    W.cam(mv([4, 2.6, 23], [-3, 1.8, 19], k), mv([1, 0.4, 0], [-2, 0.8, 0], k), 34);
    space({ sunDir: [0.75, 0.22, 0.62], size: 16, center: O });
    earthAt([150, -40, -520], 150, 3.9 + t * 0.012, t * 0.01);
    craft(O, A, t * 0.18);
    fades(W, t, 8, 0.8, 0.5);
    if (t > 1.0 && t < 7.0) OV.subtitle(E, '地球から 38 万 km。月へ向かう。', Math.min(seg(t, 1.0, 1.4), 1 - seg(t, 6.6, 7.0)));
  }, [[0, 'space', { dur: 8 }]]);

  // ---- G4：月の地平線から、地球が昇る
  film.shot('g4_earthrise', 7.2, (t) => {
    const k = seg(t, 0, 7.2);
    W.cam([0, 0, 0], [0, -6.5, -60], 36);
    space({ sunDir: [0.55, 0.38, 0.75], size: 16, center: [0, 0, -30], flare: false });
    const m = W.moonGlobe; m.visible = true; m.scale.setScalar(1500); m.position.set(0, -1500 - 95, -260); m.rotation.set(0.2 - k * 0.035, 1.2, 0.3);
    const el = lerp(-15.5, -5.5, ease.io(k)) * Math.PI / 180;
    const D = 9000;
    earthAt([-D * 0.1, Math.sin(el) * D, -Math.cos(el) * D], 520, 2.0 + t * 0.004, t * 0.004);
    const A = [0.97, 0.05, -0.2];
    craft([lerp(-22, 16, k), lerp(-5.5, -3.2, k), -52], A, t * 0.15);
    fades(W, t, 7.2, 0.6, 0.6);
  }, [[0, 'space', { dur: 7.2 }], [2.2, 'wonder']]);
}
