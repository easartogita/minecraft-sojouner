//! "Custom Structures": copies save data between worlds, from whole-region
//! byte copy up through chunk relocation, Y-range splicing, and arbitrary
//! block-box copy/paste (see TODO.md for the staged plan). This is the first
//! write path into save data this app has ever had, so it stays
//! dev-build-only (`#[cfg(debug_assertions)]` on `mod structure_copy;` in
//! lib.rs) until a real backup/restore strategy exists beyond this feature's
//! own per-copy backup.
//!
//! Every write entry point holds the destination world's `session.lock`
//! exclusively for the duration of the write (see `session_lock` below) —
//! the safety check TODO_MCA_WRITE_EDITING.md calls out to prevent writing
//! into a world open in a live Minecraft client.

// blocks.rs: block-level pack/unpack + `copy_blocks` command. rotation.rs:
// the position-transform + blockstate-rotation table it uses. Both are
// descendants of this already-gated module, so they see its private items
// directly without needing `pub(crate)` sprinkled around.
pub mod blocks;
mod rotation;
// Save/load a block-box selection as a portable Structure Block .nbt file.
pub mod templates;
// Real block-color thumbnails for the source-selection step (box/template/chunk).
pub mod preview;

use crate::nbt_reader;
use crate::region_reader;
use crate::tile_renderer;
use fastnbt::Value;
use flate2::write::ZlibEncoder;
use flate2::Compression;
use serde::Serialize;
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::Manager;

type Result<T> = std::result::Result<T, String>;

// Detects whether a Java Edition world is currently held open by a running
// Minecraft client/server, so a copy's writes can't corrupt a live save.
//
// Minecraft's own session.lock check uses Java NIO `FileChannel.tryLock()`,
// backed on Unix by `fcntl(F_SETLK)` — a different, non-interacting lock
// namespace from `flock()`, which is what Rust's std `File::try_lock` (and
// fs2/fs4) use on Unix. A std-only check would silently never detect a live
// Minecraft session, so this hand-rolls the matching fcntl() call via raw
// libc on Unix. Windows uses std's try_lock (LockFileEx) since Windows
// enforces byte-range locks at the kernel level regardless of API.
mod session_lock {
    use std::fs::{File, OpenOptions};
    use std::path::Path;

    const WORLD_OPEN_MSG: &str =
        "Destination world's session.lock is held by another process — it looks \
         like this world is currently open in a running Minecraft client or \
         server. Close it there before copying.";

    /// RAII guard: holds session.lock exclusively for as long as it's alive.
    /// Drop releases the lock — both fcntl and LockFileEx locks release
    /// automatically when their last file handle in this process closes, so
    /// there's no explicit unlock to forget.
    pub struct WorldWriteGuard(#[allow(dead_code)] File);

    pub fn acquire_write_guard(world_dir: &str) -> super::Result<WorldWriteGuard> {
        let path = Path::new(world_dir).join("session.lock");
        // Deliberately no truncate(true): this must open MC's existing
        // session.lock (if any) without touching its content, only creating
        // one fresh if the world's never been opened before.
        #[allow(clippy::suspicious_open_options)]
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .open(&path)
            .map_err(|e| format!("Couldn't open {}: {e}", path.display()))?;

        try_lock(&file)?;
        Ok(WorldWriteGuard(file))
    }

    /// Same as `acquire_write_guard`, except when `override_live_lock` is set
    /// and the *only* problem is the world being open in a live Minecraft
    /// client — proceeds without holding a lock instead of refusing. Any
    /// other failure (can't open the file, unexpected OS error) still
    /// refuses regardless of the override; this only ever bypasses the one
    /// specific, known-safe-to-name check.
    ///
    /// This function trusts the caller's `override_live_lock` outright — it
    /// isn't itself a confirmation mechanism. The frontend is expected to
    /// gate setting that flag behind its own explicit user challenge (see
    /// `StructureCopyFlyout.tsx`) before ever calling in with it set; this
    /// being a single-user local desktop app, there's no untrusted client to
    /// defend the flag against on this side.
    pub fn acquire_write_guard_or_override(
        world_dir: &str,
        override_live_lock: bool,
    ) -> super::Result<Option<WorldWriteGuard>> {
        match acquire_write_guard(world_dir) {
            Ok(guard) => Ok(Some(guard)),
            Err(e) if override_live_lock && e == WORLD_OPEN_MSG => Ok(None),
            Err(e) => Err(e),
        }
    }

    #[cfg(unix)]
    fn try_lock(file: &File) -> super::Result<()> {
        use std::os::unix::io::AsRawFd;

        // SAFETY: `lock` is a plain-data POSIX struct; zero-initializing it
        // and then setting the fields we care about is valid for any target
        // (covers platform-specific extra fields like l_sysid we don't use).
        let mut lock: libc::flock = unsafe { std::mem::zeroed() };
        lock.l_type = libc::F_WRLCK as _;
        lock.l_whence = libc::SEEK_SET as _;
        lock.l_start = 0;
        lock.l_len = 0; // whole file

        // SAFETY: `file` outlives this call and `lock` is a valid, fully
        // initialized `flock` as required by fcntl(2).
        let ret = unsafe { libc::fcntl(file.as_raw_fd(), libc::F_SETLK, &mut lock) };
        if ret == -1 {
            let err = std::io::Error::last_os_error();
            return match err.raw_os_error() {
                Some(libc::EACCES) | Some(libc::EAGAIN) => Err(WORLD_OPEN_MSG.to_string()),
                _ => Err(format!("Couldn't check session.lock: {err}")),
            };
        }
        Ok(())
    }

    #[cfg(windows)]
    fn try_lock(file: &File) -> super::Result<()> {
        use std::io::TryLockError;
        match file.try_lock() {
            Ok(()) => Ok(()),
            Err(TryLockError::WouldBlock) => Err(WORLD_OPEN_MSG.to_string()),
            Err(TryLockError::Error(e)) => Err(format!("Couldn't check session.lock: {e}")),
        }
    }
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    pub region: (i32, i32),
    pub backup_path: String,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SkippedRegion {
    pub region: (i32, i32),
    pub reason: String,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CopyRegionsReport {
    pub copied: Vec<(i32, i32)>,
    pub backed_up: Vec<BackupEntry>,
    pub skipped: Vec<SkippedRegion>,
}

#[tauri::command]
pub fn copy_regions(
    app: tauri::AppHandle,
    src_level_dat_path: String,
    src_dimension: String,
    dst_level_dat_path: String,
    dst_dimension: String,
    regions: Vec<(i32, i32)>,
    // See session_lock::acquire_write_guard_or_override's doc — the frontend
    // only ever sets this after its own explicit user challenge.
    override_live_lock: bool,
) -> Result<CopyRegionsReport> {
    check_same_data_version(&src_level_dat_path, &dst_level_dat_path)?;

    let src_world_dir = world_dir_of(&src_level_dat_path)?;
    let dst_world_dir = world_dir_of(&dst_level_dat_path)?;
    let src_world_dir = src_world_dir.to_string_lossy().to_string();
    let dst_world_dir = dst_world_dir.to_string_lossy().to_string();

    // Held until this function returns — see session_lock's module doc above.
    let _dst_lock = session_lock::acquire_write_guard_or_override(&dst_world_dir, override_live_lock)?;

    let mut copied = Vec::new();
    let mut backed_up = Vec::new();
    let mut skipped = Vec::new();

    for &(rx, rz) in &regions {
        match copy_one_region(&src_world_dir, &src_dimension, &dst_world_dir, &dst_dimension, rx, rz) {
            Ok(Some(backup)) => {
                backed_up.push(backup);
                copied.push((rx, rz));
            }
            Ok(None) => copied.push((rx, rz)),
            Err(reason) => skipped.push(SkippedRegion { region: (rx, rz), reason }),
        }
    }

    // Deterministic invalidation regardless of whether the destination world is
    // currently open/watched — the frontend's region:changed → invalidate_mca_tiles
    // path only fires for a world actively being watched, which isn't guaranteed here.
    if !copied.is_empty() {
        let cache_root = app.path().app_cache_dir()
            .map(|p| p.join("tile-cache").join(format!("v{}", tile_renderer::CACHE_VERSION)))
            .unwrap_or_else(|_| PathBuf::from("/tmp/msm-tile-cache"));
        tile_renderer::invalidate_mca_tiles(&cache_root, &dst_world_dir, &copied);
    }

    Ok(CopyRegionsReport { copied, backed_up, skipped })
}

// Java-only feature (region files are a Java Edition concept — Bedrock uses
// LevelDB). A Bedrock level.dat is a different binary header, not gzipped
// NBT, so read_level_dat naturally errors out on one rather than needing a
// special case here.
//
// Returns the shared version on success so callers doing per-chunk checks
// (see `require_chunk_data_version`) don't need a second `read_level_dat`.
fn check_same_data_version(src_level_dat_path: &str, dst_level_dat_path: &str) -> Result<i32> {
    let src_version = nbt_reader::read_level_dat(src_level_dat_path)?.data_version;
    let dst_version = nbt_reader::read_level_dat(dst_level_dat_path)?.data_version;
    if src_version != dst_version {
        let older = src_version.min(dst_version);
        return Err(format!(
            "Source and destination worlds are different Minecraft versions \
             (DataVersion {src_version} vs {dst_version}) — refusing to copy \
             across versions. This app doesn't convert between versions itself: \
             open the DataVersion {older} world in a Minecraft client to let it \
             upgrade in place, then retry — or copy between two worlds that are \
             already on the same version."
        ));
    }
    Ok(src_version)
}

/// A chunk's own `DataVersion` tag. Unlike the fields `chunk_root`/
/// `chunk_root_mut` reach for, this is *always* at the absolute top level of
/// the chunk compound — a sibling of `Level` in the pre-1.18 format, not
/// nested inside it — so it's read directly here rather than through those.
fn chunk_data_version(chunk: &Value) -> Option<i32> {
    let Value::Compound(m) = chunk else { return None };
    match m.get("DataVersion") {
        Some(Value::Int(v)) => Some(*v),
        _ => None,
    }
}

/// Hard-fails the *whole* copy (nothing written yet at the point every
/// caller invokes this — see each call site) if one specific chunk's own
/// on-disk `DataVersion` doesn't match what both worlds' `level.dat` already
/// agreed on. Catches a chunk that hasn't been resaved by Minecraft since an
/// older version even though its world's overall stamp is current — real
/// Minecraft tolerates that via lazy per-chunk upgrade on load, but this
/// app's own NBT code assumes one schema, so a stale chunk is a silent
/// misread/miswrite risk here. Deliberately all-or-nothing rather than
/// skip-and-continue: a partially-applied multi-chunk copy can leave a
/// structure looking broken in-game with no obvious cause.
fn require_chunk_data_version(chunk: &Value, expected: i32, chunk_pos: (i32, i32), role: &str) -> Result<()> {
    match chunk_data_version(chunk) {
        Some(v) if v == expected => Ok(()),
        Some(v) => Err(format!(
            "{role} chunk c.{}.{} is DataVersion {v}, expected {expected} — refusing the whole copy. \
             This chunk hasn't been resaved by Minecraft since an older version; visit it in a \
             Minecraft client (walking nearby is enough to trigger a resave), then retry.",
            chunk_pos.0, chunk_pos.1
        )),
        None => Err(format!(
            "{role} chunk c.{}.{} has no DataVersion tag — refusing the whole copy. This usually \
             means hand-edited or corrupted chunk data; regenerate it or restore from backup \
             before retrying.",
            chunk_pos.0, chunk_pos.1
        )),
    }
}

fn world_dir_of(level_dat_path: &str) -> Result<PathBuf> {
    Path::new(level_dat_path)
        .parent()
        .map(PathBuf::from)
        .ok_or_else(|| "level.dat has no parent directory".to_string())
}

/// Copy one region file. Returns `Ok(Some(backup))` if an existing destination
/// file was backed up before being overwritten, `Ok(None)` if the destination
/// didn't exist yet (nothing to back up), or `Err` with a human-readable reason
/// to record as a skip (source missing, I/O failure, etc.) — a failure on one
/// region shouldn't abort the whole batch.
fn copy_one_region(
    src_world_dir: &str,
    src_dimension: &str,
    dst_world_dir: &str,
    dst_dimension: &str,
    rx: i32,
    rz: i32,
) -> Result<Option<BackupEntry>> {
    let src_path = region_reader::find_region_file(src_world_dir, src_dimension, rx, rz)
        .ok_or_else(|| format!("Source has no region r.{rx}.{rz}.mca"))?;

    let (dst_dir, backup) = match region_reader::find_region_file(dst_world_dir, dst_dimension, rx, rz) {
        Some(existing_path) => {
            let dir = existing_path
                .parent()
                .ok_or("destination region file has no parent directory")?
                .to_path_buf();

            let ts = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let backup_dir = Path::new(dst_world_dir).join("sojourner-backups").join(dst_dimension);
            std::fs::create_dir_all(&backup_dir)
                .map_err(|e| format!("Couldn't create backup dir: {e}"))?;
            let backup_path = backup_dir.join(format!("r.{rx}.{rz}.{ts}.mca.bak"));
            std::fs::copy(&existing_path, &backup_path)
                .map_err(|e| format!("Couldn't back up existing region: {e}"))?;

            (dir, Some(BackupEntry {
                region: (rx, rz),
                backup_path: backup_path.to_string_lossy().to_string(),
            }))
        }
        None => {
            let dir = dst_region_dir_matching_src(
                src_world_dir, src_dimension, dst_world_dir, dst_dimension, &src_path,
            );
            std::fs::create_dir_all(&dir)
                .map_err(|e| format!("Couldn't create region directory: {e}"))?;
            (dir, None)
        }
    };

    // tmp-file-then-rename — same idiom static_export.rs uses for manifest.json/
    // meta.json, so a reader never sees a partially-written .mca.
    let final_path = dst_dir.join(format!("r.{rx}.{rz}.mca"));
    let tmp_path = dst_dir.join(format!("r.{rx}.{rz}.mca.tmp"));
    std::fs::copy(&src_path, &tmp_path)
        .map_err(|e| format!("Couldn't copy region file: {e}"))?;
    std::fs::rename(&tmp_path, &final_path)
        .map_err(|e| format!("Couldn't finalize region file: {e}"))?;

    Ok(backup)
}

/// When the destination has no existing file for this region, pick whichever
/// of the two candidate directories (new 1.21.5+ `dimensions/minecraft/<dim>/region`
/// layout vs. legacy `region/`) matches the layout the *source* file actually
/// lives in, rather than guessing independently on the destination side.
fn dst_region_dir_matching_src(
    src_world_dir: &str,
    src_dimension: &str,
    dst_world_dir: &str,
    dst_dimension: &str,
    src_region_path: &Path,
) -> PathBuf {
    let src_dirs = region_reader::region_dirs(src_world_dir, src_dimension);
    let dst_dirs = region_reader::region_dirs(dst_world_dir, dst_dimension);
    if src_region_path.parent() == Some(src_dirs[0].as_path()) {
        dst_dirs[0].clone()
    } else {
        dst_dirs[1].clone()
    }
}

// ── v1: chunk-level copy with relocation ────────────────────────────────────
// Unlike copy_regions' plain byte copy, this decodes each chunk's NBT,
// rewrites its position, and writes it via a from-scratch Anvil writer.
// Deliberate scope cuts:
//   - Entities aren't copied — a farm's spawner regenerates mobs.
//   - `structures` (structure-piece bounding boxes) is stripped, not
//     rewritten — this app derives structure positions from the seed, so
//     stale bounding boxes would only misreport to a real MC client.
//   - No heightmap/lighting recompute — both travel correctly with the
//     chunk's own data for a same-content move; a light seam at the
//     destination boundary is the accepted cost until relit/resaved.

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SkippedChunk {
    pub chunk: (i32, i32),
    pub reason: String,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CopyChunksReport {
    pub copied: Vec<(i32, i32)>,
    pub backed_up: Vec<BackupEntry>,
    pub skipped: Vec<SkippedChunk>,
    // Neighbor-ring chunks auto-relit after the write above — see
    // `relight_ring_around`. Not part of `copied`/`skipped`'s own bookkeeping
    // since those are about the requested copy, not this follow-up step.
    pub relit: Vec<(i32, i32)>,
    pub relight_warning: Option<String>,
}

#[tauri::command]
pub fn copy_chunks(
    app: tauri::AppHandle,
    src_level_dat_path: String,
    src_dimension: String,
    dst_level_dat_path: String,
    dst_dimension: String,
    chunks: Vec<(i32, i32)>,
    dx: i32,
    dz: i32,
    // v2: Y-range trim, section-aligned. Both Some → only sections touching
    // [y_min, y_max] (rounded outward to whole 16-block sections) are copied,
    // spliced into the destination chunk's *existing* sections rather than
    // replacing the whole chunk — see `splice_y_range`. Either None → v1's
    // full-column relocate-and-replace behavior, unchanged.
    y_min: Option<i32>,
    y_max: Option<i32>,
    // See session_lock::acquire_write_guard_or_override's doc — the frontend
    // only ever sets this after its own explicit user challenge.
    override_live_lock: bool,
) -> Result<CopyChunksReport> {
    let expected_version = check_same_data_version(&src_level_dat_path, &dst_level_dat_path)?;

    let src_world_dir = world_dir_of(&src_level_dat_path)?.to_string_lossy().to_string();
    let dst_world_dir = world_dir_of(&dst_level_dat_path)?.to_string_lossy().to_string();

    // Held until this function returns — see session_lock's module doc above.
    let _dst_lock = session_lock::acquire_write_guard_or_override(&dst_world_dir, override_live_lock)?;

    let section_range: Option<(i32, i32)> = match (y_min, y_max) {
        (Some(a), Some(b)) => {
            let (lo, hi) = (a.min(b), a.max(b));
            Some((lo.div_euclid(16), hi.div_euclid(16)))
        }
        _ => None,
    };

    // Group by destination region so each destination region file is read,
    // rewritten, and backed up exactly once per copy call, however many of
    // the selected chunks land in it.
    let mut by_dst_region: HashMap<(i32, i32), Vec<(i32, i32, i32, i32)>> = HashMap::new();
    for &(cx, cz) in &chunks {
        let (new_cx, new_cz) = (cx + dx, cz + dz);
        let dst_region = (new_cx.div_euclid(32), new_cz.div_euclid(32));
        by_dst_region.entry(dst_region).or_default().push((cx, cz, new_cx, new_cz));
    }

    let mut copied = Vec::new();
    let mut skipped = Vec::new();
    // Destination-space coords of every chunk actually written — separate
    // from `copied` (source-space) since relight_ring_around needs to know
    // where in the *destination* world to look for neighbors.
    let mut dst_touched: Vec<(i32, i32)> = Vec::new();
    // Cache each source region's bytes so chunks sharing a source region
    // aren't re-read from disk once per chunk.
    let mut src_region_cache: HashMap<(i32, i32), Option<Vec<u8>>> = HashMap::new();

    // ── Phase 1: read + validate + build every substitution, write nothing
    // yet. A `require_chunk_data_version` mismatch anywhere below returns
    // `Err` straight out of this function before any region file has been
    // touched — a bad chunk aborts the whole copy rather than leaving some
    // regions rewritten and others not (see require_chunk_data_version's doc).
    let mut planned: Vec<((i32, i32), PathBuf, Option<Vec<u8>>, HashMap<(usize, usize), Vec<u8>>)> = Vec::new();

    for (&dst_region, group) in &by_dst_region {
        // Fetched up front (not just at write time, like v1 did) because
        // Y-trim's merge needs to look up each destination chunk's *existing*
        // NBT while building substitutions below, not only the raw
        // untouched-chunk passthrough bytes rewrite needs afterward.
        let (dst_dir, existing_bytes) =
            resolve_dst_region_for_chunk_write(&dst_world_dir, &dst_dimension, dst_region.0, dst_region.1)?;

        let mut substitutions: HashMap<(usize, usize), Vec<u8>> = HashMap::new();

        for &(cx, cz, new_cx, new_cz) in group {
            let src_region = (cx.div_euclid(32), cz.div_euclid(32));
            let buf = src_region_cache.entry(src_region).or_insert_with(|| {
                region_reader::find_region_file(&src_world_dir, &src_dimension, src_region.0, src_region.1)
                    .and_then(|p| std::fs::read(p).ok())
            });
            let Some(buf) = buf.as_ref() else {
                skipped.push(SkippedChunk {
                    chunk: (cx, cz),
                    reason: format!(
                        "Source region r.{}.{} not found — visit that area in a Minecraft client \
                         to generate it, or confirm this is the world you meant to copy from.",
                        src_region.0, src_region.1
                    ),
                });
                continue;
            };

            let local_x = cx.rem_euclid(32) as usize;
            let local_z = cz.rem_euclid(32) as usize;
            let Some(mut chunk_nbt) = region_reader::read_chunk_nbt(buf, local_x, local_z) else {
                skipped.push(SkippedChunk {
                    chunk: (cx, cz),
                    reason: "Chunk not generated — visit this location in a Minecraft client first \
                             so there's something here to copy.".to_string(),
                });
                continue;
            };
            require_chunk_data_version(&chunk_nbt, expected_version, (cx, cz), "Source")?;

            let dst_local_x = new_cx.rem_euclid(32) as usize;
            let dst_local_z = new_cz.rem_euclid(32) as usize;

            let result_chunk = if let Some((sec_lo, sec_hi)) = section_range {
                let Some(mut dest_chunk) = existing_bytes.as_deref()
                    .and_then(|buf| region_reader::read_chunk_nbt(buf, dst_local_x, dst_local_z))
                else {
                    skipped.push(SkippedChunk {
                        chunk: (cx, cz),
                        reason: "Destination chunk not generated — a Y-range copy merges into an \
                                 existing destination chunk, it can't create one. Visit this location \
                                 in Minecraft to generate it first, or use a plain (non-Y-range) chunk \
                                 copy instead, which can create a new destination chunk.".to_string(),
                    });
                    continue;
                };
                // Only the merge path needs the *destination* chunk's own
                // version checked — a plain full-column relocate below
                // discards the existing destination chunk outright, so
                // nothing of its schema survives to be at risk.
                require_chunk_data_version(&dest_chunk, expected_version, (new_cx, new_cz), "Destination")?;
                splice_y_range(&mut dest_chunk, &chunk_nbt, sec_lo, sec_hi, dx * 16, dz * 16);
                dest_chunk
            } else {
                relocate_chunk_nbt(&mut chunk_nbt, new_cx, new_cz, dx * 16, dz * 16);
                chunk_nbt
            };

            let payload = match encode_chunk_payload(&result_chunk) {
                Ok(p) => p,
                Err(reason) => { skipped.push(SkippedChunk { chunk: (cx, cz), reason }); continue; }
            };

            substitutions.insert((dst_local_x, dst_local_z), payload);
            copied.push((cx, cz));
            dst_touched.push((new_cx, new_cz));
        }

        if !substitutions.is_empty() {
            planned.push((dst_region, dst_dir, existing_bytes, substitutions));
        }
    }

    // ── Phase 2: every touched chunk passed validation — now actually write.
    let mut backed_up = Vec::new();
    for (dst_region, dst_dir, existing_bytes, substitutions) in &planned {
        if let Some(bytes) = existing_bytes {
            let backup = backup_existing_region(&dst_world_dir, &dst_dimension, dst_region.0, dst_region.1, bytes)?;
            backed_up.push(backup);
        }

        let new_bytes = rewrite_region_with_chunks(existing_bytes.as_deref(), substitutions);

        let final_path = dst_dir.join(format!("r.{}.{}.mca", dst_region.0, dst_region.1));
        let tmp_path = dst_dir.join(format!("r.{}.{}.mca.tmp", dst_region.0, dst_region.1));
        std::fs::write(&tmp_path, &new_bytes)
            .map_err(|e| format!("Couldn't write region file: {e}"))?;
        std::fs::rename(&tmp_path, &final_path)
            .map_err(|e| format!("Couldn't finalize region file: {e}"))?;
    }

    if !copied.is_empty() {
        let affected_regions: Vec<(i32, i32)> = by_dst_region.keys().copied().collect();
        let cache_root = app.path().app_cache_dir()
            .map(|p| p.join("tile-cache").join(format!("v{}", tile_renderer::CACHE_VERSION)))
            .unwrap_or_else(|_| PathBuf::from("/tmp/msm-tile-cache"));
        tile_renderer::invalidate_mca_tiles(&cache_root, &dst_world_dir, &affected_regions);
    }

    // Best-effort: a relight hiccup doesn't undo the copy that already
    // succeeded above, so its own I/O errors become a warning, not a `?`.
    let (relit, relight_warning) = match relight_ring_around(&app, &dst_world_dir, &dst_dimension, &dst_touched) {
        Ok(report) => {
            backed_up.extend(report.backed_up);
            skipped.extend(report.skipped);
            (report.relit, None)
        }
        Err(e) => (Vec::new(), Some(format!("Copy succeeded, but relighting the surrounding chunks failed: {e}"))),
    };

    Ok(CopyChunksReport { copied, backed_up, skipped, relit, relight_warning })
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RelightChunksReport {
    pub relit: Vec<(i32, i32)>,
    pub backed_up: Vec<BackupEntry>,
    pub skipped: Vec<SkippedChunk>,
}

/// Forces a re-light on next load by flipping `isLightOn` back to false —
/// same mechanism `copy_blocks` uses on chunks it writes to, but usable
/// standalone on untouched neighbor chunks. A paste/relocate only marks the
/// chunks it writes as needing relight, so a neighbor whose light was
/// computed against the old boundary can still show a seam; pass the touched
/// footprint plus a 1-chunk ring to clear that. Nothing else in the chunk changes.
///
/// Exposed both as this standalone command (arbitrary manual footprint, e.g.
/// from `relight_chunks_cli`) and via `relight_ring_around` below, which
/// `copy_chunks`/`write_blocks_to_destination` call automatically after
/// every write — see that function's doc for why the ring is limited to 1
/// chunk rather than covering every light source's full radius.
#[tauri::command]
pub fn force_relight_chunks(
    app: tauri::AppHandle,
    dst_level_dat_path: String,
    dst_dimension: String,
    chunks: Vec<(i32, i32)>,
    // See session_lock::acquire_write_guard_or_override's doc — the frontend
    // only ever sets this after its own explicit user challenge.
    override_live_lock: bool,
) -> Result<RelightChunksReport> {
    let dst_world_dir = world_dir_of(&dst_level_dat_path)?.to_string_lossy().to_string();

    // Held until this function returns — see session_lock's module doc above.
    let _dst_lock = session_lock::acquire_write_guard_or_override(&dst_world_dir, override_live_lock)?;

    relight_chunks_inner(&app, &dst_world_dir, &dst_dimension, chunks)
}

/// Neighbor-ring auto-relight for a write that already succeeded: computes
/// the 1-chunk Chebyshev ring around `touched` (excluding `touched` itself —
/// those chunks already got `isLightOn` cleared as part of the write that
/// touched them, no need to redo it) and relights just that ring.
///
/// Deliberately 1 chunk, not wider: every light source in the game (torches,
/// glowstone, lava, the sun) has a max light level of 15, and light can't
/// cross a chunk boundary and still register more than 15 blocks in — a
/// 16-block chunk is wider than any single light's falloff, so a ring one
/// chunk deep already covers every neighbor whose *displayed* lighting could
/// possibly have depended on what used to be across the boundary. Widening
/// it wouldn't catch anything a 1-chunk ring misses.
///
/// Best-effort: failures here don't fail the write that already succeeded —
/// the caller folds `relit`/`backed_up`/`skipped` into its own report and
/// surfaces an outer `Err` (a real I/O failure, not a normal skip) as a
/// non-fatal warning instead of propagating it with `?`.
fn relight_ring_around(
    app: &tauri::AppHandle,
    dst_world_dir: &str,
    dst_dimension: &str,
    touched: &[(i32, i32)],
) -> Result<RelightChunksReport> {
    if touched.is_empty() {
        return Ok(RelightChunksReport { relit: Vec::new(), backed_up: Vec::new(), skipped: Vec::new() });
    }
    relight_chunks_inner(app, dst_world_dir, dst_dimension, chunk_ring(touched))
}

/// The 1-chunk Chebyshev ring around `touched`, excluding `touched` itself
/// and de-duplicated — pulled out of `relight_ring_around` so the ring math
/// is unit-testable without touching disk.
fn chunk_ring(touched: &[(i32, i32)]) -> Vec<(i32, i32)> {
    let touched_set: std::collections::HashSet<(i32, i32)> = touched.iter().copied().collect();
    let mut ring: Vec<(i32, i32)> = Vec::new();
    let mut seen: std::collections::HashSet<(i32, i32)> = std::collections::HashSet::new();
    for &(cx, cz) in touched {
        for dx in -1..=1 {
            for dz in -1..=1 {
                if dx == 0 && dz == 0 { continue }
                let neighbor = (cx + dx, cz + dz);
                if touched_set.contains(&neighbor) { continue }
                if seen.insert(neighbor) { ring.push(neighbor) }
            }
        }
    }
    ring
}

#[cfg(test)]
mod ring_tests {
    use super::chunk_ring;
    use std::collections::HashSet;

    fn set(v: Vec<(i32, i32)>) -> HashSet<(i32, i32)> { v.into_iter().collect() }

    #[test]
    fn single_chunk_has_eight_neighbors() {
        let ring = chunk_ring(&[(0, 0)]);
        assert_eq!(ring.len(), 8);
        assert_eq!(set(ring), set(vec![
            (-1, -1), (0, -1), (1, -1),
            (-1, 0),           (1, 0),
            (-1, 1),  (0, 1),  (1, 1),
        ]));
    }

    #[test]
    fn adjacent_touched_chunks_dont_ring_each_other() {
        // Two side-by-side touched chunks: neither should appear in its own
        // ring (they're mutual neighbors, but both are already `touched`).
        let ring = set(chunk_ring(&[(0, 0), (1, 0)]));
        assert!(!ring.contains(&(0, 0)));
        assert!(!ring.contains(&(1, 0)));
        // A shared neighbor (e.g. (0,1), adjacent to both) appears once.
        assert_eq!(chunk_ring(&[(0, 0), (1, 0)]).iter().filter(|&&c| c == (0, 1)).count(), 1);
    }

    #[test]
    fn empty_input_gives_empty_ring() {
        assert!(chunk_ring(&[]).is_empty());
    }
}

/// Shared body behind `force_relight_chunks` and `relight_ring_around` —
/// assumes the caller already holds the destination world's write lock
/// (both do), so it neither resolves `dst_world_dir` from a level.dat path
/// nor acquires its own lock.
fn relight_chunks_inner(
    app: &tauri::AppHandle,
    dst_world_dir: &str,
    dst_dimension: &str,
    chunks: Vec<(i32, i32)>,
) -> Result<RelightChunksReport> {
    let mut by_region: HashMap<(i32, i32), Vec<(i32, i32)>> = HashMap::new();
    for &(cx, cz) in &chunks {
        by_region.entry((cx.div_euclid(32), cz.div_euclid(32))).or_default().push((cx, cz));
    }

    let mut relit = Vec::new();
    let mut backed_up = Vec::new();
    let mut skipped = Vec::new();

    for (&region, group) in &by_region {
        let (dst_dir, existing_bytes) =
            resolve_dst_region_for_chunk_write(dst_world_dir, dst_dimension, region.0, region.1)?;
        let Some(existing_bytes) = existing_bytes else {
            for &(cx, cz) in group {
                skipped.push(SkippedChunk {
                    chunk: (cx, cz),
                    reason: "Region not generated — nothing here to relight yet.".to_string(),
                });
            }
            continue;
        };

        let mut substitutions: HashMap<(usize, usize), Vec<u8>> = HashMap::new();

        for &(cx, cz) in group {
            let local_x = cx.rem_euclid(32) as usize;
            let local_z = cz.rem_euclid(32) as usize;
            let Some(mut chunk_nbt) = region_reader::read_chunk_nbt(&existing_bytes, local_x, local_z) else {
                skipped.push(SkippedChunk {
                    chunk: (cx, cz),
                    reason: "Chunk not generated — nothing here to relight yet.".to_string(),
                });
                continue;
            };

            let Some(root) = chunk_root_mut(&mut chunk_nbt) else {
                skipped.push(SkippedChunk { chunk: (cx, cz), reason: "Couldn't locate chunk root".to_string() });
                continue;
            };
            root.insert("isLightOn".to_string(), Value::Byte(0));

            let payload = match encode_chunk_payload(&chunk_nbt) {
                Ok(p) => p,
                Err(reason) => { skipped.push(SkippedChunk { chunk: (cx, cz), reason }); continue; }
            };
            substitutions.insert((local_x, local_z), payload);
            relit.push((cx, cz));
        }

        if substitutions.is_empty() {
            continue;
        }

        let backup = backup_existing_region(dst_world_dir, dst_dimension, region.0, region.1, &existing_bytes)?;
        backed_up.push(backup);

        let new_bytes = rewrite_region_with_chunks(Some(&existing_bytes), &substitutions);
        let final_path = dst_dir.join(format!("r.{}.{}.mca", region.0, region.1));
        let tmp_path = dst_dir.join(format!("r.{}.{}.mca.tmp", region.0, region.1));
        std::fs::write(&tmp_path, &new_bytes)
            .map_err(|e| format!("Couldn't write region file: {e}"))?;
        std::fs::rename(&tmp_path, &final_path)
            .map_err(|e| format!("Couldn't finalize region file: {e}"))?;
    }

    if !relit.is_empty() {
        let affected_regions: Vec<(i32, i32)> = by_region.keys().copied().collect();
        let cache_root = app.path().app_cache_dir()
            .map(|p| p.join("tile-cache").join(format!("v{}", tile_renderer::CACHE_VERSION)))
            .unwrap_or_else(|_| PathBuf::from("/tmp/msm-tile-cache"));
        tile_renderer::invalidate_mca_tiles(&cache_root, dst_world_dir, &affected_regions);
    }

    Ok(RelightChunksReport { relit, backed_up, skipped })
}

/// Resolve where a destination region file should live for a chunk-level
/// write, reading its existing bytes if any (needed both to carry untouched
/// chunks through unchanged and, for Y-trim, to look up the chunk being
/// merged into). No side effects — the caller may still skip every chunk
/// destined for this region, so nothing is backed up here.
fn resolve_dst_region_for_chunk_write(
    dst_world_dir: &str,
    dst_dimension: &str,
    rx: i32,
    rz: i32,
) -> Result<(PathBuf, Option<Vec<u8>>)> {
    match region_reader::find_region_file(dst_world_dir, dst_dimension, rx, rz) {
        Some(existing_path) => {
            let dir = existing_path
                .parent()
                .ok_or("destination region file has no parent directory")?
                .to_path_buf();
            let bytes = std::fs::read(&existing_path)
                .map_err(|e| format!("Couldn't read existing destination region: {e}"))?;
            Ok((dir, Some(bytes)))
        }
        None => {
            let dst_dirs = region_reader::region_dirs(dst_world_dir, dst_dimension);
            let dir = if dst_dirs[1].exists() && !dst_dirs[0].exists() { dst_dirs[1].clone() } else { dst_dirs[0].clone() };
            std::fs::create_dir_all(&dir)
                .map_err(|e| format!("Couldn't create region directory: {e}"))?;
            Ok((dir, None))
        }
    }
}

/// Back up an existing destination region's bytes before they're overwritten.
/// Split out from `resolve_dst_region_for_chunk_write` so a backup is only
/// ever written once the caller has confirmed a rewrite is actually
/// happening (some chunks in the group may all end up skipped).
fn backup_existing_region(
    dst_world_dir: &str,
    dst_dimension: &str,
    rx: i32,
    rz: i32,
    bytes: &[u8],
) -> Result<BackupEntry> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let backup_dir = Path::new(dst_world_dir).join("sojourner-backups").join(dst_dimension);
    std::fs::create_dir_all(&backup_dir)
        .map_err(|e| format!("Couldn't create backup dir: {e}"))?;
    let backup_path = backup_dir.join(format!("r.{rx}.{rz}.{ts}.mca.bak"));
    std::fs::write(&backup_path, bytes)
        .map_err(|e| format!("Couldn't back up existing region: {e}"))?;

    Ok(BackupEntry {
        region: (rx, rz),
        backup_path: backup_path.to_string_lossy().to_string(),
    })
}

/// Resolve the compound that holds `xPos`/`zPos`/`block_entities` — flat on
/// the chunk root for 1.18+, nested under a `Level` compound pre-1.18. Same
/// detection block_entity_reader.rs's `extract_block_entities` already uses.
fn chunk_root_mut(chunk: &mut Value) -> Option<&mut HashMap<String, Value>> {
    let Value::Compound(m) = chunk else { return None };
    if m.contains_key("xPos") || m.contains_key("block_entities") || m.contains_key("TileEntities") {
        return Some(m);
    }
    if matches!(m.get("Level"), Some(Value::Compound(_))) {
        let Some(Value::Compound(level)) = m.get_mut("Level") else { unreachable!() };
        return Some(level);
    }
    Some(m)
}

/// Read-only counterpart to `chunk_root_mut`, for reading the *source* chunk
/// while `splice_y_range` holds a mutable borrow of the destination chunk's
/// root — mirrors its detection logic exactly.
fn chunk_root(chunk: &Value) -> Option<&HashMap<String, Value>> {
    let Value::Compound(m) = chunk else { return None };
    if m.contains_key("xPos") || m.contains_key("block_entities") || m.contains_key("TileEntities") {
        return Some(m);
    }
    if let Some(Value::Compound(level)) = m.get("Level") {
        return Some(level);
    }
    Some(m)
}

/// A section compound's `Y` index (which 16-block Y-slice of the chunk it
/// is), or `None` if missing/malformed — same "just drop it, don't guess"
/// treatment `region_reader.rs`'s render-path section parsing gives a
/// Y-less section.
fn section_y(section: &Value) -> Option<i32> {
    let Value::Compound(m) = section else { return None };
    match m.get("Y") {
        Some(Value::Byte(y)) => Some(*y as i32),
        Some(Value::Short(y)) => Some(*y as i32),
        Some(Value::Int(y)) => Some(*y),
        _ => None,
    }
}

/// A block entity's `y` field, compared against an inclusive absolute-block
/// range. A block entity with no parseable `y` is conservatively treated as
/// out of range either way it's used below (kept on the destination side,
/// excluded on the source side) rather than guessed at.
fn block_entity_y_in_range(entry: &Value, y_lo: i32, y_hi: i32) -> bool {
    let Value::Compound(m) = entry else { return false };
    let y = match m.get("y") {
        Some(Value::Byte(y)) => *y as i32,
        Some(Value::Short(y)) => *y as i32,
        Some(Value::Int(y)) => *y,
        _ => return false,
    };
    y >= y_lo && y <= y_hi
}

/// Section-aligned Y-range merge: replaces the destination chunk's sections
/// (and block entities) within `[sec_lo, sec_hi]` with the source's, leaving
/// everything else (xPos/zPos, other sections, heightmaps, Status) untouched.
/// The copied range may extend up to 15 blocks beyond what was requested
/// (rounded outward to whole sections) — exact block-Y trimming needs a
/// per-block palette merge, later scope. Heightmaps/lighting aren't
/// recomputed, so MC shows a stale seam at the boundary until relit/resaved.
fn splice_y_range(
    dest_chunk: &mut Value,
    source_chunk: &Value,
    sec_lo: i32,
    sec_hi: i32,
    dx_blocks: i32,
    dz_blocks: i32,
) {
    let in_range = |y: i32| y >= sec_lo && y <= sec_hi;

    let source_sections: Vec<Value> = chunk_root(source_chunk)
        .and_then(|m| m.get("sections"))
        .and_then(|v| if let Value::List(l) = v { Some(l.as_slice()) } else { None })
        .unwrap_or(&[])
        .iter()
        .filter(|s| section_y(s).is_some_and(in_range))
        .cloned()
        .collect();

    let y_lo = sec_lo * 16;
    let y_hi = sec_hi * 16 + 15;
    let mut source_block_entities: HashMap<&str, Vec<Value>> = HashMap::new();
    for key in ["block_entities", "TileEntities"] {
        let entries: Vec<Value> = chunk_root(source_chunk)
            .and_then(|m| m.get(key))
            .and_then(|v| if let Value::List(l) = v { Some(l.as_slice()) } else { None })
            .unwrap_or(&[])
            .iter()
            .filter(|e| block_entity_y_in_range(e, y_lo, y_hi))
            .cloned()
            .map(|mut e| {
                if let Value::Compound(be) = &mut e {
                    shift_i32_field(be, "x", dx_blocks);
                    shift_i32_field(be, "z", dz_blocks);
                }
                e
            })
            .collect();
        source_block_entities.insert(key, entries);
    }

    let Some(root) = chunk_root_mut(dest_chunk) else { return };

    let mut sections = match root.remove("sections") {
        Some(Value::List(l)) => l,
        _ => Vec::new(),
    };
    sections.retain(|s| !section_y(s).is_some_and(in_range));
    sections.extend(source_sections);
    root.insert("sections".to_string(), Value::List(sections));

    root.remove("structures");

    for key in ["block_entities", "TileEntities"] {
        let had_key = root.contains_key(key);
        let mut kept: Vec<Value> = match root.remove(key) {
            Some(Value::List(l)) => l.into_iter().filter(|e| !block_entity_y_in_range(e, y_lo, y_hi)).collect(),
            _ => Vec::new(),
        };
        kept.extend(source_block_entities.remove(key).unwrap_or_default());
        if had_key || !kept.is_empty() {
            root.insert(key.to_string(), Value::List(kept));
        }
    }
}

fn shift_i32_field(m: &mut HashMap<String, Value>, key: &str, delta: i32) {
    let Some(v) = m.get_mut(key) else { return };
    let current = match v {
        Value::Int(n) => *n,
        Value::Short(n) => *n as i32,
        Value::Byte(n) => *n as i32,
        _ => return,
    };
    *v = Value::Int(current + delta);
}

/// Mutate a decoded chunk's NBT in place for its new position: `xPos`/`zPos`
/// (chunk coords), every block entity's `x`/`z` (block coords — `y` is
/// unchanged, this is a horizontal-only move), and strip `structures` (see
/// module doc comment above for why).
fn relocate_chunk_nbt(chunk: &mut Value, new_cx: i32, new_cz: i32, dx_blocks: i32, dz_blocks: i32) {
    let Some(root) = chunk_root_mut(chunk) else { return };

    root.insert("xPos".to_string(), Value::Int(new_cx));
    root.insert("zPos".to_string(), Value::Int(new_cz));
    root.remove("structures");

    for key in ["block_entities", "TileEntities"] {
        if let Some(Value::List(list)) = root.get_mut(key) {
            for entry in list.iter_mut() {
                if let Value::Compound(be) = entry {
                    shift_i32_field(be, "x", dx_blocks);
                    shift_i32_field(be, "z", dz_blocks);
                }
            }
        }
    }
}

/// Serialize + zlib-compress one chunk's NBT into its Anvil on-disk payload
/// (4-byte BE length prefix + 1-byte compression-type byte + compressed
/// data) — everything after the sector boundary, before sector padding
/// (added by the caller when laying it into a rebuilt region file).
fn encode_chunk_payload(chunk: &Value) -> Result<Vec<u8>> {
    let raw = fastnbt::to_bytes(chunk).map_err(|e| format!("Couldn't serialize chunk NBT: {e}"))?;

    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(&raw).map_err(|e| format!("Couldn't compress chunk: {e}"))?;
    let compressed = encoder.finish().map_err(|e| format!("Couldn't finish compression: {e}"))?;

    let mut payload = Vec::with_capacity(5 + compressed.len());
    payload.extend_from_slice(&((compressed.len() + 1) as u32).to_be_bytes());
    payload.push(2u8); // zlib — same convention real MC writers use
    payload.extend_from_slice(&compressed);
    Ok(payload)
}

/// Rewrite a whole region file: substitute specific (local_x, local_z) slots
/// with new payloads, carry every other chunk through byte-for-byte
/// unchanged (no decompress/recompress round trip). Sequential repack in
/// file order rather than free-sector bookkeeping — simplest correct writer,
/// per TODO_MCA_WRITE_EDITING.md. `existing_bytes` is `None` for a new region file.
fn rewrite_region_with_chunks(
    existing_bytes: Option<&[u8]>,
    substitutions: &HashMap<(usize, usize), Vec<u8>>,
) -> Vec<u8> {
    let mut out = vec![0u8; 8192]; // location table + timestamp table
    let mut next_sector: u32 = 2; // sectors 0 and 1 are the two header tables

    for lz in 0..32usize {
        for lx in 0..32usize {
            let payload = substitutions.get(&(lx, lz)).cloned().or_else(|| {
                existing_bytes.and_then(|buf| region_reader::read_chunk_raw_payload(buf, lx, lz))
            });
            let Some(payload) = payload else { continue };

            let sector_count = (payload.len().div_ceil(4096)).max(1);

            let header_offset = 4 * (lx + lz * 32);
            out[header_offset] = ((next_sector >> 16) & 0xFF) as u8;
            out[header_offset + 1] = ((next_sector >> 8) & 0xFF) as u8;
            out[header_offset + 2] = (next_sector & 0xFF) as u8;
            out[header_offset + 3] = sector_count as u8;

            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs() as u32)
                .unwrap_or(0);
            let ts_offset = 4096 + header_offset;
            out[ts_offset..ts_offset + 4].copy_from_slice(&now.to_be_bytes());

            let byte_offset = next_sector as usize * 4096;
            let needed_len = byte_offset + sector_count * 4096;
            if out.len() < needed_len {
                out.resize(needed_len, 0);
            }
            out[byte_offset..byte_offset + payload.len()].copy_from_slice(&payload);

            next_sector += sector_count as u32;
        }
    }

    out
}
