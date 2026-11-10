// 焚き火（夜の場面）
//   炎と煙：GPU の流体シミュレーション（燃える面から出た燃料の気体 → 燃焼 → 熱 → 浮力。燃えると膨らみ、冷えるとすすと煙になる）を体積として描く
//   薪：樹皮・切り口の年輪・炭化して亀の甲に割れた面と、その割れ目の奥で脈打つ熾火。熾の床・灰・石の囲い
//   火の粉：上昇気流に乗って曲がりながら上がる光の筋
//   光：炎の強さに合わせてゆらぐ暖色の点光源（影つき）と、熾の低い赤い光
import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, uniform, instanceIndex, textureStore, texture3D, float, uint, vec2, vec3, vec4, ivec3, uvec3,
  max, min, abs, dot, cross, sign, normalize, length, exp, mix, clamp, smoothstep, select, pow, sin, cos, fract, step, color, attribute, uv, dFdx, dFdy, fwidth,
  positionLocal, positionGeometry, positionWorld, positionView, normalLocal, normalView, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, modelWorldMatrix,
  screenUV, screenSize, viewportDepthTexture, perspectiveDepthToViewZ, cameraNear, cameraFar,
  mx_noise_float, mx_noise_vec3, mx_worley_noise_float, mx_worley_noise_vec2, mx_fractal_noise_float,
} from 'three/tsl';
import { mergeGeometries, iattr } from '../core/kit.js';
import { FX_LAYER } from '../core/engine.js';
import { mulberry, vnoise } from '../core/util.js';

// ---- 小さな道具
const sm = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const h3 = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
function n3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), f = (t) => t * t * (3 - 2 * t), u = f(x - xi), v = f(y - yi), w = f(z - zi), L = (a, b, t) => a + (b - a) * t;
  return L(L(L(h3(xi, yi, zi), h3(xi + 1, yi, zi), u), L(h3(xi, yi + 1, zi), h3(xi + 1, yi + 1, zi), u), v), L(L(h3(xi, yi, zi + 1), h3(xi + 1, yi, zi + 1), u), L(h3(xi, yi + 1, zi + 1), h3(xi + 1, yi + 1, zi + 1), u), v), w) * 2 - 1;
}
/** 手続きの高さから法線を作る（view 空間） */
function bumpN(h, scale = 1) {
  const dpdx = dFdx(positionView), dpdy = dFdy(positionView), dhdx = dFdx(h), dhdy = dFdy(h);
  const r1 = cross(dpdy, normalView), r2 = cross(normalView, dpdx), det = dot(dpdx, r1);
  return normalize(abs(det).mul(normalView).sub(sign(det).mul(dhdx.mul(r1).add(dhdy.mul(r2))).mul(scale)));
}
/** 熱さ 0..1 → 熾火の色 */
const emberCol = (k) => mix(mix(vec3(1.0, 0.1, 0.008), vec3(1.0, 0.36, 0.045), smoothstep(0.15, 0.6, k)), vec3(1.0, 0.72, 0.28), smoothstep(0.6, 1.0, k));

// =====================================================================
// 置き方（単位は m。焚き火の中心の地面が原点）
// =====================================================================
const BED_R = 0.26, BED_H = 0.085;
const bedTop = (r) => (r < BED_R ? BED_H * Math.pow(1 - (r / BED_R) ** 2, 0.8) : 0);
function layout() {
  const rnd = mulberry(1907);
  const logs = [
    // 下の井桁：太い薪を 2 本ずつ
    { a: [-0.42, 0.072, -0.17], b: [0.40, 0.072, -0.22], r: 0.072 },
    { a: [-0.40, 0.068, 0.20], b: [0.43, 0.068, 0.15], r: 0.068 },
    { a: [-0.16, 0.2, -0.40], b: [-0.21, 0.2, 0.41], r: 0.06 },
    { a: [0.19, 0.2, -0.42], b: [0.15, 0.2, 0.40], r: 0.064 },
  ];
  // 立てかけた薪（三角すい）
  for (const deg of [2, 88, 178, 268, 45]) {
    const th = deg * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
    logs.push({ a: [c * 0.41, 0.05, s * 0.41], b: [-c * 0.07 + (rnd() - 0.5) * 0.05, 0.6 + rnd() * 0.08, -s * 0.07 + (rnd() - 0.5) * 0.05], r: 0.043 + rnd() * 0.012, lean: true });
  }
  // 細い枝（流体の計算には入れない）
  const twigs = [];
  for (let i = 0; i < 9; i++) {
    const th = rnd() * 6.283, r0 = 0.1 + rnd() * 0.3, len = 0.22 + rnd() * 0.3, d = th + 1.2 + rnd() * 1.4;
    const a = [Math.cos(th) * r0, 0.02 + rnd() * 0.12, Math.sin(th) * r0];
    twigs.push({ a, b: [a[0] + Math.cos(d) * len, a[1] + (rnd() - 0.3) * 0.16, a[2] + Math.sin(d) * len], r: 0.011 + rnd() * 0.012 });
  }
  const stones = [];
  for (let i = 0; i < 11; i++) {
    const th = (i / 11) * 6.283 + (rnd() - 0.5) * 0.25, R = 0.64 + (rnd() - 0.5) * 0.07;
    stones.push({ p: [Math.cos(th) * R, 0, Math.sin(th) * R], s: [0.1 + rnd() * 0.06, 0.065 + rnd() * 0.05, 0.09 + rnd() * 0.06], ry: rnd() * 6.283, seed: 10 + i * 7.3 });
  }
  return { logs, twigs, stones };
}

// =====================================================================
// 形
// =====================================================================
function logGeo(L, seed, RS = 18, HS = 14) {
  const A = new THREE.Vector3(...L.a), B = new THREE.Vector3(...L.b);
  const len = A.distanceTo(B), r = L.r;
  const g = new THREE.CylinderGeometry(r * 0.9, r, len, RS, HS, false);
  const p = g.attributes.position, n = g.attributes.normal;
  const cap = new Float32Array(p.count), id = new Float32Array(p.count).fill(seed % 17.3);
  const rnd = mulberry(Math.round(seed * 97));
  const ph = rnd() * 10, bend = (rnd() - 0.5) * 0.06 * len, bendA = rnd() * 6.283, sl = [(rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.5];
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    cap[i] = Math.abs(n.getY(i)) > 0.9 ? 1 : 0;
    const ang = Math.atan2(z, x), v = y / len + 0.5, rr = Math.hypot(x, z);
    // 樹皮のうね（縦すじ）とこぶ。切り口の真ん中は動かさない
    const ridge = 0.06 * Math.sin(ang * 7 + ph + 2.0 * Math.sin(v * 5 + ph)) + 0.035 * Math.sin(ang * 17 + v * 9 + ph * 2) + 0.06 * vnoise(v * 6 + Math.sin(ang) * 1.3, seed);
    const k = 1 + ridge * (rr / r);
    x *= k; z *= k;
    // 切り口は少し斜め
    if (Math.abs(Math.abs(y) - len / 2) < 1e-5) y += y > 0 ? x * sl[0] + z * sl[1] : x * sl[2] + z * sl[3];
    // ゆるい曲がり
    const bw = Math.sin(v * Math.PI) * bend;
    x += Math.cos(bendA) * bw; z += Math.sin(bendA) * bw;
    p.setXYZ(i, x, y, z);
  }
  g.setAttribute('aCap', new THREE.BufferAttribute(cap, 1));
  g.setAttribute('aId', new THREE.BufferAttribute(id, 1));
  g.computeVertexNormals();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}
function stoneGeo(S) {
  const g = new THREE.IcosahedronGeometry(1, 3);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.2 * n3(x * 1.3 + S.seed, y * 1.3, z * 1.3) + 0.08 * n3(x * 3.1, y * 3.1 + S.seed, z * 3.1) + 0.03 * n3(x * 8, y * 8, z * 8 + S.seed);
    x *= k; y *= k; z *= k;
    y = Math.max(y, -0.5);
    p.setXYZ(i, x * S.s[0], (y + 0.42) * S.s[1], z * S.s[2]);
  }
  const g2 = mergeVerts(g);
  g2.rotateY(S.ry); g2.translate(S.p[0], S.p[1], S.p[2]);
  return g2;
}
/** 20 面体は頂点が面ごとに分かれているので、なめらかな法線にするためにまとめる */
function mergeVerts(g) {
  const p = g.attributes.position, map = new Map(), sum = [];
  const key = (i) => `${Math.round(p.getX(i) * 4000)},${Math.round(p.getY(i) * 4000)},${Math.round(p.getZ(i) * 4000)}`;
  g.computeVertexNormals();
  const n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) { const k = key(i); let e = map.get(k); if (!e) { e = [0, 0, 0]; map.set(k, e); } e[0] += n.getX(i); e[1] += n.getY(i); e[2] += n.getZ(i); sum.push(e); }
  for (let i = 0; i < p.count; i++) { const e = sum[i], l = Math.hypot(e[0], e[1], e[2]) || 1; n.setXYZ(i, e[0] / l, e[1] / l, e[2] / l); }
  g.deleteAttribute('uv');
  return g;
}
function bedGeo() {
  const N = 44, S = BED_R + 0.05;
  const g = new THREE.PlaneGeometry(S * 2, S * 2, N, N);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z);
    const lump = 0.5 + 0.5 * n3(x * 22, 3.3, z * 22), lump2 = 0.5 + 0.5 * n3(x * 55, 9.1, z * 55);
    p.setY(i, bedTop(r) * (0.72 + 0.4 * lump) + (r < BED_R ? 0.012 * lump2 : 0) - 0.004);
  }
  g.computeVertexNormals();
  return g;
}

// =====================================================================
// 素材
// =====================================================================
/** 薪：樹皮 → 炭 → 熾火。p は焚き火の中心が原点 */
function woodMat(uT, uK) {
  const m = new THREE.MeshStandardNodeMaterial();
  const p = positionLocal, capF = attribute('aCap', 'float'), id = attribute('aId', 'float'), u = uv();
  const r = length(p.xz);
  // 樹皮：縦に長い裂け目と細かなざらつき
  const bark = mx_fractal_noise_float(vec3(u.x.mul(26.0), u.y.mul(5.0), id.mul(7.0)), 4, 2.1, 0.55);
  const fiss = smoothstep(0.0, 0.28, mx_worley_noise_float(vec3(u.x.mul(13.0), u.y.mul(2.4), id.mul(3.0))));
  const barkH = bark.mul(0.35).add(fiss.mul(0.65)).clamp(0, 1);
  let col = mix(color(0x18110b), color(0x463326), barkH);
  col = mix(col, color(0x685440), smoothstep(0.4, 0.9, bark).mul(0.4));
  // 切り口：年輪
  const cq = u.sub(0.5), cr = length(cq);
  const ring = sin(cr.mul(92.0).add(mx_noise_float(vec3(cq.mul(8.0), id)).mul(2.6))).mul(0.5).add(0.5);
  let capCol = mix(color(0xa98052), color(0x7c5836), ring);
  capCol = mix(capCol, color(0x3d2b1d), smoothstep(0.4, 0.5, cr));
  col = mix(col, capCol, capF);
  // 炭化：火の芯に近いほど黒く焼ける。炭は木目に沿って短冊状に割れる
  const n3d = mx_fractal_noise_float(p.mul(9.0).add(id), 3, 2.0, 0.5);
  const char = smoothstep(0.16, 0.46, r.add(n3d.mul(0.09))).oneMinus().mul(smoothstep(0.62, 0.86, p.y).oneMinus()).clamp(0, 1).toVar();
  const w = mx_worley_noise_vec2(vec3(u.x.mul(20.0), u.y.mul(22.0), id.mul(5.0)));
  const edge = w.y.sub(w.x);
  const fw = fwidth(vec2(u.x.mul(20.0), u.y.mul(22.0))).length();
  const far = smoothstep(0.18, 0.65, fw).mul(capF.oneMinus());
  const crack = mix(smoothstep(0.0, 0.1, edge).oneMinus(), float(0.22), far);
  const ash = smoothstep(0.3, 0.85, mx_fractal_noise_float(p.mul(24.0).add(5.0), 3, 2.0, 0.5)).mul(0.5);
  const charCol = mix(color(0x0a0807), color(0x76716b), ash.mul(smoothstep(0.4, 0.95, char)));
  col = mix(col, charCol, smoothstep(0.05, 0.5, char));
  // 熾火：芯に向いた面の割れ目が、まだらに脈打って光る
  const core = smoothstep(0.06, 0.34, r).oneMinus().mul(smoothstep(0.36, 0.7, p.y).oneMinus());
  const facing = dot(normalLocal, normalize(vec3(0, 0.2, 0).sub(p))).clamp(0, 1);
  const patchy = smoothstep(0.3, 0.7, mx_noise_float(p.mul(6.5).add(2.0)).mul(0.5).add(0.5));
  const pulse = mx_noise_float(vec3(p.x.mul(5.0), p.y.mul(5.0).sub(uT.mul(0.3)), p.z.mul(5.0).add(uT.mul(0.2)))).mul(0.5).add(0.5);
  const shim = mx_noise_float(p.mul(16.0).add(vec3(0, uT.mul(1.9), uT.mul(0.6)))).mul(0.5).add(0.5);
  const heat = char.mul(core.mul(0.75).add(0.25)).mul(facing.mul(0.75).add(0.25)).mul(patchy).mul(pulse.mul(0.9).add(0.3)).mul(shim.mul(0.3).add(0.85)).toVar();
  const eCrack = emberCol(heat.mul(1.6).clamp(0, 1)).mul(crack).mul(heat).mul(2.6);
  const eFace = emberCol(heat.mul(0.9).clamp(0, 1)).mul(heat.mul(heat)).mul(ash.oneMinus()).mul(1.3);
  m.colorNode = col;
  m.emissiveNode = eCrack.add(eFace).mul(uK).mul(capF.oneMinus());
  m.roughnessNode = mix(float(0.96), float(0.74), smoothstep(0.3, 0.8, char).mul(ash.oneMinus()));
  m.metalness = 0;
  const hgt = mix(bark.mul(0.5).add(0.5).mul(0.004).add(fiss.mul(0.004)), smoothstep(0.0, 0.3, edge).mul(0.004), smoothstep(0.1, 0.5, char)).mul(capF.oneMinus()).mul(far.oneMinus());
  m.normalNode = bumpN(hgt, 1.0);
  return m;
}
/** 熾の床：赤く焼けた炭のかたまり（すき間ほど明るい）と白い灰 */
function bedMat(uT, uK) {
  const m = new THREE.MeshStandardNodeMaterial();
  const p = positionLocal, r = length(p.xz);
  const w = mx_worley_noise_vec2(p.mul(vec3(27.0, 34.0, 27.0)).add(3.7));
  const edge = w.y.sub(w.x);
  const coal = smoothstep(0.0, 0.13, edge);                                  // 1 = 炭の面、0 = すき間
  const lump = mx_noise_float(p.mul(12.0).add(4.0)).mul(0.5).add(0.5);
  const pulse = mx_noise_float(vec3(p.x.mul(6.0).add(uT.mul(0.15)), uT.mul(0.42), p.z.mul(6.0))).mul(0.5).add(0.5);
  const shim = mx_noise_float(p.mul(26.0).add(vec3(uT.mul(1.3), uT.mul(2.2), 0))).mul(0.5).add(0.5);
  const crust = smoothstep(0.35, 0.8, mx_fractal_noise_float(p.mul(38.0), 3, 2.0, 0.5).mul(0.5).add(0.5));
  const core = smoothstep(0.08, BED_R + 0.02, r).oneMinus();
  const heat = core.mul(lump.mul(0.7).add(0.3)).mul(pulse.mul(0.75).add(0.45)).mul(shim.mul(0.25).add(0.85)).clamp(0, 1).toVar();
  m.colorNode = mix(color(0x0d0b0a), color(0x8d8881), crust.mul(coal).mul(0.8));
  const eGap = emberCol(heat.mul(1.15).clamp(0, 1)).mul(coal.oneMinus()).mul(heat).mul(3.0);
  const eTop = emberCol(heat.mul(0.8)).mul(coal).mul(crust.mul(0.85).oneMinus()).mul(heat.mul(heat)).mul(1.1);
  m.emissiveNode = eGap.add(eTop).mul(uK);
  m.roughness = 0.9; m.metalness = 0;
  m.normalNode = bumpN(smoothstep(0.0, 0.3, edge).mul(0.008), 1.0);
  return m;
}
/** 石：火の側がすすで黒い */
function stoneMat() {
  const m = new THREE.MeshStandardNodeMaterial();
  const p = positionLocal, r = length(p.xz);
  const n1 = mx_fractal_noise_float(p.mul(7.0), 4, 2.1, 0.55), n2 = mx_fractal_noise_float(p.mul(46.0).add(9.0), 3, 2.0, 0.5);
  let col = mix(color(0x3f3c38), color(0x6a655d), n1.mul(0.5).add(0.5));
  col = mix(col, color(0x6c5a48), smoothstep(0.1, 0.6, mx_noise_float(p.mul(3.1).add(20.0))).mul(0.45));
  col = col.mul(n2.mul(0.07).add(0.96));
  const toC = normalize(vec3(0, 0.35, 0).sub(p));
  const soot = smoothstep(-0.1, 0.75, dot(normalLocal, toC)).mul(smoothstep(0.62, 0.9, r).oneMinus().mul(0.6).add(0.4)).mul(n1.mul(0.25).add(0.85));
  m.colorNode = mix(col, color(0x100e0d), soot.mul(0.88).clamp(0, 1));
  m.roughnessNode = mix(float(0.86), float(0.97), soot);
  m.metalness = 0;
  m.normalNode = bumpN(n1.mul(0.012).add(n2.mul(0.0012)), 1.0);
  return m;
}
/** 地面の灰と焦げ（半透明の敷物） */
function ashMat() {
  const m = new THREE.MeshStandardNodeMaterial();
  m.transparent = true; m.depthWrite = false;
  const p = positionLocal, r = length(p.xz);
  const n = mx_fractal_noise_float(p.mul(5.5), 4, 2.1, 0.55), f = mx_fractal_noise_float(p.mul(40.0).add(3.0), 3, 2.0, 0.5);
  const ashA = smoothstep(0.15, 0.5, r.add(n.mul(0.1))).oneMinus();
  const specks = smoothstep(0.02, 0.1, mx_worley_noise_float(p.mul(vec3(34.0, 1.0, 34.0)))).oneMinus();
  let col = mix(color(0x0d0a08), mix(color(0x35322f), color(0x55524d), f.mul(0.5).add(0.5)), ashA.mul(0.85));
  col = mix(col, color(0x0a0908), specks.mul(0.8));
  m.colorNode = col;
  m.opacityNode = smoothstep(0.4, 0.84, r.add(n.mul(0.12))).oneMinus().mul(0.9);
  m.roughness = 1; m.metalness = 0;
  return m;
}

// =====================================================================
// 炎の流体シミュレーション
// =====================================================================
function tex3(nx, ny, nz, name) {
  const t = new THREE.Storage3DTexture(nx, ny, nz);
  t.name = name; t.type = THREE.HalfFloatType; t.format = THREE.RGBAFormat;
  t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
  return t;
}
/** 固体（薪・熾の床・石）と「燃える面」を格子に焼く。r = 固体, g = 燃える強さ */
function buildGeo(nx, ny, nz, h, org, L) {
  const data = new Uint8Array(nx * ny * nz * 4);
  const caps = L.logs.map((l) => { const ba = [l.b[0] - l.a[0], l.b[1] - l.a[1], l.b[2] - l.a[2]]; return { a: l.a, ba, bb: ba[0] * ba[0] + ba[1] * ba[1] + ba[2] * ba[2], r: l.r }; });
  let i = 0;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++, i += 4) {
    const px = org[0] + (x + 0.5) * h, py = org[1] + (y + 0.5) * h, pz = org[2] + (z + 0.5) * h;
    if (py > 0.95) continue;
    const r = Math.hypot(px, pz);
    let d = 1e9;
    for (const c of caps) {
      const ax = px - c.a[0], ay = py - c.a[1], az = pz - c.a[2];
      const t = Math.min(1, Math.max(0, (ax * c.ba[0] + ay * c.ba[1] + az * c.ba[2]) / c.bb));
      d = Math.min(d, Math.hypot(ax - c.ba[0] * t, ay - c.ba[1] * t, az - c.ba[2] * t) - c.r);
    }
    const bh = bedTop(r);
    let solid = py < bh;          // 薪は流れをせき止めない（この細かさの格子では、すき間がふさがって炎がやせるため）
    if (!solid && r > 0.45) for (const s of L.stones) { const dx = (px - s.p[0]) / (s.s[0] * 1.15), dy = (py - s.s[1] * 0.42) / s.s[1], dz = (pz - s.p[2]) / (s.s[2] * 1.15); if (dx * dx + dy * dy + dz * dz < 1) { solid = true; break; } }
    let emit = 0;
    if (!solid) {
      // 燃える場所：薪の山を包む円すい（薪の面に近いほど強い）と、熾の床の上
      const rc = 0.4 * Math.pow(Math.max(0, 1 - py / 1.15), 0.8);
      const cone = (1 - sm(rc - 0.1, rc, r)) * (1 - sm(0.3, 0.52, py));
      const near = Math.max(0, 1 - Math.max(d, 0) / 0.1);
      const bed = (1 - sm(0.12, 0.27, r)) * (1 - sm(bh + 0.03, bh + 0.1, py)) * 0.8;
      emit = Math.max(cone * (0.55 + 0.45 * near), bed);
    }
    data[i] = solid ? 255 : 0; data[i + 1] = Math.round(emit * 255);
  }
  const t = new THREE.Data3DTexture(data, nx, ny, nz);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.minFilter = t.magFilter = THREE.NearestFilter; t.unpackAlignment = 1; t.needsUpdate = true;
  return t;
}

class FireSim {
  /** o: { n:[nx,ny,nz], size:[sx,sy,sz]（m）, layout, jacobi, steps（描画の歩数） } */
  constructor(renderer, o) {
    this.renderer = renderer;
    const [nx, ny, nz] = (this.n = o.n);
    const [sx, sy, sz] = (this.size = o.size);
    const h = (this.h = sx / nx);
    const org = (this.origin = [-sx / 2, 0, -sz / 2]);
    this.jacobi = o.jacobi ?? 20;
    this.dt = 1 / 60; this.tau = -1e9;
    const count = nx * ny * nz;
    const V0 = tex3(nx, ny, nz, 'fire.V0'), V1 = tex3(nx, ny, nz, 'fire.V1');   // xyz = 速度（マス/秒）, w = 燃料
    const T0 = tex3(nx, ny, nz, 'fire.T0'), T1 = tex3(nx, ny, nz, 'fire.T1');   // x = 温度, y = 煙, z = 光るすす, w = 燃える速さ
    const P0 = tex3(nx, ny, nz, 'fire.P0'), P1 = tex3(nx, ny, nz, 'fire.P1');
    const DV = tex3(nx, ny, nz, 'fire.DV'), CW = tex3(nx, ny, nz, 'fire.CW');
    const GEO = buildGeo(nx, ny, nz, h, org, o.layout);
    this.tex = { V0, V1, T0, T1, P0, P1, DV, CW, GEO };
    const U = (this.U = {
      dt: uniform(this.dt), time: uniform(0), power: uniform(1), flick: uniform(0), wind: uniform(new THREE.Vector3()),
      buoy: uniform((o.buoy ?? 3.3) / h), vort: uniform(o.vort ?? 1.0), turb: uniform((o.turb ?? 6.0) / h),
      kb: uniform(o.kb ?? 10.0), Q: uniform(o.Q ?? 4.5), c0: uniform(o.c0 ?? 2.2), c1: uniform(o.c1 ?? 3.0), ko: uniform(o.ko ?? 4.5), ys: uniform(o.ys ?? 1.0),
      fuelRate: uniform(o.fuelRate ?? 1.25), expand: uniform(o.expand ?? 0.45), smokeKeep: uniform(Math.exp(-0.45 * this.dt)), velKeep: uniform(Math.exp(-0.3 * this.dt)), drag: uniform(0.7),
    });
    const N = vec3(nx, ny, nz), invN = vec3(1 / nx, 1 / ny, 1 / nz);
    const coordsOf = (i) => uvec3(i.mod(uint(nx)), i.div(uint(nx)).mod(uint(ny)), i.div(uint(nx * ny)));
    const cl = (c) => clamp(c, ivec3(0, 0, 0), ivec3(nx - 1, ny - 1, nz - 1));
    const V0n = texture3D(V0), V1n = texture3D(V1), T0n = texture3D(T0), T1n = texture3D(T1), P0n = texture3D(P0), P1n = texture3D(P1), DVn = texture3D(DV), CWn = texture3D(CW), GEOn = texture3D(GEO);
    this.nodes = { V0n, T0n };

    this.kClear = Fn(() => {
      const c = coordsOf(instanceIndex);
      textureStore(V0, c, vec4(0)); textureStore(T0, c, vec4(0)); textureStore(P0, c, vec4(0)); textureStore(P1, c, vec4(0));
    })().compute(count).setName('fire.clear');

    // ---- 渦度
    this.kCurl = Fn(() => {
      const c = coordsOf(instanceIndex).toConst();
      const L = (dx, dy, dz) => V0n.load(cl(ivec3(c).add(ivec3(dx, dy, dz)))).xyz;
      const xp = L(1, 0, 0), xm = L(-1, 0, 0), yp = L(0, 1, 0), ym = L(0, -1, 0), zp = L(0, 0, 1), zm = L(0, 0, -1);
      const w = vec3(yp.z.sub(ym.z).sub(zp.y.sub(zm.y)), zp.x.sub(zm.x).sub(xp.z.sub(xm.z)), xp.y.sub(xm.y).sub(yp.x.sub(ym.x))).mul(0.5);
      textureStore(CW, c, vec4(w, length(w)));
    })().compute(count).setName('fire.curl');

    // ---- 移流・燃焼・力
    this.kAdvect = Fn(() => {
      const c = coordsOf(instanceIndex).toConst();
      const p = vec3(c).add(0.5).toConst();
      const v0 = V0n.load(ivec3(c)).xyz;
      const uvw = p.sub(v0.mul(U.dt)).mul(invN);
      const s = V0n.sample(uvw).level(0).toConst();
      const tt = T0n.sample(uvw).level(0).toConst();
      const g = GEOn.load(ivec3(c)).toConst();
      const vel = s.xyz.mul(U.velKeep).toVar();
      const fuel = s.w.toVar();
      const temp = tt.x.toVar(), smoke = tt.y.mul(U.smokeKeep).toVar(), lum = tt.z.toVar();
      const pm = p.mul(h).add(vec3(org[0], org[1], org[2])).toConst();          // m
      // 燃える面から燃料の気体が出る。よく燃える場所はゆっくり移り変わり、全体も息をする
      const pq = vec3(pm.x.mul(6.5), pm.y.mul(5.0).sub(U.time.mul(2.2)), pm.z.mul(6.5));
      const patch = smoothstep(0.4, 0.62, mx_noise_float(pq).mul(0.42).add(mx_noise_float(pq.mul(2.3).add(7.0)).mul(0.16)).add(0.5).add(U.flick));
      const e = g.g.mul(patch.mul(0.85).add(0.15)).mul(U.power).toConst();
      fuel.assign(max(fuel, e.mul(U.fuelRate)));
      temp.assign(max(temp, e.mul(0.9)));
      // 燃焼：熱があれば燃え、熱と「光るすす」を出す。光るすすはすぐ燃え尽きる
      const burn = U.kb.mul(fuel).mul(smoothstep(0.08, 0.3, temp)).toConst();
      fuel.subAssign(burn.mul(U.dt));
      temp.addAssign(burn.mul(U.Q).mul(U.dt));
      temp.subAssign(temp.mul(U.c0.add(U.c1.mul(temp).mul(temp))).mul(U.dt));
      lum.addAssign(burn.sub(lum.mul(U.ko)).mul(U.dt));
      smoke.addAssign(burn.mul(U.ys).mul(smoothstep(0.5, 1.3, temp).oneMinus()).mul(U.dt));   // すすは炎の冷えた縁と先で残る
      // 浮力（熱い気体は上へ）
      const lift = temp.mul(U.buoy).mul(U.dt);
      // 乱れ：上へ流れる雑音の力（舌がちぎれるきっかけ）
      const np = pm.mul(8.5).add(vec3(0.0, U.time.mul(-2.6), U.time.mul(0.7)));
      const tf = mx_noise_vec3(np).mul(U.turb).mul(temp.clamp(0, 1)).mul(U.dt);
      // 渦の閉じ込め（格子でなまった渦を取り戻す）
      const wc = CWn.load(ivec3(c));
      const M = (dx, dy, dz) => CWn.load(cl(ivec3(c).add(ivec3(dx, dy, dz)))).w;
      const gw = vec3(M(1, 0, 0).sub(M(-1, 0, 0)), M(0, 1, 0).sub(M(0, -1, 0)), M(0, 0, 1).sub(M(0, 0, -1))).mul(0.5);
      const conf = gw.div(length(gw).add(0.0001)).cross(wc.xyz).mul(U.vort).mul(U.dt);
      // そよ風：まわりの空気はゆっくり風の速さへ寄る
      const wd = U.wind.sub(vel).mul(U.drag).mul(U.dt);
      vel.assign(vec3(vel.x.add(tf.x).add(conf.x).add(wd.x), vel.y.add(lift).add(tf.y).add(conf.y), vel.z.add(tf.z).add(conf.z).add(wd.z)));
      // 地面・固体・箱のふち
      const onFloor = c.y.equal(uint(0));
      vel.assign(vec3(vel.x.mul(select(onFloor, 0.9, 1.0)), select(onFloor, max(vel.y, 0.0), vel.y), vel.z.mul(select(onFloor, 0.9, 1.0))));
      vel.mulAssign(g.r.oneMinus());
      const edge = min(min(p.x, N.x.sub(p.x)), min(min(p.z, N.z.sub(p.z)), N.y.sub(p.y)));
      const keep = mix(0.86, 1.0, smoothstep(0.0, 6.0, edge));
      textureStore(V1, c, vec4(vel, fuel.clamp(0, 2)));
      textureStore(T1, c, vec4(temp.mul(keep).clamp(0, 4), smoke.mul(keep).clamp(0, 4), lum.clamp(0, 4), burn));
    })().compute(count).setName('fire.advect');

    // ---- 発散（燃える所は気体が膨らむ）
    const velAt = (tex, c, dx, dy, dz) => tex.load(cl(ivec3(c).add(ivec3(dx, dy, dz)))).xyz;
    this.kDiv = Fn(() => {
      const c = coordsOf(instanceIndex).toConst();
      const vc = V1n.load(ivec3(c)).xyz.toConst();
      const xr = velAt(V1n, c, 1, 0, 0).x, xl = velAt(V1n, c, -1, 0, 0).x;
      const yu = velAt(V1n, c, 0, 1, 0).y;
      const yd = select(c.y.equal(uint(0)), vc.y.negate(), velAt(V1n, c, 0, -1, 0).y);
      const zf = velAt(V1n, c, 0, 0, 1).z, zb = velAt(V1n, c, 0, 0, -1).z;
      const div = xr.sub(xl).add(yu.sub(yd)).add(zf.sub(zb)).mul(0.5);
      textureStore(DV, c, vec4(div.sub(T1n.load(ivec3(c)).w.mul(U.expand)), 0, 0, 0));
    })().compute(count).setName('fire.div');

    // ---- 圧力（ヤコビ反復）。横と上は開いた境界、地面は壁
    const pAt = (tex, c, pc, dx, dy, dz) => {
      const q = ivec3(c).add(ivec3(dx, dy, dz));
      const out = q.x.lessThan(0).or(q.x.greaterThanEqual(nx)).or(q.z.lessThan(0)).or(q.z.greaterThanEqual(nz)).or(q.y.greaterThanEqual(ny));
      return select(q.y.lessThan(0), pc, select(out, float(0), tex.load(cl(q)).x));
    };
    const mkJacobi = (src, dst, name) => Fn(() => {
      const c = coordsOf(instanceIndex).toConst();
      const pc = src.load(ivec3(c)).x.toConst();
      const sum = pAt(src, c, pc, 1, 0, 0).add(pAt(src, c, pc, -1, 0, 0)).add(pAt(src, c, pc, 0, 1, 0)).add(pAt(src, c, pc, 0, -1, 0)).add(pAt(src, c, pc, 0, 0, 1)).add(pAt(src, c, pc, 0, 0, -1));
      textureStore(dst, c, vec4(sum.sub(DVn.load(ivec3(c)).x).div(6.0), 0, 0, 0));
    })().compute(count).setName(name);
    this.kJacA = mkJacobi(P0n, P1, 'fire.jacobiA');
    this.kJacB = mkJacobi(P1n, P0, 'fire.jacobiB');

    // ---- 圧力こう配を引く
    this.kProject = Fn(() => {
      const c = coordsOf(instanceIndex).toConst();
      const pc = P0n.load(ivec3(c)).x.toConst();
      const gr = vec3(
        pAt(P0n, c, pc, 1, 0, 0).sub(pAt(P0n, c, pc, -1, 0, 0)),
        pAt(P0n, c, pc, 0, 1, 0).sub(pAt(P0n, c, pc, 0, -1, 0)),
        pAt(P0n, c, pc, 0, 0, 1).sub(pAt(P0n, c, pc, 0, 0, -1)),
      ).mul(0.5);
      const s = V1n.load(ivec3(c)).toConst();
      const v = s.xyz.sub(gr).mul(GEOn.load(ivec3(c)).r.oneMinus()).toVar();
      v.assign(vec3(v.x, select(c.y.equal(uint(0)), max(v.y, 0.0), v.y), v.z));
      textureStore(V0, c, vec4(v, s.w));
      textureStore(T0, c, T1n.load(ivec3(c)));
    })().compute(count).setName('fire.project');

    // ---- 体積の描画
    const R = (this.R = {
      b0: uniform(new THREE.Vector3(...org)), bs: uniform(new THREE.Vector3(sx, sy, sz)), time: uniform(0), frame: uniform(0),
      gain: uniform(o.gain ?? 8.0), blue: uniform(o.blue ?? 1.2), core: uniform(o.core ?? 0.6), l0: uniform(o.l0 ?? 1.2), l1: uniform(o.l1 ?? 1.9), lumW: uniform(o.lumW ?? 4.0), sigS: uniform(o.sigS ?? 2.4), sigL: uniform(o.sigL ?? 7.0),
      dFreq: uniform(o.dFreq ?? 13.0), dAmp: uniform(o.dAmp ?? 0.04), fireCol: uniform(new THREE.Color(1.0, 0.5, 0.18)), fireI: uniform(1.0), amb: uniform(new THREE.Color(0.012, 0.016, 0.03).multiplyScalar(o.ambK ?? 2.0)),
    });
    const m = new THREE.MeshBasicNodeMaterial();
    m.side = THREE.BackSide; m.transparent = true; m.depthWrite = false; m.depthTest = false; m.fog = false;
    m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor; m.blendSrcAlpha = THREE.OneFactor; m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    const STEPS = o.steps ?? 96;
    m.colorNode = Fn(() => {
      const ro = cameraPosition;
      const rd = normalize(positionWorld.sub(cameraPosition)).toConst();
      const inv = vec3(1.0).div(rd);
      const ta = R.b0.sub(ro).mul(inv), tb = R.b0.add(R.bs).sub(ro).mul(inv);
      const tmn = min(ta, tb), tmx = max(ta, tb);
      const tN = max(max(tmn.x, tmn.y), max(tmn.z, 0.0));
      const tF = min(min(tmx.x, tmx.y), tmx.z);
      const sceneZ = perspectiveDepthToViewZ(viewportDepthTexture(), cameraNear, cameraFar);
      const tEnd = min(tF, sceneZ.div(normalize(positionView).z)).toConst();
      const ds = max(tEnd.sub(tN), 0.0).div(STEPS).toConst();
      const sp = screenUV.mul(screenSize).add(R.frame.mul(vec2(17.13, 31.77)));
      const jit = sp.x.mul(12.9898).add(sp.y.mul(78.233)).sin().mul(43758.5453).fract();
      const t = tN.add(ds.mul(jit)).toVar();
      const Tr = float(1.0).toVar();
      const C = vec3(0.0).toVar();
      Loop(STEPS, () => {
        const pl = ro.add(rd.mul(t)).sub(R.b0).toConst();                      // 箱の角からの m
        const s0 = T0n.sample(pl.div(R.bs)).level(0);
        if (o.view) {   // 調整用：温度（赤）・燃料（緑）・燃える面と固体（青）をそのまま見る
          const gg = GEOn.sample(pl.div(R.bs)).level(0);
          if (o.view2) C.addAssign(vec3(s0.z, s0.y, s0.w.mul(0.2)).mul(ds).mul(o.view));   // 光るすす・煙・燃える速さ
          else C.addAssign(vec3(s0.x.mul(0.5), V0n.sample(pl.div(R.bs)).level(0).w, gg.g.add(gg.r.mul(0.3))).mul(ds).mul(o.view));
        }
        If(s0.z.add(s0.y.mul(0.5)).greaterThan(0.004), () => {
          // 細部：上へ流れる雑音で読む位置をずらし、炎の舌の縁を細かくほぐす
          const q = vec3(pl.x, pl.y.sub(R.time.mul(1.9)), pl.z).mul(R.dFreq);
          const wv = (o.noise === 0 ? vec3(0.0) : mx_noise_vec3(q)).mul(R.dAmp).mul(vec3(1.0, 0.55, 1.0));
          const uvw = pl.add(wv).div(R.bs).toConst();
          const s = T0n.sample(uvw).level(0).toConst();
          const temp = s.x, smoke = s.y, lum = s.z;
          const lm = smoothstep(R.l0, R.l1, temp.add(lum.mul(R.lumW))).toConst();   // 炎の内か外か（熱さと、燃えている最中かどうか）
          // 色は温度で決まる：赤 → 橙 → 黄 → 白に近い黄
          const tc = temp.mul(0.6);
          const fc = mix(mix(mix(vec3(1.0, 0.14, 0.012), vec3(1.0, 0.42, 0.055), smoothstep(0.2, 0.6, tc)), vec3(1.0, 0.7, 0.2), smoothstep(0.45, 0.85, tc)), vec3(1.0, 0.9, 0.58), smoothstep(0.9, 1.4, tc));
          // 根元の芯：燃料がまだ濃い所はすすが少なく暗い（青みがかる）。炎は外側と上のほうが明るい
          const fuel = V0n.sample(uvw).level(0).w;
          const coreK = smoothstep(0.6, 1.15, fuel).toConst();
          const em = fc.mul(lm).mul(pow(min(temp, 2.0), 2.2)).mul(R.gain).mul(coreK.mul(R.core).oneMinus());
          const blue = vec3(0.12, 0.3, 1.0).mul(coreK).mul(smoothstep(0.12, 0.55, temp)).mul(R.blue);
          // 煙は火に下から照らされる
          const dfl = pl.sub(vec3(sx * 0.5, 0.5, sz * 0.5));
          const lit = R.fireCol.mul(R.fireI).div(dot(dfl, dfl).mul(4.0).add(1.0)).add(R.amb);
          const sgS = smoke.mul(R.sigS), sg = sgS.add(lm.mul(R.sigL));
          const a = exp(sg.mul(ds).negate()).oneMinus();
          C.addAssign(em.add(blue).mul(ds).mul(Tr));
          C.addAssign(vec3(0.62, 0.6, 0.58).mul(lit).mul(sgS.div(sg.max(0.0001))).mul(a).mul(Tr));
          Tr.mulAssign(a.oneMinus());
        });
        t.addAssign(ds);
      });
      return vec4(C, Tr.oneMinus());
    })();
    const mesh = (this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m));
    mesh.position.set(0, sy / 2, 0); mesh.scale.set(sx, sy, sz);
    mesh.frustumCulled = false; mesh.renderOrder = 50; mesh.layers.set(FX_LAYER); mesh.castShadow = false; mesh.receiveShadow = false;
  }

  reset(tau) { this.renderer.compute(this.kClear); this.tau = tau; }
  step() {
    const r = this.renderer, U = this.U, t = this.tau;
    U.time.value = t;
    // 全体の息づかい（燃え方の強弱）とそよ風。どちらも時刻の関数
    U.flick.value = 0.1 * vnoise(t * 1.9, 11) + 0.07 * vnoise(t * 4.7, 12) + 0.04 * vnoise(t * 9.1, 13);
    U.wind.value.set((0.2 * vnoise(t * 0.33, 21) + 0.1 * vnoise(t * 1.1, 22)) / this.h, 0, (0.14 * vnoise(t * 0.29, 23) + 0.08 * vnoise(t * 0.9, 24)) / this.h);
    r.compute(this.kCurl);
    r.compute(this.kAdvect);
    r.compute(this.kDiv);
    for (let i = 0; i < this.jacobi / 2; i++) { r.compute(this.kJacA); r.compute(this.kJacB); }
    r.compute(this.kProject);
    this.tau += this.dt;
  }
  /** 時刻 tau まで進める。戻ったとき・大きく飛んだときは、少し前から燃やし直す */
  seek(tau, warm = 2.2, maxSteps = 100000) {
    if (tau < this.tau - 0.05 || tau > this.tau + 0.5) { this.reset(tau - warm); maxSteps = 100000; }
    let n = 0;
    while (this.tau + this.dt <= tau + 1e-6 && n < maxSteps) { this.step(); n++; }
    if (n === maxSteps && this.tau < tau - 0.25) this.tau = tau;      // 再生が追いつかないときは、やり直さずそのまま続ける
  }
}

// =====================================================================
// 火の粉（時刻の式で位置が決まる光の筋）
// =====================================================================
function makeSparks(n, uT, uK) {
  const rnd = mulberry(733);
  const A = new Float32Array(n * 4), B = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    A.set([rnd(), rnd(), rnd(), rnd()], i * 4);
    const grp = Math.floor(rnd() * 9);
    const burst = rnd() < 0.5;
    B.set([burst ? grp / 9 + rnd() * 0.02 : rnd(), burst ? 3.3 + grp * 0.47 : 2.6 + rnd() * 4.2, 0.45 + rnd() * rnd() * 2.2, rnd() * rnd()], i * 4);   // 位相・周期・寿命・明るさ
  }
  const a = iattr(A), b = iattr(B);
  const age = fract(uT.div(b.y).add(b.x)).mul(b.y).toVar();
  const life = b.z;
  const posAt = (g) => {
    const th = a.x.mul(6.2832), r0 = a.y.mul(0.14);
    const up = a.z.mul(2.3).add(1.4);                                           // 上向きの初速 m/s
    const rise = up.mul(exp(g.mul(-1.3)).oneMinus()).div(1.3).add(g.mul(0.45));  // 空気の抵抗で遅くなり、あとは上昇気流に乗る
    const out = a.w.mul(0.42).add(0.08).mul(g);
    const wob = vec3(sin(g.mul(a.w.mul(5.0).add(3.0)).add(a.x.mul(40.0))), sin(g.mul(7.0).add(a.z.mul(30.0))).mul(0.3), cos(g.mul(a.z.mul(4.0).add(2.6)).add(a.y.mul(40.0)))).mul(g.mul(0.12));
    return vec3(cos(th).mul(r0.add(out)), a.y.mul(0.35).add(0.3).add(rise), sin(th).mul(r0.add(out))).add(wob);
  };
  const k = age.div(life).clamp(0, 1);
  const alive = step(age, life);
  const pA = posAt(age), pB = posAt(max(age.sub(0.026), 0.0));
  const m = new THREE.MeshBasicNodeMaterial();
  m.transparent = true; m.depthWrite = false; m.blending = THREE.AdditiveBlending; m.fog = false; m.side = THREE.DoubleSide;
  const vA = cameraViewMatrix.mul(modelWorldMatrix.mul(vec4(pA, 1.0))).xyz, vB = cameraViewMatrix.mul(modelWorldMatrix.mul(vec4(pB, 1.0))).xyz;
  const d2 = vA.xy.sub(vB.xy), dl = length(d2).max(0.00001), dn = d2.div(dl), pn = vec2(dn.y.negate(), dn.x);
  const along = positionGeometry.x.add(0.5);
  const wd = float(0.008).mul(alive).mul(b.w.mul(0.7).add(0.55));
  const vp = mix(vB, vA, along).add(vec3(pn.mul(positionGeometry.y.mul(wd)).add(dn.mul(along.sub(0.5).mul(wd))), 0.0));
  m.vertexNode = cameraProjectionMatrix.mul(vec4(vp, 1.0));
  const q = uv();
  const shape = q.y.sub(0.5).abs().mul(2.0).oneMinus().clamp(0, 1).pow(1.5).mul(q.x.mul(0.7).add(0.3));
  const cool = k.oneMinus();
  const tw = sin(uT.mul(a.x.mul(30.0).add(18.0)).add(a.y.mul(50.0))).mul(0.25).add(0.75);
  m.colorNode = mix(vec3(1.0, 0.16, 0.015), vec3(1.0, 0.55, 0.14), cool.pow(1.5)).mul(cool.pow(1.3)).mul(tw).mul(b.w.mul(4.5).add(2.2)).mul(alive).mul(uK);
  m.opacityNode = shape;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
  mesh.count = n; mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false; mesh.renderOrder = 52; mesh.layers.set(FX_LAYER);
  return mesh;
}

// =====================================================================
// 焚き火
// =====================================================================
export class Campfire {
  constructor() {
    const g = (this.root = new THREE.Group());
    const uT = (this.uT = uniform(0)), uK = (this.uK = uniform(1));
    const L = (this.layout = layout());
    // 調整用：?cf=kb:8,gain:10,shadow:0 のように係数を上書きできる（流体・描画・影）
    const qs = new URLSearchParams(globalThis.location ? globalThis.location.search : '');
    const P = (this.P = Object.fromEntries((qs.get('cf') || '').split(',').filter(Boolean).map((s) => s.split(':')).map(([k, v]) => [k, Number(v)])));
    this.hi = qs.get('q') === 'high';
    this.play = (qs.get('mode') || 'play') === 'play' || P.play === 1;
    const wood = new THREE.Mesh(mergeGeometries([...L.logs.map((l, i) => logGeo(l, 3.1 + i * 1.7)), ...L.twigs.map((l, i) => logGeo(l, 40.3 + i * 2.3, 8, 5))]), woodMat(uT, uK));
    wood.castShadow = true; wood.receiveShadow = true;
    const bed = new THREE.Mesh(bedGeo(), bedMat(uT, uK));
    bed.castShadow = false; bed.receiveShadow = true;
    const stones = new THREE.Mesh(mergeGeometries(L.stones.map(stoneGeo)), stoneMat());
    stones.castShadow = true; stones.receiveShadow = true;
    const ashG = new THREE.CircleGeometry(0.86, 48, 0, Math.PI * 2); ashG.rotateX(-Math.PI / 2);
    { const ap = ashG.attributes.position; for (let i = 0; i < ap.count; i++) { const rr = Math.hypot(ap.getX(i), ap.getZ(i)) / 0.86; ap.setY(i, 0.045 * (1 - rr * rr) - 0.012); } ashG.computeVertexNormals(); }
    const ash = new THREE.Mesh(ashG, ashMat());
    ash.position.y = 0; ash.castShadow = false; ash.receiveShadow = true; ash.renderOrder = 5; ash.layers.set(FX_LAYER);
    this.sparks = makeSparks(150, uT, uK);
    g.add(ash, bed, wood, stones, this.sparks);
    // 光：炎（影つき）と、熾の低い赤い光
    this.light = new THREE.PointLight(0xffffff, 0, 24, 1.4);
    this.light.color.setRGB(1.0, 0.54, 0.22);
    this.light.castShadow = P.shadow !== 0;
    this.light.shadow.mapSize.set(1024, 1024); this.light.shadow.camera.near = 0.12; this.light.shadow.camera.far = 16; this.light.shadow.bias = -0.004; this.light.shadow.normalBias = 0.03; this.light.shadow.radius = 2.5;
    this.ember = new THREE.PointLight(0xffffff, 0, 5, 2);
    this.ember.color.setRGB(1.0, 0.3, 0.07); this.ember.position.set(0, 0.16, 0);
    g.add(this.light, this.ember);
    this.sim = null;
    this.reset();
  }
  reset() { this.root.visible = false; this.light.intensity = 0; this.ember.intensity = 0; }
  _ensure(W) {
    if (this.sim !== null) return this.sim;
    const eng = (W && W.engine) || (globalThis.__film && globalThis.__film.engine);
    if (!eng || !eng.renderer) { this.sim = false; return false; }
    const hi = this.hi, P = this.P;
    this.sim = new FireSim(eng.renderer, { n: hi ? [96, 160, 96] : [56, 92, 56], size: [1.6, hi ? 1.6 * 160 / 96 : 1.6 * 92 / 56, 1.6], layout: this.layout, jacobi: hi ? 26 : 18, steps: hi ? 128 : 88, ...P });
    this.root.add(this.sim.mesh);
    return this.sim;
  }
  /** 再生のとき用：読み込み中に流体を用意して時刻 T まで燃やしておく（場面の最初のコマで止まらないように） */
  prewarm(W, T = 0) {
    if (!this.play) return;
    try { const sim = this._ensure(W); if (sim) sim.seek(T, 1.2); } catch (e) { console.warn('campfire prewarm', e); }
  }
  /** T：時刻（秒）。つながった時刻を渡すと炎がカットをまたいで続く。k：火の強さ 0..1 */
  burn(T, k = 1, W = null) {
    this.root.visible = true;
    this.uT.value = T; this.uK.value = k;
    // 光のゆらぎ：炎の息づかい（流体の燃え方と同じ雑音を少し遅らせて使う）
    const tl = T - 0.12;
    const fl = 1 + 1.5 * (0.1 * vnoise(tl * 1.9, 11) + 0.07 * vnoise(tl * 4.7, 12) + 0.04 * vnoise(tl * 9.1, 13)) + 0.05 * vnoise(T * 17.3, 14);
    this.light.intensity = (this.lightI ?? 22) * (0.4 + 0.6 * k) * fl;
    this.light.position.set(0.05 * vnoise(T * 3.1, 31), 0.84 + 0.1 * vnoise(T * 2.3, 32), 0.05 * vnoise(T * 2.7, 33));
    this.ember.intensity = 1.4 * k * (1 + 0.12 * vnoise(T * 1.3, 41));
    const sim = this._ensure(W);
    if (sim) {
      sim.U.power.value = k;
      const play = this.play;
      sim.seek(T, play ? 1.2 : 2.2, play ? 6 : 100000);
      const p = this.root.position;
      sim.R.b0.value.set(p.x + sim.origin[0], p.y + sim.origin[1], p.z + sim.origin[2]);
      sim.R.time.value = T; sim.R.frame.value = Math.round(T * 60) % 64; sim.R.fireI.value = 1.1 * k * fl;
    }
    return this;
  }
}
