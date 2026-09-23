// The train as seen: a red metre-gauge electric locomotive and four
// panorama coaches, placed bogie by bogie on the track with cant, plus the
// driver's cab interior used by the cab view. Livery and lettering are
// fictional ("Viafier Alpina").

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { TRAIN } from "./physics";
import { RAIL_TOP } from "./scenery";
import type { Track } from "./track";

const RED = "#b3141d";
const WIDTH = 2.65;

interface Car {
  root: THREE.Group;
  length: number;
  offset: number; // distance from the train front to this car's front
  bogie: number; // bogie centre inset from each end
  wheels: THREE.Object3D[];
}

export class TrainModel {
  readonly group = new THREE.Group();
  readonly cars: Car[] = [];
  readonly cab: THREE.Group;
  readonly eye = new THREE.Object3D(); // driver's eye point, child of the loco
  readonly headlights: THREE.Mesh[] = [];
  private wheelAngle = 0;

  constructor() {
    const paint = new THREE.MeshPhysicalMaterial({ color: RED, roughness: 0.32, metalness: 0.1, clearcoat: 0.8, clearcoatRoughness: 0.15 });
    const glass = new THREE.MeshStandardMaterial({ color: "#16222b", roughness: 0.04, metalness: 0.85, envMapIntensity: 1.6 });
    const grey = new THREE.MeshStandardMaterial({ color: "#2e3135", roughness: 0.65, metalness: 0.3 });
    const roofGrey = new THREE.MeshStandardMaterial({ color: "#8d9196", roughness: 0.55, metalness: 0.4 });
    const white = new THREE.MeshStandardMaterial({ color: "#f1efe8", roughness: 0.4 });
    const steel = new THREE.MeshStandardMaterial({ color: "#9aa0a6", roughness: 0.35, metalness: 0.8 });
    const lettering = makeLettering();

    // ------------------------------------------------------------ locomotive
    const loco = new THREE.Group();
    const Ll = TRAIN.locoLength;
    {
      // Side profile (x = along, y = up), extruded across the width.
      const hl = Ll / 2;
      const s = new THREE.Shape();
      s.moveTo(-hl, 1.05);
      s.lineTo(hl, 1.05);
      s.lineTo(hl, 2.25);
      s.lineTo(hl - 0.42, 3.42);
      s.lineTo(hl - 0.7, 3.62);
      s.lineTo(-hl + 0.7, 3.62);
      s.lineTo(-hl + 0.42, 3.42);
      s.lineTo(-hl, 2.25);
      s.closePath();
      const bodyGeo = new THREE.ExtrudeGeometry(s, { depth: WIDTH - 0.24, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.1, bevelSegments: 3, curveSegments: 4 });
      bodyGeo.translate(0, 0, -(WIDTH - 0.24) / 2);
      const body = new THREE.Mesh(bodyGeo, paint);
      body.castShadow = true;
      body.receiveShadow = true;
      loco.add(body);
      // Windscreens (both ends) on the sloped face.
      for (const e of [1, -1]) {
        const ws = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH - 0.5, 1.12), glass);
        const ang = Math.atan2(0.42, 1.17);
        ws.position.set(e * (hl - 0.2), 2.86, 0);
        ws.rotation.set(0, e > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
        ws.rotateX(-ang);
        loco.add(ws);
        // Lamps: two low, one high.
        for (const [z, y] of [[-0.85, 1.75], [0.85, 1.75], [0, 3.5]] as const) {
          const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.11, 14), new THREE.MeshBasicMaterial({ color: e > 0 ? "#fff8e6" : "#551111" }));
          lamp.position.set(e * (hl + 0.125) - (y > 3 ? e * 0.63 : 0), y, z);
          lamp.rotation.y = e > 0 ? Math.PI / 2 : -Math.PI / 2;
          loco.add(lamp);
          if (e > 0) this.headlights.push(lamp);
        }
        // Buffer beam and coupler.
        const beam = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.42, WIDTH - 0.2), grey);
        beam.position.set(e * (hl + 0.05), 0.95, 0);
        loco.add(beam);
        const coupler = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.34), grey);
        coupler.position.set(e * (hl + 0.3), 0.92, 0);
        loco.add(coupler);
        // White stripe under the windscreen.
        const stripe = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH - 0.3, 0.1), white);
        stripe.position.set(e * (hl + 0.125), 2.05, 0);
        stripe.rotation.y = e > 0 ? Math.PI / 2 : -Math.PI / 2;
        loco.add(stripe);
      }
      // Side details: cab windows, grilles, lettering, stripe.
      for (const side of [1, -1]) {
        const z = side * (WIDTH / 2 + 0.005);
        for (const e of [1, -1]) {
          const cw = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.85), glass);
          cw.position.set(e * (hl - 1.25), 2.85, z);
          cw.rotation.y = side > 0 ? 0 : Math.PI;
          loco.add(cw);
          const door = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 1.9), new THREE.MeshStandardMaterial({ color: "#8e1017", roughness: 0.5 }));
          door.position.set(e * (hl - 2.2), 2.1, z);
          door.rotation.y = side > 0 ? 0 : Math.PI;
          loco.add(door);
        }
        for (let i = 0; i < 4; i++) {
          const gr = new THREE.Mesh(new THREE.PlaneGeometry(1.45, 0.55), grey);
          gr.position.set(-3.1 + i * 2.05, 3.0, z);
          gr.rotation.y = side > 0 ? 0 : Math.PI;
          loco.add(gr);
        }
        const st = new THREE.Mesh(new THREE.PlaneGeometry(Ll - 0.6, 0.08), white);
        st.position.set(0, 1.55, z);
        st.rotation.y = side > 0 ? 0 : Math.PI;
        loco.add(st);
        const lt = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.42), lettering);
        lt.position.set(0.2, 2.15, z + side * 0.002);
        lt.rotation.y = side > 0 ? 0 : Math.PI;
        loco.add(lt);
      }
      // Roof: equipment and two pantographs (front one raised).
      const roofBox = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.28, 1.5), roofGrey);
      roofBox.position.set(0, 3.8, 0);
      loco.add(roofBox);
      for (const e of [1, -1]) {
        const panto = buildPantograph(steel, grey, e > 0);
        panto.position.set(e * 4.6, 3.72, 0);
        panto.rotation.y = e > 0 ? 0 : Math.PI;
        loco.add(panto);
      }
      // Underframe equipment.
      const under = new THREE.Mesh(new THREE.BoxGeometry(Ll - 5.5, 0.55, WIDTH - 0.5), grey);
      under.position.set(0, 0.85, 0);
      loco.add(under);
    }
    this.addCar(loco, Ll, 0, 3.6, grey, steel);

    // Cab interior (driver sits on the right-hand side at the front).
    this.cab = buildCab(Ll / 2);
    loco.add(this.cab);
    this.eye.position.set(Ll / 2 - 1.55, 2.78, 0.42);
    loco.add(this.eye);

    // --------------------------------------------------------------- coaches
    const Lc = TRAIN.coachLength;
    let offset = Ll + TRAIN.gap;
    for (let c = 0; c < TRAIN.coaches; c++) {
      const coach = buildPanoramaCoach(Lc, paint, glass, grey, roofGrey, white, lettering, c === TRAIN.coaches - 1);
      this.addCar(coach, Lc, offset, 3.0, grey, steel);
      offset += Lc + TRAIN.gap;
    }
  }

  private addCar(root: THREE.Group, length: number, offset: number, bogie: number, grey: THREE.Material, steel: THREE.Material): void {
    const wheels: THREE.Object3D[] = [];
    for (const e of [1, -1]) {
      const b = buildBogie(grey, steel);
      b.position.set(e * (length / 2 - bogie), 0, 0);
      root.add(b);
      b.traverse((o) => {
        if (o.userData.wheel) wheels.push(o);
      });
    }
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.group.add(root);
    this.cars.push({ root, length, offset, bogie, wheels });
  }

  private pa = new THREE.Vector3();
  private pb = new THREE.Vector3();
  private tmpM = new THREE.Matrix4();

  /** Place every car so its bogies sit on the rails at frontS. */
  place(track: Track, frontS: number, distance: number): void {
    for (const car of this.cars) {
      const s0 = frontS - car.offset;
      const sa = s0 - car.bogie;
      const sb = s0 - car.length + car.bogie;
      const a = track.pos(sa);
      const b = track.pos(sb);
      this.pa.set(a.x, a.y + RAIL_TOP, a.z);
      this.pb.set(b.x, b.y + RAIL_TOP, b.z);
      const f = this.pa.clone().sub(this.pb).normalize();
      const cant = (track.cantAt(sa) + track.cantAt(sb)) / 2;
      const up = new THREE.Vector3(0, 1, 0);
      const r = new THREE.Vector3().crossVectors(f, up).normalize(); // right
      up.crossVectors(r, f).normalize();
      // Bank with the cant.
      up.applyAxisAngle(f, cant);
      r.applyAxisAngle(f, cant);
      // Car local axes: x = forward, y = up, z = -right? (z = left-to-right)
      this.tmpM.makeBasis(f, up, r);
      car.root.quaternion.setFromRotationMatrix(this.tmpM);
      car.root.position.copy(this.pa).add(this.pb).multiplyScalar(0.5);
    }
    // Wheels turn with distance travelled (r = 0.43 m).
    this.wheelAngle = -distance / 0.43;
    for (const car of this.cars) for (const w of car.wheels) w.rotation.z = this.wheelAngle;
  }

  setCabVisible(v: boolean): void {
    this.cab.visible = v;
  }
}

function makeLettering(): THREE.MeshStandardMaterial {
  const cv = document.createElement("canvas");
  cv.width = 512;
  cv.height = 64;
  const c = cv.getContext("2d")!;
  c.clearRect(0, 0, 512, 64);
  c.fillStyle = "#f4f2ea";
  c.font = "600 34px 'Helvetica Neue', Arial, sans-serif";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText("Viafier Alpina", 256, 34);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.4 });
}

function buildBogie(grey: THREE.Material, steel: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.32, 1.9), grey);
  frame.position.y = 0.62;
  g.add(frame);
  const wheelGeo = new THREE.CylinderGeometry(0.43, 0.43, 0.12, 18);
  wheelGeo.rotateX(Math.PI / 2);
  for (const x of [-0.95, 0.95]) {
    const axle = new THREE.Group();
    axle.position.set(x, 0.43, 0);
    axle.userData.wheel = true;
    for (const z of [-0.55, 0.55]) {
      const w = new THREE.Mesh(wheelGeo, steel);
      w.position.z = z;
      axle.add(w);
      const hub = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.13), grey);
      hub.position.z = z;
      axle.add(hub);
    }
    g.add(axle);
    for (const z of [-0.98, 0.98]) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.16), grey);
      box.position.set(x, 0.45, z);
      g.add(box);
    }
  }
  return g;
}

function buildPantograph(steel: THREE.Material, grey: THREE.Material, raised: boolean): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 1.1), grey);
  base.position.y = 0.12;
  g.add(base);
  for (const z of [-0.45, 0.45]) {
    const ins = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.22, 8), new THREE.MeshStandardMaterial({ color: "#6d3f2a", roughness: 0.4 }));
    ins.position.set(0, 0.02, z);
    g.add(ins);
  }
  // Single-arm pantograph: lower arm up to the knee, upper arm to the head.
  const h = raised ? 1.72 : 0.3;
  const knee = new THREE.Vector3(-0.9, raised ? 1.0 : 0.3, 0);
  const foot = new THREE.Vector3(0.5, 0.2, 0);
  const head = new THREE.Vector3(0.25, h + 0.2, 0);
  const bar = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
    const len = a.distanceTo(b);
    const geo = new THREE.CylinderGeometry(r, r, len, 6);
    const m = new THREE.Mesh(geo, steel);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    return m;
  };
  g.add(bar(foot, knee, 0.045));
  g.add(bar(knee, head, 0.03));
  const bow = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.06, 1.7), steel);
  bow.position.copy(head);
  g.add(bow);
  for (const z of [-0.85, 0.85]) {
    const horn = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.3), steel);
    horn.position.set(head.x, head.y - 0.08, z + Math.sign(z) * 0.12);
    horn.rotation.x = Math.sign(z) * 0.5;
    g.add(horn);
  }
  return g;
}

function buildPanoramaCoach(
  L: number,
  paint: THREE.Material,
  glass: THREE.Material,
  grey: THREE.Material,
  roofGrey: THREE.Material,
  white: THREE.Material,
  lettering: THREE.Material,
  last: boolean,
): THREE.Group {
  const g = new THREE.Group();
  const hw = WIDTH / 2;
  // Lower body cross-section (y, z) extruded along x.
  const lower = new THREE.Shape();
  lower.moveTo(-hw + 0.12, 1.05);
  lower.lineTo(hw - 0.12, 1.05);
  lower.quadraticCurveTo(hw, 1.05, hw, 1.2);
  lower.lineTo(hw, 2.0);
  lower.lineTo(-hw, 2.0);
  lower.lineTo(-hw, 1.2);
  lower.quadraticCurveTo(-hw, 1.05, -hw + 0.12, 1.05);
  const lowerGeo = new THREE.ExtrudeGeometry(lower, { depth: L - 0.3, bevelEnabled: false });
  lowerGeo.translate(0, 0, -(L - 0.3) / 2);
  lowerGeo.rotateY(Math.PI / 2);
  g.add(new THREE.Mesh(lowerGeo, paint));
  // Panorama glass: a shell from the sill over the roof shoulders.
  const arc: THREE.Vector2[] = [];
  const shoulders = 10;
  arc.push(new THREE.Vector2(hw - 0.01, 2.0));
  arc.push(new THREE.Vector2(hw - 0.03, 2.75));
  for (let i = 0; i <= shoulders; i++) {
    const a = (i / shoulders) * (Math.PI / 2);
    arc.push(new THREE.Vector2(0.55 + (hw - 0.6) * Math.cos(a), 2.75 + 0.9 * Math.sin(a)));
  }
  const shell = new THREE.Shape();
  shell.moveTo(arc[0].x, arc[0].y);
  for (const p of arc) shell.lineTo(p.x, p.y);
  for (let i = arc.length - 1; i >= 0; i--) shell.lineTo(-arc[i].x, arc[i].y);
  // inner edge
  const inner = arc.map((p) => new THREE.Vector2(p.x * 0.985, 2.0 + (p.y - 2.0) * 0.985));
  shell.lineTo(-inner[0].x, inner[0].y);
  for (const p of inner) shell.lineTo(-p.x, p.y);
  for (let i = inner.length - 1; i >= 0; i--) shell.lineTo(inner[i].x, inner[i].y);
  shell.closePath();
  const shellGeo = new THREE.ExtrudeGeometry(shell, { depth: L - 1.3, bevelEnabled: false });
  shellGeo.translate(0, 0, -(L - 1.3) / 2);
  shellGeo.rotateY(Math.PI / 2);
  g.add(new THREE.Mesh(shellGeo, glass));
  // Roof crown strip and window pillars (red) over the glass.
  const crown = new THREE.Mesh(new THREE.BoxGeometry(L - 0.3, 0.1, 1.05), roofGrey);
  crown.position.y = 3.66;
  g.add(crown);
  const pillarShape = new THREE.Shape();
  pillarShape.moveTo(arc[0].x + 0.02, arc[0].y);
  for (const p of arc) pillarShape.lineTo(p.x + 0.02, p.y + 0.02);
  for (let i = arc.length - 1; i >= 0; i--) pillarShape.lineTo(-arc[i].x - 0.02, arc[i].y + 0.02);
  pillarShape.lineTo(-arc[0].x - 0.02, arc[0].y);
  for (let i = 0; i < arc.length; i++) pillarShape.lineTo(-arc[i].x + 0.02, arc[i].y - 0.02);
  for (let i = arc.length - 1; i >= 0; i--) pillarShape.lineTo(arc[i].x - 0.02, arc[i].y - 0.02);
  pillarShape.closePath();
  const pillarGeo = new THREE.ExtrudeGeometry(pillarShape, { depth: 0.16, bevelEnabled: false });
  pillarGeo.translate(0, 0, -0.08);
  pillarGeo.rotateY(Math.PI / 2);
  const pillars: THREE.BufferGeometry[] = [];
  const nWin = Math.round((L - 1.3) / 2.1);
  for (let i = 0; i <= nWin; i++) {
    const x = -(L - 1.3) / 2 + (i * (L - 1.3)) / nWin;
    pillars.push(pillarGeo.clone().translate(x, 0, 0));
  }
  g.add(new THREE.Mesh(mergeGeometries(pillars)!, paint));
  // End walls with a door window, gangway.
  for (const e of [1, -1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.62, 2.62, WIDTH), paint);
    wall.position.set(e * (L / 2 - 0.46), 2.32, 0);
    g.add(wall);
    const bellow = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.2, 1.3), grey);
    bellow.position.set(e * (L / 2 + 0.1), 2.15, 0);
    g.add(bellow);
    const coupler = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.34), grey);
    coupler.position.set(e * (L / 2 + 0.15), 0.92, 0);
    g.add(coupler);
    const endRoof = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.4, WIDTH - 0.3), roofGrey);
    endRoof.position.set(e * (L / 2 - 0.46), 3.62, 0);
    g.add(endRoof);
  }
  // Doors, stripe and lettering on both sides.
  for (const side of [1, -1]) {
    const z = side * (hw + 0.004);
    for (const e of [1, -1]) {
      const door = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.88), new THREE.MeshStandardMaterial({ color: "#8e1017", roughness: 0.5 }));
      door.position.set(e * (L / 2 - 1.4), 1.52, z);
      door.rotation.y = side > 0 ? 0 : Math.PI;
      g.add(door);
    }
    const st = new THREE.Mesh(new THREE.PlaneGeometry(L - 0.6, 0.07), white);
    st.position.set(0, 1.25, z);
    st.rotation.y = side > 0 ? 0 : Math.PI;
    g.add(st);
    const lt = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.4), lettering);
    lt.position.set(0, 1.66, z + side * 0.002);
    lt.rotation.y = side > 0 ? 0 : Math.PI;
    g.add(lt);
  }
  // Interior: warm-lit seats visible through the glass.
  const seatMat = new THREE.MeshStandardMaterial({ color: "#3b2f2a", roughness: 0.9 });
  const seats: THREE.BufferGeometry[] = [];
  const seatGeo = new THREE.BoxGeometry(0.55, 1.05, 0.95);
  for (let i = 0; i < nWin; i++) {
    const x = -(L - 1.3) / 2 + ((i + 0.5) * (L - 1.3)) / nWin;
    for (const z of [-0.72, 0.72]) seats.push(seatGeo.clone().translate(x, 1.55, z));
  }
  g.add(new THREE.Mesh(mergeGeometries(seats)!, seatMat));
  const floor = new THREE.Mesh(new THREE.BoxGeometry(L - 0.6, 0.05, WIDTH - 0.2), new THREE.MeshStandardMaterial({ color: "#5c5046" }));
  floor.position.y = 1.08;
  g.add(floor);
  // Underframe.
  const under = new THREE.Mesh(new THREE.BoxGeometry(L - 6.5, 0.5, WIDTH - 0.6), grey);
  under.position.y = 0.82;
  g.add(under);
  if (last) {
    for (const z of [-0.85, 0.85]) {
      const tl = new THREE.Mesh(new THREE.CircleGeometry(0.1, 12), new THREE.MeshBasicMaterial({ color: "#ff2616" }));
      tl.position.set(-L / 2 - 0.17, 1.6, z);
      tl.rotation.y = -Math.PI / 2;
      g.add(tl);
    }
  }
  return g;
}

/** Cab interior around the driver's eye: desk, pillars, roof edge, wiper. */
function buildCab(front: number): THREE.Group {
  const g = new THREE.Group();
  const desk = new THREE.MeshStandardMaterial({ color: "#2a2d31", roughness: 0.7 });
  const trim = new THREE.MeshStandardMaterial({ color: "#6a6f75", roughness: 0.6 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, WIDTH - 0.3), desk);
  top.position.set(front - 0.72, 2.12, 0);
  top.rotation.z = -0.18;
  g.add(top);
  const face = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, WIDTH - 0.3), desk);
  face.position.set(front - 1.12, 1.78, 0);
  g.add(face);
  // Instruments glow faintly on the desk.
  const glow = new THREE.MeshBasicMaterial({ color: "#1f3440" });
  for (const z of [0.25, 0.75]) {
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.22), glow);
    scr.position.set(front - 0.9, 2.26, z);
    scr.rotation.set(-Math.PI / 2 + 0.55, Math.PI / 2, 0, "YXZ");
    g.add(scr);
  }
  // Window frame: centre post, side pillars, header and sill.
  const post = (z: number, w: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.3, w), trim);
    m.position.set(front - 0.2, 2.85, z);
    m.rotation.z = Math.atan2(0.42, 1.17);
    g.add(m);
  };
  post(0, 0.07);
  post(1.24, 0.1);
  post(-1.24, 0.1);
  const header = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, WIDTH - 0.2), trim);
  header.position.set(front - 0.62, 3.52, 0);
  g.add(header);
  // Side walls below the side windows only.
  for (const z of [1.28, -1.28]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.1, 0.06), new THREE.MeshStandardMaterial({ color: "#4a5057", roughness: 0.7 }));
    m.position.set(front - 1.5, 1.75, z);
    g.add(m);
  }
  g.traverse((o) => {
    o.castShadow = false;
    o.receiveShadow = true;
  });
  return g;
}
