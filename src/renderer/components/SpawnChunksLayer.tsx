import { memo, useEffect, useRef } from 'react'
import L from 'leaflet'
import { useApp } from '../App'
import { minecraftToLeaflet } from '../lib/tileCoords'

// Vanilla default when the world doesn't set the gamerule (or it's absent).
const DEFAULT_SPAWN_CHUNK_RADIUS = 2

/**
 * The always-loaded "spawn chunks" region: a (2r+1)×(2r+1) square of chunks
 * around the world-spawn chunk, where r = the `spawnChunkRadius` gamerule
 * (read from level.dat; falls back to the vanilla default). Chunk-aligned by
 * construction, so it renders as a rectangle on chunk boundaries.
 */
function SpawnChunksLayer({ map }: { map: L.Map }) {
  const { state } = useApp()
  const layerRef = useRef<L.Rectangle | null>(null)

  const worldDir = state.worldDir
  const dimension = state.dimension
  const spawnX = state.seedData?.spawnX ?? null
  const spawnZ = state.seedData?.spawnZ ?? null
  const radius = state.seedData?.spawnChunkRadius ?? DEFAULT_SPAWN_CHUNK_RADIUS

  useEffect(() => {
    if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null }

    // Spawn chunks are an overworld concept, and only meaningful with a real world.
    if (!worldDir || dimension !== 'overworld' || spawnX == null || spawnZ == null) return
    const r = Math.max(0, radius)

    // Chunk containing world spawn → extend r chunks in each direction.
    const cx = Math.floor(spawnX / 16)
    const cz = Math.floor(spawnZ / 16)
    const bx0 = (cx - r) * 16
    const bz0 = (cz - r) * 16
    const bx1 = (cx + r + 1) * 16   // +1 chunk: right/bottom edge is exclusive
    const bz1 = (cz + r + 1) * 16

    const p0 = minecraftToLeaflet(bx0, bz0)
    const p1 = minecraftToLeaflet(bx1, bz1)
    const bounds = L.latLngBounds([p0.y, p0.x], [p1.y, p1.x])

    const side = 2 * r + 1
    const rect = L.rectangle(bounds, {
      color: '#22d3ee', weight: 1.5, opacity: 0.8, dashArray: '4 3',
      fillColor: '#22d3ee', fillOpacity: 0.05, interactive: true,
    })
    rect.bindTooltip(
      `Spawn chunks · ${side}×${side} (radius ${r})`,
      { sticky: true, direction: 'top' },
    )
    rect.addTo(map)
    layerRef.current = rect

    return () => {
      if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null }
    }
  }, [map, worldDir, dimension, spawnX, spawnZ, radius])

  return null
}
export default memo(SpawnChunksLayer)
