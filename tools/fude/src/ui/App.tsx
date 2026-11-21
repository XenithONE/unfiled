import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Studio } from "../engine/studio";
import { BrushTool, EyedropperTool, HandTool, RotateTool, ZoomTool } from "../tools/brushTool";
import { InputController } from "../tools/input";
import type { Tool } from "../tools/types";
import { registerExtraTools } from "../tools/registry";
import { installApi } from "../ai/api";
import { boot } from "../io/boot";
import { StudioCtx, useStudio, useTopics } from "./hooks";
import { MenuBar } from "./MenuBar";
import { Toolbar } from "./Toolbar";
import { SubToolPanel } from "./SubToolPanel";
import { ToolProps } from "./ToolProps";
import { ColorPanel } from "./ColorPanel";
import { LayerPanel } from "./LayerPanel";
import { Navigator } from "./Navigator";
import { StatusBar } from "./StatusBar";
import { Toasts } from "./Toasts";
import { Dialogs } from "./Dialogs";
import "./AIPanel";
import "./Gallery";
import "./CanvasDialogs";
import { RulerEditTool, installRulers } from "./Rulers";
import { installShortcuts } from "./shortcuts";
import { installPaste } from "./clipboard";
import { installDrop } from "../io/files";

function useUi(studio: Studio | null): number {
  const sub = useCallback(
    (cb: () => void) => {
      if (!studio) return () => {};
      const a = studio.ev.on("ui", cb);
      const b = studio.ev.on("tool", cb);
      return () => {
        a();
        b();
      };
    },
    [studio],
  );
  return useSyncExternalStore(sub, () => (studio ? studio.ev.version("ui") + studio.ev.version("tool") : 0));
}

export function App() {
  const ws = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const ov = useRef<HTMLCanvasElement>(null);
  const [studio, setStudio] = useState<Studio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState("default");
  useUi(studio);

  useEffect(() => {
    if (!cv.current || !ov.current || !ws.current) return;
    const s = Studio.create(cv.current);
    if (typeof s === "string") {
      setError(s);
      return;
    }
    s.setOverlay(ov.current);
    const brush = new BrushTool(s);
    const tools = new Map<string, Tool>();
    for (const g of ["pen", "pencil", "brush", "airbrush", "deco", "eraser", "blend"]) tools.set(g, brush);
    tools.set("eyedropper", new EyedropperTool(s, () => s.ui.sample));
    tools.set("hand", new HandTool(s));
    tools.set("zoom", new ZoomTool(s));
    tools.set("rotate", new RotateTool(s));
    registerExtraTools(s, tools);
    tools.set("rulerEdit", new RulerEditTool(s));
    installRulers(s);
    // 定規の小窓を開いている間は、キャンバスで定規の印を動かす
    const input = new InputController(ws.current, s, tools, () => (s.ui.dialog?.id === "rulers" ? tools.get("rulerEdit")! : tools.get(s.tool) ?? brush));
    input.onToolCursor = (c) => setCursor(c);
    s.addOverlay((ctx) => input.overlay(ctx));
    s.toolKeyHook = (name, e) => input.current().key?.(name, e) ?? false;
    let prevTool = s.tool;
    const offTool = s.ev.on("tool", () => {
      input.toolChanged(prevTool);
      prevTool = s.tool;
    });
    const measure = () => {
      const r = ws.current!.getBoundingClientRect();
      s.resize(r.width, r.height, Math.min(2, window.devicePixelRatio || 1));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(ws.current);
    const offKeys = installShortcuts(s, () => input.busy);
    const offPaste = installPaste(s);
    const offDrop = installDrop(s, ws.current);
    installApi(s);
    let alive = true;
    void boot(s).then(() => {
      if (!alive) return;
      measure();
      s.view.fit();
      setStudio(s);
    });
    return () => {
      alive = false;
      ro.disconnect();
      offTool();
      offKeys();
      offPaste();
      offDrop();
      input.dispose();
    };
  }, []);

  const ready = studio !== null;
  const hide = studio?.ui.hidePanels ?? false;
  const drawer = studio?.ui.drawer ?? null;
  const body = (
    <div className={`shell${hide ? " shell--bare" : ""}`}>
      {ready ? (
        <MenuBar />
      ) : (
        <header className="menubar">
          <span className="brand">FUDE</span>
        </header>
      )}
      <div className="body">
        {ready && !hide && <Toolbar />}
        {ready && !hide && (
          <aside className={`side side--left${drawer === "left" ? " is-open" : ""}`} aria-label="道具の設定">
            <SubToolPanel />
            <ToolProps />
          </aside>
        )}
        <main className="center">
          <div className="workspace" ref={ws} style={{ cursor }}>
            <canvas className="gl" ref={cv} aria-label="キャンバス" />
            <canvas className="overlay" ref={ov} aria-hidden="true" />
            {!ready && !error && <div className="boot">FUDE を準備しています…</div>}
            {error && (
              <div className="boot boot--error">
                <p>{error}</p>
                <a href="../../">← UNFILED</a>
              </div>
            )}
          </div>
          {ready && <Toasts />}
        </main>
        {ready && !hide && (
          <aside className={`side side--right${drawer === "right" ? " is-open" : ""}`} aria-label="色とレイヤー">
            <ColorPanel />
            <LayerPanel />
            <Navigator />
          </aside>
        )}
      </div>
      {ready && <StatusBar />}
      {ready && <MobileBar />}
      {ready && <Dialogs />}
    </div>
  );
  return (
    <div className="app">
      <StudioCtx.Provider value={studio}>{body}</StudioCtx.Provider>
    </div>
  );
}

function MobileBar() {
  const s = useStudio();
  useTopics("ui", "tool", "history");
  const d = s.ui.drawer;
  return (
    <nav className="mobilebar" aria-label="画面の切り替え">
      <button type="button" className={d === "left" ? "on" : ""} onClick={() => s.setUI({ drawer: d === "left" ? null : "left" })}>
        筆
      </button>
      <button type="button" onClick={() => s.undo()} disabled={!s.hist.canUndo}>
        取り消し
      </button>
      <button type="button" onClick={() => s.redo()} disabled={!s.hist.canRedo}>
        やり直し
      </button>
      <button type="button" onClick={() => s.setTool(s.tool === "eraser" ? "pen" : "eraser")}>
        {s.tool === "eraser" ? "ペン" : "消しゴム"}
      </button>
      <button type="button" className={d === "right" ? "on" : ""} onClick={() => s.setUI({ drawer: d === "right" ? null : "right" })}>
        色・層
      </button>
    </nav>
  );
}
