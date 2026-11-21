// ブラウザを操作できる AI のための操作口（window.fude）と、iframe から使う postMessage の口。
// 戻り値は小さな JSON にする（大きな文字列を返すと操作側が固まることがある）。画像は snapshot だけ。
import { PRESET_HINTS, PRESETS } from "../engine/brush/presets";
import { compositeBlob } from "../io/files";
import type { Studio } from "../engine/studio";
import { aiOverlay, runScript, type RunResult } from "./runner";
import { parseScript, type Parsed } from "./script";
import { apiHelp, buildPrompt } from "./spec";
import { SAMPLES } from "./samples";

export interface FudeApi {
  version: string;
  help(): string;
  prompt(request?: string): string;
  state(): unknown;
  validate(script: unknown): { ok: boolean; ops: number; issues: Parsed["issues"] };
  run(script: unknown, opts?: { animate?: boolean; speed?: number; newCanvas?: boolean; useCurrentLayer?: boolean }): Promise<RunResult & { issues: Parsed["issues"] }>;
  stroke(points: [number, number, number?][], opts?: Record<string, unknown>): Promise<RunResult>;
  fill(d: string, color: string, opts?: Record<string, unknown>): Promise<RunResult>;
  layer(name: string, opts?: Record<string, unknown>): Promise<RunResult>;
  snapshot(opts?: { max?: number; type?: string; quality?: number }): string;
  look(): string;
  undo(): void;
  redo(): void;
  newCanvas(w: number, h: number, paper?: string | null): void;
  brushes(): { id: string; name: string; tool: string; size: number; hint: string }[];
  pick(x: number, y: number): string | null;
  stop(): void;
  flush(): void;
  exportPNG(): Promise<Blob>;
  /** 見本の台本（AI が描いたもの）の一覧と再生 */
  samples(): { id: string; title: string; note: string }[];
  playSample(id: string, opts?: { animate?: boolean; speed?: number }): Promise<RunResult & { issues: Parsed["issues"] }>;
  studio: Studio;
}

let current: { stopped: boolean } | null = null;

export function installApi(s: Studio): void {
  const ov = aiOverlay(s);
  // AI の筆先と字幕
  s.addOverlay((ctx) => {
    const c = ov.cursor;
    if (c) {
      const [x, y] = s.view.toScreen(c.x, c.y);
      const r = Math.max(5, Math.min(60, (c.size / 2) * s.view.zoom));
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(250,81,44,0.9)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // 筆の形の印
      ctx.save();
      ctx.translate(x + r * 0.7, y - r * 0.7);
      ctx.rotate(-Math.PI / 4);
      ctx.fillStyle = "#fa512c";
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(5, 12);
      ctx.lineTo(5, 34);
      ctx.lineTo(-5, 34);
      ctx.lineTo(-5, 12);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = c.color;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(3, 7);
      ctx.lineTo(-3, 7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    const cap = ov.caption;
    if (cap && s.ui.aiPlaying) {
      ctx.font = `600 15px "Hiragino Sans", "Yu Gothic UI", sans-serif`;
      const w = Math.min(s.view.sw - 40, ctx.measureText(cap).width + 36);
      const x = (s.view.sw - w) / 2;
      const y = s.view.sh - 74;
      ctx.fillStyle = "rgba(18,18,22,0.82)";
      ctx.beginPath();
      ctx.roundRect(x, y, w, 40, 20);
      ctx.fill();
      ctx.fillStyle = "#fa512c";
      ctx.beginPath();
      ctx.arc(x + 18, y + 20, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f3f3f0";
      ctx.textBaseline = "middle";
      ctx.fillText(cap, x + 30, y + 21, w - 40);
    }
  });

  const run = async (script: unknown, opts?: { animate?: boolean; speed?: number; newCanvas?: boolean; useCurrentLayer?: boolean }) => {
    const p = parseScript(script);
    const fatal = p.issues.filter((i) => i.level === "error" && i.index < 0);
    if (fatal.length || !p.ops.length) return { ok: false, done: 0, total: 0, errors: fatal.map((i) => i.message), ms: 0, stopped: false, issues: p.issues };
    if (current) current.stopped = true;
    const stop = { stopped: false };
    current = stop;
    const r = await runScript(s, p, { animate: opts?.animate ?? false, speed: opts?.speed ?? 1, stop, allowCanvas: opts?.newCanvas ?? false, useCurrentLayer: opts?.useCurrentLayer });
    if (current === stop) current = null;
    return { ...r, issues: p.issues };
  };

  const api: FudeApi = {
    version: "1.0",
    help: () => apiHelp(),
    prompt: (request = "") => buildPrompt({ request, width: s.doc.w, height: s.doc.h, layers: s.doc.allLayers().map((l) => l.props.name), continuing: false, paper: s.doc.paper.visible ? s.doc.paper.color : null }),
    state: () => {
      const d = s.doc;
      const b = s.currentBrush();
      return {
        width: d.w,
        height: d.h,
        paper: d.paper.visible ? d.paper.color : null,
        active: d.active?.props.name ?? null,
        layers: d.listForPanel().map(({ layer, depth }) => ({ name: layer.props.name, kind: layer.kind, depth, blend: layer.props.blend, opacity: layer.props.opacity, visible: layer.props.visible, clip: layer.props.clip, empty: !layer.isGroup && !layer.bounds })),
        tool: s.tool,
        brush: { id: b.id, name: b.name, size: b.size, opacity: b.opacity },
        color: s.colors.main,
        selection: d.selBounds,
        undo: s.hist.canUndo,
        playing: s.ui.aiPlaying,
      };
    },
    validate: (script) => {
      const p = parseScript(script);
      return { ok: !p.issues.some((i) => i.level === "error"), ops: p.ops.length, issues: p.issues };
    },
    run,
    stroke: (points, opts = {}) => run({ ops: [{ op: "stroke", points, ...opts }] }, { useCurrentLayer: true }),
    fill: (d, color, opts = {}) => run({ ops: [{ op: "fill", d, color, ...opts }] }, { useCurrentLayer: true }),
    layer: (name, opts = {}) => run({ ops: [{ op: "layer", name, ...opts }] }, { useCurrentLayer: true }),
    snapshot: (opts = {}) => {
      const img = s.previewImage(opts.max ?? 1024);
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, c.width, c.height);
      const t = document.createElement("canvas");
      t.width = img.width;
      t.height = img.height;
      t.getContext("2d")!.putImageData(img, 0, 0);
      ctx.drawImage(t, 0, 0);
      return c.toDataURL(opts.type ?? "image/jpeg", opts.quality ?? 0.85);
    },
    look: () => {
      s.view.fit();
      s.flush();
      return `${s.doc.w}×${s.doc.h} を全体表示にしました`;
    },
    undo: () => s.undo(),
    redo: () => s.redo(),
    newCanvas: (w, h, paper = "#ffffff") => s.newDocument(w, h, { paper }),
    brushes: () => PRESETS.map((p) => ({ id: p.id, name: p.name, tool: p.tool, size: p.size, hint: PRESET_HINTS[p.id] ?? "" })),
    pick: (x, y) => s.pick(x, y),
    stop: () => {
      if (current) current.stopped = true;
    },
    flush: () => s.flush(),
    exportPNG: () => compositeBlob(s, "image/png"),
    samples: () => SAMPLES.map(({ id, title, note }) => ({ id, title, note })),
    playSample: (id, opts) => {
      const smp = SAMPLES.find((x) => x.id === id);
      if (!smp) return Promise.resolve({ ok: false, done: 0, total: 0, errors: [`見本「${id}」はありません`], ms: 0, stopped: false, issues: [] });
      return run(smp.script, { animate: opts?.animate ?? true, speed: opts?.speed ?? 1.5, newCanvas: true });
    },
    studio: s,
  };
  (window as unknown as { fude: FudeApi }).fude = api;

  // iframe などから: postMessage({ type: "fude:run", id, script, opts })
  window.addEventListener("message", async (e: MessageEvent) => {
    const m = e.data as { type?: string; id?: unknown; script?: unknown; opts?: Record<string, unknown> } | null;
    if (!m || typeof m !== "object" || typeof m.type !== "string" || !m.type.startsWith("fude:")) return;
    const reply = (data: unknown) => (e.source as Window | null)?.postMessage({ type: "fude:result", id: m.id, data }, { targetOrigin: e.origin || "*" });
    if (m.type === "fude:run") reply(await run(m.script, m.opts as never));
    else if (m.type === "fude:state") reply(api.state());
    else if (m.type === "fude:snapshot") reply(api.snapshot(m.opts as never));
    else if (m.type === "fude:undo") {
      api.undo();
      reply(true);
    }
  });
}

/** 画面の AI パネルから使う: 実行中の台本を止める。 */
export function stopCurrent(): void {
  if (current) current.stopped = true;
}

export function startRun(s: Studio, p: Parsed, animate: boolean, speed: number, newCanvas: boolean, onProgress?: (i: number, n: number) => void): Promise<RunResult> {
  if (current) current.stopped = true;
  const stop = { stopped: false };
  current = stop;
  return runScript(s, p, { animate, speed, stop, allowCanvas: newCanvas, onProgress }).finally(() => {
    if (current === stop) current = null;
  });
}
