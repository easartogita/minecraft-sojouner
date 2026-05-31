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
