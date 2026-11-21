// ブラウザ内（IndexedDB）への自動保存と、作品一覧。
// 画素はレイヤーの生データ（乗算済み RGBA / マスクは 1 チャンネル）を deflate で縮めて保存する。
import { Doc, Layer, type LayerKind, type LayerProps, type TextProps } from "../engine/doc";
import type { Rect } from "../engine/gl";
import type { Studio } from "../engine/studio";

const DB = "fude";
const VER = 1;

export interface SavedNode {
  id: string;
  kind: LayerKind;
  props: LayerProps;
  text: TextProps | null;
  hasMask: boolean;
  bounds: Rect | null;
  children: SavedNode[];
}

export interface DocMeta {
  docId: string;
  name: string;
  w: number;
  h: number;
  created: number;
  updated: number;
  paper: { color: string; visible: boolean };
  activeId: string;
  tree: SavedNode;
  thumb: Blob | null;
}

interface PixelRow {
  key: string;
  docId: string;
  data: Blob;
  raw: boolean;
}

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains("docs")) d.createObjectStore("docs", { keyPath: "docId" });
      if (!d.objectStoreNames.contains("pixels")) {
        const s = d.createObjectStore("pixels", { keyPath: "key" });
        s.createIndex("doc", "docId");
      }
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function compress(data: Uint8Array): Promise<{ blob: Blob; raw: boolean }> {
  if (typeof CompressionStream === "undefined") return { blob: new Blob([data as BlobPart]), raw: true };
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return { blob: await new Response(stream).blob(), raw: false };
}

async function decompress(row: PixelRow): Promise<Uint8Array> {
  if (row.raw) return new Uint8Array(await row.data.arrayBuffer());
  const stream = row.data.stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toSaved(l: Layer): SavedNode {
  return {
    id: l.id,
    kind: l.kind,
    props: { ...l.props },
    text: l.text ? { ...l.text } : null,
    hasMask: !!l.mask,
    bounds: l.bounds ? { ...l.bounds } : null,
    children: l.children.map(toSaved),
  };
}

const saved = new WeakMap<Doc, Map<string, number>>();

export async function saveDoc(s: Studio, thumb = true): Promise<void> {
  const d = s.doc;
  const g = s.g;
  let vers = saved.get(d);
  if (!vers) {
    vers = new Map();
    saved.set(d, vers);
  }
  const live = d.allLayers();
  const keys = new Set<string>();
  const puts: PixelRow[] = [];
  for (const l of live) {
    if (l.isGroup) continue;
    for (const ch of ["color", "mask"] as const) {
      const tex = ch === "mask" ? l.mask : l.tex;
      if (!tex) continue;
      const key = `${d.docId}/${l.id}/${ch}`;
      keys.add(key);
      const vk = `${l.id}/${ch}`;
      if (vers.get(vk) === l.version) continue;
      const px = g.read(tex);
      const c = await compress(px);
      puts.push({ key, docId: d.docId, data: c.blob, raw: c.raw });
      vers.set(vk, l.version);
    }
  }
  let thumbBlob: Blob | null = null;
  if (thumb) thumbBlob = await compositeThumb(s, 360);
  const meta: DocMeta = {
    docId: d.docId,
    name: d.name,
    w: d.w,
    h: d.h,
    created: d.created,
    updated: Date.now(),
    paper: { ...d.paper },
    activeId: d.activeId,
    tree: toSaved(d.root),
    thumb: thumbBlob,
  };
  const database = await db();
  const tx = database.transaction(["docs", "pixels"], "readwrite");
  const px = tx.objectStore("pixels");
  for (const p of puts) px.put(p);
  // 消えたレイヤーの画素を捨てる
  const old = (await req(px.index("doc").getAllKeys(d.docId))) as string[];
  for (const k of old) if (!keys.has(k)) px.delete(k);
  if (!thumbBlob) {
    const prev = (await req(tx.objectStore("docs").get(d.docId))) as DocMeta | undefined;
    meta.thumb = prev?.thumb ?? null;
  }
  tx.objectStore("docs").put(meta);
  await new Promise<void>((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
  setLastDoc(d.docId);
}

export async function compositeThumb(s: Studio, max: number): Promise<Blob | null> {
  const d = s.doc;
  const k = Math.min(1, max / Math.max(d.w, d.h));
  const tw = Math.max(1, Math.round(d.w * k));
  const th = Math.max(1, Math.round(d.h * k));
  const full = s.readComposite(undefined, true);
  const c = document.createElement("canvas");
  c.width = d.w;
  c.height = d.h;
  c.getContext("2d")!.putImageData(new ImageData(full.data, d.w, d.h), 0, 0);
  const t = document.createElement("canvas");
  t.width = tw;
  t.height = th;
  const tc = t.getContext("2d")!;
  tc.imageSmoothingQuality = "high";
  tc.drawImage(c, 0, 0, tw, th);
  return new Promise((res) => t.toBlob((b) => res(b), "image/webp", 0.85));
}

function setLastDoc(id: string): void {
  try {
    localStorage.setItem("fude:last", id);
  } catch {
    /* 覚えられない環境 */
  }
}

function lastDoc(): string | null {
  try {
    return localStorage.getItem("fude:last");
  } catch {
    return null;
  }
}

export async function listDocs(): Promise<DocMeta[]> {
  const database = await db();
  const all = (await req(database.transaction("docs").objectStore("docs").getAll())) as DocMeta[];
  return all.sort((a, b) => b.updated - a.updated);
}

export async function deleteDoc(docId: string): Promise<void> {
  const database = await db();
  const tx = database.transaction(["docs", "pixels"], "readwrite");
  tx.objectStore("docs").delete(docId);
  const px = tx.objectStore("pixels");
  const keys = (await req(px.index("doc").getAllKeys(docId))) as string[];
  for (const k of keys) px.delete(k);
  await new Promise<void>((res) => {
    tx.oncomplete = () => res();
    tx.onerror = () => res();
  });
}

export async function loadDoc(s: Studio, docId: string): Promise<boolean> {
  const database = await db();
  const meta = (await req(database.transaction("docs").objectStore("docs").get(docId))) as DocMeta | undefined;
  if (!meta) return false;
  const tx = database.transaction("pixels");
  const store = tx.objectStore("pixels");
  const rows = (await req(store.index("doc").getAll(docId))) as PixelRow[];
  const byKey = new Map(rows.map((r) => [r.key, r]));
  s.newDocument(meta.w, meta.h, { empty: true, paper: meta.paper.visible ? meta.paper.color : null, name: meta.name });
  const d = s.doc;
  d.docId = meta.docId;
  d.created = meta.created;
  d.paper = { ...meta.paper };
  const g = s.g;
  const build = async (n: SavedNode, parent: Layer): Promise<void> => {
    let l: Layer;
    if (n.kind === "group") l = d.createGroup(n.props.name);
    else if (n.kind === "text" && n.text) l = d.createText(n.props.name, n.text);
    else l = d.createRaster(n.props.name);
    // id を元に戻す（記録との対応のため）
    d.registry.delete(l.id);
    l.id = n.id;
    d.registry.set(l.id, l);
    l.props = { ...l.props, ...n.props };
    l.bounds = n.bounds;
    d.insert(l, parent, parent.children.length);
    if (l.tex) {
      const row = byKey.get(`${docId}/${n.id}/color`);
      if (row) {
        const px = await decompress(row);
        if (px.length === d.w * d.h * 4) g.upload(l.tex, px);
      }
    }
    if (n.hasMask) {
      l.mask = g.createTex(d.w, d.h, "r8", "mask");
      const row = byKey.get(`${docId}/${n.id}/mask`);
      if (row) {
        const px = await decompress(row);
        if (px.length === d.w * d.h) g.upload(l.mask, px);
      } else g.clear(l.mask, 1, 1, 1, 1);
    }
    for (const c of n.children) await build(c, l);
  };
  for (const c of meta.tree.children) await build(c, d.root);
  d.activeId = d.find(meta.activeId) ? meta.activeId : d.allLayers().pop()?.id ?? "";
  // 読み込んだ版は保存済みとして覚える
  const vers = new Map<string, number>();
  for (const l of d.allLayers()) {
    vers.set(`${l.id}/color`, l.version);
    if (l.mask) vers.set(`${l.id}/mask`, l.version);
  }
  saved.set(d, vers);
  s.comp.markAll();
  s.view.fit();
  s.emit("doc", "layers", "pixels", "history");
  s.requestFrame();
  setLastDoc(docId);
  return true;
}

export async function restoreLatest(s: Studio): Promise<boolean> {
  const id = lastDoc();
  if (id && (await loadDoc(s, id))) return true;
  const list = await listDocs();
  if (list.length && (await loadDoc(s, list[0].docId))) return true;
  return false;
}

let timer = 0;
let busy = false;
let lastSaved = 0;
export let autosaveStatus: "idle" | "pending" | "saving" | "saved" | "error" = "idle";

export function startAutosave(s: Studio): void {
  const kick = () => {
    autosaveStatus = "pending";
    s.emit("status");
    clearTimeout(timer);
    const wait = Date.now() - lastSaved > 20000 ? 800 : 2500;
    timer = window.setTimeout(run, wait);
  };
  const run = async () => {
    if (busy || s.hist.isOpen || s.ui.aiPlaying) {
      timer = window.setTimeout(run, 1500);
      return;
    }
    busy = true;
    autosaveStatus = "saving";
    s.emit("status");
    try {
      await saveDoc(s, Date.now() - lastSaved > 15000);
      autosaveStatus = "saved";
      lastSaved = Date.now();
    } catch (e) {
      console.warn("autosave failed", e);
      autosaveStatus = "error";
    }
    busy = false;
    s.emit("status");
  };
  s.ev.on("pixels", kick);
  s.ev.on("layers", kick);
  s.ev.on("history", kick);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && autosaveStatus === "pending") void run();
  });
}

/** 今の文書のコピーを、別の作品として作品一覧に残す（今の文書はそのまま）。 */
export async function saveBackup(s: Studio, name: string): Promise<void> {
  const d = s.doc;
  const keep = { id: d.docId, name: d.name, created: d.created, vers: saved.get(d) };
  d.docId = `D${Date.now().toString(36)}b`;
  d.name = name;
  d.created = Date.now();
  saved.delete(d);
  try {
    await saveDoc(s, true);
  } finally {
    d.docId = keep.id;
    d.name = keep.name;
    d.created = keep.created;
    if (keep.vers) saved.set(d, keep.vers);
    else saved.delete(d);
    setLastDoc(keep.id);
  }
}

/** 今の文書を「別の作品」として保存し直す（複製）。 */
export async function saveAsCopy(s: Studio, name: string): Promise<void> {
  const d = s.doc;
  const oldId = d.docId;
  d.docId = `D${Date.now().toString(36)}`;
  d.name = name;
  d.created = Date.now();
  saved.delete(d);
  await saveDoc(s, true);
  void oldId;
}
