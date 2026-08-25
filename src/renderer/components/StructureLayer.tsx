import { memo, useEffect, useRef } from 'react'
import L from 'leaflet'
import { tooltipText, type LayerStats, makeLayerStats, updateLayerStats } from '../lib/chunkMarkerLayer'
import { useApp } from '../App'
import { STRUCTURE_CONFIG, StructureType, structureVariantKey, getVariantDef } from '../lib/structureConfig'
import { queryStructures } from '../lib/structureQuery'
import { setupDebouncedMapListeners } from '../lib/mapListeners'
import { minecraftToLeaflet, lngToBlockX, latToBlockZ } from '../lib/tileCoords'
import { BASE_BLOCKS_PER_PIXEL } from '../lib/constants'
import { attachMarkerContextMenu } from '../lib/contextMenuBus'
import { loadDismissed, saveDismissed } from '../lib/dismissedStructures'
import * as api from '../lib/tauriAPI'
import { TileJobQueue } from '../lib/tileJobQueue'
import * as tileStats from '../lib/tileStats'

// Single-slot "queue" purely so an in-flight scan shows up in TileLoadingHud /
// DebugOverlay via the same registerOverlay mechanism the tile-queue layers use.
const loadQueue = new TileJobQueue(1, () => tileStats.notify(), 'structure')
tileStats.registerOverlay({ key: 'structure', label: 'Structures', className: 'structure', queues: [loadQueue], caches: [] })

// Module-level stats, read by DebugOverlay.
export type StructureLayerStats = LayerStats
let _stats: LayerStats = makeLayerStats()
export function getStructureLayerStats(): LayerStats { return { ..._stats } }
export function resetStructureLayerStats(): void { _stats = makeLayerStats() }

// Structure types with backend-generated pieces/loot (cubiomes StructureType enum ids);
// must match getStructurePieces in the cubiomes fork and have a loot table there.
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
  end_city:             21,
  abandoned_camp:       26,
  stronghold:           27,
}

// Fixed vertical column of loot-badge slots, one per chest kind; absent slots render
// as invisible spacers so present ones keep a stable position. `match` is a substring
// of the cubiomes loot-table name for that chest kind.
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
  // Whether a campsite piece rolls the secret chest (vs. a common chest) is per-instance,
  // not a fixed camp trait — this badge is the only way to tell without visiting.
  abandoned_camp: [
    { letter: 'H', match: 'secret', color: '#ffd700', title: 'Secret chest (diamond, potions, iron gear, copper/gold/iron ingots)' },
    { letter: 'C', match: 'common', color: '#9ca3af', title: 'Common chest (arrows, maps, bones, camp supplies)' },
    { letter: 'B', match: 'barrel', color: '#8b6423', title: 'Barrel' },
  ],
}

// Backs the "notable loot only" filter. Confirmed genuinely variable per-instance by
// survey (unlike Bastion/Fortress chest tables, excluded as cubiomes piece-sim artifacts).
// End City's ship shares its loot table name with tower chests, so it's keyed off isShip.
const NOTABLE_LOOT_CHECK: Partial<Record<StructureType, (chests: api.ChestSlot[]) => boolean>> = {
  shipwreck: chests => chests.some(c => c.table.includes('treasure')),
  abandoned_camp: chests => chests.some(c => c.table.includes('secret')),
  end_city: chests => chests.some(c => c.isShip),
}

function badgeColumnHTML(slots: BadgeSlot[], presentTables: string[]): string {
  const chips = slots.map(s => {
    const present = presentTables.some(t => t.includes(s.match))
    return present
      ? `<span class="sb-chip" style="background:${s.color}" title="${s.title}">${s.letter}</span>`
      : `<span class="sb-chip sb-empty"></span>`
  }).join('')
  return `<span class="struct-badges">${chips}</span>`
}

// e.g. "shipwreck_treasure" → "Treasure chest", "abandoned_camp_secret_chest" → "Secret
// chest". Strip a trailing "_chest"/"_barrel" suffix before taking the last segment, or
// names like abandoned_camp's would read as "Chest chest".
function chestKindLabel(table: string): string {
  if (table.endsWith('_barrel')) return 'Barrel'
  const base = table.endsWith('_chest') ? table.slice(0, -'_chest'.length) : table
  const kind = base.split('_').pop() ?? base
  return `${kind.charAt(0).toUpperCase()}${kind.slice(1)} chest`
}

// "night_vision" -> "Night Vision"
function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// Vanilla shows enchant levels as roman numerals (I-X covers every real max level);
// fall back to the plain number above that rather than guess unused numerals.
function toRoman(n: number): string {
  const table: [number, string][] =
    [[10,'X'],[9,'IX'],[8,'VIII'],[7,'VII'],[6,'VI'],[5,'V'],[4,'IV'],[3,'III'],[2,'II'],[1,'I']]
  for (const [v, sym] of table) if (n >= v) return sym
  return String(n)
}

function formatEnchantment(e: api.EnchantmentInfo): string {
  return `${titleCase(e.name)} ${e.level >= 1 && e.level <= 10 ? toRoman(e.level) : e.level}`
}

// e.g. "1× Potion of Healing"; enchanted items get a trailing "(Sharpness III, ...)" —
// both resolved from cubiomes' ItemStack (mob effect + enchantments), not just item id.
function formatLootItem(it: api.LootItem): string {
  let label = it.item.replace('minecraft:', '').replace(/_/g, ' ')
  if (it.potion) label += ` of ${titleCase(it.potion.replace('minecraft:', ''))}`
  const enchantSuffix = it.enchantments.length
    ? ` (${it.enchantments.map(formatEnchantment).join(', ')})`
    : ''
  return `${it.count}× ${label}${enchantSuffix}`
}

const VARIANT_ABBREV: Record<string, string> = {
  basement:    'B',
  zombie:      'Z',
  giant:       'G',
  underground: 'U',
  air_pocket:  'A',
  sealed:      'S',
}

// Returns the inner SVG shapes for a 20×20 viewBox. White fill/stroke unless noted.
function getStructureShapeHTML(type: StructureType): string {
  const W = 'fill="white"'
  const S = 'fill="none" stroke="white" stroke-linecap="round"'
  const D = 'fill="rgba(0,0,0,0.35)"'

  switch (type) {
    // Settlements
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

    // Pyramids / Temples
    case 'desert_temple':
      return `<polygon ${W} points="10,2 18,17 2,17"/>
              <rect ${D} x="8" y="12" width="4" height="5"/>`

    case 'jungle_temple':
      return `<polygon ${W} points="10,2 18,17 2,17"/>
              <rect ${D} x="6" y="10" width="8" height="7"/>
              <rect ${W} x="8" y="12" width="4" height="2"/>`

    // Towers / Outposts
    case 'outpost':
      return `<rect ${W} x="7" y="6" width="6" height="12"/>
              <rect ${W} x="4" y="3" width="4" height="6"/>
              <rect ${W} x="12" y="3" width="4" height="6"/>
              <rect ${W} x="4" y="3" width="12" height="2.5"/>`

    // Ocean structures
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

    // Underground
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

    // Surface world
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

    // Nether
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

    // End
    // A tall, slender, segmented spire on a wide base — distinct from Outpost's
    // stout tower-plus-pillars silhouette — capped with a small glowing tip.
    case 'end_city':
      return `<rect ${W} x="5" y="15.5" width="10" height="2.5"/>
              <rect ${W} x="8.3" y="2" width="3.4" height="14"/>
              <rect ${D} x="8.3" y="6.5" width="3.4" height="1.8"/>
              <rect ${D} x="8.3" y="10.5" width="3.4" height="1.8"/>
              <polygon ${W} points="10,0 11.5,2.6 8.5,2.6"/>`

    // A void ring framed by four floating obsidian ticks at the cardinal
    // points, echoing the pillars that ring a real End Gateway.
    case 'end_gateway':
      return `<rect ${W} x="9" y="0.3" width="2" height="2.6"/>
              <rect ${W} x="9" y="17.1" width="2" height="2.6"/>
              <rect ${W} x="0.3" y="9" width="2.6" height="2"/>
              <rect ${W} x="17.1" y="9" width="2.6" height="2"/>
              <circle ${S} stroke-width="2.2" cx="10" cy="10" r="6.2"/>
              <circle ${D} cx="10" cy="10" r="3.4"/>`

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
    html: `<div class="structure-marker" style="background:${color}" title="${title}" role="button" aria-label="${title}">
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

function StructureLayer({ map, slot }: { map: L.Map; slot: number | null }) {
  const { state, dispatch, generatorConfig } = useApp()
  const layerGroupRef = useRef<L.LayerGroup | null>(null)
  // Ref so the pool survives re-renders — zoom changes don't blow it away.
  const poolRef = useRef<Map<string, PoolEntry>>(new Map())
  // Incremented on every updateStructures call; stale results are discarded on mismatch.
  const updateGenRef = useRef(0)
  const dismissedRef = useRef<Set<string>>(new Set())
  // "Notable loot only" verdicts resolve asynchronously, after the marker already went into
  // pool/wanted for this scan — without remembering a non-qualifying key, every debounced
  // pan/zoom re-adds it and re-fetches forever. Persists per-seed; reset only on seed change.
  const notNotableRef = useRef<Set<string>>(new Set())
  const notNotableSeedRef = useRef<string | null>(null)
  // Separate layer for the 20 fixed End Gateway ring→destination pairs, independent of
  // the viewport-bounded candidate search below.
  const gatewayLinkGroupRef = useRef<L.LayerGroup | null>(null)

  const seed = state.seedData?.seed ?? null
  const { dimension, selectedVersion, worldType, enabledStructures, disabledStructureVariants, notableLootOnly, showStructures, structureRevision } = state

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
      _stats.lastCount = 0
      return
    }

    dismissedRef.current = loadDismissed(BigInt(seed))
    if (notNotableSeedRef.current !== seed) {
      notNotableRef.current = new Set()
      notNotableSeedRef.current = seed
    }

    const updateStructures = async () => {
      const gen = ++updateGenRef.current

      // Read zoom from the map directly so this stays current across pan/zoom without
      // needing zoom in the dep array (which would cause full pool teardown on every level).
      const currentZoom = map.getZoom()
      const showRadii   = currentZoom >= 2

      const mapBounds = map.getBounds()
      const bx0 = Math.floor(lngToBlockX(mapBounds.getWest()))
      const bx1 = Math.ceil (lngToBlockX(mapBounds.getEast()))
      const bz0 = Math.floor(latToBlockZ(mapBounds.getNorth()))
      const bz1 = Math.ceil (latToBlockZ(mapBounds.getSouth()))

      const visibleStructures = new Set(
        [...enabledStructures].filter(s => currentZoom >= STRUCTURE_CONFIG[s].minZoom)
      )

      const { seedBig, dimId, mcVersion, worldFlags } = generatorConfig
      const t0 = performance.now()
      const results = await queryStructures(
        BigInt(seed!), mcVersion, dimension, worldFlags,
        visibleStructures, bx0, bz0, bx1, bz1,
      )
      // Superseded scans (gen mismatch) don't reflect the current view — skip the
      // timing/count so a stale scan can't skew stats or overwrite a newer lastCount.
      if (gen === updateGenRef.current) {
        updateLayerStats(_stats, Math.round(performance.now() - t0), results.length)
      }

      if (gen !== updateGenRef.current) return

      const wanted = new Set<string>()
      let batchCount = 0

      for (const { structType, pos } of results) {
        const cfg = STRUCTURE_CONFIG[structType]

        if (structType === 'stronghold' && (pos.x < bx0 || pos.x > bx1 || pos.z < bz0 || pos.z > bz1)) continue

        if (disabledStructureVariants.has(structureVariantKey(structType, pos.variantTag ?? null))) continue

        const key = `${structType}:${pos.x}:${pos.z}`

        if (dismissedRef.current.has(key)) continue

        const notableCheck = NOTABLE_LOOT_CHECK[structType]
        const wantNotableOnly = notableCheck != null && notableLootOnly.has(structType)
        if (wantNotableOnly && notNotableRef.current.has(key)) continue

        wanted.add(key)

        const existing = pool.get(key)
        if (!existing) {
          const latlng  = blockCoordsToLatLng(pos.x, pos.z)
          const variant = pos.variantTag ? { tag: pos.variantTag, color: pos.variantColor ?? cfg.color } : null
          const color   = variant?.color ?? cfg.color
          const summary = (variant && getVariantDef(structType, variant.tag)?.summary) ?? cfg.summary
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
          // Each chest is its own collapsed <details>; Leaflet rebuilds the popup DOM
          // from this string on every open, so they stay collapsed on every reopen too.
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
            </div>`,
            // Leaflet only autoPans once, at open time, so a popup that grows after
            // opening (a <details> expanded) can overflow past the window edge with no
            // way back. maxHeight caps the popup itself (Leaflet adds its own scroll).
            { maxHeight: 420, autoPanPadding: [24, 24] }
          )

          let lootItems: api.LootItem[] | null = null

          // Chest kind per position, plus whether it's an End Ship chest — drives badges
          // and loot-popup headings. Fetched eagerly since it's cheap (no loot roll).
          let chestKindByPos: Map<string, { table: string; isShip: boolean }> | null = null
          const badgeSlots = STRUCT_BADGES[structType]
          const tracksShip = structType === 'end_city'
          if ((badgeSlots || tracksShip || wantNotableOnly) && pieceId != null && slot != null && slot >= 0) {
            api.getStructureChests(slot, seedBig, dimId, worldFlags, mcVersion, pieceId, pos.x, pos.z).then(chests => {
              // Pull the marker (and its circle) back out if it doesn't qualify — same
              // removal path as "mark as useless" — and remember the verdict so the
              // next scan skips this key instead of re-fetching chests forever.
              if (wantNotableOnly && !notableCheck!(chests)) {
                notNotableRef.current.add(key)
                group.removeLayer(marker)
                const entry = pool.get(key)
                if (entry?.circle) group.removeLayer(entry.circle)
                pool.delete(key)
                return
              }
              if (!chests.length) return
              chestKindByPos = new Map(chests.map(c => [`${c.chestX},${c.chestZ}`, { table: c.table, isShip: c.isShip }]))
              const badgesHTML = badgeSlots ? badgeColumnHTML(badgeSlots, chests.map(c => c.table)) : ''
              // End Ship chests share the "end_city_treasure" loot table with tower chests —
              // only the isShip flag (from the structure piece type) tells them apart.
              const shipHTML = chests.some(c => c.isShip)
                ? `<span class="structure-ship-badge" title="Has an End Ship — better odds of an Elytra">S</span>`
                : ''
              marker.setIcon(buildIcon(badgesHTML + shipHTML))
            }).catch(() => {})
          }

          // Paint cached loot into the popup: each chest listed up front, collapsed by
          // default. Leaflet rebuilds the popup DOM on every open, so this runs each time.
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
              const info = chestKindByPos?.get(posKey)
              const heading = info
                ? (info.isShip ? `End Ship — ${chestKindLabel(info.table)}` : chestKindLabel(info.table))
                : `Chest ${++n}`
              const itemCount = its.reduce((sum, it) => sum + it.count, 0)
              const rows = its.map(it => `<div class="struct-loot-row">${formatLootItem(it)}</div>`).join('')
              return `<details class="struct-chest-details">
                        <summary class="struct-chest-summary">${heading} <span class="struct-chest-count">(${itemCount} item${itemCount === 1 ? '' : 's'})</span></summary>
                        ${rows}
                      </details>`
            }).join('')
          }

          marker.on('popupopen', () => {
            // Leaflet rebuilds the popup DOM (wiping listeners) on every open — re-attach.
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
              // Bump the shared revision counter so the flyout's Dismissed list
              // (reads localStorage on its own schedule) picks this up immediately.
              dispatch({ type: 'CLEAR_STRUCTURE_CACHE' })
            })

            if (pieceId == null || slot == null || slot < 0) return

            // Chest loot — fetch once, then re-render on every open.
            if (lootItems) {
              renderLoot()
            } else {
              api.getStructureLoot(slot, seedBig, dimId, worldFlags, mcVersion, pieceId, pos.x, pos.z).then(items => {
                lootItems = items
                renderLoot()
              }).catch(err => {
                // A throw inside renderLoot() lands here too, not just IPC failures —
                // log it, or the popup silently freezes on "Loading loot…".
                console.error('Structure loot fetch/render failed:', err)
              })
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

      _stats.lastCount = wanted.size
    }

    const runUpdateStructures = () => {
      let released = false
      const release = () => { if (!released) { released = true; loadQueue.release() } }
      loadQueue.enqueue(0, () => {})
      updateStructures().finally(release)
    }

    const cleanupListeners = setupDebouncedMapListeners(map, runUpdateStructures, 200)
    runUpdateStructures()

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
  }, [map, slot, seed, dimension, selectedVersion, worldType, enabledStructures, disabledStructureVariants, notableLootOnly, showStructures, structureRevision])

  // The 20 fixed End Gateways ringing the main island, each linked to its deterministic
  // landing spot — known from the seed alone, so shown even before anyone generates it.
  // The candidate feature search above can't tell these apart from other viable sites,
  // so they're drawn as a separate, always-on overlay.
  useEffect(() => {
    if (!map) return
    if (!gatewayLinkGroupRef.current) {
      gatewayLinkGroupRef.current = L.layerGroup().addTo(map)
    }
    const group = gatewayLinkGroupRef.current
    group.clearLayers()

    if (!seed || !showStructures || dimension !== 'end') return
    if (!enabledStructures.has('end_gateway')) return
    if (slot == null || slot < 0) return

    let cancelled = false
    const { seedBig, dimId, worldFlags, mcVersion } = generatorConfig
    api.getEndGatewayLinks(slot, seedBig, dimId, worldFlags, mcVersion).then(links => {
      if (cancelled) return
      links.forEach((link, i) => {
        const srcLL = blockCoordsToLatLng(link.srcX, link.srcZ)
        const dstLL = blockCoordsToLatLng(link.dstX, link.dstZ)
        const n = i + 1

        L.polyline([srcLL, dstLL], {
          color: '#fbbf24', weight: 1.5, opacity: 0.5, dashArray: '4,5', interactive: false,
        }).addTo(group)

        L.circleMarker(srcLL, {
          radius: 5, color: '#fbbf24', weight: 2, fillColor: '#fef3c7', fillOpacity: 0.95,
        }).bindTooltip(`Exit Gateway ${n}/20`).bindPopup(
          `<div class="popup-content">
             <div class="popup-title">Exit Gateway ${n}/20</div>
             <div class="popup-coords">X: ${link.srcX}, Z: ${link.srcZ}</div>
             <div>Forms on the main island the first time the Ender Dragon is defeated.</div>
             <div>Links to X: ${link.dstX}, Z: ${link.dstZ}</div>
           </div>`
        ).addTo(group)

        L.circleMarker(dstLL, {
          radius: 4, color: '#fbbf24', weight: 1.5, fillColor: '#78350f', fillOpacity: 0.9, dashArray: '2,2',
        }).bindTooltip(`Landing site ${n}/20`).bindPopup(
          `<div class="popup-content">
             <div class="popup-title">Predicted landing site</div>
             <div class="popup-coords">X: ${link.dstX}, Z: ${link.dstZ}</div>
             <div>Where Exit Gateway ${n}/20 (X: ${link.srcX}, Z: ${link.srcZ}) leads. Not written to the save until a player actually steps through.</div>
           </div>`
        ).addTo(group)
      })
    }).catch(() => {})

    return () => { cancelled = true }
  }, [map, slot, seed, dimension, enabledStructures, showStructures, generatorConfig])

  return null
}
export default memo(StructureLayer)
