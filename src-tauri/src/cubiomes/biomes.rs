use serde::{Deserialize, Serialize};
use super::{
    lock_cubiomes, slot_matches_locked, GeneratorKey,
    cm_setup_generator, cm_setup_generator_reserved, cm_get_biome_region, cm_get_biome_region_at,
    cm_get_height_region, cm_get_spawn,
    cm_get_surface_heights, cm_free_results,
    seed_from_parts,
};

pub fn setup_generator(seed: i64, mc_version: i32, dimension: i32, flags: i32) -> i32 {
    let u = seed as u64;
    let (lo, hi) = (u as i32, (u >> 32) as i32);
    let _guard = lock_cubiomes();
    unsafe { cm_setup_generator(lo, hi, mc_version, dimension, flags) }
}

/// Exporter-only counterpart to `setup_generator`: always (re)configures the
/// one reserved generator slot rather than round-robining, so a long-running
/// static-site export never loses its generator to concurrent live-map use.
/// See `cm_setup_generator_reserved` in cubiomes_bridge.c.
pub fn setup_generator_reserved(seed: i64, mc_version: i32, dimension: i32, flags: i32) -> i32 {
    let u = seed as u64;
    let (lo, hi) = (u as i32, (u >> 32) as i32);
    let _guard = lock_cubiomes();
    unsafe { cm_setup_generator_reserved(lo, hi, mc_version, dimension, flags) }
}

/// Self-locking counterpart to `slot_matches_locked`, for one-off callers that
/// don't already hold `CUBIOMES_LOCK` (e.g. `render_biome_tile`, which checks
/// once and doesn't hold the guard across its whole call).
pub fn slot_matches(slot: i32, key: GeneratorKey) -> bool {
    let _guard = lock_cubiomes();
    slot_matches_locked(slot, key)
}

/// `key` is the caller's expected config for `slot` — checked under the same
/// lock acquisition as the query itself, so a slot repointed by a concurrent
/// `setupGenerator` (async on the frontend) between request and execution
/// can't silently return biome data for the wrong world.
pub fn get_biome_region(
    slot: i32, key: GeneratorKey,
    x: i32, z: i32,
    width: i32, height: i32,
    scale: i32,
) -> Option<Vec<i32>> {
    let n = (width * height) as usize;
    let mut buf = vec![0i32; n];
    let _guard = lock_cubiomes();
    if !slot_matches_locked(slot, key) { return None; }
    let rc = unsafe { cm_get_biome_region(slot, x, z, width, height, scale, buf.as_mut_ptr()) };
    if rc == 0 { Some(buf) } else { None }
}

/// Set up a generator and immediately query a biome region, holding the lock
/// across both operations so the slot can't be recycled in between.
pub fn get_biome_region_for_seed(
    seed_low: i32, seed_high: i32,
    mc_version: i32, dimension: i32, world_flags: i32,
    x: i32, z: i32,
    width: i32, height: i32,
    scale: i32,
) -> Option<Vec<i32>> {
    let n = (width * height) as usize;
    let mut buf = vec![0i32; n];
    let _guard = lock_cubiomes();
    let slot = unsafe { cm_setup_generator(seed_low, seed_high, mc_version, dimension, world_flags) };
    if slot < 0 { return None; }
    let rc = unsafe { cm_get_biome_region(slot, x, z, width, height, scale, buf.as_mut_ptr()) };
    if rc == 0 { Some(buf) } else { None }
}

pub fn get_biome_region_at(
    slot: i32, key: GeneratorKey,
    x: i32, z: i32,
    width: i32, height: i32,
    scale: i32, y: i32,
) -> Option<Vec<i32>> {
    let n = (width * height) as usize;
    let mut buf = vec![0i32; n];
    let _guard = lock_cubiomes();
    if !slot_matches_locked(slot, key) { return None; }
    let rc = unsafe { cm_get_biome_region_at(slot, x, z, width, height, scale, y, buf.as_mut_ptr()) };
    if rc == 0 { Some(buf) } else { None }
}

pub fn get_height_region(
    slot: i32, key: GeneratorKey,
    x: i32, z: i32, w: i32, h: i32,
) -> Option<Vec<f32>> {
    let n = (w * h) as usize;
    let mut buf = vec![0f32; n];
    let _guard = lock_cubiomes();
    if !slot_matches_locked(slot, key) { return None; }
    let rc = unsafe { cm_get_height_region(slot, x, z, w, h, buf.as_mut_ptr()) };
    if rc == 0 { Some(buf) } else { None }
}

/// Real terrain-noise surface height, more accurate than `get_height_region`'s
/// `mapApproxHeight` but only works for Overworld 1.18+ or the End (see
/// cm_get_surface_heights in cubiomes_bridge.c). `None` covers both a slot
/// mismatch and unsupported cases — callers treat both as "skip shading".
pub fn get_surface_height_region(
    slot: i32, key: GeneratorKey, x: i32, z: i32, w: i32, h: i32, stride: i32,
) -> Option<Vec<i32>> {
    let _guard = lock_cubiomes();
    if !slot_matches_locked(slot, key) { return None; }
    let ptr = unsafe { cm_get_surface_heights(slot, x, z, w, h, stride) };
    if ptr.is_null() { return None; }
    unsafe {
        let n = (w.max(0) as usize) * (h.max(0) as usize);
        let v = std::slice::from_raw_parts(ptr, n).to_vec();
        cm_free_results(ptr);
        Some(v)
    }
}

/// Returns `None` when `slot` doesn't currently match the caller's expected
/// config (see `get_biome_region`'s doc) — callers should treat that as "no
/// spawn known yet" rather than drawing a marker at a stale/wrong (0, 0).
pub fn get_spawn(slot: i32, key: GeneratorKey) -> Option<(i32, i32)> {
    let mut x = 0i32;
    let mut z = 0i32;
    let _guard = lock_cubiomes();
    if !slot_matches_locked(slot, key) { return None; }
    unsafe { cm_get_spawn(slot, &mut x, &mut z) };
    Some((x, z))
}

#[derive(Deserialize)]
pub struct BiomeSamplePoint { pub x: i32, pub z: i32 }

/// Batched surface-biome sampling (one CUBIOMES_LOCK acquisition for the whole
/// batch) used to classify map-drawn lines like Route Planner boat legs. Samples
/// at the approximate surface height — a fixed Y sits inside terrain under tall
/// peaks and misreads as cave biomes. Uses raw FFI calls directly since the safe
/// wrappers would deadlock re-taking the already-held lock.
pub fn get_surface_biomes_at_points(
    slot: i32, key: GeneratorKey,
    points: &[BiomeSamplePoint],
) -> Vec<i32> {
    const CAVE_BIOMES: &[i32] = &[174, 175, 183, 187]; // dripstone_caves, lush_caves, deep_dark, sulfur_caves
    let _guard = lock_cubiomes();
    if !slot_matches_locked(slot, key) {
        return vec![-1; points.len()];
    }
    points.iter().map(|p| {
        let mut buf = [0i32; 1];
        let mut h = f32::NAN;
        let hrc = unsafe { cm_get_height_region(slot, p.x >> 2, p.z >> 2, 1, 1, &mut h) };
        let rc = if hrc == 0 && h.is_finite() {
            let y = h.round() as i32 + 1;
            let rc = unsafe { cm_get_biome_region_at(slot, p.x, p.z, 1, 1, 1, y, buf.as_mut_ptr()) };
            if rc == 0 && CAVE_BIOMES.contains(&buf[0]) {
                // Height is an estimate; retry above a cave pocket, then accept.
                unsafe { cm_get_biome_region_at(slot, p.x, p.z, 1, 1, 1, y + 8, buf.as_mut_ptr()) }
            } else {
                rc
            }
        } else {
            unsafe { cm_get_biome_region(slot, p.x, p.z, 1, 1, 1, buf.as_mut_ptr()) }
        };
        if rc != 0 { return -1; }
        if CAVE_BIOMES.contains(&buf[0]) { -1 } else { buf[0] }
    }).collect()
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn cubiomes_setup_generator(
    seed_low: i32, seed_high: i32,
    mc_version: i32, dimension: i32, flags: i32,
) -> i32 {
    let seed = seed_from_parts(seed_low, seed_high);
    tauri::async_runtime::spawn_blocking(move || {
        setup_generator(seed, mc_version, dimension, flags)
    }).await.unwrap_or(-1)
}

#[derive(Serialize)]
pub struct BiomeRegionResult {
    pub biomes: Vec<i32>,
    pub width:  i32,
    pub height: i32,
}

#[tauri::command]
pub async fn cubiomes_get_biomes(
    slot: i32, seed_low: i32, seed_high: i32, dimension: i32, world_flags: i32, mc_version: i32,
    x: i32, z: i32, width: i32, height: i32, scale: i32,
) -> Option<BiomeRegionResult> {
    let key = GeneratorKey { seed_low, seed_high, dimension, world_flags, mc_version };
    tauri::async_runtime::spawn_blocking(move || {
        get_biome_region(slot, key, x, z, width, height, scale)
            .map(|biomes| BiomeRegionResult { biomes, width, height })
    }).await.ok().flatten()
}

/// Like cubiomes_get_biomes but queries at an explicit biome Y coordinate.
/// y is in cubiomes biome space: Minecraft block Y divided by 4 (for scale > 1).
#[tauri::command]
pub async fn cubiomes_get_biomes_at(
    slot: i32, seed_low: i32, seed_high: i32, dimension: i32, world_flags: i32, mc_version: i32,
    x: i32, z: i32, width: i32, height: i32, scale: i32, y: i32,
) -> Option<BiomeRegionResult> {
    let key = GeneratorKey { seed_low, seed_high, dimension, world_flags, mc_version };
    tauri::async_runtime::spawn_blocking(move || {
        get_biome_region_at(slot, key, x, z, width, height, scale, y)
            .map(|biomes| BiomeRegionResult { biomes, width, height })
    }).await.ok().flatten()
}

/// Cave-biome IDs recognized by the underground scan (tile render + hover
/// query) — kept in one place since both need to agree on what counts.
pub const CAVE_BIOME_IDS: &[i32] = &[174, 175, 183, 187]; // dripstone_caves, lush_caves, deep_dark, sulfur_caves

/// Biome-space Y levels (block_y / 4) sampled for the "underground" view,
/// shallowest first. Cave biomes aren't confined to one Y (dripstone/lush skew
/// shallow, deep dark skews deep), so a single fixed sample used to miss
/// whichever range it wasn't pointed at.
pub const UNDERGROUND_Y_LEVELS: &[i32] = &[5, 1, -3, -7, -11, -15]; // block Y 20, 4, -12, -28, -44, -60

/// Biome ID at (x, z) for the given display mode. "surface" queries at the
/// approximate surface height (a fixed Y=64 lands inside terrain under tall
/// peaks and misreads as cave biomes). "underground" walks UNDERGROUND_Y_LEVELS
/// shallowest-first for the first cave-biome hit below the surface. Other modes
/// query at the generator default (Y 64).
#[tauri::command]
pub async fn cubiomes_get_hover_biome(
    slot: i32, seed_low: i32, seed_high: i32, dimension: i32, world_flags: i32, mc_version: i32,
    x: i32, z: i32, mode: String,
) -> i32 {
    let key = GeneratorKey { seed_low, seed_high, dimension, world_flags, mc_version };
    tauri::async_runtime::spawn_blocking(move || {
        let hr = |x: i32, z: i32, w: i32, h: i32| get_height_region(slot, key, x, z, w, h);
        let br = |x: i32, z: i32| get_biome_region(slot, key, x, z, 1, 1, 1);
        let bra = |x: i32, z: i32, y: i32| get_biome_region_at(slot, key, x, z, 1, 1, 1, y);
        match mode.as_str() {
            "surface" => {
                let surface_y = hr(x >> 2, z >> 2, 1, 1)
                    .and_then(|v| v.into_iter().next())
                    .filter(|h| h.is_finite())
                    .map(|h| h.round() as i32 + 1);
                let id = match surface_y {
                    Some(y) => bra(x, z, y),
                    None    => br(x, z),
                }
                .and_then(|v| v.into_iter().next())
                .unwrap_or(-1);
                // Estimated height can land in a cave pocket near entrances; retry once above.
                if CAVE_BIOME_IDS.contains(&id) {
                    if let Some(y) = surface_y {
                        return bra(x, z, y + 8)
                            .and_then(|v| v.into_iter().next())
                            .unwrap_or(id);
                    }
                }
                id
            }
            "underground" => {
                let surface_y = hr(x >> 2, z >> 2, 1, 1)
                    .and_then(|v| v.into_iter().next())
                    .filter(|h| h.is_finite())
                    .map(|h| h.round() as i32);
                UNDERGROUND_Y_LEVELS.iter()
                    .filter(|&&y_biome| surface_y.is_none_or(|sy| y_biome * 4 < sy))
                    .find_map(|&y_biome| {
                        let id = bra(x, z, y_biome).and_then(|v| v.into_iter().next())?;
                        CAVE_BIOME_IDS.contains(&id).then_some(id)
                    })
                    .unwrap_or(-1)
            }
            _ => {
                let id = br(x, z).and_then(|v| v.into_iter().next()).unwrap_or(-1);
                if CAVE_BIOME_IDS.contains(&id) { -1 } else { id }
            }
        }
    }).await.unwrap_or(-1)
}

#[tauri::command]
pub async fn cubiomes_get_biomes_along_line(
    slot: i32, seed_low: i32, seed_high: i32, dimension: i32, world_flags: i32, mc_version: i32,
    points: Vec<BiomeSamplePoint>,
) -> Vec<i32> {
    let key = GeneratorKey { seed_low, seed_high, dimension, world_flags, mc_version };
    tauri::async_runtime::spawn_blocking(move || {
        get_surface_biomes_at_points(slot, key, &points)
    }).await.unwrap_or_default()
}

/// `None` when `slot`'s config doesn't match — the frontend treats that as
/// "no spawn known yet" rather than drawing a marker at (0, 0).
#[tauri::command]
pub async fn cubiomes_get_spawn(
    slot: i32, seed_low: i32, seed_high: i32, dimension: i32, world_flags: i32, mc_version: i32,
) -> Option<[i32; 2]> {
    let key = GeneratorKey { seed_low, seed_high, dimension, world_flags, mc_version };
    tauri::async_runtime::spawn_blocking(move || {
        get_spawn(slot, key).map(|(x, z)| [x, z])
    }).await.ok().flatten()
}

#[tauri::command]
pub async fn cubiomes_get_height_region(
    slot: i32, seed_low: i32, seed_high: i32, dimension: i32, world_flags: i32, mc_version: i32,
    x: i32, z: i32, w: i32, h: i32,
) -> Option<Vec<f32>> {
    let key = GeneratorKey { seed_low, seed_high, dimension, world_flags, mc_version };
    tauri::async_runtime::spawn_blocking(move || {
        get_height_region(slot, key, x, z, w, h)
    }).await.ok().flatten()
}
