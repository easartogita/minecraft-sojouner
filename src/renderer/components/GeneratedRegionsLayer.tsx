import { memo, useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { useApp } from '../App'
import { TILE_SIZE, MIN_ZOOM } from '../lib/constants'
import { tileToMinecraftRect } from '../lib/tileCoords'
import * as api from '../lib/tauriAPI'

const REGION_BLOCKS = 512

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const v of a) if (!b.has(v)) return false
  return true
}

/** Paint one tile's canvas from the current region set. Clears first so the
 *  same function works both for a fresh tile and for an in-place repaint. */
function drawTile(canvas: HTMLCanvasElement, coords: L.Coords, regions: Set<string>) {
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, TILE_SIZE, TILE_SIZE)

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
}

function GeneratedRegionsLayer({ map }: { map: L.Map }) {
  const { state } = useApp()
  const [regionSet, setRegionSet] = useState<Set<string>>(new Set())
  // createTile and the in-place repaint both read the latest set from here, so
  // the Leaflet layer itself never has to be rebuilt when regions change.
  const regionsRef = useRef(regionSet)
  const layerRef = useRef<L.GridLayer | null>(null)

  // ── Fetch the region list; only commit a new Set when it actually differs, so
  //    an unchanged directory listing doesn't churn the layer at all. ──
  useEffect(() => {
    if (!state.worldDir) { setRegionSet(prev => (prev.size ? new Set() : prev)); return }
    const edition = state.seedData?.edition ?? 'java'
    api.listRegions(state.worldDir, edition, state.dimension)
      .then(list => {
        const next = new Set(list.map(([rx, rz]) => `${rx},${rz}`))
        setRegionSet(prev => (setsEqual(prev, next) ? prev : next))
      })
      .catch(() => setRegionSet(prev => (prev.size ? new Set() : prev)))
    // `changedRegions` re-lists the directory when a region is written on disk —
    // otherwise a newly-explored/created region never gets its low-zoom square
    // until the next full world reload.
  }, [state.worldDir, state.dimension, state.worldLoadCount, state.changedRegions])

  // ── Build the Leaflet layer once (per map + zoom threshold). createTile reads
  //    the region set from the ref, so this never re-runs on a region change. ──
  useEffect(() => {
    if (!map) return
    const maxZoom = state.chunkDataMinZoom - 1

    const GridLayerClass = L.GridLayer.extend({
      createTile(coords: L.Coords) {
        const canvas = document.createElement('canvas')
        canvas.width = TILE_SIZE
        canvas.height = TILE_SIZE
        drawTile(canvas, coords, regionsRef.current)
        return canvas
      },
    })

    const layer = new GridLayerClass({ tileSize: TILE_SIZE, pane: 'overlayPane', minZoom: MIN_ZOOM, maxZoom, opacity: 1 })
    layer.addTo(map)
    layerRef.current = layer

    return () => {
      if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null }
    }
  }, [map, state.chunkDataMinZoom])

  // ── Region set changed: repaint already-loaded tile canvases in place. No
  //    layer teardown, no fade-in — so the overlay updates without blinking. ──
  useEffect(() => {
    regionsRef.current = regionSet
    const layer = layerRef.current as (L.GridLayer & { _tiles?: Record<string, { el: HTMLCanvasElement; coords: L.Coords }> }) | null
    const tiles = layer?._tiles
    if (!tiles) return
    for (const key in tiles) {
      const t = tiles[key]
      if (t?.el instanceof HTMLCanvasElement && t.coords) drawTile(t.el, t.coords, regionSet)
    }
  }, [regionSet])

  return null
}

export default memo(GeneratedRegionsLayer)
