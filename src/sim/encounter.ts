import { circleOverlapsAny } from './collision'
import type { SimCtx } from './context'
import { rngInt, rngRange } from './math'
import type { EncounterState, WaveDef, ZombieArchetypeId } from './types'
import { newZombie } from './zombie'

const MIN_SPAWN_DIST = 13

export const newEncounter = (defId: string): EncounterState => ({
  defId,
  phase: 'warmup',
  wave: 0,
  phaseTime: 0,
  spawnedThisWave: 0,
  killedThisWave: 0,
  spawnTimer: 0,
  totalKills: 0,
  elapsed: 0,
})

export const aliveZombies = (ctx: SimCtx) => ctx.state.zombies.reduce((n, z) => (z.mode === 'dead' ? n : n + 1), 0)

export function updateEncounter(ctx: SimCtx, dt: number) {
  const e = ctx.state.encounter
  const def = ctx.encounter
  if (e.phase === 'cleared' || e.phase === 'failed') return
  e.phaseTime += dt
  e.elapsed += dt

  if (ctx.state.players.length > 0 && ctx.state.players.every((p) => !p.alive)) {
    e.phase = 'failed'
    e.phaseTime = 0
    ctx.events.push({ type: 'encounterFailed' })
    return
  }

  switch (e.phase) {
    case 'warmup':
      if (e.phaseTime >= def.warmup) startWave(ctx, 0)
      break
    case 'intermission':
      if (e.phaseTime >= def.intermission) startWave(ctx, e.wave + 1)
      break
    case 'wave': {
      const wave = def.waves[e.wave]
      e.spawnTimer -= dt
      if (e.spawnedThisWave < wave.count && e.spawnTimer <= 0 && aliveZombies(ctx) < wave.maxAlive) {
        if (spawnZombie(ctx, wave.speedScale, pickArchetype(ctx, wave, e.spawnedThisWave))) e.spawnedThisWave++
        e.spawnTimer = wave.spawnInterval
      }
      if (e.killedThisWave >= wave.count) {
        ctx.events.push({ type: 'waveCleared', wave: e.wave })
        // Resupply between waves: refill reserve ammo on every slot.
        for (const p of ctx.state.players) {
          if (p.alive) for (const w of p.weapons) w.reserve = w.def.reserveMax
        }
        if (e.wave >= def.waves.length - 1) {
          e.phase = 'cleared'
          e.phaseTime = 0
          ctx.events.push({ type: 'encounterCleared' })
        } else {
          e.phase = 'intermission'
          e.phaseTime = 0
        }
      }
      break
    }
  }
}

function startWave(ctx: SimCtx, index: number) {
  const e = ctx.state.encounter
  e.phase = 'wave'
  e.wave = index
  e.phaseTime = 0
  e.spawnedThisWave = 0
  e.killedThisWave = 0
  e.spawnTimer = 0
  ctx.events.push({ type: 'waveStart', wave: index, total: ctx.encounter.waves.length })
}

/** Lead spawns first, then a weighted draw from the wave's mix (deterministic via the world RNG). */
export function pickArchetype(ctx: SimCtx, wave: WaveDef, index: number): ZombieArchetypeId {
  if (wave.lead && index < wave.lead.length) return wave.lead[index]
  const mix = Object.entries(wave.mix ?? { regular: 1 }) as [ZombieArchetypeId, number][]
  const total = mix.reduce((t, [, w]) => t + Math.max(0, w), 0)
  if (total <= 0) return 'regular'
  let r = rngRange(ctx.state.rng, 0, total)
  for (const [id, w] of mix) {
    r -= Math.max(0, w)
    if (r <= 0) return id
  }
  return mix[mix.length - 1][0]
}

/** Spawn at an alley that is not on top of a player. Returns false if nowhere is valid. */
export function spawnZombie(ctx: SimCtx, speedScale: number, archetype: ZombieArchetypeId = 'regular'): boolean {
  const pts = ctx.map.zombieSpawns
  const players = ctx.state.players.filter((p) => p.alive)
  const minDist = (x: number, z: number) =>
    players.reduce((m, p) => Math.min(m, Math.hypot(p.pos.x - x, p.pos.z - z)), Infinity)
  let candidates = pts.filter((s) => minDist(s.x, s.z) >= MIN_SPAWN_DIST)
  if (!candidates.length) {
    // Everyone is camping an alley: use the farthest spawn instead of refusing.
    candidates = [pts.reduce((best, s) => (minDist(s.x, s.z) > minDist(best.x, best.z) ? s : best), pts[0])]
  }
  const rng = ctx.state.rng
  const s = candidates[rngInt(rng, 0, candidates.length - 1)]
  for (let attempt = 0; attempt < 6; attempt++) {
    const x = s.x + (attempt ? rngRange(rng, -1.2, 1.2) : 0)
    const z = s.z + (attempt ? rngRange(rng, -1.2, 1.2) : 0)
    if (circleOverlapsAny(ctx.map, x, z, 0.4)) continue
    const crowded = ctx.state.zombies.some((o) => o.mode !== 'dead' && Math.hypot(o.pos.x - x, o.pos.z - z) < 0.8)
    if (crowded && attempt < 5) continue
    const zb = newZombie(ctx, archetype, x, z, speedScale)
    ctx.state.zombies.push(zb)
    ctx.events.push({ type: 'zombieSpawn', zombieId: zb.id, pos: { ...zb.pos } })
    return true
  }
  return false
}
