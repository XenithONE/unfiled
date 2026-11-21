// FUDE（tools/fude）の部品の検査。GPU や画面を使わない部品（SVG パス・台本・塗りつぶし・PSD・ZIP）を Node で確かめる。
// 外部の PSD 読み取り（ag-psd）で照合するときは、AG_PSD にその入った node_modules の場所を渡す。
import { build } from "esbuild";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const entry = `
export * from './tools/fude/src/ai/svgpath.ts';
export * from './tools/fude/src/ai/script.ts';
export * from './tools/fude/src/engine/flood.ts';
export * from './tools/fude/src/io/psd.ts';
export * from './tools/fude/src/io/zip.ts';
export { StrokeBuilder } from './tools/fude/src/engine/brush/stroke.ts';
export { PRESETS } from './tools/fude/src/engine/brush/presets.ts';
export { squareToQuad, invert3 } from './tools/fude/src/engine/transform.ts';
`;
const out = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "esm", platform: "node" });
const M = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);

let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed++;
  console.log(`PASS ${name}`);
};
/** 検査が「壊れた物を落とす」ことの確かめ: fn が失敗すること。 */
const mustFail = (name, fn) => {
  let failed = false;
  try {
    fn();
  } catch {
    failed = true;
  }
  assert(failed, `壊した入力が通ってしまった: ${name}`);
};

// ---------- SVG パス ----------
await check("SVG パス: 直線・閉じ・相対・H/V", () => {
  const p = M.parsePath("M0 0 L10 0 l0 10 H0 Z");
  assert.equal(p.length, 1);
  assert.equal(p[0].closed, true);
  assert.deepEqual(p[0].pts.at(-1), [0, 10]);
  const q = M.parsePath("M5,5 h10 v10 h-10 z m20 0 l5 5");
  assert.equal(q.length, 2);
  assert.deepEqual(q[1].pts[0], [25, 5]);
});
await check("SVG パス: 3 次・2 次・S/T の続き・弧（フラグの詰め書き）", () => {
  const c = M.parsePath("M0 0 C 0 50 100 50 100 0 S 200 -50 200 0");
  const last = c[0].pts.at(-1);
  assert(Math.abs(last[0] - 200) < 1e-6 && Math.abs(last[1]) < 1e-6);
  assert(c[0].pts.length > 10);
  const a = M.parsePath("M0 0 a50 50 0 1110 0");
  const e = a[0].pts.at(-1);
  assert(Math.abs(e[0] - 10) < 1e-6 && Math.abs(e[1]) < 1e-6, JSON.stringify(e));
  // 大きい弧なので遠回りする: どこかで y が 40 を超える
  assert(a[0].pts.some((p) => Math.abs(p[1]) > 40));
  const q = M.parsePath("M0 0 Q 50 100 100 0 T 200 0");
  assert(Math.abs(q[0].pts.at(-1)[0] - 200) < 1e-6);
});
await check("SVG パス: 読めない物は理由つきで落ちる", () => {
  assert.throws(() => M.parsePath("L10 10"), /M/);
  assert.throws(() => M.parsePath("M0 0 L10"), /数が足りません/);
  assert.throws(() => M.parsePath("M0 0 X 1 2"), /読めません|知らない/);
});

// ---------- 台本 ----------
await check("台本: ```json の囲み・コメント・末尾のカンマ・前後の説明文を許す", () => {
  const text = 'はい、台本です。\n```json\n{"title":"t","size":[800,600],"ops":[\n // 空\n {"op":"layer","name":"空",},\n {"op":"stroke","d":"M0 0 L100 0","preset":"gpen","size":4,"color":"red"}, /* 線 */\n]}\n```\n楽しんでください。';
  const p = M.parseScript(text);
  assert.equal(p.issues.filter((i) => i.level === "error").length, 0, JSON.stringify(p.issues));
  assert.equal(p.ops.length, 2);
  assert.deepEqual(p.size, [800, 600]);
  assert.equal(p.ops[1].k, "stroke");
  assert.equal(p.ops[1].color, "#e53935");
  assert.equal(p.ops[1].patch.size, 4);
});
await check("台本: 形の書き方（points・rect・ellipse・circle・polygon）と塗り・線の両方", () => {
  const p = M.parseScript({ ops: [
    { op: "stroke", points: [[0, 0], [10, 10, 0.5]] },
    { op: "rect", rect: [0, 0, 10, 10], fill: "#fff", stroke: "#000", strokeWidth: 3 },
    { op: "circle", circle: [5, 5, 5], fill: "#123456" },
    { op: "fill", polygon: [[0, 0], [10, 0], [5, 9]], color: "rgb(255, 0, 0)" },
    { op: "ellipse", ellipse: [50, 50, 20, 10, 30], fill: "hsl(120, 50%, 50%)" },
  ] });
  assert.equal(p.issues.length, 0, JSON.stringify(p.issues));
  assert.deepEqual(p.ops.map((o) => o.k), ["stroke", "fill", "stroke", "fill", "fill", "fill"]);
  assert.equal(p.ops[0].paths[0][1][2], 0.5);
  assert.equal(p.ops[4].color, "#ff0000");
  assert.equal(p.ops[5].color, "#40bf40");
});
await check("台本: 間違いは何番目の何が悪いかを言う", () => {
  const p = M.parseScript({ ops: [{ op: "stroke" }, { op: "bucket", x: 1 }, { op: "flyaway" }, { op: "color", color: "nope" }] });
  const msg = p.issues.map((i) => `${i.index}:${i.level}`).join(",");
  assert.equal(msg, "0:error,1:error,2:warn,3:error");
  const bad = M.parseScript("{ ops: [ }");
  assert.equal(bad.issues[0].level, "error");
  assert.match(bad.issues[0].message, /JSON/);
});
await check("台本: グラデーションの色の書き方（色だけ・[色,位置]・transparent）", () => {
  const p = M.parseScript({ ops: [
    { op: "gradient", from: [0, 0], to: [0, 100], stops: ["#000", "#fff"] },
    { op: "gradient", from: [0, 0], to: [0, 100], stops: [["#ff0000", 0], ["#00ff00", 0.3], ["transparent", 1]] },
  ] });
  assert.equal(p.issues.length, 0, JSON.stringify(p.issues));
  assert.deepEqual(p.ops[0].stops.map((s) => s.pos), [0, 1]);
  assert.equal(p.ops[1].stops[2].alpha, 0);
  assert.equal(p.ops[1].stops[2].color, "#00ff00");
});

// ---------- 筆の判子の並び ----------
await check("筆: 判子の間隔と入り抜き（抜きは離したあと細くなる）", () => {
  const brush = { ...M.PRESETS.find((p) => p.id === "gpen"), size: 10 };
  const b = new M.StrokeBuilder({ brush, color: [0, 0, 0], pressureGamma: 1, seed: 1, taper: true });
  b.begin({ x: 0, y: 0, p: 1, tx: 0, ty: 0, t: 0 });
  for (let i = 1; i <= 100; i++) b.add({ x: i * 3, y: 0, p: 1, tx: 0, ty: 0, t: i * 4 });
  const live = b.take();
  const midBefore = live[Math.floor(live.length / 2)].r;
  const changed = b.end();
  assert(changed);
  const all = b.dabs;
  assert(all.length > 200, `判子が少なすぎる: ${all.length}`);
  for (let i = 1; i < all.length; i++) assert(all[i].dist - all[i - 1].dist <= 10 * 0.05 + 0.5);
  assert(all.at(-1).r < all[Math.floor(all.length / 2)].r * 0.4, "抜きが効いていない");
  assert(all[0].r < midBefore * 0.4, "入りが効いていない");
});

// ---------- 塗りつぶし ----------
await check("塗りつぶし: 隙間閉じあり・なし（線の切れ目 1 画素）", () => {
  const W = 40;
  const H = 40;
  const px = new Uint8Array(W * H * 4);
  const set = (x, y) => (px[(y * W + x) * 4 + 3] = 255);
  for (let i = 10; i < 30; i++) {
    set(i, 10);
    set(i, 29);
    set(10, i);
    if (i !== 20) set(29, i); // 右の辺に 1 画素の切れ目
  }
  const o = { tolerance: 5, gap: 0, expand: 0, contiguous: true, antialias: false };
  const leak = M.floodMask(px, W, H, 20, 20, o);
  assert(leak.count > W * H - 100, "隙間閉じなしなら外へ漏れるはず");
  const closed = M.floodMask(px, W, H, 20, 20, { ...o, gap: 2 });
  assert(closed.count < 20 * 20 && closed.count > 15 * 15, `中だけのはず: ${closed.count}`);
  assert(closed.x0 >= 10 && closed.x1 <= 31, JSON.stringify(closed));
  const grown = M.floodMask(px, W, H, 20, 20, { ...o, gap: 2, expand: 1 });
  assert(grown.count > closed.count, "領域拡縮で広がるはず");
});

// ---------- PackBits / PSD ----------
await check("PackBits: 往復で元に戻る（並び・繰り返し・境目）", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let t = 0; t < 200; t++) {
    const n = 1 + Math.floor(rnd() * 600);
    const row = new Uint8Array(n);
    for (let i = 0; i < n; i++) row[i] = rnd() < 0.5 ? 0 : Math.floor(rnd() * 4);
    const back = M.unpackBits(M.packBits(row), n);
    assert.deepEqual(back, row);
  }
});

function makeDoc() {
  const W = 64;
  const H = 48;
  const rect = (w, h, c) => {
    const a = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) a.set(c, i * 4);
    return a;
  };
  const mask = new Uint8Array(W * H).fill(255);
  for (let i = 0; i < W * 10; i++) mask[i] = 0;
  const L = (o) => ({ kind: "raster", visible: true, opacity: 1, blend: "normal", clip: false, alphaLock: false, x: 0, y: 0, w: 0, h: 0, rgba: null, mask: null, children: [], expanded: true, ...o });
  return {
    w: W,
    h: H,
    composite: rect(W, H, [10, 20, 30, 255]),
    layers: [
      L({ name: "用紙", x: 0, y: 0, w: W, h: H, rgba: rect(W, H, [255, 255, 255, 255]) }),
      L({ name: "下塗り", x: 5, y: 6, w: 20, h: 10, rgba: rect(20, 10, [200, 100, 50, 255]), alphaLock: true }),
      L({ name: "影", blend: "multiply", opacity: 0.5, clip: true, x: 8, y: 8, w: 4, h: 4, rgba: rect(4, 4, [0, 0, 128, 128]) }),
      { ...L({ name: "人物" }), kind: "group", blend: "pass", children: [L({ name: "線画", visible: false, x: 1, y: 2, w: 3, h: 2, rgba: rect(3, 2, [0, 0, 0, 255]), mask: { x: 0, y: 0, w: W, h: H, data: mask, defaultColor: 255, enabled: true } })] },
      L({ name: "光", blend: "addGlow", opacity: 0.8 }),
    ],
  };
}

function compareDoc(a, b) {
  assert.equal(b.w, a.w);
  assert.equal(b.h, a.h);
  const walk = (x, y) => {
    assert.equal(y.length, x.length, `数: ${x.map((l) => l.name)} / ${y.map((l) => l.name)}`);
    x.forEach((l, i) => {
      const m = y[i];
      assert.equal(m.name, l.name);
      assert.equal(m.kind, l.kind);
      assert.equal(m.visible, l.visible, `${l.name} visible`);
      assert(Math.abs(m.opacity - l.opacity) < 0.01, `${l.name} opacity`);
      assert.equal(m.clip, l.clip, `${l.name} clip`);
      assert.equal(m.alphaLock, l.alphaLock, `${l.name} alphaLock`);
      const want = l.blend === "addGlow" ? "add" : l.blend;
      assert.equal(m.blend, want, `${l.name} blend`);
      if (l.rgba && l.kind === "raster") {
        assert.deepEqual([m.x, m.y, m.w, m.h], [l.x, l.y, l.w, l.h], `${l.name} 範囲`);
        assert.deepEqual(m.rgba, l.rgba, `${l.name} 画素`);
      }
      if (l.mask) {
        assert(m.mask, `${l.name} mask`);
        assert.deepEqual(m.mask.data, l.mask.data);
      }
      walk(l.children ?? [], m.children ?? []);
    });
  };
  walk(a.layers, b.layers);
  assert.deepEqual(b.composite, a.composite);
}

const psdBytes = M.writePsd(makeDoc());
await check("PSD: 書いて読み戻すと同じ（名前・合成・不透明度・非表示・クリップ・ロック・フォルダー・マスク・画素）", () => {
  compareDoc(makeDoc(), M.readPsd(psdBytes));
});
await check("PSD: 検査自体が違いを見逃さない（わざと違う物と比べると落ちる）", () => {
  const back = M.readPsd(psdBytes);
  mustFail("名前違い", () => compareDoc({ ...makeDoc(), layers: makeDoc().layers.map((l, i) => (i === 1 ? { ...l, name: "別" } : l)) }, back));
  mustFail("画素違い", () => {
    const d = makeDoc();
    d.layers[1].rgba[0] ^= 1;
    compareDoc(d, back);
  });
  mustFail("非表示違い", () => {
    const d = makeDoc();
    d.layers[3].children[0].visible = true;
    compareDoc(d, back);
  });
});
await check("PSD: 壊れたファイルは読めないと言う", () => {
  assert.throws(() => M.readPsd(new Uint8Array([1, 2, 3, 4, 5, 6])), /PSD/);
});

if (process.env.AG_PSD) {
  await check("PSD: 別の実装（ag-psd）で読める・中身が合う", () => {
    const req = createRequire(join(process.env.AG_PSD, "package.json"));
    const ag = req("ag-psd");
    // Node には canvas が無いので、画素の入れ物だけ渡す
    ag.initializeCanvas(
      () => {
        throw new Error("canvas は使わない");
      },
      (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    );
    const psd = ag.readPsd(psdBytes.buffer.slice(psdBytes.byteOffset, psdBytes.byteOffset + psdBytes.byteLength), { useImageData: true, skipThumbnail: true });
    assert.equal(psd.width, 64);
    assert.equal(psd.height, 48);
    const names = psd.children.map((c) => c.name);
    assert.deepEqual(names, ["用紙", "下塗り", "影", "人物", "光"]);
    const shadow = psd.children[2];
    assert.equal(shadow.blendMode, "multiply");
    assert(Math.abs(shadow.opacity - 0.5) < 0.01);
    assert.equal(shadow.clipping, true);
    assert.equal(psd.children[1].transparencyProtected, true);
    const grp = psd.children[3];
    assert.equal(grp.blendMode, "pass through");
    assert.equal(grp.children.length, 1);
    assert.equal(grp.children[0].name, "線画");
    assert.equal(grp.children[0].hidden, true);
    assert(grp.children[0].mask, "マスクがあるはず");
    assert.equal(psd.children[1].left, 5);
    assert.equal(psd.children[1].top, 6);
    const d = psd.children[1].imageData.data;
    assert.deepEqual([d[0], d[1], d[2], d[3]], [200, 100, 50, 255]);
  });
} else console.log("SKIP PSD の外部照合（AG_PSD が無い）");

// ---------- ZIP ----------
await check("ZIP: 書いて読み戻すと同じ・mimetype が最初で無圧縮", async () => {
  const enc = new TextEncoder();
  const files = [
    { name: "mimetype", data: enc.encode("image/openraster") },
    { name: "stack.xml", data: enc.encode("<image w='1' h='1'/>") },
    { name: "data/日本語.png", data: new Uint8Array([1, 2, 3, 250]) },
  ];
  const z = M.writeZip(files);
  assert.equal(new TextDecoder().decode(z.subarray(30, 38)), "mimetype");
  assert.equal(new TextDecoder().decode(z.subarray(38, 54)), "image/openraster");
  const back = await M.readZip(z);
  for (const f of files) assert.deepEqual(back.get(f.name), f.data);
  // Python の zipfile でも壊れていないか（あれば）
  try {
    const dir = mkdtempSync(join(tmpdir(), "fudezip-"));
    const p = join(dir, "t.zip");
    writeFileSync(p, z);
    const r = execFileSync("python", ["-c", `import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip() or 'ok')`, p], { encoding: "utf8" }).trim();
    assert.equal(r, "ok");
  } catch (e) {
    if (e.code === "ENOENT") console.log("  (python が無いので zipfile の照合は省略)");
    else throw e;
  }
});

// ---------- 変形 ----------
await check("変形: 四角 → 四角の射影が角を正しく写す", () => {
  const q = [[10, 20], [110, 30], [100, 140], [5, 120]];
  const H = M.squareToQuad(q);
  const map = (u, v) => {
    const x = H[0] * u + H[1] * v + H[2];
    const y = H[3] * u + H[4] * v + H[5];
    const w = H[6] * u + H[7] * v + H[8];
    return [x / w, y / w];
  };
  const corners = [map(0, 0), map(1, 0), map(1, 1), map(0, 1)];
  corners.forEach((c, i) => assert(Math.hypot(c[0] - q[i][0], c[1] - q[i][1]) < 1e-6, `角 ${i}: ${c}`));
  const inv = M.invert3(H);
  const p = map(0.3, 0.7);
  const u = inv[0] * p[0] + inv[1] * p[1] + inv[2];
  const v = inv[3] * p[0] + inv[4] * p[1] + inv[5];
  const w = inv[6] * p[0] + inv[7] * p[1] + inv[8];
  assert(Math.abs(u / w - 0.3) < 1e-6 && Math.abs(v / w - 0.7) < 1e-6);
});

console.log(`${passed} FUDE checks passed.`);
