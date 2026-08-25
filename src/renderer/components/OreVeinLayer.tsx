import { memo } from 'react'
import L from 'leaflet'
import { useApp } from '../App'
import { TILE_SIZE, MC_VERSIONS } from '../lib/constants'
import * as api from '../lib/tauriAPI'
import { createOverlayQueuePair } from '../lib/tileJobQueue'
import { postOverlay } from '../lib/overlayWorker'
import { useTileLayer } from '../hooks/useTileLayer'
import { tileChunkRange } from '../lib/tileCoords'
import * as tileStats from '../lib/tileStats'

const MAX_CACHE = 256

// Per-block accurate but costly — real per-column generation over every chunk in
// view, not a cheap noise sample. No cheap low-zoom fallback exists, so it needs
// its own floor to stop panning out from firing a huge per-column chunk range.
export const FOOTPRINT_MIN_ZOOM = 5

// Static-site build combines copper+iron into one baked image at export time,
// so the copper/iron toggles have no effect there.
const {
  liveQueue: footprintQueue, liveCache: footprintCache,
  staticQueue, staticCache,
} = createOverlayQueuePair('orevein', 'Ore veins', 'orevein')

function OreVeinLayer({ map, slot }: { map: L.Map; slot: number }) {
  const { state, generatorConfig } = useApp()
  const seed       = state.seedData?.seed ?? null
  const oreOpacity = state.oreOpacity
  const showCopper = state.showCopperVeins
  const showIron   = state.showIronVeins

  const { seedBig, dimId, worldFlags, mcVersion } = generatorConfig
  // Ore veins are a 1.18+ generation feature (initOreVeinNoise returns nothing
  // below it) — suppress the whole layer for older versions rather than let it
  // sit on screen quietly rendering empty.
  const enabled = seed != null && slot >= 0 && mcVersion >= MC_VERSIONS['MC_1_18']

  // Real per-column vein footprint, rendered like carved caves.
  useTileLayer({
    map,
    queue: footprintQueue,
    tileSize: TILE_SIZE,
    opacity: oreOpacity,
    zIndex: 5,
    deps: [map, slot, seed, mcVersion, showCopper, showIron, state.overlayCacheVersion],
    enabled: enabled && !api.IS_STATIC_SITE,
    cache: footprintCache,
    maxCache: MAX_CACHE,
    cacheKeyFn: (coords) => `${seed}:${coords.x}:${coords.y}:${coords.z}`,
    skip: (coords) => coords.z < FOOTPRINT_MIN_ZOOM,
    fetch: async (coords, signal) => {
      const t0 = performance.now()
      const { blocksPerPixel, originX, originZ, cx0, cx1, cz0, cz1 } = tileChunkRange(coords)
      // Expensive path — tag it so it can be cancelled if the tile scrolls out of
      // view before the backend finishes.
      const reqId = api.newRequestId()
      signal?.addEventListener('abort', () => api.cubiomesCancelRequest(reqId), { once: true })
      const data = await api.getOreVeinColumns(slot, seedBig, dimId, worldFlags, mcVersion, cx0, cz0, cx1, cz1, reqId)
      if (signal?.aborted || data.length <= 2) return null
      const pixelsBuf = await postOverlay(
        { type: 'ore-vein-columns', data: data.buffer, cx0, cz0, originX, originZ, blocksPerPixel, doCopper: showCopper, doIron: showIron },
        [data.buffer],
      )
      if (!pixelsBuf) return null
      tileStats.overlayRender('orevein', Math.round(performance.now() - t0))
      return new ImageData(new Uint8ClampedArray(pixelsBuf), TILE_SIZE, TILE_SIZE)
    },
  })

  // Static-site build: baked layer.
  useTileLayer({
    map,
    queue: staticQueue,
    tileSize: api.getTileSizes(state.dimension).oreVeins ?? TILE_SIZE,
    opacity: oreOpacity,
    zIndex: 5,
    deps: [map, state.dimension],
    enabled: api.IS_STATIC_SITE && (showCopper || showIron),
    cache: staticCache,
    maxCache: MAX_CACHE,
    cacheKeyFn: (coords) => `static:${state.dimension}:${coords.x}:${coords.y}:${coords.z}`,
    fetch: async coords => {
      const tile = await api.renderOverlayTile('oreVeins', state.dimension, coords.x, coords.y, coords.z)
      return tile ? `${api.tileSrc(tile.path)}?v=${tile.mtime}` : null
    },
    nativeZoom: 4, // baked only to zoom 4
  })

  return null
}
export default memo(OreVeinLayer)
