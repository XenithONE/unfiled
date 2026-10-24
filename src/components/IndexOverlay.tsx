import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { X } from "lucide-react";
import { GROUP_LABEL, assetUrl, groupOf } from "../data";
import type { Group } from "../data";
import type { Project } from "../types";

interface Props {
  projects: Project[];
  activeIndex: number | null;
  inline?: boolean;
  onPick: (project: Project) => void;
  onClose: () => void;
}

const GROUPS: Group[] = ["worlds", "games", "tools", "stories"];

/** The filing cabinet: every work as a tile, filterable by group. */
export default function IndexOverlay({ projects, activeIndex, inline = false, onPick, onClose }: Props) {
  const [filter, setFilter] = useState<Group | "all">("all");
  const root = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const visible = useMemo(
    () => projects.filter((p) => filter === "all" || groupOf(p) === filter),
    [projects, filter],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: projects.length };
    for (const p of projects) c[groupOf(p)] = (c[groupOf(p)] ?? 0) + 1;
    return c;
  }, [projects]);

  useEffect(() => {
    if (inline) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [inline]);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const tiles = el.querySelectorAll(".tile");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || inline) {
      gsap.set(tiles, { opacity: 1, y: 0 });
      return;
    }
    const tl = gsap.fromTo(
      tiles,
      { opacity: 0, y: 24, scale: 0.98 },
      { opacity: 1, y: 0, scale: 1, duration: 0.55, ease: "power3.out", stagger: { each: 0.018, grid: "auto", from: "start" } },
    );
    return () => {
      tl.kill();
    };
  }, [visible, inline]);

  const body = (
    <div ref={root} className={`index ${inline ? "is-inline" : ""}`}>
      <header className="index-head">
        <div className="index-title">
          <span className="mono signal">INDEX</span>
          <h2>作品の索引</h2>
          <span className="mono">{String(projects.length).padStart(2, "0")} FILED</span>
        </div>
        <div className="index-filters" role="tablist" aria-label="分類">
          {(["all", ...GROUPS] as const).map((g) => (
            <button
              key={g}
              type="button"
              role="tab"
              aria-selected={filter === g}
              className={filter === g ? "is-on" : ""}
              onClick={() => setFilter(g)}
              data-cursor={g === "all" ? "ALL" : GROUP_LABEL[g].en}
            >
              <span>{g === "all" ? "すべて" : GROUP_LABEL[g].ja}</span>
              <span className="mono">{String(counts[g] ?? 0).padStart(2, "0")}</span>
            </button>
          ))}
        </div>
        {!inline ? (
          <button
            ref={closeRef}
            type="button"
            className="icon-button index-close"
            onClick={onClose}
            aria-label="索引を閉じる（Esc）"
            data-cursor="CLOSE"
          >
            <X size={18} strokeWidth={1.6} />
          </button>
        ) : null}
      </header>
      <ol className="index-grid">
        {visible.map((p) => {
          const i = projects.indexOf(p);
          return (
            <li key={p.id} className={`tile ${i === activeIndex ? "is-active" : ""}`}>
              <button
                type="button"
                onClick={() => onPick(p)}
                data-cursor={inline ? "OPEN" : "GO"}
                style={{ "--accent": p.accent } as React.CSSProperties}
              >
                <span className="tile-img">
                  <img src={assetUrl(p.cover)} alt="" />
                </span>
                <span className="tile-meta mono">
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <span>{GROUP_LABEL[groupOf(p)].en}</span>
                </span>
                <span className="tile-title">{p.title}</span>
                <span className="tile-sub">{p.subtitle}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );

  if (inline) return body;
  return (
    <div className="index-overlay" role="dialog" aria-modal="true" aria-label="作品の索引">
      <button type="button" className="detail-backdrop" aria-label="閉じる" onClick={onClose} tabIndex={-1} />
      {body}
    </div>
  );
}
