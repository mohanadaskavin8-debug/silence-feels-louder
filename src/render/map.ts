import * as THREE from 'three'
import type { MapDef, Obstacle } from '../sim/types'
import { bakeStatic } from './bake'

// Builds the visual side of a MapDef. Every texture is drawn on a canvas at load,
// so a territory costs no downloads. Approved art can swap in per material later.

const rand = (seed: number) => {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), s | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  draw(g)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 4
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  return t
}

function speckle(g: CanvasRenderingContext2D, w: number, h: number, n: number, r: () => number, alpha: number, light = false) {
  for (let i = 0; i < n; i++) {
    const v = light ? 200 + r() * 55 : r() * 40
    g.fillStyle = `rgba(${v},${v},${v},${alpha * r()})`
    const s = 1 + r() * 2.5
    g.fillRect(r() * w, r() * h, s, s)
  }
}

function asphaltTexture(): THREE.CanvasTexture {
  const r = rand(7)
  const t = canvasTexture(512, 512, (g) => {
    g.fillStyle = '#2a2b2e'
    g.fillRect(0, 0, 512, 512)
    speckle(g, 512, 512, 9000, r, 0.35)
    speckle(g, 512, 512, 2500, r, 0.08, true)
    // Patches and cracks.
    for (let i = 0; i < 6; i++) {
      g.fillStyle = `rgba(20,20,22,${0.25 + r() * 0.25})`
      g.beginPath()
      g.ellipse(r() * 512, r() * 512, 30 + r() * 70, 20 + r() * 50, r() * 3, 0, Math.PI * 2)
      g.fill()
    }
    g.strokeStyle = 'rgba(10,10,12,0.7)'
    for (let i = 0; i < 14; i++) {
      g.lineWidth = 0.6 + r() * 1.4
      g.beginPath()
      let x = r() * 512
      let y = r() * 512
      g.moveTo(x, y)
      for (let k = 0; k < 8; k++) {
        x += (r() - 0.5) * 50
        y += (r() - 0.5) * 50
        g.lineTo(x, y)
      }
      g.stroke()
    }
  })
  return t
}

function concreteTexture(seed: number, base: string): THREE.CanvasTexture {
  const r = rand(seed)
  return canvasTexture(256, 256, (g) => {
    g.fillStyle = base
    g.fillRect(0, 0, 256, 256)
    speckle(g, 256, 256, 3000, r, 0.25)
    speckle(g, 256, 256, 800, r, 0.06, true)
    g.strokeStyle = 'rgba(0,0,0,0.25)'
    g.lineWidth = 2
    for (let x = 0; x <= 256; x += 128) {
      g.beginPath()
      g.moveTo(x, 0)
      g.lineTo(x, 256)
      g.stroke()
    }
    // Water streaks.
    for (let i = 0; i < 10; i++) {
      const x = r() * 256
      const grad = g.createLinearGradient(0, 0, 0, 256)
      grad.addColorStop(0, 'rgba(0,0,0,0.18)')
      grad.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = grad
      g.fillRect(x, 0, 2 + r() * 6, 80 + r() * 170)
    }
  })
}

interface Facade {
  map: THREE.CanvasTexture
  emissive: THREE.CanvasTexture
  /** Metres covered by one texture tile (u, v). */
  tile: [number, number]
}

const FACADE_BASES = ['#3b302b', '#45403b', '#2f3134', '#4a3a31', '#393836', '#3a3330', '#34363a', '#463d36', '#2d2b2a', '#403a37']

/** Residential block facade: 4 bays x 3 floors per tile, brick or render, windows lit at random. */
function facadeTexture(variant: number): Facade {
  const r = rand(100 + variant * 31)
  const W = 256
  const H = 256
  const lit: boolean[] = []
  const tint: string[] = []
  for (let i = 0; i < 12; i++) {
    lit.push(r() < 0.22)
    tint.push(r() < 0.7 ? '255,190,120' : '170,200,255')
  }
  const base = FACADE_BASES[variant % FACADE_BASES.length]
  const brick = variant % 3 !== 1
  const map = canvasTexture(W, H, (g) => {
    g.fillStyle = base
    g.fillRect(0, 0, W, H)
    if (brick) {
      g.strokeStyle = 'rgba(0,0,0,0.22)'
      g.lineWidth = 1
      for (let y = 0; y < H; y += 6) {
        g.beginPath()
        g.moveTo(0, y)
        g.lineTo(W, y)
        g.stroke()
        for (let x = (y / 6) % 2 ? 0 : 7; x < W; x += 14) {
          g.beginPath()
          g.moveTo(x, y)
          g.lineTo(x, y + 6)
          g.stroke()
        }
      }
    }
    speckle(g, W, H, 2500, r, 0.2)
    // Floor slab lines.
    g.fillStyle = 'rgba(0,0,0,0.3)'
    for (let f = 0; f < 3; f++) g.fillRect(0, f * (H / 3), W, 4)
    for (let f = 0; f < 3; f++) {
      for (let b = 0; b < 4; b++) {
        const x = b * (W / 4) + 14
        const y = f * (H / 3) + 22
        const w = W / 4 - 28
        const h = H / 3 - 40
        g.fillStyle = '#16181b'
        g.fillRect(x - 3, y - 3, w + 6, h + 6) // frame
        g.fillStyle = lit[f * 4 + b] ? `rgb(${tint[f * 4 + b]})` : '#0c0e11'
        g.fillRect(x, y, w, h)
        g.fillStyle = 'rgba(255,255,255,0.05)'
        g.fillRect(x, y, w, h * 0.4)
        g.fillStyle = '#1b1d20'
        g.fillRect(x + w / 2 - 1, y, 2, h) // mullion
        g.fillStyle = 'rgba(0,0,0,0.4)'
        g.fillRect(x - 4, y + h + 3, w + 8, 4) // sill
      }
    }
  })
  const emissive = canvasTexture(W, H, (g) => {
    g.fillStyle = '#000'
    g.fillRect(0, 0, W, H)
    for (let f = 0; f < 3; f++) {
      for (let b = 0; b < 4; b++) {
        if (!lit[f * 4 + b]) continue
        const x = b * (W / 4) + 14
        const y = f * (H / 3) + 22
        g.fillStyle = `rgba(${tint[f * 4 + b]},0.85)`
        g.fillRect(x, y, W / 4 - 28, H / 3 - 40)
      }
    }
  })
  return { map, emissive, tile: [11, 9] }
}

/** Box with UVs scaled to world metres so tiled textures keep a constant size on every face. */
function worldUVBox(w: number, h: number, d: number, tileU: number, tileV: number): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(w, h, d)
  const uv = geo.attributes.uv as THREE.BufferAttribute
  // Face order: +x, -x, +y, -y, +z, -z; 4 verts each.
  const spans: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ]
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v
      uv.setXY(i, (uv.getX(i) * spans[f][0]) / tileU, (uv.getY(i) * spans[f][1]) / tileV)
    }
  }
  return geo
}

export interface MapView {
  group: THREE.Group
  /** Lamp heads (for a subtle flicker). */
  lamps: { light: THREE.PointLight; base: number; mat: THREE.MeshStandardMaterial; phase: number }[]
  /** Static draw calls before/after baking (diagnostics). */
  drawsBefore: number
  drawsAfter: number
  dispose(): void
}

export function buildMap(map: MapDef): MapView {
  const root = new THREE.Group()
  const disposables: { dispose(): void }[] = []
  const track = <T extends { dispose(): void }>(x: T) => {
    disposables.push(x)
    return x
  }

  // --- ground -------------------------------------------------------------
  const asphalt = track(asphaltTexture())
  const groundSize = Math.max(map.halfX, map.halfZ) * 2 + 120
  asphalt.repeat.set(groundSize / 8, groundSize / 8)
  const groundMat = track(new THREE.MeshStandardMaterial({ map: asphalt, color: 0xbfbfbf, roughness: 0.93, metalness: 0 }))
  const ground = new THREE.Mesh(track(new THREE.PlaneGeometry(groundSize, groundSize)), groundMat)
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  root.add(ground)

  // Faded parking bays and a lane line, flush with the ground.
  const paint = track(new THREE.MeshStandardMaterial({ color: 0x8d8a80, roughness: 0.9, transparent: true, opacity: 0.35 }))
  for (const mk of map.markings ?? []) {
    const l = new THREE.Mesh(track(new THREE.PlaneGeometry(mk.w, mk.d)), paint)
    l.rotation.x = -Math.PI / 2
    l.position.set(mk.x, 0.012, mk.z)
    l.receiveShadow = true
    root.add(l)
  }

  // Puddles: dark, glossy, catch the lamp light.
  const puddleMat = track(new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.32, depthWrite: false }))
  const pr = rand(55)
  for (let i = 0; i < 9; i++) {
    const p = new THREE.Mesh(track(new THREE.CircleGeometry(0.8 + pr() * 1.4, 18)), puddleMat)
    p.rotation.x = -Math.PI / 2
    p.scale.set(1, 0.5 + pr() * 0.6, 1)
    p.position.set((pr() - 0.5) * map.halfX * 1.4, 0.015, (pr() - 0.5) * map.halfZ * 1.4)
    p.receiveShadow = true
    root.add(p)
  }

  // Sidewalk strips along the building rows (flush; the sim's ground is flat).
  const curbTex = track(concreteTexture(3, '#4a4a4c'))
  curbTex.repeat.set(8, 1)
  const sidewalkMat = track(new THREE.MeshStandardMaterial({ map: curbTex, color: 0x9a9a9a, roughness: 0.95 }))
  // A sidewalk in front of every building face that looks onto the street.
  let lift = 0
  for (const o of map.obstacles) {
    if (o.kind !== 'building' && o.kind !== 'shop' && o.kind !== 'garage') continue
    const { group: f, width } = faceGroup(root, o)
    const s = new THREE.Mesh(track(new THREE.PlaneGeometry(width, 2.6)), sidewalkMat)
    s.rotation.x = -Math.PI / 2
    // Tiny height steps so overlapping corners never z-fight.
    s.position.set(0, 0.006 + (lift++ % 4) * 0.0015, 1.3)
    s.receiveShadow = true
    f.add(s)
  }

  // --- obstacles ------------------------------------------------------------
  const facades = new Map<number, THREE.Material[]>()
  const roofTex = track(concreteTexture(9, '#2a2a2c'))
  const roofMat = track(new THREE.MeshStandardMaterial({ map: roofTex, roughness: 1, color: 0x777777 }))
  const facadeMats = (variant: number) => {
    let mats = facades.get(variant)
    if (!mats) {
      const f = facadeTexture(variant)
      track(f.map)
      track(f.emissive)
      const m = track(
        new THREE.MeshStandardMaterial({
          map: f.map,
          emissiveMap: f.emissive,
          emissive: 0xffffff,
          emissiveIntensity: 0.55,
          roughness: 0.9,
        }),
      )
      mats = [m, m, roofMat, roofMat, m, m]
      facades.set(variant, mats)
    }
    return mats
  }

  const concreteMat = track(new THREE.MeshStandardMaterial({ map: track(concreteTexture(21, '#5a5853')), roughness: 0.95 }))
  const darkMetal = track(new THREE.MeshStandardMaterial({ color: 0x23272a, roughness: 0.6, metalness: 0.5 }))
  const dumpsterMat = track(new THREE.MeshStandardMaterial({ color: 0x1f2b25, roughness: 0.7, metalness: 0.3 }))
  const crateMat = track(new THREE.MeshStandardMaterial({ map: track(crateTexture()), roughness: 0.85 }))
  const glass = track(new THREE.MeshStandardMaterial({ color: 0x0a0d10, roughness: 0.1, metalness: 0.8 }))
  const tire = track(new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.9 }))
  const tail = track(new THREE.MeshStandardMaterial({ color: 0x400808, emissive: 0x6a0a0a, emissiveIntensity: 0.6 }))
  const head = track(new THREE.MeshStandardMaterial({ color: 0x9a9a90, emissive: 0x222018, roughness: 0.3 }))
  const carColors = [0x2a2e33, 0x3b1d1d, 0x1d2630, 0x4a4842, 0x1b1b1c]
  const doorMats: DoorMats = {
    door: track(new THREE.MeshStandardMaterial({ color: 0x141517, roughness: 0.5, metalness: 0.4 })),
    light: track(new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffc890, emissiveIntensity: 1.4 })),
  }
  const wheelGeo = track(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 14))

  const add = (m: THREE.Mesh, cast = true) => {
    m.castShadow = cast
    m.receiveShadow = true
    root.add(m)
    return m
  }

  for (const o of map.obstacles) {
    const w = o.maxX - o.minX
    const d = o.maxZ - o.minZ
    const cx = (o.minX + o.maxX) / 2
    const cz = (o.minZ + o.maxZ) / 2
    switch (o.kind) {
      case 'building': {
        const variant = o.variant ?? 0
        const f = facadeMats(variant)
        const geo = track(worldUVBox(w, o.height, d, 11, 9))
        add(new THREE.Mesh(geo, f)).position.set(cx, o.height / 2, cz)
        // Parapet and rooftop clutter for silhouette.
        const cap = add(new THREE.Mesh(track(new THREE.BoxGeometry(w + 0.3, 0.4, d + 0.3)), concreteMat))
        cap.position.set(cx, o.height + 0.2, cz)
        const rr = rand(variant * 13 + 5)
        for (let i = 0; i < 3; i++) {
          const s = 1 + rr() * 2
          const unit = add(new THREE.Mesh(track(new THREE.BoxGeometry(s, 0.8 + rr(), s * 0.8)), darkMetal))
          unit.position.set(cx + (rr() - 0.5) * (w - 3), o.height + 0.8, cz + (rr() - 0.5) * (d - 3))
        }
        // Ground-floor doors on the courtyard side.
        addDoors(root, o, track, rr, doorMats)
        break
      }
      case 'shop':
        buildShop(root, o, track, concreteMat)
        break
      case 'garage':
        buildGarage(root, o, track, concreteMat)
        break
      case 'board':
        buildBoard(root, o, track, darkMetal)
        break
      case 'bench':
        buildBench(root, o, track, crateMat, darkMetal)
        break
      case 'car':
        buildCar(root, o, carColors[(o.variant ?? 0) % carColors.length], { glass, tire, tail, head, wheelGeo }, track)
        break
      case 'dumpster': {
        add(new THREE.Mesh(track(new THREE.BoxGeometry(w, o.height - 0.1, d)), dumpsterMat)).position.set(cx, (o.height - 0.1) / 2, cz)
        const lid = add(new THREE.Mesh(track(new THREE.BoxGeometry(w + 0.06, 0.06, d + 0.1)), dumpsterMat))
        lid.position.set(cx, o.height - 0.05, cz - 0.05)
        lid.rotation.x = -0.12
        break
      }
      case 'crate': {
        add(new THREE.Mesh(track(new THREE.BoxGeometry(w, o.height * 0.55, d)), crateMat)).position.set(cx, o.height * 0.275, cz)
        const top = add(new THREE.Mesh(track(new THREE.BoxGeometry(w * 0.7, o.height * 0.45, d * 0.7)), crateMat))
        top.position.set(cx + 0.1, o.height * 0.55 + o.height * 0.225, cz - 0.05)
        top.rotation.y = 0.3
        break
      }
      case 'wall': {
        add(new THREE.Mesh(track(worldUVBox(w, o.height, d, 4, 2)), concreteMat)).position.set(cx, o.height / 2, cz)
        add(new THREE.Mesh(track(new THREE.BoxGeometry(w + 0.1, 0.08, d + 0.14)), concreteMat)).position.set(cx, o.height + 0.04, cz)
        break
      }
      case 'barrier': {
        const long = w > d
        const b = add(new THREE.Mesh(track(new THREE.BoxGeometry(long ? w : d, o.height * 0.5, 0.6)), concreteMat))
        b.position.set(cx, o.height * 0.25, cz)
        const t = add(new THREE.Mesh(track(new THREE.BoxGeometry(long ? w : d, o.height * 0.5, 0.26)), concreteMat))
        t.position.set(cx, o.height * 0.75, cz)
        if (!long) {
          b.rotation.y = Math.PI / 2
          t.rotation.y = Math.PI / 2
        }
        break
      }
      case 'fence':
        buildFence(root, o, track)
        break
    }
  }

  // --- streetlights -----------------------------------------------------------
  const lamps: MapView['lamps'] = []
  const poleMat = track(new THREE.MeshStandardMaterial({ color: 0x1c1e20, roughness: 0.6, metalness: 0.6 }))
  const glowTex = track(radialTexture())
  // One fixture/pool material per colour so the baked map stays a handful of draws.
  const lampMats = new Map<number, THREE.MeshStandardMaterial>()
  const poolMats = new Map<number, THREE.MeshBasicMaterial>()
  map.lights.forEach((l, i) => {
    if (l.pole !== false) {
      const pole = add(new THREE.Mesh(track(new THREE.CylinderGeometry(0.07, 0.1, l.height, 8)), poleMat))
      pole.position.set(l.x, l.height / 2, l.z)
    }
    let lampMat = lampMats.get(l.color)
    if (!lampMat) {
      lampMat = track(new THREE.MeshStandardMaterial({ color: 0x111111, emissive: l.color, emissiveIntensity: 2.2 }))
      lampMats.set(l.color, lampMat)
    }
    const lamp = add(new THREE.Mesh(track(new THREE.BoxGeometry(0.5, 0.12, 0.28)), lampMat), false)
    lamp.position.set(l.x, l.height, l.z)
    let poolMat = poolMats.get(l.color)
    if (!poolMat) {
      poolMat = track(new THREE.MeshBasicMaterial({ map: glowTex, color: l.color, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }))
      poolMats.set(l.color, poolMat)
    }
    // Cheap fake light pool on the ground.
    const pool = new THREE.Mesh(track(new THREE.PlaneGeometry(9, 9)), poolMat)
    pool.rotation.x = -Math.PI / 2
    pool.position.set(l.x, 0.02, l.z)
    root.add(pool)
    if (l.dynamic === false) return
    const light = new THREE.PointLight(l.color, l.intensity, 26, 1.35)
    light.position.set(l.x, l.height - 0.3, l.z)
    root.add(light)
    lamps.push({ light, base: l.intensity, mat: lampMat, phase: i * 1.7 })
  })

  // --- distant skyline (outside the playable bounds) ---------------------------------
  const skyline = rand(77)
  const skyMats = [0, 1, 2, 3].map((v) => {
    const f = facadeTexture(v + 20)
    track(f.map)
    track(f.emissive)
    return track(
      new THREE.MeshStandardMaterial({ map: f.map, emissiveMap: f.emissive, emissive: 0xffffff, emissiveIntensity: 0.6, color: 0x555555, roughness: 1 }),
    )
  })
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2 + skyline() * 0.1
    const dist = 58 + skyline() * 24
    const w = 8 + skyline() * 14
    const h = 18 + skyline() * 34
    const d = 8 + skyline() * 12
    const geo = track(worldUVBox(w, h, d, 11, 9))
    const m = new THREE.Mesh(geo, skyMats[i % skyMats.length])
    m.position.set(Math.cos(a) * dist, h / 2, Math.sin(a) * dist)
    m.rotation.y = -a
    root.add(m)
  }

  // Collapse the hundreds of static parts into one mesh per material.
  const baked = bakeStatic(root)
  for (const g of baked.geometries) track(g)

  return {
    group: root,
    lamps,
    drawsBefore: baked.drawsBefore,
    drawsAfter: baked.drawsAfter,
    dispose() {
      for (const d of disposables) d.dispose()
    },
  }
}

interface DoorMats {
  door: THREE.Material
  light: THREE.Material
}

function addDoors(root: THREE.Group, o: Obstacle, track: <T extends { dispose(): void }>(x: T) => T, r: () => number, mats: DoorMats) {
  // Doors on whichever faces look into the courtyard (toward the map centre).
  const doorMat = mats.door
  const lightMat = mats.light
  const cx = (o.minX + o.maxX) / 2
  const cz = (o.minZ + o.maxZ) / 2
  const faces: { x: number; z: number; ry: number; span: number; along: 'x' | 'z' }[] = []
  if (o.maxZ < 0 && o.maxZ > -30) faces.push({ x: cx, z: o.maxZ + 0.01, ry: 0, span: o.maxX - o.minX, along: 'x' })
  if (o.minZ > 0 && o.minZ < 30) faces.push({ x: cx, z: o.minZ - 0.01, ry: Math.PI, span: o.maxX - o.minX, along: 'x' })
  if (o.maxX < 0 && o.maxX > -30) faces.push({ x: o.maxX + 0.01, z: cz, ry: Math.PI / 2, span: o.maxZ - o.minZ, along: 'z' })
  if (o.minX > 0 && o.minX < 30) faces.push({ x: o.minX - 0.01, z: cz, ry: -Math.PI / 2, span: o.maxZ - o.minZ, along: 'z' })
  for (const f of faces) {
    const n = Math.max(1, Math.floor(f.span / 9))
    for (let i = 0; i < n; i++) {
      const off = (i + 0.5) * (f.span / n) - f.span / 2 + (r() - 0.5) * 2
      const door = new THREE.Mesh(track(new THREE.PlaneGeometry(1.3, 2.3)), doorMat)
      door.position.set(f.along === 'x' ? f.x + off : f.x, 1.15, f.along === 'z' ? f.z + off : f.z)
      door.rotation.y = f.ry
      door.position.x += Math.sin(f.ry) * 0.02
      door.position.z += Math.cos(f.ry) * 0.02
      root.add(door)
      const lamp = new THREE.Mesh(track(new THREE.BoxGeometry(0.25, 0.1, 0.12)), lightMat)
      lamp.position.copy(door.position)
      lamp.position.y = 2.6
      root.add(lamp)
    }
  }
}

type Track = <T extends { dispose(): void }>(x: T) => T

/**
 * A group sitting on the box face that looks toward the map centre, with local +Z as the
 * face normal and local X along the face. Storefronts, garage doors and boards hang off it.
 */
function faceGroup(root: THREE.Group, o: Obstacle): { group: THREE.Group; width: number } {
  const cx = (o.minX + o.maxX) / 2
  const cz = (o.minZ + o.maxZ) / 2
  const g = new THREE.Group()
  let width: number
  if (Math.abs(cz) >= Math.abs(cx)) {
    const towardPlusZ = cz <= 0
    g.position.set(cx, 0, towardPlusZ ? o.maxZ : o.minZ)
    g.rotation.y = towardPlusZ ? 0 : Math.PI
    width = o.maxX - o.minX
  } else {
    const towardPlusX = cx <= 0
    g.position.set(towardPlusX ? o.maxX : o.minX, 0, cz)
    g.rotation.y = towardPlusX ? Math.PI / 2 : -Math.PI / 2
    width = o.maxZ - o.minZ
  }
  root.add(g)
  return { group: g, width }
}

function signTexture(label: string, track: Track): THREE.CanvasTexture {
  return track(
    canvasTexture(512, 96, (g) => {
      g.fillStyle = '#101214'
      g.fillRect(0, 0, 512, 96)
      g.fillStyle = '#d9d4ca'
      let size = 54
      g.font = `bold ${size}px sans-serif`
      while (g.measureText(label).width > 470 && size > 20) {
        size -= 2
        g.font = `bold ${size}px sans-serif`
      }
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(label, 256, 52)
    }),
  )
}

function shutterTexture(track: Track, repeatX: number, repeatY: number): THREE.CanvasTexture {
  const t = track(
    canvasTexture(64, 64, (g) => {
      g.fillStyle = '#3a3c3f'
      g.fillRect(0, 0, 64, 64)
      g.fillStyle = 'rgba(0,0,0,0.35)'
      for (let y = 0; y < 64; y += 4) g.fillRect(0, y, 64, 1)
    }),
  )
  t.repeat.set(repeatX, repeatY)
  return t
}

function addBody(root: THREE.Group, o: Obstacle, mat: THREE.Material, track: Track) {
  const w = o.maxX - o.minX
  const d = o.maxZ - o.minZ
  const body = new THREE.Mesh(track(worldUVBox(w, o.height, d, 4, 3)), mat)
  body.position.set((o.minX + o.maxX) / 2, o.height / 2, (o.minZ + o.maxZ) / 2)
  body.castShadow = body.receiveShadow = true
  root.add(body)
}

function buildShop(root: THREE.Group, o: Obstacle, track: Track, concrete: THREE.Material) {
  addBody(root, o, concrete, track)
  const { group: f, width } = faceGroup(root, o)
  // Lit storefront window band, shutter half down.
  const glow = track(new THREE.MeshStandardMaterial({ color: 0x0b1014, emissive: 0x9fc6ff, emissiveIntensity: 0.55, roughness: 0.2 }))
  const win = new THREE.Mesh(track(new THREE.PlaneGeometry(width - 2.4, 1.6)), glow)
  win.position.set(-0.6, 1.6, 0.02)
  f.add(win)
  const shutter = new THREE.Mesh(
    track(new THREE.PlaneGeometry(width - 2.4, 0.9)),
    track(new THREE.MeshStandardMaterial({ map: shutterTexture(track, 3, 3), roughness: 0.6, metalness: 0.5 })),
  )
  shutter.position.set(-0.6, 2.05, 0.03)
  f.add(shutter)
  const awning = new THREE.Mesh(track(new THREE.BoxGeometry(width + 0.4, 0.12, 1.2)), track(new THREE.MeshStandardMaterial({ color: 0x1b1d1f, roughness: 0.8 })))
  awning.position.set(0, o.height - 0.6, 0.55)
  awning.castShadow = true
  f.add(awning)
  // Generic sign panel (no real brand).
  const sign = signTexture(o.label ?? 'CORNER  STORE', track)
  const signMesh = new THREE.Mesh(
    track(new THREE.PlaneGeometry(Math.min(width * 0.62, 6.5), Math.min(width * 0.62, 6.5) * (96 / 512) * 1.15)),
    track(new THREE.MeshStandardMaterial({ map: sign, emissiveMap: sign, emissive: 0xffffff, emissiveIntensity: 0.4 })),
  )
  signMesh.position.set(0, o.height - 0.05, 1.16)
  f.add(signMesh)
  const door = new THREE.Mesh(track(new THREE.PlaneGeometry(1.1, 2.2)), track(new THREE.MeshStandardMaterial({ color: 0x15171a, metalness: 0.5, roughness: 0.4 })))
  door.position.set(width / 2 - 0.9, 1.1, 0.02)
  f.add(door)
}

function buildGarage(root: THREE.Group, o: Obstacle, track: Track, concrete: THREE.Material) {
  addBody(root, o, concrete, track)
  const { group: f, width } = faceGroup(root, o)
  const doorW = Math.min(width - 2, 6.5)
  const door = new THREE.Mesh(
    track(new THREE.PlaneGeometry(doorW, 3.6)),
    track(new THREE.MeshStandardMaterial({ map: shutterTexture(track, 4, 14), roughness: 0.55, metalness: 0.6, color: 0x9a9da2 })),
  )
  door.position.set(0, 1.8, 0.03)
  f.add(door)
  const frameMat = track(new THREE.MeshStandardMaterial({ color: 0x141517, roughness: 0.6, metalness: 0.4 }))
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(track(new THREE.BoxGeometry(0.25, 3.8, 0.2)), frameMat)
    post.position.set(sx * (doorW / 2 + 0.12), 1.9, 0.1)
    post.castShadow = true
    f.add(post)
  }
  const lintel = new THREE.Mesh(track(new THREE.BoxGeometry(doorW + 0.5, 0.3, 0.25)), frameMat)
  lintel.position.set(0, 3.75, 0.1)
  f.add(lintel)
  const sign = signTexture(o.label ?? 'GARAGE', track)
  const signMesh = new THREE.Mesh(
    track(new THREE.PlaneGeometry(3.4, 0.7)),
    track(new THREE.MeshStandardMaterial({ map: sign, emissiveMap: sign, emissive: 0xffffff, emissiveIntensity: 0.35 })),
  )
  signMesh.position.set(0, 4.4, 0.05)
  f.add(signMesh)
  const flood = new THREE.Mesh(track(new THREE.BoxGeometry(0.4, 0.15, 0.3)), track(new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff1d6, emissiveIntensity: 1.6 })))
  flood.position.set(0, 5, 0.25)
  f.add(flood)
}

function boardTexture(label: string, track: Track): THREE.CanvasTexture {
  const r = rand(808)
  return track(
    canvasTexture(512, 288, (g) => {
      g.fillStyle = '#1b1a18'
      g.fillRect(0, 0, 512, 288)
      g.fillStyle = 'rgba(255,255,255,0.03)'
      for (let i = 0; i < 400; i++) g.fillRect(r() * 512, r() * 288, 2, 2)
      g.fillStyle = '#d9d4ca'
      g.font = 'bold 40px sans-serif'
      g.textAlign = 'left'
      g.fillText(label, 24, 52)
      g.fillRect(24, 64, 160, 3)
      // Pinned briefs with red string between them.
      const cards: [number, number][] = []
      for (let i = 0; i < 6; i++) {
        const x = 30 + (i % 3) * 160 + r() * 20
        const y = 92 + Math.floor(i / 3) * 96 + r() * 12
        cards.push([x + 55, y + 35])
        g.save()
        g.translate(x + 55, y + 35)
        g.rotate((r() - 0.5) * 0.12)
        g.fillStyle = i === 0 ? '#e9e2d3' : '#a8a296'
        g.fillRect(-55, -35, 110, 70)
        g.fillStyle = 'rgba(20,20,20,0.55)'
        for (let l = 0; l < 4; l++) g.fillRect(-45, -22 + l * 13, 60 + r() * 30, 3)
        g.fillStyle = '#9b2a20'
        g.beginPath()
        g.arc(0, -30, 4, 0, Math.PI * 2)
        g.fill()
        g.restore()
      }
      g.strokeStyle = 'rgba(155,42,32,0.8)'
      g.lineWidth = 2
      g.beginPath()
      g.moveTo(cards[0][0], cards[0][1] - 30)
      for (const [x, y] of cards.slice(1)) g.lineTo(x, y - 30)
      g.stroke()
    }),
  )
}

function buildBoard(root: THREE.Group, o: Obstacle, track: Track, darkMetal: THREE.Material) {
  addBody(root, o, darkMetal, track)
  const { group: f, width } = faceGroup(root, o)
  const tex = boardTexture(o.label ?? 'MISSIONS', track)
  const h = Math.min(o.height - 0.6, width * (288 / 512))
  const panel = new THREE.Mesh(
    track(new THREE.PlaneGeometry(width - 0.3, h)),
    track(new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.18, roughness: 0.9 })),
  )
  panel.position.set(0, o.height - 0.25 - h / 2, 0.02)
  f.add(panel)
}

function buildBench(root: THREE.Group, o: Obstacle, track: Track, wood: THREE.Material, metal: THREE.Material) {
  const w = o.maxX - o.minX
  const d = o.maxZ - o.minZ
  const cx = (o.minX + o.maxX) / 2
  const cz = (o.minZ + o.maxZ) / 2
  const seat = new THREE.Mesh(track(new THREE.BoxGeometry(w, 0.08, d)), wood)
  seat.position.set(cx, o.height, cz)
  seat.castShadow = seat.receiveShadow = true
  root.add(seat)
  const alongX = w >= d
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(track(new THREE.BoxGeometry(alongX ? 0.08 : d, o.height, alongX ? d : 0.08)), metal)
    leg.position.set(cx + (alongX ? s * (w / 2 - 0.2) : 0), o.height / 2, cz + (alongX ? 0 : s * (d / 2 - 0.2)))
    leg.castShadow = true
    root.add(leg)
  }
}

interface CarMats {
  glass: THREE.Material
  tire: THREE.Material
  tail: THREE.Material
  head: THREE.Material
  wheelGeo: THREE.BufferGeometry
}

function buildCar(root: THREE.Group, o: Obstacle, color: number, m: CarMats, track: <T extends { dispose(): void }>(x: T) => T) {
  const w = o.maxX - o.minX
  const d = o.maxZ - o.minZ
  const alongZ = d > w
  const len = alongZ ? d : w
  const wid = alongZ ? w : d
  const car = new THREE.Group()
  car.position.set((o.minX + o.maxX) / 2, 0, (o.minZ + o.maxZ) / 2)
  if (!alongZ) car.rotation.y = Math.PI / 2
  const paint = track(new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.6 }))
  const add = (mesh: THREE.Mesh) => {
    mesh.castShadow = mesh.receiveShadow = true
    car.add(mesh)
    return mesh
  }
  add(new THREE.Mesh(track(new THREE.BoxGeometry(wid, 0.62, len)), paint)).position.y = 0.62
  const cabin = add(new THREE.Mesh(track(new THREE.BoxGeometry(wid * 0.86, 0.5, len * 0.5)), m.glass))
  cabin.position.set(0, 1.18, len * 0.04)
  add(new THREE.Mesh(track(new THREE.BoxGeometry(wid * 0.88, 0.06, len * 0.46)), paint)).position.set(0, 1.45, len * 0.04)
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const wh = add(new THREE.Mesh(m.wheelGeo, m.tire))
      wh.rotation.z = Math.PI / 2
      wh.position.set(sx * (wid / 2 - 0.08), 0.34, sz * (len / 2 - 0.75))
    }
    const tl = new THREE.Mesh(track(new THREE.BoxGeometry(0.3, 0.1, 0.04)), m.tail)
    tl.position.set(sx * (wid / 2 - 0.25), 0.78, len / 2 + 0.01)
    car.add(tl)
    const hl = new THREE.Mesh(track(new THREE.BoxGeometry(0.3, 0.12, 0.04)), m.head)
    hl.position.set(sx * (wid / 2 - 0.25), 0.74, -len / 2 - 0.01)
    car.add(hl)
  }
  root.add(car)
}

function buildFence(root: THREE.Group, o: Obstacle, track: <T extends { dispose(): void }>(x: T) => T) {
  const w = o.maxX - o.minX
  const d = o.maxZ - o.minZ
  const alongX = w >= d
  const len = alongX ? w : d
  const tex = track(
    canvasTexture(64, 64, (g) => {
      g.clearRect(0, 0, 64, 64)
      g.strokeStyle = 'rgba(150,155,160,0.9)'
      g.lineWidth = 2
      g.beginPath()
      g.moveTo(0, 0)
      g.lineTo(64, 64)
      g.moveTo(64, 0)
      g.lineTo(0, 64)
      g.stroke()
    }),
  )
  tex.repeat.set(len / 0.18, o.height / 0.18)
  const mesh = new THREE.Mesh(
    track(new THREE.PlaneGeometry(len, o.height)),
    track(new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5 })),
  )
  mesh.position.set((o.minX + o.maxX) / 2, o.height / 2, (o.minZ + o.maxZ) / 2)
  if (!alongX) mesh.rotation.y = Math.PI / 2
  mesh.castShadow = true
  root.add(mesh)
  const postMat = track(new THREE.MeshStandardMaterial({ color: 0x55595d, metalness: 0.7, roughness: 0.4 }))
  const postGeo = track(new THREE.CylinderGeometry(0.04, 0.04, o.height, 6))
  const n = Math.ceil(len / 2.5)
  for (let i = 0; i <= n; i++) {
    const t = -len / 2 + (i / n) * len
    const p = new THREE.Mesh(postGeo, postMat)
    p.position.set(alongX ? (o.minX + o.maxX) / 2 + t : (o.minX + o.maxX) / 2, o.height / 2, alongX ? (o.minZ + o.maxZ) / 2 : (o.minZ + o.maxZ) / 2 + t)
    p.castShadow = true
    root.add(p)
  }
}

function crateTexture(): THREE.CanvasTexture {
  const r = rand(42)
  return canvasTexture(128, 128, (g) => {
    g.fillStyle = '#4a3b2a'
    g.fillRect(0, 0, 128, 128)
    for (let y = 0; y < 128; y += 16) {
      g.fillStyle = `rgba(0,0,0,${0.15 + r() * 0.2})`
      g.fillRect(0, y, 128, 2)
    }
    g.strokeStyle = 'rgba(30,22,14,0.9)'
    g.lineWidth = 8
    g.strokeRect(4, 4, 120, 120)
    g.beginPath()
    g.moveTo(8, 8)
    g.lineTo(120, 120)
    g.stroke()
  })
}

function radialTexture(): THREE.CanvasTexture {
  return canvasTexture(
    128,
    128,
    (g) => {
      const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
      grad.addColorStop(0, 'rgba(255,255,255,1)')
      grad.addColorStop(0.4, 'rgba(255,255,255,0.35)')
      grad.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = grad
      g.fillRect(0, 0, 128, 128)
    },
    true,
  )
}
