use std::collections::BTreeSet;
use std::sync::Mutex;

// cubiomes uses global C arrays (g_generators, g_surface_noise, …).
// All FFI calls must be serialised through this lock.
pub(super) static CUBIOMES_LOCK: Mutex<()> = Mutex::new(());

// Cooperative cancellation for long-running overlay computations.
//
// Overlay tiles all serialise on CUBIOMES_LOCK, so an abandoned tile (scrolled
// out of view) that is still queued on — or just acquired — the lock would
// otherwise run its full computation and starve the tiles actually on screen.
// The frontend tags each heavy tile fetch with a unique `req_id` and calls
// `cubiomes_cancel_request` on tileunload; heavy commands call `take_cancelled`
// right after acquiring the lock (and once more at the end) and bail early.
pub(super) static CANCELLED: Mutex<BTreeSet<u64>> = Mutex::new(BTreeSet::new());

/// Remove `req_id` from the cancelled set, returning true if it was present.
/// `req_id == 0` is the "no token" sentinel and is never cancelled.
pub(super) fn take_cancelled(req_id: u64) -> bool {
    req_id != 0 && CANCELLED.lock().unwrap().remove(&req_id)
}

/// Mark a tile request as cancelled. Cheap (does not touch CUBIOMES_LOCK), so it
/// runs even while a heavy command holds that lock.
#[tauri::command]
pub fn cubiomes_cancel_request(req_id: u64) {
    if req_id != 0 {
        CANCELLED.lock().unwrap().insert(req_id);
    }
}

#[link(name = "cubiomes")]
unsafe extern "C" {
    pub(super) fn cm_setup_generator(
        seed_low:   i32,
        seed_high:  i32,
        mc_version: i32,
        dimension:  i32,
        flags:      i32,
    ) -> i32;

    pub(super) fn cm_get_biome_region(
        slot:   i32,
        x:      i32,
        z:      i32,
        width:  i32,
        height: i32,
        scale:  i32,
        buffer: *mut i32,
    ) -> i32;

    pub(super) fn cm_get_biome_region_at(
        slot:   i32,
        x:      i32,
        z:      i32,
        width:  i32,
        height: i32,
        scale:  i32,
        y:      i32,
        buffer: *mut i32,
    ) -> i32;

    pub(super) fn cm_find_structures(
        slot:        i32,
        struct_type: i32,
        rx0:         i32,
        rz0:         i32,
        rx1:         i32,
        rz1:         i32,
    ) -> *mut i32;

    pub(super) fn cm_get_strongholds(
        slot:      i32,
        max_count: i32,
        out_buf:   *mut i32,
    ) -> i32;

    pub(super) fn cm_get_spawn(slot: i32, out_x: *mut i32, out_z: *mut i32);

    pub(super) fn cm_get_height_region(
        slot:  i32,
        x:     i32,
        z:     i32,
        w:     i32,
        h:     i32,
        out_y: *mut f32,
    ) -> i32;

    pub(super) fn cm_get_ore_veins_at2(
        seed_lo:       i32,
        seed_hi:       i32,
        cx:            i32,
        cz:            i32,
        copper_y_out:  *mut i32,
        copper_sz_out: *mut i32,
        iron_y_out:    *mut i32,
        iron_sz_out:   *mut i32,
    );

    pub(super) fn cm_generate_ore_features(
        slot:      i32,
        ore_types: *const i32,
        num_types: i32,
        cx0:       i32,
        cz0:       i32,
        cx1:       i32,
        cz1:       i32,
    ) -> *mut i32;

    pub(super) fn cm_get_carved_columns(
        slot: i32,
        cx0:  i32,
        cz0:  i32,
        cx1:  i32,
        cz1:  i32,
    ) -> *mut i32;

    pub(super) fn cm_get_ore_vein_columns(
        slot: i32,
        cx0:  i32,
        cz0:  i32,
        cx1:  i32,
        cz1:  i32,
    ) -> *mut i32;

    pub(super) fn cm_get_structure_loot(
        slot:        i32,
        struct_type: i32,
        pos_x:       i32,
        pos_z:       i32,
    ) -> *mut i32;

    pub(super) fn cm_get_structure_chests(
        slot:        i32,
        struct_type: i32,
        pos_x:       i32,
        pos_z:       i32,
    ) -> *mut std::os::raw::c_char;

    pub(super) fn cm_free_string(ptr: *mut std::os::raw::c_char);

    pub(super) fn cm_item_name(global_id: i32, mc: i32) -> *const std::os::raw::c_char;

    pub(super) fn cm_get_surface_heights(
        slot:   i32,
        x0:     i32,
        z0:     i32,
        w:      i32,
        h:      i32,
        stride: i32,
    ) -> *mut i32;

    pub(super) fn cm_free_results(ptr: *mut i32);
}

pub(super) fn seed_parts(seed: i64) -> (i32, i32) {
    let u = seed as u64;
    (u as i32, (u >> 32) as i32)
}

pub(super) fn seed_from_parts(low: i32, high: i32) -> i64 {
    (((high as u64) << 32) | (low as u32 as u64)) as i64
}

pub mod biomes;
pub mod structures;
pub mod ore_veins;
pub mod carvers;
pub mod terrain;

pub use biomes::*;
pub use ore_veins::*;
pub use carvers::*;
pub use terrain::*;
