import { describe, expect, it } from 'vitest'
import { emptyInput, type PlayerInput, type SimEvent } from './types'
import { SIM_DT, Simulation, type LoadoutSlot } from './world'
import { SWITCH_TIME } from './player'

const P = 'p1'
const mk = (loadout: LoadoutSlot[], seed = 1) => {
  const sim = new Simulation({ mapId: 'dolly-block-7', encounterId: 'dolly-test', players: [{ id: P, characterId: 'ksbvndz', loadout }], seed })
  ;(sim.encounter as { warmup: number }).warmup = 1e9
  return sim
}
const run = (sim: Simulation, seconds: number, input: Partial<PlayerInput> | ((t: number) => Partial<PlayerInput>) = {}) => {
  const ev: SimEvent[] = []
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) {
    const part = typeof input === 'function' ? input(i * SIM_DT) : input
    ev.push(...sim.step({ [P]: { ...emptyInput(), ...part } }))
  }
  return ev
}

describe('loadouts', () => {
  it('builds primary + sidearm with resolved attachment stats', () => {
    const sim = mk([{ id: 'northline-ar', attachments: { magazine: 'ext-mag', optic: 'red-dot' } }, { id: 'ville-9' }])
    const p = sim.state.players[0]
    expect(p.weapons.map((w) => w.def.id)).toEqual(['northline-ar', 'ville-9'])
    expect(p.weapons[0].def.magSize).toBe(45)
    expect(p.weapons[0].ammo).toBe(45)
    expect(p.weapons[0].def.aimZoom).toBeCloseTo(0.95)
    expect(p.active).toBe(0)
  })

  it('defaults to the starter pistol', () => {
    const sim = mk([])
    expect(sim.state.players[0].weapons.map((w) => w.def.id)).toEqual(['ville-9'])
  })

  it('switching takes a draw time, blocks fire meanwhile, and cancels a reload', () => {
    const sim = mk([{ id: 'block-compact' }, { id: 'ville-9' }])
    const p = sim.state.players[0]
    run(sim, 0.3, { fire: true, pitch: 0.3 }) // spend some SMG ammo
    run(sim, 0.1, { reload: true })
    expect(p.weapons[0].reloadLeft).toBeGreaterThan(0)
    const ev = run(sim, SIM_DT, { switchTo: 1 })
    expect(ev.find((e) => e.type === 'weaponSwitch')).toMatchObject({ slot: 1, weaponId: 'ville-9' })
    expect(p.active).toBe(1)
    expect(p.weapons[0].reloadLeft).toBe(0)
    const blocked = run(sim, SWITCH_TIME * 0.8, (t) => ({ fire: t < SIM_DT, pitch: 0.3 })).filter((e) => e.type === 'shot')
    expect(blocked.length).toBe(0)
    run(sim, SWITCH_TIME)
    const shots = run(sim, 0.1, { fire: true, pitch: 0.3 }).filter((e) => e.type === 'shot')
    expect(shots.length).toBe(1)
    expect(shots[0].type === 'shot' && shots[0].weaponId).toBe('ville-9')
  })

  it('cycling wraps around the slots', () => {
    const sim = mk([{ id: 'stoop-sweeper' }, { id: 'ville-9' }])
    const p = sim.state.players[0]
    run(sim, SIM_DT, { switchTo: -2 })
    expect(p.active).toBe(1)
    run(sim, SIM_DT, { switchTo: -2 })
    expect(p.active).toBe(0)
  })

  it('automatic weapons fire while held; the shotgun fires pellets', () => {
    const smg = mk([{ id: 'block-compact' }])
    const auto = run(smg, 0.5, { fire: true, pitch: 0.3 }).filter((e) => e.type === 'shot')
    expect(auto.length).toBeGreaterThanOrEqual(6)
    const sg = mk([{ id: 'stoop-sweeper' }])
    const pellets = run(sg, SIM_DT * 2, { fire: true, pitch: 0.3 }).filter((e) => e.type === 'shot')
    expect(pellets.length).toBe(9)
  })

  it('the fictional auto kit turns the pistol automatic', () => {
    const sim = mk([{ id: 'ville-9', attachments: { trigger: 'auto-kit' } }])
    const shots = run(sim, 0.5, { fire: true, pitch: 0.3 }).filter((e) => e.type === 'shot')
    expect(shots.length).toBeGreaterThanOrEqual(5)
  })

  it('wave clears refill every slot', () => {
    const sim = mk([{ id: 'block-compact' }, { id: 'ville-9' }])
    const p = sim.state.players[0]
    p.weapons[0].reserve = 0
    p.weapons[1].reserve = 0
    const enc = sim.state.encounter
    enc.phase = 'wave'
    enc.wave = 0
    enc.spawnedThisWave = sim.encounter.waves[0].count
    enc.killedThisWave = sim.encounter.waves[0].count
    run(sim, SIM_DT)
    expect(p.weapons[0].reserve).toBe(p.weapons[0].def.reserveMax)
    expect(p.weapons[1].reserve).toBe(p.weapons[1].def.reserveMax)
  })
})
