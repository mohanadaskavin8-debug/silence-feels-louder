import type { WeaponDef } from '../sim/types'

// Gunsmith attachments. Everything here is fictional game tuning: names describe a role,
// numbers are balance multipliers, and nothing is a real-world part or specification.

export type AttachmentSlot = 'optic' | 'muzzle' | 'barrel' | 'grip' | 'magazine' | 'stock' | 'trigger'
export const SLOTS: AttachmentSlot[] = ['optic', 'muzzle', 'barrel', 'grip', 'magazine', 'stock', 'trigger']

export type AttachmentVisual =
  | 'red-dot'
  | 'scope'
  | 'suppressor'
  | 'compensator'
  | 'long-barrel'
  | 'short-barrel'
  | 'vertical-grip'
  | 'angled-grip'
  | 'ext-mag'
  | 'drum-mag'
  | 'heavy-stock'
  | 'light-stock'
  | 'auto-kit'

/** Multipliers default to 1, additive values to 0. */
export interface StatMods {
  damage?: number
  fireRate?: number
  spreadHip?: number
  spreadAim?: number
  recoil?: number
  magSize?: number
  reloadTime?: number
  range?: number
  /** Aim FOV multiplier (optics zoom in). */
  aimZoom?: number
  /** Movement speed multiplier while this weapon is out. */
  moveSpeed?: number
  automatic?: boolean
}

export interface AttachmentDef {
  id: string
  name: string
  slot: AttachmentSlot
  fits: WeaponDef['category'][]
  /** Weapon level needed to unlock (weapon XP comes from kills with that weapon). */
  level: number
  mods: StatMods
  visual: AttachmentVisual
  desc: string
}

export const ATTACHMENTS: Record<string, AttachmentDef> = {
  'red-dot': {
    id: 'red-dot',
    name: 'Red Dot',
    slot: 'optic',
    fits: ['pistol', 'smg', 'rifle', 'shotgun'],
    level: 1,
    mods: { spreadAim: 0.85, aimZoom: 0.95 },
    visual: 'red-dot',
    desc: 'Tighter aimed shots.',
  },
  'scope-2x': {
    id: 'scope-2x',
    name: '2x Scope',
    slot: 'optic',
    fits: ['rifle'],
    level: 4,
    mods: { spreadAim: 0.65, aimZoom: 0.72, moveSpeed: 0.97 },
    visual: 'scope',
    desc: 'Zoomed, precise aim. Slower to move with.',
  },
  suppressor: {
    id: 'suppressor',
    name: 'Suppressor',
    slot: 'muzzle',
    fits: ['pistol', 'smg', 'rifle'],
    level: 3,
    mods: { recoil: 0.9, damage: 0.95 },
    visual: 'suppressor',
    desc: 'Softer recoil, slightly less damage.',
  },
  compensator: {
    id: 'compensator',
    name: 'Compensator',
    slot: 'muzzle',
    fits: ['pistol', 'smg', 'rifle'],
    level: 2,
    mods: { recoil: 0.75, spreadHip: 1.1 },
    visual: 'compensator',
    desc: 'Much less kick, looser from the hip.',
  },
  'long-barrel': {
    id: 'long-barrel',
    name: 'Long Barrel',
    slot: 'barrel',
    fits: ['smg', 'rifle', 'shotgun'],
    level: 2,
    mods: { range: 1.3, spreadAim: 0.85, moveSpeed: 0.97 },
    visual: 'long-barrel',
    desc: 'Reach and aimed accuracy.',
  },
  'short-barrel': {
    id: 'short-barrel',
    name: 'Short Barrel',
    slot: 'barrel',
    fits: ['smg', 'rifle', 'shotgun'],
    level: 3,
    mods: { spreadHip: 0.85, range: 0.8, moveSpeed: 1.02 },
    visual: 'short-barrel',
    desc: 'Better from the hip, shorter reach.',
  },
  'vertical-grip': {
    id: 'vertical-grip',
    name: 'Vertical Grip',
    slot: 'grip',
    fits: ['smg', 'rifle', 'shotgun'],
    level: 1,
    mods: { recoil: 0.8 },
    visual: 'vertical-grip',
    desc: 'Steadier under sustained fire.',
  },
  'angled-grip': {
    id: 'angled-grip',
    name: 'Angled Grip',
    slot: 'grip',
    fits: ['smg', 'rifle', 'shotgun'],
    level: 3,
    mods: { spreadHip: 0.85, recoil: 0.92 },
    visual: 'angled-grip',
    desc: 'Snappier hip fire.',
  },
  'ext-mag': {
    id: 'ext-mag',
    name: 'Extended Mag',
    slot: 'magazine',
    fits: ['pistol', 'smg', 'rifle', 'shotgun'],
    level: 2,
    mods: { magSize: 0.5, reloadTime: 1.1 },
    visual: 'ext-mag',
    desc: '+50% magazine, slightly slower reload.',
  },
  'drum-mag': {
    id: 'drum-mag',
    name: 'Drum',
    slot: 'magazine',
    fits: ['smg', 'rifle'],
    level: 5,
    mods: { magSize: 1, reloadTime: 1.35, moveSpeed: 0.95 },
    visual: 'drum-mag',
    desc: 'Double magazine. Heavy and slow to reload.',
  },
  'heavy-stock': {
    id: 'heavy-stock',
    name: 'Heavy Stock',
    slot: 'stock',
    fits: ['smg', 'rifle', 'shotgun'],
    level: 2,
    mods: { recoil: 0.8, moveSpeed: 0.96 },
    visual: 'heavy-stock',
    desc: 'Planted and steady, a little slower.',
  },
  'light-stock': {
    id: 'light-stock',
    name: 'Light Stock',
    slot: 'stock',
    fits: ['smg', 'rifle', 'shotgun'],
    level: 3,
    mods: { moveSpeed: 1.04, recoil: 1.1 },
    visual: 'light-stock',
    desc: 'Move faster, more kick.',
  },
  'auto-kit': {
    id: 'auto-kit',
    name: 'Full-Auto Kit',
    slot: 'trigger',
    fits: ['pistol'],
    level: 4,
    mods: { automatic: true, fireRate: 1.8, spreadHip: 1.6, spreadAim: 1.5, recoil: 1.5, damage: 0.85 },
    visual: 'auto-kit',
    desc: 'Fictional in-game conversion: full auto at the cost of control and ammo.',
  },
}

export type AttachmentChoice = Partial<Record<AttachmentSlot, string>>

/** Whether an attachment can go on a weapon at all (slot + category). */
export const fitsWeapon = (a: AttachmentDef, w: WeaponDef) => a.fits.includes(w.category)

/**
 * Fold attachments into a weapon's stats. Pure and deterministic, so the authoritative
 * server and the client derive identical stats from the same loadout.
 */
export function resolveWeapon(base: WeaponDef, choice: AttachmentChoice = {}): WeaponDef & { aimZoom: number; moveSpeed: number; attachments: AttachmentChoice } {
  let damage = 1
  let fireRate = 1
  let spreadHip = 1
  let spreadAim = 1
  let recoil = 1
  let mag = 0
  let reload = 1
  let range = 1
  let aimZoom = 1
  let moveSpeed = 1
  let automatic = base.automatic
  const applied: AttachmentChoice = {}
  for (const slot of SLOTS) {
    const id = choice[slot]
    if (!id) continue
    const a = ATTACHMENTS[id]
    if (!a || a.slot !== slot || !fitsWeapon(a, base)) continue
    applied[slot] = id
    const m = a.mods
    damage *= m.damage ?? 1
    fireRate *= m.fireRate ?? 1
    spreadHip *= m.spreadHip ?? 1
    spreadAim *= m.spreadAim ?? 1
    recoil *= m.recoil ?? 1
    mag += m.magSize ?? 0
    reload *= m.reloadTime ?? 1
    range *= m.range ?? 1
    aimZoom *= m.aimZoom ?? 1
    moveSpeed *= m.moveSpeed ?? 1
    if (m.automatic !== undefined) automatic = m.automatic
  }
  return {
    ...base,
    damage: base.damage * damage,
    fireRate: base.fireRate * fireRate,
    automatic,
    spreadHip: base.spreadHip * spreadHip,
    spreadAim: base.spreadAim * spreadAim,
    spreadMax: base.spreadMax * Math.max(1, spreadHip),
    recoilPitch: base.recoilPitch * recoil,
    recoilYaw: base.recoilYaw * recoil,
    magSize: Math.max(1, Math.round(base.magSize * (1 + mag))),
    reloadTime: base.reloadTime * reload,
    range: base.range * range,
    aimZoom,
    moveSpeed,
    attachments: applied,
  }
}
