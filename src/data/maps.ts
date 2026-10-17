import type { EncounterDef, MapDef, Obstacle, ObstacleKind } from '../sim/types'

// Compact mission zones. Milestone 1 ships one test block in Dolly; The Ville,
// Westend, Farfaraway and Downtown follow as their own MapDefs (Milestones 2 and 6).

const box = (
  kind: ObstacleKind,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  height: number,
  extra: Partial<Obstacle> = {},
): Obstacle => ({ kind, minX, maxX, minZ, maxZ, height, ...extra })

/**
 * Dolly — Block 7. A residential courtyard ringed by low-rise blocks, with six
 * alleys the infected pour out of. Coordinates are metres; -Z is north.
 */
export const DOLLY_BLOCK_7: MapDef = {
  id: 'dolly-block-7',
  name: 'Block 7',
  district: 'Dolly',
  halfX: 36,
  halfZ: 36,
  playerSpawns: [
    { x: 0, z: 20, yaw: 0 },
    { x: -2.2, z: 21.5, yaw: 0 },
    { x: 2.2, z: 21.5, yaw: 0 },
    { x: 0, z: 23, yaw: 0 },
  ],
  zombieSpawns: [
    { x: -12, z: -34 },
    { x: 10, z: -34 },
    { x: -18, z: 34 },
    { x: 18, z: 34 },
    { x: -34, z: -4 },
    { x: 34, z: 6 },
  ],
  obstacles: [
    // north row (gaps at x -14..-10 and 8..12)
    box('building', -36, -14, -36, -28, 14, { variant: 0 }),
    box('building', -10, 8, -36, -28, 18, { variant: 1 }),
    box('building', 12, 36, -36, -28, 12, { variant: 2 }),
    // south row (gaps at x -20..-16 and 16..20)
    box('building', -36, -20, 28, 36, 12, { variant: 3 }),
    box('building', -16, 16, 28, 36, 10, { variant: 4 }),
    box('building', 20, 36, 28, 36, 16, { variant: 5 }),
    // west column (gap at z -6..-2)
    box('building', -36, -28, -28, -6, 15, { variant: 6 }),
    box('building', -36, -28, -2, 28, 11, { variant: 7 }),
    // east column (gap at z 4..8)
    box('building', 28, 36, -28, 4, 13, { variant: 8 }),
    box('building', 28, 36, 8, 28, 17, { variant: 9 }),

    // courtyard
    box('shop', -5, 5, -14, -7, 4.2),
    box('car', -18.9, -17.1, -4, 0.4, 1.45, { variant: 0 }),
    box('car', 13, 17.4, 9.5, 11.3, 1.45, { variant: 1 }),
    box('car', 7, 8.8, -22, -17.6, 1.45, { variant: 2 }),
    box('car', -24.4, -20, 20, 21.8, 1.45, { variant: 3 }),
    box('dumpster', -26.5, -24.7, -20, -19, 1.35),
    box('dumpster', 23.5, 25.3, 16, 17, 1.35),
    box('wall', -12, -4, 2, 2.5, 1.0),
    box('wall', 4, 12, 2, 2.5, 1.0),
    box('barrier', -14, -11, 10, 10.6, 0.85),
    box('barrier', 19, 19.6, -6, -3, 0.85),
    box('crate', 18, 19.6, -15, -13.4, 1.4),
    box('fence', -28, -19, 13, 13.15, 2.3, { blocksShots: false }),
  ],
  markings: [
    // parking bays along the north side
    ...Array.from({ length: 9 }, (_, i) => ({ x: -20 + i * 2.6, z: -18, w: 0.12, d: 4.6 })),
    // lane dashes down the west side
    ...Array.from({ length: 11 }, (_, i) => ({ x: -23, z: -24 + i * 4.5, w: 0.15, d: 2.2 })),
  ],
  lights: [
    { x: -20, z: -12, height: 6, color: 0xffa860, intensity: 70 },
    { x: 20, z: -12, height: 6, color: 0xffa860, intensity: 70 },
    { x: -13, z: 15, height: 6, color: 0xffa860, intensity: 64 },
    { x: 14, z: 16, height: 6, color: 0xffa860, intensity: 64 },
    { x: 0, z: -6.2, height: 3.4, color: 0xa9c8ff, intensity: 26 },
    // Alley lamps: fixtures and light pools only. Real lights stay few so every lit pixel stays cheap.
    { x: -12, z: -26.5, height: 4.5, color: 0xff8f4a, intensity: 30, dynamic: false },
    { x: 10, z: -26.5, height: 4.5, color: 0xff8f4a, intensity: 30, dynamic: false },
    { x: -33, z: -4, height: 4.5, color: 0xff8f4a, intensity: 26, dynamic: false },
    { x: 33, z: 6, height: 4.5, color: 0xff8f4a, intensity: 26, dynamic: false },
  ],
  theme: {
    fog: 0x12141a,
    fogDensity: 0.022,
    sky: 0x0b0d12,
    ground: 0x1b1c1f,
    moon: 0xa9bcdc,
    moonIntensity: 1.7,
    ambient: 0x66728f,
    ambientIntensity: 1.5,
  },
}

/**
 * The Ville — the crew's home block and the persistent safe hub. Walk between the armory,
 * the mission board and the squad lobby; nothing hostile spawns here.
 */
export const THE_VILLE: MapDef = {
  id: 'the-ville',
  name: 'The Ville',
  district: 'Home',
  halfX: 24,
  halfZ: 20,
  safe: true,
  playerSpawns: [
    { x: 0, z: 7, yaw: 0 },
    { x: -2, z: 8.5, yaw: 0 },
    { x: 2, z: 8.5, yaw: 0 },
    { x: 0, z: 10, yaw: 0 },
  ],
  zombieSpawns: [],
  obstacles: [
    // north row: armory between two blocks
    box('building', -24, -7, -20, -13, 12, { variant: 2 }),
    box('shop', -7, 7, -20, -13, 5, { label: 'ARMORY  ·  GUNSMITH' }),
    box('building', 7, 24, -20, -13, 14, { variant: 5 }),
    // south row: garage (vehicles arrive in Milestone 4) between blocks
    box('building', -24, -7, 13, 20, 10, { variant: 3 }),
    box('garage', -7, 7, 13, 20, 6, { label: 'GARAGE' }),
    box('building', 7, 24, 13, 20, 11, { variant: 0 }),
    // west and east blocks
    box('building', -24, -17, -13, 13, 11, { variant: 7 }),
    box('building', 17, 24, -13, 13, 13, { variant: 9 }),
    // the mission board on the west wall
    box('board', -17, -16.7, -3, 3, 3.2, { label: 'MISSIONS' }),
    // squad lobby benches (east)
    box('bench', 11, 14, 9.2, 9.9, 0.5),
    box('bench', 15.4, 16.1, 3, 7, 0.5),
    box('crate', 13.2, 14.2, 5.2, 6.2, 0.8),
    // plaza
    box('wall', -4, 4, -2.3, -1.7, 0.9),
    box('car', -13.6, -11.8, 6, 10.4, 1.45, { variant: 4 }),
    box('dumpster', 15.2, 17, -12.9, -11.9, 1.35),
  ],
  lights: [
    { x: -9, z: -8, height: 6, color: 0xffa860, intensity: 60 },
    { x: 9, z: -8, height: 6, color: 0xffa860, intensity: 60 },
    { x: -9, z: 9, height: 6, color: 0xffa860, intensity: 55 },
    { x: 12, z: 4, height: 3.2, color: 0xd9c7ff, intensity: 22 },
    { x: -16.45, z: 0, height: 3.7, color: 0xfff1d6, intensity: 18, pole: false },
  ],
  markings: [
    // a faded half court in the plaza
    { x: 0, z: 4, w: 12, d: 0.12 },
    { x: -6, z: 0.5, w: 0.12, d: 7 },
    { x: 6, z: 0.5, w: 0.12, d: 7 },
  ],
  stations: [
    { id: 'board', kind: 'mission-board', label: 'Mission board', x: -15.4, z: 0, radius: 2.4 },
    { id: 'armory', kind: 'armory', label: 'Armory & Gunsmith', x: 0, z: -11.4, radius: 2.4 },
    { id: 'squad', kind: 'squad', label: 'Squad lobby', x: 12.4, z: 6.6, radius: 2.6 },
  ],
  theme: {
    fog: 0x15151a,
    fogDensity: 0.018,
    sky: 0x0c0d12,
    ground: 0x1d1d20,
    moon: 0xb2c0dc,
    moonIntensity: 1.6,
    ambient: 0x6d7590,
    ambientIntensity: 1.6,
  },
}

export const MAPS: Record<string, MapDef> = {
  [DOLLY_BLOCK_7.id]: DOLLY_BLOCK_7,
  [THE_VILLE.id]: THE_VILLE,
}

export const getMap = (id: string): MapDef => {
  const m = MAPS[id]
  if (!m) throw new Error(`Unknown map "${id}"`)
  return m
}

export const ENCOUNTERS: Record<string, EncounterDef> = {
  // The hub never spawns anything.
  'hub-idle': { id: 'hub-idle', name: 'The Ville', warmup: Infinity, intermission: 0, waves: [] },
  'dolly-test': {
    id: 'dolly-test',
    name: 'Test Encounter — Hold Block 7',
    warmup: 4,
    intermission: 7,
    waves: [
      { count: 6, maxAlive: 6, spawnInterval: 1.4, speedScale: 1 },
      { count: 10, maxAlive: 8, spawnInterval: 1.1, speedScale: 1.06 },
      { count: 16, maxAlive: 10, spawnInterval: 0.85, speedScale: 1.12 },
    ],
  },
}

export const getEncounter = (id: string): EncounterDef => {
  const e = ENCOUNTERS[id]
  if (!e) throw new Error(`Unknown encounter "${id}"`)
  return e
}
