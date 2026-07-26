use serde::{Deserialize, Serialize};
use super::{
    lock_cubiomes,
    cm_setup_generator, cm_slot_matches, cm_get_biome_region, cm_get_biome_region_at,
    cm_get_height_region, cm_get_spawn,
    seed_from_parts,
};

pub fn setup_generator(seed: i64, mc_version: i32, dimension: i32, flags: i32) -> i32 {
    let u = seed as u64;
    let (lo, hi) = (u as i32, (u >> 32) as i32);
    let _guard = lock_cubiomes();
    unsafe { cm_setup_generator(lo, hi, mc_version, dimension, flags) }
}

/// True if `slot`'s generator is currently configured for exactly this seed and
/// dimension. Slots are recycled round-robin, so a queued render can reach a slot
/// that has been repointed to another world (world switch) or dimension; callers
/// verify this before generating/caching per-(seed, dimension) data.
pub fn slot_matches(slot: i32, seed_low: i32, seed_high: i32, dimension: i32) -> bool {
    let _guard = lock_cubiomes();
    unsafe { cm_slot_matches(slot, seed_low, seed_high, dimension) != 0 }
}

pub fn get_biome_region(
    slot: i32,
    x: i32, z: i32,
    width: i32, height: i32,
    scale: i32,
) -> Option<Vec<i32>> {
    let n = (width * height) as usize;
    let mut buf = vec![0i32; n];
    let _guard = lock_cubiomes();
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
    slot: i32,
    x: i32, z: i32,
    width: i32, height: i32,
    scale: i32, y: i32,
) -> Option<Vec<i32>> {
    let n = (width * height) as usize;
    let mut buf = vec![0i32; n];
    let _guard = lock_cubiomes();
    let rc = unsafe { cm_get_biome_region_at(slot, x, z, width, height, scale, y, buf.as_mut_ptr()) };
    if rc == 0 { Some(buf) } else { None }
}

pub fn get_height_region(slot: i32, x: i32, z: i32, w: i32, h: i32) -> Option<Vec<f32>> {
    let n = (w * h) as usize;
    let mut buf = vec![0f32; n];
    let _guard = lock_cubiomes();
    let rc = unsafe { cm_get_height_region(slot, x, z, w, h, buf.as_mut_ptr()) };
    if rc == 0 { Some(buf) } else { None }
}

pub fn get_spawn(slot: i32) -> (i32, i32) {
    let mut x = 0i32;
    let mut z = 0i32;
    let _guard = lock_cubiomes();
    unsafe { cm_get_spawn(slot, &mut x, &mut z) };
    (x, z)
}

#[derive(Deserialize)]
pub struct BiomeSamplePoint { pub x: i32, pub z: i32 }

/// Batched surface-biome sampling along an arbitrary set of points — one
/// CUBIOMES_LOCK acquisition for the whole batch, instead of one per point.
/// Used to classify long map-drawn lines (Route Planner boat legs) without
/// paying per-point IPC + mutex overhead for each sample. Samples at the
/// approximate surface height (same as the hover HUD) — a fixed-Y sample sits
/// inside the terrain under tall peaks and misreads as cave biomes, blanking
/// the classification. Uses the raw FFI calls, not the safe wrappers: the lock
/// is held once for the whole batch and the wrappers would deadlock re-taking it.
pub fn get_surface_biomes_at_points(slot: i32, points: &[BiomeSamplePoint]) -> Vec<i32> {
    const CAVE_BIOMES: &[i32] = &[174, 175, 183, 187]; // dripstone_caves, lush_caves, deep_dark, sulfur_caves
    let _guard = lock_cubiomes();
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
    slot: i32, x: i32, z: i32, width: i32, height: i32, scale: i32,
) -> Option<BiomeRegionResult> {
    tauri::async_runtime::spawn_blocking(move || {
        get_biome_region(slot, x, z, width, height, scale)
            .map(|biomes| BiomeRegionResult { biomes, width, height })
    }).await.ok().flatten()
}

/// Like cubiomes_get_biomes but queries at an explicit biome Y coordinate.
/// y is in cubiomes biome space: Minecraft block Y divided by 4 (for scale > 1).
#[tauri::command]
pub async fn cubiomes_get_biomes_at(
    slot: i32, x: i32, z: i32, width: i32, height: i32, scale: i32, y: i32,
) -> Option<BiomeRegionResult> {
    tauri::async_runtime::spawn_blocking(move || {
        get_biome_region_at(slot, x, z, width, height, scale, y)
            .map(|biomes| BiomeRegionResult { biomes, width, height })
    }).await.ok().flatten()
}

/// Return the biome ID at (x, z) appropriate for the given display mode.
/// "surface"     → 3D query at the approximate surface height. A fixed-Y query
///                 (the old y=64 default) lands *inside* the terrain under tall
///                 peaks (surface Y > ~150) and resolves to cave biomes, which
///                 the surface filter then blanks out.
/// "underground" → 3D query at Y -8 (block Y -32); returns -1 if not a cave biome.
/// "deep"        → 3D query at Y -13 (block Y -52); returns -1 if not a cave biome.
/// Any other mode (nether, end, etc.) → query at the generator default (Y 64).
#[tauri::command]
pub async fn cubiomes_get_hover_biome(slot: i32, x: i32, z: i32, mode: String) -> i32 {
    const CAVE_BIOMES: &[i32] = &[174, 175, 183, 187]; // dripstone_caves, lush_caves, deep_dark, sulfur_caves
    tauri::async_runtime::spawn_blocking(move || {
        match mode.as_str() {
            "surface" => {
                let surface_y = get_height_region(slot, x >> 2, z >> 2, 1, 1)
                    .and_then(|v| v.into_iter().next())
                    .filter(|h| h.is_finite())
                    .map(|h| h.round() as i32 + 1);
                let id = match surface_y {
                    Some(y) => get_biome_region_at(slot, x, z, 1, 1, 1, y),
                    None    => get_biome_region(slot, x, z, 1, 1, 1),
                }
                .and_then(|v| v.into_iter().next())
                .unwrap_or(-1);
                // Height is an estimate; a cave pocket at the sampled Y is
                // possible near entrances. One retry above, then report
                // whatever is there rather than blanking the HUD.
                if CAVE_BIOMES.contains(&id) {
                    if let Some(y) = surface_y {
                        return get_biome_region_at(slot, x, z, 1, 1, 1, y + 8)
                            .and_then(|v| v.into_iter().next())
                            .unwrap_or(id);
                    }
                }
                id
            }
            "underground" => {
                let id = get_biome_region_at(slot, x, z, 1, 1, 1, -8)
                    .and_then(|v| v.into_iter().next())
                    .unwrap_or(-1);
                if CAVE_BIOMES.contains(&id) { id } else { -1 }
            }
            "deep" => {
                let id = get_biome_region_at(slot, x, z, 1, 1, 1, -13)
                    .and_then(|v| v.into_iter().next())
                    .unwrap_or(-1);
                if CAVE_BIOMES.contains(&id) { id } else { -1 }
            }
            _ => {
                let id = get_biome_region(slot, x, z, 1, 1, 1)
                    .and_then(|v| v.into_iter().next())
                    .unwrap_or(-1);
                if CAVE_BIOMES.contains(&id) { -1 } else { id }
            }
        }
    }).await.unwrap_or(-1)
}

#[tauri::command]
pub async fn cubiomes_get_biomes_along_line(slot: i32, points: Vec<BiomeSamplePoint>) -> Vec<i32> {
    tauri::async_runtime::spawn_blocking(move || {
        get_surface_biomes_at_points(slot, &points)
    }).await.unwrap_or_default()
}

#[tauri::command]
pub async fn cubiomes_get_spawn(slot: i32) -> [i32; 2] {
    tauri::async_runtime::spawn_blocking(move || {
        let (x, z) = get_spawn(slot);
        [x, z]
    }).await.unwrap_or([0, 0])
}

#[tauri::command]
pub async fn cubiomes_get_height_region(slot: i32, x: i32, z: i32, w: i32, h: i32) -> Option<Vec<f32>> {
    tauri::async_runtime::spawn_blocking(move || {
        get_height_region(slot, x, z, w, h)
    }).await.ok().flatten()
}
