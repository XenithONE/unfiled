/**
 * VI — 宇宙の網. Three million galaxies strung along the cosmic web.
 *
 * #30 frustum culling + indirect draw: every frame a compute pass tests each
 *     galaxy against the six frustum planes and appends the visible ones to a
 *     list with atomicAdd; the same counter is the instance count of an
 *     indirect draw, so the CPU never learns (or pays for) the number.
 * #25 the galaxies are counted into a 3D grid with atomicAdd once; crowded
 *     cells (the knots of the web) burn hotter.
 * #12 a pixel floor keeps faraway galaxies from flickering; #17 nodes pulse
 *     with the low end of the soundtrack.
 */
import {
  AdditiveBlending,
  Frustum,
  IndirectStorageBufferAttribute,
  Matrix4,
  MeshBasicNodeMaterial,
  Vector3,
  Vector4,
} from "three/webgpu";
import type { Mesh } from "three/webgpu";
import {
  Fn,
  If,
  atomicAdd,
  atomicLoad,
  atomicStore,
  clamp,
  cos,
  dot,
  float,
  floor,
  instanceIndex,
  instancedArray,
  length,
  max,
  mix,
  smoothstep,
  storage,
  uint,
  uniform,
  uniformArray,
  varying,
  vec2,
  vec3,
  vec4,
} from "../tsl/t";
import type { Ctx, Look } from "../engine/chapter";
import { Chapter, ramp } from "../engine/chapter";
import { particleMesh } from "../engine/quad";
import { Track } from "../engine/rig";
import type { N } from "../tsl/common";
import { T, fftAt, gauss, rnd } from "../tsl/common";
import { glowShape, spriteVertex } from "../tsl/sprite";

const BOX = 2600;
const GRID = 96;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Nodes (clusters) and the filaments that join each to its nearest few. */
function makeWeb(nNodes: number) {
  const rand = mulberry32(20261025);
  const nodes: Vector4[] = [];
  const minGap = BOX / Math.cbrt(nNodes) * 0.55;
  let guard = 0;
  while (nodes.length < nNodes && guard++ < 20000) {
    const p = new Vector3((rand() - 0.5) * BOX, (rand() - 0.5) * BOX * 0.8, (rand() - 0.5) * BOX);
    if (nodes.some((q) => p.distanceTo(new Vector3(q.x, q.y, q.z)) < minGap)) continue;
    const w = Math.exp((rand() - 0.5) * 1.6);
    nodes.push(new Vector4(p.x, p.y, p.z, w));
  }
  const segs: [number, number][] = [];
  const key = new Set<string>();
  nodes.forEach((a, i) => {
    const order = nodes
      .map((b, j) => ({ j, d: (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2 }))
      .filter((o) => o.j !== i)
      .sort((x, y) => x.d - y.d)
      .slice(0, 3);
    for (const o of order) {
      const k = i < o.j ? `${i}-${o.j}` : `${o.j}-${i}`;
      if (!key.has(k)) {
        key.add(k);
        segs.push([i, o.j]);
      }
    }
  });
  const nodeData = new Float32Array(nodes.length * 4);
  nodes.forEach((n, i) => nodeData.set([n.x, n.y, n.z, n.w], i * 4));
  const segData = new Float32Array(segs.length * 8);
  segs.forEach(([i, j], k) => {
    const a = nodes[i];
    const b = nodes[j];
    segData.set([a.x, a.y, a.z, a.w, b.x, b.y, b.z, b.w], k * 8);
  });
  return { nodeData, segData, nNodes: nodes.length, nSegs: segs.length, nodes };
}

export class WebChapter extends Chapter {
  readonly id = "web";
  readonly numeral = "VI";
  readonly name = "宇宙の網";
  readonly caption = "銀河は糸になり、糸は網になる。";
  readonly duration = 22;
  readonly techniques = [30, 25, 12, 17, 31];

  private readonly level = uniform(1);
  /** More galaxies on stronger tiers: keep the web's total light similar. */
  private densityGain = 1;
  private readonly planes = uniformArray([0, 1, 2, 3, 4, 5].map(() => new Vector4()), "vec4");
  private count = 0;
  private initNode: unknown;
  private densityClear: unknown;
  private densityCount: unknown;
  private densityRead: unknown;
  private resetNode: unknown;
  private cullNode: unknown;
  private args!: IndirectStorageBufferAttribute;
  private culled!: Mesh;
  private everything!: Mesh;
  private initialized = false;
  private frustum = new Frustum();
  private m = new Matrix4();
  private onCount: ((visible: number, total: number) => void) | null = null;
  private lastRead = 0;
  private reading = false;
  private ctxRef: Ctx | null = null;

  setCountHandler(fn: (visible: number, total: number) => void) {
    this.onCount = fn;
  }

  build(ctx: Ctx) {
    this.ctxRef = ctx;
    this.count = Math.round(3_000_000 * ctx.q);
    this.densityGain = Math.min(1.3, Math.max(0.4, Math.pow(0.25 / ctx.q, 0.6)));
    const web = makeWeb(ctx.q >= 0.6 ? 300 : 200);
    const nodes = instancedArray(web.nodeData, "vec4");
    const segs = instancedArray(web.segData, "vec4");
    const gal = instancedArray(this.count, "vec4"); // xyz, brightness
    const grid = instancedArray(GRID * GRID * GRID, "uint").toAtomic();
    const nNodes = web.nNodes;
    const nSegs = web.nSegs;

    const cellOf = (p: N): N => {
      const g = clamp(p.div(BOX).add(0.5), 0, 0.9999).mul(GRID);
      const c = floor(g);
      return uint(c.x).add(uint(c.y).mul(uint(GRID))).add(uint(c.z).mul(uint(GRID * GRID)));
    };

    this.initNode = Fn(() => {
      const i = instanceIndex;
      const kind = rnd(i, 0);
      const pos = vec3(0).toVar();
      const bright = float(1).toVar();
      If(kind.lessThan(0.14), () => {
        // cluster member: concentrated toward the node centre
        const k = uint(rnd(i, 1).mul(nNodes)).min(uint(nNodes - 1));
        const nd = nodes.element(k);
        const dir = vec3(gauss(i, 2), gauss(i, 4), gauss(i, 6));
        const r = rnd(i, 8).pow(1.6).mul(nd.w.mul(26).add(10));
        pos.assign(nd.xyz.add(dir.div(length(dir).max(1e-4)).mul(r)));
        bright.assign(rnd(i, 9).pow(3).mul(1.2).add(0.35));
      }).ElseIf(kind.lessThan(0.86), () => {
        // filament: denser toward both ends, a narrow tube around the axis
        const k = uint(rnd(i, 10).mul(nSegs)).min(uint(nSegs - 1));
        const a = segs.element(k.mul(uint(2)));
        const b = segs.element(k.mul(uint(2)).add(uint(1)));
        const u = float(0.5).sub(cos(rnd(i, 11).mul(Math.PI)).mul(0.5));
        const axis = mix(a.xyz, b.xyz, u);
        const width = float(7).add(mix(a.w, b.w, u).mul(5));
        pos.assign(axis.add(vec3(gauss(i, 12), gauss(i, 14), gauss(i, 16)).mul(width)));
        bright.assign(rnd(i, 17).pow(4).mul(1.6).add(0.45));
      }).Else(() => {
        // walls and voids: sparse and dim
        pos.assign(vec3(rnd(i, 18).sub(0.5), rnd(i, 19).sub(0.5).mul(0.8), rnd(i, 20).sub(0.5)).mul(BOX));
        bright.assign(rnd(i, 21).mul(0.35).add(0.1));
      });
      gal.element(i).assign(vec4(pos, bright));
    })().compute(this.count, [256]);

    this.densityClear = Fn(() => {
      atomicStore(grid.element(instanceIndex), uint(0));
    })().compute(GRID * GRID * GRID, [256]);
    this.densityCount = Fn(() => {
      atomicAdd(grid.element(cellOf(gal.element(instanceIndex).xyz)), uint(1));
    })().compute(this.count, [256]);
    // pack the local crowding next to the brightness: w = ⌊crowd·999⌋·10 + b
    this.densityRead = Fn(() => {
      const g = gal.element(instanceIndex);
      const c = atomicLoad(grid.element(cellOf(g.xyz))).toFloat();
      const p = g.xyz.toVar();
      const b = g.w.toVar();
      const crowd = clamp(c.div(400), 0, 1);
      g.assign(vec4(p, floor(crowd.mul(999)).mul(10).add(b.min(9.99))));
    })().compute(this.count, [256]);

    // #30: indirect args (indexCount, instanceCount, firstIndex, baseVertex, firstInstance)
    this.args = new IndirectStorageBufferAttribute(new Uint32Array([6, 0, 0, 0, 0]), 1);
    const args = storage(this.args, "uint", 5).toAtomic();
    const visible = instancedArray(this.count, "uint");
    this.resetNode = Fn(() => {
      atomicStore(args.element(0), uint(6));
      atomicStore(args.element(1), uint(0));
    })().compute(1);
    this.cullNode = Fn(() => {
      const i = instanceIndex;
      const g = gal.element(i);
      const r = float(6);
      const inside = float(1).toVar();
      for (let k = 0; k < 6; k++) {
        const pl = this.planes.element(k);
        If(dot(pl.xyz, g.xyz).add(pl.w).lessThan(r.negate()), () => {
          inside.assign(0);
        });
      }
      If(inside.greaterThan(0.5), () => {
        const slot = atomicAdd(args.element(1), uint(1));
        visible.element(slot).assign(i);
      });
    })().compute(this.count, [256]);

    // render twice-built: culled (indirect) and everything (for comparison)
    const make = (indirect: boolean) => {
      const id = indirect ? visible.element(instanceIndex) : instanceIndex;
      const g = gal.element(id);
      const packed = floor(g.w.div(10));
      const crowd = packed.div(999);
      // #25: crowded cells burn brighter
      const b = g.w.sub(packed.mul(10)).add(crowd.mul(1.3).mul(T(25)));
      const hue = rnd(id, 3);
      const red = vec3(1.0, 0.68, 0.42);
      const blue = vec3(0.6, 0.78, 1.0);
      const col = mix(blue, red, smoothstep(0.3, 0.9, crowd.add(hue.mul(0.4))));
      const pulse = fftAt(id, 2, 18).mul(T(17)).mul(crowd.mul(2).add(0.3));
      const sprite = spriteVertex({ center: g.xyz, radius: b.sqrt().mul(1.6).add(0.9), minPx: 0.75, maxPx: 60, edgeFade: true });
      const mat = new MeshBasicNodeMaterial();
      mat.vertexNode = sprite.clip;
      mat.colorNode = varying(col.mul(b.mul(pulse.add(1))).mul(0.055 * this.densityGain).mul(this.level));
      // a tilted disc for galaxies close enough to resolve
      const ang = varying(hue.mul(Math.PI * 2));
      const asp = varying(rnd(id, 4).mul(2.2).add(1));
      const l = sprite.local;
      const lp = vec2(l.x.mul(ang.cos()).sub(l.y.mul(ang.sin())), l.x.mul(ang.sin()).add(l.y.mul(ang.cos()))).mul(vec2(1, asp));
      const resolved = smoothstep(3, 10, sprite.rpx);
      const disc = max(float(1).sub(length(lp)), 0).pow(2).add(max(float(1).sub(length(l).mul(4)), 0).mul(2));
      mat.opacityNode = mix(glowShape(sprite, 0.3), disc, resolved).mul(sprite.energy);
      mat.transparent = true;
      mat.depthWrite = false;
      mat.blending = AdditiveBlending;
      const mesh = particleMesh(this.count, mat, 4);
      if (indirect) mesh.geometry.setIndirect(this.args);
      return mesh;
    };
    this.culled = make(true);
    this.everything = make(false);
    this.everything.visible = false;
    this.group.add(this.culled, this.everything);

    this.track = new Track([
      { t: 0, pos: [-40, 30, 160], look: [120, -20, -200], fov: 64 },
      { t: 6, pos: [200, -10, -150], look: [400, -40, -500], fov: 60 },
      { t: 11, pos: [600, 300, -300], look: [0, 0, -200], fov: 56 },
      { t: 16, pos: [1900, 1200, 2100], look: [0, 0, 0], fov: 52 },
      { t: 22, pos: [3900, 2300, 4300], look: [0, 0, 0], fov: 48 },
    ]);
  }

  enter(ctx: Ctx) {
    if (!this.initialized) {
      this.initialized = true;
      ctx.renderer.compute(this.initNode as never);
      ctx.renderer.compute(this.densityClear as never);
      ctx.renderer.compute(this.densityCount as never);
      ctx.renderer.compute(this.densityRead as never);
    }
  }

  exit(_ctx: Ctx) {
    this.onCount?.(0, 0);
  }

  update(ctx: Ctx) {
    this.level.value = 1;
    const cam = ctx.camera;
    cam.updateMatrixWorld();
    this.m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.m, cam.coordinateSystem);
    const arr = (this.planes as unknown as { array: Vector4[] }).array;
    this.frustum.planes.forEach((p, k) => arr[k].set(p.normal.x, p.normal.y, p.normal.z, p.constant));
    const useCull = (T(30).value as number) > 0.5;
    this.culled.visible = useCull;
    this.everything.visible = !useCull;
    this.maybeReadCount();
  }

  prepare(ctx: Ctx) {
    ctx.renderer.compute(this.resetNode as never);
    ctx.renderer.compute(this.cullNode as never);
  }

  /** Reads the GPU's visible count back for the readout (twice a second). */
  private maybeReadCount() {
    const ctx = this.ctxRef;
    if (!ctx || !this.onCount || this.reading) return;
    const now = performance.now();
    if (now - this.lastRead < 500) return;
    this.lastRead = now;
    this.reading = true;
    const useCull = (T(30).value as number) > 0.5;
    void ctx.renderer
      .getArrayBufferAsync(this.args)
      .then((buf) => {
        const v = new Uint32Array(buf)[1];
        this.onCount?.(useCull ? v : this.count, this.count);
      })
      .catch(() => undefined)
      .finally(() => (this.reading = false));
  }

  look(t: number, out: Look) {
    out.bloom = [0.45, 0.45, 1.0];
    out.sky = 0;
    out.near = 0.5;
    out.far = 20000;
    out.focus = 600;
    out.aperture = 0;
    out.warp = (1 - ramp(t, 0, 1.3)) * 0.45;
  }
}

