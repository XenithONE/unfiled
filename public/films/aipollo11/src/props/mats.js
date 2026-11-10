// 実写寄りの質感と、面ごとに色を持つ形の道具（月着陸船・失敗作ロケット・船内で共用）。すべて手続き。
import * as THREE from 'three/webgpu';
import {
  positionLocal, normalLocal, normalView, normalFlat, attribute, uv, texture, vec2, vec3, float, color, mix, smoothstep, step,
  fract, floor, abs, max, min, dot, normalize, length, sin, cos, dFdx, dFdy, mx_noise_float, mx_noise_vec3, mx_fractal_noise_float, mx_cell_noise_float, mx_worley_noise_float,
} from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Bag } from './saturn_parts.js';

const _c = new THREE.Color();
/** 三角形ごとに色・粗さ・金属を決められる袋 */
export class Bag2 extends Bag {
  /** fn(重心 x, y, z, 三角形の番号) → [色(16 進), 粗さ, 金属] */
  faces(geo, fn) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.attributes.normal) g.computeVertexNormals();
    const pos = g.attributes.position, n = pos.count;
    const col = new Float32Array(n * 3), pbr = new Float32Array(n * 2);
    for (let t = 0; t < n / 3; t++) {
      const i = t * 3;
      const v = fn((pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3, (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3, (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3, t);
      _c.set(v[0]);
      for (let k = 0; k < 3; k++) { col[(i + k) * 3] = _c.r; col[(i + k) * 3 + 1] = _c.g; col[(i + k) * 3 + 2] = _c.b; pbr[(i + k) * 2] = v[1]; pbr[(i + k) * 2 + 1] = v[2]; }
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(Float32Array.from(pos.array.subarray(0, n * 3)), 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(Float32Array.from(g.attributes.normal.array.subarray(0, n * 3)), 3));
    out.setAttribute('acol', new THREE.Float32BufferAttribute(col, 3));
    out.setAttribute('apbr', new THREE.Float32BufferAttribute(pbr, 2));
    this.list.push(out);
    return this;
  }
}

// ---- 形
const V = (p) => (p.isVector3 ? p : new THREE.Vector3(p[0], p[1], p[2]));
/** 4 点の板を nu×nv に割る（a→b が下辺、d→c が上辺） */
export function quadGeo(a, b, c, d, nu = 4, nv = 4) {
  const A = V(a), B = V(b), Cc = V(c), D = V(d), pos = [], idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const u = i / nu, v = j / nv;
    const p = new THREE.Vector3().copy(A).lerp(B, u).lerp(new THREE.Vector3().copy(D).lerp(Cc, u), v);
    pos.push(p.x, p.y, p.z);
  }
  const W = nu + 1;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const q = j * W + i; idx.push(q, q + 1, q + W, q + 1, q + W + 1, q + W); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
/** 三角形を n 段に割る */
export function triGeo(a, b, c, n = 3) {
  const A = V(a), B = V(b), Cc = V(c), pos = [], idx = [], id = [];
  for (let i = 0; i <= n; i++) { id.push([]); for (let j = 0; j <= n - i; j++) { const u = i / n, v = j / n; id[i].push(pos.length / 3); pos.push(A.x + (B.x - A.x) * u + (Cc.x - A.x) * v, A.y + (B.y - A.y) * u + (Cc.y - A.y) * v, A.z + (B.z - A.z) * u + (Cc.z - A.z) * v); } }
  for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) { idx.push(id[i][j], id[i + 1][j], id[i][j + 1]); if (j < n - i - 1) idx.push(id[i + 1][j], id[i + 1][j + 1], id[i][j + 1]); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
/** 多角形（凸）を重心から扇に割る */
export function fanGeo(pts, n = 3) {
  const P = pts.map(V), c = new THREE.Vector3();
  for (const p of P) c.add(p); c.multiplyScalar(1 / P.length);
  return mergeGeometries(P.map((p, i) => triGeo(c, p, P[(i + 1) % P.length], n)));
}
const _up = new THREE.Vector3(0, 1, 0);
/** 2 点を結ぶ管（長さ方向にも割る。しわを付ける用） */
export function tube(a, b, r = 0.05, seg = 8, hseg = 4, r2 = r) {
  const A = V(a), B = V(b), d = new THREE.Vector3().subVectors(B, A), len = d.length();
  const g = new THREE.CylinderGeometry(r2, r, len, seg, hseg, false);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(_up, d.normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}
export { mergeGeometries };

// =====================================================================
// 素材（頂点の色 acol・粗さと金属 apbr を下地にして、手続きで表情を足す）
// =====================================================================
const cache = {};
const base = () => ({ col: attribute('acol', 'vec3'), pbr: attribute('apbr', 'vec2') });
/** 面に沿った向きだけを残して法線を傾ける */
const tilt = (n, t, amp) => normalize(n.add(t.sub(n.mul(dot(t, n))).mul(amp)));
const cell3 = (p, o) => vec3(mx_cell_noise_float(p.add(o)), mx_cell_noise_float(p.add(o + 17.3)), mx_cell_noise_float(p.add(o + 41.9))).sub(0.5);

/** しわくちゃの断熱箔（金・銀・黒のカプトン）：小さな平面のかけらが、それぞれ違う向きに光る */
export function foilMaterial(f1 = 5.5, amp = 0.36) {
  const key = `foil${f1}|${amp}`;
  if (cache[key]) return cache[key];
  const m = new THREE.MeshStandardNodeMaterial();
  m.side = THREE.DoubleSide; m.flatShading = true;
  const { col, pbr } = base(), P = positionLocal;
  const warp = mx_noise_vec3(P.mul(f1 * 0.45)).mul(0.55);
  const p1 = P.mul(f1).add(warp), p2 = P.mul(f1 * 3.1).add(warp.mul(2.3));
  const t = cell3(p1, 0.0).add(cell3(p2, 5.0).mul(0.55));
  m.normalNode = tilt(normalFlat, t, amp);
  const tone = mx_cell_noise_float(p1.add(3.7));
  m.colorNode = col.mul(tone.mul(0.26).add(0.82));
  m.roughnessNode = pbr.x.add(tone.sub(0.5).mul(0.2)).clamp(0.07, 1.0);
  m.metalnessNode = pbr.y;
  return (cache[key] = m);
}

/** 薄い金属板を継いだ外板（月着陸船の上昇段など）：継ぎ目の線、板ごとの色むら、ぺこぺこした歪み */
export function panelMaterial(G = 0.4) {
  const key = `panel${G}`;
  if (cache[key]) return cache[key];
  const m = new THREE.MeshStandardNodeMaterial();
  m.side = THREE.DoubleSide; m.flatShading = true;
  const { col, pbr } = base(), P = positionLocal;
  const q = P.div(G), fq = fract(q);
  const dq = min(fq, fq.oneMinus()).mul(G);
  const w = abs(dFdx(P)).add(abs(dFdy(P))).max(1e-4);
  const ln = dq.sub(0.006).negate().div(w).add(0.5).clamp(0, 1).mul(min(vec3(1.0), vec3(0.014).div(w)));
  const nl = abs(normalLocal);
  const wa = smoothstep(0.72, 0.94, nl).oneMinus();
  const seam = max(ln.x.mul(wa.x), max(ln.y.mul(wa.y), ln.z.mul(wa.z)));
  const tone = mx_cell_noise_float(q.add(vec3(11.3, 4.1, 7.7)));
  const dirt = mx_fractal_noise_float(P.mul(1.7), 3, 2.0, 0.5).mul(0.5).add(0.5).clamp(0, 1);
  m.colorNode = col.mul(tone.mul(0.2).add(0.86)).mul(dirt.mul(0.14).add(0.9)).mul(seam.mul(-0.55).add(1.0));
  m.roughnessNode = pbr.x.add(tone.sub(0.5).mul(0.2)).add(seam.mul(0.2)).clamp(0.1, 1.0);
  m.metalnessNode = pbr.y;
  m.normalNode = tilt(normalFlat, mx_noise_vec3(P.mul(4.5)), 0.06);
  return (cache[key] = m);
}

/**
 * 面の上の 2 次元の座標（m）。mode 'box'＝いちばん正面を向いた軸の面へ投影、'cyl'＝Y 軸まわりの円筒（弧の長さと高さ）
 */
function surf2(mode, P) {
  if (mode === 'cyl') {
    const r = max(length(P.xz), 0.001), ang = P.x.atan(P.z);
    const u = ang.mul(r), v = P.y;
    const wu = max(length(dFdx(P.xz)), length(dFdy(P.xz))).max(1e-4), wv = abs(dFdx(v)).add(abs(dFdy(v))).max(1e-4);
    return { u, v, wu, wv, r, ang };
  }
  const nl = abs(normalLocal);
  const sx = step(max(nl.y, nl.z), nl.x), sy = step(max(nl.x, nl.z), nl.y).mul(sx.oneMinus());
  const u = mix(mix(P.x, P.z, sx), P.x, sy), v = mix(P.y, P.z, sy);
  const wu = abs(dFdx(u)).add(abs(dFdy(u))).max(1e-4), wv = abs(dFdx(v)).add(abs(dFdy(v))).max(1e-4);
  return { u, v, wu, wv };
}
/**
 * 塗装した鉄板（継ぎ目・リベットの列・塗装の欠け・さび・流れた筋）。なめらかな陰影。
 * rust＝さびの量（0..1）、G＝板の大きさ（m）、mode＝'box' | 'cyl'、nV＝円筒のときの縦の継ぎ目の本数
 */
export function plateMaterial({ rust = 0.5, G = 0.55, mode = 'box', nV = 8, rivets = true } = {}) {
  const key = `plate${rust}|${G}|${mode}|${nV}|${rivets}`;
  if (cache[key]) return cache[key];
  const m = new THREE.MeshStandardNodeMaterial();
  m.side = THREE.DoubleSide;
  const { col, pbr } = base(), P = positionLocal;
  const S = surf2(mode, P);
  const tri = (x, per) => abs(fract(x.div(per).add(0.5)).sub(0.5)).mul(per);      // 周期 per の線までの距離
  const dU = mode === 'cyl' ? abs(fract(S.ang.mul(nV / 6.283185).add(0.5)).sub(0.5)).mul(6.283185 / nV).mul(S.r) : tri(S.u, G);
  const dV = tri(S.v, G);
  const line = (d, hw, w) => d.sub(hw).negate().div(w).add(0.5).clamp(0, 1).mul(min(float(1.0), float(hw * 2.4).div(w)));
  const seam = max(line(dU, 0.006, S.wu), line(dV, 0.006, S.wv));
  // リベット：継ぎ目の両わきに並ぶ頭
  const RP = 0.075;
  const dotOf = (dSeam, along, w) => smoothstep(0.2, 0.34, length(vec2(dSeam.sub(0.034).div(RP), fract(along.div(RP)).sub(0.5)))).oneMinus().mul(smoothstep(0.01, 0.03, w).oneMinus());
  const rivet = rivets ? max(dotOf(dU, S.v, S.wv), dotOf(dV, S.u, S.wu)) : float(0);
  // さび：継ぎ目のまわり＋まだらな斑点＋下へ流れた筋。塗装の欠け。
  const n1 = mx_fractal_noise_float(P.mul(2.3), 4, 2.0, 0.55).mul(0.5).add(0.5);
  const n2 = mx_fractal_noise_float(P.mul(vec3(9.0, 1.3, 9.0)).add(3.0), 3, 2.0, 0.5).mul(0.5).add(0.5);
  const edgeW = smoothstep(0.0, 0.1, min(dU, dV)).oneMinus();
  const rustAmt = smoothstep(0.98 - rust * 0.5, 1.1 - rust * 0.5, n1.mul(0.72).add(n2.mul(0.28)).add(edgeW.mul(0.16))).mul(rust > 0.01 ? 1 : 0);
  const chip = smoothstep(0.52, 0.57, mx_fractal_noise_float(P.mul(15.0), 3, 2.0, 0.6).mul(0.5).add(0.5).add(n1.sub(0.5).mul(0.45)).add(edgeW.mul(0.08)).add(rust * 0.34 - 0.42)).mul(rust > 0.01 ? 1 : 0);
  const rustCol = mix(vec3(0.17, 0.065, 0.028), vec3(0.4, 0.16, 0.05), n2);
  let c = mix(col, vec3(0.3, 0.3, 0.31), chip.mul(0.9));
  c = mix(c, rustCol, rustAmt);
  c = c.mul(seam.mul(-0.5).add(1.0)).mul(rivet.mul(0.25).add(1.0)).mul(n1.mul(0.22).add(0.85));
  m.colorNode = c;
  m.roughnessNode = mix(mix(pbr.x, float(0.42), chip), float(0.92), rustAmt).add(n2.mul(0.1));
  m.metalnessNode = mix(mix(pbr.y, float(0.85), chip), float(0.1), rustAmt);
  const bump = mx_noise_vec3(P.mul(3.0)).mul(0.05).add(mx_noise_vec3(P.mul(38.0)).mul(rustAmt.mul(0.14).add(0.012)));
  m.normalNode = tilt(normalView, bump, 1.0);
  return (cache[key] = m);
}

/** 木（板・角材）：木目の縞と節。axis＝木目の走る軸 */
export function woodMaterial(axis = 'y') {
  const key = `wood${axis}`;
  if (cache[key]) return cache[key];
  const m = new THREE.MeshStandardNodeMaterial();
  m.side = THREE.DoubleSide;
  const { col, pbr } = base(), P = positionLocal;
  const s = axis === 'y' ? vec3(9.0, 0.7, 9.0) : axis === 'x' ? vec3(0.7, 9.0, 9.0) : vec3(9.0, 9.0, 0.7);
  const wv = mx_noise_float(P.mul(s)).mul(1.6).add(mx_noise_float(P.mul(s).mul(2.7).add(5.0)).mul(0.5));
  const ring = fract(wv.mul(3.0)).sub(0.5).abs().mul(2.0);
  const fine = mx_noise_float(P.mul(s).mul(vec3(9.0, 9.0, 9.0))).mul(0.5).add(0.5);
  m.colorNode = col.mul(ring.mul(0.3).add(0.72)).mul(fine.mul(0.2).add(0.9));
  m.roughnessNode = pbr.x.add(ring.mul(0.1));
  m.metalnessNode = float(0);
  m.normalNode = tilt(normalView, vec3(ring.sub(0.5), fine.sub(0.5), ring.sub(0.5)), 0.12);
  return (cache[key] = m);
}

/** 布（座席・クッション・ベルト）：織り目と、斜めから見たときのやわらかい照り */
export function fabricMaterial(scale = 90) {
  const key = `fabric${scale}`;
  if (cache[key]) return cache[key];
  const m = new THREE.MeshPhysicalNodeMaterial();
  m.side = THREE.DoubleSide;
  const { col, pbr } = base(), P = positionLocal;
  const wx = sin(P.x.mul(scale)).mul(sin(P.y.mul(scale * 1.03))), wz = sin(P.z.mul(scale)).mul(sin(P.y.mul(scale * 0.97).add(1.3)));
  const weave = wx.add(wz).mul(0.5);
  const fade = smoothstep(0.004, 0.02, max(length(dFdx(P)), length(dFdy(P)))).oneMinus();
  const n1 = mx_fractal_noise_float(P.mul(3.0), 3, 2.0, 0.5).mul(0.5).add(0.5).clamp(0, 1);
  m.colorNode = col.mul(weave.mul(0.12).mul(fade).add(0.94)).mul(n1.mul(0.18).add(0.88));
  m.roughnessNode = pbr.x;
  m.metalnessNode = float(0);
  m.sheen = 1.0; m.sheenRoughness = 0.55; m.sheenNode = col.mul(0.6).add(0.12);
  m.normalNode = tilt(normalView, vec3(wx, weave, wz).mul(fade).add(mx_noise_vec3(P.mul(5.0)).mul(0.25)), 0.16);
  return (cache[key] = m);
}

/** 気泡緩衝材（ぷちぷち）：丸い粒が並んだ半透明の樹脂。照りが強い */
export function bubbleMaterial() {
  if (cache.bubble) return cache.bubble;
  const m = new THREE.MeshPhysicalNodeMaterial();
  m.side = THREE.DoubleSide;
  const { col } = base(), P = positionLocal;
  const S = 13.0;
  const grid = (a, b) => { const g = vec2(a, b).mul(S); const row = floor(g.y); const f = vec2(fract(g.x.add(row.mul(0.5))), fract(g.y)).sub(0.5); return f; };
  const nl = abs(normalLocal);
  // いちばん正面を向いた軸の面に、粒を並べる
  const fxy = grid(P.x, P.y), fyz = grid(P.z, P.y), fxz = grid(P.x, P.z);
  const f = mix(mix(fxy, fyz, step(nl.z, nl.x)), fxz, step(max(nl.x, nl.z), nl.y));
  const r = length(f);
  const dome = smoothstep(0.1, 0.46, r).oneMinus();
  const fade = smoothstep(0.006, 0.03, max(length(dFdx(P)), length(dFdy(P)))).oneMinus();
  m.colorNode = col.mul(dome.mul(0.16).mul(fade).add(0.86));
  m.roughnessNode = mix(float(0.42), float(0.16), dome.mul(fade));
  m.metalnessNode = float(0);
  m.clearcoat = 0.8; m.clearcoatRoughness = 0.2;
  m.normalNode = tilt(normalView, vec3(f.x, f.y, f.x.negate()).mul(smoothstep(0.2, 0.5, r).oneMinus()).mul(fade), 1.4);
  return (cache.bubble = m);
}

/** 紙（繊維のむら・うっすらした波打ち）。map＝印刷の柄（色に掛ける）を返す関数 */
export function paperNodes(P = positionLocal) {
  const fiber = mx_fractal_noise_float(P.mul(vec3(60.0, 60.0, 14.0)), 3, 2.0, 0.55).mul(0.5).add(0.5);
  const blot = mx_fractal_noise_float(P.mul(2.2), 3, 2.0, 0.5).mul(0.5).add(0.5);
  return { tone: fiber.mul(0.1).add(0.9).mul(blot.mul(0.1).add(0.92)), bump: mx_noise_vec3(P.mul(3.0)).mul(0.5).add(mx_noise_vec3(P.mul(40.0)).mul(0.12)) };
}
export { tilt };
