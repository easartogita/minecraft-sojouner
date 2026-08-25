//! Loud, always-on (no env-var gate, unlike `tile_renderer::trace_log`) detection for
//! hardcoded NBT field-name assumptions a future MC version could rename out from under
//! us. Should fire rarely; when it does, noisy beats invisible.
use std::collections::HashSet;
use std::io::Write;
use std::sync::{Mutex, OnceLock};

fn seen() -> &'static Mutex<HashSet<&'static str>> {
    static SEEN: OnceLock<Mutex<HashSet<&'static str>>> = OnceLock::new();
    SEEN.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Report a hardcoded NBT field/shape assumption that failed to resolve on data that
/// otherwise looks populated. Logs once per `tag` per process run — call sites are
/// typically in a per-chunk/per-entity loop, so without dedup this would flood the log.
pub fn format_warn(tag: &'static str, detail: &str) {
    {
        let mut s = seen().lock().unwrap();
        if !s.insert(tag) {
            return;
        }
    }
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let line = format!("[{ms}] {tag}: {detail}\n");
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/sojourner-format-warnings.log")
    {
        let _ = f.write_all(line.as_bytes());
    }
    eprintln!("sojourner: possible NBT format change — {tag}: {detail}");
}

/// Resolve a string value Minecraft has renamed/reshaped across versions: either
/// `entry` is a bare string (a version's compact form), or a compound to probe with
/// each of `keys` in order. Keeps the next rename to "add one alias" instead of a
/// bespoke `.or_else()` chain per call site. Returns `None` on no match — callers
/// filter_mapping over a list should compare lengths and call `format_warn` once for
/// any drops (see `parse_section`/`parse_biomes` in region_reader.rs).
pub fn resolve_aliased_str<'a>(entry: &'a fastnbt::Value, keys: &[&str]) -> Option<&'a str> {
    if let fastnbt::Value::String(s) = entry {
        return Some(s.as_str());
    }
    let fastnbt::Value::Compound(m) = entry else { return None };
    for k in keys {
        if let Some(fastnbt::Value::String(s)) = m.get(*k) {
            return Some(s.as_str());
        }
    }
    None
}
