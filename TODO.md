# Minecraft Sojourner — TODO

## Refactoring

- **Overlay toggle sprawl** — adding a new boolean overlay requires touching 6+ places: `AppState` interface, `Action` union, reducer `case`, `loadSession`, `initialState`, session-save object, session-save dep array, and `ViewPanel`. Consolidate into a data-driven overlay registry (name, default, persist flag) so new overlays are a one-liner entry, not a 6-file diff.

---

## World Save Data

### Block entities (TS-only additions)
- [ ] **Player head / skull** — owner profile / player name (LOW)
- [ ] **Structure block** — `name` + `mode`; useful for map/adventure worlds (LOW)
- [ ] **Command block** — stored command string (LOW)

### Entity data
- [ ] **Villager assignments** — linked bed + workstation position (POI cross-reference)

### Points of interest — `poi/*.mca`
- [/] **Beds** — position + owner UUID
- [/] **Workstations** — type + owner UUID; job site coverage
- [/] **Village meeting points** — bell positions; defines village centre
- [ ] **Nether portals** — deduplicate by X/Z footprint; cross-link overworld↔nether pairs
- [ ] **Lodestones** — position markers (all dimensions)

### Player data — `playerdata/*.dat`
- [ ] **Respawn point** — `SpawnX/Y/Z` + `SpawnDimension`; bed icon marker
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
- [ ] **World Border overlay** — `L.rectangle` with warning band; only show when smaller than default 60M blocks
- [ ] **Game Rules display** — sidebar list of non-default rules (`doMobSpawning`, `keepInventory`, `naturalRegeneration`, etc.)
- [ ] **Server brand badge** — `ServerBrands` from `level.dat`; warn when non-vanilla (cubiomes predictions may be unreliable)
- [ ] **Dragon Fight state** — alive/killed/respawned + remaining gateway angles → gateway markers on End dimension
- [ ] **Active raids** — position, wave progress, omen level badge (`data/raids.dat`)

### Advancements — `advancements/<uuid>.json`
- [ ] **Biome exploration overlay** — `adventuring_time` criteria keys are biome IDs; tint visited chunks; timestamp for first-visit ordering
- [ ] **Structure visit badges** — advancements like `find_bastion`, `find_end_city` confirm actual visits; "visited" badge on structure markers

---

## Wishlist

### Route Planner
Click a sequence of waypoints; the app draws the path and reports total overworld distance, nether equivalent (÷8), and per-leg breakdown. Waypoints snap to structure/pin markers. Primary use: planning nether highway layouts — map overworld destinations, read off nether portal coordinates.

### Find Chest With Item
Search all `.mca` files for any container holding a specific item ID, display name, or enchantment. Background job with progress; results as clickable map markers. Rust side: scan chunks via `fastnbt`, filter container block entities, walk `Items` NBT.

### Cave Entrance Detection
Where `WORLD_SURFACE` Y is significantly higher than `MOTION_BLOCKING` Y at the same column → likely cave entrance, ravine, or overhang. Render as a faint overlay at chunk-data zoom levels.

### Pin UX
- Right-click context menu: "Drop pin here", "Copy coordinates"
- Pin categories / colors — filterable in sidebar
- Pin notes — multi-line text per pin, shown in tooltip
- Import/export as JSON or `/tp` command list

---

## Technical Notes

**MC version quirks**
- 1.21.5 seed: `data/minecraft/world_gen_settings.dat` (not `level.dat`)
- 1.21.5 spawn: `spawn.pos` intArray `[x,y,z]`; older: `SpawnX`/`SpawnZ` ints
- 1.21.5 region path: `dimensions/minecraft/overworld/region/r.X.Z.mca`
- nbt library stores Long as `[hi, lo]` (upper word first)

**cubiomes enum values** (verified from headers)
- MC versions: `MC_1_16=20, MC_1_17=21, MC_1_18=22, MC_1_19=24, MC_1_20=25, MC_1_21=28`
- Structure types: `Village=5, Desert_Pyramid=1, Jungle_Temple=2, Swamp_Hut=3, Igloo=4, Ocean_Ruin=6, Shipwreck=7, Monument=8, Mansion=9, Outpost=10, Ruined_Portal=11, Ruined_Portal_N=12, Ancient_City=13, Desert_Well=16, Fortress=18, Bastion=19, End_City=20, Trail_Ruins=23, Trial_Chambers=24`

**Heightmap / block data**
- `MOTION_BLOCKING` raw value + `(yPos * 16) - 1` = surface blockY
- Packed long arrays (1.16+ format): values don't span long boundaries; `bitsPerValue = max(4, ceil(log2(paletteSize)))`, `valuesPerLong = floor(64 / bitsPerValue)`
