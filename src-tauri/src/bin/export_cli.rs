// Headless static-site export — runs the real export path
// (static_export::run_static_export) with no GUI and no window-click
// flakiness. Prints every progress event and the final result so
// failures/hangs are visible in the terminal. See print_usage() for flags.

use sojourner_lib::{nbt_reader, static_export, BedrockDbCache, TileRenderSemaphore};
use tauri::{Listener, Manager};

const ALL_DIMENSIONS: &[&str] = &["overworld", "nether", "end"];
const ALL_LAYERS: &[&str] = &[
    "biome", "underground", "chunk", "chunk-hide-water",
    "cave", "ore-veins", "carvers", "local-difficulty",
];

/// Mirrors DEFAULT_CAVE_RANGE_PRESETS_OVERWORLD/_NETHER in
/// src/renderer/lib/staticExport/schema.ts — kept in sync by hand.
fn default_cave_presets(dimension: &str) -> Vec<static_export::CaveRangePreset> {
    if dimension == "nether" {
        vec![
            static_export::CaveRangePreset { id: "upper-nether".into(), label: "Upper Nether (Y 96 to 127)".into(), low: 96, high: 127 },
            static_export::CaveRangePreset { id: "mid-nether".into(), label: "Mid Nether (Y 32 to 95)".into(), low: 32, high: 95 },
            static_export::CaveRangePreset { id: "lava-sea".into(), label: "Lava Sea (Y 0 to 31)".into(), low: 0, high: 31 },
        ]
    } else {
        vec![
            static_export::CaveRangePreset { id: "above-ground".into(), label: "Above Ground (Y 48 to 320)".into(), low: 48, high: 320 },
            static_export::CaveRangePreset { id: "near-surface".into(), label: "Near Surface (Y -16 to 48)".into(), low: -16, high: 48 },
            static_export::CaveRangePreset { id: "mid".into(), label: "Mid (Y -48 to -16)".into(), low: -48, high: -16 },
            static_export::CaveRangePreset { id: "deepslate".into(), label: "Deepslate (Y -64 to -48)".into(), low: -64, high: -48 },
        ]
    }
}

fn print_usage() {
    eprintln!(
        "Usage: export_cli --world <name-or-path> --output <dir> [options]\n\
         \n\
         \x20 --world <arg>       A saves/ folder name (looked up under\n\
         \x20                     ~/.minecraft/saves/<name>/level.dat) or a direct\n\
         \x20                     path to a level.dat / world directory. Required.\n\
         \x20 --output <dir>      Output directory for the exported bundle. Required.\n\
         \x20 --dimensions <list> Comma-separated: overworld,nether,end. Default: all three.\n\
         \x20 --layers <list>     Comma-separated: biome,underground,chunk,chunk-hide-water,\n\
         \x20                     cave,ore-veins,carvers,local-difficulty. Default: all.\n\
         \x20 --edition <java>    Only \"java\" is supported today.\n\
         \x20 -h, --help          Print this and exit.\n\
         \n\
         Examples:\n\
         \x20 export_cli --world 263s9 --output web-site/worlds/26.3\n\
         \x20 export_cli --world 263s9 --output /tmp/preview --layers biome,chunk"
    );
}

struct Args {
    world: String,
    output: String,
    dimensions: Vec<String>,
    layers: Vec<String>,
    edition: String,
}

fn parse_args() -> Args {
    let mut world = None;
    let mut output = None;
    let mut dimensions: Vec<String> = ALL_DIMENSIONS.iter().map(|s| s.to_string()).collect();
    let mut layers: Vec<String> = ALL_LAYERS.iter().map(|s| s.to_string()).collect();
    let mut edition = "java".to_string();

    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "-h" | "--help" => { print_usage(); std::process::exit(0); }
            "--world" => world = args.next(),
            "--output" => output = args.next(),
            "--edition" => edition = args.next().unwrap_or(edition),
            "--dimensions" => {
                if let Some(v) = args.next() {
                    dimensions = v.split(',').map(|s| s.trim().to_string()).collect();
                }
            }
            "--layers" => {
                if let Some(v) = args.next() {
                    layers = v.split(',').map(|s| s.trim().to_string()).collect();
                }
            }
            other => {
                eprintln!("export_cli: unrecognized argument '{other}'");
                print_usage();
                std::process::exit(1);
            }
        }
    }

    let (Some(world), Some(output)) = (world, output) else {
        eprintln!("export_cli: --world and --output are both required.\n");
        print_usage();
        std::process::exit(1);
    };

    if edition != "java" {
        eprintln!("export_cli: only --edition java is supported today (Bedrock's level.dat needs bedrock::nbt_reader, not wired up here).");
        std::process::exit(1);
    }

    Args { world, output, dimensions, layers, edition }
}

/// Accepts a saves/ folder name, a path to a world directory, or a direct
/// path to level.dat — mirrors how the app's own world picker resolves a name.
fn resolve_level_dat(world: &str) -> String {
    let p = std::path::Path::new(world);
    if p.file_name().map(|n| n == "level.dat").unwrap_or(false) && p.exists() {
        return world.to_string();
    }
    if p.is_dir() {
        let candidate = p.join("level.dat");
        if candidate.exists() { return candidate.to_string_lossy().into_owned(); }
    }
    let home = std::env::var("HOME").unwrap_or_default();
    let candidate = std::path::Path::new(&home).join(".minecraft/saves").join(world).join("level.dat");
    if candidate.exists() { return candidate.to_string_lossy().into_owned(); }

    eprintln!("export_cli: couldn't resolve '{world}' to a level.dat (tried it as a direct path and as a ~/.minecraft/saves/ name).");
    std::process::exit(1);
}

// Mirrors dataVersionToMCVersionKey in src/renderer/lib/constants.ts — kept in sync by hand.
fn data_version_to_mc_version(data_version: i32) -> i32 {
    if data_version >= 4998 { 35 }      // MC_26_3
    else if data_version >= 4903 { 34 } // MC_26_2
    else if data_version >= 4189 { 28 } // MC_1_21_4
    else if data_version >= 3218 { 25 } // MC_1_20
    else if data_version >= 2860 { 24 } // MC_1_19
    else if data_version >= 2724 { 22 } // MC_1_18
    else { 20 }                         // MC_1_16 (also the pre-1.16 fallback)
}

#[tokio::main]
async fn main() {
    let args = parse_args();
    let level_dat = resolve_level_dat(&args.world);

    eprintln!("export_cli: level.dat = {level_dat}");
    eprintln!("export_cli: output_dir = {}", args.output);
    eprintln!("export_cli: dimensions = {:?}", args.dimensions);
    eprintln!("export_cli: layers = {:?}", args.layers);

    let seed_data = match nbt_reader::read_level_dat(&level_dat) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("export_cli: FAILED to read level.dat: {e}");
            std::process::exit(1);
        }
    };
    eprintln!(
        "export_cli: loaded '{}' — seed={} version={} dataVersion={}",
        seed_data.level_name, seed_data.seed, seed_data.version_name, seed_data.data_version
    );

    let seed: i64 = seed_data.seed.parse().unwrap_or_else(|e| {
        eprintln!("export_cli: FAILED to parse seed '{}': {e}", seed_data.seed);
        std::process::exit(1);
    });
    let seed_low = seed as i32;
    let seed_high = (seed >> 32) as i32;
    let mc_version = data_version_to_mc_version(seed_data.data_version);

    let has = |name: &str| args.layers.iter().any(|l| l == name);

    // Overworld and Nether don't share a Y space, so each gets its own preset
    // list; computed before args.dimensions is moved into the struct below.
    let cave_range_presets: std::collections::HashMap<String, Vec<static_export::CaveRangePreset>> =
        if has("cave") {
            args.dimensions.iter()
                .filter(|d| d.as_str() != "end")
                .map(|d| (d.clone(), default_cave_presets(d)))
                .collect()
        } else {
            std::collections::HashMap::new()
        };

    let params = static_export::StaticExportParams {
        world_dir: seed_data.world_dir.clone(),
        edition: args.edition,
        output_dir: args.output,
        seed_low,
        seed_high,
        mc_version,
        world_flags: if seed_data.world_type == "large_biomes" { 1 } else { 0 },
        level_name: seed_data.level_name,
        data_version: seed_data.data_version,
        version_name: seed_data.version_name,
        world_type: seed_data.world_type,
        difficulty: seed_data.difficulty,
        world_time: seed_data.world_time.unwrap_or(0),
        border_center_x: seed_data.border_center_x,
        border_center_z: seed_data.border_center_z,
        border_size: seed_data.border_size,
        game_rules: seed_data.game_rules,
        dimensions: args.dimensions,
        include_biome_tiles: has("biome"),
        include_underground_tiles: has("underground"),
        include_chunk_tiles: has("chunk"),
        include_chunk_hide_water_tiles: has("chunk-hide-water"),
        cave_range_presets,
        include_ore_veins: has("ore-veins"),
        include_carvers: has("carvers"),
        include_local_difficulty: has("local-difficulty"),
        roll_loot_for: vec![],
        default_settings: serde_json::Value::Null,
        marker_groups: serde_json::Value::Null,
    };

    let app = tauri::Builder::default()
        .manage(TileRenderSemaphore::new(4))
        .manage(BedrockDbCache::new())
        .manage(static_export::StaticExportCancel::new())
        .build(tauri::generate_context!())
        .expect("export_cli: failed to build headless Tauri app");
    let handle = app.handle().clone();

    handle.listen("static-export:progress", |event| {
        eprintln!("export_cli: progress {}", event.payload());
    });

    let sem = handle.state::<TileRenderSemaphore>();
    let db_cache = handle.state::<BedrockDbCache>();
    let cancel = handle.state::<static_export::StaticExportCancel>();

    let start = std::time::Instant::now();
    let result = static_export::run_static_export(handle.clone(), sem, db_cache, cancel, params).await;
    let elapsed = start.elapsed();

    match result {
        Ok(()) => {
            eprintln!("export_cli: DONE in {:.1}s", elapsed.as_secs_f64());
            std::process::exit(0);
        }
        Err(e) => {
            eprintln!("export_cli: FAILED after {:.1}s: {e}", elapsed.as_secs_f64());
            std::process::exit(1);
        }
    }
}
