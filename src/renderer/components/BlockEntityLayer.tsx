import { memo, useEffect, useMemo } from 'react'
import L from 'leaflet'
import { useApp } from '../App'
import { minecraftToLeaflet } from '../lib/tileCoords'
import { buildBeGroupLookup, isGroupVisible, normalizeBEType } from '../lib/markerFilters'
import * as api from '../lib/tauriAPI'
import { useChunkMarkerLayer, type LayerStats, makeLayerStats, updateLayerStats, markerYBounds } from '../lib/chunkMarkerLayer'
import { getBEGroup, getBEConfig, buildPopup, buildTooltip, createIcon, type LootTier, formatLabel } from '../lib/blockEntityConfig'
import { attachMarkerContextMenu } from '../lib/contextMenuBus'

// ── Module-level stats (read by DebugOverlay) ─────────────────────────────────

export type BELayerStats = LayerStats
let _stats: LayerStats = makeLayerStats()
export function getBELayerStats(): LayerStats { return { ..._stats } }
export function resetBELayerStats(): void { _stats = makeLayerStats() }

// ── Component ─────────────────────────────────────────────────────────────────

function BlockEntityLayer({ map }: { map: L.Map }) {
  const { state } = useApp()
  const { worldDir, dimension, enabledMarkerGroups, markerGroupDefs, markerYFilterEnabled, markerYFilterRadius, changedRegions } = state
  const edition = state.seedData?.edition ?? 'java'
  const beGroupLookup = useMemo(() => buildBeGroupLookup(markerGroupDefs), [markerGroupDefs])
  const playerY = state.seedData?.playerY ?? null

  const triggerLoad = useChunkMarkerLayer(map, {
    worldDir,
    dimension,
    changedRegions,
    onClear: () => { _stats.lastCount = 0 },
    onLoad: async (pool, group, bounds, isAborted) => {
      const { minCx, maxCx, minCz, maxCz } = bounds
      let entities: BlockEntity[]
      const t0 = performance.now()
      try {
        entities = await api.getBlockEntities(worldDir!, edition, dimension, minCx, minCz, maxCx, maxCz)
      } catch { return }
      const elapsed = performance.now() - t0
      updateLayerStats(_stats, elapsed, entities.length)

      if (isAborted()) return

      const [yMin, yMax] = markerYBounds(markerYFilterEnabled, playerY, markerYFilterRadius)

      const wanted = new Set<string>()
      for (const be of entities) {
        if (be.y < yMin || be.y > yMax) continue
        if (!isGroupVisible(beGroupLookup.get(normalizeBEType(be.type)), enabledMarkerGroups)) continue
        const cfg = getBEConfig(be)
        if (!cfg) continue

        const key = `${be.x}:${be.y}:${be.z}`
        wanted.add(key)

        if (!pool.has(key)) {
          const { x: lng, y: lat } = minecraftToLeaflet(be.x, be.z)
          const unopened = getBEGroup(be.type) === 'containers' && !!be.lootTable
          const tier = (unopened ? (be.lootTier ?? 'B') : 'B') as LootTier
          const tooltip = buildTooltip(be, cfg, unopened, tier)
          const marker = L.marker(L.latLng(lat, lng), { icon: createIcon(cfg, tooltip, unopened, tier) })
          attachMarkerContextMenu(marker, () => {
            const beLabel  = cfg?.label ?? formatLabel(be.type)
            const subLabel = be.spawnType ? ` (${formatLabel(be.spawnType)})` : ''
            return { blockX: be.x, blockZ: be.z, blockY: be.y, kind: 'block_entity', label: beLabel + subLabel, pinId: null }
          })
          marker.bindPopup(buildPopup(be, cfg), { maxWidth: 280 })
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
  }, [enabledMarkerGroups, beGroupLookup, markerYFilterEnabled, markerYFilterRadius, playerY])

  return null
}
export default memo(BlockEntityLayer)
