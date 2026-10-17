import { PITCH_MAX, PITCH_MIN } from '../sim/camera'
import { clamp } from '../sim/math'
import type { PlayerInput } from '../sim/types'

export interface InputSettings {
  sensitivity: number
  invertY: boolean
}

/**
 * Keyboard + mouse. Look uses pointer lock; when the browser refuses it (some
 * embeds), the mouse still steers the camera while it is over the canvas.
 * Edge actions (reload, melee) latch until the next sim tick consumes them.
 */
export class InputController {
  yaw = 0
  pitch = 0
  settings: InputSettings = { sensitivity: 1, invertY: false }
  /** Set by the game: true while gameplay should read the mouse. */
  enabled = false
  /** `reason` is 'change' when the lock was granted/exited, 'error' when a request was refused. */
  onLockChange: (locked: boolean, reason: 'change' | 'error') => void = () => {}
  onToggleMute: () => void = () => {}
  onPause: () => void = () => {}
  onInteract: () => void = () => {}

  private keys = new Set<string>()
  private fire = false
  private aim = false
  private reloadLatch = false
  private meleeLatch = false
  private switchLatch = -1
  private recoilPitch = 0
  private lockFailed = false
  private lockFailures = 0
  /** When the lock was last released; browsers refuse re-locks for ~1 s after that. */
  private lastUnlock = -1e9
  private canvas: HTMLCanvasElement | null = null
  /** Scripted override used by automated tests (window.__sfl). */
  scripted: Partial<PlayerInput> | null = null

  get locked() {
    return !!this.canvas && document.pointerLockElement === this.canvas
  }

  get freeLook() {
    return this.lockFailed
  }

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    canvas.addEventListener('mousedown', this.onMouseDown)
    window.addEventListener('mouseup', this.onMouseUp)
    window.addEventListener('mousemove', this.onMouseMove)
    canvas.addEventListener('contextmenu', this.onContext)
    canvas.addEventListener('wheel', this.onWheel, { passive: true })
    document.addEventListener('pointerlockchange', this.onLockChangeEvt)
    document.addEventListener('pointerlockerror', this.onLockError)
  }

  detach() {
    const c = this.canvas
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    window.removeEventListener('mouseup', this.onMouseUp)
    window.removeEventListener('mousemove', this.onMouseMove)
    document.removeEventListener('pointerlockchange', this.onLockChangeEvt)
    document.removeEventListener('pointerlockerror', this.onLockError)
    if (c) {
      c.removeEventListener('mousedown', this.onMouseDown)
      c.removeEventListener('contextmenu', this.onContext)
      c.removeEventListener('wheel', this.onWheel)
    }
    this.canvas = null
  }

  requestLock() {
    const c = this.canvas
    if (!c || this.locked) return
    if (typeof c.requestPointerLock !== 'function') {
      this.lockFailed = true
      this.onLockChange(false, 'error')
      return
    }
    try {
      const r = c.requestPointerLock() as unknown
      // The pointerlockerror event reports a refusal; swallow the promise so it isn't counted twice.
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => {})
    } catch {
      this.onLockError()
    }
  }

  releaseLock() {
    if (this.locked) document.exitPointerLock()
  }

  setView(yaw: number, pitch: number) {
    this.yaw = yaw
    this.pitch = clamp(pitch, PITCH_MIN, PITCH_MAX)
    this.recoilPitch = 0
  }

  /** Client-side view kick; the view drifts back down part of the way. */
  kick(pitch: number, yaw: number) {
    this.pitch = clamp(this.pitch + pitch, PITCH_MIN, PITCH_MAX)
    this.yaw += yaw
    this.recoilPitch += pitch * 0.65
  }

  update(dt: number) {
    if (this.recoilPitch > 0) {
      const back = Math.min(this.recoilPitch, this.recoilPitch * dt * 9 + dt * 0.02)
      this.recoilPitch -= back
      this.pitch = clamp(this.pitch - back, PITCH_MIN, PITCH_MAX)
    }
  }

  /** Build this tick's input and consume latched edge actions. */
  sample(): PlayerInput {
    const k = this.keys
    const on = this.enabled
    const axis = (pos: string[], neg: string[]) =>
      (pos.some((c) => k.has(c)) ? 1 : 0) - (neg.some((c) => k.has(c)) ? 1 : 0)
    const input: PlayerInput = {
      moveX: on ? axis(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']) : 0,
      moveZ: on ? axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']) : 0,
      yaw: this.yaw,
      pitch: this.pitch,
      sprint: on && (k.has('ShiftLeft') || k.has('ShiftRight')),
      aim: on && this.aim,
      fire: on && this.fire,
      reload: on && this.reloadLatch,
      melee: on && this.meleeLatch,
      switchTo: on ? this.switchLatch : -1,
    }
    this.reloadLatch = false
    this.meleeLatch = false
    this.switchLatch = -1
    if (this.scripted) {
      Object.assign(input, this.scripted)
      if (this.scripted.yaw !== undefined) this.yaw = this.scripted.yaw
      if (this.scripted.pitch !== undefined) this.pitch = this.scripted.pitch
    }
    return input
  }

  private onKeyDown = (e: KeyboardEvent) => {
    // Tab only belongs to the game during play; in menus it must move focus.
    if (e.code === 'Tab' && this.enabled) e.preventDefault()
    if (e.repeat) return
    this.keys.add(e.code)
    if (!this.enabled) return
    if (e.code === 'KeyR') this.reloadLatch = true
    if (e.code === 'KeyV' || e.code === 'KeyQ') this.meleeLatch = true
    if (e.code === 'Digit1') this.switchLatch = 0
    if (e.code === 'Digit2') this.switchLatch = 1
    if (e.code === 'KeyM') this.onToggleMute()
    if (e.code === 'KeyE' || e.code === 'KeyF') this.onInteract()
    // With pointer lock, Esc is eaten by the browser and arrives as a lock change instead; P always works.
    if (e.code === 'KeyP' || (e.code === 'Escape' && !this.locked)) this.onPause()
  }

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code)
  }

  private onBlur = () => {
    this.keys.clear()
    this.fire = false
    this.aim = false
  }

  private onMouseDown = (e: MouseEvent) => {
    if (!this.enabled) return
    if (!this.locked && !this.lockFailed) {
      // First click only captures the mouse; it must not also fire.
      this.requestLock()
      return
    }
    if (e.button === 0) this.fire = true
    if (e.button === 2) this.aim = true
  }

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.fire = false
    if (e.button === 2) this.aim = false
  }

  private onMouseMove = (e: MouseEvent) => {
    if (!this.enabled) return
    if (!this.locked && !this.lockFailed) return
    if (this.lockFailed && this.canvas && e.target !== this.canvas) return
    const s = 0.0022 * this.settings.sensitivity * (this.aim ? 0.7 : 1)
    // Guard against the occasional huge movement spike some browsers report on lock.
    const mx = clamp(e.movementX, -300, 300)
    const my = clamp(e.movementY, -300, 300)
    this.yaw -= mx * s
    this.pitch = clamp(this.pitch - my * s * (this.settings.invertY ? -1 : 1), PITCH_MIN, PITCH_MAX)
  }

  private onContext = (e: Event) => e.preventDefault()

  private wheelAt = 0
  private onWheel = (e: WheelEvent) => {
    if (!this.enabled || Math.abs(e.deltaY) < 1) return
    // One switch per notch burst: trackpads fire dozens of wheel events per swipe.
    const now = performance.now()
    if (now - this.wheelAt < 250) return
    this.wheelAt = now
    this.switchLatch = -2
  }

  private onLockChangeEvt = () => {
    const locked = this.locked
    if (locked) {
      this.lockFailures = 0
      this.lockFailed = false
    } else {
      this.lastUnlock = performance.now()
      this.fire = false
      this.aim = false
    }
    this.onLockChange(locked, 'change')
  }

  private onLockError = () => {
    // Browsers refuse a re-lock for ~1 s after the user presses Esc, so one refusal is
    // not proof the embed blocks pointer lock. Fall back to free look after repeated refusals.
    // A refusal inside the post-unlock cooldown says nothing about the embed, so it doesn't count.
    if (performance.now() - this.lastUnlock > 1500) this.lockFailures++
    if (this.lockFailures >= 3) this.lockFailed = true
    this.onLockChange(false, 'error')
  }
}
