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
const queue = new TileJobQueue(4, () => tileStats.notify(), 'cave-entrance')
tileStats.registerOverlay({ key: 'caveentrance', label: 'Cave entrances', className: 'caveentrance', queues: [queue], caches: [] })

function CaveEntranceLayer({ map }: { map: L.Map }) {
  const { state } = useApp()
  const worldDir  = state.worldDir!
  const dimension = state.dimension
  const opacity   = state.caveEntranceOpacity

  useTileLayer({
    map,
    queue,
    tileSize: TILE_SIZE,
    opacity,
    zIndex: 5,
    deps: [map, worldDir, dimension],
    skip: (coords) => BASE_BLOCKS_PER_PIXEL / Math.pow(2, coords.z) > 32,
    fetch: async (coords) => {
      const blocksPerPixel = BASE_BLOCKS_PER_PIXEL / Math.pow(2, coords.z)
      const totalBlocksW = TILE_SIZE * blocksPerPixel
      const originX = coords.x * totalBlocksW
      const originZ = coords.y * totalBlocksW
      const cx0 = Math.floor(originX / CHUNK_SIZE)
      const cx1 = Math.floor((originX + totalBlocksW - 1) / CHUNK_SIZE)
      const cz0 = Math.floor(originZ / CHUNK_SIZE)
      const cz1 = Math.floor((originZ + totalBlocksW - 1) / CHUNK_SIZE)
      const width = cx1 - cx0 + 1
      const data = await api.getCaveEntrances(worldDir, dimension, cx0, cz0, cx1, cz1)
      const pixelsBuf = await postOverlay(
        { type: 'cave-entrance', data: data.buffer, cx0, cz0, width, originX, originZ, blocksPerPixel },
        [data.buffer],
      )
      if (!pixelsBuf) return null
      return new ImageData(new Uint8ClampedArray(pixelsBuf), TILE_SIZE, TILE_SIZE)
    },
  })

  return null
}
export default memo(CaveEntranceLayer)
