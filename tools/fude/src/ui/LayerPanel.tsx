import { ArrowDownToLine, ChevronDown, ChevronRight, Copy, Eye, EyeOff, FolderPlus, Lock, Plus, SquareDashed, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BLEND_MODES } from "../engine/blend";
import type { Layer } from "../engine/doc";
import { addMask, mergeDown } from "../engine/layerOps";
import { Panel, Slider } from "./controls";
import { useStudio, useTopics } from "./hooks";

export function LayerPanel() {
  const s = useStudio();
  useTopics("layers", "doc");
  const d = s.doc;
  const a = d.active;
  const rows = d.listForPanel();
  const [drag, setDrag] = useState<{ id: string; over: string | null; where: "above" | "below" | "into" } | null>(null);
  const blendOpts = a?.isGroup ? [{ id: "pass", name: "通過" }, ...BLEND_MODES] : BLEND_MODES;
  const drop = () => {
    if (!drag || !drag.over || drag.over === drag.id) return setDrag(null);
    const target = d.find(drag.over);
    if (!target || !target.parent) return setDrag(null);
    if (drag.where === "into" && target.isGroup) s.moveLayer(drag.id, target.id, target.children.length);
    else {
      const idx = target.parent.children.indexOf(target);
      s.moveLayer(drag.id, target.parent.id, drag.where === "above" ? idx + 1 : idx);
    }
    setDrag(null);
  };
  return (
    <Panel title="レイヤー" className="layers">
      {a && (
        <div className="layer-head">
          <select
            value={a.props.blend}
            aria-label="合成モード"
            onChange={(e) => s.setLayerProps(a.id, { blend: e.target.value }, "合成モード")}
          >
            {blendOpts.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <OpacitySlider layer={a} />
          <div className="layer-flags">
            <Flag on={a.props.clip} label="クリッピング" title="下のレイヤーでクリッピング（Ctrl+Alt+G）" onClick={() => s.setLayerProps(a.id, { clip: !a.props.clip }, "クリッピング")} text="クリップ" />
            <Flag on={a.props.alphaLock} label="透明ピクセルをロック" title="透明ピクセルをロック（描いてある所だけに描く）" onClick={() => s.setLayerProps(a.id, { alphaLock: !a.props.alphaLock }, "透明ピクセルをロック")} text="透明ロック" />
            <Flag on={a.props.locked} label="ロック" title="レイヤーをロック" onClick={() => s.setLayerProps(a.id, { locked: !a.props.locked }, "ロック")} text="ロック" />
            <Flag on={a.props.isRef} label="参照レイヤー" title="参照レイヤー（塗りつぶしの「参照レイヤー」で使う線画など）" onClick={() => s.setLayerProps(a.id, { isRef: !a.props.isRef }, "参照レイヤー")} text="参照" />
            <Flag on={a.props.isDraft} label="下描きレイヤー" title="下描きレイヤー（書き出し・塗りつぶしの参照に入れない）" onClick={() => s.setLayerProps(a.id, { isDraft: !a.props.isDraft }, "下描きレイヤー")} text="下描き" />
          </div>
        </div>
      )}
      <ul className="layer-list" onDragOver={(e) => e.preventDefault()} onDrop={drop} aria-label="レイヤーの一覧">
        {rows.map(({ layer, depth }) => (
          <Row key={layer.id} layer={layer} depth={depth} drag={drag} setDrag={setDrag} />
        ))}
      </ul>
      <div className="layer-actions">
        <button type="button" className="icon-btn" title="新しいレイヤー（Ctrl+Shift+N）" aria-label="新しいレイヤー" onClick={() => s.addLayer()}>
          <Plus size={15} />
        </button>
        <button type="button" className="icon-btn" title="新しいフォルダー" aria-label="新しいフォルダー" onClick={() => s.addGroup()}>
          <FolderPlus size={15} />
        </button>
        <button type="button" className="icon-btn" title="レイヤーマスクを作成（選択範囲があればその形）" aria-label="レイヤーマスクを作成" onClick={() => addMask(s)}>
          <SquareDashed size={15} />
        </button>
        <button type="button" className="icon-btn" title="複製" aria-label="レイヤーを複製" onClick={() => a && s.duplicateLayer(a.id)}>
          <Copy size={15} />
        </button>
        <button type="button" className="icon-btn" title="下のレイヤーと結合（Ctrl+E）" aria-label="下のレイヤーと結合" onClick={() => mergeDown(s)}>
          <ArrowDownToLine size={15} />
        </button>
        <button type="button" className="icon-btn" title="削除" aria-label="レイヤーを削除" onClick={() => a && s.deleteLayer(a.id)}>
          <Trash2 size={15} />
        </button>
      </div>
    </Panel>
  );
}

function OpacitySlider({ layer }: { layer: Layer }) {
  const s = useStudio();
  const start = useRef<number | null>(null);
  return (
    <Slider
      label="不透明度"
      value={layer.props.opacity}
      min={0}
      max={1}
      onChange={(v) => {
        if (start.current === null) start.current = layer.props.opacity;
        s.setLayerPropsLive(layer.id, { opacity: v });
      }}
      onCommit={(v) => {
        // 動かした分を 1 手順として記録
        const from = start.current ?? layer.props.opacity;
        start.current = null;
        s.setLayerPropsLive(layer.id, { opacity: from });
        s.setLayerProps(layer.id, { opacity: v }, "不透明度");
      }}
    />
  );
}

function Flag(p: { on: boolean; label: string; title: string; text: string; onClick: () => void }) {
  return (
    <button type="button" className={`flag${p.on ? " is-on" : ""}`} aria-pressed={p.on} aria-label={p.label} title={p.title} onClick={p.onClick}>
      {p.text}
    </button>
  );
}

function Row({ layer, depth, drag, setDrag }: { layer: Layer; depth: number; drag: { id: string; over: string | null; where: "above" | "below" | "into" } | null; setDrag: (d: { id: string; over: string | null; where: "above" | "below" | "into" } | null) => void }) {
  const s = useStudio();
  const active = s.doc.activeId === layer.id;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(layer.props.name);
  const p = layer.props;
  const over = drag && drag.over === layer.id && drag.id !== layer.id ? drag.where : null;
  return (
    <li
      className={`layer-row${active ? " is-on" : ""}${over ? ` drop-${over}` : ""}${p.clip ? " is-clip" : ""}`}
      style={{ paddingLeft: 4 + depth * 14 }}
      draggable={!editing}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", layer.id);
        setDrag({ id: layer.id, over: null, where: "above" });
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!drag) return;
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const t = (e.clientY - r.top) / r.height;
        const where = layer.isGroup && t > 0.3 && t < 0.7 ? "into" : t < 0.5 ? "above" : "below";
        if (drag.over !== layer.id || drag.where !== where) setDrag({ ...drag, over: layer.id, where });
      }}
      onDragEnd={() => setDrag(null)}
      onClick={() => s.setActive(layer.id, false)}
      data-layer={layer.id}
    >
      <button
        type="button"
        className="eye"
        aria-label={p.visible ? "非表示にする" : "表示する"}
        title={p.visible ? "非表示にする" : "表示する"}
        onClick={(e) => {
          e.stopPropagation();
          s.setLayerProps(layer.id, { visible: !p.visible }, p.visible ? "非表示" : "表示");
        }}
      >
        {p.visible ? <Eye size={14} /> : <EyeOff size={14} />}
      </button>
      {layer.isGroup ? (
        <button
          type="button"
          className="fold"
          aria-label={p.expanded ? "フォルダーを閉じる" : "フォルダーを開く"}
          onClick={(e) => {
            e.stopPropagation();
            s.setLayerPropsLive(layer.id, { expanded: !p.expanded });
          }}
        >
          {p.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      ) : (
        p.clip && <span className="clip-mark" aria-hidden="true">↳</span>
      )}
      <Thumb layer={layer} />
      {layer.maskTex && (
        <button
          type="button"
          className={`mask-thumb${active && s.doc.editMask ? " is-on" : ""}${p.maskEnabled ? "" : " is-off"}`}
          title="マスクを編集（Shift+クリックで一時的に無効）"
          aria-label="マスクを編集"
          onClick={(e) => {
            e.stopPropagation();
            if (e.shiftKey) s.setLayerProps(layer.id, { maskEnabled: !p.maskEnabled }, "マスクの有効・無効");
            else s.setActive(layer.id, true);
          }}
        >
          <MaskThumb layer={layer} />
        </button>
      )}
      <div className="layer-info">
        {editing ? (
          <input
            className="layer-name-input"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              setEditing(false);
              if (name.trim() && name !== p.name) s.setLayerProps(layer.id, { name: name.trim() }, "名前の変更");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setName(p.name);
                setEditing(false);
              }
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="layer-name"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setName(p.name);
              setEditing(true);
            }}
          >
            {p.name}
          </span>
        )}
        <span className="layer-sub">
          {layer.kind === "text" ? "文字 · " : ""}
          {p.blend !== "normal" && p.blend !== "pass" ? `${BLEND_MODES.find((m) => m.id === p.blend)?.name} · ` : ""}
          {Math.round(p.opacity * 100)}%{p.isDraft ? " · 下描き" : ""}
          {p.isRef ? " · 参照" : ""}
        </span>
      </div>
      {p.locked && <Lock size={12} className="lock-mark" />}
      {p.alphaLock && <span className="alpha-mark" title="透明ピクセルをロック">▦</span>}
    </li>
  );
}

function Thumb({ layer }: { layer: Layer }) {
  const s = useStudio();
  useTopics("pixels", "layers");
  const ref = useRef<HTMLCanvasElement>(null);
  const v = layer.version + (layer.isGroup ? layer.children.reduce((a, c) => a + c.version, 0) : 0);
  useEffect(() => {
    const t = setTimeout(() => {
      const c = ref.current;
      if (!c) return;
      const img = s.thumbnail(layer, 64);
      if (!img) return;
      c.width = img.width;
      c.height = img.height;
      c.getContext("2d")!.putImageData(img, 0, 0);
    }, 120);
    return () => clearTimeout(t);
  }, [s, layer, v]);
  return <canvas className="thumb" ref={ref} aria-hidden="true" />;
}

function MaskThumb({ layer }: { layer: Layer }) {
  const s = useStudio();
  useTopics("pixels");
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      const c = ref.current;
      const m = layer.maskTex;
      if (!c || !m) return;
      const d = s.doc;
      const k = Math.min(1, 48 / Math.max(d.w, d.h));
      const w = Math.max(1, Math.round(d.w * k));
      const h = Math.max(1, Math.round(d.h * k));
      const raw = s.g.read(m);
      const img = new ImageData(w, h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const v = raw[Math.floor(y / k) * d.w + Math.floor(x / k)];
          const o = (y * w + x) * 4;
          img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
          img.data[o + 3] = 255;
        }
      c.width = w;
      c.height = h;
      c.getContext("2d")!.putImageData(img, 0, 0);
    }, 200);
    return () => clearTimeout(t);
  }, [s, layer, layer.version]);
  return <canvas className="thumb thumb--mask" ref={ref} aria-hidden="true" />;
}
