import { useEffect, useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import { assetUrl } from "../data";
import type { Project } from "../types";

interface Props {
  projects: Project[];
  activeId: string | null;
  /** Static mode (no particle stage): show covers inline. */
  showCovers: boolean;
  onHover: (id: string | null) => void;
  onCentered: (id: string | null) => void;
  onOpen: (project: Project) => void;
}

export default function WorksIndex({
  projects,
  activeId,
  showCovers,
  onHover,
  onCentered,
  onOpen,
}: Props) {
  const listRef = useRef<HTMLOListElement>(null);

  // The row nearest the viewport's centre drives the field while scrolling
  // (and is the only driver on touch devices).
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    let raf = 0;
    let last: string | null = null;
    const measure = () => {
      raf = 0;
      const vh = window.innerHeight;
      const centerLine = vh * 0.5;
      const rect = list.getBoundingClientRect();
      if (rect.bottom < vh * 0.25 || rect.top > vh * 0.75) {
        if (last !== null) {
          last = null;
          onCentered(null);
        }
        return;
      }
      let best: string | null = null;
      let bestDist = Infinity;
      for (const row of Array.from(list.children) as HTMLElement[]) {
        const r = row.getBoundingClientRect();
        const d = Math.abs((r.top + r.bottom) / 2 - centerLine);
        if (d < bestDist) {
          bestDist = d;
          best = row.dataset.id ?? null;
        }
      }
      if (best !== last) {
        last = best;
        onCentered(best);
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("unfiled:sync", measure);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("unfiled:sync", measure);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [onCentered, projects]);

  return (
    <ol
      ref={listRef}
      className={`works-list ${showCovers ? "with-covers" : ""}`}
      onPointerLeave={() => onHover(null)}
    >
      {projects.map((project, index) => {
        const active = project.id === activeId;
        return (
          <li
            key={project.id}
            data-id={project.id}
            className={`work-row ${active ? "is-active" : ""}`}
            style={{ "--accent": project.accent } as React.CSSProperties}
          >
            <button
              type="button"
              className="work-button"
              onPointerEnter={(e) => {
                if (e.pointerType !== "touch") onHover(project.id);
              }}
              onFocus={() => onHover(project.id)}
              onBlur={() => onHover(null)}
              onClick={() => onOpen(project)}
              aria-label={`${project.title} — ${project.subtitle}（詳細をひらく）`}
            >
              <span className="work-number mono">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="work-name">
                <span className="work-title">{project.title}</span>
                <span className="work-subtitle">{project.subtitle}</span>
              </span>
              <span className="work-meta mono">
                <span className="work-category">{project.category}</span>
                <span className="work-year">{project.year}</span>
              </span>
              <span className="work-thumb" aria-hidden="true">
                <img
                  src={assetUrl(project.cover)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              </span>
              <span className="work-arrow" aria-hidden="true">
                <ArrowUpRight size={20} strokeWidth={1.5} />
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
