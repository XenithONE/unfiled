import type { Project } from "../types";
import type { Mode } from "../App";

interface Props {
  projects: Project[];
  active: number | null;
  mode: Mode;
  onPick: (index: number) => void;
}

/** Right-edge rail: one tick per work, the active one lit. */
export default function Rail({ projects, active, mode, onPick }: Props) {
  return (
    <nav className={`rail ${mode === "archive" ? "is-visible" : ""}`} aria-label="作品の位置">
      <ol>
        {projects.map((p, i) => (
          <li key={p.id} className={i === active ? "is-active" : ""}>
            <button
              type="button"
              onClick={() => onPick(i)}
              aria-label={`${String(i + 1).padStart(2, "0")} ${p.title}`}
              aria-current={i === active ? "true" : undefined}
              data-cursor={String(i + 1).padStart(2, "0")}
              tabIndex={mode === "archive" ? 0 : -1}
            >
              <i />
              <span className="rail-label mono">{p.title}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
