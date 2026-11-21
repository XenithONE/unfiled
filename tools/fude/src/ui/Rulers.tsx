// 定規（対称定規・パース定規）とグリッド。小窓を開いている間は、キャンバスで中心や消失点をドラッグして動かせる。
import { X } from "lucide-react";
import type { Studio } from "../engine/studio";
import type { Ptr, Tool } from "../tools/types";
import { registerAction } from "./actions";
import { Segmented, Slider, Toggle } from "./controls";
import { registerDialog } from "./Dialogs";
import { useStudio, useTopics } from "./hooks";

export const grid = { enabled: false, size: 100 };

function RulerPanel() {
  const s = useStudio();
  useTopics("ui", "view");
  const sym = s.symmetry;
  const per = s.perspective;
  const d = s.doc;
  const set = () => {
    s.emit("ui");
    s.requestFrame();
  };
  const presetVP = (n: 1 | 2 | 3) => {
    const W = d.w;
    const H = d.h;
    const hy = H * 0.42;
    per.points = n === 1 ? [{ x: W / 2, y: hy }] : n === 2 ? [{ x: -W * 0.35, y: hy }, { x: W * 1.35, y: hy }] : [{ x: -W * 0.35, y: hy }, { x: W * 1.35, y: hy }, { x: W / 2, y: H * 2.4 }];
    per.enabled = true;
    set();
  };
  return (
    <div className="float-panel rulers" role="dialog" aria-label="定規">
      <header className="dialog-head">
        <h2>定規</h2>
        <button type="button" className="icon-btn" aria-label="閉じる" onClick={() => s.closeDialog()}>
          <X size={16} />
        </button>
      </header>
      <div className="dialog-body">
        <p className="hint">この小窓を開いている間は、キャンバスの丸い印（中心・消失点）をドラッグして動かせます。閉じると描けます。</p>
        <section className="ruler-sec">
          <Toggle
            label="対称定規"
            value={sym.enabled}
            onChange={(v) => {
              sym.enabled = v;
              set();
            }}
          />
          <Segmented
            value={sym.mode}
            options={[
              { value: "vertical", label: "左右" },
              { value: "horizontal", label: "上下" },
              { value: "both", label: "上下左右" },
              { value: "radial", label: "放射" },
            ]}
            onChange={(v) => {
              sym.mode = v;
              sym.enabled = true;
              set();
            }}
          />
          {sym.mode === "radial" && (
            <>
              <Slider
                label="数"
                value={sym.count}
                min={2}
                max={32}
                step={1}
                onChange={(v) => {
                  sym.count = v;
                  set();
                }}
              />
              <Toggle
                label="鏡写しも入れる（万華鏡）"
                value={sym.mirror}
                onChange={(v) => {
                  sym.mirror = v;
                  set();
                }}
              />
            </>
          )}
          <button
            type="button"
            className="btn btn--small"
            onClick={() => {
              sym.cx = d.w / 2;
              sym.cy = d.h / 2;
              set();
            }}
          >
            中心をキャンバスの真ん中へ
          </button>
        </section>
        <section className="ruler-sec">
          <Toggle
            label="パース定規"
            value={per.enabled}
            onChange={(v) => {
              per.enabled = v;
              if (v && !per.points.length) presetVP(2);
              set();
            }}
          />
          <div className="btn-grid btn-grid--3">
            <button type="button" className="btn btn--small" onClick={() => presetVP(1)}>
              1 点透視
            </button>
            <button type="button" className="btn btn--small" onClick={() => presetVP(2)}>
              2 点透視
            </button>
            <button type="button" className="btn btn--small" onClick={() => presetVP(3)}>
              3 点透視
            </button>
          </div>
          <Toggle
            label="線を消失点へ吸い付ける"
            value={per.snap}
            onChange={(v) => {
              per.snap = v;
              set();
            }}
          />
          <p className="hint">吸い付けは、描き始めの向きにいちばん近い線（消失点へ向かう線・水平・垂直）を選びます。</p>
        </section>
        <section className="ruler-sec">
          <Toggle
            label="グリッド"
            value={grid.enabled}
            onChange={(v) => {
              grid.enabled = v;
              set();
            }}
          />
          {grid.enabled && (
            <Slider
              label="間隔"
              value={grid.size}
              min={10}
              max={500}
              step={5}
              unit="px"
              onChange={(v) => {
                grid.size = v;
                set();
              }}
            />
          )}
        </section>
      </div>
    </div>
  );
}

/** 定規の印をドラッグする道具（小窓を開いている間だけ使う）。 */
export class RulerEditTool implements Tool {
  readonly id = "rulerEdit";
  cursor = "grab";
  private drag: { kind: "sym" } | { kind: "vp"; i: number } | null = null;
  constructor(private s: Studio) {}
  private hit(e: Ptr): RulerEditTool["drag"] {
    const s = this.s;
    const near = (x: number, y: number) => {
      const [sx, sy] = s.view.toScreen(x, y);
      return Math.hypot(sx - e.sx, sy - e.sy) < 14;
    };
    if (s.symmetry.enabled && near(s.symmetry.cx, s.symmetry.cy)) return { kind: "sym" };
    if (s.perspective.enabled) for (let i = 0; i < s.perspective.points.length; i++) if (near(s.perspective.points[i].x, s.perspective.points[i].y)) return { kind: "vp", i };
    return null;
  }
  down(e: Ptr): void {
    this.drag = this.hit(e);
  }
  move(e: Ptr): void {
    const dr = this.drag;
    if (!dr) return;
    if (dr.kind === "sym") {
      this.s.symmetry.cx = e.x;
      this.s.symmetry.cy = e.y;
    } else this.s.perspective.points[dr.i] = { x: e.x, y: e.y };
    this.s.requestFrame();
  }
  up(): void {
    this.drag = null;
  }
  cancel(): void {
    this.drag = null;
  }
  hover(e: Ptr): void {
    this.cursor = this.hit(e) ? "grab" : "not-allowed";
  }
}

export function installRulers(s: Studio): void {
  s.addOverlay((ctx) => {
    const v = s.view;
    const editing = s.ui.dialog?.id === "rulers";
    if (grid.enabled) {
      const d = s.doc;
      ctx.strokeStyle = "rgba(80,140,255,0.28)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= d.w; x += grid.size) {
        const [ax, ay] = v.toScreen(x, 0);
        const [bx, by] = v.toScreen(x, d.h);
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
      }
      for (let y = 0; y <= d.h; y += grid.size) {
        const [ax, ay] = v.toScreen(0, y);
        const [bx, by] = v.toScreen(d.w, y);
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
      }
      ctx.stroke();
    }
    const handle = (x: number, y: number, color: string) => {
      const [sx, sy] = v.toScreen(x, y);
      ctx.beginPath();
      ctx.arc(sx, sy, editing ? 7 : 4, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    };
    const line = (x0: number, y0: number, x1: number, y1: number) => {
      const [a, b] = v.toScreen(x0, y0);
      const [c, d] = v.toScreen(x1, y1);
      ctx.moveTo(a, b);
      ctx.lineTo(c, d);
    };
    const sym = s.symmetry;
    if (sym.enabled) {
      const big = Math.max(s.doc.w, s.doc.h) * 3;
      ctx.save();
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = "rgba(250,81,44,0.75)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      if (sym.mode === "vertical" || sym.mode === "both") line(sym.cx, sym.cy - big, sym.cx, sym.cy + big);
      if (sym.mode === "horizontal" || sym.mode === "both") line(sym.cx - big, sym.cy, sym.cx + big, sym.cy);
      if (sym.mode === "radial") {
        const n = Math.max(2, Math.round(sym.count));
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 - Math.PI / 2;
          line(sym.cx, sym.cy, sym.cx + Math.cos(a) * big, sym.cy + Math.sin(a) * big);
        }
      }
      ctx.stroke();
      ctx.restore();
      handle(sym.cx, sym.cy, "#fa512c");
    }
    const per = s.perspective;
    if (per.enabled && per.points.length) {
      ctx.save();
      ctx.lineWidth = 1;
      const cols = ["rgba(70,160,255,0.35)", "rgba(80,210,140,0.35)", "rgba(220,120,255,0.35)"];
      per.points.forEach((p, i) => {
        ctx.strokeStyle = cols[i % 3];
        ctx.beginPath();
        const R = Math.max(s.doc.w, s.doc.h) * 4;
        for (let k = 0; k < 36; k++) {
          const a = (k / 36) * Math.PI * 2;
          line(p.x, p.y, p.x + Math.cos(a) * R, p.y + Math.sin(a) * R);
        }
        ctx.stroke();
      });
      if (per.points.length >= 2) {
        ctx.strokeStyle = "rgba(255,255,255,0.6)";
        ctx.setLineDash([10, 6]);
        ctx.beginPath();
        const [a, b] = per.points;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        line(a.x - dx * 4, a.y - dy * 4, b.x + dx * 4, b.y + dy * 4);
        ctx.stroke();
      }
      ctx.restore();
      per.points.forEach((p, i) => handle(p.x, p.y, ["#46a0ff", "#50d28c", "#dc78ff"][i % 3]));
    }
  });
}

registerDialog("rulers", RulerPanel);
registerAction("symmetry", { label: "定規（対称・パース・グリッド）…", run: (s) => s.openDialog("rulers"), checked: (s) => s.symmetry.enabled || s.perspective.enabled });
registerAction("perspective", {
  label: "パース定規を使う",
  run: (s) => {
    s.perspective.enabled = !s.perspective.enabled;
    if (s.perspective.enabled && !s.perspective.points.length) s.openDialog("rulers");
    s.emit("ui");
    s.requestFrame();
  },
  checked: (s) => s.perspective.enabled,
});
registerAction("grid", {
  label: "グリッドを表示",
  key: "Ctrl+'",
  bind: ["ctrl+'"],
  run: (s) => {
    grid.enabled = !grid.enabled;
    s.emit("ui");
    s.requestFrame();
  },
  checked: () => grid.enabled,
});
