import { memo, useEffect, useRef } from 'react'
import L from 'leaflet'
import { convertFileSrc } from '@tauri-apps/api/core'
import { useApp } from '../App'
import * as tileStats from '../lib/tileStats'
import { CHUNK_TILE_SIZE, CAVE_MODE_MIN_ZOOM, BASE_BLOCKS_PER_PIXEL, MAX_ZOOM } from '../lib/constants'
import { TileJobQueue, TileJob, evictCache } from '../lib/tileJobQueue'
import * as api from '../lib/tauriAPI'

// Zoom level at which Rust renders chunk tiles (1 block per pixel).
// Higher zooms are served from this cache with JS nearest-neighbor upscaling.
const CHUNK_NATIVE_ZOOM = 4

function nearestNeighborScale(
  parent: ImageData, upscale: number,
  subX: number, subY: number, size: number,
): ImageData {
  const result = new ImageData(size, size)
  const src = parent.data
  const dst = result.data
  for (let py = 0; py < size; py++) {
    const srcY = (subY + Math.floor(py / upscale)) * size
    for (let px = 0; px < size; px++) {
      const si = (srcY + subX + Math.floor(px / upscale)) * 4
      const di = (py * size + px) * 4
      dst[di]     = src[si]
      dst[di + 1] = src[si + 1]
      dst[di + 2] = src[si + 2]
      dst[di + 3] = src[si + 3]
    }
  }
  return result
}

// Load a tile PNG from disk (via asset protocol) into ImageData for canvas use.
// Uses an OffscreenCanvas so the main tile canvas is never tainted by the load.
function loadTileImageData(path: string): Promise<ImageData | null> {
  return new Promise<ImageData | null>((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const off = new OffscreenCanvas(CHUNK_TILE_SIZE, CHUNK_TILE_SIZE)
      const offCtx = off.getContext('2d')!
      offCtx.drawImage(img, 0, 0)
      try {
        resolve(offCtx.getImageData(0, 0, CHUNK_TILE_SIZE, CHUNK_TILE_SIZE))
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = convertFileSrc(path)
  })
}

function tileOverlapsRegions(tileX: number, tileY: number, zoom: number, regions: [number, number][]): boolean {
  const blocksPerTile = CHUNK_TILE_SIZE * (BASE_BLOCKS_PER_PIXEL / Math.pow(2, zoom))
  const minX = tileX * blocksPerTile,       maxX = minX + blocksPerTile
  const minZ = tileY * blocksPerTile,       maxZ = minZ + blocksPerTile
  return regions.some(([rx, rz]) =>
    minX < (rx + 1) * 512 && maxX > rx * 512 &&
    minZ < (rz + 1) * 512 && maxZ > rz * 512
  )
}

// ── In-memory tile cache ──────────────────────────────────────────────────────
// Keeps recently-rendered tiles as ImageData so panning revisits are instant.

const tileCache = new Map<string, ImageData>()
const MAX_CACHE = 1600

export function getChunkCacheSize() { return tileCache.size }
export function clearChunkCache() { tileCache.clear() }

// ── Tile render priority queue (module-level, one per layer type) ─────────────
// The slot is released as soon as the IPC response arrives (before PNG decode)
// so the next tile can start its IPC call while decoding runs in parallel.
const queue = new TileJobQueue(4, () => tileStats.notify())
export function getChunkQueue() { return queue }

// ── Main component ────────────────────────────────────────────────────────────

function ChunkOverlayLayer({ map, unlimitedCache = false }: { map: L.Map; unlimitedCache?: boolean }) {
  const { state } = useApp()
  const layerRef = useRef<L.GridLayer | null>(null)

  const worldDir         = state.worldDir!
  const edition          = state.seedData?.edition ?? 'java'
  const dimension        = state.dimension
  const hideWater        = state.hideWater
  const chunkOpacity     = state.chunkOpacity
  const chunkDataMinZoom = state.chunkDataMinZoom
  const tileCacheVersion = state.tileCacheVersion
  const lastUpdate       = state.lastUpdate
  const changedRegions   = state.changedRegions
  const caveMode         = state.caveMode
  const playerY          = state.seedData?.playerY ?? null
  // Floor player Y for the scan start; null when cave mode is off or Y is unknown
  const caveY            = caveMode && playerY != null ? Math.floor(playerY) : null
  const caveScanLow      = state.caveScanLow
  const caveScanHigh     = state.caveScanHigh

  useEffect(() => {
    layerRef.current?.setOpacity(chunkOpacity)
  }, [chunkOpacity])

  // ── Cache invalidation effects ────────────────────────────────────────────

  const prevWorldRef = useRef<string | null>(null)
  useEffect(() => {
    if (worldDir === prevWorldRef.current) return
    tileCache.clear()
    if (prevWorldRef.current) api.invalidateChunks(prevWorldRef.current)
    prevWorldRef.current = worldDir
  }, [worldDir])

  // Revalidate disk PNG cache every time the user loads a world (SET_SEED).
  // worldDir alone won't re-fire when the same world is re-opened, so
  // worldLoadCount gives us a reliable trigger even for same-path reloads.
  // Skip disk cache clearing for unlimited-cache worlds — those tiles are
  // deliberately preserved across reloads.
  const prevLoadCountRef = useRef(0)
  useEffect(() => {
    if (state.worldLoadCount === prevLoadCountRef.current) return
    prevLoadCountRef.current = state.worldLoadCount
    if (!worldDir) return
    tileCache.clear()
    if (!unlimitedCache) api.clearTilePng(worldDir)
  }, [state.worldLoadCount, worldDir, unlimitedCache])

  const prevHideWaterRef = useRef(hideWater)
  useEffect(() => {
    if (hideWater === prevHideWaterRef.current) return
    prevHideWaterRef.current = hideWater
    tileCache.clear()
    // PNG tiles bake hideWater into the image — regenerate them
    api.clearTilePng(worldDir)
  }, [hideWater, worldDir])

  const prevUpdateRef = useRef(0)
  useEffect(() => {
    if (lastUpdate === 0 || lastUpdate === prevUpdateRef.current) return
    prevUpdateRef.current = lastUpdate

    if (changedRegions.length === 0) {
      tileCache.clear()
      api.invalidateChunks(worldDir).catch(() => {})
      layerRef.current?.redraw()
      return
    }

    // Evict only in-memory entries that touch a changed region.
    // tileCache keys end with :tileX:tileY:zoom (last three colon-separated parts).
    for (const key of tileCache.keys()) {
      const parts = key.split(':')
      const zoom  = parseInt(parts[parts.length - 1])
      const tileY = parseInt(parts[parts.length - 2])
      const tileX = parseInt(parts[parts.length - 3])
      if (tileOverlapsRegions(tileX, tileY, zoom, changedRegions)) { tileCache.delete(key); continue }
      if (zoom > CHUNK_NATIVE_ZOOM) {
        const upscale = 1 << (zoom - CHUNK_NATIVE_ZOOM)
        if (tileOverlapsRegions(Math.floor(tileX / upscale), Math.floor(tileY / upscale), CHUNK_NATIVE_ZOOM, changedRegions))
          tileCache.delete(key)
      }
    }

    // Invalidate disk PNGs then re-render affected tiles in-place so the old
    // content stays visible until the new render is ready (no blank flash).
    api.invalidateMcaTiles(worldDir, changedRegions).then(() => {
      const layer = layerRef.current as any
      if (!layer?._tiles) return
      for (const key of Object.keys(layer._tiles)) {
        const { coords, el: canvas } = layer._tiles[key] as { coords: L.Coords; el: HTMLCanvasElement }
        if (!tileOverlapsRegions(coords.x, coords.y, coords.z, changedRegions)) continue
        // High-zoom tiles re-derive from their parent once the parent re-renders.
        if (coords.z > CHUNK_NATIVE_ZOOM) continue
        const ctx = canvas.getContext('2d')
        if (!ctx) continue
        const caveTag = caveY != null ? `${caveY}_${caveScanLow}_${caveScanHigh}` : 's'
        const cacheKey = `C:${worldDir}:${dimension}:${caveTag}:${coords.x}:${coords.y}:${coords.z}`
        const centre = map.project(map.getCenter(), coords.z)
        const dx = coords.x + 0.5 - centre.x / CHUNK_TILE_SIZE
        const dy = coords.y + 0.5 - centre.y / CHUNK_TILE_SIZE
        queue.enqueue(dx * dx + dy * dy, () => {
          api.renderTile(worldDir, edition, dimension, coords.x, coords.y, coords.z, hideWater, caveY, caveScanLow, caveScanHigh)
            .then(async path => {
              queue.release()
              if (!path || !canvas.isConnected) return
              const imageData = await loadTileImageData(path)
              if (!imageData || !canvas.isConnected) return
              ctx.clearRect(0, 0, CHUNK_TILE_SIZE, CHUNK_TILE_SIZE)
              ctx.putImageData(imageData, 0, 0)
              tileCache.set(cacheKey, imageData)
              if (!capturedUnlimitedCache) evictCache(tileCache, MAX_CACHE)
            })
            .catch(() => queue.release())
        })
      }
    })
  }, [lastUpdate])

  const prevCacheVersionRef = useRef(tileCacheVersion)
  useEffect(() => {
    if (tileCacheVersion === prevCacheVersionRef.current) return
    prevCacheVersionRef.current = tileCacheVersion
    tileCache.clear()
    api.clearTilePng(worldDir)
  }, [tileCacheVersion, worldDir])

  // Clear disk PNG cache when cave scan range changes so orphaned tiles don't accumulate
  const prevCaveScanLowRef  = useRef(caveScanLow)
  const prevCaveScanHighRef = useRef(caveScanHigh)
  useEffect(() => {
    if (caveScanLow === prevCaveScanLowRef.current && caveScanHigh === prevCaveScanHighRef.current) return
    prevCaveScanLowRef.current  = caveScanLow
    prevCaveScanHighRef.current = caveScanHigh
    api.clearTilePng(worldDir)
  }, [caveScanLow, caveScanHigh, worldDir])

  // ── Tile layer ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!map) return

    if (layerRef.current) {
      map.removeLayer(layerRef.current)
      layerRef.current = null
    }

    // Stale flag: set to true on cleanup so in-flight tile callbacks are discarded.
    // This prevents stale IPC results from dispatching stats or drawing to canvases
    // that belong to a previous layer generation.
    let stale = false

    const capturedWorldDir      = worldDir
    const capturedEdition       = edition
    const capturedDimension     = dimension
    const capturedHideWater     = hideWater
    const capturedCaveY         = caveY
    const capturedCaveScanLow   = caveScanLow
    const capturedCaveScanHigh  = caveScanHigh
    const capturedUnlimitedCache = unlimitedCache

    const ChunkLayer = L.GridLayer.extend({
      _initTile(tile: HTMLElement) {
        (L.GridLayer.prototype as any)._initTile.call(this, tile)
        tile.style.opacity = '1'
        tile.style.transition = 'none'
        tile.style.imageRendering = 'pixelated'
      },
      createTile(coords: L.Coords, done: L.DoneCallback) {
        const canvas = document.createElement('canvas')
        canvas.width  = CHUNK_TILE_SIZE
        canvas.height = CHUNK_TILE_SIZE
        canvas.style.imageRendering = 'pixelated'
        const ctx = canvas.getContext('2d')!

        const caveTag = capturedCaveY != null ? `${capturedCaveY}_${capturedCaveScanLow}_${capturedCaveScanHigh}` : 's'
        const key = `C:${capturedWorldDir}:${capturedDimension}:${caveTag}:${coords.x}:${coords.y}:${coords.z}`

        // In-memory hit — draw immediately
        const cached = tileCache.get(key)
        if (cached) {
          ctx.putImageData(cached, 0, 0)
          if (!stale) tileStats.mcaCacheHit()
          queueMicrotask(() => done(undefined, canvas))
          return canvas
        }

        // Zoom > native: serve from the cached zoom-4 parent via JS nearest-neighbor
        // upscaling — no extra .mca reads, no Rust call if the parent is already cached.
        if (coords.z > CHUNK_NATIVE_ZOOM) {
          const upscale = 1 << (coords.z - CHUNK_NATIVE_ZOOM)
          const parentX = Math.floor(coords.x / upscale)
          const parentY = Math.floor(coords.y / upscale)
          const parentKey = `C:${capturedWorldDir}:${capturedDimension}:${caveTag}:${parentX}:${parentY}:${CHUNK_NATIVE_ZOOM}`
          const subSize = CHUNK_TILE_SIZE / upscale
          const subX = (coords.x - parentX * upscale) * subSize
          const subY = (coords.y - parentY * upscale) * subSize

          const applyScale = (parent: ImageData) => {
            if (!canvas.isConnected) return
            const imageData = nearestNeighborScale(parent, upscale, subX, subY, CHUNK_TILE_SIZE)
            ctx.putImageData(imageData, 0, 0)
            tileCache.set(key, imageData)
            if (!capturedUnlimitedCache) evictCache(tileCache, MAX_CACHE)
            done(undefined, canvas)
          }

          const parentCached = tileCache.get(parentKey)
          if (parentCached) {
            if (!stale) tileStats.mcaCacheHit()
            queueMicrotask(() => applyScale(parentCached))
            return canvas
          }

          // Parent not yet cached — fetch it from Rust at native zoom, then scale.
          queueMicrotask(() => {
            const centre = map.project(map.getCenter(), CHUNK_NATIVE_ZOOM)
            const dx = parentX + 0.5 - centre.x / CHUNK_TILE_SIZE
            const dy = parentY + 0.5 - centre.y / CHUNK_TILE_SIZE
            const job = queue.enqueue(dx * dx + dy * dy, () => {
              if (!canvas.isConnected || stale) { queue.release(); done(undefined, canvas); return }
              if (!stale) tileStats.mcaLoadingStart()
              const t0 = performance.now()
              api.renderTile(
                capturedWorldDir, capturedEdition, capturedDimension,
                parentX, parentY, CHUNK_NATIVE_ZOOM,
                capturedHideWater, capturedCaveY,
                capturedCaveScanLow, capturedCaveScanHigh
              ).then(async path => {
                queue.release()
                if (stale) { done(undefined, canvas); return }
                if (!path) { tileStats.mcaLoadingDone(Math.round(performance.now() - t0)); done(undefined, canvas); return }
                const parentData = await loadTileImageData(path)
                tileStats.mcaLoadingDone(Math.round(performance.now() - t0))
                if (stale || !parentData) { done(undefined, canvas); return }
                tileCache.set(parentKey, parentData)
                if (!capturedUnlimitedCache) evictCache(tileCache, MAX_CACHE)
                applyScale(parentData)
              }).catch(err => {
                queue.release()
                if (stale) { done(undefined, canvas); return }
                tileStats.mcaLoadingDone(Math.round(performance.now() - t0))
                console.error('Chunk tile render error:', err)
                done(err as Error, canvas)
              })
            })
            ;(canvas as any)._tileJob = job
          })
          return canvas
        }

        // Native zoom (≤ CHUNK_NATIVE_ZOOM): render via Rust.
        // Defer enqueue by one microtask so Leaflet has appended the canvas to the
        // DOM before any job runs. Without this, drainQueue() fires synchronously
        // inside createTile (before the canvas is attached), canvas.isConnected is
        // false for every job, and they all bail out immediately.
        queueMicrotask(() => {
        const centre = map.project(map.getCenter(), coords.z)
        const dx = coords.x + 0.5 - centre.x / CHUNK_TILE_SIZE
        const dy = coords.y + 0.5 - centre.y / CHUNK_TILE_SIZE
        const priority = dx * dx + dy * dy

        const job = queue.enqueue(priority, () => {
          if (!canvas.isConnected || stale) { queue.release(); done(undefined, canvas); return }

          if (!stale) tileStats.mcaLoadingStart()
          const t0 = performance.now()
          api.renderTile(
            capturedWorldDir, capturedEdition, capturedDimension,
            coords.x, coords.y, coords.z,
            capturedHideWater, capturedCaveY,
            capturedCaveScanLow, capturedCaveScanHigh
          ).then(async path => {
            queue.release()
            if (stale) { done(undefined, canvas); return }
            if (!path || !canvas.isConnected) { tileStats.mcaLoadingDone(Math.round(performance.now() - t0)); done(undefined, canvas); return }
            const imageData = await loadTileImageData(path)
            tileStats.mcaLoadingDone(Math.round(performance.now() - t0))
            if (stale || !imageData || !canvas.isConnected) { done(undefined, canvas); return }
            ctx.putImageData(imageData, 0, 0)
            tileCache.set(key, imageData)
            if (!capturedUnlimitedCache) evictCache(tileCache, MAX_CACHE)
            done(undefined, canvas)
          }).catch(err => {
            queue.release()
            if (stale) { done(undefined, canvas); return }
            tileStats.mcaLoadingDone(Math.round(performance.now() - t0))
            console.error('Chunk tile render error:', err)
            done(err as Error, canvas)
          })
        })
        ;(canvas as any)._tileJob = job
        }) // end queueMicrotask

        return canvas
      },
    })

    const layer = new ChunkLayer({
      tileSize: CHUNK_TILE_SIZE, minZoom: chunkDataMinZoom,
      minNativeZoom: 3, maxNativeZoom: MAX_ZOOM,
      opacity: chunkOpacity,
      updateWhenIdle: true, updateWhenZooming: false,
      zIndex: 2,
    })

    // abortTile is not called by Leaflet on GridLayer — use tileunload instead.
    layer.on('tileunload', (e: L.TileEvent) => {
      const job = (e.tile as any)._tileJob as TileJob | undefined
      if (job) queue.cancel(job)
    })

    // If cave mode just turned on and the map needs to zoom in from a wide view,
    // defer adding the layer until the viewport transition (flyTo) completes.
    // This prevents a flood of tile requests at the old wide zoom level.
    // Child effects fire before parent effects, so our moveend listener is
    // registered before MapView's flyTo triggers the animation.
    const needsViewportTransition = capturedCaveY != null && map.getZoom() < CAVE_MODE_MIN_ZOOM

    const addLayer = () => {
      if (stale) return
      layer.addTo(map)
      layerRef.current = layer
      tileCache.clear()
    }

    if (needsViewportTransition) {
      map.once('moveend', addLayer)
    } else {
      addLayer()
    }

    return () => {
      stale = true
      map.off('moveend', addLayer)
      if (layerRef.current) {
        map.removeLayer(layerRef.current)
        layerRef.current = null
      }
      tileCache.clear()
      // Zero out in-flight counter so the UI doesn't show stale "Loading N tiles"
      tileStats.resetMcaLoading()
    }
  }, [map, worldDir, dimension, hideWater, chunkDataMinZoom, tileCacheVersion, caveY, caveScanLow, caveScanHigh, unlimitedCache])

  return null
}
export default memo(ChunkOverlayLayer)
