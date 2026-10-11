/** Rebuild only VORTEX CROWN from an explicitly reviewed private source commit. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  assert.ok(['--source', '--source-commit'].includes(args[i]) && args[i + 1],
    'Usage: node tools/sync-vortex-crown.mjs --source-commit <full SHA> [--source <alice-system checkout>]');
  assert.ok(!options[args[i]], `Duplicate option: ${args[i]}`);
  options[args[i]] = args[i + 1];
}
assert.match(options['--source-commit'] ?? '', /^[a-f0-9]{40}$/,
  'Pass the full reviewed source SHA with --source-commit. The source must be committed and clean.');
const source = path.resolve(options['--source'] ?? path.join(root, '../alice-system'));
const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
const commit = git('rev-parse', 'HEAD');
assert.equal(commit, options['--source-commit'], 'Source checkout differs from the explicitly selected revision');
assert.equal(git('status', '--porcelain'), '', 'Source checkout has edits or untracked files; commit the reviewed source first');

const destination = path.join(root, 'public/games/alice');
const manifestPath = path.join(destination, 'migration.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const base = '/unfiled/games/alice/';
const home = '/unfiled/';
const entry = 'vortex-crown.html';
// Keep original shared chunks intact. The revision namespace also makes older
// cached HTML safe while GitHub Pages propagates the new entry point.
const assetsDir = `assets/vortex-enhanced/${commit.slice(0, 12)}`;
assert.equal(manifest.base, base);
assert.ok(manifest.games.some(game => game.id === 'vortex-crown' && game.href === entry));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function safeRelative(file) {
  assert.ok(file && !file.includes('\\') && !path.posix.isAbsolute(file)
    && file.split('/').every(part => part && part !== '.' && part !== '..'), `Unsafe distribution path: ${file}`);
  return file;
}
async function hashesIn(dir, prefix = '') {
  const hashes = {};
  for (const item of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = safeRelative(prefix + item.name);
    assert.ok(!item.isSymbolicLink(), `Symlink is not a distributable asset: ${file}`);
    if (item.isDirectory()) Object.assign(hashes, await hashesIn(path.join(dir, item.name), `${file}/`));
    else if (file !== 'migration.json') hashes[file] = digest(await readFile(path.join(dir, item.name)));
  }
  return hashes;
}
const originalHashes = await hashesIn(destination);
assert.deepEqual(originalHashes, manifest.files, 'Existing distribution differs from its manifest; resolve those edits before rebuilding');

const requireSource = createRequire(path.join(source, 'package.json'));
const sourcePackage = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
// A selective update must not silently outgrow the already published notices.
const notices = await readFile(path.join(destination, 'THIRD_PARTY_NOTICES.txt'), 'utf8');
const checkedPackages = new Set();
async function checkNotice(name) {
  if (checkedPackages.has(name)) return;
  checkedPackages.add(name);
  const pkg = JSON.parse(await readFile(path.join(source, 'node_modules', name, 'package.json'), 'utf8'));
  assert.ok(notices.includes(`=== ${name} ${pkg.version} (`),
    `Update THIRD_PARTY_NOTICES.txt for ${name} ${pkg.version} before importing new dependencies`);
  for (const dependency of Object.keys(pkg.dependencies ?? {})) await checkNotice(dependency);
}
for (const name of Object.keys(sourcePackage.dependencies)) await checkNotice(name);
const { build } = await import(pathToFileURL(requireSource.resolve('vite')).href);
const { default: react } = await import(pathToFileURL(requireSource.resolve('@vitejs/plugin-react')).href);
const output = await mkdtemp(path.join(tmpdir(), 'unfiled-vortex-'));
let patchedHome = false;
await build({
  configFile: false,
  root: source,
  base,
  publicDir: false,
  plugins: [{
    name: 'unfiled-vortex-home',
    enforce: 'pre',
    transform(code, id) {
      const relative = path.relative(source, id.split('?')[0]).replaceAll('\\', '/');
      if (relative !== 'src/vortex/App.tsx') return;
      assert.ok(code.includes('window.location.assign(BASE_URL)'), 'VORTEX home-link patch no longer matches; review the source');
      patchedHome = true;
      return { code: code.replaceAll('window.location.assign(BASE_URL)', `window.location.assign("${home}")`), map: null };
    },
    transformIndexHtml: {
      order: 'pre',
      handler: html => html.replaceAll('/alice-system/', base).replace(/\s*<link rel="manifest"[^>]*>/g, ''),
    },
  }, react()],
  define: { __APP_VERSION__: JSON.stringify(sourcePackage.version) },
  build: {
    target: 'es2022', outDir: output, emptyOutDir: false, assetsDir,
    sourcemap: false, chunkSizeWarningLimit: 6000,
    rollupOptions: { input: { 'vortex-crown': path.join(source, entry) } },
  },
});
assert.ok(patchedHome, 'VORTEX home-link patch was not applied');
// Reject changes while Vite was running, so the manifest identifies the exact code.
assert.equal(git('rev-parse', 'HEAD'), commit, 'Source revision changed during the build');
assert.equal(git('status', '--porcelain'), '', 'Source changed during the build');
const builtHashes = await hashesIn(output);
assert.ok(builtHashes[entry] && Object.keys(builtHashes).length > 1, 'VORTEX build is incomplete');
for (const file of Object.keys(builtHashes)) {
  assert.ok(file === entry || file.startsWith(`${assetsDir}/`), `Build would overwrite another game: ${file}`);
  if (file !== entry && originalHashes[file]) assert.equal(builtHashes[file], originalHashes[file],
    `The same source revision produced different bytes for ${file}; check the locked dependency installation`);
}
// All HTML dependencies must be either in this build or in the original migration.
const html = await readFile(path.join(output, entry), 'utf8');
for (const [, ref] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  if (/^(https?:|data:|#)/.test(ref) || ref === home) continue;
  const url = new URL(ref, `https://xenithone.github.io${base}${entry}`);
  assert.ok(url.pathname.startsWith(base), `Unexpected VORTEX asset outside its distribution: ${ref}`);
  const relative = safeRelative(decodeURIComponent(url.pathname.slice(base.length)));
  assert.ok(builtHashes[relative] || originalHashes[relative], `Missing VORTEX HTML dependency: ${ref}`);
}

const noteStart = '<!-- VORTEX_ENHANCEMENT_START -->';
const noteEnd = '<!-- VORTEX_ENHANCEMENT_END -->';
const note = `${noteStart}\n## VORTEX CROWN 改良版\n\nVORTEX CROWNは初回移行後に改良したソースから個別に再ビルドしています。Rapierによる物理シミュレーションと戦闘演出の改良を含みます。保存キーは維持しています。ほかの12作品の配信ファイルは変更していません。\n\n使用したソースのコミットはmigration.jsonのgameOverrides.vortex-crown.sourceCommit、専用ビルドのファイルは同項目のfilesで確認できます。初回移行時のsourceCommitは当時の記録として残しています。\n${noteEnd}`;
let readme = await readFile(path.join(destination, 'README_JA.md'), 'utf8');
readme = readme.replace('ゲームのルールと保存キーは原版を維持しています。', '初回移行時にはゲームのルールと保存キーを原版から引き継いでいます。');
if (readme.includes(noteStart)) {
  assert.ok(readme.includes(noteEnd), 'Incomplete VORTEX enhancement note');
  readme = readme.slice(0, readme.indexOf(noteStart)) + note + readme.slice(readme.indexOf(noteEnd) + noteEnd.length);
} else readme = `${readme.trimEnd()}\n\n${note}\n`;

// Copy immutable assets before switching the HTML entry. Never replace original
// shared chunks or rebuild the other twelve entry points.
for (const file of Object.keys(builtHashes).filter(file => file !== entry)) {
  await mkdir(path.dirname(path.join(destination, file)), { recursive: true });
  await cp(path.join(output, file), path.join(destination, file));
}
await cp(path.join(output, entry), path.join(destination, entry));
await writeFile(path.join(destination, 'README_JA.md'), readme);
const hashes = await hashesIn(destination);
for (const [file, hash] of Object.entries(originalHashes)) {
  if (file !== entry && file !== 'README_JA.md') assert.equal(hashes[file], hash, `Unrelated file changed: ${file}`);
}
manifest.gameOverrides = {
  ...manifest.gameOverrides,
  'vortex-crown': { sourceCommit: commit, entry, assetsDir: `${assetsDir}/`, files: Object.keys(builtHashes).sort() },
};
manifest.files = hashes;
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Updated VORTEX CROWN from ${commit}; ${Object.keys(builtHashes).length} build files. Other game bytes preserved.`);
console.log(`Staged build retained for inspection: ${output}`);
