/**
 * Wordmark — "UNFILED" as seven letters of dark polished steel standing in
 * the water. The outlines come from the site's display face (see
 * tools/hub-wordmark.mjs); here they are extruded into real geometry so the
 * letters hold up as a silhouette against the last light and show their
 * depth when the camera walks past.
 */
import { ExtrudeGeometry, Mesh, MeshBasicNodeMaterial, ShapePath } from "three/webgpu";
import type { Scene } from "three/webgpu";
import {
  Fn,
  abs,
  cameraPosition,
  dot,
  exp,
  float,
  length,
  max,
  mix,
  normalWorld,
  normalize,
  positionWorld,
  pow,
  reflect,
  vec3,
  vec4,
} from "./tsl";
import type { N } from "./tsl";
import type { MonumentPose } from "./layout";
import type { Sky } from "./sky";
import data from "./wordmark.json";

type Command = [string, ...number[]];

interface WordmarkData {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  glyphs: Array<{ char: string; paths: Command[][] }>;
}

const DEPTH_EM = 0.2;

export class Wordmark {
  readonly mesh: Mesh;
  private material: MeshBasicNodeMaterial;
  private scene: Scene;

  constructor(scene: Scene, sky: Sky, fog: { value: number }) {
    this.scene = scene;
    const font = data as unknown as WordmarkData;
    const shapes = [];
    for (const glyph of font.glyphs) {
      const path = new ShapePath();
      for (const contour of glyph.paths) {
        for (const cmd of contour) {
          if (cmd[0] === "M") path.moveTo(cmd[1], cmd[2]);
          else if (cmd[0] === "L") path.lineTo(cmd[1], cmd[2]);
          else if (cmd[0] === "Q") path.quadraticCurveTo(cmd[1], cmd[2], cmd[3], cmd[4]);
        }
      }
      shapes.push(...path.toShapes());
    }
    const geometry = new ExtrudeGeometry(shapes, {
      depth: DEPTH_EM,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.01,
      bevelSegments: 2,
      curveSegments: 10,
    });
    geometry.translate(-(font.xMin + font.xMax) / 2, 0, -DEPTH_EM / 2);
    geometry.computeVertexNormals();

    const uFog = fog as N;
    const colour = Fn(() => {
      const toCam = cameraPosition.sub(positionWorld).toVar();
      const dist = length(toCam).toVar();
      const V = toCam.div(dist).toVar();
      const Nw = normalize(normalWorld).toVar();
      const fres = pow(max(dot(Nw, V), 0).oneMinus(), 3);
      const rr = reflect(V.negate(), Nw);
      const env = sky.base(normalize(vec3(rr.x, abs(rr.y).add(0.02), rr.z)));
      const col = env.mul(mix(float(0.02), float(0.9), fres)).mul(vec3(0.86, 0.88, 0.94)).toVar();
      const fog = float(1).sub(exp(dist.mul(uFog).negate()));
      // only a breath of haze: the letters are meant to stay a silhouette
      col.assign(mix(col, sky.horizon(V.negate()), fog.mul(0.12)));
      return vec4(col, 1);
    });
    const material = new MeshBasicNodeMaterial();
    material.colorNode = colour();
    material.fog = false;
    this.material = material;

    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    this.mesh = mesh;
    scene.add(mesh);
    this.span = font.xMax - font.xMin;
    this.sink = -font.yMin;
  }

  private span: number;
  private sink: number;

  setPose(pose: MonumentPose) {
    const s = pose.width / this.span;
    this.mesh.scale.setScalar(s);
    // letters with an overshoot (U, D) dip under the surface, like real plate
    this.mesh.position.set(pose.x, -(this.sink + 0.012) * s, pose.z);
    this.mesh.rotation.set(0, pose.yaw, 0);
    this.mesh.updateMatrixWorld();
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}
