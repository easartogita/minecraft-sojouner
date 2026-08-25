/// Biome-aware color: applies vanilla-style grass/foliage tints to the blocks
/// the game tints, then falls back to the static table. `biome` is the
/// (namespace-stripped) per-section palette entry; "" means no biome data
/// (pre-1.18 chunks, Bedrock) and yields the static colors unchanged.
pub fn block_name_to_rgb_in_biome(name: &str, y: i32, biome: &str) -> [u8; 3] {
    if !biome.is_empty() {
        // Water needs `y` for depth shading, so it's handled here rather than in
        // `biome_tinted`; the no-biome fallback below still depth-shades the default blue.
        if name == "water" {
            return water_color(biome, y);
        }
        if let Some(rgb) = biome_tinted(name, biome) {
            return rgb;
        }
    }
    block_name_to_rgb(name, y)
}

/// Blocks the game runs through the grass/foliage colormaps. Fixed-color
/// species (birch, spruce, cherry, azalea, mangrove, pale oak, poplar) keep
/// their static table entries. Scale factors are calibrated so the plains
/// tint lands near the old static colors — other biomes shift around that.
fn biome_tinted(name: &str, biome: &str) -> Option<[u8; 3]> {
    let (grass, foliage) = biome_tints(biome);
    Some(match name {
        "grass_block" => scale(grass, 0.72),
        "grass" | "short_grass" | "tall_grass" | "sugar_cane" => scale(grass, 0.70),
        "fern" | "large_fern" => scale(grass, 0.65),
        "oak_leaves" => scale(foliage, 0.55),
        "jungle_leaves" | "acacia_leaves" => scale(foliage, 0.60),
        "dark_oak_leaves" => scale(foliage, 0.48),
        "vine" => scale(foliage, 0.55),
        _ => return None,
    })
}

/// Depth-shaded, biome-tinted water. Mirrors `biome_tinted` but keeps the
/// existing depth-shading math (darken with depth, small blue lift near the
/// surface) so oceans still read as deep. The default biome color is vanilla's
/// `0x3F76E4` = `[63, 118, 228]`, identical to the old static base, so open
/// oceans/rivers look unchanged; only tinted biomes shift.
fn water_color(biome: &str, y: i32) -> [u8; 3] {
    let [r, g, b] = biome_water(biome);
    let depth = (63 - y).max(0) as f32;
    let f = (1.0 - depth / 32.0).max(0.3_f32);
    [
        (r as f32 * f).round() as u8,
        (g as f32 * f).round() as u8,
        ((b as f32 * f + 28.0).round() as u8).min(255),
    ]
}

/// Vanilla per-biome water colormap value (namespace-stripped biome). Most
/// biomes use the default; only the visually distinct ones are listed.
fn biome_water(biome: &str) -> [u8; 3] {
    hex(match biome {
        "swamp" => 0x617B64,
        "mangrove_swamp" => 0x3A7A6A,
        "warm_ocean" | "deep_warm_ocean" => 0x43D5EE,
        "lukewarm_ocean" | "deep_lukewarm_ocean" => 0x45ADF2,
        "cold_ocean" | "deep_cold_ocean" => 0x3D57D6,
        "frozen_ocean" | "deep_frozen_ocean" | "frozen_river" => 0x3938C9,
        "meadow" => 0x0E4ECF,
        "cherry_grove" => 0x5DB7EF,
        // plains, oceans, rivers, caves, default
        _ => 0x3F76E4,
    })
}

fn scale(rgb: [u8; 3], f: f32) -> [u8; 3] {
    [
        (rgb[0] as f32 * f).round() as u8,
        (rgb[1] as f32 * f).round() as u8,
        (rgb[2] as f32 * f).round() as u8,
    ]
}

fn hex(c: u32) -> [u8; 3] {
    [(c >> 16) as u8, (c >> 8) as u8, c as u8]
}

/// (grass, foliage) colormap values per biome, from the vanilla colormaps
/// sampled at each biome's temperature/downfall (plus the hardcoded specials:
/// swamp, dark forest, badlands, cherry grove).
fn biome_tints(biome: &str) -> ([u8; 3], [u8; 3]) {
    let (g, f) = match biome {
        "badlands" | "eroded_badlands" | "wooded_badlands" => (0x90814D, 0x9E814D),
        "desert" | "savanna" | "savanna_plateau" | "windswept_savanna" => (0xBFB755, 0xAEA42A),
        "jungle" | "sparse_jungle" | "bamboo_jungle" => (0x59C93C, 0x30BB0B),
        "swamp" => (0x6A7039, 0x6A7039),
        "mangrove_swamp" => (0x6A7039, 0x8DB127),
        "dark_forest" | "pale_garden" => (0x507A32, 0x59AE30),
        "forest" | "flower_forest" => (0x79C05A, 0x59AE30),
        // Autumn biome (26.3) — warm, rusty ground; approximate until pinned
        // against the game's colormap values for its climate point.
        "dappled_forest" => (0xB1A65B, 0x9E814D),
        "birch_forest" | "old_growth_birch_forest" => (0x88BB67, 0x6BA941),
        "taiga" | "old_growth_pine_taiga" | "old_growth_spruce_taiga" => (0x86B783, 0x68A464),
        "snowy_plains" | "ice_spikes" | "snowy_taiga" | "snowy_beach" | "grove"
        | "snowy_slopes" | "jagged_peaks" | "frozen_peaks" | "frozen_river"
        | "frozen_ocean" | "deep_frozen_ocean" => (0x80B497, 0x60A17B),
        "windswept_hills" | "windswept_gravelly_hills" | "windswept_forest"
        | "stony_shore" => (0x8AB689, 0x6DA36B),
        "stony_peaks" => (0x9ABE4B, 0x82AC1E),
        "mushroom_fields" => (0x55C93F, 0x2BBB0F),
        "cherry_grove" => (0xB6DB61, 0xB6DB61),
        "meadow" => (0x83BB6D, 0x63A948),
        // plains, sunflower plains, beaches, rivers, oceans, caves, default
        _ => (0x91BD59, 0x77AB2F),
    };
    (hex(g), hex(f))
}

/// Map a block name (without namespace) to an RGB color.
/// Returns a deterministic grey fallback for unknown blocks.
pub fn block_name_to_rgb(name: &str, y: i32) -> [u8; 3] {
    // Water: depth-shaded blue
    if name == "water" {
        let depth = (63 - y).max(0) as f32;
        let f = (1.0 - depth / 32.0).max(0.3_f32);
        return [
            (63.0 * f).round() as u8,
            (118.0 * f).round() as u8,
            ((228.0 * f + 28.0).round() as u8).min(255),
        ];
    }

    // Waxed copper variants render identically to their unwaxed base.
    let name = name.strip_prefix("waxed_").unwrap_or(name);

    if let Some(rgb) = resolve(name) {
        return rgb;
    }

    // Finish-prefix variants inherit the base material (smooth_sandstone →
    // sandstone, cracked_stone_bricks → stone_bricks). Exact entries win first
    // (mossy_cobblestone keeps its green), this only runs on a miss.
    const PREFIXES: &[&str] = &["polished_", "smooth_", "cracked_", "chiseled_", "cut_"];
    for p in PREFIXES {
        if let Some(base) = name.strip_prefix(p) {
            if let Some(rgb) = resolve(base) {
                return rgb;
            }
        }
    }

    // Deterministic grey fallback for unknown blocks
    let mut h: i32 = 0;
    for c in name.bytes() {
        h = h.wrapping_shl(5).wrapping_sub(h).wrapping_add(c as i32);
    }
    let v = (80 + (h.unsigned_abs() % 80)) as u8;
    [v, v, v]
}

fn resolve(name: &str) -> Option<[u8; 3]> {
    lookup(name).copied().or_else(|| derived_color(name))
}

/// Shaped blocks inherit their base material's color: strip the shape suffix and
/// re-resolve (oak_stairs → oak_planks, white_carpet → white_wool, etc). Anything
/// whose base still isn't in the table keeps the grey fallback.
fn derived_color(name: &str) -> Option<[u8; 3]> {
    const SHAPES: &[&str] = &[
        "_stained_glass_pane", "_stained_glass", "_concrete_powder",
        "_stairs", "_slab", "_fence_gate", "_fence", "_wall", "_trapdoor",
        "_door", "_button", "_pressure_plate", "_grate", "_bulb", "_bars",
        "_carpet", "_bed", "_pane",
    ];
    let base = SHAPES.iter().find_map(|s| name.strip_suffix(s))?;
    let candidates = [
        base.to_string(),            // cobblestone_stairs → cobblestone
        format!("{base}s"),          // stone_brick_stairs → stone_bricks
        format!("{base}_planks"),    // oak_stairs → oak_planks
        format!("{base}_block"),     // purpur_stairs → purpur_block
        format!("{base}_wool"),      // lime_carpet / lime_bed / lime_stained_glass → lime_wool
        format!("{base}_concrete"),  // lime_concrete_powder → lime_concrete
    ];
    candidates.iter().find_map(|c| lookup(c).copied())
}

fn lookup(name: &str) -> Option<&'static [u8; 3]> {
    Some(match name {
        // Air
        "air" | "cave_air" | "void_air" => &[0, 0, 0],
        // Stone & rock
        "stone" => &[112, 112, 112],
        "cobblestone" => &[118, 118, 118],
        "mossy_cobblestone" => &[108, 125, 95],
        "granite" | "polished_granite" => &[153, 93, 75],
        "diorite" | "polished_diorite" => &[200, 200, 200],
        "andesite" | "polished_andesite" => &[136, 136, 136],
        "deepslate" | "cobbled_deepslate" => &[100, 100, 100],
        "tuff" => &[111, 112, 97],
        "calcite" => &[198, 199, 194],
        "smooth_stone" | "stone_bricks" => &[115, 115, 115],
        "mossy_stone_bricks" => &[108, 125, 95],
        "deepslate_bricks" | "deepslate_tiles" => &[92, 92, 94],
        "reinforced_deepslate" => &[88, 98, 90],
        "bedrock" => &[75, 75, 75],
        "obsidian" => &[20, 15, 30],
        "crying_obsidian" => &[38, 14, 66],
        "glass" | "tinted_glass" => &[200, 216, 222],
        // Dirt & soil
        "grass_block" => &[95, 159, 53],
        "dirt" => &[151, 109, 77],
        "coarse_dirt" => &[132, 97, 69],
        "rooted_dirt" => &[142, 100, 72],
        "podzol" => &[129, 86, 49],
        "mycelium" => &[142, 118, 142],
        "farmland" => &[139, 100, 64],
        "dirt_path" => &[155, 125, 75],
        "mud" => &[95, 88, 84],
        "packed_mud" => &[120, 95, 66],
        "mud_bricks" => &[130, 100, 72],
        // Sand & gravel
        "sand" => &[219, 207, 163],
        "red_sand" => &[187, 101, 37],
        "gravel" => &[162, 155, 155],
        "clay" => &[164, 168, 184],
        "sandstone" => &[220, 200, 148],
        "red_sandstone" => &[179, 97, 42],
        // Ice & snow
        "snow_block" | "snow" => &[249, 254, 254],
        "powder_snow" => &[228, 240, 252],
        "ice" => &[160, 180, 255],
        "frosted_ice" => &[150, 175, 255],
        "packed_ice" => &[140, 165, 245],
        "blue_ice" => &[110, 150, 255],
        // Hot
        "lava" => &[196, 80, 10],
        // Logs (bark color)
        "oak_log" | "oak_wood" | "stripped_oak_log" => &[143, 119, 72],
        "birch_log" | "birch_wood" | "stripped_birch_log" => &[196, 186, 136],
        "spruce_log" | "spruce_wood" | "stripped_spruce_log" => &[85, 63, 38],
        "jungle_log" | "jungle_wood" | "stripped_jungle_log" => &[147, 133, 89],
        "acacia_log" | "acacia_wood" | "stripped_acacia_log" => &[168, 92, 50],
        "dark_oak_log" | "dark_oak_wood" | "stripped_dark_oak_log" => &[76, 50, 35],
        "mangrove_log" | "stripped_mangrove_log" => &[120, 53, 44],
        "cherry_log" | "stripped_cherry_log" => &[222, 156, 155],
        "pale_oak_log" => &[190, 190, 175],
        "poplar_log" | "poplar_wood" | "stripped_poplar_log" => &[178, 172, 150],
        // Leaves
        "oak_leaves" => &[58, 95, 36],
        "birch_leaves" => &[80, 108, 55],
        "spruce_leaves" => &[40, 74, 40],
        "jungle_leaves" => &[48, 112, 22],
        "acacia_leaves" => &[100, 128, 28],
        "dark_oak_leaves" => &[40, 85, 20],
        "mangrove_leaves" => &[60, 108, 20],
        "cherry_leaves" => &[248, 170, 200],
        "pale_oak_leaves" => &[178, 182, 166],
        // Poplar leaves (26.3, dappled forest) — three autumn color variants
        "red_poplar_leaves" => &[158, 56, 32],
        "orange_poplar_leaves" => &[192, 106, 30],
        "yellow_poplar_leaves" => &[202, 164, 44],
        "azalea_leaves" => &[100, 128, 60],
        "flowering_azalea_leaves" => &[120, 138, 70],
        // Planks
        "oak_planks" => &[162, 130, 78],
        "birch_planks" => &[196, 179, 123],
        "spruce_planks" => &[115, 84, 48],
        "jungle_planks" => &[160, 115, 70],
        "acacia_planks" => &[168, 90, 50],
        "dark_oak_planks" => &[102, 68, 38],
        "mangrove_planks" => &[138, 62, 55],
        "cherry_planks" => &[226, 155, 145],
        "bamboo_planks" | "bamboo_mosaic" => &[193, 173, 82],
        "crimson_planks" => &[101, 48, 70],
        "warped_planks" => &[43, 104, 99],
        "pale_oak_planks" => &[222, 214, 197],
        "poplar_planks" => &[212, 200, 165],
        // Plants
        "grass" | "short_grass" => &[95, 162, 50],
        "tall_grass" => &[90, 155, 45],
        "fern" | "large_fern" => &[90, 148, 55],
        "dead_bush" => &[168, 130, 58],
        "seagrass" | "tall_seagrass" => &[50, 130, 80],
        "kelp" | "kelp_plant" => &[60, 140, 60],
        "lily_pad" => &[52, 125, 52],
        "vine" => &[65, 115, 35],
        "moss_block" | "moss_carpet" => &[90, 119, 52],
        "mangrove_roots" => &[88, 68, 45],
        "muddy_mangrove_roots" => &[70, 58, 48],
        "pink_petals" => &[245, 178, 205],
        "pale_moss_block" | "pale_moss_carpet" | "pale_hanging_moss" => &[160, 165, 150],
        "closed_eyeblossom" => &[190, 190, 180],
        "open_eyeblossom" => &[225, 220, 160],
        "resin_clump" | "resin_block" => &[230, 120, 30],
        "resin_bricks" | "chiseled_resin_bricks" => &[225, 110, 25],
        "leaf_litter" => &[150, 110, 65],
        "bush" => &[70, 110, 40],
        "firefly_bush" => &[80, 115, 45],
        "wildflowers" => &[210, 180, 90],
        "short_dry_grass" | "tall_dry_grass" => &[188, 160, 90],
        "cactus_flower" => &[230, 130, 150],
        "sweet_berry_bush" => &[60, 90, 45],
        "glow_lichen" => &[110, 150, 130],
        "cave_vines" | "cave_vines_plant" => &[90, 120, 50],
        "big_dripleaf" | "big_dripleaf_stem" | "small_dripleaf" => &[95, 140, 60],
        "azalea" => &[90, 125, 55],
        "red_shrub" | "poplar_sapling" => &[150, 52, 34],
        "flowering_azalea" => &[110, 130, 70],
        "spore_blossom" => &[200, 110, 140],
        // Flowers
        "dandelion" => &[230, 210, 0],
        "poppy" => &[218, 44, 44],
        "blue_orchid" => &[50, 188, 226],
        "allium" => &[180, 85, 200],
        "cornflower" => &[80, 100, 240],
        "lily_of_the_valley" => &[240, 245, 240],
        "sunflower" => &[255, 210, 0],
        "torchflower" => &[255, 165, 20],
        // Mushrooms
        "red_mushroom" => &[200, 60, 50],
        "brown_mushroom" => &[155, 115, 75],
        "red_mushroom_block" => &[195, 48, 48],
        "brown_mushroom_block" => &[148, 112, 72],
        "mushroom_stem" => &[198, 192, 175],
        "shelf_mushroom" => &[204, 140, 72],
        // Ores
        "coal_ore" | "deepslate_coal_ore" => &[85, 85, 85],
        "iron_ore" | "deepslate_iron_ore" => &[175, 148, 140],
        "copper_ore" | "deepslate_copper_ore" => &[124, 148, 148],
        "gold_ore" | "deepslate_gold_ore" => &[210, 192, 102],
        "redstone_ore" | "deepslate_redstone_ore" => &[195, 80, 80],
        "diamond_ore" | "deepslate_diamond_ore" => &[100, 220, 212],
        "lapis_ore" | "deepslate_lapis_ore" => &[74, 128, 240],
        "emerald_ore" | "deepslate_emerald_ore" => &[45, 190, 100],
        "nether_gold_ore" => &[140, 70, 35],
        "nether_quartz_ore" => &[132, 62, 52],
        "ancient_debris" => &[100, 68, 60],
        // Blocks (processed)
        "iron_block" => &[216, 216, 216],
        "gold_block" => &[244, 210, 48],
        "lapis_block" => &[38, 96, 180],
        "redstone_block" => &[170, 26, 10],
        "coal_block" => &[18, 18, 18],
        "raw_copper_block" => &[190, 110, 80],
        "raw_gold_block" => &[220, 180, 80],
        "copper_block" | "cut_copper" | "chiseled_copper" => &[196, 127, 95],
        "exposed_copper" | "exposed_cut_copper" | "exposed_chiseled_copper" => &[161, 125, 103],
        "weathered_copper" | "weathered_cut_copper" | "weathered_chiseled_copper" => &[108, 153, 110],
        "oxidized_copper" | "oxidized_cut_copper" | "oxidized_chiseled_copper" => &[82, 162, 132],
        // Copper Chest (26.3+): tinted per weathering stage like the rest of the
        // copper family, not chest-brown — waxed variants render identically (same
        // "waxed_" strip-and-fallback convention as every other copper block).
        "copper_chest" => &[196, 127, 95],
        "exposed_copper_chest" => &[161, 125, 103],
        "weathered_copper_chest" => &[108, 153, 110],
        "oxidized_copper_chest" => &[82, 162, 132],
        "diamond_block" => &[96, 222, 218],
        "emerald_block" => &[48, 200, 108],
        "netherite_block" => &[64, 58, 65],
        "amethyst_block" | "budding_amethyst" | "amethyst_cluster" => &[148, 100, 198],
        "raw_iron_block" => &[196, 162, 138],
        "bone_block" => &[210, 206, 178],
        // Light sources
        "glowstone" => &[244, 211, 130],
        "sea_lantern" => &[172, 222, 207],
        "shroomlight" => &[242, 174, 74],
        // Sculk
        "sculk" | "sculk_vein" => &[12, 36, 46],
        "sculk_catalyst" => &[20, 50, 60],
        // Nether
        "netherrack" => &[108, 18, 18],
        "nether_bricks" => &[78, 18, 22],
        "red_nether_bricks" => &[96, 25, 30],
        "nether_portal" => &[90, 40, 180],
        "quartz_block" | "quartz_bricks" | "quartz_pillar" | "smooth_quartz" => &[228, 224, 218],
        "magma_block" => &[164, 72, 14],
        "soul_sand" => &[108, 84, 68],
        "soul_soil" => &[96, 75, 60],
        "basalt" | "smooth_basalt" | "polished_basalt" => &[78, 78, 82],
        "blackstone" => &[48, 42, 55],
        "polished_blackstone_bricks" | "cracked_polished_blackstone_bricks"
            | "chiseled_polished_blackstone" => &[53, 48, 60],
        "gilded_blackstone" => &[68, 58, 40],
        "crimson_nylium" => &[192, 42, 48],
        "warped_nylium" => &[22, 126, 134],
        "crimson_stem" => &[148, 60, 95],
        "warped_stem" => &[58, 142, 140],
        "crimson_hyphae" => &[92, 24, 28],
        "warped_hyphae" => &[86, 44, 62],
        "nether_wart_block" => &[138, 20, 20],
        "warped_wart_block" => &[20, 178, 132],
        // End
        "end_stone" | "end_stone_bricks" => &[220, 222, 165],
        "purpur_block" | "purpur_pillar" => &[168, 118, 168],
        "chorus_plant" => &[92, 60, 92],
        "chorus_flower" => &[148, 105, 148],
        // Terracotta
        "terracotta" => &[152, 94, 67],
        "white_terracotta" => &[209, 177, 161],
        "orange_terracotta" => &[162, 84, 38],
        "magenta_terracotta" => &[150, 88, 108],
        "light_blue_terracotta" => &[112, 108, 138],
        "yellow_terracotta" => &[188, 133, 35],
        "lime_terracotta" => &[102, 118, 52],
        "gray_terracotta" => &[58, 42, 36],
        "light_gray_terracotta" => &[135, 107, 98],
        "cyan_terracotta" => &[88, 93, 93],
        "purple_terracotta" => &[122, 74, 88],
        "blue_terracotta" => &[74, 62, 92],
        "brown_terracotta" => &[78, 52, 36],
        "red_terracotta" => &[144, 62, 48],
        "black_terracotta" => &[38, 22, 16],
        "pink_terracotta" => &[161, 78, 78],
        "green_terracotta" => &[76, 83, 42],
        // Concrete
        "white_concrete" => &[207, 213, 214],
        "orange_concrete" => &[224, 97, 0],
        "magenta_concrete" => &[169, 48, 159],
        "light_blue_concrete" => &[36, 137, 199],
        "yellow_concrete" => &[241, 175, 21],
        "lime_concrete" => &[94, 168, 24],
        "pink_concrete" => &[213, 101, 142],
        "gray_concrete" => &[55, 58, 62],
        "cyan_concrete" => &[21, 119, 136],
        "blue_concrete" => &[45, 47, 143],
        "red_concrete" => &[142, 33, 33],
        "black_concrete" => &[8, 10, 15],
        "light_gray_concrete" => &[125, 125, 115],
        "green_concrete" => &[73, 91, 36],
        "purple_concrete" => &[100, 31, 156],
        "brown_concrete" => &[96, 59, 31],
        // Wool
        "white_wool" => &[233, 236, 236],
        "orange_wool" => &[240, 118, 19],
        "light_blue_wool" => &[58, 175, 217],
        "yellow_wool" => &[248, 197, 39],
        "lime_wool" => &[112, 185, 25],
        "pink_wool" => &[237, 141, 172],
        "gray_wool" => &[62, 68, 71],
        "light_gray_wool" => &[142, 142, 134],
        "red_wool" => &[162, 38, 35],
        "black_wool" => &[20, 21, 25],
        "magenta_wool" => &[189, 68, 179],
        "cyan_wool" => &[21, 137, 145],
        "purple_wool" => &[121, 42, 172],
        "blue_wool" => &[53, 57, 157],
        "brown_wool" => &[114, 71, 40],
        "green_wool" => &[84, 109, 27],
        // Misc
        "bricks" => &[148, 94, 74],
        "prismarine" => &[99, 171, 158],
        "prismarine_bricks" => &[99, 156, 151],
        "dark_prismarine" => &[51, 91, 75],
        // Coral (warm oceans)
        "tube_coral_block" | "tube_coral" | "tube_coral_fan" => &[49, 87, 206],
        "brain_coral_block" | "brain_coral" | "brain_coral_fan" => &[207, 91, 159],
        "bubble_coral_block" | "bubble_coral" | "bubble_coral_fan" => &[161, 25, 159],
        "fire_coral_block" | "fire_coral" | "fire_coral_fan" => &[163, 35, 46],
        "horn_coral_block" | "horn_coral" | "horn_coral_fan" => &[216, 199, 66],
        "sponge" => &[198, 198, 62],
        "hay_block" => &[165, 142, 18],
        "straw_bed" => &[190, 165, 60],
        "melon" => &[100, 150, 34],
        "pumpkin" | "carved_pumpkin" => &[198, 118, 24],
        "wheat" => &[195, 185, 80],
        "potatoes" => &[80, 155, 60],
        "carrots" => &[220, 120, 35],
        "beetroots" => &[90, 120, 50],
        // Village props (exposed to the sky in generated villages)
        "campfire" | "soul_campfire" => &[150, 100, 50],
        "composter" => &[130, 90, 50],
        "bell" => &[250, 210, 80],
        "cauldron" | "water_cauldron" | "lava_cauldron" | "powder_snow_cauldron" => &[70, 70, 74],
        "chest" | "trapped_chest" | "barrel" => &[140, 105, 60],
        "bookshelf" | "chiseled_bookshelf" => &[150, 120, 75],
        "crafting_table" => &[125, 95, 60],
        "sugar_cane" => &[95, 162, 50],
        "cactus" => &[80, 130, 50],
        "bamboo" => &[85, 150, 32],
        "dripstone_block" | "pointed_dripstone" => &[130, 115, 108],
        // Sulfur caves (26.2) — sulfur is bright yellow, cinnabar is vermilion red
        "sulfur" | "polished_sulfur" | "sulfur_bricks" | "chiseled_sulfur"
            | "sulfur_slab" | "sulfur_stairs" | "sulfur_wall"
            | "sulfur_brick_slab" | "sulfur_brick_stairs" | "sulfur_brick_wall"
            | "polished_sulfur_slab" | "polished_sulfur_stairs" | "polished_sulfur_wall" => &[224, 206, 78],
        "potent_sulfur" => &[236, 198, 40],
        "sulfur_spike" => &[214, 192, 64],
        "cinnabar" | "polished_cinnabar" | "cinnabar_bricks" | "chiseled_cinnabar"
            | "cinnabar_slab" | "cinnabar_stairs" | "cinnabar_wall"
            | "cinnabar_brick_slab" | "cinnabar_brick_stairs" | "cinnabar_brick_wall"
            | "polished_cinnabar_slab" | "polished_cinnabar_stairs" | "polished_cinnabar_wall" => &[176, 48, 42],
        _ => return None,
    })
}

/// Map a Bedrock block name (already stripped of "minecraft:") to the Java
/// canonical name that `block_name_to_rgb` expects.
/// Returns the input unchanged when no mapping is needed.
pub fn normalize_bedrock_block(name: &str) -> &str {
    match name {
        // Bedrock names that differ from Java
        "grass"                => "grass_block",
        "stonebrick"           => "stone_bricks",
        "mossy_stonebrick"     => "mossy_stone_bricks",
        "cracked_stone_bricks" => "stone_bricks",
        "chiseled_stone_bricks"=> "stone_bricks",
        "log"                  => "oak_log",
        "log2"                 => "dark_oak_log",
        "leaves"               => "oak_leaves",
        "leaves2"              => "acacia_leaves",
        "double_plant"         => "tall_grass",
        "waterlily"            => "lily_pad",
        "tallgrass"            => "grass",
        "snow_layer"           => "snow",
        "reeds"                => "sugar_cane",
        "red_flower"           => "poppy",
        "yellow_flower"        => "dandelion",
        // ("vine" passes through — the Java table has a vine color now)
        "fence"                => "oak_planks",
        "wooden_slab"          => "oak_planks",
        "wood_slab"            => "oak_planks",
        "stone_slab"           => "stone",
        "stone_slab2"          => "stone",
        "double_stone_slab"    => "stone",
        "double_stone_slab2"   => "stone",
        "cobblestone_wall"     => "cobblestone",
        "stained_glass"        => "glass",
        "stained_glass_pane"   => "glass",
        "hard_stained_glass"   => "glass",
        "hard_stained_glass_pane" => "glass",
        "concrete_powder"      => "sand",
        // (packed_ice / blue_ice pass through — they have their own entries now)
        "stickypistonarmcollision" | "pistonarmcollision" => "air",
        "movingBlock" | "movingblock" => "air",
        "light_block"          => "air",
        "invisible_bedrock"    => "air",
        "allow"                => "air",
        "deny"                 => "air",
        "border_block"         => "bedrock",
        // Identical names — pass through (Bedrock already matches Java)
        _ => name,
    }
}
