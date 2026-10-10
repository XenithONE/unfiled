import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** A botanical close-up: six florets, 36 recurved tepals, fine stamens and dew. */
export function createHeroLycoris(THREE, { seed = 91837 } = {}) {
  const group = new THREE.Group(); group.name = 'Hero Lycoris radiata — six-floret dew-covered flower';
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const V = (x, y, z) => new THREE.Vector3(x, y, z), tau = Math.PI * 2;
  const clock = { value: 0 }, petals = [], stems = [], filaments = [], anthers = [], drops = [];
  const crimson = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: .46, side: THREE.DoubleSide, sheen: .35, sheenRoughness: .73, sheenColor: 0x94242e, clearcoat: .035, clearcoatRoughness: .65 });
  crimson.onBeforeCompile = shader => {
    const lighting = THREE.ShaderChunk.lights_physical_pars_fragment.replace('reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );',
      'float transmitted = pow(max(0.0, dot(-geometryNormal, directLight.direction)), 1.25) * 0.48; reflectedLight.directDiffuse += (irradiance + directLight.color * transmitted) * BRDF_Lambert(material.diffuseColor);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_pars_fragment>', lighting);
  };
  crimson.customProgramCacheKey = () => 'hero-lycoris-light-transmitted-tissue-v1';
  const stemMaterial = new THREE.MeshPhysicalMaterial({ color: 0x526647, roughness: .64, clearcoat: .13, clearcoatRoughness: .47 });
  const filamentMaterial = new THREE.MeshPhysicalMaterial({ color: 0xb43b48, roughness: .52, sheen: .18, sheenColor: 0xa92233 });
  filamentMaterial.onBeforeCompile = crimson.onBeforeCompile;
  filamentMaterial.customProgramCacheKey = () => 'hero-lycoris-thin-translucent-filaments-v1';
  const pollenMaterial = new THREE.MeshStandardMaterial({ color: 0x735149, roughness: .9 });
  const dewMaterial = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: .04, metalness: 0, transmission: .94, ior: 1.333, thickness: .0025, envMapIntensity: 1.3, clearcoat: 1, clearcoatRoughness: .02 });
  function tube(points, radius, steps, radial = 8) {
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), steps, radius, radial, false);
  }
  const crown = V(.022, .585, -.008);
  stems.push(tube([V(0, 0, 0), V(.004, .20, -.007), V(.015, .43, -.012), crown], .0039, 44, 12));
  // The short papery bracts surround the umbel; flowering stalks have no leaves.
  for (let i = 0; i < 2; i++) {
    const bract = new THREE.ConeGeometry(.003, .026, 8); bract.rotateZ(i ? .8 : -.9); bract.translate(crown.x + (i ? .006 : -.006), crown.y - .005, crown.z); stems.push(bract);
  }
  for (let f = 0; f < 6; f++) {
    const angle = f / 6 * tau + .12 + (random() - .5) * .10, radial = V(Math.cos(angle), 0, Math.sin(angle));
    const tangent = V(-Math.sin(angle), 0, Math.cos(angle)), axis = radial.clone().multiplyScalar(.79).add(V(0, .61, 0)).normalize();
    const ortho = tangent.clone().cross(axis).normalize();
    const throat = crown.clone().addScaledVector(radial, .042 + random() * .007).add(V(0, .018 + random() * .016, 0));
    stems.push(tube([crown, crown.clone().lerp(throat, .5).add(V(0, .004, 0)), throat], .00175, 12, 8));
    for (let p = 0; p < 6; p++) {
      const theta = p / 6 * tau + f * .23 + (random() - .5) * .08;
      const spread = tangent.clone().multiplyScalar(Math.cos(theta)).addScaledVector(ortho, Math.sin(theta));
      const phase = random() * tau, lengthScale = .93 + random() * .15, width = .0039 + random() * .001;
      const rows = 48, cols = 8, positions = [], colors = [], uv = [], indices = [];
      let previousAcross = null;
      const centerAt = t => throat.clone().addScaledVector(spread, .081 * Math.sin(t * Math.PI * .78) * lengthScale).addScaledVector(axis, (.061 * Math.sin(t * Math.PI * .98) - .044 * t * t) * lengthScale);
      for (let j = 0; j <= rows; j++) {
        const t = j / rows, center = centerAt(t), direction = centerAt(Math.min(1, t + .004)).sub(centerAt(Math.max(0, t - .004))).normalize();
        let across = axis.clone().cross(direction).normalize();
        if (across.lengthSq() < .01) across = previousAcross ? previousAcross.clone() : tangent.clone();
        if (previousAcross && across.dot(previousAcross) < 0) across.negate();
        previousAcross = across.clone();
        const normal = direction.clone().cross(across).normalize();
        const taper = Math.pow(Math.sin(Math.PI * t), .56) * (.97 + .14 * Math.sin(t * 22 + phase));
        for (let k = 0; k <= cols; k++) {
          const u = k / cols * 2 - 1;
          const wave = Math.sin(t * 25 + phase + u * .9) * width * .17 * Math.pow(Math.abs(u), 2.6);
          const point = center.clone().addScaledVector(across, width * taper * u).addScaledVector(normal, width * .19 * (1 - u * u) * taper + wave);
          positions.push(point.x, point.y, point.z); uv.push(k / cols, t);
          const edge = Math.pow(Math.abs(u), 2), midrib = Math.exp(-u * u * 70) * .05;
          const tone = .82 + .14 * t + .09 * edge - midrib;
          colors.push(.42 * tone, (.010 + .007 * edge) * tone, (.023 + .008 * edge) * tone);
          if (j < rows && k < cols) { const a = j * (cols + 1) + k, b = a + cols + 1; indices.push(a, b, a + 1, a + 1, b, b + 1); }
        }
      }
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.setIndex(indices); geometry.computeVertexNormals(); petals.push(geometry);
      if ((f + p) % 3 === 0) {
        const t = .42 + random() * .42, point = centerAt(t), radius = .0007 + random() * .00065;
        drops.push({ p: point.addScaledVector(axis, .0014), radius });
      }
    }
    for (let s = 0; s < 7; s++) {
      const theta = s / 7 * tau + .3, lateral = tangent.clone().multiplyScalar(Math.cos(theta) * .037);
      const end = throat.clone().addScaledVector(radial, .102 + Math.sin(theta) * .018).add(lateral).add(V(0, .045 + Math.sin(theta) * .028, 0));
      const control = throat.clone().addScaledVector(radial, .05).addScaledVector(lateral, .3).add(V(0, .108 + Math.sin(theta) * .024, 0));
      const curve = new THREE.QuadraticBezierCurve3(throat, control, end);
      filaments.push(new THREE.TubeGeometry(curve, 30, s === 6 ? .00054 : .00043, 7, false));
      if (s < 6) {
        const anther = new THREE.SphereGeometry(1, 10, 6); anther.scale(.0031, .00084, .00105); anther.rotateY(-angle); anther.rotateZ((random() - .5) * .7); anther.translate(end.x, end.y, end.z); anthers.push(anther);
      }
    }
  }
  function combine(parts, material, name) {
    const mesh = new THREE.Mesh(mergeGeometries(parts), material); mesh.name = name; mesh.castShadow = mesh.receiveShadow = true; group.add(mesh); parts.forEach(g => g.dispose()); return mesh;
  }
  combine(petals, crimson, 'Thirty-six paper-thin recurved crimson tepals');
  combine(stems, stemMaterial, 'Bare curved scape and six pedicels');
  combine(filaments, filamentMaterial, 'Thirty-six stamens and six curved styles');
  combine(anthers, pollenMaterial, 'Thirty-six small pollen-bearing anthers');
  const droplets = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), dewMaterial, drops.length), dummy = new THREE.Object3D();
  drops.forEach((d, i) => { dummy.position.copy(d.p); dummy.scale.set(d.radius, d.radius * .72, d.radius); dummy.updateMatrix(); droplets.setMatrixAt(i, dummy.matrix); });
  droplets.name = 'Small dew beads held by the tepals'; group.add(droplets);
  group.userData.bloomCenter = V(.022, .61, -.008);
  group.userData.update = time => { clock.value = time; group.rotation.z = Math.sin(time * .68 + .7) * .007; group.rotation.x = Math.sin(time * .47) * .004; };
  return group;
}

/** Bare-stem autumn Lycoris radiata. All geometry is deterministic and instanced. */
export function createLycorisField(THREE, bankHeight, riverCenter, shore = () => 12, { exclusions = [] } = {}) {
  const field = new THREE.Group();
  field.name = 'Lycoris radiata — crimson drifts on the stony bank';
  let seed = 481927;
  const random = () => ((seed = Math.imul(seed ^ (seed >>> 15), 1 | seed), seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed), ((seed ^ (seed >>> 14)) >>> 0) / 4294967296));
  const clock = { value: 0 };
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setRGB(0.58,0.64,0.69), vertexColors: true, roughness: 0.76, metalness: 0,
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = shader => {
    shader.uniforms.lilyTime = clock;
    shader.vertexShader = 'uniform float lilyTime;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      #ifdef USE_INSTANCING
        float bend = pow(clamp(position.y / 0.76, 0.0, 1.0), 2.0);
        float phase = instanceMatrix[3].x * 0.57 + instanceMatrix[3].z * 0.24;
        transformed.x += bend * (sin(lilyTime * 0.67 + phase) * 0.008 + sin(lilyTime * 1.13 + phase * 2.0) * 0.003);
        transformed.z += bend * sin(lilyTime * 0.48 + phase + 1.1) * 0.006;
      #endif
    `);
    // Thin crimson tissue transmits a little incident light from its reverse side.
    // This is light-dependent diffuse scattering, not emissive illumination.
    const physicalLighting = THREE.ShaderChunk.lights_physical_pars_fragment.replace(
      'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );',
      `float petalMask = smoothstep(1.3, 2.2, material.diffuseColor.r / max(material.diffuseColor.g, 0.0001));
       float backLight = max(0.0, -dot(geometryNormal, directLight.direction)) * 0.18 * petalMask;
       reflectedLight.directDiffuse += (irradiance + directLight.color * backLight) * BRDF_Lambert(material.diffuseColor);`
    );
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_pars_fragment>', physicalLighting);
  };
  material.customProgramCacheKey = () => 'lycoris-gentle-dawn-breeze-thin-petals-v2';

  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const crimson = new THREE.Color('#a92935');
  const petalEdge = new THREE.Color('#b5343d');
  const filament = new THREE.Color('#b84249');
  const pollen = new THREE.Color('#382527');
  const green = new THREE.Color('#364d2b');
  const greenLight = new THREE.Color('#4b5a31');

  function plantGeometry(level) {
    const positions = [], colors = [];
    function tri(a, b, c, color) {
      for (const p of [a, b, c]) { positions.push(p.x, p.y, p.z); const occlusion=0.55+0.45*Math.min(1,p.y/0.15); colors.push(color.r*occlusion, color.g*occlusion, color.b*occlusion); }
    }
    function ribbon(points, width, color, ruffle = 0, preferred = null) {
      let previousSide = null;
      const rows = points.map((p, i) => {
        const tangent = points[Math.min(i + 1, points.length - 1)].clone().sub(points[Math.max(0, i - 1)]).normalize();
        let side = preferred ? preferred.clone().cross(tangent).normalize() : V(0, 1, 0).cross(tangent).normalize();
        if (side.lengthSq() < 0.01) side = previousSide ? previousSide.clone() : V(1, 0, 0);
        // Recurving changes the tangent direction; preserve ribbon orientation
        // rather than swapping its two edges at the bend (a bow-tie triangle).
        if (previousSide && side.dot(previousSide) < 0) side.negate();
        previousSide = side.clone();
        const t = i / (points.length - 1);
        const taper = 0.12 + 0.88 * Math.pow(Math.sin(Math.PI * t), 0.55);
        const w = width * taper * (1 + Math.sin(t * Math.PI * 9) * ruffle);
        const curl = V(0, Math.sin(t * Math.PI * 7) * ruffle * width * 0.65, 0);
        return [p.clone().addScaledVector(side, w).add(curl), p.clone().addScaledVector(side, -w).sub(curl)];
      });
      for (let i = 0; i < rows.length - 1; i++) {
        tri(rows[i][0], rows[i][1], rows[i + 1][0], color);
        tri(rows[i][1], rows[i + 1][1], rows[i + 1][0], color);
      }
    }
    function tube(points, radius, sides, color, tipRadius = radius) {
      const rings = points.map((p, i) => {
        const tangent = points[Math.min(i + 1, points.length - 1)].clone().sub(points[Math.max(i - 1, 0)]).normalize();
        const basis = Math.abs(tangent.y) > 0.95 ? V(1, 0, 0) : V(0, 1, 0);
        const u = basis.cross(tangent).normalize(), v = tangent.clone().cross(u).normalize();
        const r = radius + (tipRadius - radius) * i / (points.length - 1);
        return Array.from({ length: sides }, (_, j) => p.clone().addScaledVector(u, Math.cos(j / sides * Math.PI * 2) * r).addScaledVector(v, Math.sin(j / sides * Math.PI * 2) * r));
      });
      for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < sides; j++) {
        const k = (j + 1) % sides;
        tri(rings[i][j], rings[i][k], rings[i + 1][j], color);
        tri(rings[i][k], rings[i + 1][k], rings[i + 1][j], color);
      }
    }
    function anther(p, direction, scale = 1) {
      const along = direction.clone().normalize().multiplyScalar(0.0035 * scale);
      const a = p.clone().add(along), b = p.clone().sub(along);
      const u = V(0, 0.00125 * scale, 0), v = V(0.00125 * scale, 0, 0.001 * scale);
      if (level === 1) {
        const c = p.clone().add(u), d = p.clone().sub(u);
        tri(a, c, b, pollen); tri(a, b, d, pollen);
        tri(a, p.clone().add(v), b, pollen); tri(a, b, p.clone().sub(v), pollen);
        return;
      }
      const ring = [p.clone().add(u), p.clone().add(v), p.clone().sub(u), p.clone().sub(v)];
      for (let i = 0; i < 4; i++) { tri(a, ring[i], ring[(i + 1) % 4], pollen); tri(b, ring[(i + 1) % 4], ring[i], pollen); }
    }
    // Slight lean, no leaves: the foliage appears after the flowering stalk dies.
    const crown = V(0.022, 0.58, -0.007);
    const stalk = Array.from({ length: level === 0 ? 7 : 4 }, (_, i, a) => V(0, 0, 0));
    for (let i = 0; i < stalk.length; i++) {
      const t = i / (stalk.length - 1);
      stalk[i].set(crown.x * t * t, crown.y * t, crown.z * t * t);
    }
    tube(stalk, 0.0035, level === 0 ? 8 : 4, green, 0.0026);
    const florets = level === 2 ? 5 : 6;
    for (let f = 0; f < florets; f++) {
      const angle = f / florets * Math.PI * 2 + 0.14;
      const radial = V(Math.cos(angle), 0, Math.sin(angle));
      const tangent = V(-Math.sin(angle), 0, Math.cos(angle));
      const axis = radial.clone().multiplyScalar(0.77).add(V(0, 0.638, 0)).normalize();
      const ortho = tangent.clone().cross(axis).normalize();
      const throat = crown.clone().addScaledVector(radial, 0.047).add(V(0, 0.023 + Math.sin(angle * 3) * 0.006, 0));
      if (level < 2) tube([crown, throat], 0.002, 4, greenLight, 0.0023);
      const petals = level === 2 ? 3 : 6;
      for (let p = 0; p < petals; p++) {
        const theta = p / petals * Math.PI * 2 + f * 0.27;
        const spread = tangent.clone().multiplyScalar(Math.cos(theta)).addScaledVector(ortho, Math.sin(theta));
        const steps = level === 0 ? 18 : level === 1 ? 6 : 4;
        const points = [];
        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          // Narrow tepals flare, then roll backwards into hooked, wavy tips.
          const flare = 0.080 * Math.sin(t * Math.PI * 0.76);
          const forward = 0.057 * Math.sin(t * Math.PI * 0.96) - 0.041 * t * t;
          points.push(throat.clone().addScaledVector(spread, flare).addScaledVector(axis, forward));
        }
        ribbon(points, level === 2 ? 0.0038 : 0.0043, p % 3 === 0 ? petalEdge : crimson, level === 0 ? 0.32 : 0.19, axis);
      }
      const stamens = level === 2 ? 2 : 6;
      for (let s = 0; s < stamens; s++) {
        const theta = s / stamens * Math.PI * 2 + 0.3;
        const lateral = tangent.clone().multiplyScalar(Math.cos(theta) * 0.039);
        const end = throat.clone().addScaledVector(radial, 0.097 + Math.sin(theta) * 0.019).add(lateral).add(V(0, 0.055 + Math.sin(theta) * 0.028, 0));
        const ctrl = throat.clone().addScaledVector(radial, 0.051).addScaledVector(lateral, 0.32).add(V(0, 0.104 + Math.sin(theta) * 0.026, 0));
        const points = [], steps = level === 0 ? 14 : level === 1 ? 5 : 4;
        for (let k = 0; k <= steps; k++) {
          const t = k / steps, q = 1 - t;
          points.push(throat.clone().multiplyScalar(q * q).addScaledVector(ctrl, 2 * q * t).addScaledVector(end, t * t));
        }
        if (level === 0) tube(points, 0.00065, 3, filament, 0.00043);
        else ribbon(points, level === 1 ? 0.00075 : 0.0010, filament, 0, tangent);
        if (level < 2) anther(end, tangent, level === 0 ? 1 : 1.1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    // Weld matching position AND color attributes before averaging normals.
    // Flat normals on every triangle make thin petals look like folded paper.
    const smoothGeometry = mergeVertices(geometry, 0.000001);
    geometry.dispose();
    smoothGeometry.computeVertexNormals();
    smoothGeometry.computeBoundingSphere();
    return smoothGeometry;
  }

  const geometries = [plantGeometry(0), plantGeometry(1), plantGeometry(2)];
  const buckets = new Map();
  const counts = [1600, 7800, 18000];
  const dummy = new THREE.Object3D();
  function add(level, x, z, size, rotation, tint) {
    const heroX = riverCenter(-8) + shore(-8) + 2.15;
    if ((x - heroX) ** 2 + (z + 8) ** 2 < 2.2 ** 2) return;
    // Clear ground for composed cairns and camera positions; no random() is
    // consumed here, so the rest of the seeded meadow keeps its layout.
    for (const e of exclusions) if ((x - e.x) ** 2 + (z - e.z) ** 2 < e.r ** 2) return;
    const key = `${level}:${Math.floor(z / 18)}`;
    if (!buckets.has(key)) buckets.set(key, { level, plants: [] });
    const y = bankHeight(x, z);
    if (!Number.isFinite(y) || y < 0.065) return;
    buckets.get(key).plants.push({ x, y: y + 0.007, z, size, rotation, tint });
  }
  for (let level = 0; level < 3; level++) {
    let placed = 0, attempts = 0;
    while (placed < counts[level] && attempts++ < counts[level] * 15) {
      const side = random() < (level === 0 ? 0.28 : 0.5) ? -1 : 1;
      const z = level === 0 ? 12 - random() * 47 : level === 1 ? 13 - random() * 128 : -73 - random() * 147;
      const offset = level === 0 ? 2.15 + random() * 2.9 : 2.25 + random() * (level === 1 ? 9.2 : 16.5);
      if (level === 1 && z > -35 && offset < 6.3) continue;
      if (level === 2 && z > -115 && offset < 15.45) continue;
      // Low frequency gaps and thick drifts keep the meadow from looking like a grid.
      const patch = Math.sin(z * 0.29 + offset * 1.2) * Math.sin(z * 0.09 - offset * 1.8);
      if (random() > 0.52 + patch * 0.45) continue;
      if (offset < 2.8 && random() > 0.60) continue;
      const x = riverCenter(z) + side * (shore(z) + offset);
      const size = 0.71 + random() * 0.52;
      add(level, x, z, size, random() * Math.PI * 2, 0.74 + random() * 0.29);
      placed++;
    }
  }
  // A few legible individual silhouettes on the close shore.
  for (let i = 0; i < 132; i++) {
    const z = 4.0 - Math.floor(i / 22) * 5.0 + (random() - 0.5) * 2.1;
    const side = i % 9 === 0 ? -1 : 1;
    // Irregular small tongues of flowers reach into the otherwise stony apron.
    add(0, riverCenter(z) + side * (shore(z) + 1.18 + random() * 1.18), z, 1.02 + random() * 0.18, random() * Math.PI * 2, 0.98);
  }
  let instanceCount = 0, triangleCount = 0;
  for (const [key, { level, plants }] of buckets) {
    if (!plants.length) continue;
    const mesh = new THREE.InstancedMesh(geometries[level], material, plants.length);
    mesh.name = `Spider lilies LOD ${level} / bank ${key}`;
    for (let i = 0; i < plants.length; i++) {
      const p = plants[i];
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set((i % 7 - 3) * 0.027, p.rotation, (i % 5 - 2) * 0.028);
      dummy.scale.setScalar(p.size);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, new THREE.Color().setScalar(p.tint));
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = level === 0;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    if (mesh.boundingSphere) mesh.boundingSphere.radius += 0.04;
    field.add(mesh);
    instanceCount += plants.length;
    triangleCount += geometries[level].index.count / 3 * plants.length;
  }
  field.userData.update = time => { clock.value = time; };
  field.userData.flowerCount = instanceCount;
  field.userData.triangleCount = triangleCount;
  field.userData.geometryLOD = geometries.map(g => g.index.count / 3);
  field.userData.dispose = () => { geometries.forEach(g => g.dispose()); material.dispose(); };
  return field;
}
