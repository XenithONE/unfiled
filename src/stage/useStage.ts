import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Stage, StageStats } from "./Stage";

export type StageStatus =
  | { state: "booting" }
  | { state: "ready"; backend: "webgpu" | "webgl2"; count: number; gpu: string }
  | { state: "unsupported"; reason: string };

declare global {
  interface Window {
    __unfiled?: {
      stage: Stage;
      step: (dt?: number) => void;
      tick?: () => void;
    };
  }
}

interface Ready {
  stage: Stage;
  backend: "webgpu" | "webgl2";
  count: number;
  gpu: string;
}

interface Entry {
  ready: Promise<Ready>;
  refs: number;
  disposeTimer: number | null;
}

/**
 * One stage per canvas. React StrictMode mounts effects twice in development;
 * disposing a WebGL renderer calls `loseContext()` on the canvas, which would
 * kill the context the second mount is about to use. So disposal is deferred
 * and cancelled when the canvas is reclaimed within the same tick.
 *
 * The stage module (three.js WebGPU + TSL, ~200 kB gzipped) is loaded lazily
 * so the page text renders before the field boots.
 */
const registry = new WeakMap<HTMLCanvasElement, Entry>();

function acquire(canvas: HTMLCanvasElement) {
  let entry = registry.get(canvas);
  if (entry) {
    entry.refs++;
    if (entry.disposeTimer !== null) {
      window.clearTimeout(entry.disposeTimer);
      entry.disposeTimer = null;
    }
    return entry;
  }
  const params = new URLSearchParams(window.location.search);
  const forceWebGL = params.get("gl") === "1";
  const tierParam = params.get("tier");
  const tier =
    tierParam === "ultra" ||
    tierParam === "high" ||
    tierParam === "mid" ||
    tierParam === "low"
      ? tierParam
      : undefined;
  const ready = import("./Stage").then(async ({ Stage }) => {
    const stage = new Stage(canvas);
    const info = await stage.init({ forceWebGL, tier });
    return { stage, ...info };
  });
  entry = { ready, refs: 1, disposeTimer: null };
  registry.set(canvas, entry);
  return entry;
}

function release(canvas: HTMLCanvasElement, entry: Entry) {
  entry.refs--;
  if (entry.refs > 0) return;
  entry.disposeTimer = window.setTimeout(() => {
    if (entry.refs > 0) return;
    registry.delete(canvas);
    entry.ready
      .then(({ stage }) => {
        stage.dispose();
        if (window.__unfiled?.stage === stage) delete window.__unfiled;
      })
      .catch(() => undefined);
  }, 200);
}

export function useStage(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  reducedMotion: boolean,
) {
  const stageRef = useRef<Stage | null>(null);
  const [status, setStatus] = useState<StageStatus>({ state: "booting" });
  const [stats, setStats] = useState<StageStats | null>(null);
  const [stage, setStage] = useState<Stage | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const hasWebGL2 = (() => {
      try {
        return Boolean(document.createElement("canvas").getContext("webgl2"));
      } catch {
        return false;
      }
    })();
    if (!("gpu" in navigator) && !hasWebGL2) {
      setStatus({ state: "unsupported", reason: "no-webgl2" });
      return;
    }

    let active = true;
    let mounted: Stage | null = null;
    const entry = acquire(canvas);
    entry.ready
      .then((info) => {
        if (!active) return;
        const instance = info.stage;
        mounted = instance;
        stageRef.current = instance;
        instance.setReducedMotion(reducedMotion);
        instance.onStats(setStats);
        instance.onLost((reason) => {
          setStatus({ state: "unsupported", reason: `device-lost: ${reason}` });
        });
        if (instance.isLost) {
          setStatus({ state: "unsupported", reason: "device-lost" });
          return;
        }
        instance.start();
        window.__unfiled = {
          stage: instance,
          step: (dt = 1 / 60) => instance.step(dt),
        };
        setStage(instance);
        setStatus({
          state: "ready",
          backend: info.backend,
          count: info.count,
          gpu: info.gpu,
        });
      })
      .catch((err: unknown) => {
        console.error("UNFILED: stage failed", err);
        if (active) setStatus({ state: "unsupported", reason: String(err) });
      });

    return () => {
      active = false;
      mounted?.onStats(null);
      mounted?.onLost(null);
      stageRef.current = null;
      release(canvas, entry);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef]);

  useEffect(() => {
    stageRef.current?.setReducedMotion(reducedMotion);
  }, [reducedMotion]);

  return { stage, status, stats };
}
