// Stellar appearance is reconstructed around C++ mass parcels. These are NOT
// independently simulated stars; every sample is tied to its parcel's trajectory.
struct Frame {
  viewProjection: mat4x4<f32>, eye: vec4<f32>, right: vec4<f32>, up: vec4<f32>,
  settings: vec4<f32>, blackhole: vec4<f32>, resolution: vec4<f32>,
  reconstruction: vec4<f32>, population: vec4<f32>,
}
struct Particle { positionMass: vec4<f32>, velocityGroup: vec4<f32> }
@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var<storage, read> particles: array<Particle>;
@group(1) @binding(1) var<storage, read> previous: array<Particle>;
struct VertexOutput {
  @builtin(position) position: vec4<f32>, @location(0) local: vec2<f32>,
  @location(1) color: vec3<f32>, @location(2) strength: f32,
  @location(3) seed: f32,
}
fn random(seed: u32) -> f32 {
  var state = seed * 747796405u + 2891336453u;
  let shift = (state >> 28u) + 4u;
  state = ((state >> shift) ^ state) * 277803737u;
  state = (state >> 22u) ^ state;
  return f32(state) * (1.0 / 4294967296.0);
}
fn normal2(seed: u32) -> vec2<f32> {
  let r = sqrt(-2.0 * log(max(0.001, random(seed))));
  let angle = 6.2831853 * random(seed + 3719u);
  return r * vec2<f32>(cos(angle), sin(angle));
}
fn particleAt(index: u32) -> Particle {
  let t = frame.reconstruction.x;
  return Particle(mix(previous[index].positionMass, particles[index].positionMass, t), mix(previous[index].velocityGroup, particles[index].velocityGroup, t));
}
fn safeNormal(v: vec3<f32>, fallback: vec3<f32>) -> vec3<f32> { return select(fallback, v / max(length(v), 0.00001), dot(v, v) > 0.000001); }
fn cornerAt(vertex: u32) -> vec2<f32> {
  let corners = array<vec2<f32>, 6>(vec2<f32>(-1, -1), vec2<f32>(1, -1), vec2<f32>(-1, 1), vec2<f32>(-1, 1), vec2<f32>(1, -1), vec2<f32>(1, 1));
  return corners[vertex];
}
fn palette(radius: f32, secondary: bool, seed: f32) -> vec3<f32> {
  let oldPopulation = exp(-radius * 1.65);
  let arm = select(vec3<f32>(0.045, 0.34, 1.0), vec3<f32>(0.86, 0.42, 0.11), secondary);
  let youngStar = mix(arm, vec3<f32>(0.40, 0.69, 1.0), pow(seed, 7.0) * 0.30);
  return mix(youngStar, vec3<f32>(1.0, 0.56, 0.19), oldPopulation);
}
fn smoothing(radius: f32) -> f32 {
  // The reconstruction footprint decreases as the actual N-body resolution rises.
  // Never generate a separate spiral: all density comes from the input positions.
  return clamp((0.040 + radius * 0.038) * sqrt(8192.0 / max(128.0, frame.population.x)), 0.035, 0.80);
}
@vertex fn vertexMain(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> VertexOutput {
  let samples = u32(frame.reconstruction.y);
  let index = instance / samples;
  let sample = instance % samples;
  let particle = particleAt(index);
  let isCore = particle.velocityGroup.w >= 2.0;
  let secondary = (u32(particle.velocityGroup.w) % 2u) == 1u;
  let center = particleAt(select(0u, 1u, secondary));
  let relative = particle.positionMass.xyz - center.positionMass.xyz;
  let radius = length(relative);
  let seed = index * 26699u + sample * 3931u + 1129u;
  let starClass = random(seed + 911u);
  let localVelocity = particle.velocityGroup.xyz - center.velocityGroup.xyz;
  let radial = safeNormal(relative, vec3<f32>(1, 0, 0));
  let tangent = safeNormal(localVelocity, vec3<f32>(0, 0, 1));
  let normal = safeNormal(cross(radial, tangent), vec3<f32>(0, 1, 0));
  let along = safeNormal(cross(normal, radial), vec3<f32>(0, 0, 1));
  let jitter = normal2(seed);
  let vertical = normal2(seed + 971u).x;
  // Stratified luminous points follow each parcel in its local orbital plane.
  let footprint = smoothing(radius);
  var world = particle.positionMass.xyz + footprint * (radial * jitter.x + along * jitter.y + normal * vertical * 0.16);
  if (isCore) { world = particle.positionMass.xyz; }
  var clip = frame.viewProjection * vec4<f32>(world, 1.0);
  let distance = length(world - frame.eye.xyz);
  let pixelScale = frame.resolution.y / 1000.0;
  var pointRadius = clamp((1.35 + pow(starClass, 28.0) * 2.5) * frame.settings.z * 25.0 / max(distance, 8.0) * pixelScale, 0.68, 4.5);
  if (isCore) { pointRadius = clamp(11.0 * 25.0 / max(distance, 5.0) * pixelScale, 3.0, 28.0); }
  let corner = cornerAt(vertex);
  clip.x += corner.x * pointRadius * 2.0 / frame.resolution.x * clip.w;
  clip.y += corner.y * pointRadius * 2.0 / frame.resolution.y * clip.w;
  if ((isCore && sample > 0u) || clip.w < 0.0) { clip = vec4<f32>(2.0, 2.0, 0.0, 1.0); }
  var output: VertexOutput;
  output.position = clip;
  output.local = corner;
  output.color = palette(radius, secondary, starClass);
  // The point-spread flux is normalized for the visual sampling multiplier.
  output.strength = (0.060 + pow(starClass, 30.0) * 1.6) * (32.0 / f32(samples)) * particle.positionMass.w * 4096.0;
  if (isCore) { output.color = vec3<f32>(1.0, 0.77, 0.49); output.strength = 2.2; }
  output.seed = random(index * 1289u);
  return output;
}
@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let r2 = dot(input.local, input.local);
  let falloff = 1.0 - smoothstep(0.55, 1.0, r2);
  // A narrow luminous point plus a restrained optical halo; bloom remains separate.
  let profile = exp(-r2 * 21.0) + exp(-r2 * 6.0) * 0.018;
  return vec4<f32>(input.color * input.strength * profile * falloff, 0.0);
}
@vertex fn vertexDensity(@builtin(vertex_index) vertex: u32, @builtin(instance_index) index: u32) -> VertexOutput {
  let particle = particleAt(index);
  let secondary = (u32(particle.velocityGroup.w) % 2u) == 1u;
  let center = particleAt(select(0u, 1u, secondary));
  let radius = length(particle.positionMass.xyz - center.positionMass.xyz);
  let isCore = particle.velocityGroup.w >= 2.0;
  let corner = cornerAt(vertex);
  let footprint = select(smoothing(radius) * 4.8, 0.23, isCore);
  let world = particle.positionMass.xyz + (frame.right.xyz * corner.x + frame.up.xyz * corner.y) * footprint;
  var output: VertexOutput;
  output.position = frame.viewProjection * vec4<f32>(world, 1.0);
  output.local = corner;
  output.color = palette(radius, secondary, random(index * 719u));
  // Integrated emission scales with actual parcel mass, not sample count.
  // Grain is a display model, not gas, extinction, or a star-formation solver.
  output.strength = (0.014 * (0.55 + 0.45 * smoothstep(0.15, 0.85, radius))) * particle.positionMass.w * 4096.0 * (0.075 * 0.075) / max(0.002, smoothing(radius) * smoothing(radius));
  if (isCore) { output.strength = 0.12; output.color = vec3<f32>(1.0, 0.65, 0.28); }
  output.seed = random(index * 1999u);
  return output;
}
@fragment fn fragmentDensity(input: VertexOutput) -> @location(0) vec4<f32> {
  let r2 = dot(input.local, input.local);
  let falloff = 1.0 - smoothstep(0.50, 1.0, r2);
  let profile = exp(-r2 * 5.5) * falloff;
  let grain = 0.90 + 0.10 * sin(input.local.x * 15.0 + input.seed * 71.0) * sin(input.local.y * 13.0 - input.seed * 89.0);
  return vec4<f32>(input.color * input.strength * profile * grain, 0.0);
}
