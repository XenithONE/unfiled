import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
const require=createRequire(import.meta.url);
// Format-only export. Pass the installed sharp package path as the first argument.
const sharp=require(process.argv[2] || 'sharp');
const manifest=JSON.parse(await readFile('design/tenjou-no-mukou/rush-prompts.json','utf8'));
for (const {atlas,source} of manifest.promptSet) {
 const info=await sharp(source).webp({quality:93,effort:6}).toFile(`public/comics/tenjou-no-mukou/art/${atlas}.webp`);
 console.log(atlas,info.width,info.height,info.size);
}
