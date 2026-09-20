import '@fontsource/anton/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import './style.css';
import { MountainView } from './render';
import { Input } from './input';
import { rider, step, aiActions, idle } from './sim';
import type { Rider } from './sim';
import { altitude, LENGTH, zoneAt } from './course';
import { Room } from './network';
import { activeEvent, eventText, makeEvents, stepEvents } from './events';
import { Sound } from './sound';

const $ = <T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
document.querySelector('#app')!.innerHTML=`
  <div id="world" aria-label="エベレストの3D雪山"></div><div class="vignette"></div><div id="speed-lines"></div>
  <header><a class="brand" href="../../" aria-label="UNFILEDへ戻る"><svg viewBox="0 0 40 30" aria-hidden="true"><path d="M1 28 15 5l7 12 5-9 12 20H1Zm11-12 3-5 6 10-6-3Z"/></svg><span>EVEREST<span class="brand-sub">WHITE RUSH</span></span></a><div class="header-right"><span class="edition">HIMALAYAN FREERIDE / 01</span><button id="sound" class="icon-btn" aria-label="音を切り替え">SOUND ON</button><button id="pause" class="icon-btn" hidden>Ⅱ</button></div></header>
  <main id="menu">
    <div class="eyebrow"><span class="live-dot"></span> 27°59′17″ N &nbsp; 86°55′31″ E</div>
    <h1>NO TRACKS.<br>NO LIMITS.<span>JUST FREEDOM.</span></h1>
    <p class="tagline">ルートは、あなたが決める。</p><p class="intro">尾根を越え、谷へ飛び込み、雪煙の向こうへ。<br>広い山肌を自由に滑り、麓のベースキャンプを目指そう。</p>
    <div class="menu-actions"><button id="solo" class="primary">ひとりで滑る <span>↗</span></button><button id="online" class="secondary">オンライン対戦 <span>01—04</span></button><button id="local" class="text-btn">同じPCで 2人対戦 <span>→</span></button></div>
    <details class="help"><summary>操作ガイド ＋</summary><p>A / D または ← →：進路を変える（長押しで旋回） · SPACE：ジャンプ<br>X：空中トリック（連続で720・1080） · SHIFT：ブースト · S / ↓：ブレーキ<br>麓の光がゴール。目印のコースや必須チェックポイントはありません。<br>ESC：休憩 · ゲームパッド：左スティック / Aジャンプ / Xトリック / RTブースト<br>2人対戦：P1は A/D・SPACE・X・左SHIFT。P2は ←/→・ENTER・/・右SHIFT。</p></details>
    <div class="menu-foot"><span>SUMMIT <b>8,848</b> M</span><i>↘</i><span>BASE CAMP <b>5,364</b> M</span><span class="arcade">EV​​EREST INSPIRED · ARCADE TERRAIN</span></div>
  </main>
  <aside id="route-card"><span class="eyebrow">OPEN MOUNTAIN</span><svg viewBox="0 0 180 240" aria-hidden="true"><path class="mountain-line" d="m6 215 35-65 18 15L99 12l29 87 13-25 32 141"/><path class="route-line" d="m99 12-14 60 24 17-33 34 22 28-43 34 9 30"/><circle cx="99" cy="12" r="4"/><circle cx="64" cy="215" r="4"/></svg><div><b>360°</b><span>CHOOSE YOUR LINE<br>FIND YOUR WAY DOWN</span></div><small>雪崩 · 氷塔崩落 · 追い風<br>毎回変わる、山の表情。</small></aside>
  <section id="lobby" class="panel" hidden><span class="eyebrow">RIDE TOGETHER</span><h2>仲間と、山頂へ。</h2><p>最大4人のオンラインレース。ルームコードで合流。</p><label>ライダー名<input id="name" maxlength="16" value="RIDER" autocomplete="nickname"></label><div class="room-form"><button id="create-room" class="primary">ルームを作る</button><span>または</span><label>ルームコード<input id="room-code" maxlength="6" placeholder="6文字のコード" autocomplete="off"></label><button id="join-room" class="secondary">参加する</button></div><div id="room-info" hidden><p>ROOM <strong id="code-display"></strong> <button id="copy" class="text-btn">招待URLをコピー</button></p><ol id="members"></ol><button id="start-race" class="primary" disabled>2人以上でスタート</button></div><p id="net-status" role="status" aria-live="polite"></p><p class="fine">PeerJSの無料接続サービスを利用します。ネットワークによって接続できない場合があります。接続中はライダー名と滑走データを参加者間で共有します。</p><button id="back" class="text-btn">← タイトルへ</button></section>
  <div id="hud" hidden><div id="hud-a" class="rider-hud"><div class="location"><span id="zone-label">SUMMIT RIDGE</span><b id="altitude">8,848 <small>M</small></b></div><div class="speed"><b id="speed">0</b><span>KM/H</span></div><div class="boost"><span>FLOW / BOOST <b id="energy-label">65%</b></span><div><i id="energy"></i></div></div><div class="score"><span>STYLE</span><b id="score">000000</b><small id="combo">×1</small></div><div id="trick" class="trick"></div></div>
    <div id="hud-b" class="second-hud" hidden><span>PLAYER 02</span><strong id="speed-b">0</strong><small>KM/H</small><p id="stats-b"></p></div>
    <div class="run-bar"><span id="time">00:00.00</span><div class="progress"><i id="progress"></i><span></span></div><span id="distance">6.8 KM TO GO</span></div><ol id="positions"></ol><div id="event" role="status"></div><div id="run-hint">カーブ A D / ← →　ジャンプ SPACE　トリック X　ブースト SHIFT</div>
  <div id="compass"><span>BASE CAMP</span><b id="bearing">↑</b><small id="goal-range">6.8 KM</small></div>
  </div>
  <div id="countdown" hidden></div><div id="toast" role="status" aria-live="polite"></div>
  <section id="paused" class="panel small-panel" hidden><span class="eyebrow">TAKE A BREATH</span><h2>山は、待っている。</h2><button id="resume" class="primary">滑走を続ける →</button><button id="quit" class="text-btn">タイトルへ戻る</button></section>
  <section id="results" class="panel results" hidden><span class="eyebrow">8,848 → 5,364 M / DESCENT COMPLETE</span><h2>WHAT A RIDE.</h2><p>ベースキャンプ到着。最高の一本を、もう一度。</p><div id="result-list"></div><p id="best"></p><button id="again" class="primary">もう一度、山頂へ ↗</button><button id="result-menu" class="text-btn">タイトルへ戻る</button></section>
  <nav id="touch" hidden aria-label="タッチ操作"><div><button data-control="left" aria-label="左へ">◀</button><button data-control="right" aria-label="右へ">▶</button><button data-control="brake">BRAKE</button></div><div><button data-control="boost">BOOST</button><button data-control="trick">TRICK</button><button data-control="jump" class="jump">JUMP</button></div></nav>
  <div id="fatal" class="panel" hidden><h2>3D画面を開けませんでした</h2><p id="fatal-message"></p><button id="reload" class="primary">再読み込み</button></div>`;

let view:MountainView;
try{view=new MountainView($('world'));}catch(e){$('fatal').hidden=false;$('fatal-message').textContent='WebGL 2に対応したブラウザで、ハードウェアアクセラレーションを有効にしてお試しください。';$('reload').onclick=()=>location.reload();throw e;}
const input=new Input(),room=new Room(),sound=new Sound();
let mode:'solo'|'local'|'online'='solo',phase:'menu'|'lobby'|'countdown'|'racing'|'paused'|'result'='menu';
let riders:Rider[]=[rider('preview','RIDER',0)],events=makeEvents(8848),startAt=0,last=performance.now(),accumulator=0,netTick=0,uiTick=0,toastUntil=0,hiddenAt=0;
riders[0].s=15;
const fmt=(s:number)=>`${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toFixed(2).padStart(5,'0')}`;
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const newSeed=()=>crypto.getRandomValues(new Uint32Array(1))[0];
function showToast(s:string){$('toast').textContent=s;toastUntil=performance.now()+6000;$('toast').classList.add('show');}
function screens(){
  $('menu').hidden=phase!=='menu';$('route-card').hidden=phase!=='menu';$('lobby').hidden=phase!=='lobby';
  $('hud').hidden=!['countdown','racing','paused'].includes(phase);$('paused').hidden=phase!=='paused';$('results').hidden=phase!=='result';$('countdown').hidden=phase!=='countdown';
  $('pause').hidden=!['racing','paused'].includes(phase);$('touch').hidden=phase!=='racing'||mode==='local';$('hud-b').hidden=mode!=='local';
  document.body.classList.toggle('in-game',['countdown','racing','paused'].includes(phase));document.body.classList.toggle('split',mode==='local'&&phase!=='menu'&&phase!=='lobby');
}
function begin(nextMode:typeof mode,seed=newSeed(),at=Date.now()+3200){
  mode=nextMode;events=makeEvents(seed);input.clear();sound.start();view.reset();
  const name=$<HTMLInputElement>('name').value.trim().slice(0,16)||'RIDER';
  if(mode==='online'){const m=room.members.find(m=>m.id===room.id);riders=[rider(room.id,name,m?.index??0)];}
  else {room.leave();riders=mode==='local'?[rider('p1','PLAYER 01',0),rider('p2','PLAYER 02',1)]:[rider('p1',name,0),rider('ai1','KAI · CPU',1,true),rider('ai2','YUKI · CPU',2,true),rider('ai3','REN · CPU',3,true)];}
  phase='countdown';startAt=at;accumulator=0;netTick=0;screens();updateHUD();
}
function goMenu(){room.leave();phase='menu';mode='solo';riders=[rider('preview','RIDER')];riders[0].s=15;input.clear();view.reset();screens();sound.update(0,false);}
function pause(){if(phase==='paused'){phase='racing';input.clear();screens();return;}if(phase!=='racing')return;if(mode==='online'&&room.running){showToast('オンライン滑走は一時停止できません。タイトルに戻る場合は、下の終了ボタンを押してください。');$('paused').hidden=false;$('paused').querySelector('h2')!.textContent='オンライン滑走中';return;}phase='paused';input.clear();screens();}
$('solo').onclick=()=>begin('solo');$('local').onclick=()=>begin('local');$('online').onclick=()=>{phase='lobby';screens();};$('back').onclick=goMenu;
$('pause').onclick=pause;$('resume').onclick=()=>{if(mode==='online'&&room.running){$('paused').hidden=true;return;}pause();};$('quit').onclick=goMenu;$('result-menu').onclick=goMenu;
$('sound').onclick=()=>{sound.start();$('sound').textContent=sound.toggle()?'SOUND ON':'SOUND OFF';};
$('again').onclick=()=>{if(mode==='online'){if(room.host&&room.members.length<2)begin('solo');else if(room.host&&everyoneFinished())room.start(newSeed());else showToast('みんなの到着と、ホストの次レース開始を待っています。');}else begin(mode);};
$('create-room').onclick=()=>{room.create($<HTMLInputElement>('name').value);$('create-room').setAttribute('disabled','');$('join-room').setAttribute('disabled','');};
$('join-room').onclick=()=>{const code=$<HTMLInputElement>('room-code').value.trim().toUpperCase();if(!/^[A-Z0-9]{6}$/.test(code)){showToast('6文字のルームコードを入力してください。');return;}room.join(code,$<HTMLInputElement>('name').value);$('create-room').setAttribute('disabled','');$('join-room').setAttribute('disabled','');};
$('start-race').onclick=()=>room.start(newSeed());
$('copy').onclick=()=>{const u=new URL(location.href);u.searchParams.set('room',room.code);navigator.clipboard.writeText(u.href).then(()=>showToast('招待URLをコピーしました。')).catch(()=>showToast(`ルームコード：${room.code}`));};
room.onMessage=s=>{$('net-status').textContent=s;if(phase!=='lobby')showToast(s);};
room.onChange=()=>{
  $('room-info').hidden=room.members.length===0;$('code-display').textContent=room.code;
  $('members').innerHTML=room.members.map(m=>`<li><i style="background:#${[0xff784f,0x49dfd4,0xffcd60,0xaf96ff][m.index].toString(16)}"></i>${escape(m.name)} <span>${m.id===room.id?'YOU':m.index===0?'HOST':'READY'}</span></li>`).join('');
  const b=$<HTMLButtonElement>('start-race');b.disabled=!room.canStart;b.textContent=room.host?room.members.length<2?'友達の参加を待っています…':!room.canStart?'通信を同期しています…':`${room.members.length}人でスタート →`:'ホストのスタートを待っています…';
  $<HTMLButtonElement>('create-room').disabled=!!room.peer;$<HTMLButtonElement>('join-room').disabled=!!room.peer;
  if(mode==='online'&&!room.running&&phase!=='lobby'&&phase!=='menu'){mode='solo';if(phase==='result'){$('again').textContent='ひとりでもう一度 ↗';$<HTMLButtonElement>('again').disabled=false;}}
};
room.onStart=(seed,at)=>begin('online',seed,at);
window.addEventListener('keydown',e=>{if(e.code==='Escape'&&!e.repeat)pause();});
window.addEventListener('pagehide',()=>room.leave());
document.addEventListener('visibilitychange',()=>{input.clear();if(document.hidden){hiddenAt=Date.now();if(mode!=='online'&&['racing','countdown'].includes(phase)){phase='paused';screens();}}else hiddenAt=0;});
view.renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();phase='paused';room.leave();$('fatal').hidden=false;$('fatal-message').textContent='描画が一時停止しました。再読み込みで山頂から再開できます。';$('reload').onclick=()=>location.reload();});
function allRiders(){return mode==='online'?[...riders,...room.remotes.values()]:[...riders];}
function everyoneFinished(){return riders[0].finish&&room.members.every(m=>m.id===room.id||room.poses.get(m.id)?.finish);}
function rematchButton(){if(mode!=='online')return;const waiting=!everyoneFinished();$<HTMLButtonElement>('again').disabled=!room.host||waiting;$('again').textContent=waiting?'みんなの到着を待っています…':room.host?(room.members.length<2?'ひとりでもう一度 ↗':'みんなでもう一度 ↗'):'ホストの次レースを待っています';}
function finish(){
  phase='result';screens();sound.chime('finish');const all=allRiders().slice().sort((a,b)=>(a.finish?a.finishTime:Infinity)-(b.finish?b.finishTime:Infinity));
  $('result-list').innerHTML=all.map((r,i)=>`<div class="result-row"><span>0${i+1}</span><b>${escape(r.name)}</b><strong>${r.finish?fmt(r.finishTime):'滑走中'}</strong><small>${r.score.toLocaleString()} STYLE</small></div>`).join('');
  const r=riders[0];let best:{time:number;score:number}|null=null;try{const saved=JSON.parse(localStorage.getItem('white-rush-best')??'null');if(saved&&Number.isFinite(saved.time)&&Number.isFinite(saved.score)&&saved.time>0&&saved.score>=0)best=saved;best={time:Math.min(best?.time??Infinity,r.finishTime),score:Math.max(best?.score??0,r.score)};localStorage.setItem('white-rush-best',JSON.stringify(best));}catch{/* Storage is optional. */}
  $('best').textContent=best?`PERSONAL BEST  ${fmt(best.time)} / ${best.score.toLocaleString()} STYLE · この端末に保存`:'';
  $('again').textContent=mode==='online'?(room.host?'みんなでもう一度 ↗':'ホストの次レースを待っています'):'もう一度、山頂へ ↗';
  $<HTMLButtonElement>('again').disabled=mode==='online'&&!room.host;
  rematchButton();
}
function updateHUD(){
  const r=riders[0];$('speed').textContent=Math.round(r.speed*3.6).toString();$('altitude').innerHTML=`${altitude(r.s).toLocaleString()} <small>M</small>`;$('zone-label').textContent=zoneAt(r.s).name;
  $('score').textContent=Math.round(r.score).toString().padStart(6,'0');$('combo').textContent=`×${r.combo}`;$('energy').style.width=`${r.energy}%`;$('energy-label').textContent=`${Math.round(r.energy)}%`;
  const toGoal=Math.hypot(Math.max(0,LENGTH-r.s),r.x),angle=Math.atan2(-r.x,LENGTH-r.s)-r.heading;
  $('time').textContent=fmt(r.time);$('distance').textContent=`${(toGoal/1000).toFixed(1)} KM TO CAMP`;$('progress').style.width=`${Math.min(100,r.s/LENGTH*100)}%`;
  $('bearing').style.transform=`rotate(${angle}rad)`;$('goal-range').textContent=`${(toGoal/1000).toFixed(2)} KM`;
  $('trick').textContent=r.messageTime>0?r.message:'';$('trick').classList.toggle('visible',r.messageTime>0);
  const all=allRiders().sort((a,b)=>a.finish&&b.finish?a.finishTime-b.finishTime:b.s-a.s);
  $('positions').innerHTML=all.map((r,i)=>`<li class="${r.id===riders[0].id?'you':''}"><span>${i+1}</span><i style="background:#${r.color.toString(16).padStart(6,'0')}"></i>${escape(r.name)}<b>${r.finish?'FINISH':`${Math.round(r.s/LENGTH*100)}%`}</b></li>`).join('');
  const ev=activeEvent(events,r.s);$('event').textContent=ev?eventText(ev,r.s):'';$('event').classList.toggle('show',!!ev);$('event').classList.toggle('wind',ev?.type==='wind');
  $('run-hint').style.opacity=r.time<12?'1':'0';$('speed-lines').style.opacity=r.boosting?'.6':'0';
  if(mode==='local'){const b=riders[1];$('speed-b').textContent=Math.round(b.speed*3.6).toString();$('stats-b').textContent=`${b.score.toLocaleString()} STYLE · BOOST ${Math.round(b.energy)}%${b.finish?' · FINISH':''}`;}
}
function frame(now:number,render=true){
  if(render)requestAnimationFrame(frame);const dt=Math.min(document.hidden&&mode==='online'?2:.08,Math.max(0,(now-last)/1000));last=now;
  if(phase==='countdown'){const left=(startAt-Date.now())/1000;$('countdown').textContent=left>1?Math.ceil(left-1).toString():'DROP IN';if(left<=0){phase='racing';screens();sound.chime();}}
  if(phase==='racing'){
    accumulator+=dt;while(accumulator>=1/120){for(let i=0;i<riders.length;i++){const r=riders[i],score=r.score;step(r,r.ai?aiActions(r):input.actions(i,mode==='local'),1/120);stepEvents(r,events,1/120);if(i===0&&r.score>score)sound.chime();}accumulator-=1/120;}
    if(riders.filter(r=>!r.ai).every(r=>r.finish))finish();
  }
  if(mode==='online'&&room.running){room.update(dt);netTick+=dt;if(netTick>1/15){netTick=0;room.send(riders[0]);}
    if(phase==='result'&&Math.floor(now/1000)!==Math.floor((now-dt*1000)/1000)){$('result-list').innerHTML=allRiders().sort((a,b)=>(a.finish?a.finishTime:Infinity)-(b.finish?b.finishTime:Infinity)).map((r,i)=>`<div class="result-row"><span>0${i+1}</span><b>${escape(r.name)}</b><strong>${r.finish?fmt(r.finishTime):'滑走中'}</strong><small>${r.score.toLocaleString()} STYLE</small></div>`).join('');rematchButton();}}
  sound.update(riders[0].speed,phase==='racing');
  uiTick+=dt;if(uiTick>.08){uiTick=0;if(['racing','countdown','paused'].includes(phase))updateHUD();}
  if(now>toastUntil)$('toast').classList.remove('show');
  if(render){view.drawEvents(events,riders,now/1000,phase==='racing'||phase==='countdown');view.draw(allRiders(),mode==='local'?riders.slice(0,2):[riders[0]],phase==='paused'?0:dt,phase==='menu'||phase==='lobby');}
}
setInterval(()=>{if(document.hidden&&mode==='online'&&room.running){if(hiddenAt&&Date.now()-hiddenAt>60000){room.leave();mode='solo';phase='paused';screens();showToast('1分間の離席によりルームから退出しました。');}else frame(performance.now(),false);}},250);
screens();requestAnimationFrame(frame);
const invitation=new URLSearchParams(location.search).get('room');if(invitation&&/^[A-Z0-9]{6}$/i.test(invitation)){phase='lobby';$<HTMLInputElement>('room-code').value=invitation.toUpperCase();screens();}
// Read-only diagnostics for reproducible browser verification.
Object.defineProperty(window,'__EVEREST__',{value:{snapshot:()=>({phase,mode,riders:allRiders().map(r=>({id:r.id,s:r.s,x:r.x,height:r.height,ramp:r.ramp,heading:r.heading,speed:r.speed,score:r.score,tricks:r.tricks,hit:r.hit,finish:r.finish,time:r.time})),events,room:{id:room.id,code:room.code,host:room.host,members:room.members.length},render:{calls:view.renderer.info.render.calls,triangles:view.renderer.info.render.triangles},idle}),capture:()=>view.renderer.domElement.toDataURL('image/png')}});
