// 描画エンジン：WebGPU レンダラ・後処理（TSL）・文字の重ね描き・コマの読み出し
//   後処理の流れ： 下描き（法線と深度）→ 接地の陰（GTAO）→ 本描き → 被写界深度 → 光のにじみ
//                  → 光の筋（光芒）・横に伸びる光 → フィルム調の階調（ACES）と色づくり → レンズ（色ずれ・周辺減光・粒子）→ 文字
import * as THREE from 'three/webgpu';
import {
  pass, mrt, normalView, uniform, texture, screenUV, vec2, vec3, vec4, float, Fn, mix, renderOutput,
  smoothstep, sin, fract, dot, floor, length, max, abs, step, clamp, pow, convertToTexture, builtinAOContext,
  Loop, If, exp, cameraNear, cameraFar, perspectiveDepthToViewZ,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';

export const FILM_W = 1920, FILM_H = 1080;
/** 透明・加算の物（炎・煙・光・ヘルメットのガラスなど）はこの層に置き、下描きから外す */
export const FX_LAYER = 1;
export function fxLayer(obj) { obj.traverse((o) => o.layers.set(FX_LAYER)); return obj; }

export class Engine {
  async init(canvas) {
    this.canvas = canvas;
    const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    await renderer.init();
    this.renderer = renderer;
    this.isWebGPU = !!(renderer.backend && renderer.backend.isWebGPUBackend);
    renderer.setPixelRatio(1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.scene.fog = new THREE.FogExp2(0xffffff, 0);
    this.camera = new THREE.PerspectiveCamera(35, FILM_W / FILM_H, 0.1, 4000);
    this.camera.position.set(0, 2, 10);
    this.camera.layers.enable(FX_LAYER);

    // 文字の重ね描き用の 2D キャンバス（1920x1080 固定）
    this.ovCanvas = document.createElement('canvas');
    this.ovCanvas.width = FILM_W; this.ovCanvas.height = FILM_H;
    this.ovCtx = this.ovCanvas.getContext('2d');
    this.ovTex = new THREE.CanvasTexture(this.ovCanvas);
    this.ovTex.colorSpace = THREE.NoColorSpace;
    this.ovTex.generateMipmaps = false;
    this.ovTex.minFilter = THREE.LinearFilter; this.ovTex.magFilter = THREE.LinearFilter;
    this._ovSig = ''; this._ovCmds = [];

    // 後処理のつまみ
    const P = this.post = {
      fade: uniform(0), fadeColor: uniform(new THREE.Color(0, 0, 0)), flash: uniform(0),
      bars: uniform(0), tv: uniform(0), vignette: uniform(0.3), grain: uniform(0.028),
      frame: uniform(0), time: uniform(0), saturation: uniform(1.0), tint: uniform(new THREE.Color(1, 1, 1)),
      chroma: uniform(0.0012), contrast: uniform(1.0),
      focus: uniform(10), focal: uniform(1e6), bokeh: uniform(0),
      // 光の筋：強さ・光源の画面位置・光源の近くだけ拾う絞り・「空」とみなす距離
      rays: uniform(0), rayUV: uniform(new THREE.Vector2(0.5, 0.3)), rayFall: uniform(2.2), rayNear: uniform(700), rayClamp: uniform(3.5),
      // 横に伸びる光（アナモルフィックレンズふう）と、にじみの色
      streak: uniform(0), halo: uniform(new THREE.Color(1, 0.94, 0.88)),
      // 色づくり：暗部に足す色・明部に掛ける色・中間の持ち上げ（1/γ）
      lift: uniform(new THREE.Color(0, 0, 0)), gain: uniform(new THREE.Color(1, 1, 1)), gammaInv: uniform(new THREE.Color(1, 1, 1)),
    };
    const HI = new URLSearchParams(location.search).get('q') === 'high';

    const scene = this.scene, camera = this.camera;
    // ---- 下描き：不透明な物だけの法線と深度 → 接地の陰
    //      （本描きの最中に呼ばれるので、描画リストがぶつからないよう専用のカメラを使う）
    const preCamera = (this.preCamera = camera.clone());
    const prePass = pass(scene, preCamera);
    prePass.setMRT(mrt({ output: normalView }));
    const opaqueOnly = new THREE.Layers(); opaqueOnly.set(0);
    prePass.setLayers(opaqueOnly);
    const aoPass = ao(prePass.getTextureNode('depth'), prePass.getTextureNode(), preCamera);
    aoPass.resolutionScale = 1; aoPass.radius.value = 0.85; aoPass.scale.value = 1.1; aoPass.thickness.value = 1.3; aoPass.samples.value = 16;
    aoPass.distanceExponent.value = 1.4;
    this.ao = aoPass;
    // ---- 本描き
    const scenePass = pass(scene, camera);
    scenePass.contextNode = builtinAOContext(aoPass.getTextureNode().sample(screenUV).r);
    const sceneColor = scenePass.getTextureNode('output');
    const viewZ = scenePass.getViewZNode();
    const depthTex = scenePass.getTextureNode('depth');
    // ---- 被写界深度 → 光のにじみ
    const dofTex = convertToTexture(dof(sceneColor, viewZ, P.focus, P.focal, P.bokeh));
    const bloomNode = bloom(dofTex, 0.3, 0.55, 1.0);
    this.bloom = bloomNode;
    const hash = (p) => fract(sin(dot(p, vec2(12.9898, 78.233))).mul(43758.5453));
    // ---- 光の筋：画面の上で光源（太陽や月）へ向かってさかのぼり、遮られていない明るい空の分だけ光を足す
    const RAY_N = HI ? 56 : 26, RAY_DECAY = Math.pow(0.4, 1 / RAY_N);
    const rays = Fn(() => {
      const acc = vec3(0).toVar();
      If(P.rays.greaterThan(0.001), () => {
        const uv0 = screenUV, asp = vec2(FILM_W / FILM_H, 1.0);
        const stepV = P.rayUV.sub(uv0).mul(0.94 / RAY_N);
        const jit = hash(uv0.mul(vec2(FILM_W, FILM_H)).add(P.frame.mul(3.7)));
        const w = float(1).toVar();
        Loop(RAY_N, ({ i }) => {
          const u = uv0.add(stepV.mul(float(i).add(jit)));
          const z = perspectiveDepthToViewZ(depthTex.sample(u).r, cameraNear, cameraFar).negate();
          const sky = smoothstep(P.rayNear, P.rayNear.mul(2.0), z);
          const fall = exp(length(u.sub(P.rayUV).mul(asp)).mul(P.rayFall).negate());
          acc.addAssign(sceneColor.sample(u).rgb.min(P.rayClamp).mul(sky).mul(fall).mul(w));
          w.mulAssign(RAY_DECAY);
        });
        acc.mulAssign(P.rays.div(RAY_N));
      });
      return acc;
    });
    // ---- 横に伸びる光：にじみの絵を横方向にだけ広げる
    const streak = Fn(() => {
      const acc = vec3(0).toVar();
      const bt = bloomNode.getTextureNode();
      // 標本の位置を画素ごとにずらす（飛び飛びに読むと、小さく強い光が「点の列」になるため）
      const j = hash(screenUV.mul(vec2(FILM_W, FILM_H)).add(P.frame.mul(5.3)));
      for (let i = -12; i < 12; i++) { const c = (i + 0.5) / 12; const o = j.sub(0.5).div(12).add(c); acc.addAssign(bt.sample(screenUV.add(vec2(o.mul(0.24), 0))).rgb.min(4.0).mul(Math.exp(-Math.abs(c) * 2.6))); }
      return acc.mul(vec3(0.6, 0.78, 1.0)).mul(P.streak.div(6.7));
    });
    // ---- 階調
    const grade = Fn(() => {
      const hdr = dofTex.rgb.add(bloomNode.getTextureNode().rgb.mul(P.halo)).add(rays()).add(streak());
      const col = renderOutput(vec4(hdr, 1.0), THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace).rgb.toVar();
      const luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col.assign(mix(vec3(luma), col, P.saturation).mul(P.tint));
      col.assign(col.sub(0.5).mul(P.contrast).add(0.5).clamp(0, 1));
      col.assign(pow(col.mul(P.gain).add(P.lift.mul(col.oneMinus())).max(0.0), P.gammaInv));
      return vec4(col.clamp(0, 1), 1.0);
    });
    const ldr = convertToTexture(grade());
    const ovTex = this.ovTex;

    const output = Fn(() => {
      const uv0 = screenUV;
      // --- テレビ中継ふう（古いブラウン管）のゆがみ
      const c = uv0.sub(0.5);
      const r2 = dot(c, c);
      const jitter = hash(vec2(floor(uv0.y.mul(270.0)), P.frame)).sub(0.5).mul(0.0035);
      const uvTV = c.mul(float(1.0).add(r2.mul(0.22))).add(0.5).add(vec2(jitter, 0));
      const uvS = mix(uv0, uvTV, P.tv);
      // レンズの色ずれ（端ほど強い）
      const ca = c.mul(r2.mul(4.0).add(0.25)).mul(P.chroma);
      const col = vec3(ldr.sample(uvS.add(ca)).r, ldr.sample(uvS).g, ldr.sample(uvS.sub(ca)).b).toVar();
      const luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      // --- テレビ加工
      const ghost = dot(ldr.sample(uvS.sub(vec2(0.018, 0))).rgb, vec3(0.2126, 0.7152, 0.0722)).mul(0.2);
      const tvLum = pow(clamp(luma.add(ghost).mul(1.3).sub(0.02), 0.0, 1.0), float(0.8));
      const scan = sin(uv0.y.mul(FILM_H * 0.5 * 3.14159)).mul(0.5).add(0.5);
      const roll = smoothstep(0.0, 0.08, fract(uv0.y.sub(P.time.mul(0.11))).sub(0.5).abs().oneMinus().sub(0.92)).mul(0.10);
      const snow = hash(uv0.mul(vec2(FILM_W, FILM_H)).add(P.frame.mul(17.0))).sub(0.5).mul(0.13);
      const tvCol = vec3(tvLum).mul(vec3(0.93, 1.0, 1.04)).mul(scan.mul(0.28).add(0.74)).add(roll).add(snow).toVar();
      const q = abs(uvTV.sub(0.5)).mul(vec2(16.0 / 9.0, 1.0));
      const edge = max(q.x.sub(0.5 * 4.0 / 3.0 - 0.035), q.y.sub(0.5 - 0.035));
      const corner = length(max(q.sub(vec2(0.5 * 4.0 / 3.0 - 0.06, 0.5 - 0.06)), 0.0)).sub(0.06);
      const inside = smoothstep(0.004, -0.004, max(edge.sub(0.035), corner));
      tvCol.mulAssign(inside);
      tvCol.mulAssign(float(1.0).sub(r2.mul(1.5)));
      col.assign(mix(col, tvCol, P.tv));
      // 周辺減光
      const v = length(c.mul(vec2(1.0, 0.72))).mul(1.55);
      col.mulAssign(float(1.0).sub(smoothstep(0.45, 1.25, v).mul(P.vignette)));
      // フィルムの粒（暗部ほど目立つ）
      const g = hash(uv0.mul(vec2(FILM_W, FILM_H)).add(P.frame.mul(1.618))).sub(0.5);
      col.addAssign(g.mul(P.grain).mul(float(1.3).sub(luma.mul(0.6))));
      // 上下の黒帯
      const bar = step(uv0.y, P.bars).add(step(float(1.0).sub(P.bars), uv0.y)).clamp(0.0, 1.0);
      col.assign(mix(col, vec3(0.0), bar));
      // 閃光・暗転
      col.addAssign(P.flash);
      col.assign(mix(col, P.fadeColor, P.fade));
      // 文字（重ね描き）
      const ov = texture(ovTex, vec2(uv0.x, uv0.y.oneMinus()));
      col.assign(mix(col, ov.rgb, ov.a));
      return vec4(col, 1.0);
    });

    this.pipeline = new THREE.RenderPipeline(renderer);
    this.pipeline.outputColorTransform = false;
    this.pipeline.outputNode = output();

    this.rt = null;
    this._pool = [];
    this.setSize(FILM_W, FILM_H);
    return this;
  }

  setSize(w, h) {
    if (this._w === w && this._h === h) return;
    this._w = w; this._h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---- 文字の重ね描き：描く命令を集め、前のコマと同じなら描き直さない
  ovBegin() { this._ovCmds.length = 0; }
  ovAdd(sig, fn) { this._ovCmds.push([sig, fn]); }
  ovEnd() {
    const sig = this._ovCmds.map((c) => c[0]).join('|');
    if (sig === this._ovSig) return;
    this._ovSig = sig;
    const ctx = this.ovCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, FILM_W, FILM_H);
    for (const c of this._ovCmds) { ctx.save(); c[1](ctx); ctx.restore(); }
    this.ovTex.needsUpdate = true;
  }

  /** 1 コマ描く（描画先は現在の render target。null なら画面）。time は全編の秒（シェーダーの時計もこれに合わせる） */
  render(frameIndex = 0, time = 0) {
    this.post.frame.value = frameIndex % 1024;
    this.post.time.value = time;
    this.camera.updateMatrixWorld();
    this.preCamera.copy(this.camera, false);
    const nf = this.renderer._nodes.nodeFrame;
    nf.update();
    nf.time = time; nf.deltaTime = 1 / 60;
    this.renderer.info.reset();
    this.pipeline.render();
  }

  getTarget(w, h) {
    if (!this.rt || this.rt.width !== w || this.rt.height !== h) {
      if (this.rt) this.rt.dispose();
      this.rt = new THREE.RenderTarget(w, h, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, samples: 0 });
      this.rt.texture.colorSpace = THREE.NoColorSpace;
      for (const b of this._pool) b.buf.destroy();
      this._pool = [];
    }
    return this.rt;
  }

  /** 指定サイズで描いて RGBA の画素を返す（Uint8Array・上から下） */
  async renderPixels(w, h, frameIndex, time) {
    this.setSize(w, h);
    const rt = this.getTarget(w, h);
    this.renderer.setRenderTarget(rt);
    this.render(frameIndex, time);
    this.renderer.setRenderTarget(null);
    return this.readTarget(rt);
  }

  /** render target → 画素。GPU バッファは使い回す */
  async readTarget(rt) {
    const w = rt.width, h = rt.height;
    if (!this.isWebGPU) {
      return new Uint8Array((await this.renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h)).buffer);
    }
    const device = this.renderer.backend.device;
    const gpuTex = this.renderer.backend.get(rt.texture).texture;
    const bytesPerRow = Math.ceil((w * 4) / 256) * 256;
    let slot = this._pool.find((s) => !s.busy);
    if (!slot) {
      slot = { buf: device.createBuffer({ size: bytesPerRow * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }), busy: false };
      this._pool.push(slot);
    }
    slot.busy = true;
    const enc = device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: gpuTex }, { buffer: slot.buf, bytesPerRow, rowsPerImage: h }, { width: w, height: h });
    device.queue.submit([enc.finish()]);
    await slot.buf.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(slot.buf.getMappedRange());
    let out;
    if (bytesPerRow === w * 4) out = src.slice();
    else {
      out = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) out.set(src.subarray(y * bytesPerRow, y * bytesPerRow + w * 4), y * w * 4);
    }
    slot.buf.unmap();
    slot.busy = false;
    return out;
  }
}
