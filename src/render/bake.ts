import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const KEEP = ['position', 'normal', 'uv']

/** Copy a vertex range of a non-indexed geometry. */
function slice(geo: THREE.BufferGeometry, start: number, count: number): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry()
  for (const name of KEEP) {
    const a = geo.getAttribute(name) as THREE.BufferAttribute | undefined
    if (!a) continue
    out.setAttribute(name, new THREE.BufferAttribute((a.array as Float32Array).slice(start * a.itemSize, (start + count) * a.itemSize), a.itemSize))
  }
  return out
}

/**
 * Merge every static mesh under `root` into one mesh per (material, shadow flags).
 * The map is built from hundreds of small parts; drawing them one by one costs a draw
 * call each (six for a multi-material box). Baked, the whole block is a few dozen draws.
 * Meshes with `userData.dynamic` are left alone. Returns the new geometries for disposal.
 */
export function bakeStatic(root: THREE.Object3D): { geometries: THREE.BufferGeometry[]; drawsBefore: number; drawsAfter: number } {
  root.updateMatrixWorld(true)
  const buckets = new Map<string, { mat: THREE.Material; cast: boolean; receive: boolean; parts: THREE.BufferGeometry[] }>()
  const victims: THREE.Mesh[] = []
  let drawsBefore = 0

  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || m.userData.dynamic || (m as unknown as THREE.InstancedMesh).isInstancedMesh) return
    victims.push(m)
    const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()
    geo.applyMatrix4(m.matrixWorld)
    if (!geo.getAttribute('uv')) {
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2))
    }
    const mats = Array.isArray(m.material) ? m.material : [m.material]
    const groups = Array.isArray(m.material) && geo.groups.length ? geo.groups : [{ start: 0, count: geo.getAttribute('position').count, materialIndex: 0 }]
    drawsBefore += groups.length
    for (const g of groups) {
      const mat = mats[g.materialIndex ?? 0]
      if (!mat) continue
      const key = `${mat.uuid}|${m.castShadow ? 1 : 0}|${m.receiveShadow ? 1 : 0}`
      let b = buckets.get(key)
      if (!b) {
        b = { mat, cast: m.castShadow, receive: m.receiveShadow, parts: [] }
        buckets.set(key, b)
      }
      b.parts.push(slice(geo, g.start, g.count))
    }
    geo.dispose()
  })

  for (const v of victims) {
    v.parent?.remove(v)
    v.geometry.dispose()
  }

  const geometries: THREE.BufferGeometry[] = []
  for (const b of buckets.values()) {
    const merged = mergeGeometries(b.parts, false)
    for (const p of b.parts) p.dispose()
    if (!merged) continue
    merged.computeBoundingSphere()
    const mesh = new THREE.Mesh(merged, b.mat)
    mesh.castShadow = b.cast
    mesh.receiveShadow = b.receive
    mesh.matrixAutoUpdate = false
    root.add(mesh)
    geometries.push(merged)
  }
  return { geometries, drawsBefore, drawsAfter: geometries.length }
}
