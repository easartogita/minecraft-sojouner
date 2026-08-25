// Ad-hoc verification CLI for paste_structure_template — same rationale as
// bin/copy_blocks_cli.rs (pixel-precise GUI can't take exact coords; real
// main thread needed for Tauri's build()). Debug-only, mirroring
// structure_copy's own #[cfg(debug_assertions)] gate.

#[cfg(debug_assertions)]
fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 8 {
        eprintln!(
            "Usage: {} <template.nbt> <dst level.dat> <dimension> <dst_x> <dst_y> <dst_z> <rotation> [mirror: x|z]",
            args[0]
        );
        std::process::exit(1);
    }
    let template_path = args[1].clone();
    let dst_level_dat_path = args[2].clone();
    let dst_dimension = args[3].clone();
    let n = |i: usize| args[i].parse::<i32>().unwrap_or_else(|e| panic!("bad integer argument {:?}: {e}", args[i]));
    let dst_origin = (n(4), n(5), n(6));
    let rotation = n(7);
    let mirror = args.get(8).cloned();

    let app = tauri::Builder::default()
        .build(tauri::generate_context!())
        .expect("paste_template_cli: failed to build headless Tauri app");
    let handle = app.handle().clone();

    let start = std::time::Instant::now();
    let result = sojourner_lib::structure_copy::templates::paste_structure_template(
        handle, template_path, dst_level_dat_path, dst_dimension, dst_origin, rotation, mirror,
    );
    let elapsed = start.elapsed();

    match result {
        Ok(report) => {
            println!("paste_template_cli: DONE in {:.2}s\n{report:#?}", elapsed.as_secs_f64());
            std::process::exit(0);
        }
        Err(e) => {
            eprintln!("paste_template_cli: FAILED after {:.2}s: {e}", elapsed.as_secs_f64());
            std::process::exit(1);
        }
    }
}

#[cfg(not(debug_assertions))]
fn main() {
    eprintln!("paste_template_cli: not available in release builds (structure_copy is dev-only)");
    std::process::exit(1);
}
