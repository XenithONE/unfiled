import * as THREE from 'three';

// Equinox dusk (逢魔が時). The sun has just set due west, the direction of the
// Pure Land; the river runs toward that last light. One direction is shared by
// the sky, the low key light, the mist phase function and the water glints.
export const AFTERGLOW_DIRECTION = new THREE.Vector3(.07, .045, -1).normalize();

const vertexShader = /* glsl */`
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.);
    gl_Position = p.xyww;
  }`;

const fragmentShader = /* glsl */`
  uniform vec3 glowDirection;
  uniform float glow;        // 1 at dusk, falls to 0 as night closes the crossing
  uniform float time;
  varying vec3 vDirection;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0., a = .5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(17.3, 9.1); a *= .5; }
    return v;
  }

  void main() {
    vec3 d = normalize(vDirection);
    float e = d.y, up = max(e, 0.);
    vec2 sun = normalize(glowDirection.xz);
    float cosA = dot(normalize(d.xz + vec2(1e-5)), sun);
    float toward = max(cosA, 0.), away = max(-cosA, 0.);

    // Deep indigo zenith over a cold slate horizon.
    vec3 col = mix(vec3(.030, .040, .060), vec3(.0105, .016, .034), smoothstep(0., .42, up));
    col = mix(col, vec3(.0045, .006, .016), smoothstep(.35, 1., up));

    // Afterglow: a thin ember line on the horizon, a wider gold-rose fan above.
    float line = exp(-up / .022) * pow(toward, 9.);
    float fan = exp(-up / .085) * pow(toward, 3.2);
    float veil = exp(-up / .30) * pow(toward, 1.4);
    col += glow * (vec3(2.2, .62, .16) * line + vec3(.30, .072, .040) * fan + vec3(.040, .012, .034) * veil);

    // Opposite the sunset: the blue earth shadow and the faint Belt of Venus.
    col += glow * pow(away, 1.6) * vec3(.040, .016, .030) * exp(-pow((up - .085) / .055, 2.));
    col *= 1. - .22 * glow * pow(away, 2.) * exp(-up / .045);

    // A high, broken cloud deck lit from beneath by the sunken sun.
    if (e > .004) {
      vec2 deck = d.xz / (e + .06);
      vec2 streak = vec2(deck.x * .55 + deck.y * .14, deck.y * .19 - deck.x * .05);
      float c = fbm(streak * 1.25 + vec2(time * .006, 0.)) - .5 * fbm(streak * 4.1 - 3.7);
      float cover = smoothstep(.20, .52, c) * smoothstep(.012, .09, e) * (1. - smoothstep(.55, .95, e));
      vec3 lit = mix(vec3(.008, .010, .020), vec3(.62, .16, .07), pow(toward, 2.6) * exp(-up / .16));
      lit += vec3(.09, .025, .045) * pow(toward, 1.2) * exp(-up / .35);
      col = mix(col, lit * (.35 + .65 * glow), cover * .82);
    }

    // The evening star above the glow, then a few early stars overhead.
    vec3 venus = normalize(vec3(-.30, .17, -1.));
    col += vec3(5., 4.6, 4.) * smoothstep(.9999990, .9999998, dot(d, venus)) * (.6 + .4 * glow);
    vec2 cell = floor(vec2(atan(d.z, d.x) * 210., e * 260.));
    float s = hash(cell);
    float star = step(.9965, s) * smoothstep(.10, .45, e) * (1. - .7 * glow);
    vec2 f = fract(vec2(atan(d.z, d.x) * 210., e * 260.)) - .5;
    col += star * vec3(.9, .95, 1.1) * .55 * smoothstep(.16, .0, length(f));

    // Below the horizon only the far, cold ground haze is ever visible.
    col = mix(col, vec3(.016, .021, .032) + glow * vec3(.10, .032, .012) * pow(toward, 6.), smoothstep(.0, -.035, e));
    gl_FragColor = vec4(col, 1.);
  }`;

export function createTwilightSky() {
  const material = new THREE.ShaderMaterial({
    name: 'Equinox dusk sky',
    uniforms: { glowDirection: { value: AFTERGLOW_DIRECTION.clone() }, glow: { value: 1 }, time: { value: 0 } },
    vertexShader, fragmentShader, side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(560, 64, 32), material);
  dome.name = 'Twilight dome — afterglow in the west';
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  return dome;
}

/** A pre-filtered environment from the same sky, so reflections share its light. */
export function createSkyEnvironment(renderer, glow = 1) {
  const sky = createTwilightSky();
  sky.material.uniforms.glow.value = glow;
  sky.material.depthTest = false;
  const scene = new THREE.Scene();
  scene.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0, .1, 1000);
  pmrem.dispose();
  sky.geometry.dispose(); sky.material.dispose();
  return target.texture;
}
