import { memo } from 'react'
import L from 'leaflet'
import { useApp } from '../App'
import { TILE_SIZE, BASE_BLOCKS_PER_PIXEL } from '../lib/constants'
import * as api from '../lib/tauriAPI'
import { TileJobQueue } from '../lib/tileJobQueue'
import { postOverlay } from '../lib/overlayWorker'
import { useTileLayer } from '../hooks/useTileLayer'
import * as tileStats from '../lib/tileStats'

const CHUNK_SIZE = 16
const MAX_CACHE = 256
const queue = new TileJobQueue(4, () => tileStats.notify())
const cache = new Map<string, ImageData | string>()
tileStats.registerOverlay({ key: 'carver', label: 'Carvers', className: 'carver', queues: [queue], caches: [cache] })

// Cave / ravine / canyon coverage (top-down), shaded by per-column carve density.
function CarverLayer({ map, slot }: { map: L.Map; slot: number }) {
  const { state } = useApp()
  const seed = state.seedData?.seed ?? null

  useTileLayer({
    map,
    queue,
    tileSize: TILE_SIZE,
    opacity: state.carverOpacity,
    zIndex: 4,
    deps: [map, slot, seed, state.overlayCacheVersion],
    enabled: seed != null && slot >= 0,
    cache,
    maxCache: MAX_CACHE,
    cacheKeyFn: (coords) => `${seed}:${coords.x}:${coords.y}:${coords.z}`,
    skip: (coords) => BASE_BLOCKS_PER_PIXEL / Math.pow(2, coords.z) > 16,
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
      // Tag the (expensive) carve query so an abandoned tile can cancel it.
      const reqId = api.newRequestId()
      signal?.addEventListener('abort', () => api.cubiomesCancelRequest(reqId), { once: true })
      const data = await api.getCarvedColumns(slot, cx0, cz0, cx1, cz1, reqId)
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

  return null
}
export default memo(CarverLayer)
