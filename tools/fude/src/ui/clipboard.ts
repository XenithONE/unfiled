// コピー・切り取り・貼り付け。アプリ内の控えに加えて、OS のクリップボードへも画像として書く（できる環境だけ）。
import { addImageLayer, clearArea } from "../engine/layerOps";
import { readSelection } from "../engine/selection";
import type { Studio } from "../engine/studio";

let clip: { x: number; y: number; w: number; h: number; data: ImageData } | null = null;

function regionCanvas(img: ImageData): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d")!.putImageData(img, 0, 0);
  return c;
}

export function copySel(s: Studio): boolean {
  const l = s.doc.paintTarget();
  if (!l?.tex) return false;
  const d = s.doc;
  const r = d.selBounds ?? l.bounds;
  if (!r) {
    s.toast("コピーする物がありません", "warn");
    return false;
  }
  const x0 = Math.max(0, Math.floor(r.x));
  const y0 = Math.max(0, Math.floor(r.y));
  const w = Math.min(d.w, Math.ceil(r.x + r.w)) - x0;
  const h = Math.min(d.h, Math.ceil(r.y + r.h)) - y0;
  if (w <= 0 || h <= 0) return false;
  const px = s.g.read(l.tex, x0, y0, w, h);
  const sel = d.selection ? readSelection(s) : null;
  const img = new ImageData(w, h);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const o = (j * w + i) * 4;
      const m = sel ? sel[(y0 + j) * d.w + x0 + i] / 255 : 1;
      const a = px[o + 3] * m;
      if (a < 0.5) continue;
      const k = 255 / px[o + 3];
      img.data[o] = px[o] * k;
      img.data[o + 1] = px[o + 1] * k;
      img.data[o + 2] = px[o + 2] * k;
      img.data[o + 3] = a;
    }
  clip = { x: x0, y: y0, w, h, data: img };
  try {
    regionCanvas(img).toBlob((b) => {
      if (b && navigator.clipboard && "write" in navigator.clipboard) {
        navigator.clipboard.write([new ClipboardItem({ "image/png": b })]).catch(() => undefined);
      }
    }, "image/png");
  } catch {
    /* 書けない環境 */
  }
  s.toast("コピーしました");
  return true;
}

export function cutSel(s: Studio): void {
  if (copySel(s)) clearArea(s);
}

export function pasteInternal(s: Studio): boolean {
  if (!clip) {
    s.toast("貼り付ける物がありません（画像は Ctrl+V で貼れます）", "warn");
    return false;
  }
  addImageLayer(s, regionCanvas(clip.data), "貼り付け", { x: clip.x, y: clip.y, w: clip.w, h: clip.h });
  s.emit("pixels");
  return true;
}

/** 画像ファイル・貼り付けた画像を新しいレイヤーへ。 */
export async function importImageFile(s: Studio, file: Blob, name = "画像"): Promise<void> {
  try {
    const bmp = await createImageBitmap(file);
    addImageLayer(s, bmp, name);
    bmp.close?.();
    s.emit("pixels");
    s.toast(`「${name}」を新しいレイヤーに置きました`);
  } catch {
    s.toast("画像を読み込めませんでした", "error");
  }
}

export function installPaste(s: Studio): () => void {
  const onPaste = (e: ClipboardEvent) => {
    const a = document.activeElement as HTMLElement | null;
    if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA")) return;
    const items = e.clipboardData?.items;
    if (items) {
      for (const it of items) {
        if (it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) {
            e.preventDefault();
            void importImageFile(s, f, "貼り付けた画像");
            return;
          }
        }
      }
    }
    if (clip) {
      e.preventDefault();
      pasteInternal(s);
    }
  };
  document.addEventListener("paste", onPaste);
  return () => document.removeEventListener("paste", onPaste);
}
