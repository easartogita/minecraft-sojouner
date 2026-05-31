use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use flate2::Compression;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use serde::{Deserialize, Serialize};
use super::{
    CUBIOMES_LOCK,
    cm_setup_generator, cm_find_structures, cm_get_strongholds, cm_free_results,
    seed_parts,
};

struct StructureDef {
    name:        &'static str,
    cubiomes_id: i32,
    region_size: Option<i32>,  // cubiomes region size; None = stronghold iterator
    dimension:   i32,          // 0=overworld, -1=nether, 1=end
}

const STRUCTURE_DEFS: &[StructureDef] = &[
    StructureDef { name: "village",              cubiomes_id:  5, region_size: Some(32), dimension:  0 },
    StructureDef { name: "desert_temple",        cubiomes_id:  1, region_size: Some(32), dimension:  0 },
    StructureDef { name: "jungle_temple",        cubiomes_id:  2, region_size: Some(32), dimension:  0 },
    StructureDef { name: "witch_hut",            cubiomes_id:  3, region_size: Some(32), dimension:  0 },
    StructureDef { name: "igloo",                cubiomes_id:  4, region_size: Some(32), dimension:  0 },
    StructureDef { name: "ocean_ruins",          cubiomes_id:  6, region_size: Some(20), dimension:  0 },
    StructureDef { name: "shipwreck",            cubiomes_id:  7, region_size: Some(24), dimension:  0 },
    StructureDef { name: "ocean_monument",       cubiomes_id:  8, region_size: Some(32), dimension:  0 },
    StructureDef { name: "mansion",              cubiomes_id:  9, region_size: Some(80), dimension:  0 },
    StructureDef { name: "outpost",              cubiomes_id: 10, region_size: Some(32), dimension:  0 },
    StructureDef { name: "ruined_portal",        cubiomes_id: 11, region_size: Some(40), dimension:  0 },
    StructureDef { name: "ancient_city",         cubiomes_id: 13, region_size: Some(24), dimension:  0 },
    StructureDef { name: "buried_treasure",      cubiomes_id: 14, region_size: Some(1),  dimension:  0 },
    StructureDef { name: "mineshaft",            cubiomes_id: 15, region_size: Some(1),  dimension:  0 },
    StructureDef { name: "desert_well",          cubiomes_id: 16, region_size: Some(40), dimension:  0 },
    StructureDef { name: "geode",                cubiomes_id: 17, region_size: Some(1),  dimension:  0 },
    StructureDef { name: "trail_ruins",          cubiomes_id: 23, region_size: Some(34), dimension:  0 },
    StructureDef { name: "trial_chambers",       cubiomes_id: 24, region_size: Some(24), dimension:  0 },
    StructureDef { name: "stronghold",           cubiomes_id: -1, region_size: None,     dimension:  0 },
    StructureDef { name: "fortress",             cubiomes_id: 18, region_size: Some(27), dimension: -1 },
    StructureDef { name: "bastion",              cubiomes_id: 19, region_size: Some(27), dimension: -1 },
    StructureDef { name: "ruined_portal_nether", cubiomes_id: 12, region_size: Some(25), dimension: -1 },
    StructureDef { name: "end_city",             cubiomes_id: 20, region_size: Some(20), dimension:  1 },
    StructureDef { name: "end_gateway",          cubiomes_id: 21, region_size: Some(1),  dimension:  1 },
    StructureDef { name: "end_island",           cubiomes_id: 22, region_size: Some(1),  dimension:  1 },
];

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

fn resolve_variant(struct_type: &str, flags: i32) -> Option<(&'static str, &'static str)> {
    match struct_type {
        "igloo"               if flags & 1 != 0 => Some(("basement",    "#f59e0b")),
        "village"             if flags & 2 != 0 => Some(("zombie",      "#4ade80")),
        "ruined_portal"       if flags & 4 != 0 => Some(("giant",       "#c084fc")),
        "ruined_portal"       if flags & 8 != 0 => Some(("underground", "#6b7280")),
        "ruined_portal_nether" if flags & 4 != 0 => Some(("giant",       "#c084fc")),
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
    let _guard = CUBIOMES_LOCK.lock().unwrap();
    let slot = unsafe { cm_setup_generator(lo, hi, mc_version, dimension, world_flags) };
    if slot < 0 { return vec![]; }

    let mut results = Vec::new();

    for def in STRUCTURE_DEFS {
        if def.dimension != dimension { continue; }
        if !enabled.iter().any(|e| e == def.name) { continue; }

        if def.region_size.is_none() {
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
        } else {
            let region_size   = def.region_size.unwrap();
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
    }

    results
}

// ── Disk cache for structure results ─────────────────────────────────────────

/// Cache tiles are 4096 × 4096 blocks.  Each tile stores ALL structure types
/// for the dimension so the file is reusable regardless of which types the
/// user has enabled.
const STRUCT_TILE_BLOCKS: i32 = 512;

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
        .join(format!("{dim_str}_v{mc_version}_f{world_flags}"))
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
        .filter(|d| d.dimension == dim && d.region_size.is_some())
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

    // Region-based structures: tile cache with ±1 tile margin
    let tx0 = bx0.div_euclid(STRUCT_TILE_BLOCKS) - 1;
    let tz0 = bz0.div_euclid(STRUCT_TILE_BLOCKS) - 1;
    let tx1 = bx1.div_euclid(STRUCT_TILE_BLOCKS) + 1;
    let tz1 = bz1.div_euclid(STRUCT_TILE_BLOCKS) + 1;
    if (tx1 - tx0 + 1).saturating_mul(tz1 - tz0 + 1) > 512 { return hits; }

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
