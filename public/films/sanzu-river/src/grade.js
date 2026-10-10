import * as THREE from 'three';

/** Final film pass: lens fringe, ACES, display-referred grade, vignette,
 *  1080p-locked grain and shot fades. It writes display sRGB to the canvas. */
export function createGradePass(ShaderPass) {
  const pass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null }, time: { value: 0 },
      exposure: { value: 1 }, fade: { value: 1 }, flash: { value: 0 },
      flashColor: { value: new THREE.Color().setRGB(1, .92, .80) },
      saturation: { value: .94 }, contrast: { value: 1.06 },
      lift: { value: new THREE.Vector3(.010, .015, .028) },
      shadowTint: { value: new THREE.Vector3(.86, .98, 1.16) },
      highlightTint: { value: new THREE.Vector3(1.06, 1.0, .90) },
      vignette: { value: .30 }, grain: { value: .016 }, aberration: { value: .0035 },
    },
    vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse;
      uniform float time, exposure, fade, flash, saturation, contrast, vignette, grain, aberration;
      uniform vec3 lift, shadowTint, highlightTint, flashColor;
      varying vec2 vUv;
      float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
      vec3 rrtOdt(vec3 v) { vec3 a = v * (v + .0245786) - .000090537; vec3 b = v * (.983729 * v + .4329510) + .238081; return a / b; }
      vec3 aces(vec3 c) {
        const mat3 inM = mat3(vec3(.59719, .07600, .02840), vec3(.35458, .90834, .13383), vec3(.04823, .01566, .83777));
        const mat3 outM = mat3(vec3(1.60475, -.10208, -.00327), vec3(-.53108, 1.10813, -.07276), vec3(-.07367, -.00605, 1.07602));
        return clamp(outM * rrtOdt(inM * (c / .6)), 0., 1.);
      }
      vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)); }
      void main() {
        vec2 p = vUv - .5;
        float r2 = dot(p, p);
        vec2 fringe = p * r2 * aberration;
        vec3 c = vec3(texture2D(tDiffuse, vUv - fringe).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv + fringe).b);
        // Tone-map, then grade in display space where a 0.5 pivot is perceptual.
        c = toSRGB(aces(c * exposure));
        float l = dot(c, vec3(.2126, .7152, .0722));
        // Ink-blue shadows, a faint warmth in the highlights.
        c = mix(c, c * shadowTint, (1. - smoothstep(.04, .42, l)) * .5);
        c = mix(c, c * highlightTint, smoothstep(.5, 1., l) * .45);
        // Desaturate cool foliage greens while keeping the crimson flowers rich.
        l = dot(c, vec3(.2126, .7152, .0722));
        float red = smoothstep(.10, .45, c.r - max(c.g, c.b));
        float green = smoothstep(.0, .08, c.g - max(c.r, c.b));
        c = mix(vec3(l), c, saturation * (1. + .16 * red) * (1. - .55 * green));
        c = (c - .45) * contrast + .45;
        c = clamp(c + lift * (1. - c), 0., 1.);
        c *= 1. - vignette * smoothstep(.10, .62, r2 * 1.55 + p.y * p.y * .35);
        c = mix(c, flashColor, flash);
        c *= fade;
        vec2 cell = floor(vUv * vec2(1920., 1080.));
        float g = hash(cell + floor(time * 30.) * vec2(37.1, 17.3)) + hash(cell * 1.7 + floor(time * 30.) * vec2(11.7, 53.9)) - 1.;
        float lum = dot(c, vec3(.2126, .7152, .0722));
        c += g * grain * (.45 + .9 * lum * (1. - lum) * 2.);
        gl_FragColor = vec4(c, 1.);
      }`,
  });
  return pass;
}
