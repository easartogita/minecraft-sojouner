import { memo, useEffect, useRef } from 'react'
import L from 'leaflet'
import { useApp } from '../App'
import { minecraftToLeaflet } from '../lib/tileCoords'
import * as api from '../lib/tauriAPI'

function SpawnMarker({ map }: { map: L.Map }) {
  const { state, generatorSlot } = useApp()
  const markerRef = useRef<L.Marker | null>(null)

  const seed = state.seedData?.seed ?? null
  const dimension = state.dimension
  const version = state.selectedVersion

  useEffect(() => {
    if (markerRef.current) {
      map.removeLayer(markerRef.current)
      markerRef.current = null
    }

    if (generatorSlot == null || !seed || dimension !== 'overworld') return

    let cancelled = false
    const slot = generatorSlot

    api.getSpawn(slot)
      .then(spawn => {
        if (cancelled) return
        const { x: lng, y: lat } = minecraftToLeaflet(spawn.x, spawn.z)

        const icon = L.divIcon({
          className: '',
          html: `<div class="structure-marker spawn-marker" style="background:#f1c40f" title="World Spawn">
            <svg viewBox="0 0 20 20" width="13" height="13" style="display:block" overflow="visible">
              <polygon fill="white" points="10,2 11.8,8 18,8 13,12 15,18 10,14 5,18 7,12 2,8 8.2,8"/>
            </svg>
          </div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        })

        markerRef.current = L.marker(L.latLng(lat, lng), { icon })
        markerRef.current.bindPopup(
          `<div class="popup-content">
            <div class="popup-title">World Spawn</div>
            <div class="popup-coords">X: ${spawn.x}, Z: ${spawn.z}</div>
          </div>`
        )
        markerRef.current.addTo(map)
      })
      .catch(err => console.error('Spawn marker error:', err))

    return () => {
      cancelled = true
      if (markerRef.current) {
        map.removeLayer(markerRef.current)
        markerRef.current = null
      }
    }
  }, [map, generatorSlot, seed, dimension, version])

  return null
}
export default memo(SpawnMarker)
