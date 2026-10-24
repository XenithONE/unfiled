/** DOM overlay: intro, chapter label, timeline, technique panel, keys. */
import { TECHNIQUES } from "./engine/techniques";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const ICON = {
  play: "M5 3l9 5-9 5z",
  pause: "M4 3h3v10H4zM9 3h3v10H9z",
  sndOn: "M2 6h3l4-3v10L5 10H2zM11 5.5c1.2 1.2 1.2 3.8 0 5M12.8 3.8c2.2 2.2 2.2 6.2 0 8.4",
  sndOff: "M2 6h3l4-3v10L5 10H2zM11 6l4 4M15 6l-4 4",
  fs: "M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4",
};

function iconUrl(path: string) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%23f1eee8' stroke-width='1.4' stroke-linejoin='round' stroke-linecap='round'><path d='${path}' ${path === ICON.play || path === ICON.pause ? "fill='%23f1eee8'" : ""}/></svg>`;
  return `url("data:image/svg+xml,${svg.replace(/"/g, "'").replace(/</g, "%3C").replace(/>/g, "%3E")}")`;
}

/** 序章, 第1章, 第2章 … */
const label = (i: number) => (i === 0 ? "序章" : `第${i}章`);

export interface ChapterInfo {
  numeral: string;
  name: string;
  caption: string;
  duration: number;
  techniques: number[];
}

export interface UiHandlers {
  start(withSound: boolean): void;
  seekChapter(i: number): void;
  togglePlay(): boolean;
  toggleSound(): boolean;
  setTechnique(n: number, on: boolean): void;
  techniqueOn(n: number): boolean;
  toggleStopMotion(): boolean;
  step(dir: 1 | -1): void;
  drag(dx: number, dy: number): void;
  release(): void;
}

export class Ui {
  private chapters: ChapterInfo[] = [];
  private segs: HTMLButtonElement[] = [];
  private fills: HTMLElement[] = [];
  private current = -1;
  private idleTimer = 0;
  private toastTimer = 0;
  private h!: UiHandlers;
  private soundOn = false;

  progress(frac: number, msg: string) {
    $("load-bar").style.width = `${Math.round(frac * 100)}%`;
    $("load-msg").textContent = msg;
  }

  ready(h: UiHandlers) {
    this.h = h;
    const s = $<HTMLButtonElement>("start-sound");
    const q = $<HTMLButtonElement>("start-silent");
    s.disabled = false;
    q.disabled = false;
    s.addEventListener("click", () => h.start(true), { once: true });
    q.addEventListener("click", () => h.start(false), { once: true });
    this.progress(1, "準備ができました");
  }

  noGpu(msg?: string) {
    $("intro").hidden = true;
    $("nogpu").hidden = false;
    if (msg) $("nogpu-msg").textContent = msg;
  }

  begin(chapters: ChapterInfo[], soundOn: boolean) {
    this.chapters = chapters;
    this.soundOn = soundOn;
    const intro = $("intro");
    intro.classList.add("leaving");
    window.setTimeout(() => (intro.hidden = true), 1300);
    $("hud").hidden = false;
    this.buildTimeline();
    this.buildTechniques();
    this.wire();
    this.setSound(soundOn);
    this.setPlaying(true);
    $("fs-btn").style.backgroundImage = iconUrl(ICON.fs);
    this.poke();
  }

  private buildTimeline() {
    const tl = $("timeline");
    tl.innerHTML = "";
    this.segs = [];
    this.fills = [];
    this.chapters.forEach((c, i) => {
      const b = document.createElement("button");
      b.style.flex = `${c.duration} 1 0`;
      b.setAttribute("aria-label", `${label(i)} ${c.name}`);
      const fill = document.createElement("i");
      const tag = document.createElement("span");
      tag.textContent = `${label(i)} ${c.name}`;
      b.append(fill, tag);
      b.addEventListener("click", () => this.h.seekChapter(i));
      tl.append(b);
      this.segs.push(b);
      this.fills.push(fill);
    });
  }

  private buildTechniques() {
    const list = $("tech-list");
    list.innerHTML = "";
    for (const t of TECHNIQUES) {
      const li = document.createElement("li");
      li.dataset.n = String(t.n);
      const n = document.createElement("span");
      n.className = "n";
      n.textContent = String(t.n).padStart(2, "0");
      const body = document.createElement("span");
      body.className = "t";
      body.textContent = t.name;
      const d = document.createElement("span");
      d.className = "d";
      d.textContent = t.note;
      body.append(d);
      const sw = document.createElement("button");
      sw.className = "sw";
      sw.setAttribute("role", "switch");
      sw.setAttribute("aria-label", `${t.name} を切り替える`);
      sw.setAttribute("aria-checked", "true");
      if (!t.toggle) sw.disabled = true;
      sw.addEventListener("click", () => {
        const on = !this.h.techniqueOn(t.n);
        this.h.setTechnique(t.n, on);
        sw.setAttribute("aria-checked", String(on));
        this.toast(`${String(t.n).padStart(2, "0")} ${t.name}：${on ? "オン" : "オフ"}`);
      });
      li.append(n, body, sw);
      list.append(li);
    }
  }

  private wire() {
    const h = this.h;
    $("tech-btn").addEventListener("click", () => this.toggleTech());
    $("snd-btn").addEventListener("click", () => this.setSound(h.toggleSound()));
    $("play-btn").addEventListener("click", () => this.setPlaying(h.togglePlay()));
    $("fs-btn").addEventListener("click", () => this.fullscreen());

    window.addEventListener("keydown", (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === " ") {
        e.preventDefault();
        this.setPlaying(h.togglePlay());
      } else if (k === "ArrowRight") h.step(1);
      else if (k === "ArrowLeft") h.step(-1);
      else if (k === "t" || k === "T") this.toggleTech();
      else if (k === "h" || k === "H") document.body.classList.toggle("hide-ui");
      else if (k === "m" || k === "M") this.setSound(h.toggleSound());
      else if (k === "f" || k === "F") this.fullscreen();
      else if (k === "q" || k === "Q") this.toast(h.toggleStopMotion() ? "コマ撮りモード：オン（1秒12コマ）" : "コマ撮りモード：オフ");
      else if (/^[1-9]$/.test(k)) {
        const i = Number(k) - 1;
        if (i < this.chapters.length) h.seekChapter(i);
      } else return;
      this.poke();
    });

    const canvas = document.getElementById("c")!;
    let last: { x: number; y: number } | null = null;
    canvas.addEventListener("pointerdown", (e) => {
      last = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      this.poke();
      if (!last) return;
      h.drag(e.clientX - last.x, e.clientY - last.y);
      last = { x: e.clientX, y: e.clientY };
    });
    const up = () => {
      if (last) h.release();
      last = null;
    };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    window.addEventListener("pointermove", () => this.poke(), { passive: true });
  }

  private toggleTech() {
    const panel = $("tech");
    const open = panel.hidden;
    panel.hidden = !open;
    $("tech-btn").setAttribute("aria-expanded", String(open));
  }

  private fullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }

  setPlaying(playing: boolean) {
    const b = $("play-btn");
    b.style.backgroundImage = iconUrl(playing ? ICON.pause : ICON.play);
    b.setAttribute("aria-label", playing ? "一時停止" : "再生");
  }

  setSound(on: boolean) {
    this.soundOn = on;
    const b = $("snd-btn");
    b.style.backgroundImage = iconUrl(on ? ICON.sndOn : ICON.sndOff);
    b.setAttribute("aria-label", on ? "音を消す" : "音を出す");
  }

  get sound() {
    return this.soundOn;
  }

  /** Shows a chapter's label and lights its techniques. */
  chapter(i: number) {
    if (i === this.current) return;
    this.current = i;
    const c = this.chapters[i];
    if (!c) return;
    $("ch-num").textContent = label(i);
    $("ch-name").textContent = c.name;
    $("ch-caption").textContent = c.caption;
    const box = document.querySelector(".chapter")!;
    box.classList.remove("swap");
    void (box as HTMLElement).offsetWidth;
    box.classList.add("swap");
    this.segs.forEach((s, k) => s.classList.toggle("on", k === i));
    const live = new Set(c.techniques);
    document.querySelectorAll<HTMLLIElement>("#tech-list li").forEach((li) => {
      li.classList.toggle("live", live.has(Number(li.dataset.n)));
    });
  }

  /** Per-frame: timeline fill and clock. */
  tick(index: number, local: number, total: number) {
    this.fills.forEach((f, k) => {
      const d = this.chapters[k].duration;
      const frac = k < index ? 1 : k > index ? 0 : Math.min(1, local / d);
      f.style.width = `${(frac * 100).toFixed(2)}%`;
    });
    let s = local;
    for (let k = 0; k < index; k++) s += this.chapters[k].duration;
    const sec = Math.max(0, Math.min(total, s));
    $("clock").textContent = `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
  }

  /** The galaxy's "you are here" label, at a screen position in 0..1. */
  marker(x: number, y: number, visible: boolean) {
    const el = $("marker");
    if (!el) return;
    el.classList.toggle("on", visible);
    if (visible) el.style.transform = `translate(${(x * 100).toFixed(2)}vw, ${(y * 100).toFixed(2)}vh)`;
  }

  /** #30 readout: galaxies drawn this frame out of all of them. */
  counter(visible: number, total: number) {
    const el = $("counter");
    if (!el) return;
    el.classList.toggle("on", total > 0);
    if (total > 0) el.textContent = `描画中の銀河 ${visible.toLocaleString("ja-JP")} / ${total.toLocaleString("ja-JP")}`;
  }

  subtitle(on: boolean) {
    $("subtitle").classList.toggle("on", on);
  }

  toast(msg: string) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("on");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove("on"), 2200);
  }

  private poke() {
    document.body.classList.remove("idle");
    window.clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      if ($("tech").hidden) document.body.classList.add("idle");
    }, 3200);
  }
}
