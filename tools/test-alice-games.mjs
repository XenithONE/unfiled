import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(root, 'public');
const gameRoot = path.join(publicRoot, 'games/alice');
const manifest = JSON.parse(await readFile(path.join(gameRoot, 'migration.json'), 'utf8'));
const projects = JSON.parse(await readFile(path.join(publicRoot, 'projects.json'), 'utf8'));
assert.equal(manifest.games.length, 13);
assert.equal(new Set(projects.map(project => project.id)).size, projects.length, 'Duplicate project ID');

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
// RELIC ROAD fetches these at runtime, outside Vite's import graph.
for (const file of ['board-plate.webp', 'title-hero.webp', 'class-portraits.webp', 'audio/ui-click.ogg', 'audio/overworld-loop.ogg']) {
  assert.ok((await stat(path.join(gameRoot, 'assets/quest', file))).isFile());
}
console.log(`PASS: 13 games, catalog links, HTML assets and ${Object.keys(manifest.files).length} distribution hashes.`);
