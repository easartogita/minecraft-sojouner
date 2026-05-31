import { memo, useEffect, useRef } from 'react'
import L from 'leaflet'
import { useApp } from '../App'
import { minecraftToLeaflet } from '../lib/tileCoords'
import { BASE_BLOCKS_PER_PIXEL } from '../lib/constants'

const DIM_MAP: Record<string, string> = {
  overworld:           'minecraft:overworld',
  nether:              'minecraft:the_nether',
  end:                 'minecraft:the_end',
}

function blockRadiusToLeaflet(radius: number): number {
  return radius / BASE_BLOCKS_PER_PIXEL
}

function PlayerMarker({ map }: { map: L.Map }) {
  const { state } = useApp()
  const markerRef   = useRef<L.Marker | null>(null)
  const innerCircle = useRef<L.Circle | null>(null)
  const outerCircle = useRef<L.Circle | null>(null)

  const seedData      = state.seedData
  const dimension     = state.dimension
  const showRadius    = state.showSpawnRadius

  useEffect(() => {
    // Clean up previous layers
    if (markerRef.current)   { map.removeLayer(markerRef.current);   markerRef.current   = null }
    if (innerCircle.current) { map.removeLayer(innerCircle.current); innerCircle.current = null }
    if (outerCircle.current) { map.removeLayer(outerCircle.current); outerCircle.current = null }

    if (!seedData) return

    const { playerX, playerZ, playerDimension } = seedData
    if (playerX == null || playerZ == null) return

    const playerDim  = playerDimension ?? 'minecraft:overworld'
    const viewingDim = DIM_MAP[dimension]
    const sameDimension = playerDim === viewingDim

    // Convert coordinates when viewing a different dimension
    let displayX = playerX
    let displayZ = playerZ
    if (!sameDimension) {
      if (playerDim === 'minecraft:the_nether' && viewingDim === 'minecraft:overworld') {
        displayX = playerX * 8
        displayZ = playerZ * 8
      } else if (playerDim === 'minecraft:overworld' && viewingDim === 'minecraft:the_nether') {
        displayX = Math.floor(playerX / 8)
        displayZ = Math.floor(playerZ / 8)
      } else {
        return
      }
    }

    const { x: lng, y: lat } = minecraftToLeaflet(displayX, displayZ)
    const latlng = L.latLng(lat, lng)

    // Spawn/despawn radius circles — only when player is in their actual dimension
    if (showRadius && sameDimension) {
      // 24-block no-spawn sphere (mobs never spawn within this radius)
      innerCircle.current = L.circle(latlng, {
        radius: blockRadiusToLeaflet(24),
        color: '#ff4444',
        weight: 1.5,
        opacity: 0.7,
        fillColor: '#ff4444',
        fillOpacity: 0.07,
        interactive: false,
      }).addTo(map)

      // 128-block hard despawn sphere (mobs beyond this despawn instantly)
      outerCircle.current = L.circle(latlng, {
        radius: blockRadiusToLeaflet(128),
        color: '#ffaa00',
        weight: 1.5,
        opacity: 0.5,
        fillColor: '#ffaa00',
        fillOpacity: 0.04,
        interactive: false,
      }).addTo(map)
    }

    // Player marker (drawn on top of circles)
    const markerClass = sameDimension ? 'player-marker' : 'player-marker player-marker--cross-dim'
    const icon = L.divIcon({
      className: '',
      html: `<div class="${markerClass}" title="Player (${Math.round(displayX)}, ${Math.round(displayZ)})"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    })

    const dimLabel = sameDimension ? '' : ' (projected)'
    markerRef.current = L.marker(latlng, { icon, zIndexOffset: 1000 })
    markerRef.current.bindPopup(
      `<div class="popup-content">
        <div class="popup-title">Player${dimLabel}</div>
        <div class="popup-coords">X: ${Math.round(displayX)}, Z: ${Math.round(displayZ)}</div>
        ${sameDimension ? '<div class="popup-hint">No-spawn: 24 blocks · Despawn: 128 blocks</div>' : ''}
      </div>`
    )
    markerRef.current.addTo(map)

    return () => {
      if (markerRef.current)   { map.removeLayer(markerRef.current);   markerRef.current   = null }
      if (innerCircle.current) { map.removeLayer(innerCircle.current); innerCircle.current = null }
      if (outerCircle.current) { map.removeLayer(outerCircle.current); outerCircle.current = null }
    }
  }, [map, seedData?.playerX, seedData?.playerZ, seedData?.playerDimension, dimension, showRadius])

  return null
}
export default memo(PlayerMarker)
