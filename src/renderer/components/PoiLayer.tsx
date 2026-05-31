import { memo, useEffect, useMemo } from 'react'
import L from 'leaflet'
import { useApp } from '../App'
import { minecraftToLeaflet } from '../lib/tileCoords'
import { buildBeGroupLookup, isGroupVisible } from '../lib/markerFilters'
import * as api from '../lib/tauriAPI'
import { useChunkMarkerLayer, type LayerStats, makeLayerStats, updateLayerStats, markerYBounds } from '../lib/chunkMarkerLayer'
import { getPoiConfig, buildPopup, buildTooltip, createIcon } from '../lib/poiConfig'
import { attachMarkerContextMenu } from '../lib/contextMenuBus'

// ── Module-level stats ────────────────────────────────────────────────────────

export type PoiLayerStats = LayerStats
let _stats: LayerStats = makeLayerStats()
export function getPoiLayerStats(): LayerStats { return { ..._stats } }
export function resetPoiLayerStats(): void { _stats = makeLayerStats() }

// ── Component ─────────────────────────────────────────────────────────────────

function PoiLayer({ map }: { map: L.Map }) {
  const { state } = useApp()
  const { worldDir, dimension, enabledMarkerGroups, markerGroupDefs, markerYFilterEnabled, markerYFilterRadius } = state
  const edition = state.seedData?.edition ?? 'java'
  const playerY = state.seedData?.playerY ?? null

  const beGroupLookup       = useMemo(() => buildBeGroupLookup(markerGroupDefs), [markerGroupDefs])
  const jobsiteVisible      = isGroupVisible(beGroupLookup.get('jobsite'),       enabledMarkerGroups)
  const netherPortalVisible = isGroupVisible(beGroupLookup.get('nether_portal'), enabledMarkerGroups)
  const lodestoneVisible    = isGroupVisible(beGroupLookup.get('lodestone'),     enabledMarkerGroups)

  const triggerLoad = useChunkMarkerLayer(map, {
    worldDir,
    dimension,
    enabled: jobsiteVisible || netherPortalVisible || lodestoneVisible,
    onClear: () => { _stats.lastCount = 0 },
    onLoad: async (pool, group, bounds, isAborted) => {
      const { minCx, maxCx, minCz, maxCz } = bounds
      let records: PoiRecord[]
      const t0 = performance.now()
      try {
        records = await api.getPoi(worldDir!, edition, dimension, minCx, minCz, maxCx, maxCz)
      } catch { return }
      const elapsed = performance.now() - t0
      updateLayerStats(_stats, elapsed, records.length)

      if (isAborted()) return

      const [yMin, yMax] = markerYBounds(markerYFilterEnabled, playerY, markerYFilterRadius)

      const wanted = new Set<string>()
      for (const rec of records) {
        const isVisible = rec.kind === 'nether_portal' ? netherPortalVisible
                        : rec.kind === 'lodestone'     ? lodestoneVisible
                        : jobsiteVisible
        if (!isVisible) continue
        if (rec.y < yMin || rec.y > yMax) continue
        const key = `${rec.x}:${rec.y}:${rec.z}:${rec.kind}`
        wanted.add(key)

        if (!pool.has(key)) {
          const cfg = getPoiConfig(rec.kind)
          const { x: lng, y: lat } = minecraftToLeaflet(rec.x, rec.z)
          const marker = L.marker(L.latLng(lat, lng), { icon: createIcon(cfg, buildTooltip(rec, dimension)) })
          attachMarkerContextMenu(marker, () => ({
            blockX: rec.x, blockZ: rec.z, blockY: rec.y,
            kind:   'poi',
            label:  cfg.label,
            pinId:  null,
          }))
          marker.bindPopup(buildPopup(rec, dimension), { maxWidth: 320 })
          group.addLayer(marker)
          pool.set(key, marker)
        }
      }

      for (const [key, marker] of pool) {
        if (!wanted.has(key)) {
          group.removeLayer(marker)
          pool.delete(key)
        }
      }

      _stats.lastCount = wanted.size
    },
  })

  useEffect(() => {
    triggerLoad()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markerYFilterEnabled, markerYFilterRadius, playerY])

  return null
}
export default memo(PoiLayer)
