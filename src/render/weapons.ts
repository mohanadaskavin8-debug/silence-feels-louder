import * as THREE from 'three'
import type { AttachmentChoice } from '../data/attachments'
import { ATTACHMENTS } from '../data/attachments'
import type { WeaponDef } from '../sim/types'

// Procedural placeholder guns. Every weapon is built along -Z (barrel forward, top +Y)
// from a handful of boxes and cylinders, with attachments added as visible parts.
// Generic silhouettes only: no real-world markings or exact reproductions.

const mats = {
  metal: new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.45, metalness: 0.7 }),
  polymer: new THREE.MeshStandardMaterial({ color: 0x222224, roughness: 0.8, metalness: 0.1 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x4a3324, roughness: 0.7, metalness: 0.05 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x0a1a12, roughness: 0.1, metalness: 0.4, emissive: 0x0b3d1c, emissiveIntensity: 0.4 }),
  accent: new THREE.MeshStandardMaterial({ color: 0x5a1a14, roughness: 0.5, metalness: 0.3 }),
}

const geos = new Map<string, THREE.BufferGeometry>()
const box = (w: number, h: number, d: number) => {
  const k = `b${w}:${h}:${d}`
  let g = geos.get(k)
  if (!g) geos.set(k, (g = new THREE.BoxGeometry(w, h, d)))
  return g
}
const cyl = (r: number, len: number) => {
  const k = `c${r}:${len}`
  let g = geos.get(k)
  if (!g) {
    g = new THREE.CylinderGeometry(r, r, len, 12)
    g.rotateX(Math.PI / 2) // along Z
    geos.set(k, g)
  }
  return g
}

function part(group: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat)
  m.position.set(x, y, z)
  m.rotation.x = rx
  m.castShadow = true
  group.add(m)
  return m
}

/** Mount points a frame describes, so attachments sit in the right place on every gun. */
interface Frame {
  /** Muzzle position at the default barrel length (z is negative = forward). */
  muzzleZ: number
  boreY: number
  /** Top rail height and centre for optics. */
  railY: number
  railZ: number
  /** Under-barrel mount for grips. */
  gripZ: number
  gripY: number
  /** Magazine well. */
  magZ: number
  magY: number
  /** Rear of the receiver for stocks. */
  rearZ: number
}

function buildFrame(g: THREE.Group, def: WeaponDef): Frame {
  switch (def.category) {
    case 'pistol':
      part(g, box(0.034, 0.042, 0.19), mats.metal, 0, 0.03, -0.06)
      part(g, box(0.03, 0.03, 0.17), mats.polymer, 0, 0, -0.05)
      part(g, box(0.03, 0.11, 0.045), mats.polymer, 0, -0.05, 0.01, -0.25)
      return { muzzleZ: -0.16, boreY: 0.03, railY: 0.058, railZ: -0.04, gripZ: -0.1, gripY: -0.02, magZ: 0.01, magY: -0.1, rearZ: 0.04 }
    case 'smg':
      part(g, box(0.05, 0.07, 0.3), mats.polymer, 0, 0.02, -0.1)
      part(g, cyl(0.013, 0.12), mats.metal, 0, 0.03, -0.31)
      part(g, box(0.034, 0.1, 0.045), mats.polymer, 0, -0.05, 0.02, -0.2)
      part(g, box(0.03, 0.14, 0.04), mats.metal, 0, -0.07, -0.1)
      return { muzzleZ: -0.37, boreY: 0.03, railY: 0.065, railZ: -0.1, gripZ: -0.2, gripY: -0.02, magZ: -0.1, magY: -0.14, rearZ: 0.05 }
    case 'shotgun':
      part(g, box(0.05, 0.075, 0.26), mats.metal, 0, 0.02, -0.02)
      part(g, cyl(0.016, 0.55), mats.metal, 0, 0.04, -0.42)
      part(g, cyl(0.013, 0.42), mats.metal, 0, 0.005, -0.36)
      part(g, box(0.05, 0.05, 0.16), mats.wood, 0, 0.005, -0.34) // pump
      part(g, box(0.034, 0.1, 0.045), mats.wood, 0, -0.05, 0.1, -0.3)
      return { muzzleZ: -0.7, boreY: 0.04, railY: 0.065, railZ: -0.04, gripZ: -0.42, gripY: -0.02, magZ: -0.2, magY: -0.02, rearZ: 0.11 }
    case 'rifle':
    default: {
      const compact = def.id === 'short-dog'
      part(g, box(0.05, 0.08, 0.36), mats.metal, 0, 0.02, -0.08)
      part(g, box(0.055, 0.06, compact ? 0.16 : 0.24), compact ? mats.wood : mats.polymer, 0, 0.03, compact ? -0.33 : -0.38)
      part(g, cyl(0.012, compact ? 0.12 : 0.24), mats.metal, 0, 0.035, compact ? -0.47 : -0.62)
      part(g, box(0.034, 0.1, 0.045), mats.polymer, 0, -0.05, 0.04, -0.25)
      // Curved magazine.
      part(g, box(0.032, 0.16, 0.05), mats.metal, 0, -0.08, -0.12, compact ? 0.35 : 0.2)
      return {
        muzzleZ: compact ? -0.53 : -0.74,
        boreY: 0.035,
        railY: 0.07,
        railZ: -0.08,
        gripZ: compact ? -0.32 : -0.38,
        gripY: 0,
        magZ: -0.12,
        magY: -0.1,
        rearZ: 0.1,
      }
    }
  }
}

/**
 * Build a weapon (default stock, barrel, magazine) plus its attachments. Returns the group and
 * a muzzle anchor that moves with barrel/muzzle attachments, for flashes and tracers.
 */
export function buildWeaponModel(def: WeaponDef, attachments: AttachmentChoice = {}): { group: THREE.Group; muzzle: THREE.Object3D } {
  const g = new THREE.Group()
  const f = buildFrame(g, def)
  let muzzleZ = f.muzzleZ
  const has = (slot: keyof AttachmentChoice) => {
    const id = attachments[slot]
    return id && ATTACHMENTS[id] && ATTACHMENTS[id].fits.includes(def.category) ? ATTACHMENTS[id].visual : null
  }

  const barrel = has('barrel')
  if (barrel === 'long-barrel') {
    part(g, cyl(0.013, 0.14), mats.metal, 0, f.boreY, muzzleZ - 0.07)
    muzzleZ -= 0.14
  } else if (barrel === 'short-barrel') {
    muzzleZ += 0.06
  }

  const muzzle = has('muzzle')
  if (muzzle === 'suppressor') {
    part(g, cyl(0.022, 0.16), mats.metal, 0, f.boreY, muzzleZ - 0.08)
    muzzleZ -= 0.16
  } else if (muzzle === 'compensator') {
    part(g, box(0.034, 0.034, 0.05), mats.metal, 0, f.boreY, muzzleZ - 0.025)
    muzzleZ -= 0.05
  }

  const optic = has('optic')
  if (optic === 'red-dot') {
    part(g, box(0.03, 0.025, 0.04), mats.metal, 0, f.railY + 0.012, f.railZ)
    part(g, box(0.024, 0.02, 0.004), mats.glass, 0, f.railY + 0.028, f.railZ - 0.018)
  } else if (optic === 'scope') {
    part(g, cyl(0.02, 0.16), mats.metal, 0, f.railY + 0.03, f.railZ)
    part(g, box(0.012, 0.02, 0.06), mats.metal, 0, f.railY + 0.008, f.railZ)
  }

  const grip = has('grip')
  if (grip === 'vertical-grip') part(g, box(0.026, 0.08, 0.03), mats.polymer, 0, f.gripY - 0.05, f.gripZ)
  else if (grip === 'angled-grip') part(g, box(0.026, 0.04, 0.07), mats.polymer, 0, f.gripY - 0.03, f.gripZ, 0.5)

  const mag = has('magazine')
  if (mag === 'ext-mag') part(g, box(0.03, 0.08, 0.04), mats.metal, 0, f.magY - 0.08, f.magZ)
  else if (mag === 'drum-mag') part(g, cyl(0.06, 0.05), mats.metal, 0, f.magY - 0.06, f.magZ).rotation.set(0, Math.PI / 2, 0)

  const stock = has('stock')
  if (def.category !== 'pistol') {
    const stockMat = def.category === 'shotgun' ? mats.wood : mats.polymer
    if (stock === 'heavy-stock') part(g, box(0.05, 0.1, 0.28), stockMat, 0, 0, f.rearZ + 0.14)
    else if (stock === 'light-stock') part(g, box(0.02, 0.06, 0.24), mats.metal, 0, 0.01, f.rearZ + 0.12)
    else if (def.id !== 'short-dog' && def.category !== 'smg') part(g, box(0.045, 0.085, 0.22), stockMat, 0, 0, f.rearZ + 0.11)
  }

  if (has('trigger') === 'auto-kit') part(g, box(0.012, 0.016, 0.016), mats.accent, 0.02, 0.04, 0.02)

  const anchor = new THREE.Object3D()
  anchor.position.set(0, f.boreY, muzzleZ)
  g.add(anchor)
  return { group: g, muzzle: anchor }
}

/** Mount a weapon in a humanoid's right hand (barrel down the forearm, along the hand's -Y). */
export function mountInHand(hand: THREE.Object3D, built: { group: THREE.Group }) {
  built.group.rotation.x = -Math.PI / 2
  built.group.position.set(0, -0.03, -0.02)
  hand.add(built.group)
}
