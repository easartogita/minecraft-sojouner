import { memo, useEffect, useRef } from 'react'
import L from 'leaflet'
import { useApp } from '../App'
import * as tileStats from '../lib/tileStats'
import { CHUNK_TILE_SIZE as LIVE_CHUNK_TILE_SIZE, MAX_ZOOM } from '../lib/constants'
import { TileJobQueue, TileJob, evictCache } from '../lib/tileJobQueue'
import { blocksPerTile } from '../lib/tileCoords'
import { nearestNeighborScale } from '../hooks/useTileLayer'
import * as api from '../lib/tauriAPI'
import { caveZoomRange, effectiveCaveAnchorY } from '../hooks/overlaySlice'

// Zoom level at which Rust renders chunk tiles (1 block per pixel).
// Higher zooms are served from this cache with JS nearest-neighbor upscaling.
const CHUNK_NATIVE_ZOOM = 4

// The live app renders/caches chunk tiles at LIVE_CHUNK_TILE_SIZE; a static export bakes
// them at whatever size its manifest reports instead — every canvas dimension in this
// file funnels through this so it matches the actual PNG. Module-level (not a prop)
// because tile-fetch closures below outlive a single render.
let currentDimension = 'overworld'
function activeTileSize(): number {
  if (!api.IS_STATIC_SITE) return LIVE_CHUNK_TILE_SIZE
  const sizes = api.getTileSizes(currentDimension)
  return sizes.chunk ?? sizes.chunkHideWater ?? LIVE_CHUNK_TILE_SIZE
}

// Loads a tile PNG into ImageData via an OffscreenCanvas so the main tile canvas is never
// tainted. `version` (the mca-mtime) is appended as `?v=` so a rewritten tile at the same
// path gets a distinct URL — otherwise WebKit's asset-URL cache keeps serving the stale
// decoded image after the PNG is overwritten on disk.
function loadTileImageData(path: string, version: number): Promise<ImageData | null> {
  return new Promise<ImageData | null>((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const off = new OffscreenCanvas(activeTileSize(), activeTileSize())
      const offCtx = off.getContext('2d')!
      offCtx.drawImage(img, 0, 0)
      try {
        resolve(offCtx.getImageData(0, 0, activeTileSize(), activeTileSize()))
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    const base = api.tileSrc(path)
    img.src = `${base}${base.includes('?') ? '&' : '?'}v=${version}`
  })
}

function tileOverlapsRegions(tileX: number, tileY: number, zoom: number, regions: [number, number][]): boolean {
  const tileBlocks = blocksPerTile(activeTileSize(), zoom)
  const minX = tileX * tileBlocks,       maxX = minX + tileBlocks
  const minZ = tileY * tileBlocks,       maxZ = minZ + tileBlocks
  return regions.some(([rx, rz]) =>
    minX < (rx + 1) * 512 && maxX > rx * 512 &&
    minZ < (rz + 1) * 512 && maxZ > rz * 512
  )
}

// In-memory ImageData cache so panning revisits are instant. Each entry carries the
// source .mca mtime so a memory hit can be re-validated against a live region rewrite.
interface CachedTile { data: ImageData; mtime: number }
const tileCache = new Map<string, CachedTile>()
const MAX_CACHE = 1600

export function getChunkCacheSize() { return tileCache.size }
export function clearChunkCache() { tileCache.clear() }

// Module-level render priority queue. The slot releases as soon as the IPC response
// arrives (before PNG decode) so the next tile's IPC call can overlap this one's decode.
const queue = new TileJobQueue(4, () => tileStats.notify(), 'chunk')
export function getChunkQueue() { return queue }


function ChunkOverlayLayer({ map, unlimitedCache = false }: { map: L.Map; unlimitedCache?: boolean }) {
  const { state } = useApp()
  const layerRef = useRef<L.GridLayer | null>(null)

  const worldDir         = state.worldDir!
  const edition          = state.seedData?.edition ?? 'java'
  const dimension        = state.dimension
  currentDimension = dimension
  const hideWater        = state.hideWater
  const chunkOpacity     = state.chunkOpacity
  const chunkDataMinZoom = state.chunkDataMinZoom
  const tileCacheVersion = state.tileCacheVersion
  const lastUpdate       = state.lastUpdate
  const changedRegions   = state.changedRegions
  const caveMode         = state.caveMode
  const playerY          = state.seedData?.playerY ?? null
  // Scan-window anchor: live player Y when locked, frozen anchor when unlocked;
  // null when cave mode is off or no position is known.
  const caveY            = effectiveCaveAnchorY(state, playerY)
  const caveScanLow      = state.yFilterLow
  const caveScanHigh     = state.yFilterHigh

  // Only revalidate in-memory tiles against disk while a live world is watched — offline
  // worlds never change. Ref so watch state is read live without rebuilding the layer.
  const watchingRef = useRef(state.isWatching)
  watchingRef.current = state.isWatching

  useEffect(() => {
    layerRef.current?.setOpacity(chunkOpacity)
  }, [chunkOpacity])

  const prevWorldRef = useRef<string | null>(null)
  useEffect(() => {
    if (worldDir === prevWorldRef.current) return
    tileCache.clear()
    if (prevWorldRef.current) api.invalidateChunks(prevWorldRef.current)
    prevWorldRef.current = worldDir
  }, [worldDir])

  // worldDir alone won't re-fire when the same world is re-opened, so worldLoadCount is a
  // reliable trigger for same-path reloads too. Skip clearing for unlimited-cache worlds —
  // those tiles are deliberately preserved across reloads.
  const unlimitedCacheRef = useRef(unlimitedCache)
  unlimitedCacheRef.current = unlimitedCache

  const prevLoadCountRef = useRef(0)
  useEffect(() => {
    if (state.worldLoadCount === prevLoadCountRef.current) return
    prevLoadCountRef.current = state.worldLoadCount
    if (!worldDir) return
    tileCache.clear()
    if (!unlimitedCacheRef.current) api.clearTilePng(worldDir)
  }, [state.worldLoadCount, worldDir])

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

    // Invalidate disk PNGs then re-render affected tiles in-place so the old content
    // stays visible until the new render is ready (no blank flash).
    api.invalidateMcaTiles(worldDir, changedRegions).then(() => {
      const layer = layerRef.current as any
      if (!layer?._tiles) return
      const caveTag = caveY != null ? `${caveY}_${caveScanLow}_${caveScanHigh}` : 's'

      // Group affected on-screen tiles by the native-zoom parent that must be re-rendered
      // (higher zooms share and upscale from a zoom-CHUNK_NATIVE_ZOOM parent). Needed
      // because while zoomed in, Leaflet keeps existing tile elements after a cache evict
      // — without repainting them here, nothing updates until a re-scale recreates them.
      type Target = { coords: L.Coords; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }
      const groups = new Map<string, { rx: number; ry: number; renderZ: number; targets: Target[] }>()

      for (const key of Object.keys(layer._tiles)) {
        const { coords, el: canvas } = layer._tiles[key] as { coords: L.Coords; el: HTMLCanvasElement }
        if (!tileOverlapsRegions(coords.x, coords.y, coords.z, changedRegions)) continue
        const ctx = canvas.getContext('2d')
        if (!ctx) continue
        const upscale = coords.z > CHUNK_NATIVE_ZOOM ? (1 << (coords.z - CHUNK_NATIVE_ZOOM)) : 1
        const renderZ = coords.z > CHUNK_NATIVE_ZOOM ? CHUNK_NATIVE_ZOOM : coords.z
        const rx = Math.floor(coords.x / upscale)
        const ry = Math.floor(coords.y / upscale)
        const gkey = `${rx}:${ry}:${renderZ}`
        const g = groups.get(gkey)
        if (g) g.targets.push({ coords, canvas, ctx })
        else groups.set(gkey, { rx, ry, renderZ, targets: [{ coords, canvas, ctx }] })
      }

      for (const { rx, ry, renderZ, targets } of groups.values()) {
        const centre = map.project(map.getCenter(), renderZ)
        const dx = rx + 0.5 - centre.x / activeTileSize()
        const dy = ry + 0.5 - centre.y / activeTileSize()
        queue.enqueue(dx * dx + dy * dy, j => {
          api.renderTile(worldDir, edition, dimension, rx, ry, renderZ, hideWater, caveY, caveScanLow, caveScanHigh)
            .then(async rt => {
              queue.release(j)
              if (!rt) return
              const parentData = await loadTileImageData(rt.path, rt.mtime)
              if (!parentData) return
              tileCache.set(`C:${worldDir}:${dimension}:${caveTag}:${rx}:${ry}:${renderZ}`, { data: parentData, mtime: rt.mtime })
              for (const { coords, canvas, ctx } of targets) {
                if (!canvas.isConnected) continue
                let imageData = parentData
                if (coords.z > CHUNK_NATIVE_ZOOM) {
                  const upscale = 1 << (coords.z - CHUNK_NATIVE_ZOOM)
                  const subSize = activeTileSize() / upscale
                  const subX = (coords.x - rx * upscale) * subSize
                  const subY = (coords.y - ry * upscale) * subSize
                  imageData = nearestNeighborScale(parentData, upscale, subX, subY, activeTileSize())
                }
                ctx.clearRect(0, 0, activeTileSize(), activeTileSize())
                ctx.putImageData(imageData, 0, 0)
                tileCache.set(`C:${worldDir}:${dimension}:${caveTag}:${coords.x}:${coords.y}:${coords.z}`, { data: imageData, mtime: rt.mtime })
              }
              if (!unlimitedCacheRef.current) evictCache(tileCache, MAX_CACHE)
            })
            .catch(() => queue.release(j))
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

  useEffect(() => {
    if (!map) return

    if (layerRef.current) {
      map.removeLayer(layerRef.current)
      layerRef.current = null
    }

    // Set true on cleanup so in-flight tile callbacks from a previous layer generation
    // don't dispatch stats or draw to canvases that no longer belong to this layer.
    let stale = false

    const capturedWorldDir      = worldDir
    const capturedEdition       = edition
    const capturedDimension     = dimension
    const capturedHideWater     = hideWater
    const capturedCaveY         = caveY
    const capturedCaveScanLow   = caveScanLow
    const capturedCaveScanHigh  = caveScanHigh
    const capturedUnlimitedCache = unlimitedCacheRef.current

    // Re-render one tile in place — native, or upscaled from its zoom-4 parent —
    // repainting the canvas and refreshing the cache. Heals a stale in-memory tile.
    const repaintStaleTile = (coords: L.Coords, canvas: HTMLCanvasElement, key: string, caveTag: string) => {
      const ctx = canvas.getContext('2d'); if (!ctx) return
      const upscale = coords.z > CHUNK_NATIVE_ZOOM ? (1 << (coords.z - CHUNK_NATIVE_ZOOM)) : 1
      const renderZ = coords.z > CHUNK_NATIVE_ZOOM ? CHUNK_NATIVE_ZOOM : coords.z
      const rx = Math.floor(coords.x / upscale)
      const ry = Math.floor(coords.y / upscale)
      const parentKey = `C:${capturedWorldDir}:${capturedDimension}:${caveTag}:${rx}:${ry}:${CHUNK_NATIVE_ZOOM}`
      const centre = map.project(map.getCenter(), renderZ)
      const dx = rx + 0.5 - centre.x / activeTileSize()
      const dy = ry + 0.5 - centre.y / activeTileSize()
      queue.enqueue(dx * dx + dy * dy, j => {
        if (stale || !canvas.isConnected) { queue.release(j); return }
        api.renderTile(
          capturedWorldDir, capturedEdition, capturedDimension,
          rx, ry, renderZ, capturedHideWater, capturedCaveY, capturedCaveScanLow, capturedCaveScanHigh,
        ).then(async rt => {
          queue.release(j)
          if (stale || !rt || !canvas.isConnected) return
          const parentData = await loadTileImageData(rt.path, rt.mtime)
          if (stale || !parentData || !canvas.isConnected) return
          let imageData = parentData
          if (coords.z > CHUNK_NATIVE_ZOOM) {
            tileCache.set(parentKey, { data: parentData, mtime: rt.mtime })
            const subSize = activeTileSize() / upscale
            const subX = (coords.x - rx * upscale) * subSize
            const subY = (coords.y - ry * upscale) * subSize
            imageData = nearestNeighborScale(parentData, upscale, subX, subY, activeTileSize())
          }
          ctx.clearRect(0, 0, activeTileSize(), activeTileSize())
          ctx.putImageData(imageData, 0, 0)
          tileCache.set(key, { data: imageData, mtime: rt.mtime })
          if (!capturedUnlimitedCache) evictCache(tileCache, MAX_CACHE)
        }).catch(() => queue.release(j))
      })
    }

    // On an in-memory hit while watching a live world, confirm the source hasn't been
    // rewritten since render — covers the file watcher missing a change. No-op offline.
    const revalidateTile = (coords: L.Coords, canvas: HTMLCanvasElement, key: string, caveTag: string) => {
      if (!watchingRef.current) return
      api.tileSourceMtime(capturedWorldDir, capturedEdition, capturedDimension, coords.x, coords.y, coords.z)
        .then(current => {
          if (stale || !canvas.isConnected) return
          const entry = tileCache.get(key)                 // compare live; another path may have refreshed it
          if (!entry || current <= 0 || current <= entry.mtime) return
          tileCache.delete(key)
          repaintStaleTile(coords, canvas, key, caveTag)
        }).catch(() => {})
    }

    const ChunkLayer = L.GridLayer.extend({
      _initTile(tile: HTMLElement) {
        (L.GridLayer.prototype as any)._initTile.call(this, tile)
        tile.style.opacity = '1'
        tile.style.transition = 'none'
        tile.style.imageRendering = 'pixelated'
      },
      createTile(coords: L.Coords, done: L.DoneCallback) {
        const canvas = document.createElement('canvas')
        canvas.width  = activeTileSize()
        canvas.height = activeTileSize()
        canvas.style.imageRendering = 'pixelated'
        const ctx = canvas.getContext('2d')!

        const caveTag = capturedCaveY != null ? `${capturedCaveY}_${capturedCaveScanLow}_${capturedCaveScanHigh}` : 's'
        const key = `C:${capturedWorldDir}:${capturedDimension}:${caveTag}:${coords.x}:${coords.y}:${coords.z}`

        // In-memory hit — draw immediately, then revalidate against the source.
        const cached = tileCache.get(key)
        if (cached) {
          ctx.putImageData(cached.data, 0, 0)
          if (!stale) tileStats.mcaCacheHit()
          queueMicrotask(() => done(undefined, canvas))
          revalidateTile(coords, canvas, key, caveTag)
          return canvas
        }

        // Zoom > native: serve from the cached zoom-4 parent via JS nearest-neighbor
        // upscaling — no extra .mca reads, no Rust call if the parent is already cached.
        if (coords.z > CHUNK_NATIVE_ZOOM) {
          const upscale = 1 << (coords.z - CHUNK_NATIVE_ZOOM)
          const parentX = Math.floor(coords.x / upscale)
          const parentY = Math.floor(coords.y / upscale)
          const parentKey = `C:${capturedWorldDir}:${capturedDimension}:${caveTag}:${parentX}:${parentY}:${CHUNK_NATIVE_ZOOM}`
          const subSize = activeTileSize() / upscale
          const subX = (coords.x - parentX * upscale) * subSize
          const subY = (coords.y - parentY * upscale) * subSize

          const applyScale = (parent: ImageData, mtime: number) => {
            if (!canvas.isConnected) return
            const imageData = nearestNeighborScale(parent, upscale, subX, subY, activeTileSize())
            ctx.putImageData(imageData, 0, 0)
            tileCache.set(key, { data: imageData, mtime })
            if (!capturedUnlimitedCache) evictCache(tileCache, MAX_CACHE)
            done(undefined, canvas)
          }

          const parentCached = tileCache.get(parentKey)
          if (parentCached) {
            if (!stale) tileStats.mcaCacheHit()
            queueMicrotask(() => applyScale(parentCached.data, parentCached.mtime))
            // A child inherits its parent's mtime; revalidate so a parent rewrite
            // refreshes the upscaled child too (runs after applyScale caches it).
            revalidateTile(coords, canvas, key, caveTag)
            return canvas
          }

          // Parent not yet cached — fetch it from Rust at native zoom, then scale.
          queueMicrotask(() => {
            const centre = map.project(map.getCenter(), CHUNK_NATIVE_ZOOM)
            const dx = parentX + 0.5 - centre.x / activeTileSize()
            const dy = parentY + 0.5 - centre.y / activeTileSize()
            const job = queue.enqueue(dx * dx + dy * dy, j => {
              if (!canvas.isConnected || stale) { queue.release(j); done(undefined, canvas); return }
              if (!stale) tileStats.mcaLoadingStart()
              const t0 = performance.now()
              api.renderTile(
                capturedWorldDir, capturedEdition, capturedDimension,
                parentX, parentY, CHUNK_NATIVE_ZOOM,
                capturedHideWater, capturedCaveY,
                capturedCaveScanLow, capturedCaveScanHigh
              ).then(async rt => {
                queue.release(j)
                if (stale) { done(undefined, canvas); return }
                if (!rt) { tileStats.mcaLoadingDone(Math.round(performance.now() - t0)); done(undefined, canvas); return }
                const parentData = await loadTileImageData(rt.path, rt.mtime)
                tileStats.mcaLoadingDone(Math.round(performance.now() - t0))
                if (stale || !parentData) { done(undefined, canvas); return }
                tileCache.set(parentKey, { data: parentData, mtime: rt.mtime })
                if (!capturedUnlimitedCache) evictCache(tileCache, MAX_CACHE)
                applyScale(parentData, rt.mtime)
              }).catch(err => {
                queue.release(j)
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

        // Native zoom: render via Rust. Defer enqueue by a microtask so Leaflet has
        // appended the canvas before the job runs — otherwise canvas.isConnected is
        // false for every job (drainQueue fires synchronously inside createTile) and
        // they all bail out immediately.
        queueMicrotask(() => {
        const centre = map.project(map.getCenter(), coords.z)
        const dx = coords.x + 0.5 - centre.x / activeTileSize()
        const dy = coords.y + 0.5 - centre.y / activeTileSize()
        const priority = dx * dx + dy * dy

        const job = queue.enqueue(priority, j => {
          if (!canvas.isConnected || stale) { queue.release(j); done(undefined, canvas); return }

          if (!stale) tileStats.mcaLoadingStart()
          const t0 = performance.now()
          api.renderTile(
            capturedWorldDir, capturedEdition, capturedDimension,
            coords.x, coords.y, coords.z,
            capturedHideWater, capturedCaveY,
            capturedCaveScanLow, capturedCaveScanHigh
          ).then(async rt => {
            queue.release(j)
            if (stale) { done(undefined, canvas); return }
            if (!rt || !canvas.isConnected) { tileStats.mcaLoadingDone(Math.round(performance.now() - t0)); done(undefined, canvas); return }
            const imageData = await loadTileImageData(rt.path, rt.mtime)
            tileStats.mcaLoadingDone(Math.round(performance.now() - t0))
            if (stale || !imageData || !canvas.isConnected) { done(undefined, canvas); return }
            ctx.putImageData(imageData, 0, 0)
            tileCache.set(key, { data: imageData, mtime: rt.mtime })
            if (!capturedUnlimitedCache) evictCache(tileCache, MAX_CACHE)
            done(undefined, canvas)
          }).catch(err => {
            queue.release(j)
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
      tileSize: activeTileSize(), minZoom: chunkDataMinZoom,
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

    // If cave mode just turned on and needs to zoom in from a wide view, defer adding the
    // layer until the flyTo transition completes, to avoid a flood of requests at the old
    // zoom. Child effects fire before parent effects, so this listener registers before
    // MapView's flyTo triggers the animation.
    const [caveMin] = caveZoomRange(state, dimension)
    const needsViewportTransition = capturedCaveY != null && map.getZoom() < caveMin

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
      // Drop the queued backlog + abort in-flight renders so a teardown mid-load
      // doesn't keep the backend rendering tiles no one is waiting for.
      queue.cancelAll()
      if (layerRef.current) {
        map.removeLayer(layerRef.current)
        layerRef.current = null
      }
      tileCache.clear()
      // Zero out in-flight counter so the UI doesn't show stale "Loading N tiles"
      tileStats.resetMcaLoading()
    }
  }, [map, worldDir, edition, dimension, hideWater, chunkDataMinZoom, tileCacheVersion, caveY, caveScanLow, caveScanHigh,
      state.caveZoomMinOverworld, state.caveZoomMinNether])

  return null
}
export default memo(ChunkOverlayLayer)
