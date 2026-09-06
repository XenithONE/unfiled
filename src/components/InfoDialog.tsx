import { useEffect, useId, useRef } from "react";
import { ArrowUpRight, X } from "lucide-react";
import { assetUrl } from "../data";
import type { Project } from "../types";
import "./dialog.css";

interface InfoDialogProps {
  project: Project | null;
  about: boolean;
  onClose: () => void;
}

export default function InfoDialog({
  project,
  about,
  onClose,
}: InfoDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const backdropPress = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const isOpen = Boolean(project || about);

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
      className={`info-dialog${project ? " info-dialog--project" : " info-dialog--about"}`}
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
            {project
              ? "UNFILED / SELECTED EXPERIMENT"
              : "UNFILED / ABOUT THIS PLACE"}
          </span>
          <button
            ref={closeRef}
            className="info-dialog__close"
            type="button"
            onClick={onClose}
            aria-label="閉じる"
          >
            <X size={21} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </header>

        {project ? (
          <article className="info-dialog__project">
            <figure className="info-dialog__figure">
              <img
                src={assetUrl(project.cover)}
                alt={`${project.title}の世界を表現したカバーアート`}
              />
              <figcaption>
                <span>COVER ART</span>
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
                    size={28}
                    strokeWidth={1.5}
                    aria-hidden="true"
                  />
                  <span className="info-dialog__sr-only">（新しいタブ）</span>
                </a>
                <a
                  className="info-dialog__source"
                  href={project.source}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span>VIEW SOURCE / GITHUB</span>
                  <ArrowUpRight
                    size={17}
                    strokeWidth={1.5}
                    aria-hidden="true"
                  />
                  <span className="info-dialog__sr-only">（新しいタブ）</span>
                </a>
              </div>
            </div>
          </article>
        ) : about ? (
          <article className="info-dialog__about">
            <div className="info-dialog__about-top">
              <span className="info-dialog__eyebrow">
                A COLLECTION OF CURIOSITIES
              </span>
              <span className="info-dialog__asterisk" aria-hidden="true">
                ✳
              </span>
            </div>
            <h2 className="info-dialog__about-title" id={titleId}>
              つくる。ためす。
              <br />
              また、つくる。
            </h2>
            <div className="info-dialog__about-copy" id={descriptionId}>
              <p>
                つくりたいものは、そのときの好奇心で変わる。
                <br className="info-dialog__desktop-break" />
                宇宙へ行ったり、時間を旅したり、ただ海を眺めたり。
              </p>
              <p>
                AIといっしょに、思いつきをかたちにする。
                <br className="info-dialog__desktop-break" />
                つくること自体が楽しくて、テーマも、目的も、まだばらばら。
              </p>
              <p>
                ここは、そんな制作物が集まる場所。
                <br className="info-dialog__desktop-break" />
                分類するより先に、まずは並べてみました。
              </p>
            </div>
            <footer className="info-dialog__about-footer">
              <span>好奇心に、完成はない。</span>
              <a
                href="https://github.com/XenithONE"
                target="_blank"
                rel="noopener noreferrer"
              >
                XenithONE / GITHUB
                <ArrowUpRight size={18} strokeWidth={1.5} aria-hidden="true" />
                <span className="info-dialog__sr-only">（新しいタブ）</span>
              </a>
            </footer>
          </article>
        ) : null}
      </div>
    </dialog>
  );
}
