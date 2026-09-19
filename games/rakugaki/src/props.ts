import * as THREE from "three";
import { ROAD_HALF_WIDTH, type Course, type RoadPoint } from "./course";
import type { ToonFactory } from "./render";
import { placeBetween, rand } from "./util";

export interface Environment {
  group: THREE.Group;
  update(dt: number, t: number): void;
}

interface Bird {
  group: THREE.Group;
  wings: [THREE.Mesh, THREE.Mesh];
  cx: number;
  cz: number;
  r: number;
  y: number;
  phase: number;
  speed: number;
}

const dummy = new THREE.Object3D();

export function buildEnvironment(course: Course, toon: ToonFactory): Environment {
  const group = new THREE.Group();
  const w = ROAD_HALF_WIDTH;
  const shadowed = <T extends THREE.Object3D>(m: T): T => {
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };
  const rp: RoadPoint = { x: 0, z: 0, h: 0, dx: 0, dz: 0 };

  // ---- guardrails and the pipeline ----
  const railMat = toon(0x8d8a9c);
  const pipeMat = toon(0xd98a4f);
  const postMat = toon(0x6f6c7d);
  const postGeo = new THREE.CylinderGeometry(0.045, 0.045, 1, 6);
  const railGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 8);
  const pipeGeo = new THREE.CylinderGeometry(0.13, 0.13, 1, 10);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (const r of course.rails) {
    const tube = shadowed(new THREE.Mesh(r.kind === "pipe" ? pipeGeo : railGeo, r.kind === "pipe" ? pipeMat : railMat));
    placeBetween(tube, r.a, r.b);
    group.add(tube);
    const len = r.a.distanceTo(r.b);
    const spacing = r.kind === "pipe" ? 7.5 : 3.6;
    const count = Math.max(2, Math.round(len / spacing) + 1);
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      a.lerpVectors(r.a, r.b, t);
      b.set(a.x, course.height(a.x, a.z) - 0.2, a.z);
      if (a.y - b.y < 0.1) continue;
      const post = shadowed(new THREE.Mesh(postGeo, postMat));
      placeBetween(post, b, a);
      group.add(post);
    }
  }

  // ---- boost pads ----
  const padMat = toon(0xf3d15e, { emissive: 0x6b5410, emissiveIntensity: 0.25 });
  const chevronMat = toon(0x2a2733);
  const padGeo = new THREE.BoxGeometry(4.2, 0.08, 5.6);
  const chevGeo = new THREE.BoxGeometry(0.26, 0.05, 1.5);
  for (const p of course.boosts) {
    const pad = new THREE.Group();
    const base = new THREE.Mesh(padGeo, padMat);
    base.receiveShadow = true;
    pad.add(base);
    for (let i = 0; i < 3; i++) {
      const z0 = -1.6 + i * 1.4;
      for (const side of [-1, 1]) {
        const c = new THREE.Mesh(chevGeo, chevronMat);
        c.position.set(side * 0.55, 0.06, z0);
        c.rotation.y = side * 0.75;
        pad.add(c);
      }
    }
    pad.position.set(p.x, p.y + 0.05, p.z);
    pad.rotation.y = p.yaw;
    group.add(pad);
  }

  // ---- chevron signs on the hairpins ----
  const signMat = toon(0xf3d15e);
  const signInk = toon(0x2a2733);
  const signPostGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.7, 6);
  const diamondGeo = new THREE.BoxGeometry(1.0, 1.0, 0.08);
  const arrowGeo = new THREE.BoxGeometry(0.5, 0.14, 0.1);
  for (const s of course.signs) {
    const sign = new THREE.Group();
    const post = shadowed(new THREE.Mesh(signPostGeo, postMat));
    post.position.y = 0.85;
    const diamond = shadowed(new THREE.Mesh(diamondGeo, signMat));
    diamond.position.y = 2.1;
    diamond.rotation.z = Math.PI / 4;
    const arrowA = new THREE.Mesh(arrowGeo, signInk);
    const arrowB = new THREE.Mesh(arrowGeo, signInk);
    const dir = s.left ? 1 : -1;
    arrowA.position.set(dir * 0.16, 2.28, 0.06);
    arrowA.rotation.z = dir * 0.8;
    arrowB.position.set(dir * 0.16, 1.92, 0.06);
    arrowB.rotation.z = -dir * 0.8;
    sign.add(post, diamond, arrowA, arrowB);
    sign.position.set(s.x, s.y, s.z);
    sign.rotation.y = s.yaw + Math.PI;
    group.add(sign);
  }

  // ---- start and finish gates ----
  const gate = (sq: number, color: number) => {
    course.roadPoint(sq, rp);
    const lx = -rp.dz;
    const lz = rp.dx;
    const g = new THREE.Group();
    const postG = new THREE.CylinderGeometry(0.13, 0.13, 5.2, 8);
    const pm = toon(0x2a2733);
    for (const side of [-1, 1]) {
      const px = side * (w + 0.9);
      const post = shadowed(new THREE.Mesh(postG, pm));
      const gx = rp.x + lx * px;
      const gz = rp.z + lz * px;
      post.position.set(gx, course.height(gx, gz) + 2.6, gz);
      g.add(post);
    }
    const banner = shadowed(new THREE.Mesh(new THREE.BoxGeometry(2 * w + 2.2, 1.1, 0.16), toon(color)));
    banner.position.set(rp.x, rp.h + 4.7, rp.z);
    banner.rotation.y = Math.atan2(rp.dx, rp.dz);
    g.add(banner);
    const stripeGeo = new THREE.BoxGeometry(0.5, 0.5, 0.2);
    for (let i = 0; i < 8; i++) {
      const stripe = new THREE.Mesh(stripeGeo, i % 2 === 0 ? signInk : toon(0xffffff));
      const off = -w + 0.6 + i * 1.2;
      stripe.position.set(rp.x + lx * off, rp.h + 4.7, rp.z + lz * off);
      stripe.rotation.y = Math.atan2(rp.dx, rp.dz);
      g.add(stripe);
    }
    group.add(g);
  };
  gate(course.startS + 6, 0x62c2b0);
  gate(course.finishS, 0xf2685f);

  // ---- road rocks ----
  const rockMat = toon(0xbdb8cb);
  const rockDark = toon(0x9a94ad);
  const roadRockGeo = new THREE.DodecahedronGeometry(1.1, 0);
  for (const o of course.obstacles) {
    if (o.kind !== "rock") continue;
    const m = shadowed(new THREE.Mesh(roadRockGeo, rockMat));
    m.position.set(o.x, course.height(o.x, o.z) + 0.6, o.z);
    m.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
    group.add(m);
  }

  // ---- scattered rocks (instanced) ----
  {
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const inst = new THREE.InstancedMesh(geo, rockDark, course.rocks.length);
    course.rocks.forEach((r, i) => {
      dummy.position.set(r.x, r.y, r.z);
      dummy.rotation.set(r.rot, r.rot * 1.7, 0);
      dummy.scale.setScalar(r.s);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    inst.castShadow = true;
    inst.receiveShadow = true;
    group.add(inst);
  }

  // ---- pines (instanced trunk + three cones) ----
  {
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.28, 1.6, 7);
    trunkGeo.translate(0, 0.8, 0);
    const cones = [
      new THREE.ConeGeometry(1.5, 2.6, 8),
      new THREE.ConeGeometry(1.15, 2.2, 8),
      new THREE.ConeGeometry(0.8, 1.9, 8),
    ];
    cones[0].translate(0, 2.4, 0);
    cones[1].translate(0, 3.5, 0);
    cones[2].translate(0, 4.5, 0);
    const trunkMat = toon(0x8a5a3c);
    const leafMats = [toon(0x5fae57), toon(0x6fbd62), toon(0x82c96c)];
    const n = course.pines.length;
    const meshes = [
      new THREE.InstancedMesh(trunkGeo, trunkMat, n),
      ...cones.map((c, i) => new THREE.InstancedMesh(c, leafMats[i], n)),
    ];
    course.pines.forEach((p, i) => {
      dummy.position.set(p.x, p.y - 0.15, p.z);
      dummy.rotation.set(0, rand(0, Math.PI * 2), 0);
      dummy.scale.setScalar(p.s);
      dummy.updateMatrix();
      for (const m of meshes) m.setMatrixAt(i, dummy.matrix);
    });
    for (const m of meshes) {
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
  }

  // ---- far mountains ----
  const cxCourse = (course.extent.x0 + course.extent.x1) / 2;
  const czCourse = (course.extent.z0 + course.extent.z1) / 2;
  const mountainMat = toon(0xd3d6e4, { fog: false });
  const mountainFar = toon(0xe1e3ec, { fog: false });
  const snowMat = toon(0xffffff, { fog: false });
  for (let i = 0; i < 9; i++) {
    const ang = (i / 9) * Math.PI * 2 + 0.3;
    const dist = 520 + (i % 3) * 90;
    const hgt = 150 + ((i * 37) % 90);
    const radius = 170 + ((i * 53) % 110);
    const m = new THREE.Mesh(new THREE.ConeGeometry(radius, hgt, 7), i % 2 ? mountainMat : mountainFar);
    const mx = cxCourse + Math.cos(ang) * dist;
    const mz = czCourse + Math.sin(ang) * dist;
    m.position.set(mx, -70 + hgt / 2, mz);
    m.rotation.y = i;
    group.add(m);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.3, hgt * 0.3, 7), snowMat);
    cap.position.set(mx, -70 + hgt - hgt * 0.15 + 0.5, mz);
    cap.rotation.y = i;
    group.add(cap);
  }

  // ---- sun ----
  const sun = new THREE.Group();
  const sunMat = toon(0x000000, { emissive: 0xf9d64a, emissiveIntensity: 1, fog: false });
  sun.add(new THREE.Mesh(new THREE.CircleGeometry(18, 40), sunMat));
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * Math.PI * 2;
    const ray = new THREE.Mesh(new THREE.BoxGeometry(2.2, 9, 0.6), sunMat);
    ray.position.set(Math.cos(ang) * 27, Math.sin(ang) * 27, 0);
    ray.rotation.z = ang - Math.PI / 2;
    sun.add(ray);
  }
  sun.position.set(cxCourse - 190, 300, czCourse + 420);
  sun.lookAt(cxCourse, 40, czCourse);
  group.add(sun);

  // ---- clouds ----
  const cloudMat = toon(0xffffff, { emissive: 0x9fb2cc, emissiveIntensity: 0.45, fog: false });
  const cloudGeo = new THREE.SphereGeometry(1, 16, 12);
  const clouds: THREE.Group[] = [];
  for (let i = 0; i < 11; i++) {
    const cloud = new THREE.Group();
    const puffs = 4 + Math.floor(rand(0, 3));
    for (let k = 0; k < puffs; k++) {
      const puff = new THREE.Mesh(cloudGeo, cloudMat);
      puff.position.set(rand(-6, 6), rand(-1, 2), rand(-1.5, 1.5));
      puff.scale.setScalar(rand(2.6, 4.6));
      cloud.add(puff);
    }
    const ang = (i / 11) * Math.PI * 2;
    cloud.position.set(cxCourse + Math.cos(ang) * rand(200, 380), rand(70, 130), czCourse + Math.sin(ang) * rand(200, 380));
    cloud.scale.setScalar(3.2);
    clouds.push(cloud);
    group.add(cloud);
  }

  // ---- birds ----
  const birdMat = toon(0x2a2733);
  const wingGeo = new THREE.BoxGeometry(0.9, 0.06, 0.2);
  const birds: Bird[] = [];
  for (let i = 0; i < 7; i++) {
    const g = new THREE.Group();
    const wings: [THREE.Mesh, THREE.Mesh] = [new THREE.Mesh(wingGeo, birdMat), new THREE.Mesh(wingGeo, birdMat)];
    wings[0].position.x = 0.42;
    wings[1].position.x = -0.42;
    g.add(...wings);
    group.add(g);
    course.roadPoint(rand(0, course.totalLength), rp);
    birds.push({
      group: g,
      wings,
      cx: rp.x + rand(-40, 40),
      cz: rp.z + rand(-40, 40),
      r: rand(18, 40),
      y: rp.h + rand(16, 30),
      phase: rand(0, Math.PI * 2),
      speed: rand(0.1, 0.2),
    });
  }

  return {
    group,
    update(dt, t) {
      for (const bird of birds) {
        const ang = t * bird.speed + bird.phase;
        bird.group.position.set(
          bird.cx + Math.cos(ang) * bird.r,
          bird.y + Math.sin(t * 0.7 + bird.phase) * 0.6,
          bird.cz + Math.sin(ang) * bird.r,
        );
        bird.group.rotation.y = -ang;
        const flap = Math.sin(t * 9 + bird.phase) * 0.55;
        bird.wings[0].rotation.z = flap;
        bird.wings[1].rotation.z = -flap;
      }
      for (let i = 0; i < clouds.length; i++) clouds[i].position.x += Math.sin(t * 0.05 + i) * dt * 0.8;
    },
  };
}
