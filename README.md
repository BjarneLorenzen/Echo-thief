# Echo Thief

A single-player arcade survival game for iPhone. Tilt the phone to steer a small ghost around the arena. Every 10 seconds an **echo** spawns: a shadow copy that replays exactly what you did over the previous 10 seconds, then loops it forever. Echoes pile up, so you end up dodging a growing crowd of your own past selves. If you touch one, the run ends.

It's a Progressive Web App (HTML5 Canvas + vanilla JS, no build step and no dependencies). It runs in Safari, and you can add it to the Home Screen to play full-screen and offline.

## Play it on your iPhone

The motion sensors only work over **HTTPS**, so the game has to be hosted. GitHub Pages is the easiest option:

1. In this repository, go to **Settings → Pages**, set **Source** to "Deploy from a branch", pick the branch and `/ (root)`, and save.
2. Open the published URL (e.g. `https://<user>.github.io/Echo-thief/`) in **Safari** on your iPhone.
3. Tap **Start**. iOS asks for motion & orientation access. Tap **Allow**.
4. To install it, tap **Share → Add to Home Screen**. It then launches full-screen in portrait and works offline.

Any static HTTPS host works too (Netlify, Cloudflare Pages, Vercel…).

## Controls

| Device | Control |
|---|---|
| iPhone | **Tilt** to steer. Your hand position when you tap Start (or Resume) counts as "neutral". Tap the **crosshair button** (top right) at any time to make your current angle the new neutral. |
| Touch fallback | Drag anywhere for a floating joystick. This also works if you denied motion access. |
| Desktop | Mouse drag, or arrow keys / WASD. Enter starts a run, Esc / P pauses, C resets the tilt angle. |

## Rules & mechanics

- **Score** is the number of seconds survived, plus a bonus of +2 for each spark you collect. The screen also shows how many echoes are on the field.
- **Echoes** replay your recorded positions exactly. The simulation runs at a fixed 120 Hz and records every step. Rendering interpolates between the recorded frames.
- **Spawn warning:** a pulsing dashed outline appears where the next echo will spawn 1 s before it shows up. The outline is harmless.
- **Fairness:** an echo won't activate while you're within the safe radius of its spawn point. An orange dashed circle shows the zone you need to leave. When an echo loops back to the start of its path, it briefly "reforms" there and can't hurt you. A ring also marks where it will reappear just before it loops.
- **Invulnerability:** you can't be hit for the first second of a run (the ghost blinks).
- **Difficulty:** once 6 echoes have spawned, new ones arrive every 8 s instead of every 10 s.
- **Sparks** (v1.1): grab them for bonus points. They lure you into moving around, which makes your future echoes more chaotic.
- **Fade** (v1.1): a cyan ring power-up. It makes every echo vanish and become harmless for 3 s. The echoes blink back in during the last 0.8 s so you have time to react.

**Adaptive music:** every echo on the field adds its own instrument layer to the soundtrack, so the music builds up as the danger does. A melodic echo literally *plays its path*: its pitch follows how high the echo is in the arena, and its stereo position follows where it is left to right. When a Fade power-up hides the echoes, their instruments drop out with them. Pick the style under **Settings** (the sliders icon on the title screen, or **Settings** in the pause menu): **Ambient**, **Synthwave**, **Lo-fi**, **Chiptune**, **Techno**, or **Off**. The settings screen plays a live preview that adds an echo every few seconds, and also has music and effects volume sliders.

All other audio is also synthesized with Web Audio: a chime when an echo spawns that rises in pitch as more echoes arrive, a shatter sound on death, and pickup sounds. On death you also get haptic feedback, via `navigator.vibrate` where supported, or the native-switch haptic trick on iOS 18+ (best effort; earlier iOS versions have no web haptics API). Your best score, mute and music settings are stored in `localStorage`.

## Project layout

```
index.html            App shell, overlays (title / pause / game over), HUD
css/style.css         Neon styling, safe-area layout
js/core.js            Pure deterministic simulation (no DOM): physics, recording, echoes, pickups
js/main.js            Rendering, input (tilt / drag / keys), screens, game loop
js/audio.js           Sound effects, volume buses, music phases
js/music.js           Adaptive step-sequencer music: genres, instruments, echo layers
sw.js                 Service worker (offline cache) – bump VERSION when files change
manifest.webmanifest  PWA manifest (standalone, portrait)
icons/                App icons (SVG source + PNGs)
tests/core.test.mjs   Unit tests for the simulation
```

All tuning values (speeds, radii, intervals, timings) live in `CFG` at the top of `js/core.js`. The tilt sensitivity (`TILT_RANGE`, `TILT_DEAD`) is at the top of the input section in `js/main.js`. Music styles are plain data in `GENRES` in `js/music.js`: each has a tempo, scale, chord progression, a base groove, and a list of layers (one per echo) written as 16-step patterns, so adding a new style means adding one entry there.

## Develop

```sh
python3 -m http.server 8000      # then open http://localhost:8000
node --test tests/*.test.mjs     # simulation unit tests
```

To test tilt on a phone against your local machine you need HTTPS (e.g. a tunnel such as `cloudflared` or `ngrok`). Otherwise, use the drag fallback on plain HTTP.

**Deploying updates:** bump `VERSION` in `sw.js` so installed copies pick up the new files.
