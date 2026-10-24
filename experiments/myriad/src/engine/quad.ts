import { Float32BufferAttribute, InstancedBufferGeometry, Mesh } from "three/webgpu";
import type { Material } from "three/webgpu";

/** One quad (corners −1..1) drawn `count` times; the vertex node places it. */
export function quadGeometry(count: number): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setAttribute("uv", new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.instanceCount = count;
  return g;
}

/** A never-culled instanced quad mesh (positions come from the shader). */
export function particleMesh(count: number, material: Material, renderOrder = 0): Mesh {
  const mesh = new Mesh(quadGeometry(count), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  return mesh;
}

/** Changes how many instances a particle mesh draws. */
export function setInstances(mesh: Mesh, count: number) {
  (mesh.geometry as InstancedBufferGeometry).instanceCount = count;
}
