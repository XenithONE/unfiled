// 吹き出し（絵文字ふうのアイコンをコードで描く）。台詞の代わりに気持ちを伝える。
// 実写寄りの画面になじむよう、空中に投影された光のパネル（暗いガラス板に光る絵）として描く。
// 旧来の白いまんが調は URL に ?bubble=classic を付けると使える。
import * as THREE from 'three/webgpu';
import { pixText } from '../core/pixfont.js';
import { canvasTex } from '../core/kit.js';
import { texture, uv, vec4, float, uniform, mix, sin, smoothstep } from 'three/tsl';

const CLASSIC = typeof location !== 'undefined' && new URLSearchParams(location.search).get('bubble') === 'classic';
const INK = CLASSIC ? '#23262d' : '#eef5ff';

function starPath(ctx, cx, cy, R, p = 0.55) {
  ctx.beginPath();
  for (let i = 0; i <= 96; i++) {
    const th = (i / 96) * Math.PI * 2;
    const r = R * Math.pow(Math.pow(Math.abs(Math.cos(th)), p) + Math.pow(Math.abs(Math.sin(th)), p), -1 / p);
    const x = cx + Math.cos(th) * r, y = cy - Math.sin(th) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** アイコンを (cx,cy) を中心に半径 s くらいで描く */
export function drawIcon(ctx, name, cx, cy, s, o = {}) {
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (name.startsWith('t:')) {
    const txt = name.slice(2);
    const px = o.px ?? Math.max(3, Math.floor((s * 2.1) / Math.max(1, txt.length * 5.6)));
    pixText(ctx, txt, cx, cy - px * 3.5, Math.min(px, Math.floor(s / 4.2)), o.color || INK, { align: 'center' });
    ctx.restore(); return;
  }
  switch (name) {
    case 'rocket': {
      ctx.translate(cx, cy); ctx.rotate(o.rot ?? 0.6);
      ctx.fillStyle = '#ff7a2e'; ctx.beginPath(); ctx.moveTo(-s * 0.2, s * 0.55); ctx.quadraticCurveTo(0, s * 1.25, s * 0.2, s * 0.55); ctx.fill();
      ctx.fillStyle = '#ffd24a'; ctx.beginPath(); ctx.moveTo(-s * 0.1, s * 0.55); ctx.quadraticCurveTo(0, s * 0.95, s * 0.1, s * 0.55); ctx.fill();
      ctx.fillStyle = '#e5484d';
      ctx.beginPath(); ctx.moveTo(-s * 0.3, s * 0.15); ctx.lineTo(-s * 0.62, s * 0.7); ctx.lineTo(-s * 0.28, s * 0.55); ctx.fill();
      ctx.beginPath(); ctx.moveTo(s * 0.3, s * 0.15); ctx.lineTo(s * 0.62, s * 0.7); ctx.lineTo(s * 0.28, s * 0.55); ctx.fill();
      ctx.fillStyle = '#f4f5f7'; ctx.strokeStyle = INK; ctx.lineWidth = s * 0.07;
      ctx.beginPath(); ctx.moveTo(0, -s); ctx.bezierCurveTo(s * 0.5, -s * 0.5, s * 0.38, s * 0.3, s * 0.28, s * 0.6); ctx.lineTo(-s * 0.28, s * 0.6); ctx.bezierCurveTo(-s * 0.38, s * 0.3, -s * 0.5, -s * 0.5, 0, -s); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e5484d'; ctx.beginPath(); ctx.moveTo(0, -s); ctx.bezierCurveTo(s * 0.22, -s * 0.8, s * 0.3, -s * 0.62, s * 0.33, -s * 0.5); ctx.lineTo(-s * 0.33, -s * 0.5); ctx.bezierCurveTo(-s * 0.3, -s * 0.62, -s * 0.22, -s * 0.8, 0, -s); ctx.fill();
      ctx.fillStyle = '#5fb6ff'; ctx.beginPath(); ctx.arc(0, -s * 0.12, s * 0.16, 0, 7); ctx.fill(); ctx.stroke();
      break;
    }
    case 'moon': {
      ctx.fillStyle = '#ffd95a'; ctx.strokeStyle = INK; ctx.lineWidth = s * 0.08;
      ctx.beginPath(); ctx.arc(cx, cy, s * 0.85, 0.35 * Math.PI, 1.65 * Math.PI); ctx.arc(cx + s * 0.38, cy, s * 0.66, 1.42 * Math.PI, 0.58 * Math.PI, true); ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    }
    case 'check': { ctx.strokeStyle = o.color || '#2fb85a'; ctx.lineWidth = s * 0.32; ctx.beginPath(); ctx.moveTo(cx - s * 0.7, cy + s * 0.05); ctx.lineTo(cx - s * 0.2, cy + s * 0.55); ctx.lineTo(cx + s * 0.75, cy - s * 0.55); ctx.stroke(); break; }
    case 'cross': { ctx.strokeStyle = '#e5484d'; ctx.lineWidth = s * 0.32; ctx.beginPath(); ctx.moveTo(cx - s * 0.6, cy - s * 0.6); ctx.lineTo(cx + s * 0.6, cy + s * 0.6); ctx.moveTo(cx + s * 0.6, cy - s * 0.6); ctx.lineTo(cx - s * 0.6, cy + s * 0.6); ctx.stroke(); break; }
    case 'q': pixText(ctx, '?', cx, cy - s * 0.95, Math.floor(s * 0.27), o.color || INK, { align: 'center' }); break;
    case 'bang': pixText(ctx, '!', cx, cy - s * 0.95, Math.floor(s * 0.27), o.color || '#e5484d', { align: 'center' }); break;
    case 'bangq': pixText(ctx, '!?', cx, cy - s * 0.95, Math.floor(s * 0.27), o.color || '#e5484d', { align: 'center' }); break;
    case 'dots': { ctx.fillStyle = CLASSIC ? '#8a8f98' : '#cfe0f5'; for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.arc(cx + i * s * 0.55, cy, s * 0.17, 0, 7); ctx.fill(); } break; }
    case 'spark': { // Claude のひらめき（オレンジの放射）
      ctx.strokeStyle = '#d97757'; ctx.lineWidth = s * 0.2;
      const L = [1, 0.78, 0.95, 0.7, 1, 0.8, 0.92, 0.72, 0.98, 0.76, 0.9, 0.74];
      for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2 + (o.rot || 0); ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * s * 0.16, cy + Math.sin(a) * s * 0.16); ctx.lineTo(cx + Math.cos(a) * s * L[i], cy + Math.sin(a) * s * L[i]); ctx.stroke(); }
      break;
    }
    case 'code': pixText(ctx, '</>', cx, cy - s * 0.5, Math.floor(s * 0.15), CLASSIC ? '#3d5fe6' : '#7fb0ff', { align: 'center' }); break;
    case 'fire': {
      ctx.fillStyle = '#ff6a1f'; ctx.beginPath(); ctx.moveTo(cx, cy - s); ctx.bezierCurveTo(cx + s * 0.25, cy - s * 0.45, cx + s * 0.85, cy - s * 0.2, cx + s * 0.6, cy + s * 0.45); ctx.bezierCurveTo(cx + s * 0.45, cy + s * 0.95, cx - s * 0.45, cy + s * 0.95, cx - s * 0.6, cy + s * 0.45); ctx.bezierCurveTo(cx - s * 0.8, cy - s * 0.05, cx - s * 0.3, cy - s * 0.2, cx - s * 0.32, cy - s * 0.55); ctx.bezierCurveTo(cx - s * 0.1, cy - s * 0.45, cx - s * 0.05, cy - s * 0.7, cx, cy - s); ctx.fill();
      ctx.fillStyle = '#ffd24a'; ctx.beginPath(); ctx.moveTo(cx, cy - s * 0.25); ctx.bezierCurveTo(cx + s * 0.4, cy + s * 0.1, cx + s * 0.35, cy + s * 0.75, cx, cy + s * 0.78); ctx.bezierCurveTo(cx - s * 0.35, cy + s * 0.75, cx - s * 0.4, cy + s * 0.1, cx, cy - s * 0.25); ctx.fill();
      break;
    }
    case 'star': {
      const g = ctx.createLinearGradient(cx - s, cy - s, cx + s, cy + s);
      const gr = ctx.createConicGradient(Math.PI * 1.25, cx, cy);
      gr.addColorStop(0, '#fcc419'); gr.addColorStop(0.25, '#f0463f'); gr.addColorStop(0.5, '#3f8cff'); gr.addColorStop(0.75, '#2fbb5c'); gr.addColorStop(1, '#fcc419');
      ctx.fillStyle = gr; starPath(ctx, cx, cy, s); ctx.fill();
      const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * 0.6); rg.addColorStop(0, 'rgba(63,140,255,0.95)'); rg.addColorStop(1, 'rgba(63,140,255,0)');
      ctx.fillStyle = rg; starPath(ctx, cx, cy, s); ctx.fill();
      void g;
      break;
    }
    case 'zzz': pixText(ctx, 'Z', cx - s * 0.5, cy - s * 0.1, Math.floor(s * 0.13), ZC, { align: 'center' }); pixText(ctx, 'Z', cx + s * 0.05, cy - s * 0.55, Math.floor(s * 0.1), ZC, { align: 'center' }); pixText(ctx, 'Z', cx + s * 0.5, cy - s * 0.9, Math.floor(s * 0.08), ZC, { align: 'center' }); break;
    case 'heart': { ctx.fillStyle = '#ff5b8d'; ctx.beginPath(); ctx.moveTo(cx, cy + s * 0.8); ctx.bezierCurveTo(cx - s * 1.4, cy - s * 0.1, cx - s * 0.6, cy - s * 1.1, cx, cy - s * 0.35); ctx.bezierCurveTo(cx + s * 0.6, cy - s * 1.1, cx + s * 1.4, cy - s * 0.1, cx, cy + s * 0.8); ctx.fill(); break; }
    case 'list': {
      ctx.fillStyle = '#fffdf5'; ctx.strokeStyle = INK; ctx.lineWidth = s * 0.07;
      ctx.beginPath(); ctx.rect(cx - s * 0.62, cy - s * 0.9, s * 1.24, s * 1.8); ctx.fill(); ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const y = cy - s * 0.58 + i * s * 0.4;
        ctx.strokeStyle = i < (o.n ?? 4) ? '#2fb85a' : '#b8bcc4'; ctx.lineWidth = s * 0.09;
        ctx.beginPath(); ctx.moveTo(cx - s * 0.46, y); ctx.lineTo(cx - s * 0.36, y + s * 0.1); ctx.lineTo(cx - s * 0.2, y - s * 0.12); ctx.stroke();
        ctx.strokeStyle = '#9aa0a8'; ctx.lineWidth = s * 0.08; ctx.beginPath(); ctx.moveTo(cx - s * 0.05, y); ctx.lineTo(cx + s * 0.45, y); ctx.stroke();
      }
      break;
    }
    case 'bulb': {
      ctx.fillStyle = '#ffd84a'; ctx.strokeStyle = INK; ctx.lineWidth = s * 0.07;
      ctx.beginPath(); ctx.arc(cx, cy - s * 0.2, s * 0.6, 0.75 * Math.PI, 0.25 * Math.PI); ctx.lineTo(cx + s * 0.25, cy + s * 0.55); ctx.lineTo(cx - s * 0.25, cy + s * 0.55); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#9aa0a8'; ctx.fillRect(cx - s * 0.24, cy + s * 0.6, s * 0.48, s * 0.28);
      break;
    }
    case 'sweat': { ctx.fillStyle = '#58b7ff'; ctx.beginPath(); ctx.moveTo(cx, cy - s * 0.9); ctx.bezierCurveTo(cx + s * 0.75, cy + s * 0.1, cx + s * 0.55, cy + s * 0.85, cx, cy + s * 0.85); ctx.bezierCurveTo(cx - s * 0.55, cy + s * 0.85, cx - s * 0.75, cy + s * 0.1, cx, cy - s * 0.9); ctx.fill(); break; }
    case 'anger': { ctx.strokeStyle = '#e5484d'; ctx.lineWidth = s * 0.2; for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { ctx.beginPath(); ctx.moveTo(cx + sx * s * 0.75, cy + sy * s * 0.25); ctx.quadraticCurveTo(cx + sx * s * 0.25, cy + sy * s * 0.25, cx + sx * s * 0.25, cy + sy * s * 0.75); ctx.stroke(); } break; }
    case 'gear': {
      ctx.fillStyle = CLASSIC ? '#6b7280' : '#b9c6d8'; ctx.beginPath();
      for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2 + (o.rot || 0), r = i % 2 ? s * 0.9 : s * 0.66; ctx.lineTo(cx + Math.cos(a - 0.1) * r, cy + Math.sin(a - 0.1) * r); ctx.lineTo(cx + Math.cos(a + 0.1) * r, cy + Math.sin(a + 0.1) * r); }
      ctx.closePath(); ctx.fill(); ctx.fillStyle = CLASSIC ? '#fbfbf8' : '#0d1626'; ctx.beginPath(); ctx.arc(cx, cy, s * 0.28, 0, 7); ctx.fill();
      break;
    }
    case 'note': { ctx.fillStyle = INK; ctx.beginPath(); ctx.ellipse(cx - s * 0.25, cy + s * 0.55, s * 0.3, s * 0.22, -0.3, 0, 7); ctx.fill(); ctx.fillRect(cx - s * 0.02, cy - s * 0.8, s * 0.12, s * 1.35); ctx.beginPath(); ctx.moveTo(cx + s * 0.1, cy - s * 0.8); ctx.quadraticCurveTo(cx + s * 0.7, cy - s * 0.6, cx + s * 0.55, cy - s * 0.05); ctx.quadraticCurveTo(cx + s * 0.5, cy - s * 0.4, cx + s * 0.1, cy - s * 0.45); ctx.fill(); break; }
    default: break;
  }
  ctx.restore();
}

const ZC = CLASSIC ? '#6b7280' : '#c3d2e6';

/** 光のパネル：暗いガラス板・光る縁・走査線。話し手を指す小さな光の楔 */
function drawHolo(ctx, icons, o) {
  const W = 320, H = 256;
  ctx.clearRect(0, 0, W, H);
  const x0 = 24, y0 = 20, w = W - 48, h = 164, r = 30;
  const tailX = o.tail === 'l' ? 100 : o.tail === 'r' ? 220 : 160;
  const edge = o.edge || (o.think ? '#b8a8ff' : '#8fd0ff');
  const body = () => {
    ctx.beginPath();
    ctx.moveTo(x0 + r, y0); ctx.lineTo(x0 + w - r, y0); ctx.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
    ctx.lineTo(x0 + w, y0 + h - r); ctx.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
    ctx.lineTo(x0 + r, y0 + h); ctx.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
    ctx.lineTo(x0, y0 + r); ctx.quadraticCurveTo(x0, y0, x0 + r, y0); ctx.closePath();
  };
  // ガラス板
  const g = ctx.createLinearGradient(0, y0, 0, y0 + h);
  g.addColorStop(0, 'rgba(18,28,48,0.97)'); g.addColorStop(1, 'rgba(6,10,20,0.98)');
  ctx.fillStyle = g; body(); ctx.fill();
  ctx.save(); body(); ctx.clip();
  ctx.fillStyle = 'rgba(150,200,255,0.045)'; for (let y = y0; y < y0 + h; y += 4) ctx.fillRect(x0, y, w, 1.5);           // 走査線
  const hl = ctx.createLinearGradient(0, y0, 0, y0 + h * 0.5); hl.addColorStop(0, 'rgba(170,215,255,0.16)'); hl.addColorStop(1, 'rgba(170,215,255,0)');
  ctx.fillStyle = hl; ctx.fillRect(x0, y0, w, h * 0.5);
  ctx.restore();
  // 光る縁
  ctx.lineJoin = 'round';
  ctx.strokeStyle = edge; ctx.lineWidth = 4; body(); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1.4; body(); ctx.stroke();
  ctx.fillStyle = edge; for (const [cx, cy] of [[x0 + 14, y0 + 14], [x0 + w - 14, y0 + 14], [x0 + 14, y0 + h - 14], [x0 + w - 14, y0 + h - 14]]) ctx.fillRect(cx - 2.5, cy - 2.5, 5, 5);
  // 話し手を指す光
  if (o.think) { for (const [dx, dy, rr] of [[0, 20, 9], [10, 42, 5.5]]) { ctx.beginPath(); ctx.arc(tailX + dx, y0 + h + dy, rr, 0, 7); ctx.fillStyle = 'rgba(14,22,38,0.92)'; ctx.fill(); ctx.strokeStyle = edge; ctx.lineWidth = 3; ctx.stroke(); } }
  else if (o.tail !== 'none') {
    const tx = tailX + (o.tail === 'l' ? -14 : o.tail === 'r' ? 14 : 0);
    const tg = ctx.createLinearGradient(0, y0 + h, 0, y0 + h + 50); tg.addColorStop(0, edge); tg.addColorStop(1, 'rgba(143,208,255,0.55)');
    ctx.fillStyle = tg; ctx.beginPath(); ctx.moveTo(tailX - 15, y0 + h + 3); ctx.lineTo(tailX + 15, y0 + h + 3); ctx.lineTo(tx, y0 + h + 48); ctx.closePath(); ctx.fill();
  }
  const n = icons.length;
  icons.forEach((ic, i) => {
    const cx = W / 2 + (i - (n - 1) / 2) * (n > 2 ? 86 : 112), s = n === 1 ? 60 : n === 2 ? 49 : 37;
    drawIcon(ctx, ic, cx, y0 + h / 2, s, o);
  });
}

function drawBubble(ctx, icons, o) {
  if (!CLASSIC) return drawHolo(ctx, icons, o);
  const W = 320, H = 256;
  ctx.clearRect(0, 0, W, H);
  const x0 = 22, y0 = 18, w = W - 44, h = 168, r = 44;
  const tailX = o.tail === 'l' ? 100 : o.tail === 'r' ? 220 : 160;
  ctx.lineJoin = 'round';
  const body = () => {
    ctx.beginPath();
    ctx.moveTo(x0 + r, y0); ctx.lineTo(x0 + w - r, y0); ctx.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
    ctx.lineTo(x0 + w, y0 + h - r); ctx.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
    if (!o.think && o.tail !== 'none') { ctx.lineTo(tailX + 26, y0 + h); ctx.lineTo(tailX + (o.tail === 'l' ? -18 : o.tail === 'r' ? 18 : 0), y0 + h + 46); ctx.lineTo(tailX - 26, y0 + h); }
    ctx.lineTo(x0 + r, y0 + h); ctx.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
    ctx.lineTo(x0, y0 + r); ctx.quadraticCurveTo(x0, y0, x0 + r, y0); ctx.closePath();
  };
  ctx.fillStyle = o.fill || '#fbfbf7'; ctx.strokeStyle = INK; ctx.lineWidth = 9;
  body(); ctx.stroke(); ctx.fill();
  if (o.think) for (const [dx, dy, rr] of [[0, 26, 15], [14, 54, 9]]) { ctx.beginPath(); ctx.arc(tailX + dx, y0 + h + dy - 6, rr, 0, 7); ctx.fill(); ctx.stroke(); }
  const n = icons.length;
  icons.forEach((ic, i) => {
    const cx = W / 2 + (i - (n - 1) / 2) * (n > 2 ? 86 : 112), s = n === 1 ? 62 : n === 2 ? 50 : 38;
    drawIcon(ctx, ic, cx, y0 + h / 2, s, o);
  });
}

export class Bubbles {
  constructor(n = 10) {
    this.root = new THREE.Group();
    this.items = [];
    this.gain = 1.7;
    for (let i = 0; i < n; i++) {
      const tex = canvasTex(320, 256, null, { srgb: true });
      const m = new THREE.SpriteNodeMaterial({ map: tex, transparent: true });
      m.depthTest = false; m.depthWrite = true; m.alphaTest = 0.5;
      if (!CLASSIC) {   // 光る絵：明るい画素ほど強く（にじみが出る）、板は半透明
        const t = texture(tex, uv());
        const lum = t.r.mul(0.3).add(t.g.mul(0.5)).add(t.b.mul(0.2));
        m.colorNode = vec4(t.rgb.mul(mix(float(1.0), float(this.gain), smoothstep(0.25, 0.75, lum))), t.a.mul(mix(float(0.95), float(1.0), smoothstep(0.2, 0.6, lum))));
      }
      const s = new THREE.Sprite(m);
      s.renderOrder = 200; s.visible = false; s.layers.set(1); m.fog = false;
      s.center.set(0.5, 0.0);
      this.root.add(s);
      this.items.push({ sprite: s, tex, sig: '' });
    }
    this.used = 0;
  }
  reset() { this.used = 0; for (const it of this.items) it.sprite.visible = false; }
  /**
   * 吹き出しを出す。icon は名前か配列。pos は吹き出しの根もと（頭の少し上）。k は出かた 0..1。
   * o: { size, tail:'c'|'l'|'r'|'none', think, fill, color, rot, n }
   */
  say(icon, pos, k = 1, o = {}) {
    if (k <= 0.001 || this.used >= this.items.length) return;
    const it = this.items[this.used++];
    const icons = Array.isArray(icon) ? icon : [icon];
    const sig = icons.join(',') + JSON.stringify(o, (key, v) => (typeof v === 'number' ? Math.round(v * 20) / 20 : v));
    if (sig !== it.sig) { it.sig = sig; drawBubble(it.tex.userData.ctx, icons, o); it.tex.needsUpdate = true; }
    const size = (o.size ?? 1.15) * k;
    it.sprite.visible = true;
    it.sprite.position.set(pos[0], pos[1], pos[2]);
    it.sprite.scale.set(size * 1.25, size, 1);
  }
}
