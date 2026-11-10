// 小道具（実写寄り）：ノートパソコン・誘導計算機・クリップボード・ひらめきの印・エンジン・札・航路のホログラム・木箱・設計図の紙
import * as THREE from 'three/webgpu';
import { uniform, texture, uv, color, mix, vec2, vec3, float, sin, cos, fract, step, abs, max, min, exp, smoothstep, positionLocal, normalView, positionViewDirection, dot, atan, asin, length, mx_noise_float, mx_fractal_noise_float } from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mat, glow, grp, canvasTex, iattr } from '../core/kit.js';
import { FX_LAYER } from '../core/engine.js';
import { glowSprite } from '../fx/fx.js';
import { pixText } from '../core/pixfont.js';
import { hash1, mulberry } from '../core/util.js';
import { xf, atAz, rod, hoop, rAt, latheOf, crinkle, partMaterial } from './saturn_parts.js';
import { Bag2, quadGeo, foilMaterial, woodMaterial, paperNodes, tilt } from './mats.js';

const HP = Math.PI / 2, TAU = Math.PI * 2;
const FONT = '"Arial Black", "Helvetica Neue", Arial, "Segoe UI", sans-serif';
const AL = [0xc3c6cb, 0.34, 0.9], STEEL = [0xa9aeb6, 0.4, 0.85], DARKM = [0x2a2c31, 0.5, 0.6], RUBBER = [0x141415, 0.9, 0.0];

/** 光る画面：黒いガラスの奥で表示が発光し、表面には空が映る */
function screenMaterial(tex, gain = 1.5) {
  const m = new THREE.MeshStandardNodeMaterial();
  m.color.set(0x020203); m.roughness = 0.14; m.metalness = 0.0;
  m.emissiveNode = texture(tex, uv()).rgb.mul(gain);
  return m;
}

/** ノートパソコン（アルミの筐体・キーの 1 つずつ・蝶番・ガラスの画面にコードが流れる） */
export class Laptop {
  constructor() {
    const g = (this.root = grp());
    const b = new Bag2();
    b.add(new RoundedBoxGeometry(0.62, 0.03, 0.42, 3, 0.012).translate(0, 0.017, 0), ...AL);
    b.add(new THREE.BoxGeometry(0.55, 0.002, 0.205).translate(0, 0.0325, -0.076), 0x15161a, 0.7, 0.2);       // キーボードのくぼみ
    for (let r = 0; r < 6; r++) {
      const z = -0.156 + r * 0.032;
      for (let c = 0; c < 14; c++) {
        if (r === 5 && c >= 4 && c <= 8) { if (c === 4) b.add(new THREE.BoxGeometry(0.186, 0.005, 0.027).translate(-0.247 + 6 * 0.038, 0.035, z), 0x1d1e21, 0.55, 0.1); continue; }
        b.add(new THREE.BoxGeometry(0.033, 0.005, r === 0 ? 0.018 : 0.027).translate(-0.247 + c * 0.038, 0.035, z), 0x1d1e21, 0.55, 0.1);
      }
    }
    b.add(new THREE.BoxGeometry(0.2, 0.0015, 0.115).translate(0, 0.0325, 0.128), 0xaeb1b6, 0.22, 0.7);       // トラックパッド
    b.add(xf(new THREE.CylinderGeometry(0.011, 0.011, 0.44, 10), { r: [0, 0, HP], p: [0, 0.036, -0.2] }), 0x18191b, 0.45, 0.5);   // 蝶番
    for (const [x, z] of [[-0.26, -0.17], [0.26, -0.17], [-0.26, 0.17], [0.26, 0.17]]) b.add(new THREE.CylinderGeometry(0.014, 0.014, 0.004, 10).translate(x, 0.002, z), ...RUBBER);
    for (const z of [-0.08, -0.04, 0.0]) b.add(new THREE.BoxGeometry(0.003, 0.006, 0.018).translate(-0.3105, 0.016, z), 0x0c0c0d, 0.6, 0.3);   // 側面の差し込み口
    g.add(b.mesh(partMaterial()));
    const lid = (this.lid = grp()); lid.position.set(0, 0.035, -0.2);
    const lb = new Bag2();
    lb.add(new RoundedBoxGeometry(0.62, 0.42, 0.011, 3, 0.005).translate(0, 0.21, -0.003), ...AL);
    lb.add(new THREE.BoxGeometry(0.604, 0.404, 0.002).translate(0, 0.21, 0.0035), 0x050506, 0.14, 0.2);       // 黒いガラスの縁
    lb.add(xf(new THREE.CylinderGeometry(0.036, 0.036, 0.001, 24), { r: [HP, 0, 0], p: [0, 0.21, -0.0088] }), 0xdfe1e4, 0.2, 0.9);   // ふたの丸い印
    lb.add(xf(new THREE.CylinderGeometry(0.003, 0.003, 0.002, 8), { r: [HP, 0, 0], p: [0, 0.404, 0.0048] }), 0x0a0a0b, 0.3, 0.2); // カメラ
    lid.add(lb.mesh(partMaterial()));
    this.tex = canvasTex(256, 160, null, { pixel: true });
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.36), screenMaterial(this.tex, 1.5)); scr.position.set(0, 0.21, 0.0049);
    lid.add(scr); lid.rotation.x = -0.32;
    g.add(lid);
    this._sig = '';
    this.reset();
  }
  reset() { this.root.visible = false; this.root.position.set(0, 0, 0); this.root.rotation.set(0, 0, 0); this.root.scale.setScalar(1); this._mode = 'code'; this._v = 0; }
  /** 画面：code（流れるコード）/ ok / bar（進み具合 v）/ err */
  screen(mode, v = 0) { this._mode = mode; this._v = v; return this; }
  finish() {
    const sig = this._mode + Math.round(this._v * 30);
    if (sig === this._sig) return;
    this._sig = sig;
    const ctx = this.tex.userData.ctx;
    ctx.fillStyle = '#0d1330'; ctx.fillRect(0, 0, 256, 160);
    if (this._mode === 'code') {
      const sc = this._v;
      for (let r = 0; r < 9; r++) {
        const line = Math.floor(sc) + r; let x = 14 + Math.floor(hash1(line * 3.1) * 3) * 14;
        const n = 2 + Math.floor(hash1(line * 7.7) * 3);
        for (let k = 0; k < n; k++) { const w = 14 + Math.floor(hash1(line * 13.3 + k * 5.1) * 44); if (x + w > 240) break; ctx.fillStyle = ['#74ecff', '#74ecff', '#6dff9c', '#b6a7ff', '#ffd95e'][Math.floor(hash1(line * 1.7 + k * 9.9) * 5)]; ctx.fillRect(x, 12 + (r - (sc % 1)) * 17, w, 8); x += w + 10; }
      }
    } else if (this._mode === 'bar') {
      ctx.strokeStyle = '#74ecff'; ctx.lineWidth = 6; ctx.strokeRect(30, 62, 196, 36);
      ctx.fillStyle = '#6dff9c'; ctx.fillRect(38, 70, 180 * Math.min(1, this._v), 20);
    } else if (this._mode === 'ok') { pixText(ctx, 'OK', 128, 38, 14, '#6dff9c', { align: 'center' }); }
    else if (this._mode === 'err') { pixText(ctx, 'ERROR', 128, 52, 8, '#ff6b5e', { align: 'center' }); }
    this.tex.needsUpdate = true;
  }
}

/** 誘導計算機（アポロの表示キーボードへのオマージュ）：金属の箱・放熱の溝・押しボタン・緑に光る表示器 */
export class Computer {
  constructor() {
    const g = (this.root = grp());
    const b = new Bag2();
    const BODY = [0x969b9f, 0.52, 0.35], FACE = [0x7c8186, 0.56, 0.3];
    b.add(new RoundedBoxGeometry(1.1, 1.26, 0.5, 3, 0.03).translate(0, 0.67, 0), ...BODY);
    b.add(new THREE.BoxGeometry(1.02, 1.18, 0.02).translate(0, 0.67, 0.254), ...FACE);
    for (const z of [-0.17, 0.17]) b.add(new THREE.BoxGeometry(1.14, 0.045, 0.1).translate(0, 0.0225, z), ...DARKM);            // 台の桟
    for (const s of [-1, 1]) for (let i = 0; i < 12; i++) b.add(new THREE.BoxGeometry(0.035, 0.035, 0.42).translate(s * 0.562, 0.16 + i * 0.092, 0), ...BODY);   // 放熱の溝（横の羽）
    for (let i = 0; i < 9; i++) b.add(new THREE.BoxGeometry(0.035, 0.03, 0.4).translate(-0.4 + i * 0.1, 1.31, 0), ...BODY);       // 天板の羽
    b.add(new THREE.BoxGeometry(0.93, 0.65, 0.03).translate(0, 0.88, 0.268), 0x0b0c0d, 0.4, 0.3);                                 // 表示器の枠
    b.add(new THREE.BoxGeometry(0.97, 0.03, 0.09).translate(0, 1.222, 0.3), ...DARKM);                                            // ひさし
    for (const [x, y] of [[-0.47, 1.22], [0.47, 1.22], [-0.47, 0.12], [0.47, 0.12]]) b.add(xf(new THREE.CylinderGeometry(0.02, 0.02, 0.012, 8), { r: [HP, 0, 0], p: [x, y, 0.268] }), ...STEEL);
    // 押しボタン（1 つずつ。上面に白い文字の札）
    for (let j = 0; j < 3; j++) for (let i = 0; i < 6; i++) {
      const x = -0.375 + i * 0.15, y = 0.45 - j * 0.145;
      b.add(new RoundedBoxGeometry(0.115, 0.115, 0.05, 2, 0.012).translate(x, y, 0.283), 0x26282c, 0.55, 0.2);
      b.add(new THREE.BoxGeometry(0.062, 0.062, 0.002).translate(x, y, 0.309), (i + j) % 5 === 0 ? 0xd9b45a : 0xd6d6cf, 0.6, 0.0);
    }
    // 背中の配線
    for (const x of [-0.3, 0.25]) { b.add(rod([x, 0.9, -0.25], [x, 0.9, -0.36], 0.03, 8), ...DARKM); b.add(rod([x, 0.9, -0.36], [x * 1.3, 0.03, -0.5], 0.026, 8), ...RUBBER); b.add(rod([x * 1.3, 0.03, -0.5], [x * 2.6, 0.03, -1.2], 0.026, 8), ...RUBBER); }
    g.add(b.mesh(partMaterial()));
    // 状態を知らせる灯り
    const lamps = [[0xffb23a, -0.36], [0xffb23a, -0.24], [0x6dff9c, -0.12], [0xe8ecf2, 0.24], [0xff5548, 0.36]];
    for (const [c, x] of lamps) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.035, 0.01), glow(c, c === 0xff5548 ? 0.25 : 1.1)); l.position.set(x, 1.262, 0.262); g.add(l); }
    this.tex = canvasTex(192, 128, null, { pixel: true });
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.56), screenMaterial(this.tex, 1.6)); scr.position.set(0, 0.88, 0.2845); g.add(scr);
    this._sig = ''; this.reset();
  }
  reset() { this.root.visible = false; this.root.position.set(0, 0, 0); this.root.rotation.set(0, 0, 0); this.root.scale.setScalar(1); this._txt = 'READY'; this._col = '#6dff9c'; this._bar = -1; }
  /** 表示：文字（緑など）と進み具合の棒 */
  show(txt, col = '#6dff9c', bar = -1) { this._txt = txt; this._col = col; this._bar = bar; return this; }
  finish() {
    const sig = this._txt + this._col + Math.round(this._bar * 40);
    if (sig === this._sig) return; this._sig = sig;
    const ctx = this.tex.userData.ctx;
    ctx.fillStyle = '#04100a'; ctx.fillRect(0, 0, 192, 128);
    ctx.fillStyle = 'rgba(60,120,80,0.10)'; for (let y = 0; y < 128; y += 4) ctx.fillRect(0, y, 192, 1);     // 表示器の走査線
    pixText(ctx, this._txt, 96, this._bar >= 0 ? 22 : 40, this._txt.length > 5 ? 5 : 7, this._col, { align: 'center' });
    if (this._bar >= 0) { ctx.strokeStyle = this._col; ctx.lineWidth = 4; ctx.strokeRect(22, 82, 148, 22); ctx.fillStyle = this._col; ctx.fillRect(28, 88, 136 * Math.min(1, this._bar), 10); }
    this.tex.needsUpdate = true;
  }
}

/** 確認表（クリップボード）：硬い板・ばねのクリップ・反った紙の束・鉛筆 */
export function makeClipboard() {
  const g = grp();
  const wb = new Bag2(); wb.add(new RoundedBoxGeometry(0.5, 0.66, 0.012, 2, 0.005), 0x7a5632, 0.75, 0);
  g.add(wb.mesh(woodMaterial('y')));
  const t = canvasTex(384, 512, (ctx) => {
    ctx.fillStyle = '#fbf8ee'; ctx.fillRect(0, 0, 384, 512);
    ctx.fillStyle = '#22252b'; ctx.textBaseline = 'middle'; ctx.font = `900 24px ${FONT}`; ctx.fillText('PRE-FLIGHT CHECK', 30, 44);
    ctx.fillRect(30, 64, 324, 3);
    for (let i = 0; i < 6; i++) {
      const y = 92 + i * 66;
      ctx.strokeStyle = '#2a2d33'; ctx.lineWidth = 5; ctx.strokeRect(34, y, 38, 38);
      ctx.strokeStyle = '#2a9a4e'; ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(40, y + 20); ctx.lineTo(52, y + 33); ctx.lineTo(78, y - 6); ctx.stroke();
      ctx.fillStyle = '#7f858d'; ctx.fillRect(100, y + 8, 150 + ((i * 37) % 90), 9); ctx.fillStyle = '#b4b9c0'; ctx.fillRect(100, y + 25, 90 + ((i * 53) % 110), 6);
    }
    ctx.fillStyle = 'rgba(40,60,120,0.10)'; for (let y = 86; y < 500; y += 22) ctx.fillRect(20, y, 344, 1);
  });
  // 紙：下の 2 枚は少しずれ、いちばん上は角が反る
  const sheet = (z, rz, curl, map) => {
    const geo = new THREE.PlaneGeometry(0.44, 0.58, 8, 10), p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { const u = p.getX(i) / 0.44 + 0.5, v = p.getY(i) / 0.58 + 0.5; p.setZ(i, curl * Math.pow(Math.max(0, u - 0.35) * Math.max(0, 0.75 - v), 1.6) * 3.2 + 0.0015 * Math.sin(u * 7 + v * 5)); }
    geo.computeVertexNormals();
    const m = new THREE.MeshStandardNodeMaterial(); m.side = THREE.DoubleSide; m.metalness = 0;
    const pp = paperNodes(positionLocal);
    m.colorNode = (map ? texture(map, uv()).rgb : vec3(0.95, 0.93, 0.87)).mul(pp.tone).mul(0.84);
    m.roughnessNode = float(0.86); m.normalNode = tilt(normalView, pp.bump, 0.08);
    const s = new THREE.Mesh(geo, m); s.position.set(0, -0.02, z); s.rotation.z = rz; s.castShadow = true; s.receiveShadow = true;
    return s;
  };
  g.add(sheet(0.0075, 0.02, 0.0, null), sheet(0.009, -0.015, 0.0, null), sheet(0.0105, 0, 0.06, t));
  const b = new Bag2();
  b.add(new THREE.BoxGeometry(0.21, 0.075, 0.006).translate(0, 0.292, 0.009), ...STEEL);
  b.add(xf(new THREE.CylinderGeometry(0.013, 0.013, 0.19, 10), { r: [0, 0, HP], p: [0, 0.312, 0.022] }), ...STEEL);
  b.add(xf(new THREE.BoxGeometry(0.17, 0.085, 0.004), { r: [0.32, 0, 0], p: [0, 0.3, 0.03] }), 0xbfc3c9, 0.3, 0.9);
  b.add(xf(new THREE.BoxGeometry(0.19, 0.012, 0.012), { p: [0, 0.258, 0.016] }), ...STEEL);
  for (const x of [-0.08, 0.08]) b.add(xf(new THREE.CylinderGeometry(0.008, 0.008, 0.004, 8), { r: [HP, 0, 0], p: [x, 0.3, 0.013] }), ...DARKM);
  // 鉛筆（クリップにはさむ）
  b.add(xf(new THREE.CylinderGeometry(0.0075, 0.0075, 0.2, 6), { r: [0, 0, HP - 0.06], p: [0.105, 0.262, 0.027] }), 0xe0a81e, 0.5, 0);
  b.add(xf(new THREE.ConeGeometry(0.0075, 0.022, 6), { r: [0, 0, -HP - 0.06], p: [0.215, 0.2555, 0.027] }), 0xcaa46e, 0.7, 0);
  b.add(xf(new THREE.CylinderGeometry(0.008, 0.008, 0.018, 8), { r: [0, 0, HP - 0.06], p: [-0.003, 0.2685, 0.027] }), 0xd98a8a, 0.8, 0);
  g.add(b.mesh(partMaterial()));
  return g;
}

/** Claude のひらめき・考え中の印（オレンジの放射）。中心ほど白熱する発光体＋やわらかい光の輪 */
export function makeSpark() {
  const g = grp();
  const m = new THREE.MeshBasicNodeMaterial();
  {
    const r = length(positionLocal.xy);
    const ndv = abs(dot(normalView, positionViewDirection)).clamp(0, 1);
    const core = smoothstep(0.03, 0.34, r).oneMinus();
    m.colorNode = mix(color(0xe2683c), color(0xffa573), core.mul(0.7)).mul(float(1.05).add(core.mul(0.3))).mul(ndv.mul(0.35).add(0.75));
  }
  const L = [1, 0.78, 0.95, 0.7, 1, 0.8, 0.92, 0.72, 0.98, 0.76, 0.9, 0.74];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2, len = 0.3 * L[i];
    const geo = new THREE.CapsuleGeometry(0.027, len - 0.054, 5, 10);
    // 先へ向かって少し細く
    const p = geo.attributes.position; for (let k = 0; k < p.count; k++) { const s = 1 - 0.28 * (p.getY(k) / len + 0.5); p.setX(k, p.getX(k) * s); p.setZ(k, p.getZ(k) * s * 0.9); }
    geo.translate(0, 0.05 + len / 2, 0); geo.rotateZ(a);
    const r = new THREE.Mesh(geo, m); r.castShadow = false; g.add(r);
  }
  const halo = glowSprite(0xff8a50, 1.1, { gain: 0.13, pow: 2.6 }); halo.position.z = -0.02; g.add(halo);
  const coreGlow = glowSprite(0xffc08a, 0.3, { gain: 0.16, pow: 2.0 }); coreGlow.position.z = 0.03; g.add(coreGlow);
  return g;
}

/** 航路のホログラム（Gemini）：空中に投影された 8 の字の軌道・地球と月の球・星図の格子。走査線とちらつきは時刻の関数 */
export class Holo {
  constructor() {
    const g = (this.root = grp());
    const uT = (this.uT = uniform(0)), uK = (this.uK = uniform(1));
    const lem = (this.lem = (u) => { const th = Math.PI + u * TAU, den = 1 + Math.sin(th) ** 2; let x = (1.75 * Math.cos(th)) / den, y = (1.25 * Math.sin(th) * Math.cos(th)) / den; if (x > 0) { x *= 0.86; y *= 0.6; } return [x, y]; });
    const add = (geo, m) => { m.transparent = true; m.blending = THREE.AdditiveBlending; m.depthWrite = false; m.side = THREE.DoubleSide; m.fog = false; const o = new THREE.Mesh(geo, m); o.frustumCulled = false; o.castShadow = false; o.receiveShadow = false; o.layers.set(FX_LAYER); return o; };
    const flick = sin(uT.mul(47.0)).mul(sin(uT.mul(13.3))).mul(0.06).add(0.94);
    const C1 = color(0x4f8dff), C2 = color(0xa56bff), C3 = color(0xff7ac8), CW = color(0xfff3d6);
    // ---- 軌道の帯（描き進む先頭が光る）
    const ribbon = (w, gain) => {
      const N = 360, pos = [], uvs = [], idx = [];
      for (let i = 0; i <= N; i++) {
        const u = i / N, [x, y] = lem(u), [x2, y2] = lem(Math.min(1, u + 0.002)), [x1, y1] = lem(Math.max(0, u - 0.002));
        let tx = x2 - x1, ty = y2 - y1; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
        pos.push(x - ty * w / 2, y + tx * w / 2, 0, x + ty * w / 2, y - tx * w / 2, 0); uvs.push(u, -1, u, 1);
        if (i < N) { const q = i * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
      }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geo.setIndex(idx);
      const m = new THREE.MeshBasicNodeMaterial();
      const u = uv().x, s = uv().y;
      const on = smoothstep(-0.004, 0.004, uK.sub(u));
      const dh = uK.sub(u).mul(36.0), head = exp(dh.mul(dh).negate());
      const pulse = fract(u.mul(3.0).sub(uT.mul(0.6))).pow(6.0);
      const core = exp(s.mul(s).mul(-5.0));
      m.colorNode = mix(mix(mix(C1, C2, smoothstep(0.0, 0.5, u)), C3, smoothstep(0.5, 1.0, u)), CW, max(pulse, head).mul(0.8)).mul(gain);
      m.opacityNode = core.mul(on).mul(float(0.5).add(pulse.mul(0.8)).add(head.mul(1.6))).mul(flick);
      return add(geo, m);
    };
    g.add(ribbon(0.03, 2.2), ribbon(0.2, 0.3));
    // ---- 道しるべの点（順に灯る）
    {
      const N = 40, P = new Float32Array(N * 4);
      for (let i = 0; i < N; i++) { const u = (i + 0.5) / N, [x, y] = lem(u); P.set([x, y, 0, u], i * 4); }
      const a = iattr(P), m = new THREE.MeshBasicNodeMaterial();
      const on = step(a.w, uK), tw = sin(uT.mul(5.0).add(a.w.mul(40.0))).mul(0.25).add(0.75);
      m.positionNode = positionLocal.mul(on).add(a.xyz);
      m.colorNode = mix(C1, CW, 0.55).mul(2.2).mul(tw);
      const dots = add(new THREE.SphereGeometry(0.016, 8, 6), m); dots.count = N; g.add(dots);
    }
    // ---- 球（地球と月）：経緯線・陸の輪郭・縁の光・走査線
    const globe = (R, cA, cB, landF, gridN) => {
      const m = new THREE.MeshBasicNodeMaterial();
      const P = positionLocal, n = P.div(R);
      const lat = asin(n.y.clamp(-1, 1)), lon = atan(n.x, n.z);
      const ln = (x, k) => { const f = abs(fract(x.mul(k / Math.PI).add(0.5)).sub(0.5)); return smoothstep(0.0, 0.06, f).oneMinus(); };
      const grid = max(ln(lon, gridN), ln(lat, gridN)).mul(smoothstep(1.35, 1.5, abs(lat)).oneMinus());
      const land = mx_fractal_noise_float(n.mul(landF).add(3.1), 4, 2.0, 0.55).add(0.04);
      const fill = smoothstep(0.0, 0.05, land), coast = smoothstep(0.0, 0.035, abs(land)).oneMinus();
      const dotsP = smoothstep(0.25, 0.4, abs(fract(lon.mul(26 / Math.PI)).sub(0.5))).oneMinus().mul(smoothstep(0.25, 0.4, abs(fract(lat.mul(26 / Math.PI)).sub(0.5))).oneMinus());
      const rim = abs(dot(normalView, positionViewDirection)).clamp(0, 1).oneMinus().pow(2.2);
      const scan = sin(P.y.mul(300.0 / (R / 0.3)).add(uT.mul(5.0))).mul(0.2).add(0.8);
      m.colorNode = mix(cA, cB, fill.mul(0.7).add(rim.mul(0.5))).mul(1.9);
      m.opacityNode = grid.mul(0.42).add(fill.mul(dotsP).mul(0.55)).add(coast.mul(0.6)).add(rim.mul(0.85)).add(0.04).mul(scan).mul(flick);
      return add(new THREE.SphereGeometry(R, 56, 36), m);
    };
    const earth = (this.earth = globe(0.3, color(0x2f7dff), color(0x8fe9ff), 2.3, 12)); earth.position.x = -0.98;
    const moon = (this.moon = globe(0.13, color(0x9aa6c0), color(0xf2f4f8), 4.5, 8)); moon.position.x = 0.92;
    g.add(earth, moon);
    // ---- 周回の輪（流れる破線）
    const ring = (R, x, tiltX, tiltZ, col, sp) => {
      const m = new THREE.MeshBasicNodeMaterial();
      const a = atan(positionLocal.x, positionLocal.z);
      m.colorNode = col.mul(1.8);
      m.opacityNode = smoothstep(0.35, 0.5, fract(a.mul(14 / TAU).sub(uT.mul(sp)))).mul(0.7).add(0.12).mul(flick);
      const o = add(new THREE.TorusGeometry(R, 0.004, 5, 96).rotateX(HP), m); o.position.x = x; o.rotation.set(tiltX, 0, tiltZ); return o;
    };
    g.add(ring(0.42, -0.98, 0.5, 0.25, C1, 0.35), ring(0.2, 0.92, 0.7, -0.3, C3, -0.5));
    // ---- 星図の格子（うしろの面）と、下からの投影の光
    {
      const m = new THREE.MeshBasicNodeMaterial();
      const p = positionLocal.xy;
      const gl = (x) => smoothstep(0.0, 0.035, abs(fract(x.mul(1 / 0.35).add(0.5)).sub(0.5))).oneMinus();
      const fade = smoothstep(0.55, 1.0, length(p.div(vec2(2.3, 1.4)))).oneMinus();
      const cell = p.mul(9.0), ci = cell.floor(), cf = fract(cell).sub(0.5);
      const h = fract(sin(dot(ci, vec2(127.1, 311.7))).mul(43758.5453));
      const star = smoothstep(0.02, 0.09, length(cf.sub(vec2(h.sub(0.5).mul(0.6), fract(h.mul(7.3)).sub(0.5).mul(0.6))))).oneMinus().mul(step(0.72, h)).mul(sin(uT.mul(3.0).add(h.mul(40.0))).mul(0.4).add(0.6));
      const ds = p.y.sub(sin(uT.mul(0.9)).mul(1.3)).mul(3.0), sweep = exp(ds.mul(ds).negate());
      m.colorNode = mix(C1, CW, star).mul(1.5);
      m.opacityNode = max(gl(p.x), gl(p.y)).mul(0.16).add(star.mul(0.8)).add(sweep.mul(0.07)).mul(fade).mul(flick);
      const o = add(new THREE.PlaneGeometry(4.6, 2.8), m); o.position.z = -0.28; g.add(o);
      const bm = new THREE.MeshBasicNodeMaterial();
      const v = uv().y, ang = atan(positionLocal.x, positionLocal.z);
      bm.colorNode = mix(C1, C2, v).mul(1.2);
      bm.opacityNode = v.mul(v).mul(0.022).mul(mx_noise_float(vec3(ang.mul(9.0), uT.mul(0.7), 1.0)).mul(0.9).add(0.5).clamp(0, 1)).mul(flick);
      const cone = add(new THREE.CylinderGeometry(1.75, 0.08, 1.25, 40, 1, true), bm); cone.position.set(0, -0.72, 0.0); cone.scale.z = 0.35; g.add(cone);
    }
    // ---- 宇宙船の印（軌道の先頭）
    this.ship = glowSprite(0xfff3d6, 0.24, { gain: 1.4, pow: 2.2 }); g.add(this.ship);
    this.reset();
  }
  reset() { this.root.visible = false; this.root.position.set(0, 0, 0); this.root.rotation.set(0, 0, 0); this.root.scale.setScalar(1); }
  show(T, k = 1) {
    this.root.visible = true; this.uT.value = T; this.uK.value = k; this.earth.rotation.y = T * 0.5; this.moon.rotation.y = T * 0.3;
    const [x, y] = this.lem(Math.min(1, Math.max(0, k))); this.ship.position.set(x, y, 0.01); this.ship.visible = k > 0.005 && k < 0.999;
    return this;
  }
}

// ---------------------------------------------------------------------
// 大きなエンジン（Grok が運ぶ）：サターンの F-1 と同じ作り。台車に載せてある
// ---------------------------------------------------------------------
const E_EXT = [[0.63, 0.0], [0.615, 0.085], [0.583, 0.21], [0.54, 0.357], [0.494, 0.504], [0.454, 0.63]];
const E_UP = [[0.454, 0.63], [0.404, 0.777], [0.352, 0.924], [0.3, 1.06], [0.25, 1.187], [0.205, 1.29], [0.165, 1.37], [0.152, 1.43]];
const E_CH = [[0.152, 1.43], [0.172, 1.48], [0.215, 1.54], [0.215, 1.7], [0.19, 1.76], [0.12, 1.8], [0.12, 1.86], [0.0, 1.87]];
let engineGeo = null;
export function makeEngine() {
  if (!engineGeo) {
    const b = new Bag2(), f = new Bag2();
    const Y = 0.15, up = (geo) => geo.translate(0, Y, 0);
    // 延長ノズル（補強の帯）
    b.add(up(latheOf(E_EXT, 44)), 0x4d4741, 0.5, 0.85);
    b.add(up(latheOf([...E_EXT, ...E_UP.slice(1)], 36, -0.014)), 0x0f0d0c, 0.85, 0.2);
    for (const yy of [0.014, 0.16, 0.3, 0.45, 0.6]) b.add(up(hoop(rAt(E_EXT, yy) + 0.006, yy, yy < 0.02 ? 0.016 : 0.011, 44, 6)), 0x3a3632, 0.5, 0.85);
    // 断熱の箔で包んだ上半分・排気の環・のど・燃焼室
    f.add(up(crinkle(latheOf(E_UP, 22), 0.02)), 0xa4a8ae, 0.56, 1.0);
    f.add(up(crinkle(hoop(0.485, 0.665, 0.063, 22, 7), 0.012)), 0xa4a8ae, 0.56, 1.0);
    for (const yy of [0.84, 1.03, 1.22]) b.add(up(hoop(rAt(E_UP, yy) + 0.012, yy, 0.009, 24, 5)), 0x55585e, 0.5, 0.8);
    b.add(up(latheOf(E_CH, 28)), 0x8d9096, 0.38, 0.9);
    for (let i = 0; i < 16; i++) b.add(up(atAz(xf(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 6), { r: [HP, 0, 0] }), (i / 16) * TAU, 0.218, 1.7)), ...DARKM);
    // 首振りの付け根
    b.add(up(new THREE.CylinderGeometry(0.1, 0.12, 0.09, 16).translate(0, 1.91, 0)), ...STEEL);
    b.add(up(new THREE.BoxGeometry(0.3, 0.05, 0.3).translate(0, 1.975, 0)), ...DARKM);
    // ターボポンプ（横）と、排気の環へ下りる太い管、推進剤の管
    b.add(up(new THREE.CylinderGeometry(0.13, 0.13, 0.46, 16).translate(0.4, 1.47, 0)), 0x9da1a8, 0.38, 0.9);
    b.add(up(new THREE.CylinderGeometry(0.17, 0.17, 0.09, 18).translate(0.4, 1.2, 0)), 0x8d9096, 0.4, 0.9);
    b.add(up(new THREE.SphereGeometry(0.13, 14, 8, 0, TAU, 0, HP).translate(0.4, 1.7, 0)), 0x9da1a8, 0.38, 0.9);
    f.add(up(crinkle(rod([0.44, 1.16, 0.0], [0.5, 0.7, 0.0], 0.06, 8), 0.008)), 0xa4a8ae, 0.56, 1.0);
    b.add(up(rod([0.33, 1.6, 0.08], [0.12, 1.8, 0.1], 0.045, 8)), 0xb07a3a, 0.4, 0.9);
    b.add(up(rod([0.33, 1.52, -0.09], [0.14, 1.64, -0.16], 0.04, 8)), 0xb07a3a, 0.4, 0.9);
    b.add(up(rod([-0.2, 1.62, 0.12], [-0.42, 1.2, 0.2], 0.03, 6)), ...STEEL);
    b.add(up(rod([-0.42, 1.2, 0.2], [-0.46, 0.72, 0.16], 0.03, 6)), ...STEEL);
    for (let i = 0; i < 5; i++) { const a = 1.6 + i * 0.75; b.add(up(rod([Math.cos(a) * 0.46, 0.66, Math.sin(a) * 0.46], [Math.cos(a) * 0.2, 1.42, Math.sin(a) * 0.2], 0.01, 4)), 0xb07a3a, 0.4, 0.9); }
    // 台車：角パイプの枠・受けの輪・車輪
    const F = 0.72;
    for (const s of [-1, 1]) { b.add(new THREE.BoxGeometry(F * 2, 0.05, 0.05).translate(0, 0.11, s * F), 0xc9a227, 0.5, 0.3); b.add(new THREE.BoxGeometry(0.05, 0.05, F * 2).translate(s * F, 0.11, 0), 0xc9a227, 0.5, 0.3); }
    b.add(hoop(0.66, 0.145, 0.028, 40, 6), 0xc9a227, 0.5, 0.3);
    for (let i = 0; i < 4; i++) { const a = i * HP + Math.PI / 4; b.add(rod([Math.cos(a) * 0.66, 0.145, Math.sin(a) * 0.66], [Math.cos(a) * F * 1.4, 0.11, Math.sin(a) * F * 1.4], 0.022, 6), 0xc9a227, 0.5, 0.3); }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      b.add(xf(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 14), { r: [HP, 0, 0], p: [sx * F, 0.06, sz * F] }), ...RUBBER);
      b.add(new THREE.BoxGeometry(0.03, 0.06, 0.07).translate(sx * F, 0.1, sz * F), ...DARKM);
    }
    engineGeo = [b.mesh(partMaterial()).geometry, f.mesh(foilMaterial()).geometry];
  }
  const m1 = new THREE.Mesh(engineGeo[0], partMaterial()), m2 = new THREE.Mesh(engineGeo[1], foilMaterial());
  for (const m of [m1, m2]) { m.castShadow = true; m.receiveShadow = true; }
  return grp(m1, m2);
}

/** 「5」と書いた札（Claude が掲げる）：丸い鉄板の標識と木の柄 */
export function makeSign(txt = '5', bg = '#f4f1e6', fg = '#c8281e') {
  const g = grp();
  const t = canvasTex(256, 256, (ctx) => {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = fg; ctx.lineWidth = 26; ctx.beginPath(); ctx.arc(128, 128, 104, 0, 7); ctx.stroke();
    ctx.fillStyle = '#1b1c20'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.font = `900 ${txt.length > 1 ? 104 : 150}px ${FONT}`;
    const mt = ctx.measureText(txt); ctx.fillText(txt, 128, 128 + (mt.actualBoundingBoxAscent - mt.actualBoundingBoxDescent) / 2);
    const r = mulberry(55); ctx.strokeStyle = 'rgba(90,70,40,0.25)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 26; i++) { const x = r() * 256, y = r() * 256; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * 40, y + (r() - 0.5) * 14); ctx.stroke(); }
  });
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.3, 40), new THREE.MeshStandardNodeMaterial({ map: t, roughness: 0.45, metalness: 0.2 }));
  face.position.set(0, 0.62, 0.007); face.castShadow = true; g.add(face);
  const b = new Bag2(), w = new Bag2();
  b.add(xf(new THREE.CylinderGeometry(0.31, 0.31, 0.012, 40), { r: [HP, 0, 0], p: [0, 0.62, 0] }), 0x8d9096, 0.45, 0.8);
  b.add(new THREE.BoxGeometry(0.1, 0.16, 0.012).translate(0, 0.5, -0.012), ...DARKM);
  for (const y of [0.45, 0.55]) b.add(xf(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 6), { r: [HP, 0, 0], p: [0, y, -0.02] }), ...STEEL);
  w.add(new THREE.BoxGeometry(0.05, 0.62, 0.03, 1, 4, 1).translate(0, 0.16, -0.03), 0x9b6b3f, 0.8, 0);
  g.add(b.mesh(partMaterial()), w.mesh(woodMaterial('y')));
  return g;
}

/** 木箱（机がわり）：板を打ちつけた箱。中心が原点、1 辺 0.62 */
export function makeCrate() {
  const S = 0.62, h = S / 2, wy = new Bag2(), wx = new Bag2(), b = new Bag2();
  const W1 = 0xa9773f, W2 = 0x93653a, W3 = 0x7d5630;
  for (let k = 0; k < 4; k++) {
    const a = k * HP;
    for (let i = 0; i < 5; i++) wy.add(atAz(new THREE.BoxGeometry(0.112, S - 0.02, 0.016), a, h - 0.008, 0).applyMatrix4(new THREE.Matrix4().makeTranslation(Math.cos(a) * (-0.24 + i * 0.12), 0, -Math.sin(a) * (-0.24 + i * 0.12))), i % 2 ? W1 : W2, 0.82, 0);
    for (const y of [-0.24, 0.24]) wx.add(atAz(new THREE.BoxGeometry(S + 0.01, 0.085, 0.02), a, h + 0.008, y), W3, 0.82, 0);
    for (const y of [-0.24, 0.24]) for (const x of [-0.26, -0.13, 0, 0.13, 0.26]) b.add(atAz(xf(new THREE.CylinderGeometry(0.007, 0.007, 0.004, 6), { r: [HP, 0, 0], p: [x, 0, 0] }), a, h + 0.019, y), 0x3a3c40, 0.5, 0.8);
  }
  for (let i = 0; i < 5; i++) wx.add(new THREE.BoxGeometry(S, 0.016, 0.112).translate(0, h - 0.004, -0.24 + i * 0.12), i % 2 ? W2 : W1, 0.82, 0);
  wx.add(new THREE.BoxGeometry(S, 0.016, S).translate(0, -h + 0.008, 0), W3, 0.85, 0);
  const g = grp(wy.mesh(woodMaterial('y')), wx.mesh(woodMaterial('x')), b.mesh(partMaterial()));
  const t = canvasTex(256, 128, (ctx) => { ctx.clearRect(0, 0, 256, 128); ctx.fillStyle = 'rgba(30,24,18,0.82)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `900 44px ${FONT}`; ctx.fillText('FRAGILE', 128, 44); ctx.font = `900 24px ${FONT}`; ctx.fillText('AI SPACE LAB', 128, 96); });
  const dm = new THREE.MeshStandardNodeMaterial({ map: t, transparent: true, roughness: 0.9 }); dm.polygonOffset = true; dm.polygonOffsetFactor = -2;
  const d = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.2), dm); d.position.set(0, 0, h + 0.001); d.castShadow = false; g.add(d);
  return g;
}

/** 設計図の紙（1.5×1.0）：折り目と反りのある紙に、青焼きの図 */
export function makeSheet(map) {
  const geo = new THREE.PlaneGeometry(1.5, 1.0, 18, 12), p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    const fold = 0.006 * (Math.abs(Math.abs(x) - 0.25) < 0.26 ? 1 - Math.abs(Math.abs(x) - 0.25) / 0.26 : 0) + 0.005 * (1 - Math.min(1, Math.abs(y) / 0.5));
    const curl = 0.02 * Math.pow(Math.max(0, Math.abs(x) / 0.75 - 0.72) / 0.28, 2) + 0.012 * Math.pow(Math.max(0, Math.abs(y) / 0.5 - 0.7) / 0.3, 2);
    p.setZ(i, fold + curl + 0.002 * Math.sin(x * 9 + y * 7));
  }
  geo.computeVertexNormals();
  const m = new THREE.MeshStandardNodeMaterial(); m.side = THREE.DoubleSide; m.metalness = 0;
  const pp = paperNodes(positionLocal);
  const crease = smoothstep(0.0, 0.006, abs(abs(positionLocal.x).sub(0.25))).mul(smoothstep(0.0, 0.006, abs(positionLocal.y))).mul(0.12).add(0.88);
  m.colorNode = texture(map, uv()).rgb.mul(pp.tone).mul(crease);
  m.roughnessNode = float(0.84); m.normalNode = tilt(normalView, pp.bump, 0.07);
  const s = new THREE.Mesh(geo, m); s.castShadow = true; s.receiveShadow = true;
  return s;
}
