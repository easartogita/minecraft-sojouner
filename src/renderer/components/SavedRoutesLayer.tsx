import { memo, useEffect, useRef } from 'react'
import L from 'leaflet'
import { useApp } from '../App'
import { minecraftToLeaflet } from '../lib/tileCoords'

function toLatLng(x: number, z: number): L.LatLng {
  const { x: lng, y: lat } = minecraftToLeaflet(x, z)
  return L.latLng(lat, lng)
}

/**
 * Google Maps "alternate route" treatment: every saved route not currently
 * being edited renders as a thin muted line, always visible regardless of
 * whether the Routes panel is open. Clicking one promotes it to active.
 */
function SavedRoutesLayer({ map }: { map: L.Map }) {
  const { state, dispatch } = useApp()
  const groupRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!map) return
    if (!groupRef.current) groupRef.current = L.layerGroup().addTo(map)
    const group = groupRef.current
    group.clearLayers()

    for (const route of state.savedRoutes) {
      if (route.dimension !== state.dimension) continue
      if (route.id === state.activeRouteId) continue
      if (route.waypoints.length < 2) continue

      const line = L.polyline(route.waypoints.map(w => toLatLng(w.x, w.z)), {
        color: '#8b949e', weight: 2.5, opacity: 0.55,
      })
      line.bindTooltip(route.name, { sticky: true })
      line.on('mouseover', () => line.setStyle({ opacity: 0.9, weight: 3.5 }))
      line.on('mouseout', () => line.setStyle({ opacity: 0.55, weight: 2.5 }))
      line.on('click', (e) => {
        // Stop this from also reaching the map's own click handler underneath —
        // otherwise promoting a route to active can immediately add a stray
        // waypoint to it too, if placement mode happened to already be on.
        L.DomEvent.stopPropagation(e)
        dispatch({
          type: 'RULER_LOAD_ROUTE', id: route.id,
          waypoints: route.waypoints, legModes: route.legModes,
        } as never)
      })
      group.addLayer(line)
    }

    return () => { group.clearLayers() }
  }, [map, state.savedRoutes, state.activeRouteId, state.dimension, dispatch])

  return null
}
export default memo(SavedRoutesLayer)
