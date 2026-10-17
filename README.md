# KS BVNDZ — Silence Feels Louder

A browser-based, third-person 3D zombie survival shooter built around the *Silence Feels Louder* album.
**Current state: Milestones 1–2.** Start in **The Ville**, the safe hub: use the mission board, the armory loadout and
the squad lobby. Then deploy to **Dolly · Block 7** (three waves of the Regular infected) and return with your results
saved. Solo only. Online co-op is **not implemented yet**. See [PROJECT_STATUS.md](PROJECT_STATUS.md).

## Run it

```bash
npm install
npm run dev          # http://localhost:5180
npm test             # simulation unit tests (Vitest)
npm run build        # typecheck + production build to dist/
npm run smoke        # drives the production build in headless Chromium (run `npm run build` first)
```

Open the page, click **Enter The Ville**, and click once more if the browser asks to capture the mouse. Walk to a
glowing ring and press **E** to use a station. The mission board deploys you into a mission.

| Input | Action |
|---|---|
| W A S D | Move (camera-relative) |
| E | Use a station (The Ville) |
| Mouse | Look |
| Left click / Right click | Fire / Aim (hold) |
| Shift | Sprint |
| R | Reload |
| V (or Q) | Melee shove |
| Esc / P | Pause |
| M | Mute |

## Architecture

```
src/
  sim/      Authoritative game simulation: pure TypeScript, no DOM or Three.js.
            world.ts (Simulation, fixed 60 Hz step), player.ts, weapon.ts, zombie.ts,
            encounter.ts (waves), nav.ts (flow-field pathfinding), collision.ts,
            camera.ts (the third-person rig, shared so shots go exactly through the crosshair).
  data/     Tunable content: weapons, enemy archetypes, characters/outfits, maps (Dolly Block 7, The Ville),
            encounters and the mission catalogue.
  render/   Three.js view of the sim: procedural placeholder models, map builder, effects.
  game/     The loop (fixed-step sim + interpolated rendering), scene flow (hub ⇄ missions), HUD store,
            persistent profile (profile.ts), automation hooks.
  input/    Keyboard/mouse with pointer lock, edge-latched actions, client-side recoil.
  audio/    WebAudio-synthesized SFX and a procedural placeholder score; music manifest.
  net/      GameSession seam. Only LocalSession exists today (see "Multiplayer").
  ui/       React screens and HUD.
tests/smoke.mjs   Playwright end-to-end run: title → hub → mission board → combat → death/retry → clear → hub.
```

Key decisions:

- **Simulation split from rendering.** The sim is deterministic for a given seed and inputs, so the same
  `Simulation` class can run in a Node/Colyseus server for server-authoritative co-op (Milestone 5).
- **Plain Three.js plus React for UI**, not React Three Fiber: an imperative render loop is simpler and faster for a shooter.
- **No physics engine.** Arcade collision (circles vs axis-aligned boxes) and ray casts are custom and dependency-free.
- **Zero downloads for content.** Models, textures and audio are generated at runtime, so the build is about 200 kB gzipped.

## Placeholders to replace

- **Characters** (KsBvndz, Savv4x, 100otd, Capt50, 2Tray) are generic primitive figures. No likeness is attempted.
  Outfits live in `src/data/characters.ts`. Swap in approved models once reference images and likeness permission exist.
- **Infected** use the signature look (dark tech-fleece-style tracksuit, ski mask, crossbody bag) as generic,
  logo-free primitives (`src/render/models.ts`).
- **Weapons** are fictional and game-balanced (`src/data/weapons.ts`). They are not real-world specifications.
- **Audio** is synthesized in the browser. Approved album tracks go in `src/audio/music.ts` once usage rights are confirmed.

## Multiplayer

Not implemented. The game talks to a `GameSession` (`src/net/session.ts`). An `OnlineSession` backed by an
authoritative server running the same `Simulation` is the Milestone 5 plan. Nothing in the UI claims online play.
