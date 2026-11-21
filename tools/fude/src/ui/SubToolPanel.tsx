import { Copy, RotateCcw, Settings2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { PRESET_HINTS, PRESETS, TOOL_GROUPS } from "../engine/brush/presets";
import { isBrushTool } from "../engine/studio";
import { brushPreview } from "./brushPreview";
import { Panel } from "./controls";
import { useStudio, useTopics } from "./hooks";
import { TOOL_LIST } from "./Toolbar";

export function SubToolPanel() {
  const s = useStudio();
  useTopics("tool", "brush");
  const tool = s.tool;
  if (!isBrushTool(tool)) {
    const t = TOOL_LIST.find((x) => x.id === tool);
    return (
      <Panel title={t?.name ?? "道具"} className="subtools">
        <ToolHint />
      </Panel>
    );
  }
  const group = TOOL_GROUPS.find((g) => g.id === tool)!;
  const list = s.brushesOf(tool);
  const active = s.activeBrush[tool];
  const activeB = s.brushFor(tool);
  const isPreset = PRESETS.some((p) => p.id === active);
  const modified = isPreset && s.brushes.has(active);
  return (
    <Panel
      title={group.name}
      className="subtools"
      right={
        <>
          <button type="button" className="icon-btn" title="この筆を複製" aria-label="この筆を複製" onClick={() => s.duplicateBrush(active)}>
            <Copy size={14} />
          </button>
          {modified && (
            <button type="button" className="icon-btn" title="初期設定に戻す" aria-label="初期設定に戻す" onClick={() => s.resetBrush(active)}>
              <RotateCcw size={14} />
            </button>
          )}
          {!isPreset && (
            <button type="button" className="icon-btn" title="この筆を削除" aria-label="この筆を削除" onClick={() => s.deleteBrush(active)}>
              <Trash2 size={14} />
            </button>
          )}
          <button type="button" className="icon-btn" title="筆の詳細設定" aria-label="筆の詳細設定" onClick={() => s.openDialog("brush", activeB.id)}>
            <Settings2 size={14} />
          </button>
        </>
      }
    >
      <ul className="brush-list">
        {list.map((b) => (
          <li key={b.id}>
            <button type="button" className={`brush-item${b.id === active ? " is-on" : ""}`} onClick={() => s.selectBrush(tool, b.id)} onDoubleClick={() => s.openDialog("brush", b.id)} title={PRESET_HINTS[b.id] ?? b.name} data-brush={b.id}>
              <span className="brush-name">{b.name}</span>
              <Preview id={b.id} />
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Preview({ id }: { id: string }) {
  const s = useStudio();
  useTopics("brush");
  const b = s.brushFor(s.brushGroupOf(id), id);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    // 一覧が出てから少しずつ作る（起動を重くしない）
    const t = setTimeout(() => setUrl(brushPreview(s, b)), 30);
    return () => clearTimeout(t);
  }, [s, b]);
  return url ? <img className="brush-prev" src={url} alt="" draggable={false} /> : <span className="brush-prev" />;
}

const HINTS: Record<string, string> = {
  move: "ドラッグでレイヤー（選択範囲があればその中身）を動かします。矢印キーで 1 画素ずつ、Shift で 10 画素。",
  select: "ドラッグで選択範囲を作ります。Shift で追加、Alt で削除。Ctrl+D で解除、Ctrl+Shift+I で反転。",
  wand: "クリックした所と似た色の範囲を選びます。「参照」で、見えている絵全体か今のレイヤーかを選べます。",
  eyedropper: "クリックした所の色を描画色にします。筆を使っている間は Alt を押すとスポイトになります。",
  fill: "線で囲まれた所を塗りつぶします。「隙間閉じ」で線の小さな切れ目をふさぎ、「領域拡縮」で線の下まで塗ります。",
  gradient: "ドラッグした向きにグラデーションを塗ります。選択範囲があればその中だけ。",
  shape: "直線・四角・楕円・多角形・曲線を、今の筆で描きます。Shift で縦横をそろえ、Alt で中心から。",
  text: "クリックした所に文字を置きます。縦書きもできます。",
  hand: "ドラッグで表示を動かします（Space を押している間も手のひら）。",
  zoom: "クリックで拡大、Alt+クリックで縮小、左右にドラッグで拡大率を変えます。",
  rotate: "ドラッグで表示を回します。Shift で 15° ずつ。表示メニューの「回転を戻す」で元に戻ります。",
  transform: "四隅で拡大縮小、外側で回転、Ctrl を押しながら四隅で自由変形。Enter で確定、Esc で取り消し。",
};

function ToolHint() {
  const s = useStudio();
  return <p className="hint">{HINTS[s.tool] ?? ""}</p>;
}
