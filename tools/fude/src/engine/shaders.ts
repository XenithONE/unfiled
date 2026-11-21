// 合成・表示・確定で共有する GLSL。
import { BLEND_GLSL } from "./blend";

export const HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;

/** 描き先の画素矩形 u_rect (x,y,w,h) を覆う四角形。u_tsize は描き先の大きさ。 */
export const RECT_VS = `#version 300 es
layout(location = 0) in vec2 a_pos;
uniform vec4 u_rect;
uniform vec2 u_tsize;
out vec2 v_px;
void main() {
  vec2 p = u_rect.xy + a_pos * u_rect.zw;
  v_px = p;
  gl_Position = vec4(p / u_tsize * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const HASH_GLSL = `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

/** レイヤー 1 枚を、合成中のタイルへ重ねる。 */
export const COMP_FS = `${HEADER}
uniform sampler2D u_dst;
uniform sampler2D u_src;
uniform ivec2 u_srcOff;
uniform sampler2D u_mask;
uniform int u_hasMask;
uniform ivec2 u_maskOff;
uniform int u_mode;
uniform float u_opacity;
uniform int u_atop;
uniform int u_tint;
uniform vec3 u_tintColor;
out vec4 o;
${BLEND_GLSL}
void main() {
  ivec2 tp = ivec2(gl_FragCoord.xy);
  vec4 d = texelFetch(u_dst, tp, 0);
  vec4 s = texelFetch(u_src, tp + u_srcOff, 0);
  if (u_tint == 1) s.rgb = u_tintColor * s.a;
  float m = u_opacity;
  if (u_hasMask == 1) m *= texelFetch(u_mask, tp + u_maskOff, 0).r;
  s *= m;
  o = u_atop == 1 ? blendAtop(d, s, u_mode) : blendOver(d, s, u_mode);
}
`;

/** 2 枚を不透明度で混ぜる（通過フォルダーの不透明度用）。 */
export const LERP_FS = `${HEADER}
uniform sampler2D u_a;
uniform sampler2D u_b;
uniform float u_t;
out vec4 o;
void main() {
  ivec2 tp = ivec2(gl_FragCoord.xy);
  o = mix(texelFetch(u_a, tp, 0), texelFetch(u_b, tp, 0), u_t);
}
`;

/** そのまま写す（オフセットつき）。 */
export const COPY_FS = `${HEADER}
uniform sampler2D u_src;
uniform ivec2 u_off;
out vec4 o;
void main() {
  o = texelFetch(u_src, ivec2(gl_FragCoord.xy) + u_off, 0);
}
`;

/** 筆跡バッファをレイヤーへ重ねる（表示の試しと確定で共通）。 */
export const MERGE_FS = `${HEADER}
uniform sampler2D u_layer;
uniform sampler2D u_stroke;
uniform sampler2D u_sel;
uniform sampler2D u_wet;
uniform ivec2 u_origin;
uniform ivec2 u_wetOff;
uniform int u_hasSel;
uniform int u_hasWet;
uniform float u_wetEdge;
uniform sampler2D u_grain;
uniform float u_grainScale;
uniform int u_mode;
uniform int u_erase;
uniform int u_alphaLock;
uniform int u_maskTarget;
uniform float u_opacity;
uniform float u_dither;
out vec4 o;
${BLEND_GLSL}
${HASH_GLSL}
void main() {
  ivec2 cp = ivec2(gl_FragCoord.xy) + u_origin;
  vec4 L = texelFetch(u_layer, cp, 0);
  vec4 S = texelFetch(u_stroke, cp, 0);
  if (u_hasWet == 1 && S.a > 1e-5) {
    // 水彩の縁: ぼかした不透明度より濃い所（筆跡の内側の縁）を濃く、中を少し薄く
    float ba = texelFetch(u_wet, ivec2(gl_FragCoord.xy) + u_wetOff, 0).a;
    float a = S.a;
    float edge = clamp(a - ba, 0.0, 1.0);
    float g = texture(u_grain, vec2(cp) / (512.0 * u_grainScale)).r;
    float na = a * (1.0 - u_wetEdge * 0.42) + edge * u_wetEdge * 2.6;
    na *= mix(1.0, 0.75 + 0.5 * g, u_wetEdge * 0.5);
    na = clamp(na, 0.0, 1.0);
    S = vec4(S.rgb / a * na, na);
  }
  S *= u_opacity;
  if (u_hasSel == 1) S *= texelFetch(u_sel, cp, 0).r;
  vec4 r;
  if (u_maskTarget == 1) {
    float v = L.r;
    float a = clamp(S.a, 0.0, 1.0);
    v = u_erase == 1 ? v * (1.0 - a) : v + (1.0 - v) * a;
    r = vec4(v, v, v, 1.0);
  } else if (u_erase == 1) {
    r = L * (1.0 - clamp(S.a, 0.0, 1.0));
  } else if (u_alphaLock == 1) {
    r = blendAtop(L, S, u_mode);
  } else {
    r = blendOver(L, S, u_mode);
  }
  if (u_dither > 0.0 && S.a > 0.0) {
    float n = (hash12(vec2(cp) + 0.37) - 0.5) / 255.0 * u_dither;
    r = clamp(r + vec4(n), 0.0, 1.0);
    if (u_maskTarget == 0) r.rgb = min(r.rgb, vec3(r.a));
  }
  o = r;
}
`;

/** 画面へ出す。キャンバスの外は作業台の色、透明は市松模様、選択範囲は動く点線。 */
export const DISPLAY_VS = `#version 300 es
layout(location = 0) in vec2 a_pos;
void main() { gl_Position = vec4(a_pos * 2.0 - 1.0, 0.0, 1.0); }
`;

export const DISPLAY_FS = `${HEADER}
uniform sampler2D u_comp;
uniform sampler2D u_sel;
uniform int u_hasSel;
uniform mat3 u_inv;
uniform vec2 u_screen;
uniform vec2 u_canvas;
uniform float u_zoom;
uniform float u_time;
uniform vec3 u_bg;
uniform int u_smoothPix;
out vec4 o;
${HASH_GLSL}
float selAt(vec2 p) {
  if (p.x < 0.0 || p.y < 0.0 || p.x >= u_canvas.x || p.y >= u_canvas.y) return 0.0;
  return texelFetch(u_sel, ivec2(p), 0).r;
}
void main() {
  vec2 s = vec2(gl_FragCoord.x, u_screen.y - gl_FragCoord.y);
  vec2 p = (u_inv * vec3(s, 1.0)).xy;
  vec3 col;
  bool inside = p.x >= 0.0 && p.y >= 0.0 && p.x < u_canvas.x && p.y < u_canvas.y;
  if (!inside) {
    vec2 q = max(max(-p, p - u_canvas), vec2(0.0));
    float dist = length(q) * u_zoom;
    float sh = exp(-dist / 10.0) * 0.45;
    col = u_bg * (1.0 - sh);
  } else {
    vec4 c;
    if (u_smoothPix == 1) {
      vec2 pix = p;
      vec2 seam = floor(pix + 0.5);
      vec2 dd = max(fwidth(pix), vec2(1e-4));
      pix = seam + clamp((pix - seam) / dd, -0.5, 0.5);
      c = texture(u_comp, pix / u_canvas);
    } else {
      c = texture(u_comp, p / u_canvas);
    }
    float ck = mod(floor(s.x / 8.0) + floor(s.y / 8.0), 2.0);
    vec3 checker = mix(vec3(0.80), vec3(0.94), ck);
    col = c.rgb + checker * (1.0 - clamp(c.a, 0.0, 1.0));
  }
  if (u_hasSel == 1) {
    vec2 ex = vec2(u_inv[0][0], u_inv[0][1]);
    vec2 ey = vec2(u_inv[1][0], u_inv[1][1]);
    bool v0 = selAt(p) > 0.5;
    bool v1 = selAt(p + ex) > 0.5;
    bool v2 = selAt(p + ey) > 0.5;
    bool v3 = selAt(p - ex) > 0.5;
    bool v4 = selAt(p - ey) > 0.5;
    if (v0 && (!v1 || !v2 || !v3 || !v4)) {
      float st = mod(floor((s.x + s.y + u_time * 24.0) / 5.0), 2.0);
      col = vec3(st);
    }
  }
  col += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  o = vec4(col, 1.0);
}
`;

/** 横か縦の一方向ガウスぼかし（u_dir = (1,0) か (0,1)）。読む元は texelFetch で範囲を切る。 */
export const BLUR_FS = `${HEADER}
uniform sampler2D u_src;
uniform ivec2 u_off;
uniform ivec2 u_srcMax;
uniform ivec2 u_dir;
uniform int u_radius;
uniform float u_sigma;
out vec4 o;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy) + u_off;
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int i = -64; i <= 64; i++) {
    if (i < -u_radius || i > u_radius) continue;
    float w = exp(-float(i * i) / (2.0 * u_sigma * u_sigma));
    ivec2 q = clamp(c + u_dir * i, ivec2(0), u_srcMax);
    acc += texelFetch(u_src, q, 0) * w;
    wsum += w;
  }
  o = acc / wsum;
}
`;
