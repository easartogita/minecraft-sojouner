# Bugs

### Biome-layer tile seams, Windows only

At zoom 3+ in biome-only mode, each region renders as 4 tiles with a visible seam
between them — not reproduced on Linux. Points at the nearest-neighbor upscale path
(`useTileLayer.ts`'s `nearestNeighborScale`), but a manual trace of the pixel-index
math didn't find an obvious bug; a CSS sub-pixel `_initTile` fix (grow/pull tiles by
~1px) was tried and reverted with no effect. Needs real visual debugging (WebView2
devtools or zoomed side-by-side screenshots), not more code reading. Found
2026-08-12 during Windows-build-VM bring-up, still open.

### Abandoned Camp (and Ancient City / Trial Chambers / Trail Ruins) markers occasionally land mid-ocean

**Upstream bug, still present as of `xpple/cubiomes` `26.3` @ `14f5009` ("Fix ruined
portals") — confirmed by reading current source 2026-08-24, not fixed by anything that's
landed since root-cause. Worth flagging to xpple; may not be on his radar since it's
adjacent to, but distinct from, the region-size fix he already shipped (see below).**

**What's wrong:** `isViableStructurePos`'s jigsaw case (`finders.c:2215-2234`, covers
`Ancient_City`/`Trial_Chambers`/`Abandoned_Camp`) accepts or rejects a candidate position
using a **single biome sample** taken near the structure's approximate center
(`getVariant` → one `getBiomeAt` call). It never checks the biome — let alone real
terrain/solid-ground — across the rest of the structure's actual footprint. Near a jagged
coastline, that one sample point can land on a sliver of valid land biome while most of
the jigsaw pieces around it actually sit over ocean.

`isViableStructureTerrain()` (`finders.c:2262-2330`) is the function that's *supposed* to
catch exactly this class of problem — real per-corner surface-height sampling — but it
only has cases for `Desert_Pyramid`, `Jungle_Temple`, and `Mansion` (`finders.c:2267-2288`);
every other structure type, including all three jigsaw ones above, falls through to an
unconditional `return 1` at line 2287. So the jigsaw path has no terrain check to fall back
on at all — not even an approximate one.

**xpple has already solved this exact category of bug once, for a different structure:**
`isViableStructurePos` alone over-reports End Cities the same way — biome-valid samples
that sit over void or an island too small for the structure. That's why a dedicated
`isViableEndCityTerrain` exists and gets called *in addition to* the biome check (our own
FFI wrapper, `cubiomes_bridge.c:cm_find_structures:169-171`, calls it explicitly). The
jigsaw structures need the analogous treatment: a real terrain/footprint check, not just
the biome sample, before accepting a position.

**Not the same as the region-size fix.** `085cc0c` ("Fix region size and chunk range for
abandoned camps", already pulled — we're at cubiomes' `26.3` tip) corrects
`s_abandoned_camp`'s spacing (34→37 region size, 26→29 chunk range) — a placement-frequency
fix, unrelated to this terrain-check gap. We'd independently found and applied the same
34→37 correction on our own side before that upstream commit existed (see
`bugs-resolved.md`, "Five more stale `region_size` values...").

Root-caused 2026-08-23, re-verified against latest upstream 2026-08-24
(`src-tauri/src/cubiomes/structures.rs`, `cubiomes_bridge.c:cm_find_structures`, and
`cubiomes/finders.c:2215-2330`). Not fixed: needs either a real terrain-adaptation check
added to the vendored fork for these jigsaw types (mirroring `isViableEndCityTerrain`), or
an app-side mitigation (sampling block/height data near reported hits to filter out
water-heavy positions). Left open per user decision to document only for now.
