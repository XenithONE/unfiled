import { random } from './course';
import type { Rider } from './sim';
import { tell } from './sim';
export type MountainEvent = { id:number; s:number; span:number; side:number; type:'avalanche'|'serac'|'wind' };
export function makeEvents(seed:number):MountainEvent[] {
  const rng=random(seed);return [1000,2300,3650,5050,6000].map((s,id)=>({id,s:s+rng()*220,span:240+rng()*130,side:rng()<.5?-1:1,type:id===0?'avalanche':id===2?'serac':(['avalanche','serac','wind'] as const)[Math.floor(rng()*3)]}));
}
export function activeEvent(events:MountainEvent[],s:number){return events.find(e=>s>e.s-190&&s<e.s+e.span);}
export function eventText(e:MountainEvent,s:number){const safe=e.side<0?'右':'左';return e.type==='wind'?'TAILWIND / 追い風！加速チャンス':e.type==='avalanche'?`${s<e.s?'雪崩の予兆':'AVALANCHE / 雪崩'} — ${safe}側へ抜けよう`:`ICE FALL / 氷塔が崩落 — ${safe}側が安全`;}
export function stepEvents(r:Rider,events:MountainEvent[],dt:number){
  const e=activeEvent(events,r.s);if(!e||r.s<e.s||r.finish)return;
  if(e.type==='wind'){r.speed=Math.min(65,r.speed+dt*9);r.energy=Math.min(100,r.energy+dt*6);return;}
  const unsafe=r.x*e.side>5&&r.x*e.side<780&&r.s>e.s+25&&r.s<e.s+e.span-30;
  if(unsafe&&r.invulnerable<=0&&r.height<2){r.speed=Math.max(25,r.speed*.8);r.invulnerable=2;r.hit++;r.combo=1;tell(r,e.type==='avalanche'?'雪煙を抜けよう！反対側へ':'氷の間を抜けよう！');}
  if(r.s>e.s+e.span-35&&!r.near.has(-e.id-1)){r.near.add(-e.id-1);r.score+=500;r.energy=Math.min(100,r.energy+18);tell(r,'MOUNTAIN ESCAPE  +500');}
}
