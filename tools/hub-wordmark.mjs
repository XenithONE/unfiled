// Extracts the outlines of the hub's wordmark from the bundled Syne ExtraBold
// (WOFF, TrueType outlines) and writes them as plain path commands, so the hub
// can extrude real 3D letters without shipping a font parser.
//
//   node tools/hub-wordmark.mjs            -> src/stage/wordmark.json
//
// Only simple glyphs are handled (the seven letters of "UNFILED" are simple).
import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const TEXT = "UNFILED";
const LETTER_SPACING_EM = -0.035;
const FONT = "node_modules/@fontsource/syne/files/syne-latin-800-normal.woff";
const OUT = "src/stage/wordmark.json";

const woff = readFileSync(FONT);
if (woff.toString("latin1", 0, 4) !== "wOFF") throw new Error("not a WOFF file");
const tables = {};
for (let i = 0, n = woff.readUInt16BE(12); i < n; i++) {
  const o = 44 + i * 20;
  const tag = woff.toString("latin1", o, o + 4);
  const offset = woff.readUInt32BE(o + 4);
  const compLength = woff.readUInt32BE(o + 8);
  const origLength = woff.readUInt32BE(o + 12);
  const data = woff.subarray(offset, offset + compLength);
  tables[tag] = compLength < origLength ? inflateSync(data) : data;
}
for (const tag of ["head", "maxp", "hhea", "hmtx", "cmap", "loca", "glyf"])
  if (!tables[tag]) throw new Error(`font has no ${tag} table (not TrueType outlines?)`);

const { head, hhea, hmtx, cmap, loca, glyf } = tables;
const unitsPerEm = head.readUInt16BE(18);
const longLoca = head.readInt16BE(50) === 1;
const numHMetrics = hhea.readUInt16BE(34);

const advance = (g) => hmtx.readUInt16BE(Math.min(g, numHMetrics - 1) * 4);
const glyphOffset = (g) => (longLoca ? loca.readUInt32BE(g * 4) : loca.readUInt16BE(g * 2) * 2);

/** cmap format 4 lookup (Unicode BMP). */
function glyphIndex(code) {
  for (let i = 0, n = cmap.readUInt16BE(2); i < n; i++) {
    const rec = 4 + i * 8;
    const platform = cmap.readUInt16BE(rec);
    const encoding = cmap.readUInt16BE(rec + 2);
    const sub = cmap.readUInt32BE(rec + 4);
    if (!((platform === 3 && encoding === 1) || platform === 0)) continue;
    if (cmap.readUInt16BE(sub) !== 4) continue;
    const segX2 = cmap.readUInt16BE(sub + 6);
    const endAt = sub + 14;
    const startAt = endAt + segX2 + 2;
    const deltaAt = startAt + segX2;
    const rangeAt = deltaAt + segX2;
    for (let s = 0; s < segX2; s += 2) {
      if (cmap.readUInt16BE(endAt + s) < code) continue;
      const start = cmap.readUInt16BE(startAt + s);
      if (start > code) return 0;
      const delta = cmap.readInt16BE(deltaAt + s);
      const range = cmap.readUInt16BE(rangeAt + s);
      if (range === 0) return (code + delta) & 0xffff;
      const g = cmap.readUInt16BE(rangeAt + s + range + (code - start) * 2);
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
  }
  return 0;
}

/** One simple glyph as closed contours of on/off-curve points. */
function contours(g) {
  const start = glyphOffset(g);
  if (start === glyphOffset(g + 1)) return [];
  let p = start;
  const count = glyf.readInt16BE(p);
  if (count < 0) throw new Error("composite glyphs are not supported");
  p += 10;
  const ends = [];
  for (let i = 0; i < count; i++, p += 2) ends.push(glyf.readUInt16BE(p));
  p += 2 + glyf.readUInt16BE(p);
  const total = ends[ends.length - 1] + 1;
  const flags = [];
  while (flags.length < total) {
    const f = glyf[p++];
    flags.push(f);
    if (f & 8) for (let r = glyf[p++]; r > 0; r--) flags.push(f);
  }
  const read = (shortBit, sameBit) => {
    const out = [];
    let v = 0;
    for (const f of flags) {
      if (f & shortBit) {
        const d = glyf[p++];
        v += f & sameBit ? d : -d;
      } else if (!(f & sameBit)) {
        v += glyf.readInt16BE(p);
        p += 2;
      }
      out.push(v);
    }
    return out;
  };
  const xs = read(2, 16);
  const ys = read(4, 32);
  const result = [];
  let from = 0;
  for (const end of ends) {
    const pts = [];
    for (let i = from; i <= end; i++) pts.push({ x: xs[i], y: ys[i], on: (flags[i] & 1) === 1 });
    result.push(pts);
    from = end + 1;
  }
  return result;
}

/** TrueType quadratic contour -> M / L / Q / Z commands. */
function toCommands(pts, dx, scale) {
  const n = pts.length;
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, on: true });
  let first = pts.findIndex((q) => q.on);
  let ring = pts;
  if (first === -1) {
    ring = [mid(pts[n - 1], pts[0]), ...pts];
    first = 0;
  }
  const m = ring.length;
  const X = (v) => +((v + dx) * scale).toFixed(5);
  const Y = (v) => +(v * scale).toFixed(5);
  const cmds = [["M", X(ring[first].x), Y(ring[first].y)]];
  let off = null;
  for (let k = 1; k <= m; k++) {
    const q = ring[(first + k) % m];
    if (q.on) {
      if (off) cmds.push(["Q", X(off.x), Y(off.y), X(q.x), Y(q.y)]);
      else cmds.push(["L", X(q.x), Y(q.y)]);
      off = null;
    } else {
      if (off) {
        const h = mid(off, q);
        cmds.push(["Q", X(off.x), Y(off.y), X(h.x), Y(h.y)]);
      }
      off = q;
    }
  }
  cmds.push(["Z"]);
  return cmds;
}

const scale = 1 / unitsPerEm;
const glyphs = [];
let pen = 0;
let yMin = Infinity;
let yMax = -Infinity;
let xMin = Infinity;
let xMax = -Infinity;
for (const ch of TEXT) {
  const g = glyphIndex(ch.codePointAt(0));
  if (!g) throw new Error(`no glyph for ${ch}`);
  const shapes = contours(g);
  for (const c of shapes)
    for (const q of c) {
      yMin = Math.min(yMin, q.y);
      yMax = Math.max(yMax, q.y);
      xMin = Math.min(xMin, q.x + pen);
      xMax = Math.max(xMax, q.x + pen);
    }
  glyphs.push({ char: ch, paths: shapes.map((c) => toCommands(c, pen, scale)) });
  pen += advance(g) + LETTER_SPACING_EM * unitsPerEm;
}

const data = {
  text: TEXT,
  font: "Syne ExtraBold (SIL Open Font License 1.1)",
  // em units, y up, baseline at 0
  xMin: +(xMin * scale).toFixed(5),
  xMax: +(xMax * scale).toFixed(5),
  yMin: +(yMin * scale).toFixed(5),
  yMax: +(yMax * scale).toFixed(5),
  glyphs,
};
writeFileSync(OUT, JSON.stringify(data));
console.log(
  `${OUT}: ${glyphs.length} glyphs, ` +
    `${glyphs.reduce((a, g) => a + g.paths.length, 0)} contours, ` +
    `x ${data.xMin}..${data.xMax} em, y ${data.yMin}..${data.yMax} em`,
);
