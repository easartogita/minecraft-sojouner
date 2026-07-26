/**
 * cubiomes_bridge.c — native C bridge to cubiomes for the Tauri backend.
 *
 * This is the non-Emscripten equivalent of wasm-src/cubiomes_api.c.
 * Function signatures are identical; all EMSCRIPTEN_KEEPALIVE annotations
 * and the emscripten.h include are removed.  Do not modify cubiomes internals.
 */

#include <limits.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

#include "generator.h"
#include "finders.h"
#include "biomes.h"
#include "biomenoise.h"
#include "terrainnoise.h"
#include "carver.h"
#include "features/ore.h"
#include "features/end_city.h"
#include "loot/loot_tables.h"
#include "loot/loot_table_context.h"
#include "loot/loot_functions.h"
#include "loot/items.h"

/* Generator pool — up to 4 active generators (overworld/nether/end + spare) */
#define MAX_GENERATORS 4
static Generator g_generators[MAX_GENERATORS];
static int g_slot_count = 0;

static SurfaceNoise g_surface_noise[MAX_GENERATORS];
static int g_sn_initialized[MAX_GENERATORS];

/* End-dimension SurfaceNoise, kept separate from g_surface_noise above (which
 * is always initialised for DIM_OVERWORLD) — needed by cm_get_end_gateway_links. */
static SurfaceNoise g_surface_noise_end[MAX_GENERATORS];
static int g_sn_end_initialized[MAX_GENERATORS];

int cm_setup_generator(int seed_low, int seed_high, int mc_version, int dimension, int flags)
{
    int slot = g_slot_count % MAX_GENERATORS;
    g_slot_count++;
    g_sn_initialized[slot] = 0;
    g_sn_end_initialized[slot] = 0;

    uint64_t useed = ((uint64_t)(uint32_t)seed_high << 32) | (uint32_t)seed_low;
    long long seed = (long long)useed;

    setupGenerator(&g_generators[slot], mc_version, (uint32_t)flags);
    applySeed(&g_generators[slot], dimension, seed);

    return slot;
}

/* Returns 1 if a slot's generator is currently configured for exactly this seed
 * AND dimension (DIM_OVERWORLD=0, DIM_NETHER=-1, DIM_END=1), else 0 (including an
 * invalid slot).
 *
 * Slots are recycled round-robin by cm_setup_generator and the frontend holds a
 * slot index across many async renders, so a queued render can reach a slot that
 * has since been repointed to a different world (new seed on world switch) or a
 * different dimension. Callers that cache results per (seed, dimension) use this
 * to detect the mismatch and bail before generating — and caching — wrong data. */
int cm_slot_matches(int slot, int seed_low, int seed_high, int dimension)
{
    if (slot < 0 || slot >= MAX_GENERATORS) return 0;
    uint64_t useed = ((uint64_t)(uint32_t)seed_high << 32) | (uint32_t)seed_low;
    return g_generators[slot].seed == useed && g_generators[slot].dim == dimension;
}

int cm_get_biome_region(int slot, int x, int z, int width, int height, int scale, int *buffer)
{
    if (slot < 0 || slot >= MAX_GENERATORS) return -1;
    Range r;
    r.scale = scale; r.x = x; r.z = z;
    r.sx = width;    r.sz = height;
    r.y = 64;        r.sy = 1;

    /* genBiomes() for layer-based worlds (≤1.17) uses the cache as scratch
     * space beyond the output area; allocCache() returns the correct size.
     * Writing into a caller-sized buffer (width*height) corrupts the heap. */
    int *cache = allocCache(&g_generators[slot], r);
    if (!cache) return -1;

    int rc = genBiomes(&g_generators[slot], cache, r);
    if (rc == 0)
        memcpy(buffer, cache, (size_t)width * (size_t)height * sizeof(int));
    free(cache);
    return rc;
}

int* cm_find_structures(int slot, int struct_type, int rx0, int rz0, int rx1, int rz1)
{
    if (slot < 0 || slot >= MAX_GENERATORS) return NULL;

    int max_count = (rx1 - rx0 + 1) * (rz1 - rz0 + 1);
    if (max_count <= 0 || max_count > 65536) return NULL;

    int *buf = (int*)malloc((1 + max_count * 3) * sizeof(int));
    if (!buf) return NULL;

    int count = 0;
    Generator *g = &g_generators[slot];

    /* End cities need a dedicated terrain check — isViableStructurePos only
     * confirms the biome (End Highlands), not that the actual island there is
     * large enough to fit the structure. Skipping it over-reports End Cities:
     * plenty of biome-valid region candidates sit over void or too small an
     * island, and the real game silently drops the structure at those spots. */
    if (struct_type == End_City && !g_sn_end_initialized[slot]) {
        initSurfaceNoise(&g_surface_noise_end[slot], DIM_END, (uint64_t)g->seed);
        g_sn_end_initialized[slot] = 1;
    }

    for (int rx = rx0; rx <= rx1; rx++) {
        for (int rz = rz0; rz <= rz1; rz++) {
            Pos p;
            if (!getStructurePos(struct_type, g->mc, (uint64_t)g->seed, rx, rz, &p))
                continue;
            if (!isViableStructurePos(struct_type, g, p.x, p.z, 0))
                continue;
            /* 1.18+ terrain check — desert temples, jungle temples and
             * mansions must sit on solid ground; a biome-valid spot can still
             * hang over a cliff/ravine/ocean and not actually generate. */
            if (g->mc >= MC_1_18 && !isViableStructureTerrain(struct_type, g, p.x, p.z))
                continue;
            if (struct_type == End_City &&
                !isViableEndCityTerrain(g, &g_surface_noise_end[slot], p.x, p.z))
                continue;

            int flags = 0;
            StructureVariant sv;
            if (struct_type == Igloo) {
                if (getVariant(&sv, Igloo, g->mc, (uint64_t)g->seed, p.x, p.z, -1))
                    flags |= sv.basement ? 1 : 0;
            } else if (struct_type == Village) {
                int biome = getBiomeAt(g, 4, p.x >> 2, 16, p.z >> 2);
                if (getVariant(&sv, Village, g->mc, (uint64_t)g->seed, p.x, p.z, biome))
                    flags |= sv.abandoned ? 2 : 0;
            } else if (struct_type == Ruined_Portal || struct_type == Ruined_Portal_N) {
                int biome = getBiomeAt(g, 4, p.x >> 2, 16, p.z >> 2);
                if (getVariant(&sv, struct_type, g->mc, (uint64_t)g->seed, p.x, p.z, biome)) {
                    flags |= sv.giant       ? 4 : 0;
                    flags |= sv.underground ? 8 : 0;
                    flags |= sv.airpocket   ? 16 : 0;
                }
            } else if (struct_type == Geode) {
                if (getVariant(&sv, Geode, g->mc, (uint64_t)g->seed, p.x, p.z, -1))
                    // ~95% of geodes generate already cracked open; flag the rarer,
                    // more notable case (fully sealed — no visible entrance) instead.
                    flags |= sv.cracked ? 0 : 1;
            }

            buf[1 + count * 3]     = p.x;
            buf[1 + count * 3 + 1] = p.z;
            buf[1 + count * 3 + 2] = flags;
            count++;
        }
    }
    buf[0] = count;
    return buf;
}

int cm_get_strongholds(int slot, int max_count, int *out_buf)
{
    if (slot < 0 || slot >= MAX_GENERATORS) return 0;
    Generator *g = &g_generators[slot];

    StrongholdIter shi;
    initFirstStronghold(&shi, g->mc, (uint64_t)g->seed);

    int count = 0;
    while (count < max_count) {
        if (nextStronghold(&shi, g) <= 0) break;
        out_buf[count * 2]     = shi.pos.x;
        out_buf[count * 2 + 1] = shi.pos.z;
        count++;
    }
    return count;
}

void cm_get_spawn(int slot, int *out_x, int *out_z)
{
    if (slot < 0 || slot >= MAX_GENERATORS) { *out_x = 0; *out_z = 0; return; }
    Pos spawn = getSpawn(&g_generators[slot]);
    *out_x = spawn.x;
    *out_z = spawn.z;
}

int cm_get_height_region(int slot, int x, int z, int w, int h, float *out_y)
{
    if (slot < 0 || slot >= MAX_GENERATORS) return -1;
    Generator *g = &g_generators[slot];

    if (g->dim == DIM_NETHER) {
        for (int i = 0; i < w * h; i++) out_y[i] = 0.0f;
        return 0;
    }

    /* mapApproxHeight already dispatches End to mapEndSurfaceHeight — it just
     * needs a real End SurfaceNoise, not the Overworld one cached above. */
    if (g->dim == DIM_END) {
        if (!g_sn_end_initialized[slot]) {
            initSurfaceNoise(&g_surface_noise_end[slot], DIM_END, (uint64_t)g->seed);
            g_sn_end_initialized[slot] = 1;
        }
        return mapApproxHeight(out_y, NULL, g, &g_surface_noise_end[slot], x, z, w, h);
    }

    if (g->mc >= MC_1_18) {
        return mapApproxHeight(out_y, NULL, g, NULL, x, z, w, h);
    }

    if (!g_sn_initialized[slot]) {
        initSurfaceNoise(&g_surface_noise[slot], DIM_OVERWORLD, (uint64_t)g->seed);
        g_sn_initialized[slot] = 1;
    }
    return mapApproxHeight(out_y, NULL, g, &g_surface_noise[slot], x, z, w, h);
}

/* Per-chunk ore-vein "density" sample used by the Density overlay.
 * Returns [copper_y, copper_size, iron_y, iron_size]:
 *   size: 0=no vein, 1=small (strength>=0.4), 2=medium (>=0.5), 3=large (>=0.6).
 *   y is INT_MIN when size==0.
 * Built on cubiomes' own ore-vein field (initOreVeinNoise / getOreVeinStrengthAt)
 * so it matches the block-level generator getOreVeinBlockAt(), including the
 * vertical edge falloff the old hand-rolled veininess sampling omitted. Copper
 * occupies Y 0..50 (positive veininess), iron Y -60..-8 (negative);
 * getOreVeinStrengthAt() enforces those bands and reports which ore each column
 * position favours. */
void cm_get_ore_veins_at2(int32_t seed_lo, int32_t seed_hi,
                          int32_t cx, int32_t cz,
                          int *copper_y_out, int *copper_sz_out,
                          int *iron_y_out,   int *iron_sz_out)
{
    *copper_y_out = INT_MIN; *copper_sz_out = 0;
    *iron_y_out   = INT_MIN; *iron_sz_out   = 0;

    uint64_t seed = ((uint64_t)(uint32_t)seed_hi << 32) | (uint32_t)seed_lo;
    OreVeinParameters params;
    if (!initOreVeinNoise(&params, seed, MC_NEWEST))
        return; /* ore veins require MC >= 1.18 */

    int bx = cx * 16 + 8;
    int bz = cz * 16 + 8;

    double bestCopper = 0.0; int bestCopperY = INT_MIN;
    double bestIron   = 0.0; int bestIronY   = INT_MIN;
    for (int y = -60; y <= 50; y += 2) {
        double s;
        switch (getOreVeinStrengthAt(bx, y, bz, &params, &s)) {
        case CopperVein: if (s > bestCopper) { bestCopper = s; bestCopperY = y; } break;
        case IronVein:   if (s > bestIron)   { bestIron   = s; bestIronY   = y; } break;
        default: break;
        }
    }

    if (bestCopperY != INT_MIN) {
        *copper_y_out  = bestCopperY;
        *copper_sz_out = bestCopper >= 0.6 ? 3 : bestCopper >= 0.5 ? 2 : 1;
    }
    if (bestIronY != INT_MIN) {
        *iron_y_out  = bestIronY;
        *iron_sz_out = bestIron >= 0.6 ? 3 : bestIron >= 0.5 ? 2 : 1;
    }
}

/* Generate ore-feature block positions (normal ore blobs: diamond, gold, iron,
 * redstone, etc.) for the given Ores enum types over a chunk range, using the
 * accurate configured-feature generation (distinct from the veininess overlay).
 *
 * Returns a malloc'd int array: [count, then count * (oreType, x, y, z)].
 * Caller frees with cm_free_results(). Returns NULL on bad slot / allocation. */

/* Nether lava-sea surface. A non-solid nether block at/below this Y is lava, not
 * air — and lava does not trigger the ore air-exposure discard. cubiomes has no
 * constant for this; 31 is the classic nether lava level. Calibration point. */
#define NETHER_LAVA_SEA_Y 31

/* Whether the nether block at (x,y,z) reads as *air* for the ore air-exposure
 * check: non-solid (final density <= 0, matching generateNetherColumn's
 * `noise > 0` = solid) AND above the lava sea. Below the sea, non-solid = lava. */
static int nether_is_air(TerrainNoise *tn, int x, int y, int z)
{
    if (y <= NETHER_LAVA_SEA_Y) return 0;
    return sampleNetherFinalDensity(tn, x, y, z) <= 0.0;
}

/* Ancient debris (discardChanceOnAirExposure = 1.0) is discarded if any of the 6
 * face-neighbours is air. Captures the dominant exposure — the central gap and
 * caverns above Y31 — via the density field. Carver tunnels above the sea are a
 * minor residual not modelled here (would need per-block carver reconstruction). */
static int nether_air_exposed(TerrainNoise *tn, int x, int y, int z)
{
    return nether_is_air(tn, x + 1, y, z) || nether_is_air(tn, x - 1, y, z)
        || nether_is_air(tn, x, y + 1, z) || nether_is_air(tn, x, y - 1, z)
        || nether_is_air(tn, x, y, z + 1) || nether_is_air(tn, x, y, z - 1);
}

int* cm_generate_ore_features(int slot, const int *ore_types, int num_types,
                              int cx0, int cz0, int cx1, int cz1)
{
    if (slot < 0 || slot >= MAX_GENERATORS) return NULL;
    Generator *g = &g_generators[slot];

    /* generateOres() needs surface noise for the air-exposure discard check. */
    if (!g_sn_initialized[slot]) {
        initSurfaceNoise(&g_surface_noise[slot], DIM_OVERWORLD, (uint64_t)g->seed);
        g_sn_initialized[slot] = 1;
    }
    const SurfaceNoise *sn = &g_surface_noise[slot];

    /* Lazily set up nether terrain noise, used to discard air-exposed ancient
     * debris. cubiomes leaves generateOres' air check as a TODO, so we apply it
     * here for nether ores whose config discards on air exposure (debris). */
    TerrainNoise *tn_nether = NULL;

    int cap = 4096;
    int *out = (int*)malloc(sizeof(int) * (1 + (size_t)cap * 4));
    if (!out) return NULL;
    int count = 0;

    for (int ti = 0; ti < num_types; ti++) {
        int oreType = ore_types[ti];
        OreConfig oconf;
        /* biomeID is unused for >=1.18; pass -1 (viability is checked per-position). */
        if (!getOreConfig(oreType, g->mc, -1, &oconf)) continue;

        int air_filter = (oconf.dim == DIM_NETHER && oconf.discardChanceOnAirExposure >= 1.0F);
        if (air_filter && !tn_nether) {
            tn_nether = (TerrainNoise*)calloc(1, sizeof(TerrainNoise));
            if (tn_nether && setupTerrainNoise(tn_nether, g->mc, 0)) {
                initTerrainNoise(tn_nether, (uint64_t)g->seed, DIM_NETHER);
            } else {
                free(tn_nether); tn_nether = NULL; air_filter = 0;  // <1.18: no filter
            }
        }

        for (int cx = cx0; cx <= cx1; cx++) {
            for (int cz = cz0; cz <= cz1; cz++) {
                Pos3List list = generateOres(g, sn, oconf, cx, cz);
                for (int i = 0; i < list.size; i++) {
                    Pos3 p = list.pos3s[i];
                    if (air_filter && tn_nether && nether_air_exposed(tn_nether, p.x, p.y, p.z))
                        continue;  // discarded: air-exposed debris doesn't generate
                    if (count >= cap) {
                        cap *= 2;
                        int *grown = (int*)realloc(out, sizeof(int) * (1 + (size_t)cap * 4));
                        if (!grown) { free(out); freePos3List(&list); free(tn_nether); return NULL; }
                        out = grown;
                    }
                    out[1 + count * 4 + 0] = oreType;
                    out[1 + count * 4 + 1] = p.x;
                    out[1 + count * 4 + 2] = p.y;
                    out[1 + count * 4 + 3] = p.z;
                    count++;
                }
                freePos3List(&list);
            }
        }
    }
    free(tn_nether);
    out[0] = count;
    return out;
}

/* Carver (cave/ravine/canyon) coverage for a chunk range, aggregated top-down.
 *
 * Caves/canyons carve thousands of 3-D blocks, so we reduce each chunk to a
 * 16x16 grid of per-column carved-block counts (0 = solid). Output is a malloc'd
 * int array: [nx, nz, then nx*nz * 256 ints] in chunk-row-major, column index
 * (localZ*16 + localX). Caller frees with cm_free_results().
 * Dimension-aware: uses the slot generator's dim, so overworld carvers render in
 * the overworld and the nether cave carver in the nether (its 26.3-fixed 0.2
 * probability). The End has no carver configs, so it yields an empty grid. */
int* cm_get_carved_columns(int slot, int cx0, int cz0, int cx1, int cz1)
{
    if (slot < 0 || slot >= MAX_GENERATORS) return NULL;
    Generator *g = &g_generators[slot];
    uint64_t seed = (uint64_t)g->seed;
    int mc = g->mc;

    int nx = cx1 - cx0 + 1, nz = cz1 - cz0 + 1;
    if (nx <= 0 || nz <= 0) return NULL;
    const size_t per = 256; // 16x16 columns per chunk

    int *out = (int*)calloc(2 + (size_t)nx * nz * per, sizeof(int));
    if (!out) return NULL;
    out[0] = nx; out[1] = nz;

    static const int cave_types[]   = { CAVE_CARVER, CAVE_EXTRA_UNDERGROUND_CARVER,
                                        OCEAN_CAVE_CARVER, UNDERWATER_CAVE_CARVER,
                                        NETHER_CAVE_CARVER };
    static const int canyon_types[] = { CANYON_CARVER, UNDERWATER_CANYON_CARVER };

    Pos3List poses;
    createPos3List(&poses, 1024);

    for (int cj = 0; cj < nz; cj++) {
        for (int ci = 0; ci < nx; ci++) {
            int cx = cx0 + ci, cz = cz0 + cj;

            // 17x17 chunk-neighborhood biomes, indexed [relZ+8][relX+8]
            int biomes[17][17];
            for (int rz = -8; rz <= 8; rz++)
                for (int rx = -8; rx <= 8; rx++) {
                    int bx = (cx + rx) * 16 + 8, bz = (cz + rz) * 16 + 8;
                    biomes[rz + 8][rx + 8] = getBiomeAt(g, 4, bx >> 2, 63 >> 2, bz >> 2);
                }

            int *col = out + 2 + ((size_t)(cj * nx + ci)) * per;

            for (size_t t = 0; t < sizeof(canyon_types) / sizeof(int); t++) {
                CanyonCarverConfig cc;
                if (!getCanyonCarverConfig(canyon_types[t], mc, &cc)) continue;
                if (cc.dim != g->dim) continue;   // per-dimension: OW carvers in OW, nether carver in nether
                poses.size = 0;
                carveCanyon(seed, mc, cx, cz, cc, canyon_types[t], biomes, &poses);
                for (int i = 0; i < poses.size; i++) {
                    int lx = poses.pos3s[i].x - cx * 16, lz = poses.pos3s[i].z - cz * 16;
                    if (lx >= 0 && lx < 16 && lz >= 0 && lz < 16) col[lz * 16 + lx]++;
                }
            }
            for (size_t t = 0; t < sizeof(cave_types) / sizeof(int); t++) {
                CaveCarverConfig cc;
                if (!getCaveCarverConfig(cave_types[t], mc, biomes[8][8], &cc)) continue;
                if (cc.dim != g->dim) continue;   // per-dimension: OW carvers in OW, nether carver in nether
                poses.size = 0;
                carveCave(seed, mc, cx, cz, cc, cave_types[t], biomes, &poses);
                for (int i = 0; i < poses.size; i++) {
                    int lx = poses.pos3s[i].x - cx * 16, lz = poses.pos3s[i].z - cz * 16;
                    if (lx >= 0 && lx < 16 && lz >= 0 && lz < 16) col[lz * 16 + lx]++;
                }
            }
        }
    }
    freePos3List(&poses);
    return out;
}

/* Per-column ore-vein footprint for a chunk range — the cave-layer analogue of
 * cm_get_carved_columns.  Probes the real 1.18+ ore-vein algorithm
 * (getOreVeinBlockAt: veininess + ridged A/B + gap noises) at every block column
 * over its full Y span and counts the vein-affected blocks, split copper (Y >= 0)
 * vs iron (Y < 0).  Unlike the chunk-centre veininess peek (cm_get_ore_veins_*),
 * this resolves each vein's true 3-D shape so it can be drawn like carved caves.
 *
 * Output: malloc'd int array [nx, nz, then nx*nz * 256 * 2] in chunk-row-major;
 * per chunk a 16x16 grid (column index localZ*16 + localX), 2 ints per column
 * (copper count, iron count). Caller frees with cm_free_results(). Overworld. */
int* cm_get_ore_vein_columns(int slot, int cx0, int cz0, int cx1, int cz1)
{
    if (slot < 0 || slot >= MAX_GENERATORS) return NULL;
    Generator *g = &g_generators[slot];

    int nx = cx1 - cx0 + 1, nz = cz1 - cz0 + 1;
    if (nx <= 0 || nz <= 0) return NULL;
    const size_t per = 256 * 2; // 16x16 columns, (copper,iron) per column

    int *out = (int*)calloc(2 + (size_t)nx * nz * per, sizeof(int));
    if (!out) return NULL;
    out[0] = nx; out[1] = nz;

    OreVeinParameters params;
    if (!initOreVeinNoise(&params, (uint64_t)g->seed, g->mc))
        return out; // pre-1.18: no ore veins, leave all-zero

    // Ore veins span Y -60..50 (getOreVeinBlockAt returns -1 outside this).
    for (int cj = 0; cj < nz; cj++) {
        for (int ci = 0; ci < nx; ci++) {
            int *cell = out + 2 + ((size_t)(cj * nx + ci)) * per;
            int bx0 = (cx0 + ci) * 16, bz0 = (cz0 + cj) * 16;
            for (int lz = 0; lz < 16; lz++) {
                for (int lx = 0; lx < 16; lx++) {
                    int bx = bx0 + lx, bz = bz0 + lz;
                    int copper = 0, iron = 0;
                    for (int y = -60; y <= 50; y++) {
                        if (getOreVeinBlockAt(bx, y, bz, &params) < 0) continue;
                        if (y >= 0) copper++; else iron++;
                    }
                    int *col = cell + (lz * 16 + lx) * 2;
                    col[0] = copper; col[1] = iron;
                }
            }
        }
    }
    return out;
}

/* Some structures (Abandoned Camp) report every chest within a piece at the same
 * approximate position — per cubiomes' own comment, "assume the tent chests all
 * fall in the same chunk"; real per-block chest offsets aren't modelled there.
 * Both callers below key chests by position (badges, loot grouping), so
 * identical positions within one piece would silently collapse distinct chests
 * into one — e.g. an Abandoned Camp's Secret Chest merging into its neighbouring
 * Common Chest. Nudge X by the within-piece duplicate count so every chest gets
 * a distinct key; harmless for structures whose chests are already at distinct
 * positions (dup count is always 0 there). Chest coordinates aren't surfaced to
 * the user anywhere — only used as an internal grouping key — so this is safe. */
static Pos dedupe_chest_pos(const Piece *p, int c)
{
    Pos pos = p->chestPoses[c];
    int dup = 0;
    for (int k = 0; k < c; k++) {
        if (p->chestPoses[k].x == pos.x && p->chestPoses[k].z == pos.z) dup++;
    }
    pos.x += dup;
    return pos;
}

/* Reverse of loot_table_parser.c's get_enchantment_from_name() (name -> enum,
 * needed there for parsing loot-table JSON at generation time) — we need the
 * opposite direction to report which enchantment a generated item actually
 * rolled. Kept in sync by hand with the Enchantment enum in loot_functions.h;
 * NULL for NO_ENCHANTMENT / anything unrecognised. */
const char* cm_enchantment_name(int ench)
{
    switch (ench) {
    case PROTECTION: return "protection";
    case FIRE_PROTECTION: return "fire_protection";
    case BLAST_PROTECTION: return "blast_protection";
    case PROJECTILE_PROTECTION: return "projectile_protection";
    case RESPIRATION: return "respiration";
    case AQUA_AFFINITY: return "aqua_affinity";
    case THORNS: return "thorns";
    case SWIFT_SNEAK: return "swift_sneak";
    case FEATHER_FALLING: return "feather_falling";
    case DEPTH_STRIDER: return "depth_strider";
    case FROST_WALKER: return "frost_walker";
    case SOUL_SPEED: return "soul_speed";
    case SHARPNESS: return "sharpness";
    case SMITE: return "smite";
    case BANE_OF_ARTHROPODS: return "bane_of_arthropods";
    case KNOCKBACK: return "knockback";
    case FIRE_ASPECT: return "fire_aspect";
    case LOOTING: return "looting";
    case SWEEPING_EDGE: return "sweeping_edge";
    case EFFICIENCY: return "efficiency";
    case SILK_TOUCH: return "silk_touch";
    case FORTUNE: return "fortune";
    case LUCK_OF_THE_SEA: return "luck_of_the_sea";
    case LURE: return "lure";
    case POWER: return "power";
    case PUNCH: return "punch";
    case FLAME: return "flame";
    case INFINITY_ENCHANTMENT: return "infinity";
    case QUICK_CHARGE: return "quick_charge";
    case MULTISHOT: return "multishot";
    case PIERCING: return "piercing";
    case IMPALING: return "impaling";
    case RIPTIDE: return "riptide";
    case LOYALTY: return "loyalty";
    case CHANNELING: return "channeling";
    case DENSITY: return "density";
    case BREACH: return "breach";
    case WIND_BURST: return "wind_burst";
    case MENDING: return "mending";
    case UNBREAKING: return "unbreaking";
    case CURSE_OF_VANISHING: return "curse_of_vanishing";
    case CURSE_OF_BINDING: return "curse_of_binding";
    case LUNGE: return "lunge"; // 26.3: Spear enchantment
    case NO_ENCHANTMENT:
    default: return NULL;
    }
}

/* set_potion_function (loot_functions.c) only ever copies the chosen Potion's
 * mob_effects[0] into the item — it discards the Potion's own id/name. Every
 * potion actually reachable via set_potion has exactly one mob effect (the
 * function bails otherwise), and each such potion's {effect, duration} pair is
 * unique in the table, so matching back against POTIONS[] recovers the name
 * losslessly. NULL if no potion was applied (effect == -1) or no match. */
const char* cm_potion_name_for_effect(int effect, int duration)
{
    if (effect < 0) return NULL;
    for (int i = 0; i < POTION_NUM; i++) {
        const struct Potion *p = &POTIONS[i];
        if (p->mob_effect_count == 1 &&
            p->mob_effects[0].effect == effect &&
            p->mob_effects[0].duration == duration) {
            return p->potion_name;
        }
    }
    return NULL;
}

/* Per generated item: chestX, chestZ, itemGlobalId, itemCount, mob-effect
 * (effect, duration — -1,-1 if none, e.g. no set_potion applied), enchantment
 * count, then up to 16 (enchantment, level) pairs (-1,-1 padding beyond the
 * item's actual count). ItemStack.enchantments is itself capped at 16 (see
 * loot_functions.h) so this is lossless, not a truncation. */
#define LOOT_ITEM_STRIDE (4 + 2 + 1 + 16 * 2)

/* Generate the chest loot for a structure at (posX, posZ): for every chest in
 * every piece, roll the loot table with its loot seed.
 *
 * Returns a malloc'd int array: [count, then count * LOOT_ITEM_STRIDE ints] —
 * see the field layout above. Resolve item/enchantment/potion ids to names
 * with cm_item_name() / cm_enchantment_name() / cm_potion_name_for_effect().
 * Caller frees with cm_free_results(). NOTE: the loot library is not
 * thread-safe — callers must serialise via the cubiomes lock (the Rust
 * command does). */
int* cm_get_structure_loot(int slot, int struct_type, int posX, int posZ)
{
    if (slot < 0 || slot >= MAX_GENERATORS) return NULL;
    Generator *g = &g_generators[slot];
    uint64_t seed = (uint64_t)g->seed;
    int biome = getBiomeAt(g, 4, posX >> 2, 16, posZ >> 2);

    StructureSaltConfig ssconf;
    if (!getStructureSaltConfig(struct_type, g->mc, biome, &ssconf)) return NULL;

    StructureVariant sv;
    memset(&sv, 0, sizeof sv);
    getVariant(&sv, struct_type, g->mc, seed, posX, posZ, biome);

    // Must be >= END_CITY_PIECES_MAX (421, finders.h) — getStructurePieces bails
    // with -1 for End_City otherwise (checked against this buffer size, not the
    // structure's actual piece count), silently zeroing every End City's chests
    // regardless of seed/position. 256 (the old value) was always too small.
    const int N = 512;
    Piece *list = (Piece*)calloc(N, sizeof(Piece));
    if (!list) return NULL;
    int pieceCount = getStructurePieces(list, N, struct_type, ssconf, &sv, g->mc, seed, posX, posZ);
    if (pieceCount < 0) pieceCount = 0;
    if (pieceCount > N) pieceCount = N;

    int cap = 256, count = 0;
    int *out = (int*)malloc(sizeof(int) * (1 + (size_t)cap * LOOT_ITEM_STRIDE));
    if (!out) { free(list); return NULL; }

    for (int i = 0; i < pieceCount; i++) {
        Piece *p = &list[i];
        for (int c = 0; c < p->chestCount && c < 4; c++) {
            if (!p->lootTables[c]) continue;
            // init_loot_table_name returns a shared static, one-time-initialised
            // context (e.g. &desert_pyramid context) — do NOT free it. Holding the
            // cubiomes lock serialises access to this shared state.
            LootTableContext *ctx = NULL;
            if (!init_loot_table_name(&ctx, p->lootTables[c], g->mc) || !ctx) continue;
            set_loot_seed(ctx, p->lootSeeds[c]);
            generate_loot(ctx);
            Pos cpos = dedupe_chest_pos(p, c);
            for (int j = 0; j < ctx->generated_item_count; j++) {
                if (count >= cap) {
                    cap *= 2;
                    int *grown = (int*)realloc(out, sizeof(int) * (1 + (size_t)cap * LOOT_ITEM_STRIDE));
                    if (!grown) { free(out); free(list); return NULL; }
                    out = grown;
                }
                const ItemStack *is = &ctx->generated_items[j];
                int *rec = out + 1 + count * LOOT_ITEM_STRIDE;
                rec[0] = cpos.x;
                rec[1] = cpos.z;
                // generated_items[].item is a table-local context id; map it to
                // the global item id that cm_item_name/global_id2item_name expect.
                rec[2] = get_global_item_id(ctx, is->item);
                rec[3] = is->count;
                rec[4] = is->mob_effect.effect;   // -1 if no set_potion was applied
                rec[5] = is->mob_effect.duration;
                int en = is->enchantment_count;
                if (en > 16) en = 16; // ItemStack.enchantments capacity — see loot_functions.h
                if (en < 0) en = 0;
                rec[6] = en;
                for (int k = 0; k < 16; k++) {
                    if (k < en) {
                        rec[7 + k * 2 + 0] = is->enchantments[k].enchantment;
                        rec[7 + k * 2 + 1] = is->enchantments[k].level;
                    } else {
                        rec[7 + k * 2 + 0] = -1;
                        rec[7 + k * 2 + 1] = -1;
                    }
                }
                count++;
            }
        }
    }
    free(list);
    out[0] = count;
    return out;
}

/* Report the chest composition of a structure at (posX, posZ) WITHOUT rolling
 * the loot — i.e. which loot tables are present, so markers can be badged by
 * loot potential (a shipwreck with supply+map+treasure vs supply only).
 *
 * Returns a malloc'd, NUL-terminated string: one line per chest, formatted
 * "chestX\tchestZ\tloot_table\tflag\n", where flag is "ship" for a chest on an
 * End City's End Ship piece (the only piece with better-than-average odds of
 * containing an Elytra — the tower chests share the same "end_city_treasure"
 * loot table name, so this can't be told apart by table name alone) and empty
 * otherwise. Empty string ("") if the structure has no chests; NULL on bad
 * slot / unsupported structure / allocation failure. Caller frees with
 * cm_free_string(). Like cm_get_structure_loot this walks the generator, so
 * callers must hold the cubiomes lock. */
char* cm_get_structure_chests(int slot, int struct_type, int posX, int posZ)
{
    if (slot < 0 || slot >= MAX_GENERATORS) return NULL;
    Generator *g = &g_generators[slot];
    uint64_t seed = (uint64_t)g->seed;
    int biome = getBiomeAt(g, 4, posX >> 2, 16, posZ >> 2);

    StructureSaltConfig ssconf;
    if (!getStructureSaltConfig(struct_type, g->mc, biome, &ssconf)) return NULL;

    StructureVariant sv;
    memset(&sv, 0, sizeof sv);
    getVariant(&sv, struct_type, g->mc, seed, posX, posZ, biome);

    // Must be >= END_CITY_PIECES_MAX (421, finders.h) — getStructurePieces bails
    // with -1 for End_City otherwise (checked against this buffer size, not the
    // structure's actual piece count), silently zeroing every End City's chests
    // regardless of seed/position. 256 (the old value) was always too small.
    const int N = 512;
    Piece *list = (Piece*)calloc(N, sizeof(Piece));
    if (!list) return NULL;
    int pieceCount = getStructurePieces(list, N, struct_type, ssconf, &sv, g->mc, seed, posX, posZ);
    if (pieceCount < 0) pieceCount = 0;
    if (pieceCount > N) pieceCount = N;

    size_t cap = 256, len = 0;
    char *out = (char*)malloc(cap);
    if (!out) { free(list); return NULL; }
    out[0] = '\0';

    for (int i = 0; i < pieceCount; i++) {
        Piece *p = &list[i];
        const char *flag = (struct_type == End_City && p->type == END_SHIP) ? "ship" : "";
        for (int c = 0; c < p->chestCount && c < 4; c++) {
            const char *tbl = p->lootTables[c];
            if (!tbl) continue;
            Pos cpos = dedupe_chest_pos(p, c);
            char line[160];
            int n = snprintf(line, sizeof line, "%d\t%d\t%s\t%s\n",
                             cpos.x, cpos.z, tbl, flag);
            if (n < 0) continue;
            if (len + (size_t)n + 1 > cap) {
                while (len + (size_t)n + 1 > cap) cap *= 2;
                char *grown = (char*)realloc(out, cap);
                if (!grown) { free(out); free(list); return NULL; }
                out = grown;
            }
            memcpy(out + len, line, (size_t)n);
            len += (size_t)n;
            out[len] = '\0';
        }
    }
    free(list);
    return out;
}

/* Free a string returned by cm_get_structure_chests(). */
void cm_free_string(char *ptr)
{
    free(ptr);
}

/* Resolve an item global id to its namespaced name (static string, do not free). */
const char* cm_item_name(int global_id, int mc)
{
    return global_id2item_name(global_id, mc);
}

/* The 20 End Gateways generated in a ring on the main End island the first
 * time the Ender Dragon is defeated, paired with each one's outer linked
 * destination — the position the game deterministically picks on the outer
 * End islands the moment a player steps through, before it's ever written to
 * a chunk. Both halves are computed straight from the seed (getFixedEndGateways
 * / getLinkedGatewayPos), so this works even for gateways nobody has visited.
 *
 * Writes 20 * 4 ints to `out`: srcX, srcZ, dstX, dstZ per pair. Requires a
 * slot set up for DIM_END and mc > 1.12 (getLinkedGatewayPos is undefined
 * before that). Returns 20 on success, -1 on bad slot / wrong dimension /
 * mc too old. Walks generator state, so callers must hold the cubiomes lock. */
int cm_get_end_gateway_links(int slot, int *out)
{
    if (slot < 0 || slot >= MAX_GENERATORS) return -1;
    Generator *g = &g_generators[slot];
    if (g->dim != DIM_END || g->mc <= MC_1_12) return -1;

    if (!g_sn_end_initialized[slot]) {
        initSurfaceNoise(&g_surface_noise_end[slot], DIM_END, (uint64_t)g->seed);
        g_sn_end_initialized[slot] = 1;
    }

    Pos src[20];
    getFixedEndGateways(g->mc, (uint64_t)g->seed, src);
    for (int i = 0; i < 20; i++) {
        Pos dst = getLinkedGatewayPos(&g->en, &g_surface_noise_end[slot], (uint64_t)g->seed, src[i]);
        out[i * 4 + 0] = src[i].x;
        out[i * 4 + 1] = src[i].z;
        out[i * 4 + 2] = dst.x;
        out[i * 4 + 3] = dst.z;
    }
    return 20;
}

/* Real preliminary surface heightmap for a block region [x0,z0] .. (w x h),
 * using the actual terrain noise (vs the biome-based mapApproxHeight).
 * Overworld uses TerrainNoise; End uses mapEndSurfaceHeight (real per-block End
 * terrain, not just the biome-based approximation) over the cached End
 * SurfaceNoise. Returns a malloc'd int array of w*h surface Y values
 * (row-major). Caller frees with cm_free_results(). NULL on bad slot /
 * Overworld <1.18 / allocation. */
int* cm_get_surface_heights(int slot, int x0, int z0, int w, int h, int stride)
{
    if (slot < 0 || slot >= MAX_GENERATORS) return NULL;
    if (w <= 0 || h <= 0) return NULL;
    if (stride < 1) stride = 1;
    Generator *g = &g_generators[slot];

    int *out = (int*)malloc(sizeof(int) * (size_t)w * (size_t)h);
    if (!out) return NULL;

    if (g->dim == DIM_END) {
        if (!g_sn_end_initialized[slot]) {
            initSurfaceNoise(&g_surface_noise_end[slot], DIM_END, (uint64_t)g->seed);
            g_sn_end_initialized[slot] = 1;
        }
        for (int j = 0; j < h; j++) {
            for (int i = 0; i < w; i++) {
                float y = 0.0f;
                mapEndSurfaceHeight(&y, &g->en, &g_surface_noise_end[slot],
                                     x0 + i * stride, z0 + j * stride, 1, 1, 4, 0);
                out[(size_t)j * w + i] = (int)y;
            }
        }
        return out;
    }

    // calloc: SplineStack/TerrainNoise use len counters as append indices, so the
    // struct MUST start zeroed or setupTerrainNoise writes out of bounds.
    TerrainNoise *tn = (TerrainNoise*)calloc(1, sizeof(TerrainNoise));
    if (!tn) { free(out); return NULL; }
    if (!setupTerrainNoise(tn, g->mc, 0)) { free(tn); free(out); return NULL; }  // <1.18 unsupported
    initTerrainNoise(tn, (uint64_t)g->seed, DIM_OVERWORLD);

    for (int j = 0; j < h; j++)
        for (int i = 0; i < w; i++)
            out[(size_t)j * w + i] = samplePreliminarySurfaceLevel(tn, x0 + i * stride, z0 + j * stride);

    free(tn);
    return out;
}

int cm_get_biome_region_at(int slot, int x, int z, int width, int height, int scale, int y, int *buffer)
{
    if (slot < 0 || slot >= MAX_GENERATORS) return -1;
    Range r;
    r.scale = scale; r.x = x; r.z = z;
    r.sx = width;    r.sz = height;
    r.y = y;         r.sy = 1;

    int *cache = allocCache(&g_generators[slot], r);
    if (!cache) return -1;

    int rc = genBiomes(&g_generators[slot], cache, r);
    if (rc == 0)
        memcpy(buffer, cache, (size_t)width * (size_t)height * sizeof(int));
    free(cache);
    return rc;
}

void cm_free_results(int *ptr)
{
    free(ptr);
}
