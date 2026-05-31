// Surface block color mapping — top-down map view
// Colors represent what you'd see looking straight down at each block
// R, G, B values

export type RGB = [number, number, number]

const COLORS: Record<string, RGB> = {
  // ── Air (shouldn't appear at surface) ────────────────────────────────
  air: [0, 0, 0], cave_air: [0, 0, 0], void_air: [0, 0, 0],

  // ── Stone & Rock ─────────────────────────────────────────────────────
  stone: [112, 112, 112],
  cobblestone: [118, 118, 118],
  mossy_cobblestone: [108, 125, 95],
  granite: [153, 93, 75],
  polished_granite: [153, 93, 75],
  diorite: [200, 200, 200],
  polished_diorite: [200, 200, 200],
  andesite: [136, 136, 136],
  polished_andesite: [136, 136, 136],
  deepslate: [100, 100, 100],
  cobbled_deepslate: [96, 96, 96],
  polished_deepslate: [96, 96, 96],
  chiseled_deepslate: [96, 96, 96],
  tuff: [111, 112, 97],
  tuff_bricks: [111, 112, 97],
  calcite: [198, 199, 194],
  smooth_stone: [115, 115, 115],
  stone_bricks: [115, 115, 115],
  mossy_stone_bricks: [108, 125, 95],
  cracked_stone_bricks: [110, 110, 110],
  chiseled_stone_bricks: [115, 115, 115],
  infested_stone: [112, 112, 112],
  bedrock: [75, 75, 75],
  obsidian: [20, 15, 30],
  crying_obsidian: [30, 10, 50],
  reinforced_deepslate: [80, 80, 100],

  // ── Dirt, Grass & Soil ───────────────────────────────────────────────
  grass_block: [95, 159, 53],
  dirt: [151, 109, 77],
  coarse_dirt: [132, 97, 69],
  rooted_dirt: [142, 100, 72],
  podzol: [129, 86, 49],
  mycelium: [142, 118, 142],
  farmland: [139, 100, 64],
  dirt_path: [155, 125, 75],
  mud: [95, 88, 84],
  muddy_mangrove_roots: [75, 65, 50],
  packed_mud: [120, 95, 66],
  mud_bricks: [130, 100, 72],

  // ── Sand & Desert ────────────────────────────────────────────────────
  sand: [219, 207, 163],
  red_sand: [187, 101, 37],
  sandstone: [220, 200, 148],
  chiseled_sandstone: [214, 195, 142],
  cut_sandstone: [214, 195, 142],
  smooth_sandstone: [214, 195, 142],
  red_sandstone: [179, 97, 42],
  chiseled_red_sandstone: [174, 93, 38],
  cut_red_sandstone: [174, 93, 38],
  smooth_red_sandstone: [174, 93, 38],
  gravel: [162, 155, 155],
  clay: [164, 168, 184],
  suspicious_sand: [210, 195, 155],
  suspicious_gravel: [155, 148, 148],

  // ── Snow & Ice ───────────────────────────────────────────────────────
  snow_block: [249, 254, 254],
  snow: [249, 254, 254],
  powder_snow: [228, 240, 252],
  ice: [160, 180, 255],
  packed_ice: [140, 165, 245],
  blue_ice: [110, 150, 255],
  frosted_ice: [140, 165, 245],

  // ── Water & Fluids ───────────────────────────────────────────────────
  water: [63, 118, 228],
  lava: [196, 80, 10],

  // ── Wood Logs (top surface = concentric rings) ───────────────────────
  oak_log: [143, 119, 72],
  oak_wood: [143, 119, 72],
  stripped_oak_log: [168, 143, 90],
  stripped_oak_wood: [168, 143, 90],
  birch_log: [196, 186, 136],
  birch_wood: [196, 186, 136],
  stripped_birch_log: [210, 200, 152],
  spruce_log: [85, 63, 38],
  spruce_wood: [85, 63, 38],
  stripped_spruce_log: [103, 78, 46],
  jungle_log: [147, 133, 89],
  jungle_wood: [147, 133, 89],
  stripped_jungle_log: [163, 150, 104],
  acacia_log: [168, 92, 50],
  acacia_wood: [168, 92, 50],
  stripped_acacia_log: [180, 105, 58],
  dark_oak_log: [76, 50, 35],
  dark_oak_wood: [76, 50, 35],
  stripped_dark_oak_log: [96, 65, 45],
  mangrove_log: [120, 53, 44],
  mangrove_wood: [120, 53, 44],
  stripped_mangrove_log: [135, 68, 55],
  cherry_log: [222, 156, 155],
  cherry_wood: [222, 156, 155],
  stripped_cherry_log: [235, 172, 170],
  pale_oak_log: [190, 190, 175],

  // ── Leaves ───────────────────────────────────────────────────────────
  oak_leaves: [58, 95, 36],
  birch_leaves: [80, 108, 55],
  spruce_leaves: [40, 74, 40],
  jungle_leaves: [48, 112, 22],
  acacia_leaves: [100, 128, 28],
  dark_oak_leaves: [40, 85, 20],
  mangrove_leaves: [60, 108, 20],
  cherry_leaves: [248, 170, 200],
  pale_oak_leaves: [178, 182, 166],
  azalea_leaves: [100, 128, 60],
  flowering_azalea_leaves: [120, 138, 70],

  // ── Planks & Wood products ───────────────────────────────────────────
  oak_planks: [162, 130, 78],
  birch_planks: [196, 179, 123],
  spruce_planks: [115, 84, 48],
  jungle_planks: [160, 115, 70],
  acacia_planks: [168, 90, 50],
  dark_oak_planks: [102, 68, 38],
  mangrove_planks: [138, 62, 55],
  cherry_planks: [226, 155, 145],
  pale_oak_planks: [195, 195, 180],

  // ── Grass & Plants ───────────────────────────────────────────────────
  grass: [95, 162, 50],
  short_grass: [95, 162, 50],
  tall_grass: [90, 155, 45],
  fern: [90, 148, 55],
  large_fern: [90, 148, 55],
  dead_bush: [168, 130, 58],
  seagrass: [50, 130, 80],
  tall_seagrass: [50, 130, 80],
  kelp: [60, 140, 60],
  kelp_plant: [60, 140, 60],
  lily_pad: [52, 125, 52],
  vine: [65, 115, 35],
  cave_vines: [65, 115, 35],
  hanging_roots: [128, 88, 62],
  big_dripleaf: [95, 145, 45],
  small_dripleaf: [95, 145, 45],
  spore_blossom: [210, 130, 180],
  moss_block: [90, 119, 52],
  moss_carpet: [90, 119, 52],

  // ── Flowers ──────────────────────────────────────────────────────────
  dandelion: [230, 210, 0],
  poppy: [218, 44, 44],
  blue_orchid: [50, 188, 226],
  allium: [180, 85, 200],
  azure_bluet: [225, 225, 255],
  red_tulip: [220, 80, 80],
  orange_tulip: [230, 140, 40],
  white_tulip: [235, 235, 235],
  pink_tulip: [245, 160, 200],
  oxeye_daisy: [245, 245, 200],
  cornflower: [80, 100, 240],
  lily_of_the_valley: [240, 245, 240],
  wither_rose: [45, 35, 30],
  sunflower: [255, 210, 0],
  lilac: [188, 130, 188],
  rose_bush: [180, 50, 50],
  peony: [230, 150, 200],
  pitcher_plant: [75, 130, 100],
  torchflower: [255, 165, 20],
  closed_eyeblossom: [180, 100, 180],
  open_eyeblossom: [200, 120, 210],

  // ── Mushrooms ────────────────────────────────────────────────────────
  red_mushroom: [200, 60, 50],
  brown_mushroom: [155, 115, 75],
  red_mushroom_block: [195, 48, 48],
  brown_mushroom_block: [148, 112, 72],
  mushroom_stem: [198, 192, 175],

  // ── Ores ─────────────────────────────────────────────────────────────
  coal_ore: [85, 85, 85],
  deepslate_coal_ore: [78, 78, 78],
  iron_ore: [175, 148, 140],
  deepslate_iron_ore: [155, 130, 125],
  copper_ore: [124, 148, 148],
  deepslate_copper_ore: [110, 135, 135],
  gold_ore: [210, 192, 102],
  deepslate_gold_ore: [190, 172, 88],
  redstone_ore: [195, 80, 80],
  deepslate_redstone_ore: [175, 70, 70],
  diamond_ore: [100, 220, 212],
  deepslate_diamond_ore: [85, 200, 192],
  lapis_ore: [74, 128, 240],
  deepslate_lapis_ore: [64, 115, 225],
  emerald_ore: [45, 190, 100],
  deepslate_emerald_ore: [38, 172, 88],
  ancient_debris: [100, 68, 60],
  nether_quartz_ore: [148, 100, 98],
  nether_gold_ore: [218, 160, 52],

  // ── Ore Blocks ───────────────────────────────────────────────────────
  iron_block: [216, 216, 216],
  gold_block: [244, 210, 48],
  copper_block: [196, 127, 95],
  diamond_block: [96, 222, 218],
  emerald_block: [48, 200, 108],
  netherite_block: [64, 58, 65],
  lapis_block: [58, 100, 198],
  redstone_block: [210, 48, 34],
  amethyst_block: [148, 100, 198],
  raw_iron_block: [196, 162, 138],
  raw_copper_block: [185, 115, 82],
  raw_gold_block: [234, 190, 64],

  // ── Special Stone ────────────────────────────────────────────────────
  glowstone: [244, 211, 130],
  sea_lantern: [172, 222, 207],
  shroomlight: [242, 174, 74],
  amethyst_cluster: [148, 100, 198],
  budding_amethyst: [130, 80, 180],
  dripstone_block: [130, 115, 108],
  pointed_dripstone: [130, 115, 108],
  sculk: [12, 36, 46],
  sculk_vein: [12, 36, 46],
  sculk_catalyst: [20, 50, 60],
  sculk_sensor: [22, 65, 90],
  sculk_shrieker: [20, 55, 65],

  // ── Nether ───────────────────────────────────────────────────────────
  netherrack: [108, 18, 18],
  nether_bricks: [78, 18, 22],
  cracked_nether_bricks: [72, 15, 20],
  quartz_block: [228, 224, 218],
  smooth_quartz: [228, 224, 218],
  nether_quartz_ore: [148, 100, 98],
  magma_block: [164, 72, 14],
  soul_sand: [108, 84, 68],
  soul_soil: [96, 75, 60],
  basalt: [78, 78, 82],
  polished_basalt: [82, 82, 86],
  blackstone: [48, 42, 55],
  gilded_blackstone: [68, 58, 40],
  crimson_nylium: [192, 42, 48],
  warped_nylium: [22, 126, 134],
  crimson_stem: [148, 60, 95],
  warped_stem: [58, 142, 140],
  crimson_hyphae: [92, 24, 28],
  warped_hyphae: [86, 44, 62],
  nether_wart_block: [138, 20, 20],
  warped_wart_block: [20, 178, 132],
  shroomlight: [242, 174, 74],

  // ── End ──────────────────────────────────────────────────────────────
  end_stone: [220, 222, 165],
  end_stone_bricks: [218, 220, 162],
  purpur_block: [168, 118, 168],
  purpur_pillar: [168, 118, 168],
  chorus_plant: [92, 60, 92],
  chorus_flower: [148, 105, 148],
  end_rod: [228, 220, 210],

  // ── Terracotta ───────────────────────────────────────────────────────
  terracotta: [152, 94, 67],
  white_terracotta: [209, 177, 161],
  orange_terracotta: [162, 84, 38],
  magenta_terracotta: [150, 88, 108],
  light_blue_terracotta: [112, 108, 138],
  yellow_terracotta: [188, 133, 35],
  lime_terracotta: [102, 118, 52],
  pink_terracotta: [162, 78, 78],
  gray_terracotta: [58, 42, 36],
  light_gray_terracotta: [135, 107, 98],
  cyan_terracotta: [88, 93, 93],
  purple_terracotta: [122, 74, 88],
  blue_terracotta: [74, 62, 92],
  brown_terracotta: [78, 52, 36],
  green_terracotta: [76, 83, 42],
  red_terracotta: [144, 62, 48],
  black_terracotta: [38, 22, 16],

  // ── Concrete ─────────────────────────────────────────────────────────
  white_concrete: [207, 213, 214],
  orange_concrete: [224, 97, 0],
  magenta_concrete: [169, 48, 159],
  light_blue_concrete: [36, 137, 199],
  yellow_concrete: [241, 175, 21],
  lime_concrete: [94, 168, 24],
  pink_concrete: [213, 101, 142],
  gray_concrete: [55, 58, 62],
  light_gray_concrete: [125, 125, 115],
  cyan_concrete: [21, 119, 136],
  purple_concrete: [100, 32, 156],
  blue_concrete: [45, 47, 143],
  brown_concrete: [96, 60, 32],
  green_concrete: [73, 91, 36],
  red_concrete: [142, 33, 33],
  black_concrete: [8, 10, 15],

  // ── Wool ─────────────────────────────────────────────────────────────
  white_wool: [233, 236, 236],
  orange_wool: [240, 118, 19],
  magenta_wool: [189, 68, 179],
  light_blue_wool: [58, 175, 217],
  yellow_wool: [248, 197, 39],
  lime_wool: [112, 185, 25],
  pink_wool: [237, 141, 172],
  gray_wool: [62, 68, 71],
  light_gray_wool: [142, 142, 134],
  cyan_wool: [21, 137, 145],
  purple_wool: [121, 42, 172],
  blue_wool: [53, 57, 157],
  brown_wool: [114, 71, 40],
  green_wool: [84, 109, 27],
  red_wool: [162, 38, 35],
  black_wool: [20, 21, 25],

  // ── Bricks & Crafted ─────────────────────────────────────────────────
  bricks: [148, 94, 74],
  cracked_bricks: [138, 88, 68],
  prismarine: [99, 171, 158],
  prismarine_bricks: [99, 171, 158],
  dark_prismarine: [68, 108, 98],
  sponge: [198, 198, 62],
  wet_sponge: [168, 178, 58],
  hay_block: [165, 142, 18],
  melon: [100, 150, 34],
  pumpkin: [198, 118, 24],
  carved_pumpkin: [185, 108, 22],
  jack_o_lantern: [200, 120, 24],

  // ── Crops ────────────────────────────────────────────────────────────
  wheat: [195, 185, 80],
  potatoes: [80, 155, 60],
  carrots: [220, 120, 35],
  beetroots: [148, 35, 62],
  pumpkin_stem: [80, 155, 60],
  melon_stem: [80, 155, 60],
  sugar_cane: [95, 162, 50],
  cactus: [80, 130, 50],
  nether_wart: [155, 32, 32],
  sweet_berry_bush: [75, 140, 60],
  cocoa: [140, 90, 45],
  bamboo: [85, 150, 32],

  // ── Paths & Surfaces ─────────────────────────────────────────────────
  cobblestone_slab: [118, 118, 118],
  stone_slab: [112, 112, 112],
  oak_slab: [162, 130, 78],
  spruce_slab: [115, 84, 48],
  sand_slab: [219, 207, 163],

  // ── Misc ─────────────────────────────────────────────────────────────
  bookshelf: [175, 142, 88],
  chest: [162, 125, 60],
  trapped_chest: [162, 115, 50],
  crafting_table: [152, 112, 68],
  furnace: [115, 112, 108],
  tnt: [178, 62, 52],
  barrel: [148, 118, 68],
  composter: [128, 96, 55],
  beehive: [178, 152, 78],
  bee_nest: [188, 162, 68],
  honeycomb_block: [230, 162, 28],
  lodestone: [138, 138, 148],
  target: [218, 178, 168],
  decorated_pot: [152, 94, 67],

  // ── Nether Sprouts & Vegetation ──────────────────────────────────────
  crimson_roots: [180, 32, 32],
  warped_roots: [18, 128, 132],
  nether_sprouts: [22, 148, 72],
  twisting_vines: [22, 148, 72],
  weeping_vines: [148, 32, 32],

  // ── Coral ────────────────────────────────────────────────────────────
  brain_coral_block: [210, 100, 148],
  bubble_coral_block: [165, 42, 188],
  fire_coral_block: [168, 38, 52],
  horn_coral_block: [215, 210, 38],
  tube_coral_block: [42, 88, 198],
  dead_brain_coral_block: [130, 125, 122],
  dead_tube_coral_block: [130, 125, 122],

  // ── 1.21 blocks ──────────────────────────────────────────────────────
  // Copper grate (new oxidation stage variants)
  copper_grate: [196, 127, 95],
  exposed_copper_grate: [171, 145, 110],
  weathered_copper_grate: [108, 154, 110],
  oxidized_copper_grate: [82, 154, 136],
  waxed_copper_grate: [196, 127, 95],
  waxed_exposed_copper_grate: [171, 145, 110],
  waxed_weathered_copper_grate: [108, 154, 110],
  waxed_oxidized_copper_grate: [82, 154, 136],
  // Cut copper (all variants, often appear as surfaces)
  cut_copper: [196, 127, 95],
  exposed_cut_copper: [171, 145, 110],
  weathered_cut_copper: [108, 154, 110],
  oxidized_cut_copper: [82, 154, 136],
  waxed_cut_copper: [196, 127, 95],
  waxed_exposed_cut_copper: [171, 145, 110],
  waxed_weathered_cut_copper: [108, 154, 110],
  waxed_oxidized_cut_copper: [82, 154, 136],
  chiseled_copper: [196, 127, 95],
  exposed_chiseled_copper: [171, 145, 110],
  weathered_chiseled_copper: [108, 154, 110],
  oxidized_chiseled_copper: [82, 154, 136],
  // Pale Oak wood (new wood type added in 1.21.4)
  pale_oak_wood: [190, 190, 175],
  stripped_pale_oak_log: [198, 198, 183],
  stripped_pale_oak_wood: [198, 198, 183],
  // Crafter (1.21 crafting machine)
  crafter: [128, 115, 105],
  // Trial Vault / Ominous Vault (Trial Chambers)
  vault: [60, 80, 90],
  ominous_vault: [60, 60, 100],
  // Trial Spawner
  trial_spawner: [70, 70, 80],
  // Tuff variants (1.21)
  chiseled_tuff: [111, 112, 97],
  tuff_bricks: [111, 112, 97],
  polished_tuff: [111, 112, 97],
  // Concrete Powder (falls as loose powder before landing)
  white_concrete_powder: [225, 227, 219],
  orange_concrete_powder: [227, 145, 67],
  magenta_concrete_powder: [198, 108, 189],
  light_blue_concrete_powder: [107, 176, 209],
  yellow_concrete_powder: [233, 199, 60],
  lime_concrete_powder: [124, 183, 57],
  pink_concrete_powder: [224, 149, 165],
  gray_concrete_powder: [76, 81, 84],
  light_gray_concrete_powder: [152, 152, 148],
  cyan_concrete_powder: [65, 149, 156],
  purple_concrete_powder: [133, 76, 182],
  blue_concrete_powder: [72, 73, 161],
  brown_concrete_powder: [114, 82, 50],
  green_concrete_powder: [93, 110, 48],
  red_concrete_powder: [163, 62, 57],
  black_concrete_powder: [24, 25, 30],
}

// Apply a subtle height-based shade modifier
// Higher blocks appear slightly brighter, lower slightly darker
export function heightShade(color: RGB, blockY: number): RGB {
  // Reference height = 64, range roughly -64..320
  const factor = 0.85 + 0.30 * Math.max(0, Math.min(1, (blockY + 64) / 256))
  return [
    Math.min(255, Math.round(color[0] * factor)),
    Math.min(255, Math.round(color[1] * factor)),
    Math.min(255, Math.round(color[2] * factor)),
  ]
}

// Water: blue darkened by depth below sea level
export function waterColor(blockY: number): RGB {
  const depth = Math.max(0, 63 - blockY)
  const fade = Math.max(0.3, 1 - depth / 30)
  return [
    Math.round(63 * fade),
    Math.round(118 * fade),
    Math.min(255, Math.round((200 + depth * 1.5) * fade + 28)),
  ]
}

export function blockNameToColor(name: string): RGB | null {
  // Strip namespace
  const key = name.includes(':') ? name.split(':')[1] : name
  return COLORS[key] ?? null
}

// Fallback: derive a deterministic grey-ish color from the block name
export function fallbackColor(name: string): RGB {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  }
  const v = 80 + (Math.abs(hash) % 80)
  return [v, v, v]
}
