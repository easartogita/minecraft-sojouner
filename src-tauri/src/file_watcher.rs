use crate::nbt_reader::{self, WorldEdition};
use notify_debouncer_mini::{
    new_debouncer, DebounceEventResult, Debouncer,
    notify::{RecommendedWatcher, RecursiveMode},
};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Emitter;

/// Minimum gap between `region:changed` emissions for the *same* region. Without
/// this, every flush during active worldgen (every few seconds) re-triggers a full
/// `.mca` re-read + re-render, pegging the backend's CPU. First write to a quiet
/// region emits immediately (leading edge); further writes in-window coalesce into
/// one trailing update after the window closes, so the final state is never dropped.
const REGION_SETTLE: Duration = Duration::from_secs(20);
const REGION_SETTLE_TICK: Duration = Duration::from_millis(500);

/// Payload for `region:changed`. The frontend gates on `dimension` so a write in one
/// dimension never invalidates the identically-numbered region in another; `*` means
/// Bedrock (dimension unknown) — treated as "any" = full invalidation.
#[derive(Clone, serde::Serialize)]
struct RegionChange {
    dimension: String,
    regions:   Vec<(i32, i32)>,
}

/// Classify a block-region `.mca` path into a dimension key. The file lives at
/// `<dimdir>/region/r.x.z.mca`; the grandparent dir names the dimension (or is the
/// world root itself for the legacy overworld `<world>/region` layout).
fn region_dimension(path: &Path, world_dir: &Path) -> Option<String> {
    let grandparent = path.parent()?.parent()?;
    if grandparent == world_dir {
        return Some("overworld".to_string());
    }
    Some(match grandparent.file_name()?.to_str()? {
        "overworld"            => "overworld".to_string(),
        "the_nether" | "DIM-1" => "nether".to_string(),
        "the_end"    | "DIM1"  => "end".to_string(),
        other                  => other.to_string(),
    })
}

pub struct WatchState {
    level_dat_watcher: Option<Debouncer<RecommendedWatcher>>,
    region_watcher:    Option<Debouncer<RecommendedWatcher>>,
    /// Signals the region-settle ticker thread to stop; checked each tick rather
    /// than force-killed.
    settle_running:    Option<Arc<AtomicBool>>,
    /// Joined in `stop()` so a rapid world switch can't leave two ticker threads
    /// alive against two state maps — worst case blocks one tick (500ms).
    settle_thread:     Option<std::thread::JoinHandle<()>>,
}

impl WatchState {
    pub fn new() -> Self {
        Self {
            level_dat_watcher: None,
            region_watcher:    None,
            settle_running:    None,
            settle_thread:     None,
        }
    }

    pub fn stop(&mut self) {
        self.level_dat_watcher = None;
        self.region_watcher    = None;
        if let Some(flag) = self.settle_running.take() {
            flag.store(false, Ordering::Relaxed);
        }
        if let Some(handle) = self.settle_thread.take() {
            let _ = handle.join();
        }
    }
}

pub type WatchStateMutex = Mutex<WatchState>;

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

    let edition = if world_dir.join("db").join("CURRENT").exists() {
        WorldEdition::Bedrock
    } else {
        WorldEdition::Java
    };

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

    let app_rg = app.clone();

    if edition == WorldEdition::Bedrock {
        // Can't extract chunk coords from LDB filenames, so watching db/ signals a
        // full invalidation (`*` + empty regions) for whichever dimension is viewed.
        let mut rg_debouncer = new_debouncer(
            Duration::from_millis(5_000),
            move |res: DebounceEventResult| {
                if res.is_err() { return; }
                let _ = app_rg.emit("region:changed", RegionChange {
                    dimension: "*".to_string(),
                    regions:   Vec::new(),
                });
            },
        )
        .map_err(|e| e.to_string())?;

        let db_dir = world_dir.join("db");
        if db_dir.exists() {
            let _ = rg_debouncer.watcher().watch(&db_dir, RecursiveMode::NonRecursive);
        }
        ws.region_watcher = Some(rg_debouncer);
    } else {
        // Recursive watch (rather than one per known region dir) so region dirs
        // created after startup are still covered — e.g. first Nether/End entry.
        // notify auto-adds watches for newly-created subdirectories.
        let watch_root = world_dir.clone();

        // Per-region settle throttle (see REGION_SETTLE doc above). `next_allowed`:
        // earliest time we're allowed to emit for a region again. `pending`: regions
        // suppressed this cycle that still need a trailing flush once their window closes.
        let next_allowed: Arc<Mutex<HashMap<(String, i32, i32), Instant>>> = Arc::new(Mutex::new(HashMap::new()));
        let pending: Arc<Mutex<HashSet<(String, i32, i32)>>> = Arc::new(Mutex::new(HashSet::new()));
        let next_allowed_cb = next_allowed.clone();
        let pending_cb = pending.clone();

        let mut rg_debouncer = new_debouncer(
            Duration::from_millis(5_000),
            move |res: DebounceEventResult| {
                let events = match res {
                    Ok(evts) => evts,
                    Err(errs) => {
                        // An inotify queue overflow under heavy MC IO surfaces here — events
                        // were DROPPED, so region:changed never fires and a torn tile never heals.
                        crate::tile_renderer::trace_log(&format!("region watcher error (events may be dropped): {:?}", errs));
                        return;
                    }
                };
                let mut by_dim: HashMap<String, HashSet<(i32, i32)>> = HashMap::new();
                for e in &events {
                    if e.path.extension().map_or(true, |x| x != "mca") { continue; }
                    // Only block-region files — a recursive watch also sees entities/ and
                    // poi/ .mca files, which don't feed tiles.
                    if e.path.parent().and_then(|p| p.file_name()).map_or(true, |n| n != "region") { continue; }
                    let Some(dim) = region_dimension(&e.path, &watch_root) else { continue };
                    let Some(stem) = e.path.file_stem().and_then(|s| s.to_str()) else { continue };
                    let mut parts = stem.split('.');
                    if parts.next() != Some("r") { continue; }
                    let (Some(Ok(rx)), Some(Ok(rz))) =
                        (parts.next().map(str::parse::<i32>), parts.next().map(str::parse::<i32>))
                        else { continue };
                    by_dim.entry(dim).or_default().insert((rx, rz));
                }

                // A region quiet long enough (or brand new) emits now (leading edge);
                // one still inside its window defers to the ticker thread below.
                let now = Instant::now();
                let mut to_emit: HashMap<String, Vec<(i32, i32)>> = HashMap::new();
                {
                    let mut next_allowed = next_allowed_cb.lock().unwrap();
                    let mut pending = pending_cb.lock().unwrap();
                    for (dimension, regions) in by_dim {
                        for (rx, rz) in regions {
                            let key = (dimension.clone(), rx, rz);
                            let allowed = next_allowed.get(&key).map_or(true, |&t| now >= t);
                            if allowed {
                                next_allowed.insert(key, now + REGION_SETTLE);
                                to_emit.entry(dimension.clone()).or_default().push((rx, rz));
                            } else {
                                pending.insert(key);
                            }
                        }
                    }
                }
                for (dimension, regions) in to_emit {
                    crate::tile_renderer::trace_log(&format!("region:changed dim={} regions={:?}", dimension, regions));
                    let _ = app_rg.emit("region:changed", RegionChange {
                        dimension,
                        regions,
                    });
                }
            },
        )
        .map_err(|e| e.to_string())?;

        rg_debouncer
            .watcher()
            .watch(&world_dir, RecursiveMode::Recursive)
            .map_err(|e| e.to_string())?;

        ws.region_watcher = Some(rg_debouncer);

        // Trailing-edge ticker: flushes any suppressed region once its settle window
        // elapses, so it gets a final render without waiting on another write. Cheap
        // in-memory map check every 500ms, no I/O. Stopped via `running` on watcher replace.
        let running = Arc::new(AtomicBool::new(true));
        ws.settle_running = Some(running.clone());
        let app_ticker = app.clone();
        let handle = std::thread::spawn(move || {
            while running.load(Ordering::Relaxed) {
                std::thread::sleep(REGION_SETTLE_TICK);
                if !running.load(Ordering::Relaxed) { break; }

                let now = Instant::now();
                let mut to_emit: HashMap<String, Vec<(i32, i32)>> = HashMap::new();
                {
                    let mut next_allowed = next_allowed.lock().unwrap();
                    let mut pending = pending.lock().unwrap();
                    pending.retain(|key| {
                        let due = next_allowed.get(key).map_or(true, |&t| now >= t);
                        if due {
                            next_allowed.insert(key.clone(), now + REGION_SETTLE);
                            to_emit.entry(key.0.clone()).or_default().push((key.1, key.2));
                        }
                        !due
                    });
                    // Drop entries whose window is long over with no further write —
                    // otherwise this map grows by one entry per region visited forever.
                    next_allowed.retain(|key, &mut t| pending.contains(key) || now < t + REGION_SETTLE);
                }
                for (dimension, regions) in to_emit {
                    crate::tile_renderer::trace_log(&format!("region:changed (settled) dim={} regions={:?}", dimension, regions));
                    let _ = app_ticker.emit("region:changed", RegionChange {
                        dimension,
                        regions,
                    });
                }
            }
        });
        ws.settle_thread = Some(handle);
    }

    Ok(())
}

/// Stop all active watchers.
#[tauri::command]
pub fn unwatch_world(state: tauri::State<WatchStateMutex>) -> Result<(), String> {
    state.lock().map_err(|e| e.to_string())?.stop();
    Ok(())
}
