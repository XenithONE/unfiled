// メニューとショートカットが共有する「操作」。key は表示用、bind は判定用（小文字・修飾キー付き）。
import { addMask, clearArea, deleteMask, fillArea, flatten, flipLayer, mergeDown, mergeVisibleCopy } from "../engine/layerOps";
import type { Studio } from "../engine/studio";

export interface Action {
  label: string;
  key?: string;
  bind?: string[];
  run: (s: Studio) => void;
  enabled?: (s: Studio) => boolean;
  checked?: (s: Studio) => boolean;
}

/** あとから足す操作（選択範囲・フィルター・書き出し・AI などの各部品が登録する）。 */
export const ACTIONS: Record<string, Action> = {
  undo: { label: "取り消し", key: "Ctrl+Z", bind: ["ctrl+z"], run: (s) => s.undo(), enabled: (s) => s.hist.canUndo },
  redo: { label: "やり直し", key: "Ctrl+Y", bind: ["ctrl+y", "ctrl+shift+z"], run: (s) => s.redo(), enabled: (s) => s.hist.canRedo },
  newCanvas: { label: "新規…", key: "Ctrl+N", bind: ["ctrl+n", "ctrl+alt+n"], run: (s) => s.openDialog("new") },
  newLayer: { label: "新規ラスターレイヤー", key: "Ctrl+Shift+N", bind: ["ctrl+shift+n"], run: (s) => s.addLayer() },
  newGroup: { label: "新規フォルダー", run: (s) => s.addGroup() },
  dupLayer: { label: "レイヤーを複製", key: "Ctrl+J", bind: ["ctrl+j"], run: (s) => s.duplicateLayer(s.doc.activeId) },
  delLayer: { label: "レイヤーを削除", run: (s) => s.deleteLayer(s.doc.activeId) },
  mergeDown: { label: "下のレイヤーと結合", key: "Ctrl+E", bind: ["ctrl+e"], run: (s) => mergeDown(s) },
  mergeVisible: { label: "表示レイヤーのコピーを結合", key: "Ctrl+Shift+E", bind: ["ctrl+shift+e"], run: (s) => mergeVisibleCopy(s) },
  flatten: { label: "画像を統合", run: (s) => flatten(s) },
  clip: {
    label: "下のレイヤーでクリッピング",
    key: "Ctrl+Alt+G",
    bind: ["ctrl+alt+g"],
    run: (s) => {
      const a = s.doc.active;
      if (a) s.setLayerProps(a.id, { clip: !a.props.clip }, "クリッピング");
    },
    checked: (s) => !!s.doc.active?.props.clip,
  },
  alphaLock: {
    label: "透明ピクセルをロック",
    key: "/",
    bind: ["/"],
    run: (s) => {
      const a = s.doc.active;
      if (a) s.setLayerProps(a.id, { alphaLock: !a.props.alphaLock }, "透明ピクセルをロック");
    },
    checked: (s) => !!s.doc.active?.props.alphaLock,
  },
  addMask: { label: "レイヤーマスクを作成", run: (s) => addMask(s) },
  addMaskHide: { label: "レイヤーマスク（全部隠す）", run: (s) => addMask(s, undefined, true) },
  applyMask: { label: "マスクを適用", run: (s) => deleteMask(s, undefined, true), enabled: (s) => !!s.doc.active?.maskTex },
  deleteMask: { label: "マスクを削除", run: (s) => deleteMask(s), enabled: (s) => !!s.doc.active?.maskTex },
  editLayerContent: { label: "レイヤーの中身を編集（マスクから戻る）", run: (s) => s.setActive(s.doc.activeId, false), enabled: (s) => s.doc.editMask },
  clear: { label: "消去", key: "Delete", bind: ["delete", "backspace"], run: (s) => clearArea(s) },
  fillMain: { label: "描画色で塗りつぶし", key: "Alt+Delete", bind: ["alt+delete", "alt+backspace"], run: (s) => fillArea(s, s.colors.main) },
  fillSub: { label: "背景色で塗りつぶし", key: "Ctrl+Delete", bind: ["ctrl+delete", "ctrl+backspace"], run: (s) => fillArea(s, s.colors.sub) },
  flipH: { label: "レイヤーを左右反転", run: (s) => flipLayer(s, "h") },
  flipV: { label: "レイヤーを上下反転", run: (s) => flipLayer(s, "v") },
  zoomIn: { label: "拡大", key: "Ctrl++", bind: ["ctrl+=", "ctrl++", "ctrl+;", "+"], run: (s) => s.view.zoomAt(s.view.zoom * 1.25, s.view.sw / 2, s.view.sh / 2) },
  zoomOut: { label: "縮小", key: "Ctrl+-", bind: ["ctrl+-", "-"], run: (s) => s.view.zoomAt(s.view.zoom / 1.25, s.view.sw / 2, s.view.sh / 2) },
  fit: { label: "全体を表示", key: "Ctrl+0", bind: ["ctrl+0"], run: (s) => s.view.fit() },
  actual: { label: "100%", key: "Ctrl+1", bind: ["ctrl+1"], run: (s) => s.view.zoomAt(1, s.view.sw / 2, s.view.sh / 2) },
  flipView: { label: "左右反転表示", key: "H", bind: ["shift+h"], run: (s) => s.view.setFlip(!s.view.flip), checked: (s) => s.view.flip },
  resetRotate: { label: "回転を戻す", key: "Shift+R", bind: ["shift+r"], run: (s) => s.view.rotateAt(0, s.view.sw / 2, s.view.sh / 2) },
  hidePanels: { label: "パネルを隠す", key: "Tab", bind: ["tab"], run: (s) => s.setUI({ hidePanels: !s.ui.hidePanels }), checked: (s) => s.ui.hidePanels },
  swap: { label: "描画色と背景色を入れ替え", key: "X", bind: ["x"], run: (s) => s.swapColors() },
  sizeDown: { label: "筆を小さく", key: "[", bind: ["["], run: (s) => s.setBrushParam("size", Math.max(1, Math.round(s.currentBrush().size / 1.15 * 10) / 10)) },
  sizeUp: { label: "筆を大きく", key: "]", bind: ["]"], run: (s) => s.setBrushParam("size", Math.min(1000, Math.round(s.currentBrush().size * 1.15 * 10) / 10 + 0.5)) },
  transparent: {
    label: "透明色で描く",
    key: "C",
    bind: ["c"],
    run: (s) => {
      s.colors.transparent = !s.colors.transparent;
      s.emit("color");
    },
    checked: (s) => s.colors.transparent,
  },
  help: { label: "操作の一覧", key: "F1", bind: ["f1", "shift+/"], run: (s) => s.openDialog("help") },
  about: { label: "FUDE について", run: (s) => s.openDialog("about") },
  fingerDraw: {
    label: "指で描く（タッチ端末）",
    run: (s) => {
      s.fingerDraw = !s.fingerDraw;
      s.saveSettings();
      s.emit("ui");
    },
    checked: (s) => s.fingerDraw,
  },
  pressureCurve: { label: "筆圧の調整…", run: (s) => s.openDialog("pressure") },
};

/** 道具のキー（修飾なし）。 */
export const TOOL_KEYS: Record<string, string> = {
  v: "move",
  m: "select",
  w: "wand",
  i: "eyedropper",
  p: "pen",
  n: "pencil",
  b: "brush",
  a: "airbrush",
  d: "deco",
  e: "eraser",
  j: "blend",
  g: "fill",
  "shift+g": "gradient",
  u: "shape",
  t: "text",
  h: "hand",
  z: "zoom",
};

export function registerAction(id: string, a: Action): void {
  ACTIONS[id] = a;
}
