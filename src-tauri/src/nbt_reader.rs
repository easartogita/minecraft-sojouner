use fastnbt::Value;
use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::path::Path;

// ── Edition discriminant ──────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum WorldEdition {
    #[default]
    Java,
    Bedrock,
}

// ── Public output types ───────────────────────────────────────────────────────

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlayerInfo {
    pub uuid:      String,
    pub name:      String,   // empty if not found in usercache.json
    pub x:         f64,
    pub y:         f64,
    pub z:         f64,
    pub dimension: String,
    pub is_host:   bool,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SeedData {
    pub seed: String,           // signed decimal string — preserves full i64 range
    pub data_version: i32,
    pub version_name: String,
    pub level_name: String,
    pub world_type: String,     // "default" | "large_biomes" | "amplified" | "flat" | "single_biome" | "custom"
    pub spawn_x: i32,
    pub spawn_z: i32,
    pub player_x: Option<f64>,
    pub player_y: Option<f64>,
    pub player_z: Option<f64>,
    pub player_dimension: Option<String>,
    pub day_time: Option<i32>,
    pub world_dir: String,
    pub difficulty: i32,        // 0=Peaceful 1=Easy 2=Normal 3=Hard
    pub world_time: Option<i64>, // Data.Time — total ticks elapsed (for totalDays + moon phase)
    pub edition: WorldEdition,
    pub players: Vec<PlayerInfo>,
}

type Result<T> = std::result::Result<T, String>;

// ── Entry point ───────────────────────────────────────────────────────────────

pub fn read_level_dat(level_dat_path: &str) -> Result<SeedData> {
    let path = Path::new(level_dat_path);
    let world_dir = path
        .parent()
        .ok_or("level.dat has no parent directory")?;

    let root = read_gz_nbt(path)?;
    let data = get(&root, "Data").ok_or("Missing Data tag in level.dat")?;

    let data_version = get(data, "DataVersion")
        .and_then(as_i32)
        .unwrap_or(0);

    let level_name = get(data, "LevelName")
        .and_then(as_str)
        .unwrap_or("Unknown World")
        .to_string();

    let (seed, wgs_root) = extract_seed(data, world_dir, data_version)?;
    let (spawn_x, spawn_z) = extract_spawn(data);
    let world_type = extract_world_type(data, data_version, wgs_root.as_ref());
    let day_time = extract_day_time(data);
    let world_time = get(data, "Time").and_then(as_i64);
    let difficulty = get(data, "Difficulty").and_then(as_i32).unwrap_or(2);
    let (player_x, player_y, player_z, player_dimension) =
        read_player_pos(data, world_dir, data_version);

    let mut players = read_all_players(data, world_dir, data_version);
    // Fallback for very old worlds without a playerdata/ dir (inline Data.Player only).
    if players.is_empty() {
        if let (Some(x), Some(y), Some(z)) = (player_x, player_y, player_z) {
            players.push(PlayerInfo {
                uuid: get(data, "singleplayer_uuid")
                    .and_then(as_int_array)
                    .map(uuid_from_int_array)
                    .unwrap_or_default(),
                name: String::new(),
                x,
                y,
                z,
                dimension: player_dimension.clone().unwrap_or_else(|| "minecraft:overworld".to_string()),
                is_host: true,
            });
        }
    }

    Ok(SeedData {
        seed: seed.to_string(),
        data_version,
        version_name: data_version_to_name(data_version).to_string(),
        level_name,
        world_type,
        spawn_x,
        spawn_z,
        player_x,
        player_y,
        player_z,
        player_dimension,
        day_time,
        world_dir: world_dir.to_string_lossy().into_owned(),
        difficulty,
        world_time,
        edition: WorldEdition::Java,
        players,
    })
}

// ── Seed extraction ───────────────────────────────────────────────────────────
// Returns (seed, optional wgs root value for 1.21.5+ world-type detection)

fn extract_seed(data: &Value, world_dir: &Path, data_version: i32) -> Result<(i64, Option<Value>)> {
    if data_version >= 4335 {
        // MC 1.21.5+: seed moved to data/minecraft/world_gen_settings.dat
        let wgs_path = world_dir
            .join("data")
            .join("minecraft")
            .join("world_gen_settings.dat");
        let wgs_root = read_gz_nbt(&wgs_path)
            .map_err(|e| format!("Cannot read world_gen_settings.dat: {e}"))?;
        let seed = get(&wgs_root, "data")
            .and_then(|d| get(d, "seed"))
            .and_then(as_i64)
            .ok_or("seed not found in world_gen_settings.dat")?;
        Ok((seed, Some(wgs_root)))
    } else if data_version >= 2566 {
        // MC 1.16–1.21.4: Data.WorldGenSettings.seed
        let seed = get(data, "WorldGenSettings")
            .and_then(|wgs| get(wgs, "seed"))
            .and_then(as_i64)
            .ok_or("Missing WorldGenSettings.seed")?;
        Ok((seed, None))
    } else {
        // Pre-1.16: Data.RandomSeed
        let seed = get(data, "RandomSeed")
            .and_then(as_i64)
            .ok_or("Missing RandomSeed")?;
        Ok((seed, None))
    }
}

// ── Spawn position ────────────────────────────────────────────────────────────

fn extract_spawn(data: &Value) -> (i32, i32) {
    // 1.21.5+: spawn.pos = [x, y, z] IntArray
    if let Some(pos) = get(data, "spawn")
        .and_then(|s| get(s, "pos"))
        .and_then(as_int_array)
    {
        if pos.len() >= 3 {
            return (pos[0], pos[2]);
        }
    }
    // Older: SpawnX / SpawnZ int tags
    let x = get(data, "SpawnX").and_then(as_i32).unwrap_or(0);
    let z = get(data, "SpawnZ").and_then(as_i32).unwrap_or(0);
    (x, z)
}

// ── World type ────────────────────────────────────────────────────────────────

fn settings_str_to_world_type(s: &str) -> &'static str {
    match s {
        "minecraft:large_biomes" | "largeBiomes" => "large_biomes",
        "minecraft:amplified"    | "amplified"   => "amplified",
        "minecraft:flat"         | "flat"         => "flat",
        "minecraft:single_biome"                 => "single_biome",
        "minecraft:overworld"    | "default"      => "default",
        _ => "custom",
    }
}

fn extract_world_type(data: &Value, data_version: i32, wgs_root: Option<&Value>) -> String {
    if data_version < 2566 {
        // Pre-1.16: Data.generatorName string
        return get(data, "generatorName")
            .and_then(as_str)
            .map(settings_str_to_world_type)
            .unwrap_or("default")
            .to_string();
    }

    // 1.16+: generator settings nested under WorldGenSettings (or wgs file for 1.21.5+)
    let wgs = if data_version >= 4335 {
        wgs_root.and_then(|r| get(r, "data"))
    } else {
        get(data, "WorldGenSettings")
    };

    let settings_val = wgs
        .and_then(|w| get(w, "dimensions"))
        .and_then(|d| get(d, "minecraft:overworld"))
        .and_then(|ow| get(ow, "generator"))
        .and_then(|g| get(g, "settings"));

    match settings_val {
        Some(Value::String(s)) => settings_str_to_world_type(s).to_string(),
        Some(Value::Compound(_)) => "custom".to_string(),
        _ => "default".to_string(),
    }
}

// ── Day time ──────────────────────────────────────────────────────────────────

fn extract_day_time(data: &Value) -> Option<i32> {
    let ticks = get(data, "DayTime")
        .or_else(|| get(data, "Time"))
        .and_then(as_i64)?;
    // Positive modulo — DayTime can be negative for paused worlds
    Some((((ticks % 24000) + 24000) % 24000) as i32)
}

// ── Player position ───────────────────────────────────────────────────────────

fn uuid_from_int_array(ints: &[i32]) -> String {
    let hex: String = ints.iter().map(|&i| format!("{:08x}", i as u32)).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    )
}

fn normalize_dimension(v: &Value) -> String {
    match v {
        Value::Int(n) => match n {
            -1 => "minecraft:the_nether".to_string(),
            1  => "minecraft:the_end".to_string(),
            _  => "minecraft:overworld".to_string(),
        },
        Value::String(s) => {
            if s.contains(':') { s.clone() } else { format!("minecraft:{s}") }
        }
        _ => "minecraft:overworld".to_string(),
    }
}

fn load_player_nbt(world_dir: &Path, data: &Value, data_version: i32) -> Option<Value> {
    if data_version >= 4335 {
        // 1.21.5+: players/data/{uuid}.dat
        let uuid = uuid_from_int_array(
            get(data, "singleplayer_uuid").and_then(as_int_array)?
        );
        read_gz_nbt(&world_dir.join("players").join("data").join(format!("{uuid}.dat"))).ok()
    } else {
        // Try playerdata/{uuid}.dat or players/data/{uuid}.dat
        if let Some(uuid_ints) = get(data, "singleplayer_uuid").and_then(as_int_array) {
            let uuid = uuid_from_int_array(uuid_ints);
            for sub in &["playerdata", "players/data"] {
                if let Ok(v) = read_gz_nbt(&world_dir.join(sub).join(format!("{uuid}.dat"))) {
                    return Some(v);
                }
            }
        }
        // Fallback: inline Data.Player (older single-player worlds)
        get(data, "Player").cloned()
    }
}

fn read_player_pos(
    data: &Value,
    world_dir: &Path,
    data_version: i32,
) -> (Option<f64>, Option<f64>, Option<f64>, Option<String>) {
    let none = (None, None, None, None);

    let player = match load_player_nbt(world_dir, data, data_version) {
        Some(v) => v,
        None => return none,
    };

    let pos = match get(&player, "Pos").and_then(as_double_list) {
        Some(v) if v.len() >= 3 => v,
        _ => return none,
    };

    let dim = get(&player, "Dimension")
        .map(normalize_dimension)
        .unwrap_or_else(|| "minecraft:overworld".to_string());

    (Some(pos[0]), Some(pos[1]), Some(pos[2]), Some(dim))
}

// ── Version name table ────────────────────────────────────────────────────────

const VERSION_MAP: &[(i32, &str)] = &[
    // 26.x uses a new versioning scheme. cubiomes support (xpple fork) covers
    // these via MC_26_x; see dataVersionToMCVersionKey in constants.ts.
    (4903, "26.2"),
    (4787, "26.x"),
    (4786, "1.21.5"),
    (4189, "1.21.4"),
    (4080, "1.21.2"),
    (3953, "1.21"),
    (3700, "1.20.6"),
    (3465, "1.20.4"),
    (3337, "1.20.2"),
    (3218, "1.20"),
    (2860, "1.19"),
    (2724, "1.18"),
    (2566, "1.16"),
];

fn data_version_to_name(v: i32) -> &'static str {
    for &(min, name) in VERSION_MAP {
        if v >= min {
            return name;
        }
    }
    if v >= 2566 { "1.16+" } else { "pre-1.16" }
}

// ── Multi-player enumeration ──────────────────────────────────────────────────

fn load_usercache(world_dir: &Path) -> HashMap<String, String> {
    // Standard singleplayer: world is in .minecraft/saves/Name/ → usercache two levels up.
    // Dedicated server: world is in server/world/ → usercache one level up.
    let candidates = [
        world_dir.join("..").join("usercache.json"),
        world_dir.join("..").join("..").join("usercache.json"),
    ];
    for path in &candidates {
        let Ok(bytes) = std::fs::read(path) else { continue };
        let Ok(arr) = serde_json::from_slice::<Vec<serde_json::Value>>(&bytes) else { continue };
        let map: HashMap<String, String> = arr.iter().filter_map(|entry| {
            let name = entry.get("name")?.as_str()?.to_string();
            let uuid = entry.get("uuid")?.as_str()?.to_lowercase();
            Some((uuid, name))
        }).collect();
        if !map.is_empty() { return map; }
    }
    HashMap::new()
}

fn read_player_dat(path: &Path) -> Option<(f64, f64, f64, String)> {
    let nbt = read_gz_nbt(path).ok()?;
    let pos = get(&nbt, "Pos").and_then(as_double_list)?;
    if pos.len() < 3 { return None; }
    let dim = get(&nbt, "Dimension")
        .map(normalize_dimension)
        .unwrap_or_else(|| "minecraft:overworld".to_string());
    Some((pos[0], pos[1], pos[2], dim))
}

fn read_all_players(data: &Value, world_dir: &Path, _data_version: i32) -> Vec<PlayerInfo> {
    let host_uuid = get(data, "singleplayer_uuid")
        .and_then(as_int_array)
        .map(uuid_from_int_array);

    let usercache = load_usercache(world_dir);

    let dirs = [
        world_dir.join("playerdata"),
        world_dir.join("players").join("data"),
    ];

    let mut players: Vec<PlayerInfo> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for dir in &dirs {
        let Ok(entries) = std::fs::read_dir(dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(true, |e| e != "dat") { continue; }
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else { continue };
            // Only process files whose names are a valid UUID (8-4-4-4-12).
            if stem.len() != 36 || stem.chars().filter(|&c| c == '-').count() != 4 { continue; }
            let uuid = stem.to_lowercase();
            if !seen.insert(uuid.clone()) { continue; }
            let Some((x, y, z, dimension)) = read_player_dat(&path) else { continue };
            let is_host = host_uuid.as_deref() == Some(uuid.as_str());
            let name = usercache.get(&uuid).cloned().unwrap_or_default();
            players.push(PlayerInfo { uuid, name, x, y, z, dimension, is_host });
        }
    }

    // Host first, then by name so order is deterministic.
    players.sort_by(|a, b| {
        b.is_host.cmp(&a.is_host).then_with(|| a.name.cmp(&b.name))
    });
    players
}

// ── NBT / GZ helpers ──────────────────────────────────────────────────────────

pub fn read_gz_nbt(path: &Path) -> Result<Value> {
    let file = std::fs::File::open(path)
        .map_err(|e| format!("Cannot open {}: {e}", path.display()))?;
    let mut gz = GzDecoder::new(file);
    let mut bytes = Vec::new();
    gz.read_to_end(&mut bytes)
        .map_err(|e| format!("GZ decode error for {}: {e}", path.display()))?;
    fastnbt::from_bytes(&bytes)
        .map_err(|e| format!("NBT parse error for {}: {e}", path.display()))
}

fn cmp(v: &Value) -> Option<&HashMap<String, Value>> {
    if let Value::Compound(m) = v { Some(m) } else { None }
}

fn get<'a>(v: &'a Value, key: &str) -> Option<&'a Value> {
    cmp(v)?.get(key)
}

fn as_i64(v: &Value) -> Option<i64> {
    match v {
        Value::Long(n) => Some(*n),
        Value::Int(n)  => Some(*n as i64),
        _ => None,
    }
}

fn as_i32(v: &Value) -> Option<i32> {
    match v {
        Value::Byte(n)  => Some(*n as i32),
        Value::Short(n) => Some(*n as i32),
        Value::Int(n)   => Some(*n),
        _ => None,
    }
}

fn as_str(v: &Value) -> Option<&str> {
    if let Value::String(s) = v { Some(s) } else { None }
}

// Value::List is Vec<Value> in fastnbt 2.x — collect the doubles out of it
fn as_double_list(v: &Value) -> Option<Vec<f64>> {
    if let Value::List(list) = v {
        list.iter()
            .map(|item| if let Value::Double(d) = item { Some(*d) } else { None })
            .collect()
    } else {
        None
    }
}

fn as_int_array(v: &Value) -> Option<&[i32]> {
    if let Value::IntArray(arr) = v { Some(arr) } else { None }
}
