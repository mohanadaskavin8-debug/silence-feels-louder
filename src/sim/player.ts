import { getCharacter } from '../data/characters'
import { PITCH_MAX, PITCH_MIN } from './camera'
import { PLAYER_RADIUS, type SimCtx } from './context'
import { resolveCircle, walkableLine } from './collision'
import { damageZombie } from './damage'
import { approach, approachAngle, clamp, forwardFromYaw, rightFromYaw, wrapAngle, yawFromDir } from './math'
import type { PlayerInput, PlayerState, ResolvedWeapon } from './types'
import { activeWeapon, newWeaponState, updateWeapon } from './weapon'

const ACCEL = 34
const DECEL = 26
const AIM_RATE = 1 / 0.16
const REGEN_DELAY = 5
const REGEN_RATE = 9
// Cooldown is longer than stagger + attack windup, so shoving buys time but can't stunlock a zombie.
export const MELEE = { range: 1.75, arc: Math.PI / 3, damage: 25, knockback: 5.5, cooldown: 1.0 }

/** Seconds to bring a weapon up after switching. */
export const SWITCH_TIME = 0.45

export function newPlayer(id: string, characterId: string, loadout: ResolvedWeapon[], x: number, z: number, yaw: number): PlayerState {
  if (!loadout.length) throw new Error('A player needs at least one weapon')
  const c = getCharacter(characterId)
  return {
    id,
    characterId,
    pos: { x, y: 0, z },
    vel: { x: 0, y: 0, z: 0 },
    facing: yaw,
    yaw,
    pitch: 0,
    aimBlend: 0,
    sprinting: false,
    health: c.maxHealth,
    maxHealth: c.maxHealth,
    alive: true,
    weapons: loadout.map(newWeaponState),
    active: 0,
    switchLeft: 0,
    meleeCooldown: 0,
    sinceDamage: 99,
    sinceShot: 99,
    kills: 0,
    headshotKills: 0,
    shotsFired: 0,
    shotsHit: 0,
    cash: 0,
    weaponXp: {},
  }
}

export function updatePlayer(ctx: SimCtx, p: PlayerState, raw: PlayerInput, dt: number) {
  if (!p.alive) {
    p.aimBlend = approach(p.aimBlend, 0, AIM_RATE * dt)
    return
  }
  const c = getCharacter(p.characterId)
  const input = sanitize(raw)
  p.yaw = input.yaw
  p.pitch = input.pitch
  p.sinceDamage += dt
  p.sinceShot += dt
  p.meleeCooldown = Math.max(0, p.meleeCooldown - dt)
  p.switchLeft = Math.max(0, p.switchLeft - dt)
  if (input.switchTo !== -1) switchWeapon(ctx, p, input.switchTo === -2 ? (p.active + 1) % p.weapons.length : input.switchTo)

  // Aim and sprint are mutually exclusive; firing also breaks a sprint.
  const weapon = activeWeapon(p)
  const reloading = weapon.reloadLeft > 0
  const wantsAim = input.aim
  p.sprinting = input.sprint && !wantsAim && !input.fire && input.moveZ > 0.3
  p.aimBlend = approach(p.aimBlend, wantsAim ? 1 : 0, AIM_RATE * dt)

  // Camera-relative movement.
  let mx = input.moveX
  let mz = input.moveZ
  const ml = Math.hypot(mx, mz)
  if (ml > 1) {
    mx /= ml
    mz /= ml
  }
  // Combat first, from the pose the player saw last frame: firing after moving would trace the
  // shot from a camera one tick ahead of the one drawn on screen.
  if (input.melee && p.meleeCooldown <= 0 && !reloading) doMelee(ctx, p)
  updateWeapon(ctx, p, input, dt)

  const f = forwardFromYaw(p.yaw)
  const r = rightFromYaw(p.yaw)
  const speed = (wantsAim ? c.speedAim : p.sprinting ? c.speedSprint : reloading ? c.speedWalk * 0.85 : c.speedWalk) * weapon.def.moveSpeed
  const tx = (r.x * mx + f.x * mz) * speed
  const tz = (r.z * mx + f.z * mz) * speed
  const rate = ml > 0.01 ? ACCEL : DECEL
  p.vel.x = approach(p.vel.x, tx, rate * dt)
  p.vel.z = approach(p.vel.z, tz, rate * dt)

  const ex = p.pos.x + p.vel.x * dt
  const ez = p.pos.z + p.vel.z * dt
  p.pos.x = ex
  p.pos.z = ez
  if (resolveCircle(ctx.map, p.pos, PLAYER_RADIUS)) {
    // Drop only the velocity pointing into the surface, so we slide along walls. (Deriving velocity
    // from the push-out would turn any correction into a launch.)
    const cx = p.pos.x - ex
    const cz = p.pos.z - ez
    const cl = Math.hypot(cx, cz)
    if (cl > 1e-9) {
      const nx = cx / cl
      const nz = cz / cl
      const vn = p.vel.x * nx + p.vel.z * nz
      if (vn < 0) {
        p.vel.x -= nx * vn
        p.vel.z -= nz * vn
      }
    }
  }

  // Facing: square up to the camera while aiming/shooting, otherwise turn toward travel.
  const combat = p.aimBlend > 0.05 || p.sinceShot < 0.7 || input.fire
  const moveSpeed = Math.hypot(p.vel.x, p.vel.z)
  if (combat) p.facing = approachAngle(p.facing, p.yaw, 16 * dt)
  else if (moveSpeed > 0.4) p.facing = approachAngle(p.facing, yawFromDir(p.vel.x, p.vel.z), 11 * dt)

  if (p.sinceDamage > REGEN_DELAY && p.health < p.maxHealth) {
    p.health = Math.min(p.maxHealth, p.health + REGEN_RATE * dt)
  }
}

function switchWeapon(ctx: SimCtx, p: PlayerState, slot: number) {
  if (slot === p.active || slot < 0 || slot >= p.weapons.length) return
  // Swapping abandons a reload in progress (the magazine stays as it was).
  activeWeapon(p).reloadLeft = 0
  activeWeapon(p).triggerHeld = false
  p.active = slot
  p.switchLeft = SWITCH_TIME
  ctx.events.push({ type: 'weaponSwitch', playerId: p.id, slot, weaponId: activeWeapon(p).def.id })
}

function doMelee(ctx: SimCtx, p: PlayerState) {
  p.meleeCooldown = MELEE.cooldown
  p.facing = p.yaw
  p.sinceShot = 0
  let hits = 0
  for (const z of ctx.state.zombies) {
    if (z.mode === 'dead') continue
    const dx = z.pos.x - p.pos.x
    const dz = z.pos.z - p.pos.z
    const d = Math.hypot(dx, dz)
    if (d > MELEE.range + 0.4 || d < 1e-6) continue
    const ang = Math.abs(wrapAngle(yawFromDir(dx, dz) - p.facing))
    if (ang > MELEE.arc && d > 0.7) continue
    if (!walkableLine(ctx.map, p.pos.x, p.pos.z, z.pos.x, z.pos.z, 0.05)) continue
    hits++
    damageZombie(ctx, z, {
      playerId: p.id,
      damage: MELEE.damage,
      headshot: false,
      dir: { x: dx / d, y: 0, z: dz / d },
      knockback: MELEE.knockback,
      staggerChance: 1,
      melee: true,
      pos: { x: z.pos.x, y: 1.2, z: z.pos.z },
    })
  }
  ctx.events.push({ type: 'melee', playerId: p.id, hits })
}

/** Inputs arrive from the network eventually; never trust their ranges. */
function sanitize(i: PlayerInput): PlayerInput {
  const num = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? clamp(v, lo, hi) : 0)
  return {
    moveX: num(i.moveX, -1, 1),
    moveZ: num(i.moveZ, -1, 1),
    yaw: Number.isFinite(i.yaw) ? wrapAngle(i.yaw) : 0,
    pitch: num(i.pitch, PITCH_MIN, PITCH_MAX),
    sprint: !!i.sprint,
    aim: !!i.aim,
    fire: !!i.fire,
    reload: !!i.reload,
    melee: !!i.melee,
    switchTo: Number.isInteger(i.switchTo) && i.switchTo >= -2 && i.switchTo < 8 ? i.switchTo : -1,
  }
}
