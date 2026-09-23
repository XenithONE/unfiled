// Renderer, sky, light, fog and the landscape meshes.

import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import rockUrl from "../../everest/assets/rock-color.jpg";
import snowUrl from "../../everest/assets/snow-color.jpg";
import { Simplex, clamp } from "./noise";
import { CHUNK, planChunks, type ChunkData, type ChunkSpec, type Terrain } from "./terrain";
import { LAKE_Y } from "./track";
import { treeGeometries, treeGeometriesLow, treeMaterial } from "./trees";

export type TimeOfDay = "morning" | "noon" | "evening";

interface Look {
  sunElev: number; // degrees
  sunAz: number; // degrees, 0 = +x, 90 = +z
  sun: string;
  sunI: number;
  sky: string;
  horizon: string;
  ground: string;
  hemiI: number;
  fog: string;
  fogDensity: number;
  exposure: number;
  glow: string;
}

const LOOKS: Record<TimeOfDay, Look> = {
  morning: {
    sunElev: 13, sunAz: -25, sun: "#ffd9ae", sunI: 3.1, sky: "#5d8fd0", horizon: "#e6ddd2", ground: "#5a5a48", hemiI: 0.9,
    fog: "#c9d3dc", fogDensity: 0.000062, exposure: 0.95, glow: "#ffcf9a",
  },
  noon: {
    sunElev: 54, sunAz: 150, sun: "#fff6ea", sunI: 3.0, sky: "#2f6fc8", horizon: "#bcd4ec", ground: "#51583f", hemiI: 0.9,
    fog: "#b5c9de", fogDensity: 0.000048, exposure: 0.88, glow: "#fff4dc",
  },
  evening: {
    sunElev: 6.5, sunAz: 205, sun: "#ffae6a", sunI: 2.7, sky: "#4a6aa8", horizon: "#f2b489", ground: "#4a4238", hemiI: 0.75,
    fog: "#d6b6a2", fogDensity: 0.000058, exposure: 1.0, glow: "#ff9a5c",
  },
};

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sunDir = new THREE.Vector3();
  readonly terrainMat: THREE.MeshStandardMaterial;
  readonly terrainGroup = new THREE.Group();
  private sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private look: Look = LOOKS.noon;
  private water: Reflector | THREE.Mesh | null = null;
  private tunnelDim = 0;
  readonly mobile: boolean;
  private exposureBase = 1;

  constructor(canvas: HTMLCanvasElement, mobile: boolean) {
    this.mobile = mobile;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.5 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.25, 36000);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const sm = mobile ? 1024 : 2048;
    this.sun.shadow.mapSize.set(sm, sm);
    const sc = this.sun.shadow.camera;
    sc.left = -95;
    sc.right = 95;
    sc.top = 95;
    sc.bottom = -95;
    sc.near = 10;
    sc.far = 900;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd6ff, 0x4d5a3a, 1);
    this.scene.add(this.hemi);

    // Sky dome that follows the camera.
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uSun: { value: new THREE.Vector3(0, 1, 0) },
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uGlow: { value: new THREE.Color() },
        uGround: { value: new THREE.Color() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSun, uZenith, uHorizon, uGlow, uGround;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          float t = pow(clamp(h, 0.0, 1.0), 0.42);
          vec3 col = mix(uHorizon, uZenith, t);
          float mu = max(dot(d, uSun), 0.0);
          col += uGlow * (pow(mu, 8.0) * 0.35 + pow(mu, 64.0) * 0.6) * (1.0 - t * 0.6);
          col += vec3(1.0, 0.97, 0.9) * smoothstep(0.9994, 0.99975, mu) * 18.0;
          col = mix(col, uGround * 0.9 + uHorizon * 0.25, smoothstep(0.0, -0.08, h));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(30000, 32, 16), this.skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    this.scene.fog = new THREE.FogExp2(0xb5c9de, 0.00005);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);

    this.terrainMat = makeTerrainMaterial(mobile);
    this.scene.add(this.terrainGroup);
  }

  setTimeOfDay(tod: TimeOfDay): void {
    const L = LOOKS[tod];
    this.look = L;
    const el = THREE.MathUtils.degToRad(L.sunElev);
    const az = THREE.MathUtils.degToRad(L.sunAz);
    this.sunDir.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
    this.sun.color.set(L.sun);
    this.hemi.color.set(L.sky).lerp(new THREE.Color("#ffffff"), 0.35);
    this.hemi.groundColor.set(L.ground);
    const u = this.skyMat.uniforms;
    u.uSun.value.copy(this.sunDir);
    (u.uZenith.value as THREE.Color).set(L.sky);
    (u.uHorizon.value as THREE.Color).set(L.horizon);
    (u.uGlow.value as THREE.Color).set(L.glow);
    (u.uGround.value as THREE.Color).set(L.ground);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.set(L.fog);
    fog.density = L.fogDensity;
    this.exposureBase = L.exposure;
    // Environment lighting from the sky alone.
    const envScene = new THREE.Scene();
    const skyCopy = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), this.skyMat);
    envScene.add(skyCopy);
    this.envRT?.dispose();
    this.envRT = this.pmrem.fromScene(envScene, 0.02, 0.1, 400);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.55;
    skyCopy.geometry.dispose();
    (this.terrainMat.userData.uniforms as Record<string, THREE.IUniform> | undefined)?.uSnowTint?.value.set(tod === "evening" ? "#ffe0d0" : "#ffffff");
  }

  /** 0..1: how deep in a tunnel the camera is. Dims the sky light, opens the iris. */
  setTunnel(f: number): void {
    this.tunnelDim = f;
  }

  update(focus: THREE.Vector3): void {
    this.sky.position.copy(this.camera.position);
    this.updateTreeLod();
    const L = this.look;
    const dim = 1 - this.tunnelDim * 0.93;
    this.sun.intensity = L.sunI * dim;
    this.hemi.intensity = L.hemiI * dim;
    this.scene.environmentIntensity = 0.55 * dim;
    this.renderer.toneMappingExposure = this.exposureBase * (1 + this.tunnelDim * 1.6);
    // Shadow box follows the focus, snapped to texels to stop shimmering.
    const d = this.sunDir;
    const texel = 190 / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx + d.x * 450, focus.y + d.y * 450, fz + d.z * 450);
    this.sun.target.updateMatrixWorld();
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  // ---------------------------------------------------------------- terrain

  /** Run jobs on a pool of workers; each result is handed to onResult. */
  private async pool<J, R>(jobs: J[], post: (w: Worker, job: J, id: number) => void, onResult: (r: R, job: J) => void, onProgress: (f: number) => void): Promise<void> {
    if (!this.workers.length) {
      const n = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
      for (let i = 0; i < n; i++) this.workers.push(new Worker(new URL("./terrainWorker.ts", import.meta.url), { type: "module" }));
    }
    let next = 0;
    let done = 0;
    if (jobs.length === 0) return;
    await new Promise<void>((resolve, reject) => {
      const feed = (w: Worker) => {
        if (next >= jobs.length) return;
        const id = next++;
        post(w, jobs[id], id);
      };
      for (const w of this.workers) {
        w.onerror = (e) => reject(e);
        w.onmessage = (e: MessageEvent) => {
          const msg = e.data as { id: number; data: R };
          onResult(msg.data, jobs[msg.id]);
          done++;
          onProgress(done / jobs.length);
          if (done === jobs.length) resolve();
          else feed(w);
        };
        feed(w);
        feed(w);
      }
    });
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
  }

  /** Generate every chunk on worker threads; resolves when all are in the scene. */
  async buildTerrain(terrain: Terrain, onProgress: (f: number) => void): Promise<void> {
    const fine = this.mobile ? 10 : 6.25;
    const plan = planChunks(terrain, fine);
    // Nearest-to-start first so the opening view appears early.
    const s0 = terrain.track.pos(300);
    plan.sort((a, b) => dist2(a, s0) - dist2(b, s0));
    const blocks = new Map<string, { specs: ChunkSpec[]; got: ChunkData[] }>();
    const key = (c: ChunkSpec) => `${Math.floor(c.cx / 4)},${Math.floor(c.cz / 4)}`;
    for (const c of plan) {
      const k = key(c);
      if (!blocks.has(k)) blocks.set(k, { specs: [], got: [] });
      blocks.get(k)!.specs.push(c);
    }
    await this.pool<ChunkSpec, ChunkData>(
      plan,
      (w, spec, id) => w.postMessage({ type: "chunk", id, spec }),
      (data) => {
        const b = blocks.get(key(data.spec))!;
        b.got.push(data);
        if (b.got.length === b.specs.length) this.addBlock(b.got);
      },
      onProgress,
    );
  }

  /** Forests near the line, instanced per 800 m square. */
  async plantTrees(terrain: Terrain, onProgress: (f: number) => void): Promise<void> {
    const size = 800;
    const b = terrain.bounds;
    const jobs: { x0: number; z0: number; seed: number }[] = [];
    const nr = { s: 0, d: 0, side: 1, y: 0 };
    for (let z = Math.floor((b.z0 - 700) / size) * size; z < b.z1 + 700; z += size) {
      for (let x = Math.floor((b.x0 - 700) / size) * size; x < b.x1 + 700; x += size) {
        terrain.near(x + size / 2, z + size / 2, nr);
        if (nr.d > 560 + size * 0.71) continue;
        jobs.push({ x0: x, z0: z, seed: (x * 73856093) ^ (z * 19349663) });
      }
    }
    const geos = treeGeometries();
    const lowGeos = treeGeometriesLow();
    const mat = treeMaterial();
    const spacing = this.mobile ? 13 : 9;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const col = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    this.treeCount = 0;
    await this.pool<{ x0: number; z0: number; seed: number }, Float32Array>(
      jobs,
      (w, j, id) => w.postMessage({ type: "trees", id, x0: j.x0, z0: j.z0, size, spacing, seed: j.seed }),
      (data) => {
        const n = data.length / 6;
        if (n === 0) return;
        for (let i = 0; i < n; i++) {
          const key = `${Math.floor(data[i * 6] / 50)},${Math.floor(data[i * 6 + 2] / 50)}`;
          let list = this.treeGrid.get(key);
          if (!list) this.treeGrid.set(key, (list = []));
          list.push(data[i * 6], data[i * 6 + 2]);
        }
        const counts = [0, 0, 0];
        for (let i = 0; i < n; i++) counts[data[i * 6 + 4]]++;
        const meshes = counts.map((c, k) => (c ? new THREE.InstancedMesh(geos[k], mat, c) : null));
        const lows = counts.map((c, k) => (c ? new THREE.InstancedMesh(lowGeos[k], mat, c) : null));
        const fill = [0, 0, 0];
        for (let i = 0; i < n; i++) {
          const k = data[i * 6 + 4];
          const s = data[i * 6 + 3];
          v.set(data[i * 6], data[i * 6 + 1], data[i * 6 + 2]);
          q.setFromAxisAngle(up, data[i * 6 + 5]);
          sc.set(s * (0.9 + (i % 7) * 0.03), s, s * (0.9 + (i % 5) * 0.04));
          m4.compose(v, q, sc);
          const mesh = meshes[k]!;
          mesh.setMatrixAt(fill[k], m4);
          lows[k]!.setMatrixAt(fill[k], m4);
          const tint = 0.82 + ((i * 2654435761) % 1000) / 1000 * 0.36;
          col.setRGB(tint * (k === 1 ? 1.05 : 0.95), tint, tint * 0.92);
          mesh.setColorAt(fill[k], col);
          lows[k]!.setColorAt(fill[k], col);
          fill[k]++;
        }
        const block = { center: new THREE.Vector3(), radius: 0, high: [] as THREE.InstancedMesh[], low: [] as THREE.InstancedMesh[] };
        meshes.forEach((mesh, k) => {
          if (!mesh) return;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.computeBoundingSphere();
          this.scene.add(mesh);
          const low = lows[k]!;
          low.computeBoundingSphere();
          low.visible = false;
          this.scene.add(low);
          block.high.push(mesh);
          block.low.push(low);
          block.center.copy(mesh.boundingSphere!.center);
          block.radius = Math.max(block.radius, mesh.boundingSphere!.radius);
        });
        this.treeBlocks.push(block);
        this.treeCount += n;
      },
      onProgress,
    );
  }

  treeCount = 0;
  private workers: Worker[] = [];
  private treeGrid = new Map<string, number[]>();

  /** How many trees stand within `r` metres of the segment a→b. */
  treesNear(ax: number, az: number, bx: number, bz: number, r: number): number {
    let count = 0;
    const x0 = Math.floor((Math.min(ax, bx) - r) / 50);
    const x1 = Math.floor((Math.max(ax, bx) + r) / 50);
    const z0 = Math.floor((Math.min(az, bz) - r) / 50);
    const z1 = Math.floor((Math.max(az, bz) + r) / 50);
    const vx = bx - ax;
    const vz = bz - az;
    const l2 = vx * vx + vz * vz || 1;
    for (let j = z0; j <= z1; j++) {
      for (let i = x0; i <= x1; i++) {
        const list = this.treeGrid.get(`${i},${j}`);
        if (!list) continue;
        for (let k = 0; k < list.length; k += 2) {
          const u = Math.min(1, Math.max(0, ((list[k] - ax) * vx + (list[k + 1] - az) * vz) / l2));
          if (Math.hypot(list[k] - ax - vx * u, list[k + 1] - az - vz * u) < r) count++;
        }
      }
    }
    return count;
  }
  private treeBlocks: { center: THREE.Vector3; radius: number; high: THREE.InstancedMesh[]; low: THREE.InstancedMesh[] }[] = [];

  /** Detailed trees near the camera, simple cones further away. */
  private updateTreeLod(): void {
    const c = this.camera.position;
    const near = this.mobile ? 180 : 320;
    for (const b of this.treeBlocks) {
      const d = c.distanceTo(b.center) - b.radius;
      const hi = d < near;
      for (const m of b.high) m.visible = hi;
      for (const m of b.low) m.visible = !hi;
    }
  }

  private addBlock(chunks: ChunkData[]): void {
    let nv = 0;
    let ni = 0;
    for (const c of chunks) {
      nv += c.positions.length / 3;
      ni += c.index.length;
    }
    const pos = new Float32Array(nv * 3);
    const nor = new Float32Array(nv * 3);
    const mix = new Float32Array(nv * 4);
    const tint = new Float32Array(nv * 4);
    const idx = new Uint32Array(ni);
    let ov = 0;
    let oi = 0;
    for (const c of chunks) {
      const cv = c.positions.length / 3;
      pos.set(c.positions, ov * 3);
      nor.set(c.normals, ov * 3);
      mix.set(c.mix, ov * 4);
      tint.set(c.tint, ov * 4);
      for (let i = 0; i < c.index.length; i++) idx[oi + i] = c.index[i] + ov;
      ov += cv;
      oi += c.index.length;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    g.setAttribute("aMix", new THREE.BufferAttribute(mix, 4));
    g.setAttribute("aTint", new THREE.BufferAttribute(tint, 4));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    const m = new THREE.Mesh(g, this.terrainMat);
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    const fine = chunks.some((c) => c.spec.seg >= 30);
    m.castShadow = false;
    m.userData.fine = fine;
    this.terrainGroup.add(m);
  }

  // ------------------------------------------------------------------ water

  addLake(terrain: Terrain): void {
    const c = terrain.lakeCentre;
    const geo = new THREE.PlaneGeometry(16000, 16000, 1, 1);
    if (this.mobile) {
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ color: "#20414f", roughness: 0.06, metalness: 0.2, envMapIntensity: 1.3 }),
      );
      m.position.set(c.x, LAKE_Y, c.z);
      this.scene.add(m);
      this.water = m;
      return;
    }
    const shader = {
      name: "LakeShader",
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          color: { value: null },
          tDiffuse: { value: null },
          textureMatrix: { value: null },
          uTime: { value: 0 },
          uWater: { value: new THREE.Color("#1d3d49") },
        },
      ]),
      vertexShader: /* glsl */ `
        uniform mat4 textureMatrix;
        varying vec4 vUv;
        varying vec3 vWorld;
        #include <common>
        #include <fog_pars_vertex>
        void main() {
          vUv = textureMatrix * vec4(position, 1.0);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float uTime;
        uniform vec3 uWater;
        varying vec4 vUv;
        varying vec3 vWorld;
        #include <common>
        #include <fog_pars_fragment>
        float h21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        float vn(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
        }
        void main() {
          vec2 p = vWorld.xz;
          float t = uTime;
          vec2 w = vec2(vn(p * 0.35 + t * 0.4) - 0.5, vn(p * 0.35 - t * 0.3 + 7.0) - 0.5)
                 + 0.5 * vec2(vn(p * 1.3 - t * 0.9) - 0.5, vn(p * 1.3 + t + 3.0) - 0.5);
          vec3 view = normalize(cameraPosition - vWorld);
          float dist = length(cameraPosition - vWorld);
          vec2 dUv = w * 0.018 * clamp(60.0 / dist, 0.15, 1.0);
          vec4 uv = vUv;
          uv.xy += dUv * uv.w;
          vec3 refl = texture2DProj(tDiffuse, uv).rgb;
          float fres = 0.04 + 0.96 * pow(1.0 - clamp(view.y, 0.0, 1.0), 5.0);
          fres = clamp(fres * 1.0 + 0.25, 0.0, 1.0);
          vec3 col = mix(uWater, refl, fres);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    };
    const r = new Reflector(geo, {
      textureWidth: Math.floor(window.innerWidth * 0.5),
      textureHeight: Math.floor(window.innerHeight * 0.5),
      clipBias: 0.002,
      shader,
    });
    (r.material as THREE.ShaderMaterial).fog = true;
    // Reflector takes its mirror normal from the object's +z, so rotate the
    // object (not the geometry) to lie flat.
    r.rotation.x = -Math.PI / 2;
    r.position.set(c.x, LAKE_Y, c.z);
    this.scene.add(r);
    this.water = r;
  }

  tick(time: number, camPos: THREE.Vector3, lake: { x: number; z: number }): void {
    if (this.water instanceof Reflector) {
      (this.water.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
      // Only pay for the reflection pass when the lake could be in view.
      const d = Math.hypot(camPos.x - lake.x, camPos.z - lake.z);
      this.water.visible = d < 6500 || camPos.y < LAKE_Y + 400;
    }
  }
}

function dist2(c: ChunkSpec, p: { x: number; z: number }): number {
  const x = (c.cx + 0.5) * CHUNK - p.x;
  const z = (c.cz + 0.5) * CHUNK - p.z;
  return x * x + z * z;
}

// ------------------------------------------------------------------ material

function grassTexture(): THREE.CanvasTexture {
  const size = 256;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const n = new Simplex(5);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Tileable by sampling a torus.
      const a = (x / size) * Math.PI * 2;
      const b = (y / size) * Math.PI * 2;
      const nx = Math.cos(a) * 3;
      const ny = Math.sin(a) * 3;
      const nz = Math.cos(b) * 3;
      const nw = Math.sin(b) * 3;
      let v = n.noise(nx + nz * 1.7, ny + nw * 1.3) * 0.5 + n.noise((nx - nw) * 3.1, (ny + nz) * 3.1) * 0.3;
      v += (Math.random() - 0.5) * 0.35;
      const c = clamp(128 + v * 110, 0, 255);
      const i = (y * size + x) * 4;
      img.data[i] = c;
      img.data[i + 1] = c;
      img.data[i + 2] = c;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

function makeTerrainMaterial(mobile: boolean): THREE.MeshStandardMaterial {
  const loader = new THREE.TextureLoader();
  const rock = loader.load(rockUrl);
  const snow = loader.load(snowUrl);
  for (const t of [rock, snow]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = mobile ? 4 : 8;
  }
  const grass = grassTexture();
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.93, metalness: 0, color: 0xffffff });
  const uniforms = {
    uRock: { value: rock },
    uSnow: { value: snow },
    uGrass: { value: grass },
    uSnowTint: { value: new THREE.Color("#ffffff") },
  };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute vec4 aMix;
        attribute vec4 aTint;
        varying vec4 vMix;
        varying vec4 vTint;
        varying vec3 vWPos;
        varying vec3 vWNormal;`,
      )
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
        vMix = aMix;
        vTint = aTint;
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform sampler2D uRock;
        uniform sampler2D uSnow;
        uniform sampler2D uGrass;
        uniform vec3 uSnowTint;
        varying vec4 vMix;
        varying vec4 vTint;
        varying vec3 vWPos;
        varying vec3 vWNormal;
        vec3 triRock(vec3 p, vec3 n, float sc) {
          vec3 w = pow(abs(n), vec3(4.0));
          w /= (w.x + w.y + w.z);
          return texture2D(uRock, p.zy * sc).rgb * w.x + texture2D(uRock, p.xz * sc).rgb * w.y + texture2D(uRock, p.xy * sc).rgb * w.z;
        }`,
      )
      .replace(
        "#include <map_fragment>",
        `
        vec3 wn = normalize(vWNormal);
        float camD = length(cameraPosition - vWPos);
        float g1 = texture2D(uGrass, vWPos.xz * 0.21).r;
        float g2 = texture2D(uGrass, vWPos.xz * 0.023).r;
        float g3 = texture2D(uGrass, vWPos.xz * 0.0031).r;
        float gd = mix(g1, 0.5, smoothstep(40.0, 260.0, camD)) * 0.5 + g2 * 0.38 + g3 * 0.42;
        vec3 grassC = vTint.rgb * (0.5 + 0.85 * gd);
        // Mottled meadow: patches of darker and sun-bleached grass.
        float patchN = texture2D(uGrass, vWPos.xz * 0.0011 + 0.37).r;
        grassC *= mix(vec3(0.82, 0.86, 0.8), vec3(1.12, 1.08, 0.9), smoothstep(0.35, 0.65, patchN));
        // Tiny flower specks on near meadows.
        float fl = step(0.86, texture2D(uGrass, vWPos.xz * 0.9 + 3.1).r) * (1.0 - smoothstep(15.0, 60.0, camD)) * vMix.x;
        grassC = mix(grassC, vec3(0.95, 0.9, 0.55), fl * 0.5);
        vec3 rockC = mix(triRock(vWPos, wn, 0.11), triRock(vWPos, wn, 0.013), 0.45);
        // Alpine limestone and gneiss: mostly grey, a hint of warmth.
        float rl = dot(rockC, vec3(0.3, 0.59, 0.11));
        rockC = mix(vec3(rl), rockC, 0.28) * vec3(1.04, 1.03, 1.06);
        rockC *= 0.8 + 0.35 * g3;
        vec3 snowC = texture2D(uSnow, vWPos.xz * 0.08).rgb * uSnowTint * 1.08;
        vec3 dirtC = vec3(0.3, 0.28, 0.25) * (0.7 + 0.6 * g1);
        // Sharpen the blend with the detail textures (height-blend).
        vec4 m = vMix;
        // Faces steeper than the mesh resolution shows are rock, whatever the vertex said.
        float steep = smoothstep(0.82, 0.62, wn.y);
        m.y = max(m.y, steep * (1.0 - m.z));
        m.x *= 1.0 - steep;
        m.y *= 0.6 + 0.8 * g2;
        m.z *= 0.7 + 0.6 * texture2D(uSnow, vWPos.xz * 0.02).r;
        m = pow(max(m, vec4(0.0)), vec4(1.6));
        m /= max(m.x + m.y + m.z + m.w, 1e-4);
        vec3 albedo = grassC * m.x + rockC * m.y + snowC * m.z + dirtC * m.w;
        diffuseColor.rgb *= albedo * vTint.a;
        `,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.55, m.z);`,
      );
  };
  mat.customProgramCacheKey = () => "terrain-v1";
  return mat;
}

