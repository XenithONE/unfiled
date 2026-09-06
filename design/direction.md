# UNFILED / design direction

An interactive archival table for unrelated experiments. The maker's curiosity is the common thread.

The user delegated the whole design and implementation. Selected concept: `concept.png`, generated with the built-in Image Gen tool. Complete one-screen spatial gallery; Index and About use the same system.

## Tokens and components

- Paper/background: #e9e9e6 (neutral pale gray); ink #242521; accent #fa512c; rules #b5b5b0.
- Display: Anton, tightly spaced uppercase; body Inter plus Japanese system sans; labels IBM Plex Mono.
- Gutters 24px desktop / 20px mobile. 8px spacing base. Rectangular artwork prints with a 40–48px caption strip. Shadows belong only to prints and compact view controls.
- Layout: quiet ruled header; oversized UNFILED; open art field; controls row; ruled footer. No marketing sections or repeated card grid.
- Icons: Lucide, 1.5px outlines, arrow-up-right, box, list, shuffle, hand, pause/play, x; asterisk is a simple native graphical identity.
- Motion: spring-like rearrangement, pointer tilt, individually draggable prints, subtle idle float. Pause stops ambient motion; reduced-motion disables ambient movement and transitions. Touch layout scrolls naturally.
- Index: full-width ruled rows with image thumbnail, title, category, year and arrow. Selecting either view opens the same accessible native dialog.
- About: typographic editorial dialog with the maker's stated purpose and GitHub link. No invented biography or metrics.

## Intentional changes after public repository verification

- The concept included four prints. Only three repositories were verified as original public works; remove the CL4R1T4S fork and use count 03.
- NOSTALGIC SEA is displayed under its actual public title NAGI.
- AETHER's cover uses a space station and Earth, reflecting the actual project instead of the concept's ocean window.
- Artwork is editorial cover art, not claimed to be a screenshot of the linked work. All titles, navigation and captions are real HTML.
- Desktop field preserves the three large asymmetric prints. Mobile uses a compact spatial stack and scrollable continuation, with list view always available.

## Allowed initial screen copy

UNFILED. / つくる。ためす。また、つくる。 / 作品 / この場所について / UNFILED / 好奇心の、散らばるままに。 / AIとつくった、まだ分類できないものたち。 / AETHER / CHRONOSCOPE / NAGI / ドラッグして探索 / 作品をクリックして、ひらく / 空間 / 一覧 / 03 EXPERIMENTS / XenithONE © 2026 / 好奇心に、完成はない。

## Implementation references

- https://vite.dev/guide/static-deploy.html — relative asset base and GitHub Actions build.
- https://react.dev/reference/react-dom/createPortal — modal rendering when needed (native dialog used here).
