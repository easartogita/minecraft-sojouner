import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useApp } from '../App'
import { minecraftToLeaflet } from '../lib/tileCoords'
import { TRAVEL_MODES, dashPatternForMode, gapDashPatternForMode, gapFillColorForMode } from '../lib/travelModes'
import { useBiomeSplitSegments } from '../hooks/useBiomeSplitSegments'

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
  const { state, generatorSlot } = useApp()
  const groupRef = useRef<L.LayerGroup | null>(null)
  const ghostCasingRef = useRef<L.Polyline | null>(null)
  const ghostGapRef = useRef<L.Polyline | null>(null)
  const ghostRef = useRef<L.Polyline | null>(null)
  const legSegments = useBiomeSplitSegments(
    generatorSlot, state.rulerWaypoints, state.rulerLegModes, state.boatMinSegmentBlocks,
  )

  useEffect(() => {
    groupRef.current = L.layerGroup().addTo(map)
    ghostCasingRef.current = L.polyline([], {
      color: '#000', weight: 4, opacity: 0.5, lineCap: 'butt', interactive: false,
    }).addTo(map)
    ghostGapRef.current = L.polyline([], {
      color: gapFillColorForMode('walk'), weight: 2, opacity: 0.7, lineCap: 'butt', interactive: false,
    }).addTo(map)
    ghostRef.current = L.polyline([], {
      color: '#b48ce0', weight: 2, dashArray: '6 5', opacity: 0.55, lineCap: 'butt', interactive: false,
    }).addTo(map)
    return () => {
      groupRef.current?.remove()
      ghostCasingRef.current?.remove()
      ghostGapRef.current?.remove()
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

    // One polyline per leg, or per sub-segment for biome-split legs (boat/walk, walk/swim)
    if (wps.length >= 2) {
      for (let i = 0; i < wps.length - 1; i++) {
        const a = wps[i], b = wps[i + 1]
        const mode = state.rulerLegModes[i] ?? 'walk'
        const subSegments = legSegments[i] ?? [{ from: a, to: b, mode, distance: legDist(a, b) }]

        for (const seg of subSegments) {
          const color = TRAVEL_MODES[seg.mode].color
          const latLngs = [toLatLng(seg.from.x, seg.from.z), toLatLng(seg.to.x, seg.to.z)]
          // Dark casing underneath every segment — a mode color that reads fine against
          // one biome (dark ocean, bright badlands, snow) can wash out against another;
          // a solid dark outline keeps the line legible regardless of what's under it.
          L.polyline(latLngs, {
            color: '#000', weight: 6, opacity: 0.45, lineCap: 'butt', interactive: false,
          }).addTo(group)
          // Candy-cane two-tone dash: the gap is filled with a neutral color instead
          // of showing whatever's underneath, so the dash rhythm itself — how long
          // each dash actually is — reads clearly at a glance, independent of mode
          // color or biome background. Ice's gap color is deliberately heavier/colder
          // than the default so icy terrain feels slow even in the gaps, not just via
          // the long dash length.
          const gapPattern = gapDashPatternForMode(seg.mode)
          L.polyline(latLngs, {
            color: gapFillColorForMode(seg.mode), weight: 4, opacity: 0.85,
            dashArray: gapPattern.dashArray, dashOffset: gapPattern.dashOffset,
            lineCap: 'butt',
            interactive: false,
          }).addTo(group)
          // Every mode gets its own dash rhythm, keyed to speed (longer dashes = slower,
          // near-solid = fastest) — a color-independent way to read which mode a segment
          // is, since some mode colors (walk vs. boat) are close enough in hue to be hard
          // to tell apart on a busy biome background.
          L.polyline(latLngs, {
            color, weight: 4, opacity: 0.95,
            dashArray: dashPatternForMode(seg.mode),
            lineCap: 'butt',
            interactive: false,
          }).addTo(group)
        }

        const dist = legDist(a, b)
        const label = dist >= 1000
          ? `${(dist / 1000).toFixed(1)}k`
          : `${Math.round(dist)}`
        const mid = toLatLng((a.x + b.x) / 2, (a.z + b.z) / 2)
        L.marker(mid, {
          icon: L.divIcon({
            className: 'ruler-leg-label',
            html: `<span style="color:${TRAVEL_MODES[mode].color}">${label}</span>`,
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
  }, [state.rulerWaypoints, state.rulerLegModes, legSegments])

  // Ghost line from last waypoint to cursor
  useEffect(() => {
    const ghost = ghostRef.current
    const casing = ghostCasingRef.current
    const gap = ghostGapRef.current
    if (!ghost || !casing || !gap) return
    const wps = state.rulerWaypoints
    // Placement mode, not just rulerActive — just viewing/selecting a route
    // (e.g. clicking a thin inactive-route line to promote it) shouldn't show a
    // "next click adds a point here" preview when nothing you do right now would.
    if (!state.rulerActive || !state.rulerPlacementMode || wps.length === 0 || !mouseCoords) {
      ghost.setLatLngs([])
      casing.setLatLngs([])
      gap.setLatLngs([])
      return
    }
    const last = wps[wps.length - 1]
    const latLngs = [toLatLng(last.x, last.z), toLatLng(mouseCoords.x, mouseCoords.z)]
    const gapPattern = gapDashPatternForMode(state.rulerCurrentMode)
    ghost.setStyle({ color: TRAVEL_MODES[state.rulerCurrentMode].color, dashArray: dashPatternForMode(state.rulerCurrentMode) })
    gap.setStyle({
      color: gapFillColorForMode(state.rulerCurrentMode),
      dashArray: gapPattern.dashArray, dashOffset: gapPattern.dashOffset,
    })
    ghost.setLatLngs(latLngs)
    casing.setLatLngs(latLngs)
    gap.setLatLngs(latLngs)
  }, [state.rulerActive, state.rulerPlacementMode, state.rulerWaypoints, state.rulerCurrentMode, mouseCoords])

  return null
}
