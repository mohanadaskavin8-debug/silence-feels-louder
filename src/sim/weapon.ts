import { getWeapon } from '../data/weapons'
import { bodyDepth, cameraRig } from './camera'
import type { SimCtx } from './context'
import { rayCylinder, raySphere, raycastWorld } from './collision'
import { damageZombie } from './damage'
import { zombieHitVolume } from './pose'
import { forwardFromYaw, len3, madd3, norm3, rightFromYaw, rngNext, sub3, type Vec3 } from './math'
import type { PlayerInput, PlayerState, WeaponDef, WeaponState, ZombieState } from './types'

export const newWeaponState = (defId: string): WeaponState => {
  const def = getWeapon(defId)
  return { defId, ammo: def.magSize, reserve: def.reserveMax, cooldown: 0, reloadLeft: 0, bloom: 0, triggerHeld: false, buffer: 0 }
}

/** Current cone half-angle for a player's weapon (what the crosshair shows). */
export function currentSpread(p: PlayerState): number {
  const def = getWeapon(p.weapon.defId)
  const base = def.spreadHip + (def.spreadAim - def.spreadHip) * p.aimBlend
  const speed = Math.hypot(p.vel.x, p.vel.z)
  const moving = Math.min(1, speed / 4.4) * def.spreadMoving * (1 - 0.6 * p.aimBlend)
  return Math.min(def.spreadMax, base + moving + p.weapon.bloom)
}

/** World position of the muzzle, used for tracers and the muzzle line-of-sight check. */
export function muzzlePos(p: PlayerState): Vec3 {
  const f = forwardFromYaw(p.facing)
  const r = rightFromYaw(p.facing)
  // The pistol comes up to shoulder height when aimed.
  return { x: p.pos.x + f.x * 0.62 + r.x * 0.2, y: p.pos.y + 1.38 + 0.1 * p.aimBlend, z: p.pos.z + f.z * 0.62 + r.z * 0.2 }
}

export function startReload(ctx: SimCtx, p: PlayerState, def: WeaponDef): boolean {
  const w = p.weapon
  if (w.reloadLeft > 0 || w.ammo >= def.magSize || w.reserve <= 0) return false
  w.reloadLeft = def.reloadTime
  ctx.events.push({ type: 'reloadStart', playerId: p.id, duration: def.reloadTime })
  return true
}

export function updateWeapon(ctx: SimCtx, p: PlayerState, input: PlayerInput, dt: number) {
  const w = p.weapon
  const def = getWeapon(w.defId)
  w.cooldown = Math.max(0, w.cooldown - dt)
  w.bloom = Math.max(0, w.bloom - def.spreadRecovery * dt)

  if (w.reloadLeft > 0) {
    w.reloadLeft -= dt
    if (w.reloadLeft <= 0) {
      w.reloadLeft = 0
      const take = Math.min(def.magSize - w.ammo, w.reserve)
      w.ammo += take
      w.reserve -= take
      ctx.events.push({ type: 'reloadDone', playerId: p.id })
    }
  } else if (input.reload) {
    startReload(ctx, p, def)
  }

  // Semi-auto: a fresh press is queued briefly, so a click during the cycle (or the last moment of
  // a reload) fires as soon as the gun is ready instead of being silently dropped. Holding never repeats.
  const pressed = input.fire && !w.triggerHeld
  w.triggerHeld = input.fire
  w.buffer = pressed ? TRIGGER_BUFFER : Math.max(0, w.buffer - dt)
  const wants = def.automatic ? input.fire : w.buffer > 0
  if (!wants || w.reloadLeft > 0 || w.cooldown > 0) return
  w.buffer = 0

  if (w.ammo <= 0) {
    ctx.events.push({ type: 'dryFire', playerId: p.id })
    w.cooldown = 0.25
    startReload(ctx, p, def)
    return
  }

  w.ammo--
  w.cooldown = 1 / def.fireRate
  p.sinceShot = 0
  p.shotsFired++
  // Snap the body to the aim so the muzzle points where the crosshair does.
  p.facing = input.yaw
  fireShot(ctx, p, input, def)
  w.bloom = Math.min(def.spreadMax, w.bloom + def.spreadPerShot)
}

const TRIGGER_BUFFER = 0.2
/** The muzzle check only catches cover hugging the gun; beyond this the camera's view wins. */
const MUZZLE_CHECK = 1.2

interface ZombieTrace {
  t: number
  zombie: ZombieState
  headshot: boolean
}

function traceZombies(ctx: SimCtx, origin: Vec3, dir: Vec3, maxT: number): ZombieTrace | null {
  let best: ZombieTrace | null = null
  for (const z of ctx.state.zombies) {
    if (z.mode === 'dead') continue
    // Volumes follow the drawn pose: lean, scale and the climb out of the ground.
    const v = zombieHitVolume(z)
    if (v.bodyTop <= 0) continue
    const limit: number = best ? best.t : maxT
    const th: number = v.head.y > 0 ? raySphere(origin, dir, v.head, v.headRadius, limit) : -1
    const tb: number = rayCylinder(origin, dir, v.body, v.bodyRadius, 0, v.bodyTop, limit)
    if (th >= 0 && (tb < 0 || th <= tb + 0.05)) best = { t: th, zombie: z, headshot: true }
    else if (tb >= 0) best = { t: tb, zombie: z, headshot: false }
  }
  return best
}

function spreadDir(ctx: SimCtx, dir: Vec3, spread: number): Vec3 {
  if (spread <= 0) return dir
  const rng = ctx.state.rng
  const a = rngNext(rng) * Math.PI * 2
  const r = Math.sqrt(rngNext(rng)) * Math.tan(spread)
  // Orthonormal basis around dir.
  const up = Math.abs(dir.y) < 0.95 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }
  const u = norm3({ x: up.y * dir.z - up.z * dir.y, y: up.z * dir.x - up.x * dir.z, z: up.x * dir.y - up.y * dir.x })
  const v = { x: dir.y * u.z - dir.z * u.y, y: dir.z * u.x - dir.x * u.z, z: dir.x * u.y - dir.y * u.x }
  return norm3({
    x: dir.x + (u.x * Math.cos(a) + v.x * Math.sin(a)) * r,
    y: dir.y + (u.y * Math.cos(a) + v.y * Math.sin(a)) * r,
    z: dir.z + (u.z * Math.cos(a) + v.z * Math.sin(a)) * r,
  })
}

function fireShot(ctx: SimCtx, p: PlayerState, input: PlayerInput, def: WeaponDef) {
  const rig = cameraRig(ctx.map, p.pos, input.yaw, input.pitch, p.aimBlend)
  const depth = bodyDepth(rig)
  const spread = currentSpread(p)
  const muzzle = muzzlePos(p)
  let anyHit = false

  for (let pellet = 0; pellet < def.pellets; pellet++) {
    const dir = spreadDir(ctx, rig.dir, spread)
    // Start the trace level with the player's body so nothing between the camera and the player counts.
    const start = madd3(rig.pos, dir, depth)
    const world = raycastWorld(ctx.map, start, dir, def.range)
    const zt = traceZombies(ctx, start, dir, world ? world.t : def.range)
    let end: Vec3
    let hit: 'zombie' | 'world' | 'none'
    let normal: Vec3 | null = null
    if (zt) {
      end = madd3(start, dir, zt.t)
      hit = 'zombie'
    } else if (world) {
      end = madd3(start, dir, world.t)
      hit = 'world'
      normal = world.normal
    } else {
      end = madd3(start, dir, def.range)
      hit = 'none'
    }

    // The gun, not just the camera, has to see the target: cover hugging the muzzle eats the
    // bullet, and a zombie clawing at the gun takes it before anything behind it does.
    let target = zt
    const toEnd = sub3(end, muzzle)
    const dist = len3(toEnd)
    if (dist > 0.05) {
      const n = norm3(toEnd)
      const block = raycastWorld(ctx.map, muzzle, n, Math.min(dist - 0.05, MUZZLE_CHECK))
      const near = traceZombies(ctx, muzzle, n, block ? block.t : dist - 0.05)
      if (near && near.zombie !== zt?.zombie) {
        target = near
        end = madd3(muzzle, n, near.t)
        hit = 'zombie'
        normal = null
      } else if (block) {
        target = null
        end = madd3(muzzle, n, block.t)
        hit = 'world'
        normal = block.normal
      }
    }

    if (hit === 'zombie' && target) {
      anyHit = true
      const flat = norm3({ x: dir.x, y: 0, z: dir.z })
      damageZombie(ctx, target.zombie, {
        playerId: p.id,
        damage: def.damage * (target.headshot ? def.headshotMultiplier : 1),
        headshot: target.headshot,
        dir: flat,
        knockback: def.knockback,
        staggerChance: def.staggerChance,
        melee: false,
        pos: end,
      })
    }

    ctx.events.push({
      type: 'shot',
      playerId: p.id,
      weaponId: def.id,
      muzzle,
      end,
      hit,
      normal,
      recoilPitch: def.recoilPitch * (1 - 0.35 * p.aimBlend),
      recoilYaw: (rngNext(ctx.state.rng) * 2 - 1) * def.recoilYaw,
    })
  }
  if (anyHit) p.shotsHit++
}
