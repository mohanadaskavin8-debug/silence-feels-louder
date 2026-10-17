import * as THREE from 'three'
import type { CharacterOutfit } from '../sim/types'

// Procedural placeholder models. Every character and infected is assembled from
// primitives so the game runs with zero downloads; approved GLB models replace
// these later by producing the same named joints (see HumanoidRig).

export interface HumanoidRig {
  root: THREE.Group
  /** Everything above the feet; tilted for death falls and rising out of the ground. */
  body: THREE.Group
  hips: THREE.Group
  torso: THREE.Group
  head: THREE.Group
  armL: THREE.Group
  armR: THREE.Group
  foreL: THREE.Group
  foreR: THREE.Group
  legL: THREE.Group
  legR: THREE.Group
  shinL: THREE.Group
  shinR: THREE.Group
  handR: THREE.Group
  /** Materials owned by this instance (hit flashes tint these). */
  flashMats: THREE.MeshStandardMaterial[]
  dispose(): void
}

const geoCache = new Map<string, THREE.BufferGeometry>()
const cachedGeo = (key: string, make: () => THREE.BufferGeometry) => {
  let g = geoCache.get(key)
  if (!g) {
    g = make()
    geoCache.set(key, g)
  }
  return g
}

const capsule = (r: number, len: number) => cachedGeo(`cap${r}:${len}`, () => new THREE.CapsuleGeometry(r, len, 4, 10))
const boxG = (w: number, h: number, d: number) => cachedGeo(`box${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d))
const sphere = (r: number) => cachedGeo(`sph${r}`, () => new THREE.SphereGeometry(r, 16, 12))

const fabric = (color: number, rough = 0.92) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 })

// Shared, never-disposed materials for parts that look the same on everyone. Keeping them
// alive also keeps their shader programs compiled, so a wave start never hitches on a recompile.
const shared = {
  eyeGlow: new Map<number, THREE.MeshBasicMaterial>(),
  lens: new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.15, metalness: 0.6 }),
  gunMetal: new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.45, metalness: 0.7 }),
  gunPolymer: new THREE.MeshStandardMaterial({ color: 0x222224, roughness: 0.8, metalness: 0.1 }),
}
const eyeGlowMat = (color: number) => {
  let m = shared.eyeGlow.get(color)
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color })
    shared.eyeGlow.set(color, m)
  }
  return m
}
/** Parts smaller than this don't cast shadows (hands, eyes, zip, cuffs...): ~10 fewer shadow draws per figure. */
const SHADOW_MIN_RADIUS = 0.1

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat)
  m.position.set(x, y, z)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

function group(parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Group {
  const g = new THREE.Group()
  g.position.set(x, y, z)
  parent.add(g)
  return g
}

export interface HumanoidOptions {
  outfit: CharacterOutfit
  /** Scales the whole figure (variation between infected). */
  scale?: number
  /** Infected eyes glow faintly through the mask slit. */
  eyeGlow?: number | null
}

/** Build a humanoid facing -Z with its feet at the origin. Joint pivots sit at the joints. */
export function buildHumanoid(opts: HumanoidOptions): HumanoidRig {
  const o = opts.outfit
  const mats = {
    top: fabric(o.top),
    accent: fabric(o.topAccent, 0.7),
    bottom: fabric(o.bottom),
    shoes: fabric(o.shoes, 0.6),
    skin: fabric(o.skin, 0.75),
    mask: o.mask !== null ? fabric(o.mask, 0.95) : null,
    bag: o.bag !== null ? fabric(o.bag, 0.55) : null,
  }
  const flashMats = [mats.top, mats.bottom]
  if (mats.mask) flashMats.push(mats.mask)

  const root = new THREE.Group()
  const body = group(root)
  const hips = group(body, 0, 0.94, 0)
  hips.add(mesh(boxG(0.36, 0.2, 0.22), mats.bottom, 0, 0, 0))

  const torso = group(hips, 0, 0.08, 0)
  torso.add(mesh(boxG(0.44, 0.52, 0.25), mats.top, 0, 0.28, 0))
  // Zip line + cuffs are the only accents: no logos, generic tech-fleece silhouette.
  torso.add(mesh(boxG(0.018, 0.48, 0.01), mats.accent, 0, 0.28, -0.128))
  torso.add(mesh(boxG(0.3, 0.06, 0.24), mats.top, 0, 0.56, 0.0))

  const head = group(torso, 0, 0.62, 0)
  const headMat = mats.mask ?? mats.skin
  head.add(mesh(sphere(0.125), headMat, 0, 0.1, 0))
  head.add(mesh(boxG(0.08, 0.08, 0.08), mats.skin, 0, -0.01, 0)) // neck
  if (mats.mask) {
    // Eye slit: a band of skin showing through the mask.
    const slit = mesh(boxG(0.17, 0.035, 0.03), mats.skin, 0, 0.125, -0.108)
    head.add(slit)
    if (opts.eyeGlow != null) {
      const glow = eyeGlowMat(opts.eyeGlow)
      head.add(mesh(boxG(0.03, 0.014, 0.01), glow, -0.04, 0.125, -0.124))
      head.add(mesh(boxG(0.03, 0.014, 0.01), glow, 0.04, 0.125, -0.124))
    }
  } else {
    // Hair / cap silhouette so the unmasked placeholder doesn't read as bald.
    const hair = mesh(sphere(0.128), mats.accent, 0, 0.135, 0.012)
    hair.scale.set(1, 0.62, 1)
    head.add(hair)
  }
  if (o.hood) {
    const hood = mesh(sphere(0.15), mats.top, 0, 0.12, 0.035)
    hood.scale.set(1.02, 1.05, 1.0)
    head.add(hood)
    // Open the hood at the front by pushing the face forward of it.
    head.children[0].position.z = -0.025
  }
  if (o.glasses) {
    const lens = shared.lens
    head.add(mesh(boxG(0.075, 0.04, 0.012), lens, -0.045, 0.125, -0.14))
    head.add(mesh(boxG(0.075, 0.04, 0.012), lens, 0.045, 0.125, -0.14))
    head.add(mesh(boxG(0.03, 0.01, 0.01), lens, 0, 0.13, -0.142))
  }

  const arm = (side: 1 | -1) => {
    const shoulder = group(torso, side * 0.27, 0.5, 0)
    shoulder.add(mesh(capsule(0.065, 0.2), mats.top, 0, -0.15, 0))
    const fore = group(shoulder, 0, -0.3, 0)
    fore.add(mesh(capsule(0.058, 0.2), mats.top, 0, -0.13, 0))
    fore.add(mesh(boxG(0.13, 0.04, 0.13), mats.accent, 0, -0.25, 0)) // cuff
    const hand = group(fore, 0, -0.3, 0)
    hand.add(mesh(sphere(0.055), mats.skin, 0, 0, 0))
    return { shoulder, fore, hand }
  }
  const L = arm(-1)
  const R = arm(1)

  const leg = (side: 1 | -1) => {
    const hip = group(hips, side * 0.11, -0.06, 0)
    hip.add(mesh(capsule(0.085, 0.3), mats.bottom, 0, -0.22, 0))
    const shin = group(hip, 0, -0.44, 0)
    shin.add(mesh(capsule(0.072, 0.3), mats.bottom, 0, -0.2, 0))
    shin.add(mesh(boxG(0.13, 0.1, 0.27), mats.shoes, 0, -0.41, -0.04))
    return { hip, shin }
  }
  const LL = leg(-1)
  const LR = leg(1)

  if (mats.bag) {
    // Crossbody bag: strap from right shoulder to left hip, pouch on the left hip.
    const strap = mesh(boxG(0.035, 0.66, 0.012), mats.bag, 0, 0.27, -0.132)
    strap.rotation.z = -0.62
    torso.add(strap)
    const strapBack = mesh(boxG(0.035, 0.66, 0.012), mats.bag, 0, 0.27, 0.132)
    strapBack.rotation.z = 0.62
    torso.add(strapBack)
    torso.add(mesh(boxG(0.2, 0.13, 0.07), mats.bag, -0.2, 0.04, -0.13))
  }

  if (opts.scale && opts.scale !== 1) root.scale.setScalar(opts.scale)
  root.traverse((obj) => {
    const m = obj as THREE.Mesh
    if (!m.isMesh) return
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere()
    if (m.geometry.boundingSphere!.radius < SHADOW_MIN_RADIUS) m.castShadow = false
  })

  const owned = Object.values(mats).filter(Boolean) as THREE.Material[]
  return {
    root,
    body,
    hips,
    torso,
    head,
    armL: L.shoulder,
    armR: R.shoulder,
    foreL: L.fore,
    foreR: R.fore,
    legL: LL.hip,
    legR: LR.hip,
    shinL: LL.shin,
    shinR: LR.shin,
    handR: R.hand,
    flashMats,
    dispose() {
      // Geometries are cached and shared materials live forever; only per-instance materials are freed.
      for (const m of owned) m.dispose()
    },
  }
}

/** Placeholder pistol. Barrel points along the hand's -Y axis (down the forearm). Returns the muzzle anchor. */
export function buildPistol(hand: THREE.Group): THREE.Object3D {
  const metal = shared.gunMetal
  const polymer = shared.gunPolymer
  const gun = new THREE.Group()
  // Build pointing -Z, then rotate so -Z maps to the hand's -Y.
  gun.add(mesh(boxG(0.034, 0.042, 0.19), metal, 0, 0.03, -0.06)) // slide
  gun.add(mesh(boxG(0.03, 0.03, 0.17), polymer, 0, 0.0, -0.05)) // frame
  const grip = mesh(boxG(0.03, 0.11, 0.045), polymer, 0, -0.05, 0.01)
  grip.rotation.x = -0.25
  gun.add(grip)
  const muzzle = new THREE.Object3D()
  muzzle.position.set(0, 0.03, -0.16)
  gun.add(muzzle)
  gun.rotation.x = -Math.PI / 2
  gun.position.set(0, -0.03, -0.02)
  hand.add(gun)
  return muzzle
}

/** Muted, worn variations of the infected uniform: dark tech-fleece tracksuit, ski mask, crossbody bag. */
export function infectedOutfit(seed: number): CharacterOutfit {
  const r = (n: number) => {
    const x = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453
    return x - Math.floor(x)
  }
  const shade = (base: number, spread: number, i: number) => {
    const c = new THREE.Color(base)
    const k = 1 + (r(i) - 0.5) * spread
    c.multiplyScalar(k)
    // Some suits are dusted brown with dirt.
    if (r(i + 9) > 0.6) c.lerp(new THREE.Color(0x3a2f24), 0.18 + r(i + 4) * 0.2)
    return c.getHex()
  }
  return {
    skin: new THREE.Color(0x6d6a63).lerp(new THREE.Color(0x4a5145), r(1)).getHex(),
    top: shade(0x1b1b1e, 0.5, 2),
    topAccent: shade(0x2a2a2e, 0.5, 3),
    bottom: shade(0x17171a, 0.5, 5),
    shoes: shade(0x121214, 0.4, 6),
    hood: r(7) > 0.45,
    mask: shade(0x0d0d0f, 0.3, 8),
    glasses: false,
    bag: shade(0x1c1c1f, 0.6, 10),
  }
}
