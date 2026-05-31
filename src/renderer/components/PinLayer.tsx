import { memo, useEffect, useRef } from 'react'
import L from 'leaflet'
import { useApp } from '../App'
import { minecraftToLeaflet } from '../lib/tileCoords'
import { attachMarkerContextMenu } from '../lib/contextMenuBus'
import type { Pin } from '../hooks/useSeed'
import type { Dimension } from '../lib/constants'

function blockCoordsToLatLng(x: number, z: number): L.LatLng {
  const { x: lng, y: lat } = minecraftToLeaflet(x, z)
  return L.latLng(lat, lng)
}

/** Returns true if the pin should be visible in the given dimension. */
function pinVisibleIn(pin: Pin, dim: Dimension): boolean {
  if (pin.dimension === dim) return true
  if (!pin.crossDimensional) return false
  // Cross-dimensional pins link overworld ↔ nether only
  return (pin.dimension === 'overworld' && dim === 'nether')
      || (pin.dimension === 'nether' && dim === 'overworld')
}

/** Build coordinate HTML showing native + converted coords for cross-dimensional pins. */
function coordsHtml(pin: Pin, viewDim: Dimension): string {
  if (!pin.crossDimensional || (pin.dimension !== 'overworld' && pin.dimension !== 'nether')) {
    return `<div class="popup-coords">X: ${pin.x}, Z: ${pin.z}</div>`
  }
  const isOverworld = pin.dimension === 'overworld'
  const owX = isOverworld ? pin.x : pin.x * 8
  const owZ = isOverworld ? pin.z : pin.z * 8
  const ntX = isOverworld ? Math.floor(pin.x / 8) : pin.x
  const ntZ = isOverworld ? Math.floor(pin.z / 8) : pin.z
  const owStyle = viewDim === 'overworld' ? 'font-weight:bold' : 'opacity:0.7'
  const ntStyle = viewDim === 'nether'    ? 'font-weight:bold' : 'opacity:0.7'
  return `<div class="popup-coords" style="${owStyle}">Overworld: ${owX}, ${owZ}</div>`
       + `<div class="popup-coords" style="${ntStyle}">Nether: ${ntX}, ${ntZ}</div>`
}

function PinLayer({ map }: { map: L.Map }) {
  const { state, dispatch } = useApp()
  const layerGroupRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!map) return
    if (!layerGroupRef.current) {
      layerGroupRef.current = L.layerGroup().addTo(map)
    }
    const group = layerGroupRef.current
    group.clearLayers()

    const dim = state.dimension

    for (const pin of state.pins) {
      if (!pinVisibleIn(pin, dim)) continue

      // Position: if viewing a different dimension, convert coordinates
      let markerX = pin.x
      let markerZ = pin.z
      if (pin.dimension !== dim && pin.crossDimensional) {
        if (pin.dimension === 'overworld' && dim === 'nether') {
          markerX = Math.floor(pin.x / 8)
          markerZ = Math.floor(pin.z / 8)
        } else if (pin.dimension === 'nether' && dim === 'overworld') {
          markerX = pin.x * 8
          markerZ = pin.z * 8
        }
      }

      const icon = L.divIcon({
        className: '',
        html: `<div class="pin-marker" title="${pin.label}">
          <svg viewBox="0 0 20 24" width="20" height="24" overflow="visible">
            <circle fill="#e74c3c" cx="10" cy="8" r="7"/>
            <circle fill="rgba(255,255,255,0.35)" cx="8" cy="6" r="2.5"/>
            <line stroke="#c0392b" stroke-width="2" stroke-linecap="round" x1="10" y1="15" x2="10" y2="23"/>
            <circle fill="rgba(0,0,0,0.25)" cx="10" cy="23" rx="4" ry="1.5" r="2"/>
          </svg>
        </div>`,
        iconSize: [20, 24],
        iconAnchor: [10, 23],
        popupAnchor: [0, -26],
      })

      const marker = L.marker(blockCoordsToLatLng(markerX, markerZ), { icon })
      attachMarkerContextMenu(marker, () => ({
        blockX: pin.x, blockZ: pin.z, blockY: null,
        kind:   'pin',
        label:  pin.label || null,
        pinId:  pin.id,
      }))

      marker.bindPopup(
        `<div class="popup-content">
          <div class="popup-title">${pin.label}</div>
          ${coordsHtml(pin, dim)}
          <button class="pin-delete-btn" data-id="${pin.id}" style="margin-top:6px;font-size:11px;cursor:pointer;background:none;border:1px solid #c0392b;color:#c0392b;border-radius:3px;padding:2px 8px">Delete</button>
        </div>`
      )
      marker.on('popupopen', () => {
        const btn = document.querySelector(`.pin-delete-btn[data-id="${pin.id}"]`) as HTMLButtonElement | null
        if (btn) {
          btn.onclick = () => {
            marker.closePopup()
            dispatch({ type: 'REMOVE_PIN', id: pin.id } as never)
          }
        }
      })
      group.addLayer(marker)
    }

    return () => { group.clearLayers() }
  }, [map, state.pins, state.dimension])

  return null
}
export default memo(PinLayer)
