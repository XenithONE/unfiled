// 地球。大陸・気候・雲の「地図」を最初に GPU で焼き込み、毎コマは光と大気の式だけで描く。
//   ・全球の地図（正距円筒）と、低い軌道から見下ろす用の高精細な「窓」（心射図法の一部分）の 2 組
//   ・雲：温帯低気圧の渦・熱帯収束帯・層積雲の蜂の巣・貿易風の積雲を、流れで曲げた雑音から作る
//   ・光：雲の立体感（濃さの勾配）・地表に落ちる雲の影・海の照り返し・大気の散乱と減衰・夜の街あかり
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, texture, uv, positionLocal, cameraPosition, modelWorldMatrixInverse, vec2, vec3, vec4, float, mix, smoothstep, dot, pow, max, abs, color,
  normalize, cross, sin, cos, exp, sqrt, atan, asin, acos, log, dFdx, dFdy, mx_fractal_noise_float, mx_fractal_noise_vec3, mx_worley_noise_float,
} from 'three/tsl';
import { grp } from '../core/kit.js';
import { mulberry } from '../core/util.js';
import { drawGeo } from './geo.js';

const PI = Math.PI, TAU = PI * 2, DEG = 180 / PI;
const fbm = (p, oct, lac = 2.08, dim = 0.55) => mx_fractal_noise_float(p, oct, lac, dim);
const gauss = (x, m, s) => exp(x.sub(m).div(s).pow(2).negate());
const rotAxis = (p, c, ang) => { const ca = cos(ang), sa = sin(ang); return p.mul(ca).add(cross(c, p).mul(sa)).add(c.mul(dot(c, p)).mul(ca.oneMinus())); };
const rotY = (p, a) => { const c = cos(a), s = sin(a); return vec3(p.x.mul(c).sub(p.z.mul(s)), p.y, p.x.mul(s).add(p.z.mul(c))); };

// ---- 方向 ⇄ 地図の座標
/** 正距円筒：方向 → uv（SphereGeometry の uv と同じ向き） */
const eqUV = (d) => vec2(atan(d.z, d.x.negate()).div(TAU), asin(d.y.clamp(-1, 1)).div(PI).add(0.5));
const eqDir = (u) => { const lon = u.x.mul(TAU), lat = u.y.sub(0.5).mul(PI), cl = cos(lat); return vec3(cos(lon).negate().mul(cl), sin(lat), sin(lon).mul(cl)); };
/** 継ぎ目のない読み出しのための勾配（方向の微分から直接求める） */
const eqGrad = (d) => {
  const dx = dFdx(d), dy = dFdy(d);
  const r2 = d.x.mul(d.x).add(d.z.mul(d.z)).max(1e-6), cy = sqrt(d.y.mul(d.y).oneMinus().max(1e-6));
  const g = (q) => vec2(d.z.mul(q.x).sub(d.x.mul(q.z)).div(r2).div(TAU), q.y.div(cy).div(PI));
  return [g(dx), g(dy)];
};
export function latLonDir(lat, lon) { const a = (lon + 180) / 360 * TAU, b = lat / DEG; return new THREE.Vector3(-Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b)); }

// ---- 低気圧の一覧（決め打ちの乱数で配置）
const CYC = (() => {
  const rnd = mulberry(4711), out = [];
  const add = (lat, lon, r, s, a, k) => {
    const c = latLonDir(lat, lon), e1 = new THREE.Vector3(0, 1, 0).cross(c).normalize(), e2 = c.clone().cross(e1);
    out.push({ c: c.toArray(), e1: e1.toArray(), e2: e2.toArray(), r, s, a, k, ph: rnd() * TAU });
  };
  for (let i = 0; i < 7; i++) add(43 + rnd() * 17, -172 + i * 51.4 + (rnd() - 0.5) * 24, 0.2 + rnd() * 0.1, 0.55 + rnd() * 0.45, 0.6 + rnd() * 0.35, 1.7);     // 北の温帯低気圧
  for (let i = 0; i < 9; i++) add(-(45 + rnd() * 15), -178 + i * 40 + (rnd() - 0.5) * 20, 0.19 + rnd() * 0.1, -(0.55 + rnd() * 0.45), 0.6 + rnd() * 0.35, -1.7);  // 南
  return out;
})();

// =====================================================================
// 焼き込み
// =====================================================================
/** 地表：色（rgb・リニア）と高さ（a。海は負）。aa = 海岸線のぼかし幅 */
function terrainNode(d, G, fine, aa) {
  return Fn(() => {
    const lat = asin(d.y.clamp(-1, 1)), latD = lat.mul(DEG), al = abs(latD).toVar();
    const nA = fbm(d.mul(5.5).add(11.3), 5).toVar();
    const nB = fbm(d.mul(23.0).add(3.1), 4).toVar();
    const nC = fbm(d.mul(88.0).add(7.7), 4).toVar();
    const nD = (fine ? fbm(d.mul(350.0).add(1.9), 4) : float(0)).toVar();
    // 海岸線：下絵を読む位置を雑音でずらして、入り江や岬を作る
    let wv = mx_fractal_noise_vec3(d.mul(6.0).add(2.7), 7, 2.1, 0.68).mul(0.011);
    if (fine) wv = wv.add(mx_fractal_noise_vec3(d.mul(420.0).add(5.1), 4, 2.1, 0.55).mul(0.0005));
    const dw = normalize(d.add(wv)).toVar();
    const guv = eqUV(d);
    const g1 = texture(G.geo1, eqUV(dw)), g2 = texture(G.geo2, guv), g1s = texture(G.geo1, guv);
    const lv = g1.r.add(nC.mul(0.03)).add(nD.mul(0.02)).toVar();
    const land = smoothstep(0.5 - aa, 0.5 + aa, lv).toVar();
    const v1 = nB.mul(0.5).add(0.5).clamp(0, 1), v2 = nC.mul(0.5).add(0.5).clamp(0, 1), v3 = nA.mul(0.5).add(0.5).clamp(0, 1);
    // 高さ：山脈は下絵の線に沿った尾根の雑音
    const mnt = g2.b.add(smoothstep(0.3, 0.8, fbm(d.mul(2.6).add(40.0), 3)).mul(0.18)).toVar();
    const rdg = fbm(d.mul(26.0).add(vec3(nA, nB, nA).mul(0.6)), 5, 2.1, 0.55).abs().oneMinus().toVar();
    const rdg2 = fbm(d.mul(85.0).add(5.0), 4).abs().oneMinus().toVar();
    let hN = v3.mul(0.08).add(mnt.mul(rdg.pow(2.0).mul(0.6).add(rdg2.mul(rdg).mul(0.25)).add(0.1))).add(nC.mul(0.015));
    if (fine) hN = hN.add(fbm(d.mul(300.0).add(8.0), 4).abs().oneMinus().mul(mnt.mul(0.07).add(0.012))).add(nD.mul(0.012)).add(fbm(d.mul(1200.0), 3).mul(0.004));
    const h = hN.max(0).toVar();
    // 気候：気温（緯度と高さ）と湿り気
    const temp = pow(cos(lat).max(0.0), 1.15).sub(h.mul(0.85)).add(nA.mul(0.03)).toVar();
    const des = g2.r, fo = g2.g, iceSheet = g1s.b;
    const wet0 = gauss(latD, 2.0, 11.0).mul(0.8).add(smoothstep(36.0, 50.0, al).mul(smoothstep(64.0, 78.0, al).oneMinus()).mul(0.62)).add(0.18);
    const moist = wet0.sub(des).add(fo.mul(v3.mul(0.5).add(0.45))).add(nA.mul(0.16)).add(nB.mul(0.09)).clamp(0, 1).toVar();
    // 陸の色
    const big = fbm(d.mul(3.3).add(60.0), 3).mul(0.5).add(0.5);
    let sand = mix(color(0xd8bc98), color(0xcfa37c), smoothstep(0.3, 0.75, v3));
    sand = mix(sand, color(0xe8d5b0), smoothstep(0.5, 0.9, v1).mul(0.55));
    sand = mix(sand, color(0xb98058), smoothstep(0.5, 0.85, big).mul(0.5));
    sand = mix(sand, color(0x84695a), smoothstep(0.55, 0.9, fbm(d.mul(11.0).add(33.0), 4).mul(0.5).add(0.5)).mul(0.6));
    sand = mix(sand, color(0x6f5a4e), smoothstep(0.25, 0.6, h).mul(0.6));
    if (fine) {
      const erg = smoothstep(0.1, 0.5, fbm(d.mul(9.0).add(71.0), 3));                                   // 砂丘のある所
      const dune = sin(dot(d, vec3(0.61, 0.2, 0.77)).mul(7600.0).add(fbm(d.mul(260.0).add(3.0), 3).mul(7.0))).mul(0.5).add(0.5);
      sand = sand.mul(dune.mul(erg).mul(0.16).oneMinus());
      const wadi = fbm(d.mul(520.0).add(vec3(nB, nC, nB).mul(2.0)), 4).abs().oneMinus().pow(6.0);          // 枯れ川の筋
      sand = mix(sand, color(0x8a6f5c), wadi.mul(erg.oneMinus()).mul(0.45));
    }
    const steppe = mix(color(0x9c8e64), color(0x80794c), v1);
    const grass = mix(color(0x5f6c3a), color(0x78803f), v2);
    const woods = mix(color(0x2b4624), color(0x415a2c), v1);
    const jungle = mix(color(0x143010), color(0x23441a), v2);
    const boreal = mix(color(0x223322), color(0x33442b), v1);
    const tundra = mix(color(0x6c6852), color(0x8c8b77), v2);
    const rock = mix(color(0x685e56), color(0x8a7d70), v1);
    let lc = mix(sand, steppe, smoothstep(0.1, 0.34, moist));
    const green = mix(grass, mix(woods, jungle, smoothstep(0.82, 0.95, temp)), smoothstep(0.5, 0.8, moist));
    lc = mix(lc, green, smoothstep(0.3, 0.55, moist));
    lc = mix(lc, mix(tundra, boreal, smoothstep(0.3, 0.55, moist)), smoothstep(0.42, 0.6, temp).oneMinus());
    lc = mix(lc, tundra, smoothstep(0.26, 0.38, temp).oneMinus().mul(0.9));
    lc = mix(lc, rock, smoothstep(0.3, 0.55, h).mul(0.7));
    const snow = max(smoothstep(0.15, 0.24, temp).oneMinus(), smoothstep(0.32, 0.55, iceSheet.add(nB.mul(0.1))));
    lc = mix(lc, mix(color(0xe6ecf3), color(0xfafcff), v1), snow.clamp(0, 1));
    // 海の色：深い紺、岸の近く（場所による）は明るい青緑
    const shelfN = smoothstep(-0.25, 0.45, fbm(d.mul(4.3).add(21.0), 3));
    const shelf = smoothstep(0.24, 0.5, g1.g.add(nB.mul(0.03))).mul(shelfN);
    const trop = smoothstep(18.0, 42.0, al).oneMinus();
    const deep = mix(color(0x030f2b), color(0x09244f), v3.mul(0.7).add(v1.mul(0.3)));
    const shallow = mix(color(0x0d4a6e), color(0x2aa3a6), trop.mul(smoothstep(0.35, 0.8, v1)));
    let oc = mix(deep, shallow, shelf.pow(2.2).mul(0.7));
    oc = mix(oc, color(0x41c6ba), smoothstep(0.4, 0.5, lv).mul(trop.mul(0.75).add(0.15)).mul(shelfN).mul(0.55));
    const iceEdge = mix(float(62.5), float(73.0), smoothstep(-2.0, 2.0, latD));
    const seaIce = smoothstep(iceEdge, iceEdge.add(3.0), al.add(nA.mul(4.0)).add(nB.mul(2.0))).toVar();
    oc = mix(oc, color(0xe4ebf2).mul(v2.mul(0.2).add(0.8)), seaIce.mul(0.93));
    const hOut = mix(mix(float(-0.2), float(0.02), seaIce), h.add(0.03), land);
    return vec4(mix(oc, lc, land), hOut);
  })();
}

// 層積雲の広がる海域（大陸の西の沖）[緯度, 経度, 半径 rad]
const DECKS = [[27, -128, 0.24], [-20, -88, 0.28], [-17, 2, 0.24], [20, -27, 0.2], [-27, 98, 0.2], [41, -152, 0.22], [-46, 100, 0.26]];
// 晴れやすい所（[緯度, 経度, 半径 rad, 強さ]）：日本のあたりは雲を少なめに
const CLEAR = [[35, 137, 0.16, 0.3]];

/** 雲：下層〜中層の濃さ（r）と上層の薄い巻雲（g） */
function cloudNode(d, G, fine) {
  return Fn(() => {
    const latD = asin(d.y.clamp(-1, 1)).mul(DEG).toVar(), al = abs(latD).toVar();
    const p = d.toVar();
    const arms = float(0).toVar(), cyc = float(0).toVar();
    for (const c of CYC) {
      const cv = vec3(...c.c);
      const x = acos(dot(d, cv).clamp(-1, 1)).div(c.r).toVar();
      const az = atan(dot(d, vec3(...c.e2)), dot(d, vec3(...c.e1)));
      const spiral = cos(az.add(log(x.max(0.03)).mul(c.k)).add(c.ph)).mul(0.5).add(0.5);
      const env = smoothstep(0.07, 0.3, x).mul(smoothstep(0.9, 2.2, x).oneMinus());
      arms.addAssign(pow(spiral, 3.0).mul(env).mul(c.a));
      cyc.addAssign(env);
      p.assign(rotAxis(p, cv, exp(x.mul(x).mul(-0.8)).div(x.add(0.3)).mul(c.s)));
    }
    const deck = float(0).toVar();
    const dk = normalize(d.add(mx_fractal_noise_vec3(d.mul(3.1).add(44.0), 3, 2.0, 0.55).mul(0.16))).toVar();
    for (const [la, lo, r] of DECKS) { const c = latLonDir(la, lo); deck.addAssign(exp(acos(dot(dk, vec3(c.x, c.y, c.z)).clamp(-1, 1)).div(r).pow(2).negate())); }
    const clr = float(0).toVar();
    for (const [la, lo, r, k] of CLEAR) { const c = latLonDir(la, lo); clr.addAssign(exp(acos(dot(d, vec3(c.x, c.y, c.z)).clamp(-1, 1)).div(r).pow(2).negate()).mul(k)); }
    const q = vec3(p.x, p.y.mul(1.8), p.z).toVar();                               // 東西にのばす
    const w1 = mx_fractal_noise_vec3(q.mul(2.1).add(1.3), 2, 2.0, 0.5).mul(0.2).toVar();
    const qa = q.add(w1).toVar();
    const qb = qa.add(mx_fractal_noise_vec3(qa.mul(6.3).add(2.0), 2, 2.0, 0.5).mul(0.06)).toVar();
    const base = fbm(qb.mul(3.4), 4, 2.07, 0.57).toVar();                       // 大きな流れ（渦と帯）
    const iso = d.add(w1.mul(0.35)).toVar();                                      // 細部は引きのばさない
    const mid = fbm(iso.mul(17.0).add(31.0), 5, 2.1, 0.57).toVar();
    const fineN = fbm(iso.mul(110.0).add(5.0), fine ? 6 : 4, 2.1, 0.57).toVar();
    const guv = eqUV(d);
    const g1 = texture(G.geo1, guv), g2 = texture(G.geo2, guv);
    // 気候：熱帯収束帯はかたまりで湧き、亜熱帯は晴れ、温帯は嵐の通り道
    const itcz = gauss(latD, 6.0, 6.0).mul(smoothstep(-0.15, 0.5, fbm(q.mul(3.3).add(90.0), 3)).mul(0.3).add(0.1));
    const cov = itcz.sub(gauss(al, 24.0, 9.5).mul(0.17)).add(gauss(al, 54.0, 14.0).mul(0.13)).add(smoothstep(70.0, 85.0, al).mul(0.04)).add(0.05);
    const cy = cyc.clamp(0, 1);
    const arc = pow(fbm(qb.mul(2.4).add(40.0), 3, 2.0, 0.5).abs().oneMinus(), 6.0).mul(smoothstep(-0.3, 0.3, base));
    const v = base.mul(0.74).add(mid.mul(0.25)).mul(cy.mul(0.5).oneMinus()).add(arc.mul(0.34)).add(fineN.mul(0.12)).add(cov).add(arms.mul(mid.mul(0.35).add(0.8))).sub(cy.mul(0.26)).sub(clr).sub(g2.r.mul(g1.r).mul(0.28)).add(g2.g.mul(g1.r).mul(0.1)).toVar();
    let dens = smoothstep(-0.1, 0.72, v);
    // 層積雲の海：蜂の巣模様の広い雲
    const cell = mx_worley_noise_float(iso.mul(64.0).add(mid.mul(1.5))).toVar();
    const cells = smoothstep(0.04, 0.42, cell);
    const deckD = smoothstep(0.0, 0.42, deck.mul(1.05).add(base.mul(0.4)).add(mid.mul(0.32)).sub(0.5)).mul(g1.r.oneMinus()).mul(cells.mul(fine ? 0.55 : 0.22).add(fine ? 0.45 : 0.78)).mul(0.85);
    dens = max(dens, deckD);
    // 中くらいの濃さの雲にも細胞のむら
    const sc = smoothstep(0.25, 0.7, dens).mul(smoothstep(0.75, 0.98, dens).oneMinus());
    dens = dens.mul(mix(float(1.0), cells.mul(0.75).add(0.25), sc.mul(fine ? 0.5 : 0.25)));
    // 貿易風の積雲と、熱帯の森の上の入道雲（細かい粒）
    const marg = smoothstep(-0.3, 0.0, v).mul(smoothstep(0.05, 0.32, v).oneMinus());
    const pc = smoothstep(0.1, 0.34, mx_worley_noise_float(iso.mul(210.0))).oneMinus();
    const pcL = smoothstep(0.08, 0.3, mx_worley_noise_float(iso.mul(92.0).add(7.0))).oneMinus();
    dens = max(dens, pc.mul(0.55).add(pcL.mul(0.5)).mul(marg.add(g2.g.mul(g1.r).mul(0.5))).mul(smoothstep(-0.3, 0.4, mid)).mul(g2.r.mul(g1.r).oneMinus()).clamp(0, 0.8));
    // 縁をちぎる（濃い所は残し、薄い所ほど細かい雑音で削る）
    const er = fineN.mul(0.5).add(0.5).clamp(0, 1).mul(0.22);
    dens = dens.sub(er.mul(dens.oneMinus())).div(er.oneMinus().max(0.3)).clamp(0, 1);
    if (fine) {
      const cf = smoothstep(0.03, 0.4, mx_worley_noise_float(iso.mul(430.0).add(fineN.mul(0.8))));
      dens = dens.mul(cf.mul(0.3).add(0.7));
      const f2 = fbm(iso.mul(640.0).add(3.0), 5, 2.1, 0.55);
      dens = dens.add(f2.mul(0.55).mul(dens).mul(dens.oneMinus())).clamp(0, 1);
      const pc2 = smoothstep(0.12, 0.36, mx_worley_noise_float(iso.mul(900.0))).oneMinus();
      dens = max(dens, pc2.mul(smoothstep(-0.3, 0.0, v).mul(smoothstep(0.1, 0.4, v).oneMinus())).mul(0.5).mul(smoothstep(-0.2, 0.5, fineN)).mul(g2.r.mul(g1.r).oneMinus()));
    }
    // 巻雲：流れに沿った細い筋
    const qc = vec3(d.x, d.y.mul(2.6), d.z).add(w1.mul(2.2));
    const ci = fbm(qc.mul(6.0).add(50.0), 5, 2.2, 0.6).abs().oneMinus().pow(4.0).mul(smoothstep(0.0, 0.6, fbm(d.mul(2.3).add(70.0), 3))).mul(smoothstep(22.0, 40.0, al)).mul(0.5);
    return vec4(dens.clamp(0, 1), ci.clamp(0, 1), 0, 1);
  })();
}

function bakeMat(node) {
  const m = new THREE.MeshBasicNodeMaterial();
  m.fragmentNode = node; m.fog = false; m.depthTest = false; m.depthWrite = false; m.blending = THREE.NoBlending;
  return m;
}
let _quad = null;
/** 1 枚を帯に分けて焼く（1 回の描画が長くなりすぎないように） */
function bake(renderer, rt, node, strips = 8) {
  _quad = _quad || new THREE.QuadMesh();
  const m = bakeMat(node);
  _quad.material = m;
  const prevRT = renderer.getRenderTarget(), prevAuto = renderer.autoClear;
  renderer.autoClear = false;
  renderer.setRenderTarget(rt);
  const sh = Math.ceil(rt.height / strips);
  rt.scissorTest = true;
  for (let i = 0; i < strips; i++) { rt.scissor.set(0, i * sh, rt.width, Math.min(sh, rt.height - i * sh)); _quad.render(renderer); }
  rt.scissorTest = false; rt.scissor.set(0, 0, rt.width, rt.height);
  renderer.setRenderTarget(prevRT); renderer.autoClear = prevAuto;
  m.dispose();
}
const target = (w, h, o = {}) => {
  const rt = new THREE.RenderTarget(w, h, { type: o.half ? THREE.HalfFloatType : THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
  rt.texture.wrapS = o.wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  rt.texture.wrapT = THREE.ClampToEdgeWrapping;
  rt.texture.anisotropy = 8;
  return rt;
};

/**
 * 地図一式を焼く。map = { eq: true } か { c, e, n, tanH }（窓：中心 c、東 e、北 n、半角の tan）
 * 戻り値 { surf, aux, cloud }（どれも RGBA8）
 *   surf  rgb = 色の平方根, a = 水面
 *   aux   r,g = 高さの勾配（東・北）, b = 街あかり
 *   cloud r = 濃さ, g,b = 濃さの勾配（東・北）, a = 巻雲
 */
function bakeMaps(renderer, G, map, W, H) {
  const fine = !map.eq;
  const dirAt = (u) => (map.eq ? eqDir(u) : normalize(vec3(...map.c).add(vec3(...map.e).mul(u.x.sub(0.5).mul(2 * map.tanH))).add(vec3(...map.n).mul(u.y.sub(0.5).mul(2 * map.tanH)))));
  const cosLat = map.eq ? cos(uv().y.sub(0.5).mul(PI)).max(0.06) : float(1);
  const wrap = !!map.eq;
  const tx = 1 / W, ty = 1 / H;
  // 1) 地表（色と高さ）
  const rtA = target(W, H, { half: true, wrap });
  const aa = map.eq ? 0.126 * (2048 / W) : 0.126 * ((2 * Math.atan(map.tanH) * DEG / W) / (360 / 2048));
  bake(renderer, rtA, terrainNode(dirAt(uv()), G, fine, aa));
  // 2) 色（平方根で詰める）と水面
  const surf = target(W, H, { wrap });
  bake(renderer, surf, Fn(() => { const s = texture(rtA.texture, uv()).level(0); return vec4(sqrt(s.rgb.max(0)), smoothstep(-0.14, -0.03, s.a).oneMinus()); })(), 2);
  // 3) 高さの勾配と街あかり
  const aux = target(W, H, { wrap });
  bake(renderer, aux, Fn(() => {
    const hAt = (ox, oy, l) => texture(rtA.texture, uv().add(vec2(ox * tx, oy * ty))).level(l).a.max(0);
    const gx = hAt(1, 0, 0).sub(hAt(-1, 0, 0)).add(hAt(3, 0, 1.5).sub(hAt(-3, 0, 1.5)).mul(0.7));
    const gy = hAt(0, 1, 0).sub(hAt(0, -1, 0)).add(hAt(0, 3, 1.5).sub(hAt(0, -3, 1.5)).mul(0.7));
    const d = dirAt(uv()), guv = eqUV(d);
    const pop = texture(G.geo3, guv).r, landW = texture(G.geo1, guv).g;
    const hh = texture(rtA.texture, uv()).level(0).a;
    const land = smoothstep(0.0, 0.03, hh).mul(smoothstep(0.3, 0.5, hh).oneMinus());
    const towns = smoothstep(0.03, 0.2, mx_worley_noise_float(d.mul(260.0))).oneMinus();
    const big = smoothstep(0.0, 0.2, mx_worley_noise_float(d.mul(72.0).add(4.0))).oneMinus();
    const road = pow(fbm(d.mul(64.0).add(2.0), 2).abs().oneMinus(), 26.0);
    const cluster = smoothstep(0.0, 0.45, fbm(d.mul(34.0).add(9.0), 3).mul(0.6).add(pop.mul(1.25)).sub(0.42));
    const shore = smoothstep(0.45, 0.75, landW).oneMinus().mul(0.5).add(0.5);
    const city = towns.mul(0.75).add(big.mul(pop).mul(1.3)).add(road.mul(0.4)).mul(cluster).mul(shore).mul(land);
    return vec4(gx.div(cosLat).mul(map.eq ? 5.0 : 9.0).add(0.5), gy.mul(map.eq ? 5.0 : 9.0).add(0.5), city.clamp(0, 1), 1);
  })());
  rtA.dispose();
  // 4) 雲の濃さ
  const rtC = target(W, H, { half: true, wrap });
  bake(renderer, rtC, cloudNode(dirAt(uv()), G, fine), 16);
  // 5) 濃さと勾配を詰める
  const cloud = target(W, H, { wrap });
  bake(renderer, cloud, Fn(() => {
    const cAt = (ox, oy, l) => texture(rtC.texture, uv().add(vec2(ox * tx, oy * ty))).level(l).r;
    const gx = cAt(1.5, 0, 1).sub(cAt(-1.5, 0, 1)).add(cAt(7, 0, 3).sub(cAt(-7, 0, 3)).mul(1.4));
    const gy = cAt(0, 1.5, 1).sub(cAt(0, -1.5, 1)).add(cAt(0, 7, 3).sub(cAt(0, -7, 3)).mul(1.4));
    const s = texture(rtC.texture, uv()).level(0);
    return vec4(s.r, gx.div(cosLat).mul(0.9).add(0.5), gy.mul(0.9).add(0.5), s.g);
  })(), 2);
  rtC.dispose();
  return { surf, aux, cloud, W, H };
}

// =====================================================================
// 描画
// =====================================================================
const BETA = vec3(0.19, 0.44, 1.0);   // 青ほどよく散る（レイリー散乱の比）
const H_ATM = 0.0034;                   // 大気の厚みの目安（半径 1 に対して。実物の約 2.5 倍に誇張）

function planetMat(M, U, uSun, map) {
  const m = new THREE.MeshBasicNodeMaterial();
  m.fog = false;
  m.colorNode = Fn(() => {
    const d = positionLocal.normalize().toVar();
    const L = modelWorldMatrixInverse.mul(vec4(uSun, 0)).xyz.normalize().toVar();
    const C = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1)).xyz.toVar();
    const V = C.sub(d).normalize().toVar();
    const ndl = dot(d, L).toVar(), ndv = dot(d, V).clamp(0.0, 1.0).toVar();
    // 地図の読み方（全球か、窓か）
    let tu, tv, smp, blur;
    if (map.eq) {
      tu = normalize(vec3(d.z, 0, d.x.negate()).add(vec3(1e-5, 0, 0)));
      tv = cross(d, tu);
      const [gx, gy] = eqGrad(d);
      smp = (t, dir) => texture(t, eqUV(dir)).grad(gx, gy);
      blur = (t, dir) => texture(t, eqUV(dir)).grad(gx.mul(10.0), gy.mul(10.0));
    } else {
      const c = vec3(...map.c), e = vec3(...map.e), n = vec3(...map.n);
      tu = normalize(e.sub(d.mul(dot(d, e)))); tv = normalize(n.sub(d.mul(dot(d, n))));
      const puv = (dir) => vec2(dot(dir, e), dot(dir, n)).div(dot(dir, c).max(0.2)).div(2 * map.tanH).add(0.5);
      smp = (t, dir) => texture(t, puv(dir));
      blur = (t, dir) => texture(t, puv(dir)).bias(3.5);
    }
    const Lt = L.sub(d.mul(ndl)).toVar();
    const Le = dot(Lt, tu).toVar(), Ln = dot(Lt, tv).toVar();
    // ---- 地表
    const sf = smp(M.surf.texture, d), ax = smp(M.aux.texture, d);
    const albedo = sf.rgb.mul(sf.rgb), water = sf.a;
    const relief = ax.r.sub(0.5).mul(Le).add(ax.g.sub(0.5).mul(Ln)).mul(U.relief);
    // ---- 雲（視線と太陽の向きに少しずらして、高さの分の視差と影を出す）
    const HC = U.cloudH;
    const dC = rotY(normalize(d.add(V.sub(d.mul(ndv)).mul(HC.div(ndv.max(0.14))))), U.cloud);
    const dS = rotY(normalize(d.add(Lt.mul(HC.mul(1.6).div(ndl.max(0.1))))), U.cloud);
    const cl = smp(M.cloud.texture, dC).toVar();
    const shadow = smoothstep(0.1, 0.62, smp(M.cloud.texture, dS).r).mul(smoothstep(0.0, 0.14, ndl));
    const ca = smoothstep(0.05, 0.8, cl.r).pow(0.75).toVar();        // 雲の不透明度
    const thick = smoothstep(0.3, 0.95, cl.r);
    const bump = cl.r.sub(blur(M.cloud.texture, dC).r).toVar();       // まわりより盛り上がった所は明るい
    // 雲の層は雲と一緒に回るので、勾配の向きも回す（回転は小さいので近似でそのまま使う）
    const cRelief = cl.g.sub(0.5).mul(Le).add(cl.b.sub(0.5).mul(Ln)).mul(U.cloudRelief);
    // ---- 太陽の光（低い太陽ほど赤く）
    const low = smoothstep(0.0, 0.34, ndl).oneMinus();
    const sunCol = exp(BETA.mul(low.mul(low).mul(-3.2)));              // 大気を長く通った光
    const day = smoothstep(-0.08, 0.16, ndl).toVar();
    // 地表
    const litT = ndl.sub(relief).clamp(0, 1.25).mul(smoothstep(-0.02, 0.1, ndl));
    let ground = albedo.mul(litT.mul(1.0).add(day.mul(0.05))).mul(sunCol).mul(shadow.mul(0.72).oneMinus());
    // 海の照り返し（太陽のぎらつき）
    const Hh = normalize(L.add(V));
    const ndh = dot(d, Hh).clamp(0, 1);
    const a2 = U.rough.mul(U.rough).mul(U.rough).mul(U.rough);
    const den = ndh.mul(ndh).mul(a2.sub(1.0)).add(1.0);
    const D = a2.div(den.mul(den).mul(PI));
    const fres = pow(dot(V, Hh).clamp(0, 1).oneMinus(), 5.0).mul(0.98).add(0.02);
    const spec = D.mul(fres).mul(0.25).div(ndv.max(0.12)).mul(water).mul(day).mul(shadow.mul(0.85).oneMinus());
    ground = ground.add(sunCol.mul(spec).mul(U.glint));
    // 空の映り込み（水面は斜めから見ると明るい）
    ground = ground.add(vec3(0.18, 0.3, 0.5).mul(pow(ndv.oneMinus(), 4.0)).mul(water).mul(day).mul(0.35));
    // 雲の色：日の当たる側は白く、影側は青みがかった灰色
    const cLit = ndl.sub(cRelief).add(0.1).clamp(0, 1.2);
    const cShade = mix(vec3(0.34, 0.4, 0.52), vec3(1.0, 0.995, 0.985), smoothstep(0.0, 0.85, cLit.add(bump.mul(U.cloudBump))));
    const cloudCol = cShade.mul(thick.mul(0.24).add(0.76)).mul(bump.mul(U.cloudBump).mul(0.5).add(1.0).clamp(0.7, 1.15)).mul(sunCol.mul(0.85).add(0.15)).mul(smoothstep(-0.1, 0.2, ndl)).mul(U.cloudGain);
    let col = mix(ground, cloudCol, ca);
    // 巻雲（薄い白いベール）
    col = mix(col, vec3(0.96, 0.97, 1.0).mul(sunCol).mul(ndl.clamp(0, 1).mul(0.9).add(0.1)).mul(day), cl.a.mul(0.45));
    // ---- 大気：視線が通る空気の量だけ、地表が青くかすむ
    const path = float(1.0).div(ndv.add(U.graze));
    const tau = BETA.mul(path.mul(U.tau));
    const sunVis = smoothstep(-0.16, 0.2, ndl);
    const skyCol = vec3(0.4, 0.6, 1.0).mul(sunCol.mul(0.7).add(0.3)).mul(sunVis).mul(U.sky);
    col = col.mul(exp(tau.mul(-0.55))).add(skyCol.mul(exp(tau.negate()).oneMinus()));
    // ---- 夜：街あかりと、ほのかな雲
    const night = smoothstep(-0.14, 0.02, ndl).oneMinus();
    col = col.add(vec3(1.0, 0.72, 0.38).mul(ax.b).mul(night).mul(ca.mul(0.92).oneMinus()).mul(U.night).mul(1.6));
    col = col.add(vec3(0.012, 0.017, 0.028).mul(ca.mul(0.8).add(0.08)).mul(night));
    return col;
  })();
  return m;
}

/** 大気の縁：惑星の外側で、視線が大気をかすめる高さから光り方を決める */
function shellMat(U, uSun) {
  const m = new THREE.MeshBasicNodeMaterial();
  m.transparent = true; m.depthWrite = false; m.blending = THREE.AdditiveBlending; m.fog = false;
  m.colorNode = Fn(() => {
    const L = modelWorldMatrixInverse.mul(vec4(uSun, 0)).xyz.normalize();
    const C = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1)).xyz.toVar();
    const v = positionLocal.sub(C).normalize().toVar();
    const tca = dot(C, v).negate().toVar();
    const P = C.add(v.mul(tca)).toVar();                    // 視線がいちばん地球に近づく点
    const b = P.length();
    const h = b.sub(1.0).toVar();                            // その点の高さ
    const nt = P.div(b.max(1e-4));
    const ndl = dot(nt, L).toVar();
    const dens = exp(h.max(0).div(H_ATM).negate()).toVar();
    const tau = BETA.mul(dens.mul(U.tauLimb));
    const low = smoothstep(0.0, 0.34, ndl).oneMinus();
    const sunCol = exp(BETA.mul(low.mul(low).mul(dens.mul(0.8).add(0.2)).mul(-4.5)));   // 夕焼けの層：低いほど赤い
    const sunVis = smoothstep(-0.2, 0.16, ndl);
    let col = exp(tau.negate()).oneMinus().mul(vec3(0.42, 0.62, 1.0)).mul(sunCol).mul(sunVis).mul(U.sky).mul(1.08);
    // 太陽が縁の向こうにあるときの強い前方散乱
    col = col.add(vec3(1.0, 0.75, 0.5).mul(pow(dot(v, L).clamp(0, 1), 24.0)).mul(dens).mul(smoothstep(-0.3, 0.0, ndl)).mul(0.9));
    // 夜の縁：大気光の細い緑の線
    const ag = exp(h.sub(0.0165).div(0.0032).pow(2).negate()).mul(0.02).add(exp(h.max(0).div(0.006).negate()).mul(0.006));
    col = col.add(vec3(0.45, 1.0, 0.5).mul(ag).mul(sunVis.oneMinus()).mul(U.night));
    return col.mul(smoothstep(-0.0015, 0.0005, h));
  })();
  return m;
}

/**
 * 地球。半径 1。uSun は「太陽の方向」（ワールド）。
 * opts.near = { lat, lon, half }：低い軌道の場面で使う高精細な窓（中心の緯度経度と半角°）
 */
export function makeEarth(uSun, renderer, opts = {}) {
  const hi = !!opts.hi;
  const g = grp();
  const U = {
    cloud: uniform(0), night: uniform(1), detail: uniform(1),
    relief: uniform(1.5), cloudRelief: uniform(1.5), cloudH: uniform(0.0022), cloudGain: uniform(1.0), cloudBump: uniform(1.6), rough: uniform(0.34), glint: uniform(6.0),
    tau: uniform(0.095), graze: uniform(0.045), sky: uniform(1.0), tauLimb: uniform(5.5),
  };
  const G = drawGeo();
  const t0 = performance.now();
  const far = bakeMaps(renderer, G, { eq: true }, hi ? 4096 : 2048, hi ? 2048 : 1024);
  const planet = new THREE.Mesh(new THREE.SphereGeometry(1, 256, 128), planetMat(far, U, uSun, { eq: true }));
  planet.castShadow = false; planet.receiveShadow = false;
  g.add(planet);
  let planetNear = null, nearMap = null;
  if (opts.near) {
    const c = latLonDir(opts.near.lat, opts.near.lon);
    const e = new THREE.Vector3(0, 1, 0).cross(c).normalize();   // 東
    const n = c.clone().cross(e);                                  // 北
    nearMap = { c: c.toArray(), e: e.toArray(), n: n.toArray(), tanH: Math.tan((opts.near.half ?? 34) / DEG) };
    const N = hi ? 4096 : 2048;
    const near = bakeMaps(renderer, G, nearMap, N, N);
    const Un = { ...U, relief: uniform(2.2), cloudRelief: uniform(2.4), cloudH: uniform(0.0016), cloudBump: uniform(2.4) };
    planetNear = new THREE.Mesh(new THREE.SphereGeometry(1, 384, 192), planetMat(near, Un, uSun, nearMap));
    planetNear.castShadow = false; planetNear.receiveShadow = false; planetNear.visible = false;
    g.add(planetNear);
    g.userData.Un = Un; g.userData.near = near;
  }
  for (const k of ['geo1', 'geo2', 'geo3']) G[k].dispose();
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(1 + H_ATM * 8, 192, 96), shellMat(U, uSun));
  atmo.castShadow = false; atmo.receiveShadow = false; atmo.renderOrder = 2; atmo.layers.set(1);
  g.add(atmo);
  g.userData.U = U; g.userData.planet = planet; g.userData.far = far; g.userData.bakeMs = performance.now() - t0;
  g.userData.nearCenter = opts.near ? latLonDir(opts.near.lat, opts.near.lon) : null;
  /** 低い軌道用の高精細な窓に切り替える */
  g.userData.setNear = (on) => { const n = !!on && !!planetNear; planet.visible = !n; if (planetNear) planetNear.visible = n; };
  return g;
}

/** 確認用：焼いた地図を画像にして保存する（開発サーバーのときだけ使う） */
export async function dumpEarth(renderer, g, name = 'earth') {
  const save = async (rt, tag, fn) => {
    const px = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, rt.width, rt.height);
    const img = new ImageData(new Uint8ClampedArray(px.buffer, px.byteOffset, rt.width * rt.height * 4), rt.width, rt.height);
    fn(img.data);
    const c = document.createElement('canvas'); c.width = rt.width; c.height = rt.height; c.getContext('2d').putImageData(img, 0, 0);
    const o = document.createElement('canvas'); o.width = 2048; o.height = Math.round(2048 * rt.height / rt.width); const oc = o.getContext('2d'); oc.translate(0, o.height); oc.scale(1, -1); oc.drawImage(c, 0, 0, o.width, o.height);
    const blob = await new Promise((r) => o.toBlob(r, 'image/jpeg', 0.9));
    await fetch(`/__save?name=${name}_${tag}.jpg`, { method: 'POST', body: blob });
  };
  for (const [M, t] of [[g.userData.far, 'far'], [g.userData.near, 'near']]) {
    if (!M) continue;
    await save(M.surf, t + '_surf', (a) => { for (let i = 3; i < a.length; i += 4) a[i] = 255; });
    await save(M.cloud, t + '_cloud', (a) => { for (let i = 0; i < a.length; i += 4) { a[i + 1] = a[i + 2] = a[i]; a[i + 3] = 255; } });
    await save(M.aux, t + '_aux', (a) => { for (let i = 3; i < a.length; i += 4) a[i] = 255; });
  }
  return { ms: g.userData.bakeMs };
}

const _n = new THREE.Vector3(), _f = new THREE.Vector3(), _a = new THREE.Vector3(), _fa = new THREE.Vector3(), _e = new THREE.Vector3(), _mw = new THREE.Matrix4(), _ml = new THREE.Matrix4(), _hq = new THREE.Quaternion();
/**
 * 地球の向きを「カメラから見て」決める。緯度経度 (lat, lon) の地点を、カメラの真下から前方へ ahead° 進んだ所に置く。
 * heading = 画面の奥が向く方位（0 = 北、90 = 東）。
 */
export function faceEarth(earth, camera, lat, lon, ahead = 0, heading = 0) {
  _n.copy(camera.position).sub(earth.position).normalize();
  camera.getWorldDirection(_f); _f.addScaledVector(_n, -_f.dot(_n)).normalize();
  const A = ahead / DEG;
  _a.copy(_n).multiplyScalar(Math.cos(A)).addScaledVector(_f, Math.sin(A));
  _fa.copy(_n).multiplyScalar(-Math.sin(A)).addScaledVector(_f, Math.cos(A));
  _e.crossVectors(_fa, _a);
  if (heading) { _hq.setFromAxisAngle(_a, heading / DEG); _fa.applyQuaternion(_hq); _e.applyQuaternion(_hq); }
  const c = latLonDir(lat, lon), el = new THREE.Vector3(0, 1, 0).cross(c).normalize(), nl = c.clone().cross(el);
  _mw.makeBasis(_e, _fa, _a); _ml.makeBasis(el, nl, c);
  earth.quaternion.setFromRotationMatrix(_mw.multiply(_ml.transpose()));
}

const _u = new THREE.Vector3();
/** 遠くの地球：緯度経度 (lat, lon) の地点をカメラへ向け、北を画面の上から roll° 傾ける */
export function showEarth(earth, camera, lat, lon, roll = 0) {
  _n.copy(camera.position).sub(earth.position).normalize();
  _u.set(0, 1, 0).applyQuaternion(camera.quaternion); _u.addScaledVector(_n, -_u.dot(_n)).normalize();
  if (roll) _u.applyQuaternion(_hq.setFromAxisAngle(_n, roll / DEG));
  _e.crossVectors(_u, _n);
  const c = latLonDir(lat, lon), el = new THREE.Vector3(0, 1, 0).cross(c).normalize(), nl = c.clone().cross(el);
  _mw.makeBasis(_e, _u, _n); _ml.makeBasis(el, nl, c);
  earth.quaternion.setFromRotationMatrix(_mw.multiply(_ml.transpose()));
}
