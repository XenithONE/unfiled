import { Bot, Redo2, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ACTIONS } from "./actions";
import { useStudio, useTopics } from "./hooks";

type Item = string | "-" | { sub: string; items: Item[] };

const MENUS: { name: string; items: Item[] }[] = [
  { name: "ファイル", items: ["newCanvas", "gallery", "save", "saveCopy", "-", "open", "importLayer", "-", "exportPng", "exportJpeg", "exportWebp", "exportPsd", "exportOra", "-", "timelapse", "-", "copyImage"] },
  { name: "編集", items: ["undo", "redo", "-", "cut", "copy", "paste", "clear", "fillMain", "fillSub", "-", "transform", "flipH", "flipV", "-", "canvasSize", "imageSize", "rotateCanvas", "-", { sub: "色調補正", items: ["f:brightness", "f:hsl", "f:levels", "f:curves", "f:color_balance", "f:invert", "f:posterize", "f:threshold", "f:gradient_map", "f:luma_to_alpha"] }, "-", "pressureCurve", "fingerDraw"] },
  { name: "レイヤー", items: ["newLayer", "newGroup", "dupLayer", "delLayer", "-", "mergeDown", "mergeVisible", "flatten", "-", "clip", "alphaLock", "-", "addMask", "addMaskHide", "applyMask", "deleteMask", "editLayerContent", "-", "layerProps", "selFromLayer"] },
  { name: "選択範囲", items: ["selAll", "deselect", "reselect", "invert", "-", "selGrow", "selShrink", "selFeather", "-", "selFromLayer", "selColorRange"] },
  { name: "フィルター", items: ["f:blur", "f:motion_blur", "f:radial_blur", "f:sharpen", "f:noise", "f:mosaic", "-", "f:glow", "f:chromatic", "f:vignette", "-", "f:lineart", "f:luma_to_alpha", "f:outline"] },
  { name: "表示", items: ["zoomIn", "zoomOut", "fit", "actual", "-", "flipView", "resetRotate", "-", "symmetry", "perspective", "grid", "-", "hidePanels"] },
  { name: "AI", items: ["aiPanel", "aiCopyPrompt", "aiSamples", "-", "aiApi"] },
  { name: "ヘルプ", items: ["help", "about"] },
];

export function MenuBar() {
  const s = useStudio();
  useTopics("history", "layers", "ui", "view", "selection", "color");
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (open === null) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  const run = (id: string) => {
    const a = ACTIONS[id];
    setOpen(null);
    if (a && (!a.enabled || a.enabled(s))) a.run(s);
  };
  return (
    <header className="menubar" ref={ref}>
      <a className="brand" href="../../" title="UNFILED に戻る">
        FUDE
      </a>
      <nav className="menus" aria-label="メニュー">
        {MENUS.map((m, i) => (
          <div key={m.name} className={`menu${open === i ? " is-open" : ""}`}>
            <button type="button" className="menu-btn" aria-haspopup="true" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)} onPointerEnter={() => open !== null && setOpen(i)}>
              {m.name}
            </button>
            {open === i && <MenuList items={m.items} run={run} />}
          </div>
        ))}
      </nav>
      <div className="menubar-right">
        <button type="button" className="icon-btn" title="取り消し（Ctrl+Z）" aria-label="取り消し" disabled={!s.hist.canUndo} onClick={() => s.undo()}>
          <Undo2 size={16} />
        </button>
        <button type="button" className="icon-btn" title="やり直し（Ctrl+Y）" aria-label="やり直し" disabled={!s.hist.canRedo} onClick={() => s.redo()}>
          <Redo2 size={16} />
        </button>
        {ACTIONS.aiPanel && (
          <button type="button" className="ai-btn" title="AI に描かせる" onClick={() => run("aiPanel")}>
            <Bot size={15} />
            <span>AI に描かせる</span>
          </button>
        )}
        <span className="docname" title={s.doc.name}>
          {s.doc.name}
        </span>
      </div>
    </header>
  );
}

function MenuList({ items, run }: { items: Item[]; run: (id: string) => void }) {
  const s = useStudio();
  const [sub, setSub] = useState<number | null>(null);
  const shown = items.filter((it) => it === "-" || typeof it === "object" || ACTIONS[it]);
  // 先頭・末尾・連続の区切りを詰める
  const clean: Item[] = [];
  for (const it of shown) {
    if (it === "-" && (clean.length === 0 || clean[clean.length - 1] === "-")) continue;
    clean.push(it);
  }
  while (clean[clean.length - 1] === "-") clean.pop();
  return (
    <ul className="menu-list" role="menu">
      {clean.map((it, i) => {
        if (it === "-") return <li key={`s${i}`} className="menu-sep" role="separator" />;
        if (typeof it === "object") {
          const kids = it.items.filter((x) => typeof x === "string" && ACTIONS[x]);
          if (!kids.length) return null;
          return (
            <li key={it.sub} className="menu-sub" onPointerEnter={() => setSub(i)} onPointerLeave={() => setSub(null)}>
              <button type="button" className="menu-item" role="menuitem" onClick={() => setSub(sub === i ? null : i)}>
                <span>{it.sub}</span>
                <span className="menu-key">▸</span>
              </button>
              {sub === i && <MenuList items={it.items} run={run} />}
            </li>
          );
        }
        const a = ACTIONS[it];
        const en = !a.enabled || a.enabled(s);
        const ck = a.checked?.(s);
        return (
          <li key={it}>
            <button type="button" className="menu-item" role="menuitem" disabled={!en} onClick={() => run(it)} data-action={it}>
              <span>
                {ck !== undefined && <span className="menu-check">{ck ? "✓" : ""}</span>}
                {a.label}
              </span>
              {a.key && <span className="menu-key">{a.key}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
