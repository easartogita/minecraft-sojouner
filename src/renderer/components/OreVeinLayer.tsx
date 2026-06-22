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

// Footprint mode is per-block accurate but costly, so it only renders once blocks
// aren't sub-pixel: at/under this resolution (blocks-per-pixel), matching the
// carver/terrain overlays. Coarser than this it just speckles, and the user should
// pick Density instead. bpp = BASE_BLOCKS_PER_PIXEL / 2^zoom.
const FOOTPRINT_MAX_BPP = 16

// Density (cheap per-chunk veininess) and Footprint (real per-column 3-D blobs) are
// two GridLayers, but only one is ever enabled at a time — the user picks via
// state.oreVeinMode. Keeping them separate means each gets its own cache/queue and
// switching modes cleanly tears one down and builds the other (no compositing of
// the semi-transparent tiles, which a single branch-per-tile layer would suffer).
const blobQueue      = new TileJobQueue(4, () => tileStats.notify())
const footprintQueue = new TileJobQueue(4, () => tileStats.notify())
const blobCache      = new Map<string, ImageData | string>()
const footprintCache = new Map<string, ImageData | string>()
tileStats.registerOverlay({
  key: 'orevein', label: 'Ore veins', className: 'orevein',
  queues: [blobQueue, footprintQueue], caches: [blobCache, footprintCache],
})

function tileChunkRange(coords: L.Coords) {
  const blocksPerPixel = BASE_BLOCKS_PER_PIXEL / Math.pow(2, coords.z)
  const totalBlocksW = TILE_SIZE * blocksPerPixel
  const originX = coords.x * totalBlocksW
  const originZ = coords.y * totalBlocksW
  return {
    blocksPerPixel, originX, originZ,
    cx0: Math.floor(originX / CHUNK_SIZE),
    cx1: Math.floor((originX + totalBlocksW - 1) / CHUNK_SIZE),
    cz0: Math.floor(originZ / CHUNK_SIZE),
    cz1: Math.floor((originZ + totalBlocksW - 1) / CHUNK_SIZE),
  }
}

function OreVeinLayer({ map, slot }: { map: L.Map; slot: number }) {
  const { state } = useApp()
  const seed       = state.seedData?.seed ?? null
  const oreOpacity = state.oreOpacity
  const showCopper = state.showCopperVeins
  const showIron   = state.showIronVeins
  const mode       = state.oreVeinMode

  const seedBig = seed != null ? BigInt(seed) : 0n
  const enabled = seed != null && slot >= 0

  // Density: cheap per-chunk veininess heatmap (works at every zoom).
  useTileLayer({
    map,
    queue: blobQueue,
    tileSize: TILE_SIZE,
    opacity: oreOpacity,
    zIndex: 5,
    deps: [map, slot, seed, showCopper, showIron, mode, state.overlayCacheVersion],
    enabled: enabled && mode === 'density',
    cache: blobCache,
    maxCache: MAX_CACHE,
    cacheKeyFn: (coords) => `${seed}:${coords.x}:${coords.y}:${coords.z}`,
    skip: (coords) => BASE_BLOCKS_PER_PIXEL / Math.pow(2, coords.z) > 64,
    fetch: async (coords) => {
      const t0 = performance.now()
      const { blocksPerPixel, originX, originZ, cx0, cx1, cz0, cz1 } = tileChunkRange(coords)
      const qx0 = cx0 - 1, qx1 = cx1 + 1
      const qz0 = cz0 - 1, qz1 = cz1 + 1
      const qw = qx1 - qx0 + 1
      const data = await api.getOreVeinsEx(seedBig, qx0, qz0, qx1, qz1)
      const pixelsBuf = await postOverlay(
        { type: 'ore-vein', data: data.buffer, qx0, qz0, qw, cx0, cz0, originX, originZ, blocksPerPixel, doCopper: showCopper, doIron: showIron },
        [data.buffer],
      )
      if (!pixelsBuf) return null
      tileStats.overlayRender('orevein', Math.round(performance.now() - t0))
      return new ImageData(new Uint8ClampedArray(pixelsBuf), TILE_SIZE, TILE_SIZE)
    },
  })

  // Footprint: real per-column vein footprint, rendered like carved caves.
  useTileLayer({
    map,
    queue: footprintQueue,
    tileSize: TILE_SIZE,
    opacity: oreOpacity,
    zIndex: 5,
    deps: [map, slot, seed, showCopper, showIron, mode, state.overlayCacheVersion],
    enabled: enabled && mode === 'footprint',
    cache: footprintCache,
    maxCache: MAX_CACHE,
    cacheKeyFn: (coords) => `${seed}:${coords.x}:${coords.y}:${coords.z}`,
    skip: (coords) => BASE_BLOCKS_PER_PIXEL / Math.pow(2, coords.z) > FOOTPRINT_MAX_BPP,
    fetch: async (coords, signal) => {
      const t0 = performance.now()
      const { blocksPerPixel, originX, originZ, cx0, cx1, cz0, cz1 } = tileChunkRange(coords)
      // Expensive path — tag it so it can be cancelled if the tile scrolls out of
      // view before the backend finishes.
      const reqId = api.newRequestId()
      signal?.addEventListener('abort', () => api.cubiomesCancelRequest(reqId), { once: true })
      const data = await api.getOreVeinColumns(slot, cx0, cz0, cx1, cz1, reqId)
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

  return null
}
export default memo(OreVeinLayer)
