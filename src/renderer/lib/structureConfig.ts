import { Dimension } from './constants'

export type StructureType =
  | 'village' | 'stronghold' | 'ancient_city' | 'mansion'
  | 'ocean_monument' | 'witch_hut' | 'outpost' | 'desert_temple'
  | 'jungle_temple' | 'igloo' | 'shipwreck' | 'ruined_portal'
  | 'trial_chambers' | 'trail_ruins' | 'ocean_ruins' | 'desert_well'
  | 'buried_treasure' | 'mineshaft' | 'geode' | 'abandoned_camp'
  | 'fortress' | 'bastion' | 'ruined_portal_nether'
  | 'end_city' | 'end_gateway' | 'end_island'

export interface StructureVariantDef {
  tag: string      // matches variant_tag from resolve_variant() in structures.rs
  label: string
  color: string    // mirrors variant_color from the Rust side, for UI dots
  summary: string
}

export interface StructureConfig {
  label: string
  color: string
  dimension: Dimension
  minZoom: number
  spawnRadius?: number
  summary: string
  variants?: StructureVariantDef[]
  /** Set when "has the good loot" can't be known until the async per-instance chest
   *  walk resolves (NOTABLE_LOOT_CHECK in StructureLayer.tsx) — unlike variants,
   *  which resolve synchronously from cheap flags at find-time. */
  notableLoot?: { label: string; summary: string }
}

export const STRUCTURE_CONFIG: Record<StructureType, StructureConfig> = {
  // Overworld
  village:             { label: 'Village',           color: '#7ec850', dimension: 'overworld', minZoom: 0,
                         summary: 'Villager trades, beds, workstations',
                         variants: [{ tag: 'zombie', label: 'Zombie village', color: '#4ade80',
                                      summary: 'No doors or torches; zombie villager inhabitants' }] },
  desert_temple:       { label: 'Desert Temple',     color: '#f5c518', dimension: 'overworld', minZoom: 0,
                         summary: '4 loot chests below sand; TNT pressure-plate trap' },
  jungle_temple:       { label: 'Jungle Temple',     color: '#2d7a2d', dimension: 'overworld', minZoom: 0,
                         summary: 'Lever puzzle; 2 loot chests' },
  witch_hut:           { label: 'Witch Hut',         color: '#9b59b6', dimension: 'overworld', minZoom: 0,
                         summary: 'Witch spawn point; brewing stand inside' },
  ocean_monument:      { label: 'Ocean Monument',    color: '#1abc9c', dimension: 'overworld', minZoom: 0,  spawnRadius: 80,
                         summary: '3 Elder Guardians; prismarine, gold blocks, wet sponge' },
  stronghold:          { label: 'Stronghold',        color: '#e74c3c', dimension: 'overworld', minZoom: 0,
                         summary: 'Contains the End Portal; libraries with enchanted books' },
  mansion:             { label: 'Woodland Mansion',  color: '#8b4513', dimension: 'overworld', minZoom: 0,  spawnRadius: 128,
                         summary: 'Evokers, vindicators; rare diamond loot rooms' },
  outpost:             { label: 'Pillager Outpost',  color: '#e67e22', dimension: 'overworld', minZoom: 0,  spawnRadius: 72,
                         summary: 'Pillager patrol spawns; ominous banner, crossbows' },
  shipwreck:           { label: 'Shipwreck',         color: '#3498db', dimension: 'overworld', minZoom: 0,
                         summary: 'Treasure map + supply + treasure chests; buried treasure pointer',
                         notableLoot: { label: 'Has treasure chest', summary: 'Not every shipwreck has one — some only roll map/supply' } },
  igloo:               { label: 'Igloo',             color: '#ecf0f1', dimension: 'overworld', minZoom: 0,
                         summary: 'Snow biomes; may have a basement',
                         variants: [{ tag: 'basement', label: 'With basement', color: '#f59e0b',
                                      summary: 'Has basement — zombie villager, golden apple, splash potion of weakness' }] },
  ocean_ruins:         { label: 'Ocean Ruins',       color: '#2980b9', dimension: 'overworld', minZoom: 1,
                         summary: 'Warm (sandstone) or cold (stone); moderate loot chests' },
  ruined_portal:       { label: 'Ruined Portal',     color: '#8e44ad', dimension: 'overworld', minZoom: 0,
                         summary: 'Damaged nether portal; gold loot chest nearby',
                         variants: [{ tag: 'giant',       label: 'Giant portal', color: '#c084fc',
                                      summary: 'Oversized portal — extra loot chest' },
                                    { tag: 'underground', label: 'Underground',  color: '#6b7280',
                                      summary: 'Buried underground' },
                                    { tag: 'air_pocket',  label: 'Air pocket',   color: '#38bdf8',
                                      summary: 'Generates with a pocket of air — safer to dig into underwater/underground' }] },
  ancient_city:        { label: 'Ancient City',      color: '#555577', dimension: 'overworld', minZoom: 0,  spawnRadius: 90,
                         summary: 'Deep Darkness; Swift Sneak book, echo shards, sculk sensors' },
  trial_chambers:      { label: 'Trial Chambers',    color: '#f39c12', dimension: 'overworld', minZoom: 0,
                         summary: 'Copper maze; trial spawners, ominous vaults, wind charges' },
  trail_ruins:         { label: 'Trail Ruins',       color: '#b8732c', dimension: 'overworld', minZoom: 1,
                         summary: 'Buried archaeology site; pottery sherds, rare armour trims' },
  abandoned_camp:      { label: 'Abandoned Camp',    color: '#8a7f5c', dimension: 'overworld', minZoom: 1,
                         summary: 'Surface camp (26.3+); barrel plus common and secret loot chests',
                         notableLoot: { label: 'Has secret chest', summary: 'Depends on which campsite piece rolled — bigger camps have better odds' } },
  desert_well:         { label: 'Desert Well',       color: '#d4ac6e', dimension: 'overworld', minZoom: 2,
                         summary: 'Decorative; no loot' },
  buried_treasure:     { label: 'Buried Treasure',   color: '#ffd700', dimension: 'overworld', minZoom: 3,
                         summary: 'Heart of the Sea; diamonds, iron, food' },
  mineshaft:           { label: 'Mineshaft',         color: '#8b6423', dimension: 'overworld', minZoom: 3,
                         summary: 'Cave tunnels; minecart chests with rails, enchanted books' },
  geode:               { label: 'Amethyst Geode',    color: '#be94f5', dimension: 'overworld', minZoom: 3,
                         summary: 'Amethyst crystals and budding amethyst; calcite shell',
                         variants: [{ tag: 'sealed', label: 'Sealed', color: '#6b7280',
                                      summary: 'No visible entrance (~5% of geodes) — fully sealed in stone/calcite, must mine in' }] },
  // Nether
  fortress:            { label: 'Nether Fortress',   color: '#c0392b', dimension: 'nether',    minZoom: 0,
                         summary: 'Blaze spawners, nether wart garden; blaze rods, wither skulls' },
  bastion:             { label: 'Bastion Remnant',   color: '#7f8c8d', dimension: 'nether',    minZoom: 0,
                         summary: 'Piglin barter point; netherite ingot in treasure room' },
  ruined_portal_nether:{ label: 'Ruined Portal',     color: '#8e44ad', dimension: 'nether',    minZoom: 0,
                         summary: 'Nether-side ruined portal; gold loot chest nearby',
                         variants: [{ tag: 'giant',      label: 'Giant portal', color: '#c084fc',
                                      summary: 'Oversized portal — extra loot chest' },
                                    { tag: 'air_pocket', label: 'Air pocket',   color: '#38bdf8',
                                      summary: 'Generates with a pocket of air — safer to dig into' }] },
  // End
  end_city:            { label: 'End City',          color: '#f1c40f', dimension: 'end',       minZoom: 0,
                         summary: 'Elytra in the attached ship; enchanted diamond and iron gear',
                         notableLoot: { label: 'Has End Ship', summary: 'Not every End City has one — the only reliable Elytra source when it does' } },
  end_gateway:         { label: 'End Gateway',       color: '#a855f7', dimension: 'end',       minZoom: 2,
                         summary: 'Teleports to outer End islands' },
  end_island:          { label: 'End Island',        color: '#6b7b8d', dimension: 'end',       minZoom: 2,
                         summary: 'Small floating island; chorus plants and fruit' },
}

// Sentinel tag for the plain/no-variant form of a type that has variants.
// Double-underscored so it can never collide with a Rust variant_tag.
export const BASE_VARIANT = '__base__'

/** Selection key for a structure variant; `tag: null` means the base form. */
export function structureVariantKey(type: StructureType, tag: string | null): string {
  return `${type}:${tag ?? BASE_VARIANT}`
}

export function getVariantDef(type: StructureType, tag: string): StructureVariantDef | undefined {
  return STRUCTURE_CONFIG[type].variants?.find(v => v.tag === tag)
}

export function getStructuresForDimension(dim: Dimension): StructureType[] {
  return Object.entries(STRUCTURE_CONFIG)
    .filter(([, v]) => v.dimension === dim)
    .map(([k]) => k as StructureType)
}

const DEFAULT_STRUCTURES: Record<Dimension, StructureType[]> = {
  overworld: ['village'],
  nether:    [],
  end:       [],
}

export function getDefaultStructures(dim: Dimension): StructureType[] {
  return DEFAULT_STRUCTURES[dim]
}
