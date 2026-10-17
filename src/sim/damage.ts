import { ZOMBIES } from '../data/enemies'
import type { SimCtx } from './context'
import { rngNext, type Vec3 } from './math'
import type { PlayerState, ZombieState } from './types'

/** After a stagger starts, further hits can't re-stagger for this long (no melee/headshot stunlock). */
export const STAGGER_IMMUNITY = 2.4

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
  if (killed) {
    z.health = 0
    z.mode = 'dead'
    z.modeTime = 0
    // A short stumble, not a slide across the courtyard.
    push(z, o, arch.knockbackScale * 0.35)
    z.deathDir = { x: o.dir.x, y: 0, z: o.dir.z }
    if (shooter) shooter.kills++
    ctx.state.encounter.totalKills++
    if (ctx.state.encounter.phase === 'wave') ctx.state.encounter.killedThisWave++
    return true
  }
  // Rising zombies finish climbing out; everything else may flinch, but not chain-flinch forever.
  // Past half its windup a swing is committed: only a headshot can still interrupt it.
  const committed = z.mode === 'attack' && z.modeTime > arch.attackWindup * 0.5 && !o.headshot
  const staggers =
    z.mode !== 'rising' && !committed && z.staggerImmune <= 0 && (o.headshot || o.melee || rngNext(ctx.state.rng) < o.staggerChance)
  if (staggers) {
    z.mode = 'stagger'
    z.modeTime = 0
    z.staggerImmune = STAGGER_IMMUNITY
  }
  // A hit that doesn't stagger only nudges: otherwise repeated shoves hold a zombie off forever.
  push(z, o, arch.knockbackScale * (staggers ? 1 : 0.25))
  return false
}

function push(z: ZombieState, o: ZombieHitOpts, scale: number) {
  z.vel.x += o.dir.x * o.knockback * scale
  z.vel.z += o.dir.z * o.knockback * scale
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
