import { describe, expect, it } from 'vitest'
import { MISSIONS, getMission, isUnlocked } from '../data/missions'
import { getMap, getEncounter } from '../data/maps'
import { NavGrid } from '../sim/nav'
import { defaultProfile, isCleared, localCharacter, partyRoster, recordMission } from './profile'

describe('party rules', () => {
  it('builds the roster in the design order', () => {
    expect(partyRoster('solo', 'capt50')).toEqual(['ksbvndz'])
    expect(partyRoster('duo', 'capt50')).toEqual(['ksbvndz', 'savv4x'])
    expect(partyRoster('trio', '2tray')).toEqual(['ksbvndz', 'savv4x', '100otd'])
    expect(partyRoster('squad', 'capt50')).toEqual(['ksbvndz', 'savv4x', '100otd', 'capt50'])
    expect(partyRoster('squad', '2tray')).toEqual(['ksbvndz', 'savv4x', '100otd', '2tray'])
  })

  it('the local player is always KsBvndz in the solo build', () => {
    const p = defaultProfile()
    expect(localCharacter(p)).toBe('ksbvndz')
    expect(localCharacter({ ...p, party: { mode: 'squad', fourth: '2tray' } })).toBe('ksbvndz')
  })
})

describe('mission records', () => {
  const base = { missionId: 'dolly-hold-block-7', kills: 10, time: 200, shotsFired: 40, shotsHit: 20 }

  it('counts attempts, clears, best time and deaths', () => {
    let p = defaultProfile()
    p = recordMission(p, { ...base, success: false })
    expect(p.missions[base.missionId]).toMatchObject({ attempts: 1, clears: 0, bestTime: null, bestKills: 10 })
    expect(p.stats.deaths).toBe(1)
    p = recordMission(p, { ...base, success: true, time: 180, kills: 32 })
    p = recordMission(p, { ...base, success: true, time: 240, kills: 30 })
    expect(p.missions[base.missionId]).toMatchObject({ attempts: 3, clears: 2, bestTime: 180, bestKills: 32 })
    expect(p.stats).toMatchObject({ kills: 72, deaths: 1, missionsPlayed: 3, shotsFired: 120, shotsHit: 60 })
    expect(isCleared(p, base.missionId)).toBe(true)
  })

  it('abandoning counts an attempt but not a death', () => {
    const p = recordMission(defaultProfile(), { ...base, success: false, abandoned: true })
    expect(p.missions[base.missionId].attempts).toBe(1)
    expect(p.stats.deaths).toBe(0)
  })

  it('is pure: the input profile is untouched', () => {
    const p = defaultProfile()
    recordMission(p, { ...base, success: true })
    expect(p.missions).toEqual({})
  })
})

describe('mission catalogue', () => {
  it('every playable mission points at a real map and encounter', () => {
    for (const m of MISSIONS.filter((x) => x.playable)) {
      expect(() => getMap(m.mapId!)).not.toThrow()
      expect(() => getEncounter(m.encounterId!)).not.toThrow()
    }
  })

  it('unlocks follow prerequisites', () => {
    const p = defaultProfile()
    const westend = getMission('westend-supply-run')
    expect(isUnlocked(getMission('dolly-hold-block-7'), (id) => isCleared(p, id))).toBe(true)
    expect(isUnlocked(westend, (id) => isCleared(p, id))).toBe(false)
    const cleared = recordMission(p, { missionId: 'dolly-hold-block-7', success: true, kills: 1, time: 1, shotsFired: 0, shotsHit: 0 })
    expect(isUnlocked(westend, (id) => isCleared(cleared, id))).toBe(true)
  })
})

describe('The Ville hub', () => {
  const ville = getMap('the-ville')

  it('is a safe zone with three reachable stations', () => {
    expect(ville.safe).toBe(true)
    expect(ville.zombieSpawns).toHaveLength(0)
    const nav = new NavGrid(ville, 0.36)
    const spawn = nav.nearestFree(ville.playerSpawns[0].x, ville.playerSpawns[0].z)
    const field = nav.buildField(spawn)
    expect(ville.stations?.map((s) => s.kind).sort()).toEqual(['armory', 'mission-board', 'squad'])
    for (const s of ville.stations ?? []) {
      const cell = nav.cellIndex(s.x, s.z)
      expect(nav.blocked[cell], `${s.id} centre is walkable`).toBe(0)
      expect(field[cell], `${s.id} reachable from spawn`).toBeLessThan(0x3fffffff)
    }
  })
})
