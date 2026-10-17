// A tiny external store so React re-renders the HUD at ~15 Hz instead of every frame.

export type GameStatus = 'title' | 'loading' | 'playing' | 'paused' | 'dead' | 'cleared' | 'error'

export interface HudSnapshot {
  status: GameStatus
  error: string | null
  characterName: string
  modelPlaceholder: boolean
  district: string
  mapName: string
  encounterName: string
  health: number
  maxHealth: number
  ammo: number
  magSize: number
  reserve: number
  weaponName: string
  reloadProgress: number | null
  /** Cone half-angle (radians) and current FOV (degrees) for the dynamic crosshair. */
  spread: number
  fov: number
  aimBlend: number
  sprinting: boolean
  phase: string
  wave: number
  waveTotal: number
  waveRemaining: number
  countdown: number
  kills: number
  accuracy: number
  elapsed: number
  /** Increments per event; the UI keys animations on these ids. */
  hitMarker: { id: number; kind: 'hit' | 'head' | 'kill' }
  damage: { id: number; angle: number }[]
  banner: { id: number; title: string; sub: string } | null
  pointerLocked: boolean
  freeLook: boolean
  /** Automated test input is driving the player. */
  scripted: boolean
  muted: boolean
  fps: number
}

export const initialHud = (): HudSnapshot => ({
  status: 'title',
  error: null,
  characterName: '',
  modelPlaceholder: true,
  district: '',
  mapName: '',
  encounterName: '',
  health: 100,
  maxHealth: 100,
  ammo: 0,
  magSize: 0,
  reserve: 0,
  weaponName: '',
  reloadProgress: null,
  spread: 0,
  fov: 68,
  aimBlend: 0,
  sprinting: false,
  phase: 'warmup',
  wave: 0,
  waveTotal: 0,
  waveRemaining: 0,
  countdown: 0,
  kills: 0,
  accuracy: 0,
  elapsed: 0,
  hitMarker: { id: 0, kind: 'hit' },
  damage: [],
  banner: null,
  pointerLocked: false,
  freeLook: false,
  scripted: false,
  muted: false,
  fps: 0,
})

export class HudStore {
  private snap = initialHud()
  private listeners = new Set<() => void>()

  get = () => this.snap

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  set(patch: Partial<HudSnapshot>) {
    this.snap = { ...this.snap, ...patch }
    for (const l of this.listeners) l()
  }
}
