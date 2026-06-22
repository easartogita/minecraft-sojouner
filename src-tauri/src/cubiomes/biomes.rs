use serde::Serialize;
use super::{
    CUBIOMES_LOCK,
    cm_setup_generator, cm_get_biome_region, cm_get_biome_region_at,
    cm_get_height_region, cm_get_spawn,
    seed_from_parts,
};

pub fn setup_generator(seed: i64, mc_version: i32, dimension: i32, flags: i32) -> i32 {
    let u = seed as u64;
    let (lo, hi) = (u as i32, (u >> 32) as i32);
    let _guard = CUBIOMES_LOCK.lock().unwrap();
    unsafe { cm_setup_generator(lo, hi, mc_version, dimension, flags) }
}

pub fn get_biome_region(
    slot: i32,
    x: i32, z: i32,
    width: i32, height: i32,
    scale: i32,
) -> Option<Vec<i32>> {
    let n = (width * height) as usize;
    let mut buf = vec![0i32; n];
    let _guard = CUBIOMES_LOCK.lock().unwrap();
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
    let _guard = CUBIOMES_LOCK.lock().unwrap();
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
    let _guard = CUBIOMES_LOCK.lock().unwrap();
    let rc = unsafe { cm_get_biome_region_at(slot, x, z, width, height, scale, y, buf.as_mut_ptr()) };
    if rc == 0 { Some(buf) } else { None }
}

pub fn get_height_region(slot: i32, x: i32, z: i32, w: i32, h: i32) -> Option<Vec<f32>> {
    let n = (w * h) as usize;
    let mut buf = vec![0f32; n];
    let _guard = CUBIOMES_LOCK.lock().unwrap();
    let rc = unsafe { cm_get_height_region(slot, x, z, w, h, buf.as_mut_ptr()) };
    if rc == 0 { Some(buf) } else { None }
}

pub fn get_spawn(slot: i32) -> (i32, i32) {
    let mut x = 0i32;
    let mut z = 0i32;
    let _guard = CUBIOMES_LOCK.lock().unwrap();
    unsafe { cm_get_spawn(slot, &mut x, &mut z) };
    (x, z)
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
/// "surface"     → 2D query (no Y), matches the biome tile renderer exactly.
/// "underground" → 3D query at Y -8 (block Y -32); returns -1 if not a cave biome.
/// "deep"        → 3D query at Y -13 (block Y -52); returns -1 if not a cave biome.
/// Any other mode (nether, end, etc.) → 2D query.
#[tauri::command]
pub async fn cubiomes_get_hover_biome(slot: i32, x: i32, z: i32, mode: String) -> i32 {
    const CAVE_BIOMES: &[i32] = &[174, 175, 183, 187]; // dripstone_caves, lush_caves, deep_dark, sulfur_caves
    tauri::async_runtime::spawn_blocking(move || {
        match mode.as_str() {
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
