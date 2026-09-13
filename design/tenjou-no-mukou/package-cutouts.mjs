// Packages Image Gen's background-extracted artwork as alpha-bearing WebP.
// No new artwork is synthesized here; neutral preview matte becomes alpha.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const out = path.join(root, 'public/comics/tenjou-no-mukou/art');
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'cutout-prompts.json'), 'utf8'));
const layouts = {};
const clamp = n => Math.max(0, Math.min(1, n));
function run(args, input) {
  const r = spawnSync('ffmpeg', ['-hide_banner','-loglevel','error',...args], {input,maxBuffer:64*1024*1024});
  if(r.status!==0) throw Error(r.stderr?.toString() || 'ffmpeg failed');
  return r.stdout;
}
for(const asset of manifest.assets) {
  const probe = spawnSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','json',asset.source],{encoding:'utf8'});
  if(probe.status!==0) throw Error(probe.stderr);
  const {width,height}=JSON.parse(probe.stdout).streams[0];
  if(asset.name==='floor-runway') {
    run(['-y','-i',asset.source,'-c:v','libwebp','-quality','88',path.join(out,'floor-runway.webp')]);
    continue;
  }
  const rgba=run(['-i',asset.source,'-f','rawvideo','-pix_fmt','rgba','pipe:1']);
  const hasAlpha=rgba.some((v,i)=>i%4===3&&v<255);
  if(!hasAlpha) {
    for(let p=0;p<rgba.length;p+=4) {
      const r=rgba[p],g=rgba[p+1],b=rgba[p+2];
      const low=Math.min(r,g,b),chroma=Math.max(r,g,b)-low;
      const neutral=clamp((28-chroma)/16);
      const opacity=1-neutral*(1-clamp((165-low)/130));
      rgba[p+3]=Math.round(255*opacity);
      // Remove neutral matte contamination from partially transparent hair edges.
      if(opacity>0&&opacity<1) for(let c=0;c<3;c++) rgba[p+c]=Math.round(Math.min(255,Math.max(0,(rgba[p+c]-205*(1-opacity))/opacity)));
    }
  }
  const grid=asset.name==='final'?1:3,cw=width/grid,ch=height/grid;
  const boxes=[];
  for(let row=0;row<grid;row++) for(let col=0;col<grid;col++) {
    let left=width,top=height,right=-1,bottom=-1,transparent=0;
    for(let y=Math.round(row*ch);y<Math.round((row+1)*ch);y++) for(let x=Math.round(col*cw);x<Math.round((col+1)*cw);x++) {
      const a=rgba[(y*width+x)*4+3];
      if(a===0) transparent++;
      if(a>80){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
    }
    if(right<left||transparent<cw*ch*.02) throw Error('Missing subject/transparency: '+asset.name+' '+row+','+col);
    boxes.push([left,top,right-left+1,bottom-top+1]);
  }
  const filename='ghost-'+asset.name+'.webp';
  run(['-y','-f','rawvideo','-pixel_format','rgba','-video_size',width+'x'+height,'-i','pipe:0','-frames:v','1','-c:v','libwebp','-lossless','1',path.join(out,filename)],rgba);
  layouts[asset.name]={width,height,boxes};
  process.stdout.write(asset.name+': '+boxes.length+' sprites, '+Math.round(fs.statSync(path.join(out,filename)).size/1024)+' KiB\n');
}
fs.writeFileSync(path.join(root,'public/comics/tenjou-no-mukou/sprite-layout.js'),'// Generated alpha bounds for the extracted ghost artwork.\nexport const spriteLayout = '+JSON.stringify(layouts)+';\n');
