import type { Studio, ToolId } from "../engine/studio";
import { ACTIONS, TOOL_KEYS } from "./actions";

export function keyName(e: KeyboardEvent): string {
  let k = e.key.toLowerCase();
  if (k === " ") k = "space";
  if (k === "esc") k = "escape";
  if (e.code === "Slash" && !e.shiftKey) k = "/";
  if (e.code === "Slash" && e.shiftKey) k = "/";
  if (e.code === "BracketLeft") k = "[";
  if (e.code === "BracketRight") k = "]";
  if (e.code === "Equal") k = e.shiftKey ? "+" : "=";
  if (e.code === "Minus") k = "-";
  if (e.code === "Semicolon") k = ";";
  if (/^Digit\d$/.test(e.code)) k = e.code.slice(5);
  if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3).toLowerCase();
  const mods = [(e.ctrlKey || e.metaKey) && "ctrl", e.altKey && "alt", e.shiftKey && "shift"].filter(Boolean);
  return [...mods, k].join("+");
}

export function installShortcuts(s: Studio, busy: () => boolean): () => void {
  const onKey = (e: KeyboardEvent) => {
    const a = document.activeElement as HTMLElement | null;
    if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable)) return;
    if (s.ui.dialog && s.ui.dialog.id !== "ai" && e.key !== "Escape") return;
    const name = keyName(e);
    if (e.key === "Escape" && s.ui.dialog) {
      s.closeDialog();
      e.preventDefault();
      return;
    }
    // 道具が先に受け取る（変形の Enter など）
    const hook = s.toolKeyHook;
    if (hook && hook(name, e)) {
      e.preventDefault();
      return;
    }
    for (const act of Object.values(ACTIONS)) {
      if (act.bind?.includes(name)) {
        e.preventDefault();
        if (busy() && name !== "ctrl+z") return;
        if (!act.enabled || act.enabled(s)) act.run(s);
        return;
      }
    }
    const tool = TOOL_KEYS[name];
    if (tool && !busy()) {
      e.preventDefault();
      s.setTool(tool as ToolId);
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
