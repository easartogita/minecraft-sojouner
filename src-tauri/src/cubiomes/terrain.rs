use super::{CUBIOMES_LOCK, cm_get_surface_heights, cm_free_results};

/// Real preliminary surface heightmap for a `w`×`h` grid starting at `(x0, z0)`,
/// where consecutive samples are `stride` blocks apart. Uses the generator
/// already set up at `slot`. Overworld, 1.18+.
///
/// Returns `w*h` surface Y values (row-major). This is the actual terrain noise
/// surface level, more accurate than the biome-based height approximation.
#[tauri::command]
pub async fn cubiomes_get_surface_heights(
    slot: i32, x0: i32, z0: i32, w: i32, h: i32, stride: i32,
) -> Vec<i32> {
    tauri::async_runtime::spawn_blocking(move || {
        // Hold the lock across the whole call so the generator slot can't be recycled.
        let _guard = CUBIOMES_LOCK.lock().unwrap();
        let ptr = unsafe { cm_get_surface_heights(slot, x0, z0, w, h, stride) };
        if ptr.is_null() { return Vec::new(); }
        unsafe {
            let n = (w.max(0) as usize) * (h.max(0) as usize);
            let v = std::slice::from_raw_parts(ptr, n).to_vec();
            cm_free_results(ptr);
            v
        }
    }).await.unwrap_or_default()
}
