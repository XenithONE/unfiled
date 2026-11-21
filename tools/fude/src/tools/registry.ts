// 筆以外の道具と、それに付く操作（メニュー・ショートカット）を登録する。
import { deselect, featherSelection, growSelection, invertSelection, reselect, selectAll, selectLayerAlpha } from "../engine/selection";
import type { Studio } from "../engine/studio";
import { renderText } from "../engine/text";
import { registerFileActions } from "../io/files";
import { registerFilterActions } from "../ui/FilterDialog";
import { registerAction } from "../ui/actions";
import { copySel, cutSel, pasteInternal } from "../ui/clipboard";
import { FillTool, GradientTool, SelectTool, ShapeTool, WandTool } from "./shapeTools";
import { TextTool } from "./textTool";
import { MoveTool, TransformTool } from "./transformTools";
import type { Tool } from "./types";

export function registerExtraTools(s: Studio, tools: Map<string, Tool>): void {
  tools.set("select", new SelectTool(s));
  tools.set("wand", new WandTool(s));
  tools.set("fill", new FillTool(s));
  tools.set("gradient", new GradientTool(s));
  tools.set("shape", new ShapeTool(s));
  tools.set("text", new TextTool(s));
  tools.set("move", new MoveTool(s));
  const tt = new TransformTool(s);
  tools.set("transform", tt);
  s.ext.transform = tt;
  s.renderTextLayer = (l) => {
    renderText(s, l);
  };
  registerFileActions(s);
  registerFilterActions(s);

  registerAction("transform", {
    label: "変形（拡大・回転・自由変形）",
    key: "Ctrl+T",
    bind: ["ctrl+t"],
    run: () => {
      if (tt.ft) return;
      if (tt.start()) s.setTool("transform");
    },
  });
  registerAction("selAll", { label: "すべてを選択", key: "Ctrl+A", bind: ["ctrl+a"], run: () => selectAll(s) });
  registerAction("deselect", { label: "選択を解除", key: "Ctrl+D", bind: ["ctrl+d"], run: () => deselect(s), enabled: () => !!s.doc.selection });
  registerAction("reselect", { label: "再選択", key: "Ctrl+Shift+D", bind: ["ctrl+shift+d"], run: () => reselect(s) });
  registerAction("invert", { label: "選択範囲を反転", key: "Ctrl+Shift+I", bind: ["ctrl+shift+i"], run: () => invertSelection(s) });
  registerAction("selGrow", {
    label: "選択範囲を拡張…",
    run: () => s.openDialog("number", { title: "選択範囲を拡張", label: "広げる幅", value: 4, min: 1, max: 200, unit: "px", run: (v: number) => growSelection(s, v) }),
    enabled: () => !!s.doc.selection,
  });
  registerAction("selShrink", {
    label: "選択範囲を縮小…",
    run: () => s.openDialog("number", { title: "選択範囲を縮小", label: "狭める幅", value: 4, min: 1, max: 200, unit: "px", run: (v: number) => growSelection(s, -v) }),
    enabled: () => !!s.doc.selection,
  });
  registerAction("selFeather", {
    label: "選択範囲をぼかす…",
    run: () => s.openDialog("number", { title: "選択範囲をぼかす", label: "ぼかし", value: 8, min: 1, max: 200, unit: "px", run: (v: number) => featherSelection(s, v) }),
    enabled: () => !!s.doc.selection,
  });
  registerAction("selFromLayer", {
    label: "レイヤーの描いてある所を選択",
    run: () => {
      const a = s.doc.paintTarget();
      if (a) selectLayerAlpha(s, a);
    },
  });
  registerAction("cut", { label: "切り取り", key: "Ctrl+X", bind: ["ctrl+x"], run: () => cutSel(s) });
  registerAction("copy", { label: "コピー", key: "Ctrl+C", bind: ["ctrl+c"], run: () => copySel(s) });
  registerAction("paste", { label: "貼り付け（新しいレイヤーに）", key: "Ctrl+V", run: () => pasteInternal(s) });
}
