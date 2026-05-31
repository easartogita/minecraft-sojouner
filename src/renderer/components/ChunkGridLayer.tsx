import { memo, useEffect, useRef } from 'react'
import L from 'leaflet'
import { TILE_SIZE } from '../lib/constants'
import { tileToMinecraftRect } from '../lib/tileCoords'

interface Props {
  map: L.Map
  showChunkGrid: boolean
  showRegionGrid: boolean
}

function ChunkGridLayer({ map, showChunkGrid, showRegionGrid }: Props) {
  const layerRef = useRef<L.GridLayer | null>(null)

  useEffect(() => {
    if (!map) return

    if (layerRef.current) {
      map.removeLayer(layerRef.current)
      layerRef.current = null
    }

    const GridLayer = L.GridLayer.extend({
      createTile(coords: L.Coords) {
        const canvas = document.createElement('canvas')
        canvas.width  = TILE_SIZE
        canvas.height = TILE_SIZE
        const ctx = canvas.getContext('2d')!

        const { blockX, blockZ, blocksPerPixel } = tileToMinecraftRect(coords.x, coords.y, coords.z)
        const tileWidthBlocks  = TILE_SIZE * blocksPerPixel
        const tileHeightBlocks = TILE_SIZE * blocksPerPixel

        // Chunk boundaries every 16 blocks — only draw at zoom ≥ 1 (blocksPerPixel ≤ 8)
        if (showChunkGrid && blocksPerPixel <= 8) {
          const CHUNK = 16
          const pixPerChunk = CHUNK / blocksPerPixel

          ctx.strokeStyle = 'rgba(255,255,255,0.18)'
          ctx.lineWidth = 0.5
          ctx.beginPath()

          const firstChunkX = Math.ceil(blockX / CHUNK) * CHUNK
          for (let bx = firstChunkX; bx <= blockX + tileWidthBlocks; bx += CHUNK) {
            const px = (bx - blockX) / blocksPerPixel
            ctx.moveTo(px, 0); ctx.lineTo(px, TILE_SIZE)
          }

          const firstChunkZ = Math.ceil(blockZ / CHUNK) * CHUNK
          for (let bz = firstChunkZ; bz <= blockZ + tileHeightBlocks; bz += CHUNK) {
            const py = (bz - blockZ) / blocksPerPixel
            ctx.moveTo(0, py); ctx.lineTo(TILE_SIZE, py)
          }

          ctx.stroke()
        }

        // Region boundaries every 512 blocks
        if (showRegionGrid) {
          const REGION = 512
          ctx.strokeStyle = 'rgba(255,200,100,0.45)'
          ctx.lineWidth = Math.max(1, 1.5 / blocksPerPixel)
          ctx.beginPath()

          const firstRegionX = Math.ceil(blockX / REGION) * REGION
          for (let bx = firstRegionX; bx <= blockX + tileWidthBlocks; bx += REGION) {
            const px = (bx - blockX) / blocksPerPixel
            ctx.moveTo(px, 0); ctx.lineTo(px, TILE_SIZE)
          }

          const firstRegionZ = Math.ceil(blockZ / REGION) * REGION
          for (let bz = firstRegionZ; bz <= blockZ + tileHeightBlocks; bz += REGION) {
            const py = (bz - blockZ) / blocksPerPixel
            ctx.moveTo(0, py); ctx.lineTo(TILE_SIZE, py)
          }

          ctx.stroke()
        }

        return canvas
      }
    })

    const layer = new GridLayer({ tileSize: TILE_SIZE, pane: 'overlayPane', opacity: 1 })
    layer.addTo(map)
    layerRef.current = layer

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current)
        layerRef.current = null
      }
    }
  }, [map, showChunkGrid, showRegionGrid])

  return null
}
export default memo(ChunkGridLayer)
