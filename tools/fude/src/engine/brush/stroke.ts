// 入力の点列から判子（ダブ）の列を作る。GPU には触らない（Node でも試せる）。
import type { BrushSettings } from "./presets";
import { TIP_IDS } from "./presets";

export interface Sample {
  x: number;
  y: number;
  /** 筆圧 0..1（曲線を通す前） */
  p: number;
  tx: number;
  ty: number;
  /** ms */
  t: number;
}

export interface Dab {
  x: number;
  y: number;
  r: number;
  angle: number;
  round: number;
  alpha: number;
  hard: number;
  tip: number;
  cr: number;
  cg: number;
  cb: number;
  depth: number;
  /** 入り抜きの再計算用 */
  rBase: number;
  dist: number;
  particle: boolean;
}

export interface StrokeOptions {
  brush: BrushSettings;
  /** 0..1 の sRGB */
  color: [number, number, number];
  /** 筆圧の曲線（1 = そのまま、<1 で軽い筆圧でも濃く） */
  pressureGamma: number;
  seed: number;
  /** 入り抜きを有効にするか（台本や図形は終わりが分かっているので常に） */
  taper: boolean;
}

export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function taperCurve(t: number): number {
  const u = Math.min(1, Math.max(0, t));
  return 0.08 + 0.92 * (1 - (1 - u) * (1 - u));
}

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  if (d > 1e-6) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, mx > 0 ? d / mx : 0, mx];
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  h = ((h % 1) + 1) % 1;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0:
      return [v, t, p];
    case 1:
      return [q, v, p];
    case 2:
      return [p, v, t];
    case 3:
      return [p, q, v];
    case 4:
      return [t, p, v];
    default:
      return [v, p, q];
  }
}

export class StrokeBuilder {
  readonly dabs: Dab[] = [];
  private pending: Dab[] = [];
  private o: StrokeOptions;
  private rnd: () => number;
  private prev: Sample | null = null;
  private prev2: Sample | null = null;
  private segStart: Sample | null = null;
  private acc = 0;
  private dist = 0;
  private vel = 0;
  private dir = 0;
  private hasDir = false;
  private ended = false;
  private hsv: [number, number, number];
  readonly tipIndex: number;

  constructor(o: StrokeOptions) {
    this.o = o;
    this.rnd = mulberry(o.seed);
    this.hsv = rgbToHsv(o.color[0], o.color[1], o.color[2]);
    this.tipIndex = Math.max(0, TIP_IDS.indexOf(o.brush.tip));
  }

  get length(): number {
    return this.dist;
  }

  private curve(p: number): number {
    const g = this.o.pressureGamma;
    return Math.pow(Math.min(1, Math.max(0, p)), g);
  }

  private spacingAt(p: number): number {
    const b = this.o.brush;
    const size = this.sizeAt(p);
    const base = b.particle > 0 ? b.size : size;
    return Math.max(0.4, base * b.spacing);
  }

  private sizeAt(p: number): number {
    const b = this.o.brush;
    let s = b.size;
    if (b.sizePressure) s *= b.sizeMin + (1 - b.sizeMin) * this.curve(p);
    if (b.velocityThin > 0) s *= 1 - b.velocityThin * 0.75 * Math.min(1, this.vel / 3);
    return Math.max(0.3, s);
  }

  private taperIn(d: number): number {
    const b = this.o.brush;
    if (!this.o.taper || b.taperIn <= 0) return 1;
    return taperCurve(d / (b.taperIn * b.size));
  }

  begin(s: Sample): void {
    this.prev = s;
    this.segStart = s;
    this.acc = 0;
    this.dist = 0;
    this.emit(s.x, s.y, s.p, s);
  }

  add(s: Sample): void {
    if (this.ended || !this.prev) return;
    const p1 = this.prev;
    const dt = Math.max(1, s.t - p1.t);
    const d = Math.hypot(s.x - p1.x, s.y - p1.y);
    if (d < 0.05) return;
    this.vel = this.vel * 0.7 + (d / dt) * 0.3;
    if (!this.prev2) {
      // 2 点目: 最初の点から中点まで直線
      const m = mid(p1, s);
      this.walkLine(this.segStart!, m);
      this.segStart = m;
    } else {
      const m = mid(p1, s);
      this.walkQuad(this.segStart!, p1, m);
      this.segStart = m;
    }
    this.prev2 = p1;
    this.prev = s;
  }

  /** 終わり。入り抜きの抜きを反映したら true（描き直しが必要）。 */
  end(): boolean {
    if (this.ended) return false;
    this.ended = true;
    if (this.prev && this.segStart && (this.prev.x !== this.segStart.x || this.prev.y !== this.segStart.y)) {
      this.walkLine(this.segStart, this.prev);
    }
    const b = this.o.brush;
    if (!this.o.taper || (b.taperOut <= 0 && b.taperIn <= 0)) return false;
    const total = this.dist;
    let lin = b.taperIn * b.size;
    let lout = b.taperOut * b.size;
    if (lin + lout > total * 0.9 && lin + lout > 0) {
      const k = (total * 0.9) / (lin + lout);
      lin *= k;
      lout *= k;
    }
    for (const dab of this.dabs) {
      if (dab.particle) continue;
      const fi = lin > 0 ? taperCurve(dab.dist / lin) : 1;
      const fo = lout > 0 ? taperCurve((total - dab.dist) / lout) : 1;
      dab.r = dab.rBase * fi * fo;
    }
    return true;
  }

  take(): Dab[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  private walkQuad(a: Sample, c: Sample, e: Sample): void {
    const len = Math.hypot(c.x - a.x, c.y - a.y) + Math.hypot(e.x - c.x, e.y - c.y);
    const n = Math.max(1, Math.ceil(len / 1.5));
    let px = a.x;
    let py = a.y;
    let pp = a.p;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const u = 1 - t;
      const x = u * u * a.x + 2 * u * t * c.x + t * t * e.x;
      const y = u * u * a.y + 2 * u * t * c.y + t * t * e.y;
      const p = u * u * a.p + 2 * u * t * c.p + t * t * e.p;
      this.walkSeg(px, py, pp, x, y, p, c);
      px = x;
      py = y;
      pp = p;
    }
  }

  private walkLine(a: Sample, e: Sample): void {
    this.walkSeg(a.x, a.y, a.p, e.x, e.y, e.p, e);
  }

  private walkSeg(x0: number, y0: number, p0: number, x1: number, y1: number, p1: number, ref: Sample): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    const segDir = Math.atan2(dy, dx);
    if (!this.hasDir) {
      this.dir = segDir;
      this.hasDir = true;
    } else {
      // 向きはなめらかに追う（毛筆の向きが細かく震えないように）
      let dd = segDir - this.dir;
      while (dd > Math.PI) dd -= Math.PI * 2;
      while (dd < -Math.PI) dd += Math.PI * 2;
      this.dir += dd * Math.min(1, len / 6);
    }
    let pos = 0;
    while (true) {
      const p = p0 + (p1 - p0) * (pos / len);
      const need = this.spacingAt(p) - this.acc;
      if (pos + need > len) {
        this.acc += len - pos;
        this.dist += len - pos;
        break;
      }
      pos += need;
      this.dist += need;
      this.acc = 0;
      const t = pos / len;
      this.emit(x0 + dx * t, y0 + dy * t, p0 + (p1 - p0) * t, ref);
    }
  }

  private emit(x: number, y: number, pRaw: number, ref: Sample): void {
    const b = this.o.brush;
    const r = this.rnd;
    const p = this.curve(pRaw);
    const opDyn = b.opacityPressure ? b.opacityMin + (1 - b.opacityMin) * p : 1;
    const flDyn = b.flowPressure ? b.flowMin + (1 - b.flowMin) * p : 1;
    const baseAlpha = b.flow * opDyn * flDyn;
    const depth = b.opacityPressure ? 0.3 + 0.55 * p : 0.62;
    const count = b.particle > 0 ? Math.max(1, Math.round(b.count)) : 1;
    for (let k = 0; k < count; k++) {
      let cx = x;
      let cy = y;
      let rad: number;
      if (b.particle > 0) {
        const a = r() * Math.PI * 2;
        const dd = Math.sqrt(r()) * b.size * 0.5;
        cx += Math.cos(a) * dd;
        cy += Math.sin(a) * dd;
        rad = b.size * b.particle * (1 - b.sizeJitter * r());
      } else {
        rad = (this.sizeAt(pRaw) * (1 - b.sizeJitter * r())) / 2;
      }
      let ang: number;
      if (b.angleMode === "direction") ang = this.dir + Math.PI / 2;
      else if (b.angleMode === "random") ang = r() * Math.PI * 2;
      else if (b.angleMode === "tilt" && (ref.tx !== 0 || ref.ty !== 0)) ang = Math.atan2(ref.ty, ref.tx) + Math.PI / 2;
      else ang = 0;
      ang += (b.angle * Math.PI) / 180;
      if (b.angleJitter > 0) ang += ((r() * 2 - 1) * b.angleJitter * Math.PI) / 180;
      let cr = this.o.color[0];
      let cg = this.o.color[1];
      let cb = this.o.color[2];
      if (b.hueJitter > 0 || b.satJitter > 0 || b.valJitter > 0) {
        const h = this.hsv[0] + (r() * 2 - 1) * b.hueJitter * 0.5;
        const s = Math.min(1, Math.max(0, this.hsv[1] + (r() * 2 - 1) * b.satJitter * 0.5));
        const v = Math.min(1, Math.max(0, this.hsv[2] + (r() * 2 - 1) * b.valJitter * 0.5));
        [cr, cg, cb] = hsvToRgb(h, s, v);
      }
      const alpha = baseAlpha * (1 - b.opacityJitter * r());
      const tin = b.particle > 0 ? 1 : this.taperIn(this.dist);
      const dab: Dab = {
        x: cx,
        y: cy,
        r: rad * tin,
        angle: ang,
        round: b.roundness,
        alpha,
        hard: b.hardness,
        tip: this.tipIndex,
        cr,
        cg,
        cb,
        depth,
        rBase: rad,
        dist: this.dist,
        particle: b.particle > 0,
      };
      this.dabs.push(dab);
      this.pending.push(dab);
    }
  }
}

function mid(a: Sample, b: Sample): Sample {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, p: (a.p + b.p) / 2, tx: b.tx, ty: b.ty, t: b.t };
}

/** 手ブレ補正。時間で決まる指数平滑（入力の頻度が変わっても効き方が同じ）。 */
export class Stabilizer {
  private tau: number;
  private cur: Sample | null = null;
  private last: Sample | null = null;
  constructor(strength: number) {
    const s = Math.max(0, Math.min(100, strength));
    this.tau = s <= 0 ? 0 : Math.pow(s, 1.25) * 1.1;
  }
  push(s: Sample): Sample {
    this.last = s;
    if (!this.cur || this.tau <= 0) {
      this.cur = { ...s };
      return { ...s };
    }
    const dt = Math.max(0.5, s.t - this.cur.t);
    const k = 1 - Math.exp(-dt / this.tau);
    const kp = 1 - Math.exp(-dt / (this.tau * 0.4 + 0.5));
    this.cur = {
      x: this.cur.x + (s.x - this.cur.x) * k,
      y: this.cur.y + (s.y - this.cur.y) * k,
      p: this.cur.p + (s.p - this.cur.p) * kp,
      tx: s.tx,
      ty: s.ty,
      t: s.t,
    };
    return { ...this.cur };
  }
  /** 離したとき、遅れている分を最後の点まで追いつかせる。 */
  flush(): Sample[] {
    if (!this.cur || !this.last || this.tau <= 0) return [];
    const out: Sample[] = [];
    const d = Math.hypot(this.last.x - this.cur.x, this.last.y - this.cur.y);
    const n = Math.min(24, Math.ceil(d / 2));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      out.push({
        x: this.cur.x + (this.last.x - this.cur.x) * t,
        y: this.cur.y + (this.last.y - this.cur.y) * t,
        p: this.cur.p + (this.last.p - this.cur.p) * t,
        tx: this.last.tx,
        ty: this.last.ty,
        t: this.last.t + i,
      });
    }
    return out;
  }
}
