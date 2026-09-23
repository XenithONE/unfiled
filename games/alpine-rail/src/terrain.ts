// The landscape is built around the railway, not the other way round: every
// point knows its nearest place on the line, whether it lies on the mountain
// side or the valley side, and how high the line is there. From that we get
// cuttings, embankments, a lake, a basin floor, the ravine under the viaduct,
// spurs over the tunnels, and — further out — ridged peaks, a glacier and a
// horn. Heights are pure functions; meshes are built chunk by chunk.

import * as THREE from "three";
import { Simplex, clamp, lerp, mulberry32, smoothstep } from "./noise";
import { LAKE_Y, TRACK_DS, type Track } from "./track";

export interface Near {
  s: number;
  d: number; // horizontal distance to the centre line
  side: number; // +1 right of the running direction (valley side), -1 left
  y: number; // track formation height at s
}


export class Terrain {
  readonly track: Track;
  readonly noise = new Simplex(20260923);
  readonly noise2 = new Simplex(77);
  // Coarse samples for fallback queries.
  private coarseStep = 10; // every 10th sample (20 m)
  // Spatial hash for fine queries.
  private cell = 48;
  private gx0: number;
  private gz0: number;
  private gw: number;
  private gh: number;
  private buckets: Int32Array[];
  // Main valley (far field): distance to its axis and the line position
  // abreast of it, precomputed on a coarse raster.
  private vx0 = 0;
  private vz0 = 0;
  private vw = 0;
  private vh = 0;
  private vD = new Float32Array(0);
  private vS = new Float32Array(0);
  readonly bounds: { x0: number; x1: number; z0: number; z1: number };
  // Named features.
  readonly gorge: { ax: number; az: number; bx: number; bz: number; yA: number; yB: number };
  readonly horn: { x: number; z: number; y: number };
  readonly glacier: { x: number; z: number }[];
  readonly lakeCentre: { x: number; z: number };
  private gorgeDeck = 0;
  private glacierBox = { x0: 0, x1: 0, z0: 0, z1: 0 };

  constructor(track: Track) {
    this.track = track;
    const t = track;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < t.n; i++) {
      x0 = Math.min(x0, t.x[i]);
      x1 = Math.max(x1, t.x[i]);
      z0 = Math.min(z0, t.z[i]);
      z1 = Math.max(z1, t.z[i]);
    }
    this.bounds = { x0, x1, z0, z1 };

    // Fine spatial hash over all samples.
    const pad = 600;
    this.gx0 = x0 - pad;
    this.gz0 = z0 - pad;
    this.gw = Math.ceil((x1 - x0 + 2 * pad) / this.cell);
    this.gh = Math.ceil((z1 - z0 + 2 * pad) / this.cell);
    const lists: number[][] = Array.from({ length: this.gw * this.gh }, () => []);
    for (let i = 0; i < t.n; i++) {
      const cx = Math.floor((t.x[i] - this.gx0) / this.cell);
      const cz = Math.floor((t.z[i] - this.gz0) / this.cell);
      lists[cz * this.gw + cx].push(i);
    }
    this.buckets = lists.map((l) => Int32Array.from(l));

    // Features placed relative to the line.
    const br = t.bridges[0];
    const mid = (br.from + br.to) / 2;
    const pm = t.pos(mid);
    const hm = t.headingAt(mid);
    const right = { x: -Math.sin(hm), z: Math.cos(hm) };
    this.gorgeDeck = pm.y;
    this.gorge = {
      ax: pm.x - right.x * 520, // upstream, up the mountain side
      az: pm.z - right.z * 520,
      bx: pm.x + right.x * 230, // downstream into the hairpin
      bz: pm.z + right.z * 230,
      yA: pm.y + 230,
      yB: pm.y - 115,
    };
    const end = t.length - 90;
    const pe = t.pos(end);
    const he = t.headingAt(end);
    const f = { x: Math.cos(he), z: Math.sin(he) };
    const l = { x: Math.sin(he), z: -Math.cos(he) };
    // The horn stands at the head of the valley, just left of dead ahead.
    this.horn = { x: pe.x + l.x * 1500 + f.x * 4200, z: pe.z + l.z * 1500 + f.z * 4200, y: 3620 };
    // The glacier pours from below the horn towards the terminus.
    this.glacier = [];
    for (let i = 0; i <= 12; i++) {
      const u = i / 12;
      const bend = Math.sin(u * Math.PI) * 280;
      this.glacier.push({
        x: lerp(this.horn.x - f.x * 900 + l.x * 900, pe.x + l.x * 700 + f.x * 900, u) + l.x * bend,
        z: lerp(this.horn.z - f.z * 900 + l.z * 900, pe.z + l.z * 700 + f.z * 900, u) + l.z * bend,
      });
    }
    this.glacierBox = {
      x0: Math.min(...this.glacier.map((p) => p.x)) - 1000,
      x1: Math.max(...this.glacier.map((p) => p.x)) + 1000,
      z0: Math.min(...this.glacier.map((p) => p.z)) - 1000,
      z1: Math.max(...this.glacier.map((p) => p.z)) + 1000,
    };
    const p0 = t.pos(600);
    const h0 = t.headingAt(600);
    this.lakeCentre = { x: p0.x - Math.sin(h0) * 700, z: p0.z + Math.cos(h0) * 700 };

    // Valley axis through hand-placed control points beside the line: along
    // the lake, through the basin (skipping the side ravine of the hairpin),
    // and out past the glacier terminus.
    const P = (sv: number, off: number, along = 0) => {
      const p = t.pos(sv);
      const h = t.headingAt(sv);
      return { x: p.x - Math.sin(h) * off + Math.cos(h) * along, z: p.z + Math.cos(h) * off + Math.sin(h) * along };
    };
    const ctrl: { x: number; z: number; s: number }[] = [
      { ...P(0, 950, -12000), s: -9000 },
      { ...P(0, 950, -4000), s: -2500 },
      { ...P(700, 900), s: 700 },
      { ...P(1900, 760), s: 1900 },
      { ...P(3100, 700), s: 3100 },
      { ...P(8000, 750), s: 8000 },
      { ...P(9800, 800), s: 9800 },
      { ...P(t.length, 900), s: t.length },
      { ...P(t.length, 900, 4000), s: t.length + 3000 },
      { ...P(t.length, 900, 14000), s: t.length + 10000 },
    ];
    const poly: { x: number; z: number; s: number }[] = [];
    for (let k = 0; k < ctrl.length - 1; k++) {
      const p0 = ctrl[Math.max(0, k - 1)];
      const p1 = ctrl[k];
      const p2 = ctrl[k + 1];
      const p3 = ctrl[Math.min(ctrl.length - 1, k + 2)];
      for (let q = 0; q < 16; q++) {
        const u = q / 16;
        const cr = (a0: number, a1: number, a2: number, a3: number) =>
          0.5 * (2 * a1 + (-a0 + a2) * u + (2 * a0 - 5 * a1 + 4 * a2 - a3) * u * u + (-a0 + 3 * a1 - 3 * a2 + a3) * u * u * u);
        poly.push({ x: cr(p0.x, p1.x, p2.x, p3.x), z: cr(p0.z, p1.z, p2.z, p3.z), s: lerp(p1.s, p2.s, u) });
      }
    }
    poly.push(ctrl[ctrl.length - 1]);
    this.valleyAxis = poly;
    const VC = 100;
    const vpad = 15000;
    this.vx0 = x0 - vpad;
    this.vz0 = z0 - vpad;
    this.vw = Math.ceil((x1 - x0 + 2 * vpad) / VC) + 1;
    this.vh = Math.ceil((z1 - z0 + 2 * vpad) / VC) + 1;
    this.vD = new Float32Array(this.vw * this.vh);
    this.vS = new Float32Array(this.vw * this.vh);
    for (let j = 0; j < this.vh; j++) {
      for (let i = 0; i < this.vw; i++) {
        const x = this.vx0 + i * VC;
        const z = this.vz0 + j * VC;
        let best = Infinity;
        let bs = 0;
        for (let k = 0; k < poly.length - 1; k++) {
          const ax = poly[k].x;
          const az = poly[k].z;
          const ex = poly[k + 1].x - ax;
          const ez = poly[k + 1].z - az;
          const u = clamp(((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1), 0, 1);
          const dx = x - ax - ex * u;
          const dz = z - az - ez * u;
          const d2 = dx * dx + dz * dz;
          if (d2 < best) {
            best = d2;
            bs = lerp(poly[k].s, poly[k + 1].s, u);
          }
        }
        this.vD[j * this.vw + i] = Math.sqrt(best);
        this.vS[j * this.vw + i] = bs;
      }
    }
  }

  readonly valleyAxis: { x: number; z: number; s: number }[] = [];

  private axis(x: number, z: number): { d: number; s: number } {
    const fx = clamp((x - this.vx0) / 100, 0, this.vw - 1.001);
    const fz = clamp((z - this.vz0) / 100, 0, this.vh - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const q = j * this.vw + i;
    const w = this.vw;
    const bl = (a: Float32Array) => lerp(lerp(a[q], a[q + 1], u), lerp(a[q + w], a[q + w + 1], u), v);
    return { d: bl(this.vD), s: bl(this.vS) };
  }

  /** Valley floor (river / lake bed) elevation below the line at s. */
  floorAt(s: number): number {
    const lakeBed = LAKE_Y - 14;
    const river = 1252 + Math.max(0, s - 1700) * 0.0105;
    let f = lerp(lakeBed, river, smoothstep(1250, 1750, s));
    // Beyond the lake the valley climbs to a pass; beyond the terminus it
    // steepens into the glacier cirque. Both close the view.
    if (s < -1400) f += Math.pow(-1400 - s, 1.15) * 0.07;
    const end = this.track.length + 900;
    if (s > end) f += Math.pow(s - end, 1.2) * 0.05;
    return f;
  }

  /** Mountain-side cross slope: gentle meadows by the lake, steep above. */
  private slopeM(s: number): number {
    let v = lerp(0.2, 0.62, smoothstep(1400, 3900, s));
    v = lerp(v, 0.42, smoothstep(9800, 11200, s));
    for (const g of this.track.galleries) v = lerp(v, 1.25, smoothstep(g.from - 80, g.from, s) * (1 - smoothstep(g.to, g.to + 80, s)));
    return v;
  }

  private slopeV(s: number): number {
    return lerp(0.22, 0.5, smoothstep(1500, 4200, s));
  }

  /** Exact nearest point on the centre line (hash + segment projection). */
  near(x: number, z: number, out: Near): Near {
    const t = this.track;
    const cx = Math.floor((x - this.gx0) / this.cell);
    const cz = Math.floor((z - this.gz0) / this.cell);
    let best = -1;
    let bestD2 = Infinity;
    for (let r = 0; r <= 4; r++) {
      for (let j = cz - r; j <= cz + r; j++) {
        if (j < 0 || j >= this.gh) continue;
        for (let i = cx - r; i <= cx + r; i++) {
          if (i < 0 || i >= this.gw) continue;
          if (r > 0 && j !== cz - r && j !== cz + r && i !== cx - r && i !== cx + r) continue;
          const b = this.buckets[j * this.gw + i];
          for (let k = 0; k < b.length; k++) {
            const q = b[k];
            const dx = x - t.x[q];
            const dz = z - t.z[q];
            const d2 = dx * dx + dz * dz;
            if (d2 < bestD2) {
              bestD2 = d2;
              best = q;
            }
          }
        }
      }
      // Anything in ring r+1 or beyond is at least r cells away.
      const reach = r * this.cell;
      if (best >= 0 && bestD2 <= reach * reach) break;
    }
    if (best < 0) {
      // Far away: brute force on the coarse samples.
      const cs = this.coarseStep;
      for (let q = 0; q < t.n; q += cs) {
        const dx = x - t.x[q];
        const dz = z - t.z[q];
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = q;
        }
      }
      let lo = Math.max(0, best - cs);
      const hi = Math.min(t.n - 1, best + cs);
      for (; lo <= hi; lo++) {
        const dx = x - t.x[lo];
        const dz = z - t.z[lo];
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = lo;
        }
      }
    }
    // Project onto the adjacent segment for a continuous s.
    let s = best * TRACK_DS;
    const a = best > 0 && best < t.n - 1 ? (projT(x, z, t, best - 1) < 1 ? best - 1 : best) : Math.min(best, t.n - 2);
    const u = clamp(projT(x, z, t, a), 0, 1);
    const px = t.x[a] + (t.x[a + 1] - t.x[a]) * u;
    const pz = t.z[a] + (t.z[a + 1] - t.z[a]) * u;
    s = (a + u) * TRACK_DS;
    const h = t.heading[a];
    const dx = x - px;
    const dz = z - pz;
    let d = Math.hypot(dx, dz);
    let lat = -Math.sin(h) * dx + Math.cos(h) * dz;
    // Beyond the ends, measure along the extended line.
    if ((a === 0 && u === 0) || (a === t.n - 2 && u === 1)) d = Math.abs(lat) + 0;
    if (Math.abs(lat) < 1e-6) lat = 1e-6;
    out.s = s;
    out.d = d;
    out.side = Math.sign(lat);
    out.y = t.y[a] + (t.y[a + 1] - t.y[a]) * u;
    return out;
  }

  private tmp: Near = { s: 0, d: 0, side: 1, y: 0 };

  /** Glacial valley far from the line: U-shaped floor, walls, ridged peaks. */
  far(x: number, z: number): number {
    const n = this.noise;
    const a = this.axis(x, z);
    const floor = this.floorAt(clamp(a.s, -9000, this.track.length + 6000));
    const half = lerp(1050, 420, smoothstep(1500, 3500, a.s));
    const e = Math.max(0, a.d - half);
    const wall = 0.55 * 1500 * (1 - Math.exp(-e / 1500)) + e * 0.05;
    const peaks = smoothstep(0, 1600, e) * (1150 * n.ridged(x / 4300, z / 4300, 5) + 420 * (n.fbm(x / 7000 + 3, z / 7000, 3) + 0.5));
    return floor + wall + peaks + n.fbm(x / 520, z / 520, 3) * (1.2 + Math.min(e, 800) * 0.05);
  }

  /** Natural ground before the railway's own earthworks. */
  natural(x: number, z: number, nr: Near): number {
    const n = this.noise;
    const d = nr.d;
    const toFar = smoothstep(260, 950, d);
    let near = 0;
    if (toFar < 1) {
      const y = nr.y;
      const s = nr.s;
      if (nr.side > 0) {
        // Valley side: slope down to the floor, then flat.
        const floor = this.floorAt(s);
        const drop = Math.max(0.5, y - floor);
        const dFloor = drop / this.slopeV(s);
        const u = Math.min(1, d / dFloor);
        near = y - drop * (u * (0.7 + 0.3 * u));
      } else {
        const cm = this.slopeM(s);
        near = y + cm * 1400 * (1 - Math.exp(-d / 1400)) + smoothstep(120, 900, d) * 520 * n.ridged(x / 3200, z / 3200, 4);
      }
      const amp = 2.2 + Math.min(d, 900) * 0.05;
      near += n.fbm(x / 420, z / 420, 4) * amp * 2.4;
      near += n.fbm(x / 90 + 3, z / 90 - 1, 2) * Math.min(3 + d * 0.02, 7);
    }
    let h = toFar > 0 ? lerp(near, this.far(x, z), toFar) : near;
    // Boulder-ish bumps on the upper slopes.
    if (h > 1700) h += Math.max(0, n.noise(x / 38, z / 38)) * smoothstep(1700, 2300, h) * 14;
    return h;
  }

  height(x: number, z: number): number {
    const nr = this.near(x, z, this.tmp);
    return this.heightNear(x, z, nr);
  }

  heightNear(x: number, z: number, nr: Near): number {
    const t = this.track;
    let h = this.natural(x, z, nr);
    const onLine = nr.s > 1 && nr.s < t.length - 1;

    // Features in world space.
    h = this.applyHorn(x, z, h);
    h = this.applyGorge(x, z, h);

    // Tunnels: keep plenty of rock over the bore.
    const tunnel = t.inSpan(t.tunnels, nr.s);
    if (tunnel && nr.d < 150) {
      // A rounded spur over the bore, falling away naturally to the sides.
      const cover = nr.y + 16 + nr.d * 0.5 - Math.pow(Math.max(0, nr.d - 30) / 120, 2) * 40 + this.noise.fbm(x / 60, z / 60, 3) * 4;
      h = lerp(h, Math.max(h, cover), 1 - smoothstep(45, 150, nr.d));
    }
    const bridge = t.inSpan(t.bridges, nr.s, 6);
    // The railway's earthworks: formation, cutting and embankment slopes.
    if (!tunnel && onLine) {
      const bed = nr.y - 0.35;

      const station = t.stations.some((st) => nr.s > st.platformFrom - 40 && nr.s < st.platformTo + 40);
      const flatW = station ? 16 : 0;
      const e2 = Math.max(0, nr.d - 3.6 - flatW);
      const lo = bed - e2 * 0.75;
      const hi = bed + e2 * (station ? 0.7 : 1.35);
      const wF = bridge ? 0 : 1 - smoothstep(60, 120, nr.d);
      const clamped = clamp(h, lo, hi);
      h = lerp(h, clamped, wF);
      if (bridge && nr.d < 16) h = lerp(Math.min(h, nr.y - 4), h, smoothstep(8, 16, nr.d));
    }
    return h;
  }

  private applyHorn(x: number, z: number, h: number): number {
    const c = this.horn;
    const dx = x - c.x;
    const dz = z - c.z;
    const r = Math.hypot(dx, dz);
    if (r > 4200) return h;
    // Four-faced pyramid: blend of L1 and L2 distance, with ridges.
    const ang = Math.atan2(dz, dx);
    const l1 = (Math.abs(dx * 0.8 + dz * 0.6) + Math.abs(-dx * 0.6 + dz * 0.8)) * 0.72;
    const dist = lerp(r, l1, 0.55) * (1 + 0.06 * Math.sin(ang * 3 + 1));
    const peak = c.y - Math.pow(dist, 0.93) * 1.18 + this.noise2.fbm(x / 160, z / 160, 4) * 40;
    return Math.max(h, lerp(h, peak, smoothstep(4200, 2600, r)));
  }

  private applyGorge(x: number, z: number, h: number): number {
    const g = this.gorge;
    const vx = g.bx - g.ax;
    const vz = g.bz - g.az;
    const len2 = vx * vx + vz * vz;
    const raw = ((x - g.ax) * vx + (z - g.az) * vz) / len2;
    if (raw < -0.1 || raw > 1.15) return h;
    const u = clamp(raw, 0, 1);
    const px = g.ax + vx * u;
    const pz = g.az + vz * u;
    const lat = Math.hypot(x - px, z - pz);
    if (lat > 260) return h;
    const meander = this.noise2.noise(u * 6, 1.3) * 10;
    // Floor: steep upstream, ~55 m under the deck at the bridge, then on down.
    const ub = 520 / 750;
    const yMid = this.gorgeDeck - 55;
    const floor = (u < ub ? lerp(g.yA, yMid, Math.pow(u / ub, 1.25)) : lerp(yMid, g.yB, (u - ub) / (1 - ub))) + this.noise2.fbm(x / 40, z / 40, 2) * 1.5;
    const wall = floor + Math.max(0, Math.abs(lat + meander) - 5) * 1.7 + Math.max(0, lat - 50) * 0.6;
    // Fade out at both ends and at the rim so nothing is clipped flat.
    const fade = smoothstep(-0.1, 0.12, raw) * (1 - smoothstep(1.0, 1.15, raw)) * (1 - smoothstep(170, 260, lat));
    return lerp(h, Math.min(h, wall), fade);
  }

  /** Distance to the glacier's centre line and its width there. */
  glacierInfo(x: number, z: number): number {
    const gb = this.glacierBox;
    if (x < gb.x0 || x > gb.x1 || z < gb.z0 || z > gb.z1) return 0;
    let best = 1e9;
    let bu = 0;
    const g = this.glacier;
    for (let i = 0; i < g.length - 1; i++) {
      const ax = g[i].x;
      const az = g[i].z;
      const vx = g[i + 1].x - ax;
      const vz = g[i + 1].z - az;
      const u = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1);
      const d = Math.hypot(x - ax - vx * u, z - az - vz * u);
      if (d < best) {
        best = d;
        bu = (i + u) / (g.length - 1);
      }
    }
    const width = lerp(900, 170, bu);
    return 1 - smoothstep(width * 0.55, width, best);
  }
}

function projT(x: number, z: number, t: Track, a: number): number {
  const ax = t.x[a];
  const az = t.z[a];
  const vx = t.x[a + 1] - ax;
  const vz = t.z[a + 1] - az;
  return ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz);
}

// ---------------------------------------------------------------------------
// Meshes

export const CHUNK = 400;

export interface ChunkSpec {
  cx: number;
  cz: number;
  seg: number; // quads per side
}

/** Decide which chunks exist and at what resolution. */
export function planChunks(terrain: Terrain, fineSpacing: number): ChunkSpec[] {
  const b = terrain.bounds;
  const R = 11000;
  const x0 = Math.floor((b.x0 - R) / CHUNK);
  const x1 = Math.ceil((b.x1 + R) / CHUNK);
  const z0 = Math.floor((b.z0 - R) / CHUNK);
  const z1 = Math.ceil((b.z1 + R) / CHUNK);
  const out: ChunkSpec[] = [];
  const nr: Near = { s: 0, d: 0, side: 1, y: 0 };
  const cxm = (b.x0 + b.x1) / 2;
  const czm = (b.z0 + b.z1) / 2;
  for (let j = z0; j < z1; j++) {
    for (let i = x0; i < x1; i++) {
      const mx = (i + 0.5) * CHUNK;
      const mz = (j + 0.5) * CHUNK;
      const dc = Math.hypot(mx - cxm, mz - czm);
      if (dc > R + 3000) continue;
      terrain.near(mx, mz, nr);
      const d = nr.d - CHUNK * 0.71;
      let seg: number;
      if (d < 160) seg = Math.round(CHUNK / fineSpacing);
      else if (d < 1300) seg = 20;
      else if (d < 4200) seg = 8;
      else seg = 4;
      out.push({ cx: i, cz: j, seg });
    }
  }
  return out;
}

export interface ChunkData {
  spec: ChunkSpec;
  positions: Float32Array;
  normals: Float32Array;
  mix: Float32Array; // grass, rock, snow, dirt
  tint: Float32Array; // grass colour + ambient occlusion
  index: Uint32Array;
}

const grassLush = new THREE.Color("#4a7a2a");
const grassDry = new THREE.Color("#859344");
const grassAlp = new THREE.Color("#6c8440");
const forestDark = new THREE.Color("#2c4a28");
const tmpC = new THREE.Color();

/** Build one chunk: heights, normals, material weights, skirts, index. */
export function buildChunk(terrain: Terrain, spec: ChunkSpec): ChunkData {
  const { seg } = spec;
  const step = CHUNK / seg;
  const x0 = spec.cx * CHUNK;
  const z0 = spec.cz * CHUNK;
  const g = seg + 3; // with a one-sample border for normals
  const H = new Float32Array(g * g);
  const S = new Float32Array(g * g);
  const D = new Float32Array(g * g);
  const nr: Near = { s: 0, d: 0, side: 1, y: 0 };
  for (let j = 0; j < g; j++) {
    for (let i = 0; i < g; i++) {
      const x = x0 + (i - 1) * step;
      const z = z0 + (j - 1) * step;
      terrain.near(x, z, nr);
      H[j * g + i] = terrain.heightNear(x, z, nr);
      S[j * g + i] = nr.s;
      D[j * g + i] = nr.d;
    }
  }
  const v = seg + 1;
  const skirtN = 4 * seg;
  const count = v * v + skirtN * 2;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const mix = new Float32Array(count * 4);
  const tint = new Float32Array(count * 4);
  const n = terrain.noise;
  const track = terrain.track;
  let q = 0;
  for (let j = 0; j < v; j++) {
    for (let i = 0; i < v; i++) {
      const gi = (j + 1) * g + (i + 1);
      const x = x0 + i * step;
      const z = z0 + j * step;
      const h = H[gi];
      const nx = (H[gi - 1] - H[gi + 1]) / (2 * step);
      const nz = (H[gi - g] - H[gi + g]) / (2 * step);
      const inv = 1 / Math.hypot(nx, 1, nz);
      const ny = inv;
      positions.set([x, h, z], q * 3);
      normals.set([nx * inv, ny, nz * inv], q * 3);
      // Concavity → ambient occlusion.
      const lap = (H[gi - 1] + H[gi + 1] + H[gi - g] + H[gi + g]) * 0.25 - h;
      const ao = clamp(1 - Math.max(0, lap) / (step * 0.9), 0.55, 1);
      const d = D[gi];
      const s = S[gi];
      // Materials.
      const slope = 1 - ny; // 0 flat
      const snowLine = 2560 + n.fbm(x / 700, z / 700, 3) * 260;
      const glacier = terrain.glacierInfo(x, z);
      // Summer: snow lies in hollows and on gentler faces, not on crags.
      let snow = smoothstep(snowLine - 160, snowLine + 220, h + Math.max(0, lap) * 6) * (1 - smoothstep(0.36, 0.55, slope));
      snow = Math.max(snow, glacier * smoothstep(1500, 1700, h));
      let rock = smoothstep(0.34, 0.55, slope + n.fbm(x / 60, z / 60, 2) * 0.08);
      rock = Math.max(rock, smoothstep(2150, 2500, h) * (0.55 + 0.45 * n.noise(x / 90, z / 90)));
      rock *= 1 - snow * 0.9;
      const bed = d < 5 && s > 1 && s < track.length - 1 && !track.inSpan(track.tunnels, s) ? 1 - smoothstep(2.6, 3.8, d) : 0;
      const path = 0;
      const dirt = Math.max(bed, path);
      let grass = Math.max(0, 1 - rock - snow - dirt);
      const sum = grass + rock + snow + dirt || 1;
      grass /= sum;
      mix.set([grass, rock / sum, snow / sum, dirt / sum], q * 4);
      // Grass colour: lush low meadows, drier sunny slopes, alpine above.
      const dry = clamp(0.5 + n.fbm(x / 260, z / 260, 3) * 0.9 + slope * 0.6, 0, 1);
      tmpC.copy(grassLush).lerp(grassDry, dry * 0.55).lerp(grassAlp, smoothstep(1600, 2100, h));
      // Forest mask: dark conifer tint where trees would grow (far view).
      const forest = forestMask(terrain, x, z, h, slope, d);
      tmpC.lerp(forestDark, forest * smoothstep(250, 600, d) * 0.85);
      tint.set([tmpC.r, tmpC.g, tmpC.b, ao], q * 4);
      q++;
    }
  }
  // Skirts: a second copy of the edge ring dropped down to hide LOD cracks.
  const edge: number[] = [];
  for (let i = 0; i < seg; i++) edge.push(i); // top row
  for (let j = 0; j < seg; j++) edge.push(j * v + seg); // right col
  for (let i = seg; i > 0; i--) edge.push(seg * v + i); // bottom row
  for (let j = seg; j > 0; j--) edge.push(j * v); // left col
  const skirtBase = q;
  for (const e of edge) {
    positions.copyWithin(q * 3, e * 3, e * 3 + 3);
    normals.copyWithin(q * 3, e * 3, e * 3 + 3);
    mix.copyWithin(q * 4, e * 4, e * 4 + 4);
    tint.copyWithin(q * 4, e * 4, e * 4 + 4);
    q++;
  }
  for (const e of edge) {
    positions.copyWithin(q * 3, e * 3, e * 3 + 3);
    positions[q * 3 + 1] -= 18 + step * 0.6;
    normals.copyWithin(q * 3, e * 3, e * 3 + 3);
    mix.copyWithin(q * 4, e * 4, e * 4 + 4);
    tint.copyWithin(q * 4, e * 4, e * 4 + 4);
    q++;
  }
  // Index, skipping the few triangles that would block tunnel mouths.
  const idx: number[] = [];
  const nearPortal = portalBox(terrain, x0, z0);
  const vS = (a: number) => S[(Math.floor(a / v) + 1) * g + (a % v) + 1];
  const vD = (a: number) => D[(Math.floor(a / v) + 1) * g + (a % v) + 1];
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * v + i;
      const b2 = a + 1;
      const c = a + v;
      const d2 = c + 1;
      if (nearPortal && blocksPortal(terrain, [a, b2, c, d2], vS, vD)) continue;
      idx.push(a, c, b2, b2, c, d2);
    }
  }
  const E = edge.length;
  for (let k = 0; k < E; k++) {
    const a = skirtBase + k;
    const b2 = skirtBase + ((k + 1) % E);
    const c = skirtBase + E + k;
    const d2 = skirtBase + E + ((k + 1) % E);
    idx.push(a, b2, c, b2, d2, c);
    idx.push(a, c, b2, b2, c, d2);
  }
  return { spec, positions, normals, mix, tint, index: Uint32Array.from(idx) };
}

function portalBox(terrain: Terrain, x0: number, z0: number): boolean {
  const t = terrain.track;
  for (const tn of t.tunnels) {
    for (const s of [tn.from, tn.to]) {
      const p = t.pos(s);
      if (p.x > x0 - 40 && p.x < x0 + CHUNK + 40 && p.z > z0 - 40 && p.z < z0 + CHUNK + 40) return true;
    }
  }
  return false;
}

function blocksPortal(terrain: Terrain, quad: number[], vS: (a: number) => number, vD: (a: number) => number): boolean {
  let s0 = Infinity;
  let s1 = -Infinity;
  let dMin = Infinity;
  for (const k of quad) {
    s0 = Math.min(s0, vS(k));
    s1 = Math.max(s1, vS(k));
    dMin = Math.min(dMin, vD(k));
  }
  if (dMin > 11 || s1 - s0 > 40) return false;
  for (const tn of terrain.track.tunnels) {
    for (const ps of [tn.from, tn.to]) if (s0 < ps + 1.5 && s1 > ps - 1.5) return true;
  }
  return false;
}

export function forestMask(terrain: Terrain, x: number, z: number, h: number, slope: number, d: number): number {
  const n = terrain.noise2;
  const patch = n.fbm(x / 520, z / 520, 4) + 0.18;
  const lineGap = smoothstep(14, 30, d);
  const tree = smoothstep(0.02, 0.2, patch) * (1 - smoothstep(1850, 2000, h + n.noise(x / 200, z / 200) * 80)) * (1 - smoothstep(0.5, 0.7, slope));
  const lake = smoothstep(LAKE_Y + 1, LAKE_Y + 4, h);
  return tree * lineGap * lake;
}

/**
 * Trees for one square of land: [x, y, z, scale, kind, yaw] per tree.
 * kind 0 = spruce, 1 = larch, 2 = broadleaf (low meadows).
 */
export function scatterTrees(terrain: Terrain, x0: number, z0: number, size: number, spacing: number, seed: number): Float32Array {
  const out: number[] = [];
  const rand = mulberry32(seed);
  const t = terrain.track;
  const nr: Near = { s: 0, d: 0, side: 1, y: 0 };
  for (let z = z0; z < z0 + size; z += spacing) {
    for (let x = x0; x < x0 + size; x += spacing) {
      const px = x + (rand() - 0.5) * spacing * 0.95;
      const pz = z + (rand() - 0.5) * spacing * 0.95;
      terrain.near(px, pz, nr);
      if (nr.d > 560 || nr.d < 11) continue;
      if (nr.d < 30 && t.inSpan(t.bridges, nr.s, 25)) continue;
      if (nr.d < 40 && t.stations.some((st) => nr.s > st.platformFrom - 60 && nr.s < st.platformTo + 60)) continue;
      const h = terrain.heightNear(px, pz, nr);
      if (h < LAKE_Y + 1.2) continue;
      const hx = terrain.height(px + 2.5, pz) - h;
      const hz = terrain.height(px, pz + 2.5) - h;
      const slope = 1 - 1 / Math.hypot(hx / 2.5, 1, hz / 2.5);
      const f = forestMask(terrain, px, pz, h, slope, nr.d);
      const p = f * 0.92 + (slope < 0.25 && h < 1900 ? 0.015 : 0);
      if (rand() > p) continue;
      let kind = 0;
      if (h > 1560 && rand() < 0.55) kind = 1;
      else if (h < 1330 && rand() < 0.3) kind = 2;
      const scale = 0.62 + rand() * 0.6 - (h > 1800 ? 0.2 : 0);
      out.push(px, h - 0.4, pz, scale, kind, rand() * Math.PI * 2);
    }
  }
  return Float32Array.from(out);
}
