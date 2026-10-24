import { useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ArrowUpRight } from "lucide-react";
import type { Project } from "../types";

interface Props {
  project: Project | null;
  index: number | null;
  total: number;
  visible: boolean;
  reduced: boolean;
  narrow: boolean;
  onOpen: (project: Project) => void;
}

/**
 * The fixed caption of the work at the focus point. When the work changes,
 * the old title tears away and the new one assembles letter by letter.
 */
export default function Station({ project, index, total, visible, reduced, narrow, onOpen }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<{ project: Project; index: number } | null>(null);
  const pending = useRef<{ project: Project; index: number } | null>(null);
  const animating = useRef(false);

  // queue the change; the out-animation swaps `shown` when done
  useEffect(() => {
    if (!project || index === null) return;
    const next = { project, index };
    if (!shown) {
      setShown(next);
      return;
    }
    if (shown.project.id === project.id) return;
    pending.current = next;
    if (animating.current) return;
    const el = root.current;
    if (!el || reduced) {
      setShown(next);
      pending.current = null;
      return;
    }
    animating.current = true;
    gsap.to(el.querySelectorAll(".st-title .ch"), {
      yPercent: -110,
      opacity: 0,
      duration: 0.28,
      ease: "power2.in",
      stagger: { each: 0.012, from: "end" },
    });
    gsap.to(el.querySelectorAll(".st-fade"), {
      opacity: 0,
      y: -8,
      duration: 0.22,
      ease: "power2.in",
      onComplete: () => {
        animating.current = false;
        const p = pending.current;
        pending.current = null;
        if (p) setShown(p);
      },
    });
  }, [project, index, shown, reduced]);

  // in-animation after a swap
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || !shown) return;
    const chars = el.querySelectorAll(".st-title .ch");
    const fades = el.querySelectorAll(".st-fade");
    if (reduced) {
      gsap.set([chars, fades], { yPercent: 0, opacity: 1, y: 0 });
      return;
    }
    gsap.fromTo(
      chars,
      { yPercent: 110, opacity: 0 },
      { yPercent: 0, opacity: 1, duration: 0.7, ease: "expo.out", stagger: 0.022 },
    );
    gsap.fromTo(
      fades,
      { opacity: 0, y: 10 },
      { opacity: 1, y: 0, duration: 0.5, ease: "power3.out", stagger: 0.06, delay: 0.15 },
    );
  }, [shown, reduced]);

  if (!shown) return null;
  const { project: p, index: i } = shown;
  const words = p.title.split(" ");
  // Syne ExtraBold advances about 1em per glyph; fit the longest word into
  // the caption column (46vw desktop / 92vw narrow) and cap the size.
  const longest = Math.max(4, ...words.map((w) => Array.from(w).length));
  const size = narrow
    ? `clamp(28px, ${Math.min(11, 80 / longest)}vw, 64px)`
    : `clamp(36px, ${Math.min(7.4, 40 / longest)}vw, 132px)`;

  return (
    <div
      ref={root}
      className={`station ${visible ? "is-visible" : ""}`}
      aria-live="polite"
      aria-hidden={!visible}
    >
      <p className="st-num mono st-fade">
        <span className="signal">{String(i + 1).padStart(2, "0")}</span>
        <span className="sep">/</span>
        <span>{String(total).padStart(2, "0")}</span>
        <span className="st-cat">{p.category}</span>
      </p>
      <h2 className="st-title" style={{ fontSize: size }} aria-label={p.title}>
        {words.map((word, wi) => (
          <span className="word" key={wi}>
            {Array.from(word).map((c, ci) => (
              <span className="ch" key={ci} aria-hidden="true">
                {c}
              </span>
            ))}
            {wi < words.length - 1 ? <span className="space"> </span> : null}
          </span>
        ))}
      </h2>
      <p className="st-sub st-fade">{p.subtitle}</p>
      <div className="st-actions st-fade">
        <button
          type="button"
          className="open-button"
          onClick={() => onOpen(p)}
          data-cursor="OPEN"
          tabIndex={visible ? 0 : -1}
        >
          <span>ひらく</span>
          <span className="mono">OPEN / ↵</span>
          <ArrowUpRight size={18} strokeWidth={1.6} aria-hidden="true" />
        </button>
        <span className="st-year mono">{p.year}</span>
      </div>
    </div>
  );
}
