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
fn stars(coordinate: vec2<f32>, frequency: f32, threshold: f32) -> vec3<f32> {
  let cell = floor(coordinate * frequency);
  let r = hash(cell);
  let offset = vec2<f32>(hash(cell + 19.71), hash(cell + 71.31)) * 0.70 + 0.15;
  let delta = fract(coordinate * frequency) - offset;
  let pixel = max(length(fwidth(coordinate * frequency)), 0.002);
  let width = max(0.009 + pow(r, 12.0) * 0.004, pixel * 0.35);
  let star = exp(-dot(delta, delta) / (width * width)) * step(threshold, r);
  let color = mix(vec3<f32>(0.50, 0.66, 0.90), vec3<f32>(1.0, 0.75, 0.46), hash(cell + 511.7));
  let brightness = 0.025 + pow(hash(cell + 811.3), 11.0) * 0.90;
  return color * star * brightness;
}
@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let screen = input.uv * vec2<f32>(frame.blackhole.w, 1.0);
  let forward = -normalize(frame.eye.xyz);
  let ray = normalize(forward + (frame.right.xyz * screen.x + frame.up.xyz * screen.y) * 0.41421356);
  let celestial = vec2<f32>(atan2(ray.z, ray.x), asin(clamp(ray.y, -1.0, 1.0)));
  let sky = stars(celestial, 160.0, 0.986) + stars(celestial + 9.71, 360.0, 0.995) * 0.45;
  return vec4<f32>(vec3<f32>(0.00024, 0.00040, 0.00070) + sky, 1.0);
}
