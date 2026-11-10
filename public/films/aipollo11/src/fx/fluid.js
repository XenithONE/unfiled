// 煙と炎の流体シミュレーション（GPU の計算シェーダー・3 次元の格子）
//   1 歩 = 移流（半ラグランジュ）→ 浮力・乱れ・噴射 → 発散 → 圧力（ヤコビ反復）→ 圧力こう配を引く（非圧縮）
//   描画 = 体積のレイマーチ（太陽と炎の光は、光の透過率を別の格子に焼いて読む）
import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, Break, uniform, instanceIndex, textureStore, texture3D, float, int, uint, vec3, vec4, ivec3, uvec3,
  max, min, abs, dot, normalize, length, exp, mix, clamp, smoothstep, select, pow,
  mx_noise_float, mx_worley_noise_float, positionWorld, positionView, cameraPosition, screenUV, screenSize, viewportDepthTexture, perspectiveDepthToViewZ,
  cameraNear, cameraFar, interleavedGradientNoise,
} from 'three/tsl';

function tex3(nx, ny, nz, name) {
  const t = new THREE.Storage3DTexture(nx, ny, nz);
  t.name = name; t.type = THREE.HalfFloatType; t.format = THREE.RGBAFormat;
  t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
  return t;
}

export class Fluid {
  /**
   * o: { n:[nx,ny,nz], origin:[x,y,z]（箱の最小の角）, size:[sx,sy,sz]（m）, jacobi, albedo, sigma, solid:(p格子)=>ノード }
   */
  constructor(renderer, o) {
    this.renderer = renderer;
    const [nx, ny, nz] = (this.n = o.n);
    this.origin = o.origin; this.size = o.size;
    const h = (this.h = o.size[0] / nx);          // 1 マスの大きさ（m）
    this.jacobi = o.jacobi ?? 20;
    this.dt = 1 / 60; this.tau = 0; this.steps = 0;
    const count = nx * ny * nz;
    const V0 = tex3(nx, ny, nz, 'fluid.V0'), V1 = tex3(nx, ny, nz, 'fluid.V1');
    const T0 = tex3(nx, ny, nz, 'fluid.T0'), T1 = tex3(nx, ny, nz, 'fluid.T1');
    const P0 = tex3(nx, ny, nz, 'fluid.P0'), P1 = tex3(nx, ny, nz, 'fluid.P1');
    const DV = tex3(nx, ny, nz, 'fluid.DV');
    const CW = tex3(nx, ny, nz, 'fluid.CW');
    const lx = Math.ceil(nx / 2), ly = Math.ceil(ny / 2), lz = Math.ceil(nz / 2);
    const LT = tex3(lx, ly, lz, 'fluid.L');
    this.tex = { V0, V1, T0, T1, P0, P1, DV, CW, LT };

    const U = (this.U = {
      dt: uniform(this.dt), time: uniform(0),
      srcPos: uniform(new THREE.Vector3()), srcVel: uniform(new THREE.Vector3()), srcR: uniform(2), srcOn: uniform(0), srcDens: uniform(0), srcHeat: uniform(0),
      src2Pos: uniform(new THREE.Vector3()), src2R: uniform(2), src2On: uniform(0), src2Push: uniform(0), src2Dens: uniform(0), src2Heat: uniform(0),
      vort: uniform(o.vort ?? 0.45), buoy: uniform(o.buoy ?? 3.2), weight: uniform(o.weight ?? 0.35), turb: uniform(o.turb ?? 9), densKeep: uniform(1), tempKeep: uniform(1), velKeep: uniform(1),
      sunDir: uniform(new THREE.Vector3(0.4, 0.8, 0.4)), sunCol: uniform(new THREE.Color(1, 1, 1)), ambCol: uniform(new THREE.Color(0.4, 0.5, 0.7)),
      flameCol: uniform(new THREE.Color(1, 0.55, 0.2)), flamePos: uniform(new THREE.Vector3()), flameI: uniform(0),
      albedo: uniform(new THREE.Color(o.albedo ?? 0xf2f0ec)), sigma: uniform(o.sigma ?? 0.9), glow: uniform(o.glow ?? 6), frame: uniform(0),
      b0: uniform(new THREE.Vector3(...o.origin)), bs: uniform(new THREE.Vector3(...o.size)), shadowK: uniform(o.shadowK ?? 1.0), detail: uniform(o.detail ?? 0.55), detailScale: uniform(o.detailScale ?? 0.16), edge0: uniform(o.edge0 ?? 0.02), edge1: uniform(o.edge1 ?? 0.38), dmax: uniform(o.dmax ?? 1.3),
    });
    const N = vec3(nx, ny, nz), invN = vec3(1 / nx, 1 / ny, 1 / nz);
    const coordsOf = (i) => uvec3(i.mod(uint(nx)), i.div(uint(nx)).mod(uint(ny)), i.div(uint(nx * ny)));
    const cl = (c) => clamp(c, ivec3(0, 0, 0), ivec3(nx - 1, ny - 1, nz - 1));
    const solidW = o.solid || null;      // 世界座標（m）を受け取り、固体なら 1 を返す関数
    const solid = (p) => (solidW ? solidW(p.mul(h).add(vec3(o.origin[0], o.origin[1], o.origin[2]))) : float(0));
    const CWn = texture3D(CW);
    const V0n = texture3D(V0), V1n = texture3D(V1), T0n = texture3D(T0), T1n = texture3D(T1), P0n = texture3D(P0), P1n = texture3D(P1), DVn = texture3D(DV), LTn = texture3D(LT);

    // ---- 初期化
    this.kClear = Fn(() => {
      const c = coordsOf(instanceIndex);
      textureStore(V0, c, vec4(0)); textureStore(T0, c, vec4(0)); textureStore(P0, c, vec4(0)); textureStore(P1, c, vec4(0));
    })().compute(count).setName('fluid.clear');

    // ---- 渦度（回転の強さ）
    this.kCurl = Fn(() => {
      const c = coordsOf(instanceIndex).toConst();
      const L = (dx, dy, dz) => V0n.load(cl(ivec3(c).add(ivec3(dx, dy, dz)))).xyz;
      const xp = L(1, 0, 0), xm = L(-1, 0, 0), yp = L(0, 1, 0), ym = L(0, -1, 0), zp = L(0, 0, 1), zm = L(0, 0, -1);
      const w = vec3(yp.z.sub(ym.z).sub(zp.y.sub(zm.y)), zp.x.sub(zm.x).sub(xp.z.sub(xm.z)), xp.y.sub(xm.y).sub(yp.x.sub(ym.x))).mul(0.5);
      textureStore(CW, c, vec4(w, length(w)));
    })().compute(count).setName('fluid.curl');

    // ---- 移流と力
    this.kAdvect = Fn(() => {
      const c = coordsOf(instanceIndex).toConst();
      const p = vec3(c).add(0.5).toConst();
      const v0 = V0n.load(ivec3(c)).xyz;
      const uvw = p.sub(v0.mul(U.dt)).mul(invN);
      const s = V0n.sample(uvw).level(0).toConst();
      const tt = T0n.sample(uvw).level(0).toConst();
      const vel = s.xyz.mul(U.velKeep).toVar();
      const dens = s.w.mul(U.densKeep).toVar();
      const temp = tt.x.mul(U.tempKeep).toVar();
      // 浮力（熱い気体は上へ・濃い煙はわずかに重い）
      const lift = temp.mul(U.buoy).sub(dens.mul(U.weight)).mul(U.dt);
      // 乱れ（細かな渦のきっかけ）
      const np = p.mul(0.085).add(vec3(0.0, U.time.mul(0.5), 0.0));
      const tf = vec3(mx_noise_float(np), mx_noise_float(np.add(31.4)), mx_noise_float(np.add(77.7))).mul(U.turb).mul(dens.clamp(0, 1)).mul(U.dt);
      // 渦の閉じ込め
      const wc = CWn.load(ivec3(c));
      const M = (dx, dy, dz) => CWn.load(cl(ivec3(c).add(ivec3(dx, dy, dz)))).w;
      const gw = vec3(M(1, 0, 0).sub(M(-1, 0, 0)), M(0, 1, 0).sub(M(0, -1, 0)), M(0, 0, 1).sub(M(0, 0, -1))).mul(0.5);
      const nn = gw.div(length(gw).add(0.0001));
      const conf = nn.cross(wc.xyz).mul(U.vort).mul(U.dt);
      vel.assign(vec3(vel.x.add(tf.x).add(conf.x), vel.y.add(lift).add(tf.y).add(conf.y), vel.z.add(tf.z).add(conf.z)));
      // 噴射口（エンジン）：速度を上書きし、煙と熱を足す
      const d1 = p.sub(U.srcPos);
      const w1 = smoothstep(U.srcR.mul(0.45), U.srcR, length(d1.mul(vec3(1.0, 0.55, 1.0)))).oneMinus().mul(U.srcOn);
      const jit = vec3(mx_noise_float(p.mul(0.9).add(U.time.mul(13.0))), 0.0, mx_noise_float(p.mul(0.9).add(U.time.mul(11.0)).add(9.0))).mul(length(U.srcVel).mul(0.22));
      vel.assign(mix(vel, U.srcVel.add(jit), w1));
      dens.addAssign(w1.mul(U.srcDens).mul(U.dt));
      temp.assign(max(temp, w1.mul(U.srcHeat)));
      // 爆発などの「ふくらむ」源
      const d2 = p.sub(U.src2Pos);
      const r2 = length(d2);
      const w2 = smoothstep(U.src2R.mul(0.3), U.src2R, r2).oneMinus().mul(U.src2On);
      vel.addAssign(normalize(d2.add(vec3(0.0001))).mul(w2).mul(U.src2Push).mul(U.dt));
      dens.addAssign(w2.mul(U.src2Dens).mul(U.dt));
      temp.assign(max(temp, w2.mul(U.src2Heat)));
      // 床・固体・箱のふち
      const onFloor = c.y.equal(uint(0));
      vel.assign(vec3(vel.x.mul(select(onFloor, 0.93, 1.0)), select(onFloor, max(vel.y, 0.0), vel.y), vel.z.mul(select(onFloor, 0.93, 1.0))));
      vel.mulAssign(solid(p).oneMinus());
      const edge = min(min(p.x, N.x.sub(p.x)), min(min(p.z, N.z.sub(p.z)), N.y.sub(p.y)));
      dens.mulAssign(mix(0.9, 1.0, smoothstep(0.0, 7.0, edge)));
      textureStore(V1, c, vec4(vel, dens.clamp(0, 6)));
      textureStore(T1, c, vec4(temp.clamp(0, 4), 0, 0, 0));
    })().compute(count).setName('fluid.advect');

    // ---- 発散
    const velAt = (tex, c, dx, dy, dz) => tex.load(cl(ivec3(c).add(ivec3(dx, dy, dz)))).xyz;
    this.kDiv = Fn(() => {
      const c = coordsOf(instanceIndex).toConst();
      const vc = V1n.load(ivec3(c)).xyz.toConst();
      const xr = velAt(V1n, c, 1, 0, 0).x, xl = velAt(V1n, c, -1, 0, 0).x;
      const yu = velAt(V1n, c, 0, 1, 0).y;
      const yd = select(c.y.equal(uint(0)), vc.y.negate(), velAt(V1n, c, 0, -1, 0).y);
      const zf = velAt(V1n, c, 0, 0, 1).z, zb = velAt(V1n, c, 0, 0, -1).z;
      textureStore(DV, c, vec4(xr.sub(xl).add(yu.sub(yd)).add(zf.sub(zb)).mul(0.5), 0, 0, 0));
    })().compute(count).setName('fluid.div');

    // ---- 圧力（ヤコビ反復）。横と上は開いた境界（圧力 0）、床は壁（こう配 0）
    const pAt = (tex, c, pc, dx, dy, dz) => {
      const q = ivec3(c).add(ivec3(dx, dy, dz));
      const out = q.x.lessThan(0).or(q.x.greaterThanEqual(nx)).or(q.z.lessThan(0)).or(q.z.greaterThanEqual(nz)).or(q.y.greaterThanEqual(ny));
      return select(q.y.lessThan(0), pc, select(out, float(0), tex.load(cl(q)).x));
    };
    const mkJacobi = (src, dst, name) => Fn(() => {
      const c = coordsOf(instanceIndex).toConst();
      const pc = src.load(ivec3(c)).x.toConst();
      const sum = pAt(src, c, pc, 1, 0, 0).add(pAt(src, c, pc, -1, 0, 0)).add(pAt(src, c, pc, 0, 1, 0)).add(pAt(src, c, pc, 0, -1, 0)).add(pAt(src, c, pc, 0, 0, 1)).add(pAt(src, c, pc, 0, 0, -1));
      textureStore(dst, c, vec4(sum.sub(DVn.load(ivec3(c)).x).div(6.0), 0, 0, 0));
    })().compute(count).setName(name);
    this.kJacA = mkJacobi(P0n, P1, 'fluid.jacobiA');
    this.kJacB = mkJacobi(P1n, P0, 'fluid.jacobiB');

    // ---- 圧力こう配を引いて、非圧縮の流れにする
    this.kProject = Fn(() => {
      const c = coordsOf(instanceIndex).toConst();
      const pc = P0n.load(ivec3(c)).x.toConst();
      const g = vec3(
        pAt(P0n, c, pc, 1, 0, 0).sub(pAt(P0n, c, pc, -1, 0, 0)),
        pAt(P0n, c, pc, 0, 1, 0).sub(pAt(P0n, c, pc, 0, -1, 0)),
        pAt(P0n, c, pc, 0, 0, 1).sub(pAt(P0n, c, pc, 0, 0, -1)),
      ).mul(0.5);
      const s = V1n.load(ivec3(c)).toConst();
      const p = vec3(c).add(0.5);
      const v = s.xyz.sub(g).mul(solid(p).oneMinus()).toVar();
      v.assign(vec3(v.x, select(c.y.equal(uint(0)), max(v.y, 0.0), v.y), v.z));
      textureStore(V0, c, vec4(v, s.w));
      textureStore(T0, c, T1n.load(ivec3(c)));
    })().compute(count).setName('fluid.project');

    // ---- 光の焼き込み（半分の解像度）：太陽への透過率・炎からの光・空の見え具合
    const lcount = lx * ly * lz;
    const lcoords = (i) => uvec3(i.mod(uint(lx)), i.div(uint(lx)).mod(uint(ly)), i.div(uint(lx * ly)));
    this.kLight = Fn(() => {
      const c = lcoords(instanceIndex).toConst();
      const p = vec3(c).add(0.5).mul(2.0).toConst();       // 元の格子の座標
      const sd = normalize(U.sunDir);
      const acc = float(0).toVar();
      Loop(18, ({ i }) => { acc.addAssign(V0n.sample(p.add(sd.mul(float(i).add(0.6).mul(2.4))).mul(invN)).level(0).w); });
      const sunT = exp(acc.mul(2.4).mul(U.shadowK).negate());
      const up = float(0).toVar();
      Loop(6, ({ i }) => { up.addAssign(V0n.sample(p.add(vec3(0, 1, 0).mul(float(i).add(0.6).mul(3.0))).mul(invN)).level(0).w); });
      const ambT = exp(up.mul(3.0).mul(U.shadowK).mul(0.6).negate());
      const toF = U.flamePos.sub(p);
      const dist = length(toF);
      const fd = toF.div(max(dist, 0.001));
      const facc = float(0).toVar();
      const stepF = min(dist, 22.0).div(8.0);
      Loop(8, ({ i }) => { facc.addAssign(V0n.sample(p.add(fd.mul(float(i).add(0.5).mul(stepF))).mul(invN)).level(0).w); });
      const flame = exp(facc.mul(stepF).mul(U.shadowK).mul(0.7).negate()).div(dist.mul(dist).mul(0.012).add(1.0));
      textureStore(LT, c, vec4(sunT, flame, ambT, 0));
    })().compute(lcount).setName('fluid.light');

    // ---- 体積の描画（箱の裏面でレイマーチ）
    const m = new THREE.MeshBasicNodeMaterial();
    m.side = THREE.BackSide; m.transparent = true; m.depthWrite = false; m.depthTest = false; m.fog = false;
    const STEPS = o.marchSteps ?? 200, COARSE = o.coarse ?? 56;
    m.colorNode = Fn(() => {
      const ro = cameraPosition;
      const rd = normalize(positionWorld.sub(cameraPosition)).toConst();
      const inv = vec3(1.0).div(rd);
      const b1 = U.b0.add(U.bs);
      const ta = U.b0.sub(ro).mul(inv), tb = b1.sub(ro).mul(inv);
      const tmn = min(ta, tb), tmx = max(ta, tb);
      const tN = max(max(tmn.x, tmn.y), max(tmn.z, 0.0));
      const tF = min(min(tmx.x, tmx.y), tmx.z);
      const sceneZ = perspectiveDepthToViewZ(viewportDepthTexture(), cameraNear, cameraFar);
      const rdv = normalize(positionView);
      const tEnd = min(tF, sceneZ.div(rdv.z)).toConst();
      // 空っぽの所は大股、煙に入ったら 1 歩もどって小股で進む（ふちの縞・点描を消す）
      const dsC = float(h * 0.95).toConst();
      const dsF = float(h * 0.42);
      const ds = dsC.toVar();
      const fine = float(0.0).toVar();
      const empty = float(0.0).toVar();
      const sp = screenUV.mul(screenSize).add(U.frame.mul(vec3(17.13, 31.77, 0.0).xy));
      const jit = sp.x.mul(12.9898).add(sp.y.mul(78.233)).sin().mul(43758.5453).fract();
      const t = tN.add(dsC.mul(jit)).toVar();
      const T = float(1.0).toVar();
      const C = vec3(0.0).toVar();
      const sd = normalize(U.sunDir);
      const mu = dot(rd, sd).max(0.0);
      const phase = pow(mu, 8.0).mul(1.4).add(0.62);
      Loop(STEPS, () => {
        If(t.greaterThan(tEnd).or(T.lessThan(0.012)), () => { Break(); });
        const pw = ro.add(rd.mul(t));
        const uvw = pw.sub(U.b0).div(U.bs);
        const s = V0n.sample(uvw).level(0);
        const dens = s.w.toVar();
        If(dens.greaterThan(0.0015), () => {
          If(fine.lessThan(0.5), () => {
            t.subAssign(ds); ds.assign(dsF); fine.assign(1.0); empty.assign(0.0);
          }).Else(() => {
            empty.assign(0.0);
            // 細部：流れに沿って動く雑音で、ふちをほぐす
            const q = pw.mul(U.detailScale).sub(s.xyz.mul(0.02));
            const w1 = mx_worley_noise_float(q), w2 = mx_worley_noise_float(q.mul(2.6).add(7.0)), w3 = mx_worley_noise_float(q.mul(6.3).add(19.0));
            const billow = w1.mul(0.5).add(w2.mul(0.32)).add(w3.mul(0.18));
            dens.assign(smoothstep(U.edge0, U.edge1, dens.mul(billow.mul(U.detail).mul(2.0).oneMinus().add(U.detail.mul(0.9)).clamp(0.0, 1.6))).mul(U.dmax));
            const L = LTn.sample(uvw).level(0);
            const heat = T0n.sample(uvw).level(0).x;
            dens.mulAssign(smoothstep(0.35, 1.3, heat).mul(0.82).oneMinus());
            const light = U.sunCol.mul(L.x).mul(phase).add(U.ambCol.mul(L.z.mul(0.75).add(0.25))).add(U.flameCol.mul(L.y).mul(U.flameI));
            const fire = mix(vec3(1.0, 0.3, 0.05), vec3(1.0, 0.86, 0.55), smoothstep(0.35, 1.3, heat)).mul(heat.mul(heat)).mul(U.glow);
            const a = exp(dens.mul(U.sigma).mul(ds).negate()).oneMinus();
            C.addAssign(U.albedo.mul(light).add(fire).mul(a).mul(T));
            T.mulAssign(a.oneMinus());
          });
        }).Else(() => {
          If(fine.greaterThan(0.5), () => {
            empty.addAssign(1.0);
            If(empty.greaterThan(14.0), () => { ds.assign(dsC); fine.assign(0.0); });
          });
        });
        t.addAssign(ds);
      });
      const alpha = T.oneMinus();
      return vec4(C.div(max(alpha, 0.0001)), alpha);
    })();
    const mesh = (this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m));
    mesh.position.set(o.origin[0] + o.size[0] / 2, o.origin[1] + o.size[1] / 2, o.origin[2] + o.size[2] / 2);
    mesh.scale.set(o.size[0], o.size[1], o.size[2]);
    mesh.frustumCulled = false; mesh.renderOrder = 50; mesh.visible = false; mesh.layers.set(1);
    mesh.castShadow = false; mesh.receiveShadow = false;
    this.source = null;        // (tau) => { pos:[世界], vel:[m/s], r, on, dens, heat, flameI, src2: {...} }
    this._dirty = true;
  }

  /** 世界の座標 → 格子の座標 */
  toGrid(p) { return [(p[0] - this.origin[0]) / this.h, (p[1] - this.origin[1]) / this.h, (p[2] - this.origin[2]) / this.h]; }

  reset() {
    this.renderer.compute(this.kClear);
    this.tau = 0; this.steps = 0; this._dirty = true;
  }

  _apply(tau) {
    const U = this.U, s = this.source ? this.source(tau) : null;
    U.time.value = tau;
    if (!s) { U.srcOn.value = 0; U.src2On.value = 0; U.flameI.value = 0; return; }
    const g = this.toGrid(s.pos || [0, 0, 0]);
    U.srcPos.value.set(g[0], g[1], g[2]);
    const v = s.vel || [0, 0, 0];
    U.srcVel.value.set(v[0] / this.h, v[1] / this.h, v[2] / this.h);
    U.srcR.value = (s.r ?? 2) / this.h; U.srcOn.value = s.on ?? 0; U.srcDens.value = s.dens ?? 0; U.srcHeat.value = s.heat ?? 0;
    U.flamePos.value.set(g[0], g[1], g[2]); U.flameI.value = s.flameI ?? 0;
    const b = s.src2;
    if (b) { const g2 = this.toGrid(b.pos); U.src2Pos.value.set(g2[0], g2[1], g2[2]); U.src2R.value = b.r / this.h; U.src2On.value = b.on ?? 0; U.src2Push.value = (b.push ?? 0) / this.h; U.src2Dens.value = b.dens ?? 0; U.src2Heat.value = b.heat ?? 0; if (b.flameI !== undefined) { U.flamePos.value.set(g2[0], g2[1], g2[2]); U.flameI.value = b.flameI; } }
    else U.src2On.value = 0;
    U.densKeep.value = Math.exp(-(s.densFade ?? 0.02) * this.dt);
    U.tempKeep.value = Math.exp(-(s.tempFade ?? 1.1) * this.dt);
    U.velKeep.value = Math.exp(-(s.velFade ?? 0.12) * this.dt);
  }

  step() {
    const r = this.renderer;
    this._apply(this.tau);
    r.compute(this.kCurl);
    r.compute(this.kAdvect);
    r.compute(this.kDiv);
    for (let i = 0; i < this.jacobi / 2; i++) { r.compute(this.kJacA); r.compute(this.kJacB); }
    r.compute(this.kProject);
    this.tau += this.dt; this.steps++; this._dirty = true;
  }

  /** 時刻 tau（秒）まで進める。戻るときは最初からやり直す。 */
  seek(tau) {
    if (tau < this.tau - 1e-4) this.reset();
    let n = Math.round((tau - this.tau) / this.dt);
    while (n-- > 0) this.step();
  }

  /** 表示する（光を焼き直す）。light: { sunDir, sunCol, ambCol } */
  show(light = {}, frame = 0) {
    const U = this.U;
    if (light.sunDir) U.sunDir.value.set(light.sunDir[0], light.sunDir[1], light.sunDir[2]);
    if (light.sunCol) U.sunCol.value.copy(light.sunCol);
    if (light.ambCol) U.ambCol.value.copy(light.ambCol);
    U.frame.value = frame % 64;
    this._apply(Math.max(0, this.tau - this.dt));
    if (this._dirty) { this.renderer.compute(this.kLight); this._dirty = false; }
    this.mesh.visible = true;
  }
}
