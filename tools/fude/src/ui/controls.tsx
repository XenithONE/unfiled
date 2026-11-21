// 小さな部品: 横棒のスライダー（CLIP STUDIO 風）、切り替え、選択。
import { useEffect, useRef, useState, type ReactNode } from "react";

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  log?: boolean;
  unit?: string;
  digits?: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  title?: string;
}

export function Slider(p: SliderProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const toT = (v: number) => (p.log ? Math.log(v / p.min) / Math.log(p.max / p.min) : (v - p.min) / (p.max - p.min));
  const fromT = (t: number) => {
    const c = Math.min(1, Math.max(0, t));
    let v = p.log ? p.min * Math.pow(p.max / p.min, c) : p.min + (p.max - p.min) * c;
    const st = p.step ?? (p.log ? (v < 10 ? 0.1 : 1) : (p.max - p.min) / 100);
    v = Math.round(v / st) * st;
    return Math.min(p.max, Math.max(p.min, Number(v.toFixed(4))));
  };
  const t = Math.min(1, Math.max(0, toT(p.value)));
  const digits = p.digits ?? (p.max - p.min <= 1 ? 2 : p.value < 10 && p.log ? 1 : 0);
  const shown = p.max === 1 && p.min === 0 && !p.unit ? `${Math.round(p.value * 100)}%` : `${p.value.toFixed(digits)}${p.unit ?? ""}`;
  const set = (clientX: number, commit = false) => {
    const r = ref.current!.getBoundingClientRect();
    const v = fromT((clientX - r.left) / r.width);
    p.onChange(v);
    if (commit) p.onCommit?.(v);
  };
  return (
    <div className="slider" title={p.title}>
      <span className="slider-label">{p.label}</span>
      {editing ? (
        <input
          className="slider-input"
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            setEditing(false);
            const n = parseFloat(text.replace("%", ""));
            if (Number.isFinite(n)) {
              const v = p.max === 1 && p.min === 0 && !p.unit ? n / 100 : n;
              const c = Math.min(p.max, Math.max(p.min, v));
              p.onChange(c);
              p.onCommit?.(c);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <div
          className="slider-bar"
          ref={ref}
          role="slider"
          aria-label={p.label}
          aria-valuemin={p.min}
          aria-valuemax={p.max}
          aria-valuenow={p.value}
          tabIndex={0}
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            set(e.clientX);
          }}
          onPointerMove={(e) => {
            if (e.buttons) set(e.clientX);
          }}
          onPointerUp={(e) => set(e.clientX, true)}
          onDoubleClick={() => {
            setText(String(p.max === 1 && p.min === 0 && !p.unit ? Math.round(p.value * 100) : Number(p.value.toFixed(2))));
            setEditing(true);
          }}
          onKeyDown={(e) => {
            const d = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
            if (!d) return;
            e.preventDefault();
            const v = fromT(t + d * 0.02);
            p.onChange(v);
            p.onCommit?.(v);
          }}
        >
          <div className="slider-fill" style={{ width: `${t * 100}%` }} />
          <span className="slider-value">{shown}</span>
        </div>
      )}
    </div>
  );
}

export function Toggle(p: { label: string; value: boolean; onChange: (v: boolean) => void; title?: string }) {
  return (
    <label className="toggle" title={p.title}>
      <input type="checkbox" checked={p.value} onChange={(e) => p.onChange(e.target.checked)} />
      <span>{p.label}</span>
    </label>
  );
}

export function Select<T extends string>(p: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; title?: string }) {
  return (
    <label className="select" title={p.title}>
      <span>{p.label}</span>
      <select value={p.value} onChange={(e) => p.onChange(e.target.value as T)}>
        {p.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Segmented<T extends string>(p: { value: T; options: { value: T; label: string; title?: string }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={p.label}>
      {p.options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={p.value === o.value} className={p.value === o.value ? "on" : ""} title={o.title} onClick={() => p.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Panel(p: { title: string; children: ReactNode; right?: ReactNode; className?: string; collapsible?: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <section className={`panel ${p.className ?? ""}`}>
      <header className="panel-head">
        <button type="button" className="panel-title" onClick={() => p.collapsible !== false && setOpen(!open)} aria-expanded={open}>
          {p.title}
        </button>
        <div className="panel-right">{p.right}</div>
      </header>
      {open && <div className="panel-body">{p.children}</div>}
    </section>
  );
}

/** 値が変わったら一定時間後にだけ呼ぶ。 */
export function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}
