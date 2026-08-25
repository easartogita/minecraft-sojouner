// Ad-hoc verification CLI for save_structure_template — same rationale as
// bin/paste_template_cli.rs. Debug-only, mirroring structure_copy's own
// #[cfg(debug_assertions)] gate. save_structure_template is read-only on the
// source world and takes no AppHandle, so unlike its sibling CLIs this one
// skips the headless tauri::Builder setup entirely.

#[cfg(debug_assertions)]
fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 10 {
        eprintln!(
            "Usage: {} <src level.dat> <dimension> <x0> <y0> <z0> <x1> <y1> <z1> <out.nbt>",
            args[0]
        );
        std::process::exit(1);
    }
    let level_dat = args[1].clone();
    let dimension = args[2].clone();
    let n = |i: usize| args[i].parse::<i32>().unwrap_or_else(|e| panic!("bad integer argument {:?}: {e}", args[i]));
    let src_box = (n(3), n(4), n(5), n(6), n(7), n(8));
    let out_path = args[9].clone();

    let start = std::time::Instant::now();
    let result = sojourner_lib::structure_copy::templates::save_structure_template(
        level_dat, dimension, src_box, out_path,
    );
    let elapsed = start.elapsed();

    match result {
        Ok(info) => {
            println!("save_template_cli: DONE in {:.2}s\n{info:#?}", elapsed.as_secs_f64());
            std::process::exit(0);
        }
        Err(e) => {
            eprintln!("save_template_cli: FAILED after {:.2}s: {e}", elapsed.as_secs_f64());
            std::process::exit(1);
        }
    }
}

#[cfg(not(debug_assertions))]
fn main() {
    eprintln!("save_template_cli: not available in release builds (structure_copy is dev-only)");
    std::process::exit(1);
}
