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

// Block-accurate outline of the disc of `r` blocks around block (cx, cz).
// Mob-spawn eligibility is a per-block Euclidean check (a block is inside when
// a²+b² ≤ r²), so the no-spawn boundary is a rasterized staircase, not a smooth
// circle. Traces the top edge left→right then the bottom edge right→left.
function blockDiscOutline(cx: number, cz: number, r: number): L.LatLngExpression[] {
  const pts: L.LatLngExpression[] = []
  const push = (mcX: number, mcZ: number) => {
    const { x: lng, y: lat } = minecraftToLeaflet(mcX, mcZ)
    pts.push([lat, lng])
  }
  for (let a = -r; a <= r; a++) {
    const b = Math.floor(Math.sqrt(r * r - a * a))
    push(cx + a, cz + b + 1)          // top edge of this column (block cz+b)
    push(cx + a + 1, cz + b + 1)
  }
  for (let a = r; a >= -r; a--) {
    const b = Math.floor(Math.sqrt(r * r - a * a))
    push(cx + a + 1, cz - b)          // bottom edge of this column (block cz-b)
    push(cx + a, cz - b)
  }
  return pts
}

// A ridden mount is stored on the player (RootVehicle), not in the region
// files, so its own marker vanishes — these surface it on the player marker.
function titleCase(id: string): string {
  return id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
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
        // 24-block no-spawn: per-block check → block-accurate staircase outline,
        // centred on the player's block.
        const inner = L.polygon(
          blockDiscOutline(Math.floor(displayX), Math.floor(displayZ), 24),
          { color: ring, weight: 1.5, opacity: 0.7,
            fillColor: ring, fillOpacity: 0.07, interactive: false },
        ).addTo(map)
        // 128-block despawn: continuous check on the mob's real position → smooth.
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

      // Mounted indicator: a second label line — the mount's name if named, else
      // its type — plus a hover title and full detail in the popup.
      const mountTitle = player.mountType ? ` · riding ${titleCase(player.mountType)}` : ''
      const mountDisplay = player.mountType ? (player.mountName || titleCase(player.mountType)) : null
      const mountSub = mountDisplay
        ? `<span class="player-marker__mount">(${escapeHtml(mountDisplay)})</span>`
        : ''
      const mountLine = player.mountType
        ? `<div class="popup-coords">Riding: ${titleCase(player.mountType)}${
            player.mountName ? ` — “${escapeHtml(player.mountName)}”` : ''}</div>`
        : ''

      const icon = L.divIcon({
        className: '',
        html: `<div class="${markerClass}" style="border-color:${ring};box-shadow:0 0 0 2px ${glow},0 1px 4px rgba(0,0,0,0.6)" title="${label}${dimSuffix}${mountTitle}">
          <div class="player-marker__label" style="color:${ring}">${escapeHtml(label)}${mountSub}</div>
        </div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      })

      const marker = L.marker(latlng, { icon, zIndexOffset: 1000 - idx })
      marker.bindPopup(
        `<div class="popup-content">
          <div class="popup-title" style="color:${ring}">${label}${dimSuffix}</div>
          <div class="popup-coords">X: ${Math.round(displayX)}, Y: ${Math.round(player.y)}, Z: ${Math.round(displayZ)}</div>
          ${mountLine}
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
