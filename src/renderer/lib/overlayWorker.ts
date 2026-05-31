import OverlayWorkerClass from '../workers/overlayTileWorker.ts?worker'

const POOL_SIZE = Math.min(4, Math.max(2, (navigator.hardwareConcurrency ?? 4) - 1))

interface WorkerSlot {
  worker:      Worker
  pending:     Map<number, (buf: ArrayBuffer | null) => void>
  activeCount: number
}

let nextId = 0
const pool: WorkerSlot[] = []

function getPool(): WorkerSlot[] {
  while (pool.length < POOL_SIZE) {
    const slot: WorkerSlot = { worker: null!, pending: new Map(), activeCount: 0 }
    const w = new OverlayWorkerClass()
    w.onmessage = (e: MessageEvent<{ id: number; pixels: ArrayBuffer }>) => {
      const cb = slot.pending.get(e.data.id)
      if (cb) { slot.pending.delete(e.data.id); slot.activeCount--; cb(e.data.pixels) }
    }
    w.onerror = (e) => {
      console.error('Overlay worker error:', e)
      for (const cb of slot.pending.values()) cb(null)
      slot.pending.clear()
      slot.activeCount = 0
    }
    slot.worker = w
    pool.push(slot)
  }
  return pool
}

export function postOverlay(msg: Record<string, unknown>, transfer: Transferable[]): Promise<ArrayBuffer | null> {
  const workers = getPool()
  const slot = workers.reduce((a, b) => a.activeCount <= b.activeCount ? a : b)
  return new Promise(resolve => {
    const id = nextId++
    slot.pending.set(id, resolve)
    slot.activeCount++
    slot.worker.postMessage({ ...msg, id }, transfer)
  })
}
