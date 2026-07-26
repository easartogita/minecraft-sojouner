// Bedrock Edition chunk reader.
//
// Reads block data from a Bedrock world's LevelDB database, finds the surface
// block per column, and returns ChunkColors in the same format as the Java
// region reader so tile_renderer.rs can consume both without modification.

use super::leveldb::LdbDatabase;
use crate::block_colors::{block_name_to_rgb, normalize_bedrock_block};
use crate::region_reader::{ChunkInfo, ChunkResult};

pub type ChunkColors = Vec<u8>; // 16×16×4 RGBA, alpha encodes Y

// ── LevelDB key helpers ──────────────────────────────────────────────────────

/// Dimension integers as stored in Bedrock LevelDB keys (not the same as Java).
/// 0=overworld (key has no dim bytes), 1=nether, 2=end.
pub fn dim_str_to_bedrock(dimension: &str) -> i32 {
    match dimension {
        "nether" => 1,
        "end"    => 2,
        _        => 0,
    }
}

pub fn chunk_key_prefix(cx: i32, cz: i32, dim: i32) -> Vec<u8> {
    let mut k = Vec::with_capacity(12);
    k.extend_from_slice(&cx.to_le_bytes());
    k.extend_from_slice(&cz.to_le_bytes());
    if dim != 0 {
        k.extend_from_slice(&dim.to_le_bytes());
    }
    k
}

fn subchunk_key(cx: i32, cz: i32, dim: i32, sy: i8) -> Vec<u8> {
    let mut k = chunk_key_prefix(cx, cz, dim);
    k.push(0x2f);
    k.push(sy as u8);
    k
}


// ── Subchunk parsing ─────────────────────────────────────────────────────────

/// One storage layer within a subchunk.
struct PaletteLayer {
    bpb:     u8,         // bits per block (0 = single-value)
    palette: Vec<String>, // normalized block names
    words:   Vec<u32>,
}

struct Subchunk {
    layers: Vec<PaletteLayer>,
}

fn parse_subchunk(data: &[u8]) -> Option<Subchunk> {
    if data.len() < 2 { return None; }
    let version = data[0];
    if version != 1 && version != 8 && version != 9 { return None; }

    let num_layers = if version >= 8 { data[1] as usize } else { 1 };
    let mut pos = if version >= 8 { 2 } else { 1 };

    let mut layers = Vec::with_capacity(num_layers);

    for _ in 0..num_layers {
        if pos >= data.len() { break; }

        let bits_raw = data[pos]; pos += 1;
        // Bit 0 of bits_raw is a "use network bit format" flag; actual bpb = bits_raw >> 1
        let bpb = bits_raw >> 1;

        // Valid Bedrock bpb values top out at 32 (one value per word); a corrupt
        // or adversarial subchunk byte can claim up to 127 (bits_raw >> 1), which
        // would make vals_per_word floor to 0 and panic on the division below.
        if bpb > 32 { return None; }

        let words_count = if bpb == 0 {
            0
        } else {
            // Each 32-bit word holds floor(32/bpb) values, no cross-word packing
            let vals_per_word = 32 / bpb as usize;
            (4096 + vals_per_word - 1) / vals_per_word
        };

        let words_bytes = words_count * 4;
        if pos + words_bytes > data.len() { return None; }

        let mut words = Vec::with_capacity(words_count);
        for i in 0..words_count {
            words.push(u32::from_le_bytes(data[pos + i*4..pos + i*4 + 4].try_into().ok()?));
        }
        pos += words_bytes;

        // Palette count (LE i32)
        if pos + 4 > data.len() { return None; }
        let pal_count = i32::from_le_bytes(data[pos..pos+4].try_into().ok()?) as usize;
        pos += 4;

        let mut palette = Vec::with_capacity(pal_count);
        for _ in 0..pal_count {
            if pos >= data.len() { break; }
            // Each palette entry is a LE NBT TAG_Compound (tag=10, name="", then payload)
            if data[pos] != 10 { break; }
            pos += 1; // tag byte
            // Name: 2-byte LE length + bytes
            if pos + 2 > data.len() { break; }
            let name_len = u16::from_le_bytes([data[pos], data[pos+1]]) as usize;
            pos += 2 + name_len;
            if pos > data.len() { break; }

            // Parse the compound payload to extract "name" field
            let remaining = &data[pos..];
            let (block_name, consumed) = extract_palette_entry_name(remaining);
            pos += consumed;
            palette.push(block_name);
        }

        layers.push(PaletteLayer { bpb, palette, words });
    }

    Some(Subchunk { layers })
}

/// Parse a Bedrock palette entry compound, returning (block_name, bytes_consumed).
/// We only need the "name" field; everything else is skipped via the LE NBT reader.
fn extract_palette_entry_name(data: &[u8]) -> (String, usize) {
    use std::io::{Cursor, Read};

    fn read_le_u16(cur: &mut Cursor<&[u8]>) -> Option<usize> {
        let mut b = [0u8; 2]; cur.read_exact(&mut b).ok()?;
        Some(u16::from_le_bytes(b) as usize)
    }
    fn read_le_i32(cur: &mut Cursor<&[u8]>) -> Option<i32> {
        let mut b = [0u8; 4]; cur.read_exact(&mut b).ok()?;
        Some(i32::from_le_bytes(b))
    }
    fn skip_payload(cur: &mut Cursor<&[u8]>, tag: u8) {
        use std::io::{Seek, SeekFrom};
        match tag {
            1 => { let _ = cur.seek(SeekFrom::Current(1)); }
            2 => { let _ = cur.seek(SeekFrom::Current(2)); }
            3 | 5 => { let _ = cur.seek(SeekFrom::Current(4)); }
            4 | 6 => { let _ = cur.seek(SeekFrom::Current(8)); }
            7 => if let Some(n) = read_le_i32(cur) { let _ = cur.seek(SeekFrom::Current(n.max(0) as i64)); }
            8 => if let Some(n) = read_le_u16(cur) { let _ = cur.seek(SeekFrom::Current(n as i64)); }
            9 => {
                let mut b = [0u8; 1];
                let elem_tag = cur.read_exact(&mut b).ok().map(|_| b[0]).unwrap_or(0);
                if let Some(count) = read_le_i32(cur) {
                    for _ in 0..count.max(0) { skip_payload(cur, elem_tag); }
                }
            }
            10 => { // compound
                loop {
                    let mut b = [0u8; 1];
                    if cur.read_exact(&mut b).is_err() { break; }
                    let t = b[0];
                    if t == 0 { break; }
                    if let Some(n) = read_le_u16(cur) { let _ = cur.seek(SeekFrom::Current(n as i64)); }
                    skip_payload(cur, t);
                }
            }
            11 => if let Some(n) = read_le_i32(cur) { let _ = cur.seek(SeekFrom::Current((n.max(0) * 4) as i64)); }
            12 => if let Some(n) = read_le_i32(cur) { let _ = cur.seek(SeekFrom::Current((n.max(0) * 8) as i64)); }
            _ => {}
        }
    }

    let mut cur = Cursor::new(data);
    let mut found_name: Option<String> = None;

    loop {
        let mut tag_buf = [0u8; 1];
        if cur.read_exact(&mut tag_buf).is_err() { break; }
        let tag = tag_buf[0];
        if tag == 0 { break; } // TAG_End

        // Field name
        let Some(name_len) = read_le_u16(&mut cur) else { break };
        let mut name_bytes = vec![0u8; name_len];
        if cur.read_exact(&mut name_bytes).is_err() { break; }
        let field_name = String::from_utf8_lossy(&name_bytes);

        if field_name == "name" && tag == 8 {
            let Some(str_len) = read_le_u16(&mut cur) else { break };
            let mut str_bytes = vec![0u8; str_len];
            if cur.read_exact(&mut str_bytes).is_err() { break; }
            found_name = Some(String::from_utf8_lossy(&str_bytes).into_owned());
        } else {
            skip_payload(&mut cur, tag);
        }
    }

    let consumed = cur.position() as usize;
    let name = found_name.unwrap_or_else(|| "air".to_string());
    // Strip "minecraft:" prefix and normalize
    let stripped = name.strip_prefix("minecraft:").unwrap_or(&name);
    let normalized = normalize_bedrock_block(stripped).to_string();
    (normalized, consumed)
}

fn get_block_in_layer(layer: &PaletteLayer, local_y: usize, bx: usize, bz: usize) -> &str {
    if layer.palette.is_empty() { return "air"; }
    if layer.bpb == 0 || layer.bpb > 32 {
        return layer.palette.get(0).map(|s| s.as_str()).unwrap_or("air");
    }

    let bpb = layer.bpb as usize;
    let vals_per_word = 32 / bpb;
    let block_idx = local_y * 256 + bz * 16 + bx;
    let word_idx  = block_idx / vals_per_word;
    let bit_off   = (block_idx % vals_per_word) * bpb;
    let mask      = (1u32 << bpb) - 1;

    let pal_idx = if word_idx < layer.words.len() {
        ((layer.words[word_idx] >> bit_off) & mask) as usize
    } else {
        0
    };

    layer.palette.get(pal_idx).map(|s| s.as_str()).unwrap_or("air")
}

// ── Surface finding ──────────────────────────────────────────────────────────

const AIR_BLOCKS: &[&str] = &["air", "cave_air", "void_air"];

fn is_air(name: &str) -> bool {
    AIR_BLOCKS.contains(&name)
}

fn is_water_block(name: &str) -> bool {
    name == "water" || name == "flowing_water"
}

/// Find the surface block for each of 256 columns in a chunk.
/// Returns a Vec<(block_name, global_y)> of length 256, indexed by bz*16+bx.
/// Empty string means "no block found (fully air or chunk missing)".
pub fn extract_bedrock_surface(
    db:             &LdbDatabase,
    cx:             i32,
    cz:             i32,
    dim:            i32,
    hide_water:     bool,
    cave_y:         Option<i32>,
    _cave_scan_low:  i32,
    _cave_scan_high: i32,
) -> Vec<(String, i32)> {
    let mut surface = vec![("".to_string(), 0i32); 256];
    let mut found   = vec![false; 256];

    // Overworld Y range: subchunk indices -4 to 20 (Y -64 to 319)
    // Nether: 0 to 7 (Y 0 to 127)
    // End:    0 to 15 (Y 0 to 255), but only 0-7 actually have blocks
    let (sy_top, sy_bot) = match dim {
        1 => (7i8, 0i8),  // Nether
        2 => (15i8, 0i8), // End
        _ => (20i8, -4i8), // Overworld
    };

    // For cave mode, determine target Y range
    let cave_target = cave_y;

    // Iterate subchunks top-to-bottom
    let mut sy = sy_top;
    loop {
        // If all columns filled, done
        if found.iter().all(|&f| f) { break; }

        let key = subchunk_key(cx, cz, dim, sy);
        if let Some(data) = db.get(&key) {
            if let Some(sc) = parse_subchunk(&data) {
                if !sc.layers.is_empty() {
                    let layer = &sc.layers[0];
                    // Scan local_y from top (15) to bottom (0)
                    for local_y in (0..=15usize).rev() {
                        let global_y = sy as i32 * 16 + local_y as i32;

                        // Cave mode: only scan within the cave window
                        if let Some(cy) = cave_target {
                            if global_y > cy { continue; }
                        }

                        for bz in 0..16usize {
                            for bx in 0..16usize {
                                let col = bz * 16 + bx;
                                if found[col] { continue; }

                                let name = get_block_in_layer(layer, local_y, bx, bz);
                                if is_air(name) { continue; }
                                if hide_water && is_water_block(name) { continue; }

                                surface[col] = (name.to_string(), global_y);
                                found[col] = true;
                            }
                        }
                    }
                }
            }
        }

        if sy == sy_bot { break; }
        sy -= 1;
    }

    surface
}

// ── Public chunk color entry points ─────────────────────────────────────────

pub fn get_bedrock_chunk_colors(
    db:             &LdbDatabase,
    cx:             i32,
    cz:             i32,
    dim:            i32,
    hide_water:     bool,
    cave_y:         Option<i32>,
    cave_scan_low:  i32,
    cave_scan_high: i32,
) -> Option<ChunkColors> {
    let surface = extract_bedrock_surface(
        db, cx, cz, dim, hide_water, cave_y, cave_scan_low, cave_scan_high,
    );

    if surface.iter().all(|(n, _)| n.is_empty()) {
        return None;
    }

    let mut rgba = vec![0u8; 16 * 16 * 4];
    for (i, (name, y)) in surface.iter().enumerate() {
        if name.is_empty() { continue; }
        let [r, g, b] = block_name_to_rgb(name, *y);
        let alpha = (*y + 64).clamp(1, 255) as u8;
        rgba[i*4]     = r;
        rgba[i*4 + 1] = g;
        rgba[i*4 + 2] = b;
        rgba[i*4 + 3] = alpha;
    }
    Some(rgba)
}

/// Bedrock equivalent of `get_chunk_info_from_mca` for hover tooltips.
pub fn get_bedrock_block_at(
    db:             &LdbDatabase,
    dimension:      &str,
    hide_water:     bool,
    cave_y:         Option<i32>,
    cave_scan_low:  i32,
    cave_scan_high: i32,
    block_x:        i32,
    block_z:        i32,
) -> ChunkInfo {
    let cx = block_x.div_euclid(16);
    let cz = block_z.div_euclid(16);
    let dim = dim_str_to_bedrock(dimension);
    let surface = extract_bedrock_surface(
        db, cx, cz, dim, hide_water, cave_y, cave_scan_low, cave_scan_high,
    );
    let bx = block_x.rem_euclid(16) as usize;
    let bz = block_z.rem_euclid(16) as usize;
    let col = bz * 16 + bx;
    let (name, y) = surface.get(col).cloned().unwrap_or_default();
    let name_empty = name.is_empty();
    ChunkInfo {
        block_name:          if name_empty { None } else { Some(name) },
        inhabited_time:      None,
        special_multiplier:  None,
        regional_difficulty: None,
        block_y:             if y == 0 && name_empty { None } else { Some(y) },
    }
}

/// Returns all distinct region coordinates (rx, rz) that contain at least one
/// generated chunk in the given dimension. Used to replace `list_regions` for
/// Bedrock worlds.
pub fn list_bedrock_regions(db: &LdbDatabase, dim: i32) -> Vec<(i32, i32)> {
    use std::collections::HashSet;

    // Prefix for overworld chunks (no dim bytes): 8 bytes or 12 bytes for other dims
    // We iterate all keys and filter by length + tag byte = 0x2f at position 8 or 12
    // This is a full scan but only happens once per world load / export.
    let mut regions: HashSet<(i32, i32)> = HashSet::new();

    let prefix: Vec<u8> = Vec::new(); // scan all keys
    for (key, _) in db.iter_prefix(&prefix) {
        let expected_len = if dim == 0 { 9 } else { 13 }; // prefix + tag(1) = 8/12 + 1
        let tag_pos      = if dim == 0 { 8 } else { 12 };
        // Subchunks have an extra byte for the subchunk Y after the tag
        if key.len() < expected_len { continue; }
        if key[tag_pos] != 0x2f { continue; }
        // Confirm dimension bytes match (for non-overworld)
        if dim != 0 {
            if key.len() < 12 { continue; }
            let key_dim = i32::from_le_bytes(key[8..12].try_into().unwrap_or([0;4]));
            if key_dim != dim { continue; }
        } else if key.len() != expected_len + 1 {
            // Overworld subchunk key is exactly 10 bytes (8 prefix + tag + sy)
            if key.len() != 10 { continue; }
        }

        let cx = i32::from_le_bytes(key[0..4].try_into().unwrap_or([0;4]));
        let cz = i32::from_le_bytes(key[4..8].try_into().unwrap_or([0;4]));
        regions.insert((cx >> 5, cz >> 5));
    }

    regions.into_iter().collect()
}

// ── LevelDB mtime ─────────────────────────────────────────────────────────────

/// Returns the mtime of the most recently modified LevelDB manifest file.
/// Used in place of `max_mca_mtime` for freshness checking on Bedrock tiles.
pub fn max_ldb_mtime(world_dir: &str) -> u64 {
    let db_dir = std::path::Path::new(world_dir).join("db");
    let Ok(entries) = std::fs::read_dir(&db_dir) else { return 0 };
    entries
        .flatten()
        .filter(|e| {
            let name = e.file_name();
            let s = name.to_string_lossy();
            s.ends_with(".ldb") || s.starts_with("MANIFEST") || s == "CURRENT"
        })
        .filter_map(|e| std::fs::metadata(e.path()).ok())
        .filter_map(|m| m.modified().ok())
        .filter_map(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .max()
        .unwrap_or(0)
}

// ── Bulk chunk colors (replaces read_chunk_colors_from_mca) ─────────────────

pub fn read_bedrock_chunk_colors(
    db:             &LdbDatabase,
    dimension:      &str,
    chunks:         &[crate::region_reader::ChunkRequest],
    hide_water:     bool,
    cave_y:         Option<i32>,
    cave_scan_low:  i32,
    cave_scan_high: i32,
) -> Vec<ChunkResult> {
    let dim = dim_str_to_bedrock(dimension);
    chunks.iter().map(|req| {
        let colors = get_bedrock_chunk_colors(
            db, req.cx, req.cz, dim, hide_water, cave_y, cave_scan_low, cave_scan_high,
        );
        // Bedrock reads whole LevelDB values atomically — no torn-read window.
        ChunkResult { cx: req.cx, cz: req.cz, colors, torn: false }
    }).collect()
}
