// 効果：もくもく煙・土けむり・炎・光・爆発・破片・きらめき。すべて「時刻の関数」で、巻き戻しても同じ絵になる。
import * as THREE from 'three/webgpu';
import {
  uniform, instancedBufferAttribute, instancedDynamicBufferAttribute, positionLocal, positionView, vec2, vec3, vec4, float, mix, smoothstep, step, exp, sin, cos, color, uv,
  abs, pow, dot, sqrt, atan, fract, mx_noise_float, mx_fractal_noise_float, normalView, positionViewDirection, rotate, max, length, texture3D, cameraViewMatrix,
} from 'three/tsl';
import { softParticles } from 'three/addons/tsl/utils/SoftParticles.js';
import { mulberry } from '../core/util.js';
import { iattr } from '../core/kit.js';
import { FX_LAYER } from '../core/engine.js';
import { Plume, Fireball, noiseTex3D } from './plume.js';

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const plateGeo = new THREE.BoxGeometry(1, 0.05, 0.62, 12, 1, 4);   // 金属片のもと（シェーダーでねじって反らせる）

/**
 * 煙・土けむり・火の玉（やわらかい板を奥から順に重ねる。光は太陽・空・炎から受ける）。
 * fill(i, rnd) が 1 粒の設定を返す：
 *   { t: 生まれる時刻, life: 寿命, size: 最大半径, p: [x,y,z], v: [x,y,z], drag, rise }
 * 動きは式で決まる（巻き戻しても同じ絵）。毎コマ、カメラからの距離で並べ替えて描く。
 * o（すべて省略可）：
 *   colA, colB, colAt … 色（若いうち → 古くなって）   opacity, soft, lump, start, fadeAt, grav, floor, order, seed
 *   fire, fireEnd … 生まれたては炎の色で光る          glow … 自分で光る色
 *   dust: true … 土けむり（平たく低く広がる、輪郭のない細かい粉。光の当たり方もなだらか）
 *   aspect: [横, 縦] … 板の縦横比                     wind: [x, y, z] … 風で流れる速さ
 *   turb … 乱れ（進むほど蛇行する幅）                 contrast … 日なたと日かげの差（1 が標準）
 *   grain: true … 砂つぶ（奥行きを書く。月面用）
 */
export class Puffs {
  static active = new Set();
  /** みんなに共通の光（世界が毎コマ更新する） */
  static L = {
    sunV: uniform(new THREE.Vector3(0, 1, 0)), sunC: uniform(new THREE.Color(1, 1, 1)), ambC: uniform(new THREE.Color(0.3, 0.35, 0.45)),
    upV: uniform(new THREE.Vector3(0, 1, 0)), flameV: uniform(new THREE.Vector3(0, -1000, 0)), flameC: uniform(new THREE.Color(0, 0, 0)),
  };
  constructor(n, fill, o = {}) {
    this.n = n; this.o = o;
    const P = (this.P = new Float32Array(n * 12));   // t, life, size, seed, px,py,pz, rise, vx,vy,vz, drag
    const rnd = mulberry(o.seed ?? 7);
    for (let i = 0; i < n; i++) {
      const q = fill(i, rnd);
      P.set([q.t, q.life, q.size, rnd(), q.p[0], q.p[1], q.p[2], q.rise ?? 0, q.v[0], q.v[1], q.v[2], q.drag ?? 1.5], i * 12);
    }
    this.A = new Float32Array(n * 4); this.B = new Float32Array(n * 4);
    this.bufA = new THREE.InstancedInterleavedBuffer(this.A, 4, 1); this.bufA.setUsage(THREE.DynamicDrawUsage);
    this.bufB = new THREE.InstancedInterleavedBuffer(this.B, 4, 1); this.bufB.setUsage(THREE.DynamicDrawUsage);
    const a = instancedDynamicBufferAttribute(this.bufA, 'vec4').setInstanced(true);
    const b = instancedDynamicBufferAttribute(this.bufB, 'vec4').setInstanced(true);
    const L = Puffs.L;
    const dust = !!o.dust;
    const m = new THREE.SpriteNodeMaterial();
    m.transparent = true; m.depthWrite = false; m.fog = true;
    if (o.grain) { m.depthWrite = true; m.alphaTest = 0.3; }   // 砂つぶ：奥行きを書く（ピントのぼけが正しい距離でかかる）
    m.positionNode = a.xyz;
    const asp = o.aspect || (dust ? [1.5, 0.62] : null);
    m.scaleNode = asp ? vec2(a.w.mul(asp[0]), a.w.mul(asp[1])) : a.w;
    const q = uv().sub(0.5).mul(2.0);
    const r2 = dot(q, q);
    const so = vec3(b.y.mul(17.3), b.y.mul(-9.1), b.y.mul(5.7));
    const lump = float(o.lump ?? 0.16).mul(2.4);
    let n1, n2, shape, crease = float(1.0);
    if (o.grain) {
      // 月の砂つぶ：これまでどおり手続きの雑音
      n1 = mx_fractal_noise_float(vec3(q.mul(1.25), b.x.mul(1.1)).add(so), 3, 2.0, 0.55);
      n2 = mx_noise_float(vec3(q.mul(2.9).add(11.0), b.x.mul(1.7)).add(so));
      shape = smoothstep(0.18, 1.0, r2.add(n1.mul(lump))).oneMinus();
    } else {
      // 共有の 3 次元の雑音テクスチャを読む（軽い）。時間とともに中身が湧き返る
      const N3 = texture3D(noiseTex3D());
      const t1 = N3.sample(vec3(q.mul(0.21), b.x.mul(0.2)).add(so)).level(0);
      const t2 = N3.sample(vec3(q.mul(0.55).add(0.31), b.x.mul(0.33).add(0.5)).add(so.yzx)).level(0);
      n1 = t1.x.sub(0.5).mul(1.7); n2 = t1.y.sub(0.5).mul(1.7);
      const n3 = t2.x.sub(0.5).mul(1.7), bil = t2.w;
      if (dust) shape = smoothstep(0.0, 1.0, r2.add(n1.mul(lump).mul(1.2)).add(n3.mul(lump).mul(0.9))).oneMinus().pow(1.6).mul(bil.mul(0.8).add(0.5));
      else { shape = smoothstep(0.18, 1.0, r2.add(n1.mul(lump)).add(n3.mul(lump).mul(0.5)).add(bil.oneMinus().sub(0.5).mul(lump).mul(0.7))).oneMinus(); crease = bil.mul(0.4).add(0.72); }
    }
    const z = max(float(0.0), float(1.0).sub(r2)).sqrt();
    const N = dust ? vec3(q.x.mul(0.45).add(n2.mul(0.25)), q.y.mul(0.45).add(n1.mul(0.25)).add(0.25), 1.0).normalize() : vec3(q.x.add(n2.mul(0.4)), q.y.add(n1.mul(0.4)), z.add(0.3)).normalize();
    const wrap = (d) => d.add(0.5).div(1.5).clamp(0, 1);
    const kC = o.contrast ?? 1;
    const sunL = wrap(dot(N, L.sunV)).pow(1.3 * kC);
    const upL = dot(N, L.upV).mul(0.5).add(0.5);
    const toF = L.flameV.sub(positionView);
    const fl = L.flameC.mul(wrap(dot(N, toF.normalize()))).div(dot(toF, toF).mul(0.03).add(1.0));
    const alb = mix(color(o.colA ?? 0xffffff), color(o.colB ?? 0xc9ced6), smoothstep(0.0, o.colAt ?? 0.6, b.x));
    const amb = L.ambC.mul(upL.mul(0.65).add(0.35)).mul(1 / Math.sqrt(kC));
    const lit = alb.mul(L.sunC.mul(dust ? sunL.mul(0.5).add(0.5) : sunL).add(amb).add(fl)).mul(shape.pow(0.5).mul(0.3).add(0.7)).mul(crease);
    const heat = b.z;
    const fireI = float(o.fire ?? 0);
    const fire = mix(vec3(1.0, 0.22, 0.03), vec3(1.0, 0.84, 0.5), heat.pow(1.6)).mul(heat.mul(heat)).mul(fireI).mul(n1.mul(0.45).add(0.85)).mul(shape.pow(0.7));
    const glow = o.glow ? color(o.glow).mul(o.glowAmt ?? 1) : vec3(0);
    m.colorNode = lit.mul(heat.mul(0.85).oneMinus()).add(fire).add(glow);
    m.opacityNode = softParticles({ opacity: shape.mul(b.w).mul(o.opacity ?? (dust ? 0.3 : 0.9)), distance: o.soft ?? (dust ? 0.5 : 1.2) });
    const mesh = (this.mesh = new THREE.Sprite(m));
    mesh.count = 0; mesh.frustumCulled = false; mesh.visible = false; mesh.layers.set(FX_LAYER);
    mesh.renderOrder = o.order ?? 40;
    this._t = 0; this._idx = new Uint32Array(n); this._d = new Float32Array(n);
  }
  /** 表示して時刻を合わせる（実際の並べ替えは、コマの最後にまとめて行う） */
  show(t) { this._t = t; this.mesh.visible = true; Puffs.active.add(this); return this; }

  /** コマの最後に：カメラから遠い順に並べ替えて GPU へ */
  static flush(camera) {
    for (const e of Puffs.active) e._update(camera);
    Puffs.active.clear();
  }
  _update(camera) {
    const { P, A, B, o, n } = this, t = this._t;
    if (!this.mesh.visible) return;
    this.mesh.updateWorldMatrix(true, false);
    _cam.copy(camera.position); this.mesh.worldToLocal(_cam);
    const dust = !!o.dust;
    const g = o.grav ?? 0, g0 = o.start ?? (dust ? 0.22 : 0.3), fadeAt = o.fadeAt ?? (dust ? 0.2 : 0.62), fireEnd = o.fireEnd ?? 0.45, floor = o.floor, hasFire = !!o.fire;
    const wind = o.wind, turb = o.turb ?? 0, sit = dust ? 0.3 : 0.45;
    let m = 0;
    const idx = this._idx, dd = this._d;
    for (let i = 0; i < n; i++) {
      const k = i * 12, age = t - P[k];
      if (age < 0 || age > P[k + 1]) continue;
      idx[m++] = i;
    }
    if (_X.length < n * 6) _X = new Float32Array(n * 6);
    const X = _X;
    for (let j = 0; j < m; j++) {
      const i = idx[j], k = i * 12, age = t - P[k], u = age / P[k + 1];
      const drag = P[k + 11], e = (1 - Math.exp(-drag * age)) / drag;
      const sz = P[k + 2] * ((1 - (1 - u) * (1 - u)) * (1 - g0) + g0);
      let y = P[k + 5] + P[k + 9] * e + P[k + 7] * age - 0.5 * g * age * age;
      let x = P[k + 4] + P[k + 8] * e, z = P[k + 6] + P[k + 10] * e;
      if (wind) { x += wind[0] * age; y += wind[1] * age; z += wind[2] * age; }
      if (turb) {
        // 乱れ：進むほど蛇行する（粒ごとに位相が違う）
        const s = P[k + 3] * 6.2832, w = turb * (1 - Math.exp(-age * 1.1));
        x += Math.sin(age * 1.7 + s * 3.1) * w; y += Math.sin(age * 1.3 + s * 5.3) * w * 0.6; z += Math.cos(age * 1.5 + s * 7.7) * w;
      }
      if (floor !== undefined) y = Math.max(y, sz * sit + floor);
      const fade = Math.min(1, u / 0.07) * (u < fadeAt ? 1 : 1 - (u - fadeAt) / (1 - fadeAt));
      X[j * 6] = x; X[j * 6 + 1] = y; X[j * 6 + 2] = z; X[j * 6 + 3] = sz; X[j * 6 + 4] = u; X[j * 6 + 5] = fade;
      dd[j] = (x - _cam.x) ** 2 + (y - _cam.y) ** 2 + (z - _cam.z) ** 2;
    }
    const order = Array.from({ length: m }, (_, j) => j).sort((p, q) => dd[q] - dd[p]);
    for (let j = 0; j < m; j++) {
      const s = order[j] * 6, i4 = j * 4;
      A[i4] = X[s]; A[i4 + 1] = X[s + 1]; A[i4 + 2] = X[s + 2]; A[i4 + 3] = X[s + 3] * 2.6;
      const u = X[s + 4];
      B[i4] = u; B[i4 + 1] = (idx[order[j]] * 0.6180339) % 1; B[i4 + 2] = hasFire ? Math.max(0, 1 - u / fireEnd) : 0; B[i4 + 3] = X[s + 5];
    }
    this.bufA.needsUpdate = true; this.bufB.needsUpdate = true;
    this.mesh.count = m;
    if (m === 0) this.mesh.visible = false;
  }
}
const _cam = new THREE.Vector3();
let _X = new Float32Array(0);

/**
 * 飛び散る破片（インスタンス・放物線・回転）。fill(i, rnd) → { t, life, size, p, v, color }
 * o（すべて省略可）：
 *   colors, grav, seed, shadow
 *   hot … 熱い破片は赤く光り、冷めていく（強さ）     white … 白く光る（氷のかけら。形は箱のまま）
 *   box: true … 箱の形のまま（既定は、ねじれて反った金属片）
 *   floor … 地面の高さ（この物体の座標で）。指定すると、落ちて 3 回はねてから寝て止まる
 *   bounce（はね返り 0.34）, friction（はねるたびの横の減速 0.55）, linger … 寿命のあと地面に残る秒
 */
export class Debris {
  constructor(n, fill, o = {}) {
    const A = new Float32Array(n * 4), P = new Float32Array(n * 4), V = new Float32Array(n * 4), C = new Float32Array(n * 4);
    const rnd = mulberry(o.seed ?? 11);
    const cols = (o.colors || [0xe8e8e8, 0x2b2b2b, 0xd97757, 0x8a8f96]).map((h) => new THREE.Color(h));
    for (let i = 0; i < n; i++) {
      const q = fill(i, rnd);
      A.set([q.t, q.life, q.size, rnd()], i * 4);
      P.set([q.p[0], q.p[1], q.p[2], rnd() * 6.28], i * 4);
      V.set([q.v[0], q.v[1], q.v[2], 3 + rnd() * 9], i * 4);
      const c = q.color !== undefined ? new THREE.Color(q.color) : cols[Math.floor(rnd() * cols.length)];
      C.set([c.r, c.g, c.b, 0.4 + rnd() * 1.4], i * 4);
    }
    const a = iattr(A), p = iattr(P), v = iattr(V), c = iattr(C);
    const uT = (this.uT = uniform(0));
    const ageRaw = uT.sub(a.x), age = ageRaw.max(0.0);
    const total = a.y.add(o.linger ?? 0);
    const alive = step(0.0, ageRaw).mul(step(ageRaw, total));
    const grav = float(o.grav ?? 9.8);
    const k = age.div(total).clamp(0, 1);
    const sz = a.z.mul(alive).mul(smoothstep(o.linger ? 0.93 : 0.85, 1.0, k).oneMinus());
    const box = !!(o.white || o.box);
    let center, spinT, rest = float(0.0);
    if (o.floor !== undefined) {
      // 地面で 3 回はねて止まる（はねるたびに低く・遅く）
      const F = float(o.floor), e = o.bounce ?? 0.34, fr = o.friction ?? 0.55;
      const vImp = sqrt(v.y.mul(v.y).add(grav.mul(2.0).mul(p.y.sub(F).max(0.0))));
      const t1 = v.y.add(vImp).div(grav);
      const tau = age.sub(t1).max(0.0);
      const u1 = vImp.mul(e), u2 = vImp.mul(e * e), u3 = vImp.mul(e * e * e);
      const T1 = u1.mul(2.0).div(grav), T2 = u2.mul(2.0).div(grav), T3 = u3.mul(2.0).div(grav);
      const s1 = tau.clamp(0.0, T1), s2 = tau.sub(T1).clamp(0.0, T2), s3 = tau.sub(T1).sub(T2).clamp(0.0, T3);
      const hop = (u, s) => u.mul(s).sub(grav.mul(s).mul(s).mul(0.5));
      const tf = age.min(t1);
      const yAir = p.y.add(v.y.mul(tf)).sub(grav.mul(tf).mul(tf).mul(0.5));
      const yGnd = F.add(hop(u1, s1)).add(hop(u2, s2)).add(hop(u3, s3)).add(a.z.mul(0.05));
      const run = tf.add(s1.mul(fr)).add(s2.mul(fr * fr)).add(s3.mul(fr * fr * fr));
      center = vec3(p.x.add(v.x.mul(run)), mix(yGnd, yAir, step(age, t1)), p.z.add(v.z.mul(run)));
      spinT = tf.add(s1.mul(0.6)).add(s2.mul(0.35)).add(s3.mul(0.15));
      rest = smoothstep(-0.14, 0.0, age.sub(t1.add(T1).add(T2).add(T3)));
    } else {
      center = vec3(p.x.add(v.x.mul(age)), p.y.add(v.y.mul(age)).sub(grav.mul(age).mul(age).mul(0.5)), p.z.add(v.z.mul(age)));
      spinT = age;
    }
    const ang = spinT.mul(v.w).add(p.w);
    const flat = (x) => mix(x, x.div(Math.PI).round().mul(Math.PI), rest);       // 止まったら寝かせる
    const eul = vec3(flat(ang), ang.mul(0.7), flat(ang.mul(1.3)));
    let shapeL;
    if (box) shapeL = positionLocal.mul(vec3(1.0, c.w, 0.6));
    else {
      // ねじれて反った金属片：板を長さ方向にねじり、反らせ、先を細くする（片ごとに違う）
      const P0 = positionLocal;
      const tw = a.w.sub(0.5).mul(2.6).mul(P0.x);
      const bend = fract(a.w.mul(7.13)).sub(0.5).mul(0.9);
      const wz = P0.z.mul(c.w.mul(0.45).add(0.35)).mul(P0.x.mul(fract(a.w.mul(3.7)).sub(0.5)).mul(1.3).add(1.0));
      const y0 = P0.y.add(P0.x.mul(P0.x).mul(bend));
      const cs = cos(tw), sn = sin(tw);
      shapeL = vec3(P0.x, y0.mul(cs).sub(wz.mul(sn)), y0.mul(sn).add(wz.mul(cs)));
    }
    const m = new THREE.MeshStandardNodeMaterial();
    m.roughness = box ? 0.6 : 0.62; m.metalness = box ? 0 : 0.35; m.flatShading = true;
    m.positionNode = rotate(shapeL, eul).mul(sz).add(center);
    m.colorNode = c.xyz;
    if (o.hot) {
      // 7 割ほどの破片が熱い：橙 → 暗い赤 → 黒へ冷める
      const heat = exp(age.mul(a.w.mul(1.2).add(0.6)).negate()).mul(step(0.3, fract(a.w.mul(5.3))));
      m.emissiveNode = mix(vec3(0.9, 0.06, 0.0), vec3(1.0, 0.5, 0.1), heat).mul(heat.mul(heat)).mul(o.hot * 2.2);
    }
    if (o.white) m.emissiveNode = color(0xdfe9ff).mul(o.white);
    const mesh = (this.mesh = new THREE.Mesh(box ? unitBox : plateGeo, m));
    mesh.count = n; mesh.frustumCulled = false; mesh.castShadow = !!o.shadow; mesh.visible = false;
  }
  show(t) { this.mesh.visible = true; this.uT.value = t; return this; }
}

/**
 * 光の粒（加算）。fill は Puffs と同じ形（size は板の大きさ）
 * o（すべて省略可）：
 *   color, rainbow, gain, seed
 *   （既定）魔法のきらめき：小さく鋭い光の芯＋細い十字の光条＋淡いにじみ。一部は大きな玉ぼけ。ゆっくり沈む
 *   round: true … 丸い光の粒      streak: 秒 … 飛ぶ向きへ線を引く火花（その秒数ぶんの長さ）
 *   grav … 重力                   fall … ゆっくり沈む速さ（既定 0.5。round・streak では 0）
 */
export class Sparkles {
  constructor(n, fill, o = {}) {
    const A = new Float32Array(n * 4), P = new Float32Array(n * 4), V = new Float32Array(n * 4);
    const rnd = mulberry(o.seed ?? 3);
    for (let i = 0; i < n; i++) {
      const q = fill(i, rnd);
      A.set([q.t, q.life, q.size, rnd()], i * 4);
      P.set([q.p[0], q.p[1], q.p[2], q.hue ?? rnd()], i * 4);
      V.set([q.v[0], q.v[1], q.v[2], q.drag ?? 1.5], i * 4);
    }
    const a = iattr(A), p = iattr(P), v = iattr(V);
    const uT = (this.uT = uniform(0));
    const ageRaw = uT.sub(a.x), age = ageRaw.max(0.0);
    const k = age.div(a.y).clamp(0, 1);
    const alive = step(0.0, ageRaw).mul(step(ageRaw, a.y));
    const magic = !o.round && !o.streak;
    // 空気の抵抗つきの動き。重力があれば、やがて一定の速さで落ちる
    const dec = exp(v.w.negate().mul(age));
    const E = dec.oneMinus().div(v.w);
    const gd = float(o.grav ?? 0).div(v.w).add(o.fall ?? (magic ? 0.5 : 0));
    const disp = vec3(v.x.mul(E), v.y.add(gd).mul(E).sub(gd.mul(age)), v.z.mul(E));
    const m = new THREE.SpriteNodeMaterial();
    m.transparent = true; m.depthWrite = false; m.blending = THREE.AdditiveBlending; m.fog = false;
    m.positionNode = p.xyz.add(disp);
    const tw = sin(k.mul(3.14159)).mul(sin(uT.mul(9.0).add(a.w.mul(40.0))).mul(0.25).add(0.75));
    const q = uv().sub(0.5).mul(2.0);
    const r2 = dot(q, q);
    let pal = o.rainbow
      ? mix(mix(color(0x4f8dff), color(0xff5b54), smoothstep(0.0, 0.33, p.w)), mix(color(0xffd23d), color(0x45d07a), smoothstep(0.66, 1.0, p.w)), smoothstep(0.33, 0.66, p.w))
      : color(o.color ?? 0xfff2c4);
    let shape;
    if (o.streak) {
      // 火花：飛ぶ向き（画面の上で）へ細長く引く。冷めるほど赤く
      const vel = vec3(v.x, v.y.add(gd), v.z).mul(dec).sub(vec3(0.0, gd, 0.0));
      const vv = cameraViewMatrix.mul(vec4(vel, 0.0)).xy;
      m.rotationNode = atan(vv.y, vv.x);
      m.scaleNode = vec2(length(vv).mul(o.streak).max(a.z), a.z).mul(alive).mul(sin(k.mul(3.14159)).pow(0.4));
      shape = pow(q.x.mul(q.x).oneMinus().max(0.0), 1.5).mul(exp(q.y.mul(q.y).mul(-7.0)));
      m.colorNode = mix(pal, vec3(1.0, 0.25, 0.04), smoothstep(0.35, 1.0, k)).mul(o.gain ?? 2.2);
    } else if (o.round) {
      m.scaleNode = a.z.mul(tw).mul(alive);
      shape = smoothstep(0.0, 1.0, r2).oneMinus().pow(2.0);
      m.colorNode = pal.mul(o.gain ?? 2.2);
    } else {
      // 魔法のきらめき：鋭い芯＋細い光条＋淡いにじみ。7 つに 1 つは、ピントの外れた大きな玉ぼけ
      const big = step(a.w, o.bokeh ?? 0.14);
      m.scaleNode = a.z.mul(tw).mul(alive).mul(mix(float(0.8), float(1.5), big));
      const core = exp(r2.mul(-110.0));
      const halo = exp(r2.mul(-10.0)).mul(0.16);
      const glint = exp(abs(q.x).mul(-9.0)).mul(exp(q.y.mul(q.y).mul(-420.0))).add(exp(abs(q.y).mul(-9.0)).mul(exp(q.x.mul(q.x).mul(-420.0)))).mul(0.5);
      const rr = r2.sqrt();
      const disc = smoothstep(0.42, 0.5, rr).oneMinus().mul(smoothstep(0.0, 0.5, rr).mul(0.5).add(0.5)).mul(0.07);
      shape = mix(core.add(halo).add(glint), disc, big);
      if (o.rainbow) pal = mix(pal, vec3(1.0), 0.22);                     // 虹色は淡く
      m.colorNode = mix(pal, vec3(1.0, 0.98, 0.94), core.mul(0.8).mul(big.oneMinus())).mul(o.gain ?? 2.2);
    }
    m.opacityNode = shape;
    const mesh = (this.mesh = new THREE.Sprite(m));
    mesh.count = n; mesh.frustumCulled = false; mesh.visible = false; mesh.layers.set(FX_LAYER);
  }
  show(t) { this.mesh.visible = true; this.uT.value = t; return this; }
}

/**
 * ロケットの炎：中身のある体積の噴射炎（plume.js）。
 *   new Flame(ノズルの半径, 長さ, { gain, colA })  … colA が青系なら水素の淡い炎、それ以外はケロシンの炎
 *   .set(T, 強さ, 長さの倍率) / .vac(外気の薄さ 0..1)
 */
export class Flame {
  constructor(r, len, o = {}) {
    // ごく小さな炎（焚火の旧実装）は、これまでの回転体の形のまま返す
    if (o.cone || (r < 0.3 && (o.bulge ?? 0) >= 0.8)) return new ConeFlame(r, len, o);
    const blue = o.colA !== undefined && (o.colA & 255) > ((o.colA >> 16) & 255);
    return new Plume(r, len, { kind: o.kind || (blue ? 'h2' : 'kero'), gain: o.gain });
  }
}

/** 回転体の炎（＋ゆらぎ・加算）。小さな火に使う */
export class ConeFlame {
  constructor(r, len, o = {}) {
    const pts = [];
    const N = 28;
    for (let i = 0; i <= N; i++) {
      const v = i / N;
      const bulge = 1 + (o.bulge ?? 0.35) * Math.sin(Math.min(1, v * 3.0) * Math.PI * 0.5);
      pts.push(new THREE.Vector2(Math.max(0.0005, r * bulge * Math.pow(1 - v, 0.8)), -v * len));
    }
    const geo = new THREE.LatheGeometry(pts, 28);
    const uT = (this.uT = uniform(0)), uP = (this.uP = uniform(1)), uL = (this.uL = uniform(1));
    const mk = (cA, cB, radial, gain) => {
      const m = new THREE.MeshBasicNodeMaterial();
      m.transparent = true; m.depthWrite = false; m.blending = THREE.AdditiveBlending; m.side = THREE.DoubleSide; m.fog = false;
      const vv = uv().y;
      const wob = mx_noise_float(vec3(positionLocal.x.mul(2.5), positionLocal.y.mul(1.6).add(uT.mul(16.0)), positionLocal.z.mul(2.5))).mul(0.3).mul(vv).add(1.0);
      const flick = sin(uT.mul(53.0)).mul(0.04).add(sin(uT.mul(31.7)).mul(0.03)).add(1.0);
      m.positionNode = vec3(positionLocal.x.mul(wob).mul(radial), positionLocal.y.mul(uL).mul(flick), positionLocal.z.mul(wob).mul(radial));
      const ndv = abs(dot(normalView, positionViewDirection)).clamp(0, 1);
      m.colorNode = mix(color(cA), color(cB), smoothstep(0.0, 0.7, vv)).mul(gain).mul(ndv.mul(0.7).add(0.3));
      m.opacityNode = smoothstep(0.15, 1.0, vv).oneMinus().mul(ndv.pow(1.2)).mul(uP).mul(0.8);
      return m;
    };
    const g = (this.root = new THREE.Group());
    const outer = new THREE.Mesh(geo, mk(o.colA ?? 0xffb347, o.colB ?? 0xff4a12, 1.0, o.gain ?? 1.7));
    const inner = new THREE.Mesh(geo, mk(o.coreA ?? 0xfff6d8, o.coreB ?? 0xffc860, 0.5, (o.gain ?? 1.7) * 1.3));
    inner.scale.set(1, 0.55, 1);
    outer.frustumCulled = false; inner.frustumCulled = false; outer.layers.set(FX_LAYER); inner.layers.set(FX_LAYER);
    g.add(outer, inner);
    g.visible = false;
  }
  /** power 0..1、len は長さの倍率 */
  set(T, power = 1, len = 1) { this.root.visible = power > 0.001; this.uT.value = T; this.uP.value = power; this.uL.value = len; return this; }
  vac() { return this; }
}

/** ぼんやり光る板（加算のスプライト） */
export function glowSprite(hex, size, o = {}) {
  const m = new THREE.SpriteNodeMaterial();
  m.transparent = true; m.depthWrite = false; m.blending = THREE.AdditiveBlending; m.fog = false;
  if (o.noDepth) m.depthTest = false;
  const u = uniform(o.gain ?? 1);
  const d = uv().sub(0.5).length().mul(2.0);
  const fall = d.oneMinus().clamp(0, 1).pow(o.pow ?? 2.2);
  m.colorNode = color(hex).mul(u);
  m.opacityNode = fall;
  const s = new THREE.Sprite(m);
  s.scale.set(size, size, 1);
  s.layers.set(FX_LAYER);
  s.userData.gain = u;
  return s;
}

/** こげ跡：地面に寝かせて置く、ふちのぼけた黒い染み（半径 r）。地面のすぐ上の高さに置いて使う */
export function scorchMark(r, o = {}) {
  const m = new THREE.MeshBasicNodeMaterial();
  m.transparent = true; m.depthWrite = false; m.fog = true; m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
  const q = uv().sub(0.5).mul(2.0);
  const n = texture3D(noiseTex3D()).sample(vec3(q.mul(0.33), o.seed ?? 0.37)).level(0);
  const d = length(q).add(n.x.sub(0.5).mul(0.6));
  m.colorNode = vec3(0.014, 0.012, 0.011);
  m.opacityNode = smoothstep(0.2, 1.0, d).oneMinus().mul(n.w.mul(0.5).add(0.6)).mul(o.opacity ?? 0.85).clamp(0, 1);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2 * r, 2 * r), m);
  mesh.rotation.x = -Math.PI / 2; mesh.layers.set(FX_LAYER); mesh.renderOrder = 5; mesh.castShadow = false; mesh.receiveShadow = false;
  return mesh;
}

/**
 * 爆発：閃光・火球（体積）・燃える塊・黒いすす煙・破片・火花。
 * o（すべて省略可）: scale, seed, colors, grav, fireN, smokeN, debrisN, sparkN,
 *   floor … 地面の高さ（この物体の座標で）。破片が落ちて、はねて、残る      linger … 破片が地面に残る秒
 *   wind: [x, y, z] … 煙が流れる速さ
 */
export class Explosion {
  constructor(o = {}) {
    const S = o.scale ?? 1, seed = o.seed ?? 21;
    const g = (this.root = new THREE.Group());
    const dir = (rnd, up = 0.2) => { const th = rnd() * 6.283, y = up + rnd() * (1 - up) * (rnd() < 0.85 ? 1 : -0.3), r = Math.sqrt(Math.max(0, 1 - y * y)); return [Math.cos(th) * r, y, Math.sin(th) * r]; };
    // 飛び散る燃える塊
    this.fire = new Puffs(o.fireN ?? 70, (i, rnd) => {
      const d = dir(rnd, -0.2), sp = (2 + rnd() * 9) * S;
      return { t: rnd() * 0.12, life: 0.7 + rnd() * 0.9, size: (0.5 + rnd() * 1.1) * S, p: [d[0] * 0.3 * S, d[1] * 0.3 * S, d[2] * 0.3 * S], v: [d[0] * sp, d[1] * sp, d[2] * sp], drag: 3.2, rise: 1.2 * S };
    }, { colA: 0xffc45a, colB: 0x2a2624, colAt: 0.55, fire: 5, fireEnd: 0.5, seed, start: 0.35 });
    // 火球の本体：中身のある炎とすす煙（体積）
    this.ball = new Fireball({ scale: S, seed, L: Puffs.L });
    // 黒いすす煙：火球が冷えたあとに残り、ゆっくり上がりながら風に流れて薄れる
    this.smoke = new Puffs(o.smokeN ?? 130, (i, rnd) => {
      const d = dir(rnd, -0.1), sp = (1.0 + rnd() * 3.5) * S, r0 = (1.2 + rnd() * 2.6) * S;
      return { t: 0.3 + rnd() * 1.3, life: 3.0 + rnd() * 2.8, size: (0.9 + rnd() * 1.5) * S, p: [d[0] * r0, d[1] * r0 * 0.8 + S * 0.8, d[2] * r0], v: [d[0] * sp, d[1] * sp * 0.6, d[2] * sp], drag: 1.8, rise: (0.5 + rnd() * 0.9) * S };
    }, { colA: 0x1d1a18, colB: 0x4b4541, colAt: 0.9, seed: seed + 1, start: 0.35, opacity: 0.8, contrast: 1.4, turb: 0.5 * S, wind: o.wind, fadeAt: 0.45 });
    // 破片：ねじれた金属片。熱いものは赤く光って冷める。地面があれば、はねて止まる
    const hasFloor = o.floor !== undefined;
    this.debris = new Debris(o.debrisN ?? 90, (i, rnd) => {
      const d = dir(rnd, 0.05), sp = (6 + rnd() * 14) * S, big = rnd() < 0.2;
      return { t: 0, life: 1.6 + rnd() * 1.6, size: (big ? 0.3 + rnd() * 0.35 : 0.08 + rnd() * 0.2) * S, p: [d[0] * 0.4 * S, d[1] * 0.4 * S, d[2] * 0.4 * S], v: [d[0] * sp, d[1] * sp + 4 * S, d[2] * sp] };
    }, { seed: seed + 2, colors: o.colors || [0x2a2a2c, 0x3a3836, 0x555250, 0x1a1a1c], hot: 2.2, grav: o.grav ?? 9.8, floor: o.floor, linger: o.linger ?? (hasFloor ? 7 : 0), shadow: hasFloor });
    // 火花：飛ぶ向きへ線を引き、弧を描いて落ちる
    this.sparks = new Sparkles(o.sparkN ?? 110, (i, rnd) => {
      const d = dir(rnd, -0.3), sp = (8 + rnd() * 24) * S;
      return { t: rnd() * 0.1, life: 0.6 + rnd() * 1.1, size: (0.035 + rnd() * 0.05) * S, p: [0, 0, 0], v: [d[0] * sp, d[1] * sp, d[2] * sp], drag: 1.3 };
    }, { seed: seed + 3, color: 0xffc070, gain: 5, streak: 0.045, grav: o.grav ?? 9.8 });
    this.flash = glowSprite(0xfff0c8, 14 * S, { gain: 0, pow: 1.6 });
    g.add(this.fire.mesh, this.smoke.mesh, this.ball.mesh, this.debris.mesh, this.sparks.mesh, this.flash);
    g.visible = false;
  }
  /** t：爆発からの秒（負なら非表示） */
  show(t) {
    if (t < 0) { this.root.visible = false; return this; }
    this.root.visible = true;
    this.fire.show(t); this.smoke.show(t); this.ball.show(t); this.debris.show(t); this.sparks.show(t);
    this.flash.userData.gain.value = t < 0.5 ? 9 * Math.exp(-t * 11) : 0;
    this.flash.visible = t < 0.5;
    return this;
  }
}
