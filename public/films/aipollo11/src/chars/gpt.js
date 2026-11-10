// GPT：青い雲のからだに、端末画面の顔（> _）を持つマスコット
// 質感：やわらかいつや消しのビニール（ソフビ）の雲と、黒いガラスの液晶画面。
import * as THREE from 'three/webgpu';
import { texture, uv, color, mix, vec2, vec3, float, positionLocal, smoothstep, fract, exp, mx_noise_float } from 'three/tsl';
import { sph, rbox, grp, canvasTex } from '../core/kit.js';
import { Actor, sootMat, makeHelmet, bumpN, detailFade } from './actor.js';
import { blink, hash1 } from '../core/util.js';

export const GPT_BLUE = 0x4467f0;
const CY = '#74ecff', PINK = '#ff6fae', GREEN = '#6dff9c', RED = '#ff6b5e', YEL = '#ffd95e';

/** 雲の頭：ふちに 8 つの山がある楕円体 */
function cloudGeometry() {
  const g = new THREE.SphereGeometry(1, 96, 64);
  g.rotateX(Math.PI / 2);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const a = Math.atan2(v.y, v.x);
    const bump = Math.pow(Math.abs(Math.cos(a * 4)), 0.62);
    const az = Math.abs(v.z);
    const w = 1 - Math.min(1, Math.max(0, (az - 0.18) / 0.6)) ** 2 * (3 - 2 * Math.min(1, Math.max(0, (az - 0.18) / 0.6)));
    const r = 1 + 0.2 * bump * w - 0.035 * w;
    p.setXYZ(i, v.x * r * 0.47, v.y * r * 0.395, v.z * 0.33 * (1 + 0.08 * bump * w));
  }
  g.computeVertexNormals();
  return g;
}

/** 顔の画面を描く（32x20 マスのドット絵） */
function drawFace(ctx, kind, o) {
  const W = 256, H = 160, c = 8;
  ctx.clearRect(0, 0, W, H);
  const R = (x, y, w, h, col = CY) => { ctx.fillStyle = col; ctx.fillRect(Math.round(x * c), Math.round(y * c), Math.round(w * c), Math.round(h * c)); };
  const dx = o.dx || 0, dy = o.dy || 0, open = o.open ?? 1;
  const two = (fn) => { fn(9.5 + dx, 0); fn(20.5 + dx, 1); };
  switch (kind) {
    case 'prompt': { // > _
      const x = 7.5 + dx, y = 5 + dy;
      for (let i = 0; i < 5; i++) R(x + i * 1.5, y + i * 1.0, 2.5, 2.0);
      for (let i = 1; i < 5; i++) R(x + (4 - i) * 1.5, y + (4 + i) * 1.0, 2.5, 2.0);
      if (o.cursor !== false) R(18 + dx, 13 + dy, 6.5, 2.0);
      break;
    }
    case 'eyes': two((x) => { const h = Math.max(1.2, 8 * open); R(x - 1.2, 10 - h / 2 + dy, 2.4, h); }); break;
    case 'happy': two((x) => { for (let i = 0; i < 3; i++) { R(x - 3 + i, 10.5 - i * 1.2 + dy, 1.6, 1.8); R(x + 1.4 - i, 10.5 - i * 1.2 + dy, 1.6, 1.8); } }); break;
    case 'flat': two((x) => R(x - 2.6, 9.5 + dy, 5.2, 1.8, o.dim ? '#3f8fa8' : CY)); break;
    case 'wide': two((x) => { R(x - 2.2, 7.4 + dy, 4.4, 5.2); ctx.clearRect((x - 0.9) * c, (8.7 + dy) * c, 1.8 * c, 2.6 * c); }); break;
    case 'heart': two((x) => { const P = ['.#.#.', '#####', '#####', '.###.', '..#..']; P.forEach((row, r) => [...row].forEach((ch, k) => { if (ch === '#') R(x - 3 + k * 1.2, 7 + r * 1.2 + dy, 1.25, 1.25, PINK); })); }); break;
    case 'dead': two((x) => { for (let i = 0; i < 5; i++) { R(x - 2.6 + i * 1.05, 7.6 + i * 1.05 + dy, 1.5, 1.5); R(x + 1.6 - i * 1.05, 7.6 + i * 1.05 + dy, 1.5, 1.5); } }); break;
    case 'strain': two((x, s) => { for (let i = 0; i < 3; i++) { const k = s ? 2 - i : i; R(x - 2.2 + k * 1.5, 7.6 + i * 1.2 + dy, 1.8, 1.6); R(x - 2.2 + k * 1.5, 12.4 - i * 1.2 + dy, 1.8, 1.6); } }); break;
    case 'sad': two((x, s) => { for (let i = 0; i < 4; i++) R(x - 2.6 + i * 1.3, (s ? 8.6 + i * 0.55 : 10.25 - i * 0.55) + dy, 1.5, 1.6); }); break;
    case 'code': { // 流れるコード
      const sc = o.scroll || 0;
      for (let r = 0; r < 7; r++) {
        const line = Math.floor(sc) + r, y = 2 + (r - (sc % 1)) * 2.6;
        if (y < 0.5 || y > 17) continue;
        let x = 3 + Math.floor(hash1(line * 3.1) * 3) * 2;
        const n = 2 + Math.floor(hash1(line * 7.7) * 3);
        for (let k = 0; k < n; k++) {
          const w = 2 + Math.floor(hash1(line * 13.3 + k * 5.1) * 6);
          if (x + w > 29) break;
          R(x, y, w, 1.3, [CY, CY, GREEN, '#b6a7ff', YEL][Math.floor(hash1(line * 1.7 + k * 9.9) * 5)]);
          x += w + 1.4;
        }
      }
      break;
    }
    case 'check': { const P = [[19, 4], [17.4, 6], [15.8, 8], [14.2, 10], [12.6, 12], [11, 10.4], [9.4, 8.8]]; P.forEach(([x, y]) => R(x, y, 2.6, 2.4, GREEN)); break; }
    case 'cross': { for (let i = 0; i < 6; i++) { R(10 + i * 1.8, 4.5 + i * 1.7, 2.6, 2.3, RED); R(19 - i * 1.8, 4.5 + i * 1.7, 2.6, 2.3, RED); } break; }
    case 'bang': { R(15, 3.5, 2.6, 8, YEL); R(15, 13.5, 2.6, 2.6, YEL); break; }
    case 'load': { const n = 1 + (Math.floor(o.step || 0) % 3); for (let i = 0; i < n; i++) R(10 + i * 5, 9, 2.6, 2.6); break; }
    default: break;
  }
}

export class Gpt extends Actor {
  constructor() {
    super('gpt');
    this.seed = 4.1;
    // 雲：つや消しのビニール。細かな肌、ごくゆるい色むら、型の合わせ目、縁のやわらかな照り返し
    const P = positionLocal;
    const q = P.mul(560.0);
    const grain = mx_noise_float(q).mul(detailFade(q));
    const mott = mx_noise_float(P.mul(9.0).add(2.0));
    const seam = exp(P.z.div(0.0032).pow(2).negate()).mul(detailFade(P.mul(160.0)));
    const blue = (this.mat = sootMat(this.sootU, GPT_BLUE, {
      colorNode: color(GPT_BLUE).mul(mott.mul(0.04).add(1.0)),
      roughNode: float(0.54).add(grain.mul(0.06)).add(mott.mul(0.03)).sub(seam.mul(0.12)),
      sheen: 0x6f8cff, sheenAmt: 0.22, sheenRough: 0.45,
      normalNode: bumpN(grain.mul(0.00006).add(seam.mul(0.0005)), 1.0),
    }));
    // 画面：黒いガラス。指のあとで粗さにむらがあり、まわりが映り込む
    const smear = smoothstep(0.0, 0.7, mx_noise_float(P.mul(vec3(9.0, 26.0, 9.0))));
    const navy = sootMat(this.sootU, 0x05060c, { roughNode: smear.mul(0.1).add(0.2), specular: 0.3 });   // 反射防止の膜つきの、半つやの面（近くの灯りで顔が飛ばない）

    // 頭（雲）：楕円体のふちだけを 8 つの山で波打たせる（正面はなめらか）
    const head = (this.head = grp());
    head.position.set(0, 0.76, 0);
    const cloud = new THREE.Mesh(cloudGeometry(), blue);
    cloud.castShadow = true; cloud.receiveShadow = true;
    head.add(cloud);
    // 画面
    const screen = rbox(0.66, 0.42, 0.16, 0.08, navy, 0, -0.01, 0.29);
    head.add(screen);
    this.faceTex = canvasTex(256, 160, null, { srgb: true, pixel: true });
    const fm = new THREE.MeshBasicNodeMaterial();
    fm.transparent = true; fm.depthWrite = false;
    const ft = texture(this.faceTex, uv());
    // 液晶の画素：1 マスを 3 x 3 の画素に分け、すき間は暗い。遠くでは粒が消えて平均の明るさになる
    const cells = uv().mul(vec2(96.0, 60.0));
    const f = fract(cells);
    const px = smoothstep(0.04, 0.2, f.x).mul(smoothstep(0.8, 0.96, f.x).oneMinus()).mul(smoothstep(0.04, 0.2, f.y)).mul(smoothstep(0.8, 0.96, f.y).oneMinus());
    const lcd = mix(float(0.62), px, detailFade(cells.mul(0.5)));
    fm.colorNode = ft.rgb.mul(lcd).mul(2.7);
    fm.opacityNode = ft.a;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.35), fm);
    face.position.set(0, -0.01, 0.29 + 0.083); face.renderOrder = 5;
    head.add(face);
    this.body.add(head);

    // 胴
    const torso = (this.torso = sph(0.2, blue, 0, 0.28, 0, 32, 24)); torso.scale.set(1.0, 0.98, 0.86);
    this.body.add(torso);
    const chestTex = canvasTex(64, 40, (ctx) => { ctx.fillStyle = '#cfe0ff'; for (let i = 0; i < 3; i++) { ctx.fillRect(14 + i * 5, 8 + i * 5, 7, 6); ctx.fillRect(14 + (2 - i) * 5, 18 + (i + 1) * 5 - 5, 7, 6); } ctx.fillRect(34, 27, 16, 6); }, { pixel: true });
    const cm = new THREE.MeshStandardNodeMaterial(); cm.transparent = true; cm.depthWrite = false; cm.roughness = 0.55;   // 印刷のマーク（光を受ける）
    const ct = texture(chestTex, uv()); cm.colorNode = mix(ct.rgb, vec3(0.25), this.sootU); cm.opacityNode = ct.a.mul(0.95);
    const chest = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.094), cm);
    chest.position.set(0, 0.29, 0.176); chest.rotation.x = -0.08; chest.receiveShadow = true;
    this.body.add(chest);

    // 腕
    const mkArm = (side) => {
      const g = grp(); g.position.set(side * 0.19, 0.36, 0);
      const a = sph(0.066, blue, side * 0.065, -0.085, 0, 20, 14); a.scale.set(0.95, 1.75, 0.95); a.rotation.z = side * 0.55;
      g.add(a); this.body.add(g); return g;
    };
    this.armL = mkArm(-1); this.armR = mkArm(1);
    // 足
    const mkFoot = (side) => { const f = sph(0.088, blue, side * 0.11, 0.066, 0.02, 20, 14); f.scale.set(1, 0.75, 1.3); this.body.add(f); return f; };
    this.footL = mkFoot(-1); this.footR = mkFoot(1);

    this.helmet = makeHelmet(0.66, 0.78, 0.36);
    this.root.add(this.helmet);
    this.height = 1.24;
    this._sig = '';
    this.pose0();
  }

  pose0() {
    this.head.rotation.set(0, 0, 0); this.head.position.set(0, 0.76, 0);
    this.armL.rotation.set(0, 0, 0); this.armR.rotation.set(0, 0, 0);
    this.footL.position.set(-0.11, 0.066, 0.02); this.footR.position.set(0.11, 0.066, 0.02);
    this._face = 'prompt'; this._fo = {};
  }
  /** 顔：prompt / eyes / happy / flat / wide / heart / dead / strain / sad / code / check / cross / bang / load */
  face(kind, o = {}) { this._face = kind; this._fo = o; return this; }
  /** 腕（正で上げる）。fwd は前へ振る量 */
  arms(l = 0, r = l, fwdL = 0, fwdR = fwdL) {
    this.armL.rotation.z = -l; this.armR.rotation.z = r;
    this.armL.rotation.x = -fwdL; this.armR.rotation.x = -fwdR;
    return this;
  }
  walk(phase, amt = 1) {
    const s = Math.sin(phase), c = Math.cos(phase);
    this.footL.position.z = 0.02 + s * 0.09 * amt; this.footR.position.z = 0.02 - s * 0.09 * amt;
    this.footL.position.y = 0.066 + Math.max(0, c) * 0.06 * amt; this.footR.position.y = 0.066 + Math.max(0, -c) * 0.06 * amt;
    this.body.position.y += Math.abs(s) * 0.035 * amt;
    this.body.rotation.z += s * 0.06 * amt;
    this.armL.rotation.x += s * 0.6 * amt; this.armR.rotation.x -= s * 0.6 * amt;
    return this;
  }
  /** 頭をかしげる・うなずく */
  nod(rx = 0, rz = 0, ry = 0) { this.head.rotation.set(rx, ry, rz); return this; }
  finish(T) {
    const o = { ...this._fo };
    if (this._face === 'eyes' && this.autoBlink && o.open === undefined) o.open = blink(T, this.seed, 3.4);
    if (this._face === 'prompt' && o.cursor === undefined) o.cursor = (T * 1.6) % 1 < 0.6;
    const sig = this._face + JSON.stringify(o, (k, v) => (typeof v === 'number' ? Math.round(v * 40) / 40 : v));
    if (sig !== this._sig) {
      this._sig = sig;
      drawFace(this.faceTex.userData.ctx, this._face, o);
      this.faceTex.needsUpdate = true;
    }
    if (this.breathe) { const b = 1 + Math.sin(T * 2.6 + this.seed) * 0.014; this.torso.scale.y = 0.98 * b; }
  }
}
