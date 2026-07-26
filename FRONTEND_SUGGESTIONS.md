# Frontend improvement ideas

Suggestions for Sojourner from the perspective of a player and a server operator. Organized by audience, with a final cross-cutting section for general UX wins.

---

## Player-facing

### Navigation & wayfinding

- **Route planner.** Largely shipped — per-leg travel modes, biome-aware boat/foot splitting, nether-highway timing, and named saved routes are all in. See `TODO_WAYPOINTS.md` for the shipped checklist and what's still open (waypoint snapping, mid-route editing, Road Maker/Finder).
- **Stronghold ring overlay.** cubiomes already exposes stronghold positions. Players ask for this constantly.
- **Spawn-chunks ring** — the always-loaded 19×19 chunks around world spawn. Useful for AFK builds, farms, and answering "why is this chunk always loaded?".
- **Nether portal helper.** When a pin or structure is selected, show "your OW portal should be at X/Z to land here in Nether." Better than the current dual-coord display.
- **Light-level overlay** at zoom ≥ chunk-data. Players currently use external mods for this; the region read path already exists.

### Loadouts

- **Layer presets.** Chips at the top of the Layers flyout:
  - *Mob-farming kit* = slime + spawn radius + chunk grid
  - *Speedrun kit* = strongholds + ruined portals + villages
  - *Builder kit* = chunk grid + region grid + light
  One-click bundles cut the cognitive load on what is now a long flyout.
- **Per-world saved state.** `state.uiScale` persists; verify the enabled-structure set and other layer toggles do too. Starting every new world from blank toggles is painful.

### Sharing & export

- **PNG / clipboard export of current viewport.** TIFF is for archival; players want to drop a screenshot in Discord.
- **Share link.** Encode `seed + version + dimension + center + zoom + enabled layers` into a JSON or URL fragment. Opening it reproduces the view.

---

## Server-operator-facing

Biggest unmet need. Today Sojourner is mostly "biome map + your own world's chunks"; for an operator it could be a real diagnostic console.

- **Entity density heatmap** per chunk (counts from `.mca`). Operators chase lag — coloring chunks by entity count instantly shows mob farms and item-frame hoards.
- **Block-entity density.** Same idea: chunks with hundreds of chests/hoppers/shulkers light up. Pair with a clickable list ("top 20 chunks by hopper count").
- **Force-loaded chunks overlay.** Read tickets from `data/chunks.dat` / per-world forced-chunks dat. Operators *really* want this visible.
- **Modified-vs-natural overlay.** Heuristic: chunks where surface biome doesn't match the actual top blocks → likely player-built. Approximation is fine; just flag the chunks.
- **Region last-modified heatmap.** Color by `mtime` of `.mca`. Instantly answers "where has activity happened in the last week?".
- **Sign-text & command-block search.** Indexed search across block entities. Big moderation win: "find signs containing slur X", "find command blocks referencing player Y".
- **Spawner inventory.** A sortable list of every monster-spawner with mob type & coords — essential for dungeon mapping and farm audits.
- **`level.dat` viewer.** A read-only tree: gamerules, difficulty, world borders, datapacks, hardcore flag, game version history. The data is already read; surface it. `WorldSettingsPanel` exists but doesn't cover most of this.
- **Datapack / non-vanilla detection.** If world-gen is non-vanilla, badge it more prominently than the current `custom ⚠` — bad structure data has bitten ops before.

---

## Cross-cutting UX

- **Layer flyout is getting long.** Add a search/filter input at the top, and collapse sections (Biomes / Terrain / Special / Grids).
- **Cursor info bar grows horizontally** with each enabled overlay. At some point that should wrap or use compact pills; otherwise it pushes off the right edge.
- **MapToolbar duplicates Layer toggles** (Biomes, Terrain, Slime, Ores, Grid). Decide: either the toolbar is a "quick row" of most-used toggles, or it's the canonical place. Right now both exist and can disagree visually (a layer with an opacity slider in the flyout but only on/off in the toolbar).
- **Empty-state already has** drag-drop and recents. Consider auto-detecting `~/.minecraft/saves/` and `~/Library/Application Support/minecraft/saves/` and showing the world list with last-played sort, since many users have no idea where their saves live.
- **Coordinate paste.** The Go-to panel takes X and Z separately; let users paste `123, -456` or `/tp @s 123 64 -456` into a single field and parse it.
- **Follow-player hold-to-toggle** is non-obvious. A small chevron/dropdown on the button with explicit *Follow* / *Pan once* would beat the 500 ms hold heuristic.
- **Color-blind palette toggle**, especially for biome colors and the slime/ore overlays.
- **Tile loading HUD (28 lines)** is minimal; a small expandable panel showing queue depth + recent timings would help when explaining performance issues.


