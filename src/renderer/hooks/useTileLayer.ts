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
  // Which deps actually invalidate `cache`'s contents (defaults to `deps`, i.e.
  // clear on any change). Pass a narrower list when `cacheKeyFn` already encodes
  // some deps (e.g. dimension) — those entries just go unread, no clear needed.
  cacheEpochDeps?: React.DependencyList
  maxCache?: number
  cacheKeyFn?: (coords: L.Coords) => string
  skip?: (coords: L.Coords) => boolean
  // `signal` aborts when the tile is scrolled out of view while the fetch is in
  // flight — heavy fetches should pass a cancel token to the backend on abort.
  fetch: (coords: L.Coords, signal?: AbortSignal) => Promise<ImageData | string | null>
  onCleanup?: () => void
  loadingAnimation?: (ctx: CanvasRenderingContext2D, size: number, elapsed: number) => void
  nativeZoom?: number      // tiles above this zoom are nearest-neighbor upscaled in JS from the native tile
}

export function nearestNeighborScale(
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

    // A straggling fetch (resolves after its canvas was swapped out, e.g. by a zoom
    // change) still needs its data on screen if the map slot it belongs to is still
    // showing. layer.redraw() used to handle this by discarding and recreating every
    // visible tile — but a zoom disconnects a whole batch of canvases at once, so
    // their fetches tend to resolve in a tight burst, and redraw() tearing down the
    // whole layer once per straggler is exactly what reads as flicker (confirmed by
    // disabling it: the same repro that flickered with it enabled loads cleanly
    // without it). Repainting just the one current tile at this coordinate — reaching
    // into GridLayer's own tile registry, the only way to reach a specific tile
    // in place — gets the data on screen without touching anything else.
    const repaintIfCurrent = (coords: L.Coords, imageData: ImageData) => {
      const key = (layer as any)._tileCoordsToKey(coords)
      const entry = (layer as any)._tiles?.[key]
      if (!entry?.current) return
      const el = entry.el as HTMLCanvasElement | undefined
      if (!el?.isConnected) return
      el.getContext('2d')?.putImageData(imageData, 0, 0)
    }

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
            const job = queue.enqueue(dx * dx + dy * dy, j => {
              if (!canvas.isConnected || stale) { queue.release(j); done(undefined, canvas); return }
              fetch(parentCoords)
                .then(async parent => {
                  queue.release(j)
                  if (!parent) { done(undefined, canvas); return }
                  const imageData = typeof parent === 'string'
                    ? await urlToImageData(parent, tileSize)
                    : parent
                  if (parentKey && cache) { cache.set(parentKey, imageData); evictCache(cache, maxCacheRef.current) }
                  applyScale(imageData)
                })
                .catch(() => { queue.release(j); if (!stale) done(undefined, canvas) })
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
          const job = queue.enqueue(priority, j => {
            if (!canvas.isConnected || stale) {
              queue.release(j); done(undefined, canvas); return
            }

            // Reveal the canvas and start the animation; putImageData below updates
            // the live DOM element in-place, no second done() call needed.
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

            // Cache writes happen even if this job's canvas has since been
            // disconnected/superseded (Leaflet swaps canvases constantly) — the
            // cache is keyed by tile identity, so a "wasted" fetch still pays off
            // for the next canvas asking for the same coordinate.
            fetch(coords, controller.signal)
              .then(result => {
                animating = false
                const connected = !stale && canvas.isConnected
                if (!result) {
                  queue.release(j)
                  if (connected) ctx.clearRect(0, 0, tileSize, tileSize)
                  if (!loadingAnimation) done(undefined, canvas)
                  return
                }
                if (typeof result === 'string') {
                  // fetch+blob+createImageBitmap, not <img>+drawImage+getImageData: asset://
                  // responses aren't CORS-cleared, so drawing into a 2D canvas taints it and
                  // getImageData throws — which would wedge the tile forever.
                  urlToImageData(result, tileSize)
                    .then(imageData => {
                      queue.release(j)
                      if (cacheKey && cache) {
                        cache.set(cacheKey, imageData)
                        evictCache(cache, maxCacheRef.current)
                      }
                      if (!connected) {
                        if (!loadingAnimation) done(undefined, canvas)
                        // Canvas is gone but the data landed in cache — repaint
                        // whatever tile currently occupies this coordinate in place.
                        // Without this a tile that resolves after its canvas is
                        // swapped stays blank.
                        repaintIfCurrent(coords, imageData)
                        return
                      }
                      ctx.putImageData(imageData, 0, 0)
                      if (!loadingAnimation) done(undefined, canvas)
                    })
                    .catch(() => {
                      queue.release(j)
                      if (connected) ctx.clearRect(0, 0, tileSize, tileSize)
                      if (!loadingAnimation) done(undefined, canvas)
                    })
                  return
                }
                queue.release(j)
                if (cacheKey && cache) {
                  cache.set(cacheKey, result)
                  evictCache(cache, maxCacheRef.current)
                }
                if (!connected) {
                  if (!loadingAnimation) done(undefined, canvas)
                  // See the matching comment in the urlToImageData branch above.
                  repaintIfCurrent(coords, result)
                  return
                }
                ctx.putImageData(result, 0, 0)
                if (!loadingAnimation) done(undefined, canvas)
              })
              .catch(err => {
                animating = false
                queue.release(j)
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

    // Only clear the shared cache on a real epoch boundary, not every dep change
    // — deps outside `cacheEpochDeps` are assumed already encoded in `cacheKeyFn`.
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
