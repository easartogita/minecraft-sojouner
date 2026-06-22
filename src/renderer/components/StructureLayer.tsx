import { memo, useEffect, useRef } from 'react'
import L from 'leaflet'
import { tooltipText } from '../lib/chunkMarkerLayer'
import { useApp } from '../App'
import { STRUCTURE_CONFIG, StructureType } from '../lib/structureConfig'
import { queryStructures } from '../lib/structureQuery'
import { setupDebouncedMapListeners } from '../lib/mapListeners'
import { minecraftToLeaflet } from '../lib/tileCoords'
import { BASE_BLOCKS_PER_PIXEL, MC_VERSIONS } from '../lib/constants'
import { attachMarkerContextMenu } from '../lib/contextMenuBus'
import * as api from '../lib/tauriAPI'

// Structure types whose pieces/loot the backend can generate (cubiomes
// StructureType enum ids). Markers of these types get a chest-loot list and
// piece footprints. Must match a structure handled by getStructurePieces in
// the cubiomes fork *and* have a loot table in cubiomes/loot/loot_tables/.
const STRUCT_PIECE_ID: Partial<Record<StructureType, number>> = {
  desert_temple:        1,
  jungle_temple:        2,
  igloo:                4,
  shipwreck:            7,
  outpost:              10,
  ruined_portal:        11,
  ruined_portal_nether: 12,
  buried_treasure:      14,
  fortress:             18,
  bastion:              19,
  end_city:             20,
  stronghold:           25,
}

// Marker loot badges: a fixed vertical column of slots on the marker's right
// edge, one per possible chest kind, ordered top→bottom. A slot lights up if
// that loot table is present in this particular instance; absent slots render
// as invisible spacers so present ones keep their fixed position (a shipwreck
// with only treasure+supply shows T at top and S at bottom, the map slot blank).
// `match` is a substring of the cubiomes loot-table name for that chest kind.
interface BadgeSlot { letter: string; match: string; color: string; title: string }

const STRUCT_BADGES: Partial<Record<StructureType, BadgeSlot[]>> = {
  shipwreck: [
    { letter: 'T', match: 'treasure', color: '#ffd700', title: 'Treasure chest (loot map ingredients, gold, emeralds)' },
    { letter: 'M', match: 'map',      color: '#4aa3df', title: 'Map chest (buried-treasure map, compass)' },
    { letter: 'S', match: 'supply',   color: '#7ec850', title: 'Supply chest (food, wheat, gunpowder)' },
  ],
  stronghold: [
    { letter: 'L', match: 'library',  color: '#ffd700', title: 'Library chest (enchanted book)' },
    { letter: 'X', match: 'crossing', color: '#9ca3af', title: 'Crossing chest' },
    { letter: 'C', match: 'corridor', color: '#cd7f32', title: 'Corridor chest' },
  ],
}

// Build the badge column HTML for a structure given the loot tables present.
function badgeColumnHTML(slots: BadgeSlot[], presentTables: string[]): string {
  const chips = slots.map(s => {
    const present = presentTables.some(t => t.includes(s.match))
    return present
      ? `<span class="sb-chip" style="background:${s.color}" title="${s.title}">${s.letter}</span>`
      : `<span class="sb-chip sb-empty"></span>`
  }).join('')
  return `<span class="struct-badges">${chips}</span>`
}

// Human label for a chest given its loot-table name, e.g.
// "shipwreck_treasure" → "Treasure chest", "stronghold_library" → "Library chest".
function chestKindLabel(table: string): string {
  const kind = table.split('_').pop() ?? table
  return `${kind.charAt(0).toUpperCase()}${kind.slice(1)} chest`
}

const VARIANT_ABBREV: Record<string, string> = {
  basement:    'B',
  zombie:      'Z',
  giant:       'G',
  underground: 'U',
}

// Returns the inner SVG shapes for a 20×20 viewBox. White fill/stroke unless noted.
function getStructureShapeHTML(type: StructureType): string {
  const W = 'fill="white"'
  const S = 'fill="none" stroke="white" stroke-linecap="round"'
  const D = 'fill="rgba(0,0,0,0.35)"'

  switch (type) {
    // ── Settlements ────────────────────────────────────────────────────────────
    case 'village':
      return `<polygon ${W} points="10,2 18,9 2,9"/>
              <rect ${W} x="4" y="9" width="12" height="9"/>
              <rect ${D} x="8" y="13" width="4" height="5"/>`

    case 'mansion':
      return `<polygon ${W} points="10,2 18,8 2,8"/>
              <rect ${W} x="3" y="8" width="14" height="10"/>
              <rect ${D} x="8" y="12" width="4" height="6"/>
              <rect ${D} x="3" y="10" width="4" height="4"/>
              <rect ${D} x="13" y="10" width="4" height="4"/>`

    case 'witch_hut':
      return `<polygon ${W} points="10,2 15,9 13,9 13,17 7,17 7,9 5,9"/>
              <rect ${D} x="8" y="12" width="4" height="5"/>`

    case 'igloo':
      return `<path ${W} d="M3,14 Q3,4 10,4 Q17,4 17,14Z"/>
              <rect ${W} x="3" y="14" width="14" height="2"/>
              <rect ${D} x="8" y="10" width="4" height="6"/>`

    // ── Pyramids / Temples ─────────────────────────────────────────────────────
    case 'desert_temple':
      return `<polygon ${W} points="10,2 18,17 2,17"/>
              <rect ${D} x="8" y="12" width="4" height="5"/>`

    case 'jungle_temple':
      return `<polygon ${W} points="10,2 18,17 2,17"/>
              <rect ${D} x="6" y="10" width="8" height="7"/>
              <rect ${W} x="8" y="12" width="4" height="2"/>`

    // ── Towers / Outposts ──────────────────────────────────────────────────────
    case 'outpost':
      return `<rect ${W} x="7" y="6" width="6" height="12"/>
              <rect ${W} x="4" y="3" width="4" height="6"/>
              <rect ${W} x="12" y="3" width="4" height="6"/>
              <rect ${W} x="4" y="3" width="12" height="2.5"/>`

    // ── Ocean structures ───────────────────────────────────────────────────────
    case 'ocean_monument':
      return `<polygon ${W} points="10,2 18,10 10,18 2,10"/>
              <polygon ${D} points="10,6 14,10 10,14 6,10"/>`

    case 'shipwreck':
      return `<path ${W} d="M3,15 L5,7 L10,4 L15,7 L17,15 Q10,18 3,15Z"/>
              <path ${D} d="M3,15 Q10,12 17,15"/>
              <rect ${W} x="9" y="3" width="2" height="5"/>`

    case 'ocean_ruins':
      return `<rect ${W} x="3" y="9" width="4" height="8"/>
              <rect ${W} x="13" y="6" width="4" height="11"/>
              <path ${S} stroke-width="2.5" d="M3,9 Q10,4 17,9"/>`

    // ── Underground ────────────────────────────────────────────────────────────
    case 'stronghold':
      return `<ellipse ${W} cx="10" cy="10" rx="8" ry="5"/>
              <circle ${D} cx="10" cy="10" r="3.5"/>
              <circle ${W} cx="10" cy="10" r="1.5"/>`

    case 'mineshaft':
      return `<rect ${W} x="7" y="3" width="2.5" height="14"/>
              <rect ${W} x="10.5" y="3" width="2.5" height="14"/>
              <rect ${W} x="7" y="5.5" width="6" height="2"/>
              <rect ${W} x="7" y="10" width="6" height="2"/>
              <rect ${W} x="7" y="14.5" width="6" height="2"/>`

    case 'ancient_city':
      return `<rect ${W} x="2" y="2" width="5" height="5"/>
              <rect ${W} x="13" y="2" width="5" height="5"/>
              <rect ${W} x="2" y="13" width="5" height="5"/>
              <rect ${W} x="13" y="13" width="5" height="5"/>
              <rect ${W} x="7.5" y="7.5" width="5" height="5"/>`

    case 'buried_treasure':
      return `<path ${S} stroke-width="3.5" d="M4,4 L16,16 M16,4 L4,16"/>`

    case 'geode':
      return `<polygon ${W} points="10,1 16,5 18,13 13,19 7,19 2,13 4,5"/>
              <polygon ${D} points="10,5 14,8 15,14 10,17 5,14 6,8"/>`

    // ── Surface world ──────────────────────────────────────────────────────────
    case 'ruined_portal':
    case 'ruined_portal_nether':
      return `<path ${S} stroke-width="3" d="M5,17 L5,7 Q5,2 10,2 Q15,2 15,7 L15,17"/>
              <path ${S} stroke-width="2" d="M5,8 H8 M15,8 H12 M5,13 H8 M15,13 H12"/>`

    case 'trial_chambers':
      return `<polygon ${W} points="10,2 17,6 17,14 10,18 3,14 3,6"/>
              <circle ${D} cx="10" cy="10" r="3.5"/>
              <circle ${W} cx="10" cy="10" r="1.5"/>`

    case 'trail_ruins':
      return `<circle ${W} cx="5" cy="5.5" r="2.5"/>
              <circle ${W} cx="15" cy="5.5" r="2.5"/>
              <circle ${W} cx="10" cy="11" r="2.5"/>
              <circle ${W} cx="5" cy="16" r="2.5"/>
              <circle ${W} cx="15" cy="16" r="2.5"/>`

    case 'desert_well':
      return `<rect ${W} x="6" y="8" width="8" height="8"/>
              <rect ${W} x="4" y="6" width="12" height="3"/>
              <rect ${W} x="4" y="3" width="2" height="6"/>
              <rect ${W} x="14" y="3" width="2" height="6"/>
              <rect ${W} x="4" y="3" width="12" height="2"/>`

    // ── Nether ─────────────────────────────────────────────────────────────────
    case 'fortress':
      return `<rect ${W} x="2" y="9" width="16" height="8"/>
              <rect ${W} x="2" y="4" width="5" height="8"/>
              <rect ${W} x="13" y="4" width="5" height="8"/>
              <path ${D} d="M7,17 L7,12 Q10,9 13,12 L13,17Z"/>
              <rect ${W} x="2" y="4" width="16" height="2.5"/>`

    case 'bastion':
      return `<rect ${W} x="2" y="2" width="16" height="16"/>
              <rect ${D} x="6" y="6" width="8" height="8"/>
              <rect ${W} x="8.5" y="8.5" width="3" height="3"/>`

    // ── End ────────────────────────────────────────────────────────────────────
    case 'end_city':
      return `<polygon ${W} points="10,2 12.4,7.8 18.5,8.2 14,12.3 15.5,18.3 10,15 4.5,18.3 6,12.3 1.5,8.2 7.6,7.8"/>`

    case 'end_gateway':
      return `<circle ${S} stroke-width="2.5" cx="10" cy="10" r="7"/>
              <circle ${W} cx="10" cy="10" r="3"/>`

    case 'end_island':
      return `<ellipse ${W} cx="10" cy="13" rx="7" ry="4"/>
              <polygon ${W} points="10,4 13,13 7,13"/>`

    default:
      return `<circle ${W} cx="10" cy="10" r="7.5"/>`
  }
}

function createMarkerIcon(
  type: StructureType,
  color: string,
  label: string,
  summary: string,
  variant?: { tag: string; color: string } | null,
  badgesHTML = ''
): L.DivIcon {
  const shapeHTML = getStructureShapeHTML(type)
  const badge = variant
    ? `<span class="structure-variant-badge" style="background:${variant.color}">${VARIANT_ABBREV[variant.tag] ?? variant.tag.charAt(0).toUpperCase()}</span>`
    : ''
  const title = tooltipText(label, summary || null)
  return L.divIcon({
    className: '',
    html: `<div class="structure-marker" style="background:${color}" title="${title}">
      <svg viewBox="0 0 20 20" width="13" height="13" style="display:block;flex-shrink:0" overflow="visible">
        ${shapeHTML}
      </svg>
      ${badge}
      ${badgesHTML}
    </div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  })
}

function blockCoordsToLatLng(x: number, z: number): L.LatLng {
  const { x: lng, y: lat } = minecraftToLeaflet(x, z)
  return L.latLng(lat, lng)
}

function blockRadiusToLeaflet(radius: number): number {
  return radius / BASE_BLOCKS_PER_PIXEL
}

interface PoolEntry { marker: L.Marker; circle?: L.Circle; structType: StructureType }

function dismissedStorageKey(seed: bigint): string {
  return `mcmap:dismissed:${seed.toString(16)}`
}

function loadDismissed(seed: bigint): Set<string> {
  try {
    const raw = localStorage.getItem(dismissedStorageKey(seed))
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch { return new Set() }
}

function saveDismissed(seed: bigint, dismissed: Set<string>): void {
  localStorage.setItem(dismissedStorageKey(seed), JSON.stringify([...dismissed]))
}

function StructureLayer({ map, slot }: { map: L.Map; slot: number | null }) {
  const { state } = useApp()
  const layerGroupRef = useRef<L.LayerGroup | null>(null)
  // Pool lives as a ref so it survives re-renders — zoom changes don't blow it away.
  const poolRef = useRef<Map<string, PoolEntry>>(new Map())
  // Incremented on every updateStructures call; stale results are discarded on mismatch.
  const updateGenRef = useRef(0)
  const dismissedRef = useRef<Set<string>>(new Set())

  const seed = state.seedData?.seed ?? null
  const { dimension, selectedVersion, worldType, enabledStructures, showStructures, structureRevision } = state

  useEffect(() => {
    if (!map) return

    if (!layerGroupRef.current) {
      layerGroupRef.current = L.layerGroup().addTo(map)
    }
    const group = layerGroupRef.current
    const pool  = poolRef.current

    if (!seed || !showStructures) {
      pool.forEach(entry => {
        group.removeLayer(entry.marker)
        if (entry.circle) group.removeLayer(entry.circle)
      })
      pool.clear()
      return
    }

    dismissedRef.current = loadDismissed(BigInt(seed))

    const updateStructures = async () => {
      const gen = ++updateGenRef.current

      // Read zoom from the map directly so this stays current across pan/zoom without
      // needing zoom in the dep array (which would cause full pool teardown on every level).
      const currentZoom = map.getZoom()
      const showRadii   = currentZoom >= 2

      const mapBounds = map.getBounds()
      const factor = 16
      const bx0 = Math.floor(mapBounds.getWest()   * factor)
      const bx1 = Math.ceil (mapBounds.getEast()   * factor)
      const bz0 = Math.floor(-mapBounds.getNorth() * factor)
      const bz1 = Math.ceil (-mapBounds.getSouth() * factor)

      const visibleStructures = new Set(
        [...enabledStructures].filter(s => currentZoom >= STRUCTURE_CONFIG[s].minZoom)
      )

      const mcVersion = MC_VERSIONS[selectedVersion]
      const worldFlags = worldType === 'large_biomes' ? 1 : 0
      const results = await queryStructures(
        BigInt(seed!), mcVersion, dimension, worldFlags,
        visibleStructures, bx0, bz0, bx1, bz1,
      )

      if (gen !== updateGenRef.current) return

      const wanted = new Set<string>()
      let batchCount = 0

      for (const { structType, pos } of results) {
        const cfg = STRUCTURE_CONFIG[structType]

        if (structType === 'stronghold' && (pos.x < bx0 || pos.x > bx1 || pos.z < bz0 || pos.z > bz1)) continue

        const key = `${structType}:${pos.x}:${pos.z}`

        if (dismissedRef.current.has(key)) continue

        wanted.add(key)

        const existing = pool.get(key)
        if (!existing) {
          const latlng  = blockCoordsToLatLng(pos.x, pos.z)
          const variant = pos.variantTag ? { tag: pos.variantTag, color: pos.variantColor ?? cfg.color } : null
          const color   = variant?.color ?? cfg.color
          const summary = (variant && cfg.variantSummary?.[variant.tag]) ?? cfg.summary
          const buildIcon = (badgesHTML = '') =>
            createMarkerIcon(structType, color, cfg.label, summary, variant, badgesHTML)
          const marker = L.marker(latlng, { icon: buildIcon() })
          attachMarkerContextMenu(marker, () => ({
            blockX: pos.x, blockZ: pos.z, blockY: null,
            kind:   'structure',
            label:  cfg.label + (variant ? ` (${variant.tag})` : ''),
            pinId:  null,
          }))
          const variantRow = variant
            ? `<div class="struct-variant-row">
                 <span class="struct-variant-pill" style="background:${variant.color}">${variant.tag}</span>
               </div>`
            : ''
          const pieceId = STRUCT_PIECE_ID[structType]
          const lootSection = pieceId != null
            ? `<div class="struct-loot" data-loot-key="${key}"><div class="struct-loot-loading">Loading loot…</div></div>`
            : ''
          marker.bindPopup(
            `<div class="popup-content">
              <div class="popup-title">${cfg.label}</div>
              ${variantRow}
              <div class="popup-coords">X: ${pos.x}, Z: ${pos.z}</div>
              ${lootSection}
              <label class="popup-dismiss">
                <input type="checkbox" data-dismiss-key="${key}"> Mark as useless
              </label>
            </div>`
          )

          let lootItems: api.LootItem[] | null = null

          // Chest kind per position (e.g. "shipwreck_treasure"), for structures
          // that get loot badges. Drives both the marker badges and the chest
          // headings in the loot popup. Fetched eagerly (cheap — no loot roll).
          let chestKindByPos: Map<string, string> | null = null
          const badgeSlots = STRUCT_BADGES[structType]
          if (badgeSlots && pieceId != null && slot != null && slot >= 0) {
            api.getStructureChests(slot, pieceId, pos.x, pos.z).then(chests => {
              if (!chests.length) return
              chestKindByPos = new Map(chests.map(c => [`${c.chestX},${c.chestZ}`, c.table]))
              marker.setIcon(buildIcon(badgeColumnHTML(badgeSlots, chests.map(c => c.table))))
            }).catch(() => {})
          }

          // Paint cached loot into the popup's loot div. Leaflet rebuilds the
          // popup DOM on every open, so this must run each time — not once.
          const renderLoot = () => {
            const div = marker.getPopup()?.getElement()
              ?.querySelector<HTMLElement>(`.struct-loot[data-loot-key="${CSS.escape(key)}"]`)
            if (!div || !lootItems) return
            if (!lootItems.length) { div.innerHTML = '<div class="struct-loot-empty">No chest loot</div>'; return }
            const byChest = new Map<string, api.LootItem[]>()
            for (const it of lootItems) {
              const k = `${it.chestX},${it.chestZ}`
              const arr = byChest.get(k); if (arr) arr.push(it); else byChest.set(k, [it])
            }
            let n = 0
            div.innerHTML = [...byChest.entries()].map(([posKey, its]) => {
              const table = chestKindByPos?.get(posKey)
              const heading = table ? chestKindLabel(table) : `Chest ${++n}`
              return `<div class="struct-loot-chest">${heading}</div>` +
                its.map(it => `<div class="struct-loot-row">${it.count}× ${it.item.replace('minecraft:', '').replace(/_/g, ' ')}</div>`).join('')
            }).join('')
          }

          marker.on('popupopen', () => {
            // Leaflet rebuilds the popup DOM from the bound string on every
            // open, wiping listeners — so re-attach the dismiss handler each
            // time, not once.
            const input = marker.getPopup()?.getElement()
              ?.querySelector<HTMLInputElement>(`input[data-dismiss-key="${CSS.escape(key)}"]`)
            input?.addEventListener('change', () => {
              if (!input.checked) return
              dismissedRef.current.add(key)
              saveDismissed(BigInt(seed!), dismissedRef.current)
              marker.closePopup()
              const e = pool.get(key)
              if (e) {
                group.removeLayer(e.marker)
                if (e.circle) group.removeLayer(e.circle)
                pool.delete(key)
              }
            })

            if (pieceId == null || slot == null || slot < 0) return

            // Chest loot — fetch once, then re-render on every open.
            if (lootItems) {
              renderLoot()
            } else {
              api.getStructureLoot(slot, pieceId, pos.x, pos.z, mcVersion).then(items => {
                lootItems = items
                renderLoot()
              }).catch(() => {})
            }
          })

          group.addLayer(marker)

          const entry: PoolEntry = { marker, structType }

          if (showRadii && cfg.spawnRadius) {
            const circle = L.circle(latlng, {
              radius: blockRadiusToLeaflet(cfg.spawnRadius),
              color: cfg.color,
              weight: 1,
              opacity: 0.35,
              fillOpacity: 0.05,
              interactive: false,
            })
            group.addLayer(circle)
            entry.circle = circle
          }

          pool.set(key, entry)
          if (++batchCount % 50 === 0) {
            await new Promise<void>(resolve => setTimeout(resolve, 0))
            if (gen !== updateGenRef.current) return
          }
        } else {
          // Marker already exists — just reconcile circle visibility with current zoom.
          if (showRadii && !existing.circle && cfg.spawnRadius) {
            const circle = L.circle(existing.marker.getLatLng(), {
              radius: blockRadiusToLeaflet(cfg.spawnRadius),
              color: cfg.color,
              weight: 1,
              opacity: 0.35,
              fillOpacity: 0.05,
              interactive: false,
            })
            group.addLayer(circle)
            existing.circle = circle
          } else if (!showRadii && existing.circle) {
            group.removeLayer(existing.circle)
            existing.circle = undefined
          }
        }
      }

      for (const [key, entry] of pool) {
        if (!wanted.has(key)) {
          group.removeLayer(entry.marker)
          if (entry.circle) group.removeLayer(entry.circle)
          pool.delete(key)
        }
      }
    }

    const cleanupListeners = setupDebouncedMapListeners(map, () => { void updateStructures() }, 200)
    void updateStructures()

    return () => {
      cleanupListeners()
      pool.forEach(entry => {
        group.removeLayer(entry.marker)
        if (entry.circle) group.removeLayer(entry.circle)
      })
      pool.clear()
    }
    // zoom intentionally omitted: read via map.getZoom() inside updateStructures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, slot, seed, dimension, selectedVersion, worldType, enabledStructures, showStructures, structureRevision])

  return null
}
export default memo(StructureLayer)
