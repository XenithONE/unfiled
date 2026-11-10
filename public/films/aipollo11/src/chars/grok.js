// Grok：真っ黒な球に白い光が 2 つ（ロゴのつやを目として使う）
// 質感：磨いた黒い球（ボウリングの球のような深い艶）。指のあとと細かなすり傷で艶にむらがある。目は発光体。
import * as THREE from 'three/webgpu';
import { vec3, float, color, positionLocal, smoothstep, mx_noise_float } from 'three/tsl';
import { sph, grp } from '../core/kit.js';
import { Actor, sootMat, makeHelmet, bumpN, detailFade, sphereN } from './actor.js';
import { blink } from '../core/util.js';

export const GROK_R = 0.42;

export class Grok extends Actor {
  constructor() {
    super('grok');
    this.seed = 9.9;
    const P = positionLocal;
    const blot = smoothstep(0.0, 0.65, mx_noise_float(P.mul(8.5).add(1.7)));                  // 手で触ったあと
    const dq = P.mul(520.0);
    const speck = smoothstep(0.62, 0.72, mx_noise_float(dq)).mul(detailFade(dq.mul(0.6)));      // 黒い艶の面に乗った細かなほこり
    const wob = mx_noise_float(P.mul(13.0).add(7.0));                                           // 磨き面のゆるいうねり
    const black = (this.mat = sootMat(this.sootU, 0x040405, {
      colorNode: color(0x040405).add(vec3(0.16, 0.155, 0.15).mul(speck)),
      roughNode: float(0.095).add(blot.mul(0.13)).add(speck.mul(0.6)),
      normalNode: bumpN(wob.mul(0.0006), 1.0, sphereN()),
      rim: 0x8fa3c8, rimPow: 3.6, rimAmt: 0.1, sootKeepsGlow: true,
    }));
    const ball = (this.ball = sph(GROK_R, black, 0, GROK_R, 0, 56, 40));
    this.body.add(ball);

    // 目（白い光 2 つ）：球の中心を軸に向きを変える
    const white = new THREE.MeshBasicNodeMaterial(); white.colorNode = vec3(1.38, 1.4, 1.46);   // 発光体（少しにじむ）
    const pivot = (this.eyePivot = grp()); pivot.position.set(0, GROK_R, 0);
    const mk = (yaw, pitch, len, rad) => {
      const sub = grp(); sub.rotation.set(-pitch, yaw, 0, 'YXZ');
      const g = grp(); g.position.set(0, 0, GROK_R * 0.992);
      const c = new THREE.Mesh(new THREE.CapsuleGeometry(rad, len, 8, 16), white);
      c.scale.z = 0.22; c.castShadow = false;
      g.add(c); sub.add(g); pivot.add(sub); return g;
    };
    this.eyeA = mk(-0.225, -0.02, 0.07, 0.055);  // 大きい方（左）
    this.eyeB = mk(0.225, 0.05, 0.076, 0.042);   // 小さい方（右・少し上）
    this.body.add(pivot);

    this.helmet = makeHelmet(0.58, GROK_R, null);
    this.root.add(this.helmet);
    this.height = GROK_R * 2;
    this.pose0();
  }
  pose0() {
    this._look = [0.44, 0.46]; this._tilt = [0.36, 0.36]; this._open = 1; this._eScale = 1;
  }
  /** 目の向き（yaw 正で画面右、pitch 正で上）。既定はロゴと同じ右上 */
  look(yaw = 0.44, pitch = 0.46) { this._look = [yaw, pitch]; return this; }
  /** 表情：logo / angry / sad / happy / flat / wide / squint */
  eyes(kind) {
    const map = {
      logo: [[0.36, 0.36], 1, 1], angry: [[-0.5, 0.5], 0.8, 1.05], sad: [[0.5, -0.5], 0.8, 1], happy: [[0.2, -0.2], 0.55, 1.05],
      flat: [[1.5708, 1.5708], 0.9, 0.9], wide: [[0.1, 0.1], 1.25, 1.2], squint: [[0.36, 0.36], 0.4, 1], straight: [[0, 0], 1, 1],
    };
    const [t, o, s] = map[kind] || map.logo;
    this._tilt = t; this._open = o; this._eScale = s; return this;
  }
  finish(T) {
    this.eyePivot.rotation.set(-this._look[1], this._look[0], 0, 'YXZ');
    const b = this.autoBlink ? blink(T, this.seed, 3.7) : 1;
    const o = Math.max(0.1, this._open * b);
    this.eyeA.rotation.z = this._tilt[0]; this.eyeB.rotation.z = this._tilt[1];
    this.eyeA.scale.set(this._eScale, this._eScale * o, 1); this.eyeB.scale.set(this._eScale, this._eScale * o, 1);
  }
}
