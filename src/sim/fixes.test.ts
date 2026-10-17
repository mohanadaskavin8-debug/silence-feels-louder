import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { buildHumanoid, infectedOutfit } from '../render/models'
import { cameraRig } from './camera'
import { circleOverlapsAny } from './collision'
import { yawFromDir, type Vec3 } from './math'
import { riseOffset, torsoLean, zombieHitVolume } from './pose'
import { emptyInput, type PlayerInput, type SimEvent, type ZombieState } from './types'
import { SIM_DT, Simulation } from './world'
import { newZombie } from './zombie'

// Regression tests for the issues found in the Milestone 1 review.

const P = 'p1'
const mkSim = (seed = 1) => {
  const sim = new Simulation({ mapId: 'dolly-block-7', encounterId: 'dolly-test', players: [{ id: P, characterId: 'ksbvndz' }], seed })
  ;(sim.encounter as { warmup: number }).warmup = 1e9 // no wave spawns unless a test wants them
  return sim
}
const run = (sim: Simulation, seconds: number, input: Partial<PlayerInput> | ((t: number) => Partial<PlayerInput>) = {}) => {
  const events: SimEvent[] = []
  const n = Math.round(seconds / SIM_DT)
  for (let i = 0; i < n; i++) {
    const part = typeof input === 'function' ? input(i * SIM_DT) : input
    events.push(...sim.step({ [P]: { ...emptyInput(), ...part } }))
  }
  return events
}
const place = (sim: Simulation, x: number, z: number, mode: ZombieState['mode'] = 'chase') => {
  const zb = newZombie(sim.ctx([]), 'regular', x, z, 1)
  zb.mode = mode
  sim.state.zombies.push(zb)
  return zb
}
/** Yaw/pitch that put the crosshair on a world point (same fixed-point solve as the game's aim helper). */
const aimAt = (sim: Simulation, target: Vec3, aimBlend: number) => {
  const p = sim.state.players[0]
  let yaw = 0
  let pitch = 0
  for (let i = 0; i < 8; i++) {
    const rig = cameraRig(sim.map, p.pos, yaw, pitch, aimBlend)
    const dx = target.x - rig.pos.x
    const dz = target.z - rig.pos.z
    yaw = yawFromDir(dx, dz)
    pitch = Math.atan2(target.y - rig.pos.y, Math.hypot(dx, dz))
  }
  return { yaw, pitch }
}
const noSpread = (sim: Simulation) => {
  // Remove spread noise for aim-precision tests (bloom stays zero with single shots).
  const w = sim.state.players[0].weapon
  w.bloom = 0
  return w
}

describe('hit volumes match the drawn model', () => {
  it('the rendered head centre sits inside the sim head sphere for every pose', () => {
    const sim = mkSim()
    const z = place(sim, 3, -4)
    const rig = buildHumanoid({ outfit: infectedOutfit(z.seed), scale: z.scale, eyeGlow: 0x8a1c12 })
    const headMesh = rig.head.children[0] as THREE.Mesh
    const poses: [ZombieState['mode'], number][] = [
      ['chase', 0],
      ['attack', 0.2],
      ['attack', 0.7],
      ['stagger', 0.2],
      ['rising', 0.5],
    ]
    for (const [mode, t] of poses) {
      z.mode = mode
      z.modeTime = t
      z.facing = 0.9
      rig.root.position.set(z.pos.x, 0, z.pos.z)
      rig.root.rotation.y = z.facing
      rig.body.position.y = riseOffset(z)
      rig.torso.rotation.x = -torsoLean(z)
      rig.root.updateMatrixWorld(true)
      const drawn = headMesh.getWorldPosition(new THREE.Vector3())
      const v = zombieHitVolume(z)
      const err = Math.hypot(drawn.x - v.head.x, drawn.y - v.head.y, drawn.z - v.head.z)
      expect(err, `${mode}@${t}`).toBeLessThan(v.headRadius * 0.4)
    }
    rig.dispose()
  })

  it('a shot at the visible head of a leaning zombie is a headshot', () => {
    const sim = mkSim(5)
    const p = sim.state.players[0]
    const z = place(sim, p.pos.x + 0.4, p.pos.z - 7)
    z.speed = 0
    z.facing = yawFromDir(p.pos.x - z.pos.x, p.pos.z - z.pos.z)
    run(sim, 0.4, { aim: true })
    const { yaw, pitch } = aimAt(sim, zombieHitVolume(z).head, 1)
    noSpread(sim)
    const ev = run(sim, SIM_DT * 2, { aim: true, fire: true, yaw, pitch })
    const hit = ev.find((e) => e.type === 'zombieHit')
    expect(hit && hit.type === 'zombieHit' && hit.headshot).toBe(true)
  })

  it('a rising zombie can be shot where it is drawn mid-climb', () => {
    const sim = mkSim(6)
    const p = sim.state.players[0]
    const z = place(sim, p.pos.x, p.pos.z - 8, 'rising')
    z.modeTime = 0.55
    run(sim, 0.4, { aim: true })
    z.modeTime = 0.55
    const v = zombieHitVolume(z)
    expect(v.head.y).toBeGreaterThan(0.3)
    expect(v.head.y).toBeLessThan(1.5)
    const { yaw, pitch } = aimAt(sim, v.head, 1)
    noSpread(sim)
    const ev = run(sim, SIM_DT, { aim: true, fire: true, yaw, pitch })
    expect(ev.some((e) => e.type === 'zombieHit')).toBe(true)
  })
})

describe('weapon feel', () => {
  it('a semi-auto click during the cycle is queued, not dropped', () => {
    const sim = mkSim()
    // Press, release after 2 ticks, press again 3 ticks later (well inside the 0.154 s cycle).
    const ev = run(sim, 0.6, (t) => ({ fire: t < 2 * SIM_DT || (t >= 5 * SIM_DT && t < 7 * SIM_DT), pitch: 0.3 }))
    expect(ev.filter((e) => e.type === 'shot').length).toBe(2)
  })

  it('holding the trigger still fires only once', () => {
    const sim = mkSim()
    const ev = run(sim, 1, { fire: true, pitch: 0.3 })
    expect(ev.filter((e) => e.type === 'shot').length).toBe(1)
  })

  it('rapid fire builds bloom, which decays after', () => {
    const sim = mkSim()
    const w = sim.state.players[0].weapon
    run(sim, 0.8, (t) => ({ fire: Math.floor(t / (SIM_DT * 5)) % 2 === 0, pitch: 0.3 }))
    expect(w.bloom).toBeGreaterThan(0.01)
    run(sim, 1)
    expect(w.bloom).toBe(0)
  })

  it('you can shoot over a car the camera sees over', () => {
    const sim = mkSim(9)
    const p = sim.state.players[0]
    // Car spans x 13..17.4, z 9.5..11.3, 1.45 m tall. Stand south of it, zombie north of it.
    p.pos.x = 15.2
    p.pos.z = 12.4
    const z = place(sim, 15.2, 5)
    z.speed = 0
    z.facing = 0
    run(sim, 0.4, { aim: true })
    const target = zombieHitVolume(z).head
    const { yaw, pitch } = aimAt(sim, target, 1)
    noSpread(sim)
    const ev = run(sim, SIM_DT, { aim: true, fire: true, yaw, pitch })
    const shot = ev.find((e) => e.type === 'shot')
    expect(shot && shot.type === 'shot' && shot.hit).toBe('zombie')
  })

  it('a zombie clawing at the gun takes the bullet before one behind it', () => {
    const sim = mkSim(10)
    const p = sim.state.players[0]
    const far = place(sim, p.pos.x + 0.6, p.pos.z - 9)
    far.speed = 0
    const near = place(sim, p.pos.x + 0.35, p.pos.z - 0.9)
    near.speed = 0
    near.attackCooldown = 99
    const { yaw, pitch } = aimAt(sim, zombieHitVolume(far).head, 0)
    noSpread(sim)
    const ev = run(sim, SIM_DT, { fire: true, yaw, pitch })
    const hit = ev.find((e) => e.type === 'zombieHit')
    expect(hit && hit.type === 'zombieHit' && hit.zombieId).toBe(near.id)
  })
})

describe('zombie threat', () => {
  it('melee spam cannot stunlock a zombie: it still lands hits', () => {
    const sim = mkSim(12)
    const p = sim.state.players[0]
    const z = place(sim, p.pos.x, p.pos.z - 1.1)
    z.health = 1e6
    const ev = run(sim, 8, (t) => ({ melee: Math.floor(t / SIM_DT) % 6 === 0, yaw: 0 }))
    expect(ev.filter((e) => e.type === 'melee').length).toBeGreaterThan(5)
    expect(ev.some((e) => e.type === 'playerHit')).toBe(true)
  })

  it('zombies cannot hit through the fence; they walk round it', () => {
    const sim = mkSim(13)
    const p = sim.state.players[0]
    p.pos.x = -24
    p.pos.z = 14.2 // just south of the fence (z 13..13.15)
    const z = place(sim, -24, 12.2) // just north of it
    let hitWhileBlocked = false
    for (let i = 0; i < 60 * 12; i++) {
      const ev = sim.step({ [P]: { ...emptyInput(), yaw: 0 } })
      if (ev.some((e) => e.type === 'playerHit') && z.pos.z < 13) hitWhileBlocked = true
    }
    expect(hitWhileBlocked).toBe(false)
    expect(p.health).toBeLessThan(100) // it found the way round
  })

  it('a surround slows the player to a crawl', () => {
    const sim = mkSim(14)
    const p = sim.state.players[0]
    const ring = 8
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * Math.PI * 2
      const z = place(sim, p.pos.x + Math.cos(a) * 0.8, p.pos.z + Math.sin(a) * 0.8)
      z.attackCooldown = 99
      z.health = 1e6
    }
    const start = { ...p.pos }
    run(sim, 1, { moveZ: 1, yaw: 0 })
    const moved = Math.hypot(p.pos.x - start.x, p.pos.z - start.z)
    expect(moved).toBeLessThan(2.2) // free walking covers ~4.2 m
  })

  it('melee-killed corpses never end up inside geometry', () => {
    const sim = mkSim(15)
    const p = sim.state.players[0]
    // Shop wall at z = -7 (shop spans z -14..-7). Stand south of it, zombie between player and wall.
    p.pos.x = 0
    p.pos.z = -4.6
    const z = place(sim, 0, -6.2)
    z.health = 10
    run(sim, 2, (t) => ({ melee: t < SIM_DT, yaw: 0 }))
    expect(z.mode).toBe('dead')
    expect(circleOverlapsAny(sim.map, z.pos.x, z.pos.z, 0.3)).toBe(false)
  })

  it('a wall push-out never launches the player', () => {
    const sim = mkSim()
    const p = sim.state.players[0]
    p.pos.x = 0
    p.pos.z = -7.2 // overlapping the shop's south face
    run(sim, SIM_DT, { moveZ: 1, yaw: 0 })
    expect(Math.hypot(p.vel.x, p.vel.z)).toBeLessThan(5)
  })
})
