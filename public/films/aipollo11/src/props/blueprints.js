// 設計図（青焼き）をコードで描く
import { pixText } from '../core/pixfont.js';
import { canvasTex } from '../core/kit.js';
import { drawIcon } from '../fx/bubble.js';

const W = 768, H = 512, INK = '#eef4ff';

function base(ctx, title) {
  ctx.fillStyle = '#1c4aa6'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.strokeStyle = INK; ctx.lineWidth = 5; ctx.strokeRect(14, 14, W - 28, H - 28);
  if (title) pixText(ctx, title, 34, 32, 5, INK);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
}

/** ロケットの線画。cx: 中心 x、by: 底の y、h: 高さ */
function rocket(ctx, cx, by, h, o = {}) {
  const w = h * (o.fat ?? 0.2);
  ctx.strokeStyle = o.color || INK; ctx.lineWidth = o.lw ?? 5;
  const top = by - h, noseH = h * 0.24;
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, by); ctx.lineTo(cx - w / 2, top + noseH);
  ctx.quadraticCurveTo(cx - w / 2, top + noseH * 0.3, cx, top);
  ctx.quadraticCurveTo(cx + w / 2, top + noseH * 0.3, cx + w / 2, top + noseH);
  ctx.lineTo(cx + w / 2, by); ctx.closePath(); ctx.stroke();
  // 羽
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx + (s * w) / 2, by - h * 0.26); ctx.lineTo(cx + s * w * 1.15, by + h * 0.02); ctx.lineTo(cx + (s * w) / 2, by - h * 0.04); ctx.stroke(); }
  // 窓
  ctx.beginPath(); ctx.arc(cx, top + noseH * 1.5, w * 0.2, 0, 7); ctx.stroke();
  // エンジン
  const n = o.engines ?? 1;
  for (let i = 0; i < n; i++) {
    const ex = cx + (n === 1 ? 0 : ((i / (n - 1)) - 0.5) * w * (o.spread ?? 0.8));
    const ew = (w * (o.ew ?? 0.36)) / Math.max(1, Math.min(n, 3) * 0.7);
    ctx.beginPath(); ctx.moveTo(ex - ew * 0.3, by); ctx.lineTo(ex - ew * 0.5, by + h * 0.07); ctx.lineTo(ex + ew * 0.5, by + h * 0.07); ctx.lineTo(ex + ew * 0.3, by); ctx.stroke();
  }
}

const draws = {
  goal(ctx) {
    base(ctx, 'MISSION: MOON');
    ctx.strokeStyle = INK; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(170, 360, 78, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(120, 330); ctx.quadraticCurveTo(150, 300, 190, 330); ctx.quadraticCurveTo(215, 360, 180, 390); ctx.stroke();
    ctx.beginPath(); ctx.arc(590, 170, 52, 0, 7); ctx.stroke();
    for (const [x, y, r] of [[575, 155, 10], [606, 182, 14], [570, 192, 6]]) { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke(); }
    ctx.setLineDash([4, 18]); ctx.beginPath(); ctx.moveTo(235, 310); ctx.quadraticCurveTo(380, 120, 535, 165); ctx.stroke(); ctx.setLineDash([]);
    drawIcon(ctx, 'rocket', 392, 196, 34, { rot: 1.1 });
    pixText(ctx, '384,400 KM', 300, 420, 4, INK);
  },
  claude(ctx) {
    base(ctx, 'PLAN A: SAFE');
    rocket(ctx, 220, 420, 300, { engines: 1 });
    for (let i = 0; i < 6; i++) {
      const y = 120 + i * 52;
      ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.strokeRect(420, y, 30, 30);
      ctx.strokeStyle = '#ffb38f'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(426, y + 16); ctx.lineTo(434, y + 24); ctx.lineTo(446, y + 6); ctx.stroke();
      ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(470, y + 16); ctx.lineTo(470 + 120 + ((i * 53) % 90), y + 16); ctx.stroke();
    }
    drawIcon(ctx, 'spark', 660, 70, 30);
  },
  gpt(ctx) {
    base(ctx, 'PLAN B: FAST');
    rocket(ctx, 250, 420, 300, { engines: 1 });
    pixText(ctx, '{', 110, 180, 16, INK); pixText(ctx, '}', 350, 180, 16, INK);
    pixText(ctx, 'SHIP IT!', 450, 150, 7, '#8fd0ff');
    pixText(ctx, 'V0.1', 450, 230, 7, INK);
    pixText(ctx, 'ETA 0.3S', 450, 310, 5, INK);
    pixText(ctx, '>_', 620, 400, 9, '#74ecff');
  },
  gemini(ctx) {
    base(ctx, 'PLAN C: PRETTY');
    const cols = ['#ff6b63', '#ffd23d', '#4fd684', '#5aa2ff'];
    cols.forEach((c, i) => rocket(ctx, 250 + i * 3, 420 - i * 2, 300, { engines: 1, color: c, lw: 4 }));
    for (const [x, y, s] of [[470, 130, 30], [600, 210, 44], [520, 330, 24], [660, 380, 30], [110, 150, 22], [400, 430, 18]]) drawIcon(ctx, 'star', x, y, s);
  },
  grok(ctx) {
    base(ctx, 'PLAN D: MORE!!');
    rocket(ctx, 250, 370, 260, { engines: 9, spread: 2.6, fat: 0.24, ew: 0.9 });
    for (let i = 0; i < 9; i++) drawIcon(ctx, 'fire', 250 + (i / 8 - 0.5) * 162, 426, 17);
    pixText(ctx, 'X27', 440, 130, 14, INK);
    pixText(ctx, 'ENGINES', 440, 250, 6, INK);
    pixText(ctx, 'YOLO', 440, 330, 9, '#ffb04a');
  },
  final(ctx) {
    base(ctx, 'AIPOLLO 11');
    // サターン V ふうの 3 段
    const cx = 250, by = 452, lw = 5;
    ctx.strokeStyle = INK; ctx.lineWidth = lw;
    const seg = (y0, y1, w0, w1) => { ctx.beginPath(); ctx.moveTo(cx - w0, y0); ctx.lineTo(cx - w1, y1); ctx.lineTo(cx + w1, y1); ctx.lineTo(cx + w0, y0); ctx.closePath(); ctx.stroke(); };
    seg(by, by - 150, 38, 38); seg(by - 150, by - 250, 38, 38); seg(by - 250, by - 268, 38, 26); seg(by - 268, by - 330, 26, 26); seg(by - 330, by - 352, 26, 18); seg(by - 352, by - 372, 18, 18);
    ctx.beginPath(); ctx.moveTo(cx - 18, by - 372); ctx.lineTo(cx, by - 396); ctx.lineTo(cx + 18, by - 372); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, by - 396); ctx.lineTo(cx, by - 424); ctx.stroke();
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx + s * 38, by - 40); ctx.lineTo(cx + s * 62, by + 4); ctx.lineTo(cx + s * 38, by); ctx.stroke(); }
    for (let i = 0; i < 5; i++) { const ex = cx + (i - 2) * 17; ctx.beginPath(); ctx.moveTo(ex - 5, by); ctx.lineTo(ex - 8, by + 14); ctx.lineTo(ex + 8, by + 14); ctx.lineTo(ex + 5, by); ctx.stroke(); }
    // 4 つの担当
    const rows = [['spark', 'CHECK', '#ffb38f', by - 384], ['code', 'CODE', '#8fd0ff', by - 300], ['star', 'NAV', '#ffe27a', by - 200], ['fire', 'POWER X5', '#ffb04a', by - 40]];
    for (const [ic, label, col, y] of rows) {
      ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.setLineDash([6, 8]); ctx.beginPath(); ctx.moveTo(cx + 48, y); ctx.lineTo(420, y); ctx.stroke(); ctx.setLineDash([]);
      if (ic === 'code') pixText(ctx, '>_', 432, y - 20, 6, '#74ecff'); else drawIcon(ctx, ic, 452, y, 24);
      pixText(ctx, label, 498, y - 17, 5, col);
    }
  },
};

/** 設計図のテクスチャ一式 */
export function makeBlueprints() {
  const out = {};
  for (const k of Object.keys(draws)) out[k] = canvasTex(W, H, (ctx) => draws[k](ctx));
  return out;
}
