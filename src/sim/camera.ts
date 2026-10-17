import { raycastWorld } from './collision'
import { dirFromYawPitch, lerp, rightFromYaw, sub3, len3, type Vec3 } from './math'
import type { MapDef } from './types'

// The third-person camera rig lives in the simulation on purpose: shots are traced
// from the camera through the crosshair, so the server and the renderer must agree
// exactly on where the camera is. The renderer calls this same function every frame.

export const PIVOT_HEIGHT = 1.58
const HIP = { shoulder: 0.66, dist: 3.6, lift: 0.3 }
const AIM = { shoulder: 0.88, dist: 2.15, lift: 0.16 }
const WALL_MARGIN = 0.22
export const FOV_HIP = 68
export const FOV_AIM = 48

export const PITCH_MIN = -1.15
export const PITCH_MAX = 1.05

export interface CameraRig {
  pos: Vec3
  dir: Vec3
  pivot: Vec3
}

export function cameraRig(map: MapDef, playerPos: Vec3, yaw: number, pitch: number, aimBlend: number): CameraRig {
  const dir = dirFromYawPitch(yaw, pitch)
  const right = rightFromYaw(yaw)
  const pivot = { x: playerPos.x, y: playerPos.y + PIVOT_HEIGHT, z: playerPos.z }
  let shoulder = lerp(HIP.shoulder, AIM.shoulder, aimBlend)
  const dist = lerp(HIP.dist, AIM.dist, aimBlend)
  const lift = lerp(HIP.lift, AIM.lift, aimBlend)

  // Pull the shoulder offset in if a wall is right beside the player.
  const sideHit = raycastWorld(map, pivot, right, shoulder + WALL_MARGIN)
  if (sideHit) shoulder = Math.max(0, sideHit.t - WALL_MARGIN)
  const anchor = { x: pivot.x + right.x * shoulder, y: pivot.y + lift, z: pivot.z + right.z * shoulder }

  // Then pull the boom in if geometry sits between the shoulder and the camera.
  const back = { x: -dir.x, y: -dir.y, z: -dir.z }
  const boomHit = raycastWorld(map, anchor, back, dist + WALL_MARGIN)
  const boom = boomHit ? Math.max(0.15, boomHit.t - WALL_MARGIN) : dist
  const pos = { x: anchor.x + back.x * boom, y: anchor.y + back.y * boom, z: anchor.z + back.z * boom }
  if (pos.y < 0.25) pos.y = 0.25
  return { pos, dir, pivot }
}

/** Distance along the view ray at which the player's own body sits; hits closer than this are ignored. */
export function bodyDepth(rig: CameraRig): number {
  const d = sub3(rig.pivot, rig.pos)
  const along = d.x * rig.dir.x + d.y * rig.dir.y + d.z * rig.dir.z
  return Math.max(0, Math.min(along, len3(d)))
}
