// 第 2 幕：4 回の失敗（GPT → Grok → Gemini → Claude）
import * as L from './lib.js';
import { scorchMark } from '../fx/fx.js';
const { seg, ease, pop, popInOut, lerp, mv, camK, place4, hop, hops, walk, poofs, aim, NAMES, WATCH, TESTPAD, dayYard, nightYard, fades, OV, Puffs, Sparkles, Explosion, Debris, glowSprite, clamp, bump } = L;

export function seq2(film, W) {
  const E = W.engine;
  const PADY = 0.3;
  const TP = [TESTPAD[0], PADY, TESTPAD[2]];
  const cardLine = (t, o, sub) => {
    OV.card(E, { k: seg(t, o.t0, o.t0 + 0.35), typed: seg(t, o.t0 + 0.3, o.t0 + 0.95), stamp: seg(t, o.t0 + 1.0, o.t0 + 1.2), ...o });
    if (t > o.t0 + 1.15) OV.subtitle(E, sub, seg(t, o.t0 + 1.15, o.t0 + 1.4));
  };

  // =====================================================================
  // C1：GPT「0.3 秒で完成」
  // =====================================================================
  const GP = [3.4, 0, -9.6];
  const J = W.junk;
  const order = ['legs', 'engine', 'body', 'finLow', 'noseSide', 'finTop1', 'finTop2', 'window', 'label', 'dish'];
  const jt = [0.35, 0.55, 0.8, 1.1, 1.35, 1.6, 1.8, 2.0, 2.2, 2.4];
  const deskGpt = (typing, t) => {
    W.gpt.at(GP[0], 0, GP[2]).faceTo(0, -15);
    W.crate.visible = true; W.crate.position.set(GP[0] - 0.45, 0.31, GP[2] - 0.75); W.crate.rotation.y = 0.5;
    W.laptop.root.visible = true; W.laptop.root.position.set(GP[0] - 0.45, 0.62, GP[2] - 0.75); W.laptop.root.rotation.y = 0.54;
    if (typing) { W.gpt.face('code', { scroll: t * 12 }).arms(0.1, 0.1, 1.15 + Math.sin(t * 43) * 0.3, 1.15 + Math.cos(t * 39) * 0.3); W.laptop.screen('code', t * 12); }
  };
  film.shot('c1_build', 3.5, (t) => {
    dayYard(W, { size: 20, center: [1, 0, -11] });
    J.root.visible = true; J.root.position.set(...TP);
    order.forEach((n, i) => {
      const p = J[n], k = pop(t, jt[i], 0.26), h = p.userData.home;
      p.visible = k > 0.001; p.scale.setScalar(Math.max(0.001, k));
      p.position.y = h.p[1] + (1 - Math.min(1, k)) * 1.4;
    });
    const done = t > 2.75;
    deskGpt(!done, t);
    if (done) { W.gpt.face('check').arms(1.2, 1.2); W.laptop.screen('ok'); hop(W.gpt, t, 2.8, 0.4, 0.3); W.say('check', W.gpt, pop(t, 2.8)); OV.line(E, 'BUILD TIME: 0.3 S', { y: 110, s: 8, a: seg(t, 2.85, 3.0) }); }
    camK(W, ease.io(seg(t, 0, 3.5)), { p: [7.6, 3.0, -4.2], t: [1.5, 1.9, -13.6], f: 38 }, { p: [7.0, 2.8, -4.8], t: [1.4, 2.1, -13.6], f: 38 });
  }, [[0.1, 'type', { dur: 2.6 }], ...jt.map((x) => [x, 'snap']), [2.8, 'ding'], [2.8, 'jump']]);

  film.shot('c1_look', 2.5, (t) => {
    dayYard(W, { size: 20, center: [0, 0, -11] });
    J.root.visible = true; J.root.position.set(...TP);
    place4(W, WATCH, [0, -15]);
    W.yard.board.visible = false;
    deskGpt(false, t); W.gpt.face('happy').arms(0.9, 0.9); W.laptop.screen('ok');
    W.claude.eyes('open').lean(0, 0.12 * ease.io(seg(t, 0.3, 0.8)));
    W.gemini.tilt(-0.3 * ease.io(seg(t, 0.4, 0.9)));
    W.grok.look(0, 0.3).eyes('flat');
    W.say('q', W.claude, popInOut(t, 0.5, 2.3)); W.say('q', W.gemini, popInOut(t, 0.75, 2.3)); W.say('dots', W.grok, popInOut(t, 1.0, 2.3));
    camK(W, ease.io(seg(t, 0, 2.5)), { p: [-0.4, 1.0, -2.2], t: [0.2, 2.5, -15], f: 40 }, { p: [-0.3, 1.0, -2.8], t: [0.2, 2.6, -15], f: 40 });
    if (t > 1.9) { W.gpt.arms(0.1, 0.1, 1.5, 0.2); hop(W.gpt, t, 1.95, 0.3, 0.15); }
  }, [[0.5, 'pop'], [0.75, 'pop'], [1.0, 'pop'], [1.95, 'key']]);

  // 部品が外れていく動き（どのコマも時刻から決まる）
  const rise = (t) => (t < 0.45 ? 0 : t < 1.4 ? 2.6 * ease.out(seg(t, 0.45, 1.3)) : Math.max(0, 2.6 - 4.9 * (t - 1.4) ** 2));
  const LAND = 1.4 + Math.sqrt(2.6 / 4.9);
  const drops = { finTop1: [0.75, [-1.6, 1.0, 0.6]], noseSide: [0.9, [2.4, 0.5, 0.4]], dish: [1.0, [-2.2, 1.2, -0.5]], finLow: [1.1, [-1.4, 0.3, 1.0]], finTop2: [1.2, [1.2, 1.4, -0.8]], window: [1.3, [0.5, 0.2, 2.0]], label: [1.35, [-0.4, 0.6, 1.6]] };
  const landings = [];
  for (const n of Object.keys(drops)) {
    const [td, v] = drops[n], h = J[n].userData.home.p;
    const y0 = h[1] + rise(td), yg = 0.14;
    const tau = (v[1] + Math.sqrt(v[1] * v[1] + 19.6 * (y0 - yg))) / 9.8;
    drops[n].push(tau, y0);
    landings.push({ t: td + tau, p: [TP[0] + h[0] + v[0] * tau, PADY, TP[2] + h[2] + v[2] * tau], n: 7, size: 0.28, speed: 1.6 });
  }
  const engPos = (s) => [s * 7 + Math.sin(s * 16) * 1.8 * s, 0.5 + 2.6 + s * 11 + Math.cos(s * 16) * 0.5, -s * 2 + Math.cos(s * 16) * 1.8 * s];
  const junkPose = (t) => {
    const r = rise(t);
    const top = ease.bounce(seg(t, LAND, LAND + 0.7));
    for (const n of order) {
      const p = J[n], h = p.userData.home;
      p.visible = true; p.scale.setScalar(1);
      p.position.set(h.p[0], h.p[1] + r, h.p[2]); p.rotation.set(...h.r);
      if (drops[n] && t > drops[n][0]) {
        const [td, v, tau, y0] = drops[n], s = Math.min(t - td, tau);
        // 地面で 2 回はねて止まる（はねるたびに低く・遅く・回転もゆるむ）
        const bb = Math.max(0, t - td - tau), vi = Math.abs(v[1] - 9.8 * tau), u1 = vi * 0.3, T1 = (2 * u1) / 9.8, u2 = u1 * 0.3, T2 = (2 * u2) / 9.8;
        const b1 = Math.min(bb, T1), b2 = clamp(bb - T1, 0, T2);
        const hopY = u1 * b1 - 4.9 * b1 * b1 + u2 * b2 - 4.9 * b2 * b2, run = s + b1 * 0.5 + b2 * 0.25, spin = s + b1 * 0.45 + b2 * 0.2;
        p.position.set(h.p[0] + v[0] * run, Math.max(0.14, bb > 0 ? 0.14 + hopY : y0 + v[1] * s - 4.9 * s * s), h.p[2] + v[2] * run);
        p.rotation.set(h.r[0] + spin * 5, h.r[1] + spin * 3, h.r[2] + spin * 6);
      }
    }
    // 胴は落ちて横倒し、脚は開く
    J.body.rotation.z = top * 1.47; J.body.position.x = -top * 1.7; J.body.position.y = lerp(2.9 + r, 0.8, top);
    J.legs.rotation.z = top * 0.5; J.legs.position.x = top * 0.9; J.legs.position.y = lerp(0.5 + r, 0.42, top); J.legs.rotation.x = top * 0.3;
    // エンジンは、ひとりで飛んでいく
    if (t > 1.4) { const s = t - 1.4, q = engPos(s); J.engine.position.set(q[0], q[1], q[2]); J.engine.rotation.set(Math.sin(s * 16) * 0.6, s * 4, -0.7 - s * 1.2); }
    J.flame.set(t, t < 0.05 ? 0 : Math.min(1, t / 0.35), 0.8 + Math.sin(t * 31) * 0.12);
  };
  const c1dust = poofs(W, [{ t: 0.05, p: TP, n: 26, size: 0.5, speed: 3.5, life: 1.3 }, { t: 0.25, p: TP, n: 20, size: 0.6, speed: 4.5, life: 1.4 }, ...landings, { t: LAND, p: [TP[0], PADY, TP[2]], n: 22, size: 0.5, speed: 3.2 }, { t: LAND + 0.45, p: [TP[0] - 1.8, PADY, TP[2]], n: 26, size: 0.55, speed: 3.4 }], { seed: 41 });
  const c1trail = new Puffs(70, (i, rnd) => {
    const s = (i / 70) * 1.25, q = engPos(s);
    return { t: 1.4 + s, life: 0.6 + rnd() * 0.5, size: 0.22 + rnd() * 0.25, p: [TP[0] + q[0], TP[1] + q[1], TP[2] + q[2]], v: [(rnd() - 0.5) * 0.8, -1 - rnd(), (rnd() - 0.5) * 0.8], drag: 2, rise: 0.4 };
  }, { colA: 0xffe2b0, colB: 0x9a9a9a, seed: 43, low: true });
  W.add(c1trail.mesh);

  film.shot('c1_fail', 3.2, (t) => {
    dayYard(W, { size: 20, center: [1, 0, -12] });
    J.root.visible = true; J.root.position.set(...TP);
    junkPose(t);
    c1dust.show(t); c1trail.show(t);
    deskGpt(false, t); W.laptop.screen(t > 1.4 ? 'err' : 'ok');
    W.gpt.face(t < 0.7 ? 'happy' : t < 1.4 ? 'wide' : 'dead').arms(t < 0.7 ? 1.0 : 0.2, t < 0.7 ? 1.0 : 0.2);
    const r = rise(Math.min(t, 1.4));
    camK(W, ease.io(seg(t, 1.3, 2.3)), { p: [7.6, 2.0, -8.2], t: [0.4, 2.4 + r * 0.55, -14.6], f: 40 }, { p: [7.6, 2.0, -8.2], t: [-0.2, 1.7, -14.6], f: 40 });
    W.shake(t < 1.4 ? 0.035 + 0.03 * seg(t, 0, 0.4) : 0.1 * bump(t, LAND, 0.4));
  }, [[0, 'ignite'], [0, 'rumble', { dur: 1.4, gain: 0.5 }], ...Object.values(drops).map((d) => [d[0], 'ping']), ...landings.map((l) => [l.t, 'clank']), [1.4, 'zip'], [LAND, 'thud'], [LAND + 0.45, 'crash']]);

  film.shot('c1_card', 2.6, (t) => {
    dayYard(W, { size: 20, center: [1, 0, -12] });
    J.root.visible = true; J.root.position.set(...TP);
    junkPose(3.2 + t); J.engine.visible = false; J.flame.set(0, 0);
    c1dust.show(3.2 + t);
    W.crate.visible = true; W.crate.position.set(GP[0] - 0.45, 0.31, GP[2] - 0.75); W.crate.rotation.y = 0.5;
    W.laptop.root.visible = true; W.laptop.root.position.set(GP[0] - 0.45, 0.62, GP[2] - 0.75); W.laptop.root.rotation.y = 0.54; W.laptop.screen('err');
    walk(W.gpt, t, 0, 1.1, GP, [1.7, 0, -11.6], { rate: 15 });
    W.gpt.faceTo(-1, -15).face(t < 1.2 ? 'wide' : 'sad').nod(t > 1.2 ? 0.25 : 0, 0);
    camK(W, ease.io(seg(t, 0, 2.6)), { p: [-5.2, 1.35, -8.2], t: [-0.1, 0.9, -13.9], f: 36 }, { p: [-4.9, 1.3, -8.6], t: [-0.1, 0.9, -13.9], f: 36 });
    cardLine(t, { t0: 0.15, cmd: 'launch --attempt 01 --by gpt', status: 'FAILED', detail: 'FELL APART IN 0.8 S' }, '試行 01：0.3 秒で完成、0.8 秒で空中分解。');
  }, [[0.45, 'type', { dur: 0.6 }], [1.15, 'fail'], [1.15, 'stamp']]);

  // =====================================================================
  // C2：Grok「エンジン 27 基」
  // =====================================================================
  const B = W.booster;
  const X2 = [1.5, 9.5, -13.5];
  const A_END = [0.25, PADY + 34, -15];
  const path2 = (s) => {
    if (s <= 0) return [0, PADY, -15];
    if (s < 0.9) { const u = s / 0.9; return [Math.sin(s * 9) * 0.3 * s, PADY + 34 * Math.pow(u, 1.8), -15]; }
    if (s < 2.4) {
      const u = (s - 0.9) / 1.5, th = Math.PI * 2 * 1.5 * u;
      return [A_END[0] - 12 * Math.sin(th) * (0.3 + u), A_END[1] + 8 * (1 - Math.cos(th)) + 4 * u, A_END[2] - 14 * u + 9 * Math.sin(th * 0.5)];
    }
    const bEnd = [A_END[0], A_END[1] + 20, A_END[2] - 23];
    return mv(bEnd, X2, ease.in(clamp((s - 2.4) / 0.5)));
  };
  const BOOM = 0.7 + 2.9;
  const c2trail = new Puffs(260, (i, rnd) => {
    const s = (i / 260) * 2.9, q = path2(s);
    return { t: 0.7 + s, life: 1.2 + rnd() * 1.0, size: 0.7 + rnd() * 0.9 + s * 0.2, p: [q[0] + (rnd() - 0.5) * 0.6, q[1] + (rnd() - 0.5) * 0.6, q[2] + (rnd() - 0.5) * 0.6], v: [(rnd() - 0.5) * 1.5, (rnd() - 0.5) * 1.5, (rnd() - 0.5) * 1.5], drag: 2, rise: 0.5 };
  }, { colA: 0xf4e6cf, colB: 0xa9a6a1, fire: 2.5, fireEnd: 0.18, contrast: 1.25, turb: 0.4, wind: [0.5, 0.05, 0.15], seed: 51, low: true });
  W.add(c2trail.mesh);
  const c2pad = poofs(W, [{ t: 0.05, p: TP, n: 40, size: 1.0, speed: 6, life: 1.8 }, { t: 0.3, p: TP, n: 40, size: 1.3, speed: 8, life: 2.2 }, { t: 0.6, p: TP, n: 40, size: 1.5, speed: 9, life: 2.4 }], { seed: 52, colA: 0xfff0d8, colB: 0xb9b2a6, floor: PADY });
  const c2boom = new Explosion({ scale: 1.8, seed: 61, floor: 0.04 - X2[1], wind: [0.7, 0.1, 0.25] });
  W.add(c2boom.root); c2boom.root.position.set(...X2);
  // ---- 爆発のあと（時刻は c2_launch の時計）：地面を走る土けむりの輪、落ちて転がる残骸、台の上で燃え残りから上がる黒い煙、くすぶる細い煙、こげ跡
  const HI2 = W.quality === 'high';
  const GZ = [X2[0], PADY, X2[2]];
  const c2ring = new Puffs(HI2 ? 420 : 260, (i, rnd) => {
    const a = rnd() * 6.283, sp = 9 + rnd() * 13, r0 = 0.5 + rnd() * 3.0;
    return { t: BOOM + 0.1 + r0 * 0.03 + rnd() * 0.12, life: 2.0 + rnd() * 2.4, size: 0.5 + rnd() * 1.0, p: [GZ[0] + Math.cos(a) * r0, 0.05, GZ[2] + Math.sin(a) * r0], v: [Math.cos(a) * sp, rnd() * 1.0, Math.sin(a) * sp], drag: 2.0 + rnd() * 0.8, rise: 0.12 * rnd() };
  }, { colA: 0xd3c5a8, colB: 0xb0a288, dust: true, opacity: 0.2, lump: 0.22, floor: 0, wind: [0.5, 0, 0.15], seed: 62 });
  // はね方は Debris と同じ式（はね返り 0.34・横の減速 0.55）：落ちる場所から初速を逆算する
  const runOf = (vy, h0, e = 0.34, fr = 0.55) => { const vi = Math.sqrt(vy * vy + 19.6 * h0), k = e * fr; return (vy + vi) / 9.8 + ((2 * vi) / 9.8) * (k + k * k + k * k * k); };
  const SPOTS = [[-4.6, -11.6], [4.9, -12.4], [5.6, -16.4], [-5.4, -17.2], [0.8, -11.4], [-2.8, -11.9], [3.3, -11.8]];
  const c2wreck = new Debris(HI2 ? 30 : 20, (i, rnd) => {
    let tx, tz;
    if (i < SPOTS.length) [tx, tz] = SPOTS[i];
    else { const a = rnd() * 6.283, r = 4.9 + rnd() * 5.5; tx = TP[0] + Math.cos(a) * r; tz = TP[2] + Math.sin(a) * r; }
    const vy = -1 + rnd() * 8, run = runOf(vy, X2[1] - 0.04, 0.24, 0.5);
    return { t: BOOM + rnd() * 0.12, life: 3.0, size: i < SPOTS.length ? 0.45 + rnd() * 0.45 : 0.16 + rnd() * 0.34, p: [X2[0], X2[1], X2[2]], v: [(tx - X2[0]) / run, vy, (tz - X2[2]) / run] };
  }, { seed: 63, colors: [0x1a1b1f, 0x2b2b2e, 0x4a2a22, 0x6f747a, 0x3a3836], hot: 1.4, floor: 0.04, bounce: 0.24, friction: 0.5, linger: 12, shadow: true });
  const c2pile = new Debris(7, (i, rnd) => {
    const a = (i / 7) * 6.283 + rnd(), r = 0.3 + rnd() * 1.3, vy = -2 + rnd() * 4, run = runOf(vy, X2[1] - PADY - 0.05, 0.2, 0.45);
    return { t: BOOM + rnd() * 0.1, life: 3.0, size: 0.7 + rnd() * 0.6, p: [X2[0], X2[1], X2[2]], v: [(Math.cos(a) * r) / run, vy, (Math.sin(a) * r - 0.6) / run] };
  }, { seed: 64, colors: [0x1a1b1f, 0x2b2b2e, 0x3a3836, 0x8c939b], hot: 1.8, floor: PADY + 0.05, bounce: 0.2, friction: 0.45, linger: 12, shadow: true });
  const NCOL = HI2 ? 300 : 200;
  const c2col = new Puffs(NCOL, (i, rnd) => {
    const t0 = BOOM + 1.1 + (i / NCOL) * 5.2;
    return { t: t0, life: 2.6 + rnd() * 1.8, size: 0.5 + rnd() * 0.9, p: [GZ[0] + (rnd() - 0.5) * 1.3, PADY + 0.25, GZ[2] - 0.6 + (rnd() - 0.5) * 1.3], v: [(rnd() - 0.5) * 0.6, 1.4 + rnd() * 1.2, (rnd() - 0.5) * 0.6], drag: 0.6, rise: 1.4 + rnd() * 0.8 };
  }, { colA: 0x191715, colB: 0x4a4541, colAt: 0.85, opacity: 0.62, contrast: 1.5, turb: 0.55, wind: [0.9, 0, 0.3], start: 0.3, fadeAt: 0.5, seed: 65 });
  const NSM = HI2 ? 210 : 140;
  const c2smolder = new Puffs(NSM, (i, rnd) => {
    const [x, z] = SPOTS[i % SPOTS.length];
    return { t: BOOM + 2.0 + rnd() * 4.6, life: 1.4 + rnd() * 1.2, size: 0.12 + rnd() * 0.22, p: [x + (rnd() - 0.5) * 0.25, 0.1, z + (rnd() - 0.5) * 0.25], v: [(rnd() - 0.5) * 0.2, 0.5 + rnd() * 0.5, (rnd() - 0.5) * 0.2], drag: 0.8, rise: 0.5 + rnd() * 0.4 };
  }, { colA: 0x4a4643, colB: 0x8a8580, dust: true, aspect: [0.75, 1.25], opacity: 0.34, lump: 0.25, turb: 0.18, wind: [0.55, 0, 0.18], seed: 66 });
  for (const e of [c2ring, c2wreck, c2pile, c2col, c2smolder]) W.add(e.mesh);
  const c2marks = SPOTS.map(([x, z], i) => { const mk = scorchMark(0.5 + (i % 3) * 0.16, { seed: 0.13 + i * 0.17 }); mk.position.set(x, 0.035, z); return W.add(mk); });
  const c2after = (t) => { c2ring.show(t); c2wreck.show(t); c2pile.show(t); c2col.show(t); c2smolder.show(t); for (const mk of c2marks) mk.visible = t > BOOM + 1.9; };

  film.shot('c2_build', 3.5, (t) => {
    dayYard(W, { size: 20, center: [0, 0, -12] });
    W.yard.scorchU.value = 0.5;
    B.root.visible = true; B.root.position.set(...TP);
    const n = Math.floor(27 * ease.io(seg(t, 0.4, 2.8)));
    B.count(n, pop((t * 27) % 1, 0, 0.6));
    place4(W, WATCH, [0, -15]);
    W.gpt.face('eyes'); W.claude.eyes('sad'); W.gemini.eyes('open');
    W.say('sweat', W.claude, popInOut(t, 1.4, 3.4), { size: 0.7 });
    const a = t * 5.2, rr = 3.1;
    const still = t > 2.9;
    if (!still) { W.grok.at(Math.sin(a) * rr, PADY, -15 + Math.cos(a) * rr).eyes('angry').look(Math.cos(a) * 0.5, 0.3); hops(W.grok, t, 0, 20, 0.22, 0.4); }
    else { W.grok.at(Math.sin(2.9 * 5.2) * rr, PADY, -15 + Math.cos(2.9 * 5.2) * rr).eyes('happy').faceTo(-5, -6); W.say('fire', W.grok, pop(t, 3.0)); hop(W.grok, t, 3.0, 0.4, 0.5); }
    if (n > 0) OV.line(E, 'ENGINES  X' + n, { y: 104, s: 9, color: n >= 27 ? '#ffb04a' : '#ffffff' });
    camK(W, ease.io(seg(t, 0, 3.5)), { p: [-6.6, 1.5, -6.6], t: [0, 3.0, -15], f: 38 }, { p: [-5.6, 1.5, -7.6], t: [0, 3.2, -15], f: 38 });
  }, [...Array.from({ length: 27 }, (_, i) => [0.4 + (i / 27) * 2.4, 'snap', { up: i }]), [1.4, 'pop'], [3.0, 'pop']]);

  film.shot('c2_launch', 4.6, (t) => {
    dayYard(W, { size: 34, center: [0, 6, -13] });
    W.yard.scorchU.value = 0.5 + 0.5 * seg(t, 0, 0.7);
    place4(W, WATCH, [0, -15]);
    W.claude.eyes(t < BOOM ? 'wide' : 'closed'); W.gpt.face(t < BOOM ? 'wide' : 'strain'); W.gemini.eyes(t < BOOM ? 'wide' : 'closed'); W.grok.eyes(t < BOOM ? 'happy' : 'wide');
    const s = t - 0.7;
    const P = path2(s);
    if (t < BOOM) {
      B.root.visible = true; B.root.position.set(P[0], P[1], P[2]);
      if (s > 0) { const P2 = path2(s + 0.02); aim(B.root, [P2[0] - P[0], P2[1] - P[1], P2[2] - P[2]]); }
      B.fire(t, Math.min(1, t / 0.5), 1 + Math.sin(t * 37) * 0.1);
    }
    c2pad.show(t); c2trail.show(t); c2boom.show(t - BOOM); c2after(t);
    W.flame = t < BOOM ? { pos: [P[0], P[1] - 1.5, P[2]], color: 0xffa050, I: 2.2 * Math.min(1, t / 0.5) } : { pos: X2, color: 0xff9040, I: 7 * Math.exp(-(t - BOOM) * 2.6) };   // 炎と火球が煙を照らす
    // みんなの目が、機体を追う
    for (const a of W.actors) { if (a !== W.grok) a.lean(clamp(-(P[1] - 3) * 0.012, -0.35, 0)); }
    W.grok.look(clamp(P[0] * 0.05, -0.6, 0.6), clamp(P[1] * 0.03, 0, 0.9));
    const look = t < BOOM ? path2(Math.max(0, s - 0.1)) : X2;
    const tg = mv([0, 4, -15], look, 0.86);
    W.cam([-10.5, 1.5, -1.2], tg, 52);
    W.shake(t < 0.8 ? 0.09 * seg(t, 0, 0.3) : t > BOOM ? 0.35 * Math.exp(-(t - BOOM) * 4) : 0.02);
    if (t > BOOM) { W.post.flash.value = 0.9 * Math.exp(-(t - BOOM) * 13); for (const a of W.actors) a.soot(seg(t, BOOM, BOOM + 0.25)); }
  }, [[0, 'ignite'], [0, 'rumble', { dur: 3.6, gain: 1.0 }], [0.7, 'scream', { dur: 2.9 }], [BOOM, 'boom', { size: 1.4 }]]);

  const c2rain = new Debris(46, (i, rnd) => {
    const x = (rnd() - 0.5) * 12, z = -8 + (rnd() - 0.5) * 7, h = 6 + rnd() * 7;
    return { t: rnd() * 1.6 - 1.0, life: Math.sqrt((2 * h) / 9.8), size: 0.1 + rnd() * 0.2, p: [x, h, z], v: [(rnd() - 0.5) * 1.5, 0, (rnd() - 0.5) * 1.5] };
  }, { seed: 71, colors: [0x1a1b1f, 0x4a2a22, 0x6f747a, 0x3a3836, 0x2b2b2e], floor: 0.04, linger: 9, hot: 0.8, shadow: true });
  W.add(c2rain.mesh);
  const c2wisp = new Puffs(60, (i, rnd) => {
    const w = [WATCH.claude, WATCH.gpt, WATCH.gemini, WATCH.grok][i % 4];
    return { t: rnd() * 2.6 - 0.4, life: 1.0 + rnd() * 0.9, size: 0.1 + rnd() * 0.16, p: [w[0] + (rnd() - 0.5) * 0.7, 0.8 + rnd() * 0.4, w[2] + (rnd() - 0.5) * 0.3], v: [(rnd() - 0.5) * 0.3, 0.5, 0], drag: 1.5, rise: 0.7 };
  }, { colA: 0x4a4643, colB: 0x8a8580, dust: true, aspect: [0.8, 1.2], opacity: 0.4, lump: 0.25, turb: 0.12, wind: [0.3, 0, 0.1], seed: 72, low: true });
  W.add(c2wisp.mesh);

  film.shot('c2_card', 2.6, (t) => {
    dayYard(W, { size: 16, center: [0, 0, -8] });
    W.yard.scorchU.value = 1;
    W.yard.board.visible = false;
    const cp = [0.3, 1.35, -0.6];
    place4(W, WATCH, [cp[0], cp[2]]);
    const blinkAll = (t > 0.85 && t < 0.97) || (t > 1.25 && t < 1.37);
    for (const a of W.actors) a.soot(1);
    W.claude.eyes(blinkAll ? 'closed' : 'wide'); W.claude.autoBlink = false;
    W.gpt.face(blinkAll ? 'flat' : 'wide');
    W.gemini.eyes(blinkAll ? 'closed' : 'wide'); W.gemini.autoBlink = false;
    W.grok.eyes('happy').look(0, 0.15); hops(W.grok, t, 1.6, 2, 0.4, 0.3);
    c2rain.show(t); c2wisp.show(t); c2boom.show(4.6 + t - BOOM); c2after(4.6 + t);
    camK(W, ease.io(seg(t, 0, 2.6)), { p: cp, t: [0, 0.75, -8], f: 38 }, { p: [0.3, 1.3, -1.2], t: [0, 0.75, -8], f: 38 });
    cardLine(t, { t0: 0.15, cmd: 'launch --attempt 02 --by grok', status: 'FAILED', detail: 'RAPID UNSCHEDULED DISASSEMBLY' }, '試行 02：エンジン 27 基。多ければいい、というものではなかった。');
  }, [[0.45, 'type', { dur: 0.6 }], [0.85, 'blink'], [1.25, 'blink'], [1.15, 'fail'], [1.15, 'stamp']]);

  // =====================================================================
  // C3：Gemini「とても美しいロケット」
  // =====================================================================
  const PIC = W.picture;
  const GEM = [1.7, 0, -9.9];
  const c3swirl = new Sparkles(150, (i, rnd) => {
    const u = i / 150, a = u * 26, r = 2.4 - u * 1.6;
    return { t: 0.2 + u * 1.3, life: 0.6 + rnd() * 0.4, size: 0.35 + rnd() * 0.5, p: [TP[0] + Math.cos(a) * r, PADY + 0.3 + u * 6.2, TP[2] + Math.sin(a) * r], v: [0, 0.8, 0], drag: 1 };
  }, { rainbow: true, seed: 81, gain: 2.4 });
  const c3burst = new Sparkles(130, (i, rnd) => {
    const th = rnd() * 6.283, ph = (rnd() - 0.5) * 3.0, sp = 3 + rnd() * 8;
    return { t: 1.55 + rnd() * 0.1, life: 0.7 + rnd() * 0.8, size: 0.4 + rnd() * 0.7, p: [TP[0], PADY + 3.4, TP[2]], v: [Math.cos(th) * Math.cos(ph) * sp, Math.sin(ph) * sp, Math.sin(th) * Math.cos(ph) * sp], drag: 2.4 };
  }, { rainbow: true, seed: 82, gain: 2.6 });
  W.add(c3swirl.mesh); W.add(c3burst.mesh);
  const picIdle = () => { PIC.root.visible = true; PIC.root.position.set(TP[0], PADY, TP[2]); };

  film.shot('c3_magic', 3.5, (t) => {
    dayYard(W, { size: 20, center: [0, 0, -11] });
    W.yard.scorchU.value = 1;
    place4(W, { ...WATCH, gemini: GEM }, [0, -15]);
    const cast = t < 1.6;
    W.gemini.eyes(cast ? 'closed' : 'happy').hands(cast ? [-0.45 + Math.cos(t * 8) * 0.16, 0.74 + Math.sin(t * 8) * 0.16, 0.3] : [-0.62, 0.95, 0.15], cast ? [0.45 - Math.cos(t * 8) * 0.16, 0.74 + Math.sin(t * 8) * 0.16, 0.3] : [0.62, 0.95, 0.15]).tilt(0, cast ? 0 : 0, 0);
    c3swirl.show(t); c3burst.show(t);
    const k = pop(t, 1.55, 0.45);
    if (k > 0.001) { picIdle(); PIC.root.scale.set(k, k, k); }
    if (t > 1.55) W.post.flash.value = 0.5 * Math.exp(-(t - 1.55) * 16);
    const wow = t > 1.9;
    W.claude.eyes(wow ? 'wide' : 'open'); W.gpt.face(wow ? 'heart' : 'eyes'); W.grok.eyes(wow ? 'wide' : 'straight').look(0, 0.4);
    W.say('heart', W.gpt, popInOut(t, 2.0, 3.5), { size: 0.7 }); W.say('star', W.claude, popInOut(t, 2.2, 3.5), { size: 0.7 }); W.say('bang', W.grok, popInOut(t, 2.4, 3.5), { size: 0.7 });
    camK(W, ease.io(seg(t, 0, 3.5)), { p: [-1.6, 1.5, -3.8], t: [0, 2.9, -15], f: 36 }, { p: [-1.2, 1.5, -4.6], t: [0, 3.3, -15], f: 36 });
  }, [[0.2, 'sparkle', { dur: 1.3 }], [1.55, 'magic'], [2.0, 'pop'], [2.2, 'pop'], [2.4, 'pop']]);

  const cardPose = (t) => {
    // t：つつかれてからの秒
    const c = PIC.card;
    if (t <= 0) { c.rotation.set(0, 0, 0); return 0; }
    const yaw = t < 0.35 ? 1.25 * ease.out(t / 0.35) : t < 0.6 ? lerp(1.25, 0.45, ease.io((t - 0.35) / 0.25)) : 0.45;
    const fall = ease.in(seg(t, 0.55, 1.05));
    c.rotation.set(fall * (Math.PI / 2 - 0.02), yaw, 0);
    PIC.stand.visible = fall < 0.15;
    return fall;
  };
  const c3dust = poofs(W, [{ t: 2.7 + 1.05, p: [TP[0] + 1.2, PADY, TP[2] + 3.0], n: 64, size: 0.7, speed: 6.5, life: 1.3, r: 2.6 }], { seed: 83 });   // 大きな板が倒れて、下の空気が粉を押し出す

  film.shot('c3_flat', 4.2, (t) => {
    dayYard(W, { size: 20, center: [0, 0, -11] });
    W.yard.scorchU.value = 1;
    picIdle();
    place4(W, { ...WATCH, gemini: GEM }, [0, -15]);
    W.gemini.eyes(t < 1.9 ? 'happy' : t < 2.9 ? 'open' : 'wide').hands([-0.62, 0.95, 0.15], [0.62, 0.95, 0.15]);
    W.gpt.face(t < 1.7 ? 'happy' : 'eyes'); W.claude.eyes('open');
    for (let i = 0; i < 3; i++) { const t0 = 0.15 + i * 0.5; if (t > t0 && t < t0 + 0.5) OV.bigNumber(E, String(3 - i), 0.55 + 0.45 * pop(t, t0, 0.2), 1 - seg(t, t0 + 0.38, t0 + 0.5), '#ffffff', 300); }
    if (t > 1.65 && t < 2.35) OV.bigNumber(E, 'GO!', 0.5 + 0.2 * pop(t, 1.65, 0.2), 1 - seg(t, 2.15, 2.35), '#ffd95a', 300);
    W.say('dots', W.claude, popInOut(t, 2.0, 2.8)); W.say('q', W.gpt, popInOut(t, 2.2, 2.9));
    // Grok が転がってきて、つつく
    const HIT = 2.7;
    const gp = t < 2.25 ? WATCH.grok : mv(WATCH.grok, [1.75, PADY, -14.2], ease.in(seg(t, 2.25, HIT)));
    const back = t > HIT ? ease.out(seg(t, HIT, HIT + 0.3)) * 0.9 : 0;
    W.grok.at(gp[0] + back, gp[1] + (t > 2.25 && t < HIT ? PADY * 0 : 0), gp[2] + back).faceTo(0, -15).eyes(t > HIT ? 'wide' : 'straight').look(0, 0.3);
    const fall = cardPose(t - HIT);
    c3dust.show(t);
    W.shake(0.1 * bump(t, HIT + 1.05, 0.3));
    if (fall >= 1) W.gemini.eyes('sad');
    camK(W, ease.io(seg(t, 0, 4.2)), { p: [3.6, 1.7, -7.2], t: [0.2, 3.0, -14.6], f: 38 }, { p: [4.4, 1.9, -7.8], t: [0.4, 2.2, -14.2], f: 38 });
  }, [[0.15, 'beep'], [0.65, 'beep'], [1.15, 'beep'], [1.65, 'beepHi'], [1.9, 'cricket', { dur: 0.9 }], [2.3, 'roll'], [2.7, 'bonk'], [3.0, 'wobble'], [3.75, 'thud']]);

  film.shot('c3_card', 2.4, (t) => {
    dayYard(W, { size: 20, center: [0, 0, -11] });
    W.yard.scorchU.value = 1;
    picIdle(); cardPose(5);
    c3dust.show(4.2 + t);
    place4(W, { claude: [-2.6, 0, -9.6], gpt: [-1.0, 0, -8.9], gemini: [1.6, 0, -9.3], grok: [3.0, 0, -10.2] }, [1.0, -12]);
    W.gemini.eyes('sad').float(0.02, false).tilt(0.25, 0, 0.2).hands([-0.3, 0.3, 0.2], [0.3, 0.3, 0.2]);
    W.gpt.face('flat'); W.claude.eyes('closed'); W.grok.eyes('flat').look(0, -0.1);
    W.say('dots', W.grok, popInOut(t, 0.6, 2.3));
    camK(W, ease.io(seg(t, 0, 2.4)), { p: [0.6, 4.6, -5.2], t: [0.6, 0.3, -11.4], f: 36 }, { p: [0.6, 4.2, -5.6], t: [0.6, 0.3, -11.4], f: 36 });
    cardLine(t, { t0: 0.1, cmd: 'launch --attempt 03 --by gemini', status: 'FAILED', detail: 'IT WAS A PICTURE' }, '試行 03：とても美しい。ただし、絵だった。');
  }, [[0.4, 'type', { dur: 0.6 }], [1.1, 'fail'], [1.1, 'stamp']]);

  // =====================================================================
  // C4：Claude「安全第一」
  // =====================================================================
  const S = W.safe, SC = W.scroll;
  const CL = [2.4, 0, -11.2];
  const conePos = [[-2.6, -11.6], [-1.2, -10.8], [3.9, -12.2], [4.4, -14.0]];
  const safeBase = () => {
    S.root.visible = true; S.root.position.set(...TP);
    W.yard.cones.forEach((c, i) => { c.visible = true; c.position.set(conePos[i][0], 0, conePos[i][1]); });
    W.yard.scorchU.value = 1;
  };
  film.shot('c4_scroll', 3.6, (t) => {
    dayYard(W, { size: 20, center: [1, 0, -9] });
    safeBase();
    W.claude.at(CL[0], 0, CL[2], 0.15).eyes('keen').arms(0.1, 1.0);
    W.clipboard.visible = true; W.clipboard.position.set(CL[0] + 0.86, 0.95, CL[2] + 0.2); W.clipboard.rotation.set(-0.2, 0.15, 0.1);
    const len = 13 * ease.io(seg(t, 0.9, 3.3));
    SC.root.visible = len > 0.01; SC.root.position.set(CL[0], 0.012, CL[2] + 0.6); SC.root.rotation.y = Math.PI; SC.set(Math.max(0.05, len), 0);
    place4(W, { claude: CL, gpt: [-3.6, 0, -8.6], gemini: [-2.0, 0, -7.8], grok: [-0.4, 0, -8.2] }, [CL[0], CL[2]]);
    W.claude.yaw(0.15);
    W.gpt.face('eyes'); W.grok.eyes('straight').look(0.3, 0.2);
    W.say('list', W.claude, popInOut(t, 0.2, 1.2)); W.say('dots', W.gemini, popInOut(t, 2.2, 3.5)); W.say('q', W.grok, popInOut(t, 2.5, 3.5));
    camK(W, ease.io(seg(t, 0, 3.6)), { p: [3.9, 0.55, -3.4], t: [1.6, 1.7, -12], f: 40 }, { p: [3.6, 0.5, -2.6], t: [1.6, 1.5, -12], f: 40 });
  }, [[0.2, 'pop'], [0.9, 'unroll', { dur: 2.4 }], [2.2, 'pop'], [2.5, 'pop']]);

  const lantern = W.add(glowSprite(0xffd28a, 2.2, { gain: 0.9, pow: 2.4 }));
  const lapse = (t, k) => {
    // k：0 昼 → 0.5 夕方 → 1 夜
    W.yard.root.visible = true; W.clouds.root.visible = true; W.yard.launch.visible = false;
    const day = [-0.7, 0.36, 0.52], eve = [-0.85, 0.16, 0.3], moon = [-0.092, 0.309, -0.947];   // 始まりは c4 の午後の太陽（lib.js の TOD）と同じ
    const dir = k < 0.5 ? mv(day, eve, k * 2) : k < 0.62 ? eve : moon;
    const o = { sunDir: dir, size: 24, center: [2, 0, -10], fillDir: [0.25, 0.5, 1], fillColor: 0x7f9be0, fillI: 0.45 * seg(k, 0.6, 0.9) };
    if (k < 0.5) W.env('day', 'sunset', 0.4 + 1.2 * k, o); else W.env('sunset', 'night', (k - 0.5) * 2, o);
    W.yard.setNight(seg(k, 0.6, 0.85));
    if (k > 0.6) { W.skyMoon.visible = true; W.skyMoon.position.set(...L.NIGHT_MOON); W.skyMoon.scale.setScalar(52 * ease.out(seg(k, 0.6, 0.8))); W.uSun2.value.set(0.42, -0.08, 0.9).normalize(); }
    W.cloudSpin = t * 0.22; W.sky.U.spin.value = t * 0.12;
  };
  const sleepers = (t, z) => {
    // 飽きて → うとうと → 眠る（z：眠りの深さ 0..1）
    W.yard.board.visible = false;
    place4(W, { claude: [0, -50, 0], gpt: [-3.6, 0, -8.6], gemini: [-2.0, 0, -7.8], grok: [-0.4, 0, -8.2] }, [6, -11]);
    W.gpt.face(z < 0.3 ? 'eyes' : 'flat', { dim: z > 0.7 }).nod(0.3 * z, 0.2 * z).lean(0, -0.25 * z);
    W.gemini.eyes(z < 0.3 ? 'open' : 'closed').float(0.2 * (1 - z) + 0.02, z < 0.6).tilt(0.5 * z, 0, 0.3 * z).hands([-0.42, 0.42 - 0.2 * z, 0.12], [0.42, 0.42 - 0.2 * z, 0.12]);
    W.grok.eyes(z < 0.3 ? 'straight' : 'flat').look(0.2, 0.2 - 0.3 * z).squash(1 - 0.08 * z);
    if (z > 0.8) { W.say('zzz', W.gpt, 0.8 + 0.1 * Math.sin(t * 2), { size: 0.9 }); W.say('zzz', W.gemini, 0.8 + 0.1 * Math.sin(t * 2 + 1), { size: 0.9, dy: -0.25 }); W.say('zzz', W.grok, 0.8 + 0.1 * Math.sin(t * 2 + 2), { size: 0.9 }); }
  };
  film.shot('c4_lapse', 4.6, (t) => {
    const k = seg(t, 0.4, 4.0);
    lapse(t, k);
    safeBase();
    const n = Math.floor(3 + t * 30);
    SC.root.visible = true; SC.root.position.set(CL[0] + 0.5, 0.012, CL[2] + 0.4); SC.root.rotation.y = -Math.PI / 2; SC.set(70, n);
    sleepers(t, seg(t, 1.2, 3.0));
    const cx = CL[0] + 1.0 + n * 0.24;
    W.claude.at(cx, 0, CL[2] + 0.95, Math.PI).eyes('keen').arms(0.1, 0.6);
    hop(W.claude, (t * 30) % 1, 0.1, 0.7, 0.16);
    if (k > 0.7) { lantern.visible = true; lantern.position.set(cx, 1.3, CL[2] + 0.95); }
    OV.line(E, 'CHECKED  ' + String(n).padStart(4, '0') + ' / 9999', { y: 104, s: 8 });
    camK(W, ease.io(seg(t, 0, 4.6)), { p: [-8.2, 3.0, -3.2], t: [3.5, 1.6, -12], f: 44 }, { p: [-7.4, 2.8, -3.6], t: [5.0, 1.5, -12], f: 44 });
  }, [[0, 'lapse', { dur: 4.6 }], [0.05, 'ticks', { dur: 4.5 }], [3.2, 'snore']]);

  film.shot('c4_card', 2.6, (t) => {
    lapse(4.6 + t, 1);
    safeBase();
    const n = Math.floor(3 + (4.6 + t) * 30);
    SC.root.visible = true; SC.root.position.set(CL[0] + 0.5, 0.012, CL[2] + 0.4); SC.root.rotation.y = -Math.PI / 2; SC.set(70, n);
    sleepers(t, 1);
    const cx = CL[0] + 1.0 + n * 0.24;
    W.claude.at(cx, 0, CL[2] + 0.95, Math.PI).eyes('keen');
    hop(W.claude, (t * 30) % 1, 0.1, 0.7, 0.16);
    lantern.visible = true; lantern.position.set(cx, 1.3, CL[2] + 0.95);
    camK(W, ease.io(seg(t, 0, 2.6)), { p: [-6.4, 1.3, -5.4], t: [0, 1.0, -9.5], f: 36 }, { p: [-6.0, 1.3, -5.8], t: [0, 1.0, -9.5], f: 36 });
    cardLine(t, { t0: 0.1, cmd: 'launch --attempt 04 --by claude', status: 'TIMEOUT', statusColor: '#ffd04a', mark: '!', detail: 'STILL CHECKING...' }, '試行 04：安全確認が、いつまでも終わらない。');
  }, [[0.05, 'ticks', { dur: 2.5 }], [0.4, 'type', { dur: 0.6 }], [1.1, 'fail'], [1.1, 'stamp'], [0.3, 'snore'], [1.9, 'snore']]);
}
