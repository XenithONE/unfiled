// 地上の舞台：野原の作業場・試験台・格納庫・発射台と鉄塔
import * as THREE from 'three/webgpu';
import { positionWorld, mx_noise_float, mix, color, vec2, float, length, abs, max, fract, smoothstep, uniform } from 'three/tsl';
import { box, rbox, cyl, cone, sph, mat, glow, grp, at, rot, struts, trussList, lathe, canvasTex, torus } from '../core/kit.js';
import { makeBlueprints } from '../props/blueprints.js';
import { glowSprite } from '../fx/fx.js';
import { pixText } from '../core/pixfont.js';
import { mulberry } from '../core/util.js';
import { makeGround, makeGrass, makeTrees, makeWater, flatMask, yardH, WATER_Y } from './terrain.js';
import { LaunchComplex, DECK, TOWER_X } from './pad.js';
import { Workshop } from './workshop.js';

export const TESTPAD = [0, 0, -15];
export const PAD = [0, 0, -150];
export { DECK, TOWER_X };         // 発射台の床の高さ・塔の位置（発射施設は pad.js）

export class Yard {
  constructor(HI = false) {
    const root = (this.root = grp());
    const rnd = mulberry(1969);

    // ---- 地表：地形・芝・木・水面（物理ベース）
    root.add(makeGround());
    root.add(makeWater());
    this.grass = makeGrass(HI ? 420000 : 200000);
    root.add(this.grass);
    {
      const spots = [];
      const tr = mulberry(31);
      const clusters = [[-104, 6, 9], [-96, -38, 7], [-70, -92, 8], [-46, -118, 6], [58, 30, 6], [92, -8, 7], [118, -118, 7], [-64, -150, 6], [-30, 64, 7], [24, 70, 6], [-120, -150, 8], [96, -190, 7], [-80, -230, 9], [20, -262, 8]];
      for (const [cx, cz, n] of clusters) for (let i = 0; i < n; i++) {
        const x = cx + (tr() - 0.5) * 34, z = cz + (tr() - 0.5) * 34;
        if (flatMask(x, z) > 0.55 || yardH(x, z) < WATER_Y + 0.4) continue;
        spots.push([x, z, 8 + tr() * 7]);
      }
      this.trees = makeTrees(spots);
      root.add(this.trees);
    }

    // ---- 作業場・試験場の台・格納庫・給水塔・アンテナ（workshop.js）
    this.bp = makeBlueprints();
    const ws = (this.ws = new Workshop(HI, this.bp));
    this.work = ws.work; this.board = ws.board; this.bpPlanes = ws.bpPlanes; this.cones = ws.cones;
    this.testpad = ws.testpad; this.scorchU = ws.scorchU;
    root.add(ws.work, ws.testpad, ws.site);

    // ---- 発射施設（台地・火炎溝・移動式発射台・発射塔・アーム・投光器・タンク：pad.js）
    const pad = (this.pad = new LaunchComplex(HI));
    this.launch = pad.root; this.tower = pad.tower; this.crane = pad.crane; this.hook = pad.hook; this.arms = pad.arms; this.floods = pad.floods;
    root.add(pad.root);
    this.reset();
  }

  reset() {
    this.root.visible = false;
    this.work.visible = true; this.board.visible = true; this.testpad.visible = true; this.launch.visible = true; this.tower.visible = true;
    for (const k in this.bpPlanes) this.bpPlanes[k].visible = false;
    this.ws.pins.visible = false;
    for (const c of this.cones) c.visible = false;
    this.pad.reset();
    this.scorchU.value = 0;
    this.setNight(0);
  }
  /** 板に貼る設計図（goal / claude / gpt / gemini / grok / final / null） */
  blueprint(id) { for (const k in this.bpPlanes) this.bpPlanes[k].visible = k === id; this.ws.pins.visible = id in this.bpPlanes; }
  /** アームを外へ振る（0..1） */
  swing(k, only = -1) { this.pad.swing(k, only); }
  /** 夜の灯り（0..1） */
  setNight(k) {
    this.ws.setNight(k);
    this.pad.setNight(k);
  }
}
