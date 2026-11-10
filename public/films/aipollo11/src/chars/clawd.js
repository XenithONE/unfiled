// Claude（クロード）：オレンジのドット絵の生き物を立体のブロックで組む
// 質感：小さな立方体（1 ドット）を寄せて作った、半つやの樹脂の造形物。角はすれて少し明るく、ドットの境目に浅い溝。
import * as THREE from 'three/webgpu';
import { mix, color, float, vec3, positionLocal, normalLocal, smoothstep, max, fwidth, mx_noise_float } from 'three/tsl';
import { rbox, box, grp } from '../core/kit.js';
import { Actor, sootMat, makeHelmet, bumpN, detailFade } from './actor.js';
import { blink } from '../core/util.js';

export const CLAUDE_ORANGE = 0xd97757;

/** 体の素材。grid = ドットの格子のずれ [x, y, z]（0 か 0.5）。null なら溝なし */
function bodyMat(sootU, u, grid, dusty = false) {
  const P = positionLocal;
  const nl = normalLocal.abs();
  const edge = max(nl.x, max(nl.y, nl.z)).oneMinus();                  // 角の丸みの所だけ正になる
  const worn = smoothstep(0.02, 0.22, edge);                            // すれた角
  const q = P.mul(300.0);
  const grain = mx_noise_float(q).mul(detailFade(q));                   // 成形の細かな肌
  const mott = mx_noise_float(P.mul(6.5).add(3.0));                     // ごくゆるい色むら（塗膜のうねりにも使う）
  let groove = float(0);
  if (grid) {
    const gq = P.div(u).add(vec3(...grid));                             // 1 = 1 ドット
    const d = gq.sub(gq.round()).abs();                                 // いちばん近い格子の線まで
    const aa = fwidth(gq).max(1e-4);
    const w = 0.02;
    const line = (dd, a, n) => smoothstep(float(w).sub(a), float(w).add(a), dd).oneMinus().mul(float(w * 1.6).div(a.add(w)).clamp(0, 1)).mul(smoothstep(0.75, 0.95, n).oneMinus());
    groove = max(line(d.x, aa.x, nl.x), max(line(d.y, aa.y, nl.y), line(d.z, aa.z, nl.z))).mul(smoothstep(0.0, 0.26, edge).oneMinus());   // 角の丸みへはなだらかに消す（溝の端が点々と光らないように）
  }
  const base = color(0xe27a4f).mul(mott.mul(0.035).add(1.0));
  let col = mix(base, base.mul(1.16).add(0.015), worn.mul(0.55)).mul(groove.mul(0.2).oneMinus());
  let dust = float(0);
  if (dusty) {                                                          // 足の下の方は、歩いてついた土ぼこりで白っぽい
    dust = smoothstep(-0.35, 0.95, P.y.div(u).negate().add(mott.mul(0.45))).mul(0.42);
    col = mix(col, color(0xb9aa98), dust);
  }
  return sootMat(sootU, 0xe27a4f, {
    colorNode: col,
    roughNode: float(0.5).add(grain.mul(0.07)).add(mott.mul(0.03)).sub(worn.mul(0.12)).add(groove.mul(0.25)).add(dust.mul(0.5)),
    clearcoat: 0.3, clearcoatRough: 0.28,
    normalNode: bumpN(grain.mul(0.00011).sub(groove.mul(0.0004)).add(mott.mul(0.0011)), 1.0),
  });
}

export class Clawd extends Actor {
  constructor() {
    super('claude');
    this.seed = 1.3;
    const u = (this.u = 0.12);
    const orange = (this.mat = bodyMat(this.sootU, u, [0, 0.5, 0.5]));    // 胴：幅 10・高さ 5・奥行 5 ドット
    const armMat = bodyMat(this.sootU, u, null);
    const legMat = bodyMat(this.sootU, u, [0.5, 0, 0.5], true);           // 足：1 x 2 x 3 ドット
    // 目：黒い艶のある部品（すすの中では白く見える）
    const eyeMat = new THREE.MeshStandardNodeMaterial();
    eyeMat.colorNode = mix(color(0x0d0a09), color(0xffffff), this.sootU);
    eyeMat.roughnessNode = mix(float(0.1), float(0.7), this.sootU);
    eyeMat.emissiveNode = vec3(0.85).mul(this.sootU);
    this.eyeMat = eyeMat;

    // 胴（幅 10・高さ 5・奥行 5 ドット）
    this.torso = rbox(10 * u, 5 * u, 5 * u, 0.022, orange, 0, 4.5 * u, 0);
    this.body.add(this.torso);

    // 腕（左右の出っぱり）：付け根で回す
    const armGeo = () => rbox(1.35 * u, 1.5 * u, 2.6 * u, 0.016, armMat);
    this.armL = grp(); this.armL.position.set(-5 * u, 4.25 * u, 0);
    const aL = armGeo(); aL.position.x = -0.62 * u; this.armL.add(aL);
    this.armR = grp(); this.armR.position.set(5 * u, 4.25 * u, 0);
    const aR = armGeo(); aR.position.x = 0.62 * u; this.armR.add(aR);
    this.body.add(this.armL, this.armR);

    // 足 4 本：付け根で回す
    this.legs = [-4.5, -2.5, 2.5, 4.5].map((x) => {
      const g = grp(rbox(1 * u, 2 * u, 3 * u, 0.014, legMat, 0, -1 * u, 0));
      g.position.set(x * u, 2 * u, 0);
      this.body.add(g);
      return g;
    });

    // 目：表情ごとの形を持っておき、出し分ける
    const zf = 2.5 * u + 0.006;
    const mk = (side) => {
      const g = grp(); g.position.set(side * 2.5 * u, 5.5 * u, zf);
      const E = {};
      const flat = (w, h) => { const m = box(w, h, 0.012, eyeMat); m.castShadow = false; m.receiveShadow = false; return m; };
      E.open = flat(1 * u, 1 * u);
      E.wide = flat(1.3 * u, 1.3 * u);
      E.closed = flat(1.15 * u, 0.26 * u);
      // うれしい目「> <」
      E.happy = grp();
      const s1 = flat(0.95 * u, 0.27 * u), s2 = flat(0.95 * u, 0.27 * u);
      s1.position.y = 0.21 * u; s2.position.y = -0.21 * u;
      s1.rotation.z = -side * -0.5; s2.rotation.z = side * -0.5;
      E.happy.add(s1, s2);
      // ぐるぐる（×）
      E.dizzy = grp();
      const d1 = flat(1.25 * u, 0.26 * u), d2 = flat(1.25 * u, 0.26 * u);
      d1.rotation.z = Math.PI / 4; d2.rotation.z = -Math.PI / 4;
      E.dizzy.add(d1, d2);
      // しょんぼり（外下がりの線）
      E.sad = flat(1.15 * u, 0.26 * u); E.sad.rotation.z = side * -0.42;
      // きりっ（内下がりの線）
      E.keen = flat(1.15 * u, 0.3 * u); E.keen.rotation.z = side * 0.36;
      for (const k in E) g.add(E[k]);
      g.userData.E = E;
      return g;
    };
    this.eyeL = mk(-1); this.eyeR = mk(1);
    this.body.add(this.eyeL, this.eyeR);

    this.helmet = makeHelmet(0.86, 0.56, 0.2);
    this.root.add(this.helmet);
    this.height = 7 * u;
    this.pose0();
  }

  pose0() {
    this.armL.rotation.set(0, 0, 0); this.armR.rotation.set(0, 0, 0);
    for (const l of this.legs) { l.rotation.set(0, 0, 0); l.position.y = 2 * this.u; }
    this._eyes = 'open'; this._eyeDX = 0; this._eyeDY = 0; this._blink = null;
    this._breath = 1;
  }
  /** 表情：open / wide / closed / happy / dizzy / sad / keen */
  eyes(kind, dx = 0, dy = 0) { this._eyes = kind; this._eyeDX = dx; this._eyeDY = dy; return this; }
  /** 視線だけずらす（ドット単位） */
  gaze(dx = 0, dy = 0) { this._eyeDX = dx; this._eyeDY = dy; return this; }
  /** 腕の上げ下げ（ラジアン・正で上） */
  arms(l = 0, r = l, fwdL = 0, fwdR = fwdL) {
    this.armL.rotation.z = -l; this.armR.rotation.z = r;
    this.armL.rotation.y = fwdL; this.armR.rotation.y = -fwdR;
    return this;
  }
  /** 歩き（phase を進めると足が交互に動く） */
  walk(phase, amt = 1) {
    const u = this.u;
    this.legs.forEach((l, i) => {
      const ph = phase + (i % 2) * Math.PI;
      l.rotation.x = Math.sin(ph) * 0.6 * amt;
      l.position.y = 2 * u + Math.max(0, Math.cos(ph)) * 0.3 * u * amt;
    });
    this.body.position.y += Math.abs(Math.sin(phase)) * 0.03 * amt;
    this.body.rotation.z += Math.sin(phase) * 0.05 * amt;
    return this;
  }
  finish(T) {
    const u = this.u;
    let open = 1;
    if (this.autoBlink && (this._eyes === 'open')) open = blink(T, this.seed);
    for (const g of [this.eyeL, this.eyeR]) {
      const E = g.userData.E;
      for (const k in E) E[k].visible = k === this._eyes;
      const side = g === this.eyeL ? -1 : 1;
      g.position.x = side * 2.5 * u + this._eyeDX * u;
      g.position.y = 5.5 * u + this._eyeDY * u;
      g.scale.y = this._eyes === 'open' || this._eyes === 'wide' ? Math.max(0.12, open) : 1;
    }
    if (this.breathe) this.body.scale.y *= 1 + Math.sin(T * 2.3 + this.seed) * 0.012;
  }
}
