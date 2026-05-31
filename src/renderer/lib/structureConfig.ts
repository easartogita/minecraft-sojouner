import { Dimension } from './constants'

export type StructureType =
  | 'village' | 'stronghold' | 'ancient_city' | 'mansion'
  | 'ocean_monument' | 'witch_hut' | 'outpost' | 'desert_temple'
  | 'jungle_temple' | 'igloo' | 'shipwreck' | 'ruined_portal'
  | 'trial_chambers' | 'trail_ruins' | 'ocean_ruins' | 'desert_well'
  | 'buried_treasure' | 'mineshaft' | 'geode'
  | 'fortress' | 'bastion' | 'ruined_portal_nether'
  | 'end_city' | 'end_gateway' | 'end_island'

export interface StructureConfig {
  label: string
  color: string
  dimension: Dimension
  minZoom: number
  spawnRadius?: number
  summary: string
  variantSummary?: Record<string, string>
}

export const STRUCTURE_CONFIG: Record<StructureType, StructureConfig> = {
  // Overworld
  village:             { label: 'Village',           color: '#7ec850', dimension: 'overworld', minZoom: 0,
                         summary: 'Villager trades, beds, workstations',
                         variantSummary: { zombie: 'No doors or torches; zombie villager inhabitants' } },
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
                         summary: 'Treasure map + supply + treasure chests; buried treasure pointer' },
  igloo:               { label: 'Igloo',             color: '#ecf0f1', dimension: 'overworld', minZoom: 0,
                         summary: 'Snow biomes; may have a basement',
                         variantSummary: { basement: 'Has basement — zombie villager, golden apple, splash potion of weakness' } },
  ocean_ruins:         { label: 'Ocean Ruins',       color: '#2980b9', dimension: 'overworld', minZoom: 1,
                         summary: 'Warm (sandstone) or cold (stone); moderate loot chests' },
  ruined_portal:       { label: 'Ruined Portal',     color: '#8e44ad', dimension: 'overworld', minZoom: 0,
                         summary: 'Damaged nether portal; gold loot chest nearby',
                         variantSummary: { giant: 'Oversized portal — extra loot chest', underground: 'Buried underground' } },
  ancient_city:        { label: 'Ancient City',      color: '#555577', dimension: 'overworld', minZoom: 0,  spawnRadius: 90,
                         summary: 'Deep Darkness; Swift Sneak book, echo shards, sculk sensors' },
  trial_chambers:      { label: 'Trial Chambers',    color: '#f39c12', dimension: 'overworld', minZoom: 0,
                         summary: 'Copper maze; trial spawners, ominous vaults, wind charges' },
  trail_ruins:         { label: 'Trail Ruins',       color: '#b8732c', dimension: 'overworld', minZoom: 1,
                         summary: 'Buried archaeology site; pottery sherds, rare armour trims' },
  desert_well:         { label: 'Desert Well',       color: '#d4ac6e', dimension: 'overworld', minZoom: 2,
                         summary: 'Decorative; no loot' },
  buried_treasure:     { label: 'Buried Treasure',   color: '#ffd700', dimension: 'overworld', minZoom: 3,
                         summary: 'Heart of the Sea; diamonds, iron, food' },
  mineshaft:           { label: 'Mineshaft',         color: '#8b6423', dimension: 'overworld', minZoom: 3,
                         summary: 'Cave tunnels; minecart chests with rails, enchanted books' },
  geode:               { label: 'Amethyst Geode',    color: '#be94f5', dimension: 'overworld', minZoom: 3,
                         summary: 'Amethyst crystals and budding amethyst; calcite shell' },
  // Nether
  fortress:            { label: 'Nether Fortress',   color: '#c0392b', dimension: 'nether',    minZoom: 0,
                         summary: 'Blaze spawners, nether wart garden; blaze rods, wither skulls' },
  bastion:             { label: 'Bastion Remnant',   color: '#7f8c8d', dimension: 'nether',    minZoom: 0,
                         summary: 'Piglin barter point; netherite ingot in treasure room' },
  ruined_portal_nether:{ label: 'Ruined Portal',     color: '#8e44ad', dimension: 'nether',    minZoom: 0,
                         summary: 'Nether-side ruined portal; gold loot chest nearby',
                         variantSummary: { giant: 'Oversized portal — extra loot chest' } },
  // End
  end_city:            { label: 'End City',          color: '#f1c40f', dimension: 'end',       minZoom: 0,
                         summary: 'Elytra in the attached ship; enchanted diamond and iron gear' },
  end_gateway:         { label: 'End Gateway',       color: '#a855f7', dimension: 'end',       minZoom: 2,
                         summary: 'Teleports to outer End islands' },
  end_island:          { label: 'End Island',        color: '#6b7b8d', dimension: 'end',       minZoom: 2,
                         summary: 'Small floating island; chorus plants and fruit' },
}

export function getStructuresForDimension(dim: Dimension): StructureType[] {
  return Object.entries(STRUCTURE_CONFIG)
    .filter(([, v]) => v.dimension === dim)
    .map(([k]) => k as StructureType)
}

const DEFAULT_STRUCTURES: Record<Dimension, StructureType[]> = {
  overworld: ['village', 'ruined_portal'],
  nether:    ['ruined_portal_nether'],
  end:       [],
}

export function getDefaultStructures(dim: Dimension): StructureType[] {
  return DEFAULT_STRUCTURES[dim]
}
