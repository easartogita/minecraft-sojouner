use super::{CUBIOMES_LOCK, cm_get_carved_columns, cm_free_results, take_cancelled};

/// Carver (cave/ravine/canyon) coverage for a chunk range, using the generator
/// already set up at `slot`. Overworld only.
///
/// Returns `[nx, nz, then nx*nz * 256 ints]`: a 16x16 grid of per-column carved
/// block counts per chunk (column index `localZ*16 + localX`, 0 = solid),
/// chunks in row-major order.
#[tauri::command]
pub async fn cubiomes_get_carved_columns(
    slot: i32, cx0: i32, cz0: i32, cx1: i32, cz1: i32, req_id: u64,
) -> Vec<i32> {
    tauri::async_runtime::spawn_blocking(move || {
        // Hold the lock across the whole call so the generator slot can't be recycled.
        let _guard = CUBIOMES_LOCK.lock().unwrap();
        // Bail if the tile was abandoned while we waited for the lock.
        if take_cancelled(req_id) { return Vec::new(); }
        let ptr = unsafe { cm_get_carved_columns(slot, cx0, cz0, cx1, cz1) };
        if ptr.is_null() { return Vec::new(); }
        let v = unsafe {
            let nx = (*ptr).max(0) as usize;
            let nz = (*ptr.add(1)).max(0) as usize;
            let total = 2 + nx * nz * 256;
            let out = std::slice::from_raw_parts(ptr, total).to_vec();
            cm_free_results(ptr);
            out
        };
        take_cancelled(req_id); // clear any late cancel so the set stays bounded
        v
    }).await.unwrap_or_default()
}
