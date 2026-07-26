// Reads a Bedrock Edition level.dat and returns a SeedData.
//
// Bedrock level.dat format:
//   Bytes 0–3: LE i32 — storage version (e.g. 10)
//   Bytes 4–7: LE i32 — payload byte length
//   Bytes 8..: raw little-endian binary NBT (TAG_Compound, no gzip)

use super::le_nbt::{parse_le_nbt, LeNbt};
use crate::nbt_reader::{SeedData, WorldEdition};
use std::path::Path;

type Result<T> = std::result::Result<T, String>;

pub fn read_bedrock_level_dat(level_dat_path: &str) -> Result<SeedData> {
    let path = Path::new(level_dat_path);
    let world_dir = path.parent().ok_or("level.dat has no parent")?;

    let bytes = std::fs::read(path).map_err(|e| format!("Cannot read level.dat: {e}"))?;
    if bytes.len() < 8 {
        return Err("Bedrock level.dat too short".into());
    }

    let payload_len = i32::from_le_bytes(bytes[4..8].try_into().unwrap()).max(0) as usize;
    let payload_end = (8 + payload_len).min(bytes.len());
    let payload = &bytes[8..payload_end];

    let root = parse_le_nbt(payload)?;

    let seed = root.get("RandomSeed")
        .and_then(|v| v.as_i64())
        .ok_or("Missing RandomSeed in Bedrock level.dat")?;

    let level_name = root.get("LevelName")
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown World")
        .to_string();

    let spawn_x = root.get("SpawnX").and_then(|v| v.as_i32()).unwrap_or(0);
    let spawn_z = root.get("SpawnZ").and_then(|v| v.as_i32()).unwrap_or(0);

    let difficulty = root.get("Difficulty").and_then(|v| v.as_i32()).unwrap_or(2);

    let version_name = extract_version_name(&root);

    let world_type = extract_world_type(&root);

    let (player_x, player_y, player_z, player_dimension) = extract_player_pos(&root);

    // Bedrock doesn't track in-game time in the same way — DayTime is stored
    // as a float in some versions, else absent.
    let day_time = root.get("Time")
        .and_then(|v| v.as_i64())
        .map(|t| (t % 24000) as i32);
    let world_time = root.get("Time").and_then(|v| v.as_i64());

    Ok(SeedData {
        seed: seed.to_string(),
        data_version: 0, // Bedrock uses StorageVersion, not Java data versions
        version_name,
        level_name,
        world_type,
        spawn_x,
        spawn_z,
        spawn_chunk_radius: None, // Bedrock stores gamerules differently; not read
        player_x,
        player_y,
        player_z,
        player_dimension,
        day_time,
        world_dir: world_dir.to_string_lossy().into_owned(),
        difficulty,
        world_time,
        edition: WorldEdition::Bedrock,
        players: vec![],
        server_brands: vec![],       // Bedrock has no equivalent concept to read
        border_center_x: 0.0,
        border_center_z: 0.0,
        border_size: 60_000_000.0,   // vanilla default — Bedrock border not read yet
        game_rules: std::collections::HashMap::new(), // Bedrock stores gamerules differently; not read
    })
}

fn extract_version_name(root: &LeNbt) -> String {
    // lastOpenedWithVersion = TAG_List of TAG_Int: [major, minor, patch, build, revision]
    if let Some(LeNbt::List(parts)) = root.get("lastOpenedWithVersion") {
        let nums: Vec<i32> = parts.iter().filter_map(|v| v.as_i32()).collect();
        if nums.len() >= 3 {
            return format!("{}.{}.{}", nums[0], nums[1], nums[2]);
        }
    }
    // Fallback: StorageVersion
    let sv = root.get("StorageVersion").and_then(|v| v.as_i32()).unwrap_or(0);
    format!("Bedrock (storage v{sv})")
}

fn extract_world_type(root: &LeNbt) -> String {
    // Bedrock: FlatWorldLayers present → flat world
    if let Some(layers) = root.get("FlatWorldLayers").and_then(|v| v.as_str()) {
        if !layers.is_empty() {
            return "flat".to_string();
        }
    }
    // limitedWorldOriginPoint present → limited world (old mobile format)
    if root.get("limitedWorldOriginPoint").is_some() {
        return "limited".to_string();
    }
    "default".to_string()
}

fn extract_player_pos(root: &LeNbt) -> (Option<f64>, Option<f64>, Option<f64>, Option<String>) {
    let player = match root.get("Player").and_then(|v| v.as_compound()) {
        Some(p) => p,
        None    => return (None, None, None, None),
    };

    // Pos = TAG_List of 3 TAG_Float
    let (px, py, pz) = match player.get("Pos").and_then(|v| v.as_list()) {
        Some(list) if list.len() >= 3 => {
            let x = list[0].as_f32().unwrap_or(0.0) as f64;
            let y = list[1].as_f32().unwrap_or(0.0) as f64;
            let z = list[2].as_f32().unwrap_or(0.0) as f64;
            (x, y, z)
        }
        _ => return (None, None, None, None),
    };

    // DimensionId: 0=overworld, 1=nether, 2=end
    let dim_id = player.get("DimensionId")
        .or_else(|| player.get("Dimension"))
        .and_then(|v| v.as_i32())
        .unwrap_or(0);
    let dim_str = match dim_id {
        1 => "minecraft:the_nether",
        2 => "minecraft:the_end",
        _ => "minecraft:overworld",
    }.to_string();

    (Some(px), Some(py), Some(pz), Some(dim_str))
}
