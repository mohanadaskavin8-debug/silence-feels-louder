// Small, allocation-light math helpers shared by the simulation and the renderer.
// Plain objects (not THREE.Vector3) so the simulation can run on a Node server later.

export interface Vec3 {
  x: number
  y: number
  z: number
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z })
export const copy3 = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z })
export const add3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
export const sub3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
export const scale3 = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s })
export const dot3 = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z
export const len3 = (a: Vec3) => Math.hypot(a.x, a.y, a.z)
export const norm3 = (a: Vec3): Vec3 => {
  const l = len3(a)
  return l > 1e-9 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 0, z: 0 }
}
export const madd3 = (a: Vec3, d: Vec3, t: number): Vec3 => ({ x: a.x + d.x * t, y: a.y + d.y * t, z: a.z + d.z * t })

export const distXZ = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z)

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Move `current` toward `target` by at most `maxDelta`. */
export const approach = (current: number, target: number, maxDelta: number) =>
  current < target ? Math.min(current + maxDelta, target) : Math.max(current - maxDelta, target)

/** Wrap an angle to (-PI, PI]. */
export const wrapAngle = (a: number) => {
  a = (a + Math.PI) % (Math.PI * 2)
  if (a < 0) a += Math.PI * 2
  return a - Math.PI
}

/** Rotate angle `current` toward `target` by at most `maxDelta`, the short way round. */
export const approachAngle = (current: number, target: number, maxDelta: number) => {
  const d = wrapAngle(target - current)
  if (Math.abs(d) <= maxDelta) return target
  return wrapAngle(current + Math.sign(d) * maxDelta)
}

// Yaw convention (matches THREE.Object3D.rotation.y): yaw 0 faces -Z, positive yaw turns left (toward -X).
export const forwardFromYaw = (yaw: number): Vec3 => ({ x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) })
export const rightFromYaw = (yaw: number): Vec3 => ({ x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) })
export const yawFromDir = (dx: number, dz: number) => Math.atan2(-dx, -dz)
/** Unit view direction for a yaw/pitch pair (pitch > 0 looks up). */
export const dirFromYawPitch = (yaw: number, pitch: number): Vec3 => {
  const c = Math.cos(pitch)
  return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c }
}

/**
 * Deterministic PRNG (mulberry32). The state lives in the world so a server and a
 * client replaying the same inputs draw the same numbers.
 */
export interface Rng {
  state: number
}
export const rngNext = (r: Rng): number => {
  r.state = (r.state + 0x6d2b79f5) | 0
  let t = r.state
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
export const rngRange = (r: Rng, lo: number, hi: number) => lo + (hi - lo) * rngNext(r)
export const rngInt = (r: Rng, lo: number, hiInclusive: number) => Math.floor(rngRange(r, lo, hiInclusive + 1))
