/**
 * Water — a few millimetres of still water over a dark salt pan.
 *
 * The sky is mirrored analytically: the reflected view direction goes through
 * the same sky function that paints the dome, so the stars stay pin-sharp in
 * the water. Everything that stands on the mirror (the works, the wordmark)
 * comes from a planar reflection pass and is laid over that. Ripples tilt the
 * surface normal — a wind-ruffled texture in three scales plus ring waves
 * that spread from wherever the visitor touches.
 */
import {
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  Vector2,
  Vector3,
  Vector4,
} from "three/webgpu";
import type { PerspectiveCamera, Texture } from "three/webgpu";
import {
  Fn,
  Loop,
  cameraPosition,
  cameraViewMatrix,
  clamp,
  cos,
  dot,
  exp,
  float,
  floor,
  hash,
  length,
  max,
  mix,
  normalize,
  positionWorld,
  pow,
  reflect,
  reflector,
  screenSize,
  screenUV,
  smoothstep,
  texture,
  uint,
  uniform,
  uniformArray,
  vec2,
  vec3,
  vec4,
} from "./tsl";
import type { N } from "./tsl";
import type { Sky } from "./sky";

const DROPS = 10;

export interface WaterOptions {
  reflectionScale: number;
  /** Draw the salt polygons under the water (skipped on weak devices). */
  salt: boolean;
  /** Blur what the mirror shows toward the viewer (needs mip maps). */
  soften: boolean;
}

export class Water {
  readonly mesh: Mesh;
  private material: MeshBasicNodeMaterial;
  private reflection: N;
  private drops: N;
  private dropIndex = 0;

  readonly uFog = uniform(1 / 260);
  private uTime = uniform(0);
  private uSlope = uniform(0.055);
  private uProj = uniform(new Vector2(0.7, 1.1));
  private uSunDir = uniform(new Vector3(0, 0.02, -1));
  private uSunXZ = uniform(new Vector2(0, -1));
  private uGlitter = uniform(new Vector3());
  private uAmbient = uniform(new Vector3());
  private uNightGlow = uniform(0);

  constructor(sky: Sky, ripples: Texture, noise: Texture, opts: WaterOptions) {
    const { uFog, uTime, uSlope, uProj, uSunDir, uSunXZ, uGlitter, uAmbient, uNightGlow } = this;
    const reflection = reflector({
      resolutionScale: opts.reflectionScale,
      generateMipmaps: opts.soften,
    });
    this.reflection = reflection;
    const drops = uniformArray(
      Array.from({ length: DROPS }, () => new Vector4(0, 0, -1000, 0)),
      "vec4",
    );
    this.drops = drops;

    /** Distance to the nearest cell border of a jittered grid (salt crust). */
    const crust = Fn(([p]: [N]) => {
      const cell = floor(p);
      const f = p.sub(cell);
      const f1 = float(9).toVar();
      const f2 = float(9).toVar();
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const g = vec2(i, j);
          const id = cell.add(g).add(4096);
          const seed = id.x.toUint().add(id.y.toUint().mul(uint(7919)));
          const o = vec2(hash(seed), hash(seed.add(uint(17)))).mul(0.8).add(0.1);
          const d = length(g.add(o).sub(f)).toVar();
          f2.assign(max(f1, d).min(f2));
          f1.assign(f1.min(d));
        }
      }
      return f2.sub(f1);
    });

    const colour = Fn(() => {
      const P = positionWorld;
      const toCam = cameraPosition.sub(P).toVar();
      const dist = length(toCam).toVar();
      const V = toCam.div(dist).toVar();
      const xz = P.xz;
      const t = uTime;

      // --- surface slope ---------------------------------------------------
      const s1 = texture(ripples, xz.mul(0.11).add(vec2(t.mul(0.013), t.mul(0.008)))).rg.sub(0.5);
      const s2 = texture(ripples, xz.mul(0.037).add(vec2(t.mul(-0.006), t.mul(0.004)))).rg.sub(0.5);
      const s3 = texture(ripples, xz.mul(0.31).add(vec2(t.mul(0.021), t.mul(-0.017)))).rg.sub(0.5);
      const gust = texture(noise, xz.mul(0.0035).add(vec2(t.mul(0.0011), t.mul(0.0004)))).r;
      const ruffle = smoothstep(0.3, 0.72, gust).mul(0.85).add(0.15);
      const slope = s1
        .mul(0.4)
        .add(s2.mul(0.9))
        .add(s3.mul(0.1))
        .mul(ruffle)
        .mul(uSlope)
        .toVar();
      const sparkle = float(0).toVar();
      Loop(DROPS, ({ i }: { i: N }) => {
        const drop = drops.element(i);
        const rel = xz.sub(drop.xy);
        const r = length(rel).add(1e-3);
        const age = t.sub(drop.z);
        const band = r.sub(age.mul(2.4));
        const env = exp(band.mul(band).mul(-1.1))
          .mul(exp(age.mul(-0.5)))
          .mul(drop.w)
          .div(r.mul(0.3).add(1));
        const wave = cos(band.mul(7.5));
        slope.addAssign(rel.div(r).mul(wave.mul(env)));
        // the crests of a ring, for the glow the water gives off at night
        sparkle.addAssign(pow(max(wave, 0), 14).mul(env));
      });

      const normal = normalize(vec3(slope.x.negate(), 1, slope.y.negate())).toVar();
      const rRaw = reflect(V.negate(), normal);
      const R = normalize(vec3(rRaw.x, max(rRaw.y, 0.002), rRaw.z)).toVar();

      // --- what the mirror shows --------------------------------------------
      // the stars' image is dimmer than the stars: it is what tells water from sky
      const skyR = sky.full(R, float(0.55)).toVar();
      const flat = reflect(V.negate(), vec3(0, 1, 0));
      const bend = cameraViewMatrix.mul(vec4(R.sub(flat), 0)).xy;
      const ruv = screenUV.flipX().sub(bend.mul(uProj));
      // ripples too fine to draw smear a reflection instead of bending it,
      // and more so the longer the light has travelled over them
      const things = (() => {
        if (!opts.soften) return reflection.sample(ruv);
        // four taps on a tilted square hide the blockiness of the low mips
        const lod = smoothstep(0.03, 0.42, R.y).mul(2.2).toVar();
        const reach = lod.exp2().mul(0.55).div(screenSize.mul(opts.reflectionScale));
        const tap = (x: number, y: number) =>
          reflection.sample(ruv.add(reach.mul(vec2(x, y)))).level(lod);
        return tap(0.9, 0.35).add(tap(-0.35, 0.9)).add(tap(-0.9, -0.35)).add(tap(0.35, -0.9)).mul(0.25);
      })().toVar();
      const mirror = skyR.mul(clamp(things.a, 0, 1).oneMinus()).add(things.rgb).toVar();

      // sun glitter: a long path of glints toward the sun
      const rh = R.xz.div(max(length(R.xz), 1e-4));
      const dAz = float(1).sub(dot(rh, uSunXZ));
      const dEl = R.y.sub(uSunDir.y);
      const g1 = texture(noise, xz.mul(0.47).add(vec2(t.mul(0.035), t.mul(0.021)))).r;
      const g2 = texture(noise, xz.mul(1.31).sub(vec2(t.mul(0.027), t.mul(0.044)))).g;
      const glints = pow(clamp(g1.mul(g2).mul(3.3), 0, 1.5), 6);
      const path = exp(dAz.mul(-520)).mul(exp(dEl.mul(dEl).mul(-38)));
      mirror.addAssign(
        uGlitter
          .mul(path)
          .mul(glints.mul(5).add(0.4))
          .mul(clamp(things.a, 0, 1).oneMinus()),
      );

      // --- what lies under it ------------------------------------------------
      const bottom = vec3(0.045, 0.05, 0.06).toVar();
      if (opts.salt) {
        const bp = xz.add(slope.mul(5)).mul(0.82);
        const edge = crust(bp);
        const grain = texture(noise, bp.mul(0.21)).a;
        const ridge = smoothstep(0.0, 0.1, edge).oneMinus().mul(grain.mul(0.7).add(0.3));
        // only the first few metres are ever seen steeply enough to matter
        bottom.addAssign(
          vec3(0.2, 0.2, 0.22).mul(ridge).mul(smoothstep(3, 22, dist).oneMinus()),
        );
      }
      bottom.mulAssign(uAmbient);

      const cosT = max(dot(normal, V), 0);
      const fresnel = mix(float(0.6), float(1), pow(cosT.oneMinus(), 4));
      const col = mix(bottom, mirror.mul(vec3(0.94, 0.96, 0.985)), fresnel).toVar();
      // touched in the dark, the water answers with a cold light of its own
      col.addAssign(vec3(0.22, 0.74, 1.0).mul(sparkle.min(0.03)).mul(uNightGlow));

      // --- haze: the far water melts into the sky ----------------------------
      const fog = float(1).sub(exp(dist.mul(uFog).negate()));
      col.assign(mix(col, sky.horizon(V.negate()), fog));
      return vec4(col, 1);
    });

    const material = new MeshBasicNodeMaterial();
    material.colorNode = colour();
    material.fog = false;
    this.material = material;

    const mesh = new Mesh(new PlaneGeometry(1, 1), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.setScalar(16000);
    mesh.frustumCulled = false;
    // after the works, so they hide the water behind them before it is shaded
    mesh.renderOrder = 50;
    mesh.add(reflection.target);
    this.mesh = mesh;
  }

  /** The mirror pass draws layer 0 only (the sky is done analytically). */
  bindCamera(camera: PerspectiveCamera) {
    const virtual = this.reflection.reflector.getVirtualCamera(camera);
    virtual.layers.set(0);
  }

  /** A ring wave spreading from (x, z). */
  drop(x: number, z: number, strength: number) {
    const slot = this.drops.array[this.dropIndex] as Vector4;
    slot.set(x, z, this.uTime.value, strength);
    this.dropIndex = (this.dropIndex + 1) % DROPS;
  }

  setReducedMotion(reduced: boolean) {
    this.uSlope.value = reduced ? 0.035 : 0.055;
  }

  update(time: number, camera: PerspectiveCamera, sky: Sky) {
    this.uTime.value = time;
    this.mesh.position.set(camera.position.x, 0, camera.position.z);
    const v = (camera.fov * Math.PI) / 360;
    this.uProj.value.set(0.5 / (Math.tan(v) * camera.aspect), 0.5 / Math.tan(v));
    const sun = sky.sunDirection;
    this.uSunDir.value.copy(sun);
    const flat = Math.hypot(sun.x, sun.z) || 1;
    this.uSunXZ.value.set(sun.x / flat, sun.z / flat);
    // the glitter path dies as the sun sinks below the horizon
    const up = Math.max(0, Math.min(1, (sun.y + 0.035) / 0.05));
    this.uGlitter.value.copy(sky.glitterColor).multiplyScalar(up * up);
    this.uAmbient.value.copy(sky.ambientColor);
    this.uNightGlow.value = 16 * sky.starlight * sky.starlight;
  }

  dispose() {
    this.material.dispose();
    this.mesh.geometry.dispose();
    this.reflection.dispose?.();
  }
}
