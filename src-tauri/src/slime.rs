// Slime chunk detection — pure Java LCG reimplementation.
// Mirrors the BigInt logic in the deleted TS slimeChunks.ts.
//
// Java source:
//   new Random(seed + (long)(cx*cx*0x4c1906) + (long)(cx*0x5ac0db)
//            + (long)(cz*cz)*0x4307a7L + (long)(cz*0x5f24f)
//            ^ 0x3ad8025fL).nextInt(10) == 0
//
// All intermediate `cx`/`cz` multiplications use wrapping i32 arithmetic
// to reproduce Java int overflow before the cast to long.

fn seed_from_parts(low: i32, high: i32) -> i64 {
    ((high as i64) << 32) | ((low as u32) as i64)
}

fn is_slime_chunk_impl(world_seed: i64, cx: i32, cz: i32) -> bool {
    const LCG_MULT: i64 = 0x5DEECE66D;
    const LCG_ADD:  i64 = 0xB;
    const MASK48:   i64 = (1i64 << 48) - 1;

    let term1 = (cx.wrapping_mul(cx).wrapping_mul(0x4C1906)) as i64;
    let term2 = cx.wrapping_mul(0x5AC0DB) as i64;
    let term3 = (cz.wrapping_mul(cz) as i64).wrapping_mul(0x4307A7);
    let term4 = cz.wrapping_mul(0x5F24F) as i64;

    let s = world_seed
        .wrapping_add(term1)
        .wrapping_add(term2)
        .wrapping_add(term3)
        .wrapping_add(term4)
        ^ 0x3AD8025F;

    let s = (s ^ LCG_MULT) & MASK48;
    let s = s.wrapping_mul(LCG_MULT).wrapping_add(LCG_ADD) & MASK48;

    (s as u64 >> 17) % 10 == 0
}

#[tauri::command]
pub fn is_slime_chunk(seed_low: i32, seed_high: i32, cx: i32, cz: i32) -> bool {
    is_slime_chunk_impl(seed_from_parts(seed_low, seed_high), cx, cz)
}

/// Returns a flat row-major bool array for [cz0..cz1] × [cx0..cx1].
#[tauri::command]
pub fn get_slime_chunks(
    seed_low: i32, seed_high: i32,
    cx0: i32, cz0: i32,
    cx1: i32, cz1: i32,
) -> Vec<bool> {
    let seed = seed_from_parts(seed_low, seed_high);
    let width = (cx1 - cx0 + 1) as usize;
    let mut out = vec![false; width * (cz1 - cz0 + 1) as usize];
    for cz in cz0..=cz1 {
        for cx in cx0..=cx1 {
            let i = (cz - cz0) as usize * width + (cx - cx0) as usize;
            out[i] = is_slime_chunk_impl(seed, cx, cz);
        }
    }
    out
}
