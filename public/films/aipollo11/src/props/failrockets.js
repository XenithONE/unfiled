// 試行錯誤で作られる 4 つの失敗作ロケット（形とギャグはそのまま、材質を実物に）
import * as THREE from 'three/webgpu';
import { texture, uv, uniform, mix, float, step, vec2, vec3, positionLocal, normalLocal, normalView, abs, fract, sin, smoothstep, normalize, bumpMap, mx_noise_float, mx_fractal_noise_float } from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mat, grp, canvasTex, beamGeo } from '../core/kit.js';
import { Flame, glowSprite } from '../fx/fx.js';
import { pixText } from '../core/pixfont.js';
import { mulberry } from '../core/util.js';
import { xf, atAz, rod, hoop, rAt, latheOf, crinkle, partMaterial } from './saturn_parts.js';
import { Bag2, quadGeo, tube, foilMaterial, plateMaterial, woodMaterial, fabricMaterial, bubbleMaterial, paperNodes, tilt } from './mats.js';

const HP = Math.PI / 2, TAU = Math.PI * 2;
const PAINT = { white: 0xe2e2dc, blue: 0x3d5cd0, red: 0xbf3a2b, orange: 0xd97757, yellow: 0xe9b92a, black: 0x1b1c20, gray: 0x8a9099 };
const STEEL = [0xa9aeb6, 0.42, 0.85], DARKM = [0x34363b, 0.5, 0.75], RUBBER = [0x161617, 0.9, 0.0], BELL = [0x4a4540, 0.5, 0.85], TAPE = [0x9aa0a6, 0.55, 0.7];
const FONT = '"Arial Black", "Helvetica Neue", Arial, "Segoe UI", sans-serif';

/** エンジンの釣鐘（外側・すすけた内側・補強の輪） */
function bellInto(b, prof, x = 0, y = 0, z = 0, seg = 24, bands = 3) {
  const tr = (g) => g.translate(x, y, z);
  b.add(tr(latheOf(prof, seg)), ...BELL); b.add(tr(latheOf(prof, seg, -0.01)), 0x0f0d0c, 0.85, 0.2);
  const y0 = prof[0][1], y1 = prof[prof.length - 1][1];
  for (let i = 0; i < bands; i++) { const yy = y0 + (y1 - y0) * (0.02 + (i / bands) * 0.9); b.add(tr(hoop(rAt(prof, yy) + 0.005, yy, i === 0 ? 0.012 : 0.008, seg, 5)), 0x38342f, 0.5, 0.85); }
}
/** ボルトの頭を輪に並べる */
function boltsInto(b, n, r, y, s = 0.03, c = DARKM) { for (let i = 0; i < n; i++) b.add(atAz(xf(new THREE.CylinderGeometry(s, s, s * 0.7, 6), { r: [HP, 0, 0] }), (i / n) * TAU, r, y), ...c); }
const glassM = () => mat(0x15324f, { rough: 0.08, metal: 0.2, emissive: 0x2a6fb5, ei: 0.12 });

/** ① GPT の「0.3 秒で完成」ロケット：部品の付け方がでたらめ（廃材の鉄板・リベット・さび・テープ） */
export class JunkRocket {
  constructor() {
    const root = (this.root = grp());
    const parts = (this.parts = []);
    const add = (name, obj, x, y, z, rx = 0, ry = 0, rz = 0) => { obj.position.set(x, y, z); obj.rotation.set(rx, ry, rz); obj.userData.home = { p: [x, y, z], r: [rx, ry, rz] }; obj.userData.name = name; root.add(obj); parts.push(obj); return obj; };
    const PCYL = plateMaterial({ rust: 0.45, G: 0.6, mode: 'cyl', nV: 6 }), PBOX = plateMaterial({ rust: 0.5, G: 0.42, mode: 'box' }), PART = partMaterial(), FOIL = foilMaterial(11, 0.26);
    // 胴（つぎはぎ）
    {
      const b = new Bag2(), t = new Bag2(), s = new Bag2();
      const seg = (r, y0, y1, hex) => b.add(new THREE.CylinderGeometry(r, r, y1 - y0, 40, 1, true).translate(0, (y0 + y1) / 2, 0), hex, 0.5, 0.1);
      seg(0.75, -1.7, 0.25, PAINT.white); seg(0.753, 0.25, 0.95, PAINT.blue); seg(0.75, 0.95, 1.7, PAINT.white);
      b.add(new THREE.CircleGeometry(0.75, 40).rotateX(-HP).translate(0, 1.7, 0), PAINT.white, 0.5, 0.1);
      b.add(new THREE.CircleGeometry(0.75, 40).rotateX(HP).translate(0, -1.7, 0), 0x55585e, 0.5, 0.6);
      const patch = (th, y, w, h, hex) => b.add(new THREE.CylinderGeometry(0.762, 0.762, h, 8, 1, true, th - w / 2, w).translate(0, y, 0), hex, 0.5, 0.2);
      patch(2.2, -0.9, 0.9, 0.7, 0x8b8f96); patch(-1.2, 1.2, 0.7, 0.5, 0x7a4a32); patch(3.6, 0.1, 0.6, 0.9, PAINT.yellow); patch(1.1, 1.25, 0.5, 0.4, 0x8b8f96);
      const tape = (th, y, w, h) => t.faces(crinkle(new THREE.CylinderGeometry(0.769, 0.769, h, 10, 3, true, th - w / 2, w).translate(0, y, 0), 0.006), () => TAPE);
      tape(0.27, -0.8, 0.68, 0.6); tape(-0.33, 1.2, 0.95, 0.16); tape(-0.33, 1.2, 0.2, 0.7); tape(2.2, -0.52, 1.0, 0.12); tape(1.6, 0.6, 0.16, 0.9);
      for (const yy of [0.25, 0.95, -1.68, 1.68]) s.add(hoop(0.756, yy, 0.012, 40, 5), 0x4a4d52, 0.6, 0.7);
      this.body = add('body', grp(b.mesh(PCYL), t.mesh(FOIL, { cast: false }), s.mesh(PART)), 0, 2.9, 0);
    }
    // エンジン（ひろってきた釣鐘に、配管をむりやり）
    {
      const b = new Bag2();
      bellInto(b, [[0.55, 0], [0.5, 0.12], [0.42, 0.3], [0.36, 0.45], [0.3, 0.7]], 0, 0, 0, 28, 4);
      b.add(latheOf([[0.6, 0.7], [0.6, 0.79], [0.45, 1.0]], 20), ...STEEL);
      boltsInto(b, 10, 0.605, 0.745, 0.03);
      b.add(xf(new THREE.CylinderGeometry(0.11, 0.11, 0.3, 12), { r: [0, 0, 0.3], p: [0.4, 0.52, 0.08] }), ...STEEL);
      b.add(rod([0.4, 0.66, 0.08], [0.2, 0.74, 0.3], 0.03, 6), 0xb07a3a, 0.4, 0.9);
      b.add(rod([0.4, 0.38, 0.08], [0.5, 0.14, -0.1], 0.03, 6), 0xb07a3a, 0.4, 0.9);
      b.add(rod([-0.3, 0.72, -0.3], [-0.46, 0.2, -0.22], 0.022, 6), ...DARKM);
      this.engine = add('engine', grp(b.mesh(PART)), 0, 0.5, 0);
    }
    // 先端が横に付いている
    {
      const b = new Bag2(), s = new Bag2();
      b.add(crinkle(new THREE.ConeGeometry(0.6, 1.5, 28, 5, true), 0.012), PAINT.red, 0.5, 0.1);
      b.add(new THREE.CircleGeometry(0.6, 28).rotateX(HP).translate(0, -0.75, 0), 0x6a6d72, 0.5, 0.6);
      s.add(hoop(0.61, -0.74, 0.028, 28, 6), ...STEEL); boltsInto(s, 8, 0.61, -0.7, 0.028);
      this.noseSide = add('noseSide', grp(b.mesh(PCYL), s.mesh(PART)), 1.45, 3.9, 0, 0, 0, -HP);
    }
    // てっぺんには、なぜか羽（曲がった鉄板）
    const fin = (w, h, d) => { const b = new Bag2(); b.add(crinkle(new THREE.BoxGeometry(w, h, d, w > d ? 4 : 1, 4, w > d ? 1 : 4), 0.014), PAINT.red, 0.5, 0.15); return grp(b.mesh(PBOX)); };
    this.finTop1 = add('finTop1', fin(0.05, 1.1, 0.8), -0.35, 5.1, 0, 0, 0, 0.3);
    this.finTop2 = add('finTop2', fin(0.05, 1.0, 0.7), 0.35, 5.05, 0, 0, 0.6, -0.3);
    this.finLow = add('finLow', fin(0.9, 1.0, 0.05), -1.1, 1.6, 0, 0, 0, 0.5);
    // さかさまの矢印のステッカーと、舷窓
    const arrowT = canvasTex(128, 128, (ctx) => { ctx.fillStyle = '#f4f1e6'; ctx.fillRect(0, 0, 128, 128); ctx.strokeStyle = '#c23a2a'; ctx.lineWidth = 10; ctx.strokeRect(5, 5, 118, 118); pixText(ctx, 'UP', 64, 14, 7, '#c23a2a', { align: 'center' }); ctx.fillStyle = '#c23a2a'; ctx.beginPath(); ctx.moveTo(64, 118); ctx.lineTo(28, 80); ctx.lineTo(50, 80); ctx.lineTo(50, 62); ctx.lineTo(78, 62); ctx.lineTo(78, 80); ctx.lineTo(100, 80); ctx.closePath(); ctx.fill(); });
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshStandardNodeMaterial({ map: arrowT, roughness: 0.55 }));
    this.label = add('label', label, -0.3, 3.5, 0.772, 0, -0.38, 0);
    {
      const b = new Bag2();
      b.add(new THREE.TorusGeometry(0.27, 0.06, 8, 28), ...STEEL);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; b.add(xf(new THREE.CylinderGeometry(0.028, 0.028, 0.03, 6), { r: [HP, 0, 0], p: [Math.cos(a) * 0.27, Math.sin(a) * 0.27, 0.058] }), ...DARKM); }
      const g = new THREE.Mesh(new THREE.CircleGeometry(0.23, 24), glassM()); g.position.z = 0.02;
      this.window = add('window', grp(b.mesh(PART), g), 0.28, 2.15, 0.76, 0, 0.36, 0);
    }
    // 衛星放送の皿（へこんでいる）
    {
      const b = new Bag2();
      b.add(crinkle(latheOf([[0.02, 0], [0.3, 0.08], [0.45, 0.24]], 20), 0.012), 0xd6d3c9, 0.55, 0.1);
      b.add(rod([0, 0.01, 0], [0, 0.34, 0], 0.014, 5), ...DARKM); b.add(xf(new THREE.CylinderGeometry(0.035, 0.03, 0.08, 8), { p: [0, 0.36, 0] }), ...DARKM);
      for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU; b.add(rod([Math.cos(a) * 0.4, 0.2, Math.sin(a) * 0.4], [0, 0.34, 0], 0.008, 4), ...DARKM); }
      this.dish = add('dish', grp(b.mesh(PART)), -0.86, 4.2, 0.1, 0, 0, 1.1);
    }
    // 脚（さびた山形鋼）
    {
      const b = new Bag2();
      for (const [a, c] of [[[0.5, 0.9, 0.5], [1.0, -0.5, 1.0]], [[-0.5, 0.9, 0.5], [-1.0, -0.5, 1.0]], [[0, 0.9, -0.6], [0, -0.5, -1.25]]]) {
        b.add(beamGeo(a, c, 0.1, 0.03), 0x8a8d92, 0.55, 0.5); b.add(beamGeo([a[0] + 0.03, a[1], a[2] + 0.03], [c[0] + 0.03, c[1], c[2] + 0.03], 0.03, 0.1), 0x8a8d92, 0.55, 0.5);
        b.add(xf(new THREE.BoxGeometry(0.3, 0.035, 0.3), { p: [c[0], c[1] + 0.02, c[2]] }), 0x8a8d92, 0.55, 0.5);
      }
      b.add(beamGeo([0.75, 0.2, 0.75], [-0.75, 0.2, 0.75], 0.05, 0.02), 0x8a8d92, 0.55, 0.5);
      b.add(beamGeo([0.75, 0.2, 0.75], [0, 0.2, -0.92], 0.05, 0.02), 0x8a8d92, 0.55, 0.5);
      this.legs = add('legs', grp(b.mesh(plateMaterial({ rust: 0.7, G: 0.5, mode: 'box', rivets: false }))), 0, 0.5, 0);
    }
    this.flame = new Flame(0.5, 4.2, {}); this.flame.root.position.y = 0.02; this.engine.add(this.flame.root);
    this.reset();
  }
  reset() {
    this.root.visible = false; this.root.position.set(0, 0, 0); this.root.rotation.set(0, 0, 0);
    for (const p of this.parts) { const h = p.userData.home; p.position.set(...h.p); p.rotation.set(...h.r); p.scale.setScalar(1); p.visible = true; }
    this.flame.set(0, 0);
  }
}

/** ② Grok の「エンジン 27 基」ロケット（サターンと同じ作りのエンジンを、帯と配管でむりやり束ねる） */
export class BoosterRocket {
  constructor() {
    const root = (this.root = grp());
    const PCYL = plateMaterial({ rust: 0.1, G: 0.5, mode: 'cyl', nV: 6 }), PART = partMaterial();
    // 芯
    {
      const b = new Bag2(), s = new Bag2();
      b.add(new THREE.CylinderGeometry(0.62, 0.62, 3.9, 40, 1, true).translate(0, 2.95, 0), PAINT.black, 0.42, 0.3);
      b.add(new THREE.CylinderGeometry(0.623, 0.623, 0.25, 40, 1, true).translate(0, 4.9, 0), PAINT.white, 0.5, 0.1);
      b.add(new THREE.CylinderGeometry(0.62, 0.62, 0.58, 40, 1, true).translate(0, 5.31, 0), PAINT.black, 0.42, 0.3);
      b.add(new THREE.ConeGeometry(0.62, 1.3, 40, 4, true).translate(0, 6.25, 0), PAINT.red, 0.48, 0.1);
      bellInto(s, [[0.5, 0.2], [0.44, 0.4], [0.34, 0.7], [0.28, 1.0]], 0, 0, 0, 24, 3);
      for (const yy of [1.02, 4.77, 5.03, 5.6]) s.add(hoop(0.628, yy, 0.014, 40, 5), ...STEEL);
      // 推進剤を配る輪と、ブースターへの枝管
      s.add(hoop(0.76, 1.35, 0.045, 32, 7), 0xb07a3a, 0.4, 0.9);
      for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU; s.add(rod([Math.sin(a) * 0.76, 1.35, Math.cos(a) * 0.76], [Math.sin(a) * 0.95, 1.12, Math.cos(a) * 0.95], 0.025, 5), 0xb07a3a, 0.4, 0.9); }
      root.add(b.mesh(PCYL), s.mesh(PART));
    }
    // ブースター 27 本（太さごとに形を使い回す）
    this.boosters = [];
    const rnd = mulberry(27);
    const geoCache = {};
    const make = (r, h, white) => {
      const key = `${r}|${h}|${white}`;
      if (geoCache[key]) return geoCache[key];
      const b = new Bag2(), s = new Bag2();
      b.add(new THREE.CylinderGeometry(r, r, h, 20, 1, true).translate(0, h / 2, 0), white ? PAINT.white : PAINT.gray, 0.5, white ? 0.1 : 0.4);
      b.add(new THREE.ConeGeometry(r, r * 2.4, 20, 2, true).translate(0, h + r * 1.2, 0), PAINT.red, 0.48, 0.1);
      b.add(new THREE.CircleGeometry(r, 20).rotateX(HP), 0x4a4d52, 0.6, 0.6);
      bellInto(s, [[r * 0.92, -0.3], [r * 0.8, -0.2], [r * 0.6, -0.08], [r * 0.48, 0.0]], 0, 0, 0, 14, 2);
      s.add(hoop(r * 0.72, -0.13, r * 0.14, 12, 5), 0xc3c6cb, 0.46, 1.0);                      // 排気の環
      for (const yy of [h * 0.25, h * 0.7]) { s.add(hoop(r + 0.006, yy, 0.016, 20, 5), ...STEEL); s.add(xf(new THREE.BoxGeometry(0.07, 0.12, r * 0.9), { p: [0, yy, -r * 1.25] }), ...DARKM); }
      s.add(rod([r * 0.7, 0.02, -r * 0.7], [r * 0.75, h * 0.55, -r * 0.75], 0.018, 5), 0xb07a3a, 0.4, 0.9);  // 燃料の管
      s.add(hoop(r + 0.004, h, 0.012, 20, 5), ...STEEL);
      return (geoCache[key] = [b.mesh(PCYL).geometry, s.mesh(PART).geometry]);
    };
    const ring = (n, rad, h, r, y0, a0) => {
      for (let i = 0; i < n; i++) {
        const a = a0 + (i / n) * TAU;
        const [g1, g2] = make(r, h, i % 2 === 1);
        const m1 = new THREE.Mesh(g1, PCYL), m2 = new THREE.Mesh(g2, PART);
        for (const m of [m1, m2]) { m.castShadow = true; m.receiveShadow = true; }
        const b = grp(m1, m2);
        b.position.set(Math.sin(a) * rad, y0, Math.cos(a) * rad);
        b.rotation.set((rnd() - 0.5) * 0.12, a, (rnd() - 0.5) * 0.12);
        b.userData.a = a; b.userData.rad = rad;
        root.add(b); this.boosters.push(b);
      }
    };
    ring(9, 0.95, 3.0, 0.28, 1.0, 0);
    ring(10, 1.5, 2.3, 0.24, 0.8, 0.3);
    ring(8, 1.98, 1.7, 0.2, 0.7, 0.1);
    this.flames = [];
    const big = new Flame(1.9, 9, { gain: 1.2, bulge: 0.5 }); big.root.position.y = 0.6; root.add(big.root); this.flames.push(big);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const f = new Flame(0.5, 5.5, { gain: 1.0 }); f.root.position.set(Math.sin(a) * 1.5, 0.6, Math.cos(a) * 1.5); root.add(f.root); this.flames.push(f); }
    this.glow = glowSprite(0xffa850, 14, { gain: 0, pow: 2.0 }); this.glow.position.y = -1; root.add(this.glow);
    this.reset();
  }
  reset() {
    this.root.visible = false; this.root.position.set(0, 0, 0); this.root.rotation.set(0, 0, 0); this.root.scale.setScalar(1);
    for (const b of this.boosters) { b.visible = true; b.scale.setScalar(1); }
    for (const f of this.flames) f.set(0, 0); this.glow.visible = false;
  }
  /** 付いているブースターの数（0..27）。k は最後の 1 本の出かた */
  count(n, k = 1) { this.boosters.forEach((b, i) => { b.visible = i < n; b.scale.setScalar(i === n - 1 ? k : 1); }); return this; }
  fire(T, p = 1, len = 1) { this.flames.forEach((f, i) => f.set(T + i * 0.37, p, len)); this.glow.visible = p > 0.01; this.glow.userData.gain.value = p * 0.6; return this; }
}

/** ③ Gemini の「とても美しいロケット」：じつはベニヤ板に描いた絵（立て看板） */
export class PictureRocket {
  constructor() {
    const root = (this.root = grp());
    const cx = 256;
    const path = (ctx) => {
      ctx.beginPath();
      ctx.moveTo(cx, 40); ctx.bezierCurveTo(cx + 150, 200, cx + 130, 420, cx + 118, 760);
      ctx.lineTo(cx + 215, 930); ctx.lineTo(cx + 104, 880); ctx.lineTo(cx + 70, 960); ctx.lineTo(cx - 70, 960); ctx.lineTo(cx - 104, 880); ctx.lineTo(cx - 215, 930); ctx.lineTo(cx - 118, 760);
      ctx.bezierCurveTo(cx - 130, 420, cx - 150, 200, cx, 40); ctx.closePath();
    };
    const rnd = mulberry(303);
    let bumpCanvas = null;
    const tex = canvasTex(512, 1024, (ctx) => {
      ctx.fillStyle = '#f3efe4'; ctx.fillRect(0, 0, 512, 1024);     // 下塗りの白（板の縁まで）
      ctx.lineJoin = 'round';
      ctx.save(); path(ctx); ctx.clip();
      const g = ctx.createLinearGradient(110, 0, 400, 0);
      g.addColorStop(0, '#c2cde4'); g.addColorStop(0.3, '#fbfaf5'); g.addColorStop(0.62, '#eef1f7'); g.addColorStop(1, '#98a9ca');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 1024);
      for (const [c, y] of [['#e8463f', 300], ['#f3bd1e', 346], ['#2fae58', 392], ['#2f76ea', 438]]) { ctx.fillStyle = c; ctx.fillRect(0, y, 512, 40); }
      const ng = ctx.createLinearGradient(0, 40, 0, 250); ng.addColorStop(0, '#f2564f'); ng.addColorStop(1, '#f59649');
      ctx.fillStyle = ng; ctx.beginPath(); ctx.moveTo(cx, 30); ctx.bezierCurveTo(cx + 120, 150, cx + 132, 210, cx + 136, 250); ctx.lineTo(cx - 136, 250); ctx.bezierCurveTo(cx - 132, 210, cx - 120, 150, cx, 30); ctx.fill();
      ctx.fillStyle = '#2f76ea'; ctx.fillRect(0, 740, 150, 240); ctx.fillRect(362, 740, 150, 240);
      const sh = ctx.createLinearGradient(110, 0, 400, 0); sh.addColorStop(0, 'rgba(20,30,70,0.28)'); sh.addColorStop(0.25, 'rgba(255,255,255,0.0)'); sh.addColorStop(0.55, 'rgba(255,255,255,0.0)'); sh.addColorStop(1, 'rgba(20,30,70,0.42)');
      ctx.fillStyle = sh; ctx.fillRect(0, 0, 512, 1024);
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.ellipse(205, 420, 16, 250, 0.03, 0, 7); ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#d8dfec'; ctx.beginPath(); ctx.arc(cx, 560, 62, 0, 7); ctx.fill();
      const wg = ctx.createRadialGradient(cx - 14, 545, 6, cx, 560, 50); wg.addColorStop(0, '#b6dcf7'); wg.addColorStop(1, '#2a69c6');
      ctx.fillStyle = wg; ctx.beginPath(); ctx.arc(cx, 560, 46, 0, 7); ctx.fill();
      // 筆あと：下の色を拾って、少し明暗をずらした短い線を重ねる。盛り上がりは別の板（凹凸用）へ
      const src = ctx.getImageData(0, 0, 512, 1024).data;
      bumpCanvas = document.createElement('canvas'); bumpCanvas.width = 512; bumpCanvas.height = 1024;
      const bc = bumpCanvas.getContext('2d'); bc.fillStyle = '#808080'; bc.fillRect(0, 0, 512, 1024);
      ctx.lineCap = 'round'; bc.lineCap = 'round';
      for (let i = 0; i < 9000; i++) {
        const x = rnd() * 512, y = rnd() * 1024, k = (Math.floor(y) * 512 + Math.floor(x)) * 4;
        const j = 0.93 + rnd() * 0.14, len = 4 + rnd() * 9, w = 2.5 + rnd() * 4;
        const a = rnd() * 6.283;
        const dx = Math.cos(a) * len, dy = Math.sin(a) * len;
        ctx.strokeStyle = `rgba(${Math.min(255, src[k] * j) | 0},${Math.min(255, src[k + 1] * j) | 0},${Math.min(255, src[k + 2] * j) | 0},0.4)`; ctx.lineWidth = w;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx, y + dy); ctx.stroke();
        bc.strokeStyle = 'rgba(255,255,255,0.2)'; bc.lineWidth = w * 0.5; bc.beginPath(); bc.moveTo(x, y); bc.lineTo(x + dx, y + dy); bc.stroke();
        bc.strokeStyle = 'rgba(0,0,0,0.16)'; bc.lineWidth = 1.2; bc.beginPath(); bc.moveTo(x + dy / len * w * 0.5, y - dx / len * w * 0.5); bc.lineTo(x + dx + dy / len * w * 0.5, y + dy - dx / len * w * 0.5); bc.stroke();
      }
    });
    const bumpTex = new THREE.CanvasTexture(bumpCanvas); bumpTex.colorSpace = THREE.NoColorSpace; bumpTex.anisotropy = 8;
    // 板の形：絵の輪郭を外へ少し広げて切り抜く
    const tmp = document.createElement('canvas').getContext('2d');
    const pts = [];
    {
      const B = (p0, p1, p2, p3, n) => { for (let i = 1; i <= n; i++) { const t = i / n, u = 1 - t; pts.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]); } };
      pts.push([cx, 40]); B([cx, 40], [cx + 150, 200], [cx + 130, 420], [cx + 118, 760], 22);
      for (const p of [[cx + 215, 930], [cx + 104, 880], [cx + 70, 960], [cx - 70, 960], [cx - 104, 880], [cx - 215, 930], [cx - 118, 760]]) pts.push(p);
      B([cx - 118, 760], [cx - 130, 420], [cx - 150, 200], [cx, 40], 22); pts.pop();
    }
    void tmp;
    const N = pts.length, OFF = 15;
    const off = pts.map((p, i) => {
      const a = pts[(i + N - 1) % N], c = pts[(i + 1) % N];
      const n1 = [p[1] - a[1], a[0] - p[0]], n2 = [c[1] - p[1], p[0] - c[0]];
      const l1 = Math.hypot(...n1) || 1, l2 = Math.hypot(...n2) || 1;
      let nx = n1[0] / l1 + n2[0] / l2, ny = n1[1] / l1 + n2[1] / l2; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
      const cosH = Math.max(0.45, nx * (n1[0] / l1) + ny * (n1[1] / l1));
      return [p[0] + (nx * OFF) / cosH, p[1] + (ny * OFF) / cosH];
    });
    // 画素 → 板の座標（幅 3.2・高さ 6.4。下端が y=0）
    const shape = new THREE.Shape(off.map(([x, y]) => new THREE.Vector2((x - 256) * (3.2 / 512), (1024 - y) * (6.4 / 1024))));
    const TH = 0.04;
    const bg = new THREE.ExtrudeGeometry(shape, { depth: TH, bevelEnabled: false }); bg.translate(0, 0, -TH);
    const bm = new THREE.MeshStandardNodeMaterial();
    {
      const P = positionLocal, nl = normalLocal;
      const front = step(0.5, nl.z), back = step(0.5, nl.z.negate()), face = front.add(back);
      const u0 = P.x.div(3.2).add(0.5), uvP = vec2(mix(u0.oneMinus(), u0, front), P.y.div(6.4));
      const art = texture(tex, uvP).rgb;
      // 縁：ベニヤの重なり
      const ply = sin(P.z.mul(TAU / (TH / 2.5))).mul(0.5).add(0.5);
      const edgeC = mix(vec3(0.5, 0.36, 0.2), vec3(0.74, 0.6, 0.4), ply).mul(mx_noise_float(P.mul(vec3(30.0, 30.0, 4.0))).mul(0.15).add(0.9));
      bm.colorNode = mix(edgeC, art.mul(mix(float(0.9), float(1.0), front)), face);
      const h = texture(bumpTex, uvP).r;
      bm.roughnessNode = mix(float(0.85), h.mul(-0.3).add(0.6), face);
      bm.normalNode = normalize(mix(normalView, bumpMap(texture(bumpTex, uvP), 0.4), face));
    }
    const board = new THREE.Mesh(bg, bm); board.castShadow = true; board.receiveShadow = true;
    const card = (this.card = grp(board));
    // 裏の桟と、つっかい棒（木ねじの頭つき）
    const WOOD = woodMaterial('y');
    const wb = new Bag2();
    wb.add(new THREE.BoxGeometry(0.12, 3.2, 0.06, 1, 6, 1).translate(0, 1.8, -TH - 0.03), 0xa07a48, 0.8, 0);
    for (const yy of [0.5, 1.8, 3.1]) wb.add(xf(new THREE.CylinderGeometry(0.014, 0.014, 0.01, 8), { r: [HP, 0, 0], p: [0, yy, -TH - 0.062] }), 0x3a3c40, 0.5, 0.8);
    card.add(wb.mesh(WOOD));
    const cross = new Bag2(); cross.add(new THREE.BoxGeometry(1.7, 0.1, 0.05).translate(0, 3.3, -TH - 0.085), 0xa07a48, 0.8, 0);
    card.add(cross.mesh(woodMaterial('x')));
    const sb = new Bag2();
    sb.add(new THREE.BoxGeometry(0.12, 3.3, 0.06, 1, 6, 1), 0x9a7442, 0.8, 0);
    sb.add(xf(new THREE.BoxGeometry(0.16, 0.05, 0.1), { p: [0, 1.63, 0.02] }), 0x55585e, 0.5, 0.8);
    this.stand = sb.mesh(WOOD); this.stand.position.set(0, 1.45, -0.72 - TH); this.stand.rotation.set(0.42, 0, 0);
    card.add(this.stand);
    root.add(card);
    this.reset();
  }
  reset() { this.root.visible = false; this.root.position.set(0, 0, 0); this.root.rotation.set(0, 0, 0); this.root.scale.setScalar(1); this.card.rotation.set(0, 0, 0); this.card.position.set(0, 0, 0); this.stand.visible = true; }
}

/** ④ Claude の「安全第一」ロケット：出来はいいが、確認が終わらない（緩衝材・警告テープ・ヘルメット） */
export class SafeRocket {
  constructor() {
    const root = (this.root = grp());
    const PCYL = plateMaterial({ rust: 0, G: 0.55, mode: 'cyl', nV: 8 }), PBOX = plateMaterial({ rust: 0, G: 0.5, mode: 'box' }), PART = partMaterial(), FAB = fabricMaterial(80);
    const b = new Bag2(), pb = new Bag2(), s = new Bag2(), fab = new Bag2(), bub = new Bag2();
    const seg = (r, y0, y1, hex) => b.add(new THREE.CylinderGeometry(r, r, y1 - y0, 40, 1, true).translate(0, (y0 + y1) / 2, 0), hex, 0.42, 0.1);
    seg(0.7, 1.2, 1.525, PAINT.white); seg(0.703, 1.525, 1.875, PAINT.orange); seg(0.7, 1.875, 3.725, PAINT.white); seg(0.703, 3.725, 4.075, PAINT.orange); seg(0.7, 4.075, 4.6, PAINT.white);
    b.add(latheOf([[0.7, 4.6], [0.62, 5.0], [0.4, 5.55], [0.14, 5.95], [0.0, 6.0]], 40), PAINT.orange, 0.42, 0.1);
    b.add(new THREE.CircleGeometry(0.7, 40).rotateX(HP).translate(0, 1.2, 0), 0x55585e, 0.5, 0.6);
    for (const yy of [1.22, 4.6]) s.add(hoop(0.705, yy, 0.012, 40, 5), ...STEEL);
    bellInto(s, [[0.52, 0.5], [0.46, 0.64], [0.38, 0.86], [0.3, 1.2]], 0, 0, 0, 24, 3);
    // 羽（角に緩衝材の当てもの）
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      pb.add(atAz(xf(new THREE.BoxGeometry(0.06, 1.4, 0.9, 1, 3, 3), { r: [-0.25, 0, 0], p: [0, 0, 0.45] }), a, 0.7, 1.55), PAINT.orange, 0.42, 0.1);
      fab.add(atAz(xf(new THREE.BoxGeometry(0.16, 0.3, 0.3), { r: [-0.25, 0, 0], p: [0, -0.62, 0.92] }), a, 0.7, 1.55), 0x8fa9c4, 0.9, 0);
      fab.add(atAz(xf(new THREE.BoxGeometry(0.16, 0.3, 0.3), { r: [-0.25, 0, 0], p: [0, 0.6, 0.84] }), a, 0.7, 1.55), 0x8fa9c4, 0.9, 0);
    }
    // 脚とゴムの足
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      s.add(rod([sx * 0.5, 1.3, sz * 0.5], [sx * 1.05, 0.08, sz * 1.05], 0.045, 8), ...STEEL);
      s.add(rod([sx * 0.5, 0.75, sz * 0.5], [sx * 0.86, 0.5, sz * 0.86], 0.02, 6), ...STEEL);
      s.add(xf(new THREE.CylinderGeometry(0.11, 0.13, 0.09, 14), { p: [sx * 1.05, 0.045, sz * 1.05] }), ...RUBBER);
    }
    // 舷窓
    s.add(xf(new THREE.TorusGeometry(0.21, 0.04, 8, 24), { p: [0, 3.3, 0.71] }), ...STEEL);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; s.add(xf(new THREE.CylinderGeometry(0.02, 0.02, 0.02, 6), { r: [HP, 0, 0], p: [Math.cos(a) * 0.21, 3.3 + Math.sin(a) * 0.21, 0.75] }), ...DARKM); }
    const win = new THREE.Mesh(new THREE.CircleGeometry(0.18, 24), glassM()); win.position.set(0, 3.3, 0.715); root.add(win);
    // 胴に巻いた気泡緩衝材と、とめるテープ
    bub.add(new THREE.CylinderGeometry(0.735, 0.735, 0.95, 40, 1, true).translate(0, 2.55, 0), 0xd7e6f2, 0.3, 0);
    // 警告テープ（黄と黒）
    const hazT = canvasTex(256, 64, (ctx) => { ctx.fillStyle = '#e7b622'; ctx.fillRect(0, 0, 256, 64); ctx.fillStyle = '#16171a'; for (let i = -2; i < 8; i++) { ctx.beginPath(); ctx.moveTo(i * 64, 64); ctx.lineTo(i * 64 + 32, 64); ctx.lineTo(i * 64 + 96, 0); ctx.lineTo(i * 64 + 64, 0); ctx.closePath(); ctx.fill(); } });
    hazT.wrapS = THREE.RepeatWrapping; hazT.repeat.set(8, 1);
    const hazM = new THREE.MeshStandardNodeMaterial({ map: hazT, roughness: 0.45 });
    for (const [yy, r] of [[2.05, 0.74], [3.05, 0.74], [4.42, 0.708], [2.0, 0.0]]) {
      if (r === 0) continue;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.12, 40, 1, true), hazM); m.position.y = yy; m.castShadow = false; m.receiveShadow = true; root.add(m);
    }
    // 先端に安全ヘルメット（つやのある樹脂）とあごひも
    const hatM = new THREE.MeshPhysicalNodeMaterial(); hatM.color.set(0xe6b21e); hatM.roughness = 0.32; hatM.clearcoat = 0.6; hatM.clearcoatRoughness = 0.25;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.34, 28, 14, 0, TAU, 0, HP), hatM), brim = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.43, 0.03, 28), hatM), ridge = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.66), hatM);
    brim.position.set(0, 0.0, 0.08); ridge.position.set(0, 0.315, 0); ridge.geometry.translate(0, 0, 0);
    for (const m of [dome, brim, ridge]) { m.castShadow = true; m.receiveShadow = true; }
    const hat = grp(dome, brim, ridge); hat.position.set(0, 5.86, 0); hat.rotation.z = 0.12; root.add(hat);
    fab.add(rod([0.33, 5.85, 0.05], [0.42, 5.3, 0.1], 0.016, 5), 0x24262a, 0.9, 0); fab.add(rod([-0.36, 5.8, 0.05], [-0.5, 5.25, 0.1], 0.016, 5), 0x24262a, 0.9, 0);
    // クッション（空気入りの布のマット）
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.4;
      const g = new RoundedBoxGeometry(1.3, 0.34, 0.9, 4, 0.14); g.rotateY(a); g.translate(Math.sin(a) * 2.0, 0.19, Math.cos(a) * 2.0);
      fab.add(g, 0x9cc0e4, 0.9, 0);
      for (const k of [-0.3, 0.3]) fab.add(xf(new THREE.BoxGeometry(0.05, 0.35, 0.92), { p: [k, 0.19, 0] }).rotateY(a).translate(Math.sin(a) * 2.0, 0, Math.cos(a) * 2.0), 0x3b4a5c, 0.9, 0);
    }
    // 看板（鉄板に塗装。柱と台）
    const signT = canvasTex(512, 320, (ctx) => {
      ctx.fillStyle = '#e7b622'; ctx.fillRect(0, 0, 512, 320); ctx.strokeStyle = '#17181b'; ctx.lineWidth = 18; ctx.strokeRect(12, 12, 488, 296);
      ctx.fillStyle = '#17181b'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `900 96px ${FONT}`;
      ctx.fillText('SAFETY', 256, 112); ctx.fillText('FIRST', 256, 216);
      const r2 = mulberry(5); ctx.strokeStyle = 'rgba(120,90,30,0.35)'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 40; i++) { const x = r2() * 512, y = r2() * 320; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (r2() - 0.5) * 60, y + (r2() - 0.5) * 16); ctx.stroke(); }
    });
    const sign = grp(new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.81), new THREE.MeshStandardNodeMaterial({ map: signT, roughness: 0.5, metalness: 0.3 })));
    const sp = new Bag2();
    sp.add(new THREE.BoxGeometry(1.34, 0.85, 0.02).translate(0, 0, -0.012), 0x8a8d92, 0.5, 0.7);
    sp.add(new THREE.CylinderGeometry(0.035, 0.035, 1.6, 10).translate(0, -1.0, -0.04), ...STEEL);
    sp.add(new THREE.CylinderGeometry(0.22, 0.26, 0.06, 16).translate(0, -1.78, -0.04), ...DARKM);
    for (const [x, y] of [[-0.58, 0.33], [0.58, 0.33], [-0.58, -0.33], [0.58, -0.33]]) sp.add(xf(new THREE.CylinderGeometry(0.02, 0.02, 0.012, 6), { r: [HP, 0, 0], p: [x, y, 0.004] }), ...DARKM);
    sign.add(sp.mesh(PART));
    sign.position.set(-2.3, 1.85, 1.2); sign.rotation.y = 0.35; root.add(sign);
    root.add(b.mesh(PCYL), pb.mesh(PBOX), s.mesh(PART), fab.mesh(FAB), bub.mesh(bubbleMaterial(), { cast: false }));
    this.flame = new Flame(0.5, 4.5, {}); this.flame.root.position.y = 0.5; root.add(this.flame.root);
    this.reset();
  }
  reset() { this.root.visible = false; this.root.position.set(0, 0, 0); this.root.rotation.set(0, 0, 0); this.flame.set(0, 0); }
}

/** 終わらない確認リスト（地面にのびる巻き紙。繊維のある紙に印刷した行） */
export class Scroll {
  constructor() {
    const root = (this.root = grp());
    const rowTex = canvasTex(256, 64, (ctx) => {
      ctx.fillStyle = '#fbf8ee'; ctx.fillRect(0, 0, 256, 64);
      ctx.strokeStyle = '#2a2d33'; ctx.lineWidth = 4; ctx.strokeRect(22, 16, 32, 32);
      ctx.fillStyle = '#8f959d'; ctx.fillRect(74, 24, 150, 7); ctx.fillStyle = '#b4b9c0'; ctx.fillRect(74, 37, 96, 5);
      ctx.fillStyle = 'rgba(40,60,120,0.12)'; ctx.fillRect(0, 62, 256, 2);
    });
    const chkTex = canvasTex(256, 64, (ctx) => {
      ctx.fillStyle = '#fbf8ee'; ctx.fillRect(0, 0, 256, 64);
      ctx.strokeStyle = '#2a2d33'; ctx.lineWidth = 4; ctx.strokeRect(22, 16, 32, 32);
      ctx.strokeStyle = '#2a9a4e'; ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(26, 32); ctx.lineTo(37, 44); ctx.lineTo(58, 12); ctx.stroke();
      ctx.fillStyle = '#8f959d'; ctx.fillRect(74, 24, 150, 7); ctx.fillStyle = '#b4b9c0'; ctx.fillRect(74, 37, 96, 5);
      ctx.fillStyle = 'rgba(40,60,120,0.12)'; ctx.fillRect(0, 62, 256, 2);
    });
    for (const t of [rowTex, chkTex]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    this.uLen = uniform(1); this.uChecked = uniform(0);
    const m = new THREE.MeshStandardNodeMaterial(); m.side = THREE.DoubleSide; m.metalness = 0;
    const rows = uv().y.mul(this.uLen).div(0.24);
    const st = vec2(uv().x, rows.fract());
    const done = step(rows.floor(), this.uChecked.sub(0.5));
    const pp = paperNodes(positionLocal.mul(vec3(0.95, 1.0, this.uLen)));
    m.colorNode = mix(texture(rowTex, st).rgb, texture(chkTex, st).rgb, done).mul(pp.tone);
    m.roughnessNode = float(0.86);
    m.normalNode = tilt(normalView, pp.bump, 0.1);
    const g = new THREE.PlaneGeometry(1, 1, 1, 1); g.translate(0, 0.5, 0); g.rotateX(-Math.PI / 2);
    const paper = (this.paper = new THREE.Mesh(g, m)); paper.receiveShadow = true; paper.position.y = 0.012;
    // 巻き：端に渦の見える紙の筒
    const rm = new THREE.MeshStandardNodeMaterial(); rm.metalness = 0;
    {
      const P = positionLocal, rr = P.xz.length();
      const end = step(0.497, abs(P.y));
      const spiral = sin(rr.mul(260.0)).mul(0.5).add(0.5);
      const p2 = paperNodes(P);
      rm.colorNode = mix(vec3(0.96, 0.94, 0.86), vec3(0.96, 0.94, 0.86).mul(spiral.mul(0.35).add(0.62)), end).mul(p2.tone);
      rm.roughnessNode = float(0.86);
    }
    this.roll = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.0, 24), rm); this.roll.castShadow = true; this.roll.receiveShadow = true;
    this.roll.position.set(0, 0.14, 0); this.roll.rotation.z = Math.PI / 2;
    root.add(paper, this.roll);
    this.reset();
  }
  reset() { this.root.visible = false; this.root.position.set(0, 0, 0); this.root.rotation.set(0, 0, 0); this.set(1, 0); }
  /** 長さ（m）と、チェック済みの行数 */
  set(len, checked = 0, width = 0.95) {
    this.paper.scale.set(width, 1, len); this.roll.scale.set(1, width, 1);
    this.roll.position.z = -len; this.roll.rotation.x = -len * 6;
    this.uLen.value = len; this.uChecked.value = checked;
    return this;
  }
}
