import * as THREE from "three";
import { ROAD_HALF_WIDTH } from "./course";

export const PAPER = 0xf4f0e6;
export const INK = 0x2a2733;

export interface ToonOpts {
  emissive?: number;
  emissiveIntensity?: number;
  fog?: boolean;
  side?: THREE.Side;
}
export type ToonFactory = (hex: number, opts?: ToonOpts) => THREE.MeshToonMaterial;

export interface Renderer3 {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  sunDir: THREE.Vector3;
  toon: ToonFactory;
  terrainMaterial(): THREE.MeshToonMaterial;
  setSize(width: number, height: number): void;
  render(time: number, speedFactor: number): void;
  setMotion(enabled: boolean): void;
  updateShadowTarget(p: THREE.Vector3): void;
}

const compositeVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const compositeFragment = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform sampler2D tNormal;
uniform sampler2D tDepth;
uniform vec2 uRes;
uniform float uTime;
uniform float uNear;
uniform float uFar;
uniform float uSpeed;
uniform vec3 uInk;
uniform vec3 uLine;
uniform vec3 uMargin;
uniform float uMotion;
uniform float uPixelRatio;
varying vec2 vUv;
#include <packing>

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float viewDist(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  return -perspectiveDepthToViewZ(d, uNear, uFar);
}
vec3 viewNormal(vec2 uv) {
  return normalize(texture2D(tNormal, uv).xyz * 2.0 - 1.0);
}
float edgeAt(vec2 uv, float px) {
  vec2 t = px / uRes;
  float d0 = viewDist(uv);
  vec3 n0 = viewNormal(uv);
  float dd = 0.0;
  float nd = 0.0;
  vec2 o;
  o = vec2(t.x, 0.0);
  dd = max(dd, abs(viewDist(uv + o) - d0));
  nd = max(nd, 1.0 - dot(n0, viewNormal(uv + o)));
  o = vec2(-t.x, 0.0);
  dd = max(dd, abs(viewDist(uv + o) - d0));
  nd = max(nd, 1.0 - dot(n0, viewNormal(uv + o)));
  o = vec2(0.0, t.y);
  dd = max(dd, abs(viewDist(uv + o) - d0));
  nd = max(nd, 1.0 - dot(n0, viewNormal(uv + o)));
  o = vec2(0.0, -t.y);
  dd = max(dd, abs(viewDist(uv + o) - d0));
  nd = max(nd, 1.0 - dot(n0, viewNormal(uv + o)));
  float grazing = 1.0 - abs(n0.z);
  float thr = d0 * (0.010 + 0.09 * grazing * grazing) + 0.01;
  float depthEdge = smoothstep(thr, thr * 2.2, dd);
  float normalEdge = smoothstep(0.20, 0.45, nd);
  float e = max(depthEdge, normalEdge);
  e *= 0.2 + 0.8 * smoothstep(320.0, 60.0, d0);
  return e;
}
float hatch(vec2 p, float ang, float spacing, float width) {
  vec2 d = vec2(cos(ang), sin(ang));
  float s = dot(p, d);
  float f = abs(fract(s / spacing) - 0.5) * spacing;
  return 1.0 - smoothstep(width * 0.5, width * 0.5 + 0.9, f);
}
void main() {
  vec2 px = gl_FragCoord.xy / uPixelRatio;
  float frame = floor(uTime * 12.0) * uMotion;
  vec2 boilA = (vec2(vnoise(px * 0.013 + frame * 7.1), vnoise(px * 0.013 + frame * 3.7 + 51.0)) - 0.5) * 2.4;
  vec2 boilB = (vec2(vnoise(px * 0.021 + frame * 1.3 + 91.0), vnoise(px * 0.021 + frame * 5.9 + 131.0)) - 0.5) * 5.5;
  vec2 pxToUv = uPixelRatio / uRes;

  vec3 lin = texture2D(tColor, vUv + boilA * 0.3 * pxToUv).rgb;
  vec3 col = linearToOutputTexel(vec4(lin, 1.0)).rgb;
  float dCentre = viewDist(vUv);

  // Nothing drawn here: it is the notebook page itself.
  if (dCentre > uFar * 0.95) {
    float ly = abs(fract(px.y / 38.0 + 0.5) - 0.5) * 38.0;
    float line = 1.0 - smoothstep(0.7, 1.6, ly);
    col = mix(col, uLine, line * 0.6);
    float margin = 1.0 - smoothstep(0.9, 2.0, abs(px.x - 72.0));
    col = mix(col, uMargin, margin * 0.55);
  }

  float e1 = edgeAt(vUv + boilA * pxToUv, uPixelRatio);
  float e2 = edgeAt(vUv + boilB * pxToUv, uPixelRatio) * 0.35;
  float edge = clamp(max(e1, e2), 0.0, 1.0);

  float L = dot(col, vec3(0.299, 0.587, 0.114));
  vec2 hp = px + boilA * 0.8 + vec2(vnoise(px * 0.05 + frame) * 2.0);
  float h1 = hatch(hp, 0.78, 7.0, 1.2) * smoothstep(0.68, 0.50, L);
  float h2 = hatch(hp, -0.62, 8.0, 1.1) * smoothstep(0.44, 0.28, L);
  float hatching = clamp(h1 + h2, 0.0, 1.0) * 0.5;

  float grain = (vnoise(px * 0.9) - 0.5) * 0.10 + (vnoise(px * 0.21 + 7.0) - 0.5) * 0.05;
  col *= 1.0 + grain;

  if (uSpeed > 0.001) {
    vec2 c = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
    float ang = atan(c.y, c.x);
    float r = length(c);
    float seg = (ang + 3.14159) / 6.28318 * 110.0;
    float k = floor(seg);
    float rnd = hash12(vec2(k, frame + 3.0));
    float line = 1.0 - smoothstep(0.03, 0.10, abs(fract(seg) - 0.5));
    float start = 0.30 + rnd * 0.4 - uSpeed * 0.12;
    float sl = line * smoothstep(start, start + 0.05, r) * uSpeed;
    col = mix(col, uInk, sl * 0.8);
  }

  col = mix(col, uInk, hatching);
  col = mix(col, uInk, edge * 0.9);
  vec2 q = vUv - 0.5;
  col *= 1.0 - dot(q, q) * (0.3 + uSpeed * 0.35);
  gl_FragColor = vec4(col, 1.0);
}`;

const terrainFragmentHead = /* glsl */ `
#include <common>
varying float vRoad;
varying vec2 vMarks;
varying vec3 vWPos;
uniform vec3 uEdgeColor;
uniform vec3 uCentreColor;
uniform float uRoadW;
float gHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float gNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), f.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), f.x), f.y);
}`;

const terrainFragmentColor = /* glsl */ `
#include <color_fragment>
{
  float dist = length(vViewPosition);
  float fade = 1.0 - smoothstep(60.0, 240.0, dist);
  float lat = vMarks.x;
  float along = vMarks.y;
  float wl = fwidth(lat) * 1.2 + 0.01;
  float edgeLine = 1.0 - smoothstep(0.09, 0.09 + wl, abs(abs(lat) - (uRoadW - 0.45)));
  float centre = (1.0 - smoothstep(0.1, 0.1 + wl, abs(lat))) * step(fract(along / 8.0), 0.5);
  vec3 asphalt = diffuseColor.rgb * (1.0 - 0.06 * (gNoise(vWPos.xz * 1.7) - 0.5));
  asphalt = mix(asphalt, uEdgeColor, edgeLine * 0.9 * fade);
  asphalt = mix(asphalt, uCentreColor, centre * 0.9 * fade);
  vec3 offroad = diffuseColor.rgb * (1.0 - 0.1 * (gNoise(vWPos.xz * 0.9) - 0.5) - 0.06 * (gNoise(vWPos.xz * 0.25 + 3.0) - 0.5));
  diffuseColor.rgb = mix(offroad, asphalt, clamp(vRoad, 0.0, 1.0));
}`;

export function createRenderer(canvas: HTMLCanvasElement, mobile: boolean): Renderer3 {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    stencil: false,
    powerPreference: "high-performance",
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2);
  renderer.setPixelRatio(pixelRatio);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAPER);
  scene.fog = new THREE.Fog(PAPER, 130, 430);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.3, 900);

  const hemi = new THREE.HemisphereLight(0xfff6e0, 0xd9d0c0, 0.85);
  scene.add(hemi);
  const sunDir = new THREE.Vector3(-0.5, 0.78, 1.0).normalize();
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  const cam = sun.shadow.camera;
  cam.left = -34;
  cam.right = 34;
  cam.top = 34;
  cam.bottom = -34;
  cam.near = 1;
  cam.far = 200;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.08;
  scene.add(sun, sun.target);

  const steps = new Uint8Array([120, 190, 255]);
  const gradientMap = new THREE.DataTexture(steps, 3, 1, THREE.RedFormat);
  gradientMap.minFilter = THREE.NearestFilter;
  gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.generateMipmaps = false;
  gradientMap.needsUpdate = true;

  const toon: ToonFactory = (hex, opts = {}) => {
    const m = new THREE.MeshToonMaterial({ color: hex, gradientMap });
    if (opts.emissive !== undefined) {
      m.emissive.set(opts.emissive);
      m.emissiveIntensity = opts.emissiveIntensity ?? 1;
    }
    if (opts.fog === false) m.fog = false;
    if (opts.side !== undefined) m.side = opts.side;
    return m;
  };

  const terrainMaterial = (): THREE.MeshToonMaterial => {
    const m = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap, vertexColors: true });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uEdgeColor = { value: new THREE.Color(0xf6f3ea) };
      shader.uniforms.uCentreColor = { value: new THREE.Color(0xf1cf5c) };
      shader.uniforms.uRoadW = { value: ROAD_HALF_WIDTH };
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nattribute float road;\nattribute vec2 marks;\nvarying float vRoad;\nvarying vec2 vMarks;\nvarying vec3 vWPos;",
        )
        .replace(
          "#include <project_vertex>",
          "vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvRoad = road;\nvMarks = marks;\n#include <project_vertex>",
        );
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", terrainFragmentHead)
        .replace("#include <color_fragment>", terrainFragmentColor);
    };
    m.customProgramCacheKey = () => "rakugaki-terrain";
    return m;
  };

  const normalMat = new THREE.MeshNormalMaterial();
  let rtColor: THREE.WebGLRenderTarget | null = null;
  let rtNormal: THREE.WebGLRenderTarget | null = null;
  let bufferW = 1;
  let bufferH = 1;

  const uniforms = {
    tColor: { value: null as THREE.Texture | null },
    tNormal: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uNear: { value: camera.near },
    uFar: { value: camera.far },
    uSpeed: { value: 0 },
    uInk: { value: new THREE.Color(INK) },
    uLine: { value: new THREE.Color(0xa9c0e0) },
    uMargin: { value: new THREE.Color(0xe9a0a0) },
    uMotion: { value: 1 },
    uPixelRatio: { value: pixelRatio },
  };
  const composite = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: compositeVertex,
    fragmentShader: compositeFragment,
    depthTest: false,
    depthWrite: false,
  });
  const quadScene = new THREE.Scene();
  quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), composite));
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const makeTargets = (w: number, h: number) => {
    rtColor?.dispose();
    rtNormal?.dispose();
    const depthTexture = new THREE.DepthTexture(w, h);
    depthTexture.type = THREE.UnsignedIntType;
    rtColor = new THREE.WebGLRenderTarget(w, h, {
      samples: mobile ? 0 : 4,
      depthTexture,
      depthBuffer: true,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    rtNormal = new THREE.WebGLRenderTarget(w, h, {
      samples: 0,
      depthBuffer: true,
      stencilBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
    });
    uniforms.tColor.value = rtColor.texture;
    uniforms.tNormal.value = rtNormal.texture;
    uniforms.tDepth.value = depthTexture;
    uniforms.uRes.value.set(w, h);
  };

  const setSize = (width: number, height: number) => {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const w = Math.max(1, Math.floor(width * pixelRatio));
    const h = Math.max(1, Math.floor(height * pixelRatio));
    if (w !== bufferW || h !== bufferH || !rtColor) {
      bufferW = w;
      bufferH = h;
      makeTargets(w, h);
    }
  };

  const normalClear = new THREE.Color(0x8080ff);
  const render = (time: number, speedFactor: number) => {
    if (!rtColor || !rtNormal) return;
    uniforms.uTime.value = time;
    uniforms.uSpeed.value = speedFactor;
    uniforms.uNear.value = camera.near;
    uniforms.uFar.value = camera.far;
    renderer.shadowMap.needsUpdate = true;

    const bg = scene.background;
    scene.background = null;
    scene.overrideMaterial = normalMat;
    renderer.setClearColor(normalClear, 1);
    renderer.setRenderTarget(rtNormal);
    renderer.clear();
    renderer.render(scene, camera);
    scene.overrideMaterial = null;
    scene.background = bg;

    renderer.setRenderTarget(rtColor);
    renderer.clear();
    renderer.render(scene, camera);

    renderer.setRenderTarget(null);
    renderer.render(quadScene, quadCamera);
  };

  return {
    renderer,
    scene,
    camera,
    sun,
    sunDir,
    toon,
    terrainMaterial,
    setSize,
    render,
    setMotion(enabled) {
      uniforms.uMotion.value = enabled ? 1 : 0;
    },
    updateShadowTarget(p) {
      sun.target.position.copy(p);
      sun.position.copy(p).addScaledVector(sunDir, 90);
      sun.target.updateMatrixWorld();
    },
  };
}
