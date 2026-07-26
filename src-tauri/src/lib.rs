mod bedrock;
mod block_colors;
mod block_entity_reader;
mod cubiomes;
mod entity_reader;
mod file_watcher;
mod nbt_reader;
mod poi_reader;
mod region_reader;
mod slime;
mod tile_renderer;

use bedrock::leveldb::LdbDatabase;
use file_watcher::WatchStateMutex;
use nbt_reader::{SeedData, WorldEdition};
use region_reader::ChunkInfo;
use serde::Serialize;
use std::path::Path;
use std::sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex};
use tauri::Manager;

// ── Bedrock LevelDB connection pool ──────────────────────────────────────────
// One open LdbDatabase per world_dir. Avoids reopening the DB on every tile.

struct BedrockDbCache(Mutex<Option<(String, Arc<LdbDatabase>)>>);

impl BedrockDbCache {
    fn new() -> Self { BedrockDbCache(Mutex::new(None)) }

    fn get_or_open(&self, world_dir: &str) -> Result<(), String> {
        let mut guard = self.0.lock().unwrap();
        match guard.as_ref() {
            Some((dir, _)) if dir == world_dir => return Ok(()),
            _ => {}
        }
        let db_path = format!("{world_dir}/db");
        let db = LdbDatabase::open(&db_path)?;
        *guard = Some((world_dir.to_string(), Arc::new(db)));
        Ok(())
    }

    fn with<F, R>(&self, world_dir: &str, f: F) -> Option<R>
    where F: FnOnce(&LdbDatabase) -> R
    {
        let guard = self.0.lock().unwrap();
        guard.as_ref()
            .filter(|(dir, _)| dir == world_dir)
            .map(|(_, db)| f(db.as_ref()))
    }

    /// Clone the Arc so it can be sent into spawn_blocking for long-running tasks.
    fn get_arc(&self, world_dir: &str) -> Option<Arc<LdbDatabase>> {
        let guard = self.0.lock().unwrap();
        guard.as_ref()
            .filter(|(dir, _)| dir == world_dir)
            .map(|(_, db)| db.clone())
    }

    #[allow(dead_code)]
    fn close(&self) {
        *self.0.lock().unwrap() = None;
    }
}

// ── Edition detection ─────────────────────────────────────────────────────────

fn detect_world_edition(world_dir: &Path) -> WorldEdition {
    if world_dir.join("db").join("CURRENT").exists() {
        WorldEdition::Bedrock
    } else {
        WorldEdition::Java
    }
}

// ── Tile render semaphore — limits concurrent .mca disk reads ─────────────────

struct TileRenderSemaphore(Arc<tokio::sync::Semaphore>);

// ── Export cancel state ───────────────────────────────────────────────────────

struct ExportCancel(Mutex<Arc<AtomicBool>>);

impl ExportCancel {
    fn new() -> Self { ExportCancel(Mutex::new(Arc::new(AtomicBool::new(false)))) }
    fn fresh(&self) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        *self.0.lock().unwrap() = flag.clone();
        flag
    }
    fn cancel(&self) {
        self.0.lock().unwrap().store(true, Ordering::Relaxed);
    }
}

// ── Level.dat / seed commands ─────────────────────────────────────────────────

#[tauri::command]
fn read_level_dat(path: String, db_cache: tauri::State<'_, BedrockDbCache>) -> Result<SeedData, String> {
    let p = Path::new(&path);
    let world_dir = p.parent().ok_or("level.dat has no parent directory")?;
    match detect_world_edition(world_dir) {
        WorldEdition::Bedrock => {
            let data = bedrock::nbt_reader::read_bedrock_level_dat(&path)?;
            // Pre-open the LevelDB for this world so tile requests are instant.
            let _ = db_cache.get_or_open(&data.world_dir);
            Ok(data)
        }
        WorldEdition::Java => nbt_reader::read_level_dat(&path),
    }
}

/// Check if the app was launched with --level-dat=<path>; returns SeedData if so.
#[tauri::command]
fn get_auto_load_data(db_cache: tauri::State<'_, BedrockDbCache>) -> Option<(String, SeedData)> {
    for arg in std::env::args() {
        if let Some(path) = arg.strip_prefix("--level-dat=") {
            let p = Path::new(path);
            let world_dir = p.parent()?;
            let data = match detect_world_edition(world_dir) {
                WorldEdition::Bedrock => bedrock::nbt_reader::read_bedrock_level_dat(path).ok()?,
                WorldEdition::Java    => nbt_reader::read_level_dat(path).ok()?,
            };
            if data.edition == WorldEdition::Bedrock {
                let _ = db_cache.get_or_open(&data.world_dir);
            }
            return Some((path.to_string(), data));
        }
    }
    None
}

/// Open a native file-picker dialog and return the selected path (or null).
#[tauri::command]
async fn select_level_dat(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .add_filter("Minecraft Level", &["dat"])
        .blocking_pick_file()
        .map(|p| p.to_string())
}

/// Open a folder picker and return the path to level.dat within it (or null).
#[tauri::command]
async fn select_world_dir(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let dir = app
        .dialog()
        .file()
        .set_title("Select Minecraft World Folder")
        .blocking_pick_folder()
        .map(|p| p.to_string())?;

    let level_dat = std::path::Path::new(&dir).join("level.dat");
    if level_dat.exists() {
        return Some(level_dat.to_string_lossy().to_string());
    }
    None
}

// ── Saves folder discovery ────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SavesWorldEntry {
    name:            String,
    level_dat_path:  String,
    modified_secs:   u64,
    edition:         String,
}

fn minecraft_saves_dir() -> Option<std::path::PathBuf> {
    #[cfg(target_os = "windows")] {
        let appdata = std::env::var("APPDATA").ok()?;
        Some(std::path::PathBuf::from(appdata).join(".minecraft").join("saves"))
    }
    #[cfg(target_os = "macos")] {
        let home = std::env::var("HOME").ok()?;
        Some(std::path::PathBuf::from(home).join("Library/Application Support/minecraft/saves"))
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))] {
        let home = std::env::var("HOME").ok()?;
        Some(std::path::PathBuf::from(home).join(".minecraft/saves"))
    }
}

/// Bedrock edition save directories by platform.
fn bedrock_saves_dirs() -> Vec<std::path::PathBuf> {
    #[allow(unused_mut)]
    let mut dirs = Vec::new();
    #[cfg(target_os = "windows")]
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        dirs.push(
            std::path::PathBuf::from(local)
                .join("Packages")
                .join("Microsoft.MinecraftUWP_8wekyb3d8bbwe")
                .join("LocalState")
                .join("games")
                .join("com.mojang")
                .join("minecraftWorlds"),
        );
    }
    #[cfg(target_os = "macos")]
    if let Ok(home) = std::env::var("HOME") {
        dirs.push(
            std::path::PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("com.mojang")
                .join("minecraftWorlds"),
        );
    }
    dirs
}

fn collect_worlds_from_dir(
    saves: &std::path::Path,
    worlds: &mut Vec<SavesWorldEntry>,
) {
    let Ok(entries) = std::fs::read_dir(saves) else { return };
    for e in entries.flatten() {
        let path = e.path();
        if !path.is_dir() { continue; }
        let level_dat = path.join("level.dat");
        if !level_dat.exists() { continue; }
        let modified_secs = std::fs::metadata(&level_dat).ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let Some(name) = path.file_name().map(|n| n.to_string_lossy().into_owned()) else { continue };
        let edition = if path.join("db").join("CURRENT").exists() {
            "bedrock".to_string()
        } else {
            "java".to_string()
        };
        worlds.push(SavesWorldEntry {
            name,
            level_dat_path: level_dat.to_string_lossy().into_owned(),
            modified_secs,
            edition,
        });
    }
}

#[tauri::command]
fn list_saves_worlds() -> Vec<SavesWorldEntry> {
    let mut worlds = Vec::new();
    if let Some(saves) = minecraft_saves_dir() {
        collect_worlds_from_dir(&saves, &mut worlds);
    }
    for saves in bedrock_saves_dirs() {
        collect_worlds_from_dir(&saves, &mut worlds);
    }
    worlds.sort_by(|a, b| b.modified_secs.cmp(&a.modified_secs));
    worlds
    // Deduplicate by path in case dirs overlap on unusual setups
}

// ── Region / chunk commands ───────────────────────────────────────────────────

#[tauri::command]
async fn get_cave_entrances(
    world_dir: String,
    dimension: String,
    cx0: i32, cz0: i32, cx1: i32, cz1: i32,
) -> Vec<i32> {
    tauri::async_runtime::spawn_blocking(move || {
        region_reader::get_cave_entrances_from_mca(&world_dir, &dimension, cx0, cz0, cx1, cz1)
    }).await.unwrap_or_default()
}

#[tauri::command]
async fn get_inhabited_times(
    world_dir: String,
    dimension: String,
    cx0: i32, cz0: i32, cx1: i32, cz1: i32,
) -> Vec<i64> {
    tauri::async_runtime::spawn_blocking(move || {
        region_reader::get_inhabited_times_from_mca(&world_dir, &dimension, cx0, cz0, cx1, cz1)
    }).await.unwrap_or_default()
}

#[tauri::command]
async fn get_block_at(
    world_dir:       String,
    edition:         String,
    dimension:       String,
    hide_water:      bool,
    cave_y:          Option<i32>,
    cave_scan_low:   i32,
    cave_scan_high:  i32,
    block_x:         i32,
    block_z:         i32,
    game_difficulty: Option<i32>,
    world_time:      Option<i64>,
    db_cache:        tauri::State<'_, BedrockDbCache>,
) -> Result<Option<ChunkInfo>, ()> {
    if edition == "bedrock" {
        Ok(db_cache.with(&world_dir, |db| {
            bedrock::chunk_reader::get_bedrock_block_at(
                db, &dimension, hide_water, cave_y, cave_scan_low, cave_scan_high,
                block_x, block_z,
            )
        }))
    } else {
        Ok(tauri::async_runtime::spawn_blocking(move || {
            Some(region_reader::get_chunk_info_from_mca(
                &world_dir, &dimension,
                hide_water, cave_y, cave_scan_low, cave_scan_high,
                block_x, block_z,
                game_difficulty, world_time,
            ))
        }).await.unwrap_or(None))
    }
}

#[tauri::command]
async fn get_local_difficulties(
    world_dir: String,
    dimension: String,
    cx0: i32, cz0: i32, cx1: i32, cz1: i32,
    game_difficulty: i32,
    world_time: i64,
) -> Vec<f64> {
    tauri::async_runtime::spawn_blocking(move || {
        let inhabited = region_reader::get_inhabited_times_from_mca(&world_dir, &dimension, cx0, cz0, cx1, cz1);
        inhabited.iter().map(|&t| {
            if t < 0 { -1.0 }
            else {
                let (special, _) = region_reader::compute_local_difficulty(game_difficulty, world_time, t);
                special
            }
        }).collect()
    }).await.unwrap_or_default()
}

// ── Tile cache commands ───────────────────────────────────────────────────────

#[tauri::command]
async fn render_biome_tile(
    app:        tauri::AppHandle,
    slot:       i32,
    seed_low:   i32,
    seed_high:  i32,
    mc_version: i32,
    dimension:  String,
    tile_x:     i32,
    tile_y:     i32,
    zoom:       i32,
) -> Option<String> {
    let cache_root = app.path().app_cache_dir()
        .map(|p| p.join("tile-cache").join(format!("v{}", tile_renderer::CACHE_VERSION)))
        .unwrap_or_else(|_| std::path::PathBuf::from("/tmp/msm-tile-cache"));
    tauri::async_runtime::spawn_blocking(move || {
        tile_renderer::render_biome_tile(
            &cache_root, slot, seed_low, seed_high, mc_version, &dimension,
            tile_x, tile_y, zoom,
        )
    }).await.ok().flatten()
}

#[tauri::command]
async fn render_tile(
    app:      tauri::AppHandle,
    sem:      tauri::State<'_, TileRenderSemaphore>,
    db_cache: tauri::State<'_, BedrockDbCache>,
    world_dir:      String,
    edition:        String,
    dimension:      String,
    tile_x:         i32,
    tile_y:         i32,
    zoom:           i32,
    hide_water:     bool,
    cave_y:         Option<i32>,
    cave_scan_low:  i32,
    cave_scan_high: i32,
) -> Result<Option<(String, u64)>, ()> {
    let cache_root = app.path().app_cache_dir()
        .map(|p| p.join("tile-cache").join(format!("v{}", tile_renderer::CACHE_VERSION)))
        .unwrap_or_else(|_| std::path::PathBuf::from("/tmp/msm-tile-cache"));

    if edition == "bedrock" {
        let _ = db_cache.get_or_open(&world_dir);
        // Bedrock: build closures around the DB cache
        let permit = sem.0.clone().acquire_owned().await.map_err(|_| ())?;
        // Clone what we need before moving into spawn_blocking
        let world_dir2 = world_dir.clone();
        let dim2 = dimension.clone();

        // We can't move db_cache (Tauri State) into spawn_blocking, so we collect
        // the chunk colors synchronously here and pass the Vec in.
        // For most tiles this is fast enough — the semaphore limits concurrency.
        let _ = permit; // release permit — blocking work is below on current thread
        let result = {
            let ldb_result = db_cache.with(&world_dir, |db| {
                tile_renderer::get_or_render_tile(
                    &cache_root,
                    &world_dir2,
                    &dim2,
                    tile_x, tile_y, zoom,
                    hide_water, cave_y, cave_scan_low, cave_scan_high,
                    // mtime closure
                    |_, _, _, _| bedrock::chunk_reader::max_ldb_mtime(&world_dir2),
                    // chunk colors closure
                    |reqs| bedrock::chunk_reader::read_bedrock_chunk_colors(
                        db, &dim2, reqs, hide_water, cave_y, cave_scan_low, cave_scan_high,
                    ),
                )
            });
            ldb_result
        };
        Ok(result.flatten())
    } else {
        let permit = sem.0.clone().acquire_owned().await.map_err(|_| ())?;
        tauri::async_runtime::spawn_blocking(move || {
            let _permit = permit;
            tile_renderer::get_or_render_tile(
                &cache_root,
                &world_dir,
                &dimension,
                tile_x, tile_y, zoom,
                hide_water, cave_y, cave_scan_low, cave_scan_high,
                |min_cx, max_cx, min_cz, max_cz| {
                    tile_renderer::max_mca_mtime(&world_dir, &dimension, min_cx, max_cx, min_cz, max_cz)
                },
                |reqs| region_reader::read_chunk_colors_from_mca(
                    &world_dir, &dimension, reqs, hide_water, cave_y, cave_scan_low, cave_scan_high,
                ),
            )
        }).await.map_err(|_| ())
    }
}

/// Cheap source-data freshness probe for a single tile: the max mtime (epoch
/// secs) of the region/db files feeding it. The frontend's in-memory tile cache
/// uses this to detect a live region rewrite without re-reading the PNG — closing
/// the gap where the disk cache self-heals via mtime but the decoded-ImageData
/// cache would otherwise keep serving a stale tile.
#[tauri::command]
fn tile_source_mtime(
    world_dir: String,
    edition:   String,
    dimension: String,
    tile_x:    i32,
    tile_y:    i32,
    zoom:      i32,
) -> u64 {
    if edition == "bedrock" {
        bedrock::chunk_reader::max_ldb_mtime(&world_dir)
    } else {
        let (min_cx, max_cx, min_cz, max_cz) = tile_renderer::tile_chunk_bounds(tile_x, tile_y, zoom);
        tile_renderer::max_mca_mtime(&world_dir, &dimension, min_cx, max_cx, min_cz, max_cz)
    }
}

#[tauri::command]
fn delete_tile_cache(app: tauri::AppHandle, world_dir: String) {
    let cache_root = app.path().app_cache_dir()
        .map(|p| p.join("tile-cache").join(format!("v{}", tile_renderer::CACHE_VERSION)))
        .unwrap_or_else(|_| std::path::PathBuf::from("/tmp/msm-tile-cache"));
    tile_renderer::delete_tile_cache(&cache_root, &world_dir);
}

#[tauri::command]
fn clear_biome_tile_cache(app: tauri::AppHandle, seed_low: i32, seed_high: i32) {
    let cache_root = app.path().app_cache_dir()
        .map(|p| p.join("tile-cache").join(format!("v{}", tile_renderer::CACHE_VERSION)))
        .unwrap_or_else(|_| std::path::PathBuf::from("/tmp/msm-tile-cache"));
    tile_renderer::clear_biome_tile_cache(&cache_root, seed_low, seed_high);
}

#[tauri::command]
async fn cubiomes_find_all_structures(
    app:        tauri::AppHandle,
    seed_low:   i32,
    seed_high:  i32,
    mc_version: i32,
    dimension:  String,
    world_flags: i32,
    bx0: i32, bz0: i32,
    bx1: i32, bz1: i32,
    enabled: Vec<String>,
) -> Vec<cubiomes::structures::StructureHit> {
    let cache_root = app.path().app_cache_dir()
        .map(|p| p.join("tile-cache").join(format!("v{}", tile_renderer::CACHE_VERSION)))
        .unwrap_or_else(|_| std::path::PathBuf::from("/tmp/msm-tile-cache"));
    let dim = match dimension.as_str() { "nether" => -1, "end" => 1, _ => 0 };
    let seed = cubiomes::seed_from_parts(seed_low, seed_high);
    tauri::async_runtime::spawn_blocking(move || {
        cubiomes::structures::find_all_structures_cached(
            &cache_root, seed, mc_version, dim, world_flags, bx0, bz0, bx1, bz1, &enabled,
        )
    }).await.unwrap_or_default()
}

#[tauri::command]
fn clear_structure_cache(app: tauri::AppHandle, seed_low: i32, seed_high: i32) {
    let cache_root = app.path().app_cache_dir()
        .map(|p| p.join("tile-cache").join(format!("v{}", tile_renderer::CACHE_VERSION)))
        .unwrap_or_else(|_| std::path::PathBuf::from("/tmp/msm-tile-cache"));
    cubiomes::structures::clear_structure_cache(&cache_root, seed_low, seed_high);
}

/// Alias used when the renderer wants to signal "this world's chunks are stale".
/// In the Rust backend there is no in-memory chunk cache separate from the disk
/// tile cache, so this is equivalent to deleting the disk tile cache.
#[tauri::command]
fn invalidate_tile_cache(app: tauri::AppHandle, world_dir: String) {
    delete_tile_cache(app, world_dir)
}

/// Selectively delete cached PNG tiles that overlap the given .mca regions.
/// Called by the renderer when a `region:changed` event arrives with specific coords.
#[tauri::command]
fn invalidate_mca_tiles(
    app:      tauri::AppHandle,
    world_dir: String,
    regions:   Vec<(i32, i32)>,
) {
    let cache_root = app.path().app_cache_dir()
        .map(|p| p.join("tile-cache").join(format!("v{}", tile_renderer::CACHE_VERSION)))
        .unwrap_or_else(|_| std::path::PathBuf::from("/tmp/msm-tile-cache"));
    tile_renderer::invalidate_mca_tiles(&cache_root, &world_dir, &regions);
}

// ── Export commands ───────────────────────────────────────────────────────────

#[tauri::command]
fn list_regions(
    world_dir: String,
    edition:   String,
    dimension: String,
    db_cache:  tauri::State<'_, BedrockDbCache>,
) -> Vec<(i32, i32)> {
    if edition == "bedrock" {
        let dim = bedrock::chunk_reader::dim_str_to_bedrock(&dimension);
        db_cache.with(&world_dir, |db| {
            bedrock::chunk_reader::list_bedrock_regions(db, dim)
        }).unwrap_or_default()
    } else {
        region_reader::list_regions(&world_dir, &dimension)
    }
}

#[tauri::command]
async fn select_export_path(app: tauri::AppHandle, default_name: String) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .add_filter("TIFF Image", &["tif", "tiff"])
        .set_file_name(&default_name)
        .blocking_save_file()
        .map(|p| p.to_string())
}

#[tauri::command]
async fn export_world_map(
    app:      tauri::AppHandle,
    db_cache: tauri::State<'_, BedrockDbCache>,
    world_dir:        String,
    edition:          String,
    dimension:        String,
    output_path:      String,
    hide_water:       bool,
    blocks_per_pixel: f64,
    seed_low:         i32,
    seed_high:        i32,
    mc_version:       i32,
    world_flags:      i32,
) -> Result<(), String> {
    let cancel = app.state::<ExportCancel>().inner().fresh();
    let app2 = app.clone();

    if edition == "bedrock" {
        let _ = db_cache.get_or_open(&world_dir);
        let db_arc = db_cache.get_arc(&world_dir).ok_or("Bedrock world DB not open")?;
        let dim_int = bedrock::chunk_reader::dim_str_to_bedrock(&dimension);
        let regions = bedrock::chunk_reader::list_bedrock_regions(&db_arc, dim_int);
        let dim_for_biome = dimension.clone();

        tauri::async_runtime::spawn_blocking(move || {
            tile_renderer::export_world_map(
                &app2, regions, &dim_for_biome, &output_path,
                blocks_per_pixel, seed_low, seed_high, mc_version, world_flags,
                cancel,
                move |reqs| bedrock::chunk_reader::read_bedrock_chunk_colors(
                    &db_arc, &dimension, reqs, hide_water, None, 0, 0,
                ),
            )
        }).await.map_err(|e| e.to_string())?
    } else {
        let regions = region_reader::list_regions(&world_dir, &dimension);
        let dim_for_biome = dimension.clone();

        tauri::async_runtime::spawn_blocking(move || {
            tile_renderer::export_world_map(
                &app2, regions, &dim_for_biome, &output_path,
                blocks_per_pixel, seed_low, seed_high, mc_version, world_flags,
                cancel,
                move |reqs| region_reader::read_chunk_colors_from_mca(
                    &world_dir, &dimension, reqs, hide_water, None, 0, 0,
                ),
            )
        }).await.map_err(|e| e.to_string())?
    }
}

#[tauri::command]
fn cancel_export(app: tauri::AppHandle) {
    app.state::<ExportCancel>().cancel();
}

// ── Metrics stubs ─────────────────────────────────────────────────────────────
// The Rust backend does not (yet) track per-render timing metrics.
// These stubs keep the renderer's ChunkDataOverlay wired up without crashing.

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct McaMetrics {
    color_cache_hits: u32, color_cache_misses: u32,
    disk_cache_hits: u32,  mca_reads: u32,
    parse_errors: u32,     skipped_chunks: u32,
    total_parse_ms: f64,   chunks_parsed: u32,
    peak_parse_ms: f64,    surface_find_ms: f64,
    io_ms: f64,            peak_io_ms: f64,
    decompress_ms: f64,    peak_decompress_ms: f64,
    nbt_parse_ms: f64,     peak_nbt_parse_ms: f64,
    peak_surface_find_ms: f64, color_assign_ms: f64,
    peak_color_assign_ms: f64, png_cache_hits: u32,
    png_cache_misses: u32, tiles_rendered: u32,
    tile_assembly_ms: f64, peak_tile_assembly_ms: f64,
    png_encode_ms: f64,    peak_png_encode_ms: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExtendedMetrics {
    metrics:           McaMetrics,
    color_cache_size:  u32,
    mem_rss_mb:        u32,
    mem_heap_used_mb:  u32,
    mem_heap_total_mb: u32,
}

#[tauri::command]
fn get_mca_metrics() -> ExtendedMetrics {
    ExtendedMetrics {
        metrics: McaMetrics {
            color_cache_hits: 0, color_cache_misses: 0, disk_cache_hits: 0,
            mca_reads: 0, parse_errors: 0, skipped_chunks: 0,
            total_parse_ms: 0.0, chunks_parsed: 0, peak_parse_ms: 0.0,
            surface_find_ms: 0.0, io_ms: 0.0, peak_io_ms: 0.0,
            decompress_ms: 0.0, peak_decompress_ms: 0.0, nbt_parse_ms: 0.0,
            peak_nbt_parse_ms: 0.0, peak_surface_find_ms: 0.0,
            color_assign_ms: 0.0, peak_color_assign_ms: 0.0,
            png_cache_hits: 0, png_cache_misses: 0, tiles_rendered: 0,
            tile_assembly_ms: 0.0, peak_tile_assembly_ms: 0.0,
            png_encode_ms: 0.0, peak_png_encode_ms: 0.0,
        },
        color_cache_size: 0,
        mem_rss_mb: 0,
        mem_heap_used_mb: 0,
        mem_heap_total_mb: 0,
    }
}

#[tauri::command]
fn reset_mca_metrics() {
    // No-op — metrics are not currently tracked in the Rust backend.
}

// ── App entry point ───────────────────────────────────────────────────────────

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(WatchStateMutex::new(file_watcher::WatchState::new()))
        .manage(ExportCancel::new())
        .manage(TileRenderSemaphore(Arc::new(tokio::sync::Semaphore::new(4))))
        .manage(BedrockDbCache::new())
        .invoke_handler(tauri::generate_handler![
            // Seed / level.dat
            read_level_dat,
            get_auto_load_data,
            select_level_dat,
            select_world_dir,
            list_saves_worlds,
            // Region / chunks
            get_cave_entrances,
            get_inhabited_times,
            get_block_at,
            get_local_difficulties,
            slime::is_slime_chunk,
            slime::get_slime_chunks,
            block_entity_reader::get_block_entities_cmd,
            entity_reader::get_entities_cmd,
            poi_reader::get_poi_cmd,
            // Tile cache
            render_biome_tile,
            render_tile,
            tile_source_mtime,
            delete_tile_cache,
            clear_biome_tile_cache,
            invalidate_tile_cache,
            invalidate_mca_tiles,
            // Export
            list_regions,
            select_export_path,
            export_world_map,
            cancel_export,
            // Metrics
            get_mca_metrics,
            reset_mca_metrics,
            // File watcher
            file_watcher::watch_world,
            file_watcher::unwatch_world,
            // cubiomes
            cubiomes::cubiomes_setup_generator,
            cubiomes::cubiomes_get_biomes,
            cubiomes::cubiomes_get_biomes_at,
            cubiomes_find_all_structures,
            clear_structure_cache,
            cubiomes::cubiomes_get_hover_biome,
            cubiomes::cubiomes_get_biomes_along_line,
            cubiomes::cubiomes_get_spawn,
            cubiomes::cubiomes_get_height_region,
            cubiomes::cubiomes_get_ore_veins_at,
            cubiomes::cubiomes_get_ore_veins_ex,
            cubiomes::cubiomes_generate_ore_features,
            cubiomes::cubiomes_get_carved_columns,
            cubiomes::cubiomes_get_ore_vein_columns,
            cubiomes::cubiomes_cancel_request,
            cubiomes::structures::cubiomes_get_structure_loot,
            cubiomes::structures::cubiomes_get_structure_chests,
            cubiomes::structures::cubiomes_get_end_gateway_links,
            cubiomes::cubiomes_get_surface_heights,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
