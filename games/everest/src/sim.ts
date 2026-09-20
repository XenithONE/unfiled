import { clamp, COURSE, HALF_WIDTH, LENGTH, rampLift, featureRampLift } from './course';
export type Actions = { steer: number; brake: boolean; jump: boolean; trick: boolean; boost: boolean };
export const idle: Actions = { steer: 0, brake: false, jump: false, trick: false, boost: false };
export type Rider = {
  id: string; name: string; color: number; s: number; x: number; vx: number; speed: number; heading:number; steer:number;
  height: number; ramp: number; vy: number; time: number; score: number; energy: number; combo: number;
  tricks: number; spin: number; spinTarget: number; airScore: number; airtime: number;
  recover: number; invulnerable: number; finish: boolean; finishTime: number; boosting: boolean;
  message: string; messageTime: number; hit: number; lastJump: boolean; lastTrick: boolean;
  used: Set<number>; near: Set<number>; ai: boolean;
};
export const COLORS = [0xff784f, 0x49dfd4, 0xffcd60, 0xaf96ff];
export function rider(id: string, name: string, index = 0, ai = false): Rider {
  return { id, name, color: COLORS[index % 4], s: 0, x: (index - 1.5) * 5, vx: 0, speed: 28, heading:0,steer:0,height: 0, ramp:0, vy: 0, time: 0, score: 0, energy: 65, combo: 1, tricks: 0, spin: 0, spinTarget: 0, airScore: 0, airtime: 0, recover: 0, invulnerable: 0, finish: false, finishTime: 0, boosting: false, message: '', messageTime: 0, hit: 0, lastJump: false, lastTrick: false, used: new Set(), near: new Set(), ai };
}
export function tell(r: Rider, message: string) { r.message = message; r.messageTime = 2.2; }
function launch(r: Rider, power: number, lift=r.ramp) { r.vy = power; r.height = lift+.05; r.ramp=0; r.airtime = 0; r.spin = r.spinTarget = 0; r.airScore = 0; }
function crash(r: Rider, gap: boolean) {
  r.recover = gap ? .85 : .5; r.invulnerable = 2.1; r.speed = Math.max(23, r.speed * .67);
  r.combo = 1; r.airScore = 0; r.spin = r.spinTarget = 0; r.hit++; r.vx *= .3;
  if (gap) { r.s+=18;r.height = 1; r.vy = 0; }
  tell(r, gap ? 'レスキュー！そのまま滑ろう' : '大丈夫、もう一度！');
}
export function aiActions(r: Rider): Actions {
  const desired = r.s>LENGTH-900?0:Math.sin(r.s * .0025 + Number(r.id.slice(-1))) * 140;
  const desiredHeading=Math.atan2(desired-r.x,120);
  let steer = clamp((desiredHeading-r.heading)*2, -1, 1), jump = false;
  const f = COURSE.find(f => f.s > r.s && f.s < r.s + 45 && (f.kind === 'gap' || f.kind === 'rock') && Math.abs(f.x - r.x) < f.width * .6 + 3);
  if (f) { steer = f.x > 0 ? -1 : 1; jump = true; }
  return { steer, jump, brake: false, trick: r.height > 2 && r.spinTarget === 0, boost: r.energy > 65 && r.s % 240 < 120 };
}
export function step(r: Rider, a: Actions, dt: number) {
  if (r.finish) return;
  r.time += dt; r.messageTime = Math.max(0, r.messageTime - dt);
  r.recover = Math.max(0, r.recover - dt); r.invulnerable = Math.max(0, r.invulnerable - dt);
  r.boosting = a.boost && r.energy > .5 && r.recover <= 0;
  r.energy = clamp(r.energy + (r.boosting ? -22 : 3.5) * dt, 0, 100);
  const target = (a.brake ? 18 : r.boosting ? 64 : 46 - Math.abs(a.steer) * 2)*clamp(.3+.7*Math.cos(r.heading),.16,1);
  r.speed += (target - r.speed) * (1 - Math.exp(-dt * (a.brake ? 2.4 : .7)));
  const oldS = r.s;
  r.steer=a.steer;r.heading+=a.steer*dt*(r.height>.1?.65:1.15);
  if(!a.steer)r.heading-=Math.sin(r.heading)*dt*.8;
  r.heading=Math.atan2(Math.sin(r.heading),Math.cos(r.heading));
  r.s = clamp(r.s + Math.cos(r.heading)*r.speed*dt*(r.recover>0?.6:1),-60,LENGTH+350);
  r.vx=Math.sin(r.heading)*r.speed;
  r.x += r.vx * dt;
  if (Math.abs(r.x) > HALF_WIDTH) { r.heading-=Math.sign(r.x)*dt*.8;r.speed=Math.max(18,r.speed-dt*10); }
  r.x = clamp(r.x, -1550, 1550);
  r.ramp=r.height<=0?rampLift(r.s,r.x):0;
  if (a.jump && !r.lastJump && r.height === 0 && r.recover <= 0) launch(r, 10.5);
  r.lastJump = a.jump;
  if (a.trick && !r.lastTrick && r.height > .05 && r.spinTarget < Math.PI * 6) {
    r.spinTarget += Math.PI * 2; r.airScore += 300; r.tricks++; tell(r, ['INDY GRAB + 360', 'BACKSIDE 720', 'TRIPLE SPIN 1080'][Math.min(2, Math.round(r.spinTarget / (Math.PI * 2)) - 1)]);
  }
  r.lastTrick = a.trick;
  if (r.height > 0) {
    r.airtime += dt; r.vy -= 17 * dt; r.height += r.vy * dt;
    r.spin += (r.spinTarget - r.spin) * (1 - Math.exp(-dt * 7));
    if (r.height <= 0) {
      r.height = r.vy = r.spin = r.spinTarget = 0;r.ramp=rampLift(r.s,r.x);
      if (r.airScore > 0) { const earned = Math.round(r.airScore * r.combo + r.airtime * 80); r.score += earned; r.energy = clamp(r.energy + 24, 0, 100); r.combo = Math.min(5, r.combo + 1); tell(r, `PERFECT LANDING  +${earned}`); }
      r.airScore = 0;
    }
  }
  for (const f of COURSE) {
    if (f.s < Math.min(oldS,r.s) - 60) continue;
    if (f.s > Math.max(oldS,r.s) + 60) break;
    const dx = Math.abs(r.x - f.x), crossed = oldS < f.s && r.s >= f.s;
    if(f.kind==='rock'&&r.height+r.ramp<f.size){const rx=f.width*.55+.65,rz=f.width*.6+.65,ox=(r.x-f.x)/rx,oz=(r.s-f.s)/rz,q=Math.hypot(ox,oz);
      if(q<1){if(r.invulnerable<=0){crash(r,false);r.heading+=Math.sign(ox||1)*.35;}const norm=Math.max(.001,q);r.x=f.x+ox/norm*rx*1.015;r.s=f.s+(q<.001?-1:oz/norm)*rz*1.015;r.used.add(f.id);continue;}}
    if (f.kind === 'gap' && Math.abs(r.s - f.s) < f.size * .5 && dx < f.width * .5 && r.height < .35 && r.invulnerable <= 0) crash(r, true);
    if (!crossed || r.used.has(f.id)) continue;
    if (f.kind === 'rock' && dx < f.width * .5 + .65 && r.height < f.size && r.invulnerable <= 0) crash(r, false);
    else if (f.kind === 'rock' && dx < f.width * .5 + 3 && r.invulnerable <= 0) { r.score += 120 * r.combo; r.energy = clamp(r.energy + 8, 0, 100); tell(r, 'CLOSE CALL  +120'); }
    else if (f.kind === 'ramp' && dx < f.width * .48 && r.height < .5) { launch(r,clamp(r.speed*(3.2*f.size/18)*1.75,11,18),featureRampLift(f,f.s,r.x)); tell(r, 'NATURAL AIR — X でトリック'); }
    else if (f.kind === 'ring' && dx < 5 && r.height > 1.4) { r.airScore += 200; r.energy = clamp(r.energy + 10, 0, 100); tell(r, 'SKY RING  +200'); }
    else if (f.kind === 'boost' && dx < f.width * .5 && r.height < 1) { r.speed = Math.max(r.speed, 55); r.energy = clamp(r.energy + 14, 0, 100); tell(r, 'FLOW LINE  +BOOST'); }
    r.used.add(f.id);
  }
  if (r.s >= LENGTH-8 && Math.abs(r.x)<150) { r.finish = true; r.finishTime = r.time; r.boosting = false; tell(r, 'BASE CAMP — おかえり！'); }
}
