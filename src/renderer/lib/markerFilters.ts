// ── BE render groups (used for display logic and labelling) ───────────────────

export type BEFilterGroup =
  | 'containers'
  | 'spawners'
  | 'signs'
  | 'bees'
  | 'utility'
  | 'decorative'
  | 'archeology'
  | 'technical'

export interface BEGroupDef {
  label: string
  color: string
  description: string
}

export const BE_GROUP_DEFS: Record<BEFilterGroup, BEGroupDef> = {
  containers:  { label: 'Containers',    color: '#a0522d', description: 'Chests, copper chests, barrels, shulker boxes, hoppers, droppers, dispensers, chiseled bookshelves, crafters' },
  spawners:    { label: 'Spawners',      color: '#8b0000', description: 'Mob spawners and trial spawners' },
  signs:       { label: 'Signs',         color: '#d4a017', description: 'All sign variants (wall, hanging, wood types)' },
  bees:        { label: 'Bee Blocks',    color: '#f0a500', description: 'Beehives and bee nests' },
  utility:     { label: 'Utility',       color: '#bf360c', description: 'Beacons, jukeboxes, furnaces, blast furnaces, smokers, campfires, brewing stands, bells, lecterns, conduits, end gateways' },
  decorative:  { label: 'Decorative',    color: '#ffd700', description: 'Decorated pots, sculk shriekers, vaults, banners, skulls/player heads' },
  archeology:  { label: 'Archeology',    color: '#d4a96a', description: 'Suspicious sand and suspicious gravel' },
  technical:   { label: 'Technical',     color: '#64748b', description: 'Command blocks, structure blocks, jigsaw blocks' },
}

// ── BE type normalization ──────────────────────────────────────────────────────
// Rust emits specific variant names (oak_sign, white_shulker_box, wall_banner…).
// We collapse those families so the filter system only needs one key per concept.

export function normalizeBEType(type: string): string {
  if (
    type === 'sign' || type === 'wall_sign' || type === 'hanging_sign' || type === 'wall_hanging_sign' ||
    type.endsWith('_sign') || type.endsWith('_wall_sign') ||
    type.endsWith('_hanging_sign') || type.endsWith('_wall_hanging_sign')
  ) return 'sign'
  if (type === 'shulker_box' || type.endsWith('_shulker_box')) return 'shulker_box'
  if (type === 'copper_chest' || type.endsWith('_copper_chest')) return 'copper_chest'
  if (type === 'wall_banner') return 'banner'
  if (type === 'player_head' || type === 'player_wall_head') return 'skull'
  return type
}

// ── BE type → render group (keyed by normalized type) ─────────────────────────

export const BE_TYPE_TO_GROUP: Record<string, BEFilterGroup> = {
  chest: 'containers', trapped_chest: 'containers', barrel: 'containers',
  hopper: 'containers', dropper: 'containers', dispenser: 'containers',
  shulker_box: 'containers', chiseled_bookshelf: 'containers', crafter: 'containers',
  copper_chest: 'containers',
  mob_spawner: 'spawners', trial_spawner: 'spawners',
  sign: 'signs',
  beehive: 'bees', bee_nest: 'bees',
  beacon: 'utility', jukebox: 'utility', furnace: 'utility', blast_furnace: 'utility',
  smoker: 'utility', campfire: 'utility', soul_campfire: 'utility', brewing_stand: 'utility',
  bell: 'utility', lectern: 'utility', conduit: 'utility', end_gateway: 'utility',
  suspicious_sand: 'archeology', suspicious_gravel: 'archeology',
  decorated_pot: 'decorative', sculk_shrieker: 'decorative', vault: 'decorative',
  banner: 'decorative', skull: 'decorative',
  command_block: 'technical', chain_command_block: 'technical', repeating_command_block: 'technical',
  structure_block: 'technical', jigsaw: 'technical',
}

// ── BE type definitions for the editor dialog ─────────────────────────────────

export interface BETypeDef {
  type: string           // normalized key used in CustomMarkerGroup.beTypes
  group: BEFilterGroup
  label: string
}

export const BE_TYPE_DEFS: BETypeDef[] = [
  // containers
  { type: 'chest',              group: 'containers', label: 'Chest' },
  { type: 'trapped_chest',      group: 'containers', label: 'Trapped Chest' },
  { type: 'barrel',             group: 'containers', label: 'Barrel' },
  { type: 'hopper',             group: 'containers', label: 'Hopper' },
  { type: 'dropper',            group: 'containers', label: 'Dropper' },
  { type: 'dispenser',          group: 'containers', label: 'Dispenser' },
  { type: 'shulker_box',        group: 'containers', label: 'Shulker Box (all colors)' },
  { type: 'chiseled_bookshelf', group: 'containers', label: 'Chiseled Bookshelf' },
  { type: 'crafter',            group: 'containers', label: 'Crafter' },
  { type: 'copper_chest',       group: 'containers', label: 'Copper Chest (all weathering stages)' },
  // spawners
  { type: 'mob_spawner',        group: 'spawners',   label: 'Mob Spawner' },
  { type: 'trial_spawner',      group: 'spawners',   label: 'Trial Spawner' },
  // signs
  { type: 'sign',               group: 'signs',      label: 'Signs (all types)' },
  // bees
  { type: 'beehive',            group: 'bees',       label: 'Beehive' },
  { type: 'bee_nest',           group: 'bees',       label: 'Bee Nest' },
  // utility
  { type: 'beacon',             group: 'utility',    label: 'Beacon' },
  { type: 'jukebox',            group: 'utility',    label: 'Jukebox' },
  { type: 'furnace',            group: 'utility',    label: 'Furnace' },
  { type: 'blast_furnace',      group: 'utility',    label: 'Blast Furnace' },
  { type: 'smoker',             group: 'utility',    label: 'Smoker' },
  { type: 'campfire',           group: 'utility',    label: 'Campfire' },
  { type: 'soul_campfire',      group: 'utility',    label: 'Soul Campfire' },
  { type: 'brewing_stand',      group: 'utility',    label: 'Brewing Stand' },
  { type: 'bell',               group: 'utility',    label: 'Bell' },
  { type: 'lectern',            group: 'utility',    label: 'Lectern' },
  { type: 'conduit',            group: 'utility',    label: 'Conduit' },
  { type: 'end_gateway',        group: 'utility',    label: 'End Gateway' },
  // archeology
  { type: 'suspicious_sand',    group: 'archeology', label: 'Suspicious Sand' },
  { type: 'suspicious_gravel',  group: 'archeology', label: 'Suspicious Gravel' },
  // decorative
  { type: 'decorated_pot',      group: 'decorative', label: 'Decorated Pot' },
  { type: 'sculk_shrieker',     group: 'decorative', label: 'Sculk Shrieker' },
  { type: 'vault',              group: 'decorative', label: 'Vault' },
  { type: 'banner',             group: 'decorative', label: 'Banner (all colors)' },
  { type: 'skull',              group: 'decorative', label: 'Skull / Player Head' },
  // technical
  { type: 'command_block',              group: 'technical', label: 'Command Block' },
  { type: 'chain_command_block',        group: 'technical', label: 'Chain Command Block' },
  { type: 'repeating_command_block',    group: 'technical', label: 'Repeating Command Block' },
  { type: 'structure_block',            group: 'technical', label: 'Structure Block' },
  { type: 'jigsaw',                     group: 'technical', label: 'Jigsaw Block' },
]

// ── Entity render groups ───────────────────────────────────────────────────────

export type EntityFilterGroup =
  | 'villagers'
  | 'frames'
  | 'armor_stands'
  | 'mounts'
  | 'pets'
  | 'animals'
  | 'livestock'
  | 'bosses'
  | 'containers'
  | 'named_mobs'
  | 'uncategorized'

export interface EntityGroupDef {
  label: string
  color: string
  description: string
}

export const ENTITY_GROUP_DEFS: Record<EntityFilterGroup, EntityGroupDef> = {
  villagers:    { label: 'Villagers',          color: '#3b82f6', description: 'Villagers, wandering traders, and zombie villagers (curing or any)' },
  frames:       { label: 'Paintings & Frames', color: '#92400e', description: 'Paintings, item frames, glow item frames' },
  armor_stands: { label: 'Armor Stands',       color: '#6b7280', description: 'Armor stands with their equipped items' },
  mounts:       { label: 'Mounts',             color: '#d97706', description: 'Horses, donkeys, mules, skeleton/zombie horses, llamas, trader llamas, camels, happy ghasts, boats & rafts' },
  pets:         { label: 'Pets & Companions',  color: '#ec4899', description: 'Wolves, cats, parrots (tamed or named), allays (carrying item or named)' },
  animals:      { label: 'Animals',            color: '#84cc16', description: 'Goats, axolotls, saddled striders, player-built iron/copper golems, shulkers, snow golems, phantoms, sulfur cubes' },
  livestock:    { label: 'Livestock',          color: '#a3803a', description: 'Cows, pigs, chickens, sheep, mooshrooms, rabbits, frogs, turtles, sniffers, armadillos, foxes, pandas, bees, tropical fish' },
  bosses:       { label: 'Bosses & Threats',   color: '#7e22ce', description: 'Ender dragon, wither, elder guardians, wardens, creakings, end crystals' },
  containers:   { label: 'Container Entities', color: '#a0522d', description: 'Chest minecarts, hopper minecarts, chest boats' },
  named_mobs:   { label: 'Named Mobs',         color: '#facc15', description: 'Any entity with a custom name tag (e.g. Harold), regardless of type — so you can find named mobs that wander off' },
  uncategorized: { label: 'Uncategorized',     color: '#f97316', description: 'Any entity whose type is not otherwise categorized (hostiles, new/unknown mobs, sulfur cubes…), shown by its internal Minecraft name' },
}

// ── Entity type → render group ────────────────────────────────────────────────

export const ENTITY_TYPE_TO_GROUP: Record<string, EntityFilterGroup> = {
  villager: 'villagers', wandering_trader: 'villagers', zombie_villager: 'villagers', zombie_villager_curing: 'villagers',
  painting: 'frames', item_frame: 'frames', glow_item_frame: 'frames',
  armor_stand: 'armor_stands',
  horse: 'mounts', donkey: 'mounts', mule: 'mounts', zombie_horse: 'mounts',
  skeleton_horse: 'mounts', llama: 'mounts', trader_llama: 'mounts', camel: 'mounts', happy_ghast: 'mounts',
  boat: 'mounts',
  wolf: 'pets', cat: 'pets', parrot: 'pets', allay: 'pets',
  strider: 'animals', goat: 'animals', axolotl: 'animals', iron_golem: 'animals', copper_golem: 'animals',
  shulker: 'animals', snow_golem: 'animals', phantom: 'animals', sulfur_cube: 'animals',
  cow: 'livestock', pig: 'livestock', chicken: 'livestock', sheep: 'livestock',
  mooshroom: 'livestock', rabbit: 'livestock', frog: 'livestock', turtle: 'livestock',
  sniffer: 'livestock', armadillo: 'livestock', fox: 'livestock', panda: 'livestock',
  bee: 'livestock', tropical_fish: 'livestock', salmon: 'livestock', cod: 'livestock',
  ender_dragon: 'bosses', wither: 'bosses', elder_guardian: 'bosses',
  warden: 'bosses', creaking: 'bosses', end_crystal: 'bosses',
  chest_minecart: 'containers', hopper_minecart: 'containers', chest_boat: 'containers',
}

// ── Entity type definitions for the editor dialog ─────────────────────────────
// Pseudo-types: 'named_mobs' matches any entity with a custom name; 'uncategorized'
// matches any entity whose type is not in ENTITY_TYPE_TO_GROUP. An entity can match
// both these and its normal type group (see buildEntityGroupLookup usage).

export interface EntityTypeDef {
  type: string             // raw entity type OR 'named_mobs'/'uncategorized'
  group: EntityFilterGroup
  label: string
}

export const ENTITY_TYPE_DEFS: EntityTypeDef[] = [
  // villagers
  { type: 'villager',               group: 'villagers',    label: 'Villager' },
  { type: 'wandering_trader',       group: 'villagers',    label: 'Wandering Trader' },
  { type: 'zombie_villager_curing', group: 'villagers',    label: 'Zombie Villager (curing)' },
  { type: 'zombie_villager',        group: 'villagers',    label: 'Zombie Villager' },
  // frames
  { type: 'painting',          group: 'frames',       label: 'Painting' },
  { type: 'item_frame',        group: 'frames',       label: 'Item Frame' },
  { type: 'glow_item_frame',   group: 'frames',       label: 'Glow Item Frame' },
  // armor stands
  { type: 'armor_stand',       group: 'armor_stands', label: 'Armor Stand' },
  // mounts
  { type: 'horse',             group: 'mounts',       label: 'Horse' },
  { type: 'donkey',            group: 'mounts',       label: 'Donkey' },
  { type: 'mule',              group: 'mounts',       label: 'Mule' },
  { type: 'skeleton_horse',    group: 'mounts',       label: 'Skeleton Horse' },
  { type: 'zombie_horse',      group: 'mounts',       label: 'Zombie Horse' },
  { type: 'llama',             group: 'mounts',       label: 'Llama' },
  { type: 'trader_llama',      group: 'mounts',       label: 'Trader Llama' },
  { type: 'camel',             group: 'mounts',       label: 'Camel' },
  { type: 'happy_ghast',       group: 'mounts',       label: 'Happy Ghast' },
  { type: 'boat',              group: 'mounts',       label: 'Boat / Raft' },
  // pets
  { type: 'wolf',              group: 'pets',         label: 'Wolf' },
  { type: 'cat',               group: 'pets',         label: 'Cat' },
  { type: 'parrot',            group: 'pets',         label: 'Parrot' },
  { type: 'allay',             group: 'pets',         label: 'Allay' },
  // animals
  { type: 'strider',           group: 'animals',      label: 'Strider' },
  { type: 'goat',              group: 'animals',      label: 'Goat' },
  { type: 'axolotl',           group: 'animals',      label: 'Axolotl' },
  { type: 'iron_golem',        group: 'animals',      label: 'Iron Golem' },
  { type: 'copper_golem',      group: 'animals',      label: 'Copper Golem' },
  { type: 'shulker',           group: 'animals',      label: 'Shulker' },
  { type: 'snow_golem',        group: 'animals',      label: 'Snow Golem' },
  { type: 'phantom',           group: 'animals',      label: 'Phantom' },
  { type: 'sulfur_cube',       group: 'animals',      label: 'Sulfur Cube' },
  // livestock
  { type: 'cow',               group: 'livestock',    label: 'Cow' },
  { type: 'pig',               group: 'livestock',    label: 'Pig' },
  { type: 'chicken',           group: 'livestock',    label: 'Chicken' },
  { type: 'sheep',             group: 'livestock',    label: 'Sheep' },
  { type: 'mooshroom',         group: 'livestock',    label: 'Mooshroom' },
  { type: 'rabbit',            group: 'livestock',    label: 'Rabbit' },
  { type: 'frog',              group: 'livestock',    label: 'Frog' },
  { type: 'turtle',            group: 'livestock',    label: 'Turtle' },
  { type: 'sniffer',           group: 'livestock',    label: 'Sniffer' },
  { type: 'armadillo',         group: 'livestock',    label: 'Armadillo' },
  { type: 'fox',               group: 'livestock',    label: 'Fox' },
  { type: 'panda',             group: 'livestock',    label: 'Panda' },
  { type: 'bee',               group: 'livestock',    label: 'Bee' },
  { type: 'tropical_fish',     group: 'livestock',    label: 'Tropical Fish' },
  { type: 'salmon',            group: 'livestock',    label: 'Salmon' },
  { type: 'cod',               group: 'livestock',    label: 'Cod' },
  // bosses
  { type: 'ender_dragon',      group: 'bosses',       label: 'Ender Dragon' },
  { type: 'wither',            group: 'bosses',       label: 'Wither' },
  { type: 'elder_guardian',    group: 'bosses',       label: 'Elder Guardian' },
  { type: 'warden',            group: 'bosses',       label: 'Warden' },
  { type: 'creaking',          group: 'bosses',       label: 'Creaking' },
  { type: 'end_crystal',       group: 'bosses',       label: 'End Crystal' },
  // container entities
  { type: 'chest_minecart',    group: 'containers',   label: 'Chest Minecart' },
  { type: 'hopper_minecart',   group: 'containers',   label: 'Hopper Minecart' },
  { type: 'chest_boat',        group: 'containers',   label: 'Chest Boat' },
  // catch-all
  { type: 'named_mobs',        group: 'named_mobs',    label: 'Named Mobs (any named)' },
  { type: 'uncategorized',     group: 'uncategorized', label: 'Uncategorized (other)' },
]

// ── Custom marker group definition ───────────────────────────────────────────

export interface CustomMarkerGroup {
  id: string
  name: string
  color: string
  beTypes: string[]      // normalized BE type keys (from BE_TYPE_DEFS) + 'jobsite'/'nether_portal'/'lodestone' pseudo-types
  entityTypes: string[]  // raw entity type keys (from ENTITY_TYPE_DEFS) + 'named_mobs'/'uncategorized'
}

export const DEFAULT_MARKER_GROUPS: CustomMarkerGroup[] = [
  {
    id: 'storage', name: 'Storage', color: '#a0522d',
    beTypes: ['chest', 'trapped_chest', 'barrel', 'hopper', 'dropper', 'dispenser', 'shulker_box', 'chiseled_bookshelf', 'crafter', 'copper_chest'],
    entityTypes: ['chest_minecart', 'hopper_minecart', 'chest_boat'],
  },
  {
    id: 'spawners', name: 'Spawners', color: '#8b0000',
    beTypes: ['mob_spawner', 'trial_spawner'],
    entityTypes: [],
  },
  {
    id: 'villagers', name: 'Villagers', color: '#3b82f6',
    beTypes: ['jobsite'],
    entityTypes: ['villager', 'wandering_trader', 'zombie_villager_curing', 'zombie_villager'],
  },
  {
    id: 'animals', name: 'Animals', color: '#84cc16',
    beTypes: [],
    entityTypes: [
      'horse', 'donkey', 'mule', 'skeleton_horse', 'zombie_horse', 'llama', 'trader_llama', 'camel', 'happy_ghast', 'boat',
      'wolf', 'cat', 'parrot', 'allay',
      'strider', 'goat', 'axolotl', 'iron_golem', 'copper_golem', 'shulker', 'snow_golem', 'phantom', 'sulfur_cube',
      'cow', 'pig', 'chicken', 'sheep', 'mooshroom', 'rabbit', 'frog', 'turtle',
      'sniffer', 'armadillo', 'fox', 'panda', 'bee', 'tropical_fish', 'salmon', 'cod',
    ],
  },
  {
    id: 'bosses', name: 'Bosses', color: '#7e22ce',
    beTypes: [],
    entityTypes: ['ender_dragon', 'wither', 'elder_guardian', 'warden', 'creaking', 'end_crystal'],
  },
  {
    id: 'decoration', name: 'Decoration', color: '#d4a017',
    beTypes: ['sign', 'decorated_pot', 'sculk_shrieker', 'vault', 'banner', 'skull'],
    entityTypes: ['painting', 'item_frame', 'glow_item_frame', 'armor_stand'],
  },
  {
    id: 'utility', name: 'Utility', color: '#bf360c',
    beTypes: [
      'beehive', 'bee_nest',
      'beacon', 'jukebox', 'furnace', 'blast_furnace', 'smoker',
      'campfire', 'soul_campfire', 'brewing_stand', 'bell', 'lectern', 'conduit', 'end_gateway',
      'suspicious_sand', 'suspicious_gravel',
      'command_block', 'chain_command_block', 'repeating_command_block', 'structure_block', 'jigsaw',
      'nether_portal',
      'lodestone',
    ],
    entityTypes: [],
  },
  {
    id: 'named_mobs', name: 'Named Mobs', color: '#facc15',
    beTypes: [],
    entityTypes: ['named_mobs'],
  },
  {
    id: 'uncategorized', name: 'Uncategorized', color: '#f97316',
    beTypes: [],
    entityTypes: ['uncategorized'],
  },
]

// ── Lookup builders ───────────────────────────────────────────────────────────
// Map normalizedType → groupId[]. A type can belong to multiple groups.

export function buildBeGroupLookup(defs: CustomMarkerGroup[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const def of defs) {
    for (const t of def.beTypes) {
      const arr = map.get(t)
      if (arr) arr.push(def.id)
      else map.set(t, [def.id])
    }
  }
  return map
}

export function buildEntityGroupLookup(defs: CustomMarkerGroup[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const def of defs) {
    for (const t of def.entityTypes) {
      const arr = map.get(t)
      if (arr) arr.push(def.id)
      else map.set(t, [def.id])
    }
  }
  return map
}

export function isGroupVisible(groupIds: string[] | undefined, enabledGroups: Set<string>): boolean {
  return !!groupIds?.some(id => enabledGroups.has(id))
}
