// テキストの道具。クリックした所に入力欄を出し（日本語入力もそのまま使える）、確定でテキストレイヤーにする。
import type { Layer } from "../engine/doc";
import { rectIntersects } from "../engine/gl";
import type { Studio } from "../engine/studio";
import { defaultText, FONT_FAMILY, updateText } from "../engine/text";
import type { Ptr, Tool } from "./types";

export class TextTool implements Tool {
  readonly id = "text";
  cursor = "text";
  private box: HTMLTextAreaElement | null = null;
  private editing: { layer: Layer | null; x: number; y: number } | null = null;
  constructor(private s: Studio) {}

  down(e: Ptr): void {
    if (this.box) {
      this.commit();
      return;
    }
    const s = this.s;
    // 選んでいるテキストレイヤーの上なら、その文字を直す
    const a = s.doc.active;
    if (a && a.kind === "text" && a.text && a.bounds && rectIntersects(a.bounds, { x: e.x - 2, y: e.y - 2, w: 4, h: 4 })) {
      this.open(a, a.text.x, a.text.y, a.text.text);
      return;
    }
    this.open(null, e.x, e.y, "");
  }
  move(): void {}
  up(): void {}
  cancel(): void {}

  private open(layer: Layer | null, x: number, y: number, text: string): void {
    const s = this.s;
    const host = s.canvas.parentElement!;
    const t = layer?.text ?? defaultText(s, x, y);
    const ta = document.createElement("textarea");
    ta.className = "text-editor";
    ta.value = text;
    ta.setAttribute("aria-label", "文字を入力（Ctrl+Enter で確定、Esc でやめる）");
    const z = s.view.zoom;
    const [sx, sy] = s.view.toScreen(x, y);
    const fs = Math.max(8, t.size * z);
    Object.assign(ta.style, {
      position: "absolute",
      left: `${t.vertical ? sx - fs * 1.2 : sx}px`,
      top: `${sy}px`,
      font: `${t.bold ? 700 : 400} ${fs}px ${FONT_FAMILY[t.font] ?? t.font}`,
      lineHeight: String(t.lineHeight),
      color: t.color,
      background: "rgba(255,255,255,0.08)",
      border: "1px dashed #fa512c",
      outline: "none",
      padding: "0",
      margin: "0",
      resize: "none",
      overflow: "hidden",
      whiteSpace: "pre",
      writingMode: t.vertical ? "vertical-rl" : "horizontal-tb",
      minWidth: `${fs * 1.2}px`,
      minHeight: `${fs * 1.2}px`,
      zIndex: "5",
      caretColor: "#fa512c",
    } as Partial<CSSStyleDeclaration>);
    const fit = () => {
      ta.style.width = "0px";
      ta.style.height = "0px";
      ta.style.width = `${Math.max(fs * 1.2, ta.scrollWidth + 4)}px`;
      ta.style.height = `${Math.max(fs * 1.2, ta.scrollHeight + 4)}px`;
      if (t.vertical) ta.style.left = `${sx - Math.max(fs * 1.2, ta.scrollWidth + 4)}px`;
    };
    ta.addEventListener("input", fit);
    ta.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Escape") {
        ev.preventDefault();
        this.close(false);
      } else if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        this.commit();
      }
    });
    ta.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    host.appendChild(ta);
    this.box = ta;
    this.editing = { layer, x, y };
    if (layer) {
      // 編集中は元の文字を隠す
      layer.props.visible = false;
      s.emitLayers();
    }
    fit();
    // すぐ打ち始めても取りこぼさないよう、その場で焦点を移す（念のため次の瞬間にも）
    ta.focus();
    setTimeout(() => ta.focus(), 0);
  }

  private close(apply: boolean): void {
    const ta = this.box;
    const ed = this.editing;
    this.box = null;
    this.editing = null;
    if (!ta || !ed) return;
    const text = ta.value.replace(/\s+$/g, "");
    ta.remove();
    const s = this.s;
    if (ed.layer) {
      ed.layer.props.visible = true;
      s.emitLayers();
    }
    if (!apply) return;
    if (ed.layer) {
      if (!text) s.deleteLayer(ed.layer.id);
      else if (text !== ed.layer.text?.text) updateText(s, ed.layer, { text });
      return;
    }
    if (!text) return;
    s.addTextLayer(defaultText(s, ed.x, ed.y, text));
    s.emit("pixels");
  }

  commit(): void {
    this.close(true);
  }

  key(name: string): boolean {
    if (!this.box) return false;
    if (name === "escape") {
      this.close(false);
      return true;
    }
    return false;
  }

  deactivate(): void {
    if (this.box) this.commit();
  }
}
