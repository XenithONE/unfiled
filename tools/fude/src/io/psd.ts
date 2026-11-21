// PSD（Photoshop 形式）の読み書き。8bit RGB・レイヤー・フォルダー・合成モード・不透明度・
// クリッピング・透明ピクセルのロック・レイヤーマスク・日本語の名前に対応。GPU・DOM に触らない。
import { BLEND_MODES, blendFromPsd } from "../engine/blend";

export interface IOMask {
  x: number;
  y: number;
  w: number;
  h: number;
  data: Uint8Array;
  defaultColor: number;
  enabled: boolean;
}

export interface IOLayer {
  name: string;
  kind: "raster" | "group";
  visible: boolean;
  opacity: number;
  blend: string;
  clip: boolean;
  alphaLock: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 乗算していない RGBA（w*h*4） */
  rgba: Uint8Array | null;
  mask: IOMask | null;
  children: IOLayer[];
  expanded: boolean;
}

export interface IODoc {
  w: number;
  h: number;
  /** 下から上の順 */
  layers: IOLayer[];
  /** 統合した絵（乗算していない RGBA）。無ければ null */
  composite: Uint8Array | null;
}

// ---------- 書き出し ----------

class Writer {
  private buf: Uint8Array;
  private dv: DataView;
  p = 0;
  constructor(size = 1 << 20) {
    this.buf = new Uint8Array(size);
    this.dv = new DataView(this.buf.buffer);
  }
  private need(n: number): void {
    if (this.p + n <= this.buf.length) return;
    let s = this.buf.length * 2;
    while (s < this.p + n) s *= 2;
    const nb = new Uint8Array(s);
    nb.set(this.buf.subarray(0, this.p));
    this.buf = nb;
    this.dv = new DataView(nb.buffer);
  }
  u8(v: number) {
    this.need(1);
    this.dv.setUint8(this.p, v);
    this.p += 1;
  }
  u16(v: number) {
    this.need(2);
    this.dv.setUint16(this.p, v);
    this.p += 2;
  }
  i16(v: number) {
    this.need(2);
    this.dv.setInt16(this.p, v);
    this.p += 2;
  }
  u32(v: number) {
    this.need(4);
    this.dv.setUint32(this.p, v);
    this.p += 4;
  }
  i32(v: number) {
    this.need(4);
    this.dv.setInt32(this.p, v);
    this.p += 4;
  }
  sig(s: string) {
    for (let i = 0; i < 4; i++) this.u8(s.charCodeAt(i));
  }
  bytes(b: Uint8Array) {
    this.need(b.length);
    this.buf.set(b, this.p);
    this.p += b.length;
  }
  zeros(n: number) {
    this.need(n);
    this.buf.fill(0, this.p, this.p + n);
    this.p += n;
  }
  /** 長さ（u32）を後で埋める */
  lenStart(): number {
    const at = this.p;
    this.u32(0);
    return at;
  }
  lenEnd(at: number, pad = 1): void {
    let len = this.p - at - 4;
    const rem = len % pad;
    if (rem) {
      this.zeros(pad - rem);
      len += pad - rem;
    }
    this.dv.setUint32(at, len);
  }
  out(): Uint8Array {
    return this.buf.slice(0, this.p);
  }
}

/** PackBits（1 行）。 */
export function packBits(row: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  const n = row.length;
  while (i < n) {
    // 同じ値の続き
    let run = 1;
    while (i + run < n && run < 128 && row[i + run] === row[i]) run++;
    if (run >= 3) {
      out.push(257 - run, row[i]);
      i += run;
      continue;
    }
    // そのままの並び
    const start = i;
    let lit = 0;
    while (i < n && lit < 128) {
      let r = 1;
      while (i + r < n && r < 3 && row[i + r] === row[i]) r++;
      if (r >= 3) break;
      i++;
      lit++;
    }
    out.push(lit - 1);
    for (let k = start; k < start + lit; k++) out.push(row[k]);
  }
  return Uint8Array.from(out);
}

export function unpackBits(src: Uint8Array, outLen: number): Uint8Array {
  const out = new Uint8Array(outLen);
  let i = 0;
  let o = 0;
  while (o < outLen && i < src.length) {
    const h = src[i++] << 24 >> 24;
    if (h >= 0) {
      const n = h + 1;
      out.set(src.subarray(i, i + n), o);
      i += n;
      o += n;
    } else if (h !== -128) {
      const n = 1 - h;
      out.fill(src[i++], o, o + n);
      o += n;
    }
  }
  return out;
}

/** 1 チャンネル（w×h）を RLE にする: [行の長さ u16 × h][データ]。 */
function rleChannel(plane: Uint8Array, w: number, h: number): { counts: Uint16Array; data: Uint8Array[] } {
  const counts = new Uint16Array(h);
  const data: Uint8Array[] = [];
  for (let y = 0; y < h; y++) {
    const r = packBits(plane.subarray(y * w, (y + 1) * w));
    counts[y] = r.length;
    data.push(r);
  }
  return { counts, data };
}

function plane(rgba: Uint8Array, w: number, h: number, c: number): Uint8Array {
  const p = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) p[i] = rgba[i * 4 + c];
  return p;
}

function psdKey(blend: string): string {
  if (blend === "pass") return "pass";
  return BLEND_MODES.find((b) => b.id === blend)?.psd ?? "norm";
}

function asciiName(s: string): Uint8Array {
  const b: number[] = [];
  for (const ch of s.slice(0, 255)) {
    const c = ch.charCodeAt(0);
    b.push(c < 128 ? c : 63);
  }
  return Uint8Array.from(b);
}

interface Rec {
  name: string;
  top: number;
  left: number;
  bottom: number;
  right: number;
  opacity: number;
  clip: boolean;
  alphaLock: boolean;
  visible: boolean;
  blend: string;
  /** チャンネル: id とデータ（圧縮込み）。 */
  channels: { id: number; bytes: Uint8Array }[];
  mask: IOMask | null;
  section: 0 | 1 | 2 | 3;
}

function encodeChannel(p: Uint8Array, w: number, h: number): Uint8Array {
  if (w === 0 || h === 0) return Uint8Array.from([0, 0]);
  const { counts, data } = rleChannel(p, w, h);
  const total = 2 + h * 2 + data.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, 1);
  for (let y = 0; y < h; y++) dv.setUint16(2 + y * 2, counts[y]);
  let o = 2 + h * 2;
  for (const d of data) {
    out.set(d, o);
    o += d.length;
  }
  return out;
}

function flatten(layers: IOLayer[], out: Rec[]): void {
  for (const l of layers) {
    if (l.kind === "group") {
      out.push({ name: "</Layer group>", top: 0, left: 0, bottom: 0, right: 0, opacity: 1, clip: false, alphaLock: false, visible: true, blend: "normal", channels: emptyChannels(), mask: null, section: 3 });
      flatten(l.children, out);
      out.push({ name: l.name, top: 0, left: 0, bottom: 0, right: 0, opacity: l.opacity, clip: l.clip, alphaLock: false, visible: l.visible, blend: l.blend, channels: emptyChannels(), mask: l.mask, section: l.expanded ? 1 : 2 });
      continue;
    }
    const w = l.rgba ? l.w : 0;
    const h = l.rgba ? l.h : 0;
    const ch: { id: number; bytes: Uint8Array }[] = [];
    if (l.rgba && w > 0 && h > 0) {
      ch.push({ id: -1, bytes: encodeChannel(plane(l.rgba, w, h, 3), w, h) });
      for (let c = 0; c < 3; c++) ch.push({ id: c, bytes: encodeChannel(plane(l.rgba, w, h, c), w, h) });
    } else ch.push(...emptyChannels());
    if (l.mask) ch.push({ id: -2, bytes: encodeChannel(l.mask.data, l.mask.w, l.mask.h) });
    out.push({ name: l.name, top: l.y, left: l.x, bottom: l.y + h, right: l.x + w, opacity: l.opacity, clip: l.clip, alphaLock: l.alphaLock, visible: l.visible, blend: l.blend, channels: ch, mask: l.mask, section: 0 });
  }
}

function emptyChannels(): { id: number; bytes: Uint8Array }[] {
  return [-1, 0, 1, 2].map((id) => ({ id, bytes: Uint8Array.from([0, 0]) }));
}

export function writePsd(doc: IODoc): Uint8Array {
  const w = new Writer(1 << 22);
  // ヘッダー
  w.sig("8BPS");
  w.u16(1);
  w.zeros(6);
  w.u16(4);
  w.u32(doc.h);
  w.u32(doc.w);
  w.u16(8);
  w.u16(3);
  // カラーモードデータ
  w.u32(0);
  // 画像リソース（解像度 72dpi だけ）
  const res = w.lenStart();
  w.sig("8BIM");
  w.u16(1005);
  w.u16(0);
  w.u32(16);
  w.u32(72 << 16);
  w.u16(1);
  w.u16(1);
  w.u32(72 << 16);
  w.u16(1);
  w.u16(1);
  w.lenEnd(res);
  // レイヤーとマスク
  const recs: Rec[] = [];
  flatten(doc.layers, recs);
  const lm = w.lenStart();
  const li = w.lenStart();
  w.i16(-recs.length);
  for (const r of recs) {
    w.i32(r.top);
    w.i32(r.left);
    w.i32(r.bottom);
    w.i32(r.right);
    w.u16(r.channels.length);
    for (const c of r.channels) {
      w.i16(c.id);
      w.u32(c.bytes.length);
    }
    w.sig("8BIM");
    w.sig(psdKey(r.blend));
    w.u8(Math.round(Math.min(1, Math.max(0, r.opacity)) * 255));
    w.u8(r.clip ? 1 : 0);
    let flags = 8;
    if (r.alphaLock) flags |= 1;
    if (!r.visible) flags |= 2;
    if (r.section) flags |= 16;
    w.u8(flags);
    w.u8(0);
    const extra = w.lenStart();
    // マスク
    if (r.mask) {
      w.u32(20);
      w.i32(r.mask.y);
      w.i32(r.mask.x);
      w.i32(r.mask.y + r.mask.h);
      w.i32(r.mask.x + r.mask.w);
      w.u8(r.mask.defaultColor);
      w.u8(r.mask.enabled ? 0 : 2);
      w.zeros(2);
    } else w.u32(0);
    // 合成の範囲（標準の値）
    w.u32(40);
    for (let i = 0; i < 5; i++) {
      w.u32(0x0000ffff);
      w.u32(0x0000ffff);
    }
    // 名前（Pascal 文字列・4 バイト揃え）
    const nm = asciiName(r.name);
    w.u8(nm.length);
    w.bytes(nm);
    const used = 1 + nm.length;
    if (used % 4) w.zeros(4 - (used % 4));
    // 追加情報: 日本語の名前（luni）
    w.sig("8BIM");
    w.sig("luni");
    const lu = w.lenStart();
    w.u32(r.name.length);
    for (let i = 0; i < r.name.length; i++) w.u16(r.name.charCodeAt(i));
    w.lenEnd(lu, 4);
    if (r.section) {
      w.sig("8BIM");
      w.sig("lsct");
      w.u32(12);
      w.u32(r.section);
      w.sig("8BIM");
      w.sig(r.section === 3 ? "norm" : psdKey(r.blend));
    }
    w.lenEnd(extra);
  }
  for (const r of recs) for (const c of r.channels) w.bytes(c.bytes);
  w.lenEnd(li, 4);
  w.u32(0); // 全体のマスク情報
  w.lenEnd(lm, 4);
  // 統合した絵（RLE・RGBA）
  const comp = doc.composite ?? new Uint8Array(doc.w * doc.h * 4);
  const planes = [0, 1, 2, 3].map((c) => plane(comp, doc.w, doc.h, c));
  const enc = planes.map((p) => rleChannel(p, doc.w, doc.h));
  w.u16(1);
  for (const e of enc) for (let y = 0; y < doc.h; y++) w.u16(e.counts[y]);
  for (const e of enc) for (const d of e.data) w.bytes(d);
  return w.out();
}

// ---------- 読み込み ----------

class Reader {
  readonly dv: DataView;
  p = 0;
  readonly b: Uint8Array;
  constructor(b: Uint8Array) {
    this.b = b;
    this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  u8() {
    return this.dv.getUint8(this.p++);
  }
  u16() {
    const v = this.dv.getUint16(this.p);
    this.p += 2;
    return v;
  }
  i16() {
    const v = this.dv.getInt16(this.p);
    this.p += 2;
    return v;
  }
  u32() {
    const v = this.dv.getUint32(this.p);
    this.p += 4;
    return v;
  }
  i32() {
    const v = this.dv.getInt32(this.p);
    this.p += 4;
    return v;
  }
  sig() {
    let s = "";
    for (let i = 0; i < 4; i++) s += String.fromCharCode(this.u8());
    return s;
  }
  bytes(n: number) {
    const v = this.b.subarray(this.p, this.p + n);
    this.p += n;
    return v;
  }
  /** n バイト飛ばす（r.p += r.u32() と書くと、読む前の位置に足してしまうので使わない）。 */
  skip(n: number) {
    this.p += n;
  }
}

function readChannel(r: Reader, len: number, w: number, h: number): Uint8Array | null {
  const end = r.p + len;
  if (len < 2) {
    r.p = end;
    return null;
  }
  const comp = r.u16();
  let out: Uint8Array | null = null;
  if (w > 0 && h > 0) {
    if (comp === 0) out = r.bytes(w * h).slice();
    else if (comp === 1) {
      const counts: number[] = [];
      for (let y = 0; y < h; y++) counts.push(r.u16());
      out = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) out.set(unpackBits(r.bytes(counts[y]), w), y * w);
    }
  }
  r.p = end;
  return out;
}

export function readPsd(buf: Uint8Array): IODoc {
  const r = new Reader(buf);
  if (r.sig() !== "8BPS") throw new Error("PSD ではありません");
  const ver = r.u16();
  if (ver !== 1) throw new Error("PSB（大きい PSD）は読めません");
  r.p += 6;
  const nch = r.u16();
  const H = r.u32();
  const W = r.u32();
  const depth = r.u16();
  const mode = r.u16();
  if (depth !== 8) throw new Error(`${depth}bit の PSD は読めません（8bit だけ）`);
  if (mode !== 3) throw new Error("RGB 以外の PSD（CMYK・グレースケールなど）は読めません");
  r.skip(r.u32());
  r.skip(r.u32());
  const lmLen = r.u32();
  const lmEnd = r.p + lmLen;
  const flat: { rec: { name: string; top: number; left: number; bottom: number; right: number; blend: string; opacity: number; clip: boolean; alphaLock: boolean; visible: boolean; section: number; mask: IOMask | null; maskEnabled: boolean }; chans: { id: number; len: number }[] }[] = [];
  if (lmLen > 0) {
    const liLen = r.u32();
    const liEnd = r.p + liLen;
    if (liLen > 0) {
      const count = Math.abs(r.i16());
      for (let i = 0; i < count; i++) {
        const top = r.i32();
        const left = r.i32();
        const bottom = r.i32();
        const right = r.i32();
        const nc = r.u16();
        const chans: { id: number; len: number }[] = [];
        for (let k = 0; k < nc; k++) chans.push({ id: r.i16(), len: r.u32() });
        r.sig();
        const key = r.sig();
        const opacity = r.u8() / 255;
        const clip = r.u8() === 1;
        const flags = r.u8();
        r.u8();
        const extraLen = r.u32();
        const extraEnd = r.p + extraLen;
        const mLen = r.u32();
        let mask: IOMask | null = null;
        let maskEnabled = true;
        if (mLen >= 20) {
          const mt = r.i32();
          const ml = r.i32();
          const mb = r.i32();
          const mr = r.i32();
          const dc = r.u8();
          const mf = r.u8();
          maskEnabled = (mf & 2) === 0;
          mask = { x: ml, y: mt, w: Math.max(0, mr - ml), h: Math.max(0, mb - mt), data: new Uint8Array(0), defaultColor: dc, enabled: maskEnabled };
          r.p += mLen - 18;
        } else r.p += mLen;
        r.skip(r.u32());
        const nl = r.u8();
        let name = new TextDecoder("latin1").decode(r.bytes(nl));
        const used = 1 + nl;
        if (used % 4) r.p += 4 - (used % 4);
        let section = 0;
        let sectionKey = "";
        while (r.p + 12 <= extraEnd) {
          const s8 = r.sig();
          if (s8 !== "8BIM" && s8 !== "8B64") break;
          const k = r.sig();
          const len = r.u32();
          const end = r.p + len;
          if (k === "luni") {
            const n = r.u32();
            let t = "";
            for (let c = 0; c < n; c++) t += String.fromCharCode(r.u16());
            name = t.replace(/\u0000+$/, "");
          } else if (k === "lsct" || k === "lsdk") {
            section = r.u32();
            if (len >= 12) {
              r.sig();
              sectionKey = r.sig();
            }
          }
          r.p = end + (len % 2 ? 1 : 0);
          if (r.p > end + 1) r.p = end;
        }
        r.p = extraEnd;
        flat.push({ rec: { name, top, left, bottom, right, blend: sectionKey && section ? (sectionKey === "pass" ? "pass" : blendFromPsd(sectionKey)) : blendFromPsd(key), opacity, clip, alphaLock: (flags & 1) !== 0, visible: (flags & 2) === 0, section, mask, maskEnabled }, chans });
      }
      // 画素
      const rasters: { rgba: Uint8Array | null; mask: Uint8Array | null }[] = [];
      for (const f of flat) {
        const w = Math.max(0, f.rec.right - f.rec.left);
        const h = Math.max(0, f.rec.bottom - f.rec.top);
        const planes: Record<number, Uint8Array | null> = {};
        let maskData: Uint8Array | null = null;
        for (const c of f.chans) {
          if (c.id === -2 && f.rec.mask) maskData = readChannel(r, c.len, f.rec.mask.w, f.rec.mask.h);
          else if (c.id >= -1 && c.id <= 2) planes[c.id] = readChannel(r, c.len, w, h);
          else r.p += c.len;
        }
        let rgba: Uint8Array | null = null;
        if (w > 0 && h > 0 && planes[0]) {
          rgba = new Uint8Array(w * h * 4);
          for (let i = 0; i < w * h; i++) {
            rgba[i * 4] = planes[0]?.[i] ?? 0;
            rgba[i * 4 + 1] = planes[1]?.[i] ?? 0;
            rgba[i * 4 + 2] = planes[2]?.[i] ?? 0;
            rgba[i * 4 + 3] = planes[-1]?.[i] ?? 255;
          }
        }
        rasters.push({ rgba, mask: maskData });
      }
      r.p = liEnd;
      // 木に組み直す（下から上へ。lsct 3 で始まり、1/2 で閉じる）
      const root: IOLayer[] = [];
      const stack: IOLayer[][] = [root];
      flat.forEach((f, i) => {
        const cur = stack[stack.length - 1];
        const rec = f.rec;
        const mk = rec.mask && rasters[i].mask ? { ...rec.mask, data: rasters[i].mask!, enabled: rec.maskEnabled } : null;
        if (rec.section === 3) {
          stack.push([]);
          return;
        }
        if (rec.section === 1 || rec.section === 2) {
          const kids = stack.length > 1 ? stack.pop()! : [];
          const parent = stack[stack.length - 1];
          parent.push({ name: rec.name, kind: "group", visible: rec.visible, opacity: rec.opacity, blend: rec.blend, clip: rec.clip, alphaLock: false, x: 0, y: 0, w: 0, h: 0, rgba: null, mask: mk, children: kids, expanded: rec.section === 1 });
          return;
        }
        cur.push({ name: rec.name, kind: "raster", visible: rec.visible, opacity: rec.opacity, blend: rec.blend === "pass" ? "normal" : rec.blend, clip: rec.clip, alphaLock: rec.alphaLock, x: rec.left, y: rec.top, w: Math.max(0, rec.right - rec.left), h: Math.max(0, rec.bottom - rec.top), rgba: rasters[i].rgba, mask: mk, children: [], expanded: true });
      });
      while (stack.length > 1) {
        const kids = stack.pop()!;
        stack[stack.length - 1].push(...kids);
      }
      r.p = lmEnd;
      return { w: W, h: H, layers: root, composite: readComposite(r, W, H, nch) };
    }
  }
  r.p = lmEnd;
  return { w: W, h: H, layers: [], composite: readComposite(r, W, H, nch) };
}

function readComposite(r: Reader, W: number, H: number, nch: number): Uint8Array | null {
  if (r.p + 2 > r.b.length) return null;
  const comp = r.u16();
  const planes: Uint8Array[] = [];
  if (comp === 0) {
    for (let c = 0; c < nch; c++) planes.push(r.bytes(W * H));
  } else if (comp === 1) {
    const counts: number[] = [];
    for (let i = 0; i < nch * H; i++) counts.push(r.u16());
    for (let c = 0; c < nch; c++) {
      const pl = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) pl.set(unpackBits(r.bytes(counts[c * H + y]), W), y * W);
      planes.push(pl);
    }
  } else return null;
  const out = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    out[i * 4] = planes[0][i];
    out[i * 4 + 1] = planes[1]?.[i] ?? planes[0][i];
    out[i * 4 + 2] = planes[2]?.[i] ?? planes[0][i];
    out[i * 4 + 3] = nch >= 4 ? planes[3][i] : 255;
  }
  return out;
}
