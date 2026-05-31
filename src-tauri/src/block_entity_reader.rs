use crate::region_reader::{find_region_file, read_chunk_nbt};
use fastnbt::Value;
use serde::Serialize;
use std::collections::HashMap;

// ── Output types (mirror the TS interface exactly) ────────────────────────────

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BlockItem {
    pub slot:  i32,
    pub id:    String,
    pub count: i32,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct BlockEntity {
    #[serde(rename = "type")]
    pub kind:    String,
    pub x:       i32,
    pub y:       i32,
    pub z:       i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub items:         Option<Vec<BlockItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spawn_type:    Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_ominous:    Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub front_text:    Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub back_text:     Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub honey_level:   Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bee_count:     Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary_effect:   Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secondary_effect: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disc_id:        Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub book_title:     Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub book_author:    Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ingredients:    Option<Vec<BlockItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sherds:         Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_summon:     Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cooking_item:   Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cooking_items:  Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loot_table:     Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loot_tier:      Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_portal:    Option<[i32; 3]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suspicious_item: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub banner_color:    Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub banner_patterns: Option<Vec<BannerPattern>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skull_owner:     Option<String>,
}

#[derive(Serialize, Clone)]
pub struct BannerPattern {
    pub pattern: String,
    pub color:   String,
}

// ── NBT helpers ───────────────────────────────────────────────────────────────

fn strip_ns(s: &str) -> &str {
    s.strip_prefix("minecraft:").unwrap_or(s)
}

fn cmp(v: &Value) -> Option<&HashMap<String, Value>> {
    if let Value::Compound(m) = v { Some(m) } else { None }
}

fn get<'a>(v: &'a Value, key: &str) -> Option<&'a Value> {
    cmp(v)?.get(key)
}

fn nbt_str(v: &Value) -> &str {
    if let Value::String(s) = v { s.as_str() } else { "" }
}

fn map_str<'a>(m: &'a HashMap<String, Value>, key: &str) -> &'a str {
    m.get(key).map(nbt_str).unwrap_or("")
}

fn map_i32(m: &HashMap<String, Value>, key: &str) -> i32 {
    match m.get(key) {
        Some(Value::Int(n))   => *n,
        Some(Value::Short(n)) => *n as i32,
        Some(Value::Byte(n))  => *n as i32,
        _ => 0,
    }
}

fn map_bool(m: &HashMap<String, Value>, key: &str) -> bool {
    match m.get(key) {
        Some(Value::Byte(n)) => *n != 0,
        _ => false,
    }
}

fn map_list<'a>(m: &'a HashMap<String, Value>, key: &str) -> &'a [Value] {
    match m.get(key) {
        Some(Value::List(l)) => l,
        _ => &[],
    }
}

// ── JSON text component parser ────────────────────────────────────────────────

fn parse_json_text(raw: &str) -> String {
    if raw.is_empty() || raw == "\"\"" || raw == "null" {
        return String::new();
    }
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) {
        if let Some(s) = v.as_str() { return s.to_string(); }
        if let Some(t) = v.get("text").and_then(|t| t.as_str()) { return t.to_string(); }
        if let Some(arr) = v.as_array() {
            return arr.iter().map(|p| {
                p.as_str().map(str::to_string)
                    .or_else(|| p.get("text").and_then(|t| t.as_str()).map(str::to_string))
                    .unwrap_or_default()
            }).collect::<Vec<_>>().join("");
        }
    }
    String::new()
}

fn parse_sign_front(be: &HashMap<String, Value>) -> Vec<String> {
    // 1.20+: front_text.messages
    if let Some(front) = be.get("front_text").and_then(cmp) {
        let msgs = front.get("messages").and_then(|v| if let Value::List(l) = v { Some(l) } else { None }).map(|l| l.as_slice()).unwrap_or(&[]);
        let lines: Vec<String> = msgs.iter().map(|m| parse_json_text(nbt_str(m))).filter(|s| !s.is_empty()).collect();
        if !lines.is_empty() { return lines; }
    }
    // Pre-1.20
    ["Text1", "Text2", "Text3", "Text4"]
        .iter()
        .filter_map(|k| {
            be.get(*k).map(|v| parse_json_text(nbt_str(v)))
        })
        .filter(|s| !s.is_empty())
        .collect()
}

fn parse_sign_back_clean(be: &HashMap<String, Value>) -> Vec<String> {
    let Some(back) = be.get("back_text").and_then(cmp) else { return vec![]; };
    let msgs = back.get("messages").and_then(|v| if let Value::List(l) = v { Some(l) } else { None }).map(|l| l.as_slice()).unwrap_or(&[]);
    msgs.iter().map(|m| parse_json_text(nbt_str(m))).filter(|s| !s.is_empty()).collect()
}

// ── Beacon effect ─────────────────────────────────────────────────────────────

fn beacon_effect_name(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => {
            let id = strip_ns(s).replace('_', " ");
            let capped: String = id.split_whitespace().map(|w| {
                let mut chars = w.chars();
                chars.next().map(|c| c.to_uppercase().collect::<String>() + chars.as_str()).unwrap_or_default()
            }).collect::<Vec<_>>().join(" ");
            Some(capped)
        }
        Value::Int(n) => {
            let name = match n {
                1  => "Speed",
                3  => "Haste",
                5  => "Resistance",
                8  => "Jump Boost",
                10 => "Regeneration",
                11 => "Strength",
                _  => return None,
            };
            Some(name.to_string())
        }
        _ => None,
    }
}

// ── Banner helpers ────────────────────────────────────────────────────────────

const DYE_COLORS: &[&str] = &[
    "white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray",
    "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black",
];

fn banner_pattern_name(code: &str) -> String {
    match code {
        "b" => "Base", "t" => "Chief", "l" => "Pale Dexter", "r" => "Pale Sinister",
        "bs" => "Base Stripe", "ts" => "Top Stripe", "ls" => "Left Stripe", "rs" => "Right Stripe",
        "cs" => "Center Stripe", "ms" => "Middle Stripe", "drs" => "Down Right Stripe", "dls" => "Down Left Stripe",
        "ss" => "Small Stripes", "cr" => "Cross", "sc" => "Saltire",
        "ld" => "Diagonal Right", "rud" => "Diagonal Up Right", "lud" => "Diagonal Up Left", "rd" => "Diagonal Left",
        "vh" => "Per Pale", "vhr" => "Per Pale Reversed", "hh" => "Per Fess", "hhb" => "Per Fess Reversed",
        "bl" => "Base Dexter Canton", "br" => "Base Sinister Canton", "tl" => "Chief Dexter Canton", "tr" => "Chief Sinister Canton",
        "bt" => "Base Bend Sinister", "tt" => "Base Bend", "bts" => "Bottom Left Triangle", "tts" => "Top Right Triangle",
        "mc" => "Lozenge", "mr" => "Rhombus", "bo" => "Border", "cbo" => "Curly Border",
        "bri" => "Brick", "gra" => "Gradient", "gru" => "Gradient Up",
        "cre" => "Creeper", "sku" => "Skull", "flo" => "Flower", "moj" => "Mojang", "glb" => "Globe", "pig" => "Piglin",
        "flo2" => "Flow", "guster" => "Guster",
        other => other,
    }.to_string()
}

fn parse_banner_patterns(be: &HashMap<String, Value>) -> Option<Vec<BannerPattern>> {
    // 1.20.5+: components.minecraft:banner_patterns
    if let Some(comp) = be.get("components").and_then(cmp) {
        if let Some(pats) = comp.get("minecraft:banner_patterns").and_then(|v| if let Value::List(l) = v { Some(l) } else { None }) {
            if !pats.is_empty() {
                return Some(pats.iter().filter_map(|p| {
                    let m = cmp(p)?;
                    let code = strip_ns(map_str(m, "pattern")).to_string();
                    let color_idx = map_i32(m, "color") as usize;
                    let color = DYE_COLORS.get(color_idx).copied().unwrap_or("white").to_string();
                    Some(BannerPattern { pattern: banner_pattern_name(&code), color })
                }).collect());
            }
        }
    }
    // Pre-1.20.5: Patterns list
    let list = map_list(be, "Patterns");
    if list.is_empty() { return None; }
    Some(list.iter().filter_map(|p| {
        let m = cmp(p)?;
        let code = map_str(m, "Pattern").to_string();
        let color_idx = map_i32(m, "Color") as usize;
        let color = DYE_COLORS.get(color_idx).copied().unwrap_or("white").to_string();
        Some(BannerPattern { pattern: banner_pattern_name(&code), color })
    }).collect())
}

// ── Item parsing ──────────────────────────────────────────────────────────────

fn parse_items(be: &HashMap<String, Value>, key: &str) -> Vec<BlockItem> {
    map_list(be, key).iter().filter_map(|item| {
        let m = cmp(item)?;
        let id = strip_ns(map_str(m, "id")).to_string();
        if id.is_empty() { return None; }
        Some(BlockItem {
            slot:  map_i32(m, "Slot"),
            id,
            count: map_i32(m, "Count"),
        })
    }).collect()
}

// ── Type classification ───────────────────────────────────────────────────────

fn is_container(t: &str) -> bool {
    matches!(t,
        "chest" | "trapped_chest" | "barrel" | "hopper" | "dropper" | "dispenser" |
        "shulker_box" |
        "white_shulker_box" | "orange_shulker_box" | "magenta_shulker_box" | "light_blue_shulker_box" |
        "yellow_shulker_box" | "lime_shulker_box" | "pink_shulker_box" | "gray_shulker_box" |
        "light_gray_shulker_box" | "cyan_shulker_box" | "purple_shulker_box" | "blue_shulker_box" |
        "brown_shulker_box" | "green_shulker_box" | "red_shulker_box" | "black_shulker_box" |
        "chiseled_bookshelf" | "crafter"
    )
}

fn is_sign(t: &str) -> bool {
    t == "sign" || t == "wall_sign" || t == "hanging_sign" || t == "wall_hanging_sign"
        || t.ends_with("_sign") || t.ends_with("_wall_sign")
        || t.ends_with("_hanging_sign") || t.ends_with("_wall_hanging_sign")
}

fn is_furnace(t: &str) -> bool {
    matches!(t, "furnace" | "blast_furnace" | "smoker")
}

// ── Loot tier ────────────────────────────────────────────────────────────────
// S = best-in-game, A = high value, B = moderate (default), C = common/filler

fn loot_tier(table: &str) -> &'static str {
    match table {
        // S
        "chests/end_city_treasure"
        | "chests/bastion_treasure"
        | "chests/buried_treasure"
        | "chests/ancient_city"                        => "S",
        // A
        "chests/stronghold_library"
        | "chests/stronghold_corridor"
        | "chests/stronghold_crossing"
        | "chests/desert_pyramid"
        | "chests/woodland_mansion"
        | "chests/pillager_outpost"
        | "chests/trial_chambers/reward_ominous"
        | "chests/trial_chambers/reward"               => "A",
        // B
        "chests/abandoned_mineshaft"
        | "chests/simple_dungeon"
        | "chests/nether_bridge"
        | "chests/bastion_other"
        | "chests/bastion_hoglin_stable"
        | "chests/bastion_bridge"
        | "chests/ruined_portal"
        | "chests/shipwreck_treasure"
        | "chests/ocean_ruin_big"
        | "chests/jungle_temple"
        | "chests/jungle_temple_dispenser"
        | "chests/trial_chambers/corridor"
        | "chests/trial_chambers/intersection"
        | "chests/trial_chambers/intersection_barrel"
        | "chests/trail_ruins/rare"                    => "B",
        // C
        "chests/village/village_plains_house"
        | "chests/village/village_taiga_house"
        | "chests/village/village_savanna_house"
        | "chests/village/village_snowy_house"
        | "chests/village/village_desert_house"
        | "chests/village/village_weaponsmith"
        | "chests/village/village_toolsmith"
        | "chests/village/village_armorer"
        | "chests/village/village_cartographer"
        | "chests/village/village_mason"
        | "chests/village/village_tannery"
        | "chests/village/village_temple"
        | "chests/village/village_shepherd"
        | "chests/village/village_butcher"
        | "chests/village/village_fletcher"
        | "chests/village/village_fisher"
        | "chests/igloo_chest"
        | "chests/shipwreck_supply"
        | "chests/shipwreck_map"
        | "chests/ocean_ruin_small"
        | "chests/spawn_bonus_chest"
        | "chests/trail_ruins/common"
        | "chests/trial_chambers/supply"
        | "chests/trial_chambers/entrance"             => "C",
        _                                              => "B",
    }
}

// ── Main extractor ────────────────────────────────────────────────────────────

fn extract_block_entities(chunk: &Value) -> Vec<BlockEntity> {
    // 1.18+ is flat; pre-1.18 has Level wrapper
    let root = if get(chunk, "block_entities").is_some() || get(chunk, "TileEntities").is_some() {
        chunk
    } else if let Some(level) = get(chunk, "Level") {
        level
    } else {
        chunk
    };

    let root_m = match cmp(root) {
        Some(m) => m,
        None    => return vec![],
    };

    let be_list: &[Value] = match root_m.get("block_entities").or_else(|| root_m.get("TileEntities")) {
        Some(Value::List(l)) => l,
        _ => return vec![],
    };

    let mut out = Vec::new();

    for be_val in be_list {
        let Some(be) = cmp(be_val) else { continue };
        let raw_type = map_str(be, "id");
        let kind = strip_ns(raw_type).to_string();
        if kind.is_empty() { continue; }

        let x = map_i32(be, "x");
        let y = map_i32(be, "y");
        let z = map_i32(be, "z");

        let mut entity = BlockEntity {
            kind: kind.clone(), x, y, z,
            items: None, spawn_type: None, is_ominous: None,
            front_text: None, back_text: None,
            honey_level: None, bee_count: None,
            primary_effect: None, secondary_effect: None,
            disc_id: None, book_title: None, book_author: None,
            ingredients: None, sherds: None, can_summon: None,
            cooking_item: None, cooking_items: None, loot_table: None, loot_tier: None,
            exit_portal: None, suspicious_item: None,
            banner_color: None, banner_patterns: None,
            skull_owner: None,
        };

        if is_container(&kind) {
            let loot = strip_ns(map_str(be, "LootTable")).to_string();
            if !loot.is_empty() {
                entity.loot_tier  = Some(loot_tier(&loot).to_string());
                entity.loot_table = Some(loot);
            } else {
                let items = parse_items(be, "Items");
                if !items.is_empty() { entity.items = Some(items); }
            }
        } else if kind == "mob_spawner" {
            let spawn_data = be.get("SpawnData").and_then(cmp);
            let id = spawn_data
                .and_then(|sd| sd.get("entity").and_then(cmp))
                .map(|e| map_str(e, "id"))
                .or_else(|| spawn_data.map(|sd| map_str(sd, "EntityId")))
                .or_else(|| Some(map_str(be, "EntityId")))
                .map(strip_ns)
                .filter(|s| !s.is_empty())
                .map(str::to_string);
            entity.spawn_type = id;
        } else if kind == "trial_spawner" {
            let spawn_data = be.get("spawn_data").and_then(cmp);
            let id = spawn_data
                .and_then(|sd| sd.get("entity").and_then(cmp))
                .map(|e| map_str(e, "id"))
                .map(strip_ns)
                .filter(|s| !s.is_empty())
                .map(str::to_string);
            entity.spawn_type = id;
            entity.is_ominous = Some(map_bool(be, "ominous"));
        } else if is_sign(&kind) {
            let front = parse_sign_front(be);
            let back  = parse_sign_back_clean(be);
            if !front.is_empty() { entity.front_text = Some(front); }
            if !back.is_empty()  { entity.back_text  = Some(back);  }
        } else if kind == "beehive" || kind == "bee_nest" {
            entity.honey_level = Some(be.get("honey_level").or_else(|| be.get("HoneyLevel"))
                .map(|v| match v { Value::Int(n) => *n, Value::Byte(n) => *n as i32, _ => 0 })
                .unwrap_or(0));
            entity.bee_count = Some(map_list(be, "Bees").len() as i32);
        } else if kind == "beacon" {
            entity.primary_effect = be.get("primary_effect").or_else(|| be.get("Primary"))
                .and_then(beacon_effect_name);
            entity.secondary_effect = be.get("secondary_effect").or_else(|| be.get("Secondary"))
                .and_then(beacon_effect_name);
        } else if kind == "jukebox" {
            if let Some(rec) = be.get("RecordItem").and_then(cmp) {
                let disc = strip_ns(map_str(rec, "id")).to_string();
                if !disc.is_empty() { entity.disc_id = Some(disc); }
            }
        } else if kind == "lectern" {
            if let Some(book_outer) = be.get("Book").and_then(cmp) {
                let book_tag = book_outer.get("tag").and_then(cmp)
                    .or_else(|| book_outer.get("components").and_then(cmp)
                        .and_then(|c| c.get("minecraft:written_book_content").and_then(cmp)));
                if let Some(bt) = book_tag {
                    let title = bt.get("title").or_else(|| bt.get("Title")).map(nbt_str).unwrap_or("").to_string();
                    let author = bt.get("author").or_else(|| bt.get("Author")).map(nbt_str).unwrap_or("").to_string();
                    if !title.is_empty() { entity.book_title = Some(title); }
                    if !author.is_empty() { entity.book_author = Some(author); }
                }
            }
        } else if kind == "brewing_stand" {
            entity.ingredients = Some(parse_items(be, "Items"));
        } else if is_furnace(&kind) {
            let items = parse_items(be, "Items");
            entity.cooking_item = items.into_iter().find(|i| i.slot == 0).map(|i| i.id);
        } else if kind == "campfire" || kind == "soul_campfire" {
            let ids: Vec<String> = parse_items(be, "Items").into_iter().map(|i| i.id).filter(|s| !s.is_empty()).collect();
            if !ids.is_empty() { entity.cooking_items = Some(ids); }
        } else if kind == "decorated_pot" {
            let sherds: Vec<String> = map_list(be, "sherds").iter()
                .map(|v| strip_ns(nbt_str(v)).to_string())
                .filter(|s| !s.is_empty())
                .collect();
            if !sherds.is_empty() { entity.sherds = Some(sherds); }
        } else if kind == "sculk_shrieker" {
            entity.can_summon = Some(map_bool(be, "can_summon"));
        } else if kind == "vault" {
            let loot = be.get("loot_table").or_else(|| {
                be.get("config").and_then(cmp).and_then(|c| c.get("loot_table"))
            }).map(nbt_str).map(strip_ns).filter(|s| !s.is_empty()).map(str::to_string);
            entity.loot_table = loot;
        } else if kind == "end_gateway" {
            if let Some(ep) = be.get("ExitPortal").and_then(cmp) {
                entity.exit_portal = Some([map_i32(ep, "X"), map_i32(ep, "Y"), map_i32(ep, "Z")]);
            }
        } else if kind == "chiseled_bookshelf" {
            let items: Vec<BlockItem> = parse_items(be, "Items").into_iter().filter(|i| {
                matches!(i.id.as_str(), "book" | "written_book" | "writable_book" | "enchanted_book" | "knowledge_book")
            }).collect();
            if !items.is_empty() { entity.items = Some(items); }
        } else if kind == "banner" {
            entity.banner_color = Some(map_str(be, "Base").to_string());
            entity.banner_patterns = parse_banner_patterns(be);
        } else if kind == "suspicious_sand" || kind == "suspicious_gravel" {
            if let Some(item) = be.get("item").and_then(cmp) {
                let id = strip_ns(map_str(item, "id")).to_string();
                if !id.is_empty() { entity.suspicious_item = Some(id); }
            }
        } else if kind == "crafter" {
            let items = parse_items(be, "Items");
            if !items.is_empty() { entity.items = Some(items); }
        } else if matches!(kind.as_str(), "skull" | "player_head" | "player_wall_head") {
            // 1.20.5+: profile.name; pre-1.20.5: Owner.Name / ExtraType
            let name = be.get("profile").and_then(cmp)
                .map(|p| map_str(p, "name"))
                .or_else(|| be.get("Owner").and_then(cmp).map(|o| map_str(o, "Name")))
                .or_else(|| Some(map_str(be, "ExtraType")))
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string);
            entity.skull_owner = name;
        }

        out.push(entity);
    }

    out
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Public bridge for Bedrock: extract a single BlockEntity from a pre-built
/// fastnbt::Value::Compound with normalized "id" field.
pub fn extract_single_block_entity(v: &Value) -> Option<BlockEntity> {
    let be = cmp(v)?;
    let raw_type = map_str(be, "id");
    let kind = strip_ns(raw_type).to_string();
    if kind.is_empty() { return None; }
    let x = map_i32(be, "x");
    let y = map_i32(be, "y");
    let z = map_i32(be, "z");
    Some(extract_one_block_entity(be, &kind, x, y, z))
}

fn extract_one_block_entity(
    be:   &HashMap<String, Value>,
    kind: &str,
    x:    i32,
    y:    i32,
    z:    i32,
) -> BlockEntity {
    // Re-use the existing extractor by wrapping in a fake chunk compound
    // that looks like a 1.18+ chunk with a single block_entities list.
    let chunk_compound = Value::Compound({
        let mut m = HashMap::new();
        m.insert("block_entities".to_string(), Value::List(vec![
            Value::Compound({
                let mut be_m = be.clone();
                be_m.insert("id".to_string(), Value::String(kind.to_string()));
                be_m.insert("x".to_string(), Value::Int(x));
                be_m.insert("y".to_string(), Value::Int(y));
                be_m.insert("z".to_string(), Value::Int(z));
                be_m
            })
        ]));
        m
    });
    extract_block_entities(&chunk_compound)
        .into_iter()
        .next()
        .unwrap_or(BlockEntity { kind: kind.to_string(), x, y, z, ..Default::default() })
}

pub fn get_block_entities(
    world_dir: &str,
    dimension: &str,
    min_cx: i32, min_cz: i32,
    max_cx: i32, max_cz: i32,
) -> Vec<BlockEntity> {
    // Group chunk range by region
    let mut by_region: HashMap<(i32, i32), Vec<(i32, i32)>> = HashMap::new();
    for cz in min_cz..=max_cz {
        for cx in min_cx..=max_cx {
            let rx = cx.div_euclid(32);
            let rz = cz.div_euclid(32);
            by_region.entry((rx, rz)).or_default().push((cx, cz));
        }
    }

    let mut out = Vec::new();

    for ((rx, rz), chunks) in &by_region {
        let Some(path) = find_region_file(world_dir, dimension, *rx, *rz) else { continue };
        let Ok(file_buf) = std::fs::read(&path) else { continue };
        if file_buf.len() < 4096 { continue; }

        for &(cx, cz) in chunks {
            let lx = cx.rem_euclid(32) as usize;
            let lz = cz.rem_euclid(32) as usize;
            let Some(chunk_val) = read_chunk_nbt(&file_buf, lx, lz) else { continue };
            out.extend(extract_block_entities(&chunk_val));
        }
    }

    out
}

// ── Tauri command ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_block_entities_cmd(
    world_dir: String,
    edition:   String,
    dimension: String,
    min_cx:    i32,
    min_cz:    i32,
    max_cx:    i32,
    max_cz:    i32,
    db_cache:  tauri::State<'_, crate::BedrockDbCache>,
) -> Result<Vec<BlockEntity>, ()> {
    if edition == "bedrock" {
        Ok(db_cache.with(&world_dir, |db| {
            crate::bedrock::block_entity_reader::get_bedrock_block_entities(
                db, &dimension, min_cx, min_cz, max_cx, max_cz,
            )
        }).unwrap_or_default())
    } else {
        Ok(tauri::async_runtime::spawn_blocking(move || {
            get_block_entities(&world_dir, &dimension, min_cx, min_cz, max_cx, max_cz)
        }).await.unwrap_or_default())
    }
}
