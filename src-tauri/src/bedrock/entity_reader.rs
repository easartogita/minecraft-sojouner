// Reads entities from LevelDB (key tag 0x32 per chunk), converts LE NBT to
// fastnbt::Value, then delegates to crate::entity_reader's Java extractor so
// all entity handlers stay shared instead of duplicated per edition.

use super::le_nbt::{parse_compound_sequence, LeNbt};
use super::leveldb::LdbDatabase;
use super::chunk_reader::{chunk_key_prefix, dim_str_to_bedrock};
use crate::entity_reader::GameEntity;
use fastnbt::Value;
use std::collections::HashMap;

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
                    let kind = m.get("identifier")
                        .or_else(|| m.get("id"))
                        .and_then(|v| if let LeNbt::String(s) = v { Some(s.as_str()) } else { None })
                        .unwrap_or("unknown");
                    let kind_stripped = kind.strip_prefix("minecraft:").unwrap_or(kind).to_string();

                    let mut fmap: HashMap<String, Value> = m.iter()
                        .map(|(k, v)| (k.clone(), le_nbt_to_fastnbt(v)))
                        .collect();

                    // Java extractor expects an unnamespaced "id"
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
