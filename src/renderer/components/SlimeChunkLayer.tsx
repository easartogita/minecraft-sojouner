import { memo, useEffect, useRef } from 'react'
import L from 'leaflet'
import { useApp } from '../App'
import { TILE_SIZE, BASE_BLOCKS_PER_PIXEL } from '../lib/constants'
import * as api from '../lib/tauriAPI'

const CHUNK_SIZE = 16

function SlimeChunkLayer({ map }: { map: L.Map }) {
  const { state } = useApp()
  const layerRef = useRef<L.GridLayer | null>(null)
  const seed         = state.seedData?.seed ?? null
  const slimeOpacity = state.slimeOpacity

  useEffect(() => {
    layerRef.current?.setOpacity(slimeOpacity)
  }, [slimeOpacity])

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current)
      layerRef.current = null
    }

    if (!seed) return

    const worldSeed = BigInt(seed)

    const SlimeLayer = L.GridLayer.extend({
      createTile(coords: L.Coords, done: (err: Error | null, tile: HTMLElement) => void) {
        const canvas = document.createElement('canvas')
        canvas.width  = TILE_SIZE
        canvas.height = TILE_SIZE
        const ctx = canvas.getContext('2d')!

        const zoom = coords.z
        const blocksPerPixel = BASE_BLOCKS_PER_PIXEL / Math.pow(2, zoom)
        const totalBlocksW = TILE_SIZE * blocksPerPixel

        if (blocksPerPixel > 64) { done(null, canvas); return canvas }

        const originX = coords.x * totalBlocksW
        const originZ = coords.y * totalBlocksW
        const cx0 = Math.floor(originX / CHUNK_SIZE)
        const cx1 = Math.ceil((originX + totalBlocksW) / CHUNK_SIZE) - 1
        const cz0 = Math.floor(originZ / CHUNK_SIZE)
        const cz1 = Math.ceil((originZ + totalBlocksW) / CHUNK_SIZE) - 1
        const width = cx1 - cx0 + 1

        api.getSlimeChunks(worldSeed, cx0, cz0, cx1, cz1).then(slime => {
          ctx.fillStyle = 'rgba(0, 220, 0, 0.35)'
          for (let cz = cz0; cz <= cz1; cz++) {
            for (let cx = cx0; cx <= cx1; cx++) {
              if (!slime[(cz - cz0) * width + (cx - cx0)]) continue
              const px = (cx * CHUNK_SIZE - originX) / blocksPerPixel
              const py = (cz * CHUNK_SIZE - originZ) / blocksPerPixel
              const size = CHUNK_SIZE / blocksPerPixel
              ctx.fillRect(px, py, size, size)
            }
          }
          done(null, canvas)
        }).catch(() => done(null, canvas))

        return canvas
      }
    })

    const layer = new SlimeLayer({ tileSize: TILE_SIZE, opacity: slimeOpacity, zIndex: 4 })
    layer.addTo(map)
    layerRef.current = layer

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current)
        layerRef.current = null
      }
    }
  }, [map, seed])

  return null
}
export default memo(SlimeChunkLayer)
