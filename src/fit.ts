/**
 * Fitting display type to a column. The display face is very wide, and titles
 * run from four letters to four words, so sizes are measured, not guessed.
 */
import { useEffect, useState } from "react";

const DISPLAY_FONT =
  '800 200px Syne, "Arial Black", "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif';
const TRACKING_EM = -0.035;

let ctx: CanvasRenderingContext2D | null = null;
let cache = new Map<string, number>();

/** Advance width of a word in em (upper-cased, with the display tracking). */
function wordEm(word: string) {
  const key = word.toUpperCase();
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  if (!ctx) ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return key.length * 1.05;
  ctx.font = DISPLAY_FONT;
  const em = ctx.measureText(key).width / 200 + Array.from(key).length * TRACKING_EM;
  cache.set(key, em);
  return em;
}

/**
 * Largest size (px) at which `title` sets in `width` px on at most `maxLines`
 * lines without breaking a word. `gapEm` is the space between words.
 */
export function fitDisplay(
  title: string,
  width: number,
  maxSize: number,
  minSize: number,
  maxLines = 2,
  gapEm = 0.22,
) {
  const words = title.split(" ").filter(Boolean).map(wordEm);
  if (words.length === 0 || width <= 0) return maxSize;
  const longest = Math.max(...words);
  let size = Math.min(maxSize, (width / longest) * 0.985);
  for (let i = 0; i < 40 && size > minSize; i++) {
    let lines = 1;
    let run = 0;
    for (const w of words) {
      const next = run === 0 ? w : run + gapEm + w;
      if (next * size > width && run > 0) {
        lines++;
        run = w;
      } else run = next;
    }
    if (lines <= maxLines) break;
    size *= 0.95;
  }
  return Math.max(minSize, size);
}

/** Re-render once the web fonts are in (measurements change with them). */
export function useFontsReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    const fonts = document.fonts;
    if (!fonts) return;
    const done = () => {
      if (!alive) return;
      cache = new Map();
      setReady(true);
    };
    // the display face is only fetched once something asks for it
    Promise.all([fonts.load('800 40px "Syne"'), fonts.ready]).then(done, done);
    return () => {
      alive = false;
    };
  }, []);
  return ready;
}

/** Viewport width, kept current. */
export function useViewportWidth() {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return width;
}
