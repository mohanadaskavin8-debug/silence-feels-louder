import { describe, expect, it } from 'vitest'
import { ATTACHMENTS, SLOTS, resolveWeapon } from './attachments'
import { getWeapon } from './weapons'

describe('attachments', () => {
  const pistol = getWeapon('ville-9')

  it('no attachments leaves the weapon unchanged', () => {
    const r = resolveWeapon(pistol)
    expect(r.damage).toBe(pistol.damage)
    expect(r.magSize).toBe(pistol.magSize)
    expect(r.automatic).toBe(false)
    expect(r.aimZoom).toBe(1)
    expect(r.moveSpeed).toBe(1)
  })

  it('applies multipliers and additive magazine bonuses', () => {
    const r = resolveWeapon(pistol, { muzzle: 'compensator', magazine: 'ext-mag' })
    expect(r.recoilPitch).toBeCloseTo(pistol.recoilPitch * 0.75)
    expect(r.spreadHip).toBeCloseTo(pistol.spreadHip * 1.1)
    expect(r.magSize).toBe(Math.round(pistol.magSize * 1.5))
    expect(r.reloadTime).toBeCloseTo(pistol.reloadTime * 1.1)
    expect(r.attachments).toEqual({ muzzle: 'compensator', magazine: 'ext-mag' })
  })

  it('the fictional auto kit makes the pistol automatic with heavy trade-offs', () => {
    const r = resolveWeapon(pistol, { trigger: 'auto-kit' })
    expect(r.automatic).toBe(true)
    expect(r.fireRate).toBeGreaterThan(pistol.fireRate)
    expect(r.recoilPitch).toBeGreaterThan(pistol.recoilPitch)
    expect(r.spreadHip).toBeGreaterThan(pistol.spreadHip)
    expect(r.damage).toBeLessThan(pistol.damage)
  })

  it('ignores attachments that do not fit the weapon or the slot', () => {
    // 2x scope is rifle-only; vertical grip has no pistol mount; red-dot is not a muzzle.
    const r = resolveWeapon(pistol, { optic: 'scope-2x', grip: 'vertical-grip', muzzle: 'red-dot' })
    expect(r.attachments).toEqual({})
    expect(r.spreadAim).toBe(pistol.spreadAim)
  })

  it('every attachment is internally consistent', () => {
    for (const a of Object.values(ATTACHMENTS)) {
      expect(SLOTS).toContain(a.slot)
      expect(a.fits.length).toBeGreaterThan(0)
      expect(a.level).toBeGreaterThanOrEqual(1)
      for (const v of Object.values(a.mods)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true)
    }
  })
})
