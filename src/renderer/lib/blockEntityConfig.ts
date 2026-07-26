import L from 'leaflet'
import { normalizeBEType, BE_TYPE_TO_GROUP, type BEFilterGroup } from './markerFilters'
import { tooltipText } from './chunkMarkerLayer'

// ── Types ─────────────────────────────────────────────────────────────────────

export type LootTier = 'S' | 'A' | 'B' | 'C'

export interface BEConfig {
  color: string
  initial: string
  label: string
}

// ── Loot tier display ─────────────────────────────────────────────────────────

export const TIER_COLOR: Record<LootTier, string> = { S: '#ffd700', A: '#f59e0b', B: '#9ca3af', C: '#6b7280' }
export const TIER_LABEL: Record<LootTier, string> = { S: '★★★ Exceptional', A: '★★ High', B: '★ Moderate', C: '◇ Common' }

// ── Helpers ───────────────────────────────────────────────────────────────────

export function formatLabel(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export function formatItemId(id: string): string {
  return id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export function formatLootTable(table: string): string {
  const name = table.split('/').pop() ?? table
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ── Group lookup ──────────────────────────────────────────────────────────────

export function getBEGroup(type: string): BEFilterGroup | undefined {
  return BE_TYPE_TO_GROUP[normalizeBEType(type)]
}

// ── Per-type display config ───────────────────────────────────────────────────

export function getBEConfig(be: BlockEntity): BEConfig | null {
  const type = be.type
  const group = getBEGroup(type)
  if (group === 'containers') {
    if (type.endsWith('shulker_box'))    return { color: '#9b59b6', initial: 'S', label: formatLabel(type) }
    if (type === 'barrel')               return { color: '#8b4513', initial: 'B', label: 'Barrel' }
    if (type === 'hopper')               return { color: '#6b7280', initial: 'H', label: 'Hopper' }
    if (type === 'dropper')              return { color: '#6b7280', initial: 'D', label: 'Dropper' }
    if (type === 'dispenser')            return { color: '#6b7280', initial: 'D', label: 'Dispenser' }
    // Copper Chest (26.3+): weathering-stage-specific label (e.g. "Waxed Oxidized
    // Copper Chest"), but one copper-toned color regardless of stage — matches the
    // copper block family's color convention (block_colors.rs renders all stages
    // the same way it renders other copper blocks: distinctly, not chest-brown).
    if (type.endsWith('copper_chest'))   return { color: '#c17b52', initial: 'C', label: formatLabel(type) }
    return { color: '#a0522d', initial: 'C', label: formatLabel(type) }
  }
  if (type === 'mob_spawner')            return { color: '#8b0000', initial: 'M', label: 'Spawner' }
  if (type === 'trial_spawner')          return { color: '#cc4400', initial: 'T', label: 'Trial Spawner' }
  if (group === 'signs')                 return { color: '#d4a017', initial: 'S', label: 'Sign' }
  // 'H' for Hive — 'B' is taken by Bell, and the two share this same
  // honey-amber color family, so the letter is the only thing telling them
  // apart at a glance.
  if (type === 'beehive' || type === 'bee_nest')
                                         return { color: '#f0a500', initial: 'H', label: formatLabel(type) }
  // Bell is usually POI-shadowed (see POI_SHADOWED_BE_TYPES in
  // BlockEntityLayer.tsx) — the marker actually shown comes from
  // meeting_point in poiConfig.ts, which must match this color.
  if (type === 'bell')                   return { color: '#4f46e5', initial: 'B', label: 'Bell' }
  if (type === 'lectern')                return { color: '#795548', initial: 'L', label: 'Lectern' }
  if (type === 'brewing_stand')          return { color: '#4a148c', initial: 'W', label: 'Brewing Stand' }
  if (type === 'blast_furnace')          return { color: '#bf360c', initial: 'A', label: 'Blast Furnace' }
  if (type === 'smoker')                 return { color: '#78909c', initial: 'K', label: 'Smoker' }
  if (type === 'beacon')                 return { color: '#00bcd4', initial: 'B', label: 'Beacon' }
  if (type === 'jukebox')                return { color: '#6a1b9a', initial: 'J', label: 'Jukebox' }
  if (type === 'conduit')                return { color: '#06b6d4', initial: 'C', label: 'Conduit' }
  if (type === 'furnace')                return { color: '#bf360c', initial: 'F', label: 'Furnace' }
  if (type === 'campfire' || type === 'soul_campfire')
                                         return { color: '#e64a19', initial: 'C', label: formatLabel(type) }
  if (type === 'decorated_pot')          return { color: '#c1440e', initial: 'P', label: 'Decorated Pot' }
  if (type === 'sculk_shrieker')         return { color: '#1b5e20', initial: 'W', label: 'Sculk Shrieker' }
  if (type === 'vault')                  return { color: '#ffd700', initial: 'V', label: 'Vault' }
  if (type === 'end_gateway')            return { color: '#1a0033', initial: 'G', label: 'End Gateway' }
  if (type === 'chiseled_bookshelf')     return { color: '#92400e', initial: 'B', label: 'Chiseled Bookshelf' }
  if (type === 'crafter')                return { color: '#475569', initial: 'C', label: 'Crafter' }
  if (type === 'suspicious_sand')        return { color: '#d4a96a', initial: 'S', label: 'Suspicious Sand' }
  if (type === 'suspicious_gravel')      return { color: '#9ca3af', initial: 'S', label: 'Suspicious Gravel' }
  if (type === 'banner' || type === 'wall_banner')
                                         return { color: '#be185d', initial: 'B', label: 'Banner' }
  if (group === 'decorative' && (type === 'skull' || type === 'player_head' || type === 'player_wall_head'))
                                         return { color: '#e2e8f0', initial: 'H', label: be.skullOwner ? `${be.skullOwner}'s Head` : 'Skull' }
  if (group === 'technical') {
    if (type === 'command_block')        return { color: '#f59e0b', initial: 'C', label: 'Command Block' }
    if (type === 'chain_command_block')  return { color: '#fbbf24', initial: 'C', label: 'Chain Command Block' }
    if (type === 'repeating_command_block') return { color: '#a78bfa', initial: 'C', label: 'Repeating Command Block' }
    if (type === 'structure_block')      return { color: '#7c3aed', initial: 'S', label: 'Structure Block' }
    if (type === 'jigsaw')               return { color: '#6d28d9', initial: 'J', label: 'Jigsaw Block' }
    return { color: '#64748b', initial: 'T', label: formatLabel(type) }
  }
  return null
}

// ── Popup ─────────────────────────────────────────────────────────────────────

function itemsHtml(items: BlockItem[]): string {
  if (!items.length) return '<div class="be-empty">Empty</div>'
  // Show every slot — containers are per-slot but in practice short (hoppers hold
  // 5, chests are rarely packed), so the old "…and N more" cutoff just hid detail.
  return items.map(i => {
    // "Potion" -> "Potion of Strong Healing" — resolved from the item's own
    // NBT (see item_potion in block_entity_reader.rs), not a loot prediction.
    const label = i.potion ? `${formatItemId(i.id)} of ${formatLabel(i.potion)}` : formatItemId(i.id)
    return `<div class="be-item"><span class="be-item-count">×${i.count}</span> ${label}</div>`
  }).join('')
}

export function buildPopup(be: BlockEntity, cfg: BEConfig): string {
  const type = be.type
  const group = getBEGroup(type)
  const header = `
    <div class="popup-content">
      <div class="popup-title">${cfg.label}</div>
      <div class="popup-coords">X: ${be.x}, Y: ${be.y}, Z: ${be.z}</div>`

  let body = ''

  if (group === 'containers') {
    if (be.lootTable) {
      const tier = (be.lootTier ?? 'B') as LootTier
      const tierColor = TIER_COLOR[tier]
      const tierLabel = TIER_LABEL[tier]
      body = `
        <div class="be-tier-row">
          <span class="be-tier-badge" style="background:${tierColor};color:${tier === 'B' || tier === 'C' ? '#fff' : '#000'}">${tier}</span>
          <span class="be-tier-label" style="color:${tierColor}">${tierLabel}</span>
        </div>
        <div class="be-detail be-unopened">Unopened chest</div>
        <div class="be-loot-table">${formatLootTable(be.lootTable)}</div>`
    } else if (be.items !== undefined) {
      body = `<div class="be-section"><div class="be-section-label">Contents</div>${itemsHtml(be.items)}</div>`
    }
  }

  if (be.type === 'mob_spawner' && be.spawnType) {
    body = `<div class="be-detail">Spawns: <b>${formatItemId(be.spawnType)}</b></div>`
  }

  if (be.type === 'trial_spawner') {
    const mob = be.spawnType ? `<div class="be-detail">Spawns: <b>${formatItemId(be.spawnType)}</b></div>` : ''
    const ominous = be.isOminous ? `<div class="be-detail be-warning">Ominous</div>` : ''
    body = mob + ominous
  }

  if (group === 'signs') {
    const front = be.frontText?.join('<br>') ?? ''
    const back  = be.backText?.join('<br>') ?? ''
    body = front ? `<div class="be-sign-text">${front}</div>` : ''
    if (back) body += `<div class="be-sign-text be-sign-back">${back}</div>`
    if (!body) body = '<div class="be-empty">Blank sign</div>'
  }

  if (be.type === 'beehive' || be.type === 'bee_nest') {
    const honey = '🍯'.repeat(be.honeyLevel ?? 0) || 'None'
    body = `<div class="be-detail">Honey: <b>${be.honeyLevel ?? 0}/5</b> ${honey}</div>`
    if (be.beeCount) body += `<div class="be-detail">Bees inside: <b>${be.beeCount}</b></div>`
  }

  if (be.type === 'beacon') {
    const p = be.primaryEffect ?? 'None'
    const s = be.secondaryEffect ?? 'None'
    body = `<div class="be-detail">Primary: <b>${p}</b></div>`
    if (be.secondaryEffect) body += `<div class="be-detail">Secondary: <b>${s}</b></div>`
  }

  if (be.type === 'jukebox' && be.discId) {
    body = `<div class="be-detail">Disc: <b>${formatItemId(be.discId)}</b></div>`
  }

  if (be.type === 'lectern') {
    if (be.bookTitle) body = `<div class="be-detail">Book: <b>${be.bookTitle}</b></div>`
    if (be.bookAuthor) body += `<div class="be-detail">by ${be.bookAuthor}</div>`
    if (!body) body = '<div class="be-empty">No book</div>'
  }

  if (be.type === 'brewing_stand' && be.ingredients !== undefined) {
    body = `<div class="be-section"><div class="be-section-label">Contents</div>${itemsHtml(be.ingredients)}</div>`
  }

  if (type === 'furnace' || type === 'blast_furnace' || type === 'smoker') {
    body = be.cookingItem
      ? `<div class="be-detail">Cooking: <b>${formatItemId(be.cookingItem)}</b></div>`
      : '<div class="be-empty">Idle</div>'
  }

  if ((be.type === 'campfire' || be.type === 'soul_campfire') && be.cookingItems !== undefined) {
    body = be.cookingItems.length
      ? `<div class="be-section">${be.cookingItems.map(i => `<div class="be-item">${formatItemId(i)}</div>`).join('')}</div>`
      : '<div class="be-empty">Empty</div>'
  }

  if (be.type === 'decorated_pot' && be.sherds?.length) {
    const faces = ['North', 'East', 'South', 'West']
    body = `<div class="be-section">${be.sherds.map((s, i) =>
      `<div class="be-detail">${faces[i] ?? i}: <b>${formatItemId(s)}</b></div>`
    ).join('')}</div>`
  }

  if (be.type === 'sculk_shrieker') {
    body = be.canSummon
      ? '<div class="be-detail be-warning">Can summon Warden</div>'
      : '<div class="be-detail">Cannot summon Warden</div>'
  }

  if (be.type === 'vault') {
    body = be.lootTable
      ? `<div class="be-detail">Loot: <b>${formatItemId(be.lootTable)}</b></div>`
      : ''
  }

  if (be.type === 'end_gateway') {
    body = be.exitPortal
      ? `<div class="be-detail">Exit: <b>X: ${be.exitPortal.x}, Y: ${be.exitPortal.y}, Z: ${be.exitPortal.z}</b></div>`
      : '<div class="be-empty">Exit portal not yet linked</div>'
  }

  if (be.type === 'chiseled_bookshelf') {
    body = be.items?.length
      ? `<div class="be-section"><div class="be-section-label">Books (${be.items.length}/6)</div>${itemsHtml(be.items)}</div>`
      : '<div class="be-empty">Empty</div>'
  }

  if (be.type === 'crafter') {
    body = be.items?.length
      ? `<div class="be-section"><div class="be-section-label">Grid (${be.items.length} items)</div>${itemsHtml(be.items)}</div>`
      : '<div class="be-empty">Empty</div>'
  }

  if (be.type === 'suspicious_sand' || be.type === 'suspicious_gravel') {
    if (be.lootTable) {
      body = `<div class="be-detail be-unopened">Unexcavated</div><div class="be-loot-table">${formatLootTable(be.lootTable)}</div>`
    } else if (be.suspiciousItem) {
      body = `<div class="be-detail">Contains: <b>${formatItemId(be.suspiciousItem)}</b></div>`
    } else {
      body = '<div class="be-empty">Already excavated</div>'
    }
  }

  if (be.type === 'banner' || be.type === 'wall_banner') {
    const color = be.bannerColor ? `<div class="be-detail">Color: <b>${formatItemId(be.bannerColor)}</b></div>` : ''
    const patterns = be.bannerPatterns?.length
      ? `<div class="be-section-label">Patterns (${be.bannerPatterns.length})</div>` +
        be.bannerPatterns.map(p =>
          `<div class="be-detail"><span style="color:#9ca3af">${formatItemId(p.color)}</span> ${p.pattern}</div>`
        ).join('')
      : '<div class="be-muted">No patterns</div>'
    body = color + patterns
  }

  if (group === 'decorative' && (be.type === 'skull' || be.type === 'player_head' || be.type === 'player_wall_head')) {
    body = be.skullOwner
      ? `<div class="be-detail">Owner: <b>${be.skullOwner}</b></div>`
      : '<div class="be-empty">No owner</div>'
  }

  return header + body + '</div>'
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

export function buildTooltip(be: BlockEntity, cfg: BEConfig, unopened: boolean, tier: LootTier): string {
  const group = getBEGroup(be.type)
  if (unopened)
    return tooltipText(cfg.label, 'Unopened', TIER_LABEL[tier], be.lootTable ? formatLootTable(be.lootTable) : null)
  if (group === 'containers' && be.items !== undefined)
    return tooltipText(cfg.label, `${be.items.length} item${be.items.length !== 1 ? 's' : ''}`)
  if (group === 'signs' && be.frontText?.length)
    return tooltipText(cfg.label, be.frontText.join(' / '))

  switch (be.type) {
    case 'mob_spawner':
      return tooltipText(cfg.label, be.spawnType ? `Spawns ${formatItemId(be.spawnType)}` : null)
    case 'trial_spawner':
      return tooltipText(cfg.label, be.spawnType ? `Spawns ${formatItemId(be.spawnType)}` : null, be.isOminous ? 'Ominous' : null)
    case 'beehive':
    case 'bee_nest': {
      const honey = be.honeyLevel ?? 0
      return tooltipText(cfg.label, `Honey ${honey}/5`, be.beeCount ? `${be.beeCount} bee${be.beeCount !== 1 ? 's' : ''}` : null)
    }
    case 'beacon':
      return tooltipText(cfg.label, be.primaryEffect ?? 'No effect')
    case 'jukebox':
      return tooltipText(cfg.label, be.discId ? formatItemId(be.discId) : null)
    case 'lectern':
      return tooltipText(cfg.label, be.bookTitle ?? 'No book')
    case 'sculk_shrieker':
      return tooltipText(cfg.label, be.canSummon ? 'Can summon Warden' : 'Cannot summon Warden')
    case 'end_gateway':
      return tooltipText(cfg.label, be.exitPortal ? `→ X:${be.exitPortal.x} Y:${be.exitPortal.y} Z:${be.exitPortal.z}` : null)
    case 'chiseled_bookshelf':
      return tooltipText(cfg.label, be.items?.length ? `${be.items.length}/6 books` : 'Empty')
    case 'crafter':
      return tooltipText(cfg.label, be.items?.length ? `${be.items.length} items` : 'Empty')
    case 'suspicious_sand':
    case 'suspicious_gravel':
      if (be.lootTable)      return tooltipText(cfg.label, 'Unexcavated')
      if (be.suspiciousItem) return tooltipText(cfg.label, formatItemId(be.suspiciousItem))
      return tooltipText(cfg.label, 'Excavated')
    case 'banner':
    case 'wall_banner':
      return tooltipText(cfg.label, be.bannerColor ? formatItemId(be.bannerColor) : null, be.bannerPatterns?.length ? `${be.bannerPatterns.length} pattern${be.bannerPatterns.length !== 1 ? 's' : ''}` : null)
    default:
      return cfg.label
  }
}

// ── Icon ──────────────────────────────────────────────────────────────────────

export function createIcon(cfg: BEConfig, tooltip: string, unopened = false, tier: LootTier = 'B'): L.DivIcon {
  const tierColor = TIER_COLOR[tier]
  const borderColor = unopened ? tierColor : 'rgba(255,255,255,0.7)'
  const style = unopened
    ? `background:${cfg.color};opacity:0.7;border-style:dashed;border-color:${borderColor}`
    : `background:${cfg.color}`
  const badge = unopened
    ? `<span class="be-marker-badge" style="background:${tierColor}">${tier}</span>`
    : ''
  return L.divIcon({
    className: '',
    html: `<div class="be-marker" style="${style}" title="${tooltip}">${cfg.initial}${badge}</div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  })
}
