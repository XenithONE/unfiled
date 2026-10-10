import * as THREE from 'three';

/** Crepuscular rays: the luminous far mist is smeared toward the afterglow,
 *  so the bridge rails and tree crowns cut dark shafts through it. */
export function createGodRayPass(ShaderPass, camera, sharedDepth) {
  const pass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null }, tDepth: { value: null },
      lightUv: { value: new THREE.Vector2(.5, .5) }, strength: { value: 0 },
      decay: { value: .972 }, span: { value: .82 }, farStart: { value: 70 },
      cameraNear: { value: camera.near }, cameraFar: { value: camera.far },
      rayColor: { value: new THREE.Color().setRGB(1, .72, .44) }, aspect: { value: 16 / 9 },
    },
    vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse, tDepth;
      uniform vec2 lightUv;
      uniform float strength, decay, span, farStart, cameraNear, cameraFar, aspect;
      uniform vec3 rayColor;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      float linearDepth(float d) { float z = d * 2. - 1.; return 2. * cameraNear * cameraFar / (cameraFar + cameraNear - z * (cameraFar - cameraNear)); }
      float source(vec2 uv) {
        float far = smoothstep(farStart, farStart * 1.7, linearDepth(texture2D(tDepth, uv).r));
        vec3 c = texture2D(tDiffuse, uv).rgb;
        return far * max(dot(c, vec3(.2126, .7152, .0722)) - .035, 0.);
      }
      void main() {
        vec3 base = texture2D(tDiffuse, vUv).rgb;
        if (strength <= 0.) { gl_FragColor = vec4(base, 1.); return; }
        vec2 delta = (vUv - lightUv) * span / 72.;
        vec2 uv = vUv - delta * hash(gl_FragCoord.xy);
        float illumination = 1., sum = 0.;
        for (int i = 0; i < 72; i++) {
          uv -= delta;
          float inside = step(0., uv.x) * step(uv.x, 1.) * step(0., uv.y) * step(uv.y, 1.);
          sum += source(clamp(uv, 0., 1.)) * illumination * inside;
          illumination *= decay;
        }
        vec2 q = (vUv - lightUv) * vec2(aspect, 1.);
        float falloff = 1. / (1. + 3.2 * dot(q, q));
        gl_FragColor = vec4(base + rayColor * sum / 72. * strength * falloff, 1.);
      }`,
  });
  pass.material.depthTest = false;
  pass.material.depthWrite = false;
  const projected = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const render = pass.render.bind(pass);
  pass.aim = (direction, strength) => {
    camera.getWorldDirection(forward);
    projected.copy(camera.position).addScaledVector(direction, 400).project(camera);
    pass.uniforms.lightUv.value.set(projected.x * .5 + .5, projected.y * .5 + .5);
    const facing = THREE.MathUtils.smoothstep(forward.dot(direction), .15, .55);
    pass.uniforms.strength.value = strength * facing;
  };
  pass.render = (renderer, writeBuffer, readBuffer, deltaTime, maskActive) => {
    pass.uniforms.tDepth.value = sharedDepth.texture;
    pass.uniforms.cameraNear.value = camera.near; pass.uniforms.cameraFar.value = camera.far;
    pass.uniforms.aspect.value = readBuffer.width / readBuffer.height;
    render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  };
  return pass;
}
