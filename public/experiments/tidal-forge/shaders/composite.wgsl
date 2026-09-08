struct Frame {
  viewProjection: mat4x4<f32>, eye: vec4<f32>, right: vec4<f32>, up: vec4<f32>,
  settings: vec4<f32>, blackhole: vec4<f32>, resolution: vec4<f32>,
  reconstruction: vec4<f32>, population: vec4<f32>,
}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var linearSampler: sampler;
@group(1) @binding(1) var scene: texture_2d<f32>;
@group(1) @binding(2) var bloom0: texture_2d<f32>;
@group(1) @binding(3) var bloom1: texture_2d<f32>;
@group(1) @binding(4) var bloom2: texture_2d<f32>;
@group(1) @binding(5) var bloom3: texture_2d<f32>;
@group(1) @binding(6) var bloom4: texture_2d<f32>;
struct VertexOutput { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> }
@vertex fn vertexMain(@builtin(vertex_index) vertex: u32) -> VertexOutput {
  let points = array<vec2<f32>, 3>(vec2<f32>(-1, -1), vec2<f32>(3, -1), vec2<f32>(-1, 3));
  var output: VertexOutput;
  output.position = vec4<f32>(points[vertex], 0, 1);
  output.uv = points[vertex] * vec2<f32>(0.5, -0.5) + 0.5;
  return output;
}
fn filmic(x: vec3<f32>) -> vec3<f32> { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3<f32>(0.0), vec3<f32>(1.0)); }
fn toSrgb(x: vec3<f32>) -> vec3<f32> { return select(x * 12.92, 1.055 * pow(max(x, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.4)) - 0.055, x > vec3<f32>(0.0031308)); }
@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let uv = input.uv;
  let radiance = textureSampleLevel(scene, linearSampler, uv, 0.0).rgb;
  let glow = textureSampleLevel(bloom0, linearSampler, uv, 0.0).rgb * 0.24
           + textureSampleLevel(bloom1, linearSampler, uv, 0.0).rgb * 0.23
           + textureSampleLevel(bloom2, linearSampler, uv, 0.0).rgb * 0.21
           + textureSampleLevel(bloom3, linearSampler, uv, 0.0).rgb * 0.18
           + textureSampleLevel(bloom4, linearSampler, uv, 0.0).rgb * 0.14;
  let hdr = max(vec3<f32>(0.0), (radiance + glow * frame.reconstruction.z * 1.65) * frame.settings.y);
  let mapped = toSrgb(filmic(hdr));
  // Fixed sub-LSB dither reduces banding. It does not flicker with simulation time.
  let dither = (fract(sin(dot(input.position.xy, vec2<f32>(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  return vec4<f32>(clamp(mapped + dither, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
