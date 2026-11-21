// タイムラプス: 手順ごとに縮めた絵を記録し、動画（WebM / MP4）にする。記録はこの画面を開いている間だけ（メモリ内）。
import type { Studio } from "../engine/studio";
import { registerAction } from "../ui/actions";
import { download, safeName } from "./files";

const MAX_FRAMES = 1800;
const SIZE = 960;

export const timelapse = {
  frames: [] as Blob[],
  docId: "",
  enabled: true,
};

let timer = 0;

async function capture(s: Studio): Promise<void> {
  if (!timelapse.enabled || s.hist.isOpen) return;
  if (timelapse.docId !== s.doc.docId) {
    timelapse.frames = [];
    timelapse.docId = s.doc.docId;
  }
  const img = s.previewImage(SIZE);
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  const t = document.createElement("canvas");
  t.width = img.width;
  t.height = img.height;
  t.getContext("2d")!.putImageData(img, 0, 0);
  ctx.drawImage(t, 0, 0);
  const b = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.82));
  if (!b) return;
  timelapse.frames.push(b);
  if (timelapse.frames.length > MAX_FRAMES) {
    // 間引いて半分に
    timelapse.frames = timelapse.frames.filter((_, i) => i % 2 === 0);
  }
}

export function startTimelapse(s: Studio): void {
  s.ev.on("history", () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => void capture(s), 350);
  });
  s.ev.on("doc", () => {
    if (timelapse.docId !== s.doc.docId) {
      timelapse.frames = [];
      timelapse.docId = s.doc.docId;
    }
  });
}

/** 記録したコマを動画にする（全体でおよそ seconds 秒）。 */
export async function exportTimelapse(s: Studio, seconds = 20, onProgress?: (p: number) => void): Promise<void> {
  const frames = timelapse.frames;
  if (frames.length < 2) {
    s.toast("まだ記録が少ないので動画にできません（何本か描いてから）", "warn");
    return;
  }
  const first = await createImageBitmap(frames[0]);
  const W = first.width - (first.width % 2);
  const H = first.height - (first.height % 2);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const fps = 30;
  const types = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4;codecs=avc1", "video/mp4"];
  const type = types.find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t));
  if (!type) {
    s.toast("このブラウザでは動画を作れません", "error");
    return;
  }
  const stream = c.captureStream(fps);
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<void>((res) => (rec.onstop = () => res()));
  rec.start(500);
  const per = Math.max(1 / fps, Math.min(0.5, seconds / frames.length));
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < frames.length; i++) {
    const bmp = i === 0 ? first : await createImageBitmap(frames[i]);
    ctx.drawImage(bmp, 0, 0, W, H);
    bmp.close?.();
    onProgress?.(i / frames.length);
    await wait(per * 1000);
  }
  await wait(2000);
  rec.stop();
  await done;
  const blob = new Blob(chunks, { type: type.split(";")[0] });
  download(blob, `${safeName(s)}_タイムラプス.${type.includes("mp4") ? "mp4" : "webm"}`);
}

registerAction("timelapse", {
  label: "タイムラプスを書き出す…",
  run: (s) => s.openDialog("timelapse"),
});
