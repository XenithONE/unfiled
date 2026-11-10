// 作業場（前半の舞台）：格納庫「AI SPACE LAB」・給水塔・パラボラアンテナ・設計図の掲示板・作業台・木箱とドラム缶・
// カラーコーン・試験場の円い台・建物の足もとの雑草。
//   画像は使わない。形状は素材ごとに 1 つのメッシュへまとめ、質感（波板・木目・さび・雨だれ・すす）は位置から計算する。
//   ここは役者の大きさの世界（1 ≒ 1 m）。物の位置と大きさは、役者とカメラが合わせてあるので変えない。
import * as THREE from 'three/webgpu';
import {
  positionLocal, normalLocal, uv, uniform, time, instanceIndex, hash, mx_cell_noise_float,
  mix, color, vec2, vec3, float, max, min, fract, floor, step, smoothstep, length, texture, fwidth, sin, cos, atan, asin,
} from 'three/tsl';
import { canvasTex, mergeGeometries } from '../core/kit.js';
import { bumpNormal, yardH } from './terrain.js';
import { glowSprite } from '../fx/fx.js';
import { FX_LAYER } from '../core/engine.js';
import { pixText } from '../core/pixfont.js';
import { mulberry } from '../core/util.js';
import { Bag, ladder, pipeRun, faceUV, gridLine, fall, nz, paintMat, galvMat, grateMat, concreteMat } from './pad.js';

const P = positionLocal, NL = normalLocal;
export const HANGAR = { x: -36, z: -34, ry: 0.5 };
const TWO_PI = Math.PI * 2;

// =====================================================================
// 質感
// =====================================================================
/** 波板（外壁・屋根・引き戸）：波の陰影・重ね目・ねじの列・1 枚ごとの色の差・雨だれ・さび・地面ぎわのはね汚れ */
function corrMat(o = {}) {
  const m = new THREE.MeshStandardNodeMaterial();
  const { u, v, isY } = faceUV();
  const rc = mix(u, v, isY);                    // 波が並ぶ向き（壁：横／屋根：棟の向き）
  const al = mix(v, u, isY);                    // 波に沿う向き（壁：高さ／屋根：軒から棟へ）
  const pitch = o.pitch ?? 0.19, lapL = o.lap ?? 2.4;
  const ph = rc.div(pitch);
  const wave = sin(ph.mul(TWO_PI)).mul(0.5).add(0.5);
  const near = fall(0.2, 0.8, fwidth(ph));                              // 遠くでは波をならす（ちらつき防止）
  const lap = gridLine(al, lapL, 0.014);
  const dRow = fract(al.div(1.2).sub(0.5)).sub(0.5).abs().mul(1.2);
  const dScrew = length(vec2(dRow, fract(ph.mul(0.5)).sub(0.5).mul(pitch * 2)));
  const close = fall(0.003, 0.014, fwidth(u).add(fwidth(v)));
  const screw = fall(0.011, 0.02, dScrew).mul(close);
  const q = vec2(u, v);
  const big = nz(q.mul(0.045)).r, fine = nz(q.mul(1.3)).b;
  const sheet = mx_cell_noise_float(vec2(floor(rc.div(o.sheet ?? 0.95)), floor(al.div(lapL))).add(7.0));
  const streak = nz(vec2(rc.mul(0.55), al.mul(0.035))).g;
  const low = o.splash ? fall(0.0, 1.6, P.y.sub(o.base ?? 0.3)).mul(isY.oneMinus()) : float(0);
  const rust = smoothstep(0.86, 0.99, nz(vec2(rc.mul(0.5), al.mul(0.07)).add(0.31)).a.add(lap.mul(0.2)).add(low.mul(0.16))).mul(o.rust ?? 0.6);
  let c = color(o.hex ?? 0xcdd0cb).mul(sheet.mul(0.1).add(0.92)).mul(big.mul(0.16).add(0.9)).mul(fine.mul(0.06).add(0.97));
  c = c.mul(mix(float(0.97), wave.mul(0.2).add(0.87), near));
  c = c.mul(smoothstep(0.5, 0.93, streak).mul(-0.3).add(1.0));
  c = mix(c, color(0x6a3a22).mul(fine.mul(0.5).add(0.6)), rust);
  c = c.mul(lap.mul(-0.4).add(1.0)).mul(screw.mul(-0.5).add(1.0));
  if (o.splash) c = mix(c, color(0x6b5d48), fall(0.0, 0.75, P.y.sub(o.base ?? 0.3)).mul(isY.oneMinus()).mul(big.mul(0.5).add(0.3)));
  m.colorNode = c;
  if (o.night && o.lamps) {
    // 正面の壁：外壁の照明が落とす光のたまり
    let wash = float(0);
    for (const [lx, ly] of o.lamps) wash = wash.add(fall(0.0, 3.2, P.x.sub(lx).abs()).mul(fall(-0.2, 5.5, float(ly).sub(P.y))).mul(step(P.y, ly + 0.3)));
    m.emissiveNode = c.mul(vec3(1.0, 0.8, 0.52)).mul(wash.clamp(0, 1.4)).mul(step(0.7, NL.z)).mul(o.night).mul(0.9);
  }
  m.roughnessNode = float(o.rough ?? 0.5).add(rust.mul(0.35)).add(big.mul(0.1));
  m.metalnessNode = float(o.metal ?? 0.1).mul(rust.oneMinus());
  m.normalNode = bumpNormal(wave.mul(near).mul(pitch * 0.1).add(lap.mul(-0.006)).add(screw.mul(0.004)), 1.0);
  return m;
}

/** 窓ガラス：昼は空を映し、夜は中の明かりで光る */
function glassMat(uN) {
  const m = new THREE.MeshStandardNodeMaterial();
  const { u, v } = faceUV();
  const dirt = nz(vec2(u, v).mul(0.35)).g;
  m.colorNode = color(0x56636f).mul(dirt.mul(0.25).add(0.8));
  m.roughnessNode = float(0.05).add(dirt.mul(0.1));
  m.metalness = 0.9;
  const room = nz(vec2(u.mul(0.11), v.mul(0.17))).r;                    // 部屋の中の明暗（棚や物の影）
  m.emissiveNode = vec3(2.3, 1.75, 1.0).mul(room.mul(0.5).add(0.5)).mul(uN);
  return m;
}

/** 木：板の合わせ目・木目・節・傷・日焼け・しみ。水平な面の木目は x 向き、垂直な面は高さの向き（cross で入れ替え、horiz でどの面も横向き） */
function woodMat(o = {}) {
  const m = new THREE.MeshStandardNodeMaterial();
  const { u, v, isY } = faceUV();
  const g = o.horiz ? u : o.cross ? mix(u, v, isY) : mix(v, u, isY);
  const w = o.horiz ? v : o.cross ? mix(v, u, isY) : mix(u, v, isY);
  const pw = o.plank ?? 0.16;
  const tint = mx_cell_noise_float(vec2(floor(w.div(pw)), float(o.seed ?? 1.0)));
  const near = fall(0.004, 0.03, fwidth(u).add(fwidth(v)));
  const dg = float(0.5).sub(fract(w.div(pw)).sub(0.5).abs()).mul(pw);
  const gap = fall(0.003, 0.009, dg).mul(near);
  const gs = vec2(g.mul(0.22).add(tint.mul(5.0)), w.mul(2.6).add(tint.mul(3.0)));
  const grain = nz(gs).g.mul(0.6).add(nz(gs.mul(vec2(1.0, 4.0))).b.mul(0.4));
  const knot = smoothstep(0.965, 0.995, nz(vec2(g.mul(0.12), w.mul(0.55)).add(tint.mul(2.0))).a);
  const scr = fall(0.0, 0.006, nz(vec2(g.mul(0.035).add(0.3), w.mul(1.9))).r.sub(0.5).abs()).mul(near).mul(o.worn ?? 0.6);
  let c = mix(color(o.hex ?? 0xa9773f), color(o.dark ?? 0x6e4a28), grain.mul(0.75)).mul(tint.mul(0.24).add(0.86));
  c = mix(c, color(0x3a2616), knot.mul(0.8));
  if (o.gray) c = mix(c, color(0x8b867a), nz(vec2(u, v).mul(0.05)).r.mul(o.gray));
  if (o.stain) {
    const st = smoothstep(0.6, 0.9, nz(vec2(u, v).mul(0.21).add(0.4)).a).mul(isY);
    c = mix(c, color(0x2a221a), st.mul(o.stain));
    // ペンキのしずく
    const cell = floor(vec2(u, v).mul(9.0)), fr = fract(vec2(u, v).mul(9.0)).sub(0.5);
    const hv = mx_cell_noise_float(cell.add(11.0));
    const drop = fall(0.05, 0.11, length(fr)).mul(step(0.86, hv)).mul(isY);
    c = mix(c, mix(color(0x2f5fb0), color(0xd8d4c8), step(0.93, hv)), drop.mul(0.85));
  }
  c = mix(c, c.mul(1.45), scr.mul(0.5));
  c = c.mul(gap.mul(-0.75).add(1.0));
  m.colorNode = c;
  m.roughnessNode = float(o.rough ?? 0.78).sub(grain.mul(0.1));
  m.metalness = 0;
  m.normalNode = bumpNormal(grain.mul(0.0016).mul(near).add(gap.mul(-0.006)).add(knot.mul(-0.002)), 1.0);
  return m;
}

/** 段ボールの面（絵は canvas：地の色・印刷・テープ・荷札） */
function cardMat(tex) {
  const m = new THREE.MeshStandardNodeMaterial();
  const t = texture(tex, uv());
  const fiber = nz(uv().mul(vec2(2.0, 9.0))).b, big = nz(uv().mul(0.6)).r;
  const e = min(min(uv().x, uv().x.oneMinus()), min(uv().y, uv().y.oneMinus()));
  m.colorNode = t.rgb.mul(fiber.mul(0.1).add(0.95)).mul(big.mul(0.14).add(0.9)).mul(fall(0.0, 0.035, e).mul(0.22).add(1.0));
  m.roughness = 0.9; m.metalness = 0;
  m.normalNode = bumpNormal(fiber.mul(0.0008).add(sin(uv().y.mul(140.0)).mul(0.0004)), 1.0);
  return m;
}
function cardTextures() {
  const S = 512, KRAFT = '#a8845a';
  const base = (ctx) => {
    ctx.fillStyle = KRAFT; ctx.fillRect(0, 0, S, S);
    const r = mulberry(7);
    for (let i = 0; i < 900; i++) { ctx.fillStyle = `rgba(${r() < 0.5 ? '70,50,30' : '220,190,150'},${0.03 + r() * 0.05})`; ctx.fillRect(r() * S, r() * S, 2 + r() * 14, 1); }
  };
  const tape = (ctx, x, y, w, h) => { ctx.fillStyle = 'rgba(214,190,140,0.82)'; ctx.fillRect(x, y, w, h); ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x, y + h * 0.15, w, h * 0.12); };
  const top = canvasTex(S, S, (ctx) => {
    base(ctx);
    ctx.strokeStyle = 'rgba(50,35,20,0.7)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, S / 2); ctx.lineTo(S, S / 2); ctx.stroke();
    tape(ctx, 0, S / 2 - 36, S, 72);
  });
  const sideA = canvasTex(S, S, (ctx) => {
    base(ctx);
    tape(ctx, S / 2 - 36, 0, 72, 96);
    // 荷札
    ctx.fillStyle = '#eeeae0'; ctx.fillRect(40, 150, 230, 150);
    ctx.fillStyle = '#1b1b1b'; ctx.fillRect(52, 162, 120, 10); ctx.fillRect(52, 182, 180, 6); ctx.fillRect(52, 196, 150, 6);
    for (let i = 0; i < 34; i++) ctx.fillRect(54 + i * 6, 226, i % 3 ? 2 : 4, 56);
    pixText(ctx, 'TO: AI SPACE LAB', 300, 170, 2, '#2b2018');
    pixText(ctx, 'ROCKET PARTS', 300, 210, 3, '#2b2018');
    pixText(ctx, 'QTY 1/27', 300, 262, 2, '#2b2018');
    ctx.strokeStyle = '#2b2018'; ctx.lineWidth = 6; ctx.strokeRect(22, 372, 468, 112);
    pixText(ctx, 'HANDLE WITH CARE', S / 2, 404, 4, '#2b2018', { align: 'center' });
  });
  const sideB = canvasTex(S, S, (ctx) => {
    base(ctx);
    tape(ctx, S / 2 - 36, 0, 72, 96);
    pixText(ctx, 'FRAGILE', S / 2, 150, 8, '#a8281f', { align: 'center' });
    // 上向きの矢印 2 本
    ctx.fillStyle = '#2b2018';
    for (const cx of [150, 362]) { ctx.beginPath(); ctx.moveTo(cx, 268); ctx.lineTo(cx + 44, 330); ctx.lineTo(cx + 16, 330); ctx.lineTo(cx + 16, 420); ctx.lineTo(cx - 16, 420); ctx.lineTo(cx - 16, 330); ctx.lineTo(cx - 44, 330); ctx.closePath(); ctx.fill(); }
    ctx.fillRect(96, 436, 320, 10);
    pixText(ctx, 'THIS SIDE UP', S / 2, 462, 3, '#2b2018', { align: 'center' });
  });
  return { top, sideA, sideB };
}

/** ドラム缶の塗装：帯と縁のさび・すり傷・へこみ・底の泥はね（原点は缶の底の中心・高さ 1） */
function drumMat(hex) {
  const m = new THREE.MeshStandardNodeMaterial();
  const a = atan(P.x, P.z).div(TWO_PI), q = vec2(a.mul(3.0), P.y);
  const n = nz(q.mul(0.9)).r, fine = nz(q.mul(6.0)).b;
  const hoop = max(fall(0.0, 0.05, P.y.sub(0.335).abs()), fall(0.0, 0.05, P.y.sub(0.665).abs()));
  const rim = max(fall(0.0, 0.07, P.y), fall(0.0, 0.07, float(1.0).sub(P.y)));
  const rust = smoothstep(0.9, 0.995, nz(vec2(a.mul(4.0), P.y.mul(0.7)).add(0.2)).a.add(hoop.mul(0.14)).add(rim.mul(0.2)));
  const scr = fall(0.0, 0.008, nz(vec2(a.mul(0.4), P.y.mul(2.6))).g.sub(0.5).abs());      // 横に走るすり傷
  let c = color(hex).mul(n.mul(0.25).add(0.83)).mul(fine.mul(0.08).add(0.96));
  c = mix(c, color(0xb9bcc0), scr.mul(0.5));
  c = mix(c, color(0x5b3320).mul(fine.mul(0.5).add(0.6)), rust.mul(0.85));
  c = c.mul(fall(0.0, 0.25, P.y).mul(-0.35).add(1.0));
  m.colorNode = c;
  m.roughnessNode = float(0.42).add(rust.mul(0.4)).add(n.mul(0.1));
  m.metalnessNode = float(0.35).mul(rust.oneMinus());
  m.normalNode = bumpNormal(nz(vec2(a.mul(2.0), P.y.mul(0.55)).add(0.7)).r.mul(0.0035).add(fine.mul(0.0005)), 1.0);
  return m;
}
function drumGeo() {
  const pts = [[0, 0], [0.355, 0], [0.375, 0.012], [0.385, 0.03], [0.375, 0.05], [0.372, 0.31], [0.388, 0.335], [0.372, 0.36], [0.372, 0.64], [0.388, 0.665], [0.372, 0.69], [0.375, 0.95], [0.385, 0.97], [0.375, 0.988], [0.355, 1.0], [0.35, 0.975], [0, 0.975]];
  return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 32);
}

/** カラーコーン：反射帯 2 本・すり傷・土の汚れ・黒いゴムの台（原点は地面） */
function coneMat() {
  const m = new THREE.MeshStandardNodeMaterial();
  const a = atan(P.x, P.z).div(TWO_PI), y = P.y;
  const n = nz(vec2(a.mul(2.0), y.mul(1.4))).r, fine = nz(vec2(a.mul(6.0), y.mul(5.0))).b;
  const band = max(step(0.2, y).mul(step(y, 0.285)), step(0.345, y).mul(step(y, 0.405)));
  const base = step(y, 0.041);
  const dirt = fall(0.03, 0.3, y.add(n.mul(0.12))).mul(0.55).add(smoothstep(0.7, 0.95, nz(vec2(a.mul(3.0), y.mul(2.2)).add(0.4)).a).mul(0.35));
  let c = mix(color(0xea5f10), color(0xe6e6e1), band).mul(n.mul(0.16).add(0.9));
  c = mix(c, color(0x5b5247), dirt.clamp(0, 0.8));
  c = mix(c, color(0x17171a).mul(fine.mul(0.4).add(0.8)), base);
  m.colorNode = c;
  m.roughnessNode = mix(float(0.48), float(0.3), band).add(dirt.mul(0.35)).add(base.mul(0.3));
  m.metalness = 0;
  return m;
}
function coneGeo() {
  const body = new THREE.LatheGeometry([[0.17, 0.036], [0.166, 0.052], [0.13, 0.07], [0.03, 0.49], [0.022, 0.5], [0, 0.5]].map(([r, y]) => new THREE.Vector2(r, y)), 24);
  const base = new THREE.BoxGeometry(0.4, 0.036, 0.4); base.translate(0, 0.018, 0);
  return mergeGeometries([body, base], false);
}

/** 試験場の台のコンクリート：放射状の打ち継ぎ・黄色い線のかすれ・しみ・ひび・こげ跡（scorchU） */
function testPadMat(scorchU) {
  const m = new THREE.MeshStandardNodeMaterial();
  const q = P.xz, r = length(q), a = atan(P.z, P.x);
  const top = step(0.7, NL.y);
  const big = nz(q.mul(0.06).add(0.2)).r, n4 = nz(q.mul(1.6)).b;
  const seg = Math.PI / 4;
  const dRad = fract(a.div(seg).sub(0.5)).sub(0.5).abs().mul(seg).mul(r);
  const lw = max(float(0.012), fwidth(P.x).add(fwidth(P.z)).mul(0.8));
  const jRad = smoothstep(lw.mul(0.35), lw, dRad).oneMinus().mul(step(1.7, r));
  const jRing = smoothstep(lw.mul(0.35), lw, r.sub(1.7).abs()).oneMinus();
  const joint = max(jRad, jRing).mul(float(0.012).div(lw).clamp(0, 1)).mul(top);
  const stain = smoothstep(0.5, 0.92, nz(q.mul(0.13).add(0.5)).g);
  const crack = fall(0.006, 0.016, nz(q.mul(0.11).add(0.3)).a.sub(0.5).abs());
  let c = mix(color(0xaeaaa0), color(0x8c8981), big).mul(n4.mul(0.12).add(0.94));
  c = c.mul(stain.mul(-0.22).add(1.0)).mul(joint.mul(-0.45).add(1.0)).mul(crack.mul(-0.25).add(1.0));
  const wear = smoothstep(0.22, 0.6, nz(q.mul(0.9)).r.mul(0.6).add(nz(q.mul(3.3)).b.mul(0.4)));
  const ring = fall(0.07, 0.085, r.sub(3.2).abs());
  const tick = fall(0.035, 0.05, min(P.x.abs(), P.z.abs())).mul(step(2.3, r)).mul(step(r, 3.0));
  c = mix(c, color(0xd2a416), max(ring, tick).mul(wear).mul(top).mul(0.9));
  const sN = nz(vec2(a.div(TWO_PI).mul(3.0), r.mul(0.07))).g;
  const sc = scorchU.mul(fall(0.3, 3.4, r.add(sN.mul(1.3)).sub(scorchU.mul(0.6)))).mul(top);
  c = mix(c, color(0x0f0d0b), sc.mul(0.92));
  c = mix(c, color(0x6b5a44), top.oneMinus().mul(fall(0.0, 0.3, P.y)).mul(0.5));
  m.colorNode = c;
  m.roughnessNode = float(0.9).sub(stain.mul(0.1)).sub(sc.mul(0.25));
  m.metalness = 0;
  m.normalNode = bumpNormal(n4.mul(0.008).add(joint.mul(-0.01)).add(crack.mul(-0.006)), 1.0);
  return m;
}

/** 給水塔のタンク（球・中心の高さ cy）：鋼板の継ぎ目・継ぎ目からのさび筋・雨だれ・帯の赤 */
function tankMat(cy, R) {
  const m = new THREE.MeshStandardNodeMaterial();
  const d = P.sub(vec3(0, cy, 0));
  const lat = asin(d.y.div(R).clamp(-1, 1)), lon = atan(d.x, d.z);
  const lonN = lon.div(TWO_PI);
  const near = fall(0.002, 0.012, fwidth(lat).add(fwidth(lonN)));
  const seamM = fall(0.004, 0.008, fract(lonN.mul(14.0).sub(0.5)).sub(0.5).abs().div(14.0).mul(TWO_PI).mul(cos(lat).max(0.05)));
  const seamP = fall(0.004, 0.008, fract(lat.div(0.3927).sub(0.5)).sub(0.5).abs().mul(0.3927));
  const seam = max(seamM, seamP).mul(near);
  const q = vec2(lonN.mul(5.0), lat.mul(0.5));
  const n = nz(q.mul(0.5)).r, fine = nz(q.mul(4.0)).b;
  const streak = nz(vec2(lonN.mul(9.0), lat.mul(0.05))).g;
  const under = fall(-1.2, -0.2, lat);                                        // 下半分は雨だれが濃い
  const rust = smoothstep(0.78, 0.98, nz(vec2(lonN.mul(7.0), lat.mul(0.16)).add(0.3)).a.add(seam.mul(0.25)).add(under.mul(0.12))).mul(0.7);
  let c = color(0xe3e6e6).mul(n.mul(0.16).add(0.9)).mul(fine.mul(0.06).add(0.97));
  c = mix(c, color(0xb5322a), fall(0.07, 0.09, lat.abs()));                   // 赤い帯
  c = c.mul(smoothstep(0.45, 0.9, streak).mul(under.mul(0.3).add(0.12)).oneMinus());
  c = mix(c, color(0x6a3a22).mul(fine.mul(0.5).add(0.6)), rust);
  c = c.mul(seam.mul(-0.4).add(1.0));
  m.colorNode = c;
  m.roughnessNode = float(0.48).add(rust.mul(0.35));
  m.metalnessNode = float(0.15).mul(rust.oneMinus());
  m.normalNode = bumpNormal(seam.mul(-0.004).add(fine.mul(0.0005)), 1.0);
  return m;
}

/** アンテナの皿（白い板を放射状に張ってある） */
function dishMat() {
  const m = new THREE.MeshStandardNodeMaterial();
  m.side = THREE.DoubleSide;
  const r = length(P.xz), a = atan(P.x, P.z).div(TWO_PI);
  const near = fall(0.003, 0.02, fwidth(r).add(fwidth(a).mul(6.0)));
  const seam = max(fall(0.006, 0.014, fract(a.mul(16.0).sub(0.5)).sub(0.5).abs().div(16.0).mul(TWO_PI).mul(r)), max(fall(0.006, 0.014, r.sub(1.2).abs()), fall(0.006, 0.014, r.sub(2.15).abs()))).mul(near);
  const n = nz(vec2(a.mul(4.0), r.mul(0.2))).r, fine = nz(vec2(a.mul(9.0), r)).b;
  const grime = smoothstep(0.55, 0.95, nz(vec2(a.mul(6.0), r.mul(0.08)).add(0.4)).g);
  let c = color(0xe6e7e4).mul(n.mul(0.14).add(0.9)).mul(fine.mul(0.05).add(0.97)).mul(grime.mul(-0.2).add(1.0));
  c = c.mul(seam.mul(-0.4).add(1.0));
  m.colorNode = c;
  m.roughness = 0.42; m.metalness = 0.05;
  return m;
}

/** 掲示板の面（クリーム色に塗ったベニヤ）：手あか・画びょうの穴・テープのあと */
function panelMat() {
  const m = new THREE.MeshStandardNodeMaterial();
  const q = vec2(P.x, P.y);
  const n = nz(q.mul(0.12)).r, fine = nz(q.mul(2.2)).b, grain = nz(vec2(P.x.mul(0.3), P.y.mul(3.0))).g;
  const hole = smoothstep(0.985, 0.998, nz(q.mul(1.1).add(0.3)).a);
  let c = color(0xe7dfcc).mul(n.mul(0.14).add(0.9)).mul(grain.mul(0.06).add(0.97)).mul(fine.mul(0.05).add(0.975));
  c = mix(c, color(0x5c4a34), hole.mul(0.7));
  m.colorNode = c;
  m.roughness = 0.86; m.metalness = 0;
  m.normalNode = bumpNormal(grain.mul(0.0008).add(hole.mul(-0.002)), 1.0);
  return m;
}

function makeMats(uN) {
  const M = {};
  const LAMPS = [[-6.2, 6.95], [6.2, 6.95], [-11.0, 6.95], [11.0, 6.95]];
  M.wall = corrMat({ hex: 0xcdd0cb, splash: true, base: 0.3, rust: 0.34, metal: 0.1, rough: 0.5, night: uN, lamps: LAMPS });
  M.door = corrMat({ hex: 0x4c5b68, splash: true, base: 0.05, rust: 0.4, metal: 0.1, rough: 0.5, sheet: 1.02 });
  M.roof = corrMat({ hex: 0x9aa6b0, pitch: 0.24, lap: 3.2, rust: 0.5, metal: 0.72, rough: 0.42 });
  M.trim = paintMat(0xe1e2df, { rust: 0.3, rough: 0.5, metal: 0.05, streak: 0.5 });
  M.frame = paintMat(0x5a2f27, { rust: 0.5, rough: 0.55, metal: 0.2 });
  M.steel = paintMat(0x6f757c, { rust: 0.45, rough: 0.5, metal: 0.55 });
  M.chrome = paintMat(0xc9ced4, { rust: 0.12, rough: 0.28, metal: 0.95, vary: 0.1 });
  M.galv = galvMat();
  M.grate = grateMat();
  M.dark = paintMat(0x1b1c20, { rust: 0.3, rough: 0.7, metal: 0.3 });
  M.rubber = paintMat(0x141416, { rust: 0, rough: 0.9, metal: 0.0, vary: 0.2 });
  M.yellow = paintMat(0xd6a51c, { rust: 0.45, rough: 0.55, metal: 0.1 });
  M.red = paintMat(0xb5322a, { rust: 0.4, rough: 0.5, metal: 0.15 });
  M.blue = paintMat(0x2f66a8, { rust: 0.4, rough: 0.5, metal: 0.15 });
  M.green = paintMat(0x3c6a4a, { rust: 0.45, rough: 0.5, metal: 0.15 });
  M.orange = paintMat(0xe0661a, { rust: 0.1, rough: 0.6, metal: 0.0 });
  M.white = paintMat(0xe7e8e6, { rust: 0.25, rough: 0.5, metal: 0.0, streak: 0.5 });
  M.paper = paintMat(0xe9ecef, { rust: 0, rough: 0.8, metal: 0.0, vary: 0.08 });
  M.burlap = paintMat(0x9a8a66, { rust: 0, rough: 0.95, metal: 0.0, vary: 0.4 });
  M.conc = concreteMat({ clean: true });
  M.glass = glassMat(uN);
  M.wood = woodMat({ hex: 0xa9773f, dark: 0x6e4a28, plank: 0.23, stain: 0.75, worn: 0.8, horiz: true });           // 作業台の天板・幕板・棚
  M.woodH = woodMat({ hex: 0x7d5630, dark: 0x4f3620, plank: 0.3, worn: 0.5, horiz: true, seed: 2.0 });              // 横に渡した材（枠の上下・受け棚）
  M.woodD = woodMat({ hex: 0x7d5630, dark: 0x4f3620, plank: 0.3, worn: 0.5 });                         // 脚・枠
  M.crate = woodMat({ hex: 0xb58a55, dark: 0x7d5a34, plank: 0.125, seed: 3.0, worn: 0.7 });            // 木箱の板
  M.crateD = woodMat({ hex: 0x8a6238, dark: 0x5a3f24, plank: 0.5, seed: 5.0, worn: 0.5 });             // 木箱の桟
  M.pallet = woodMat({ hex: 0x9a8a70, dark: 0x6b5d49, plank: 0.5, seed: 9.0, gray: 0.7, worn: 0.4 });  // 日に焼けたパレット
  M.panel = panelMat();
  M.pole = woodMat({ hex: 0x5a4838, dark: 0x33281f, plank: 9.0, gray: 0.5, worn: 0.3, seed: 13.0 });      // 電柱（防腐剤で黒ずんだ丸太）
  const ct = cardTextures();
  M.cardTop = cardMat(ct.top); M.cardA = cardMat(ct.sideA); M.cardB = cardMat(ct.sideB);
  M.cardPlain = paintMat(0xa8845a, { rust: 0, rough: 0.9, metal: 0.0, vary: 0.2 });
  M.drumBlue = drumMat(0x2f6fb5); M.drumRed = drumMat(0xc9432f); M.drumGreen = drumMat(0x3f6b3f); M.drumBlack = drumMat(0x26282c);
  M.lamp = new THREE.MeshBasicNodeMaterial(); M.lamp.colorNode = vec3(0.16, 0.15, 0.13).add(vec3(3.0, 2.4, 1.5).mul(uN));          // 電球
  M.inner = new THREE.MeshBasicNodeMaterial(); M.inner.colorNode = vec3(0.012, 0.013, 0.016).add(vec3(1.15, 0.78, 0.38).mul(uN).mul(P.y.mul(0.06).add(0.5)));   // 扉のすき間から見える中
  M.warn = new THREE.MeshBasicNodeMaterial(); M.warn.colorNode = vec3(0.9, 0.06, 0.04).mul(uN.mul(1.9).add(0.35));
  return M;
}

// =====================================================================
// 形
// =====================================================================
/** 首の曲がった外灯（壁から出て下を照らす）。+z が壁の外 */
function gooseneck(B, x, y, z, ry = 0) {
  B.at(x, y, z, ry);
  pipeRun(B, 'dark:nc', [[0, 0, 0], [0, 0.28, 0.2], [0, 0.3, 0.52], [0, 0.22, 0.62]], 0.022);
  B.tube('dark', [0, 0.1, 0.62], [0, 0.24, 0.62], 0.21, 14, 0.04);
  B.tube('lamp:nc', [0, 0.095, 0.62], [0, 0.1, 0.62], 0.13, 12);
  B.box('dark:nc', 0.12, 0.12, 0.03, 0, 0, 0.015);
  B.home();
}
/** パレット（桁 3 本・上の板 5 枚・下の板 3 枚） */
function pallet(B, x, y, z, ry = 0) {
  B.at(x, y, z, ry);
  for (const zz of [-0.45, 0, 0.45]) B.box('pallet', 1.2, 0.09, 0.09, 0, 0.067, zz);
  for (let i = 0; i < 5; i++) B.box('pallet', 0.14, 0.022, 1.0, -0.53 + i * 0.265, 0.123, 0, 0, 0, 0);
  for (const xx of [-0.53, 0, 0.53]) B.box('pallet', 0.14, 0.022, 1.0, xx, 0.011, 0);
  B.home();
}
/** 板張りの木箱（一辺 s）。原点は箱の中心 */
function plankCrate(B, s, x, y, z, ry) {
  B.at(x, y, z, ry);
  const h = s / 2, t = 0.07;
  B.box('crate', s - 0.04, s - 0.04, s - 0.04, 0, 0, 0);
  for (const sx of [1, -1]) for (const sz of [1, -1]) B.box('crateD', t, s, t, sx * (h - t / 2), 0, sz * (h - t / 2));
  for (const sy of [1, -1]) for (const s2 of [1, -1]) {
    B.box('crateD', s - 2 * t, t, t * 0.6, 0, sy * (h - t / 2), s2 * (h - t * 0.3));
    B.box('crateD', t * 0.6, t, s - 2 * t, s2 * (h - t * 0.3), sy * (h - t / 2), 0);
  }
  const d = h - t;
  B.beam('crateD', [-d, -d, h - 0.008], [d, d, h - 0.008], t, 0.03); B.beam('crateD', [-d, d, -h + 0.008], [d, -d, -h + 0.008], t, 0.03);
  B.beam('crateD', [h - 0.008, -d, -d], [h - 0.008, d, d], 0.03, t); B.beam('crateD', [-h + 0.008, d, -d], [-h + 0.008, -d, d], 0.03, t);
  for (const s2 of [1, -1]) B.box('crateD', s - 2 * t, t * 0.6, t, 0, h - t * 0.3, s2 * (h * 0.38));       // ふたの桟
  B.home();
}
/** 型抜きの文字（木箱に吹きつけた表記）。アルファ抜きの板 */
function stencil(text, w, h, colorHex = '#1b1612', scale = 5) {
  const cw = 256, ch = Math.round((256 * h) / w);
  const tex = canvasTex(cw, ch, (ctx) => {
    ctx.clearRect(0, 0, cw, ch);
    const lines = text.split('\n');
    lines.forEach((ln, i) => pixText(ctx, ln, cw / 2, (ch / (lines.length + 1)) * (i + 1) - scale * 3.5, scale, colorHex, { align: 'center' }));
  });
  const m = new THREE.MeshStandardNodeMaterial({ map: tex, roughness: 0.85 });
  m.alphaTest = 0.4; m.transparent = false;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  mesh.receiveShadow = true;
  return mesh;
}

export class Workshop {
  /** bp: 設計図のテクスチャ（{goal, claude, ...}） */
  constructor(HI, bp) {
    const uN = (this.uN = uniform(0));
    const M = (this.M = makeMats(uN));
    this.glows = [];
    this.work = new THREE.Group();
    this._board(M, bp); this._bench(M); this._crates(M); this._cones();
    this._testpad(M);
    this.site = new THREE.Group();
    this._hangar(M); this._waterTower(M); this._dish(M); this._poles(M);
    this._weeds(HI);
  }

  // ---- 設計図の掲示板（板 3.9×2.66・中心の高さ 2.05・図面 3.66×2.44）
  _board(M, bp) {
    const board = (this.board = new THREE.Group()); board.position.set(0, 0, -2.7);
    const B = new Bag();
    B.box('panel', 3.9, 2.66, 0.06, 0, 2.05, 0.02);
    // 木の枠（図面のまわりに 10 cm）
    for (const s of [1, -1]) { B.box('woodH', 3.9, 0.1, 0.085, 0, 2.05 + s * 1.28, 0.0425, 0, 0, 0); B.box('woodF', 0.1, 2.46, 0.085, s * 1.9, 2.05, 0.0425); }
    // 脚・後ろの支え・足・筋かい
    for (const s of [1, -1]) {
      B.box('woodF', 0.12, 3.5, 0.12, s * 1.75, 1.75, -0.1);
      B.beam('woodF', [s * 1.75, 3.0, -0.14], [s * 1.75, 0.05, -1.45], 0.1);
      B.box('woodF', 0.12, 0.1, 1.75, s * 1.75, 0.05, -0.68);
      B.beam('woodF', [s * 1.75, 1.2, -0.16], [s * 1.75, 0.1, -0.85], 0.06, 0.09);
      // 砂袋（風で倒れないように）
      for (const [zz, ry] of [[-0.4, 0.2], [-1.0, -0.3]]) { const g = new THREE.SphereGeometry(0.2, 12, 8); g.scale(1.25, 0.42, 0.85); g.rotateY(ry); g.translate(s * 1.75, 0.18, zz); B.geo('burlap', g); }
    }
    B.beam('woodF', [-1.75, 0.45, -0.17], [1.75, 2.9, -0.17], 0.09, 0.03); B.beam('woodF', [1.75, 0.45, -0.19], [-1.75, 2.9, -0.19], 0.09, 0.03);
    // 受け棚と、チョーク・ペン・黒板消し
    B.box('woodH', 3.9, 0.1, 0.22, 0, 0.7, 0.08);
    B.box('woodH', 3.9, 0.05, 0.03, 0, 0.775, 0.175);
    for (const [x, key] of [[-1.3, 'paper'], [-1.22, 'paper'], [-0.9, 'blue'], [-0.82, 'red']]) B.tube(key + ':nc', [x, 0.765, 0.06], [x + 0.02, 0.765, 0.15], 0.012, 6);
    B.box('dark:nc', 0.16, 0.05, 0.07, 1.2, 0.775, 0.09);
    B.tube('paper:nc', [0.2, 0.79, 0.09], [0.95, 0.79, 0.09], 0.04, 10); B.tube('blue:nc', [0.2, 0.79, 0.09], [0.21, 0.79, 0.09], 0.041, 10);
    // 上のふちの目玉クリップ
    for (const x of [-1.2, 1.2]) { B.box('dark:nc', 0.13, 0.07, 0.05, x, 3.3, 0.1); B.tube('chrome:nc', [x - 0.04, 3.34, 0.1], [x - 0.04, 3.4, 0.09], 0.006, 5); B.tube('chrome:nc', [x + 0.04, 3.34, 0.1], [x + 0.04, 3.4, 0.09], 0.006, 5); }
    B.build({ ...M, woodF: M.woodD }, board);
    // 図面（紙）：下の角が少し反っている。上と横は画びょうで留める
    const pg = new THREE.PlaneGeometry(3.66, 2.44, 24, 16), pp = pg.attributes.position;
    for (let i = 0; i < pp.count; i++) {
      const sx = pp.getX(i) / 1.83, sy = pp.getY(i) / 1.22;
      const c1 = Math.max(0, (Math.abs(sx) - 0.8) / 0.2) * Math.max(0, (-sy - 0.55) / 0.45);
      pp.setZ(i, (sx < 0 ? 0.13 : 0.075) * c1 * c1 + 0.005 * Math.sin(sx * 5 + 1) * Math.cos(sy * 3.5) + 0.005);
    }
    pg.computeVertexNormals();
    this.bpPlanes = {};
    for (const k of Object.keys(bp)) {
      const pm = new THREE.MeshStandardNodeMaterial({ map: bp[k], roughness: 0.82 });
      pm.normalNode = bumpNormal(nz(uv().mul(vec2(2.2, 1.5))).r.mul(0.003).add(nz(uv().mul(9.0)).b.mul(0.0004)), 1.0);
      const pl = new THREE.Mesh(pg, pm);
      pl.position.set(0, 2.05, 0.052); pl.receiveShadow = true; pl.castShadow = true; pl.visible = false;
      board.add(pl); this.bpPlanes[k] = pl;
    }
    const Bp = new Bag();
    for (const [x, y, key] of [[-1.76, 3.2, 'red'], [1.76, 3.2, 'yellow'], [-0.6, 3.21, 'blue'], [0.62, 3.21, 'red'], [-1.77, 2.1, 'green'], [1.77, 2.0, 'blue']]) {
      Bp.tube('chrome:nc', [x, y, 0.05], [x, y, 0.075], 0.006, 5);
      Bp.sph(key + ':nc', 0.028, x, y, 0.085, 10, 8);
    }
    this.pins = Bp.build(M, new THREE.Group()); this.pins.visible = false;
    board.add(this.pins);
    this.work.add(board);
  }

  // ---- 作業台（天板 2.7×1.15・高さ 1.04）と工具
  _bench(M) {
    const bench = new THREE.Group(); bench.position.set(-4.6, 0, -1.0); bench.rotation.y = 0.35;
    const B = new Bag(), T = 1.04;
    B.box('wood', 2.7, 0.1, 1.15, 0, 0.99, 0);
    for (const s of [1, -1]) { B.box('woodH', 2.48, 0.14, 0.04, 0, 0.87, s * 0.5); B.box('woodH', 0.04, 0.14, 0.96, s * 1.26, 0.87, 0); }
    for (const [x, z] of [[-1.2, -0.45], [1.2, -0.45], [-1.2, 0.45], [1.2, 0.45]]) B.box('woodD', 0.11, 0.94, 0.11, x, 0.47, z);
    B.box('wood', 2.5, 0.05, 0.95, 0, 0.3, 0);
    B.beam('woodD', [-1.2, 0.35, -0.47], [0, 0.9, -0.47], 0.07, 0.03); B.beam('woodD', [1.2, 0.35, -0.47], [0, 0.9, -0.47], 0.07, 0.03);
    // 万力（手前の左の角）
    B.box('steel', 0.2, 0.13, 0.16, -1.12, T + 0.065, 0.5); B.box('steel', 0.2, 0.2, 0.05, -1.12, T + 0.1, 0.61); B.box('steel', 0.2, 0.2, 0.05, -1.12, T + 0.1, 0.71);
    B.tube('chrome:nc', [-1.12, T + 0.07, 0.58], [-1.12, T + 0.07, 0.86], 0.014, 8); B.tube('chrome:nc', [-1.22, T + 0.07, 0.85], [-1.02, T + 0.07, 0.85], 0.008, 6);
    // 工具箱（赤）
    B.box('red', 0.62, 0.22, 0.3, -0.7, T + 0.11, 0.1); B.box('red', 0.64, 0.07, 0.32, -0.7, T + 0.255, 0.1);
    B.box('chrome:nc', 0.05, 0.05, 0.012, -0.9, T + 0.2, 0.262); B.box('chrome:nc', 0.05, 0.05, 0.012, -0.5, T + 0.2, 0.262);
    pipeRun(B, 'chrome:nc', [[-0.86, T + 0.29, 0.1], [-0.86, T + 0.34, 0.1], [-0.54, T + 0.34, 0.1], [-0.54, T + 0.29, 0.1]], 0.012);
    // スパナ 2 本・金づち・ドライバー 2 本・巻き尺
    const wrench = (x, z, ry, L) => {
      B.at(x, T + 0.008, z, ry);
      B.box('chrome:nc', L, 0.012, 0.03, 0, 0, 0);
      B.box('chrome:nc', 0.035, 0.012, 0.07, L / 2 + 0.01, 0, 0); B.box('chrome:nc', 0.05, 0.012, 0.022, L / 2 + 0.04, 0, 0.026); B.box('chrome:nc', 0.05, 0.012, 0.022, L / 2 + 0.04, 0, -0.026);
      const t = new THREE.TorusGeometry(0.03, 0.011, 6, 14); t.rotateX(Math.PI / 2); t.translate(-L / 2 - 0.025, 0, 0); B.geo('chrome:nc', t);
      B.home();
    };
    wrench(0.2, 0.2, 0.5, 0.4); wrench(0.6, -0.15, -0.7, 0.32);
    B.at(0.1, T, -0.3, 0.9); B.tube('woodD:nc', [-0.17, 0.02, 0], [0.14, 0.02, 0], 0.016, 8); B.box('steel:nc', 0.045, 0.04, 0.12, 0.15, 0.02, 0); B.home();
    B.at(0.55, T, 0.38, -0.25); B.tube('yellow:nc', [-0.1, 0.017, 0], [0, 0.017, 0], 0.017, 8); B.tube('chrome:nc', [0, 0.017, 0], [0.14, 0.017, 0], 0.005, 6); B.home();
    B.at(0.42, T, 0.44, 0.12); B.tube('red:nc', [-0.09, 0.015, 0], [0, 0.015, 0], 0.015, 8); B.tube('chrome:nc', [0, 0.015, 0], [0.11, 0.015, 0], 0.004, 6); B.home();
    B.box('yellow:nc', 0.075, 0.07, 0.04, -0.2, T + 0.035, 0.4); B.box('chrome:nc', 0.02, 0.012, 0.045, -0.155, T + 0.012, 0.4);
    // ペンキ缶（青）と針金の取っ手、スプレー缶（黄）
    B.tube('blue', [0.95, T, 0.25], [0.95, T + 0.22, 0.25], 0.11, 18); B.tube('chrome:nc', [0.95, T + 0.22, 0.25], [0.95, T + 0.228, 0.25], 0.115, 18);
    { const t = new THREE.TorusGeometry(0.115, 0.005, 5, 18, Math.PI); t.rotateZ(Math.PI); t.rotateX(1.1); t.translate(0.95, T + 0.2, 0.25); B.geo('chrome:nc', t); }
    B.tube('yellow', [1.05, T, -0.2], [1.05, T + 0.24, -0.2], 0.085, 16); B.tube('yellow', [1.05, T + 0.24, -0.2], [1.05, T + 0.28, -0.2], 0.085, 16, 0.04); B.tube('red:nc', [1.05, T + 0.28, -0.2], [1.05, T + 0.33, -0.2], 0.035, 10);
    // 丸めた図面・クリップボード・ヘルメット
    B.at(-0.1, T, -0.42, 0.06); B.tube('paper:nc', [-0.45, 0.04, 0], [0.45, 0.04, 0], 0.04, 10); B.tube('paper:nc', [-0.4, 0.11, 0.03], [0.5, 0.11, 0.03], 0.035, 10); B.tube('blue:nc', [-0.455, 0.04, 0], [-0.45, 0.04, 0], 0.041, 10); B.home();
    B.at(-0.25, T, 0.05, -0.2); B.box('woodD:nc', 0.23, 0.012, 0.32, 0, 0.006, 0); B.box('paper:nc', 0.21, 0.004, 0.28, 0, 0.014, -0.01); B.box('chrome:nc', 0.1, 0.015, 0.025, 0, 0.02, 0.135); B.home();
    { const g = new THREE.SphereGeometry(0.15, 16, 10, 0, TWO_PI, 0, Math.PI / 2); g.scale(1, 0.85, 1.15); g.translate(-1.0, T + 0.01, -0.3); B.geo('yellow', g); B.tube('yellow', [-1.0, T, -0.3], [-1.0, T + 0.02, -0.3], 0.19, 16); }
    // 棚の物：段ボール・ペンキ缶・延長コード・プラスチックの箱
    B.box('card0', 0.5, 0.3, 0.4, -0.7, 0.475, -0.05);
    for (const [x, z, key] of [[0.2, 0.22, 'white'], [0.42, 0.2, 'white'], [0.3, -0.05, 'red']]) { B.tube(key, [x, 0.325, z], [x, 0.51, z], 0.09, 14); B.tube('chrome:nc', [x, 0.51, z], [x, 0.516, z], 0.094, 14); }
    { const t = new THREE.TorusGeometry(0.15, 0.03, 6, 20); t.rotateX(Math.PI / 2); t.translate(0.85, 0.36, 0.1); B.geo('orange', t); const t2 = new THREE.TorusGeometry(0.14, 0.03, 6, 20); t2.rotateX(Math.PI / 2); t2.translate(0.86, 0.415, 0.11); B.geo('orange', t2); }
    B.box('blue', 0.42, 0.24, 0.3, -0.05, 0.445, -0.25);
    // 床に置いたバケツ
    B.tube('galv', [1.55, 0, 0.35], [1.55, 0.3, 0.35], 0.13, 14, 0.16);
    B.build({ ...M, card0: M.cardPlain }, bench);
    this.work.add(bench);
  }

  // ---- 木箱・段ボール・ドラム缶（位置と大きさは元のまま）
  _crates(M) {
    const crates = new THREE.Group(); crates.position.set(4.8, 0, -1.6);
    const B = new Bag();
    plankCrate(B, 1.0, 0, 0.5, 0, 0.2); plankCrate(B, 0.9, 1.05, 0.45, 0.2, -0.3); plankCrate(B, 0.8, 0.35, 1.4, 0.05, 0.5);
    // 手押し車（箱の後ろに立てかけてある）
    B.at(1.9, 0, -0.75, -0.5);
    for (const s of [1, -1]) { B.tube('red:nc', [s * 0.2, 0.12, 0], [s * 0.2, 1.2, -0.28], 0.018, 8); B.tube('rubber', [s * 0.24, 0.12, -0.05], [s * 0.3, 0.12, -0.05], 0.12, 14); }
    B.box('red:nc', 0.44, 0.02, 0.26, 0, 0.03, 0.12); B.tube('red:nc', [-0.2, 0.5, -0.1], [0.2, 0.5, -0.1], 0.014, 6); B.tube('red:nc', [-0.2, 0.85, -0.19], [0.2, 0.85, -0.19], 0.014, 6); B.tube('rubber:nc', [-0.2, 1.2, -0.28], [0.2, 1.2, -0.28], 0.022, 8);
    B.home();
    B.build(M, crates);
    // 型抜きの表記
    const put = (m, x, y, z, ry, dx, dy, dz) => { m.position.set(x, y, z); m.rotation.y = ry; m.translateX(dx); m.translateY(dy); m.translateZ(dz); crates.add(m); };
    put(stencil('AI SPACE LAB\nNO. 7', 0.46, 0.26, '#1b1612', 3), 0, 0.5, 0, 0.2, -0.16, 0.2, 0.483);
    put(stencil('FRAGILE', 0.4, 0.13, '#8f2018', 4), 1.05, 0.45, 0.2, -0.3, 0.16, -0.2, 0.433);
    put(stencil('THIS SIDE\nUP', 0.3, 0.2, '#1b1612', 3), 0.35, 1.4, 0.05, 0.5, -0.14, 0.17, 0.383);
    // 段ボール箱（面ごとに別の絵）
    const cb = (w, h, d, x, y, z, ry) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [M.cardA, M.cardB, M.cardTop, M.cardTop, M.cardB, M.cardA]);
      mesh.position.set(x, y, z); mesh.rotation.y = ry; mesh.castShadow = true; mesh.receiveShadow = true;
      crates.add(mesh);
    };
    cb(0.6, 0.42, 0.46, 2.05, 0.21, 0.1, 0.35); cb(0.4, 0.3, 0.34, 2.0, 0.57, 0.08, -0.2);
    // ドラム缶
    const dg = drumGeo();
    for (const [x, z, key, ry] of [[-1.2, 0.5, 'drumBlue', 0.4], [-1.25, -0.45, 'drumRed', 2.1]]) {
      const d = new THREE.Mesh(dg, M[key]); d.position.set(x, 0, z); d.rotation.y = ry; d.castShadow = true; d.receiveShadow = true; crates.add(d);
      const Bd = new Bag(); Bd.tube('chrome:nc', [0.2, 0.975, 0.1], [0.2, 0.992, 0.1], 0.04, 10); Bd.tube('chrome:nc', [-0.22, 0.975, -0.05], [-0.22, 0.99, -0.05], 0.022, 8);
      const caps = Bd.build(M, new THREE.Group()); caps.position.copy(d.position); caps.rotation.y = ry; crates.add(caps);
    }
    this.work.add(crates);
  }

  // ---- カラーコーン（4 個。カットが位置を決める）
  _cones() {
    const geo = coneGeo(), m = coneMat();
    this.cones = [];
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      const c = new THREE.Mesh(geo, m); c.castShadow = true; c.receiveShadow = true; c.rotation.y = i * 1.7;
      g.add(c); g.visible = false; this.work.add(g); this.cones.push(g);
    }
  }

  // ---- 試験場の円い台（上面の半径 3.7・高さ 0.3）
  _testpad(M) {
    const tp = (this.testpad = new THREE.Group()); tp.position.set(0, 0, -15);
    this.scorchU = uniform(0);
    const disc = new THREE.Mesh(new THREE.LatheGeometry([[3.9, 0], [3.7, 0.27], [3.64, 0.3], [0, 0.3]].map(([r, y]) => new THREE.Vector2(r, y)), 72), testPadMat(this.scorchU));
    disc.castShadow = true; disc.receiveShadow = true;
    tp.add(disc);
    const B = new Bag();
    // アンカーボルト（座金つき）12 本、係留の輪 4 個、電源の箱と配線ぶた
    for (let i = 0; i < 12; i++) {
      const a = (i + 0.5) * (TWO_PI / 12), x = Math.cos(a) * 3.45, z = Math.sin(a) * 3.45;
      B.box('steel:nc', 0.16, 0.016, 0.16, x, 0.308, z, 0, -a, 0);
      B.tube('galv:nc', [x, 0.31, z], [x, 0.36, z], 0.03, 6);
      B.tube('galv:nc', [x, 0.36, z], [x, 0.4, z], 0.014, 6);
    }
    for (let i = 0; i < 4; i++) {
      const a = i * (Math.PI / 2) + 0.4, x = Math.cos(a) * 2.75, z = Math.sin(a) * 2.75;
      const t = new THREE.TorusGeometry(0.07, 0.015, 6, 14); t.rotateY(-a); t.translate(x, 0.34, z); B.geo('galv:nc', t);
      B.box('steel:nc', 0.2, 0.014, 0.12, x, 0.307, z, 0, -a, 0);
    }
    B.at(-5.3, 0, -4.7, 0.75);
    B.box('conc', 0.9, 0.12, 0.7, 0, 0.06, 0); B.box('steel', 0.5, 0.7, 0.3, 0, 0.47, 0); B.box('dark:nc', 0.3, 0.2, 0.31, 0, 0.6, 0); B.box('yellow:nc', 0.2, 0.1, 0.305, 0, 0.3, 0.004);
    pipeRun(B, 'dark:nc', [[0.1, 0.14, 0.15], [0.5, 0.025, 0.9], [1.3, 0.025, 1.5], [1.7, 0.025, 2.3]], 0.02);
    B.home();
    B.build(M, tp);
  }

  // ---- 格納庫「AI SPACE LAB」（幅 24・壁 8・奥行き 16・かまぼこ屋根）
  _hangar(M) {
    const hg = (this.hangar = new THREE.Group()); hg.position.set(HANGAR.x, 0, HANGAR.z); hg.rotation.y = HANGAR.ry;
    const uN = this.uN;
    const B = new Bag();
    const hw = 12, hd = 8, H = 8, F = 0.3, RY = 5.4, DZ = hd + 0.32;     // DZ：引き戸の面
    B.box('conc', 24.5, F, 16.5, 0, F / 2, 0);
    // 外壁
    B.quad('wall', [-hw, F, hd], [-5.1, F, hd], [-5.1, H, hd], [-hw, H, hd], [0, 0, 1]);
    B.quad('wall', [5.1, F, hd], [hw, F, hd], [hw, H, hd], [5.1, H, hd], [0, 0, 1]);
    B.quad('wall', [-5.1, 6.55, hd], [5.1, 6.55, hd], [5.1, H, hd], [-5.1, H, hd], [0, 0, 1]);
    B.quad('wall', [-hw, F, -hd], [hw, F, -hd], [hw, H, -hd], [-hw, H, -hd], [0, 0, -1]);
    for (const s of [1, -1]) B.quad('wall', [s * hw, F, -hd], [s * hw, F, hd], [s * hw, H, hd], [s * hw, H, -hd], [s, 0, 0]);
    // 妻壁（屋根の下の半円）
    {
      const sh = new THREE.Shape(); sh.moveTo(-hw, 0);
      for (let i = 0; i <= 32; i++) { const th = Math.PI * (1 - i / 32); sh.lineTo(hw * Math.cos(th), RY * Math.sin(th)); }
      sh.closePath();
      const gf = new THREE.ShapeGeometry(sh, 1); gf.translate(0, H, hd); B.geo('wall', gf);
      const gb = new THREE.ShapeGeometry(sh, 1); gb.rotateY(Math.PI); gb.translate(0, H, -hd); B.geo('wall', gb);
    }
    // 屋根（波板のかまぼこ形・軒とけらばを少し出す）
    {
      const N = 48, ax = hw + 0.28, by = RY + 0.12, z0 = -hd - 0.4, z1 = hd + 0.4, pos = [], nor = [], uvs = [], idx = [];
      for (let i = 0; i <= N; i++) {
        const th = (Math.PI * i) / N, c = Math.cos(th), s = Math.sin(th);
        let nx = c / ax, ny = s / by; const nl = Math.hypot(nx, ny); nx /= nl; ny /= nl;
        for (const z of [z0, z1]) { pos.push(ax * c, H - 0.06 + by * s, z); nor.push(nx, ny, 0); uvs.push(i / N, z === z0 ? 0 : 1); }
        if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(idx);
      B.geo('roof', g);
    }
    // 軒の見切り・角の見切り・雨どいと縦どい
    for (const s of [1, -1]) {
      B.box('trim', 0.1, 0.22, 16.9, s * (hw + 0.2), H - 0.1, 0);
      B.tube('galv', [s * (hw + 0.36), H - 0.16, -hd - 0.4], [s * (hw + 0.36), H - 0.16, hd + 0.4], 0.1, 10);
      for (let z = -hd; z <= hd; z += 1.6) B.box('galv:nc', 0.2, 0.03, 0.04, s * (hw + 0.26), H - 0.06, z);
      for (const sz of [1, -1]) {
        B.box('trim', 0.14, H - F, 0.14, s * (hw + 0.02), (H + F) / 2, sz * (hd + 0.02));
        const z = sz * (hd - 0.3);
        pipeRun(B, 'galv:nc', [[s * (hw + 0.36), H - 0.2, z], [s * (hw + 0.36), H - 0.42, z], [s * (hw + 0.1), H - 0.75, z], [s * (hw + 0.1), 0.62, z], [s * (hw + 0.36), 0.36, z]], 0.055);
        for (const y of [1.6, 4.0, 6.4]) B.box('galv:nc', 0.05, 0.03, 0.16, s * (hw + 0.07), y, z);
      }
    }
    // 棟の換気筒（回転式）3 基
    for (const z of [-5, 0, 5]) {
      B.tube('galv', [0, H + RY - 0.02, z], [0, H + RY + 0.42, z], 0.28, 14);
      const sg = new THREE.SphereGeometry(0.38, 14, 10); sg.scale(1, 0.82, 1); sg.translate(0, H + RY + 0.7, z); B.geo('galv', sg);
      for (let i = 0; i < 12; i++) { const a = (i / 12) * TWO_PI; B.box('galv:nc', 0.012, 0.5, 0.2, Math.cos(a) * 0.36, H + RY + 0.7, z + Math.sin(a) * 0.36, 0, -a + 0.5, 0); }
    }
    // 引き戸（2 枚・吊りレール・下の案内・少し開いている）
    B.box('galv', 20.6, 0.14, 0.12, 0, 6.66, DZ); B.box('trim', 20.7, 0.05, 0.34, 0, 6.78, DZ - 0.06);
    for (let x = -10; x <= 10.01; x += 1.66) B.box('galv:nc', 0.06, 0.22, 0.3, x, 6.66, DZ - 0.17);
    B.box('galv:nc', 20.6, 0.035, 0.1, 0, 0.018, DZ);
    B.box('frame', 10.9, 0.3, 0.2, 0, 6.5, hd + 0.08);
    for (const s of [1, -1]) {
      const xa = s * 0.32, xb = s * 5.42, xc = (xa + xb) / 2, wl = Math.abs(xb - xa);
      B.quad('door', [xa, 0.06, DZ + 0.03], [xb, 0.06, DZ + 0.03], [xb, 6.56, DZ + 0.03], [xa, 6.56, DZ + 0.03], [0, 0, 1]);
      B.quad('dark', [xa, 0.06, DZ - 0.03], [xb, 0.06, DZ - 0.03], [xb, 6.56, DZ - 0.03], [xa, 6.56, DZ - 0.03], [0, 0, -1]);
      for (const y of [0.12, 2.25, 4.4, 6.5]) B.box('frame', wl, 0.12, 0.07, xc, y, DZ + 0.06);
      for (const x of [xa + s * 0.06, xb - s * 0.06]) B.box('frame', 0.12, 6.5, 0.07, x, 3.31, DZ + 0.06);
      B.beam('frame', [xa + s * 0.1, 0.2, DZ + 0.06], [xb - s * 0.1, 2.2, DZ + 0.06], 0.1, 0.05); B.beam('frame', [xb - s * 0.1, 2.3, DZ + 0.06], [xa + s * 0.1, 4.35, DZ + 0.06], 0.1, 0.05);
      for (const x of [xa + s * 0.9, xb - s * 0.9]) { B.tube('steel:nc', [x, 6.66, DZ - 0.05], [x, 6.66, DZ + 0.09], 0.09, 12); B.box('steel:nc', 0.08, 0.22, 0.03, x, 6.55, DZ + 0.1); }
      B.tube('galv:nc', [s * 0.5, 0.95, DZ + 0.16], [s * 0.5, 1.45, DZ + 0.16], 0.02, 8);
      B.box('galv:nc', 0.04, 0.04, 0.1, s * 0.5, 0.97, DZ + 0.11); B.box('galv:nc', 0.04, 0.04, 0.1, s * 0.5, 1.43, DZ + 0.11);
      // 車止め（黄と黒）
      B.tube('yellow', [s * 5.8, 0, DZ + 0.7], [s * 5.8, 1.0, DZ + 0.7], 0.09, 12); B.tube('dark:nc', [s * 5.8, 0.42, DZ + 0.7], [s * 5.8, 0.6, DZ + 0.7], 0.092, 12); B.sph('yellow', 0.09, s * 5.8, 1.0, DZ + 0.7, 10, 8);
    }
    B.quad('inner', [-0.9, 0.02, hd + 0.18], [0.9, 0.02, hd + 0.18], [0.9, 6.5, hd + 0.18], [-0.9, 6.5, hd + 0.18], [0, 0, 1]);
    // 通用口（右の扉の中）
    B.box('trim', 1.0, 2.1, 0.04, 3.6, 1.13, DZ + 0.07); B.box('doorP', 0.88, 1.98, 0.05, 3.6, 1.13, DZ + 0.08);
    B.quad('glass', [3.4, 1.35, DZ + 0.108], [3.8, 1.35, DZ + 0.108], [3.8, 1.85, DZ + 0.108], [3.4, 1.85, DZ + 0.108], [0, 0, 1]);
    B.tube('chrome:nc', [3.92, 1.1, DZ + 0.11], [3.92, 1.1, DZ + 0.17], 0.018, 8);
    // 窓（枠・ガラス・桟・水切り）
    const win = (x, y, z, ry, w = 1.5, h = 1.0) => {
      B.at(x, y, z, ry);
      B.box('trim', w + 0.14, 0.07, 0.09, 0, h / 2 + 0.035, 0.03); B.box('trim', w + 0.14, 0.07, 0.09, 0, -h / 2 - 0.035, 0.03);
      for (const s of [1, -1]) B.box('trim', 0.07, h, 0.09, s * (w / 2 + 0.035), 0, 0.03);
      B.quad('glass', [-w / 2, -h / 2, 0.025], [w / 2, -h / 2, 0.025], [w / 2, h / 2, 0.025], [-w / 2, h / 2, 0.025], [0, 0, 1]);
      B.box('trim', 0.035, h, 0.04, 0, 0, 0.045); B.box('trim', w, 0.035, 0.04, 0, 0.12, 0.045);
      B.box('trim', w + 0.24, 0.045, 0.16, 0, -h / 2 - 0.09, 0.07);
      B.home();
    };
    for (const x of [-9.5, -7.1, 6.5, 8.9]) win(x, 5.2, hd, 0);
    for (const s of [1, -1]) for (const z of [-6, -3, 0, 3, 6]) win(s * hw, 5.2, z, s * Math.PI / 2);
    for (const x of [-7, 0, 7]) win(x, 5.2, -hd, Math.PI);
    // 妻の換気口と外灯
    { const t = new THREE.TorusGeometry(0.72, 0.06, 6, 24); t.translate(0, 11.35, hd + 0.03); B.geo('trim', t); }
    for (let i = 0; i < 7; i++) { const y = 10.85 + i * 0.17, w = 2 * Math.sqrt(Math.max(0.02, 0.66 * 0.66 - (y - 11.35) ** 2)); B.box('galv:nc', w, 0.03, 0.08, 0, y, hd + 0.05, 0.5, 0, 0); }
    B.quad('dark', [-0.68, 10.7, hd + 0.01], [0.68, 10.7, hd + 0.01], [0.68, 12.0, hd + 0.01], [-0.68, 12.0, hd + 0.01], [0, 0, 1]);
    for (const [x, y] of [[-6.2, 6.95], [6.2, 6.95], [-11.0, 6.95], [11.0, 6.95]]) gooseneck(B, x, y, hd);
    for (const x of [-3.1, 0, 3.1]) gooseneck(B, x, 8.62, hd);
    for (const s of [1, -1]) for (const z of [-4.5, 4.5]) gooseneck(B, s * hw, 6.95, z, s * Math.PI / 2);
    // 看板の枠
    B.box('frame', 9.3, 1.96, 0.1, 0, 7.5, hd + 0.06);
    for (const x of [-4.2, 4.2]) for (const y of [6.72, 8.28]) B.tube('chrome:nc', [x, y, hd + 0.1], [x, y, hd + 0.125], 0.03, 8);
    // 外まわりの物：パレット・ガスボンベ・配電盤・空調機・はしご
    for (let i = 0; i < 4; i++) pallet(B, 8.5 + (i % 2) * 0.05, i * 0.146, hd + 1.7, 0.12 * (i - 1.5));
    pallet(B, 10.2, 0, hd + 1.5, 1.2);
    for (const [i, key] of [[0, 'green'], [1, 'red'], [2, 'steel']]) {
      const x = 9.9 + i * 0.29, z = hd + 0.2;
      B.tube(key, [x, 0, z], [x, 1.3, z], 0.115, 14); B.sph(key, 0.115, x, 1.3, z, 12, 8); B.tube('chrome:nc', [x, 1.38, z], [x, 1.5, z], 0.03, 8); B.tube('dark:nc', [x, 1.44, z], [x, 1.58, z], 0.06, 10);
    }
    B.box('galv:nc', 1.0, 0.03, 0.02, 10.19, 0.95, hd + 0.33);
    B.box('steel', 0.5, 0.72, 0.16, 11.0, 1.7, hd + 0.08); B.box('dark:nc', 0.4, 0.5, 0.17, 11.0, 1.74, hd + 0.08);
    pipeRun(B, 'galv:nc', [[11.0, 2.06, hd + 0.05], [11.0, 6.3, hd + 0.05], [9.0, 6.3, hd + 0.05]], 0.022);
    B.at(hw, 0, 3.0, Math.PI / 2);
    B.box('conc', 1.4, 0.1, 0.9, 0, 0.05, 0.6); B.box('white', 1.1, 0.9, 0.5, 0, 0.55, 0.6); B.tube('dark:nc', [0, 0.6, 0.85], [0, 0.6, 0.856], 0.34, 20); B.box('galv:nc', 1.0, 0.02, 0.02, 0, 0.6, 0.86); B.box('galv:nc', 0.02, 0.7, 0.02, 0, 0.6, 0.86);
    pipeRun(B, 'galv:nc', [[0.4, 0.9, 0.35], [0.4, 3.0, 0.06]], 0.02);
    B.home();
    for (const s of [1, -1]) B.beam('galv:nc', [-8.5 + s * 0.2, 0, hd + 1.25], [-8.5 + s * 0.2, 5.3, hd + 0.12], 0.035, 0.05);
    for (let i = 1; i < 18; i++) { const f = i / 18; B.beam('galv:nc', [-8.7, 5.3 * f, hd + 1.25 - 1.13 * f], [-8.3, 5.3 * f, hd + 1.25 - 1.13 * f], 0.022); }
    B.build({ ...M, doorP: M.steel }, hg);
    // ドラム缶 3 本（左の角）
    const dg = drumGeo();
    for (const [x, z, key, ry] of [[-10.7, hd + 0.75, 'drumGreen', 0.3], [-11.55, hd + 0.8, 'drumBlack', 1.9], [-11.1, hd + 1.55, 'drumBlue', 4.0]]) { const d = new THREE.Mesh(dg, M[key]); d.position.set(x, 0, z); d.rotation.y = ry; d.castShadow = true; d.receiveShadow = true; hg.add(d); }
    // 看板（鉄板に黄色い文字。雨だれ入り）
    const signT = canvasTex(1024, 192, (ctx) => {
      ctx.fillStyle = '#1e2733'; ctx.fillRect(0, 0, 1024, 192);
      pixText(ctx, 'AI SPACE LAB', 512, 52, 14, '#ffd95a', { align: 'center' });
      const r = mulberry(11);
      for (let i = 0; i < 70; i++) { const x = r() * 1024, y = r() * 60, h = 30 + r() * 150; const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, `rgba(${r() < 0.4 ? '120,70,40' : '10,12,16'},${0.18 + r() * 0.22})`); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(x, y, 2 + r() * 5, h); }
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 6; ctx.strokeRect(3, 3, 1018, 186);
    });
    const sm = new THREE.MeshStandardNodeMaterial({ map: signT, roughness: 0.6, metalness: 0.2 });
    sm.emissiveNode = texture(signT, uv()).rgb.mul(vec3(1.0, 0.85, 0.6)).mul(uv().y.mul(0.9).add(0.25)).mul(uN).mul(1.3);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.7), sm); sign.position.set(0, 7.5, hd + 0.115); sign.receiveShadow = true;
    hg.add(sign);
    // 夜、扉のすき間と外灯から地面にこぼれる光（加算の板）
    const pool = (geo, x, z, ry, gain, shape) => {
      const m = new THREE.MeshBasicNodeMaterial();
      m.transparent = true; m.depthWrite = false; m.blending = THREE.AdditiveBlending; m.fog = false;
      m.colorNode = vec3(1.0, 0.74, 0.42);
      m.opacityNode = shape.mul(uN).mul(gain);
      const mesh = new THREE.Mesh(geo, m); mesh.rotation.x = -Math.PI / 2; mesh.rotation.z = ry; mesh.position.set(x, 0.035, z);
      mesh.layers.set(FX_LAYER); mesh.renderOrder = 2; mesh.castShadow = false; mesh.receiveShadow = false;
      hg.add(mesh); this.glows.push(mesh);
    };
    {
      // 扉のすき間：手前へ広がる台形
      const g = new THREE.BufferGeometry(), L = 13;
      g.setAttribute('position', new THREE.Float32BufferAttribute([-0.4, 0, 0, 0.4, 0, 0, 3.0, -L, 0, -3.0, -L, 0], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2)); g.setIndex([0, 2, 1, 0, 3, 2]); g.computeVertexNormals();
      const along = uv().y, across = uv().x.sub(0.5).abs().mul(2.0);
      pool(g, 0, DZ + 0.1, 0, 0.75, fall(0.0, 1.0, along).pow(1.6).mul(fall(0.25, 1.0, across)));
    }
    const rad = fall(0.0, 1.0, uv().sub(0.5).length().mul(2.0)).pow(1.5);
    for (const [x, y] of [[-6.2, 0], [6.2, 0], [-11.0, 0], [11.0, 0]]) pool(new THREE.CircleGeometry(3.4, 24), x, hd + 1.0, 0, 0.32, rad);
    for (const s of [1, -1]) for (const z of [-4.5, 4.5]) pool(new THREE.CircleGeometry(3.4, 24), s * (hw + 1.0), z, 0, 0.3, rad);
    // 吹き流し（風で揺れる）
    {
      const Bw = new Bag();
      Bw.tube('white', [-15.5, 0, hd + 3], [-15.5, 6.2, hd + 3], 0.05, 8, 0.035); Bw.box('conc', 0.5, 0.2, 0.5, -15.5, 0.1, hd + 3);
      { const t = new THREE.TorusGeometry(0.3, 0.012, 5, 16); t.rotateY(Math.PI / 2); t.translate(-15.45, 6.05, hd + 3); Bw.geo('galv:nc', t); }
      Bw.build(M, hg);
      const sg = new THREE.CylinderGeometry(0.11, 0.3, 2.2, 14, 10, true); sg.rotateZ(Math.PI / 2); sg.translate(1.1, 0, 0);
      const wm = new THREE.MeshStandardNodeMaterial(); wm.side = THREE.DoubleSide; wm.roughness = 0.8;
      const ax = P.x;
      wm.colorNode = mix(color(0xe8e6df), color(0xe35a18), step(0.5, fract(ax.div(0.88).add(0.02)))).mul(nz(vec2(ax, P.y).mul(0.7)).r.mul(0.2).add(0.86));
      const fl = sin(time.mul(5.0).sub(ax.mul(2.4))).mul(0.05).add(sin(time.mul(2.3).add(1.0)).mul(0.04)).mul(ax);
      wm.positionNode = vec3(P.x, P.y.add(fl).sub(ax.mul(ax).mul(0.035)), P.z.add(cos(time.mul(3.7).sub(ax.mul(1.9))).mul(0.045).mul(ax)));
      const sock = new THREE.Mesh(sg, wm); sock.position.set(-15.45, 6.05, hd + 3); sock.rotation.y = -0.6; sock.castShadow = true;
      hg.add(sock);
    }
    // 外灯の光のにじみ
    for (const [x, y] of [[-6.2, 7.05], [6.2, 7.05], [-11.0, 7.05], [11.0, 7.05], [0, 8.72]]) { const gs = glowSprite(0xffd9a0, 2.6, { gain: 0, pow: 2.4 }); gs.position.set(x, y, hd + 0.62); hg.add(gs); this.glows.push(gs); }
    this.site.add(hg);
  }

  // ---- 給水塔（タンクは半径 3.2・中心の高さ 13）
  _waterTower(M) {
    const wt = new THREE.Group(); wt.position.set(-58, 0, -12);
    const B = new Bag(), CY = 13, R = 3.2;
    const tg = new THREE.SphereGeometry(R, 48, 32); tg.translate(0, CY, 0);       // 素材は「塔の原点から見た位置」で模様を決める
    const tank = new THREE.Mesh(tg, tankMat(CY, R)); tank.castShadow = true; tank.receiveShadow = true;
    wt.add(tank);
    // 脚 6 本（外へ開く）・水平材 2 段・筋かいの鋼棒・基礎
    const legs = [];
    for (let i = 0; i < 6; i++) {
      const a = (i + 0.5) * (Math.PI / 3), top = [Math.cos(a) * 2.75, CY - 1.5, Math.sin(a) * 2.75], bot = [Math.cos(a) * 4.4, 0.4, Math.sin(a) * 4.4];
      legs.push({ top, bot, at: (y) => { const f = (y - bot[1]) / (top[1] - bot[1]); return [bot[0] + (top[0] - bot[0]) * f, y, bot[2] + (top[2] - bot[2]) * f]; } });
      B.tube('steel', bot, top, 0.17, 10, 0.14);
      B.box('conc', 0.9, 0.4, 0.9, bot[0], 0.2, bot[2], 0, -a, 0);
      B.box('steel', 0.5, 0.04, 0.5, bot[0], 0.42, bot[2], 0, -a, 0);
    }
    for (let i = 0; i < 6; i++) {
      const A = legs[i], C = legs[(i + 1) % 6];
      for (const y of [4.2, 8.0]) B.tube('steel', A.at(y), C.at(y), 0.07, 8);
      for (const [y0, y1] of [[0.6, 4.2], [4.2, 8.0], [8.0, 11.3]]) { B.tube('galv:nc', A.at(y0), C.at(y1), 0.025, 6); B.tube('galv:nc', C.at(y0), A.at(y1), 0.025, 6); }
    }
    // 立ち上がりの太い管（中央）と基礎
    B.tube('white', [0, 0.3, 0], [0, CY - R + 0.25, 0], 0.48, 18); B.tube('steel', [0, 0.3, 0], [0, 0.55, 0], 0.62, 18); B.box('conc', 1.8, 0.3, 1.8, 0, 0.15, 0);
    B.tube('steel:nc', [0, 4.2, 0], [0, 4.32, 0], 0.54, 18); B.tube('steel:nc', [0, 8.0, 0], [0, 8.12, 0], 0.54, 18);
    // 赤道の歩廊と手すり
    { const rg = new THREE.RingGeometry(R + 0.02, R + 0.78, 48); rg.rotateX(-Math.PI / 2); rg.translate(0, CY - 0.55, 0); B.geo('grate', rg); const rg2 = new THREE.RingGeometry(R + 0.02, R + 0.78, 48); rg2.rotateX(Math.PI / 2); rg2.translate(0, CY - 0.6, 0); B.geo('grate', rg2); }
    for (const [yy, tt] of [[CY + 0.5, 0.022], [CY - 0.02, 0.018]]) { const t = new THREE.TorusGeometry(R + 0.76, tt, 5, 48); t.rotateX(Math.PI / 2); t.translate(0, yy, 0); B.geo('galv:nc', t); }
    for (let i = 0; i < 24; i++) { const a = (i / 24) * TWO_PI, x = Math.cos(a) * (R + 0.76), z = Math.sin(a) * (R + 0.76); B.beam('galv:nc', [x, CY - 0.55, z], [x, CY + 0.5, z], 0.03); B.beam('steel:nc', [Math.cos(a) * (R - 0.25), CY - 1.15, Math.sin(a) * (R - 0.25)], [x, CY - 0.58, z], 0.04); }
    // はしご（脚に沿って歩廊へ、そこからてっぺんへ）と、てっぺんの通気口・避雷針・航空障害灯
    { const L = legs[0], n = 30; for (const s of [-0.16, 0.16]) { const o = [-Math.sin(Math.PI / 6) * s, 0, Math.cos(Math.PI / 6) * s]; const a0 = L.at(0.5), a1 = L.at(11.4); B.beam('galv:nc', [a0[0] * 1.06 + o[0], a0[1], a0[2] * 1.06 + o[2]], [a1[0] * 1.14 + o[0], CY - 0.5, a1[2] * 1.14 + o[2]], 0.03); }
      for (let i = 1; i < n; i++) { const p = L.at(0.5 + (10.9 * i) / n), k = 1.06 + (0.08 * i) / n, o = [-Math.sin(Math.PI / 6) * 0.16, Math.cos(Math.PI / 6) * 0.16]; B.beam('galv:nc', [p[0] * k - o[0], p[1], p[2] * k - o[1]], [p[0] * k + o[0], p[1], p[2] * k + o[1]], 0.02); } }
    for (let i = 0; i < 9; i++) { const t0 = (i / 9) * 1.5, t1 = ((i + 1) / 9) * 1.5, rr = R + 0.07, az = Math.PI / 6; for (const s of [-0.15, 0.15]) B.beam('galv:nc', [Math.cos(az) * Math.cos(t0) * rr - Math.sin(az) * s, CY + Math.sin(t0) * rr, Math.sin(az) * Math.cos(t0) * rr + Math.cos(az) * s], [Math.cos(az) * Math.cos(t1) * rr - Math.sin(az) * s, CY + Math.sin(t1) * rr, Math.sin(az) * Math.cos(t1) * rr + Math.cos(az) * s], 0.025); }
    B.tube('steel', [0, CY + R - 0.05, 0], [0, CY + R + 0.25, 0], 0.5, 16); B.tube('steel', [0, CY + R + 0.25, 0], [0, CY + R + 0.45, 0], 0.5, 16, 0.12);
    B.tube('galv:nc', [0, CY + R + 0.45, 0], [0, CY + R + 2.0, 0], 0.025, 6); B.sph('warn:nc', 0.09, 0, CY + R + 0.62, 0.3, 8, 6);
    B.build(M, wt);
    const gs = glowSprite(0xff3a22, 1.8, { gain: 0.3, pow: 2.4 }); gs.position.set(0, CY + R + 0.62, 0.3); wt.add(gs); this.warnGlow = gs;
    this.site.add(wt);
  }

  // ---- パラボラアンテナ（皿の半径 3・首振りの台）
  _dish(M) {
    const dish = new THREE.Group(); dish.position.set(-16, 0, -44);
    const B = new Bag();
    B.box('conc', 2.6, 0.3, 2.6, 0, 0.15, 0);
    B.tube('white', [0, 0.3, 0], [0, 4.2, 0], 0.42, 18, 0.3); B.tube('steel', [0, 0.3, 0], [0, 0.5, 0], 0.6, 18);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TWO_PI; B.tube('galv:nc', [Math.cos(a) * 0.5, 0.5, Math.sin(a) * 0.5], [Math.cos(a) * 0.5, 0.58, Math.sin(a) * 0.5], 0.03, 6); }
    B.tube('steel', [0, 4.2, 0], [0, 4.75, 0], 0.52, 18);                         // 方位の軸受け
    for (const s of [1, -1]) { B.box('white', 0.2, 1.3, 0.6, s * 0.72, 5.2, 0); B.tube('steel:nc', [s * 0.6, 5.3, 0], [s * 0.86, 5.3, 0], 0.14, 12); }
    B.box('white', 1.64, 0.2, 0.7, 0, 4.82, 0);
    B.box('steel', 0.6, 0.7, 0.5, 0.0, 4.6, -0.75);                                // 駆動部
    B.at(1.6, 0, 1.3, 0.4); B.box('conc', 1.0, 0.1, 0.7, 0, 0.05, 0); B.box('white', 0.8, 1.2, 0.5, 0, 0.7, 0); B.box('dark:nc', 0.3, 0.2, 0.51, 0.15, 1.0, 0); B.home();
    pipeRun(B, 'galv:nc', [[1.3, 0.2, 1.1], [0.5, 0.2, 0.4], [0.44, 2.8, 0.1]], 0.03);
    ladder(B, -0.45, 0.5, 4.2, 0.0, false);
    B.build(M, dish);
    // 皿（軸で傾く）：反射面・背面の骨・焦点の受信部と 4 本の支柱
    const head = new THREE.Group(); head.position.y = 5.3; head.rotation.set(-0.9, 0, 0.2);
    const f = 1.73, para = (r) => (r * r) / (4 * f);
    const pts = []; for (let i = 0; i <= 14; i++) { const r = 0.06 + (2.94 * i) / 14; pts.push(new THREE.Vector2(r, para(r))); }
    const refl = new THREE.Mesh(new THREE.LatheGeometry(pts, 48), dishMat()); refl.castShadow = true; refl.receiveShadow = true;
    head.add(refl);
    const Bh = new Bag();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TWO_PI, c = Math.cos(a), s = Math.sin(a);
      for (let k = 0; k < 5; k++) { const r0 = 0.5 + k * 0.5, r1 = r0 + 0.5; Bh.beam('steel:nc', [c * r0, para(r0) - 0.05, s * r0], [c * r1, para(r1) - 0.05, s * r1], 0.035, 0.07); }
      Bh.beam('steel:nc', [c * 0.5, -0.5, s * 0.5], [c * 2.6, para(2.6) - 0.08, s * 2.6], 0.03);
    }
    for (const [rr, off] of [[1.4, 0.12], [2.6, 0.12]]) { const t = new THREE.TorusGeometry(rr, 0.035, 5, 40); t.rotateX(Math.PI / 2); t.translate(0, para(rr) - off, 0); Bh.geo('steel:nc', t); }
    { const t = new THREE.TorusGeometry(3.0, 0.03, 5, 48); t.rotateX(Math.PI / 2); t.translate(0, para(3.0), 0); Bh.geo('steel:nc', t); }
    Bh.tube('steel', [0, -0.55, 0], [0, 0.02, 0], 0.55, 18);
    for (let i = 0; i < 4; i++) { const a = i * (Math.PI / 2) + 0.785; Bh.tube('galv:nc', [Math.cos(a) * 2.85, para(2.85), Math.sin(a) * 2.85], [Math.cos(a) * 0.16, f + 0.1, Math.sin(a) * 0.16], 0.03, 6); }
    Bh.tube('steel', [0, f - 0.05, 0], [0, f + 0.32, 0], 0.2, 14, 0.24); Bh.tube('white', [0, f - 0.42, 0], [0, f - 0.05, 0], 0.07, 12, 0.19);
    Bh.build(M, head);
    dish.add(head);
    this.site.add(dish);
  }

  // ---- 電柱と電線（格納庫から西へ。役者のいる所からは離す）
  _poles(M) {
    const B = new Bag();
    const pts = [[-43.1, -19.9], [-60.5, -8.5], [-84, 4], [-108, 16], [-132, 27]];
    const arm = [], H = 7.7;
    pts.forEach(([x, z], i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1]; const tl = Math.hypot(tx, tz); tx /= tl; tz /= tl;
      const nx = -tz, nz2 = tx, y0 = yardH(x, z) - 0.4, lean = (i % 2 ? 1 : -1) * 0.04;
      B.tube('pole', [x, y0, z], [x + lean, y0 + 8.9, z + lean * 0.5], 0.14, 9, 0.095);
      const cy = y0 + H + 0.4, cx = x + lean * 0.9, cz = z + lean * 0.45;
      B.beam('pole', [cx - nx * 1.05, cy, cz - nz2 * 1.05], [cx + nx * 1.05, cy, cz + nz2 * 1.05], 0.1, 0.12);
      B.beam('galv:nc', [cx - nx * 0.6, cy, cz - nz2 * 0.6], [cx, cy - 0.7, cz], 0.03); B.beam('galv:nc', [cx + nx * 0.6, cy, cz + nz2 * 0.6], [cx, cy - 0.7, cz], 0.03);
      const tops = [-0.9, 0, 0.9].map((o) => [cx + nx * o, cy + 0.2, cz + nz2 * o]);
      for (const t of tops) { B.tube('white:nc', [t[0], cy + 0.06, t[2]], [t[0], cy + 0.2, t[2]], 0.045, 8, 0.03); }
      arm.push(tops);
      if (i === 0) { B.tube('steel', [cx + tx * 0.3, cy - 1.5, cz + tz * 0.3], [cx + tx * 0.3, cy - 0.7, cz + tz * 0.3], 0.26, 12); B.tube('galv:nc', [cx + tx * 0.3, cy - 0.7, cz + tz * 0.3], [cx, cy + 0.1, cz], 0.02, 5); }
    });
    const wire = (p, q, sag) => { const n = 10; let prev = p; for (let k = 1; k <= n; k++) { const f = k / n, cur = [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f - sag * 4 * f * (1 - f), p[2] + (q[2] - p[2]) * f]; B.tube('dark:nc', prev, cur, 0.016, 4); prev = cur; } };
    for (let i = 0; i < arm.length - 1; i++) for (let k = 0; k < 3; k++) wire(arm[i][k], arm[i + 1][k], 1.0 + 0.15 * k);
    // 引き込み線（1 本目の柱 → 格納庫の妻壁の角）
    const cs = Math.cos(HANGAR.ry), sn = Math.sin(HANGAR.ry), hx = -11.6, hz = 8.1;
    wire(arm[0][1], [HANGAR.x + hx * cs + hz * sn, 8.4, HANGAR.z - hx * sn + hz * cs], 0.5);
    B.build(M, this.site);
  }

  // ---- 雑草：建物の足もと・コンクリートの目地とふち・台のまわり
  _weeds(HI) {
    const rnd = mulberry(4242), spots = [];       // [x, z, 高さの倍率]
    const tuft = (x, z, n = 6, spread = 0.12, k = 1) => { for (let i = 0; i < n; i++) spots.push([x + (rnd() - 0.5) * spread * 2, z + (rnd() - 0.5) * spread * 2, k * (0.6 + rnd() * 0.8)]); };
    const cs = Math.cos(HANGAR.ry), sn = Math.sin(HANGAR.ry);
    const hangarW = (x, z) => [HANGAR.x + x * cs + z * sn, HANGAR.z - x * sn + z * cs];
    // 格納庫の周り（扉の前はのぞく）
    for (let t = -12.3; t <= 12.3; t += 0.3) {
      if (rnd() < 0.55 && Math.abs(t) > 5.9) tuft(...hangarW(t, 8.35 + rnd() * 0.25), 6, 0.1, 1.1);
      if (rnd() < 0.7) tuft(...hangarW(t, -8.4 - rnd() * 0.3), 7, 0.12, 1.5);
    }
    for (let t = -8.2; t <= 8.2; t += 0.3) for (const s of [1, -1]) if (rnd() < 0.62) tuft(...hangarW(s * (12.4 + rnd() * 0.3), t), 7, 0.12, 1.3);
    // 給水塔の基礎・アンテナの台
    for (let i = 0; i < 6; i++) { const a = (i + 0.5) * (Math.PI / 3); for (let k = 0; k < 5; k++) { const b = rnd() * TWO_PI; tuft(-58 + Math.cos(a) * 4.4 + Math.cos(b) * 0.6, -12 + Math.sin(a) * 4.4 + Math.sin(b) * 0.6, 7, 0.12, 1.5); } }
    for (let k = 0; k < 22; k++) { const b = rnd() * TWO_PI, r = 1.5 + rnd() * 0.5; tuft(-16 + Math.cos(b) * r * 1.2, -44 + Math.sin(b) * r * 1.2, 7, 0.12, 1.4); }
    // 作業場のコンクリートの目地（6 m ごと）。役者が立つあたりは避ける
    const clear = (x, z) => Math.abs(x) < 5.8 && z > -2.2 && z < 8.6;
    for (const jx of [-12, -6, 0, 6, 12]) for (let z = -8.8; z <= 8.8; z += 0.4) if (rnd() < 0.2 && !clear(jx, z) && !(jx === 0 && z > -5.6)) tuft(jx + (rnd() - 0.5) * 0.04, z, 4, 0.05, 0.55);      // 冒頭のカメラの真ん前（x=0・板の後ろ）は空ける
    for (const jz of [-6, 0, 6]) for (let x = -15.8; x <= 15.8; x += 0.4) if (rnd() < 0.2 && !clear(x, jz)) tuft(x, jz + (rnd() - 0.5) * 0.04, 4, 0.05, 0.55);
    // コンクリートのふち（芝との境）
    for (let x = -16.6; x <= 16.6; x += 0.28) for (const s of [1, -1]) if (rnd() < 0.75) tuft(x, s * (9.1 + rnd() * 0.8), 7, 0.14, 1.2 + rnd() * 0.6);
    for (let z = -9.6; z <= 9.6; z += 0.28) for (const s of [1, -1]) if (rnd() < 0.75) tuft(s * (16.1 + rnd() * 0.8), z, 7, 0.14, 1.2 + rnd() * 0.6);
    // 掲示板の後ろ・木箱の後ろ・作業台の後ろ
    for (let k = 0; k < 10; k++) tuft(-1.9 + rnd() * 3.8, -3.6 - rnd() * 0.8, 5, 0.1, 0.8);
    for (let k = 0; k < 8; k++) tuft(6.3 + rnd() * 1.2, -2.6 + rnd() * 1.8, 5, 0.1, 0.8);
    // 試験場の台のまわり
    for (let k = 0; k < 120; k++) { const b = rnd() * TWO_PI, r = 3.98 + rnd() * 0.5; tuft(Math.cos(b) * r, -15 + Math.sin(b) * r, 6, 0.1, 0.9 + rnd() * 0.5); }
    const list = HI ? spots : spots.filter((_, i) => i % 2 === 0);
    // 葉の形（terrain.js の芝と同じ考え方：根元が太く先が細い）
    const rows = [[0, 1.0], [0.4, 0.8], [0.75, 0.45], [1.0, 0.04]], pos = [], uvs = [], idx = [];
    rows.forEach(([y, w], r) => { pos.push(-0.5 * w, y, 0, 0.5 * w, y, 0); uvs.push(0, y, 1, y); if (r > 0) { const a = (r - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geo.setIndex(idx); geo.computeVertexNormals();
    const m = new THREE.MeshStandardNodeMaterial(); m.side = THREE.DoubleSide; m.roughness = 0.78; m.metalness = 0;
    const vv = uv().y, wp = positionLocal, tint = hash(instanceIndex);
    m.colorNode = mix(mix(color(0x2f3f18), color(0x4a4a22), tint), mix(color(0x7f9a3a), color(0xb9a765), tint.mul(tint)), vv.pow(0.8)).mul(tint.mul(0.4).add(0.75));
    const sway = sin(time.mul(1.4).add(wp.x.mul(0.3)).add(wp.z.mul(0.2))).mul(0.5).add(sin(time.mul(6.0).add(wp.x.mul(3.0))).mul(0.12)).mul(vv.mul(vv)).mul(0.07);
    m.positionNode = vec3(wp.x.add(sway), wp.y, wp.z.add(sway.mul(0.6)));
    const mesh = new THREE.InstancedMesh(geo, m, list.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    list.forEach(([x, z, k], i) => {
      e.set((rnd() - 0.5) * 0.9, rnd() * TWO_PI, (rnd() - 0.5) * 0.7); q.setFromEuler(e);
      m4.compose(p.set(x, -0.01, z), q, s.set(0.03 + rnd() * 0.035, (0.14 + rnd() * 0.2) * k, 1));
      mesh.setMatrixAt(i, m4);
    });
    mesh.castShadow = false; mesh.receiveShadow = true; mesh.frustumCulled = false;
    this.site.add(mesh);
  }

  /** 夜の灯り（0..1）：窓・外灯・看板・地面にこぼれる光 */
  setNight(k) {
    this.uN.value = k;
    for (const g of this.glows) { g.visible = k > 0.01; if (g.userData.gain) g.userData.gain.value = 0.55 * k; }
    this.warnGlow.userData.gain.value = 0.25 + 0.8 * k;
  }
}
