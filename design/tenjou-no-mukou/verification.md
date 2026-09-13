# 天井のむこう — verification（初回9コマ版の記録）

This document and `acceptance-results.json` preserve the initial release checks. The 36-frame revision uses `frames.js` and the recorded foley described in `frame-direction.md` and `audio/CREDITS.md`.

## Result

The production build passes. The browser acceptance harness passes 36 checks using the real comic HTML, CSS, JS, image assets, and sound synthesis module. The complete results and frame timings are in `acceptance-results.json`. Computer checks used Codex In-app Browser (IAB); no standalone Playwright fallback was used.

The nine frames are distinct drawings. A real browser run recorded document scroll positions 9012, 9732, 10452, 11172, 11892, 12612, 13332, 14052, and 14772 at a 720px iframe height. All nine poses appeared in order. The final pose arrived after 1401ms, then held for 720ms before a 900ms blackout and the ending. RAF delays are allowed to lengthen a hold; intermediate frames are never skipped.

The live IAB reading path was exercised on desktop and at 390 x 844. The final mobile pose was captured during the running automatic sequence. Its artwork center and visible viewport center both measured 187.5px after the alignment correction. This is browser viewport testing, not a physical iPhone/Android hardware test.

## Functional checks

- No start on initial load or an upward wheel event. Discovery requires a new downward input.
- All nine frames appear and the actual window scroll position increases each time.
- Keyboard start, Escape cleanup, fresh touch-swipe handling, visible stop, cancellation on hidden document and orientation/width change.
- Explicit replay preserves sound and motion choices. Quiet mode never takes over scrolling.
- Reduced-motion default, static narrative fallback if art loading fails, and normal ending controls.
- No horizontal overflow at widths 390, 768, and 1366.
- Ten production sound cues were rendered with OfflineAudioContext. Each produced finite, nonzero, unclipped output. Muting produced all-zero samples. Peak sample amplitudes ranged from 0.002916 (receiver noise) to 0.35025 (final impact); detailed measurements are recorded in the JSON.
- The UNFILED card, artwork, description, destination URL, source link, and 11-work count were inspected in IAB. Existing entries remain intact.

## Fidelity ledger

Concepts were generated before implementation: `concepts/opening.png` (1536 x 1024), `concepts/reading.png` (1024 x 1536), and `concepts/climax.png`. Their ink line style and layout were retained while applying the user's later requests for color, a ladder, additional strange events, and sound. The final opening is preserved as `preview.png`.

Both the concept files and implementation captures were opened with `view_image`. Desktop opening was inspected at the concept's native 1536 x 1024 viewport. Mobile was inspected at 390 x 844. The following comparison points were inspected:

| Point | Evidence and decision |
| --- | --- |
| Opening composition | Large two-line title at left; the open closet and ladder remain the focus at right. Edge darkening supports the text without recoloring the art. |
| Copy | Title, tagline, primary CTA, short-comic note and downward invitation match the adopted copy. No promotional sections were added. |
| Typography | Native Japanese Mincho text, large title, deliberately small utility controls, legible native captions. Text remains selectable; it is not baked into screenshots. |
| Palette | Black #080909 and pale #dedad0 UI. Full-color cedar, navy, tatami and flashlight follow the explicit later color request. |
| Reading rhythm | Centered 760px comic column, changing panel proportions, unframed dark pauses. Phone and shatter were added at the user's request. |
| Character continuity | Consistent packing protagonist, navy clothing, open closet, wooden ladder, attic beams, pale garment and dark hair. |
| Final face and hand | Dedicated detailed final image with face near center and one grasping hand in front. The two preceding reaching poses are mirrored at display time to keep the reaching side consistent. |
| Responsive framing | Initial mobile oversized artwork was aligned by an implicit grid track and drifted right. Changed attack layout to centered flex; both measured centers now coincide. |
| Interaction | Hard frame cuts and real automatic scrolling, each paired with its sound cue; no substitute based only on scaling one picture. |

Allowed visible additions to the initial opening concept: motion toggle and quiet-reading alternative, necessary for controlling the requested automatic motion and sound; sound defaults ON after explicit reader interaction, while OS reduced-motion defaults are honored. Main story additions and color changes were explicitly requested. Above-the-fold copy diff: no unexplained additions or omissions. No material visual mismatch remains against the adopted layout and subsequent user refinements.

## Reproduction

1. `npm ci` then `npm run build`.
2. Copy `tests/tenjou-no-mukou.html` to `dist/qa.html` for local verification only.
3. Serve `dist` on a loopback HTTP server and open `/qa.html` in a browser. Press **Run checks**.
4. Do not deploy `qa.html`: it is not in `public`, and a fresh production build excludes it.

IAB manual path: open `/comics/tenjou-no-mukou/`, switch motion ON if the OS has reduced motion enabled, choose 読みはじめる, read down through the illustrated events, pause at the distant shape, then scroll downward again. The effects can be stopped or muted, and the frames can be reviewed from the ending.

## Artwork and reference

All artwork uses the built-in `image_gen` tool. Production files are in `public/comics/tenjou-no-mukou/art/`; `asset-prompts.json` records prompt sets and generated originals. `export-art.mjs` exports lossy WebP at quality 92 without cropping, recoloring or redrawing; frame selection uses CSS atlas coordinates.

The web-medium inspiration is the user-mentioned [Bongcheon-Dong Ghost](https://www.webtoons.com/en/thriller/chiller/bongcheon-dong-ghost-horang/viewer?episode_no=22&title_no=536). The story and images are newly created. Implementation references: [Window.scrollTo](https://developer.mozilla.org/en-US/docs/Web/API/Window/scrollTo), [Web Audio autoplay guidance](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay), and [prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion).
