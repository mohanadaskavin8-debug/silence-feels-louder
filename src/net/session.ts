import type { PlayerInput, SimEvent, WorldState } from '../sim/types'
import { Simulation, type SimConfig } from '../sim/world'

/**
 * ONLINE CO-OP IS NOT IMPLEMENTED YET (Milestone 5).
 *
 * The game talks to a GameSession, never to the Simulation directly. Today the only
 * implementation is LocalSession (single player, simulation in the browser). The
 * planned OnlineSession sends inputs to an authoritative Node/Colyseus server that
 * runs the same Simulation class and replicates WorldState snapshots back.
 */
export const ONLINE_MULTIPLAYER_AVAILABLE = false

export interface GameSession {
  readonly kind: 'local' | 'online'
  readonly localPlayerId: string
  readonly state: WorldState
  /** Advance one fixed tick with the local player's input; returns what happened. */
  step(input: PlayerInput): SimEvent[]
  reset(): void
  readonly sim: Simulation
}

export class LocalSession implements GameSession {
  readonly kind = 'local' as const
  readonly sim: Simulation

  constructor(
    config: SimConfig,
    readonly localPlayerId: string,
  ) {
    this.sim = new Simulation(config)
  }

  get state() {
    return this.sim.state
  }

  step(input: PlayerInput): SimEvent[] {
    return this.sim.step({ [this.localPlayerId]: input })
  }

  reset() {
    // A new seed each run so restarts don't replay identical spawns.
    this.sim.reset((Math.random() * 2 ** 31) | 0)
  }
}
