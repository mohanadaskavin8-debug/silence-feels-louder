# KS BVNDZ — Silence Feels Louder

A browser-based, third-person 3D zombie survival shooter built around the *Silence Feels Louder* album.
**Current state: Milestone 1, a playable prototype.** One test zone (Dolly, Block 7), one sidearm, the Regular infected,
three waves, death and restart. Solo only. Online co-op is **not implemented yet**.

## Run it

```bash
npm install
npm run dev          # http://localhost:5180
npm test             # simulation unit tests (Vitest)
npm run build        # typecheck + production build to dist/
npm run smoke        # drives the production build in headless Chromium (run `npm run build` first)
```

Open the page, click **Deploy**, and click once more if the browser asks to capture the mouse.

| Input | Action |
|---|---|
| W A S D | Move (camera-relative) |
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
  data/     Tunable content: weapons, enemy archetypes, characters/outfits, maps and encounters.
  render/   Three.js view of the sim: procedural placeholder models, map builder, effects.
  game/     The loop (fixed-step sim + interpolated rendering), HUD store, automation hooks.
  input/    Keyboard/mouse with pointer lock, edge-latched actions, client-side recoil.
  audio/    WebAudio-synthesized SFX and a procedural placeholder score; music manifest.
  net/      GameSession seam. Only LocalSession exists today (see "Multiplayer").
  ui/       React screens and HUD.
tests/smoke.mjs   Playwright end-to-end check of the Milestone 1 definition of done.
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
