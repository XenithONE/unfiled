import * as THREE from 'three';

// 鬼火: small cold flames that wander above the flowers of the far bank.
// Billboards in view space; every motion is a pure function of film time.
export function createOnibi(placements) {
  const count = placements.length;
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = new THREE.PlaneGeometry(1, 1).index;
  geometry.setAttribute('position', new THREE.PlaneGeometry(1, 1).attributes.position);
  geometry.setAttribute('uv', new THREE.PlaneGeometry(1, 1).attributes.uv);
  const center = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const params = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  geometry.setAttribute('center', center);
  geometry.setAttribute('params', params);
  geometry.instanceCount = count;
  const material = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: /* glsl */`
      attribute vec3 center; attribute vec4 params; // size, phase, intensity, stretch
      varying vec2 vUv; varying vec4 vParams;
      void main() {
        vec4 view = modelViewMatrix * vec4(center, 1.);
        view.xy += position.xy * vec2(params.x, params.x * params.w);
        vUv = uv; vParams = params;
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: /* glsl */`
      uniform float time;
      varying vec2 vUv; varying vec4 vParams;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        vec2 p = vUv * 2. - 1.;
        float phase = vParams.y;
        p.y += .30;
        float rise = max(p.y, 0.);
        float wobble = (noise(vec2(p.y * 2.6 - time * 3.1 + phase * 7., phase)) - .5) * .55 * rise;
        vec2 q = vec2((p.x - wobble) * (1. + rise * 2.4), p.y < 0. ? p.y * 1.15 : p.y * .42);
        float r = length(q);
        float core = exp(-r * r * 26.);
        float body = exp(-r * r * 6.5);
        float halo = exp(-length(p) * 3.2) * .22;
        float shimmer = .82 + .18 * noise(vec2(time * 5.3 + phase * 3., phase));
        vec3 col = vec3(.30, .62, 1.0) * (body * .85 + halo) + vec3(.85, .97, 1.) * core * 1.9;
        gl_FragColor = vec4(col * vParams.z * shimmer, 1.);
      }`,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Onibi — cold wandering spirit flames';
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  const lights = placements.map(() => ({ position: new THREE.Vector3(), color: new THREE.Color(), power: 0 }));
  const cold = new THREE.Color().setRGB(.30, .62, 1.0);
  mesh.userData.update = (t, visibility = 1) => {
    material.uniforms.time.value = t;
    placements.forEach((s, i) => {
      const a = s.phase;
      const x = s.position[0] + .55 * Math.sin(t * .23 + a) + .18 * Math.sin(t * .61 + 2 * a);
      const y = s.position[1] + .16 * Math.sin(t * .47 + 1.3 * a) + .05 * Math.sin(t * 1.9 + a);
      const z = s.position[2] + .45 * Math.cos(t * .19 + .7 * a) + .14 * Math.sin(t * .73 + a);
      const pulse = .72 + .28 * Math.sin(t * .9 + 3 * a) * Math.sin(t * .37 + a);
      const v = s.window ? s.window(t) : 1;
      center.setXYZ(i, x, y, z);
      params.setXYZW(i, s.size, a, s.intensity * pulse * v * visibility, 1.55);
      lights[i].position.set(x, y, z);
      lights[i].color.copy(cold).multiplyScalar(s.intensity * pulse * v * visibility * .55);
      lights[i].power = s.intensity * pulse * v * visibility * .55;
    });
    center.needsUpdate = true; params.needsUpdate = true;
    return lights;
  };
  mesh.userData.lights = lights;
  return mesh;
}
