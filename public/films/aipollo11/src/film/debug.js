// 部品の見た目を確かめるための試し撮り
import { subtitle, card, title, promptBox, quote, tvChyron, credits, bigNumber } from '../core/overlay.js';
import { PAD, DECK, TESTPAD } from '../sets/yard.js';
import { MOUND } from '../sets/moon.js';
import { Fluid } from '../fx/fluid.js';
import * as THREE from 'three/webgpu';

export function debugShots(film, W, which) {
  const E = W.engine;
  if (which === 'fire') {
    // 焚火の確認用：0〜4 秒は斜め前、4〜8 秒は寄り、8〜12 秒は真上寄り
    film.shot('fire', 12, (t) => {
      W.yard.root.visible = true; W.clouds.root.visible = true; W.yard.launch.visible = false; W.yard.setNight(1);
      W.env('night', 'night', 0, { sunDir: [-0.092, 0.309, -0.947], size: 14, center: [0, 0, 4], fillDir: [0.25, 0.5, 1], fillColor: 0x7f9be0, fillI: 0.3 });
      W.campfire.root.position.set(0, 0, 4.4); W.campfire.burn(100 + t, 1, W);
      W.claude.at(-2.0, 0, 3.1).faceTo(0, 4.8); W.gpt.at(-0.75, 0, 2.6).faceTo(0, 4.8); W.gemini.at(0.8, 0, 2.6).faceTo(0, 4.8); W.grok.at(2.0, 0, 3.2).faceTo(0, 4.8);
      const i = Math.floor(t / 4);
      if (i === 0) W.cam([1.9, 1.0, 8.3], [0, 0.62, 4.4], 30);
      else if (i === 1) W.cam([0.9, 0.55, 6.3], [0, 0.42, 4.4], 34);
      else W.cam([0.4, 4.6, 7.6], [0, 0.2, 4.4], 30);
    });
  }
  if (which === 'chars') {
    film.shot('chars', 16, (t) => {
      W.test.visible = true;
      W.light({ sunDir: [0.4, 0.9, 0.7], sunI: 3.0, hemiI: 0.9, size: 8, sky: 0xcfe0ff, ground: 0x8a8f96 });
      W.scene.background.setRGB(0.62, 0.72, 0.86);
      const mode = Math.floor(t / 4);
      const a = mode === 1 ? 0.65 : mode === 2 ? -0.5 : 0;
      const d = mode === 3 ? 5.2 : 7.2;
      W.cam([Math.sin(a) * d, mode === 1 ? 2.2 : 1.1, Math.cos(a) * d], [0, 0.62, 0], 30);
      const ex = mode >= 2;
      W.claude.at(-2.4, 0, 0).eyes(ex ? ['happy', 'sad', 'dizzy', 'keen'][Math.floor(t) % 4] : 'open');
      if (ex) W.claude.arms(0.9, 0.2);
      W.gpt.at(-0.75, 0, 0).face(ex ? ['happy', 'heart', 'code', 'eyes', 'wide', 'dead', 'strain', 'check'][Math.floor(t * 2) % 8] : 'prompt', { scroll: t * 3 });
      W.gemini.at(0.85, 0, 0).eyes(ex ? ['happy', 'closed', 'sad', 'wide'][Math.floor(t) % 4] : 'open');
      W.grok.at(2.4, 0, 0).eyes(ex ? ['angry', 'sad', 'happy', 'wide'][Math.floor(t) % 4] : 'logo');
      if (mode === 3) { for (const c of W.actors) c.helm(true); W.grok.soot(1); W.claude.soot(1); W.gpt.soot(1); W.gemini.soot(1); }
    });
  }
  if (which === 'yard') {
    film.shot('yard', 20, (t) => {
      const i = Math.floor(t);
      W.yard.root.visible = true; W.clouds.root.visible = true;
      const envs = ['day', 'day', 'sunset', 'night', 'dawn', 'day', 'day', 'night'];
      const e = envs[i % 8];
      const sd = e === 'night' ? [-0.3, 0.5, 0.8] : e === 'sunset' ? [-0.8, 0.16, 0.3] : e === 'dawn' ? [0.8, 0.2, 0.5] : [0.45, 0.8, 0.5];
      const four = () => { W.claude.at(-2.2, 0, 1); W.gpt.at(-0.7, 0, 1.2); W.gemini.at(0.8, 0, 1.2); W.grok.at(2.2, 0, 1); };
      if (i === 0) { W.env(e, e, 0, { sunDir: sd, size: 16 }); W.cam([0, 2.2, 10], [0, 1.4, 0], 35); W.yard.blueprint('goal'); four(); }
      else if (i === 1) { W.env(e, e, 0, { sunDir: sd, size: 30, center: [0, 0, -8] }); W.cam([9, 5, 14], [0, 2, -10], 35); W.yard.blueprint('final'); W.safe.root.visible = true; W.safe.root.position.set(...TESTPAD); }
      else if (i === 2 || i === 3 || i === 4) {
        W.env(e, e, 0, { sunDir: sd, size: 16 }); W.cam([4, 1.6, 9], [0, 1.5, 0], 38); W.yard.blueprint('grok'); four();
        if (e === 'night') { W.yard.setNight(1); W.skyMoon.visible = true; W.skyMoon.position.set(-240, 300, -700); W.skyMoon.scale.setScalar(60); W.campfire.burn(t); W.campfire.root.position.set(0, 0, 3); }
      } else if (i === 5) { W.env(e, e, 0, { sunDir: sd, size: 44, center: [PAD[0], 16, PAD[2]] }); W.cam([PAD[0] + 30, 6, PAD[2] + 52], [PAD[0] - 2, 17, PAD[2]], 35); W.saturn.root.visible = true; W.saturn.root.position.set(PAD[0], DECK, PAD[2]); }
      else if (i === 6) { W.env(e, e, 0, { sunDir: sd, size: 44, center: [PAD[0], 16, PAD[2]] }); W.cam([PAD[0] + 9, DECK + 1.2, PAD[2] + 14], [PAD[0], DECK + 12.8, PAD[2]], 50); W.saturn.root.visible = true; W.saturn.root.position.set(PAD[0], DECK, PAD[2]); W.saturn.fire1(t, 1); W.yard.swing(1); }
      else { W.env(e, e, 0, { sunDir: sd, size: 44, center: [PAD[0], 16, PAD[2]] }); W.yard.setNight(1); W.cam([PAD[0] - 26, 2, PAD[2] + 40], [PAD[0], 16, PAD[2]], 40); W.saturn.root.visible = true; W.saturn.root.position.set(PAD[0], DECK, PAD[2]); }
    });
  }
  if (which === 'fail') {
    film.shot('fail', 8, (t) => {
      const i = Math.floor(t);
      W.yard.root.visible = true; W.clouds.root.visible = true;
      W.env('day', 'day', 0, { sunDir: [0.45, 0.8, 0.5], size: 16, center: [0, 2, -15] });
      W.cam([4, 2.6, -3], [0, 3, -15], 40);
      const r = [W.junk, W.booster, W.picture, W.safe][i % 4];
      r.root.visible = true; r.root.position.set(...TESTPAD); r.root.position.y = 0.3;
      if (i >= 4) {
        W.cam([8, 3, -9], [0, 3, -15], 40);
        if (i % 4 === 1) W.booster.fire(t, 1);
        if (i % 4 === 0) W.junk.flame.set(t, 1);
        if (i % 4 === 3) { W.scroll.root.visible = true; W.scroll.root.position.set(2, 0.31, -12); W.scroll.set(8, 12); }
      }
    });
  }
  if (which === 'moon') {
    film.shot('moon', 8, (t) => {
      const i = Math.floor(t);
      W.moon.root.visible = true;
      const sd = [0.6, 0.45, 0.65];
      W.env('space', 'space', 0, { sunDir: sd, size: 26, center: [0, 0, 2], hemiMul: 1 });
      W.lander.root.visible = true; W.lander.root.position.set(0, W.moon.h(0, 0), 0);
      W.earth.visible = true;
      const ed = [-0.65, 0.3, -0.7];
      if (i === 0) { W.cam([7, 1.6, 13], [0, 2.4, 0], 35); W.claude.at(1.5, W.moon.h(1.5, 5), 5).helm(); W.moon.step4(1.5, 5); }
      else if (i === 1) { W.cam([2.4, 0.5, 6.4], [0, 1.5, 2.6], 35); W.lander.open(1); W.claude.at(0, 2.74, 2.0, Math.PI).helm(); }
      else if (i === 2) { W.cam([-22, 9, 30], [0, 2, 0], 35); for (let k = 0; k < 5; k++) W.moon.step4(0, 4 + k * 0.6); W.moon.flag.visible = true; W.moon.flag.position.set(3, W.moon.h(3, 6), 6); }
      else if (i === 3) {
        const top = [MOUND.x, W.moon.h(MOUND.x, MOUND.z), MOUND.z];
        const v = [-0.68, 0, -0.73];
        W.cam([top[0] - v[0] * 62, top[1] - 2.2, top[2] - v[2] * 62], [top[0], top[1] + 3.6, top[2]], 11);
        W.light({ sunDir: sd, sunI: 3.4, hemiI: 0.22, sky: 0x20304f, ground: 0x101018, size: 20, center: top });
        const yaw = Math.atan2(v[0], v[2]);
        W.claude.at(top[0], top[1], top[2], yaw).helm(); W.gpt.at(top[0] + 1.3, W.moon.h(top[0] + 1.3, top[2] - 1.2), top[2] - 1.2, yaw).helm();
        W.gemini.at(top[0] - 1.4, W.moon.h(top[0] - 1.4, top[2] + 1.3), top[2] + 1.3, yaw).helm(); W.grok.at(top[0] - 2.6, W.moon.h(top[0] - 2.6, top[2] + 2.4), top[2] + 2.4, yaw).helm();
        quote(E, { l1: "THAT'S ONE SMALL STEP FOR AN AI,", l2: 'ONE GIANT LEAP FOR MANKIND.', t1: 1, t2: 1 });
        subtitle(E, 'これは一つのAIにとっては小さな一歩だが、\n人類にとっては偉大な飛躍である。');
      } else { W.cam([3, 0.35, 5.5], [0.5, 0.3, 3.4], 30); W.claude.at(0.5, W.moon.h(0.5, 3.6), 3.6, 0.3).helm(); W.moon.step4(0.5, 4.3, 0.3); }
      const c = W.camera.position;
      const es = i === 3 ? 330 : 120;
      W.earth.position.set(c.x + ed[0] * 3000, c.y + ed[1] * 3000 + (i === 3 ? 60 : 0), c.z + ed[2] * 3000); W.earth.scale.setScalar(es);
      W.earth.rotation.set(0.3, 2.2, 0.2);
    });
  }
  if (which === 'space') {
    film.shot('space', 6, (t) => {
      const i = Math.floor(t);
      W.env('space', 'space', 0, { sunDir: [0.7, 0.25, 0.6], size: 12, hemiMul: 0.6 });
      W.clip(0.5, 20000);
      W.earth.visible = true; W.earth.scale.setScalar(100); W.earth.position.set(0, 0, 0); W.earth.rotation.y = 1.9 + i * 1.3; W.earth.userData.U.cloud.value = t * 0.01;
      if (i < 3) W.cam([120 * Math.sin(i * 0.6), 40, 320 * Math.cos(i * 0.6)], [0, 0, 0], 35);
      else if (i === 3) { W.earth.visible = false; W.moonGlobe.visible = true; W.moonGlobe.scale.setScalar(100); W.cam([60, 20, 330], [0, 0, 0], 35); }
      else if (i === 4) {
        W.earth.position.set(-400, -100, -900); W.csm.visible = true; W.csm.position.set(0, 0, 0); W.csm.rotation.set(0.3, 0.4, -1.2); W.cam([3, 1.5, 6.5], [0, 1.2, 0], 35);
        W.light({ sunDir: [0.7, 0.25, 0.6], sunI: 3.4, hemiI: 0.25, sky: 0x20304f, ground: 0x101018, size: 8 });
        W.sunFlare.visible = true; W.sunFlare.position.set(2100, 750, 1800); W.sunFlare.scale.setScalar(900);
      } else {
        W.cabin.root.visible = true; W.sky.mesh.visible = false; W.earth.visible = false;
        W.light({ sunDir: [0.2, 0.8, 0.9], sunI: 2.0, sunColor: 0xfff0dd, hemiI: 0.9, sky: 0x8fa0c0, ground: 0x30333c, size: 8, center: [0, 1, 0] });
        W.cam([0, 1.7, 4.6], [0, 1.35, 0], 44);
        [W.claude, W.gpt, W.gemini, W.grok].forEach((a, k) => a.at([-2.25, -0.75, 0.75, 2.25][k], 0.5, 0.15).helm());
        W.cabin.uT.value = t;
      }
    });
  }
  if (which === 'pad') {
    // 発射施設の作り込みを確かめる（1 秒ごとに別の見方）
    film.shot('pad', 18, (t) => {
      const i = Math.floor(t + 1e-6);
      const P0 = [PAD[0], DECK, PAD[2]], X = P0[0], Z = P0[2];
      const set = (e, sd, o = {}) => {
        W.yard.root.visible = true; W.clouds.root.visible = true; W.yard.launch.visible = true;
        W.env(e, e, 0, { sunDir: sd, size: o.size ?? 48, center: o.center ?? [X, 18, Z], dist: 180, ...(o.light || {}) });
        W.saturn.root.visible = o.rocket !== false; W.saturn.root.position.set(...P0);
        W.yard.setNight(o.night ?? 0);
        W.yard.swing(o.swing ?? 0);
      };
      const DAY = [0.55, 0.62, 0.56], DAWN = [-0.82, 0.17, -0.55];
      if (i === 0) { set('day', DAY); W.cam([X + 36, 8, Z + 60], [X - 1.5, 21, Z], 36); }                                                       // 全景
      else if (i === 1) { set('day', DAY, { size: 20, center: [X, DECK, Z] }); W.cam([X + 3.5, DECK + 1.5, Z + 21], [X, DECK + 2.6, Z], 38); }   // 点火のカットの位置
      else if (i === 2) { set('day', DAY); W.cam([X + 2.8, 0.85, Z + 58], [X - 1.2, 15, Z], 43); }                                               // 道から見上げる
      else if (i === 3) { set('day', DAY, { size: 60 }); W.cam([X + 64, 4, Z + 108], [X - 1.5, DECK + 13, Z], 27); }                             // 遠景
      else if (i === 4) { set('day', DAY, { size: 34, center: [X, 6, Z] }); W.cam([X + 24, 34, Z + 34], [X - 1, 5, Z], 42); }                    // 上から
      else if (i === 5) { set('day', DAY, { size: 24, center: [X, 24, Z] }); W.cam([X + 9, DECK + 19, Z + 13], [X - 3, DECK + 17, Z], 40); }     // 塔とアーム
      else if (i === 6) { set('night', [-0.092, 0.309, -0.947], { night: 1, light: { fillDir: [0.3, 0.5, 1], fillColor: 0x8fa6e6, fillI: 0.5 } }); W.cam([X + 36, 8, Z + 60], [X - 1.5, 21, Z], 36); }
      else if (i === 7) { set('day', DAY, { size: 24, center: [X + 10, 3, Z] }); W.cam([X + 40, 2.2, Z + 0.5], [X, 3.2, Z], 40); }               // 溝を +X から
      else if (i === 8) { set('day', DAY); W.cam([X - 40, 9, Z - 48], [X, 16, Z], 38); }                                                         // 裏側
      else if (i === 9) { set('dawn', DAWN, { night: 0.3 }); W.cam([X + 21, 9.5, Z + 31], [X - 2, DECK + 9, Z], 38); }                           // 秒読みのカットの位置
      else if (i === 10) { set('day', DAY, { size: 16, center: [X, DECK, Z], swing: 1 }); W.cam([X + 9, DECK + 4.5, Z + 8], [X - 1, DECK + 0.8, Z], 42); }   // 床を近くから
      else if (i === 11) { set('day', DAY, { size: 20, center: [X, 4, Z + 6] }); W.cam([X + 14, 2.4, Z + 24], [X, 5.2, Z], 40); }                // 支柱と発射台の下
      else if (i === 12) { set('day', DAY, { size: 20, center: [X, 40, Z] }); W.cam([X + 12, DECK + 34, Z + 16], [X - 4, DECK + 37, Z], 40); }   // クレーン
      else if (i === 13) { set('sunset', [-0.8, 0.16, 0.3]); W.cam([X - 30, 3, Z + 52], [X, 18, Z], 38); }
      else if (i === 14) { set('day', DAY, { size: 60, center: [X + 30, 4, Z] }); W.cam([X + 86, 13, Z + 40], [X + 26, 3, Z - 2], 40); }           // クローラーウェイ
      else if (i === 15) { set('day', DAY, { size: 30, center: [X - 28, 4, Z - 30] }); W.cam([X - 8, 7, Z - 20], [X - 30, 4, Z - 38], 40); }        // タンクと配管
      else if (i === 16) { set('day', DAY, { size: 14, center: [X, DECK + 27, Z] }); W.cam([X + 7, DECK + 29.6, Z + 9], [X - 1.6, DECK + 28.2, Z], 40); }   // 乗員用のアームとホワイトルーム
      else { set('day', DAY, { size: 14, center: [X, DECK + 18, Z], swing: 1 }); W.cam([X + 8, DECK + 20, Z + 12], [X - 2.5, DECK + 17, Z + 1], 40); }   // 振り出したアーム
    });
  }
  if (which === 'ws') {
    // 作業場の作り込みを確かめる（1 秒ごとに別の見方）
    film.shot('ws', 15, (t) => {
      const i = Math.floor(t + 1e-6);
      const hW = (x, y, z) => [-36 + x * Math.cos(0.5) + z * Math.sin(0.5), y, -34 - x * Math.sin(0.5) + z * Math.cos(0.5)];     // 格納庫の座標 → 世界
      const set = (e, sd, o = {}) => {
        W.yard.root.visible = true; W.clouds.root.visible = true; W.yard.launch.visible = false;
        W.env(e, e, 0, { sunDir: sd, size: o.size ?? 18, center: o.center ?? [0, 0, 0], ...(o.light || {}) });
        W.yard.setNight(o.night ?? 0);
        if (o.bp) W.yard.blueprint(o.bp);
      };
      const LOW = [0.72, 0.42, 0.48], NIGHT = [-0.092, 0.309, -0.947], NL = { fillDir: [0.25, 0.5, 1], fillColor: 0x7f9be0, fillI: 0.45 };
      if (i === 0) { set('day', LOW, { size: 30, center: hW(0, 4, 4) }); W.cam(hW(13, 4.5, 34), hW(0, 5.5, 8), 38); }                      // 格納庫（正面ななめ）
      else if (i === 1) { set('day', LOW, { size: 16, center: hW(2, 3, 10) }); W.cam(hW(-5, 2.2, 21), hW(2.5, 3.6, 8), 40); }               // 引き戸と外まわり
      else if (i === 2) { set('night', NIGHT, { size: 30, center: hW(0, 4, 4), night: 1, light: NL }); W.cam(hW(13, 4.5, 34), hW(0, 5.5, 8), 38); }   // 夜の格納庫
      else if (i === 3) { set('day', LOW, { size: 10, bp: 'goal' }); W.cam([0.6, 1.9, 4.6], [0, 2.0, -2.7], 36); }                         // 掲示板
      else if (i === 4) { set('day', LOW, { size: 8, bp: 'final' }); W.cam([2.9, 1.25, 0.3], [0.9, 1.7, -2.7], 34); }                      // 紙の反りと画びょう
      else if (i === 5) { set('day', LOW, { size: 8, center: [-4.6, 0, -1] }); W.cam([-2.5, 1.9, 2.3], [-4.6, 1.0, -1.0], 36); }           // 作業台
      else if (i === 6) { set('day', LOW, { size: 8, center: [5.2, 0, -1.6] }); W.cam([2.9, 1.7, 2.3], [5.3, 0.8, -1.5], 36); }            // 木箱・段ボール・ドラム缶
      else if (i === 7) {
        set('day', LOW, { size: 16, center: [0, 0, -14] }); W.cam([5.5, 2.8, -7.5], [0, 0.4, -15], 38); W.yard.scorchU.value = 0.7;         // 試験場の台とコーン
        W.yard.cones.forEach((c, k) => { c.visible = true; c.position.set(2.6 + k * 0.5, 0, -10.6 + (k % 2) * 0.5); });
      }
      else if (i === 8) { set('day', LOW, { size: 30, center: [-58, 8, -12] }); W.cam([-36, 5, 6], [-58, 9.5, -12], 40); }                 // 給水塔
      else if (i === 9) { set('day', LOW, { size: 16, center: [-16, 4, -44] }); W.cam([-6, 4.5, -32], [-16, 4.3, -44], 38); }              // アンテナ
      else if (i === 10) { set('dawn', [0.8, 0.34, 0.4], { size: 18, bp: 'goal' }); W.cam([6.5, 2.6, 11], [-2, 1.4, -5], 36); }            // 作業場の全景
      else if (i === 11) { set('night', NIGHT, { size: 30, night: 1, light: NL, bp: 'final' }); W.cam([9, 2.6, 13], [-14, 3, -16], 36); }   // 夜の作業場ごしの格納庫
      else if (i === 12) { set('day', LOW, { size: 24, center: hW(8, 2, 6) }); W.cam(hW(26, 3, 20), hW(8, 3.5, 4), 38); }                   // 格納庫の横と裏
      else if (i === 13) { set('day', LOW, { size: 40, center: [-20, 0, -24] }); W.cam([-4, 30, 2], [-22, 0, -26], 40); }                    // 上から：車のあと・油じみ・雑草
      else { set('day', LOW, { size: 40, center: [-60, 6, -8] }); W.cam([-30, 4, 10], [-70, 7, -4], 40); }                                  // 電柱と給水塔
    });
  }
  if (which === 'fluid') {
    const fl = new Fluid(E.renderer, { n: [64, 96, 64], origin: [-48, 0, -48], size: [96, 144, 96], jacobi: 16 });
    W.add(fl.mesh);
    fl.source = (tau) => ({ pos: [0, 10 + Math.max(0, tau - 2.5) ** 2 * 1.2, 0], vel: [0, -46, 0], r: 2.4, on: 1, dens: 10, heat: 1.6, flameI: 1.2 });
    film.shot('fluid', 12, (t, shot, T) => {
      W.test.visible = true;
      const sd = [0.5, 0.6, 0.6];
      W.env('day', 'day', 0, { sunDir: sd, size: 40 });
      W.cam([70, 14, 95], [0, 22, 0], 40);
      fl.seek(t);
      fl.show({ sunDir: sd, sunCol: new THREE.Color(1.0, 0.96, 0.9).multiplyScalar(1.5), ambCol: new THREE.Color(0.45, 0.55, 0.75).multiplyScalar(0.6) }, Math.round(T * 60));
    });
  }
  if (which === 'rocket') {
    // ロケットの作り込みを近くから確かめる（1 秒ごとに別の見方）
    film.shot('rocket', 19, (t) => {
      const i = Math.floor(t + 1e-6);
      const S = W.saturn;
      const P0 = [PAD[0], DECK, PAD[2]];
      const ground = (e, sd, o = {}) => {
        W.yard.root.visible = true; W.clouds.root.visible = true; W.yard.launch.visible = o.launch ?? true;
        W.env(e, e, 0, { sunDir: sd, size: o.size ?? 44, center: o.center ?? [P0[0], 16, P0[2]], dist: 180, ...(o.light || {}) });
        S.root.visible = true; S.root.position.set(...P0);
        if (S.frost) S.frost(o.frost ?? 0);
      };
      const spaceEnv = (sd = [0.5, 0.42, 0.75], size = 30) => {
        W.env('space', 'space', 0, { sunDir: sd, size, center: [0, 0, 0], dist: 160, hemiMul: 0.7, fillDir: [-0.6, -0.5, 0.3], fillColor: 0x4f7fd8, fillI: 0.5 });
        W.sky.U.twinkle.value = 0; W.clip(0.3, 30000);
      };
      const DAY = [0.55, 0.62, 0.56];
      if (i === 0) { ground('day', DAY); W.cam([P0[0] + 30, 6, P0[2] + 52], [P0[0], 17, P0[2]], 35); }
      else if (i === 1) { ground('day', DAY, { size: 14, center: [P0[0], 4, P0[2]] }); W.cam([P0[0] + 6.5, DECK + 0.9, P0[2] + 9.5], [P0[0], DECK + 2.3, P0[2]], 40); }
      else if (i === 2) { ground('day', DAY, { size: 14, center: [P0[0], 12, P0[2]] }); W.cam([P0[0] + 8, DECK + 9.5, P0[2] + 11], [P0[0], DECK + 10.8, P0[2]], 40); }
      else if (i === 3) { ground('day', DAY, { size: 14, center: [P0[0], 26, P0[2]] }); W.cam([P0[0] + 7, DECK + 24.5, P0[2] + 9.5], [P0[0], DECK + 26.2, P0[2]], 40); }
      else if (i === 4) { ground('night', [-0.3, 0.5, 0.8], { launch: true }); W.yard.setNight(1); W.cam([P0[0] + 26, 5, P0[2] + 44], [P0[0], 16.5, P0[2]], 36); }
      else if (i === 5) { ground('dawn', [-0.82, 0.17, -0.55], { launch: true, frost: 1, light: { fillDir: [0.6, 0.35, 0.75], fillColor: 0xbfd0ff, fillI: 1.1 } }); W.yard.setNight(0.3); W.yard.swing(1); W.cam([P0[0] + 3.5, DECK + 1.5, P0[2] + 21], [P0[0], DECK + 2.6, P0[2]], 38); S.fire1(t, 1, 1.4); }
      else if (i === 6) { ground('day', DAY, { size: 14, center: [P0[0], 16, P0[2]], frost: 1 }); W.cam([P0[0] + 9, DECK + 12.5, P0[2] + 13], [P0[0], DECK + 15.5, P0[2]], 40); }
      else if (i === 7) { ground('day', DAY, { size: 14, center: [P0[0], 22, P0[2]], frost: 1 }); W.cam([P0[0] - 8, DECK + 17, P0[2] + 12], [P0[0], DECK + 21, P0[2]], 40); }
      else if (i === 8) {
        spaceEnv(); S.root.visible = true; S.root.position.set(-4, -2, 0); S.root.rotation.set(0, 0.5, -1.1);
        W.cam([14, 6, 34], [2, 1, 0], 34); S.fire1(t, 1, 2.2);
      } else if (i === 9 || i === 10) {
        spaceEnv(); S.root.visible = true; S.root.position.set(0, -13, 0); S.root.rotation.set(0, 0.9, 0);
        const d = i === 9 ? 3.2 : 6.5;
        S.s1.position.y = S.s1.userData.home - d; S.s1.rotation.set(d * 0.03, 0, d * 0.02);
        if (i === 9) { W.cam([7.5, -3.6, 9.5], [0, -1.6, 0], 36); S.fire2(t, 1, 1.3); } else W.cam([5.5, 5.5, 7.5], [0, -5.2, 0], 40);
      } else if (i === 11 || i === 12) {
        spaceEnv([0.7, 0.25, 0.6], 8);
        W.csm.visible = true; W.csm.position.set(0, 0, 0); W.csm.rotation.set(0.3, i === 11 ? 0.4 : 2.6, i === 11 ? -1.2 : -1.9);
        W.cam(i === 11 ? [2.6, 1.3, 5.6] : [-3.4, -1.2, 4.6], [0, 0.6, 0], 34);
      } else if (i === 13) {
        spaceEnv(); S.root.visible = true; S.root.position.set(0, -27, 0); S.root.rotation.set(0, 2.2, 0);
        W.cam([4.2, 1.6, 6.2], [0, 1.3, 0], 38);
      } else if (i === 14 || i === 15) {
        // エンジンの噴射を近くから（黒い帯と炎）／底を見上げる
        W.yard.root.visible = true; W.clouds.root.visible = true; W.yard.launch.visible = false;
        W.env('day', 'day', 0, { sunDir: i === 14 ? DAY : [0.5, 0.25, 0.8], size: 20, center: [P0[0], 80, P0[2]], dist: 180 });
        S.root.visible = true; S.root.position.set(P0[0], 80, P0[2]);
        if (i === 14) { S.fire1(t, 1, 1.6); W.cam([P0[0] + 9, 77.5, P0[2] + 13], [P0[0], 79.2, P0[2]], 40); }
        else W.cam([P0[0] + 3.4, 77.6, P0[2] + 5.2], [P0[0], 80.6, P0[2]], 50);
      } else if (i === 16) { ground('day', DAY, { size: 10, center: [P0[0], 30, P0[2]] }); W.cam([P0[0] + 3.0, DECK + 28.9, P0[2] + 4.4], [P0[0], DECK + 29.6, P0[2]], 40); }
      else if (i === 17) { ground('day', DAY, { size: 12, center: [P0[0], 23, P0[2]] }); W.cam([P0[0] + 2.2, DECK + 21.4, P0[2] + 6.5], [P0[0], DECK + 22.4, P0[2]], 44); }
      else {
        spaceEnv([0.3, 0.2, 0.9], 8);
        W.csm.visible = true; W.csm.position.set(0, 0, 0); W.csm.rotation.set(-0.9, 0.6, 0.5);
        W.cam([1.2, -1.2, 5.2], [0, 0.1, 0], 36);
      }
    });
  }
  if (which === 'plume') {
    // 噴射炎を近くから確かめる（1 秒ごとに別の見方。小数部は流れの時刻）
    film.shot('plume', 12, (t) => {
      const i = Math.floor(t + 1e-6), S = W.saturn;
      const X = PAD[0], Z = PAD[2];
      const dayEnv = (c, size = 30) => { W.yard.root.visible = true; W.clouds.root.visible = true; W.yard.launch.visible = false; W.env('day', 'day', 0, { sunDir: [0.55, 0.62, 0.56], size, center: c, dist: 180 }); };
      const spaceEnv = () => { W.env('space', 'space', 0, { sunDir: [0.5, 0.42, 0.75], size: 30, center: [0, 0, 0], dist: 160, hemiMul: 0.7, fillDir: [-0.6, -0.5, 0.3], fillColor: 0x4f7fd8, fillI: 0.5 }); W.sky.U.twinkle.value = 0; W.clip(0.3, 30000); };
      if (i <= 3) {
        // 地上の 1 段目：0 = エンジンのすぐ下、1 = 全体、2 = 真横の遠景、3 = 斜め下から
        const H = 70;
        dayEnv([X, H, Z], 44);
        S.root.visible = true; S.root.position.set(X, H, Z); S.fire1(t, 1, 1.6);
        if (i === 0) W.cam([X + 9, H - 3.5, Z + 13], [X, H - 2.2, Z], 40);
        else if (i === 1) W.cam([X + 26, H - 10, Z + 44], [X, H - 8, Z], 40);
        else if (i === 2) W.cam([X + 64, H - 30, Z + 108], [X, H - 6, Z], 27);
        else W.cam([X + 14, H - 30, Z + 16], [X, H - 6, Z], 44);
      } else if (i <= 5) {
        // 上空の 1 段目（外気が薄い）：4 = 半分、5 = ほぼ真空
        spaceEnv(); S.root.visible = true; S.root.position.set(-4, 6, 0); S.root.rotation.set(0, 0.5, -1.1);
        S.fire1(t, 1, 2.3); for (const f of S.f1) f.vac(i === 4 ? 0.45 : 1);
        W.cam([24, 4, 62], [8, -2, 0], 34);
      } else if (i <= 7) {
        // 2 段目（水素）：6 = 近く、7 = 全体
        spaceEnv(); S.root.visible = true; S.root.position.set(0, -13, 0); S.root.rotation.set(0, 0.9, 0); S.s1.visible = false;
        S.fire2(t, 1, 1.5);
        if (i === 6) W.cam([7.5, -3.6, 9.5], [0, -2.6, 0], 36); else W.cam([16, -6, 24], [0, -5, 0], 36);
      } else if (i === 8) {
        // 3 段目
        spaceEnv(); S.root.visible = true; S.root.position.set(0, -21, 0); S.s1.visible = false; S.s2.visible = false; S.fire3(t, 1, 1.0);
        W.cam([8, -4, 12], [0, -3.5, 0], 36);
      } else if (i === 9) {
        // 月着陸船
        spaceEnv(); const Lr = W.lander.root; Lr.visible = true; Lr.position.set(0, 0, 0); W.lander.fire(t, 1, 1.0);
        W.cam([6, 1.5, 9], [0, 0.4, 0], 36);
      } else {
        // 失敗作（グロックの 27 基）
        dayEnv([0, 12, 0], 24); W.test.visible = true;
        const B = W.booster; B.root.visible = true; B.root.position.set(0, 16, 0); B.count(27); B.fire(t, 1, 1);
        W.cam(i === 10 ? [10, 9, 16] : [18, 4, 30], [0, 11, 0], 40);
      }
    });
  }
  if (which === 'lm') {
    // 月着陸船の作り込みを確かめる（1 秒ごとに別の見方）
    film.shot('lm', 9, (t) => {
      const i = Math.floor(t + 1e-6);
      const sd = [0.6, 0.45, 0.65];
      const Lr = W.lander.root;
      if (i === 6) {
        W.env('space', 'space', 0, { sunDir: [0.5, 0.42, 0.75], size: 12, center: [0, 2, 0], dist: 160, hemiMul: 0.7, fillDir: [-0.6, -0.5, 0.3], fillColor: 0x4f7fd8, fillI: 0.5 });
        W.sky.U.twinkle.value = 0; W.clip(0.3, 30000);
        Lr.visible = true; Lr.position.set(0, 0, 0); Lr.rotation.set(0.2, 0.6, 0.15); W.lander.fire(t, 1, 1.0);
        W.cam([6, 3.5, 9], [0, 2.4, 0], 36);
        return;
      }
      W.moon.root.visible = true;
      W.env('space', 'space', 0, { sunDir: sd, size: 14, center: [0, 2, 1], dist: 150, sunMul: 1.9, hemiMul: 1.3, fillDir: [-0.6, 0.25, -0.5], fillColor: 0x9aa6c0, fillI: 0.25 });
      W.sky.U.twinkle.value = 0; W.sky.U.stars.value = 0.7; W.clip(0.1, 30000);
      Lr.visible = true; Lr.position.set(0, W.moon.h(0, 0) + 0.02, 0);
      const g0 = W.moon.h(0, 3);
      if (i === 0) W.cam([9.5, 1.1, 12.5], [0, 2.7, 0], 36);
      else if (i === 1) W.cam([3.4, 3.3, 6.6], [0, 3.5, 0.8], 36);
      else if (i === 2) { W.cam([4.6, 2.6, 6.8], [0.2, 3.0, 1.6], 34); W.lander.open(1); W.claude.at(0, g0 + 2.74, 2.05, Math.PI).helm().eyes('keen'); }
      else if (i === 3) { W.cam([2.9, 0.6, 7.0], [0, 0.85, 3.4], 30); W.lander.open(1); W.claude.at(0, g0 + 0.14, 3.32, 0).helm(); }
      else if (i === 4) W.cam([-8, 3, -9], [0, 2.6, 0], 36);
      else if (i === 5) W.cam([5, 9, 6], [0, 3, 0], 36);
      else if (i === 7) W.cam([10.5, 2.4, 0.5], [0, 2.6, 0], 36);
      else W.cam([1.6, 1.0, 4.4], [1.9, 1.3, 1.6], 40);
    });
  }
  if (which === 'gear') {
    // 小道具の作り込みを近くから確かめる（1 秒ごとに別の見方）
    film.shot('gear', 8, (t) => {
      const i = Math.floor(t + 1e-6);
      W.test.visible = true;
      const night = i === 6 || i === 7;
      W.env(night ? 'night' : 'day', night ? 'night' : 'day', 0, { sunDir: night ? [-0.3, 0.5, 0.8] : [0.45, 0.7, 0.55], size: 8, center: [0, 1, 0] });
      if (i === 0) { W.crate.visible = true; W.crate.position.set(0, 0.31, 0); W.crate.rotation.y = 0.5; W.laptop.root.visible = true; W.laptop.root.position.set(0, 0.62, 0); W.laptop.root.rotation.y = 0.54; W.laptop.screen('code', t * 12); W.cam([0.9, 1.25, 1.35], [0, 0.72, 0], 34); }
      else if (i === 1) { W.laptop.root.visible = true; W.laptop.root.position.set(0, 0, 0); W.laptop.root.rotation.y = -0.4; W.laptop.screen('ok'); W.cam([0.25, 0.55, 0.85], [0, 0.12, 0], 34); }
      else if (i === 2) { W.computer.root.visible = true; W.computer.root.position.set(0, 0, 0); W.computer.root.rotation.y = -0.3; W.computer.show('LOADING', '#74ecff', 0.6); W.cam([1.3, 1.25, 2.6], [0, 0.72, 0], 34); }
      else if (i === 3) { W.clipboard.visible = true; W.clipboard.position.set(0, 0.6, 0); W.clipboard.rotation.set(-0.3, 0.3, 0.05); W.sign5.visible = true; W.sign5.position.set(0.8, 0, -0.2); W.sign5.rotation.y = -0.2; W.cam([0.5, 0.95, 1.6], [0.3, 0.55, 0], 34); }
      else if (i === 4) { for (let k = 0; k < 2; k++) { const e = W.engines[k]; e.visible = true; e.position.set(-0.7 + k * 1.5, 0, 0); e.rotation.y = k * 1.2; } W.cam([1.6, 1.5, 4.4], [0.1, 1.05, 0], 34); }
      else if (i === 5) { W.crate.visible = true; W.crate.position.set(-0.6, 0.31, 0); W.crate.rotation.y = 0.5; const m = W.sheets.final; m.visible = true; m.position.set(0.8, 0.02, 0.2); m.rotation.set(-Math.PI / 2, 0, 0.2); W.cam([0.6, 1.3, 2.2], [0.2, 0.2, 0], 34); }
      else if (i === 6) { const s = W.spark; s.visible = true; s.position.set(0, 1.2, 0); s.rotation.z = t; W.claude.at(0, 0, 0); W.cam([0.4, 1.0, 3.6], [0, 0.95, 0], 34); }
      else { W.holo.show(t * 2, 0.75); W.holo.root.position.set(0, 1.7, 0); W.cam([0.6, 1.5, 5.2], [0, 1.6, 0], 34); }
    });
  }
  if (which === 'ui') {
    film.shot('ui', 8, (t) => {
      const i = Math.floor(t);
      W.scene.background.setRGB(0.1, 0.16, 0.3);
      W.cam([0, 1, 5], [0, 1, 0], 35);
      W.light({});
      if (i === 0) title(E, 1, 1);
      else if (i === 1) { promptBox(E, { text: 'GO TO THE MOON.', typed: 1 }); subtitle(E, '月へ行って。'); }
      else if (i === 2) { card(E, { cmd: 'launch --attempt 01 --by gpt', status: 'FAILED', detail: 'FELL APART (0.8S)' }); subtitle(E, '試行01：0.3秒で完成、0.8秒で分解。'); }
      else if (i === 3) bigNumber(E, '3', 1, 1);
      else if (i === 4) { W.post.tv.value = 1; tvChyron(E, 1); }
      else if (i === 5) credits(E, 1, 3);
      else {
        W.test.visible = true; W.claude.at(-1.5, 0, 0); W.gpt.at(0, 0, 0); W.grok.at(1.5, 0, 0);
        W.say('rocket', W.claude, 1); W.say(['fire', 't:X27'], W.gpt, 1); W.say('spark', W.grok, 1, { think: true });
        W.sayAt('list', [3, 1.5, 0], 1); W.sayAt('star', [-3, 1.5, 0], 1); W.sayAt('moon', [-3, 0, 0], 1); W.sayAt('zzz', [3, 0, 0], 1);
      }
    });
  }
}
