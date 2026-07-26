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

// A point-in-time view of one queue, for the debug panel / HUD. `active` +
// `pending` = `size`. The cumulative counters (`started`/`completed`/`cancelled`)
// persist across drains so a leak — e.g. a torn-down layer whose backlog never
// stopped feeding the backend — is visible as `started` climbing while nothing
// is on screen.
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

// Every queue self-registers here on construction so the debug panel and the
// visibility-pause handler can enumerate them without each call site wiring one
// up by hand (which is how the two orphan queues went invisible before).
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

  enqueue(priority: number, run: () => void): TileJob {
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
      // Already running: ask it to bail. It still calls release() when it settles,
      // so activeJobs accounting stays correct — just mark it so we don't re-run.
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

  // Drop the entire backlog and abort everything in flight. Called when a layer
  // is torn down (toggled off / world switched) so its queued jobs stop feeding
  // the backend instead of draining one-by-one through cubiomes long after the
  // layer is gone — the cause of CPU staying pegged "while doing nothing".
  // Active jobs still call release() when their (now-aborted) fetch settles, so
  // the count converges to zero on its own.
  cancelAll() {
    for (const job of this.queue) {
      if (job.status !== 'cancelled') { job.status = 'cancelled'; this.cancelledTotal++ }
    }
    this.queue = []
    // Snapshot before aborting: an abort could settle a fetch that calls
    // release() synchronously, which mutates activeJobs mid-iteration.
    for (const job of [...this.activeJobs]) {
      if (job.status !== 'cancelled') { job.status = 'cancelled'; this.cancelledTotal++ }
      job.abort?.()
    }
    this.onChange?.()
  }

  release() {
    // We don't get the job identity here (consumers call queue.release() from
    // their settle callbacks), so drop the oldest still-active entry. Order
    // doesn't matter for the count or the abort set — every active job releases
    // exactly once. Any it leaves behind are pruned by the size check.
    const first = this.activeJobs.values().next()
    if (!first.done) this.activeJobs.delete(first.value)
    this.completed++
    this.drain()
    this.onChange?.()
  }

  // Suspend new jobs from starting (in-flight jobs continue to completion).
  pause() { this.paused = true }

  // Resume draining the queue.
  resume() { this.paused = false; this.drain() }

  private drain() {
    if (this.paused) return
    while (this.activeJobs.size < this.maxActive && this.queue.length > 0) {
      const job = this.queue.shift()!
      if (job.status === 'cancelled') continue
      job.status = 'active'
      this.activeJobs.add(job)
      this.started++
      job.run()
    }
  }
}
