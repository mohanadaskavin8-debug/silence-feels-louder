import { ATTACHMENTS, SLOTS, fitsWeapon, type AttachmentChoice } from '../data/attachments'
import { CHARACTERS, DEFAULT_CHARACTER } from '../data/characters'
import { DEFAULT_WEAPON, WEAPONS, isSidearm } from '../data/weapons'
import type { LoadoutSlot } from '../sim/world'

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

/** A named loadout: an optional primary and a sidearm, each with its attachments. */
export interface LoadoutPreset {
  name: string
  primary: LoadoutSlot | null
  sidearm: LoadoutSlot
}

export interface Profile {
  version: 2
  party: { mode: PartyMode; fourth: FourthMember }
  cash: number
  xp: number
  /** Weapon XP by weapon id (kills with it); levels unlock attachments. */
  weaponXp: Record<string, number>
  owned: string[]
  loadouts: LoadoutPreset[]
  activeLoadout: number
  missions: Record<string, MissionRecord>
  stats: { kills: number; deaths: number; missionsPlayed: number; shotsFired: number; shotsHit: number }
}

const KEY = 'sfl:profile:v2'
const LEGACY_KEY = 'sfl:profile:v1'
export const LOADOUT_COUNT = 3

const starterLoadout = (i: number): LoadoutPreset => ({ name: `Loadout ${i + 1}`, primary: null, sidearm: { id: DEFAULT_WEAPON, attachments: {} } })

export const defaultProfile = (): Profile => ({
  version: 2,
  party: { mode: 'solo', fourth: 'capt50' },
  cash: 0,
  xp: 0,
  weaponXp: {},
  owned: [DEFAULT_WEAPON],
  loadouts: Array.from({ length: LOADOUT_COUNT }, (_, i) => starterLoadout(i)),
  activeLoadout: 0,
  missions: {},
  stats: { kills: 0, deaths: 0, missionsPlayed: 0, shotsFired: 0, shotsHit: 0 },
})

// --- progression curves -------------------------------------------------------------

/** Weapon XP needed to reach each level (index = level - 1). */
export const WEAPON_LEVELS = [0, 100, 250, 450, 700, 1000, 1400, 1900]
export const weaponLevel = (xp: number) => {
  let lvl = 1
  for (let i = 0; i < WEAPON_LEVELS.length; i++) if (xp >= WEAPON_LEVELS[i]) lvl = i + 1
  return lvl
}
/** Operator level from total XP: 1000 XP per level, gently rising. */
export const playerLevel = (xp: number) => 1 + Math.floor(Math.sqrt(xp / 500))

// --- party ------------------------------------------------------------------------

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

/** Slots in the order the simulation wants them: primary first (if any), then the sidearm. */
export function loadoutSlots(p: Profile): LoadoutSlot[] {
  const l = p.loadouts[p.activeLoadout] ?? p.loadouts[0]
  return l.primary ? [l.primary, l.sidearm] : [l.sidearm]
}

/** Attachments a weapon can use right now: exists, fits, and unlocked by weapon level. */
export function attachmentUnlocked(p: Profile, weaponId: string, attachmentId: string) {
  const a = ATTACHMENTS[attachmentId]
  const w = WEAPONS[weaponId]
  return !!a && !!w && fitsWeapon(a, w) && weaponLevel(p.weaponXp[weaponId] ?? 0) >= a.level
}

// --- persistence ------------------------------------------------------------------------

const num = (v: unknown) => Math.max(0, Number(v) || 0)

function cleanSlot(raw: unknown, owned: string[], wantSidearm: boolean): LoadoutSlot | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { id?: unknown; attachments?: unknown }
  const id = typeof r.id === 'string' ? r.id : ''
  const w = WEAPONS[id]
  if (!w || !owned.includes(id) || isSidearm(w) !== wantSidearm) return null
  const attachments: AttachmentChoice = {}
  if (r.attachments && typeof r.attachments === 'object') {
    for (const slot of SLOTS) {
      const aid = (r.attachments as Record<string, unknown>)[slot]
      if (typeof aid === 'string' && ATTACHMENTS[aid]?.slot === slot && fitsWeapon(ATTACHMENTS[aid], w)) attachments[slot] = aid
    }
  }
  return { id, attachments }
}

function sanitize(raw: unknown): Profile {
  const d = defaultProfile()
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Record<string, unknown> & Partial<Profile>
  const modes: PartyMode[] = ['solo', 'duo', 'trio', 'squad']
  const party = {
    mode: modes.includes(r.party?.mode as PartyMode) ? (r.party!.mode as PartyMode) : d.party.mode,
    fourth: r.party?.fourth === '2tray' ? ('2tray' as const) : ('capt50' as const),
  }
  const owned = Array.from(new Set([DEFAULT_WEAPON, ...(Array.isArray(r.owned) ? r.owned.filter((id): id is string => typeof id === 'string' && !!WEAPONS[id]) : [])]))
  const weaponXp: Record<string, number> = {}
  if (r.weaponXp && typeof r.weaponXp === 'object') {
    for (const [id, v] of Object.entries(r.weaponXp)) if (WEAPONS[id]) weaponXp[id] = num(v)
  }
  let loadouts: LoadoutPreset[] = d.loadouts
  if (Array.isArray(r.loadouts)) {
    loadouts = Array.from({ length: LOADOUT_COUNT }, (_, i) => {
      const l = r.loadouts![i] as Partial<LoadoutPreset> | undefined
      if (!l) return starterLoadout(i)
      return {
        name: typeof l.name === 'string' && l.name.trim() ? l.name.trim().slice(0, 24) : `Loadout ${i + 1}`,
        primary: cleanSlot(l.primary, owned, false),
        sidearm: cleanSlot(l.sidearm, owned, true) ?? { id: DEFAULT_WEAPON, attachments: {} },
      }
    })
  }
  const missions: Record<string, MissionRecord> = {}
  if (r.missions && typeof r.missions === 'object') {
    for (const [id, m] of Object.entries(r.missions)) {
      if (!m || typeof m !== 'object') continue
      missions[id] = {
        clears: num(m.clears),
        attempts: num(m.attempts),
        bestTime: typeof m.bestTime === 'number' && m.bestTime > 0 ? m.bestTime : null,
        bestKills: num(m.bestKills),
      }
    }
  }
  const s = (r.stats ?? d.stats) as Profile['stats']
  return {
    version: 2,
    party,
    cash: num(r.cash),
    xp: num(r.xp),
    weaponXp,
    owned,
    loadouts,
    activeLoadout: Number.isInteger(r.activeLoadout) && (r.activeLoadout as number) >= 0 && (r.activeLoadout as number) < LOADOUT_COUNT ? (r.activeLoadout as number) : 0,
    missions,
    stats: { kills: num(s.kills), deaths: num(s.deaths), missionsPlayed: num(s.missionsPlayed), shotsFired: num(s.shotsFired), shotsHit: num(s.shotsHit) },
  }
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY)
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

/** Exposed for tests and for importing saves. */
export const sanitizeProfile = sanitize

// --- mission results ---------------------------------------------------------------------

export interface MissionResult {
  missionId: string
  success: boolean
  /** Left before the outcome (Return to The Ville mid-mission): counts as an attempt, not a death. */
  abandoned?: boolean
  kills: number
  time: number
  shotsFired: number
  shotsHit: number
  cash?: number
  xp?: number
  weaponXp?: Record<string, number>
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
  const weaponXp = { ...p.weaponXp }
  for (const [id, v] of Object.entries(r.weaponXp ?? {})) if (WEAPONS[id]) weaponXp[id] = (weaponXp[id] ?? 0) + num(v)
  return {
    ...p,
    cash: p.cash + num(r.cash),
    xp: p.xp + num(r.xp),
    weaponXp,
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
