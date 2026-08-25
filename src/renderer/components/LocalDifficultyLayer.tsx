import { memo } from 'react'
import L from 'leaflet'
import { useApp } from '../App'
import { TILE_SIZE } from '../lib/constants'
import * as api from '../lib/tauriAPI'

import { createOverlayQueuePair } from '../lib/tileJobQueue'
import { postOverlay } from '../lib/overlayWorker'
import { useTileLayer } from '../hooks/useTileLayer'
import { tileChunkRange, blocksPerPixelAt } from '../lib/tileCoords'

// liveCache: false — this layer's live path intentionally never caches tiles.
const { liveQueue: queue, staticQueue, staticCache } =
  createOverlayQueuePair('localdifficulty', 'Local difficulty', 'localdifficulty', { liveCache: false })

function difficultyColor(t: number): [number, number, number] {
  if (t <= 0.5) {
    const u = t * 2
    return [Math.round(40 + 180 * u), Math.round(180 + 20 * u), 40]
  }
  const u = (t - 0.5) * 2
  return [220, Math.round(200 - 160 * u), 40]
}

function LocalDifficultyLayer({ map }: { map: L.Map }) {
  const { state } = useApp()

  const worldDir   = state.worldDir!
  const dimension  = state.dimension
  const difficulty = state.seedData?.difficulty ?? 2
  const worldTime  = state.seedData?.worldTime ?? 0

  useTileLayer({
    map,
    queue,
    tileSize: TILE_SIZE,
    zIndex: 5,
    deps: [map, worldDir, dimension, difficulty, worldTime],
    enabled: !api.IS_STATIC_SITE,
    skip: (coords) => blocksPerPixelAt(coords.z) > 128,
    fetch: async (coords) => {
      const { blocksPerPixel, originX, originZ, cx0, cx1, cz0, cz1 } = tileChunkRange(coords)
      const width = cx1 - cx0 + 1

      const data = await api.getLocalDifficulties(worldDir, dimension, cx0, cz0, cx1, cz1, difficulty, worldTime)

      const chunkCount = width * (cz1 - cz0 + 1)
      const chunkColor = new Uint8Array(chunkCount * 3)
      const chunkAlpha = new Uint8Array(chunkCount)
      const chunkValid = new Uint8Array(chunkCount)

      for (let cz = cz0; cz <= cz1; cz++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const ci = (cz - cz0) * width + (cx - cx0)
          const special = data[ci]
          if (special < 0) continue
          const [r, g, b] = difficultyColor(special)
          chunkColor[ci * 3    ] = r
          chunkColor[ci * 3 + 1] = g
          chunkColor[ci * 3 + 2] = b
          chunkAlpha[ci] = special === 0 ? 80 : 180
          chunkValid[ci] = 1
        }
      }

      const pixelsBuf = await postOverlay(
        { type: 'local-difficulty',
          chunkColor: chunkColor.buffer, chunkAlpha: chunkAlpha.buffer, chunkValid: chunkValid.buffer,
          cx0, cz0, width, originX, originZ, blocksPerPixel },
        [chunkColor.buffer, chunkAlpha.buffer, chunkValid.buffer],
      )
      if (!pixelsBuf) return null
      return new ImageData(new Uint8ClampedArray(pixelsBuf), TILE_SIZE, TILE_SIZE)
    },
  })

  useTileLayer({
    map,
    queue: staticQueue,
    tileSize: api.getTileSizes(dimension).localDifficulty ?? TILE_SIZE,
    zIndex: 5,
    deps: [map, dimension],
    enabled: api.IS_STATIC_SITE,
    cache: staticCache,
    maxCache: 256,
    cacheKeyFn: (coords) => `static:${dimension}:${coords.x}:${coords.y}:${coords.z}`,
    fetch: async coords => {
      const tile = await api.renderOverlayTile('localDifficulty', dimension, coords.x, coords.y, coords.z)
      return tile ? `${api.tileSrc(tile.path)}?v=${tile.mtime}` : null
    },
    nativeZoom: 4, // baked only to zoom 4
  })

  return null
}
export default memo(LocalDifficultyLayer)
