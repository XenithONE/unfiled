// Builds terrain chunks off the main thread. Each worker rebuilds the same
// deterministic Track + Terrain, then answers chunk requests.

import { Track } from "./track";
import { Terrain, buildChunk, scatterTrees, type ChunkSpec } from "./terrain";

let terrain: Terrain | null = null;

self.onmessage = (e: MessageEvent) => {
  const msg = e.data as
    | { type: "init" }
    | { type: "chunk"; id: number; spec: ChunkSpec }
    | { type: "trees"; id: number; x0: number; z0: number; size: number; spacing: number; seed: number };
  if (msg.type === "init") {
    terrain = new Terrain(new Track());
    (self as unknown as Worker).postMessage({ type: "ready" });
    return;
  }
  if (!terrain) terrain = new Terrain(new Track());
  if (msg.type === "trees") {
    const data = scatterTrees(terrain, msg.x0, msg.z0, msg.size, msg.spacing, msg.seed);
    (self as unknown as Worker).postMessage({ type: "trees", id: msg.id, data }, [data.buffer]);
    return;
  }
  const c = buildChunk(terrain, msg.spec);
  (self as unknown as Worker).postMessage({ type: "chunk", id: msg.id, data: c }, [
    c.positions.buffer,
    c.normals.buffer,
    c.mix.buffer,
    c.tint.buffer,
    c.index.buffer,
  ]);
};
