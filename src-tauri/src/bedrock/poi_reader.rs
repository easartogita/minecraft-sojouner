// Bedrock has no dedicated POI file format — POI-equivalent data lives in
// block entities (beds, bells, lecterns, etc.), so we scan the block entity
// key (0x31) and map the relevant kinds to PoiRecord.

use super::chunk_reader::{chunk_key_prefix, dim_str_to_bedrock};
use super::le_nbt::parse_compound_sequence;
use super::leveldb::LdbDatabase;
use crate::poi_reader::PoiRecord;

// Block entity types that correspond to Java POI workstations / points of interest
fn bedrock_be_to_poi_kind(kind: &str) -> Option<&'static str> {
    match kind {
        "bed"                    => Some("minecraft:home"),
        "bell"                   => Some("minecraft:meeting_point"),
        "lectern"                => Some("minecraft:lectern"),
        "grindstone"             => Some("minecraft:grindstone"),
        "smithing_table"         => Some("minecraft:smithing_table"),
        "anvil"                  => Some("minecraft:armorer"),
        "brewing_stand"          => Some("minecraft:brewing_stand"),
        "blast_furnace"          => Some("minecraft:blast_furnace"),
        "smoker"                 => Some("minecraft:smoker"),
        "cartography_table"      => Some("minecraft:cartography_table"),
        "fletching_table"        => Some("minecraft:fletching_table"),
        "loom"                   => Some("minecraft:loom"),
        "composter"              => Some("minecraft:composter"),
        "cauldron"               => Some("minecraft:cauldron"),
        "stonecutter_block"      => Some("minecraft:stonecutter"),
        "barrel"                 => Some("minecraft:fisherman"),
        "lodestone"              => Some("minecraft:lodestone"),
        _ => None,
    }
}

pub fn get_bedrock_poi(
    db:        &LdbDatabase,
    dimension: &str,
    min_cx:    i32,
    min_cz:    i32,
    max_cx:    i32,
    max_cz:    i32,
) -> Vec<PoiRecord> {
    let dim = dim_str_to_bedrock(dimension);
    let mut out = Vec::new();

    for cz in min_cz..=max_cz {
        for cx in min_cx..=max_cx {
            let mut key = chunk_key_prefix(cx, cz, dim);
            key.push(0x31); // BlockEntities tag
            if let Some(data) = db.get(&key) {
                let compounds = parse_compound_sequence(&data);
                for m in compounds {
                    let raw_id = m.get("id")
                        .and_then(|v| if let super::le_nbt::LeNbt::String(s) = v { Some(s.as_str()) } else { None })
                        .unwrap_or("");
                    let kind = raw_id.strip_prefix("minecraft:").unwrap_or(raw_id);
                    if kind.is_empty() { continue; }

                    let Some(poi_kind) = bedrock_be_to_poi_kind(kind) else { continue };

                    let x = m.get("x").and_then(|v| v.as_i32()).unwrap_or(0);
                    let y = m.get("y").and_then(|v| v.as_i32()).unwrap_or(0);
                    let z = m.get("z").and_then(|v| v.as_i32()).unwrap_or(0);

                    out.push(PoiRecord {
                        kind:         poi_kind.to_string(),
                        x, y, z,
                        free_tickets: 1,
                    });
                }
            }
        }
    }

    out
}
