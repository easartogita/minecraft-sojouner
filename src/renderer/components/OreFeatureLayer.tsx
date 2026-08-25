import { memo } from 'react'
import L from 'leaflet'
import { useApp } from '../App'
import { TILE_SIZE } from '../lib/constants'
import * as api from '../lib/tauriAPI'
import { TileJobQueue } from '../lib/tileJobQueue'
import { postOverlay } from '../lib/overlayWorker'
import { useTileLayer } from '../hooks/useTileLayer'
import { tileChunkRange } from '../lib/tileCoords'
import { oreTypesFor } from '../lib/oreFeatures'
import { effectiveCaveAnchorY } from '../hooks/overlaySlice'
import * as tileStats from '../lib/tileStats'

const MAX_CACHE = 256
// Live-only, no static counterpart.
const queue = new TileJobQueue(4, () => tileStats.notify(), 'orefeature')
const cache = new Map<string, ImageData | string>()
tileStats.registerOverlay({
  key: 'orefeature', label: 'Ore features', className: 'orefeature',
  queues: [queue], caches: [cache],
})

// blocksPerPixelAt(z) > 2 crosses at z = 3 (16/2^3 = 2) — named here as the
// single source of truth for both the skip predicate and the flyout badge.
export const ORE_FEATURE_MIN_ZOOM = 3

// Individual ore blobs (diamond, gold, …) plotted from accurate worldgen.
// High zoom only — at low zoom the blocks are sub-pixel and meaningless.
function OreFeatureLayer({ map, slot }: { map: L.Map; slot: number }) {
  const { state, generatorConfig } = useApp()
  const seed      = state.seedData?.seed ?? null
  const version   = state.selectedVersion
  const worldType = state.worldType
  const { seedBig, dimId, worldFlags, mcVersion } = generatorConfig
  const selection = state.oreFeatureTypes
  // Scope to the current dimension (overworld ores vs. nether ancient debris) — the
  // slot is dimension-specific, so a mismatched ore type would generate in the wrong space.
  const oreTypes  = oreTypesFor(selection, state.dimension)

  // In cave mode, constrain deposits to the visible depth slice (same Y-window as the
  // cave-mode tiles); off → effectiveCaveAnchorY returns null, so no filter applies.
  const caveAnchor = effectiveCaveAnchorY(state, state.seedData?.playerY ?? null)
  const yMin = caveAnchor != null ? caveAnchor + state.caveScanLow  : undefined
  const yMax = caveAnchor != null ? caveAnchor + state.caveScanHigh : undefined

  useTileLayer({
    map,
    queue,
    tileSize: TILE_SIZE,
    opacity: state.oreOpacity,
    zIndex: 6,
    deps: [map, slot, seed, version, worldType, state.dimension, selection.join(','), yMin, yMax, state.overlayCacheVersion],
    // `selection` isn't part of cacheKeyFn (different selections render the same
    // seed/dimension/coords differently), so it must force a clear like a force-refresh.
    cacheEpochDeps: [seed, version, worldType, selection.join(','), state.overlayCacheVersion],
    enabled: seed != null && slot >= 0 && !api.IS_STATIC_SITE && oreTypes.length > 0,
    cache,
    maxCache: MAX_CACHE,
    // Dimension + cave-window in the key so cached tiles don't collide across
    // dimension switches or Y-window moves.
    cacheKeyFn: (coords) => `${seed}:${version}:${worldType}:${state.dimension}:y${yMin}_${yMax}:${coords.x}:${coords.y}:${coords.z}`,
    skip: (coords) => coords.z < ORE_FEATURE_MIN_ZOOM,
    fetch: async (coords, signal) => {
      const t0 = performance.now()
      const { blocksPerPixel, originX, originZ, cx0, cx1, cz0, cz1 } = tileChunkRange(coords)
      // Tag the (expensive) ore generation so an abandoned tile can cancel it.
      const reqId = api.newRequestId()
      signal?.addEventListener('abort', () => api.cubiomesCancelRequest(reqId), { once: true })
      const data = await api.generateOreFeatures(slot, seedBig, dimId, worldFlags, mcVersion, oreTypes, cx0, cz0, cx1, cz1, reqId)
      if (signal?.aborted || data.length < 4) return null
      const pixelsBuf = await postOverlay(
        { type: 'ore-feature', data: data.buffer, originX, originZ, blocksPerPixel, yMin, yMax },
        [data.buffer],
      )
      if (!pixelsBuf) return null
      tileStats.overlayRender('orefeature', Math.round(performance.now() - t0))
      return new ImageData(new Uint8ClampedArray(pixelsBuf), TILE_SIZE, TILE_SIZE)
    },
  })

  return null
}
export default memo(OreFeatureLayer)
