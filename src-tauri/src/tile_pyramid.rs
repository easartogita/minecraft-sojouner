//! Shared "grunt work" for tile-shaped rendering, used by both the live tile
//! renderer (`tile_renderer.rs`) and the static-site export pipeline
//! (`static_export.rs`): the vanilla-Minecraft-map hillshade formula, and the
//! zoom/tx/ty iteration skeleton every static-export tile-pyramid layer repeats.

use serde::Serialize;
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Emitter;

/// Vanilla Minecraft in-game map shading: a block's brightness is one of
/// exactly 3 fixed multipliers, chosen by comparing its height only to the
/// block one row north (not west, not by absolute altitude) — see
/// https://minecraft.wiki/w/Map_item_format. Lower than north → 180/255;
/// equal → 220/255; higher → 255/255. (A 4th multiplier, 135/255, exists in
/// vanilla's color table but is only ever used for water-depth banding, which
/// this renderer doesn't do — not reproduced here.)
pub fn mojang_shade(here: f64, north: f64) -> f64 {
    if here < north { 180.0 / 255.0 }
    else if here > north { 255.0 / 255.0 }
    else { 220.0 / 255.0 }
}

// ── Tile-pyramid iteration ──────────────────────────────────────────────────
// Every static-export tile layer (biome, chunk, ore-veins, carvers,
// local-difficulty) does the same zoom/ty/tx walk with cancellation checks
// and a throttled progress event; only the per-tile body differs.

/// How often (in tiles) to emit a progress event within one layer/zoom pass —
/// per-tile would flood the frontend on a big export.
const PROGRESS_TILE_STRIDE: u32 = 64;

#[derive(Serialize, Clone)]
struct StaticExportProgress<'a> {
    stage: &'a str,
    dimension: Option<&'a str>,
    done: u32,
    total: u32,
}

/// Block-space box + zoom range + PNG pixel size a tile-pyramid layer covers.
/// Shared between the export pyramid runner and the frontend manifest shape
/// it produces (`TileLayerManifest`), so it lives here rather than in
/// `static_export.rs` alone.
#[derive(Clone, Copy)]
pub struct TileRange {
    pub bounds: crate::static_export::Bounds,
    pub zoom_min: i32,
    pub zoom_max: i32,
    pub tile_px: i32,
}

impl TileRange {
    pub fn xy_at(&self, zoom: i32) -> (i32, i32, i32, i32) {
        let blocks_per_tile = self.tile_px as f64 * crate::tile_renderer::blocks_per_pixel_at(zoom);
        let tx0 = (self.bounds.min_block_x as f64 / blocks_per_tile).floor() as i32;
        let tx1 = (self.bounds.max_block_x as f64 / blocks_per_tile).floor() as i32;
        let ty0 = (self.bounds.min_block_z as f64 / blocks_per_tile).floor() as i32;
        let ty1 = (self.bounds.max_block_z as f64 / blocks_per_tile).floor() as i32;
        (tx0, tx1, ty0, ty1)
    }

    pub fn total_tiles(&self) -> u32 {
        (self.zoom_min..=self.zoom_max)
            .map(|zoom| {
                let (tx0, tx1, ty0, ty1) = self.xy_at(zoom);
                (tx1 - tx0 + 1).max(0) as u32 * (ty1 - ty0 + 1).max(0) as u32
            })
            .sum()
    }
}

/// Walks every (zoom, tx, ty) in `range`, calling `render_tile` for each —
/// which does its own I/O (write/copy) and returns `Ok(())` whether or not it
/// produced a tile (an empty tile is not an error). Handles cancellation and
/// the throttled `static-export:progress` emit; the caller builds its own
/// `TileLayerManifest` afterward since the `path` string differs per layer.
pub async fn run_tile_pyramid<F, Fut>(
    app: &tauri::AppHandle,
    cancel: &Arc<AtomicBool>,
    stage: &str,
    dimension: &str,
    range: TileRange,
    mut render_tile: F,
) -> Result<(), String>
where
    F: FnMut(i32, i32, i32) -> Fut,
    Fut: Future<Output = Result<(), String>>,
{
    let mut done = 0u32;
    let total = range.total_tiles();

    for zoom in range.zoom_min..=range.zoom_max {
        let (tx0, tx1, ty0, ty1) = range.xy_at(zoom);
        for ty in ty0..=ty1 {
            for tx in tx0..=tx1 {
                if cancel.load(Ordering::Relaxed) {
                    return Err("Export cancelled.".to_string());
                }
                render_tile(zoom, tx, ty).await?;
                done += 1;
                if done % PROGRESS_TILE_STRIDE == 0 {
                    let _ = app.emit("static-export:progress", StaticExportProgress {
                        stage, dimension: Some(dimension), done, total,
                    });
                }
            }
        }
    }

    Ok(())
}
