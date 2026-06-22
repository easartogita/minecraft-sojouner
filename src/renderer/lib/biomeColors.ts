// Biome ID to RGB color mapping
// IDs match cubiomes biomes.h enum values
// Colors match chunkbase.com's palette

export type RGB = [number, number, number]

export const BIOME_COLORS: Record<number, RGB> = {
  // Ocean biomes (IDs match cubiomes biomes.h exactly)
  0:  [0, 0, 112],        // ocean
  10: [0, 0, 172],        // frozen_ocean
  24: [7, 8, 145],        // deep_ocean
  44: [0, 0, 200],        // warm_ocean
  45: [0, 0, 180],        // lukewarm_ocean
  46: [24, 24, 152],      // cold_ocean
  47: [0, 50, 140],       // deep_warm_ocean
  48: [0, 0, 120],        // deep_lukewarm_ocean
  49: [10, 10, 85],       // deep_cold_ocean
  50: [24, 24, 112],      // deep_frozen_ocean
  // Plains
  1:  [141, 179, 96],     // plains
  129: [182, 208, 82],    // sunflower_plains
  // Desert
  2:  [250, 148, 24],     // desert
  17: [210, 95, 18],      // desert_hills
  130: [210, 120, 18],    // desert_lakes
  // Mountains / Extreme Hills
  3:  [96, 96, 96],       // mountains (windswept_hills)
  20: [114, 120, 154],    // mountain_edge
  34: [72, 72, 72],       // wooded_mountains (windswept_forest)
  131: [80, 112, 80],     // gravelly_mountains (windswept_gravelly_hills)
  162: [80, 80, 70],      // modified_gravelly_mountains
  // Forest
  4:  [5, 102, 33],       // forest
  18: [34, 85, 28],       // wooded_hills
  27: [34, 85, 28],       // birch_forest
  28: [59, 100, 53],      // birch_forest_hills
  29: [29, 74, 24],       // dark_forest (roofed_forest)
  132: [120, 170, 60],    // flower_forest
  155: [49, 98, 44],      // tall_birch_forest (old_growth_birch_forest)
  156: [69, 115, 65],     // tall_birch_hills
  157: [64, 81, 26],      // dark_forest_hills
  // Taiga
  5:  [11, 102, 89],      // taiga
  19: [22, 112, 98],      // taiga_hills
  30: [49, 66, 60],       // snowy_taiga
  31: [36, 53, 47],       // snowy_taiga_hills
  158: [36, 53, 47],      // snowy_taiga_mountains
  32: [89, 102, 81],      // giant_tree_taiga (old_growth_pine_taiga)
  33: [69, 79, 62],       // giant_tree_taiga_hills
  133: [0, 77, 54],       // taiga_mountains
  160: [89, 102, 81],     // old_growth_pine_taiga
  161: [89, 102, 81],     // old_growth_spruce_taiga (giant_spruce_taiga)
  // Swamp
  6:  [107, 117, 47],     // swamp
  134: [96, 106, 37],     // swamp_hills
  // River
  7:  [60, 100, 240],     // river
  11: [100, 180, 255],    // frozen_river
  // Snowy
  12: [255, 255, 255],    // snowy_tundra (snowy_plains)
  13: [160, 160, 160],    // snowy_mountains
  26: [250, 250, 245],    // snowy_beach (cold_beach)
  140: [176, 192, 192],   // ice_spikes
  // Mushroom
  14: [150, 80, 180],     // mushroom_fields
  15: [120, 60, 150],     // mushroom_field_shore
  // Beach
  16: [250, 222, 85],     // beach
  25: [130, 130, 130],    // stone_shore (stony_shore)
  // Jungle
  21: [83, 123, 9],       // jungle
  22: [68, 102, 7],       // jungle_hills
  23: [48, 76, 5],        // jungle_edge (sparse_jungle)
  149: [68, 102, 7],      // modified_jungle
  151: [48, 76, 5],       // modified_jungle_edge
  168: [83, 123, 9],      // bamboo_jungle
  169: [56, 100, 7],      // bamboo_jungle_hills
  // Savanna
  35: [189, 178, 95],     // savanna
  36: [167, 157, 100],    // savanna_plateau
  163: [167, 157, 100],   // shattered_savanna (windswept_savanna)
  164: [167, 157, 100],   // shattered_savanna_plateau
  // Badlands (Mesa)
  37: [217, 69, 21],      // badlands
  38: [176, 151, 101],    // wooded_badlands_plateau (wooded_badlands)
  39: [64, 17, 9],        // badlands_plateau
  165: [217, 69, 21],     // eroded_badlands
  166: [176, 151, 101],   // modified_wooded_badlands_plateau
  167: [64, 17, 9],       // modified_badlands_plateau
  // Nether
  8:   [180, 30, 30],     // nether_wastes (pre-1.16 nether biome)
  170: [80, 100, 130],    // soul_sand_valley
  171: [190, 50, 50],     // crimson_forest
  172: [26, 160, 157],    // warped_forest
  173: [82, 82, 82],      // basalt_deltas
  // End
  9:  [128, 128, 255],    // the_end
  40: [170, 170, 255],    // small_end_islands
  41: [100, 200, 100],    // end_midlands
  42: [60, 150, 60],      // end_highlands
  43: [80, 80, 150],      // end_barrens
  // 1.17 cave biomes (rarely surface-visible)
  174: [120, 90, 60],     // dripstone_caves
  175: [80, 160, 80],     // lush_caves
  // 1.18
  177: [169, 199, 112],   // meadow
  178: [50, 100, 70],     // grove
  179: [210, 235, 225],   // snowy_slopes
  180: [100, 100, 110],   // jagged_peaks
  181: [170, 200, 215],   // frozen_peaks
  182: [110, 95, 80],     // stony_peaks
  // 1.19
  183: [12, 52, 62],      // deep_dark
  184: [56, 133, 90],     // mangrove_swamp
  // 1.20
  185: [225, 100, 160],   // cherry_grove
  // 1.21
  186: [195, 205, 180],   // pale_garden
  // 26.2 (Chaos Cubed)
  187: [200, 180, 60],    // sulfur_caves
}

export function biomeToRGB(biomeId: number): RGB {
  return BIOME_COLORS[biomeId] ?? [80, 80, 80]
}

// Human-readable biome names keyed by cubiomes biome ID
export const BIOME_NAMES: Record<number, string> = {
  // Ocean
  0: 'Ocean', 10: 'Frozen Ocean', 24: 'Deep Ocean',
  44: 'Warm Ocean', 45: 'Lukewarm Ocean', 46: 'Cold Ocean',
  47: 'Deep Warm Ocean', 48: 'Deep Lukewarm Ocean', 49: 'Deep Cold Ocean', 50: 'Deep Frozen Ocean',
  // Plains
  1: 'Plains', 129: 'Sunflower Plains',
  // Desert
  2: 'Desert', 17: 'Desert Hills', 130: 'Desert Lakes',
  // Mountains
  3: 'Windswept Hills', 20: 'Mountain Edge', 34: 'Windswept Forest',
  131: 'Gravelly Mountains', 162: 'Modified Gravelly Mountains',
  // Forest
  4: 'Forest', 18: 'Forest Hills', 27: 'Birch Forest', 28: 'Birch Forest Hills', 29: 'Dark Forest',
  132: 'Flower Forest', 155: 'Old Growth Birch Forest', 156: 'Tall Birch Hills', 157: 'Dark Forest Hills',
  // Taiga
  5: 'Taiga', 19: 'Taiga Hills', 30: 'Snowy Taiga', 31: 'Snowy Taiga Hills',
  32: 'Old Growth Pine Taiga', 33: 'Giant Tree Taiga Hills', 133: 'Taiga Mountains', 158: 'Snowy Taiga Mountains',
  160: 'Old Growth Pine Taiga', 161: 'Old Growth Spruce Taiga',
  // Swamp
  6: 'Swamp', 134: 'Swamp Hills',
  // River
  7: 'River', 11: 'Frozen River',
  // Snowy
  12: 'Snowy Plains', 13: 'Snowy Mountains', 26: 'Snowy Beach', 140: 'Ice Spikes',
  // Mushroom
  14: 'Mushroom Fields', 15: 'Mushroom Field Shore',
  // Beach
  16: 'Beach', 25: 'Stony Shore',
  // Jungle
  21: 'Jungle', 22: 'Jungle Hills', 23: 'Sparse Jungle',
  149: 'Modified Jungle', 151: 'Modified Jungle Edge',
  168: 'Bamboo Jungle', 169: 'Bamboo Jungle Hills',
  // Savanna
  35: 'Savanna', 36: 'Savanna Plateau', 163: 'Windswept Savanna', 164: 'Shattered Savanna Plateau',
  // Badlands
  37: 'Badlands', 38: 'Wooded Badlands', 39: 'Badlands Plateau',
  165: 'Eroded Badlands', 166: 'Modified Wooded Badlands', 167: 'Modified Badlands Plateau',
  // Nether
  8: 'Nether Wastes', 170: 'Soul Sand Valley', 171: 'Crimson Forest', 172: 'Warped Forest', 173: 'Basalt Deltas',
  // End
  9: 'The End', 40: 'Small End Islands', 41: 'End Midlands', 42: 'End Highlands', 43: 'End Barrens',
  // 1.17 cave biomes
  174: 'Dripstone Caves', 175: 'Lush Caves',
  // 1.18
  177: 'Meadow', 178: 'Grove', 179: 'Snowy Slopes',
  180: 'Jagged Peaks', 181: 'Frozen Peaks', 182: 'Stony Peaks',
  // 1.19
  183: 'Deep Dark', 184: 'Mangrove Swamp',
  // 1.20
  185: 'Cherry Grove',
  // 1.21
  186: 'Pale Garden',
  // 26.2 (Chaos Cubed)
  187: 'Sulfur Caves',
}
