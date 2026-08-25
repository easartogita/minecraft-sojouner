use super::{
    lock_cubiomes, take_cancelled,
    cm_generate_ore_features, cm_get_ore_vein_columns, cm_get_ore_vein_column_at, cm_free_results,
    slot_matches_locked, GeneratorKey,
};

// ── Sync cores ────────────────────────────────────────────────────────────────
// For callers already on a blocking thread that hold `lock_cubiomes()` for their
// whole operation (e.g. the live tile renderer) — no req_id/cancellation needed.

/// Generate ore-feature positions (normal ore blobs) for the given `Ores` enum
/// types over a chunk range, using the generator already set up at `slot`.
/// Returns a flat array `[oreType, x, y, z, ...]` (block coordinates).
pub(crate) fn generate_ore_features_locked(
    slot: i32, key: GeneratorKey, ore_types: &[i32], cx0: i32, cz0: i32, cx1: i32, cz1: i32,
) -> Vec<i32> {
    // Reject before the FFI call — an unclamped nx*nz would size a C-side allocation.
    if (cx1 - cx0 + 1).saturating_mul(cz1 - cz0 + 1) > 65536 { return Vec::new(); }
    if !slot_matches_locked(slot, key) { return Vec::new(); }
    let ptr = unsafe {
        cm_generate_ore_features(
            slot, ore_types.as_ptr(), ore_types.len() as i32, cx0, cz0, cx1, cz1,
        )
    };
    if ptr.is_null() { return Vec::new(); }
    unsafe {
        let count = (*ptr).max(0) as usize;
        let out = std::slice::from_raw_parts(ptr.add(1), count * 4).to_vec();
        cm_free_results(ptr);
        out
    }
}

/// Per-column ore-vein footprint for a chunk range, using the generator already
/// set up at `slot`. The cave-layer analogue of `get_carved_columns_locked`.
///
/// Returns `[nx, nz, then nx*nz * 256 * 2 ints]`: a 16x16 grid of per-column
/// (copper_count, iron_count) of vein-affected blocks per chunk (column index
/// `localZ*16 + localX`), chunks in row-major order. Overworld only.
pub(crate) fn get_ore_vein_columns_locked(
    slot: i32, key: GeneratorKey, cx0: i32, cz0: i32, cx1: i32, cz1: i32,
) -> Vec<i32> {
    // Reject before the FFI call — an unclamped nx*nz would size a C-side allocation.
    if (cx1 - cx0 + 1).saturating_mul(cz1 - cz0 + 1) > 65536 { return Vec::new(); }
    if !slot_matches_locked(slot, key) { return Vec::new(); }
    let ptr = unsafe { cm_get_ore_vein_columns(slot, cx0, cz0, cx1, cz1) };
    if ptr.is_null() { return Vec::new(); }
    unsafe {
        let nx = (*ptr).max(0) as usize;
        let nz = (*ptr.add(1)).max(0) as usize;
        let total = 2 + nx * nz * 512;
        let out = std::slice::from_raw_parts(ptr, total).to_vec();
        cm_free_results(ptr);
        out
    }
}

/// Ore-vein detail for the single column under the cursor, using the generator
/// already set up at `slot`. The hover-resolution analogue of
/// `get_ore_vein_columns_locked`: same real per-block probe, but keeps each
/// vein's Y range instead of collapsing it to a footprint count.
///
/// Returns `[copper_count, copper_minY, copper_maxY, iron_count, iron_minY, iron_maxY]`;
/// minY/maxY are `i32::MIN` when count is 0. Overworld only.
pub(crate) fn get_ore_vein_column_at_locked(
    slot: i32, key: GeneratorKey, bx: i32, bz: i32,
) -> Vec<i32> {
    if !slot_matches_locked(slot, key) { return Vec::new(); }
    let ptr = unsafe { cm_get_ore_vein_column_at(slot, bx, bz) };
    if ptr.is_null() { return Vec::new(); }
    unsafe {
        let out = std::slice::from_raw_parts(ptr, 6).to_vec();
        cm_free_results(ptr);
        out
    }
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Generate ore-feature positions (normal ore blobs) for the given `Ores` enum
/// types over a chunk range, using the generator already set up at `slot`.
/// Returns a flat array `[oreType, x, y, z, ...]` (block coordinates).
#[tauri::command]
pub async fn cubiomes_generate_ore_features(
    slot: i32, seed_low: i32, seed_high: i32, dimension: i32, world_flags: i32, mc_version: i32,
    ore_types: Vec<i32>,
    cx0: i32, cz0: i32, cx1: i32, cz1: i32, req_id: u64,
) -> Vec<i32> {
    let key = GeneratorKey { seed_low, seed_high, dimension, world_flags, mc_version };
    tauri::async_runtime::spawn_blocking(move || {
        // Hold the lock across the whole call so the generator slot can't be recycled.
        let _guard = lock_cubiomes();
        // Bail if the tile was abandoned while we waited for the lock.
        if take_cancelled(req_id) { return Vec::new(); }
        let v = generate_ore_features_locked(slot, key, &ore_types, cx0, cz0, cx1, cz1);
        take_cancelled(req_id); // clear any late cancel so the set stays bounded
        v
    }).await.unwrap_or_default()
}

/// Per-column ore-vein footprint for a chunk range, using the generator already
/// set up at `slot`. The cave-layer analogue of `cubiomes_get_carved_columns`.
///
/// Returns `[nx, nz, then nx*nz * 256 * 2 ints]`: a 16x16 grid of per-column
/// (copper_count, iron_count) of vein-affected blocks per chunk (column index
/// `localZ*16 + localX`), chunks in row-major order. Overworld only.
#[tauri::command]
pub async fn cubiomes_get_ore_vein_columns(
    slot: i32, seed_low: i32, seed_high: i32, dimension: i32, world_flags: i32, mc_version: i32,
    cx0: i32, cz0: i32, cx1: i32, cz1: i32, req_id: u64,
) -> Vec<i32> {
    let key = GeneratorKey { seed_low, seed_high, dimension, world_flags, mc_version };
    tauri::async_runtime::spawn_blocking(move || {
        // Hold the lock across the whole call so the generator slot can't be recycled.
        let _guard = lock_cubiomes();
        // Bail if the tile was abandoned while we waited for the lock.
        if take_cancelled(req_id) { return Vec::new(); }
        let v = get_ore_vein_columns_locked(slot, key, cx0, cz0, cx1, cz1);
        take_cancelled(req_id); // clear any late cancel so the set stays bounded
        v
    }).await.unwrap_or_default()
}

/// Ore-vein detail for the single column under the cursor, using the generator
/// already set up at `slot`. The hover-resolution analogue of
/// `cubiomes_get_ore_vein_columns`.
///
/// Returns `[copper_count, copper_minY, copper_maxY, iron_count, iron_minY, iron_maxY]`;
/// minY/maxY are `i32::MIN` when count is 0. Overworld only.
#[tauri::command]
pub async fn cubiomes_get_ore_vein_column_at(
    slot: i32, seed_low: i32, seed_high: i32, dimension: i32, world_flags: i32, mc_version: i32,
    bx: i32, bz: i32,
) -> Vec<i32> {
    let key = GeneratorKey { seed_low, seed_high, dimension, world_flags, mc_version };
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock_cubiomes();
        get_ore_vein_column_at_locked(slot, key, bx, bz)
    }).await.unwrap_or_default()
}
