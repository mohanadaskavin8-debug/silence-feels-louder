import type { ZombieArchetype, ZombieArchetypeId } from '../sim/types'

// Milestone 1 ships the Regular infected only. Runner and Brute (Milestone 3) slot in
// here with their own stats; the sim already reads every value from this table.

export const ZOMBIES: Record<ZombieArchetypeId, ZombieArchetype> = {
  regular: {
    id: 'regular',
    name: 'Infected',
    health: 100,
    speed: 2.35,
    speedVariance: 0.45,
    turnRate: 5.5,
    radius: 0.38,
    height: 1.78,
    attackRange: 1.25,
    attackDamage: 14,
    attackWindup: 0.5,
    attackRecovery: 0.45,
    attackCooldown: 0.6,
    staggerTime: 0.4,
    knockbackScale: 1,
    score: 100,
  },
}
