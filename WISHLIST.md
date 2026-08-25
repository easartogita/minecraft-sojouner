# Wishlist

Ideas and future directions that aren't on the immediate roadmap — no design commitment,
no scheduling. See `TODO.md` for actively tracked, scoped work. Bigger ideas substantial
enough to need their own scoping doc get one and are linked from here rather than inlined
(see `TODO_MCA_WRITE_EDITING.md`).

Validated against current code 2026-08-24 — several older entries here (stronghold ring,
spawn-chunks ring, coordinate paste, per-world layer-toggle persistence) turned out to
already be shipped and were dropped rather than migrated.

---

## Find Chest With Item

Search the open world for any chest, barrel, hopper, dispenser, or shulker box containing a
specific item. Block entities are stored in the same chunk NBT already parsed for tile
rendering — the new work is scanning all `.mca` files and extracting inventories.

Key design questions:
- **Query model** — match by item ID (`minecraft:diamond`), display name (renamed items), enchantment, or some combination
- **Search scope** — full world scan or user-defined radius; needs a background job with progress reporting since a large world can have hundreds of region files
- **Result display** — clickable map markers that fly to the chest location, plus a results list panel

On the Rust side: scan chunks via `fastnbt`, extract `block_entities` arrays, filter by container block types, walk the `Items` NBT list.

---

## Route Planner: "Road Maker" mode (big, own sub-project)

A seventh travel mode, internal key `active_mining`, labeled **"Road Maker"**, categorically
different from the rest: every existing mode (walk/boat/mounted/elytra/spectator/
nether_highway) just annotates the user-drawn straight leg with a speed. Road Maker instead
**replaces** the straight leg with a computed 3D tunnel path — a real player can't mine a
diagonal line efficiently, only orthogonal (axis-aligned X/Z) runs joined by turns.

**Hard precondition:** only offer this mode where real chunk data already exists on disk for
every region the leg crosses. It has to read actual per-block data — the same real data Cave
Mode already reads via `region_reader.rs`'s section/palette decode — not cubiomes' procedural
cave-carver prediction (`cubiomes_get_carved_columns`, seed-based/approximate/works on
ungenerated chunks but not trustworthy enough to route a tunnel through). Before offering
`active_mining` for a leg, check that all `.mca` regions spanning its bounding box exist; if
any are missing, disable the option with an explanation rather than silently falling back to
prediction.

**Disclaimer, always shown while active:** the computed path is only as fresh as the last
save to disk. A player (or anyone else on a shared world) may have changed the terrain since.
This is a plan, not a guarantee.

**Mining speed isn't a fixed constant** — depends on tool tier, Efficiency, Haste/Mining
Fatigue, hunger exhaustion, and block hardness. Two calibration tiers instead of guessing one
number:
- **v1 — manual stopwatch:** user clicks Start, app beeps, user mines in-game, clicks Stop
  (or a fixed-interval beep), reports distance covered → app computes blocks/second.
- **Goal — auto-measured** via the separate AI-player-bridge project (`bridge/`, NeoForge
  WebSocket telemetry mod) once it can report live position — same start/beep/stop flow, no
  manual distance self-report. Ties this feature's calibration to that other in-progress
  subsystem.

**Algorithm sketch:**
1. Sweep a broad range of candidate Y levels for the leg — the workable mining band, not a fixed slice around wherever the player happens to be standing.
2. At each candidate Y, read cave/void status per column via Cave Mode's real-data floor scan (`region_reader.rs`, `extract_surface`), narrowed to a tight window around that Y. "Floor found nearby" = hazard (a cave/air pocket where a pitfall could open up); "no floor found" = safety signal (most often solid rock). *Known gap:* void doesn't currently distinguish solid rock from an open cavern with no walkable floor — both read the same today; worth tightening before this is trustworthy enough to route through.
3. Search the whole leg for the Y (or short Y-band sequence, for routes that need to ascend/descend) maximizing contiguous orthogonal straight-run length and minimizing turn count while staying in void columns.
4. Render as its own polyline shape — a staircase of orthogonal segments, not the direct waypoint-to-waypoint line. The one travel type where the drawn line and the straight-line leg genuinely diverge.

**New backend work required:** no existing function does a bulk multi-column cave/void query
— today's real-data floor scan is single-column, single-window. Needs a batched query that
parses each spanned region file once and answers many column/Y lookups from that single
parse.

**Break-even judgment call belongs to the tool, not the user:** compare the drawn route's
total time against straight-line-distance-at-walk-speed and flag when the planning effort is
unlikely to be worth its own setup cost, rather than making the user reason about where that
line is.

**Phase 2 (not scoped further):** auto-routing to minimize total travel time, and a
"minimize jumps" variant favoring mount/boat bonus — both consume the per-leg mode +
biome-sampling groundwork as input once they exist.

### "Road Finder" — surface counterpart, further out

Where Road Maker computes a mined underground tunnel, Road Finder would scan already-
available heightmap data (`WORLD_SURFACE`/`MOTION_BLOCKING`) for long stretches of low
Y-variance between neighboring columns — naturally flat surface terrain supporting fast
sprinting. Would need to exclude water (reusing Boat mode's ocean-biome-ID filter) — flat
and submerged isn't a walkable road.

Open question before scoping further: Road Maker's hard "real chunk data only"
precondition exists because it needs actual cave voids. Surface height might not have that
constraint if `cubiomes/terrain.rs` can predict height procedurally from the seed alone —
would let Road Finder work on unvisited chunks too, unlike Road Maker. Not confirmed, check
`terrain.rs`'s actual capability first.

What's still Road Finder's job and not covered by anything shipped: *avoiding* bad terrain
(a snowdrift, a Y-variance heightmap hole) by routing around it, rather than walking
straight through and reporting an honest slow time — the biome-splitting mechanism will
always tell the truth about a leg, it will never choose a different path to dodge one.

**Related, unscoped:** ice-boat highways (packed-ice roads, 40-70+ blocks/s) are a third
"built infrastructure changes travel speed" concept alongside Road Maker (mined tunnel) and
Road Finder (natural surface corridor) — likely share pathfinding machinery with whichever
of the other two gets built first.

### Companion features (worth adding alongside Road Maker/Finder)

- **Mode-comparison table.** Before locking a mode per leg, show total route time under every mode side by side (Walk/Boat/Mounted/Elytra/Spectator/Nether Highway/Road Maker), all from the same total distance — cheap (same per-mode math run N times), and what actually lets someone decide "is it worth building the highway, or should I just fly it."
- **Portal-pair placement for Nether Highway legs.** Auto-suggest where to place both portals (the ÷8 projection at each end) for a leg tagged `nether_highway`, not just report the time saved. Overlaps with the Nether portal helper idea below, but scoped to a specific route leg instead of an arbitrary pin.
- **Materials estimate for Road Maker.** Since that mode computes a real 3D tunnel path, report blocks-to-mine and a rough torch count (every N blocks, to prevent mob spawns) for close to free.
- **Round-trip toggle.** Double the total for a simple there-and-back trip, or let the return leg use a different mode (walk there, boat back).
- **Hazard overlay on walk legs**, reusing the Dark Spot overlay idea in `TODO.md` (surface blocks with sky light < 8) — sample it along `walk`-mode legs specifically to flag "this leg passes through unlit ground, expect mobs."

### Pin UX

- **Pin categories / colors** — assign a color to a pin, rendered as a colored marker, filterable in the sidebar.
- **Pin notes** — multi-line text field per pin, shown in tooltip on the marker.
- **Import/export** — export as JSON or `/tp` command list.
- **Named pin groups** — arbitrary (non-route) pins grouped and toggled together. Saved Routes ended up *not* being this — routes shipped as their own standalone concept (waypoints + leg modes), not a named ordered group of pins — so this is still open on its own terms.

---

## Navigation & wayfinding

- **Nether portal helper.** When a pin or structure is selected, show "your OW portal should be at X/Z to land here in Nether." Better than the current dual-coord display.
- **Light-level overlay** at zoom ≥ chunk-data. Players currently use external mods for this; the region read path already exists.
- **Graduated axis rulers.** CAD/photo-editor-style ruler bars along two map edges (not just the existing corner scale-bar legend), ticked in coordinate values. Zoom-adaptive graduation — `YRangeGauge.tsx` already does zoom-adaptive tick spacing/snapping for the Y axis and is the logical thing to lift the pattern from. Graduate in chunk-aligned steps (16/32/64/128/512-block region lines), not decimal, since that's the meaningful unit here; stop refining once a graduation would be under ~2 screen pixels (same guard Leaflet's own scale control uses). Open question: two always-on ruler bars cost permanent screen space, especially with both side rails open — may want this as a richer corner scale-bar instead.

## Loadouts

- **Layer presets.** Chips at the top of the Layers flyout:
  - *Mob-farming kit* = slime + spawn radius + chunk grid
  - *Speedrun kit* = strongholds + ruined portals + villages
  - *Builder kit* = chunk grid + region grid + light
  One-click bundles cut the cognitive load on what is now a long flyout.

## Sharing & export

- **PNG / clipboard export of current viewport.** TIFF is for archival; players want to drop a screenshot in Discord.
- **Share link.** Encode `seed + version + dimension + center + zoom + enabled layers` into a JSON or URL fragment. Opening it reproduces the view.

---

## Server-operator-facing

Biggest unmet need. Today Sojourner is mostly "biome map + your own world's chunks"; for an
operator it could be a real diagnostic console.

- **Entity density heatmap** per chunk (counts from `.mca`). Operators chase lag — coloring chunks by entity count instantly shows mob farms and item-frame hoards.
- **Block-entity density.** Same idea: chunks with hundreds of chests/hoppers/shulkers light up. Pair with a clickable list ("top 20 chunks by hopper count").
- **Force-loaded chunks overlay.** Read tickets from `data/chunks.dat` / per-world forced-chunks dat.
- **Modified-vs-natural overlay.** Heuristic: chunks where surface biome doesn't match the actual top blocks → likely player-built. Approximation is fine; just flag the chunks.
- **Region last-modified heatmap.** Color by `mtime` of `.mca`. Instantly answers "where has activity happened in the last week?"
- **Sign-text & command-block search.** Indexed search across block entities. Moderation win: "find signs containing X", "find command blocks referencing player Y".
- **Spawner inventory.** A sortable list of every monster-spawner with mob type & coords — essential for dungeon mapping and farm audits.
- **`level.dat` viewer.** A read-only tree: gamerules, difficulty, world borders, datapacks, hardcore flag, game version history. The data is already read; surface it — the World panel doesn't cover most of this yet.
- **Datapack / non-vanilla detection.** If world-gen is non-vanilla, badge it more prominently than the current `custom ⚠` — bad structure data has bitten ops before.

---

## Cross-cutting UX

- **Layer flyout is getting long.** Add a search/filter input at the top, and collapse sections (Biomes / Terrain / Special / Grids).
- **Cursor info bar grows horizontally** with each enabled overlay. At some point that should wrap or use compact pills; otherwise it pushes off the right edge.
- **MapToolbar duplicates Layers-flyout toggles** (Biomes, Slime, Ores, Grid). Decide: either the toolbar is a "quick row" of most-used toggles, or it's the canonical place. Right now both exist and can disagree visually (a layer with an opacity slider in the flyout but only on/off in the toolbar).
- **Auto-detect save locations.** The empty state already has drag-drop and recents; consider also auto-detecting `~/.minecraft/saves/` and `~/Library/Application Support/minecraft/saves/` and showing the world list with last-played sort, since many users don't know where their saves live.
- **Follow-player hold-to-toggle is non-obvious.** A small chevron/dropdown on the button with explicit *Follow* / *Pan once* would beat the 500ms hold heuristic.
- **Color-blind palette toggle**, especially for biome colors and the slime/ore overlays.
- **Tile loading HUD: recent-timings history.** The slow-render escalation (`TileLoadingHud.tsx`) now flags a queue stuck non-empty for a while, but there's still no historical view — a small expandable panel showing queue depth over the last N seconds would help when explaining performance issues, beyond just "it's slow right now."
