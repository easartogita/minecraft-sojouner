//! Save/load a block-box selection as a portable, Minecraft-native Structure
//! Block `.nbt` file (gzip-compressed NBT: `DataVersion`, `size`, `palette`,
//! `blocks`, `entities`) — chosen over a bespoke format so a saved template
//! can be dropped into a vanilla Structure Block as a fallback.
//!
//! **Load-bearing schema note**: the structure-file palette uses
//! `Name`/`Properties` (capitalized) — different from chunk `block_states`
//! palettes, which this MC version needs `id`/`properties` (lowercase) for
//! (see `blocks.rs`'s `canonicalize_block`). Two separate NBT schemas;
//! `to_structure_palette_entry`/`from_structure_palette_entry` are the only
//! conversion points, so the distinction doesn't leak elsewhere.

use super::blocks::{air_block, apply_transform, extract_box, write_blocks_to_destination, BlockEntityList, BlockMap, CopyBlocksReport};
use super::rotation::{transformed_dims, Dims, Mirror, Rotation};
use fastnbt::Value;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};

fn to_structure_palette_entry(block: &Value) -> Value {
    let mut m = HashMap::new();
    if let Value::Compound(bm) = block {
        if let Some(name) = bm.get("id") {
            m.insert("Name".to_string(), name.clone());
        }
        if let Some(props) = bm.get("properties") {
            m.insert("Properties".to_string(), props.clone());
        }
    }
    Value::Compound(m)
}

fn from_structure_palette_entry(entry: &Value) -> Value {
    let mut m = HashMap::new();
    if let Value::Compound(em) = entry {
        if let Some(name) = em.get("Name") {
            m.insert("id".to_string(), name.clone());
        }
        if let Some(props) = em.get("Properties") {
            m.insert("properties".to_string(), props.clone());
        }
    }
    Value::Compound(m)
}

/// Builds a vanilla Structure Block NBT tree from an extracted box. No
/// bit-packing (unlike chunk sections) — the structure-file schema stores
/// one explicit `{pos, state, [nbt]}` entry per block instead, deduplicated
/// against a flat `palette` list.
fn build_structure_nbt(
    dims: Dims,
    blocks: &BlockMap,
    block_entities: &[(i32, i32, i32, Value)],
    data_version: i32,
) -> Value {
    let mut be_by_pos: BlockMap = HashMap::new();
    for (lx, ly, lz, entry) in block_entities {
        if let Value::Compound(m) = entry {
            let mut m = m.clone();
            // Position is carried by the enclosing `blocks` entry's `pos`
            // in this schema — strip it from the nested compound so a
            // reloaded template doesn't carry stale coordinates.
            m.remove("x");
            m.remove("y");
            m.remove("z");
            be_by_pos.insert((*lx, *ly, *lz), Value::Compound(m));
        }
    }

    let mut palette: Vec<Value> = Vec::new();
    let mut blocks_list: Vec<Value> = Vec::with_capacity((dims.width * dims.height * dims.depth).max(0) as usize);

    for lz in 0..dims.depth {
        for ly in 0..dims.height {
            for lx in 0..dims.width {
                let pos = (lx, ly, lz);
                let block = blocks.get(&pos).cloned().unwrap_or_else(air_block);
                let entry = to_structure_palette_entry(&block);
                let idx = match palette.iter().position(|p| *p == entry) {
                    Some(i) => i,
                    None => { palette.push(entry); palette.len() - 1 }
                };

                let mut b = HashMap::new();
                b.insert("pos".to_string(), Value::List(vec![Value::Int(lx), Value::Int(ly), Value::Int(lz)]));
                b.insert("state".to_string(), Value::Int(idx as i32));
                if let Some(be) = be_by_pos.get(&pos) {
                    b.insert("nbt".to_string(), be.clone());
                }
                blocks_list.push(Value::Compound(b));
            }
        }
    }

    let mut root = HashMap::new();
    root.insert("DataVersion".to_string(), Value::Int(data_version));
    root.insert("size".to_string(), Value::List(vec![Value::Int(dims.width), Value::Int(dims.height), Value::Int(dims.depth)]));
    root.insert("palette".to_string(), Value::List(palette));
    root.insert("blocks".to_string(), Value::List(blocks_list));
    root.insert("entities".to_string(), Value::List(vec![])); // mobs/entities not copied — same scope cut as elsewhere
    // Real, optional vanilla Structure Block field — human-readable
    // identification; `DataVersion` above is the load-bearing one.
    root.insert("author".to_string(), Value::String("Sojourner".to_string()));
    Value::Compound(root)
}

/// Generous but bounded, to cap worst-case allocation and how far a
/// malformed file's positions could land outside the intended footprint.
const MAX_TEMPLATE_AXIS: i32 = 2048;

/// Inverse of `build_structure_nbt`: parses a structure file's `size`/
/// `palette`/`blocks` back into the same shape `extract_box` produces, so a
/// loaded template feeds the same `apply_transform` -> `write_blocks_to_destination` pipeline.
///
/// Validates bounds rather than trusting them: unlike `extract_box`'s
/// output (trustworthy by construction), a template file could be
/// hand-edited or corrupted — a `pos` outside the declared `size` would
/// otherwise flow through as a normal block and land wherever that computes
/// relative to `dst_origin`, writing into destination chunks nobody selected.
fn parse_structure_nbt(root: &Value) -> super::Result<(Dims, BlockMap, BlockEntityList)> {
    let Value::Compound(root_m) = root else { return Err("structure file root is not a compound".to_string()) };

    let Some(Value::List(size)) = root_m.get("size") else { return Err("structure file has no size list".to_string()) };
    if size.len() != 3 {
        return Err(format!("structure file's size list has {} entries, expected 3", size.len()));
    }
    let dim = |i: usize| match &size[i] {
        Value::Int(n) => Ok(*n),
        other => Err(format!("structure file size[{i}] isn't an int: {other:?}")),
    };
    let dims = Dims { width: dim(0)?, height: dim(1)?, depth: dim(2)? };
    if dims.width <= 0 || dims.height <= 0 || dims.depth <= 0 {
        return Err(format!(
            "structure file has a non-positive size ({}x{}x{}) — refusing to load",
            dims.width, dims.height, dims.depth
        ));
    }
    if dims.width > MAX_TEMPLATE_AXIS || dims.height > MAX_TEMPLATE_AXIS || dims.depth > MAX_TEMPLATE_AXIS {
        return Err(format!(
            "structure file's size ({}x{}x{}) exceeds the {MAX_TEMPLATE_AXIS}-block-per-axis limit — refusing to load",
            dims.width, dims.height, dims.depth
        ));
    }

    let Some(Value::List(palette)) = root_m.get("palette") else { return Err("structure file has no palette list".to_string()) };
    let canon_palette: Vec<Value> = palette.iter().map(from_structure_palette_entry).collect();

    let Some(Value::List(blocks_list)) = root_m.get("blocks") else { return Err("structure file has no blocks list".to_string()) };
    let mut blocks = HashMap::with_capacity(blocks_list.len());
    let mut block_entities = Vec::new();
    let mut out_of_bounds = 0usize;
    let mut bad_state = 0usize;

    for entry in blocks_list {
        let Value::Compound(bm) = entry else { continue };
        let Some(Value::List(pos)) = bm.get("pos") else { continue };
        if pos.len() != 3 {
            continue;
        }
        let (Value::Int(lx), Value::Int(ly), Value::Int(lz)) = (&pos[0], &pos[1], &pos[2]) else { continue };
        let (lx, ly, lz) = (*lx, *ly, *lz);
        if lx < 0 || lx >= dims.width || ly < 0 || ly >= dims.height || lz < 0 || lz >= dims.depth {
            out_of_bounds += 1;
            continue;
        }
        let Some(Value::Int(state)) = bm.get("state") else { continue };
        let Some(block) = usize::try_from(*state).ok().and_then(|i| canon_palette.get(i)).cloned() else {
            bad_state += 1;
            continue;
        };
        blocks.insert((lx, ly, lz), block);

        if let Some(Value::Compound(nbt_m)) = bm.get("nbt") {
            let mut nbt_m = nbt_m.clone();
            // For parity with extract_box's shape; write_blocks_to_destination
            // overwrites x/y/z with the real destination position at paste time anyway.
            nbt_m.insert("x".to_string(), Value::Int(lx));
            nbt_m.insert("y".to_string(), Value::Int(ly));
            nbt_m.insert("z".to_string(), Value::Int(lz));
            block_entities.push((lx, ly, lz, Value::Compound(nbt_m)));
        }
    }

    if out_of_bounds > 0 {
        crate::format_guard::format_warn(
            "structure template block position",
            &format!("{out_of_bounds} block(s) had a pos outside the declared size and were dropped rather than trusted"),
        );
    }
    if bad_state > 0 {
        crate::format_guard::format_warn(
            "structure template palette index",
            &format!("{bad_state} block(s) had a state index outside the palette and were dropped rather than guessed at"),
        );
    }

    Ok((dims, blocks, block_entities))
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SavedTemplateInfo {
    pub width: i32,
    pub height: i32,
    pub depth: i32,
    pub block_count: usize,
}

/// Extracts `src_box` and writes it to `out_path` as a gzip-compressed
/// vanilla Structure Block `.nbt` file. Read-only on the source world — no
/// session-lock, no backup, unlike every other command here.
#[tauri::command]
pub fn save_structure_template(
    src_level_dat_path: String,
    src_dimension: String,
    src_box: (i32, i32, i32, i32, i32, i32),
    out_path: String,
) -> super::Result<SavedTemplateInfo> {
    let src_world_dir = super::world_dir_of(&src_level_dat_path)?.to_string_lossy().to_string();
    let data_version = crate::nbt_reader::read_level_dat(&src_level_dat_path)?.data_version;

    let (dims, blocks, block_entities, _source_air_assumed) = extract_box(&src_world_dir, &src_dimension, src_box);
    let root = build_structure_nbt(dims, &blocks, &block_entities, data_version);

    let raw = fastnbt::to_bytes(&root).map_err(|e| format!("Couldn't serialize structure NBT: {e}"))?;
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(&raw).map_err(|e| format!("Couldn't compress structure file: {e}"))?;
    let compressed = encoder.finish().map_err(|e| format!("Couldn't finish compression: {e}"))?;

    std::fs::write(&out_path, &compressed).map_err(|e| format!("Couldn't write {out_path}: {e}"))?;

    let block_count = blocks.len();
    Ok(SavedTemplateInfo { width: dims.width, height: dims.height, depth: dims.depth, block_count })
}

/// Loads `template_path`, rotates/mirrors it, and pastes it at `dst_origin`
/// via the same `write_blocks_to_destination` pipeline `copy_blocks` uses.
#[tauri::command]
pub fn paste_structure_template(
    app: tauri::AppHandle,
    template_path: String,
    dst_level_dat_path: String,
    dst_dimension: String,
    dst_origin: (i32, i32, i32),
    rotation_deg: i32,
    mirror: Option<String>,
) -> super::Result<CopyBlocksReport> {
    let dst_world_dir = super::world_dir_of(&dst_level_dat_path)?.to_string_lossy().to_string();

    let compressed = std::fs::read(&template_path).map_err(|e| format!("Couldn't read {template_path}: {e}"))?;
    let mut decoder = GzDecoder::new(&compressed[..]);
    let mut raw = Vec::new();
    decoder.read_to_end(&mut raw).map_err(|e| format!("Couldn't decompress {template_path} (not a valid gzip file?): {e}"))?;
    let root: Value = fastnbt::from_bytes(&raw).map_err(|e| format!("Couldn't parse {template_path} as NBT: {e}"))?;

    // A byte-level write skips Minecraft's own data-fixer upgrade pipeline
    // (that only runs when the game loads an old structure file), so a
    // template saved on one MC version pasted into another could silently
    // write block names/properties that version doesn't recognize. Refuse,
    // mirroring check_same_data_version's policy for the live-copy path.
    let template_version = match &root {
        Value::Compound(m) => match m.get("DataVersion") {
            Some(Value::Int(v)) => *v,
            _ => return Err(format!("{template_path} has no DataVersion — not a structure file this app wrote?")),
        },
        _ => return Err(format!("{template_path}: root is not a compound")),
    };
    let dst_version = crate::nbt_reader::read_level_dat(&dst_level_dat_path)?.data_version;
    if template_version != dst_version {
        return Err(format!(
            "Template and destination world are different Minecraft versions \
             (DataVersion {template_version} vs {dst_version}) — refusing to paste \
             across versions."
        ));
    }

    let (dims, blocks, block_entities) = parse_structure_nbt(&root)?;

    let rot = Rotation::from_degrees(rotation_deg);
    let mir = Mirror::from_str(mirror.as_deref());
    let (transformed_blocks, transformed_block_entities) = apply_transform(dims, mir, rot, blocks, block_entities);
    let out_dims = transformed_dims(dims, rot);

    write_blocks_to_destination(
        &app, &dst_world_dir, &dst_dimension, dst_origin, out_dims,
        transformed_blocks, transformed_block_entities,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real-data check, not part of the normal suite (ties to this dev
    /// machine's save) — run via `cargo test -- --ignored --nocapture`.
    /// Confirms every block/property survives the save_structure_template ->
    /// on-disk .nbt -> parse_structure_nbt round trip exactly, including
    /// the id/properties <-> Name/Properties palette-convention conversion.
    #[test]
    #[ignore]
    fn save_and_reparse_shipwreck_mobfarm_template() {
        let level_dat = "/home/user/.minecraft/saves/Sunflower Plains/level.dat".to_string();
        let src_box = (72, 62, -26, 121, 186, -9);
        let out_path = "/tmp/claude-1000/-home-user-Projects-minecraft-sojourner/395d1e85-9809-4993-ae1a-80ea919ca636/scratchpad/shipwreck-mobfarm-test.nbt".to_string();

        let info = save_structure_template(level_dat, "overworld".to_string(), src_box, out_path.clone())
            .expect("save_structure_template failed");
        println!("{info:?}");
        assert_eq!((info.width, info.height, info.depth), (50, 125, 18));
        assert_eq!(info.block_count, 112_500);

        let compressed = std::fs::read(&out_path).unwrap();
        let mut decoder = GzDecoder::new(&compressed[..]);
        let mut raw = Vec::new();
        decoder.read_to_end(&mut raw).unwrap();
        let root: Value = fastnbt::from_bytes(&raw).unwrap();

        let Value::Compound(root_m) = &root else { panic!() };
        assert_eq!(root_m.get("author"), Some(&Value::String("Sojourner".to_string())));
        assert!(root_m.contains_key("DataVersion"));

        let (dims, blocks, _block_entities) = parse_structure_nbt(&root).expect("parse_structure_nbt failed");
        assert_eq!((dims.width, dims.height, dims.depth), (50, 125, 18));
        assert_eq!(blocks.len(), 112_500);

        // Re-extract the box live and confirm it matches the reparsed file exactly.
        let src_world_dir = "/home/user/.minecraft/saves/Sunflower Plains".to_string();
        let (live_dims, live_blocks, _live_be, _air) = extract_box(&src_world_dir, "overworld", src_box);
        assert_eq!((live_dims.width, live_dims.height, live_dims.depth), (dims.width, dims.height, dims.depth));

        let mut mismatches = 0usize;
        let mut bars_checked = 0usize;
        for (pos, live_block) in &live_blocks {
            let Some(round_tripped) = blocks.get(pos) else { mismatches += 1; continue };
            if round_tripped != live_block {
                mismatches += 1;
            }
            if let Value::Compound(m) = live_block {
                if let Some(Value::String(id)) = m.get("id") {
                    if id.contains("bars") { bars_checked += 1; }
                }
            }
        }
        println!("checked {} blocks, {bars_checked} bars entries, {mismatches} mismatches", live_blocks.len());
        assert_eq!(mismatches, 0, "{mismatches} blocks didn't round-trip through save+parse identically");
        assert!(bars_checked > 0, "expected at least one bars entry in this structure — nothing exercised the Name/Properties<->id/properties conversion for that shape");
    }

    /// Independent post-hoc verification of a real `paste_template_cli` run
    /// (ties to a specific past invocation — run via `cargo test --
    /// --ignored --nocapture`). Same approach as
    /// `blocks::tests::verify_sunflower_plains_rotation_result`.
    #[test]
    #[ignore]
    fn verify_pasted_template_result() {
        let template_path = "/tmp/claude-1000/-home-user-Projects-minecraft-sojourner/395d1e85-9809-4993-ae1a-80ea919ca636/scratchpad/shipwreck-mobfarm-test.nbt";
        let compressed = std::fs::read(template_path).unwrap();
        let mut decoder = GzDecoder::new(&compressed[..]);
        let mut raw = Vec::new();
        decoder.read_to_end(&mut raw).unwrap();
        let root: Value = fastnbt::from_bytes(&raw).unwrap();
        let (dims, blocks, _be) = parse_structure_nbt(&root).unwrap();

        // Must match the actual paste_template_cli invocation exactly.
        let (rot, mir) = (Rotation::R180, Mirror::None);
        let (dst_x0, dst_y0, dst_z0) = (-48i32, 62i32, 40i32);
        let region_dir = "/home/user/.minecraft/saves/Sunflower Plains/dimensions/minecraft/overworld/region";

        let mut chunk_cache: HashMap<(i32, i32), Option<Value>> = HashMap::new();
        let mut load = |cx: i32, cz: i32| -> Option<Value> {
            chunk_cache.entry((cx, cz)).or_insert_with(|| {
                let (rx, rz) = (cx.div_euclid(32), cz.div_euclid(32));
                std::fs::read(format!("{region_dir}/r.{rx}.{rz}.mca")).ok()
                    .and_then(|buf| crate::region_reader::read_chunk_nbt(&buf, cx.rem_euclid(32) as usize, cz.rem_euclid(32) as usize))
            }).clone()
        };

        let is_directional = |props: &HashMap<String, Value>| {
            props.keys().any(|k| matches!(k.as_str(), "facing" | "axis" | "rotation" | "shape" | "hinge" | "north" | "east" | "south" | "west"))
        };

        let mut checked = 0usize;
        let mut mismatches: Vec<String> = Vec::new();

        for (&(lx, ly, lz), src_block) in &blocks {
            let Value::Compound(m) = src_block else { continue };
            let Some(Value::Compound(props)) = m.get("properties") else { continue };
            if !is_directional(props) { continue }

            let (nlx, nly, nlz) = crate::structure_copy::rotation::transform_pos(dims, mir, rot, lx, ly, lz);
            let mut expected_props = props.clone();
            crate::structure_copy::rotation::rotate_properties(&mut expected_props, mir, rot);
            let expected_id = m.get("id").cloned();

            let (dwx, dwy, dwz) = (dst_x0 + nlx, dst_y0 + nly, dst_z0 + nlz);
            let Some(dchunk) = load(dwx.div_euclid(16), dwz.div_euclid(16)) else {
                mismatches.push(format!("no destination chunk for {dwx},{dwy},{dwz}"));
                continue;
            };
            let actual = crate::structure_copy::blocks::read_block(&dchunk, dwx, dwy, dwz);
            let Value::Compound(am) = &actual else {
                mismatches.push(format!("destination block at {dwx},{dwy},{dwz} wasn't a compound"));
                continue;
            };
            let actual_id = am.get("id").cloned();
            let actual_props = am.get("properties").cloned();
            let expected_props_val = Some(Value::Compound(expected_props));
            if actual_id != expected_id || actual_props != expected_props_val {
                mismatches.push(format!(
                    "src({lx},{ly},{lz}) -> dst({dwx},{dwy},{dwz}): expected {expected_id:?} {expected_props_val:?}, got {actual_id:?} {actual_props:?}"
                ));
            }
            checked += 1;
        }

        println!("checked {checked} directional blocks, {} mismatches", mismatches.len());
        for m in mismatches.iter().take(20) {
            println!("{m}");
        }
        assert!(checked > 0, "no directional blocks found in the template — nothing was actually verified");
        assert!(mismatches.is_empty(), "{} mismatches out of {checked} checked", mismatches.len());
    }

    /// Same approach, for the real paste into "The 4th reich"
    /// (paste_template_cli ... 0 62 0 90, no mirror).
    #[test]
    #[ignore]
    fn verify_pasted_template_in_4th_reich() {
        let template_path = "/tmp/claude-1000/-home-user-Projects-minecraft-sojourner/395d1e85-9809-4993-ae1a-80ea919ca636/scratchpad/shipwreck-mobfarm-test.nbt";
        let compressed = std::fs::read(template_path).unwrap();
        let mut decoder = GzDecoder::new(&compressed[..]);
        let mut raw = Vec::new();
        decoder.read_to_end(&mut raw).unwrap();
        let root: Value = fastnbt::from_bytes(&raw).unwrap();
        let (dims, blocks, _be) = parse_structure_nbt(&root).unwrap();

        let (rot, mir) = (Rotation::R90, Mirror::None);
        let (dst_x0, dst_y0, dst_z0) = (0i32, 62i32, 0i32);
        let region_dir = "/home/user/.minecraft/saves/The 4th reich/dimensions/minecraft/overworld/region";

        let mut chunk_cache: HashMap<(i32, i32), Option<Value>> = HashMap::new();
        let mut load = |cx: i32, cz: i32| -> Option<Value> {
            chunk_cache.entry((cx, cz)).or_insert_with(|| {
                let (rx, rz) = (cx.div_euclid(32), cz.div_euclid(32));
                std::fs::read(format!("{region_dir}/r.{rx}.{rz}.mca")).ok()
                    .and_then(|buf| crate::region_reader::read_chunk_nbt(&buf, cx.rem_euclid(32) as usize, cz.rem_euclid(32) as usize))
            }).clone()
        };

        let is_directional = |props: &HashMap<String, Value>| {
            props.keys().any(|k| matches!(k.as_str(), "facing" | "axis" | "rotation" | "shape" | "hinge" | "north" | "east" | "south" | "west"))
        };

        let mut checked = 0usize;
        let mut mismatches: Vec<String> = Vec::new();

        for (&(lx, ly, lz), src_block) in &blocks {
            let Value::Compound(m) = src_block else { continue };
            let Some(Value::Compound(props)) = m.get("properties") else { continue };
            if !is_directional(props) { continue }

            let (nlx, nly, nlz) = crate::structure_copy::rotation::transform_pos(dims, mir, rot, lx, ly, lz);
            let mut expected_props = props.clone();
            crate::structure_copy::rotation::rotate_properties(&mut expected_props, mir, rot);
            let expected_id = m.get("id").cloned();

            let (dwx, dwy, dwz) = (dst_x0 + nlx, dst_y0 + nly, dst_z0 + nlz);
            let Some(dchunk) = load(dwx.div_euclid(16), dwz.div_euclid(16)) else {
                mismatches.push(format!("no destination chunk for {dwx},{dwy},{dwz}"));
                continue;
            };
            let actual = crate::structure_copy::blocks::read_block(&dchunk, dwx, dwy, dwz);
            let Value::Compound(am) = &actual else {
                mismatches.push(format!("destination block at {dwx},{dwy},{dwz} wasn't a compound"));
                continue;
            };
            let actual_id = am.get("id").cloned();
            let actual_props = am.get("properties").cloned();
            let expected_props_val = Some(Value::Compound(expected_props));
            if actual_id != expected_id || actual_props != expected_props_val {
                mismatches.push(format!(
                    "src({lx},{ly},{lz}) -> dst({dwx},{dwy},{dwz}): expected {expected_id:?} {expected_props_val:?}, got {actual_id:?} {actual_props:?}"
                ));
            }
            checked += 1;
        }

        println!("checked {checked} directional blocks, {} mismatches", mismatches.len());
        for m in mismatches.iter().take(20) {
            println!("{m}");
        }
        assert!(checked > 0, "no directional blocks found in the template — nothing was actually verified");
        assert!(mismatches.is_empty(), "{} mismatches out of {checked} checked", mismatches.len());
    }
}

#[cfg(test)]
mod mob_farm_split {
    use super::*;

    /// Splits the mob farm out as its own template (soul_sand platform's
    /// chunk only). One-off real-data extraction, not part of the normal suite.
    #[test]
    #[ignore]
    fn save_mob_farm_template() {
        let level_dat = "/home/user/.minecraft/saves/Sunflower Plains/level.dat".to_string();
        let src_box = (72, 61, -32, 121, 186, -17);
        let out_path = "/home/user/.minecraft/sojourner-structures/mob-farm.nbt".to_string();

        let info = save_structure_template(level_dat, "overworld".to_string(), src_box, out_path.clone())
            .expect("save_structure_template failed");
        println!("{info:?}");

        // Sanity: soul_sand should now be at local y=0 (the box's own floor).
        let compressed = std::fs::read(&out_path).unwrap();
        let mut decoder = GzDecoder::new(&compressed[..]);
        let mut raw = Vec::new();
        decoder.read_to_end(&mut raw).unwrap();
        let root: Value = fastnbt::from_bytes(&raw).unwrap();
        let (_dims, blocks, _be) = parse_structure_nbt(&root).unwrap();
        let soul_sand_at_floor = blocks.iter().any(|((_, ly, _), b)| {
            *ly == 0 && matches!(b, Value::Compound(m) if matches!(m.get("id"), Some(Value::String(s)) if s == "minecraft:soul_sand"))
        });
        println!("soul_sand present at local y=0: {soul_sand_at_floor}");
    }
}
