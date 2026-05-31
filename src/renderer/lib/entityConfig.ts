import L from 'leaflet'
import { tooltipText } from './chunkMarkerLayer'

// ── Types & config tables ─────────────────────────────────────────────────────

export interface EntityConfig {
  color: string
  initial: string
  label: string
}

export const PROFESSION_CONFIG: Record<string, EntityConfig> = {
  farmer:        { color: '#4caf50', initial: 'F', label: 'Farmer' },
  fisherman:     { color: '#0288d1', initial: 'F', label: 'Fisherman' },
  shepherd:      { color: '#a5d6a7', initial: 'S', label: 'Shepherd' },
  fletcher:      { color: '#8bc34a', initial: 'F', label: 'Fletcher' },
  cleric:        { color: '#7b1fa2', initial: 'C', label: 'Cleric' },
  weaponsmith:   { color: '#e64a19', initial: 'W', label: 'Weaponsmith' },
  armorer:       { color: '#b71c1c', initial: 'A', label: 'Armorer' },
  toolsmith:     { color: '#f57c00', initial: 'T', label: 'Toolsmith' },
  librarian:     { color: '#795548', initial: 'L', label: 'Librarian' },
  cartographer:  { color: '#00897b', initial: 'C', label: 'Cartographer' },
  leatherworker: { color: '#a1887f', initial: 'L', label: 'Leatherworker' },
  butcher:       { color: '#546e7a', initial: 'B', label: 'Butcher' },
  mason:         { color: '#78909c', initial: 'M', label: 'Mason' },
  nitwit:        { color: '#66bb6a', initial: 'N', label: 'Nitwit' },
}

export const ENTITY_CONFIG: Record<string, EntityConfig> = {
  villager:         { color: '#3b82f6', initial: 'V', label: 'Villager' },
  wandering_trader: { color: '#06b6d4', initial: 'T', label: 'Wandering Trader' },
  painting:         { color: '#92400e', initial: 'P', label: 'Painting' },
  item_frame:       { color: '#78716c', initial: 'F', label: 'Item Frame' },
  glow_item_frame:  { color: '#a3e635', initial: 'F', label: 'Glow Item Frame' },
  armor_stand:      { color: '#6b7280', initial: 'A', label: 'Armor Stand' },
  horse:            { color: '#d97706', initial: 'H', label: 'Horse' },
  donkey:           { color: '#a16207', initial: 'D', label: 'Donkey' },
  mule:             { color: '#7c3aed', initial: 'M', label: 'Mule' },
  zombie_horse:     { color: '#15803d', initial: 'H', label: 'Zombie Horse' },
  skeleton_horse:   { color: '#e5e7eb', initial: 'H', label: 'Skeleton Horse' },
  llama:            { color: '#f5f0e8', initial: 'L', label: 'Llama' },
  trader_llama:     { color: '#0ea5e9', initial: 'L', label: 'Trader Llama' },
  camel:            { color: '#c2853a', initial: 'C', label: 'Camel' },
  ender_dragon:     { color: '#7e22ce', initial: 'D', label: 'Ender Dragon' },
  elder_guardian:   { color: '#0369a1', initial: 'G', label: 'Elder Guardian' },
  warden:           { color: '#052e16', initial: 'W', label: 'Warden' },
  wither:           { color: '#1c1c1c', initial: 'W', label: 'Wither' },
  chest_minecart:   { color: '#a0522d', initial: 'C', label: 'Chest Minecart' },
  hopper_minecart:  { color: '#6b7280', initial: 'H', label: 'Hopper Minecart' },
  chest_boat:       { color: '#8b6914', initial: 'C', label: 'Chest Boat' },
  wolf:             { color: '#94a3b8', initial: 'W', label: 'Wolf' },
  cat:              { color: '#fb923c', initial: 'C', label: 'Cat' },
  parrot:           { color: '#22c55e', initial: 'P', label: 'Parrot' },
  allay:            { color: '#7dd3fc', initial: 'A', label: 'Allay' },
  pig:              { color: '#f9a8d4', initial: 'P', label: 'Pig' },
  strider:          { color: '#dc2626', initial: 'S', label: 'Strider' },
  goat:             { color: '#d4d4aa', initial: 'G', label: 'Goat' },
  axolotl:          { color: '#f0abfc', initial: 'X', label: 'Axolotl' },
  iron_golem:       { color: '#b0bec5', initial: 'I', label: 'Iron Golem' },
  cow:              { color: '#78350f', initial: 'C', label: 'Cow' },
  chicken:          { color: '#fef9c3', initial: 'C', label: 'Chicken' },
  sheep:            { color: '#e5e7eb', initial: 'S', label: 'Sheep' },
  mooshroom:        { color: '#dc2626', initial: 'M', label: 'Mooshroom' },
  rabbit:           { color: '#d97706', initial: 'R', label: 'Rabbit' },
  frog:             { color: '#16a34a', initial: 'F', label: 'Frog' },
  turtle:           { color: '#15803d', initial: 'T', label: 'Turtle' },
  sniffer:          { color: '#b45309', initial: 'S', label: 'Sniffer' },
  armadillo:        { color: '#92400e', initial: 'A', label: 'Armadillo' },
  zombie_villager:  { color: '#4d7a3a', initial: 'Z', label: 'Zombie Villager' },
  fox:              { color: '#e8720c', initial: 'F', label: 'Fox' },
  panda:            { color: '#1e1e1e', initial: 'P', label: 'Panda' },
  bee:              { color: '#f5c518', initial: 'B', label: 'Bee' },
  tropical_fish:    { color: '#f97316', initial: 'F', label: 'Tropical Fish' },
  salmon:           { color: '#e05c3a', initial: 'S', label: 'Salmon' },
  cod:              { color: '#c8a064', initial: 'C', label: 'Cod' },
  shulker:          { color: '#9b59b6', initial: 'S', label: 'Shulker' },
  snow_golem:       { color: '#bfdbfe', initial: 'S', label: 'Snow Golem' },
  phantom:          { color: '#4c1d95', initial: 'P', label: 'Phantom' },
  end_crystal:      { color: '#e879f9', initial: 'E', label: 'End Crystal' },
  copper_golem:     { color: '#cf8344', initial: 'C', label: 'Copper Golem' },
  happy_ghast:      { color: '#94d9f5', initial: 'G', label: 'Happy Ghast' },
  creaking:         { color: '#5a4a3a', initial: 'C', label: 'Creaking' },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function formatId(id: string): string {
  return id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export function formatItem(item: EntityItem): string {
  const base  = formatId(item.id)
  const count = item.count > 1 ? `×${item.count} ` : ''
  const ench  = item.enchantment ? ` <span class="entity-enchant">[${item.enchantment}]</span>` : ''
  return `${count}${base}${ench}`
}

const DRAGON_PHASES = [
  'Circling', 'Strafing', 'Fly to Portal', 'Land on Portal',
  'Leave Portal', 'Breath Attack', 'Looking for Target',
  'Roar', 'Charge', 'Dying', 'Hovering',
]

interface VillagerLevelData { label: string; color: string; badge: string }

// Index matches villager level (1–5). Stars mirror the loot-tier pattern.
const VILLAGER_LEVEL_DATA: (VillagerLevelData | null)[] = [
  null,
  { label: '◇ Novice',      color: '#6b7280', badge: '1' },
  { label: '★ Apprentice',  color: '#9ca3af', badge: '2' },
  { label: '★★ Journeyman', color: '#f59e0b', badge: '3' },
  { label: '★★★ Expert',    color: '#d97706', badge: '4' },
  { label: '★★★★ Master',   color: '#ffd700', badge: '5' },
]

export function getVillagerLevelData(level: number | undefined): VillagerLevelData | null {
  if (!level || level < 1 || level > 5) return null
  return VILLAGER_LEVEL_DATA[level] ?? null
}

// ── Horse ratings ─────────────────────────────────────────────────────────────

export interface HorseRatingData { label: string; color: string; badge: string }

// Speed thresholds in bps (attr_to_speed = attr * 43.178, range ~4.9–14.6 bps).
// Jump thresholds in blocks (jump_strength_to_height, range ~1.3–5.5 blocks).
const SPEED_TIERS: { min: number; label: string; color: string }[] = [
  { min: 13.0, label: '★★★★ Elite',   color: '#ffd700' },
  { min: 11.0, label: '★★★ Great',    color: '#d97706' },
  { min:  9.0, label: '★★ Good',      color: '#f59e0b' },
  { min:  7.0, label: '★ Fair',       color: '#9ca3af' },
  { min:  0,   label: '◇ Slow',       color: '#6b7280' },
]

const JUMP_TIERS: { min: number; label: string; color: string }[] = [
  { min: 5.0, label: '★★★★ Elite',   color: '#ffd700' },
  { min: 4.0, label: '★★★ Great',    color: '#d97706' },
  { min: 3.0, label: '★★ Good',      color: '#f59e0b' },
  { min: 2.0, label: '★ Fair',       color: '#9ca3af' },
  { min: 0,   label: '◇ Low',        color: '#6b7280' },
]

function tierFor(value: number, tiers: typeof SPEED_TIERS): HorseRatingData {
  for (let i = 0; i < tiers.length; i++) {
    if (value >= tiers[i].min) {
      return { label: tiers[i].label, color: tiers[i].color, badge: String(tiers.length - i) }
    }
  }
  return { label: tiers[tiers.length - 1].label, color: tiers[tiers.length - 1].color, badge: '1' }
}

export function getHorseRatings(e: GameEntity): { speed: HorseRatingData | null; jump: HorseRatingData | null } {
  return {
    speed: e.speed      != null ? tierFor(e.speed,      SPEED_TIERS) : null,
    jump:  e.jumpHeight != null ? tierFor(e.jumpHeight, JUMP_TIERS)  : null,
  }
}

// ── Config lookup ─────────────────────────────────────────────────────────────

const OXIDATION_COLORS = ['#cf8344', '#b08a6a', '#7aad8e', '#4a9e89'] as const
const OXIDATION_LABELS = ['Copper', 'Exposed', 'Weathered', 'Oxidized'] as const

export function getConfig(e: GameEntity): EntityConfig {
  if (e.type === 'villager' || e.type === 'zombie_villager') {
    const profCfg = e.villagerProfession ? PROFESSION_CONFIG[e.villagerProfession] : undefined
    if (profCfg) {
      if (e.type === 'zombie_villager') return { ...profCfg, label: `Zombie ${profCfg.label}` }
      return profCfg
    }
  }
  if (e.type === 'copper_golem') {
    const level  = e.oxidationLevel ?? 0
    const color  = OXIDATION_COLORS[level] ?? '#cf8344'
    const ox     = OXIDATION_LABELS[level] ?? 'Copper'
    const label  = e.isWaxed ? `Waxed ${ox} Golem` : `${ox} Golem`
    return { color, initial: 'C', label }
  }
  if (ENTITY_CONFIG[e.type]) return ENTITY_CONFIG[e.type]
  const initial = (e.customName ?? e.type).charAt(0).toUpperCase()
  return { color: '#f97316', initial, label: formatId(e.type) }
}

// ── Popup ─────────────────────────────────────────────────────────────────────

function tradeRow(trade: VillagerTrade): string {
  const buy  = formatItem(trade.buy)
  const buyB = trade.buyB ? ` + ${formatItem(trade.buyB)}` : ''
  const sell = formatItem(trade.sell)
  const uses = trade.maxUses > 0
    ? `<span class="entity-trade-uses">${trade.uses}/${trade.maxUses}</span>`
    : ''
  return `<div class="entity-trade-row">${buy}${buyB} → ${sell} ${uses}</div>`
}

function horseTierRow(label: string, rating: HorseRatingData, value: string | null): string {
  const textColor = rating.badge <= '2' ? '#fff' : '#000'
  const val = value ? `<span class="horse-tier-value">${value}</span>` : ''
  return `
    <div class="be-tier-row">
      <span class="be-tier-badge" style="background:${rating.color};color:${textColor}">${rating.badge}</span>
      <span class="be-tier-label" style="color:${rating.color}">${label}: ${rating.label}</span>
      ${val}
    </div>`
}

export function buildPopup(e: GameEntity): string {
  const cfg      = getConfig(e)
  const title    = e.customName ? `"${e.customName}"` : cfg.label
  const subtitle = e.customName ? `<div class="entity-subtitle">${cfg.label}</div>` : ''

  let body = ''

  if (e.type === 'villager' || e.type === 'wandering_trader') {
    const levelData = getVillagerLevelData(e.villagerLevel)
    if (levelData) {
      const textColor = e.villagerLevel! <= 2 ? '#fff' : '#000'
      body += `
        <div class="be-tier-row">
          <span class="be-tier-badge" style="background:${levelData.color};color:${textColor}">${levelData.badge}</span>
          <span class="be-tier-label" style="color:${levelData.color}">${levelData.label}</span>
        </div>`
    }
    const knownProf = e.villagerProfession && PROFESSION_CONFIG[e.villagerProfession]
    const prof  = knownProf ? null : (e.villagerProfession ? formatId(e.villagerProfession) : 'Unemployed')
    const biome = e.villagerType ? formatId(e.villagerType) : ''
    const detail = [prof, biome].filter(Boolean).join(' · ')
    if (detail) body += `<div class="entity-detail">${detail}</div>`
    if (e.trades?.length) {
      body += `<div class="entity-section-label">Trades (${e.trades.length})</div>`
      body += `<div class="entity-trades">${e.trades.map(tradeRow).join('')}</div>`
    }
  }

  if (e.type === 'painting') {
    body = e.paintingVariant
      ? `<div class="entity-detail">${formatId(e.paintingVariant)}</div>`
      : '<div class="entity-muted">Unknown variant</div>'
  }

  if (e.type === 'item_frame' || e.type === 'glow_item_frame') {
    const item = e.frameItem ? formatId(e.frameItem) : 'empty'
    const ench = e.frameItemEnchantment ? ` <span class="entity-enchant">[${e.frameItemEnchantment}]</span>` : ''
    const rot  = e.frameRotation != null ? ` · ${e.frameRotation * 45}°` : ''
    body = `<div class="entity-detail">${item}${ench}${rot}</div>`
  }

  if (e.type === 'armor_stand') {
    const armorSlots = ['Boots', 'Leggings', 'Chestplate', 'Helmet']
    const armor = (e.armorItems ?? []).map((item, i) =>
      item.id ? `<div class="entity-detail">${armorSlots[i]}: ${formatItem(item)}</div>` : ''
    ).join('')
    const handSlots = ['Hand', 'Offhand']
    const hands = (e.handItems ?? []).map((item, i) =>
      item.id ? `<div class="entity-detail">${handSlots[i]}: ${formatItem(item)}</div>` : ''
    ).join('')
    body = armor + hands
    if (!body) body = '<div class="entity-muted">No equipment</div>'
    if (e.armorStandInvisible) body += '<div class="entity-muted">Invisible</div>'
  }

  if (e.type === 'horse') {
    const { speed: spdRating, jump: jmpRating } = getHorseRatings(e)
    const variant = e.horseVariant ? `<div class="entity-detail">${e.horseVariant}</div>` : ''
    const tamed   = e.tamed ? '<div class="entity-detail">Tamed</div>' : '<div class="entity-muted">Wild</div>'
    const saddle  = e.saddled ? '<div class="entity-detail">Saddled</div>' : ''
    const armor   = e.horseArmor ? `<div class="entity-detail">Armor: ${formatId(e.horseArmor)}</div>` : ''
    const spdRow  = spdRating ? horseTierRow('Speed', spdRating, e.speed != null ? `${e.speed} bps` : null) : ''
    const jmpRow  = jmpRating ? horseTierRow('Jump',  jmpRating, e.jumpHeight != null ? `${e.jumpHeight} blk` : null) : ''
    body = variant + tamed + saddle + armor + spdRow + jmpRow
  }

  if (e.type === 'donkey' || e.type === 'mule' || e.type === 'zombie_horse' || e.type === 'skeleton_horse') {
    body = e.tamed ? '<div class="entity-detail">Tamed</div>' : '<div class="entity-muted">Wild</div>'
    if (e.speed != null) body += `<div class="entity-detail">Speed: ${e.speed} bps</div>`
    if (e.chestItems?.length) {
      body += `<div class="entity-section-label">Chest</div>`
      body += e.chestItems.map(i => `<div class="entity-detail">${formatItem(i)}</div>`).join('')
    }
  }

  if (e.type === 'camel') {
    body = e.saddled ? '<div class="entity-detail">Saddled</div>' : '<div class="entity-muted">No saddle</div>'
    if (e.speed != null) body += `<div class="entity-detail">Speed: ${e.speed} bps</div>`
  }

  if (e.type === 'llama' || e.type === 'trader_llama') {
    body = e.llamaVariant ? `<div class="entity-detail">${e.llamaVariant}</div>` : ''
    body += e.tamed ? '<div class="entity-detail">Tamed</div>' : '<div class="entity-muted">Wild</div>'
    if (e.llamaStrength) body += `<div class="entity-detail">Strength: ${e.llamaStrength} (${e.llamaStrength * 3} slots)</div>`
    if (e.llamaDecor)    body += `<div class="entity-detail">Carpet: ${formatId(e.llamaDecor)}</div>`
    if (e.speed != null) body += `<div class="entity-detail">Speed: ${e.speed} bps</div>`
    if (e.chestItems?.length) {
      body += `<div class="entity-section-label">Chest</div>`
      body += e.chestItems.map(i => `<div class="entity-detail">${formatItem(i)}</div>`).join('')
    }
  }

  if (e.type === 'ender_dragon') {
    const hp    = e.dragonHealth != null ? `<div class="entity-detail">Health: ${Math.round(e.dragonHealth)}/200</div>` : ''
    const phase = e.dragonPhase  != null ? `<div class="entity-detail">Phase: ${DRAGON_PHASES[e.dragonPhase] ?? e.dragonPhase}</div>` : ''
    body = hp + phase
  }

  if (e.type === 'wither') {
    body = e.witherHealth != null
      ? `<div class="entity-detail">Health: ${Math.round(e.witherHealth)}/300</div>`
      : ''
  }

  if (e.type === 'elder_guardian') {
    body = '<div class="entity-muted">Infects nearby players with Mining Fatigue</div>'
  }

  if (e.type === 'warden') {
    body = '<div class="entity-detail entity-warning">Avoid making sounds nearby</div>'
  }

  if (e.type === 'parrot') {
    const variant = e.petVariant ? `<div class="entity-detail">${formatId(e.petVariant)}</div>` : ''
    const tamed   = e.tamed ? '<div class="entity-detail">Tamed</div>' : '<div class="entity-muted">Wild</div>'
    body = variant + tamed
  }

  if (e.type === 'pig') {
    const variant = e.petVariant ? `<div class="entity-detail">${formatId(e.petVariant)}</div>` : ''
    body = variant + (e.saddled ? '<div class="entity-detail">Saddled</div>' : '')
  }

  if (e.type === 'cow') {
    body = e.petVariant ? `<div class="entity-detail">${formatId(e.petVariant)}</div>` : ''
  }

  if (e.type === 'turtle' || e.type === 'sniffer') {
    body = ''
  }

  if (e.type === 'chicken') {
    body = e.petVariant ? `<div class="entity-detail">${formatId(e.petVariant)}</div>` : ''
  }

  if (e.type === 'sheep') {
    const color   = e.petVariant ? `<div class="entity-detail">Wool: ${formatId(e.petVariant)}</div>` : ''
    const sheared = e.isScreaming ? '<div class="entity-muted">Sheared</div>' : ''
    body = color + sheared
  }

  if (e.type === 'mooshroom') {
    body = e.petVariant ? `<div class="entity-detail">${formatId(e.petVariant)}</div>` : ''
  }

  if (e.type === 'rabbit') {
    const v = e.petVariant
    body = v ? `<div class="entity-detail">${formatId(v)}${v === 'killer' ? ' <span class="entity-enchant">[Killer Bunny]</span>' : ''}</div>` : ''
  }

  if (e.type === 'frog') {
    body = e.petVariant ? `<div class="entity-detail">${formatId(e.petVariant)}</div>` : ''
  }

  if (e.type === 'armadillo') {
    body = e.petVariant ? `<div class="entity-detail">State: ${formatId(e.petVariant)}</div>` : ''
  }

  if (e.type === 'strider') {
    body = e.saddled ? '<div class="entity-detail">Saddled</div>' : '<div class="entity-muted">No saddle</div>'
  }

  if (e.type === 'goat') {
    body = e.isScreaming
      ? '<div class="entity-detail entity-warning">Screaming Goat</div>'
      : '<div class="entity-detail">Normal Goat</div>'
  }

  if (e.type === 'axolotl') {
    body = e.petVariant
      ? `<div class="entity-detail">${formatId(e.petVariant)}${e.petVariant === 'blue' ? ' <span class="entity-enchant">[Rare]</span>' : ''}</div>`
      : ''
  }

  if (e.type === 'iron_golem') {
    body = e.isPlayerCreated
      ? '<div class="entity-detail">Player built</div>'
      : '<div class="entity-muted">Village spawned</div>'
  }

  if (e.type === 'zombie_villager') {
    const converting = (e.conversionTime ?? -1) > 0
    const levelData  = getVillagerLevelData(e.villagerLevel)
    if (levelData) {
      const textColor = e.villagerLevel! <= 2 ? '#fff' : '#000'
      body += `
        <div class="be-tier-row">
          <span class="be-tier-badge" style="background:${levelData.color};color:${textColor}">${levelData.badge}</span>
          <span class="be-tier-label" style="color:${levelData.color}">${levelData.label}</span>
        </div>`
    }
    const knownProf = e.villagerProfession && PROFESSION_CONFIG[e.villagerProfession]
    const prof  = knownProf ? null : (e.villagerProfession ? formatId(e.villagerProfession) : 'Unemployed')
    const biome = e.villagerType ? formatId(e.villagerType) : ''
    const detail = [prof, biome].filter(Boolean).join(' · ')
    if (detail) body += `<div class="entity-detail">${detail}</div>`
    if (converting) {
      const secs = Math.ceil((e.conversionTime ?? 0) / 20)
      body += `<div class="entity-detail entity-warning">Curing… ~${secs}s remaining</div>`
    }
    if (e.trades?.length) {
      body += `<div class="entity-section-label">Trades (${e.trades.length})</div>`
      body += `<div class="entity-trades">${e.trades.map(tradeRow).join('')}</div>`
    }
  }

  if (e.type === 'fox') {
    const variant  = e.petVariant ? `<div class="entity-detail">${formatId(e.petVariant)}</div>` : ''
    const sitting  = e.isSitting ? '<div class="entity-detail">Sitting</div>' : ''
    body = variant + sitting
  }

  if (e.type === 'panda') {
    body = e.petVariant ? `<div class="entity-detail">Genes: ${e.petVariant.split('/').map(formatId).join(' / ')}</div>` : ''
  }

  if (e.type === 'bee') {
    body = e.hasNectar ? '<div class="entity-detail">Carrying nectar</div>' : ''
  }

  if (e.type === 'tropical_fish') {
    body = e.petVariant ? `<div class="entity-detail">${e.petVariant.split(' ').map(formatId).join(' ')}</div>` : ''
  }

  if (e.type === 'salmon') {
    body = e.petVariant ? `<div class="entity-detail">${formatId(e.petVariant)}</div>` : ''
  }

  if (e.type === 'shulker') {
    body = e.petVariant
      ? `<div class="entity-detail">${formatId(e.petVariant)}</div>`
      : '<div class="entity-muted">Default purple</div>'
  }

  if (e.type === 'snow_golem') {
    body = e.isScreaming
      ? '<div class="entity-detail">Has pumpkin</div>'
      : '<div class="entity-muted">No pumpkin (sheared)</div>'
  }

  if (e.type === 'phantom') {
    const size = e.mobSize ?? 0
    const hp   = 20 + size * 10
    body = `<div class="entity-detail">Size: ${size} · ${hp} HP</div>`
  }

  if (e.type === 'end_crystal') {
    body = e.beamTarget
      ? `<div class="entity-detail">Beam: X: ${e.beamTarget.x}, Y: ${e.beamTarget.y}, Z: ${e.beamTarget.z}</div>`
      : '<div class="entity-muted">No beam target</div>'
  }

  if (e.type === 'copper_golem') {
    const level  = e.oxidationLevel ?? 0
    const ox     = OXIDATION_LABELS[level] ?? 'Copper'
    const waxed  = e.isWaxed  ? '<div class="entity-detail">Waxed</div>' : ''
    const statue = level === 3 ? '<div class="entity-detail entity-warning">Statue — immobile</div>' : ''
    const handSlots = ['Hand', 'Offhand']
    const hands = (e.handItems ?? [])
      .map((item, i) => item.id ? `<div class="entity-detail">${handSlots[i]}: ${formatItem(item)}</div>` : '')
      .join('')
    body = `<div class="entity-detail">${ox}</div>${waxed}${statue}${hands}`
  }

  if (e.type === 'happy_ghast') {
    body = e.saddled
      ? '<div class="entity-detail">Harnessed</div>'
      : '<div class="entity-muted">No harness</div>'
  }

  if (e.type === 'wolf' || e.type === 'cat') {
    const variant = e.petVariant ? `<div class="entity-detail">${formatId(e.petVariant)}</div>` : ''
    const tamed   = e.tamed ? '<div class="entity-detail">Tamed</div>' : '<div class="entity-muted">Wild</div>'
    const collar  = e.collarColor ? `<div class="entity-detail">Collar: ${formatId(e.collarColor)}</div>` : ''
    body = variant + tamed + collar
  }

  if (e.type === 'allay') {
    body = e.chestItems?.length
      ? `<div class="entity-detail">Carrying: ${formatItem(e.chestItems[0])}</div>`
      : '<div class="entity-muted">Not carrying anything</div>'
  }

  if (e.type === 'chest_minecart' || e.type === 'hopper_minecart' || e.type === 'chest_boat') {
    if (e.lootTable) {
      body = `<div class="entity-detail be-unopened">Unopened</div><div class="be-loot-table">${formatId(e.lootTable.split('/').pop() ?? e.lootTable)}</div>`
    } else if (e.chestItems?.length) {
      body = `<div class="entity-section-label">Contents</div>` +
        e.chestItems.map(i => `<div class="entity-detail">${formatItem(i)}</div>`).join('')
    } else {
      body = '<div class="entity-muted">Empty</div>'
    }
  }

  const babyTag = e.isBaby ? '<div class="entity-detail entity-baby">Baby</div>' : ''

  return `
    <div class="popup-content">
      <div class="popup-title">${title}</div>
      ${subtitle}
      <div class="popup-coords">X: ${e.x}, Y: ${e.y}, Z: ${e.z}</div>
      ${babyTag}${body}
    </div>`
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

export function buildTooltip(e: GameEntity): string {
  const cfg   = getConfig(e)
  const label = e.customName ? `"${e.customName}" · ${cfg.label}` : cfg.label
  const baby  = e.isBaby ? 'Baby' : null

  switch (e.type) {
    case 'villager': {
      const knownProf = e.villagerProfession && PROFESSION_CONFIG[e.villagerProfession]
      const prof  = knownProf ? null : (e.villagerProfession ? formatId(e.villagerProfession) : 'Unemployed')
      const level = getVillagerLevelData(e.villagerLevel)?.label ?? null
      const biome = e.villagerType ? formatId(e.villagerType) : ''
      return tooltipText(label, prof, level, biome, e.trades?.length ? `${e.trades.length} trade${e.trades.length !== 1 ? 's' : ''}` : null, baby)
    }
    case 'wandering_trader':
      return tooltipText(label, e.trades?.length ? `${e.trades.length} trade${e.trades.length !== 1 ? 's' : ''}` : null, baby)
    case 'painting':
      return tooltipText(label, e.paintingVariant ? formatId(e.paintingVariant) : null, baby)
    case 'item_frame':
    case 'glow_item_frame':
      return tooltipText(label, e.frameItem ? formatId(e.frameItem) : null, baby)
    case 'horse':
      return tooltipText(label, e.horseVariant ?? null, e.tamed ? 'Tamed' : 'Wild', e.speed != null ? `${e.speed} bps` : null, e.jumpHeight != null ? `${e.jumpHeight}blk jump` : null, baby)
    case 'donkey':
    case 'mule':
      return tooltipText(label, e.tamed ? 'Tamed' : 'Wild', e.speed != null ? `${e.speed} bps` : null, e.chestItems?.length ? `${e.chestItems.length} items in chest` : null, baby)
    case 'zombie_horse':
    case 'skeleton_horse':
      return tooltipText(label, e.speed != null ? `${e.speed} bps` : null, baby)
    case 'camel':
      return tooltipText(label, e.saddled ? 'Saddled' : 'No saddle', e.speed != null ? `${e.speed} bps` : null, baby)
    case 'llama':
    case 'trader_llama':
      return tooltipText(label, e.llamaVariant ?? null, e.llamaStrength ? `${e.llamaStrength * 3} chest slots` : null, e.speed != null ? `${e.speed} bps` : null, baby)
    case 'ender_dragon':
      return tooltipText(label, e.dragonHealth != null ? `${Math.round(e.dragonHealth)}/200 HP` : null, baby)
    case 'wither':
      return tooltipText(label, e.witherHealth != null ? `${Math.round(e.witherHealth)}/300 HP` : null, baby)
    case 'chest_minecart':
    case 'hopper_minecart':
    case 'chest_boat':
      if (e.lootTable)          return tooltipText(label, 'Unopened', baby)
      if (e.chestItems?.length) return tooltipText(label, `${e.chestItems.length} item${e.chestItems.length !== 1 ? 's' : ''}`, baby)
      return tooltipText(label, 'Empty', baby)
    case 'wolf':
    case 'cat':
      return tooltipText(label, e.petVariant ? formatId(e.petVariant) : null, e.tamed ? 'Tamed' : 'Wild', e.tamed && e.collarColor ? formatId(e.collarColor) + ' collar' : null, baby)
    case 'parrot':
      return tooltipText(label, e.petVariant ? formatId(e.petVariant) : null, e.tamed ? 'Tamed' : 'Wild', baby)
    case 'allay':
      return tooltipText(label, e.chestItems?.length ? `Carrying ${formatId(e.chestItems[0].id)}` : null, baby)
    case 'pig':
      return tooltipText(label, e.petVariant ? formatId(e.petVariant) : null, e.saddled ? 'Saddled' : null, baby)
    case 'cow':
    case 'chicken':
    case 'mooshroom':
    case 'rabbit':
    case 'frog':
    case 'salmon':
      return tooltipText(label, e.petVariant ? formatId(e.petVariant) : null, baby)
    case 'strider':
      return tooltipText(label, e.saddled ? 'Saddled' : 'No saddle', baby)
    case 'sheep':
      return tooltipText(label, e.petVariant ? formatId(e.petVariant) : null, e.isScreaming ? 'Sheared' : null, baby)
    case 'armadillo':
      return tooltipText(label, e.petVariant ? formatId(e.petVariant) : null, baby)
    case 'zombie_villager': {
      const knownProf = e.villagerProfession && PROFESSION_CONFIG[e.villagerProfession]
      const level = getVillagerLevelData(e.villagerLevel)?.label ?? null
      return tooltipText(label, knownProf ? null : (e.villagerProfession ? formatId(e.villagerProfession) : 'Unemployed'), level, (e.conversionTime ?? -1) > 0 ? `Curing ~${Math.ceil((e.conversionTime ?? 0) / 20)}s` : null, baby)
    }
    case 'fox':
      return tooltipText(label, e.petVariant ? formatId(e.petVariant) : null, e.isSitting ? 'Sitting' : null, baby)
    case 'panda':
      return tooltipText(label, e.petVariant ? e.petVariant.split('/').map(formatId).join('/') : null, baby)
    case 'bee':
      return tooltipText(label, e.hasNectar ? 'Has nectar' : null, baby)
    case 'tropical_fish':
      return tooltipText(label, e.petVariant ? e.petVariant.split(' ').map(formatId).join(' ') : null, baby)
    case 'shulker':
      return tooltipText(label, e.petVariant ? formatId(e.petVariant) : 'Purple', baby)
    case 'snow_golem':
      return tooltipText(label, e.isScreaming ? 'Has pumpkin' : 'Sheared', baby)
    case 'phantom':
      return tooltipText(label, `Size ${e.mobSize ?? 0}`, baby)
    case 'end_crystal':
      return tooltipText(label, e.beamTarget ? `Beam → X:${e.beamTarget.x} Z:${e.beamTarget.z}` : null, baby)
    case 'goat':
      return tooltipText(label, e.isScreaming ? 'Screaming' : 'Normal', baby)
    case 'axolotl':
      return tooltipText(label, e.petVariant ? formatId(e.petVariant) + (e.petVariant === 'blue' ? ' (Rare)' : '') : null, baby)
    case 'iron_golem':
      return tooltipText(label, e.isPlayerCreated ? 'Player built' : 'Village spawned', baby)
    case 'copper_golem': {
      const level  = e.oxidationLevel ?? 0
      const ox     = OXIDATION_LABELS[level] ?? 'Copper'
      const held   = e.handItems?.[0]?.id ? formatId(e.handItems[0].id) : null
      const waxed  = e.isWaxed  ? 'Waxed' : null
      const statue = level === 3 ? 'Statue' : null
      return tooltipText(label, ox, held, waxed, statue, baby)
    }
    case 'happy_ghast':
      return tooltipText(label, e.saddled ? 'Harnessed' : 'No harness', baby)
    case 'creaking':
      return tooltipText(label, baby)
    default:
      return tooltipText(label, baby)
  }
}

// ── Icon ──────────────────────────────────────────────────────────────────────

export function createIcon(
  cfg: EntityConfig,
  tooltip: string,
  badge?: { text: string; color: string },
  borderColor?: string,
  badge2?: { text: string; color: string },
): L.DivIcon {
  const badgeHtml = badge
    ? `<span class="be-marker-badge" style="background:${badge.color}">${badge.text}</span>`
    : ''
  const badge2Html = badge2
    ? `<span class="be-marker-badge be-marker-badge-2" style="background:${badge2.color}">${badge2.text}</span>`
    : ''
  const borderStyle = borderColor
    ? `border:2px solid ${borderColor};box-shadow:0 0 4px ${borderColor}80,0 1px 3px rgba(0,0,0,0.6)`
    : ''
  return L.divIcon({
    className: '',
    html: `<div class="entity-marker" style="background:${cfg.color};${borderStyle}" title="${tooltip}">${cfg.initial}${badgeHtml}${badge2Html}</div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  })
}
