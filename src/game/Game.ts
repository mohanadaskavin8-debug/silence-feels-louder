import { AudioEngine } from '../audio/audio'
import { getCharacter } from '../data/characters'
import { getMap, THE_VILLE } from '../data/maps'
import { getMission, isUnlocked, type MissionDef } from '../data/missions'
import { getWeapon, isSidearm } from '../data/weapons'
import type { AttachmentChoice } from '../data/attachments'
import { InputController } from '../input/input'
import { LocalSession, ONLINE_MULTIPLAYER_AVAILABLE } from '../net/session'
import { GameRenderer, snapshotOf, type Snapshot } from '../render/renderer'
import { cameraRig, FOV_AIM, FOV_HIP } from '../sim/camera'
import { lerp, wrapAngle, yawFromDir, type Vec3 } from '../sim/math'
import type { PlayerInput, PlayerState, SimEvent, Station, StationKind } from '../sim/types'
import { activeWeapon, currentSpread } from '../sim/weapon'
import { SIM_DT } from '../sim/world'
import { newZombie } from '../sim/zombie'
import { HudStore, type GameStatus, type MissionSummary, type Scene } from './hud'
import {
  attachmentUnlocked,
  isCleared,
  loadProfile,
  loadoutSlots,
  localCharacter,
  recordMission,
  saveProfile,
  type FourthMember,
  type LoadoutPreset,
  type PartyMode,
  type Profile,
} from './profile'

const LOCAL_ID = 'local'
const HUB_ENCOUNTER = 'hub-idle'
const HUD_INTERVAL = 1 / 15
const DEATH_SCREEN_DELAY = 1.8
const CLEAR_SCREEN_DELAY = 2.2
const MAX_STEPS_PER_FRAME = 6

const newSeed = () => (Math.random() * 2 ** 31) | 0

/**
 * Owns the loop (fixed-step simulation, interpolated rendering, input, audio, HUD) and the
 * scene flow: title → The Ville hub ⇄ station panels → mission → results → back to the hub.
 */
export class Game {
  readonly hud = new HudStore()
  readonly input = new InputController()
  readonly audio = new AudioEngine()
  private session: LocalSession
  private scene: Scene = 'hub'
  private mission: MissionDef | null = null
  private profile: Profile
  private station: Station | null = null
  private panel: StationKind | null = null
  private result: MissionSummary | null = null
  /** The current mission's outcome has been written to the profile. */
  private resolved = false
  private renderer: GameRenderer | null = null
  private status: GameStatus = 'title'
  private raf = 0
  private last = 0
  private acc = 0
  private prev: Snapshot | null = null
  private hudTimer = 0
  private hitId = 0
  private hitTime = -1
  private hitKind: 'hit' | 'head' | 'kill' = 'hit'
  private damage: { id: number; angle: number; t: number }[] = []
  private damageId = 0
  private banner: { id: number; title: string; sub: string; t: number } | null = null
  private bannerId = 0
  private pendingStatus: { status: GameStatus; at: number } | null = null
  private clock = 0
  private groanTimer = 2
  private deathTime = 0
  private fpsFrames = 0
  private fpsTime = 0
  private fps = 0
  private resizeObs: ResizeObserver | null = null
  /** One-shot callbacks run right after a frame is drawn (the drawing buffer is still readable). */
  private afterDraw: ((canvas: HTMLCanvasElement) => void)[] = []
  private heldWarmup: number | null = null

  constructor() {
    this.profile = loadProfile()
    this.session = this.hubSession()
    this.input.setView(this.me().yaw, 0)
    this.input.onLockChange = (locked, reason) => {
      // Esc (lock exited) pauses; a refused request just leaves the capture prompt up.
      if (!locked && reason === 'change' && (this.status === 'playing' || this.status === 'hub') && !this.input.freeLook) this.pause()
      this.pushHud()
    }
    this.input.onToggleMute = () => this.toggleMute()
    this.input.onPause = () => this.pause()
    this.input.onInteract = () => {
      if (this.status === 'hub' && this.station) this.openPanel(this.station.kind)
    }
  }

  private me(): PlayerState {
    return this.session.state.players.find((p) => p.id === LOCAL_ID)!
  }

  private hubSession() {
    return new LocalSession(
      { mapId: THE_VILLE.id, encounterId: HUB_ENCOUNTER, players: [{ id: LOCAL_ID, characterId: localCharacter(this.profile) }], seed: 1 },
      LOCAL_ID,
    )
  }

  /** Swap the running session (and the map on screen), clearing everything transient. */
  private useSession(s: LocalSession) {
    this.session = s
    this.renderer?.setMap(s.sim.map)
    this.renderer?.clearEntities()
    this.prev = null
    this.acc = 0
    this.damage = []
    this.banner = null
    this.pendingStatus = null
    this.station = null
    this.input.setView(this.me().yaw, 0)
  }

  mount(canvas: HTMLCanvasElement) {
    try {
      this.renderer = new GameRenderer(canvas, this.session.sim.map)
    } catch (err) {
      this.setStatus('error')
      this.hud.set({ error: `WebGL could not start: ${(err as Error).message}. Try a desktop browser with hardware acceleration enabled.` })
      return
    }
    this.input.attach(canvas)
    this.resizeObs = new ResizeObserver(() => this.renderer?.resize())
    this.resizeObs.observe(canvas)
    document.addEventListener('visibilitychange', this.onVisibility)
    this.pushHud()
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.frame)
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.input.detach()
    this.resizeObs?.disconnect()
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.audio.stopMusic()
    this.renderer?.dispose()
    this.renderer = null
  }

  // --- flow ------------------------------------------------------------------

  /** Title → The Ville. */
  start() {
    if (this.status !== 'title') return
    this.audio.unlock()
    this.setStatus('hub')
    this.input.requestLock()
  }

  openPanel(kind: StationKind) {
    if (this.status !== 'hub') return
    this.panel = kind
    this.setStatus('panel')
    this.input.releaseLock()
  }

  closePanel() {
    if (this.status !== 'panel') return
    this.panel = null
    this.setStatus('hub')
    this.input.requestLock()
  }

  setParty(mode: PartyMode, fourth: FourthMember) {
    this.saveProfile({ ...this.profile, party: { mode, fourth } })
  }

  selectLoadout(index: number) {
    if (!this.profile.loadouts[index]) return
    this.saveProfile({ ...this.profile, activeLoadout: index })
  }

  renameLoadout(index: number, name: string) {
    const l = this.profile.loadouts[index]
    if (!l) return
    this.updateLoadout(index, { ...l, name: name.trim().slice(0, 24) || l.name })
  }

  /** Put an owned weapon into the active loadout (pistols go to the sidearm slot, the rest to primary). */
  equip(weaponId: string) {
    const w = getWeapon(weaponId)
    if (!this.profile.owned.includes(weaponId)) return
    const i = this.profile.activeLoadout
    const l = this.profile.loadouts[i]
    const slot = { id: weaponId, attachments: {} }
    this.updateLoadout(i, isSidearm(w) ? { ...l, sidearm: l.sidearm.id === weaponId ? l.sidearm : slot } : { ...l, primary: l.primary?.id === weaponId ? l.primary : slot })
  }

  /** Empty the primary slot of the active loadout (sidearm only). */
  clearPrimary() {
    const i = this.profile.activeLoadout
    this.updateLoadout(i, { ...this.profile.loadouts[i], primary: null })
  }

  /** Fit (or with null, remove) an attachment on a weapon in the active loadout. Locked attachments are refused. */
  setAttachment(weaponId: string, slot: keyof AttachmentChoice, attachmentId: string | null) {
    const i = this.profile.activeLoadout
    const l = this.profile.loadouts[i]
    const target = l.primary?.id === weaponId ? 'primary' : l.sidearm.id === weaponId ? 'sidearm' : null
    if (!target) return
    if (attachmentId && !attachmentUnlocked(this.profile, weaponId, attachmentId)) return
    const cur = target === 'primary' ? l.primary! : l.sidearm
    const attachments = { ...(cur.attachments ?? {}) }
    if (attachmentId) attachments[slot] = attachmentId
    else delete attachments[slot]
    this.updateLoadout(i, { ...l, [target]: { ...cur, attachments } })
  }

  /** Buy a weapon with cash once its mission requirement is met. Returns false if not allowed. */
  buyWeapon(weaponId: string): boolean {
    const w = getWeapon(weaponId)
    const p = this.profile
    if (p.owned.includes(weaponId)) return false
    if (w.requires && !isCleared(p, w.requires)) return false
    const price = w.price ?? 0
    if (p.cash < price) return false
    this.saveProfile({ ...p, cash: p.cash - price, owned: [...p.owned, weaponId] })
    return true
  }

  private updateLoadout(index: number, preset: LoadoutPreset) {
    const loadouts = this.profile.loadouts.slice()
    loadouts[index] = preset
    this.saveProfile({ ...this.profile, loadouts })
  }

  private saveProfile(p: Profile) {
    this.profile = p
    saveProfile(p)
    this.pushHud()
  }

  /** Leave the hub for a mission. Refuses anything not deployable (locked, unbuilt, or needing co-op). */
  deploy(missionId: string): boolean {
    if (this.status !== 'panel' && this.status !== 'hub') return false
    const m = getMission(missionId)
    const ready = m.playable && isUnlocked(m, (id) => isCleared(this.profile, id))
    const party = this.profile.party.mode === 'solo' || ONLINE_MULTIPLAYER_AVAILABLE
    if (!ready || !party || !m.mapId || !m.encounterId) return false
    getMap(m.mapId)
    this.mission = m
    this.resolved = false
    this.result = null
    this.panel = null
    this.scene = 'mission'
    this.useSession(
      new LocalSession(
        {
          mapId: m.mapId,
          encounterId: m.encounterId,
          players: [{ id: LOCAL_ID, characterId: localCharacter(this.profile), loadout: loadoutSlots(this.profile) }],
          seed: newSeed(),
        },
        LOCAL_ID,
      ),
    )
    this.audio.unlock()
    this.audio.startMusic()
    this.setStatus('playing')
    this.input.requestLock()
    return true
  }

  pause() {
    if (this.status !== 'playing' && this.status !== 'hub') return
    // The mission is already decided (death cam / victory beat): show the end screen, not a pause menu.
    if (this.pendingStatus) {
      const next = this.pendingStatus.status
      this.pendingStatus = null
      this.setStatus(next)
      this.input.releaseLock()
      return
    }
    this.pausedFrom = this.status
    this.setStatus('paused')
    this.input.releaseLock()
  }
  private pausedFrom: GameStatus = 'hub'

  resume() {
    if (this.status !== 'paused') return
    this.audio.unlock()
    this.acc = 0
    this.setStatus(this.pausedFrom)
    this.input.requestLock()
  }

  /** Replay the current mission from scratch. */
  restart() {
    if (this.scene !== 'mission' || !this.mission) return
    if (!this.resolved) this.record(false, true)
    this.session.reset()
    this.renderer?.clearEntities()
    this.prev = null
    this.acc = 0
    this.damage = []
    this.banner = null
    this.pendingStatus = null
    this.resolved = false
    this.result = null
    this.input.setView(this.me().yaw, 0)
    this.audio.unlock()
    this.audio.startMusic()
    this.setStatus('playing')
    this.input.requestLock()
  }

  /** Back to The Ville from a mission (results screen or abandoning from the pause menu). */
  returnToHub() {
    if (this.scene !== 'mission') return
    if (!this.resolved) this.record(false, true)
    this.mission = null
    this.scene = 'hub'
    this.audio.stopMusic()
    this.useSession(this.hubSession())
    this.setStatus('hub')
    this.input.requestLock()
  }

  quitToTitle() {
    if (this.scene === 'mission') {
      if (!this.resolved) this.record(false, true)
      this.mission = null
      this.scene = 'hub'
      this.useSession(this.hubSession())
    }
    this.panel = null
    this.audio.stopMusic()
    this.input.releaseLock()
    this.input.setView(this.me().yaw, 0)
    this.setStatus('title')
  }

  toggleMute() {
    this.audio.setMuted(!this.audio.muted)
    this.pushHud()
  }

  private setStatus(s: GameStatus) {
    this.status = s
    this.input.enabled = s === 'playing' || s === 'hub'
    this.pushHud()
  }

  private onVisibility = () => {
    if (document.hidden) {
      this.pause()
      this.audio.suspend()
    } else if (this.status !== 'title') {
      this.audio.unlock()
    }
  }

  /** Write the mission outcome to the profile once. */
  private record(success: boolean, abandoned = false) {
    if (!this.mission || this.resolved) return
    this.resolved = true
    const me = this.me()
    const enc = this.session.state.encounter
    const wasCleared = isCleared(this.profile, this.mission.id)
    const next = recordMission(this.profile, {
      missionId: this.mission.id,
      success,
      abandoned,
      kills: me.kills,
      time: enc.elapsed,
      shotsFired: me.shotsFired,
      shotsHit: me.shotsHit,
    })
    this.saveProfile(next)
    this.result = {
      missionId: this.mission.id,
      missionName: this.mission.name,
      success,
      kills: me.kills,
      time: enc.elapsed,
      accuracy: me.shotsFired ? me.shotsHit / me.shotsFired : 0,
      wave: enc.wave + 1,
      waveTotal: this.session.sim.encounter.waves.length,
      firstClear: success && !wasCleared,
      clears: next.missions[this.mission.id]?.clears ?? 0,
    }
  }

  // --- loop ------------------------------------------------------------------

  private frame = (ts: number) => {
    this.raf = requestAnimationFrame(this.frame)
    const realDt = Math.max(0, (ts - this.last) / 1000)
    // Cap the step so a stall (tab switch, GC) doesn't fast-forward the fight; below ~10 fps the game slows down instead.
    const dt = Math.min(0.1, realDt)
    this.last = ts
    this.clock += dt
    this.input.update(dt)

    // The world keeps running behind the death / clear screens; pause, panels and title freeze it,
    // and so does play without mouse capture (you can't aim, so the zombies shouldn't get free hits).
    const canPlay = this.input.locked || this.input.freeLook || this.input.scripted !== null
    const live = this.status === 'playing' || this.status === 'hub'
    const simulate = (live && canPlay) || this.status === 'dead' || this.status === 'cleared'
    let alpha = 1
    if (simulate) {
      this.acc += dt
      let steps = 0
      while (this.acc >= SIM_DT && steps < MAX_STEPS_PER_FRAME) {
        this.prev = snapshotOf(this.session.state)
        const events = this.session.step(this.sampleInput())
        this.onEvents(events)
        this.acc -= SIM_DT
        steps++
      }
      if (steps === MAX_STEPS_PER_FRAME) this.acc = 0
      alpha = this.acc / SIM_DT
    }

    if (this.pendingStatus && this.clock >= this.pendingStatus.at) {
      const next = this.pendingStatus.status
      this.pendingStatus = null
      if (this.status === 'playing' || this.status === 'paused') {
        this.setStatus(next)
        this.input.releaseLock()
      }
    }

    this.updateStation()
    this.ambience(dt)
    this.draw(alpha, dt)

    this.fpsFrames++
    this.fpsTime += realDt
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime)
      this.fpsFrames = 0
      this.fpsTime = 0
    }
    this.hudTimer -= dt
    if (this.hudTimer <= 0) {
      this.hudTimer = HUD_INTERVAL
      this.pushHud()
    }
  }

  /** Weapons stay holstered in the hub. */
  private sampleInput(): PlayerInput {
    const i = this.input.sample()
    if (this.session.sim.map.safe) {
      i.fire = false
      i.aim = false
      i.melee = false
      i.reload = false
    }
    return i
  }

  /** Nearest hub station within reach of the player. */
  private updateStation() {
    const stations = this.session.sim.map.stations
    let best: Station | null = null
    if (stations && this.scene === 'hub') {
      const me = this.me()
      let bestD = Infinity
      for (const s of stations) {
        const d = Math.hypot(s.x - me.pos.x, s.z - me.pos.z)
        if (d <= s.radius && d < bestD) {
          bestD = d
          best = s
        }
      }
    }
    if (best?.id !== this.station?.id) {
      this.station = best
      this.pushHud()
    }
    if (this.renderer) this.renderer.activeStation = best?.id ?? null
  }

  private draw(alpha: number, dt: number) {
    const r = this.renderer
    if (!r) return
    const me = this.me()
    const state = this.session.state
    let cinematic: { pos: Vec3; target: Vec3 } | undefined
    if (this.status === 'title') {
      const t = this.clock * 0.06
      cinematic = {
        pos: { x: Math.sin(t) * 13, y: 5.5 + Math.sin(t * 0.7) * 1.2, z: Math.cos(t) * 11 },
        target: { x: 0, y: 1.6, z: 0 },
      }
    } else if (!me.alive) {
      const t = this.clock - this.deathTime
      const a = me.facing + 0.6 + t * 0.15
      const h = Math.min(7, 2.2 + t * 1.2)
      const d = Math.min(6, 2.5 + t * 0.9)
      cinematic = {
        pos: { x: me.pos.x + Math.sin(a) * d, y: h, z: me.pos.z + Math.cos(a) * d },
        target: { x: me.pos.x, y: 0.4, z: me.pos.z },
      }
    }
    r.render(state, this.prev, alpha, { yaw: this.input.yaw, pitch: this.input.pitch, localId: LOCAL_ID }, dt, cinematic)
    this.audio.setListener(me.pos.x, me.pos.z, this.input.yaw)
    if (this.afterDraw.length) {
      const cbs = this.afterDraw
      this.afterDraw = []
      for (const cb of cbs) cb(r.renderer.domElement)
    }
  }

  private ambience(dt: number) {
    if (this.scene !== 'mission' || this.status === 'paused' || this.status === 'title') return
    const me = this.me()
    let near = 0
    const candidates = []
    for (const z of this.session.state.zombies) {
      if (z.mode === 'dead') continue
      const d = Math.hypot(z.pos.x - me.pos.x, z.pos.z - me.pos.z)
      if (d < 14) near++
      if (d < 24) candidates.push(z)
    }
    this.audio.setIntensity(Math.min(1, near / 6))
    this.groanTimer -= dt
    if (this.groanTimer <= 0 && candidates.length) {
      const z = candidates[Math.floor(Math.random() * candidates.length)]
      this.audio.groan(z.pos, 0.8)
      this.groanTimer = 1.2 + Math.random() * 2.2
    }
    if (me.alive && me.health < 35) this.audio.heartbeat(this.clock)
  }

  private onEvents(events: SimEvent[]) {
    if (!events.length) return
    this.renderer?.handleEvents(events, LOCAL_ID)
    const me = this.me()
    for (const e of events) {
      switch (e.type) {
        case 'shot':
          if (e.playerId === LOCAL_ID) {
            this.input.kick(e.recoilPitch, e.recoilYaw)
            this.audio.gunshot(null)
          } else this.audio.gunshot(e.muzzle)
          break
        case 'dryFire':
          if (e.playerId === LOCAL_ID) this.audio.dryFire()
          break
        case 'reloadStart':
          if (e.playerId === LOCAL_ID) this.audio.reload('start')
          break
        case 'reloadDone':
          if (e.playerId === LOCAL_ID) this.audio.reload('end')
          break
        case 'zombieHit':
          if (e.playerId === LOCAL_ID) {
            this.hitId++
            this.hitTime = this.clock
            this.hitKind = e.killed ? 'kill' : e.headshot ? 'head' : 'hit'
          }
          this.audio.zombieHit(e.pos, e.headshot, e.killed)
          break
        case 'zombieAttack':
          this.audio.zombieAttack(e.pos)
          break
        case 'zombieSpawn':
          this.audio.spawn(e.pos)
          break
        case 'playerHit':
          if (e.playerId === LOCAL_ID) {
            const world = yawFromDir(e.from.x - me.pos.x, e.from.z - me.pos.z)
            this.damage.push({ id: ++this.damageId, angle: wrapAngle(world - this.input.yaw), t: this.clock })
            this.audio.playerHit()
          }
          break
        case 'playerDied':
          if (e.playerId === LOCAL_ID) {
            this.deathTime = this.clock
            this.audio.sting('fail')
          }
          break
        case 'encounterFailed':
          this.record(false)
          this.pendingStatus = { status: 'dead', at: this.clock + DEATH_SCREEN_DELAY }
          break
        case 'melee':
          if (e.playerId === LOCAL_ID) this.audio.melee()
          break
        case 'waveStart':
          this.showBanner(`Wave ${e.wave + 1} / ${e.total}`, e.wave === e.total - 1 ? 'Final wave — hold the block' : 'They are coming out of the alleys')
          this.audio.sting('wave')
          break
        case 'waveCleared':
          if (e.wave < this.session.sim.encounter.waves.length - 1) {
            this.showBanner('Wave cleared', 'Ammo resupplied')
            this.audio.sting('clear')
          }
          break
        case 'encounterCleared':
          this.record(true)
          this.showBanner(`${this.session.sim.map.name} held`, 'Mission complete')
          this.audio.sting('win')
          this.pendingStatus = { status: 'cleared', at: this.clock + CLEAR_SCREEN_DELAY }
          break
      }
    }
  }

  private showBanner(title: string, sub: string) {
    this.banner = { id: ++this.bannerId, title, sub, t: this.clock }
  }

  private pushHud() {
    const me = this.me()
    const state = this.session.state
    const enc = state.encounter
    const def = this.session.sim.encounter
    const wpn = activeWeapon(me)
    const wdef = wpn.def
    const ch = getCharacter(me.characterId)
    this.damage = this.damage.filter((d) => this.clock - d.t < 1.4)
    if (this.banner && this.clock - this.banner.t > 3.2) this.banner = null
    const wave = def.waves[Math.min(enc.wave, Math.max(0, def.waves.length - 1))]
    const countdown = enc.phase === 'warmup' ? def.warmup - enc.phaseTime : enc.phase === 'intermission' ? def.intermission - enc.phaseTime : 0
    this.hud.set({
      status: this.status,
      scene: this.scene,
      station: this.station ? { id: this.station.id, kind: this.station.kind, label: this.station.label } : null,
      panel: this.panel,
      profile: this.profile,
      missionId: this.mission?.id ?? null,
      missionName: this.mission?.name ?? '',
      result: this.result,
      characterName: ch.name,
      modelPlaceholder: ch.modelStatus === 'placeholder',
      district: this.session.sim.map.district,
      mapName: this.session.sim.map.name,
      encounterName: this.mission?.name ?? def.name,
      health: Math.ceil(me.health),
      maxHealth: me.maxHealth,
      ammo: wpn.ammo,
      magSize: wdef.magSize,
      reserve: wpn.reserve,
      weaponName: wdef.name,
      weaponSlots: me.weapons.map((w, i) => ({ name: w.def.name, active: i === me.active })),
      switching: me.switchLeft > 0,
      reloadProgress: wpn.reloadLeft > 0 ? 1 - wpn.reloadLeft / wdef.reloadTime : null,
      spread: currentSpread(me),
      fov: lerp(FOV_HIP, FOV_AIM * wdef.aimZoom, me.aimBlend),
      aimBlend: me.aimBlend,
      sprinting: me.sprinting,
      phase: enc.phase,
      wave: enc.wave + 1,
      waveTotal: def.waves.length,
      waveRemaining: enc.phase === 'wave' && wave ? Math.max(0, wave.count - enc.killedThisWave) : 0,
      countdown: Number.isFinite(countdown) ? Math.max(0, countdown) : 0,
      kills: me.kills,
      accuracy: me.shotsFired ? me.shotsHit / me.shotsFired : 0,
      elapsed: enc.elapsed,
      // Only a fresh hit is shown, so a HUD remount (resume, retry) never replays an old marker.
      hitMarker: { id: this.clock - this.hitTime < 0.3 ? this.hitId : 0, kind: this.hitKind },
      damage: this.damage.map((d) => ({ id: d.id, angle: d.angle, age: this.clock - d.t })),
      banner: this.banner ? { id: this.banner.id, title: this.banner.title, sub: this.banner.sub, age: this.clock - this.banner.t } : null,
      pointerLocked: this.input.locked,
      freeLook: this.input.freeLook,
      scripted: this.input.scripted !== null,
      muted: this.audio.muted,
      fps: this.fps,
    })
  }

  // --- automation hooks (used by tests/smoke.mjs; harmless in play) ------------------

  debugApi() {
    return {
      state: () => {
        const me = this.me()
        const s = this.session.state
        return {
          status: this.status,
          scene: this.scene,
          map: this.session.sim.map.id,
          missionId: this.mission?.id ?? null,
          station: this.station?.id ?? null,
          panel: this.panel,
          tick: s.tick,
          encounter: { ...s.encounter },
          player: {
            pos: { ...me.pos },
            health: me.health,
            alive: me.alive,
            ammo: activeWeapon(me).ammo,
            reserve: activeWeapon(me).reserve,
            weapon: activeWeapon(me).def.id,
            weapons: me.weapons.map((w) => ({ id: w.def.id, ammo: w.ammo, reserve: w.reserve, attachments: w.def.attachments })),
            active: me.active,
            kills: me.kills,
            yaw: this.input.yaw,
            pitch: this.input.pitch,
            aimBlend: me.aimBlend,
          },
          zombies: s.zombies.map((z) => ({ id: z.id, pos: { ...z.pos }, health: z.health, mode: z.mode })),
          fps: this.fps,
        }
      },
      profile: () => JSON.parse(JSON.stringify(this.profile)) as Profile,
      /** Mean luminance and spread of the last drawn frame (proves the canvas isn't blank). */
      probe: () =>
        new Promise<{ mean: number; std: number; w: number; h: number }>((resolve) => {
          this.afterDraw.push((canvas) => {
            const c = document.createElement('canvas')
            c.width = 96
            c.height = 54
            const g = c.getContext('2d')!
            g.drawImage(canvas, 0, 0, c.width, c.height)
            const d = g.getImageData(0, 0, c.width, c.height).data
            let sum = 0
            let sq = 0
            const n = d.length / 4
            for (let i = 0; i < d.length; i += 4) {
              const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
              sum += l
              sq += l * l
            }
            const mean = sum / n
            resolve({ mean, std: Math.sqrt(Math.max(0, sq / n - mean * mean)), w: canvas.width, h: canvas.height })
          })
        }),
      /** Draw calls / triangles of the last frame and the map baking result. */
      renderInfo: () => {
        const r = this.renderer
        if (!r) return null
        const i = r.renderer.info
        return { calls: i.render.calls, triangles: i.render.triangles, programs: i.programs?.length ?? 0, map: r.mapDraws }
      },
      start: () => this.start(),
      deploy: (missionId: string) => this.deploy(missionId),
      /** Test helper: grant cash (profile economy checks still apply when buying). */
      grantCash: (amount: number) => this.saveProfile({ ...this.profile, cash: this.profile.cash + amount }),
      buyWeapon: (id: string) => this.buyWeapon(id),
      equip: (id: string) => this.equip(id),
      setAttachment: (weaponId: string, slot: keyof AttachmentChoice, id: string | null) => this.setAttachment(weaponId, slot, id),
      openPanel: (kind: StationKind) => this.openPanel(kind),
      closePanel: () => this.closePanel(),
      returnToHub: () => this.returnToHub(),
      restart: () => this.restart(),
      pause: () => this.pause(),
      resume: () => this.resume(),
      quitToTitle: () => this.quitToTitle(),
      /** Move the player (hub navigation tests). */
      teleport: (x: number, z: number) => {
        const me = this.me()
        me.pos.x = x
        me.pos.z = z
        me.vel.x = me.vel.z = 0
      },
      setInput: (partial: Record<string, unknown> | null) => {
        this.input.scripted = partial
      },
      /** Hold the encounter in warmup so tests control every zombie (false restores the real timer). */
      holdWaves: (hold = true) => {
        const enc = this.session.sim.encounter as { warmup: number }
        if (hold && enc.warmup < 1e8) this.heldWarmup = enc.warmup
        enc.warmup = hold ? 1e9 : this.heldWarmup ?? enc.warmup
      },
      /** Jump to the final wave with everything killed, so the real state machine clears the mission next tick. */
      finishEncounter: () => {
        const s = this.session.state.encounter
        const waves = this.session.sim.encounter.waves
        if (!waves.length) return false
        s.phase = 'wave'
        s.wave = waves.length - 1
        s.spawnedThisWave = waves[s.wave].count
        s.killedThisWave = waves[s.wave].count
        return true
      },
      /** Put a zombie `dist` metres in front of the player (already out of the ground). */
      spawnAhead: (dist: number, lateral = 0) => {
        const me = this.me()
        const ctx = this.session.sim.ctx([])
        const fx = -Math.sin(this.input.yaw)
        const fz = -Math.cos(this.input.yaw)
        const z = newZombie(ctx, 'regular', me.pos.x + fx * dist + fz * lateral, me.pos.z + fz * dist - fx * lateral, 1)
        z.mode = 'chase'
        this.session.state.zombies.push(z)
        return z.id
      },
      /** Point the camera so the crosshair sits on a zombie's chest (or head). */
      aimAt: (id: number, part: 'body' | 'head' = 'body') => {
        const me = this.me()
        const z = this.session.state.zombies.find((zz) => zz.id === id)
        if (!z) return false
        const target = { x: z.pos.x, y: part === 'head' ? 1.7 : 1.1, z: z.pos.z }
        let yaw = this.input.yaw
        let pitch = this.input.pitch
        for (let i = 0; i < 6; i++) {
          const rig = cameraRig(this.session.sim.map, me.pos, yaw, pitch, me.aimBlend)
          const dx = target.x - rig.pos.x
          const dy = target.y - rig.pos.y
          const dz = target.z - rig.pos.z
          yaw = yawFromDir(dx, dz)
          pitch = Math.atan2(dy, Math.hypot(dx, dz))
        }
        this.input.setView(yaw, pitch)
        return true
      },
      /** Leave the player on 1 HP with a zombie in their face: dies through the real attack path. */
      killPlayer: () => {
        const me = this.me()
        me.health = 1
        me.sinceDamage = 0
        return this.debugApi().spawnAhead(0.9)
      },
    }
  }
}
