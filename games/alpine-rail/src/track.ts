// The line itself: a metre-gauge mountain railway laid out the way real ones
// are, as a chain of straights and constant-radius curves joined by linear
// curvature transitions, with gradients in per-mille joined by vertical
// curves. Everything else (terrain, scenery, limits, the timetable) is derived
// from this one description, so it is pure data + math with no three.js.

import { clamp, smoothstep } from "./noise";

/** One piece of alignment. radius > 0 turns right, < 0 turns left, 0 = straight. */
interface Seg {
  len: number;
  radius: number;
  grade: number; // per mille, + = climbing in the running direction
}

// 12 km from the lakeside terminus to the glacier terminus, climbing
// ~260 m. Grades up to 45 ‰ and radii down to 150 m, like the Albula line.
const SEGS: Seg[] = [
  { len: 380, radius: 0, grade: 0 }, // Lagrina station, lake on the right
  { len: 420, radius: -900, grade: 0 },
  { len: 260, radius: 0, grade: 4 },
  { len: 380, radius: 700, grade: 6 },
  { len: 240, radius: 0, grade: 10 },
  { len: 460, radius: -520, grade: 22 }, // leaving the lake, into the meadows
  { len: 320, radius: 0, grade: 25 },
  { len: 380, radius: 480, grade: 25 },
  { len: 300, radius: -600, grade: 25 },
  { len: 460, radius: 0, grade: 6 }, // Vallorca village station
  { len: 280, radius: 0, grade: 0 },
  { len: 340, radius: 420, grade: 38 },
  { len: 300, radius: -300, grade: 45 },
  { len: 260, radius: 0, grade: 45 },
  { len: 420, radius: -280, grade: 45 }, // spur tunnel
  { len: 240, radius: 320, grade: 42 },
  { len: 300, radius: 0, grade: 40 }, // avalanche gallery
  { len: 280, radius: 260, grade: 30 },
  { len: 380, radius: 150, grade: 10 }, // ravine head: the viaduct on the curve
  { len: 360, radius: -700, grade: 20 }, // straight into the cliff tunnel
  { len: 300, radius: -420, grade: 38 },
  { len: 280, radius: 0, grade: 10 },
  { len: 360, radius: 0, grade: 0 }, // Punt Mulin station
  { len: 300, radius: 380, grade: 40 },
  { len: 380, radius: -260, grade: 45 },
  { len: 300, radius: 0, grade: 45 },
  { len: 360, radius: 300, grade: 42 },
  { len: 380, radius: -340, grade: 40 }, // forest tunnel
  { len: 420, radius: 0, grade: 32 },
  { len: 440, radius: 520, grade: 25 }, // above the tree line
  { len: 400, radius: -800, grade: 12 },
  { len: 380, radius: 0, grade: -8 },
  { len: 420, radius: 650, grade: 6 },
  { len: 520, radius: 0, grade: 0 }, // Alp Glatscher terminus
];

export const GAUGE = 1.0;
export const START_Y = 1252;
export const LAKE_Y = 1248.2;
const DS = 2; // sample spacing in metres
const TRANSITION = 40; // curvature ramp length
const VCURVE = 90; // vertical curve length

export interface Station {
  id: string;
  name: string;
  kana: string;
  stopS: number; // where the front of the train should stop
  platformFrom: number;
  platformTo: number;
  side: 1 | -1; // platform side: 1 = right
  village: boolean;
}

export interface Span {
  from: number;
  to: number;
}

export interface LimitSign {
  s: number;
  kmh: number;
  warning: boolean; // advance warning board vs. the limit itself
}

export class Track {
  readonly n: number;
  readonly length: number;
  readonly x: Float64Array;
  readonly z: Float64Array;
  readonly y: Float64Array;
  readonly heading: Float64Array;
  readonly curvature: Float64Array;
  readonly grade: Float64Array; // rise per metre
  readonly stations: Station[];
  readonly tunnels: Span[];
  readonly bridges: Span[];
  readonly galleries: Span[];
  readonly limit: Float32Array; // km/h, per sample, already train-length aware
  readonly signs: LimitSign[];
  readonly bufferS: number;

  constructor() {
    // Build per-metre curvature and grade targets, then smooth them.
    const total = SEGS.reduce((a, g) => a + g.len, 0);
    this.length = total;
    this.n = Math.floor(total / DS) + 1;
    const n = this.n;
    const kT = new Float64Array(n);
    const gT = new Float64Array(n);
    let s0 = 0;
    for (const g of SEGS) {
      const i0 = Math.round(s0 / DS);
      const i1 = Math.min(n, Math.round((s0 + g.len) / DS) + 1);
      for (let i = i0; i < i1; i++) {
        kT[i] = g.radius === 0 ? 0 : 1 / g.radius;
        gT[i] = g.grade / 1000;
      }
      s0 += g.len;
    }
    const k = boxSmooth(kT, Math.round(TRANSITION / DS));
    const gr = boxSmooth(boxSmooth(gT, Math.round(VCURVE / DS / 2)), Math.round(VCURVE / DS / 2));

    this.x = new Float64Array(n);
    this.z = new Float64Array(n);
    this.y = new Float64Array(n);
    this.heading = new Float64Array(n);
    this.curvature = k;
    this.grade = gr;
    let th = -0.35;
    let px = 0;
    let pz = 0;
    let py = START_Y;
    for (let i = 0; i < n; i++) {
      this.x[i] = px;
      this.z[i] = pz;
      this.y[i] = py;
      this.heading[i] = th;
      const kk = k[i];
      const thMid = th + kk * DS * 0.5;
      px += Math.cos(thMid) * DS;
      pz += Math.sin(thMid) * DS;
      py += gr[i] * DS;
      th += kk * DS;
    }

    this.stations = [
      { id: "lagrina", name: "Lagrina", kana: "ラグリーナ", stopS: 300, platformFrom: 140, platformTo: 310, side: -1, village: true },
      { id: "vallorca", name: "Vallorca", kana: "ヴァロルカ", stopS: 3460, platformFrom: 3300, platformTo: 3470, side: -1, village: true },
      { id: "puntmulin", name: "Punt Mulin", kana: "プント・ムリン", stopS: 7590, platformFrom: 7430, platformTo: 7600, side: -1, village: true },
      { id: "glatscher", name: "Alp Glatscher", kana: "アルプ・グラッチャー", stopS: total - 90, platformFrom: total - 250, platformTo: total - 80, side: -1, village: false },
    ];
    this.bufferS = total - 20;
    this.tunnels = [
      { from: 4830, to: 5150 },
      { from: 6420, to: 6700 },
      { from: 9080, to: 9380 },
    ];
    this.bridges = [{ from: 6150, to: 6330 }];
    this.galleries = [{ from: 5480, to: 5660 }];

    // Line speed from curve radius (metre gauge, with cant): 4.2*sqrt(R),
    // capped at 80 on this mountain line, with station throats at 40.
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const s = i * DS;
      const r = Math.abs(kT[i]) > 1e-6 ? 1 / Math.abs(kT[i]) : 1e9;
      let v = Math.min(80, Math.floor((4.2 * Math.sqrt(r)) / 5) * 5);
      if (gT[i] >= 0.04) v = Math.min(v, 65);
      for (const st of this.stations) if (s > st.platformFrom - 120 && s < st.platformTo + 60) v = Math.min(v, 40);
      if (s > this.bufferS - 400) v = Math.min(v, 30);
      for (const b of this.bridges) if (s > b.from - 10 && s < b.to + 10) v = Math.min(v, 40);
      raw[i] = v;
    }
    // A restriction holds until the whole train is past it (train ~90 m).
    const tail = Math.round(95 / DS);
    this.limit = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let v = raw[i];
      for (let j = Math.max(0, i - tail); j < i; j++) v = Math.min(v, raw[j]);
      this.limit[i] = v;
    }
    // Merge short speed-ups (less than 250 m) into the lower limit around them.
    let i = 0;
    while (i < n) {
      let j = i;
      while (j < n && this.limit[j] === this.limit[i]) j++;
      const prev = i > 0 ? this.limit[i - 1] : 999;
      const next = j < n ? this.limit[j] : 999;
      if ((j - i) * DS < 250 && this.limit[i] > Math.min(prev, next) && i > 0) {
        const v = Math.max(Math.min(prev, next), 0);
        for (let q = i; q < j; q++) this.limit[q] = v === 999 ? this.limit[q] : v;
      }
      i = j;
    }
    this.signs = [];
    for (let q = 1; q < n; q++) {
      const a = this.limit[q - 1];
      const b = this.limit[q];
      if (a === b) continue;
      const s = q * DS;
      this.signs.push({ s, kmh: b, warning: false });
      if (b < a && s > 300) this.signs.push({ s: Math.max(0, s - 300), kmh: b, warning: true });
    }
    this.signs.sort((p, q) => p.s - q.s);
  }

  private idx(s: number): [number, number] {
    const f = clamp(s, 0, this.length) / DS;
    const i = Math.min(this.n - 2, Math.floor(f));
    return [i, f - i];
  }

  pos(s: number, out: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }) {
    const [i, t] = this.idx(s);
    out.x = this.x[i] + (this.x[i + 1] - this.x[i]) * t;
    out.y = this.y[i] + (this.y[i + 1] - this.y[i]) * t;
    out.z = this.z[i] + (this.z[i + 1] - this.z[i]) * t;
    return out;
  }

  yAt(s: number): number {
    const [i, t] = this.idx(s);
    return this.y[i] + (this.y[i + 1] - this.y[i]) * t;
  }

  headingAt(s: number): number {
    const [i, t] = this.idx(s);
    return this.heading[i] + (this.heading[i + 1] - this.heading[i]) * t;
  }

  gradeAt(s: number): number {
    const [i, t] = this.idx(s);
    return this.grade[i] + (this.grade[i + 1] - this.grade[i]) * t;
  }

  curvatureAt(s: number): number {
    const [i] = this.idx(s);
    return this.curvature[i];
  }

  limitAt(s: number): number {
    const [i] = this.idx(s);
    return this.limit[i];
  }

  /** Superelevation (cant) in radians, positive = banked toward the right. */
  cantAt(s: number): number {
    const k = this.curvatureAt(s);
    return clamp(k * 9, -0.065, 0.065);
  }

  inSpan(spans: Span[], s: number, pad = 0): Span | undefined {
    for (const sp of spans) if (s >= sp.from - pad && s <= sp.to + pad) return sp;
    return undefined;
  }

  /** Weight 1 inside a tunnel, used by audio and lighting. */
  tunnelFactor(s: number): number {
    let w = 0;
    for (const t of this.tunnels) w = Math.max(w, smoothstep(t.from - 5, t.from + 25, s) * (1 - smoothstep(t.to - 25, t.to + 5, s)));
    return w;
  }

  nextStation(s: number): Station | undefined {
    return this.stations.find((st) => st.stopS > s + 25);
  }
}

function boxSmooth(src: Float64Array, half: number): Float64Array {
  const n = src.length;
  const out = new Float64Array(n);
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + src[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half + 1);
    out[i] = (pre[b] - pre[a]) / (b - a);
  }
  return out;
}

export const TRACK_DS = DS;
