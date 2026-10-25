/**
 * A dirty front element, painted once on the CPU: soft smudges, out-of-focus
 * dust specks (discs with a brighter rim, the way the aperture images them),
 * two fingerprints and a few hairline scratches. Used as a mask on the bloom
 * (#38), so it only shows where something bright floods the lens.
 */
import { CanvasTexture, LinearFilter, NoColorSpace } from "three/webgpu";
import { makeRandom } from "./rock";

export function makeLensDirt(w = 1280, h = 720): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgb(14,14,14)";
  g.fillRect(0, 0, w, h);
  const rand = makeRandom(4242);
  g.globalCompositeOperation = "lighter";

  const blob = (x: number, y: number, r: number, inner: number, outer: number, rim = 0) => {
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(255,255,255,${inner})`);
    if (rim > 0) grd.addColorStop(0.82, `rgba(255,255,255,${rim})`);
    grd.addColorStop(1, `rgba(255,255,255,${outer})`);
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  };

  // broad smudges, denser toward the edges of the glass
  for (let k = 0; k < 90; k++) {
    const x = rand() * w;
    const y = rand() * h;
    const edge = Math.hypot((x - w / 2) / (w / 2), (y - h / 2) / (h / 2));
    const r = 40 + rand() ** 2 * 220;
    blob(x, y, r, (0.02 + rand() * 0.07) * (0.6 + edge * 0.6), 0);
  }
  // out-of-focus dust: discs with a soft brighter rim
  for (let k = 0; k < 1400; k++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = 1 + rand() ** 3.2 * 14;
    const a = 0.05 + rand() * 0.3;
    blob(x, y, r, a * 0.55, 0, a);
  }
  // fingerprints: families of thin concentric arcs, broken up
  g.lineCap = "round";
  for (let f = 0; f < 2; f++) {
    const cx = (0.15 + rand() * 0.7) * w;
    const cy = (0.2 + rand() * 0.6) * h;
    const rot = rand() * Math.PI;
    for (let k = 0; k < 26; k++) {
      const rx = 12 + k * 4.2;
      const ry = rx * 0.72;
      g.strokeStyle = `rgba(255,255,255,${0.035 + rand() * 0.035})`;
      g.lineWidth = 1.2;
      g.beginPath();
      const a0 = rand() * Math.PI * 2;
      g.ellipse(cx, cy, rx, ry, rot, a0, a0 + Math.PI * (0.6 + rand() * 1.1));
      g.stroke();
    }
  }
  // hairline scratches
  for (let k = 0; k < 7; k++) {
    const x = rand() * w;
    const y = rand() * h;
    const a = rand() * Math.PI;
    const len = 60 + rand() * 220;
    g.strokeStyle = `rgba(255,255,255,${0.05 + rand() * 0.07})`;
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + (rand() - 0.5) * 40, y + Math.sin(a) * len * 0.5 + (rand() - 0.5) * 40, x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }

  const tex = new CanvasTexture(c);
  tex.colorSpace = NoColorSpace;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}
