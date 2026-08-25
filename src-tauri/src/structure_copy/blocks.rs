//! Block-level read/write (arbitrary axis-aligned box) and the `copy_blocks`
//! command tying it to `rotation.rs`'s transform.
//!
//! Unlike v0-v2 (whole NBT subtrees, no content understanding needed), this
//! only understands the modern (1.18+) flat `sections`/`block_states` chunk
//! format. A destination chunk missing `sections` is skipped with a reason;
//! a source chunk missing it reads as air (rolled into `source_air_assumed`,
//! indistinguishable from "chunk not generated").

use super::rotation::{self, Dims, Mirror, Rotation};
use crate::region_reader;
use fastnbt::Value;
use serde::Serialize;
use std::collections::HashMap;
use tauri::Manager;

/// Local position -> canonical `{"id": ..., ["properties": ...]}` `Value` —
/// the shape both `extract_box` and `templates::parse_structure_nbt`
/// produce, regardless of source.
pub(super) type BlockMap = HashMap<(i32, i32, i32), Value>;
/// `(local_x, local_y, local_z, compound)` — a `Vec`, not keyed by position,
/// since block entities are sparse and only need iteration.
pub(super) type BlockEntityList = Vec<(i32, i32, i32, Value)>;

const AIR: &str = "minecraft:air";

// "id", not "Name" — this game version's palette codec only recognizes a
// bare string or a compound keyed by "id" (see canonicalize_block below).
// pub(super): also templates.rs's default for a structure-file cell missing
// an explicit block, so both modules' notion of "air" stays identical.
pub(super) fn air_block() -> Value {
    let mut m = HashMap::new();
    m.insert("id".to_string(), Value::String(AIR.to_string()));
    Value::Compound(m)
}

fn as_i32(v: Option<&Value>) -> Option<i32> {
    match v {
        Some(Value::Byte(n)) => Some(*n as i32),
        Some(Value::Short(n)) => Some(*n as i32),
        Some(Value::Int(n)) => Some(*n),
        _ => None,
    }
}

// Every known on-disk shape for a palette entry — mirrors region_reader.rs's
// BLOCK_NAME_KEYS (a section that's entirely one default-state block is a
// bare TAG_String with no wrapper compound; a mixed list uses `id`/
// `properties` for entries that have properties, `""` for ones that don't).
// `parse_section` only needs the name; block-level read/write needs the
// full entry (`Properties` included), hence canonicalize_block below.
const BLOCK_NAME_KEYS: &[&str] = &["Name", "id", ""];
const PROPERTIES_KEYS: &[&str] = &["Properties", "properties"];

/// Normalizes any on-disk palette-entry shape into the one canonical form
/// (`{"id": ..., ["properties": ...]}`) the rest of the pipeline operates
/// on, so differently-encoded but semantically identical blocks compare equal.
///
/// Output uses lowercase `id`/`properties`, not `Name`/`Properties`: this
/// game version's palette codec only accepts a bare string or a compound
/// keyed by `id` — `Name` is a legacy read-only alias (still in
/// BLOCK_NAME_KEYS for reading old saves) that the writer must never emit,
/// confirmed via a real client load failure. A shape matching none of the
/// known aliases is reported via `format_warn` and read as air.
fn canonicalize_block(entry: &Value) -> Value {
    let Some(name) = crate::format_guard::resolve_aliased_str(entry, BLOCK_NAME_KEYS) else {
        crate::format_guard::format_warn(
            "block palette entry (v3 block-level read)",
            &format!("didn't match any known shape (bare string / Name / id / \"\"): {entry:?} — read as air"),
        );
        return air_block();
    };
    let mut m = HashMap::new();
    m.insert("id".to_string(), Value::String(name.to_string()));
    if let Value::Compound(em) = entry {
        for key in PROPERTIES_KEYS {
            if let Some(Value::Compound(props)) = em.get(*key) {
                m.insert("properties".to_string(), Value::Compound(props.clone()));
                break;
            }
        }
    }
    Value::Compound(m)
}

/// One block's full palette entry (name + properties — needed to copy/rotate
/// correctly, unlike the render path), given a section and a LOCAL (0..16)
/// position. Mirrors region_reader.rs's `get_block_name_in_section` (same
/// block-index formula, same `bpv`) but returns the owned, canonicalized `Value`.
fn read_block_in_section(section: &Value, lx: usize, ly: usize, lz: usize) -> Value {
    let Value::Compound(sm) = section else { return air_block() };
    let Some(Value::Compound(bs)) = sm.get("block_states") else { return air_block() };
    let Some(Value::List(palette)) = bs.get("palette") else { return air_block() };
    if palette.is_empty() {
        return air_block();
    }
    if palette.len() == 1 {
        return canonicalize_block(&palette[0]);
    }
    let Some(Value::LongArray(data)) = bs.get("data") else { return canonicalize_block(&palette[0]) };
    let bpv = ((palette.len() as f32).log2().ceil() as u32).max(4);
    let block_idx = ly * 256 + lz * 16 + lx;
    let idx = region_reader::unpack_long(data, block_idx, bpv) as usize;
    palette.get(idx).map(canonicalize_block).unwrap_or_else(air_block)
}

/// Same lookup, given a whole chunk and absolute world coordinates —
/// resolves the containing section first. Missing chunk/section/`sections`
/// key (pre-1.18 format, or not generated) reads as air. pub(super): also
/// used by templates.rs's tests to read back on-disk content after a paste.
pub(super) fn read_block(chunk: &Value, world_x: i32, world_y: i32, world_z: i32) -> Value {
    let Some(root) = super::chunk_root(chunk) else { return air_block() };
    let Some(Value::List(sections)) = root.get("sections") else { return air_block() };
    let sec_y = world_y.div_euclid(16);
    let Some(section) = sections.iter().find(|s| super::section_y(s) == Some(sec_y)) else { return air_block() };
    read_block_in_section(
        section,
        world_x.rem_euclid(16) as usize,
        world_y.rem_euclid(16) as usize,
        world_z.rem_euclid(16) as usize,
    )
}

/// Rebuild one section's `block_states` from its existing content overlaid
/// with `overlay` (local (x,y,z) -> block, covering only cells the pasted
/// box intersects — everything else passes through from `existing`
/// unchanged). Full 4096-cell dedup + repack, O(cells × palette size) since
/// `Value` isn't `Hash` — fine for this dev tool's realistic palette sizes.
fn pack_section(existing: Option<&Value>, sec_y: i32, overlay: &HashMap<(usize, usize, usize), Value>) -> Value {
    let mut palette: Vec<Value> = Vec::new();
    let mut indices: Vec<u32> = Vec::with_capacity(4096);
    for i in 0..4096usize {
        let lx = i % 16;
        let lz = (i / 16) % 16;
        let ly = i / 256;
        let cell = overlay.get(&(lx, ly, lz)).cloned().unwrap_or_else(|| {
            existing.map(|s| read_block_in_section(s, lx, ly, lz)).unwrap_or_else(air_block)
        });
        let idx = match palette.iter().position(|p| *p == cell) {
            Some(i) => i,
            None => { palette.push(cell); palette.len() - 1 }
        };
        indices.push(idx as u32);
    }

    let mut block_states = HashMap::new();
    if palette.len() > 1 {
        let bpv = ((palette.len() as f32).log2().ceil() as u32).max(4);
        block_states.insert("data".to_string(), Value::LongArray(fastnbt::LongArray::new(region_reader::pack_long(&indices, bpv))));
    }
    block_states.insert("palette".to_string(), Value::List(palette));

    let mut section = HashMap::new();
    section.insert("Y".to_string(), Value::Byte(sec_y as i8));
    section.insert("block_states".to_string(), Value::Compound(block_states));
    // Biomes travel through untouched — block-level paste never touches them.
    if let Some(Value::Compound(sm)) = existing {
        if let Some(biomes) = sm.get("biomes") {
            section.insert("biomes".to_string(), biomes.clone());
        }
    }
    Value::Compound(section)
}

fn in_box(x: i32, y: i32, z: i32, b: (i32, i32, i32, i32, i32, i32)) -> bool {
    x >= b.0 && x <= b.3 && y >= b.1 && y <= b.4 && z >= b.2 && z <= b.5
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CopyBlocksReport {
    pub blocks_written: usize,
    /// Cells where the source chunk was missing or pre-1.18 — read as air
    /// rather than erroring. Non-zero isn't necessarily wrong, but worth surfacing.
    pub source_air_assumed: usize,
    pub chunks_touched: Vec<(i32, i32)>,
    pub backed_up: Vec<super::BackupEntry>,
    pub skipped: Vec<super::SkippedChunk>,
}

/// Reads every source block + block entity in `box_` into arrays local to
/// the box. Shared with `templates::save_structure_template`, which needs
/// only this (no rotation, no destination write).
pub(super) fn extract_box(
    world_dir: &str,
    dimension: &str,
    box_: (i32, i32, i32, i32, i32, i32), // x0,y0,z0,x1,y1,z1 — any order, sorted below
) -> (Dims, BlockMap, BlockEntityList, usize) {
    let (rx0, ry0, rz0, rx1, ry1, rz1) = box_;
    let (x0, x1) = (rx0.min(rx1), rx0.max(rx1));
    let (y0, y1) = (ry0.min(ry1), ry0.max(ry1));
    let (z0, z1) = (rz0.min(rz1), rz0.max(rz1));
    let dims = Dims { width: x1 - x0 + 1, height: y1 - y0 + 1, depth: z1 - z0 + 1 };

    let mut src_region_cache: HashMap<(i32, i32), Option<Vec<u8>>> = HashMap::new();
    let mut src_chunk_cache: HashMap<(i32, i32), Option<Value>> = HashMap::new();
    let mut blocks: BlockMap = HashMap::with_capacity((dims.width * dims.height * dims.depth).max(0) as usize);
    let mut source_air_assumed = 0usize;

    for lx in 0..dims.width {
        for lz in 0..dims.depth {
            let wx = x0 + lx;
            let wz = z0 + lz;
            let cx = wx.div_euclid(16);
            let cz = wz.div_euclid(16);
            let (rgx, rgz) = (cx.div_euclid(32), cz.div_euclid(32));

            src_region_cache.entry((rgx, rgz)).or_insert_with(|| {
                region_reader::find_region_file(world_dir, dimension, rgx, rgz)
                    .and_then(|p| std::fs::read(p).ok())
            });
            src_chunk_cache.entry((cx, cz)).or_insert_with(|| {
                src_region_cache.get(&(rgx, rgz)).and_then(|b| b.as_ref()).and_then(|buf| {
                    region_reader::read_chunk_nbt(buf, cx.rem_euclid(32) as usize, cz.rem_euclid(32) as usize)
                })
            });
            let chunk = src_chunk_cache.get(&(cx, cz)).and_then(|c| c.as_ref());

            for ly in 0..dims.height {
                let wy = y0 + ly;
                let block = match chunk {
                    Some(c) => read_block(c, wx, wy, wz),
                    None => { source_air_assumed += 1; air_block() }
                };
                blocks.insert((lx, ly, lz), block);
            }
        }
    }

    let mut block_entities: BlockEntityList = Vec::new();
    for chunk in src_chunk_cache.values().flatten() {
        let Some(root) = super::chunk_root(chunk) else { continue };
        let Some(Value::List(list)) = root.get("block_entities") else { continue };
        for entry in list {
            let Value::Compound(be) = entry else { continue };
            let (Some(bx), Some(by), Some(bz)) = (as_i32(be.get("x")), as_i32(be.get("y")), as_i32(be.get("z"))) else { continue };
            if bx >= x0 && bx <= x1 && by >= y0 && by <= y1 && bz >= z0 && bz <= z1 {
                block_entities.push((bx - x0, by - y0, bz - z0, entry.clone()));
            }
        }
    }

    (dims, blocks, block_entities, source_air_assumed)
}

/// Rotates/mirrors block positions and blockstate `properties`, plus block
/// entity positions. Block entities don't carry their own orientation NBT
/// (it lives in the blockstate), so only position is transformed here.
/// Shared between `copy_blocks` and `templates::paste_structure_template`,
/// which both produce the same `(Dims, blocks, block_entities)` shape.
pub(super) fn apply_transform(
    dims: Dims,
    mir: Mirror,
    rot: Rotation,
    blocks: BlockMap,
    block_entities: BlockEntityList,
) -> (BlockMap, BlockEntityList) {
    let mut transformed_blocks: BlockMap = HashMap::with_capacity(blocks.len());
    for ((lx, ly, lz), mut block) in blocks {
        if let Value::Compound(m) = &mut block {
            // lowercase "properties" — canonicalize_block's output shape.
            if let Some(Value::Compound(props)) = m.get_mut("properties") {
                rotation::rotate_properties(props, mir, rot);
            }
        }
        let (nx, ny, nz) = rotation::transform_pos(dims, mir, rot, lx, ly, lz);
        transformed_blocks.insert((nx, ny, nz), block);
    }
    let transformed_block_entities: BlockEntityList = block_entities
        .into_iter()
        .map(|(lx, ly, lz, entry)| {
            let (nx, ny, nz) = rotation::transform_pos(dims, mir, rot, lx, ly, lz);
            (nx, ny, nz, entry)
        })
        .collect();
    (transformed_blocks, transformed_block_entities)
}

/// Buckets already-transformed blocks/block-entities into destination
/// chunks/sections and writes them via v1/v2's Anvil pipeline unchanged.
/// Shared with `templates::paste_structure_template`. Acquires its own
/// session-lock guard so every writing caller goes through here rather than
/// each remembering to lock.
pub(super) fn write_blocks_to_destination(
    app: &tauri::AppHandle,
    dst_world_dir: &str,
    dst_dimension: &str,
    dst_origin: (i32, i32, i32),
    out_dims: Dims,
    transformed_blocks: BlockMap,
    transformed_block_entities: BlockEntityList,
) -> super::Result<CopyBlocksReport> {
    // Held until this function returns — see session_lock's module doc.
    let _dst_lock = super::session_lock::acquire_write_guard(dst_world_dir)?;

    let (dx0, dy0, dz0) = dst_origin;
    let dst_box = (dx0, dy0, dz0, dx0 + out_dims.width - 1, dy0 + out_dims.height - 1, dz0 + out_dims.depth - 1);

    // ── Bucket into destination (chunk -> section -> local overlay) ───────
    type SectionOverlay = HashMap<(usize, usize, usize), Value>;
    let mut overlays: HashMap<(i32, i32), HashMap<i32, SectionOverlay>> = HashMap::new();
    for ((nx, ny, nz), block) in transformed_blocks {
        let (wx, wy, wz) = (dx0 + nx, dy0 + ny, dz0 + nz);
        let (cx, cz) = (wx.div_euclid(16), wz.div_euclid(16));
        overlays.entry((cx, cz)).or_default().entry(wy.div_euclid(16)).or_default()
            .insert((wx.rem_euclid(16) as usize, wy.rem_euclid(16) as usize, wz.rem_euclid(16) as usize), block);
    }
    let mut be_by_chunk: HashMap<(i32, i32), Vec<Value>> = HashMap::new();
    for (nx, ny, nz, mut entry) in transformed_block_entities {
        let (wx, wy, wz) = (dx0 + nx, dy0 + ny, dz0 + nz);
        if let Value::Compound(be) = &mut entry {
            be.insert("x".to_string(), Value::Int(wx));
            be.insert("y".to_string(), Value::Int(wy));
            be.insert("z".to_string(), Value::Int(wz));
        }
        be_by_chunk.entry((wx.div_euclid(16), wz.div_euclid(16))).or_default().push(entry);
    }

    let mut chunks_by_region: HashMap<(i32, i32), Vec<(i32, i32)>> = HashMap::new();
    for &(cx, cz) in overlays.keys() {
        chunks_by_region.entry((cx.div_euclid(32), cz.div_euclid(32))).or_default().push((cx, cz));
    }

    // ── Write, reusing v1/v2's Anvil pipeline unchanged ────────────────────
    let mut chunks_touched = Vec::new();
    let mut backed_up = Vec::new();
    let mut skipped = Vec::new();
    let mut blocks_written = 0usize;

    for (&region, chunk_list) in &chunks_by_region {
        let (dst_dir, existing_bytes) =
            super::resolve_dst_region_for_chunk_write(dst_world_dir, dst_dimension, region.0, region.1)?;

        let mut substitutions: HashMap<(usize, usize), Vec<u8>> = HashMap::new();

        for &(cx, cz) in chunk_list {
            let local_x = cx.rem_euclid(32) as usize;
            let local_z = cz.rem_euclid(32) as usize;

            let Some(mut dest_chunk) = existing_bytes.as_deref()
                .and_then(|buf| region_reader::read_chunk_nbt(buf, local_x, local_z))
            else {
                skipped.push(super::SkippedChunk {
                    chunk: (cx, cz),
                    reason: "Destination chunk not generated — a block-box paste merges into an \
                             existing destination chunk, it can't create one".to_string(),
                });
                continue;
            };
            if !matches!(super::chunk_root(&dest_chunk).map(|r| r.contains_key("sections")), Some(true)) {
                skipped.push(super::SkippedChunk {
                    chunk: (cx, cz),
                    reason: "Destination chunk isn't in the modern (1.18+) section format — block-level \
                             paste doesn't support pre-1.18 chunks".to_string(),
                });
                continue;
            }

            let section_overlays = overlays.get(&(cx, cz)).cloned().unwrap_or_default();
            {
                let Some(root) = super::chunk_root_mut(&mut dest_chunk) else { continue };

                let mut sections = match root.remove("sections") { Some(Value::List(l)) => l, _ => Vec::new() };
                for (&sec_y, overlay) in &section_overlays {
                    let existing_section = sections.iter().find(|s| super::section_y(s) == Some(sec_y)).cloned();
                    sections.retain(|s| super::section_y(s) != Some(sec_y));
                    sections.push(pack_section(existing_section.as_ref(), sec_y, overlay));
                    blocks_written += overlay.len();
                }
                root.insert("sections".to_string(), Value::List(sections));
                root.remove("structures");
                // region_reader.rs's render path trusts a cached Heightmaps
                // tag over real block data when present; removing it forces
                // the proven scan-sections-top-down fallback instead of
                // leaving a stale surface after a column is replaced.
                root.remove("Heightmaps");
                // pack_section rebuilds a touched section without its
                // BlockLight/SkyLight arrays, so isLightOn must be cleared
                // here too — the standard signal telling MC to relight this chunk.
                root.insert("isLightOn".to_string(), Value::Byte(0));

                for key in ["block_entities", "TileEntities"] {
                    let had_key = root.contains_key(key);
                    let mut kept: Vec<Value> = match root.remove(key) {
                        Some(Value::List(l)) => l.into_iter().filter(|e| {
                            let Value::Compound(be) = e else { return true };
                            match (as_i32(be.get("x")), as_i32(be.get("y")), as_i32(be.get("z"))) {
                                (Some(x), Some(y), Some(z)) => !in_box(x, y, z, dst_box),
                                _ => true,
                            }
                        }).collect(),
                        _ => Vec::new(),
                    };
                    if key == "block_entities" {
                        if let Some(entries) = be_by_chunk.get(&(cx, cz)) {
                            kept.extend(entries.iter().cloned());
                        }
                    }
                    if had_key || !kept.is_empty() {
                        root.insert(key.to_string(), Value::List(kept));
                    }
                }
            }

            let payload = match super::encode_chunk_payload(&dest_chunk) {
                Ok(p) => p,
                Err(reason) => { skipped.push(super::SkippedChunk { chunk: (cx, cz), reason }); continue; }
            };
            substitutions.insert((local_x, local_z), payload);
            chunks_touched.push((cx, cz));
        }

        if substitutions.is_empty() {
            continue;
        }
        if let Some(bytes) = &existing_bytes {
            backed_up.push(super::backup_existing_region(dst_world_dir, dst_dimension, region.0, region.1, bytes)?);
        }
        let new_bytes = super::rewrite_region_with_chunks(existing_bytes.as_deref(), &substitutions);

        let final_path = dst_dir.join(format!("r.{}.{}.mca", region.0, region.1));
        let tmp_path = dst_dir.join(format!("r.{}.{}.mca.tmp", region.0, region.1));
        std::fs::write(&tmp_path, &new_bytes).map_err(|e| format!("Couldn't write region file: {e}"))?;
        std::fs::rename(&tmp_path, &final_path).map_err(|e| format!("Couldn't finalize region file: {e}"))?;
    }

    if !chunks_touched.is_empty() {
        let affected_regions: Vec<(i32, i32)> = chunks_by_region.keys().copied().collect();
        let cache_root = app.path().app_cache_dir()
            .map(|p| p.join("tile-cache").join(format!("v{}", crate::tile_renderer::CACHE_VERSION)))
            .unwrap_or_else(|_| std::path::PathBuf::from("/tmp/msm-tile-cache"));
        crate::tile_renderer::invalidate_mca_tiles(&cache_root, dst_world_dir, &affected_regions);
    }

    // source_air_assumed is a source-reading concern (extract_box's), not
    // this function's — the caller fills in the real value.
    Ok(CopyBlocksReport { blocks_written, source_air_assumed: 0, chunks_touched, backed_up, skipped })
}

/// Live source-box → destination-box copy: `extract_box` (read) →
/// `apply_transform` (rotate/mirror) → `write_blocks_to_destination` (write).
/// The command itself is now a thin wrapper — see those three functions for
/// the actual work, shared with `templates::save_structure_template`/
/// `paste_structure_template`.
#[tauri::command]
pub fn copy_blocks(
    app: tauri::AppHandle,
    src_level_dat_path: String,
    src_dimension: String,
    dst_level_dat_path: String,
    dst_dimension: String,
    src_box: (i32, i32, i32, i32, i32, i32), // x0,y0,z0,x1,y1,z1 — any order, sorted in extract_box
    dst_origin: (i32, i32, i32),             // where the transformed box's min corner lands
    rotation_deg: i32,                       // 0 | 90 | 180 | 270
    mirror: Option<String>,                  // "x" | "z" | None
) -> super::Result<CopyBlocksReport> {
    super::check_same_data_version(&src_level_dat_path, &dst_level_dat_path)?;

    let src_world_dir = super::world_dir_of(&src_level_dat_path)?.to_string_lossy().to_string();
    let dst_world_dir = super::world_dir_of(&dst_level_dat_path)?.to_string_lossy().to_string();

    let rot = Rotation::from_degrees(rotation_deg);
    let mir = Mirror::from_str(mirror.as_deref());

    let (dims, blocks, block_entities, source_air_assumed) =
        extract_box(&src_world_dir, &src_dimension, src_box);
    let (transformed_blocks, transformed_block_entities) =
        apply_transform(dims, mir, rot, blocks, block_entities);
    let out_dims = rotation::transformed_dims(dims, rot);

    let report = write_blocks_to_destination(
        &app, &dst_world_dir, &dst_dimension, dst_origin, out_dims,
        transformed_blocks, transformed_block_entities,
    )?;
    Ok(CopyBlocksReport { source_air_assumed, ..report })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Manual real-data check, not CI-safe: confirms `read_block_in_section`
    /// -> `pack_section` (no-op overlay) -> `read_block_in_section` reproduces
    /// a real section's 4096 blocks identically, against real on-disk
    /// palette shapes rather than synthetic ones. Run: `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn read_pack_round_trip_against_real_world_data() {
        // Spread across several real worlds/seeds/versions on this dev
        // machine, to broaden the palette shapes actually exercised.
        let paths = [
            "/home/user/.minecraft/saves/The World (1)/dimensions/minecraft/overworld/region/r.-1.1.mca",
            "/home/user/.minecraft/saves/Ocean-heavy/dimensions/minecraft/overworld/region/r.0.0.mca",
            "/home/user/.minecraft/saves/Ocean-heavy/dimensions/minecraft/overworld/region/r.-1.-1.mca",
            "/home/user/.minecraft/saves/-3358620101066439057/dimensions/minecraft/overworld/region/r.0.20.mca",
        ];
        let mut checked_any = false;
        for path in paths {
            let Ok(buf) = std::fs::read(path) else { continue };
            for (lx, lz) in [(16, 16), (0, 0), (31, 31), (8, 24)] {
                let Some(chunk) = region_reader::read_chunk_nbt(&buf, lx, lz) else { continue };
                let Some(root) = super::super::chunk_root(&chunk) else { continue };
                let Some(Value::List(sections)) = root.get("sections") else { continue };
                for section in sections {
                    let Some(sec_y) = super::super::section_y(section) else { continue };
                    let original: Vec<Value> = (0..4096usize).map(|i| {
                        read_block_in_section(section, i % 16, i / 256, (i / 16) % 16)
                    }).collect();
                    let repacked = pack_section(Some(section), sec_y, &HashMap::new());
                    let round_tripped: Vec<Value> = (0..4096usize).map(|i| {
                        read_block_in_section(&repacked, i % 16, i / 256, (i / 16) % 16)
                    }).collect();
                    assert_eq!(original, round_tripped, "{path} chunk ({lx},{lz}) section Y={sec_y} didn't round-trip identically");
                    checked_any = true;
                }
            }
        }
        assert!(checked_any, "no real chunks with sections were found to check — update the paths above");
    }

    /// Independent post-hoc verification of a real `copy_blocks_cli` run
    /// (ties to this dev machine's specific save; run via `cargo test --
    /// --ignored --nocapture`). Scans the source box for directional-property
    /// blocks, independently recomputes expected position/properties via
    /// `rotation::transform_pos`/`rotate_properties`, and checks the real
    /// on-disk destination bytes agree — not just re-trusting copy_blocks' own report.
    ///
    /// Known comparison gap: if Minecraft later resaves the destination
    /// chunk (e.g. after relighting), it may recompact a block whose rotated
    /// properties equal that type's true default into the compact
    /// empty-key palette form (see `canonicalize_block`) — semantically
    /// identical but a naive equality check here flags it as a mismatch. If
    /// this fails after the destination was reopened in Minecraft, check
    /// whether "expected" is that block type's default before treating it as a regression.
    #[test]
    #[ignore]
    fn verify_sunflower_plains_rotation_result() {
        let region_dir = "/home/user/.minecraft/saves/Sunflower Plains/dimensions/minecraft/overworld/region";
        let (x0, y0, z0, x1, y1, z1) = (72, 62, -26, 121, 186, -9);
        let dims = Dims { width: x1 - x0 + 1, height: y1 - y0 + 1, depth: z1 - z0 + 1 };
        let (rot, mir) = (Rotation::R90, Mirror::None);
        let (dst_x0, dst_y0, dst_z0) = (-48, 62, -48);

        let mut chunk_cache: HashMap<(i32, i32), Option<Value>> = HashMap::new();
        let mut load = |cx: i32, cz: i32| -> Option<Value> {
            chunk_cache.entry((cx, cz)).or_insert_with(|| {
                let (rx, rz) = (cx.div_euclid(32), cz.div_euclid(32));
                std::fs::read(format!("{region_dir}/r.{rx}.{rz}.mca")).ok()
                    .and_then(|buf| region_reader::read_chunk_nbt(&buf, cx.rem_euclid(32) as usize, cz.rem_euclid(32) as usize))
            }).clone()
        };

        let is_directional = |props: &HashMap<String, Value>| {
            props.keys().any(|k| matches!(k.as_str(), "facing" | "axis" | "rotation" | "shape" | "hinge" | "north" | "east" | "south" | "west"))
        };

        let mut checked = 0usize;
        let mut mismatches: Vec<String> = Vec::new();

        for wx in x0..=x1 {
            for wz in z0..=z1 {
                let Some(chunk) = load(wx.div_euclid(16), wz.div_euclid(16)) else { continue };
                for wy in y0..=y1 {
                    let src_block = read_block(&chunk, wx, wy, wz);
                    let Value::Compound(m) = &src_block else { continue };
                    // read_block always returns canonicalized entries.
                    let Some(Value::Compound(props)) = m.get("properties") else { continue };
                    if !is_directional(props) { continue }

                    let (lx, ly, lz) = (wx - x0, wy - y0, wz - z0);
                    let (nlx, nly, nlz) = rotation::transform_pos(dims, mir, rot, lx, ly, lz);
                    let mut expected_props = props.clone();
                    rotation::rotate_properties(&mut expected_props, mir, rot);
                    let expected_name = m.get("id").cloned();

                    let (dwx, dwy, dwz) = (dst_x0 + nlx, dst_y0 + nly, dst_z0 + nlz);
                    let Some(dchunk) = load(dwx.div_euclid(16), dwz.div_euclid(16)) else {
                        mismatches.push(format!("no destination chunk for {dwx},{dwy},{dwz}"));
                        continue;
                    };
                    let actual = read_block(&dchunk, dwx, dwy, dwz);
                    let Value::Compound(am) = &actual else {
                        mismatches.push(format!("destination block at {dwx},{dwy},{dwz} wasn't a compound"));
                        continue;
                    };
                    let actual_name = am.get("id").cloned();
                    let actual_props = am.get("properties").cloned();
                    let expected_props_val = Some(Value::Compound(expected_props));
                    if actual_name != expected_name || actual_props != expected_props_val {
                        mismatches.push(format!(
                            "src({wx},{wy},{wz}) -> dst({dwx},{dwy},{dwz}): expected {expected_name:?} {expected_props_val:?}, got {actual_name:?} {actual_props:?}"
                        ));
                    }
                    checked += 1;
                }
            }
        }

        println!("checked {checked} directional blocks, {} mismatches", mismatches.len());
        for m in mismatches.iter().take(20) {
            println!("{m}");
        }
        assert!(checked > 0, "no directional blocks found in the source box — nothing was actually verified");
        assert!(mismatches.is_empty(), "{} mismatches out of {checked} checked", mismatches.len());
    }

    /// Companion to `verify_sunflower_plains_rotation_result`: every chunk
    /// NOT in the box's footprint should pass through `rewrite_region_with_chunks`
    /// byte-for-byte unchanged, checked against the pre-copy backup.
    ///
    /// Only valid immediately after a fresh `copy_blocks_cli` run with
    /// nothing else touching the world — a Minecraft client left open with
    /// the world loaded will legitimately relight/resave nearby chunks on
    /// its own, which shows up here as false-positive diffs unrelated to `copy_blocks`.
    #[test]
    #[ignore]
    fn untouched_chunks_pass_through_unchanged() {
        let touched: [(i32, i32); 8] = [(-2,0),(-3,0),(-2,-2),(-3,-3),(-3,-2),(-2,-1),(-3,-1),(-2,-3)];
        let cases = [
            ("/home/user/.minecraft/saves/Sunflower Plains/dimensions/minecraft/overworld/region/r.-1.0.mca",
             "/home/user/.minecraft/saves/Sunflower Plains/sojourner-backups/overworld/r.-1.0.1787642116.mca.bak",
             (-1i32, 0i32)),
            ("/home/user/.minecraft/saves/Sunflower Plains/dimensions/minecraft/overworld/region/r.-1.-1.mca",
             "/home/user/.minecraft/saves/Sunflower Plains/sojourner-backups/overworld/r.-1.-1.1787642116.mca.bak",
             (-1i32, -1i32)),
        ];
        let mut diffs = Vec::new();
        let mut same = 0usize;
        let mut both_absent = 0usize;
        for (current_path, backup_path, (rx, rz)) in cases {
            let current = std::fs::read(current_path).unwrap();
            let backup = std::fs::read(backup_path).unwrap();
            for lz in 0..32usize {
                for lx in 0..32usize {
                    let cx = rx * 32 + lx as i32;
                    let cz = rz * 32 + lz as i32;
                    if touched.contains(&(cx, cz)) { continue }
                    let cur_payload = region_reader::read_chunk_raw_payload(&current, lx, lz);
                    let bak_payload = region_reader::read_chunk_raw_payload(&backup, lx, lz);
                    match (cur_payload, bak_payload) {
                        (None, None) => both_absent += 1,
                        (Some(a), Some(b)) if a == b => same += 1,
                        (a, b) => diffs.push(format!(
                            "chunk ({cx},{cz}) in {current_path}: current={:?} bytes, backup={:?} bytes -- DIFFERS",
                            a.map(|v| v.len()), b.map(|v| v.len())
                        )),
                    }
                }
            }
        }
        println!("same={same} both_absent={both_absent} diffs={}", diffs.len());
        for d in diffs.iter().take(30) { println!("{d}"); }
        assert!(diffs.is_empty(), "{} untouched chunks differ from backup", diffs.len());
    }
}
