import { memo } from 'react'
import L from 'leaflet'
import { useApp } from '../App'
import { TILE_SIZE, BASE_BLOCKS_PER_PIXEL } from '../lib/constants'
import * as api from '../lib/tauriAPI'
import { TileJobQueue } from '../lib/tileJobQueue'
import { postOverlay } from '../lib/overlayWorker'
import { useTileLayer } from '../hooks/useTileLayer'

const CHUNK_SIZE = 16
const queue = new TileJobQueue()

function OreVeinLayer({ map }: { map: L.Map }) {
  const { state } = useApp()
  const seed       = state.seedData?.seed ?? null
  const oreOpacity = state.oreOpacity
  const showCopper = state.showCopperVeins
  const showIron   = state.showIronVeins

  const seedBig = seed != null ? BigInt(seed) : 0n

  useTileLayer({
    map,
    queue,
    tileSize: TILE_SIZE,
    opacity: oreOpacity,
    zIndex: 5,
    deps: [map, seed, showCopper, showIron],
    enabled: seed != null,
    skip: (coords) => BASE_BLOCKS_PER_PIXEL / Math.pow(2, coords.z) > 64,
    fetch: async (coords) => {
      const blocksPerPixel = BASE_BLOCKS_PER_PIXEL / Math.pow(2, coords.z)
      const totalBlocksW = TILE_SIZE * blocksPerPixel
      const originX = coords.x * totalBlocksW
      const originZ = coords.y * totalBlocksW
      const cx0 = Math.floor(originX / CHUNK_SIZE)
      const cx1 = Math.floor((originX + totalBlocksW - 1) / CHUNK_SIZE)
      const cz0 = Math.floor(originZ / CHUNK_SIZE)
      const cz1 = Math.floor((originZ + totalBlocksW - 1) / CHUNK_SIZE)
      const qx0 = cx0 - 1, qx1 = cx1 + 1
      const qz0 = cz0 - 1, qz1 = cz1 + 1
      const qw = qx1 - qx0 + 1
      const data = await api.getOreVeinsEx(seedBig, qx0, qz0, qx1, qz1)
      const pixelsBuf = await postOverlay(
        { type: 'ore-vein', data: data.buffer, qx0, qz0, qw, cx0, cz0, originX, originZ, blocksPerPixel, doCopper: showCopper, doIron: showIron },
        [data.buffer],
      )
      if (!pixelsBuf) return null
      return new ImageData(new Uint8ClampedArray(pixelsBuf), TILE_SIZE, TILE_SIZE)
    },
  })

  return null
}
export default memo(OreVeinLayer)
