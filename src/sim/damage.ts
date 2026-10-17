import { ZOMBIES } from '../data/enemies'
import type { SimCtx } from './context'
import { rngNext, type Vec3 } from './math'
import type { PlayerState, ZombieState } from './types'

export interface ZombieHitOpts {
  playerId: string
  damage: number
  headshot: boolean
  /** Unit XZ direction the blow travels (from attacker toward the zombie). */
  dir: Vec3
  knockback: number
  staggerChance: number
  melee: boolean
  pos: Vec3
}

/** Apply a hit to a zombie, crediting the attacking player. Returns true if it died. */
export function damageZombie(ctx: SimCtx, z: ZombieState, o: ZombieHitOpts): boolean {
  if (z.mode === 'dead') return false
  const arch = ZOMBIES[z.archetype]
  z.health -= o.damage
  const killed = z.health <= 0
  const shooter = ctx.state.players.find((p) => p.id === o.playerId)
  ctx.events.push({
    type: 'zombieHit',
    zombieId: z.id,
    playerId: o.playerId,
    pos: o.pos,
    damage: o.damage,
    headshot: o.headshot,
    killed,
    melee: o.melee,
  })
  const kb = o.knockback * arch.knockbackScale
  z.vel.x += o.dir.x * kb
  z.vel.z += o.dir.z * kb
  if (killed) {
    z.health = 0
    z.mode = 'dead'
    z.modeTime = 0
    z.deathDir = { x: o.dir.x, y: 0, z: o.dir.z }
    if (shooter) shooter.kills++
    ctx.state.encounter.totalKills++
    if (ctx.state.encounter.phase === 'wave') ctx.state.encounter.killedThisWave++
    return true
  }
  // Rising zombies finish climbing out; everything else may flinch.
  if (z.mode !== 'rising' && (o.headshot || o.melee || rngNext(ctx.state.rng) < o.staggerChance)) {
    z.mode = 'stagger'
    z.modeTime = 0
  }
  return false
}

/** Apply damage to a player. Returns true if it killed them. */
export function damagePlayer(ctx: SimCtx, p: PlayerState, amount: number, from: Vec3): boolean {
  if (!p.alive) return false
  p.health -= amount
  p.sinceDamage = 0
  ctx.events.push({ type: 'playerHit', playerId: p.id, damage: amount, from })
  if (p.health <= 0) {
    p.health = 0
    p.alive = false
    p.vel.x = p.vel.z = 0
    p.weapon.reloadLeft = 0
    ctx.events.push({ type: 'playerDied', playerId: p.id })
    return true
  }
  return false
}
