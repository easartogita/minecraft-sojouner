import { memo, useEffect, useMemo } from 'react'
import L from 'leaflet'
import { useApp } from '../App'
import { minecraftToLeaflet } from '../lib/tileCoords'
import { buildEntityGroupLookup, isGroupVisible, ENTITY_TYPE_TO_GROUP } from '../lib/markerFilters'
import { effectiveMarkerAnchorY } from '../hooks/overlaySlice'
import * as api from '../lib/tauriAPI'
import { useChunkMarkerLayer, type LayerStats, makeLayerStats, updateLayerStats, markerYBounds } from '../lib/chunkMarkerLayer'
import { getConfig, buildPopup, buildTooltip, createIcon, getVillagerLevelData, getHorseRatings } from '../lib/entityConfig'
import { attachMarkerContextMenu } from '../lib/contextMenuBus'
import { TileJobQueue } from '../lib/tileJobQueue'
import * as tileStats from '../lib/tileStats'

export type EntityLayerStats = LayerStats
let _stats: LayerStats = makeLayerStats()
export function getEntityLayerStats(): LayerStats { return { ..._stats } }
export function resetEntityLayerStats(): void { _stats = makeLayerStats() }

// Single-slot queue purely so an in-flight load shows up in TileLoadingHud/DebugOverlay
// via the same registerOverlay mechanism the tile-queue layers use.
const loadQueue = new TileJobQueue(1, () => tileStats.notify(), 'entity')
tileStats.registerOverlay({ key: 'entity', label: 'Entities', className: 'entity', queues: [loadQueue], caches: [] })

function EntityLayer({ map }: { map: L.Map }) {
  const { state } = useApp()
  const { worldDir, dimension, enabledMarkerGroups, markerGroupDefs, markerYLow, markerYHigh, changedRegions, markerMinZoom } = state
  const edition = state.seedData?.edition ?? 'java'
  const entityGroupLookup = useMemo(() => buildEntityGroupLookup(markerGroupDefs), [markerGroupDefs])
  const playerY = state.seedData?.playerY ?? null
  const yAnchor = effectiveMarkerAnchorY(state, playerY)

  const triggerLoad = useChunkMarkerLayer(map, {
    worldDir,
    dimension,
    changedRegions,
    minZoom: markerMinZoom,
    loadQueue,
    onClear: () => { _stats.lastCount = 0 },
    onLoad: async (pool, group, bounds, isAborted) => {
      const { minCx, maxCx, minCz, maxCz } = bounds
      let entities: GameEntity[]
      const t0 = performance.now()
      try {
        entities = await api.getEntities(worldDir!, edition, dimension, minCx, minCz, maxCx, maxCz)
      } catch { return }
      const elapsed = performance.now() - t0
      updateLayerStats(_stats, elapsed, entities.length)

      if (isAborted()) return

      const [yMin, yMax] = markerYBounds(yAnchor, markerYLow, markerYHigh)

      const wanted = new Set<string>()
      for (const e of entities) {
        if (e.y < yMin || e.y > yMax) continue
        const typeKey = e.type === 'zombie_villager'
          ? ((e.conversionTime ?? -1) > 0 ? 'zombie_villager_curing' : 'zombie_villager')
          : ENTITY_TYPE_TO_GROUP[e.type] ? e.type : 'uncategorized'
        // An entity matches its type group, plus 'named_mobs' if it has a custom name
        // (so a named cow shows under both Livestock and Named Mobs).
        const lookupKeys = e.customName ? [typeKey, 'named_mobs'] : [typeKey]
        const groupIds = lookupKeys.flatMap(k => entityGroupLookup.get(k) ?? [])
        if (!isGroupVisible(groupIds, enabledMarkerGroups)) continue

        const key = `${e.x}:${e.y}:${e.z}:${e.type}`
        wanted.add(key)

        if (!pool.has(key)) {
          const cfg       = getConfig(e)
          const levelData = (e.type === 'villager' || e.type === 'zombie_villager')
            ? getVillagerLevelData(e.villagerLevel) : null
          const horseRatings = (e.type === 'horse' || e.type === 'zombie_horse' || e.type === 'skeleton_horse')
            ? getHorseRatings(e) : null
          const { x: lng, y: lat } = minecraftToLeaflet(e.x, e.z)
          const badge = levelData
            ? { text: levelData.badge, color: levelData.color }
            : horseRatings?.speed
              ? { text: horseRatings.speed.badge, color: horseRatings.speed.color }
              : undefined
          const badge2 = horseRatings?.jump
            ? { text: horseRatings.jump.badge, color: horseRatings.jump.color }
            : undefined
          const borderColor = e.type === 'zombie_villager'
            ? ((e.conversionTime ?? -1) > 0 ? '#f59e0b' : '#ef4444')
            : undefined
          const marker = L.marker(L.latLng(lat, lng), { icon: createIcon(cfg, buildTooltip(e), badge, borderColor, badge2) })
          attachMarkerContextMenu(marker, () => ({
            blockX: e.x, blockZ: e.z, blockY: e.y,
            kind:   'entity',
            label:  e.customName ? `${cfg.label} "${e.customName}"` : cfg.label,
            pinId:  null,
          }))
          marker.bindPopup(buildPopup(e), { maxWidth: 320 })
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
  }, [enabledMarkerGroups, entityGroupLookup, yAnchor, markerYLow, markerYHigh])

  return null
}
export default memo(EntityLayer)
