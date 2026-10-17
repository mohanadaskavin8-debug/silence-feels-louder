import type { Vec3 } from '../sim/math'

// Everything here is synthesized at runtime with WebAudio: no sample files, nothing
// copyrighted. Approved tracks plug into the music manifest (src/audio/music.ts).

export class AudioEngine {
  private ctx: AudioContext | null = null
  private master!: GainNode
  private sfx!: GainNode
  private musicBus!: GainNode
  private noise!: AudioBuffer
  private listener = { x: 0, z: 0, yaw: 0 }
  private drone: { filter: BiquadFilterNode; gain: GainNode; stop: () => void } | null = null
  private intensity = 0
  private lastHeartbeat = 0
  muted = false
  available = typeof window !== 'undefined' && ('AudioContext' in window || 'webkitAudioContext' in window)

  /** Must run inside a user gesture (click/key) or browsers keep the context suspended. */
  unlock() {
    if (!this.available) return
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        const ctx = new Ctor()
        this.ctx = ctx
        this.master = ctx.createGain()
        this.master.gain.value = this.muted ? 0 : 0.8
        const comp = ctx.createDynamicsCompressor()
        comp.threshold.value = -14
        comp.ratio.value = 4
        this.master.connect(comp).connect(ctx.destination)
        this.sfx = ctx.createGain()
        this.sfx.connect(this.master)
        this.musicBus = ctx.createGain()
        this.musicBus.gain.value = 0.55
        this.musicBus.connect(this.master)
        this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
        const d = this.noise.getChannelData(0)
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume()
    } catch {
      this.available = false
      this.ctx = null
    }
  }

  /** Silence everything while the tab is hidden; unlock() resumes. */
  suspend() {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend()
  }

  setMuted(m: boolean) {
    this.muted = m
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05)
  }

  setListener(x: number, z: number, yaw: number) {
    this.listener.x = x
    this.listener.z = z
    this.listener.yaw = yaw
  }

  /** Gain + pan for a world position relative to the listener. */
  private spatial(pos: Vec3 | null, rolloff = 7): { gain: number; pan: number } {
    if (!pos) return { gain: 1, pan: 0 }
    const dx = pos.x - this.listener.x
    const dz = pos.z - this.listener.z
    const d = Math.hypot(dx, dz)
    const gain = 1 / (1 + Math.pow(d / rolloff, 1.6))
    // Listener right vector for the yaw convention (yaw 0 faces -Z).
    const rx = Math.cos(this.listener.yaw)
    const rz = -Math.sin(this.listener.yaw)
    const pan = d > 0.01 ? Math.max(-1, Math.min(1, (dx * rx + dz * rz) / d)) : 0
    return { gain, pan }
  }

  private out(pos: Vec3 | null, rolloff?: number): AudioNode | null {
    const ctx = this.ctx
    if (!ctx || this.muted) return null
    const { gain, pan } = this.spatial(pos, rolloff)
    if (gain < 0.01) return null
    const g = ctx.createGain()
    g.gain.value = gain
    const p = ctx.createStereoPanner()
    p.pan.value = pan * 0.8
    g.connect(p).connect(this.sfx)
    return g
  }

  private noiseBurst(dest: AudioNode, t: number, dur: number, type: BiquadFilterType, freq: number, q: number, peak: number, sweepTo?: number) {
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.playbackRate.value = 0.8 + Math.random() * 0.4
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.setValueAtTime(freq, t)
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur)
    f.Q.value = q
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(peak, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(f).connect(g).connect(dest)
    src.start(t, Math.random() * 1.5)
    src.stop(t + dur + 0.05)
  }

  private tone(dest: AudioNode, t: number, dur: number, type: OscillatorType, f0: number, f1: number, peak: number) {
    const ctx = this.ctx!
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(f0, t)
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(peak, t + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(dest)
    o.start(t)
    o.stop(t + dur + 0.05)
  }

  gunshot(pos: Vec3 | null) {
    const d = this.out(pos, 25)
    if (!d) return
    const t = this.ctx!.currentTime
    this.noiseBurst(d, t, 0.09, 'highpass', 900, 0.7, 0.9)
    this.noiseBurst(d, t, 0.16, 'bandpass', 1800, 0.8, 0.5)
    this.tone(d, t, 0.12, 'sine', 140, 45, 0.9)
    // Slap-back off the block walls.
    this.noiseBurst(d, t + 0.07, 0.5, 'lowpass', 900, 0.5, 0.12)
  }

  dryFire() {
    const d = this.out(null)
    if (!d) return
    this.noiseBurst(d, this.ctx!.currentTime, 0.03, 'bandpass', 3500, 6, 0.35)
  }

  reload(phase: 'start' | 'end') {
    const d = this.out(null)
    if (!d) return
    const t = this.ctx!.currentTime
    if (phase === 'start') {
      this.noiseBurst(d, t, 0.05, 'bandpass', 2400, 5, 0.3)
      this.noiseBurst(d, t + 0.35, 0.05, 'bandpass', 1600, 5, 0.25)
    } else {
      this.noiseBurst(d, t, 0.04, 'bandpass', 2800, 6, 0.35)
      this.noiseBurst(d, t + 0.09, 0.06, 'bandpass', 1900, 4, 0.3)
    }
  }

  zombieHit(pos: Vec3, headshot: boolean, killed: boolean) {
    const d = this.out(pos, 14)
    if (!d) return
    const t = this.ctx!.currentTime
    this.noiseBurst(d, t, 0.08, 'lowpass', 500, 1, 0.6)
    this.tone(d, t, 0.1, 'sine', 110, 55, 0.4)
    if (headshot) this.noiseBurst(d, t, 0.05, 'bandpass', 2600, 3, 0.35)
    if (killed) this.groan(pos, 0.7, true)
  }

  /** Low throaty moan. `death` makes it short and falling. */
  groan(pos: Vec3, vol = 1, death = false) {
    const d = this.out(pos, 9)
    if (!d) return
    const ctx = this.ctx!
    const t = ctx.currentTime
    const dur = death ? 0.6 : 0.9 + Math.random() * 0.8
    const base = 70 + Math.random() * 45
    const o = ctx.createOscillator()
    o.type = 'sawtooth'
    o.frequency.setValueAtTime(base * (death ? 1.3 : 1), t)
    o.frequency.linearRampToValueAtTime(base * (death ? 0.6 : 0.85 + Math.random() * 0.3), t + dur)
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 5 + Math.random() * 4
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = base * 0.06
    lfo.connect(lfoGain).connect(o.frequency)
    const formant = ctx.createBiquadFilter()
    formant.type = 'bandpass'
    formant.frequency.value = 420 + Math.random() * 300
    formant.Q.value = 3
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 900
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.35 * vol, t + 0.15)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(formant).connect(lp).connect(g).connect(d)
    o.start(t)
    lfo.start(t)
    o.stop(t + dur + 0.05)
    lfo.stop(t + dur + 0.05)
    this.noiseBurst(d, t, dur * 0.8, 'bandpass', 700, 1.5, 0.05 * vol)
  }

  zombieAttack(pos: Vec3) {
    const d = this.out(pos, 8)
    if (!d) return
    const t = this.ctx!.currentTime
    this.groan(pos, 1.2)
    this.noiseBurst(d, t + 0.4, 0.15, 'bandpass', 600, 1, 0.3, 1600)
  }

  spawn(pos: Vec3) {
    const d = this.out(pos, 12)
    if (!d) return
    this.noiseBurst(d, this.ctx!.currentTime, 0.8, 'lowpass', 300, 0.7, 0.25)
  }

  playerHit() {
    const d = this.out(null)
    if (!d) return
    const t = this.ctx!.currentTime
    this.tone(d, t, 0.25, 'sine', 90, 40, 0.7)
    this.noiseBurst(d, t, 0.15, 'lowpass', 400, 1, 0.5)
  }

  heartbeat(now: number) {
    if (now - this.lastHeartbeat < 0.85) return
    this.lastHeartbeat = now
    const d = this.out(null)
    if (!d) return
    const t = this.ctx!.currentTime
    this.tone(d, t, 0.14, 'sine', 62, 40, 0.5)
    this.tone(d, t + 0.18, 0.12, 'sine', 55, 38, 0.35)
  }

  melee() {
    const d = this.out(null)
    if (!d) return
    this.noiseBurst(d, this.ctx!.currentTime, 0.18, 'bandpass', 400, 2, 0.35, 1500)
  }

  sting(kind: 'wave' | 'clear' | 'win' | 'fail') {
    const d = this.out(null)
    if (!d) return
    const ctx = this.ctx!
    const t = ctx.currentTime
    if (kind === 'wave') {
      this.tone(d, t, 1.6, 'sawtooth', 55, 52, 0.18)
      this.tone(d, t, 1.6, 'sawtooth', 55.6, 51, 0.14)
      this.noiseBurst(d, t, 1.2, 'bandpass', 180, 2, 0.3)
      this.tone(d, t, 0.9, 'triangle', 220, 207, 0.12)
    } else if (kind === 'clear' || kind === 'win') {
      const notes = kind === 'win' ? [220, 277.2, 329.6, 440] : [220, 261.6, 329.6]
      notes.forEach((f, i) => this.tone(d, t + i * 0.12, 1.4, 'triangle', f, f, 0.12))
    } else {
      this.tone(d, t, 2.4, 'sawtooth', 110, 40, 0.2)
      this.noiseBurst(d, t, 1.5, 'lowpass', 300, 1, 0.3)
    }
  }

  /** Original procedural score: a low drone whose filter opens as the fight heats up. */
  startMusic() {
    const ctx = this.ctx
    if (!ctx || this.drone) return
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 180
    filter.Q.value = 4
    const gain = ctx.createGain()
    gain.gain.value = 0.0001
    gain.gain.setTargetAtTime(0.22, ctx.currentTime, 2)
    filter.connect(gain).connect(this.musicBus)
    const oscs = [55, 55.4, 82.41, 110.2].map((f, i) => {
      const o = ctx.createOscillator()
      o.type = i < 2 ? 'sawtooth' : 'triangle'
      o.frequency.value = f
      const g = ctx.createGain()
      g.gain.value = i < 2 ? 0.35 : 0.18
      o.connect(g).connect(filter)
      o.start()
      return o
    })
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.07
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = 60
    lfo.connect(lfoGain).connect(filter.frequency)
    lfo.start()
    this.drone = {
      filter,
      gain,
      stop: () => {
        const t = ctx.currentTime
        gain.gain.setTargetAtTime(0.0001, t, 0.6)
        for (const o of [...oscs, lfo]) o.stop(t + 3)
      },
    }
  }

  stopMusic() {
    this.drone?.stop()
    this.drone = null
  }

  /** 0 = calm, 1 = heavy fighting. */
  setIntensity(v: number) {
    const ctx = this.ctx
    if (!ctx || !this.drone) return
    if (Math.abs(v - this.intensity) < 0.02) return
    this.intensity = v
    this.drone.filter.frequency.setTargetAtTime(180 + v * 700, ctx.currentTime, 0.8)
    this.drone.gain.gain.setTargetAtTime(0.18 + v * 0.14, ctx.currentTime, 0.8)
  }
}
