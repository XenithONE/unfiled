// 役者の共通部分：置く・向く・つぶす・すす汚れ・宇宙用の金魚鉢ヘルメット
// 質感は「実物の造形物を実写で撮った」ように見せる：物理ベースの素材（塗膜・艶・細かな肌）と、環境の映り込み。
import * as THREE from 'three/webgpu';
import {
  uniform, mix, color, normalView, positionViewDirection, vec3, smoothstep, normalize, float, positionLocal, positionView,
  dFdx, dFdy, cross, dot, sign, abs, fwidth, length, mx_noise_float, transformNormalToView, output, vec4,
} from 'three/tsl';
import { mat, mergeGeometries } from '../core/kit.js';
import { clamp } from '../core/util.js';
import { FX_LAYER } from '../core/engine.js';

export const SOOT = 0x0c0c0e;

/** 手続きの高さから法線を作る（view 空間）。細かな肌・溝・ゆがみ用。N = 土台の法線 */
export function bumpN(h, scale = 1, N = normalView) {
  const dpdx = dFdx(positionView), dpdy = dFdy(positionView);
  const dhdx = dFdx(h), dhdy = dFdy(h);
  const r1 = cross(dpdy, N), r2 = cross(N, dpdx);
  const det = dot(dpdx, r1);
  const grad = sign(det).mul(dhdx.mul(r1).add(dhdy.mul(r2)));
  return normalize(abs(det).mul(N).sub(grad.mul(scale)));
}
/**
 * 艶の明るさを頭打ちにする。太陽や近くの灯りの「点」の反射は計算上は数千倍の明るさになり、
 * にじみや光条の後処理で画面が白く飛んだり点の列になったりするので、カメラの撮像素子のように上限を置く。
 */
export function capOutput(m, cap = 10) { m.outputNode = vec4(output.rgb.min(vec3(cap)), output.a); return m; }
/** 球の正確な法線（view 空間）。メッシュの原点が球の中心のとき。分割の粗さによらず、艶と映り込みがなめらかになる */
export const sphereN = () => transformNormalToView(normalize(positionLocal));
/** 画面上で細かすぎる模様を消す係数（遠くでのちらつき防止）。q = 模様の座標（周期が 1 になる倍率を掛けたもの） */
export const detailFade = (q) => smoothstep(0.22, 0.75, length(fwidth(q))).oneMinus();

/**
 * すす汚れに対応した素材（soot=1 でほぼ真っ黒のつや消し）。
 * o: rough / roughNode, metal, colorNode, emissiveNode, rim…, clearcoat, clearcoatRough, sheen（色）, sheenAmt, sheenRough, specular, normalNode
 */
export function sootMat(sootU, hex, o = {}) {
  const phys = o.clearcoat !== undefined || o.sheen !== undefined || o.specular !== undefined;
  const m = phys ? new THREE.MeshPhysicalNodeMaterial() : new THREE.MeshStandardNodeMaterial();
  const clean = sootU.oneMinus();
  m.roughnessNode = mix(o.roughNode || float(o.rough ?? 0.68), float(0.93), sootU.mul(0.92));
  m.metalness = o.metal ?? 0;
  const base = o.colorNode || color(hex);
  m.colorNode = mix(base, color(SOOT), sootU.mul(0.97));
  let em = o.emissiveNode || null;
  if (o.rim) {
    const ndv = normalView.dot(positionViewDirection).saturate();
    const rim = color(o.rim).mul(ndv.oneMinus().pow(o.rimPow ?? 3.0).mul(o.rimAmt ?? 0.35));
    em = em ? em.add(rim) : rim;
  }
  if (em) m.emissiveNode = o.sootKeepsGlow ? em : em.mul(clean);
  if (o.clearcoat !== undefined) { m.clearcoatNode = float(o.clearcoat).mul(clean); m.clearcoatRoughnessNode = o.clearcoatRoughNode || float(o.clearcoatRough ?? 0.05); }
  if (o.sheen !== undefined) { m.sheenNode = color(o.sheen).mul(o.sheenAmt ?? 1).mul(clean); m.sheenRoughnessNode = float(o.sheenRough ?? 0.5); }
  if (o.specular !== undefined) m.specularIntensity = o.specular;      // 反射の強さ（反射防止の膜など）
  if (o.normalNode) m.normalNode = o.normalNode;
  return capOutput(m, o.cap ?? 9);
}

/**
 * 金魚鉢ヘルメット：薄いガラスの球＋首の金属の輪。
 * ガラスは「透過（縁ほど背景が暗くなる）」と「反射（空・地面・太陽の映り込みを足す）」の 2 層で描く。
 */
export function makeHelmet(r, cy, cutY = null) {
  const g = new THREE.Group();
  const theta = cutY === null ? Math.PI : Math.acos(clamp((cutY - cy) / r, -1, 1));
  const geo = new THREE.SphereGeometry(r, 64, 40, 0, Math.PI * 2, 0, theta);
  const nS = sphereN();
  const ndv = nS.dot(positionViewDirection).abs().saturate();
  const F = ndv.oneMinus().pow(5.0).mul(0.96).add(0.04);              // ガラスの反射率（正面 4% → 縁 100%）
  // 手でふいた跡のような、粗さのむら
  const sq = positionLocal.mul(4.2 / r);
  const smudge = smoothstep(0.0, 0.8, mx_noise_float(sq));          // ゆるいむらだけ（細かい筋を入れると艶が点の列に割れる）
  const layer = (m, order, scale = 1) => { const d = new THREE.Mesh(geo, m); d.position.y = cy; d.scale.setScalar(scale); d.renderOrder = order; d.layers.set(FX_LAYER); d.castShadow = false; d.receiveShadow = false; g.add(d); return d; };
  // 1) 透過：縁ほど向こうが暗くなり、ガラスの厚みの分だけわずかに青緑がかる
  const tm = new THREE.MeshBasicNodeMaterial();
  tm.transparent = true; tm.depthWrite = false;
  tm.colorNode = vec3(0.3, 0.36, 0.44);                               // 縁に残るごく弱い照り返し（暗い船内や宇宙でも形が読める）
  tm.opacityNode = F.mul(0.42).add(0.022).add(smudge.mul(0.02));
  layer(tm, 20);
  // 2) 反射：物理ベースの鏡面だけを加算する（拡散は 0）。内側の面の映り込みも薄く重ねる
  const refl = (side, gain) => {
    const m = new THREE.MeshStandardNodeMaterial();
    m.transparent = true; m.depthWrite = false; m.blending = THREE.AdditiveBlending; m.side = side; m.fog = false;
    m.normalNode = side === THREE.BackSide ? nS.negate() : nS;
    m.colorNode = vec3(0); m.metalness = 0; m.roughnessNode = smudge.mul(0.08).add(0.085);    // 鋭すぎる艶は近くの灯りで白飛びするので下限を置く
    m.opacity = gain;
    return capOutput(m, 5.5);
  };
  layer(refl(THREE.BackSide, 0.6), 21, 0.985);
  layer(refl(THREE.FrontSide, 1.35), 22);
  if (cutY !== null) {
    const cr = Math.sqrt(Math.max(0.0001, r * r - (cutY - cy) ** 2));
    // 首の輪：削り出しのアルミの断面を回した形＋黒いゴムの帯＋留め具
    const prof = [[-0.022, -0.03], [0.034, -0.03], [0.046, -0.018], [0.046, 0.01], [0.032, 0.028], [0.012, 0.035], [-0.006, 0.03], [-0.022, 0.03], [-0.022, -0.03]];
    const ring = new THREE.Mesh(new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(cr + x, y)), 72), mat(0xdfe3e8, { rough: 0.32, metal: 0.7 }));
    ring.position.y = cutY; ring.castShadow = true; ring.receiveShadow = true;
    const seal = new THREE.Mesh(new THREE.TorusGeometry(cr + 0.002, 0.013, 8, 64), mat(0x16181b, { rough: 0.85 }));
    seal.rotation.x = Math.PI / 2; seal.position.y = cutY + 0.034; seal.castShadow = false;
    const lugs = [];
    for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + (i * Math.PI) / 2; const b = new THREE.BoxGeometry(0.07, 0.034, 0.028); b.translate(0, -0.006, cr + 0.05); b.rotateY(a); lugs.push(b); }
    const lug = new THREE.Mesh(mergeGeometries(lugs), mat(0x39424e, { rough: 0.45, metal: 0.8 }));
    lug.position.y = cutY; lug.castShadow = true;
    g.add(ring, seal, lug);
  }
  g.visible = false;
  return g;
}

export class Actor {
  constructor(name) {
    this.name = name;
    this.root = new THREE.Group(); this.root.name = name;
    this.body = new THREE.Group(); this.root.add(this.body);
    this.sootU = uniform(0);
    this.helmet = null;
    this.seed = 0;
    this.autoBlink = true;
    this.breathe = true;
  }
  reset() {
    const r = this.root;
    r.visible = false; r.position.set(0, 0, 0); r.rotation.set(0, 0, 0); r.scale.setScalar(1);
    const b = this.body;
    b.position.set(0, 0, 0); b.rotation.set(0, 0, 0); b.scale.set(1, 1, 1);
    this.sootU.value = 0;
    if (this.helmet) this.helmet.visible = false;
    this.autoBlink = true; this.breathe = true;
    this._blinkMul = 1;
    this.pose0();
  }
  pose0() {}
  finish() {}
  /** 置く（向き yaw は +Z が正面・ラジアン） */
  at(x, y, z, yaw) { this.root.visible = true; this.root.position.set(x, y, z); if (yaw !== undefined) this.root.rotation.y = yaw; return this; }
  yaw(a) { this.root.rotation.y = a; return this; }
  /** 水平面の点 (x,z) の方を向く */
  faceTo(x, z) { this.root.rotation.y = Math.atan2(x - this.root.position.x, z - this.root.position.z); return this; }
  /** つぶし・のばし（s<1 でつぶれる） */
  squash(s) { const k = 1 / Math.sqrt(Math.max(0.05, s)); this.body.scale.set(k, s, k); return this; }
  lean(rx = 0, rz = 0) { this.body.rotation.x = rx; this.body.rotation.z = rz; return this; }
  lift(y) { this.body.position.y = y; return this; }
  soot(v) { this.sootU.value = v; return this; }
  helm(on = true) { if (this.helmet) this.helmet.visible = on; return this; }
  size(s) { this.root.scale.setScalar(s); return this; }
  hide() { this.root.visible = false; return this; }
  get x() { return this.root.position.x; } get y() { return this.root.position.y; } get z() { return this.root.position.z; }
}
