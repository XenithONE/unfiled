import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import type { StageStatus } from "../stage/useStage";

interface Props {
  status: StageStatus;
  reduced: boolean;
  onDone: () => void;
}

const LINES = [
  "UNFILED / FIELD BOOT",
  "> adapter ............ probing",
  "> particles .......... allocating",
  "> shaders ............ compiling",
  "> archive ............ filing 31 works",
];

const MIN_MS = 1700;

export default function Loader({ status, reduced, onDone }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [gone, setGone] = useState(false);
  const started = useRef(performance.now());
  const finished = useRef(false);

  // typed boot lines
  useEffect(() => {
    let i = 0;
    const id = window.setInterval(() => {
      i++;
      setLines(LINES.slice(0, i));
      if (i >= LINES.length) window.clearInterval(id);
    }, 190);
    return () => window.clearInterval(id);
  }, []);

  // progress bar: time based, snaps to 100 when the stage is ready
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    let raf = 0;
    const tick = () => {
      const t = (performance.now() - started.current) / MIN_MS;
      const target = status.state === "booting" ? Math.min(0.86, t * 0.9) : 1;
      const cur = Number.parseFloat(el.dataset.p ?? "0");
      const next = cur + (target - cur) * 0.12;
      el.dataset.p = String(next);
      el.style.transform = `scaleX(${next})`;
      if (!finished.current) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [status.state]);

  useEffect(() => {
    if (status.state === "booting" || finished.current) return;
    const wait = Math.max(0, MIN_MS - (performance.now() - started.current));
    const id = window.setTimeout(() => {
      finished.current = true;
      const el = root.current;
      if (!el) {
        setGone(true);
        onDone();
        return;
      }
      const tl = gsap.timeline({
        onComplete: () => {
          setGone(true);
          onDone();
        },
      });
      if (reduced) {
        tl.to(el, { opacity: 0, duration: 0.35, ease: "power2.out" });
      } else {
        tl.to(el.querySelector(".loader-panel"), {
          opacity: 0,
          y: -12,
          duration: 0.3,
          ease: "power2.in",
        }).to(
          el,
          {
            clipPath: "inset(0 0 100% 0)",
            duration: 0.9,
            ease: "expo.inOut",
          },
          "-=0.05",
        );
      }
    }, wait);
    return () => window.clearTimeout(id);
  }, [status.state, reduced, onDone]);

  if (gone) return null;
  const backend =
    status.state === "ready"
      ? status.backend === "webgpu"
        ? "WEBGPU"
        : "WEBGL2"
      : status.state === "unsupported"
        ? "STATIC"
        : "…";
  const count = status.state === "ready" ? status.count.toLocaleString("en-US") : "…";

  return (
    <div className="loader" ref={root} role="status" aria-live="polite">
      <div className="loader-panel mono">
        <div className="loader-lines">
          {lines.map((line, i) => (
            <div key={i} className={i === 0 ? "loader-head" : ""}>
              {line
                .replace("probing", status.state === "booting" ? "probing" : backend)
                .replace("allocating", status.state === "booting" ? "allocating" : count)}
            </div>
          ))}
        </div>
        <div className="loader-bar" aria-hidden="true">
          <div ref={bar} className="loader-bar-fill" />
        </div>
        <div className="loader-foot">
          <span>WORK IN PROGRESS</span>
          <span>粒子を組み立てています</span>
        </div>
      </div>
    </div>
  );
}
