import { Blend, Brush, Droplets, Eraser, Hand, Move, PaintBucket, Pencil, PenTool, Pipette, RotateCw, Shapes, Sparkles, SprayCan, SquareDashed, Type, WandSparkles, ZoomIn } from "lucide-react";
import type { ComponentType } from "react";
import type { ToolId } from "../engine/studio";
import { useStudio, useTopics } from "./hooks";

export const TOOL_LIST: { id: ToolId; name: string; key: string; icon: ComponentType<{ size?: number; strokeWidth?: number }> }[] = [
  { id: "move", name: "移動", key: "V", icon: Move },
  { id: "select", name: "選択範囲", key: "M", icon: SquareDashed },
  { id: "wand", name: "自動選択", key: "W", icon: WandSparkles },
  { id: "eyedropper", name: "スポイト", key: "I", icon: Pipette },
  { id: "pen", name: "ペン", key: "P", icon: PenTool },
  { id: "pencil", name: "鉛筆", key: "N", icon: Pencil },
  { id: "brush", name: "筆", key: "B", icon: Brush },
  { id: "airbrush", name: "エアブラシ", key: "A", icon: SprayCan },
  { id: "deco", name: "デコレーション", key: "D", icon: Sparkles },
  { id: "eraser", name: "消しゴム", key: "E", icon: Eraser },
  { id: "blend", name: "色混ぜ", key: "J", icon: Droplets },
  { id: "fill", name: "塗りつぶし", key: "G", icon: PaintBucket },
  { id: "gradient", name: "グラデーション", key: "Shift+G", icon: Blend },
  { id: "shape", name: "図形", key: "U", icon: Shapes },
  { id: "text", name: "テキスト", key: "T", icon: Type },
  { id: "hand", name: "手のひら（Space）", key: "H", icon: Hand },
  { id: "zoom", name: "虫めがね", key: "Z", icon: ZoomIn },
  { id: "rotate", name: "表示の回転（R）", key: "R", icon: RotateCw },
];

export function Toolbar() {
  const s = useStudio();
  useTopics("tool", "color");
  return (
    <nav className="toolbar" aria-label="道具">
      {TOOL_LIST.map((t, i) => {
        const Icon = t.icon;
        const sep = i === 4 || i === 11 || i === 15;
        return (
          <div key={t.id} className="tool-wrap">
            {sep && <div className="toolbar-sep" />}
            <button type="button" className={`tool${s.tool === t.id ? " is-on" : ""}`} title={`${t.name}（${t.key}）`} aria-label={t.name} aria-pressed={s.tool === t.id} data-tool={t.id} onClick={() => s.setTool(t.id)}>
              <Icon size={18} strokeWidth={1.6} />
            </button>
          </div>
        );
      })}
      <ColorChips />
    </nav>
  );
}

function ColorChips() {
  const s = useStudio();
  useTopics("color");
  const c = s.colors;
  return (
    <div className="chips" title="描画色と背景色（X で入れ替え）">
      <button type="button" className={`chip chip--sub`} style={{ background: c.sub }} aria-label="背景色" onClick={() => s.swapColors()} />
      <button type="button" className={`chip chip--main${c.transparent ? " is-clear" : ""}`} style={{ background: c.transparent ? undefined : c.main }} aria-label="描画色" onClick={() => s.openDialog("color")} />
      <button
        type="button"
        className={`chip-clear${c.transparent ? " is-on" : ""}`}
        title="透明色（どの筆でも消しゴムとして描く）"
        aria-label="透明色"
        onClick={() => {
          s.colors.transparent = !s.colors.transparent;
          s.emit("color");
        }}
      />
    </div>
  );
}
