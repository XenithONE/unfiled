// 月面：クレーターのある地形（高さは関数で決まる）・岩・足あと・旗
import * as THREE from 'three/webgpu';
import { positionWorld, positionLocal, mx_noise_float, mx_fractal_noise_float, mx_worley_noise_float, mix, color, float, vec3, uniform, texture, uv, sin, smoothstep, exp, pow } from 'three/tsl';
import { bumpNormal } from './terrain.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { box, cyl, mat, grp, canvasTex } from '../core/kit.js';
import { hash1, lerp, clamp, smooth, mulberry } from '../core/util.js';
import { pixText } from '../core/pixfont.js';
import { drawIcon } from '../fx/bubble.js';

function vn(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const h = (a, b) => hash1(a * 1.31 + b * 57.7 + 0.5);
  return lerp(lerp(h(xi, zi), h(xi + 1, zi), u), lerp(h(xi, zi + 1), h(xi + 1, zi + 1), u), v);
}
function fbm2(x, z, oct = 4) { let a = 0.5, s = 0, n = 0; for (let i = 0; i < oct; i++) { s += vn(x, z) * a; n += a; x = x * 2.03 + 11.7; z = z * 2.03 + 5.3; a *= 0.5; } return s / n; }

/** みんなで地球を見上げる丘 */
export const MOUND = { x: -34, z: -30, D: 22, H: 5.5 };
const CR = (() => {
  const rnd = mulberry(1107);
  const L = [{ x: 8.6, z: 9.5, r: 2.3 }, { x: -11.5, z: 3.5, r: 3.1 }, { x: 15, z: -12, r: 4.4 }, { x: 44, z: -62, r: 21 }, { x: -78, z: 34, r: 17 }, { x: 30, z: 36, r: 7 }, { x: -20, z: 26, r: 5 }, { x: 62, z: 10, r: 11 }];
  for (let i = 0; i < 90; i++) {
    const c = { x: (rnd() - 0.5) * 380, z: (rnd() - 0.5) * 380, r: 1.2 + Math.pow(rnd(), 2.2) * 13 };
    if (Math.hypot(c.x, c.z) < 11 + c.r) continue;
    if (Math.hypot(c.x - MOUND.x, c.z - MOUND.z) < MOUND.D * 0.9 + c.r) continue;
    L.push(c);
  }
  return L;
})();

/** 月面の高さ（どの場所も同じ式） */
export function moonH(x, z) {
  const dl = Math.hypot(x, z);
  const flat = smooth(clamp((dl - 6) / 13));
  let h = (fbm2(x * 0.017 + 3.1, z * 0.017 + 7.7) - 0.5) * 7.5 * flat;
  h += (fbm2(x * 0.085 + 1.3, z * 0.085 + 9.1) - 0.5) * 1.0 * lerp(0.12, 1, flat);
  h += (fbm2(x * 0.5, z * 0.5, 3) - 0.5) * 0.1;
  for (const c of CR) {
    const d = Math.hypot(x - c.x, z - c.z) / c.r;
    if (d > 1.9) continue;
    if (d < 1) h -= 0.2 * c.r * (1 - d * d) * (1 - d * d * 0.35);
    h += 0.075 * c.r * Math.exp(-Math.pow((d - 1.0) / 0.24, 2));
  }
  const dm = Math.hypot(x - MOUND.x, z - MOUND.z);
  if (dm < MOUND.D) { const k = 1 - (dm / MOUND.D) ** 2; h = lerp(h, h * 0.25, k) + MOUND.H * k * k; }
  const far = smooth(clamp((dl - 125) / 60));
  h += far * (4 + 9 * fbm2(x * 0.012 + 20, z * 0.012 + 4, 3));
  h -= (dl * dl) / 5200;
  return h;
}

function gridGeo(x0, x1, z0, z1, nx, nz, skirt = 0, holes = []) {
  const pos = [], nor = [], idx = [];
  const W = nx + 1, e = 0.18;
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      let x = lerp(x0, x1, i / nx), z = lerp(z0, z1, j / nz);
      let y = moonH(x, z);
      // 法線は高さの式から直接求める（つなぎ目で陰影が変わらない）
      const dx = (moonH(x + e, z) - moonH(x - e, z)) / (2 * e), dz = (moonH(x, z + e) - moonH(x, z - e)) / (2 * e);
      const il = 1 / Math.hypot(dx, 1, dz);
      nor.push(-dx * il, il, -dz * il);
      if (skirt && (i === 0 || j === 0 || i === nx || j === nz)) { y -= skirt; x += (i === 0 ? -skirt : i === nx ? skirt : 0); z += (j === 0 ? -skirt : j === nz ? skirt : 0); }
      pos.push(x, y, z);
    }
  }
  const inHole = (x, z) => holes.some((h) => x > h[0] - 1e-3 && x < h[1] + 1e-3 && z > h[2] - 1e-3 && z < h[3] + 1e-3);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const xa = lerp(x0, x1, i / nx), xb = lerp(x0, x1, (i + 1) / nx), za = lerp(z0, z1, j / nz), zb = lerp(z0, z1, (j + 1) / nz);
      if (inHole(xa, za) && inHole(xb, zb)) continue;
      const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

export class MoonSet {
  constructor() {
    const root = (this.root = grp());
    // ---- 地面の素材：灰色の砂（場所ごとのむらと細かい粒）
    const gm = new THREE.MeshStandardNodeMaterial(); gm.roughness = 1.0; gm.metalness = 0;
    const p = positionWorld;
    const blotch = mx_fractal_noise_float(p.xz.mul(0.045), 3, 2.0, 0.5).mul(0.5).add(0.5);
    const mid = mx_noise_float(p.xz.mul(0.9)).mul(0.5).add(0.5);
    const fine = mx_noise_float(p.xz.mul(9.0)).mul(0.5).add(0.5);
    const grain = mx_noise_float(p.xz.mul(58.0)).mul(0.5).add(0.5);
    // 小さなクレーター（椀と縁）を 2 段
    const pit = (sc, amp) => { const w = mx_worley_noise_float(p.xz.mul(sc)); return smoothstep(0.0, 0.26, w).oneMinus().mul(-1.0).add(exp(pow(w.sub(0.3).div(0.05), 2.0).negate()).mul(0.45)).mul(amp); };
    const pits = pit(0.33, 0.07).add(pit(1.3, 0.022));
    gm.colorNode = mix(color(0x8a8782), color(0xc4c0b8), blotch).mul(mid.mul(0.16).add(0.92)).mul(fine.mul(0.2).add(0.9)).mul(grain.mul(0.18).add(0.91)).mul(pits.mul(1.6).add(1.0).clamp(0.75, 1.15));
    gm.normalNode = bumpNormal(pits.add(mid.mul(0.03)).add(fine.mul(0.012)).add(grain.mul(0.004)), 1.0);
    this.groundMat = gm;

    const S = 210, N = 300, cell = (S * 2) / N;
    const A = [-21, 21, -21, 21];
    const B = [-210 + cell * 112, -210 + cell * 140, -210 + cell * 114, -210 + cell * 143];
    const main = new THREE.Mesh(gridGeo(-S, S, -S, S, N, N, 0, [A, B]), gm);
    main.receiveShadow = true; main.castShadow = true;
    root.add(main);
    for (const h of [A, B]) {
      const nx = Math.round((h[1] - h[0]) / cell) * 7, nz = Math.round((h[3] - h[2]) / cell) * 7;
      const m = new THREE.Mesh(gridGeo(h[0], h[1], h[2], h[3], nx, nz, 0.35), gm);
      m.receiveShadow = true; m.castShadow = false;
      root.add(m);
    }

    // ---- 岩
    const rnd = mulberry(77);
    const n = 620;
    // 岩：割れた面のある塊（球をいくつかの平面で削り、凹凸を足す）。表面のざらつきは素材で
    const rockGeo = (() => {
      const g = mergeVertices(new THREE.IcosahedronGeometry(1, 4).deleteAttribute('uv').deleteAttribute('normal'), 1e-4);
      const rr = mulberry(4242), cuts = [];
      for (let i = 0; i < 9; i++) { const v = new THREE.Vector3(rr() - 0.5, rr() - 0.5, rr() - 0.5).normalize(); cuts.push([v, 0.62 + rr() * 0.3]); }
      const P = g.attributes.position, v = new THREE.Vector3();
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).normalize();
        let r = 1 + (fbm2(v.x * 2.1 + v.z * 1.3 + 9, v.y * 2.1 - v.z * 0.7 + 4, 3) - 0.5) * 0.5;
        for (const [nrm, d] of cuts) { const c = v.dot(nrm); if (c > 0.05) r = Math.min(r, d / c); }
        r *= 1 + (fbm2(v.x * 9 + 3, v.y * 9 + v.z * 7, 2) - 0.5) * 0.08;
        P.setXYZ(i, v.x * r, v.y * r, v.z * r);
      }
      g.computeVertexNormals();
      return g;
    })();
    const rockM = new THREE.MeshStandardNodeMaterial(); rockM.roughness = 0.97; rockM.metalness = 0;
    {
      const rn = mx_fractal_noise_float(positionLocal.mul(3.3), 4, 2.1, 0.55);
      const rpit = smoothstep(0.0, 0.32, mx_worley_noise_float(positionLocal.mul(6.5))).oneMinus();
      rockM.colorNode = mix(color(0x64615d), color(0x9c988f), rn.mul(0.5).add(0.5)).mul(rpit.mul(-0.22).add(1.0));
      rockM.normalNode = bumpNormal(rn.mul(0.045).sub(rpit.mul(0.035)), 1.0);
    }
    const rocks = new THREE.InstancedMesh(rockGeo, rockM, n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      let x, z, sc;
      for (let t = 0; t < 20; t++) {
        const nearPatch = i < 300;
        const a = rnd() * 6.283, r = nearPatch ? 3.6 + rnd() * 30 : 20 + rnd() * 150;
        x = Math.cos(a) * r; z = Math.sin(a) * r;
        if (i >= 520) { const a2 = rnd() * 6.283, r2 = 2 + rnd() * 20; x = MOUND.x + Math.cos(a2) * r2; z = MOUND.z + Math.sin(a2) * r2; }
        sc = (i < 300 || i >= 520 ? 0.04 + Math.pow(rnd(), 3) * 0.3 : 0.15 + Math.pow(rnd(), 3) * 1.6);
        const inWalk = Math.abs(x) < 2.2 && z > 2.6 && z < 9;
        const onTop = Math.hypot(x - MOUND.x, z - MOUND.z) < 11;
        if (!inWalk && !onTop) break;
      }
      e.set(rnd() * 6, rnd() * 6, rnd() * 6); q.setFromEuler(e);
      m4.compose(v.set(x, moonH(x, z) + sc * 0.25, z), q, s.set(sc * (0.7 + rnd() * 0.7), sc * (0.5 + rnd() * 0.5), sc * (0.7 + rnd() * 0.7)));
      rocks.setMatrixAt(i, m4);
    }
    rocks.castShadow = true; rocks.receiveShadow = true; rocks.frustumCulled = false;
    root.add(rocks);

    // ---- 足あと（四角い小さなへこみ）
    this.prints = [];
    const printTex = canvasTex(64, 96, (ctx) => {
      ctx.clearRect(0, 0, 64, 96);
      ctx.fillStyle = 'rgba(52,50,47,0.78)'; ctx.fillRect(10, 10, 44, 76);
      // 太陽の側の壁は影、反対の壁は日なた
      let g = ctx.createLinearGradient(54, 0, 30, 0); g.addColorStop(0, 'rgba(8,8,8,0.85)'); g.addColorStop(1, 'rgba(8,8,8,0)'); ctx.fillStyle = g; ctx.fillRect(30, 10, 24, 76);
      g = ctx.createLinearGradient(0, 86, 0, 60); g.addColorStop(0, 'rgba(8,8,8,0.8)'); g.addColorStop(1, 'rgba(8,8,8,0)'); ctx.fillStyle = g; ctx.fillRect(10, 60, 44, 26);
      ctx.fillStyle = 'rgba(236,232,224,0.75)'; ctx.fillRect(5, 6, 6, 82); ctx.fillRect(5, 4, 50, 6);
      ctx.fillStyle = 'rgba(120,116,110,0.5)'; for (let i = 0; i < 5; i++) ctx.fillRect(14, 20 + i * 13, 36, 3);
    });
    const pm = new THREE.MeshBasicNodeMaterial({ map: printTex, transparent: true }); pm.depthWrite = false; pm.fog = false;
    const pg = new THREE.PlaneGeometry(1, 1); pg.rotateX(-Math.PI / 2);
    for (let i = 0; i < 96; i++) { const m = new THREE.Mesh(pg, pm); m.visible = false; m.renderOrder = 1; root.add(m); this.prints.push(m); }
    this.usedPrints = 0;

    // ---- 旗
    const flag = (this.flag = grp());
    const steel = mat(0xd9dde3, { rough: 0.3, metal: 0.85 });
    flag.add(cyl(0.022, 0.022, 2.3, steel, 0, 1.15, 0, 8), cyl(0.014, 0.014, 1.36, steel, 0.68, 2.26, 0, 8).rotateZ(Math.PI / 2));
    const ft = canvasTex(512, 320, (ctx) => {
      ctx.fillStyle = '#fbfbf7'; ctx.fillRect(0, 0, 512, 320);
      ctx.fillStyle = '#d97757'; ctx.fillRect(0, 0, 128, 44); ctx.fillStyle = '#4467f0'; ctx.fillRect(128, 0, 128, 44);
      const g = ctx.createLinearGradient(256, 0, 384, 0); g.addColorStop(0, '#f0463f'); g.addColorStop(0.35, '#fcc419'); g.addColorStop(0.68, '#2fbb5c'); g.addColorStop(1, '#2f7df6');
      ctx.fillStyle = g; ctx.fillRect(256, 0, 128, 44); ctx.fillStyle = '#111214'; ctx.fillRect(384, 0, 128, 44);
      pixText(ctx, 'HELLO,', 256, 88, 11, '#1b1c20', { align: 'center' });
      pixText(ctx, 'WORLD!', 256, 196, 11, '#1b1c20', { align: 'center' });
    });
    this.flagWave = uniform(0); this.flagT = uniform(0);
    const fm = new THREE.MeshStandardNodeMaterial({ map: ft, roughness: 0.85, side: THREE.DoubleSide });
    const fx = uv().x;
    const wav = sin(fx.mul(9.0).add(this.flagT.mul(7.0))).mul(0.05).mul(this.flagWave).add(sin(fx.mul(5.0).add(1.0)).mul(0.035)).add(sin(uv().y.mul(7.0).add(fx.mul(3.0))).mul(0.018));
    fm.positionNode = vec3(positionLocal.x, positionLocal.y.add(wav.mul(fx).mul(0.5)), positionLocal.z.add(wav.mul(fx)));
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.34, 0.84, 24, 12), fm); cloth.position.set(0.69, 1.83, 0); cloth.castShadow = true;
    flag.add(cloth);
    flag.visible = false;
    root.add(flag);
    this.reset();
  }
  reset() {
    this.root.visible = false; this.usedPrints = 0;
    for (const m of this.prints) m.visible = false;
    this.flag.visible = false; this.flagWave.value = 0;
  }
  h(x, z) { return moonH(x, z); }
  /** 足あとを 1 つ置く（w,d は大きさ） */
  print(x, z, yaw = 0, w = 0.13, d = 0.34) {
    if (this.usedPrints >= this.prints.length) return;
    const m = this.prints[this.usedPrints++];
    m.visible = true; m.position.set(x, moonH(x, z) + 0.012, z); m.rotation.y = yaw; m.scale.set(w * 1.35, 1, d * 1.25);
  }
  /** クロードの 1 歩ぶん（4 本足の足あと）。(x,z) は体の中心、yaw は向き */
  step4(x, z, yaw = 0, u = 0.12) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (const lx of [-4.5, -2.5, 2.5, 4.5]) this.print(x + lx * u * c, z - lx * u * s, yaw, 0.13, 0.36);
  }
}
