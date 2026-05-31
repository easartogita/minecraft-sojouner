// Bedrock entity reader.
//
// Reads entity data from LevelDB (key tag 0x32 per chunk), converts the
// Bedrock LE NBT to fastnbt::Value, then delegates to the Java entity
// extractor in crate::entity_reader — this reuses all 40+ entity handlers
// without duplication.

use super::le_nbt::{parse_compound_sequence, LeNbt};
use super::leveldb::LdbDatabase;
use super::chunk_reader::{chunk_key_prefix, dim_str_to_bedrock};
use crate::entity_reader::GameEntity;
use fastnbt::Value;
use std::collections::HashMap;

// ── LeNbt → fastnbt::Value adapter ──────────────────────────────────────────

pub fn le_nbt_to_fastnbt(v: &LeNbt) -> Value {
    match v {
        LeNbt::Byte(b)      => Value::Byte(*b),
        LeNbt::Short(s)     => Value::Short(*s),
        LeNbt::Int(i)       => Value::Int(*i),
        LeNbt::Long(l)      => Value::Long(*l),
        LeNbt::Float(f)     => Value::Float(*f),
        LeNbt::Double(d)    => Value::Double(*d),
        LeNbt::ByteArray(v) => Value::ByteArray(fastnbt::ByteArray::new(v.iter().map(|&b| b as i8).collect())),
        LeNbt::String(s)    => Value::String(s.clone()),
        LeNbt::List(list)   => Value::List(list.iter().map(le_nbt_to_fastnbt).collect()),
        LeNbt::Compound(map) => {
            let fmap: HashMap<String, Value> = map.iter()
                .map(|(k, v)| (k.clone(), le_nbt_to_fastnbt(v)))
                .collect();
            Value::Compound(fmap)
        }
        LeNbt::IntArray(v)  => Value::IntArray(fastnbt::IntArray::new(v.clone())),
        LeNbt::LongArray(v) => Value::LongArray(fastnbt::LongArray::new(v.clone())),
    }
}


// ── Main entry point ─────────────────────────────────────────────────────────

pub fn get_bedrock_entities(
    db:        &LdbDatabase,
    dimension: &str,
    min_cx:    i32,
    min_cz:    i32,
    max_cx:    i32,
    max_cz:    i32,
) -> Vec<GameEntity> {
    let dim = dim_str_to_bedrock(dimension);
    let mut out = Vec::new();

    for cz in min_cz..=max_cz {
        for cx in min_cx..=max_cx {
            let mut prefix = chunk_key_prefix(cx, cz, dim);
            prefix.push(0x32); // Entities tag
            if let Some(data) = db.get(&prefix) {
                let compounds = parse_compound_sequence(&data);
                for m in compounds {
                    // Normalize entity id: strip "minecraft:" prefix
                    let kind = m.get("identifier")
                        .or_else(|| m.get("id"))
                        .and_then(|v| if let LeNbt::String(s) = v { Some(s.as_str()) } else { None })
                        .unwrap_or("unknown");
                    let kind_stripped = kind.strip_prefix("minecraft:").unwrap_or(kind).to_string();

                    // Build a fastnbt compound with normalized id, then delegate to Java extractor
                    let mut fmap: HashMap<String, Value> = m.iter()
                        .map(|(k, v)| (k.clone(), le_nbt_to_fastnbt(v)))
                        .collect();

                    // Ensure the "id" key uses the stripped name (Java extractor expects no namespace)
                    fmap.insert("id".to_string(), Value::String(kind_stripped));

                    let compound = Value::Compound(fmap);
                    if let Some(entity) = crate::entity_reader::extract_entity_from_compound(&compound) {
                        out.push(entity);
                    }
                }
            }
        }
    }

    out
}
