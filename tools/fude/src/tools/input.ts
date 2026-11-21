// ポインター（マウス・ペン・指）とホイールを道具へ配る。指 2 本で移動・拡大・回転、2 本タップで取り消し。
import type { Studio, ToolId } from "../engine/studio";
import type { Ptr, Tool } from "./types";

interface Touch {
  id: number;
  sx: number;
  sy: number;
  t0: number;
  x0: number;
  y0: number;
}

export class InputController {
  private el: HTMLElement;
  private studio: Studio;
  private tools: Map<string, Tool>;
  private resolve: () => Tool;
  private active: Tool | null = null;
  private activeId: number | null = null;
  private activeType: Ptr["type"] = "mouse";
  private touches = new Map<number, Touch>();
  private gesture: { d0: number; a0: number; z0: number; r0: number; px: number; py: number; t0: number; maxTouches: number; moved: boolean } | null = null;
  private penSeen = false;
  private keys = new Set<string>();
  private temp: string | null = null;
  private lastHover: Ptr | null = null;
  private panMiddle: { sx: number; sy: number } | null = null;
  onToolCursor: ((c: string) => void) | null = null;
  private startT = 0;

  constructor(el: HTMLElement, studio: Studio, tools: Map<string, Tool>, resolve: () => Tool) {
    this.el = el;
    this.studio = studio;
    this.tools = tools;
    this.resolve = resolve;
    el.addEventListener("pointerdown", this.onDown, { passive: false });
    el.addEventListener("pointermove", this.onMove, { passive: false });
    el.addEventListener("pointerup", this.onUp, { passive: false });
    el.addEventListener("pointercancel", this.onCancel, { passive: false });
    el.addEventListener("pointerleave", this.onLeave);
    el.addEventListener("wheel", this.onWheel, { passive: false });
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.updateTemp();
    });
  }

  /** 今の道具（Space などの一時的な切り替えを含む）。 */
  current(): Tool {
    if (this.temp) return this.tools.get(this.temp)!;
    return this.resolve();
  }

  get busy(): boolean {
    return this.active !== null || this.gesture !== null;
  }

  private ptr(e: PointerEvent): Ptr {
    const r = this.el.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const [x, y] = this.studio.view.toCanvas(sx, sy);
    const type = (e.pointerType === "pen" ? "pen" : e.pointerType === "touch" ? "touch" : "mouse") as Ptr["type"];
    let p = e.pressure;
    if (type === "mouse" || (type === "touch" && p === 0)) p = e.buttons ? 1 : 0;
    if (type === "pen" && e.buttons && p === 0) p = 0.01;
    return { x, y, sx, sy, p, tx: e.tiltX || 0, ty: e.tiltY || 0, t: e.timeStamp, type, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, button: e.button };
  }

  private onDown = (e: PointerEvent): void => {
    e.preventDefault();
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body && !this.el.contains(document.activeElement)) document.activeElement.blur();
    if (e.pointerType === "pen") this.penSeen = true;
    if (e.pointerType === "touch") {
      this.touches.set(e.pointerId, { id: e.pointerId, sx: e.clientX, sy: e.clientY, t0: e.timeStamp, x0: e.clientX, y0: e.clientY });
      this.el.setPointerCapture(e.pointerId);
      if (this.touches.size >= 2) {
        // 1 本目で描き始めていたら、短ければ取り消し、長ければ確定
        if (this.active && this.activeType === "touch") {
          if (e.timeStamp - this.startT < 300) this.active.cancel();
          else this.active.up(this.ptr(e));
          this.active = null;
          this.activeId = null;
        }
        this.startGesture(e.timeStamp);
        return;
      }
      const drawWithFinger = this.studio.fingerDraw && !this.penSeen;
      const tool = this.current();
      if (!drawWithFinger && !["hand", "zoom", "rotate", "move", "transform", "select", "text", "shape", "gradient"].includes(tool.id)) {
        // 指は移動だけ（ペンを使う人の手のひらで描かないように）
        this.startGesture(e.timeStamp);
        return;
      }
    }
    if (e.pointerType === "mouse" && e.button === 1) {
      this.panMiddle = { sx: e.clientX, sy: e.clientY };
      this.el.setPointerCapture(e.pointerId);
      return;
    }
    if (e.pointerType === "mouse" && e.button === 2) {
      // 右クリック: スポイト（描画色）
      const p = this.ptr(e);
      const c = this.studio.pick(p.x, p.y);
      if (c) this.studio.setColor(c);
      return;
    }
    if (this.active) return;
    this.el.setPointerCapture(e.pointerId);
    const tool = this.current();
    this.active = tool;
    this.activeId = e.pointerId;
    this.activeType = this.ptr(e).type;
    this.startT = e.timeStamp;
    tool.down(this.ptr(e));
    this.cursorUpdate();
  };

  private coalesced(e: PointerEvent): PointerEvent[] {
    const list = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    return list.length ? list : [e];
  }

  private onMove = (e: PointerEvent): void => {
    if (e.pointerType === "touch" && this.touches.has(e.pointerId)) {
      const t = this.touches.get(e.pointerId)!;
      t.sx = e.clientX;
      t.sy = e.clientY;
      if (this.gesture) {
        e.preventDefault();
        this.updateGesture();
        return;
      }
    }
    if (this.panMiddle) {
      this.studio.view.panBy(e.clientX - this.panMiddle.sx, e.clientY - this.panMiddle.sy);
      this.panMiddle = { sx: e.clientX, sy: e.clientY };
      return;
    }
    if (this.active && e.pointerId === this.activeId) {
      e.preventDefault();
      for (const ce of this.coalesced(e)) {
        const p = this.ptr(ce);
        // 合成イベントはボタン情報を失うことがあるので元の値で補う
        if (p.type !== "pen" && e.buttons) p.p = Math.max(p.p, 1);
        this.active.move(p);
      }
      return;
    }
    if (!this.active && e.pointerType !== "touch") {
      const p = this.ptr(e);
      this.lastHover = p;
      this.current().hover?.(p);
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerType === "touch" && this.touches.has(e.pointerId)) {
      this.touches.delete(e.pointerId);
      if (this.gesture) {
        if (this.touches.size === 0) this.endGesture(e.timeStamp);
        else if (this.touches.size === 1) {
          // 残りの指で引き続き移動
          this.startGesture(e.timeStamp, true);
        }
        return;
      }
    }
    if (this.panMiddle) {
      this.panMiddle = null;
      return;
    }
    if (this.active && e.pointerId === this.activeId) {
      const p = this.ptr(e);
      p.p = this.activeType === "pen" ? Math.max(0.01, p.p) : 1;
      this.active.up(p);
      this.active = null;
      this.activeId = null;
      this.cursorUpdate();
    }
  };

  private onCancel = (e: PointerEvent): void => {
    if (e.pointerType === "touch") this.touches.delete(e.pointerId);
    if (this.gesture && this.touches.size === 0) this.gesture = null;
    if (this.active && e.pointerId === this.activeId) {
      this.active.up(this.ptr(e));
      this.active = null;
      this.activeId = null;
    }
  };

  private onLeave = (): void => {
    if (!this.active) this.current().leave?.();
  };

  private startGesture(t: number, keep = false): void {
    const pts = [...this.touches.values()];
    const v = this.studio.view;
    const r = this.el.getBoundingClientRect();
    let mx = 0;
    let my = 0;
    for (const p of pts) {
      mx += p.sx - r.left;
      my += p.sy - r.top;
    }
    mx /= pts.length;
    my /= pts.length;
    const [px, py] = v.toCanvas(mx, my);
    let d0 = 1;
    let a0 = 0;
    if (pts.length >= 2) {
      d0 = Math.max(1, Math.hypot(pts[1].sx - pts[0].sx, pts[1].sy - pts[0].sy));
      a0 = Math.atan2(pts[1].sy - pts[0].sy, pts[1].sx - pts[0].sx);
    }
    const prev = this.gesture;
    this.gesture = { d0, a0, z0: v.zoom, r0: v.rot, px, py, t0: keep && prev ? prev.t0 : t, maxTouches: Math.max(prev && keep ? prev.maxTouches : 0, pts.length), moved: keep && prev ? prev.moved : false };
  }

  private updateGesture(): void {
    const gst = this.gesture;
    if (!gst) return;
    const pts = [...this.touches.values()];
    gst.maxTouches = Math.max(gst.maxTouches, pts.length);
    const v = this.studio.view;
    const r = this.el.getBoundingClientRect();
    let mx = 0;
    let my = 0;
    for (const p of pts) {
      mx += p.sx - r.left;
      my += p.sy - r.top;
      if (Math.hypot(p.sx - p.x0, p.sy - p.y0) > 12) gst.moved = true;
    }
    mx /= pts.length;
    my /= pts.length;
    if (pts.length >= 2) {
      const d = Math.max(1, Math.hypot(pts[1].sx - pts[0].sx, pts[1].sy - pts[0].sy));
      const a = Math.atan2(pts[1].sy - pts[0].sy, pts[1].sx - pts[0].sx);
      v.zoom = Math.max(0.01, Math.min(64, gst.z0 * (d / gst.d0)));
      let rot = gst.r0 + (a - gst.a0);
      // 0° 付近は吸着
      const snap = Math.round(rot / (Math.PI / 2)) * (Math.PI / 2);
      if (Math.abs(rot - snap) < 0.06) rot = snap;
      v.rot = rot;
    }
    // ジェスチャー開始時に指の下にあった点を、今の指の中心へ
    const [qx, qy] = v.toCanvas(mx, my);
    v.cx += gst.px - qx;
    v.cy += gst.py - qy;
    v.fitted = false;
    v.onChange?.();
  }

  private endGesture(t: number): void {
    const gst = this.gesture;
    this.gesture = null;
    if (!gst) return;
    if (!gst.moved && t - gst.t0 < 320) {
      if (gst.maxTouches === 2) this.studio.undo();
      else if (gst.maxTouches === 3) this.studio.redo();
    }
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const r = this.el.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const v = this.studio.view;
    const mouseWheel = e.deltaMode !== 0 || (Math.abs(e.deltaY) >= 40 && Math.abs(e.deltaX) < 1 && Number.isInteger(e.deltaY));
    if (e.ctrlKey || e.metaKey || mouseWheel) {
      if (e.altKey) {
        v.rotateAt(v.rot + Math.sign(e.deltaY) * (Math.PI / 24), v.sw / 2, v.sh / 2);
        return;
      }
      const k = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : e.ctrlKey && !mouseWheel ? 0.01 : 0.0018));
      v.zoomAt(v.zoom * k, sx, sy);
    } else {
      v.panBy(-e.deltaX, -e.deltaY);
    }
  };

  private typing(): boolean {
    const a = document.activeElement;
    return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || (a as HTMLElement).isContentEditable);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.typing()) return;
    const k = e.key === " " ? "space" : e.key.toLowerCase();
    if (k === "space" || k === "alt" || k === "control" || k === "meta" || k === "r") {
      if (k === "space" || k === "alt") e.preventDefault();
      if (k === "r" && (e.ctrlKey || e.metaKey)) return;
      this.keys.add(k);
      this.updateTemp();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const k = e.key === " " ? "space" : e.key.toLowerCase();
    this.keys.delete(k);
    if (k === "control") this.keys.delete("meta");
    this.updateTemp();
  };

  /** Space＝手のひら、Ctrl+Space＝拡大、Alt（筆の道具で）＝スポイト、R＝回転。 */
  private updateTemp(): void {
    if (this.active) return;
    let t: string | null = null;
    const base = this.resolve().id;
    const ctrl = this.keys.has("control") || this.keys.has("meta");
    if (this.keys.has("space")) t = ctrl ? "zoom" : "hand";
    else if (this.keys.has("r")) t = "rotate";
    else if (this.keys.has("alt") && ["brush", "fill", "gradient", "shape"].includes(base)) t = "eyedropper";
    if (t !== this.temp) {
      if (this.lastHover) this.current().leave?.();
      this.temp = t;
      this.cursorUpdate();
      if (this.lastHover) this.current().hover?.(this.lastHover);
      this.studio.requestFrame();
    }
  }

  cursorUpdate(): void {
    this.onToolCursor?.(this.current().cursor ?? "default");
  }

  /** 道具が変わったとき（今の一筆は確定）。 */
  toolChanged(prev: ToolId | null): void {
    if (this.active) {
      this.active.cancel();
      this.active = null;
    }
    if (prev) this.tools.get(prev)?.deactivate?.();
    this.cursorUpdate();
  }

  overlay(ctx: CanvasRenderingContext2D): void {
    this.current().overlay?.(ctx);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }
}
