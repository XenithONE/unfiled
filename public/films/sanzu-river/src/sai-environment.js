import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createCairns, createStoneMaterial, stoneGeometry as riverStone } from './cairns.js';

// Sai-no-Kawara: wet river cobbles, balanced stone offerings, an old timber
// crossing, and a deeply layered deciduous forest. All dimensions are metres.
export function createSaiEnvironment(THREE, { riverCenter, shore, bankHeight, woodMap, woodNormal, woodRough, mudNormal, extraCairns = [] }) {
  const group = new THREE.Group();
  group.name = 'Sai-no-Kawara — river stones, old bridge and wooded mountains';
  let seed = 819251;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
  const tau = Math.PI * 2;
  const dummy = new THREE.Object3D(), color = new THREE.Color();
  const saturate = x => Math.max(0, Math.min(1, x));
  const smooth = x => { x = saturate(x); return x * x * (3 - 2 * x); };
  function instances(name, geometry, material, entries, shadows = true) {
    const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
    mesh.name = name;
    entries.forEach((e, i) => {
      dummy.position.set(...e.p); dummy.scale.set(...e.s); dummy.rotation.set(...(e.r || [0, 0, 0]));
      dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
      if (e.c) mesh.setColorAt(i, color.setRGB(...e.c));
    });
    mesh.castShadow = shadows; mesh.receiveShadow = true; mesh.computeBoundingSphere(); group.add(mesh);
    return mesh;
  }
  function texture(width, height, draw) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    draw(canvas.getContext('2d'), width, height);
    const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 8;
    return map;
  }
  const stoneMap = texture(256, 256, (ctx, w, h) => {
    const image = ctx.createImageData(w, h);
    const hash = (x, y, period) => { const n = Math.sin(((x % period + period) % period) * 127.1 + ((y % period + period) % period) * 311.7) * 43758.5453; return n - Math.floor(n); };
    const grain = (u, v, period) => {
      const x = u * period, y = v * period, ix = Math.floor(x), iy = Math.floor(y);
      const fx = smooth(x - ix), fy = smooth(y - iy);
      const a = hash(ix, iy, period), b = hash(ix + 1, iy, period), c = hash(ix, iy + 1, period), d = hash(ix + 1, iy + 1, period);
      return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy - .5;
    };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const n = 106 + grain(x / w, y / h, 4) * 18 + grain(x / w, y / h, 11) * 7 + (random() - .5) * 11;
      const i = (y * w + x) * 4;
      image.data[i] = n; image.data[i + 1] = n + 3; image.data[i + 2] = n + 5; image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  });
  // Millimetre-scale irregular mineral relief, with no stretched soil ridges
  // or directional wood-like texture on the river stones.
  const stoneNormal = texture(256,256,(ctx,w,h) => {
    const pixels=ctx.createImageData(w,h), heights=new Float32Array(w*h);
    const hash=(x,y)=>{const n=Math.sin(x*127.1+y*311.7)*43758.5453;return n-Math.floor(n);};
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)heights[y*w+x]=hash(x,y)*.37+hash(Math.floor(x/3),Math.floor(y/3))*.22+hash(Math.floor(x/7),Math.floor(y/7))*.10;
    const at=(x,y)=>heights[((y+h)%h)*w+(x+w)%w];
    for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
      const dx=(at(x+1,y)-at(x-1,y))*.25+(at(x+1,y+1)+at(x+1,y-1)-at(x-1,y+1)-at(x-1,y-1))*.125;
      const dy=(at(x,y+1)-at(x,y-1))*.25+(at(x+1,y+1)+at(x-1,y+1)-at(x+1,y-1)-at(x-1,y-1))*.125;
      const normal=new THREE.Vector3(-dx*1.4,-dy*1.4,1).normalize(),i=(y*w+x)*4;
      pixels.data[i]=(normal.x*.5+.5)*255;pixels.data[i+1]=(normal.y*.5+.5)*255;pixels.data[i+2]=(normal.z*.5+.5)*255;pixels.data[i+3]=255;
    }
    ctx.putImageData(pixels,0,0);
  });
  stoneNormal.colorSpace=THREE.NoColorSpace;
  const stoneMat = new THREE.MeshPhysicalMaterial({ map: stoneMap, normalMap:stoneNormal, normalScale:new THREE.Vector2(.65,.65), color: 0xc2c7c8, vertexColors: true, roughness: .68, specularIntensity: .36, envMapIntensity: .50, clearcoat: .08, clearcoatRoughness: .48 });
  const cairnMat = stoneMat.clone(); cairnMat.roughness = .87; cairnMat.clearcoat = .015;
  // Bank cobbles share the cairns' procedural river-stone surface; their vertex
  // shading keeps the darker undersides.
  const cobbleMat = createStoneMaterial({ roughness: .86, bump: .004 });
  cobbleMat.vertexColors = true; cobbleMat.color.setRGB(.36, .36, .37);
  function stoneGeometry(detail, variant) {
    const geometry = new THREE.SphereGeometry(1, detail === 2 ? 48 : detail ? 32 : 20, detail === 2 ? 32 : detail ? 22 : 14);
    const p = geometry.attributes.position;
    const shades = [];
    const hash = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + variant * 91.3) * 43758.5453; return s - Math.floor(s); };
    const noise = (x, y, z) => {
      const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = smooth(x - ix), fy = smooth(y - iy), fz = smooth(z - iz);
      let n = 0; for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) for (let dz = 0; dz < 2; dz++) n += hash(ix + dx, iy + dy, iz + dz) * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
      return n - .5;
    };
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = 1 + .24 * noise(x * 1.55 + 3, y * 1.55 + 8, z * 1.55 + 2) + .045 * noise(x * 5.2 + 8, y * 5.2 + 3, z * 5.2 + 7);
      // Rounded slab profiles vary between river-worn quartzite and chunky
      // cobbles. No periodic radial deformation or onion-shaped striations.
      const yy = variant % 3 === 0 ? Math.tanh(y * 1.25) / Math.tanh(1.25) : y;
      const point = new THREE.Vector3((x + y * .055 * Math.sin(variant * 4.1)) * n, yy * n, (z + y * .07 * Math.cos(variant * 2.7)) * n);
      // Two worn geological faces subtly interrupt the ellipsoidal profile.
      // Smooth shoulders retain the rounded edges of water-worn stone.
      for (let face = 0; face < 2; face++) {
        const direction = new THREE.Vector3(Math.cos(variant * 2.3 + face * 2.7), .7 + face * .35, Math.sin(variant * 2.3 + face * 2.7)).normalize();
        const excess = Math.max(0, point.dot(direction) - (.76 + face * .05));
        point.addScaledVector(direction, -excess * smooth(excess / .18) * .42);
      }
      p.setXYZ(i, point.x, point.y, point.z);
      const shade = .61 + .39 * smooth((y + .75) / 1.12); shades.push(shade, shade, shade);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(shades, 3));
    geometry.computeVertexNormals();
    // UV seams and sphere poles share a physical surface. Average their
    // normals explicitly while retaining separate UV coordinates.
    const normals = geometry.attributes.normal, shared = new Map();
    for (let i = 0; i < p.count; i++) {
      const key = [p.getX(i), p.getY(i), p.getZ(i)].map(v => Math.round(v * 1e5)).join(',');
      if (!shared.has(key)) shared.set(key, { normal: new THREE.Vector3(), indices: [] });
      const entry = shared.get(key); entry.normal.add(new THREE.Vector3(normals.getX(i), normals.getY(i), normals.getZ(i))); entry.indices.push(i);
    }
    for (const entry of shared.values()) { entry.normal.normalize(); for (const i of entry.indices) normals.setXYZ(i, entry.normal.x, entry.normal.y, entry.normal.z); }
    return geometry;
  }
  // The irregular, partly buried cobbles overlap enough to form a continuous
  // stony apron. Its inland edge meanders through the first flowers.
  const stones = Array.from({ length: 5 }, () => []);
  for (const side of [-1, 1]) {
    const count = side === 1 ? 3900 : 2300;
    for (let i = 0; i < count; i++) {
      const z = 21 - Math.pow(random(), side === 1 ? 1.32 : 1) * 166;
      const limit = 2.65 + .32 * Math.sin(z * .57) + .27 * Math.sin(z * .18);
      const d = -.18 + random() * limit, x = riverCenter(z) + side * (shore(z) + d);
      const r = .064 + Math.pow(random(), 1.8) * .195;
      const sy = r * (.42 + random() * .40), y = bankHeight(x, z) + sy * .55 - .013;
      const shade = .34 + random() * .36;
      const palette = [[1.03,1,.94],[.91,.99,1.07],[.84,.85,.83],[1.16,1.02,.86],[1.02,1,.96],[.95,1,1.04],[1.07,1.025,.94],[1.01,1,.99],[1.18,1.15,1.07]][i % 9];
      stones[i % 5].push({ p: [x, y, z], s: [r * (.9 + random() * .5), sy, r * (.75 + random() * .7)], r: [(random() - .5) * .3, random() * tau, (random() - .5) * .3], c: palette.map(channel => shade * channel) });
    }
  }
  // Bank cobbles are the same broken-and-rolled rock as the cairns (their height
  // comes from the instance scale), so the foreground is no longer smooth buns.
  const cobbleKinds = [0, 2, 0, 3, 2];
  stones.forEach((entries, i) => {
    const near = entries.filter(e => e.p[2] > -81 && e.p[0] > riverCenter(e.p[2]));
    const far = entries.filter(e => !(e.p[2] > -81 && e.p[0] > riverCenter(e.p[2])));
    instances('Detailed near river cobbles ' + i, riverStone(500 + i * 13, 9, cobbleKinds[i], { shade: true, flatten: false }), cobbleMat, near, true);
    instances('Distant river cobbles ' + i, riverStone(500 + i * 13, 5, cobbleKinds[i], { shade: true, flatten: false }), cobbleMat, far, false);
  });
  const offerings = [], boulders = [], cairnSpecs = [];
  for (let i = 0; i < 25; i++) {
    const side = i < 17 ? 1 : -1;
    const z = i === 0 ? -1.5 : i === 1 ? -10 : 6 - random() * 94;
    const d = .62 + random() * 2.05, x = riverCenter(z) + side * (shore(z) + d);
    const count = 4 + Math.floor(random() * 4), size = .66 + random() * .61;
    const drift = random() * tau;
    // The per-stone draws are kept so the seeded valley after this loop is
    // unchanged; the towers themselves are now built by createCairns.
    for (let j = 0; j < count; j++) for (let k = 0; k < 8; k++) random();
    cairnSpecs.push({ x, z, levels: count, size, seed: 7100 + i * 31, collapse: i % 5 === 3 ? 2 : 0, pebbles: 4, near: Math.abs(z + 8) < 6 });
  }
  // The opening shot's offering stands behind the hero bloom; beside it a
  // tower has been knocked down, its stones lying where they fell.
  const heroZ = -8, heroX = riverCenter(heroZ) + shore(heroZ) + 1.4;
  cairnSpecs.push({ x: heroX, z: heroZ, levels: 7, size: .86, seed: 31337, hero: true, pebbles: 18 });
  cairnSpecs.push({ x: heroX + .40, z: heroZ + .66, levels: 6, size: .72, seed: 4242, hero: true, collapse: 4, pebbles: 10 });
  cairnSpecs.push({ x: heroX - .55, z: heroZ + 1.15, levels: 4, size: .55, seed: 777, hero: true, pebbles: 6 });
  // Composed towers for the Sai-no-Kawara shot.
  extraCairns.forEach((cairn, i) => {
    cairnSpecs.push({ x: cairn.x, z: cairn.z, levels: cairn.sizes.length, size: cairn.sizes[0][0] / .235, seed: 9100 + i * 17, near: true,
      collapse: i % 4 === 2 ? Math.min(3, cairn.sizes.length - 2) : 0, pebbles: 7 });
    cairn.top = bankHeight(cairn.x, cairn.z) + cairn.sizes.reduce((h, s) => h + s[1] * 1.6, 0);
  });
  const cairns = createCairns({ specs: cairnSpecs, ground: (x, z) => bankHeight(x, z) });
  group.add(cairns);
  for (let i = 0; i < 106; i++) {
    const side = random() > .36 ? 1 : -1, z = 12 - random() * 155, d = -.3 + random() * 3.2;
    const x = riverCenter(z) + side * (shore(z) + d), r = .2 + random() * .28;
    const shade = .40 + random() * .3;
    boulders.push({ p: [x, bankHeight(x, z) + r * .12, z], s: [r * 1.1, r * .49, r], r: [random() * .2, random() * tau, random() * .3], c: [shade * .95, shade, shade * 1.03] });
  }
  instances('Half-buried bank boulders', riverStone(777, 16, 0, { shade: true, flatten: false }), cobbleMat, boulders);

  // A low, gently arched Japanese timber bridge: individual deck boards,
  // twin edge girders, open rails, and only two braced pier bents.
  const bridgeZ = -50, bridgeX = riverCenter(bridgeZ), span = shore(bridgeZ) * 2 + 3.1, half = span / 2, width = 2.5;
  const endY = Math.max(bankHeight(bridgeX - half, bridgeZ), bankHeight(bridgeX + half, bridgeZ)) + .39;
  const deckY = x => endY + 2.65 * (1 - (x / half) ** 2);
  const wood = new THREE.MeshStandardMaterial({ map: woodMap, normalMap: woodNormal, normalScale: new THREE.Vector2(.4, .4), roughnessMap: woodRough, roughness: .91, color: 0xa0aaab });
  const timber = [];
  function beam(a, b, thickness, depth = thickness, shade = .72) {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), delta = vb.clone().sub(va);
    dummy.position.copy(va).addScaledVector(delta, .5); dummy.scale.set(thickness, delta.length(), depth);
    dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()); dummy.updateMatrix();
    timber.push({ matrix: dummy.matrix.clone(), color: [shade, shade * 1.015, shade] });
  }
  function box(x, y, z, sx, sy, sz, angle = 0, shade = .7) {
    dummy.position.set(x, y, z); dummy.scale.set(sx, sy, sz); dummy.rotation.set(0, 0, angle); dummy.updateMatrix();
    timber.push({ matrix: dummy.matrix.clone(), color: [shade, shade * 1.015, shade] });
  }
  const subdivisions = 88, plank = span / subdivisions;
  for (let i = 0; i < subdivisions; i++) {
    const x = -half + (i + .5) * plank, slope = Math.atan(-5.3 * x / (half * half));
    box(bridgeX + x, deckY(x), bridgeZ + (random() - .5) * .015, plank - .011, .13, width + (random() - .5) * .05, slope, .63 + random() * .15);
  }
  for (const edge of [-1, 1]) {
    const z = bridgeZ + edge * (width * .5 - .12);
    for (let i = 0; i < 44; i++) {
      const x0 = -half + span * i / 44, x1 = -half + span * (i + 1) / 44;
      beam([bridgeX + x0, deckY(x0) - .23, z], [bridgeX + x1, deckY(x1) - .23, z], .26, .25, .55);
    }
    const bays = 20;
    for (let i = 0; i <= bays; i++) {
      const x = -half + span * i / bays, y = deckY(x);
      box(bridgeX + x, y + .49, z, .12, 1.03, .13, 0, .73);
      box(bridgeX + x, y + 1.035, z, .17, .07, .18, 0, .72);
      if (i < bays) {
        const next = x + span / bays;
        for (const level of [.34, .91]) beam([bridgeX + x, y + level, z], [bridgeX + next, deckY(next) + level, z], .095, .105, .70);
      }
    }
    for (const x of [-half, half]) {
      box(bridgeX + x, deckY(x) + .63, z, .19, 1.30, .19, 0, .58);
      box(bridgeX + x, deckY(x) + 1.31, z, .23, .09, .23, 0, .56);
    }
  }
  // Exposed transverse joists make the underside read as joined carpentry
  // as the final camera follows the boat beneath the crossing.
  for (let j = 1; j < 15; j++) {
    const x = -half + span * j / 15;
    beam([bridgeX+x,deckY(x)-.18,bridgeZ-width*.5-.08],[bridgeX+x,deckY(x)-.18,bridgeZ+width*.5+.08],.13,.19,.58);
  }
  const pierX = [-half * .34, half * .34];
  for (const x of pierX) {
    const cap = deckY(x) - .37;
    for (const edge of [-1, 1]) {
      const z = bridgeZ + edge * .92;
      beam([bridgeX + x + edge * .12, -.23, z + edge * .18], [bridgeX + x, cap, z], .25, .26, .49);
    }
    beam([bridgeX + x, cap - .08, bridgeZ - 1.48], [bridgeX + x, cap - .08, bridgeZ + 1.48], .28, .28, .59);
    beam([bridgeX + x, .53, bridgeZ - 1.06], [bridgeX + x, .53, bridgeZ + 1.06], .15, .18, .51);
    beam([bridgeX + x, .61, bridgeZ - 1.0], [bridgeX + x, cap - .28, bridgeZ + .85], .13, .13, .52);
    beam([bridgeX + x, .61, bridgeZ + 1.0], [bridgeX + x, cap - .28, bridgeZ - .85], .13, .13, .52);
    for (const side of [-1, 1]) beam([bridgeX + x, cap - .7, bridgeZ + side * .91], [bridgeX + x + side * 1.25, deckY(x + side * 1.25) - .27, bridgeZ + side * .91], .15, .17, .55);
  }
  const timberGeometry = new RoundedBoxGeometry(1, 1, 1, 2, .035);
  const tuv = timberGeometry.attributes.uv;
  for (let i = 0; i < tuv.count; i++) tuv.setXY(i, tuv.getX(i) * .16 + .03, tuv.getY(i) * 1.5);
  const bridge = new THREE.InstancedMesh(timberGeometry, wood, timber.length);
  bridge.name = 'Weathered arched bridge — two timber pier bents';
  timber.forEach((e, i) => { bridge.setMatrixAt(i, e.matrix); bridge.setColorAt(i, color.setRGB(...e.color)); });
  bridge.castShadow = bridge.receiveShadow = true; bridge.computeBoundingSphere(); group.add(bridge);
  const bolts = [];
  for (const side of [-1, 1]) for (let i = 0; i <= 20; i++) {
    const x = -half + span * i / 20;
    for (const level of [.34,.91]) bolts.push({p:[bridgeX+x,deckY(x)+level,bridgeZ+side*(width*.5-.046)],s:[.013,.013,.004],r:[0,0,0]});
  }
  instances('Dark iron railing fasteners',new THREE.SphereGeometry(1,8,6),new THREE.MeshStandardMaterial({color:0x343938,roughness:.62,metalness:.58}),bolts,false);
  const foundations = [];
  for (const side of [-1, 1]) for (let layer = 0; layer < 3; layer++) for (let i = 0; i < 11; i++) {
    const x = bridgeX + side * (half - .22 + (i % 3) * .34), z = bridgeZ - 1.35 + Math.floor(i / 3) * .75;
    foundations.push({ p: [x, bankHeight(x, z) + .11 + layer * .20, z], s: [.32, .16, .44], r: [0, (random() - .5) * .5, 0], c: [.6, .63, .65] });
  }
  instances('Old stone bridge abutments', stoneGeometry(true, 9), cairnMat, foundations);

  // Rounded topographic ridges retain a visible tree line instead of conical
  // mountains. Their low apron starts beyond the flowering bank.
  const hillHeight = (x, z) => {
    const d = Math.abs(x - riverCenter(z)) - shore(z);
    const rise = smooth((d - 7) / 43);
    return bankHeight(x, z) + rise * (11 + 5 * Math.sin(z * .038 + x * .019) + 3 * Math.sin(x * .054 - z * .014)) + smooth((d - 33) / 75) * (15 + 7 * Math.sin(z * .021 + x * .037));
  };
  const hillMaterial = new THREE.MeshStandardMaterial({ color: 0x28373a, roughness: 1, normalMap: mudNormal, normalScale: new THREE.Vector2(.23, .23), vertexColors: true });
  for (const side of [-1, 1]) {
    const pp = [], cc = [], uv = [], ii = [], rows = 135, cols = 56;
    for (let j = 0; j <= rows; j++) {
      const z = 46 - j * 3;
      for (let i = 0; i <= cols; i++) {
        const d = 7 + i * 2.7, x = riverCenter(z) + side * (shore(z) + d), y = hillHeight(x, z);
        pp.push(x, y, z); uv.push(x / 4, z / 4);
        const shade = .65 + .15 * Math.sin(x * .29 + z * .17); cc.push(shade, shade, shade);
        if (i < cols && j < rows) { const a = j * (cols + 1) + i, b = a + cols + 1; if (side > 0) ii.push(a, a + 1, b, b, a + 1, b + 1); else ii.push(a, b, a + 1, b, b + 1, a + 1); }
      }
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.setIndex(ii); geometry.computeVertexNormals();
    const hill = new THREE.Mesh(geometry, hillMaterial); hill.name = 'Irregular wooded ridge'; hill.receiveShadow = true; group.add(hill);
  }
  // The far reach turns behind two rounded mountain shoulders. Separate
  // depths let the scene fog soften each ridge independently.
  for (let layer = 0; layer < 2; layer++) {
    const positions = [], indices = [], n = 180;
    for (let i = 0; i <= n; i++) {
      const x = -210 + i / n * 420, z = -185 - layer * 83 - 12 * Math.sin(x * .017 + layer);
      const ridge = 9 + layer * 8 + 17 * Math.exp(-Math.pow((x + 65 - layer * 32) / 55, 2)) + 24 * Math.exp(-Math.pow((x - 95 + layer * 28) / 66, 2)) + 2.0 * Math.sin(x * .065 + layer) + .48 * Math.sin(x * .64);
      positions.push(x, -.4, z, x, ridge, z);
      if (i < n) { const a = i * 2; indices.push(a, a + 2, a + 3, a, a + 3, a + 1); }
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
    const ridge = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: layer ? 0x4a5d67 : 0x344c58, roughness: 1 })); ridge.name = 'Distant mist-softened ridge ' + layer; group.add(ridge);
  }
  const barkMap = texture(256, 512, (ctx, w, h) => {
    const image = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const groove = Math.sin(x * .24 + Math.sin(y * .035 + x * .031) * 1.8);
      const n = 83 + groove * 17 + Math.sin(x * .73 + y * .026) * 7 + (random() - .5) * 18;
      const i = (y * w + x) * 4; image.data[i] = n; image.data[i + 1] = n + 2; image.data[i + 2] = n + 1; image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  });
  const barkMaterial = new THREE.MeshStandardMaterial({ map: barkMap, normalMap: woodNormal, normalScale: new THREE.Vector2(.35, .35), color: 0x7b827b, roughness: .96 });
  const barkPos = [], barkUV = [], barkIndex = [];
  function branch(points, r0, r1, radial = 7) {
    const start = barkPos.length / 3;
    for (let j = 0; j < points.length; j++) {
      const t = j / (points.length - 1), radius = r0 + (r1 - r0) * t;
      const tangent = points[Math.min(j + 1, points.length - 1)].clone().sub(points[Math.max(0, j - 1)]).normalize();
      const axis = new THREE.Vector3(0, 1, 0); if (Math.abs(tangent.y) > .92) axis.set(1, 0, 0);
      const u = new THREE.Vector3().crossVectors(tangent, axis).normalize(), v = new THREE.Vector3().crossVectors(tangent, u).normalize();
      for (let k = 0; k <= radial; k++) {
        const a = k / radial * tau, r = radius * (1 + .10 * Math.sin(k * 2.6 + j * .73));
        const p = points[j].clone().addScaledVector(u, Math.cos(a) * r).addScaledVector(v, Math.sin(a) * r);
        barkPos.push(p.x, p.y, p.z); barkUV.push(k / radial, t * 2.4);
        if (j < points.length - 1 && k < radial) { const a0 = start + j * (radial + 1) + k, b = a0 + radial + 1; barkIndex.push(a0, a0 + 1, b, a0 + 1, b + 1, b); }
      }
    }
  }
  // Fine leaves are clipped into seven intersecting planes per twig spray.
  // Hundreds of independently drawn leaflets preserve a fine broken silhouette
  // without the enormous polygons and triangle cost of oversized mesh leaves.
  const leafMap = texture(512, 512, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < 540; i++) {
      const angle = random() * tau, radius = Math.sqrt(random());
      const x = w * .5 + Math.cos(angle) * radius * w * (.36 + .055 * Math.sin(angle * 5));
      const y = h * .5 + Math.sin(angle) * radius * h * (.35 + .065 * Math.cos(angle * 3));
      const length = 5 + random() * 9, width = length * (.3 + random() * .19);
      const shade = 150 + Math.floor(random() * 105);
      ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
      ctx.beginPath(); ctx.ellipse(x, y, length, width, random() * tau, 0, tau); ctx.fill();
    }
  });
  leafMap.wrapS = leafMap.wrapT = THREE.ClampToEdgeWrapping;
  function leafSpray() {
    const p = [], uv = [], colors = [];
    for (let i = 0; i < 7; i++) {
      const rotation = new THREE.Euler(i < 3 ? .2 : i < 6 ? .85 : Math.PI / 2, i * 2.4, (random() - .5) * .4);
      const corners = [[-1, -.68, 0], [1, -.68, 0], [1, .68, 0], [-1, .68, 0]].map(v => new THREE.Vector3(...v).applyEuler(rotation));
      const coords = [[0, 0], [1, 0], [1, 1], [0, 1]];
      const shade = .73 + random() * .27;
      for (const j of [0, 1, 2, 0, 2, 3]) { const q = corners[j]; p.push(q.x, q.y + (i % 3 - 1) * .12, q.z); colors.push(shade * .88, shade, shade * .94); uv.push(...coords[j]); }
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.computeVertexNormals(); return geometry;
  }
  const leaves = [], distantLeaves = [];
  const leafMaterial = new THREE.MeshStandardMaterial({ map: leafMap, color: 0x52655e, roughness: .97, side: THREE.DoubleSide, vertexColors: true, alphaTest: .45, alphaToCoverage: true });
  function tree(x, z, height, distant = false, sparse = false) {
    const y = hillHeight(x, z), phase = random() * tau, bend = (random() - .5) * height * .49;
    const trunk = [];
    for (let j = 0; j <= 8; j++) { const t = j / 8; trunk.push(new THREE.Vector3(x + bend * t * t + Math.sin(t * 5 + phase) * height * .07 * t, y + t * height, z + Math.sin(t * 4 + phase) * height * .15 * t)); }
    branch(trunk, height * (.029 + random() * .01), .022, distant ? 5 : 8);
    if (!distant) for (let j = 0; j < 5; j++) { const angle = j * tau / 5 + phase; branch([new THREE.Vector3(x, y + .32, z), new THREE.Vector3(x + Math.cos(angle) * .55, y + .06, z + Math.sin(angle) * .55), new THREE.Vector3(x + Math.cos(angle) * .9, y, z + Math.sin(angle) * .9)], height * .022, .013, 6); }
    const number = distant ? 7 : 12;
    for (let j = 0; j < number; j++) {
      const t = .34 + j / number * .56, level = t * 8, base = trunk[Math.floor(level)].clone().lerp(trunk[Math.min(8, Math.floor(level) + 1)], level % 1);
      const angle = j * 2.4 + phase + (random() - .5) * .6, reach = height * (.20 + random() * .21) * (1.24 - t * .7);
      const path = [];
      for (let k = 0; k <= 4; k++) { const f = k / 4; path.push(base.clone().add(new THREE.Vector3(Math.cos(angle + f * .22) * reach * f, height * (.10 * f + .12 * f * f) + Math.sin(f * 4) * height * .016, Math.sin(angle + f * .22) * reach * f))); }
      branch(path, height * .012 * (1.2 - t), distant ? .018 : .01, distant ? 5 : 6);
      const count = distant ? 3 : (sparse ? 2 : 5);
      for (let k = 0; k < count; k++) {
        const f = .50 + k / count * .5, a = angle + (k % 2 ? -.9 : .85), start = path[2].clone().lerp(path[4], saturate((f - .5) * 2));
        const twig = start.clone().add(new THREE.Vector3(Math.cos(a) * height * .10, height * (.04 + random() * .04), Math.sin(a) * height * .10));
        if (!distant) branch([start, start.clone().lerp(twig, .55).add(new THREE.Vector3(0, .04, 0)), twig], .026, .004, 5);
        const scale = height * (distant ? .23 : .17) * (.80 + random() * .45), shade = .75 + random() * .40;
        if (!sparse || random() > .24) (distant ? distantLeaves : leaves).push({ p: [twig.x, twig.y, twig.z], s: [scale, scale * (.7 + random() * .35), scale], r: [(random() - .5) * .8, random() * tau, (random() - .5) * .5], c: [shade * .9, shade, shade * 1.015] });
      }
    }
  }
  // Tall framing trees lie well inland, leaving the stone bank and bridge open.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 52; i++) {
      const z = 11 - random() * 176, d = 9.5 + Math.pow(random(), .85) * 34;
      const x = riverCenter(z) + side * (shore(z) + d);
      tree(x, z, 3.5 + Math.pow(random(), 1.5) * 10.5, false, random() < .25);
    }
    for (let i = 0; i < 150; i++) {
      const z = 15 - random() * 330, d = 24 + random() * 93;
      const x = riverCenter(z) + side * (shore(z) + d);
      tree(x, z, 3.5 + random() * 8.5, true);
    }
  }
  // Two sparse, particularly crooked trees give the near silhouette fine twigs.
  tree(riverCenter(-19) + shore(-19) + 8.6, -19, 11.7, false, true);
  tree(riverCenter(-42) - shore(-42) - 8.7, -42, 12.6, false, true);
  const barkGeometry = new THREE.BufferGeometry(); barkGeometry.setAttribute('position', new THREE.Float32BufferAttribute(barkPos, 3)); barkGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(barkUV, 2)); barkGeometry.setIndex(barkIndex); barkGeometry.computeVertexNormals();
  const trunks = new THREE.Mesh(barkGeometry, barkMaterial); trunks.name = 'Twisted deciduous trunks, branches and exposed roots'; trunks.castShadow = trunks.receiveShadow = true; group.add(trunks);
  const spray = leafSpray();
  instances('Irregular open deciduous crowns', spray, leafMaterial, leaves, false);
  instances('Distant layered woodland foliage', spray, leafMaterial, distantLeaves, false);
  // Individual bent 3-D leaves sit through the nearer sprays. Their varying
  // normals and depth interrupt the flat impression of intersecting foliage
  // cards while distant crowns retain their economical fine silhouette.
  const lp=[],lc=[];
  for(let i=0;i<76;i++) {
    const a=random()*tau,r=Math.sqrt(random())*.88,cy=(random()-.5)*.76;
    const center=new THREE.Vector3(Math.cos(a)*r,cy,Math.sin(a)*r);
    const rotation=new THREE.Euler((random()-.5)*1.5,random()*tau,(random()-.5)*1.1);
    const length=.042+random()*.040,width=length*(.34+random()*.13),shade=.69+random()*.31;
    const boundary=[];
    for(let j=0;j<6;j++) {const angle=j/6*tau;boundary.push(new THREE.Vector3(Math.cos(angle)*length,Math.sin(angle)*.008,Math.sin(angle)*width).applyEuler(rotation).add(center));}
    const mid=new THREE.Vector3(0,.006,0).applyEuler(rotation).add(center);
    for(let j=0;j<6;j++)for(const q of [mid,boundary[j],boundary[(j+1)%6]]){lp.push(q.x,q.y,q.z);lc.push(shade*.81,shade,shade*.88);}
  }
  const leafGeometry=new THREE.BufferGeometry();leafGeometry.setAttribute('position',new THREE.Float32BufferAttribute(lp,3));leafGeometry.setAttribute('color',new THREE.Float32BufferAttribute(lc,3));leafGeometry.computeVertexNormals();
  instances('Individual three-dimensional leaves on near branches',leafGeometry,new THREE.MeshStandardMaterial({color:0x526258,roughness:.88,vertexColors:true,side:THREE.DoubleSide}),leaves,false);
  group.userData.bridge = { z: bridgeZ, span, endHeight: endY, crownHeight: deckY(0) };
  group.userData.cairnCount = 26;
  group.userData.heroCairn = new THREE.Vector3(heroX, bankHeight(heroX, heroZ), heroZ);
  group.userData.cairnStones = cairns.userData.stones;
  group.userData.treeCount = 406;
  return group;
}
