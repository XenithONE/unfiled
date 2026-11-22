import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { assetUrl, loadProjects } from "./data";
import { HERO_PROGRESS } from "./types";
import type { Project } from "./types";
import gsap from "gsap";
import { useStage } from "./stage/useStage";
import { Soundscape } from "./audio/Soundscape";
import Loader from "./components/Loader";
import Cursor from "./components/Cursor";
import Topbar from "./components/Topbar";
import HeroCopy from "./components/HeroCopy";
import Station from "./components/Station";
import Rail from "./components/Rail";
import DetailOverlay from "./components/DetailOverlay";
import IndexOverlay from "./components/IndexOverlay";
import Ending from "./components/Ending";
import Hud from "./components/Hud";

export type Mode = "hero" | "archive" | "end";

function useReducedMotion() {
  // ?motion=full / ?motion=reduce override the OS setting (useful for
  // checking both renderings in a browser that pins one of them).
  const forced = new URLSearchParams(window.location.search).get("motion");
  const [reduced, setReduced] = useState(() =>
    forced === "full"
      ? false
      : forced === "reduce"
        ? true
        : window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    if (forced === "full" || forced === "reduce") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [forced]);
  return reduced;
}

/**
 * Tall and narrow: the picture is stacked (the work above, its words below).
 * A phone on its side keeps the wide picture, only smaller. The stage frames
 * its shots by the same rule (Stage.view).
 */
const NARROW_QUERY = "(max-width: 899px) and (max-aspect-ratio: 21/20)";

function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return narrow;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Scroll geometry: hero, then one stop per work, then the ending. */
function geometry(vh: number, count: number, narrow: boolean) {
  const heroH = vh;
  const stationH = Math.round(vh * (narrow ? 0.8 : 0.66));
  const railStart = Math.round(heroH * 0.85);
  const railLength = count * stationH;
  const spacer = Math.max(0, railStart + railLength + Math.round(vh * 0.45) - heroH);
  return { heroH, stationH, railStart, railLength, spacer };
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<Mode>("hero");
  const [active, setActive] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [indexOpen, setIndexOpen] = useState(false);
  const [loaderDone, setLoaderDone] = useState(false);
  const [paused, setPaused] = useState(false);
  const [touring, setTouring] = useState(false);
  const [bare, setBare] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [scrollP, setScrollP] = useState(0);
  const [dissolve, setDissolve] = useState(0);
  const [vh, setVh] = useState(() => window.innerHeight);
  const reduced = useReducedMotion();
  const narrow = useNarrow();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { stage, status, stats } = useStage(canvasRef, reduced);
  const soundRef = useRef<Soundscape | null>(null);
  const unsupported = status.state === "unsupported";
  const ready = status.state === "ready";

  /* ------------------------------------------------------------------ */
  /* data                                                                */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    loadProjects(controller.signal)
      .then(setProjects)
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError(err.message);
      });
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    if (!stage || projects.length === 0) return;
    stage.setWorks(
      projects.map((p) => ({ id: p.id, url: assetUrl(p.cover), accent: p.accent })),
    );
  }, [stage, projects]);

  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const count = projects.length;
  const geo = useMemo(() => geometry(vh, count, narrow), [vh, count, narrow]);

  const scrollToStation = useCallback(
    (index: number, instant = false) => {
      const top = geo.railStart + index * geo.stationH;
      window.scrollTo({ top, behavior: instant || reduced ? "auto" : "smooth" });
    },
    [geo, reduced],
  );
  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
  }, [reduced]);
  const scrollToEnd = useCallback(() => {
    const top = geo.railStart + geo.railLength + Math.round(vh * 0.45);
    window.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
  }, [geo, vh, reduced]);

  /* ------------------------------------------------------------------ */
  /* scroll choreography                                                 */
  /* ------------------------------------------------------------------ */
  const modeRef = useRef<Mode>("hero");
  const activeRef = useRef<number | null>(null);
  useEffect(() => {
    if (unsupported) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const y = window.scrollY;
      const doc = document.documentElement;
      const max = Math.max(1, doc.scrollHeight - window.innerHeight);
      setScrollP(Math.min(1, y / max));

      const n = count;
      // the opening shot holds at the top of the page whatever the screen shape
      const p =
        y < geo.railStart
          ? (1 - y / geo.railStart) * HERO_PROGRESS
          : (y - geo.railStart) / geo.stationH;
      let next: Mode = "hero";
      let nextActive: number | null = null;
      if (n > 0 && p >= -0.5 && p < n - 0.5) {
        next = "archive";
        nextActive = Math.max(0, Math.min(n - 1, Math.round(p)));
      } else if (n > 0 && p >= n - 0.5) {
        next = "end";
      }
      setDissolve(smooth(0.04, 0.5, y / (geo.heroH * 0.9)));

      if (stage) {
        // before the works arrive the camera simply holds the opening shot
        stage.setProgress(n > 0 ? p : -9);
        if (next !== modeRef.current) stage.setMode(next);
        if (nextActive !== activeRef.current) {
          stage.setActive(nextActive);
          if (activeRef.current !== null && nextActive !== null)
            soundRef.current?.tick(nextActive);
        }
      }
      if (next !== modeRef.current) {
        modeRef.current = next;
        setMode(next);
      }
      if (nextActive !== activeRef.current) {
        activeRef.current = nextActive;
        setActive(nextActive);
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    // test seam: headless checks cannot wait for a frame
    window.addEventListener("unfiled:sync", update);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("unfiled:sync", update);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [stage, geo, count, vh, unsupported]);

  /* ------------------------------------------------------------------ */
  /* detail / index / hash                                               */
  /* ------------------------------------------------------------------ */
  const activeProject = active !== null ? (projects[active] ?? null) : null;
  const detailProject = useMemo(
    () => projects.find((p) => p.id === detailId) ?? null,
    [projects, detailId],
  );

  const openDetail = useCallback(
    (project: Project) => {
      const index = projects.indexOf(project);
      if (index < 0) return;
      setIndexOpen(false);
      if (index !== activeRef.current) scrollToStation(index, true);
      setDetailId(project.id);
      window.history.replaceState(null, "", `#${project.id}`);
      soundRef.current?.open();
    },
    [projects, scrollToStation],
  );
  const closeDetail = useCallback(() => {
    setDetailId((cur) => {
      if (cur) soundRef.current?.close();
      return null;
    });
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
  }, []);

  useEffect(() => {
    stage?.setDetail(Boolean(detailId));
  }, [stage, detailId, active]);

  // deep link: #id opens that work
  const hashHandled = useRef(false);
  useEffect(() => {
    if (hashHandled.current || projects.length === 0) return;
    hashHandled.current = true;
    const id = window.location.hash.slice(1);
    const project = projects.find((p) => p.id === id);
    if (project) {
      const index = projects.indexOf(project);
      scrollToStation(index, true);
      window.setTimeout(() => setDetailId(project.id), 400);
    }
  }, [projects, scrollToStation]);

  const stepStation = useCallback(
    (delta: number) => {
      if (count === 0) return;
      const current = activeRef.current;
      if (modeRef.current === "hero") {
        if (delta > 0) scrollToStation(0);
        return;
      }
      if (modeRef.current === "end") {
        if (delta < 0) scrollToStation(count - 1);
        return;
      }
      const next = (current ?? 0) + delta;
      if (next < 0) scrollToTop();
      else if (next >= count) scrollToEnd();
      else scrollToStation(next);
    },
    [count, scrollToStation, scrollToTop, scrollToEnd],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === "Escape") {
        if (detailId) closeDetail();
        else if (indexOpen) setIndexOpen(false);
        return;
      }
      if (detailId) {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          const i = projects.findIndex((p) => p.id === detailId);
          if (i >= 0 && i < count - 1) openDetail(projects[i + 1]);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          const i = projects.findIndex((p) => p.id === detailId);
          if (i > 0) openDetail(projects[i - 1]);
        }
        return;
      }
      if (indexOpen) return;
      if (e.key === "i" || e.key === "I") {
        setIndexOpen(true);
      } else if (e.key === "t" || e.key === "T") {
        setTouring((v) => !v);
      } else if (e.key === "h" || e.key === "H") {
        setBare((v) => !v);
      } else if (e.key === "ArrowDown" || e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        stepStation(1);
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        stepStation(-1);
      } else if (e.key === "Enter" && activeProject && modeRef.current === "archive") {
        // a focused control keeps its own Enter
        if (target?.closest("a, button")) return;
        openDetail(activeProject);
      } else if (e.key === "Home") {
        e.preventDefault();
        scrollToTop();
      } else if (e.key === "End") {
        e.preventDefault();
        scrollToEnd();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    detailId,
    indexOpen,
    projects,
    count,
    activeProject,
    openDetail,
    closeDetail,
    stepStation,
    scrollToTop,
    scrollToEnd,
  ]);

  /* ------------------------------------------------------------------ */
  /* pointer: ripples, hover, and walking up to a work by clicking it    */
  /* ------------------------------------------------------------------ */
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const openDetailRef = useRef(openDetail);
  openDetailRef.current = openDetail;
  const scrollToStationRef = useRef(scrollToStation);
  scrollToStationRef.current = scrollToStation;

  useEffect(() => {
    if (!stage) return;
    stage.onHover(setHover);
    const overUi = (target: EventTarget | null) =>
      Boolean((target as HTMLElement | null)?.closest?.("a, button, [role=dialog], .ending-body"));
    let downAt: { x: number; y: number; t: number } | null = null;
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      if (overUi(e.target)) stage.clearPointer();
      else stage.setPointer(e.clientX, e.clientY);
    };
    const leave = () => stage.clearPointer();
    const down = (e: PointerEvent) => {
      downAt = null;
      if (overUi(e.target) || e.button !== 0) return;
      downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
      if (e.pointerType !== "touch") {
        stage.setPointer(e.clientX, e.clientY);
        if (stage.pulse(1) && stage.pick(e.clientX, e.clientY) === null) soundRef.current?.drop();
      }
    };
    const up = (e: PointerEvent) => {
      const start = downAt;
      downAt = null;
      if (!start || overUi(e.target)) return;
      // a tap, not a drag or a scroll
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) return;
      if (performance.now() - start.t > 600) return;
      const index = stage.pick(e.clientX, e.clientY);
      if (index === null) {
        // a finger on the water (the mouse already rippled on the way down)
        if (e.pointerType === "touch") {
          stage.setPointer(e.clientX, e.clientY);
          if (stage.pulse(1)) soundRef.current?.drop();
          stage.clearPointer();
        }
        return;
      }
      const project = projectsRef.current[index];
      if (!project) return;
      if (index === activeRef.current && modeRef.current === "archive") openDetailRef.current(project);
      else scrollToStationRef.current(index);
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", down, { passive: true });
    window.addEventListener("pointerup", up, { passive: true });
    document.documentElement.addEventListener("mouseleave", leave);
    return () => {
      stage.onHover(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      document.documentElement.removeEventListener("mouseleave", leave);
    };
  }, [stage]);

  useEffect(() => {
    stage?.setPaused(paused);
  }, [stage, paused]);

  // The tour: the whole night walked for you. It lets go the moment the
  // visitor takes over (wheel, touch, keys), opens something or reaches dawn.
  useEffect(() => {
    if (!touring) return;
    if (unsupported || count === 0 || detailId || indexOpen || paused) {
      setTouring(false);
      return;
    }
    const perWork = reduced ? 7 : 5.2; // seconds
    let raf = 0;
    let last = performance.now();
    let y = window.scrollY;
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      // the opening shot is left a little faster than the works are passed
      const speed = (y < geo.railStart ? geo.railStart / 3.4 : geo.stationH / perWork) * dt;
      y = Math.min(max, y + speed);
      window.scrollTo(0, y);
      if (y >= max - 1) {
        setTouring(false);
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const stop = () => setTouring(false);
    const onKey = (e: KeyboardEvent) => {
      if (/^(Arrow|Page|Home|End| |Escape)/.test(e.key)) stop();
    };
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchstart", stop, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("keydown", onKey);
    };
  }, [touring, unsupported, count, detailId, indexOpen, paused, reduced, geo]);

  // the opening move starts when the loader lifts
  useEffect(() => {
    if (stage && loaderDone) stage.intro();
  }, [stage, loaderDone]);

  // test seam: headless checks drive GSAP by hand when no frame fires
  useEffect(() => {
    if (!stage || !window.__unfiled) return;
    window.__unfiled.tick = () => {
      gsap.ticker.lagSmoothing(0);
      gsap.ticker.tick();
    };
  }, [stage]);

  useEffect(() => {
    const onVisibility = () => {
      if (!stage) return;
      if (document.hidden) stage.stop();
      else if (!paused) stage.start();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [stage, paused]);

  /* ------------------------------------------------------------------ */
  /* sound                                                               */
  /* ------------------------------------------------------------------ */
  const toggleSound = useCallback(() => {
    if (!soundRef.current) soundRef.current = new Soundscape();
    const on = soundRef.current.toggle();
    setSoundOn(on);
  }, []);
  useEffect(() => {
    // a remembered "on" still needs a gesture before audio may start
    if (!Soundscape.remembered()) return;
    const arm = () => {
      if (!soundRef.current) {
        soundRef.current = new Soundscape();
        void soundRef.current.enable();
        setSoundOn(true);
      }
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
    };
    window.addEventListener("pointerdown", arm);
    window.addEventListener("keydown", arm);
    return () => {
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
    };
  }, []);
  useEffect(() => {
    if (!stage) return;
    const id = window.setInterval(() => {
      const v = Math.min(1, Math.abs(stage.velocity) / 1.6);
      soundRef.current?.setIntensity(v);
      soundRef.current?.setHour(stage.hour);
    }, 100);
    return () => window.clearInterval(id);
  }, [stage]);
  useEffect(() => () => soundRef.current?.dispose(), []);

  /* ------------------------------------------------------------------ */
  /* render                                                              */
  /* ------------------------------------------------------------------ */
  const year = new Date().getFullYear();
  const showStations = !unsupported && count > 0;
  const hoverProject = hover !== null ? (projects[hover] ?? null) : null;
  const canvasLabel =
    hoverProject && !detailId && !indexOpen
      ? hover === active && mode === "archive"
        ? "OPEN"
        : String((hover ?? 0) + 1).padStart(2, "0")
      : "";
  const siteClass = [
    "site",
    unsupported ? "is-static" : "",
    ready ? "is-ready" : "",
    loaderDone ? "is-revealed" : "",
    `mode-${mode}`,
    detailId ? "has-detail" : "",
    indexOpen ? "has-index" : "",
    narrow ? "is-narrow" : "",
    bare ? "is-bare" : "",
    touring ? "is-touring" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={siteClass} style={{ "--dissolve": dissolve } as CSSProperties}>
      <canvas ref={canvasRef} className="stage-canvas" aria-hidden="true" />
      <div
        className="scroll-progress"
        aria-hidden="true"
        style={{ transform: `scaleX(${scrollP})` }}
      />

      <a
        className="skip-link"
        href="#index"
        onClick={(e) => {
          e.preventDefault();
          setIndexOpen(true);
        }}
      >
        作品の索引へ
      </a>

      <Topbar
        year={year}
        onIndex={() => setIndexOpen(true)}
        onAbout={scrollToEnd}
        onHome={() => {
          closeDetail();
          scrollToTop();
        }}
        reduced={reduced}
      />

      <main>
        <HeroCopy
          count={count}
          year={year}
          status={status}
          reduced={reduced}
          revealed={loaderDone}
          onEnter={() => scrollToStation(0)}
        />

        {showStations ? (
          <div className="scroll-space" style={{ height: geo.spacer }} aria-hidden="true" />
        ) : null}

        {unsupported && count > 0 ? (
          <section className="static-index" aria-label="作品一覧">
            <IndexOverlay
              inline
              projects={projects}
              activeIndex={null}
              onPick={(p) => openDetail(p)}
              onClose={() => undefined}
            />
          </section>
        ) : null}

        {error ? (
          <div className="status-message" role="alert">
            <p>{error}</p>
            <button className="text-button" onClick={() => setAttempt((a) => a + 1)}>
              もう一度読み込む
            </button>
          </div>
        ) : null}

        <Ending
          count={count}
          stats={stats}
          status={status}
          onTop={scrollToTop}
          onIndex={() => setIndexOpen(true)}
          year={year}
        />
      </main>

      {showStations ? (
        <>
          <Station
            project={activeProject}
            index={active}
            total={count}
            visible={mode === "archive" && !detailId}
            reduced={reduced}
            narrow={narrow}
            onOpen={openDetail}
          />
          <Rail
            projects={projects}
            active={active}
            mode={mode}
            onPick={(i) => scrollToStation(i)}
          />
        </>
      ) : null}

      <Hud
        status={status}
        stats={stats}
        figureIndex={active !== null ? active + 1 : 0}
        total={count}
        figureTitle={activeProject?.title ?? (mode === "hero" ? "UNFILED" : "—")}
        paused={paused}
        soundOn={soundOn}
        reducedMotion={reduced}
        onTogglePaused={() => setPaused((p) => !p)}
        touring={touring}
        onToggleTour={() => setTouring((v) => !v)}
        onToggleSound={toggleSound}
        onIndex={() => setIndexOpen(true)}
        onTop={scrollToTop}
      />

      <DetailOverlay
        project={detailProject}
        index={detailProject ? projects.indexOf(detailProject) : -1}
        total={count}
        narrow={narrow}
        reduced={reduced}
        onClose={closeDetail}
        onPrev={() => {
          const i = detailProject ? projects.indexOf(detailProject) : -1;
          if (i > 0) openDetail(projects[i - 1]);
        }}
        onNext={() => {
          const i = detailProject ? projects.indexOf(detailProject) : -1;
          if (i >= 0 && i < count - 1) openDetail(projects[i + 1]);
        }}
      />

      {indexOpen ? (
        <IndexOverlay
          projects={projects}
          activeIndex={active}
          onPick={(p) => {
            setIndexOpen(false);
            const i = projects.indexOf(p);
            if (i >= 0) scrollToStation(i);
          }}
          onClose={() => setIndexOpen(false)}
        />
      ) : null}

      <Loader works={count} status={status} reduced={reduced} onDone={() => setLoaderDone(true)} />
      <Cursor label={canvasLabel} caption={hoverProject && canvasLabel ? hoverProject.title : ""} />
    </div>
  );
}
