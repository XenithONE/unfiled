// ファイルの読み書き（画像の書き出し・読み込み・ドラッグ＆ドロップ）。
import type { Studio } from "../engine/studio";
import { importImageFile } from "../ui/clipboard";
import { addImageLayer } from "../engine/layerOps";
import { registerAction } from "../ui/actions";
import { saveAsCopy, saveDoc } from "./autosave";
import { jaMessage } from "../ai/runner";
import { docToIO, ioToDoc } from "./docio";
import { readOra, writeOra } from "./ora";
import { readPsd, writePsd } from "./psd";

export function download(blob: Blob, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function safeName(s: Studio): string {
  const n = (s.doc.name || "fude").replace(/[\\/:*?"<>|]+/g, "_").trim() || "fude";
  return n;
}

/** 合成した絵を画像にする。scale で拡大縮小。 */
export async function compositeBlob(s: Studio, type: "image/png" | "image/jpeg" | "image/webp", quality = 0.92, scale = 1, withPaper = true): Promise<Blob> {
  const d = s.doc;
  const img = s.readComposite(undefined, withPaper || type === "image/jpeg", (l) => !l.props.isDraft);
  const c = document.createElement("canvas");
  c.width = d.w;
  c.height = d.h;
  const ctx = c.getContext("2d")!;
  if (type === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, d.w, d.h);
    const t = document.createElement("canvas");
    t.width = d.w;
    t.height = d.h;
    t.getContext("2d")!.putImageData(new ImageData(img.data, d.w, d.h), 0, 0);
    ctx.drawImage(t, 0, 0);
  } else ctx.putImageData(new ImageData(img.data, d.w, d.h), 0, 0);
  let out = c;
  if (scale !== 1) {
    out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(d.w * scale));
    out.height = Math.max(1, Math.round(d.h * scale));
    const oc = out.getContext("2d")!;
    oc.imageSmoothingQuality = "high";
    oc.drawImage(c, 0, 0, out.width, out.height);
  }
  return new Promise((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error("画像にできませんでした"))), type, quality));
}

export function pickFile(accept: string, multiple = false): Promise<File[]> {
  return new Promise((res) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = accept;
    inp.multiple = multiple;
    inp.onchange = () => res(inp.files ? [...inp.files] : []);
    inp.click();
  });
}

/** 画像を新しいキャンバスとして開く。 */
export async function openImageAsDoc(s: Studio, file: File): Promise<void> {
  const bmp = await createImageBitmap(file);
  s.newDocument(bmp.width, bmp.height, { paper: "#ffffff", name: file.name.replace(/\.[^.]+$/, ""), empty: true });
  addImageLayer(s, bmp, file.name.replace(/\.[^.]+$/, ""), { x: 0, y: 0, w: bmp.width, h: bmp.height });
  s.hist.reset();
  s.view.fit();
  s.emit("pixels", "layers", "history");
}

export type Opener = (s: Studio, f: File) => Promise<boolean>;
const openers: { test: (f: File) => boolean; open: Opener }[] = [
  {
    test: (f) => /\.psd$/i.test(f.name),
    open: async (s, f) => {
      ioToDoc(s, readPsd(new Uint8Array(await f.arrayBuffer())), f.name.replace(/\.[^.]+$/, ""));
      s.toast(`「${f.name}」を開きました`);
      return true;
    },
  },
  {
    test: (f) => /\.(ora|fude)$/i.test(f.name),
    open: async (s, f) => {
      ioToDoc(s, await readOra(new Uint8Array(await f.arrayBuffer())), f.name.replace(/\.[^.]+$/, ""));
      s.toast(`「${f.name}」を開きました`);
      return true;
    },
  },
];
export function registerOpener(test: (f: File) => boolean, open: Opener): void {
  openers.push({ test, open });
}

export async function openAny(s: Studio, f: File, asLayer = false): Promise<void> {
  for (const o of openers) {
    if (o.test(f)) {
      try {
        if (await o.open(s, f)) return;
      } catch (e) {
        console.warn(e);
        s.toast(`「${f.name}」を開けませんでした: ${jaMessage(e)}`, "error");
        return;
      }
    }
  }
  if (f.type.startsWith("image/")) {
    if (asLayer) await importImageFile(s, f, f.name.replace(/\.[^.]+$/, ""));
    else await openImageAsDoc(s, f);
    return;
  }
  s.toast(`「${f.name}」は開けない形式です`, "warn");
}

export function installDrop(s: Studio, el: HTMLElement): () => void {
  const over = (e: DragEvent) => {
    if (e.dataTransfer?.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  };
  const drop = async (e: DragEvent) => {
    const files = e.dataTransfer?.files;
    if (!files || !files.length) return;
    e.preventDefault();
    for (const f of files) await openAny(s, f, f.type.startsWith("image/"));
  };
  el.addEventListener("dragover", over);
  el.addEventListener("drop", drop);
  return () => {
    el.removeEventListener("dragover", over);
    el.removeEventListener("drop", drop);
  };
}

export function registerFileActions(s: Studio): void {
  const exp = (type: "image/png" | "image/jpeg" | "image/webp", ext: string) => async () => {
    try {
      const b = await compositeBlob(s, type, 0.93, 1, s.doc.paper.visible);
      download(b, `${safeName(s)}.${ext}`);
    } catch (e) {
      s.toast(`書き出せませんでした: ${jaMessage(e)}`, "error");
    }
  };
  registerAction("exportPsd", {
    label: "PSD で書き出す（レイヤーつき）",
    run: async () => {
      try {
        s.toast("PSD を作っています…");
        await new Promise((r) => setTimeout(r, 30));
        const data = writePsd(docToIO(s, true));
        download(new Blob([data as BlobPart], { type: "image/vnd.adobe.photoshop" }), `${safeName(s)}.psd`);
      } catch (e) {
        s.toast(`PSD にできませんでした: ${jaMessage(e)}`, "error");
      }
    },
  });
  registerAction("exportOra", {
    label: "ORA で書き出す（Krita などで開ける）",
    run: async () => {
      try {
        const io = docToIO(s, true);
        const th = s.previewImage(256);
        const data = await writeOra(io, { rgba: new Uint8Array(th.data.buffer), w: th.width, h: th.height });
        download(new Blob([data as BlobPart], { type: "image/openraster" }), `${safeName(s)}.ora`);
      } catch (e) {
        s.toast(`ORA にできませんでした: ${jaMessage(e)}`, "error");
      }
    },
  });
  registerAction("exportPng", { label: "PNG で書き出す", key: "Ctrl+Shift+S", bind: ["ctrl+shift+s"], run: () => void exp("image/png", "png")() });
  registerAction("exportJpeg", { label: "JPEG で書き出す", run: () => void exp("image/jpeg", "jpg")() });
  registerAction("exportWebp", { label: "WebP で書き出す", run: () => void exp("image/webp", "webp")() });
  registerAction("open", {
    label: "開く（画像・PSD・ORA）…",
    key: "Ctrl+O",
    bind: ["ctrl+o"],
    run: async () => {
      const [f] = await pickFile("image/*,.psd,.ora,.fude");
      if (f) await openAny(s, f, false);
    },
  });
  registerAction("importLayer", {
    label: "画像をレイヤーとして読み込む…",
    run: async () => {
      const fs = await pickFile("image/*", true);
      for (const f of fs) await importImageFile(s, f, f.name.replace(/\.[^.]+$/, ""));
    },
  });
  registerAction("save", {
    label: "ブラウザに保存",
    key: "Ctrl+S",
    bind: ["ctrl+s"],
    run: async () => {
      try {
        await saveDoc(s, true);
        s.toast("この端末のブラウザに保存しました（ファイル › 作品一覧から開けます）");
      } catch {
        s.toast("保存できませんでした（ブラウザの保存領域が使えない可能性があります）", "error");
      }
    },
  });
  registerAction("saveCopy", {
    label: "別の作品として保存",
    run: async () => {
      await saveAsCopy(s, `${s.doc.name} のコピー`);
      s.emit("doc");
      s.toast("別の作品として保存しました");
    },
  });
  registerAction("copyImage", {
    label: "絵を画像としてコピー（AI に見せる用）",
    run: async () => {
      try {
        const b = await compositeBlob(s, "image/png", 1, Math.min(1, 1600 / Math.max(s.doc.w, s.doc.h)));
        await navigator.clipboard.write([new ClipboardItem({ "image/png": b })]);
        s.toast("絵をコピーしました。AI のチャットに貼り付けられます");
      } catch {
        s.toast("この環境ではコピーできませんでした。PNG で書き出して添付してください", "warn");
      }
    },
  });
}
