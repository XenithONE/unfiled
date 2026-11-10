// 発射施設（アポロ時代のケネディ宇宙センター 39 番射点を手本に）
//   台地（ハードスタンド）と火炎溝・火炎偏向板／移動式発射台（ML）／発射塔（LUT）と 9 本のスイングアーム／
//   頂上のハンマーヘッドクレーン／投光器の塔／球形タンクと配管／建屋・柵・クローラーウェイ
//   画像は使わない。形状は素材ごとに 1 つのメッシュへまとめ、質感（塗装のはがれ・さび・すす・目地）は位置から計算する。
//   縮尺はロケットに合わせる（1 ≒ 3.5 m）。手すりや階段は「実物の大きさ」にして、構造物の大きさが伝わるようにする。
import * as THREE from 'three/webgpu';
import {
  positionLocal, normalLocal, normalView, positionViewDirection, uv, uniform, mx_cell_noise_float,
  mix, color, vec2, vec3, float, max, min, fract, floor, step, smoothstep, length, texture, fwidth, sin,
} from 'three/tsl';
import { beamGeo, mergeGeometries, canvasTex, glow, mat, trussList } from '../core/kit.js';
import { bumpNormal, PAD } from './terrain.js';
import { glowSprite } from '../fx/fx.js';
import { FX_LAYER } from '../core/engine.js';
import { pixText } from '../core/pixfont.js';
import { SAT } from '../props/saturn.js';

// ---- 寸法（発射台の中心＝ロケットの真下が原点。+X がクローラーウェイ側、-X が塔側、溝は X 方向に走る）
const HS = 3.6;                       // 台地（ハードスタンド）の上面
const PED = 1.9;                      // 発射台を支える柱の高さ
const MLH = 2.2;                      // 移動式発射台の箱の厚み
export const DECK = HS + PED + MLH;   // 発射台の床（ロケットが立つ高さ）＝ 7.7
export const TOWER_X = -5.6;          // 塔の中心
const MLB = HS + PED;                 // 発射台の底
const ML = { x0: -8.8, x1: 5.6, z: 5.9 };
const HOLE = 1.95;                    // 炎の穴（半幅）
const TR = 2.6;                       // 火炎溝（半幅）
const TOPX = 19, TOPZ = 15, RUN = 6.5;            // 台地の上面の半分の大きさ・斜面の水平距離
const LANE0 = 3.4, LANE1 = 8.2, RAMPX = 45, BED = 0.3;   // クローラーウェイの坂（+X）と砂利の盛り
const VRX = 3.5, VRZ = 33;                        // 作業車の坂（+Z）
const TH = 36, LV = 2.4, TW = 1.7;                // 塔の高さ・階の間隔・半幅
const P = positionLocal, NL = normalLocal;

/** 台地・坂の高さ（発射台の座標） */
export function moundH(x, z) {
  const ax = Math.abs(x), az = Math.abs(z);
  let h = HS * Math.min(1, Math.max(0, Math.min((TOPX + RUN - ax) / RUN, (TOPZ + RUN - az) / RUN)));
  if (x > TOPX && x < RAMPX && az > LANE0 && az < LANE1) h = Math.max(h, HS + (BED - HS) * (x - TOPX) / (RAMPX - TOPX));
  if (ax < VRX && z > TOPZ && z < VRZ) h = Math.max(h, HS * (VRZ - z) / (VRZ - TOPZ));
  return h;
}

/** 流体シミュレーション用：世界座標 pw が固体なら 1（台地〈溝をのぞく〉と発射台の箱〈穴をのぞく〉） */
export function padSolid(pw) {
  const x = pw.x.sub(PAD[0]), y = pw.y, z = pw.z.sub(PAD[2]);
  const ax = x.abs(), az = z.abs();
  const mound = min(float(TOPX + RUN).sub(ax), float(TOPZ + RUN).sub(az)).div(RUN).clamp(0, 1).mul(HS);
  const lane = step(TOPX, x).mul(step(x, RAMPX)).mul(step(LANE0, az)).mul(step(az, LANE1)).mul(float(RAMPX).sub(x).div(RAMPX - TOPX).mul(HS));
  const ramp = step(ax, VRX).mul(step(TOPZ, z)).mul(step(z, VRZ)).mul(float(VRZ).sub(z).div(VRZ - TOPZ).mul(HS));
  const inMound = step(y, max(mound, max(lane, ramp)).sub(0.05)).mul(step(TR, az));
  const inML = step(ML.x0, x).mul(step(x, ML.x1)).mul(step(az, ML.z)).mul(step(MLB - 0.4, y)).mul(step(y, DECK));
  const hole = step(ax, 3.3).mul(step(az, 3.3));
  // 発射台の下のすき間は、手前と奥（±Z）をふさいで扱う：噴流は溝に沿って左右（±X）へ抜ける
  const skirt = step(HS - 0.1, y).mul(step(y, MLB)).mul(step(ML.x0 - 0.6, x)).mul(step(x, ML.x1 + 0.6)).mul(step(ML.z - 0.7, az)).mul(step(az, ML.z + 0.9));
  return max(max(inMound, skirt), inML.mul(hole.oneMinus()));
}

// =====================================================================
// 形を貯める袋：素材の名前ごとに形を集め、最後に 1 素材 1 メッシュへまとめる
// =====================================================================
const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
class Bag {
  constructor() { this.map = new Map(); this.xf = null; }
  put(key, g) {
    if (this.xf) g.applyMatrix4(this.xf);
    let a = this.map.get(key);
    if (!a) this.map.set(key, (a = []));
    a.push(g);
    return this;
  }
  /** 以後に足す形を、この位置・向き（ry→rx の順）へ置く */
  at(x, y, z, ry = 0, rx = 0) {
    this.xf = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0, 'YXZ')), new THREE.Vector3(1, 1, 1));
    return this;
  }
  home() { this.xf = null; return this; }
  box(key, w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx || ry || rz) g.applyMatrix4(_m.makeRotationFromEuler(_e.set(rx, ry, rz)));
    g.translate(x, y, z);
    return this.put(key, g);
  }
  beam(key, a, b, t = 0.1, t2 = t) { return this.put(key, beamGeo(a, b, t, t2)); }
  tube(key, a, b, r = 0.05, seg = 8, r2 = r) {
    const A = new THREE.Vector3(...a), d = new THREE.Vector3(...b).sub(A), len = d.length();
    const g = new THREE.CylinderGeometry(r2, r, len, seg, 1, false);
    g.applyQuaternion(_q.setFromUnitVectors(UP, d.clone().normalize()));
    g.translate(A.x + d.x / 2, A.y + d.y / 2, A.z + d.z / 2);
    return this.put(key, g);
  }
  sph(key, r, x, y, z, ws = 28, hs = 18) { const g = new THREE.SphereGeometry(r, ws, hs); g.translate(x, y, z); return this.put(key, g); }
  geo(key, g) { return this.put(key, g); }
  /** 四角い面（頂点 4 つ）。hint の向きが表になる。 */
  quad(key, a, b, c, d, hint = [0, 1, 0]) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), C = new THREE.Vector3(...c), D = new THREE.Vector3(...d);
    const n = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(D, A));
    if (n.lengthSq() < 1e-12) n.subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A));
    n.normalize();
    let V = [A, B, C, D];
    if (n.dot(new THREE.Vector3(...hint)) < 0) { n.negate(); V = [A, D, C, B]; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(V.flatMap((p) => [p.x, p.y, p.z]), 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 2, 3].flatMap(() => [n.x, n.y, n.z]), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    return this.put(key, g);
  }
  /** まとめてメッシュにする（名前に ":nc" を付けた分は影を落とさない） */
  build(M, group) {
    for (const [key, geos] of this.map) {
      const [mk, flag] = key.split(':');
      if (!M[mk]) throw new Error('pad.js: 素材がありません: ' + mk);
      const mesh = new THREE.Mesh(mergeGeometries(geos, false), M[mk]);
      mesh.castShadow = flag !== 'nc'; mesh.receiveShadow = true;
      mesh.name = 'pad.' + key;
      group.add(mesh);
    }
    return group;
  }
}

/** 手すり（柱＋横 2 本） */
function rail(B, a, b, sp = 0.9, h = 0.34, key = 'galv:nc', t = 0.024) {
  const A = new THREE.Vector3(...a), D = new THREE.Vector3(...b).sub(A), n = Math.max(1, Math.round(D.length() / sp));
  for (let i = 0; i <= n; i++) { const p = A.clone().addScaledVector(D, i / n); B.beam(key, [p.x, p.y, p.z], [p.x, p.y + h, p.z], t); }
  for (const f of [0.5, 1]) B.beam(key, [a[0], a[1] + h * f, a[2]], [b[0], b[1] + h * f, b[2]], t);
}
/** 階段（側桁 2 本・踏み板・手すり） */
function stair(B, a, b, w = 0.5, n = 10, key = 'galv:nc') {
  const alongX = Math.abs(b[0] - a[0]) > Math.abs(b[2] - a[2]);
  const L = (f, o, dy = 0) => [a[0] + (b[0] - a[0]) * f + o[0], a[1] + (b[1] - a[1]) * f + dy, a[2] + (b[2] - a[2]) * f + o[2]];
  for (const s of [-1, 1]) {
    const o = alongX ? [0, 0, (s * w) / 2] : [(s * w) / 2, 0, 0];
    B.beam(key, L(0, o), L(1, o), 0.04, 0.11);
    B.beam(key, L(0, o, 0.32), L(1, o, 0.32), 0.022);
    for (const f of [0, 0.5, 1]) B.beam(key, L(f, o), L(f, o, 0.32), 0.022);
  }
  const run = Math.hypot(b[0] - a[0], b[2] - a[2]) / n;
  for (let i = 0; i < n; i++) {
    const p = L((i + 0.5) / n, [0, 0, 0]);
    if (alongX) B.box(key, run * 0.9, 0.02, w, p[0], p[1], p[2]); else B.box(key, w, 0.02, run * 0.9, p[0], p[1], p[2]);
  }
}
/** はしご */
function ladder(B, x, y0, y1, z, alongX = true, key = 'galv:nc') {
  const o = alongX ? [0.13, 0] : [0, 0.13];
  for (const s of [-1, 1]) B.beam(key, [x + s * o[0], y0, z + s * o[1]], [x + s * o[0], y1, z + s * o[1]], 0.022);
  for (let y = y0 + 0.08; y < y1; y += 0.1) B.beam(key, [x - o[0], y, z - o[1]], [x + o[0], y, z + o[1]], 0.014);
}
/** 配管（点をつないで管にし、曲がり角に球を置く。sup を渡すと支えを立てる） */
function pipeRun(B, key, pts, r, sup) {
  for (let i = 0; i < pts.length - 1; i++) {
    B.tube(key, pts[i], pts[i + 1], r, 10);
    if (i > 0) B.sph(key, r * 1.12, pts[i][0], pts[i][1], pts[i][2], 10, 8);
    if (sup) {
      const a = pts[i], b = pts[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), n = Math.max(1, Math.round(len / 2.6));
      for (let k = 0; k <= n; k++) {
        const f = (k + 0.5) / (n + 1), p = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
        const g = sup(p[0], p[2]);
        if (p[1] - g > 0.12 && p[1] - g < 1.4) { B.beam('galv:nc', [p[0], g, p[2]], [p[0], p[1] - r, p[2]], 0.05); B.box('galv:nc', r * 3.2, 0.03, r * 3.2, p[0], p[1] - r - 0.015, p[2]); }
      }
    }
  }
}

// =====================================================================
// 質感（どれも位置から計算する）
// =====================================================================
/** 面に沿った 2 次元の座標（壁：横×高さ／床や斜面：x×z） */
function faceUV() {
  const n = NL.abs();
  const isY = step(0.7, n.y);
  const isX = step(n.z, n.x).mul(isY.oneMinus());
  return { u: mix(mix(P.x, P.z, isX), P.x, isY), v: mix(P.y, P.z, isY), isY };
}
/** 間隔 s ごとの細い線（幅 w）。遠くでは太らせて薄め、ちらつきを防ぐ */
function gridLine(c, s, w) {
  const d = fract(c.div(s).sub(0.5)).sub(0.5).abs().mul(s);
  const ww = max(float(w), fwidth(c).mul(0.8));
  return smoothstep(ww.mul(0.35), ww, d).oneMinus().mul(float(w).div(ww).clamp(0, 1));
}
const fall = (a, b, x) => smoothstep(a, b, x).oneMinus();     // a 以下で 1、b 以上で 0

/**
 * 雑音のテクスチャ（タイル・256²）。R＝大きなむら、G＝中くらいのむら、B＝細かな粒、A＝別の大きなむら。
 * どの成分も 0..1 に一様にならしてあるので、しきい値がそのまま「面積の割合」になる。
 * 位置から毎回雑音を計算するより桁違いに軽く、遠くではミップマップで自然にならされる（ちらつかない）。
 */
let NZ = null;
function nzTex() {
  if (NZ) return NZ;
  const N = 256, data = new Uint8Array(N * N * 4);
  const rnd = (x, y, s) => { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  const vn = (x, y, f, s) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const a = rnd(xi % f, yi % f, s), b = rnd((xi + 1) % f, yi % f, s), c = rnd(xi % f, (yi + 1) % f, s), d = rnd((xi + 1) % f, (yi + 1) % f, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (px, py, f0, oct, s) => { let a = 1, sum = 0, n = 0, f = f0; for (let o = 0; o < oct; o++) { sum += vn(px * f, py * f, f, s + o * 17) * a; n += a; a *= 0.5; f *= 2; } return sum / n; };
  [[4, 4, 1], [6, 3, 2], [32, 2, 3], [5, 4, 4]].forEach(([f0, oct, seed], c) => {
    const vals = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) vals[y * N + x] = fbm(x / N, y / N, f0, oct, seed);
    const idx = new Uint32Array(N * N); for (let i = 0; i < idx.length; i++) idx[i] = i;
    idx.sort((p, q) => vals[p] - vals[q]);
    for (let r = 0; r < idx.length; r++) data[idx[r] * 4 + c] = Math.round((r / (idx.length - 1)) * 255);
  });
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.anisotropy = 4;
  t.needsUpdate = true;
  return (NZ = t);
}
const nz = (uvNode) => texture(nzTex(), uvNode);
/** 立体物（鉄骨・配管）用の 2 次元の座標 */
const p2 = () => vec2(P.x.add(P.z.mul(0.71)), P.y.add(P.z.mul(0.37)));

/** 塗装した鉄骨：色むら・はがれて出たさび・雨だれ・下ほどすすける */
function paintMat(hex, o = {}) {
  const m = new THREE.MeshStandardNodeMaterial();
  const q = p2();
  const n = nz(q.mul(0.085)).r, fine = nz(q.mul(1.9)).b;
  const rust = smoothstep(0.86, 0.985, nz(q.mul(vec2(0.31, 0.11)).add(0.37)).a).mul(o.rust ?? 0.45);
  let base = color(hex);
  if (o.band) base = mix(color(0xe6e3dc), color(0xb02a1d), step(0.5, fract(P.y.div(o.band).add(0.2))));
  const vary = o.vary ?? 0.24;
  let c = base.mul(n.mul(vary).add(1.0 - vary * 0.66)).mul(fine.mul(0.08).add(0.96));
  if (o.streak) c = c.mul(smoothstep(0.5, 0.9, nz(vec2(q.x.mul(0.4), P.y.mul(0.03))).g).mul(-0.35 * o.streak).add(1.0));
  c = mix(c, color(0x5b2f1b).mul(fine.mul(0.5).add(0.6)), rust);
  if (o.sootY !== undefined) c = c.mul(mix(float(0.5), float(1.0), smoothstep(o.sootY, o.sootY + 10.0, P.y)));
  m.colorNode = c;
  if (o.night) m.emissiveNode = c.mul(vec3(1.0, 0.82, 0.58)).mul(o.night).mul(o.lit ?? 0.3);      // 作業灯に照らされる
  m.roughnessNode = float(o.rough ?? 0.56).add(rust.mul(0.3)).add(n.mul(0.08));
  m.metalnessNode = float(o.metal ?? 0.2).mul(rust.oneMinus());
  return m;
}

/** 鋼板の箱：継ぎ目・リベット列・雨だれ・さび。deck は床（炎の穴のまわりがこげる）、text は側面の表記 */
function plateMat(o = {}) {
  const m = new THREE.MeshStandardNodeMaterial();
  const { u, v, isY } = faceUV();
  const su = o.su ?? 1.2, sv = o.sv ?? 0.74;
  const seam = max(gridLine(u, su, 0.011), gridLine(v, sv, 0.011));
  const du = fract(u.div(su).sub(0.5)).sub(0.5).abs().mul(su), dv = fract(v.div(sv).sub(0.5)).sub(0.5).abs().mul(sv);
  const rs = 0.09;
  const rivU = length(vec2(du.sub(0.045), fract(v.div(rs)).sub(0.5).mul(rs)));
  const rivV = length(vec2(dv.sub(0.045), fract(u.div(rs)).sub(0.5).mul(rs)));
  const near = fall(0.004, 0.016, fwidth(u).add(fwidth(v)));          // 近いときだけ細部を出す
  const rivet = fall(0.009, 0.015, min(rivU, rivV)).mul(near);
  const q = vec2(u, v);
  const n1 = nz(q.mul(0.09)).r, fine = nz(q.mul(1.7)).b;
  const streak = nz(vec2(u.mul(0.55), v.mul(0.04))).g;
  const rust = smoothstep(0.84, 0.985, nz(vec2(u.mul(0.33), v.mul(0.075)).add(0.41)).a.add(seam.mul(0.2))).mul(o.rust ?? 0.5);
  let c = color(o.hex ?? 0x7b8088).mul(n1.mul(0.2).add(0.87)).mul(fine.mul(0.07).add(0.965));
  c = c.mul(mix(smoothstep(0.45, 0.9, streak).mul(-0.3).add(1.0), float(1.0), isY));
  if (o.text) {
    // 側面（±Z）の表記：白い文字と、床のふちの黄黒のしま
    const front = step(0.0, NL.z);
    const ut = mix(float(ML.x1).sub(P.x), P.x.sub(ML.x0), front).div(ML.x1 - ML.x0);
    const t = texture(o.text, vec2(ut, P.y.sub(MLB).div(MLH)));
    const on = step(0.7, NL.z.abs());
    c = mix(c, color(0xd8d5cb), t.r.mul(on).mul(0.82));
    c = mix(c, color(0xc9a11c), t.g.mul(on).mul(0.9));
    c = mix(c, color(0x17181a), t.b.mul(on).mul(0.9));
  }
  c = mix(c, color(0x4a3024).mul(fine.mul(0.5).add(0.65)), rust);
  c = c.mul(seam.mul(-0.5).add(1.0)).mul(rivet.mul(0.12).add(1.0));
  let rough = float(0.6).add(rust.mul(0.25)).sub(n1.mul(0.1));
  if (o.deck) {
    const dHole = max(P.x.abs(), P.z.abs());
    const burn = fall(1.9, 6.8, dHole.add(n1.mul(1.8)));
    const ring = fall(0.0, 0.03, dHole.sub(2.42).abs().sub(0.06));       // 穴のふちの黄色い線
    c = mix(c, color(0xc79a1a), ring.mul(0.8));
    c = mix(c, color(0x111111), burn.mul(0.86));
    rough = rough.add(burn.mul(0.25));
  }
  m.colorNode = c;
  if (o.night && o.text) {
    // 側面：床のふちの下に並ぶ作業灯が、壁に光のたまりを落とす
    const dl = fract(P.x.sub(ML.x0 + 1.2).div(2.4).add(0.5)).sub(0.5).abs().mul(2.4);
    const pool = fall(0.0, 1.05, dl).mul(fall(0.0, 1.6, float(DECK - 0.2).sub(P.y))).mul(step(0.7, NL.z.abs()));
    m.emissiveNode = c.mul(vec3(1.0, 0.8, 0.52)).mul(pool).mul(o.night).mul(1.5);
  } else if (o.night) m.emissiveNode = c.mul(vec3(0.95, 0.9, 0.8)).mul(o.night).mul(o.lit ?? 0.3);
  m.roughnessNode = rough;
  m.metalnessNode = float(0.3).mul(rust.oneMinus());
  m.normalNode = bumpNormal(seam.mul(-0.004).add(rivet.mul(0.003)).add(fine.mul(0.0006)), 1.0);
  return m;
}

/** 炎にさらされる鋼（穴の内壁・火炎偏向板）：黒いすすと、焼けたさび */
function sootMat() {
  const m = new THREE.MeshStandardNodeMaterial();
  const q = p2();
  const n = nz(q.mul(0.16)).r, fine = nz(q.mul(1.6)).b;
  const rust = smoothstep(0.55, 0.9, nz(q.mul(vec2(0.11, 0.3)).add(0.2)).a);
  m.colorNode = mix(color(0x15130f), color(0x4a2a19), rust.mul(0.55)).mul(n.mul(0.5).add(0.7)).mul(fine.mul(0.2).add(0.9));
  m.roughnessNode = float(0.86).sub(n.mul(0.2));
  m.metalness = 0.35;
  return m;
}

/** 亜鉛めっきの鋼（手すり・配管・格子の柱） */
function galvMat() {
  const m = new THREE.MeshStandardNodeMaterial();
  const q = p2();
  const n = nz(q.mul(0.8)).b, n2 = nz(q.mul(0.11)).r;
  m.colorNode = mix(color(0x868c92), color(0xa9afb4), n).mul(n2.mul(0.22).add(0.85));
  m.roughnessNode = float(0.5).add(n.mul(0.14));
  m.metalness = 0.7;
  return m;
}

/** 格子の床（グレーチング）：近くでは目が見え、遠くでは均一な色になる */
function grateMat(o = {}) {
  const m = new THREE.MeshStandardNodeMaterial();
  const k = 9.0;
  const bar = max(step(0.7, fract(P.x.mul(k))), step(0.7, fract(P.z.mul(k))));
  const fw = fwidth(P.x.mul(k)).add(fwidth(P.z.mul(k)));
  const vis = fall(0.25, 0.9, fw).mul(step(0.7, NL.y.abs()));
  m.colorNode = color(0x8a9096).mul(mix(float(0.42), mix(float(0.1), float(1.0), bar), vis));
  if (o.night) m.emissiveNode = color(0xffd9a0).mul(o.night).mul(0.2);
  m.roughness = 0.55; m.metalness = 0.6;
  return m;
}

/** コンクリート：目地・しみ・ひび・斜面の雨だれ・ふもとの苔・炎でこげた跡。paint は塗装した建屋用 */
function concreteMat(o = {}) {
  const m = new THREE.MeshStandardNodeMaterial();
  const { u, v } = faceUV();
  const flat = smoothstep(0.93, 0.995, NL.y.abs());              // 1＝水平な面、0＝斜面・壁
  const q = vec2(u, v);
  const A = nz(q.mul(0.027).add(0.13)), n4 = nz(q.mul(1.5)).b;
  const n2 = A.r;
  const joint = max(gridLine(u, 3.2, 0.018), gridLine(v, 3.2, 0.018));
  const stain = smoothstep(0.45, 0.92, nz(q.mul(0.046).add(0.61)).g);
  const cross = mix(P.x, P.z, step(NL.z.abs(), NL.x.abs()));      // 斜面を横切る向きの座標（雨だれは下へ流れる）
  const run = nz(vec2(cross.mul(0.33), P.y.mul(0.028))).a;
  const crack = fall(0.006, 0.016, nz(q.mul(0.075).add(0.3)).a.sub(0.5).abs());
  let c = mix(color(0xb3afa4), color(0x908d85), n2).mul(n4.mul(0.12).add(0.94));
  if (o.paint) c = mix(c, color(o.paint), 0.8);
  c = c.mul(stain.mul(-0.24).add(1.0)).mul(joint.mul(-0.4).add(1.0)).mul(crack.mul(-0.22).add(1.0));
  c = c.mul(mix(smoothstep(0.4, 0.85, run).mul(-0.34).add(1.0), float(1.0), flat));
  const foot = fall(0.0, 1.3, P.y.add(n2.mul(0.8)).sub(0.3)).mul(flat.oneMinus());
  c = mix(c, color(0x4d5238), foot.mul(0.45));
  if (!o.paint && !o.clean) {
    const nearML = fall(4.0, 15.0, P.x.add(1.6).abs());
    const edge = fall(2.6, 7.5, P.z.abs().add(n2.mul(2.0)).sub(0.6));
    const exit = smoothstep(24.0, 27.0, P.x.abs()).mul(fall(3.0, 9.5, P.z.abs().add(n2.mul(3.0))));
    c = mix(c, color(0x16140f), max(edge.mul(nearML).mul(flat), exit).mul(0.8));
  }
  m.colorNode = c;
  if (o.night) {
    const pool = fall(5.0, 26.0, length(vec2(P.x.add(1.6), P.z))).mul(flat).mul(step(HS - 0.3, P.y));
    m.emissiveNode = c.mul(vec3(0.8, 0.9, 1.0)).mul(pool).mul(o.night).mul(0.32);
  }
  m.roughnessNode = float(0.9).sub(stain.mul(0.12));
  m.metalness = 0;
  m.normalNode = bumpNormal(n4.mul(0.012).add(joint.mul(-0.012)).add(crack.mul(-0.006)), 1.0);
  return m;
}

/** 耐火れんが（火炎溝の内張り）：1 個ずつ色が違い、発射台の下ほど黒くすすけ、熱でてかる */
function brickMat() {
  const m = new THREE.MeshStandardNodeMaterial();
  const { u, v } = faceUV();
  const bw = 0.62, bh = 0.2;
  const row = floor(v.div(bh));
  const uu = u.div(bw).add(row.mul(0.5));
  const tint = mx_cell_noise_float(vec2(floor(uu), row).add(3.0));
  const fu = fract(uu).sub(0.5).abs().mul(bw), fv = fract(v.div(bh)).sub(0.5).abs().mul(bh);
  const md = min(float(bw / 2).sub(fu), float(bh / 2).sub(fv));
  const near = fall(0.02, 0.09, fwidth(u).add(fwidth(v)));
  const mortar = fall(0.008, 0.02, md).mul(near);
  const grain = nz(vec2(u, v).mul(1.8)).b;
  let c = mix(color(0xb08a5c), color(0x8a6844), mix(float(0.5), tint, near)).mul(grain.mul(0.14).add(0.93));
  c = mix(c, color(0x8d8778), mortar.mul(0.8));
  const sootN = nz(vec2(u.mul(0.06), v.mul(0.11))).r;
  const soot = fall(7.0, 26.0, P.x.abs()).mul(0.62).add(0.3).mul(sootN.mul(0.7).add(0.55)).clamp(0, 1);
  c = mix(c, color(0x15120f), soot);
  m.colorNode = c;
  m.roughnessNode = float(0.88).sub(soot.mul(sootN).mul(0.4));
  m.metalness = 0;
  m.normalNode = bumpNormal(mortar.mul(-0.01).add(grain.mul(0.004)), 1.0);
  return m;
}

/** クローラーウェイの砂利（川石）と、履帯のあと */
function gravelMat() {
  const m = new THREE.MeshStandardNodeMaterial();
  const q = P.xz;
  const near = fall(0.03, 0.2, fwidth(q.x).add(fwidth(q.y)));
  const peb = nz(q.mul(1.05)).b, peb2 = nz(q.mul(2.3).add(0.31)).b;
  const tint = nz(q.mul(0.37).add(0.2)).g, big = nz(q.mul(0.035)).r;
  const track = sin(P.x.mul(14.0)).mul(0.5).add(0.5);
  let c = mix(color(0xb8ab92), color(0x8d8271), tint).mul(big.mul(0.25).add(0.84));
  c = c.mul(peb.mul(0.34).add(peb2.mul(0.22)).add(0.72));
  c = c.mul(track.mul(0.08).mul(near).oneMinus());
  m.colorNode = c; m.roughness = 0.95; m.metalness = 0;
  m.normalNode = bumpNormal(peb.mul(0.014).add(peb2.mul(0.006)), 1.0);
  return m;
}

/** 発射台の側面の表記（R＝白い文字、G＝黄、B＝黒）。パロディなので実在のロゴは使わない */
function mlText() {
  const W = 2048, H = 320;
  const t = canvasTex(W, H, (ctx) => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    // 床のふちの黄黒のしま（上の帯）
    const bandH = 24;
    for (let x = -bandH; x < W + bandH; x += 44) {
      ctx.fillStyle = '#00ff00'; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 22, 0); ctx.lineTo(x + 22 - bandH, bandH); ctx.lineTo(x - bandH, bandH); ctx.fill();
      ctx.fillStyle = '#0000ff'; ctx.beginPath(); ctx.moveTo(x + 22, 0); ctx.lineTo(x + 44, 0); ctx.lineTo(x + 44 - bandH, bandH); ctx.lineTo(x + 22 - bandH, bandH); ctx.fill();
    }
    ctx.fillStyle = '#ff0000'; ctx.textBaseline = 'middle';
    ctx.font = '900 132px "Arial Black", "Segoe UI Black", Impact, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText('ML-1', W - 150, 92);
    ctx.font = '900 62px "Arial Black", "Segoe UI Black", Impact, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('AI SPACE LAB', 520, 74);
    ctx.font = '700 30px Arial, "Segoe UI", sans-serif';
    ctx.fillText('MOBILE LAUNCHER  ·  AIPOLLO 11', 524, 126);
    // 文字の中のかすれ（ステンシルの切れ目）
    ctx.fillStyle = '#000';
    for (let x = 0; x < W; x += 47) ctx.fillRect(x, 30, 2, 130);
  }, { srgb: false });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function makeMaterials() {
  const M = {};
  const night = (M.uNight = uniform(0));       // 夜の灯りの強さ（setNight で決める）
  M.red = paintMat(0x8f3122, { sootY: -1.5, rust: 0.6, vary: 0.34, night, lit: 0.27 });            // 塔の赤（下ほどすすける）
  M.redArm = paintMat(0x8f3122, { rust: 0.5, vary: 0.3, night, lit: 0.3 });
  M.redLo = paintMat(0x8e3323, { rust: 0.7 });                        // 発射台まわりの赤（ホールドダウンなど）
  M.mast = paintMat(0xffffff, { band: 4.4, rust: 0.4 });              // 投光器の柱（赤白）
  M.white = paintMat(0xe6e8ea, { rust: 0.28, rough: 0.5, metal: 0.0, streak: 0.55 });
  M.gray = paintMat(0x858a91, { rust: 0.5, rough: 0.6, metal: 0.2, streak: 0.4 });
  M.yellow = paintMat(0xd0a01e, { rust: 0.5, rough: 0.55, metal: 0.1 });
  M.pipeR = paintMat(0xa52a22, { rust: 0.3 });
  M.dark = paintMat(0x1c1d21, { rust: 0.3, rough: 0.75, metal: 0.3 });
  M.soot = sootMat();
  M.plate = plateMat({ hex: 0x7b8088, text: mlText(), night });
  M.deck = plateMat({ hex: 0x63676d, su: 1.44, sv: 1.18, deck: true, night, lit: 0.34 });
  M.core = plateMat({ hex: 0x9a9fa6, su: 0.575, sv: 1.2, rust: 0.28, night, lit: 0.4 });
  M.plate2 = plateMat({ hex: 0x8a8f96, su: 0.46, sv: 0.42, rust: 0.4 });      // 小さな機器の箱
  M.hatch = paintMat(0x4b4e54, { rust: 0.4, rough: 0.7, metal: 0.35 });
  M.galv = galvMat();
  M.grate = grateMat({ night });
  M.conc = concreteMat({ night });
  M.conc2 = concreteMat({ paint: 0xd2d0c6 });
  M.brick = brickMat();
  M.gravel = gravelMat();
  M.glass = mat(0x0b1118, { rough: 0.1, metal: 0.0, unique: true });
  M.lamp = glow(0xfff2c8, 0);      // 投光器（明るさは setNight で決める）
  M.work = glow(0xffe2b0, 0);      // 作業灯
  M.warn = glow(0xff2a1a, 0.4);    // 航空障害灯
  return M;
}

// =====================================================================
// 形
// =====================================================================
/** 台地（ハードスタンド）：斜面・火炎溝の壁・クローラーウェイの坂・作業車の坂 */
function buildMound(B) {
  const X0 = TOPX + RUN, Z0 = TOPZ + RUN;
  for (const s of [1, -1]) {
    const T1 = [-TOPX, HS, s * TR], T2 = [TOPX, HS, s * TR], T3 = [TOPX, HS, s * TOPZ], T4 = [-TOPX, HS, s * TOPZ];
    const G1 = [-X0, 0, s * TR], G2 = [X0, 0, s * TR], G3 = [X0, 0, s * Z0], G4 = [-X0, 0, s * Z0];
    B.quad('conc', T1, T2, T3, T4, [0, 1, 0]);
    B.quad('conc', T4, T3, G3, G4, [0, 0.5, s]);
    B.quad('conc', T1, T4, G4, G1, [-1, 0.5, 0]);
    B.quad('conc', T2, T3, G3, G2, [1, 0.5, 0]);
    B.quad('brick', G1, G2, T2, T1, [0, 0, -s]);
    // クローラーウェイの坂（+X）：溝をまたいで 2 本
    B.quad('gravel', [TOPX, HS, s * LANE0], [RAMPX, BED, s * LANE0], [RAMPX, BED, s * LANE1], [TOPX, HS, s * LANE1], [0, 1, 0]);
    B.quad('conc', [TOPX, HS, s * TR], [RAMPX, BED, s * TR], [RAMPX, BED, s * LANE0], [TOPX, HS, s * LANE0], [0, 1, 0]);
    B.quad('brick', [TOPX, 0, s * TR], [RAMPX, 0, s * TR], [RAMPX, BED, s * TR], [TOPX, HS, s * TR], [0, 0, -s]);
    B.quad('conc', [TOPX, 0, s * (LANE1 + 2.2)], [RAMPX, 0, s * (LANE1 + 0.5)], [RAMPX, BED, s * LANE1], [TOPX, HS, s * LANE1], [0, 0.4, s]);
    B.quad('conc', [RAMPX, 0, s * TR], [RAMPX, 0, s * LANE0], [RAMPX, BED, s * LANE0], [RAMPX, BED, s * TR], [1, 0, 0]);
    // 溝のふちの立ち上がりと手すり、黄色い線
    B.box('conc', 2 * TOPX, 0.14, 0.3, 0, HS + 0.07, s * (TR + 0.15));
    rail(B, [-TOPX + 0.3, HS + 0.14, s * (TR + 0.26)], [TOPX - 0.3, HS + 0.14, s * (TR + 0.26)], 1.2);
    B.box('yellow:nc', 2 * TOPX - 1, 0.04, 0.22, 0, HS + 0.02, s * (TR + 0.75));
  }
  // 上面のふちの立ち上がりと、斜面の排水溝
  const curb = (xa, xb, za, zb) => B.box('conc', Math.abs(xb - xa) + 0.22, 0.16, Math.abs(zb - za) + 0.22, (xa + xb) / 2, HS + 0.08, (za + zb) / 2);
  curb(-TOPX, -VRX - 0.3, TOPZ - 0.11, TOPZ - 0.11); curb(VRX + 0.3, 7.45, TOPZ - 0.11, TOPZ - 0.11); curb(8.95, TOPX, TOPZ - 0.11, TOPZ - 0.11);
  curb(-TOPX, TOPX, -TOPZ + 0.11, -TOPZ + 0.11);
  for (const s of [1, -1]) {
    curb(-TOPX + 0.11, -TOPX + 0.11, s * (TR + 0.5), s * TOPZ); curb(TOPX - 0.11, TOPX - 0.11, s * (LANE1 + 0.3), s * TOPZ);
    for (const x of (s > 0 ? [-15.5, -7.5, 13, 16.5] : [-15.5, -9, 8, 15.5])) B.beam('hatch:nc', [x, HS + 0.03, s * TOPZ], [x, 0.03, s * (TOPZ + RUN)], 0.34, 0.06);
    for (const z of [9, 12.5]) B.beam('hatch:nc', [-TOPX, HS + 0.03, s * z], [-TOPX - RUN, 0.03, s * z], 0.06, 0.34);
    B.beam('hatch:nc', [TOPX, HS + 0.03, s * 12.5], [TOPX + RUN, 0.03, s * 12.5], 0.06, 0.34);
    B.beam('conc', [TOPX, HS + 0.1, s * (LANE1 - 0.1)], [RAMPX, BED + 0.1, s * (LANE1 - 0.1)], 0.2);       // クローラーウェイの坂のふち
  }
  // 作業車の坂（+Z）
  B.quad('conc', [-VRX, HS, TOPZ], [VRX, HS, TOPZ], [VRX, 0.03, VRZ], [-VRX, 0.03, VRZ], [0, 1, 0]);
  for (const s of [1, -1]) {
    B.quad('conc', [s * VRX, 0, TOPZ], [s * VRX, 0, VRZ], [s * VRX, 0.03, VRZ], [s * VRX, HS, TOPZ], [s, 0, 0]);
    B.beam('conc', [s * (VRX - 0.12), HS + 0.1, TOPZ], [s * (VRX - 0.12), 0.13, VRZ], 0.24);
    // ガードレール
    const n = 9;
    for (let i = 0; i <= n; i++) { const f = i / n, z = TOPZ + (VRZ - TOPZ) * f, y = HS * (1 - f); B.beam('galv:nc', [s * (VRX - 0.12), y + 0.1, z], [s * (VRX - 0.12), y + 0.62, z], 0.06); }
    B.beam('galv:nc', [s * (VRX - 0.16), HS + 0.5, TOPZ], [s * (VRX - 0.16), 0.52, VRZ], 0.03, 0.16);
  }
  // 斜面の階段（+Z 側、道の右）
  for (let i = 0; i < 20; i++) {
    const f = (i + 0.5) / 20, z = TOPZ + RUN * f, y = HS * (1 - f);
    B.box('conc', 1.1, 0.2, RUN / 20 + 0.02, 8.2, y - 0.02, z);
  }
  for (const s of [1, -1]) rail(B, [8.2 + s * 0.52, HS, TOPZ], [8.2 + s * 0.52, 0, TOPZ + RUN], 1.3, 0.36);
}

/** 火炎溝：床・出口の先のこげ・火炎偏向板 */
function buildTrench(B) {
  const X0 = TOPX + RUN;
  B.quad('brick', [-X0, 0.04, -TR], [RAMPX, 0.04, -TR], [RAMPX, 0.04, TR], [-X0, 0.04, TR], [0, 1, 0]);
  B.quad('conc', [-X0, 0.036, -TR], [-X0, 0.036, TR], [-X0 - 15, 0.036, 8], [-X0 - 15, 0.036, -8], [0, 1, 0]);
  B.quad('conc', [RAMPX, 0.036, -TR], [RAMPX, 0.036, TR], [RAMPX + 11, 0.036, LANE0 - 0.4], [RAMPX + 11, 0.036, -LANE0 + 0.4], [0, 1, 0]);
  // 火炎偏向板（逆 V 字。噴流を溝の両側へ分ける）
  const N = 14, zd = TR - 0.14, prof = [];
  for (let i = 0; i <= N; i++) { const x = -3.5 + (7 * i) / N; prof.push([x, 0.22 + 3.1 * Math.pow(1 - Math.abs(x) / 3.5, 1.55)]); }
  for (let i = 0; i < N; i++) {
    const [xa, ya] = prof[i], [xb, yb] = prof[i + 1];
    B.quad('soot', [xa, ya, -zd], [xb, yb, -zd], [xb, yb, zd], [xa, ya, zd], [0, 1, 0]);
    for (const s of [1, -1]) B.quad('soot', [xa, 0.05, s * zd], [xb, 0.05, s * zd], [xb, yb, s * zd], [xa, ya, s * zd], [0, 0, s]);
  }
  for (const s of [1, -1]) B.box('dark:nc', 2 * X0 - 6, 0.07, 0.09, 0, 0.085, s * 1.9);
}

/** 移動式発射台（ML）：鋼板の箱・炎の穴・ホールドダウンアーム・テールサービスマスト・歩廊・支柱 */
function buildML(B, HI) {
  const { x0, x1, z } = ML, h = HOLE;
  const rectY = (key, xa, xb, za, zb, y, up) => B.quad(key, [xa, y, za], [xb, y, za], [xb, y, zb], [xa, y, zb], [0, up ? 1 : -1, 0]);
  for (const [y, key, up] of [[DECK, 'deck', true], [MLB, 'dark', false]]) {
    rectY(key, x0, -h, -z, z, y, up); rectY(key, h, x1, -z, z, y, up); rectY(key, -h, h, h, z, y, up); rectY(key, -h, h, -z, -h, y, up);
  }
  B.quad('plate', [x0, MLB, z], [x1, MLB, z], [x1, DECK, z], [x0, DECK, z], [0, 0, 1]);
  B.quad('plate', [x0, MLB, -z], [x1, MLB, -z], [x1, DECK, -z], [x0, DECK, -z], [0, 0, -1]);
  B.quad('plate', [x1, MLB, -z], [x1, MLB, z], [x1, DECK, z], [x1, DECK, -z], [1, 0, 0]);
  B.quad('plate', [x0, MLB, -z], [x0, MLB, z], [x0, DECK, z], [x0, DECK, -z], [-1, 0, 0]);
  B.quad('soot', [-h, MLB, h], [h, MLB, h], [h, DECK, h], [-h, DECK, h], [0, 0, -1]);
  B.quad('soot', [-h, MLB, -h], [h, MLB, -h], [h, DECK, -h], [-h, DECK, -h], [0, 0, 1]);
  B.quad('soot', [h, MLB, -h], [h, MLB, h], [h, DECK, h], [h, DECK, -h], [-1, 0, 0]);
  B.quad('soot', [-h, MLB, -h], [-h, MLB, h], [-h, DECK, h], [-h, DECK, -h], [1, 0, 0]);
  // 穴のふちの立ち上がり
  for (const s of [1, -1]) { B.box('soot', 2 * h + 0.36, 0.16, 0.18, 0, DECK + 0.08, s * (h + 0.09)); B.box('soot', 0.18, 0.16, 2 * h, s * (h + 0.09), DECK + 0.08, 0); }

  // ホールドダウンアーム（4 基・機体の付け根を対角でつかむ）
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    B.at(Math.cos(a) * 3.08, DECK, Math.sin(a) * 3.08, Math.PI - a);       // ここから先は +x が機体の向き
    B.box('dark', 1.25, 0.1, 1.0, 0, 0.05, 0);
    B.box('redLo', 0.8, 0.72, 0.62, -0.02, 0.46, 0);
    B.box('redLo', 1.12, 0.4, 0.5, 0.74, 0.92, 0, 0, 0, 0.36);
    for (const s of [1, -1]) B.box('redLo', 1.0, 0.62, 0.05, 0.28, 0.44, s * 0.34, 0, 0, -0.42);
    B.box('dark', 0.34, 0.2, 0.56, 1.27, 1.1, 0);
    B.tube('galv', [-0.42, 0.16, 0], [0.5, 0.82, 0], 0.075, 10);
    B.box('dark', 1.3, 0.05, 0.8, 0.3, 1.36, 0, 0, 0, 0.2);
    B.tube('galv', [0.3, 0.78, -0.38], [0.3, 0.78, 0.38], 0.08, 10);
    B.tube('galv', [-0.3, 0.3, -0.38], [-0.3, 0.3, 0.38], 0.06, 10);
    B.box('yellow:nc', 0.82, 0.07, 0.64, -0.02, 0.8, 0);
    for (const s of [1, -1]) for (const x of [-0.45, 0.45]) B.tube('galv:nc', [x, 0.1, s * 0.4], [x, 0.16, s * 0.4], 0.045, 6);
  }
  // テールサービスマスト（3 基）：台座・A 形の脚・起き上がる腕・先の覆いとホース
  for (const deg of [68, -68, 112]) {
    const a = (deg * Math.PI) / 180;
    B.at(Math.cos(a) * 3.95, DECK, Math.sin(a) * 3.95, Math.PI - a);
    B.box('plate2', 0.95, 0.42, 0.82, -0.05, 0.21, 0);
    for (const s of [1, -1]) {
      B.beam('gray', [-0.42, 0.42, s * 0.33], [0.02, 1.72, s * 0.29], 0.1);
      B.beam('gray', [0.34, 0.42, s * 0.33], [0.02, 1.72, s * 0.29], 0.08);
      B.beam('gray', [-0.2, 1.05, s * 0.315], [0.18, 1.05, s * 0.315], 0.05);
    }
    B.tube('dark', [0.02, 1.72, -0.36], [0.02, 1.72, 0.36], 0.07, 10);                  // 回転軸
    B.box('plate2', 0.3, 1.32, 0.46, 0.02, 1.12, 0, 0, 0, -0.08);
    B.tube('white', [0.36, 1.86, -0.3], [0.36, 1.86, 0.3], 0.27, 14);                   // 先の覆い（丸い）
    B.box('white', 0.5, 0.36, 0.6, 0.2, 1.8, 0);
    B.box('dark', 0.06, 0.4, 0.5, 0.63, 1.82, 0);
    for (const z of [-0.17, 0, 0.17]) { B.tube('dark:nc', [0.66, 1.76, z], [1.05, 1.46, z], 0.04, 6); B.tube('dark:nc', [1.05, 1.46, z], [1.5, 1.5, z], 0.04, 6); }
    B.tube('galv', [-0.32, 0.46, 0], [-0.04, 1.36, 0], 0.05, 8);
    B.box('yellow:nc', 0.97, 0.06, 0.84, -0.05, 0.42, 0);
  }
  B.home();

  // 床のふちの手すり
  rail(B, [x0 + 0.12, DECK, z - 0.12], [x1 - 0.12, DECK, z - 0.12], 0.8);
  rail(B, [x0 + 0.12, DECK, -z + 0.12], [x1 - 0.12, DECK, -z + 0.12], 0.8);
  rail(B, [x1 - 0.12, DECK, -z + 0.12], [x1 - 0.12, DECK, z - 0.12], 0.8);
  rail(B, [x0 + 0.12, DECK, -z + 0.12], [x0 + 0.12, DECK, z - 0.12], 0.8);
  // 床の上の設備：配電箱・通気筒・点検ぶた・消火の配管
  for (const [x, zz, ry] of [[x1 - 1.0, z - 1.1, 0], [x1 - 1.0, -z + 1.1, 0], [x0 + 3.9, z - 0.9, 1.57], [x0 + 3.9, -z + 0.9, 1.57], [-2.9, z - 0.9, 1.57], [3.6, -z + 0.75, 1.57]]) {
    B.box('plate2', 0.75, 0.55, 0.42, x, DECK + 0.3, zz, 0, ry, 0);
    B.box('gray', 0.8, 0.05, 0.47, x, DECK + 0.6, zz, 0, ry, 0);
    B.box('gray:nc', 0.66, 0.05, 0.36, x, DECK + 0.025, zz, 0, ry, 0);
  }
  for (const [x, zz] of [[4.3, 3.7], [4.3, -3.7], [-3.2, 4.6], [-3.2, -4.6]]) { B.tube('galv', [x, DECK, zz], [x, DECK + 0.95, zz], 0.1, 10); B.tube('galv', [x, DECK + 0.95, zz], [x + 0.25, DECK + 1.1, zz], 0.1, 10); }
  for (const [x, zz, w, d] of [[3.6, 0, 1.0, 1.5], [-2.9, 2.9, 0.9, 1.2], [-2.9, -2.9, 0.9, 1.2], [1.2, 4.3, 1.4, 0.9], [1.2, -4.3, 1.4, 0.9], [4.6, 2.4, 0.8, 0.8]]) B.box('hatch:nc', w, 0.035, d, x, DECK + 0.018, zz);
  const fr = 2.75;
  for (const s of [1, -1]) {
    B.tube('pipeR:nc', [-fr, DECK + 0.14, s * fr], [fr, DECK + 0.14, s * fr], 0.05, 8);
    B.tube('pipeR:nc', [s * fr, DECK + 0.14, -fr], [s * fr, DECK + 0.14, fr], 0.05, 8);
    for (const t of [-1.4, 0, 1.4]) { B.tube('pipeR:nc', [t, DECK + 0.14, s * fr], [t, DECK + 0.36, s * (fr - 0.18)], 0.035, 6); B.tube('pipeR:nc', [s * fr, DECK + 0.14, t], [s * (fr - 0.18), DECK + 0.36, t], 0.035, 6); }
  }
  // 床を這うホース（テールサービスマストへ）
  pipeRun(B, 'dark:nc', [[-2.6, DECK + 0.05, 4.4], [0.6, DECK + 0.05, 4.9], [1.9, DECK + 0.05, 4.3], [1.5, DECK + 0.05, 3.7]], 0.045);
  pipeRun(B, 'dark:nc', [[-2.6, DECK + 0.05, -4.4], [0.4, DECK + 0.05, -4.7], [1.7, DECK + 0.05, -4.2], [1.5, DECK + 0.05, -3.7]], 0.045);
  pipeRun(B, 'dark:nc', [[-3.3, DECK + 0.05, 1.5], [-2.2, DECK + 0.05, 2.9], [-1.6, DECK + 0.05, 3.5]], 0.04);
  // 塔の足もとの台座と、床を這う配線の覆い
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box('gray', 0.72, 0.26, 0.72, TOWER_X + sx * TW, DECK + 0.13, sz * TW);
  B.box('galv:nc', 2.2, 0.07, 0.34, -2.7, DECK + 0.035, 1.1); B.box('galv:nc', 2.2, 0.07, 0.34, -2.7, DECK + 0.035, -1.1);

  // 側面（±Z）：歩廊・扉・通気口・配管・はしご・作業灯
  const xc = (x0 + x1) / 2, xl = x1 - x0;
  for (const s of [1, -1]) {
    const zw = s * z, cy = MLB + 0.55;
    B.box('grate', xl - 0.6, 0.04, 0.5, xc, cy, zw + s * 0.25);
    rail(B, [x0 + 0.3, cy + 0.02, zw + s * 0.5], [x1 - 0.3, cy + 0.02, zw + s * 0.5], 0.8);
    for (let x = x0 + 0.5; x < x1; x += 1.6) B.beam('gray:nc', [x, cy - 0.46, zw], [x, cy - 0.02, zw + s * 0.48], 0.05);
    for (const x of [-6.6, -1.3, 3.7]) {
      B.box('hatch', 0.44, 0.62, 0.05, x, cy + 0.33, zw + s * 0.02);
      B.box('gray:nc', 0.54, 0.04, 0.08, x, cy + 0.66, zw + s * 0.035);
      B.box('galv:nc', 0.03, 0.12, 0.03, x + 0.15, cy + 0.3, zw + s * 0.055);
      B.box('work:nc', 0.14, 0.05, 0.08, x, cy + 0.74, zw + s * 0.05);
    }
    for (const x of [-7.6, 0.25]) {
      B.box('dark:nc', 0.95, 0.44, 0.05, x, MLB + 1.55, zw + s * 0.02);
      for (let k = 0; k < 6; k++) B.box('galv:nc', 0.95, 0.025, 0.06, x, MLB + 1.37 + k * 0.073, zw + s * 0.05, s * 0.5, 0, 0);
    }
    pipeRun(B, 'white:nc', [[x0 + 0.5, MLB + 0.3, zw + s * 0.12], [x1 - 1.2, MLB + 0.3, zw + s * 0.12], [x1 - 1.2, MLB - 0.2, zw + s * 0.12]], 0.06);
    pipeRun(B, 'pipeR:nc', [[x0 + 1.4, MLB + 0.44, zw + s * 0.09], [x1 - 0.4, MLB + 0.44, zw + s * 0.09]], 0.035);
    pipeRun(B, 'galv:nc', [[x0 + 0.5, MLB + 0.15, zw + s * 0.1], [x1 - 2.6, MLB + 0.15, zw + s * 0.1], [x1 - 2.6, MLB - 0.25, zw + s * 0.1]], 0.045);
    for (const x of [-6.05, -0.75, 4.25]) { B.box('yellow:nc', 0.13, 0.1, 0.02, x, cy + 0.5, zw + s * 0.012); B.box('pipeR:nc', 0.1, 0.2, 0.07, x + 0.02, cy + 0.2, zw + s * 0.04); }
    ladder(B, -5.2, cy + 0.02, DECK + 0.3, zw + s * 0.13);
    ladder(B, 2.6, cy + 0.02, DECK + 0.3, zw + s * 0.13);
    for (let x = x0 + 1.2; x < x1; x += 2.4) B.box('work:nc', 0.16, 0.06, 0.1, x, DECK - 0.22, zw + s * 0.06);
  }
  // +X 面：大きな通気口と扉、-X 面：配管の束
  for (const zz of [-3.4, 3.4]) {
    B.box('dark:nc', 0.05, 0.9, 1.5, x1 + 0.02, MLB + 1.2, zz);
    for (let k = 0; k < 9; k++) B.box('galv:nc', 0.06, 0.03, 1.5, x1 + 0.05, MLB + 0.82 + k * 0.095, zz, 0, 0, 0.5);
  }
  B.box('dark', 0.05, 0.64, 0.44, x1 + 0.02, MLB + 0.5, 0.9); B.box('dark', 0.05, 0.64, 0.44, x1 + 0.02, MLB + 0.5, -0.9);
  for (const [zz, r, key] of [[-1.1, 0.11, 'white'], [-0.7, 0.07, 'galv'], [-0.3, 0.07, 'galv'], [0.2, 0.09, 'white'], [0.7, 0.05, 'pipeR']]) B.tube(key + ':nc', [x0 - 0.16, HS + 0.1, zz + 4.2], [x0 - 0.16, DECK - 0.2, zz + 4.2], r, 8);

  // 底の梁
  for (const s of [1, -1]) B.box('dark:nc', xl - 0.4, 0.45, 0.3, xc, MLB - 0.22, s * (z - 0.7));
  for (let x = x0 + 0.9; x < x1; x += 1.8) {
    if (Math.abs(x) < h + 0.3) { for (const s of [1, -1]) B.box('dark:nc', 0.24, 0.36, z - h, x, MLB - 0.18, s * (h + (z - h) / 2)); }
    else B.box('dark:nc', 0.24, 0.36, 2 * z - 0.4, x, MLB - 0.18, 0);
  }
  // 支柱（6 本）と、塔の下の伸縮柱
  const px = [-7.6, -1.6, 4.4], pz = 4.9;
  for (const s of [1, -1]) {
    for (const x of px) {
      B.box('conc', 1.25, 0.22, 1.25, x, HS + 0.11, s * pz);
      B.tube('gray', [x, HS + 0.22, s * pz], [x, MLB - 0.3, s * pz], 0.34, 16);
      B.box('gray', 1.0, 0.3, 1.0, x, MLB - 0.15, s * pz);
      B.tube('gray', [x, HS + 0.22, s * pz], [x, HS + 0.5, s * pz], 0.46, 16, 0.36);
      for (const a of [0, Math.PI / 2]) B.box('gray', 0.05, 0.42, 0.92, x, MLB - 0.5, s * pz, 0, a, 0);
    }
    for (let i = 0; i < 2; i++) { B.beam('gray', [px[i], HS + 0.5, s * pz], [px[i + 1], MLB - 0.45, s * pz], 0.12); B.beam('gray', [px[i + 1], HS + 0.5, s * pz], [px[i], MLB - 0.45, s * pz], 0.12); }
    for (const x of [-8.2, -4.5]) { B.tube('gray', [x, HS, s * 3.4], [x, MLB, s * 3.4], 0.17, 12); B.box('conc', 0.6, 0.16, 0.6, x, HS + 0.08, s * 3.4); }
  }
  // 台地の上から発射台の床へ上がる階段（+X の端・手前側）
  const sx = x1 + 0.8;
  B.box('grate', 1.4, 0.04, 0.9, sx, HS + 2.05, 4.9);
  stair(B, [sx - 0.36, HS + 0.05, 2.2], [sx - 0.36, HS + 2.05, 4.45], 0.6, 11);
  stair(B, [sx + 0.36, HS + 2.05, 4.45], [sx + 0.36, DECK, 2.2], 0.6, 11);
  B.box('grate', 1.5, 0.04, 0.9, sx - 0.05, DECK - 0.02, 1.75);
  for (const [dx, dz] of [[-0.66, 5.3], [0.66, 5.3], [-0.66, 4.5], [0.66, 4.5]]) B.beam('redLo', [sx + dx, HS, dz], [sx + dx, HS + 2.05, dz], 0.07);
  for (const dx of [-0.7, 0.66]) B.beam('redLo', [sx + dx, HS, 1.35], [sx + dx, DECK - 0.04, 1.35], 0.07);
  rail(B, [sx - 0.66, HS + 2.07, 5.33], [sx + 0.66, HS + 2.07, 5.33], 0.66);
}

/** 台地の上の設備：配管の取り合い塔・消火栓・カメラ台 */
function buildPadTop(B) {
  // 取り合い塔（液体酸素・液体水素の配管が発射台へ上がる所）
  for (const [x, r] of [[-3.2, 0.11], [2.6, 0.09]]) {
    for (const [a, b, t] of trussList(1.2, 1.2, 0, MLB + 0.95 - HS, 0.95, { col: 0.09, bar: 0.05, diag: 0.045 })) B.beam('redLo', [a[0] + x, a[1] + HS, a[2] - 7.0], [b[0] + x, b[1] + HS, b[2] - 7.0], t);
    B.box('grate', 1.3, 0.04, 1.3, x, MLB + 0.95, -7.0);
    pipeRun(B, 'white:nc', [[x, HS + 0.42, -8.2], [x, HS + 0.42, -7.0], [x, MLB + 0.55, -7.0], [x, MLB + 0.55, -ML.z + 0.05]], r);
    pipeRun(B, 'galv:nc', [[x + 0.35, HS + 0.3, -8.2], [x + 0.35, HS + 0.3, -6.7], [x + 0.35, MLB + 0.3, -6.7], [x + 0.35, MLB + 0.3, -ML.z + 0.05]], 0.05);
  }
  // 床の配線ぶた（発射台の下へ）
  for (const x of [-6.2, 0.4, 3.8]) for (let k = 0; k < 6; k++) B.box('hatch:nc', 0.5, 0.05, 0.96, x, HS + 0.025, 6.6 + k * 1.0);
  // 消火栓と放水銃
  for (const [x, z] of [[-13, 9.5], [10.5, 9.5], [-13, -9.5], [10.5, -9.5]]) {
    B.tube('pipeR:nc', [x, HS, z], [x, HS + 0.5, z], 0.07, 8);
    B.tube('pipeR:nc', [x, HS + 0.5, z], [x - Math.sign(x + 1.6) * 0.45, HS + 0.72, z - Math.sign(z) * 0.3], 0.045, 8);
    B.box('pipeR:nc', 0.3, 0.06, 0.3, x, HS + 0.03, z);
  }
  // 遠隔カメラの台
  for (const [x, z] of [[9.5, 11.5], [-11.5, 12], [8.5, -11.5]]) {
    for (const [dx, dz] of [[0.16, 0.1], [-0.16, 0.1], [0, -0.18]]) B.beam('dark:nc', [x + dx, HS, z + dz], [x, HS + 0.55, z], 0.03);
    B.box('dark:nc', 0.22, 0.16, 0.3, x, HS + 0.62, z);
  }
}

/** 投光器の塔（赤白の格子の柱＋キセノン灯 8 灯）。光の位置を返す */
function buildFloods(B) {
  const out = [];
  for (const [x, z] of [[13, 13], [-15, 13], [13, -13], [-15, -13]]) {
    const ry = Math.atan2(-x, -z), H = 15.4;
    B.at(x, HS, z, ry);
    for (const [a, b, t] of trussList(0.62, 0.62, 0.3, H, 1.1, { col: 0.075, bar: 0.04, diag: 0.04 })) B.beam('mast', a, b, t);
    B.box('conc', 1.3, 0.3, 1.3, 0, 0.15, 0);
    B.box('grate', 1.9, 0.05, 1.3, 0, H + 0.02, 0);
    rail(B, [-0.92, H + 0.04, -0.62], [0.92, H + 0.04, -0.62], 0.62, 0.3);
    for (const s of [1, -1]) rail(B, [s * 0.92, H + 0.04, -0.62], [s * 0.92, H + 0.04, 0.62], 0.62, 0.3);
    ladder(B, 0, 0.3, H, -0.36);
    for (const s of [1, -1]) B.beam('mast', [s * 0.7, H, 0.3], [s * 0.7, H + 1.5, 0.3], 0.06);
    // 灯具の棚（少し上向き）
    B.at(x + Math.sin(ry) * 0.42, HS + H + 0.9, z + Math.cos(ry) * 0.42, ry, -0.3);
    B.box('dark', 2.3, 1.28, 0.08, 0, 0, -0.1);
    for (const yy of [-0.31, 0.31]) for (const xx of [-0.84, -0.28, 0.28, 0.84]) {
      B.tube('dark', [xx, yy, -0.06], [xx, yy, 0.2], 0.24, 14);
      B.tube('lamp:nc', [xx, yy, 0.2], [xx, yy, 0.212], 0.2, 14);
    }
    const p = new THREE.Vector3(0, 0, 0.5).applyMatrix4(B.xf);
    out.push([p.x, p.y, p.z]);
  }
  B.home();
  return out;
}

/** 球形タンク（液体酸素・液体水素）と配管、灯油（RP-1）の横置きタンク */
function buildTanks(B, M, lc) {
  const R = 3.1, CY = 4.5;
  const ground = (x, z) => moundH(x, z);
  const tanks = [{ x: -30, z: -38, name: 'LOX', lineX: -3.2, r: 0.11 }, { x: 33, z: -40, name: 'LH2', lineX: 2.6, r: 0.09 }];
  for (const t of tanks) {
    B.at(t.x, 0, t.z);
    B.sph('white', R, 0, CY, 0, 44, 28);
    B.tube('conc', [0, 0, 0], [0, 0.14, 0], 4.7, 40);
    for (let i = 0; i < 8; i++) {
      const a = (i + 0.5) * (Math.PI / 4), a2 = (i + 1.5) * (Math.PI / 4), rr = R * 0.93;
      B.tube('gray', [Math.cos(a) * rr, 0.1, Math.sin(a) * rr], [Math.cos(a) * rr, CY - 0.3, Math.sin(a) * rr], 0.17, 10);
      B.beam('galv', [Math.cos(a) * rr, 0.3, Math.sin(a) * rr], [Math.cos(a2) * rr, 2.6, Math.sin(a2) * rr], 0.05);
      B.beam('galv', [Math.cos(a2) * rr, 0.3, Math.sin(a2) * rr], [Math.cos(a) * rr, 2.6, Math.sin(a) * rr], 0.05);
    }
    // 赤道の歩廊・頂上の台と通気筒・はしご
    const tor = new THREE.TorusGeometry(R + 0.2, 0.05, 6, 48); tor.rotateX(Math.PI / 2); tor.translate(0, CY, 0); B.geo('galv:nc', tor);
    const tor2 = new THREE.TorusGeometry(R + 0.2, 0.02, 5, 48); tor2.rotateX(Math.PI / 2); tor2.translate(0, CY + 0.32, 0); B.geo('galv:nc', tor2);
    B.tube('gray', [0, CY + R - 0.05, 0], [0, CY + R + 0.12, 0], 0.9, 20);
    B.tube('galv', [0.3, CY + R, 0], [0.3, CY + R + 1.7, 0], 0.11, 10);
    B.tube('galv:nc', [-0.3, CY + R, 0.2], [-0.3, CY + R + 0.9, 0.2], 0.05, 8);
    for (let i = 0; i < 10; i++) {
      const a0 = (i / 10) * (Math.PI / 2), a1 = ((i + 1) / 10) * (Math.PI / 2), rr = R + 0.1;
      for (const s of [-0.13, 0.13]) B.beam('galv:nc', [s, CY + Math.sin(a0) * rr, Math.cos(a0) * rr], [s, CY + Math.sin(a1) * rr, Math.cos(a1) * rr], 0.022);
    }
    // ポンプ小屋
    B.box('conc2', 2.2, 1.1, 1.6, 4.6 * Math.sign(-t.x), 0.55, 2.6);
    B.box('gray:nc', 2.4, 0.08, 1.8, 4.6 * Math.sign(-t.x), 1.14, 2.6);
    B.home();
    // 発射台への配管（地面 → 斜面 → 台地の上 → 取り合い塔）
    const sx = t.x + Math.sign(-t.x) * 2.9;
    pipeRun(B, 'white:nc', [[sx, 0.9, t.z], [sx + Math.sign(-t.x) * 1.2, 0.42, t.z], [t.lineX, 0.42, t.z], [t.lineX, 0.42, -TOPZ - RUN - 0.4], [t.lineX, HS + 0.42, -TOPZ + 0.3], [t.lineX, HS + 0.42, -8.2]], t.r, ground);
    // 表記（球の正面に貼った板）
    const tex = canvasTex(256, 128, (ctx) => { ctx.fillStyle = '#e4e6e8'; ctx.fillRect(0, 0, 256, 128); ctx.fillStyle = '#26303c'; ctx.font = '900 84px "Arial Black", Impact, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t.name, 128, 68); });
    const patch = new THREE.Mesh(new THREE.SphereGeometry(R + 0.012, 16, 8, Math.PI / 2 - 0.36, 0.72, Math.PI / 2 - 0.56, 0.36), new THREE.MeshStandardNodeMaterial({ map: tex, roughness: 0.55 }));
    patch.position.set(t.x, CY, t.z); patch.receiveShadow = true;
    lc.add(patch);
  }
  // 灯油のタンク（横置き 3 本）
  for (let i = 0; i < 3; i++) {
    const z = 12.2 + i * 2.15;
    B.tube('white', [31.4, 1.25, z], [36.6, 1.25, z], 0.85, 22);
    B.sph('white', 0.85, 31.4, 1.25, z, 18, 12); B.sph('white', 0.85, 36.6, 1.25, z, 18, 12);
    for (const x of [32.3, 35.7]) B.box('conc', 0.4, 0.9, 1.5, x, 0.45, z);
    B.tube('galv:nc', [34, 2.1, z], [34, 2.5, z], 0.12, 8);
  }
  B.box('conc', 7.2, 0.1, 7.6, 34, 0.05, 14.35);
  pipeRun(B, 'galv:nc', [[31.0, 0.4, 11.0], [27.5, 0.4, 11.0], [27.5, 0.4, 9.6]], 0.06, ground);
}

/** 作業車（箱形のバン） */
function van(B, x, y, z, ry, body = 'white') {
  B.at(x, y, z, ry);
  B.box(body, 1.3, 0.3, 0.56, 0, 0.33, 0);
  B.box(body, 0.95, 0.3, 0.54, -0.16, 0.62, 0);
  B.box('glass:nc', 0.3, 0.2, 0.55, 0.3, 0.6, 0, 0, 0, -0.5);
  B.box('glass:nc', 0.5, 0.16, 0.555, -0.2, 0.64, 0);
  for (const sx of [-0.4, 0.4]) for (const sz of [-0.27, 0.27]) B.tube('dark', [sx, 0.14, sz - 0.05], [sx, 0.14, sz + 0.05], 0.14, 12);
  B.box('dark:nc', 0.06, 0.1, 0.5, 0.66, 0.24, 0);
  B.home();
}

/** まわりの施設：建屋・柵と門・守衛所・看板 */
function buildSite(B, M, lc) {
  // 作業車と、窒素の運搬タンク
  van(B, 17.6, 0, 27.4, 1.45); van(B, 19.4, 0, 27.9, 1.52, 'gray'); van(B, -7.6, HS, 12.1, 0.3);
  B.at(10.4, HS, -11.6, 0.2);
  B.tube('white', [-0.8, 0.52, 0], [0.8, 0.52, 0], 0.3, 16); B.sph('white', 0.3, -0.8, 0.52, 0, 14, 10); B.sph('white', 0.3, 0.8, 0.52, 0, 14, 10);
  B.box('dark', 1.9, 0.08, 0.5, 0, 0.2, 0);
  for (const sx of [-0.6, 0.6]) for (const sz of [-0.27, 0.27]) B.tube('dark', [sx, 0.12, sz - 0.04], [sx, 0.12, sz + 0.04], 0.12, 10);
  B.home();
  // 斜面に埋まった機器室の入口（+Z 側・道の左）
  B.box('conc', 3.4, 1.9, 3.6, -11, 0.95, TOPZ + RUN - 1.2);
  B.box('conc', 3.8, 0.16, 4.0, -11, 1.98, TOPZ + RUN - 1.2);
  B.box('dark', 1.5, 1.3, 0.06, -11, 0.66, TOPZ + RUN + 0.62);
  B.box('gray:nc', 0.05, 1.3, 0.07, -11, 0.66, TOPZ + RUN + 0.64);
  B.box('work:nc', 0.5, 0.07, 0.1, -11, 1.5, TOPZ + RUN + 0.64);
  B.tube('galv', [-12.2, 2.0, TOPZ + RUN - 2.0], [-12.2, 2.9, TOPZ + RUN - 2.0], 0.26, 12);
  // 管制の小屋（道の右）
  B.at(14.5, 0, 30.5, -0.12);
  B.box('conc2', 6.2, 1.5, 3.4, 0, 0.75, 0);
  B.box('gray', 6.6, 0.12, 3.8, 0, 1.56, 0);
  B.box('dark', 0.5, 0.95, 0.05, -1.9, 0.48, 1.72);
  for (const x of [-0.5, 0.6, 1.7]) B.box('glass:nc', 0.8, 0.42, 0.04, x, 0.95, 1.71);
  for (const x of [-2.0, 0.2]) { B.box('gray', 0.9, 0.42, 0.7, x, 1.83, -0.6); B.box('dark:nc', 0.6, 0.3, 0.72, x, 1.83, -0.6); }
  B.tube('galv:nc', [2.4, 1.6, 0.9], [2.4, 4.4, 0.9], 0.035, 6);
  B.tube('galv:nc', [2.1, 3.9, 0.9], [2.7, 3.9, 0.9], 0.02, 5);
  B.home();
  // 柵（八角形・半径 41.5）。+Z に門、+X はクローラーウェイのために開ける
  const RF = 41.5, post = (x, z) => B.beam('galv:nc', [x, 0, z], [x, 1.05, z], 0.06);
  for (let k = 0; k < 8; k++) {
    const a0 = (22.5 + 45 * k) * (Math.PI / 180), a1 = (22.5 + 45 * (k + 1)) * (Math.PI / 180);
    const A = [Math.cos(a0) * RF, Math.sin(a0) * RF], Bv = [Math.cos(a1) * RF, Math.sin(a1) * RF];
    const len = Math.hypot(Bv[0] - A[0], Bv[1] - A[1]);
    const gap = k === 1 ? 6.2 : k === 7 ? 12.5 : 0;      // k=1：+Z の辺、k=7：+X の辺
    const parts = gap ? [[0, 0.5 - gap / len], [0.5 + gap / len, 1]] : [[0, 1]];
    for (const [f0, f1] of parts) {
      const n = Math.max(1, Math.round(((f1 - f0) * len) / 2.65));
      let prev = null;
      for (let i = 0; i <= n; i++) {
        const f = f0 + ((f1 - f0) * i) / n, x = A[0] + (Bv[0] - A[0]) * f, z = A[1] + (Bv[1] - A[1]) * f;
        post(x, z);
        if (prev) for (const y of [0.3, 0.64, 0.98]) B.beam('galv:nc', [prev[0], y, prev[1]], [x, y, z], 0.018);
        prev = [x, z];
      }
    }
  }
  // 門（開いている）と守衛所
  const gz = RF * Math.cos(Math.PI / 8);
  for (const s of [1, -1]) {
    B.beam('galv:nc', [s * 6.2, 0, gz], [s * 6.2, 1.3, gz], 0.12);
    const gx = (f) => s * 6.2 + s * 0.9 * f, gzz = (f) => gz + 3.5 * f;      // 外へ開いた扉（枠・縦の桟・筋かい）
    B.beam('galv:nc', [gx(0), 0.1, gzz(0)], [gx(1), 0.1, gzz(1)], 0.04); B.beam('galv:nc', [gx(0), 1.05, gzz(0)], [gx(1), 1.05, gzz(1)], 0.04);
    for (let i = 1; i <= 9; i++) B.beam('galv:nc', [gx(i / 9), 0.1, gzz(i / 9)], [gx(i / 9), 1.05, gzz(i / 9)], i === 9 ? 0.04 : 0.018);
    B.beam('galv:nc', [gx(0), 0.1, gzz(0)], [gx(1), 1.05, gzz(1)], 0.022);
  }
  B.at(8.6, 0, gz + 1.2);
  B.box('conc2', 1.3, 1.2, 1.3, 0, 0.6, 0); B.box('gray', 1.7, 0.08, 1.7, 0, 1.24, 0);
  B.box('glass:nc', 1.32, 0.4, 0.9, 0, 0.85, 0); B.box('glass:nc', 0.9, 0.4, 1.32, 0, 0.85, 0);
  B.home();
  // 看板（門の左）
  const sign = canvasTex(640, 256, (ctx) => {
    ctx.fillStyle = '#e3bd1f'; ctx.fillRect(0, 0, 640, 256); ctx.strokeStyle = '#17181a'; ctx.lineWidth = 10; ctx.strokeRect(9, 9, 622, 238);
    pixText(ctx, 'LAUNCH PAD 39-AI', 320, 36, 6, '#17181a', { align: 'center' });
    pixText(ctx, 'AUTHORIZED', 320, 112, 6, '#17181a', { align: 'center' });
    pixText(ctx, 'AI ONLY', 320, 176, 6, '#b3261e', { align: 'center' });
  });
  const sm = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.92), new THREE.MeshStandardNodeMaterial({ map: sign, roughness: 0.6 }));
  sm.position.set(-9.2, 1.2, gz + 0.4); sm.rotation.y = 0.18; sm.castShadow = true; sm.receiveShadow = true;
  lc.add(sm);
  for (const dx of [-1.0, 1.0]) B.beam('galv', [-9.2 + dx, 0, gz + 0.36 - dx * 0.18], [-9.2 + dx, 1.8, gz + 0.36 - dx * 0.18], 0.07);
}

/** クローラーウェイ（砂利を盛った 2 本の帯）。坂の下から +X へ */
function buildCrawlerway(B) {
  const X1 = 116;
  for (const s of [1, -1]) {
    const za = s * LANE0, zb = s * LANE1;
    B.quad('gravel', [RAMPX, BED, za], [X1, BED, za], [X1, BED, zb], [RAMPX, BED, zb], [0, 1, 0]);
    B.quad('gravel', [RAMPX, BED, zb], [X1, BED, zb], [X1, -0.3, zb + s * 0.9], [RAMPX, -0.3, zb + s * 0.9], [0, 0.5, s]);
    B.quad('gravel', [RAMPX, BED, za], [X1, BED, za], [X1, -0.3, za - s * 0.9], [RAMPX, -0.3, za - s * 0.9], [0, 0.5, -s]);
    B.quad('gravel', [X1, BED, za], [X1, BED, zb], [X1 + 1.2, -0.3, zb], [X1 + 1.2, -0.3, za], [1, 0.5, 0]);
  }
}

/** 発射塔（LUT）：柱・梁・筋かい・床・手すり・階段・昇降機の芯・配管・作業灯・頂上のクレーン。座標は塔の足もとが原点 */
function buildTower(B, HI) {
  const h = TW, n = Math.round(TH / LV);
  for (const [x, z] of [[-h, -h], [h, -h], [h, h], [-h, h]]) B.box('red', 0.3, TH, 0.3, x, TH / 2, z);
  for (let k = 0; k <= n; k++) {
    const y = k * LV;
    B.box('red', 2 * h, 0.24, 0.14, 0, y, -h); B.box('red', 2 * h, 0.24, 0.14, 0, y, h);
    B.box('red', 0.14, 0.24, 2 * h, -h, y, 0); B.box('red', 0.14, 0.24, 2 * h, h, y, 0);
    if (k < n) {
      const y1 = y + 0.12, y2 = y + LV - 0.12;
      for (const s of [1, -1]) {
        B.beam('red', [-h, y1, s * h], [0, y2, s * h], 0.11); B.beam('red', [h, y1, s * h], [0, y2, s * h], 0.11);
        B.beam('red', [s * h, y1, -h], [s * h, y2, 0], 0.11); B.beam('red', [s * h, y1, h], [s * h, y2, 0], 0.11);
        B.box('red', 0.46, 0.3, 0.05, 0, y2 - 0.06, s * (h + 0.03)); B.box('red', 0.05, 0.3, 0.46, s * (h + 0.03), y2 - 0.06, 0);   // 継ぎ手の板
      }
      // 階段（1 階ごとに折り返す）
      const xe = ((k + 1) % 2 ? 1 : -1) * 0.85;
      stair(B, [-xe, y + 0.12, -1.18], [xe, y + LV + 0.12, -1.18], 0.5, 10);
      B.box('dark:nc', 0.03, 0.62, 0.42, -0.72 + 0.585, y + 0.46, 0.62);        // 昇降機の扉
    }
    if (k >= 1) {
      B.box('grate', 3.1, 0.05, 2.3, 0, y + 0.1, 0.4);
      B.box('grate', 0.72, 0.05, 0.85, (k % 2 ? 1 : -1) * 1.2, y + 0.1, -1.18);
      rail(B, [-1.5, y + 0.12, 1.52], [1.5, y + 0.12, 1.52], 0.75);
      rail(B, [-1.5, y + 0.12, -1.6], [1.5, y + 0.12, -1.6], 0.75);
      rail(B, [1.52, y + 0.12, -1.5], [1.52, y + 0.12, 1.5], 0.75);
      rail(B, [-1.52, y + 0.12, -1.5], [-1.52, y + 0.12, 1.5], 0.75);
      B.box('galv:nc', 0.08, 0.08, 2.7, -h - 0.22, y - 0.35, 0);
      for (const [x, z] of [[h + 0.1, 1.2], [h + 0.1, -1.2], [-h - 0.1, 1.2], [0.9, h + 0.1], [-0.9, h + 0.1], [0.9, -h - 0.1]]) B.box('work:nc', 0.2, 0.09, 0.2, x, y - 0.2, z);
    }
  }
  // 昇降機の芯
  B.box('core', 1.15, TH - 0.3, 1.15, -0.72, TH / 2, 0.62);
  // 縦の配管の束（塔の背面）と配線の棚（-Z 面）
  for (const [z, r, key] of [[-1.15, 0.1, 'white'], [-0.85, 0.065, 'galv'], [-0.6, 0.065, 'galv'], [-0.3, 0.05, 'pipeR'], [0.05, 0.12, 'white'], [0.45, 0.05, 'yellow'], [0.75, 0.085, 'galv'], [1.1, 0.06, 'galv']]) B.tube(key + ':nc', [-h - 0.3, -0.3, z], [-h - 0.3, TH - 0.8, z], r, 8);
  B.box('galv:nc', 0.55, TH - 1, 0.06, 0.95, TH / 2 - 0.5, -h - 0.14);
  // 頂上の床
  const y0 = TH + 0.14;
  B.box('gray', 3.9, 0.14, 3.9, 0, TH + 0.07, 0);
  for (const s of [1, -1]) { rail(B, [-1.9, y0, s * 1.9], [1.9, y0, s * 1.9], 0.76); rail(B, [s * 1.9, y0, -1.9], [s * 1.9, y0, 1.9], 0.76); }
  // ---- ハンマーヘッドクレーン
  B.tube('dark', [0, y0, 0], [0, y0 + 0.45, 0], 1.15, 24);
  B.box('gray', 2.6, 0.16, 2.3, 0, y0 + 0.53, 0);
  const xs = []; for (let x = -4.4; x <= 9.61; x += 1.0) xs.push(x);
  const yb = y0 + 0.7, top = (x) => y0 + (x < 5.6 ? 1.95 : 1.95 - (x - 5.6) * 0.2), zh = 0.55;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i], yt = top(x);
    for (const s of [1, -1]) B.beam('red', [x, yb, s * zh], [x, yt, s * zh], 0.07);
    B.beam('red', [x, yb, -zh], [x, yb, zh], 0.06); B.beam('red', [x, yt, -zh], [x, yt, zh], 0.06);
    if (i < xs.length - 1) {
      const x2 = xs[i + 1], yt2 = top(x2);
      for (const s of [1, -1]) {
        B.beam('red', [x, yb, s * zh], [x2, yb, s * zh], 0.11);
        B.beam('red', [x, yt, s * zh], [x2, yt2, s * zh], 0.11);
        if (i % 2) B.beam('red', [x, yb, s * zh], [x2, yt2, s * zh], 0.06); else B.beam('red', [x, yt, s * zh], [x2, yb, s * zh], 0.06);
      }
      if (i % 2) B.beam('red', [x, yt, -zh], [x2, yt2, zh], 0.05); else B.beam('red', [x, yt, zh], [x2, yt2, -zh], 0.05);
    }
  }
  B.box('white', 2.2, 1.2, 1.5, -2.9, y0 + 2.57, 0);                       // 機械室
  B.box('dark:nc', 0.9, 0.5, 1.52, -2.9, y0 + 2.6, 0);
  B.box('dark', 1.0, 0.8, 1.3, -4.0, y0 + 0.32, 0);                        // つり合いのおもり
  const apex = [0.4, y0 + 4.7, 0];
  for (const s of [1, -1]) { B.beam('red', [-0.6, y0 + 1.95, s * zh], apex, 0.1); B.beam('red', [1.4, y0 + 1.95, s * zh], apex, 0.1); }
  for (const s of [1, -1]) { B.beam('dark:nc', apex, [9.4, top(9.4), s * 0.5], 0.04); B.beam('dark:nc', apex, [-4.3, y0 + 1.95, s * 0.5], 0.04); }
  B.box('yellow', 0.9, 0.22, 1.25, 5.6, yb - 0.13, 0);                     // 巻き上げの台車
  B.box('white', 0.75, 0.62, 0.62, 1.5, y0 + 0.28, 0.95); B.box('glass:nc', 0.77, 0.26, 0.5, 1.5, y0 + 0.38, 0.98);   // 運転室
  B.tube('white:nc', apex, [apex[0], apex[1] + 6.2, 0], 0.07, 8, 0.025);   // 避雷針
  const warnAt = [[apex[0], apex[1] + 6.25, 0], [9.6, top(9.6) + 0.12, 0], [-4.4, y0 + 2.1, 0], [-h, y0 + 0.5, -h], [h, y0 + 0.5, h]];
  for (const p of warnAt) B.sph('warn:nc', 0.11, p[0], p[1], p[2], 10, 8);
  return { hookY: yb - 0.24, warnAt };
}

/** スイングアーム（9 本）。高さは機体の段に合わせる。g は「いっしょに動く組」（0〜4） */
function buildArms(M, lc) {
  const R = SAT.R;
  const defs = [
    { y: 5.2, g: 0, r: R }, { y: SAT.s1Top - 0.5, g: 1, r: R }, { y: SAT.s2Bot + 1.0, g: 1, r: R }, { y: (SAT.s2Bot + SAT.s2Top) / 2 + 0.8, g: 2, r: R },
    { y: SAT.s2Top - 0.6, g: 2, r: R }, { y: SAT.s3Bot + 0.9, g: 3, r: 1.08 }, { y: SAT.s3Top - 0.5, g: 3, r: 1.08 }, { y: SAT.slaTop + 0.75, g: 3, r: 0.78 },
    { y: SAT.smTop + 0.55, g: 4, r: 0.52, crew: true },
  ];
  const PX = TOWER_X + TW + 0.3, PZ = 1.15, arms = [];
  for (const d of defs) {
    const len = -d.r - 0.1 - PX, w = 0.34, hh = 0.3;
    const A = new Bag();
    const ns = Math.max(3, Math.round(len / 0.55));
    for (let j = 0; j <= ns; j++) {
      const x = (len * j) / ns;
      for (const s of [1, -1]) A.beam('redArm', [x, -hh, s * w], [x, hh, s * w], 0.05);
      A.beam('redArm', [x, hh, -w], [x, hh, w], 0.05); A.beam('redArm', [x, -hh, -w], [x, -hh, w], 0.05);
      if (j < ns) {
        const x2 = (len * (j + 1)) / ns;
        for (const s of [1, -1]) { if (j % 2) A.beam('redArm', [x, -hh, s * w], [x2, hh, s * w], 0.04); else A.beam('redArm', [x, hh, s * w], [x2, -hh, s * w], 0.04); }
        if (j % 2) A.beam('redArm', [x, hh, -w], [x2, hh, w], 0.035); else A.beam('redArm', [x, hh, w], [x2, hh, -w], 0.035);
      }
    }
    for (const s of [1, -1]) for (const y of [-hh, hh]) A.beam('redArm', [-0.25, y, s * w], [len, y, s * w], 0.085);
    A.box('grate', len, 0.03, 2 * w - 0.1, len / 2, -hh + 0.06, 0);
    // 付け根のヒンジ（塔の角）と受け
    A.tube('dark', [-0.05, -hh - 0.18, PZ], [-0.05, hh + 0.18, PZ], 0.09, 10);
    for (const y of [-hh, hh]) { A.beam('redArm', [-0.1, y, w], [-0.05, y, PZ], 0.09); A.beam('redArm', [0.75, y, w], [-0.05, y, PZ], 0.07); A.beam('redArm', [-0.25, y, -w], [-0.25, y, w], 0.085); }
    if (!d.crew) {
      A.box('gray', 0.12, 0.72, 0.8, len - 0.06, 0, 0);                   // 接続板（配管と配線の口が並ぶ）
      A.box('hatch:nc', 0.13, 0.05, 0.84, len - 0.06, 0.36, 0); A.box('hatch:nc', 0.13, 0.05, 0.84, len - 0.06, -0.36, 0);
      A.box('white', 0.5, 0.18, 0.88, len - 0.3, hh + 0.15, 0);           // 覆い
      A.tube('galv:nc', [len - 0.02, 0.13, -0.2], [len + 0.08, 0.13, -0.2], 0.085, 10);
      A.tube('galv:nc', [len - 0.02, 0.17, 0.1], [len + 0.07, 0.17, 0.1], 0.06, 8);
      A.tube('dark:nc', [len - 0.02, -0.08, 0.27], [len + 0.06, -0.08, 0.27], 0.045, 8);
      A.box('dark:nc', 0.07, 0.13, 0.3, len + 0.02, -0.17, -0.1);
      A.box('yellow:nc', 0.125, 0.06, 0.3, len - 0.06, 0.28, 0.2);
      A.tube('dark:nc', [len - 0.62, -hh, 0.18], [len - 0.14, -hh - 0.2, 0.18], 0.035, 6);
      A.tube('dark:nc', [len - 0.62, -hh, -0.18], [len - 0.14, -hh - 0.24, -0.18], 0.035, 6);
    } else {
      A.box('white', len - 0.9, 0.7, 0.72, (len - 0.9) / 2 - 0.1, 0.04, 0);   // 囲われた通路
      A.box('glass:nc', len - 1.5, 0.14, 0.74, (len - 0.9) / 2 - 0.1, 0.12, 0);
      A.box('white', 1.12, 1.02, 1.12, len - 0.56, 0.12, 0);                  // ホワイトルーム
      A.box('dark:nc', 0.03, 0.56, 0.4, len + 0.005, 0.02, 0);
    }
    const piv = new THREE.Group(); piv.position.set(PX, DECK + d.y, PZ);
    const holder = new THREE.Group(); holder.position.z = -PZ;
    A.build(M, holder);
    piv.add(holder); piv.userData.g = d.g;
    lc.add(piv); arms.push(piv);
  }
  return arms;
}

export class LaunchComplex {
  constructor(HI = false) {
    const lc = (this.root = new THREE.Group()); lc.position.set(PAD[0], PAD[1], PAD[2]);
    const M = (this.M = makeMaterials());
    const B = new Bag();
    buildMound(B); buildTrench(B); buildML(B, HI); buildPadTop(B);
    const floodAt = buildFloods(B);
    buildTanks(B, M, lc); buildSite(B, M, lc); buildCrawlerway(B);
    B.build(M, lc);

    // 塔とクレーン
    const tower = (this.tower = new THREE.Group()); tower.position.set(TOWER_X, DECK, 0);
    const Bt = new Bag();
    const { hookY, warnAt } = buildTower(Bt, HI);
    Bt.build(M, tower);
    lc.add(tower);
    this.crane = tower;
    // つり具（ワイヤの長さは scale.y で変える。先のフックは伸びないように打ち消す）
    const hook = (this.hook = new THREE.Group()); hook.position.set(-TOWER_X, hookY, 0);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 6), M.dark); cable.position.y = -0.5; hook.add(cable);
    const block = new THREE.Group(); block.position.y = -1;
    const bb = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.4, 0.2), M.yellow); bb.position.y = -0.2; bb.castShadow = true;
    const bh = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.035, 6, 14, Math.PI * 1.4), M.dark); bh.position.y = -0.52; bh.rotation.z = -2.2;
    block.add(bb, bh); hook.add(block);
    let sy = 1;
    Object.defineProperty(hook.scale, 'y', { get: () => sy, set: (v) => { sy = v; block.scale.y = 1 / v; }, configurable: true, enumerable: true });
    tower.add(hook);

    // スイングアーム
    this.arms = buildArms(M, lc);

    // 投光器の光の筋（夜だけ見える。機体へ向かう円すい）
    const bm = new THREE.MeshBasicNodeMaterial();
    bm.transparent = true; bm.depthWrite = false; bm.blending = THREE.AdditiveBlending; bm.side = THREE.DoubleSide; bm.fog = false;
    bm.colorNode = color(0xcfe0ff);
    bm.opacityNode = normalView.dot(positionViewDirection).abs().pow(1.5).mul(mix(float(0.16), float(1.0), uv().y.pow(2.0))).mul(M.uNight.mul(M.uNight)).mul(0.085);
    const aim = new THREE.Vector3(0, DECK + 19, 0);
    this.beams = floodAt.map((p) => {
      const A = new THREE.Vector3(p[0], p[1], p[2]), d = aim.clone().sub(A), len = d.length();
      const g = new THREE.CylinderGeometry(0.5, 2.7, len, 28, 1, true);
      g.translate(0, -len / 2, 0);
      const mesh = new THREE.Mesh(g, bm);
      mesh.position.copy(A); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), d.normalize());
      mesh.layers.set(FX_LAYER); mesh.castShadow = false; mesh.receiveShadow = false; mesh.renderOrder = 5;
      lc.add(mesh);
      return mesh;
    });
    // 航空障害灯（赤）
    this.warns = warnAt.map((p) => { const gs = glowSprite(0xff3a22, 2.2, { gain: 0.5, pow: 2.4 }); gs.position.set(p[0], p[1], p[2]); tower.add(gs); return gs; });
    // 投光器の光のにじみ
    this.floods = floodAt.map((p) => { const gs = glowSprite(0xfff0c0, 10, { gain: 0, pow: 2.6 }); gs.position.set(p[0], p[1], p[2]); lc.add(gs); return { gs }; });
    this.reset();
  }
  reset() { for (const a of this.arms) a.rotation.y = 0; this.hook.scale.y = 1; }
  /** アームを外へ振る（0..1）。only は組（0＝1 段目の下、1＝1・2 段目、2＝2 段目、3＝3 段目と機械船、4＝乗員用） */
  swing(k, only = -1) { for (const a of this.arms) if (only < 0 || only === a.userData.g) a.rotation.y = -k * 1.35; }
  /** 夜の灯り（0..1） */
  setNight(k) {
    const M = this.M;
    M.lamp.color.setRGB(3.2 * k, 3.0 * k, 2.4 * k);
    const kw = Math.min(1, k * 2.4);
    M.work.color.setRGB(2.6 * kw, 2.15 * kw, 1.4 * kw);
    const w = 0.35 + 0.65 * k; M.warn.color.setRGB(2.6 * w, 0.16 * w, 0.1 * w);
    M.uNight.value = k;
    for (const f of this.floods) { f.gs.userData.gain.value = 0.9 * k; f.gs.visible = k > 0.01; }
    for (const b of this.beams) b.visible = k > 0.02;
    for (const g of this.warns) g.userData.gain.value = 0.25 + 0.9 * k;
  }
}

// 作業場（workshop.js）でも使う部品
export { Bag, rail, stair, ladder, pipeRun, faceUV, gridLine, fall, nz, p2, paintMat, plateMat, galvMat, grateMat, concreteMat };
