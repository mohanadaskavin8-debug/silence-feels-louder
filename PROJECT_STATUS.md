# Project status

_Last updated: 2026-10-17 · repo: github.com/mohanadaskavin8-debug/silence-feels-louder_

## Milestones

| # | Milestone | State |
|---|---|---|
| 1 | Playable prototype | **Done.** Verified in Chromium (see Tests). |
| 2 | The Ville hub, character/party select, loadout, mission board, deploy and return | **Done** for single player. |
| 3 | More weapons + attachments (Gunsmith), Runner/Brute, loot, rewards, unlocks | Not started |
| 4 | Vehicles (SUV first) | Not started |
| 5 | Online co-op (authoritative server) | Not started. Only the `GameSession` seam exists. |
| 6 | Content, approved character models, licensed music, deployment | Not started |

## What works

- **Title → The Ville hub.** Safe zone, weapons holstered. Walk up to a station and press E:
  - **Mission board:** five missions. *Hold Block 7* (Dolly, Horde Survival) is playable; the other four are shown as
    *In development*, with their unlock chain in place.
  - **Armory:** loadout selection. One weapon so far; fictional stat bars.
  - **Squad lobby:** Solo, Duo, Trio and Squad, with the 4th slot as Capt50 or 2Tray. Only Solo can deploy until co-op exists.
- **Missions:** deploy → three waves → mission complete (or death) → results → Retry, or Return to The Ville.
  Outcomes are saved to a local profile (attempts, clears, best time, kills, deaths).
- **Combat:**
  - Third-person, camera-relative movement with sprint and aim.
  - Semi-auto pistol with buffered clicks, spread/bloom, client recoil, reload and a melee shove.
  - Shots trace through the crosshair, and zombie hit volumes follow the drawn pose (head, body, mid-climb).
- **Infected (Regular):**
  - They climb out at the alleys and path around buildings with flow fields.
  - They need a clear line to swing, and crowds physically block the player.
  - Stagger immunity and committed swings stop stunlocking.
- **Feedback:** hit markers, damage direction, low-health vignette, wave banners, synthesized audio and a procedural score.

## Key files

`src/sim/` simulation (pure TS) · `src/game/Game.ts` loop + scene flow · `src/game/profile.ts` persistence ·
`src/data/` content (maps, missions, weapons, characters) · `src/render/` Three.js · `src/ui/` React screens/panels.

## Tests

- `npm test`: 40 Vitest tests covering sim conventions, collision, movement, weapon, AI, encounter flow, determinism,
  review regressions (pose-vs-hitbox alignment against the real Three.js model, fence, crowds, stunlock), profile and party rules.
- `npm run build && npm run smoke`: Playwright drives the production build through title → hub → board → mission
  → combat → death → retry → waves → pause → clear → return to the hub. The smoke-test numbers are measured in
  software WebGL (about 1 real fps in the cloud container), which says nothing about speed on real GPUs.
- Measured draw calls: 74 per frame with no zombies; 339 with 10 zombies.

## Known issues / limitations

- All characters and infected are primitive placeholders (no likeness). The weapon is a placeholder too.
- Audio is synthesized; no album tracks until rights are confirmed (`src/audio/music.ts`).
- Progress is stored in `localStorage` (per browser, editable). It moves server-side with co-op.
- Zombies are slower than a walking player (kiting is easy). Runner and Brute archetypes (M3) should fix the pacing.
- Each zombie is still about 26 draw calls (one per body part plus shadows). Instancing or merging per joint is a future optimization.

## Next steps

1. Milestone 3:
   - weapon roster (compact SMG, rifle, shotgun) and attachment slots in the Gunsmith
   - Runner and Brute archetypes
   - side-bag loot drops
   - cash/XP rewards and unlocks
2. Respond to the remaining Milestone 1 review findings (input/flow and visual playtest reviewers).
