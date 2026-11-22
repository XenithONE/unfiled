// Checks on the hub's world layout (src/stage/layout.ts): every work is framed
// properly at its stop on every screen shape, nothing stands in front of it,
// and the camera's walk never passes through a slab or the wordmark.
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const result = await build({
  stdin: { contents: `export * from './src/stage/layout.ts'; export { HERO_PROGRESS } from './src/types.ts';`, resolveDir: process.cwd() },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const L = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const { buildSlabs, buildMonument, stationPose, detailPose, heroPose, endPose, Tour, project, SLAB_FOOT, HERO_PROGRESS } = L;

const projects = JSON.parse(await readFile('public/projects.json', 'utf8'));
const count = projects.length;
// real covers run from portrait to 16:9; exercise the spread
const aspects = projects.map((_, i) => [1.5, 1.6, 1.778, 1.333, 0.8, 1.5, 1.6][i % 7]);
const slabs = buildSlabs(aspects);
const monument = buildMonument();

const VIEWS = [
  { name: '16:10 desktop', aspect: 1.6, narrow: false },
  { name: '16:9 desktop', aspect: 16 / 9, narrow: false },
  { name: '21:9 ultrawide', aspect: 21 / 9, narrow: false },
  { name: '4:3 landscape', aspect: 4 / 3, narrow: false },
  { name: '5:4 window', aspect: 1.25, narrow: false },
  { name: 'phone portrait', aspect: 390 / 844, narrow: true },
  { name: 'tablet portrait', aspect: 3 / 4, narrow: true },
  { name: 'narrow window', aspect: 880 / 700, narrow: true },
];

let passed = 0;
const check = (name, fn) => {
  fn();
  passed++;
  console.log(`PASS ${name}`);
};

const corners = (s) => {
  const rx = Math.cos(s.yaw);
  const rz = -Math.sin(s.yaw);
  const out = [];
  for (const side of [-0.5, 0.5])
    for (const y of [SLAB_FOOT, SLAB_FOOT + s.height])
      out.push([s.x + rx * s.width * side, y, s.z + rz * s.width * side]);
  return out;
};
const box = (pose, view, s) => {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, depth = Infinity;
  for (const c of corners(s)) {
    const [px, py, d] = project(pose, view, c[0], c[1], c[2]);
    if (d <= 0.05) return null; // behind the camera
    x0 = Math.min(x0, px); x1 = Math.max(x1, px);
    y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    depth = Math.min(depth, d);
  }
  return { x0, x1, y0, y1, depth };
};
/** Distance in the ground plane from a point to a segment. */
const segDist = (px, pz, ax, az, bx, bz) => {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
};

check('every project has a slab, spaced apart', () => {
  assert.equal(slabs.length, count);
  for (let i = 0; i < count; i++)
    for (let j = i + 1; j < count; j++)
      assert(Math.hypot(slabs[i].x - slabs[j].x, slabs[i].z - slabs[j].z) > 7, `slabs ${i} and ${j} crowd each other`);
});

for (const view of VIEWS) {
  check(`${view.name}: each stop frames its work inside the picture`, () => {
    slabs.forEach((s, i) => {
      for (const [kind, pose] of [['stop', stationPose(s, view)], ['detail', detailPose(s, view)]]) {
        const b = box(pose, view, s);
        assert(b, `${kind} ${i}: slab behind the camera`);
        assert(b.x0 > -0.99 && b.x1 < 0.99 && b.y1 < 0.95 && b.y0 > -0.99, `${kind} ${i}: slab leaves the frame ${JSON.stringify(b)}`);
        const w = b.x1 - b.x0, h = b.y1 - b.y0;
        assert(w > 0.3 && h > 0.25, `${kind} ${i}: slab too small on screen (${w.toFixed(2)} × ${h.toFixed(2)})`);
        assert(pose.y > 0.3 && pose.y < 2, `${kind} ${i}: camera height`);
      }
    });
  });

  check(`${view.name}: nothing nearer stands in front of the work`, () => {
    slabs.forEach((s, i) => {
      for (const [kind, pose] of [['stop', stationPose(s, view)], ['detail', detailPose(s, view)]]) {
        const mine = box(pose, view, s);
        slabs.forEach((o, j) => {
          if (j === i) return;
          const b = box(pose, view, o);
          if (!b || b.depth > mine.depth) return;
          const overlap = b.x0 < mine.x1 - 0.02 && b.x1 > mine.x0 + 0.02 && b.y0 < mine.y1 - 0.02 && b.y1 > mine.y0 + 0.02;
          assert(!overlap, `${kind} ${i}: slab ${j} covers it`);
        });
      }
    });
  });

  check(`${view.name}: the walk passes through nothing`, () => {
    const hero = heroPose(monument, view);
    const stops = slabs.map((s) => stationPose(s, view));
    const end = endPose(count, view);
    const tour = new Tour([HERO_PROGRESS, ...stops.map((_, i) => i), count + 0.25], [hero, ...stops, end]);
    const mx = Math.cos(monument.yaw), mz = -Math.sin(monument.yaw);
    let closest = Infinity;
    for (let p = HERO_PROGRESS; p <= count + 0.25; p += 0.01) {
      const c = tour.at(p);
      assert(Number.isFinite(c.x + c.y + c.z + c.yaw + c.pitch + c.fov), `pose at ${p.toFixed(2)} is not finite`);
      slabs.forEach((s, j) => {
        const rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
        const half = s.width / 2 + 0.08;
        const d = segDist(c.x, c.z, s.x - rx * half, s.z - rz * half, s.x + rx * half, s.z + rz * half);
        closest = Math.min(closest, d);
        assert(d > 1.6, `camera passes ${d.toFixed(2)} m from slab ${j} at progress ${p.toFixed(2)}`);
      });
      const dm = segDist(c.x, c.z, monument.x - mx * monument.width / 2, monument.z - mz * monument.width / 2, monument.x + mx * monument.width / 2, monument.z + mz * monument.width / 2);
      assert(dm > 2.2, `camera passes ${dm.toFixed(2)} m from the wordmark at progress ${p.toFixed(2)}`);
    }
    assert(closest < 12, 'the walk should come close to the works');
  });

  check(`${view.name}: the opening shot holds the whole wordmark`, () => {
    const hero = heroPose(monument, view);
    const mx = Math.cos(monument.yaw), mz = -Math.sin(monument.yaw);
    for (const side of [-0.5, 0.5]) {
      const [px, , d] = project(hero, view, monument.x + mx * monument.width * side, 2, monument.z + mz * monument.width * side);
      assert(d > 0 && Math.abs(px) < 0.97, `wordmark end at ndc ${px.toFixed(2)}`);
    }
  });
}

check('the tour never overshoots between uneven stops', () => {
  const f = L.pchip([0, 1, 2, 10], [0, 1, 1, 5]);
  for (let x = 1; x <= 2; x += 0.05) assert(Math.abs(f(x) - 1) < 1e-9);
  for (let x = 0; x < 10; x += 0.1) assert(f(x + 0.1) >= f(x) - 1e-9);
});

console.log(`${passed} hub layout checks passed (${count} works, ${VIEWS.length} screen shapes).`);
