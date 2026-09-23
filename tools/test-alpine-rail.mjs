import { build } from 'esbuild';
import assert from 'node:assert/strict';

const result = await build({
  stdin: {
    contents: `export * from './games/alpine-rail/src/track.ts'; export * from './games/alpine-rail/src/physics.ts'; export * from './games/alpine-rail/src/run.ts'; export * from './games/alpine-rail/src/terrain.ts';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const M = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const { Track, Run, buildSchedule, newTrain, stepTrain, TRAIN_LENGTH, EB_NOTCH, Terrain, LAKE_Y } = M;

let passed = 0;
const check = (name, fn) => {
  fn();
  passed++;
  console.log(`PASS ${name}`);
};

const track = new Track();
const schedule = buildSchedule(track);
const flat = { ...track, gradeAt: () => 0, curvatureAt: () => 0, tunnelFactor: () => 0 };

check('line: stations, tunnels, viaduct and limits are consistent', () => {
  assert(track.length > 11000 && track.length < 13000);
  for (let i = 1; i < track.stations.length; i++) assert(track.stations[i].stopS > track.stations[i - 1].stopS + 1000);
  for (const sp of [...track.tunnels, ...track.bridges, ...track.galleries]) assert(sp.from > 0 && sp.to < track.length && sp.to > sp.from);
  for (let i = 0; i < track.n; i++) assert(track.limit[i] >= 30 && track.limit[i] <= 80);
  for (let i = 1; i < track.signs.length; i++) assert(track.signs[i].s >= track.signs[i - 1].s);
  const climb = track.yAt(track.length) - track.yAt(0);
  assert(climb > 200 && climb < 400, `climb ${climb}`);
});

check('B7 service brake stops from 60 km/h on the level in a realistic distance', () => {
  const t = newTrain(0);
  t.v = 60 / 3.6;
  t.notch = -7;
  t.brake = 0;
  const s0 = t.s;
  for (let i = 0; i < 60 * 60 && t.v > 0; i++) stepTrain(t, flat, 1 / 60, { atpLimitKmh: 999 });
  const d = t.s - s0;
  assert.equal(t.v, 0);
  assert(d > 140 && d < 230, `stopping distance ${d.toFixed(1)} m`);
});

check('released brakes on 45 per mille roll the train back; B4 holds it', () => {
  const steep = { ...track, gradeAt: () => 0.045, curvatureAt: () => 0, tunnelFactor: () => 0 };
  const t = newTrain(1000);
  t.notch = 0;
  t.brake = 0;
  for (let i = 0; i < 120; i++) stepTrain(t, steep, 1 / 60, { atpLimitKmh: 999 });
  assert(t.v < -0.3, `v ${t.v}`);
  const h = newTrain(1000);
  h.notch = -4;
  for (let i = 0; i < 600; i++) stepTrain(h, steep, 1 / 60, { atpLimitKmh: 999 });
  assert.equal(h.v, 0);
});

check('full power on 45 per mille still climbs (adhesion and power limits)', () => {
  const steep = { ...track, gradeAt: () => 0.045, curvatureAt: () => 0, tunnelFactor: () => 0 };
  const t = newTrain(1000);
  t.notch = 5;
  t.brake = 0;
  for (let i = 0; i < 60 * 60; i++) stepTrain(t, steep, 1 / 60, { atpLimitKmh: 999 });
  const kmh = t.v * 3.6;
  assert(kmh > 40 && kmh < 90, `balancing speed ${kmh.toFixed(1)}`);
});

check('ATP trips well above the limit and releases only at stand-still in N/B', () => {
  const t = newTrain(0);
  t.v = 60 / 3.6;
  t.notch = 3;
  t.brake = 0;
  stepTrain(t, flat, 1 / 60, { atpLimitKmh: 50 });
  assert(t.atpWarn && t.atpTrip);
  for (let i = 0; i < 60 * 60 && t.v > 0; i++) stepTrain(t, flat, 1 / 60, { atpLimitKmh: 50 });
  assert.equal(t.v, 0);
  assert(t.atpTrip, 'still latched while in power');
  t.notch = 0;
  stepTrain(t, flat, 1 / 60, { atpLimitKmh: 50 });
  assert(!t.atpTrip);
});

check('doors interlock traction and the red exit signal cannot be passed without penalty', () => {
  const run = new Run(track, schedule);
  run.setNotch(5);
  for (let i = 0; i < 60 * 5; i++) run.step(1 / 60);
  assert.equal(run.train.v, 0, 'doors open: no traction');
  // Rolling past the red exit signal while still dwelling (doors open).
  const r2 = new Run(track, schedule);
  r2.dwellLeft = 60;
  r2.train.brake = 0;
  r2.train.s = r2.exitSignalS(0) - 5;
  r2.train.v = 6;
  r2.train.notch = 0;
  for (let i = 0; i < 60 * 3; i++) r2.step(1 / 60);
  assert(r2.penalty >= 40);
  assert(r2.train.atpTrip || r2.train.v === 0);
});

check('timetable: arrivals increase and dwell 30 s', () => {
  for (let i = 1; i < track.stations.length; i++) {
    assert(schedule.arr[i] > schedule.dep[i - 1] + 120);
    assert.equal(schedule.dep[i], schedule.arr[i] + 30);
  }
});

for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
  check(`autopilot drives the whole line at dt=1/${Math.round(1 / dt)}: exact stops, no overspeed`, () => {
    const run = new Run(track, schedule);
    run.autopilot = true;
    let maxOver = -99;
    for (let i = 0; i < (40 * 60) / dt && run.phase !== 'finished'; i++) {
      run.step(dt);
      maxOver = Math.max(maxOver, Math.abs(run.train.v) * 3.6 - track.limitAt(run.train.s));
    }
    assert.equal(run.phase, 'finished');
    assert.equal(run.results.length, track.stations.length - 1);
    for (const r of run.results) {
      assert(!r.skipped);
      assert(Math.abs(r.stopError) < 1.5, `${r.station} ${r.stopError.toFixed(2)} m`);
      assert(r.lateBy > -40 && r.lateBy < 20, `${r.station} late ${r.lateBy.toFixed(1)} s`);
    }
    assert(maxOver < 3, `max overspeed ${maxOver.toFixed(2)} km/h`);
    assert.equal(run.atpTrips, 0);
    assert(run.time > 10 * 60 && run.time < 20 * 60, `run time ${run.time}`);
    assert(run.score >= 280);
  });
}

check('terrain: formation under the line, cover over tunnels, clearance under the viaduct, lake by the first station', () => {
  const terrain = new Terrain(track);
  const nr = { s: 0, d: 0, side: 1, y: 0 };
  for (let s = 50; s < track.length - 50; s += 97) {
    const p = track.pos(s);
    const h = terrain.height(p.x, p.z);
    assert(Number.isFinite(h));
    if (track.inSpan(track.tunnels, s, -10)) assert(h > p.y + 10, `tunnel cover at ${s}: ${(h - p.y).toFixed(1)}`);
    else if (track.inSpan(track.bridges, s, -2)) assert(h < p.y - 3, `viaduct clearance at ${s}`);
    else if (!track.inSpan(track.tunnels, s, 12) && !track.inSpan(track.bridges, s, 12)) assert(Math.abs(h - (p.y - 0.35)) < 0.5, `formation at ${s}: ${(h - p.y).toFixed(2)}`);
  }
  const mid = (track.bridges[0].from + track.bridges[0].to) / 2;
  const pm = track.pos(mid);
  assert(terrain.height(pm.x, pm.z) < pm.y - 35, 'the ravine is deep under the viaduct');
  const p0 = track.pos(400);
  const h0 = track.headingAt(400);
  const lx = p0.x - Math.sin(h0) * 120;
  const lz = p0.z + Math.cos(h0) * 120;
  assert(terrain.height(lx, lz) < LAKE_Y, 'lake beside the first station');
  terrain.near(lx, lz, nr);
  assert(nr.side > 0, 'the lake lies on the valley side');
  for (const [x, z] of [[-20000, -20000], [30000, 5000], [4000, -15000]]) assert(Number.isFinite(terrain.height(x, z)));
});

console.log(`${passed} railway checks passed (train length ${TRAIN_LENGTH.toFixed(1)} m, EB notch ${EB_NOTCH}).`);
