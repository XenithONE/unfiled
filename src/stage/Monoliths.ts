/**
 * Monoliths — every work is a slab of dark steel standing in the water, its
 * cover lit from inside like a light box. The glass over the picture and the
 * steel around it reflect the same sky that hangs above, so the slabs belong
 * to the hour: rim-lit at sunset, lamps in the dark.
 */
import {
  BoxGeometry,
  Color,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  Raycaster,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector4,
} from "three/webgpu";
import type { PerspectiveCamera, Scene } from "three/webgpu";
import {
  Fn,
  abs,
  cameraPosition,
  dot,
  exp,
  float,
  length,
  max,
  mix,
  normalLocal,
  normalWorld,
  normalize,
  positionWorld,
  pow,
  reflect,
  smoothstep,
  step,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "./tsl";
import type { N } from "./tsl";
import { SLAB_FOOT } from "./layout";
import type { SlabPose } from "./layout";
import type { Sky } from "./sky";
import { loadImage } from "./images";

export interface WorkItem {
  id: string;
  url: string;
  accent: string;
}

const BEZEL = 0.075;
const SUNK = 0.4;
const THICK = 0.2;

interface Slab {
  item: WorkItem;
  mesh: Mesh;
  material: MeshBasicNodeMaterial;
  texNode: N;
  texture: Texture | null;
  loading: Promise<void> | null;
  aspect: number;
  pose: SlabPose;
  uDims: { value: Vector4 };
  uActive: { value: number };
  uImage: { value: number };
  uSweep: { value: number };
  uHover: { value: number };
  activeGoal: number;
  imageGoal: number;
  hoverGoal: number;
  sweepT: number;
  sweeping: boolean;
}

const placeholder = (() => {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 2;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#07090d";
  ctx.fillRect(0, 0, 2, 2);
  const tex = new Texture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
})();

export class Monoliths {
  private scene: Scene;
  private sky: Sky;
  private slabs: Slab[] = [];
  private geometry = new BoxGeometry(1, 1, 1);
  private raycaster = new Raycaster();
  private ndc = new Vector2();
  private activeIndex: number | null = null;
  private hoverIndex: number | null = null;
  private queue: number[] = [];
  private inFlight = 0;
  private focus = 0;
  private maxTexture: number;
  private disposed = false;

  readonly uFog: { value: number };
  private uGain = uniform(1);
  private uTime = uniform(0);

  /** Called when a cover's real aspect ratio is known. */
  onAspect: ((index: number, aspect: number) => void) | null = null;

  constructor(scene: Scene, sky: Sky, fog: { value: number }, maxTexture: number) {
    this.scene = scene;
    this.sky = sky;
    this.uFog = fog;
    this.maxTexture = maxTexture;
  }

  get count() {
    return this.slabs.length;
  }

  setItems(items: WorkItem[], poses: SlabPose[]) {
    this.clear();
    items.forEach((item, i) => this.slabs.push(this.create(item, poses[i], i)));
    this.queue = items.map((_, i) => i);
    this.pump();
  }

  private create(item: WorkItem, pose: SlabPose, index: number): Slab {
    const sky = this.sky;
    const uDims = uniform(new Vector4(1, 1, 1, 1));
    const uActive = uniform(0);
    const uImage = uniform(0);
    const uSweep = uniform(-2);
    const uHover = uniform(0);
    const uAccent = uniform(new Color(item.accent));
    const texNode = texture(placeholder);
    const { uGain, uTime } = this;
    const uFog = this.uFog as N;

    const colour = Fn(() => {
      const toCam = cameraPosition.sub(positionWorld).toVar();
      const dist = length(toCam).toVar();
      const V = toCam.div(dist).toVar();
      const Nw = normalize(normalWorld).toVar();
      const facing = max(dot(Nw, V), 0);
      const fres = pow(facing.oneMinus(), 5);
      // the water mirrors the sky, so a ray that leaves downward sees sky too
      const rr = reflect(V.negate(), Nw);
      const env = sky.base(normalize(vec3(rr.x, abs(rr.y).add(0.02), rr.z))).toVar();

      // steel: body, back and edges
      const steel = env.mul(mix(float(0.1), float(0.9), fres)).mul(vec3(0.82, 0.85, 0.92));

      // the lit face
      const p = uv();
      const iu = p.x.mul(uDims.x).sub(BEZEL).div(uDims.z).toVar();
      const iv = p.y.mul(uDims.y).sub(SUNK + SLAB_FOOT).div(uDims.w).toVar();
      // metres outside the picture (negative inside)
      const out = max(
        max(iu.negate(), iu.sub(1)).mul(uDims.z),
        max(iv.negate(), iv.sub(1)).mul(uDims.w),
      ).toVar();
      const inside = smoothstep(0.004, -0.004, out);
      const picture = texNode.sample(vec2(iu, iv)).rgb;
      const idle = uAccent
        .mul(0.07)
        .mul(float(1).add(dot(vec2(iu, iv), vec2(0.6, 0.8)).mul(3).add(uTime.mul(0.8)).sin().mul(0.25)));
      const lit = mix(idle, picture, uImage)
        .mul(uGain)
        .mul(mix(float(0.52), float(1), uActive).add(uHover.mul(0.14)));
      const sweepAt = iu.mul(0.8).add(iv.mul(0.45)).sub(uSweep).mul(6);
      const sweep = vec3(1, 0.96, 0.9).mul(exp(sweepAt.mul(sweepAt).negate())).mul(0.3).mul(uImage);
      const glass = env.mul(fres.mul(0.9).add(0.035));
      // a hairline of the work's colour around the picture
      const line = smoothstep(0.004, 0.01, out).mul(smoothstep(0.027, 0.019, out));
      const lamp = uAccent.mul(line).mul(uActive.mul(1.3).add(uHover.mul(0.8)).add(0.35));
      const frame = vec3(0.012, 0.013, 0.016).add(lamp);
      const face = mix(frame, lit.add(sweep), inside).add(glass);

      const front = step(0.5, normalLocal.z);
      const col = mix(steel, face, front).toVar();
      const fog = float(1).sub(exp(dist.mul(uFog).negate()));
      col.assign(mix(col, sky.horizon(V.negate()), fog));
      return vec4(col, 1);
    });

    const material = new MeshBasicNodeMaterial();
    material.colorNode = colour();
    material.fog = false;

    const mesh = new Mesh(this.geometry, material);
    mesh.userData.index = index;
    mesh.frustumCulled = false;
    this.scene.add(mesh);

    const slab: Slab = {
      item,
      mesh,
      material,
      texNode,
      texture: null,
      loading: null,
      aspect: pose.width / pose.height,
      pose,
      uDims,
      uActive,
      uImage,
      uSweep,
      uHover,
      activeGoal: 0,
      imageGoal: 0,
      hoverGoal: 0,
      sweepT: -2,
      sweeping: false,
    };
    this.place(slab, pose);
    return slab;
  }

  private place(slab: Slab, pose: SlabPose) {
    slab.pose = pose;
    const bodyW = pose.width + BEZEL * 2;
    const bodyH = SUNK + SLAB_FOOT + pose.height + BEZEL;
    slab.uDims.value.set(bodyW, bodyH, pose.width, pose.height);
    slab.mesh.scale.set(bodyW, bodyH, THICK);
    slab.mesh.position.set(pose.x, bodyH / 2 - SUNK, pose.z);
    slab.mesh.rotation.set(0, pose.yaw, 0);
    slab.mesh.updateMatrixWorld();
  }

  setPoses(poses: SlabPose[]) {
    this.slabs.forEach((slab, i) => poses[i] && this.place(slab, poses[i]));
  }

  aspects() {
    return this.slabs.map((s) => s.aspect);
  }

  /* ------------------------------------------------------------------ */
  /* state                                                               */
  /* ------------------------------------------------------------------ */

  setActive(index: number | null) {
    if (index === this.activeIndex) return;
    this.activeIndex = index;
    this.slabs.forEach((slab, i) => {
      slab.activeGoal = i === index ? 1 : 0;
      if (i === index) {
        slab.sweepT = -0.9;
        slab.sweeping = true;
      }
    });
    if (index !== null) this.setFocus(index);
  }

  setHover(index: number | null) {
    if (index === this.hoverIndex) return;
    this.hoverIndex = index;
    this.slabs.forEach((slab, i) => (slab.hoverGoal = i === index ? 1 : 0));
  }

  get hovered() {
    return this.hoverIndex;
  }

  /** Covers load nearest-first around this index. */
  setFocus(index: number) {
    if (index === this.focus) return;
    this.focus = index;
    this.queue.sort((a, b) => Math.abs(a - index) - Math.abs(b - index));
  }

  private pump() {
    while (!this.disposed && this.inFlight < 3 && this.queue.length > 0) {
      const index = this.queue.shift()!;
      const slab = this.slabs[index];
      if (!slab || slab.texture || slab.loading) continue;
      this.inFlight++;
      slab.loading = this.load(slab, index).finally(() => {
        slab.loading = null;
        this.inFlight--;
        this.pump();
      });
    }
  }

  private async load(slab: Slab, index: number) {
    let img: HTMLImageElement;
    try {
      img = await loadImage(slab.item.url);
    } catch {
      return; // the slab keeps its idle glow
    }
    if (this.disposed || this.slabs[index] !== slab) return;
    let source: HTMLImageElement | HTMLCanvasElement = img;
    const limit = this.maxTexture;
    if (img.width > limit) {
      const canvas = document.createElement("canvas");
      canvas.width = limit;
      canvas.height = Math.max(1, Math.round((img.height / img.width) * limit));
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        source = canvas;
      }
    }
    const tex = new Texture(source);
    tex.colorSpace = SRGBColorSpace;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.magFilter = LinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    slab.texture = tex;
    slab.texNode.value = tex;
    slab.imageGoal = 1;
    const aspect = img.width / Math.max(1, img.height);
    if (Math.abs(aspect - slab.aspect) > 0.01) {
      slab.aspect = aspect;
      this.onAspect?.(index, aspect);
    }
  }

  /* ------------------------------------------------------------------ */
  /* per frame                                                           */
  /* ------------------------------------------------------------------ */

  update(dt: number, time: number) {
    this.uTime.value = time;
    this.uGain.value = this.sky.slabGain;
    const ease = (cur: number, goal: number, rate: number) =>
      cur + (goal - cur) * (1 - Math.exp(-dt * rate));
    for (const slab of this.slabs) {
      slab.uActive.value = ease(slab.uActive.value, slab.activeGoal, slab.activeGoal ? 3.2 : 4.5);
      slab.uImage.value = ease(slab.uImage.value, slab.imageGoal, 2.4);
      slab.uHover.value = ease(slab.uHover.value, slab.hoverGoal, 9);
      if (slab.sweeping) {
        slab.sweepT += dt * 1.25;
        slab.uSweep.value = slab.sweepT;
        if (slab.sweepT > 2.4) {
          slab.sweeping = false;
          slab.uSweep.value = -2;
        }
      }
    }
  }

  /** Index of the slab under a point of the canvas (NDC), or null. */
  pick(ndcX: number, ndcY: number, camera: PerspectiveCamera, maxDistance = 90) {
    this.ndc.set(ndcX, ndcY);
    this.raycaster.setFromCamera(this.ndc, camera);
    this.raycaster.far = maxDistance;
    let best: number | null = null;
    let bestDist = Infinity;
    for (const slab of this.slabs) {
      const hits = this.raycaster.intersectObject(slab.mesh, false);
      // only the part above the water counts
      const hit = hits.find((h) => h.point.y > 0);
      if (hit && hit.distance < bestDist) {
        bestDist = hit.distance;
        best = slab.mesh.userData.index as number;
      }
    }
    return best;
  }

  clear() {
    for (const slab of this.slabs) {
      this.scene.remove(slab.mesh);
      slab.material.dispose();
      slab.texture?.dispose();
    }
    this.slabs = [];
    this.queue = [];
    this.activeIndex = null;
    this.hoverIndex = null;
  }

  dispose() {
    this.disposed = true;
    this.clear();
    this.geometry.dispose();
  }
}
