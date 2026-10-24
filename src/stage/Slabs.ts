/**
 * Slabs — the archive rail: every work is a glass slab carrying its cover,
 * strung along a gentle helix that recedes into the dust. The slab at the
 * focus point is the active one; its picture fades in as the particle field
 * condenses onto it, a light sweep crosses it, and the others blur and dim
 * with distance.
 */
import {
  Color,
  DoubleSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Texture,
  Vector3,
} from "three/webgpu";
import type { PerspectiveCamera, Scene } from "three/webgpu";
import {
  exp,
  float,
  luminance,
  mix,
  normalLocal,
  positionLocal,
  positionView,
  smoothstep,
  texture,
  uniform,
  uv,
  vec3,
  vec4,
} from "three/tsl";
import { loadImage } from "./targets";

export interface SlabItem {
  id: string;
  url: string;
  accent: string;
}

export interface SlabPose {
  /** World position of the focus point (the active slab sits here). */
  focus: Vector3;
  /** World height of a slab at the focus point. */
  height: number;
  /** Lateral amplitude of the helix (smaller on narrow screens). */
  sway: number;
}

const SPACING = 4.6;
const VISIBLE_RANGE = 7;
const MAX_TEXTURES = 12;

interface SlabState {
  item: SlabItem;
  mesh: Mesh;
  material: MeshBasicNodeMaterial;
  aspect: number;
  uActive: { value: number };
  uImage: { value: number };
  uSweep: { value: number };
  uFade: { value: number };
  uBlur: { value: number };
  uDetail: { value: number };
  texNode: ReturnType<typeof texture>;
  texture: Texture | null;
  loading: Promise<void> | null;
  lastUsed: number;
  // animation targets
  activeGoal: number;
  imageGoal: number;
  detailGoal: number;
  sweepT: number;
  sweepRunning: boolean;
}

const placeholder = (() => {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 2;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#0b0d12";
  ctx.fillRect(0, 0, 2, 2);
  const tex = new Texture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
})();

export class Slabs {
  private scene: Scene;
  private camera: PerspectiveCamera;
  private slabs: SlabState[] = [];
  private geometry = new PlaneGeometry(1, 1, 48, 32);
  private progress = 0;
  private pose: SlabPose = { focus: new Vector3(), height: 3, sway: 1 };
  private heroDim = 1;
  private detailPos = new Vector3();
  private detailScale = 1;
  private tilt = { x: 0, y: 0 };
  private activeIndex: number | null = null;
  private clock = 0;
  private uTime = uniform(0);

  constructor(scene: Scene, camera: PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;
  }

  setItems(items: SlabItem[]) {
    this.clear();
    items.forEach((item, index) => this.slabs.push(this.createSlab(item, index)));
  }

  get length() {
    return this.slabs.length;
  }

  private createSlab(item: SlabItem, index: number): SlabState {
    const uActive = uniform(0);
    const uImage = uniform(0);
    const uSweep = uniform(-1);
    const uFade = uniform(0);
    const uBlur = uniform(3);
    const uDetail = uniform(0);
    const accent = new Color(item.accent);
    const texNode = texture(placeholder);

    const material = new MeshBasicNodeMaterial();
    material.transparent = true;
    // No depth writes: the slab must never occlude the dust that condenses
    // onto it (particles are depth-tested additive sprites drawn after it).
    material.depthWrite = false;
    material.side = DoubleSide;

    // Relief: brighter texels stand proud of the glass (vertex stage sample).
    const relief = texNode.sample(uv()).rgb;
    const lumV = luminance(relief);
    material.positionNode = positionLocal.add(
      normalLocal.mul(lumV.sub(0.5).mul(0.22).mul(uImage)),
    );

    const picture = texNode.sample(uv()).bias(uBlur).rgb;
    const u = uv();
    const edgeDist = u.x.min(float(1).sub(u.x)).min(u.y.min(float(1).sub(u.y)));
    const frame = float(1).sub(smoothstep(float(0), float(0.012), edgeDist));
    const inner = float(1).sub(smoothstep(float(0.012), float(0.08), edgeDist));
    const sweepPos = u.x.mul(0.8).add(u.y.mul(0.45));
    const band = exp(sweepPos.sub(uSweep).mul(7).pow(2).negate());
    const glassTint = vec3(0.07, 0.085, 0.11);
    const lit = mix(float(0.22), float(1), uActive);
    const pic = mix(glassTint, picture, uImage).mul(lit);
    const accentNode = uniform(accent);
    const glow = accentNode
      .mul(frame.mul(float(0.45).add(uActive.mul(0.75))))
      .add(accentNode.mul(inner).mul(0.12).mul(uActive));
    const shine = vec3(1, 0.97, 0.92).mul(band).mul(0.45).mul(uImage);
    const depthFade = float(1).sub(
      smoothstep(float(18), float(34), positionView.z.negate()),
    );
    const colour = pic.add(glow).add(shine).mul(uFade).mul(depthFade);
    material.colorNode = vec4(colour, 1);
    material.opacityNode = uFade.mul(depthFade).mul(mix(float(0.85), float(1), uImage));

    const mesh = new Mesh(this.geometry, material);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = 1;
    mesh.userData.index = index;
    this.scene.add(mesh);

    return {
      item,
      mesh,
      material,
      aspect: 1.5,
      uActive,
      uImage,
      uSweep,
      uFade,
      uBlur,
      uDetail,
      texNode,
      texture: null,
      loading: null,
      lastUsed: 0,
      activeGoal: 0,
      imageGoal: 0,
      detailGoal: 0,
      sweepT: -1,
      sweepRunning: false,
    };
  }

  /* ------------------------------------------------------------------ */
  /* control                                                             */
  /* ------------------------------------------------------------------ */

  setPose(pose: SlabPose) {
    this.pose = pose;
  }

  /** 0..1: how much the whole rail is dimmed (hero teaser). */
  setHeroDim(v: number) {
    this.heroDim = v;
  }

  setProgress(p: number) {
    this.progress = p;
  }

  setTilt(x: number, y: number) {
    this.tilt.x = x;
    this.tilt.y = y;
  }

  setDetailPose(position: Vector3, scale: number) {
    this.detailPos.copy(position);
    this.detailScale = scale;
  }

  setActive(index: number | null, revealDelay = 0.5) {
    this.activeIndex = index;
    for (const s of this.slabs) {
      const isActive = s.mesh.userData.index === index;
      s.activeGoal = isActive ? 1 : 0;
      if (!isActive) {
        s.imageGoal = 0;
        s.sweepRunning = false;
      }
    }
    if (index !== null) {
      const s = this.slabs[index];
      if (s) {
        void this.ensureTexture(s).then(() => {
          if (this.activeIndex !== index) return;
          s.imageGoal = 1;
          s.sweepT = -0.6 - revealDelay * 1.2;
          s.sweepRunning = true;
        });
      }
    }
  }

  setDetail(open: boolean) {
    for (const s of this.slabs) {
      s.detailGoal = open && s.mesh.userData.index === this.activeIndex ? 1 : 0;
    }
  }

  prefetch(index: number) {
    const s = this.slabs[index];
    if (s) void this.ensureTexture(s);
  }

  private ensureTexture(s: SlabState) {
    s.lastUsed = this.clock;
    if (s.texture) return Promise.resolve();
    if (s.loading) return s.loading;
    s.loading = loadImage(s.item.url)
      .then((img) => {
        const tex = new Texture(img);
        tex.colorSpace = SRGBColorSpace;
        tex.minFilter = LinearMipmapLinearFilter;
        tex.magFilter = LinearFilter;
        tex.generateMipmaps = true;
        tex.anisotropy = 4;
        tex.needsUpdate = true;
        s.texture = tex;
        s.aspect = img.width / Math.max(1, img.height);
        s.texNode.value = tex;
        s.loading = null;
        this.evict();
      })
      .catch(() => {
        s.loading = null;
      });
    return s.loading;
  }

  private evict() {
    const loaded = this.slabs.filter((s) => s.texture).sort((a, b) => a.lastUsed - b.lastUsed);
    while (loaded.length > MAX_TEXTURES) {
      const s = loaded.shift()!;
      if (s.mesh.userData.index === this.activeIndex) continue;
      s.texture?.dispose();
      s.texture = null;
      s.texNode.value = placeholder;
    }
  }

  /* ------------------------------------------------------------------ */
  /* per frame                                                           */
  /* ------------------------------------------------------------------ */

  update(dt: number, time: number) {
    this.clock = time;
    this.uTime.value = time;
    const { focus, height, sway } = this.pose;
    const p = this.progress;
    const ease = (cur: number, goal: number, rate: number) =>
      cur + (goal - cur) * (1 - Math.exp(-dt * rate));

    for (let i = 0; i < this.slabs.length; i++) {
      const s = this.slabs[i];
      const k = i - p;
      const visible = k > -1.6 && k < VISIBLE_RANGE;
      s.mesh.visible = visible;
      if (!visible) {
        // keep easing so a slab never comes back with stale state
        s.uActive.value = ease(s.uActive.value, s.activeGoal, 5);
        s.uImage.value = ease(s.uImage.value, s.imageGoal, 7);
        s.uDetail.value = ease(s.uDetail.value, s.detailGoal, 6);
        continue;
      }
      if (Math.abs(k) < 3.5) s.lastUsed = time;
      if (k > 0 && k < 3.2 && !s.texture && !s.loading) void this.ensureTexture(s);

      // helix placement, the active slab exactly at the focus point
      const x = focus.x + Math.sin(k * 0.55) * 1.4 * sway;
      const y = focus.y + (Math.cos(k * 0.55) - 1) * 0.6 + k * 0.06;
      const z = focus.z - k * SPACING;

      const detail = (s.uDetail.value = ease(s.uDetail.value, s.detailGoal, 6));
      const px = x + (this.detailPos.x - x) * detail;
      const py = y + (this.detailPos.y - y) * detail;
      const pz = z + (this.detailPos.z - z) * detail;
      s.mesh.position.set(px, py, pz);

      const h = height * (1 + (this.detailScale - 1) * detail);
      s.mesh.scale.set(h * s.aspect, h, 1);

      // face the camera, with a touch of yaw along the curve and the
      // pointer tilt on the active slab
      s.mesh.lookAt(this.camera.position);
      const active = s.uActive.value;
      s.mesh.rotation.y += Math.sin(k * 0.55) * -0.22 * sway + this.tilt.x * 0.12 * active;
      s.mesh.rotation.x += this.tilt.y * -0.08 * active;

      s.uActive.value = ease(active, s.activeGoal, 5);
      s.uImage.value = ease(s.uImage.value, s.imageGoal, s.imageGoal > s.uImage.value ? 2.2 : 7);
      // approaching slabs fade in from the fog, passed ones fade behind
      const ahead = 1 - smoothstepJs(VISIBLE_RANGE - 2, VISIBLE_RANGE, k);
      const behind = 1 - smoothstepJs(-0.55, -1.6, -k) ;
      const passed = k < 0 ? 1 - smoothstepJs(0.35, 1.3, -k) : 1;
      const heroFade = 1 - this.heroDim * 0.7;
      const detailDim = this.detailGoal(s) ? 1 : 1 - this.maxDetail() * 0.85;
      s.uFade.value = ahead * passed * heroFade * detailDim * (behind || 1);
      s.uBlur.value = (1 - s.uActive.value) * 3.2;

      if (s.sweepRunning) {
        s.sweepT += dt * 1.1;
        s.uSweep.value = s.sweepT;
        if (s.sweepT > 2.2) s.sweepRunning = false;
      } else if (s.uSweep.value > -1) {
        s.uSweep.value = -1;
      }
    }
  }

  private detailGoal(s: SlabState) {
    return s.detailGoal === 1;
  }
  private maxDetail() {
    let m = 0;
    for (const s of this.slabs) if (s.uDetail.value > m) m = s.uDetail.value;
    return m;
  }

  /** Aspect of a slab once its cover is known (1.5 before). */
  aspectOf(index: number) {
    return this.slabs[index]?.aspect ?? 1.5;
  }

  clear() {
    for (const s of this.slabs) {
      this.scene.remove(s.mesh);
      s.material.dispose();
      s.texture?.dispose();
    }
    this.slabs = [];
  }

  dispose() {
    this.clear();
    this.geometry.dispose();
  }
}

function smoothstepJs(a: number, b: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
