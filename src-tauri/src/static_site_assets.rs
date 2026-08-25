// Pre-built static-site viewer (../dist-site/, from vite.site.config.ts) embedded at
// compile time so a static export always ships the viewer matching this build. See
// build.rs for the placeholder used when dist-site/ hasn't been built yet.
use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "../dist-site/"]
pub struct StaticSiteAssets;

/// Extracts into `out_dir`, preserving relative paths — the same layout
/// `run_static_export` writes manifest.json/tiles/data into.
pub fn extract_into(out_dir: &std::path::Path) -> Result<(), String> {
    for path in StaticSiteAssets::iter() {
        let file = StaticSiteAssets::get(&path)
            .ok_or_else(|| format!("Embedded static-site asset vanished mid-extract: {path}"))?;
        let dest = out_dir.join(path.as_ref());
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("Couldn't create {}: {e}", parent.display()))?;
        }
        std::fs::write(&dest, file.data).map_err(|e| format!("Couldn't write {}: {e}", dest.display()))?;
    }
    Ok(())
}
