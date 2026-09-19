import "@fontsource/yomogi/japanese-400.css";
import "@fontsource/yomogi/latin-400.css";
import "./style.css";
import * as THREE from "three";
import { buildCourse, buildTerrainGeometry, type Course } from "./course";
import { Skater, type SimEvent } from "./sim";
import { SkaterRig } from "./skater";
import { buildEnvironment } from "./props";
import { createRenderer } from "./render";
import { Input } from "./input";
import { Sfx } from "./audio";
import { Hud } from "./hud";
import { angleDiff, clamp, damp } from "./util";

type Phase = "title" | "playing" | "finished" | "paused" | "results";
const MILESTONES = [80, 100, 120, 150, 180];

interface DevHooks {
  skater: Skater;
  course: Course;
  step(dt: number): void;
  freeze(frozen: boolean): void;
  snapshot(): string;
  start(): void;
  phase(): Phase;
  teleport(s: number): void;
  setCamera(pos: [number, number, number], look: [number, number, number]): void;
  freeCamera(): void;
}
declare global {
  interface Window {
    __rakugaki?: DevHooks;
  }
}

function supportsWebGL2(): boolean {
  try {
    return Boolean(document.createElement("canvas").getContext("webgl2"));
  } catch {
    return false;
  }
}

function loadNumber(key: string): number {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}
function saveNumber(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* private mode: ignore */
  }
}

function boot(): void {
  const canvas = document.getElementById("c") as HTMLCanvasElement;
  if (!supportsWebGL2()) {
    document.getElementById("fallback")!.hidden = false;
    document.getElementById("title")!.hidden = true;
    return;
  }
  const mobile = window.matchMedia("(pointer: coarse)").matches;
  const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  const r3 = createRenderer(canvas, mobile);
  const { scene, camera } = r3;
  const course = buildCourse();
  const terrain = new THREE.Mesh(buildTerrainGeometry(course, mobile ? 1.1 : 0.75), r3.terrainMaterial());
  terrain.receiveShadow = true;
  scene.add(terrain);
  const env = buildEnvironment(course, r3.toon);
  scene.add(env.group);
  const skater = new Skater();
  skater.resetRun(course);
  const rig = new SkaterRig(r3.toon);
  scene.add(rig.root);

  const hud = new Hud();
  const input = new Input(document.getElementById("touch")!);
  input.attach();
  const sfx = new Sfx();
  sfx.setMuted(loadNumber("rakugaki:muted") === 1);
  hud.setMuted(sfx.muted);
  hud.setTouchVisible(mobile);

  let phase: Phase = "title";
  let runTime = 0;
  let finishTimer = 0;
  let bestScore = loadNumber("rakugaki:best:score");
  let bestTime = loadNumber("rakugaki:best:time");
  let shake = 0;
  let fovPunch = 0;
  let landDip = 0;
  let cameraLocked = false;
  let elapsed = 0;
  let milestone = 0;
  hud.setBest(bestScore, bestTime);
  hud.setScore(0);
  hud.setTime(0);
  hud.setDistance(course.finishS - course.startS);
  hud.setSpeed(0);
  hud.showTitle();
  const reduced = () => reducedQuery.matches;
  r3.setMotion(!reduced());
  reducedQuery.addEventListener("change", () => r3.setMotion(!reduced()));
  const tunnel = course.landmarks.find((l) => l.kind === "tunnel");
  const stickerKey = "rakugaki:stickers";
  const loadStickers = (): Set<number> => {
    try {
      return new Set<number>(JSON.parse(localStorage.getItem(stickerKey) ?? "[]") as number[]);
    } catch {
      return new Set<number>();
    }
  };
  const foundStickers = loadStickers();
  hud.setStickers(foundStickers.size, course.stickers.length);
  env.setStickers(foundStickers);

  // ---- camera ----
  let camYaw = skater.yaw;
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();
  const resetCamera = () => {
    camYaw = skater.yaw;
    camPos.set(skater.pos.x - Math.sin(camYaw) * 6, skater.pos.y + 2.6, skater.pos.z - Math.cos(camYaw) * 6);
    camLook.copy(skater.pos);
  };
  resetCamera();

  const updateCamera = (dt: number): void => {
    if (cameraLocked) return;
    const hs = skater.horizontalSpeed;
    const speed = skater.speed;
    let fov = 50;
    let roll = 0;
    if (phase === "title") {
      camYaw += dt * 0.1;
      desired.set(skater.pos.x - Math.sin(camYaw) * 10, skater.pos.y + 3.6, skater.pos.z - Math.cos(camYaw) * 10);
      lookTarget.set(skater.pos.x, skater.pos.y + 1.0, skater.pos.z);
    } else {
      const target = hs > 1.5 ? Math.atan2(skater.vel.x, skater.vel.z) : skater.yaw;
      camYaw += angleDiff(camYaw, target) * (1 - Math.exp(-3.5 * dt));
      const dist = 4.8 + speed * 0.09;
      const height = 1.7 + speed * 0.01 + (skater.inAir ? 0.4 : 0);
      const ahead = 2.5 + speed * 0.08;
      desired.set(skater.pos.x - Math.sin(camYaw) * dist, skater.pos.y + height, skater.pos.z - Math.cos(camYaw) * dist);
      lookTarget.set(skater.pos.x + Math.sin(camYaw) * ahead, skater.pos.y + 0.9, skater.pos.z + Math.cos(camYaw) * ahead);
      const range = reduced() ? 16 : 32;
      fov = 56 + range * clamp((speed - 6) / 34, 0, 1) + (reduced() ? 0 : fovPunch);
      roll = reduced() ? 0 : -skater.steer * 0.06 * clamp(hs / 15, 0, 1);
    }
    camPos.x = damp(camPos.x, desired.x, 7, dt);
    camPos.z = damp(camPos.z, desired.z, 7, dt);
    camPos.y = damp(camPos.y, desired.y, 5, dt);
    const floor = course.height(camPos.x, camPos.z) + 0.8;
    if (camPos.y < floor) camPos.y = floor;
    if (tunnel && Math.abs(skater.sample.s - tunnel.s) < 20 && skater.sample.d < 8) {
      const roofY = tunnel.y + 4.6;
      if (camPos.y > roofY) camPos.y = roofY;
    }
    camLook.x = damp(camLook.x, lookTarget.x, 10, dt);
    camLook.y = damp(camLook.y, lookTarget.y, 7, dt);
    camLook.z = damp(camLook.z, lookTarget.z, 10, dt);
    camera.position.copy(camPos);
    camera.position.y -= 0.35 * landDip;
    if (shake > 0) {
      camera.position.x += (Math.random() - 0.5) * 0.25 * shake;
      camera.position.y += (Math.random() - 0.5) * 0.25 * shake;
      shake = Math.max(0, shake - dt * 1.6);
    }
    camera.lookAt(camLook);
    camera.rotateZ(roll);
    camera.fov = damp(camera.fov, fov, 4, dt);
    camera.updateProjectionMatrix();
    fovPunch = Math.max(0, fovPunch - dt * 12);
    landDip = Math.max(0, landDip - dt * 4);
  };

  // ---- game flow ----
  const startGame = (): void => {
    sfx.unlock();
    skater.resetRun(course);
    skater.stickers.clear();
    runTime = 0;
    finishTimer = 0;
    milestone = 0;
    phase = "playing";
    input.flush();
    input.enabled = true;
    hud.hideTitle();
    hud.hideResults();
    hud.hidePause();
    hud.setScore(0);
    hud.setTime(0);
    hud.showMessage("山頂から、ゴールまで。", "GO!", 1.6);
    resetCamera();
  };
  const finishRun = (): void => {
    phase = "finished";
    finishTimer = 2.2;
    input.enabled = false;
    hud.showMessage("ゴール！", "", 2.2);
    sfx.play("bigbank");
  };
  const showResults = (): void => {
    phase = "results";
    const recordScore = skater.score > bestScore;
    const recordTime = bestTime === 0 || runTime < bestTime;
    if (recordScore) {
      bestScore = skater.score;
      saveNumber("rakugaki:best:score", bestScore);
    }
    if (recordTime) {
      bestTime = runTime;
      saveNumber("rakugaki:best:time", Math.round(runTime * 10) / 10);
    }
    hud.setBest(bestScore, bestTime);
    hud.showResults({ score: skater.score, time: runTime, bestScore, bestTime, recordScore, recordTime });
  };
  const pauseGame = (): void => {
    if (phase !== "playing") return;
    phase = "paused";
    input.enabled = false;
    hud.showPause();
  };
  const resumeGame = (): void => {
    if (phase !== "paused") return;
    phase = "playing";
    input.flush();
    input.enabled = true;
    hud.hidePause();
  };
  const quitToTitle = (): void => {
    phase = "title";
    input.enabled = false;
    skater.resetRun(course);
    hud.setScore(0);
    hud.setTime(0);
    hud.setBalance(null);
    hud.showTitle();
    resetCamera();
  };

  hud.onStart = startGame;
  hud.onResume = resumeGame;
  hud.onQuit = quitToTitle;
  hud.onRetry = startGame;
  hud.onMute = () => {
    sfx.unlock();
    sfx.setMuted(!sfx.muted);
    hud.setMuted(sfx.muted);
    saveNumber("rakugaki:muted", sfx.muted ? 1 : 0);
  };
  input.onMenuKey = (code) => {
    if (code === "KeyM") {
      hud.onMute?.();
      return;
    }
    if (phase === "title" && code === "Enter") startGame();
    else if (phase === "results" && code === "Enter") startGame();
    else if (phase === "playing" && (code === "Escape" || code === "KeyP")) pauseGame();
    else if (phase === "paused" && (code === "Escape" || code === "KeyP" || code === "Enter")) resumeGame();
  };
  input.enabled = false;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pauseGame();
  });

  // ---- resize ----
  const resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w < 2 || h < 2) return;
    r3.setSize(w, h);
  };
  window.addEventListener("resize", resize);
  resize();

  // ---- frame ----
  const events: SimEvent[] = [];
  const handleEvents = (): void => {
    for (const e of events) {
      switch (e.type) {
        case "trick":
          hud.popup(`${e.name} +${e.points}`);
          break;
        case "land":
          hud.popup(`+${e.total.toLocaleString("en-US")}`, "bank");
          landDip = 1;
          break;
        case "bail":
          hud.popup("BAIL!", "bail");
          shake = 1;
          break;
        case "bump":
          hud.popup("BONK", "sketchy");
          shake = Math.max(shake, 0.6);
          break;
        case "sketchy":
          hud.popup("SKETCHY", "sketchy");
          shake = Math.max(shake, 0.4);
          break;
        case "boost":
          hud.popup(e.label, "boost");
          fovPunch = 10;
          break;
        case "trap":
          hud.popup(`SPEED TRAP ${Math.round(e.kmh)} km/h!`, "boost");
          if (e.kmh > loadNumber("rakugaki:best:trap")) saveNumber("rakugaki:best:trap", Math.round(e.kmh));
          break;
        case "sticker":
          foundStickers.add(e.id);
          try {
            localStorage.setItem(stickerKey, JSON.stringify([...foundStickers]));
          } catch {
            /* ignore */
          }
          hud.setStickers(foundStickers.size, course.stickers.length);
          hud.showMessage(`ステッカー：${e.label}`, `${foundStickers.size} / ${course.stickers.length}`, 1.4);
          env.setStickers(foundStickers);
          break;
        case "respawn":
          hud.showMessage("道に戻った", "", 0.9);
          resetCamera();
          break;
        case "sound":
          sfx.play(e.name);
          break;
      }
    }
    events.length = 0;
  };

  const tick = (dt: number): void => {
    elapsed += dt;
    const active = phase === "playing" || phase === "finished";
    if (active) {
      const inp = input.poll();
      skater.step(dt, inp, course, events);
      handleEvents();
      if (phase === "playing") {
        runTime += dt;
        if (skater.sample.s >= course.finishS && skater.sample.d < 8) {
          skater.finish(events);
          handleEvents();
          finishRun();
        }
        const kmh = skater.kmh;
        if (milestone < MILESTONES.length && kmh >= MILESTONES[milestone]) {
          hud.popup(`${MILESTONES[milestone]} km/h!`, "boost");
          milestone += 1;
        }
      } else {
        finishTimer -= dt;
        if (finishTimer <= 0) showResults();
      }
      hud.setTime(runTime);
      hud.setDistance(course.finishS - skater.progress);
      hud.setScore(skater.score);
      hud.setSpeed(skater.kmh);
      hud.setCombo(skater.combo, skater.comboScore, skater.comboCount);
      hud.setBalance(skater.rail && skater.rail.kind !== "wire" ? skater.balance : null);
      if (skater.speed > 32) shake = Math.max(shake, clamp((skater.speed - 32) / 18, 0, 1) * 0.35);
    } else {
      input.poll();
    }
    hud.tick(dt);
    rig.update(skater, dt, elapsed);
    env.update(dt, elapsed, skater.sample.s, phase === "finished" || phase === "results");
    updateCamera(dt);
    r3.updateShadowTarget(skater.pos);
    const speedFactor = active ? clamp((skater.speed - 12) / 24, 0, 1) : 0;
    sfx.update(skater.speed, active && skater.grounded && skater.bail <= 0, active && skater.rail !== null);
    r3.render(elapsed, speedFactor);
  };

  let last = performance.now();
  let frozen = false;
  const loop = (now: number): void => {
    const dt = Math.min(0.05, Math.max(0.0005, (now - last) / 1000));
    last = now;
    if (!frozen && canvas.width > 1 && canvas.height > 1) tick(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  window.__rakugaki = {
    skater,
    course,
    step: (dt) => tick(dt),
    freeze: (f) => {
      frozen = f;
    },
    snapshot: () => {
      r3.render(elapsed, 0);
      return canvas.toDataURL("image/png");
    },
    start: startGame,
    phase: () => phase,
    teleport: (s) => {
      skater.respawn(course, s);
      resetCamera();
    },
    setCamera: (pos, look) => {
      cameraLocked = true;
      camera.position.set(pos[0], pos[1], pos[2]);
      camera.lookAt(look[0], look[1], look[2]);
    },
    freeCamera: () => {
      cameraLocked = false;
    },
  };
}

boot();
