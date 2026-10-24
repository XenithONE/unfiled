/**
 * I — 環の塵. Skimming through a planetary ring, then rising out of it to see
 * the whole giant: bokeh dust (#1), glints with anamorphic flares (#4), ice
 * drops that refract the planet upside down (#3), impostor ice boulders (#10)
 * with MatCap (#23) that fade by dithering (#5), edge-shrink (#6) and a
 * minimum pixel size for two million distant grains (#12, #31).
 */
import type { Ctx, Look } from "../engine/chapter";
import { Chapter, ramp } from "../engine/chapter";
import { Track } from "../engine/rig";
import type { PlanetSystem } from "./planet";

export class RingsChapter extends Chapter {
  readonly id = "rings";
  readonly numeral = "I";
  readonly name = "環の塵";
  readonly caption = "巨大な惑星の環は、数えきれない氷の粒でできている。";
  readonly duration = 26;
  readonly techniques = [31, 1, 3, 4, 5, 6, 10, 12, 23];
  private sys: PlanetSystem;

  constructor(sys: PlanetSystem) {
    super();
    this.sys = sys;
    this.fadeIn = 0;
    this.fadeOut = 0;
  }

  build(_ctx: Ctx) {
    this.track = new Track([
      { t: 0, pos: [100.4, 0.35, -6.5], look: [62, 2.5, -58], fov: 64 },
      { t: 7, pos: [97.6, 0.6, -25], look: [55, 2, -70], fov: 62 },
      { t: 11, pos: [96, 4, -38], look: [40, -2, -60], fov: 58 },
      { t: 15.5, pos: [150, 40, 60], look: [0, 0, 0], fov: 52 },
      { t: 20.5, pos: [199.6, 85.4, 248.5], look: [0, -6, 0], fov: 46, roll: 0 },
      { t: 26, pos: [168, 58, 206], look: [36, -2, -18], fov: 42, roll: 0.06 },
    ]);
  }

  enter(_ctx: Ctx) {
    this.sys.group.visible = true;
    this.sys.moonVisible.value = 1;
    this.sys.moon.visible = true;
  }

  exit(_ctx: Ctx) {
    this.sys.group.visible = false;
  }

  update(_ctx: Ctx, t: number) {
    const s = this.sys;
    s.orbitT.value = t;
    s.level.value = 1;
    // the close-up dust thins as the camera climbs out of the ring plane
    s.nearLevel.value = 1 - ramp(t, 11, 15);
    s.dropLevel.value = 1 - ramp(t, 9.5, 12.5);
    s.boulderLevel.value = 1 - ramp(t, 16, 21);
    s.moonCrack.value = 0;
  }

  look(t: number, out: Look) {
    out.bloom = [0.85, 0.5, 0.55];
    out.sky = 0.85;
    out.near = 0.03;
    out.far = 5200;
    out.focus = 3.5 + ramp(t, 8, 16) * 40;
    out.aperture = 16 * (1 - ramp(t, 10, 16));
    out.exposure = 1.0;
    // the prologue ends in white; come out of it
    out.flash = (1 - ramp(t, 0, 1.4)) * 1.2;
  }
}
