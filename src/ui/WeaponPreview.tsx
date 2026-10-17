import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { AttachmentChoice } from '../data/attachments'
import { buildWeaponModel } from '../render/weapons'
import type { WeaponDef } from '../sim/types'

/**
 * Turntable preview for the Gunsmith: the same procedural weapon model the player carries,
 * with the selected attachments, in its own small WebGL canvas.
 */
export function WeaponPreview({ def, attachments }: { def: WeaponDef; attachments: AttachmentChoice }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<{ setModel: (d: WeaponDef, a: AttachmentChoice) => void } | null>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    } catch {
      return
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    const scene = new THREE.Scene()
    scene.add(new THREE.HemisphereLight(0xb8c2dd, 0x1a1a1e, 2.2))
    const key = new THREE.DirectionalLight(0xfff1e0, 3)
    key.position.set(1.5, 2, 2)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0x9fb4ff, 2)
    rim.position.set(-2, 1, -2)
    scene.add(rim)
    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 20)
    const pivot = new THREE.Group()
    scene.add(pivot)
    let model: THREE.Group | null = null

    const setModel = (d: WeaponDef, a: AttachmentChoice) => {
      if (model) pivot.remove(model)
      const built = buildWeaponModel(d, a)
      model = built.group
      // Centre and frame the gun whatever its length.
      const box = new THREE.Box3().setFromObject(model)
      const size = box.getSize(new THREE.Vector3())
      const centre = box.getCenter(new THREE.Vector3())
      model.position.sub(centre)
      pivot.add(model)
      const span = Math.max(size.z, size.y * 2.2, 0.25)
      camera.position.set(span * 1.25, span * 0.35, span * 0.9)
      camera.lookAt(0, 0, 0)
    }
    sceneRef.current = { setModel }

    let raf = 0
    let t = 0
    let last = performance.now()
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
        renderer.setSize(w, h, false)
        camera.aspect = w / Math.max(1, h)
        camera.updateProjectionMatrix()
      }
      t += Math.min(0.05, (now - last) / 1000)
      last = now
      pivot.rotation.y = Math.sin(t * 0.6) * 0.9 + Math.PI * 0.5
      renderer.render(scene, camera)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      sceneRef.current = null
      renderer.dispose()
    }
  }, [])

  const key = `${def.id}|${JSON.stringify(attachments)}`
  useEffect(() => {
    sceneRef.current?.setModel(def, attachments)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return <canvas ref={ref} className="weapon-preview" aria-label={`${def.name} preview`} />
}
