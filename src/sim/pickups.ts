import { ZOMBIES } from '../data/enemies'
import type { SimCtx } from './context'
import { rngInt, rngNext, rngRange } from './math'
import type { PickupKind, PlayerState, ZombieState } from './types'

// Side-bag loot: some infected drop what's in their crossbody bag when they go down.
// Players walk over a drop to take it; a drop they can't use (full ammo, full health) stays put.

const COLLECT_RADIUS = 1.4
const PICKUP_TTL = 30
const MEDKIT_HEAL = 35

function spawn(ctx: SimCtx, kind: PickupKind, amount: number, x: number, z: number) {
  const s = ctx.state
  const id = s.nextPickupId++
  const pos = { x, y: 0, z }
  s.pickups.push({ id, kind, amount, pos, ttl: PICKUP_TTL })
  ctx.events.push({ type: 'pickupSpawn', pickupId: id, kind, pos: { ...pos } })
}

/** Roll the dead zombie's side bag. Brutes always carry cash and ammo. */
export function dropLoot(ctx: SimCtx, z: ZombieState) {
  const a = ZOMBIES[z.archetype]
  const rng = ctx.state.rng
  if (z.archetype === 'brute') {
    spawn(ctx, 'cash', rngInt(rng, 60, 120), z.pos.x + 0.4, z.pos.z)
    spawn(ctx, 'ammo', 1, z.pos.x - 0.4, z.pos.z)
    return
  }
  if (rngNext(rng) >= a.lootChance) return
  const r = rngNext(rng)
  const kind: PickupKind = r < 0.45 ? 'ammo' : r < 0.85 ? 'cash' : 'medkit'
  const amount = kind === 'cash' ? rngInt(rng, 10, 30) : kind === 'ammo' ? 1 : MEDKIT_HEAL
  spawn(ctx, kind, amount, z.pos.x + rngRange(rng, -0.3, 0.3), z.pos.z + rngRange(rng, -0.3, 0.3))
}

/** Apply a pickup to a player; returns what it granted, or 0 if it would be wasted (left on the ground). */
function apply(p: PlayerState, kind: PickupKind, amount: number): number {
  switch (kind) {
    case 'cash':
      p.cash += amount
      return amount
    case 'medkit': {
      if (p.health >= p.maxHealth) return 0
      const before = p.health
      p.health = Math.min(p.maxHealth, p.health + amount)
      return Math.round(p.health - before)
    }
    case 'ammo': {
      // Top up whichever slot is emptiest, by one of its magazines per pickup.
      let best = -1
      let bestRatio = 1
      p.weapons.forEach((w, i) => {
        const ratio = w.reserve / w.def.reserveMax
        if (ratio < bestRatio) {
          bestRatio = ratio
          best = i
        }
      })
      if (best < 0) return 0
      const w = p.weapons[best]
      const before = w.reserve
      w.reserve = Math.min(w.def.reserveMax, w.reserve + w.def.magSize * amount)
      return w.reserve - before
    }
  }
}

export function updatePickups(ctx: SimCtx, dt: number) {
  const s = ctx.state
  if (!s.pickups.length) return
  const keep = []
  for (const pk of s.pickups) {
    pk.ttl -= dt
    if (pk.ttl <= 0) continue
    let taken = false
    for (const p of s.players) {
      if (!p.alive) continue
      if (Math.hypot(p.pos.x - pk.pos.x, p.pos.z - pk.pos.z) > COLLECT_RADIUS) continue
      const granted = apply(p, pk.kind, pk.amount)
      if (granted > 0) {
        ctx.events.push({ type: 'pickup', playerId: p.id, kind: pk.kind, amount: granted, pos: { ...pk.pos } })
        taken = true
        break
      }
    }
    if (!taken) keep.push(pk)
  }
  s.pickups = keep
}
