// テキストレイヤーの描画（横書き・縦書き・フチ）。
import type { Layer, TextProps } from "./doc";
import type { Rect } from "./gl";
import type { Studio } from "./studio";

const ROTATE = new Set("ー－—―…‥〜～()（）「」『』【】〔〕〈〉《》［］｛｝<>＜＞=＝→←-‐[]{}:：;；|｜".split(""));
const SMALL = new Set("ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ".split(""));
const PUNCT = new Set("、。，．,.".split(""));

export const FONT_FAMILY: Record<string, string> = {
  "sans-serif": `"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", "Noto Sans JP", sans-serif`,
  serif: `"Hiragino Mincho ProN", "Yu Mincho", "YuMincho", "Noto Serif JP", serif`,
  Yomogi: `"Yomogi", "Hiragino Maru Gothic ProN", sans-serif`,
  Inter: `"Inter", sans-serif`,
  "IBM Plex Mono": `"IBM Plex Mono", monospace`,
};

export function fontCss(t: TextProps): string {
  return `${t.italic ? "italic " : ""}${t.bold ? "700" : "400"} ${t.size}px ${FONT_FAMILY[t.font] ?? t.font}`;
}

let cv: HTMLCanvasElement | null = null;

export function renderText(s: Studio, l: Layer): Rect | null {
  const t = l.text;
  if (!t || !l.tex) return null;
  const d = s.doc;
  if (!cv) cv = document.createElement("canvas");
  cv.width = d.w;
  cv.height = d.h;
  const ctx = cv.getContext("2d")!;
  ctx.clearRect(0, 0, d.w, d.h);
  ctx.font = fontCss(t);
  ctx.fillStyle = t.color;
  ctx.strokeStyle = t.strokeColor;
  ctx.lineJoin = "round";
  ctx.lineWidth = t.strokeWidth * 2;
  const lines = t.text.split("\n");
  const lh = t.size * t.lineHeight;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const grow = (x: number, y: number, w: number, h: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + w);
    y1 = Math.max(y1, y + h);
  };
  const pad = t.strokeWidth + 2;
  if (!t.vertical) {
    ctx.textBaseline = "top";
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${t.letterSpacing * t.size}px`;
    let maxW = 0;
    for (const ln of lines) maxW = Math.max(maxW, ctx.measureText(ln).width);
    lines.forEach((ln, i) => {
      const w = ctx.measureText(ln).width;
      let x = t.x;
      if (t.align === "center") x = t.x + (maxW - w) / 2;
      else if (t.align === "end") x = t.x + (maxW - w);
      const y = t.y + i * lh;
      if (t.strokeWidth > 0) ctx.strokeText(ln, x, y);
      ctx.fillText(ln, x, y);
      grow(x - pad, y - pad, w + pad * 2, t.size * 1.25 + pad * 2);
    });
  } else {
    // 縦書き: (x, y) は 1 列目の右上。列は右から左へ。
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const step = t.size * (1 + t.letterSpacing);
    lines.forEach((ln, i) => {
      const cx = t.x - t.size / 2 - i * lh;
      let cy = t.y + t.size / 2;
      for (const ch of ln) {
        ctx.save();
        ctx.translate(cx, cy);
        if (ROTATE.has(ch)) ctx.rotate(Math.PI / 2);
        else if (PUNCT.has(ch)) ctx.translate(t.size * 0.55, -t.size * 0.55);
        else if (SMALL.has(ch)) ctx.translate(t.size * 0.1, -t.size * 0.1);
        if (t.strokeWidth > 0) ctx.strokeText(ch, 0, 0);
        ctx.fillText(ch, 0, 0);
        ctx.restore();
        cy += step;
      }
      grow(cx - t.size / 2 - pad, t.y - pad, t.size + pad * 2, cy - t.y + pad * 2);
    });
  }
  const g = s.g;
  const gl = g.gl;
  g.bindUtil(l.tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, cv);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  const r = Number.isFinite(x0) ? { x: Math.floor(x0), y: Math.floor(y0), w: Math.ceil(x1 - x0) + 2, h: Math.ceil(y1 - y0) + 2 } : null;
  l.bounds = null;
  l.touch(r ?? { x: 0, y: 0, w: 1, h: 1 });
  s.comp.markAll();
  s.requestFrame();
  return r;
}

export function defaultText(s: Studio, x: number, y: number, text = ""): TextProps {
  const u = s.ui.text;
  return {
    text,
    x,
    y,
    size: u.size,
    font: u.font,
    color: s.colors.main,
    vertical: u.vertical,
    bold: u.bold,
    italic: false,
    lineHeight: u.lineHeight,
    letterSpacing: 0,
    align: "start",
    strokeWidth: u.strokeWidth,
    strokeColor: s.colors.sub,
  };
}

/** テキストレイヤーの中身（文字や設定）を変える（1 手順）。 */
export function updateText(s: Studio, l: Layer, patch: Partial<TextProps>): void {
  if (!l.text) return;
  s.hist.begin("テキストの変更");
  s.hist.struct();
  s.hist.save(l, "color", { x: 0, y: 0, w: s.doc.w, h: s.doc.h });
  l.text = { ...l.text, ...patch };
  if (patch.text !== undefined) l.props.name = patch.text.slice(0, 16).replace(/\s+/g, " ") || "テキスト";
  renderText(s, l);
  s.hist.end();
  s.emit("layers", "pixels");
}
