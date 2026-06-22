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

int cm_setup_generator(int seed_low, int seed_high, int mc_version, int dimension, int flags)
{
    int slot = g_slot_count % MAX_GENERATORS;
    g_slot_count++;
    g_sn_initialized[slot] = 0;

    uint64_t useed = ((uint64_t)(uint32_t)seed_high << 32) | (uint32_t)seed_low;
    long long seed = (long long)useed;

    setupGenerator(&g_generators[slot], mc_version, (uint32_t)flags);
    applySeed(&g_generators[slot], dimension, seed);

    return slot;
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

    for (int rx = rx0; rx <= rx1; rx++) {
        for (int rz = rz0; rz <= rz1; rz++) {
            Pos p;
            if (!getStructurePos(struct_type, g->mc, (uint64_t)g->seed, rx, rz, &p))
                continue;
            if (!isViableStructurePos(struct_type, g, p.x, p.z, 0))
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
                }
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

    if (g->dim == DIM_NETHER || g->dim == DIM_END) {
        for (int i = 0; i < w * h; i++) out_y[i] = 0.0f;
        return 0;
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

void cm_get_ore_veins(int32_t seed_lo, int32_t seed_hi,
                      int32_t cx0, int32_t cz0, int32_t cx1, int32_t cz1,
                      uint8_t *out)
{
    uint64_t seed = ((uint64_t)(uint32_t)seed_hi << 32) | (uint32_t)seed_lo;

    Xoroshiro pxr;
    xSetSeed(&pxr, seed);
    uint64_t xlo = xNextLong(&pxr);
    uint64_t xhi = xNextLong(&pxr);

    static const double veininess_amp[] = {1.0};
    DoublePerlinNoise veininess;
    PerlinNoise veininess_octs[2];
    pxr.lo = xlo ^ 0x6b86c7820a307171ULL;
    pxr.hi = xhi ^ 0xd87fb0fefd9c1624ULL;
    xDoublePerlinInit(&veininess, &pxr, veininess_octs, veininess_amp, -8, 1, 2);

    int w = cx1 - cx0 + 1;
    for (int cz = cz0; cz <= cz1; cz++) {
        for (int cx = cx0; cx <= cx1; cx++) {
            double bx = (cx * 16.0 + 8.0) * 1.5;
            double bz = (cz * 16.0 + 8.0) * 1.5;
            int idx = (cz - cz0) * w + (cx - cx0);

            /* Copper: Y 0–50, veininess > +0.4 */
            int has_copper = 0;
            for (int y = 0; y <= 50 && !has_copper; y += 2) {
                if (sampleDoublePerlin(&veininess, bx, y * 1.5, bz) > 0.4) has_copper = 1;
            }
            if (has_copper) { out[idx] = 1; continue; }

            /* Iron: Y -60 to -8, veininess < -0.4 */
            int has_iron = 0;
            for (int y = -60; y <= -8 && !has_iron; y += 2) {
                if (sampleDoublePerlin(&veininess, bx, y * 1.5, bz) < -0.4) has_iron = 1;
            }
            out[idx] = has_iron ? 2 : 0;
        }
    }
}

void cm_get_ore_veins_at(int32_t seed_lo, int32_t seed_hi,
                         int32_t cx, int32_t cz,
                         int *copper_y_out, int *iron_y_out)
{
    uint64_t seed = ((uint64_t)(uint32_t)seed_hi << 32) | (uint32_t)seed_lo;

    Xoroshiro pxr;
    xSetSeed(&pxr, seed);
    uint64_t xlo = xNextLong(&pxr);
    uint64_t xhi = xNextLong(&pxr);

    static const double veininess_amp[] = {1.0};
    DoublePerlinNoise veininess;
    PerlinNoise veininess_octs[2];
    pxr.lo = xlo ^ 0x6b86c7820a307171ULL;
    pxr.hi = xhi ^ 0xd87fb0fefd9c1624ULL;
    xDoublePerlinInit(&veininess, &pxr, veininess_octs, veininess_amp, -8, 1, 2);

    double bx = (cx * 16.0 + 8.0) * 1.5;
    double bz = (cz * 16.0 + 8.0) * 1.5;

    /* Copper: Y 0–50, find peak positive veininess */
    double peakCopper = 0.0; int bestCopperY = INT_MIN;
    for (int y = 0; y <= 50; y += 2) {
        double v = sampleDoublePerlin(&veininess, bx, y * 1.5, bz);
        if (v > peakCopper) { peakCopper = v; bestCopperY = y; }
    }
    *copper_y_out = peakCopper > 0.4 ? bestCopperY : INT_MIN;

    /* Iron: Y -60 to -8, find peak negative veininess */
    double minVeininess = 0.0; int bestIronY = INT_MIN;
    for (int y = -60; y <= -8; y += 2) {
        double v = sampleDoublePerlin(&veininess, bx, y * 1.5, bz);
        if (v < minVeininess) { minVeininess = v; bestIronY = y; }
    }
    *iron_y_out = minVeininess < -0.4 ? bestIronY : INT_MIN;
}

/* Returns [copper_y, copper_size, iron_y, iron_size] per call.
 * size: 0=no vein, 1=small (|veininess|>=0.4), 2=medium (>=0.5), 3=large (>=0.6).
 * y is INT_MIN when size==0.
 * Uses ore_veininess noise: copper at Y 0–50 (positive), iron at Y -60 to -8 (negative). */
void cm_get_ore_veins_at2(int32_t seed_lo, int32_t seed_hi,
                          int32_t cx, int32_t cz,
                          int *copper_y_out, int *copper_sz_out,
                          int *iron_y_out,   int *iron_sz_out)
{
    uint64_t seed = ((uint64_t)(uint32_t)seed_hi << 32) | (uint32_t)seed_lo;

    Xoroshiro pxr;
    xSetSeed(&pxr, seed);
    uint64_t xlo = xNextLong(&pxr);
    uint64_t xhi = xNextLong(&pxr);

    static const double veininess_amp[] = {1.0};
    DoublePerlinNoise veininess;
    PerlinNoise veininess_octs[2];
    pxr.lo = xlo ^ 0x6b86c7820a307171ULL;
    pxr.hi = xhi ^ 0xd87fb0fefd9c1624ULL;
    xDoublePerlinInit(&veininess, &pxr, veininess_octs, veininess_amp, -8, 1, 2);

    double bx = (cx * 16.0 + 8.0) * 1.5;
    double bz = (cz * 16.0 + 8.0) * 1.5;

    /* Copper: Y 0–50, peak positive veininess */
    double peakCopper = 0.0; int bestCopperY = INT_MIN;
    for (int y = 0; y <= 50; y += 2) {
        double v = sampleDoublePerlin(&veininess, bx, y * 1.5, bz);
        if (v > peakCopper) { peakCopper = v; bestCopperY = y; }
    }
    if (peakCopper > 0.4) {
        *copper_y_out  = bestCopperY;
        *copper_sz_out = peakCopper >= 0.6 ? 3 : peakCopper >= 0.5 ? 2 : 1;
    } else {
        *copper_y_out  = INT_MIN;
        *copper_sz_out = 0;
    }

    /* Iron: Y -60 to -8, peak negative veininess */
    double minVeininess = 0.0; int bestIronY = INT_MIN;
    for (int y = -60; y <= -8; y += 2) {
        double v = sampleDoublePerlin(&veininess, bx, y * 1.5, bz);
        if (v < minVeininess) { minVeininess = v; bestIronY = y; }
    }
    double ironMag = -minVeininess;
    if (ironMag > 0.4) {
        *iron_y_out  = bestIronY;
        *iron_sz_out = ironMag >= 0.6 ? 3 : ironMag >= 0.5 ? 2 : 1;
    } else {
        *iron_y_out  = INT_MIN;
        *iron_sz_out = 0;
    }
}

/* Generate ore-feature block positions (normal ore blobs: diamond, gold, iron,
 * redstone, etc.) for the given Ores enum types over a chunk range, using the
 * accurate configured-feature generation (distinct from the veininess overlay).
 *
 * Returns a malloc'd int array: [count, then count * (oreType, x, y, z)].
 * Caller frees with cm_free_results(). Returns NULL on bad slot / allocation. */
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

    int cap = 4096;
    int *out = (int*)malloc(sizeof(int) * (1 + (size_t)cap * 4));
    if (!out) return NULL;
    int count = 0;

    for (int ti = 0; ti < num_types; ti++) {
        int oreType = ore_types[ti];
        OreConfig oconf;
        /* biomeID is unused for >=1.18; pass -1 (viability is checked per-position). */
        if (!getOreConfig(oreType, g->mc, -1, &oconf)) continue;

        for (int cx = cx0; cx <= cx1; cx++) {
            for (int cz = cz0; cz <= cz1; cz++) {
                Pos3List list = generateOres(g, sn, oconf, cx, cz);
                for (int i = 0; i < list.size; i++) {
                    if (count >= cap) {
                        cap *= 2;
                        int *grown = (int*)realloc(out, sizeof(int) * (1 + (size_t)cap * 4));
                        if (!grown) { free(out); freePos3List(&list); return NULL; }
                        out = grown;
                    }
                    Pos3 p = list.pos3s[i];
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
    out[0] = count;
    return out;
}

/* Carver (cave/ravine/canyon) coverage for a chunk range, aggregated top-down.
 *
 * Caves/canyons carve thousands of 3-D blocks, so we reduce each chunk to a
 * 16x16 grid of per-column carved-block counts (0 = solid). Output is a malloc'd
 * int array: [nx, nz, then nx*nz * 256 ints] in chunk-row-major, column index
 * (localZ*16 + localX). Caller frees with cm_free_results().  Overworld only. */
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
                                        OCEAN_CAVE_CARVER, UNDERWATER_CAVE_CARVER };
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
                if (cc.dim != DIM_OVERWORLD) continue;
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
                if (cc.dim != DIM_OVERWORLD) continue;
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

/* Generate the chest loot for a structure at (posX, posZ): for every chest in
 * every piece, roll the loot table with its loot seed.
 *
 * Returns a malloc'd int array: [count, then count * 4 ints]:
 *   chestX, chestZ, itemGlobalId, itemCount
 * Resolve item ids to names with cm_item_name(). Caller frees with
 * cm_free_results(). NOTE: the loot library is not thread-safe — callers must
 * serialise via the cubiomes lock (the Rust command does). */
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

    const int N = 256;
    Piece *list = (Piece*)calloc(N, sizeof(Piece));
    if (!list) return NULL;
    int pieceCount = getStructurePieces(list, N, struct_type, ssconf, &sv, g->mc, seed, posX, posZ);
    if (pieceCount < 0) pieceCount = 0;
    if (pieceCount > N) pieceCount = N;

    int cap = 256, count = 0;
    int *out = (int*)malloc(sizeof(int) * (1 + (size_t)cap * 4));
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
            for (int j = 0; j < ctx->generated_item_count; j++) {
                if (count >= cap) {
                    cap *= 2;
                    int *grown = (int*)realloc(out, sizeof(int) * (1 + (size_t)cap * 4));
                    if (!grown) { free(out); free(list); return NULL; }
                    out = grown;
                }
                out[1 + count * 4 + 0] = p->chestPoses[c].x;
                out[1 + count * 4 + 1] = p->chestPoses[c].z;
                // generated_items[].item is a table-local context id; map it to
                // the global item id that cm_item_name/global_id2item_name expect.
                out[1 + count * 4 + 2] = get_global_item_id(ctx, ctx->generated_items[j].item);
                out[1 + count * 4 + 3] = ctx->generated_items[j].count;
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
 * "chestX\tchestZ\tloot_table\n". Empty string ("") if the structure has no
 * chests; NULL on bad slot / unsupported structure / allocation failure.
 * Caller frees with cm_free_string(). Like cm_get_structure_loot this walks the
 * generator, so callers must hold the cubiomes lock. */
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

    const int N = 256;
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
        for (int c = 0; c < p->chestCount && c < 4; c++) {
            const char *tbl = p->lootTables[c];
            if (!tbl) continue;
            char line[160];
            int n = snprintf(line, sizeof line, "%d\t%d\t%s\n",
                             p->chestPoses[c].x, p->chestPoses[c].z, tbl);
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

/* Real preliminary surface heightmap for a block region [x0,z0] .. (w x h),
 * using the actual terrain noise (vs the biome-based mapApproxHeight). Overworld.
 * Returns a malloc'd int array of w*h surface Y values (row-major).
 * Caller frees with cm_free_results(). NULL on bad slot / <1.18 / allocation. */
int* cm_get_surface_heights(int slot, int x0, int z0, int w, int h, int stride)
{
    if (slot < 0 || slot >= MAX_GENERATORS) return NULL;
    if (w <= 0 || h <= 0) return NULL;
    if (stride < 1) stride = 1;
    Generator *g = &g_generators[slot];

    // calloc: SplineStack/TerrainNoise use len counters as append indices, so the
    // struct MUST start zeroed or setupTerrainNoise writes out of bounds.
    TerrainNoise *tn = (TerrainNoise*)calloc(1, sizeof(TerrainNoise));
    if (!tn) return NULL;
    if (!setupTerrainNoise(tn, g->mc, 0)) { free(tn); return NULL; }  // <1.18 unsupported
    initTerrainNoise(tn, (uint64_t)g->seed, DIM_OVERWORLD);

    int *out = (int*)malloc(sizeof(int) * (size_t)w * (size_t)h);
    if (!out) { free(tn); return NULL; }
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
