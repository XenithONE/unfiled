export const LENGTH = 6800;
export const HALF_WIDTH = 1350;
export const SEED = 8848;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const center = (_s: number) => 0;
function rawGround(s: number, x = 0) {
  const spread=clamp(s/700,0,1),t=clamp(s/LENGTH,0,1),base=s<0?-s*.74:s>LENGTH?-3484-(s-LENGTH)*.04:-3484*(1-Math.pow(1-t,1.4));
  const ridge=(Math.sin(x*.005+s*.0018)**2*55+Math.sin(x*.013-s*.004)*11)*spread;
  return base+Math.sin(s*.013)*4+Math.sin(s*.003)*12+ridge+Math.pow(Math.abs(x)/1100,2)*65
    +Math.sin(s*.032+x*.065)*.4;
}
// The rider and terrain share the same triangle surface, including between vertices.
export function ground(s:number,x=0){const dx=3700/180,dz=280/36,ix=Math.floor((x+1850)/dx),iz=Math.floor((s+200)/dz),x0=-1850+ix*dx,s0=-200+iz*dz,fx=(x-x0)/dx,fz=(s-s0)/dz;
  const a=rawGround(s0,x0),b=rawGround(s0,x0+dx),c=rawGround(s0+dz,x0),d=rawGround(s0+dz,x0+dx);
  return fx+fz<=1?a+(b-a)*fx+(c-a)*fz:d+(c-d)*(1-fx)+(b-d)*(1-fz);}
export const altitude = (s: number) => Math.round(8848 - clamp(s / LENGTH, 0, 1) * 3484);
export const zones = [
  { at: 0, name: 'SUMMIT RIDGE', ja: '山頂の稜線', alt: '8,848 m' },
  { at: 1250, name: 'SOUTH COL', ja: 'サウスコル', alt: '8,200 m' },
  { at: 2600, name: 'WESTERN CWM', ja: '静寂の谷', alt: '7,510 m' },
  { at: 4000, name: 'KHUMBU ICEFALL', ja: 'クンブ・アイスフォール', alt: '6,800 m' },
  { at: 5500, name: 'THE LAST FLIGHT', ja: 'ベースキャンプへの大滑走', alt: '6,030 m' },
];
export function zoneAt(s: number) { return [...zones].reverse().find(z => s >= z.at) ?? zones[0]; }
export function random(seed: number) { let n = seed; return () => { n |= 0; n = n + 0x6d2b79f5 | 0; let t = Math.imul(n ^ n >>> 15, 1 | n); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export type Feature = { id: number; s: number; x: number; width: number; kind: 'rock' | 'gap' | 'ramp' | 'ring' | 'boost'; size: number };
export function makeCourse() {
  const rng = random(SEED), features: Feature[] = [];
  const add = (s: number, x: number, kind: Feature['kind'], width: number, size = 1) => features.push({ id: features.length, s, x, kind, width, size });
  // Distributed mountain features. There is no lane, marked route or checkpoint.
  for(let s=220;s<LENGTH-180;s+=115){
    const width=Math.min(1050,100+s*.2);
    for(let i=0;i<5;i++){
      const x=(rng()*2-1)*width;
      add(s+rng()*85,x,'rock',3+rng()*7,2+rng()*5);
      if(i<2&&s>500)add(s+rng()*60,(rng()*2-1)*width,'gap',18+rng()*50,8+rng()*9);
      if(i<2)add(s+40,(rng()*2-1)*width,'ramp',16+rng()*22,1+rng()*.65);
    }
  }
  add(125,3,'ramp',22,1);add(365,-15,'ramp',25,1.2);
  for(let s=650;s<LENGTH-400;s+=430){add(s,-190-rng()*550,'rock',30+rng()*40,25+rng()*35);add(s+160,230+rng()*570,'rock',25+rng()*50,25+rng()*35);}
  return features.sort((a, b) => a.s - b.s);
}
export const COURSE = makeCourse();
export function featureRampLift(f:Feature,s:number,x:number){
  const dx=f.width/8,dz=18/12,xStart=f.x-f.width*.5,sStart=f.s-18,ix=clamp(Math.floor((x-xStart)/dx),0,7),iz=clamp(Math.floor((s-sStart)/dz),0,11),x0=xStart+ix*dx,s0=sStart+iz*dz,fx=clamp((x-x0)/dx,0,1),fz=clamp((s-s0)/dz,0,1);
  const sample=(ss:number,xx:number)=>{const t=clamp((ss-f.s+18)/18,0,1),edge=Math.max(0,1-Math.pow(Math.abs(xx-f.x)/(f.width*.5),6));return ground(ss,xx)+3.2*f.size*(.25*t+.75*t*t)*edge;};
  const a=sample(s0,x0),b=sample(s0,x0+dx),c=sample(s0+dz,x0),d=sample(s0+dz,x0+dx),surface=fx+fz<=1?a+(b-a)*fx+(c-a)*fz:d+(c-d)*(1-fx)+(b-d)*(1-fz);
  return Math.max(0,surface-ground(s,x));
}
export function rampLift(s:number,x:number) {
  for(const f of COURSE){if(f.s<s)continue;if(f.s>s+18)break;if(f.kind==='ramp'&&Math.abs(x-f.x)<=f.width*.5)return featureRampLift(f,s,x);}
  return 0;
}
export function rampGradient(s:number,x:number){for(const f of COURSE){if(f.s<s)continue;if(f.s>s+18)break;if(f.kind==='ramp'&&Math.abs(x-f.x)<=f.width*.5){const t=(s-f.s+18)/18,edge=Math.max(0,1-Math.pow(Math.abs(x-f.x)/(f.width*.5),6));return 3.2*f.size/18*(.25+1.5*t)*edge;}}return 0;}
