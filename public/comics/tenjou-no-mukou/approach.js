import { spriteLayout } from './sprite-layout.js?v=5';

const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };

// One document-length floor, with a transparent, moving foreground.
// The authored drawings change pose; the floor never changes to another panel.
export class ApproachScene {
  constructor(section, frames) {
    this.section = section;
    this.frames = frames;
    this.floor = document.createElement('div');
    this.floor.className = 'approach-floor';
    this.floor.setAttribute('aria-hidden', 'true');
    this.viewport = document.createElement('div');
    this.viewport.className = 'ghost-viewport';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'ghost-canvas';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', '床を這い、画面の外へつかみかかってくる人影');
    this.viewport.append(this.canvas);
    section.prepend(this.floor, this.viewport);
    this.context = this.canvas.getContext('2d', { alpha: true });
  }

  setImages(images) { this.images = images; }

  start() {
    this.section.classList.add('is-running');
    this.width = innerWidth;
    this.height = innerHeight;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.top = this.section.getBoundingClientRect().top + scrollY;
    this.distance = Math.max(1, this.section.offsetHeight - this.height);
    this.draw(0, 0);
  }

  draw(index, progress) {
    const p = clamp(progress);
    const pose = this.frames[index];
    const key = pose.sheet ? `rush-${pose.sheet}` : 'final';
    const image = this.images?.get(`ghost-${key}`);
    if (!image) return;
    const [sx, sy, sw, sh] = spriteLayout[key].boxes[pose.cell];
    const { width, height, context } = this;
    const travel = .08 * p + .92 * p ** 1.25;
    const floorOpacity = 1 - smooth((p - .42) / .28);
    const finalSize = Math.max(Math.min(height * 1.65, width * 1.85), width * 1.06);
    const h = height * .2 + (finalSize - height * .2) * p ** 1.55;
    const w = h * sw / sh;
    const crawl = Math.sin(p * Math.PI * 7) * (1 - p);
    const x = width * (.5 + .015 * crawl) - w / 2;
    const y = height * (.44 + .045 * Math.sin(p * Math.PI)) - h * (.5 - .16 * p);
    window.scrollTo({ top: this.top + this.distance * travel, left: 0, behavior: 'instant' });
    this.floor.style.opacity = String(floorOpacity);
    context.clearRect(0, 0, width, height);
    context.drawImage(image, sx, sy, sw, sh, x, y, w, h);
    this.section.dataset.progress = p.toFixed(4);
    this.section.dataset.floor = floorOpacity.toFixed(4);
    this.section.dataset.ghostHeight = h.toFixed(1);
    this.section.dataset.ghostY = y.toFixed(1);
    this.canvas.dataset.frame = String(index);
  }

  stop() {
    this.section.classList.remove('is-running');
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.floor.style.opacity = '1';
    for (const key of ['progress', 'floor', 'ghostHeight', 'ghostY']) delete this.section.dataset[key];
  }
}
