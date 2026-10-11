/** Build the playable AlicE games with their own locked dependencies. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, writeFile, mkdtemp, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(process.argv[2] ?? path.join(root, '../alice-system'));
const expectedCommit = '73d039bbab63dcbd0ad292fa2241b50fe98b1d3c';
const commit = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (commit !== expectedCommit) throw new Error(`Review the new source revision before importing: ${commit}`);
if (execFileSync('git', ['-C', source, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim()) {
  throw new Error('Source checkout has tracked edits. Import only the reviewed clean revision.');
}
const requireSource = createRequire(path.join(source, 'package.json'));
const { build } = await import(pathToFileURL(requireSource.resolve('vite')).href);
const { default: react } = await import(pathToFileURL(requireSource.resolve('@vitejs/plugin-react')).href);
const ts = requireSource('typescript');
const base = '/unfiled/games/alice/';
const home = '/unfiled/';
const output = await mkdtemp(path.join(tmpdir(), 'unfiled-alice-'));
const entries = ['hollow-ward', 'tower-defense', 'relic-road', 'scrap-crown', 'vortex-crown', 'nitro-crown'];
const patched = new Set();

function replaceRequired(text, from, to, file) {
  if (!text.includes(from)) throw new Error(`Migration patch no longer matches ${file}: ${from}`);
  return text.replaceAll(from, to);
}

const patches = {
  'src/quest/sfx.ts': [['"/assets/quest/audio/"', `"${base}assets/quest/audio/"`]],
  'src/quest/render/board.ts': [['"/assets/quest/board-plate.webp"', `"${base}assets/quest/board-plate.webp"`]],
  'src/quest/quest.css': [['"/assets/quest/', `"${base}assets/quest/`]],
  'src/quest/App.tsx': [
    ['href="index.html#games"', `href="${home}"`],
    ['<h1><span>RELIC</span>', `<a className="rr-chip" href="${home}">← UNFILED</a><h1><span>RELIC</span>`],
  ],
  'src/arena/ui/TitleScreen.tsx': [['href="index.html#games"', `href="${home}"`], ['← AlicE sYsTeM', '← UNFILED']],
  'src/td/App.tsx': [['href={BASE}', `href="${home}"`], ['← AlicE sYsTeM', '← UNFILED']],
  'src/vortex/App.tsx': [['window.location.assign(BASE_URL)', `window.location.assign("${home}")`]],
  'src/kart/ui/Screens.tsx': [['<p className="nk-eyebrow">', `<a href="${home}" style={{color:"inherit"}}>← UNFILED</a><p className="nk-eyebrow">`]],
  'src/components/Hud.tsx': [['<h1>The Hollow Ward</h1>', `<a href="${home}" style={{color:"inherit"}}>← UNFILED</a><h1>The Hollow Ward</h1>`]],
};

await build({
  configFile: false,
  root: source,
  base,
  publicDir: false,
  plugins: [{
    name: 'unfiled-migration',
    enforce: 'pre',
    transform(code, id) {
      const relative = path.relative(source, id.split('?')[0]).replaceAll('\\', '/');
      if (!patches[relative]) return;
      for (const [from, to] of patches[relative]) code = replaceRequired(code, from, to, relative);
      patched.add(relative);
      return { code, map: null };
    },
    transformIndexHtml: {
      order: 'pre',
      handler: html => html.replaceAll('/alice-system/', base).replace(/\s*<link rel="manifest"[^>]*>/g, ''),
    },
  }, react()],
  define: { __APP_VERSION__: JSON.stringify('4.0.0') },
  build: {
    target: 'es2022', outDir: output, emptyOutDir: false,
    sourcemap: false, chunkSizeWarningLimit: 6000,
    rollupOptions: { input: Object.fromEntries(entries.map(name => [name, path.join(source, `${name}.html`)])) },
  },
});
for (const file of Object.keys(patches)) if (!patched.has(file)) throw new Error(`Patch was not applied: ${file}`);

async function copy(relative) {
  const to = path.join(output, relative);
  await mkdir(path.dirname(to), { recursive: true });
  await cp(path.join(source, 'public', relative), to, { recursive: true });
}
async function loadCatalog(file) {
  const code = ts.transpileModule(await readFile(path.join(source, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
const { WORKS } = await loadCatalog('src/data/works.ts');
const { ARENA_GAMES } = await loadCatalog('src/data/arenaGames.ts');
const games = [...WORKS.filter(work => work.kind === 'game' && work.status === 'playable'), ...ARENA_GAMES];
if (games.length !== 13) throw new Error('Review changes to the playable catalog before importing.');

for (const file of ['games/shared/alice-game-kit.js', 'vendor/three', 'assets/hdri', 'assets/textures', 'assets/quest',
  'assets/favicon-32.png', 'assets/favicon-64.png', 'assets/apple-touch-icon.png', 'ASSET_CREDITS.md']) await copy(file);
for (const game of games) {
  for (const asset of new Set([game.cover, game.poster, ...(game.screenshots ?? [])].filter(Boolean))) await copy(asset);
  if (!game.href.startsWith('games/')) continue;
  await copy(game.href);
  const file = path.join(output, game.href);
  let html = await readFile(file, 'utf8');
  html = html.replace('<head>', `<head>\n<link rel="icon" type="image/png" href="${base}assets/favicon-32.png">`);
  html = html.replace(/href="(?:\.\.\/)+index\.html"/g, `href="${home}"`)
    .replaceAll('◂ AlicE sYsTeM', '◂ UNFILED');
  // This optional background is absent upstream; preserve the procedural table.
  if (game.id === 'dragons-keep') html = replaceRequired(html, "bgImg.src='../assets/dragons-keep-bg.jpg';", '// Uses the original procedural background.', game.href);
  await writeFile(file, html);
}
for (const file of ['engine.js', 'levels/level1.js', 'levels/level2.js', 'levels/level3.js', 'levels/level4.js']) await copy(`games/iwbtg/${file}`);
const enginePath = path.join(output, 'games/iwbtg/engine.js');
let engine = await readFile(enginePath, 'utf8');
// The source ships no optional sprites; its built-in brick sprites are complete.
engine = replaceRequired(engine, "  img.src = 'assets/sprites/' + name + '.png';", '  // Use the built-in brick sprites; optional PNGs are not shipped.', 'iwbtg/engine.js');
await writeFile(enginePath, engine);
await writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="ja"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${home}"><title>UNFILED</title><a href="${home}">UNFILEDへ戻る</a></html>\n`);

// Include the actual installed runtime licenses, including transitive packages.
const pkg = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
const licenses = ['AlicE games migrated to UNFILED. Original game code and artwork: XenithONE.\n'];
const seen = new Set();
async function addLicense(name) {
  if (seen.has(name)) return;
  seen.add(name);
  const dir = path.join(source, 'node_modules', name);
  const info = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
  licenses.push(`\n=== ${name} ${info.version} (${info.license ?? 'see license'}) ===\n`);
  const names = await readdir(dir);
  const files = names.filter(file => /^(licen[cs]e|copying|notice)([.-]|$)/i.test(file));
  if (!files.length) {
    if (name !== '@dimforge/rapier3d-compat') throw new Error(`Missing license text for ${name}`);
    licenses.push('Source: https://github.com/dimforge/rapier.js/blob/master/LICENSE\n');
    licenses.push(await readFile(path.join(root, 'tools/licenses/rapier.js-LICENSE'), 'utf8'));
  }
  for (const file of files) licenses.push(await readFile(path.join(dir, file), 'utf8'));
  for (const dependency of Object.keys(info.dependencies ?? {})) await addLicense(dependency);
}
for (const name of Object.keys(pkg.dependencies)) await addLicense(name);
await writeFile(path.join(output, 'THIRD_PARTY_NOTICES.txt'), licenses.join('\n'));

const categories = {
  'nitro-crown': ['KART RACING GAME', '#e95c40'], 'relic-road': ['DECKBUILDING BOARD RPG', '#cda05b'],
  'hollow-ward': ['CO-OP HORROR GAME', '#438d86'], 'signal-siege': ['VERSUS TOWER DEFENSE', '#338caa'],
  'the-eidolon': ['COSMIC HORROR GAME', '#685a9a'], 'rift-courier': ['3D FLIGHT GAME', '#37a9b7'],
  iwbtg: ['KAIZO PLATFORMER', '#34a195'], 'locker-hunt': ['HORROR SEARCH GAME', '#b79054'],
  'signal-runner': ['ARCADE DODGE GAME', '#36a893'], constellation: ['MEMORY PUZZLE', '#7b74b9'],
  'dragons-keep': ['FANTASY PINBALL', '#c99b44'], 'scrap-crown': ['ROBOT BATTLE GAME', '#b2754f'],
  'vortex-crown': ['SPIN TOP BATTLE GAME', '#8172bd'],
};
const projectsPath = path.join(root, 'public/projects.json');
const projects = JSON.parse(await readFile(projectsPath, 'utf8'));
for (const game of games) {
  const item = { id: game.id, title: game.title, subtitle: game.titleJa, description: game.description,
    category: categories[game.id][0], year: game.year,
    url: `https://xenithone.github.io${base}${game.href}`, cover: `images/alice-${game.id}${path.extname(game.cover)}`, accent: categories[game.id][1] };
  const existing = projects.findIndex(project => project.id === game.id);
  if (existing >= 0) projects[existing] = item; else projects.push(item);
}
await writeFile(path.join(output, 'README_JA.md'), `# AlicE ゲーム移行版\n\n旧 alice-system のプレイ可能なゲーム13本をUNFILED内で配信します。\n\n${games.map(game => `- [${game.title}](${game.href}) — ${game.titleJa}`).join('\n')}\n\nゲームのルールと保存キーは原版を維持しています。同じブラウザ・同じ https://xenithone.github.io の保存領域に記録が残っていれば引き続き参照されます。別ドメインや別ブラウザの記録は自動移行されません。\n\nオンライン対戦は原版のPeerJS/WebRTCを使用し、接続可否はネットワーク環境にも依存します。3D作品はWebGL対応ブラウザが必要です。操作は各ゲーム内の案内を参照してください。\n\n移行時の修正は、UNFILEDへの戻り先、公開パスとメタ情報、RELIC ROADの画像と音声パス、存在しない任意画像へのリクエスト抑止です。任意画像のないゲームは原版の手続き描画をそのまま使います。\n\n素材出典はASSET_CREDITS.mdとassets/quest/audio/LICENSES.md、実際の依存パッケージのライセンス全文はTHIRD_PARTY_NOTICES.txtに収録しています。パッケージのライセンス表記は後者を優先してください。\n`);

const hashes = {};
async function hashFiles(dir, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) await hashFiles(path.join(dir, entry.name), `${relative}/`);
    else hashes[relative] = createHash('sha256').update(await readFile(path.join(dir, entry.name))).digest('hex');
  }
}
await hashFiles(output);
await writeFile(path.join(output, 'migration.json'), JSON.stringify({ sourceCommit: commit, base,
  games: games.map(({ id, href }) => ({ id, href })), files: hashes }, null, 2) + '\n');
const destination = path.join(root, 'public/games/alice');
try {
  await access(destination);
  // Do not mix builds or erase an existing installation implicitly.
  throw new Error(`Destination already exists: ${destination}. Review the new build at ${output} before replacing it.`);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await cp(output, destination, { recursive: true });
for (const game of games) {
  await cp(path.join(source, 'public', game.cover), path.join(root, 'public/images', `alice-${game.id}${path.extname(game.cover)}`));
}
await writeFile(projectsPath, JSON.stringify(projects, null, 2) + '\n');
console.log(`Imported ${games.length} games (${Object.keys(hashes).length} files) from ${commit}.`);
