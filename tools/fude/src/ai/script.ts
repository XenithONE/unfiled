// AI の台本（FUDE Script）の読み取りと検査。GPU に触らない（Node でも試せる）。
// 台本は JSON。AI が書きがちな揺れ（```json の囲み・コメント・末尾のカンマ・説明文の混在）を許す。
import { parsePath, PathError, smoothPolyline, type Pt } from "./svgpath";

export type PPt3 = [number, number, number?];

export interface Issue {
  index: number;
  op: string;
  level: "error" | "warn";
  message: string;
}

export interface BrushPatch {
  [k: string]: number | string | boolean | undefined;
}

export type Op =
  | { k: "layer"; name: string; blend?: string; opacity?: number; clip?: boolean; alphaLock?: boolean; group?: string; hidden?: boolean; isRef?: boolean }
  | { k: "group"; name: string; blend?: string; opacity?: number }
  | { k: "selectLayer"; name: string }
  | { k: "layerProps"; name?: string; rename?: string; blend?: string; opacity?: number; visible?: boolean; clip?: boolean; alphaLock?: boolean; isRef?: boolean }
  | { k: "brush"; preset?: string; patch: BrushPatch; color?: string }
  | { k: "color"; color: string }
  | { k: "stroke"; paths: PPt3[][]; preset?: string; patch: BrushPatch; color?: string; erase: boolean; pressure?: number[]; taper?: [number, number] | false; wobble: number; closed: boolean[] }
  | { k: "fill"; polys: Pt[][]; color?: string; opacity: number; feather: number; rule: "nonzero" | "evenodd"; blend: string; erase: boolean; grain?: string }
  | { k: "bucket"; x: number; y: number; color?: string; refer: "layer" | "all" | "ref"; tolerance: number; gap: number; expand: number; opacity: number }
  | { k: "gradient"; kind: "linear" | "radial"; from: Pt; to: Pt; stops: { color: string; alpha: number; pos: number }[]; opacity: number; blend: string }
  | { k: "select"; mode: "replace" | "add" | "subtract" | "intersect"; feather: number; polys?: Pt[][]; all?: boolean; none?: boolean; invert?: boolean; layer?: string }
  | { k: "text"; text: string; x: number; y: number; size: number; color?: string; font: string; vertical: boolean; bold: boolean; align: "start" | "center" | "end"; strokeWidth: number; strokeColor: string; lineHeight: number; name?: string }
  | { k: "filter"; type: string; params: Record<string, number | string | boolean | (string | number)[][]> }
  | { k: "symmetry"; mode: "off" | "vertical" | "horizontal" | "both" | "radial"; x?: number; y?: number; count: number; mirror: boolean }
  | { k: "clear" }
  | { k: "paper"; color: string | null }
  | { k: "say"; text: string }
  | { k: "wait"; ms: number }
  | { k: "image"; src: string; x?: number; y?: number; w?: number; h?: number; name: string; opacity: number }
  | { k: "mergeDown" }
  | { k: "duplicate" }
  | { k: "deleteLayer"; name?: string }
  | { k: "flip"; axis: "h" | "v" }
  | { k: "move"; dx: number; dy: number; scale: number; rotate: number };

export interface Parsed {
  title: string;
  size: [number, number] | null;
  canvas: { width: number; height: number; paper?: string | null } | null;
  ops: Op[];
  issues: Issue[];
  /** 元の op の種類（表示用） */
  names: string[];
}

export const MAX_OPS = 20000;
export const MAX_POINTS = 400000;

/** AI の返事から JSON の部分を取り出して、ゆるく読む。 */
export function looseJson(text: string): unknown {
  let t = text.trim();
  const fence = /```(?:json|javascript|js)?\s*\n([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  // 前後の説明文を落とす: 最初の { か [ から、対応する最後の } か ] まで
  const first = t.search(/[[{]/);
  if (first > 0) t = t.slice(first);
  const lastObj = t.lastIndexOf("}");
  const lastArr = t.lastIndexOf("]");
  const last = Math.max(lastObj, lastArr);
  if (last >= 0 && last < t.length - 1) t = t.slice(0, last + 1);
  // コメントと末尾のカンマを、文字列の外だけで消す
  let out = "";
  let i = 0;
  let inStr = false;
  let q = "";
  while (i < t.length) {
    const c = t[i];
    if (inStr) {
      out += c;
      if (c === "\\") {
        out += t[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (c === q) inStr = false;
      i++;
      continue;
    }
    if (c === '"') {
      inStr = true;
      q = c;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && t[i + 1] === "/") {
      while (i < t.length && t[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && t[i + 1] === "*") {
      const e = t.indexOf("*/", i + 2);
      i = e < 0 ? t.length : e + 2;
      continue;
    }
    out += c;
    i++;
  }
  out = out.replace(/,(\s*[}\]])/g, "$1");
  try {
    return JSON.parse(out);
  } catch (e) {
    const m = /position (\d+)/.exec(String((e as Error).message));
    if (m) {
      const pos = Number(m[1]);
      const before = out.slice(0, pos);
      const line = before.split("\n").length;
      const col = pos - before.lastIndexOf("\n");
      throw new Error(`JSON として読めません（${line} 行目 ${col} 文字目あたり）: ${out.slice(Math.max(0, pos - 20), pos + 20).replace(/\s+/g, " ")}`);
    }
    // ブラウザの英語のエラー文はそのまま見せない
    throw new Error("JSON として読めません（{ } と [ ] の対応・カンマ・\" の閉じ忘れを確かめてください）");
  }
}

const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
const bool = (v: unknown, d: boolean): boolean => (typeof v === "boolean" ? v : d);
const str = (v: unknown, d: string): string => (typeof v === "string" ? v : d);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

const COLOR_NAMES: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#e53935",
  green: "#43a047",
  blue: "#1e88e5",
  yellow: "#fdd835",
  orange: "#fb8c00",
  purple: "#8e24aa",
  pink: "#ec407a",
  brown: "#795548",
  gray: "#9e9e9e",
  grey: "#9e9e9e",
  cyan: "#00bcd4",
  navy: "#1a237e",
  transparent: "transparent",
};

/** 色の書き方（#rgb #rrggbb rgb() 名前）を #rrggbb に。読めなければ null。 */
export function normColor(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  if (COLOR_NAMES[t]) return COLOR_NAMES[t] === "transparent" ? null : COLOR_NAMES[t];
  let m = /^#?([0-9a-f]{3})$/.exec(t);
  if (m) return "#" + m[1].split("").map((c) => c + c).join("");
  m = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(t);
  if (m) return "#" + m[1];
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(t);
  if (m) return "#" + [m[1], m[2], m[3]].map((x) => clamp(Number(x), 0, 255).toString(16).padStart(2, "0")).join("");
  m = /^hsla?\(\s*([\d.]+)[\s,]+([\d.]+)%[\s,]+([\d.]+)%/.exec(t);
  if (m) {
    const h = Number(m[1]) / 360;
    const s = Number(m[2]) / 100;
    const l = Number(m[3]) / 100;
    const f = (n: number) => {
      const k = (n + h * 12) % 12;
      const a = s * Math.min(l, 1 - l);
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return "#" + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
  }
  return null;
}

function pointsOf(v: unknown): PPt3[] | null {
  if (!Array.isArray(v)) return null;
  const out: PPt3[] = [];
  for (const p of v) {
    if (Array.isArray(p) && p.length >= 2 && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1]))) {
      out.push(p.length >= 3 && Number.isFinite(Number(p[2])) ? [Number(p[0]), Number(p[1]), clamp(Number(p[2]), 0, 1)] : [Number(p[0]), Number(p[1])]);
    } else if (p && typeof p === "object" && "x" in p && "y" in p) {
      const o = p as { x: unknown; y: unknown; p?: unknown; pressure?: unknown };
      const pr = o.p ?? o.pressure;
      out.push(pr !== undefined ? [num(o.x, 0), num(o.y, 0), clamp(num(pr, 1), 0, 1)] : [num(o.x, 0), num(o.y, 0)]);
    } else return null;
  }
  return out;
}

function ellipsePts(cx: number, cy: number, rx: number, ry: number, rot = 0): Pt[] {
  const n = Math.max(24, Math.min(360, Math.ceil(Math.sqrt(Math.max(Math.abs(rx), Math.abs(ry))) * 8)));
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    const x = Math.cos(t) * rx;
    const y = Math.sin(t) * ry;
    out.push([cx + c * x - s * y, cy + s * x + c * y]);
  }
  return out;
}

function rectPts(x: number, y: number, w: number, h: number, r: number): Pt[] {
  if (r <= 0)
    return [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
      [x, y],
    ];
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  const out: Pt[] = [];
  const corner = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= 6; i++) {
      const a = a0 + (i / 6) * (Math.PI / 2);
      out.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
  };
  corner(x + w - rr, y + rr, -Math.PI / 2);
  corner(x + w - rr, y + h - rr, 0);
  corner(x + rr, y + h - rr, Math.PI / 2);
  corner(x + rr, y + rr, Math.PI);
  out.push(out[0]);
  return out;
}

/** op の形（d / points / rect / ellipse / circle / polygon / line）から道筋を作る。 */
function geometry(o: Record<string, unknown>, issues: (m: string, lvl?: "error" | "warn") => void): { paths: PPt3[][]; closed: boolean[] } | null {
  const paths: PPt3[][] = [];
  const closed: boolean[] = [];
  const add = (p: PPt3[], c: boolean) => {
    if (p.length) {
      paths.push(p);
      closed.push(c);
    }
  };
  const ds: unknown[] = Array.isArray(o.d) ? (o.d as unknown[]) : o.d !== undefined ? [o.d] : Array.isArray(o.paths) ? (o.paths as unknown[]) : [];
  for (const d of ds) {
    if (typeof d !== "string") {
      issues("d は SVG のパス文字列で書いてください（例: \"M 10 10 C 40 0 60 0 90 10\"）");
      continue;
    }
    try {
      for (const sp of parsePath(d)) add(sp.closed && sp.pts.length > 2 ? [...sp.pts, sp.pts[0]] : sp.pts, sp.closed);
    } catch (e) {
      issues(e instanceof PathError ? e.message : "パスが読めません");
    }
  }
  if (o.points !== undefined) {
    const raw = o.points;
    const lists: unknown[] = Array.isArray(raw) && Array.isArray(raw[0]) && Array.isArray((raw[0] as unknown[])[0]) ? (raw as unknown[]) : [raw];
    for (const l of lists) {
      const p = pointsOf(l);
      if (!p) {
        issues("points は [[x, y], [x, y, 筆圧], ...] の形で書いてください");
        continue;
      }
      const sm = o.smooth === true || o.curve === true;
      add(sm ? (smoothPolyline(p.map(([x, y]) => [x, y])) as PPt3[]) : p, !!o.close);
    }
  }
  if (Array.isArray(o.line) && o.line.length >= 4) {
    const L = o.line.map((v) => num(v, 0));
    add(
      [
        [L[0], L[1]],
        [L[2], L[3]],
      ],
      false,
    );
  }
  if (Array.isArray(o.rect) && o.rect.length >= 4) {
    const R = o.rect.map((v) => num(v, 0));
    add(rectPts(R[0], R[1], R[2], R[3], num(o.radius ?? o.r ?? R[4], 0)), true);
  } else if (o.x !== undefined && o.y !== undefined && o.w !== undefined && o.h !== undefined && (o.op === "rect" || o.shape === "rect")) {
    add(rectPts(num(o.x, 0), num(o.y, 0), num(o.w, 0), num(o.h, 0), num(o.radius ?? o.r, 0)), true);
  }
  if (Array.isArray(o.ellipse) && o.ellipse.length >= 4) {
    const E = o.ellipse.map((v) => num(v, 0));
    add(ellipsePts(E[0], E[1], E[2], E[3], ((E[4] ?? 0) * Math.PI) / 180), true);
  } else if ((o.op === "ellipse" || o.op === "circle") && o.cx !== undefined) {
    const rx = num(o.rx ?? o.r, 10);
    const ry = num(o.ry ?? o.r, rx);
    add(ellipsePts(num(o.cx, 0), num(o.cy, 0), rx, ry, (num(o.rotate, 0) * Math.PI) / 180), true);
  }
  if (Array.isArray(o.circle) && o.circle.length >= 3) {
    const C = o.circle.map((v) => num(v, 0));
    add(ellipsePts(C[0], C[1], C[2], C[2]), true);
  }
  if (o.polygon !== undefined) {
    const p = pointsOf(o.polygon);
    if (p && p.length >= 2) add([...p, p[0]], true);
    else issues("polygon は [[x, y], ...] の形で書いてください");
  }
  return paths.length ? { paths, closed } : null;
}

const BRUSH_KEYS = ["size", "opacity", "flow", "hardness", "spacing", "roundness", "angle", "grainStrength", "grainScale", "mixAmount", "pickup", "strength", "wetEdge", "sizeMin", "opacityMin", "stabilize", "velocityThin", "particle", "count", "sizeJitter", "opacityJitter", "hueJitter", "satJitter", "valJitter", "angleJitter", "paintLoad"];
const BRUSH_STR_KEYS = ["tip", "grain", "angleMode", "accumulate", "blend", "engine"];
const BRUSH_BOOL_KEYS = ["sizePressure", "opacityPressure", "flowPressure"];

function brushPatch(o: Record<string, unknown>): BrushPatch {
  const p: BrushPatch = {};
  for (const k of BRUSH_KEYS) if (o[k] !== undefined && Number.isFinite(Number(o[k]))) p[k] = Number(o[k]);
  for (const k of BRUSH_STR_KEYS) if (typeof o[k] === "string") p[k] = o[k] as string;
  for (const k of BRUSH_BOOL_KEYS) if (typeof o[k] === "boolean") p[k] = o[k] as boolean;
  if (o.width !== undefined && p.size === undefined && Number.isFinite(Number(o.width))) p.size = Number(o.width);
  if (o.alpha !== undefined && p.opacity === undefined && Number.isFinite(Number(o.alpha))) p.opacity = Number(o.alpha);
  return p;
}

function stopsOf(v: unknown, issues: (m: string) => void): { color: string; alpha: number; pos: number }[] {
  const out: { color: string; alpha: number; pos: number }[] = [];
  if (!Array.isArray(v) || v.length < 2) {
    issues("stops は 2 色以上で書いてください（例: [\"#ffcc88\", \"#3355aa\"] や [[\"#fff\", 0], [\"#000\", 1]]）");
    return out;
  }
  v.forEach((s, i) => {
    const n = v.length;
    let c: unknown;
    let pos = i / (n - 1);
    let alpha = 1;
    if (typeof s === "string") c = s;
    else if (Array.isArray(s)) {
      c = s[0];
      if (s[1] !== undefined) pos = num(s[1], pos);
      if (s[2] !== undefined) alpha = num(s[2], 1);
    } else if (s && typeof s === "object") {
      const o = s as Record<string, unknown>;
      c = o.color;
      pos = num(o.pos ?? o.offset ?? o.at, pos);
      alpha = num(o.alpha ?? o.opacity, 1);
    }
    if (c === "transparent") {
      out.push({ color: out[out.length - 1]?.color ?? "#000000", alpha: 0, pos: clamp(pos, 0, 1) });
      return;
    }
    const col = normColor(c);
    if (!col) issues(`stops の ${i + 1} 番目の色「${String(c)}」が読めません`);
    else out.push({ color: col, alpha: clamp(alpha, 0, 1), pos: clamp(pos, 0, 1) });
  });
  return out;
}

/** 台本を読んで、実行できる形にする。 */
export function parseScript(input: unknown): Parsed {
  const issues: Issue[] = [];
  let obj: unknown = input;
  if (typeof input === "string") {
    try {
      obj = looseJson(input);
    } catch (e) {
      return { title: "", size: null, canvas: null, ops: [], names: [], issues: [{ index: -1, op: "", level: "error", message: (e as Error).message }] };
    }
  }
  let rawOps: unknown[];
  let title = "";
  let size: [number, number] | null = null;
  let canvas: Parsed["canvas"] = null;
  if (Array.isArray(obj)) rawOps = obj;
  else if (obj && typeof obj === "object") {
    const o = obj as Record<string, unknown>;
    rawOps = Array.isArray(o.ops) ? o.ops : Array.isArray(o.commands) ? o.commands : Array.isArray(o.steps) ? o.steps : [];
    title = str(o.title, "");
    if (Array.isArray(o.size) && o.size.length >= 2) {
      const w = num(o.size[0], 0);
      const h = num(o.size[1], 0);
      if (w > 0 && h > 0) size = [w, h];
    }
    if (o.canvas && typeof o.canvas === "object") {
      const c = o.canvas as Record<string, unknown>;
      const w = num(c.width ?? c.w, 0);
      const h = num(c.height ?? c.h, 0);
      if (w >= 16 && h >= 16) canvas = { width: Math.round(w), height: Math.round(h), paper: c.paper === null ? null : normColor(c.paper) ?? undefined };
      if (!size && canvas) size = [canvas.width, canvas.height];
    }
    if (!rawOps.length) issues.push({ index: -1, op: "", level: "error", message: "ops（命令の並び）がありません" });
  } else {
    return { title: "", size: null, canvas: null, ops: [], names: [], issues: [{ index: -1, op: "", level: "error", message: "台本は { \"ops\": [...] } の形の JSON で書いてください" }] };
  }
  if (rawOps.length > MAX_OPS) {
    issues.push({ index: -1, op: "", level: "warn", message: `命令が多すぎるので先頭の ${MAX_OPS} 個だけ使います` });
    rawOps = rawOps.slice(0, MAX_OPS);
  }
  const ops: Op[] = [];
  const names: string[] = [];
  let points = 0;
  rawOps.forEach((r, index) => {
    if (!r || typeof r !== "object" || Array.isArray(r)) {
      issues.push({ index, op: "?", level: "error", message: "命令は { \"op\": \"…\", … } の形で書いてください" });
      return;
    }
    const o = r as Record<string, unknown>;
    const opName = str(o.op ?? o.cmd ?? o.type, "").toLowerCase();
    const err = (message: string, level: "error" | "warn" = "error") => issues.push({ index, op: opName, level, message });
    const push = (op: Op) => {
      ops.push(op);
      names.push(opName);
    };
    switch (opName) {
      case "layer":
      case "new_layer":
        push({ k: "layer", name: str(o.name, `レイヤー ${index + 1}`), blend: typeof o.blend === "string" ? o.blend : undefined, opacity: o.opacity !== undefined ? clamp(num(o.opacity, 1), 0, 1) : undefined, clip: bool(o.clip, false), alphaLock: bool(o.alphaLock ?? o.alpha_lock, false), group: typeof o.group === "string" ? o.group : undefined, hidden: o.visible === false || o.hidden === true, isRef: bool(o.reference, false) });
        break;
      case "group":
      case "folder":
        push({ k: "group", name: str(o.name, "フォルダー"), blend: typeof o.blend === "string" ? o.blend : undefined, opacity: o.opacity !== undefined ? clamp(num(o.opacity, 1), 0, 1) : undefined });
        break;
      case "select_layer":
      case "use_layer":
        if (typeof o.name !== "string") err("name（レイヤー名）がありません");
        else push({ k: "selectLayer", name: o.name });
        break;
      case "layer_props":
      case "set_layer":
        push({ k: "layerProps", name: typeof o.name === "string" ? o.name : undefined, rename: typeof o.rename === "string" ? o.rename : undefined, blend: typeof o.blend === "string" ? o.blend : undefined, opacity: o.opacity !== undefined ? clamp(num(o.opacity, 1), 0, 1) : undefined, visible: typeof o.visible === "boolean" ? o.visible : undefined, clip: typeof o.clip === "boolean" ? o.clip : undefined, alphaLock: typeof (o.alphaLock ?? o.alpha_lock) === "boolean" ? Boolean(o.alphaLock ?? o.alpha_lock) : undefined, isRef: typeof o.reference === "boolean" ? o.reference : undefined });
        break;
      case "brush": {
        const color = o.color !== undefined ? normColor(o.color) : undefined;
        if (o.color !== undefined && !color) err(`色「${String(o.color)}」が読めません`, "warn");
        push({ k: "brush", preset: typeof (o.preset ?? o.name) === "string" ? String(o.preset ?? o.name) : undefined, patch: brushPatch(o), color: color ?? undefined });
        break;
      }
      case "color": {
        const c = normColor(o.color ?? o.value);
        if (!c) err(`色「${String(o.color ?? o.value)}」が読めません`);
        else push({ k: "color", color: c });
        break;
      }
      case "stroke":
      case "strokes":
      case "line":
      case "polyline":
      case "path":
      case "draw": {
        const g = geometry(o, err);
        if (!g) {
          err("線の形がありません（d・points・line・rect・ellipse のどれかを書いてください）");
          break;
        }
        for (const p of g.paths) points += p.length;
        const color = o.color !== undefined ? normColor(o.color) : undefined;
        if (o.color !== undefined && !color && o.color !== "transparent") err(`色「${String(o.color)}」が読めません`, "warn");
        let pressure: number[] | undefined;
        if (Array.isArray(o.pressure)) pressure = o.pressure.map((v) => clamp(num(v, 1), 0, 1));
        else if (o.pressure !== undefined) pressure = [clamp(num(o.pressure, 1), 0, 1)];
        let taper: [number, number] | false | undefined;
        if (o.taper === false) taper = false;
        else if (Array.isArray(o.taper)) taper = [Math.max(0, num(o.taper[0], 0)), Math.max(0, num(o.taper[1] ?? o.taper[0], 0))];
        else if (typeof o.taper === "number") taper = [o.taper, o.taper];
        push({ k: "stroke", paths: g.paths, closed: g.closed, preset: typeof (o.preset ?? o.brush) === "string" ? String(o.preset ?? o.brush) : undefined, patch: brushPatch(o), color: color ?? undefined, erase: o.erase === true || o.color === "transparent", pressure, taper, wobble: clamp(num(o.wobble, 0), 0, 20) });
        break;
      }
      case "fill":
      case "shape":
      case "rect":
      case "ellipse":
      case "circle":
      case "polygon": {
        const g = geometry(o, err);
        if (!g) {
          err("塗る形がありません（d・rect・ellipse・circle・polygon のどれかを書いてください）");
          break;
        }
        for (const p of g.paths) points += p.length;
        const fillColor = o.fill !== undefined && typeof o.fill === "string" ? normColor(o.fill) : o.color !== undefined ? normColor(o.color) : undefined;
        const polys = g.paths.map((p) => p.map(([x, y]) => [x, y] as Pt));
        const wantFill = opName === "fill" || o.fill !== undefined || (o.stroke === undefined && o.fill === undefined);
        if (wantFill && o.fill !== false) {
          push({ k: "fill", polys, color: fillColor ?? undefined, opacity: clamp(num(o.opacity, 1), 0, 1), feather: Math.max(0, num(o.feather ?? o.soft, 0)), rule: o.rule === "evenodd" ? "evenodd" : "nonzero", blend: str(o.blend, "normal"), erase: o.erase === true, grain: typeof o.texture === "string" ? o.texture : typeof o.grain === "string" ? o.grain : undefined });
        }
        if (o.stroke !== undefined && o.stroke !== false) {
          const sc = typeof o.stroke === "string" ? normColor(o.stroke) : undefined;
          const sw = o.strokeWidth ?? o.stroke_width ?? o.lineWidth;
          const patch = sw !== undefined ? { size: num(sw, 4) } : {};
          push({ k: "stroke", paths: g.paths, closed: g.closed, preset: typeof o.brush === "string" ? o.brush : undefined, patch, color: sc ?? undefined, erase: false, wobble: clamp(num(o.wobble, 0), 0, 20), taper: false });
        }
        break;
      }
      case "bucket":
      case "flood": {
        const at = Array.isArray(o.at) ? o.at : null;
        const x = num(o.x ?? at?.[0], NaN);
        const y = num(o.y ?? at?.[1], NaN);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          err("x と y（塗り始める場所）がありません");
          break;
        }
        const refer = o.refer === "layer" ? "layer" : o.refer === "ref" || o.refer === "reference" ? "ref" : "all";
        push({ k: "bucket", x, y, color: normColor(o.color) ?? undefined, refer, tolerance: clamp(num(o.tolerance, 12), 0, 100), gap: clamp(num(o.gap, 2), 0, 20), expand: clamp(num(o.expand, 1), -10, 10), opacity: clamp(num(o.opacity, 1), 0, 1) });
        break;
      }
      case "gradient": {
        const from = Array.isArray(o.from) ? ([num(o.from[0], 0), num(o.from[1], 0)] as Pt) : null;
        const to = Array.isArray(o.to) ? ([num(o.to[0], 0), num(o.to[1], 0)] as Pt) : null;
        if (!from || !to) {
          err("from と to（[x, y]）がありません");
          break;
        }
        const stops = stopsOf(o.stops ?? o.colors, (m) => err(m));
        if (stops.length < 2) break;
        push({ k: "gradient", kind: o.type === "radial" || o.kind === "radial" ? "radial" : "linear", from, to, stops, opacity: clamp(num(o.opacity, 1), 0, 1), blend: str(o.blend, "normal") });
        break;
      }
      case "select":
      case "selection": {
        const mode = (["replace", "add", "subtract", "intersect"] as const).find((m) => m === o.mode) ?? "replace";
        const feather = Math.max(0, num(o.feather, 0));
        if (o.all === true) push({ k: "select", mode, feather, all: true });
        else if (o.none === true || o.clear === true) push({ k: "select", mode, feather, none: true });
        else if (o.invert === true) push({ k: "select", mode, feather, invert: true });
        else if (typeof o.layer === "string") push({ k: "select", mode, feather, layer: o.layer });
        else {
          const g = geometry(o, err);
          if (!g) {
            err("選ぶ形がありません（d・rect・ellipse・polygon・all・none・invert・layer のどれか）");
            break;
          }
          push({ k: "select", mode, feather, polys: g.paths.map((p) => p.map(([x, y]) => [x, y] as Pt)) });
        }
        break;
      }
      case "select_all":
        push({ k: "select", mode: "replace", feather: 0, all: true });
        break;
      case "deselect":
        push({ k: "select", mode: "replace", feather: 0, none: true });
        break;
      case "invert_selection":
        push({ k: "select", mode: "replace", feather: 0, invert: true });
        break;
      case "text": {
        if (typeof o.text !== "string" || !o.text) {
          err("text（文字）がありません");
          break;
        }
        const at = Array.isArray(o.at) ? o.at : null;
        const font = str(o.font, "sans");
        push({
          k: "text",
          text: o.text,
          x: num(o.x ?? at?.[0], 0),
          y: num(o.y ?? at?.[1], 0),
          size: Math.max(4, num(o.size, 48)),
          color: normColor(o.color) ?? undefined,
          font: font === "serif" || font === "mincho" ? "serif" : font === "hand" || font === "yomogi" ? "Yomogi" : font === "mono" ? "IBM Plex Mono" : "sans-serif",
          vertical: bool(o.vertical, false),
          bold: bool(o.bold, false),
          align: o.align === "center" ? "center" : o.align === "end" || o.align === "right" ? "end" : "start",
          strokeWidth: Math.max(0, num((o.stroke as Record<string, unknown> | undefined)?.width ?? o.strokeWidth, 0)),
          strokeColor: normColor((o.stroke as Record<string, unknown> | undefined)?.color ?? o.strokeColor) ?? "#ffffff",
          lineHeight: clamp(num(o.lineHeight, 1.4), 0.6, 4),
          name: typeof o.name === "string" ? o.name : undefined,
        });
        break;
      }
      case "filter":
      case "adjust": {
        const type = str(o.type ?? o.name, "");
        if (!type) {
          err("type（フィルターの種類）がありません");
          break;
        }
        const params: Record<string, number | string | boolean | (string | number)[][]> = {};
        for (const [k, v] of Object.entries(o)) if (!["op", "type", "name"].includes(k) && (typeof v === "number" || typeof v === "string" || typeof v === "boolean" || Array.isArray(v))) params[k] = v as never;
        push({ k: "filter", type, params });
        break;
      }
      case "symmetry":
      case "mirror": {
        const mode = (["off", "vertical", "horizontal", "both", "radial"] as const).find((m) => m === o.mode) ?? (o.mode === false ? "off" : "vertical");
        push({ k: "symmetry", mode, x: o.x !== undefined ? num(o.x, 0) : undefined, y: o.y !== undefined ? num(o.y, 0) : undefined, count: clamp(Math.round(num(o.count, 6)), 2, 32), mirror: bool(o.mirror, true) });
        break;
      }
      case "clear":
        push({ k: "clear" });
        break;
      case "paper":
      case "background":
        push({ k: "paper", color: o.color === null || o.color === "transparent" || o.visible === false ? null : normColor(o.color) ?? "#ffffff" });
        break;
      case "say":
      case "note":
      case "comment":
        push({ k: "say", text: str(o.text ?? o.message, "") });
        break;
      case "wait":
      case "pause":
        push({ k: "wait", ms: clamp(num(o.ms ?? (o.seconds !== undefined ? num(o.seconds, 0) * 1000 : undefined), 400), 0, 10000) });
        break;
      case "image": {
        if (typeof o.src !== "string" || !/^data:image\//.test(o.src)) {
          err("src は data:image/… の形の画像だけ使えます");
          break;
        }
        push({ k: "image", src: o.src, x: o.x !== undefined ? num(o.x, 0) : undefined, y: o.y !== undefined ? num(o.y, 0) : undefined, w: o.w !== undefined ? num(o.w, 0) : undefined, h: o.h !== undefined ? num(o.h, 0) : undefined, name: str(o.name, "画像"), opacity: clamp(num(o.opacity, 1), 0, 1) });
        break;
      }
      case "merge_down":
        push({ k: "mergeDown" });
        break;
      case "duplicate_layer":
      case "duplicate":
        push({ k: "duplicate" });
        break;
      case "delete_layer":
        push({ k: "deleteLayer", name: typeof o.name === "string" ? o.name : undefined });
        break;
      case "flip":
      case "flip_layer":
        push({ k: "flip", axis: o.axis === "v" || o.axis === "vertical" ? "v" : "h" });
        break;
      case "move":
      case "transform":
        push({ k: "move", dx: num(o.dx, 0), dy: num(o.dy, 0), scale: num(o.scale, 1), rotate: num(o.rotate, 0) });
        break;
      case "":
        err("op（命令の名前）がありません");
        break;
      default:
        err(`知らない命令「${opName}」は飛ばします`, "warn");
    }
  });
  if (points > MAX_POINTS) issues.push({ index: -1, op: "", level: "error", message: `点が多すぎます（${points} 点・上限 ${MAX_POINTS}）。曲線（C や Q）で点を減らしてください` });
  return { title, size, canvas, ops, issues, names };
}

/** 台本の範囲（座標の最小・最大）。範囲外へのはみ出しの注意に使う。 */
export function scriptExtent(p: Parsed): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const see = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const o of p.ops) {
    if (o.k === "stroke") for (const pa of o.paths) for (const q of pa) see(q[0], q[1]);
    if (o.k === "fill") for (const pa of o.polys) for (const q of pa) see(q[0], q[1]);
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}
