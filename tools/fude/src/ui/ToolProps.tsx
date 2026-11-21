import { BLEND_MODES } from "../engine/blend";
import type { BrushSettings } from "../engine/brush/presets";
import { isBrushTool, type UIState } from "../engine/studio";
import { Panel, Segmented, Select, Slider, Toggle } from "./controls";
import { useStudio, useTopics } from "./hooks";

export function ToolProps() {
  const s = useStudio();
  useTopics("tool", "brush", "ui");
  const tool = s.tool;
  return (
    <Panel title="ツールプロパティ" className="toolprops">
      {isBrushTool(tool) ? <BrushProps /> : <OtherProps />}
    </Panel>
  );
}

function BrushProps() {
  const s = useStudio();
  const b = s.currentBrush();
  const set = <K extends keyof BrushSettings>(k: K, v: BrushSettings[K]) => s.setBrushParam(k, v);
  const mixing = b.engine === "mix" || b.engine === "water";
  return (
    <div className="props">
      <div className="props-title">{b.name}</div>
      <Slider label="大きさ" value={b.size} min={1} max={1000} log unit="px" onChange={(v) => set("size", v)} title="[ と ] でも変えられます" />
      {b.engine !== "smudge" && b.engine !== "blur" && <Slider label="不透明度" value={b.opacity} min={0} max={1} onChange={(v) => set("opacity", v)} />}
      {b.accumulate === "over" && b.engine === "stamp" && <Slider label="濃度（流量）" value={b.flow} min={0.01} max={1} onChange={(v) => set("flow", v)} />}
      <Slider label="硬さ" value={b.hardness} min={0} max={1} onChange={(v) => set("hardness", v)} />
      {(b.engine === "smudge" || b.engine === "blur") && <Slider label="強さ" value={b.strength} min={0.05} max={1} onChange={(v) => set("strength", v)} />}
      {mixing && <Slider label="色延び" value={b.mixAmount} min={0} max={1} onChange={(v) => set("mixAmount", v)} title={b.engine === "mix" ? "絵の具の量（多いほど筆の色が乗る）" : "下の色をどれだけ混ぜるか"} />}
      {b.engine === "water" && <Slider label="水彩の縁" value={b.wetEdge} min={0} max={1} onChange={(v) => set("wetEdge", v)} />}
      {b.grain !== "none" && <Slider label="紙の目" value={b.grainStrength} min={0} max={1} onChange={(v) => set("grainStrength", v)} />}
      <Slider label="手ブレ補正" value={b.stabilize} min={0} max={100} step={1} onChange={(v) => set("stabilize", v)} />
      <div className="props-row">
        <Toggle label="筆圧で太さ" value={b.sizePressure} onChange={(v) => set("sizePressure", v)} />
        <Toggle label="筆圧で濃さ" value={b.opacityPressure} onChange={(v) => set("opacityPressure", v)} />
      </div>
      {b.engine !== "smudge" && b.engine !== "blur" && !b.erase && (
        <Select label="合成モード" value={b.blend} options={BLEND_MODES.map((m) => ({ value: m.id, label: m.name }))} onChange={(v) => set("blend", v)} />
      )}
      <button type="button" className="btn btn--ghost" onClick={() => s.openDialog("brush", b.id)}>
        詳細設定…
      </button>
    </div>
  );
}

function OtherProps() {
  const s = useStudio();
  const ui = s.ui;
  const up = <K extends keyof UIState>(k: K, patch: Partial<UIState[K]>) => s.setUI({ [k]: { ...(ui[k] as object), ...patch } } as Partial<UIState>);
  switch (s.tool) {
    case "fill":
      return (
        <div className="props">
          <Segmented
            label="参照"
            value={ui.fill.refer}
            options={[
              { value: "layer", label: "このレイヤー", title: "今のレイヤーだけを見て塗る" },
              { value: "all", label: "全体", title: "見えている全レイヤーを見て塗る（線画の下のレイヤーに塗る時）" },
              { value: "ref", label: "参照レイヤー", title: "参照レイヤーに設定したレイヤーを見て塗る" },
            ]}
            onChange={(v) => up("fill", { refer: v })}
          />
          <Slider label="色の誤差" value={ui.fill.tolerance} min={0} max={100} step={1} onChange={(v) => up("fill", { tolerance: v })} />
          <Slider label="隙間閉じ" value={ui.fill.gap} min={0} max={20} step={1} unit="px" onChange={(v) => up("fill", { gap: v })} />
          <Slider label="領域拡縮" value={ui.fill.expand} min={-10} max={10} step={1} unit="px" onChange={(v) => up("fill", { expand: v })} />
          <Toggle label="アンチエイリアス" value={ui.fill.antialias} onChange={(v) => up("fill", { antialias: v })} />
          <Toggle label="隣接ピクセルのみ" value={ui.fill.contiguous} onChange={(v) => up("fill", { contiguous: v })} />
        </div>
      );
    case "wand":
      return (
        <div className="props">
          <Segmented
            label="参照"
            value={ui.fill.refer}
            options={[
              { value: "layer", label: "このレイヤー" },
              { value: "all", label: "全体" },
              { value: "ref", label: "参照レイヤー" },
            ]}
            onChange={(v) => up("fill", { refer: v })}
          />
          <Slider label="色の誤差" value={ui.fill.tolerance} min={0} max={100} step={1} onChange={(v) => up("fill", { tolerance: v })} />
          <Slider label="隙間閉じ" value={ui.fill.gap} min={0} max={20} step={1} unit="px" onChange={(v) => up("fill", { gap: v })} />
          <Slider label="領域拡縮" value={ui.fill.expand} min={-10} max={10} step={1} unit="px" onChange={(v) => up("fill", { expand: v })} />
          <Toggle label="隣接ピクセルのみ" value={ui.fill.contiguous} onChange={(v) => up("fill", { contiguous: v })} />
          <SelMode />
        </div>
      );
    case "select":
      return (
        <div className="props">
          <Segmented
            label="形"
            value={ui.select.shape}
            options={[
              { value: "rect", label: "長方形" },
              { value: "ellipse", label: "楕円" },
              { value: "lasso", label: "投げ縄" },
              { value: "polygon", label: "折れ線" },
            ]}
            onChange={(v) => up("select", { shape: v })}
          />
          <SelMode />
          <Slider label="ぼかし" value={ui.select.feather} min={0} max={100} step={1} unit="px" onChange={(v) => up("select", { feather: v })} />
        </div>
      );
    case "gradient":
      return (
        <div className="props">
          <Segmented
            label="形"
            value={ui.gradient.kind}
            options={[
              { value: "linear", label: "直線" },
              { value: "radial", label: "円形" },
            ]}
            onChange={(v) => up("gradient", { kind: v })}
          />
          <Select
            label="色"
            value={ui.gradient.stops}
            options={[
              { value: "main-clear", label: "描画色 → 透明" },
              { value: "main-sub", label: "描画色 → 背景色" },
              { value: "sub-main", label: "背景色 → 描画色" },
              { value: "rainbow", label: "虹" },
            ]}
            onChange={(v) => up("gradient", { stops: v })}
          />
          <Slider label="不透明度" value={ui.gradient.opacity} min={0} max={1} onChange={(v) => up("gradient", { opacity: v })} />
        </div>
      );
    case "shape":
      return (
        <div className="props">
          <Segmented
            label="図形"
            value={ui.shape.kind}
            options={[
              { value: "line", label: "直線" },
              { value: "rect", label: "長方形" },
              { value: "ellipse", label: "楕円" },
              { value: "polygon", label: "多角形" },
              { value: "curve", label: "曲線" },
            ]}
            onChange={(v) => up("shape", { kind: v })}
          />
          <div className="props-row">
            <Toggle label="線を描く" value={ui.shape.stroke} onChange={(v) => up("shape", { stroke: v })} />
            <Toggle label="塗る" value={ui.shape.fill} onChange={(v) => up("shape", { fill: v })} />
          </div>
          <p className="hint">線は「ペン」で選んでいる筆で描きます。</p>
        </div>
      );
    case "text":
      return (
        <div className="props">
          <Select
            label="書体"
            value={ui.text.font}
            options={[
              { value: "sans-serif", label: "ゴシック" },
              { value: "serif", label: "明朝" },
              { value: "Yomogi", label: "手書き風（よもぎ）" },
              { value: "Inter", label: "Inter（欧文）" },
              { value: "IBM Plex Mono", label: "等幅（欧文）" },
            ]}
            onChange={(v) => up("text", { font: v })}
          />
          <Slider label="大きさ" value={ui.text.size} min={6} max={600} log unit="px" onChange={(v) => up("text", { size: v })} />
          <Slider label="行間" value={ui.text.lineHeight} min={0.8} max={3} step={0.05} digits={2} onChange={(v) => up("text", { lineHeight: v })} />
          <Slider label="フチ" value={ui.text.strokeWidth} min={0} max={40} step={1} unit="px" onChange={(v) => up("text", { strokeWidth: v })} />
          <div className="props-row">
            <Toggle label="縦書き" value={ui.text.vertical} onChange={(v) => up("text", { vertical: v })} />
            <Toggle label="太字" value={ui.text.bold} onChange={(v) => up("text", { bold: v })} />
          </div>
        </div>
      );
    case "eyedropper":
      return (
        <div className="props">
          <Segmented
            label="取る場所"
            value={ui.sample}
            options={[
              { value: "canvas", label: "表示している色" },
              { value: "layer", label: "このレイヤー" },
            ]}
            onChange={(v) => s.setUI({ sample: v })}
          />
          <p className="hint">右クリックでもスポイトになります。</p>
        </div>
      );
    case "transform": {
      const tt = s.ext.transform as { ft: unknown; flip(a: "h" | "v"): void; rotate90(d: 1 | -1): void; commit(): void; abort(): void } | undefined;
      if (!tt || !tt.ft) return <p className="hint">変形するレイヤーがありません。</p>;
      return (
        <div className="props">
          <div className="btn-grid">
            <button type="button" className="btn" onClick={() => tt.flip("h")}>左右反転</button>
            <button type="button" className="btn" onClick={() => tt.flip("v")}>上下反転</button>
            <button type="button" className="btn" onClick={() => tt.rotate90(-1)}>左へ 90°</button>
            <button type="button" className="btn" onClick={() => tt.rotate90(1)}>右へ 90°</button>
          </div>
          <p className="hint">四隅で拡大縮小（Shift で縦横比を保つ・Alt で中心から）、辺で片方向、枠の外で回転（Shift で 15° ずつ）、Ctrl を押しながら四隅で自由変形。</p>
          <div className="btn-grid">
            <button type="button" className="btn btn--primary" onClick={() => tt.commit()}>確定（Enter）</button>
            <button type="button" className="btn" onClick={() => tt.abort()}>やめる（Esc）</button>
          </div>
        </div>
      );
    }
    default:
      return <p className="hint">この道具に設定はありません。</p>;
  }
}

function SelMode() {
  const s = useStudio();
  const ui = s.ui;
  return (
    <Segmented
      label="重ね方"
      value={ui.select.mode}
      options={[
        { value: "replace", label: "新規" },
        { value: "add", label: "追加", title: "Shift" },
        { value: "subtract", label: "削除", title: "Alt" },
        { value: "intersect", label: "共通" },
      ]}
      onChange={(v) => s.setUI({ select: { ...ui.select, mode: v } })}
    />
  );
}
