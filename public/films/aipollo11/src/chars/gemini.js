// Gemini：公式アイコンの四芒星（赤・黄・緑・青のグラデーション）をふっくらした立体にしたオリジナルの姿
// 質感：色の入ったアクリルやガラスの塊。鋭い艶、縁で強まる光、内側のほのかな光。
import * as THREE from 'three/webgpu';
import { positionLocal, color, mix, smoothstep, vec3, vec4, float, exp, dot, normalize, normalView, positionViewDirection, cameraPosition, modelWorldMatrixInverse, mx_noise_float } from 'three/tsl';
import { sph, grp, torus } from '../core/kit.js';
import { Actor, sootMat, makeHelmet, bumpN, detailFade } from './actor.js';
import { blink, lerp, smooth, clamp } from '../core/util.js';

export const STAR_R = 0.6;
const P_EXP = 0.57;

/** 四芒星のふっくらした立体（表と裏を縁で縫い合わせる） */
export function starGeometry(R = STAR_R, p = P_EXP, T = 0.2, NT = 192, NS = 20) {
  const pos = [];
  const rAt = (th) => R * Math.pow(Math.pow(Math.abs(Math.cos(th)), p) + Math.pow(Math.abs(Math.sin(th)), p), -1 / p);
  const zAt = (x, y) => {
    const q = Math.min(1, Math.pow(Math.abs(x / R), p) + Math.pow(Math.abs(y / R), p));
    const rho = Math.hypot(x, y) / R;
    const dome = Math.sqrt(Math.max(0, 1 - Math.pow(q, 4)));
    const taper = lerp(1, 0.3, smooth(clamp((rho - 0.22) / 0.78)));
    return T * dome * taper;
  };
  const sAt = (k) => 1 - Math.pow(1 - k / NS, 1.7);
  // 表：輪 0..NS、裏：輪 0..NS-1（縁の輪は表と共有）
  for (let side = 0; side < 2; side++) {
    const rings = side === 0 ? NS + 1 : NS;
    for (let k = 0; k < rings; k++) {
      const s = sAt(k);
      for (let j = 0; j < NT; j++) {
        const th = (j / NT) * Math.PI * 2;
        const r = rAt(th) * s;
        const x = Math.cos(th) * r, y = Math.sin(th) * r;
        const z = k === NS ? 0 : zAt(x, y);
        pos.push(x, y, side === 0 ? z : -z);
      }
    }
  }
  const vi = (side, k, j) => (side === 0 || k === NS ? k * NT + (j % NT) : (NS + 1) * NT + k * NT + (j % NT));
  const idx = [];
  for (let side = 0; side < 2; side++) {
    for (let k = 0; k < NS; k++) {
      for (let j = 0; j < NT; j++) {
        const a = vi(side, k, j), b = vi(side, k, j + 1), c = vi(side, k + 1, j), d = vi(side, k + 1, j + 1);
        if (side === 0) { if (k > 0) idx.push(a, c, b); idx.push(b, c, d); }
        else { if (k > 0) idx.push(a, b, c); idx.push(b, d, c); }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const n = g.attributes.normal;
  for (let j = 0; j < NT; j++) { n.setXYZ(j, 0, 0, 1); n.setXYZ((NS + 1) * NT + j, 0, 0, -1); }
  return g;
}

/** 四芒星の色（位置から決める TSL） */
export function starColorNode(R = STAR_R, xy = positionLocal.xy) {
  const p = xy.div(R);
  const blue = color(0x2f7df6), cyan = color(0x3fa9ff), red = color(0xf0463f), yellow = color(0xfcc419), green = color(0x2fbb5c);
  let c = mix(blue, cyan, smoothstep(0.1, 0.9, p.x));
  c = mix(c, yellow, smoothstep(0.1, 0.62, p.x.negate()));
  c = mix(c, green, smoothstep(0.08, 0.6, p.y.negate()));
  c = mix(c, red, smoothstep(0.08, 0.6, p.y));
  return c;
}

export class Gemini extends Actor {
  constructor() {
    super('gemini');
    this.seed = 7.7;
    // 色は表面と「少し奥」の 2 か所で読む：斜めから見ると中の色がずれて、厚みのある塊に見える
    const P = positionLocal;
    const Vl = normalize(modelWorldMatrixInverse.mul(vec4(cameraPosition, 1)).xyz.sub(P));
    const pin = P.xy.sub(Vl.xy.div(Vl.z.abs().max(0.35)).mul(0.09));
    const colS = starColorNode(STAR_R, P.xy), colI = starColorNode(STAR_R, pin);
    const core = exp(dot(pin, pin).div(0.15 * 0.15).negate());                 // 芯のほのかな光
    const ndv = normalView.dot(positionViewDirection).saturate();
    const rim = ndv.oneMinus().pow(3.0);                                         // 縁で光が強まる
    const tip = smoothstep(0.45, 1.0, P.xy.length().div(STAR_R));               // 薄い先端は光を通す
    const wob = mx_noise_float(P.mul(11.0));                                     // 磨いた面のごくゆるいうねり
    const pin2 = P.xy.sub(Vl.xy.div(Vl.z.abs().max(0.35)).mul(0.05));
    const bq = vec3(pin2.mul(150.0), 3.7);
    const bubble = smoothstep(0.7, 0.8, mx_noise_float(bq)).mul(detailFade(bq.mul(0.6)));        // 中に閉じこめられた小さな気泡
    const m = (this.mat = sootMat(this.sootU, 0xffffff, {
      colorNode: mix(colS, colI, 0.55).mul(0.92),
      roughNode: float(0.16).add(wob.mul(0.04)),
      clearcoat: 1.0, clearcoatRough: 0.09,
      emissiveNode: colI.mul(core.mul(0.34).add(0.1)).add(colS.mul(rim.mul(0.42).add(tip.mul(0.1)))).add(colI.mul(0.5).add(0.35).mul(bubble).mul(0.55)),
      normalNode: bumpN(wob.mul(0.0005), 1.0),
    }));
    const star = (this.star = grp());
    star.position.set(0, 0.62, 0);
    const mesh = new THREE.Mesh(starGeometry(), m);
    mesh.castShadow = true; mesh.receiveShadow = true;
    star.add(mesh);
    this.body.add(star);

    // 目
    const eyeMat = new THREE.MeshBasicNodeMaterial();
    eyeMat.colorNode = mix(color(0x131a3e), color(0xffffff), this.sootU);
    const glint = new THREE.MeshBasicNodeMaterial(); glint.colorNode = vec3(1.4);
    const mk = (side) => {
      const g = grp(); g.position.set(side * 0.1, 0.015, 0.2);
      const E = {};
      E.open = grp();
      const ball = sph(1, eyeMat, 0, 0, 0, 20, 14); ball.scale.set(0.055, 0.095, 0.022); ball.castShadow = false;
      const gl = sph(1, glint, -0.014, 0.034, 0.026, 10, 8); gl.scale.set(0.017, 0.021, 0.008); gl.castShadow = false;
      E.open.add(ball, gl);
      E.happy = torus(0.05, 0.017, eyeMat, 0, -0.025, 0.012, Math.PI, 8, 20); E.happy.castShadow = false;
      E.closed = sph(1, eyeMat, 0, 0, 0.008, 14, 8); E.closed.scale.set(0.062, 0.016, 0.02); E.closed.castShadow = false;
      E.sad = sph(1, eyeMat, 0, 0, 0.008, 14, 8); E.sad.scale.set(0.062, 0.017, 0.02); E.sad.rotation.z = side * -0.45; E.sad.castShadow = false;
      for (const k in E) g.add(E[k]);
      g.userData.E = E; star.add(g); return g;
    };
    this.eyeL = mk(-1); this.eyeR = mk(1);

    // 浮いている手
    const handMat = sootMat(this.sootU, 0xf1f5fc, { rough: 0.24, clearcoat: 0.8, clearcoatRough: 0.1, emissiveNode: vec3(0.05, 0.06, 0.08) });   // 乳白のガラス玉
    this.handL = sph(0.072, handMat, 0, 0, 0, 20, 14); this.handR = sph(0.072, handMat, 0, 0, 0, 20, 14);
    this.body.add(this.handL, this.handR);

    this.helmet = makeHelmet(0.76, 0.62, null);
    this.root.add(this.helmet);
    this.height = 1.2;
    this.hover = 0.2;
    this.pose0();
  }
  pose0() {
    this.star.rotation.set(0, 0, 0); this.star.scale.setScalar(1); this.star.position.set(0, 0.62, 0);
    this._eyes = 'open'; this._hover = 0.2; this._float = true;
    this._hl = [-0.42, 0.42, 0.12]; this._hr = [0.42, 0.42, 0.12];
    this._spin = 0;
  }
  /** 表情：open / happy / closed / sad / wide */
  eyes(kind) { this._eyes = kind; return this; }
  /** 手の位置（体からの相対）。null なら既定 */
  hands(l, r) { if (l) this._hl = l; if (r) this._hr = r; return this; }
  /** 星の傾き（z 回り）と向き（y 回り） */
  tilt(rz = 0, ry = 0, rx = 0) { this.star.rotation.set(rx, ry, rz); return this; }
  /** 浮く高さ（0 で着地） */
  float(h = 0.2, bob = true) { this._hover = h; this._float = bob; return this; }
  finish(T) {
    const bob = this._float ? Math.sin(T * 2.1 + this.seed) * 0.045 : 0;
    this.star.position.y += this._hover + bob;
    if (this._float) this.star.rotation.z += Math.sin(T * 1.3 + this.seed) * 0.05;
    const wide = this._eyes === 'wide';
    const kind = wide ? 'open' : this._eyes;
    const open = this.autoBlink && kind === 'open' ? blink(T, this.seed, 2.9) : 1;
    for (const g of [this.eyeL, this.eyeR]) {
      const E = g.userData.E;
      for (const k in E) E[k].visible = k === kind;
      E.open.scale.set(wide ? 1.3 : 1, (wide ? 1.3 : 1) * Math.max(0.1, open), 1);
    }
    const hb = this._float ? Math.sin(T * 2.1 + this.seed + 0.9) * 0.03 : 0;
    this.handL.position.set(this._hl[0], this._hl[1] + this._hover + hb, this._hl[2]);
    this.handR.position.set(this._hr[0], this._hr[1] + this._hover - hb, this._hr[2]);
  }
}
