import Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import { rider, COLORS } from './sim';
import type { Rider } from './sim';
import { LENGTH } from './course';
export type Member = { id: string; name: string; index: number };
export type Pose = Pick<Rider,'s'|'x'|'speed'|'height'|'ramp'|'heading'|'steer'|'spin'|'vx'|'time'|'score'|'finish'|'finishTime'|'boosting'|'color'> & {id:string};
export function pose(r:Rider):Pose { const {id,s,x,speed,height,ramp,heading,steer,spin,vx,time,score,finish,finishTime,boosting,color}=r;return {id,s,x,speed,height,ramp,heading,steer,spin,vx,time,score,finish,finishTime,boosting,color}; }
export function validPose(p:unknown):p is Pose {
  if(!p||typeof p!=='object')return false;const o=p as Pose;
  return typeof o.id==='string'&&o.id.length<80&&['s','x','speed','height','ramp','heading','steer','spin','vx','time','score','finishTime','color'].every(k=>typeof o[k as keyof Pose]==='number'&&Number.isFinite(o[k as keyof Pose]))&&o.s>=-60&&o.s<=LENGTH+350&&Math.abs(o.x)<=1550&&Math.abs(o.heading)<=Math.PI+.01&&Math.abs(o.steer)<=1&&o.height>=0&&o.height<90&&o.ramp>=0&&o.ramp<10&&o.speed>=0&&o.speed<150&&o.time>=0&&o.score>=0&&o.score<1e9&&typeof o.finish==='boolean'&&typeof o.boosting==='boolean';
}
export class Room {
  peer?:Peer; conns=new Map<string,DataConnection>(); members:Member[]=[]; remotes=new Map<string,Rider>(); poses=new Map<string,Pose>();
  id=''; code=''; host=false; running=false; runId=''; clockOffset=0; generation=0; ready=new Set<string>(); timeout?:ReturnType<typeof setTimeout>; heartbeat?:ReturnType<typeof setInterval>;lastSeen=new Map<string,number>();
  onChange:()=>void=()=>{}; onMessage:(s:string)=>void=()=>{}; onStart:(seed:number,startAt:number)=>void=()=>{};
  create(name:string) { this.connect(true,'',name); }
  join(code:string,name:string) { this.connect(false,code,name); }
  connect(host:boolean,code:string,name:string) {
    this.leave();this.host=host;const gen=this.generation;
    this.code=host?Array.from(crypto.getRandomValues(new Uint8Array(6)),v=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[v%32]).join(''):code.toUpperCase().replace(/[^A-Z0-9]/g,'');
    this.onMessage('接続しています…');
    this.heartbeat=setInterval(()=>{if(gen!==this.generation)return;for(const [id,c] of this.conns){if(Date.now()-(this.lastSeen.get(id)??Date.now())>10000){this.drop(c);c.close();}else if(c.open)c.send({type:'heartbeat'});}},1500);
    this.peer=host?new Peer(`white-rush-v1-${this.code}`):new Peer();
    this.timeout=setTimeout(()=>{if(gen===this.generation){this.onMessage('接続できませんでした。ネットワークを確認して、もう一度お試しください。');this.leave();this.onChange();}},16000);
    this.peer.on('open',id=>{
      if(gen!==this.generation)return;this.id=id;
      if(host){clearTimeout(this.timeout);this.members=[{id,name:name.slice(0,16)||'RIDER',index:0}];this.onMessage('ルームを作成しました。コードを友達に伝えてください。');this.onChange();}
      else{const c=this.peer!.connect(`white-rush-v1-${this.code}`,{reliable:true,metadata:{name:name.slice(0,16)||'RIDER'}});this.bind(c,gen);}
    });
    this.peer.on('connection',c=>{
      if(!host||this.running||this.members.length>=4){c.on('open',()=>{c.send({type:'rejected',text:this.running?'滑走中です。次のレースをお待ちください。':'ルームは満員です。'});setTimeout(()=>c.close(),300);});return;}this.bind(c,gen);
    });
    this.peer.on('error',e=>{if(gen!==this.generation)return;const msg=e.type==='peer-unavailable'?'そのルームが見つかりません。コードを確認してください。':e.type==='unavailable-id'?'ルームコードが使用中です。もう一度作成してください。':'通信に失敗しました。別のネットワークかローカル対戦をお試しください。';this.onMessage(msg);this.leave();this.onChange();});
    this.peer.on('disconnected',()=>{if(gen!==this.generation)return;this.onMessage('ルームサーバーとの接続が切れました。ソロ／ローカル対戦は利用できます。');this.leave();this.onChange();});
  }
  bind(c:DataConnection,gen:number) {
    c.on('open',()=>{
      if(gen!==this.generation){c.close();return;}
      if(this.host&&(this.running||this.members.length>=4||this.conns.has(c.peer))){c.send({type:'rejected',text:'ルームに参加できません。次のレースでお試しください。'});setTimeout(()=>c.close(),300);return;}
      this.conns.set(c.peer,c);this.lastSeen.set(c.peer,Date.now());clearTimeout(this.timeout);
      if(this.host){const used=new Set(this.members.map(m=>m.index));let index=1;while(used.has(index))index++;const name=typeof c.metadata?.name==='string'?c.metadata.name.slice(0,16):'RIDER';this.members.push({id:c.peer,name,index});this.broadcast({type:'roster',members:this.members});this.onChange();}
      else { c.send({type:'ping',sent:Date.now()});this.onMessage('ルームに接続しました。ホストのスタートを待っています。'); }
    });
    c.on('data',raw=>{
      if(gen!==this.generation||!raw||typeof raw!=='object')return;this.lastSeen.set(c.peer,Date.now());const d=raw as Record<string,unknown>;
      if(d.type==='rejected'&&!this.host){this.onMessage(String(d.text).slice(0,120));this.leave();this.onChange();}
      if(d.type==='ping'&&this.host&&typeof d.sent==='number')c.send({type:'pong',sent:d.sent,hostTime:Date.now()});
      if(d.type==='pong'&&!this.host&&typeof d.sent==='number'&&Number.isFinite(d.sent)&&typeof d.hostTime==='number'&&Number.isFinite(d.hostTime)){this.clockOffset=d.hostTime-(d.sent+Date.now())/2;c.send({type:'ready'});}
      if(d.type==='ready'&&this.host){this.ready.add(c.peer);this.onChange();}
      if(d.type==='roster'&&!this.host&&Array.isArray(d.members)&&d.members.length<=4){
        this.members=d.members.filter((m):m is Member=>m&&typeof m.id==='string'&&typeof m.name==='string'&&Number.isInteger(m.index)&&m.index>=0&&m.index<4).map(m=>({...m,name:m.name.slice(0,16)}));
        for(const id of this.remotes.keys())if(!this.members.some(m=>m.id===id)){this.remotes.delete(id);this.poses.delete(id);}this.onChange();
      }
      if(d.type==='start'&&!this.host&&typeof d.seed==='number'&&Number.isFinite(d.seed)&&typeof d.startAt==='number'&&Number.isFinite(d.startAt)&&typeof d.runId==='string'&&this.runId!==d.runId){this.runId=d.runId;this.running=true;this.remotes.clear();this.poses.clear();this.onStart(d.seed,d.startAt-this.clockOffset);}
      if(d.type==='pose'&&d.runId===this.runId&&this.running&&validPose(d.pose)){
        const p=d.pose;if(this.host&&p.id!==c.peer)return;if(!this.members.some(m=>m.id===p.id)||p.id===this.id)return;
        p.color=COLORS[this.members.find(m=>m.id===p.id)!.index];this.poses.set(p.id,p);if(this.host)this.broadcast(d,c.peer);
      }
    });
    c.on('close',()=>{if(gen===this.generation)this.drop(c);});
    c.on('error',()=>{c.close();});
  }
  drop(c:DataConnection){if(this.conns.get(c.peer)!==c)return;this.conns.delete(c.peer);this.remotes.delete(c.peer);this.poses.delete(c.peer);this.ready.delete(c.peer);this.lastSeen.delete(c.peer);
    if(this.host){this.members=this.members.filter(m=>m.id!==c.peer);this.broadcast({type:'roster',members:this.members});this.onMessage('プレイヤーが退出しました。滑走は続けられます。');this.onChange();}
    else{this.onMessage('ホストとの接続が切れました。ソロとして滑走を続けられます。');this.leave();this.onChange();}}
  broadcast(d:unknown,except=''){for(const [id,c] of this.conns)if(id!==except&&c.open)c.send(d);}
  get canStart(){return this.host&&this.members.length>=2&&this.members.every(m=>m.id===this.id||this.ready.has(m.id));}
  start(seed:number){if(!this.canStart)return;this.runId=crypto.randomUUID();this.running=true;this.remotes.clear();this.poses.clear();const startAt=Date.now()+4000;this.broadcast({type:'start',seed,startAt,runId:this.runId});this.onStart(seed,startAt);}
  send(r:Rider){if(this.running)this.broadcast({type:'pose',runId:this.runId,pose:pose(r)});}
  update(dt:number){for(const [id,p] of this.poses){let r=this.remotes.get(id);if(!r){const m=this.members.find(m=>m.id===id);r=rider(id,m?.name??'RIDER',m?.index??1);Object.assign(r,p);this.remotes.set(id,r);}const smooth=1-Math.exp(-dt*14);r.s+=(p.s-r.s)*smooth;r.x+=(p.x-r.x)*smooth;r.height+=(p.height-r.height)*smooth;r.ramp+=(p.ramp-r.ramp)*smooth;r.heading+=Math.atan2(Math.sin(p.heading-r.heading),Math.cos(p.heading-r.heading))*smooth;r.steer=p.steer;r.spin+=(p.spin-r.spin)*smooth;r.vx=p.vx;r.speed=p.speed;r.score=p.score;r.time=p.time;r.finish=p.finish;r.finishTime=p.finishTime;r.boosting=p.boosting;}}
  leave(){this.generation++;clearTimeout(this.timeout);clearInterval(this.heartbeat);this.conns.forEach(c=>c.close());this.conns.clear();this.peer?.destroy();this.peer=undefined;this.members=[];this.remotes.clear();this.poses.clear();this.ready.clear();this.lastSeen.clear();this.running=false;this.runId='';this.id='';this.clockOffset=0;}
}
