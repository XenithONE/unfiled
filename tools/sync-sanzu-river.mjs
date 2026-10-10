// Copy the real-time short film 三途の川 (Sanzu River) into public/films/sanzu-river.
//
// The film is a plain static Three.js page in ../../../Film/sanzu-river. Only what
// the page actually loads is published: the modules reachable from src/main.js,
// the Three.js files they import (r180, from the film's own node_modules), and
// an explicit list of assets. Build scripts, Blender files, renders and the
// version-1 character files (which carry a CC BY head scan) are never copied.
//
//   node tools/sync-sanzu-river.mjs [path-to-film]
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.resolve(process.argv[2] ?? path.join(siteRoot, "../../Film/sanzu-river"));
const destination = path.join(siteRoot, "public/films/sanzu-river");
const threeRoot = path.join(source, "node_modules/three");

const ASSETS = [
  "assets/character/funeral-passenger-v2.glb",
  "assets/character/shiroshozoku/waraji-straw.png",
  "assets/wood_planks/diff.jpg", "assets/wood_planks/nor_gl.jpg", "assets/wood_planks/rough.jpg",
  "assets/brown_mud/diff.jpg", "assets/brown_mud/nor_gl.jpg", "assets/brown_mud/rough.jpg",
  "assets/ganges_river_pebbles/diff.jpg", "assets/ganges_river_pebbles/nor_gl.jpg", "assets/ganges_river_pebbles/rough.jpg",
  "assets/water/normals.jpg",
];
const MAX_FILE = 95 * 1024 * 1024; // GitHub refuses files over 100 MB

const fail = (message) => { console.error(`sync-sanzu-river: ${message}`); process.exit(1); };
if (!existsSync(path.join(source, "index.html")) || !existsSync(path.join(source, "src/main.js")))
  fail(`not a Sanzu River folder: ${source}`);
if (JSON.parse(readFileSync(path.join(threeRoot, "package.json"), "utf8")).version !== "0.180.0")
  fail("the film expects three 0.180.0 in its node_modules (run npm ci there)");
if (!destination.startsWith(path.join(siteRoot, "public") + path.sep)) fail("destination left the site");

// Follow static imports from src/main.js. "three" and "three/addons/" resolve as
// the page's import map does.
const files = new Map(); // published path -> absolute source path
const queue = [path.join(source, "src/main.js")];
const IMPORT = /(?:import|export)\s*(?:[^'"`;]*?\sfrom\s*)?["']([^"']+)["']/g;
function resolve(spec, from) {
  if (spec === "three") return path.join(threeRoot, "build/three.module.js");
  if (spec.startsWith("three/addons/")) return path.join(threeRoot, "examples/jsm", spec.slice("three/addons/".length));
  if (spec.startsWith(".")) return path.resolve(path.dirname(from), spec);
  fail(`unexpected bare import "${spec}" in ${from}`);
}
function published(abs) {
  if (abs.startsWith(threeRoot + path.sep)) return path.join("vendor/three", path.relative(threeRoot, abs));
  if (abs.startsWith(path.join(source, "src") + path.sep)) return path.relative(source, abs);
  fail(`import outside src/ and three: ${abs}`);
}
while (queue.length) {
  const file = queue.pop();
  const key = published(file);
  if (files.has(key)) continue;
  if (!existsSync(file)) fail(`missing module ${file}`);
  files.set(key, file);
  const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const [, spec] of text.matchAll(IMPORT)) queue.push(resolve(spec, file));
}
for (const asset of ASSETS) files.set(asset, path.join(source, asset));
files.set("vendor/three/LICENSE", path.join(threeRoot, "LICENSE"));
for (const [key, abs] of files) {
  if (!existsSync(abs)) fail(`missing ${key}`);
  if (lstatSync(abs).isSymbolicLink()) fail(`symlink refused: ${abs}`);
  if (statSync(abs).size > MAX_FILE) fail(`${key} is too large for GitHub`);
  if (/funeral-passenger\.glb|funeral-head\.|LeePerrySmith/i.test(key)) fail(`version-1 character file refused: ${key}`);
}

rmSync(destination, { recursive: true, force: true });
for (const [key, abs] of files) {
  const out = path.join(destination, key);
  mkdirSync(path.dirname(out), { recursive: true });
  cpSync(abs, out);
}
cpSync(path.join(source, "style.css"), path.join(destination, "style.css"));

// The page itself: the import map points at the vendored Three.js, and a quiet
// note shows while the 50 MB character and the scene load (src/main.js finishes
// its top-level awaits only once the film is running).
let html = readFileSync(path.join(source, "index.html"), "utf8");
html = html
  .replace("<title>三途 — Sanzu</title>", "<title>三途の川 — Sanzu River</title>")
  .replace('"three":"./node_modules/three/build/three.module.js"', '"three":"./vendor/three/build/three.module.js"')
  .replace('"three/addons/":"./node_modules/three/examples/jsm/"', '"three/addons/":"./vendor/three/examples/jsm/"')
  .replace('<script type="module" src="./src/main.js"></script>',
    '<p id="loading" style="position:fixed;inset:auto 0 46%;margin:0;text-align:center;color:#c9b8a6;font:14px/1.8 serif;letter-spacing:.2em">読み込み中…<br><small style="letter-spacing:.05em;opacity:.7">描画の重い作品です。性能の高いPCでご覧ください。</small></p>' +
    '<script type="module">import "./src/main.js"; document.getElementById("loading")?.remove();</script>');
if (!html.includes("./vendor/three/build/three.module.js") || !html.includes('import "./src/main.js"'))
  fail("index.html did not take the expected shape");
writeFileSync(path.join(destination, "index.html"), html);

writeFileSync(path.join(destination, "CREDITS.md"), `# 三途の川 — Sanzu River

31秒・8カットの短編を、Three.js（r180）がブラウザの中で毎回描きます。

- v1（シーン・彼岸花の生成・人物の統合）：GPT-6 Astra / Codex。v2（演出・光・霧・灯籠・死装束・積み石・8カット構成）：Claude。
- 人物の頭部：この作品のための自作。MakeHuman Community の hm08 元メッシュと形・表情の素材（CC0）から作成。スキャン・写真は使っていません。
- 手：MakeHuman Community hm08 元メッシュ（CC0）。https://github.com/makehumancommunity/makehuman
- 写真テクスチャ（CC0、Poly Haven）：Wood Planks — Amal Kumar／Brown Mud — Rob Tuytel／Ganges River Pebbles — Amal Kumar。https://polyhaven.com/license
- 水面の法線テクスチャ：Three.js 公式例（MIT）。
- Three.js（MIT）：vendor/three/LICENSE。
- 経帷子の文字は般若心経（パブリックドメイン）。灯籠の墨書は実行時に OS の書体で描き、フォントは同梱していません。
`);

const total = [...files.values()].reduce((sum, abs) => sum + statSync(abs).size, 0);
console.log(`sync-sanzu-river: ${files.size + 3} files, ${(total / 1048576).toFixed(1)} MB -> ${path.relative(siteRoot, destination)}`);
