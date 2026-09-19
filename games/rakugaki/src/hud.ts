import { formatScore } from "./util";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

export interface ResultInfo {
  score: number;
  time: number;
  bestScore: number;
  bestTime: number;
  recordScore: boolean;
  recordTime: boolean;
}

export const formatTime = (seconds: number): string => {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest < 10 ? "0" : ""}${rest.toFixed(1)}`;
};

/** All DOM overlays: score, speed, combo, popups, title / pause / results screens. */
export class Hud {
  private readonly score = $("score");
  private readonly best = $("best");
  private readonly time = $("time");
  private readonly dist = $("dist");
  private readonly speed = $("speed");
  private readonly speedo = $("speedo");
  private readonly comboNames = $("comboNames");
  private readonly comboMath = $("comboMath");
  private readonly combo = $("combo");
  private readonly popups = $("popups");
  private readonly balance = $("balance");
  private readonly balanceKnob = $("balanceKnob");
  private readonly message = $("message");
  private readonly messageMain = $("messageMain");
  private readonly messageSub = $("messageSub");
  private readonly title = $("title");
  private readonly pause = $("pause");
  private readonly results = $("results");
  private readonly resultScore = $("resultScore");
  private readonly resultTime = $("resultTime");
  private readonly resultBest = $("resultBest");
  private readonly resultRecord = $("resultRecord");
  private readonly titleBest = $("titleBest");
  private readonly touch = $("touch");
  private readonly hint = $("hint");
  private readonly muteButtons = document.querySelectorAll<HTMLButtonElement>("[data-mute]");
  private messageTimer = 0;
  private lastComboKey = "";
  private lastSpeed = -1;

  onStart: (() => void) | null = null;
  onResume: (() => void) | null = null;
  onQuit: (() => void) | null = null;
  onRetry: (() => void) | null = null;
  onMute: (() => void) | null = null;

  constructor() {
    $("startBtn").addEventListener("click", () => this.onStart?.());
    $("resumeBtn").addEventListener("click", () => this.onResume?.());
    document
      .querySelectorAll<HTMLButtonElement>("[data-quit]")
      .forEach((b) => b.addEventListener("click", () => this.onQuit?.()));
    $("retryBtn").addEventListener("click", () => this.onRetry?.());
    this.muteButtons.forEach((b) => b.addEventListener("click", () => this.onMute?.()));
  }

  setTouchVisible(visible: boolean): void {
    this.touch.hidden = !visible;
    this.hint.hidden = visible;
  }

  setMuted(muted: boolean): void {
    this.muteButtons.forEach((b) => {
      b.textContent = muted ? "音: OFF" : "音: ON";
      b.setAttribute("aria-pressed", muted ? "true" : "false");
    });
  }

  setScore(n: number): void {
    this.score.textContent = formatScore(n);
  }
  setBest(score: number, time: number): void {
    this.best.textContent = formatScore(score);
    this.titleBest.textContent =
      time > 0 ? `${formatScore(score)} pt / ${formatTime(time)}` : `${formatScore(score)} pt`;
  }
  setTime(seconds: number): void {
    this.time.textContent = formatTime(seconds);
  }
  setDistance(metres: number): void {
    this.dist.textContent = metres <= 0 ? "GOAL" : `ゴールまで ${Math.ceil(metres)} m`;
  }
  setSpeed(kmh: number): void {
    const v = Math.round(kmh);
    if (v === this.lastSpeed) return;
    this.lastSpeed = v;
    this.speed.textContent = String(v);
    this.speedo.classList.toggle("is-fast", v >= 100);
    this.speedo.classList.toggle("is-insane", v >= 140);
  }

  setCombo(names: readonly string[], score: number, count: number): void {
    const key = `${names.join("+")}|${score}|${count}`;
    if (key === this.lastComboKey) return;
    this.lastComboKey = key;
    if (count === 0) {
      this.combo.classList.remove("is-live");
      return;
    }
    this.combo.classList.add("is-live");
    this.comboNames.textContent = names.slice(-5).join(" + ");
    this.comboMath.textContent = `${formatScore(score)} × ${count}`;
  }

  popup(text: string, kind: "trick" | "bank" | "bail" | "boost" | "sketchy" = "trick"): void {
    const el = document.createElement("span");
    el.className = `pop pop--${kind}`;
    el.textContent = text;
    el.style.setProperty("--tilt", `${(Math.random() - 0.5) * 10}deg`);
    el.style.setProperty("--dx", `${(Math.random() - 0.5) * 120}px`);
    this.popups.appendChild(el);
    while (this.popups.childElementCount > 6) this.popups.firstElementChild?.remove();
    window.setTimeout(() => el.remove(), 1500);
  }

  setBalance(v: number | null): void {
    if (v === null) {
      this.balance.hidden = true;
      return;
    }
    this.balance.hidden = false;
    this.balanceKnob.style.transform = `translateX(${v * 100}%)`;
    this.balance.classList.toggle("is-danger", Math.abs(v) > 0.7);
  }

  showMessage(main: string, sub = "", seconds = 1.2): void {
    this.messageMain.textContent = main;
    this.messageSub.textContent = sub;
    this.message.hidden = false;
    this.message.classList.remove("is-in");
    void this.message.offsetWidth;
    this.message.classList.add("is-in");
    this.messageTimer = seconds;
  }

  tick(dt: number): void {
    if (this.messageTimer > 0) {
      this.messageTimer -= dt;
      if (this.messageTimer <= 0) this.message.hidden = true;
    }
  }

  showTitle(): void {
    this.title.hidden = false;
    this.pause.hidden = true;
    this.results.hidden = true;
    this.combo.classList.remove("is-live");
    this.lastComboKey = "";
    $("startBtn").focus({ preventScroll: true });
  }
  hideTitle(): void {
    this.title.hidden = true;
  }
  showPause(): void {
    this.pause.hidden = false;
    $("resumeBtn").focus({ preventScroll: true });
  }
  hidePause(): void {
    this.pause.hidden = true;
  }
  showResults(r: ResultInfo): void {
    this.resultScore.textContent = formatScore(r.score);
    this.resultTime.textContent = formatTime(r.time);
    this.resultBest.textContent = `BEST ${formatScore(r.bestScore)} pt / ${formatTime(r.bestTime)}`;
    const record = r.recordScore && r.recordTime
      ? "スコアもタイムも自己ベスト！"
      : r.recordScore
        ? "スコア自己ベスト更新！"
        : r.recordTime
          ? "タイム自己ベスト更新！"
          : "";
    this.resultRecord.textContent = record;
    this.resultRecord.hidden = record === "";
    this.results.hidden = false;
    $("retryBtn").focus({ preventScroll: true });
  }
  hideResults(): void {
    this.results.hidden = true;
  }
}
