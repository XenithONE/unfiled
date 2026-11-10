// 本番ロケット「AIPOLLO 11」：サターン V へのオマージュ（3 段＋司令・機械船＋脱出塔）
// 形はすべてコード。原点はエンジンの出口の面、+Y が機首。
import * as THREE from 'three/webgpu';
import { uniform, color, mix, smoothstep } from 'three/tsl';
import { mat, grp, canvasTex, mergeGeometries } from '../core/kit.js';
import { Flame, glowSprite } from '../fx/fx.js';
import { Bag, C, xf, atAz, rod, halfTube, hoop, rAt, latheOf, crinkle, fairingGeo, finGeo, partMaterial, linerMaterial, sootMaterial, paintMaterial, smMaterial, cmMaterial } from './saturn_parts.js';

export const SAT = { R: 1.65, s1Top: 11.7, s2Bot: 12.4, s2Top: 18.6, s3Bot: 20.0, s3Top: 24.2, slaTop: 26.3, smTop: 27.9, cmTop: 29.1, top: 31.7 };
const TAU = Math.PI * 2, HP = Math.PI / 2;

function recenter(g, cy) { for (const c of g.children) c.position.y -= cy; g.position.y = cy; g.userData.home = cy; return g; }

/** 縦に積んだ太い文字（実機の縦書きの機体表記にならう）。白で描き、濃さだけを使う。 */
const FONT = '"Arial Black", "Helvetica Neue", Arial, "Segoe UI", sans-serif';
function stackTex(text, w, h, stretch = 1.0, fill = 0.86) {
  return canvasTex(w, h, (ctx) => {
    const n = text.length, cell = h / n;
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.font = `900 100px ${FONT}`;
    const widest = Math.max(...[...text].map((ch) => ctx.measureText(ch).width));
    let px = (100 * w * fill) / widest;
    ctx.font = `900 ${px}px ${FONT}`;
    let cap = ctx.measureText('H').actualBoundingBoxAscent * stretch;
    if (cap > cell * 0.8) { px *= (cell * 0.8) / cap; ctx.font = `900 ${px}px ${FONT}`; cap = cell * 0.8; }
    [...text].forEach((ch, i) => { ctx.save(); ctx.translate(w / 2, i * cell + (cell + cap) / 2); ctx.scale(1, stretch); ctx.fillText(ch, 0, 0); ctx.restore(); });
  });
}

/** 4 人の色がひと回りする帯 */
const rainbow = ({ ang }) => {
  const seg = ang.div(TAU).add(0.5).mul(4.0);
  const c1 = color(0xf0463f), c2 = color(0xfcc419), c3 = color(0x2fbb5c), c4 = color(0x2f7df6);
  const c = mix(mix(c1, c2, smoothstep(0.0, 1.0, seg)), mix(c3, c4, smoothstep(2.0, 3.0, seg)), smoothstep(1.0, 2.0, seg));
  return mix(c, c1, smoothstep(3.0, 4.0, seg));
};

const angDist = (a, b) => Math.abs((((a - b + Math.PI) % TAU) + TAU) % TAU - Math.PI);
const isBlack = (cfg, th, y) => (cfg.blacks || []).some((b) => y >= b.y0 && y < b.y1 && (b.th === undefined || angDist(th, b.th) < b.half));
/** 縦の配線トンネル。胴の塗り分けに合わせて白黒を切り替える。 */
function tunnel(bag, cfg, th, R, y0, y1, w = 0.2, d = 0.085) {
  const cuts = [y0, y1];
  for (const b of cfg.blacks || []) for (const yy of [b.y0, b.y1]) if (yy > y0 + 0.01 && yy < y1 - 0.01) cuts.push(yy);
  cuts.sort((a, b) => a - b);
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i], b = cuts[i + 1];
    if (b - a < 1e-3) continue;
    bag.add(atAz(halfTube(w, d, a, b), th, R - 0.004), isBlack(cfg, th, (a + b) / 2) ? C.black : C.white, 0.44, 0);
  }
}
/** 地上設備とつながる接続口（塔の側） */
function plate(bag, th, R, y, w = 0.36, h = 0.28) {
  bag.add(atAz(new THREE.BoxGeometry(w, h, 0.05), th, R + 0.012, y), C.dark, 0.55, 0.5);
  bag.add(atAz(new THREE.BoxGeometry(w * 0.7, h * 0.62, 0.07), th, R + 0.016, y), C.steel, 0.4, 0.8);
}

// ---------------------------------------------------------------------
// F-1 エンジン（1 段目）：下半分は帯で補強した延長ノズル、上は断熱の箔で包まれ、排気の環が巻く
// ---------------------------------------------------------------------
const F1_EXT = [[0.6, 0.0], [0.585, 0.08], [0.555, 0.2], [0.515, 0.34], [0.47, 0.48], [0.432, 0.6]];
const F1_UP = [[0.432, 0.6], [0.385, 0.74], [0.335, 0.88], [0.285, 1.01], [0.238, 1.13], [0.2, 1.22]];
function f1Engine(b, f, l, ex, ez) {
  const tr = (g) => g.translate(ex, 0, ez);
  const n = Math.hypot(ex, ez);
  const o = n > 0.01 ? [ex / n, ez / n] : [0.7071, 0.7071];
  b.add(tr(latheOf(F1_EXT, 44)), C.ext, 0.5, 0.85);
  for (const yy of [0.014, 0.15, 0.29, 0.43, 0.575]) b.add(tr(hoop(rAt(F1_EXT, yy) + 0.006, yy, yy < 0.02 ? 0.015 : 0.011, 44, 6)), 0x3a3632, 0.5, 0.85);
  f.add(crinkle(tr(latheOf(F1_UP, 20)), 0.022), C.foil, 0.46, 1.0);
  f.add(crinkle(tr(hoop(0.462, 0.635, 0.06, 20, 7)), 0.012), C.foil, 0.46, 1.0);
  for (const yy of [0.8, 0.98]) b.add(tr(hoop(rAt(F1_UP, yy) + 0.012, yy, 0.009, 24, 5)), 0x55585e, 0.5, 0.8);
  // 排気の環へ下りてくる太い管（機体の内側）
  f.add(crinkle(rod([ex - o[0] * 0.5, 0.66, ez - o[1] * 0.5], [ex - o[0] * 0.33, 1.13, ez - o[1] * 0.33], 0.05, 7), 0.008), C.foil, 0.46, 1.0);
  l.add(tr(latheOf([...F1_EXT, ...F1_UP.slice(1)], 32, -0.014)), 0, 0, 0, (x, y) => [Math.min(1, Math.max(0, y / 1.22)), 0, 0]);
  // 耐熱の幕（遮熱板との継ぎ目）
  b.add(tr(latheOf([[0.275, 0.99], [0.34, 1.06], [0.4, 1.125]], 24)), C.boot, 0.95, 0);
  if (n > 0.01) {
    // 首振りの腕（外側の 4 基）
    const t = [o[1], -o[0]];
    for (const s of [-1, 1]) {
      const d = [o[0] * 0.64 + t[0] * 0.77 * s, o[1] * 0.64 + t[1] * 0.77 * s];
      b.add(rod([ex + d[0] * 0.33, 0.84, ez + d[1] * 0.33], [ex + d[0] * 0.56, 1.12, ez + d[1] * 0.56], 0.024, 6), C.steel, 0.35, 0.9);
    }
  }
}
// ---------------------------------------------------------------------
// J-2 エンジン（2・3 段目）：細い管を束ねた壁（縦の面取り）＋補強の帯
// ---------------------------------------------------------------------
const J2 = [[0.33, 0.0], [0.318, 0.07], [0.292, 0.18], [0.255, 0.31], [0.212, 0.45], [0.168, 0.59], [0.125, 0.72], [0.09, 0.82], [0.072, 0.87], [0.098, 0.92], [0.112, 0.97], [0.112, 1.03]];
function j2Engine(b, f, l, ex, y0, ez, plumbing = true) {
  const tr = (g) => g.translate(ex, y0, ez);
  f.add(tr(latheOf(J2, 36)), C.tube, 0.36, 0.95);
  for (const yy of [0.012, 0.2, 0.4, 0.6]) b.add(tr(hoop(rAt(J2, yy) + 0.004, yy, yy < 0.02 ? 0.011 : 0.008, 32, 5)), 0x6a6e75, 0.4, 0.9);
  if (l) l.add(tr(latheOf(J2.slice(0, 9), 28, -0.01)), 0, 0, 0, (x, y) => [Math.min(1, Math.max(0, (y - y0) / 0.87)), 0, 0]);
  if (plumbing) {
    // ターボポンプと配管
    for (const s of [-1, 1]) {
      b.add(xf(new THREE.CylinderGeometry(0.05, 0.05, 0.2, 10), { p: [ex + s * 0.17, y0 + 0.9, ez + 0.03 * s] }), C.steel, 0.38, 0.9);
      b.add(rod([ex + s * 0.17, y0 + 0.98, ez + 0.03 * s], [ex + s * 0.06, y0 + 1.06, ez], 0.022, 6), C.steel, 0.4, 0.9);
      b.add(rod([ex + s * 0.17, y0 + 0.82, ez + 0.03 * s], [ex + s * 0.1, y0 + 0.66, ez - 0.05 * s], 0.018, 6), C.foil, 0.35, 1.0);
    }
  }
}

// ---------------------------------------------------------------------
// 司令・機械船（CSM）。原点は機械船の底、+Y が機首（先端＝2.84）。stowed＝ロケットに積んだ姿（アンテナをたたむ）
// ---------------------------------------------------------------------
const glassMat = () => mat(0x05070c, { rough: 0.08, metal: 0.4, emissive: 0xffd9a0, ei: 0.035 });
export function makeCSM(o = {}) {
  const g = grp();
  const b = new Bag(), f = new Bag(), w = new Bag();
  const sm = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(0.78, 0), new THREE.Vector2(0.78, 1.6)], 72), smMaterial());
  const cm = new THREE.Mesh(latheOf([[0.78, 1.6], [0.776, 1.64], [0.74, 1.72], [0.22, 2.68]], 72), cmMaterial());
  for (const m of [sm, cm]) { m.castShadow = true; m.receiveShadow = true; }
  g.add(sm, cm);
  // 継ぎ目の輪と、後ろの断熱（金色がかった箔）
  b.add(latheOf([[0.78, 1.575], [0.792, 1.585], [0.792, 1.615], [0.78, 1.625]], 72), C.dark, 0.5, 0.6);
  b.add(latheOf([[0.775, 0.0], [0.79, 0.012], [0.79, 0.05], [0.78, 0.062]], 72), C.dark, 0.5, 0.6);
  f.add(crinkle(xf(new THREE.RingGeometry(0.13, 0.776, 40, 4), { r: [HP, 0, 0], p: [0, 0.002, 0] }), 0.014), C.kapton, 0.36, 1.0);
  // 主エンジン（SPS）：上はチタン、下の延長は暗いコロンビウム。補強の輪。
  const SPS_LO = [[0.48, -0.95], [0.468, -0.86], [0.44, -0.74], [0.4, -0.62], [0.352, -0.5]];
  const SPS_UP = [[0.352, -0.5], [0.3, -0.38], [0.245, -0.26], [0.19, -0.14], [0.145, -0.04], [0.125, 0.02]];
  b.add(latheOf(SPS_LO, 48), 0x5c554d, 0.42, 0.85);
  b.add(latheOf(SPS_UP, 48), 0x8d9096, 0.36, 0.9);
  b.add(latheOf([...SPS_LO, ...SPS_UP.slice(1)], 40, -0.012), 0x0e0d0c, 0.85, 0.2);
  for (const [yy, t] of [[-0.94, 0.014], [-0.72, 0.009], [-0.5, 0.016], [-0.26, 0.008]]) b.add(hoop(rAt([...SPS_LO, ...SPS_UP.slice(1)], yy) + 0.006, yy, t, 48, 6), 0x6f6a64, 0.4, 0.9);
  // 姿勢制御の 4 連スラスター
  const bell = () => latheOf([[0.02, 0], [0.03, 0.04], [0.052, 0.115]], 12);
  for (let i = 0; i < 4; i++) {
    const th = i * HP + Math.PI / 4;
    b.add(atAz(new THREE.BoxGeometry(0.22, 0.22, 0.05), th, 0.795, 1.0), C.dark, 0.5, 0.5);
    b.add(atAz(new THREE.BoxGeometry(0.1, 0.1, 0.07), th, 0.82, 1.0), 0x8b8e94, 0.4, 0.85);
    for (const [rz, dx, dy] of [[0, 0, 0.05], [Math.PI, 0, -0.05], [-HP, 0.05, 0], [HP, -0.05, 0]]) {
      b.add(atAz(xf(bell(), { r: [0.18, 0, rz], p: [dx, dy, 0.04] }), th, 0.82, 1.0), 0x9a9da3, 0.38, 0.9);
    }
  }
  // 司令船との接続ハウジング
  b.add(atAz(new THREE.BoxGeometry(0.17, 0.3, 0.1), -HP + 0.5, 0.8, 1.6), 0x9ea2a8, 0.45, 0.7);
  b.add(atAz(xf(new THREE.BoxGeometry(0.13, 0.24, 0.06), { r: [-0.5, 0, 0] }), -HP + 0.5, 0.75, 1.78), 0x9ea2a8, 0.45, 0.7);
  // 窓（ランデブー用 2・側面 2・ハッチ 1）とハッチの枠
  const onCone = (geo, th, y) => atAz(xf(geo, { r: [-0.496, 0, 0] }), th, 0.74 - (y - 1.72) * 0.5417 + 0.004, y);
  for (const s of [-1, 1]) {
    w.add(onCone(new THREE.BoxGeometry(0.1, 0.15, 0.012), s * 0.36, 2.3), 0, 0, 0);
    w.add(onCone(new THREE.BoxGeometry(0.15, 0.15, 0.012), s * 1.15, 2.06), 0, 0, 0);
    b.add(onCone(new THREE.BoxGeometry(0.014, 0.44, 0.012), s * 0.26, 2.0), 0x55585e, 0.5, 0.8);
  }
  w.add(onCone(xf(new THREE.CylinderGeometry(0.06, 0.06, 0.012, 16), { r: [HP, 0, 0] }), 0, 2.03), 0, 0, 0);
  for (const yy of [1.81, 2.2]) b.add(onCone(new THREE.BoxGeometry(0.3, 0.014, 0.012), 0, yy), 0x55585e, 0.5, 0.8);
  // 姿勢制御の噴射口（司令船）
  for (const [th, yy] of [[HP, 1.85], [-HP, 1.85], [Math.PI, 1.85], [Math.PI - 0.5, 2.45], [Math.PI + 0.5, 2.45], [2.2, 1.9], [-2.2, 1.9]]) b.add(onCone(xf(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 12), { r: [HP, 0, 0] }), th, yy), 0x17181b, 0.8, 0.3);
  // 機首：トンネルとドッキング装置
  b.add(latheOf([[0.22, 2.68], [0.205, 2.715], [0.16, 2.76], [0.125, 2.78], [0.0, 2.782]], 32), 0x3c3f45, 0.45, 0.7);
  b.add(latheOf([[0.07, 2.78], [0.05, 2.815], [0.022, 2.84], [0.0, 2.842]], 16), C.steel, 0.3, 0.95);
  if (!o.stowed) {
    // 高利得アンテナ：腕の先に 4 枚の皿
    const th = 2.5, hub = [0, -0.42, 1.2];
    const A = new Bag();
    A.add(rod([0, 0.02, 0.74], hub, 0.02, 6), C.steel, 0.4, 0.85);
    A.add(xf(new THREE.BoxGeometry(0.1, 0.07, 0.1), { p: hub }), C.dark, 0.5, 0.6);
    for (const [dx, dz] of [[-0.15, -0.15], [0.15, -0.15], [-0.15, 0.15], [0.15, 0.15]]) {
      A.add(xf(latheOf([[0.012, 0], [0.075, 0.014], [0.132, 0.05]], 20), { r: [Math.PI - 0.35, 0, 0], p: [hub[0] + dx, hub[1] - 0.03, hub[2] + dz] }), C.white, 0.5, 0.1);
      A.add(xf(new THREE.CylinderGeometry(0.008, 0.008, 0.07, 5), { r: [-0.35, 0, 0], p: [hub[0] + dx, hub[1] - 0.06, hub[2] + dz + 0.012] }), C.dark, 0.5, 0.6);
      A.add(rod(hub, [hub[0] + dx, hub[1] - 0.02, hub[2] + dz], 0.01, 5), C.steel, 0.4, 0.85);
    }
    for (const gg of A.list) { gg.rotateY(th); b.list.push(gg); }
  }
  g.add(b.mesh(partMaterial()), f.mesh(partMaterial(true)));
  const win = w.mesh(glassMat(), { cast: false }); g.add(win);
  return g;
}

// ---------------------------------------------------------------------
// 塗り分けの定義（y はロケット全体の高さ）
// ---------------------------------------------------------------------
const S1 = {
  blacks: [
    { y0: 1.1, y1: 4.7, th: HP, half: Math.PI / 4 }, { y0: 1.1, y1: 4.7, th: -HP, half: Math.PI / 4 },
    { y0: 8.7, y1: 9.3 },
    ...[0, 1, 2, 3].map((i) => ({ y0: 9.3, y1: 11.7, th: i * HP, half: 0.2 })),
    { y0: 11.82, y1: 12.02 },
  ],
  corr: [[1.1, 2.75, 108], [8.55, 9.45, 108], [10.95, 12.4, 108]],
  rings: [1.13, 2.75, 8.55, 9.45, 10.95, 11.7, 12.37],
  seams: { y0: 2.75, pitch: 0.58, nV: 12 },
  frost: [[9.4, 11.0, 0.66]],
  hatches: [[0.36, 1.95, 0.3, 0.4], [1.22, 2.15, 0.26, 0.34], [-0.42, 2.0, 0.3, 0.36], [0.3, 11.3, 0.3, 0.26], [1.05, 11.32, 0.26, 0.24], [-1.0, 11.3, 0.3, 0.26], [2.7, 11.3, 0.3, 0.26], [1.0, 12.2, 0.24, 0.2]],
};
const S2 = {
  blacks: [{ y0: 12.4, y1: 12.95 }, { y0: 18.0, y1: 18.3 }],
  bands: [{ y0: 17.1, y1: 17.4, hex: 0xd97757 }, { y0: 17.4, y1: 17.7, hex: 0x4467f0 }, { y0: 17.7, y1: 18.0, node: rainbow }],
  corr: [[12.4, 12.95, 108], [18.0, 18.6, 108], [18.6, 20.0, 96, 0.009]],
  rings: [12.43, 12.95, 18.0, 18.6, 19.97],
  seams: { y0: 12.95, pitch: 0.69, nV: 12 },
  foam: [[12.95, 17.1]],
  frost: [[12.95, 13.5, 0.7], [13.5, 17.0, 0.36]],
  hatches: [[0.95, 12.68, 0.3, 0.26], [-0.6, 12.68, 0.26, 0.24], [0.9, 19.3, 0.24, 0.26], [2.4, 19.3, 0.24, 0.26]],
};
const S3 = {
  blacks: [{ y0: 20.0, y1: 20.5 }, { y0: 24.2, y1: 24.45 }],
  corr: [[20.0, 20.5, 72], [23.7, 24.2, 72]],
  rings: [20.03, 20.5, 23.7, 24.2, 24.45, 25.36, 26.27],
  seams: { y0: 20.5, pitch: 0.64, nV: 8 },
  foam: [[20.5, 23.7]],
  frost: [[20.5, 21.3, 0.68], [21.3, 23.6, 0.34]],
  hatches: [[1.3, 20.25, 0.24, 0.22], [1.25, 23.95, 0.22, 0.2], [1.1, 25.0, 0.3, 0.3], [-0.5, 25.75, 0.2, 0.2], [2.6, 25.0, 0.3, 0.3]],
};

export class Saturn {
  constructor() {
    const R = SAT.R;
    this.root = grp();
    const uFrost = (this.uFrost = uniform(0)), uHot1 = (this.uHot1 = uniform(0)), uHot2 = (this.uHot2 = uniform(0));
    const PART = partMaterial(), FLAT = partMaterial(true);
    const shellMesh = (geo, cfg) => { const m = new THREE.Mesh(geo, paintMaterial({ ...cfg, uFrost })); m.castShadow = true; m.receiveShadow = true; return m; };
    const cylGeo = (r, y0, y1, seg = 96) => new THREE.LatheGeometry([new THREE.Vector2(r, y0), new THREE.Vector2(r, y1)], seg);

    // =========================================================== 1 段目（S-IC）
    {
      const s1 = (this.s1 = grp());
      const aiTex = stackTex('AI', 256, 1024, 1.55);
      s1.add(shellMesh(cylGeo(R, 1.1, 12.4), { ...S1, letters: [{ tex: aiTex, th: 0, dth: 0.52, y0: 5.0, y1: 8.5 }, { tex: aiTex, th: Math.PI, dth: 0.52, y0: 5.0, y1: 8.5 }] }));
      const b = new Bag(), f = new Bag(), l = new Bag();
      // 底：遮熱板・縁の輪・発射台に載る 4 つの足
      b.add(xf(new THREE.CircleGeometry(R - 0.004, 72), { r: [HP, 0, 0], p: [0, 1.125, 0] }), C.shield, 0.92, 0);
      b.add(latheOf([[R, 1.06], [R + 0.026, 1.09], [R + 0.026, 1.2], [R, 1.23]], 96), 0x2d3036, 0.5, 0.6);
      for (let i = 0; i < 4; i++) b.add(atAz(new THREE.BoxGeometry(0.36, 0.2, 0.2), i * HP + Math.PI / 4, R + 0.06, 1.17), 0x3a3d44, 0.55, 0.7);
      // エンジンの覆いとフィン（±X は白い覆いに黒いフィン、±Z はその逆）
      const F = { cTop: R - 0.03, yTop: 3.45, cBot: 1.4, yBot: 1.0, rhoBot: 0.8, pow: 0.78 };
      const onF = (u, phi) => { const c = F.cTop + (F.cBot - F.cTop) * u, rho = F.rhoBot * Math.pow(u, F.pow); return [rho * Math.sin(phi), F.yTop + (F.yBot - F.yTop) * u, c + rho * Math.cos(phi)]; };
      for (let i = 0; i < 4; i++) {
        const th = i * HP, onX = i % 2 === 1;
        const fc = onX ? C.white : C.black, nc = onX ? C.black : C.white;
        b.add(fairingGeo(F).rotateY(th), fc, 0.42, 0);
        b.add(xf(new THREE.RingGeometry(0.3, F.rhoBot, 30), { r: [HP, 0, 0], p: [0, F.yBot, F.cBot] }).rotateY(th), C.shield, 0.92, 0);
        b.add(xf(hoop(F.rhoBot, 0, 0.02, 30, 6), { p: [0, F.yBot + 0.015, F.cBot] }).rotateY(th), 0x2d3036, 0.5, 0.6);
        const a = onF(0.42, 0), d = onF(0.985, 0);
        f.add(finGeo({ rootTop: [a[2] - 0.07, a[1]], rootBot: [d[2] - 0.06, d[1] + 0.02], zTip: 3.02, tipTop: 1.74, tipBot: 1.0 }).rotateY(th), nc, 0.42, 0);
        for (const s of [-1, 1]) {
          const p = onF(0.8, s * 1.0);
          b.add(xf(new THREE.BoxGeometry(0.1, 0.3, 0.09), { r: [0, s * 1.0, 0], p }).rotateY(th), fc, 0.42, 0);   // 空気の取り入れ口
          const q = onF(0.4, s * 0.7);
          b.add(xf(new THREE.BoxGeometry(0.12, 0.22, 0.03), { r: [0.07, s * 0.7, 0], p: q }).rotateY(th), 0x9a9da3, 0.5, 0.4); // 逆噴射ロケットの蓋
        }
      }
      // エンジン 5 基
      const epos = [[0, 0], [1.4, 0], [-1.4, 0], [0, 1.4], [0, -1.4]];
      this.f1 = [];
      for (const [x, z] of epos) {
        f1Engine(b, f, l, x, z);
        const fl = new Flame(0.6, 11, { gain: 1.5 }); fl.root.position.set(x, 0.05, z); s1.add(fl.root); this.f1.push(fl);
      }
      // 配線トンネルと加圧の配管
      for (const th of [0.62, 0.62 + Math.PI]) tunnel(b, S1, th, R, 2.95, 11.45);
      for (const th of [2.25, 2.33, 2.25 + Math.PI]) {
        const rr = R + 0.05, s = Math.sin(th), c = Math.cos(th);
        b.add(rod([rr * s, 4.95, rr * c], [rr * s, 11.15, rr * c], 0.022, 6), C.steel, 0.38, 0.9);
        for (let yy = 5.2; yy < 11.2; yy += 0.85) b.add(atAz(new THREE.BoxGeometry(0.07, 0.05, 0.06), th, R + 0.02, yy), C.dark, 0.5, 0.6);
      }
      // 段間部のアレッジモーター（8 基）
      for (let i = 0; i < 8; i++) {
        const th = i * (Math.PI / 4) + Math.PI / 8;
        b.add(atAz(xf(new THREE.CapsuleGeometry(0.058, 0.3, 4, 10), { s: [1, 1, 0.75] }), th, R + 0.02, 12.07), C.white, 0.44, 0);
        b.add(atAz(xf(new THREE.ConeGeometry(0.045, 0.1, 8), { r: [0.35, 0, 0] }), th, R + 0.045, 11.86), C.dark, 0.5, 0.6);
      }
      // 塔とつながる接続口（-X 側）
      for (const yy of [9.0, 11.3]) plate(b, -HP, R, yy);
      // 段間部の内側（切り離すと見える）：下塗りの黄緑、補強の骨、液体酸素タンクの丸い天井
      b.add(cylGeo(R - 0.035, 10.6, 12.4, 72), C.primer, 0.62, 0.1);
      b.add(xf(new THREE.RingGeometry(R - 0.035, R, 96), { r: [-HP, 0, 0], p: [0, 12.4, 0] }), 0x8d9096, 0.45, 0.7);
      for (let i = 0; i < 36; i++) b.add(atAz(new THREE.BoxGeometry(0.03, 1.72, 0.04), i * (TAU / 36), R - 0.055, 11.52), C.primer, 0.62, 0.1);
      for (const yy of [10.95, 11.65, 12.33]) b.add(hoop(R - 0.065, yy, 0.028, 72, 6), C.primer, 0.6, 0.1);
      b.add(xf(new THREE.SphereGeometry(1, 56, 14, 0, TAU, 0, HP), { s: [R - 0.04, 0.62, R - 0.04], p: [0, 10.62, 0] }), C.alu, 0.5, 0.55);
      b.add(xf(new THREE.CylinderGeometry(0.17, 0.2, 0.07, 20), { p: [0, 11.25, 0] }), C.steel, 0.4, 0.8);
      for (let i = 0; i < 12; i++) { const th = i * (TAU / 12); b.add(rod([Math.sin(th) * 0.2, 11.235, Math.cos(th) * 0.2], [Math.sin(th) * 1.5, 10.87, Math.cos(th) * 1.5], 0.012, 4), 0x9a9da3, 0.5, 0.6); }

      const liner = l.mesh(linerMaterial(uHot1, 0xff8a3a), { cast: false });
      s1.add(b.mesh(PART), f.mesh(FLAT), liner);
      // 噴射中、ノズルのすぐ下は黒い（燃料の多い排気の膜）。その先から白熱する。
      const soot = new Bag();
      epos.forEach(([x, z], i) => soot.add(new THREE.CylinderGeometry(0.585, 0.75, 1.56, 28, 8, true).translate(x, -0.76, z), 0, 0, 0, (vx, vy) => [(0.02 - vy) / 1.56, i * 0.37, 0]));
      this.uT1 = uniform(0);
      this.soot = soot.mesh(sootMaterial(this.uT1, uHot1), { cast: false, receive: false }); s1.add(this.soot);
      this.glow1 = glowSprite(0xffb060, 16, { gain: 0, pow: 2.0 }); this.glow1.position.y = -1.5; s1.add(this.glow1);
      this.light = new THREE.PointLight(0xffa35a, 0, 260, 1.7); this.light.position.y = -3; s1.add(this.light);
      recenter(s1, 6.0);
    }

    // =========================================================== 2 段目（S-II）
    {
      const s2 = (this.s2 = grp());
      const nameTex = stackTex('AIPOLLO', 192, 1088, 1.0, 0.8);
      const geo = mergeGeometries([cylGeo(R, 12.4, 18.6), new THREE.LatheGeometry([new THREE.Vector2(R, 18.6), new THREE.Vector2(1.08, 20.0)], 96)]);
      s2.add(shellMesh(geo, { ...S2, letters: [{ tex: nameTex, th: HP, dth: 0.4, y0: 13.2, y1: 16.9 }, { tex: nameTex, th: -HP, dth: 0.4, y0: 13.2, y1: 16.9 }] }));
      const b = new Bag(), f = new Bag(), l = new Bag();
      // 尻：タンクの丸い底、推力を受ける円すい、遮熱板と支柱
      b.add(cylGeo(R - 0.035, 12.4, 12.82, 72), C.primer, 0.62, 0.1);
      b.add(xf(new THREE.RingGeometry(R - 0.035, R, 96), { r: [HP, 0, 0], p: [0, 12.4, 0] }), 0x8d9096, 0.45, 0.7);
      b.add(latheOf([[0.98, 12.26], [R - 0.045, 12.8]], 64), C.primer, 0.62, 0.1);
      b.add(xf(new THREE.CircleGeometry(0.985, 48), { r: [HP, 0, 0], p: [0, 12.262, 0] }), 0x6f7740, 0.7, 0.1);
      for (let i = 0; i < 24; i++) { const th = i * (TAU / 24); b.add(rod([Math.sin(th) * 0.99, 12.255, Math.cos(th) * 0.99], [Math.sin(th) * (R - 0.06), 12.78, Math.cos(th) * (R - 0.06)], 0.014, 4), C.primer, 0.6, 0.1); }
      b.add(xf(new THREE.CylinderGeometry(1.2, 1.2, 0.03, 56), { p: [0, 11.9, 0] }), 0xa59c86, 0.7, 0.25);
      b.add(hoop(1.2, 11.9, 0.02, 56, 6), 0x7c7566, 0.6, 0.4);
      for (let i = 0; i < 8; i++) { const th = i * (Math.PI / 4) + Math.PI / 8; b.add(rod([Math.sin(th) * 1.19, 11.91, Math.cos(th) * 1.19], [Math.sin(th) * (R - 0.09), 12.5, Math.cos(th) * (R - 0.09)], 0.016, 5), C.steel, 0.4, 0.85); }
      // エンジン 5 基
      this.f2 = [];
      const Y2 = 11.33;
      for (const [x, z] of [[0, 0], [0.9, 0], [-0.9, 0], [0, 0.9], [0, -0.9]]) {
        j2Engine(b, f, l, x, Y2, z);
        const fl = new Flame(0.33, 5.5, { colA: 0xcfe6ff, colB: 0x5a8cff, coreA: 0xffffff, coreB: 0xd8ecff, gain: 2.0 }); fl.root.position.set(x, Y2 + 0.02, z); s2.add(fl.root); this.f2.push(fl);
      }
      // 液体水素の配管の覆い（5 本）・配線トンネル・接続口
      for (let i = 0; i < 5; i++) b.add(atAz(halfTube(0.17, 0.085, 12.6, 14.05), 0.55 + i * (TAU / 5), R - 0.004), C.white, 0.44, 0);
      tunnel(b, S2, 0.22, R, 13.0, 17.05, 0.18, 0.08);
      tunnel(b, S2, 3.6, R, 13.0, 17.05, 0.18, 0.08);
      for (const yy of [12.68, 15.4, 18.42]) plate(b, -HP, R, yy, 0.32, 0.24);
      // 上のすぼまり（3 段目との段間）に付く逆噴射ロケット
      for (let i = 0; i < 4; i++) { const th = i * HP + Math.PI / 4; b.add(atAz(xf(new THREE.CapsuleGeometry(0.05, 0.3, 4, 8), { r: [-0.39, 0, 0], s: [1, 1, 0.8] }), th, 1.37, 19.3), C.white, 0.44, 0); }

      s2.add(b.mesh(PART), f.mesh(FLAT), l.mesh(linerMaterial(uHot2, 0xcfe0ff), { cast: false }));
      this.glow2 = glowSprite(0x9fc4ff, 9, { gain: 0, pow: 2.0 }); this.glow2.position.y = 10.6; s2.add(this.glow2);
      recenter(s2, 15.5);
    }

    // =========================================================== 3 段目（S-IVB）＋計器の輪＋着陸船の覆い（SLA）
    {
      const s3 = (this.s3 = grp());
      const geo = mergeGeometries([cylGeo(1.08, 20.0, 24.45, 80), new THREE.LatheGeometry([new THREE.Vector2(1.08, 24.45), new THREE.Vector2(0.78, 26.3)], 80)]);
      this.sla = shellMesh(geo, S3); s3.add(this.sla);
      const b = new Bag(), f = new Bag();
      // 補助推進モジュール（2 基）
      for (const th of [0, Math.PI]) {
        b.add(atAz(halfTube(0.34, 0.2, 20.18, 20.78, 12), th, 1.075), C.white, 0.44, 0);
        b.add(atAz(xf(new THREE.SphereGeometry(1, 12, 8, 0, TAU, 0, HP), { s: [0.17, 0.16, 0.2] }), th, 1.075, 20.78), C.white, 0.44, 0);
        for (const [rz, dx] of [[-HP, 0.17], [HP, -0.17]]) b.add(atAz(xf(latheOf([[0.016, 0], [0.024, 0.03], [0.04, 0.08]], 10), { r: [0, 0, rz], p: [dx, 0, 0.12] }), th, 1.075, 20.5), C.dark, 0.45, 0.8);
        b.add(atAz(xf(latheOf([[0.02, 0], [0.03, 0.04], [0.05, 0.1]], 10), { r: [Math.PI - 0.3, 0, 0], p: [0, 0, 0.16] }), th, 1.075, 20.22), C.dark, 0.45, 0.8);
      }
      tunnel(b, S3, 0.7, 1.08, 20.6, 24.1, 0.16, 0.07);
      for (const yy of [20.3, 23.95]) plate(b, -HP, 1.08, yy, 0.3, 0.22);
      // 計器の輪のアンテナ
      for (let i = 0; i < 6; i++) b.add(atAz(new THREE.BoxGeometry(0.16, 0.12, 0.03), i * (TAU / 6) + 0.4, 1.085, 24.32), 0xd9dadb, 0.5, 0.1);
      // 3 段目のエンジン（段間の中に隠れている）
      j2Engine(b, f, null, 0, 18.95, 0, false);
      s3.add(b.mesh(PART), f.mesh(FLAT));
      this.f3 = new Flame(0.33, 6.5, { colA: 0xcfe6ff, colB: 0x5a8cff, coreA: 0xffffff, coreB: 0xd8ecff, gain: 2.0 }); this.f3.root.position.y = 18.97; s3.add(this.f3.root);
      recenter(s3, 22.2);
    }

    // =========================================================== 司令・機械船
    const csm = (this.csm = grp());
    const c = makeCSM({ stowed: true }); c.position.y = 26.3; csm.add(c);
    recenter(csm, 27.4);

    // =========================================================== 緊急脱出塔＋司令船の白い防護カバー
    {
      const les = (this.les = grp());
      const b = new Bag();
      // 防護カバー（打ち上げ中は司令船を覆い、塔と一緒に外れる）
      b.add(latheOf([[0.802, 27.88], [0.802, 27.93], [0.766, 28.02], [0.246, 28.98], [0.215, 29.07]], 72), C.white, 0.46, 0);
      b.add(hoop(0.802, 27.9, 0.012, 72, 6), 0xb9babb, 0.5, 0.2);
      for (const s of [-1, 1]) b.add(atAz(xf(new THREE.BoxGeometry(0.1, 0.15, 0.012), { r: [-0.496, 0, 0] }), s * 0.36, 0.74 - (2.3 - 1.72) * 0.5417 + 0.03, 26.3 + 2.3), 0x10141c, 0.15, 0.2);
      b.add(atAz(xf(new THREE.BoxGeometry(0.3, 0.38, 0.012), { r: [-0.496, 0, 0] }), 0, 0.74 - (2.02 - 1.72) * 0.5417 + 0.027, 26.3 + 2.02), 0xd9dadb, 0.5, 0.1);
      // 塔（4 本脚のトラス）
      const lv = [[29.05, 0.152], [29.5, 0.121], [29.97, 0.09]];
      const P = (k, i) => { const [y, a] = lv[k]; const sx = [1, -1, -1, 1][i], sz = [1, 1, -1, -1][i]; return [sx * a, y, sz * a]; };
      for (let i = 0; i < 4; i++) {
        b.add(rod(P(0, i), P(2, i), 0.017, 6), 0xc3c7cd, 0.4, 0.75);
        for (let k = 0; k < 3; k++) b.add(rod(P(k, i), P(k, (i + 1) % 4), 0.011, 5), 0xc3c7cd, 0.4, 0.75);
        for (let k = 0; k < 2; k++) { b.add(rod(P(k, i), P(k + 1, (i + 1) % 4), 0.009, 5), 0xc3c7cd, 0.4, 0.75); b.add(rod(P(k, (i + 1) % 4), P(k + 1, i), 0.009, 5), 0xc3c7cd, 0.4, 0.75); }
      }
      // 脱出ロケット：すそと 4 つの斜めの噴射口、白い胴、先端の計測器
      b.add(latheOf([[0.185, 29.93], [0.185, 29.98], [0.137, 30.14]], 32), 0x30333a, 0.5, 0.6);
      for (let i = 0; i < 4; i++) b.add(atAz(xf(new THREE.CylinderGeometry(0.03, 0.062, 0.15, 12, 1, true), { r: [0.6, 0, 0] }), i * HP + Math.PI / 4, 0.16, 29.92), 0x25272b, 0.5, 0.7);
      b.add(latheOf([[0.137, 30.12], [0.137, 31.2]], 32), C.white, 0.44, 0);
      for (const yy of [30.52, 30.96]) b.add(hoop(0.138, yy, 0.007, 32, 5), 0x8a8d92, 0.5, 0.4);
      b.add(latheOf([[0.14, 31.17], [0.14, 31.23]], 32), 0x30333a, 0.5, 0.5);
      b.add(latheOf([[0.137, 31.22], [0.125, 31.33], [0.096, 31.48], [0.056, 31.61], [0.024, 31.68], [0.0, 31.7]], 32), C.white, 0.44, 0);
      b.add(xf(new THREE.SphereGeometry(0.026, 12, 8), { p: [0, 31.685, 0] }), C.steel, 0.3, 0.95);
      les.add(b.mesh(PART));
      recenter(les, 30.4);
    }

    this.root.add(this.s1, this.s2, this.s3, this.csm, this.les);
    this.stages = [this.s1, this.s2, this.s3, this.csm, this.les];
    this.reset();
  }

  reset() {
    this.root.visible = false; this.root.position.set(0, 0, 0); this.root.rotation.set(0, 0, 0); this.root.scale.setScalar(1);
    for (const s of this.stages) { s.visible = true; s.position.set(0, s.userData.home, 0); s.rotation.set(0, 0, 0); s.scale.setScalar(1); }
    for (const f of this.f1) f.set(0, 0); for (const f of this.f2) f.set(0, 0); this.f3.set(0, 0);
    this.glow1.visible = false; this.glow2.visible = false; this.light.intensity = 0;
    this.uFrost.value = 0; this.uHot1.value = 0; this.uHot2.value = 0; this.soot.visible = false;
  }
  /** 組み立ての進み具合：n 個目までの段を見せる（1〜5） */
  built(n) { this.stages.forEach((s, i) => { s.visible = i < n; }); return this; }
  /** 霜（燃料を入れた打ち上げ前の姿）0..1 */
  frost(k = 1) { this.uFrost.value = k; return this; }
  fire1(T, p = 1, len = 1) { this.f1.forEach((f, i) => { const d = i === 0 ? 0 : i < 3 ? 0.14 : 0.28; f.set(T + f.root.position.x * 3.1, Math.min(1, Math.max(0, (p - d) / (1 - d))), len); }); this.glow1.visible = p > 0.01; this.glow1.userData.gain.value = p * 0.22; this.light.intensity = (p * 1400 + 4 * p * (1 - p) * 900 * (0.6 + 0.4 * Math.sin(T * 71))) * (0.88 + 0.08 * Math.sin(T * 47) + 0.04 * Math.sin(T * 113)); this.uHot1.value = p; this.uT1.value = T; this.soot.visible = p > 0.03; return this; }
  fire2(T, p = 1, len = 1) { for (const f of this.f2) f.set(T + f.root.position.x * 2.3, p, len); this.glow2.visible = p > 0.01; this.glow2.userData.gain.value = p * 0.3; this.uHot2.value = p; return this; }
  fire3(T, p = 1, len = 1) { this.f3.set(T, p, len); return this; }
}
