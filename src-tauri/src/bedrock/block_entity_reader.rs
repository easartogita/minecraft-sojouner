// Bedrock block entity reader.
//
// Reads block entity data from LevelDB (key tag 0x31 per chunk).
// Converts LE NBT → fastnbt::Value then delegates to extract_single_block_entity.

use super::chunk_reader::{chunk_key_prefix, dim_str_to_bedrock};
use super::entity_reader::le_nbt_to_fastnbt;
use super::le_nbt::parse_compound_sequence;
use super::leveldb::LdbDatabase;
use crate::block_entity_reader::BlockEntity;
use fastnbt::Value;

pub fn get_bedrock_block_entities(
    db:        &LdbDatabase,
    dimension: &str,
    min_cx:    i32,
    min_cz:    i32,
    max_cx:    i32,
    max_cz:    i32,
) -> Vec<BlockEntity> {
    let dim = dim_str_to_bedrock(dimension);
    let mut out = Vec::new();

    for cz in min_cz..=max_cz {
        for cx in min_cx..=max_cx {
            let mut key = chunk_key_prefix(cx, cz, dim);
            key.push(0x31); // BlockEntities tag
            if let Some(data) = db.get(&key) {
                let compounds = parse_compound_sequence(&data);
                for m in compounds {
                    // Bedrock uses "id" for block entity type
                    let raw_id = m.get("id")
                        .and_then(|v| if let super::le_nbt::LeNbt::String(s) = v { Some(s.as_str()) } else { None })
                        .unwrap_or("");
                    let kind = raw_id.strip_prefix("minecraft:").unwrap_or(raw_id).to_string();
                    if kind.is_empty() { continue; }

                    let x = m.get("x").and_then(|v| v.as_i32()).unwrap_or(0);
                    let y = m.get("y").and_then(|v| v.as_i32()).unwrap_or(0);
                    let z = m.get("z").and_then(|v| v.as_i32()).unwrap_or(0);

                    let mut fmap: std::collections::HashMap<String, Value> = m.iter()
                        .map(|(k, v)| (k.clone(), le_nbt_to_fastnbt(v)))
                        .collect();
                    fmap.insert("id".to_string(), Value::String(kind));

                    let compound = Value::Compound(fmap);
                    if let Some(be) = crate::block_entity_reader::extract_single_block_entity(&compound) {
                        out.push(be);
                    } else {
                        // Fallback: position-only record
                        out.push(BlockEntity {
                            kind: if let Value::Compound(ref m) = compound {
                                m.get("id").and_then(|v| if let Value::String(s) = v { Some(s.clone()) } else { None })
                                    .unwrap_or_else(|| "unknown".to_string())
                            } else { "unknown".to_string() },
                            x, y, z,
                            ..Default::default()
                        });
                    }
                }
            }
        }
    }

    out
}
