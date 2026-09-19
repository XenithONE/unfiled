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
const BANK = 0.2;
const DEG = Math.PI / 180;
const CUT_TAN = Math.tan(65 * DEG);
const CUT_H = 4;
const CUT_SLOPE = Math.tan(22 * DEG);
const FILL_TAN = Math.tan(68 * DEG);
const FILL_H = 10;
const FILL_SLOPE = Math.tan(18 * DEG);
const INFLUENCE = 45;

interface PieceBase {
  index: number;
  s0: number;
  length: number;
  h0: number;
  grade: number;
}
interface Straight extends PieceBase {
  kind: "straight";
  ax: number;
  az: number;
  dx: number;
  dz: number;
  /** sign of the cross product on the uphill (mountain) side */
  uphillSign: number;
}
interface Arc extends PieceBase {
  kind: "arc";
  cx: number;
  cz: number;
  R: number;
  a0: number;
  sweep: number;
}
export type Piece = Straight | Arc;

export interface TerrainSample {
  h: number;
  /** 1 on the asphalt, 0 elsewhere */
  road: number;
  /** signed lateral offset from the centreline (m), positive toward the uphill side */
  lat: number;
  /** distance along the whole course (m) of the nearest road point */
  s: number;
  /** nearest piece index */
  piece: number;
  /** lateral distance to the nearest centreline (m) */
  d: number;
}

export type RailKind = "rail" | "pipe";
export interface Rail {
  id: number;
  a: THREE.Vector3;
  b: THREE.Vector3;
  kind: RailKind;
}
export interface Obstacle {
  x: number;
  z: number;
  r: number;
  kind: "rock" | "pine";
  id: number;
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
}
export interface RoadPoint {
  x: number;
  z: number;
  h: number;
  dx: number;
  dz: number;
}

interface Bump {
  piece: number;
  t0: number;
  t1: number;
  lat0: number;
  lat1: number;
  f: (u: number, v: number) => number;
}

export interface Course {
  sample(x: number, z: number, out: TerrainSample): TerrainSample;
  height(x: number, z: number): number;
  normal(x: number, z: number, out: THREE.Vector3): THREE.Vector3;
  roadPoint(s: number, out: RoadPoint): RoadPoint;
  totalLength: number;
  startS: number;
  finishS: number;
  pieces: Piece[];
  rails: Rail[];
  obstacles: Obstacle[];
  boosts: BoostPad[];
  signs: SignSpot[];
  pines: { x: number; z: number; y: number; s: number }[];
  rocks: { x: number; z: number; y: number; s: number; rot: number }[];
  extent: { x0: number; x1: number; z0: number; z1: number };
}

const TAU = Math.PI * 2;
const wrap = (a: number): number => ((a % TAU) + TAU) % TAU;

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
  o.lat = (dist - p.R);
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

    // Hairpin toward -z. Pick the perpendicular that points downhill.
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
    // Choose the sweep sign whose end tangent matches the next heading.
    let sweep = theta;
    {
      const endA = a0 + sweep;
      const tx = -Math.sin(endA) * Math.sign(sweep);
      const tz = Math.cos(endA) * Math.sign(sweep);
      if (tx * nextDx + tz * nextDz < 0.99) sweep = -theta;
    }
    const len = ARC_R * theta;
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
    });
    const a1 = a0 + sweep;
    x = cx + Math.cos(a1) * ARC_R;
    z = cz + Math.sin(a1) * ARC_R;
    h -= ARC_GRADE * len;
    s += len;
    dirSign = -dirSign;
  }
  const totalLength = s;

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
  const extent = { x0: minX - 70, x1: maxX + 70, z0: minZ - 60, z1: maxZ + 60 };

  // ---- road bumps ----
  const bumps: Bump[] = [];
  const kicker = (piece: number, t0: number, len: number, H: number, lat0 = -w, lat1 = w) =>
    bumps.push({
      piece,
      t0,
      t1: t0 + len,
      lat0,
      lat1,
      f: (u) => (u < 0.97 ? (H * u) / 0.97 : H * (1 - (u - 0.97) / 0.03)),
    });
  const log = (piece: number, t0: number) =>
    bumps.push({
      piece,
      t0,
      t1: t0 + 1.2,
      lat0: -w,
      lat1: w,
      f: (u) => 0.42 * Math.sqrt(Math.max(0, 1 - (2 * u - 1) * (2 * u - 1))),
    });
  const rollers = (piece: number, t0: number, count: number) =>
    bumps.push({
      piece,
      t0,
      t1: t0 + count * 9,
      lat0: -w,
      lat1: w,
      f: (u) => 0.55 * (0.5 - 0.5 * Math.cos(u * count * TAU)),
    });
  /** Wedge rising toward the cliff edge (downhill side is lat < 0). */
  const cliffKicker = (piece: number, t0: number, len: number, H: number) =>
    bumps.push({
      piece,
      t0,
      t1: t0 + len,
      lat0: -w,
      lat1: -w + 3.6,
      f: (_u, v) => H * (1 - v),
    });

  kicker(0, 58, 5, 1.1);
  log(2, 40);
  kicker(2, 78, 5, 1.2);
  cliffKicker(4, 34, 9, 1.4);
  rollers(6, 30, 3);
  log(8, 62);
  kicker(8, 100, 6, 1.3);
  cliffKicker(8, 50, 9, 1.5);
  rollers(10, 40, 4);
  kicker(12, 88, 7, 1.6);

  // ---- terrain ----
  const nearBuf: Near[] = pieces.map(() => ({
    t: 0,
    d: 0,
    h: 0,
    s: 0,
    side: 1,
    lat: 0,
    dist: 0,
    onArc: false,
  }));

  const sample = (px: number, pz: number, out: TerrainSample): TerrainSample => {
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
    out.d = nb.d;
    out.lat = nb.lat;

    // Asphalt: exact road height plus banking and bumps.
    if (nb.d <= w) {
      let hh = nb.h;
      if (piece.kind === "arc") hh += BANK * nb.lat;
      for (const b of bumps) {
        if (b.piece !== best || nb.t < b.t0 || nb.t > b.t1 || nb.lat < b.lat0 || nb.lat > b.lat1)
          continue;
        hh += b.f((nb.t - b.t0) / (b.t1 - b.t0), (nb.lat - b.lat0) / (b.lat1 - b.lat0));
      }
      out.h = hh;
      out.road = 1;
      return out;
    }

    // Off road: blend every nearby piece's embankment profile.
    let sumW = 0;
    let sumH = 0;
    for (let i = 0; i < pieces.length; i++) {
      const o = nearBuf[i];
      const p = pieces[i];
      let wgt = Math.max(0, 1 - o.d / INFLUENCE);
      wgt = wgt * wgt * wgt * wgt * wgt * wgt;
      if (i === best) wgt += 1e-4;
      if (wgt <= 0) continue;
      let hh: number;
      if (p.kind === "arc" && o.side < 0) {
        // hairpin island: the road height carried inward with a gentle dip
        hh = o.h - BANK * w - 0.25 - 0.08 * Math.max(0, p.R - w - o.dist);
      } else if (p.kind === "arc") {
        hh = o.h + BANK * w + cutProfile(o.d - w);
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
    hh += off * (0.5 * (noise2(px * 0.11, pz * 0.11) - 0.5) + 2.2 * (noise2(px * 0.025, pz * 0.025) - 0.5));
    out.h = hh;
    out.road = 0;
    return out;
  };

  const tmp: TerrainSample = { h: 0, road: 0, lat: 0, s: 0, piece: 0, d: 0 };
  const height = (px: number, pz: number): number => sample(px, pz, tmp).h;
  const normal = (px: number, pz: number, out: THREE.Vector3): THREE.Vector3 => {
    const e = 0.08;
    const hx = (height(px + e, pz) - height(px - e, pz)) / (2 * e);
    const hz = (height(px, pz + e) - height(px, pz - e)) / (2 * e);
    return out.set(-hx, 1, -hz).normalize();
  };

  const roadPoint = (sq: number, out: RoadPoint): RoadPoint => {
    const sc = Math.max(0, Math.min(totalLength - 0.01, sq));
    let p = pieces[pieces.length - 1];
    for (const q of pieces) {
      if (sc >= q.s0 && sc < q.s0 + q.length) {
        p = q;
        break;
      }
    }
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

  // ---- rails ----
  const rails: Rail[] = [];
  let railId = 0;
  const addRail = (a: THREE.Vector3, b: THREE.Vector3, kind: RailKind) =>
    rails.push({ id: railId++, a, b, kind });
  const rp: RoadPoint = { x: 0, z: 0, h: 0, dx: 0, dz: 0 };
  const railAt = (sq: number, lat: number, up: number): THREE.Vector3 => {
    roadPoint(sq, rp);
    const p = pieces.find((q) => sq >= q.s0 && sq < q.s0 + q.length) ?? pieces[pieces.length - 1];
    // lateral unit vector pointing to the uphill side
    let lx: number;
    let lz: number;
    if (p.kind === "straight") {
      // cross((lx,lz), dir) = lx*dz - lz*dx must have the sign of uphillSign
      if (p.uphillSign > 0) {
        lx = p.dz;
        lz = -p.dx;
      } else {
        lx = -p.dz;
        lz = p.dx;
      }
    } else {
      const ox = rp.x - p.cx;
      const oz = rp.z - p.cz;
      const len = Math.hypot(ox, oz) || 1;
      lx = ox / len;
      lz = oz / len;
    }
    const px = rp.x + lx * lat;
    const pz = rp.z + lz * lat;
    return new THREE.Vector3(px, height(px, pz) + up, pz);
  };
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
    } else {
      // downhill-edge guardrail sections with gaps to jump through
      for (let t = 12; t + 22 < p.length - 8; t += 30) {
        addRail(railAt(p.s0 + t, -(w - 0.3), 0.62), railAt(p.s0 + t + 22, -(w - 0.3), 0.62), "rail");
      }
    }
  }
  {
    // a pipeline running down the middle of the sixth straight
    const p = pieces[10];
    const segs = 6;
    let prev = railAt(p.s0 + 18, 0.6, 0.5);
    for (let i = 1; i <= segs; i++) {
      const cur = railAt(p.s0 + 18 + (90 * i) / segs, 0.6, 0.5);
      addRail(prev, cur, "pipe");
      prev = cur;
    }
  }

  // ---- boost pads, obstacles, signs ----
  const boosts: BoostPad[] = [];
  let boostId = 0;
  const pad = (sq: number, lat = 0) => {
    roadPoint(sq, rp);
    const p = railAt(sq, lat, 0);
    boosts.push({ x: p.x, z: p.z, y: p.y, yaw: Math.atan2(rp.dx, rp.dz), s: sq, id: boostId++ });
  };
  const obstacles: Obstacle[] = [];
  let obsId = 0;
  const rock = (sq: number, lat: number) => {
    const p = railAt(sq, lat, 0);
    obstacles.push({ x: p.x, z: p.z, r: 1.1, kind: "rock", id: obsId++ });
  };
  for (const p of pieces) {
    if (p.kind !== "straight") continue;
    pad(p.s0 + 22);
    pad(p.s0 + 96, p.index % 4 === 0 ? 1.4 : -1.4);
    if (p.index >= 2) rock(p.s0 + 48 + (p.index % 3) * 8, p.index % 4 === 0 ? -2.3 : 2.3);
    if (p.index >= 6) rock(p.s0 + 112, p.index % 4 === 0 ? 2.1 : -2.1);
  }
  const signs: SignSpot[] = [];
  for (const p of pieces) {
    if (p.kind !== "arc") continue;
    for (const f of [0.25, 0.5, 0.75]) {
      const sq = p.s0 + p.length * f;
      const sp = railAt(sq, w + 1.6, 0);
      roadPoint(sq, rp);
      signs.push({ x: sp.x, z: sp.z, y: sp.y, yaw: Math.atan2(rp.dx, rp.dz), left: p.sweep > 0 });
    }
  }

  // ---- scattered pines and rocks ----
  const pines: Course["pines"] = [];
  const rocks: Course["rocks"] = [];
  const nrm = new THREE.Vector3();
  const ts: TerrainSample = { h: 0, road: 0, lat: 0, s: 0, piece: 0, d: 0 };
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let i = 0; i < 2600 && pines.length < 380; i++) {
    const px = extent.x0 + rnd() * (extent.x1 - extent.x0);
    const pz = extent.z0 + rnd() * (extent.z1 - extent.z0);
    sample(px, pz, ts);
    if (ts.d < w + 2.5 || ts.d > 60) continue;
    normal(px, pz, nrm);
    if (nrm.y < 0.62) continue;
    pines.push({ x: px, z: pz, y: ts.h, s: 0.8 + rnd() * 0.7 });
  }
  for (let i = 0; i < 1200 && rocks.length < 110; i++) {
    const px = extent.x0 + rnd() * (extent.x1 - extent.x0);
    const pz = extent.z0 + rnd() * (extent.z1 - extent.z0);
    sample(px, pz, ts);
    if (ts.d < w + 1.2 || ts.d > 55) continue;
    rocks.push({ x: px, z: pz, y: ts.h - 0.3, s: 0.6 + rnd() * 1.6, rot: rnd() * TAU });
  }
  // pines that hug the road for near misses
  for (const p of pieces) {
    if (p.kind !== "straight") continue;
    for (const t of [30, 70, 110]) {
      const lat = ((p.index / 2 + t / 40) | 0) % 2 === 0 ? w + 1.3 : -(w + 1.3);
      const pt = railAt(p.s0 + t, lat, 0);
      pines.push({ x: pt.x, z: pt.z, y: pt.y, s: 1.1 });
      obstacles.push({ x: pt.x, z: pt.z, r: 0.45, kind: "pine", id: obsId++ });
    }
  }

  return {
    sample,
    height,
    normal,
    roadPoint,
    totalLength,
    startS: 6,
    finishS: totalLength - 22,
    pieces,
    rails,
    obstacles,
    boosts,
    signs,
    pines,
    rocks,
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
  const ts: TerrainSample = { h: 0, road: 0, lat: 0, s: 0, piece: 0, d: 0 };
  const cAsphalt = new THREE.Color(0xa9adbd);
  const cGrass = new THREE.Color(0x9ad27f);
  const cGrass2 = new THREE.Color(0x7dbd68);
  const cDirt = new THREE.Color(0xd9b98d);
  const cRock = new THREE.Color(0xbdb8cb);
  const cCliff = new THREE.Color(0x9a94ad);
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
    const z = positions[v * 3 + 2];
    if (road[v] > 0.5) c.copy(cAsphalt);
    else if (ny > 0.78) c.copy(cGrass).lerp(cGrass2, noise2(x * 0.08, z * 0.08));
    else if (ny > 0.55) c.copy(cDirt).lerp(cGrass2, Math.max(0, (ny - 0.55) / 0.23) * 0.6);
    else if (ny > 0.35) c.copy(cRock);
    else c.copy(cCliff);
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
