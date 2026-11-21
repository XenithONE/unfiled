// 台本の実行。人の筆と同じ道（beginStroke・塗り・選択・レイヤー操作）だけを使う。
// animate のときは 1 画ずつ人が描く速さで再生する。1 回の実行が取り消し 1 回分。
import { cloneBrush, PRESETS, type BrushSettings } from "../engine/brush/presets";
import type { Layer } from "../engine/doc";
import { addImageLayer, clearArea, flipLayer, mergeDown } from "../engine/layerOps";
import { bucketFill, paintGradient, paintPolys } from "../engine/paintOps";
import { deselect, invertSelection, selectAll, selectLayerAlpha, selectPolys } from "../engine/selection";
import { PathPlayer, strokeNow, type PPt } from "../engine/strokePath";
import type { Studio, SymmetrySettings } from "../engine/studio";
import { defaultText } from "../engine/text";
import { FloatTransform, type Quad } from "../engine/transform";
import type { Op, Parsed } from "./script";
import { mulberry } from "../engine/brush/stroke";

/** 日本語の文ならそのまま、そうでなければ（ブラウザの英語のエラーなど）日本語の一言にする。 */
export function jaMessage(e: unknown): string {
  const m = String((e as Error)?.message ?? e ?? "");
  return /[぀-ヿ一-鿿]/.test(m) ? m : "この命令は実行できませんでした";
}

export interface RunOpts {
  animate: boolean;
  speed: number;
  stop?: { stopped: boolean };
  onProgress?: (i: number, n: number) => void;
  /** 台本の canvas 指定で新しいキャンバスを作ってよいか */
  allowCanvas?: boolean;
  /** 最初にレイヤーを作らず、今のレイヤーに描く */
  useCurrentLayer?: boolean;
  label?: string;
}

export interface RunResult {
  ok: boolean;
  done: number;
  total: number;
  errors: string[];
  ms: number;
  stopped: boolean;
}

const ALIAS: Record<string, string> = {
  pen: "gpen",
  ink: "gpen",
  inkpen: "kabura",
  liner: "mili",
  airbrush: "airsoft",
  air: "airsoft",
  soft: "airsoft",
  eraser: "erhard",
  brush: "watercolor",
  water: "watercolor",
  paint: "oil",
  smudge: "finger",
  blur: "blurb",
  pencil: "pencil",
  crayon: "crayon",
  sparkles: "sparkle",
  star: "stars",
  leaf: "leaves",
  snowflake: "snow",
};

export function resolvePreset(id: string | undefined): BrushSettings | null {
  if (!id) return null;
  const k = id.trim();
  const low = k.toLowerCase();
  const p = PRESETS.find((x) => x.id === k) ?? PRESETS.find((x) => x.id.toLowerCase() === low) ?? PRESETS.find((x) => x.name === k) ?? PRESETS.find((x) => x.id === ALIAS[low]);
  return p ? cloneBrush(p) : null;
}

function nextFrame(): Promise<void> {
  return new Promise((res) => {
    let done = false;
    const fin = () => {
      if (done) return;
      done = true;
      res();
    };
    requestAnimationFrame(fin);
    setTimeout(fin, 34);
  });
}

function sleep(ms: number, stop?: { stopped: boolean }): Promise<void> {
  return new Promise((res) => {
    const t0 = performance.now();
    const tick = () => {
      if (stop?.stopped || performance.now() - t0 >= ms) res();
      else setTimeout(tick, Math.min(50, ms));
    };
    tick();
  });
}

export interface AiOverlay {
  cursor: { x: number; y: number; color: string; size: number } | null;
  caption: string | null;
}

export function aiOverlay(s: Studio): AiOverlay {
  if (!s.ext.ai) s.ext.ai = { cursor: null, caption: null } satisfies AiOverlay;
  return s.ext.ai as AiOverlay;
}

/** 台本を実行する。 */
export async function runScript(s: Studio, p: Parsed, o: RunOpts): Promise<RunResult> {
  const t0 = performance.now();
  const errors: string[] = [];
  const ov = aiOverlay(s);
  if (p.canvas && o.allowCanvas) s.newDocument(p.canvas.width, p.canvas.height, { paper: p.canvas.paper === null ? null : p.canvas.paper ?? "#ffffff", name: p.title || "AI の絵", empty: true });
  const d = () => s.doc;
  const W = d().w;
  const H = d().h;
  const sw = p.size?.[0] ?? W;
  const sh = p.size?.[1] ?? H;
  const k = Math.min(W / sw, H / sh);
  const ox = (W - sw * k) / 2;
  const oy = (H - sh * k) / 2;
  const mx = (x: number) => ox + x * k;
  const my = (y: number) => oy + y * k;
  const rnd = mulberry(1234567);
  let brush = resolvePreset("gpen")!;
  let color = "#26222b";
  const groups = new Map<string, Layer>();
  const savedSym: SymmetrySettings = { ...s.symmetry };
  const pxPerSec = Math.max(500, Math.min(2600, Math.max(W, H) * 0.6)) * Math.max(0.05, o.speed);
  const stop = o.stop ?? { stopped: false };
  s.hist.begin(o.label ?? `AI: ${p.title || "台本"}`);
  s.setUI({ aiPlaying: true });
  let done = 0;
  let opIndex = 0;
  const firstReal = p.ops.find((x) => x.k !== "say" && x.k !== "wait");
  const needLayer = !o.useCurrentLayer && !!firstReal && !["layer", "group", "selectLayer", "paper", "text", "image"].includes(firstReal.k);
  try {
    if (needLayer) s.addLayer({ name: p.title ? `AI: ${p.title}` : "AI の絵" });
    for (let i = 0; i < p.ops.length; i++) {
      if (stop.stopped) break;
      const op = p.ops[i];
      opIndex = i;
      o.onProgress?.(i, p.ops.length);
      try {
        await exec(op);
      } catch (e) {
        errors.push(`${i + 1} 番目（${op.k}）: ${jaMessage(e)}`);
      }
      done = i + 1;
      if (o.animate) {
        s.requestFrame();
        if (op.k !== "say" && op.k !== "wait") await sleep(op.k === "stroke" ? 30 / o.speed : 140 / o.speed, stop);
      }
    }
  } finally {
    s.symmetry = savedSym;
    ov.cursor = null;
    ov.caption = null;
    s.hist.end();
    s.setUI({ aiPlaying: false });
    s.emit("pixels", "layers");
    s.flush();
  }
  return { ok: errors.length === 0, done, total: p.ops.length, errors, ms: Math.round(performance.now() - t0), stopped: stop.stopped };

  function brushFor(preset: string | undefined, patch: Record<string, unknown>): BrushSettings {
    let b: BrushSettings = preset ? resolvePreset(preset) ?? { ...brush } : { ...brush };
    if (preset && !resolvePreset(preset)) errors.push(`筆「${preset}」は無いので、今の筆で描きました`);
    const q: Partial<BrushSettings> = {};
    for (const [key, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      if (key === "size") q.size = Math.max(0.5, Number(v) * k);
      else (q as Record<string, unknown>)[key] = v;
    }
    b = { ...b, ...q };
    return b;
  }

  function findLayer(name: string): Layer | null {
    return d().findByName(name);
  }

  function pressureAt(prof: number[] | undefined, t: number): number {
    if (!prof || !prof.length) return 1;
    if (prof.length === 1) return prof[0];
    const f = t * (prof.length - 1);
    const i = Math.min(prof.length - 2, Math.floor(f));
    return prof[i] + (prof[i + 1] - prof[i]) * (f - i);
  }

  function mapPath(path: [number, number, number?][], prof: number[] | undefined, wobble: number): PPt[] {
    const pts = path.map((q) => [mx(q[0]), my(q[1]), q[2]] as [number, number, number?]);
    let L = 0;
    const acc = [0];
    for (let j = 1; j < pts.length; j++) {
      L += Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]);
      acc.push(L);
    }
    const w = wobble * k;
    const ph1 = rnd() * 6.283;
    const ph2 = rnd() * 6.283;
    return pts.map((q, j) => {
      const t = L > 0 ? acc[j] / L : 0;
      let x = q[0];
      let y = q[1];
      if (w > 0 && pts.length > 1) {
        const a = pts[Math.max(0, j - 1)];
        const b2 = pts[Math.min(pts.length - 1, j + 1)];
        const dx = b2[0] - a[0];
        const dy = b2[1] - a[1];
        const dl = Math.hypot(dx, dy) || 1;
        const n = Math.sin(acc[j] / 47 + ph1) * 0.6 + Math.sin(acc[j] / 19 + ph2) * 0.4;
        x += (-dy / dl) * n * w;
        y += (dx / dl) * n * w;
      }
      return [x, y, q[2] ?? pressureAt(prof, t)];
    });
  }

  async function drawPath(pts: PPt[], b: BrushSettings, col: string, erase: boolean, seed: number): Promise<void> {
    if (!o.animate) {
      strokeNow(s, pts, { brush: b, color: col, keepStep: true, erase, seed });
      return;
    }
    const pl = new PathPlayer(s, pts, { brush: b, color: col, keepStep: true, erase, seed });
    if (!pl.ok) return;
    let last = performance.now();
    while (!pl.done && !stop.stopped) {
      await nextFrame();
      const now = performance.now();
      const dt = Math.min(60, now - last);
      last = now;
      pl.advance((pxPerSec * dt) / 1000);
      ov.cursor = { x: pl.pos[0], y: pl.pos[1], color: col, size: b.size };
      s.requestFrame();
    }
    pl.finish();
    ov.cursor = null;
  }

  async function exec(op: Op): Promise<void> {
    switch (op.k) {
      case "say":
        ov.caption = op.text || null;
        s.requestFrame();
        if (o.animate && op.text) await sleep(Math.min(1800, 500 + op.text.length * 55) / o.speed, stop);
        return;
      case "wait":
        if (o.animate) await sleep(op.ms / o.speed, stop);
        return;
      case "group": {
        const g = s.addGroup(op.name);
        if (op.blend || op.opacity !== undefined) s.setLayerProps(g.id, { ...(op.blend ? { blend: op.blend } : {}), ...(op.opacity !== undefined ? { opacity: op.opacity } : {}) });
        groups.set(op.name, g);
        return;
      }
      case "layer": {
        let parent: Layer | undefined;
        if (op.group) {
          parent = groups.get(op.group) ?? findLayer(op.group) ?? undefined;
          if (!parent || !parent.isGroup) {
            parent = s.addGroup(op.group);
            groups.set(op.group, parent);
          }
        }
        const props: Record<string, unknown> = {};
        if (op.blend) props.blend = op.blend;
        if (op.opacity !== undefined) props.opacity = op.opacity;
        if (op.clip) props.clip = true;
        if (op.alphaLock) props.alphaLock = true;
        if (op.hidden) props.visible = false;
        if (op.isRef) props.isRef = true;
        s.addLayer({ name: op.name, props, parent, index: parent ? parent.children.length : undefined });
        return;
      }
      case "selectLayer": {
        const l = findLayer(op.name);
        if (!l) throw new Error(`レイヤー「${op.name}」がありません`);
        s.setActive(l.id);
        return;
      }
      case "layerProps": {
        const l = op.name ? findLayer(op.name) : d().active;
        if (!l) throw new Error(`レイヤー「${op.name}」がありません`);
        const patch: Record<string, unknown> = {};
        if (op.rename) patch.name = op.rename;
        if (op.blend) patch.blend = op.blend;
        if (op.opacity !== undefined) patch.opacity = op.opacity;
        if (op.visible !== undefined) patch.visible = op.visible;
        if (op.clip !== undefined) patch.clip = op.clip;
        if (op.alphaLock !== undefined) patch.alphaLock = op.alphaLock;
        if (op.isRef !== undefined) patch.isRef = op.isRef;
        s.setLayerProps(l.id, patch);
        return;
      }
      case "brush":
        brush = brushFor(op.preset, op.patch);
        if (op.color) color = op.color;
        return;
      case "color":
        color = op.color;
        return;
      case "stroke": {
        const b = brushFor(op.preset, op.patch);
        if (op.taper === false) {
          b.taperIn = 0;
          b.taperOut = 0;
        } else if (op.taper) {
          b.taperIn = (op.taper[0] * k) / Math.max(1, b.size);
          b.taperOut = (op.taper[1] * k) / Math.max(1, b.size);
        }
        const col = op.color ?? color;
        for (let j = 0; j < op.paths.length; j++) {
          if (stop.stopped) return;
          const path = op.paths[j];
          if (op.closed[j]) {
            b.taperIn = 0;
            b.taperOut = 0;
          }
          await drawPath(mapPath(path, op.pressure, op.wobble), b, col, op.erase, (opIndex * 7919 + j * 104729 + 17) >>> 0);
        }
        return;
      }
      case "fill": {
        const l = s.paintableLayer();
        if (!l) throw new Error("描けるレイヤーがありません");
        const polys = op.polys.map((pl) => pl.map(([x, y]) => [mx(x), my(y)] as [number, number]));
        paintPolys(s, l, polys, op.color ?? color, { opacity: op.opacity, feather: op.feather * k, rule: op.rule, blend: op.blend, erase: op.erase, grain: op.grain, grainStrength: 0.55 });
        return;
      }
      case "bucket": {
        const ok = bucketFill(s, mx(op.x), my(op.y), op.color ?? color, { refer: op.refer, tolerance: op.tolerance, gap: op.gap, expand: op.expand, opacity: op.opacity, contiguous: true, antialias: true });
        if (!ok) throw new Error("その場所は塗れませんでした（キャンバスの外か、囲まれていない）");
        return;
      }
      case "gradient": {
        const l = s.paintableLayer();
        if (!l) throw new Error("描けるレイヤーがありません");
        paintGradient(s, l, [mx(op.from[0]), my(op.from[1])], [mx(op.to[0]), my(op.to[1])], op.stops, op.kind, { opacity: op.opacity, blend: op.blend });
        return;
      }
      case "select": {
        if (op.all) selectAll(s);
        else if (op.none) deselect(s);
        else if (op.invert) invertSelection(s);
        else if (op.layer) {
          const l = findLayer(op.layer);
          if (!l) throw new Error(`レイヤー「${op.layer}」がありません`);
          selectLayerAlpha(s, l, op.mode);
        } else if (op.polys) selectPolys(s, op.polys.map((pl) => pl.map(([x, y]) => [mx(x), my(y)] as [number, number])), op.mode, op.feather * k);
        return;
      }
      case "text": {
        const t = defaultText(s, mx(op.x), my(op.y), op.text);
        Object.assign(t, { size: op.size * k, color: op.color ?? color, font: op.font, vertical: op.vertical, bold: op.bold, align: op.align, strokeWidth: op.strokeWidth * k, strokeColor: op.strokeColor, lineHeight: op.lineHeight });
        s.addTextLayer(t, op.name);
        return;
      }
      case "filter": {
        const f = s.ext.applyFilter as ((type: string, params: Record<string, unknown>) => void) | undefined;
        if (!f) throw new Error("効果が使えません");
        const params = { ...op.params };
        for (const key of ["radius", "width"]) if (typeof params[key] === "number") params[key] = (params[key] as number) * k;
        f(op.type, params);
        return;
      }
      case "symmetry":
        s.symmetry = { enabled: op.mode !== "off", mode: op.mode === "off" ? "vertical" : op.mode, count: op.count, mirror: op.mirror, cx: op.x !== undefined ? mx(op.x) : W / 2, cy: op.y !== undefined ? my(op.y) : H / 2 };
        return;
      case "clear":
        clearArea(s);
        return;
      case "paper":
        s.structOp("用紙の色", () => {
          if (op.color === null) d().paper.visible = false;
          else {
            d().paper.visible = true;
            d().paper.color = op.color;
          }
        });
        return;
      case "image": {
        const blob = await (await fetch(op.src)).blob();
        const bmp = await createImageBitmap(blob);
        const w = op.w !== undefined ? op.w * k : bmp.width * k;
        const h = op.h !== undefined ? op.h * k : bmp.height * k;
        addImageLayer(s, bmp, op.name, { x: op.x !== undefined ? mx(op.x) : (W - w) / 2, y: op.y !== undefined ? my(op.y) : (H - h) / 2, w, h }, op.opacity);
        return;
      }
      case "mergeDown":
        mergeDown(s);
        return;
      case "duplicate":
        s.duplicateLayer(d().activeId);
        return;
      case "deleteLayer": {
        const l = op.name ? findLayer(op.name) : d().active;
        if (l) s.deleteLayer(l.id);
        return;
      }
      case "flip":
        flipLayer(s, op.axis);
        return;
      case "move": {
        const ft = FloatTransform.begin(s);
        if (!ft) return;
        const q = ft.quad;
        const c: [number, number] = [(q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2];
        const a = (op.rotate * Math.PI) / 180;
        const cs = Math.cos(a) * op.scale;
        const sn = Math.sin(a) * op.scale;
        ft.setQuad(q.map(([x, y]) => [c[0] + cs * (x - c[0]) - sn * (y - c[1]) + op.dx * k, c[1] + sn * (x - c[0]) + cs * (y - c[1]) + op.dy * k]) as Quad);
        ft.commit("動かす");
        return;
      }
    }
  }
}
