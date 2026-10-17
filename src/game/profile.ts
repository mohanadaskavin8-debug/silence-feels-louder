import { CHARACTERS, DEFAULT_CHARACTER } from '../data/characters'
import { DEFAULT_WEAPON, WEAPONS } from '../data/weapons'

// Persistent player profile. Lives in localStorage for the single-player build; the same
// shape moves server-side (PostgreSQL) with online co-op so progression can't be edited locally.

export type PartyMode = 'solo' | 'duo' | 'trio' | 'squad'
export type FourthMember = 'capt50' | '2tray'

export interface MissionRecord {
  clears: number
  attempts: number
  bestTime: number | null
  bestKills: number
}

export interface Profile {
  version: 1
  party: { mode: PartyMode; fourth: FourthMember }
  loadout: { weaponId: string }
  missions: Record<string, MissionRecord>
  stats: { kills: number; deaths: number; missionsPlayed: number; shotsFired: number; shotsHit: number }
}

const KEY = 'sfl:profile:v1'

export const defaultProfile = (): Profile => ({
  version: 1,
  party: { mode: 'solo', fourth: 'capt50' },
  loadout: { weaponId: DEFAULT_WEAPON },
  missions: {},
  stats: { kills: 0, deaths: 0, missionsPlayed: 0, shotsFired: 0, shotsHit: 0 },
})

/** Party composition rules from the design: the roster grows in a fixed order. */
export function partyRoster(mode: PartyMode, fourth: FourthMember): string[] {
  const base = ['ksbvndz', 'savv4x', '100otd']
  switch (mode) {
    case 'solo':
      return base.slice(0, 1)
    case 'duo':
      return base.slice(0, 2)
    case 'trio':
      return base
    case 'squad':
      return [...base, fourth]
  }
}

/** The character the local player controls. Solo is always KsBvndz. */
export const localCharacter = (p: Profile) => partyRoster(p.party.mode, p.party.fourth)[0] ?? DEFAULT_CHARACTER

function sanitize(raw: unknown): Profile {
  const d = defaultProfile()
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Partial<Profile>
  const modes: PartyMode[] = ['solo', 'duo', 'trio', 'squad']
  const party = {
    mode: modes.includes(r.party?.mode as PartyMode) ? (r.party!.mode as PartyMode) : d.party.mode,
    fourth: r.party?.fourth === '2tray' ? ('2tray' as const) : ('capt50' as const),
  }
  const weaponId = r.loadout?.weaponId && WEAPONS[r.loadout.weaponId] ? r.loadout.weaponId : d.loadout.weaponId
  const missions: Record<string, MissionRecord> = {}
  if (r.missions && typeof r.missions === 'object') {
    for (const [id, m] of Object.entries(r.missions)) {
      if (!m || typeof m !== 'object') continue
      missions[id] = {
        clears: Math.max(0, Number(m.clears) || 0),
        attempts: Math.max(0, Number(m.attempts) || 0),
        bestTime: typeof m.bestTime === 'number' && m.bestTime > 0 ? m.bestTime : null,
        bestKills: Math.max(0, Number(m.bestKills) || 0),
      }
    }
  }
  const s = r.stats ?? d.stats
  const n = (v: unknown) => Math.max(0, Number(v) || 0)
  return {
    version: 1,
    party,
    loadout: { weaponId },
    missions,
    stats: { kills: n(s.kills), deaths: n(s.deaths), missionsPlayed: n(s.missionsPlayed), shotsFired: n(s.shotsFired), shotsHit: n(s.shotsHit) },
  }
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? sanitize(JSON.parse(raw)) : defaultProfile()
  } catch {
    return defaultProfile()
  }
}

export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* storage unavailable: progress lasts for this session only */
  }
}

export interface MissionResult {
  missionId: string
  success: boolean
  /** Left before the outcome (Return to The Ville mid-mission): counts as an attempt, not a death. */
  abandoned?: boolean
  kills: number
  time: number
  shotsFired: number
  shotsHit: number
}

/** Fold a finished mission into the profile (pure; caller saves). */
export function recordMission(p: Profile, r: MissionResult): Profile {
  const prev = p.missions[r.missionId] ?? { clears: 0, attempts: 0, bestTime: null, bestKills: 0 }
  const rec: MissionRecord = {
    attempts: prev.attempts + 1,
    clears: prev.clears + (r.success ? 1 : 0),
    bestTime: r.success ? (prev.bestTime === null ? r.time : Math.min(prev.bestTime, r.time)) : prev.bestTime,
    bestKills: Math.max(prev.bestKills, r.kills),
  }
  return {
    ...p,
    missions: { ...p.missions, [r.missionId]: rec },
    stats: {
      kills: p.stats.kills + r.kills,
      deaths: p.stats.deaths + (r.success || r.abandoned ? 0 : 1),
      missionsPlayed: p.stats.missionsPlayed + 1,
      shotsFired: p.stats.shotsFired + r.shotsFired,
      shotsHit: p.stats.shotsHit + r.shotsHit,
    },
  }
}

export const isCleared = (p: Profile, missionId: string) => (p.missions[missionId]?.clears ?? 0) > 0

// Keep TS honest that every roster id exists.
for (const id of ['ksbvndz', 'savv4x', '100otd', 'capt50', '2tray']) {
  if (!CHARACTERS[id]) throw new Error(`Missing character ${id}`)
}
