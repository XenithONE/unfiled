// Driver's display: speedometer, controller position, brake cylinder,
// tractive effort, gradient, next restriction, stop-position assist, route
// strip, clock and timetable. Plain DOM + SVG, updated a few times a second
// (the needle every frame).

import { EB_NOTCH, POWER_NOTCHES } from "./physics";
import type { Run, RunMessage } from "./run";
import type { Track } from "./track";

const SPEED_MAX = 100;
const A0 = -135; // dial start angle (deg, 0 = up, clockwise), sweeps 270°
const SWEEP = 270;

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
function arcPath(cx: number, cy: number, r: number, d0: number, d1: number): string {
  const [x0, y0] = polar(cx, cy, r, d0);
  const [x1, y1] = polar(cx, cy, r, d1);
  const large = d1 - d0 > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
const speedDeg = (kmh: number) => A0 + (Math.min(Math.max(kmh, 0), SPEED_MAX) / SPEED_MAX) * SWEEP;

export function fmtClock(sec: number): string {
  const s = Math.floor(((sec % 86400) + 86400) % 86400);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}
const fmtHM = (sec: number) => fmtClock(sec).slice(0, 5);

export class Hud {
  readonly root: HTMLElement;
  private el: Record<string, HTMLElement | SVGElement> = {};
  private notchRows: HTMLElement[] = [];
  private toast: HTMLElement;
  private toastTimer = 0;
  private track: Track;
  clock0: number;
  private lastSlow = 0;
  onLever?: (notch: number) => void;
  onButton?: (id: string) => void;

  constructor(root: HTMLElement, toast: HTMLElement, track: Track, clock0: number) {
    this.root = root;
    this.toast = toast;
    this.track = track;
    this.clock0 = clock0;
    root.innerHTML = this.template();
    root.querySelectorAll<HTMLElement>("[data-k]").forEach((e) => (this.el[e.dataset.k!] = e));
    root.querySelectorAll<SVGElement>("[data-s]").forEach((e) => (this.el[e.dataset.s!] = e));
    this.notchRows = Array.from(root.querySelectorAll<HTMLElement>(".notch-row"));
    this.buildDial();
    this.buildRoute();
    this.bindLever();
    root.querySelectorAll<HTMLElement>("[data-btn]").forEach((b) => {
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this.onButton?.(b.dataset.btn!);
      });
      b.addEventListener("pointerup", (e) => {
        e.preventDefault();
        this.onButton?.(b.dataset.btn! + ":up");
      });
    });
  }

  private template(): string {
    const notches: string[] = [];
    for (let n = POWER_NOTCHES; n >= EB_NOTCH; n--) {
      const label = n > 0 ? `P${n}` : n === 0 ? "N" : n === EB_NOTCH ? "非常" : `B${-n}`;
      const cls = n > 0 ? "p" : n === 0 ? "n" : n === EB_NOTCH ? "eb" : "b";
      notches.push(`<div class="notch-row ${cls}" data-n="${n}">${label}</div>`);
    }
    return `
      <div class="panel route" aria-label="路線">
        <div class="route-strip" data-k="strip"><div class="route-line"></div><div class="route-train" data-k="rtrain"></div></div>
        <div class="next">
          <span class="next-lbl">次は</span>
          <span class="next-name" data-k="nextName">—</span>
          <span class="next-dist" data-k="nextDist">—</span>
        </div>
        <div class="next-sub"><span data-k="nextArr">—</span><span class="delay" data-k="delay"></span></div>
      </div>
      <div class="panel clock" aria-label="時刻">
        <div class="clock-time" data-k="clock">--:--:--</div>
        <div class="tt" data-k="tt"></div>
      </div>
      <div class="stop-assist" data-k="assist" hidden>
        <div class="sa-scale"><div class="sa-mark"></div><div class="sa-fill" data-k="saFill"></div></div>
        <div class="sa-text" data-k="saText"></div>
      </div>
      <div class="desk">
        <div class="dial-wrap">
          <svg viewBox="0 0 200 200" class="dial" aria-hidden="true">
            <circle cx="100" cy="100" r="96" class="dial-bg"/>
            <path data-s="limitArc" class="limit-arc" d=""/>
            <g data-s="ticks"></g>
            <line data-s="needle" x1="100" y1="100" x2="100" y2="22" class="needle"/>
            <circle cx="100" cy="100" r="7" class="hub"/>
          </svg>
          <div class="dial-read"><b data-k="kmh">0</b><small>km/h</small></div>
          <div class="dial-limit">制限 <b data-k="limit">—</b></div>
        </div>
        <div class="notches" data-k="notches">${notches.join("")}</div>
        <div class="gauges">
          <div class="g-row"><span>引張力</span><div class="g-bar"><i data-k="tract"></i></div><em data-k="tractN">0 kN</em></div>
          <div class="g-row"><span>BC圧</span><div class="g-bar brake"><i data-k="bc"></i></div><em data-k="bcN">0.0 bar</em></div>
          <div class="g-row"><span>勾配</span><div class="grade" data-k="grade">0 ‰</div></div>
          <div class="g-row"><span>次の制限</span><div class="nextlim" data-k="nextLim">—</div></div>
          <div class="lamps">
            <span class="lamp" data-k="lDoor">ドア</span>
            <span class="lamp" data-k="lSig">出発</span>
            <span class="lamp warn" data-k="lAtp">ZUB</span>
            <span class="lamp" data-k="lSlip">空転</span>
            <span class="lamp auto" data-k="lAuto">自動</span>
          </div>
        </div>
      </div>
      <div class="cam-label" data-k="cam">運転台</div>
      <div class="touch">
        <div class="lever" data-k="lever" aria-label="マスコン・ブレーキハンドル">
          <div class="lever-track"></div>
          <div class="lever-knob" data-k="knob"></div>
        </div>
        <div class="btns">
          <button data-btn="eb" class="b-eb">非常</button>
          <button data-btn="horn">警笛</button>
          <button data-btn="cam">視点</button>
          <button data-btn="auto">自動</button>
          <button data-btn="pause">Ⅱ</button>
        </div>
      </div>`;
  }

  private buildDial(): void {
    const g = this.el.ticks as SVGGElement;
    const ns = "http://www.w3.org/2000/svg";
    for (let v = 0; v <= SPEED_MAX; v += 5) {
      const major = v % 10 === 0;
      const d = speedDeg(v);
      const [x0, y0] = polar(100, 100, 90, d);
      const [x1, y1] = polar(100, 100, major ? 78 : 84, d);
      const l = document.createElementNS(ns, "line");
      l.setAttribute("x1", x0.toFixed(1));
      l.setAttribute("y1", y0.toFixed(1));
      l.setAttribute("x2", x1.toFixed(1));
      l.setAttribute("y2", y1.toFixed(1));
      l.setAttribute("class", major ? "tick major" : "tick");
      g.appendChild(l);
      if (major && v % 20 === 0) {
        const [tx, ty] = polar(100, 100, 64, d);
        const t = document.createElementNS(ns, "text");
        t.setAttribute("x", tx.toFixed(1));
        t.setAttribute("y", (ty + 5).toFixed(1));
        t.setAttribute("class", "tick-num");
        t.textContent = String(v);
        g.appendChild(t);
      }
    }
  }

  private buildRoute(): void {
    const strip = this.el.strip as HTMLElement;
    const L = this.track.length;
    for (const st of this.track.stations) {
      const d = document.createElement("div");
      d.className = "route-st";
      d.style.left = `${(st.stopS / L) * 100}%`;
      d.innerHTML = `<i></i><span>${st.kana}</span>`;
      strip.appendChild(d);
    }
    for (const t of this.track.tunnels) {
      const d = document.createElement("div");
      d.className = "route-tun";
      d.style.left = `${(t.from / L) * 100}%`;
      d.style.width = `${((t.to - t.from) / L) * 100}%`;
      strip.appendChild(d);
    }
    for (const b of this.track.bridges) {
      const d = document.createElement("div");
      d.className = "route-br";
      d.style.left = `${(b.from / L) * 100}%`;
      d.style.width = `${((b.to - b.from) / L) * 100}%`;
      strip.appendChild(d);
    }
  }

  private bindLever(): void {
    const lever = this.el.lever as HTMLElement;
    const total = POWER_NOTCHES - EB_NOTCH;
    const fromY = (clientY: number) => {
      const r = lever.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
      return Math.round(POWER_NOTCHES - f * total);
    };
    let active = false;
    lever.addEventListener("pointerdown", (e) => {
      active = true;
      lever.setPointerCapture(e.pointerId);
      this.onLever?.(fromY(e.clientY));
      e.preventDefault();
    });
    lever.addEventListener("pointermove", (e) => {
      if (active) this.onLever?.(fromY(e.clientY));
    });
    const end = () => (active = false);
    lever.addEventListener("pointerup", end);
    lever.addEventListener("pointercancel", end);
    lever.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.onButton?.(e.deltaY < 0 ? "up" : "down");
      },
      { passive: false },
    );
  }

  message(m: RunMessage): void {
    this.toast.innerHTML = `<div class="toast ${m.kind}"><b>${m.text}</b>${m.sub ? `<span>${m.sub}</span>` : ""}</div>`;
    this.toast.classList.add("show");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove("show"), m.kind === "bad" ? 4200 : 3000);
  }

  setCamera(label: string): void {
    this.el.cam.textContent = label;
  }

  /** Needle and numbers: call every frame. */
  frame(run: Run): void {
    const t = run.train;
    const kmh = Math.abs(t.v) * 3.6;
    (this.el.needle as SVGElement).setAttribute("transform", `rotate(${speedDeg(kmh).toFixed(2)} 100 100)`);
    this.el.kmh.textContent = kmh < 0.5 ? "0" : kmh.toFixed(0);
    // Lever knob position.
    const total = POWER_NOTCHES - EB_NOTCH;
    (this.el.knob as HTMLElement).style.top = `${((POWER_NOTCHES - t.notch) / total) * 100}%`;
  }

  /** Everything else, a few times a second. */
  slow(run: Run, now: number): void {
    if (now - this.lastSlow < 0.12) return;
    this.lastSlow = now;
    const t = run.train;
    const tr = this.track;
    const lim = tr.limitAt(t.s);
    this.el.limit.textContent = String(lim);
    (this.el.limitArc as SVGElement).setAttribute("d", arcPath(100, 100, 92, speedDeg(lim), speedDeg(SPEED_MAX)));
    this.notchRows.forEach((r) => r.classList.toggle("on", Number(r.dataset.n) === t.notch));
    const kN = (t.tractionN - (t.v > 0.05 ? t.brakeN : 0)) / 1000;
    const tr01 = Math.min(1, Math.abs(kN) / 200);
    const tractEl = this.el.tract as HTMLElement;
    tractEl.style.width = `${tr01 * 100}%`;
    tractEl.classList.toggle("neg", kN < 0);
    this.el.tractN.textContent = `${kN >= 0 ? "" : "−"}${Math.abs(kN).toFixed(0)} kN`;
    const bar = Math.min(3.8, t.brake * 3.3);
    (this.el.bc as HTMLElement).style.width = `${(bar / 3.8) * 100}%`;
    this.el.bcN.textContent = `${bar.toFixed(1)} bar`;
    const g = tr.gradeAt(t.s) * 1000;
    this.el.grade.innerHTML = `<i class="gr-ico ${g > 1 ? "up" : g < -1 ? "down" : "lvl"}"></i>${Math.abs(g).toFixed(0)} ‰`;
    // Next lower restriction within 1.5 km.
    let nl = "";
    for (const sg of tr.signs) {
      if (sg.warning || sg.s <= t.s + 1) continue;
      if (sg.s - t.s > 1500) break;
      if (sg.kmh < lim) {
        nl = `▼ ${sg.kmh} km/h　${Math.round(sg.s - t.s)} m`;
        break;
      }
      if (sg.kmh > lim) {
        nl = `▲ ${sg.kmh} km/h　${Math.round(sg.s - t.s)} m`;
        break;
      }
    }
    this.el.nextLim.textContent = nl || "—";
    // Lamps.
    this.el.lDoor.classList.toggle("lit", run.doorAnim > 0);
    this.el.lSig.classList.toggle("lit", run.phase === "dwell" && run.signalGreen);
    this.el.lSig.classList.toggle("red", run.phase === "dwell" && !run.signalGreen);
    this.el.lAtp.classList.toggle("lit", t.atpWarn || t.atpTrip);
    this.el.lSlip.classList.toggle("lit", t.wheelSlip > 0.3);
    this.el.lAuto.classList.toggle("lit", run.autopilot);
    // Route and next station.
    (this.el.rtrain as HTMLElement).style.left = `${(t.s / tr.length) * 100}%`;
    const ni = run.phase === "running" ? run.at + 1 : run.at;
    const st = tr.stations[Math.min(ni, tr.stations.length - 1)];
    const d = st.stopS - t.s;
    this.el.nextName.textContent = `${st.kana}`;
    this.el.nextDist.textContent = run.phase === "running" ? (d > 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.max(0, Math.round(d))} m`) : "停車中";
    const arr = run.schedule.arr[ni];
    const dep = run.schedule.dep[run.at];
    if (run.phase === "running") {
      this.el.nextArr.textContent = `着 ${fmtClock(this.clock0 + arr)}`;
      // Predicted delay: time left at current average line speed is unknowable;
      // show lateness against the timetable only once it is certain.
      const late = run.time - arr;
      this.el.delay.textContent = late > 0 ? `+${Math.round(late)} 秒` : "";
    } else if (run.phase === "dwell") {
      const wait = Math.max(0, run.dwellLeft);
      this.el.nextArr.textContent = run.at < tr.stations.length - 1 ? `発 ${fmtClock(this.clock0 + dep)}　（あと ${Math.ceil(wait)} 秒）` : "";
      this.el.delay.textContent = "";
    } else {
      this.el.nextArr.textContent = "終点";
      this.el.delay.textContent = "";
    }
    this.el.clock.textContent = fmtClock(this.clock0 + run.time);
    // Timetable.
    const rows = tr.stations.map((s, i) => {
      const a = i === 0 ? "" : fmtHM(this.clock0 + run.schedule.arr[i]);
      const dp = i === tr.stations.length - 1 ? "" : fmtHM(this.clock0 + run.schedule.dep[i]);
      const cls = i < ni || (i === ni && run.phase !== "running") ? "past" : i === ni ? "cur" : "";
      return `<div class="tt-row ${cls}"><span>${s.kana}</span><em>${a}</em><em>${dp}</em></div>`;
    });
    this.el.tt.innerHTML = rows.join("");
    // Stop assist.
    const assist = this.el.assist as HTMLElement;
    if (run.phase === "running" && d < 450 && d > -45) {
      assist.hidden = false;
      const f = Math.max(0, Math.min(1, 1 - d / 450));
      (this.el.saFill as HTMLElement).style.width = `${f * 100}%`;
      (this.el.saFill as HTMLElement).classList.toggle("over", d < 0);
      this.el.saText.textContent = d >= 0 ? `停止位置まで ${d < 20 ? d.toFixed(1) : Math.round(d)} m` : `${(-d).toFixed(1)} m 行き過ぎ`;
    } else {
      assist.hidden = true;
    }
  }
}
