// Ad-hoc verification CLI for block-box copy/rotate/mirror — not a shipped
// feature. Exists because the GUI can't be driven with pixel-precise block
// coordinates, and because Tauri's build() needs the real main thread (GTK's
// event loop), ruling out `cargo test`. Debug-only, mirroring structure_copy's
// own #[cfg(debug_assertions)] gate. Source and destination are always the
// same world/dimension — extend the args if a cross-world case is needed.

#[cfg(debug_assertions)]
fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 13 {
        eprintln!(
            "Usage: {} <level.dat> <dimension> <x0> <y0> <z0> <x1> <y1> <z1> <dst_x> <dst_y> <dst_z> <rotation> [mirror: x|z] [--override-live-lock]",
            args[0]
        );
        std::process::exit(1);
    }
    let level_dat = args[1].clone();
    let dimension = args[2].clone();
    let n = |i: usize| args[i].parse::<i32>().unwrap_or_else(|e| panic!("bad integer argument {:?}: {e}", args[i]));
    let src_box = (n(3), n(4), n(5), n(6), n(7), n(8));
    let dst_origin = (n(9), n(10), n(11));
    let rotation = n(12);
    let override_live_lock = args.iter().any(|a| a == "--override-live-lock");
    let mirror = args.get(13).filter(|a| a.as_str() != "--override-live-lock").cloned();

    let app = tauri::Builder::default()
        .build(tauri::generate_context!())
        .expect("copy_blocks_cli: failed to build headless Tauri app");
    let handle = app.handle().clone();

    let start = std::time::Instant::now();
    let result = sojourner_lib::structure_copy::blocks::copy_blocks(
        handle,
        level_dat.clone(), dimension.clone(),
        level_dat, dimension,
        src_box, dst_origin, rotation, mirror, override_live_lock,
    );
    let elapsed = start.elapsed();

    match result {
        Ok(report) => {
            println!("copy_blocks_cli: DONE in {:.2}s\n{report:#?}", elapsed.as_secs_f64());
            std::process::exit(0);
        }
        Err(e) => {
            eprintln!("copy_blocks_cli: FAILED after {:.2}s: {e}", elapsed.as_secs_f64());
            std::process::exit(1);
        }
    }
}

#[cfg(not(debug_assertions))]
fn main() {
    eprintln!("copy_blocks_cli: not available in release builds (structure_copy is dev-only)");
    std::process::exit(1);
}
