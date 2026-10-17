import * as THREE from 'three'
import type { Vec3 } from '../sim/math'

// Pooled, allocation-free combat effects: tracers, muzzle flashes, particle bursts, bullet holes.

const MAX_PARTICLES = 700
const MAX_TRACERS = 24
const MAX_DECALS = 80

function dotTexture(soft: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(soft ? 0.3 : 0.5, soft ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.9)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function flashTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  g.translate(64, 64)
  const grad = g.createRadialGradient(0, 0, 0, 0, 0, 60)
  grad.addColorStop(0, 'rgba(255,250,230,1)')
  grad.addColorStop(0.25, 'rgba(255,200,110,0.9)')
  grad.addColorStop(1, 'rgba(255,120,30,0)')
  g.fillStyle = grad
  for (let i = 0; i < 6; i++) {
    g.rotate(Math.PI / 3)
    g.beginPath()
    g.moveTo(0, -8)
    g.lineTo(60, 0)
    g.lineTo(0, 8)
    g.fill()
  }
  g.beginPath()
  g.arc(0, 0, 26, 0, Math.PI * 2)
  g.fill()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** A CPU particle pool rendered as one THREE.Points draw call. */
class ParticlePool {
  readonly points: THREE.Points
  private pos: Float32Array
  private col: Float32Array
  private alpha: Float32Array
  private size: Float32Array
  private vel: Float32Array
  private life: Float32Array
  private maxLife: Float32Array
  private baseCol: Float32Array
  private baseSize: Float32Array
  private gravity: Float32Array
  private drag: Float32Array
  private next = 0

  constructor(blending: THREE.Blending, texture: THREE.Texture, private readonly fadeColor: boolean) {
    const n = MAX_PARTICLES
    this.pos = new Float32Array(n * 3)
    this.col = new Float32Array(n * 3)
    this.alpha = new Float32Array(n)
    this.size = new Float32Array(n)
    this.vel = new Float32Array(n * 3)
    this.life = new Float32Array(n)
    this.maxLife = new Float32Array(n).fill(1)
    this.baseCol = new Float32Array(n * 3)
    this.baseSize = new Float32Array(n)
    this.gravity = new Float32Array(n)
    this.drag = new Float32Array(n)
    for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = -999
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage))
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage))
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage))
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, scale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float alpha;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float scale;
        void main() {
          vColor = color;
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 t = texture2D(map, gl_PointCoord);
          float a = t.a * vAlpha;
          if (a < 0.02) discard;
          gl_FragColor = vec4(vColor * t.rgb, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending,
    })
    this.points = new THREE.Points(geo, mat)
    this.points.frustumCulled = false
  }

  setScale(viewportHeight: number, fovDeg: number) {
    const s = viewportHeight / (2 * Math.tan((fovDeg * Math.PI) / 360))
    ;(this.points.material as THREE.ShaderMaterial).uniforms.scale.value = s
  }

  emit(p: Vec3, v: Vec3, color: THREE.Color, size: number, life: number, gravity: number, drag: number) {
    const i = this.next
    this.next = (this.next + 1) % MAX_PARTICLES
    this.pos.set([p.x, p.y, p.z], i * 3)
    this.vel.set([v.x, v.y, v.z], i * 3)
    this.baseCol.set([color.r, color.g, color.b], i * 3)
    this.col.set([color.r, color.g, color.b], i * 3)
    this.baseSize[i] = size
    this.size[i] = size
    this.alpha[i] = 1
    this.life[i] = life
    this.maxLife[i] = life
    this.gravity[i] = gravity
    this.drag[i] = drag
  }

  update(dt: number) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i] <= 0) continue
      this.life[i] -= dt
      const k = i * 3
      if (this.life[i] <= 0) {
        this.pos[k + 1] = -999
        this.size[i] = 0
        this.alpha[i] = 0
        continue
      }
      const d = Math.max(0, 1 - this.drag[i] * dt)
      this.vel[k] *= d
      this.vel[k + 1] = this.vel[k + 1] * d - this.gravity[i] * dt
      this.vel[k + 2] *= d
      this.pos[k] += this.vel[k] * dt
      this.pos[k + 1] += this.vel[k + 1] * dt
      this.pos[k + 2] += this.vel[k + 2] * dt
      if (this.pos[k + 1] < 0.02) {
        this.pos[k + 1] = 0.02
        this.vel[k + 1] *= -0.25
      }
      const t = this.life[i] / this.maxLife[i]
      const fade = this.fadeColor ? t : 1
      // Smoke and mist thin out instead of popping; a quick fade-in avoids hard spawns.
      this.alpha[i] = Math.min(1, t * 2.2) * Math.min(1, (1 - t) * 12 + 0.25)
      this.col[k] = this.baseCol[k] * fade
      this.col[k + 1] = this.baseCol[k + 1] * fade
      this.col[k + 2] = this.baseCol[k + 2] * fade
      // Smoke/mist grows as it fades; sparks shrink.
      this.size[i] = this.fadeColor ? this.baseSize[i] * (0.4 + 0.6 * t) : this.baseSize[i] * (1.6 - 0.6 * t)
    }
    const g = this.points.geometry
    g.attributes.position.needsUpdate = true
    g.attributes.color.needsUpdate = true
    g.attributes.size.needsUpdate = true
    g.attributes.alpha.needsUpdate = true
  }

  dispose() {
    this.points.geometry.dispose()
    ;(this.points.material as THREE.Material).dispose()
  }
}

interface Tracer {
  mesh: THREE.Mesh
  life: number
}

export class Effects {
  readonly group = new THREE.Group()
  private sparks: ParticlePool
  private mist: ParticlePool
  private tracers: Tracer[] = []
  private tracerNext = 0
  private flash: THREE.Sprite
  private flashLight: THREE.PointLight
  private flashLife = 0
  private decals: THREE.InstancedMesh
  private decalNext = 0
  private decalObj = new THREE.Object3D()
  private textures: THREE.Texture[] = []
  private tmpColor = new THREE.Color()

  constructor() {
    const hard = dotTexture(false)
    const soft = dotTexture(true)
    const fl = flashTexture()
    this.textures.push(hard, soft, fl)
    this.sparks = new ParticlePool(THREE.AdditiveBlending, hard, true)
    this.mist = new ParticlePool(THREE.NormalBlending, soft, false)
    this.group.add(this.sparks.points, this.mist.points)

    const tracerGeo = new THREE.BoxGeometry(0.018, 0.018, 1)
    tracerGeo.translate(0, 0, -0.5)
    const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })
    for (let i = 0; i < MAX_TRACERS; i++) {
      const m = new THREE.Mesh(tracerGeo, tracerMat.clone())
      m.visible = false
      this.group.add(m)
      this.tracers.push({ mesh: m, life: 0 })
    }

    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: fl, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }))
    this.flash.scale.setScalar(0.45)
    this.flash.visible = false
    this.group.add(this.flash)
    this.flashLight = new THREE.PointLight(0xffb060, 0, 9, 2)
    this.group.add(this.flashLight)

    const holeTex = dotTexture(false)
    this.textures.push(holeTex)
    const holeMat = new THREE.MeshBasicMaterial({ map: holeTex, color: 0x050505, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 })
    // All bullet holes in one instanced draw; unused slots are scaled to zero.
    this.decals = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.09, 0.09), holeMat, MAX_DECALS)
    this.decals.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.decals.frustumCulled = false
    this.clearDecals()
    this.group.add(this.decals)
  }

  private clearDecals() {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0)
    for (let i = 0; i < MAX_DECALS; i++) this.decals.setMatrixAt(i, zero)
    this.decals.instanceMatrix.needsUpdate = true
  }

  /** Make every pooled effect drawable for one compile pass, so first use never stalls on a shader compile. */
  warmup(): () => void {
    this.flash.visible = true
    this.tracers[0].mesh.visible = true
    return () => {
      this.flash.visible = false
      this.tracers[0].mesh.visible = false
    }
  }

  setViewport(height: number, fov: number) {
    this.sparks.setScale(height, fov)
    this.mist.setScale(height, fov)
  }

  muzzleFlash(at: Vec3) {
    this.flash.position.set(at.x, at.y, at.z)
    this.flash.material.rotation = Math.random() * Math.PI
    this.flash.scale.setScalar(0.35 + Math.random() * 0.2)
    this.flash.visible = true
    this.flashLight.position.set(at.x, at.y, at.z)
    this.flashLight.intensity = 6
    this.flashLife = 0.05
    for (let i = 0; i < 3; i++) {
      this.mist.emit(at, { x: (Math.random() - 0.5) * 0.6, y: 0.4 + Math.random() * 0.4, z: (Math.random() - 0.5) * 0.6 }, this.tmpColor.setRGB(0.22, 0.22, 0.23), 0.12, 0.5, -0.2, 2)
    }
  }

  tracer(from: Vec3, to: Vec3) {
    const t = this.tracers[this.tracerNext]
    this.tracerNext = (this.tracerNext + 1) % MAX_TRACERS
    const dx = to.x - from.x
    const dy = to.y - from.y
    const dz = to.z - from.z
    const len = Math.hypot(dx, dy, dz)
    if (len < 0.3) return
    t.mesh.position.set(from.x, from.y, from.z)
    t.mesh.lookAt(from.x - dx, from.y - dy, from.z - dz)
    t.mesh.scale.set(1, 1, len)
    t.mesh.visible = true
    t.life = 0.06
    ;(t.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85
  }

  impactWorld(at: Vec3, normal: Vec3 | null) {
    const n = normal ?? { x: 0, y: 1, z: 0 }
    for (let i = 0; i < 7; i++) {
      this.sparks.emit(
        at,
        { x: n.x * 2 + (Math.random() - 0.5) * 4, y: n.y * 2 + Math.random() * 3, z: n.z * 2 + (Math.random() - 0.5) * 4 },
        this.tmpColor.setRGB(1, 0.75, 0.4),
        0.035,
        0.25 + Math.random() * 0.2,
        9,
        1,
      )
    }
    for (let i = 0; i < 4; i++) {
      this.mist.emit(
        at,
        { x: n.x * 0.8 + (Math.random() - 0.5) * 0.6, y: n.y * 0.8 + Math.random() * 0.5, z: n.z * 0.8 + (Math.random() - 0.5) * 0.6 },
        this.tmpColor.setRGB(0.32, 0.31, 0.3),
        0.22,
        0.7,
        -0.1,
        2.5,
      )
    }
    if (normal) this.decal(at, normal)
  }

  impactZombie(at: Vec3, headshot: boolean, killed: boolean) {
    const n = headshot ? 9 : 6
    for (let i = 0; i < n; i++) {
      this.mist.emit(
        at,
        { x: (Math.random() - 0.5) * 2.2, y: Math.random() * 1.8, z: (Math.random() - 0.5) * 2.2 },
        this.tmpColor.setRGB(0.22 + Math.random() * 0.08, 0.03, 0.03),
        headshot ? 0.2 : 0.15,
        0.45 + Math.random() * 0.3,
        3,
        2.5,
      )
    }
    if (killed) {
      for (let i = 0; i < 10; i++) {
        this.mist.emit(
          { x: at.x, y: 0.3, z: at.z },
          { x: (Math.random() - 0.5) * 1.5, y: Math.random() * 0.8, z: (Math.random() - 0.5) * 1.5 },
          this.tmpColor.setRGB(0.18, 0.17, 0.16),
          0.35,
          1.1,
          -0.05,
          1.8,
        )
      }
    }
  }

  spawnDust(at: Vec3) {
    for (let i = 0; i < 14; i++) {
      this.mist.emit(
        { x: at.x + (Math.random() - 0.5) * 0.8, y: 0.1, z: at.z + (Math.random() - 0.5) * 0.8 },
        { x: (Math.random() - 0.5) * 1.2, y: 0.5 + Math.random() * 0.8, z: (Math.random() - 0.5) * 1.2 },
        this.tmpColor.setRGB(0.2, 0.19, 0.18),
        0.4,
        1.2,
        -0.1,
        1.5,
      )
    }
  }

  private decal(at: Vec3, normal: Vec3) {
    const d = this.decalObj
    d.position.set(at.x + normal.x * 0.01, at.y + normal.y * 0.01, at.z + normal.z * 0.01)
    d.lookAt(at.x + normal.x, at.y + normal.y, at.z + normal.z)
    d.rotateZ(Math.random() * Math.PI)
    d.scale.setScalar(0.7 + Math.random() * 0.6)
    d.updateMatrix()
    this.decals.setMatrixAt(this.decalNext, d.matrix)
    this.decals.instanceMatrix.needsUpdate = true
    this.decalNext = (this.decalNext + 1) % MAX_DECALS
  }

  update(dt: number) {
    this.sparks.update(dt)
    this.mist.update(dt)
    for (const t of this.tracers) {
      if (t.life <= 0) continue
      t.life -= dt
      ;(t.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, t.life / 0.06) * 0.85
      if (t.life <= 0) t.mesh.visible = false
    }
    if (this.flashLife > 0) {
      this.flashLife -= dt
      this.flashLight.intensity = Math.max(0, this.flashLife / 0.05) * 6
      if (this.flashLife <= 0) {
        this.flash.visible = false
        this.flashLight.intensity = 0
      }
    }
  }

  clear() {
    this.clearDecals()
    for (const t of this.tracers) {
      t.life = 0
      t.mesh.visible = false
    }
  }

  dispose() {
    this.sparks.dispose()
    this.mist.dispose()
    for (const t of this.textures) t.dispose()
    this.group.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.geometry) m.geometry.dispose()
      const mat = m.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
      else mat?.dispose()
    })
  }
}
