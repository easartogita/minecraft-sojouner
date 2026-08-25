import { memo, useEffect, useRef } from 'react'
import L from 'leaflet'
import { useApp } from '../App'
import { minecraftToLeaflet } from '../lib/tileCoords'
import * as api from '../lib/tauriAPI'

// Below this block distance the cubiomes-predicted spawn and the stored spawn
// are treated as the same point (they can differ by a few blocks of algorithmic
// jitter on an untouched world); only a deliberate move (/setworldspawn) pushes
// them far enough apart to warrant showing the prediction as a second marker.
const SPAWN_DIFF_TOLERANCE = 8

function SpawnMarker({ map }: { map: L.Map }) {
  const { state, generatorSlot, generatorConfig } = useApp()
  const markersRef = useRef<L.Marker[]>([])

  const seed = state.seedData?.seed ?? null
  const dimension = state.dimension
  const version = state.selectedVersion

  // With a real world open, the world spawn is whatever level.dat says — which
  // is what `/setworldspawn` edits and what the map centres on at open. The
  // cubiomes-predicted spawn (api.getSpawn) is only the *default* spawn derived
  // from the seed and never reflects /setworldspawn. Show the real spawn as the
  // primary marker, and the prediction as a secondary marker when it differs.
  const worldDir = state.worldDir
  const realSpawnX = worldDir ? state.seedData?.spawnX ?? null : null
  const realSpawnZ = worldDir ? state.seedData?.spawnZ ?? null : null

  useEffect(() => {
    const clear = () => {
      for (const m of markersRef.current) map.removeLayer(m)
      markersRef.current = []
    }
    clear()

    if (generatorSlot == null || !seed || dimension !== 'overworld') return

    let cancelled = false
    const slot = generatorSlot

    const place = (
      x: number, z: number, kind: 'set' | 'predicted',
      other?: { x: number; z: number }
    ) => {
      if (cancelled) return
      const { x: lng, y: lat } = minecraftToLeaflet(x, z)
      const bg    = kind === 'set' ? '#f1c40f' : '#8b949e'
      const cls   = kind === 'set' ? 'spawn-marker' : 'spawn-marker spawn-marker--predicted'
      const title = kind === 'set' ? 'Set Spawn' : 'Predicted Spawn'
      const opacity = kind === 'set' ? '1' : '0.75'
      const btnId = `spawn-flyto-${kind}`

      const icon = L.divIcon({
        className: '',
        html: `<div class="structure-marker ${cls}" style="background:${bg};opacity:${opacity}" title="${title}">
          <svg viewBox="0 0 20 20" width="13" height="13" style="display:block" overflow="visible">
            <polygon fill="white" points="10,2 11.8,8 18,8 13,12 15,18 10,14 5,18 7,12 2,8 8.2,8"/>
          </svg>
        </div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      })

      let note = ''
      if (other) {
        const hint = kind === 'set'
          ? `This differs from the Predicted Spawn, which is at X: ${other.x}, Z: ${other.z}.`
          : `The Set Spawn is at X: ${other.x}, Z: ${other.z} instead.`
        note = `<div class="popup-hint">${hint} <a href="#" id="${btnId}">Jump there</a></div>`
      }

      const m = L.marker(L.latLng(lat, lng), { icon, zIndexOffset: kind === 'set' ? 100 : 0 })
      m.bindPopup(
        `<div class="popup-content">
          <div class="popup-title">${title}</div>
          <div class="popup-coords">X: ${x}, Z: ${z}</div>
          ${note}
        </div>`
      )
      if (other) {
        m.on('popupopen', () => {
          const link = document.getElementById(btnId)
          if (link) {
            link.onclick = (e) => {
              e.preventDefault()
              const { x: olng, y: olat } = minecraftToLeaflet(other.x, other.z)
              map.flyTo(L.latLng(olat, olng), Math.max(map.getZoom(), 3))
            }
          }
        })
      }
      m.addTo(map)
      markersRef.current.push(m)
    }

    ;(async () => {
      // cubiomes-predicted spawn (overworld default from the seed).
      let predicted: { x: number; z: number } | null = null
      try {
        const { seedBig, dimId, worldFlags, mcVersion } = generatorConfig
        const p = await api.getSpawn(slot, seedBig, dimId, worldFlags, mcVersion)
        if (p) predicted = { x: p.x, z: p.z }
      } catch (err) {
        console.error('Spawn marker error:', err)
      }
      if (cancelled) return

      if (realSpawnX != null && realSpawnZ != null) {
        // Real world: the set spawn is primary; add the prediction only if it
        // differs from it by a meaningful distance.
        const diverged = predicted &&
          Math.hypot(predicted.x - realSpawnX, predicted.z - realSpawnZ) > SPAWN_DIFF_TOLERANCE
        place(realSpawnX, realSpawnZ, 'set', diverged ? predicted! : undefined)
        if (diverged) {
          place(predicted!.x, predicted!.z, 'predicted', { x: realSpawnX, z: realSpawnZ })
        }
      } else if (predicted) {
        // Seed-only mode: the prediction is the only spawn we have.
        place(predicted.x, predicted.z, 'set')
      }
    })()

    return () => {
      cancelled = true
      clear()
    }
  }, [map, generatorSlot, seed, dimension, version, realSpawnX, realSpawnZ, generatorConfig])

  return null
}
export default memo(SpawnMarker)
