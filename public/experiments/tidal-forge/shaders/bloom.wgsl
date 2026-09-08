struct Frame {
  viewProjection: mat4x4<f32>, eye: vec4<f32>, right: vec4<f32>, up: vec4<f32>,
  settings: vec4<f32>, blackhole: vec4<f32>, resolution: vec4<f32>,
  reconstruction: vec4<f32>, population: vec4<f32>,
}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var linearSampler: sampler;
@group(1) @binding(1) var source: texture_2d<f32>;
struct VertexOutput { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> }
@vertex fn vertexMain(@builtin(vertex_index) vertex: u32) -> VertexOutput {
  let positions = array<vec2<f32>, 3>(vec2<f32>(-1, -1), vec2<f32>(3, -1), vec2<f32>(-1, 3));
  var output: VertexOutput;
  output.position = vec4<f32>(positions[vertex], 0, 1);
  output.uv = positions[vertex] * vec2<f32>(0.5, -0.5) + 0.5;
  return output;
}
fn sampleAt(uv: vec2<f32>, pixel: vec2<f32>, offset: vec2<f32>) -> vec3<f32> { return textureSampleLevel(source, linearSampler, uv + pixel * offset, 0.0).rgb; }
fn downsample(uv: vec2<f32>) -> vec3<f32> {
  let p = 1.0 / vec2<f32>(textureDimensions(source));
  // Normalized 13-tap low-pass filtering suppresses single-pixel bloom shimmer.
  var c = sampleAt(uv, p, vec2<f32>(0, 0)) * 0.125;
  c += (sampleAt(uv, p, vec2<f32>(-2, -2)) + sampleAt(uv, p, vec2<f32>(2, -2)) + sampleAt(uv, p, vec2<f32>(-2, 2)) + sampleAt(uv, p, vec2<f32>(2, 2))) * 0.03125;
  c += (sampleAt(uv, p, vec2<f32>(0, -2)) + sampleAt(uv, p, vec2<f32>(-2, 0)) + sampleAt(uv, p, vec2<f32>(2, 0)) + sampleAt(uv, p, vec2<f32>(0, 2))) * 0.0625;
  c += (sampleAt(uv, p, vec2<f32>(-1, -1)) + sampleAt(uv, p, vec2<f32>(1, -1)) + sampleAt(uv, p, vec2<f32>(-1, 1)) + sampleAt(uv, p, vec2<f32>(1, 1))) * 0.125;
  return c;
}
@fragment fn thresholdMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let radiance = downsample(input.uv);
  let brightness = max(radiance.r, max(radiance.g, radiance.b));
  let threshold = 0.65;
  let knee = 0.35;
  let soft = clamp(brightness - threshold + knee, 0.0, 2.0 * knee);
  let contribution = max(brightness - threshold, soft * soft / (4.0 * knee + 0.00001)) / max(brightness, 0.00001);
  return vec4<f32>(min(radiance * contribution, vec3<f32>(128.0)), 1.0);
}
@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> { return vec4<f32>(downsample(input.uv), 1.0); }
