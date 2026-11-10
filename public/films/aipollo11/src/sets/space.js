// 宇宙の天体：月の球・太陽の光（地球は earth.js）
import * as THREE from 'three/webgpu';
import {
  uniform, texture, uv, positionLocal, normalWorld, positionWorld, cameraPosition, vec2, vec3, float, mix, smoothstep, color, dot, pow, max, abs,
  normalize, reflect, sin, fract, floor, exp, length, mx_fractal_noise_float, mx_noise_float, mx_worley_noise_float, normalLocal, modelWorldMatrix,
} from 'three/tsl';

/** 月の球（遠くから見る用）。半径 1 */
export function makeMoonGlobe(uSun, o = {}) {
  const m = new THREE.MeshBasicNodeMaterial();
  const p = positionLocal.normalize();
  const height = (q) => {
    const base = mx_fractal_noise_float(q.mul(3.0), 4, 2.0, 0.5).mul(0.35);
    const cr = (s, amp) => { const d = mx_worley_noise_float(q.mul(s)); return smoothstep(0.0, 0.3, d).oneMinus().mul(-1.0).add(exp(pow(d.sub(0.33).div(0.06), 2.0).negate()).mul(0.5)).mul(amp); };
    const coarse = base.add(cr(5.0, 0.45)).add(cr(11.0, 0.22)).add(cr(25.0, 0.1));
    return o.fine === false ? coarse : coarse.add(cr(70.0, 0.045)).add(cr(190.0, 0.02));
  };
  const maria = smoothstep(-0.05, 0.3, mx_fractal_noise_float(p.mul(1.55).add(vec3(3.1, 0.4, 1.7)), 3, 2.0, 0.5));
  const alb = mix(float(0.2), float(0.5), maria).add(mx_noise_float(p.mul(40.0)).mul(o.fine === false ? 0.015 : 0.035)).add(mx_noise_float(p.mul(300.0)).mul(o.fine === false ? 0.0 : 0.02));
  const rays = smoothstep(0.0, 0.12, mx_worley_noise_float(p.mul(5.0))).oneMinus().mul(0.25);
  const N = normalWorld;
  const ndl = dot(N, uSun);
  const tanL = normalize(uSun.sub(N.mul(ndl)));
  const eps = 0.0025;
  const localL = normalize(tanL);  // 月は回さないので、ワールドの向きをそのまま使う
  const relief = height(p.add(localL.mul(eps))).sub(height(p)).div(eps);
  const shade = ndl.sub(relief.mul(0.035)).clamp(0, 1).mul(smoothstep(-0.02, 0.08, ndl));
  const tint = o.tint ? color(o.tint) : vec3(1.0, 0.98, 0.94);
  m.colorNode = tint.mul(alb.add(rays)).mul(shade.mul(o.gain ?? 1.6).add(o.earthshine ?? 0.004));
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), m);
  mesh.castShadow = false; mesh.receiveShadow = false;
  return mesh;
}

/** 太陽（にじむ光と十字の光条） */
export function makeSunFlare() {
  const m = new THREE.SpriteNodeMaterial();
  m.transparent = true; m.depthWrite = false; m.blending = THREE.AdditiveBlending;
  const q = uv().sub(0.5).mul(2.0);
  const d = length(q);
  const core = exp(d.mul(-26.0)).mul(5.0);
  const halo = d.oneMinus().clamp(0, 1).pow(3.0).mul(0.55);
  const streak = exp(abs(q.y).mul(-70.0)).mul(exp(abs(q.x).mul(-2.6))).add(exp(abs(q.x).mul(-70.0)).mul(exp(abs(q.y).mul(-3.4)))).mul(0.9);
  const u = uniform(1);
  m.colorNode = vec3(1.0, 0.96, 0.88).mul(u);
  m.opacityNode = core.add(halo).add(streak).clamp(0, 1);
  const s = new THREE.Sprite(m);
  s.userData.gain = u;
  s.renderOrder = 3; s.layers.set(1); m.fog = false;
  return s;
}
