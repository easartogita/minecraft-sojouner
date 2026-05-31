use std::sync::Mutex;

// cubiomes uses global C arrays (g_generators, g_surface_noise, …).
// All FFI calls must be serialised through this lock.
pub(super) static CUBIOMES_LOCK: Mutex<()> = Mutex::new(());

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

pub use biomes::*;
pub use ore_veins::*;
