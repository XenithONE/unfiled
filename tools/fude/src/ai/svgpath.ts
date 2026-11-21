// SVG のパス文字列（d 属性）を点列にする。M L H V C S Q T A Z（小文字は相対）に対応。
// AI は SVG のパスを書くのが得意なので、線も面もこれで受け取る。

export type Pt = [number, number];
export interface Subpath {
  pts: Pt[];
  closed: boolean;
}

export class PathError extends Error {}

const CMD = /[MmLlHhVvCcSsQqTtAaZz]/;

function tokenize(d: string): (string | number)[] {
  const out: (string | number)[] = [];
  let i = 0;
  const n = d.length;
  while (i < n) {
    const c = d[i];
    if (CMD.test(c)) {
      out.push(c);
      i++;
      continue;
    }
    if (c === "," || c === " " || c === "\n" || c === "\t" || c === "\r") {
      i++;
      continue;
    }
    const m = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(d.slice(i, i + 40));
    if (!m) throw new PathError(`パスの ${i + 1} 文字目「${d.slice(i, i + 8)}」が読めません`);
    out.push(parseFloat(m[0]));
    i += m[0].length;
  }
  return out;
}

/** 弧のフラグ（0/1）は区切りなしで続くことがあるので、数字の 1 文字目だけを取る。 */
function splitFlags(tokens: (string | number)[]): (string | number)[] {
  const out: (string | number)[] = [];
  let cmd = "";
  let k = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (typeof t === "string") {
      cmd = t;
      k = 0;
      out.push(t);
      continue;
    }
    if (cmd === "A" || cmd === "a") {
      const pos = k % 7;
      if ((pos === 3 || pos === 4) && t !== 0 && t !== 1) {
        // "11" や "10.5" のように後ろとくっついている
        const s = String(t);
        if (/^[01]\d/.test(s)) {
          out.push(Number(s[0]));
          k++;
          const rest = Number(s.slice(1));
          tokens.splice(i + 1, 0, rest);
          continue;
        }
      }
    }
    out.push(t);
    k++;
  }
  return out;
}

function cubicPts(out: Pt[], p0: Pt, p1: Pt, p2: Pt, p3: Pt, tol: number, depth = 0): void {
  // 平らさで分割を決める
  const ux = 3 * p1[0] - 2 * p0[0] - p3[0];
  const uy = 3 * p1[1] - 2 * p0[1] - p3[1];
  const vx = 3 * p2[0] - p0[0] - 2 * p3[0];
  const vy = 3 * p2[1] - p0[1] - 2 * p3[1];
  const flat = Math.max(ux * ux, vx * vx) + Math.max(uy * uy, vy * vy);
  if (flat <= 16 * tol * tol || depth > 12) {
    out.push(p3);
    return;
  }
  const m01: Pt = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
  const m12: Pt = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
  const m23: Pt = [(p2[0] + p3[0]) / 2, (p2[1] + p3[1]) / 2];
  const a: Pt = [(m01[0] + m12[0]) / 2, (m01[1] + m12[1]) / 2];
  const b: Pt = [(m12[0] + m23[0]) / 2, (m12[1] + m23[1]) / 2];
  const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  cubicPts(out, p0, m01, a, m, tol, depth + 1);
  cubicPts(out, m, b, m23, p3, tol, depth + 1);
}

function arcPts(out: Pt[], p0: Pt, rx: number, ry: number, phiDeg: number, large: number, sweep: number, p1: Pt, tol: number): void {
  if (rx === 0 || ry === 0) {
    out.push(p1);
    return;
  }
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (phiDeg * Math.PI) / 180;
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2;
  const dy = (p0[1] - p1[1]) / 2;
  const x1 = cp * dx + sp * dy;
  const y1 = -sp * dx + cp * dy;
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) {
    rx *= Math.sqrt(lam);
    ry *= Math.sqrt(lam);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let co = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) co = -co;
  const cxp = (co * rx * y1) / ry;
  const cyp = (-co * ry * x1) / rx;
  const cx = cp * cxp - sp * cyp + (p0[0] + p1[0]) / 2;
  const cy = sp * cxp + cp * cyp + (p0[1] + p1[1]) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
  let dt = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
  if (!sweep && dt > 0) dt -= Math.PI * 2;
  else if (sweep && dt < 0) dt += Math.PI * 2;
  const r = Math.max(rx, ry);
  const step = Math.max(0.02, 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / Math.max(r, tol)))));
  const n = Math.max(2, Math.ceil(Math.abs(dt) / step));
  for (let i = 1; i <= n; i++) {
    const t = t1 + (dt * i) / n;
    const ex = rx * Math.cos(t);
    const ey = ry * Math.sin(t);
    out.push([cp * ex - sp * ey + cx, sp * ex + cp * ey + cy]);
  }
}

/** パスを点列へ。tol はおおよその許容誤差（同じ座標系の単位）。 */
export function parsePath(d: string, tol = 0.35): Subpath[] {
  if (typeof d !== "string" || !d.trim()) throw new PathError("パスが空です");
  const tk = splitFlags(tokenize(d));
  const subs: Subpath[] = [];
  let cur: Subpath | null = null;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let lastC: Pt | null = null;
  let lastQ: Pt | null = null;
  let cmd = "";
  let i = 0;
  const num = (): number => {
    const t = tk[i];
    if (typeof t !== "number") throw new PathError(`「${cmd}」の後に数が足りません`);
    i++;
    return t;
  };
  const ensure = () => {
    if (!cur) {
      cur = { pts: [[x, y]], closed: false };
      subs.push(cur);
    }
    return cur;
  };
  while (i < tk.length) {
    const t = tk[i];
    if (typeof t === "string") {
      if (!cmd && t !== "M" && t !== "m") throw new PathError("パスは M（始点）から書いてください");
      cmd = t;
      i++;
      if (cmd === "Z" || cmd === "z") {
        if (cur) {
          cur.closed = true;
          x = sx;
          y = sy;
        }
        cur = null;
        lastC = lastQ = null;
        continue;
      }
    } else if (!cmd) throw new PathError("パスは M（始点）から書いてください");
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    switch (C) {
      case "M": {
        x = ox + num();
        y = oy + num();
        sx = x;
        sy = y;
        cur = { pts: [[x, y]], closed: false };
        subs.push(cur);
        // M の後に続く座標は L として扱う
        cmd = rel ? "l" : "L";
        lastC = lastQ = null;
        break;
      }
      case "L": {
        x = ox + num();
        y = oy + num();
        ensure().pts.push([x, y]);
        lastC = lastQ = null;
        break;
      }
      case "H": {
        x = (rel ? x : 0) + num();
        ensure().pts.push([x, y]);
        lastC = lastQ = null;
        break;
      }
      case "V": {
        y = (rel ? y : 0) + num();
        ensure().pts.push([x, y]);
        lastC = lastQ = null;
        break;
      }
      case "C": {
        const p1: Pt = [ox + num(), oy + num()];
        const p2: Pt = [ox + num(), oy + num()];
        const p3: Pt = [ox + num(), oy + num()];
        cubicPts(ensure().pts, [x, y], p1, p2, p3, tol);
        lastC = p2;
        lastQ = null;
        x = p3[0];
        y = p3[1];
        break;
      }
      case "S": {
        const p1: Pt = lastC ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y];
        const p2: Pt = [ox + num(), oy + num()];
        const p3: Pt = [ox + num(), oy + num()];
        cubicPts(ensure().pts, [x, y], p1, p2, p3, tol);
        lastC = p2;
        lastQ = null;
        x = p3[0];
        y = p3[1];
        break;
      }
      case "Q": {
        const q: Pt = [ox + num(), oy + num()];
        const p3: Pt = [ox + num(), oy + num()];
        const p1: Pt = [x + (2 / 3) * (q[0] - x), y + (2 / 3) * (q[1] - y)];
        const p2: Pt = [p3[0] + (2 / 3) * (q[0] - p3[0]), p3[1] + (2 / 3) * (q[1] - p3[1])];
        cubicPts(ensure().pts, [x, y], p1, p2, p3, tol);
        lastQ = q;
        lastC = null;
        x = p3[0];
        y = p3[1];
        break;
      }
      case "T": {
        const q: Pt = lastQ ? [2 * x - lastQ[0], 2 * y - lastQ[1]] : [x, y];
        const p3: Pt = [ox + num(), oy + num()];
        const p1: Pt = [x + (2 / 3) * (q[0] - x), y + (2 / 3) * (q[1] - y)];
        const p2: Pt = [p3[0] + (2 / 3) * (q[0] - p3[0]), p3[1] + (2 / 3) * (q[1] - p3[1])];
        cubicPts(ensure().pts, [x, y], p1, p2, p3, tol);
        lastQ = q;
        lastC = null;
        x = p3[0];
        y = p3[1];
        break;
      }
      case "A": {
        const rx = num();
        const ry = num();
        const rot = num();
        const large = num() ? 1 : 0;
        const sweep = num() ? 1 : 0;
        const p1: Pt = [ox + num(), oy + num()];
        arcPts(ensure().pts, [x, y], rx, ry, rot, large, sweep, p1, tol);
        x = p1[0];
        y = p1[1];
        lastC = lastQ = null;
        break;
      }
      default:
        throw new PathError(`知らない命令「${cmd}」`);
    }
  }
  const out = subs.filter((s) => s.pts.length >= 1);
  for (const s of out) {
    // 同じ点の連続を詰める
    const p: Pt[] = [];
    for (const q of s.pts) {
      const last = p[p.length - 1];
      if (!last || Math.abs(last[0] - q[0]) > 1e-6 || Math.abs(last[1] - q[1]) > 1e-6) p.push(q);
    }
    s.pts = p;
  }
  return out;
}

export function pathLength(pts: Pt[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

/** 点列を等間隔（step）に打ち直す。 */
export function resample(pts: Pt[], step: number): Pt[] {
  if (pts.length < 2) return pts.slice();
  const out: Pt[] = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    let seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let t0 = 0;
    while (acc + seg >= step) {
      const need = step - acc;
      const t = t0 + (need / seg) * (1 - t0);
      const p: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      out.push(p);
      seg -= need;
      t0 = t;
      acc = 0;
    }
    acc += seg;
  }
  const last = pts[pts.length - 1];
  const lo = out[out.length - 1];
  if (Math.hypot(last[0] - lo[0], last[1] - lo[1]) > step * 0.25) out.push(last);
  return out;
}

/** 曲がり点を通るなめらかな線（Catmull-Rom）。 */
export function smoothPolyline(pts: Pt[], seg = 8): Pt[] {
  if (pts.length < 3) return pts.slice();
  const out: Pt[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(2, Math.min(seg * 4, Math.ceil(len / 3)));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  return out;
}
