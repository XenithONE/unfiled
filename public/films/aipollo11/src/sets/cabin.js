// 司令船の中：4 人が並ぶ座席・計器盤・丸窓。
// アポロの司令船を手本に、灰色の計器盤（スイッチ・丸い計器・DSKY ふうの表示器・警告灯）、布張りの座席、配線、収納、窓の厚みを作り込む。
// 計器の文字・目盛り・数字はすべて canvas に描く（画像ファイルなし）。灯りは「どの計器の灯りか」が分かる並びにしてある。
import * as THREE from 'three/webgpu';
import {
  uniform, color, mix, step, fract, floor, vec2, vec3, float, sin, uv, smoothstep, texture, positionWorld, positionLocal,
  normalView, positionViewDirection, mx_noise_float, abs, dot, mod, output, vec4,
} from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { grp, canvasTex, iattr, mergeGeometries } from '../core/kit.js';
import { mulberry } from '../core/util.js';
import { FX_LAYER } from '../core/engine.js';

export const SEATS = [-2.25, -0.75, 0.75, 2.25];

// ---- 壁の位置（前は開いていて、カメラはそこから覗く）
const BACK_Z = -1.45;                        // 奥の壁の内側の面
const SIDE = { x: 3.83, z: 0.765, ax: 0.218, az: 0.976, yaw: Math.PI / 2 + 0.22 };   // 横の壁（奥へ行くほど外へ開く）
const xf = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
/**
 * 横の壁に取り付ける物の座標系：Y = 上、Z = 船内へ、X = 壁に向かって右（右の壁では手前、左の壁では奥）。
 * side = -1（左）/ +1（右）、s = 壁に沿った位置（正で手前）、off = 壁からの浮き
 */
const sideM = (side, s = 0, y = 0, off = 0) => {
  const m = new THREE.Matrix4().makeRotationY(-side * SIDE.yaw);
  m.setPosition(side * (SIDE.x - SIDE.ax * s) - side * SIDE.az * off, y, SIDE.z + SIDE.az * s - SIDE.ax * off);
  return m;
};
/** 艶の明るさの上限（点の光の反射で白く飛ばないように） */
const cap = (m, v = 6) => { m.outputNode = vec4(output.rgb.min(vec3(v)), output.a); return m; };

/** 形をためて、素材ごとに 1 つのメッシュにまとめる */
class Bag {
  constructor() { this.m = new Map(); }
  add(material, geo, matrix, parent) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (matrix) g.applyMatrix4(matrix);
    if (parent) g.applyMatrix4(parent);
    let l = this.m.get(material); if (!l) this.m.set(material, (l = []));
    l.push(g);
  }
  box(material, w, h, d, x, y, z, rx, ry, rz, parent) { this.add(material, new THREE.BoxGeometry(w, h, d), xf(x, y, z, rx, ry, rz), parent); }
  rbox(material, w, h, d, r, x, y, z, rx, ry, rz, parent) { this.add(material, new RoundedBoxGeometry(w, h, d, 2, r), xf(x, y, z, rx, ry, rz), parent); }
  cyl(material, rt, rb, h, seg, x, y, z, rx, ry, rz, parent) { this.add(material, new THREE.CylinderGeometry(rt, rb, h, seg), xf(x, y, z, rx, ry, rz), parent); }
  torus(material, R, r, x, y, z, rx, ry, rz, parent, arc = Math.PI * 2) { this.add(material, new THREE.TorusGeometry(R, r, 8, 40, arc), xf(x, y, z, rx, ry, rz), parent); }
  tube(material, pts, r, parent) { this.add(material, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), pts.length * 8, r, 6, false), null, parent); }
  build(root, noCast) {
    for (const [material, list] of this.m) {
      const me = new THREE.Mesh(mergeGeometries(list), material);
      me.castShadow = !noCast.has(material); me.receiveShadow = true;
      root.add(me);
    }
  }
}
/** 同じ形をたくさん置く */
function instanced(root, geo, material, mats, cast = false) {
  if (!mats.length) return null;
  const im = new THREE.InstancedMesh(geo, material, mats.length);
  mats.forEach((m, i) => im.setMatrixAt(i, m));
  im.instanceMatrix.needsUpdate = true; im.frustumCulled = false; im.castShadow = cast; im.receiveShadow = true;
  root.add(im);
  return im;
}

// =====================================================================
// 素材
// =====================================================================
/** 塗装した金属：ゆるい色むらと、手でこすれた艶のむら */
function paint(hex, o = {}) {
  const m = new THREE.MeshStandardNodeMaterial();
  const P = positionWorld;
  const n1 = mx_noise_float(P.mul(2.7).add(o.seed ?? 0));
  const n2 = mx_noise_float(P.mul(vec3(34.0, 7.0, 34.0)));
  m.colorNode = color(hex).mul(n1.mul(0.07).add(1.0)).mul(n2.mul(0.035).add(1.0));
  m.roughnessNode = float(o.rough ?? 0.56).add(n1.mul(0.09)).sub(n2.max(0).mul(0.1));
  m.metalness = o.metal ?? 0;
  return cap(m, 8);
}
/** 布：織り目の細かな凹凸と、キルティングの縫い目（pitch = 縫い目の間隔。0 なら無し） */
function cloth(hex, pitch = 0, o = {}) {
  const m = new THREE.MeshStandardNodeMaterial();
  const P = positionLocal;
  const weave = sin(P.x.mul(210.0)).mul(sin(P.y.mul(210.0).add(P.z.mul(210.0)))).mul(0.5).add(0.5);
  const fuzz = mx_noise_float(P.mul(9.0).add(o.seed ?? 0));
  let seam = float(0);
  if (pitch) { const s = P.y.add(P.z.mul(0.9)).div(pitch); seam = smoothstep(0.0, 0.07, s.sub(s.round()).abs()).oneMinus(); }
  m.colorNode = color(hex).mul(fuzz.mul(0.08).add(0.96)).mul(weave.mul(0.06).add(0.97)).mul(seam.mul(0.3).oneMinus());
  m.roughnessNode = float(0.9).sub(weave.mul(0.06));
  m.metalness = 0;
  return m;
}
const flat = (hex, rough = 0.6, metal = 0) => { const m = new THREE.MeshStandardNodeMaterial(); m.color.set(hex); m.roughness = rough; m.metalness = metal; return cap(m, 8); };
const lit = (node) => { const m = new THREE.MeshBasicNodeMaterial(); m.colorNode = node; return m; };
const hash1 = (x) => fract(sin(x.mul(12.9898)).mul(43758.5453));

// =====================================================================
// canvas に描く：計器盤の文字・目盛り・数字
// =====================================================================
const FONT = 'bold 15px "Arial Narrow", Arial, sans-serif';
/** 7 セグメント風の数字の一覧（8 x 2 マス）：0-9, 空白, +, -, : */
function digitAtlas() {
  const CW = 64, CH = 96;
  const SEG = [0b1110111, 0b0100100, 0b1011101, 0b1101101, 0b0101110, 0b1101011, 0b1111011, 0b0100101, 0b1111111, 0b1101111];
  const t = canvasTex(CW * 8, CH * 2, (c) => {
    c.fillStyle = '#000'; c.fillRect(0, 0, CW * 8, CH * 2);
    c.fillStyle = '#fff';
    const seg = (ox, oy, i) => {
      const x0 = ox + 14, x1 = ox + 50, y0 = oy + 12, ym = oy + 48, y1 = oy + 84, w = 8;
      const H = (x, y) => { c.beginPath(); c.moveTo(x + 3, y); c.lineTo(x1 - 3 - (x - x0), y); c.lineTo(x1 - 6, y + w / 2); c.lineTo(x1 - 3, y + w); c.lineTo(x + 3, y + w); c.lineTo(x + 6 - 6, y + w / 2); c.closePath(); c.fill(); };
      const V = (x, ya, yb) => { c.beginPath(); c.moveTo(x, ya + 4); c.lineTo(x + w / 2, ya); c.lineTo(x + w, ya + 4); c.lineTo(x + w, yb - 4); c.lineTo(x + w / 2, yb); c.lineTo(x, yb - 4); c.closePath(); c.fill(); };
      if (i === 0) H(x0, y0 - 4); if (i === 3) H(x0, ym - 4); if (i === 6) H(x0, y1 - 4);
      if (i === 1) V(x0 - 6, y0, ym); if (i === 2) V(x1 - 2, y0, ym); if (i === 4) V(x0 - 6, ym, y1); if (i === 5) V(x1 - 2, ym, y1);
    };
    for (let d = 0; d < 10; d++) for (let i = 0; i < 7; i++) if (SEG[d] >> i & 1) seg((d % 8) * CW, Math.floor(d / 8) * CH, i);
    const g = (n) => [(n % 8) * CW, Math.floor(n / 8) * CH];
    let [x, y] = g(11); c.fillRect(x + 14, y + 44, 36, 8); c.fillRect(x + 28, y + 30, 8, 36);     // +
    [x, y] = g(12); c.fillRect(x + 14, y + 44, 36, 8);                                              // -
    [x, y] = g(13); c.fillRect(x + 26, y + 28, 10, 10); c.fillRect(x + 26, y + 60, 10, 10);         // :
  }, { srgb: false });
  t.anisotropy = 4;
  return t;
}
/** 丸い計器の文字盤の一覧（4 x 4） */
const GAUGES = ['VOLTS', 'AMPS', 'TOKENS', 'CONTEXT', 'GPU TEMP', 'O2', 'FUEL', 'CABIN', 'PSI', 'RPM', 'H2', 'CRYO'];
function gaugeAtlas() {
  const S = 256;
  return canvasTex(S * 4, S * 4, (c) => {
    c.fillStyle = '#060708'; c.fillRect(0, 0, S * 4, S * 4);
    GAUGES.forEach((name, i) => {
      const cx = (i % 4) * S + S / 2, cy = Math.floor(i / 4) * S + S / 2, R = S * 0.44;
      c.fillStyle = '#0c0d0f'; c.beginPath(); c.arc(cx, cy, R, 0, 6.2832); c.fill();
      const A0 = Math.PI * 0.75, A1 = Math.PI * 2.25;
      c.lineWidth = 9; c.strokeStyle = '#3c8f52'; c.beginPath(); c.arc(cx, cy, R * 0.83, A0 + (A1 - A0) * (0.3 + (i % 3) * 0.08), A0 + (A1 - A0) * 0.72); c.stroke();
      c.strokeStyle = '#b53a2a'; c.beginPath(); c.arc(cx, cy, R * 0.83, A0 + (A1 - A0) * 0.86, A1); c.stroke();
      c.strokeStyle = '#e9e6dc';
      for (let k = 0; k <= 20; k++) {
        const a = A0 + (A1 - A0) * k / 20, big = k % 5 === 0;
        c.lineWidth = big ? 5 : 2.4;
        c.beginPath(); c.moveTo(cx + Math.cos(a) * R * (big ? 0.7 : 0.78), cy + Math.sin(a) * R * (big ? 0.7 : 0.78)); c.lineTo(cx + Math.cos(a) * R * 0.92, cy + Math.sin(a) * R * 0.92); c.stroke();
        if (big) { c.fillStyle = '#e9e6dc'; c.font = 'bold 22px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(k / 5 * (i % 2 ? 25 : 2)), cx + Math.cos(a) * R * 0.54, cy + Math.sin(a) * R * 0.54); }
      }
      c.fillStyle = '#e9e6dc'; c.font = 'bold 21px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(name, cx, cy + R * 0.52);
      c.fillStyle = '#2a2b2e'; c.beginPath(); c.arc(cx, cy, R * 0.1, 0, 6.2832); c.fill();
    });
  });
}
/** 姿勢指示器（8 ボール）の球の模様 */
function fdaiTex() {
  const W = 512, H = 256;
  return canvasTex(W, H, (c) => {
    c.fillStyle = '#d9d6cc'; c.fillRect(0, 0, W, H / 2); c.fillStyle = '#0d0e10'; c.fillRect(0, H / 2, W, H / 2);
    c.fillStyle = '#b3402e'; c.fillRect(0, H / 2 - 3, W, 6);
    for (let la = -75; la <= 75; la += 15) {
      if (!la) continue;
      const y = H / 2 - la / 90 * H / 2; c.fillStyle = la > 0 ? '#22242a' : '#e9e6dc';
      for (let x = 0; x < W; x += 64) { c.fillRect(x + 8, y - 1.5, la % 30 ? 22 : 40, 3); if (la % 30 === 0) { c.font = 'bold 13px Arial'; c.textBaseline = 'middle'; c.fillText(String(Math.abs(la)), x + 52, y); } }
    }
    for (let x = 0; x < W; x += 32) { c.fillStyle = '#22242a'; c.fillRect(x, 20, 2, H / 2 - 24); c.fillStyle = '#e9e6dc'; c.fillRect(x, H / 2 + 4, 2, H / 2 - 24); }
    c.strokeStyle = '#b3402e'; c.lineWidth = 5; for (const y of [10, H - 10]) for (let x = 32; x < W; x += 128) { c.beginPath(); c.arc(x, y, 14, 0, 6.2832); c.stroke(); }
  });
}
/** 警告灯の文字板（6 x 4） */
const CW_NAMES = ['CONTEXT', 'TOKENS', 'GPU TEMP', 'RATE LIM', 'O2 FLOW', 'CO2', 'FUEL', 'CRYO', 'BUS A', 'BUS B', 'GIMBAL', 'CACHE', 'LATENCY', 'PROMPT', 'SUIT', 'CABIN', 'H2O', 'RCS', 'SPS', '429', 'AC BUS', 'DOCK', 'UPLINK', 'VIBES'];
function annunTex() {
  const W = 768, H = 384;
  return canvasTex(W, H, (c) => {
    c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
    CW_NAMES.forEach((n, i) => {
      const x = (i % 6) * 128, y = Math.floor(i / 6) * 96;
      c.fillStyle = '#d8d8d8'; c.fillRect(x + 6, y + 6, 116, 84);
      c.fillStyle = '#111'; c.font = 'bold 21px "Arial Narrow", Arial'; c.textAlign = 'center'; c.textBaseline = 'middle';
      const p = n.split(' '); if (p.length > 1) { c.fillText(p[0], x + 64, y + 36); c.fillText(p[1], x + 64, y + 62); } else c.fillText(n, x + 64, y + 48);
    });
  }, { srgb: false });
}
/** DSKY の左の表示灯（2 x 7）の文字板 */
const DSKY_NAMES = ['UPLINK ACTY', 'TEMP', 'NO ATT', 'GIMBAL LOCK', 'STBY', 'PROG', 'KEY REL', 'RESTART', 'OPR ERR', 'TRACKER', '', 'ALT', '', 'VEL'];
function dskyLampTex() {
  const W = 256, H = 448;
  return canvasTex(W, H, (c) => {
    c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
    DSKY_NAMES.forEach((n, i) => {
      const x = (i % 2) * 128, y = Math.floor(i / 2) * 64;
      c.fillStyle = '#d8d8d8'; c.fillRect(x + 5, y + 5, 118, 54);
      c.fillStyle = '#111'; c.font = 'bold 17px "Arial Narrow", Arial'; c.textAlign = 'center'; c.textBaseline = 'middle';
      const p = n.split(' '); if (p.length > 1) { c.fillText(p[0], x + 64, y + 22); c.fillText(p[1], x + 64, y + 42); } else c.fillText(n, x + 64, y + 32);
    });
  }, { srgb: false });
}
/** 面ファスナーで貼ってある手順のカード */
function cardTex() {
  return canvasTex(160, 224, (c) => {
    c.fillStyle = '#e4e0d3'; c.fillRect(0, 0, 160, 224);
    c.fillStyle = '#b3402e'; c.fillRect(0, 0, 160, 22); c.fillStyle = '#f2efe6'; c.font = 'bold 14px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('LAUNCH CHECKLIST', 80, 12);
    const rnd = mulberry(9);
    for (let i = 0; i < 12; i++) { const y = 36 + i * 15; c.strokeStyle = '#33363b'; c.lineWidth = 1.5; c.strokeRect(10, y - 5, 9, 9); if (i < 7) { c.beginPath(); c.moveTo(11, y); c.lineTo(14, y + 3); c.lineTo(19, y - 5); c.stroke(); } c.fillStyle = '#33363b'; c.fillRect(26, y - 1, 40 + rnd() * 80, 2.5); }
  });
}
/** 流れる目盛りの帯（テープ式の計器） */
function tapeTex() {
  const t = canvasTex(64, 512, (c) => {
    c.fillStyle = '#e4e1d6'; c.fillRect(0, 0, 64, 512); c.fillStyle = '#16171a';
    for (let y = 0; y < 512; y += 16) { c.fillRect(0, y, y % 64 ? 22 : 40, 3); if (y % 64 === 0) { c.font = 'bold 15px Arial'; c.textBaseline = 'middle'; c.fillText(String(y / 64 * 10), 42, y + 2); } }
  });
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

// =====================================================================
// 計器盤の割り付け（盤の中心が原点。単位は船内と同じ）
// =====================================================================
function layoutMain() {
  const L = { w: 7.9, h: 1.3, frames: [], labels: [], toggles: [], breakers: [], lamps: [], gauges: [], knobs: [], screws: [], guards: [], holes: [] };
  const rnd = mulberry(31);
  const frame = (x0, x1, title) => { L.frames.push([x0 + 0.02, -0.63, x1 - 0.02, 0.63, title]); for (const sx of [x0 + 0.07, x1 - 0.07]) for (const sy of [-0.58, 0.58]) L.screws.push([sx, sy]); };
  const row = (x0, x1, y, n, fn) => { for (let i = 0; i < n; i++) fn(x0 + (x1 - x0) * (n === 1 ? 0.5 : i / (n - 1)), y, i); };
  const tog = (x0, x1, y, n, title, guarded = []) => { row(x0, x1, y, n, (x, yy, i) => { L.toggles.push([x, yy, rnd() < 0.5 ? 1 : -1]); if (guarded.includes(i)) L.guards.push([x, yy]); L.labels.push([x, yy - 0.085, '▬▬', 9]); }); L.labels.push([(x0 + x1) / 2, y + 0.1, title, 13]); L.frames.push([x0 - 0.07, y - 0.12, x1 + 0.07, y + 0.14, null]); };
  // 1) 収納と照明のブレーカー
  frame(-3.95, -2.85, 'STOWAGE');
  row(-3.72, -3.08, -0.45, 5, (x, y) => L.breakers.push([x, y])); L.labels.push([-3.4, -0.33, 'LIGHTING', 13]);
  // 2) 電源
  frame(-2.85, -1.75, 'ELECTRICAL POWER');
  L.gauges.push([-2.57, 0.34, 0.13, 0], [-2.03, 0.34, 0.13, 1]);
  ['MAIN BUS A', 'MAIN BUS B', 'AI BUS'].forEach((t, k) => { row(-2.7, -1.9, -0.02 - k * 0.2, 8, (x, y) => L.breakers.push([x, y])); L.labels.push([-2.3, 0.07 - k * 0.2, t, 12]); });
  // 3) 飛行の計器
  frame(-1.75, -0.6, 'FLIGHT');
  row(-1.6, -1.04, 0.52, 4, (x, y, i) => L.lamps.push([x, y, 0.09, 0.05, [1, 1, 0, 2][i], 0]));
  tog(-1.6, -0.76, -0.47, 7, 'ATTITUDE CONTROL');
  // 4) 計算機（DSKY）と時計
  frame(-0.6, 0.6, 'GUIDANCE COMPUTER');
  // 5) 警告
  frame(0.6, 1.75, 'CAUTION / WARNING');
  row(1.0, 1.62, -0.12, 5, (x, y, i) => L.lamps.push([x, y, 0.09, 0.05, [0, 1, 1, 2, 0][i], 1]));
  tog(0.76, 1.6, -0.47, 7, 'ABORT / SEQUENCE', [0, 1]);
  // 6) 系統
  frame(1.75, 2.85, 'SYSTEMS');
  [1.98, 2.3, 2.62].forEach((x, i) => { L.gauges.push([x, 0.4, 0.105, 2 + i], [x, 0.12, 0.105, 5 + i]); L.knobs.push([x, -0.18, 0.045]); });
  tog(1.92, 2.68, -0.47, 6, 'PROPELLANT');
  // 7) 通信
  frame(2.85, 3.95, 'COMMUNICATIONS');
  L.holes.push([3.2, 0.26, 0.19]);
  row(3.62, 3.62, 0.4, 1, (x) => { for (let k = 0; k < 3; k++) L.lamps.push([x, 0.42 - k * 0.13, 0.13, 0.06, 3, 0]); });
  L.knobs.push([3.08, -0.16, 0.05], [3.36, -0.16, 0.05], [3.66, -0.16, 0.035]);
  tog(2.98, 3.82, -0.47, 6, 'AUDIO');
  return L;
}
function layoutSide() {
  const L = { w: 1.7, h: 1.05, frames: [], labels: [], toggles: [], breakers: [], lamps: [], gauges: [], knobs: [], screws: [], guards: [], holes: [] };
  const rnd = mulberry(47);
  L.frames.push([-0.83, -0.5, 0.83, 0.5, 'ENVIRONMENT']);
  for (const sx of [-0.78, 0.78]) for (const sy of [-0.45, 0.45]) L.screws.push([sx, sy]);
  for (let k = 0; k < 2; k++) for (let i = 0; i < 7; i++) L.breakers.push([-0.66 + i * 0.13, 0.02 - k * 0.16]);
  L.labels.push([-0.27, 0.11, 'SUIT CIRCUIT', 12], [-0.27, -0.05, 'CABIN FAN', 12]);
  L.gauges.push([0.42, 0.2, 0.1, 8], [0.66, 0.2, 0.1, 9], [0.42, -0.06, 0.1, 10], [0.66, -0.06, 0.1, 11]);
  for (let i = 0; i < 6; i++) { L.toggles.push([-0.66 + i * 0.15, -0.36, rnd() < 0.5 ? 1 : -1]); L.labels.push([-0.66 + i * 0.15, -0.445, '▬▬', 9]); }
  for (let i = 0; i < 5; i++) L.lamps.push([-0.66 + i * 0.13, 0.3, 0.085, 0.05, [1, 1, 0, 1, 2][i], 0]);
  L.knobs.push([0.45, -0.34, 0.04], [0.66, -0.34, 0.04]);
  return L;
}
/** 盤の表面に刷られた文字・枠・ねじ */
function legendTex(L, ppu, tone = '#6d747c') {
  const W = Math.round(L.w * ppu), H = Math.round(L.h * ppu);
  const X = (x) => (x + L.w / 2) * ppu, Y = (y) => (L.h / 2 - y) * ppu;
  return canvasTex(W, H, (c) => {
    c.fillStyle = tone; c.fillRect(0, 0, W, H);
    const rnd = mulberry(5);
    for (let i = 0; i < 900; i++) { c.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${0.02 + rnd() * 0.035})`; c.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 60, 1 + rnd() * 2); }   // すれ傷
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const [x0, y0, x1, y1, title] of L.frames) {
      if (title) {            // 盤の区切り：すき間の影と、上の見出し
        c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(X(x0) - 5, Y(y1) - 4, 4, Y(y0) - Y(y1) + 8); c.fillRect(X(x1) + 1, Y(y1) - 4, 4, Y(y0) - Y(y1) + 8);
        c.fillStyle = 'rgba(255,255,255,0.1)'; c.fillRect(X(x0) - 1, Y(y1) - 4, 2, Y(y0) - Y(y1) + 8);
        c.fillStyle = '#e9e6dc'; c.font = 'bold 19px "Arial Narrow", Arial'; c.fillText(title, (X(x0) + X(x1)) / 2, Y(y1) + 15);
        c.fillRect(X(x0) + 14, Y(y1) + 27, X(x1) - X(x0) - 28, 2);
      } else { c.strokeStyle = 'rgba(233,230,220,0.85)'; c.lineWidth = 2; c.strokeRect(X(x0), Y(y1), X(x1) - X(x0), Y(y0) - Y(y1)); }
    }
    for (const [x, y, t, s] of L.labels) { c.fillStyle = '#e9e6dc'; if (t === '▬▬') { c.fillRect(X(x) - 0.03 * ppu, Y(y) - 2, 0.06 * ppu, 3); continue; } c.font = `bold ${Math.round(s * ppu / 520 * 1.25)}px "Arial Narrow", Arial`; c.fillText(t, X(x), Y(y)); }
    for (const [x, y, r] of L.knobs) {         // つまみのまわりの目盛り
      c.strokeStyle = '#e9e6dc'; c.lineWidth = 2;
      for (let k = 0; k < 9; k++) { const a = Math.PI * (0.75 + k * 0.1875); c.beginPath(); c.moveTo(X(x) + Math.cos(a) * r * 1.35 * ppu, Y(y) + Math.sin(a) * r * 1.35 * ppu); c.lineTo(X(x) + Math.cos(a) * r * 1.7 * ppu, Y(y) + Math.sin(a) * r * 1.7 * ppu); c.stroke(); }
    }
    for (const [x, y] of L.breakers) { c.strokeStyle = 'rgba(233,230,220,0.7)'; c.lineWidth = 1.5; c.beginPath(); c.arc(X(x), Y(y), 0.03 * ppu, 0, 6.2832); c.stroke(); }
    for (const [x, y, r] of L.holes) {         // スピーカーの穴
      c.fillStyle = '#17181b'; c.beginPath(); c.arc(X(x), Y(y), r * ppu, 0, 6.2832); c.fill(); c.fillStyle = '#050506';
      for (let i = -8; i <= 8; i++) for (let j = -8; j <= 8; j++) { const dx = i * 0.021 + (j % 2) * 0.0105, dy = j * 0.018; if (dx * dx + dy * dy < (r * 0.9) ** 2) { c.beginPath(); c.arc(X(x + dx), Y(y + dy), 0.006 * ppu, 0, 6.2832); c.fill(); } }
    }
    for (const [x, y, w, h] of L.lamps) { c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(X(x - w / 2) - 3, Y(y + h / 2) - 3, w * ppu + 6, h * ppu + 6); }
  });
}

// =====================================================================
// 船内
// =====================================================================
export class Cabin {
  constructor() {
    const root = (this.root = grp());
    this.uT = uniform(0); this.alarm = uniform(0);
    this.winU = uniform(new THREE.Color(0.4, 0.7, 1.0));
    this.winGain = uniform(0.5);
    const uT = this.uT, alarm = this.alarm;
    const bag = new Bag(), noCast = new Set();
    const inst = { toggleBase: [], lever: [], breaker: [], screw: [], key: [], bolt: [] };

    // ---- 素材
    const hull = paint(0x343a42, { rough: 0.62 });            // 構造（壁・天井・床）
    const panelDark = paint(0x23262b, { rough: 0.5, seed: 3 });
    const frameM = paint(0x566069, { rough: 0.42, metal: 0.55, seed: 7 });   // 座席の骨組み・枠
    const alum = flat(0xb9bfc7, 0.34, 0.85);
    const black = flat(0x0e0f11, 0.5);
    const rubber = flat(0x131416, 0.85);
    const redM = flat(0xa3271c, 0.45);
    const yellowM = paint(0xc79a1e, { rough: 0.5 });
    const fabric = cloth(0x7d776a, 0.24);                       // 座席の布
    const beta = cloth(0xb1ab9c, 0.17, { seed: 4 });            // 白い断熱布・収納袋
    const web = cloth(0x767c84, 0);                             // ベルト
    const velcro = flat(0x39506a, 0.98);
    const guardM = flat(0x4a1410, 0.5);
    const winFrame = paint(0x5b646d, { rough: 0.4, metal: 0.5, seed: 9 }); winFrame.side = THREE.DoubleSide;
    for (const m of [hull]) noCast.add(m);

    // ---- 壁・天井・床（前は開いている）
    bag.box(hull, 8.4, 0.3, 6, 0, -0.15, 0.5); bag.box(hull, 8.4, 0.3, 6, 0, 3.75, 0.5);
    bag.box(hull, 8.4, 4.2, 0.3, 0, 1.8, -1.6);
    for (const s of [-1, 1]) bag.box(hull, 0.3, 4.2, 6.6, s * 4.0, 1.8, 0.8, 0, -s * 0.22, 0);
    // 奥の壁の下半分：収納の扉（白い断熱布をかぶせた箱）と、縦の骨
    for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) {
      const x = -3.3 + i * 1.32, y = 0.58 + j * 0.98;
      bag.rbox((i + j) % 3 ? panelDark : beta, 1.22, 0.9, 0.12, 0.03, x, y, BACK_Z + 0.06);
      bag.box(alum, 0.26, 0.035, 0.03, x, y + 0.36, BACK_Z + 0.135);                    // 取っ手
      bag.box(velcro, 0.12, 0.08, 0.008, x - 0.42, y - 0.3, BACK_Z + 0.125);
    }
    for (const x of [-3.96, -2.64, -1.32, 0, 1.32, 2.64, 3.96]) bag.box(frameM, 0.07, 2.05, 0.09, x, 1.05, BACK_Z + 0.1);
    bag.box(frameM, 8.0, 0.07, 0.1, 0, 2.1, BACK_Z + 0.1); bag.box(frameM, 8.0, 0.07, 0.1, 0, 0.06, BACK_Z + 0.1);
    // 計器盤の下を横に走る手すり
    bag.cyl(alum, 0.028, 0.028, 7.7, 12, 0, 2.03, BACK_Z + 0.27, 0, 0, Math.PI / 2);
    for (const x of [-3.3, -1.98, -0.66, 0.66, 1.98, 3.3]) bag.cyl(alum, 0.02, 0.02, 0.14, 8, x, 2.03, BACK_Z + 0.2, Math.PI / 2);
    // 配線の束（収納の扉の前を垂れ下がって床へ）と、通信盤から下がる巻いたコード
    bag.tube(rubber, [[3.62, 2.2, BACK_Z + 0.16], [3.7, 1.7, BACK_Z + 0.22], [3.55, 1.1, BACK_Z + 0.2], [3.72, 0.5, BACK_Z + 0.24], [3.5, 0.06, BACK_Z + 0.3]], 0.026);
    bag.tube(rubber, [[3.7, 2.2, BACK_Z + 0.15], [3.82, 1.6, BACK_Z + 0.19], [3.74, 0.9, BACK_Z + 0.2], [3.86, 0.3, BACK_Z + 0.22], [3.9, 0.05, BACK_Z + 0.4]], 0.018);
    bag.tube(rubber, [[-3.9, 0.12, BACK_Z + 0.2], [-2.6, 0.1, BACK_Z + 0.26], [-1.3, 0.13, BACK_Z + 0.22], [0, 0.09, BACK_Z + 0.27], [1.3, 0.12, BACK_Z + 0.23], [2.7, 0.1, BACK_Z + 0.26]], 0.022);
    { const pts = []; for (let i = 0; i <= 60; i++) { const k = i / 60, a = k * Math.PI * 2 * 9; pts.push([3.2 + Math.cos(a) * 0.035 + k * 0.12, 2.17 - k * 0.75, BACK_Z + 0.2 + Math.sin(a) * 0.035]); }
      bag.add(rubber, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 240, 0.009, 5, false));
      bag.rbox(panelDark, 0.11, 0.07, 0.06, 0.02, 3.33, 1.38, BACK_Z + 0.22); }
    // 壁のリベットの列
    for (let i = 0; i < 44; i++) { inst.screw.push(xf(-3.95 + i * 0.184, 3.52, BACK_Z + 0.004)); inst.screw.push(xf(-3.95 + i * 0.184, 2.13, BACK_Z + 0.152)); }

    // ---- 奥の計器盤
    const LM = layoutMain();
    const PZ = BACK_Z + 0.07, PY = 2.82;                       // 盤の表面と中心の高さ
    const mainM = xf(0, PY, PZ);
    const mainTex = legendTex(LM, 520, '#565c64'); mainTex.anisotropy = 8;
    { const m = new THREE.MeshStandardNodeMaterial(); m.map = mainTex; m.roughness = 0.52; m.metalness = 0.1;
      const plate = new THREE.Mesh(new THREE.BoxGeometry(LM.w, LM.h, 0.06), m); plate.position.set(0, PY, PZ - 0.03); plate.receiveShadow = true; root.add(plate); }
    bag.box(frameM, 8.06, 0.05, 0.12, 0, PY + 0.675, PZ - 0.01); bag.box(frameM, 8.06, 0.05, 0.12, 0, PY - 0.675, PZ - 0.01);
    this._lamps = []; this._gauges = [];
    this._emit(LM, mainM, bag, inst, { alum, black, redM, panelDark });
    // 収納の扉 2 枚（盤の左端）
    for (const x of [-3.67, -3.13]) { bag.rbox(panelDark, 0.46, 0.62, 0.05, 0.02, x, PY + 0.2, PZ + 0.025); bag.box(alum, 0.16, 0.03, 0.03, x, PY + 0.42, PZ + 0.06); bag.box(velcro, 0.1, 0.07, 0.006, x + 0.1, PY + 0.02, PZ + 0.053); bag.box(alum, 0.12, 0.035, 0.004, x - 0.1, PY + 0.33, PZ + 0.052); }
    { const cm = new THREE.MeshStandardNodeMaterial(); cm.map = cardTex(); cm.roughness = 0.85;
      const card = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.28), cm); card.position.set(-3.7, PY + 0.14, PZ + 0.056); card.rotation.z = 0.06; card.receiveShadow = true; root.add(card);
      const card2 = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.26), cm); card2.position.set(-2.05, 1.07, 2.93); card2.rotation.set(-Math.PI / 2, 0, -0.15 + Math.PI / 2); root.add(card2); }

    // 姿勢指示器（8 ボール）
    const fdai = (this.fdai = new THREE.Mesh(new THREE.SphereGeometry(0.27, 40, 28), (() => { const m = new THREE.MeshStandardNodeMaterial(); m.map = fdaiTex(); m.roughness = 0.34; m.emissiveNode = texture(m.map, uv()).rgb.mul(0.18); return m; })()));
    fdai.position.set(-1.32, PY + 0.1, PZ - 0.12); fdai.castShadow = false; root.add(fdai);
    bag.torus(black, 0.265, 0.035, -1.32, PY + 0.1, PZ + 0.03);
    bag.box(black, 0.74, 0.74, 0.03, -1.32, PY + 0.1, PZ - 0.004);
    bag.box(yellowM, 0.52, 0.012, 0.008, -1.32, PY + 0.1, PZ + 0.158); bag.box(yellowM, 0.012, 0.52, 0.008, -1.32, PY + 0.1, PZ + 0.158);
    for (const [ax, ay] of [[-0.26, 0], [0.26, 0], [0, -0.26], [0, 0.26]]) bag.box(black, 0.02, 0.02, 0.15, -1.32 + ax, PY + 0.1 + ay, PZ + 0.085);
    // テープ式の計器 2 本
    const tape = tapeTex();
    for (const [k, x] of [[0, -0.9], [1, -0.76]]) {
      const tm = lit(texture(tape, vec2(uv().x, uv().y.mul(0.32).add(uT.mul(k ? -0.013 : 0.021)).add(k * 0.37))).rgb.mul(0.85));
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.085, 0.56), tm); p.position.set(x, PY + 0.1, PZ + 0.012); root.add(p);
      bag.box(black, 0.12, 0.62, 0.02, x, PY + 0.1, PZ + 0.002); bag.box(yellowM, 0.11, 0.008, 0.012, x, PY + 0.1, PZ + 0.02);
    }

    // ---- DSKY ふうの計算機：左に表示灯、右に数字、下に鍵盤。上に経過時間の時計
    const DX = 0, DY = PY - 0.1;
    bag.rbox(panelDark, 1.04, 1.0, 0.09, 0.03, DX, DY, PZ + 0.045);
    const digits = digitAtlas();
    const glyph = (gi, f) => { const col = mod(gi, 8.0), rowI = floor(gi.div(8.0)); const inner = f.sub(0.5).mul(vec2(1.22, 1.16)).add(0.5); const ok = step(0.0, inner.x).mul(step(inner.x, 1.0)).mul(step(0.0, inner.y)).mul(step(inner.y, 1.0)); return texture(digits, vec2(col.add(inner.x).div(8.0), float(1.0).sub(rowI).add(inner.y).div(2.0))).r.mul(ok); };
    { // 数字（6 x 5 マス）：通常は PROG 63 / VERB 16 / NOUN 68 と変わり続ける 3 行。警報のときは VERB 05 NOUN 09、1 行目に 01202
      const N = [[10, 10, 10, 10, 6, 3], [1, 6, 10, 10, 6, 8], [11, 20, 20, 20, 20, 20], [12, 20, 20, 20, 20, 20], [11, 20, 20, 20, 20, 20]];
      const A = [[10, 10, 10, 10, 6, 3], [0, 5, 10, 10, 0, 9], [10, 0, 1, 2, 0, 2], [10, 10, 10, 10, 10, 10], [10, 10, 10, 10, 10, 10]];
      const data = (rows) => { const d = new Uint8Array(6 * 5 * 4); rows.forEach((r, ri) => r.forEach((v, ci) => { const o = ((4 - ri) * 6 + ci) * 4; d[o] = v * 10; d[o + 3] = 255; })); const t = new THREE.DataTexture(d, 6, 5, THREE.RGBAFormat); t.magFilter = t.minFilter = THREE.NearestFilter; t.needsUpdate = true; return t; };
      const tN = data(N), tA = data(A);
      const g = uv().mul(vec2(6, 5)), cell = floor(g), f = fract(g), cuv = cell.add(0.5).div(vec2(6, 5));
      const vN = texture(tN, cuv).r.mul(25.5).round(), vA = texture(tA, cuv).r.mul(25.5).round();
      const dyn = floor(hash1(cell.x.add(cell.y.mul(7.0)).add(floor(uT.mul(cell.x.mul(cell.x).mul(0.35).add(0.3))).mul(1.7))).mul(9.99));
      const gi = mix(mix(vN, dyn, step(19.5, vN)), vA, alarm);
      const acty = step(3.5, cell.y).mul(step(cell.x, 1.5)).mul(step(0.22, f.y)).mul(step(f.y, 0.78)).mul(step(0.5, hash1(floor(uT.mul(9.0)).add(0.7))));   // COMP ACTY
      const dm = lit(vec3(0.2, 1.0, 0.42).mul(glyph(gi, f).mul(2.3).add(acty.mul(1.5)).add(0.015)));
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.44), dm); p.position.set(DX + 0.22, DY + 0.2, PZ + 0.093); root.add(p);
      bag.box(black, 0.46, 0.48, 0.012, DX + 0.22, DY + 0.2, PZ + 0.086);
    }
    { // 表示灯（2 x 7）。警報のときは PROG が黄色く点く
      const lt = dskyLampTex();
      const g = uv().mul(vec2(2, 7)), cell = floor(g), id = cell.x.add(float(6.0).sub(cell.y).mul(2.0));
      const prog = step(4.5, id).mul(step(id, 5.5));
      const on = step(0.82, hash1(id.add(3.0))).mul(0.6).add(prog.mul(alarm).mul(step(0.3, fract(uT.mul(2.5)))));
      const lm2 = lit(texture(lt, uv()).rgb.mul(mix(vec3(0.05, 0.05, 0.045), mix(vec3(1.6, 1.5, 1.2), vec3(2.2, 1.6, 0.25), prog), on.clamp(0, 1))));
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.44), lm2); p.position.set(DX - 0.26, DY + 0.2, PZ + 0.093); root.add(p);
      bag.box(black, 0.38, 0.48, 0.012, DX - 0.26, DY + 0.2, PZ + 0.086);
    }
    for (let r = 0; r < 3; r++) for (let c = 0; c < 7; c++) { if (r !== 1 && (c === 0 || c === 6)) continue; inst.key.push(xf(DX - 0.36 + c * 0.12, DY - 0.18 - r * 0.11, PZ + 0.1)); }
    { // 経過時間の時計。既定は 102:38:22（アポロ 11 号で 1202 警報が鳴った時刻）。負の値は打ち上げまでの秒読み
      this.clock = uniform(369502);
      const g = uv().mul(vec2(9, 1)), cell = floor(g), f = fract(g), t = uT.add(this.clock).abs();
      const d = [mod(t.div(360000.0), 10.0), mod(t.div(36000.0), 10.0), mod(t.div(3600.0), 10.0), null, mod(t.div(600.0), 6.0), mod(t.div(60.0), 10.0), null, mod(t.div(10.0), 6.0), mod(t, 10.0)];
      let gi = float(13.0); d.forEach((v, i) => { if (v) gi = cell.x.equal(i).select(floor(v), gi); });
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.11), lit(vec3(1.0, 0.62, 0.2).mul(glyph(gi, f).mul(2.2).add(0.012)))); p.position.set(0, PY + 0.5, PZ + 0.034); root.add(p);
      bag.box(black, 0.72, 0.15, 0.03, 0, PY + 0.5, PZ + 0.016);
    }

    // ---- 警告灯の盤（6 x 4）と主警報の灯
    { const at = annunTex();
      const g = uv().mul(vec2(6, 4)), cell = floor(g), id = cell.x.add(cell.y.mul(6.0));
      const steady = step(0.8, hash1(id.add(1.3)));
      const warn = step(0.86, hash1(id.add(8.1))).mul(alarm).mul(step(0.5, fract(uT.mul(3.0))));
      const lampC = mix(mix(vec3(0.045, 0.045, 0.04), vec3(1.9, 1.25, 0.35), steady), vec3(2.6, 0.25, 0.12), warn);
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.44), lit(texture(at, uv()).rgb.mul(lampC))); p.position.set(1.14, PY + 0.3, PZ + 0.022); root.add(p);
      bag.box(black, 0.98, 0.5, 0.02, 1.14, PY + 0.3, PZ + 0.008);
      const ma = new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.15, 0.05, 2, 0.015), lit(mix(vec3(0.16, 0.02, 0.015), vec3(3.2, 0.2, 0.1), alarm.mul(step(0.5, fract(uT.mul(3.0)))))));
      ma.position.set(0.78, PY - 0.12, PZ + 0.03); root.add(ma);
      bag.box(yellowM, 0.2, 0.2, 0.012, 0.78, PY - 0.12, PZ + 0.004);
    }

    // ---- 横の壁：窓・計器盤・手すり・配線
    const LS = layoutSide();
    const sideTex = legendTex(LS, 380, '#525960');
    this.winGlow = [];
    for (const s of [-1, 1]) {
      const S = (ss, y, off = 0) => sideM(s, ss, y, off);
      // 計器盤（窓の下）
      const pm = new THREE.MeshStandardNodeMaterial(); pm.map = sideTex; pm.roughness = 0.52; pm.metalness = 0.1;
      const plate = new THREE.Mesh(new THREE.BoxGeometry(LS.w, LS.h, 0.05), pm); plate.applyMatrix4(S(-1.3, 1.9, 0.025)); plate.receiveShadow = true; root.add(plate);
      this._emit(LS, S(-1.3, 1.9, 0.05), bag, inst, { alum, black, redM, panelDark });
      // 窓：ボルト留めの枠、奥まった外の景色、手前のガラス
      const wm = S(0, 2.25, 0);
      bag.add(winFrame, new THREE.LatheGeometry([[0.62, 0.11], [0.68, 0.11], [0.76, 0.09], [0.87, 0.05], [0.87, 0.0]].map(([r, y]) => new THREE.Vector2(r, y)), 48), xf(0, 0, 0, Math.PI / 2), wm);
      bag.add(winFrame, new THREE.CylinderGeometry(0.62, 0.62, 0.11, 48, 1, true), xf(0, 0, 0.055, Math.PI / 2), wm);
      for (let i = 0; i < 16; i++) { const a = i / 16 * 6.2832; inst.bolt.push(wm.clone().multiply(xf(Math.cos(a) * 0.79, Math.sin(a) * 0.79, 0.058))); }
      const q = uv().sub(0.5).mul(2.0);
      const view = new THREE.Mesh(new THREE.CircleGeometry(0.61, 40), lit(this.winU.mul(q.length().mul(q.length()).mul(0.35).oneMinus()).mul(this.winGain.mul(1.6).add(0.4))));
      view.applyMatrix4(wm.clone().multiply(xf(0, 0, 0.004))); root.add(view);
      const gm = new THREE.MeshStandardNodeMaterial(); gm.transparent = true; gm.depthWrite = false; gm.blending = THREE.AdditiveBlending; gm.colorNode = vec3(0); gm.roughness = 0.12; gm.metalness = 0; cap(gm, 4);
      const glass = new THREE.Mesh(new THREE.CircleGeometry(0.62, 40), gm); glass.applyMatrix4(wm.clone().multiply(xf(0, 0, 0.095))); glass.layers.set(FX_LAYER); glass.renderOrder = 6; root.add(glass);
      // 窓からあふれる光（にじみ）
      const sm = new THREE.SpriteNodeMaterial(); sm.transparent = true; sm.depthWrite = false; sm.blending = THREE.AdditiveBlending;
      const d = uv().sub(0.5).length().mul(2.0);
      sm.colorNode = this.winU; sm.opacityNode = d.oneMinus().clamp(0, 1).pow(2.4).mul(this.winGain);
      const gs = new THREE.Sprite(sm); gs.scale.setScalar(3.0); gs.position.set(s * 3.5, 2.25, 0.8); gs.layers.set(FX_LAYER); gs.renderOrder = 7; root.add(gs); this.winGlow.push(gs);
      // 手すり（窓の上）と、床に近い黄色い握り
      bag.cyl(alum, 0.03, 0.03, 1.5, 12, 0, 0, 0, 0, 0, Math.PI / 2, S(-1.2, 2.72, 0.11));
      for (const u of [-0.7, 0.7]) bag.cyl(alum, 0.022, 0.022, 0.11, 8, u, 0, -0.055, Math.PI / 2, 0, 0, S(-1.2, 2.72, 0.11));
      bag.cyl(yellowM, 0.028, 0.028, 0.7, 12, 0, 0, 0, 0, 0, Math.PI / 2, S(1.5, 0.42, 0.1));
      for (const u of [-0.32, 0.32]) bag.cyl(yellowM, 0.02, 0.02, 0.1, 8, u, 0, -0.05, Math.PI / 2, 0, 0, S(1.5, 0.42, 0.1));
      // 配線の束（天井ぎわを走って、盤の裏へ降りる）と結束バンド
      const run = (y, off, r) => bag.tube(rubber, [[-1.5, y, off], [-0.6, y + 0.02, off + 0.01], [0.4, y - 0.01, off], [1.1, y - 0.3, off + 0.02], [1.2, y - 1.2, off], [1.22, y - 1.75, off - 0.03]], r, S(0, 0, 0));
      run(3.44, 0.05, 0.03); run(3.38, 0.06, 0.02); run(3.5, 0.045, 0.016);
      for (const u of [-1.2, -0.3, 0.6]) bag.torus(alum, 0.075, 0.008, u, 3.43, 0.055, 0, Math.PI / 2, 0, S(0, 0, 0));
      // 収納袋（白い布・面ファスナーつき）と、消火器（左だけ）
      bag.rbox(beta, 0.62, 0.5, 0.2, 0.06, 0, 0, 0, 0, 0, 0, S(-1.35, 0.95, 0.1));
      bag.box(velcro, 0.5, 0.05, 0.01, 0, 0.2, 0.105, 0, 0, 0, S(-1.35, 0.95, 0.1));
      bag.box(web, 0.05, 0.56, 0.012, -0.18, 0, 0.108, 0, 0, 0, S(-1.35, 0.95, 0.1)); bag.box(web, 0.05, 0.56, 0.012, 0.18, 0, 0.108, 0, 0, 0, S(-1.35, 0.95, 0.1));
      if (s < 0) { bag.cyl(redM, 0.085, 0.085, 0.42, 16, 0, 0, 0.1, 0, 0, 0, S(-1.9, 0.36, 0)); bag.cyl(black, 0.03, 0.045, 0.1, 10, 0, 0.26, 0.1, 0, 0, 0, S(-1.9, 0.36, 0)); bag.box(alum, 0.2, 0.03, 0.02, 0, 0.05, 0.19, 0, 0, 0, S(-1.9, 0.36, 0)); }
      // 作業灯（窓の手前の上）
      bag.box(panelDark, 0.26, 0.12, 0.1, 0, 0, 0.05, 0.5, 0, 0, S(1.75, 3.2, 0));
      const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.07), lit(vec3(2.6, 2.2, 1.7))); lens.applyMatrix4(S(1.75, 3.2, 0).multiply(xf(0, -0.03, 0.105, 0.5))); root.add(lens);
    }

    // ---- 座席：鋼管の骨組み、布のクッション、ベルトと金具
    for (const x of SEATS) {
      const B = xf(x, 0, 0);
      bag.rbox(fabric, 1.1, 0.15, 1.0, 0.05, 0, 0.415, 0.1, 0, 0, 0, B);                       // 座面
      bag.rbox(fabric, 1.1, 1.56, 0.15, 0.05, 0, 1.14, -0.6, -0.2, 0, 0, B);                   // 背
      bag.rbox(fabric, 0.62, 0.3, 0.17, 0.06, 0, 2.03, -0.77, -0.2, 0, 0, B);                  // 頭あて
      for (const sx of [-0.6, 0.6]) {
        bag.cyl(frameM, 0.032, 0.032, 1.14, 10, sx, 0.33, 0.1, Math.PI / 2, 0, 0, B);            // 座面の横の管
        bag.cyl(frameM, 0.032, 0.032, 1.86, 10, sx, 1.22, -0.63, -0.2, 0, 0, B);                 // 背の横の管
        bag.cyl(frameM, 0.026, 0.026, 0.52, 8, sx * 0.9, 0.16, 0.42, 0.5, 0, 0, B);              // 床への支柱
        bag.cyl(frameM, 0.026, 0.026, 0.52, 8, sx * 0.9, 0.16, -0.2, -0.5, 0, 0, B);
        bag.cyl(rubber, 0.06, 0.07, 0.03, 10, sx * 0.9, 0.015, 0.54, 0, 0, 0, B); bag.cyl(rubber, 0.06, 0.07, 0.03, 10, sx * 0.9, 0.015, -0.32, 0, 0, 0, B);
        bag.rbox(rubber, 0.09, 0.05, 0.42, 0.02, sx * 1.02, 0.62, 0.12, 0, 0, 0, B);             // ひじ掛け
        bag.cyl(frameM, 0.018, 0.018, 0.26, 6, sx * 1.02, 0.47, 0.28, 0, 0, 0, B);
        // 腰のベルト（座面の脇から垂れる）と金具
        bag.box(web, 0.07, 0.014, 0.46, sx * 0.5, 0.497, 0.02, 0, sx * 0.25, 0, B);
        bag.box(alum, 0.1, 0.02, 0.075, sx * 0.44, 0.502, 0.25, 0, sx * 0.25, 0, B);
        bag.box(web, 0.07, 0.34, 0.014, sx * 0.565, 0.33, -0.2, 0, 0, sx * 0.12, B);
        // 肩のベルト（背の上から垂れる）
        bag.box(web, 0.065, 0.95, 0.014, sx * 0.3, 1.36, -0.566, -0.2, 0, 0, B);
        bag.box(alum, 0.085, 0.09, 0.02, sx * 0.3, 0.87, -0.468, -0.2, 0, 0, B);
      }
      bag.cyl(frameM, 0.03, 0.03, 1.2, 10, 0, 0.33, 0.66, 0, 0, Math.PI / 2, B);                // 前の横管
      bag.cyl(frameM, 0.03, 0.03, 1.2, 10, 0, 2.12, -0.82, 0, 0, Math.PI / 2, B);               // 上の横管
    }

    // ---- 手前の計器盤の背（画面の下の縁に、暗い影として入る）
    bag.box(panelDark, 7.6, 0.9, 0.4, 0, 0.42, 3.05, -0.5); bag.box(frameM, 7.8, 0.14, 0.42, 0, 0.9, 2.97);
    bag.box(rubber, 7.8, 0.05, 0.5, 0, 0.985, 2.99);                                           // ひさし
    bag.box(panelDark, 7.0, 0.5, 0.3, 0, 3.42, 1.9, 0.4);
    for (const x of [-2.6, 2.6]) { bag.cyl(alum, 0.026, 0.026, 0.5, 10, x, 1.06, 2.98, 0, 0, Math.PI / 2); for (const u of [-0.22, 0.22]) bag.cyl(alum, 0.02, 0.02, 0.07, 8, x + u, 1.03, 2.98); }
    for (const x of [-1.45, 1.45]) {                                                            // 操縦かん
      bag.cyl(rubber, 0.07, 0.085, 0.05, 14, x, 1.03, 2.93); bag.cyl(rubber, 0.05, 0.065, 0.07, 12, x, 1.075, 2.93);
      bag.cyl(panelDark, 0.022, 0.026, 0.13, 10, x, 1.15, 2.92, -0.12); bag.rbox(panelDark, 0.06, 0.09, 0.055, 0.02, x, 1.22, 2.91, -0.12);
    }
    [-0.86, -0.72, -0.58, -0.2, -0.06, 0.08, 0.5, 0.64].forEach((x, i) => { bag.box(i % 3 ? panelDark : guardM, 0.04, 0.035, 0.05, x, 1.027, 2.95); bag.cyl(frameM, 0.006, 0.009, 0.045, 6, x, 1.06, 2.94, i % 2 ? -0.3 : 0.3); });   // スイッチ（3 つずつの組。赤は覆いつき）
    bag.cyl(rubber, 0.045, 0.05, 0.03, 14, 0.95, 1.025, 2.95); bag.cyl(rubber, 0.045, 0.05, 0.03, 14, -1.1, 1.025, 2.95);                       // つまみ
    bag.cyl(beta, 0.07, 0.07, 0.6, 14, 2.05, 1.08, 2.95, 0, 0.2, Math.PI / 2); bag.torus(velcro, 0.073, 0.012, 2.05, 1.08, 2.95, 0, Math.PI / 2 + 0.2, 0);   // 丸めた手順書
    bag.rbox(panelDark, 0.5, 0.05, 0.34, 0.015, -2.05, 1.035, 2.93, 0, -0.15, 0);   // ひざ板（紙は上でカードとして置く）

    // ---- 天井ぎわの作業灯（奥の壁の上）
    for (const x of [-2.2, 2.2]) {
      bag.box(panelDark, 0.5, 0.1, 0.16, x, 3.52, BACK_Z + 0.22, 0.35);
      const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.1), lit(vec3(2.8, 2.4, 1.9))); lens.position.set(x, 3.468, BACK_Z + 0.24); lens.rotation.x = Math.PI / 2 - 0.35; root.add(lens);
    }

    // ---- まとめて形にする
    bag.build(root, noCast);
    const metalS = flat(0xc8ccd2, 0.3, 0.9), keyM = flat(0x454a52, 0.5);
    const cylZ = (r, h, seg = 8) => { const g = new THREE.CylinderGeometry(r, r, h, seg); g.rotateX(Math.PI / 2); return g; };
    instanced(root, cylZ(0.016, 0.012, 6), metalS, inst.toggleBase);
    { const g = new THREE.CylinderGeometry(0.0055, 0.009, 0.05, 6); g.rotateX(Math.PI / 2); g.translate(0, 0, 0.03); instanced(root, g, metalS, inst.lever); }
    instanced(root, cylZ(0.019, 0.03, 10), flat(0x0b0b0c, 0.45), inst.breaker);
    instanced(root, cylZ(0.011, 0.006, 6), flat(0x8f959c, 0.4, 0.8), inst.screw);
    instanced(root, new RoundedBoxGeometry(0.095, 0.085, 0.03, 1, 0.012), keyM, inst.key);
    instanced(root, cylZ(0.022, 0.02, 6), flat(0x8f959c, 0.4, 0.8), inst.bolt);

    // ---- 表示灯（どれも盤の上の決まった場所にある）。色：0 = 橙、1 = 緑、2 = 青、3 = 白（数字窓）
    {
      const n = this._lamps.length, P = new Float32Array(n * 4), rnd = mulberry(11);
      const a = iattr(P);
      const pal = mix(mix(color(0xffab35), color(0x53e07c), step(0.5, a.x)), mix(color(0x5ab8ff), color(0xf2efe6), step(2.5, a.x)), step(1.5, a.x));
      const blink = step(fract(uT.mul(a.y).add(a.x.mul(7.3)).add(a.z.mul(13.0))), a.z).mul(0.92).add(0.08);
      const red = color(0xff2a1a).mul(step(0.5, fract(uT.mul(3.0))).mul(2.6).add(0.15));
      const lm = lit(mix(pal.mul(blink).mul(1.9), red, alarm.mul(a.w)));
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 0.02), lm, n);
      this._lamps.forEach((L, i) => { im.setMatrixAt(i, L.m); P.set([L.kind, L.kind === 2 ? 0.6 + rnd() * 1.4 : 0.05 + rnd() * 0.1, L.kind === 2 ? 0.5 : 0.97 - rnd() * 0.25, L.warn], i * 4); });
      im.instanceMatrix.needsUpdate = true; im.frustumCulled = false; im.castShadow = false; root.add(im);
    }
    // ---- 丸い計器：文字盤は一覧の canvas から、針は時刻で振れる
    {
      const n = this._gauges.length, G = new Float32Array(n * 4), ga = gaugeAtlas();
      const a = iattr(G), p = uv().sub(0.5);
      const face = texture(ga, vec2(a.x.add(uv().x).div(4.0), float(3.0).sub(a.y).add(uv().y).div(4.0))).rgb;
      const ang = sin(uT.mul(a.z.mul(0.6).add(0.35)).add(a.z.mul(40.0))).mul(0.5).add(a.w).add(sin(uT.mul(31.0).add(a.z.mul(9.0))).mul(alarm).mul(0.25)).mul(1.5);
      const dir = vec2(sin(ang), ang.cos());
      const along = dot(p, dir), perp = abs(p.x.mul(dir.y).sub(p.y.mul(dir.x)));
      const needle = smoothstep(0.012, 0.022, perp).oneMinus().mul(step(-0.07, along)).mul(step(along, 0.37));
      const gm = lit(mix(face.mul(0.85), vec3(1.5, 0.75, 0.25), needle));
      const im = new THREE.InstancedMesh(new THREE.CircleGeometry(0.5, 28), gm, n);
      const rnd = mulberry(23);
      this._gauges.forEach((g, i) => { im.setMatrixAt(i, g.m); G.set([g.cell % 4, Math.floor(g.cell / 4), 0.2 + rnd(), (rnd() - 0.5) * 0.9], i * 4); });
      im.instanceMatrix.needsUpdate = true; im.frustumCulled = false; im.castShadow = false; root.add(im);
    }

    // ---- 灯り：奥の壁の上の作業灯 2 つ（後ろ上からの輪郭の光）、窓の光 2 つ（横からの色つきの光）、警報の赤、窓から差す太陽の光（影つき）
    const sp = (hex, from, to, angle, pen, decay) => { const l = new THREE.SpotLight(hex, 0, 14, angle, pen, decay); l.position.set(...from); l.target.position.set(...to); root.add(l, l.target); return l; };
    this.floods = [sp(0xffe2c2, [-2.2, 3.4, -1.05], [-1.3, 0.9, 0.95], 0.78, 0.8, 2), sp(0xffe2c2, [2.2, 3.4, -1.05], [1.3, 0.9, 0.95], 0.78, 0.8, 2)];
    this.winLights = [sp(0xffffff, [-3.55, 2.25, 0.82], [0, 1.2, 0.2], 1.05, 0.85, 1), sp(0xffffff, [3.55, 2.25, 0.82], [0, 1.2, 0.2], 1.05, 0.85, 1)];
    this.alarmLight = new THREE.PointLight(0xff2414, 0, 7, 2); this.alarmLight.position.set(0.78, 2.7, -0.25); root.add(this.alarmLight);
    const beam = (this.beam = new THREE.SpotLight(0xfff3e2, 0, 30, 0.07, 0.35, 0));
    this.beamDir = new THREE.Vector3(1.0, -0.4, -0.2).normalize();
    this.beamFrom = new THREE.Vector3(-3.72, 2.25, 0.8);
    beam.position.copy(this.beamFrom).addScaledVector(this.beamDir, -11); beam.target.position.copy(this.beamFrom).addScaledVector(this.beamDir, 6);
    beam.castShadow = true; beam.shadow.mapSize.set(1024, 1024); beam.shadow.camera.near = 8; beam.shadow.camera.far = 22; beam.shadow.bias = -0.0006;
    root.add(beam, beam.target);
    // 光の筋（窓から斜めに差す光の柱）：見る向きに対して厚みのある所ほど明るい
    {
      const m = new THREE.MeshBasicNodeMaterial(); m.transparent = true; m.depthWrite = false; m.blending = THREE.AdditiveBlending; m.side = THREE.FrontSide; m.fog = false;
      this.beamK = uniform(0);
      const ndv = normalView.dot(positionViewDirection).abs();
      const along = uv().y.oneMinus();                         // 0 = 窓、1 = 先
      const dust = mx_noise_float(positionWorld.mul(vec3(2.2, 2.2, 2.2)).add(vec3(uT.mul(0.05), uT.mul(-0.03), 0))).mul(0.3).add(0.8);
      m.colorNode = vec3(1.0, 0.93, 0.82);
      m.opacityNode = ndv.pow(1.4).mul(smoothstep(0.0, 0.05, along)).mul(along.mul(0.7).oneMinus()).mul(dust).mul(this.beamK).mul(0.17);
      const g = new THREE.CylinderGeometry(0.62, 1.05, 7.2, 40, 1, true); g.translate(0, -3.6, 0);    // 上（y=0）が窓、下へ伸びる
      const shaft = (this.shaft = new THREE.Mesh(g, m));
      shaft.position.copy(this.beamFrom); shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), this.beamDir);
      shaft.layers.set(FX_LAYER); shaft.renderOrder = 8; shaft.castShadow = false; root.add(shaft);
      // 光の中に浮くちり
      const N = 260, P = new Float32Array(N * 4), rnd = mulberry(77), a = iattr(P);
      for (let i = 0; i < N; i++) P.set([(rnd() - 0.5) * 1.5, -rnd() * 6.2, (rnd() - 0.5) * 1.5, rnd()], i * 4);
      const dm = new THREE.MeshBasicNodeMaterial(); dm.transparent = true; dm.depthWrite = false; dm.blending = THREE.AdditiveBlending;
      const drift = vec3(sin(uT.mul(0.21).add(a.w.mul(40.0))), sin(uT.mul(0.17).add(a.w.mul(71.0))).mul(0.6), sin(uT.mul(0.19).add(a.w.mul(23.0)))).mul(0.16);
      const base = a.xyz.add(drift);
      const inBeam = smoothstep(0.45, 0.68, base.xz.length().sub(base.y.negate().mul(0.036))).oneMinus();
      dm.positionNode = positionLocal.add(base);
      dm.colorNode = vec3(1.0, 0.95, 0.85).mul(inBeam).mul(this.beamK).mul(sin(uT.mul(a.w.mul(2.0).add(0.6)).add(a.w.mul(90.0))).mul(0.4).add(0.75)).mul(1.9);
      const motes = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.0085, 0), dm, N);
      motes.position.copy(this.beamFrom); motes.quaternion.copy(shaft.quaternion); motes.frustumCulled = false; motes.castShadow = false; motes.layers.set(FX_LAYER); motes.renderOrder = 9; root.add(motes);
    }

    // ---- 映り込み用の小さな環境（暗い船内に、作業灯と窓と計器の灯り）。ヘルメットや金属に映る
    this.env = (() => {
      const W = 128, H = 64, d = new Uint16Array(W * H * 4), hf = THREE.DataUtils.toHalfFloat;
      const blob = (u0, v0, su, sv, r, g, b) => (u, v) => { let du = Math.abs(u - u0); du = Math.min(du, 1 - du); const k = Math.exp(-(du * du) / (su * su) - ((v - v0) ** 2) / (sv * sv)); return [r * k, g * k, b * k]; };
      const srcs = [blob(0.66, 0.74, 0.03, 0.03, 20, 17, 13), blob(0.84, 0.74, 0.03, 0.03, 20, 17, 13), blob(0.0, 0.6, 0.035, 0.07, 8, 10, 13), blob(0.5, 0.6, 0.035, 0.07, 8, 10, 13), blob(0.25, 0.63, 0.14, 0.05, 0.9, 0.75, 0.5), blob(0.75, 0.36, 0.16, 0.08, 0.3, 0.26, 0.22)];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const u = (x + 0.5) / W, v = (y + 0.5) / H; let r = 0.03, g = 0.034, b = 0.042;
        for (const s of srcs) { const c = s(u, v); r += c[0]; g += c[1]; b += c[2]; }
        const o = (y * W + x) * 4; d[o] = hf(r); d[o + 1] = hf(g); d[o + 2] = hf(b); d[o + 3] = hf(1);
      }
      const t = new THREE.DataTexture(d, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
      t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.LinearSRGBColorSpace; t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
      return t;
    })();
    this._glow = 0.5; this._sun = 0;
    this.reset();
  }

  /** 割り付けどおりに、盤の上の立体の部品を置く（M = 盤の座標 → 船内） */
  _emit(L, M, bag, inst, mt) {
    const at = (x, y, z, rx = 0, ry = 0, rz = 0) => M.clone().multiply(xf(x, y, z, rx, ry, rz));
    for (const [x, y, up] of L.toggles) { inst.toggleBase.push(at(x, y, 0.006)); inst.lever.push(at(x, y, 0.008, -up * 0.42)); }
    for (const [x, y] of L.guards) { bag.box(mt.redM, 0.05, 0.075, 0.05, x, y + 0.012, 0.03, 0, 0, 0, M); }
    for (const [x, y] of L.breakers) inst.breaker.push(at(x, y, 0.015));
    for (const [x, y] of L.screws) inst.screw.push(at(x, y, 0.003));
    for (const [x, y, r] of L.knobs) { bag.cyl(mt.black, r * 0.86, r, 0.04, 16, x, y, 0.02, Math.PI / 2, 0, 0, M); bag.box(mt.alum, 0.008, r * 0.9, 0.006, x, y + r * 0.45, 0.043, 0, 0, 0, M); }
    for (const [x, y, w, h, kind, warn] of L.lamps) this._lamps.push({ m: at(x, y, 0.012).scale(new THREE.Vector3(w, h, 1)), kind, warn });
    for (const [x, y, r, cell] of L.gauges) { this._gauges.push({ m: at(x, y, 0.012).scale(new THREE.Vector3(r * 2, r * 2, 1)), cell }); bag.torus(mt.black, r, 0.014, x, y, 0.012, 0, 0, 0, M); }
  }

  reset() {
    this.root.visible = false; this.root.position.set(0, 0, 0); this.root.rotation.set(0, 0, 0);
    this.alarm.value = 0; this._sun = 0; this.clock.value = 369502; this.window(0.4, 0.7, 1.0, 0.5);
  }
  /** 窓の外の色と明るさ */
  window(r, g, b, glowAmt = 0.5) { this.winU.value.setRGB(r, g, b); this.winGain.value = glowAmt; this._glow = glowAmt; return this; }
  /** 時計の時刻（秒）。負の値は打ち上げ前の秒読みとして、0 へ向かって減っていく */
  time(sec) { this.clock.value = sec; return this; }
  /** 窓から斜めに差し込む太陽の光（0 = なし、1 = 強い） */
  sunbeam(k = 1) { this._sun = k; return this; }

  /** コマの最後：灯りの強さ、計器の動き、映り込みの環境 */
  finish() {
    const T = this.uT.value, al = this.alarm.value, w = this.winU.value, g = this._glow;
    const flick = 1 - 0.5 * al;
    for (const l of this.floods) l.intensity = 17 * flick;
    for (const l of this.winLights) { l.color.setRGB(w.r, w.g, w.b); l.intensity = 11 * g; }
    this.alarmLight.intensity = al ? 7 * (0.25 + 0.75 * ((T * 3) % 1 > 0.5 ? 1 : 0)) : 0;
    this.beam.intensity = this._sun * 4.2; this.beamK.value = this._sun;
    this.fdai.rotation.set(0.3 * Math.sin(T * 0.31) + al * 0.05 * Math.sin(T * 37), 0.6 + T * 0.06, 0.18 * Math.sin(T * 0.23) + al * 0.05 * Math.sin(T * 41));
    const scene = this.root.parent;
    if (scene && scene.isScene) { scene.environment = this.env; scene.environmentIntensity = 1.0; }
  }
}
