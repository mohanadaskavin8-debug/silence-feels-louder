import { AudioEngine } from '../audio/audio'
import { getCharacter } from '../data/characters'
import { getWeapon } from '../data/weapons'
import { InputController } from '../input/input'
import { LocalSession } from '../net/session'
import { GameRenderer, snapshotOf, type Snapshot } from '../render/renderer'
import { cameraRig, FOV_AIM, FOV_HIP } from '../sim/camera'
import { lerp, wrapAngle, yawFromDir, type Vec3 } from '../sim/math'
import type { PlayerState, SimEvent } from '../sim/types'
import { currentSpread } from '../sim/weapon'
import { SIM_DT } from '../sim/world'
import { newZombie } from '../sim/zombie'
import { HudStore, type GameStatus } from './hud'

const LOCAL_ID = 'local'
const HUD_INTERVAL = 1 / 15
const DEATH_SCREEN_DELAY = 1.8
const CLEAR_SCREEN_DELAY = 2.2
const MAX_STEPS_PER_FRAME = 6

export interface GameOptions {
  characterId: string
  mapId: string
  encounterId: string
}

/** Owns the loop: fixed-step simulation, interpolated rendering, input, audio and HUD. */
export class Game {
  readonly hud = new HudStore()
  readonly input = new InputController()
  readonly audio = new AudioEngine()
  readonly session: LocalSession
  private renderer: GameRenderer | null = null
  private status: GameStatus = 'title'
  private raf = 0
  private last = 0
  private acc = 0
  private prev: Snapshot | null = null
  private hudTimer = 0
  private hitId = 0
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

  constructor(readonly options: GameOptions) {
    this.session = new LocalSession(
      { mapId: options.mapId, encounterId: options.encounterId, players: [{ id: LOCAL_ID, characterId: options.characterId }], seed: 1337 },
      LOCAL_ID,
    )
    const me = this.me()
    this.input.setView(me.yaw, 0)
    this.input.onLockChange = (locked, reason) => {
      // Esc (lock exited) pauses; a refused request just leaves the capture prompt up.
      if (!locked && reason === 'change' && this.status === 'playing' && !this.input.freeLook) this.pause()
      this.pushHud()
    }
    this.input.onToggleMute = () => this.toggleMute()
    this.input.onPause = () => {
      if (this.status === 'playing') this.pause()
    }
  }

  private me(): PlayerState {
    return this.session.state.players.find((p) => p.id === LOCAL_ID)!
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

  start() {
    if (this.status !== 'title') return
    this.audio.unlock()
    this.audio.startMusic()
    this.setStatus('playing')
    this.input.requestLock()
  }

  pause() {
    if (this.status !== 'playing') return
    this.setStatus('paused')
    this.input.releaseLock()
  }

  resume() {
    if (this.status !== 'paused') return
    this.audio.unlock()
    this.acc = 0
    this.setStatus('playing')
    this.input.requestLock()
  }

  /** Restart the encounter from scratch, straight back into play. */
  restart() {
    this.session.reset()
    this.renderer?.clearEntities()
    this.prev = null
    this.acc = 0
    this.damage = []
    this.banner = null
    this.pendingStatus = null
    const me = this.me()
    this.input.setView(me.yaw, 0)
    this.audio.unlock()
    this.audio.startMusic()
    this.setStatus('playing')
    this.input.requestLock()
  }

  quitToTitle() {
    this.session.reset()
    this.renderer?.clearEntities()
    this.prev = null
    this.pendingStatus = null
    this.damage = []
    this.banner = null
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
    this.input.enabled = s === 'playing'
    this.pushHud()
  }

  private onVisibility = () => {
    if (document.hidden) this.pause()
  }

  // --- loop ------------------------------------------------------------------

  private frame = (ts: number) => {
    this.raf = requestAnimationFrame(this.frame)
    const dt = Math.min(0.1, Math.max(0, (ts - this.last) / 1000))
    this.last = ts
    this.clock += dt
    this.input.update(dt)

    // The world keeps running behind the death / clear screens; pause and title freeze it, and
    // so does play without mouse capture (you can't aim, so the zombies shouldn't get free hits).
    const canPlay = this.input.locked || this.input.freeLook || this.input.scripted !== null
    const simulate = (this.status === 'playing' && canPlay) || this.status === 'dead' || this.status === 'cleared'
    let alpha = 1
    if (simulate) {
      this.acc += dt
      let steps = 0
      while (this.acc >= SIM_DT && steps < MAX_STEPS_PER_FRAME) {
        this.prev = snapshotOf(this.session.state)
        const events = this.session.step(this.input.sample())
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
      if (this.status === 'playing') {
        this.setStatus(next)
        this.input.releaseLock()
      }
    }

    this.ambience(dt)
    this.draw(alpha, dt)

    this.fpsFrames++
    this.fpsTime += dt
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

  private draw(alpha: number, dt: number) {
    const r = this.renderer
    if (!r) return
    const me = this.me()
    const state = this.session.state
    let cinematic: { pos: Vec3; target: Vec3 } | undefined
    if (this.status === 'title') {
      const t = this.clock * 0.06
      cinematic = {
        pos: { x: Math.sin(t) * 16, y: 6.5 + Math.sin(t * 0.7) * 1.2, z: 8 + Math.cos(t) * 16 },
        target: { x: me.pos.x, y: 1.2, z: me.pos.z - 6 },
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
    if (this.status === 'title' || this.status === 'paused') return
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
            this.pendingStatus = { status: 'dead', at: this.clock + DEATH_SCREEN_DELAY }
          }
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
          this.showBanner('Block 7 held', 'Encounter complete')
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
    const wdef = getWeapon(me.weapon.defId)
    const ch = getCharacter(me.characterId)
    this.damage = this.damage.filter((d) => this.clock - d.t < 1.4)
    if (this.banner && this.clock - this.banner.t > 3.2) this.banner = null
    const wave = def.waves[Math.min(enc.wave, def.waves.length - 1)]
    const countdown = enc.phase === 'warmup' ? def.warmup - enc.phaseTime : enc.phase === 'intermission' ? def.intermission - enc.phaseTime : 0
    this.hud.set({
      status: this.status,
      characterName: ch.name,
      modelPlaceholder: ch.modelStatus === 'placeholder',
      district: this.session.sim.map.district,
      mapName: this.session.sim.map.name,
      encounterName: def.name,
      health: Math.ceil(me.health),
      maxHealth: me.maxHealth,
      ammo: me.weapon.ammo,
      magSize: wdef.magSize,
      reserve: me.weapon.reserve,
      weaponName: wdef.name,
      reloadProgress: me.weapon.reloadLeft > 0 ? 1 - me.weapon.reloadLeft / wdef.reloadTime : null,
      spread: currentSpread(me),
      fov: lerp(FOV_HIP, FOV_AIM, me.aimBlend),
      aimBlend: me.aimBlend,
      sprinting: me.sprinting,
      phase: enc.phase,
      wave: enc.wave + 1,
      waveTotal: def.waves.length,
      waveRemaining: enc.phase === 'wave' ? Math.max(0, wave.count - enc.killedThisWave) : 0,
      countdown: Math.max(0, countdown),
      kills: me.kills,
      accuracy: me.shotsFired ? me.shotsHit / me.shotsFired : 0,
      elapsed: enc.elapsed,
      hitMarker: { id: this.hitId, kind: this.hitKind },
      damage: this.damage.map((d) => ({ id: d.id, angle: d.angle })),
      banner: this.banner ? { id: this.banner.id, title: this.banner.title, sub: this.banner.sub } : null,
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
          tick: s.tick,
          encounter: { ...s.encounter },
          player: {
            pos: { ...me.pos },
            health: me.health,
            alive: me.alive,
            ammo: me.weapon.ammo,
            reserve: me.weapon.reserve,
            kills: me.kills,
            yaw: this.input.yaw,
            pitch: this.input.pitch,
            aimBlend: me.aimBlend,
          },
          zombies: s.zombies.map((z) => ({ id: z.id, pos: { ...z.pos }, health: z.health, mode: z.mode })),
          fps: this.fps,
        }
      },
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
      start: () => this.start(),
      restart: () => this.restart(),
      pause: () => this.pause(),
      resume: () => this.resume(),
      setInput: (partial: Record<string, unknown> | null) => {
        this.input.scripted = partial
      },
      /** Hold the encounter in warmup so tests control every zombie (false restores the real timer). */
      holdWaves: (hold = true) => {
        const enc = this.session.sim.encounter as { warmup: number }
        if (hold && enc.warmup < 1e8) this.heldWarmup = enc.warmup
        enc.warmup = hold ? 1e9 : this.heldWarmup ?? enc.warmup
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
        const target = { x: z.pos.x, y: part === 'head' ? 1.6 : 1.1, z: z.pos.z }
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
