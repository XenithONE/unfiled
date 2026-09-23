import "@fontsource/anton/latin-400.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "./style.css";
import * as THREE from "three";
import { Sound } from "./audio";
import { Hud, fmtClock } from "./hud";
import { clamp, lerp } from "./noise";
import { EB_NOTCH, POWER_NOTCHES } from "./physics";
import { Run, buildSchedule, type RunMessage, type Schedule } from "./run";
import { buildScenery, frameAt, type SceneryResult } from "./scenery";
import { Terrain } from "./terrain";
import { LAKE_Y, Track } from "./track";
import { TrainModel } from "./train";
import { World, type TimeOfDay } from "./world";

type CamMode = "cab" | "chase" | "trackside" | "aerial";
const CAM_LABEL: Record<CamMode, string> = { cab: "運転台", chase: "外観", trackside: "沿線", aerial: "空撮" };
const CAM_ORDER: CamMode[] = ["cab", "chase", "trackside", "aerial"];
const CLOCK0: Record<TimeOfDay, number> = { morning: 7 * 3600 + 11 * 60 + 40, noon: 12 * 3600 + 11 * 60 + 40, evening: 18 * 3600 + 41 * 60 + 40 };
const BEST_KEY = "alpine-rail:best";

type Phase = "loading" | "title" | "playing" | "paused" | "results";

interface DevHooks {
  run: () => Run | null;
  track: Track;
  step(dt: number): void;
  sim(seconds: number): void;
  freeze(f: boolean): void;
  start(opts?: { tod?: TimeOfDay; mode?: "drive" | "ride" }): void;
  teleport(s: number, kmh?: number): void;
  camera(mode: CamMode): void;
  setCamera(pos: [number, number, number], look: [number, number, number]): void;
  freeCamera(): void;
  snapshot(): string;
  phase(): Phase;
  stats(): Record<string, number>;
}
declare global {
  interface Window {
    __alpine?: DevHooks;
  }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function loadBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}
function saveBest(v: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(v));
  } catch {
    /* storage unavailable */
  }
}

function supportsWebGL2(): boolean {
  try {
    return Boolean(document.createElement("canvas").getContext("webgl2"));
  } catch {
    return false;
  }
}

async function boot(): Promise<void> {
  if (!supportsWebGL2()) {
    $("loading").hidden = true;
    $("fallback").hidden = false;
    return;
  }
  const mobile = window.matchMedia("(pointer: coarse)").matches;
  const canvas = $<HTMLCanvasElement>("c");
  const world = new World(canvas, mobile);
  const loadBar = $("load-bar");
  const loadMsg = $("load-msg");
  const progress = (f: number, msg?: string) => {
    loadBar.style.width = `${Math.round(f * 100)}%`;
    if (msg) loadMsg.textContent = msg;
  };
  // Yield to the page between loading steps (setTimeout, so a background tab
  // still finishes loading).
  const nextFrame = () => new Promise((r) => setTimeout(r, 16));

  let tod: TimeOfDay = "noon";
  let mode: "drive" | "ride" = "drive";
  world.setTimeOfDay(tod);

  progress(0.02, "線路を敷いています…");
  await nextFrame();
  const track = new Track();
  const schedule: Schedule = buildSchedule(track);
  const terrain = new Terrain(track);
  progress(0.05, "谷と山をつくっています…");
  await world.buildTerrain(terrain, (f) => progress(0.05 + f * 0.6));
  progress(0.66, "森を育てています…");
  await world.plantTrees(terrain, (f) => progress(0.66 + f * 0.2));
  world.dispose();
  progress(0.88, "駅と橋を建てています…");
  await nextFrame();
  const scenery: SceneryResult = buildScenery(track, terrain, (i) => track.stations[i].platformTo + 22);
  world.scene.add(scenery.group);
  world.addLake(terrain);
  // Gorge stream under the viaduct.
  {
    const g = terrain.gorge;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 40; i++) {
      const u = i / 40;
      const x = g.ax + (g.bx - g.ax) * u;
      const z = g.az + (g.bz - g.az) * u;
      pts.push(new THREE.Vector3(x, terrain.height(x, z) + 0.35, z));
    }
    const geo = ribbon(pts, 5);
    const stream = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: "#6f98a8", roughness: 0.15, metalness: 0.1, envMapIntensity: 1.2 }));
    world.scene.add(stream);
  }
  const trainModel = new TrainModel();
  world.scene.add(trainModel.group);
  progress(0.96, "機関車を点検しています…");
  await nextFrame();

  const hud = new Hud($("hud"), $("toast"), track, CLOCK0[tod]);
  const sound = new Sound();

  // ------------------------------------------------------------ state
  let phase: Phase = "loading";
  let run: Run | null = null;
  let camMode: CamMode = "cab";
  let frozen = false;
  let resultsTimer = -1;
  let rideCamTimer = 0;
  let boardTimer = 0;
  let lastAt = -1;
  let hornHeld = false;
  const look = { yaw: 0, pitch: 0, idle: 0 };
  const orbit = { yaw: 2.3, pitch: 0.42, dist: 34 };
  const trackside = { s: -1, pos: new THREE.Vector3(), until: 0 };
  const aerial = { pos: new THREE.Vector3(), init: false };
  let freeCam: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
  const camera = world.camera;

  const trainS = () => (run ? run.train.s : track.stations[0].stopS);

  // ------------------------------------------------------------ title UI
  const chips = Array.from(document.querySelectorAll<HTMLButtonElement>(".chip"));
  const syncChips = () => {
    for (const c of chips) {
      const on = c.dataset.tod ? c.dataset.tod === tod : c.dataset.mode === mode;
      c.setAttribute("aria-checked", String(on));
    }
  };
  chips.forEach((c) =>
    c.addEventListener("click", () => {
      if (c.dataset.tod) {
        tod = c.dataset.tod as TimeOfDay;
        world.setTimeOfDay(tod);
      }
      if (c.dataset.mode) mode = c.dataset.mode as "drive" | "ride";
      syncChips();
    }),
  );
  syncChips();
  const showBest = () => {
    const b = loadBest();
    $("best").textContent = b > 0 ? `自己ベスト ${b} 点` : "";
  };
  showBest();

  const setCam = (m: CamMode) => {
    camMode = m;
    trainModel.setCabVisible(m === "cab");
    hud.setCamera(CAM_LABEL[m]);
    trackside.s = -1;
    aerial.init = false;
    look.yaw = 0;
    look.pitch = 0;
  };

  const start = () => {
    run = new Run(track, schedule);
    run.autopilot = mode === "ride";
    hud.clock0 = CLOCK0[tod];
    phase = "playing";
    resultsTimer = -1;
    lastAt = -1;
    boardTimer = 0;
    setCam(mode === "ride" ? "trackside" : "cab");
    rideCamTimer = 0;
    $("title").hidden = true;
    $("results").hidden = true;
    $("pause").hidden = true;
    $("hud").hidden = false;
    sound.start();
    sound.resume();
    for (let i = 0; i < scenery.passengers.length; i++) if (scenery.passengers[i]) scenery.passengers[i].visible = true;
    hud.message({ kind: "info", text: mode === "ride" ? "自動運転で出発します" : "ラグリーナ駅 — 発車準備", sub: `${fmtClock(CLOCK0[tod] + schedule.dep[0])} 発　アルプ・グラッチャー行き` });
  };
  const toTitle = () => {
    phase = "title";
    run = null;
    $("hud").hidden = true;
    $("results").hidden = true;
    $("pause").hidden = true;
    $("title").hidden = false;
    sound.suspend();
    showBest();
    trainModel.setCabVisible(false);
  };
  const pause = (on: boolean) => {
    if (phase !== "playing" && phase !== "paused") return;
    phase = on ? "paused" : "playing";
    $("pause").hidden = !on;
    if (on) sound.suspend();
    else sound.resume();
  };
  $("start").addEventListener("click", start);
  $("again").addEventListener("click", start);
  $("to-title").addEventListener("click", toTitle);
  $("resume").addEventListener("click", () => pause(false));
  $("quit").addEventListener("click", toTitle);

  // ------------------------------------------------------------ input
  const manual = () => {
    if (run && run.autopilot) {
      run.autopilot = false;
      hud.message({ kind: "info", text: "手動運転に切り替えました", sub: "A キー / 自動ボタンで自動運転に戻せます" });
    }
  };
  const nudge = (d: number) => {
    if (!run) return;
    manual();
    const t = run.train;
    let n = t.notch + d;
    if (t.notch === EB_NOTCH && d > 0) n = -7;
    run.setNotch(clamp(n, EB_NOTCH, POWER_NOTCHES));
  };
  const toggleAuto = () => {
    if (!run) return;
    run.autopilot = !run.autopilot;
    hud.message({ kind: "info", text: run.autopilot ? "自動運転 ON" : "自動運転 OFF", sub: run.autopilot ? "車窓をお楽しみください" : "手動で運転します" });
  };
  const nextCam = () => setCam(CAM_ORDER[(CAM_ORDER.indexOf(camMode) + 1) % CAM_ORDER.length]);
  let lastKeyAt = 0;
  window.addEventListener("keydown", (e) => {
    if (phase === "title" && (e.code === "Enter" || e.code === "Space")) {
      if (document.activeElement === document.body || document.activeElement === $("start")) {
        e.preventDefault();
        start();
      }
      return;
    }
    if (phase === "paused" && (e.code === "Escape" || e.code === "KeyP")) {
      pause(false);
      return;
    }
    if (phase !== "playing" || !run) return;
    const now = performance.now();
    switch (e.code) {
      case "ArrowUp":
      case "KeyW":
        e.preventDefault();
        if (e.repeat && now - lastKeyAt < 140) return;
        lastKeyAt = now;
        nudge(1);
        break;
      case "ArrowDown":
      case "KeyS":
        e.preventDefault();
        if (e.repeat && now - lastKeyAt < 140) return;
        lastKeyAt = now;
        nudge(-1);
        break;
      case "KeyN":
        manual();
        run.setNotch(0);
        break;
      case "Space":
      case "Backspace":
        e.preventDefault();
        manual();
        run.setNotch(EB_NOTCH);
        break;
      case "KeyH":
        if (!hornHeld) {
          hornHeld = true;
          sound.horn(true);
        }
        break;
      case "KeyC":
      case "KeyV":
        nextCam();
        break;
      case "Digit1":
      case "Digit2":
      case "Digit3":
      case "Digit4":
        setCam(CAM_ORDER[Number(e.code.slice(5)) - 1]);
        break;
      case "KeyA":
        toggleAuto();
        break;
      case "Escape":
      case "KeyP":
        pause(true);
        break;
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "KeyH") {
      hornHeld = false;
      sound.horn(false);
    }
  });
  hud.onLever = (n) => {
    if (!run) return;
    manual();
    run.setNotch(n);
  };
  hud.onButton = (id) => {
    if (!run) return;
    switch (id) {
      case "eb":
        manual();
        run.setNotch(EB_NOTCH);
        break;
      case "horn":
        sound.horn(true);
        break;
      case "horn:up":
        sound.horn(false);
        break;
      case "cam":
        nextCam();
        break;
      case "auto":
        toggleAuto();
        break;
      case "pause":
        pause(true);
        break;
      case "up":
        nudge(1);
        break;
      case "down":
        nudge(-1);
        break;
    }
  };
  // Drag to look around (cab) or orbit (chase); wheel to zoom.
  let drag: { x: number; y: number } | null = null;
  canvas.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = (e.clientX - drag.x) / window.innerHeight;
    const dy = (e.clientY - drag.y) / window.innerHeight;
    drag = { x: e.clientX, y: e.clientY };
    if (camMode === "chase" || phase === "title") {
      orbit.yaw -= dx * 3;
      orbit.pitch = clamp(orbit.pitch + dy * 2, 0.02, 1.3);
    } else if (camMode === "cab") {
      look.yaw = clamp(look.yaw - dx * 2.2, -1.9, 1.9);
      look.pitch = clamp(look.pitch - dy * 1.6, -0.6, 0.5);
      look.idle = 0;
    }
  });
  const endDrag = () => (drag = null);
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("dblclick", () => {
    look.yaw = 0;
    look.pitch = 0;
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (camMode === "chase") orbit.dist = clamp(orbit.dist * (1 + Math.sign(e.deltaY) * 0.1), 14, 260);
      else if (camMode === "cab" && run) nudge(e.deltaY < 0 ? 1 : -1);
    },
    { passive: false },
  );
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && phase === "playing") pause(true);
  });

  // ------------------------------------------------------------ messages
  const onMessage = (m: RunMessage) => {
    hud.message(m);
    if (m.text.startsWith("ドアが閉まります")) sound.doors();
    if (m.text.startsWith("出発信号")) sound.chime();
    if (m.text.includes("停車") || m.text.startsWith("オーバーラン")) sound.chime();
  };

  // ------------------------------------------------------------ cameras
  const tmpV = new THREE.Vector3();
  const tmpV2 = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const yawQ = new THREE.Quaternion();
  const loco = () => trainModel.cars[0].root;
  const fr = frameAt(track, 0);
  let sway = 0;
  let chaseLift = 0;
  const updateCamera = (dt: number, time: number) => {
    if (freeCam) {
      camera.position.copy(freeCam.pos);
      camera.lookAt(freeCam.look);
      return;
    }
    const L = loco();
    L.updateMatrixWorld(true);
    const s = trainS();
    const v = run ? run.train.v : 0;
    if (phase === "title") {
      // Slow orbit around the waiting train with the lake behind.
      const c = track.pos(track.stations[0].stopS - 40);
      orbit.yaw += dt * 0.035;
      const r = 58;
      camera.position.set(c.x + Math.cos(orbit.yaw) * r, c.y + 9 + orbit.pitch * 20, c.z + Math.sin(orbit.yaw) * r);
      camera.lookAt(c.x, c.y + 3, c.z);
      camera.fov = 55;
      camera.updateProjectionMatrix();
      return;
    }
    if (camMode === "cab") {
      trainModel.eye.getWorldPosition(camera.position);
      // Body motion: sway on curves, a little vertical bounce with speed.
      const lat = v * v * track.curvatureAt(s) - 9.81 * track.cantAt(s);
      sway = lerp(sway, clamp(lat * 0.012, -0.05, 0.05), 1 - Math.exp(-dt * 2));
      const bounce = Math.sin(time * 9.3) * 0.004 * Math.min(1, Math.abs(v) / 15) + Math.sin(time * 3.1) * 0.003 * Math.min(1, Math.abs(v) / 20);
      camera.position.y += bounce;
      L.getWorldQuaternion(tmpQ);
      yawQ.setFromEuler(new THREE.Euler(look.pitch, -Math.PI / 2 + look.yaw, sway * 0.6, "YXZ"));
      camera.quaternion.copy(tmpQ).multiply(yawQ);
      look.idle += dt;
      if (look.idle > 4 && !drag) {
        look.yaw *= Math.exp(-dt * 1.2);
        look.pitch *= Math.exp(-dt * 1.2);
      }
      camera.fov = 64;
    } else if (camMode === "chase") {
      L.getWorldPosition(tmpV);
      const h = track.headingAt(s);
      const a = orbit.yaw - h;
      // Rise over any trees between the camera and the train.
      let pitch = orbit.pitch;
      for (let k = 0; k < 6; k++) {
        const cp = Math.cos(pitch);
        tmpV2.set(tmpV.x + Math.cos(a) * cp * orbit.dist, tmpV.y + 2 + Math.sin(pitch) * orbit.dist, tmpV.z - Math.sin(a) * cp * orbit.dist);
        if (pitch > 1.2 || world.treesNear(tmpV2.x, tmpV2.z, tmpV.x, tmpV.z, 4.5) === 0) break;
        pitch += 0.16;
      }
      chaseLift = lerp(chaseLift, pitch - orbit.pitch, 1 - Math.exp(-dt * 3));
      {
        const pp = orbit.pitch + chaseLift;
        const cp = Math.cos(pp);
        tmpV2.set(tmpV.x + Math.cos(a) * cp * orbit.dist, tmpV.y + 2 + Math.sin(pp) * orbit.dist, tmpV.z - Math.sin(a) * cp * orbit.dist);
      }
      const ground = terrain.height(tmpV2.x, tmpV2.z) + 1.5;
      if (tmpV2.y < ground) tmpV2.y = ground;
      if (tmpV2.y < LAKE_Y + 1) tmpV2.y = LAKE_Y + 1;
      camera.position.copy(tmpV2);
      camera.lookAt(tmpV.x, tmpV.y + 2.2, tmpV.z);
      camera.fov = 50;
    } else if (camMode === "trackside") {
      if (trackside.s < 0 || s > trackside.s + 70 || time > trackside.until) {
        // Try a handful of spots ahead and keep the one with the clearest view
        // (no forest at the camera or between it and the line).
        let best = Infinity;
        for (let k = 0; k < 24; k++) {
          let sc = s + 170 + Math.random() * 260;
          const tn = track.inSpan(track.tunnels, sc, 40);
          if (tn) sc = tn.to + 70 + Math.random() * 60;
          sc = Math.min(sc, track.bufferS - 30);
          frameAt(track, sc, fr);
          const side = Math.random() < 0.6 ? 1 : -1;
          const off = 10 + Math.random() * 34;
          const x = fr.p.x + fr.r.x * off * side;
          const z = fr.p.z + fr.r.z * off * side;
          const h = terrain.height(x, z);
          let y = h + 1.7;
          if (track.inSpan(track.bridges, sc, 30)) y = Math.max(y, fr.p.y - 18);
          y = Math.max(y, LAKE_Y + 1.6, fr.p.y - 30);
          y = Math.min(y, fr.p.y + 25);
          // Line of sight to where the train will be when it fills the frame:
          // count planted trees and hills in the way.
          let score = world.treesNear(x, z, x, z, 8) * 2;
          for (const back of [90, 200]) {
            const tp = track.pos(sc - back);
            score += world.treesNear(x, z, tp.x, tp.z, 4.5);
            for (let u = 0.15; u < 1; u += 0.15) {
              const qx = x + (tp.x - x) * u;
              const qz = z + (tp.z - z) * u;
              const lineY = y + (tp.y + 2.5 - y) * u;
              if (terrain.height(qx, qz) > lineY + 0.5) score += 3;
            }
          }
          score += Math.abs(y - fr.p.y) * 0.01 + (h < LAKE_Y + 1 ? 0.5 : 0);
          if (score < best) {
            best = score;
            trackside.pos.set(x, y, z);
            trackside.s = sc;
          }
        }
        // Deep in the forest every spot is blocked: climb above the canopy.
        if (best >= 1) trackside.pos.y += 24;
        trackside.until = time + 45;
      }
      camera.position.copy(trackside.pos);
      L.getWorldPosition(tmpV);
      tmpV.y += 2;
      camera.lookAt(tmpV);
      const dist = camera.position.distanceTo(tmpV);
      camera.fov = clamp(2 * Math.atan(28 / Math.max(dist, 1)) * (180 / Math.PI), 18, 60);
    } else {
      L.getWorldPosition(tmpV);
      frameAt(track, s, fr);
      tmpV2.copy(tmpV).addScaledVector(fr.f, -95).addScaledVector(fr.r, 80);
      tmpV2.y += 55;
      const ground = terrain.height(tmpV2.x, tmpV2.z) + 25;
      tmpV2.y = Math.max(tmpV2.y, ground);
      if (!aerial.init) {
        aerial.pos.copy(tmpV2);
        aerial.init = true;
      }
      aerial.pos.lerp(tmpV2, 1 - Math.exp(-dt * 0.8));
      camera.position.copy(aerial.pos);
      camera.lookAt(tmpV.x + fr.f.x * 30, tmpV.y, tmpV.z + fr.f.z * 30);
      camera.fov = 50;
    }
    camera.updateProjectionMatrix();
  };

  // ------------------------------------------------------------ loop
  const STEP = 1 / 60;
  let acc = 0;
  let last = performance.now();
  let time = 0;
  const focus = new THREE.Vector3();
  const advance = (dt: number) => {
    time += dt;
    if (phase === "playing" && run) {
      acc += dt;
      while (acc >= STEP) {
        for (const m of run.step(STEP)) onMessage(m);
        acc -= STEP;
      }
      // Ride mode: cycle through the cameras.
      if (mode === "ride" && run.autopilot) {
        rideCamTimer += dt;
        if (rideCamTimer > 26) {
          rideCamTimer = 0;
          const order: CamMode[] = ["trackside", "cab", "aerial", "trackside", "chase"];
          setCam(order[(order.indexOf(camMode) + 1) % order.length]);
        }
      }
      // Passengers board after the doors have been open a few seconds.
      if (run.at !== lastAt) {
        lastAt = run.at;
        boardTimer = 0;
      }
      if (run.phase === "dwell" && run.doorAnim > 0.9) boardTimer += dt;
      scenery.passengers.forEach((p, i) => {
        if (!p) return;
        p.visible = i > run!.at || (i === run!.at && boardTimer < 6 && run!.phase === "dwell");
      });
      for (let i = 0; i < track.stations.length; i++) scenery.signals.set(i, run.signalAt(i));
      if (run.phase === "finished" && resultsTimer < 0) resultsTimer = 5;
      if (resultsTimer > 0) {
        resultsTimer -= dt;
        if (resultsTimer <= 0) showResults();
      }
    }
    trainModel.place(track, trainS(), run ? run.train.odometer : 0);
    updateCamera(dt, time);
    // Tunnel light: where is the camera along the line?
    let camS = trainS();
    if (camMode !== "cab") camS = -1000; // only the cab is actually inside the tunnel
    world.setTunnel(camS < 0 ? 0 : track.tunnelFactor(camS - (camMode === "cab" ? 2 : 0)));
    loco().getWorldPosition(focus);
    world.update(camMode === "cab" ? camera.position : focus);
    world.tick(time, camera.position, terrain.lakeCentre);
    if (run && phase === "playing") {
      hud.frame(run);
      hud.slow(run, time);
      const t = run.train;
      sound.update(
        {
          v: t.v,
          traction: t.traction,
          brake: t.brake,
          curvature: track.curvatureAt(t.s),
          tunnel: track.tunnelFactor(t.s),
          atp: t.atpWarn || t.atpTrip,
          inCab: camMode === "cab",
          odometer: t.odometer,
        },
        dt,
      );
    }
  };
  const ensureSize = (): boolean => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w === 0 || h === 0) return false;
    const c = world.renderer.domElement;
    const pr = world.renderer.getPixelRatio();
    if (c.width !== Math.floor(w * pr) || c.height !== Math.floor(h * pr)) world.resize(w, h);
    return true;
  };
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!frozen) advance(dt);
    if (ensureSize()) world.render();
  };
  world.renderer.setAnimationLoop(frame);

  const showResults = () => {
    if (!run) return;
    phase = "results";
    const r = run;
    const score = r.score;
    const ratio = score / r.maxScore;
    const rank = ratio >= 0.92 ? "S" : ratio >= 0.78 ? "A" : ratio >= 0.6 ? "B" : ratio >= 0.4 ? "C" : "D";
    const best = loadBest();
    if (score > best && !r.autopilot) saveBest(score);
    const rows = r.results
      .map((x) => {
        const err = x.skipped ? "通過" : `${x.stopError >= 0 ? "+" : "−"}${Math.abs(x.stopError).toFixed(1)} m`;
        const late = x.skipped ? "—" : Math.abs(x.lateBy) < 5 ? "定時" : x.lateBy > 0 ? `${Math.round(x.lateBy)} 秒遅れ` : `${Math.round(-x.lateBy)} 秒早着`;
        return `<tr><td>${x.kana}</td><td class="num">${err}</td><td class="num">${late}</td><td class="num">${x.stopPoints + x.timePoints}</td></tr>`;
      })
      .join("");
    const notes: string[] = [];
    if (r.atpWarnings) notes.push(`速度超過 ${r.atpWarnings} 回`);
    if (r.atpTrips) notes.push(`ATP 非常ブレーキ ${r.atpTrips} 回`);
    if (r.ebUses) notes.push(`非常ブレーキ使用 ${r.ebUses} 回`);
    if (r.comfortSeconds > 0.5) notes.push(`急な加減速 ${r.comfortSeconds.toFixed(0)} 秒`);
    notes.push(`使用電力量 ${r.train.energyKWh.toFixed(0)} kWh`);
    $("res-body").innerHTML = `
      <table class="res-table"><thead><tr><th>駅</th><th>停止位置</th><th>時刻</th><th>得点</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="res-total"><span class="score">${score}</span><span>/ ${r.maxScore} 点</span><span class="rank">${rank}</span></div>
      <p class="res-notes">${notes.join("　·　")}${r.penalty > 0 ? `　（減点 ${Math.round(r.penalty)}）` : ""}${r.autopilot ? "<br>自動運転の記録は自己ベストに残りません。" : score > best ? "<br>自己ベストを更新しました！" : ""}</p>`;
    $("results").hidden = false;
    $("hud").hidden = true;
  };

  // ------------------------------------------------------------ dev hooks
  window.__alpine = {
    run: () => run,
    track,
    step(dt: number) {
      advance(dt);
      if (ensureSize()) world.render();
    },
    sim(seconds: number) {
      for (let t = 0; t < seconds; t += 1 / 30) advance(1 / 30);
    },
    freeze(f: boolean) {
      frozen = f;
    },
    start(opts) {
      if (opts?.tod) {
        tod = opts.tod;
        world.setTimeOfDay(tod);
      }
      if (opts?.mode) mode = opts.mode;
      syncChips();
      start();
    },
    teleport(s: number, kmh = 0) {
      if (!run) start();
      const r = run!;
      r.train.s = s;
      r.train.v = kmh / 3.6;
      r.train.notch = kmh > 0 ? 0 : -4;
      r.train.brake = kmh > 0 ? 0 : r.train.brake;
      let at = 0;
      for (let i = 0; i < track.stations.length; i++) if (track.stations[i].stopS < s - 30) at = i;
      r.at = at;
      r.phase = "running";
      r.doorsOpen = false;
      r.doorAnim = 0;
      trackside.s = -1;
      aerial.init = false;
    },
    camera(m: CamMode) {
      setCam(m);
    },
    setCamera(pos, lookAt) {
      freeCam = { pos: new THREE.Vector3(...pos), look: new THREE.Vector3(...lookAt) };
    },
    freeCamera() {
      freeCam = null;
    },
    snapshot() {
      world.render();
      return world.renderer.domElement.toDataURL("image/jpeg", 0.9);
    },
    phase: () => phase,
    stats() {
      const info = world.renderer.info;
      return { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures, trees: world.treeCount };
    },
  };

  progress(1, "準備ができました");
  await nextFrame();
  $("loading").hidden = true;
  $("title").hidden = false;
  phase = "title";
  trainModel.setCabVisible(false);
}

/** A flat water ribbon along a polyline. */
function ribbon(pts: THREE.Vector3[], width: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    const rx = -dz / l;
    const rz = dx / l;
    const w = width * (0.7 + 0.3 * Math.sin(i * 0.9));
    pos.push(pts[i].x + rx * w, pts[i].y, pts[i].z + rz * w, pts[i].x - rx * w, pts[i].y, pts[i].z - rz * w);
    if (i > 0) {
      const k = i * 2;
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

void boot();
