import { useEffect, useRef } from "react";
import gsap from "gsap";
import type { StageStatus } from "../stage/useStage";

interface Props {
  count: number;
  year: number;
  status: StageStatus;
  reduced: boolean;
  revealed: boolean;
  onEnter: () => void;
}

const LEDE = "好奇心の、散らばるままに。";

const DIGITS = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

/** 1..99 in kanji numerals (三十二). */
function kanjiCount(n: number) {
  const tens = Math.floor(n / 10) % 10;
  const ones = n % 10;
  return `${tens > 1 ? DIGITS[tens] : ""}${tens > 0 ? "十" : ""}${DIGITS[ones]}` || "〇";
}

export default function HeroCopy({ count, year, status, reduced, revealed, onEnter }: Props) {
  const root = useRef<HTMLElement>(null);
  const unsupported = status.state === "unsupported";

  useEffect(() => {
    if (!revealed || !root.current) return;
    const el = root.current;
    const chars = el.querySelectorAll<HTMLElement>(".hero-lede .ch");
    const rest = el.querySelectorAll<HTMLElement>(".hero-reveal");
    const stamp = el.querySelector<HTMLElement>(".stamp");
    const tl = gsap.timeline();
    if (reduced) {
      tl.set([chars, rest, stamp], { opacity: 1, y: 0, scale: 1, rotate: -11 });
      return;
    }
    tl.fromTo(
      chars,
      { yPercent: 110, opacity: 0, rotateX: -40 },
      { yPercent: 0, opacity: 1, rotateX: 0, duration: 0.9, ease: "expo.out", stagger: 0.035 },
      0.1,
    )
      .fromTo(
        rest,
        { y: 18, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.7, ease: "power3.out", stagger: 0.08 },
        0.5,
      )
      .fromTo(
        stamp,
        { scale: 2.4, opacity: 0, rotate: 6 },
        { scale: 1, opacity: 0.92, rotate: -11, duration: 0.42, ease: "expo.in" },
        0.95,
      )
      .to(stamp, { x: -2, y: 2, duration: 0.06, yoyo: true, repeat: 1 }, ">");
    return () => {
      tl.kill();
    };
  }, [revealed, reduced]);

  return (
    <section className="hero" ref={root} aria-labelledby="hero-title" id="top">
      <div className="hero-copy">
        <p className="hero-eyebrow mono hero-reveal">
          <span className="signal">FIELD NOTES</span>
          <i aria-hidden="true" />
          <span>VOL. {year}</span>
          <i aria-hidden="true" />
          <span>{String(count || 32).padStart(2, "0")} WORKS</span>
          <i aria-hidden="true" />
          <span>
            {status.state === "ready"
              ? status.backend === "webgpu"
                ? "WEBGPU"
                : "WEBGL2"
              : unsupported
                ? "STATIC"
                : "BOOT"}
          </span>
        </p>
        <h1 id="hero-title" className={unsupported ? "hero-title" : "sr-only"}>
          UNFILED
        </h1>
        <p className="hero-lede" aria-label={LEDE}>
          {Array.from(LEDE).map((c, i) => (
            <span className="ch" key={i} aria-hidden="true">
              {c}
            </span>
          ))}
        </p>
        <p className="hero-sub hero-reveal">
          AIとつくった、まだ分類できないものたち。
          <br />
          {kanjiCount(count || 32)}の実験を、ひとつの粒子の場に並べました。
        </p>
        <div className="hero-actions hero-reveal">
          <button type="button" className="enter-button" onClick={onEnter} data-cursor="ENTER">
            <span>アーカイブに入る</span>
            <span className="mono">SCROLL / ↓</span>
          </button>
          <p className="hero-hint mono">
            {unsupported
              ? "この環境では粒子を描けません。作品一覧はそのまま使えます。"
              : reduced
                ? "動きを抑えた表示です。触れると粒子がゆっくり逃げます。"
                : "触れると、粒子が逃げる。進むと、表紙が塵から組み上がる。"}
          </p>
        </div>
      </div>
      <div className="stamp" aria-hidden="true">
        <span>WIP</span>
        <small>UNFILED / {year}</small>
      </div>
    </section>
  );
}
