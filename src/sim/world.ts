import { ZOMBIES } from '../data/enemies'
import { getEncounter, getMap } from '../data/maps'
import { resolveWeapon, type AttachmentChoice } from '../data/attachments'
import { DEFAULT_WEAPON, getWeapon } from '../data/weapons'
import type { SimCtx } from './context'
import { newEncounter, updateEncounter } from './encounter'
import { updatePickups } from './pickups'
import { NavGrid } from './nav'
import { newPlayer, updatePlayer } from './player'
import { emptyInput, type EncounterDef, type MapDef, type PlayerInput, type SimEvent, type WorldState } from './types'
import { CORPSE_TIME, separate, updateZombie } from './zombie'

export const SIM_HZ = 60
export const SIM_DT = 1 / SIM_HZ

export interface LoadoutSlot {
  id: string
  attachments?: AttachmentChoice
}

export interface SimPlayerConfig {
  id: string
  characterId: string
  /** Weapon slots in order (primary, sidearm). Defaults to the starter pistol. */
  loadout?: LoadoutSlot[]
}

/** Resolve a loadout into weapon stats. Shared by client and (later) the server. */
export const resolveLoadout = (slots: LoadoutSlot[] | undefined) =>
  (slots?.length ? slots : [{ id: DEFAULT_WEAPON }]).map((s) => resolveWeapon(getWeapon(s.id), s.attachments ?? {}))

export interface SimConfig {
  mapId: string
  encounterId: string
  players: SimPlayerConfig[]
  seed: number
}

/**
 * The authoritative game simulation. Pure TypeScript: no DOM, no Three.js, so the
 * same class can run inside a Node game server for online co-op (Milestone 5).
 */
export class Simulation {
  state: WorldState
  readonly map: MapDef
  readonly nav: NavGrid
  readonly encounter: EncounterDef
  // Derived data only: each field is a pure function of its goal cell, so a sim restored
  // from a WorldState snapshot rebuilds exactly the same paths.
  private fields = new Map<string, { goal: number; field: Int32Array }>()

  constructor(readonly config: SimConfig) {
    this.map = getMap(config.mapId)
    // Copy so per-run tweaks never leak into the shared data tables.
    const enc = getEncounter(config.encounterId)
    this.encounter = { ...enc, waves: enc.waves.map((w) => ({ ...w })) }
    this.nav = new NavGrid(this.map, ZOMBIES.regular.radius)
    this.state = this.freshState(config.seed)
  }

  private freshState(seed: number): WorldState {
    const spawns = this.map.playerSpawns
    return {
      tick: 0,
      time: 0,
      rng: { state: seed | 0 },
      mapId: this.map.id,
      players: this.config.players.map((pc, i) => {
        const s = spawns[i % spawns.length]
        return newPlayer(pc.id, pc.characterId, resolveLoadout(pc.loadout), s.x, s.z, s.yaw)
      }),
      zombies: [],
      nextZombieId: 1,
      pickups: [],
      nextPickupId: 1,
      encounter: newEncounter(this.encounter.id),
    }
  }

  /** Restart the encounter from scratch (same map, same squad). */
  reset(seed = this.config.seed) {
    this.state = this.freshState(seed)
    this.fields.clear()
  }

  /** Advance one fixed tick. Missing inputs count as "no input". */
  step(inputs: Record<string, PlayerInput>, dt = SIM_DT): SimEvent[] {
    const events: SimEvent[] = []
    const ctx = this.ctx(events)
    const s = this.state
    s.tick++
    s.time += dt

    for (const p of s.players) updatePlayer(ctx, p, inputs[p.id] ?? { ...emptyInput(), yaw: p.yaw, pitch: p.pitch }, dt)
    for (const z of s.zombies) updateZombie(ctx, z, dt)
    separate(ctx)
    s.zombies = s.zombies.filter((z) => !(z.mode === 'dead' && z.modeTime > CORPSE_TIME))
    updatePickups(ctx, dt)
    updateEncounter(ctx, dt)
    return events
  }

  ctx(events: SimEvent[]): SimCtx {
    return {
      state: this.state,
      map: this.map,
      nav: this.nav,
      encounter: this.encounter,
      events,
      fieldFor: (id) => this.fieldFor(id),
    }
  }

  private fieldFor(playerId: string): Int32Array | null {
    const p = this.state.players.find((pl) => pl.id === playerId)
    if (!p) return null
    const goal = this.nav.nearestFree(p.pos.x, p.pos.z)
    if (goal < 0) return null
    const cached = this.fields.get(playerId)
    if (cached && cached.goal === goal) return cached.field
    const field = this.nav.buildField(goal)
    this.fields.set(playerId, { goal, field })
    return field
  }
}
