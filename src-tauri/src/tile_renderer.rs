use crate::region_reader::{ChunkRequest, ChunkResult};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Emitter;

pub(crate) const TILE_SIZE:         usize = 128;
pub(crate) const BIOME_TILE_SIZE:   usize = 128;
pub(crate) const BASE_BLOCKS_PER_PIXEL: f64 = 16.0;
const CHUNK:             usize = 16;
// Bump on any change to render output so stale cached tiles get dropped, not served.
pub const CACHE_VERSION: u32   = 13;

// Env-gated (SOJOURNER_TILE_TRACE=1) so it's silent in normal runs. See bugs-resolved.md.
pub fn tile_trace() -> bool {
    use std::sync::OnceLock;
    static ON: OnceLock<bool> = OnceLock::new();
    *ON.get_or_init(|| std::env::var("SOJOURNER_TILE_TRACE").is_ok())
}

/// Appends one timestamped line to /tmp/sojourner-tile-trace.log, truncated once
/// per process launch. No-op unless SOJOURNER_TILE_TRACE is set.
pub fn trace_log(msg: &str) {
    if !tile_trace() { return; }
    use std::io::Write;
    use std::sync::{Mutex, OnceLock};
    static FILE: OnceLock<Option<Mutex<std::fs::File>>> = OnceLock::new();
    let slot = FILE.get_or_init(|| {
        std::fs::OpenOptions::new()
            .create(true).write(true).truncate(true)
            .open("/tmp/sojourner-tile-trace.log")
            .ok()
            .map(Mutex::new)
    });
    let Some(m) = slot else { return };
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    if let Ok(mut f) = m.lock() {
        let _ = writeln!(f, "{ms} {msg}");
    }
}

fn world_hash(world_dir: &str) -> String {
    // FNV-1a 64-bit — stable across Rust versions, no extra dependencies
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in world_dir.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{:012x}", h & 0xFFFF_FFFF_FFFF)
}

fn tile_path(
    cache_root: &Path,
    world_dir:  &str,
    dim:        &str,
    hw:         bool,
    zoom:       i32,
    tx:         i32,
    ty:         i32,
    cave_y:     Option<i32>,
    cave_scan_low:  i32,
    cave_scan_high: i32,
) -> PathBuf {
    let cave_tag = match cave_y {
        Some(y) => format!("_c{y}_l{cave_scan_low}_h{cave_scan_high}"),
        None    => String::new(),
    };
    cache_root
        .join(world_hash(world_dir))
        .join(format!("{dim}_hw{}{cave_tag}", if hw { 1 } else { 0 }))
        .join(zoom.to_string())
        .join(format!("{tx}_{ty}.png"))
}

pub fn delete_tile_cache(cache_root: &Path, world_dir: &str) {
    let dir = cache_root.join(world_hash(world_dir));
    let _ = std::fs::remove_dir_all(dir);
}

pub fn clear_biome_tile_cache(cache_root: &Path, seed_low: i32, seed_high: i32) {
    let seed = ((seed_high as i64) << 32) | (seed_low as u32 as i64);
    let seed_hex = format!("{:016x}", seed as u64);
    let _ = std::fs::remove_dir_all(cache_root.join("biome").join(&seed_hex));
    let _ = std::fs::remove_dir_all(cache_root.join("underground").join(&seed_hex));
}

/// Deletes only the cached PNG tiles overlapping the given .mca regions (each
/// covering a 512×512 block area) — cheaper than nuking the whole cache dir.
pub fn invalidate_mca_tiles(
    cache_root: &Path,
    world_dir:  &str,
    regions:    &[(i32, i32)],  // (rx, rz) pairs parsed from changed .mca filenames
) {
    let world_root = cache_root.join(world_hash(world_dir));
    if !world_root.exists() { return; }

    // dim+hw variant dirs, e.g. "overworld_hw0", "overworld_hw1_c64_l-8_h8"
    let dim_dirs = match std::fs::read_dir(&world_root) {
        Ok(d) => d,
        Err(_) => return,
    };

    for dim_entry in dim_dirs.flatten() {
        let dim_path = dim_entry.path();
        if !dim_path.is_dir() { continue; }

        let zoom_dirs = match std::fs::read_dir(&dim_path) {
            Ok(d) => d,
            Err(_) => continue,
        };

        for zoom_entry in zoom_dirs.flatten() {
            let zoom_path = zoom_entry.path();
            if !zoom_path.is_dir() { continue; }
            let zoom: i32 = match zoom_path
                .file_name()
                .and_then(|n| n.to_str())
                .and_then(|s| s.parse().ok())
            {
                Some(z) => z,
                None    => continue,
            };

            let tile_blocks = (TILE_SIZE as f64 * blocks_per_pixel_at(zoom)) as i32;
            if tile_blocks <= 0 { continue; }

            for &(rx, rz) in regions {
                let mca_block_x0 = rx * 512;
                let mca_block_z0 = rz * 512;

                // Tile range that overlaps this 512×512 mca region
                let (tx0, tx1) = cell_range(mca_block_x0, mca_block_x0 + 511, tile_blocks);
                let (ty0, ty1) = cell_range(mca_block_z0, mca_block_z0 + 511, tile_blocks);

                for tx in tx0..=tx1 {
                    for ty in ty0..=ty1 {
                        let file = zoom_path.join(format!("{tx}_{ty}.png"));
                        let removed = std::fs::remove_file(&file).is_ok();
                        if removed {
                            trace_log(&format!("invalidate del z={} tile={},{} (region {},{})", zoom, tx, ty, rx, rz));
                        }
                    }
                }
            }
        }
    }
}

/// Mirrors MC_VERSION_LABELS in constants.ts — keep in sync when a version is added there.
fn mc_version_label(mc_version: i32) -> &'static str {
    match mc_version {
        35 => "26.3",
        34 => "26.2",
        33 => "26.0-26.1",
        28 => "1.21.5",
        27 => "1.21.2-1.21.4",
        26 => "1.21-1.21.1",
        25 => "1.20",
        24 => "1.19",
        22 => "1.18",
        21 => "1.17",
        20 => "1.16",
        _  => "unknown",
    }
}

/// Biome tiles have no backing save file, so the generator identity
/// (seed/version/flags/dimension/y-level) + block origin stand in for a
/// region filename — enough to regenerate this exact tile again.
fn encode_biome_tile_png(
    pixels:       &[u8],
    size:         u32,
    seed_low:     i32,
    seed_high:    i32,
    mc_version:   i32,
    world_flags:  i32,
    dimension:    &str,
    sample_y:     i32,
    block_origin: (i32, i32),
) -> Vec<u8> {
    let mut buf = Vec::new();
    {
        let mut encoder = png::Encoder::new(std::io::Cursor::new(&mut buf), size, size);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_compression(png::Compression::Fast);
        let rendered_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let _ = encoder.add_text_chunk("rendered-at".to_string(), rendered_at.to_string());
        let seed = ((seed_high as i64) << 32) | (seed_low as u32 as i64);
        let _ = encoder.add_text_chunk("seed".to_string(), seed.to_string());
        let _ = encoder.add_text_chunk("mc-version".to_string(), mc_version_label(mc_version).to_string());
        let _ = encoder.add_text_chunk("mc-version-id".to_string(), mc_version.to_string());
        let _ = encoder.add_text_chunk("world-flags".to_string(), world_flags.to_string());
        let _ = encoder.add_text_chunk("dimension".to_string(), dimension.to_string());
        // Biome-space Y (block_y / 4); fixed per dimension, see render_biome_tile.
        let _ = encoder.add_text_chunk("sample-y".to_string(), sample_y.to_string());
        let (block_x, block_z) = block_origin;
        let _ = encoder.add_text_chunk("block-origin".to_string(), format!("{block_x},{block_z}"));
        let mut writer = encoder.write_header().expect("png header");
        writer.write_image_data(pixels).expect("png data");
    }
    buf
}


/// Embeds the source .mca max-mtime as a tEXt chunk — load-bearing, `fresh_tile_mtime`
/// reads it back for cache invalidation, don't rename/remove it — plus provenance chunks.
fn encode_tile_png(
    pixels:       &[u8],
    mca_mtime:    u64,
    regions:      &str,
    chunk_bounds: (i32, i32, i32, i32),
    block_origin: (i32, i32),
) -> Vec<u8> {
    let mut buf = Vec::new();
    {
        let mut encoder = png::Encoder::new(std::io::Cursor::new(&mut buf), TILE_SIZE as u32, TILE_SIZE as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_compression(png::Compression::Fast);
        let _ = encoder.add_text_chunk("mca-mtime".to_string(), mca_mtime.to_string());
        let rendered_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let _ = encoder.add_text_chunk("rendered-at".to_string(), rendered_at.to_string());
        let _ = encoder.add_text_chunk("regions".to_string(), regions.to_string());
        let (min_cx, max_cx, min_cz, max_cz) = chunk_bounds;
        let _ = encoder.add_text_chunk("chunk-bounds".to_string(), format!("{min_cx},{max_cx},{min_cz},{max_cz}"));
        let (block_x, block_z) = block_origin;
        let _ = encoder.add_text_chunk("block-origin".to_string(), format!("{block_x},{block_z}"));
        let mut writer = encoder.write_header().expect("png header");
        writer.write_image_data(pixels).expect("png data");
    }
    buf
}

/// Max mtime (seconds since Unix epoch) across all .mca files that contribute to a
/// tile. Returns 0 when no region files are found (unvisited or deleted).
pub fn max_mca_mtime(world_dir: &str, dimension: &str, min_cx: i32, max_cx: i32, min_cz: i32, max_cz: i32) -> u64 {
    let regions: std::collections::HashSet<(i32, i32)> = (min_cx..=max_cx)
        .flat_map(|cx| (min_cz..=max_cz).map(move |cz| (cx.div_euclid(32), cz.div_euclid(32))))
        .collect();
    regions.iter()
        .filter_map(|&(rx, rz)| crate::region_reader::find_region_file(world_dir, dimension, rx, rz))
        .filter_map(|p| std::fs::metadata(&p).ok())
        .filter_map(|m| m.modified().ok())
        .filter_map(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .max()
        .unwrap_or(0)
}

/// Blocks-per-pixel scale at `zoom` — halves every zoom level, matching the
/// frontend's `BASE_BLOCKS_PER_PIXEL / 2^zoom` (constants.ts).
pub(crate) fn blocks_per_pixel_at(zoom: i32) -> f64 {
    BASE_BLOCKS_PER_PIXEL / 2f64.powi(zoom)
}

/// Block-space origin (top-left, unfloored) of a tile, plus bpp at that zoom.
/// Shared by every (tile, zoom) -> block space mapping, including static_export.rs.
pub(crate) fn tile_origin_blocks(tile_x: i32, tile_y: i32, zoom: i32, tile_px: usize) -> (f64, f64, f64) {
    let bpp = blocks_per_pixel_at(zoom);
    (tile_x as f64 * tile_px as f64 * bpp, tile_y as f64 * tile_px as f64 * bpp, bpp)
}

/// Inclusive index range of `cell_blocks`-wide grid cells overlapping `[block0, block1]`.
/// The one conversion primitive every region↔tile↔chunk mapping in this module goes
/// through, so they can't drift out of sync with each other (see BUGS.md).
fn cell_range(block0: i32, block1: i32, cell_blocks: i32) -> (i32, i32) {
    (block0.div_euclid(cell_blocks), block1.div_euclid(cell_blocks))
}

/// Chunk-coordinate span covered by a tile. Shared by the renderer and the
/// standalone mtime probe so both agree on which region files feed a tile.
pub fn tile_chunk_bounds(tile_x: i32, tile_y: i32, zoom: i32) -> (i32, i32, i32, i32) {
    let (block_x_f, block_z_f, blocks_per_pixel) = tile_origin_blocks(tile_x, tile_y, zoom, TILE_SIZE);
    let block_x0 = block_x_f.floor() as i32;
    let block_z0 = block_z_f.floor() as i32;
    let block_x1 = (block_x_f + TILE_SIZE as f64 * blocks_per_pixel - 1.0) as i32;
    let block_z1 = (block_z_f + TILE_SIZE as f64 * blocks_per_pixel - 1.0) as i32;
    let (min_cx, max_cx) = cell_range(block_x0, block_x1, CHUNK as i32);
    let (min_cz, max_cz) = cell_range(block_z0, block_z1, CHUNK as i32);
    (min_cx, max_cx, min_cz, max_cz)
}

/// Closure-based freshness check, shared by Java and Bedrock paths.
/// Returns the tile's stored mca-mtime when it is still fresh, else None.
fn fresh_tile_mtime(
    png_data: &[u8],
    min_cx: i32, max_cx: i32,
    min_cz: i32, max_cz: i32,
    mtime_fn: &dyn Fn(i32, i32, i32, i32) -> u64,
) -> Option<u64> {
    let decoder = png::Decoder::new(std::io::Cursor::new(png_data));
    let reader = decoder.read_info().ok()?;
    let stored: u64 = reader.info()
        .uncompressed_latin1_text
        .iter()
        .find(|t| t.keyword == "mca-mtime")
        .and_then(|t| t.text.parse().ok())
        .unwrap_or(0);
    if stored == 0 { return None; }
    let current = mtime_fn(min_cx, max_cx, min_cz, max_cz);
    (current > 0 && current <= stored).then_some(stored)
}

// ── Tile renderer ─────────────────────────────────────────────────────────────

/// Render a 128×128 tile from .mca chunk data, writing it to disk cache and returning the path.
/// Returns None when no chunks in this tile have data or the cache write fails.
pub fn get_or_render_tile(
    cache_root:     &Path,
    world_dir:      &str,
    dimension:      &str,
    tile_x:         i32,
    tile_y:         i32,
    zoom:           i32,
    hide_water:     bool,
    cave_y:         Option<i32>,
    cave_scan_low:  i32,
    cave_scan_high: i32,
    // Skip the disk-cache short-circuit and force a fresh read+render. Set by
    // the torn-tile retry loop in `render_tile` (lib.rs) — otherwise a retry
    // would just hand back the same bad PNG the torn attempt already cached.
    force_fresh: bool,
    // (min_cx, max_cx, min_cz, max_cz) -> mtime_secs, for freshness checking.
    mtime_fn: impl Fn(i32, i32, i32, i32) -> u64,
    chunk_colors_fn: impl Fn(&[ChunkRequest]) -> Vec<ChunkResult>,
) -> Option<(String, u64, bool)> {
    let p = tile_path(
        cache_root, world_dir, dimension, hide_water,
        zoom, tile_x, tile_y, cave_y, cave_scan_low, cave_scan_high,
    );

    let (block_x_f, block_z_f, blocks_per_pixel) = tile_origin_blocks(tile_x, tile_y, zoom, TILE_SIZE);
    let block_x = block_x_f.floor() as i32;
    let block_z = block_z_f.floor() as i32;
    let (min_cx, max_cx, min_cz, max_cz) = tile_chunk_bounds(tile_x, tile_y, zoom);

    // Skipped on a torn-tile retry (force_fresh) — see that parameter's doc.
    if !force_fresh { if let Ok(cached_png) = std::fs::read(&p) {
        if let Some(stored) = fresh_tile_mtime(&cached_png, min_cx, max_cx, min_cz, max_cz, &mtime_fn) {
            if tile_trace() {
                let current = mtime_fn(min_cx, max_cx, min_cz, max_cz);
                trace_log(&format!("serve-cached z={} tile={},{} stored={} current={}", zoom, tile_x, tile_y, stored, current));
            }
            return Some((p.to_string_lossy().into_owned(), stored, false));
        }
        let _ = std::fs::remove_file(&p);
    }}

    let mut to_fetch: Vec<ChunkRequest> = Vec::new();
    for cx in min_cx..=max_cx {
        for cz in min_cz..=max_cz {
            to_fetch.push(ChunkRequest { cx, cz });
        }
    }

    // Snapshot mtime *before* reading .mca data: if worldgen rewrites the region
    // mid-parse, the tile gets stamped with the older pre-read mtime, so the
    // freshness check marks it stale and re-renders instead of freezing a torn read.
    let data_mtime = mtime_fn(min_cx, max_cx, min_cz, max_cz);

    let chunk_results = chunk_colors_fn(&to_fetch);

    // Torn (mid-flush) chunk reads are handled by a bounded retry in `render_tile`
    // (lib.rs), which uses this flag — never stamp mtime 0 here, that caused a
    // re-render-forever CPU storm on every subsequent view of a torn tile.
    let tile_torn = chunk_results.iter().any(|r| r.torn);

    if tile_trace() {
        let torn_n = chunk_results.iter().filter(|r| r.torn).count();
        let total  = chunk_results.len();
        trace_log(&format!("render z={} tile={},{} torn={}/{} data_mtime={}", zoom, tile_x, tile_y, torn_n, total, data_mtime));
    }

    let chunk_map: HashMap<(i32, i32), Vec<u8>> = chunk_results
        .into_iter()
        .filter_map(|r| r.colors.map(|c| ((r.cx, r.cz), c)))
        .collect();

    if chunk_map.is_empty() {
        return None;
    }

    let stamp_mtime = data_mtime;

    // ── Pixel loop ───────────────────────────────────────────────────────────
    let mut pixels = vec![0u8; TILE_SIZE * TILE_SIZE * 4];

    for py in 0..TILE_SIZE {
        for px in 0..TILE_SIZE {
            let bx = block_x as f64 + px as f64 * blocks_per_pixel;
            let bz = block_z as f64 + py as f64 * blocks_per_pixel;
            let cx = (bx.floor() as i32).div_euclid(CHUNK as i32);
            let cz = (bz.floor() as i32).div_euclid(CHUNK as i32);
            let idx = (py * TILE_SIZE + px) * 4;

            let (r, g, b) = if blocks_per_pixel <= 1.0 {
                // High zoom — 1:1 block sampling with hillshading
                let Some(cc) = chunk_map.get(&(cx, cz)) else { continue };

                let lx = (bx.floor() as i32).rem_euclid(CHUNK as i32) as usize;
                let lz = (bz.floor() as i32).rem_euclid(CHUNK as i32) as usize;
                let i = (lz * CHUNK + lx) * 4;

                if cc[i + 3] == 0 {
                    // Cave mode: no floor in scan range → dark void
                    pixels[idx] = 20; pixels[idx + 1] = 20; pixels[idx + 2] = 28; pixels[idx + 3] = 255;
                    continue;
                }

                let r0 = cc[i] as f64;
                let g0 = cc[i + 1] as f64;
                let b0 = cc[i + 2] as f64;
                let y_here = cc[i + 3] as i32 - 64;

                // North neighbour Y (block above in Z)
                let y_north = if lz > 0 {
                    cc[((lz - 1) * CHUNK + lx) * 4 + 3] as i32 - 64
                } else {
                    chunk_map.get(&(cx, cz - 1))
                        .map(|nc| nc[(15 * CHUNK + lx) * 4 + 3] as i32 - 64)
                        .unwrap_or(y_here)
                };

                // West neighbour Y (block left in X)
                let y_west = if lx > 0 {
                    cc[(lz * CHUNK + (lx - 1)) * 4 + 3] as i32 - 64
                } else {
                    chunk_map.get(&(cx - 1, cz))
                        .map(|wc| wc[(lz * CHUNK + 15) * 4 + 3] as i32 - 64)
                        .unwrap_or(y_here)
                };

                let alt_f = 0.75 + 0.42 * ((y_here + 64) as f64 / 280.0).clamp(0.0, 1.0);
                let dy    = (y_here - y_north) + (y_here - y_west);
                let hill_f = (1.0 - dy as f64 * 0.09).clamp(0.65, 1.25);
                let f = alt_f * hill_f;

                ((r0 * f).round().min(255.0) as u8,
                 (g0 * f).round().min(255.0) as u8,
                 (b0 * f).round().min(255.0) as u8)
            } else {
                // Low zoom — average grid of samples across the pixel's block footprint
                let step = ((blocks_per_pixel / 4.0).round() as usize).max(1);
                let mut sr = 0u32; let mut sg = 0u32; let mut sb = 0u32;
                let mut sh = 0u32; let mut cnt = 0u32;

                let mut dz = 0usize;
                while (dz as f64) < blocks_per_pixel {
                    let mut dx = 0usize;
                    while (dx as f64) < blocks_per_pixel {
                        let sbx = (bx + dx as f64).floor() as i32;
                        let sbz = (bz + dz as f64).floor() as i32;
                        let scx = sbx.div_euclid(CHUNK as i32);
                        let scz = sbz.div_euclid(CHUNK as i32);
                        if let Some(sc) = chunk_map.get(&(scx, scz)) {
                            let lx = sbx.rem_euclid(CHUNK as i32) as usize;
                            let lz = sbz.rem_euclid(CHUNK as i32) as usize;
                            let i = (lz * CHUNK + lx) * 4;
                            if sc[i + 3] != 0 {
                                sr += sc[i] as u32;
                                sg += sc[i + 1] as u32;
                                sb += sc[i + 2] as u32;
                                sh += sc[i + 3] as u32;
                                cnt += 1;
                            }
                        }
                        dx += step.max(1);
                    }
                    dz += step.max(1);
                }

                if cnt == 0 {
                    // Chunk exists but all samples no-data → cave solid rock
                    if chunk_map.contains_key(&(cx, cz)) {
                        pixels[idx] = 20; pixels[idx + 1] = 20; pixels[idx + 2] = 28; pixels[idx + 3] = 255;
                    }
                    continue;
                }

                let r0 = (sr / cnt) as f64;
                let g0 = (sg / cnt) as f64;
                let b0 = (sb / cnt) as f64;
                let avg_y = (sh / cnt) as i32 - 64;
                let alt_f = 0.75 + 0.42 * ((avg_y + 64) as f64 / 280.0).clamp(0.0, 1.0);

                ((r0 * alt_f).round().min(255.0) as u8,
                 (g0 * alt_f).round().min(255.0) as u8,
                 (b0 * alt_f).round().min(255.0) as u8)
            };

            pixels[idx] = r; pixels[idx + 1] = g; pixels[idx + 2] = b; pixels[idx + 3] = 255;
        }
    }

    // Write PNG to disk cache with source mtime + provenance embedded; return path on success
    if let Some(parent) = p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let region_files: std::collections::BTreeSet<(i32, i32)> = (min_cx..=max_cx)
        .flat_map(|cx| (min_cz..=max_cz).map(move |cz| (cx.div_euclid(32), cz.div_euclid(32))))
        .collect();
    let regions_str = region_files.iter()
        .map(|&(rx, rz)| format!("r.{rx}.{rz}.mca"))
        .collect::<Vec<_>>()
        .join(";");
    std::fs::write(&p, encode_tile_png(
        &pixels, stamp_mtime, &regions_str, (min_cx, max_cx, min_cz, max_cz), (block_x, block_z),
    )).ok()?;
    Some((p.to_string_lossy().into_owned(), stamp_mtime, tile_torn))
}

// cubiomes scale candidates, largest first — pick the largest that fits ≤ blocksPerPixel.
// Capped at 16 (one chunk): finer scales over-sample relative to display pixels and don't
// improve quality since biome tiles are only generated at zoom 0–1 (bpp ≥ 8).
const CUBIOMES_SCALES: [i32; 3] = [256, 64, 16];
const HEIGHT_SCALE: i32 = 16; // one height sample per chunk — matches biome query resolution
const HEIGHT_MAX_BPP: f64 = 16.0; // only shade heights at zoom levels where it's visible

fn pick_biome_scale(blocks_per_pixel: f64) -> i32 {
    CUBIOMES_SCALES
        .iter()
        .find(|&&s| (s as f64) <= blocks_per_pixel)
        .copied()
        .unwrap_or(16)
}


// Biome ID → RGB, matching biomeColors.ts / chunkbase.com palette.
fn biome_color(id: i32) -> [u8; 3] {
    match id {
        // Ocean
        0   => [0, 0, 112],
        10  => [0, 0, 172],
        24  => [7, 8, 145],
        44  => [0, 0, 200],
        45  => [0, 0, 180],
        46  => [24, 24, 152],
        47  => [0, 50, 140],
        48  => [0, 0, 120],
        49  => [10, 10, 85],
        50  => [24, 24, 112],
        // Plains
        1   => [141, 179, 96],
        129 => [182, 208, 82],
        // Desert
        2   => [250, 148, 24],
        17  => [210, 95, 18],
        130 => [210, 120, 18],
        // Mountains
        3   => [96, 96, 96],
        20  => [114, 120, 154],
        34  => [72, 72, 72],
        131 => [80, 112, 80],
        162 => [80, 80, 70],
        // Forest
        4   => [5, 102, 33],
        18  => [34, 85, 28],
        27  => [34, 85, 28],
        28  => [59, 100, 53],
        29  => [29, 74, 24],
        132 => [120, 170, 60],
        155 => [49, 98, 44],
        156 => [69, 115, 65],
        157 => [64, 81, 26],
        // Taiga
        5   => [11, 102, 89],
        19  => [22, 112, 98],
        30  => [58, 92, 80],   // snowy_taiga — brightened/greened off dark neutral grey (34) for contrast
        31  => [36, 53, 47],
        158 => [36, 53, 47],
        32  => [89, 102, 81],
        33  => [69, 79, 62],
        133 => [0, 77, 54],
        160 => [89, 102, 81],
        161 => [89, 102, 81],
        // Swamp
        6   => [107, 117, 47],
        134 => [96, 106, 37],
        // River
        7   => [60, 100, 240],
        11  => [100, 180, 255],
        // Snowy
        12  => [255, 255, 255],
        13  => [160, 160, 160],
        26  => [250, 250, 245],
        140 => [176, 192, 192],
        // Mushroom
        14  => [150, 80, 180],
        15  => [120, 60, 150],
        // Beach
        16  => [250, 222, 85],
        25  => [130, 130, 130],
        // Jungle
        21  => [83, 123, 9],
        22  => [68, 102, 7],
        23  => [48, 76, 5],
        149 => [68, 102, 7],
        151 => [48, 76, 5],
        168 => [83, 123, 9],
        169 => [56, 100, 7],
        // Savanna
        35  => [189, 178, 95],
        36  => [167, 157, 100],
        163 => [167, 157, 100],
        164 => [167, 157, 100],
        // Badlands
        37  => [217, 69, 21],
        38  => [176, 151, 101],
        39  => [64, 17, 9],
        165 => [217, 69, 21],
        166 => [176, 151, 101],
        167 => [64, 17, 9],
        // Nether
        8   => [180, 30, 30],
        170 => [80, 100, 130],
        171 => [190, 50, 50],
        172 => [26, 160, 157],
        173 => [82, 82, 82],
        // End
        9   => [128, 128, 255],
        40  => [170, 170, 255],
        41  => [100, 200, 100],
        42  => [60, 150, 60],
        43  => [80, 80, 150],
        // 1.17 cave biomes
        174 => [120, 90, 60],
        175 => [80, 160, 80],
        // 1.18
        177 => [169, 199, 112],
        178 => [50, 100, 70],
        179 => [210, 235, 225],
        180 => [100, 100, 110],
        181 => [170, 200, 215],
        182 => [110, 95, 80],
        // 1.19
        183 => [8, 14, 24],
        184 => [56, 133, 90],
        // 1.20
        185 => [225, 100, 160],
        // 1.21
        186 => [195, 205, 180],
        // 26.2 (xpple fork)
        187 => [200, 180, 60], // sulfur_caves — matches biomeColors.ts
        // 26.3
        188 => [235, 146, 52], // dappled_forest — matches biomeColors.ts
        _   => [80, 80, 80],
    }
}

fn biome_tile_path(
    cache_root:  &Path,
    seed_low:    i32,
    seed_high:   i32,
    mc_version:  i32,
    world_flags: i32,
    dimension:   &str,
    sample_y:    i32,
    zoom:        i32,
    tx:          i32,
    ty:          i32,
) -> PathBuf {
    let seed = ((seed_high as i64) << 32) | (seed_low as u32 as i64);
    cache_root
        .join("biome")
        .join(format!("{:016x}", seed as u64))
        // world_flags (large_biomes etc.) changes biome layout for the same seed+coords,
        // so it must be in the path or a tile renders as a stale hit under another world type.
        .join(format!("{}_v{}_wf{}_y{}_t{}", dimension, mc_version, world_flags, sample_y, BIOME_TILE_SIZE))
        .join(zoom.to_string())
        .join(format!("{tx}_{ty}.png"))
}

/// PNG mtime, used to cache-bust the frontend's `convertFileSrc` URL (`?v=<mtime>`) —
/// biome tile paths are stable per seed/config, so WebKit's URL-keyed image cache
/// would otherwise keep serving a stale decode after we rewrite the same path in place.
fn file_mtime_secs(p: &Path) -> u64 {
    std::fs::metadata(p).ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn render_biome_tile(
    cache_root:  &Path,
    slot:        i32,
    seed_low:    i32,
    seed_high:   i32,
    mc_version:  i32,
    world_flags: i32,
    dimension:   &str,
    tile_x:      i32,
    tile_y:      i32,
    zoom:        i32,
) -> Option<(String, u64)> {
    // cubiomes Range.y is biome-space (block_y / 4); y=64 (block 256) is out of range
    // for nether (ceiling block Y 127) and end (ceiling block Y 255), hence the match.
    let sample_y: i32 = match dimension {
        "nether" => 8,   // block Y 32
        "end"    => 16,  // block Y 64
        _        => 64,  // block Y 256, overworld sky
    };

    let p = biome_tile_path(cache_root, seed_low, seed_high, mc_version, world_flags, dimension, sample_y, zoom, tile_x, tile_y);

    if p.exists() {
        return Some((p.to_string_lossy().into_owned(), file_mtime_secs(&p)));
    }

    // Bail on a stale/repointed generator slot rather than render under the
    // wrong config — see bugs-resolved.md.
    let key = crate::cubiomes::GeneratorKey {
        seed_low, seed_high, dimension: dim_to_cubiomes(dimension), world_flags, mc_version,
    };
    if !crate::cubiomes::slot_matches(slot, key) {
        return None;
    }

    let (block_x_f, block_z_f, blocks_per_pixel) = tile_origin_blocks(tile_x, tile_y, zoom, BIOME_TILE_SIZE);
    let block_x = block_x_f.floor() as i32;
    let block_z = block_z_f.floor() as i32;

    let biome_scale = pick_biome_scale(blocks_per_pixel);
    let query_w = ((BIOME_TILE_SIZE as f64 * blocks_per_pixel / biome_scale as f64).ceil() as i32).max(1);
    let query_h = query_w;
    let biome_x = (block_x as f64 / biome_scale as f64).floor() as i32;
    let biome_z = (block_z as f64 / biome_scale as f64).floor() as i32;

    let biomes = crate::cubiomes::get_biome_region_at(
        slot, key, biome_x, biome_z, query_w, query_h, biome_scale, sample_y,
    )?;

    // Real terrain-noise heights, not the cheaper mapApproxHeight estimate. Queries one
    // extra sample on the north/west edges so tile-boundary hillshading has real
    // neighbour data instead of clamping. Overworld 1.18+ or End only; close zoom only.
    let heights: Option<(Vec<f32>, i32)> = if (dimension == "overworld" || dimension == "end") && blocks_per_pixel <= HEIGHT_MAX_BPP {
        let h_query_w = ((BIOME_TILE_SIZE as f64 * blocks_per_pixel / HEIGHT_SCALE as f64).ceil() as i32).max(1);
        // Snapped to the HEIGHT_SCALE grid: cm_get_surface_heights samples at x0 + i*stride,
        // it doesn't take pre-divided coordinates like mapApproxHeight does.
        let h_x = (block_x as f64 / HEIGHT_SCALE as f64).floor() as i32 * HEIGHT_SCALE;
        let h_z = (block_z as f64 / HEIGHT_SCALE as f64).floor() as i32 * HEIGHT_SCALE;
        let ext_w = h_query_w + 1;
        crate::cubiomes::get_surface_height_region(slot, key, h_x - HEIGHT_SCALE, h_z - HEIGHT_SCALE, ext_w, ext_w, HEIGHT_SCALE)
            .map(|h| (h.into_iter().map(|y| y as f32).collect(), ext_w))
    } else {
        None
    };

    let mut pixels = vec![0u8; BIOME_TILE_SIZE * BIOME_TILE_SIZE * 4];
    for py in 0..BIOME_TILE_SIZE {
        for px in 0..BIOME_TILE_SIZE {
            let bx = ((px as f64 * blocks_per_pixel / biome_scale as f64).floor() as usize)
                .min(query_w as usize - 1);
            let bz = ((py as f64 * blocks_per_pixel / biome_scale as f64).floor() as usize)
                .min(query_h as usize - 1);
            let [mut r, mut g, mut b] = biome_color(biomes[bz * query_w as usize + bx]);

            if let Some((ref h, h_ext_w)) = heights {
                let h_qw = h_ext_w as usize;
                // +1 because the query started 1 sample north/west of the tile origin
                let hx = ((px as f64 * blocks_per_pixel / HEIGHT_SCALE as f64).floor() as usize + 1)
                    .min(h_qw - 1);
                let hz = ((py as f64 * blocks_per_pixel / HEIGHT_SCALE as f64).floor() as usize + 1)
                    .min(h_qw - 1);
                let y       = h[hz * h_qw + hx];
                let y_north = h[(hz - 1) * h_qw + hx];
                let y_west  = h[hz * h_qw + (hx - 1)];
                let alt_f   = 0.75 + 0.42 * (y / 280.0).clamp(0.0, 1.0);
                let dy      = (y - y_north) + (y - y_west);
                let hill_f  = (1.0 - dy * 0.09).clamp(0.65, 1.25);
                let shade   = alt_f * hill_f;
                r = (r as f32 * shade).round().min(255.0) as u8;
                g = (g as f32 * shade).round().min(255.0) as u8;
                b = (b as f32 * shade).round().min(255.0) as u8;
            }

            let idx = (py * BIOME_TILE_SIZE + px) * 4;
            pixels[idx]     = r;
            pixels[idx + 1] = g;
            pixels[idx + 2] = b;
            pixels[idx + 3] = 220;
        }
    }

    if let Some(parent) = p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&p, encode_biome_tile_png(
        &pixels, BIOME_TILE_SIZE as u32, seed_low, seed_high, mc_version, world_flags, dimension, sample_y, (block_x, block_z),
    ));

    Some((p.to_string_lossy().into_owned(), file_mtime_secs(&p)))
}

/// Like `encode_biome_tile_png` but for the multi-Y underground scan — embeds
/// the actual block-Y levels sampled instead of a single sample-y, since this
/// tile is a composite across `UNDERGROUND_Y_LEVELS`, not one fixed depth.
fn encode_underground_tile_png(
    pixels:        &[u8],
    size:          u32,
    seed_low:      i32,
    seed_high:     i32,
    mc_version:    i32,
    world_flags:   i32,
    y_levels_used: &str,
    block_origin:  (i32, i32),
) -> Vec<u8> {
    let mut buf = Vec::new();
    {
        let mut encoder = png::Encoder::new(std::io::Cursor::new(&mut buf), size, size);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_compression(png::Compression::Fast);
        let rendered_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let _ = encoder.add_text_chunk("rendered-at".to_string(), rendered_at.to_string());
        let seed = ((seed_high as i64) << 32) | (seed_low as u32 as i64);
        let _ = encoder.add_text_chunk("seed".to_string(), seed.to_string());
        let _ = encoder.add_text_chunk("mc-version".to_string(), mc_version_label(mc_version).to_string());
        let _ = encoder.add_text_chunk("mc-version-id".to_string(), mc_version.to_string());
        let _ = encoder.add_text_chunk("world-flags".to_string(), world_flags.to_string());
        let _ = encoder.add_text_chunk("dimension".to_string(), "overworld".to_string());
        let _ = encoder.add_text_chunk("block-y-levels-scanned".to_string(), y_levels_used.to_string());
        let (block_x, block_z) = block_origin;
        let _ = encoder.add_text_chunk("block-origin".to_string(), format!("{block_x},{block_z}"));
        let mut writer = encoder.write_header().expect("png header");
        writer.write_image_data(pixels).expect("png data");
    }
    buf
}

fn underground_tile_path(
    cache_root:  &Path,
    seed_low:    i32,
    seed_high:   i32,
    mc_version:  i32,
    world_flags: i32,
    zoom:        i32,
    tx:          i32,
    ty:          i32,
) -> PathBuf {
    let seed = ((seed_high as i64) << 32) | (seed_low as u32 as i64);
    cache_root
        .join("underground")
        .join(format!("{:016x}", seed as u64))
        .join(format!("v{}_wf{}_t{}", mc_version, world_flags, BIOME_TILE_SIZE))
        .join(zoom.to_string())
        .join(format!("{tx}_{ty}.png"))
}

/// Per column, walks `UNDERGROUND_Y_LEVELS` shallowest-first and takes the first
/// cave-biome hit below that column's real terrain surface (queried once up front).
/// Overworld-only: cave biomes don't generate in the Nether or End.
pub fn render_underground_biome_tile(
    cache_root:  &Path,
    slot:        i32,
    seed_low:    i32,
    seed_high:   i32,
    mc_version:  i32,
    world_flags: i32,
    dimension:   &str,
    tile_x:      i32,
    tile_y:      i32,
    zoom:        i32,
) -> Option<(String, u64)> {
    if dimension != "overworld" {
        return None;
    }

    let p = underground_tile_path(cache_root, seed_low, seed_high, mc_version, world_flags, zoom, tile_x, tile_y);

    if p.exists() {
        return Some((p.to_string_lossy().into_owned(), file_mtime_secs(&p)));
    }

    // See render_biome_tile's comment on this same check — a queued render
    // can execute after the slot's been repointed to another world/config.
    let key = crate::cubiomes::GeneratorKey {
        seed_low, seed_high, dimension: dim_to_cubiomes(dimension), world_flags, mc_version,
    };
    if !crate::cubiomes::slot_matches(slot, key) {
        return None;
    }

    let (block_x_f, block_z_f, blocks_per_pixel) = tile_origin_blocks(tile_x, tile_y, zoom, BIOME_TILE_SIZE);
    let block_x = block_x_f.floor() as i32;
    let block_z = block_z_f.floor() as i32;

    let h_query_w = ((BIOME_TILE_SIZE as f64 * blocks_per_pixel / HEIGHT_SCALE as f64).ceil() as i32).max(1);
    let h_query_h = h_query_w;
    let h_x = (block_x as f64 / HEIGHT_SCALE as f64).floor() as i32;
    let h_z = (block_z as f64 / HEIGHT_SCALE as f64).floor() as i32;
    let heights = crate::cubiomes::get_height_region(slot, key, h_x, h_z, h_query_w, h_query_h)?;

    let biome_scale = pick_biome_scale(blocks_per_pixel);
    let query_w = ((BIOME_TILE_SIZE as f64 * blocks_per_pixel / biome_scale as f64).ceil() as i32).max(1);
    let query_h = query_w;
    let biome_x = (block_x as f64 / biome_scale as f64).floor() as i32;
    let biome_z = (block_z as f64 / biome_scale as f64).floor() as i32;

    // Every level must succeed, or bail entirely — a partial set here would mean
    // deeper/shallower cave pockets quietly baked into the cached PNG as absent.
    let mut level_grids: Vec<(i32, Vec<i32>)> = Vec::with_capacity(crate::cubiomes::UNDERGROUND_Y_LEVELS.len());
    for &y_biome in crate::cubiomes::UNDERGROUND_Y_LEVELS {
        let grid = crate::cubiomes::get_biome_region_at(
            slot, key, biome_x, biome_z, query_w, query_h, biome_scale, y_biome,
        )?;
        level_grids.push((y_biome, grid));
    }

    let mut pixels = vec![0u8; BIOME_TILE_SIZE * BIOME_TILE_SIZE * 4];
    for py in 0..BIOME_TILE_SIZE {
        for px in 0..BIOME_TILE_SIZE {
            let hx = ((px as f64 * blocks_per_pixel / HEIGHT_SCALE as f64).floor() as usize).min(h_query_w as usize - 1);
            let hz = ((py as f64 * blocks_per_pixel / HEIGHT_SCALE as f64).floor() as usize).min(h_query_h as usize - 1);
            let surface_h = heights[hz * h_query_w as usize + hx];
            if !surface_h.is_finite() { continue; }
            let surface_block_y = surface_h.round() as i32;

            let bx = ((px as f64 * blocks_per_pixel / biome_scale as f64).floor() as usize).min(query_w as usize - 1);
            let bz = ((py as f64 * blocks_per_pixel / biome_scale as f64).floor() as usize).min(query_h as usize - 1);
            let idx = bz * query_w as usize + bx;

            let hit = level_grids.iter()
                .filter(|(y_biome, _)| y_biome * 4 < surface_block_y)
                .find_map(|(_, grid)| {
                    let id = grid[idx];
                    crate::cubiomes::CAVE_BIOME_IDS.contains(&id).then_some(id)
                });

            if let Some(id) = hit {
                let [r, g, b] = biome_color(id);
                let off = (py * BIOME_TILE_SIZE + px) * 4;
                pixels[off] = r; pixels[off + 1] = g; pixels[off + 2] = b; pixels[off + 3] = 220;
            }
        }
    }

    if let Some(parent) = p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let y_levels_used = level_grids.iter()
        .map(|(y_biome, _)| (y_biome * 4).to_string())
        .collect::<Vec<_>>()
        .join(",");
    let _ = std::fs::write(&p, encode_underground_tile_png(
        &pixels, BIOME_TILE_SIZE as u32, seed_low, seed_high, mc_version, world_flags, &y_levels_used, (block_x, block_z),
    ));

    Some((p.to_string_lossy().into_owned(), file_mtime_secs(&p)))
}

// ── World map export ──────────────────────────────────────────────────────────

const REGION_BLOCKS: i32 = 512;
const BIOME_EXPORT_SCALE: i32 = 4; // cubiomes scale used for biome fill

/// Dimension string → cubiomes dimension int (overworld=0, nether=-1, end=1).
fn dim_to_cubiomes(dimension: &str) -> i32 {
    match dimension {
        "nether" => -1,
        "end"    =>  1,
        _        =>  0,
    }
}

/// Render one 512×512-block region at `blocks_per_pixel` resolution into `out`.
/// `out` must have capacity for `px * px * 4` bytes and will be filled starting at offset 0.
/// `get_chunk_colors` is called with the full 32×32 chunk request list; it returns
/// whatever chunks have data (both Java .mca and Bedrock LDB satisfy this contract).
fn render_region_to_buf(
    rx: i32, rz: i32,
    blocks_per_pixel: f64,
    seed_low: i32, seed_high: i32,
    mc_version: i32, world_flags: i32,
    dimension: &str,
    px: usize,
    out: &mut Vec<u8>,
    get_chunk_colors: &impl Fn(&[ChunkRequest]) -> Vec<ChunkResult>,
) {
    let block_x0 = rx * REGION_BLOCKS;
    let block_z0 = rz * REGION_BLOCKS;

    // Seed the buffer with biome colors — chunk data overlays on top so any
    // pixel not covered by chunk data shows a reasonable background.
    render_region_biome(
        seed_low, seed_high, mc_version, world_flags, dimension,
        block_x0, block_z0, blocks_per_pixel, px, out,
    );

    let (min_cx, max_cx) = cell_range(block_x0, block_x0 + REGION_BLOCKS - 1, CHUNK as i32);
    let (min_cz, max_cz) = cell_range(block_z0, block_z0 + REGION_BLOCKS - 1, CHUNK as i32);

    let requests: Vec<ChunkRequest> = (min_cz..=max_cz)
        .flat_map(|cz| (min_cx..=max_cx).map(move |cx| ChunkRequest { cx, cz }))
        .collect();

    let chunk_map: HashMap<(i32, i32), Vec<u8>> = get_chunk_colors(&requests)
        .into_iter()
        .filter_map(|r| r.colors.map(|c| ((r.cx, r.cz), c)))
        .collect();

    if chunk_map.is_empty() {
        return;
    }

    // Pixel fill with hillshading (same logic as get_or_render_tile at 1px/block)
    for py in 0..px {
        for pxx in 0..px {
            let bx = block_x0 as f64 + pxx as f64 * blocks_per_pixel;
            let bz = block_z0 as f64 + py  as f64 * blocks_per_pixel;
            let cx = (bx.floor() as i32).div_euclid(CHUNK as i32);
            let cz = (bz.floor() as i32).div_euclid(CHUNK as i32);
            let idx = (py * px + pxx) * 4;

            let (r, g, b) = if blocks_per_pixel <= 1.0 {
                let Some(cc) = chunk_map.get(&(cx, cz)) else { continue; };
                let lx = (bx.floor() as i32).rem_euclid(CHUNK as i32) as usize;
                let lz = (bz.floor() as i32).rem_euclid(CHUNK as i32) as usize;
                let i = (lz * CHUNK + lx) * 4;
                if cc[i + 3] == 0 { continue; }
                let r0 = cc[i] as f64; let g0 = cc[i+1] as f64; let b0 = cc[i+2] as f64;
                let y_here = cc[i + 3] as i32 - 64;
                let y_north = if lz > 0 { cc[((lz-1)*CHUNK+lx)*4+3] as i32 - 64 }
                    else { chunk_map.get(&(cx, cz-1)).map(|nc| nc[(15*CHUNK+lx)*4+3] as i32 - 64).unwrap_or(y_here) };
                let y_west  = if lx > 0 { cc[(lz*CHUNK+(lx-1))*4+3] as i32 - 64 }
                    else { chunk_map.get(&(cx-1, cz)).map(|wc| wc[(lz*CHUNK+15)*4+3] as i32 - 64).unwrap_or(y_here) };
                let alt_f  = 0.75 + 0.42 * ((y_here + 64) as f64 / 280.0).clamp(0.0, 1.0);
                let hill_f = (1.0 - ((y_here-y_north)+(y_here-y_west)) as f64 * 0.09).clamp(0.65, 1.25);
                let f = alt_f * hill_f;
                ((r0*f).round().min(255.0) as u8, (g0*f).round().min(255.0) as u8, (b0*f).round().min(255.0) as u8)
            } else {
                let step = ((blocks_per_pixel / 4.0).round() as usize).max(1);
                let mut sr=0u32; let mut sg=0u32; let mut sb=0u32; let mut sh=0u32; let mut cnt=0u32;
                let mut dz=0usize;
                while (dz as f64) < blocks_per_pixel {
                    let mut dx=0usize;
                    while (dx as f64) < blocks_per_pixel {
                        let sbx = (bx + dx as f64).floor() as i32;
                        let sbz = (bz + dz as f64).floor() as i32;
                        let scx = sbx.div_euclid(CHUNK as i32);
                        let scz = sbz.div_euclid(CHUNK as i32);
                        if let Some(sc) = chunk_map.get(&(scx, scz)) {
                            let lx = sbx.rem_euclid(CHUNK as i32) as usize;
                            let lz = sbz.rem_euclid(CHUNK as i32) as usize;
                            let i = (lz * CHUNK + lx) * 4;
                            if sc[i+3] != 0 { sr+=sc[i] as u32; sg+=sc[i+1] as u32; sb+=sc[i+2] as u32; sh+=sc[i+3] as u32; cnt+=1; }
                        }
                        dx += step;
                    }
                    dz += step;
                }
                if cnt == 0 { continue; }
                let r0=(sr/cnt) as f64; let g0=(sg/cnt) as f64; let b0=(sb/cnt) as f64;
                let avg_y=(sh/cnt) as i32 - 64;
                let alt_f = 0.75 + 0.42 * ((avg_y+64) as f64 / 280.0).clamp(0.0,1.0);
                ((r0*alt_f).round().min(255.0) as u8, (g0*alt_f).round().min(255.0) as u8, (b0*alt_f).round().min(255.0) as u8)
            };

            out[idx]=r; out[idx+1]=g; out[idx+2]=b; out[idx+3]=255;
        }
    }
}

fn render_region_biome(
    seed_low: i32, seed_high: i32,
    mc_version: i32, world_flags: i32,
    dimension: &str,
    block_x0: i32, block_z0: i32,
    blocks_per_pixel: f64, px: usize,
    out: &mut Vec<u8>,
) {
    let scale = BIOME_EXPORT_SCALE;
    let query_w = ((px as f64 * blocks_per_pixel / scale as f64).ceil() as i32).max(1);
    let bx_scaled = (block_x0 as f64 / scale as f64).floor() as i32;
    let bz_scaled = (block_z0 as f64 / scale as f64).floor() as i32;
    let dim_int = dim_to_cubiomes(dimension);

    let biomes = crate::cubiomes::get_biome_region_for_seed(
        seed_low, seed_high, mc_version, dim_int, world_flags,
        bx_scaled, bz_scaled, query_w, query_w, scale,
    );

    for py in 0..px {
        for pxx in 0..px {
            let idx = (py * px + pxx) * 4;
            let bx = ((pxx as f64 * blocks_per_pixel / scale as f64).floor() as usize)
                .min(query_w as usize - 1);
            let bz = ((py as f64 * blocks_per_pixel / scale as f64).floor() as usize)
                .min(query_w as usize - 1);
            let [r, g, b] = if let Some(ref biomes) = biomes {
                biome_color(biomes[bz * query_w as usize + bx])
            } else {
                [80, 80, 80]
            };
            out[idx]=r; out[idx+1]=g; out[idx+2]=b; out[idx+3]=255;
        }
    }
}

#[derive(serde::Serialize, Clone)]
struct ExportProgress {
    done_biome: u32,
    done_chunk: u32,
    total:      u32,
}

/// Export a full-world TIFF. `regions` is the pre-computed list of region coords
/// that have actual chunk data; `get_chunk_colors` is a closure that fetches surface
/// colors for a slice of ChunkRequests (works for both Java .mca and Bedrock LDB).
pub fn export_world_map(
    app: &tauri::AppHandle,
    regions: Vec<(i32, i32)>,
    dimension: &str,
    output_path: &str,
    blocks_per_pixel: f64,
    seed_low: i32,
    seed_high: i32,
    mc_version: i32,
    world_flags: i32,
    cancel: Arc<AtomicBool>,
    get_chunk_colors: impl Fn(&[ChunkRequest]) -> Vec<ChunkResult>,
) -> Result<(), String> {
    use tiff::encoder::{colortype::RGBA8, TiffEncoder};

    if regions.is_empty() {
        return Err("No generated chunks found for this dimension.".to_string());
    }

    let rx_min = regions.iter().map(|&(rx, _)| rx).min().unwrap() - 1;
    let rx_max = regions.iter().map(|&(rx, _)| rx).max().unwrap() + 1;
    let rz_min = regions.iter().map(|&(_, rz)| rz).min().unwrap() - 1;
    let rz_max = regions.iter().map(|&(_, rz)| rz).max().unwrap() + 1;

    let bpp = blocks_per_pixel.max(0.25).min(16.0);
    let px_per_region = (REGION_BLOCKS as f64 / bpp).round() as usize;
    let total_w = (rx_max - rx_min + 1) as usize * px_per_region;
    let total_h = (rz_max - rz_min + 1) as usize * px_per_region;

    if total_w == 0 || total_h == 0 || total_w > 131072 || total_h > 131072 {
        return Err(format!("Export dimensions {total_w}×{total_h} out of range."));
    }

    let region_set: std::collections::HashSet<(i32, i32)> = regions.into_iter().collect();
    let total_regions = (rx_max - rx_min + 1) * (rz_max - rz_min + 1);
    let mut done_biome = 0u32;
    let mut done_chunk = 0u32;

    // Full image buffer — each region blits into its x/y offset.
    let total_px = total_w * total_h * 4;
    let mut pixels = vec![0u8; total_px];

    for rz in rz_min..=rz_max {
        if cancel.load(Ordering::Relaxed) {
            return Err("Export cancelled.".to_string());
        }

        let row_off_y = (rz - rz_min) as usize * px_per_region;

        for rx in rx_min..=rx_max {
            let col_off_x = (rx - rx_min) as usize * px_per_region;

            let mut region_buf = vec![0u8; px_per_region * px_per_region * 4];
            if region_set.contains(&(rx, rz)) {
                render_region_to_buf(
                    rx, rz, bpp,
                    seed_low, seed_high, mc_version, world_flags,
                    dimension, px_per_region, &mut region_buf,
                    &get_chunk_colors,
                );
                done_chunk += 1;
            } else {
                render_region_biome(
                    seed_low, seed_high, mc_version, world_flags, dimension,
                    rx * REGION_BLOCKS, rz * REGION_BLOCKS,
                    bpp, px_per_region, &mut region_buf,
                );
                done_biome += 1;
            }

            // Blit region_buf into the correct position in the full image
            for row in 0..px_per_region {
                let src_off = row * px_per_region * 4;
                let dst_off = ((row_off_y + row) * total_w + col_off_x) * 4;
                pixels[dst_off..dst_off + px_per_region * 4]
                    .copy_from_slice(&region_buf[src_off..src_off + px_per_region * 4]);
            }

            let _ = app.emit("export:progress", ExportProgress {
                done_biome,
                done_chunk,
                total: total_regions as u32,
            });
        }
    }

    if cancel.load(Ordering::Relaxed) {
        return Err("Export cancelled.".to_string());
    }

    // Write TIFF strip-by-strip
    let file = std::fs::File::create(output_path)
        .map_err(|e| format!("Cannot create output file: {e}"))?;
    let mut tiff = TiffEncoder::new(file)
        .map_err(|e| format!("TIFF init error: {e}"))?;
    let mut image = tiff.new_image::<RGBA8>(total_w as u32, total_h as u32)
        .map_err(|e| format!("TIFF image error: {e}"))?;
    // The tiff crate's RGBA8 colortype writes SamplesPerPixel=4 but never declares the
    // alpha sample via ExtraSamples (required by TIFF6 whenever samples exceed what
    // PhotometricInterpretation implies) — strict readers misinterpret the channel
    // without it. 2 = unassociated (straight, non-premultiplied) alpha.
    image.encoder().write_tag(tiff::tags::Tag::ExtraSamples, 2u16)
        .map_err(|e| format!("TIFF tag error: {e}"))?;

    // Provenance, the TIFF equivalent of the tEXt chunks tile-cache PNGs carry.
    let rendered_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let seed = ((seed_high as i64) << 32) | (seed_low as u32 as i64);
    let description = format!(
        "rendered={rendered_at};dimension={dimension};seed={seed};mc_version={};world_flags={world_flags};regions=r.{rx_min}.{rz_min}.mca..r.{rx_max}.{rz_max}.mca;bpp={bpp}",
        mc_version_label(mc_version),
    );
    image.encoder().write_tag(tiff::tags::Tag::ImageDescription, description.as_str())
        .map_err(|e| format!("TIFF tag error: {e}"))?;

    let mut written = 0usize;
    while written < total_px {
        let n = image.next_strip_sample_count() as usize;
        if n == 0 { break; }
        let end = (written + n).min(total_px);
        image.write_strip(&pixels[written..end])
            .map_err(|e| format!("TIFF write error: {e}"))?;
        written = end;
    }

    image.finish().map_err(|e| format!("TIFF finish error: {e}"))?;
    let _ = app.emit("export:done", ());
    Ok(())
}
