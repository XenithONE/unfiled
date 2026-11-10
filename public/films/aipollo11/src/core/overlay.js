// 画面に重ねる文字：字幕・試行結果の札・題字・秒読み・名言・中継のテロップ・エンドクレジット
import { pixText, pixWidth } from './pixfont.js';
import { clamp, ease } from './util.js';

const JP = '"BIZ UDPGothic", "Yu Gothic UI", "Meiryo", sans-serif';
const r2 = (v) => Math.round(v * 50) / 50;

/** 日本語字幕（下中央・白文字に黒ふち） */
export function subtitle(E, text, a = 1, y = 1004) {
  if (!text || a <= 0.01) return;
  E.ovAdd(`sub:${text}:${r2(a)}:${y}`, (ctx) => {
    ctx.globalAlpha = clamp(a);
    ctx.font = `700 46px ${JP}`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round'; ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(0,0,0,0.92)'; ctx.fillStyle = '#ffffff';
    const lines = text.split('\n');
    lines.forEach((ln, i) => { const yy = y - (lines.length - 1 - i) * 60; ctx.strokeText(ln, 960, yy); ctx.fillText(ln, 960, yy); });
  });
}

function panel(ctx, x, y, w, h, r = 18, fill = 'rgba(10,14,24,0.86)', stroke = 'rgba(255,255,255,0.22)') {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.lineWidth = 3; ctx.strokeStyle = stroke; ctx.stroke(); }
}

/**
 * 試行結果の札（端末ふう）。k: 出かた 0..1、typed: 2 行目の打たれた割合 0..1、stamp: 判定の出かた 0..1
 */
export function card(E, { k = 1, cmd, status, statusColor = '#ff5d52', detail = '', typed = 1, stamp = 1, mark = '✗' }) {
  if (k <= 0.01) return;
  E.ovAdd(`card:${cmd}:${status}:${detail}:${r2(k)}:${r2(typed)}:${r2(stamp)}`, (ctx) => {
    const w = 1180, h = 176, x = 960 - w / 2, y = 742 + (1 - ease.out3(clamp(k))) * 380;
    ctx.globalAlpha = clamp(k * 1.6);
    panel(ctx, x, y, w, h, 20);
    for (let i = 0; i < 3; i++) { ctx.fillStyle = ['#ff5f57', '#febc2e', '#28c840'][i]; ctx.beginPath(); ctx.arc(x + 34 + i * 30, y + 30, 9, 0, 7); ctx.fill(); }
    const n = Math.floor(cmd.length * clamp(typed * 1.0));
    pixText(ctx, '$ ' + cmd, x + 40, y + 58, 5, '#9fb0c8', { mono: true, count: n + 2 });
    if (typed >= 1 && stamp > 0.01) {
      const s = 7 + Math.round((1 - ease.out3(clamp(stamp))) * 10);
      ctx.globalAlpha = clamp(stamp * 2) * clamp(k * 1.6);
      const tw = pixText(ctx, mark + ' ' + status, x + 40, y + 112 - (s - 7) * 3, s, statusColor, { shadow: { color: 'rgba(0,0,0,0.5)' } });
      if (stamp >= 1 && detail) pixText(ctx, detail, x + 40 + tw + 44, y + 118, 5, '#dfe6f2');
    }
  });
}

/** 題字「AIPOLLO 11」 */
export function title(E, k = 1, a = 1, sub = 'A SHORT FILM MADE ENTIRELY OF CODE') {
  if (a <= 0.01) return;
  E.ovAdd(`title:${r2(k)}:${r2(a)}:${sub}`, (ctx) => {
    ctx.globalAlpha = clamp(a);
    const s = 26;
    const str = 'AIPOLLO 11';
    const n = Math.ceil(str.length * clamp(k));
    const w = pixWidth(str, s);
    pixText(ctx, str, 960 - w / 2, 372, s, '#ffffff', { count: n, shadow: { dx: 7, dy: 7, color: 'rgba(217,119,87,0.9)' } });
    if (k >= 1 && sub) pixText(ctx, sub, 960, 600, 5, '#dfe6f2', { align: 'center', shadow: { color: 'rgba(0,0,0,0.6)' } });
  });
}

/** 人間からの依頼文（入力欄ふう）。typed: 打たれた割合 */
export function promptBox(E, { k = 1, text = 'GO TO THE MOON.', typed = 1, blinkOn = true, y = 760 }) {
  if (k <= 0.01) return;
  E.ovAdd(`prompt:${text}:${r2(k)}:${r2(typed)}:${blinkOn}`, (ctx) => {
    const w = 1040, h = 130, x = 960 - w / 2, yy = y + (1 - ease.out3(clamp(k))) * 60;
    ctx.globalAlpha = clamp(k);
    panel(ctx, x, yy, w, h, 34, 'rgba(18,22,34,0.9)', 'rgba(255,255,255,0.28)');
    const n = Math.floor(text.length * clamp(typed));
    const tw = pixText(ctx, '> ' + text.slice(0, n), x + 52, yy + 42, 7, '#ffffff');
    if (blinkOn) { ctx.fillStyle = '#e8845c'; ctx.fillRect(x + 52 + tw + 12, yy + 40, 28, 52); }
  });
}

/** 秒読みの大きな数字 */
export function bigNumber(E, txt, k = 1, a = 1, color = '#ffffff', y = 420) {
  if (a <= 0.01) return;
  E.ovAdd(`big:${txt}:${r2(k)}:${r2(a)}`, (ctx) => {
    ctx.globalAlpha = clamp(a);
    const s = Math.max(4, Math.round(44 * k));
    pixText(ctx, txt, 960, y - s * 3.5, s, color, { align: 'center', shadow: { dx: Math.ceil(s / 4), dy: Math.ceil(s / 4), color: 'rgba(0,0,0,0.55)' } });
  });
}

/** 画面の一行（中央・ドット文字） */
export function line(E, txt, { y = 140, s = 6, a = 1, color = '#ffffff', typed = 1, align = 'center', x = 960, shadow = true } = {}) {
  if (a <= 0.01 || !txt) return;
  E.ovAdd(`line:${txt}:${y}:${s}:${r2(a)}:${r2(typed)}:${color}`, (ctx) => {
    ctx.globalAlpha = clamp(a);
    pixText(ctx, txt, x, y, s, color, { align, count: Math.ceil(txt.length * clamp(typed)), shadow: shadow ? { color: 'rgba(0,0,0,0.65)' } : null });
  });
}

/** あの名言（2 行・中央上寄り）。t1, t2 は各行の打たれた割合 */
export function quote(E, { l1, l2, t1 = 1, t2 = 0, a = 1, y = 236, s = 9 }) {
  if (a <= 0.01) return;
  E.ovAdd(`quote:${r2(t1)}:${r2(t2)}:${r2(a)}:${y}`, (ctx) => {
    ctx.globalAlpha = clamp(a);
    const draw = (txt, yy, t) => {
      if (t <= 0) return;
      const n = Math.ceil(txt.length * clamp(t));
      const w = pixWidth(txt, s);
      pixText(ctx, txt, 960 - w / 2, yy, s, '#ffffff', { count: n, outline: { size: 3, color: 'rgba(6,10,24,0.85)' }, shadow: { dx: 5, dy: 6, color: 'rgba(0,0,0,0.6)' } });
    };
    draw(l1, y, t1); draw(l2, y + s * 11, t2);
  });
}

/** テレビ中継のテロップ（4:3 の枠の中） */
export function tvChyron(E, a = 1, blinkOn = true) {
  if (a <= 0.01) return;
  E.ovAdd(`tv:${r2(a)}:${blinkOn}`, (ctx) => {
    ctx.globalAlpha = clamp(a) * 0.92;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(300, 880, 720, 86);
    pixText(ctx, 'LIVE FROM THE MOON', 322, 902, 6, '#f2f2f2');
    if (blinkOn) { ctx.fillStyle = '#f2f2f2'; ctx.beginPath(); ctx.arc(1560, 132, 14, 0, 7); ctx.fill(); }
    pixText(ctx, 'LIVE', 1440, 114, 5, '#f2f2f2');
  });
}

/** エンドクレジット */
export function credits(E, a = 1, stage = 3) {
  if (a <= 0.01) return;
  E.ovAdd(`cred:${r2(a)}:${stage}`, (ctx) => {
    ctx.globalAlpha = clamp(a);
    pixText(ctx, 'AIPOLLO 11', 960, 250, 16, '#ffffff', { align: 'center', shadow: { dx: 5, dy: 5, color: 'rgba(217,119,87,0.9)' } });
    if (stage >= 1) pixText(ctx, '100% CODE.  NO IMAGE OR VIDEO GENERATION.', 960, 470, 5, '#dfe6f2', { align: 'center' });
    if (stage >= 2) pixText(ctx, 'THREE.JS R187 · WEBGPU · TSL · GPU FLUID SIMULATION · WEBAUDIO', 960, 540, 5, '#9fb0c8', { align: 'center' });
    if (stage >= 3) {
      pixText(ctx, 'STARRING  CLAUDE · GPT · GEMINI · GROK', 960, 640, 5, '#dfe6f2', { align: 'center' });
      pixText(ctx, 'WRITTEN, ANIMATED AND SCORED BY  CLAUDE FABLE 5.2', 960, 710, 5, '#e8845c', { align: 'center' });
      ctx.font = `700 34px ${JP}`; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.82)';
      ctx.fillText('すべてコードで描きました（画像生成・動画生成は使っていません）', 960, 830);
    }
  });
}
