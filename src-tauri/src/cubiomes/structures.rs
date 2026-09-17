use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use flate2::Compression;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use serde::{Deserialize, Serialize};
use super::{
    lock_cubiomes, slot_matches_locked, GeneratorKey,
    cm_setup_generator, cm_find_structures, cm_get_strongholds, cm_free_results,
    cm_get_structure_loot, cm_get_structure_chests, cm_free_string, cm_item_name,
    cm_enchantment_name, cm_potion_name_for_effect,
    cm_get_end_gateway_links, seed_parts,
};

// How cubiomes places each structure type — three distinct mechanisms a single
// "region_size: Option<i32>" field used to conflate (see bugs-resolved.md).
enum Placement {
    /// One salt-offset candidate per `region_size*16`-block region. village and
    /// ruined_portal_nether also need `region_size_for()`'s version gate on top.
    RegionGrid(i32),
    /// Rarity-gated per-chunk roll, not a region grid (desert_well/geode/
    /// buried_treasure/mineshaft) — kept distinct so it can't be handed a bogus size.
    DecoratorFeature,
    /// A ring iterator around the world center — not grid-based at all.
    StrongholdRing,
}

struct StructureDef {
    name:        &'static str,
    cubiomes_id: i32,
    placement:   Placement,
    dimension:   i32,          // 0=overworld, -1=nether, 1=end
}

const STRUCTURE_DEFS: &[StructureDef] = &[
    StructureDef { name: "village",              cubiomes_id:  5, placement: Placement::RegionGrid(34), dimension:  0 },
    StructureDef { name: "desert_temple",        cubiomes_id:  1, placement: Placement::RegionGrid(32), dimension:  0 },
    StructureDef { name: "jungle_temple",        cubiomes_id:  2, placement: Placement::RegionGrid(32), dimension:  0 },
    StructureDef { name: "witch_hut",            cubiomes_id:  3, placement: Placement::RegionGrid(32), dimension:  0 },
    StructureDef { name: "igloo",                cubiomes_id:  4, placement: Placement::RegionGrid(32), dimension:  0 },
    StructureDef { name: "ocean_ruins",          cubiomes_id:  6, placement: Placement::RegionGrid(20), dimension:  0 },
    StructureDef { name: "shipwreck",            cubiomes_id:  7, placement: Placement::RegionGrid(24), dimension:  0 },
    StructureDef { name: "ocean_monument",       cubiomes_id:  8, placement: Placement::RegionGrid(32), dimension:  0 },
    StructureDef { name: "mansion",              cubiomes_id:  9, placement: Placement::RegionGrid(80), dimension:  0 },
    StructureDef { name: "outpost",              cubiomes_id: 10, placement: Placement::RegionGrid(32), dimension:  0 },
    StructureDef { name: "ruined_portal",        cubiomes_id: 11, placement: Placement::RegionGrid(40), dimension:  0 },
    StructureDef { name: "ancient_city",         cubiomes_id: 13, placement: Placement::RegionGrid(24), dimension:  0 },
    StructureDef { name: "buried_treasure",      cubiomes_id: 14, placement: Placement::DecoratorFeature, dimension:  0 },
    StructureDef { name: "mineshaft",            cubiomes_id: 15, placement: Placement::DecoratorFeature, dimension:  0 },
    StructureDef { name: "desert_well",          cubiomes_id: 16, placement: Placement::DecoratorFeature, dimension:  0 },
    StructureDef { name: "geode",                cubiomes_id: 17, placement: Placement::DecoratorFeature, dimension:  0 },
    StructureDef { name: "trail_ruins",          cubiomes_id: 24, placement: Placement::RegionGrid(34), dimension:  0 },
    StructureDef { name: "trial_chambers",       cubiomes_id: 25, placement: Placement::RegionGrid(34), dimension:  0 },
    StructureDef { name: "abandoned_camp",       cubiomes_id: 26, placement: Placement::RegionGrid(37), dimension:  0 },
    StructureDef { name: "stronghold",           cubiomes_id: -1, placement: Placement::StrongholdRing, dimension:  0 },
    StructureDef { name: "fortress",             cubiomes_id: 18, placement: Placement::RegionGrid(27), dimension: -1 },
    StructureDef { name: "bastion",              cubiomes_id: 19, placement: Placement::RegionGrid(27), dimension: -1 },
    StructureDef { name: "ruined_portal_nether", cubiomes_id: 12, placement: Placement::RegionGrid(40), dimension: -1 },
    StructureDef { name: "end_city",             cubiomes_id: 21, placement: Placement::RegionGrid(20), dimension:  1 },
    StructureDef { name: "end_gateway",          cubiomes_id: 22, placement: Placement::RegionGrid(1),  dimension:  1 },
    StructureDef { name: "end_island",           cubiomes_id: 23, placement: Placement::RegionGrid(1),  dimension:  1 },
];

// cubiomes gates region_size on version for these two; Sojourner's MC_1_16 bucket
// covers both real 1.16 and 1.17 saves, so a single hardcoded value would be wrong
// for one side. See bugs-resolved.md.
const MC_1_17: i32 = 21;

fn region_size_for(def: &StructureDef, current: i32, mc_version: i32) -> i32 {
    match def.name {
        "village" if mc_version <= MC_1_17               => 32,
        "ruined_portal_nether" if mc_version <= MC_1_17  => 25,
        _ => current,
    }
}

#[derive(Serialize)]
pub struct StructureHit {
    pub struct_type:   String,
    pub x:             i32,
    pub z:             i32,
    pub flags:         i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variant_tag:   Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variant_color: Option<String>,
}

// Only one variant tag can be reported per instance (first match wins) — giant
// and underground are mutually exclusive in cubiomes' own generation, but
// air_pocket is independently rolled and can co-occur with either; it's
// ordered last so giant/underground (rarer, more notable) still take priority
// on the rare instance where both are true.
fn resolve_variant(struct_type: &str, flags: i32) -> Option<(&'static str, &'static str)> {
    match struct_type {
        "igloo"                if flags & 1  != 0 => Some(("basement",    "#f59e0b")),
        "village"              if flags & 2  != 0 => Some(("zombie",      "#4ade80")),
        "ruined_portal"        if flags & 4  != 0 => Some(("giant",       "#c084fc")),
        "ruined_portal"        if flags & 8  != 0 => Some(("underground", "#6b7280")),
        "ruined_portal"        if flags & 16 != 0 => Some(("air_pocket",  "#38bdf8")),
        "ruined_portal_nether" if flags & 4  != 0 => Some(("giant",       "#c084fc")),
        "ruined_portal_nether" if flags & 16 != 0 => Some(("air_pocket",  "#38bdf8")),
        // ~95% of geodes generate already cracked open; the notable minority is
        // the ~5% that are fully sealed with no visible entrance.
        "geode"                if flags & 1  != 0 => Some(("sealed",      "#6b7280")),
        _ => None,
    }
}

pub fn find_all_structures(
    seed: i64,
    mc_version: i32,
    dimension: i32,
    world_flags: i32,
    bx0: i32, bz0: i32,
    bx1: i32, bz1: i32,
    enabled: &[String],
) -> Vec<StructureHit> {
    let (lo, hi) = seed_parts(seed);
    let _guard = lock_cubiomes();
    let slot = unsafe { cm_setup_generator(lo, hi, mc_version, dimension, world_flags) };
    if slot < 0 { return vec![]; }

    let mut results = Vec::new();

    for def in STRUCTURE_DEFS {
        if def.dimension != dimension { continue; }
        if !enabled.iter().any(|e| e == def.name) { continue; }

        let region_size = match def.placement {
            Placement::StrongholdRing => {
                let mut buf = vec![0i32; 256];
                let count = unsafe { cm_get_strongholds(slot, 128, buf.as_mut_ptr()) };
                for i in 0..count as usize {
                    results.push(StructureHit {
                        struct_type: def.name.to_string(),
                        x:     buf[i * 2],
                        z:     buf[i * 2 + 1],
                        flags: 0,
                        variant_tag: None, variant_color: None,
                    });
                }
                continue;
            }
            Placement::RegionGrid(size) => region_size_for(def, size, mc_version),
            Placement::DecoratorFeature => 1,
        };

        let region_blocks = region_size * 16;
        let rx0 = bx0.div_euclid(region_blocks) - 1;
        let rz0 = bz0.div_euclid(region_blocks) - 1;
        let rx1 = bx1.div_euclid(region_blocks) + 1;
        let rz1 = bz1.div_euclid(region_blocks) + 1;
        if (rx1 - rx0 + 1).saturating_mul(rz1 - rz0 + 1) > 65536 { continue; }

        let ptr = unsafe { cm_find_structures(slot, def.cubiomes_id, rx0, rz0, rx1, rz1) };
        if ptr.is_null() { continue; }
        let count = unsafe { *ptr } as usize;
        for i in 0..count {
            let base  = 1 + i * 3;
            let flags = unsafe { *ptr.add(base + 2) };
            let (vtag, vcolor) = resolve_variant(def.name, flags)
                .map(|(t, c)| (Some(t.to_string()), Some(c.to_string())))
                .unwrap_or((None, None));
            results.push(StructureHit {
                struct_type:   def.name.to_string(),
                x:             unsafe { *ptr.add(base) },
                z:             unsafe { *ptr.add(base + 1) },
                flags,
                variant_tag:   vtag,
                variant_color: vcolor,
            });
        }
        unsafe { cm_free_results(ptr) };
    }

    results
}

// ── Disk cache for structure results ─────────────────────────────────────────

/// Cache tiles are 4096 × 4096 blocks.  Each tile stores ALL structure types
/// for the dimension so the file is reusable regardless of which types the
/// user has enabled.
const STRUCT_TILE_BLOCKS: i32 = 512;

// Bump whenever cm_find_structures' selection logic changes, so tiles cached under
// the old logic are treated as a miss and recomputed. History: bugs-resolved.md.
const STRUCT_CACHE_VERSION: i32 = 2;

#[derive(Serialize, Deserialize)]
struct CachedHit {
    t: String,
    x: i32,
    z: i32,
    #[serde(default, skip_serializing_if = "is_zero")]
    f: i32,
}

fn is_zero(v: &i32) -> bool { *v == 0 }

fn seed_hex(seed_low: i32, seed_high: i32) -> String {
    let seed = ((seed_high as i64) << 32) | (seed_low as u32 as i64);
    format!("{:016x}", seed as u64)
}

fn struct_cache_dir(
    cache_root: &Path,
    seed_low:   i32,
    seed_high:  i32,
    dim_str:    &str,
    mc_version: i32,
    world_flags: i32,
) -> PathBuf {
    cache_root
        .join("structures")
        .join(seed_hex(seed_low, seed_high))
        .join(format!("{dim_str}_v{mc_version}_f{world_flags}_g{STRUCT_CACHE_VERSION}"))
}

fn tile_path(dir: &Path, tx: i32, tz: i32) -> PathBuf {
    dir.join(format!("{tx}_{tz}.json.gz"))
}

fn strongholds_path(dir: &Path) -> PathBuf {
    dir.join("strongholds.json.gz")
}

fn read_gz_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    let file = std::fs::File::open(path).ok()?;
    let mut gz = GzDecoder::new(file);
    let mut buf = Vec::new();
    gz.read_to_end(&mut buf).ok()?;
    serde_json::from_slice(&buf).ok()
}

fn write_gz_json<T: Serialize>(path: &Path, data: &T) -> std::io::Result<()> {
    if let Some(p) = path.parent() { std::fs::create_dir_all(p)?; }
    let tmp = path.with_extension("tmp");
    {
        let file = std::fs::File::create(&tmp)?;
        let mut gz = GzEncoder::new(file, Compression::fast());
        let json = serde_json::to_vec(data)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        gz.write_all(&json)?;
        gz.finish()?;
    }
    std::fs::rename(&tmp, path)
}

fn hit_to_cached(h: &StructureHit) -> CachedHit {
    CachedHit { t: h.struct_type.clone(), x: h.x, z: h.z, f: h.flags }
}

fn cached_to_hit(c: CachedHit) -> StructureHit {
    let (vtag, vcolor) = resolve_variant(&c.t, c.f)
        .map(|(t, col)| (Some(t.to_string()), Some(col.to_string())))
        .unwrap_or((None, None));
    StructureHit { struct_type: c.t, x: c.x, z: c.z, flags: c.f, variant_tag: vtag, variant_color: vcolor }
}

fn compute_tile(seed: i64, mc_version: i32, dim: i32, world_flags: i32, tx: i32, tz: i32) -> Vec<CachedHit> {
    let bx0 = tx * STRUCT_TILE_BLOCKS;
    let bx1 = (tx + 1) * STRUCT_TILE_BLOCKS;
    let bz0 = tz * STRUCT_TILE_BLOCKS;
    let bz1 = (tz + 1) * STRUCT_TILE_BLOCKS;
    let all: Vec<String> = STRUCTURE_DEFS.iter()
        .filter(|d| d.dimension == dim && !matches!(d.placement, Placement::StrongholdRing))
        .map(|d| d.name.to_string())
        .collect();
    find_all_structures(seed, mc_version, dim, world_flags, bx0, bz0, bx1, bz1, &all)
        .iter().map(hit_to_cached).collect()
}

/// Cache-aware replacement for `cubiomes_find_all_structures`.
/// Results are transparently stored as gzipped JSON tiles on disk.
pub fn find_all_structures_cached(
    cache_root:  &Path,
    seed:        i64,
    mc_version:  i32,
    dim:         i32,
    world_flags: i32,
    bx0: i32, bz0: i32,
    bx1: i32, bz1: i32,
    enabled:     &[String],
) -> Vec<StructureHit> {
    let (seed_low, seed_high) = seed_parts(seed);
    let dim_str = match dim { -1 => "nether", 1 => "end", _ => "overworld" };
    let cache_dir = struct_cache_dir(cache_root, seed_low, seed_high, dim_str, mc_version, world_flags);

    let mut hits: Vec<StructureHit> = Vec::new();
    let mut seen = std::collections::HashSet::<(String, i32, i32)>::new();

    // Strongholds: global, cached in a single file
    if enabled.iter().any(|e| e == "stronghold") {
        let sh_path = strongholds_path(&cache_dir);
        let cached: Vec<CachedHit> = if sh_path.exists() {
            read_gz_json(&sh_path).unwrap_or_default()
        } else {
            let computed = find_all_structures(
                seed, mc_version, dim, world_flags, 0, 0, 0, 0,
                &["stronghold".to_string()],
            );
            let c: Vec<CachedHit> = computed.iter().map(hit_to_cached).collect();
            let _ = write_gz_json(&sh_path, &c);
            c
        };
        for c in cached {
            if seen.insert((c.t.clone(), c.x, c.z)) { hits.push(cached_to_hit(c)); }
        }
    }

    // Region-based structures: tile cache with ±1 tile margin. No cap on the
    // tile count here — every tile is independently disk-cached (cheap after
    // the first computation), so a large box just means more tiles processed,
    // never silently incomplete results. A caller wanting a huge area (the
    // static exporter routinely does) gets a correct, if slower, answer
    // instead of having to know about and pre-batch around an internal limit.
    let tx0 = bx0.div_euclid(STRUCT_TILE_BLOCKS) - 1;
    let tz0 = bz0.div_euclid(STRUCT_TILE_BLOCKS) - 1;
    let tx1 = bx1.div_euclid(STRUCT_TILE_BLOCKS) + 1;
    let tz1 = bz1.div_euclid(STRUCT_TILE_BLOCKS) + 1;

    for tx in tx0..=tx1 {
        for tz in tz0..=tz1 {
            let tp = tile_path(&cache_dir, tx, tz);
            let tile: Vec<CachedHit> = if tp.exists() {
                read_gz_json(&tp).unwrap_or_default()
            } else {
                let computed = compute_tile(seed, mc_version, dim, world_flags, tx, tz);
                let _ = write_gz_json(&tp, &computed);
                computed
            };
            for c in tile {
                if !enabled.iter().any(|e| e == &c.t) { continue; }
                if seen.insert((c.t.clone(), c.x, c.z)) { hits.push(cached_to_hit(c)); }
            }
        }
    }

    hits
}

pub fn clear_structure_cache(cache_root: &Path, seed_low: i32, seed_high: i32) {
    let dir = cache_root.join("structures").join(seed_hex(seed_low, seed_high));
    let _ = std::fs::remove_dir_all(dir);
}

/// One rolled enchantment on a generated item.
#[derive(Serialize)]
pub struct EnchantmentInfo {
    pub name:  String,
    pub level: i32,
}

/// One generated loot item in a structure chest, with the item name resolved.
#[derive(Serialize)]
pub struct LootItem {
    pub chest_x: i32,
    pub chest_z: i32,
    pub item:    String,
    pub count:   i32,
    /// Resolved potion name from a `set_potion` loot function — cubiomes tracks the
    /// raw mob effect, not the potion id, so this is matched back against the potion table.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub potion: Option<String>,
    // Always serialized, even as `[]` — frontend's LootItem.enchantments is required.
    pub enchantments: Vec<EnchantmentInfo>,
}

/// Fixed record width per generated item in cm_get_structure_loot's output —
/// must match LOOT_ITEM_STRIDE in cubiomes_bridge.c: chestX, chestZ, itemId,
/// count, effect, duration, enchCount, then 16 (enchantment, level) pairs.
const LOOT_ITEM_STRIDE: usize = 4 + 2 + 1 + 16 * 2;

/// Roll the chest loot for a structure at `(pos_x, pos_z)` using the generator
/// already set up at `slot`. Returns one entry per generated item stack.
/// `mc_version` is used to resolve item ids to names.
#[tauri::command]
pub async fn cubiomes_get_structure_loot(
    slot: i32, seed_low: i32, seed_high: i32, dimension: i32, world_flags: i32, mc_version: i32,
    struct_type: i32, pos_x: i32, pos_z: i32,
) -> Vec<LootItem> {
    let key = GeneratorKey { seed_low, seed_high, dimension, world_flags, mc_version };
    tauri::async_runtime::spawn_blocking(move || {
        // The loot library is not thread-safe; hold the lock across the call.
        let _guard = lock_cubiomes();
        if !slot_matches_locked(slot, key) { return Vec::new(); }
        let ptr = unsafe { cm_get_structure_loot(slot, struct_type, pos_x, pos_z) };
        if ptr.is_null() { return Vec::new(); }
        let mut items = Vec::new();
        unsafe {
            let count = (*ptr).max(0) as usize;
            for i in 0..count {
                let base = 1 + i * LOOT_ITEM_STRIDE;
                let id = *ptr.add(base + 2);
                let name_ptr = cm_item_name(id, mc_version);
                let item = if name_ptr.is_null() {
                    format!("item_{id}")
                } else {
                    std::ffi::CStr::from_ptr(name_ptr).to_string_lossy().into_owned()
                };

                let effect = *ptr.add(base + 4);
                let duration = *ptr.add(base + 5);
                let potion = if effect >= 0 {
                    let p = cm_potion_name_for_effect(effect, duration);
                    if p.is_null() { None } else {
                        Some(std::ffi::CStr::from_ptr(p).to_string_lossy().into_owned())
                    }
                } else {
                    None
                };

                let ench_count = (*ptr.add(base + 6)).clamp(0, 16) as usize;
                let mut enchantments = Vec::with_capacity(ench_count);
                for k in 0..ench_count {
                    let ench_id = *ptr.add(base + 7 + k * 2);
                    let level   = *ptr.add(base + 7 + k * 2 + 1);
                    let name_ptr = cm_enchantment_name(ench_id);
                    if name_ptr.is_null() { continue; }
                    let name = std::ffi::CStr::from_ptr(name_ptr).to_string_lossy().into_owned();
                    enchantments.push(EnchantmentInfo { name, level });
                }

                items.push(LootItem {
                    chest_x: *ptr.add(base),
                    chest_z: *ptr.add(base + 1),
                    item,
                    count: *ptr.add(base + 3),
                    potion,
                    enchantments,
                });
            }
            cm_free_results(ptr);
        }
        items
    }).await.unwrap_or_default()
}

/// One chest slot in a structure, identified by its loot table (e.g.
/// `shipwreck_treasure`) — without rolling the loot. Used to badge map markers
/// by which chest kinds a given instance actually has.
#[derive(Serialize)]
pub struct ChestSlot {
    pub chest_x: i32,
    pub chest_z: i32,
    pub table:   String,
    /// True for an End Ship chest (better Elytra odds). Tower chests share the same
    /// loot table name, so this comes from the structure piece type, not `table`.
    pub is_ship: bool,
}

/// Report the chest composition of a structure at `(pos_x, pos_z)`: one entry
/// per chest, tagged with its loot table. Cheaper than `get_structure_loot`
/// because it stops before rolling the loot, so it is safe to call eagerly for
/// every visible marker.
#[tauri::command]
pub async fn cubiomes_get_structure_chests(
    slot: i32, seed_low: i32, seed_high: i32, dimension: i32, world_flags: i32, mc_version: i32,
    struct_type: i32, pos_x: i32, pos_z: i32,
) -> Vec<ChestSlot> {
    let key = GeneratorKey { seed_low, seed_high, dimension, world_flags, mc_version };
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock_cubiomes();
        if !slot_matches_locked(slot, key) { return Vec::new(); }
        let ptr = unsafe { cm_get_structure_chests(slot, struct_type, pos_x, pos_z) };
        if ptr.is_null() { return Vec::new(); }
        let mut slots = Vec::new();
        unsafe {
            let text = std::ffi::CStr::from_ptr(ptr).to_string_lossy().into_owned();
            cm_free_string(ptr);
            for line in text.lines() {
                let mut f = line.split('\t');
                if let (Some(x), Some(z), Some(table)) = (f.next(), f.next(), f.next()) {
                    if let (Ok(chest_x), Ok(chest_z)) = (x.parse(), z.parse()) {
                        let is_ship = f.next() == Some("ship");
                        slots.push(ChestSlot { chest_x, chest_z, table: table.to_string(), is_ship });
                    }
                }
            }
        }
        slots
    }).await.unwrap_or_default()
}

/// One of the 20 ring End Gateways paired with its deterministic outer destination —
/// computed straight from the seed, so known even for gateways nobody has visited.
#[derive(Serialize)]
pub struct GatewayLink {
    pub src_x: i32,
    pub src_z: i32,
    pub dst_x: i32,
    pub dst_z: i32,
}

/// The 20 ring End Gateway → outer destination pairs for the generator at
/// `slot`. Empty if the slot isn't set up for the End dimension, or the MC
/// version predates 1.13 (`getLinkedGatewayPos` is undefined before that).
#[tauri::command]
pub async fn cubiomes_get_end_gateway_links(
    slot: i32, seed_low: i32, seed_high: i32, dimension: i32, world_flags: i32, mc_version: i32,
) -> Vec<GatewayLink> {
    let key = GeneratorKey { seed_low, seed_high, dimension, world_flags, mc_version };
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock_cubiomes();
        if !slot_matches_locked(slot, key) { return Vec::new(); }
        let mut buf = [0i32; 80];
        let n = unsafe { cm_get_end_gateway_links(slot, buf.as_mut_ptr()) };
        if n <= 0 { return Vec::new(); }
        (0..n as usize).map(|i| GatewayLink {
            src_x: buf[i * 4], src_z: buf[i * 4 + 1],
            dst_x: buf[i * 4 + 2], dst_z: buf[i * 4 + 3],
        }).collect()
    }).await.unwrap_or_default()
}
