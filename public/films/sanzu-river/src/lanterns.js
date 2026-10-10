import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// 灯籠流し: paper lanterns set adrift for the dead, and the plain white
// lantern (白張提灯) that leads a newly departed spirit. Metres, seconds.

const CANDLE = new THREE.Color().setRGB(1, .56, .24);
const softplus = x => x > 24 ? x : Math.log1p(Math.exp(x));

function seeded(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}

function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
  return map;
}

function washiFibres(ctx, random, x0, y0, w, h, count) {
  for (let i = 0; i < count; i++) {
    const x = x0 + random() * w, y = y0 + random() * h, a = random() * Math.PI * 2, l = 3 + random() * 14;
    ctx.strokeStyle = random() < .5 ? `rgba(255,248,232,${.10 + random() * .18})` : `rgba(90,70,50,${.05 + random() * .09})`;
    ctx.lineWidth = .5 + random() * .9;
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a + .6) * l * .5, y + Math.sin(a + .6) * l * .5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
}

/** Four walls side by side: 南無阿弥陀佛 / plain / 精霊 / plain. */
function lanternPaper(random) {
  return canvasTexture(1024, 320, (ctx, W, H) => {
    for (let k = 0; k < 4; k++) {
      const x0 = k * 256;
      const v = ctx.createLinearGradient(0, 0, 0, H);
      v.addColorStop(0, 'rgb(118,104,92)'); v.addColorStop(.45, 'rgb(214,202,186)');
      v.addColorStop(.74, 'rgb(255,248,234)'); v.addColorStop(.93, 'rgb(236,224,206)'); v.addColorStop(1, 'rgb(170,150,130)');
      ctx.fillStyle = v; ctx.fillRect(x0, 0, 256, H);
      const h = ctx.createLinearGradient(x0, 0, x0 + 256, 0);
      for (const [s, a] of [[0, .62], [.10, 0], [.90, 0], [1, .62]]) h.addColorStop(s, `rgba(48,34,22,${a})`);
      ctx.fillStyle = h; ctx.fillRect(x0, 0, 256, H);
    }
    washiFibres(ctx, random, 0, 0, W, H, 3400);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '600 38px "Yu Mincho", "YuMincho", "BIZ UDMincho", "MS Mincho", serif';
    for (const [text, wall, top] of [['南無阿弥陀佛', 0, 52], ['精霊', 2, 104]]) {
      [...text].forEach((ch, i) => {
        const x = wall * 256 + 128 + (random() - .5) * 2.4, y = top + i * 43;
        ctx.filter = 'blur(1.4px)'; ctx.fillStyle = 'rgba(30,18,12,.45)'; ctx.fillText(ch, x + .8, y + .6);
        ctx.filter = 'blur(.45px)'; ctx.fillStyle = 'rgba(16,10,8,.93)'; ctx.fillText(ch, x, y);
      });
    }
    ctx.filter = 'none';
  });
}

/** The white funeral lantern: ribbed washi, brightest around its flame. */
function chochinPaper(random) {
  return canvasTexture(512, 512, (ctx, W, H) => {
    const v = ctx.createLinearGradient(0, 0, 0, H);
    v.addColorStop(0, 'rgb(150,136,120)'); v.addColorStop(.25, 'rgb(228,216,198)');
    v.addColorStop(.55, 'rgb(255,250,238)'); v.addColorStop(.85, 'rgb(220,206,186)'); v.addColorStop(1, 'rgb(140,124,108)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    washiFibres(ctx, random, 0, 0, W, H, 2200);
    for (let y = 10; y < H; y += 15.5) {
      ctx.fillStyle = 'rgba(70,52,36,.34)'; ctx.fillRect(0, y + (random() - .5) * .6, W, 2.1);
      ctx.fillStyle = 'rgba(255,250,240,.18)'; ctx.fillRect(0, y + 2.4, W, 1.2);
    }
    for (let x = 0; x < W; x += W / 4) { ctx.fillStyle = 'rgba(80,60,40,.10)'; ctx.fillRect(x, 0, 3, H); }
  });
}

function box(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g;
}

/** Floating lanterns drifting downstream. Upstream of the bridge an unseen
 *  boundary holds them back: offerings stay on this shore. */
export function createFloatingLanterns({ riverCenter, hullWidth, bridgeZ = -50, seed = 40213, scripted = [] }) {
  const random = seeded(seed);
  const group = new THREE.Group(); group.name = 'Tōrō nagashi — floating paper lanterns';
  const wood = new THREE.MeshStandardMaterial({ color: 0x2b211a, roughness: .78 });
  const paper = new THREE.MeshBasicMaterial({ map: lanternPaper(random), color: 0xffffff, side: THREE.DoubleSide });
  const flameMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(9, 5.4, 2.2) });
  const candleMaterial = new THREE.MeshStandardMaterial({ color: 0xd8cfc0, roughness: .6, emissive: new THREE.Color().setRGB(.55, .3, .12) });

  const frame = mergeGeometries([
    box(.27, .034, .27, 0, .004, 0),
    ...[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([sx, sz]) => box(.016, .30, .016, sx * .118, .171, sz * .118)),
    box(.252, .014, .014, 0, .322, .118), box(.252, .014, .014, 0, .322, -.118),
    box(.014, .014, .252, .118, .322, 0), box(.014, .014, .252, -.118, .322, 0),
  ]);
  // Four paper walls, each mapped to its own quarter of the atlas.
  const pp = [], uv = [], ii = [];
  const walls = [[[-1, 1], [1, 1]], [[1, 1], [1, -1]], [[1, -1], [-1, -1]], [[-1, -1], [-1, 1]]];
  walls.forEach(([[ax, az], [bx, bz]], k) => {
    const s = .113, base = pp.length / 3;
    for (const [x, z, u] of [[ax * s, az * s, k / 4], [bx * s, bz * s, (k + 1) / 4]]) {
      pp.push(x, .024, z, x, .314, z); uv.push(u + (u === k / 4 ? .004 : -.004), 0, u + (u === k / 4 ? .004 : -.004), 1);
    }
    ii.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  });
  const paperGeometry = new THREE.BufferGeometry();
  paperGeometry.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3));
  paperGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  paperGeometry.setIndex(ii); paperGeometry.computeVertexNormals();
  const candleGeometry = new THREE.CylinderGeometry(.016, .018, .055, 12); candleGeometry.translate(0, .048, 0);
  const flameGeometry = new THREE.SphereGeometry(1, 12, 8); flameGeometry.scale(.009, .024, .009); flameGeometry.translate(0, .098, 0);

  // Two populations: a loose procession on this side, and a gathered drift
  // already waiting at the boundary.
  const lanterns = [];
  for (let i = 0; i < 46; i++) {
    lanterns.push({ lane: (random() - .5) * 17.5, z0: 7 - Math.pow(random(), .9) * 38, speed: .26 + random() * .16, stop: bridgeZ + 2.6 + random() * .6 });
  }
  const slots = [];
  for (let row = 0; row < 4; row++) for (let col = -7; col <= 7; col++) slots.push([col * 1.18 + (row % 2) * .55 + (random() - .5) * .38, bridgeZ + 2.35 + row * .62 + (random() - .5) * .22]);
  slots.sort(() => random() - .5);
  for (let i = 0; i < 24; i++) {
    const [lane, stop] = slots[i];
    lanterns.push({ lane, z0: stop + 1.5 + random() * 4.5, speed: .22 + random() * .12, stop });
  }
  // Composed lanterns for particular shots follow explicit drifting paths.
  for (const path of scripted) lanterns.push({ path, lane: 0, z0: 0, speed: 0, stop: -1e6 });
  for (const l of lanterns) {
    l.phase = random() * 6.283; l.yaw = random() * 6.283; l.spin = (random() - .5) * .07;
    l.brightness = .78 + random() * .36; l.hue = random();
    l.out = 0;
  }
  const count = lanterns.length;
  const meshes = [
    new THREE.InstancedMesh(frame, wood, count), new THREE.InstancedMesh(paperGeometry, paper, count),
    new THREE.InstancedMesh(candleGeometry, candleMaterial, count), new THREE.InstancedMesh(flameGeometry, flameMaterial, count),
  ];
  meshes[0].name = 'Lantern floats and frames'; meshes[1].name = 'Candle-lit washi walls'; meshes[2].name = 'Candles'; meshes[3].name = 'Candle flames';
  meshes[0].castShadow = true; meshes[0].receiveShadow = true;
  for (const m of meshes) { m.frustumCulled = false; group.add(m); }
  const dummy = new THREE.Object3D(), tint = new THREE.Color(), local = new THREE.Vector3();
  const lights = lanterns.map(() => ({ position: new THREE.Vector3(), color: new THREE.Color(), power: 0 }));

  function flicker(t, p) {
    return 1 + .055 * Math.sin(12.7 * t + p) + .035 * Math.sin(23.3 * t + 2.1 * p) + .028 * Math.sin(6.1 * t + 3.7 * p);
  }

  /** boat: {position:[x,y,z], yaw}; extinguish(i, t) → 0..1 remaining flame. */
  function update(t, boat, { visible = 1, extinguish = null, pulse = null } = {}) {
    const cy = Math.cos(boat.yaw), sy = Math.sin(boat.yaw);
    lanterns.forEach((l, i) => {
      let x, zz;
      if (l.path) [x, zz] = l.path(t);
      else {
        const s = l.z0 - l.speed * t;
        const z = l.stop + .55 * softplus((s - l.stop) / .55);
        x = riverCenter(z) + l.lane + .32 * Math.sin(.071 * t + l.phase);
        zz = z + .18 * Math.sin(.053 * t + 1.7 * l.phase);
      }
      // The hull and its bow wave part the lanterns rather than passing through.
      const rx = x - boat.position[0], rz = zz - boat.position[2];
      const lx = cy * rx - sy * rz, lz = sy * rx + cy * rz;
      const along = THREE.MathUtils.clamp(lz, -3.6, 1.5);
      const clearance = hullWidth(along) + .30;
      const window = THREE.MathUtils.smoothstep(lz, -4.7, -3.4) * (1 - THREE.MathUtils.smoothstep(lz, 1.6, 2.9));
      const push = Math.max(0, clearance - Math.abs(lx)) * window;
      if (push > 0) {
        const nx = lx + Math.sign(lx || 1) * push;
        x = boat.position[0] + cy * nx + sy * lz;
        zz = boat.position[2] - sy * nx + cy * lz;
      }
      const y = .008 * Math.sin(1.7 * t + l.phase) + .004 * Math.sin(2.9 * t + 2.3 * l.phase) - .006;
      dummy.position.set(x, y, zz);
      dummy.rotation.set(.028 * Math.sin(1.3 * t + l.phase), l.yaw + l.spin * t + .06 * Math.sin(.21 * t + l.phase), .028 * Math.sin(1.1 * t + 2.9 * l.phase));
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      for (const m of meshes) m.setMatrixAt(i, dummy.matrix);
      const remaining = (extinguish ? extinguish(i, t, l) : 1) * (pulse ? pulse(x, zz, t) : 1);
      const f = flicker(t, l.phase) * l.brightness * remaining * visible;
      tint.copy(CANDLE).multiplyScalar(1.55 * f);
      tint.g *= .94 + .1 * l.hue; tint.b *= .85 + .3 * l.hue;
      meshes[1].setColorAt(i, tint.r > .02 ? tint : tint.setRGB(.035, .03, .026));
      meshes[3].setColorAt(i, tint.setScalar(remaining * visible > .02 ? f / l.brightness : 0));
      local.set(0, .15, 0).applyMatrix4(dummy.matrix);
      lights[i].position.copy(local);
      lights[i].color.copy(CANDLE).multiplyScalar(f);
      lights[i].power = f;
    });
    for (const m of meshes) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    return lights;
  }
  // Allocate instance colours before the first program compiles.
  for (let i = 0; i < count; i++) { meshes[1].setColorAt(i, CANDLE); meshes[3].setColorAt(i, tint.setScalar(1)); }
  group.userData = { update, lanterns, lights, count };
  return group;
}

/** The plain white lantern hung from a bamboo pole over the bow. */
export function createBowLantern() {
  const random = seeded(5531);
  const group = new THREE.Group(); group.name = 'White funeral lantern on a bamboo bow pole';
  const bamboo = new THREE.MeshStandardMaterial({ color: 0x6d6448, roughness: .62 });
  const lacquer = new THREE.MeshStandardMaterial({ color: 0x0d0c0b, roughness: .32, metalness: .1 });
  const cord = new THREE.MeshStandardMaterial({ color: 0x3a3128, roughness: .9 });
  // The pole is lashed to the stem and leans out over the water.
  const base = new THREE.Vector3(0, .50, -3.18), tip = new THREE.Vector3(0, 1.88, -4.02);
  const curve = new THREE.QuadraticBezierCurve3(base, new THREE.Vector3(0, 1.45, -3.36), tip);
  const pole = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, .017, 10, false), bamboo);
  pole.castShadow = true; group.add(pole);
  for (const t of [.18, .42, .66, .88]) {
    const node = new THREE.Mesh(new THREE.TorusGeometry(.0185, .0035, 6, 16), bamboo);
    node.position.copy(curve.getPoint(t)); node.lookAt(node.position.clone().add(curve.getTangent(t))); group.add(node);
  }
  for (const y of [.02, .07]) {
    const lash = new THREE.Mesh(new THREE.TorusGeometry(.024, .006, 6, 18), cord);
    lash.position.copy(curve.getPoint(y)); lash.lookAt(lash.position.clone().add(curve.getTangent(y))); group.add(lash);
  }
  // Pendulum: the lantern hangs from the pole tip on a short cord.
  const pivot = new THREE.Group(); pivot.position.copy(tip); group.add(pivot);
  const hang = new THREE.Mesh(new THREE.CylinderGeometry(.0028, .0028, .12, 6), cord); hang.position.y = -.06; pivot.add(hang);
  const profile = [];
  for (let i = 0; i <= 48; i++) {
    const y = -.165 + .33 * i / 48, q = y / .175;
    const r = .118 * Math.pow(Math.max(0, 1 - q * q), .62) * (1 - .018 * (.5 + .5 * Math.cos(y / .0155 * Math.PI * 2)));
    profile.push(new THREE.Vector2(Math.max(r, .052), y));
  }
  const paper = new THREE.MeshBasicMaterial({ map: chochinPaper(random), color: new THREE.Color().setRGB(3.1, 2.15, 1.25), side: THREE.DoubleSide });
  const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 40), paper);
  body.position.y = -.12 - .03 - .165; pivot.add(body);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(.056, .062, .032, 24), lacquer); top.position.y = -.12 - .016; pivot.add(top);
  const bottom = new THREE.Mesh(new THREE.CylinderGeometry(.064, .058, .028, 24), lacquer); bottom.position.y = body.position.y - .175; pivot.add(bottom);
  const light = new THREE.PointLight(0xffa860, 0, 9, 2);
  light.position.y = body.position.y + .01; pivot.add(light);
  const center = new THREE.Vector3();
  group.userData = {
    light, paper, pivot,
    update(t) {
      pivot.rotation.set(.045 * Math.sin(t * 1.07 + .4) + .012 * Math.sin(t * 2.3), 0, .05 * Math.sin(t * .83 + 1.1));
    },
    worldCenter() { return light.getWorldPosition(center); },
  };
  return group;
}

/** Spider-lily heads adrift: the flower of the other shore floats toward it,
 *  and like the lanterns it is held back at the boundary. Geometry and
 *  materials are borrowed from the detailed hero bloom. */
export function createFloatingBlooms({ riverCenter, hullWidth, bridgeZ = -50, hero, count = 52, seed = 77123 }) {
  const random = seeded(seed);
  const group = new THREE.Group(); group.name = 'Spider lily heads adrift';
  const crown = new THREE.Vector3(.022, .585, -.008);
  const meshes = [0, 2, 3].map(i => {
    const source = hero.children[i];
    const geometry = source.geometry.clone(); geometry.translate(-crown.x, -crown.y, -crown.z);
    const mesh = new THREE.InstancedMesh(geometry, source.material, count);
    mesh.receiveShadow = true; mesh.frustumCulled = false; group.add(mesh);
    return mesh;
  });
  // Half the heads drift in the ferry's own lane near the flowering right bank.
  const blooms = Array.from({ length: count }, (_, i) => ({
    lane: i % 2 ? 3.8 + random() * 6.0 : (random() - .5) * 16.5, z0: 5 - random() * 46, speed: .25 + random() * .13,
    stop: bridgeZ + 2.85 + random() * 1.5, phase: random() * 6.283, yaw: random() * 6.283,
    spin: (random() - .5) * .09, tilt: .12 + random() * .22, scale: 1.05 + random() * .35,
  }));
  const dummy = new THREE.Object3D();
  function update(t, boat) {
    const cy = Math.cos(boat.yaw), sy = Math.sin(boat.yaw);
    blooms.forEach((b, i) => {
      const s = b.z0 - b.speed * t;
      const z = b.stop + .5 * softplus((s - b.stop) / .5);
      let x = riverCenter(z) + b.lane + .28 * Math.sin(.083 * t + b.phase), zz = z + .15 * Math.sin(.061 * t + 2.3 * b.phase);
      const rx = x - boat.position[0], rz = zz - boat.position[2];
      const lx = cy * rx - sy * rz, lz = sy * rx + cy * rz;
      const along = THREE.MathUtils.clamp(lz, -3.6, 1.5);
      const window = THREE.MathUtils.smoothstep(lz, -4.6, -3.4) * (1 - THREE.MathUtils.smoothstep(lz, 1.6, 2.8));
      const push = Math.max(0, hullWidth(along) + .24 - Math.abs(lx)) * window;
      if (push > 0) { const nx = lx + Math.sign(lx || 1) * push; x = boat.position[0] + cy * nx + sy * lz; zz = boat.position[2] - sy * nx + cy * lz; }
      dummy.position.set(x, .016 + .006 * Math.sin(1.9 * t + b.phase), zz);
      dummy.rotation.set(b.tilt * Math.sin(b.phase) + .04 * Math.sin(1.4 * t + b.phase), b.yaw + b.spin * t, b.tilt * Math.cos(b.phase) + .04 * Math.sin(1.2 * t + 2 * b.phase));
      dummy.scale.setScalar(b.scale);
      dummy.updateMatrix();
      for (const m of meshes) m.setMatrixAt(i, dummy.matrix);
    });
    for (const m of meshes) m.instanceMatrix.needsUpdate = true;
  }
  group.userData = { update, blooms, count };
  return group;
}
