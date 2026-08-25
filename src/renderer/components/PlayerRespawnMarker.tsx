import { memo, useEffect, useRef } from 'react'
import L from 'leaflet'
import { useApp } from '../App'
import { minecraftToLeaflet } from '../lib/tileCoords'

const DIM_MAP: Record<string, string> = {
  overworld: 'minecraft:overworld',
  nether:    'minecraft:the_nether',
  end:       'minecraft:the_end',
}

// Player.SpawnX/Y/Z — distinct from world spawn, absent until that player has slept
// in a bed or set a respawn anchor.
function PlayerRespawnMarker({ map }: { map: L.Map }) {
  const { state } = useApp()
  const markersRef = useRef<L.Marker[]>([])

  const players = state.seedData?.players ?? []
  const dimension = state.dimension

  useEffect(() => {
    for (const m of markersRef.current) map.removeLayer(m)
    markersRef.current = []

    const viewingDim = DIM_MAP[dimension]
    for (const p of players) {
      if (p.respawnX == null || p.respawnY == null || p.respawnZ == null) continue
      if ((p.respawnDimension ?? 'minecraft:overworld') !== viewingDim) continue

      const { x: lng, y: lat } = minecraftToLeaflet(p.respawnX, p.respawnZ)
      const label = p.name ? `${p.name}'s Respawn` : 'Respawn Point'

      const icon = L.divIcon({
        className: '',
        html: `<div class="structure-marker" style="background:#c0392b" title="${label}">
          <svg viewBox="0 0 20 20" width="13" height="13" style="display:block" overflow="visible">
            <rect x="2" y="10" width="16" height="6" rx="1" fill="white"/>
            <rect x="2" y="7" width="6" height="4" rx="1" fill="white" opacity="0.7"/>
            <rect x="2" y="14.5" width="2" height="3" fill="white"/>
            <rect x="16" y="14.5" width="2" height="3" fill="white"/>
          </svg>
        </div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      })

      const m = L.marker(L.latLng(lat, lng), { icon })
      m.bindPopup(
        `<div class="popup-content">
          <div class="popup-title">${label}</div>
          <div class="popup-coords">X: ${p.respawnX}, Y: ${p.respawnY}, Z: ${p.respawnZ}</div>
        </div>`
      )
      m.addTo(map)
      markersRef.current.push(m)
    }

    return () => {
      for (const m of markersRef.current) map.removeLayer(m)
      markersRef.current = []
    }
  }, [map, players, dimension])

  return null
}
export default memo(PlayerRespawnMarker)
