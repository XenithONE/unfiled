import { useEffect, useRef, useState } from "react";

/**
 * A small ring cursor for fine pointers. Elements with `data-cursor="LABEL"`
 * expand it and show the label; the native cursor is hidden by CSS while
 * `html.has-cursor` is set.
 */
export default function Cursor() {
  const ring = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLDivElement>(null);
  const [label, setLabel] = useState("");
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (!fine) return;
    setEnabled(true);
    document.documentElement.classList.add("has-cursor");
    const pos = { x: innerWidth / 2, y: innerHeight / 2 };
    const cur = { x: pos.x, y: pos.y };
    let raf = 0;
    let hovering = false;
    let down = false;
    const move = (e: PointerEvent) => {
      pos.x = e.clientX;
      pos.y = e.clientY;
      const target = (e.target as HTMLElement | null)?.closest<HTMLElement>(
        "[data-cursor], a, button, [role=button]",
      );
      const next = target?.dataset.cursor ?? (target ? "" : "");
      hovering = Boolean(target);
      setLabel(next ?? "");
      ring.current?.classList.toggle("is-hover", hovering);
      ring.current?.classList.toggle("has-label", Boolean(next));
    };
    const press = () => {
      down = true;
      ring.current?.classList.add("is-down");
    };
    const release = () => {
      down = false;
      ring.current?.classList.remove("is-down");
    };
    const leave = () => ring.current?.classList.add("is-out");
    const enter = () => ring.current?.classList.remove("is-out");
    const tick = () => {
      cur.x += (pos.x - cur.x) * 0.22;
      cur.y += (pos.y - cur.y) * 0.22;
      if (ring.current)
        ring.current.style.transform = `translate3d(${cur.x}px, ${cur.y}px, 0) translate(-50%, -50%)`;
      if (dot.current)
        dot.current.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0) translate(-50%, -50%)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", press, { passive: true });
    window.addEventListener("pointerup", release, { passive: true });
    document.documentElement.addEventListener("mouseleave", leave);
    document.documentElement.addEventListener("mouseenter", enter);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", press);
      window.removeEventListener("pointerup", release);
      document.documentElement.removeEventListener("mouseleave", leave);
      document.documentElement.removeEventListener("mouseenter", enter);
      document.documentElement.classList.remove("has-cursor");
      void down;
    };
  }, []);

  if (!enabled) return null;
  return (
    <>
      <div ref={ring} className="cursor-ring" aria-hidden="true">
        <span className="cursor-label mono">{label}</span>
      </div>
      <div ref={dot} className="cursor-dot" aria-hidden="true" />
    </>
  );
}
