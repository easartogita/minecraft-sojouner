use crate::region_reader::{find_poi_file, read_chunk_nbt};
use fastnbt::Value;
use serde::Serialize;
use std::collections::HashMap;

// ── Output type ───────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PoiRecord {
    pub kind:         String,
    pub x:            i32,
    pub y:            i32,
    pub z:            i32,
    pub free_tickets: i32,
}

// ── NBT helpers ───────────────────────────────────────────────────────────────

fn strip_ns(s: &str) -> &str {
    s.strip_prefix("minecraft:").unwrap_or(s)
}

fn cmp(v: &Value) -> Option<&HashMap<String, Value>> {
    if let Value::Compound(m) = v { Some(m) } else { None }
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

// ── POI extraction ────────────────────────────────────────────────────────────

fn extract_poi(chunk: &Value) -> Vec<PoiRecord> {
    let root = match cmp(chunk) {
        Some(m) => m,
        None    => return vec![],
    };

    // Sections is a Compound where keys are Y section indices (as strings)
    // and values are compounds with Records and Valid fields.
    let sections_val = match root.get("Sections") {
        Some(v) => v,
        None    => {
            crate::format_guard::format_warn(
                "POI Sections",
                "chunk has no Sections compound — all POI markers for it are silently dropped",
            );
            return vec![];
        }
    };
    let sections = match cmp(sections_val) {
        Some(m) => m,
        None    => return vec![],
    };

    let mut out = Vec::new();

    for (_section_key, section_val) in sections {
        let Some(section) = cmp(section_val) else { continue };

        // Skip stale sections (Valid == 0)
        let valid = match section.get("Valid") {
            Some(Value::Byte(b)) => *b,
            _ => 1, // assume valid if missing
        };
        if valid == 0 { continue; }

        let records = match section.get("Records") {
            Some(Value::List(l)) => l,
            _ => {
                crate::format_guard::format_warn(
                    "POI Records",
                    "a valid POI section has no Records list — its markers (job sites, beds, etc.) are silently dropped",
                );
                continue;
            }
        };

        for rec_val in records {
            let Some(rec) = cmp(rec_val) else { continue };

            let raw_type = map_str(rec, "type");
            let kind = strip_ns(raw_type).to_string();
            if kind.is_empty() { continue; }

            // pos is an IntArray [x, y, z]
            let (x, y, z) = match rec.get("pos") {
                Some(Value::IntArray(arr)) if arr.len() >= 3 => (arr[0], arr[1], arr[2]),
                _ => continue,
            };

            let free_tickets = map_i32(rec, "free_tickets");

            out.push(PoiRecord { kind, x, y, z, free_tickets });
        }
    }

    out
}

// ── Public API ────────────────────────────────────────────────────────────────

pub fn get_poi(
    world_dir: &str,
    dimension: &str,
    min_cx: i32, min_cz: i32,
    max_cx: i32, max_cz: i32,
) -> Vec<PoiRecord> {
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
        let Some(path) = find_poi_file(world_dir, dimension, *rx, *rz) else { continue };
        let Ok(file_buf) = std::fs::read(&path) else { continue };
        if file_buf.len() < 4096 { continue; }

        for &(cx, cz) in chunks {
            let lx = cx.rem_euclid(32) as usize;
            let lz = cz.rem_euclid(32) as usize;
            let Some(chunk_val) = read_chunk_nbt(&file_buf, lx, lz) else { continue };
            out.extend(extract_poi(&chunk_val));
        }
    }

    out
}

// ── Tauri command ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_poi_cmd(
    world_dir: String,
    edition:   String,
    dimension: String,
    min_cx:    i32,
    min_cz:    i32,
    max_cx:    i32,
    max_cz:    i32,
    db_cache:  tauri::State<'_, crate::BedrockDbCache>,
) -> Result<Vec<PoiRecord>, ()> {
    if edition == "bedrock" {
        Ok(db_cache.with(&world_dir, |db| {
            crate::bedrock::poi_reader::get_bedrock_poi(
                db, &dimension, min_cx, min_cz, max_cx, max_cz,
            )
        }).unwrap_or_default())
    } else {
        Ok(tauri::async_runtime::spawn_blocking(move || {
            get_poi(&world_dir, &dimension, min_cx, min_cz, max_cx, max_cz)
        }).await.unwrap_or_default())
    }
}
