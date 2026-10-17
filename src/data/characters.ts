import type { CharacterDef } from '../sim/types'

// The playable cast are real artists. Every model here is a generic PLACEHOLDER:
// no facial likeness is attempted and no brand logos are used. Outfits are
// configurable so approved reference art can replace them without code changes.
//
// Party rules (Milestone 2): Solo = KsBvndz; Duo + Savv4x; Trio + 100otd;
// Squad of four adds Capt50 OR 2Tray (player's choice).

const BLACK_TECH = 0x141416 // all-black tech-fleece-style tracksuit (generic, no logo)

export const CHARACTERS: Record<string, CharacterDef> = {
  ksbvndz: {
    id: 'ksbvndz',
    name: 'KsBvndz',
    modelStatus: 'placeholder',
    maxHealth: 100,
    speedWalk: 4.4,
    speedSprint: 6.9,
    speedAim: 2.7,
    outfit: {
      skin: 0x6b4a35,
      top: 0xa8a39a,
      topAccent: 0x2a2a2d,
      bottom: 0x1d1d20,
      shoes: 0xe8e6e0,
      hood: true,
      mask: null,
      glasses: false,
      bag: 0x1a1a1c,
    },
  },
  savv4x: {
    id: 'savv4x',
    name: 'Savv4x',
    modelStatus: 'placeholder',
    maxHealth: 100,
    speedWalk: 4.4,
    speedSprint: 6.9,
    speedAim: 2.7,
    outfit: {
      skin: 0x5a3d2b,
      top: 0x3a3f46,
      topAccent: 0x9aa0a6,
      bottom: 0x2b2e33,
      shoes: 0x111113,
      hood: false,
      mask: null,
      glasses: false,
      bag: null,
    },
  },
  '100otd': {
    id: '100otd',
    name: '100otd',
    modelStatus: 'placeholder',
    maxHealth: 100,
    speedWalk: 4.4,
    speedSprint: 6.9,
    speedAim: 2.7,
    outfit: {
      skin: 0x7a553c,
      top: 0x4a4037,
      topAccent: 0xc9bba8,
      bottom: 0x24221f,
      shoes: 0x8c8378,
      hood: true,
      mask: null,
      glasses: false,
      bag: null,
    },
  },
  capt50: {
    id: 'capt50',
    name: 'Capt50',
    modelStatus: 'placeholder',
    maxHealth: 100,
    speedWalk: 4.4,
    speedSprint: 6.9,
    speedAim: 2.7,
    outfit: {
      skin: 0x5e4030,
      top: BLACK_TECH,
      topAccent: 0x2c2c30,
      bottom: BLACK_TECH,
      shoes: 0x0e0e10,
      hood: true,
      mask: 0x0b0b0c,
      glasses: true,
      bag: null,
    },
  },
  '2tray': {
    id: '2tray',
    name: '2Tray (2TrayVille)',
    modelStatus: 'placeholder',
    maxHealth: 100,
    speedWalk: 4.4,
    speedSprint: 6.9,
    speedAim: 2.7,
    outfit: {
      skin: 0x60432f,
      top: BLACK_TECH,
      topAccent: 0x2c2c30,
      bottom: BLACK_TECH,
      shoes: 0x0e0e10,
      hood: true,
      mask: 0x0b0b0c,
      glasses: true,
      bag: null,
    },
  },
}

export const DEFAULT_CHARACTER = 'ksbvndz'

export const getCharacter = (id: string): CharacterDef => {
  const c = CHARACTERS[id]
  if (!c) throw new Error(`Unknown character "${id}"`)
  return c
}
