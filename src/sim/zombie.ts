import { ZOMBIES } from '../data/enemies'
import { resolveCircle, walkableLine } from './collision'
import { RISE_TIME } from './pose'
import { PLAYER_RADIUS, type SimCtx } from './context'
import { damagePlayer } from './damage'
import { approach, approachAngle, rngNext, rngRange, wrapAngle, yawFromDir } from './math'
import type { PlayerState, ZombieArchetypeId, ZombieState } from './types'

export const CORPSE_TIME = 7

const ACCEL = 10
const ATTACK_ARC = 1.25 // radians either side of facing

export function newZombie(
  ctx: SimCtx,
  archetype: ZombieArchetypeId,
  x: number,
  z: number,
  speedScale: number,
): ZombieState {
  const a = ZOMBIES[archetype]
  const rng = ctx.state.rng
  const id = ctx.state.nextZombieId++
  return {
    id,
    archetype,
    pos: { x, y: 0, z },
    vel: { x: 0, y: 0, z: 0 },
    facing: rngRange(rng, -Math.PI, Math.PI),
    health: a.health,
    maxHealth: a.health,
    speed: (a.speed + rngRange(rng, -a.speedVariance, a.speedVariance)) * speedScale,
    mode: 'rising',
    modeTime: 0,
    attackCooldown: rngRange(rng, 0, 0.4),
    attackResolved: false,
    targetId: null,
    seed: Math.floor(rngNext(rng) * 1e9),
    scale: a.scaleMin + rngNext(rng) * (a.scaleMax - a.scaleMin),
    staggerImmune: 0,
    deathDir: { x: 0, y: 0, z: 1 },
  }
}

function nearestPlayer(ctx: SimCtx, z: ZombieState): PlayerState | null {
  let best: PlayerState | null = null
  let bestD = Infinity
  for (const p of ctx.state.players) {
    if (!p.alive) continue
    const d = (p.pos.x - z.pos.x) ** 2 + (p.pos.z - z.pos.z) ** 2
    if (d < bestD) {
      bestD = d
      best = p
    }
  }
  return best
}

export function updateZombie(ctx: SimCtx, z: ZombieState, dt: number) {
  const a = ZOMBIES[z.archetype]
  z.modeTime += dt
  z.attackCooldown = Math.max(0, z.attackCooldown - dt)
  z.staggerImmune = Math.max(0, z.staggerImmune - dt)
  let desiredX = 0
  let desiredZ = 0
  let accel = ACCEL

  switch (z.mode) {
    case 'rising':
      if (z.modeTime >= RISE_TIME) setMode(z, 'chase')
      break

    case 'chase': {
      const target = nearestPlayer(ctx, z)
      z.targetId = target ? target.id : null
      if (!target) break
      const dx = target.pos.x - z.pos.x
      const dz = target.pos.z - z.pos.z
      const dist = Math.hypot(dx, dz)
      // Only swing with nothing solid in between (fences, walls): otherwise walk round.
      const reachable = dist <= a.attackRange + PLAYER_RADIUS && walkableLine(ctx.map, z.pos.x, z.pos.z, target.pos.x, target.pos.z, 0.05)
      if (reachable && z.attackCooldown <= 0) {
        setMode(z, 'attack')
        z.attackResolved = false
        ctx.events.push({ type: 'zombieAttack', zombieId: z.id, pos: { ...z.pos } })
        break
      }
      let hx = dx
      let hz = dz
      if (!reachable && !walkableLine(ctx.map, z.pos.x, z.pos.z, target.pos.x, target.pos.z, a.radius * 0.9)) {
        const field = ctx.fieldFor(target.id)
        const wp = field ? ctx.nav.nextWaypoint(field, z.pos.x, z.pos.z) : null
        if (wp) {
          hx = wp.x - z.pos.x
          hz = wp.z - z.pos.z
        }
      }
      const hl = Math.hypot(hx, hz)
      if (hl > 1e-4) {
        // Ease off just before contact so they crowd rather than overlap.
        const slow = dist < a.attackRange + PLAYER_RADIUS + 0.4 ? 0.6 : 1
        desiredX = (hx / hl) * z.speed * slow
        desiredZ = (hz / hl) * z.speed * slow
        z.facing = approachAngle(z.facing, yawFromDir(hx, hz), a.turnRate * dt)
      }
      break
    }

    case 'attack': {
      accel = 14
      const target = ctx.state.players.find((p) => p.id === z.targetId && p.alive) ?? null
      if (target && !z.attackResolved) {
        z.facing = approachAngle(z.facing, yawFromDir(target.pos.x - z.pos.x, target.pos.z - z.pos.z), a.turnRate * 0.6 * dt)
      }
      if (!z.attackResolved && z.modeTime >= a.attackWindup) {
        z.attackResolved = true
        if (target) {
          const dx = target.pos.x - z.pos.x
          const dz = target.pos.z - z.pos.z
          const dist = Math.hypot(dx, dz)
          const off = Math.abs(wrapAngle(yawFromDir(dx, dz) - z.facing))
          const clear = walkableLine(ctx.map, z.pos.x, z.pos.z, target.pos.x, target.pos.z, 0.05)
          if (dist <= a.attackRange + PLAYER_RADIUS + 0.35 && off <= ATTACK_ARC && clear) {
            damagePlayer(ctx, target, a.attackDamage, { ...z.pos })
          }
        }
      }
      if (z.modeTime >= a.attackWindup + a.attackRecovery) {
        setMode(z, 'chase')
        z.attackCooldown = a.attackCooldown
      }
      break
    }

    case 'stagger':
      accel = 7
      if (z.modeTime >= a.staggerTime) setMode(z, 'chase')
      break

    case 'dead':
      accel = 9
      break
  }

  z.vel.x = approach(z.vel.x, desiredX, accel * dt)
  z.vel.z = approach(z.vel.z, desiredZ, accel * dt)
  if (z.mode !== 'rising') {
    z.pos.x += z.vel.x * dt
    z.pos.z += z.vel.z * dt
    // Corpses keep colliding too, so a knocked-back body never ends up inside a car or wall.
    resolveCircle(ctx.map, z.pos, a.radius)
  }
}

function setMode(z: ZombieState, mode: ZombieState['mode']) {
  z.mode = mode
  z.modeTime = 0
}

/** Positional separation so crowds spread out and nobody walks through a player. */
export function separate(ctx: SimCtx) {
  const zs = ctx.state.zombies
  for (let i = 0; i < zs.length; i++) {
    const a = zs[i]
    if (a.mode === 'dead' || a.mode === 'rising') continue
    const ra = ZOMBIES[a.archetype].radius
    for (let j = i + 1; j < zs.length; j++) {
      const b = zs[j]
      if (b.mode === 'dead' || b.mode === 'rising') continue
      const rb = ZOMBIES[b.archetype].radius
      const dx = b.pos.x - a.pos.x
      const dz = b.pos.z - a.pos.z
      const min = ra + rb
      const d2 = dx * dx + dz * dz
      if (d2 >= min * min) continue
      const d = Math.sqrt(d2) || 1e-4
      const push = (min - d) * 0.5
      const nx = d2 > 1e-8 ? dx / d : 1
      const nz = d2 > 1e-8 ? dz / d : 0
      a.pos.x -= nx * push
      a.pos.z -= nz * push
      b.pos.x += nx * push
      b.pos.z += nz * push
    }
    for (const p of ctx.state.players) {
      if (!p.alive) continue
      const dx = a.pos.x - p.pos.x
      const dz = a.pos.z - p.pos.z
      const min = ra + PLAYER_RADIUS
      const d2 = dx * dx + dz * dz
      if (d2 >= min * min) continue
      const d = Math.sqrt(d2) || 1e-4
      const nx = d2 > 1e-8 ? dx / d : 1
      const nz = d2 > 1e-8 ? dz / d : 0
      const over = min - d
      // Bodies are solid: the player can't plough through a crowd, and a surround really traps.
      a.pos.x += nx * over * 0.35
      a.pos.z += nz * over * 0.35
      p.pos.x -= nx * over * 0.65
      p.pos.z -= nz * over * 0.65
      // Cancel the player's velocity into the zombie (n points from player to zombie).
      const vn = p.vel.x * nx + p.vel.z * nz
      if (vn > 0) {
        p.vel.x -= nx * vn
        p.vel.z -= nz * vn
      }
    }
  }
  for (const z of zs) if (z.mode !== 'dead') resolveCircle(ctx.map, z.pos, ZOMBIES[z.archetype].radius)
  for (const p of ctx.state.players) if (p.alive) resolveCircle(ctx.map, p.pos, PLAYER_RADIUS)
}
