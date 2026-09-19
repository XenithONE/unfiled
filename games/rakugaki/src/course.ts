import * as THREE from "three";

/**
 * A switchback mountain road carved into an analytic heightfield.
 * Everything (physics and mesh) reads the same `sample()` function.
 */

export const ROAD_HALF_WIDTH = 4.5;
const N_STRAIGHTS = 7;
const STRAIGHT_LEN = 130;
const STRAIGHT_GRADE = 0.085;
const ARC_R = 14;
const ARC_GRADE = 0.12;
const DIAG = 0.15;
export const BANK = 0.3;
const DEG = Math.PI / 180;
const CUT_TAN = Math.tan(65 * DEG);
const CUT_H = 4;
const CUT_SLOPE = Math.tan(22 * DEG);
const FILL_TAN = Math.tan(68 * DEG);
const FILL_H = 10;
const FILL_SLOPE = Math.tan(18 * DEG);
const INFLUENCE = 45;
const BERM_K = 0.35;
export const SNOW_LINE = -24;

/** Surface codes carried by TerrainSample.surface and the mesh colours. */
export const SURF = {
  grass: 0,
  road: 1,
  dirt: 2,
  water: 3,
  berm: 4,
  torn: 5,
  ice: 6,
} as const;
export type Surface = (typeof SURF)[keyof typeof SURF];

interface PieceBase {
  index: number;
  s0: number;
  length: number;
  h0: number;
  grade: number;
}
export interface Straight extends PieceBase {
  kind: "straight";
  ax: number;
  az: number;
  dx: number;
  dz: number;
  /** sign of the cross product on the uphill (mountain) side */
  uphillSign: number;
}
export interface Arc extends PieceBase {
  kind: "arc";
  cx: number;
  cz: number;
  R: number;
  a0: number;
  sweep: number;
  /** berm height on the outside of the bend */
  bermTop: number;
  /** true for the last hairpin: the island is a dirt bowl you can cut through */
  bowlIsland: boolean;
}
export type Piece = Straight | Arc;

export interface TerrainSample {
  h: number;
  /** 1 on the asphalt, 0 elsewhere */
  road: number;
  surface: Surface;
  /** signed lateral offset from the centreline (m), positive toward the uphill side */
  lat: number;
  /** distance along the whole course (m) of the nearest road point */
  s: number;
  /** distance along the nearest piece (m) */
  t: number;
  /** nearest piece index */
  piece: number;
  /** lateral distance to the nearest centreline (m) */
  d: number;
  /** additive road feature height at this point (kickers, dips, pipe walls) */
  bump: number;
}

export type RailKind = "rail" | "pipe" | "coping" | "wire" | "rainbow" | "loop";
export interface Rail {
  id: number;
  a: THREE.Vector3;
  b: THREE.Vector3;
  kind: RailKind;
  /** loop rails: centre of the circle (undefined on the lead-in / lead-out) */
  center?: THREE.Vector3;
  /** rainbow rails: index along the arc for colouring */
  hue?: number;
}
export interface Sticker {
  id: number;
  x: number;
  y: number;
  z: number;
  label: string;
}
export interface Obstacle {
  x: number;
  z: number;
  r: number;
  kind: "rock" | "pine" | "post" | "boulder";
  id: number;
  /** dynamic obstacles are switched on and moved by the environment animation */
  active: boolean;
}
export interface BoostPad {
  x: number;
  z: number;
  y: number;
  yaw: number;
  s: number;
  id: number;
}
export interface SignSpot {
  x: number;
  z: number;
  y: number;
  yaw: number;
  left: boolean;
  kind: "chevron" | "hop" | "gap" | "rockfall" | "shortcut";
}
export interface RoadPoint {
  x: number;
  z: number;
  h: number;
  dx: number;
  dz: number;
}
export interface SpeedGate {
  id: number;
  s: number;
  x: number;
  z: number;
  y: number;
  yaw: number;
  minSpeed: number;
}
export interface Chute {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  hA: number;
  hB: number;
  length: number;
  dx: number;
  dz: number;
}
export interface FlatZone {
  x: number;
  z: number;
  r: number;
  level: number;
  surface: Surface;
  /** true: only lower the terrain (lake); false: blend toward the level (plateau) */
  cap: boolean;
}
export interface Landmark {
  kind: "summit" | "waterfall" | "tunnel" | "village" | "lake" | "torii" | "pipe" | "trap" | "finishKicker" | "ring" | "loop";
  x: number;
  z: number;
  y: number;
  yaw: number;
  s: number;
  data?: number;
}

interface Bump {
  piece: number;
  t0: number;
  t1: number;
  lat0: number;
  lat1: number;
  f: (u: number, v: number) => number;
  /** what this bump is, for awards and colours */
  tag: string;
}

export interface Course {
  sample(x: number, z: number, out: TerrainSample): TerrainSample;
  height(x: number, z: number): number;
  normal(x: number, z: number, out: THREE.Vector3): THREE.Vector3;
  roadPoint(s: number, out: RoadPoint): RoadPoint;
  /** world position at (s, lateral offset toward the uphill side) plus `up` above the terrain */
  railAt(s: number, lat: number, up: number): THREE.Vector3;
  totalLength: number;
  startS: number;
  finishS: number;
  pieces: Piece[];
  rails: Rail[];
  obstacles: Obstacle[];
  boosts: BoostPad[];
  signs: SignSpot[];
  gates: SpeedGate[];
  chutes: Chute[];
  zones: FlatZone[];
  landmarks: Landmark[];
  bumps: { piece: number; t0: number; t1: number; tag: string }[];
  boulder: Obstacle;
  stickers: Sticker[];
  penguins: { x: number; z: number; y: number; rot: number }[];
  pines: { x: number; z: number; y: number; s: number }[];
  rocks: { x: number; z: number; y: number; s: number; rot: number }[];
  sheep: { x: number; z: number; y: number; rot: number }[];
  snowmen: { x: number; z: number; y: number; rot: number }[];
  extent: { x0: number; x1: number; z0: number; z1: number };
}

const TAU = Math.PI * 2;
const wrap = (a: number): number => ((a % TAU) + TAU) % TAU;
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function hash2(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
/** Cheap 2-D value noise in [0, 1]. */
export function noise2(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  let fx = x - ix;
  let fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

interface Near {
  t: number;
  d: number;
  h: number;
  s: number;
  /** +1 uphill side, -1 downhill / island side */
  side: number;
  /** signed lateral (positive uphill) */
  lat: number;
  /** distance from an arc centre (arcs only) */
  dist: number;
  onArc: boolean;
}

function nearestStraight(p: Straight, x: number, z: number, o: Near): void {
  const rx = x - p.ax;
  const rz = z - p.az;
  const t = Math.max(0, Math.min(p.length, rx * p.dx + rz * p.dz));
  const cross = rx * p.dz - rz * p.dx;
  const px = p.ax + p.dx * t;
  const pz = p.az + p.dz * t;
  o.t = t;
  o.d = Math.hypot(x - px, z - pz);
  o.h = p.h0 - p.grade * t;
  o.s = p.s0 + t;
  o.side = cross * p.uphillSign >= 0 ? 1 : -1;
  o.lat = o.d * o.side;
  o.dist = 0;
  o.onArc = false;
}

function nearestArc(p: Arc, x: number, z: number, o: Near): void {
  const vx = x - p.cx;
  const vz = z - p.cz;
  const dist = Math.hypot(vx, vz);
  const phi = Math.atan2(vz, vx);
  const sgn = p.sweep < 0 ? -1 : 1;
  const span = Math.abs(p.sweep);
  let u = wrap((phi - p.a0) * sgn);
  let onArc = true;
  if (u > span) {
    onArc = false;
    u = u - span < TAU - u ? span : 0;
  }
  const t = u * p.R;
  if (onArc) {
    o.d = Math.abs(dist - p.R);
  } else {
    const ang = p.a0 + sgn * u;
    o.d = Math.hypot(x - (p.cx + Math.cos(ang) * p.R), z - (p.cz + Math.sin(ang) * p.R));
  }
  o.t = t;
  o.h = p.h0 - p.grade * t;
  o.s = p.s0 + t;
  o.side = dist >= p.R ? 1 : -1;
  o.lat = dist - p.R;
  o.dist = dist;
  o.onArc = onArc;
}

function cutProfile(e: number): number {
  const wall = Math.min(e, CUT_H / CUT_TAN);
  return wall * CUT_TAN + Math.max(0, e - CUT_H / CUT_TAN) * CUT_SLOPE;
}
function fillProfile(e: number): number {
  const cliff = Math.min(e, FILL_H / FILL_TAN);
  return -(cliff * FILL_TAN + Math.max(0, e - FILL_H / FILL_TAN) * FILL_SLOPE);
}
/** Parabolic berm that steepens into the retaining wall: hit it fast and you ride it, not stop. */
function bermProfile(e: number, top: number): number {
  const eb = Math.sqrt(top / BERM_K);
  if (e <= eb) return BERM_K * e * e;
  const rest = e - eb;
  const wallLeft = Math.max(0, (CUT_H + 0.8 - top) / CUT_TAN);
  const wall = Math.min(rest, wallLeft);
  return top + wall * CUT_TAN + Math.max(0, rest - wallLeft) * CUT_SLOPE;
}

export function buildCourse(): Course {
  const pieces: Piece[] = [];
  const w = ROAD_HALF_WIDTH;
  let x = -STRAIGHT_LEN / 2;
  let z = 0;
  let h = 0;
  let s = 0;
  let dirSign = 1;
  let index = 0;
  for (let i = 0; i < N_STRAIGHTS; i++) {
    const n = Math.hypot(dirSign, DIAG);
    const dx = dirSign / n;
    const dz = -DIAG / n;
    pieces.push({
      kind: "straight",
      index: index++,
      s0: s,
      length: STRAIGHT_LEN,
      h0: h,
      grade: STRAIGHT_GRADE,
      ax: x,
      az: z,
      dx,
      dz,
      uphillSign: dirSign > 0 ? -1 : 1,
    });
    x += dx * STRAIGHT_LEN;
    z += dz * STRAIGHT_LEN;
    h -= STRAIGHT_GRADE * STRAIGHT_LEN;
    s += STRAIGHT_LEN;
    if (i === N_STRAIGHTS - 1) break;

    let px = dz;
    let pz = -dx;
    if (pz > 0) {
      px = -dz;
      pz = dx;
    }
    const cx = x + px * ARC_R;
    const cz = z + pz * ARC_R;
    const a0 = Math.atan2(z - cz, x - cx);
    const nextDx = -dirSign / n;
    const nextDz = -DIAG / n;
    const theta = Math.acos(Math.max(-1, Math.min(1, dx * nextDx + dz * nextDz)));
    let sweep = theta;
    {
      const endA = a0 + sweep;
      const tx = -Math.sin(endA) * Math.sign(sweep);
      const tz = Math.cos(endA) * Math.sign(sweep);
      if (tx * nextDx + tz * nextDz < 0.99) sweep = -theta;
    }
    const len = ARC_R * theta;
    const hairpin = i + 1; // 1..6
    pieces.push({
      kind: "arc",
      index: index++,
      s0: s,
      length: len,
      h0: h,
      grade: ARC_GRADE,
      cx,
      cz,
      R: ARC_R,
      a0,
      sweep,
      bermTop: hairpin === 2 || hairpin === 5 ? 4.3 : 3.15,
      bowlIsland: hairpin === 6,
    });
    const a1 = a0 + sweep;
    x = cx + Math.cos(a1) * ARC_R;
    z = cz + Math.sin(a1) * ARC_R;
    h -= ARC_GRADE * len;
    s += len;
    dirSign = -dirSign;
  }
  const totalLength = s;
  const straight = (i: number): Straight => pieces[i] as Straight;
  const arcOf = (hairpin: number): Arc => pieces[hairpin * 2 - 1] as Arc;

  // ---- extent ----
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const consider = (px: number, pz: number) => {
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minZ = Math.min(minZ, pz);
    maxZ = Math.max(maxZ, pz);
  };
  for (const p of pieces) {
    if (p.kind === "straight") {
      consider(p.ax, p.az);
      consider(p.ax + p.dx * p.length, p.az + p.dz * p.length);
    } else {
      consider(p.cx - p.R, p.cz - p.R);
      consider(p.cx + p.R, p.cz + p.R);
    }
  }
  const extent = { x0: minX - 75, x1: maxX + 75, z0: minZ - 70, z1: maxZ + 60 };

  // ---- road features ----
  const bumps: Bump[] = [];
  const add = (b: Bump) => bumps.push(b);
  const kicker = (piece: number, t0: number, len: number, H: number, tag = "kicker") =>
    add({
      piece,
      t0,
      t1: t0 + len,
      lat0: -w,
      lat1: w,
      tag,
      f: (u) => (u < 0.97 ? (H * u) / 0.97 : H * (1 - (u - 0.97) / 0.03)),
    });
  const log = (piece: number, t0: number) =>
    add({
      piece,
      t0,
      t1: t0 + 2.6,
      lat0: -w,
      lat1: w,
      tag: "log",
      f: (u) => 0.32 * (0.5 - 0.5 * Math.cos(TAU * u)),
    });
  const rollers = (piece: number, t0: number, count: number, spacing: number, amp: number) =>
    add({
      piece,
      t0,
      t1: t0 + count * spacing,
      lat0: -w,
      lat1: w,
      tag: "rollers",
      f: (u) => amp * (0.5 - 0.5 * Math.cos(u * count * TAU)),
    });
  /** Wedge rising toward the cliff edge (downhill side is lat < 0), with a run-up along the road. */
  const cliffKicker = (piece: number, t0: number, len: number, H: number, tag = "cliff") =>
    add({
      piece,
      t0,
      t1: t0 + len,
      lat0: -w,
      lat1: -w + 3.6,
      tag,
      f: (u, v) => H * (1 - v) * Math.min(1, u / 0.35),
    });

  // summit roll-in: the run starts 5 m up and rolls into the first straight
  add({ piece: 0, t0: 0, t1: 14, lat0: -w, lat1: w, tag: "rollin", f: (u) => 5 * (0.5 + 0.5 * Math.cos(Math.PI * u)) });
  kicker(0, 58, 5, 1.1);
  cliffKicker(0, 108, 12, 1.6, "hop");
  // straight 2: the notebook gap — a lip and a torn-out dip
  log(2, 40);
  kicker(2, 84, 6, 2.0, "gaplip");
  add({ piece: 2, t0: 90, t1: 114, lat0: -w, lat1: w, tag: "gap", f: (u) => -6.5 * (0.5 - 0.5 * Math.cos(TAU * u)) });
  cliffKicker(2, 108, 12, 1.8, "hop");
  // straight 3: cliff launch into the dirt chute, rockfall
  cliffKicker(4, 40, 12, 2.2, "chute");
  cliffKicker(4, 108, 12, 2.0, "hop");
  // straight 4: half-pipe corridor and rollers
  add({
    piece: 6,
    t0: 20,
    t1: 70,
    lat0: -w,
    lat1: w,
    tag: "pipe",
    f: (u, v) => {
      const e = Math.max(0, (Math.abs(2 * v - 1) - 0.55) / 0.45);
      return 3.0 * e * e * smooth(0, 0.12, u) * smooth(1, 0.88, u);
    },
  });
  rollers(6, 84, 3, 8, 1.0);
  cliffKicker(6, 108, 12, 2.2, "hop");
  // straight 5: torii rush, cliff launch
  cliffKicker(8, 50, 9, 1.5, "cliff");
  kicker(8, 100, 6, 1.3);
  cliffKicker(8, 108, 12, 2.4, "hop");
  // straight 6: rollers then the pencil tunnel over the pipeline
  rollers(10, 22, 4, 6.5, 0.6);
  cliffKicker(10, 108, 12, 2.6, "hop");
  // final straight: mega kicker, the run ends in the air
  kicker(12, 100, 12, 3.5, "finish");

  const bumpIndex = bumps.map((b) => ({ piece: b.piece, t0: b.t0, t1: b.t1, tag: b.tag }));

  // ---- flat zones (summit plateau, lake, village pads) ----
  const zones: FlatZone[] = [];
  const chutes: Chute[] = [];

  const nearBuf: Near[] = pieces.map(() => ({ t: 0, d: 0, h: 0, s: 0, side: 1, lat: 0, dist: 0, onArc: false }));

  /** Terrain without chutes/zones (used to seed their heights). */
  const baseSample = (px: number, pz: number, out: TerrainSample): TerrainSample => {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      const o = nearBuf[i];
      if (p.kind === "straight") nearestStraight(p, px, pz, o);
      else nearestArc(p, px, pz, o);
      if (o.d < bestD) {
        bestD = o.d;
        best = i;
      }
    }
    const nb = nearBuf[best];
    const piece = pieces[best];
    out.piece = best;
    out.s = nb.s;
    out.t = nb.t;
    out.d = nb.d;
    out.lat = nb.lat;
    out.bump = 0;

    if (nb.d <= w) {
      let hh = nb.h;
      if (piece.kind === "arc") hh += BANK * nb.lat;
      let bump = 0;
      for (const b of bumps) {
        if (b.piece !== best || nb.t < b.t0 || nb.t > b.t1 || nb.lat < b.lat0 || nb.lat > b.lat1) continue;
        bump += b.f((nb.t - b.t0) / (b.t1 - b.t0), (nb.lat - b.lat0) / (b.lat1 - b.lat0));
      }
      out.h = hh + bump;
      out.bump = bump;
      out.road = 1;
      out.surface = bump < -0.5 ? SURF.torn : best === 0 && nb.t > 24 && nb.t < 58 ? SURF.ice : SURF.road;
      return out;
    }

    let sumW = 0;
    let sumH = 0;
    let surface: Surface = SURF.grass;
    for (let i = 0; i < pieces.length; i++) {
      const o = nearBuf[i];
      const p = pieces[i];
      let wgt = Math.max(0, 1 - o.d / INFLUENCE);
      wgt = wgt * wgt * wgt * wgt * wgt * wgt;
      if (i === best) wgt += 1e-4;
      if (wgt <= 0) continue;
      let hh: number;
      if (p.kind === "arc" && o.side < 0) {
        if (p.bowlIsland) {
          hh = o.h - BANK * w - 0.25 - 0.32 * Math.max(0, p.R - w - o.dist);
        } else {
          hh = o.h - BANK * w - 0.25 - 0.08 * Math.max(0, p.R - w - o.dist);
        }
        if (i === best) surface = SURF.dirt;
      } else if (p.kind === "arc") {
        const e = o.d - w;
        hh = o.h + BANK * w + bermProfile(e, p.bermTop);
        if (i === best && e <= Math.sqrt(p.bermTop / BERM_K)) surface = SURF.berm;
      } else if (o.side > 0) {
        hh = o.h + cutProfile(o.d - w);
      } else {
        hh = o.h + fillProfile(o.d - w);
      }
      sumW += wgt;
      sumH += wgt * hh;
    }
    let hh = sumH / sumW;
    const off = Math.min(1, (nb.d - w) / 3);
    if (surface === SURF.grass)
      hh += off * (0.5 * (noise2(px * 0.11, pz * 0.11) - 0.5) + 2.2 * (noise2(px * 0.025, pz * 0.025) - 0.5));
    out.h = hh;
    out.road = 0;
    out.surface = surface;
    return out;
  };

  const sample = (px: number, pz: number, out: TerrainSample): TerrainSample => {
    baseSample(px, pz, out);
    if (out.road > 0.5) return out;
    for (const c of chutes) {
      const rx = px - c.ax;
      const rz = pz - c.az;
      const t = rx * c.dx + rz * c.dz;
      if (t < -4 || t > c.length + 4) continue;
      const l = rx * c.dz - rz * c.dx;
      const al = Math.abs(l);
      if (al > 6) continue;
      const tc = Math.max(0, Math.min(c.length, t));
      const u = tc / c.length;
      let ch = c.hA + (c.hB - c.hA) * u + 0.15 * l * l;
      // small wooden kicker near the bottom
      const kt = c.length - 9;
      if (tc > kt && tc < kt + 6) ch += 1.3 * ((tc - kt) / 6);
      const wgt = 1 - smooth(3, 6, al);
      out.h = out.h + (ch - out.h) * wgt;
      if (al < 3) out.surface = SURF.dirt;
    }
    for (const zn of zones) {
      const dz = Math.hypot(px - zn.x, pz - zn.z);
      if (dz > zn.r) continue;
      if (zn.cap) {
        if (out.h < zn.level) {
          out.h = zn.level;
          out.surface = zn.surface;
        }
      } else {
        const wgt = 1 - smooth(zn.r * 0.7, zn.r, dz);
        out.h = out.h + (zn.level - out.h) * wgt;
        if (wgt > 0.6) out.surface = zn.surface;
      }
    }
    return out;
  };

  const tmp: TerrainSample = { h: 0, road: 0, surface: SURF.grass, lat: 0, s: 0, t: 0, piece: 0, d: 0, bump: 0 };
  const height = (px: number, pz: number): number => sample(px, pz, tmp).h;
  const normal = (px: number, pz: number, out: THREE.Vector3): THREE.Vector3 => {
    const e = 0.08;
    const hx = (height(px + e, pz) - height(px - e, pz)) / (2 * e);
    const hz = (height(px, pz + e) - height(px, pz - e)) / (2 * e);
    return out.set(-hx, 1, -hz).normalize();
  };

  const pieceAt = (sq: number): Piece => {
    for (const q of pieces) if (sq >= q.s0 && sq < q.s0 + q.length) return q;
    return pieces[pieces.length - 1];
  };
  const roadPoint = (sq: number, out: RoadPoint): RoadPoint => {
    const sc = Math.max(0, Math.min(totalLength - 0.01, sq));
    const p = pieceAt(sc);
    const t = sc - p.s0;
    if (p.kind === "straight") {
      out.x = p.ax + p.dx * t;
      out.z = p.az + p.dz * t;
      out.dx = p.dx;
      out.dz = p.dz;
    } else {
      const sgn = p.sweep < 0 ? -1 : 1;
      const ang = p.a0 + (sgn * t) / p.R;
      out.x = p.cx + Math.cos(ang) * p.R;
      out.z = p.cz + Math.sin(ang) * p.R;
      out.dx = -Math.sin(ang) * sgn;
      out.dz = Math.cos(ang) * sgn;
    }
    out.h = p.h0 - p.grade * t;
    return out;
  };
  const rp: RoadPoint = { x: 0, z: 0, h: 0, dx: 0, dz: 0 };
  /** Lateral unit vector (toward the uphill side) at s. */
  const lateralAt = (sq: number): [number, number] => {
    roadPoint(sq, rp);
    const p = pieceAt(Math.max(0, Math.min(totalLength - 0.01, sq)));
    if (p.kind === "straight") return p.uphillSign > 0 ? [p.dz, -p.dx] : [-p.dz, p.dx];
    const ox = rp.x - p.cx;
    const oz = rp.z - p.cz;
    const len = Math.hypot(ox, oz) || 1;
    return [ox / len, oz / len];
  };
  const railAt = (sq: number, lat: number, up: number): THREE.Vector3 => {
    const [lx, lz] = lateralAt(sq);
    roadPoint(sq, rp);
    const px = rp.x + lx * lat;
    const pz = rp.z + lz * lat;
    return new THREE.Vector3(px, height(px, pz) + up, pz);
  };

  // ---- summit plateau behind the start ----
  {
    const p0 = straight(0);
    zones.push({ x: p0.ax - p0.dx * 6, z: p0.az - p0.dz * 6, r: 22, level: p0.h0 + 5.0, surface: SURF.grass, cap: false });
  }

  // ---- dirt chute from the straight-3 cliff down to straight 4 ----
  {
    const p4 = straight(4);
    const p6 = straight(6);
    const [l4x, l4z] = lateralAt(p4.s0 + 52);
    roadPoint(p4.s0 + 52, rp);
    const ax = rp.x - l4x * (w + 7);
    const az = rp.z - l4z * (w + 7);
    const [l6x, l6z] = lateralAt(p6.s0 + 14);
    roadPoint(p6.s0 + 14, rp);
    const bx = rp.x + l6x * (w + 0.5);
    const bz = rp.z + l6z * (w + 0.5);
    const hB = rp.h + 0.3;
    const hA = baseSample(ax, az, tmp).h;
    const len = Math.hypot(bx - ax, bz - az);
    chutes.push({ ax, az, bx, bz, hA, hB, length: len, dx: (bx - ax) / len, dz: (bz - az) / len });
  }

  // ---- lake and village at the bottom ----
  const landmarks: Landmark[] = [];
  {
    const p12 = straight(12);
    const [lx, lz] = lateralAt(p12.s0 + 60);
    roadPoint(p12.s0 + 60, rp);
    const lakeX = rp.x - lx * (w + 30);
    const lakeZ = rp.z - lz * (w + 30);
    zones.push({ x: lakeX, z: lakeZ, r: 26, level: rp.h - 11, surface: SURF.water, cap: true });
    landmarks.push({ kind: "lake", x: lakeX, z: lakeZ, y: rp.h - 11, yaw: Math.atan2(rp.dx, rp.dz), s: p12.s0 + 60 });
    // a hamlet on the island of hairpin 5 and a hut on the summit plateau
    const arc5 = arcOf(5);
    for (let i = 0; i < 3; i++) {
      const ang = arc5.a0 + arc5.sweep * (0.3 + i * 0.2);
      const rr = arc5.R - w - 4.2;
      const vx = arc5.cx + Math.cos(ang) * rr;
      const vz = arc5.cz + Math.sin(ang) * rr;
      landmarks.push({ kind: "village", x: vx, z: vz, y: height(vx, vz), yaw: ang + Math.PI / 2, s: arc5.s0, data: i });
    }
    const p0 = straight(0);
    const hutX = p0.ax - p0.dx * 14 + p0.dz * 9 * p0.uphillSign * -1;
    const hutZ = p0.az - p0.dz * 14 - p0.dx * 9 * p0.uphillSign * -1;
    landmarks.push({ kind: "village", x: hutX, z: hutZ, y: height(hutX, hutZ), yaw: Math.atan2(p0.dx, p0.dz), s: 0, data: 3 });
  }

  // ---- rails ----
  const rails: Rail[] = [];
  let railId = 0;
  const addRail = (a: THREE.Vector3, b: THREE.Vector3, kind: RailKind) => rails.push({ id: railId++, a, b, kind });
  const overlapsCliff = (piece: number, t0: number, t1: number): boolean =>
    bumps.some((b) => b.piece === piece && b.lat0 < -w + 0.1 && b.lat1 < w && t0 < b.t1 + 3 && t1 > b.t0 - 3);
  for (const p of pieces) {
    if (p.kind === "arc") {
      const steps = 14;
      let prev = railAt(p.s0 + 0.2, w - 0.3, 0.62);
      for (let i = 1; i <= steps; i++) {
        const sq = p.s0 + ((p.length - 0.4) * i) / steps + 0.2;
        const cur = railAt(sq, w - 0.3, 0.62);
        addRail(prev, cur, "rail");
        prev = cur;
      }
      if (p.bermTop > 4) {
        // bowl coping along the top of the tall berm
        const lat = w + Math.sqrt(p.bermTop / BERM_K);
        let prevC = railAt(p.s0 + 0.5, lat, 0.15);
        for (let i = 1; i <= steps; i++) {
          const sq = p.s0 + ((p.length - 1) * i) / steps + 0.5;
          const cur = railAt(sq, lat, 0.15);
          addRail(prevC, cur, "coping");
          prevC = cur;
        }
      }
    } else if (p.index !== 6 && p.index !== 12) {
      for (let t = 12; t + 22 < p.length - 30; t += 30) {
        if (overlapsCliff(p.index, t, t + 22)) continue;
        addRail(railAt(p.s0 + t, -(w - 0.3), 0.62), railAt(p.s0 + t + 22, -(w - 0.3), 0.62), "rail");
      }
    }
  }
  {
    // pipeline down the middle of straight 6, through the tunnel
    const p = straight(10);
    const segs = 8;
    let prev = railAt(p.s0 + 18, 0.6, 0.5);
    for (let i = 1; i <= segs; i++) {
      const cur = railAt(p.s0 + 18 + (90 * i) / segs, 0.6, 0.5);
      addRail(prev, cur, "pipe");
      prev = cur;
    }
    landmarks.push({ kind: "pipe", x: 0, z: 0, y: 0, yaw: 0, s: p.s0 + 60 });
  }
  {
    // half-pipe copings on straight 4
    const p = straight(6);
    for (const side of [1, -1]) {
      const segs = 6;
      let prev = railAt(p.s0 + 26, side * (w - 0.1), 0.15);
      for (let i = 1; i <= segs; i++) {
        const cur = railAt(p.s0 + 26 + (38 * i) / segs, side * (w - 0.1), 0.15);
        addRail(prev, cur, "coping");
        prev = cur;
      }
    }
  }
  {
    // zip-line from the top of hairpin 4's berm across the island to straight 5
    const arc = arcOf(4);
    const p8 = straight(8);
    const a = railAt(arc.s0 + arc.length * 0.5, w + Math.sqrt(arc.bermTop / BERM_K) + 0.5, 3.0);
    const b = railAt(p8.s0 + 14, -1, 1.0);
    const segs = 4;
    let prev = a;
    for (let i = 1; i <= segs; i++) {
      const cur = new THREE.Vector3().lerpVectors(a, b, i / segs);
      addRail(prev, cur, "wire");
      prev = cur;
    }
  }

  {
    // rainbow rail: from the end of the summit straight, over hairpin 1, down onto straight 2
    const p0 = straight(0);
    const p2 = straight(2);
    const ramp0 = railAt(p0.s0 + 114, 0, 0.3);
    const A = railAt(p0.s0 + 120, 0, 0.9);
    const B = railAt(p2.s0 + 16, 0, 0.9);
    const B2 = railAt(p2.s0 + 24, 0, 0.3);
    rails.push({ id: railId++, a: ramp0, b: A, kind: "rainbow", hue: 0 });
    const segs = 16;
    let prev = A;
    for (let i = 1; i <= segs; i++) {
      const u = i / segs;
      const cur = new THREE.Vector3().lerpVectors(A, B, u);
      cur.y += 12 * (0.5 - 0.5 * Math.cos(TAU * u));
      rails.push({ id: railId++, a: prev, b: cur, kind: "rainbow", hue: i });
      prev = cur;
    }
    rails.push({ id: railId++, a: prev, b: B2, kind: "rainbow", hue: segs + 1 });
  }
  {
    // loop-the-loop on straight 3: lead-in, a 6 m circle standing on the road, lead-out
    const p4 = straight(4);
    roadPoint(p4.s0 + 78, rp);
    // the loop's plane is skewed 30 degrees off the road so the camera behind can see the circle
    const skew = (30 * Math.PI) / 180;
    const fwd = new THREE.Vector3(
      rp.dx * Math.cos(skew) - rp.dz * Math.sin(skew),
      0,
      rp.dx * Math.sin(skew) + rp.dz * Math.cos(skew),
    );
    const upv = new THREE.Vector3(0, 1, 0);
    const R = 6;
    const centre = railAt(p4.s0 + 78, 0, R + 0.5);
    landmarks.push({ kind: "loop", x: centre.x, z: centre.z, y: centre.y, yaw: Math.atan2(fwd.x, fwd.z), s: p4.s0 + 78, data: R });
    const bottom = centre.clone().addScaledVector(upv, -R);
    const lead0 = railAt(p4.s0 + 66, 0, 0.3);
    const lead1 = railAt(p4.s0 + 72, 0, 0.5);
    rails.push({ id: railId++, a: lead0, b: lead1, kind: "loop" });
    rails.push({ id: railId++, a: lead1, b: bottom.clone(), kind: "loop" });
    const segs = 18;
    let prev = bottom.clone();
    for (let i = 1; i <= segs; i++) {
      const th = (i / segs) * TAU;
      const cur = centre.clone().addScaledVector(fwd, Math.sin(th) * R + (i / segs) * 0.8).addScaledVector(upv, -Math.cos(th) * R);
      rails.push({ id: railId++, a: prev, b: cur, kind: "loop", center: centre.clone().addScaledVector(fwd, (i / segs) * 0.8) });
      prev = cur;
    }
    const out0 = prev.clone();
    const out1 = railAt(p4.s0 + 86, 0, 0.5);
    const out2 = railAt(p4.s0 + 92, 0, 0.3);
    rails.push({ id: railId++, a: out0, b: out1, kind: "loop" });
    rails.push({ id: railId++, a: out1, b: out2, kind: "loop" });
  }

  // ---- boost pads, obstacles, signs, gates ----
  const boosts: BoostPad[] = [];
  let boostId = 0;
  const pad = (sq: number, lat = 0) => {
    roadPoint(sq, rp);
    const p = railAt(sq, lat, 0);
    boosts.push({ x: p.x, z: p.z, y: p.y, yaw: Math.atan2(rp.dx, rp.dz), s: sq, id: boostId++ });
  };
  const obstacles: Obstacle[] = [];
  let obsId = 0;
  const obstacle = (x: number, z: number, r: number, kind: Obstacle["kind"], active = true): Obstacle => {
    const o: Obstacle = { x, z, r, kind, id: obsId++, active };
    obstacles.push(o);
    return o;
  };
  const rock = (sq: number, lat: number) => {
    const p = railAt(sq, lat, 0);
    obstacle(p.x, p.z, 1.1, "rock");
  };
  for (const p of pieces) {
    if (p.kind !== "straight") continue;
    if (p.index === 12) {
      for (const t of [10, 30, 50, 70, 90]) pad(p.s0 + t);
      continue;
    }
    pad(p.s0 + 22);
    if (p.index !== 2 && p.index !== 6) pad(p.s0 + 96, p.index % 4 === 0 ? 1.4 : -1.4);
    if (p.index >= 2 && p.index !== 4 && p.index !== 6 && p.index !== 8) rock(p.s0 + 48 + (p.index % 3) * 8, p.index % 4 === 0 ? -2.3 : 2.3);
    if (p.index === 8) rock(p.s0 + 80, 2.1);
  }
  const signs: SignSpot[] = [];
  for (const p of pieces) {
    if (p.kind !== "arc") continue;
    for (const f of [0.25, 0.5, 0.75]) {
      const sq = p.s0 + p.length * f;
      const sp = railAt(sq, w + Math.sqrt(p.bermTop / BERM_K) + 1.4, 0);
      roadPoint(sq, rp);
      signs.push({ x: sp.x, z: sp.z, y: sp.y, yaw: Math.atan2(rp.dx, rp.dz), left: p.sweep > 0, kind: "chevron" });
    }
  }
  const signAt = (sq: number, lat: number, kind: SignSpot["kind"]) => {
    const sp = railAt(sq, lat, 0);
    roadPoint(sq, rp);
    signs.push({ x: sp.x, z: sp.z, y: sp.y, yaw: Math.atan2(rp.dx, rp.dz), left: false, kind });
  };
  for (const i of [0, 2, 4, 6, 8, 10]) signAt(straight(i).s0 + 95, -(w + 1.2), "hop");
  signAt(straight(2).s0 + 70, w + 1.2, "gap");
  signAt(straight(4).s0 + 30, -(w + 1.2), "shortcut");
  signAt(straight(4).s0 + 85, w + 1.2, "rockfall");

  // torii speed gates on straight 5
  const gates: SpeedGate[] = [];
  {
    const p = straight(8);
    for (let i = 0; i < 8; i++) {
      const sq = p.s0 + 18 + i * 5;
      roadPoint(sq, rp);
      gates.push({ id: i, s: sq, x: rp.x, z: rp.z, y: rp.h, yaw: Math.atan2(rp.dx, rp.dz), minSpeed: 25 });
      for (const side of [1, -1]) {
        const post = railAt(sq, side * (w + 0.6), 0);
        obstacle(post.x, post.z, 0.3, "post");
      }
    }
    landmarks.push({ kind: "torii", x: 0, z: 0, y: 0, yaw: 0, s: p.s0 + 18 });
  }

  // rockfall boulder: parked above straight 3, released when the player passes t 70
  let boulder: Obstacle;
  {
    const p = straight(4);
    const top = railAt(p.s0 + 100, w + 9, 0);
    boulder = obstacle(top.x, top.z, 1.6, "boulder", false);
  }

  // other landmarks for the environment builder
  {
    const p0 = straight(0);
    landmarks.push({ kind: "summit", x: p0.ax, z: p0.az, y: p0.h0 + 5, yaw: Math.atan2(p0.dx, p0.dz), s: 0 });
    const p2 = straight(2);
    const wf = railAt(p2.s0 + 60, -(w + 2), 0);
    roadPoint(p2.s0 + 60, rp);
    landmarks.push({ kind: "waterfall", x: wf.x, z: wf.z, y: wf.y, yaw: Math.atan2(rp.dx, rp.dz), s: p2.s0 + 60 });
    const p10 = straight(10);
    roadPoint(p10.s0 + 76, rp);
    landmarks.push({ kind: "tunnel", x: rp.x, z: rp.z, y: rp.h, yaw: Math.atan2(rp.dx, rp.dz), s: p10.s0 + 76 });
    const p12 = straight(12);
    roadPoint(p12.s0 + 96, rp);
    landmarks.push({ kind: "trap", x: rp.x, z: rp.z, y: rp.h, yaw: Math.atan2(rp.dx, rp.dz), s: p12.s0 + 96 });
    roadPoint(p12.s0 + 112, rp);
    landmarks.push({ kind: "finishKicker", x: rp.x, z: rp.z, y: rp.h + 3.5, yaw: Math.atan2(rp.dx, rp.dz), s: p12.s0 + 112 });
  }

  {
    const p12 = straight(12);
    const ring = railAt(p12.s0 + 112 + 24, 0, 0);
    roadPoint(p12.s0 + 112, rp);
    landmarks.push({ kind: "ring", x: ring.x, z: ring.z, y: rp.h + 3.5 + 3.2, yaw: Math.atan2(rp.dx, rp.dz), s: p12.s0 + 136 });
  }
  const stickers: Sticker[] = [];
  {
    const at = (label: string, v: THREE.Vector3) => stickers.push({ id: stickers.length, x: v.x, y: v.y, z: v.z, label });
    at("山頂の小屋", railAt(straight(0).s0 + 8, 0, 2.4));
    at("裂け目の底", railAt(straight(2).s0 + 102, 0, 1.5));
    const rainbow = rails.filter((r) => r.kind === "rainbow");
    at("虹のてっぺん", rainbow[Math.floor(rainbow.length / 2)].b.clone().add(new THREE.Vector3(0, 1.2, 0)));
    const loopTop = rails.find((r) => r.kind === "loop" && r.center && r.b.y > r.center.y + 5);
    if (loopTop) at("ループの頂点", loopTop.b.clone().add(new THREE.Vector3(0, -0.3, 0)));
    const chute = chutes[0];
    at("シュートの途中", new THREE.Vector3(chute.ax + chute.dx * chute.length * 0.5, 0, chute.az + chute.dz * chute.length * 0.5));
    at("ハーフパイプの壁", railAt(straight(6).s0 + 45, w - 0.4, 3.6));
    const wires = rails.filter((r) => r.kind === "wire");
    at("ジップラインの真ん中", wires[1].b.clone().add(new THREE.Vector3(0, 1.0, 0)));
    at("五番目の鳥居", railAt(straight(8).s0 + 38, 0, 3.0));
    at("鉛筆の中", railAt(straight(10).s0 + 76, 0, 2.2));
    at("島のボウル", new THREE.Vector3(arcOf(6).cx, 0, arcOf(6).cz));
    for (const st of stickers) if (st.y === 0) st.y = height(st.x, st.z) + 1.2;
  }
  const penguins: Course["penguins"] = [];
  {
    const p0 = straight(0);
    for (let i = 0; i < 6; i++) {
      const sp = railAt(p0.s0 + 30 + i * 5, (i % 2 === 0 ? 1 : -1) * (w + 2.2 + (i % 3)), 0);
      penguins.push({ x: sp.x, z: sp.z, y: sp.y, rot: (i * 1.3) % TAU });
    }
  }

  // ---- scattered pines, rocks, sheep, snowmen ----
  const pines: Course["pines"] = [];
  const rocks: Course["rocks"] = [];
  const sheep: Course["sheep"] = [];
  const snowmen: Course["snowmen"] = [];
  const nrm = new THREE.Vector3();
  const ts: TerrainSample = { h: 0, road: 0, surface: SURF.grass, lat: 0, s: 0, t: 0, piece: 0, d: 0, bump: 0 };
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let i = 0; i < 3200 && pines.length < 420; i++) {
    const px = extent.x0 + rnd() * (extent.x1 - extent.x0);
    const pz = extent.z0 + rnd() * (extent.z1 - extent.z0);
    sample(px, pz, ts);
    if (ts.d < w + 2.5 || ts.d > 60 || ts.surface !== SURF.grass) continue;
    normal(px, pz, nrm);
    if (nrm.y < 0.62) continue;
    pines.push({ x: px, z: pz, y: ts.h, s: 0.8 + rnd() * 0.7 });
  }
  for (let i = 0; i < 1400 && rocks.length < 110; i++) {
    const px = extent.x0 + rnd() * (extent.x1 - extent.x0);
    const pz = extent.z0 + rnd() * (extent.z1 - extent.z0);
    sample(px, pz, ts);
    if (ts.d < w + 1.2 || ts.d > 55 || ts.surface === SURF.water) continue;
    rocks.push({ x: px, z: pz, y: ts.h - 0.3, s: 0.6 + rnd() * 1.6, rot: rnd() * TAU });
  }
  for (let i = 0; i < 3000 && sheep.length < 46; i++) {
    const px = extent.x0 + rnd() * (extent.x1 - extent.x0);
    const pz = extent.z0 + rnd() * (extent.z1 - extent.z0);
    sample(px, pz, ts);
    if (ts.d < w + 3 || ts.d > 40 || ts.surface !== SURF.grass || ts.h > SNOW_LINE) continue;
    normal(px, pz, nrm);
    if (nrm.y < 0.9) continue;
    sheep.push({ x: px, z: pz, y: ts.h, rot: rnd() * TAU });
  }
  {
    const p0 = straight(0);
    for (let i = 0; i < 4; i++) {
      const sq = p0.s0 + 24 + i * 22;
      const sp = railAt(sq, (i % 2 === 0 ? 1 : -1) * (w + 3 + i), 0);
      snowmen.push({ x: sp.x, z: sp.z, y: sp.y, rot: rnd() * TAU });
    }
  }
  // pines that hug the road for near misses
  for (const p of pieces) {
    if (p.kind !== "straight" || p.index === 8) continue;
    for (const t of [30, 70, 110]) {
      if (overlapsCliff(p.index, t - 1, t + 1)) continue;
      const lat = ((p.index / 2 + t / 40) | 0) % 2 === 0 ? w + 1.3 : -(w + 1.3);
      const pt = railAt(p.s0 + t, lat, 0);
      pines.push({ x: pt.x, z: pt.z, y: pt.y, s: 1.1 });
      obstacle(pt.x, pt.z, 0.45, "pine");
    }
  }
  // slalom pines down the chute
  for (const c of chutes) {
    for (let t = 14; t < c.length - 14; t += 9) {
      const side = ((t / 9) | 0) % 2 === 0 ? 2 : -2;
      const px = c.ax + c.dx * t + c.dz * side;
      const pz = c.az + c.dz * t - c.dx * side;
      pines.push({ x: px, z: pz, y: height(px, pz), s: 0.9 });
      obstacle(px, pz, 0.5, "pine");
    }
  }

  return {
    sample,
    height,
    normal,
    roadPoint,
    railAt,
    totalLength,
    startS: 2,
    finishS: totalLength - 10,
    pieces,
    rails,
    obstacles,
    boosts,
    signs,
    gates,
    chutes,
    zones,
    landmarks,
    bumps: bumpIndex,
    boulder,
    stickers,
    penguins,
    pines,
    rocks,
    sheep,
    snowmen,
    extent,
  };
}

/** Sample the course into a coloured terrain mesh with road-marking attributes. */
export function buildTerrainGeometry(course: Course, cell: number): THREE.BufferGeometry {
  const { x0, x1, z0, z1 } = course.extent;
  const nx = Math.round((x1 - x0) / cell);
  const nz = Math.round((z1 - z0) / cell);
  const vx = nx + 1;
  const vz = nz + 1;
  const count = vx * vz;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const road = new Float32Array(count);
  const marks = new Float32Array(count * 2);
  const surf = new Uint8Array(count);
  const lat = new Float32Array(count);
  const ts: TerrainSample = { h: 0, road: 0, surface: SURF.grass, lat: 0, s: 0, t: 0, piece: 0, d: 0, bump: 0 };
  const cAsphalt = new THREE.Color(0xa9adbd);
  const cTorn = new THREE.Color(0x8f9bb3);
  const cGrass = new THREE.Color(0x9ad27f);
  const cGrass2 = new THREE.Color(0x7dbd68);
  const cDirt = new THREE.Color(0xd9b98d);
  const cDirt2 = new THREE.Color(0xe8a27a);
  const cRock = new THREE.Color(0xbdb8cb);
  const cCliff = new THREE.Color(0x9a94ad);
  const cSnow = new THREE.Color(0xfbfaf6);
  const cSnow2 = new THREE.Color(0xe4e9f4);
  const cBerm = new THREE.Color(0xf2b8a0);
  const cBerm2 = new THREE.Color(0xf7cdbb);
  const cWater = new THREE.Color(0x8fc4ec);
  const cIce = new THREE.Color(0xcfe6f6);
  const c = new THREE.Color();
  let i = 0;
  for (let j = 0; j < vz; j++) {
    const z = z0 + j * cell;
    for (let k = 0; k < vx; k++, i++) {
      const x = x0 + k * cell;
      course.sample(x, z, ts);
      positions[i * 3] = x;
      positions[i * 3 + 1] = ts.h;
      positions[i * 3 + 2] = z;
      road[i] = ts.road;
      marks[i * 2] = ts.lat;
      marks[i * 2 + 1] = ts.s;
      surf[i] = ts.surface;
      lat[i] = ts.d;
    }
  }
  const index = new Uint32Array(nx * nz * 6);
  let q = 0;
  for (let j = 0; j < nz; j++) {
    for (let k = 0; k < nx; k++) {
      const a = j * vx + k;
      const b = a + 1;
      const cc = a + vx;
      const d = cc + 1;
      index[q++] = a;
      index[q++] = cc;
      index[q++] = b;
      index[q++] = b;
      index[q++] = cc;
      index[q++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();
  const normals = geo.getAttribute("normal") as THREE.BufferAttribute;
  for (let v = 0; v < count; v++) {
    const ny = normals.getY(v);
    const x = positions[v * 3];
    const y = positions[v * 3 + 1];
    const z = positions[v * 3 + 2];
    const sf = surf[v];
    if (sf === SURF.road) c.copy(cAsphalt);
    else if (sf === SURF.torn) c.copy(cTorn);
    else if (sf === SURF.water) c.copy(cWater);
    else if (sf === SURF.ice) c.copy(cIce);
    else if (sf === SURF.berm) c.copy(((lat[v] - ROAD_HALF_WIDTH) * 0.8) % 1 < 0.5 ? cBerm : cBerm2);
    else if (sf === SURF.dirt) c.copy(cDirt).lerp(cDirt2, noise2(x * 0.1, z * 0.1));
    else if (ny > 0.78) c.copy(cGrass).lerp(cGrass2, noise2(x * 0.08, z * 0.08));
    else if (ny > 0.55) c.copy(cDirt).lerp(cGrass2, Math.max(0, (ny - 0.55) / 0.23) * 0.6);
    else if (ny > 0.35) c.copy(cRock);
    else c.copy(cCliff);
    if (sf !== SURF.road && sf !== SURF.water && sf !== SURF.berm && sf !== SURF.torn && ny > 0.5) {
      const snow = smooth(SNOW_LINE - 5, SNOW_LINE + 3, y + 1.5 * (noise2(x * 0.15, z * 0.15) - 0.5));
      c.lerp(noise2(x * 0.3, z * 0.3) > 0.5 ? cSnow : cSnow2, snow);
    }
    colors[v * 3] = c.r;
    colors[v * 3 + 1] = c.g;
    colors[v * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setAttribute("road", new THREE.BufferAttribute(road, 1));
  geo.setAttribute("marks", new THREE.BufferAttribute(marks, 2));
  geo.computeBoundingSphere();
  return geo;
}
