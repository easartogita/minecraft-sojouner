import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { TileJobQueue, TileJob, evictCache } from '../lib/tileJobQueue'

export interface UseTileLayerOptions {
  map: L.Map
  queue: TileJobQueue
  tileSize: number
  opacity?: number
  zIndex?: number
  layerOptions?: Partial<L.GridLayerOptions>
  deps: React.DependencyList
  enabled?: boolean
  cache?: Map<string, ImageData | string>
  // Which deps actually invalidate `cache`'s contents — e.g. a new seed/world,
  // or an explicit force-refresh counter (tileCacheVersion/overlayCacheVersion).
  // Defaults to `deps` (old behavior: clear on ANY dep change). Pass a narrower
  // list when `cacheKeyFn` already encodes some of `deps` (e.g. dimension,
  // biomeMode toggles) — those don't need a clear, since old entries just sit
  // under keys that stop being read rather than colliding with new ones.
  cacheEpochDeps?: React.DependencyList
  maxCache?: number
  cacheKeyFn?: (coords: L.Coords) => string
  skip?: (coords: L.Coords) => boolean
  // `signal` aborts when the tile is scrolled out of view while the fetch is in
  // flight — heavy fetches should pass a cancel token to the backend on abort.
  fetch: (coords: L.Coords, signal?: AbortSignal) => Promise<ImageData | string | null>
  onCleanup?: () => void
  loadingAnimation?: (ctx: CanvasRenderingContext2D, size: number, elapsed: number) => void
  loadingGifs?: string[]   // if set, show a randomly-picked GIF while fetching (no JS animation loop)
  nativeZoom?: number      // tiles above this zoom are nearest-neighbor upscaled in JS from the native tile
}

function nearestNeighborScale(
  parent: ImageData, upscale: number,
  subX: number, subY: number, size: number,
): ImageData {
  const result = new ImageData(size, size)
  const src = parent.data, dst = result.data
  for (let py = 0; py < size; py++) {
    const srcY = (subY + Math.floor(py / upscale)) * size
    for (let px = 0; px < size; px++) {
      const si = (srcY + subX + Math.floor(px / upscale)) * 4
      const di = (py * size + px) * 4
      dst[di] = src[si]; dst[di+1] = src[si+1]; dst[di+2] = src[si+2]; dst[di+3] = src[si+3]
    }
  }
  return result
}

async function urlToImageData(url: string, size: number): Promise<ImageData> {
  const bitmap = await createImageBitmap(await (await globalThis.fetch(url)).blob())
  const canvas = new OffscreenCanvas(size, size)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
  return canvas.getContext('2d')!.getImageData(0, 0, size, size)
}

export function useTileLayer({
  map,
  queue,
  tileSize,
  opacity = 1,
  zIndex = 1,
  layerOptions = {},
  deps,
  enabled = true,
  cache,
  cacheEpochDeps,
  maxCache = 400,
  cacheKeyFn,
  skip,
  fetch,
  onCleanup,
  loadingAnimation,
  loadingGifs,
  nativeZoom,
}: UseTileLayerOptions): React.RefObject<L.GridLayer | null> {
  const layerRef = useRef<L.GridLayer | null>(null)
  const maxCacheRef = useRef(maxCache)
  maxCacheRef.current = maxCache
  const epochRef = useRef<React.DependencyList | undefined>(undefined)

  useEffect(() => {
    layerRef.current?.setOpacity(opacity)
  }, [opacity])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!map) return

    if (layerRef.current) {
      map.removeLayer(layerRef.current)
      layerRef.current = null
    }

    if (!enabled) return

    let stale = false

    const GridLayerClass = L.GridLayer.extend({
      _initTile(tile: HTMLElement) {
        (L.GridLayer.prototype as any)._initTile.call(this, tile)
        tile.style.imageRendering = 'pixelated'
      },
      _setZoomTransform(level: any, center: any, zoom: number) {
        (L.GridLayer.prototype as any)._setZoomTransform.call(this, level, center, zoom)
        if (level?.el) level.el.style.imageRendering = 'pixelated'
      },
      createTile(coords: L.Coords, done: L.DoneCallback) {
        // ── GIF loading path ─────────────────────────────────────────────────
        // Base-zoom tiles only (nativeZoom upscale tiles load instantly from cache).
        const isUpscale = nativeZoom !== undefined && coords.z > nativeZoom
        if (loadingGifs?.length && !isUpscale) {
          const wrap = document.createElement('div')
          wrap.style.cssText = `width:${tileSize}px;height:${tileSize}px;overflow:hidden`

          if (skip?.(coords)) {
            queueMicrotask(() => done(undefined, wrap))
            return wrap
          }

          const cacheKey = cacheKeyFn?.(coords)
          if (cacheKey && cache?.has(cacheKey)) {
            const cached = cache.get(cacheKey)!
            if (typeof cached === 'string') {
              const img = document.createElement('img')
              img.src = cached
              img.style.cssText = `position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated`
              wrap.appendChild(img)
            } else {
              const cv = document.createElement('canvas')
              cv.width = cv.height = tileSize
              cv.style.imageRendering = 'pixelated'
              cv.getContext('2d')!.putImageData(cached, 0, 0)
              wrap.appendChild(cv)
            }
            queueMicrotask(() => done(undefined, wrap))
            return wrap
          }

          // Defer done() — Leaflet populates _tiles[key] only after createTile
          // returns, so calling done() synchronously means _tileReady finds nothing
          // and the tile never becomes visible.
          queueMicrotask(() => {
            done(undefined, wrap)
            if (!wrap.isConnected || stale) return
            const centre = map.project(map.getCenter(), coords.z)
            const dx = coords.x + 0.5 - centre.x / tileSize
            const dy = coords.y + 0.5 - centre.y / tileSize
            const controller = new AbortController()
            const job = queue.enqueue(dx * dx + dy * dy, () => {
              if (!wrap.isConnected || stale) { queue.release(); return }
              // Only show animation once the job is actively running — not while queued.
              // This bounds simultaneous GIFs to queue concurrency (never the full tile count).
              const loadImg = document.createElement('img')
              loadImg.src = loadingGifs[Math.floor(Math.random() * loadingGifs.length)]
              loadImg.style.cssText = `position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated`
              wrap.replaceChildren(loadImg)
              fetch(coords, controller.signal)
                .then(result => {
                  queue.release()
                  if (stale || !wrap.isConnected || !result) return
                  if (cacheKey && cache) { cache.set(cacheKey, result); evictCache(cache, maxCacheRef.current) }
                  if (typeof result === 'string') {
                    const img = document.createElement('img')
                    img.src = result
                    img.style.cssText = `position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated`
                    wrap.replaceChildren(img)
                  } else {
                    const cv = document.createElement('canvas')
                    cv.width = cv.height = tileSize
                    cv.style.imageRendering = 'pixelated'
                    cv.getContext('2d')!.putImageData(result, 0, 0)
                    wrap.replaceChildren(cv)
                  }
                })
                .catch(() => { queue.release() })
            })
            job.abort = () => controller.abort()
            ;(wrap as any)._tileJob = job
          })

          return wrap
        }

        // ── Canvas path (original) ───────────────────────────────────────────
        const canvas = document.createElement('canvas')
        canvas.width = tileSize
        canvas.height = tileSize
        canvas.style.imageRendering = 'pixelated'
        const ctx = canvas.getContext('2d')!

        if (skip?.(coords)) {
          queueMicrotask(() => done(undefined, canvas))
          return canvas
        }

        const cacheKey = cacheKeyFn?.(coords)
        if (cacheKey && cache) {
          const cached = cache.get(cacheKey)
          if (cached && typeof cached !== 'string') {
            ctx.putImageData(cached, 0, 0)
            queueMicrotask(() => done(undefined, canvas))
            return canvas
          }
        }

        // Above native zoom: JS nearest-neighbor upscale from the native-zoom parent tile.
        // Never lets CSS touch scaling, matching the ChunkOverlayLayer approach.
        if (nativeZoom !== undefined && coords.z > nativeZoom) {
          const upscale  = 1 << (coords.z - nativeZoom)
          const parentX  = Math.floor(coords.x / upscale)
          const parentY  = Math.floor(coords.y / upscale)
          const subSize  = tileSize / upscale
          const subX     = (coords.x - parentX * upscale) * subSize
          const subY     = (coords.y - parentY * upscale) * subSize
          const parentCoords = { x: parentX, y: parentY, z: nativeZoom } as L.Coords
          const parentKey = cacheKeyFn?.(parentCoords)

          const applyScale = (parent: ImageData) => {
            if (stale || !canvas.isConnected) { done(undefined, canvas); return }
            const scaled = nearestNeighborScale(parent, upscale, subX, subY, tileSize)
            ctx.putImageData(scaled, 0, 0)
            if (cacheKey && cache) { cache.set(cacheKey, scaled); evictCache(cache, maxCacheRef.current) }
            done(undefined, canvas)
          }

          if (parentKey && cache?.has(parentKey)) {
            const parentEntry = cache.get(parentKey)!
            if (typeof parentEntry === 'string') {
              urlToImageData(parentEntry, tileSize).then(imageData => {
                if (parentKey && cache) cache.set(parentKey, imageData)
                queueMicrotask(() => applyScale(imageData))
              })
            } else {
              queueMicrotask(() => applyScale(parentEntry))
            }
            return canvas
          }

          queueMicrotask(() => {
            const centre = map.project(map.getCenter(), nativeZoom)
            const dx = parentX + 0.5 - centre.x / tileSize
            const dy = parentY + 0.5 - centre.y / tileSize
            const job = queue.enqueue(dx * dx + dy * dy, () => {
              if (!canvas.isConnected || stale) { queue.release(); done(undefined, canvas); return }
              fetch(parentCoords)
                .then(async parent => {
                  queue.release()
                  if (!parent) { done(undefined, canvas); return }
                  const imageData = typeof parent === 'string'
                    ? await urlToImageData(parent, tileSize)
                    : parent
                  if (parentKey && cache) { cache.set(parentKey, imageData); evictCache(cache, maxCacheRef.current) }
                  applyScale(imageData)
                })
                .catch(() => { queue.release(); if (!stale) done(undefined, canvas) })
            })
            ;(canvas as any)._tileJob = job
          })
          return canvas
        }

        queueMicrotask(() => {
          const centre = map.project(map.getCenter(), coords.z)
          const dx = coords.x + 0.5 - centre.x / tileSize
          const dy = coords.y + 0.5 - centre.y / tileSize
          const priority = dx * dx + dy * dy

          const controller = new AbortController()
          const job = queue.enqueue(priority, () => {
            if (!canvas.isConnected || stale) { queue.release(); done(undefined, canvas); return }

            // Tile is now actively being fetched — reveal it and start the animation.
            // The canvas is a live DOM element, so putImageData below updates it in-place
            // without needing a second done() call.
            let animating = false
            if (loadingAnimation) {
              animating = true
              loadingAnimation(ctx, tileSize, 0)
              done(undefined, canvas)
              const startTime = performance.now()
              const animate = () => {
                if (!animating) return
                loadingAnimation(ctx, tileSize, performance.now() - startTime)
                requestAnimationFrame(animate)
              }
              requestAnimationFrame(animate)
            }

            fetch(coords, controller.signal)
              .then(result => {
                animating = false
                queue.release()
                if (stale || !canvas.isConnected) { if (!loadingAnimation) done(undefined, canvas); return }
                if (!result || typeof result === 'string') { if (!loadingAnimation) done(undefined, canvas); return }
                ctx.putImageData(result, 0, 0)
                if (cacheKey && cache) {
                  cache.set(cacheKey, result)
                  evictCache(cache, maxCacheRef.current)
                }
                if (!loadingAnimation) done(undefined, canvas)
              })
              .catch(err => {
                animating = false
                queue.release()
                if (stale) { if (!loadingAnimation) done(undefined, canvas); return }
                if (!loadingAnimation) done(err as Error, canvas)
              })
          })
          job.abort = () => controller.abort()
          ;(canvas as any)._tileJob = job
        })

        return canvas
      },
    })

    const layer = new GridLayerClass({ tileSize, opacity, zIndex, ...layerOptions })

    layer.on('tileunload', (e: L.TileEvent) => {
      const job = (e.tile as any)._tileJob as TileJob | undefined
      if (job) queue.cancel(job)
    })

    layer.addTo(map)
    layerRef.current = layer

    // Only clear the shared cache when a real epoch boundary was crossed (new
    // world/seed, or an explicit force-refresh counter) — not on every dep
    // change. Dep changes not in `cacheEpochDeps` (e.g. dimension, biomeMode)
    // are assumed to already be encoded in `cacheKeyFn`, so old entries just
    // sit unread rather than colliding with new ones.
    const epoch = cacheEpochDeps ?? deps
    const prevEpoch = epochRef.current
    const epochChanged = !prevEpoch || prevEpoch.length !== epoch.length ||
      epoch.some((v, i) => v !== prevEpoch[i])
    if (epochChanged) cache?.clear()
    epochRef.current = epoch

    return () => {
      stale = true
      // Drop this layer's queued backlog and abort in-flight fetches so its jobs
      // stop feeding the backend the moment it's removed — otherwise a large
      // pending backlog keeps draining through cubiomes long after teardown.
      queue.cancelAll()
      if (layerRef.current) {
        map.removeLayer(layerRef.current)
        layerRef.current = null
      }
      onCleanup?.()
    }
  }, deps)

  return layerRef
}
