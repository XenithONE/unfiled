import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Github } from "lucide-react";
import { assetUrl, loadProjects } from "./data";
import type { Project } from "./types";
import { useStage } from "./stage/useStage";
import WorksIndex from "./components/WorksIndex";
import Hud from "./components/Hud";
import InfoDialog from "./components/InfoDialog";

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

type Section = "hero" | "works" | "about";

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<Project | null>(null);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [centered, setCentered] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("hero");
  const [scrollP, setScrollP] = useState(0);
  const reduced = useReducedMotion();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const heroRef = useRef<HTMLElement | null>(null);
  const worksRef = useRef<HTMLElement | null>(null);
  const aboutRef = useRef<HTMLElement | null>(null);
  const { stage, status, stats } = useStage(canvasRef, reduced);

  /* ------------------------------------------------------------------ */
  /* data                                                                */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    loadProjects(controller.signal)
      .then(setProjects)
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    function syncHash() {
      const id = window.location.hash.slice(1);
      if (!id || id === "works" || id === "about" || id === "top") {
        setSelected(null);
        return;
      }
      setSelected(projects.find((project) => project.id === id) || null);
    }
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, [projects]);

  const openProject = useCallback((project: Project) => {
    setSelected(project);
    window.history.replaceState(null, "", `#${project.id}`);
  }, []);
  const closeDialog = useCallback(() => {
    setSelected(null);
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
  }, []);

  /* ------------------------------------------------------------------ */
  /* text targets (wordmark, tagline)                                    */
  /* ------------------------------------------------------------------ */
  const narrow = useNarrow();
  const showText = useCallback(
    (which: "wordmark" | "tagline") => {
      if (!stage) return;
      if (which === "wordmark") {
        void stage.showText(
          "wordmark",
          "UNFILED",
          {
            font: "400 420px Anton, Impact, sans-serif",
            width: 2048,
            height: 560,
            stretch: 1.28,
            letterSpacing: "-0.02em",
            fill: ["#fff6e8", "#ff9a6a"],
          },
          "hero",
          { thickness: 0.5, relief: 0.05, gain: 1.3 },
        );
        return;
      }
      void stage.showText(
        "tagline",
        "好奇心に、完成はない。",
        {
          font: '600 220px "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, "Noto Sans JP", sans-serif',
          width: 2048,
          height: 384,
          fill: ["#eef0ff", "#f3efe6"],
        },
        narrow ? "center" : "side",
        { thickness: 0.3, relief: 0.03, lumHigh: 0.45, gain: 1.2 },
      );
    },
    [stage, narrow],
  );

  /* ------------------------------------------------------------------ */
  /* scroll choreography                                                 */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const y = window.scrollY;
      const vh = window.innerHeight || 1;
      const doc = document.documentElement;
      const max = Math.max(1, doc.scrollHeight - vh);
      setScrollP(Math.min(1, y / max));
      stage?.setScroll(y);

      const worksTop = worksRef.current?.getBoundingClientRect().top ?? 1e9;
      const aboutTop = aboutRef.current?.getBoundingClientRect().top ?? 1e9;
      let next: Section = "hero";
      if (aboutTop < vh * 0.55) next = "about";
      else if (worksTop < vh * 0.3) next = "works";
      setSection(next);

      if (stage) {
        if (next === "hero") {
          // The wordmark rides up with the page and dissolves to dust before
          // the works index takes over.
          const p = y / (vh * 0.9);
          stage.setFormedScale(1 - smooth(0.04, 0.62, p));
          stage.setOffset(0, (y / vh) * stage.visibleHeight * 0.6, 0);
        } else {
          stage.setFormedScale(1);
          stage.setOffset(0, 0, 0);
        }
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    // Test seam: headless checks cannot wait for a frame, so they dispatch
    // this event to sync the choreography with the current scroll position.
    window.addEventListener("unfiled:sync", update);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("unfiled:sync", update);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [stage]);

  /* ------------------------------------------------------------------ */
  /* which target should the field hold?                                 */
  /* ------------------------------------------------------------------ */
  const activeId = selected?.id ?? hovered ?? centered;
  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeId) ?? null,
    [projects, activeId],
  );

  useEffect(() => {
    if (!stage) return;
    if (section === "hero" || section === "about") {
      showText(section === "hero" ? "wordmark" : "tagline");
      return;
    }
    if (!activeProject) {
      stage.scatter();
      return;
    }
    void stage.showCover(
      activeProject.id,
      assetUrl(activeProject.cover),
      activeProject.accent,
      narrow ? "center" : "side",
    );
  }, [stage, section, activeProject, narrow, showText]);

  // Warm the cache for the first few covers once the page is idle.
  useEffect(() => {
    if (!stage || projects.length === 0) return;
    const idle =
      (window as { requestIdleCallback?: (cb: () => void) => number })
        .requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1200));
    idle(() => {
      projects.slice(0, 6).forEach((p) => {
        stage.prefetchCover(assetUrl(p.cover));
      });
    });
  }, [stage, projects]);

  /* ------------------------------------------------------------------ */
  /* pointer                                                             */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (!stage) return;
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      stage.setPointer(e.clientX, e.clientY);
    };
    const touch = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) stage.setPointer(t.clientX, t.clientY);
    };
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement | null)?.closest("a, button, dialog")) return;
      stage.setPointer(e.clientX, e.clientY);
      stage.pulse(0.9);
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("touchmove", touch, { passive: true });
    window.addEventListener("pointerdown", down, { passive: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("touchmove", touch);
      window.removeEventListener("pointerdown", down);
    };
  }, [stage]);

  useEffect(() => {
    stage?.setPaused(paused);
  }, [stage, paused]);

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
  /* render                                                              */
  /* ------------------------------------------------------------------ */
  const figureIndex = activeProject ? projects.indexOf(activeProject) + 1 : 0;
  const unsupported = status.state === "unsupported";
  const year = new Date().getFullYear();

  return (
    <div
      className={`site ${unsupported ? "is-static" : ""} ${
        status.state === "ready" ? "is-ready" : ""
      } section-${section}`}
    >
      <canvas ref={canvasRef} className="stage-canvas" aria-hidden="true" />
      <div className="stage-grid" aria-hidden="true" />
      <div
        className="scroll-progress"
        aria-hidden="true"
        style={{ transform: `scaleX(${scrollP})` }}
      />
      <span className="corner corner-tl" aria-hidden="true" />
      <span className="corner corner-tr" aria-hidden="true" />
      <span className="corner corner-bl" aria-hidden="true" />
      <span className="corner corner-br" aria-hidden="true" />

      <a className="skip-link" href="#works">
        作品へスキップ
      </a>

      <header className="topbar">
        <a
          className="wordmark"
          href="#top"
          aria-label="UNFILED ホーム"
          onClick={(e) => {
            e.preventDefault();
            closeDialog();
            window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
          }}
        >
          UNFILED<span className="wordmark-dot">.</span>
        </a>
        <p className="topbar-thought">
          <span className="mono">WORK IN PROGRESS</span>
          <span className="sep">—</span>
          つくる。ためす。また、つくる。
        </p>
        <nav aria-label="メインナビゲーション">
          <a href="#works">作品</a>
          <a href="#about">この場所について</a>
          <a
            className="github-link"
            href="https://github.com/XenithONE"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="XenithONEのGitHub（新しいタブ）"
          >
            <Github size={20} strokeWidth={1.7} />
            <ArrowUpRight size={18} strokeWidth={1.5} />
          </a>
        </nav>
      </header>

      <main id="top">
        <section className="hero" ref={heroRef} aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow mono">
              <span>FIELD NOTES</span>
              <span className="dot" aria-hidden="true">
                ●
              </span>
              <span>VOL. {year}</span>
              {projects.length > 0 && (
                <>
                  <span className="dot" aria-hidden="true">
                    ●
                  </span>
                  <span>{String(projects.length).padStart(2, "0")} WORKS</span>
                </>
              )}
            </p>
            <h1 id="hero-title" className={unsupported ? "hero-title" : "sr-only"}>
              UNFILED
            </h1>
            <p className="lede">好奇心の、散らばるままに。</p>
            <p className="sub">AIとつくった、まだ分類できないものたち。</p>
            <p className="hint mono">
              {unsupported
                ? "この環境では粒子を描けません。作品一覧はそのまま使えます。"
                : status.state === "ready"
                  ? reduced
                    ? "動きを抑えた表示です。触れると粒子がゆっくり逃げ、下へ進むとほどけます。"
                    : "触れると、粒子が逃げる。下へ進むと、ほどける。"
                  : "粒子を組み立てています…"}
            </p>
          </div>
          <div className="hero-stamp" aria-hidden="true">
            <span>WIP</span>
            <small>UNFILED / {year}</small>
          </div>
          <a className="scroll-cue mono" href="#works" aria-label="作品へ">
            <span>SCROLL</span>
            <i aria-hidden="true" />
          </a>
        </section>

        <section className="works" id="works" ref={worksRef} tabIndex={-1}>
          <header className="section-head">
            <span className="mono">01</span>
            <h2>作品</h2>
            <span className="mono">
              INDEX / {String(projects.length).padStart(2, "0")}
            </span>
          </header>
          {loading ? (
            <div className="status-message" role="status">
              <span className="loading-mark">＊</span>
              <p>作品をひらいています。</p>
            </div>
          ) : error ? (
            <div className="status-message" role="alert">
              <p>{error}</p>
              <button
                className="text-button"
                onClick={() => setAttempt((a) => a + 1)}
              >
                もう一度読み込む
                <ArrowUpRight size={18} />
              </button>
            </div>
          ) : projects.length === 0 ? (
            <div className="status-message">
              <p>次の好奇心を、ここに。</p>
            </div>
          ) : (
            <WorksIndex
              projects={projects}
              activeId={activeId}
              showCovers={unsupported}
              onHover={setHovered}
              onCentered={setCentered}
              onOpen={openProject}
            />
          )}
          <p className="works-note mono">
            {unsupported
              ? ""
              : narrow
                ? "画面の中央にある作品を、粒子が組み立てます。"
                : "作品名に触れると、粒子がその表紙を組み立てます。"}
          </p>
        </section>

        <section className="about" id="about" ref={aboutRef} tabIndex={-1}>
          <header className="section-head">
            <span className="mono">02</span>
            <h2>この場所について</h2>
            <span className="mono">ABOUT</span>
          </header>
          <div className="about-body">
            <p className="about-lead">
              つくる。ためす。
              <br />
              また、つくる。
            </p>
            <div className="about-copy">
              <p>
                つくりたいものは、そのときの好奇心で変わる。
                <br />
                宇宙へ行ったり、時間を旅したり、ただ海を眺めたり。
              </p>
              <p>
                AIといっしょに、思いつきをかたちにする。
                <br />
                つくること自体が楽しくて、テーマも、目的も、まだばらばら。
              </p>
              <p>
                ここは、そんな制作物が集まる場所。
                <br />
                分類するより先に、まずは並べてみました。
              </p>
              <p className="about-tech mono">
                THIS PAGE: three.js WebGPURenderer + TSL compute · {" "}
                {stats ? stats.count.toLocaleString() : "—"} particles ·{" "}
                {status.state === "ready"
                  ? status.backend === "webgpu"
                    ? "WebGPU"
                    : "WebGL2 fallback"
                  : "—"}
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <span>XenithONE © {year}</span>
        <span className="mono">好奇心に、完成はない。</span>
        <a
          href="https://github.com/XenithONE/unfiled"
          target="_blank"
          rel="noopener noreferrer"
        >
          SOURCE
          <ArrowUpRight size={14} strokeWidth={1.5} aria-hidden="true" />
        </a>
      </footer>

      <Hud
        status={status}
        stats={stats}
        figureIndex={figureIndex}
        total={projects.length}
        figureTitle={activeProject?.title ?? (section === "hero" ? "UNFILED" : "—")}
        paused={paused}
        reducedMotion={reduced}
        onTogglePaused={() => setPaused((p) => !p)}
        onScatter={() => {
          if (!stage) return;
          stage.pulse(1.4);
        }}
      />

      <InfoDialog project={selected} onClose={closeDialog} />
    </div>
  );
}

function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.innerWidth < 900);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 899px)");
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return narrow;
}
