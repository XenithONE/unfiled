// サターン V 型ロケットの部品箱：形をまとめる道具と、塗装・金属・断熱箔の素材（すべて手続き）
import * as THREE from 'three/webgpu';
import {
  positionLocal, normalView, modelViewMatrix, attribute, texture, vec2, vec3, vec4, float, color, mix, smoothstep,
  fract, floor, sin, cos, abs, max, min, atan, length, normalize, dFdx, dFdy, dot, mx_noise_float, mx_noise_vec3, mx_fractal_noise_float,
} from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash1 } from '../core/util.js';

const TAU = Math.PI * 2;
export const v2 = (r, y) => new THREE.Vector2(r, y);

// ---- 色（sRGB の 16 進。Bag が線形に直す）
export const C = {
  white: 0xe8e8e5, black: 0x242528, red: 0xc2261c,
  dark: 0x33363c, steel: 0xb4b9c1, foil: 0xc3c6cb, ext: 0x4d4741, primer: 0x8c9647, shield: 0x40392f,
  tube: 0xaeb3bb, boot: 0x26262a, alu: 0xb9bcc0, kapton: 0xcbb98c,
};

// =====================================================================
// 形をまとめる袋：頂点ごとに 色・粗さ・金属 を持たせ、1 つのメッシュにする
// =====================================================================
export class Bag {
  constructor() { this.list = []; }
  /** fn(x,y,z) → [r,g,b]（線形）を渡すと頂点ごとに色を決められる */
  add(geo, hex = 0xffffff, rough = 0.5, metal = 0, fn = null) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.attributes.normal) g.computeVertexNormals();
    const pos = g.attributes.position, n = pos.count;
    const c = new THREE.Color(hex);
    const col = new Float32Array(n * 3), pbr = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      if (fn) { const v = fn(pos.getX(i), pos.getY(i), pos.getZ(i)); col[i * 3] = v[0]; col[i * 3 + 1] = v[1]; col[i * 3 + 2] = v[2]; }
      else { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      pbr[i * 2] = rough; pbr[i * 2 + 1] = metal;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(Float32Array.from(pos.array.subarray(0, n * 3)), 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(Float32Array.from(g.attributes.normal.array.subarray(0, n * 3)), 3));
    out.setAttribute('acol', new THREE.Float32BufferAttribute(col, 3));
    out.setAttribute('apbr', new THREE.Float32BufferAttribute(pbr, 2));
    this.list.push(out);
    return this;
  }
  get empty() { return this.list.length === 0; }
  mesh(material, o = {}) {
    const m = new THREE.Mesh(mergeGeometries(this.list, false), material);
    m.castShadow = o.cast ?? true; m.receiveShadow = o.receive ?? true;
    return m;
  }
}

// ---- 形の小道具
/** 拡大 → 回転 → 移動 */
export function xf(geo, { p = [0, 0, 0], r = [0, 0, 0], s = 1 } = {}) {
  const sc = typeof s === 'number' ? [s, s, s] : s;
  geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2])), new THREE.Vector3(...sc)));
  return geo;
}
/** 「+Z が外向き・+Y が上」で作った部品を、方位 th・半径 rad・高さ y に置く */
export function atAz(geo, th, rad, y = 0) { geo.translate(0, y, rad); geo.rotateY(th); return geo; }
const _up = new THREE.Vector3(0, 1, 0);
/** 2 点を結ぶ丸棒 */
export function rod(a, b, r = 0.02, seg = 6, r2 = r) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const d = new THREE.Vector3().subVectors(B, A), len = d.length();
  const g = new THREE.CylinderGeometry(r2, r, len, seg, 1, false);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(_up, d.normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}
/** 縦に走る半円のカバー（配線トンネル・配管の覆い）。+Z が外向き。 */
export function halfTube(w, d, y0, y1, seg = 10) {
  const g = new THREE.CylinderGeometry(1, 1, y1 - y0, seg, 1, false, -Math.PI / 2, Math.PI);
  g.scale(w / 2, 1, d); g.translate(0, (y0 + y1) / 2, 0);
  return g;
}
/** 水平の輪（トーラス）。高さ y・半径 R・太さ t */
export function hoop(R, y, t = 0.012, seg = 40, tube = 6) {
  const g = new THREE.TorusGeometry(R, t, tube, seg);
  g.rotateX(Math.PI / 2); g.translate(0, y, 0);
  return g;
}
/** 輪郭 [[r,y],...] の途中の半径 */
export function rAt(profile, y) {
  for (let i = 0; i < profile.length - 1; i++) {
    const [r0, y0] = profile[i], [r1, y1] = profile[i + 1];
    if ((y >= y0 && y <= y1) || (y <= y0 && y >= y1)) return r0 + (r1 - r0) * ((y - y0) / (y1 - y0 || 1));
  }
  return profile[profile.length - 1][0];
}
export const latheOf = (profile, seg = 32, dr = 0) => new THREE.LatheGeometry(profile.map(([r, y]) => v2(Math.max(0.0005, r + dr), y)), seg);
/** 断面（同じ点数の輪）を順につないだ立体。面ごとの陰影で使う。 */
export function loft(sections, capEnd = true) {
  const pos = [];
  const tri = (a, b, c) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  const n = sections[0].length;
  for (let i = 0; i < sections.length - 1; i++) for (let j = 0; j < n; j++) {
    const a = sections[i][j], b = sections[i][(j + 1) % n], c = sections[i + 1][(j + 1) % n], d = sections[i + 1][j];
    tri(a, b, c); tri(a, c, d);
  }
  if (capEnd) { const s = sections[sections.length - 1]; for (let j = 1; j < n - 1; j++) tri(s[0], s[j], s[j + 1]); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
/** しわ：頂点を少しずらす（同じ位置の頂点は同じだけ動く） */
export function crinkle(geo, amt) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = Math.round(x * 211.1) * 1.7 + Math.round(y * 197.3) * 3.1 + Math.round(z * 223.9) * 5.3;
    p.setXYZ(i, x + (hash1(k) - 0.5) * amt, y + (hash1(k + 9.1) - 0.5) * amt, z + (hash1(k + 4.7) - 0.5) * amt);
  }
  geo.computeVertexNormals();
  return geo;
}
/** エンジンの覆い（フェアリング）：胴の肌から生えて、下へ広がる斜めの円すい。+Z が外向き。 */
export function fairingGeo({ cTop, yTop, cBot, yBot, rhoBot, segA = 30, segU = 16, pow = 0.92, phiMax = Math.PI * 0.82 }) {
  const pos = [], idx = [];
  for (let iu = 0; iu <= segU; iu++) {
    const u = iu / segU, c = cTop + (cBot - cTop) * u, y = yTop + (yBot - yTop) * u, rho = rhoBot * Math.pow(u, pow);
    for (let ia = 0; ia <= segA; ia++) { const phi = -phiMax + (2 * phiMax * ia) / segA; pos.push(rho * Math.sin(phi), y, c + rho * Math.cos(phi)); }
  }
  const W = segA + 1;
  for (let iu = 0; iu < segU; iu++) for (let ia = 0; ia < segA; ia++) { const a = iu * W + ia, b = a + 1, c = a + W, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
/** フィン（後退した前縁・くさび形の断面）。根元は rootTop→rootBot、先端は z=zTip の縦の辺。+Z が外向き・x が厚み。 */
export function finGeo({ rootTop, rootBot, zTip, tipTop, tipBot, tRoot = 0.15, tTip = 0.055 }) {
  const sec = (zt, yt, zb, yb, t) => {
    const P = (k, s, w) => new THREE.Vector3(s * w * 0.5, yt + (yb - yt) * k, zt + (zb - zt) * k);
    return [P(0, 1, 0.012), P(0.38, 1, t), P(1, 1, t * 0.3), P(1, -1, t * 0.3), P(0.38, -1, t), P(0, -1, 0.012)];
  };
  return loft([sec(rootTop[0], rootTop[1], rootBot[0], rootBot[1], tRoot), sec(zTip, tipTop, zTip, tipBot, tTip)], true);
}

// =====================================================================
// 素材
// =====================================================================
const cache = {};
/** 小物用：頂点の色・粗さ・金属をそのまま使う（flat＝面ごとの陰影。断熱箔や面取りした金物） */
export function partMaterial(flat = false) {
  const key = flat ? 'flat' : 'smooth';
  if (cache[key]) return cache[key];
  const m = new THREE.MeshStandardNodeMaterial();
  m.side = THREE.DoubleSide;
  const col = attribute('acol', 'vec3'), pbr = attribute('apbr', 'vec2');
  if (flat) { m.flatShading = true; m.colorNode = col; m.roughnessNode = pbr.x; m.metalnessNode = pbr.y; }
  else {
    const P = positionLocal;
    const g = mx_fractal_noise_float(P.mul(vec3(1.3, 0.4, 1.3)), 3, 2.0, 0.5).mul(0.5).add(0.5).clamp(0, 1);
    m.colorNode = col.mul(g.mul(-0.1).add(1.0));
    m.roughnessNode = pbr.x.add(g.mul(0.08));
    m.metalnessNode = pbr.y;
    const w = mx_noise_vec3(P.mul(3.1));
    m.normalNode = normalize(normalView.add(w.sub(normalView.mul(dot(w, normalView))).mul(0.018)));
  }
  return (cache[key] = m);
}
/** ノズルの内側：すすけた黒。噴射中は奥（のど）ほど白熱する。頂点の色 r＝0（出口）〜1（のど） */
export function linerMaterial(uHot, hotHex) {
  const m = new THREE.MeshStandardNodeMaterial();
  m.side = THREE.DoubleSide;
  m.colorNode = vec3(0.014, 0.012, 0.011); m.roughness = 0.82; m.metalness = 0.3;
  const k = attribute('acol', 'vec3').x;
  m.emissiveNode = color(hotHex).mul(uHot).mul(k.mul(k).mul(5.0).add(0.22));
  return m;
}

/**
 * 噴射中、ノズルのすぐ下に見える黒い帯（燃料の多いタービン排気の膜）。下の縁はちぎれて、そこから炎が白熱する。
 * 頂点の色 r＝0（出口）〜1（下端）、g＝エンジンごとのずれ
 */
export function sootMaterial(uT, uP) {
  const m = new THREE.MeshBasicNodeMaterial();
  m.side = THREE.DoubleSide; m.fog = false;
  const a = attribute('acol', 'vec3'), P = positionLocal;
  const n1 = mx_fractal_noise_float(vec3(P.x.mul(3.4), P.y.mul(1.6).add(uT.mul(9.0)).add(a.y.mul(7.0)), P.z.mul(3.4)), 3, 2.0, 0.55).mul(0.5).add(0.5);
  const edge = a.x.add(n1.sub(0.5).mul(0.8));
  m.colorNode = vec3(0.03, 0.022, 0.017).mul(n1.mul(0.8).add(0.6)).add(color(0xff7a2a).mul(smoothstep(0.3, 0.62, edge).pow(2.0)).mul(2.2));
  m.opacityNode = smoothstep(0.56, 0.62, edge).oneMinus().mul(smoothstep(0.03, 0.12, uP));
  m.alphaTest = 0.5;
  return m;
}

/** 回転体の表面で使う共通の量（塗り分けの縁をなめらかにする幅など） */
function shell() {
  const P = positionLocal, y = P.y;
  const r = max(length(P.xz), 0.001);
  const ang = atan(P.x, P.z);
  const wArc = max(length(dFdx(P.xz)), length(dFdy(P.xz))).max(1e-5);   // 1 画素が表面で占める幅（水平）
  const wAng = wArc.div(r);
  const wY = abs(dFdx(y)).add(abs(dFdy(y))).max(1e-5);
  const aa = (x, w) => x.div(w).add(0.5).clamp(0, 1);
  const band = (y0, y1) => aa(y.sub(y0), wY).mul(aa(y.sub(y1).negate(), wY));
  const dAng = (th) => abs(fract(ang.sub(th).div(TAU).add(0.5)).sub(0.5)).mul(TAU);
  const sector = (th, half) => aa(dAng(th).sub(half).negate(), wAng);
  /** n 等分の位置に並ぶ窓（th0 から） */
  const sectorN = (n, th0, half) => aa(abs(fract(ang.sub(th0).mul(n / TAU).add(0.5)).sub(0.5)).mul(TAU / n).sub(half).negate(), wAng);
  /** 細い線（距離 d・半分の太さ hw・画素の幅 w）。遠くでは薄くなって消える */
  const line = (d, hw, w) => aa(d.sub(hw).negate(), w).mul(min(float(1.0), float(hw * 2).div(w)));
  const soft = (y0, y1, e = 0.2) => smoothstep(y0 - e, y0 + e, y).mul(smoothstep(y1 - e, y1 + e, y).oneMinus());
  const tL = vec3(P.z.div(r), 0, P.x.div(r).negate());
  const tV = normalize(modelViewMatrix.mul(vec4(tL, 0.0)).xyz);            // 周方向（視点の座標）
  const uV = normalize(modelViewMatrix.mul(vec4(0.0, 1.0, 0.0, 0.0)).xyz); // 軸方向
  /** 方位 th を正面にした角度（文字の貼り付け用。継ぎ目が裏へ回る） */
  const relAng = (th) => atan(P.x.mul(Math.cos(th)).sub(P.z.mul(Math.sin(th))), P.z.mul(Math.cos(th)).add(P.x.mul(Math.sin(th))));
  return { P, y, r, ang, wArc, wAng, wY, aa, band, dAng, sector, sectorN, line, soft, tV, uV, relAng };
}

/**
 * 胴の塗装：白黒の塗り分け・色帯・文字・波板（ストリンガー）・枠の輪・溶接線・うっすらした汚れ・霜。
 * cfg = { blacks, bands, letters, corr, rings, seams, frost, foam, uFrost }
 */
export function paintMaterial(cfg) {
  const m = new THREE.MeshStandardNodeMaterial();
  m.metalness = 0;
  const S = shell();
  const { P, y, r, ang, wArc, wAng, wY, aa, band, dAng, sector, line, soft, tV, uV, relAng } = S;

  // ---- 塗り分け
  let black = float(0);
  for (const b of cfg.blacks || []) black = max(black, b.th === undefined ? band(b.y0, b.y1) : band(b.y0, b.y1).mul(sector(b.th, b.half)));
  let col = mix(vec3(0.80, 0.80, 0.78), vec3(0.017, 0.018, 0.021), black);
  for (const b of cfg.bands || []) col = mix(col, b.node ? b.node(S) : color(b.hex), band(b.y0, b.y1));
  let lettered = float(0);
  for (const L of cfg.letters || []) {
    const u = relAng(L.th).div(L.dth).add(0.5), v = y.sub(L.y0).div(L.y1 - L.y0);
    const a = texture(L.tex, vec2(u, v)).a.mul(band(L.y0, L.y1)).mul(sector(L.th, L.dth / 2));
    col = mix(col, color(L.hex ?? C.red), a);
    lettered = max(lettered, a);
  }
  // ---- 点検口（四角い蓋の輪郭）
  let hatch = float(0), hatchIn = float(0);
  for (const [th, yc, w, h] of cfg.hatches || []) {
    const dx = dAng(th).mul(r), dy = abs(y.sub(yc));
    const edge = max(line(abs(dx.sub(w / 2)), 0.006, wArc).mul(aa(dy.sub(h / 2 + 0.006).negate(), wY)), line(abs(dy.sub(h / 2)), 0.006, wY).mul(aa(dx.sub(w / 2 + 0.006).negate(), wArc)));
    hatch = max(hatch, edge);
    hatchIn = max(hatchIn, aa(dx.sub(w / 2).negate(), wArc).mul(aa(dy.sub(h / 2).negate(), wY)));
  }

  // ---- 波板（縦のストリンガー）：法線を傾け、谷を少し暗く。遠くでは平均の明るさへ
  let corr = float(0), sT = float(0), ao = float(1);
  for (const [y0, y1, N, amp = 0.011] of cfg.corr || []) {
    const mk = band(y0, y1), ph = ang.mul(N), c = cos(ph).mul(0.5).add(0.5);
    const fade = smoothstep(0.16, 0.42, wAng.mul(N / TAU)).oneMinus();
    sT = sT.add(c.mul(sin(ph)).mul(mk).mul(fade).mul(amp * N).div(r));
    ao = ao.mul(mix(float(1.0), mix(float(0.9), c.mul(0.36).add(0.7), fade), mk));
    corr = max(corr, mk);
  }
  // ---- 枠の輪（盛り上がった帯）
  let ring = float(0), sY = float(0);
  const ringFade = smoothstep(0.012, 0.05, wY).oneMinus();
  for (const yr of cfg.rings || []) {
    const e = y.sub(yr).div(0.03);
    ring = max(ring, line(abs(y.sub(yr)), 0.03, wY));
    sY = sY.add(e.clamp(-1, 1).mul(smoothstep(0.7, 1.15, abs(e)).oneMinus()).mul(0.55).mul(ringFade));
  }
  // ---- 溶接線（タンク部）
  let seam = float(0);
  if (cfg.seams) {
    const { y0, pitch, nV } = cfg.seams;
    const dH = abs(fract(y.sub(y0).div(pitch).add(0.5)).sub(0.5)).mul(pitch);
    const dV = abs(fract(ang.mul(nV / TAU).add(0.5)).sub(0.5)).mul(TAU / nV).mul(r);
    seam = max(line(dH, 0.007, wY), line(dV, 0.007, wArc)).mul(corr.oneMinus());
  }
  // ---- 汚れ・筋
  const g1 = mx_fractal_noise_float(P.mul(vec3(0.9, 0.22, 0.9)), 3, 2.0, 0.5).mul(0.5).add(0.5).clamp(0, 1);
  const streak = mx_noise_float(P.mul(vec3(7.0, 0.3, 7.0))).mul(0.5).add(0.5).clamp(0, 1);
  // ---- 発泡断熱（液体水素タンク）：わずかにクリーム色で、ざらつく
  let foam = float(0);
  for (const [y0, y1] of cfg.foam || []) foam = max(foam, band(y0, y1));
  foam = foam.mul(corr.oneMinus());
  col = mix(col, col.mul(vec3(1.0, 0.972, 0.91)), foam);
  // ---- 霜（極低温タンクの外側が白く曇る）
  let fz = float(0);
  for (const [y0, y1, s] of cfg.frost || []) fz = max(fz, soft(y0, y1, 0.24).mul(s));
  const fn = mx_fractal_noise_float(P.mul(vec3(1.7, 0.8, 1.7)).add(7.3), 4, 2.0, 0.55).mul(0.5).add(0.5);
  const fine = mx_fractal_noise_float(P.mul(vec3(12.0, 5.0, 12.0)).add(3.1), 3, 2.0, 0.6).mul(0.5).add(0.5);
  const shed = smoothstep(0.56, 0.78, mx_noise_float(P.mul(vec3(4.6, 0.16, 4.6)).add(11.7)).mul(0.5).add(0.5));   // 氷が縦にはがれ落ちた跡
  const frost = smoothstep(0.0, 0.2, fz.mul(1.25).add(fn.mul(0.7)).add(streak.mul(0.2)).add(fine.mul(0.3)).sub(1.12)).mul(shed.mul(0.75).oneMinus()).mul(lettered.mul(0.8).oneMinus()).mul(cfg.uFrost ?? 0);

  col = col.mul(ao).mul(seam.mul(-0.2).add(1.0)).mul(ring.mul(-0.16).add(1.0)).mul(hatch.mul(-0.4).add(1.0)).mul(hatchIn.mul(-0.035).add(1.0)).mul(g1.mul(-0.09).add(1.0)).mul(streak.mul(streak).mul(-0.05).add(1.0));
  col = mix(col, vec3(0.84, 0.88, 0.94).mul(fine.mul(0.12).add(0.9)), frost.mul(0.92));
  m.colorNode = col;
  m.roughnessNode = mix(float(0.4).sub(black.mul(0.08)).add(corr.mul(0.1)).add(foam.mul(0.16)).add(g1.mul(0.12)), float(0.88), frost);

  // ---- 法線：波板＋枠＋外板のゆるい波打ち＋細かなざらつき
  const wav = mx_noise_vec3(P.mul(vec3(2.4, 1.3, 2.4)));
  const grainFade = smoothstep(0.004, 0.02, wArc).oneMinus();
  const grain = mx_noise_vec3(P.mul(46.0)).mul(grainFade).mul(float(0.016).add(foam.mul(0.03)).add(frost.mul(0.05)));
  const nT = sT.add(wav.x.mul(0.013)).add(grain.x);
  const nY = sY.add(wav.y.mul(0.013)).add(grain.y);
  m.normalNode = normalize(normalView.add(tV.mul(nT)).add(uV.mul(nY)));
  return m;
}

/** 機械船の外板：アルミ塗装の地・白い放熱板（配管の線）・区画の継ぎ目・スラスター周りの板 */
export function smMaterial() {
  if (cache.sm) return cache.sm;
  const m = new THREE.MeshStandardNodeMaterial();
  const { P, y, r, ang, wArc, wY, band, sector, sectorN, line, tV, uV } = shell();
  const g1 = mx_fractal_noise_float(P.mul(vec3(2.2, 1.1, 2.2)), 3, 2.0, 0.5).mul(0.5).add(0.5).clamp(0, 1);
  // 放熱板
  const ecs = max(sector(0, 0.47), sector(Math.PI, 0.47)).mul(band(0.2, 1.0));
  const eps = sectorN(8, Math.PI / 8, 0.135).mul(band(1.14, 1.43));
  const rad = max(ecs, eps);
  const tubes = line(abs(fract(y.div(0.062).add(0.5)).sub(0.5)).mul(0.062), 0.0035, wY).mul(rad);
  // スラスターの取り付け板
  const quad = sectorN(4, Math.PI / 4, 0.17).mul(band(0.8, 1.2));
  // 継ぎ目：6 区画の縦の梁、上下の輪
  const dV = abs(fract(ang.mul(6 / TAU).add(0.5)).sub(0.5)).mul(TAU / 6).mul(r);
  const seam = max(line(dV, 0.006, wArc), max(line(abs(y.sub(1.46)), 0.006, wY), line(abs(y.sub(0.1)), 0.006, wY))).mul(rad.oneMinus());
  const topRing = band(1.47, 1.6), botRing = band(0.0, 0.06);
  let col = vec3(0.60, 0.615, 0.64).mul(g1.mul(0.12).add(0.9));
  col = mix(col, vec3(0.3, 0.31, 0.33), quad);
  col = mix(col, vec3(0.8, 0.81, 0.8), rad);
  col = mix(col, vec3(0.74, 0.75, 0.77), topRing.mul(rad.oneMinus()));
  col = mix(col, vec3(0.06, 0.065, 0.07), botRing);
  col = col.mul(tubes.mul(-0.3).add(1.0)).mul(seam.mul(-0.4).add(1.0));
  m.colorNode = col;
  m.roughnessNode = mix(float(0.34).add(g1.mul(0.12)), float(0.5), max(rad, quad));
  m.metalnessNode = mix(float(0.78), float(0.05), max(rad, max(quad.mul(0.6), botRing)));
  const wav = mx_noise_vec3(P.mul(vec3(3.2, 2.0, 3.2)));
  m.normalNode = normalize(normalView.add(tV.mul(wav.x.mul(0.02))).add(uV.mul(wav.y.mul(0.02).add(tubes.mul(0.0)))));
  return (cache.sm = m);
}

/** 司令船：鏡のようなカプトンのテープを帯状に貼った肌（帯ごとに向きと粗さが少し違う） */
export function cmMaterial() {
  if (cache.cm) return cache.cm;
  const m = new THREE.MeshStandardNodeMaterial();
  const { P, y, r, ang, wArc, wY, line, tV, uV } = shell();
  const K = 23.0;
  const sy = y.sub(1.6).mul(K), id = floor(sy), f = fract(sy);
  const h1 = fract(sin(id.mul(12.9898).add(1.3)).mul(43758.5453)), h2 = fract(sin(id.mul(78.233).add(4.1)).mul(24634.6345)), h3 = fract(sin(id.mul(39.425).add(9.7)).mul(13758.1653));
  const edge = line(min(f, f.oneMinus()).div(K), 0.0022, wY);
  // 帯ごとに、縦の継ぎ目の位置をずらす
  const nV = 14;
  const dV = abs(fract(ang.div(TAU).add(h1).mul(nV).add(0.5)).sub(0.5)).mul(TAU / nV).mul(r);
  const vseam = line(dV, 0.0018, wArc);
  const g1 = mx_noise_float(P.mul(vec3(5.0, 3.0, 5.0))).mul(0.5).add(0.5);
  m.colorNode = vec3(0.86, 0.87, 0.9).mul(h2.mul(0.1).add(0.9)).mul(max(edge, vseam).mul(-0.45).add(1.0));
  m.roughnessNode = float(0.17).add(h3.mul(0.15)).add(g1.mul(0.06)).add(max(edge, vseam).mul(0.3));
  m.metalnessNode = float(0.93);
  const wav = mx_noise_vec3(P.mul(vec3(6.0, 4.0, 6.0)));
  m.normalNode = normalize(normalView.add(tV.mul(h1.sub(0.5).mul(0.05).add(wav.x.mul(0.02)))).add(uV.mul(h2.sub(0.5).mul(0.09).add(wav.y.mul(0.02)))));
  return (cache.cm = m);
}
