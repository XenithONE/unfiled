# Verification — 2026-09-20

## Automated simulation

`npm run test:everest`: 16 checks passed. Coverage includes wide terrain distribution, seeded events, turning, braking and boost, chained tricks, landing rewards, frontal and lateral rock contact, crevasse rescue, airborne gap clearance, avalanche escape, full descent, frame-rate-independent fixed stepping, natural cornice support and takeoff, and navigation to the camp after a wide detour.

`npm run build`: TypeScript and Vite build passed. The shared Three.js chunk exceeds Vite's informational 500 kB warning threshold; compressed size is about 146 kB.

## Browser checks

- Desktop Chromium: real keyboard steering, jump, two airborne tricks, landing score, pause/resume.
- Visual inspection: snow cornice approach, lip, airborne rider, middle mountain, icefall, and avalanche. Snowboard points along travel and has a crouched sideways riding stance.
- Local split screen: P1 and P2 independently turn in opposite directions and jump/trick using their separate keys.
- Mobile emulation, 390 × 844 with touch: menu fit, no horizontal overflow, native touch jump and trick, successful landing and score. Physical mobile hardware performance is not established by this emulation.
- Online: two isolated browser contexts connected through the actual public PeerJS signaling service. Checked clock synchronization before start, poses beyond the original narrow corridor, heading, tricks and score, identical event seeds, two completed results, and rematch reset.
- Online capacity: two full game clients plus two lightweight clients using the same Room implementation joined one room. A fifth client received the full-room rejection.
- Disconnects: closing a guest removes its roster entry while the host continues; closing the host makes the remaining game continue in solo mode. A heartbeat timeout also clears ungraceful disconnections.
- No page errors in the final connection, mobile, or split-screen checks.

A short 90-frame measurement with two online browser contexts at 1280 × 800 returned a median frame interval of 17.7 ms and an average of 56.7 FPS on this workstation. This is a short local sample, not a minimum performance guarantee.

Full races used two clients on one computer; connectivity across separate restrictive NATs has not been established. No dedicated TURN relay is configured. The published game describes this connection limitation.

Browser captures and automation scripts are kept locally in the ignored `output/playwright/` directory. The portfolio cover is an actual gameplay screenshot.
