// Mission catalogue. Territories are mission destinations, not open worlds: each mission
// points at a compact map + an encounter script. Only missions marked `playable` can be
// deployed to; the rest are shown on the board as in development so the roadmap is honest.

export type TerritoryId = 'dolly' | 'westend' | 'farfaraway' | 'downtown'
export type MissionType = 'district-sweep' | 'supply-run' | 'horde-survival' | 'rescue' | 'boss-hunt'

export interface TerritoryDef {
  id: TerritoryId
  name: string
  blurb: string
}

export const TERRITORIES: Record<TerritoryId, TerritoryDef> = {
  dolly: { id: 'dolly', name: 'Dolly', blurb: 'Dense residential blocks, courtyards and close quarters.' },
  westend: { id: 'westend', name: 'Westend', blurb: 'Narrow streets, shops and alleys. Supply runs.' },
  farfaraway: { id: 'farfaraway', name: 'Farfaraway', blurb: 'Rural roads, farms and isolated buildings.' },
  downtown: { id: 'downtown', name: 'Downtown', blurb: 'Parking structures, big hordes and bosses.' },
}

export const MISSION_TYPE_LABEL: Record<MissionType, string> = {
  'district-sweep': 'District Sweep',
  'supply-run': 'Supply Run',
  'horde-survival': 'Horde Survival',
  rescue: 'Rescue',
  'boss-hunt': 'Boss Hunt',
}

export interface MissionDef {
  id: string
  name: string
  territory: TerritoryId
  type: MissionType
  briefing: string
  objectives: string[]
  /** Mission ids that must be completed first. */
  requires: string[]
  replayable: boolean
  /** False until the mission's map and encounter exist. */
  playable: boolean
  mapId?: string
  encounterId?: string
}

export const MISSIONS: MissionDef[] = [
  {
    id: 'dolly-hold-block-7',
    name: 'Hold Block 7',
    territory: 'dolly',
    type: 'horde-survival',
    briefing: 'The infected are pouring out of the alleys around Block 7. Hold the courtyard until the streets go quiet.',
    objectives: ['Survive 3 waves', 'Clear every infected in the final wave'],
    requires: [],
    replayable: true,
    playable: true,
    mapId: 'dolly-block-7',
    encounterId: 'dolly-test',
  },
  {
    id: 'westend-supply-run',
    name: 'Corner Shop Run',
    territory: 'westend',
    type: 'supply-run',
    briefing: 'Grab medical supplies from three shops on the strip and make it back to the drop.',
    objectives: ['Collect 3 supply crates', 'Reach the extraction point'],
    requires: ['dolly-hold-block-7'],
    replayable: true,
    playable: false,
  },
  {
    id: 'dolly-sweep',
    name: 'Courtyard Sweep',
    territory: 'dolly',
    type: 'district-sweep',
    briefing: 'Clear the infected nests from the courtyards behind the blocks.',
    objectives: ['Destroy 4 nests', 'Clear the courtyards'],
    requires: ['dolly-hold-block-7'],
    replayable: true,
    playable: false,
  },
  {
    id: 'farfaraway-rescue',
    name: 'Out Past the Farms',
    territory: 'farfaraway',
    type: 'rescue',
    briefing: 'A crew is pinned down in a farmhouse. Get there, hold the door, get them out.',
    objectives: ['Reach the farmhouse', 'Defend survivors', 'Escort them to the truck'],
    requires: ['westend-supply-run'],
    replayable: false,
    playable: false,
  },
  {
    id: 'downtown-boss',
    name: 'Parking Structure',
    territory: 'downtown',
    type: 'boss-hunt',
    briefing: 'Something big has nested on the top deck of the parking structure.',
    objectives: ['Climb the structure', 'Kill the brute boss'],
    requires: ['farfaraway-rescue'],
    replayable: true,
    playable: false,
  },
]

export const getMission = (id: string): MissionDef => {
  const m = MISSIONS.find((x) => x.id === id)
  if (!m) throw new Error(`Unknown mission "${id}"`)
  return m
}

/** Unlocked = every prerequisite cleared at least once. */
export const isUnlocked = (m: MissionDef, cleared: (id: string) => boolean) => m.requires.every(cleared)
