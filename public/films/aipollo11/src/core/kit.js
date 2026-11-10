// 形と素材を手早く組むための部品箱
import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { normalView, positionViewDirection, float, vec3, color as tslColor, mix, uniform, instancedBufferAttribute } from 'three/tsl';

const geoCache = new Map();
function cached(keyStr, make) { let g = geoCache.get(keyStr); if (!g) { g = make(); geoCache.set(keyStr, g); } return g; }

const matCache = new Map();
/** 粘土のような標準素材（色・粗さ・金属・発光）。同じ指定は使い回す。 */
export function mat(hex, o = {}) {
  const k = `${hex}|${o.rough ?? 0.72}|${o.metal ?? 0}|${o.emissive ?? ''}|${o.ei ?? 1}|${o.flat ? 1 : 0}|${o.side ?? 0}|${o.opacity ?? 1}`;
  if (!o.unique && matCache.has(k)) return matCache.get(k);
  const m = new THREE.MeshStandardNodeMaterial();
  m.color.set(hex);
  m.roughness = o.rough ?? 0.72;
  m.metalness = o.metal ?? 0;
  if (o.emissive !== undefined) { m.emissive.set(o.emissive); m.emissiveIntensity = o.ei ?? 1; }
  if (o.flat) m.flatShading = true;
  if (o.side) m.side = o.side;
  if (o.opacity !== undefined && o.opacity < 1) { m.transparent = true; m.opacity = o.opacity; }
  if (!o.unique) matCache.set(k, m);
  return m;
}
/** 光らせるだけの素材（照明の影響なし） */
export function glow(hex, intensity = 1, o = {}) {
  const m = new THREE.MeshBasicNodeMaterial();
  m.color.set(hex).multiplyScalar(intensity);
  if (o.opacity !== undefined) { m.transparent = true; m.opacity = o.opacity; }
  if (o.add) { m.blending = THREE.AdditiveBlending; m.transparent = true; m.depthWrite = false; }
  if (o.side) m.side = o.side;
  return m;
}
/** 縁がふわっと光る加算（リムライト）ノード */
export function rimNode(hex, power = 2.5, amount = 0.5) {
  const ndv = normalView.dot(positionViewDirection).saturate();
  return tslColor(hex).mul(ndv.oneMinus().pow(power).mul(amount));
}

function place(m, x = 0, y = 0, z = 0) { m.position.set(x, y, z); return m; }
export function mesh(geo, material, x, y, z) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true; m.receiveShadow = true;
  return place(m, x, y, z);
}
export const box = (w, h, d, material, x, y, z) => mesh(cached(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)), material, x, y, z);
export const rbox = (w, h, d, r, material, x, y, z) => mesh(cached(`rb${w},${h},${d},${r}`, () => new RoundedBoxGeometry(w, h, d, 3, r)), material, x, y, z);
export const sph = (r, material, x, y, z, ws = 32, hs = 20) => mesh(cached(`s${r},${ws},${hs}`, () => new THREE.SphereGeometry(r, ws, hs)), material, x, y, z);
export const cyl = (rt, rb, h, material, x, y, z, seg = 32, open = false) => mesh(cached(`c${rt},${rb},${h},${seg},${open}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open)), material, x, y, z);
export const cone = (r, h, material, x, y, z, seg = 32) => mesh(cached(`k${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg)), material, x, y, z);
export const cap = (r, len, material, x, y, z) => mesh(cached(`p${r},${len}`, () => new THREE.CapsuleGeometry(r, len, 8, 20)), material, x, y, z);
export const torus = (R, r, material, x, y, z, arc = Math.PI * 2, rs = 12, ts = 48) => mesh(cached(`t${R},${r},${arc},${rs},${ts}`, () => new THREE.TorusGeometry(R, r, rs, ts, arc)), material, x, y, z);
export const plane = (w, h, material, x, y, z) => mesh(cached(`pl${w},${h}`, () => new THREE.PlaneGeometry(w, h)), material, x, y, z);
/** 回転体（輪郭 [[半径, 高さ], ...]） */
export function lathe(profile, material, seg = 32) {
  return mesh(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg), material);
}
export function grp(...children) { const g = new THREE.Group(); for (const c of children) if (c) g.add(c); return g; }
export function at(o, x, y, z) { o.position.set(x, y, z); return o; }
export function rot(o, x, y, z) { o.rotation.set(x, y, z); return o; }
export function scl(o, x, y = x, z = x) { o.scale.set(x, y, z); return o; }
export function noShadow(o) { o.traverse((c) => { c.castShadow = false; }); return o; }
export function noReceive(o) { o.traverse((c) => { c.receiveShadow = false; }); return o; }

/** コードで描くキャンバスのテクスチャ */
export function canvasTex(w, h, draw, { srgb = true, pixel = false } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (draw) draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (pixel) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; }
  t.anisotropy = 8;
  t.userData.ctx = ctx; t.userData.canvas = c;
  return t;
}
export { THREE };

// ---- 骨組み（鉄骨）をまとめて 1 つの形にする
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
const _up = new THREE.Vector3(0, 1, 0);
/** 2 点を結ぶ角材の形 */
export function beamGeo(a, b, t = 0.12, t2 = t) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const d = new THREE.Vector3().subVectors(B, A);
  const len = d.length();
  const g = new THREE.BoxGeometry(t, len, t2);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(_up, d.normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}
/** 角材の列 [[a,b,太さ?], ...] を 1 つのメッシュに */
export function struts(list, material, t = 0.12) {
  const geos = list.map(([a, b, tt]) => beamGeo(a, b, tt ?? t));
  const m = new THREE.Mesh(mergeGeometries(geos), material);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
/** 四角い鉄塔（柱 4 本＋水平材＋斜材） */
export function trussList(w, d, y0, y1, cell, o = {}) {
  const L = [];
  const hw = w / 2, hd = d / 2;
  const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  for (const [x, z] of corners) L.push([[x, y0, z], [x, y1, z], o.col ?? 0.2]);
  const n = Math.round((y1 - y0) / cell);
  for (let i = 0; i <= n; i++) {
    const y = y0 + (i * (y1 - y0)) / n;
    for (let k = 0; k < 4; k++) { const a = corners[k], b = corners[(k + 1) % 4]; L.push([[a[0], y, a[1]], [b[0], y, b[1]], o.bar ?? 0.11]); }
    if (i < n) {
      const y2 = y0 + ((i + 1) * (y1 - y0)) / n;
      for (let k = 0; k < 4; k++) {
        const a = corners[k], b = corners[(k + 1) % 4];
        if ((i + k) % 2) L.push([[a[0], y, a[1]], [b[0], y2, b[1]], o.diag ?? 0.08]); else L.push([[b[0], y, b[1]], [a[0], y2, a[1]], o.diag ?? 0.08]);
      }
    }
  }
  return L;
}
export { mergeGeometries };

/**
 * インスタンスごとの属性（vec4）。
 * r187 は型付き配列をそのまま渡すと「頂点ごと」の扱いになるため、インスタンス用のバッファに包んで渡す。
 */
export function iattr(array, itemSize = 4) {
  const buf = new THREE.InstancedInterleavedBuffer(array, itemSize, 1);
  return instancedBufferAttribute(buf, itemSize === 4 ? 'vec4' : itemSize === 3 ? 'vec3' : 'float').setInstanced(true);
}
