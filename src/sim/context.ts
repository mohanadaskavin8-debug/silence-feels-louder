import type { NavGrid } from './nav'
import type { EncounterDef, MapDef, SimEvent, WorldState } from './types'

/** Everything a subsystem needs for one tick. Static data + mutable state + the event sink. */
export interface SimCtx {
  state: WorldState
  map: MapDef
  nav: NavGrid
  encounter: EncounterDef
  events: SimEvent[]
  /** Flow field toward a player (cached per target), or null if the player is unreachable. */
  fieldFor(playerId: string): Int32Array | null
}

export const PLAYER_RADIUS = 0.36
