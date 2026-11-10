// 世界：照明・舞台・役者・小道具・効果をまとめて持ち、コマごとに初期化する
import * as THREE from 'three/webgpu';
import { uniform, fog, positionWorld, cameraPosition, exp, pow, max, dot, mix, abs, select } from 'three/tsl';
import { box, rbox, mat, grp } from './core/kit.js';
import { vnoise } from './core/util.js';
import { Clawd } from './chars/clawd.js';
import { Gpt } from './chars/gpt.js';
import { Gemini } from './chars/gemini.js';
import { Grok } from './chars/grok.js';
import { Sky, Clouds, ENV } from './sets/sky.js';
import { Yard } from './sets/yard.js';
import { Saturn, makeCSM } from './props/saturn.js';
import { Lander } from './props/lander.js';
import { JunkRocket, BoosterRocket, PictureRocket, SafeRocket, Scroll } from './props/failrockets.js';
import { makeMoonGlobe, makeSunFlare } from './sets/space.js';
import { makeEarth } from './sets/earth.js';
import { MoonSet } from './sets/moon.js';
import { Cabin } from './sets/cabin.js';
import { Laptop, makeClipboard, makeSpark, Campfire, Holo, Computer, makeEngine, makeSign, makeCrate, makeSheet } from './props/props.js';
import { Bubbles } from './fx/bubble.js';
import { Puffs } from './fx/fx.js';

// 時間帯ごとの絵づくり（色・コントラスト・光の筋・レンズの光・霧の太陽側の明るさ）
const LOOKS = {
  day: { lift: [0.0, 0.010, 0.020], gain: [1.03, 1.0, 0.965], gamma: [1, 1, 1], sat: 1.03, con: 1.05, rays: 0.22, streak: 0.25, vig: 0.34, fogSun: 0.5, fall: 0.012 },
  sunset: { lift: [0.012, 0.0, 0.03], gain: [1.06, 0.99, 0.93], gamma: [1, 1, 1], sat: 1.06, con: 1.06, rays: 0.42, streak: 0.4, vig: 0.36, fogSun: 0.8, fall: 0.016 },
  night: { lift: [0.0, 0.008, 0.026], gain: [0.95, 1.0, 1.07], gamma: [1, 1, 1], sat: 0.94, con: 1.08, rays: 0.3, streak: 0.5, vig: 0.42, fogSun: 0.3, fall: 0.02 },
  dawn: { lift: [0.0, 0.014, 0.03], gain: [1.07, 1.0, 0.93], gamma: [1, 1, 1], sat: 1.05, con: 1.06, rays: 0.45, streak: 0.45, vig: 0.36, fogSun: 0.8, fall: 0.02 },
  space: { lift: [0.0, 0.0, 0.004], gain: [1.0, 1.0, 1.02], gamma: [1, 1, 1], sat: 1.0, con: 1.08, rays: 0.0, streak: 0.55, vig: 0.3, fogSun: 0, fall: 0.012 },
};
const lerp3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const _v3 = new THREE.Vector3(), _w3 = new THREE.Vector3(), _c1 = new THREE.Color();

export class World {
  constructor(engine) {
    this.engine = engine;
    this.scene = engine.scene;
    this.camera = engine.camera;
    this.post = engine.post;
    this.resets = [];     // コマの最初に呼ぶ初期化
    this.finals = [];     // コマの最後に呼ぶ仕上げ
    this.hidden = [];     // コマの最初に隠す物
    this.T = 0;
    this.quality = new URLSearchParams(location.search).get('q') === 'high' ? 'high' : 'low';
  }

  /** シーンに足して、毎コマ最初は隠しておく */
  add(obj) { this.scene.add(obj); this.hidden.push(obj); obj.visible = false; return obj; }
  /** reset() を持つ物を登録 */
  reg(o) { this.scene.add(o.root); this.resets.push(() => o.reset()); if (o.finish) this.finals.push((T) => { if (o.root.visible) o.finish(T); }); return o; }

  async build(qs) {
    const s = this.scene;
    // ---- 照明
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 3;
    s.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x6a5a48, 1);
    s.add(this.hemi);
    this.fill = new THREE.DirectionalLight(0xffffff, 0);
    s.add(this.fill, this.fill.target);
    this.amb = new THREE.AmbientLight(0xffffff, 0);
    s.add(this.amb);
    this._shadowKey = '';
    this.uSun = uniform(new THREE.Vector3(0.5, 0.6, 0.6).normalize());   // 天体の陰影用（太陽の方向）
    this.uSun2 = uniform(new THREE.Vector3(-0.3, 0.2, 0.9).normalize()); // 夜空の月の陰影用

    // ---- 霧：高さで薄くなり、太陽（や月）の側が明るくにじむ
    {
      const F = (this.fogU = { color: uniform(new THREE.Color(0xffffff)), sun: uniform(new THREE.Color(0xffffff)), dens: uniform(0), fall: uniform(0.012), dir: uniform(new THREE.Vector3(0, 1, 0)), pw: uniform(10) });
      const rd = positionWorld.sub(cameraPosition), dist = rd.length(), dir = rd.div(dist.max(1e-4));
      const t = dist.mul(dir.y).mul(F.fall);
      const integ = select(abs(t).lessThan(1e-3), dist, exp(t.negate()).oneMinus().div(dir.y.mul(F.fall)));
      const amount = exp(F.dens.mul(exp(cameraPosition.y.max(0).mul(F.fall).negate())).mul(integ).negate()).oneMinus().clamp(0, 1);
      s.fogNode = fog(mix(F.color, F.sun, pow(max(dot(dir, F.dir), 0), F.pw)), amount);
    }
    // ---- 空と雲
    this.sky = new Sky(); s.add(this.sky.phys, this.sky.mesh);
    this.clouds = new Clouds(); s.add(this.clouds.root);
    this.resets.push(() => { this.sky.mesh.visible = false; this.sky.phys.visible = false; this.sky.U.twinkle.value = 1; this.sky.U.spin.value = 0; this.sky.phys.cloudSpeed.value = 0.000035; });

    // ---- 舞台
    this.yard = this.reg(new Yard(this.quality === 'high'));
    this.moon = this.reg(new MoonSet());
    this.cabin = this.reg(new Cabin());

    // ---- 天体
    this.earth = this.add(makeEarth(this.uSun, this.engine.renderer, { hi: this.quality === 'high', near: { lat: 21, lon: -17, half: 23 } }));
    this.moonGlobe = this.add(makeMoonGlobe(this.uSun));
    this.skyMoon = this.add(makeMoonGlobe(this.uSun2, { gain: 2.1, earthshine: 0.02, fine: false }));
    this.sunFlare = this.add(makeSunFlare());

    // ---- 乗り物
    this.saturn = this.reg(new Saturn());
    this.lander = this.reg(new Lander());
    this.csm = this.add(makeCSM());
    this.junk = this.reg(new JunkRocket());
    this.booster = this.reg(new BoosterRocket());
    this.picture = this.reg(new PictureRocket());
    this.safe = this.reg(new SafeRocket());
    this.scroll = this.reg(new Scroll());

    // ---- 小道具
    this.laptop = this.reg(new Laptop());
    this.computer = this.reg(new Computer());
    this.campfire = this.reg(new Campfire());
    this.holo = this.reg(new Holo());
    this.clipboard = this.add(makeClipboard());
    this.spark = this.add(makeSpark());
    this.sign5 = this.add(makeSign('5'));
    this.crate = this.add(makeCrate());   // 木箱（板を打ちつけた箱）は props/gear.js
    this.engines = []; for (let i = 0; i < 6; i++) this.engines.push(this.add(makeEngine()));
    this.sheets = {};
    for (const k of ['claude', 'gpt', 'gemini', 'grok', 'final']) {
      const m = makeSheet(this.yard.bp[k]);   // 設計図の紙（折り目と反り）は props/gear.js
      m.castShadow = true; m.receiveShadow = true;
      this.sheets[k] = this.add(m);
    }

    // ---- 役者
    this.claude = new Clawd(); this.gpt = new Gpt(); this.gemini = new Gemini(); this.grok = new Grok();
    this.actors = [this.claude, this.gpt, this.gemini, this.grok];
    for (const a of this.actors) s.add(a.root);
    this.resets.push(() => { for (const a of this.actors) a.reset(); });
    this.finals.push((T) => { for (const a of this.actors) if (a.root.visible) a.finish(T); });

    // ---- 吹き出し
    this.bubbles = new Bubbles(12); s.add(this.bubbles.root);
    this.resets.push(() => this.bubbles.reset());

    // 試し撮り用の床
    this.test = this.add(grp(box(60, 0.2, 60, mat(0x9aa3ad), 0, -0.1, 0)));
  }

  /** 照明をまとめて決める */
  light(o = {}) {
    const c = o.center || [0, 0, 0];
    const d = o.sunDir || [0.5, 0.8, 0.4];
    const len = Math.hypot(d[0], d[1], d[2]) || 1;
    const D = o.dist ?? 120;
    this.sun.position.set(c[0] + (d[0] / len) * D, c[1] + (d[1] / len) * D, c[2] + (d[2] / len) * D);
    this.sun.target.position.set(c[0], c[1], c[2]);
    this.sun.color.set(o.sunColor ?? 0xffffff);
    this.sun.intensity = o.sunI ?? 3;
    this.sun.castShadow = o.shadow !== false;
    const size = o.size ?? 30;
    const keyStr = `${size}|${D}`;
    if (keyStr !== this._shadowKey) {
      const cam = this.sun.shadow.camera;
      cam.left = -size; cam.right = size; cam.top = size; cam.bottom = -size; cam.near = 1; cam.far = D * 2;
      cam.updateProjectionMatrix();
      this._shadowKey = keyStr;
    }
    this.hemi.color.set(o.sky ?? 0xbfd8ff);
    this.hemi.groundColor.set(o.ground ?? 0x6a5a48);
    this.hemi.intensity = o.hemiI ?? 1;
    const f = o.fillDir || [-0.5, 0.3, -0.6];
    this.fill.position.set(c[0] + f[0] * 50, c[1] + f[1] * 50, c[2] + f[2] * 50);
    this.fill.target.position.set(c[0], c[1], c[2]);
    this.fill.color.set(o.fillColor ?? 0xffffff);
    this.fill.intensity = o.fillI ?? 0;
    this.amb.intensity = o.ambI ?? 0;
    this.amb.color.set(o.ambColor ?? 0xffffff);
    this.engine.renderer.toneMappingExposure = o.exposure ?? 1;
    this.sky.U.sunDir.value.set(d[0] / len, d[1] / len, d[2] / len);
    this.sunDirNow = [d[0] / len, d[1] / len, d[2] / len];
    if (!o.keepSun) this.uSun.value.set(d[0] / len, d[1] / len, d[2] / len);
  }

  /** 時間帯（空と光）を決める。a と b を k で混ぜられる。 */
  env(a, b = a, k = 0, o = {}) {
    const sd = o.sunDir || [0.5, 0.8, 0.4];
    const e = this.sky.set(a, b, k, sd);
    if (o.cover !== undefined) this.sky.phys.cloudCoverage.value = o.cover;   // 雲の量をカット側で変えたいとき
    this.sky.mesh.visible = true;
    const L = e.light;
    this.light({ ...o, sunColor: o.sunColor ?? L.sunColor, sunI: L.sunI * (o.sunMul ?? 1), sky: L.sky, ground: L.ground, hemiI: L.hemiI * (o.hemiMul ?? 1), exposure: L.exposure * (o.exposure ?? 1) });
    // 空気の霞
    this.scene.fog.color.copy(e.fog); this.scene.fog.density = e.fogD * (o.fogMul ?? 1);
    // 絵づくり（時間帯の既定。カット側で W.post を上書きできる）
    {
      const la = LOOKS[a] || LOOKS.day, lb = LOOKS[b] || la, kk = typeof a === 'string' && typeof b === 'string' ? k : 0;
      const P = this.post, mixN = (key) => la[key] + (lb[key] - la[key]) * kk;
      const li = lerp3(la.lift, lb.lift, kk), ga = lerp3(la.gain, lb.gain, kk), gm = lerp3(la.gamma, lb.gamma, kk), gr = o.grade ?? 1;
      P.lift.value.setRGB(li[0] * gr, li[1] * gr, li[2] * gr);
      P.gain.value.setRGB(1 + (ga[0] - 1) * gr, 1 + (ga[1] - 1) * gr, 1 + (ga[2] - 1) * gr);
      P.gammaInv.value.setRGB(1 / gm[0], 1 / gm[1], 1 / gm[2]);
      P.saturation.value = 1 + (mixN('sat') - 1) * gr; P.contrast.value = 1 + (mixN('con') - 1) * gr; P.vignette.value = mixN('vig');
      P.rays.value = mixN('rays') * (o.rays ?? 1); P.streak.value = mixN('streak') * (o.streak ?? 1);
      const F = this.fogU, fs = mixN('fogSun');
      F.color.value.copy(e.fog); F.dens.value = e.fogD * (o.fogMul ?? 1) * 0.8; F.fall.value = o.fogFall ?? mixN('fall');
      _c1.copy(o.sunColor !== undefined ? _c1.set(o.sunColor) : L.sunColor);
      F.sun.value.copy(e.fog).lerp(_c1, fs).multiplyScalar(1 + fs * 0.25);
      const n = Math.hypot(sd[0], sd[1], sd[2]) || 1; F.dir.value.set(sd[0] / n, sd[1] / n, sd[2] / n);
    }
    // 空を映した環境光・映り込み
    const r = (v) => v.map((x) => Math.round(x * 40) / 40).join(',');
    const sig = [typeof a === 'string' ? a : 'x', typeof b === 'string' ? b : 'x', Math.round(k * 50) / 50, r(sd), o.envKey || ''].join('|');
    const ground = new THREE.Color().copy(o.envGround ? new THREE.Color(o.envGround) : L.ground).multiplyScalar(o.envGroundMul ?? 0.45);
    this.scene.environment = this.sky.capture(this.engine.renderer, sig, { ground, earth: o.envEarth, noGround: o.envNoGround });
    this.scene.environmentIntensity = e.envI * (o.envMul ?? 1);
    return e;
  }

  /** カメラ：位置・注視点・画角 */
  cam(pos, target, fov = 35, roll = 0) {
    const c = this.camera;
    c.position.set(pos[0], pos[1], pos[2]);
    c.up.set(Math.sin(roll), Math.cos(roll), 0);
    c.lookAt(target[0], target[1], target[2]);
    if (c.fov !== fov) { c.fov = fov; c.updateProjectionMatrix(); }
    this._look = target;
  }
  clip(near, far) {
    const c = this.camera;
    if (c.near !== near || c.far !== far) { c.near = near; c.far = far; c.updateProjectionMatrix(); }
  }
  /** 手ぶれ・振動（amp は m） */
  shake(amp, freq = 21) { this._shake = amp; this._shakeF = freq; }

  /** 吹き出し：役者の頭の上に出す */
  say(icon, actor, k = 1, o = {}) {
    const p = actor.root.position, sc = actor.root.scale.y;
    this.bubbles.say(icon, [p.x + (o.dx ?? 0), p.y + (actor.height + (actor.hover ?? 0) + 0.16) * sc + (o.dy ?? 0), p.z + (o.dz ?? 0)], k, o);
  }
  sayAt(icon, pos, k = 1, o = {}) { this.bubbles.say(icon, pos, k, o); }

  begin(T) {
    this.T = T;
    const P = this.post;
    P.fade.value = 0; P.flash.value = 0; P.bars.value = 0; P.tv.value = 0;
    P.vignette.value = 0.3; P.grain.value = 0.028; P.saturation.value = 1;
    P.tint.value.setRGB(1, 1, 1); P.fadeColor.value.setRGB(0, 0, 0);
    this.engine.bloom.strength.value = 0.26;
    this.engine.bloom.radius.value = 0.6;
    this.engine.bloom.threshold.value = 1.15;
    this.scene.background.setRGB(0, 0, 0);
    this.scene.environment = null; this.scene.fog.density = 0;
    P.bokeh.value = 0; P.focal.value = 1e6; P.contrast.value = 1; P.chroma.value = 0.0012;
    P.rays.value = 0; P.streak.value = 0.3; P.rayNear.value = 700; P.rayFall.value = 2.2;
    P.lift.value.setRGB(0, 0, 0); P.gain.value.setRGB(1, 1, 1); P.gammaInv.value.setRGB(1, 1, 1);
    this.fogU.dens.value = 0; this.rayDir = null;
    this.clip(0.1, 4000);
    this._shake = 0; this.cloudSpin = 0; this.flame = null;
    this.engine.ovBegin();
    for (const o of this.hidden) { o.visible = false; }
    for (const r of this.resets) r(T);
  }
  end(T) {
    if (this._shake > 0) {
      const c = this.camera, a = this._shake, f = this._shakeF;
      c.position.x += vnoise(T * f, 1) * a; c.position.y += vnoise(T * f, 2) * a; c.position.z += vnoise(T * f, 3) * a * 0.5;
      c.rotation.z += vnoise(T * f * 0.8, 4) * a * 0.012; c.rotation.x += vnoise(T * f * 0.9, 5) * a * 0.008;
    }
    this.camera.updateMatrixWorld();
    this.sky.mesh.position.copy(this.camera.position); this.sky.phys.position.copy(this.camera.position);
    this.sky.mesh.scale.setScalar(this.camera.far * 0.9);   // 星の球はいつも一番奥（地球や月より後ろ）
    if (this.cloudSpin) this.sky.phys.cloudSpeed.value = 0.000035 * (1 + this.cloudSpin * 0);
    this.sky.U.T.value = T;
    this.clouds.root.rotation.y = T * 0.0035 + this.cloudSpin;
    for (const f of this.finals) f(T);
    // 煙の粒：光の向き（カメラ基準）を渡し、奥から順に並べ替える
    {
      const L = Puffs.L, c = this.camera, d = this.sunDirNow || [0, 1, 0];
      c.updateMatrixWorld(); c.matrixWorldInverse.copy(c.matrixWorld).invert();
      L.sunV.value.set(d[0], d[1], d[2]).transformDirection(c.matrixWorldInverse);
      L.upV.value.set(0, 1, 0).transformDirection(c.matrixWorldInverse);
      L.sunC.value.copy(this.sun.color).multiplyScalar(this.sun.intensity * 0.3);
      L.ambC.value.copy(this.hemi.color).multiplyScalar(0.28 + this.hemi.intensity * 0.5);
      const fl = this.flame;
      if (fl) { L.flameV.value.set(fl.pos[0], fl.pos[1], fl.pos[2]).applyMatrix4(c.matrixWorldInverse); L.flameC.value.set(fl.color ?? 0xff9a50).multiplyScalar(fl.I ?? 1); }
      else L.flameC.value.setRGB(0, 0, 0);
      Puffs.flush(c);
    }
    // 光の筋：光源（太陽。夜は月）の画面上の位置を渡す。画面の外へ遠く外れたら消す
    {
      const P = this.post, c = this.camera;
      if (P.rays.value > 0) {
        if (this.rayDir) _v3.set(this.rayDir[0], this.rayDir[1], this.rayDir[2]);
        else if (this.skyMoon.visible) _v3.copy(this.skyMoon.position).sub(c.position);
        else { const d = this.sunDirNow || [0, 1, 0]; _v3.set(d[0], d[1], d[2]); }
        _v3.normalize();
        _w3.copy(_v3).transformDirection(c.matrixWorldInverse);
        if (_w3.z > -0.05) P.rays.value = 0;
        else {
          _v3.multiplyScalar(1e4).add(c.position).project(c);
          P.rayUV.value.set(_v3.x * 0.5 + 0.5, 0.5 - _v3.y * 0.5);
          const off = Math.max(Math.abs(_v3.x), Math.abs(_v3.y));
          P.rays.value *= 1 - Math.min(1, Math.max(0, (off - 1.2) / 0.8));
        }
      }
    }
    this.engine.ovEnd();
  }
}
export { ENV, LOOKS };
