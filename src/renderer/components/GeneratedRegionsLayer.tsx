import { memo, useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { useApp } from '../App'
import { TILE_SIZE, MIN_ZOOM } from '../lib/constants'
import { tileToMinecraftRect } from '../lib/tileCoords'
import * as api from '../lib/tauriAPI'

const REGION_BLOCKS = 512

function GeneratedRegionsLayer({ map }: { map: L.Map }) {
  const { state } = useApp()
  const [regionSet, setRegionSet] = useState<Set<string>>(new Set())
  const layerRef = useRef<L.GridLayer | null>(null)

  useEffect(() => {
    if (!state.worldDir) { setRegionSet(new Set()); return }
    const edition = state.seedData?.edition ?? 'java'
    api.listRegions(state.worldDir, edition, state.dimension)
      .then(list => setRegionSet(new Set(list.map(([rx, rz]) => `${rx},${rz}`))))
      .catch(() => setRegionSet(new Set()))
  }, [state.worldDir, state.dimension, state.worldLoadCount])

  useEffect(() => {
    if (!map) return
    if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null }
    if (regionSet.size === 0) return

    const regions = regionSet
    const maxZoom = state.chunkDataMinZoom - 1

    const GridLayerClass = L.GridLayer.extend({
      createTile(coords: L.Coords) {
        const canvas = document.createElement('canvas')
        canvas.width = TILE_SIZE
        canvas.height = TILE_SIZE

        const ctx = canvas.getContext('2d')!
        const { blockX, blockZ, blocksPerPixel } = tileToMinecraftRect(coords.x, coords.y, coords.z)
        const tileW = TILE_SIZE * blocksPerPixel
        const tileH = TILE_SIZE * blocksPerPixel

        const rxMin = Math.floor(blockX / REGION_BLOCKS)
        const rxMax = Math.floor((blockX + tileW - 1) / REGION_BLOCKS)
        const rzMin = Math.floor(blockZ / REGION_BLOCKS)
        const rzMax = Math.floor((blockZ + tileH - 1) / REGION_BLOCKS)

        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)'
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'
        ctx.lineWidth = 1

        for (let rx = rxMin; rx <= rxMax; rx++) {
          for (let rz = rzMin; rz <= rzMax; rz++) {
            if (!regions.has(`${rx},${rz}`)) continue

            const px0 = (Math.max(rx * REGION_BLOCKS, blockX) - blockX) / blocksPerPixel
            const py0 = (Math.max(rz * REGION_BLOCKS, blockZ) - blockZ) / blocksPerPixel
            const px1 = (Math.min((rx + 1) * REGION_BLOCKS, blockX + tileW) - blockX) / blocksPerPixel
            const py1 = (Math.min((rz + 1) * REGION_BLOCKS, blockZ + tileH) - blockZ) / blocksPerPixel
            const w = px1 - px0
            const h = py1 - py0
            if (w <= 0 || h <= 0) continue

            ctx.fillRect(px0, py0, w, h)
            if (w > 4 && h > 4)
              ctx.strokeRect(px0 + 2, py0 + 2, w - 4, h - 4)
          }
        }
        return canvas
      },
    })

    const layer = new GridLayerClass({ tileSize: TILE_SIZE, pane: 'overlayPane', minZoom: MIN_ZOOM, maxZoom, opacity: 1 })
    layer.addTo(map)
    layerRef.current = layer

    return () => {
      if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null }
    }
  }, [map, regionSet, state.chunkDataMinZoom])

  return null
}

export default memo(GeneratedRegionsLayer)
