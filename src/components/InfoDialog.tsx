import { useEffect, useId, useRef } from "react";
import { ArrowUpRight, X } from "lucide-react";
import { assetUrl } from "../data";
import type { Project } from "../types";
import "./dialog.css";

interface InfoDialogProps {
  project: Project | null;
  onClose: () => void;
}

export default function InfoDialog({ project, onClose }: InfoDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const backdropPress = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const isOpen = Boolean(project);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!isOpen || !dialog) return;

    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    const previousPadding = document.body.style.paddingRight;
    const scrollbarWidth =
      window.innerWidth - document.documentElement.clientWidth;
    const bodyPadding =
      Number.parseFloat(window.getComputedStyle(document.body).paddingRight) ||
      0;

    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0)
      document.body.style.paddingRight = `${bodyPadding + scrollbarWidth}px`;
    if (!dialog.open) dialog.showModal();
    closeRef.current?.focus({ preventScroll: true });

    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPadding;
      if (previousFocus?.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, [isOpen]);

  const outsideDialog = (x: number, y: number) => {
    const rect = dialogRef.current?.getBoundingClientRect();
    return Boolean(
      rect &&
        (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom),
    );
  };

  return (
    <dialog
      ref={dialogRef}
      className="info-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onPointerDown={(event) => {
        backdropPress.current =
          event.target === event.currentTarget &&
          outsideDialog(event.clientX, event.clientY);
      }}
      onClick={(event) => {
        if (
          backdropPress.current &&
          event.target === event.currentTarget &&
          outsideDialog(event.clientX, event.clientY)
        )
          onClose();
        backdropPress.current = false;
      }}
    >
      <div className="info-dialog__paper">
        <header className="info-dialog__bar">
          <span className="info-dialog__eyebrow">
            UNFILED / SELECTED WORK
          </span>
          <button
            ref={closeRef}
            className="info-dialog__close"
            type="button"
            onClick={onClose}
            aria-label="閉じる"
          >
            <X size={20} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </header>

        {project ? (
          <article
            className="info-dialog__project"
            style={{ "--accent": project.accent } as React.CSSProperties}
          >
            <figure className="info-dialog__figure">
              <img
                src={assetUrl(project.cover)}
                alt={`${project.title}のカバー画像`}
              />
              <figcaption>
                <span>COVER</span>
                <span>{project.year}</span>
              </figcaption>
            </figure>
            <div className="info-dialog__details">
              <div className="info-dialog__metadata">
                <span>{project.category}</span>
                <span>{project.year}</span>
              </div>
              <h2 className="info-dialog__title" id={titleId}>
                {project.title}
              </h2>
              <p className="info-dialog__subtitle">{project.subtitle}</p>
              <p className="info-dialog__description" id={descriptionId}>
                {project.description}
              </p>
              <div className="info-dialog__links">
                <a
                  className="info-dialog__visit"
                  href={project.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span>
                    作品をひらく
                    <span className="info-dialog__link-note">
                      VISIT EXPERIENCE
                    </span>
                  </span>
                  <ArrowUpRight
                    size={26}
                    strokeWidth={1.5}
                    aria-hidden="true"
                  />
                  <span className="info-dialog__sr-only">（新しいタブ）</span>
                </a>
                {project.source && (
                  <a
                    className="info-dialog__source"
                    href={project.source}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span>VIEW SOURCE / GITHUB</span>
                    <ArrowUpRight
                      size={16}
                      strokeWidth={1.5}
                      aria-hidden="true"
                    />
                    <span className="info-dialog__sr-only">（新しいタブ）</span>
                  </a>
                )}
              </div>
            </div>
          </article>
        ) : null}
      </div>
    </dialog>
  );
}
