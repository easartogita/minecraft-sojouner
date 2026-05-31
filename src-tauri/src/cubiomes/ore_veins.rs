use super::{
    CUBIOMES_LOCK,
    cm_get_ore_veins_at2,
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
    let _guard = CUBIOMES_LOCK.lock().unwrap();
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

/// Returns a flat array [copper_y, copper_size, iron_y, iron_size, ...] per chunk.
/// size: 0=no ore (tuff only), 1=small, 2=medium, 3=large. y is i32::MIN when size==0.
#[tauri::command]
pub async fn cubiomes_get_ore_veins_ex(
    seed_low: i32, seed_high: i32,
    cx0: i32, cz0: i32, cx1: i32, cz1: i32,
) -> Vec<i32> {
    let seed = seed_from_parts(seed_low, seed_high);
    tauri::async_runtime::spawn_blocking(move || {
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
