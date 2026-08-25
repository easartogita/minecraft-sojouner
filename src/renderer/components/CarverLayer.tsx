import { memo } from 'react'
import L from 'leaflet'
import { useApp } from '../App'
import { TILE_SIZE } from '../lib/constants'
import * as api from '../lib/tauriAPI'
import { createOverlayQueuePair } from '../lib/tileJobQueue'
import { postOverlay } from '../lib/overlayWorker'
import { useTileLayer } from '../hooks/useTileLayer'
import { tileChunkRange, blocksPerPixelAt } from '../lib/tileCoords'
import * as tileStats from '../lib/tileStats'

const MAX_CACHE = 256
// Static-site build: baked PNG instead of the live worldgen query.
const { liveQueue: queue, liveCache: cache, staticQueue, staticCache } =
  createOverlayQueuePair('carver', 'Carvers', 'carver')

// Cave / ravine / canyon coverage (top-down), shaded by per-column carve density.
function CarverLayer({ map, slot }: { map: L.Map; slot: number }) {
  const { state, generatorConfig } = useApp()
  const seed = state.seedData?.seed ?? null
  const version = state.selectedVersion
  const worldType = state.worldType
  const { seedBig, dimId, worldFlags, mcVersion } = generatorConfig

  useTileLayer({
    map,
    queue,
    tileSize: TILE_SIZE,
    opacity: state.carverOpacity,
    zIndex: 4,
    deps: [map, slot, seed, version, worldType, state.dimension, state.overlayCacheVersion],
    // World type (e.g. amplified) changes the carve noise router for the same seed+coords,
    // so it must wipe the cache like seed/version.
    cacheEpochDeps: [seed, version, worldType, state.overlayCacheVersion],
    enabled: seed != null && slot >= 0 && !api.IS_STATIC_SITE,
    cache,
    maxCache: MAX_CACHE,
    // Dimension is part of the key: the cache is shared across dimension switches, so
    // without it a nether tile could collide with an overworld tile at the same coords.
    cacheKeyFn: (coords) => `${seed}:${version}:${worldType}:${state.dimension}:${coords.x}:${coords.y}:${coords.z}`,
    skip: (coords) => blocksPerPixelAt(coords.z) > 16,
    fetch: async (coords, signal) => {
      const t0 = performance.now()
      const { blocksPerPixel, originX, originZ, cx0, cx1, cz0, cz1 } = tileChunkRange(coords)
      // Tag the (expensive) carve query so an abandoned tile can cancel it.
      const reqId = api.newRequestId()
      signal?.addEventListener('abort', () => api.cubiomesCancelRequest(reqId), { once: true })
      const data = await api.getCarvedColumns(slot, seedBig, dimId, worldFlags, mcVersion, cx0, cz0, cx1, cz1, reqId)
      if (signal?.aborted || data.length <= 2) return null
      const pixelsBuf = await postOverlay(
        { type: 'carver', data: data.buffer, cx0, cz0, originX, originZ, blocksPerPixel },
        [data.buffer],
      )
      if (!pixelsBuf) return null
      tileStats.overlayRender('carver', Math.round(performance.now() - t0))
      return new ImageData(new Uint8ClampedArray(pixelsBuf), TILE_SIZE, TILE_SIZE)
    },
  })

  useTileLayer({
    map,
    queue: staticQueue,
    tileSize: api.getTileSizes(state.dimension).carvers ?? TILE_SIZE,
    opacity: state.carverOpacity,
    zIndex: 4,
    deps: [map, state.dimension],
    enabled: api.IS_STATIC_SITE,
    cache: staticCache,
    maxCache: MAX_CACHE,
    cacheKeyFn: (coords) => `static:${state.dimension}:${coords.x}:${coords.y}:${coords.z}`,
    fetch: async coords => {
      const tile = await api.renderOverlayTile('carvers', state.dimension, coords.x, coords.y, coords.z)
      return tile ? `${api.tileSrc(tile.path)}?v=${tile.mtime}` : null
    },
    nativeZoom: 4, // baked only to zoom 4
  })

  return null
}
export default memo(CarverLayer)
