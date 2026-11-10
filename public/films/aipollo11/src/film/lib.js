// カットを書くための共通の道具
import { clamp, lerp, seg, ease, key, bump, pop, popInOut, hash1, vnoise, arc, mulberry, smooth, TAU } from '../core/util.js';
import { Puffs, Debris, Sparkles, Explosion, Flame, glowSprite } from '../fx/fx.js';
import * as OV from '../core/overlay.js';
import { PAD, DECK, TESTPAD, TOWER_X } from '../sets/yard.js';
import { MOUND } from '../sets/moon.js';
import { SEATS } from '../sets/cabin.js';
import { SAT } from '../props/saturn.js';

export { clamp, lerp, seg, ease, key, bump, pop, popInOut, hash1, vnoise, arc, mulberry, smooth, TAU };
export { Puffs, Debris, Sparkles, Explosion, Flame, glowSprite, OV, PAD, DECK, TESTPAD, TOWER_X, MOUND, SEATS, SAT };

export const mv = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
import * as THREE from 'three/webgpu';
const _y = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3();
/** 物体の +Y 軸を dir の向きへ向ける */
export function aim(obj, dir) { _d.set(dir[0], dir[1], dir[2]).normalize(); obj.quaternion.setFromUnitVectors(_y, _d); }
/** カメラを A→B へ（{p, t, f}） */
export function camK(W, k, A, B) { W.cam(mv(A.p, B.p, k), mv(A.t, B.t, k), lerp(A.f ?? 35, B.f ?? A.f ?? 35, k), lerp(A.r ?? 0, B.r ?? 0, k)); }

/** 作業場での 4 人の立ち位置 */
export const HOME = { claude: [-2.4, 0, 1.0], gpt: [-0.85, 0, 1.4], gemini: [0.85, 0, 1.4], grok: [2.4, 0, 1.0] };
/** 試験台を見守る位置 */
export const WATCH = { claude: [-3.6, 0, -8.4], gpt: [-1.9, 0, -7.5], gemini: [1.7, 0, -7.7], grok: [3.4, 0, -8.6] };
export const NAMES = ['claude', 'gpt', 'gemini', 'grok'];

/** 4 人を決まった位置に置く。yaw は数か、見る点 [x,z] */
export function place4(W, where = HOME, yaw = 0) {
  for (const n of NAMES) {
    const p = where[n];
    W[n].at(p[0], p[1], p[2]);
    if (Array.isArray(yaw)) W[n].faceTo(yaw[0], yaw[1]); else W[n].yaw(yaw);
  }
}
/** その場でぴょんと跳ねる（t0 から dur 秒・高さ h） */
export function hop(a, t, t0, dur = 0.42, h = 0.38) {
  const u = (t - t0) / dur;
  if (u <= -0.25 || u >= 1.3) return 0;
  if (u < 0) { a.squash(1 - 0.18 * Math.sin((u + 0.25) / 0.25 * Math.PI * 0.5)); return 0; }
  if (u > 1) { a.squash(1 - 0.2 * Math.sin(((u - 1) / 0.3) * Math.PI)); return 0; }
  const y = arc(u) * h;
  a.root.position.y += y; a.squash(1 + 0.16 * Math.cos(u * Math.PI) * (u < 0.5 ? 1 : -0.6));
  return y;
}
/** 何度も跳ねる */
export function hops(a, t, t0, n, every = 0.5, h = 0.3) { for (let i = 0; i < n; i++) hop(a, t, t0 + i * every, every * 0.8, h); }
/** 放物線で跳んで移動（from→to）。戻り値は進み具合 0..1 */
export function leap(a, t, t0, dur, from, to, h = 1.2) {
  const u = clamp((t - t0) / dur);
  const p = mv(from, to, u);
  a.root.position.set(p[0], p[1] + arc(u) * h, p[2]);
  if (u > 0 && u < 1) a.squash(1 + 0.14 * Math.cos(u * Math.PI));
  return u;
}
/** 歩いて移動（from→to）。進む向きを向く。 */
export function walk(a, t, t0, t1, from, to, o = {}) {
  const u = (o.ease ?? ease.io)(seg(t, t0, t1));
  const p = mv(from, to, u);
  a.root.position.set(p[0], p[1], p[2]);
  const moving = t > t0 && t < t1;
  if (o.face !== false && (moving || o.keepFace)) a.root.rotation.y = Math.atan2(to[0] - from[0], to[2] - from[2]);
  if (moving && a.walk) a.walk(t * (o.rate ?? 13), o.amt ?? 1);
  if (moving && !a.walk) { a.root.position.y += Math.abs(Math.sin(t * (o.rate ?? 9))) * (o.bounce ?? 0.1); }
  return u;
}

/** ちいさな土けむり・砂ぼこりをまとめて作る。events: [{t, p, n, size, speed, life, up}] */
export function poofs(W, events, o = {}) {
  // 土けむり：地面の色の細かい粉が、低く広がって、風に流れながら薄れていく。
  // 先に走る薄い粉（3 割）と、あとからふくらんで漂う粉。出る時刻と位置は events のまま。
  const mult = W.quality === 'high' ? 5 : 3;
  const list = [];
  for (const e of events) for (let i = 0; i < Math.round((e.n ?? 10) * mult); i++) list.push(e);
  const P = new Puffs(list.length, (i, rnd) => {
    const e = list[i];
    const a = rnd() * 6.283, fast = rnd() < 0.3;
    const sp = (e.speed ?? 1.6) * (fast ? 1.0 + rnd() * 1.2 : 0.12 + rnd() * 0.55);
    const r = (e.r ?? 0.15) * (0.3 + rnd());
    return {
      t: e.t + rnd() * (e.spread ?? 0.08) + (fast ? 0 : rnd() * 0.1), life: (e.life ?? 0.9) * (1.5 + rnd() * 1.7), size: (e.size ?? 0.3) * (fast ? 0.4 + rnd() * 0.35 : 0.55 + rnd() * 0.65),
      p: [e.p[0] + Math.cos(a) * r, e.p[1] + 0.03, e.p[2] + Math.sin(a) * r],
      v: [Math.cos(a) * sp, (e.up ?? 0.5) * 0.25 * rnd() * sp, Math.sin(a) * sp], drag: (e.drag ?? 3) * (fast ? 0.8 : 1.5), rise: (e.rise ?? 0.25) * 0.5 * rnd(),
    };
  }, { colA: 0xd3c5a8, colB: 0xb0a288, seed: 5, low: true, dust: true, opacity: 0.42, lump: 0.2, wind: [0.4, 0, 0.14], ...o });
  W.add(P.mesh);
  return P;
}

// 一日の流れ（カット名の頭で決める）：作戦会議は朝、失敗は昼から夕方へ、力を合わせる組み立ては次の朝。
// 太陽を低めにして、長い影と立体感を出す。カット側で env / sunDir を渡せばそちらが優先。
const TOD = [
  [/^b/, { env: 'dawn', env2: 'day', k: 0.62, sunDir: [0.8, 0.34, 0.4] }],
  [/^c1/, { env: 'day', env2: 'day', k: 0, sunDir: [0.64, 0.52, 0.5] }],
  [/^c2/, { env: 'day', env2: 'day', k: 0, sunDir: [0.34, 0.84, 0.4] }],
  [/^c3/, { env: 'day', env2: 'sunset', k: 0.3, sunDir: [-0.62, 0.44, 0.55] }],
  [/^c4/, { env: 'day', env2: 'sunset', k: 0.4, sunDir: [-0.7, 0.36, 0.52] }],
  [/^e/, { env: 'dawn', env2: 'day', k: 0.7, sunDir: [0.72, 0.42, 0.48] }],
];
const NOON = { env: 'day', env2: 'day', k: 0, sunDir: [0.45, 0.8, 0.5] };
export function timeOfDay(W) { const n = (W.shot && W.shot.name) || ''; for (const [re, v] of TOD) if (re.test(n)) return v; return NOON; }

/** 昼の作業場（発射台はまだ無い） */
export function dayYard(W, o = {}) {
  W.yard.root.visible = true; W.clouds.root.visible = true;
  W.yard.launch.visible = !!o.launch;
  const d = timeOfDay(W);
  return W.env(o.env ?? d.env, o.env2 ?? o.env ?? d.env2, o.k ?? (o.env ? 0 : d.k), { sunDir: o.sunDir ?? d.sunDir, size: o.size ?? 18, center: o.center ?? [0, 0, 0], ...o.light });
}
/** 夜の作業場（月が出ている） */
export const NIGHT_MOON = [-70, 235, -720];
export function nightYard(W, o = {}) {
  W.yard.root.visible = true; W.clouds.root.visible = true;
  W.yard.launch.visible = !!o.launch;
  if (o.open) { W.yard.work.visible = false; W.yard.testpad.visible = false; }
  W.yard.setNight(1);
  const e = W.env('night', 'night', 0, { sunDir: [-0.092, 0.309, -0.947], size: o.size ?? 18, center: o.center ?? [0, 0, 0], fillDir: o.fillDir ?? [0.25, 0.5, 1], fillColor: 0x7f9be0, fillI: o.fillI ?? 0.45, ...o.light });
  W.skyMoon.visible = true; W.skyMoon.position.set(...NIGHT_MOON); W.skyMoon.scale.setScalar(o.moonSize ?? 52);
  W.skyMoon.rotation.set(0.2, 2.4, 0.1);
  W.uSun2.value.set(0.42, -0.08, 0.9).normalize();
  return e;
}
/** 画面の黒フェード（始まりと終わり） */
export function fades(W, t, dur, fin = 0, fout = 0) {
  let f = 0;
  if (fin > 0) f = Math.max(f, 1 - seg(t, 0, fin));
  if (fout > 0) f = Math.max(f, seg(t, dur - fout, dur));
  W.post.fade.value = f;
}
