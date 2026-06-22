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

    if let Some(&[r, g, b]) = lookup(name) {
        return [r, g, b];
    }

    // Deterministic grey fallback for unknown blocks
    let mut h: i32 = 0;
    for c in name.bytes() {
        h = h.wrapping_shl(5).wrapping_sub(h).wrapping_add(c as i32);
    }
    let v = (80 + (h.unsigned_abs() % 80)) as u8;
    [v, v, v]
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
        "bedrock" => &[75, 75, 75],
        "obsidian" => &[20, 15, 30],
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
        // Ores
        "coal_ore" | "deepslate_coal_ore" => &[85, 85, 85],
        "iron_ore" | "deepslate_iron_ore" => &[175, 148, 140],
        "copper_ore" => &[124, 148, 148],
        "gold_ore" | "deepslate_gold_ore" => &[210, 192, 102],
        "redstone_ore" => &[195, 80, 80],
        "diamond_ore" => &[100, 220, 212],
        "lapis_ore" => &[74, 128, 240],
        "emerald_ore" => &[45, 190, 100],
        "ancient_debris" => &[100, 68, 60],
        // Blocks (processed)
        "iron_block" => &[216, 216, 216],
        "gold_block" => &[244, 210, 48],
        "copper_block" => &[196, 127, 95],
        "diamond_block" => &[96, 222, 218],
        "emerald_block" => &[48, 200, 108],
        "netherite_block" => &[64, 58, 65],
        "amethyst_block" => &[148, 100, 198],
        "raw_iron_block" => &[196, 162, 138],
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
        "quartz_block" => &[228, 224, 218],
        "magma_block" => &[164, 72, 14],
        "soul_sand" => &[108, 84, 68],
        "soul_soil" => &[96, 75, 60],
        "basalt" => &[78, 78, 82],
        "blackstone" => &[48, 42, 55],
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
        "end_stone" => &[220, 222, 165],
        "purpur_block" => &[168, 118, 168],
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
        // Misc
        "bricks" => &[148, 94, 74],
        "prismarine" => &[99, 171, 158],
        "sponge" => &[198, 198, 62],
        "hay_block" => &[165, 142, 18],
        "melon" => &[100, 150, 34],
        "pumpkin" | "carved_pumpkin" => &[198, 118, 24],
        "wheat" => &[195, 185, 80],
        "potatoes" => &[80, 155, 60],
        "carrots" => &[220, 120, 35],
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
        "vine"                 => "grass",       // no vine color, use green
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
        "packed_ice"           => "ice",
        "blue_ice"             => "ice",
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
