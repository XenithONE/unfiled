import * as THREE from "three";
import { BAIL_TIME, CHARGE_MAX, PUSH_TIME, type Skater } from "./sim";
import { UP, angleDiff, clamp, damp, placeBetween, solveTwoBone } from "./util";

export const SKATER_COLORS = {
  shirt: 0xf2685f,
  pants: 0x3f4c75,
  skin: 0xf6d3b6,
  beanie: 0x4fb37e,
  shoe: 0x2a2733,
  deckTop: 0xe9c46a,
  deckBottom: 0xc8553d,
  truck: 0xd9d3c7,
  wheel: 0xfff3d0,
  ink: 0x2a2733,
};

type MatFactory = (hex: number) => THREE.Material;

const DECK_TOP = 0.132;
const L_THIGH = 0.36;
const L_SHIN = 0.36;
const L_UPPER = 0.26;
const L_FORE = 0.24;

const qTilt = new THREE.Quaternion();
const qYaw = new THREE.Quaternion();

/** Procedurally animated doodle skater: no skinning, just limbs placed each frame. */
export class SkaterRig {
  readonly root = new THREE.Group();
  private readonly lean = new THREE.Group();
  private readonly boardPivot = new THREE.Group();
  private readonly torso: THREE.Mesh;
  private readonly hipBall: THREE.Mesh;
  private readonly chest: THREE.Mesh;
  private readonly head: THREE.Mesh;
  private readonly beanie: THREE.Mesh;
  private readonly brim: THREE.Mesh;
  private readonly eyes: [THREE.Mesh, THREE.Mesh];
  private readonly thighs: [THREE.Mesh, THREE.Mesh];
  private readonly shins: [THREE.Mesh, THREE.Mesh];
  private readonly knees: [THREE.Mesh, THREE.Mesh];
  private readonly feet: [THREE.Mesh, THREE.Mesh];
  private readonly uppers: [THREE.Mesh, THREE.Mesh];
  private readonly fores: [THREE.Mesh, THREE.Mesh];
  private readonly elbows: [THREE.Mesh, THREE.Mesh];
  private readonly hands: [THREE.Mesh, THREE.Mesh];

  private smoothYaw = 0;
  private readonly tilt = new THREE.Vector3(0, 1, 0);
  private crouch = 0;
  private tumble = 0;
  private roll = 0;
  private pitch = 0;

  // scratch vectors
  private readonly hipC = new THREE.Vector3();
  private readonly shoulderC = new THREE.Vector3();
  private readonly headC = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly hip = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly foot = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly knee = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly shoulder = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly hand = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly elbow = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly hint = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor(toon: MatFactory) {
    const c = SKATER_COLORS;
    const shirt = toon(c.shirt);
    const pants = toon(c.pants);
    const skin = toon(c.skin);
    const shoe = toon(c.shoe);
    const ink = toon(c.ink);

    const cyl = (r: number, mat: THREE.Material) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 10), mat);
      m.castShadow = true;
      return m;
    };
    const ball = (r: number, mat: THREE.Material) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat);
      m.castShadow = true;
      return m;
    };
    const pair = <T extends THREE.Mesh>(f: () => T): [T, T] => [f(), f()];

    this.root.add(this.lean);

    // ---- board ----
    const board = new THREE.Group();
    const deckTop = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.01, 0.78), toon(c.deckTop));
    deckTop.position.y = 0.127;
    const deckBottom = new THREE.Mesh(
      new THREE.BoxGeometry(0.21, 0.012, 0.78),
      toon(c.deckBottom),
    );
    deckBottom.position.y = 0.116;
    board.add(deckTop, deckBottom);
    for (const s of [1, -1]) {
      const kick = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.17), toon(c.deckTop));
      kick.position.set(0, 0.146, s * 0.43);
      kick.rotation.x = -s * 0.38;
      board.add(kick);
      const truck = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.04, 0.05), toon(c.truck));
      truck.position.set(0, 0.09, s * 0.25);
      board.add(truck);
      for (const w of [1, -1]) {
        const wheel = new THREE.Mesh(
          new THREE.CylinderGeometry(0.055, 0.055, 0.04, 12),
          toon(c.wheel),
        );
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(w * 0.1, 0.055, s * 0.25);
        board.add(wheel);
      }
    }
    board.traverse((o) => {
      o.castShadow = true;
    });
    board.position.y = -0.12;
    this.boardPivot.position.y = 0.12;
    this.boardPivot.add(board);
    this.lean.add(this.boardPivot);

    // ---- body ----
    this.torso = cyl(0.125, shirt);
    this.hipBall = ball(0.12, pants);
    this.chest = ball(0.125, shirt);
    this.head = ball(0.155, skin);
    this.beanie = ball(0.16, toon(c.beanie));
    this.beanie.scale.set(1, 0.62, 1);
    this.brim = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.165, 0.05, 16), toon(c.beanie));
    this.brim.castShadow = true;
    this.eyes = pair(() => ball(0.022, ink));
    this.thighs = pair(() => cyl(0.062, pants));
    this.shins = pair(() => cyl(0.055, pants));
    this.knees = pair(() => ball(0.062, pants));
    this.feet = pair(() => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.065, 0.11), shoe);
      m.castShadow = true;
      return m;
    });
    this.uppers = pair(() => cyl(0.048, shirt));
    this.fores = pair(() => cyl(0.042, skin));
    this.elbows = pair(() => ball(0.048, shirt));
    this.hands = pair(() => ball(0.05, skin));
    this.lean.add(
      this.torso,
      this.hipBall,
      this.chest,
      this.head,
      this.beanie,
      this.brim,
      ...this.eyes,
      ...this.thighs,
      ...this.shins,
      ...this.knees,
      ...this.feet,
      ...this.uppers,
      ...this.fores,
      ...this.elbows,
      ...this.hands,
    );
  }

  update(sk: Skater, dt: number, t: number): void {
    this.smoothYaw += angleDiff(this.smoothYaw, sk.yaw) * (1 - Math.exp(-16 * dt));
    const inAir = sk.inAir;
    const targetN = sk.grounded ? sk.normal : sk.rail ? sk.railUp : UP;
    this.tilt.lerp(targetN, 1 - Math.exp(-(sk.grounded || sk.rail ? 12 : 3) * dt)).normalize();
    this.root.position.copy(sk.pos);
    qTilt.setFromUnitVectors(UP, this.tilt);
    qYaw.setFromAxisAngle(UP, this.smoothYaw);
    this.root.quaternion.copy(qTilt).multiply(qYaw);

    // crouch
    let crouchTarget = sk.charging ? 0.5 + 0.5 * (sk.charge / CHARGE_MAX) : 0;
    if (sk.crouchHeld && sk.grounded) crouchTarget = Math.max(crouchTarget, 0.65);
    if (inAir) crouchTarget = Math.max(crouchTarget, sk.grabbing ? 0.7 : 0.35);
    if (sk.rail) crouchTarget = Math.max(crouchTarget, 0.45);
    crouchTarget = Math.min(1, crouchTarget + sk.landImpulse * 0.8);
    if (sk.bail > 0) crouchTarget = 0.9;
    this.crouch = damp(this.crouch, crouchTarget, 14, dt);

    // lean into turns, nose up in the air
    const hs = sk.horizontalSpeed;
    const rollTarget = sk.rail ? 0 : sk.steer * (sk.drifting ? 0.55 : 0.3) * clamp(hs / 6, 0, 1) * (inAir ? 0.4 : 1);
    this.roll = damp(this.roll, rollTarget, 10, dt) + Math.sin(t * 40) * 0.25 * sk.wobble;
    this.pitch = damp(this.pitch, inAir ? -0.1 : 0, 6, dt);

    // bail tumble
    if (sk.bail > 0) {
      const p = 1 - sk.bail / BAIL_TIME;
      this.tumble = Math.min(1, p * 2.5);
      const s = Math.sin(p * Math.PI);
      this.boardPivot.position.set(0.9 * s, 0.12 + 0.45 * s, -0.3 * s);
      this.boardPivot.rotation.set(0.6 * s, p * 7, 0.8 * s);
    } else {
      this.tumble = damp(this.tumble, 0, 8, dt);
      this.boardPivot.position.set(0, 0.12, 0);
      this.boardPivot.rotation.set(0, sk.shoveAngle, sk.flipAngle, "YZX");
    }
    this.lean.rotation.set(this.pitch + this.tumble * 1.35, 0, this.roll + this.tumble * 0.4);

    this.poseBody(sk, t, inAir);
  }

  private poseBody(sk: Skater, t: number, inAir: boolean): void {
    const c = this.crouch;
    const pushing = sk.pushTimer > 0 && sk.grounded && sk.bail <= 0;
    const pushP = pushing ? 1 - sk.pushTimer / PUSH_TIME : 0;
    const bob = pushing ? 0.05 * Math.sin(pushP * Math.PI) : 0;
    const hipH = 0.8 - 0.27 * c - bob;

    this.hipC.set(-0.06 * c, DECK_TOP + hipH, 0);
    this.shoulderC
      .copy(this.hipC)
      .add(this.tmp.set(0.05 + 0.17 * c, 0.42 - 0.08 * c, Math.sin(t * 1.7) * 0.01));
    placeBetween(this.torso, this.hipC, this.shoulderC);
    this.hipBall.position.copy(this.hipC);
    this.chest.position.copy(this.shoulderC);

    // head looks where the board points
    this.headC.copy(this.shoulderC).add(this.tmp.set(0.02, 0.23, 0));
    this.head.position.copy(this.headC);
    this.beanie.position.copy(this.headC).add(this.tmp.set(-0.01, 0.07, 0));
    this.brim.position.copy(this.headC).add(this.tmp.set(-0.01, 0.045, 0));
    this.look.set(0.55, -0.05, 1).normalize();
    this.side.crossVectors(UP, this.look).normalize();
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      this.eyes[i].position
        .copy(this.headC)
        .addScaledVector(this.look, 0.135)
        .addScaledVector(this.side, s * 0.052)
        .addScaledVector(UP, 0.02);
    }

    // feet on the deck (tucked while the board flips)
    const flipping = sk.flipAngle !== sk.flipTarget || sk.shoveAngle !== sk.shoveTarget;
    const tuck = inAir ? (flipping ? 0.14 : 0.04) : 0;
    this.foot[0].set(0, DECK_TOP + 0.035 + tuck, 0.22);
    this.foot[1].set(-0.02, DECK_TOP + 0.035 + tuck, -0.24);
    if (pushing) {
      const sw = Math.sin(pushP * Math.PI);
      this.foot[1].set(
        0.32 * sw,
        DECK_TOP + 0.035 - (DECK_TOP + 0.01) * sw,
        -0.24 + 0.35 * Math.sin(pushP * Math.PI * 2),
      );
    }
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      this.hip[i].copy(this.hipC).add(this.tmp.set(0, -0.02, s * 0.11));
      this.hint.set(1, 0, s * 0.35).normalize();
      solveTwoBone(this.hip[i], this.foot[i], L_THIGH, L_SHIN, this.hint, this.knee[i]);
      placeBetween(this.thighs[i], this.hip[i], this.knee[i]);
      placeBetween(this.shins[i], this.knee[i], this.foot[i]);
      this.knees[i].position.copy(this.knee[i]);
      this.feet[i].position.copy(this.foot[i]).add(this.tmp.set(0.03, -0.01, 0));
      this.feet[i].rotation.set(0, 0, 0);
    }
    if (pushing) this.feet[1].rotation.y = -0.9 * Math.sin(pushP * Math.PI);

    // arms
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      this.shoulder[i].copy(this.shoulderC).add(this.tmp.set(0, 0.02, s * 0.19));
      const h = this.hand[i];
      const hs = sk.horizontalSpeed;
      if (sk.bail > 0) {
        h.copy(this.shoulder[i]).add(
          this.tmp.set(Math.sin(t * 31 + i) * 0.3, 0.32 + Math.cos(t * 23 + i * 2) * 0.22, s * 0.42),
        );
      } else if (sk.rail) {
        h.copy(this.shoulder[i]).add(this.tmp.set(0.2, -0.08 + Math.sin(t * 6) * 0.03, s * 0.44));
      } else if (inAir) {
        if (sk.grabbing && i === 1) h.set(0.17, DECK_TOP + 0.035, -0.04);
        else if (sk.grabbing) h.copy(this.shoulder[i]).add(this.tmp.set(0.25, 0.28, s * 0.36));
        else h.copy(this.shoulder[i]).add(this.tmp.set(0.2, 0.06, s * 0.42));
      } else if (pushing) {
        const sw = Math.sin(pushP * Math.PI) * s;
        h.copy(this.shoulder[i]).add(this.tmp.set(0.12 + 0.12 * sw, -0.3, s * 0.16 - 0.2 * sw));
      } else {
        const f = clamp((hs - 4) / 8, 0, 1);
        const sway = Math.sin(t * 2.1 + i * 1.3) * 0.02;
        h.copy(this.shoulder[i]).add(
          this.tmp.set(
            0.1 + 0.12 * f - 0.14 * c,
            -0.35 + 0.28 * f + sway - 0.05 * c,
            s * (0.13 + 0.26 * f),
          ),
        );
      }
      this.hint.set(-1, -0.2, s * 0.7).normalize();
      solveTwoBone(this.shoulder[i], h, L_UPPER, L_FORE, this.hint, this.elbow[i]);
      placeBetween(this.uppers[i], this.shoulder[i], this.elbow[i]);
      placeBetween(this.fores[i], this.elbow[i], h);
      this.elbows[i].position.copy(this.elbow[i]);
      this.hands[i].position.copy(h);
    }
  }
}
