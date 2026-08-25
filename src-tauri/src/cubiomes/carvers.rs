use super::{lock_cubiomes, cm_get_carved_columns, cm_free_results, take_cancelled, slot_matches_locked, GeneratorKey};

/// Sync core of `cubiomes_get_carved_columns`, for callers already on a blocking
/// thread (e.g. the live tile renderer) that hold `lock_cubiomes()` for their
/// whole operation — no `req_id`/cancellation needed here.
///
/// Returns `[nx, nz, then nx*nz * 256 ints]`: a 16x16 per-column carved block
/// count grid per chunk (index `localZ*16 + localX`, 0 = solid), row-major.
pub(crate) fn get_carved_columns_locked(
    slot: i32, key: GeneratorKey, cx0: i32, cz0: i32, cx1: i32, cz1: i32,
) -> Vec<i32> {
    // Reject before the FFI call — an unclamped nx*nz would size a calloc in the C bridge.
    if (cx1 - cx0 + 1).saturating_mul(cz1 - cz0 + 1) > 65536 { return Vec::new(); }
    if !slot_matches_locked(slot, key) { return Vec::new(); }
    let ptr = unsafe { cm_get_carved_columns(slot, cx0, cz0, cx1, cz1) };
    if ptr.is_null() { return Vec::new(); }
    unsafe {
        let nx = (*ptr).max(0) as usize;
        let nz = (*ptr.add(1)).max(0) as usize;
        let total = 2 + nx * nz * 256;
        let out = std::slice::from_raw_parts(ptr, total).to_vec();
        cm_free_results(ptr);
        out
    }
}

/// Carver (cave/ravine/canyon) coverage for a chunk range, using the generator
/// at `slot`. Overworld and nether have carvers; End yields empty. Same
/// `[nx, nz, ...]` grid layout as `get_carved_columns_locked`.
#[tauri::command]
pub async fn cubiomes_get_carved_columns(
    slot: i32, seed_low: i32, seed_high: i32, dimension: i32, world_flags: i32, mc_version: i32,
    cx0: i32, cz0: i32, cx1: i32, cz1: i32, req_id: u64,
) -> Vec<i32> {
    let key = GeneratorKey { seed_low, seed_high, dimension, world_flags, mc_version };
    tauri::async_runtime::spawn_blocking(move || {
        // Hold the lock across the whole call so the generator slot can't be recycled.
        let _guard = lock_cubiomes();
        // Bail if the tile was abandoned while we waited for the lock.
        if take_cancelled(req_id) { return Vec::new(); }
        let v = get_carved_columns_locked(slot, key, cx0, cz0, cx1, cz1);
        take_cancelled(req_id); // clear any late cancel so the set stays bounded
        v
    }).await.unwrap_or_default()
}
