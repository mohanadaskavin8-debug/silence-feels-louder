import { describe, expect, it } from 'vitest'
import { getWeapon } from '../data/weapons'
import { ZOMBIES } from '../data/enemies'
import { cameraRig } from './camera'
import { rayBox, raycastWorld, resolveCircle, walkableLine } from './collision'
import { damageZombie } from './damage'
import { dirFromYawPitch, forwardFromYaw, yawFromDir } from './math'
import { emptyInput, type PlayerInput, type SimEvent } from './types'
import { SIM_DT, Simulation } from './world'
import { newZombie } from './zombie'

const P = 'p1'
const mkSim = (seed = 1) =>
  new Simulation({ mapId: 'dolly-block-7', encounterId: 'dolly-test', players: [{ id: P, characterId: 'ksbvndz' }], seed })

const run = (sim: Simulation, seconds: number, input: Partial<PlayerInput> | ((t: number) => Partial<PlayerInput>) = {}) => {
  const events: SimEvent[] = []
  const n = Math.round(seconds / SIM_DT)
  for (let i = 0; i < n; i++) {
    const part = typeof input === 'function' ? input(i * SIM_DT) : input
    events.push(...sim.step({ [P]: { ...emptyInput(), ...part } }))
  }
  return events
}

/** Put a zombie at (x, z) in chase mode, skipping the rise animation. */
const placeZombie = (sim: Simulation, x: number, z: number) => {
  const zb = newZombie(sim.ctx([]), 'regular', x, z, 1)
  zb.mode = 'chase'
  sim.state.zombies.push(zb)
  return zb
}

/** Hold the encounter in warmup so no extra zombies spawn during a focused test. */
const freezeEncounter = (sim: Simulation) => {
  ;(sim.encounter as { warmup: number }).warmup = 1e9
}

describe('math conventions', () => {
  it('yaw 0 faces -Z and yawFromDir inverts forwardFromYaw', () => {
    const f = forwardFromYaw(0)
    expect(f.z).toBeCloseTo(-1)
    for (const yaw of [0, 0.7, -2.1, 3]) {
      const d = forwardFromYaw(yaw)
      expect(yawFromDir(d.x, d.z)).toBeCloseTo(yaw)
    }
  })
})

describe('collision', () => {
  it('pushes a circle out of a box and clamps to bounds', () => {
    const map = mkSim().map
    const pos = { x: 0, y: 0, z: -10 } // inside the corner shop (-5..5, -14..-7)
    expect(resolveCircle(map, pos, 0.4)).toBe(true)
    const inside = pos.x > -5.4 && pos.x < 5.4 && pos.z > -14.4 && pos.z < -6.6
    expect(inside).toBe(false)
    const out = { x: 100, y: 0, z: 0 }
    resolveCircle(map, out, 0.4)
    expect(out.x).toBeLessThanOrEqual(map.halfX)
  })

  it('ray hits a box face with the right normal', () => {
    const o = { kind: 'crate' as const, minX: -1, maxX: 1, minZ: -1, maxZ: 1, height: 2 }
    const h = rayBox({ x: 0, y: 1, z: 5 }, { x: 0, y: 0, z: -1 }, o, 100)
    expect(h?.t).toBeCloseTo(4)
    expect(h?.normal.z).toBe(1)
    expect(rayBox({ x: 0, y: 3, z: 5 }, { x: 0, y: 0, z: -1 }, o, 100)).toBeNull()
  })

  it('fences block walking but not bullets', () => {
    const map = mkSim().map
    // fence spans x -28..-19 at z ~13
    expect(walkableLine(map, -24, 11, -24, 15, 0.3)).toBe(false)
    const hit = raycastWorld(map, { x: -24, y: 1.2, z: 11 }, { x: 0, y: 0, z: 1 }, 3.5)
    expect(hit).toBeNull()
  })
})

describe('player movement', () => {
  it('moves camera-relative: forward at yaw 0 goes -Z, at yaw +90deg goes -X', () => {
    const sim = mkSim()
    freezeEncounter(sim)
    const start = { ...sim.state.players[0].pos }
    run(sim, 1, { moveZ: 1, yaw: 0 })
    const p = sim.state.players[0]
    expect(p.pos.z).toBeLessThan(start.z - 3)
    expect(Math.abs(p.pos.x - start.x)).toBeLessThan(0.05)

    const sim2 = mkSim()
    freezeEncounter(sim2)
    run(sim2, 1, { moveZ: 1, yaw: Math.PI / 2 })
    expect(sim2.state.players[0].pos.x).toBeLessThan(-3)
  })

  it('sprints faster than walking and aims slower', () => {
    const dist = (input: Partial<PlayerInput>) => {
      const sim = mkSim()
      freezeEncounter(sim)
      const z0 = sim.state.players[0].pos.z
      run(sim, 1, { moveZ: 1, ...input })
      return z0 - sim.state.players[0].pos.z
    }
    const walk = dist({})
    expect(dist({ sprint: true })).toBeGreaterThan(walk + 1)
    expect(dist({ aim: true })).toBeLessThan(walk - 1)
  })

  it('cannot walk through buildings', () => {
    const sim = mkSim()
    freezeEncounter(sim)
    run(sim, 6, { moveZ: -1, yaw: 0 }) // walk backwards (+Z) into the south row (z >= 28)
    expect(sim.state.players[0].pos.z).toBeLessThan(28 - 0.3)
  })
})

describe('weapon', () => {
  it('semi-auto: holding fire shoots once; releasing allows the next shot', () => {
    const sim = mkSim()
    freezeEncounter(sim)
    const shots = run(sim, 1, { fire: true }).filter((e) => e.type === 'shot')
    expect(shots.length).toBe(1)
    // Trigger is still held from above, so the first pulse is ignored; pulses at 0.2/0.4/0.6/0.8 s fire.
    const more = run(sim, 1, (t) => ({ fire: Math.floor(t / 0.1) % 2 === 0 })).filter((e) => e.type === 'shot')
    expect(more.length).toBe(4)
  })

  it('empties the magazine, dry-fires, auto-reloads from reserve', () => {
    const sim = mkSim()
    freezeEncounter(sim)
    const def = getWeapon('ville-9')
    const w = sim.state.players[0].weapons[0]
    const ev = run(sim, 6, (t) => ({ fire: Math.floor(t / 0.1) % 2 === 0, pitch: 0.3 }))
    expect(ev.filter((e) => e.type === 'shot').length).toBeGreaterThanOrEqual(def.magSize)
    expect(ev.some((e) => e.type === 'dryFire')).toBe(true)
    expect(ev.some((e) => e.type === 'reloadDone')).toBe(true)
    expect(w.ammo + w.reserve).toBeLessThan(def.magSize + def.reserveMax)
  })

  it('manual reload refills the magazine after reloadTime', () => {
    const sim = mkSim()
    freezeEncounter(sim)
    const w = sim.state.players[0].weapons[0]
    run(sim, 0.5, (t) => ({ fire: t < 0.05 || (t > 0.2 && t < 0.25), pitch: 0.3 }))
    expect(w.ammo).toBe(13)
    const ev = run(sim, 2, (t) => ({ reload: t < SIM_DT }))
    expect(ev.find((e) => e.type === 'reloadStart')).toBeTruthy()
    expect(w.ammo).toBe(15)
    expect(w.reserve).toBe(88)
  })

  it('shooting a zombie in front of the crosshair damages it; headshots do more', () => {
    const sim = mkSim(7)
    freezeEncounter(sim)
    const p = sim.state.players[0]
    const zb = placeZombie(sim, p.pos.x, p.pos.z - 9)
    zb.speed = 0
    // Aim at the body: find the pitch whose view ray crosses the zombie's chest.
    const rig = cameraRig(sim.map, p.pos, 0, 0, 1)
    const body = { x: zb.pos.x, y: 1.0, z: zb.pos.z }
    const dx = body.x - rig.pos.x
    const dy = body.y - rig.pos.y
    const dz = body.z - rig.pos.z
    const yaw = yawFromDir(dx, dz)
    const pitch = Math.atan2(dy, Math.hypot(dx, dz))
    // Let the aim blend settle first so the rig used above matches.
    run(sim, 0.5, { aim: true, yaw, pitch })
    zb.pos.x = p.pos.x
    zb.pos.z = p.pos.z - 9
    const ev = run(sim, SIM_DT * 2, { aim: true, fire: true, yaw, pitch })
    const hit = ev.find((e) => e.type === 'zombieHit')
    expect(hit && hit.type === 'zombieHit' && !hit.headshot).toBe(true)
    expect(zb.health).toBe(100 - getWeapon('ville-9').damage)
  })

  it('walls stop bullets', () => {
    const sim = mkSim()
    freezeEncounter(sim)
    const p = sim.state.players[0]
    p.pos.x = 0
    p.pos.z = -3 // just south of the corner shop (z -14..-7)
    const zb = placeZombie(sim, 0, -16) // behind the shop
    zb.speed = 0
    const ev = run(sim, 0.1, { fire: true, yaw: 0, pitch: -0.02 })
    const shot = ev.find((e) => e.type === 'shot')
    expect(shot && shot.type === 'shot' && shot.hit).toBe('world')
    expect(zb.health).toBe(ZOMBIES.regular.health)
  })
})

describe('zombie AI', () => {
  it('chases the player around a building and attacks for damage', () => {
    const sim = mkSim(3)
    freezeEncounter(sim)
    const p = sim.state.players[0]
    p.pos.x = 0
    p.pos.z = -3 // south of the shop
    const zb = placeZombie(sim, 0, -18) // north of the shop: no straight line
    expect(walkableLine(sim.map, zb.pos.x, zb.pos.z, p.pos.x, p.pos.z, 0.35)).toBe(false)
    const ev = run(sim, 14, { yaw: 0 })
    expect(ev.some((e) => e.type === 'zombieAttack')).toBe(true)
    expect(ev.some((e) => e.type === 'playerHit')).toBe(true)
    expect(p.health).toBeLessThan(100)
  })

  it('kills the player if they stand still, which fails the encounter', () => {
    const sim = mkSim(4)
    freezeEncounter(sim)
    const p = sim.state.players[0]
    placeZombie(sim, p.pos.x + 1.5, p.pos.z)
    placeZombie(sim, p.pos.x - 1.5, p.pos.z)
    const ev = run(sim, 30)
    expect(p.alive).toBe(false)
    expect(ev.some((e) => e.type === 'playerDied')).toBe(true)
    expect(ev.some((e) => e.type === 'encounterFailed')).toBe(true)
    expect(sim.state.encounter.phase).toBe('failed')
  })

  it('melee staggers and knocks back', () => {
    const sim = mkSim()
    freezeEncounter(sim)
    const p = sim.state.players[0]
    const zb = placeZombie(sim, p.pos.x, p.pos.z - 1.2)
    zb.speed = 0
    const before = zb.pos.z
    const ev = run(sim, 0.3, (t) => ({ melee: t < SIM_DT, yaw: 0 }))
    expect(ev.find((e) => e.type === 'melee')).toMatchObject({ hits: 1 })
    expect(zb.health).toBe(75)
    expect(zb.pos.z).toBeLessThan(before - 0.3)
  })
})

describe('encounter flow', () => {
  it('spawns waves, counts kills, and clears after the last wave', () => {
    const sim = mkSim(11)
    const ev: SimEvent[] = []
    // Kill everything as soon as it climbs out (through the real damage path, so
    // kills are credited) to exercise the wave state machine quickly.
    for (let i = 0; i < 60 * 240 && sim.state.encounter.phase !== 'cleared'; i++) {
      const ctx = sim.ctx(ev)
      for (const z of sim.state.zombies) {
        if (z.mode !== 'chase') continue
        damageZombie(ctx, z, {
          playerId: P,
          damage: 1000,
          headshot: true,
          dir: { x: 0, y: 0, z: 1 },
          knockback: 0,
          staggerChance: 0,
          melee: false,
          pos: { ...z.pos },
        })
      }
      ev.push(...sim.step({}))
    }
    expect(sim.state.encounter.phase).toBe('cleared')
    expect(ev.filter((e) => e.type === 'waveStart').length).toBe(3)
    expect(ev.some((e) => e.type === 'encounterCleared')).toBe(true)
    expect(sim.state.encounter.totalKills).toBe(6 + 10 + 16)
  })

  it('reset restores a fresh encounter', () => {
    const sim = mkSim()
    run(sim, 10)
    expect(sim.state.zombies.length).toBeGreaterThan(0)
    sim.reset()
    expect(sim.state.zombies.length).toBe(0)
    expect(sim.state.encounter.phase).toBe('warmup')
    expect(sim.state.players[0].health).toBe(100)
    expect(sim.state.players[0].weapons[0].ammo).toBe(15)
  })

  it('is deterministic for the same seed and inputs', () => {
    const a = mkSim(42)
    const b = mkSim(42)
    const script = (t: number) => ({ moveZ: 1, moveX: Math.sin(t), yaw: t * 0.3, fire: Math.floor(t * 4) % 2 === 0, pitch: 0.1 })
    run(a, 12, script)
    run(b, 12, script)
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state))
  })

  it('view direction helper agrees with the camera rig', () => {
    const sim = mkSim()
    const rig = cameraRig(sim.map, sim.state.players[0].pos, 0.4, 0.2, 0)
    const d = dirFromYawPitch(0.4, 0.2)
    expect(rig.dir.x).toBeCloseTo(d.x)
    expect(rig.dir.y).toBeCloseTo(d.y)
  })
})
