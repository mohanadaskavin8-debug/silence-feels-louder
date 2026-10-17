import type { WeaponDef } from '../sim/types'

// Fictional, game-balanced weapons. Names and numbers are gameplay tuning only —
// they are not real-world specifications. More categories (compact SMG, assault
// rifle, shotgun, the ARP / DRAC style entries) arrive with the Gunsmith in Milestone 3.

export const WEAPONS: Record<string, WeaponDef> = {
  'ville-9': {
    id: 'ville-9',
    name: 'Ville-9 Sidearm',
    category: 'pistol',
    damage: 34,
    headshotMultiplier: 2.25,
    fireRate: 6.5,
    automatic: false,
    pellets: 1,
    magSize: 15,
    reserveMax: 90,
    reloadTime: 1.35,
    range: 70,
    spreadHip: 0.022,
    spreadAim: 0.004,
    spreadMoving: 0.018,
    spreadPerShot: 0.012,
    spreadMax: 0.07,
    spreadRecovery: 0.11,
    recoilPitch: 0.022,
    recoilYaw: 0.006,
    knockback: 1.6,
    staggerChance: 0.35,
  },
}

export const DEFAULT_WEAPON = 'ville-9'

export const getWeapon = (id: string): WeaponDef => {
  const w = WEAPONS[id]
  if (!w) throw new Error(`Unknown weapon "${id}"`)
  return w
}
