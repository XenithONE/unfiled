// Everything built along the line: ballast, sleepers, rails, overhead line,
// tunnels, the stone viaduct, the avalanche gallery, stations, signals,
// speed boards, villages and the terminus buffer stop.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mulberry32 } from "./noise";
import type { Terrain } from "./terrain";
import { LAKE_Y, type Station, type Track } from "./track";

export const RAIL_TOP = 0.25; // rail head above the formation level y(s)

type Profile = [number, number][];

interface Frame {
  p: THREE.Vector3;
  f: THREE.Vector3;
  r: THREE.Vector3;
  cant: number;
}

export function frameAt(track: Track, s: number, out?: Frame): Frame {
  const o = out ?? { p: new THREE.Vector3(), f: new THREE.Vector3(), r: new THREE.Vector3(), cant: 0 };
  const q = track.pos(s);
  const h = track.headingAt(s);
  o.p.set(q.x, q.y, q.z);
  o.f.set(Math.cos(h), 0, Math.sin(h));
  o.r.set(-Math.sin(h), 0, Math.cos(h));
  o.cant = track.cantAt(s);
  return o;
}

/** Sweep a (lateral, up) profile along the line between s0 and s1. */
export function sweep(track: Track, s0: number, s1: number, profile: Profile, opts: { step?: number; cant?: boolean; uScale?: number; vScale?: number } = {}): THREE.BufferGeometry {
  const step = opts.step ?? 2;
  const n = Math.max(2, Math.ceil((s1 - s0) / step) + 1);
  const m = profile.length;
  const pos = new Float32Array(n * m * 3);
  const uv = new Float32Array(n * m * 2);
  const fr = frameAt(track, s0);
  const vLen: number[] = [0];
  for (let k = 1; k < m; k++) vLen.push(vLen[k - 1] + Math.hypot(profile[k][0] - profile[k - 1][0], profile[k][1] - profile[k - 1][1]));
  for (let i = 0; i < n; i++) {
    const s = s0 + ((s1 - s0) * i) / (n - 1);
    frameAt(track, s, fr);
    const c = opts.cant ? fr.cant : 0;
    const cc = Math.cos(c);
    const sc = Math.sin(c);
    for (let k = 0; k < m; k++) {
      const [l, v] = profile[k];
      const L = l * cc;
      const V = v - l * sc;
      const q = (i * m + k) * 3;
      pos[q] = fr.p.x + fr.r.x * L;
      pos[q + 1] = fr.p.y + V;
      pos[q + 2] = fr.p.z + fr.r.z * L;
      uv[(i * m + k) * 2] = s * (opts.uScale ?? 1);
      uv[(i * m + k) * 2 + 1] = vLen[k] * (opts.vScale ?? 1);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < m - 1; k++) {
      const a = i * m + k;
      const b = a + 1;
      const c = a + m;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Split [s0, s1] into pieces (for frustum culling) and sweep each. */
function sweepPieces(track: Track, s0: number, s1: number, profile: Profile, opts: Parameters<typeof sweep>[4], piece = 400): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let a = s0; a < s1 - 0.01; a += piece) out.push(sweep(track, a, Math.min(s1, a + piece), profile, opts));
  return out;
}

function addPieces(group: THREE.Group, geos: THREE.BufferGeometry[], mat: THREE.Material, shadow = { cast: false, receive: true }): void {
  for (const g of geos) {
    const m = new THREE.Mesh(g, mat);
    m.castShadow = shadow.cast;
    m.receiveShadow = shadow.receive;
    m.matrixAutoUpdate = false;
    group.add(m);
  }
}

// --------------------------------------------------------------- textures

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  draw(cv.getContext("2d")!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

function stoneTexture(base: [number, number, number], seed: number): THREE.CanvasTexture {
  const rand = mulberry32(seed);
  const t = canvasTex(512, 512, (c) => {
    c.fillStyle = `rgb(${base[0] * 0.55},${base[1] * 0.55},${base[2] * 0.55})`;
    c.fillRect(0, 0, 512, 512);
    const rows = 8;
    const rh = 512 / rows;
    for (let r = 0; r < rows; r++) {
      let x = -rand() * 80;
      while (x < 512) {
        const w = 60 + rand() * 90;
        const k = 0.75 + rand() * 0.4;
        c.fillStyle = `rgb(${base[0] * k},${base[1] * k},${base[2] * k})`;
        c.fillRect(x + 3, r * rh + 3, w - 6, rh - 6);
        // speckle
        for (let i = 0; i < 40; i++) {
          const kk = 0.8 + rand() * 0.4;
          c.fillStyle = `rgba(${base[0] * kk},${base[1] * kk},${base[2] * kk},0.5)`;
          c.fillRect(x + 3 + rand() * (w - 8), r * rh + 3 + rand() * (rh - 8), 3, 3);
        }
        x += w;
      }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Blasted rock with shotcrete patches, for tunnel walls. */
function rockWallTexture(): THREE.CanvasTexture {
  const rand = mulberry32(21);
  const t = canvasTex(256, 256, (c) => {
    c.fillStyle = "#6d6862";
    c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) {
      const k = 70 + rand() * 90;
      c.fillStyle = `rgba(${k},${k - 4},${k - 8},0.55)`;
      const w = 4 + rand() * 30;
      const h = 3 + rand() * 18;
      c.save();
      c.translate(rand() * 256, rand() * 256);
      c.rotate(rand() * Math.PI);
      c.fillRect(-w / 2, -h / 2, w, h);
      c.restore();
    }
    for (let i = 0; i < 60; i++) {
      c.fillStyle = `rgba(20,18,16,${0.1 + rand() * 0.25})`;
      c.fillRect(rand() * 256, 0, 1 + rand() * 3, 256);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function gravelTexture(): THREE.CanvasTexture {
  const rand = mulberry32(9);
  const t = canvasTex(256, 256, (c) => {
    c.fillStyle = "#5e5a55";
    c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 4200; i++) {
      const k = 60 + rand() * 90;
      c.fillStyle = `rgb(${k + 8},${k + 4},${k})`;
      const r = 1 + rand() * 2.6;
      c.beginPath();
      c.arc(rand() * 256, rand() * 256, r, 0, Math.PI * 2);
      c.fill();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function boardTexture(kmh: number, warning: boolean): THREE.CanvasTexture {
  return canvasTex(128, 128, (c) => {
    c.clearRect(0, 0, 128, 128);
    if (warning) {
      c.fillStyle = "#f2c200";
      c.beginPath();
      c.moveTo(4, 10);
      c.lineTo(124, 10);
      c.lineTo(64, 122);
      c.closePath();
      c.fill();
      c.strokeStyle = "#111";
      c.lineWidth = 5;
      c.stroke();
      c.fillStyle = "#111";
      c.font = "bold 44px Arial, sans-serif";
      c.textAlign = "center";
      c.fillText(String(kmh / 10), 64, 64);
    } else {
      c.fillStyle = "#f7f7f2";
      c.fillRect(8, 8, 112, 112);
      c.strokeStyle = "#111";
      c.lineWidth = 7;
      c.strokeRect(8, 8, 112, 112);
      c.fillStyle = "#111";
      c.font = "bold 70px Arial, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(String(kmh / 10), 64, 68);
    }
  });
}

function nameBoardTexture(st: Station): THREE.CanvasTexture {
  return canvasTex(512, 128, (c) => {
    c.fillStyle = "#1f3f8f";
    c.fillRect(0, 0, 512, 128);
    c.strokeStyle = "#ffffff";
    c.lineWidth = 6;
    c.strokeRect(6, 6, 500, 116);
    c.fillStyle = "#ffffff";
    c.font = "bold 62px 'Helvetica Neue', Arial, sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(st.name, 256, 68, 480);
  });
}

// --------------------------------------------------------------- the build

export interface Signals {
  set(stationIndex: number, green: boolean): void;
}

export interface SceneryResult {
  group: THREE.Group;
  signals: Signals;
  passengers: THREE.InstancedMesh[];
  lampMeshes: THREE.Mesh[];
}

export function buildScenery(track: Track, terrain: Terrain, exitSignalS: (i: number) => number): SceneryResult {
  const group = new THREE.Group();
  group.name = "scenery";
  const bufferEnd = track.bufferS + 6;

  const gravel = gravelTexture();
  const ballastMat = new THREE.MeshStandardMaterial({ map: gravel, roughness: 0.95, color: 0xbab3aa });
  gravel.repeat.set(1, 1);
  const railHeadMat = new THREE.MeshStandardMaterial({ color: 0xd4d6da, metalness: 0.9, roughness: 0.28 });
  const railWebMat = new THREE.MeshStandardMaterial({ color: 0x5b4032, metalness: 0.3, roughness: 0.8 });
  const stoneTex = stoneTexture([196, 186, 168], 3);
  const stone = new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.9, color: 0xffffff });
  const darkStoneTex = stoneTexture([150, 144, 136], 4);
  const concrete = new THREE.MeshStandardMaterial({ color: 0xa9a7a1, roughness: 0.88 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x6f7479, metalness: 0.6, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x222426, roughness: 0.7 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.6 });

  // ---- Ballast, sleepers, rails -------------------------------------------
  const ballastProfile: Profile = [
    [-2.55, -0.7],
    [-1.62, -0.02],
    [-1.45, 0.02],
    [1.45, 0.02],
    [1.62, -0.02],
    [2.55, -0.7],
  ];
  addPieces(group, sweepPieces(track, 0, bufferEnd, ballastProfile, { cant: true, uScale: 0.45, vScale: 0.45 }), ballastMat);

  const gauge = 1.0;
  const headW = 0.034;
  for (const side of [-1, 1]) {
    const c = side * (gauge / 2 + headW);
    const head: Profile = [
      [c - headW, RAIL_TOP - 0.045],
      [c - headW, RAIL_TOP],
      [c + headW, RAIL_TOP],
      [c + headW, RAIL_TOP - 0.045],
    ];
    const web: Profile = [
      [c - 0.075, 0.1],
      [c - 0.075, 0.115],
      [c - 0.009, 0.13],
      [c - 0.009, RAIL_TOP - 0.045],
      [c + 0.009, RAIL_TOP - 0.045],
      [c + 0.009, 0.13],
      [c + 0.075, 0.115],
      [c + 0.075, 0.1],
    ];
    addPieces(group, sweepPieces(track, 0, bufferEnd, head, { cant: true, step: 2 }), railHeadMat, { cast: false, receive: true });
    addPieces(group, sweepPieces(track, 0, bufferEnd, web, { cant: true, step: 2 }), railWebMat);
  }

  // Concrete sleepers, instanced in 400 m pieces.
  const sleeperGeo = new THREE.BoxGeometry(0.24, 0.14, 1.9);
  sleeperGeo.translate(0, 0.05, 0);
  const sleeperMat = new THREE.MeshStandardMaterial({ color: 0x9d9a94, roughness: 0.85 });
  const fr = frameAt(track, 0);
  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpE = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  const spacing = 0.65;
  for (let a = 0; a < bufferEnd; a += 400) {
    const b = Math.min(bufferEnd, a + 400);
    const count = Math.floor((b - a) / spacing);
    const im = new THREE.InstancedMesh(sleeperGeo, sleeperMat, count);
    for (let i = 0; i < count; i++) {
      const s = a + i * spacing;
      frameAt(track, s, fr);
      tmpE.set(0, -track.headingAt(s), 0);
      tmpQ.setFromEuler(tmpE);
      const roll = new THREE.Quaternion().setFromAxisAngle(fr.f, fr.cant);
      tmpQ.premultiply(roll);
      tmpM.compose(fr.p, tmpQ, one);
      im.setMatrixAt(i, tmpM);
    }
    im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  }

  // ---- Overhead line --------------------------------------------------------
  const wireY = RAIL_TOP + 5.1;
  const mastGeo = buildMastGeometry(wireY);
  const mastPositions: number[] = [];
  for (let s = 20; s < track.bufferS - 10; s += 52) {
    if (track.inSpan(track.tunnels, s, 4)) continue;
    mastPositions.push(s);
  }
  const masts = new THREE.InstancedMesh(mastGeo, steel, mastPositions.length);
  mastPositions.forEach((s, i) => {
    frameAt(track, s, fr);
    const side = track.inSpan(track.galleries, s, 2) ? 1 : -1;
    const p = fr.p.clone().addScaledVector(fr.r, side * 3.15);
    tmpQ.setFromEuler(new THREE.Euler(0, -track.headingAt(s) + (side > 0 ? Math.PI : 0), 0));
    tmpM.compose(p, tmpQ, one);
    masts.setMatrixAt(i, tmpM);
  });
  masts.castShadow = true;
  masts.computeBoundingSphere();
  group.add(masts);
  // Contact and messenger wires as lines (with zig-zag and sag).
  const wirePts: number[] = [];
  const messPts: number[] = [];
  const dropPts: number[] = [];
  let prev: THREE.Vector3 | null = null;
  let prevM: THREE.Vector3 | null = null;
  for (let s = 0; s <= track.bufferS; s += 4) {
    frameAt(track, s, fr);
    const zig = Math.sin((s / 52) * Math.PI) * 0.2;
    const p = fr.p.clone().addScaledVector(fr.r, zig);
    p.y += wireY;
    const inTunnel = track.inSpan(track.tunnels, s);
    const phase = (((s - 20) % 52) + 52) % 52 / 52;
    const sag = inTunnel ? 0.15 : 1.05 - 4 * 0.85 * phase * (1 - phase);
    const pm = fr.p.clone();
    pm.y += wireY + (inTunnel ? 0.35 : 0.2 + sag);
    if (prev) wirePts.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
    if (prevM) messPts.push(prevM.x, prevM.y, prevM.z, pm.x, pm.y, pm.z);
    if (s % 8 === 0) dropPts.push(p.x, p.y, p.z, pm.x, pm.y, pm.z);
    prev = p;
    prevM = pm;
  }
  const lineMat = new THREE.LineBasicMaterial({ color: 0x3a3a38 });
  for (const pts of [wirePts, messPts, dropPts]) {
    // Split into pieces for culling.
    const per = 600;
    for (let i = 0; i < pts.length; i += per) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts.slice(i, i + per), 3));
      const l = new THREE.LineSegments(g, lineMat);
      l.matrixAutoUpdate = false;
      group.add(l);
    }
  }

  // ---- Tunnels ---------------------------------------------------------------
  const arch: Profile = [];
  const tw = 2.75;
  const springY = 3.4;
  arch.push([tw, -0.6], [tw, springY]);
  for (let k = 1; k < 12; k++) {
    const a = (k / 12) * Math.PI;
    arch.push([Math.cos(a) * tw, springY + Math.sin(a) * 2.9]);
  }
  arch.push([-tw, springY], [-tw, -0.6]);
  const lamps: THREE.Mesh[] = [];
  const rockTex = rockWallTexture();
  const tunnelMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, map: rockTex });
  for (const tn of track.tunnels) {
    const g = sweep(track, tn.from - 0.8, tn.to + 0.8, arch, { step: 2, uScale: 0.25, vScale: 0.25 });
    // Vertex colours: dark rock with pools of light from the lamps.
    const pos = g.getAttribute("position");
    const col = new Float32Array(pos.count * 3);
    const m = arch.length;
    const rand = mulberry32(tn.from);
    for (let i = 0; i < pos.count; i++) {
      const ring = Math.floor(i / m);
      const s = tn.from - 0.8 + ring * 2;
      const k = i % m;
      const lampPhase = ((s - tn.from) % 36) / 36;
      const pool = Math.exp(-Math.pow((lampPhase - 0.5) * 7, 2)) * (k < 3 ? 1 : 0.55);
      const base = 0.018 + rand() * 0.012;
      const v = base + pool * 0.07;
      col[i * 3] = v * 1.05;
      col[i * 3 + 1] = v;
      col[i * 3 + 2] = v * 0.92;
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const tube = new THREE.Mesh(g, tunnelMat);
    tube.matrixAutoUpdate = false;
    group.add(tube);
    // Floor under the ballast so nothing shows through at the wall foot.
    const floor = sweep(track, tn.from - 0.8, tn.to + 0.8, [[-2.8, -0.55], [2.8, -0.55]], { step: 4 });
    const fm = new THREE.Mesh(floor, new THREE.MeshBasicMaterial({ color: 0x0c0b0a }));
    fm.matrixAutoUpdate = false;
    group.add(fm);
    // Lamps.
    const lampGeo = new THREE.BoxGeometry(0.5, 0.18, 0.12);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe2a8 });
    for (let s = tn.from + 18; s < tn.to - 5; s += 36) {
      frameAt(track, s, fr);
      const l = new THREE.Mesh(lampGeo, lampMat);
      l.position.copy(fr.p).addScaledVector(fr.r, 2.6);
      l.position.y += 3.2;
      l.rotation.y = -track.headingAt(s);
      group.add(l);
      lamps.push(l);
    }
    // Portals.
    for (const [s, dir] of [[tn.from, 1], [tn.to, -1]] as const) group.add(buildPortal(track, s, dir, stone));
  }

  // ---- Viaduct ---------------------------------------------------------------
  for (const br of track.bridges) group.add(buildViaduct(track, terrain, br.from, br.to, stone, stoneTex));

  // ---- Avalanche gallery ---------------------------------------------------
  for (const ga of track.galleries) {
    const roof: Profile = [
      [-4.2, 7.3],
      [4.4, 7.0],
      [4.4, 6.3],
      [-4.2, 6.3],
      [-4.2, 7.3],
    ];
    const wall: Profile = [
      [-3.7, -0.6],
      [-3.7, 6.3],
      [-4.4, 6.3],
      [-4.4, -0.6],
    ];
    const gm = new THREE.MeshStandardMaterial({ color: 0xb2ada4, roughness: 0.9, map: stoneTex });
    addPieces(group, [sweep(track, ga.from, ga.to, roof, { step: 3, uScale: 0.2, vScale: 0.2 })], gm, { cast: true, receive: true });
    addPieces(group, [sweep(track, ga.from, ga.to, wall, { step: 3, uScale: 0.25, vScale: 0.25 })], gm, { cast: true, receive: true });
    const pillar = new THREE.BoxGeometry(0.9, 6.9, 0.7);
    pillar.translate(0, 6.9 / 2 - 0.6, 0);
    const n = Math.floor((ga.to - ga.from) / 6) + 1;
    const pm = new THREE.InstancedMesh(pillar, new THREE.MeshStandardMaterial({ color: 0x8f8b84, roughness: 0.92, map: darkStoneTex }), n);
    for (let i = 0; i < n; i++) {
      const s = ga.from + i * 6;
      frameAt(track, s, fr);
      tmpQ.setFromEuler(new THREE.Euler(0, -track.headingAt(s), 0));
      tmpM.compose(fr.p.clone().addScaledVector(fr.r, 4.0), tmpQ, one);
      pm.setMatrixAt(i, tmpM);
    }
    pm.castShadow = true;
    pm.computeBoundingSphere();
    group.add(pm);
  }

  // ---- Speed boards and kilometre posts -------------------------------------
  const boardCache = new Map<string, THREE.MeshStandardMaterial>();
  const boardGeo = new THREE.PlaneGeometry(0.85, 0.85);
  const postGeo = new THREE.CylinderGeometry(0.045, 0.045, 2.6, 6);
  postGeo.translate(0, 1.3, 0);
  for (const sg of track.signs) {
    const k = `${sg.kmh}-${sg.warning}`;
    if (!boardCache.has(k)) boardCache.set(k, new THREE.MeshStandardMaterial({ map: boardTexture(sg.kmh, sg.warning), transparent: true, alphaTest: 0.5, roughness: 0.6 }));
    frameAt(track, sg.s, fr);
    const base = fr.p.clone().addScaledVector(fr.r, 2.75);
    const post = new THREE.Mesh(postGeo, steel);
    post.position.copy(base);
    group.add(post);
    const b = new THREE.Mesh(boardGeo, boardCache.get(k)!);
    b.position.copy(base);
    b.position.y += 2.35;
    b.rotation.y = -track.headingAt(sg.s) - Math.PI / 2;
    b.userData.kmh = sg.kmh;
    group.add(b);
  }
  const kmTex = new Map<number, THREE.MeshStandardMaterial>();
  for (let km = 1; km * 1000 < track.bufferS; km++) {
    const s = km * 1000;
    frameAt(track, s, fr);
    const m = new THREE.MeshStandardMaterial({
      map: canvasTex(64, 128, (c) => {
        c.fillStyle = "#f4f4ef";
        c.fillRect(0, 0, 64, 128);
        c.fillStyle = "#111";
        c.font = "bold 44px Arial";
        c.textAlign = "center";
        c.fillText(String(km), 32, 70);
      }),
    });
    kmTex.set(km, m);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.1, 0.3), [white, white, white, white, m, m]);
    post.position.copy(fr.p).addScaledVector(fr.r, -3.0);
    post.position.y += 0.35;
    post.rotation.y = -track.headingAt(s);
    group.add(post);
  }

  // ---- Stations --------------------------------------------------------------
  const signalHeads: { red: THREE.Mesh; green: THREE.Mesh }[] = [];
  const passengers: THREE.InstancedMesh[] = [];
  const redOn = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
  const greenOn = new THREE.MeshBasicMaterial({ color: 0x3dff7a });
  const lampOff = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.3 });
  track.stations.forEach((st, si) => {
    const sd = st.side;
    const platform: Profile = sd < 0
      ? [[-5.9, -0.8], [-5.9, 0.62], [-1.72, 0.62], [-1.72, -0.2]]
      : [[1.72, -0.2], [1.72, 0.62], [5.9, 0.62], [5.9, -0.8]];
    addPieces(group, [sweep(track, st.platformFrom, st.platformTo, platform, { step: 3, uScale: 0.3, vScale: 0.3 })], concrete, { cast: true, receive: true });
    const edge: Profile = sd < 0 ? [[-2.05, 0.625], [-1.75, 0.625]] : [[1.75, 0.625], [2.05, 0.625]];
    addPieces(group, [sweep(track, st.platformFrom + 1, st.platformTo - 1, edge, { step: 3 })], white);
    const mid = (st.platformFrom + st.platformTo) / 2;
    // Station building: a chalet with a stone ground floor.
    frameAt(track, mid - 20, fr);
    const bpos = fr.p.clone().addScaledVector(fr.r, sd * 11.5);
    bpos.y += 0.1;
    const bld = buildChalet(14, 8, 2, 3, "#d8cdb8", "#7b4a2a", "#4d4a48");
    bld.position.copy(bpos);
    bld.rotation.y = -track.headingAt(mid - 20) + (sd < 0 ? Math.PI : 0);
    group.add(bld);
    // Name boards on the building and along the platform.
    const nameMat = new THREE.MeshStandardMaterial({ map: nameBoardTexture(st), roughness: 0.5 });
    const nameGeo = new THREE.PlaneGeometry(2.6, 0.65);
    for (let s = st.platformFrom + 18; s < st.platformTo - 10; s += 55) {
      frameAt(track, s, fr);
      const base = fr.p.clone().addScaledVector(fr.r, sd * 4.6);
      base.y += 0.62;
      for (const dx of [-1.1, 1.1]) {
        const post = new THREE.Mesh(postGeo, steel);
        post.position.copy(base).addScaledVector(fr.f, dx);
        post.scale.y = 0.95;
        group.add(post);
      }
      const b = new THREE.Mesh(nameGeo, nameMat);
      b.position.copy(base);
      b.position.y += 2.1;
      b.rotation.y = -track.headingAt(s) + (sd < 0 ? 0 : Math.PI);
      group.add(b);
      const b2 = b.clone();
      b2.rotation.y += Math.PI;
      group.add(b2);
    }
    // Shelter with benches.
    frameAt(track, mid + 25, fr);
    const shelter = buildShelter(dark, white);
    shelter.position.copy(fr.p).addScaledVector(fr.r, sd * 4.4);
    shelter.position.y += 0.62;
    shelter.rotation.y = -track.headingAt(mid + 25) + (sd < 0 ? Math.PI : 0);
    group.add(shelter);
    // Platform lamps.
    const lampPost = new THREE.CylinderGeometry(0.05, 0.07, 4.2, 6);
    lampPost.translate(0, 2.1, 0);
    for (let s = st.platformFrom + 8; s < st.platformTo; s += 24) {
      frameAt(track, s, fr);
      const l = new THREE.Mesh(lampPost, dark);
      l.position.copy(fr.p).addScaledVector(fr.r, sd * 5.3);
      l.position.y += 0.62;
      group.add(l);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.28), dark);
      head.position.copy(l.position).addScaledVector(fr.r, -sd * 0.3);
      head.position.y += 4.2;
      head.rotation.y = -track.headingAt(s);
      group.add(head);
    }
    // Stop marker ("H") at the stopping point.
    frameAt(track, st.stopS, fr);
    const hMat = new THREE.MeshStandardMaterial({
      map: canvasTex(128, 160, (c) => {
        c.fillStyle = "#f4f4ef";
        c.fillRect(0, 0, 128, 160);
        c.strokeStyle = "#111";
        c.lineWidth = 8;
        c.strokeRect(6, 6, 116, 148);
        c.fillStyle = "#111";
        c.font = "bold 100px Arial";
        c.textAlign = "center";
        c.fillText("H", 64, 118);
      }),
    });
    const hb = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.75), hMat);
    hb.position.copy(fr.p).addScaledVector(fr.r, 2.4);
    hb.position.y += 1.9;
    hb.rotation.y = -track.headingAt(st.stopS) - Math.PI / 2;
    group.add(hb);
    const hp = new THREE.Mesh(postGeo, steel);
    hp.position.copy(fr.p).addScaledVector(fr.r, 2.4);
    hp.scale.y = 0.62;
    group.add(hp);
    // Exit signal.
    const ss = exitSignalS(si);
    if (si < track.stations.length - 1) {
      frameAt(track, ss, fr);
      const sig = new THREE.Group();
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 4.6, 8), dark);
      mast.position.y = 2.3;
      sig.add(mast);
      const headG = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.1, 0.25), dark);
      headG.position.set(0, 4.3, 0);
      sig.add(headG);
      const lens = new THREE.CircleGeometry(0.13, 16);
      const red = new THREE.Mesh(lens, redOn);
      red.position.set(0, 4.55, -0.13);
      red.rotation.y = Math.PI;
      const green = new THREE.Mesh(lens, lampOff);
      green.position.set(0, 4.05, -0.13);
      green.rotation.y = Math.PI;
      sig.add(red, green);
      sig.position.copy(fr.p).addScaledVector(fr.r, 2.7);
      // Local +z along the line, lenses on -z facing the approaching train.
      sig.rotation.set(0, Math.atan2(fr.f.x, fr.f.z), 0);
      group.add(sig);
      signalHeads[si] = { red, green };
    }
    // Waiting passengers.
    const rand = mulberry32(si * 97 + 3);
    const nP = st.id === "glatscher" ? 0 : 7 + Math.floor(rand() * 7);
    if (nP > 0) {
      const body = new THREE.CapsuleGeometry(0.22, 1.05, 3, 8);
      body.translate(0, 0.75, 0);
      const pm = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ roughness: 0.8 }), nP);
      const col = new THREE.Color();
      const palette = ["#b83a2e", "#2e5fa8", "#e0b23a", "#3b7a4a", "#6b4c8a", "#d9d3c7", "#303338", "#c46a2c"];
      for (let i = 0; i < nP; i++) {
        const s = st.stopS - 10 - rand() * 70;
        frameAt(track, s, fr);
        const p = fr.p.clone().addScaledVector(fr.r, sd * (2.6 + rand() * 2.4));
        p.y += 0.62;
        tmpM.compose(p, tmpQ.identity(), new THREE.Vector3(1, 0.85 + rand() * 0.3, 1));
        pm.setMatrixAt(i, tmpM);
        pm.setColorAt(i, col.set(palette[Math.floor(rand() * palette.length)]));
      }
      pm.castShadow = true;
      pm.computeBoundingSphere();
      group.add(pm);
      passengers[si] = pm;
    }
  });

  // ---- Villages and alpine huts -----------------------------------------------
  group.add(buildVillages(track, terrain));

  // ---- Buffer stop -------------------------------------------------------------
  frameAt(track, track.bufferS, fr);
  const buf = new THREE.Group();
  const beam = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.45, 0.4), new THREE.MeshStandardMaterial({ color: 0xc8261e }));
  beam.position.y = 1.2;
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.46, 0.41), white);
  stripe.position.y = 1.2;
  const frameL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.3, 1.6), steel);
  frameL.position.set(-0.6, 0.6, -0.5);
  const frameR = frameL.clone();
  frameR.position.x = 0.6;
  buf.add(beam, stripe, frameL, frameR);
  buf.position.copy(fr.p);
  buf.rotation.y = -track.headingAt(track.bufferS) + Math.PI / 2;
  group.add(buf);

  return {
    group,
    signals: {
      set(i: number, green: boolean) {
        const h = signalHeads[i];
        if (!h) return;
        h.red.material = green ? lampOff : redOn;
        h.green.material = green ? greenOn : lampOff;
      },
    },
    passengers,
    lampMeshes: lamps,
  };
}

// ---------------------------------------------------------------- pieces

function buildMastGeometry(wireY: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const h = wireY + 1.9;
  const mast = new THREE.BoxGeometry(0.22, h, 0.26);
  mast.translate(0, h / 2 - 0.4, 0);
  parts.push(mast);
  // Cantilever to over the track (local +x points at the track).
  const arm = new THREE.CylinderGeometry(0.04, 0.04, 3.4, 6);
  arm.rotateZ(Math.PI / 2);
  arm.translate(1.6, wireY + 1.25, 0);
  parts.push(arm);
  const brace = new THREE.CylinderGeometry(0.035, 0.035, 3.6, 6);
  brace.rotateZ(Math.PI / 2 + 0.33);
  brace.translate(1.55, wireY + 0.65, 0);
  parts.push(brace);
  const ins = new THREE.CylinderGeometry(0.06, 0.06, 0.4, 8);
  ins.rotateZ(Math.PI / 2);
  ins.translate(0.35, wireY + 1.25, 0);
  parts.push(ins);
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  // Instances are rotated by -heading, so local +x runs along the line and
  // local +z points to its right: turn the arm (built along +x) onto +z.
  g.rotateY(-Math.PI / 2);
  return g;
}

function buildPortal(track: Track, s: number, dir: 1 | -1, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const w = 9.5;
  const hgt = 13.5;
  const shape = new THREE.Shape();
  shape.moveTo(-w, -1.5);
  shape.lineTo(w, -1.5);
  shape.lineTo(w, hgt);
  shape.lineTo(-w, hgt);
  shape.closePath();
  const hole = new THREE.Path();
  const tw = 2.75;
  hole.moveTo(-tw, -0.6);
  hole.lineTo(tw, -0.6);
  hole.lineTo(tw, 3.4);
  hole.absarc(0, 3.4, tw, 0, Math.PI, false);
  hole.lineTo(-tw, -0.6);
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 2.2, bevelEnabled: false });
  const uvs = geo.getAttribute("uv");
  for (let i = 0; i < uvs.count; i++) uvs.setXY(i, uvs.getX(i) * 0.25, uvs.getY(i) * 0.25);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  const fr = frameAt(track, s);
  // Shape x = lateral (right), y = up, extrude z = along the track.
  const basis = new THREE.Matrix4().makeBasis(fr.r, new THREE.Vector3(0, 1, 0), fr.f);
  m.applyMatrix4(basis);
  m.position.copy(fr.p).addScaledVector(fr.f, dir > 0 ? -0.2 : -2.0);
  g.add(m);
  // Cornice.
  const cap = new THREE.Mesh(new THREE.BoxGeometry(2 * w + 0.8, 0.6, 2.8), mat);
  cap.applyMatrix4(basis);
  cap.position.copy(fr.p).addScaledVector(fr.f, dir > 0 ? 0.9 : -0.9);
  cap.position.y += hgt;
  g.add(cap);
  return g;
}

function buildViaduct(track: Track, terrain: Terrain, from: number, to: number, mat: THREE.Material, tex: THREE.Texture): THREE.Group {
  const g = new THREE.Group();
  const len = to - from;
  const spans = Math.max(3, Math.round(len / 19));
  const L = len / spans;
  const pier = 2.6; // pier thickness along the track
  const r = (L - pier) / 2;
  const deckW = 5.4;
  void tex;
  for (let i = 0; i < spans; i++) {
    const sm = from + (i + 0.5) * L;
    const fr = frameAt(track, sm);
    const deckY = fr.p.y - 0.62;
    const springRel = -1.3 - r; // arch springing below the deck
    const shape = new THREE.Shape();
    const hl = L / 2 + 0.25;
    shape.moveTo(-hl, springRel - 0.01);
    shape.lineTo(-r, springRel - 0.01);
    shape.absarc(0, springRel, r, Math.PI, 0, true);
    shape.lineTo(hl, springRel - 0.01);
    shape.lineTo(hl, 0);
    shape.lineTo(-hl, 0);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: deckW, bevelEnabled: false, curveSegments: 18 });
    geo.translate(0, 0, -deckW / 2);
    const uvs = geo.getAttribute("uv");
    for (let k = 0; k < uvs.count; k++) uvs.setXY(k, uvs.getX(k) * 0.28, uvs.getY(k) * 0.28);
    const m = new THREE.Mesh(geo, mat);
    // Shape x = along track, y = up, z = across.
    const basis = new THREE.Matrix4().makeBasis(fr.f, new THREE.Vector3(0, 1, 0), fr.r.clone().negate());
    m.applyMatrix4(basis);
    m.position.set(fr.p.x, deckY, fr.p.z);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    // Piers at every span boundary, abutments included.
    const pierSs = i === 0 ? [from, from + L] : [from + (i + 1) * L];
    for (const ps of pierSs) {
      const pf = frameAt(track, ps);
      const top = pf.p.y - 0.62 + springRel + 0.5;
      let ground = Infinity;
      for (const dl of [-3, 0, 3]) for (const da of [-1.5, 1.5]) {
        const x = pf.p.x + pf.r.x * dl + pf.f.x * da;
        const z = pf.p.z + pf.r.z * dl + pf.f.z * da;
        ground = Math.min(ground, terrain.height(x, z));
      }
      const bottom = ground - 4;
      const hgt = top - bottom;
      if (hgt < 1) continue;
      const taper = Math.min(1.6, hgt * 0.03);
      const pg = new THREE.BoxGeometry(pier, hgt, deckW - 0.3, 1, 4, 1);
      const pp = pg.getAttribute("position");
      for (let k = 0; k < pp.count; k++) {
        const y = pp.getY(k);
        const t = 0.5 - y / hgt; // 0 top .. 1 bottom
        pp.setX(k, pp.getX(k) * (1 + t * taper * 0.5));
        pp.setZ(k, pp.getZ(k) * (1 + t * taper * 0.35));
      }
      pg.computeVertexNormals();
      const puv = pg.getAttribute("uv");
      for (let k = 0; k < puv.count; k++) puv.setXY(k, puv.getX(k) * 1.2, puv.getY(k) * hgt * 0.28);
      const pm = new THREE.Mesh(pg, mat);
      pm.applyMatrix4(new THREE.Matrix4().makeBasis(pf.f, new THREE.Vector3(0, 1, 0), pf.r.clone().negate()));
      pm.position.set(pf.p.x, bottom + hgt / 2, pf.p.z);
      pm.castShadow = true;
      pm.receiveShadow = true;
      g.add(pm);
    }
  }
  // Parapets follow the curve exactly.
  for (const sd of [-1, 1]) {
    const par: Profile = sd < 0
      ? [[-2.75, -0.7], [-2.75, 0.95], [-2.4, 0.95], [-2.4, 0.1]]
      : [[2.4, 0.1], [2.4, 0.95], [2.75, 0.95], [2.75, -0.7]];
    const pg = sweep(track, from - 1, to + 1, par, { step: 1.5, uScale: 0.28, vScale: 0.28 });
    const pm = new THREE.Mesh(pg, mat);
    pm.castShadow = true;
    pm.receiveShadow = true;
    g.add(pm);
  }
  return g;
}

function buildShelter(dark: THREE.Material, white: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const roof = new THREE.Mesh(new THREE.BoxGeometry(8, 0.18, 2.6), dark);
  roof.position.y = 2.7;
  roof.rotation.x = 0.06;
  g.add(roof);
  for (const x of [-3.6, 0, 3.6]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.7, 6), dark);
    p.position.set(x, 1.35, 0.9);
    g.add(p);
  }
  const back = new THREE.Mesh(new THREE.BoxGeometry(8, 2.2, 0.06), new THREE.MeshStandardMaterial({ color: 0x9fb4bf, transparent: true, opacity: 0.35, roughness: 0.1 }));
  back.position.set(0, 1.4, 1.2);
  g.add(back);
  const bench = new THREE.Mesh(new THREE.BoxGeometry(3, 0.08, 0.45), new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.8 }));
  bench.position.set(-1.5, 0.45, 0.8);
  g.add(bench);
  const bench2 = bench.clone();
  bench2.position.x = 1.8;
  g.add(bench2);
  void white;
  g.traverse((o) => {
    o.castShadow = true;
  });
  return g;
}

/** A Swiss chalet: plastered stone base, dark timber upper floors, wide eaves. */
export function buildChalet(w: number, d: number, floorsWood: number, seed: number, plaster: string, timber: string, roofCol: string): THREE.Group {
  const g = new THREE.Group();
  const rand = mulberry32(seed);
  const baseH = 2.8;
  const woodH = 2.6 * floorsWood;
  const base = new THREE.Mesh(new THREE.BoxGeometry(w, baseH + 2, d), new THREE.MeshStandardMaterial({ color: plaster, roughness: 0.9 }));
  base.position.y = baseH / 2 - 1;
  g.add(base);
  const woodMat = new THREE.MeshStandardMaterial({ color: timber, roughness: 0.85 });
  const wood = new THREE.Mesh(new THREE.BoxGeometry(w, woodH, d), woodMat);
  wood.position.y = baseH + woodH / 2;
  g.add(wood);
  // Gable roof along the width, ridge along x.
  const pitch = 0.45;
  const rise = (d / 2 + 1.2) * pitch;
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-(d / 2 + 1.3), -0.25);
  roofShape.lineTo(0, rise);
  roofShape.lineTo(d / 2 + 1.3, -0.25);
  roofShape.lineTo(d / 2 + 1.3, 0.05);
  roofShape.lineTo(0, rise + 0.32);
  roofShape.lineTo(-(d / 2 + 1.3), 0.05);
  roofShape.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: w + 2.2, bevelEnabled: false });
  roofGeo.translate(0, 0, -(w + 2.2) / 2);
  roofGeo.rotateY(Math.PI / 2);
  const roof = new THREE.Mesh(roofGeo, new THREE.MeshStandardMaterial({ color: roofCol, roughness: 0.75 }));
  roof.position.y = baseH + woodH;
  g.add(roof);
  // Gable wall triangles.
  const gable = new THREE.Shape();
  gable.moveTo(-d / 2, 0);
  gable.lineTo(d / 2, 0);
  gable.lineTo(0, (d / 2) * pitch * 1.05);
  gable.closePath();
  const gg = new THREE.ShapeGeometry(gable);
  for (const sx of [-1, 1]) {
    const gm = new THREE.Mesh(gg, woodMat);
    gm.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
    gm.position.set((sx * w) / 2, baseH + woodH, 0);
    g.add(gm);
  }
  // Windows with white frames and red flower boxes.
  const winMat = new THREE.MeshStandardMaterial({ color: 0x1b2229, roughness: 0.15, metalness: 0.4 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xf0ede5, roughness: 0.7 });
  const flowerMat = new THREE.MeshStandardMaterial({ color: 0xc9262a, roughness: 0.8 });
  const nx = Math.max(2, Math.floor(w / 3.2));
  for (let f = 0; f < floorsWood + 1; f++) {
    const y = f === 0 ? 1.4 : baseH + 1.3 + (f - 1) * 2.6;
    for (let i = 0; i < nx; i++) {
      const x = -w / 2 + ((i + 0.5) * w) / nx;
      for (const sz of [-1, 1]) {
        const fr = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.35, 0.08), frameMat);
        fr.position.set(x, y, (sz * d) / 2 + sz * 0.03);
        g.add(fr);
        const wn = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.1, 0.1), winMat);
        wn.position.set(x, y, (sz * d) / 2 + sz * 0.04);
        g.add(wn);
        if (f > 0 && rand() < 0.7) {
          const fb = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.25, 0.3), flowerMat);
          fb.position.set(x, y - 0.75, (sz * d) / 2 + sz * 0.18);
          g.add(fb);
        }
      }
    }
  }
  // Balcony on one long side.
  if (floorsWood > 0) {
    const bal = new THREE.Mesh(new THREE.BoxGeometry(w * 0.85, 0.9, 1.1), woodMat);
    bal.position.set(0, baseH + 0.45, d / 2 + 0.55);
    g.add(bal);
  }
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return g;
}

function mergedChalet(w: number, d: number, floors: number, seed: number, plaster: string, timber: string, roof: string): THREE.BufferGeometry {
  const grp = buildChalet(w, d, floors, seed, plaster, timber, roof);
  const geos: THREE.BufferGeometry[] = [];
  grp.updateMatrixWorld(true);
  grp.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld).toNonIndexed();
    g.deleteAttribute("uv");
    const c = (m.material as THREE.MeshStandardMaterial).color;
    const col = new Float32Array(g.getAttribute("position").count * 3);
    for (let i = 0; i < col.length; i += 3) {
      col[i] = c.r;
      col[i + 1] = c.g;
      col[i + 2] = c.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geos.push(g);
  });
  return mergeGeometries(geos)!;
}

function buildChurch(): THREE.Group {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf1ede4, roughness: 0.9 });
  const roofM = new THREE.MeshStandardMaterial({ color: 0x4a4644, roughness: 0.7 });
  const nave = new THREE.Mesh(new THREE.BoxGeometry(18, 9, 10), white);
  nave.position.y = 3.5;
  g.add(nave);
  const rs = new THREE.Shape();
  rs.moveTo(-5.8, 0);
  rs.lineTo(0, 4.4);
  rs.lineTo(5.8, 0);
  rs.closePath();
  const rg = new THREE.ExtrudeGeometry(rs, { depth: 19, bevelEnabled: false });
  rg.translate(0, 0, -9.5);
  rg.rotateY(Math.PI / 2);
  const roof = new THREE.Mesh(rg, roofM);
  roof.position.y = 8;
  g.add(roof);
  const tower = new THREE.Mesh(new THREE.BoxGeometry(4.2, 22, 4.2), white);
  tower.position.set(-10.5, 10, 0);
  g.add(tower);
  const spire = new THREE.Mesh(new THREE.ConeGeometry(3.1, 11, 4), roofM);
  spire.rotation.y = Math.PI / 4;
  spire.position.set(-10.5, 26.5, 0);
  g.add(spire);
  const clock = new THREE.Mesh(new THREE.CircleGeometry(0.9, 24), new THREE.MeshStandardMaterial({ color: 0x222222 }));
  clock.position.set(-10.5, 17.5, 2.12);
  g.add(clock);
  g.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return g;
}

function buildVillages(track: Track, terrain: Terrain): THREE.Group {
  const g = new THREE.Group();
  const variants = [
    mergedChalet(11, 8, 2, 1, "#e6ded0", "#6e4126", "#4b4744"),
    mergedChalet(9, 7, 1, 2, "#d9cfbe", "#80502e", "#5a3a2a"),
    mergedChalet(13, 9, 2, 3, "#ece6da", "#5c3720", "#44423f"),
    mergedChalet(6, 5, 1, 4, "#8a6848", "#5a3a22", "#4a4540"), // hay barn
  ];
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  const placed: { x: number; z: number; y: number; rot: number; v: number }[] = [];
  const rand = mulberry32(4242);
  const nr = { s: 0, d: 0, side: 1, y: 0 };
  const tryPlace = (x: number, z: number, v: number, minD: number): boolean => {
    terrain.near(x, z, nr);
    if (nr.d < minD) return false;
    if (track.inSpan(track.tunnels, nr.s, 60) || track.inSpan(track.bridges, nr.s, 60)) return false;
    const h = terrain.height(x, z);
    if (h < LAKE_Y + 1.5) return false;
    const hx = terrain.height(x + 6, z) - terrain.height(x - 6, z);
    const hz = terrain.height(x, z + 6) - terrain.height(x, z - 6);
    const slope = Math.hypot(hx, hz) / 12;
    if (slope > 0.32) return false;
    for (const p of placed) if (Math.hypot(p.x - x, p.z - z) < 22) return false;
    // Ridge across the slope, face the valley.
    const rot = Math.atan2(hz, hx) + Math.PI / 2 + (rand() - 0.5) * 0.3;
    placed.push({ x, z, y: h - 0.4 - slope * 4, rot, v });
    return true;
  };
  track.stations.forEach((st, si) => {
    if (!st.village) return;
    const p = track.pos((st.platformFrom + st.platformTo) / 2);
    const count = si === 0 ? 26 : si === 1 ? 34 : 20;
    let tries = 0;
    let made = 0;
    while (made < count && tries < 900) {
      tries++;
      const a = rand() * Math.PI * 2;
      const r = 30 + Math.pow(rand(), 0.8) * 330;
      if (tryPlace(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, Math.floor(rand() * 3), 20)) made++;
    }
    if (si === 1) {
      // The village church stands on a knoll above the station.
      for (let k = 0; k < 200; k++) {
        const a = rand() * Math.PI * 2;
        const r = 90 + rand() * 120;
        const x = p.x + Math.cos(a) * r;
        const z = p.z + Math.sin(a) * r;
        terrain.near(x, z, nr);
        if (nr.d < 45 || nr.side > 0) continue;
        const ch = buildChurch();
        ch.position.set(x, terrain.height(x, z) - 1, z);
        ch.rotation.y = -track.headingAt(nr.s);
        g.add(ch);
        break;
      }
    }
  });
  // Scattered barns and summer huts on the meadows.
  let barns = 0;
  for (let k = 0; k < 4000 && barns < 90; k++) {
    const s = rand() * track.length;
    const fr = frameAt(track, s);
    const side = rand() < 0.5 ? -1 : 1;
    const dist = 40 + rand() * 520;
    const x = fr.p.x + fr.r.x * dist * side;
    const z = fr.p.z + fr.r.z * dist * side;
    if (tryPlace(x, z, 3, 35)) barns++;
  }
  const byV: typeof placed[] = [[], [], [], []];
  for (const p of placed) byV[p.v].push(p);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  byV.forEach((list, v) => {
    if (list.length === 0) return;
    const im = new THREE.InstancedMesh(variants[v], mat, list.length);
    list.forEach((p, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot);
      m4.compose(new THREE.Vector3(p.x, p.y, p.z), q, one);
      im.setMatrixAt(i, m4);
    });
    im.castShadow = true;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    g.add(im);
  });
  return g;
}
