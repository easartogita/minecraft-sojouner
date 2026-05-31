use crate::region_reader::{find_entity_file, find_region_file, read_chunk_nbt};
use fastnbt::Value;
use serde::Serialize;
use std::collections::HashMap;

// ── Output types (mirror the TS GameEntity interface exactly) ─────────────────

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EntityItem {
    pub id:    String,
    pub count: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enchantment: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VillagerTrade {
    pub buy:      EntityItem,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub buy_b:    Option<EntityItem>,
    pub sell:     EntityItem,
    pub uses:     i32,
    pub max_uses: i32,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GameEntity {
    #[serde(rename = "type")]
    pub kind: String,
    pub x: i32,
    pub y: i32,
    pub z: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_name:           Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub villager_profession:   Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub villager_type:         Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub villager_level:        Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trades:                Option<Vec<VillagerTrade>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tamed:                 Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub saddled:               Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub horse_armor:           Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub horse_variant:         Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chest_items:           Option<Vec<EntityItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loot_table:            Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub llama_strength:        Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub llama_decor:           Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub llama_variant:         Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub painting_variant:      Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frame_item:            Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frame_item_enchantment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frame_rotation:        Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub armor_items:           Option<Vec<EntityItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hand_items:            Option<Vec<EntityItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub armor_stand_invisible: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dragon_health:         Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dragon_phase:          Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wither_health:         Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collar_color:          Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pet_variant:           Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_screaming:          Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_player_created:     Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oxidation_level:       Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_waxed:              Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversion_time:       Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_sitting:            Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_nectar:            Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mob_size:              Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub beam_target:           Option<[i32; 3]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speed:                 Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jump_height:           Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_baby:               Option<bool>,
}

// ── NBT helpers ───────────────────────────────────────────────────────────────

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

fn map_float(m: &HashMap<String, Value>, key: &str) -> Option<f32> {
    match m.get(key) {
        Some(Value::Float(v)) => Some(*v),
        Some(Value::Double(v)) => Some(*v as f32),
        Some(Value::Int(v)) => Some(*v as f32),
        _ => None,
    }
}

fn strip_ns(s: &str) -> &str {
    s.strip_prefix("minecraft:").unwrap_or(s)
}

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

// ── Item / enchantment helpers ────────────────────────────────────────────────

const DYE_COLORS: &[&str] = &[
    "white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray",
    "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black",
];

fn format_id(id: &str) -> String {
    let id = strip_ns(id);
    id.split('_').map(|w| {
        let mut c = w.chars();
        match c.next() {
            None => String::new(),
            Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        }
    }).collect::<Vec<_>>().join(" ")
}

fn parse_first_enchantment(item_m: &HashMap<String, Value>) -> Option<String> {
    // Pre-1.20.5: tag.StoredEnchantments or tag.Enchantments
    if let Some(tag_v) = item_m.get("tag").and_then(cmp) {
        // Stored enchantments (books)
        if let Some(Value::List(stored)) = tag_v.get("StoredEnchantments") {
            if let Some(first) = stored.first() {
                if let Some(m) = cmp(first) {
                    let id = format_id(map_str(m, "id"));
                    let lvl = map_i32(m, "lvl");
                    return Some(if lvl > 1 { format!("{id} {lvl}") } else { id });
                }
            }
        }
        if let Some(Value::List(enchs)) = tag_v.get("Enchantments") {
            if let Some(first) = enchs.first() {
                if let Some(m) = cmp(first) {
                    let id = format_id(map_str(m, "id"));
                    let lvl = map_i32(m, "lvl");
                    return Some(if lvl > 1 { format!("{id} {lvl}") } else { id });
                }
            }
        }
    }
    // 1.20.5+ components
    if let Some(comp_v) = item_m.get("components").and_then(cmp) {
        for key in &["minecraft:stored_enchantments", "minecraft:enchantments"] {
            if let Some(ench_v) = comp_v.get(*key).and_then(cmp) {
                if let Some(levels_m) = ench_v.get("levels").and_then(cmp) {
                    if let Some((k, v)) = levels_m.iter().next() {
                        let lvl = match v { Value::Int(n) => *n, _ => 0 };
                        let id = format_id(k);
                        return Some(if lvl > 1 { format!("{id} {lvl}") } else { id });
                    }
                }
            }
        }
    }
    None
}

fn parse_entity_item(item_v: Option<&Value>) -> Option<EntityItem> {
    let m = item_v.and_then(cmp)?;
    let id = map_str(m, "id");
    if id.is_empty() { return None; }
    // Pre-1.20.5: Count (byte); 1.20.5+: count (int)
    let count = match m.get("Count").or_else(|| m.get("count")) {
        Some(Value::Int(n))   => *n,
        Some(Value::Short(n)) => *n as i32,
        Some(Value::Byte(n))  => *n as i32,
        _ => 1,
    };
    Some(EntityItem {
        id:          strip_ns(id).to_string(),
        count,
        enchantment: parse_first_enchantment(m),
    })
}

/// Return the item id from either a legacy direct compound or `equipment.{slot}` (1.21.4+).
fn equipment_item_id(e: &HashMap<String, Value>, legacy_key: &str, equip_slot: &str) -> String {
    let legacy = e.get(legacy_key).and_then(cmp)
        .map(|m| map_str(m, "id").to_string())
        .unwrap_or_default();
    if !legacy.is_empty() { return legacy; }
    e.get("equipment").and_then(cmp)
        .and_then(|eq| eq.get(equip_slot)).and_then(cmp)
        .map(|m| map_str(m, "id").to_string())
        .unwrap_or_default()
}

/// Read held items from either the legacy `HandItems` list (pre-1.21.4) or the
/// new `equipment` compound (1.21.4+, used by copper_golem and other new mobs).
fn parse_hand_items(e: &HashMap<String, Value>) -> Vec<EntityItem> {
    // Legacy list format
    let from_list = parse_item_list(map_list(e, "HandItems"));
    if !from_list.is_empty() { return from_list; }
    // New compound format: equipment.mainhand / equipment.offhand
    if let Some(equip) = e.get("equipment").and_then(cmp) {
        let main = parse_entity_item(equip.get("mainhand"));
        let off  = parse_entity_item(equip.get("offhand"));
        let items: Vec<EntityItem> = [main, off].into_iter().flatten()
            .filter(|i| !i.id.is_empty())
            .collect();
        if !items.is_empty() { return items; }
    }
    vec![]
}

fn parse_item_list(list: &[Value]) -> Vec<EntityItem> {
    list.iter()
        .filter_map(|v| parse_entity_item(Some(v)))
        .filter(|i| !i.id.is_empty())
        .collect()
}

// ── Horse variant helpers ─────────────────────────────────────────────────────

const HORSE_COLORS:   &[&str] = &["White", "Creamy", "Chestnut", "Brown", "Black", "Gray", "Dark Brown"];
const HORSE_PATTERNS: &[&str] = &["", " Socks", " Snowflake", " Splashed", " Blaze", " Milky", " Paint", " Tobiano"];
const LLAMA_VARIANTS: &[&str] = &["Creamy", "White", "Brown", "Gray"];

fn parse_horse_variant(v: i32) -> String {
    let color   = (v & 0xFF) as usize;
    let pattern = ((v >> 8) & 0xFF) as usize;
    let c = HORSE_COLORS  .get(color)   .copied().unwrap_or("Unknown");
    let p = HORSE_PATTERNS.get(pattern) .copied().unwrap_or("");
    format!("{c}{p}")
}

// ── Tropical fish ─────────────────────────────────────────────────────────────

const SMALL_PATTERNS: &[&str] = &["kob", "sunstreak", "splotch", "dasher", "brinely", "spotty"];
const LARGE_PATTERNS: &[&str] = &["flopper", "stripey", "glitter", "blockfish", "betty", "clayfish"];

fn parse_tropical_fish_variant(v: i32) -> String {
    let base_color = (v & 0xFF) as usize;
    let pattern    = ((v >> 8) & 0xFF) as usize;
    let top_color  = ((v >> 16) & 0xFF) as usize;
    let large      = ((v >> 24) & 0xFF) == 1;
    let patterns   = if large { LARGE_PATTERNS } else { SMALL_PATTERNS };
    let pat_name   = patterns.get(pattern).copied().unwrap_or("unknown");
    let base = DYE_COLORS.get(base_color).copied().unwrap_or("unknown");
    let top  = DYE_COLORS.get(top_color) .copied().unwrap_or("unknown");
    if base == top { format!("{base} {pat_name}") } else { format!("{base}_{top} {pat_name}") }
}

// ── Attribute helpers ─────────────────────────────────────────────────────────

fn get_attribute_base(m: &HashMap<String, Value>, names: &[&str]) -> Option<f64> {
    // Try 1.16+ `attributes` (id/base) then legacy `Attributes` (Name/Base)
    for key in &["attributes", "Attributes"] {
        if let Some(Value::List(list)) = m.get(*key) {
            for a in list {
                if let Some(am) = cmp(a) {
                    let id = strip_ns(
                        if map_str(am, "id").is_empty() { map_str(am, "Name") }
                        else { map_str(am, "id") }
                    );
                    if names.iter().any(|n| *n == id) {
                        let v = am.get("base").or_else(|| am.get("Base"));
                        let val = match v {
                            Some(Value::Double(d)) => *d,
                            Some(Value::Float(f))  => *f as f64,
                            _ => continue,
                        };
                        return Some(val);
                    }
                }
            }
        }
    }
    None
}

const FIXED_MOUNT_SPEED: &[(&str, f64)] = &[
    ("donkey",         0.175),
    ("mule",           0.175),
    ("skeleton_horse", 0.2),
    ("zombie_horse",   0.2),
];

fn attr_to_speed(a: f64) -> f64 {
    (a * 43.178 * 10.0).round() / 10.0
}

fn jump_strength_to_height(v: f64) -> f64 {
    let h = -0.1817584952 * v * v * v + 3.689713227 * v * v + 2.128599678 * v;
    (h * 10.0).round() / 10.0
}

// ── Villager trade helpers ────────────────────────────────────────────────────

fn parse_item_from_map(m: &HashMap<String, Value>) -> Option<EntityItem> {
    let id = map_str(m, "id");
    if id.is_empty() { return None; }
    Some(EntityItem {
        id:          strip_ns(id).to_string(),
        count:       map_i32(m, "Count"),
        enchantment: parse_first_enchantment(m),
    })
}

fn parse_villager_trade(r: &HashMap<String, Value>) -> Option<VillagerTrade> {
    let buy_m  = r.get("buy") .or_else(|| r.get("inputItem1")).and_then(cmp);
    let buyb_m = r.get("buyB").or_else(|| r.get("inputItem2")).and_then(cmp);
    let sell_m = r.get("sell").or_else(|| r.get("result"))    .and_then(cmp);

    let buy  = buy_m.and_then(parse_item_from_map)?;
    let sell = sell_m.and_then(parse_item_from_map)?;
    let buy_b = buyb_m.and_then(parse_item_from_map);

    Some(VillagerTrade {
        buy,
        buy_b,
        sell,
        uses:     r.get("uses")   .and_then(|v| if let Value::Int(n) = v { Some(*n) } else { None }).unwrap_or(0),
        max_uses: r.get("maxUses").and_then(|v| if let Value::Int(n) = v { Some(*n) } else { None }).unwrap_or(0),
    })
}

// ── Entity extractor ──────────────────────────────────────────────────────────

fn extract_entity(e: &HashMap<String, Value>) -> Option<GameEntity> {
    let raw_id = map_str(e, "id");
    if raw_id.is_empty() { return None; }
    let kind = strip_ns(raw_id).to_string();

    // Position from Pos list
    let pos = e.get("Pos").and_then(|v| if let Value::List(l) = v { Some(l) } else { None })?;
    if pos.len() < 3 { return None; }
    let x = match &pos[0] { Value::Double(d) => d.round() as i32, Value::Float(f) => f.round() as i32, _ => return None };
    let y = match &pos[1] { Value::Double(d) => d.round() as i32, Value::Float(f) => f.round() as i32, _ => return None };
    let z = match &pos[2] { Value::Double(d) => d.round() as i32, Value::Float(f) => f.round() as i32, _ => return None };

    let custom_name: Option<String> = {
        let raw = map_str(e, "CustomName");
        if raw.is_empty() { None }
        else {
            let parsed = parse_json_text(raw);
            Some(if parsed.is_empty() { raw.to_string() } else { parsed })
        }
    };

    let mut entity = GameEntity {
        kind: kind.clone(),
        x, y, z,
        custom_name: custom_name.clone(),
        ..Default::default()
    };

    // Baby detection: Age < 0 means the mob is a juvenile
    let age = match e.get("Age") {
        Some(Value::Int(n))   => *n,
        Some(Value::Short(n)) => *n as i32,
        _ => 0,
    };
    if age < 0 { entity.is_baby = Some(true); }

    // ── Per-type extraction ──────────────────────────────────────────────────

    if kind == "villager" || kind == "wandering_trader" || kind == "zombie_villager" {
        if let Some(vd) = e.get("VillagerData").and_then(cmp) {
            entity.villager_profession = {
                let s = strip_ns(map_str(vd, "profession")).to_string();
                if s.is_empty() { None } else { Some(s) }
            };
            entity.villager_type = {
                let s = strip_ns(map_str(vd, "type")).to_string();
                if s.is_empty() { None } else { Some(s) }
            };
            entity.villager_level = {
                let l = map_i32(vd, "level");
                if l == 0 { None } else { Some(l) }
            };
        }
        let recipes: Vec<VillagerTrade> = e.get("Offers")
            .and_then(cmp)
            .and_then(|o| o.get("Recipes"))
            .and_then(|v| if let Value::List(l) = v { Some(l) } else { None })
            .map(|recipes| recipes.iter().filter_map(|r| cmp(r).and_then(parse_villager_trade)).collect())
            .unwrap_or_default();
        if !recipes.is_empty() { entity.trades = Some(recipes); }

        if kind == "zombie_villager" {
            let conv = e.get("ConversionTime").and_then(|v| if let Value::Int(n) = v { Some(*n) } else { None }).unwrap_or(-1);
            entity.conversion_time = Some(conv);
        }
        return Some(entity);
    }

    if kind == "painting" {
        let variant = strip_ns(
            if map_str(e, "variant").is_empty() { map_str(e, "Motive") } else { map_str(e, "variant") }
        ).to_string();
        entity.painting_variant = if variant.is_empty() { None } else { Some(variant) };
        return Some(entity);
    }

    if kind == "item_frame" || kind == "glow_item_frame" {
        let item_m = e.get("Item").and_then(cmp)?;
        let item = parse_entity_item(e.get("Item"))?;
        if item.id.is_empty() || item.id == "air" { return None; }
        entity.frame_item = Some(item.id.clone());
        entity.frame_item_enchantment = item.enchantment.clone();
        entity.frame_rotation = {
            let r = match e.get("ItemRotation") {
                Some(Value::Byte(n)) => *n as i32,
                Some(Value::Int(n)) => *n,
                _ => 0,
            };
            Some(r)
        };
        let _ = item_m;
        return Some(entity);
    }

    if kind == "armor_stand" {
        let armor_list = map_list(e, "ArmorItems");
        let hand_list  = map_list(e, "HandItems");
        entity.armor_items = Some(parse_item_list(armor_list));
        entity.hand_items  = Some(parse_item_list(hand_list));
        entity.armor_stand_invisible = Some(map_bool(e, "Invisible"));
        let ai = entity.armor_items.as_ref().map(|l| l.is_empty()).unwrap_or(true);
        let hi = entity.hand_items .as_ref().map(|l| l.is_empty()).unwrap_or(true);
        if ai && hi && custom_name.is_none() { return None; }
        return Some(entity);
    }

    if kind == "horse" {
        entity.tamed   = Some(map_bool(e, "Tame"));
        let saddle_id = equipment_item_id(e, "SaddleItem", "saddle");
        entity.saddled = Some(!saddle_id.is_empty() && saddle_id != "minecraft:air");
        let armor_id  = equipment_item_id(e, "ArmorItem", "body");
        if !armor_id.is_empty() && armor_id != "minecraft:air" {
            entity.horse_armor = Some(strip_ns(&armor_id).to_string());
        }
        let variant_int = match e.get("Variant") {
            Some(Value::Int(n)) => *n,
            Some(Value::Short(n)) => *n as i32,
            _ => 0,
        };
        entity.horse_variant = Some(parse_horse_variant(variant_int));
        let spd  = get_attribute_base(e, &["movement_speed", "generic.movement_speed", "generic.movementSpeed"]);
        let jump = get_attribute_base(e, &["jump_strength", "generic.jump_strength", "horse.jumpStrength"]);
        if let Some(s) = spd  { entity.speed       = Some(attr_to_speed(s)); }
        if let Some(j) = jump { entity.jump_height  = Some(jump_strength_to_height(j)); }
        return Some(entity);
    }

    if matches!(kind.as_str(), "donkey" | "mule" | "zombie_horse" | "skeleton_horse") {
        entity.tamed  = Some(map_bool(e, "Tame"));
        entity.saddled = entity.tamed;
        if map_bool(e, "ChestedHorse") {
            entity.chest_items = Some(parse_item_list(map_list(e, "Items")));
        }
        let spd = get_attribute_base(e, &["movement_speed", "generic.movement_speed", "generic.movementSpeed"])
            .or_else(|| FIXED_MOUNT_SPEED.iter().find(|(k, _)| *k == kind).map(|(_, v)| *v));
        if let Some(s) = spd { entity.speed = Some(attr_to_speed(s)); }
        return Some(entity);
    }

    if kind == "camel" {
        entity.saddled = Some(map_bool(e, "Saddled"));
        let spd = get_attribute_base(e, &["movement_speed", "generic.movement_speed"]);
        if let Some(s) = spd { entity.speed = Some(attr_to_speed(s)); }
        return Some(entity);
    }

    if kind == "happy_ghast" {
        // HarnessItem (1.21.5 legacy) → equipment.saddle (1.21.4+ format) → Saddled bool
        let harness_id = equipment_item_id(e, "HarnessItem", "saddle");
        let saddle_id  = if harness_id.is_empty() { equipment_item_id(e, "SaddleItem", "saddle") } else { harness_id };
        entity.saddled = Some(map_bool(e, "Saddled") || (!saddle_id.is_empty() && saddle_id != "minecraft:air"));
        return Some(entity);
    }

    if kind == "llama" || kind == "trader_llama" {
        entity.tamed  = Some(map_bool(e, "Tame"));
        let strength = match e.get("Strength") { Some(Value::Int(n)) => *n, _ => 0 };
        entity.llama_strength = if strength > 0 { Some(strength) } else { None };
        let variant_int = match e.get("Variant") { Some(Value::Int(n)) => *n as usize, _ => 99 };
        entity.llama_variant = LLAMA_VARIANTS.get(variant_int).map(|s| s.to_string());
        let decor_id = equipment_item_id(e, "DecorItem", "body");
        if !decor_id.is_empty() && decor_id != "minecraft:air" {
            entity.llama_decor = Some(strip_ns(&decor_id).to_string());
        }
        if map_bool(e, "ChestedHorse") {
            entity.chest_items = Some(parse_item_list(map_list(e, "Items")));
        }
        let spd = get_attribute_base(e, &["movement_speed", "generic.movement_speed"]);
        if let Some(s) = spd { entity.speed = Some(attr_to_speed(s)); }
        return Some(entity);
    }

    if matches!(kind.as_str(), "chest_minecart" | "hopper_minecart" | "chest_boat") {
        let loot = map_str(e, "LootTable").to_string();
        if !loot.is_empty() {
            entity.loot_table = Some(strip_ns(&loot).to_string());
        } else {
            entity.chest_items = Some(parse_item_list(map_list(e, "Items")));
            if entity.chest_items.as_ref().map(|l| l.is_empty()).unwrap_or(true) && custom_name.is_none() {
                return None;
            }
        }
        return Some(entity);
    }

    if kind == "wolf" {
        entity.tamed = Some(map_bool(e, "Tame"));
        if entity.tamed == Some(true) {
            let c = match e.get("CollarColor") { Some(Value::Int(n)) => *n as usize, Some(Value::Byte(n)) => *n as usize, _ => 99 };
            entity.collar_color = DYE_COLORS.get(c).map(|s| s.to_string());
        }
        let wolf_variant = strip_ns(map_str(e, "Variant")).to_string();
        entity.pet_variant = if wolf_variant.is_empty() { None } else { Some(wolf_variant) };
        return Some(entity);
    }

    if kind == "cat" {
        entity.tamed = Some(map_bool(e, "Tame"));
        if entity.tamed == Some(true) {
            let c = match e.get("CollarColor") { Some(Value::Int(n)) => *n as usize, Some(Value::Byte(n)) => *n as usize, _ => 99 };
            entity.collar_color = DYE_COLORS.get(c).map(|s| s.to_string());
        }
        let cat_variant = strip_ns(map_str(e, "variant")).to_string();
        entity.pet_variant = if !cat_variant.is_empty() {
            Some(cat_variant)
        } else {
            const CAT_TYPES: &[&str] = &["tabby","black","red","siamese","british_shorthair","calico","persian","ragdoll","white","jellie","all_black"];
            let ct = match e.get("CatType") { Some(Value::Int(n)) => *n as usize, Some(Value::Byte(n)) => *n as usize, _ => 99 };
            CAT_TYPES.get(ct).map(|s| s.to_string())
        };
        return Some(entity);
    }

    if kind == "allay" {
        let hand_list = map_list(e, "HandItems");
        if let Some(first) = hand_list.first() {
            let held = parse_entity_item(Some(first));
            if let Some(h) = held {
                if !h.id.is_empty() && h.id != "air" {
                    entity.chest_items = Some(vec![h]);
                }
            }
        }
        if entity.chest_items.as_ref().map(|l| l.is_empty()).unwrap_or(true) && custom_name.is_none() {
            return None;
        }
        return Some(entity);
    }

    if kind == "parrot" {
        entity.tamed = Some(map_bool(e, "Tame"));
        if entity.tamed == Some(true) {
            let c = match e.get("CollarColor") { Some(Value::Int(n)) => *n as usize, Some(Value::Byte(n)) => *n as usize, _ => 99 };
            entity.collar_color = DYE_COLORS.get(c).map(|s| s.to_string());
        }
        const PARROT_VARIANTS: &[&str] = &["red", "blue", "green", "cyan", "gray"];
        let pv = match e.get("Variant") { Some(Value::Int(n)) => *n as usize, _ => 99 };
        entity.pet_variant = PARROT_VARIANTS.get(pv).map(|s| s.to_string());
        if entity.tamed != Some(true) && custom_name.is_none() { return None; }
        return Some(entity);
    }

    if kind == "pig" {
        // Saddle: pre-1.21.4 boolean; equipment.saddle: 1.21.4+ item compound
        let saddle_id = equipment_item_id(e, "SaddleItem", "saddle");
        entity.saddled = Some(map_bool(e, "Saddle") || (!saddle_id.is_empty() && saddle_id != "minecraft:air"));
        let v = strip_ns(map_str(e, "variant")).to_string();
        entity.pet_variant = if v.is_empty() { None } else { Some(v) };
        return Some(entity);
    }

    if matches!(kind.as_str(), "chicken" | "cow") {
        let v = strip_ns(map_str(e, "variant")).to_string();
        entity.pet_variant = if v.is_empty() { None } else { Some(v) };
        return Some(entity);
    }

    if matches!(kind.as_str(), "turtle" | "sniffer") {
        return Some(entity);
    }

    if kind == "sheep" {
        let c = match e.get("Color") { Some(Value::Int(n)) => *n as usize, Some(Value::Byte(n)) => *n as usize, _ => 99 };
        let wool = DYE_COLORS.get(c).map(|s| s.to_string());
        let biome_v = strip_ns(map_str(e, "variant")).to_string();
        entity.pet_variant = match (wool, biome_v.as_str()) {
            (Some(w), v) if !v.is_empty() => Some(format!("{w} ({v})")),
            (Some(w), _)                  => Some(w),
            (None,    v) if !v.is_empty() => Some(biome_v),
            _                             => None,
        };
        entity.is_screaming = Some(map_bool(e, "Sheared"));
        return Some(entity);
    }

    if kind == "mooshroom" {
        let t = strip_ns(map_str(e, "Type")).to_string();
        entity.pet_variant = if t.is_empty() { None } else { Some(t) };
        return Some(entity);
    }

    if kind == "rabbit" {
        const RABBIT_VARIANTS: &[&str] = &["brown","white","black","black_and_white","gold","salt_and_pepper"];
        let rt = match e.get("RabbitType") { Some(Value::Int(n)) => *n, Some(Value::Byte(n)) => *n as i32, _ => -1 };
        entity.pet_variant = if rt == 99 {
            Some("killer".to_string())
        } else {
            RABBIT_VARIANTS.get(rt as usize).map(|s| s.to_string())
        };
        return Some(entity);
    }

    if kind == "frog" {
        let var_str = strip_ns(map_str(e, "variant")).to_string();
        entity.pet_variant = if !var_str.is_empty() {
            Some(var_str)
        } else {
            const FROG_VARIANTS: &[&str] = &["temperate", "warm", "cold"];
            let fv = match e.get("Variant") { Some(Value::Int(n)) => *n as usize, _ => 99 };
            FROG_VARIANTS.get(fv).map(|s| s.to_string())
        };
        return Some(entity);
    }

    if kind == "armadillo" {
        let s = map_str(e, "armadillo_state").to_string();
        entity.pet_variant = if s.is_empty() { None } else { Some(s) };
        return Some(entity);
    }

    if kind == "fox" {
        let t = strip_ns(map_str(e, "Type")).to_string();
        entity.pet_variant = Some(if t.is_empty() { "red".to_string() } else { t });
        entity.is_sitting = Some(map_bool(e, "Sitting"));
        return Some(entity);
    }

    if kind == "panda" {
        let main   = strip_ns(map_str(e, "MainGene")).to_string();
        let hidden = strip_ns(map_str(e, "HiddenGene")).to_string();
        let main   = if main.is_empty() { "normal".to_string() } else { main };
        let hidden = if hidden.is_empty() { "normal".to_string() } else { hidden };
        entity.pet_variant = Some(if main == hidden { main } else { format!("{main}/{hidden}") });
        return Some(entity);
    }

    if kind == "bee" {
        entity.has_nectar = Some(map_bool(e, "HasNectar"));
        if entity.has_nectar != Some(true) && custom_name.is_none() { return None; }
        return Some(entity);
    }

    if kind == "salmon" {
        let t = strip_ns(map_str(e, "type")).to_string();
        entity.pet_variant = if t.is_empty() { None } else { Some(t) };
        return Some(entity);
    }

    if kind == "cod" {
        return Some(entity);
    }

    if kind == "tropical_fish" {
        let v = match e.get("Variant") { Some(Value::Int(n)) => *n, _ => 0 };
        entity.pet_variant = Some(parse_tropical_fish_variant(v));
        return Some(entity);
    }

    if kind == "shulker" {
        let c = match e.get("Color") { Some(Value::Int(n)) => *n as usize, Some(Value::Byte(n)) => *n as usize, _ => 99 };
        entity.pet_variant = if c < 16 && c != 99 { DYE_COLORS.get(c).map(|s| s.to_string()) } else { None };
        return Some(entity);
    }

    if kind == "snow_golem" {
        entity.is_screaming = Some(map_bool(e, "Pumpkin"));
        return Some(entity);
    }

    if kind == "phantom" {
        let sz = match e.get("Size") { Some(Value::Int(n)) => *n, Some(Value::Byte(n)) => *n as i32, _ => 0 };
        entity.mob_size = Some(sz);
        if sz == 0 && custom_name.is_none() { return None; }
        return Some(entity);
    }

    if kind == "end_crystal" {
        let bt = e.get("BeamTarget").and_then(cmp);
        if let Some(btm) = bt {
            entity.beam_target = Some([map_i32(btm, "X"), map_i32(btm, "Y"), map_i32(btm, "Z")]);
        }
        return Some(entity);
    }

    if kind == "strider" {
        entity.saddled = Some(map_bool(e, "Saddled"));
        if entity.saddled != Some(true) && custom_name.is_none() { return None; }
        return Some(entity);
    }

    if kind == "goat" {
        entity.is_screaming = Some(map_bool(e, "IsScreaming"));
        return Some(entity);
    }

    if kind == "axolotl" {
        const AXOLOTL_VARIANTS: &[&str] = &["lucy", "wild", "gold", "cyan", "blue"];
        let av = match e.get("Variant") { Some(Value::Int(n)) => *n as usize, _ => 99 };
        entity.pet_variant = AXOLOTL_VARIANTS.get(av).map(|s| s.to_string());
        return Some(entity);
    }

    if kind == "iron_golem" {
        entity.is_player_created = Some(map_bool(e, "PlayerCreated"));
        if entity.is_player_created != Some(true) && custom_name.is_none() { return None; }
        return Some(entity);
    }

    if kind == "copper_golem" {
        // Copper golems are always player-crafted; no natural spawn exists
        entity.is_player_created = Some(true);
        // Oxidation level: 0=unoxidized, 1=exposed, 2=weathered, 3=oxidized (statue)
        // Minecraft 1.21.5 uses snake_case for new entity data; also try PascalCase as fallback
        let oxidation = match e.get("oxidation_level").or_else(|| e.get("OxidationLevel")) {
            Some(Value::Byte(n))  => *n as i32,
            Some(Value::Int(n))   => *n,
            _ => 0,
        };
        entity.oxidation_level = Some(oxidation);
        entity.is_waxed = Some(map_bool(e, "waxed") || map_bool(e, "Waxed"));
        let hands = parse_hand_items(e);
        if !hands.is_empty() { entity.hand_items = Some(hands); }
        return Some(entity);
    }

    if kind == "wither" {
        entity.wither_health = map_float(e, "Health");
        return Some(entity);
    }

    if kind == "ender_dragon" {
        entity.dragon_health = map_float(e, "Health");
        entity.dragon_phase  = e.get("DragonPhase").and_then(|v| if let Value::Int(n) = v { Some(*n) } else { None });
        return Some(entity);
    }

    if kind == "elder_guardian" || kind == "warden" {
        return Some(entity);
    }

    if kind == "creaking" {
        return Some(entity);
    }

    // Any other entity with a custom name is worth showing
    if custom_name.is_some() { return Some(entity); }

    None
}

// ── Default impl for GameEntity ───────────────────────────────────────────────

impl Default for GameEntity {
    fn default() -> Self {
        GameEntity {
            kind: String::new(), x: 0, y: 0, z: 0,
            custom_name: None, villager_profession: None, villager_type: None,
            villager_level: None, trades: None, tamed: None, saddled: None,
            horse_armor: None, horse_variant: None, chest_items: None,
            loot_table: None, llama_strength: None, llama_decor: None,
            llama_variant: None, painting_variant: None, frame_item: None,
            frame_item_enchantment: None, frame_rotation: None, armor_items: None,
            hand_items: None, armor_stand_invisible: None, dragon_health: None,
            dragon_phase: None, wither_health: None, collar_color: None,
            pet_variant: None, is_screaming: None, is_player_created: None,
            oxidation_level: None, is_waxed: None,
            conversion_time: None, is_sitting: None, has_nectar: None,
            mob_size: None, beam_target: None, speed: None, jump_height: None,
            is_baby: None,
        }
    }
}

// ── Entity list extractor (handles both entity-file and region-file formats) ──

fn get_entity_list(chunk_val: &Value) -> &[Value] {
    // Entity file format (1.17+): root.Entities
    if let Some(Value::List(list)) = get(chunk_val, "Entities") {
        return list;
    }
    // Region file format pre-1.18: Level.Entities
    if let Some(level) = get(chunk_val, "Level") {
        if let Some(Value::List(list)) = get(level, "Entities") {
            return list;
        }
    }
    &[]
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Read interesting entities for all chunks within [minCx..maxCx] × [minCz..maxCz].
/// Tries entities/*.mca first (1.17+), falls back to region/*.mca.
/// Public bridge for Bedrock entity reader: call extract_entity on a pre-built
/// fastnbt::Value::Compound (with normalized "id" field already inserted).
pub fn extract_entity_from_compound(v: &Value) -> Option<GameEntity> {
    if let Value::Compound(m) = v { extract_entity(m) } else { None }
}

pub fn get_entities(
    world_dir: &str,
    dimension: &str,
    min_cx: i32,
    min_cz: i32,
    max_cx: i32,
    max_cz: i32,
) -> Vec<GameEntity> {
    // Group chunks by region
    let mut by_region: HashMap<(i32, i32), Vec<(i32, i32)>> = HashMap::new();
    for cx in min_cx..=max_cx {
        for cz in min_cz..=max_cz {
            by_region.entry((cx.div_euclid(32), cz.div_euclid(32))).or_default().push((cx, cz));
        }
    }

    let mut results: Vec<GameEntity> = Vec::new();

    for ((rx, rz), region_chunks) in &by_region {
        // Try entity file first, then region file fallback
        let mca_path = find_entity_file(world_dir, dimension, *rx, *rz)
            .or_else(|| find_region_file(world_dir, dimension, *rx, *rz));
        let Some(path) = mca_path else { continue };

        let file_buf = match std::fs::read(&path) {
            Ok(b) if b.len() >= 4096 => b,
            _ => continue,
        };

        for (cx, cz) in region_chunks {
            let lx = cx.rem_euclid(32) as usize;
            let lz = cz.rem_euclid(32) as usize;
            let Some(chunk_val) = read_chunk_nbt(&file_buf, lx, lz) else { continue };

            for e_val in get_entity_list(&chunk_val) {
                if let Some(m) = cmp(e_val) {
                    if let Some(entity) = extract_entity(m) {
                        results.push(entity);
                    }
                }
            }
        }
    }

    results
}

// ── Tauri command ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_entities_cmd(
    world_dir: String,
    edition:   String,
    dimension: String,
    min_cx:    i32,
    min_cz:    i32,
    max_cx:    i32,
    max_cz:    i32,
    db_cache:  tauri::State<'_, crate::BedrockDbCache>,
) -> Result<Vec<GameEntity>, ()> {
    if edition == "bedrock" {
        Ok(db_cache.with(&world_dir, |db| {
            crate::bedrock::entity_reader::get_bedrock_entities(
                db, &dimension, min_cx, min_cz, max_cx, max_cz,
            )
        }).unwrap_or_default())
    } else {
        Ok(tauri::async_runtime::spawn_blocking(move || {
            get_entities(&world_dir, &dimension, min_cx, min_cz, max_cx, max_cz)
        }).await.unwrap_or_default())
    }
}
