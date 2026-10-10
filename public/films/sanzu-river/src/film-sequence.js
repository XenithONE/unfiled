// Eight shots at equinox dusk. Each cut is a small ellipsis in time; every
// angle changes. Looking east is this shore: cold, dark. Looking west is the
// other shore: the last light. World distances are metres.
export const FILM_DURATION = 31;
export const SAI_Z = -30.5;
// The ferry passes beneath the bridge deck (z = −50) in the reverse-angle shot.
export const CROSSING_TIME = 22.4 + 4.4 * (3 / 6.4);
export const SHOTS = Object.freeze([
  { id: 'shore', start: 0, end: 4, title: '此岸', description: 'A red spider lily in cold dusk; the ferry and its white lantern pass behind it, out of focus.' },
  { id: 'lanterns', start: 4, end: 7.8, title: '灯籠流し', description: 'At water level, paper lanterns drift toward the afterglow; focus racks to the departing ferry.' },
  { id: 'aerial', start: 7.8, end: 11.6, title: '渡し', description: 'From above: the white-clad passenger in a wooden skiff among drifting lanterns.' },
  { id: 'passenger', start: 11.6, end: 15.2, title: '誰そ彼', description: 'The passenger, eyes closed, lit by the bow lantern against the darkening shore behind.' },
  { id: 'sai', start: 15.2, end: 18.8, title: '賽の河原', description: 'Stone towers and wandering cold flames on the bank as the ferry slides past.' },
  { id: 'approach', start: 18.8, end: 22.4, title: '橋', description: 'Behind the passenger, the bridge stands black against the light; lanterns wait at the boundary.' },
  { id: 'crossing', start: 22.4, end: 26.8, title: '境', description: 'The ferry passes under the bridge alone and dissolves into the luminous mist.' },
  { id: 'farewell', start: 26.8, end: 31, title: '彼岸', description: 'The same flower against the fading west; the lanterns go out, one by one.' },
]);

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const mix = (a, b, t) => a + (b - a) * t;
const ease = t => t * t * (3 - 2 * t);
const window01 = (x, a, b) => clamp((x - a) / (b - a), 0, 1);
const add = (a, b) => a.map((v, i) => v + b[i]);
const rotate = (v, yaw) => [v[0] * Math.cos(yaw) + v[2] * Math.sin(yaw), v[1], -v[0] * Math.sin(yaw) + v[2] * Math.cos(yaw)];
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const axisDepth = (eye, target, subject) => {
  const length = distance(eye, target);
  return subject.reduce((sum, v, i) => sum + (v - eye[i]) * (target[i] - eye[i]) / length, 0);
};

export const BASE_LOOK = Object.freeze({
  exposure: 1, fogDensity: .125, nearMist: [5, 19], glow: 1, skyGlow: 1, beyondDensity: 1.7, beyondBoost: 1,
  haloDensity: .05, godRays: 0, bloom: .55, onibi: 1, lanterns: 1, flash: 0, fade: 1, bowLight: 2.6, afterglowKey: 1,
  aperturePx: 0, maxBlur: 18, cheat: null, extinguish: 0, beyondWhite: 0,
});

export function createFilmSequence({ riverCenter, shore, bankHeight, heroAnchor, bridgeZ = -50 }) {
  const bloom = add(heroAnchor, [.022, .65, -.008]);
  const bridgeX = riverCenter(bridgeZ);
  const river = (z, offset) => [riverCenter(z) + offset, 0, z];
  const shots = [
    {
      // 此岸: the flower, looking upstream into the cold. The ferry slides behind.
      route: u => { const z = mix(-3.2, -6.9, u); return river(z, shore(z) - 2.7); },
      frame(u, boat) {
        return {
          camera: add(bloom, [mix(.50, .43, u), mix(.25, .215, u), mix(-1.65, -1.56, u)]),
          target: add(bloom, [-.31, -.12, .015]), fov: 37, focus: bloom,
          look: { exposure: 1.35, aperturePx: 18, nearMist: [3, 14], fade: ease(window01(u * 4, 0, 1.15)), bowLight: 2.2, haloDensity: .06,
            cheat: [{ position: add(bloom, [-1.5, .30, .95]), color: 0xff9a52, intensity: 1.15, distance: 4.5 }] },
        };
      },
    },
    {
      // 灯籠流し: water level, facing the afterglow. Focus racks to the ferry.
      route: u => { const z = mix(-12.2, -15.4, u); return river(z, 3.6); },
      frame(u, boat) {
        const camera = [riverCenter(-6) + mix(1.75, 1.65, u), mix(.30, .34, u), mix(-6.05, -6.75, u)];
        const target = [riverCenter(-26) + 2.9, .78, -26];
        const rack = ease(window01(u, .30, .78));
        return {
          camera, target, fov: 40, focusDistance: mix(1.9, axisDepth(camera, target, add(boat, [0, .9, 0])), rack),
          look: { exposure: 1.05, aperturePx: 11, nearMist: [4, 16], fogDensity: .048, haloDensity: .045, godRays: .3, glow: .5, beyondBoost: .45 },
        };
      },
    },
    {
      // 渡し: almost overhead, the skiff among the lanterns; a slow quarter turn.
      route: u => { const z = mix(-19.2, -22.5, u); return river(z, shore(z) - 3.1 - .4 * ease(u)); },
      frame(u, boat, yaw) {
        const spin = yaw + mix(.35, .05, ease(u));
        const camera = add(boat, rotate([2.4, mix(10.6, 10.0, u), -3.4], spin));
        return {
          camera, target: add(boat, rotate([.25, .3, -.9], yaw)), fov: 40, focus: add(boat, [0, .8, 0]),
          look: { exposure: 1.72, aperturePx: 2.2, maxBlur: 5, haloDensity: .025, nearMist: [6, 16],
            cheat: [{ position: add(boat, [.6, 4.2, .4]), color: 0x9ab8e8, intensity: 3.2, distance: 10 }] },
        };
      },
    },
    {
      // 誰そ彼: who is that? The face in lantern light, the east black behind.
      route: u => { const z = mix(-27.1, -29.6, u); return river(z, 3.2); },
      frame(u, boat, yaw) {
        const camera = add(boat, rotate([mix(.46, .40, u), mix(.95, .97, u), mix(-1.98, -1.78, u)], yaw));
        const face = add(boat, rotate([.01, 1.02, -.63], yaw));
        return {
          camera, target: add(face, [0, .012, 0]), fov: 22, focus: face,
          look: { exposure: 1.25, aperturePx: 13, nearMist: [1.2, 7], bowLight: 1.5, haloDensity: .04, fogDensity: .10, afterglowKey: .3 },
        };
      },
    },
    {
      // 賽の河原: a field of stone towers recedes toward the light; cold flames among them.
      route: u => { const z = mix(-33.4, -36.8, u); return river(z, 2.4); },
      frame(u) {
        const z = SAI_Z, bank = riverCenter(z) + shore(z);
        const cx = bank + mix(3.05, 2.90, u), cz = z + mix(-9.35, -9.0, u);
        const camera = [cx, bankHeight(cx, cz) + mix(.46, .50, u), cz];
        const target = [bank - 2.6, .42, z + .6];
        return {
          camera, target, fov: 42, focusDistance: 4.2,
          look: { exposure: 1.45, aperturePx: 6, nearMist: [2.0, 10], haloDensity: .07, onibi: 1, beyondBoost: .6,
            cheat: [{ position: [bank + 1.3, bankHeight(bank + 1.3, z - 2.2) + .85, z - 2.2], color: 0x86b8ff, intensity: 1.6, distance: 6 },
              { position: [bank + 2.6, bankHeight(bank + 2.6, z - 5.1) + 1.05, z - 5.1], color: 0x86b8ff, intensity: 1.1, distance: 5 }] },
        };
      },
    },
    {
      // 橋: behind the passenger; the bridge black against the light.
      route: u => { const z = mix(-40.6, -43.4, u); return river(z, 1.4); },
      frame(u, boat, yaw) {
        const camera = add(boat, rotate([-.85, mix(1.30, 1.36, u), mix(5.3, 4.9, u)], yaw));
        const target = [bridgeX + .9, 1.25, bridgeZ - 3];
        return {
          camera, target, fov: 44, focus: add(boat, [0, 1.0, 0]),
          look: { exposure: 1.15, aperturePx: 4, maxBlur: 8, nearMist: [3, 12], godRays: .5, haloDensity: .05, glow: .95, beyondBoost: .5 },
        };
      },
    },
    {
      // 境: the reverse angle from the far side. The ferry comes through the
      // arch alone; its lantern dies at the boundary, then the light takes it.
      route: u => { const z = mix(-47.0, -53.4, u); return river(z, 1.4); },
      frame(u, boat) {
        const camera = [bridgeX + mix(1.95, 2.15, u), mix(1.30, 1.20, u), mix(-57.6, -58.5, u)];
        const target = [bridgeX + 1.15, mix(1.30, 1.12, u), bridgeZ + 2];
        const crossing = clamp((bridgeZ + .15 - boat[2]) / .55, 0, 1);
        const dissolve = ease(window01(u, .56, 1));
        return {
          camera, target, fov: 36, focus: add(boat, [0, 1.0, 0]),
          look: { exposure: 1.2, aperturePx: 6, maxBlur: 10, nearMist: [3, 12], haloDensity: .05,
            beyondDensity: mix(.10, 1.5, dissolve), beyondBoost: mix(.75, 3.2, dissolve), beyondWhite: dissolve,
            bowLight: 2.6 * (1 - ease(crossing)) * (crossing > 0 && crossing < 1 ? .55 + .45 * Math.sin(crossing * 47) : 1),
            flash: .85 * ease(window01(u, .82, 1)) },
        };
      },
    },
    {
      // 彼岸: the same flower against the west. The lanterns go out; night falls.
      route: u => { const z = mix(-58, -60, u); return river(z, 1.4); },
      frame(u) {
        const camera = add(bloom, [mix(.36, .32, u), mix(-.13, -.10, u), mix(1.30, 1.22, u)]);
        const target = add(bloom, [-.30, .13, -1]);
        const night = ease(window01(u, .25, 1));
        return {
          camera, target, fov: 36, focus: bloom,
          look: { exposure: 1.3, aperturePx: 16, nearMist: [3, 14], skyGlow: 1 - .72 * night, glow: 1 - .6 * night, beyondBoost: 1.3 - .9 * night,
            flash: .82 * (1 - ease(window01(u, 0, .2))), fade: 1 - ease(window01(u, .72, .97)), extinguish: window01(u, .2, .82), bowLight: 0, godRays: .35 * (1 - night), onibi: 0,
            cheat: [{ position: add(bloom, [-1.3, .35, -1.1]), color: 0xff9a52, intensity: .55 * (1 - night), distance: 4.5 }] },
        };
      },
    },
  ];

  return {
    shots: SHOTS,
    sample(seconds) {
      const time = clamp(Number(seconds) || 0, 0, FILM_DURATION);
      let index = SHOTS.findIndex(s => time < s.end);
      if (index < 0) index = SHOTS.length - 1;
      const shot = SHOTS[index], design = shots[index];
      const u = clamp((time - shot.start) / (shot.end - shot.start), 0, 1);
      const boatPosition = design.route(u);
      const before = design.route(u - .0001), after = design.route(u + .0001);
      const boatYaw = Math.atan2(-(after[0] - before[0]), -(after[2] - before[2]));
      boatPosition[1] = Math.sin(time * 1.23) * .010 + Math.sin(time * 2.31 + 1.2) * .004;
      const framed = design.frame(u, boatPosition, boatYaw);
      const look = { ...BASE_LOOK, ...framed.look };
      const focusDistance = framed.focusDistance ?? axisDepth(framed.camera, framed.target, framed.focus);
      return {
        time, shotIndex: index, shotId: shot.id, progress: u, boatPosition, boatYaw,
        cameraPosition: framed.camera, cameraTarget: framed.target, cameraFov: framed.fov,
        focusDistance, aperturePx: look.aperturePx, maxBlur: look.maxBlur, look,
        bridgeCrossing: clamp((-boatPosition[2] + bridgeZ + 1.25) / 2.5, 0, 1),
      };
    },
  };
}
