import { memo, useEffect, useRef } from 'react'
import L from 'leaflet'
import { useApp } from '../App'
import { minecraftToLeaflet } from '../lib/tileCoords'

// Vanilla's default when a world has never had its border touched — not a
// real boundary, so there's nothing useful to draw.
const VANILLA_DEFAULT_BORDER_SIZE = 60_000_000

/**
 * The world border: a square centered on (borderCenterX, borderCenterZ) with
 * side length borderSize, read from level.dat. Applies in both Overworld and
 * Nether (the border is enforced in each dimension's own block coordinates,
 * unscaled by the 1:8 Nether ratio); the End has no border.
 */
function WorldBorderLayer({ map }: { map: L.Map }) {
  const { state } = useApp()
  const layerRef = useRef<L.Rectangle | null>(null)

  const worldDir = state.worldDir
  const dimension = state.dimension
  const centerX = state.seedData?.borderCenterX ?? null
  const centerZ = state.seedData?.borderCenterZ ?? null
  const size = state.seedData?.borderSize ?? VANILLA_DEFAULT_BORDER_SIZE

  useEffect(() => {
    if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null }

    if (!worldDir || dimension === 'end' || centerX == null || centerZ == null) return
    // Never set (or set back to the vanilla default) — nothing meaningful to draw.
    if (size >= VANILLA_DEFAULT_BORDER_SIZE) return

    const half = size / 2
    const p0 = minecraftToLeaflet(centerX - half, centerZ - half)
    const p1 = minecraftToLeaflet(centerX + half, centerZ + half)
    const bounds = L.latLngBounds([p0.y, p0.x], [p1.y, p1.x])

    const rect = L.rectangle(bounds, {
      color: '#f87171', weight: 2, opacity: 0.85, dashArray: '6 4',
      fillColor: '#f87171', fillOpacity: 0.03, interactive: true,
    })
    rect.bindTooltip(
      `World border · ${Math.round(size).toLocaleString()} blocks wide, centered ${Math.round(centerX)}, ${Math.round(centerZ)}`,
      { sticky: true, direction: 'top' },
    )
    rect.addTo(map)
    layerRef.current = rect

    return () => {
      if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null }
    }
  }, [map, worldDir, dimension, centerX, centerZ, size])

  return null
}
export default memo(WorldBorderLayer)
