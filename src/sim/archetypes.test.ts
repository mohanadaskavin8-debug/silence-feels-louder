import { describe, expect, it } from 'vitest'
import { ZOMBIES } from '../data/enemies'
import { damageZombie } from './damage'
import { pickArchetype } from './encounter'
import { emptyInput, type SimEvent, type ZombieArchetypeId } from './types'
import { SIM_DT, Simulation } from './world'
import { newZombie } from './zombie'

const P = 'p1'
const mk = (seed = 1) => {
  const sim = new Simulation({ mapId: 'dolly-block-7', encounterId: 'dolly-test', players: [{ id: P, characterId: 'ksbvndz' }], seed })
  ;(sim.encounter as { warmup: number }).warmup = 1e9
  return sim
}
const place = (sim: Simulation, archetype: ZombieArchetypeId, x: number, z: number) => {
  const zb = newZombie(sim.ctx([]), archetype, x, z, 1)
  zb.mode = 'chase'
  sim.state.zombies.push(zb)
  return zb
}
const hit = (sim: Simulation, z: ReturnType<typeof place>, opts: Partial<Parameters<typeof damageZombie>[2]> = {}, events: SimEvent[] = []) =>
  damageZombie(sim.ctx(events), z, {
    playerId: P,
    weaponId: 'ville-9',
    damage: 10,
    headshot: false,
    dir: { x: 0, y: 0, z: -1 },
    knockback: 1,
    staggerChance: 1,
    melee: false,
    pos: { ...z.pos },
    ...opts,
  })

describe('archetypes', () => {
  it('runners outpace a walking player; brutes are slow and huge', () => {
    const sim = mk()
    const r = place(sim, 'runner', 0, 0)
    const b = place(sim, 'brute', 3, 0)
    expect(r.speed).toBeGreaterThan(3.9)
    expect(b.speed).toBeLessThan(2)
    expect(b.scale).toBeGreaterThan(1.25)
    expect(b.maxHealth).toBeGreaterThan(400)
  })

  it('a runner closes distance on a walking player', () => {
    const sim = mk(3)
    const p = sim.state.players[0]
    const r = place(sim, 'runner', p.pos.x, p.pos.z - 14)
    r.attackCooldown = 99
    const start = Math.hypot(r.pos.x - p.pos.x, r.pos.z - p.pos.z)
    for (let i = 0; i < 90; i++) sim.step({ [P]: { ...emptyInput(), moveZ: -1, yaw: 0 } }) // walk away (backwards = +Z)
    expect(Math.hypot(r.pos.x - p.pos.x, r.pos.z - p.pos.z)).toBeLessThan(start - 2)
  })

  it('brutes resist staggers that always rock a regular', () => {
    const sim = mk(4)
    let regularStaggers = 0
    let bruteStaggers = 0
    for (let i = 0; i < 40; i++) {
      const r = place(sim, 'regular', 0, -5)
      r.health = 1e6
      hit(sim, r, { headshot: true })
      if (r.mode === 'stagger') regularStaggers++
      const b = place(sim, 'brute', 2, -5)
      b.health = 1e6
      hit(sim, b, { headshot: true })
      if (b.mode === 'stagger') bruteStaggers++
    }
    expect(regularStaggers).toBe(40)
    expect(bruteStaggers).toBeLessThan(15)
  })

  it('brute knockback is heavily damped', () => {
    const sim = mk()
    const r = place(sim, 'regular', 0, -5)
    const b = place(sim, 'brute', 2, -5)
    r.health = b.health = 1e6
    hit(sim, r, { knockback: 4, melee: true })
    hit(sim, b, { knockback: 4, melee: true })
    expect(Math.hypot(b.vel.x, b.vel.z)).toBeLessThan(Math.hypot(r.vel.x, r.vel.z) * 0.5)
  })
})

describe('wave mix', () => {
  it('lead spawns come first, then the weighted mix', () => {
    const sim = mk(9)
    const wave = { count: 400, maxAlive: 10, spawnInterval: 1, speedScale: 1, mix: { regular: 0.6, runner: 0.3, brute: 0.1 }, lead: ['brute' as const] }
    const ctx = sim.ctx([])
    expect(pickArchetype(ctx, wave, 0)).toBe('brute')
    const counts: Record<string, number> = { regular: 0, runner: 0, brute: 0 }
    for (let i = 1; i < 400; i++) counts[pickArchetype(ctx, wave, i)]++
    expect(counts.regular / 399).toBeGreaterThan(0.5)
    expect(counts.runner / 399).toBeGreaterThan(0.2)
    expect(counts.brute / 399).toBeGreaterThan(0.04)
    expect(counts.brute / 399).toBeLessThan(0.18)
  })

  it('the final wave of Hold Block 7 opens with a brute', () => {
    const sim = new Simulation({ mapId: 'dolly-block-7', encounterId: 'dolly-test', players: [{ id: P, characterId: 'ksbvndz' }], seed: 5 })
    const enc = sim.state.encounter
    enc.phase = 'intermission'
    enc.wave = 1
    enc.phaseTime = 1e9
    for (let i = 0; i < 200 && !sim.state.zombies.length; i++) sim.step({})
    expect(sim.state.zombies[0]?.archetype).toBe('brute')
  })
})

describe('kill credit and loot', () => {
  it('a kill pays the bounty and weapon XP (more for a headshot)', () => {
    const sim = mk()
    const p = sim.state.players[0]
    const z = place(sim, 'regular', 0, -5)
    hit(sim, z, { damage: 1000, headshot: true })
    expect(p.kills).toBe(1)
    expect(p.headshotKills).toBe(1)
    expect(p.cash).toBe(ZOMBIES.regular.bounty)
    expect(p.weaponXp['ville-9']).toBe(15)
    const z2 = place(sim, 'regular', 0, -6)
    hit(sim, z2, { damage: 1000, melee: true, weaponId: undefined })
    expect(p.weaponXp['ville-9']).toBe(15) // melee kills earn no weapon XP
  })

  it('brutes always drop cash and ammo; walking over them collects', () => {
    const sim = mk(6)
    const p = sim.state.players[0]
    p.weapons[0].reserve = 0
    const b = place(sim, 'brute', p.pos.x, p.pos.z - 3)
    const ev: SimEvent[] = []
    hit(sim, b, { damage: 1e6 }, ev)
    expect(sim.state.pickups.map((k) => k.kind).sort()).toEqual(['ammo', 'cash'])
    const cashBefore = p.cash
    const got: SimEvent[] = []
    for (let i = 0; i < 60; i++) got.push(...sim.step({ [P]: { ...emptyInput(), moveZ: 1, yaw: 0 } }))
    const kinds = got.filter((e) => e.type === 'pickup').map((e) => (e.type === 'pickup' ? e.kind : ''))
    expect(kinds.sort()).toEqual(['ammo', 'cash'])
    expect(p.cash).toBeGreaterThan(cashBefore + 50)
    expect(p.weapons[0].reserve).toBe(p.weapons[0].def.magSize)
  })

  it('a medkit stays on the ground at full health', () => {
    const sim = mk()
    const p = sim.state.players[0]
    sim.state.pickups.push({ id: 99, kind: 'medkit', amount: 35, pos: { ...p.pos }, ttl: 30 })
    sim.step({})
    expect(sim.state.pickups.length).toBe(1)
    p.health = 50
    const ev = sim.step({})
    expect(ev.find((e) => e.type === 'pickup')).toMatchObject({ kind: 'medkit', amount: 35 })
    expect(p.health).toBe(85)
  })

  it('pickups expire', () => {
    const sim = mk()
    sim.state.pickups.push({ id: 1, kind: 'cash', amount: 10, pos: { x: 30, y: 0, z: 0 }, ttl: 0.5 })
    for (let i = 0; i < Math.round(0.6 / SIM_DT); i++) sim.step({})
    expect(sim.state.pickups.length).toBe(0)
  })
})
