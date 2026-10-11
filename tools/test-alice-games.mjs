import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(root, 'public');
const gameRoot = path.join(publicRoot, 'games/alice');
const manifest = JSON.parse(await readFile(path.join(gameRoot, 'migration.json'), 'utf8'));
const projects = JSON.parse(await readFile(path.join(publicRoot, 'projects.json'), 'utf8'));
assert.equal(manifest.games.length, 13);
assert.equal(new Set(projects.map(project => project.id)).size, projects.length, 'Duplicate project ID');

async function distributionFiles(dir, prefix = '') {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = prefix + entry.name;
    assert.ok(!entry.isSymbolicLink(), `Unexpected symlink: ${file}`);
    if (entry.isDirectory()) files.push(...await distributionFiles(path.join(dir, entry.name), `${file}/`));
    else if (file !== 'migration.json') files.push(file);
  }
  return files;
}
assert.deepEqual((await distributionFiles(gameRoot)).sort(), Object.keys(manifest.files).sort(),
  'Distribution inventory differs from its manifest');

for (const [file, hash] of Object.entries(manifest.files)) {
  const bytes = await readFile(path.join(gameRoot, file));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, `Incomplete or changed distribution: ${file}`);
}
for (const { id, href } of manifest.games) {
  const project = projects.find(item => item.id === id);
  assert.ok(project, `Missing catalog card: ${id}`);
  assert.equal(project.url, `https://xenithone.github.io${manifest.base}${href}`);
  assert.match(project.cover, /^images\/[\w./-]+$/, 'Cover must follow the hub catalog contract');
  assert.ok((await stat(path.join(publicRoot, project.cover))).isFile(), `Missing cover: ${id}`);
  const html = await readFile(path.join(gameRoot, href), 'utf8');
  assert.match(html, /<title>[^<]+<\/title>/i, `Missing title: ${id}`);
  assert.ok(!html.includes('/alice-system/'), `Old site path: ${id}`);
  for (const [, ref] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (/^(https?:|data:|#)/.test(ref) || ref === '/unfiled/') continue;
    const url = new URL(ref, project.url);
    assert.ok(url.pathname.startsWith('/unfiled/'), `Asset escapes the site: ${ref}`);
    const local = path.join(publicRoot, decodeURIComponent(url.pathname.slice('/unfiled/'.length)));
    assert.ok((await stat(local)).isFile(), `Missing HTML dependency: ${id} -> ${ref}`);
  }
}
for (const [id, override] of Object.entries(manifest.gameOverrides ?? {})) {
  const game = manifest.games.find(game => game.id === id);
  assert.ok(game, `Override has no catalog game: ${id}`);
  assert.equal(override.entry, game.href);
  assert.match(override.sourceCommit, /^[a-f0-9]{40}$/, `Override has no exact source revision: ${id}`);
  assert.equal(id, 'vortex-crown', 'Review a new per-game build before extending the override contract');
  assert.equal(override.assetsDir, `assets/vortex-enhanced/${override.sourceCommit.slice(0, 12)}/`);
  assert.ok(override.files.includes(override.entry) && override.files.length > 1, `Incomplete override: ${id}`);
  assert.equal(new Set(override.files).size, override.files.length, `Duplicate override files: ${id}`);
  for (const file of override.files) {
    assert.ok(file === override.entry || file.startsWith(override.assetsDir), `Override escapes its own assets: ${file}`);
    assert.ok(manifest.files[file], `Unverified override file: ${file}`);
  }
  const html = await readFile(path.join(gameRoot, override.entry), 'utf8');
  const bundles = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(match => match[1]);
  assert.ok(bundles.length >= 2, `Missing VORTEX JavaScript or stylesheet`);
  for (const ref of bundles) {
    assert.ok(ref.startsWith(manifest.base + override.assetsDir), `VORTEX uses an old/shared bundle: ${ref}`);
    assert.ok(override.files.includes(ref.slice(manifest.base.length)), `VORTEX bundle not included in override: ${ref}`);
  }
}
// RELIC ROAD fetches these at runtime, outside Vite's import graph.
for (const file of ['board-plate.webp', 'title-hero.webp', 'class-portraits.webp', 'audio/ui-click.ogg', 'audio/overworld-loop.ogg']) {
  assert.ok((await stat(path.join(gameRoot, 'assets/quest', file))).isFile());
}
console.log(`PASS: 13 games, catalog links, HTML assets and ${Object.keys(manifest.files).length} distribution hashes.`);
