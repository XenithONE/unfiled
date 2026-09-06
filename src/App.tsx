import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { ArrowUpRight, Github } from "lucide-react";
import { loadProjects } from "./data";
import type { Project, View } from "./types";
import ProjectField from "./components/ProjectField";
import ProjectIndex from "./components/ProjectIndex";
import ViewControls from "./components/ViewControls";
import InfoDialog from "./components/InfoDialog";

function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<View>("space");
  const [selected, setSelected] = useState<Project | null>(null);
  const [about, setAbout] = useState(false);
  const [arrangement, setArrangement] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = useReducedMotion();

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
      if (id === "about") {
        setAbout(true);
        setSelected(null);
      } else {
        setAbout(false);
        setSelected(projects.find((project) => project.id === id) || null);
      }
    }
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, [projects]);

  function openProject(project: Project) {
    setSelected(project);
    setAbout(false);
    window.history.replaceState(null, "", `#${project.id}`);
  }
  function openAbout() {
    setSelected(null);
    setAbout(true);
    window.history.replaceState(null, "", "#about");
  }
  function closeDialog() {
    setSelected(null);
    setAbout(false);
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
  }

  return (
    <div className={`site-shell ${paused || reduced ? "motion-paused" : ""}`}>
      <a className="skip-link" href="#works">
        作品へスキップ
      </a>
      <header className="site-header">
        <a
          className="wordmark"
          href="#"
          aria-label="UNFILED ホーム"
          onClick={() => {
            setView("space");
            setArrangement(0);
            closeDialog();
          }}
        >
          UNFILED.
        </a>
        <p className="header-thought">つくる。ためす。また、つくる。</p>
        <nav aria-label="メインナビゲーション">
          <button
            onClick={() => {
              setView("index");
              closeDialog();
            }}
          >
            作品
          </button>
          <button onClick={openAbout}>この場所について</button>
          <a
            className="github-link"
            href="https://github.com/XenithONE"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="XenithONEのGitHub（新しいタブ）"
          >
            <Github size={24} strokeWidth={1.8} />
            <ArrowUpRight size={23} strokeWidth={1.5} />
          </a>
        </nav>
      </header>
      <main
        className={`exhibition ${view === "index" ? "is-index" : ""}`}
        id="works"
        tabIndex={-1}
        style={
          {
            "--extra-rows": Math.ceil(Math.max(0, projects.length - 3) / 3),
            "--extra-count": Math.max(0, projects.length - 3),
          } as CSSProperties
        }
      >
        <div className="exhibition-intro">
          <h1>UNFILED</h1>
          <span className="asterisk" aria-hidden="true">
            <svg viewBox="0 0 100 100">
              <path d="M50 5v90M11 27l78 46M11 73l78-46" />
            </svg>
          </span>
          <div className="intro-copy">
            <p>好奇心の、散らばるままに。</p>
            <p>AIとつくった、まだ分類できないものたち。</p>
          </div>
        </div>
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
              <ArrowUpRight size={20} />
            </button>
          </div>
        ) : projects.length === 0 ? (
          <div className="status-message">
            <p>次の好奇心を、ここに。</p>
          </div>
        ) : view === "space" ? (
          <ProjectField
            projects={projects}
            arrangement={arrangement}
            paused={paused || reduced || Boolean(selected) || about}
            onOpen={openProject}
          />
        ) : (
          <ProjectIndex projects={projects} onOpen={openProject} />
        )}
      </main>
      <ViewControls
        view={view}
        setView={setView}
        paused={paused || reduced}
        setPaused={setPaused}
        shuffle={() => setArrangement((a) => a + 1)}
        count={projects.length}
        reducedMotion={reduced}
      />
      <footer className="site-footer">
        <span>XenithONE © {new Date().getFullYear()}</span>
        <span>好奇心に、完成はない。</span>
      </footer>
      <InfoDialog project={selected} about={about} onClose={closeDialog} />
    </div>
  );
}
