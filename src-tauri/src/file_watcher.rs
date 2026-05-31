use crate::nbt_reader::{self, WorldEdition};
use notify_debouncer_mini::{
    new_debouncer, DebounceEventResult, Debouncer,
    notify::{RecommendedWatcher, RecursiveMode},
};
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;
use tauri::Emitter;

// ── Managed state ─────────────────────────────────────────────────────────────

pub struct WatchState {
    level_dat_watcher: Option<Debouncer<RecommendedWatcher>>,
    region_watcher:    Option<Debouncer<RecommendedWatcher>>,
}

impl WatchState {
    pub fn new() -> Self {
        Self {
            level_dat_watcher: None,
            region_watcher:    None,
        }
    }

    pub fn stop(&mut self) {
        self.level_dat_watcher = None;
        self.region_watcher    = None;
    }
}

pub type WatchStateMutex = Mutex<WatchState>;

// ── Commands ──────────────────────────────────────────────────────────────────

/// Start watching a world: level.dat (500ms debounce) + region dirs (300ms debounce).
/// Replaces any existing watchers.
#[tauri::command]
pub fn watch_world(
    app:             tauri::AppHandle,
    state:           tauri::State<WatchStateMutex>,
    level_dat_path:  String,
) -> Result<(), String> {
    let world_dir = Path::new(&level_dat_path)
        .parent()
        .ok_or("level.dat has no parent")?
        .to_path_buf();

    let mut ws = state.lock().map_err(|e| e.to_string())?;
    ws.stop();

    // Detect edition once up front
    let edition = if world_dir.join("db").join("CURRENT").exists() {
        WorldEdition::Bedrock
    } else {
        WorldEdition::Java
    };

    // ── level.dat watcher ────────────────────────────────────────────────────
    let app_ld   = app.clone();
    let dat_path = level_dat_path.clone();
    let edition2 = edition.clone();

    let mut ld_debouncer = new_debouncer(
        Duration::from_millis(500),
        move |res: DebounceEventResult| {
            if res.is_err() { return; }
            let result = match edition2 {
                WorldEdition::Bedrock =>
                    crate::bedrock::nbt_reader::read_bedrock_level_dat(&dat_path),
                WorldEdition::Java =>
                    nbt_reader::read_level_dat(&dat_path),
            };
            match result {
                Ok(data)  => { let _ = app_ld.emit("seed:changed", data); }
                Err(msg)  => { let _ = app_ld.emit("seed:error",   msg);  }
            }
        },
    )
    .map_err(|e| e.to_string())?;

    ld_debouncer
        .watcher()
        .watch(Path::new(&level_dat_path), RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    // For Java: also watch playerdata dirs (player position saved separately)
    if edition == WorldEdition::Java {
        for dir in &[
            world_dir.join("playerdata"),
            world_dir.join("players").join("data"),
        ] {
            if dir.exists() {
                let _ = ld_debouncer.watcher().watch(dir, RecursiveMode::NonRecursive);
            }
        }
    }

    ws.level_dat_watcher = Some(ld_debouncer);

    // ── Region / LevelDB watcher ──────────────────────────────────────────────
    let app_rg = app.clone();

    if edition == WorldEdition::Bedrock {
        // Bedrock: watch db/ for LevelDB file changes.
        // We can't extract chunk coords from LDB filenames, so emit an empty
        // Vec to signal "all chunks may have changed" (full tile invalidation).
        let mut rg_debouncer = new_debouncer(
            Duration::from_millis(5_000),
            move |res: DebounceEventResult| {
                if res.is_err() { return; }
                let _ = app_rg.emit("region:changed", Vec::<(i32, i32)>::new());
            },
        )
        .map_err(|e| e.to_string())?;

        let db_dir = world_dir.join("db");
        if db_dir.exists() {
            let _ = rg_debouncer.watcher().watch(&db_dir, RecursiveMode::NonRecursive);
        }
        ws.region_watcher = Some(rg_debouncer);
    } else {
        // Java: watch .mca region directories and emit per-region coords.
        let mut rg_debouncer = new_debouncer(
            Duration::from_millis(5_000),
            move |res: DebounceEventResult| {
                let events = match res {
                    Ok(evts) => evts,
                    Err(_)   => return,
                };
                let regions: Vec<(i32, i32)> = events
                    .iter()
                    .filter(|e| e.path.extension().map_or(false, |x| x == "mca"))
                    .filter_map(|e| {
                        let stem = e.path.file_stem()?.to_str()?;
                        let mut parts = stem.split('.');
                        if parts.next() != Some("r") { return None; }
                        let rx: i32 = parts.next()?.parse().ok()?;
                        let rz: i32 = parts.next()?.parse().ok()?;
                        Some((rx, rz))
                    })
                    .collect::<std::collections::HashSet<_>>()
                    .into_iter()
                    .collect();
                if !regions.is_empty() {
                    let _ = app_rg.emit("region:changed", regions);
                }
            },
        )
        .map_err(|e| e.to_string())?;

        let region_dirs = [
            world_dir.join("region"),
            world_dir.join("DIM-1").join("region"),
            world_dir.join("DIM1").join("region"),
            world_dir.join("dimensions").join("minecraft").join("overworld").join("region"),
            world_dir.join("dimensions").join("minecraft").join("the_nether").join("region"),
            world_dir.join("dimensions").join("minecraft").join("the_end").join("region"),
        ];

        for dir in &region_dirs {
            if dir.exists() {
                let _ = rg_debouncer.watcher().watch(dir, RecursiveMode::NonRecursive);
            }
        }

        ws.region_watcher = Some(rg_debouncer);
    }

    Ok(())
}

/// Stop all active watchers.
#[tauri::command]
pub fn unwatch_world(state: tauri::State<WatchStateMutex>) -> Result<(), String> {
    state.lock().map_err(|e| e.to_string())?.stop();
    Ok(())
}
