// Format-only export to lossy WebP; no cropping, recoloring or redrawing.
// Usage: node export-art.mjs <sharp-package-path> <generated-images-directory>
import { createRequire } from 'node:module';
import { readFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const sharp = require(process.argv[2]);
const here = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(here, '../..');
const target = path.join(project, 'public/comics/tenjou-no-mukou/art');
const { files } = JSON.parse(await readFile(path.join(here, 'asset-prompts.json'), 'utf8'));
await mkdir(target, { recursive: true });
for (const [name, source] of Object.entries(files)) {
  const out = path.join(target, `${name}.webp`);
  const info = await sharp(path.join(process.argv[3], source)).webp({ quality: 92, effort: 6 }).toFile(out);
  console.log(`${name}: ${info.width}x${info.height}, ${Math.round(info.size / 1024)} KB`);
}
await copyFile(path.join(target, 'cover.webp'), path.join(project, 'public/images/tenjou-no-mukou.webp'));
