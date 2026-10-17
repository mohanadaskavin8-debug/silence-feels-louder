import { walkableLine } from './collision'
import type { MapDef } from './types'

const UNREACHED = 0x3fffffff
const STRAIGHT = 5
const DIAGONAL = 7

/**
 * Walkability grid + Dijkstra flow fields. One field per chase target lets any
 * number of zombies path around buildings for the price of a single search.
 */
export class NavGrid {
  readonly cols: number
  readonly rows: number
  readonly blocked: Uint8Array
  private readonly ox: number
  private readonly oz: number

  constructor(
    readonly map: MapDef,
    readonly radius: number,
    readonly cell = 0.5,
  ) {
    this.cols = Math.ceil((map.halfX * 2) / cell)
    this.rows = Math.ceil((map.halfZ * 2) / cell)
    this.ox = -map.halfX
    this.oz = -map.halfZ
    this.blocked = new Uint8Array(this.cols * this.rows)
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = this.ox + (c + 0.5) * cell
        const z = this.oz + (r + 0.5) * cell
        this.blocked[r * this.cols + c] = this.isBlockedAt(x, z) ? 1 : 0
      }
    }
  }

  private isBlockedAt(x: number, z: number): boolean {
    const r = this.radius
    if (Math.abs(x) > this.map.halfX - r || Math.abs(z) > this.map.halfZ - r) return true
    for (const o of this.map.obstacles) {
      if (x > o.minX - r && x < o.maxX + r && z > o.minZ - r && z < o.maxZ + r) return true
    }
    return false
  }

  cellIndex(x: number, z: number): number {
    const c = Math.floor((x - this.ox) / this.cell)
    const r = Math.floor((z - this.oz) / this.cell)
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1
    return r * this.cols + c
  }

  cellCenter(idx: number): { x: number; z: number } {
    const c = idx % this.cols
    const r = (idx - c) / this.cols
    return { x: this.ox + (c + 0.5) * this.cell, z: this.oz + (r + 0.5) * this.cell }
  }

  /** Nearest walkable cell to a point (breadth-first ring search). */
  nearestFree(x: number, z: number): number {
    const start = this.cellIndex(x, z)
    if (start >= 0 && !this.blocked[start]) return start
    const c0 = Math.floor((x - this.ox) / this.cell)
    const r0 = Math.floor((z - this.oz) / this.cell)
    for (let ring = 1; ring < 24; ring++) {
      let best = -1
      let bestD = Infinity
      for (let dr = -ring; dr <= ring; dr++) {
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue
          const c = c0 + dc
          const r = r0 + dr
          if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue
          const i = r * this.cols + c
          if (this.blocked[i]) continue
          const d = dc * dc + dr * dr
          if (d < bestD) {
            bestD = d
            best = i
          }
        }
      }
      if (best >= 0) return best
    }
    return -1
  }

  /** Dijkstra distances from every cell to `goal` (UNREACHED where cut off). */
  buildField(goal: number): Int32Array {
    const n = this.cols * this.rows
    const dist = new Int32Array(n).fill(UNREACHED)
    if (goal < 0) return dist
    const heap = new MinHeap(dist)
    dist[goal] = 0
    heap.push(goal)
    const cols = this.cols
    while (heap.size) {
      const i = heap.pop()
      const d = dist[i]
      const c = i % cols
      const r = (i - c) / cols
      for (let dr = -1; dr <= 1; dr++) {
        const rr = r + dr
        if (rr < 0 || rr >= this.rows) continue
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue
          const cc = c + dc
          if (cc < 0 || cc >= cols) continue
          const j = rr * cols + cc
          if (this.blocked[j]) continue
          // No corner cutting: a diagonal needs both orthogonal neighbours open.
          if (dr && dc && (this.blocked[r * cols + cc] || this.blocked[rr * cols + c])) continue
          const nd = d + (dr && dc ? DIAGONAL : STRAIGHT)
          if (nd < dist[j]) {
            dist[j] = nd
            heap.push(j)
          }
        }
      }
    }
    return dist
  }

  /**
   * Where a walker at (x, z) should head next on `field`: follows the steepest descent
   * a few cells ahead and returns the farthest of those cells it can walk to in a
   * straight line. Null if the walker's region cannot reach the goal.
   */
  nextWaypoint(field: Int32Array, x: number, z: number, lookahead = 8): { x: number; z: number } | null {
    let i = this.cellIndex(x, z)
    if (i < 0 || this.blocked[i] || field[i] >= UNREACHED) i = this.nearestReached(field, x, z)
    if (i < 0) return null
    let best = this.cellCenter(i)
    let cur = i
    for (let step = 0; step < lookahead; step++) {
      const next = this.descend(field, cur)
      if (next < 0) break
      cur = next
      const p = this.cellCenter(cur)
      if (walkableLine(this.map, x, z, p.x, p.z, this.radius * 0.9)) best = p
      else break
    }
    return best
  }

  private descend(field: Int32Array, i: number): number {
    const cols = this.cols
    const c = i % cols
    const r = (i - c) / cols
    let best = -1
    let bestD = field[i]
    for (let dr = -1; dr <= 1; dr++) {
      const rr = r + dr
      if (rr < 0 || rr >= this.rows) continue
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue
        const cc = c + dc
        if (cc < 0 || cc >= cols) continue
        const j = rr * cols + cc
        if (this.blocked[j]) continue
        if (dr && dc && (this.blocked[r * cols + cc] || this.blocked[rr * cols + c])) continue
        if (field[j] < bestD) {
          bestD = field[j]
          best = j
        }
      }
    }
    return best
  }

  private nearestReached(field: Int32Array, x: number, z: number): number {
    const c0 = Math.floor((x - this.ox) / this.cell)
    const r0 = Math.floor((z - this.oz) / this.cell)
    for (let ring = 1; ring < 8; ring++) {
      let best = -1
      let bestD = UNREACHED
      for (let dr = -ring; dr <= ring; dr++) {
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue
          const c = c0 + dc
          const r = r0 + dr
          if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue
          const j = r * this.cols + c
          if (!this.blocked[j] && field[j] < bestD) {
            bestD = field[j]
            best = j
          }
        }
      }
      if (best >= 0) return best
    }
    return -1
  }
}

export const isReached = (field: Int32Array, idx: number) => idx >= 0 && field[idx] < UNREACHED

/** Binary min-heap of cell indices keyed by an external distance array (lazy deletion). */
class MinHeap {
  private items: number[] = []
  private keys: number[] = []
  constructor(private readonly dist: Int32Array) {}
  get size() {
    return this.items.length
  }
  push(i: number) {
    const items = this.items
    const keys = this.keys
    const k = this.dist[i]
    let n = items.length
    items.push(i)
    keys.push(k)
    while (n > 0) {
      const p = (n - 1) >> 1
      if (keys[p] <= k) break
      items[n] = items[p]
      keys[n] = keys[p]
      n = p
    }
    items[n] = i
    keys[n] = k
  }
  pop(): number {
    // Skip stale entries whose key no longer matches the best known distance.
    for (;;) {
      const items = this.items
      const keys = this.keys
      const top = items[0]
      const topKey = keys[0]
      const lastI = items.pop()!
      const lastK = keys.pop()!
      const n = items.length
      if (n > 0) {
        let i = 0
        for (;;) {
          const l = 2 * i + 1
          if (l >= n) break
          const r = l + 1
          const m = r < n && keys[r] < keys[l] ? r : l
          if (keys[m] >= lastK) break
          items[i] = items[m]
          keys[i] = keys[m]
          i = m
        }
        items[i] = lastI
        keys[i] = lastK
      }
      if (topKey === this.dist[top] || n === 0) return top
    }
  }
}
