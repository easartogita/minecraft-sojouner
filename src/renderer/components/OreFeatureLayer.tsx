import { memo } from 'react'
import L from 'leaflet'
import { useApp } from '../App'
import { TILE_SIZE, BASE_BLOCKS_PER_PIXEL } from '../lib/constants'
import * as api from '../lib/tauriAPI'
import { TileJobQueue } from '../lib/tileJobQueue'
import { postOverlay } from '../lib/overlayWorker'
import { useTileLayer } from '../hooks/useTileLayer'
import { oreTypesFor } from '../lib/oreFeatures'
import * as tileStats from '../lib/tileStats'

const CHUNK_SIZE = 16
const MAX_CACHE = 256
const queue = new TileJobQueue(4, () => tileStats.notify())
const cache = new Map<string, ImageData | string>()
tileStats.registerOverlay({ key: 'orefeature', label: 'Ore features', className: 'orefeature', queues: [queue], caches: [cache] })

// Individual ore blobs (diamond, gold, …) plotted from accurate worldgen.
// High zoom only — at low zoom the blocks are sub-pixel and meaningless.
function OreFeatureLayer({ map, slot }: { map: L.Map; slot: number }) {
  const { state } = useApp()
  const seed      = state.seedData?.seed ?? null
  const selection = state.oreFeatureTypes
  const oreTypes  = oreTypesFor(selection)

  useTileLayer({
    map,
    queue,
    tileSize: TILE_SIZE,
    opacity: state.oreOpacity,
    zIndex: 6,
    deps: [map, slot, seed, selection.join(','), state.overlayCacheVersion],
    enabled: seed != null && slot >= 0 && oreTypes.length > 0,
    cache,
    maxCache: MAX_CACHE,
    cacheKeyFn: (coords) => `${seed}:${coords.x}:${coords.y}:${coords.z}`,
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
        { type: 'ore-feature', data: data.buffer, originX, originZ, blocksPerPixel },
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
