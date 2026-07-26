import { memo, useEffect, useMemo } from 'react'
import L from 'leaflet'
import { useApp } from '../App'
import { minecraftToLeaflet } from '../lib/tileCoords'
import { buildBeGroupLookup, isGroupVisible, normalizeBEType } from '../lib/markerFilters'
import * as api from '../lib/tauriAPI'
import { useChunkMarkerLayer, type LayerStats, makeLayerStats, updateLayerStats, markerYBounds } from '../lib/chunkMarkerLayer'
import { getBEGroup, getBEConfig, buildPopup, buildTooltip, createIcon, type LootTier, formatLabel } from '../lib/blockEntityConfig'
import { effectiveMarkerAnchorY } from '../hooks/overlaySlice'
import { attachMarkerContextMenu } from '../lib/contextMenuBus'
import { MarkerSpider, collapseOpenSpider, ensureSpiderPanes, SPIDER_PANE } from '../lib/markerSpider'

// ── Module-level stats (read by DebugOverlay) ─────────────────────────────────

export type BELayerStats = LayerStats
let _stats: LayerStats = makeLayerStats()
export function getBELayerStats(): LayerStats { return { ..._stats } }
export function resetBELayerStats(): void { _stats = makeLayerStats() }

// Blocks whose semantic identity is a POI the PoiLayer already renders — every
// placed one auto-registers a POI record (bell → meeting point, job-site blocks
// → profession markers), so rendering the block entity too doubles the marker.
// Suppressed only while the jobsite group is visible; hide jobsites and the
// physical block marker comes back.
const POI_SHADOWED_BE_TYPES = new Set(['bell', 'smoker', 'blast_furnace', 'brewing_stand', 'lectern'])

// ── Marker builders ───────────────────────────────────────────────────────────

// One real marker (icon + tooltip + popup + context menu) for a block entity.
// Callers pre-filter, so a config is guaranteed. `pane` places stack children in
// the raised spider pane so they sit above the dimmer and the other markers.
function buildBEMarker(be: BlockEntity, pane?: string): L.Marker {
  const cfg = getBEConfig(be)!
  const { x: lng, y: lat } = minecraftToLeaflet(be.x, be.z)
  const unopened = getBEGroup(be.type) === 'containers' && !!be.lootTable
  const tier = (unopened ? (be.lootTier ?? 'B') : 'B') as LootTier
  const tooltip = buildTooltip(be, cfg, unopened, tier)
  // Only set `pane` when given — passing `pane: undefined` overwrites Leaflet's
  // default 'markerPane' with undefined and throws on add (map.getPane(undefined)).
  const opts: L.MarkerOptions = { icon: createIcon(cfg, tooltip, unopened, tier) }
  if (pane) opts.pane = pane
  const marker = L.marker(L.latLng(lat, lng), opts)
  attachMarkerContextMenu(marker, () => {
    const beLabel  = cfg?.label ?? formatLabel(be.type)
    const subLabel = be.spawnType ? ` (${formatLabel(be.spawnType)})` : ''
    return { blockX: be.x, blockZ: be.z, blockY: be.y, kind: 'block_entity', label: beLabel + subLabel, pinId: null }
  })
  // maxHeight keeps a heavily-stacked container (e.g. a double chest full of
  // shulker boxes) from rendering past the window edge — see the matching
  // note on the structure popup in StructureLayer.tsx for why this is a
  // Leaflet-level cap rather than an inner scroll box.
  marker.bindPopup(buildPopup(be, cfg), { maxWidth: 280, maxHeight: 420 })
  return marker
}

// Collapsed anchor for a vertical stack: the topmost entry's look plus a count
// badge. Clicking it (wired by MarkerSpider) fans the real markers out.
function buildStackAnchor(bes: BlockEntity[]): L.Marker {
  const top = bes[0]
  const cfg = getBEConfig(top)!
  const { x: lng, y: lat } = minecraftToLeaflet(top.x, top.z)
  const icon = L.divIcon({
    className: '',
    html: `<div class="be-marker" style="background:${cfg.color}" title="${bes.length} stacked here — click to expand">${cfg.initial}<span class="be-marker-badge" style="background:#334155">${bes.length}</span></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  })
  const anchor = L.marker(L.latLng(lat, lng), { icon })
  attachMarkerContextMenu(anchor, () => ({
    blockX: top.x, blockZ: top.z, blockY: top.y, kind: 'block_entity',
    label: `${bes.length} stacked`, pinId: null,
  }))
  return anchor
}

// ── Component ─────────────────────────────────────────────────────────────────

function BlockEntityLayer({ map }: { map: L.Map }) {
  const { state } = useApp()
  const { worldDir, dimension, enabledMarkerGroups, markerGroupDefs, markerYLow, markerYHigh, changedRegions, markerMinZoom } = state
  const edition = state.seedData?.edition ?? 'java'
  const beGroupLookup = useMemo(() => buildBeGroupLookup(markerGroupDefs), [markerGroupDefs])
  const playerY = state.seedData?.playerY ?? null
  const yAnchor = effectiveMarkerAnchorY(state, playerY)
  const jobsiteVisible = isGroupVisible(beGroupLookup.get('jobsite'), enabledMarkerGroups)

  // A background click or a zoom collapses whatever stack is fanned out.
  useEffect(() => {
    ensureSpiderPanes(map)
    map.on('click', collapseOpenSpider)
    map.on('zoomstart', collapseOpenSpider)
    return () => {
      map.off('click', collapseOpenSpider)
      map.off('zoomstart', collapseOpenSpider)
    }
  }, [map])

  const triggerLoad = useChunkMarkerLayer(map, {
    worldDir,
    dimension,
    changedRegions,
    minZoom: markerMinZoom,
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

      const [yMin, yMax] = markerYBounds(yAnchor, markerYLow, markerYHigh)

      // Group visible block entities by column so a vertical stack (same X/Z,
      // different Y — e.g. Abandoned Camp's two chests) shares one map point.
      const columns = new Map<string, BlockEntity[]>()
      for (const be of entities) {
        if (be.y < yMin || be.y > yMax) continue
        const beType = normalizeBEType(be.type)
        if (jobsiteVisible && POI_SHADOWED_BE_TYPES.has(beType)) continue
        if (!isGroupVisible(beGroupLookup.get(beType), enabledMarkerGroups)) continue
        if (!getBEConfig(be)) continue
        const colKey = `${be.x}:${be.z}`
        const arr = columns.get(colKey)
        if (arr) arr.push(be); else columns.set(colKey, [be])
      }

      const wanted = new Set<string>()
      let shown = 0
      for (const [colKey, bes] of columns) {
        bes.sort((a, b) => b.y - a.y)   // topmost first: anchor look + stable signature
        // Content-aware key: a changed stack (chest added/removed) gets a new key,
        // so the pool diffing rebuilds it instead of showing a stale count.
        const sig = `${colKey}:${bes.map(b => b.y).join(',')}`
        wanted.add(sig)
        shown += bes.length
        if (pool.has(sig)) continue

        if (bes.length === 1) {
          const marker = buildBEMarker(bes[0])
          group.addLayer(marker)
          pool.set(sig, marker)
        } else {
          const anchor = buildStackAnchor(bes)
          const spider = new MarkerSpider(map, group, anchor, bes.map(be => buildBEMarker(be, SPIDER_PANE)))
          // Keep the spider alive alongside its anchor (its handlers reference it).
          ;(anchor as unknown as { _spider: MarkerSpider })._spider = spider
          group.addLayer(anchor)
          pool.set(sig, anchor)
        }
      }

      for (const [key, marker] of pool) {
        if (!wanted.has(key)) {
          group.removeLayer(marker)
          pool.delete(key)
        }
      }

      _stats.lastCount = shown
    },
  })

  useEffect(() => {
    triggerLoad()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledMarkerGroups, beGroupLookup, yAnchor, markerYLow, markerYHigh])

  return null
}
export default memo(BlockEntityLayer)
