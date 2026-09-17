// Ad-hoc verification CLI for structure_copy::force_relight_chunks — same
// rationale as the other bin/*_cli.rs tools (exact args, real main thread for
// Tauri's build()). Debug-only, mirroring structure_copy's own
// #[cfg(debug_assertions)] gate. Flips isLightOn back to false on every chunk
// in the given box, forcing a full re-light on next load; doesn't touch blocks.

#[cfg(debug_assertions)]
fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 7 {
        eprintln!(
            "Usage: {} <dst level.dat> <dimension> <cx0> <cz0> <cx1> <cz1> [--override-live-lock]",
            args[0]
        );
        std::process::exit(1);
    }
    let level_dat = args[1].clone();
    let dimension = args[2].clone();
    let n = |i: usize| args[i].parse::<i32>().unwrap_or_else(|e| panic!("bad integer argument {:?}: {e}", args[i]));
    let (cx0, cz0, cx1, cz1) = (n(3), n(4), n(5), n(6));
    let override_live_lock = args.iter().any(|a| a == "--override-live-lock");
    let (cx0, cx1) = (cx0.min(cx1), cx0.max(cx1));
    let (cz0, cz1) = (cz0.min(cz1), cz0.max(cz1));

    let mut chunks = Vec::new();
    for cx in cx0..=cx1 {
        for cz in cz0..=cz1 {
            chunks.push((cx, cz));
        }
    }
    eprintln!("relight_chunks_cli: {} chunks in box ({cx0},{cz0})..=({cx1},{cz1})", chunks.len());

    let app = tauri::Builder::default()
        .build(tauri::generate_context!())
        .expect("relight_chunks_cli: failed to build headless Tauri app");
    let handle = app.handle().clone();

    let start = std::time::Instant::now();
    let result = sojourner_lib::structure_copy::force_relight_chunks(handle, level_dat, dimension, chunks, override_live_lock);
    let elapsed = start.elapsed();

    match result {
        Ok(report) => {
            println!("relight_chunks_cli: DONE in {:.2}s\n{report:#?}", elapsed.as_secs_f64());
            std::process::exit(0);
        }
        Err(e) => {
            eprintln!("relight_chunks_cli: FAILED after {:.2}s: {e}", elapsed.as_secs_f64());
            std::process::exit(1);
        }
    }
}

#[cfg(not(debug_assertions))]
fn main() {
    eprintln!("relight_chunks_cli: not available in release builds (structure_copy is dev-only)");
    std::process::exit(1);
}
