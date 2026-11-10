// 空：物理ベースの大気散乱と雲（three.js の SkyMesh）＋ 夜空・宇宙の星と天の川（TSL・加算）
// さらに、その空を「環境光・映り込み」として場面に配るための環境マップも作る。
import * as THREE from 'three/webgpu';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { uniform, positionLocal, vec3, vec4, float, mix, smoothstep, floor, fract, sin, dot, length, pow, exp, mx_fractal_noise_float } from 'three/tsl';
import { lerp } from '../core/util.js';

const C = (hex) => new THREE.Color(hex);

/** 時間帯ごとの空と光 */
export const ENV = {
  day: {
    turb: 2.4, ray: 1.15, mie: 0.004, g: 0.82, gain: 0.13, cover: 0.42, dens: 0.55, stars: 0, milky: 0, night: 0, starFloor: 0, envI: 0.75, fog: C(0xb9d2ee), fogD: 0.0011,
    light: { sunColor: C(0xfff3e0), sunI: 4.4, sky: C(0xbcd9ff), ground: C(0x6f7f55), hemiI: 0.2, exposure: 1.0 },
  },
  sunset: {
    turb: 3.2, ray: 1.9, mie: 0.006, g: 0.86, gain: 0.2, cover: 0.46, dens: 0.55, stars: 0.05, milky: 0, night: 0.0, starFloor: 0, envI: 0.9, fog: C(0xe0a98a), fogD: 0.0013,
    light: { sunColor: C(0xffa565), sunI: 5.6, sky: C(0xa9a2e0), ground: C(0x8a5a48), hemiI: 0.25, exposure: 1.05 },
  },
  night: {
    turb: 2, ray: 1, mie: 0.004, g: 0.8, gain: 0.0, cover: 0.3, dens: 0.45, stars: 1, milky: 0.55, night: 1, starFloor: 0, envI: 1.0, fog: C(0x0c1630), fogD: 0.0010, skySun: [-0.85, 0.02, 0.3],
    light: { sunColor: C(0xa9c0ff), sunI: 1.5, sky: C(0x4a62a8), ground: C(0x18203a), hemiI: 0.6, exposure: 1.1 },
  },
  dawn: {
    turb: 2.6, ray: 1.6, mie: 0.003, g: 0.9, gain: 0.16, cover: 0.22, dens: 0.4, stars: 0.03, milky: 0, night: 0, starFloor: 0, envI: 1.0, fog: C(0xdcb9a0), fogD: 0.0012,
    light: { sunColor: C(0xffc995), sunI: 5.0, sky: C(0xa9bff0), ground: C(0x6c6558), hemiI: 0.25, exposure: 1.05 },
  },
  space: {
    turb: 2, ray: 1, mie: 0.004, g: 0.8, gain: 0, cover: 0, dens: 0, stars: 1.25, milky: 1, night: 0, starFloor: 1, envI: 1.0, fog: C(0x000000), fogD: 0,
    light: { sunColor: C(0xffffff), sunI: 3.4, sky: C(0x20304f), ground: C(0x101018), hemiI: 0.22, exposure: 1.0 },
  },
};
const NUM = ['turb', 'ray', 'mie', 'g', 'gain', 'cover', 'dens', 'stars', 'milky', 'night', 'starFloor', 'envI', 'fogD'];
function mixEnv(a, b, k) {
  if (k <= 0 || a === b) return a;
  if (k >= 1) return b;
  const col = (x, y) => new THREE.Color().copy(x).lerp(y, k);
  const out = { light: {}, fog: col(a.fog, b.fog) };
  for (const key of NUM) out[key] = lerp(a[key], b[key], k);
  for (const key of ['sunColor', 'sky', 'ground']) out.light[key] = col(a.light[key], b.light[key]);
  for (const key of ['sunI', 'hemiI', 'exposure']) out.light[key] = lerp(a.light[key], b.light[key], k);
  if (a.skySun || b.skySun) out.skySunMix = [a.skySun || null, b.skySun || null, k];
  return out;
}

export class Sky {
  constructor() {
    // ---- 昼・朝夕の空（大気散乱と雲）
    const phys = (this.phys = new SkyMesh());
    phys.scale.setScalar(6000);
    phys.frustumCulled = false; phys.renderOrder = -1001;
    this.gain = uniform(1);
    phys.material.colorNode = phys.material.colorNode.mul(vec4(this.gain, this.gain, this.gain, 1.0));
    phys.cloudScale.value = 0.00022; phys.cloudSpeed.value = 0.000035; phys.cloudElevation.value = 0.5; phys.showSunDisc.value = 0.35;

    // ---- 星・天の川・夜のグラデーション（加算で重ねる）
    const U = (this.U = {
      sunDir: uniform(new THREE.Vector3(0, 1, 0)), stars: uniform(0), milky: uniform(0), night: uniform(0), T: uniform(0),
      twinkle: uniform(1), spin: uniform(0), starFloor: uniform(0),
    });
    const m = new THREE.MeshBasicNodeMaterial();
    m.side = THREE.BackSide; m.depthWrite = false; m.depthTest = true; m.fog = false;   // 奥行きで隠す（大きさはカメラの遠方面に合わせる：world.end）
    m.transparent = true; m.blending = THREE.AdditiveBlending;
    const dir = positionLocal.normalize();
    const h = dir.y;
    const up = smoothstep(0.0, 1.0, h.clamp(0, 1).pow(0.42));
    let col = mix(vec3(0.02, 0.036, 0.09), vec3(0.004, 0.007, 0.024), up).mul(U.night);
    col = mix(col, vec3(0.004, 0.007, 0.016).mul(U.night), smoothstep(0.0, 0.25, h.negate()));
    const cs = U.spin.cos(), sn = U.spin.sin();
    const sdir = vec3(dir.x.mul(cs).sub(dir.z.mul(sn)), dir.y, dir.x.mul(sn).add(dir.z.mul(cs)));
    const hash3 = (p) => fract(sin(dot(p, vec3(127.1, 311.7, 74.7))).mul(43758.5453));
    const layer = (scale, thresh, rad, gain) => {
      const p = sdir.mul(scale);
      const cell = floor(p);
      const f = fract(p).sub(0.5);
      const hh = hash3(cell);
      const h2 = hash3(cell.add(19.19));
      const off = vec3(h2, fract(h2.mul(7.13)), fract(h2.mul(13.71))).sub(0.5).mul(0.6);
      const d = length(f.sub(off));
      const b = smoothstep(thresh, 1.0, hh).pow(2.2);
      const tw = sin(U.T.mul(2.2).add(hh.mul(90.0))).mul(0.35).mul(U.twinkle).add(1.0);
      const temp = fract(h2.mul(3.7));
      const tint = mix(mix(vec3(0.62, 0.74, 1.0), vec3(1.0, 0.97, 0.92), smoothstep(0.0, 0.55, temp)), vec3(1.0, 0.72, 0.5), smoothstep(0.75, 1.0, temp));
      return tint.mul(d.div(rad).clamp(0, 1).oneMinus().pow(3.0).mul(b).mul(tw).mul(gain));
    };
    const axis = vec3(0.42, 0.55, -0.72);
    const band = exp(pow(dot(sdir, axis).mul(3.4), 2.0).negate());
    const neb = mx_fractal_noise_float(sdir.mul(3.2), 5, 2.0, 0.55).mul(0.5).add(0.5);
    const dust = smoothstep(0.35, 0.75, mx_fractal_noise_float(sdir.mul(7.0).add(4.0), 4, 2.1, 0.55).mul(0.5).add(0.5)).mul(band);
    const dense = band.mul(2.4).add(0.5).mul(dust.mul(0.75).oneMinus());
    const st = layer(210.0, 0.9, 0.17, 3.2).add(layer(120.0, 0.955, 0.2, 9.0)).add(layer(64.0, 0.985, 0.22, 26.0)).add(layer(420.0, 0.86, 0.22, 0.9).mul(dense));
    const mw = mix(vec3(0.3, 0.36, 0.6), vec3(0.75, 0.6, 0.45), neb.pow(2.0)).mul(band).mul(neb.pow(2.0).mul(0.22).add(0.02)).mul(dust.mul(0.85).oneMinus()).mul(U.milky);
    const fadeH = mix(smoothstep(-0.02, 0.3, h), float(1.0), U.starFloor);
    col = col.add(st.mul(U.stars).add(mw).mul(fadeH));
    m.colorNode = col;
    const mesh = (this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 40), m));
    mesh.scale.setScalar(3500); mesh.frustumCulled = false; mesh.renderOrder = -1000;
    mesh.castShadow = false; mesh.receiveShadow = false;
    for (const o of [phys, mesh]) o.layers.set(1);
    this.cur = ENV.day;

    // ---- 環境マップ用の小さな世界（空＋地面の照り返し＋宇宙では太陽と地球）
    this.envScene = new THREE.Scene();
    this.groundMat = new THREE.MeshBasicNodeMaterial(); this.groundCol = uniform(new THREE.Color(0.1, 0.1, 0.1)); this.groundMat.colorNode = this.groundCol;
    this.envGround = new THREE.Mesh(new THREE.CircleGeometry(4000, 32), this.groundMat); this.envGround.rotation.x = -Math.PI / 2; this.envGround.position.y = -30;
    const sm = new THREE.MeshBasicNodeMaterial(); this.sunCol = uniform(new THREE.Color(0, 0, 0)); sm.colorNode = this.sunCol;
    this.envSun = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), sm);
    const em = new THREE.MeshBasicNodeMaterial(); this.earthCol = uniform(new THREE.Color(0, 0, 0)); em.colorNode = this.earthCol;
    this.envEarth = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), em);
    this.envScene.add(this.envGround, this.envSun, this.envEarth);
    for (const o of [this.envGround, this.envSun, this.envEarth]) o.layers.enableAll();
    this._envSig = ''; this._envRT = null;
  }

  /** 時間帯を設定（a と b を k で混ぜる）。sunDir は光源の向き。返り値は混ぜた結果。 */
  set(a, b = a, k = 0, sunDir = [0.4, 0.8, 0.4]) {
    const e = mixEnv(typeof a === 'string' ? ENV[a] : a, typeof b === 'string' ? ENV[b] : b, k);
    const p = this.phys, U = this.U;
    p.turbidity.value = e.turb; p.rayleigh.value = e.ray; p.mieCoefficient.value = e.mie; p.mieDirectionalG.value = e.g;
    p.cloudCoverage.value = e.cover; p.cloudDensity.value = e.dens;
    this.gain.value = e.gain;
    p.visible = e.gain > 0.001;
    // 夜は「空の太陽」を地平線の下に置く（光源は月なので）
    let sd = sunDir;
    if (e.skySun) sd = e.skySun;
    else if (e.skySunMix) { const [x, y, kk] = e.skySunMix; const A = x || sunDir, B = y || sunDir; sd = [lerp(A[0], B[0], kk), lerp(A[1], B[1], kk), lerp(A[2], B[2], kk)]; }
    const n = Math.hypot(sd[0], sd[1], sd[2]) || 1;
    p.sunPosition.value.set(sd[0] / n, Math.max(0.012, sd[1] / n), sd[2] / n);
    U.stars.value = e.stars; U.milky.value = e.milky; U.night.value = e.night; U.starFloor.value = e.starFloor;
    this.cur = e; this.skySun = [sd[0] / n, sd[1] / n, sd[2] / n];
    return e;
  }

  /** 空を環境マップにする（同じ状態なら作り直さない）。o: { ground, sun:[dir,color,size], earth:[dir,color,size] } */
  capture(renderer, sig, o = {}) {
    if (sig === this._envSig && this._envRT) return this._envRT.texture;
    this._envSig = sig;
    if (!this._pmrem) this._pmrem = new THREE.PMREMGenerator(renderer);
    const es = this.envScene;
    const keep = [this.phys.parent, this.mesh.parent, this.phys.position.clone(), this.mesh.position.clone()];
    es.add(this.phys, this.mesh);
    this.phys.layers.enableAll(); this.mesh.layers.enableAll();
    this.phys.position.set(0, 0, 0); this.mesh.position.set(0, 0, 0);
    this.groundCol.value.copy(o.ground || new THREE.Color(0.1, 0.1, 0.1));
    this.envGround.visible = !o.noGround;
    if (o.sun) { this.envSun.visible = true; this.envSun.position.set(o.sun[0][0] * 900, o.sun[0][1] * 900, o.sun[0][2] * 900); this.envSun.scale.setScalar(o.sun[2] ?? 60); this.sunCol.value.copy(o.sun[1]); } else this.envSun.visible = false;
    if (o.earth) { this.envEarth.visible = true; this.envEarth.position.set(o.earth[0][0] * 900, o.earth[0][1] * 900, o.earth[0][2] * 900); this.envEarth.scale.setScalar(o.earth[2] ?? 120); this.earthCol.value.copy(o.earth[1]); } else this.envEarth.visible = false;
    this._envRT = this._pmrem.fromScene(es, 0, 1, 20000, { size: 256, renderTarget: this._envRT });
    keep[0].add(this.phys); keep[1].add(this.mesh);
    this.phys.layers.set(1); this.mesh.layers.set(1);
    this.phys.position.copy(keep[2]); this.mesh.position.copy(keep[3]);
    return this._envRT.texture;
  }
}

/** 旧来の雲（球の寄せ集め）は使わない。場面のコードが触る口だけ残す。 */
export class Clouds {
  constructor() { this.root = new THREE.Group(); this.tint = uniform(new THREE.Color(1, 1, 1)); this.glow = uniform(0.2); }
}
