use super::{
    lock_cubiomes, take_cancelled,
    cm_get_ore_veins_at2, cm_generate_ore_features, cm_get_ore_vein_columns, cm_free_results,
    seed_parts, seed_from_parts,
};

/// Returns `(copper_y, copper_size, iron_y, iron_size)`.
/// size 0 = no ore (tuff only or nothing); 1/2/3 = small/medium/large.
/// y is i32::MIN when size == 0.
pub fn get_ore_veins_at(seed: i64, cx: i32, cz: i32) -> (i32, i32, i32, i32) {
    let (lo, hi) = seed_parts(seed);
    let mut copper_y  = i32::MIN;
    let mut copper_sz = 0i32;
    let mut iron_y    = i32::MIN;
    let mut iron_sz   = 0i32;
    let _guard = lock_cubiomes();
    unsafe {
        cm_get_ore_veins_at2(lo, hi, cx, cz,
            &mut copper_y, &mut copper_sz,
            &mut iron_y,   &mut iron_sz);
    }
    (copper_y, copper_sz, iron_y, iron_sz)
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Returns [copper_y, copper_size, iron_y, iron_size].
/// size: 0=no ore (tuff only), 1=small, 2=medium, 3=large. y is i32::MIN when size==0.
#[tauri::command]
pub async fn cubiomes_get_ore_veins_at(
    seed_low: i32, seed_high: i32,
    cx: i32, cz: i32,
) -> [i32; 4] {
    let seed = seed_from_parts(seed_low, seed_high);
    tauri::async_runtime::spawn_blocking(move || {
        let (copper_y, copper_sz, iron_y, iron_sz) = get_ore_veins_at(seed, cx, cz);
        [copper_y, copper_sz, iron_y, iron_sz]
    }).await.unwrap_or([i32::MIN, 0, i32::MIN, 0])
}

/// Generate ore-feature positions (normal ore blobs) for the given `Ores` enum
/// types over a chunk range, using the generator already set up at `slot`.
/// Returns a flat array `[oreType, x, y, z, ...]` (block coordinates).
#[tauri::command]
pub async fn cubiomes_generate_ore_features(
    slot: i32, ore_types: Vec<i32>,
    cx0: i32, cz0: i32, cx1: i32, cz1: i32, req_id: u64,
) -> Vec<i32> {
    tauri::async_runtime::spawn_blocking(move || {
        // Same chunk-count cap as structures.rs's region cap: reject an
        // out-of-range request before it can size a C-side allocation off
        // unclamped nx*nz.
        if (cx1 - cx0 + 1).saturating_mul(cz1 - cz0 + 1) > 65536 { return Vec::new(); }
        // Hold the lock across the whole call so the generator slot can't be recycled.
        let _guard = lock_cubiomes();
        // Bail if the tile was abandoned while we waited for the lock.
        if take_cancelled(req_id) { return Vec::new(); }
        let ptr = unsafe {
            cm_generate_ore_features(
                slot, ore_types.as_ptr(), ore_types.len() as i32, cx0, cz0, cx1, cz1,
            )
        };
        if ptr.is_null() { return Vec::new(); }
        let v = unsafe {
            let count = (*ptr).max(0) as usize;
            let out = std::slice::from_raw_parts(ptr.add(1), count * 4).to_vec();
            cm_free_results(ptr);
            out
        };
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
    slot: i32, cx0: i32, cz0: i32, cx1: i32, cz1: i32, req_id: u64,
) -> Vec<i32> {
    tauri::async_runtime::spawn_blocking(move || {
        // Same chunk-count cap as structures.rs's region cap: reject an
        // out-of-range request before it can size a C-side allocation off
        // unclamped nx*nz.
        if (cx1 - cx0 + 1).saturating_mul(cz1 - cz0 + 1) > 65536 { return Vec::new(); }
        // Hold the lock across the whole call so the generator slot can't be recycled.
        let _guard = lock_cubiomes();
        // Bail if the tile was abandoned while we waited for the lock.
        if take_cancelled(req_id) { return Vec::new(); }
        let ptr = unsafe { cm_get_ore_vein_columns(slot, cx0, cz0, cx1, cz1) };
        if ptr.is_null() { return Vec::new(); }
        let v = unsafe {
            let nx = (*ptr).max(0) as usize;
            let nz = (*ptr.add(1)).max(0) as usize;
            let total = 2 + nx * nz * 512;
            let out = std::slice::from_raw_parts(ptr, total).to_vec();
            cm_free_results(ptr);
            out
        };
        take_cancelled(req_id); // clear any late cancel so the set stays bounded
        v
    }).await.unwrap_or_default()
}

/// Returns a flat array [copper_y, copper_size, iron_y, iron_size, ...] per chunk.
/// size: 0=no ore (tuff only), 1=small, 2=medium, 3=large. y is i32::MIN when size==0.
#[tauri::command]
pub async fn cubiomes_get_ore_veins_ex(
    seed_low: i32, seed_high: i32,
    cx0: i32, cz0: i32, cx1: i32, cz1: i32,
) -> Vec<i32> {
    let seed = seed_from_parts(seed_low, seed_high);
    tauri::async_runtime::spawn_blocking(move || {
        // Same chunk-count cap as structures.rs's region cap: this path
        // allocates directly in Rust (no C bridge), so an unclamped range
        // would still be a self-inflicted huge-Vec allocation.
        if (cx1 - cx0 + 1).saturating_mul(cz1 - cz0 + 1) > 65536 { return Vec::new(); }
        let w = (cx1 - cx0 + 1) as usize;
        let n = w * (cz1 - cz0 + 1) as usize;
        let mut result = vec![i32::MIN; n * 4];
        for i in 0..n {
            let cx = cx0 + (i % w) as i32;
            let cz = cz0 + (i / w) as i32;
            let (copper_y, copper_sz, iron_y, iron_sz) = get_ore_veins_at(seed, cx, cz);
            result[i * 4    ] = copper_y;
            result[i * 4 + 1] = copper_sz;
            result[i * 4 + 2] = iron_y;
            result[i * 4 + 3] = iron_sz;
        }
        result
    }).await.unwrap_or_default()
}
