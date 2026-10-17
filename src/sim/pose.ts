import { ZOMBIES } from '../data/enemies'
import { forwardFromYaw, type Vec3 } from './math'
import type { ZombieState } from './types'

// Hit volumes follow the pose the renderer draws. Both sides call these functions,
// so a shot at the head on screen is a shot at the head in the simulation.

export const RISE_TIME = 1.1
const RISE_DEPTH = 1.5

/** Model proportions at scale 1 (see render/models.ts): torso pivot height and pivot-to-head-centre length. */
export const TORSO_PIVOT = 1.02
export const TORSO_TO_HEAD = 0.72
export const HEAD_RADIUS = 0.15

/** Per-zombie resting lean (radians, forward), derived from the visual seed and archetype. */
export const baseLean = (seed: number, archetype: ZombieState['archetype'] = 'regular') => {
  const jitter = ((seed >> 5) % 100) / 900
  // Runners hunt bent low; brutes stand tall and lumber.
  return archetype === 'runner' ? 0.32 + jitter : archetype === 'brute' ? 0.06 + jitter * 0.5 : 0.12 + jitter
}

/** Forward torso lean the current mode calls for (radians, positive = toward facing). */
export function torsoLean(z: ZombieState): number {
  const a = ZOMBIES[z.archetype]
  switch (z.mode) {
    case 'chase':
      return baseLean(z.seed, z.archetype)
    case 'attack':
      return z.modeTime < a.attackWindup ? -0.12 : 0.38
    case 'stagger':
      return -0.32 * Math.sin(Math.min(1, z.modeTime / a.staggerTime) * Math.PI)
    default:
      return 0
  }
}

/** How far below ground the whole body sits while climbing out (0 once risen). */
export function riseOffset(z: ZombieState): number {
  if (z.mode !== 'rising') return 0
  const t = Math.min(1, z.modeTime / RISE_TIME)
  const e = 1 - (1 - t) * (1 - t)
  return -RISE_DEPTH * (1 - e)
}

export interface ZombieHitVolume {
  head: Vec3
  headRadius: number
  /** Body cylinder: base centre and top height. */
  body: Vec3
  bodyRadius: number
  bodyTop: number
}

export function zombieHitVolume(z: ZombieState): ZombieHitVolume {
  const a = ZOMBIES[z.archetype]
  const s = z.scale
  const lean = torsoLean(z)
  const f = forwardFromYaw(z.facing)
  const reach = TORSO_TO_HEAD * s * Math.sin(lean)
  const sink = riseOffset(z)
  const headY = TORSO_PIVOT * s + TORSO_TO_HEAD * s * Math.cos(lean) + sink
  return {
    head: { x: z.pos.x + f.x * reach, y: headY, z: z.pos.z + f.z * reach },
    headRadius: HEAD_RADIUS * s,
    body: { x: z.pos.x + f.x * reach * 0.45, y: 0, z: z.pos.z + f.z * reach * 0.45 },
    bodyRadius: a.radius * s,
    bodyTop: headY - HEAD_RADIUS * s * 0.7,
  }
}
