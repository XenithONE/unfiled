// 台本を URL に入れて共有する（?play=…）。中身は deflate して base64url。
import type { Studio } from "../engine/studio";
import { runScript } from "./runner";
import { parseScript } from "./script";

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(t: string): Uint8Array {
  const s = atob(t.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function encodeScript(json: string): Promise<string> {
  const data = new TextEncoder().encode(json);
  if (typeof CompressionStream === "undefined") return "r" + b64url(data);
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  return "z" + b64url(buf);
}

export async function decodeScript(param: string): Promise<string> {
  const kind = param[0];
  const bytes = unb64url(param.slice(1));
  if (kind === "r") return new TextDecoder().decode(bytes);
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

export async function shareUrl(json: string): Promise<string> {
  const code = await encodeScript(json);
  const u = new URL(location.href);
  u.search = "";
  u.hash = "";
  u.searchParams.set("play", code);
  return u.toString();
}

export async function playFromUrl(s: Studio, param: string): Promise<void> {
  try {
    const text = await decodeScript(param);
    const p = parseScript(text);
    if (!p.ops.length) {
      s.toast("共有された台本が読めませんでした", "error");
      return;
    }
    const size = p.canvas ?? (p.size ? { width: Math.round(p.size[0]), height: Math.round(p.size[1]) } : null);
    if (size) s.newDocument(size.width, size.height, { name: p.title || "AI の絵", paper: p.canvas?.paper === null ? null : p.canvas?.paper ?? "#ffffff", empty: true });
    else s.newDocument(s.doc.w, s.doc.h, { name: p.title || "AI の絵", empty: true });
    s.toast(`「${p.title || "台本"}」を再生します`);
    await runScript(s, p, { animate: true, speed: 1.5 });
    // 共有リンクの続きで描けるよう、URL から台本を外す
    const u = new URL(location.href);
    u.searchParams.delete("play");
    history.replaceState(null, "", u.toString());
  } catch (e) {
    console.warn(e);
    s.toast("共有された台本が読めませんでした", "error");
  }
}
