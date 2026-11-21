// 筆の設定と、最初から入っている筆（サブツール）。
// 大きさは直径の画素。入り抜きは「大きさの何倍の長さ」。

export type ToolGroup = "pen" | "pencil" | "brush" | "airbrush" | "deco" | "eraser" | "blend";
export type BrushEngine = "stamp" | "water" | "mix" | "smudge" | "blur";
export type AngleMode = "fixed" | "direction" | "random" | "tilt";

export const TIP_IDS = ["round", "chalk", "bristle", "flat", "star", "leaf", "sparkle", "splatter", "grass", "heart", "cloud", "square", "petal", "dryink"] as const;
export type TipId = (typeof TIP_IDS)[number];
export const TIP_NAMES: Record<TipId, string> = {
  round: "丸",
  chalk: "チョーク",
  bristle: "毛束",
  flat: "平筆",
  star: "星",
  leaf: "葉",
  sparkle: "きらめき",
  splatter: "しぶき",
  grass: "草",
  heart: "ハート",
  cloud: "雲",
  square: "四角",
  petal: "花びら",
  dryink: "かすれ",
};

export const GRAIN_IDS = ["none", "paper", "canvas", "rough", "noise", "streak"] as const;
export type GrainId = (typeof GRAIN_IDS)[number];
export const GRAIN_NAMES: Record<GrainId, string> = {
  none: "なし",
  paper: "画用紙",
  canvas: "キャンバス布",
  rough: "水彩紙（荒目）",
  noise: "ざらざら",
  streak: "筋",
};

export interface BrushSettings {
  id: string;
  name: string;
  tool: ToolGroup;
  engine: BrushEngine;
  size: number;
  sizePressure: boolean;
  sizeMin: number;
  opacity: number;
  opacityPressure: boolean;
  opacityMin: number;
  flow: number;
  flowPressure: boolean;
  flowMin: number;
  hardness: number;
  spacing: number;
  tip: TipId;
  angle: number;
  angleMode: AngleMode;
  angleJitter: number;
  roundness: number;
  grain: GrainId;
  grainScale: number;
  grainStrength: number;
  /** 粒子（散布）: 0 で通常。>0 なら 1 粒の半径＝大きさ×この値で、大きさの円の中に散らす。 */
  particle: number;
  count: number;
  sizeJitter: number;
  opacityJitter: number;
  hueJitter: number;
  satJitter: number;
  valJitter: number;
  accumulate: "over" | "max";
  blend: string;
  erase: boolean;
  taperIn: number;
  taperOut: number;
  stabilize: number;
  velocityThin: number;
  /** 混色: 下の色をどれだけ混ぜるか（色延び）。 */
  mixAmount: number;
  /** 混色: 運ぶ色をどれだけ速く入れ替えるか。 */
  pickup: number;
  /** 指先・ぼかしの強さ。 */
  strength: number;
  /** 水彩の縁の濃さ。 */
  wetEdge: number;
  /** 油彩の絵の具が無くなるまでの長さ（画素）。0 で無くならない。 */
  paintLoad: number;
}

const BASE: BrushSettings = {
  id: "",
  name: "",
  tool: "pen",
  engine: "stamp",
  size: 10,
  sizePressure: true,
  sizeMin: 0.2,
  opacity: 1,
  opacityPressure: false,
  opacityMin: 0,
  flow: 1,
  flowPressure: false,
  flowMin: 0,
  hardness: 1,
  spacing: 0.08,
  tip: "round",
  angle: 0,
  angleMode: "fixed",
  angleJitter: 0,
  roundness: 1,
  grain: "none",
  grainScale: 1,
  grainStrength: 0,
  particle: 0,
  count: 1,
  sizeJitter: 0,
  opacityJitter: 0,
  hueJitter: 0,
  satJitter: 0,
  valJitter: 0,
  accumulate: "max",
  blend: "normal",
  erase: false,
  taperIn: 0,
  taperOut: 0,
  stabilize: 10,
  velocityThin: 0,
  mixAmount: 0,
  pickup: 0,
  strength: 0,
  wetEdge: 0,
  paintLoad: 0,
};

function b(o: Partial<BrushSettings> & Pick<BrushSettings, "id" | "name" | "tool">): BrushSettings {
  return { ...BASE, ...o };
}

export const TOOL_GROUPS: { id: ToolGroup; name: string; key: string }[] = [
  { id: "pen", name: "ペン", key: "P" },
  { id: "pencil", name: "鉛筆", key: "N" },
  { id: "brush", name: "筆", key: "B" },
  { id: "airbrush", name: "エアブラシ", key: "A" },
  { id: "deco", name: "デコレーション", key: "D" },
  { id: "eraser", name: "消しゴム", key: "E" },
  { id: "blend", name: "色混ぜ", key: "J" },
];

export const PRESETS: BrushSettings[] = [
  // ---- ペン ----
  b({ id: "gpen", name: "Gペン", tool: "pen", size: 8, sizeMin: 0.12, spacing: 0.05, taperIn: 1.5, taperOut: 3, stabilize: 15 }),
  b({ id: "maru", name: "丸ペン", tool: "pen", size: 3, sizeMin: 0.06, spacing: 0.05, taperIn: 2, taperOut: 4, stabilize: 12 }),
  b({ id: "mili", name: "ミリペン", tool: "pen", size: 4, sizePressure: false, spacing: 0.05, stabilize: 20 }),
  b({ id: "kabura", name: "つけペン（強弱）", tool: "pen", size: 12, sizeMin: 0.03, velocityThin: 0.55, spacing: 0.05, taperIn: 2.5, taperOut: 5, stabilize: 18 }),
  b({ id: "fudepen", name: "筆ペン", tool: "pen", size: 16, sizeMin: 0.05, hardness: 0.96, tip: "round", grain: "streak", grainScale: 0.8, grainStrength: 0.25, taperIn: 2, taperOut: 5, stabilize: 14, velocityThin: 0.3 }),
  b({ id: "marker", name: "マーカー", tool: "pen", size: 22, sizePressure: false, opacity: 0.75, hardness: 0.92, roundness: 0.5, angle: 45, blend: "multiply", stabilize: 6 }),
  // ---- 鉛筆 ----
  b({ id: "pencil", name: "鉛筆", tool: "pencil", size: 5, sizeMin: 0.6, opacityPressure: true, opacityMin: 0.12, hardness: 0.72, spacing: 0.1, grain: "paper", grainScale: 1, grainStrength: 0.85, taperIn: 0.5, taperOut: 1, stabilize: 6 }),
  b({ id: "colpencil", name: "色鉛筆", tool: "pencil", size: 10, sizeMin: 0.7, opacityPressure: true, opacityMin: 0.08, hardness: 0.6, spacing: 0.1, grain: "paper", grainScale: 1.5, grainStrength: 0.92, stabilize: 6 }),
  b({ id: "sharp", name: "シャープペン", tool: "pencil", size: 2.5, sizeMin: 0.8, opacityPressure: true, opacityMin: 0.3, hardness: 0.85, spacing: 0.08, grain: "paper", grainStrength: 0.5, stabilize: 8 }),
  b({ id: "charcoal", name: "木炭", tool: "pencil", size: 34, sizeMin: 0.5, opacityPressure: true, opacityMin: 0.15, tip: "chalk", hardness: 0.8, spacing: 0.12, angleMode: "random", grain: "rough", grainScale: 2, grainStrength: 0.9, stabilize: 4 }),
  b({ id: "crayon", name: "クレヨン", tool: "pencil", size: 20, sizeMin: 0.75, opacityPressure: true, opacityMin: 0.4, tip: "chalk", hardness: 0.85, spacing: 0.1, angleMode: "random", grain: "rough", grainScale: 1.1, grainStrength: 0.8, stabilize: 4 }),
  // ---- 筆 ----
  b({ id: "watercolor", name: "透明水彩", tool: "brush", engine: "water", size: 44, sizeMin: 0.35, opacity: 0.55, opacityPressure: true, opacityMin: 0.3, hardness: 0.62, spacing: 0.06, grain: "rough", grainScale: 2.6, grainStrength: 0.2, mixAmount: 0.45, pickup: 0.18, wetEdge: 0.85, stabilize: 8 }),
  b({ id: "gouache", name: "不透明水彩", tool: "brush", engine: "water", size: 38, sizeMin: 0.4, opacity: 0.92, hardness: 0.7, spacing: 0.07, grain: "paper", grainScale: 1.2, grainStrength: 0.25, mixAmount: 0.55, pickup: 0.25, wetEdge: 0.18, stabilize: 8 }),
  b({ id: "bleed", name: "にじみ", tool: "brush", engine: "water", size: 70, sizeMin: 0.5, opacity: 0.4, hardness: 0.3, spacing: 0.06, grain: "rough", grainScale: 3, grainStrength: 0.25, mixAmount: 0.6, pickup: 0.2, wetEdge: 0.95, stabilize: 4 }),
  b({ id: "oil", name: "油彩", tool: "brush", engine: "mix", size: 42, sizeMin: 0.45, hardness: 0.7, spacing: 0.05, tip: "bristle", angleMode: "direction", roundness: 0.8, grain: "canvas", grainScale: 1.3, grainStrength: 0.16, mixAmount: 0.85, pickup: 0.28, strength: 1, paintLoad: 1100, stabilize: 6 }),
  b({ id: "thick", name: "厚塗り", tool: "brush", engine: "mix", size: 34, sizeMin: 0.5, hardness: 0.92, spacing: 0.06, tip: "flat", angleMode: "direction", roundness: 0.55, mixAmount: 0.92, pickup: 0.22, strength: 1, stabilize: 6 }),
  b({ id: "flat", name: "平筆", tool: "brush", engine: "mix", size: 40, sizeMin: 0.6, hardness: 0.8, spacing: 0.05, tip: "flat", angleMode: "direction", roundness: 0.28, grain: "canvas", grainStrength: 0.2, mixAmount: 0.86, pickup: 0.28, strength: 1, paintLoad: 1400, stabilize: 6 }),
  b({ id: "sumi", name: "墨", tool: "brush", engine: "water", size: 26, sizeMin: 0.04, opacity: 0.95, hardness: 0.85, spacing: 0.05, tip: "dryink", angleMode: "direction", roundness: 0.9, grain: "rough", grainScale: 1.4, grainStrength: 0.35, wetEdge: 0.45, mixAmount: 0.2, pickup: 0.1, taperIn: 1.5, taperOut: 4, velocityThin: 0.35, stabilize: 12 }),
  // ---- エアブラシ ----
  b({ id: "airsoft", name: "やわらか", tool: "airbrush", size: 140, sizePressure: false, hardness: 0, flow: 0.08, flowPressure: true, flowMin: 0, spacing: 0.05, accumulate: "over", stabilize: 0 }),
  b({ id: "airhard", name: "強め", tool: "airbrush", size: 60, sizePressure: false, hardness: 0.5, flow: 0.16, flowPressure: true, spacing: 0.05, accumulate: "over", stabilize: 0 }),
  b({ id: "spray", name: "スプレー", tool: "airbrush", size: 90, sizePressure: false, hardness: 0.6, particle: 0.035, count: 10, spacing: 0.12, sizeJitter: 0.7, opacityJitter: 0.6, flowPressure: true, flowMin: 0.2, accumulate: "over", stabilize: 0 }),
  b({ id: "glow", name: "発光", tool: "airbrush", size: 110, sizePressure: false, hardness: 0, flow: 0.1, flowPressure: true, spacing: 0.05, accumulate: "over", blend: "addGlow", stabilize: 0 }),
  // ---- デコレーション ----
  b({ id: "stars", name: "星", tool: "deco", size: 120, sizePressure: false, tip: "star", particle: 0.16, count: 1, spacing: 0.45, sizeJitter: 0.7, angleMode: "random", hueJitter: 0.06, valJitter: 0.25, stabilize: 0 }),
  b({ id: "sparkle", name: "きらめき", tool: "deco", size: 100, sizePressure: false, tip: "sparkle", particle: 0.22, count: 1, spacing: 0.5, sizeJitter: 0.8, opacityJitter: 0.4, blend: "addGlow", stabilize: 0 }),
  b({ id: "leaves", name: "葉っぱ", tool: "deco", size: 140, sizePressure: false, tip: "leaf", particle: 0.18, count: 2, spacing: 0.3, sizeJitter: 0.5, angleMode: "random", hueJitter: 0.05, satJitter: 0.15, valJitter: 0.3, stabilize: 0 }),
  b({ id: "petals", name: "花びら", tool: "deco", size: 130, sizePressure: false, tip: "petal", particle: 0.14, count: 1, spacing: 0.35, sizeJitter: 0.5, angleMode: "random", hueJitter: 0.03, valJitter: 0.15, stabilize: 0 }),
  b({ id: "grass", name: "草むら", tool: "deco", size: 120, sizePressure: false, tip: "grass", particle: 0.3, count: 3, spacing: 0.2, sizeJitter: 0.5, angleJitter: 25, hueJitter: 0.04, satJitter: 0.1, valJitter: 0.3, stabilize: 0 }),
  b({ id: "snow", name: "雪", tool: "deco", size: 160, sizePressure: false, hardness: 0.35, particle: 0.05, count: 4, spacing: 0.25, sizeJitter: 0.85, opacityJitter: 0.5, stabilize: 0 }),
  b({ id: "cloud", name: "雲", tool: "deco", size: 160, sizePressure: false, tip: "cloud", particle: 0.45, count: 1, spacing: 0.22, sizeJitter: 0.4, angleMode: "random", opacity: 0.85, accumulate: "over", flow: 0.5, stabilize: 0 }),
  b({ id: "stipple", name: "点描", tool: "deco", size: 60, sizePressure: false, hardness: 0.9, particle: 0.07, count: 5, spacing: 0.25, sizeJitter: 0.6, stabilize: 0 }),
  // ---- 消しゴム ----
  b({ id: "erhard", name: "硬い消しゴム", tool: "eraser", size: 30, sizeMin: 0.5, hardness: 0.95, erase: true, stabilize: 4 }),
  b({ id: "ersoft", name: "やわらかい消しゴム", tool: "eraser", size: 90, sizePressure: false, hardness: 0, flow: 0.25, flowPressure: true, accumulate: "over", erase: true, stabilize: 0 }),
  b({ id: "erkneaded", name: "練り消し", tool: "eraser", size: 26, sizeMin: 0.7, opacityPressure: true, opacityMin: 0.2, hardness: 0.6, grain: "paper", grainStrength: 0.6, erase: true, stabilize: 4 }),
  // ---- 色混ぜ ----
  b({ id: "finger", name: "指先", tool: "blend", engine: "smudge", size: 44, sizeMin: 0.5, hardness: 0.45, spacing: 0.05, strength: 0.85, pickup: 0.25, stabilize: 4 }),
  b({ id: "blurb", name: "ぼかし", tool: "blend", engine: "blur", size: 70, sizePressure: false, hardness: 0.1, spacing: 0.08, strength: 0.75, stabilize: 0 }),
  b({ id: "mixb", name: "色混ぜ", tool: "blend", engine: "smudge", size: 40, sizeMin: 0.5, hardness: 0.3, spacing: 0.05, tip: "bristle", angleMode: "direction", roundness: 0.8, strength: 0.55, pickup: 0.35, stabilize: 4 }),
];

export function presetById(id: string): BrushSettings | null {
  return PRESETS.find((p) => p.id === id) ?? null;
}

export function cloneBrush(b0: BrushSettings): BrushSettings {
  return { ...b0 };
}

/** AI と台本のための短い説明（ai/spec.ts と画面の説明が同じ文を使う）。 */
export const PRESET_HINTS: Record<string, string> = {
  gpen: "主線・漫画の線。筆圧で太さが変わる",
  maru: "細かい描き込み・髪の毛・細い線",
  mili: "太さが一定の線・図面・アイコン",
  kabura: "強弱の大きい線。速く引くと細くなる",
  fudepen: "毛筆のような強弱とわずかなかすれ",
  marker: "平たいペン先。重ねると濃くなる（乗算）",
  pencil: "下描き・ラフ。紙の目が出る",
  colpencil: "色鉛筆の塗り。紙の目が強い",
  sharp: "細い鉛筆線",
  charcoal: "木炭・荒いデッサン",
  crayon: "クレヨンの太い線",
  watercolor: "透明水彩の塗り。下の色と混ざり、縁が濃くなる",
  gouache: "不透明水彩。しっかり塗れて少し混ざる",
  bleed: "大きなにじみ・空や背景のぼかし塗り",
  oil: "油彩。下の絵の具を引きずって混ぜる",
  thick: "厚塗り。不透明で下の色と少し混ざる",
  flat: "平筆。進む向きに平たい筆跡",
  sumi: "墨。かすれと強弱",
  airsoft: "やわらかい影・グラデーション・空気感",
  airhard: "少し芯のあるエアブラシ",
  spray: "スプレーの粒",
  glow: "光・発光（加算（発光）で明るくなる）",
  stars: "星を散らす",
  sparkle: "きらめき（光る）",
  leaves: "葉っぱを散らす（木の茂み）",
  petals: "花びらを散らす",
  grass: "草むら",
  snow: "雪・ほこり・光の粒",
  cloud: "もこもこの雲",
  stipple: "点描・質感",
  erhard: "くっきり消す",
  ersoft: "ふんわり消す",
  erkneaded: "紙の目を残して少しずつ消す",
  finger: "指でこする（ぼかしながら伸ばす）",
  blurb: "その場をぼかす",
  mixb: "筆で色を混ぜてなじませる",
};
