/**
 * Evict the oldest `evictCount` entries from a Map when it exceeds `maxSize`.
 * Maps preserve insertion order, so the first entries are the oldest.
 */
export function evictCache<K, V>(map: Map<K, V>, maxSize: number, evictCount = 40) {
  if (map.size <= maxSize) return
  const keys = map.keys()
  for (let i = 0; i < evictCount; i++) {
    const n = keys.next()
    if (n.done) break
    map.delete(n.value)
  }
}

// Priority queue for tile render jobs.
// Without throttling, all ~30 visible tiles start simultaneously when the map
// settles: they burst WASM/IPC calls then flood the worker queue. A priority
// queue fixes both problems:
//   • Only maxActive tiles run concurrently — main thread stays responsive.
//   • Tiles closest to the viewport centre render first — map fills in naturally.
//   • Pending items can be cancelled before they ever touch WASM/IPC
//     (e.g. when tileunload fires because a tile scrolled out of view).

export interface TileJob {
  id:       number
  priority: number   // squared tile-distance from map centre; lower = sooner
  status:   'pending' | 'active' | 'cancelled'
  run:      () => void
  // Abort an already-running fetch (e.g. signal the Rust side to bail). Set by
  // the consumer after enqueue. The job still calls release() when it settles.
  abort?:   () => void
}

export class TileJobQueue {
  private activeJobs = 0
  private queue: TileJob[] = []
  private nextId = 0
  private maxActive: number
  private paused = false
  private onChange?: () => void

  constructor(maxActive = 4, onChange?: () => void) {
    this.maxActive = maxActive
    this.onChange = onChange
  }

  enqueue(priority: number, run: () => void): TileJob {
    const job: TileJob = { id: this.nextId++, priority, status: 'pending', run }
    let i = this.queue.length
    while (i > 0 && this.queue[i - 1].priority > priority) i--
    this.queue.splice(i, 0, job)
    this.drain()
    this.onChange?.()
    return job
  }

  get size() { return this.activeJobs + this.queue.length }

  cancel(job: TileJob) {
    if (job.status === 'cancelled') return
    if (job.status === 'active') {
      // Already running: ask it to bail. It still calls release() when it settles,
      // so activeJobs accounting stays correct — just mark it so we don't re-run.
      job.status = 'cancelled'
      job.abort?.()
      return
    }
    job.status = 'cancelled'
    const idx = this.queue.indexOf(job)
    if (idx >= 0) this.queue.splice(idx, 1)
    this.onChange?.()
  }

  release() {
    this.activeJobs--
    this.drain()
    this.onChange?.()
  }

  // Suspend new jobs from starting (in-flight jobs continue to completion).
  pause() { this.paused = true }

  // Resume draining the queue.
  resume() { this.paused = false; this.drain() }

  private drain() {
    if (this.paused) return
    while (this.activeJobs < this.maxActive && this.queue.length > 0) {
      const job = this.queue.shift()!
      if (job.status === 'cancelled') continue
      job.status = 'active'
      this.activeJobs++
      job.run()
    }
  }
}
