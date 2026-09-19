import * as THREE from "three";
import { ROAD_HALF_WIDTH, type Course, type RoadPoint } from "./course";
import type { ToonFactory } from "./render";
import { placeBetween, rand } from "./util";

export interface Environment {
  group: THREE.Group;
  /** Advance animations. `skaterS` drives the rockfall trigger; `finished` starts the confetti. */
  update(dt: number, t: number, skaterS: number, finished: boolean): void;
  /** Hide the stickers already found (they still spin for the ones left). */
  setStickers(found: Set<number>): void;
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
  const ink = toon(0x2a2733);
  const wood = toon(0xd9a066);
  const woodDark = toon(0xb07a45);
  const yellow = toon(0xf3d15e);
  const red = toon(0xf2685f);
  const teal = toon(0x62c2b0);
  const white = toon(0xffffff);
  const paper = toon(0xf4f0e6);
  const updaters: ((dt: number, t: number) => void)[] = [];

  // ---- guardrails, copings, the pipeline and the zip-line ----
  const railMat = toon(0x8d8a9c);
  const pipeMat = toon(0xd98a4f);
  const postMat = toon(0x6f6c7d);
  const postGeo = new THREE.CylinderGeometry(0.045, 0.045, 1, 6);
  const railGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 8);
  const pipeGeo = new THREE.CylinderGeometry(0.13, 0.13, 1, 10);
  const copingGeo = new THREE.CylinderGeometry(0.1, 0.1, 1, 8);
  const wireGeo = new THREE.CylinderGeometry(0.04, 0.04, 1, 6);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const rainbowMats = [0xf2685f, 0xf3a25e, 0xf3d15e, 0x9bd47f, 0x62c2b0, 0x7aa4e6, 0xb197e3].map((c) =>
    toon(c, { emissive: c, emissiveIntensity: 0.25 }),
  );
  const loopMat = toon(0xf2685f);
  const loopGeo = new THREE.CylinderGeometry(0.42, 0.42, 1, 10);
  for (const r of course.rails) {
    if (r.kind === "rainbow") {
      // seven thin bands side by side make the arc read as a rainbow
      const dir = new THREE.Vector3().subVectors(r.b, r.a).normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
      for (let k = 0; k < 7; k++) {
        const off = (k - 3) * 0.32;
        const a2 = r.a.clone().addScaledVector(side, off);
        const b2 = r.b.clone().addScaledVector(side, off);
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1, 6), rainbowMats[k]);
        placeBetween(band, a2, b2);
        group.add(band);
      }
      continue;
    }
    if (r.kind === "loop") {
      const tube = shadowed(new THREE.Mesh(loopGeo, loopMat));
      placeBetween(tube, r.a, r.b);
      group.add(tube);
      if (r.center) {
        // spokes to the ground make the loop stand up
        const mid = new THREE.Vector3().lerpVectors(r.a, r.b, 0.5);
        if (mid.y > r.center.y - 1 && Math.abs(mid.y - r.center.y) < 5.5) {
          const foot = new THREE.Vector3(mid.x, course.height(mid.x, mid.z), mid.z);
          const strut = new THREE.Mesh(postGeo, postMat);
          placeBetween(strut, foot, mid);
          group.add(strut);
        }
      }
      continue;
    }
    const geo = r.kind === "pipe" ? pipeGeo : r.kind === "coping" ? copingGeo : r.kind === "wire" ? wireGeo : railGeo;
    const mat = r.kind === "pipe" ? pipeMat : r.kind === "coping" ? toon(0xd9d3c7) : r.kind === "wire" ? ink : railMat;
    const tube = shadowed(new THREE.Mesh(geo, mat));
    placeBetween(tube, r.a, r.b);
    group.add(tube);
    if (r.kind === "wire" || r.kind === "coping") continue;
    const len = r.a.distanceTo(r.b);
    const spacing = r.kind === "pipe" ? 7.5 : 3.6;
    const count = Math.max(2, Math.round(len / spacing) + 1);
    for (let i = 0; i < count; i++) {
      const tt = i / (count - 1);
      a.lerpVectors(r.a, r.b, tt);
      b.set(a.x, course.height(a.x, a.z) - 0.2, a.z);
      if (a.y - b.y < 0.1) continue;
      const post = shadowed(new THREE.Mesh(postGeo, postMat));
      placeBetween(post, b, a);
      group.add(post);
    }
  }
  {
    // zip-line pylons and a gondola that rides the cable
    const wires = course.rails.filter((r) => r.kind === "wire");
    if (wires.length) {
      const first = wires[0];
      const last = wires[wires.length - 1];
      for (const p of [first.a, last.b]) {
        const pylon = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.6, 1, 0.6), postMat));
        const base = new THREE.Vector3(p.x, course.height(p.x, p.z) - 0.5, p.z);
        placeBetween(pylon, base, new THREE.Vector3(p.x, p.y + 0.6, p.z));
        pylon.scale.x = 0.6;
        pylon.scale.z = 0.6;
        group.add(pylon);
      }
      const cabin = new THREE.Group();
      const body = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 2.2), teal));
      body.position.y = -1.6;
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.0, 6), ink);
      arm.position.y = -0.5;
      const win = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 1.4), toon(0xbfe6f5));
      win.position.y = -1.3;
      cabin.add(body, arm, win);
      group.add(cabin);
      updaters.push((_dt, t) => {
        const u = (t / 14) % 1;
        cabin.position.lerpVectors(first.a, last.b, u);
        cabin.position.y -= 0.1;
        cabin.rotation.z = Math.sin(t * 1.3) * 0.05;
      });
    }
  }

  // ---- boost pads ----
  const padMat = toon(0xf3d15e, { emissive: 0x6b5410, emissiveIntensity: 0.25 });
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
        const c = new THREE.Mesh(chevGeo, ink);
        c.position.set(side * 0.55, 0.06, z0);
        c.rotation.y = side * 0.75;
        pad.add(c);
      }
    }
    pad.position.set(p.x, p.y + 0.05, p.z);
    pad.rotation.y = p.yaw;
    group.add(pad);
  }

  // ---- signs ----
  const signPostGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.7, 6);
  const diamondGeo = new THREE.BoxGeometry(1.0, 1.0, 0.08);
  const arrowGeo = new THREE.BoxGeometry(0.5, 0.14, 0.1);
  for (const s of course.signs) {
    const sign = new THREE.Group();
    const post = shadowed(new THREE.Mesh(signPostGeo, postMat));
    post.position.y = 0.85;
    sign.add(post);
    const big = s.kind === "hop" || s.kind === "shortcut";
    const face = s.kind === "gap" ? red : s.kind === "shortcut" ? teal : yellow;
    const diamond = shadowed(new THREE.Mesh(diamondGeo, face));
    diamond.position.y = big ? 2.4 : 2.1;
    diamond.rotation.z = Math.PI / 4;
    if (big) diamond.scale.setScalar(1.7);
    sign.add(diamond);
    if (s.kind === "chevron") {
      const dir = s.left ? 1 : -1;
      const arrowA = new THREE.Mesh(arrowGeo, ink);
      const arrowB = new THREE.Mesh(arrowGeo, ink);
      arrowA.position.set(dir * 0.16, 2.28, 0.06);
      arrowA.rotation.z = dir * 0.8;
      arrowB.position.set(dir * 0.16, 1.92, 0.06);
      arrowB.rotation.z = -dir * 0.8;
      sign.add(arrowA, arrowB);
    } else if (s.kind === "hop" || s.kind === "shortcut") {
      // a fat down-right arrow: "jump here"
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.1, 0.1), ink);
      shaft.position.set(0, 2.55, 0.08);
      shaft.rotation.z = 0.5;
      const headA = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 0.1), ink);
      headA.position.set(0.3, 2.05, 0.08);
      headA.rotation.z = -0.4;
      const headB = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 0.1), ink);
      headB.position.set(0.05, 1.95, 0.08);
      headB.rotation.z = 1.3;
      sign.add(shaft, headA, headB);
    } else if (s.kind === "gap") {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.7, 0.1), white);
      bar.position.set(0, 2.15, 0.08);
      const dot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.1), white);
      dot.position.set(0, 1.7, 0.08);
      sign.add(bar, dot);
    } else {
      // rockfall: a boulder silhouette
      const blob = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28, 0), ink);
      blob.position.set(0, 2.15, 0.1);
      sign.add(blob);
    }
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
    for (const side of [-1, 1]) {
      const px = side * (w + 0.9);
      const post = shadowed(new THREE.Mesh(postG, ink));
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
      const stripe = new THREE.Mesh(stripeGeo, i % 2 === 0 ? ink : white);
      const off = -w + 0.6 + i * 1.2;
      stripe.position.set(rp.x + lx * off, rp.h + 4.7, rp.z + lz * off);
      stripe.rotation.y = Math.atan2(rp.dx, rp.dz);
      g.add(stripe);
    }
    group.add(g);
  };
  gate(course.startS + 12, 0x62c2b0);
  gate(course.finishS - 22, 0xf2685f);

  // ---- summit tower and flags ----
  {
    const lm = course.landmarks.find((l) => l.kind === "summit");
    if (lm) {
      const tower = new THREE.Group();
      const [lx, lz] = [-Math.cos(lm.yaw), Math.sin(lm.yaw)];
      for (const side of [-1, 1]) {
        for (const back of [2, 8]) {
          const post = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6, 6), ink));
          const px = lm.x + lx * side * (w + 1.2) - Math.sin(lm.yaw) * back;
          const pz = lm.z + lz * side * (w + 1.2) - Math.cos(lm.yaw) * back;
          post.position.set(px, course.height(px, pz) + 3, pz);
          tower.add(post);
        }
        const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3, 5), ink);
        const fx = lm.x + lx * side * (w + 1.2) - Math.sin(lm.yaw) * 2;
        const fz = lm.z + lz * side * (w + 1.2) - Math.cos(lm.yaw) * 2;
        flagPole.position.set(fx, course.height(fx, fz) + 7.5, fz);
        const flag = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 0.06), side > 0 ? red : teal);
        flag.position.set(fx + lx * side * 0.7, course.height(fx, fz) + 8.4, fz + lz * side * 0.7);
        flag.rotation.y = lm.yaw + Math.PI / 2;
        tower.add(flagPole, flag);
        updaters.push((_dt, t) => {
          flag.rotation.y = lm.yaw + Math.PI / 2 + Math.sin(t * 3 + side) * 0.25;
        });
      }
      const board = shadowed(new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.2, 0.12), yellow));
      const bx = lm.x - Math.sin(lm.yaw) * 5;
      const bz = lm.z - Math.cos(lm.yaw) * 5;
      board.position.set(bx, course.height(bx, bz) + 5.2, bz);
      board.rotation.y = lm.yaw;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.4, 0.08), ink);
      frame.position.copy(board.position);
      frame.position.y -= 0.0;
      frame.rotation.y = lm.yaw;
      frame.position.addScaledVector(new THREE.Vector3(Math.sin(lm.yaw), 0, Math.cos(lm.yaw)), -0.05);
      tower.add(frame, board);
      group.add(tower);
    }
  }

  // ---- road rocks and the rockfall boulder ----
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
  {
    const bo = course.boulder;
    const mesh = shadowed(new THREE.Mesh(new THREE.DodecahedronGeometry(1.6, 0), rockDark));
    const home = new THREE.Vector3(bo.x, course.height(bo.x, bo.z) + 1.2, bo.z);
    mesh.position.copy(home);
    group.add(mesh);
    const pebbles: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3, 0), rockDark);
      p.visible = false;
      group.add(p);
      pebbles.push(p);
    }
    // path: from its perch across the road to the far edge
    const pieceS = course.pieces[4].s0;
    const target = course.railAt(pieceS + 100, -(w + 4), 0);
    let phase = 0; // 0 parked, 1 rolling, 2 resting
    let clock = 0;
    let triggered = false;
    updaters.push((dt, t) => {
      void t;
      if (phase === 0) return;
      clock += dt;
      if (phase === 1) {
        const u = Math.min(1, clock / 2.6);
        mesh.position.lerpVectors(home, target, u);
        mesh.position.y = course.height(mesh.position.x, mesh.position.z) + 1.2 + Math.abs(Math.sin(u * Math.PI * 3)) * 0.8;
        mesh.rotation.x += dt * 4;
        mesh.rotation.z += dt * 2.5;
        bo.x = mesh.position.x;
        bo.z = mesh.position.z;
        pebbles.forEach((p, i) => {
          p.visible = true;
          p.position.copy(mesh.position);
          p.position.x += Math.sin(t * 7 + i * 2) * 1.5;
          p.position.z += Math.cos(t * 6 + i) * 1.5;
          p.position.y = course.height(p.position.x, p.position.z) + 0.3 + Math.abs(Math.sin(t * 11 + i)) * 0.6;
        });
        if (u >= 1) {
          phase = 2;
          clock = 0;
        }
      } else if (phase === 2) {
        pebbles.forEach((p) => (p.visible = false));
        if (clock > 10) {
          phase = 0;
          bo.active = false;
          triggered = false;
          mesh.position.copy(home);
        }
      }
    });
    updaters.push(() => {
      /* the trigger is wired in update() below via closure */
    });
    // expose trigger through a closure captured by update()
    (group as THREE.Group & { __rockfall?: (s: number) => void }).__rockfall = (s: number) => {
      if (!triggered && phase === 0 && s > pieceS + 70 && s < pieceS + 100) {
        triggered = true;
        phase = 1;
        clock = 0;
        bo.active = true;
      }
    };
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
    const cones = [new THREE.ConeGeometry(1.5, 2.6, 8), new THREE.ConeGeometry(1.15, 2.2, 8), new THREE.ConeGeometry(0.8, 1.9, 8)];
    cones[0].translate(0, 2.4, 0);
    cones[1].translate(0, 3.5, 0);
    cones[2].translate(0, 4.5, 0);
    const trunkMat = toon(0x8a5a3c);
    const leafMats = [toon(0x5fae57), toon(0x6fbd62), toon(0x82c96c)];
    const n = course.pines.length;
    const meshes = [new THREE.InstancedMesh(trunkGeo, trunkMat, n), ...cones.map((c, i) => new THREE.InstancedMesh(c, leafMats[i], n))];
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

  // ---- sheep (instanced) ----
  {
    const n = course.sheep.length;
    if (n) {
      const bodyGeo = new THREE.SphereGeometry(0.55, 10, 8);
      bodyGeo.scale(1.25, 0.9, 0.9);
      bodyGeo.translate(0, 0.75, 0);
      const headGeo = new THREE.SphereGeometry(0.26, 8, 6);
      headGeo.translate(0.72, 0.85, 0);
      const legGeo = new THREE.BoxGeometry(0.9, 0.5, 0.5);
      legGeo.translate(0, 0.25, 0);
      const meshes = [
        new THREE.InstancedMesh(bodyGeo, white, n),
        new THREE.InstancedMesh(headGeo, ink, n),
        new THREE.InstancedMesh(legGeo, ink, n),
      ];
      course.sheep.forEach((s, i) => {
        dummy.position.set(s.x, s.y, s.z);
        dummy.rotation.set(0, s.rot, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        for (const m of meshes) m.setMatrixAt(i, dummy.matrix);
      });
      for (const m of meshes) {
        m.castShadow = true;
        group.add(m);
      }
    }
  }

  // ---- snowmen on the summit ----
  for (const sm of course.snowmen) {
    const g = new THREE.Group();
    const bottom = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 10), white));
    bottom.position.y = 0.6;
    const mid = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10), white));
    mid.position.y = 1.5;
    const head = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.36, 12, 10), white));
    head.position.y = 2.2;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.5, 6), toon(0xf08a3c));
    nose.position.set(0.4, 2.2, 0);
    nose.rotation.z = -Math.PI / 2;
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.4, 8), ink);
    hat.position.y = 2.65;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.05, 8), ink);
    brim.position.y = 2.48;
    g.add(bottom, mid, head, nose, hat, brim);
    g.position.set(sm.x, sm.y, sm.z);
    g.rotation.y = sm.rot;
    group.add(g);
  }

  // ---- torii gates with lanterns ----
  {
    const lanternMat = toon(0xf3d15e, { emissive: 0x8a6a10, emissiveIntensity: 0.5 });
    const gates = course.gates;
    gates.forEach((g, i) => {
      const tor = new THREE.Group();
      const postGeoT = new THREE.CylinderGeometry(0.25, 0.28, 5, 8);
      for (const side of [-1, 1]) {
        const post = shadowed(new THREE.Mesh(postGeoT, red));
        post.position.set(side * (w + 0.6), 2.5, 0);
        tor.add(post);
      }
      const top = shadowed(new THREE.Mesh(new THREE.BoxGeometry(2 * w + 3.2, 0.5, 0.5), ink));
      top.position.y = 5.2;
      const tie = shadowed(new THREE.Mesh(new THREE.BoxGeometry(2 * w + 1.4, 0.35, 0.4), red));
      tie.position.y = 4.4;
      for (const side of [-1, 1]) {
        const tip = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.5), ink);
        tip.position.set(side * (w + 1.7), 5.45, 0);
        tip.rotation.z = side * 0.35;
        tor.add(tip);
      }
      tor.add(top, tie);
      tor.position.set(g.x, g.y, g.z);
      tor.rotation.y = g.yaw;
      group.add(tor);
      if (i < gates.length - 1) {
        const next = gates[i + 1];
        for (let k = 1; k <= 2; k++) {
          const u = k / 3;
          const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), lanternMat);
          lantern.position.set(g.x + (next.x - g.x) * u, g.y + 4.3, g.z + (next.z - g.z) * u);
          group.add(lantern);
          const base = lantern.position.clone();
          updaters.push((_dt, t) => {
            lantern.position.x = base.x + Math.sin(t * 1.8 + i + k) * 0.25;
          });
        }
      }
    });
  }

  // ---- pencil tunnel ----
  {
    const lm = course.landmarks.find((l) => l.kind === "tunnel");
    if (lm) {
      const tunnel = new THREE.Group();
      const len = 34;
      // a giant pencil lying across the road: an open hexagonal tube you ride through
      const bodyMat = toon(0xf3d15e, { side: THREE.DoubleSide });
      const body = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(w + 1.9, w + 1.9, len, 6, 1, true), bodyMat));
      body.rotation.x = Math.PI / 2;
      body.rotation.y = Math.PI / 6;
      body.position.y = 1.4;
      tunnel.add(body);
      for (const end of [-1, 1]) {
        const ring = shadowed(new THREE.Mesh(new THREE.TorusGeometry(w + 1.9, 0.45, 8, 6), ink));
        ring.position.set(0, 1.4, (end * len) / 2);
        ring.rotation.z = Math.PI / 6;
        tunnel.add(ring);
      }
      for (let i = 0; i < 3; i++) {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, len - 2), ink);
        const ang = Math.PI / 2 + (i - 1) * 0.55;
        stripe.position.set(Math.cos(ang) * (w + 1.75), 1.4 + Math.sin(ang) * (w + 1.75), 0);
        stripe.rotation.z = ang - Math.PI / 2;
        tunnel.add(stripe);
      }
      const lanternMat = toon(0xf3d15e, { emissive: 0xb08a20, emissiveIntensity: 0.8 });
      for (let i = 0; i < 6; i++) {
        const l = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), lanternMat);
        l.position.set(0, 4.7, -len / 2 + 3 + i * 5.2);
        tunnel.add(l);
      }
      tunnel.position.set(lm.x, lm.y, lm.z);
      tunnel.rotation.y = lm.yaw;
      group.add(tunnel);
    }
  }

  // ---- waterfall ----
  {
    const lm = course.landmarks.find((l) => l.kind === "waterfall");
    if (lm) {
      const wf = new THREE.Group();
      const waterMat = toon(0x8fc4ec, { emissive: 0x2a5a80, emissiveIntensity: 0.2 });
      const slab = new THREE.Mesh(new THREE.BoxGeometry(4, 14, 0.5), waterMat);
      slab.position.set(0, -6.5, -2.5);
      slab.rotation.x = -0.35;
      wf.add(slab);
      const foamMat = white;
      for (let i = 0; i < 5; i++) {
        const foam = new THREE.Mesh(new THREE.SphereGeometry(0.8 + (i % 2) * 0.3, 8, 6), foamMat);
        foam.position.set(-2 + i, -12.8, -6.6 + Math.sin(i) * 0.6);
        wf.add(foam);
      }
      const streaks: THREE.Mesh[] = [];
      for (let i = 0; i < 6; i++) {
        const st = new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.2, 0.15), white);
        st.position.set(-1.5 + i * 0.6, 0, -2.2);
        wf.add(st);
        streaks.push(st);
      }
      updaters.push((_dt, t) => {
        streaks.forEach((s, i) => {
          const u = (t * 0.6 + i * 0.17) % 1;
          s.position.y = -u * 13;
          s.position.z = -2.2 - u * 4.4;
        });
      });
      wf.position.set(lm.x, lm.y, lm.z);
      wf.rotation.y = lm.yaw;
      group.add(wf);
    }
  }

  // ---- village ----
  {
    const wallColors = [0xf3c6d3, 0xf6e3a1, 0xbfe0f2];
    const roofColors = [0xd66a5a, 0x5c6fa8, 0xe08c5a];
    let i = 0;
    for (const lm of course.landmarks) {
      if (lm.kind !== "village") continue;
      const house = new THREE.Group();
      const hw = 5 + (i % 2);
      const hd = 4.2;
      const hh = 3 + (i % 3) * 0.3;
      const body = shadowed(new THREE.Mesh(new THREE.BoxGeometry(hw, hh, hd), toon(wallColors[i % 3])));
      body.position.y = hh / 2;
      const roof = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0, Math.max(hw, hd) * 0.78, hh * 0.55, 4), toon(roofColors[i % 3])));
      roof.position.y = hh + hh * 0.275;
      roof.rotation.y = Math.PI / 4;
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.6, 0.12), toon(0x5a4a5c));
      door.position.set(-hw * 0.2, 0.8, hd / 2 + 0.02);
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, 0.12), toon(0xbfe6f5));
      win.position.set(hw * 0.25, hh * 0.55, hd / 2 + 0.02);
      const chimney = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.4, 0.6), ink));
      chimney.position.set(hw * 0.3, hh + 0.9, -hd * 0.2);
      house.add(body, roof, door, win, chimney);
      house.position.set(lm.x, lm.y - 0.4, lm.z);
      house.rotation.y = lm.yaw + (i % 2 ? 0.3 : -0.2);
      if (lm.data === 3) house.scale.setScalar(0.85);
      group.add(house);
      const puffs: THREE.Mesh[] = [];
      for (let k = 0; k < 3; k++) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(0.35 + k * 0.1, 8, 6), paper);
        group.add(puff);
        puffs.push(puff);
      }
      const chimneyWorld = new THREE.Vector3();
      house.updateMatrixWorld(true);
      chimney.getWorldPosition(chimneyWorld);
      updaters.push((_dt, t) => {
        puffs.forEach((p, k) => {
          const u = (t * 0.25 + k * 0.33) % 1;
          p.position.set(chimneyWorld.x + Math.sin(u * 6 + k) * 0.6, chimneyWorld.y + 1 + u * 5, chimneyWorld.z);
          p.scale.setScalar(0.6 + u * 1.2);
        });
      });
      i++;
    }
  }

  // ---- lake dock and boat ----
  {
    const lm = course.landmarks.find((l) => l.kind === "lake");
    if (lm) {
      const dock = new THREE.Group();
      const deck = shadowed(new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.25, 12), wood));
      deck.position.set(0, 0.5, -20);
      dock.add(deck);
      for (let i = 0; i < 4; i++) {
        for (const side of [-1, 1]) {
          const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.2, 6), woodDark);
          pile.position.set(side * 0.95, -0.4, -26 + i * 4);
          dock.add(pile);
        }
      }
      const boat = new THREE.Group();
      const hull = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 3.4), red));
      const bow = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.4, 4), red);
      bow.rotation.x = -Math.PI / 2;
      bow.rotation.y = Math.PI / 4;
      bow.position.z = 2.3;
      boat.add(hull, bow);
      boat.position.set(4, 0.3, -12);
      dock.add(boat);
      updaters.push((_dt, t) => {
        boat.position.y = 0.3 + Math.sin(t * 1.2) * 0.12;
        boat.rotation.z = Math.sin(t * 0.9) * 0.06;
      });
      dock.position.set(lm.x, lm.y, lm.z);
      dock.rotation.y = lm.yaw + Math.PI / 2;
      group.add(dock);
    }
  }

  // ---- speed trap gantry ----
  {
    const lm = course.landmarks.find((l) => l.kind === "trap");
    if (lm) {
      const g = new THREE.Group();
      for (const side of [-1, 1]) {
        const post = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 5, 6), ink));
        post.position.set(side * (w + 0.9), 2.5, 0);
        g.add(post);
      }
      const bar = shadowed(new THREE.Mesh(new THREE.BoxGeometry(2 * w + 2.2, 0.8, 0.16), white));
      bar.position.y = 4.6;
      g.add(bar);
      for (let i = 0; i < 9; i++) {
        const sq = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.2), i % 2 ? ink : white);
        sq.position.set(-w + 0.5 + i * 1.15, 4.6, 0);
        g.add(sq);
      }
      const cam = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.5), ink);
      cam.position.set(0, 5.2, 0.2);
      g.add(cam);
      g.position.set(lm.x, lm.y, lm.z);
      g.rotation.y = lm.yaw;
      group.add(g);
    }
  }

  // ---- candy poles along the finish kicker + confetti ----
  const confetti: { mesh: THREE.Mesh; v: THREE.Vector3; spin: number }[] = [];
  {
    const lm = course.landmarks.find((l) => l.kind === "finishKicker");
    if (lm) {
      for (let i = 0; i < 12; i++) {
        const side = i % 2 ? 1 : -1;
        const t = course.finishS - 22 + Math.floor(i / 2) * 2.4;
        const p = course.railAt(t, side * (w + 0.5), 0);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.4, 6), i % 4 < 2 ? red : white);
        pole.position.set(p.x, p.y + 1.2, p.z);
        group.add(pole);
      }
      const colors = [red, teal, yellow];
      for (let i = 0; i < 90; i++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.04), colors[i % 3]);
        m.visible = false;
        group.add(m);
        confetti.push({ mesh: m, v: new THREE.Vector3(), spin: rand(2, 6) });
      }
    }
  }
  let confettiOn = false;
  let confettiClock = 0;
  const startConfetti = (x: number, y: number, z: number) => {
    confettiOn = true;
    confettiClock = 0;
    for (const c of confetti) {
      c.mesh.visible = true;
      c.mesh.position.set(x + rand(-4, 4), y + rand(2, 6), z + rand(-4, 4));
      c.v.set(rand(-3, 3), rand(3, 9), rand(-3, 3));
    }
  };

  // ---- loop-the-loop frame: a big ink ring with candy stripes and two legs ----
  {
    const lm = course.landmarks.find((l) => l.kind === "loop");
    if (lm) {
      const R = lm.data ?? 6;
      const frame = new THREE.Group();
      const ring = shadowed(new THREE.Mesh(new THREE.TorusGeometry(R + 0.55, 0.32, 8, 40), ink));
      frame.add(ring);
      for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * Math.PI * 2;
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.7), i % 2 ? yellow : white);
        stripe.position.set(Math.cos(ang) * (R + 0.55), Math.sin(ang) * (R + 0.55), 0);
        stripe.rotation.z = ang;
        frame.add(stripe);
      }
      frame.position.set(lm.x, lm.y, lm.z);
      frame.rotation.y = lm.yaw - Math.PI / 2;
      group.add(frame);
      const side = new THREE.Vector3(Math.cos(lm.yaw), 0, -Math.sin(lm.yaw));
      for (const sgn of [-1, 1]) {
        const top = new THREE.Vector3(lm.x, lm.y + R * 0.5, lm.z).addScaledVector(side, sgn * 0.9);
        const foot = new THREE.Vector3(top.x, course.height(top.x, top.z) - 0.3, top.z);
        const leg = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1, 6), postMat));
        placeBetween(leg, foot, top);
        group.add(leg);
      }
    }
  }

  // ---- stickers: spinning stars ----
  const stickerMeshes = new Map<number, THREE.Group>();
  {
    const shape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const rad = i % 2 === 0 ? 0.9 : 0.4;
      if (i === 0) shape.moveTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
      else shape.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
    }
    shape.closePath();
    const starGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false });
    const starMat = toon(0xf3d15e, { emissive: 0x9a7a10, emissiveIntensity: 0.6, side: THREE.DoubleSide });
    for (const st of course.stickers) {
      const g = new THREE.Group();
      const star = new THREE.Mesh(starGeo, starMat);
      star.position.z = -0.06;
      const halo = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.05, 6, 20), ink);
      g.add(star, halo);
      g.position.set(st.x, st.y, st.z);
      group.add(g);
      stickerMeshes.set(st.id, g);
    }
    updaters.push((_dt, t) => {
      for (const [id, g] of stickerMeshes) {
        g.rotation.y = t * 1.6 + id;
        g.position.y = course.stickers[id].y + Math.sin(t * 2 + id) * 0.25;
      }
    });
  }

  // ---- ring of fire above the finish kicker ----
  {
    const lm = course.landmarks.find((l) => l.kind === "ring");
    if (lm) {
      const ring = new THREE.Group();
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.28, 8, 28), toon(0x2a2733));
      ring.add(hoop);
      const flameMat = toon(0xf2685f, { emissive: 0xd9451f, emissiveIntensity: 0.6 });
      const flameMat2 = toon(0xf3d15e, { emissive: 0xc79a10, emissiveIntensity: 0.6 });
      const flames: THREE.Mesh[] = [];
      for (let i = 0; i < 18; i++) {
        const ang = (i / 18) * Math.PI * 2;
        const f = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.3, 5), i % 2 ? flameMat : flameMat2);
        f.position.set(Math.cos(ang) * 3.2, Math.sin(ang) * 3.2, 0);
        f.rotation.z = ang - Math.PI / 2;
        ring.add(f);
        flames.push(f);
      }
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1, 6), ink);
      const foot = new THREE.Vector3(lm.x, course.height(lm.x, lm.z), lm.z);
      placeBetween(post, foot, new THREE.Vector3(lm.x, lm.y - 3.4, lm.z));
      group.add(post);
      ring.position.set(lm.x, lm.y, lm.z);
      ring.rotation.y = lm.yaw;
      group.add(ring);
      updaters.push((_dt, t) => {
        flames.forEach((f, i) => {
          f.scale.y = 0.8 + Math.abs(Math.sin(t * 9 + i * 1.7)) * 0.7;
        });
      });
    }
  }

  // ---- penguins on the summit ----
  for (const pg of course.penguins) {
    const g = new THREE.Group();
    const body = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), ink));
    body.scale.set(1, 1.35, 1);
    body.position.y = 0.55;
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), white);
    belly.scale.set(1, 1.3, 0.7);
    belly.position.set(0, 0.5, 0.2);
    const head = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), ink));
    head.position.y = 1.15;
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 5), toon(0xf08a3c));
    beak.position.set(0, 1.12, 0.3);
    beak.rotation.x = Math.PI / 2;
    const feetGeo = new THREE.BoxGeometry(0.22, 0.06, 0.32);
    const footL = new THREE.Mesh(feetGeo, toon(0xf08a3c));
    footL.position.set(-0.15, 0.03, 0.1);
    const footR = new THREE.Mesh(feetGeo, toon(0xf08a3c));
    footR.position.set(0.15, 0.03, 0.1);
    g.add(body, belly, head, beak, footL, footR);
    g.position.set(pg.x, pg.y, pg.z);
    g.rotation.y = pg.rot;
    group.add(g);
    updaters.push((_dt, t) => {
      g.rotation.z = Math.sin(t * 3 + pg.rot) * 0.08;
    });
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

  // ---- hot-air balloons ----
  {
    const stripes = [
      [0xf2685f, 0xf3d15e],
      [0x62c2b0, 0xffffff],
      [0xb197e3, 0xf3d15e],
      [0xf2685f, 0xffffff],
    ];
    for (let i = 0; i < 4; i++) {
      const bal = new THREE.Group();
      const env = new THREE.Mesh(new THREE.SphereGeometry(6, 16, 12), toon(stripes[i][0], { fog: false }));
      env.scale.y = 1.15;
      for (let k = 0; k < 4; k++) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(1.4, 12.5, 12.6), toon(stripes[i][1], { fog: false }));
        band.rotation.y = (k / 4) * Math.PI;
        band.scale.set(1, 0.98, 0.98);
        band.position.y = 0;
        bal.add(band);
      }
      const basket = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 2.2), woodDark);
      basket.position.y = -9.5;
      bal.add(env, basket);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 4, 4), ink);
          rope.position.set(sx * 0.9, -7.5, sz * 0.9);
          bal.add(rope);
        }
      }
      course.roadPoint((course.totalLength * (i + 1)) / 5, rp);
      const base = new THREE.Vector3(rp.x + rand(-60, 60), rp.h + 40 + i * 12, rp.z + rand(-60, 60));
      bal.position.copy(base);
      group.add(bal);
      updaters.push((_dt, t) => {
        bal.position.x = base.x + Math.sin(t * 0.07 + i) * 25;
        bal.position.y = base.y + Math.sin(t * 0.4 + i * 2) * 2;
        bal.position.z = base.z + Math.cos(t * 0.05 + i) * 25;
      });
    }
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
  const wingGeo = new THREE.BoxGeometry(0.9, 0.06, 0.2);
  const birds: Bird[] = [];
  for (let i = 0; i < 7; i++) {
    const g = new THREE.Group();
    const wings: [THREE.Mesh, THREE.Mesh] = [new THREE.Mesh(wingGeo, ink), new THREE.Mesh(wingGeo, ink)];
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

  const rockfall = (group as THREE.Group & { __rockfall?: (s: number) => void }).__rockfall;
  const finishKicker = course.landmarks.find((l) => l.kind === "finishKicker");
  return {
    group,
    setStickers(found) {
      for (const [id, g] of stickerMeshes) g.visible = !found.has(id);
    },
    update(dt, t, skaterS, finished) {
      for (const u of updaters) u(dt, t);
      rockfall?.(skaterS);
      if (finished && !confettiOn && finishKicker) startConfetti(finishKicker.x, finishKicker.y, finishKicker.z);
      if (!finished && confettiOn) {
        confettiOn = false;
        for (const c of confetti) c.mesh.visible = false;
      }
      if (confettiOn) {
        confettiClock += dt;
        for (const c of confetti) {
          c.v.y -= 6 * dt;
          c.mesh.position.addScaledVector(c.v, dt);
          c.mesh.rotation.x += c.spin * dt;
          c.mesh.rotation.z += c.spin * 0.7 * dt;
          if (confettiClock > 4) c.mesh.visible = false;
        }
      }
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
