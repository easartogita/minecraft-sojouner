# Waypoints / Ruler / Route Planner

Everything about map waypoints, pins, and the Ruler → Route Planner arc lives here instead of being split across `WISHLIST.md`, `TODO.md`, and `FRONTEND_SUGGESTIONS.md`.

## Shipped — quick status

Detailed reasoning/history for all of these is in the sections below; this is just the scannable checklist.

- [x] Persistence — waypoints/leg modes/active route survive toggle-off and app reload
- [x] Named + multiple saved routes with rename/load/delete (Saved rail tab, per-world storage)
- [x] Google-Maps-style active-route model — other saved routes render as thin clickable alternates, click promotes to active
- [x] Per-leg travel modes — On Foot / By Boat / Mounted / Elytra / Spectator / Nether Highway, tagged per leg
- [x] Auto-only punitive modes — Swim, Frozen Ocean (`ice`), Snowy Terrain (`snow`) — not hand-pickable, biome-detected
- [x] Biome-based auto-splitting, four-way (ocean / frozen ocean / snowy land / land), both `boat` and `walk` legs
- [x] Dash-by-speed line rendering, formula-driven, generalizes to future modes automatically
- [x] Candy-cane two-tone dash (neutral gap-fill) + dark casing — legible against any biome background
- [x] Hazard-alert gap-fill (blaze orange) on `ice`/`snow` segments specifically
- [x] Batched biome sampling (`cubiomes_get_biomes_along_line`) — one lock acquisition per leg, not per sample point
- [x] View vs. edit mode split — selecting/promoting a route no longer arms the map to extend it; explicit Edit button + right-click "Add point to route"
- [x] Entry points: toolbar toggle, "+ New" in Saved panel, right-click "Start route here"
- [x] Cross-world route leak fixed — switching worlds clears the in-progress route's stale coordinates
- [x] Rail split: Places (structures/world data) vs. Saved (pins/routes)
- [x] Pin UX — right-click "Add pin" + "Copy coordinates" (this predates the session's own work here, but was still an open wishlist bullet below — already done, not tracked as outstanding)

**Not done — still real gaps:** waypoint snapping to structures/pins, mid-route insert/drag-to-reorder editing, Road Maker, Road Finder, the companion features list, and everything else marked not-yet-built in the sections below.

## Route Planner (Ruler enhancements)

Partially shipped as the Ruler tool (`RulerLayer.tsx`, `RulerPanel.tsx`, `overlaySlice.ts`): click-to-place waypoints, live ghost-line preview, per-leg + total distance, nether-equivalent (÷8), walk-time estimate, undo/clear, toolbar toggle + `R` hotkey. This entry tracks the gap between that and a real route planner.

**Still missing:**
- No snapping — waypoints are raw clicks, not structure/pin markers
- Only append-at-the-end editing (via Edit mode, below) — still no insert-in-middle or drag-to-reorder

**Shipped since this was first written:** persistence (waypoints/leg modes/active route survive toggle-off and app reload — `overlaySlice.ts`), named + multiple saved routes with rename/load/delete (Saved rail tab → `SavedFlyout.tsx`, `worldSlice.ts`'s `SavedRoute`), and the Google-Maps-style active-route model (other saved routes render as thin clickable alternates via `SavedRoutesLayer.tsx`, clicking one promotes it to active).

**Bug found via real usage, fixed: viewing vs. editing were the same flag.** Clicking a thin inactive-route line to promote it (or the panel's Load button) reused `RULER_LOAD_ROUTE`, which set `rulerActive: true` — the *same* flag the map's "click adds a waypoint" handler and crosshair cursor were gated on. So selecting a route to look at it also silently armed the map to extend it on the next click, and showed a ghost preview line following the cursor even though nothing you clicked would do anything with it. Fixed by splitting `rulerActive` (is the panel showing a route) from a new `rulerPlacementMode` (do map clicks add a point) in `overlaySlice.ts`:
- `RULER_LOAD_ROUTE` now sets `rulerActive: true, rulerPlacementMode: false` — view-only by default.
- `RULER_TOGGLE`/`RULER_NEW` set both flags together — the toolbar toggle and "+ New" have always meant "I'm about to click points," that's unchanged.
- New `RULER_START_EDITING` action turns placement mode on without touching waypoints — wired to an "Edit" button in `RulerPanel.tsx` (replaces Save/Undo/Clear while viewing) and a new right-click "Add point to route" context-menu entry (`MapContextMenu.tsx`), per-leg mode dropdowns are `disabled` while viewing, and the crosshair cursor + ghost preview line (`RulerLayer.tsx`, `MapView.tsx`) both gate on `rulerPlacementMode` now instead of `rulerActive`.
- Found a second path to the same bug while fixing the first: `SavedRoutesLayer.tsx`'s click handler on the thin route line never called `L.DomEvent.stopPropagation`, so the click also bubbled to the map's own click handler underneath — if placement mode happened to already be on from before, promoting a route could immediately add a stray point to the route you just loaded. Fixed alongside the flag split.

**Bug found via real usage, fixed:** switching worlds carried the active/in-progress route over into the new world — its waypoints are coordinates in the *old* world, meaningless in the new one. Pins and Saved Routes are already world-scoped storage and correctly reload on their own on a world switch (`worldSlice.ts`'s `pinWorldKey`-keyed loads); the active ruler route isn't stored that way, so nothing cleared it automatically. Fixed by adding `SET_SEED`/`SET_MANUAL_SEED` cases to `overlayReducer` (`overlaySlice.ts`) that clear `rulerWaypoints`/`rulerLegModes`/`activeRouteId` on a world switch — same cross-cutting-action pattern `useSeed.ts` already uses for auto-enabling cave mode on `SET_DIMENSION`. Deliberately leaves `rulerActive` alone: if the panel was open, it stays open, just empty and ready for a new route in the new world, rather than force-closing it.

**Per-leg travel modes:** each leg gets its own mode — `walk | boat | mounted | elytra | spectator | nether_highway` (plus `swim`, `ice`, and `snow`, all auto-only — see below) — tagged on the waypoint that starts the leg. `RulerLayer` draws one polyline per leg (or per biome-split sub-segment) instead of one polyline for the whole route, colored and dashed by mode.

**Dropdown labels for `walk`/`boat` were relabeled to "On Foot" / "By Boat"** (`travelModes.ts` — only the display `label`, the `id`/type values stay `walk`/`boat`, they're load-bearing string literals throughout the codebase). Plain "Walk"/"Boat" undersold that these are adaptive, composite modes now — "Boat" auto-falls-back to walk/ice/snow wherever the straight leg crosses dry land or ice, "Walk" auto-falls-back to swim/ice/snow wherever it crosses water or snow. The old names read as fixed single-speed choices; they aren't, and haven't been since biome-splitting shipped.

Speed constants (rough, should be user-editable, not presented as exact):

| Mode | Speed (blocks/s) | Basis |
|---|---|---|
| On Foot (`walk`) | 4.317 | vanilla base speed |
| By Boat (`boat`) | ~8 | calm-water paddling (ice-boat highways are a different, much faster case — out of scope here) |
| Mounted | ~9 | rough average bred horse (real range 4.74–14.23) |
| Elytra | ~35 | sustained rocket-boosted cruise (bursty in reality) |
| Spectator | 21.6 | creative/spectator sprint-fly (2× base fly speed) |
| Swim *(auto-only, not in the dropdown)* | 2.2 | punitive blend of real swim speed + surfacing-for-air interruptions; auto-detected on `walk` legs crossing open ocean — see biome-splitting below |
| Frozen Ocean / `ice` *(auto-only)* | 3.0 | icebergs/pack ice — bad for both boating (blocks the boat) and walking (treacherous terrain); faster than swim (solid footing) but slower than plain walk |
| Snowy Terrain / `snow` *(auto-only)* | 3.5 | deep/powder snow on land — same "looks normal, isn't normal speed" problem as frozen ocean, dry instead of wet; slower than walk, faster than ice (solid ground, just slow going) |

**Biome-based auto-splitting — shipped, four-way.** `lib/biomeSplit.ts`'s `splitLegByBiome(slot, a, b, modes, minSpecialBlocks)` samples biome along a leg at fixed 24-block intervals, classifies each point as open ocean / frozen ocean / snowy land / land (open-ocean IDs 0, 24, 44-49; frozen 10, 50; snowy-land IDs 12, 13, 26, 30, 31, 158, 140, 178, 179, 180, 181 — `stony_peaks` 182 deliberately excluded, it's the vanilla-bare non-snowy peak variant; rivers 7/11 intentionally excluded — boating/swimming a narrow, current-bearing river is a different reliability case, revisit if it matters), and splits the leg into contiguous sub-segments, each mapped through a caller-supplied `{ ocean, frozen, snow, land }` mode quadruple. `hooks/useBiomeSplitSegments.ts` shares the computation between `RulerLayer` (map rendering) and `RulerPanel` (time totals + a per-leg breakdown line), and picks the quadruple from the leg's own mode:
- `boat` legs → `{ ocean: 'boat', frozen: 'ice', snow: 'snow', land: 'walk' }` — no boat on dry land (snowy or not), and ice blocks a boat the same as land does.
- `walk` legs → `{ ocean: 'swim', frozen: 'ice', snow: 'snow', land: 'walk' }` — crossing open water on foot without a boat is swim-speed, not walk-speed.

**Bug caught by typecheck when `snow` was added:** `BiomeSplitModes` gained a required `snow` field but the two call sites in `useBiomeSplitSegments.ts` still only passed `{ ocean, frozen, land }` — would've been a runtime `undefined` mode (and a broken lookup in `TRAVEL_MODES[undefined]`) if TypeScript hadn't caught the missing field at compile time. Worth remembering: any time `BiomeSplitModes` grows a new classification, grep for every place that constructs one — `tsc` will catch a missing field, but only if you actually run it before calling something "done."

Frozen ocean and snowy land both map to a fixed mode (`ice`, `snow`) regardless of which of the two leg types (`boat` or `walk`) the leg started as — once you hit icebergs or deep snow you're on foot picking through it either way. `swim`, `ice`, and `snow` (`travelModes.ts`) are all deliberately punitive, auto-only modes — not in `TRAVEL_MODE_ORDER`, so none can be hand-picked from the dropdown, only auto-detected. This is deliberately just an honest speed/time signal, not terrain avoidance — it doesn't reroute the leg around the iceberg field or the snowdrift, it just stops pretending that stretch will be fast.

Special-terrain runs (ocean, frozen, or snow) shorter than a configurable threshold (Settings → Route Planner → "Min. worthwhile terrain crossing", default 32 blocks) fold into walk — not worth switching mode, or flagging the alert, for a short stretch.

**Noted, not acted on:** a leg near a snowy-taiga/taiga biome boundary produced 4 alternating sub-segments for a 529-block leg (168/48/96/217) — correct math, but a lot of back-and-forth for the panel's breakdown line to spell out individually on legs with jagged biome edges. Two loose ideas if this becomes annoying in practice: roll many-alternation breakdowns up into a percentage summary instead of listing every flip, and/or relabel the breakdown's "on foot" entries as "on foot" only when adjacent to a special segment (e.g. "Snowy Terrain (on-foot)" framing) so the plain stretches read as *part of* the snowy leg rather than a fully separate thing. Not implemented — parked here.

**Scope boundary, confirmed deliberate:** boat/ice/snow/walk and walk/ice/snow/swim are the only splits that happen today. Mounted/Elytra/Spectator/Nether Highway don't get it and won't until Road Finder — Elytra and Spectator fly over water, ice, snow, and land at the same speed (nothing to split), Nether Highway models an already-finished tunnel (terrain-agnostic by definition), and Mounted could in principle have a water/ice/snow problem too but that's not modeled. Road Finder is the thing that eventually adds a different *kind* of segmentation (surface flatness, not just wet/dry/frozen/snowy); Road Maker replaces the straight-line leg with a computed path entirely — neither is "more of this same mechanism," so don't try to shoehorn them into `biomeSplit.ts`.

**Related future idea, not yet scoped: ice roads.** Packed-ice boat highways are a third "built infrastructure changes your travel speed" concept alongside Road Maker (mined tunnel) and Road Finder (natural flat surface corridor) — already called out as out-of-scope in the Boat row of the speed table above (ice-boat speeds are 40-70+ blocks/s, a different case from calm-water paddling). Worth grouping these three mentally when any of them gets built, since they likely share some path-search machinery.

Batched sampling shipped too, per the implementation note that used to be here: `cubiomes_get_biomes_along_line` (`cubiomes/biomes.rs`) takes a slot + point list and does one `CUBIOMES_LOCK` acquisition for the whole batch instead of one per point, exposed to the frontend as `getBiomesAlongLine` (`tauriAPI.ts`).

**Dash-by-speed line rendering — shipped, supersedes the color-only approach.** Walk-blue (`#58a6ff`) and boat-teal (`#39c5cf`) turned out close enough in hue that the boat/walk split was hard to read at a glance on a busy biome background — confirmed the split itself was rendering correctly (verified via pixel sampling) before realizing it was a legibility problem, not a bug. Rather than patch just that one pair, `dashPatternForMode` (`travelModes.ts`) gives every mode a dash rhythm keyed to its effective speed — longer dashes for slower modes, compressing toward solid for the fastest — applied uniformly to every leg/sub-segment in `RulerLayer.tsx` (and the ghost preview line). Nether Highway's dash uses its *effective* speed (nominal speed × 8, matching the time-calc's distance-÷-8 treatment), not its nominal blocks/s, so it reads as fast rather than walk-slow. Deliberately formula-driven rather than a hand-picked dash per mode: as Road Maker, Road Finder, ice-boat highways, etc. get added later with their own speeds, they slot into the right point on the dash spectrum automatically. `TRAVEL_MODES` colors are still worth a distinctness pass sometime, but are no longer the only thing carrying which-mode-is-this information.

One real bug shook out of testing this with a wider speed spread (adding Elytra/Spectator/Nether Highway legs alongside Walk/Boat/Mounted): the fastest modes' gaps visually disappeared — dashes read as solid. Two compounding causes, both fixed — floors in `dashPatternForMode` were sized without accounting for the 4px line weight they render at (a gap smaller than the line's own width vanishes), and Leaflet's default round line-cap bleeds each dash past its nominal end, eating further into a small gap. Fix was `lineCap: 'butt'` on every route polyline (`RulerLayer.tsx`) plus raising the dash/gap floor from 3 to 4. Worth remembering if the weight (currently 4) ever changes — the floor should scale with it.

**Palette revised — current colors, not the ones named above (this doc has been edited in place enough times that the color values quoted earlier are stale; check `travelModes.ts` directly, not this doc, for the source of truth).** Grouped by terrain family rather than just "make every mode different": land modes (Walk `#7a4520` dark brown, Mounted `#d29922` gold) sit in warm earth tones; water modes span a blue family from Boat's clean saturated blue (`#1f6feb`, the "good" way to cross water) down through Swim's murky slate blue (`#3a6b7d`, struggling) up to Ice's near-white neon blue (`#c8faff`, deliberately jarring).

**Bug caught via real usage: `snow` copied Ice's "pale = jarring" logic without checking what it needed to contrast against.** Ice's near-white color works *because* its background (dark ocean) is dark — pale pops against dark. `snow` was first given a similarly pale blue-gray (`#cfe0e8`), but snow's own background (snowy terrain) is *also* pale — so the dash washed out into near-invisibility against the very terrain it's meant to flag, reading as "just another white dash" indistinguishable from the default gap-fill or the snow biome tiles themselves. The fix isn't "cold modes get pale colors," it's "the dash color needs to contrast with *that specific mode's own terrain*" — Ice stays pale (dark background), `snow` became a deep saturated navy `#1e3a5f` (light background, needs a dark color instead). Elytra/Spectator/Nether Highway stay outside both terrain families.

**Line rendering is now three layers per segment, not one — all in `RulerLayer.tsx`:**
1. **Casing** — solid black, weight 6, opacity 0.45, underneath everything. A mode color tuned for one biome (dark ocean, bright badlands, snow) can wash out against another; the casing guarantees legibility regardless of what's under the line, without having to hunt for one hue that works everywhere.
2. **Gap-fill** — the complementary dash pattern (`gapDashPatternForMode`, `travelModes.ts`) drawn in a neutral color (`gapFillColorForMode`, default `#e8e8e8`) so the gaps between dashes are a solid fill instead of showing whatever's underneath — makes the dash rhythm itself (how long each dash actually is) read clearly at a glance. Uses the classic SVG two-tone-dash trick: same dash/gap lengths as the main pattern but swapped and phase-offset by the gap length, so it exactly tiles the main pattern's gaps.
3. **Mode-colored dash** — the actual `dashPatternForMode` line on top, per-mode color and rhythm.

`ice` and `snow` both get this gap-fill color instead of the shared default — went through a few iterations on `ice` first (a heavier/colder slate blue meant to feel "slow and leaden," then hazard/caution amber `#ffc107` — not loud enough against a busy map — landed on blaze/hunter-safety orange `#ff6700`) before settling on the actual goal: a visual *alert* flagging "this segment's travel time isn't what you'd expect," layered on top of the long-dash speed signal rather than trying to reinforce it via a "cold" hue. `snow` inherited the same final color once it shipped (see below) — same alert, on land instead of at sea.

Dash-length ceiling raised from 24 to 48 when `swim` was added, specifically so its very long dash reads as visibly slower than walk's (both would've hit the same 24 ceiling and looked identical otherwise) — walk sits at ~23, swim at ~45. Worth checking this ceiling again if a future mode ends up slower than swim.

**Nether highway mode:** models a finished tunnel, not active mining — time = (leg distance ÷ 8) ÷ walk speed, i.e. the existing nether-equivalent math applied to time instead of just distance.

## "Road Maker" mode (new travel type — big, its own sub-project)

A seventh mode, internal key `active_mining`, labeled **"Road Maker"** in the UI, categorically different from the rest: every other mode above (walk/boat/mounted/elytra/spectator/nether_highway) just annotates the user-drawn straight leg with a speed (and, for boat, a biome-based sub-split). Road Maker instead **replaces** the straight leg with a computed 3D tunnel path — a real player can't mine a diagonal line efficiently, only orthogonal (axis-aligned X/Z) runs joined by turns.

**Hard precondition:** only offer this mode where real chunk data already exists on disk for every region the leg crosses. It has to read actual per-block data — the same real data Cave Mode already reads via `region_reader.rs`'s section/palette decode — not cubiomes' procedural cave-carver prediction (`cubiomes_get_carved_columns`, `carvers.rs:10`), which is seed-based, approximate, and works even for ungenerated chunks but isn't trustworthy enough to route a tunnel through. Before offering `active_mining` for a leg, check that all `.mca` regions spanning its bounding box exist; if any are missing, disable the option with an explanation rather than silently falling back to prediction.

**Disclaimer, always shown while this mode is active:** the computed path is only as fresh as the last time those chunks were saved to disk. A player (or anyone else on a shared world) may have mined, built, or otherwise changed the terrain since. This is a plan, not a guarantee.

**Mining speed isn't a fixed constant like the other modes' speed table** — it depends on tool tier, Efficiency level, Haste/Mining Fatigue, hunger exhaustion, and block hardness (netherrack vs. deepslate vs. stone all differ). Rather than guess one number, give the user a way to supply their own, in two tiers:

- **v1 — manual stopwatch calibration:** user clicks "Start," app plays a beep and starts a timer; user goes and mines in-game; user clicks "Stop" (or the app beeps again after a fixed interval); app then asks "how many blocks did you cover?" and computes blocks/second from elapsed time ÷ reported distance. No new dependencies — same static, standalone model as the rest of Route Planner.
- **Goal — auto-measured via the player bridge:** once the separate AI-player-bridge project (`bridge/`, the NeoForge WebSocket telemetry mod) can report live position, the same start/beep/stop flow reads position before and after automatically instead of asking the user to self-report distance. More accurate (no manual counting error), but ties this feature's calibration step to that other in-progress subsystem rather than working fully standalone.

Either way, the result is a single **calibrated blocks/second** value (plus maybe a manual override slider/preset for users who don't want to run the test) that Road Maker uses instead of a hardcoded guess — closer in spirit to the other modes' "should be user-editable, not presented as exact" note, just measured instead of guessed.

**Algorithm sketch:**
1. Sweep a broad range of candidate Y levels for the leg (not just Cave Mode's current default ±40 window around the player) — the workable mining band, not a fixed slice around wherever the player happens to be standing.
2. At each candidate Y, read cave/void status per column by reusing Cave Mode's real-data floor scan (`region_reader.rs`, `extract_surface`, lines 330-354), narrowed to a tight window around that specific Y instead of its current wide default. "Floor found nearby" reads as a hazard signal (a cave/air pocket near that elevation — where a pitfall could open up); "no floor found" (void) reads as the safety signal (most often solid rock). *Known limitation, not blocking:* void doesn't currently distinguish solid rock from an open cavern with no walkable floor — both read the same today. Worth tightening (e.g. checking for *any* air in the window, not just "floor present") before this is trustworthy enough to route through, but doesn't need solving before the rest of the design proceeds.
3. Search, across the whole leg, for the Y (or short sequence of Y-bands, since a route may need to ascend/descend) that maximizes contiguous orthogonal straight-run length and minimizes turn count while staying in void columns as much as possible.
4. Render the result as its own polyline shape — a staircase of orthogonal segments — not the direct waypoint-to-waypoint line. This is the one travel type where the drawn line and the straight-line leg genuinely diverge.

**New backend work required:** no existing function does a bulk multi-column cave/void query — today's real-data floor scan is single-column, single-window. A sweep over many Y levels × many columns per leg needs a batched query that parses each spanned region file once and answers many column/Y lookups from that single parse, rather than re-opening/re-parsing the same `.mca` per point queried. This is also the one travel mode that's mostly backend pathfinding work rather than frontend rendering/state work like the others.

**Phase 2 — not in this entry's scope:** auto-routing to minimize total travel time, and a "minimize jumps" variant favoring mount/boat bonus. Both consume the per-leg mode + biome-sampling groundwork above as their input once it exists — revisit once per-leg modes ship.

**Break-even judgment call, belongs to the tool, not the user.** Setup cost (waypoints + mode tagging) is roughly fixed; payoff scales with trip length — worth it for a multi-thousand-block trek, not for a 3-minute hop. Rather than making the user reason about where that line is, the tool should just tell them: e.g. compare the drawn route's total time against straight-line-distance-at-walk-speed and flag when the planning is unlikely to be worth its own setup cost. Not scoped further than that — parked here, not designed.

**"Road Finder" — a distant Phase 2 feature, surface counterpart to Road Maker.** Where Road Maker computes a mined *underground* tunnel, Road Finder would scan already-available heightmap data (`WORLD_SURFACE`/`MOTION_BLOCKING`, the same real per-column heightmaps `region_reader.rs` already uses for cave-entrance detection, lines 581-671) for long stretches of low Y-variance between neighboring columns — naturally flat *surface* terrain that supports fast sprinting without jumping or climbing. Same idea as Road Maker's straight-run search, just above ground instead of below it.

Open question worth checking before scoping this further: Road Maker's hard "real chunk data only" precondition exists because it needs actual cave voids, which only cubiomes-procedural prediction can't safely substitute for. Surface height might not have that constraint — `cubiomes/terrain.rs` may already predict terrain height procedurally from the seed alone, which would let Road Finder work on *unvisited* chunks too, unlike Road Maker. Not confirmed; check `terrain.rs`'s actual capability before assuming it.

Would also need to exclude water (ocean/river) from "flat," reusing the same ocean-biome-ID filter from Boat mode's biome splitting above — flat-and-submerged isn't a walkable road.

Snowy terrain's *speed-penalty signal* shipped early, ahead of Road Finder itself — see the `snow` mode in the biome-splitting section above (own auto-only mode/speed, `#ff6700` gap-fill alert, same treatment as frozen ocean's `ice`). What's still actually Road Finder's job and not yet built: *avoiding* it — routing around a snowdrift or a Y-variance heightmap hole the way Road Finder's surface-flatness search eventually would, rather than just walking straight through it and reporting an honest (slow) time. The distinction matters: `biomeSplit.ts` will keep telling you the truth about a leg that crosses snow; it will never choose a different path to dodge it.

Output feeds the same Phase-2 auto-router as "minimize travel time": once it exists, the router would choose per leg among Road Maker's tunnel, a Road Finder surface corridor, Boat's ocean/river splitting, or one of the flat speed modes — whichever is fastest or least effort, rather than the user hand-picking a mode.

Practical use: planning a nether highway layout before digging — map out the overworld destinations, read off the nether coordinates for each portal.

## Companion features (worth adding alongside the above)

- **Mode-comparison table.** Before locking a mode per leg, show total route time under every mode side by side (Walk / Boat / Mounted / Elytra / Spectator / Nether Highway / Road Maker), all computed from the same total distance. Cheap — it's the same per-mode math already in the speed table, just run N times instead of once — but it's what actually lets someone decide "is it worth building the highway, or should I just fly it" before committing to any digging or portal-building. Put this in regardless of what else makes the cut.

- **Portal-pair placement for Nether Highway legs.** When a leg is tagged `nether_highway`, auto-suggest where to place both portals — the ÷8 projection at each end — rather than only reporting a time. This is the other half of a nether-highway leg: today's spec gets you the time saved, not where to actually build the portals. Overlaps with the standalone "Nether portal helper" idea in `FRONTEND_SUGGESTIONS.md`, but scoped here to a specific route leg instead of an arbitrary pin.

- **Materials estimate for Road Maker.** Since that mode already computes a real 3D tunnel path (orthogonal runs + turns), the same path data can report blocks-to-mine and a rough torch count (every N blocks, to prevent mob spawns in the new tunnel) for close to free. A mode called "Road Maker" reporting time only, with no sense of what it costs to build, feels incomplete.

- **Round-trip toggle.** Most practical routes are there-and-back — a gathering trip, a supply run. Let the panel double the total for a simple round trip, or better, let the return leg use a *different* mode per leg (walk there, boat back) rather than assuming symmetric travel.

- **Hazard overlay on walk legs, reusing the dark-spot overlay.** `TODO.md`'s already-wishlisted "Dark spot overlay" (surface blocks with sky light < 8, the mob-spawn threshold) can be sampled specifically along `walk`-mode legs to flag "this leg passes through unlit ground, expect mobs" — reusing existing darkness-detection logic instead of building a new hazard model from scratch.

## Pin UX

- [x] **Right-click context menu on the map** — "Add pin", "Copy coordinates" (`MapContextMenu.tsx`). Predates this session's own work in that file (which added "Start route here" / "Add point to route" alongside it) — was still listed below as outstanding; it isn't.
- **Pin categories / colors** — assign a color to a pin, rendered as a colored marker, filterable in the sidebar.
- **Pin notes** — multi-line text field per pin, shown in tooltip on the marker.
- **Import/export** — export as JSON or `/tp` command list.
- **Named pin groups** — still not built, and Saved Routes ended up *not* being this: routes shipped as their own standalone concept (`SavedRoute` — waypoints + leg modes, `worldSlice.ts`), not literally a named ordered group of pins. This bullet is still open on its own terms if arbitrary (non-route) pins ever need grouping.
