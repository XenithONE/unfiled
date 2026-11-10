// 地表：ゆるやかな地形・物理ベースの地面・風に揺れる芝・枝を生やした木・水面
import * as THREE from 'three/webgpu';
import {
  positionWorld, positionLocal, positionView, normalView, mx_noise_float, mx_fractal_noise_float, mix, color, vec2, vec3, float, length, abs, max, min, fract, smoothstep, step,
  uniform, uv, time, sin, cos, texture, dFdx, dFdy, cross, dot, normalize, sign, transformNormalToView, instanceIndex, hash,
} from 'three/tsl';
import { mat, canvasTex, mergeGeometries, iattr } from '../core/kit.js';
import { hash1, lerp, clamp, smooth, mulberry } from '../core/util.js';

export const TESTPAD = [0, 0, -15];
export const PAD = [0, 0, -150];

function vn(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const h = (a, b) => hash1(a * 1.31 + b * 57.7 + 0.5);
  return lerp(lerp(h(xi, zi), h(xi + 1, zi), u), lerp(h(xi, zi + 1), h(xi + 1, zi + 1), u), v);
}
function fbm2(x, z, oct = 4) { let a = 0.5, s = 0, n = 0; for (let i = 0; i < oct; i++) { s += vn(x, z) * a; n += a; x = x * 2.03 + 11.7; z = z * 2.03 + 5.3; a *= 0.5; } return s / n; }
const box2 = (x, z, x0, x1, z0, z1, w) => smooth(clamp(Math.min(Math.min(x - x0, x1 - x), Math.min(z - z0, z1 - z)) / w + 1));

/** 平らにしておく場所（作業場・道・発射台）：1 に近いほど平ら */
export function flatMask(x, z) {
  const work = box2(x, z, -78, 48, -62, 28, 22);
  const road = box2(x, z, -16, 16, -160, -40, 14);
  const pad = smooth(clamp(1 - (Math.hypot(x - PAD[0], z - PAD[2]) - 48) / 26));
  const crawl = box2(x, z, PAD[0] + 40, PAD[0] + 122, PAD[2] - 12, PAD[2] + 12, 9);      // クローラーウェイの切り通し（発射台の +X 側）
  return Math.max(work, road, pad, crawl);
}
/** 地面の高さ */
export function yardH(x, z) {
  const f = flatMask(x, z);
  const d = Math.hypot(x, z + 60);
  let h = (fbm2(x * 0.012 + 3.3, z * 0.012 + 1.7) - 0.36) * 9 + (fbm2(x * 0.05, z * 0.05) - 0.4) * 1.6;
  h += smooth(clamp((d - 330) / 380)) * (10 + 34 * fbm2(x * 0.004 + 9, z * 0.004 + 2, 3));
  // 東側の入り江（水面）
  const lag = smooth(clamp((x - 95) / 70)) * smooth(clamp(1 - Math.abs(z + 70) / 190));
  h = lerp(h, -2.6, lag * 0.9);
  return h * (1 - f);
}
export const WATER_Y = -0.9;

/** 手続きの高さから法線を作る（view 空間） */
export function bumpNormal(h, scale = 1) {
  const dpdx = dFdx(positionView), dpdy = dFdy(positionView);
  const dhdx = dFdx(h), dhdy = dFdy(h);
  const r1 = cross(dpdy, normalView), r2 = cross(normalView, dpdx);
  const det = dot(dpdx, r1);
  const grad = sign(det).mul(dhdx.mul(r1).add(dhdy.mul(r2)));
  return normalize(abs(det).mul(normalView).sub(grad.mul(scale)));
}

/** 地面（地形のメッシュ＋位置から塗り分ける物理ベースの素材） */
export function makeGround() {
  const S = 900, N = 300;
  const g = new THREE.PlaneGeometry(S * 2, S * 2, N, N);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    // 中心ほど細かい格子に（端は粗くてよい）
    let x = p.getX(i), z = p.getZ(i);
    const warp = (v) => Math.sign(v) * Math.pow(Math.abs(v) / S, 1.9) * S;
    x = warp(x); z = warp(z) - 60;
    p.setXYZ(i, x, yardH(x, z), z);
  }
  g.computeVertexNormals();
  const m = new THREE.MeshStandardNodeMaterial();
  const q = positionWorld.xz;
  const n1 = mx_fractal_noise_float(q.mul(0.022), 4, 2.0, 0.55).mul(0.5).add(0.5);
  const n2 = mx_fractal_noise_float(q.mul(0.19).add(40.0), 3, 2.0, 0.5).mul(0.5).add(0.5);
  const n3 = mx_noise_float(q.mul(2.3)).mul(0.5).add(0.5);
  const n4 = mx_noise_float(q.mul(11.0)).mul(0.5).add(0.5);
  // 草地
  let grass = mix(color(0x4a5b26), color(0x7b8a3a), n1);
  grass = mix(grass, color(0x9b9054), smoothstep(0.55, 0.85, n2).mul(0.7));
  grass = grass.mul(n3.mul(0.35).add(0.78)).mul(n4.mul(0.2).add(0.9));
  // コンクリート（目地・しみ・ひび）
  const joint = max(fract(q.x.div(6.0)).sub(0.5).abs(), fract(q.y.div(6.0)).sub(0.5).abs()).sub(0.488).mul(90.0).clamp(0, 1);
  const stain = smoothstep(0.35, 0.8, mx_fractal_noise_float(q.mul(0.09).add(7.0), 3, 2.2, 0.55).mul(0.5).add(0.5));
  const crack = smoothstep(0.0, 0.014, abs(mx_noise_float(q.mul(0.45).add(3.0))).sub(0.002)).oneMinus();
  let conc = mix(color(0xa9a59b), color(0x8b8880), n2).mul(n4.mul(0.12).add(0.94));
  conc = conc.mul(stain.mul(-0.28).add(1.0)).mul(joint.mul(-0.45).add(1.0)).mul(crack.mul(-0.3).mul(n1).add(1.0));
  // 油じみ（作業台のそば・木箱の前・格納庫の扉の前・試験場への道）
  const blob = (x, z, r) => length(q.sub(vec2(x, z))).div(r).add(n3.sub(0.5).mul(0.9)).oneMinus().clamp(0, 1);
  const oil = max(max(blob(-3.4, 1.9, 1.3), blob(4.0, 2.6, 0.9)), max(max(blob(-30.4, -24.3, 2.3), blob(-27.6, -20.6, 1.3)), blob(1.4, -6.3, 1.0))).pow(1.5);
  conc = conc.mul(oil.mul(-0.55).add(1.0));
  // 格納庫の扉から試験場へ向かう車のあと（円弧の 2 本）
  const tv = q.sub(vec2(-12.8, -37.6)), tr = length(tv), tc = tv.x.div(tr);
  const tmask = smoothstep(-0.9, -0.8, tc).mul(smoothstep(-0.12, -0.02, tc).oneMinus()).mul(step(0.0, tv.y));
  const tire = smoothstep(0.1, 0.34, min(tr.sub(21.15).abs(), tr.sub(22.85).abs()).add(n3.mul(0.12))).oneMinus().mul(tmask);
  // 砂利の道（わだち）
  const rut = smoothstep(0.2, 0.9, abs(abs(q.x).sub(3.2)).div(1.1)).oneMinus().mul(0.22);
  const gravel = mix(color(0xb5a78c), color(0x8f8472), n3).mul(n4.mul(0.3).add(0.82)).mul(rut.oneMinus());
  // 土
  const dirt = mix(color(0x8a7556), color(0x6f5d43), n2).mul(n4.mul(0.25).add(0.86));
  // どこに何を塗るか
  const boxM = (x0, x1, z0, z1, w) => min(min(q.x.sub(x0), float(x1).sub(q.x)), min(q.y.sub(z0), float(z1).sub(q.y))).add(n3.sub(0.5).mul(w * 1.6)).div(w).clamp(0, 1);
  const apron = boxM(-16, 16, -9, 9, 0.5);                       // 作業場のコンクリート
  const hangarApron = boxM(-54, -18, -52, -18, 0.6);
  const road = boxM(-5.6, 5.6, -150, -9, 0.7);
  const tpad = length(q.sub(vec2(TESTPAD[0], TESTPAD[2]))).sub(7.5).add(n3.mul(2.0)).div(-1.6).clamp(0, 1);
  const lpad = length(q.sub(vec2(PAD[0], PAD[2]))).sub(40.0).div(-2.0).clamp(0, 1);
  const wornEdge = max(boxM(-22, 22, -15, 15, 5.0), length(q.sub(vec2(PAD[0], PAD[2]))).sub(50.0).div(-8.0).clamp(0, 1)).mul(n2.mul(0.9).add(0.25)).clamp(0, 1);
  let col = mix(grass, dirt, wornEdge.mul(0.8));
  col = mix(col, dirt.mul(0.85), tire.mul(0.85));                 // 草地では土の出たわだち
  col = mix(col, gravel, road);
  col = mix(col, dirt, tpad.mul(0.9));
  const hardC = max(max(apron, hangarApron), lpad);
  col = mix(col, conc.mul(tire.mul(-0.3).add(1.0)), hardC);       // コンクリートでは黒いタイヤのあと
  // 水ぎわは湿って暗い
  const wet = smoothstep(-0.9, 0.6, positionWorld.y).oneMinus().mul(smoothstep(60.0, 120.0, q.x));
  col = col.mul(wet.mul(-0.45).add(1.0));
  m.colorNode = col;
  const hard = max(max(apron, hangarApron), max(lpad, road));
  m.roughnessNode = mix(float(0.96), float(0.82), hard).sub(stain.mul(hard).mul(0.18)).sub(oil.mul(hardC).mul(0.42)).sub(wet.mul(0.4));
  m.metalness = 0;
  // 凹凸：草地と砂利はでこぼこ、コンクリートはなめらか（細かなざらつきと目地・ひびだけ）
  const hgt = mix(n4.mul(0.02).add(n3.mul(0.03)), n4.mul(0.0045).add(n3.mul(0.004)), hardC).add(joint.mul(hard).mul(-0.012)).add(crack.mul(hard).mul(-0.004));
  m.normalNode = bumpNormal(hgt, 1.0);
  const mesh = new THREE.Mesh(g, m);
  mesh.receiveShadow = true; mesh.castShadow = false;
  return mesh;
}

/** 芝・草むら：1 本ずつの葉（インスタンス）。風で揺れる。 */
export function makeGrass(count = 260000, seed = 77) {
  const rnd = mulberry(seed);
  // 葉の形（根元が太く、先が細い）
  const rows = [[0, 1.0], [0.34, 0.86], [0.68, 0.56], [1.0, 0.04]];
  const pos = [], uvs = [], idx = [];
  rows.forEach(([y, w], r) => { pos.push(-0.5 * w, y, 0, 0.5 * w, y, 0); uvs.push(0, y, 1, y); if (r > 0) { const a = (r - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  const m = new THREE.MeshStandardNodeMaterial();
  m.side = THREE.DoubleSide; m.roughness = 0.75; m.metalness = 0;
  const v = uv().y;
  const wp = positionLocal;                         // インスタンスの変換後（メッシュ空間＝世界）
  const tint = mx_noise_float(wp.xz.mul(0.07)).mul(0.5).add(0.5);
  const tint2 = hash(instanceIndex).mul(0.5).add(0.75);
  const root = mix(color(0x2f3f18), color(0x45521f), tint);
  const tip = mix(mix(color(0x7f9a3a), color(0xa6a84c), tint), color(0xb9a765), smoothstep(0.62, 0.9, mx_noise_float(wp.xz.mul(0.19).add(40.0)).mul(0.5).add(0.5)).mul(0.7));
  m.colorNode = mix(root, tip, v.pow(0.8)).mul(tint2);
  // 風：大きなうねり＋細かな震え（先ほど大きく）
  const gust = sin(time.mul(1.3).add(wp.x.mul(0.21)).add(wp.z.mul(0.13))).mul(0.5).add(mx_noise_float(vec2(wp.x.mul(0.05).add(time.mul(0.35)), wp.z.mul(0.05))).mul(0.8));
  const flut = sin(time.mul(7.0).add(wp.x.mul(3.1)).add(wp.z.mul(2.3))).mul(0.12);
  const bend = gust.add(flut).mul(v.mul(v)).mul(0.16);
  m.positionNode = vec3(wp.x.add(bend), wp.y.sub(abs(bend).mul(0.3)), wp.z.add(bend.mul(0.6)));
  const mesh = new THREE.InstancedMesh(geo, m, count);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const hard = (x, z) => {
    if (Math.abs(x) < 17 && Math.abs(z) < 10) return true;
    if (x > -55 && x < -17 && z > -53 && z < -17) return true;
    if (Math.abs(x) < 6.4 && z < -8 && z > -152) return true;
    if (Math.hypot(x - TESTPAD[0], z - TESTPAD[2]) < 8.2) return true;
    if (Math.hypot(x - PAD[0], z - PAD[2]) < 41) return true;
    { const dx = x + 12.8, dz = z + 37.6, r = Math.hypot(dx, dz), c = dx / r; if (dz > 0 && c > -0.9 && c < -0.06 && Math.min(Math.abs(r - 21.15), Math.abs(r - 22.85)) < 0.34) return true; }      // 車のあと
    if (x > PAD[0] + 40 && x < PAD[0] + 118 && Math.abs(Math.abs(z - PAD[2]) - 5.8) < 3.5) return true;      // クローラーウェイの砂利の帯
    if (x > PAD[0] + 40 && x < PAD[0] + 58 && Math.abs(z - PAD[2]) < 9.3) return true;                         // 火炎溝の出口の先（こげたコンクリート）
    return false;
  };
  let n = 0, guard = 0;
  while (n < count && guard++ < count * 6) {
    // 2 つの区域：作業場のまわり（7 割）と、発射台への道ぞい（3 割）
    let x, z;
    if (rnd() < 0.68) { const a = rnd() * 6.283, r = Math.sqrt(rnd()) * 78; x = Math.cos(a) * r; z = Math.sin(a) * r - 4; }
    else { x = (rnd() - 0.5) * 120; z = -60 - rnd() * 150; }
    if (hard(x, z)) continue;
    const y = yardH(x, z);
    if (y < WATER_Y + 0.25) continue;
    const dry = fbm2(x * 0.2, z * 0.2, 2);
    const hgt = (0.22 + rnd() * 0.42) * (0.7 + dry * 0.8);
    e.set((rnd() - 0.5) * 0.7, rnd() * 6.283, (rnd() - 0.5) * 0.5); q.setFromEuler(e);
    m4.compose(p.set(x, y - 0.02, z), q, s.set(0.045 + rnd() * 0.05, hgt, 1));
    mesh.setMatrixAt(n++, m4);
  }
  mesh.count = n;
  mesh.castShadow = false; mesh.receiveShadow = true; mesh.frustumCulled = false;
  return mesh;
}

/** 葉むらのテクスチャ（コードで描く） */
function leafTexture() {
  return canvasTex(256, 256, (ctx) => {
    ctx.clearRect(0, 0, 256, 256);
    const rnd = mulberry(5);
    for (let i = 0; i < 60; i++) {
      const x = 22 + rnd() * 212, y = 22 + rnd() * 212, a = rnd() * 6.283, L = 30 + rnd() * 30, w = L * (0.3 + rnd() * 0.16);
      const g = 70 + Math.floor(rnd() * 70);
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.fillStyle = `rgb(${Math.floor(g * 0.55)},${g + 30},${Math.floor(g * 0.3)})`;
      ctx.beginPath(); ctx.moveTo(-L / 2, 0); ctx.quadraticCurveTo(0, -w, L / 2, 0); ctx.quadraticCurveTo(0, w, -L / 2, 0); ctx.fill();
      ctx.strokeStyle = 'rgba(30,50,15,0.5)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-L / 2, 0); ctx.lineTo(L / 2, 0); ctx.stroke();
      ctx.restore();
    }
  });
}

/** 木々：幹と枝を再帰で生やし、枝先に葉むら（板）をまとわせる */
export function makeTrees(spots, seed = 12) {
  const rnd = mulberry(seed);
  const root = new THREE.Group();
  const barkGeos = [];
  const leaves = [];        // [x,y,z, size, cx,cy,cz]
  const up = new THREE.Vector3(0, 1, 0);
  const seg = (a, b, r0, r1) => {
    const d = new THREE.Vector3().subVectors(b, a), len = d.length();
    const g = new THREE.CylinderGeometry(r1, r0, len, 7, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, d.normalize()));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    barkGeos.push(g);
  };
  const grow = (a, dir, len, r, depth, crown) => {
    const b = a.clone().addScaledVector(dir, len);
    seg(a, b, r, r * 0.68);
    if (depth === 0) {
      const n = 46 + Math.floor(rnd() * 20);
      for (let i = 0; i < n; i++) {
        const o = new THREE.Vector3((rnd() - 0.5), (rnd() - 0.4), (rnd() - 0.5)).multiplyScalar(len * 2.3);
        leaves.push([b.x + o.x, b.y + o.y, b.z + o.z, 0.95 + rnd() * 0.9, crown.x, crown.y, crown.z]);
      }
      return;
    }
    const kids = 2 + (rnd() < 0.55 ? 1 : 0);
    for (let k = 0; k < kids; k++) {
      const nd = dir.clone().add(new THREE.Vector3((rnd() - 0.5) * 1.5, (rnd() - 0.15) * 0.9, (rnd() - 0.5) * 1.5)).normalize();
      grow(b, nd, len * (0.62 + rnd() * 0.18), r * 0.62, depth - 1, crown);
    }
  };
  for (const [x, z, hgt] of spots) {
    const base = new THREE.Vector3(x, yardH(x, z) - 0.2, z);
    const H = hgt * (0.85 + rnd() * 0.4);
    const crown = base.clone().add(new THREE.Vector3(0, H * 0.72, 0));
    grow(base, new THREE.Vector3((rnd() - 0.5) * 0.12, 1, (rnd() - 0.5) * 0.12).normalize(), H * 0.36, H * 0.045, 3, crown);
  }
  const bm = new THREE.MeshStandardNodeMaterial(); bm.roughness = 0.95;
  const bn = mx_fractal_noise_float(positionWorld.mul(vec3(3.0, 0.7, 3.0)), 3, 2.0, 0.5).mul(0.5).add(0.5);
  bm.colorNode = mix(color(0x3a2e22), color(0x6b5a45), bn);
  const bark = new THREE.Mesh(mergeGeometries(barkGeos), bm);
  bark.castShadow = true; bark.receiveShadow = true;
  root.add(bark);
  // 葉むら
  const n = leaves.length;
  const tex = leafTexture();
  const C = new Float32Array(n * 4);
  const lm = new THREE.MeshStandardNodeMaterial();
  lm.side = THREE.DoubleSide; lm.roughness = 0.62; lm.alphaTest = 0.45; lm.transparent = false;
  const t = texture(tex, uv());
  const cc = iattr(C);
  const wp = positionLocal;
  const shade = mx_noise_float(wp.mul(0.35)).mul(0.5).add(0.5);
  const depth = length(wp.sub(cc.xyz)).div(cc.w).clamp(0, 1.2);
  lm.colorNode = t.rgb.mul(mix(vec3(0.55, 0.62, 0.42), vec3(1.05, 1.1, 0.8), shade)).mul(depth.mul(0.75).add(0.3));
  lm.opacityNode = t.a;
  lm.normalNode = transformNormalToView(normalize(wp.sub(cc.xyz).add(vec3(0, 0.6, 0))));
  const sway = sin(time.mul(1.6).add(wp.x.mul(0.3)).add(wp.z.mul(0.2))).mul(0.06).add(sin(time.mul(5.3).add(wp.y.mul(2.0)).add(wp.x)).mul(0.02));
  lm.positionNode = vec3(wp.x.add(sway), wp.y.add(sway.mul(0.3)), wp.z.add(sway.mul(0.7)));
  const lmesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), lm, n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
  leaves.forEach((L, i) => {
    e.set(rnd() * 6.283, rnd() * 6.283, rnd() * 6.283); q.setFromEuler(e);
    m4.compose(p.set(L[0], L[1], L[2]), q, s.set(L[3] * 1.5, L[3] * 1.5, 1));
    lmesh.setMatrixAt(i, m4);
    const cr = Math.hypot(L[0] - L[4], L[1] - L[5], L[2] - L[6]);
    C.set([L[4], L[5], L[6], Math.max(2.5, cr * 1.4)], i * 4);
  });
  lmesh.castShadow = true; lmesh.receiveShadow = true; lmesh.frustumCulled = false;
  root.add(lmesh);
  return root;
}

/** 入り江の水面（空を映す） */
export function makeWater() {
  const m = new THREE.MeshStandardNodeMaterial();
  m.color.set(0x1b3a44); m.roughness = 0.06; m.metalness = 0.0;
  const q = positionWorld.xz;
  const w = mx_noise_float(vec3(q.mul(0.6), time.mul(0.5))).mul(0.6).add(mx_noise_float(vec3(q.mul(2.3).add(9.0), time.mul(0.9))).mul(0.4));
  m.normalNode = bumpNormal(w.mul(0.035), 1.0);
  const g = new THREE.PlaneGeometry(900, 900);
  g.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(420, WATER_Y, -60);
  mesh.receiveShadow = true;
  return mesh;
}
