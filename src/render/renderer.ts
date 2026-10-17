import * as THREE from 'three'
import { getCharacter } from '../data/characters'
import { ZOMBIES } from '../data/enemies'
import { cameraRig, FOV_AIM, FOV_HIP } from '../sim/camera'
import { lerp, wrapAngle, type Vec3 } from '../sim/math'
import type { MapDef, PlayerState, SimEvent, WorldState, ZombieState } from '../sim/types'
import { RISE_TIME } from '../sim/zombie'
import { Effects } from './effects'
import { buildMap, type MapView } from './map'
import { buildHumanoid, buildPistol, infectedOutfit, type HumanoidRig } from './models'

/** Positions captured before the latest sim step, for render interpolation. */
export type Snapshot = Map<string, { x: number; z: number; facing: number }>

export const snapshotOf = (s: WorldState): Snapshot => {
  const m: Snapshot = new Map()
  for (const p of s.players) m.set(`p:${p.id}`, { x: p.pos.x, z: p.pos.z, facing: p.facing })
  for (const z of s.zombies) m.set(`z:${z.id}`, { x: z.pos.x, z: z.pos.z, facing: z.facing })
  return m
}

interface PlayerView {
  rig: HumanoidRig
  muzzle: THREE.Object3D
  gait: number
  recoil: number
  meleeT: number
  reloadT: number
}

interface ZombieView {
  rig: HumanoidRig
  gait: number
  gaitRate: number
  flash: number
  lean: number
  armSpread: number
}

export interface ViewState {
  yaw: number
  pitch: number
  localId: string
}

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(FOV_HIP, 1, 0.05, 220)
  private mapView: MapView
  private effects = new Effects()
  private players = new Map<string, PlayerView>()
  private zombies = new Map<number, ZombieView>()
  private moon: THREE.DirectionalLight
  private fill: THREE.PointLight
  private shake = 0
  private time = 0
  private tmp = new THREE.Vector3()

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly map: MapDef,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.3
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap

    const t = map.theme
    this.scene.background = new THREE.Color(t.sky)
    this.scene.fog = new THREE.FogExp2(t.fog, t.fogDensity)
    this.scene.add(new THREE.HemisphereLight(t.ambient, 0x0d0d0f, t.ambientIntensity))
    this.moon = new THREE.DirectionalLight(t.moon, t.moonIntensity)
    this.moon.position.set(-30, 50, -20)
    this.moon.castShadow = true
    this.moon.shadow.mapSize.set(2048, 2048)
    const sc = this.moon.shadow.camera
    sc.left = -42
    sc.right = 42
    sc.top = 42
    sc.bottom = -42
    sc.near = 1
    sc.far = 140
    this.moon.shadow.bias = -0.0006
    this.moon.shadow.normalBias = 0.03
    this.scene.add(this.moon, this.moon.target)

    // Soft fill that travels with the camera so dark tracksuits stay readable up close.
    this.fill = new THREE.PointLight(0xc8d2e6, 5, 16, 1.2)
    this.camera.add(this.fill)
    this.fill.position.set(0, 0.6, 0.4)
    this.scene.add(this.camera)
    this.scene.add(buildSky(t.sky, t.fog))

    this.mapView = buildMap(map)
    this.scene.add(this.mapView.group)
    this.scene.add(this.effects.group)
    this.resize()
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / Math.max(1, h)
    this.camera.updateProjectionMatrix()
    const buf = this.renderer.getDrawingBufferSize(new THREE.Vector2())
    this.effects.setViewport(buf.y, this.camera.fov)
  }

  /** React to one-shot sim events with effects. */
  handleEvents(events: SimEvent[], localId: string) {
    for (const e of events) {
      switch (e.type) {
        case 'shot': {
          const pv = this.players.get(e.playerId)
          const from = pv ? pv.muzzle.getWorldPosition(this.tmp).clone() : e.muzzle
          this.effects.muzzleFlash(from)
          this.effects.tracer(from, e.end)
          if (e.hit === 'world') this.effects.impactWorld(e.end, e.normal)
          if (pv) pv.recoil = 1
          if (e.playerId === localId) this.shake = Math.max(this.shake, 0.05)
          break
        }
        case 'zombieHit': {
          if (!e.melee) this.effects.impactZombie(e.pos, e.headshot, e.killed)
          const zv = this.zombies.get(e.zombieId)
          if (zv) zv.flash = 1
          break
        }
        case 'zombieSpawn':
          this.effects.spawnDust(e.pos)
          break
        case 'melee': {
          const pv = this.players.get(e.playerId)
          if (pv) pv.meleeT = 1
          break
        }
        case 'reloadStart': {
          const pv = this.players.get(e.playerId)
          if (pv) pv.reloadT = e.duration
          break
        }
        case 'playerHit':
          if (e.playerId === localId) this.shake = Math.max(this.shake, 0.22)
          break
      }
    }
  }

  /** Remove every entity and effect (encounter restart). */
  clearEntities() {
    for (const v of this.players.values()) this.disposeRig(v.rig)
    for (const v of this.zombies.values()) this.disposeRig(v.rig)
    this.players.clear()
    this.zombies.clear()
    this.effects.clear()
  }

  /** Draw a frame. `cinematic` overrides the gameplay camera (title screen, death cam). */
  render(state: WorldState, prev: Snapshot | null, alpha: number, view: ViewState, dt: number, cinematic?: { pos: Vec3; target: Vec3 }) {
    this.time += dt
    this.syncPlayers(state, prev, alpha, view, dt)
    this.syncZombies(state, prev, alpha, dt)
    this.effects.update(dt)
    if (cinematic) {
      this.camera.position.set(cinematic.pos.x, cinematic.pos.y, cinematic.pos.z)
      this.camera.lookAt(cinematic.target.x, cinematic.target.y, cinematic.target.z)
      if (Math.abs(this.camera.fov - FOV_HIP) > 0.01) {
        this.camera.fov = FOV_HIP
        this.camera.updateProjectionMatrix()
      }
      this.moon.target.position.set(cinematic.target.x, 0, cinematic.target.z)
      this.moon.position.set(cinematic.target.x - 30, 50, cinematic.target.z - 20)
    } else {
      this.updateCamera(state, prev, alpha, view, dt)
    }
    for (const l of this.mapView.lamps) {
      const f = 1 + Math.sin(this.time * 9 + l.phase) * 0.015 + (Math.sin(this.time * 31 + l.phase * 3) > 0.995 ? -0.5 : 0)
      l.light.intensity = l.base * f
    }
    this.renderer.render(this.scene, this.camera)
  }

  private interp(prev: Snapshot | null, key: string, x: number, z: number, facing: number, alpha: number) {
    const p = prev?.get(key)
    if (!p) return { x, z, facing }
    return { x: lerp(p.x, x, alpha), z: lerp(p.z, z, alpha), facing: p.facing + wrapAngle(facing - p.facing) * alpha }
  }

  private updateCamera(state: WorldState, prev: Snapshot | null, alpha: number, view: ViewState, dt: number) {
    const me = state.players.find((p) => p.id === view.localId)
    if (!me) return
    const ip = this.interp(prev, `p:${me.id}`, me.pos.x, me.pos.z, me.facing, alpha)
    const pos: Vec3 = { x: ip.x, y: 0, z: ip.z }
    const rig = cameraRig(this.map, pos, view.yaw, view.pitch, me.aimBlend)
    this.camera.position.set(rig.pos.x, rig.pos.y, rig.pos.z)
    this.camera.lookAt(rig.pos.x + rig.dir.x, rig.pos.y + rig.dir.y, rig.pos.z + rig.dir.z)
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.6)
      const s = this.shake * this.shake
      this.camera.rotation.x += (Math.random() - 0.5) * s * 0.5
      this.camera.rotation.y += (Math.random() - 0.5) * s * 0.5
    }
    const fov = lerp(FOV_HIP, FOV_AIM, me.aimBlend) + (me.sprinting ? 4 : 0)
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = lerp(this.camera.fov, fov, Math.min(1, dt * 14))
      this.camera.updateProjectionMatrix()
      this.effects.setViewport(this.renderer.getDrawingBufferSize(new THREE.Vector2()).y, this.camera.fov)
    }
    // Keep the shadow frustum centred on the action.
    this.moon.target.position.set(pos.x, 0, pos.z)
    this.moon.position.set(pos.x - 30, 50, pos.z - 20)
  }

  private syncPlayers(state: WorldState, prev: Snapshot | null, alpha: number, view: ViewState, dt: number) {
    const seen = new Set<string>()
    for (const p of state.players) {
      seen.add(p.id)
      let v = this.players.get(p.id)
      if (!v) {
        const rig = buildHumanoid({ outfit: getCharacter(p.characterId).outfit })
        const muzzle = buildPistol(rig.handR)
        this.scene.add(rig.root)
        v = { rig, muzzle, gait: 0, recoil: 0, meleeT: 0, reloadT: 0 }
        this.players.set(p.id, v)
      }
      const ip = this.interp(prev, `p:${p.id}`, p.pos.x, p.pos.z, p.facing, alpha)
      v.rig.root.position.set(ip.x, 0, ip.z)
      v.rig.root.rotation.y = ip.facing
      animatePlayer(v, p, p.id === view.localId ? view.pitch : p.pitch, dt)
    }
    for (const [id, v] of this.players) {
      if (!seen.has(id)) {
        this.disposeRig(v.rig)
        this.players.delete(id)
      }
    }
  }

  private syncZombies(state: WorldState, prev: Snapshot | null, alpha: number, dt: number) {
    const seen = new Set<number>()
    for (const z of state.zombies) {
      seen.add(z.id)
      let v = this.zombies.get(z.id)
      if (!v) {
        const s = z.seed
        const scale = 0.94 + ((s % 1000) / 1000) * 0.12
        const rig = buildHumanoid({ outfit: infectedOutfit(s), scale, eyeGlow: 0x8a1c12 })
        this.scene.add(rig.root)
        v = {
          rig,
          gait: (s % 628) / 100,
          gaitRate: 0.9 + ((s >> 3) % 100) / 400,
          flash: 0,
          lean: 0.15 + ((s >> 5) % 100) / 500,
          armSpread: ((s >> 7) % 100) / 100,
        }
        this.zombies.set(z.id, v)
      }
      const ip = this.interp(prev, `z:${z.id}`, z.pos.x, z.pos.z, z.facing, alpha)
      v.rig.root.position.set(ip.x, 0, ip.z)
      v.rig.root.rotation.y = ip.facing
      animateZombie(v, z, dt)
    }
    for (const [id, v] of this.zombies) {
      if (!seen.has(id)) {
        this.disposeRig(v.rig)
        this.zombies.delete(id)
      }
    }
  }

  private disposeRig(rig: HumanoidRig) {
    this.scene.remove(rig.root)
    rig.dispose()
  }

  dispose() {
    this.clearEntities()
    this.mapView.dispose()
    this.effects.dispose()
    this.renderer.dispose()
  }
}

/** Gradient sky dome: deep blue-black overhead, sodium-orange city glow at the horizon. */
function buildSky(top: number, horizon: number): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(top) },
      horizon: { value: new THREE.Color(horizon) },
      glow: { value: new THREE.Color(0x3a2618) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top;
      uniform vec3 horizon;
      uniform vec3 glow;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 c = mix(horizon, top, smoothstep(0.0, 0.45, h));
        c += glow * pow(1.0 - h, 6.0) * 0.9;
        gl_FragColor = vec4(c, 1.0);
      }`,
  })
  const sky = new THREE.Mesh(new THREE.SphereGeometry(180, 24, 12), mat)
  sky.renderOrder = -1
  return sky
}

// ---------------------------------------------------------------------------
// Procedural animation
// ---------------------------------------------------------------------------

function animatePlayer(v: PlayerView, p: PlayerState, pitch: number, dt: number) {
  const r = v.rig
  const speed = Math.hypot(p.vel.x, p.vel.z)
  if (!p.alive) {
    // Collapse forward and stay down.
    r.body.rotation.x = lerp(r.body.rotation.x, -1.45, Math.min(1, dt * 5))
    r.body.position.y = lerp(r.body.position.y, 0.15, Math.min(1, dt * 5))
    r.armR.rotation.x = lerp(r.armR.rotation.x, 2.6, dt * 4)
    r.armL.rotation.x = lerp(r.armL.rotation.x, 2.6, dt * 4)
    return
  }
  r.body.rotation.x = 0
  r.body.position.y = 0
  v.gait += dt * speed * (p.sprinting ? 1.55 : 1.9)
  const stride = Math.min(1, speed / 4.4) * (p.sprinting ? 0.85 : 0.6)
  const s = Math.sin(v.gait * 2)
  // Local velocity relative to facing, so strafing doesn't look like a moonwalk.
  const fx = -Math.sin(p.facing)
  const fz = -Math.cos(p.facing)
  const fwd = speed > 0.1 ? (p.vel.x * fx + p.vel.z * fz) / speed : 1
  const dir = fwd < -0.3 ? -1 : 1
  r.legL.rotation.x = s * stride * dir
  r.legR.rotation.x = -s * stride * dir
  r.shinL.rotation.x = Math.max(0, -Math.sin(v.gait * 2 + 0.6)) * stride * 1.4
  r.shinR.rotation.x = Math.max(0, Math.sin(v.gait * 2 + 0.6)) * stride * 1.4
  r.hips.position.y = 0.94 + Math.abs(Math.cos(v.gait * 2)) * 0.035 * stride
  r.torso.rotation.x = p.sprinting ? 0.22 : 0.04

  v.recoil = Math.max(0, v.recoil - dt * 9)
  v.meleeT = Math.max(0, v.meleeT - dt * 3.2)
  v.reloadT = Math.max(0, v.reloadT - dt)

  const combat = p.aimBlend > 0.05 || p.sinceShot < 0.7
  const k = Math.min(1, dt * 16)
  if (v.meleeT > 0) {
    // Shove: both arms punch forward.
    const t = Math.sin((1 - v.meleeT) * Math.PI)
    r.armR.rotation.set(lerp(0.3, 1.5, t), 0, -0.3 * t)
    r.armL.rotation.set(lerp(0.3, 1.6, t), 0, 0.45 * t)
    r.foreR.rotation.x = lerp(1.2, 0.1, t)
    r.foreL.rotation.x = lerp(1.2, 0.1, t)
    r.torso.rotation.y = -0.25 * t
    return
  }
  r.torso.rotation.y = lerp(r.torso.rotation.y, combat ? -0.12 : 0, k)
  if (v.reloadT > 0) {
    // Gun tipped in toward the chest, support hand swaps the mag.
    const t = Math.sin(Math.min(1, v.reloadT * 1.5) * Math.PI)
    r.armR.rotation.set(lerp(r.armR.rotation.x, 0.9, k), 0, lerp(r.armR.rotation.z, 0.35, k))
    r.foreR.rotation.x = lerp(r.foreR.rotation.x, 1.0, k)
    r.armL.rotation.set(0.6 + t * 0.5, 0, 0.5)
    r.foreL.rotation.x = 1.1 - t * 0.4
    return
  }
  if (combat) {
    const up = Math.PI / 2 + pitch + v.recoil * 0.18
    r.armR.rotation.set(lerp(r.armR.rotation.x, up, k), 0, lerp(r.armR.rotation.z, -0.1, k))
    r.foreR.rotation.x = lerp(r.foreR.rotation.x, 0.02 + v.recoil * 0.12, k)
    r.armL.rotation.set(lerp(r.armL.rotation.x, up - 0.05, k), 0, lerp(r.armL.rotation.z, 0.5, k))
    r.foreL.rotation.x = lerp(r.foreL.rotation.x, 0.35, k)
    r.head.rotation.x = -pitch * 0.5
  } else {
    // Low ready, off hand swings with the stride.
    r.armR.rotation.set(lerp(r.armR.rotation.x, 0.35 + s * 0.08 * stride, k), 0, lerp(r.armR.rotation.z, -0.05, k))
    r.foreR.rotation.x = lerp(r.foreR.rotation.x, 0.75, k)
    r.armL.rotation.set(lerp(r.armL.rotation.x, -s * stride * 0.9, k), 0, lerp(r.armL.rotation.z, 0.06, k))
    r.foreL.rotation.x = lerp(r.foreL.rotation.x, 0.25 + stride * 0.4, k)
    r.head.rotation.x = lerp(r.head.rotation.x, 0, k)
  }
}

function animateZombie(v: ZombieView, z: ZombieState, dt: number) {
  const r = v.rig
  const a = ZOMBIES[z.archetype]
  v.flash = Math.max(0, v.flash - dt * 7)
  for (const m of r.flashMats) m.emissive.setRGB(v.flash * 0.6, v.flash * 0.12, v.flash * 0.08)

  if (z.mode === 'rising') {
    const t = Math.min(1, z.modeTime / RISE_TIME)
    const e = 1 - (1 - t) * (1 - t)
    r.body.position.y = lerp(-1.5, 0, e)
    r.body.rotation.x = lerp(0.5, v.lean * 0.6, e)
    r.armR.rotation.x = lerp(2.8, 1.3, e)
    r.armL.rotation.x = lerp(2.6, 1.1, e)
    return
  }
  if (z.mode === 'dead') {
    // Fall away from the killing blow, then sink into the ground before despawn.
    const t = Math.min(1, z.modeTime / 0.55)
    const fall = t * t
    const local = z.deathDir
    // Convert world death direction into the model's frame (model faces -Z at rotation.y = facing).
    const c = Math.cos(z.facing)
    const sn = Math.sin(z.facing)
    const lx = local.x * c - local.z * sn
    const lz = local.x * sn + local.z * c
    r.body.rotation.x = lz * fall * 1.45
    r.body.rotation.z = -lx * fall * 1.45
    r.body.position.y = z.modeTime > 5 ? -(z.modeTime - 5) * 0.35 : 0
    r.armL.rotation.x = lerp(r.armL.rotation.x, 2.2, Math.min(1, dt * 6))
    r.armR.rotation.x = lerp(r.armR.rotation.x, 2.0, Math.min(1, dt * 6))
    r.legL.rotation.x = lerp(r.legL.rotation.x, 0.3, Math.min(1, dt * 6))
    return
  }
  r.body.position.y = 0
  r.body.rotation.z = 0
  const speed = Math.hypot(z.vel.x, z.vel.z)
  v.gait += dt * speed * 2.2 * v.gaitRate
  const s = Math.sin(v.gait * 2)
  const stride = Math.min(1, speed / a.speed) * 0.55
  r.legL.rotation.x = s * stride
  r.legR.rotation.x = -s * stride
  r.shinL.rotation.x = Math.max(0, -Math.sin(v.gait * 2 + 0.6)) * stride * 1.2
  r.shinR.rotation.x = Math.max(0, Math.sin(v.gait * 2 + 0.6)) * stride * 1.2
  // A shambling hitch: the hips lurch and the head lolls.
  r.hips.position.y = 0.94 + Math.abs(Math.cos(v.gait * 2)) * 0.04 * stride
  r.hips.rotation.z = Math.sin(v.gait * 2) * 0.06
  r.head.rotation.z = Math.sin(v.gait * 0.7 + v.armSpread * 3) * 0.18
  const k = Math.min(1, dt * 10)

  if (z.mode === 'attack') {
    const t = z.modeTime / a.attackWindup
    if (t < 1) {
      // Wind up: arms rise high and back.
      r.armR.rotation.x = lerp(r.armR.rotation.x, 2.7, k)
      r.armL.rotation.x = lerp(r.armL.rotation.x, 2.5, k)
      r.body.rotation.x = lerp(r.body.rotation.x, -0.1, k)
    } else {
      // Swipe down and forward.
      r.armR.rotation.x = lerp(r.armR.rotation.x, 0.9, Math.min(1, dt * 22))
      r.armL.rotation.x = lerp(r.armL.rotation.x, 1.1, Math.min(1, dt * 22))
      r.body.rotation.x = lerp(r.body.rotation.x, 0.45, Math.min(1, dt * 18))
    }
    return
  }
  if (z.mode === 'stagger') {
    const t = Math.sin(Math.min(1, z.modeTime / a.staggerTime) * Math.PI)
    r.body.rotation.x = lerp(v.lean, -0.35, t)
    r.head.rotation.x = -0.5 * t
    r.armR.rotation.x = lerp(r.armR.rotation.x, 0.4, k)
    r.armL.rotation.x = lerp(r.armL.rotation.x, 0.6, k)
    return
  }
  // Chase: classic reaching arms, uneven.
  r.body.rotation.x = lerp(r.body.rotation.x, v.lean, k)
  r.head.rotation.x = lerp(r.head.rotation.x, -0.2, k)
  r.armR.rotation.x = lerp(r.armR.rotation.x, 1.25 + s * 0.12 + v.armSpread * 0.3, k)
  r.armL.rotation.x = lerp(r.armL.rotation.x, 1.05 - s * 0.12, k)
  r.armR.rotation.z = -0.12 - v.armSpread * 0.15
  r.armL.rotation.z = 0.12 + v.armSpread * 0.1
  r.foreR.rotation.x = 0.25
  r.foreL.rotation.x = 0.35
}
