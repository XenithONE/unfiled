// AI 向けの説明書。コピーする指示文・fude.help()・画面のヘルプは、すべてここから作る（出典は 1 つ）。
import { BLEND_MODES } from "../engine/blend";
import { PRESET_HINTS, PRESETS, TOOL_GROUPS } from "../engine/brush/presets";

export const SCRIPT_VERSION = 1;

export interface OpDoc {
  op: string;
  params: string;
  does: string;
  example: string;
}

export const OP_DOCS: OpDoc[] = [
  { op: "layer", params: "name, blend?, opacity?, clip?, alphaLock?, group?", does: "新しいレイヤーを作って、以後そこに描く。clip:true で下のレイヤーの塗りからはみ出さない（影・光に使う）", example: `{"op":"layer","name":"影","blend":"multiply","opacity":0.6,"clip":true}` },
  { op: "group", params: "name, blend?, opacity?", does: "フォルダーを作る。以後の layer に group:\"名前\" を書くとその中に入る", example: `{"op":"group","name":"人物"}` },
  { op: "select_layer", params: "name", does: "名前のレイヤーに戻って描く", example: `{"op":"select_layer","name":"下塗り"}` },
  { op: "layer_props", params: "name?, opacity?, blend?, visible?, clip?, rename?", does: "レイヤーの設定を変える（name を省くと今のレイヤー）", example: `{"op":"layer_props","opacity":0.5}` },
  { op: "brush", params: "preset, size?, opacity?, color?, ほかの筆の設定", does: "以後の線の筆を決める", example: `{"op":"brush","preset":"gpen","size":5,"color":"#2b2530"}` },
  { op: "color", params: "color", does: "以後の色を決める（#rrggbb）", example: `{"op":"color","color":"#e8a87c"}` },
  { op: "stroke", params: "d（SVG パス）か points, preset?, size?, color?, opacity?, pressure?, taper?, wobble?, erase?", does: "筆で線を引く。d に複数の M があれば別々の線。pressure は線に沿った筆圧の変化 [始め,…,終わり]（0〜1）。taper:[入り,抜き] は細くなる長さ（画素）。wobble は手描きの揺れ（0〜3 程度）", example: `{"op":"stroke","d":"M120 300 C180 220 260 220 320 300","preset":"gpen","size":6,"taper":[20,40]}` },
  { op: "fill", params: "d か rect/ellipse/circle/polygon, color, opacity?, feather?, texture?, blend?", does: "形の中を塗る（下塗り・面）。feather はふちのぼかし（画素）。texture は paper/canvas/rough でかすれ", example: `{"op":"fill","d":"M100 100 L300 120 L260 320 Z","color":"#f2c9a0"}` },
  { op: "rect / ellipse / circle / polygon", params: "rect:[x,y,w,h,角丸?] / ellipse:[cx,cy,rx,ry,回転°?] / circle:[cx,cy,r] / polygon:[[x,y],…], fill?, stroke?, strokeWidth?", does: "図形。fill で塗り、stroke で輪郭線（今の筆）", example: `{"op":"circle","circle":[800,300,90],"fill":"#ffe9a8"}` },
  { op: "bucket", params: "x, y, color, refer?（all/layer）, gap?, expand?", does: "線で囲まれた所を塗りつぶす（線画の下の色塗り）。gap は線の切れ目をふさぐ画素数", example: `{"op":"bucket","x":400,"y":380,"color":"#f6d7b8","gap":3}` },
  { op: "gradient", params: "type（linear/radial）, from:[x,y], to:[x,y], stops:[色,…] か [[色,位置,不透明度],…], opacity?, blend?", does: "グラデーション（空・光・遠景）。選択範囲があればその中だけ", example: `{"op":"gradient","type":"linear","from":[0,0],"to":[0,900],"stops":["#1d2b64","#f8cdda"]}` },
  { op: "select", params: "d か rect/ellipse/polygon, mode?（replace/add/subtract/intersect）, feather? / all:true / none:true / invert:true / layer:\"名前\"", does: "選択範囲。以後の描画は選択範囲の中だけになる（none:true で解除）", example: `{"op":"select","ellipse":[500,400,200,140],"feather":20}` },
  { op: "text", params: "text, x, y, size, color?, font?（sans/serif/hand/mono）, vertical?, bold?, align?, stroke?:{width,color}", does: "文字（テキストレイヤー）。vertical:true で縦書き（x,y は右上）", example: `{"op":"text","text":"夏の夜","x":120,"y":80,"size":96,"font":"serif","color":"#ffffff"}` },
  { op: "filter", params: "type と設定", does: "今のレイヤーに効果（下の「効果」）", example: `{"op":"filter","type":"blur","radius":6}` },
  { op: "symmetry", params: "mode（vertical/horizontal/both/radial/off）, x?, y?, count?", does: "対称定規。以後の線が鏡のように写る（模様・左右対称の顔）", example: `{"op":"symmetry","mode":"radial","x":500,"y":500,"count":8}` },
  { op: "paper", params: "color か null", does: "用紙（いちばん下の地）の色。null で透明", example: `{"op":"paper","color":"#f7f1e3"}` },
  { op: "clear", params: "", does: "今のレイヤー（選択範囲があればその中）を消す", example: `{"op":"clear"}` },
  { op: "move", params: "dx?, dy?, scale?, rotate?（度）", does: "今のレイヤーを動かす・拡大縮小・回転（中心まわり）", example: `{"op":"move","dx":30,"scale":0.9}` },
  { op: "flip", params: "axis（h/v）", does: "今のレイヤーを反転", example: `{"op":"flip","axis":"h"}` },
  { op: "duplicate / merge_down / delete_layer", params: "delete_layer は name?", does: "レイヤーの複製・下と結合・削除", example: `{"op":"duplicate"}` },
  { op: "say", params: "text", does: "再生中に字幕を出す（何を描いているかを短く）", example: `{"op":"say","text":"まず空を塗ります"}` },
  { op: "wait", params: "ms", does: "少し待つ（再生の間）", example: `{"op":"wait","ms":600}` },
];

export const FILTER_DOCS: { type: string; params: string; does: string }[] = [
  { type: "blur", params: "radius", does: "ぼかし" },
  { type: "motion_blur", params: "radius, angle", does: "動きのぼかし" },
  { type: "sharpen", params: "amount", does: "くっきり" },
  { type: "hsl", params: "hue（-180〜180）, saturation（-1〜1）, lightness（-1〜1）", does: "色相・彩度・明度" },
  { type: "brightness", params: "brightness（-1〜1）, contrast（-1〜1）", does: "明るさ・コントラスト" },
  { type: "color_balance", params: "r, g, b（-1〜1）", does: "色のかたより" },
  { type: "gradient_map", params: "stops:[色,…]", does: "明るさで色を置きかえる（絵の色調をまとめる）" },
  { type: "noise", params: "amount", does: "粒（フィルムの質感）" },
  { type: "glow", params: "radius, strength", does: "明るい所を光らせる" },
  { type: "invert", params: "", does: "階調の反転" },
  { type: "posterize", params: "levels", does: "色数を減らす" },
  { type: "outline", params: "width, color", does: "描いた物の周りにフチ" },
];

export function brushTable(): string {
  const rows: string[] = [];
  for (const g of TOOL_GROUPS) {
    const list = PRESETS.filter((p) => p.tool === g.id);
    rows.push(`- ${g.name}: ` + list.map((p) => `${p.id}（${p.name}・${PRESET_HINTS[p.id] ?? ""}・標準の大きさ ${Math.round(p.size)}）`).join(" / "));
  }
  return rows.join("\n");
}

export function blendList(): string {
  return BLEND_MODES.map((b) => `${b.id}（${b.name}）`).join(", ");
}

export function opTable(): string {
  return OP_DOCS.map((d) => `- **${d.op}** — ${d.does}\n  設定: ${d.params || "なし"}\n  例: \`${d.example}\``).join("\n");
}

export const DRAW_TIPS = [
  "レイヤーを分けて描く: 背景 → 遠景 → 下塗り（色ごとに fill）→ 影（multiply・clip:true）→ 光（screen か addGlow・clip:true）→ 線画（gpen など）→ 仕上げ（きらめき・文字）。",
  "大きな面はまず fill（d で形）や gradient で塗り、airsoft（やわらかいエアブラシ）や watercolor（透明水彩）で陰影と空気感を重ねる。",
  "線は SVG パスの C（3 次ベジエ）でなめらかに。直線の折れ線より、少ない点のベジエ曲線のほうが絵らしくなる。",
  "主線は gpen（size 3〜8）に taper:[入り,抜き] をつけると手描きの強弱が出る。輪郭は 1 本でつながず、数本に分けて重ねると自然。",
  "影は 1 段で終わらせず、広い影（opacity 0.5 前後）→ 濃い影（狭く）の 2 段に。光は反対側に小さく。",
  "同じ形を塗るときは、線画の内側の座標で bucket を使うと線との隙間ができない（gap:2〜4）。",
  "絵の中の物の重なり（手前・奥）を意識して、奥から順に描く。",
  "命令は 40〜400 個くらい。1 つの d に点を何千も並べない。",
  "座標はキャンバスの中（0〜幅, 0〜高さ）に収める。少しはみ出すのはかまわない。",
  "最初に say で何を描くかを一言、区切りごとにも短く say を入れると、見ている人に伝わる。",
];

export interface PromptContext {
  request: string;
  width: number;
  height: number;
  layers: string[];
  continuing: boolean;
  paper: string | null;
}

/** チャットの AI に渡す指示文。 */
export function buildPrompt(c: PromptContext): string {
  const req = c.request.trim() || "（自由に、あなたが一番きれいに描けると思う絵を 1 枚）";
  return `あなたは「FUDE」というお絵描きツールを使って絵を描く画家です。FUDE は人間と同じ筆（ペン・鉛筆・水彩・油彩・エアブラシ・散らし筆など）を持っていて、あなたは JSON の「台本」でその筆を動かします。台本は 1 画ずつ再生され、人が描くように絵ができあがります。

# 描いてほしいもの
${req}

# キャンバス
- 大きさ: 幅 ${c.width} × 高さ ${c.height}（左上が 0,0。右へ x、下へ y。単位は画素）
- 台本の "size" に [${c.width}, ${c.height}] と書き、その座標で描いてください。
- 用紙の色: ${c.paper ?? "透明"}
${c.continuing ? `- いまの絵の続きに描き足します。今あるレイヤー（下から）: ${c.layers.join(" / ") || "なし"}。消さずに、新しいレイヤーを作って重ねてください。` : "- 白紙から描きます。"}

# 返す形（この JSON だけを返してください。説明文は書かない）
\`\`\`json
{"fude": ${SCRIPT_VERSION}, "title": "作品名", "size": [${c.width}, ${c.height}], "ops": [
  {"op": "say", "text": "…"},
  {"op": "layer", "name": "…"},
  …
]}
\`\`\`

# 命令（ops に並べる。上から順に実行）
${opTable()}

# 筆（preset に書く id）
${brushTable()}
筆の細かい設定も書けます: size（直径・画素）, opacity, flow, hardness（0 やわらか〜1 くっきり）, spacing, roundness, angle, grainStrength（紙の目）, mixAmount（下の色と混ぜる量）, wetEdge（水彩の縁）。

# 合成モード（blend）
${blendList()}

# 効果（filter の type）
${FILTER_DOCS.map((f) => `${f.type}（${f.does}・${f.params || "設定なし"}）`).join(" / ")}

# きれいに描くコツ
${DRAW_TIPS.map((t, i) => `${i + 1}. ${t}`).join("\n")}

# 小さな例（形だけの見本。実際はもっと描き込んでください）
\`\`\`json
{"fude": ${SCRIPT_VERSION}, "title": "夕焼けの丘", "size": [1600, 1200], "ops": [
  {"op": "say", "text": "空から描きます"},
  {"op": "layer", "name": "空"},
  {"op": "gradient", "type": "linear", "from": [0, 0], "to": [0, 800], "stops": ["#2b3a67", "#f3a683", "#f7d794"]},
  {"op": "layer", "name": "丘"},
  {"op": "fill", "d": "M0 820 C300 700 600 760 900 720 C1200 680 1400 760 1600 740 L1600 1200 L0 1200 Z", "color": "#3d5a40"},
  {"op": "layer", "name": "丘の影", "blend": "multiply", "opacity": 0.55, "clip": true},
  {"op": "stroke", "d": "M0 1000 C500 940 1000 1080 1600 980", "preset": "airsoft", "size": 420, "color": "#1f2e2a"},
  {"op": "layer", "name": "太陽", "blend": "addGlow"},
  {"op": "circle", "circle": [1180, 610, 70], "fill": "#fff3c4"},
  {"op": "stroke", "points": [[1180, 610]], "preset": "glow", "size": 520, "color": "#ffb36b"},
  {"op": "layer", "name": "線"},
  {"op": "stroke", "d": "M240 760 C250 700 262 660 270 600", "preset": "gpen", "size": 5, "color": "#1c1a22", "taper": [10, 30]}
]}
\`\`\`

では、上の「描いてほしいもの」を、レイヤーを分けて丁寧に描く台本を JSON だけで返してください。`;
}

/** ブラウザを操作できる AI（window.fude を直接呼べる）向けの説明。 */
export function apiHelp(): string {
  return `FUDE（お絵描きツール）の操作口 window.fude

■ 一番かんたんな使い方
  await fude.run({ size:[幅,高さ], ops:[ … ] })   // 台本を実行（台本の書き方は fude.prompt() の説明と同じ）
  await fude.run(台本, { animate:true, speed:2 }) // 人が見ているときは描く様子を再生
  fude.state()        // キャンバスの大きさ・レイヤー・今の筆と色
  fude.snapshot({max:1024})  // 絵を JPEG の data URL で（目で確かめる用）
  fude.look()         // 全体を表示して今の絵を画面に出す（スクリーンショット用）
  fude.undo() / fude.redo()
  fude.newCanvas(幅, 高さ, 用紙の色)
  fude.validate(台本)  // 実行せずに検査だけ
  fude.prompt("描いてほしいもの")  // 台本の書き方の全文（チャット用の指示文と同じ）
  fude.brushes()      // 筆の一覧

■ 1 画ずつ自分で動かす
  fude.stroke([[x,y,筆圧], …], { preset:"gpen", size:6, color:"#222" })
  fude.fill("M … Z", "#ffcc99")
  fude.layer("影", { blend:"multiply", clip:true })

■ 決まり
- 座標は左上が 0,0。台本の size を書けば、その座標を今のキャンバスに合わせて縮める。
- 1 回の run は取り消し 1 回分。
- 戻り値は小さな JSON（画像は snapshot で）。

${opTable()}

筆:
${brushTable()}
`;
}
