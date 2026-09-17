//! Real block-color top-down thumbnails for the structure-copy source-selection
//! step (box, template, chunk-selection) — these look straight down through
//! just the selected box/chunks' own blocks, not the world's real surface, so
//! they're independent of `tile_renderer.rs`'s cache (which always resolves to
//! real terrain height). `block_colors.rs` supplies the shared per-block color
//! lookup both this and the live tile renderer use.
//!
//! Region-mode has no analogous preview: it copies whole `.mca` files at
//! identical coordinates, so there's no placement step for a thumbnail to
//! support (see `StructureCopyFlyout.tsx`'s stepper).

use super::blocks::{extract_box, BlockMap};
use super::rotation::Dims;
use crate::block_colors::block_name_to_rgb;
use crate::region_reader::{self, ChunkRequest};
use base64::Engine;
use fastnbt::Value;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewImage {
    /// True footprint in blocks — the ghost overlay is sized to this, not to
    /// the (possibly downsampled) pixel dimensions of `data_url`.
    pub width_blocks: i32,
    pub depth_blocks: i32,
    /// `data:image/png;base64,...` — ready for an `<img src>`/canvas `drawImage`.
    pub data_url: String,
}

/// Above this many blocks on the long axis, point-sample on a coarser grid
/// rather than rendering one pixel per block — keeps a huge selection's
/// preview cheap; it's a thumbnail; a stray sampled pixel or two doesn't matter.
const MAX_PREVIEW_AXIS: i32 = 256;

fn png_data_url(px_w: usize, px_h: usize, rgba: &[u8]) -> Result<String, String> {
    let mut buf = Vec::new();
    {
        let mut encoder = png::Encoder::new(std::io::Cursor::new(&mut buf), px_w as u32, px_h as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_compression(png::Compression::Fast);
        let mut writer = encoder.write_header().map_err(|e| format!("Couldn't write preview PNG header: {e}"))?;
        writer.write_image_data(rgba).map_err(|e| format!("Couldn't write preview PNG data: {e}"))?;
    }
    Ok(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(&buf)))
}

/// `(bare block name, real world Y)` of the topmost non-air block in `blocks`
/// at local column `(lx, lz)` — `world_y0` is the box/template's own Y origin,
/// only used to recover a real-ish Y for water's depth-shading in
/// `block_name_to_rgb`; solid blocks' colors don't depend on it.
fn topmost(blocks: &BlockMap, dims: Dims, lx: i32, lz: i32, world_y0: i32) -> Option<[u8; 3]> {
    for ly in (0..dims.height).rev() {
        let Some(Value::Compound(m)) = blocks.get(&(lx, ly, lz)) else { continue };
        let Some(Value::String(name)) = m.get("id") else { continue };
        let base = name.strip_prefix("minecraft:").unwrap_or(name);
        if matches!(base, "air" | "cave_air" | "void_air") { continue }
        return Some(block_name_to_rgb(base, world_y0 + ly));
    }
    None
}

/// Renders `(width, depth)` blocks worth of `blocks` (already box/template-
/// local, `y0` only feeding water depth-shading) into a preview PNG,
/// downsampling by point-sampling if either axis exceeds `MAX_PREVIEW_AXIS`.
fn render_blockmap(dims: Dims, blocks: &BlockMap, y0: i32) -> Result<PreviewImage, String> {
    let scale = ((dims.width.max(dims.depth) as f64) / MAX_PREVIEW_AXIS as f64).ceil().max(1.0) as i32;
    let px_w = ((dims.width + scale - 1) / scale).max(1) as usize;
    let px_h = ((dims.depth + scale - 1) / scale).max(1) as usize;

    let mut rgba = vec![0u8; px_w * px_h * 4];
    for pz in 0..px_h {
        for px in 0..px_w {
            let lx = (px as i32 * scale).min(dims.width - 1);
            let lz = (pz as i32 * scale).min(dims.depth - 1);
            let i = (pz * px_w + px) * 4;
            if let Some([r, g, b]) = topmost(blocks, dims, lx, lz, y0) {
                rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
            } // else stays fully transparent — an ungenerated/air column
        }
    }

    let data_url = png_data_url(px_w, px_h, &rgba)?;
    Ok(PreviewImage { width_blocks: dims.width, depth_blocks: dims.depth, data_url })
}

/// Preview for Box mode's finalized source selection — reuses `extract_box`,
/// the exact same read `copy_blocks` itself starts from, so the preview can
/// never disagree with what a copy would actually read.
#[tauri::command]
pub fn preview_box_selection(
    src_level_dat_path: String,
    src_dimension: String,
    src_box: (i32, i32, i32, i32, i32, i32),
) -> super::Result<PreviewImage> {
    let src_world_dir = super::world_dir_of(&src_level_dat_path)?.to_string_lossy().to_string();
    let data_version = crate::nbt_reader::read_level_dat(&src_level_dat_path)?.data_version;
    let (dims, blocks, _block_entities, _source_air_assumed) =
        extract_box(&src_world_dir, &src_dimension, src_box, data_version)?;
    let y0 = src_box.1.min(src_box.4);
    render_blockmap(dims, &blocks, y0)
}

/// Preview for a loaded `.nbt` template — no destination/version context
/// needed yet (that's only checked at paste time), just the file itself.
#[tauri::command]
pub fn preview_template(template_path: String) -> super::Result<PreviewImage> {
    let root = super::templates::read_template_nbt(&template_path)?;
    let (dims, blocks, _block_entities) = super::templates::parse_structure_nbt(&root)?;
    render_blockmap(dims, &blocks, 0)
}

/// Preview for Chunk mode's selection — stitches already-existing per-chunk
/// top-down color buffers (the same ones the live tile renderer uses, via
/// `read_chunk_colors_from_mca`) into one image sized to the selection's
/// bounding box, leaving gaps transparent for chunks an L-shaped
/// multi-selection doesn't actually include.
#[tauri::command]
pub fn preview_chunk_selection(
    world_dir: String,
    dimension: String,
    chunks: Vec<(i32, i32)>,
) -> super::Result<PreviewImage> {
    if chunks.is_empty() {
        return Err("No chunks selected".to_string());
    }
    let min_cx = chunks.iter().map(|c| c.0).min().unwrap();
    let max_cx = chunks.iter().map(|c| c.0).max().unwrap();
    let min_cz = chunks.iter().map(|c| c.1).min().unwrap();
    let max_cz = chunks.iter().map(|c| c.1).max().unwrap();
    let selected: std::collections::HashSet<(i32, i32)> = chunks.iter().copied().collect();

    let requests: Vec<ChunkRequest> = chunks.iter().map(|&(cx, cz)| ChunkRequest { cx, cz }).collect();
    let results = region_reader::read_chunk_colors_from_mca(&world_dir, &dimension, &requests, false, None, 0, 0);
    let color_by_chunk: std::collections::HashMap<(i32, i32), Vec<u8>> = results.into_iter()
        .filter_map(|r| r.colors.map(|c| ((r.cx, r.cz), c)))
        .collect();

    let width_chunks = (max_cx - min_cx + 1) as usize;
    let depth_chunks = (max_cz - min_cz + 1) as usize;
    let px_w = width_chunks * 16;
    let px_h = depth_chunks * 16;
    let mut rgba = vec![0u8; px_w * px_h * 4];

    for &(cx, cz) in &selected {
        let Some(colors) = color_by_chunk.get(&(cx, cz)) else { continue };
        let ox = (cx - min_cx) as usize * 16;
        let oz = (cz - min_cz) as usize * 16;
        for lz in 0..16usize {
            for lx in 0..16usize {
                let src_i = (lz * 16 + lx) * 4;
                if colors[src_i + 3] == 0 { continue } // alpha here encodes height; 0 = no data
                let dst_i = ((oz + lz) * px_w + (ox + lx)) * 4;
                rgba[dst_i] = colors[src_i];
                rgba[dst_i + 1] = colors[src_i + 1];
                rgba[dst_i + 2] = colors[src_i + 2];
                rgba[dst_i + 3] = 255;
            }
        }
    }

    let data_url = png_data_url(px_w, px_h, &rgba)?;
    Ok(PreviewImage {
        width_blocks: (px_w) as i32,
        depth_blocks: (px_h) as i32,
        data_url,
    })
}
