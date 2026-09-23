// Low-poly alpine trees for instancing: a Norway spruce, a larch and a
// broadleaf for the lakeside, all with baked vertex colours (darker inside
// and at the base of each whorl).

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mulberry32 } from "./noise";

function colored(g: THREE.BufferGeometry, top: THREE.Color, bottom: THREE.Color, y0: number, y1: number): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  const pos = ng.getAttribute("position");
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (pos.getY(i) - y0) / (y1 - y0)));
    c.copy(bottom).lerp(top, t);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  ng.setAttribute("color", new THREE.BufferAttribute(col, 3));
  ng.deleteAttribute("uv");
  return ng;
}

function conifer(tiers: number, height: number, radius: number, top: string, bottom: string, seed: number): THREE.BufferGeometry {
  const rand = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.18, 0.3, height * 0.3, 5);
  trunk.translate(0, height * 0.15, 0);
  parts.push(colored(trunk, new THREE.Color("#4a3526"), new THREE.Color("#3a2a1e"), 0, height * 0.3));
  const crownBase = height * 0.14;
  const tierH = ((height - crownBase) / tiers) * 1.7;
  for (let i = 0; i < tiers; i++) {
    const f = i / (tiers - 1);
    const r = radius * (1 - f * 0.85) * (0.9 + rand() * 0.2);
    const y0 = crownBase + (height - crownBase - tierH) * f;
    const cone = new THREE.ConeGeometry(r, tierH, 7, 1, true);
    cone.rotateY(rand() * Math.PI);
    cone.translate(0, y0 + tierH / 2, 0);
    // Droop the rim a little.
    const p = cone.getAttribute("position");
    for (let k = 0; k < p.count; k++) if (p.getY(k) < y0 + 0.01) p.setY(k, p.getY(k) - r * 0.18);
    const lo = new THREE.Color(bottom).multiplyScalar(0.55);
    parts.push(colored(cone, new THREE.Color(top).lerp(new THREE.Color(bottom), 0.4 * (1 - f)), lo, y0 - r * 0.2, y0 + tierH));
  }
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  // Soften normals upwards so crowns shade like foliage, not like cones.
  const n = g.getAttribute("normal");
  for (let k = 0; k < n.count; k++) {
    const v = new THREE.Vector3(n.getX(k), n.getY(k) + 0.6, n.getZ(k)).normalize();
    n.setXYZ(k, v.x, v.y, v.z);
  }
  return g;
}

function broadleaf(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.2, 0.32, 5, 5);
  trunk.translate(0, 2.5, 0);
  parts.push(colored(trunk, new THREE.Color("#5a4632"), new THREE.Color("#433323"), 0, 5));
  const rand = mulberry32(11);
  for (let i = 0; i < 5; i++) {
    const b = new THREE.IcosahedronGeometry(2.4 + rand() * 1.2, 0);
    b.translate((rand() - 0.5) * 3, 6 + rand() * 3.5, (rand() - 0.5) * 3);
    parts.push(colored(b, new THREE.Color("#5a8034"), new THREE.Color("#2f4a1e"), 4, 11));
  }
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  return g;
}

export function treeGeometries(): THREE.BufferGeometry[] {
  return [
    conifer(6, 22, 3.4, "#3f6b3a", "#1d3a22", 1), // spruce
    conifer(5, 19, 2.8, "#8aa447", "#4e6a2c", 2), // larch
    broadleaf(),
  ];
}

/** Distant stand-ins: one cone (or blob) and a trunk stub. */
export function treeGeometriesLow(): THREE.BufferGeometry[] {
  const cone = (h: number, r: number, top: string, bottom: string) => {
    const trunk = colored(new THREE.CylinderGeometry(0.2, 0.3, h * 0.2, 4).translate(0, h * 0.1, 0), new THREE.Color("#3a2a1e"), new THREE.Color("#3a2a1e"), 0, 1);
    const c = colored(new THREE.ConeGeometry(r, h * 0.86, 6, 1).translate(0, h * 0.14 + h * 0.43, 0), new THREE.Color(top), new THREE.Color(bottom).multiplyScalar(0.6), h * 0.14, h);
    const g = mergeGeometries([trunk, c])!;
    g.computeVertexNormals();
    return g;
  };
  const blob = colored(new THREE.IcosahedronGeometry(3.6, 0).translate(0, 7.5, 0), new THREE.Color("#5a8034"), new THREE.Color("#2f4a1e"), 4, 11);
  const trunk = colored(new THREE.CylinderGeometry(0.2, 0.3, 5, 4).translate(0, 2.5, 0), new THREE.Color("#433323"), new THREE.Color("#433323"), 0, 1);
  const b = mergeGeometries([trunk, blob])!;
  b.computeVertexNormals();
  return [cone(22, 3.0, "#355c32", "#1d3a22"), cone(19, 2.5, "#7f9a42", "#4e6a2c"), b];
}

export const treeMaterial = (): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
