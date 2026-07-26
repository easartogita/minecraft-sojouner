use crate::block_colors::block_name_to_rgb_in_biome;
use fastnbt::Value;
use flate2::read::{GzDecoder, ZlibDecoder};
use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};

// 16×16 RGBA for one chunk — alpha encodes Y for renderer-side hillshading
pub type ChunkColors = Vec<u8>; // len = 16 * 16 * 4

// ── Local difficulty ──────────────────────────────────────────────────────────

const MOON_BRIGHTNESS: [f64; 8] = [1.0, 0.75, 0.5, 0.25, 0.0, 0.25, 0.5, 0.75];
const DIFFICULTY_MAX:  [f64; 4] = [0.0, 2.25, 4.5, 6.75];

/// Returns (special_multiplier, regional_difficulty).
pub fn compute_local_difficulty(game_difficulty: i32, world_time: i64, inhabited_ticks: i64) -> (f64, f64) {
    if game_difficulty == 0 {
        return (0.0, 0.0);
    }
    let total_days       = (world_time / 24000) as f64;
    let moon_phase       = (total_days as i64).rem_euclid(8) as usize;
    let moon_brightness  = MOON_BRIGHTNESS[moon_phase];
    let day_factor       = (total_days / 63.0).clamp(0.0, 1.0);
    let inhabited_factor = (inhabited_ticks as f64 / 3_600_000.0).clamp(0.0, 1.0);
    let diff_factor      = game_difficulty as f64 / 3.0;
    let base             = diff_factor * (0.75 * day_factor + 0.25 * moon_brightness);
    let special          = (base + inhabited_factor * 0.4).clamp(0.0, 1.0);
    let regional         = special * DIFFICULTY_MAX[game_difficulty.clamp(0, 3) as usize];
    (special, regional)
}

// ── Chunk info (hover lookup) ─────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkInfo {
    pub block_name:         Option<String>,
    pub inhabited_time:     Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub special_multiplier: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub regional_difficulty: Option<f64>,
    /// Surface Y of the block at the queried position (same logic as tile renderer).
    /// None when the chunk isn't generated or the column is air.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_y: Option<i32>,
}

/// Find the .mca region file for a given region coord, handling old and new layouts.
/// Return the region directories for a given dimension (both legacy and 1.21.5 paths).
fn region_dirs(world_dir: &str, dimension: &str) -> [PathBuf; 2] {
    let base = Path::new(world_dir);
    match dimension {
        "nether" => [
            base.join("dimensions").join("minecraft").join("the_nether").join("region"),
            base.join("DIM-1").join("region"),
        ],
        "end" => [
            base.join("dimensions").join("minecraft").join("the_end").join("region"),
            base.join("DIM1").join("region"),
        ],
        _ => [
            base.join("dimensions").join("minecraft").join("overworld").join("region"),
            base.join("region"),
        ],
    }
}

/// Scan all region directories and return every (rx, rz) pair that has an .mca file.
pub fn list_regions(world_dir: &str, dimension: &str) -> Vec<(i32, i32)> {
    let mut regions = Vec::new();
    for dir in region_dirs(world_dir, dimension) {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let s = name.to_string_lossy();
            // r.<rx>.<rz>.mca
            let parts: Vec<&str> = s.strip_suffix(".mca")
                .and_then(|n| n.strip_prefix("r."))
                .map(|n| n.splitn(2, '.').collect())
                .unwrap_or_default();
            if parts.len() == 2 {
                if let (Ok(rx), Ok(rz)) = (parts[0].parse::<i32>(), parts[1].parse::<i32>()) {
                    regions.push((rx, rz));
                }
            }
        }
        if !regions.is_empty() { break; }  // use whichever dir has data
    }
    regions
}

pub fn find_region_file(world_dir: &str, dimension: &str, rx: i32, rz: i32) -> Option<PathBuf> {
    let file = format!("r.{rx}.{rz}.mca");
    region_dirs(world_dir, dimension)
        .into_iter()
        .map(|d| d.join(&file))
        .find(|p| p.exists())
}

// ── Packed-long unpacking (1.16+ padded format) ───────────────────────────────
// Values never span a 64-bit boundary, so no hi/lo boundary handling needed.

fn unpack_long(longs: &[i64], index: usize, bits_per_value: u32) -> u32 {
    let vpl = 64 / bits_per_value as usize;
    let long_idx = index / vpl;
    if long_idx >= longs.len() {
        return 0;
    }
    let bit_off = (index % vpl) * bits_per_value as usize;
    let mask = (1u64 << bits_per_value) - 1;
    ((longs[long_idx] as u64 >> bit_off) & mask) as u32
}

// ── NBT navigation helpers ────────────────────────────────────────────────────

fn cmp(v: &Value) -> Option<&HashMap<String, Value>> {
    if let Value::Compound(m) = v { Some(m) } else { None }
}

fn get<'a>(v: &'a Value, key: &str) -> Option<&'a Value> {
    cmp(v)?.get(key)
}

fn as_i32(v: &Value) -> Option<i32> {
    match v {
        Value::Byte(n)  => Some(*n as i32),
        Value::Short(n) => Some(*n as i32),
        Value::Int(n)   => Some(*n),
        _ => None,
    }
}

fn as_i64(v: &Value) -> Option<i64> {
    match v {
        Value::Long(n) => Some(*n),
        Value::Int(n)  => Some(*n as i64),
        _ => None,
    }
}

fn as_str(v: &Value) -> Option<&str> {
    if let Value::String(s) = v { Some(s.as_str()) } else { None }
}

fn as_long_array(v: &Value) -> Option<&[i64]> {
    if let Value::LongArray(a) = v { Some(a) } else { None }
}

fn as_list(v: &Value) -> Option<&Vec<Value>> {
    if let Value::List(l) = v { Some(l) } else { None }
}

// ── Section helpers ───────────────────────────────────────────────────────────

struct SectionView<'a> {
    palette: Vec<&'a str>,  // block names (without minecraft: prefix where possible)
    data:    &'a [i64],
    bpv:     u32,           // bits per value
    biomes:  Option<BiomeView<'a>>,
}

/// 1.18+ per-section biome palette: 4×4×4 cells, packed like block states but
/// with no 4-bit minimum on the index width.
struct BiomeView<'a> {
    palette: Vec<&'a str>,
    data:    &'a [i64],
    bpv:     u32,
}

fn parse_biomes(section: &Value) -> Option<BiomeView<'_>> {
    let b = get(section, "biomes")?;
    let palette_vals = get(b, "palette").and_then(as_list)?;
    let palette: Vec<&str> = palette_vals
        .iter()
        .filter_map(as_str)
        .map(|s| s.strip_prefix("minecraft:").unwrap_or(s))
        .collect();
    if palette.is_empty() {
        return None;
    }
    let data = get(b, "data").and_then(as_long_array).unwrap_or(&[]);
    let bpv = if palette.len() <= 1 {
        0
    } else {
        (palette.len() as f32).log2().ceil() as u32
    };
    Some(BiomeView { palette, data, bpv })
}

fn parse_section(section: &Value) -> Option<SectionView<'_>> {
    let bs = get(section, "block_states")?;
    let palette_vals = get(bs, "palette").and_then(as_list)?;
    if palette_vals.is_empty() {
        return None;
    }

    let palette: Vec<&str> = palette_vals
        .iter()
        .filter_map(|entry| {
            get(entry, "Name")
                .and_then(as_str)
                .map(|s| if let Some(rest) = s.strip_prefix("minecraft:") { rest } else { s })
        })
        .collect();

    let data = get(bs, "data")
        .and_then(as_long_array)
        .unwrap_or(&[]);

    let bpv = if palette.len() <= 1 {
        0
    } else {
        (palette.len() as f32).log2().ceil() as u32
    }
    .max(4);

    Some(SectionView { palette, data, bpv, biomes: parse_biomes(section) })
}

fn get_block_name_in_section<'a>(sv: &'a SectionView<'a>, local_y: usize, bx: usize, bz: usize) -> &'a str {
    if sv.palette.len() == 1 {
        return sv.palette[0];
    }
    if sv.data.is_empty() {
        return sv.palette.first().copied().unwrap_or("air");
    }
    let block_idx = local_y * 256 + bz * 16 + bx;
    let palette_idx = unpack_long(sv.data, block_idx, sv.bpv) as usize;
    sv.palette.get(palette_idx).copied().unwrap_or("air")
}

fn get_biome_in_section<'a>(sv: &'a SectionView<'a>, local_y: usize, bx: usize, bz: usize) -> &'a str {
    let Some(bv) = &sv.biomes else { return "" };
    if bv.palette.len() == 1 || bv.data.is_empty() {
        return bv.palette.first().copied().unwrap_or("");
    }
    let cell_idx = (local_y / 4) * 16 + (bz / 4) * 4 + (bx / 4);
    let palette_idx = unpack_long(bv.data, cell_idx, bv.bpv) as usize;
    bv.palette.get(palette_idx).copied().unwrap_or("")
}

// ── Main extraction ───────────────────────────────────────────────────────────

const AIR: &[&str] = &["air", "cave_air", "void_air"];

fn is_air(name: &str) -> bool {
    AIR.contains(&name)
}

/// Extract the surface block (name + Y + biome) for each of the 256 columns in
/// a chunk. The biome is the 1.18+ per-section palette entry at the surface
/// cell ("" for pre-1.18 chunks). Returns an empty slice when the chunk is not
/// fully generated.
fn extract_surface(
    chunk: &Value,
    hide_water: bool,
    cave_y: Option<i32>,
    cave_scan_low: i32,
    cave_scan_high: i32,
) -> Vec<(String, i32, String)> {
    // Prefer 1.18+ root-level Status; older worlds have it under "Level"
    let root = if get(chunk, "Status").is_some() {
        chunk
    } else if let Some(level) = get(chunk, "Level") {
        level
    } else {
        return vec![];
    };

    // Gate on terrain presence, not the Status string. A chunk is renderable as
    // soon as it has a populated surface heightmap — true for `features`,
    // `initialize_light`, `light` and `full`. The old `== "full"` check needlessly
    // blanked ~thousands of fully-terrained proto-chunks (e.g. initialize_light)
    // at the frontier of explored area, leaving the biome layer showing through.
    // Earlier stages (structure_starts, biomes, surface, carvers, noise) have no
    // usable heightmap and fall through to the empty return below — there is no
    // terrain on disk to draw, so the biome layer is the correct fallback there.

    // Heightmap — MOTION_BLOCKING for normal, OCEAN_FLOOR when hiding water
    let hm = get(root, "Heightmaps");
    let hm_longs: &[i64] = hm
        .and_then(|h| {
            if hide_water {
                get(h, "OCEAN_FLOOR")
                    .or_else(|| get(h, "WORLD_SURFACE"))
                    .or_else(|| get(h, "MOTION_BLOCKING"))
            } else {
                get(h, "MOTION_BLOCKING")
                    .or_else(|| get(h, "WORLD_SURFACE"))
            }
        })
        .and_then(as_long_array)
        .unwrap_or(&[]);

    // A full heightmap is 37 packed longs (256 columns × 9 bits). Anything shorter
    // means no usable heightmap — but the chunk may still be terrained. Proto-chunks
    // at the exploration frontier (e.g. `carvers` status) carry real terrain sections
    // with NO Heightmaps at all; those must be rendered by scanning the sections
    // top-down for the surface, or they'd leave a blank seam (the biome layer shows
    // through). Only truly-empty chunks (no terrain) fall through to the empty return.
    let has_heightmap = hm_longs.len() >= 37;

    let y_pos: i32 = get(root, "yPos").and_then(as_i32).unwrap_or(-4);
    let min_y = y_pos * 16;

    // Build section map: sectionY → parsed SectionView
    let sections_list = get(root, "sections")
        .and_then(as_list)
        .map(|v| v.as_slice())
        .unwrap_or(&[]);

    let mut section_map: HashMap<i32, SectionView> = HashMap::new();
    for s in sections_list {
        if let Some(y) = get(s, "Y").and_then(as_i32) {
            if let Some(sv) = parse_section(s) {
                section_map.insert(y, sv);
            }
        }
    }

    // Without a heightmap, a chunk with no non-air blocks has nothing to draw.
    let has_terrain = section_map.values().any(|sv| sv.palette.iter().any(|n| !is_air(n)));
    if !has_heightmap && !has_terrain {
        return vec![];
    }

    let get_block = |y: i32, bx: usize, bz: usize| -> &str {
        let section_y = y.div_euclid(16);
        let local_y = y.rem_euclid(16) as usize;
        section_map
            .get(&section_y)
            .map(|sv| get_block_name_in_section(sv, local_y, bx, bz))
            .unwrap_or("air")
    };

    let biome_at = |y: i32, bx: usize, bz: usize| -> String {
        let section_y = y.div_euclid(16);
        let local_y = y.rem_euclid(16) as usize;
        section_map
            .get(&section_y)
            .map(|sv| get_biome_in_section(sv, local_y, bx, bz))
            .unwrap_or("")
            .to_string()
    };

    // Top of the populated section range — the start point for the scan fallback.
    let scan_top = section_map.keys().copied().max().map(|sy| sy * 16 + 15).unwrap_or(min_y);

    // Surface Y for a column: from the heightmap when present, else scanned from the
    // top of the sections down to the first non-air block. When hiding water the scan
    // also skips water/ice so it lands on the ocean floor (mirrors OCEAN_FLOOR).
    let get_height_y = |col: usize| -> i32 {
        if has_heightmap {
            let raw = unpack_long(hm_longs, col, 9) as i32;
            return raw + min_y - 1; // -1: actual block, not the air above
        }
        let bx = col % 16;
        let bz = col / 16;
        let mut y = scan_top;
        while y >= min_y {
            let b = get_block(y, bx, bz);
            let skip = is_air(b)
                || (hide_water && matches!(b, "water" | "ice" | "frosted_ice" | "bubble_column"));
            if !skip {
                return y;
            }
            y -= 1;
        }
        min_y - 1 // all air in this column → get_block returns air → transparent pixel
    };

    let mut result: Vec<(String, i32, String)> = vec![(String::new(), 0, String::new()); 256];

    for col in 0..256usize {
        let bx = col % 16;
        let bz = col / 16;

        if let Some(center_y) = cave_y {
            // Cave mode: scan for a floor (non-air block with air above it)
            let lo = (center_y + cave_scan_low).max(min_y);
            let hi = (center_y + cave_scan_high).min(get_height_y(col) - 1);
            if hi < lo { continue; } // window entirely above the surface here → transparent
            // Start nearest the anchor but *inside* the window — the anchor may sit
            // outside it entirely (unlocked gauge), and both scan legs must stay
            // within [lo, hi] or floors outside the window leak into the render.
            let scan_start = center_y.clamp(lo, hi);

            let find_floor = |from: i32, to: i32, step: i32| -> Option<(String, i32)> {
                let mut y = from;
                loop {
                    if step > 0 && y > to { break; }
                    if step < 0 && y < to { break; }
                    let above = get_block(y + 1, bx, bz);
                    if !is_air(above) { y += step; continue; }
                    let here = get_block(y, bx, bz);
                    if !is_air(here) {
                        return Some((here.to_string(), y));
                    }
                    y += step;
                }
                None
            };

            let hit = find_floor(scan_start, lo, -1)
                .or_else(|| if hi > scan_start { find_floor(scan_start + 1, hi, 1) } else { None });
            result[col] = hit
                .map(|(name, y)| { let b = biome_at(y, bx, bz); (name, y, b) })
                .unwrap_or_default();
        } else {
            // Surface mode: use heightmap, then refine for ice/water-hide case
            let block_y = get_height_y(col);
            let name = get_block(block_y, bx, bz);

            if is_air(name) {
                // Heightmap pointed to air — leave as ("", 0) → transparent pixel
            } else if hide_water && (name == "ice" || name == "frosted_ice") {
                let mut found = false;
                let mut y = block_y - 1;
                while y >= min_y {
                    let below = get_block(y, bx, bz);
                    if below == "ice" || below == "frosted_ice" || below == "water" {
                        y -= 1;
                        continue;
                    }
                    if is_air(below) {
                        break;
                    }
                    result[col] = (below.to_string(), y, biome_at(y, bx, bz));
                    found = true;
                    break;
                }
                if !found {
                    result[col] = (name.to_string(), block_y, biome_at(block_y, bx, bz));
                }
            } else {
                result[col] = (name.to_string(), block_y, biome_at(block_y, bx, bz));
            }
        }
    }

    result
}

// ── .mca file parsing ─────────────────────────────────────────────────────────

pub fn decompress_chunk(data: &[u8], compression: u8) -> Option<Vec<u8>> {
    match compression {
        1 => {
            let mut out = Vec::new();
            GzDecoder::new(data).read_to_end(&mut out).ok()?;
            Some(out)
        }
        2 => {
            let mut out = Vec::new();
            ZlibDecoder::new(data).read_to_end(&mut out).ok()?;
            Some(out)
        }
        3 => Some(data.to_vec()), // uncompressed
        _ => None,
    }
}

/// Read and decompress one chunk NBT from an already-loaded .mca buffer.
/// `local_x` and `local_z` are region-local coordinates (0–31).
pub fn read_chunk_nbt(file_buf: &[u8], local_x: usize, local_z: usize) -> Option<Value> {
    let header_offset = 4 * (local_x + local_z * 32);
    if header_offset + 4 > file_buf.len() {
        return None;
    }

    let sector_offset = ((file_buf[header_offset] as usize) << 16)
        | ((file_buf[header_offset + 1] as usize) << 8)
        | (file_buf[header_offset + 2] as usize);
    let sector_count = file_buf[header_offset + 3] as usize;

    if sector_offset == 0 || sector_count == 0 {
        return None;
    }

    let byte_offset = sector_offset * 4096;
    if byte_offset + 5 > file_buf.len() {
        return None;
    }

    let data_len = u32::from_be_bytes([
        file_buf[byte_offset],
        file_buf[byte_offset + 1],
        file_buf[byte_offset + 2],
        file_buf[byte_offset + 3],
    ]) as usize;
    let compression = file_buf[byte_offset + 4];

    if data_len <= 1 {
        return None;
    }

    let data_end = byte_offset + 5 + (data_len - 1);
    if data_end > file_buf.len() {
        return None;
    }

    let raw = decompress_chunk(&file_buf[byte_offset + 5..data_end], compression)?;
    fastnbt::from_bytes(&raw).ok()
}

/// Also find the entity file for a given region (1.17+ separate entity files).
pub fn find_entity_file(world_dir: &str, dimension: &str, rx: i32, rz: i32) -> Option<PathBuf> {
    let file = format!("r.{rx}.{rz}.mca");
    let dim_dir = match dimension {
        "nether" => "the_nether",
        "end"    => "the_end",
        _        => "overworld",
    };
    let base = Path::new(world_dir);
    let candidates = [
        // 1.21.5+
        base.join("dimensions").join("minecraft").join(dim_dir).join("entities").join(&file),
        // 1.17–1.21.4
        base.join("entities").join(&file),
        base.join("DIM-1").join("entities").join(&file),
        base.join("DIM1").join("entities").join(&file),
    ];
    candidates.into_iter().find(|p| p.exists())
}

/// Find the POI file for a given region (stored in poi/ subdirectory).
pub fn find_poi_file(world_dir: &str, dimension: &str, rx: i32, rz: i32) -> Option<PathBuf> {
    let file = format!("r.{rx}.{rz}.mca");
    let dim_dir = match dimension {
        "nether" => "the_nether",
        "end"    => "the_end",
        _        => "overworld",
    };
    let base = Path::new(world_dir);
    let candidates = [
        // 1.21.5+
        base.join("dimensions").join("minecraft").join(dim_dir).join("poi").join(&file),
        // 1.17–1.21.4
        base.join("poi").join(&file),
        base.join("DIM-1").join("poi").join(&file),
        base.join("DIM1").join("poi").join(&file),
    ];
    candidates.into_iter().find(|p| p.exists())
}

/// Parse one chunk's RGBA colors from a decompressed .mca buffer.
/// Returns None when the chunk doesn't exist or isn't fully generated.
/// Outcome of reading one chunk from a region buffer.
enum ChunkParse {
    Colors(ChunkColors),
    /// Legitimately nothing to draw — no sector allocated, or a valid chunk with no
    /// terrain yet (e.g. `structure_starts`). Safe to render transparent and cache.
    Absent,
    /// Chunk IS present but unreadable — offset/length past EOF, or the payload won't
    /// decompress/parse. That means Minecraft is mid-flush (region writes are
    /// non-atomic). The tile must NOT be frozen from this read; re-render when settled.
    Torn,
}

fn parse_chunk_colors(
    file_buf: &[u8],
    local_x: usize,
    local_z: usize,
    hide_water: bool,
    cave_y: Option<i32>,
    cave_scan_low: i32,
    cave_scan_high: i32,
) -> ChunkParse {
    let header_offset = 4 * (local_x + local_z * 32);
    if header_offset + 4 > file_buf.len() {
        return ChunkParse::Absent;
    }

    let sector_offset = ((file_buf[header_offset] as usize) << 16)
        | ((file_buf[header_offset + 1] as usize) << 8)
        | (file_buf[header_offset + 2] as usize);
    let sector_count = file_buf[header_offset + 3] as usize;

    if sector_offset == 0 || sector_count == 0 {
        return ChunkParse::Absent; // no sector allocated → chunk genuinely not here
    }

    let byte_offset = sector_offset * 4096;
    if byte_offset + 5 > file_buf.len() {
        return ChunkParse::Torn; // offset points past EOF → sectors mid-write
    }

    let data_len = u32::from_be_bytes([
        file_buf[byte_offset],
        file_buf[byte_offset + 1],
        file_buf[byte_offset + 2],
        file_buf[byte_offset + 3],
    ]) as usize;
    let compression = file_buf[byte_offset + 4];

    if data_len <= 1 {
        return ChunkParse::Torn; // allocated sector but no payload yet
    }

    let data_end = byte_offset + 5 + (data_len - 1);
    if data_end > file_buf.len() {
        return ChunkParse::Torn; // length header claims more than the file holds
    }

    let compressed = &file_buf[byte_offset + 5..data_end];
    let Some(raw) = decompress_chunk(compressed, compression) else {
        return ChunkParse::Torn; // payload won't decompress → half-written
    };
    let Ok(chunk_val) = fastnbt::from_bytes::<Value>(&raw) else {
        return ChunkParse::Torn; // decompressed but not valid NBT → half-written
    };

    let surface = extract_surface(&chunk_val, hide_water, cave_y, cave_scan_low, cave_scan_high);
    if surface.is_empty() {
        return ChunkParse::Absent; // valid chunk, just no terrain to draw yet
    }

    let mut rgba = vec![0u8; 16 * 16 * 4];
    for (i, (name, y, biome)) in surface.iter().enumerate() {
        if name.is_empty() {
            continue; // alpha = 0 → transparent (no data)
        }
        let base = if let Some(rest) = name.strip_prefix("minecraft:") { rest } else { name };
        let [r, g, b] = block_name_to_rgb_in_biome(base, *y, biome);
        rgba[i * 4]     = r;
        rgba[i * 4 + 1] = g;
        rgba[i * 4 + 2] = b;
        // Alpha encodes surface Y for hillshading: clamp(y + 64, 1, 255)
        rgba[i * 4 + 3] = ((y + 64).clamp(1, 255)) as u8;
    }

    ChunkParse::Colors(rgba)
}

// ── Cave entrance detection ───────────────────────────────────────────────────

/// Returns how much any column's solid floor dips below the chunk's highest solid point.
///
/// Uses OCEAN_FLOOR (strictly solid blocks — skips all foliage, vines, water) instead of
/// WORLD_SURFACE vs MOTION_BLOCKING.  The old WS-MB approach flagged any tall vegetation
/// (jungle canopy, vines) as a cave entrance because leaves/vines appear in WS but not MB.
///
/// New approach: find max(OCEAN_FLOOR) across the chunk (= terrain surface peak), then
/// report max(peak - col_OF).  A column under a leaf canopy has OF = solid ground = peak,
/// so delta = 0.  A ravine or cave-entrance column has OF = cavity floor, well below peak.
fn extract_heightmap_delta(chunk: &Value) -> i32 {
    let root = if get(chunk, "Status").is_some() {
        chunk
    } else if let Some(level) = get(chunk, "Level") {
        level
    } else {
        return -1;
    };

    let status = get(root, "Status").and_then(as_str).unwrap_or("");
    if !status.contains("full") && status != "minecraft:full" {
        return -1;
    }

    let hm = match get(root, "Heightmaps") {
        Some(h) => h,
        None => return -1,
    };
    let of_longs = match get(hm, "OCEAN_FLOOR").and_then(as_long_array) {
        Some(l) if l.len() >= 37 => l,
        _ => return -1,
    };

    let mut peak = 0i32;
    for col in 0..256usize {
        let v = unpack_long(of_longs, col, 9) as i32;
        if v > peak { peak = v; }
    }

    let mut max_delta = 0i32;
    for col in 0..256usize {
        let v     = unpack_long(of_longs, col, 9) as i32;
        let delta = (peak - v).max(0);
        if delta > max_delta { max_delta = delta; }
    }
    max_delta
}

/// Read InhabitedTime for a rectangular chunk range.
/// Returns a flat Vec<i64> in row-major order: index = (cz-cz0)*width + (cx-cx0).
/// -1 means the chunk is absent (region file missing or chunk slot empty).
pub fn get_inhabited_times_from_mca(
    world_dir: &str,
    dimension: &str,
    cx0: i32, cz0: i32, cx1: i32, cz1: i32,
) -> Vec<i64> {
    let width  = (cx1 - cx0 + 1) as usize;
    let height = (cz1 - cz0 + 1) as usize;
    let mut out = vec![-1i64; width * height];

    let mut by_region: HashMap<(i32, i32), Vec<(i32, i32)>> = HashMap::new();
    for cz in cz0..=cz1 {
        for cx in cx0..=cx1 {
            by_region.entry((cx.div_euclid(32), cz.div_euclid(32))).or_default().push((cx, cz));
        }
    }

    for ((rx, rz), region_chunks) in &by_region {
        let Some(mca_path) = find_region_file(world_dir, dimension, *rx, *rz) else { continue };
        let file_buf = match std::fs::read(&mca_path) {
            Ok(b) if b.len() >= 4096 => b,
            _ => continue,
        };
        for &(cx, cz) in region_chunks {
            let lx = cx.rem_euclid(32) as usize;
            let lz = cz.rem_euclid(32) as usize;
            let time = read_chunk_nbt(&file_buf, lx, lz)
                .map(|v| get(&v, "InhabitedTime").and_then(as_i64).unwrap_or(0))
                .unwrap_or(-1);
            out[(cz - cz0) as usize * width + (cx - cx0) as usize] = time;
        }
    }

    out
}

/// Read per-chunk max(WORLD_SURFACE - MOTION_BLOCKING) for a rectangular chunk range.
/// Returns a flat Vec<i32> in row-major (cz-major) order: index = (cz-cz0)*width + (cx-cx0).
/// -1 means the chunk is absent or not fully generated.
pub fn get_cave_entrances_from_mca(
    world_dir: &str,
    dimension: &str,
    cx0: i32, cz0: i32, cx1: i32, cz1: i32,
) -> Vec<i32> {
    let width  = (cx1 - cx0 + 1) as usize;
    let height = (cz1 - cz0 + 1) as usize;
    let mut out = vec![-1i32; width * height];

    let mut by_region: HashMap<(i32, i32), Vec<(i32, i32)>> = HashMap::new();
    for cz in cz0..=cz1 {
        for cx in cx0..=cx1 {
            by_region.entry((cx.div_euclid(32), cz.div_euclid(32))).or_default().push((cx, cz));
        }
    }

    for ((rx, rz), region_chunks) in &by_region {
        let Some(mca_path) = find_region_file(world_dir, dimension, *rx, *rz) else { continue };
        let file_buf = match std::fs::read(&mca_path) {
            Ok(b) if b.len() >= 4096 => b,
            _ => continue,
        };
        for &(cx, cz) in region_chunks {
            let lx = cx.rem_euclid(32) as usize;
            let lz = cz.rem_euclid(32) as usize;
            let delta = read_chunk_nbt(&file_buf, lx, lz)
                .map(|v| extract_heightmap_delta(&v))
                .unwrap_or(-1);
            out[(cz - cz0) as usize * width + (cx - cx0) as usize] = delta;
        }
    }

    out
}

// ── Public API ────────────────────────────────────────────────────────────────

#[derive(serde::Deserialize, Clone)]
pub struct ChunkRequest {
    pub cx: i32,
    pub cz: i32,
}

#[derive(serde::Serialize)]
pub struct ChunkResult {
    pub cx:     i32,
    pub cz:     i32,
    pub colors: Option<Vec<u8>>, // base64-encoded by Tauri serialisation
    /// True when the chunk is present on disk but was read torn (Minecraft mid-flush).
    /// The tile renderer uses this to avoid freezing an incomplete render into cache.
    pub torn:   bool,
}

/// Read chunk colors directly from .mca, no caching.
/// This is the core I/O function; caching is handled by the command layer.
pub fn read_chunk_colors_from_mca(
    world_dir: &str,
    dimension: &str,
    chunks: &[ChunkRequest],
    hide_water: bool,
    cave_y: Option<i32>,
    cave_scan_low: i32,
    cave_scan_high: i32,
) -> Vec<ChunkResult> {
    // Group by region file
    let mut by_region: HashMap<(i32, i32), Vec<&ChunkRequest>> = HashMap::new();
    for req in chunks {
        let rx = req.cx.div_euclid(32);
        let rz = req.cz.div_euclid(32);
        by_region.entry((rx, rz)).or_default().push(req);
    }

    // (colors, torn) per chunk
    let mut results: HashMap<(i32, i32), (Option<Vec<u8>>, bool)> = HashMap::new();

    for ((rx, rz), region_chunks) in &by_region {
        let Some(mca_path) = find_region_file(world_dir, dimension, *rx, *rz) else {
            for req in region_chunks {
                results.insert((req.cx, req.cz), (None, false)); // no file → genuinely absent
            }
            continue;
        };

        // Read the whole region file once — stable snapshot even if MC is writing
        let file_buf = match std::fs::read(&mca_path) {
            Ok(b) if b.len() >= 4096 => b,
            _ => {
                // File exists but is unreadable / smaller than its headers → mid-write.
                for req in region_chunks {
                    results.insert((req.cx, req.cz), (None, true));
                }
                continue;
            }
        };

        for req in region_chunks {
            let lx = req.cx.rem_euclid(32) as usize;
            let lz = req.cz.rem_euclid(32) as usize;
            let entry = match parse_chunk_colors(&file_buf, lx, lz, hide_water, cave_y, cave_scan_low, cave_scan_high) {
                ChunkParse::Colors(c) => (Some(c), false),
                ChunkParse::Absent    => (None, false),
                ChunkParse::Torn      => (None, true),
            };
            results.insert((req.cx, req.cz), entry);
        }
    }

    chunks
        .iter()
        .map(|req| {
            let (colors, torn) = results.remove(&(req.cx, req.cz)).unwrap_or((None, false));
            ChunkResult { cx: req.cx, cz: req.cz, colors, torn }
        })
        .collect()
}

/// Read block name, InhabitedTime, and optional local difficulty for a world column.
pub fn get_chunk_info_from_mca(
    world_dir: &str,
    dimension: &str,
    hide_water: bool,
    cave_y: Option<i32>,
    cave_scan_low: i32,
    cave_scan_high: i32,
    block_x: i32,
    block_z: i32,
    game_difficulty: Option<i32>,
    world_time: Option<i64>,
) -> ChunkInfo {
    let cx = block_x.div_euclid(16);
    let cz = block_z.div_euclid(16);
    let rx = cx.div_euclid(32);
    let rz = cz.div_euclid(32);

    let null = ChunkInfo { block_name: None, inhabited_time: None, special_multiplier: None, regional_difficulty: None, block_y: None };

    let mca_path = match find_region_file(world_dir, dimension, rx, rz) {
        Some(p) => p,
        None => return null,
    };
    let file_buf = match std::fs::read(&mca_path) {
        Ok(b) if b.len() >= 4096 => b,
        _ => return null,
    };

    let lx = cx.rem_euclid(32) as usize;
    let lz = cz.rem_euclid(32) as usize;

    let header_offset = 4 * (lx + lz * 32);
    let sector_offset = ((file_buf[header_offset] as usize) << 16)
        | ((file_buf[header_offset + 1] as usize) << 8)
        | (file_buf[header_offset + 2] as usize);
    let sector_count = file_buf[header_offset + 3] as usize;
    if sector_offset == 0 || sector_count == 0 {
        return null;
    }

    let byte_offset = sector_offset * 4096;
    if byte_offset + 5 > file_buf.len() {
        return null;
    }

    let data_len = u32::from_be_bytes([
        file_buf[byte_offset],
        file_buf[byte_offset + 1],
        file_buf[byte_offset + 2],
        file_buf[byte_offset + 3],
    ]) as usize;
    let compression = file_buf[byte_offset + 4];
    if data_len <= 1 {
        return null;
    }
    let data_end = byte_offset + 5 + (data_len - 1);
    if data_end > file_buf.len() {
        return null;
    }

    let raw = match decompress_chunk(&file_buf[byte_offset + 5..data_end], compression) {
        Some(r) => r,
        None => return null,
    };
    let chunk_val: Value = match fastnbt::from_bytes(&raw) {
        Ok(v) => v,
        Err(_) => return null,
    };

    let inhabited_time = get(&chunk_val, "InhabitedTime").and_then(as_i64);

    let (special_multiplier, regional_difficulty) = match (game_difficulty, world_time, inhabited_time) {
        (Some(gd), Some(wt), Some(it)) => {
            let (s, r) = compute_local_difficulty(gd, wt, it);
            (Some(s), Some(r))
        }
        _ => (None, None),
    };

    let surface = extract_surface(&chunk_val, hide_water, cave_y, cave_scan_low, cave_scan_high);
    let surface_entry = surface.get(block_z.rem_euclid(16) as usize * 16 + block_x.rem_euclid(16) as usize);
    let block_name = surface_entry
        .and_then(|(name, _, _)| if name.is_empty() { None } else { Some(name.as_str()) })
        .map(|name| name.strip_prefix("minecraft:").unwrap_or(name).to_string());
    let block_y = surface_entry
        .and_then(|(name, y, _)| if name.is_empty() { None } else { Some(*y) });

    ChunkInfo { block_name, inhabited_time, special_multiplier, regional_difficulty, block_y }
}
