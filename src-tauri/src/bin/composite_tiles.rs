// CLI wrapper around static_export::composite_tile_layer. New exports run
// compositing automatically (run_static_export); this binary is only for
// backfilling sites exported before that landed.

use sojourner_lib::static_export::composite_tile_layer;
use std::path::PathBuf;

struct Args {
    export_dir: PathBuf,
    layer_path: String, // e.g. "-8728685758987892773/tiles/overworld/chunk"
    target_px: i32,
}

fn print_usage() {
    eprintln!(
        "Usage: composite_tiles --export-dir <dir> --layer-path <path> [--target-px <N>]\n\
         \n\
         \x20 --export-dir <dir>   Root of an already-exported static site (has manifest.json).\n\
         \x20 --layer-path <path>  The layer's path exactly as recorded in manifest.json\n\
         \x20                      (e.g. \"<seed>/tiles/overworld/chunk\").\n\
         \x20 --target-px <N>      Target composite tile pixel size. Actual grid factor is\n\
         \x20                      derived per-layer from its own native tile size (varies —\n\
         \x20                      chunk-family layers were observed at 128px, others at\n\
         \x20                      512px). Default 512.\n\
         \n\
         Rewrites the matching layer's tileSize in manifest.json to match. Deletes the\n\
         native-resolution files it replaces — run against a copy if you want to keep both.\n\
         \n\
         New exports run this automatically now (see run_static_export). Use this only to\n\
         backfill a site exported before that landed."
    );
}

fn parse_args() -> Args {
    let mut export_dir = None;
    let mut layer_path = None;
    let mut target_px = 512;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "-h" | "--help" => { print_usage(); std::process::exit(0); }
            "--export-dir" => export_dir = args.next(),
            "--layer-path" => layer_path = args.next(),
            "--target-px" => target_px = args.next().and_then(|s| s.parse().ok()).unwrap_or(512),
            other => { eprintln!("composite_tiles: unrecognized argument '{other}'"); print_usage(); std::process::exit(1); }
        }
    }
    let (Some(export_dir), Some(layer_path)) = (export_dir, layer_path) else {
        eprintln!("composite_tiles: --export-dir and --layer-path are both required.\n");
        print_usage();
        std::process::exit(1);
    };
    Args { export_dir: PathBuf::from(export_dir), layer_path, target_px }
}

fn update_manifest_tile_size(manifest_path: &std::path::Path, layer_path: &str, new_size: i32) -> Result<(), String> {
    let raw = std::fs::read_to_string(manifest_path).map_err(|e| e.to_string())?;
    let mut json: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let mut found = false;
    if let Some(dims) = json.get_mut("dimensions").and_then(|d| d.as_array_mut()) {
        for dim in dims {
            let Some(tiles) = dim.get_mut("tiles").and_then(|t| t.as_object_mut()) else { continue };
            for (_, layer) in tiles.iter_mut() {
                // `cave` nests a map of preset -> TileLayerManifest; other keys hold one directly.
                let candidates: Vec<&mut serde_json::Value> = if let Some(obj) = layer.as_object_mut() {
                    if obj.contains_key("path") { vec![layer] } else { obj.values_mut().collect() }
                } else { vec![] };
                for c in candidates {
                    if c.get("path").and_then(|p| p.as_str()) == Some(layer_path) {
                        c["tileSize"] = serde_json::json!(new_size);
                        found = true;
                    }
                }
            }
        }
    }
    if !found {
        return Err(format!("layer path '{layer_path}' not found in manifest.json's tiles"));
    }
    let out = serde_json::to_vec_pretty(&json).map_err(|e| e.to_string())?;
    std::fs::write(manifest_path, out).map_err(|e| e.to_string())
}

fn main() {
    let args = parse_args();
    let layer_dir = args.export_dir.join(&args.layer_path);
    if !layer_dir.is_dir() {
        eprintln!("composite_tiles: {} is not a directory", layer_dir.display());
        std::process::exit(1);
    }

    eprintln!("composite_tiles: compositing {} (target {}px)", layer_dir.display(), args.target_px);
    let new_size = match composite_tile_layer(&layer_dir, args.target_px) {
        Ok(px) => px,
        Err(e) => { eprintln!("composite_tiles: FAILED: {e}"); std::process::exit(1); }
    };

    let manifest_path = args.export_dir.join("manifest.json");
    if let Err(e) = update_manifest_tile_size(&manifest_path, &args.layer_path, new_size) {
        eprintln!("composite_tiles: composited tiles OK but manifest update FAILED: {e}");
        std::process::exit(1);
    }

    eprintln!("composite_tiles: DONE — composite tileSize now {new_size}px, manifest updated");
}
