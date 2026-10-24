import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ArrowLeft, ArrowRight, ArrowUpRight, X } from "lucide-react";
import { assetUrl } from "../data";
import type { Project } from "../types";

interface Props {
  project: Project | null;
  index: number;
  total: number;
  narrow: boolean;
  reduced: boolean;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}

/**
 * The opened work. The 3D slab moves to one side; this overlay carries the
 * words, the links and prev / next. Focus is trapped while open.
 */
export default function DetailOverlay({
  project,
  index,
  total,
  narrow,
  reduced,
  onClose,
  onPrev,
  onNext,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const open = Boolean(project);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus({ preventScroll: true });
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !root.current) return;
      const focusables = root.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", trap);
    return () => {
      window.removeEventListener("keydown", trap);
      document.body.style.overflow = prevOverflow;
      previous?.focus?.({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => {
    const el = root.current;
    if (!el || !project) return;
    const items = el.querySelectorAll(".dt-anim");
    if (reduced) {
      gsap.set(items, { opacity: 1, y: 0 });
      return;
    }
    const tl = gsap.fromTo(
      items,
      { opacity: 0, y: 16 },
      { opacity: 1, y: 0, duration: 0.6, ease: "power3.out", stagger: 0.06, delay: 0.1 },
    );
    return () => {
      tl.kill();
    };
  }, [project, reduced]);

  if (!project) return null;
  return (
    <div
      ref={root}
      className={`detail ${narrow ? "is-narrow" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="detail-title"
      aria-describedby="detail-desc"
    >
      <button
        type="button"
        className="detail-backdrop"
        aria-label="閉じる"
        onClick={onClose}
        tabIndex={-1}
      />
      <div className="detail-panel">
        <header className="detail-bar mono dt-anim">
          <span>
            <span className="signal">{String(index + 1).padStart(2, "0")}</span> / {String(total).padStart(2, "0")}
          </span>
          <span className="detail-cat">{project.category}</span>
          <button
            ref={closeRef}
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="閉じる（Esc）"
            data-cursor="CLOSE"
          >
            <X size={18} strokeWidth={1.6} />
          </button>
        </header>

        <h2 id="detail-title" className="detail-title dt-anim">
          {project.title}
        </h2>
        <p className="detail-sub dt-anim">{project.subtitle}</p>
        <p id="detail-desc" className="detail-desc dt-anim">
          {project.description}
        </p>

        <div className="detail-links dt-anim">
          <a
            className="visit-button"
            href={project.url}
            target="_blank"
            rel="noopener noreferrer"
            data-cursor="VISIT"
          >
            <span>
              作品をひらく
              <small className="mono">VISIT EXPERIENCE · 新しいタブ</small>
            </span>
            <ArrowUpRight size={24} strokeWidth={1.5} aria-hidden="true" />
          </a>
          {project.source ? (
            <a
              className="source-link mono"
              href={project.source}
              target="_blank"
              rel="noopener noreferrer"
              data-cursor="SOURCE"
            >
              VIEW SOURCE / GITHUB
              <ArrowUpRight size={14} strokeWidth={1.5} aria-hidden="true" />
            </a>
          ) : null}
        </div>

        <footer className="detail-foot mono dt-anim">
          <span className="detail-year">{project.year}</span>
          <span className="detail-nav">
            <button
              type="button"
              className="icon-button"
              onClick={onPrev}
              disabled={index <= 0}
              aria-label="前の作品"
              data-cursor="PREV"
            >
              <ArrowLeft size={16} strokeWidth={1.6} />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={onNext}
              disabled={index >= total - 1}
              aria-label="次の作品"
              data-cursor="NEXT"
            >
              <ArrowRight size={16} strokeWidth={1.6} />
            </button>
          </span>
        </footer>
        <img
          className="sr-only"
          src={assetUrl(project.cover)}
          alt={`${project.title}のカバー画像`}
        />
      </div>
    </div>
  );
}
