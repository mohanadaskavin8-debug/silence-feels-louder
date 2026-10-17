import { clamp, type Vec3 } from './math'
import type { MapDef, Obstacle } from './types'

/** Push a circle (XZ) out of every obstacle and keep it inside the map bounds. Mutates `pos`. */
export function resolveCircle(map: MapDef, pos: Vec3, radius: number): boolean {
  let collided = false
  for (let pass = 0; pass < 3; pass++) {
    let moved = false
    for (const o of map.obstacles) {
      if (pushOutOfBox(o, pos, radius)) moved = collided = true
    }
    if (!moved) break
  }
  const bx = map.halfX - radius
  const bz = map.halfZ - radius
  if (pos.x < -bx || pos.x > bx || pos.z < -bz || pos.z > bz) {
    pos.x = clamp(pos.x, -bx, bx)
    pos.z = clamp(pos.z, -bz, bz)
    collided = true
  }
  return collided
}

function pushOutOfBox(o: Obstacle, pos: Vec3, r: number): boolean {
  const cx = clamp(pos.x, o.minX, o.maxX)
  const cz = clamp(pos.z, o.minZ, o.maxZ)
  const dx = pos.x - cx
  const dz = pos.z - cz
  const d2 = dx * dx + dz * dz
  if (d2 >= r * r) return false
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2)
    pos.x = cx + (dx / d) * r
    pos.z = cz + (dz / d) * r
    return true
  }
  // Centre is inside the box: leave by the shallowest face.
  const left = pos.x - o.minX
  const right = o.maxX - pos.x
  const top = pos.z - o.minZ
  const bottom = o.maxZ - pos.z
  const m = Math.min(left, right, top, bottom)
  if (m === left) pos.x = o.minX - r
  else if (m === right) pos.x = o.maxX + r
  else if (m === top) pos.z = o.minZ - r
  else pos.z = o.maxZ + r
  return true
}

export function circleOverlapsAny(map: MapDef, x: number, z: number, r: number): boolean {
  for (const o of map.obstacles) {
    const cx = clamp(x, o.minX, o.maxX)
    const cz = clamp(z, o.minZ, o.maxZ)
    if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return true
  }
  return false
}

export interface RayHit {
  t: number
  normal: Vec3
}

/** Ray vs an obstacle's 3D box (y from 0 to height). `dir` must be unit length. */
export function rayBox(origin: Vec3, dir: Vec3, o: Obstacle, maxT: number): RayHit | null {
  let tmin = 0
  let tmax = maxT
  let axis = -1
  let sign = 0
  const mins = [o.minX, 0, o.minZ]
  const maxs = [o.maxX, o.height, o.maxZ]
  const os = [origin.x, origin.y, origin.z]
  const ds = [dir.x, dir.y, dir.z]
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ds[i]) < 1e-12) {
      if (os[i] < mins[i] || os[i] > maxs[i]) return null
      continue
    }
    const inv = 1 / ds[i]
    let t1 = (mins[i] - os[i]) * inv
    let t2 = (maxs[i] - os[i]) * inv
    let s = -1
    if (t1 > t2) {
      const tmp = t1
      t1 = t2
      t2 = tmp
      s = 1
    }
    if (t1 > tmin) {
      tmin = t1
      axis = i
      sign = s
    }
    if (t2 < tmax) tmax = t2
    if (tmin > tmax) return null
  }
  if (axis === -1) {
    // Origin starts inside the box: report an immediate hit facing back along the ray.
    return { t: 0, normal: { x: -dir.x, y: -dir.y, z: -dir.z } }
  }
  const normal = { x: 0, y: 0, z: 0 }
  if (axis === 0) normal.x = sign
  else if (axis === 1) normal.y = sign
  else normal.z = sign
  return { t: tmin, normal }
}

/** Nearest solid-world hit (obstacles that stop bullets, plus the ground plane). */
export function raycastWorld(map: MapDef, origin: Vec3, dir: Vec3, maxT: number): RayHit | null {
  let best: RayHit | null = null
  let bestT = maxT
  for (const o of map.obstacles) {
    if (o.blocksShots === false) continue
    const h = rayBox(origin, dir, o, bestT)
    if (h && h.t < bestT) {
      best = h
      bestT = h.t
    }
  }
  if (dir.y < -1e-6) {
    const t = -origin.y / dir.y
    if (t >= 0 && t < bestT) best = { t, normal: { x: 0, y: 1, z: 0 } }
  }
  return best
}

/**
 * 2D line-of-sight for walking: true if a circle of `radius` can slide from a to b
 * without touching any obstacle (all obstacles block movement, fences included).
 */
export function walkableLine(map: MapDef, ax: number, az: number, bx: number, bz: number, radius: number): boolean {
  const dx = bx - ax
  const dz = bz - az
  for (const o of map.obstacles) {
    // Slab test against the box grown by the radius.
    let tmin = 0
    let tmax = 1
    const minX = o.minX - radius
    const maxX = o.maxX + radius
    const minZ = o.minZ - radius
    const maxZ = o.maxZ + radius
    if (Math.abs(dx) < 1e-9) {
      if (ax < minX || ax > maxX) continue
    } else {
      let t1 = (minX - ax) / dx
      let t2 = (maxX - ax) / dx
      if (t1 > t2) [t1, t2] = [t2, t1]
      tmin = Math.max(tmin, t1)
      tmax = Math.min(tmax, t2)
      if (tmin > tmax) continue
    }
    if (Math.abs(dz) < 1e-9) {
      if (az < minZ || az > maxZ) continue
    } else {
      let t1 = (minZ - az) / dz
      let t2 = (maxZ - az) / dz
      if (t1 > t2) [t1, t2] = [t2, t1]
      tmin = Math.max(tmin, t1)
      tmax = Math.min(tmax, t2)
      if (tmin > tmax) continue
    }
    return false
  }
  return true
}

/** Ray vs sphere; returns entry distance or -1. `dir` must be unit length. */
export function raySphere(origin: Vec3, dir: Vec3, c: Vec3, r: number, maxT: number): number {
  const ox = origin.x - c.x
  const oy = origin.y - c.y
  const oz = origin.z - c.z
  const b = ox * dir.x + oy * dir.y + oz * dir.z
  const cc = ox * ox + oy * oy + oz * oz - r * r
  const disc = b * b - cc
  if (disc < 0) return -1
  const s = Math.sqrt(disc)
  let t = -b - s
  if (t < 0) t = -b + s
  return t >= 0 && t <= maxT ? t : -1
}

/** Ray vs a finite vertical cylinder (axis through base, from y0 to y1). Returns entry distance or -1. */
export function rayCylinder(origin: Vec3, dir: Vec3, base: Vec3, r: number, y0: number, y1: number, maxT: number): number {
  const ox = origin.x - base.x
  const oz = origin.z - base.z
  const a = dir.x * dir.x + dir.z * dir.z
  let best = -1
  if (a > 1e-12) {
    const b = ox * dir.x + oz * dir.z
    const c = ox * ox + oz * oz - r * r
    const disc = b * b - a * c
    if (disc >= 0) {
      const s = Math.sqrt(disc)
      for (const t of [(-b - s) / a, (-b + s) / a]) {
        if (t < 0 || t > maxT) continue
        const y = origin.y + dir.y * t
        if (y >= y0 && y <= y1) {
          best = t
          break
        }
      }
    }
  }
  // End caps (shots from above/below).
  if (Math.abs(dir.y) > 1e-9) {
    for (const yc of [y0, y1]) {
      const t = (yc - origin.y) / dir.y
      if (t < 0 || t > maxT || (best >= 0 && t >= best)) continue
      const x = ox + dir.x * t
      const z = oz + dir.z * t
      if (x * x + z * z <= r * r) best = t
    }
  }
  return best
}
