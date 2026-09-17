import * as tileStats from './tileStats'

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

// Priority queue for tile render jobs: without it, all visible tiles would burst
// IPC calls simultaneously when the map settles. Caps concurrency, renders tiles
// closest to viewport centre first, and lets pending jobs cancel before they touch IPC.

export interface TileJob {
  id:       number
  priority: number   // squared tile-distance from map centre; lower = sooner
  status:   'pending' | 'active' | 'cancelled'
  // Receives the job itself so the callback can pass it back to release() —
  // completions arrive in arbitrary order, not the order jobs were started.
  run:      (job: TileJob) => void
  // Signals the Rust side to bail on an in-flight fetch; job still calls release() when it settles.
  abort?:   () => void
}

// Point-in-time queue view for the debug panel. Cumulative counters persist across
// drains so a leak (a torn-down layer still feeding the backend) shows as `started` climbing.
export interface QueueSnapshot {
  name:      string
  active:    number
  pending:   number
  maxActive: number
  paused:    boolean
  started:   number
  completed: number
  cancelled: number
}

// Every queue self-registers here so the debug panel / visibility-pause handler
// can enumerate them without each call site wiring one up by hand.
const registry: TileJobQueue[] = []
export function getAllQueues(): readonly TileJobQueue[] { return registry }

export class TileJobQueue {
  private activeJobs = new Set<TileJob>()
  private queue: TileJob[] = []
  private nextId = 0
  private maxActive: number
  private paused = false
  private onChange?: () => void
  readonly name: string
  // Cumulative, for diagnostics — never reset by drains.
  private started = 0
  private completed = 0
  private cancelledTotal = 0

  constructor(maxActive = 4, onChange?: () => void, name?: string) {
    this.maxActive = maxActive
    this.onChange = onChange
    this.name = name ?? `queue-${registry.length}`
    registry.push(this)
  }

  enqueue(priority: number, run: (job: TileJob) => void): TileJob {
    const job: TileJob = { id: this.nextId++, priority, status: 'pending', run }
    let i = this.queue.length
    while (i > 0 && this.queue[i - 1].priority > priority) i--
    this.queue.splice(i, 0, job)
    this.drain()
    this.onChange?.()
    return job
  }

  get active()  { return this.activeJobs.size }
  get pending() { return this.queue.length }
  get size()    { return this.activeJobs.size + this.queue.length }

  snapshot(): QueueSnapshot {
    return {
      name:      this.name,
      active:    this.activeJobs.size,
      pending:   this.queue.length,
      maxActive: this.maxActive,
      paused:    this.paused,
      started:   this.started,
      completed: this.completed,
      cancelled: this.cancelledTotal,
    }
  }

  cancel(job: TileJob) {
    if (job.status === 'cancelled') return
    if (job.status === 'active') {
      // Already running: mark cancelled so it isn't re-run; it still calls release() on settle.
      job.status = 'cancelled'
      this.cancelledTotal++
      job.abort?.()
      return
    }
    job.status = 'cancelled'
    this.cancelledTotal++
    const idx = this.queue.indexOf(job)
    if (idx >= 0) this.queue.splice(idx, 1)
    this.onChange?.()
  }

  // Drop the backlog and abort in-flight jobs. Called on layer teardown so queued jobs
  // stop feeding the backend instead of draining through cubiomes after the layer is gone.
  cancelAll() {
    for (const job of this.queue) {
      if (job.status !== 'cancelled') { job.status = 'cancelled'; this.cancelledTotal++ }
    }
    this.queue = []
    // Snapshot before aborting: an abort can settle a fetch that calls release()
    // synchronously, mutating activeJobs mid-iteration.
    for (const job of [...this.activeJobs]) {
      if (job.status !== 'cancelled') { job.status = 'cancelled'; this.cancelledTotal++ }
      job.abort?.()
    }
    this.onChange?.()
  }

  // Callers must pass the exact job they were handed by `run`/`enqueue` — fetches
  // settle in whatever order they finish, not the order jobs were started, so
  // dropping an arbitrary entry here would let more than maxActive run at once.
  release(job: TileJob) {
    this.activeJobs.delete(job)
    this.completed++
    this.drain()
    this.onChange?.()
  }

  // Suspend new jobs from starting (in-flight jobs continue to completion).
  pause() { this.paused = true }

  resume() { this.paused = false; this.drain() }

  private drain() {
    if (this.paused) return
    while (this.activeJobs.size < this.maxActive && this.queue.length > 0) {
      const job = this.queue.shift()!
      if (job.status === 'cancelled') continue
      job.status = 'active'
      this.activeJobs.add(job)
      this.started++
      job.run(job)
    }
  }
}

// Live+static queue/cache pair shared by the overlay layers.
export interface OverlayQueuePair {
  liveQueue: TileJobQueue
  liveCache?: Map<string, ImageData | string>
  staticQueue: TileJobQueue
  staticCache: Map<string, ImageData | string>
}

export function createOverlayQueuePair(
  key: string, label: string, className: string,
  opts: { liveCache?: boolean } = {},
): OverlayQueuePair {
  const liveQueue = new TileJobQueue(4, () => tileStats.notify(), key)
  const liveCache = opts.liveCache === false ? undefined : new Map<string, ImageData | string>()
  const staticQueue = new TileJobQueue(4, () => tileStats.notify(), `${key}/static`)
  const staticCache = new Map<string, ImageData | string>()
  tileStats.registerOverlay({
    key, label, className,
    queues: [liveQueue, staticQueue],
    caches: liveCache ? [liveCache, staticCache] : [staticCache],
  })
  return { liveQueue, liveCache, staticQueue, staticCache }
}
