//! Static-site export: dumps a self-contained bundle of PNG tiles + JSON that
//! a plain Leaflet page (no Tauri backend) can render — see
//! `src/renderer/lib/staticExport/schema.ts` for the authoritative shape this
//! module must produce; keep the two in sync.
//!
//! Ore features and cave entrances are intentionally not exportable — see BUGS.md.

use crate::tile_renderer::BASE_BLOCKS_PER_PIXEL;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex};
use tauri::{Emitter, Manager};

pub const EXPORT_FORMAT_VERSION: &str = "1.0.0";
pub const REGION_BLOCK_SIZE: i32 = 512; // 32 chunks/axis, matches .mca region size

/// Structures get their own, coarser grid than POI/block-entities/entities:
/// unlike those, structure positions come straight from the seed rather than
/// generated-chunk data, so there's no reason to tie their file split to the
/// .mca region size — and structures are sparse enough that REGION_BLOCK_SIZE
/// tiling produces hundreds of near-empty files per dimension. 16 regions/side
/// (8192 blocks) also matches the sub-box size cubiomes_find_all_structures is
/// already batched into below, so one query batch maps to one output file.
pub const STRUCTURE_TILE_BLOCK_SIZE: i32 = REGION_BLOCK_SIZE * 16;

/// PNG size for the layers rasterized here (ore-veins/carvers/local-difficulty);
/// biome/chunk layers reuse the live-app renderers at their own tile size instead.
const PNG_TILE_PX: i32 = 512;
const MIN_ZOOM: i32 = -2;
// One below the live app's MAX_ZOOM (8) — zoom 8 quadruples tile count for
// negligible extra detail. Export-only; doesn't affect the live map's zoom range.
const MAX_ZOOM: i32 = 7;
const CHUNK_DATA_MIN_ZOOM: i32 = 2;
const CAVE_MODE_MIN_ZOOM: i32 = 4;
// True native-resolution ceilings, matching BiomeTileLayer.tsx's nativeZoom=2
// (cubiomes samples biomes on a 4-block grid) and ChunkOverlayLayer.tsx's
// CHUNK_NATIVE_ZOOM=4 (1 block/pixel) — deeper zooms are just the same pixels
// upscaled client-side, so rendering real tiles past these is wasted work.
const BIOME_NATIVE_MAX_ZOOM: i32 = 2;
const CHUNK_NATIVE_MAX_ZOOM: i32 = 4;

// ── Cancellation ──────────────────────────────────────────────────────────
// Mirrors `ExportCancel` (TIFF export) but kept separate so cancelling one
// export kind can't touch the other if they ever run concurrently.

pub struct StaticExportCancel(Mutex<Arc<AtomicBool>>);

impl StaticExportCancel {
    pub fn new() -> Self { StaticExportCancel(Mutex::new(Arc::new(AtomicBool::new(false)))) }
    fn fresh(&self) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        *self.0.lock().unwrap() = flag.clone();
        flag
    }
    pub fn cancel(&self) {
        self.0.lock().unwrap().store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
pub fn cancel_static_export(app: tauri::AppHandle) {
    app.state::<StaticExportCancel>().cancel();
}

#[tauri::command]
pub async fn select_export_dir(app: tauri::AppHandle, default_path: Option<String>) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let mut dialog = app.dialog().file().set_title("Choose Export Folder");
    if let Some(path) = default_path.as_deref().filter(|p| std::path::Path::new(p).is_dir()) {
        dialog = dialog.set_directory(path);
    }
    dialog.blocking_pick_folder().map(|p| p.to_string())
}

// ── Manifest shape (mirrors schema.ts) ───────────────────────────────────────────

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TileLayerManifest {
    pub path: String,
    pub min_zoom: i32,
    pub max_zoom: i32,
    /// Actual PNG pixel size of this layer's tiles — varies per layer.
    pub tile_size: i32,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CaveRangePreset {
    pub id: String,
    pub label: String,
    pub low: i32,
    pub high: i32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GridLayerManifest {
    pub path: String,
    pub format: String,
}

// cubiomes::structures::{ChestSlot, LootItem, GatewayLink} serialize snake_case
// with no rename_all; these wrappers remap to camelCase like every other
// exported layer, mirroring the hand-remap tauriAPI.ts does for IPC.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportEnchantment { name: String, level: i32 }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportLootItem {
    chest_x: i32,
    chest_z: i32,
    item: String,
    count: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    potion: Option<String>,
    enchantments: Vec<ExportEnchantment>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportChestSlot {
    chest_x: i32,
    chest_z: i32,
    table: String,
    is_ship: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportGatewayLink {
    src_x: i32,
    src_z: i32,
    dst_x: i32,
    dst_z: i32,
}

/// One entry of a 'structures' GridLayerManifest file.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportedStructure {
    struct_type: String,
    x: i32,
    z: i32,
    flags: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    variant_tag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    variant_color: Option<String>,
    /// Populated for structure types with a known piece id (see `struct_piece_id`).
    chests: Vec<ExportChestSlot>,
    /// Rolled item drops; only for types listed in `roll_loot_for` — rolling
    /// loot for every buried treasure/shipwreck on a large map isn't free.
    #[serde(skip_serializing_if = "Option::is_none")]
    loot: Option<Vec<ExportLootItem>>,
}

/// Structure types the backend can generate a piece id for. Mirrors
/// STRUCT_PIECE_ID in StructureLayer.tsx — keep in sync.
fn struct_piece_id(name: &str) -> Option<i32> {
    Some(match name {
        "desert_temple"        => 1,
        "jungle_temple"        => 2,
        "igloo"                => 4,
        "shipwreck"            => 7,
        "outpost"              => 10,
        "ruined_portal"        => 11,
        "ruined_portal_nether" => 12,
        "buried_treasure"      => 14,
        "fortress"             => 18,
        "bastion"              => 19,
        "end_city"             => 21,
        "abandoned_camp"       => 26,
        "stronghold"           => 27,
        _ => return None,
    })
}

/// Every structure name STRUCTURE_DEFS (cubiomes/structures.rs) knows. Passed
/// as `enabled` for every dimension — the backend filters by dimension
/// internally, so requesting irrelevant names is harmless. Keep in sync.
const STRUCTURE_NAMES: &[&str] = &[
    "village", "desert_temple", "jungle_temple", "witch_hut", "igloo",
    "ocean_ruins", "shipwreck", "ocean_monument", "mansion", "outpost",
    "ruined_portal", "ancient_city", "buried_treasure", "mineshaft",
    "desert_well", "geode", "trail_ruins", "trial_chambers", "abandoned_camp",
    "stronghold", "fortress", "bastion", "ruined_portal_nether",
    "end_city", "end_gateway", "end_island",
];

#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TileLayers {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub biome: Option<TileLayerManifest>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub underground: Option<TileLayerManifest>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chunk: Option<TileLayerManifest>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chunk_hide_water: Option<TileLayerManifest>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cave: Option<HashMap<String, TileLayerManifest>>,
    // Rasterized to PNG tiles (see "Rasterized overlay layers" below) so the
    // viewer's job is "load an image" uniformly across every layer.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ore_veins: Option<TileLayerManifest>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub carvers: Option<TileLayerManifest>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_difficulty: Option<TileLayerManifest>,
}

#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DataLayers {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub poi: Option<GridLayerManifest>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_entities: Option<GridLayerManifest>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entities: Option<GridLayerManifest>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub structures: Option<GridLayerManifest>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gateway_links: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spawn: Option<String>,
}

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct Bounds {
    pub min_block_x: i32,
    pub min_block_z: i32,
    pub max_block_x: i32,
    pub max_block_z: i32,
}

impl Bounds {
    fn union(self, other: Bounds) -> Bounds {
        Bounds {
            min_block_x: self.min_block_x.min(other.min_block_x),
            min_block_z: self.min_block_z.min(other.min_block_z),
            max_block_x: self.max_block_x.max(other.max_block_x),
            max_block_z: self.max_block_z.max(other.max_block_z),
        }
    }
}

// TileRange (block-space box + zoom range + tile pixel size, and the
// zoom->tile-index math) now lives in tile_pyramid.rs, shared with
// run_tile_pyramid.
pub use crate::tile_pyramid::TileRange;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DimensionManifest {
    pub dimension: String,
    pub bounds: Bounds,
    pub regions: Vec<(i32, i32)>,
    /// This dimension's own named Y-bands (Overworld and Nether don't share a
    /// Y space). Matched against caveScanLow/High by the viewer.
    pub cave_range_presets: Vec<CaveRangePreset>,
    pub tiles: TileLayers,
    pub data: DataLayers,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorldInfo {
    pub level_name: String,
    pub seed: String,
    pub mc_version: i32,
    pub data_version: i32,
    pub version_name: String,
    pub edition: String,
    pub world_type: String,
    pub difficulty: i32,
    pub border_center_x: f64,
    pub border_center_z: f64,
    pub border_size: f64,
    pub game_rules: HashMap<String, String>,
}

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct TileGrid {
    pub base_blocks_per_pixel: f64,
    pub tile_size: i32,
    pub min_zoom: i32,
    pub max_zoom: i32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GeneratorInfo {
    pub app: &'static str,
    pub app_version: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportManifest {
    pub format_version: &'static str,
    pub generated_at: String,
    pub generator: GeneratorInfo,
    pub world: WorldInfo,
    pub tile_grid: TileGrid,
    pub dimensions: Vec<DimensionManifest>,
    /// Opaque pass-through — the frontend's OverlaySession; Rust never interprets it.
    pub default_settings: serde_json::Value,
    /// Opaque pass-through — the frontend's CustomMarkerGroup[].
    pub marker_groups: serde_json::Value,
}

/// A small sibling of manifest.json for anything that just wants to
/// *describe* the bundle (e.g. layer-availability pills) without paying for
/// manifest.json's full per-tile-layer paths and region lists. Written once, after export.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportMeta {
    pub format_version: &'static str,
    pub generated_at: String,
    pub level_name: String,
    pub version_name: String,
    pub edition: String,
    pub dimensions: Vec<String>,
    /// Total region files across all exported dimensions — a cheap stand-in
    /// for "how big is this world" without a filesystem-size stat.
    pub regions: usize,
    pub layers: ExportMetaLayers,
}

/// Mirrors the export dialog's `include_*` toggles — what the user chose,
/// not what ended up non-empty (a checked-but-empty layer still reads "enabled" here).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportMetaLayers {
    pub biome: bool,
    pub underground: bool,
    pub chunk: bool,
    pub chunk_hide_water: bool,
    pub cave: bool,
    pub ore_veins: bool,
    pub carvers: bool,
    pub local_difficulty: bool,
}

// ── Input params ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticExportParams {
    pub world_dir: String,
    pub edition: String,
    pub output_dir: String,
    pub seed_low: i32,
    pub seed_high: i32,
    pub mc_version: i32,
    pub world_flags: i32,
    pub level_name: String,
    pub data_version: i32,
    pub version_name: String,
    pub world_type: String,
    pub difficulty: i32,
    /// Only used to rasterize local-difficulty (grows with world time survived).
    pub world_time: i64,
    pub border_center_x: f64,
    pub border_center_z: f64,
    pub border_size: f64,
    pub game_rules: HashMap<String, String>,
    /// A dimension with no generated chunks is silently omitted from the
    /// manifest rather than failing the whole export.
    pub dimensions: Vec<String>,
    pub include_biome_tiles: bool,
    /// Overworld-only regardless of this flag — no underground tile elsewhere.
    pub include_underground_tiles: bool,
    pub include_chunk_tiles: bool,
    pub include_chunk_hide_water_tiles: bool,
    /// Keyed by dimension (Overworld/Nether don't share a Y space); a
    /// dimension missing or empty gets no cave tiles. Skipped for the End.
    pub cave_range_presets: HashMap<String, Vec<CaveRangePreset>>,
    /// Overworld-only regardless of this flag — vein fields don't exist elsewhere.
    pub include_ore_veins: bool,
    /// Skipped for the End regardless — no carvers there.
    pub include_carvers: bool,
    pub include_local_difficulty: bool,
    /// Structure types to roll full chest loot for vs. just reporting which
    /// loot tables are present. Empty = chests only.
    pub roll_loot_for: Vec<String>,
    pub default_settings: serde_json::Value,
    pub marker_groups: serde_json::Value,
}

// ── Progress events ───────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
struct StaticExportProgress<'a> {
    stage: &'a str,
    dimension: Option<&'a str>,
    done: u32,
    total: u32,
}

fn dimension_to_cubiomes_id(dimension: &str) -> i32 {
    match dimension { "nether" => -1, "end" => 1, _ => 0 }
}

/// Region list + block-space bounds for one dimension, expanded by one region
/// of margin per side so structures/tiles just past the last generated
/// region aren't clipped. `None` when the dimension has no generated chunks.
fn dimension_regions_and_bounds(
    world_dir: &str,
    edition:   &str,
    dimension: &str,
    db_cache:  &crate::BedrockDbCache,
) -> Option<(Vec<(i32, i32)>, Bounds)> {
    let regions = if edition == "bedrock" {
        let dim = crate::bedrock::chunk_reader::dim_str_to_bedrock(dimension);
        db_cache.with(world_dir, |db| {
            crate::bedrock::chunk_reader::list_bedrock_regions(db, dim)
        }).unwrap_or_default()
    } else {
        crate::region_reader::list_regions(world_dir, dimension)
    };

    if regions.is_empty() { return None; }

    let rx_min = regions.iter().map(|&(rx, _)| rx).min().unwrap() - 1;
    let rx_max = regions.iter().map(|&(rx, _)| rx).max().unwrap() + 1;
    let rz_min = regions.iter().map(|&(_, rz)| rz).min().unwrap() - 1;
    let rz_max = regions.iter().map(|&(_, rz)| rz).max().unwrap() + 1;

    let bounds = Bounds {
        min_block_x: rx_min * REGION_BLOCK_SIZE,
        min_block_z: rz_min * REGION_BLOCK_SIZE,
        max_block_x: (rx_max + 1) * REGION_BLOCK_SIZE - 1,
        max_block_z: (rz_max + 1) * REGION_BLOCK_SIZE - 1,
    };

    Some((regions, bounds))
}

// ── Tile pyramid rendering ──────────────────────────────────────────────────
// Force-renders every (zoom, tx, ty) covering `bounds` for one layer, reusing
// the same command functions the live map calls per-tile, so export output
// matches what the live app would cache for the same view (and does cache it
// — these write to the disk tile cache too, we just also copy into the bundle).

/// Above this, treat border_size as "vanilla default, no real border set" —
/// the raw value (60,000,000) would try to cover a 120M-block box otherwise.
const SEED_LAYER_MAX_RADIUS: f64 = 8000.0;

/// Bounds for pure (seed, coordinate) query layers — biome, underground,
/// ore-veins/carvers, structures — none of which need real chunk data, so
/// they're centered on the world border (or a sane default radius), not clipped to explored regions.
fn seed_layer_bounds(params: &StaticExportParams) -> Bounds {
    let radius = (params.border_size / 2.0).min(SEED_LAYER_MAX_RADIUS);
    Bounds {
        min_block_x: (params.border_center_x - radius).floor() as i32,
        min_block_z: (params.border_center_z - radius).floor() as i32,
        max_block_x: (params.border_center_x + radius).ceil() as i32,
        max_block_z: (params.border_center_z + radius).ceil() as i32,
    }
}

fn copy_tile(src_path: &str, layer_root: &std::path::Path, zoom: i32, tx: i32, ty: i32) -> Result<(), String> {
    let dst_dir = layer_root.join(zoom.to_string());
    std::fs::create_dir_all(&dst_dir).map_err(|e| format!("Couldn't create {}: {e}", dst_dir.display()))?;
    let dst = dst_dir.join(format!("{tx}_{ty}.png"));
    std::fs::copy(src_path, &dst).map_err(|e| format!("Couldn't copy tile to {}: {e}", dst.display()))?;
    Ok(())
}

/// Moves a synchronous `std::fs` closure onto the blocking pool and awaits it
/// immediately, so call sites stay sequential (never concurrent) despite the offload.
async fn blocking_io<F, T>(f: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("blocking I/O task panicked: {e}"))?
}

#[allow(clippy::too_many_arguments)]
async fn export_biome_like_layer(
    app: &tauri::AppHandle,
    out_dir: &std::path::Path,
    layer_dir_name: &str,
    dimension: &str,
    slot: i32, seed_low: i32, seed_high: i32, mc_version: i32, world_flags: i32,
    range: TileRange,
    underground: bool,
    cancel: &Arc<AtomicBool>,
) -> Result<TileLayerManifest, String> {
    let layer_root = out_dir.join("tiles").join(dimension).join(layer_dir_name);

    crate::tile_pyramid::run_tile_pyramid(app, cancel, layer_dir_name, dimension, range, |zoom, tx, ty| {
        let (app, layer_root) = (app.clone(), layer_root.clone());
        let dimension = dimension.to_string();
        async move {
            let result = if underground {
                crate::render_underground_biome_tile(
                    app, slot, seed_low, seed_high, mc_version, world_flags, dimension, tx, ty, zoom,
                ).await
            } else {
                crate::render_biome_tile(
                    app, slot, seed_low, seed_high, mc_version, world_flags, dimension, tx, ty, zoom,
                ).await
            };
            if let Some((src_path, _mtime)) = result {
                blocking_io(move || copy_tile(&src_path, &layer_root, zoom, tx, ty)).await?;
            }
            Ok(())
        }
    }).await?;

    Ok(TileLayerManifest {
        path: format!("tiles/{dimension}/{layer_dir_name}"),
        min_zoom: range.zoom_min,
        max_zoom: range.zoom_max,
        tile_size: range.tile_px,
    })
}

#[allow(clippy::too_many_arguments)]
async fn export_chunk_layer(
    app: &tauri::AppHandle,
    sem: tauri::State<'_, crate::TileRenderSemaphore>,
    db_cache: tauri::State<'_, crate::BedrockDbCache>,
    out_dir: &std::path::Path,
    layer_dir_name: &str,
    world_dir: &str,
    edition: &str,
    dimension: &str,
    range: TileRange,
    hide_water: bool,
    cave_y: Option<i32>, cave_scan_low: i32, cave_scan_high: i32,
    cancel: &Arc<AtomicBool>,
) -> Result<TileLayerManifest, String> {
    let layer_root = out_dir.join("tiles").join(dimension).join(layer_dir_name);

    crate::tile_pyramid::run_tile_pyramid(app, cancel, layer_dir_name, dimension, range, |zoom, tx, ty| {
        let (app, sem, db_cache, layer_root) = (app.clone(), sem.clone(), db_cache.clone(), layer_root.clone());
        let (world_dir, edition, dimension) = (world_dir.to_string(), edition.to_string(), dimension.to_string());
        async move {
            let result = crate::render_tile(
                app, sem, db_cache, world_dir, edition, dimension,
                tx, ty, zoom, hide_water, cave_y, cave_scan_low, cave_scan_high,
            ).await.map_err(|_| "Tile render task failed.".to_string())?;
            if let Some((src_path, _mtime)) = result {
                blocking_io(move || copy_tile(&src_path, &layer_root, zoom, tx, ty)).await?;
            }
            Ok(())
        }
    }).await?;

    Ok(TileLayerManifest {
        path: format!("tiles/{dimension}/{layer_dir_name}"),
        min_zoom: range.zoom_min,
        max_zoom: range.zoom_max,
        tile_size: range.tile_px,
    })
}

// ── Region-gridded vector data ───────────────────────────────────────────
// One JSON file per world region instead of one flat array per dimension.

/// POI/block-entities/entities: queries only the already-generated regions
/// (they only ever have data where chunks exist), one region's 32×32 chunk
/// range per call, via whichever `*_cmd` closure the caller passes in.
async fn export_region_gridded<T, F, Fut>(
    out_dir: &std::path::Path,
    dimension: &str,
    layer_dir_name: &str,
    format: &str,
    regions: &[(i32, i32)],
    fetch: F,
) -> Result<GridLayerManifest, String>
where
    T: Serialize,
    F: Fn(i32, i32, i32, i32) -> Fut,
    Fut: std::future::Future<Output = Result<Vec<T>, ()>>,
{
    let layer_root = out_dir.join("data").join(dimension).join(layer_dir_name);
    for &(rx, rz) in regions {
        let min_cx = rx * 32;
        let min_cz = rz * 32;
        let items = fetch(min_cx, min_cz, min_cx + 31, min_cz + 31).await
            .map_err(|_| format!("{layer_dir_name} query failed for region ({rx},{rz})"))?;
        if items.is_empty() { continue; }
        let json = serde_json::to_vec(&items).map_err(|e| format!("Couldn't serialize {layer_dir_name}: {e}"))?;
        let layer_root_c = layer_root.clone();
        let layer_dir_name_c = layer_dir_name.to_string();
        blocking_io(move || {
            std::fs::create_dir_all(&layer_root_c).map_err(|e| format!("Couldn't create {}: {e}", layer_root_c.display()))?;
            let dst = layer_root_c.join(format!("{rx}_{rz}.json"));
            std::fs::write(&dst, json).map_err(|e| format!("Couldn't write {layer_dir_name_c} region ({rx},{rz}): {e}"))
        }).await?;
    }
    Ok(GridLayerManifest { path: format!("data/{dimension}/{layer_dir_name}"), format: format.to_string() })
}

/// Structures: unlike POI/block-entities/entities, positions are known
/// straight from the seed even in ungenerated chunks, so this queries the
/// *whole* export bounds rather than being restricted to generated regions.
/// Structures can land in regions with no generated chunks at all — that's
/// fine, `DimensionManifest.regions` only ever tracks real generated-chunk
/// regions (for the "generated regions" overlay); the frontend's structures
/// fetch doesn't consult it and just treats a missing tile file as empty.
#[allow(clippy::too_many_arguments)]
async fn export_structures_layer(
    app: &tauri::AppHandle,
    out_dir: &std::path::Path,
    dimension: &str,
    dim_id: i32,
    slot: i32, seed_low: i32, seed_high: i32, mc_version: i32, world_flags: i32,
    bounds: Bounds,
    roll_loot_for: &[String],
    cancel: &Arc<AtomicBool>,
) -> Result<GridLayerManifest, String> {
    let enabled: Vec<String> = STRUCTURE_NAMES.iter().map(|s| s.to_string()).collect();

    // find_all_structures_cached (structures.rs) caps its per-call tile count
    // at 512 (a guard sized for live viewport queries) and silently falls
    // back to strongholds-only if a single box exceeds it — the export's
    // bounds routinely do. Tile our own query into sub-boxes under the cap
    // and de-dupe by (type, x, z), since adjacent sub-boxes' margins overlap.
    const QUERY_BATCH_BLOCKS: i32 = STRUCTURE_TILE_BLOCK_SIZE;
    let mut hits = Vec::new();
    let mut seen = std::collections::HashSet::<(String, i32, i32)>::new();
    let mut bx0 = bounds.min_block_x;
    while bx0 <= bounds.max_block_x {
        let bx1 = (bx0 + QUERY_BATCH_BLOCKS - 1).min(bounds.max_block_x);
        let mut bz0 = bounds.min_block_z;
        while bz0 <= bounds.max_block_z {
            let bz1 = (bz0 + QUERY_BATCH_BLOCKS - 1).min(bounds.max_block_z);
            if cancel.load(Ordering::Relaxed) {
                return Err("Export cancelled.".to_string());
            }
            let batch = crate::cubiomes_find_all_structures(
                app.clone(), seed_low, seed_high, mc_version, dimension.to_string(), world_flags,
                bx0, bz0, bx1, bz1, enabled.clone(),
            ).await;
            for hit in batch {
                if seen.insert((hit.struct_type.clone(), hit.x, hit.z)) {
                    hits.push(hit);
                }
            }
            bz0 += QUERY_BATCH_BLOCKS;
        }
        bx0 += QUERY_BATCH_BLOCKS;
    }

    let mut by_region: HashMap<(i32, i32), Vec<ExportedStructure>> = HashMap::new();

    for hit in hits {
        if cancel.load(Ordering::Relaxed) {
            return Err("Export cancelled.".to_string());
        }

        // cubiomes_find_all_structures bounds every type to the query box
        // *except* strongholds (cm_get_strongholds returns all ~128 globally)
        // — re-check so a small export doesn't drag in far-off region files.
        if hit.x < bounds.min_block_x || hit.x > bounds.max_block_x
            || hit.z < bounds.min_block_z || hit.z > bounds.max_block_z {
            continue;
        }

        let mut chests = Vec::new();
        let mut loot = None;
        if let Some(piece_id) = struct_piece_id(&hit.struct_type) {
            let raw_chests = crate::cubiomes::structures::cubiomes_get_structure_chests(
                slot, seed_low, seed_high, dim_id, world_flags, mc_version, piece_id, hit.x, hit.z,
            ).await;
            chests = raw_chests.into_iter()
                .map(|c| ExportChestSlot { chest_x: c.chest_x, chest_z: c.chest_z, table: c.table, is_ship: c.is_ship })
                .collect();

            if !chests.is_empty() && roll_loot_for.iter().any(|n| n == &hit.struct_type) {
                let raw_loot = crate::cubiomes::structures::cubiomes_get_structure_loot(
                    slot, seed_low, seed_high, dim_id, world_flags, mc_version, piece_id, hit.x, hit.z,
                ).await;
                loot = Some(raw_loot.into_iter().map(|l| ExportLootItem {
                    chest_x: l.chest_x, chest_z: l.chest_z, item: l.item, count: l.count,
                    potion: l.potion,
                    enchantments: l.enchantments.into_iter()
                        .map(|e| ExportEnchantment { name: e.name, level: e.level })
                        .collect(),
                }).collect());
            }
        }

        let rx = hit.x.div_euclid(STRUCTURE_TILE_BLOCK_SIZE);
        let rz = hit.z.div_euclid(STRUCTURE_TILE_BLOCK_SIZE);
        by_region.entry((rx, rz)).or_default().push(ExportedStructure {
            struct_type: hit.struct_type, x: hit.x, z: hit.z, flags: hit.flags,
            variant_tag: hit.variant_tag, variant_color: hit.variant_color,
            chests, loot,
        });
    }

    let layer_root = out_dir.join("data").join(dimension).join("structures");
    for (&(rx, rz), items) in &by_region {
        let json = serde_json::to_vec(items).map_err(|e| format!("Couldn't serialize structures: {e}"))?;
        let layer_root_c = layer_root.clone();
        blocking_io(move || {
            std::fs::create_dir_all(&layer_root_c).map_err(|e| format!("Couldn't create {}: {e}", layer_root_c.display()))?;
            std::fs::write(layer_root_c.join(format!("{rx}_{rz}.json")), json)
                .map_err(|e| format!("Couldn't write structures region ({rx},{rz}): {e}"))
        }).await?;
    }

    Ok(GridLayerManifest { path: format!("data/{dimension}/structures"), format: "structures".to_string() })
}

// ── Rasterized overlay layers ─────────────────────────────────────────────
// Ore veins, carvers, and local difficulty are live-rendered client-side
// (overlayTileWorker.ts) from raw per-chunk arrays over IPC; baking them to
// PNG tiles here instead reuses the same tile-pyramid mechanism as
// biome/chunk tiles. Pixel formulas are ported 1:1 from overlayTileWorker.ts
// / LocalDifficultyLayer.tsx so exports match the live overlay exactly.
//
// Slime chunks are NOT rasterized — is_slime_chunk (slime.rs) is a cheap pure
// function of (seed, cx, cz), ported straight into the static viewer's JS instead.

fn encode_png_rgba(pixels: &[u8], size: u32) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    let mut encoder = png::Encoder::new(std::io::Cursor::new(&mut buf), size, size);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.set_compression(png::Compression::Fast);
    let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
    writer.write_image_data(pixels).map_err(|e| e.to_string())?;
    drop(writer);
    Ok(buf)
}

fn has_content(pixels: &[u8]) -> bool {
    pixels.chunks_exact(4).any(|p| p[3] != 0)
}

fn decode_png_rgba(path: &std::path::Path) -> Option<(Vec<u8>, u32)> {
    let file = std::fs::File::open(path).ok()?;
    let decoder = png::Decoder::new(file);
    let mut reader = decoder.read_info().ok()?;
    let mut buf = vec![0u8; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).ok()?;
    buf.truncate(info.buffer_size());
    if info.color_type != png::ColorType::Rgba || info.bit_depth != png::BitDepth::Eight {
        return None;
    }
    Some((buf, info.width))
}

/// Stitches native tiles under `layer_dir` into fewer, larger PNGs in place,
/// cutting the HTTP requests a panning/zooming viewer makes. `factor` is
/// derived per zoom directory from its own native tile size (128px for
/// chunk-family layers, 512px for others) so every layer converges on
/// roughly the same composite size rather than over/under-shooting with one fixed factor.
///
/// Coordinate math is exact: dividing the tile index by `factor` while
/// multiplying `tile_px` by `factor` lands on the identical block origin
/// (`(tx/factor)*(px*factor) == tx*px`), so this is a pure write-side
/// transform — `resolveTile` in tauriAPI.static.ts already builds URLs from
/// whatever `tileSize` the manifest reports.
///
/// Deletes the native files it replaces. Returns the actual composite pixel
/// size (an integer division of `target_px`, so may land under it if native
/// size doesn't divide evenly) — the caller records this as the manifest's `tileSize`.
pub fn composite_tile_layer(layer_dir: &std::path::Path, target_px: i32) -> Result<i32, String> {
    let mut layer_composite_px: Option<i32> = None;
    let zoom_dirs: Vec<std::path::PathBuf> = std::fs::read_dir(layer_dir)
        .map_err(|e| format!("Couldn't read {}: {e}", layer_dir.display()))?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();

    for zoom_dir in zoom_dirs {
        // (tx, ty) -> source file path, for every native tile in this zoom.
        let mut native: HashMap<(i32, i32), std::path::PathBuf> = HashMap::new();
        for entry in std::fs::read_dir(&zoom_dir).map_err(|e| e.to_string())?.filter_map(|e| e.ok()) {
            let path = entry.path();
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else { continue };
            let Some((tx_s, ty_s)) = stem.split_once('_') else { continue };
            let (Ok(tx), Ok(ty)) = (tx_s.parse::<i32>(), ty_s.parse::<i32>()) else { continue };
            native.insert((tx, ty), path);
        }
        if native.is_empty() { continue; }

        // Peek one file to learn this zoom's native tile size, then derive
        // the grid factor from the target pixel size (see doc comment above).
        let peek_path = native.values().next().unwrap();
        let Some((_, zoom_native_px)) = decode_png_rgba(peek_path) else {
            return Err(format!("Couldn't decode {} to determine native tile size", peek_path.display()));
        };
        let factor = (target_px / zoom_native_px as i32).max(1);
        if layer_composite_px.is_none() { layer_composite_px = Some(zoom_native_px as i32 * factor); }
        if factor == 1 { continue; } // native tiles already meet/exceed target — nothing to do

        let mut groups: HashMap<(i32, i32), Vec<(i32, i32)>> = HashMap::new();
        for &(tx, ty) in native.keys() {
            groups.entry((tx.div_euclid(factor), ty.div_euclid(factor))).or_default().push((tx, ty));
        }

        let mut composites: Vec<((i32, i32), Vec<u8>)> = Vec::new();
        for (cell, members) in &groups {
            let mut composite_px: Option<u32> = None;
            let mut pixels: Option<Vec<u8>> = None;
            let mut canvas_size = 0u32;
            for &(tx, ty) in members {
                let path = &native[&(tx, ty)];
                let Some((px, size)) = decode_png_rgba(path) else { continue };
                if composite_px.is_none() {
                    composite_px = Some(size);
                    canvas_size = size * factor as u32;
                    pixels = Some(vec![0u8; (canvas_size * canvas_size * 4) as usize]);
                }
                let size = composite_px.unwrap();
                let canvas = pixels.as_mut().unwrap();
                let ox = (tx.rem_euclid(factor)) as u32 * size;
                let oy = (ty.rem_euclid(factor)) as u32 * size;
                for row in 0..size {
                    let src_off = (row * size * 4) as usize;
                    let dst_off = (((oy + row) * canvas_size + ox) * 4) as usize;
                    canvas[dst_off..dst_off + (size * 4) as usize]
                        .copy_from_slice(&px[src_off..src_off + (size * 4) as usize]);
                }
            }
            if let Some(pixels) = pixels {
                let bytes = encode_png_rgba(&pixels, canvas_size)?;
                composites.push((*cell, bytes));
            }
        }

        // Delete natives first so a composite filename can never collide
        // with a not-yet-processed native file, then write composites fresh.
        for path in native.values() {
            let _ = std::fs::remove_file(path);
        }
        for ((cx, cy), bytes) in composites {
            let dst = zoom_dir.join(format!("{cx}_{cy}.png"));
            std::fs::write(&dst, bytes).map_err(|e| format!("Couldn't write {}: {e}", dst.display()))?;
        }
    }

    layer_composite_px.ok_or_else(|| format!("No tiles found under {}", layer_dir.display()))
}

fn write_raster_tile(pixels: &[u8], layer_root: &std::path::Path, zoom: i32, tx: i32, ty: i32) -> Result<(), String> {
    if !has_content(pixels) { return Ok(()); }
    let png_bytes = encode_png_rgba(pixels, PNG_TILE_PX as u32)?;
    let dst_dir = layer_root.join(zoom.to_string());
    std::fs::create_dir_all(&dst_dir).map_err(|e| format!("Couldn't create {}: {e}", dst_dir.display()))?;
    let dst = dst_dir.join(format!("{tx}_{ty}.png"));
    std::fs::write(&dst, png_bytes).map_err(|e| format!("Couldn't write {}: {e}", dst.display()))
}

/// Mirrors difficultyColor() in LocalDifficultyLayer.tsx.
fn difficulty_color(t: f64) -> [u8; 3] {
    if t <= 0.5 {
        let u = t * 2.0;
        [(40.0 + 180.0 * u).round() as u8, (180.0 + 20.0 * u).round() as u8, 40]
    } else {
        let u = (t - 0.5) * 2.0;
        [220, (200.0 - 160.0 * u).round().clamp(0.0, 255.0) as u8, 40]
    }
}

/// Ore-vein footprint (per-column copper/iron blob shape) — overworld only.
/// Mirrors handleOreVeinColumns() in overlayTileWorker.ts.
#[allow(clippy::too_many_arguments)]
async fn export_ore_veins_layer(
    out_dir: &std::path::Path, dimension: &str,
    slot: i32, seed_low: i32, seed_high: i32, dim_id: i32, world_flags: i32, mc_version: i32,
    range: TileRange,
    app: &tauri::AppHandle, cancel: &Arc<AtomicBool>,
) -> Result<TileLayerManifest, String> {
    let layer_root = out_dir.join("tiles").join(dimension).join("ore-veins");

    crate::tile_pyramid::run_tile_pyramid(app, cancel, "ore-veins", dimension, range, |zoom, tx, ty| {
        let layer_root = layer_root.clone();
        async move {
            let (min_cx, max_cx, min_cz, max_cz) = crate::tile_renderer::tile_chunk_bounds(tx, ty, zoom);
            let data = crate::cubiomes::cubiomes_get_ore_vein_columns(
                slot, seed_low, seed_high, dim_id, world_flags, mc_version, min_cx, min_cz, max_cx, max_cz, 0,
            ).await;
            if data.len() >= 2 {
                let nx = data[0].max(0);
                let nz = data[1].max(0);
                if nx > 0 && nz > 0 {
                    let (origin_x, origin_z, bpp) = crate::tile_renderer::tile_origin_blocks(tx, ty, zoom, PNG_TILE_PX as usize);
                    let mut pixels = vec![0u8; PNG_TILE_PX as usize * PNG_TILE_PX as usize * 4];
                    for py in 0..PNG_TILE_PX {
                        for px in 0..PNG_TILE_PX {
                            let bx = (origin_x + (px as f64 + 0.5) * bpp).floor() as i32;
                            let bz = (origin_z + (py as f64 + 0.5) * bpp).floor() as i32;
                            let ci = bx.div_euclid(16) - min_cx;
                            let cj = bz.div_euclid(16) - min_cz;
                            if ci < 0 || ci >= nx || cj < 0 || cj >= nz { continue; }
                            let lx = bx.rem_euclid(16);
                            let lz = bz.rem_euclid(16);
                            let base = 2 + ((cj * nx + ci) * 256 + lz * 16 + lx) as usize * 2;
                            let (copper, iron) = (data[base], data[base + 1]);
                            if copper == 0 && iron == 0 { continue; }
                            let (rgb, count) = if copper >= iron { ([210u8, 120, 30], copper) } else { ([165u8, 165, 170], iron) };
                            let off = (py * PNG_TILE_PX + px) as usize * 4;
                            pixels[off] = rgb[0]; pixels[off + 1] = rgb[1]; pixels[off + 2] = rgb[2];
                            pixels[off + 3] = (80 + count * 14).min(235) as u8;
                        }
                    }
                    blocking_io(move || write_raster_tile(&pixels, &layer_root, zoom, tx, ty)).await?;
                }
            }
            Ok(())
        }
    }).await?;

    Ok(TileLayerManifest { path: format!("tiles/{dimension}/ore-veins"), min_zoom: range.zoom_min, max_zoom: range.zoom_max, tile_size: range.tile_px })
}

/// Carver (cave/ravine/canyon) coverage, top-down. Mirrors handleCarver().
#[allow(clippy::too_many_arguments)]
async fn export_carvers_layer(
    out_dir: &std::path::Path, dimension: &str,
    slot: i32, seed_low: i32, seed_high: i32, dim_id: i32, world_flags: i32, mc_version: i32,
    range: TileRange,
    app: &tauri::AppHandle, cancel: &Arc<AtomicBool>,
) -> Result<TileLayerManifest, String> {
    const CARVE_RGB: [u8; 3] = [56, 132, 156];
    let layer_root = out_dir.join("tiles").join(dimension).join("carvers");

    crate::tile_pyramid::run_tile_pyramid(app, cancel, "carvers", dimension, range, |zoom, tx, ty| {
        let layer_root = layer_root.clone();
        async move {
            let (min_cx, max_cx, min_cz, max_cz) = crate::tile_renderer::tile_chunk_bounds(tx, ty, zoom);
            let data = crate::cubiomes::cubiomes_get_carved_columns(
                slot, seed_low, seed_high, dim_id, world_flags, mc_version, min_cx, min_cz, max_cx, max_cz, 0,
            ).await;
            if data.len() >= 2 {
                let nx = data[0].max(0);
                let nz = data[1].max(0);
                if nx > 0 && nz > 0 {
                    let (origin_x, origin_z, bpp) = crate::tile_renderer::tile_origin_blocks(tx, ty, zoom, PNG_TILE_PX as usize);
                    let mut pixels = vec![0u8; PNG_TILE_PX as usize * PNG_TILE_PX as usize * 4];
                    for py in 0..PNG_TILE_PX {
                        for px in 0..PNG_TILE_PX {
                            let bx = (origin_x + (px as f64 + 0.5) * bpp).floor() as i32;
                            let bz = (origin_z + (py as f64 + 0.5) * bpp).floor() as i32;
                            let ci = bx.div_euclid(16) - min_cx;
                            let cj = bz.div_euclid(16) - min_cz;
                            if ci < 0 || ci >= nx || cj < 0 || cj >= nz { continue; }
                            let lx = bx.rem_euclid(16);
                            let lz = bz.rem_euclid(16);
                            let count = data[2 + ((cj * nx + ci) * 256 + lz * 16 + lx) as usize];
                            if count <= 0 { continue; }
                            let off = (py * PNG_TILE_PX + px) as usize * 4;
                            pixels[off] = CARVE_RGB[0]; pixels[off + 1] = CARVE_RGB[1]; pixels[off + 2] = CARVE_RGB[2];
                            pixels[off + 3] = (70 + count * 10).min(220) as u8;
                        }
                    }
                    blocking_io(move || write_raster_tile(&pixels, &layer_root, zoom, tx, ty)).await?;
                }
            }
            Ok(())
        }
    }).await?;

    Ok(TileLayerManifest { path: format!("tiles/{dimension}/carvers"), min_zoom: range.zoom_min, max_zoom: range.zoom_max, tile_size: range.tile_px })
}

/// Regional difficulty (real save data — inhabited time + game difficulty +
/// world time). Mirrors the color/alpha logic inlined in LocalDifficultyLayer.tsx.
#[allow(clippy::too_many_arguments)]
async fn export_local_difficulty_layer(
    out_dir: &std::path::Path, world_dir: &str, dimension: &str,
    game_difficulty: i32, world_time: i64,
    range: TileRange,
    app: &tauri::AppHandle, cancel: &Arc<AtomicBool>,
) -> Result<TileLayerManifest, String> {
    let layer_root = out_dir.join("tiles").join(dimension).join("local-difficulty");

    crate::tile_pyramid::run_tile_pyramid(app, cancel, "local-difficulty", dimension, range, |zoom, tx, ty| {
        let layer_root = layer_root.clone();
        let (world_dir, dimension) = (world_dir.to_string(), dimension.to_string());
        async move {
            let (min_cx, max_cx, min_cz, max_cz) = crate::tile_renderer::tile_chunk_bounds(tx, ty, zoom);
            let (world_dir_c, dim_c) = (world_dir.clone(), dimension.clone());
            let inhabited = tauri::async_runtime::spawn_blocking(move || {
                crate::region_reader::get_inhabited_times_from_mca(&world_dir_c, &dim_c, min_cx, min_cz, max_cx, max_cz)
            }).await.unwrap_or_default();
            let width = max_cx - min_cx + 1;
            if !inhabited.is_empty() && width > 0 {
                let (origin_x, origin_z, bpp) = crate::tile_renderer::tile_origin_blocks(tx, ty, zoom, PNG_TILE_PX as usize);
                let mut pixels = vec![0u8; PNG_TILE_PX as usize * PNG_TILE_PX as usize * 4];
                for py in 0..PNG_TILE_PX {
                    for px in 0..PNG_TILE_PX {
                        let bx = origin_x + (px as f64 + 0.5) * bpp;
                        let bz = origin_z + (py as f64 + 0.5) * bpp;
                        let ci = (bx / 16.0).floor() as i32 - min_cx;
                        let cj = (bz / 16.0).floor() as i32 - min_cz;
                        if ci < 0 || ci >= width || cj < 0 { continue; }
                        let idx = (cj * width + ci) as usize;
                        let Some(&t) = inhabited.get(idx) else { continue };
                        if t < 0 { continue; }
                        let (special, _) = crate::region_reader::compute_local_difficulty(game_difficulty, world_time, t);
                        let rgb = difficulty_color(special);
                        let off = (py * PNG_TILE_PX + px) as usize * 4;
                        pixels[off] = rgb[0]; pixels[off + 1] = rgb[1]; pixels[off + 2] = rgb[2];
                        pixels[off + 3] = if special == 0.0 { 80 } else { 180 };
                    }
                }
                blocking_io(move || write_raster_tile(&pixels, &layer_root, zoom, tx, ty)).await?;
            }
            Ok(())
        }
    }).await?;

    Ok(TileLayerManifest { path: format!("tiles/{dimension}/local-difficulty"), min_zoom: range.zoom_min, max_zoom: range.zoom_max, tile_size: range.tile_px })
}

/// Orchestrates a full static-site export: app shell, then per-dimension
/// tile pyramids and region-gridded data, then manifest.json — written once
/// up front and rewritten after every dimension (see write_manifest below).
pub async fn run_static_export(
    app:      tauri::AppHandle,
    sem:      tauri::State<'_, crate::TileRenderSemaphore>,
    db_cache: tauri::State<'_, crate::BedrockDbCache>,
    cancel_st: tauri::State<'_, StaticExportCancel>,
    params:   StaticExportParams,
) -> Result<(), String> {
    let cancel = cancel_st.fresh();
    let out_dir = std::path::PathBuf::from(&params.output_dir);
    let out_dir_c = out_dir.clone();
    blocking_io(move || std::fs::create_dir_all(&out_dir_c).map_err(|e| format!("Couldn't create export folder: {e}"))).await?;

    // Tile/data content lives under a seed-named subdirectory so a re-export
    // into an `out_dir` that once held a different world never serves stale
    // tiles just because they share a (dimension, layer, zoom, x, y) path.
    // manifest.json/index.html/assets stay at the top level.
    let seed_str = crate::cubiomes::seed_from_parts(params.seed_low, params.seed_high).to_string();
    let content_root = out_dir.join(&seed_str);
    let with_seed = |path: String| format!("{seed_str}/{path}");

    // Also clear same-seed re-exports: compositing deletes native tiles and
    // writes composites under different (divided) filenames, so a fresh
    // re-export's new natives would coexist with the old run's stale
    // composites and panic on a size mismatch when grouped together.
    let content_root_c = content_root.clone();
    blocking_io(move || {
        if content_root_c.exists() {
            std::fs::remove_dir_all(&content_root_c)
                .map_err(|e| format!("Couldn't clear previous export at {}: {e}", content_root_c.display()))?;
        }
        Ok::<(), String>(())
    }).await?;

    let _ = app.emit("static-export:progress", StaticExportProgress {
        stage: "site", dimension: None, done: 0, total: params.dimensions.len() as u32,
    });
    crate::static_site_assets::extract_into(&out_dir)?;

    // Manifest fields independent of per-dimension progress, built once so
    // manifest.json is a complete valid document from the first write.
    // Cloned rather than moved out of `params` — several fields are still
    // read directly from `params` further down in the per-dimension loop.
    let manifest_generator = GeneratorInfo { app: "sojourner", app_version: env!("CARGO_PKG_VERSION").to_string() };
    let manifest_world = WorldInfo {
        level_name:      params.level_name.clone(),
        seed:            crate::cubiomes::seed_from_parts(params.seed_low, params.seed_high).to_string(),
        mc_version:      params.mc_version,
        data_version:    params.data_version,
        version_name:    params.version_name.clone(),
        edition:         params.edition.clone(),
        world_type:      params.world_type.clone(),
        difficulty:      params.difficulty,
        border_center_x: params.border_center_x,
        border_center_z: params.border_center_z,
        border_size:     params.border_size,
        game_rules:      params.game_rules.clone(),
    };
    let manifest_tile_grid = TileGrid {
        base_blocks_per_pixel: BASE_BLOCKS_PER_PIXEL,
        tile_size: PNG_TILE_PX,
        min_zoom: MIN_ZOOM,
        max_zoom: MAX_ZOOM,
    };
    let manifest_default_settings = params.default_settings.clone();
    let manifest_marker_groups = params.marker_groups.clone();

    // manifest.json is ground truth for every consumer (viewer, a sync
    // running alongside this export), so it's never left half-written:
    // write via tmp-file-then-rename, and only ever reference dimensions
    // whose tiles/data are already fully on disk — a bundle synced
    // mid-export stays internally consistent even if incomplete.
    let write_manifest = |dimensions: &[DimensionManifest]| -> Result<(), String> {
        let manifest = ExportManifest {
            format_version: EXPORT_FORMAT_VERSION,
            generated_at: chrono_now_iso8601(),
            generator: manifest_generator.clone(),
            world: manifest_world.clone(),
            tile_grid: manifest_tile_grid,
            dimensions: dimensions.to_vec(),
            default_settings: manifest_default_settings.clone(),
            marker_groups: manifest_marker_groups.clone(),
        };
        let json = serde_json::to_vec_pretty(&manifest)
            .map_err(|e| format!("Couldn't serialize manifest: {e}"))?;
        let tmp_path = out_dir.join("manifest.json.tmp");
        std::fs::write(&tmp_path, json)
            .map_err(|e| format!("Couldn't write manifest.json: {e}"))?;
        std::fs::rename(&tmp_path, out_dir.join("manifest.json"))
            .map_err(|e| format!("Couldn't finalize manifest.json: {e}"))?;
        Ok(())
    };
    write_manifest(&[])?;

    if params.edition == "bedrock" {
        let _ = db_cache.get_or_open(&params.world_dir);
    }

    let total = params.dimensions.len() as u32;
    let mut dimensions = Vec::new();

    for (i, dimension) in params.dimensions.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            return Err("Export cancelled.".to_string());
        }

        let _ = app.emit("static-export:progress", StaticExportProgress {
            stage: "regions", dimension: Some(dimension), done: i as u32, total,
        });

        let Some((regions, bounds)) = dimension_regions_and_bounds(
            &params.world_dir, &params.edition, dimension, &db_cache,
        ) else { continue };
        // Seed-only layers don't need real chunk data, so their bounds are
        // the border-centered radius (capped at SEED_LAYER_MAX_RADIUS)
        // unioned with the real explored bounds — otherwise biome/ore-vein/
        // carver tiles go missing anywhere a player walked past that radius
        // on a world with no real border set, even though chunk tiles cover it fine.
        let seed_bounds = seed_layer_bounds(&params).union(bounds);

        // Repoints the exporter's dedicated generator slot per dimension —
        // safe since each dimension is processed to completion before the next.
        let dim_id = dimension_to_cubiomes_id(dimension);
        let (seed_low, seed_high, mc_version, world_flags) =
            (params.seed_low, params.seed_high, params.mc_version, params.world_flags);
        let slot = tauri::async_runtime::spawn_blocking(move || {
            crate::cubiomes::biomes::setup_generator_reserved(
                crate::cubiomes::seed_from_parts(seed_low, seed_high),
                mc_version, dim_id, world_flags,
            )
        }).await.map_err(|e| e.to_string())?;

        let mut tiles = TileLayers::default();
        let dim_cave_presets = params.cave_range_presets.get(dimension).cloned().unwrap_or_default();

        let biome_px = crate::tile_renderer::BIOME_TILE_SIZE as i32;
        let chunk_px = crate::tile_renderer::TILE_SIZE as i32;

        if params.include_biome_tiles {
            let mut m = export_biome_like_layer(
                &app, &content_root, "biome", dimension,
                slot, seed_low, seed_high, mc_version, world_flags,
                TileRange { bounds: seed_bounds, zoom_min: MIN_ZOOM, zoom_max: BIOME_NATIVE_MAX_ZOOM, tile_px: biome_px },
                false, &cancel,
            ).await?;
            m.path = with_seed(m.path);
            tiles.biome = Some(m);
        }
        // Overworld-only — render_underground_biome_tile returns nothing elsewhere.
        if params.include_underground_tiles && dimension == "overworld" {
            let mut m = export_biome_like_layer(
                &app, &content_root, "underground", dimension,
                slot, seed_low, seed_high, mc_version, world_flags,
                TileRange { bounds: seed_bounds, zoom_min: MIN_ZOOM, zoom_max: BIOME_NATIVE_MAX_ZOOM, tile_px: biome_px },
                true, &cancel,
            ).await?;
            m.path = with_seed(m.path);
            tiles.underground = Some(m);
        }
        if params.include_chunk_tiles {
            let mut m = export_chunk_layer(
                &app, sem.clone(), db_cache.clone(), &content_root, "chunk",
                &params.world_dir, &params.edition, dimension,
                TileRange { bounds, zoom_min: CHUNK_DATA_MIN_ZOOM, zoom_max: CHUNK_NATIVE_MAX_ZOOM, tile_px: chunk_px },
                false, None, 0, 0, &cancel,
            ).await?;
            m.path = with_seed(m.path);
            tiles.chunk = Some(m);
        }
        if params.include_chunk_hide_water_tiles {
            let mut m = export_chunk_layer(
                &app, sem.clone(), db_cache.clone(), &content_root, "chunk-hide-water",
                &params.world_dir, &params.edition, dimension,
                TileRange { bounds, zoom_min: CHUNK_DATA_MIN_ZOOM, zoom_max: CHUNK_NATIVE_MAX_ZOOM, tile_px: chunk_px },
                true, None, 0, 0, &cancel,
            ).await?;
            m.path = with_seed(m.path);
            tiles.chunk_hide_water = Some(m);
        }
        // Cave mode has no effect in the End.
        if !dim_cave_presets.is_empty() && dimension != "end" {
            let mut cave = HashMap::new();
            for preset in &dim_cave_presets {
                let layer_dir = format!("cave/{}", preset.id);
                let mut manifest = export_chunk_layer(
                    &app, sem.clone(), db_cache.clone(), &content_root, &layer_dir,
                    &params.world_dir, &params.edition, dimension,
                    TileRange { bounds, zoom_min: CAVE_MODE_MIN_ZOOM, zoom_max: CHUNK_NATIVE_MAX_ZOOM, tile_px: chunk_px },
                    false, Some(0), preset.low, preset.high, &cancel,
                ).await?;
                manifest.path = with_seed(manifest.path);
                cave.insert(preset.id.clone(), manifest);
            }
            tiles.cave = Some(cave);
        }

        // Overworld-only — vein fields aren't a thing in other dimensions.
        if params.include_ore_veins && dimension == "overworld" {
            let mut m = export_ore_veins_layer(
                &content_root, dimension, slot, seed_low, seed_high, dim_id, world_flags, mc_version,
                TileRange { bounds: seed_bounds, zoom_min: CAVE_MODE_MIN_ZOOM, zoom_max: CHUNK_NATIVE_MAX_ZOOM, tile_px: PNG_TILE_PX },
                &app, &cancel,
            ).await?;
            m.path = with_seed(m.path);
            tiles.ore_veins = Some(m);
        }
        // Carvers yield nothing in the End, same as the live app.
        if params.include_carvers && dimension != "end" {
            let mut m = export_carvers_layer(
                &content_root, dimension, slot, seed_low, seed_high, dim_id, world_flags, mc_version,
                TileRange { bounds: seed_bounds, zoom_min: CAVE_MODE_MIN_ZOOM, zoom_max: CHUNK_NATIVE_MAX_ZOOM, tile_px: PNG_TILE_PX },
                &app, &cancel,
            ).await?;
            m.path = with_seed(m.path);
            tiles.carvers = Some(m);
        }
        // Java .mca only, same as the live commands — Bedrock gets no data
        // here rather than wrong data. Real-region bounds, not seed_bounds:
        // nothing to show outside actual saved chunks either way.
        if params.include_local_difficulty && params.edition == "java" {
            let mut m = export_local_difficulty_layer(
                &content_root, &params.world_dir, dimension, params.difficulty, params.world_time,
                TileRange { bounds, zoom_min: CHUNK_DATA_MIN_ZOOM, zoom_max: CHUNK_NATIVE_MAX_ZOOM, tile_px: PNG_TILE_PX },
                &app, &cancel,
            ).await?;
            m.path = with_seed(m.path);
            tiles.local_difficulty = Some(m);
        }

        let mut data = DataLayers::default();

        {
            let world_dir = params.world_dir.clone();
            let edition = params.edition.clone();
            let dim = dimension.clone();
            let mut m = export_region_gridded(&content_root, dimension, "poi", "poi", &regions,
                |min_cx, min_cz, max_cx, max_cz| crate::poi_reader::get_poi_cmd(
                    world_dir.clone(), edition.clone(), dim.clone(), min_cx, min_cz, max_cx, max_cz, db_cache.clone(),
                ),
            ).await?;
            m.path = with_seed(m.path);
            data.poi = Some(m);
        }
        {
            let world_dir = params.world_dir.clone();
            let edition = params.edition.clone();
            let dim = dimension.clone();
            let mut m = export_region_gridded(&content_root, dimension, "block-entities", "block-entities", &regions,
                |min_cx, min_cz, max_cx, max_cz| crate::block_entity_reader::get_block_entities_cmd(
                    world_dir.clone(), edition.clone(), dim.clone(), min_cx, min_cz, max_cx, max_cz, db_cache.clone(),
                ),
            ).await?;
            m.path = with_seed(m.path);
            data.block_entities = Some(m);
        }
        {
            let world_dir = params.world_dir.clone();
            let edition = params.edition.clone();
            let dim = dimension.clone();
            let mut m = export_region_gridded(&content_root, dimension, "entities", "entities", &regions,
                |min_cx, min_cz, max_cx, max_cz| crate::entity_reader::get_entities_cmd(
                    world_dir.clone(), edition.clone(), dim.clone(), min_cx, min_cz, max_cx, max_cz, db_cache.clone(),
                ),
            ).await?;
            m.path = with_seed(m.path);
            data.entities = Some(m);
        }

        let mut structures_manifest = export_structures_layer(
            &app, &content_root, dimension, dim_id,
            slot, seed_low, seed_high, mc_version, world_flags,
            seed_bounds, &params.roll_loot_for, &cancel,
        ).await?;
        structures_manifest.path = with_seed(structures_manifest.path);
        data.structures = Some(structures_manifest);

        if dimension == "end" {
            let links = crate::cubiomes::structures::cubiomes_get_end_gateway_links(
                slot, seed_low, seed_high, dim_id, world_flags, mc_version,
            ).await;
            if !links.is_empty() {
                let export_links: Vec<ExportGatewayLink> = links.into_iter()
                    .map(|l| ExportGatewayLink { src_x: l.src_x, src_z: l.src_z, dst_x: l.dst_x, dst_z: l.dst_z })
                    .collect();
                let rel_path = format!("data/{dimension}/gateway-links.json");
                let dir = content_root.join("data").join(dimension);
                let json = serde_json::to_vec(&export_links).map_err(|e| format!("Couldn't serialize gateway links: {e}"))?;
                let dst = content_root.join(&rel_path);
                blocking_io(move || {
                    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create {}: {e}", dir.display()))?;
                    std::fs::write(&dst, json).map_err(|e| format!("Couldn't write gateway-links.json: {e}"))
                }).await?;
                data.gateway_links = Some(with_seed(rel_path));
            }
        }

        if dimension == "overworld" {
            let spawn = crate::cubiomes::biomes::cubiomes_get_spawn(
                slot, seed_low, seed_high, dim_id, world_flags, mc_version,
            ).await;
            if let Some([x, z]) = spawn {
                let rel_path = format!("data/{dimension}/spawn.json");
                let dir = content_root.join("data").join(dimension);
                let json = serde_json::to_vec(&serde_json::json!({ "x": x, "z": z }))
                    .map_err(|e| format!("Couldn't serialize spawn: {e}"))?;
                let dst = content_root.join(&rel_path);
                blocking_io(move || {
                    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create {}: {e}", dir.display()))?;
                    std::fs::write(&dst, json).map_err(|e| format!("Couldn't write spawn.json: {e}"))
                }).await?;
                data.spawn = Some(with_seed(rel_path));
            }
        }

        // Sorted for a deterministic manifest.json across re-exports (directory read order isn't guaranteed).
        let mut regions = regions.clone();
        regions.sort_unstable();

        dimensions.push(DimensionManifest {
            dimension: dimension.clone(),
            bounds,
            regions,
            cave_range_presets: dim_cave_presets,
            tiles,
            data,
        });
        // Rewritten now that this dimension's tiles/data are fully on disk (see write_manifest above).
        write_manifest(&dimensions)?;
    }

    if cancel.load(Ordering::Relaxed) {
        return Err("Export cancelled.".to_string());
    }

    // Export-only; never touches the live app's tile cache (different directory).
    // Not scaled per zoom level: Leaflet's GridLayer takes one `tileSize` per
    // layer across all its zooms, so a per-zoom size would need frontend changes.
    const COMPOSITE_TARGET_PX: i32 = 512;
    let out_dir_for_composite = out_dir.clone();
    let _ = app.emit("static-export:progress", StaticExportProgress {
        stage: "compositing", dimension: None, done: 0, total: 1,
    });
    let dimensions = blocking_io(move || {
        for dim in dimensions.iter_mut() {
            let composite = |m: &mut TileLayerManifest| -> Result<(), String> {
                let layer_dir = out_dir_for_composite.join(&m.path);
                m.tile_size = composite_tile_layer(&layer_dir, COMPOSITE_TARGET_PX)?;
                Ok(())
            };
            if let Some(m) = dim.tiles.biome.as_mut() { composite(m)?; }
            if let Some(m) = dim.tiles.underground.as_mut() { composite(m)?; }
            if let Some(m) = dim.tiles.chunk.as_mut() { composite(m)?; }
            if let Some(m) = dim.tiles.chunk_hide_water.as_mut() { composite(m)?; }
            if let Some(cave) = dim.tiles.cave.as_mut() {
                for m in cave.values_mut() { composite(m)?; }
            }
            if let Some(m) = dim.tiles.ore_veins.as_mut() { composite(m)?; }
            if let Some(m) = dim.tiles.carvers.as_mut() { composite(m)?; }
            if let Some(m) = dim.tiles.local_difficulty.as_mut() { composite(m)?; }
        }
        Ok(dimensions)
    }).await?;
    write_manifest(&dimensions)?;

    let meta = ExportMeta {
        format_version: EXPORT_FORMAT_VERSION,
        generated_at: chrono_now_iso8601(),
        level_name: params.level_name.clone(),
        version_name: params.version_name.clone(),
        edition: params.edition.clone(),
        dimensions: dimensions.iter().map(|d| d.dimension.clone()).collect(),
        regions: dimensions.iter().map(|d| d.regions.len()).sum(),
        layers: ExportMetaLayers {
            biome: params.include_biome_tiles,
            underground: params.include_underground_tiles,
            chunk: params.include_chunk_tiles,
            chunk_hide_water: params.include_chunk_hide_water_tiles,
            cave: params.cave_range_presets.values().any(|v| !v.is_empty()),
            ore_veins: params.include_ore_veins,
            carvers: params.include_carvers,
            local_difficulty: params.include_local_difficulty,
        },
    };
    let meta_json = serde_json::to_vec_pretty(&meta)
        .map_err(|e| format!("Couldn't serialize meta.json: {e}"))?;
    let meta_tmp = out_dir.join("meta.json.tmp");
    std::fs::write(&meta_tmp, meta_json)
        .map_err(|e| format!("Couldn't write meta.json: {e}"))?;
    std::fs::rename(&meta_tmp, out_dir.join("meta.json"))
        .map_err(|e| format!("Couldn't finalize meta.json: {e}"))?;

    let _ = app.emit("static-export:done", ());
    Ok(())
}

#[tauri::command]
pub async fn export_static_site(
    app:      tauri::AppHandle,
    sem:      tauri::State<'_, crate::TileRenderSemaphore>,
    db_cache: tauri::State<'_, crate::BedrockDbCache>,
    cancel:   tauri::State<'_, StaticExportCancel>,
    params:   StaticExportParams,
) -> Result<(), String> {
    let result = run_static_export(app.clone(), sem, db_cache, cancel, params).await;
    if let Err(ref msg) = result {
        let _ = app.emit("static-export:error", msg.clone());
    }
    result
}

/// Minimal RFC3339 UTC timestamp — avoids pulling in `chrono` for one field.
/// Hand-rolls the Gregorian conversion (Howard Hinnant's civil_from_days) since SystemTime gives no calendar math.
fn chrono_now_iso8601() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs() as i64;
    let days = secs.div_euclid(86400);
    let rem  = secs.rem_euclid(86400);
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);

    // civil_from_days: days since 1970-01-01 -> (year, month, day)
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m_ = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m_ <= 2 { y + 1 } else { y };

    format!("{y:04}-{m_:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}
