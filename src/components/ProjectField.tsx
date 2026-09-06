import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import { ArrowUpRight } from "lucide-react";
import { assetUrl } from "../data";
import type { Project } from "../types";

type Position = { x: number; y: number; angle: number };
const arrangements: Position[][] = [
  [
    { x: 5.5, y: 50, angle: 4 },
    { x: 39, y: 28, angle: -4 },
    { x: 68, y: 49, angle: 6 },
  ],
  [
    { x: 59, y: 40, angle: -7 },
    { x: 28, y: 27, angle: 5 },
    { x: 4, y: 50, angle: -5 },
  ],
  [
    { x: 5, y: 46, angle: -6 },
    { x: 57, y: 23, angle: 4 },
    { x: 35, y: 47, angle: -3 },
  ],
];
const mobileArrangements: Position[][] = [
  [
    { x: 2, y: 40, angle: -7 },
    { x: 35, y: 32, angle: 5 },
    { x: 25, y: 65, angle: -5 },
  ],
  [
    { x: 29, y: 44, angle: 6 },
    { x: 0, y: 32, angle: -5 },
    { x: 42, y: 65, angle: 4 },
  ],
  [
    { x: 7, y: 62, angle: -4 },
    { x: 36, y: 32, angle: 5 },
    { x: 0, y: 38, angle: -7 },
  ],
];

interface Props {
  projects: Project[];
  arrangement: number;
  paused: boolean;
  onOpen: (project: Project) => void;
}

export default function ProjectField({
  projects,
  arrangement,
  paused,
  onOpen,
}: Props) {
  const field = useRef<HTMLDivElement>(null);
  const [front, setFront] = useState<string>("chronoscope");
  const [offsets, setOffsets] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const [dragging, setDragging] = useState<string | null>(null);
  const pointer = useRef<{
    id: string;
    pointerId: number;
    x: number;
    y: number;
    ox: number;
    oy: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    setOffsets({});
  }, [arrangement]);

  function start(event: PointerEvent<HTMLButtonElement>, id: string) {
    suppressClick.current = false;
    if (event.button !== 0 || event.pointerType === "touch") return;
    const current = offsets[id] || { x: 0, y: 0 };
    pointer.current = {
      id,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      ox: current.x,
      oy: current.y,
      moved: false,
    };
    setFront(id);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent<HTMLButtonElement>, id: string) {
    const p = pointer.current;
    if (p && p.id === id && p.pointerId === event.pointerId) {
      const dx = event.clientX - p.x,
        dy = event.clientY - p.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) p.moved = true;
      if (!p.moved) return;
      setDragging(id);
      const bounds = field.current?.getBoundingClientRect();
      const wrapper =
        event.currentTarget.closest<HTMLElement>(".print-position");
      const left = wrapper?.offsetLeft || 0,
        top = wrapper?.offsetTop || 0;
      const availableHeight =
        field.current?.parentElement?.clientHeight || bounds?.height || 640;
      // Constrain the whole print to the exhibition; the shuffle control restores the layout.
      const width = event.currentTarget.offsetWidth,
        height = event.currentTarget.offsetHeight;
      const minX = -left + 20;
      const maxX = (bounds?.width || 1000) - left - width - 20;
      const minY = -top + 32;
      const maxY = availableHeight - top - height - 24;
      setOffsets((old) => ({
        ...old,
        [id]: {
          x: Math.max(minX, Math.min(maxX, p.ox + dx)),
          y: Math.max(minY, Math.min(maxY, p.oy + dy)),
        },
      }));
    } else if (!paused && event.pointerType === "mouse") {
      const rect = event.currentTarget.getBoundingClientRect();
      event.currentTarget.style.setProperty(
        "--rx",
        `${(-(event.clientY - rect.top - rect.height / 2) / rect.height) * 6}deg`,
      );
      event.currentTarget.style.setProperty(
        "--ry",
        `${((event.clientX - rect.left - rect.width / 2) / rect.width) * 6}deg`,
      );
    }
  }

  function end(event: PointerEvent<HTMLButtonElement>, cancelled = false) {
    if (!pointer.current || pointer.current.pointerId !== event.pointerId)
      return;
    suppressClick.current = !cancelled && pointer.current.moved;
    pointer.current = null;
    setDragging(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function positionFor(index: number): Position {
    const preset = arrangements[arrangement % arrangements.length];
    return (
      preset[index] || {
        x: 7 + ((index * 23) % 65),
        y: 35 + ((index * 11) % 24),
        angle: index % 2 ? 7 : -6,
      }
    );
  }

  return (
    <div
      ref={field}
      className={`project-field ${paused ? "is-paused" : ""}`}
      aria-label="作品の空間展示"
    >
      <span className="registration registration-one" aria-hidden="true" />
      <span className="registration registration-two" aria-hidden="true" />
      <span className="registration registration-three" aria-hidden="true" />
      {projects.map((project, index) => {
        const pos = positionFor(index),
          offset = offsets[project.id] || { x: 0, y: 0 };
        const mobilePos =
          mobileArrangements[arrangement % mobileArrangements.length][index] ||
          pos;
        const style = {
          "--x": `${pos.x}%`,
          "--y": `${pos.y}%`,
          "--angle": `${pos.angle}deg`,
          "--mx": `${mobilePos.x}%`,
          "--my": `${mobilePos.y}%`,
          "--ma": `${mobilePos.angle}deg`,
          "--dx": `${offset.x}px`,
          "--dy": `${offset.y}px`,
          "--delay": `${index * -2.3}s`,
          "--accent": project.accent,
          ...(index >= 3
            ? {
                "--extra-x": `${6 + ((index - 3) % 3) * 31}%`,
                "--extra-top": `calc(var(--field-height) + ${Math.floor((index - 3) / 3) * 360 + 30}px)`,
                "--extra-mobile-top": `calc(var(--field-height) + ${(index - 3) * 300 + 20}px)`,
              }
            : {}),
          zIndex:
            dragging === project.id
              ? projects.length + 20
              : front === project.id
                ? projects.length + 10
                : index + 2,
        } as CSSProperties;
        return (
          <div
            className={`print-position print-position-${project.id} ${index >= 3 ? "print-position-extra" : ""} ${dragging === project.id ? "is-dragging" : ""}`}
            style={style}
            key={project.id}
          >
            <div className="print-float">
              <button
                className="art-print"
                onPointerDown={(event) => start(event, project.id)}
                onPointerMove={(event) => move(event, project.id)}
                onPointerUp={(event) => end(event)}
                onPointerCancel={(event) => end(event, true)}
                onLostPointerCapture={(event) => end(event, true)}
                onPointerLeave={(event) => {
                  event.currentTarget.style.setProperty("--rx", "0deg");
                  event.currentTarget.style.setProperty("--ry", "0deg");
                }}
                onClick={(event) => {
                  if (suppressClick.current && event.detail !== 0) {
                    suppressClick.current = false;
                    return;
                  }
                  onOpen(project);
                }}
                onFocus={() => setFront(project.id)}
                aria-label={`${project.title}：${project.subtitle} — 作品の詳細をひらく`}
              >
                <div className="print-image">
                  <img
                    src={assetUrl(project.cover)}
                    alt={
                      project.title === "AETHER"
                        ? "地球を望む宇宙ステーションの円形窓"
                        : project.title === "CHRONOSCOPE"
                          ? "月夜の岩場に立つ観測塔"
                          : `${project.title}のカバーアート`
                    }
                    draggable="false"
                    fetchPriority={index === 1 ? "high" : "auto"}
                  />
                  <span className="print-invitation">
                    {project.subtitle}
                    <ArrowUpRight size={24} />
                  </span>
                </div>
                <span className="print-caption">
                  <span className="print-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span>{project.title}</span>
                  <ArrowUpRight size={23} strokeWidth={1.7} />
                </span>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
