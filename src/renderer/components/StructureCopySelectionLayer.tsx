import { memo, useEffect, useRef } from 'react'
import L from 'leaflet'
import { useApp } from '../App'
import { minecraftToLeaflet } from '../lib/tileCoords'

const REGION_BLOCKS = 512
const CHUNK_BLOCKS = 16

function rect(bx0: number, bz0: number, bx1: number, bz1: number, style: L.PathOptions): L.Rectangle {
  const p0 = minecraftToLeaflet(bx0, bz0)
  const p1 = minecraftToLeaflet(bx1, bz1)
  return L.rectangle(L.latLngBounds([p0.y, p0.x], [p1.y, p1.x]), style)
}

const SOURCE_STYLE: L.PathOptions = {
  color: '#facc15', weight: 3, opacity: 0.95, dashArray: '8 5',
  fillColor: '#facc15', fillOpacity: 0.22, interactive: false,
}
// Destination preview — same idea, a cooler/cyan tone so it doesn't read as
// "also selected," just "this is where it's going."
const DEST_STYLE: L.PathOptions = {
  color: '#22d3ee', weight: 3, opacity: 0.95, dashArray: '2 4',
  fillColor: '#22d3ee', fillOpacity: 0.18, interactive: false,
}

// Prominent highlight for whatever's checked in the Structures (dev-only copy) panel,
// drawn over GeneratedRegionsLayer's plain outline squares. One L.rectangle per selected
// item, rebuilt on selection change. In chunk/box mode, once a destination is placed the
// same shape is also ghosted there (box mode swaps width/depth on a 90°/270° rotation).
// boxHoverPos comes from MapView's own mousemove listener rather than Redux state, since
// mousemove fires too often for that.
function StructureCopySelectionLayer({ map, boxHoverPos }: { map: L.Map; boxHoverPos?: [number, number] | null }) {
  const { state } = useApp()
  const groupRef = useRef<L.LayerGroup | null>(null)

  const mode = state.structureCopyMode
  const regions = state.structureCopySelectedRegions
  const chunks = state.structureCopySelectedChunks
  const destChunk = state.structureCopyDestChunk
  const boxAnchor = state.structureCopyBoxAnchor
  const boxSelection = state.structureCopyBoxSelection
  const boxDest = state.structureCopyBoxDest
  const rotation = state.structureCopyRotation

  useEffect(() => {
    if (groupRef.current) { map.removeLayer(groupRef.current); groupRef.current = null }

    const group = L.layerGroup()

    if (mode === 'region') {
      for (const [rx, rz] of regions) {
        rect(rx * REGION_BLOCKS, rz * REGION_BLOCKS, (rx + 1) * REGION_BLOCKS, (rz + 1) * REGION_BLOCKS, SOURCE_STYLE)
          .addTo(group)
      }
    } else if (mode === 'chunk') {
      for (const [cx, cz] of chunks) {
        rect(cx * CHUNK_BLOCKS, cz * CHUNK_BLOCKS, (cx + 1) * CHUNK_BLOCKS, (cz + 1) * CHUNK_BLOCKS, SOURCE_STYLE)
          .addTo(group)
      }
      if (destChunk && chunks.length > 0) {
        const minCx = Math.min(...chunks.map(([cx]) => cx))
        const minCz = Math.min(...chunks.map(([, cz]) => cz))
        const [dx, dz] = [destChunk[0] - minCx, destChunk[1] - minCz]
        for (const [cx, cz] of chunks) {
          const [ncx, ncz] = [cx + dx, cz + dz]
          rect(ncx * CHUNK_BLOCKS, ncz * CHUNK_BLOCKS, (ncx + 1) * CHUNK_BLOCKS, (ncz + 1) * CHUNK_BLOCKS, DEST_STYLE)
            .addTo(group)
        }
      }
    } else {
      // box mode
      if (boxSelection) {
        rect(boxSelection.x0, boxSelection.z0, boxSelection.x1 + 1, boxSelection.z1 + 1, SOURCE_STYLE).addTo(group)
      } else if (boxAnchor && boxHoverPos) {
        const [ax, az] = boxAnchor
        const [hx, hz] = boxHoverPos
        rect(Math.min(ax, hx), Math.min(az, hz), Math.max(ax, hx) + 1, Math.max(az, hz) + 1, SOURCE_STYLE).addTo(group)
      }
      if (boxSelection && boxDest) {
        const width = boxSelection.x1 - boxSelection.x0 + 1
        const depth = boxSelection.z1 - boxSelection.z0 + 1
        const [outWidth, outDepth] = (rotation === 90 || rotation === 270) ? [depth, width] : [width, depth]
        rect(boxDest.x, boxDest.z, boxDest.x + outWidth, boxDest.z + outDepth, DEST_STYLE).addTo(group)
      }
    }

    if (group.getLayers().length > 0) group.addTo(map)
    groupRef.current = group

    return () => {
      if (groupRef.current) { map.removeLayer(groupRef.current); groupRef.current = null }
    }
  }, [map, mode, regions, chunks, destChunk, boxAnchor, boxSelection, boxDest, rotation, boxHoverPos])

  return null
}
export default memo(StructureCopySelectionLayer)
