import * as THREE from 'three'
import { CHARACTERS } from '../data/characters'
import { buildHumanoid, buildPistol, infectedOutfit } from '../render/models'

// Dev-only character lineup (open the dev server with #lineup). Renders every playable
// placeholder and a few infected variants side by side for art direction reviews.

export function mountLineup(root: HTMLElement) {
  root.innerHTML = ''
  const wrap = document.createElement('div')
  wrap.style.cssText = 'position:fixed;inset:0;background:#0b0b0c'
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'width:100%;height:100%;display:block'
  wrap.appendChild(canvas)
  root.appendChild(wrap)

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.25
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x111114)
  scene.fog = new THREE.Fog(0x111114, 14, 30)
  scene.add(new THREE.HemisphereLight(0x8a93ad, 0x15151a, 1.4))
  const key = new THREE.DirectionalLight(0xfff1e0, 2.4)
  key.position.set(4, 8, 7)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  Object.assign(key.shadow.camera, { left: -10, right: 10, top: 6, bottom: -2 })
  scene.add(key)
  const rim = new THREE.DirectionalLight(0x9fb4ff, 1.6)
  rim.position.set(-6, 4, -6)
  scene.add(rim)
  const ground = new THREE.Mesh(new THREE.CircleGeometry(16, 48), new THREE.MeshStandardMaterial({ color: 0x1d1d20, roughness: 0.95 }))
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)

  const entries: { label: string; sub: string; make: () => THREE.Group }[] = [
    ...['ksbvndz', 'savv4x', '100otd', 'capt50', '2tray'].map((id) => ({
      label: CHARACTERS[id].name,
      sub: 'placeholder',
      make: () => {
        const rig = buildHumanoid({ outfit: CHARACTERS[id].outfit })
        buildPistol(rig.handR)
        // Relaxed stance, gun at low ready.
        rig.armR.rotation.x = 0.3
        rig.foreR.rotation.x = 0.7
        rig.armL.rotation.z = 0.08
        return rig.root
      },
    })),
    ...[11, 4242, 90210].map((seed, i) => ({
      label: i === 0 ? 'Infected' : '',
      sub: i === 0 ? 'regular · 3 of many variants' : '',
      make: () => {
        const rig = buildHumanoid({ outfit: infectedOutfit(seed), scale: 0.97 + i * 0.03, eyeGlow: 0x8a1c12 })
        rig.torso.rotation.x = -0.18
        rig.head.rotation.x = -0.2
        rig.armR.rotation.x = 1.25 + i * 0.1
        rig.armL.rotation.x = 1.05
        rig.armR.rotation.z = -0.15
        rig.armL.rotation.z = 0.15
        return rig.root
      },
    })),
  ]

  const spacing = 1.45
  const labels: { el: HTMLDivElement; pos: THREE.Vector3 }[] = []
  entries.forEach((e, i) => {
    const g = e.make()
    const x = (i - (entries.length - 1) / 2) * spacing + (i >= 5 ? 0.6 : 0)
    g.position.set(x, 0, 0)
    // Models face -Z; turn them toward the camera with a slight three-quarter angle.
    g.rotation.y = Math.PI + (i >= 5 ? -0.3 : 0.22)
    scene.add(g)
    if (e.label) {
      const el = document.createElement('div')
      el.style.cssText =
        'position:fixed;transform:translate(-50%,0);text-align:center;font:700 15px/1.2 "Archivo Narrow",Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#d9d4ca;white-space:nowrap'
      el.innerHTML = `${e.label}<div style="font:400 10px/1.6 monospace;letter-spacing:.08em;color:rgba(217,212,202,.55)">${e.sub}</div>`
      wrap.appendChild(el)
      labels.push({ el, pos: new THREE.Vector3(x + (i === 5 ? spacing : 0), 0, 0) })
    }
  })

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100)
  camera.position.set(0.3, 1.35, 9.2)
  camera.lookAt(0.3, 0.92, 0)

  const resize = () => {
    const w = innerWidth
    const h = innerHeight
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  addEventListener('resize', resize)
  resize()
  const tmp = new THREE.Vector3()
  const frame = () => {
    renderer.render(scene, camera)
    for (const l of labels) {
      tmp.copy(l.pos).setY(-0.05).project(camera)
      l.el.style.left = `${((tmp.x + 1) / 2) * innerWidth}px`
      l.el.style.top = `${((1 - tmp.y) / 2) * innerHeight + 8}px`
    }
    requestAnimationFrame(frame)
  }
  frame()
}
