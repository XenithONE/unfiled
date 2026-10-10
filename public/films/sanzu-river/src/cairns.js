import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// 賽の河原の積み石. A river stone is broken rock that the water has rolled
// round: each one here is an ellipsoid cut by a few fracture planes whose edges
// are worn off by a soft minimum, with a scoop or two of conchoidal chipping and
// lumpy wear over it. Kinds: 0 river-rounded cobble, 1 flat slab, 2 freshly
// broken angular piece, 3 elongated stone. Towers are stacked against a height
// field of what is already placed, so stones rest on real high points, tip on
// the little wedge stones children slip between them, and never float.

function seeded(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
function hash3(x, y, z, s) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2147483647) + Math.imul(s | 0, 144269);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function noise3(x, y, z, s) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(ix + dx, iy + dy, iz + dz, s);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), fx), l(c(0, 1, 0), c(1, 1, 0), fx), fy),
           l(l(c(0, 0, 1), c(1, 0, 1), fx), l(c(0, 1, 1), c(1, 1, 1), fx), fy), fz) - .5;
}
const smoothstep = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

/** One stone, unit-ish size, flattened base. kind: 0 cobble, 1 slab, 2 angular, 3 elongated.
 *  shade: bake a darker underside into vertex colours (bank cobbles).
 *  flatten: false leaves the height to the instance scale. */
export function stoneGeometry(seed, detail = 18, kindHint = null, { shade = false, flatten = true } = {}) {
  const r = seeded(seed * 7919 + 13);
  const pick = r();
  const kind = kindHint ?? (pick < .42 ? 1 : pick < .64 ? 0 : pick < .84 ? 2 : 3);
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position, v = new THREE.Vector3(), q = new THREE.Vector3();
  const axes = [[1, .62 + r() * .18, .78 + r() * .17], [1, .30 + r() * .15, .70 + r() * .25],
                [1, .55 + r() * .25, .65 + r() * .25], [1, .40 + r() * .15, .45 + r() * .13]][kind];
  if (!flatten) axes[1] = 1;
  // Fracture planes: a slab's run roughly across its thickness, a broken piece
  // has many and sits close to them.
  const planes = [];
  for (let k = 0; k < [4, 5, 8, 5][kind]; k++) {
    const n = new THREE.Vector3(r() - .5, (r() - .5) * (kind === 1 ? .35 : 1.1), r() - .5).normalize();
    planes.push([n, (kind === 2 ? .50 : .56) + r() * .30]);
  }
  const sharp = Math.min([9, 16, 24, 13][kind], 1.3 * detail);
  const chips = [];
  for (let k = 0; k < (kind === 0 ? 1 : 1 + Math.floor(r() * 3)); k++) {
    chips.push([new THREE.Vector3(r() - .5, (r() - .5) * .8, r() - .5).normalize().multiplyScalar(.9), .22 + r() * .18, .04 + r() * .06]);
  }
  const lean = new THREE.Vector3(r() - .5, 0, r() - .5).multiplyScalar(.10);
  // Flat stones often taper: one end thicker than the other.
  const wedge = new THREE.Vector3(r() - .5, 0, r() - .5).normalize().multiplyScalar(kind === 1 ? .22 + r() * .25 : .08);
  const s = seed % 9973, shades = shade ? [] : null;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    // Distance to the surface along v: the sphere and every fracture plane, the
    // corners between them worn off by a soft minimum.
    let sum = Math.exp(-sharp);
    for (const [n, d] of planes) { const c = v.dot(n); if (c > 1e-3) sum += Math.exp(-sharp * d / c); }
    let t = -Math.log(sum) / sharp;
    t *= 1 + .09 * noise3(v.x * 1.6 + 3, v.y * 1.6, v.z * 1.6 - 7, s) + .028 * noise3(v.x * 4.2, v.y * 4.2 + 11, v.z * 4.2, s + 1)
           + .009 * noise3(v.x * 12, v.y * 12, v.z * 12 + 5, s + 2) + .004 * noise3(v.x * 29, v.y * 29 + 3, v.z * 29, s + 3);
    q.copy(v).multiplyScalar(t);
    for (const [c, rad, depth] of chips) {
      const dd = q.distanceTo(c) / rad;
      if (dd < 1) t -= depth * (1 - dd * dd) ** 2;
    }
    q.copy(v).multiplyScalar(t);
    q.x *= axes[0]; q.z *= axes[2]; q.y *= axes[1] * (1 + wedge.x * q.x + wedge.z * q.z);
    q.addScaledVector(lean, q.y);
    // The bed it lay on left a flatter underside.
    if (q.y < 0) q.y *= .78 + .12 * (1 - Math.min(1, Math.hypot(q.x, q.z)));
    p.setXYZ(i, q.x, q.y, q.z);
    if (shades) { const sh = .61 + .39 * smoothstep((q.y / axes[1] + .75) / 1.12); shades.push(sh, sh, sh); }
  }
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  if (shades) g.setAttribute('color', new THREE.Float32BufferAttribute(shades, 3));
  const merged = mergeVertices(g, 1e-5); g.dispose();
  merged.computeVertexNormals(); merged.computeBoundingBox(); merged.computeBoundingSphere();
  merged.userData.kind = kind;
  return merged;
}

/** Procedural stone surface in object space: mottling, mineral grain, quartz
 *  veins on some stones, lichen on the faces to the sky, moss and damp where the
 *  stone meets the ground, worn fine relief. Shared by cairns and cobbles. */
export function createStoneMaterial({ roughness = .88, bump = .0045, scale = 1 } = {}) {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness, specularIntensity: .26, envMapIntensity: .45 });
  m.onBeforeCompile = shader => {
    shader.uniforms.stoneScale = { value: scale };
    shader.uniforms.stoneBump = { value: bump };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStone; varying float vStoneSeed;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vStone = position;
        #ifdef USE_INSTANCING
          vStoneSeed = fract(sin(dot(instanceMatrix[3].xyz, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        #else
          vStoneSeed = .37;
        #endif`);
    const helpers = `
      varying vec3 vStone; varying float vStoneSeed; uniform float stoneScale, stoneBump;
      float stH(vec3 p) { p = fract(p * .3183099 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float stN(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
        return mix(mix(mix(stH(i), stH(i + vec3(1, 0, 0)), f.x), mix(stH(i + vec3(0, 1, 0)), stH(i + vec3(1, 1, 0)), f.x), f.y),
                   mix(mix(stH(i + vec3(0, 0, 1)), stH(i + vec3(1, 0, 1)), f.x), mix(stH(i + vec3(0, 1, 1)), stH(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
      float stF(vec3 p) { return .5 * stN(p) + .25 * stN(p * 2.03 + 7.1) + .125 * stN(p * 4.11 + 3.7); }
      vec3 stPerturb(vec3 pos, vec3 n, vec2 dH, float face) {
        vec3 sx = normalize(dFdx(pos)), sy = normalize(dFdy(pos));
        vec3 r1 = cross(sy, n), r2 = cross(n, sx); float det = dot(sx, r1) * face;
        return normalize(abs(det) * n - sign(det) * (dH.x * r1 + dH.y * r2));
      }`;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + helpers)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 sq = vStone * stoneScale + vStoneSeed * 31.;
        float sMot = stF(sq * 2.2);
        float sGrain = stN(sq * 24.);
        float sFleck = stN(sq * 41. + 11.3);
        vec3 sTint = diffuseColor.rgb;
        vec3 sCol = sTint * mix(.66, 1.24, sMot);
        sCol *= 1. - .24 * smoothstep(.70, .86, sGrain);
        sCol = mix(sCol, vec3(dot(sTint, vec3(.333))) * 1.9, .55 * smoothstep(.84, .91, sFleck));
        // A rare quartz vein: a thin sheet cutting straight through the stone,
        // so it shows as one near-straight band, slightly wavering.
        float sVeinOn = step(.88, vStoneSeed);
        vec3 sVeinN = normalize(vec3(sin(vStoneSeed * 91.), .35 * cos(vStoneSeed * 57.), cos(vStoneSeed * 91.)));
        float sVein = abs(dot(vStone, sVeinN) - .25 * (fract(vStoneSeed * 13.7) - .5) + .035 * (stN(sq * 7.) - .5));
        sCol = mix(sCol, min(sTint * 2.6, vec3(.42)), sVeinOn * (1. - smoothstep(.012, .030, sVein)) * .75);
        // Silt settles in hollows; tops are washed paler by rain.
        vec3 sDir = normalize(vStone);
        sCol *= .90 + .14 * smoothstep(-.4, .6, sDir.y);
        // Crusts of pale lichen on the faces turned to the sky, on some stones.
        float sLich = smoothstep(.60, .69, stF(sq * 7.3 + 4.1)) * smoothstep(.15, .60, sDir.y) * step(.38, fract(vStoneSeed * 7.31));
        sCol = mix(sCol, vec3(.31, .32, .27), sLich * .55);
        // Damp and a little moss where the stone sits in the gravel.
        float sLow = smoothstep(-.12, -.62, sDir.y);
        float sMoss = sLow * smoothstep(.56, .70, stF(sq * 4.1 + 9.)) * step(.55, fract(vStoneSeed * 3.7));
        sCol = mix(sCol * (1. - .30 * sLow), vec3(.045, .07, .032), sMoss * .65);
        diffuseColor.rgb = sCol;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor * mix(.90, 1.08, sGrain) - .06 * smoothstep(.5, .9, sMot), .35, 1.);
        roughnessFactor = mix(roughnessFactor, .60, sLow * .55);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float sHgt = .55 * stF(sq * 5.) + .30 * stN(sq * 27.) + .15 * stN(sq * 61.) + .25 * sLich * stN(sq * 90.);
        normal = stPerturb(-vViewPosition, normal, vec2(dFdx(sHgt), dFdy(sHgt)) * stoneBump * 60., faceDirection);`);
  };
  m.customProgramCacheKey = () => 'procedural-river-stone-v2';
  return m;
}

/**
 * specs: [{ x, z, levels, size, seed, collapse = 0, hero = false, pebbles = 0 }]
 * ground(x, z) → height of the gravel under a point.
 */
export function createCairns({ specs, ground, library = 32, farLibrary = 14 }) {
  const group = new THREE.Group(); group.name = 'Sai-no-Kawara stone towers';
  const near = Array.from({ length: library }, (_, i) => stoneGeometry(9001 + i * 37, 20));
  const far = Array.from({ length: farLibrary }, (_, i) => stoneGeometry(4001 + i * 53, 7));
  const byKind = lib => [0, 1, 2, 3].map(k => lib.map((g, i) => g.userData.kind === k ? i : -1).filter(i => i >= 0));
  const nearKinds = byKind(near), farKinds = byKind(far);
  const material = createStoneMaterial();
  const buckets = new Map();
  const put = (geoIndex, isFar, matrix, colour) => {
    const key = (isFar ? 'f' : 'n') + geoIndex;
    if (!buckets.has(key)) buckets.set(key, { geo: isFar ? far[geoIndex] : near[geoIndex], items: [] });
    buckets.get(key).items.push({ matrix, colour });
  };
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pos = new THREE.Vector3(), scl = new THREE.Vector3(), v = new THREE.Vector3();
  // River-bed rock (linear albedo): pale granite, andesite, basalt, sandstone,
  // red chert, greenstone, quartzite, dark slate.
  const palettes = [[.30, .29, .27], [.20, .205, .20], [.11, .115, .12], [.25, .22, .18], [.21, .14, .11], [.14, .165, .145], [.40, .39, .36], [.17, .17, .16]];

  for (const spec of specs) {
    const r = seeded(spec.seed);
    const geos = spec.hero || spec.near ? near : far, isFar = !(spec.hero || spec.near), kinds = isFar ? farKinds : nearKinds;
    const choose = kind => { const list = kinds[kind].length ? kinds[kind] : kinds[1].length ? kinds[1] : geos.map((_, i) => i); return list[Math.floor(r() * list.length)]; };
    // Height field of everything already placed, 8 mm cells over the footprint.
    const cell = .008, half = Math.max(.35, spec.size * .55 + (spec.collapse ? .30 : 0)), n = Math.ceil(half * 2 / cell) + 1;
    const H = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) H[j * n + i] = ground(spec.x - half + i * cell, spec.z - half + j * cell);
    const sample = (x, z) => {
      const fx = (x - spec.x + half) / cell, fz = (z - spec.z + half) / cell;
      const i = Math.max(0, Math.min(n - 2, Math.floor(fx))), j = Math.max(0, Math.min(n - 2, Math.floor(fz)));
      const tx = Math.max(0, Math.min(1, fx - i)), tz = Math.max(0, Math.min(1, fz - j));
      return (H[j * n + i] * (1 - tx) + H[j * n + i + 1] * tx) * (1 - tz) + (H[(j + 1) * n + i] * (1 - tx) + H[(j + 1) * n + i + 1] * tx) * tz;
    };
    const stamp = (geo, matrix) => {
      const p = geo.attributes.position;
      for (let k = 0; k < p.count; k++) {
        v.fromBufferAttribute(p, k).applyMatrix4(matrix);
        const fx = (v.x - spec.x + half) / cell, fz = (v.z - spec.z + half) / cell;
        const i = Math.round(fx), j = Math.round(fz);
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj;
          if (ii >= 0 && jj >= 0 && ii < n && jj < n && H[jj * n + ii] < v.y) H[jj * n + ii] = v.y;
        }
      }
    };
    const settle = (geo, x, z, yaw, tiltX, tiltZ, sx, sy, sz, sink) => {
      e.set(tiltX, yaw, tiltZ); q.setFromEuler(e); scl.set(sx, sy, sz);
      pos.set(x, 0, z); m.compose(pos, q, scl);
      // Lift until the lowest clearance over the underside is zero.
      const p = geo.attributes.position; let lift = -Infinity;
      for (let k = 0; k < p.count; k += 2) {
        v.fromBufferAttribute(p, k); if (v.y > .15) continue;
        v.applyMatrix4(m); lift = Math.max(lift, sample(v.x, v.z) - v.y);
      }
      pos.y = lift - sink; m.compose(pos, q, scl);
      return m.clone();
    };
    const levels = spec.levels, base = spec.size;
    const fallen = Math.min(levels - 2, spec.collapse || 0);
    let cx = spec.x, cz = spec.z, drift = r() * Math.PI * 2;
    const tint = palettes[Math.floor(r() * palettes.length)];
    const stoneColour = () => {
      const hue = palettes[Math.floor(r() * palettes.length)], k = .80 + r() * .36;
      return tint.map((c, ci) => (c * .30 + hue[ci] * .70) * k);
    };
    for (let k = 0; k < levels; k++) {
      // A broad slab at the foot; above it mostly slabs, now and then a round,
      // broken or long stone; the top one small and round or flat.
      const roll = r();
      const kind = k === 0 ? 1 : k === levels - 1 ? (roll < .4 ? 0 : 1) : roll < .70 ? 1 : roll < .82 ? 0 : roll < .94 ? 2 : 3;
      const g = choose(kind), geo = geos[g];
      // Sizes taper upward, but not strictly: a larger flat stone can sit on a smaller one.
      const taper = Math.pow(1 - k / (levels + .6), .85);
      const rad = .78 * base * (.095 + .118 * taper) * (.76 + r() * .48) * (k === 0 ? 1.22 : 1);
      const sx = rad, sz = rad * (.70 + r() * .32), sy = rad * (geo.userData.kind === 1 ? .80 + r() * .30 : .50 + r() * .22);
      const colour = stoneColour();
      if (k >= levels - fallen) {
        // Knocked down: the top stones lie scattered at the foot of the tower.
        const a = r() * Math.PI * 2, d = base * (.22 + r() * .22) + rad;
        const mat = settle(geo, spec.x + Math.cos(a) * d, spec.z + Math.sin(a) * d, r() * 6.28, (r() - .5) * 1.4, (r() - .5) * 1.4, sx, sy, sz, rad * .10);
        stamp(geo, mat); put(g, isFar, mat, colour);
        continue;
      }
      if (k > 0) {
        cx += Math.cos(drift) * rad * (r() - .35) * .26; cz += Math.sin(drift) * rad * (r() - .35) * .26; drift += (r() - .5) * 1.4;
        // A pebble slipped under one edge as a wedge tips the next stone.
        if (r() < .28) {
          const wa = r() * Math.PI * 2, wr = rad * (.26 + r() * .14), wg = farKinds[0].length ? farKinds[0][Math.floor(r() * farKinds[0].length)] : 0;
          const wm = settle(far[wg], cx + Math.cos(wa) * rad * .45, cz + Math.sin(wa) * rad * .45, r() * 6.28, (r() - .5) * .3, (r() - .5) * .3, wr, wr * .62, wr * .85, .0012);
          stamp(far[wg], wm); put(wg, true, wm, stoneColour());
        }
      }
      const mat = settle(geo, cx, cz, r() * 6.28, (r() - .5) * .22, (r() - .5) * .22, sx, sy, sz, k === 0 ? rad * .16 : .0015);
      stamp(geo, mat); put(g, isFar, mat, colour);
    }
    // Loose pebbles and chips gather round the foot.
    for (let k = 0; k < (spec.pebbles || 0); k++) {
      const a = r() * Math.PI * 2, d = base * (.18 + r() * .55), g = Math.floor(r() * far.length);
      const rr = .010 + Math.pow(r(), 1.6) * .028;
      const mat = settle(far[g], spec.x + Math.cos(a) * d, spec.z + Math.sin(a) * d, r() * 6.28, (r() - .5) * .5, (r() - .5) * .5, rr, rr * (.5 + r() * .4), rr * (.7 + r() * .3), rr * .25);
      put(g, true, mat, stoneColour().map(c => c * (.8 + r() * .3)));
    }
  }
  const tmp = new THREE.Color();
  let stones = 0;
  for (const [key, { geo, items }] of buckets) {
    const mesh = new THREE.InstancedMesh(geo, material, items.length);
    mesh.name = 'Cairn stones ' + key;
    items.forEach((it, i) => { mesh.setMatrixAt(i, it.matrix); mesh.setColorAt(i, tmp.setRGB(...it.colour)); });
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.computeBoundingSphere();
    group.add(mesh); stones += items.length;
  }
  group.userData = { stones, material };
  return group;
}
