// Persistent tile cache backed by IndexedDB.
// Biome tiles are keyed by seed+version+dim (auto-stale when those change).
// Chunk tiles are keyed by worldDir+dim (invalidated on world save).

const DB_NAME    = 'mc-sojourner-tiles'
const STORE_NAME = 'tiles'
const DB_VERSION = 1
const MAX_TILES  = 8000

interface TileRecord {
  pixels: ArrayBuffer   // Uint8ClampedArray of TILE_SIZE*TILE_SIZE*4 bytes
  ts: number            // Unix ms — used for FIFO eviction
}

let _db: IDBDatabase | null = null
let _opening: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db)
  if (_opening) return _opening

  _opening = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE_NAME, { keyPath: 'key' })
      store.createIndex('ts', 'ts')
    }
    req.onsuccess = () => { _db = req.result; resolve(_db) }
    req.onerror  = () => reject(req.error)
  })
  return _opening
}

export async function getTile(key: string): Promise<ImageData | null> {
  try {
    const db = await openDB()
    return new Promise(resolve => {
      const req = db
        .transaction(STORE_NAME, 'readonly')
        .objectStore(STORE_NAME)
        .get(key)
      req.onsuccess = () => {
        const rec: (TileRecord & { key: string }) | undefined = req.result
        if (!rec) { resolve(null); return }
        resolve(new ImageData(new Uint8ClampedArray(rec.pixels), 256, 256))
      }
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

export async function setTile(key: string, imageData: ImageData): Promise<void> {
  try {
    const db = await openDB()
    await new Promise<void>((resolve) => {
      const tx    = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      // Copy the buffer — ImageData.data.buffer may be shared/detached later
      store.put({ key, pixels: imageData.data.buffer.slice(0), ts: Date.now() })
      tx.oncomplete = () => resolve()
      tx.onerror    = () => resolve()
    })
    evictOldTiles()  // fire-and-forget eviction
  } catch { /* non-critical */ }
}

export async function invalidateTilesWithPrefix(prefix: string): Promise<void> {
  try {
    const db = await openDB()
    await new Promise<void>(resolve => {
      const tx    = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const req   = store.openCursor()
      req.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result
        if (!cursor) { resolve(); return }
        if ((cursor.key as string).startsWith(prefix)) cursor.delete()
        cursor.continue()
      }
      req.onerror = () => resolve()
    })
  } catch { /* non-critical */ }
}

export async function clearAllTiles(): Promise<void> {
  try {
    const db = await openDB()
    await new Promise<void>(resolve => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).clear()
      tx.oncomplete = () => resolve()
      tx.onerror    = () => resolve()
    })
  } catch { /* non-critical */ }
}

export async function getTileCount(): Promise<number> {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const req = db
        .transaction(STORE_NAME, 'readonly')
        .objectStore(STORE_NAME)
        .count()
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(0)
    })
  } catch { return 0 }
}

async function evictOldTiles(): Promise<void> {
  try {
    const db = await openDB()
    const count: number = await new Promise((resolve, reject) => {
      const req = db
        .transaction(STORE_NAME, 'readonly')
        .objectStore(STORE_NAME)
        .count()
      req.onsuccess = () => resolve(req.result)
      req.onerror   = () => reject(req.error)
    })

    if (count <= MAX_TILES) return

    // Delete oldest (count - MAX_TILES) entries by ascending ts
    const toDelete = count - MAX_TILES
    await new Promise<void>(resolve => {
      const tx      = db.transaction(STORE_NAME, 'readwrite')
      const store   = tx.objectStore(STORE_NAME)
      const tsIndex = store.index('ts')
      let deleted   = 0
      const req = tsIndex.openCursor()
      req.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result
        if (!cursor || deleted >= toDelete) { resolve(); return }
        cursor.delete()
        deleted++
        cursor.continue()
      }
      req.onerror = () => resolve()
    })
  } catch { /* non-critical */ }
}
