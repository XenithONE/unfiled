// 噴射炎：中身のある「体積」として描く。
//   ノズルの軸に沿った温度の分布（芯が熱い・外へ冷える・下流ほど乱れる）を、噴射の速さで流れる 3 次元の雑音でゆらし、
//   視線に沿って「発光」と「すすの吸収」を積分する（レイマーチ）。色は温度から決める（黒体の色の並び）。
//   状態は持たない：どのコマも時刻の関数なので、巻き戻しても同じ絵になる。
//   種類：kero = ケロシン（暗い帯 → まぶしい黄白 → 橙の先端）、h2 = 水素など（ほとんど透明な淡い青。真空で大きく広がる）
import * as THREE from 'three/webgpu';
import {
  Fn, Loop, uniform, texture3D, float, int, vec3, vec4, max, min, abs, normalize, length, exp, mix, smoothstep, pow, sqrt, cos, sin, select, fract, dot,
  positionLocal, positionWorld, positionView, cameraPosition, cameraViewMatrix, modelWorldMatrixInverse, screenUV, screenSize, viewportDepthTexture, perspectiveDepthToViewZ, cameraNear, cameraFar,
} from 'three/tsl';
import { mulberry } from '../core/util.js';
import { FX_LAYER } from '../core/engine.js';

const HI = typeof location !== 'undefined' && new URLSearchParams(location.search).get('q') === 'high';

// ---------------------------------------------------------------------
// 継ぎ目なく繰り返す 3 次元の雑音（R・G・B = なめらかな雑音 3 種、A = もこもこした細胞の雑音）
// ---------------------------------------------------------------------
function perlinInto(out, N, P, seed, amp) {
  const rnd = mulberry(seed);
  const G = new Float32Array(P * P * P * 3);
  for (let i = 0; i < P * P * P; i++) {
    const z = rnd() * 2 - 1, a = rnd() * 6.2831853, r = Math.sqrt(1 - z * z);
    G[i * 3] = Math.cos(a) * r; G[i * 3 + 1] = Math.sin(a) * r; G[i * 3 + 2] = z;
  }
  const i0 = new Int32Array(N), i1 = new Int32Array(N), f = new Float32Array(N), w = new Float32Array(N);
  for (let i = 0; i < N; i++) { const x = ((i + 0.5) / N) * P, xi = Math.floor(x); i0[i] = xi % P; i1[i] = (xi + 1) % P; f[i] = x - xi; const t = f[i]; w[i] = t * t * t * (t * (t * 6 - 15) + 10); }
  let o = 0;
  for (let k = 0; k < N; k++) {
    const z0 = i0[k] * P, z1 = i1[k] * P, fz = f[k], wz = w[k];
    for (let j = 0; j < N; j++) {
      const a00 = (z0 + i0[j]) * P, a10 = (z0 + i1[j]) * P, a01 = (z1 + i0[j]) * P, a11 = (z1 + i1[j]) * P, fy = f[j], wy = w[j];
      for (let i = 0; i < N; i++, o++) {
        const x0 = i0[i], x1 = i1[i], fx = f[i], wx = w[i];
        const d = (g, dx, dy, dz) => G[g * 3] * dx + G[g * 3 + 1] * dy + G[g * 3 + 2] * dz;
        const n000 = d(a00 + x0, fx, fy, fz), n100 = d(a00 + x1, fx - 1, fy, fz), n010 = d(a10 + x0, fx, fy - 1, fz), n110 = d(a10 + x1, fx - 1, fy - 1, fz);
        const n001 = d(a01 + x0, fx, fy, fz - 1), n101 = d(a01 + x1, fx - 1, fy, fz - 1), n011 = d(a11 + x0, fx, fy - 1, fz - 1), n111 = d(a11 + x1, fx - 1, fy - 1, fz - 1);
        const nx00 = n000 + (n100 - n000) * wx, nx10 = n010 + (n110 - n010) * wx, nx01 = n001 + (n101 - n001) * wx, nx11 = n011 + (n111 - n011) * wx;
        const ny0 = nx00 + (nx10 - nx00) * wy, ny1 = nx01 + (nx11 - nx01) * wy;
        out[o] += (ny0 + (ny1 - ny0) * wz) * amp;
      }
    }
  }
}
function worleyInto(out, N, P, seed, amp) {
  const rnd = mulberry(seed);
  const F = new Float32Array(P * P * P * 3);
  for (let i = 0; i < F.length; i++) F[i] = rnd();
  let o = 0;
  for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++, o++) {
    const x = ((i + 0.5) / N) * P, y = ((j + 0.5) / N) * P, z = ((k + 0.5) / N) * P;
    const cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z);
    let best = 9;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const gx = cx + dx, gy = cy + dy, gz = cz + dz;
      const g = ((((gz % P) + P) % P) * P + (((gy % P) + P) % P)) * P + (((gx % P) + P) % P);
      const px = gx + F[g * 3] - x, py = gy + F[g * 3 + 1] - y, pz = gz + F[g * 3 + 2] - z;
      const d2 = px * px + py * py + pz * pz;
      if (d2 < best) best = d2;
    }
    out[o] += (1 - Math.min(1, Math.sqrt(best))) * amp;
  }
}
let _noise = null;
/** 共有の雑音テクスチャ（最初の 1 回だけ作る） */
export function noiseTex3D() {
  if (_noise) return _noise;
  const N = 48, n3 = N * N * N;
  const data = new Uint8Array(n3 * 4);
  const ch = (fill) => { const a = new Float32Array(n3); fill(a); let lo = 1e9, hi = -1e9; for (let i = 0; i < n3; i++) { if (a[i] < lo) lo = a[i]; if (a[i] > hi) hi = a[i]; } const s = 255 / (hi - lo || 1); return (i) => (a[i] - lo) * s; };
  const R = ch((a) => { perlinInto(a, N, 4, 11, 1); perlinInto(a, N, 8, 12, 0.5); perlinInto(a, N, 16, 13, 0.25); });
  const G = ch((a) => { perlinInto(a, N, 4, 21, 1); perlinInto(a, N, 8, 22, 0.5); perlinInto(a, N, 16, 23, 0.25); });
  const B = ch((a) => { perlinInto(a, N, 4, 31, 1); perlinInto(a, N, 8, 32, 0.5); perlinInto(a, N, 16, 33, 0.25); });
  const A = ch((a) => { worleyInto(a, N, 4, 41, 1); worleyInto(a, N, 8, 42, 0.55); perlinInto(a, N, 16, 43, 0.3); });
  for (let i = 0; i < n3; i++) { data[i * 4] = R(i); data[i * 4 + 1] = G(i); data[i * 4 + 2] = B(i); data[i * 4 + 3] = A(i); }
  const t = new THREE.Data3DTexture(data, N, N, N);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping; t.generateMipmaps = false; t.unpackAlignment = 1; t.needsUpdate = true;
  return (_noise = t);
}

// ---------------------------------------------------------------------
// 種類ごとの性質（長さは「ノズルの半径 R0」を単位にした比）
// ---------------------------------------------------------------------
const KIND = {
  kero: {
    kLen: 1.5,      // 呼び出し側の長さに掛ける倍率（光って見える長さ）
    vLen: 1.5,      // 真空での伸び
    V: 34,          // 流れの速さ（R0 / 秒）
    wid: 1.5, vwid: 5.5,   // 地上・真空での広がり
    rb0: 3.7, rb1: 8.6,    // 描く範囲の半径（地上・真空）
    rag: 0.75, coreK: 1.7,
    d0: 1.1, d1: 3.0, dark: 0.16,   // 暗い帯の終わり方
    t0: 0.42, I: 3.9, soot: 2.2, kf: 0.75, w0: 0.1, w1: 0.85,
    vac0: 0,
  },
  h2: { kLen: 1.25, vLen: 1.0, V: 46, wid: 0.8, vwid: 5.0, rb0: 2.6, rb1: 7.2, I: 0.4, dia: 1.5, halo: 0.2, cA: [0.3, 0.5, 1.0], cB: [0.88, 0.94, 1.0], vac0: 1 },
  // 月着陸船の降下エンジン（自己着火性の燃料）：ほぼ見えない
  hyper: { kLen: 1.0, vLen: 1.0, V: 40, wid: 0.8, vwid: 4.2, rb0: 2.6, rb1: 6.4, I: 0.16, dia: 0.0, halo: 0.13, cA: [0.55, 0.62, 1.0], cB: [0.95, 0.95, 1.0], vac0: 1 },
};

let _depth = null;
const sceneDepth = () => _depth || (_depth = viewportDepthTexture());

// 物体ごとに値の変わる uniform（素材は種類ごとに 1 つを共有する。シェーダーの準備が 1 回で済む）
const ou = (key) => uniform(0).onObjectUpdate(({ object }) => object.userData.pl[key]);
const ouv = (key) => uniform(new THREE.Vector3()).onObjectUpdate(({ object }, self) => self.value.copy(object.userData.pl[key]));
const premul = (m) => {
  m.side = THREE.BackSide; m.transparent = true; m.depthWrite = false; m.depthTest = false; m.fog = false;
  // あらかじめ掛け算した色を足し、すすの分だけ背景を暗くする
  m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor; m.blendSrcAlpha = THREE.OneFactor; m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  return m;
};
/** 温度（0..1 強）→ 色。赤 → 橙 → 黄白（黒体の色の並び） */
const fireColor = (temp) => mix(mix(vec3(1.0, 0.1, 0.012), vec3(1.0, 0.4, 0.07), smoothstep(0.05, 0.35, temp)), mix(vec3(1.0, 0.7, 0.3), vec3(1.0, 0.88, 0.62), smoothstep(0.62, 1.0, temp)), smoothstep(0.3, 0.66, temp));
const jitter = (T) => { const sp = screenUV.mul(screenSize); return fract(sin(sp.x.mul(12.9898).add(sp.y.mul(78.233))).mul(43758.5453).add(T.mul(37.0))); };

const SHARED = {};
function plumeMaterial(kind) {
  if (SHARED[kind]) return SHARED[kind];
  const K = KIND[kind];
  const N3 = texture3D(noiseTex3D());
  const U = { T: ou('T'), P: ou('P'), I: ou('I'), B: ou('B'), L: ou('L'), V: ou('V'), Rb: ou('Rb'), Lb: ou('Lb'), R0: ou('R0'), sv: ouv('sv') };
  // 歩数は uniform（回数の決まったループはコンパイラが展開して準備に時間がかかるため）
  const steps = uniform(kind === 'kero' ? (HI ? 44 : 26) : (HI ? 30 : 18));
  const R0 = U.R0, sv = U.sv;
  const YTOP = R0.mul(kind === 'kero' ? 1.7 : 0.25);
  const m = premul(new THREE.MeshBasicNodeMaterial());
  // 描く範囲の円柱（半径 Rb、上端 YTOP、下端 -Lb）
  m.positionNode = vec3(positionLocal.x.mul(U.Rb), positionLocal.y.mul(U.Lb.add(YTOP)).add(YTOP), positionLocal.z.mul(U.Rb));

  // ---- ケロシン：暗い帯 → まぶしい黄白 → 橙 → 赤い先端
  const kero = (p) => {
    const fq = R0.mul(12.8).reciprocal().toVar();                                  // 雑音の 1 タイル = 12.8 R0
    const flow = U.T.mul(R0).mul(K.V);                                              // 流れた距離
    const s = p.y.negate().toVar();
    const un = s.div(U.L).clamp(0.0, 1.0).toVar();
    const n0 = N3.sample(vec3(p.x, p.y.mul(0.5).add(flow.mul(0.5)), p.z).mul(fq).add(sv)).level(0).toVar();
    const wv = n0.xyz.sub(0.5).toVar();
    const amp = un.mul(K.w1).add(K.w0).mul(mix(float(1.0), float(2.2), U.V)).mul(R0).mul(2.0);
    const pw = p.add(vec3(wv.x, wv.y.mul(0.6), wv.z).mul(amp));
    const rr = length(pw.xz);
    const sea = pow(un, 0.55).mul(K.wid).add(0.95).mul(sqrt(pow(un, 3.0).oneMinus().max(0.0)).mul(0.55).add(0.45));
    const vac = exp(un.mul(-6.0)).oneMinus().mul(K.vwid).add(1.0);
    const Rp = mix(sea, vac, U.V).mul(R0).toVar();
    const rho = rr.div(Rp).toVar();
    const n1 = N3.sample(vec3(p.x, p.y.mul(0.8).add(flow.mul(0.3)), p.z).mul(fq.mul(3.1)).add(sv.mul(1.7).add(0.37))).level(0).toVar();
    const n2 = N3.sample(vec3(p.x, p.y.mul(0.9).add(flow.mul(0.17)), p.z).mul(fq.mul(7.3)).add(sv.mul(2.9).add(0.61))).level(0).toVar();
    const env = smoothstep(0.72, 1.04, rho.add(n1.w.sub(0.5).mul(un.mul(0.9).add(0.3)).mul(K.rag)).add(n1.x.sub(0.5).mul(0.25)).add(n2.w.sub(0.5).mul(0.22))).oneMinus();
    const core = exp(rho.mul(rho).mul(-K.coreK));
    // 着火の境目（暗い帯の終わり）：雑音でぎざぎざに。立ち上がりの間は下流へずれる。太い炎では長くしすぎない
    const sI = s.add(wv.y.mul(R0).mul(2.2)).add(n1.w.sub(0.5).mul(R0).mul(2.4)).add(n1.x.sub(0.5).mul(R0)).sub(U.P.oneMinus().mul(R0).mul(3.0));
    const ign = smoothstep(R0.mul(K.d0).min(0.7), R0.mul(K.d1).min(2.0), sI).toVar();
    const tip = smoothstep(K.t0, 1.0, un.add(n0.w.sub(0.5).mul(0.34))).oneMinus();
    const tex = pow(n1.w, 1.5).mul(1.15).add(n0.w.mul(0.4)).add(pow(n2.w, 1.3).mul(0.5)).add(0.08);
    const temp = core.mul(0.72).add(0.28).mul(env).mul(tip).mul(mix(float(K.dark), float(1.0), ign)).mul(tex).mul(U.P.mul(0.42).add(0.58)).clamp(0.0, 1.35).toVar();
    const dil = pow(R0.mul(2.4).div(max(Rp, R0.mul(2.4))), 1.3);                    // 広がった分だけ薄まる
    const below = smoothstep(R0.mul(-0.05), R0.mul(0.12), s);                       // ノズルの出口より上は描かない
    const em = fireColor(temp).mul(pow(temp, 2.7)).mul(K.I).div(R0).mul(dil).mul(below);
    // すす：ノズルを出てすぐの外側の層（暗い帯）。炎そのものも光を通しにくい（奥の炎は手前に隠れる → 表面のもこもこが見える）
    const sheath = smoothstep(0.45, 0.8, rho).mul(smoothstep(1.02, 1.3, rho).oneMinus());
    const sootK = float(K.soot).div(R0).mul(float(0.9).div(R0).clamp(0.25, 1.0));
    const ab = sheath.mul(ign.oneMinus()).mul(n1.y.mul(0.6).add(0.7)).mul(sootK).mul(U.V.oneMinus()).add(temp.min(1.0).mul(dil).mul(K.kf).div(R0)).mul(below);
    // 点火と停止の瞬間：燃料の多い橙の火が、ノズルのまわりにふくらむ
    const zn = s.div(R0), rn = length(p.xz).div(R0);
    const ball = exp(rn.sub(1.25).pow(2.0).div(0.9).add(zn.sub(0.3).pow(2.0).div(1.3)).negate());
    const tb = ball.mul(U.B).mul(n1.w.mul(1.1).add(0.25)).mul(n0.w.mul(0.8).add(0.5)).toVar();
    const emB = mix(vec3(1.0, 0.16, 0.02), vec3(1.0, 0.5, 0.1), smoothstep(0.2, 0.9, tb)).mul(tb.mul(tb)).mul(2.4).div(R0);
    return { em: em.add(emB), ab: ab.add(tb.mul(1.4).div(R0)) };
  };

  // ---- 水素など：ほとんど透明な淡い青。真空では大きく広がる。ノズルのすぐ後ろに薄い衝撃の節
  const h2 = (p) => {
    const fq = R0.mul(12.8).reciprocal();
    const s = p.y.negate().toVar();
    const un = s.div(U.L).clamp(0.0, 1.0).toVar();
    const n0 = N3.sample(vec3(p.x, p.y.mul(0.35).add(U.T.mul(R0).mul(K.V * 0.35)), p.z).mul(fq).add(sv)).level(0).toVar();
    const wv = n0.xyz.sub(0.5);
    const pw = p.add(vec3(wv.x, 0.0, wv.z).mul(un.mul(1.6).add(0.1)).mul(R0).mul(0.9));
    const rr = length(pw.xz).toVar();
    const sea = un.mul(K.wid).add(1.0).mul(sqrt(pow(un, 2.5).oneMinus().max(0.0)).mul(0.6).add(0.4));
    const vac = exp(un.mul(-5.0)).oneMinus().mul(K.vwid).add(1.0);
    const Rp = mix(sea, vac, U.V).mul(R0).toVar();
    const rho = rr.div(Rp).toVar();
    const core = exp(rho.mul(rho).mul(-3.4));
    const halo = exp(rho.mul(rho).mul(-1.15)).mul(smoothstep(1.0, 1.25, rho).oneMinus());
    const tip = pow(un.oneMinus(), 1.6);
    const jet = exp(rr.div(R0.mul(0.62)).pow(2.0).negate());
    const dia = pow(cos(s.div(R0.mul(1.7)).mul(3.14159)).mul(0.5).add(0.5), 3.0).mul(exp(s.div(R0.mul(2.2)).negate())).mul(jet);
    const streak = n0.w.mul(0.75).add(0.6);
    const dil = pow(R0.div(max(Rp, R0)), 1.45);
    const I = core.add(halo.mul(K.halo)).mul(tip).mul(streak).mul(dil).add(dia.mul(K.dia)).add(jet.mul(exp(s.div(R0.mul(3.0)).negate())).mul(0.9));
    const col = mix(vec3(...K.cA), vec3(...K.cB), core.mul(tip).mul(dil.mul(2.0)).add(dia).clamp(0.0, 1.0));
    return { em: col.mul(I).mul(K.I).div(R0).mul(smoothstep(R0.mul(-0.05), R0.mul(0.12), s)), ab: float(0.0) };
  };
  const field = kind === 'kero' ? kero : h2;   // h2・hyper は同じ式（係数だけ違う）

  m.colorNode = Fn(() => {
    const rdW = normalize(positionWorld.sub(cameraPosition));
    const ro = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1.0)).xyz.toVar();
    const rd = modelWorldMatrixInverse.mul(vec4(rdW, 0.0)).xyz.toVar();          // 長さは 1 / 拡大率
    // 円柱との交差（t は世界の距離）
    const a = rd.x.mul(rd.x).add(rd.z.mul(rd.z)).max(1e-8);
    const b = ro.x.mul(rd.x).add(ro.z.mul(rd.z));
    const c = ro.x.mul(ro.x).add(ro.z.mul(ro.z)).sub(U.Rb.mul(U.Rb));
    const sq = sqrt(b.mul(b).sub(a.mul(c)).max(0.0));
    const t0c = b.negate().sub(sq).div(a), t1c = b.negate().add(sq).div(a);
    const iy = float(1.0).div(select(abs(rd.y).lessThan(1e-6), float(1e-6), rd.y));
    const ya = YTOP.sub(ro.y).mul(iy), yb = U.Lb.negate().sub(ro.y).mul(iy);
    const tN = max(max(t0c, min(ya, yb)), 0.0).toVar();
    const tF = min(t1c, max(ya, yb));
    const sceneZ = perspectiveDepthToViewZ(sceneDepth(), cameraNear, cameraFar);
    const tEnd = min(tF, sceneZ.div(normalize(positionView).z));
    const ds = tEnd.sub(tN).max(0.0).div(steps).toVar();
    const dsl = ds.mul(length(rd)).toVar();
    const jit = jitter(U.T).toVar();
    const C = vec3(0.0).toVar(), Tr = float(1.0).toVar();
    Loop({ start: int(0), end: int(steps), type: 'int', condition: '<' }, ({ i }) => {
      const p = ro.add(rd.mul(tN.add(ds.mul(float(i).add(jit))))).toVar();
      const f = field(p);
      C.addAssign(f.em.mul(dsl).mul(Tr));
      if (kind === 'kero') Tr.mulAssign(exp(f.ab.mul(dsl).negate()));
    });
    const flick = sin(U.T.mul(53.0)).mul(0.05).add(sin(U.T.mul(31.7)).mul(0.04)).add(1.0);
    return vec4(C.mul(max(U.I, U.B.mul(0.8))).mul(flick), Tr.oneMinus().mul(U.P.clamp(0.0, 1.0)));
  })();
  return (SHARED[kind] = m);
}

let _geo = null, _count = 0;
/**
 * 体積の噴射炎。Flame（fx.js）の中身。
 *   new Plume(ノズルの半径, 長さ, { kind: 'kero' | 'h2' | 'hyper', gain })
 *   .set(T, 強さ 0..1, 長さの倍率)   … 毎コマ呼ぶ。強さ 0 で消える
 *   .vac(k)                          … 外気の薄さ（0 = 地上、1 = 真空）。set のあとに呼ぶ。強さ 0 の set で元に戻る
 */
export class Plume {
  constructor(r, len, o = {}) {
    const kind = (this.kind = o.kind || 'kero');
    const K = (this.K = KIND[kind]);
    this.R0 = r; this.len0 = len * K.kLen;
    this.gain = (o.gain ?? (kind === 'kero' ? 1.5 : 2.0)) / (kind === 'kero' ? 1.5 : 2.0);
    const seed = ++_count;
    // 物体ごとの値（素材は共有）
    const pl = (this.pl = { T: 0, P: 1, I: 1, B: 0, L: len, V: K.vac0, Rb: r * K.rb0, Lb: len, R0: r, sv: new THREE.Vector3((seed * 0.731) % 1, (seed * 0.417) % 1, (seed * 0.289) % 1) });
    _geo = _geo || new THREE.CylinderGeometry(1, 1, 1, 20, 1, false).translate(0, -0.5, 0);
    const mesh = (this.mesh = new THREE.Mesh(_geo, plumeMaterial(kind)));
    mesh.userData.pl = pl;
    mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false; mesh.layers.set(FX_LAYER); mesh.renderOrder = 60;
    const g = (this.root = new THREE.Group());
    g.add(mesh); g.visible = false;
    this._vac = K.vac0; this._p = 0; this._len = 1;
  }
  _apply() {
    const { K, pl } = this, v = this._vac, p = this._p;
    const L = this.len0 * this._len * (0.4 + 0.6 * p) * (1 + (K.vLen - 1) * v);
    pl.L = L; pl.Lb = L * 1.04; pl.V = v;
    pl.Rb = this.R0 * (K.rb0 + (K.rb1 - K.rb0) * v);
    pl.I = this.gain * Math.pow(p, 1.4);
    pl.B = 4 * p * (1 - p) * (1 - v);   // 立ち上がり・立ち下がりの途中だけ（真空では出ない）
  }
  /** power 0..1、len は長さの倍率 */
  set(T, power = 1, len = 1) {
    const on = power > 0.001;
    this.root.visible = on;
    if (!on) { this._vac = this.K.vac0; this._p = 0; return this; }
    this.pl.T = T; this.pl.P = power; this._p = Math.min(1, power); this._len = len;
    this._apply();
    return this;
  }
  /** 外気の薄さ（0 = 地上 … 1 = 真空）。高度が上がるほど炎は大きく広がり、薄く長くなる */
  vac(k) { this._vac = Math.max(0, Math.min(1, k)); this._apply(); return this; }
}

// ---------------------------------------------------------------------
// 爆発の火球：ふくらみながら上がる、中身のある炎とすす煙の球
// ---------------------------------------------------------------------
function fireballMaterial(U, L, seed) {
  const N3 = texture3D(noiseTex3D());
  const steps = uniform(HI ? 40 : 24);
  const m = premul(new THREE.MeshBasicNodeMaterial());
  const sv = vec3(seed * 0.631, seed * 0.317, seed * 0.189);
  m.colorNode = Fn(() => {
    const rdW = normalize(positionWorld.sub(cameraPosition));
    const ro = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1.0)).xyz.toVar();
    const rd = modelWorldMatrixInverse.mul(vec4(rdW, 0.0)).xyz.toVar();
    // 半径 1 の球との交差（t は世界の距離）
    const a = dot(rd, rd), b = dot(ro, rd), c = dot(ro, ro).sub(1.0);
    const sq = sqrt(b.mul(b).sub(a.mul(c)).max(0.0));
    const tN = max(b.negate().sub(sq).div(a), 0.0).toVar();
    const tF = b.negate().add(sq).div(a);
    const sceneZ = perspectiveDepthToViewZ(sceneDepth(), cameraNear, cameraFar);
    const tEnd = min(tF, sceneZ.div(normalize(positionView).z));
    const ds = tEnd.sub(tN).max(0.0).div(steps).toVar();
    const dsl = ds.mul(length(rd)).toVar();
    const jit = jitter(U.t).toVar();
    const C = vec3(0.0).toVar(), Tr = float(1.0).toVar();
    Loop({ start: int(0), end: int(steps), type: 'int', condition: '<' }, ({ i }) => {
      const q = ro.add(rd.mul(tN.add(ds.mul(float(i).add(jit))))).toVar();
      // 球といっしょにふくらむ雑音 ＋ ゆっくり湧き返る動き
      const n0 = N3.sample(q.mul(0.27).add(vec3(0.0, U.t.mul(-0.06), 0.0)).add(sv)).level(0).toVar();
      const qw = q.add(n0.xyz.sub(0.5).mul(0.55)).toVar();
      const rw = length(qw);
      const n1 = N3.sample(qw.mul(0.8).add(vec3(U.t.mul(0.03), U.t.mul(-0.1), 0.0)).add(sv.mul(1.9))).level(0).toVar();
      const n2 = N3.sample(qw.mul(2.1).add(vec3(0.0, U.t.mul(-0.16), 0.0)).add(sv.mul(3.1))).level(0).toVar();
      // もこもこした縁（カリフラワーのような形）
      const shape = smoothstep(0.6, 0.8, rw.add(n1.w.sub(0.5).mul(0.6)).add(n0.w.sub(0.5).mul(0.35)).add(n2.w.sub(0.5).mul(0.2))).oneMinus();
      // 温度：中心ほど熱く、もこもこの芯が明るい。時間とともに冷える
      const temp = U.heat.mul(float(1.2).sub(rw.mul(0.55))).mul(n1.w.mul(1.0).add(n2.w.mul(0.35)).add(0.2)).mul(shape).clamp(0.0, 1.4).toVar();
      const em = fireColor(temp).mul(pow(temp, 2.4)).mul(8.5);
      // すす煙：熱いうちは透けて光り、冷えた所から黒い煙になる
      const cool = float(1.2).sub(temp).clamp(0.0, 1.2);
      const soot = shape.mul(U.dens).mul(cool.mul(cool).mul(6.0).add(0.5));
      const nrm = normalize(qw.add(n1.xyz.sub(0.5).mul(0.9)).add(vec3(0.0, 1e-4, 0.0)));
      const lit = (L ? L.sunC.mul(dot(cameraViewMatrix.mul(vec4(nrm, 0.0)).xyz, L.sunV).mul(0.5).add(0.5).pow(1.6)).add(L.ambC.mul(nrm.y.mul(0.4).add(0.6))) : vec3(1.0)).mul(mix(vec3(0.085, 0.076, 0.07), vec3(0.028, 0.026, 0.025), n1.y));
      const al = exp(soot.mul(dsl).negate()).oneMinus();
      C.addAssign(em.mul(dsl).add(lit.mul(al)).mul(Tr));
      Tr.mulAssign(al.oneMinus());
    });
    return vec4(C, Tr.oneMinus());
  })();
  return m;
}
let _ball = null;
export class Fireball {
  /** o: { scale, seed, L: { sunV（カメラ基準の太陽の向き）, sunC, ambC }（煙に当てる光の uniform。Puffs.L を渡す） } */
  constructor(o = {}) {
    this.S = o.scale ?? 1;
    const U = (this.U = { t: uniform(0), heat: uniform(1), dens: uniform(1) });
    _ball = _ball || new THREE.IcosahedronGeometry(1, 3);
    const mesh = (this.mesh = new THREE.Mesh(_ball, fireballMaterial(U, o.L, (o.seed ?? 1) + 0.5)));
    mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false; mesh.layers.set(FX_LAYER); mesh.renderOrder = 45; mesh.visible = false;
  }
  /** t：爆発からの秒 */
  show(t) {
    const S = this.S, m = this.mesh;
    if (t < 0 || t > 4.4) { m.visible = false; return this; }
    m.visible = true;
    const R = S * (1.1 + 3.3 * (1 - Math.exp(-t * 4.5)) + 0.4 * t);
    m.scale.setScalar(R);
    m.position.set(0, S * (0.5 * t + 1.3 * (1 - Math.exp(-t * 1.2))), 0);
    this.U.t.value = t;
    this.U.heat.value = 1.55 * Math.exp(-t * 1.5) + 0.25 * Math.exp(-t * 0.5);
    const k = Math.min(1, Math.max(0, (t - 2.0) / 2.4));
    this.U.dens.value = Math.min(1, t / 0.06) * (1 - k * k * (3 - 2 * k));
    return this;
  }
}
