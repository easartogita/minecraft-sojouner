import { memo, useEffect, useRef } from 'react'
import L from 'leaflet'
import { useApp } from '../App'
import { minecraftToLeaflet } from '../lib/tileCoords'
import { BASE_BLOCKS_PER_PIXEL } from '../lib/constants'

const DIM_MAP: Record<string, string> = {
  overworld: 'minecraft:overworld',
  nether:    'minecraft:the_nether',
  end:       'minecraft:the_end',
}

// Ring color + matching glow per player slot (host is always index 0).
const PLAYER_COLORS = [
  { ring: '#e74c3c', glow: 'rgba(231,76,60,0.4)'  },  // red    — host
  { ring: '#f39c12', glow: 'rgba(243,156,18,0.4)' },  // orange
  { ring: '#2ecc71', glow: 'rgba(46,204,113,0.4)' },  // green
  { ring: '#3498db', glow: 'rgba(52,152,219,0.4)' },  // blue
  { ring: '#9b59b6', glow: 'rgba(155,89,182,0.4)' },  // purple
  { ring: '#1abc9c', glow: 'rgba(26,188,156,0.4)' },  // teal
  { ring: '#e91e63', glow: 'rgba(233,30,99,0.4)'  },  // pink
  { ring: '#cddc39', glow: 'rgba(205,220,57,0.4)' },  // lime
]

function colorFor(index: number) {
  return PLAYER_COLORS[index % PLAYER_COLORS.length]
}

function blockRadiusToLeaflet(radius: number): number {
  return radius / BASE_BLOCKS_PER_PIXEL
}

function PlayerMarker({ map }: { map: L.Map }) {
  const { state } = useApp()
  const layersRef = useRef<L.Layer[]>([])

  const seedData   = state.seedData
  const dimension  = state.dimension
  const showRadius = state.showSpawnRadius

  useEffect(() => {
    layersRef.current.forEach(l => map.removeLayer(l))
    layersRef.current = []

    if (!seedData) return

    const players = seedData.players ?? []
    const viewingDim = DIM_MAP[dimension]

    players.forEach((player, idx) => {
      const playerDim = player.dimension
      const sameDimension = playerDim === viewingDim

      let displayX = player.x
      let displayZ = player.z

      if (!sameDimension) {
        if (playerDim === 'minecraft:the_nether' && viewingDim === 'minecraft:overworld') {
          displayX = player.x * 8
          displayZ = player.z * 8
        } else if (playerDim === 'minecraft:overworld' && viewingDim === 'minecraft:the_nether') {
          displayX = Math.floor(player.x / 8)
          displayZ = Math.floor(player.z / 8)
        } else {
          return
        }
      }

      const { x: lng, y: lat } = minecraftToLeaflet(displayX, displayZ)
      const latlng = L.latLng(lat, lng)
      const { ring, glow } = colorFor(idx)

      if (showRadius && sameDimension) {
        const inner = L.circle(latlng, {
          radius: blockRadiusToLeaflet(24),
          color: ring, weight: 1.5, opacity: 0.7,
          fillColor: ring, fillOpacity: 0.07, interactive: false,
        }).addTo(map)
        const outer = L.circle(latlng, {
          radius: blockRadiusToLeaflet(128),
          color: ring, weight: 1.5, opacity: 0.5,
          fillColor: ring, fillOpacity: 0.04, interactive: false,
        }).addTo(map)
        layersRef.current.push(inner, outer)
      }

      const label = player.name || player.uuid.slice(0, 8)
      const dimSuffix = sameDimension ? '' : ' (projected)'
      const markerClass = sameDimension ? 'player-marker' : 'player-marker player-marker--cross-dim'
      const icon = L.divIcon({
        className: '',
        html: `<div class="${markerClass}" style="border-color:${ring};box-shadow:0 0 0 2px ${glow},0 1px 4px rgba(0,0,0,0.6)" title="${label}${dimSuffix}">
          <div class="player-marker__label" style="color:${ring}">${label}</div>
        </div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      })

      const marker = L.marker(latlng, { icon, zIndexOffset: 1000 - idx })
      marker.bindPopup(
        `<div class="popup-content">
          <div class="popup-title" style="color:${ring}">${label}${dimSuffix}</div>
          <div class="popup-coords">X: ${Math.round(displayX)}, Z: ${Math.round(displayZ)}</div>
          ${sameDimension ? '<div class="popup-hint">No-spawn: 24 blocks · Despawn: 128 blocks</div>' : ''}
        </div>`
      )
      marker.addTo(map)
      layersRef.current.push(marker)
    })

    return () => {
      layersRef.current.forEach(l => map.removeLayer(l))
      layersRef.current = []
    }
  }, [map, seedData, dimension, showRadius])

  return null
}

export default memo(PlayerMarker)
