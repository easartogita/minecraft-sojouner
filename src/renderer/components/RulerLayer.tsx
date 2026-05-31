import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useApp } from '../App'
import { minecraftToLeaflet } from '../lib/tileCoords'

function toLatLng(x: number, z: number): L.LatLng {
  const { x: lng, y: lat } = minecraftToLeaflet(x, z)
  return L.latLng(lat, lng)
}

function legDist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.z - a.z) ** 2)
}

export default function RulerLayer({ map, mouseCoords }: {
  map: L.Map
  mouseCoords: { x: number; z: number } | null
}) {
  const { state } = useApp()
  const groupRef = useRef<L.LayerGroup | null>(null)
  const ghostRef = useRef<L.Polyline | null>(null)

  useEffect(() => {
    groupRef.current = L.layerGroup().addTo(map)
    ghostRef.current = L.polyline([], {
      color: '#58a6ff', weight: 2, dashArray: '6 5', opacity: 0.55, interactive: false,
    }).addTo(map)
    return () => {
      groupRef.current?.remove()
      ghostRef.current?.remove()
    }
  }, [map])

  // Redraw waypoints, polyline, and per-leg labels
  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    group.clearLayers()

    const wps = state.rulerWaypoints
    if (wps.length === 0) return

    // Polyline through all waypoints
    if (wps.length >= 2) {
      L.polyline(wps.map(w => toLatLng(w.x, w.z)), {
        color: '#58a6ff', weight: 3, opacity: 0.9, interactive: false,
      }).addTo(group)

      // Per-leg distance labels at midpoints
      for (let i = 0; i < wps.length - 1; i++) {
        const a = wps[i], b = wps[i + 1]
        const dist = legDist(a, b)
        const label = dist >= 1000
          ? `${(dist / 1000).toFixed(1)}k`
          : `${Math.round(dist)}`
        const mid = toLatLng((a.x + b.x) / 2, (a.z + b.z) / 2)
        L.marker(mid, {
          icon: L.divIcon({
            className: 'ruler-leg-label',
            html: `<span>${label}</span>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          }),
          interactive: false,
        }).addTo(group)
      }
    }

    // Numbered waypoint markers
    wps.forEach((w, i) => {
      L.marker(toLatLng(w.x, w.z), {
        icon: L.divIcon({
          className: 'ruler-waypoint-marker',
          html: `<span>${i + 1}</span>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        }),
        interactive: false,
        zIndexOffset: 1000,
      }).addTo(group)
    })
  }, [state.rulerWaypoints])

  // Ghost line from last waypoint to cursor
  useEffect(() => {
    const ghost = ghostRef.current
    if (!ghost) return
    const wps = state.rulerWaypoints
    if (!state.rulerActive || wps.length === 0 || !mouseCoords) {
      ghost.setLatLngs([])
      return
    }
    const last = wps[wps.length - 1]
    ghost.setLatLngs([toLatLng(last.x, last.z), toLatLng(mouseCoords.x, mouseCoords.z)])
  }, [state.rulerActive, state.rulerWaypoints, mouseCoords])

  return null
}
