// 月着陸船（イーグルへのオマージュ）：しわのある金と黒の断熱材に包まれた降下段、薄い板を継いだ上昇段。
// 原点は地面（足の裏）。+Z が正面（はしごとハッチ）、+Y が上（ドッキングの口＝4.9）。
import * as THREE from 'three/webgpu';
import { mat, grp } from '../core/kit.js';
import { Flame, glowSprite } from '../fx/fx.js';
import { mulberry } from '../core/util.js';
import { xf, rod, hoop, rAt, latheOf, crinkle, partMaterial } from './saturn_parts.js';
import { Bag2, quadGeo, triGeo, fanGeo, tube, foilMaterial, panelMaterial } from './mats.js';

const R8 = 1.75, AP = R8 * Math.cos(Math.PI / 8), HW = AP * Math.tan(Math.PI / 8), Y0 = 1.425, Y1 = 2.675;
// 断熱材 [色, 粗さ, 金属]
const GOLD = [0xad7f31, 0.56, 1.0], AMBER = [0x8f5520, 0.6, 1.0], BLK = [0x121214, 0.5, 0.45], SILV = [0xa9adb4, 0.46, 1.0], TAPE = [0xb9ab78, 0.55, 1.0];
// 外板
const P_LIGHT = [0xb9b7a9, 0.46, 0.7], P_MID = [0x8d9093, 0.48, 0.7], P_DARK = [0x18191c, 0.5, 0.45];
const STEEL = [0xb9bdc4, 0.38, 0.85], DARKM = [0x2e3036, 0.5, 0.7];
const HP = Math.PI / 2;
const h2 = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };

export class Lander {
  constructor() {
    const root = (this.root = grp());
    const foil = new Bag2(), sm = new Bag2(), hull = new Bag2(), glass = new Bag2();
    const rnd = mulberry(1969);
    const pickW = (w) => { let t = rnd() * w.reduce((s, x) => s + x[1], 0); for (const [v, k] of w) { if ((t -= k) < 0) return v; } return w[0][0]; };

    // =========================================================== 降下段（八角柱。面ごとに金・琥珀・黒の断熱材を継ぎ合わせる）
    for (let k = 0; k < 8; k++) {
      const th = (k * Math.PI) / 4, card = k % 2 === 0, cs = Math.cos(th), sn = Math.sin(th);
      const W = card ? [[GOLD, 4], [AMBER, 2], [BLK, 1.2]] : [[BLK, 4], [GOLD, 2.2], [SILV, 0.8], [AMBER, 1]];
      const pal = [0, 1, 2].map(() => [pickW(W), pickW(W)]);
      const g = new THREE.PlaneGeometry(HW * 2, Y1 - Y0, 10, 8); g.translate(0, (Y0 + Y1) / 2, AP);
      crinkle(g, 0.035); g.rotateY(th);
      foil.faces(g, (x, y, z) => { const u = x * cs - z * sn; return pal[Math.max(0, Math.min(2, Math.floor(((u + HW) / (2 * HW)) * 3)))][y > 2.08 ? 1 : 0]; });
      // 継ぎ目のテープ
      for (const u of [-HW / 3, HW / 3]) foil.faces(crinkle(quadGeo([u - 0.02, Y0 + 0.02, AP + 0.014], [u + 0.02, Y0 + 0.02, AP + 0.014], [u + 0.02, Y1 - 0.02, AP + 0.014], [u - 0.02, Y1 - 0.02, AP + 0.014], 1, 8), 0.012).rotateY(th), () => TAPE);
      foil.faces(crinkle(quadGeo([-HW + 0.02, 2.06, AP + 0.014], [HW - 0.02, 2.06, AP + 0.014], [HW - 0.02, 2.1, AP + 0.014], [-HW + 0.02, 2.1, AP + 0.014], 9, 1), 0.012).rotateY(th), () => TAPE);
    }
    const corner = (k, y) => { const a = Math.PI / 8 + (k * Math.PI) / 4; return [R8 * Math.sin(a), y, R8 * Math.cos(a)]; };
    const octa = (y) => [...Array(8)].map((_, k) => corner(k, y));
    for (let k = 0; k < 8; k++) foil.faces(crinkle(tube(corner(k, Y0), corner(k, Y1), 0.035, 5, 6), 0.012), () => GOLD);
    foil.faces(crinkle(fanGeo(octa(Y1), 5), 0.025), (x, y, z) => (h2(Math.floor((x + 3) / 0.8), Math.floor((z + 3) / 0.8)) < 0.68 ? BLK : GOLD));
    foil.faces(crinkle(fanGeo(octa(Y0), 4), 0.03), (x, y, z) => (h2(Math.floor((x + 3) / 0.9), Math.floor((z + 3) / 0.9) + 9) < 0.7 ? GOLD : AMBER));
    // 降下エンジン：暗い延長ノズルと補強の輪、根元の金の遮熱
    const DPS = [[0.62, 0.72], [0.6, 0.8], [0.52, 0.98], [0.42, 1.16], [0.32, 1.32], [0.24, 1.46]];
    sm.add(latheOf(DPS, 40), 0x2c2c30, 0.5, 0.75);
    sm.add(latheOf(DPS, 32, -0.012), 0x0d0c0c, 0.85, 0.2);
    for (const yy of [0.735, 0.9, 1.1, 1.3]) sm.add(hoop(rAt(DPS, yy) + 0.006, yy, yy < 0.75 ? 0.016 : 0.011, 40, 6), 0x47474c, 0.45, 0.8);
    foil.add(crinkle(latheOf([[0.3, 1.36], [0.6, 1.435], [0.7, 1.43]], 20), 0.02), GOLD[0], GOLD[1], GOLD[2]);

    // =========================================================== 脚 4 本（+Z の脚に、はしご）
    const A = [0, 2.25, 2.75], M = [0, 1.18, 3.03], PD = [0, 0.2, 3.3];
    const PADP = [[0.0, 0.035], [0.3, 0.0], [0.47, 0.03], [0.54, 0.13], [0.5, 0.15], [0.34, 0.075], [0.0, 0.085]];
    for (let i = 0; i < 4; i++) {
      const th = i * HP, ry = (g) => g.rotateY(th);
      for (const s of [-1, 1]) {
        foil.faces(ry(crinkle(tube([s * 0.55, 2.6, 1.5], A, 0.055, 7, 5), 0.012)), () => GOLD);          // 張り出しの梁（上）
        sm.add(ry(rod([s * 0.55, 1.55, 1.56], A, 0.036, 6)), ...STEEL);                                    // 張り出しの梁（下）
        sm.add(ry(rod([s * 0.55, 2.6, 1.5], [s * 0.55, 1.55, 1.56], 0.026, 5)), ...STEEL);
        sm.add(ry(rod([s * 0.75, 1.5, 1.45], M, 0.04, 6)), ...STEEL);                                      // 副支柱
        foil.faces(ry(crinkle(tube([s * 0.75, 1.5, 1.45], [s * 0.52, 1.4, 1.93], 0.052, 6, 3), 0.01)), () => GOLD);
      }
      sm.add(ry(rod([-0.55, 2.6, 1.5], [0.55, 2.6, 1.5], 0.026, 5)), ...STEEL);
      foil.faces(ry(crinkle(tube(A, M, 0.105, 10, 7), 0.016)), (x, y) => (y > 1.75 ? GOLD : AMBER));       // 主支柱（上は金の断熱で包む）
      sm.add(ry(rod(M, PD, 0.07, 12)), ...STEEL);                                                          // 主支柱（下の伸縮部）
      sm.add(ry(hoop(0.11, 0, 0.022, 14, 6).rotateX(-0.26).translate(M[0], M[1], M[2])), ...DARKM);
      sm.add(ry(xf(new THREE.SphereGeometry(0.085, 12, 8), { p: PD })), ...STEEL);
      foil.faces(ry(crinkle(latheOf(PADP, 18), 0.02).translate(0, 0, 3.3)), (x, y, z, t) => (t % 7 === 0 ? AMBER : GOLD));   // 皿の足
      // 接地を知らせる探り棒（はしごの脚以外。まっすぐ下へ。着陸後は砂の中）
      if (i > 0) { sm.add(ry(rod([0.3, 0.07, 3.6], [0.32, -1.5, 3.7], 0.012, 5)), 0x9a9da3, 0.4, 0.8); sm.add(ry(rod([0.3, 0.07, 3.6], [0.1, 0.1, 3.5], 0.012, 5)), 0x9a9da3, 0.4, 0.8); }
    }
    // はしご（役者が降りる。段の位置は以前のまま）
    for (const s of [-0.27, 0.27]) sm.add(rod([s, 2.42, 2.86], [s, 0.72, 3.3], 0.024, 8), ...STEEL);
    this.rungs = [];
    for (let k = 0; k < 7; k++) { const y = 2.3 - k * 0.25, z = 2.86 + ((2.42 - y) / 1.7) * 0.44; sm.add(rod([-0.27, y, z], [0.27, y, z], 0.02, 8), ...STEEL); this.rungs.push([y, z]); }
    for (const yy of [2.3, 1.3]) { const z = 2.86 + ((2.42 - yy) / 1.7) * 0.44; for (const s of [-0.27, 0.27]) sm.add(rod([s, yy, z], [s * 0.2, yy - 0.05, z - 0.14], 0.016, 5), ...STEEL); }
    // 踊り場と手すり
    sm.add(xf(new THREE.BoxGeometry(1.35, 0.045, 1.0), { p: [0, 2.712, 2.15] }), 0x7d8086, 0.5, 0.75);
    for (const x of [-0.66, 0.66]) sm.add(xf(new THREE.BoxGeometry(0.05, 0.09, 1.0), { p: [x, 2.69, 2.15] }), ...STEEL);
    for (const z of [1.72, 2.15, 2.6]) sm.add(xf(new THREE.BoxGeometry(1.3, 0.05, 0.04), { p: [0, 2.67, z] }), ...STEEL);
    for (const s of [-1, 1]) {
      sm.add(rod([s * 0.5, 2.67, 2.55], [0, 2.3, 2.72], 0.022, 6), ...STEEL);
      const pts = [[s * 0.62, 2.74, 1.5], [s * 0.62, 3.2, 1.62], [s * 0.62, 3.1, 2.55], [s * 0.42, 2.58, 2.8], [s * 0.27, 2.42, 2.86]];
      for (let k = 0; k < pts.length - 1; k++) sm.add(rod(pts[k], pts[k + 1], 0.02, 6), ...STEEL);
      sm.add(rod([s * 0.62, 2.74, 2.55], [s * 0.62, 3.1, 2.55], 0.018, 6), ...STEEL);
    }
    // 道具の棚（正面左の斜めの面）と、噴射よけの板（4 つのスラスターの下）
    foil.faces(crinkle(xf(new THREE.BoxGeometry(0.95, 0.62, 0.2, 6, 4, 2), { p: [0, 1.95, AP + 0.11] }), 0.02).rotateY(-Math.PI / 4), (x, y) => (y > 2.16 ? SILV : BLK));
    const QUADS = [[1.3, 4.15, 0.9], [-1.3, 4.15, 0.9], [1.3, 4.15, -1.1], [-1.3, 4.15, -1.1]];
    for (const [qx, , qz] of QUADS) {
      const c = [qx * 1.04, 3.04, qz * 1.08], a = Math.atan2(qx, qz);
      foil.faces(crinkle(xf(new THREE.BoxGeometry(0.56, 0.025, 0.6, 4, 1, 4), { r: [0.42, 0, 0] }), 0.012).rotateY(a).translate(c[0], c[1], c[2]), (x, y, z, t) => (t % 5 === 0 ? BLK : GOLD));
      for (const s of [-0.18, 0.18]) sm.add(rod([c[0] * 0.8 + s * Math.cos(a), Y1 - 0.03, c[2] * 0.8 - s * Math.sin(a)], [c[0] + s * Math.cos(a), c[1] - 0.04, c[2] - s * Math.sin(a)], 0.016, 5), ...STEEL);
    }
    // 記念の銘板（はしごの脚に）
    sm.add(xf(new THREE.BoxGeometry(0.36, 0.26, 0.02), { r: [-0.25, 0, 0], p: [0, 1.5, 3.07] }), 0xe6e8ec, 0.3, 0.9);

    root.add(foil.mesh(foilMaterial()), sm.mesh(partMaterial()));
    this.flame = new Flame(0.5, 3.4, { kind: 'hyper', colA: 0xdcecff, colB: 0x6f9cff, coreA: 0xffffff, coreB: 0xe6f1ff, gain: 1.7, bulge: 0.7 });
    this.flame.root.position.y = 0.74; root.add(this.flame.root);
    this.glow = glowSprite(0xaac8ff, 5, { gain: 0, pow: 2.2 }); this.glow.position.y = 0.4; root.add(this.glow);

    // =========================================================== 上昇段（薄い板を継いだ多面体）
    const as = (this.ascent = grp());
    const sa = new Bag2(), fa = new Bag2();
    const addP = (geo, c, amt = 0.018) => hull.faces(crinkle(geo, amt), typeof c === 'function' ? c : () => c);
    const OUT = [[-0.72, 2.72], [0.72, 2.72], [1.08, 3.1], [1.12, 3.75], [0.8, 4.42], [0.35, 4.62], [-0.35, 4.62], [-0.8, 4.42], [-1.12, 3.75], [-1.08, 3.1]];
    const ZB = -0.25, ZF = 0.78, ZFACE = 1.06;
    const sideCol = [P_DARK, P_MID, P_LIGHT, P_MID, P_DARK, P_MID, P_DARK, P_LIGHT, P_DARK, P_MID];
    OUT.forEach((p, i) => { const q = OUT[(i + 1) % 10]; addP(quadGeo([p[0], p[1], ZB], [q[0], q[1], ZB], [q[0], q[1], ZF], [p[0], p[1], ZF], 3, 4), sideCol[i]); });
    addP(fanGeo(OUT.map(([x, y]) => [x, y, ZB]), 3), P_MID);
    const f = (x, y) => [x, y, ZFACE], o = (x, y) => [x, y, ZF];
    for (const s of [-1, 1]) {
      addP(fanGeo([f(s * 0.66, 2.72), f(s * 0.72, 2.72), f(s * 1.0, 3.1), f(s * 1.02, 3.8), f(s * 0.66, 3.8)], 3), P_LIGHT);     // 頬
      addP(quadGeo(o(s * 0.72, 2.72), f(s * 0.72, 2.72), f(s * 1.0, 3.1), o(s * 1.08, 3.1), 1, 3), P_MID);
      addP(quadGeo(o(s * 1.08, 3.1), f(s * 1.0, 3.1), f(s * 1.02, 3.8), o(s * 1.12, 3.75), 1, 4), P_MID);
      // 窓の面（上ほど後ろへ傾く）と、三角の窓
      const a = new THREE.Vector3(...f(s * 0.3, 3.8)), b = new THREE.Vector3(...f(s * 1.02, 3.8)), c = new THREE.Vector3(...o(s * 0.8, 4.42)), d = new THREE.Vector3(...o(s * 0.35, 4.62));
      addP(quadGeo(a, b, c, d, 4, 4), s > 0 ? P_MID : P_LIGHT);
      addP(triGeo(f(s * 1.02, 3.8), o(s * 1.12, 3.75), o(s * 0.8, 4.42), 3), P_DARK);
      const patch = (u, v) => new THREE.Vector3().copy(a).lerp(b, u).lerp(new THREE.Vector3().copy(d).lerp(c, u), v);
      const nrm = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize().multiplyScalar(s);
      const T = [patch(0.9, 0.78), patch(0.2, 0.86), patch(0.3, 0.16)];
      const cen = new THREE.Vector3().add(T[0]).add(T[1]).add(T[2]).multiplyScalar(1 / 3);
      const off = (p, k, e) => new THREE.Vector3().copy(p).sub(cen).multiplyScalar(k).add(cen).addScaledVector(nrm, e);
      sa.add(triGeo(off(T[0], 1.22, 0.008), off(T[1], 1.22, 0.008), off(T[2], 1.22, 0.008), 1), 0x0c0c0e, 0.5, 0.6);
      glass.add(triGeo(off(T[0], 1, 0.016), off(T[1], 1, 0.016), off(T[2], 1, 0.016), 1), 0, 0, 0);
    }
    addP(quadGeo(f(-0.66, 3.76), f(0.66, 3.76), f(0.66, 3.8), f(-0.66, 3.8), 6, 1), P_MID);
    addP(quadGeo(f(-0.3, 3.8), f(0.3, 3.8), o(0.35, 4.62), o(-0.35, 4.62), 3, 4), P_DARK);
    addP(quadGeo(o(-0.72, 2.72), o(0.72, 2.72), f(0.72, 2.72), f(-0.72, 2.72), 4, 1), P_DARK);
    // ハッチの奥（暗い船内。箱の前だけ開いている）
    {
      const x0 = -0.67, x1 = 0.67, y0 = 2.725, y1 = 3.78, z0 = 0.2, z1 = ZFACE - 0.004, IN = 0x0d0f10;
      sa.add(quadGeo([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], 1, 1), 0x25282b, 0.8, 0.2);
      sa.add(quadGeo([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], 1, 1), IN, 0.9, 0);
      sa.add(quadGeo([x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1], 1, 1), IN, 0.9, 0);
      sa.add(quadGeo([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], 1, 1), IN, 0.9, 0);
      sa.add(quadGeo([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], 1, 1), IN, 0.9, 0);
      for (const [x, y] of [[-0.4, 3.5], [-0.1, 3.55], [0.25, 3.5], [0.45, 3.3]]) sa.add(xf(new THREE.BoxGeometry(0.16, 0.1, 0.02), { p: [x, y, z0 + 0.012] }), 0x3a4a44, 0.6, 0.2);
    }
    // 中央部・後ろの機器室
    addP(xf(new THREE.BoxGeometry(1.9, 1.73, 0.75, 5, 5, 2), { p: [0, 3.585, -0.625] }), (x, y, z) => (y > 4.44 ? P_DARK : Math.abs(x) > 0.94 ? (x > 0 ? P_MID : P_DARK) : P_MID));
    addP(xf(new THREE.BoxGeometry(1.6, 1.3, 0.5, 4, 4, 2), { p: [0, 3.7, -1.25] }), (x, y, z) => (z < -1.49 ? P_DARK : y > 4.34 ? P_MID : P_DARK));
    fa.faces(crinkle(quadGeo([0.7, 3.15, -1.513], [-0.7, 3.15, -1.513], [-0.7, 4.25, -1.513], [0.7, 4.25, -1.513], 7, 6), 0.02), (x, y) => (h2(Math.floor(x / 0.47 + 5), Math.floor(y / 0.37)) < 0.6 ? GOLD : BLK));
    fa.faces(crinkle(quadGeo([-0.9, 2.69, -1.0], [0.9, 2.69, -1.0], [0.9, 2.69, 0.75], [-0.9, 2.69, 0.75], 6, 6), 0.02), (x, y, z) => (h2(Math.floor(x / 0.6 + 5), Math.floor(z / 0.6 + 5)) < 0.5 ? GOLD : BLK));
    // 左右の推進剤タンク（大きさが違う）
    addP(xf(new THREE.IcosahedronGeometry(0.68, 1), { s: [0.98, 0.9, 1.08], p: [1.4, 3.4, -0.45] }), (x, y, z) => (h2(Math.floor(y / 0.5), Math.floor(z / 0.5) + 3) < 0.5 ? P_MID : P_DARK), 0.05);
    addP(xf(new THREE.IcosahedronGeometry(0.57, 1), { s: [0.98, 0.92, 1.1], p: [-1.34, 3.42, -0.45] }), (x, y, z) => (h2(Math.floor(y / 0.5) + 7, Math.floor(z / 0.5)) < 0.75 ? P_DARK : P_MID), 0.05);
    // ドッキングの口（真上、軸の上）
    sa.add(latheOf([[0.46, 4.5], [0.46, 4.78], [0.4, 4.83], [0.33, 4.86]], 36), ...DARKM);
    sa.add(latheOf([[0.33, 4.86], [0.33, 4.9], [0.27, 4.9], [0.1, 4.82], [0.0, 4.82]], 36), ...STEEL);
    sa.add(hoop(0.465, 4.6, 0.014, 36, 6), ...STEEL);
    // 姿勢制御の 4 連スラスター（腕の先）
    const bell = () => latheOf([[0.025, 0], [0.04, 0.05], [0.072, 0.16]], 12);
    for (const [qx, qy, qz] of QUADS) {
      const sx = Math.sign(qx), sz = Math.sign(qz);
      sa.add(xf(new THREE.BoxGeometry(0.2, 0.26, 0.2), { p: [qx, qy, qz] }), 0x9c9fa5, 0.42, 0.8);
      sa.add(xf(bell(), { p: [qx, qy + 0.12, qz] }), 0x8b8e94, 0.4, 0.9);
      sa.add(xf(bell(), { r: [Math.PI, 0, 0], p: [qx, qy - 0.12, qz] }), 0x8b8e94, 0.4, 0.9);
      sa.add(xf(bell(), { r: [0, 0, -sx * HP], p: [qx + sx * 0.1, qy, qz] }), 0x8b8e94, 0.4, 0.9);
      sa.add(xf(bell(), { r: [sz * HP, 0, 0], p: [qx, qy, qz + sz * 0.1] }), 0x8b8e94, 0.4, 0.9);
      sa.add(rod([sx * 0.9, qy - 0.25, qz * 0.72], [qx, qy - 0.05, qz], 0.03, 6), ...STEEL);
      sa.add(rod([sx * 0.8, qy + 0.2, qz * 0.6], [qx, qy + 0.05, qz], 0.022, 6), ...STEEL);
    }
    // アンテナ：ランデブー用レーダー（前の上）、首振りの皿（右の上）、棒 2 本
    sa.add(rod([0, 4.6, 0.62], [0, 4.98, 0.72], 0.03, 6), ...DARKM);
    sa.add(xf(new THREE.BoxGeometry(0.2, 0.18, 0.16), { p: [0, 5.0, 0.7] }), 0x8d9093, 0.45, 0.7);
    sa.add(xf(latheOf([[0.02, 0], [0.17, 0.04], [0.25, 0.11]], 24), { r: [HP - 0.25, 0, 0], p: [0, 5.02, 0.8] }), 0xc9cacb, 0.5, 0.3);
    sa.add(rod([0, 5.02, 0.8], [0, 5.07, 0.98], 0.012, 5), ...DARKM);
    sa.add(rod([0.95, 4.42, -0.45], [1.05, 5.0, -0.52], 0.022, 6), ...STEEL);
    sa.add(xf(latheOf([[0.02, 0], [0.16, 0.04], [0.23, 0.1]], 24), { r: [0.5, 0, -0.5], p: [1.07, 5.02, -0.52] }), 0xc9cacb, 0.5, 0.3);
    sa.add(rod([-0.8, 4.42, -0.5], [-0.84, 5.3, -0.52], 0.012, 5), ...DARKM);
    sa.add(rod([0.72, 4.42, -0.95], [0.75, 5.2, -0.98], 0.012, 5), ...DARKM);
    // 頭上の小窓・手すり
    glass.add(quadGeo([-0.75, 4.45, 0.2], [-0.42, 4.6, 0.2], [-0.42, 4.6, 0.5], [-0.75, 4.45, 0.5], 1, 1).translate(0, 0.012, 0), 0, 0, 0);
    sa.add(rod([-0.28, 3.95, 1.02], [0.28, 3.95, 1.02], 0.016, 6), ...STEEL);

    as.add(hull.mesh(panelMaterial()), sa.mesh(partMaterial()), fa.mesh(foilMaterial()));
    const gm = mat(0x020305, { rough: 0.08, metal: 0.0, emissive: 0xffc27a, ei: 0.02, side: THREE.DoubleSide });
    as.add(glass.mesh(gm, { cast: false }));
    // ハッチ（前面の扉。蝶番は左）
    const door = (this.door = grp()); door.position.set(-0.66, 3.24, ZFACE + 0.014);
    const db = new Bag2();
    db.add(xf(new THREE.BoxGeometry(1.3, 1.0, 0.035), { p: [0.66, 0, 0] }), 0xcfd0c8, 0.42, 0.7);
    for (const y of [-0.47, 0.47]) db.add(xf(new THREE.BoxGeometry(1.3, 0.05, 0.05), { p: [0.66, y, 0.008] }), ...STEEL);
    for (const x of [0.03, 1.29]) db.add(xf(new THREE.BoxGeometry(0.05, 1.0, 0.05), { p: [x, 0, 0.008] }), ...STEEL);
    db.add(xf(new THREE.CylinderGeometry(0.11, 0.11, 0.03, 20), { r: [HP, 0, 0], p: [0.66, 0.05, 0.03] }), ...DARKM);
    db.add(xf(new THREE.BoxGeometry(0.3, 0.035, 0.035), { p: [0.66, 0.05, 0.055] }), ...STEEL);
    for (const [x, y] of [[0.2, 0.36], [1.12, 0.36], [0.2, -0.36], [1.12, -0.36]]) db.add(xf(new THREE.BoxGeometry(0.08, 0.05, 0.03), { p: [x, y, 0.025] }), ...DARKM);
    door.add(db.mesh(partMaterial()));
    as.add(door);
    root.add(as);
    this.reset();
  }
  reset() {
    this.root.visible = false; this.root.position.set(0, 0, 0); this.root.rotation.set(0, 0, 0); this.root.scale.setScalar(1);
    this.door.rotation.y = 0; this.flame.set(0, 0); this.glow.visible = false;
  }
  fire(T, p = 1, len = 1) { this.flame.set(T, p, len); this.glow.visible = p > 0.01; this.glow.userData.gain.value = p * 0.35; return this; }
  /** ハッチの開き（0..1） */
  open(k) { this.door.rotation.y = -k * 1.9; return this; }
}
