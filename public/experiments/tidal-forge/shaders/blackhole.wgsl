// Schwarzschild null geodesics in their orbital plane, Rs = 1:
// u'' + u = 1.5 u^2, u = 1/r, prime = d/d orbital angle.
// Adaptive angular RK4; exact static-observer camera tetrad. No Kerr spin.
// A thin optically thick disk is intersected at exact orbital-plane angles.
// Emission is an illustrative advected texture, not a GRMHD solution.
struct Frame {
  viewProjection: mat4x4<f32>, eye: vec4<f32>, right: vec4<f32>, up: vec4<f32>,
  settings: vec4<f32>, blackhole: vec4<f32>, resolution: vec4<f32>,
}
@group(0) @binding(0) var<uniform> frame: Frame;
struct VertexOutput { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> }
@vertex fn vertexMain(@builtin(vertex_index) vertex: u32) -> VertexOutput {
  let points = array<vec2<f32>, 3>(vec2<f32>(-1, -1), vec2<f32>(3, -1), vec2<f32>(-1, 3));
  var output: VertexOutput;
  output.position = vec4<f32>(points[vertex], 0, 1);
  output.uv = points[vertex];
  return output;
}
fn hash(p: vec2<f32>) -> f32 { return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453); }
fn hash3(p: vec3<f32>) -> f32 {
  var q = fract(p * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
fn noise3(p: vec3<f32>) -> f32 {
  let c = floor(p);
  let f = fract(p);
  let q = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(c), hash3(c + vec3<f32>(1, 0, 0)), q.x),
        mix(hash3(c + vec3<f32>(0, 1, 0)), hash3(c + vec3<f32>(1, 1, 0)), q.x), q.y),
    mix(mix(hash3(c + vec3<f32>(0, 0, 1)), hash3(c + vec3<f32>(1, 0, 1)), q.x),
        mix(hash3(c + vec3<f32>(0, 1, 1)), hash3(c + vec3<f32>(1, 1, 1)), q.x), q.y), q.z);
}
fn sky(direction: vec3<f32>) -> vec3<f32> {
  // Cube-direction noise avoids a polar longitude seam in the distant haze.
  let dust = noise3(direction * 7.0 + vec3<f32>(13, 5, 29));
  let band = pow(max(0.0, 1.0 - abs(direction.y * 0.9 + direction.x * 0.18)), 28.0);
  let angular = vec2<f32>(atan2(direction.z, direction.x) / 6.2831853, asin(clamp(direction.y, -1.0, 1.0)) / 3.1415926);
  let grid = angular * vec2<f32>(900, 450);
  let cell = floor(grid);
  let seed = hash(cell);
  let delta = fract(grid) - vec2<f32>(hash(cell + 10.3), hash(cell + 41.7));
  let width = 0.052 + seed * 0.020;
  let star = exp(-dot(delta, delta) / (width * width)) * step(0.975, seed);
  return vec3<f32>(0.0005, 0.0011, 0.0025)
       + vec3<f32>(0.0016, 0.0032, 0.0060) * band * dust
       + mix(vec3<f32>(0.38, 0.51, 0.75), vec3<f32>(0.88, 0.67, 0.42), hash(cell + 2.7)) * star;
}
fn orbitDerivative(state: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(state.y, 1.5 * state.x * state.x - state.x);
}
fn orbitStep(state: vec2<f32>, h: f32) -> vec2<f32> {
  let a = orbitDerivative(state);
  let b = orbitDerivative(state + 0.5 * h * a);
  let c = orbitDerivative(state + 0.5 * h * b);
  let d = orbitDerivative(state + h * c);
  return state + h * (a + 2.0 * b + 2.0 * c + d) / 6.0;
}
struct RayHit {
  position: vec3<f32>, disk: f32,
  localDirection: vec3<f32>, observerMetric: f32,
  background: vec3<f32>, unused: f32,
}
fn traceRay(uv: vec2<f32>) -> RayHit {
  let inclination = clamp(frame.blackhole.x + (frame.resolution.w - 0.78) * 0.35, 0.02, 1.55);
  let azimuth = frame.resolution.z - 0.20;
  let observerRadius = clamp(frame.settings.w / 38.0 * 30.0, 16.0, 110.0);
  let radial = vec3<f32>(sin(azimuth) * sin(inclination), cos(inclination), cos(azimuth) * sin(inclination));
  let forward = -radial;
  let right = normalize(cross(forward, vec3<f32>(0, 1, 0)));
  let up = cross(right, forward);
  let screen = (right * uv.x + up * uv.y) * 0.41421356;
  let localRay = normalize(forward + screen);
  let radialRay = dot(localRay, radial);
  let transverse = localRay - radialRay * radial;
  let transverseLength = length(transverse);
  let observerMetric = 1.0 - 1.0 / observerRadius;
  // E = 1 affine normalization: b = L/E = R sin(alpha)/sqrt(f_observer).
  let impact = observerRadius * transverseLength / sqrt(observerMetric);
  var hit = RayHit(vec3<f32>(0), 0.0, vec3<f32>(0, 1, 0), observerMetric, vec3<f32>(0), 0.0);
  if (impact < 0.00001) { return hit; }
  let tangent = transverse / transverseLength;
  var state = vec2<f32>(1.0 / observerRadius, -radialRay / impact);
  var angle = 0.0;
  // All disk crossings are separated by pi in this orbit's plane. Splitting a
  // step at the crossing avoids straight-segment intersection error/striping.
  var diskAngle = atan2(-radial.y, tangent.y);
  if (diskAngle <= 0.000001) { diskAngle += 3.1415926536; }
  let maximumSteps = u32(clamp(frame.blackhole.z, 96.0, 256.0));
  let baseStep = 12.8 / f32(maximumSteps);
  for (var stepIndex = 0u; stepIndex < 256u; stepIndex++) {
    if (stepIndex >= maximumSteps) { break; }
    // Limit fractional radial variation away from the photon orbit. Around
    // u = 2/3 the bounded angular step resolves repeated windings efficiently.
    var h = min(baseStep, 0.22 * max(state.x, 0.012) / max(abs(state.y), 0.02));
    let crossesDisk = angle + h >= diskAngle;
    if (crossesDisk) { h = diskAngle - angle; }
    let previous = state;
    state = orbitStep(state, h);
    angle += h;
    if (state.x >= 1.0 / 1.001) { return hit; }
    if (state.x <= 0.0) {
      let infinityAngle = angle - h + h * previous.x / max(previous.x - state.x, 0.0000001);
      hit.background = sky(radial * cos(infinityAngle) + tangent * sin(infinityAngle));
      return hit;
    }
    if (crossesDisk) {
      let radius = 1.0 / state.x;
      if (radius >= 3.0 && radius <= 12.0) {
        let p = radial * cos(angle) + tangent * sin(angle);
        let t = -radial * sin(angle) + tangent * cos(angle);
        hit.position = p * radius;
        hit.disk = 1.0;
        // Coordinate radial momentum / local energy reduces to -b u'.
        // The local transverse direction carries sqrt(1 - 1/r).
        hit.localDirection = normalize(impact * (-state.y * p + sqrt(1.0 - state.x) * state.x * t));
        return hit;
      }
      diskAngle += 3.1415926536;
    }
  }
  // Only arbitrarily near-critical rays can exhaust the orbit budget. Use the
  // exact capture separatrix to avoid inventing an enlarged numerical shadow.
  // Escaping fallback sky has an approximate direction; higher-order disk
  // crossings beyond the bounded trace remain unresolved (see model notes).
  if (impact > 2.5980762114) {
    hit.background = sky(radial * cos(angle) + tangent * sin(angle));
  }
  return hit;
}
fn diskTurbulence(radius: f32, phi: f32, age: f32, seed: f32, radialFootprint: f32, angularFootprint: f32) -> f32 {
  let omega = 0.30 / pow(radius / 3.0, 1.5);
  let phase = phi - omega * age;
  let circle = vec2<f32>(cos(phase), sin(phase));
  let advectedFootprint = angularFootprint + 1.5 * omega * age / radius * radialFootprint;
  let offset = vec3<f32>(seed * 41.7, seed * 73.3 + 17.0, seed * 19.6);
  let broadWidth = vec2<f32>(radialFootprint * 0.62, advectedFootprint * 2.2);
  let broad = mix(0.5, noise3(vec3<f32>(circle * 2.2, radius * 0.62) + offset), exp(-1.2 * dot(broadWidth, broadWidth)));
  let warp = radius + 0.32 * (broad - 0.5);
  let coarseRaw = noise3(vec3<f32>(circle * 4.5, warp * 3.5) + offset.zyx);
  let middleRaw = noise3(vec3<f32>(circle * 11.0 + broad * 0.6, warp * 10.0) + offset.yzx);
  let fineRaw = noise3(vec3<f32>(circle * 22.0, warp * 22.0 + coarseRaw * 1.2) + offset);
  let coarseWidth = vec2<f32>(radialFootprint * 3.5, advectedFootprint * 4.5);
  let middleWidth = vec2<f32>(radialFootprint * 10.0, advectedFootprint * 11.0);
  let fineWidth = vec2<f32>(radialFootprint * 22.0, advectedFootprint * 22.0);
  let coarseWeight = exp(-1.2 * dot(coarseWidth, coarseWidth));
  let middleWeight = exp(-1.2 * dot(middleWidth, middleWidth));
  let fineWeight = exp(-1.2 * dot(fineWidth, fineWidth));
  let coarse = mix(0.5, coarseRaw, coarseWeight);
  // Filter nonlinear ridge intensity toward its average, not its maximum.
  let braid = mix(0.25, pow(clamp(1.0 - abs(2.0 * middleRaw - 1.0), 0.0, 1.0), 9.0), middleWeight);
  let filament = mix(0.17, pow(max(0.0, coarseRaw * 1.65 - 0.28), 3.0), coarseWeight);
  let fine = mix(0.28, fineRaw * fineRaw, fineWeight);
  // Sparse hot strands and dark troughs retain visible structure after bloom
  // and the HDR shoulder; most of the disk stays below the white highlight.
  return 0.025 + 3.7 * filament * (0.16 + 2.0 * braid) * (0.22 + 1.65 * broad * broad)
               + 0.12 * fine * coarse;
}
fn diskEmission(hit: RayHit, radialFootprint: f32, angularFootprint: f32) -> vec3<f32> {
  let position = hit.position;
  let radius = length(position.xz);
  let phi = atan2(position.z, position.x);
  let massRatio = max(frame.blackhole.y, 0.0001);
  // Two overlapping turbulence populations are born and fade continuously.
  // Their finite lifetimes prevent differential shear from winding every
  // feature below pixel size after a minute. This is procedural turbulence,
  // not a simulation of magnetic stresses or self-consistent fluid evolution.
  let cycle = frame.settings.x / massRatio / 10.0;
  let ageA = fract(cycle);
  let ageB = fract(cycle + 0.5);
  let weightA = pow(sin(3.1415926536 * ageA), 2.0);
  let seedA = hash(vec2<f32>(floor(cycle), 19.7));
  let seedB = hash(vec2<f32>(floor(cycle + 0.5), 73.1));
  let ribbons = weightA * diskTurbulence(radius, phi, ageA * 10.0, seedA, radialFootprint, angularFootprint)
              + (1.0 - weightA) * diskTurbulence(radius, phi, ageB * 10.0, seedB, radialFootprint, angularFootprint);
  let innerFade = smoothstep(3.0, 3.20, radius);
  let outerFade = 1.0 - smoothstep(8.5, 12.0, radius);
  // Zero-torque thin-disk radial flux shape, normalized near its maximum.
  // Color and contrast remain artist-directed; this is not a spectral solver.
  let flux = pow(3.0 / radius, 3.0) * (1.0 - sqrt(3.0 / radius)) / 0.05665;
  let temperature = pow(max(flux, 0.0), 0.25);
  let tangent = normalize(vec3<f32>(-position.z, 0.0, position.x));
  let beta = sqrt(0.5 / (radius - 1.0));
  let gamma = inverseSqrt(1.0 - beta * beta);
  let shift = sqrt((1.0 - 1.0 / radius) / hit.observerMetric)
            / (gamma * (1.0 - beta * dot(tangent, -hit.localDirection)));
  let tintTemperature = clamp(temperature * shift, 0.0, 1.3);
  let warm = mix(vec3<f32>(1.0, 0.19, 0.026), vec3<f32>(1.0, 0.65, 0.26), smoothstep(0.28, 0.85, tintTemperature));
  let thermalColor = mix(warm, vec3<f32>(1.0, 0.92, 0.77), smoothstep(0.74, 1.22, tintTemperature));
  let emission = 3.0 * pow(max(flux, 0.0), 1.25) * innerFade * outerFade * ribbons;
  return thermalColor * emission * pow(shift, 3.0);
}
@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let uv = input.uv * vec2<f32>(frame.blackhole.w, 1.0);
  let hit = traceRay(uv);
  // Derivatives execute uniformly after tracing, even where no disk was hit.
  // Suppress unresolved procedural octaves instead of aliasing radial rings.
  let radius = length(hit.position.xz);
  let radialFootprint = abs(dpdx(radius)) + abs(dpdy(radius));
  let circle = hit.position.xz / max(radius, 0.001);
  let angularFootprint = length(dpdx(circle)) + length(dpdy(circle));
  var color = hit.background;
  if (hit.disk > 0.0) { color = diskEmission(hit, radialFootprint, angularFootprint); }
  // Scene-linear HDR. Exposure, bloom, filmic mapping, and output transfer are
  // performed exactly once by the shared post-processing pipeline.
  return vec4<f32>(color, 1.0);
}
