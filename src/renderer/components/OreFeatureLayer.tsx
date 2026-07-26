import { memo } from 'react'
import L from 'leaflet'
import { useApp } from '../App'
import { TILE_SIZE, BASE_BLOCKS_PER_PIXEL } from '../lib/constants'
import * as api from '../lib/tauriAPI'
import { TileJobQueue } from '../lib/tileJobQueue'
import { postOverlay } from '../lib/overlayWorker'
import { useTileLayer } from '../hooks/useTileLayer'
import { oreTypesFor } from '../lib/oreFeatures'
import { effectiveCaveAnchorY } from '../hooks/overlaySlice'
import * as tileStats from '../lib/tileStats'

const CHUNK_SIZE = 16
const MAX_CACHE = 256
const queue = new TileJobQueue(4, () => tileStats.notify(), 'orefeature')
const cache = new Map<string, ImageData | string>()
tileStats.registerOverlay({ key: 'orefeature', label: 'Ore features', className: 'orefeature', queues: [queue], caches: [cache] })

// Individual ore blobs (diamond, gold, …) plotted from accurate worldgen.
// High zoom only — at low zoom the blocks are sub-pixel and meaningless.
function OreFeatureLayer({ map, slot }: { map: L.Map; slot: number }) {
  const { state } = useApp()
  const seed      = state.seedData?.seed ?? null
  const selection = state.oreFeatureTypes
  // Scope to the current dimension: overworld ores in the overworld, ancient
  // debris in the nether — the slot is dimension-specific, so a mismatched ore
  // type would generate in the wrong coordinate space.
  const oreTypes  = oreTypesFor(selection, state.dimension)

  // When cave mode is on (either dimension), constrain deposits to the visible
  // depth slice — the same Y-window that drives the cave-mode tiles. Off → no
  // filter (effectiveCaveAnchorY returns null), so all deposits show as before.
  const caveAnchor = effectiveCaveAnchorY(state, state.seedData?.playerY ?? null)
  const yMin = caveAnchor != null ? caveAnchor + state.caveScanLow  : undefined
  const yMax = caveAnchor != null ? caveAnchor + state.caveScanHigh : undefined

  useTileLayer({
    map,
    queue,
    tileSize: TILE_SIZE,
    opacity: state.oreOpacity,
    zIndex: 6,
    deps: [map, slot, seed, state.dimension, selection.join(','), yMin, yMax, state.overlayCacheVersion],
    // Dimension and the Y-window are already in cacheKeyFn below, so those don't
    // need a full clear. `selection` (which ore types are checked) isn't part of
    // the key — different selections can render the same seed/dimension/coords
    // differently — so it still needs to force a clear, same as an explicit
    // force-refresh.
    cacheEpochDeps: [seed, selection.join(','), state.overlayCacheVersion],
    enabled: seed != null && slot >= 0 && oreTypes.length > 0,
    cache,
    maxCache: MAX_CACHE,
    // Dimension + cave-window in the key: ore features render in both dimensions
    // and the visible-depth filter changes what's drawn, so cached tiles must not
    // collide across dimension switches or Y-window moves.
    cacheKeyFn: (coords) => `${seed}:${state.dimension}:y${yMin}_${yMax}:${coords.x}:${coords.y}:${coords.z}`,
    skip: (coords) => BASE_BLOCKS_PER_PIXEL / Math.pow(2, coords.z) > 2,
    fetch: async (coords, signal) => {
      const t0 = performance.now()
      const blocksPerPixel = BASE_BLOCKS_PER_PIXEL / Math.pow(2, coords.z)
      const totalBlocksW = TILE_SIZE * blocksPerPixel
      const originX = coords.x * totalBlocksW
      const originZ = coords.y * totalBlocksW
      const cx0 = Math.floor(originX / CHUNK_SIZE)
      const cx1 = Math.floor((originX + totalBlocksW - 1) / CHUNK_SIZE)
      const cz0 = Math.floor(originZ / CHUNK_SIZE)
      const cz1 = Math.floor((originZ + totalBlocksW - 1) / CHUNK_SIZE)
      // Tag the (expensive) ore generation so an abandoned tile can cancel it.
      const reqId = api.newRequestId()
      signal?.addEventListener('abort', () => api.cubiomesCancelRequest(reqId), { once: true })
      const data = await api.generateOreFeatures(slot, oreTypes, cx0, cz0, cx1, cz1, reqId)
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
