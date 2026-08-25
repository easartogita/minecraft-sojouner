# Sojourner — TODO

## Refactoring

- **Overlay toggle sprawl** — adding a new boolean overlay requires touching 6+ places: `AppState` interface, `Action` union, reducer `case`, `loadSession`, `initialState`, session-save object, session-save dep array, and `LayersFlyout.tsx`. Consolidate into a data-driven overlay registry (name, default, persist flag) so new overlays are a one-liner entry, not a 6-file diff.

---

## Debug Panel (F3)

Hasn't had a real audit since the static-export/tile-rendering rework — likely blind to
parts of the new pipeline (compositing, static-export progress, whatever else changed in
`tile_renderer.rs`/`static_export.rs`). Worth a pass before piling more onto it.

- [ ] **Audit pass** — verify every existing stat (biome/chunk/overlay cache size + hit rate, queue sizes, per-layer stats in `DebugOverlay.tsx`) still reflects reality post-rework; add whatever's currently flying blind
- [ ] **Disk-cache visibility + pruning** — total on-disk tile-cache size across *all* cached worlds (dozens accumulate over time), not just the open one. Compute lazily — one `app_cache_dir` walk on-demand (panel open / a button), not scanned per tile render. Pair with a manual "prune worlds not opened in N days" action; `delete_tile_cache` already exists per-world (`lib.rs`), this just needs a driver plus the disk-usage number to act on. RAM-side cache sizes already shown; this is the disk-side gap.

---

## World Save Data

### Entity data
- [ ] **Villager assignments** — linked bed + workstation position (POI cross-reference)

### Points of interest — `poi/*.mca`
Beds, workstations, meeting points (bells), lodestones, and nether portals all render as
markers now (`poiConfig.ts`, `PoiLayer.tsx`). Skull/player-head, structure-block, and
command-block block entities also ship (`markerFilters.ts`).
- [ ] **Nether portal pairing** — deduplicate multi-block portals by X/Z footprint; cross-link overworld↔nether pairs

### Player data — `playerdata/*.dat`
- [x] **Respawn point** — `SpawnX/Y/Z` + `SpawnDimension`; bed icon marker (`PlayerRespawnMarker.tsx`, always-on alongside the world spawn marker)
- [ ] **All player positions** — every player's last location (multiplayer)
- [ ] **Player inventory + ender chest** — grid in sidebar on marker click
- [ ] **Stats panel** — play time, deaths, top mobs killed, distance traveled (`stats/<uuid>.json`)

### Map items — `data/map_*.dat`
- [ ] **Map banners as markers** — named, colored waypoints placed by the player on in-game maps; aggregate + deduplicate across all map files
- [ ] **Map boundary rectangles** — faint outlines showing which areas are mapped and at what scale
- [ ] **Map image overlay** — decode 128×128 colour buffer (MC map palette) and display at correct world position

### Chunk data (from `region/*.mca` NBT, already parsed)
- [ ] **LastUpdate heatmap** — ticks-since-last-visit per chunk; cold→warm colour gradient showing exploration coverage
- [ ] **Dark spot overlay** — surface blocks with sky light < 8 (mob spawn threshold); red tint proportional to unsafe fraction per chunk
- [ ] **Blending seam indicator** — `blending_data` presence marks chunks regenerated under a new MC version; useful for spotting terrain style breaks
- [ ] **Chunk structure data** — `chunk_val["structures"]["Starts"]`: authoritative positions + bounding boxes from loaded chunks; supplements cubiomes predictions and enables piece-level detail (stronghold rooms, village footprints)

### World / level data
- [x] **World Border overlay** — `L.rectangle`; only shown when smaller than vanilla's untouched 60M-block default (`WorldBorderLayer.tsx`)
- [ ] **Game Rules display** — sidebar list of non-default rules (`doMobSpawning`, `keepInventory`, `naturalRegeneration`, etc.)
- [ ] **Server brand badge** — `ServerBrands` from `level.dat`; warn when non-vanilla (cubiomes predictions may be unreliable)
- [ ] **Dragon Fight state** — alive/killed/respawned + remaining gateway angles → gateway markers on End dimension
- [ ] **Active raids** — position, wave progress, omen level badge (`data/raids.dat`)

### Advancements — `advancements/<uuid>.json`
- [ ] **Biome exploration overlay** — `adventuring_time` criteria keys are biome IDs; tint visited chunks; timestamp for first-visit ordering
- [ ] **Structure visit badges** — advancements like `find_bastion`, `find_end_city` confirm actual visits; "visited" badge on structure markers

---

## Route Planner / Waypoints

Shipped: persistence, named + multiple saved routes, Google-Maps-style active-route model,
per-leg travel modes (On Foot/Boat/Mounted/Elytra/Spectator/Nether Highway), auto-detected
punitive sub-modes (swim/ice/snow) via biome-based leg splitting, dash-by-speed line
rendering, right-click pin/route context menu. See `WISHLIST.md` for the big unscoped
next step (Road Maker/Road Finder) and smaller companion ideas.

- [ ] **Waypoint snapping** — snap a placed waypoint to a nearby structure/pin marker instead of the raw click position
- [ ] **Mid-route editing** — insert a waypoint in the middle of a route, or drag-to-reorder; today only append-at-the-end (via Edit mode) exists

---

## Structure Copy/Paste (dev-only feature)

Block-level copy/paste (`structure_copy/`) is fully shipped through v3 (arbitrary
block-box copy with rotation/mirror) plus template save/load, gated
`#[cfg(debug_assertions)]` on the Tauri commands themselves until a backup/restore
strategy exists — see `TODO_MCA_WRITE_EDITING.md`.

- [ ] **Destination-world map picker for chunk-mode placement** — when targeting a
  different world than the one currently on the map, replace the blind X/Z number
  inputs with a modal showing that destination world's own rendered map to click a
  real position on instead of typing coordinates.
- [ ] **Block-entity orientation NBT rotation** — position moves with rotation, but
  block-entity-level orientation (if it lives outside the blockstate for any real
  block type) isn't rotated; unconfirmed whether this actually matters in practice.
- [ ] **Source-world live-session check** — only the destination world's
  `session.lock` is held during a copy; a source world open in a live Minecraft
  client during the read isn't checked.
- [ ] **Migrate Route Planner into the right rail** — `RightRail.tsx` currently
  hosts only the Structure Copy flyout; folding `RulerPanel.tsx` in is a recommended
  fast-follow now that the right rail exists.

---

## Wishlist

See `WISHLIST.md` for ideas not on the active roadmap (Find Chest With Item, Road Maker/
Road Finder, server-operator tooling, cross-cutting UX), and `TODO_MCA_WRITE_EDITING.md`
for write-support scoping notes.

---

## Technical Notes

**MC version quirks**
- 1.21.5 seed: `data/minecraft/world_gen_settings.dat` (not `level.dat`)
- 1.21.5 spawn: `spawn.pos` intArray `[x,y,z]`; older: `SpawnX`/`SpawnZ` ints
- 1.21.5 region path: `dimensions/minecraft/overworld/region/r.X.Z.mca`
- nbt library stores Long as `[hi, lo]` (upper word first)

**cubiomes enum values** (verified against source, 2026-08-24 — check `constants.ts`/
`structures.rs` directly before trusting this if it's been a while, cubiomes IDs have
shifted before when structure types were added upstream)
- MC versions (`constants.ts`): `MC_1_16=20` (also covers 1.17, no gen change), `MC_1_18=22, MC_1_19=24, MC_1_20=25` (also covers 1.21–1.21.3), `MC_1_21_4=28` (also covers 1.21.5–26.1)
- Structure types (`cubiomes/structures.rs`): `Village=5, Desert_Pyramid=1, Jungle_Temple=2, Swamp_Hut=3, Igloo=4, Ocean_Ruin=6, Shipwreck=7, Monument=8, Mansion=9, Outpost=10, Ruined_Portal=11, Ruined_Portal_N=12, Ancient_City=13, Buried_Treasure=14, Mineshaft=15, Desert_Well=16, Geode=17, Fortress=18, Bastion=19, End_City=21, End_Gateway=22, End_Island=23, Trail_Ruins=24, Trial_Chambers=25, Abandoned_Camp=26`

**Heightmap / block data**
- `MOTION_BLOCKING` raw value + `(yPos * 16) - 1` = surface blockY
- Packed long arrays (1.16+ format): values don't span long boundaries; `bitsPerValue = max(4, ceil(log2(paletteSize)))`, `valuesPerLong = floor(64 / bitsPerValue)`
