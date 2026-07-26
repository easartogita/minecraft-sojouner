import { memo } from 'react'
import L from 'leaflet'
import { useApp } from '../App'
import { TILE_SIZE, BASE_BLOCKS_PER_PIXEL } from '../lib/constants'
import * as api from '../lib/tauriAPI'
import { TileJobQueue } from '../lib/tileJobQueue'
import { postOverlay } from '../lib/overlayWorker'
import { useTileLayer } from '../hooks/useTileLayer'
import * as tileStats from '../lib/tileStats'

const MAX_CACHE = 256
const queue = new TileJobQueue(4, () => tileStats.notify(), 'terrain')
const cache = new Map<string, ImageData | string>()
tileStats.registerOverlay({ key: 'terrain', label: 'Terrain', className: 'terrain', queues: [queue], caches: [cache] })

// Hillshade relief from the real terrain surface heights.
function TerrainLayer({ map, slot }: { map: L.Map; slot: number }) {
  const { state } = useApp()
  const seed = state.seedData?.seed ?? null

  useTileLayer({
    map,
    queue,
    tileSize: TILE_SIZE,
    opacity: state.terrainOpacity,
    zIndex: 3,
    deps: [map, slot, seed, state.overlayCacheVersion],
    enabled: seed != null && slot >= 0,
    cache,
    maxCache: MAX_CACHE,
    cacheKeyFn: (coords) => `${seed}:${coords.x}:${coords.y}:${coords.z}`,
    skip: (coords) => BASE_BLOCKS_PER_PIXEL / Math.pow(2, coords.z) > 16,
    fetch: async (coords) => {
      const t0 = performance.now()
      const blocksPerPixel = BASE_BLOCKS_PER_PIXEL / Math.pow(2, coords.z)
      const totalBlocksW = TILE_SIZE * blocksPerPixel
      const originX = Math.floor(coords.x * totalBlocksW)
      const originZ = Math.floor(coords.y * totalBlocksW)
      // Sample a fixed-size coarse grid (+1 for forward-difference shading) regardless
      // of zoom, so the IPC payload stays bounded; stride covers the tile in blocks.
      const GRID = 64
      const stride = Math.max(1, Math.round(totalBlocksW / GRID))
      const gridW = GRID + 1
      const data = await api.getSurfaceHeights(slot, originX, originZ, gridW, gridW, stride)
      if (data.length < gridW * gridW) return null
      const pixelsBuf = await postOverlay(
        { type: 'terrain-shade', heights: data.buffer, gridW, samplesPerTile: GRID },
        [data.buffer],
      )
      if (!pixelsBuf) return null
      tileStats.overlayRender('terrain', Math.round(performance.now() - t0))
      return new ImageData(new Uint8ClampedArray(pixelsBuf), TILE_SIZE, TILE_SIZE)
    },
  })

  return null
}
export default memo(TerrainLayer)
