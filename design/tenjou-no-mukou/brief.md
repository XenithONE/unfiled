# 天井のむこう — production brief

Original Japanese vertical horror webcomic, hosted at `public/comics/tenjou-no-mukou/` and linked from UNFILED's projects.json.

## Narrative and requested refinements

An adult returns to clear out the family home after both parents have died. While packing keepsakes, a teacup falls and shatters. An old landline rings; the caller says nothing. A knock comes from the ceiling. He sets a wooden ladder inside the open oshiire closet and climbs it, then shines a flashlight through the hatch into the dark attic. A faint human shape is visible deep inside. The next deliberate downward scroll triggers an involuntary, accelerating frame-by-frame scroll through a ghost rushing toward the reader. The final frame has the ghost's face near the center and exactly one foreshortened hand grasping at the reader.

Preserve the detailed crosshatched ink manga style the user saw, but render the whole comic in color: worn reddish cedar, faded olive tatami, navy clothing, cold blue dusk, warm yellow flashlight, pallid ghost and aged ivory garment. No copied character or art from the referenced original work.

## Layout / design system

- Reference opening concept: 1536 x 1024. Black #080909, off-white #dedad0, muted red #a86253 accent; weathered color art. Mincho serif for Japanese narrative/title; system sans for small controls.
- Opening: small UNFILED back link top left, sound toggle top right, title on two lines left, room art right, tagline, outlined start button, subtle motion setting. User's latest color and audio requests supersede monochrome/off defaults in concepts.
- Copy: 天井のむこう / 両親がいなくなった家で、まだ音がする。 / 読みはじめる / 音と動きのある短編漫画 / 下へ、ゆっくり。
- Reading: centered max 760px column, varied panel ratios and black gutters, native HTML captions/sound lettering. Only subtle fixed controls.
- Attack: nine DIFFERENT pose drawings, hard frame cuts with decreasing frame holds, real programmatic page scrolling through frame markers. No simple image zoom substitute. Final frame centered face and foreground hand. No white flashing.
- Ending: black silence, short closing prose, replay and back links. Static reading mode and reduced motion support.

## Behavior and acceptance criteria

- Start click unlocks Web Audio; sound on initially, mute always usable. Synthesized ceramic shatter, old telephone bell, wooden knocks, floor scrapes, and a sharp final impact must visibly synchronize to the illustrated events.
- No attack before user begins; no attack on load, resize, or restored deep link. Discovery must be viewed before fresh down intent, then automatic sequence runs once. Wheel, keyboard, touch supported.
- Images decoded before attack. Failed image load falls back to static reading without scroll lock. Escape, visible stop, visibility loss, pagehide, reduced motion, resize, and replay clean up audio, RAF and scrolling control. Never manipulate the OS pointer.
- Finite state: idle -> reading -> discovery -> attacking -> ending, or static reading. Rearm only on explicit replay.
- Animation holds make poses readable, about 2 seconds total. Preclimax remains still; phone/shatter can have one restrained visual jolt in motion mode.
- Verify desktop and mobile, actual automatic scroll and unique frame progression, audio synthesis output, mute and stop, reduced motion, repeated replay, image failure, inactive tab, keyboard/touch, link collection integration and live deployment.

## Reference sources

- User-mentioned reference: https://www.webtoons.com/en/thriller/chiller/bongcheon-dong-ghost-horang/viewer?episode_no=22&title_no=536
- Browser scroll API: https://developer.mozilla.org/en-US/docs/Web/API/Window/scrollTo
- Web Audio gesture policy: https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay
- Reduced motion: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion

Implementation and verification were completed locally by the coordinating agent.
