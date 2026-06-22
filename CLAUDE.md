# CLAUDE.md

## Project

Tauri + React desktop app for rendering interactive Minecraft world maps. Rust backend handles all heavy lifting; React/Leaflet frontend renders and interacts.

## Commands

```bash
npm install       # install deps
npm run dev       # dev mode (Tauri + Vite hot reload)
npm run build     # production build
```

## Architecture surprises

**cubiomes is native, not WASM.** The cubiomes C library is linked directly into the Tauri binary. All FFI goes through a single `CUBIOMES_LOCK` mutex in `cubiomes/mod.rs` — every call that touches the generator must hold it. The module is split: `cubiomes/biomes.rs`, `cubiomes/structures.rs`, `cubiomes/ore_veins.rs`, `cubiomes/carvers.rs`, `cubiomes/terrain.rs`.

**Bedrock worlds are read via LevelDB, not `.mca`.** Two more C/C++ libraries are statically linked alongside cubiomes: the Mojang `leveldb` fork and Google `snappy` (both git submodules — clone with `--recurse-submodules`). The `bedrock/` module mirrors the Java readers (`bedrock/chunk_reader.rs`, `entity_reader.rs`, `block_entity_reader.rs`, `poi_reader.rs`) and parses **little-endian** NBT (`bedrock/le_nbt.rs`) vs Java's big-endian. Edition is auto-detected and carried as `WorldEdition`; readers dispatch on it. **cubiomes implements Java algorithms only**, so for Bedrock worlds the biome map and structure positions are *approximate/wrong* — block tiles, markers, entities, POI, ore veins, slime chunks all work. (If real Bedrock biome-gen is ever wanted, see `FragrantResult186/cubiomes-bedrock`, `MC_26_30`.)

**Save-data readers come in Java/Bedrock pairs.** Entities, block entities, and POI each have a top-level Java reader (`entity_reader.rs`, `block_entity_reader.rs`, `poi_reader.rs`) and a `bedrock/` counterpart. Their output structs are `#[serde(rename_all = "camelCase")]` and must stay in sync with the matching TS interfaces (`GameEntity`, etc.) in the frontend.

**App version is MC-aligned, not semver.** `package.json` / `tauri.conf.json` are pinned to `26.2.0` to track the supported Minecraft version — bumping it is a worldgen-support statement, not a release-cadence one.

**cubiomes submodule is the `xpple/cubiomes` fork**, not upstream `Cubitect/cubiomes` — upstream has no Java 26.x support. The fork adds `MC_26_1`/`MC_26_2` and `sulfur_caves` (biome 187). Re-applying our patch means rebasing onto the fork (or upstream once it lands 26.x).

**MC 1.21.5+ changed two things:** seed moved to `data/minecraft/world_gen_settings.dat`; region files moved to `dimensions/minecraft/overworld/region/`. Both handled in `nbt_reader.rs` and `region_reader.rs`.

**Tile rendering has two modes:** biome colors (cubiomes, zoom < 3) and real block colors from `.mca` files (zoom ≥ 3). The TIFF export re-renders from `.mca` directly — it does not use the tile cache.

**TIFF export canvas sizing** uses the real bounding box of region coordinates (not `sqrt(count)`), plus a 1-region border filled with biome colors.

**Leaflet coordinate space:** 1 Leaflet unit = `1/BASE_BLOCKS_PER_PIXEL` blocks. The map flips Z: north is negative Z. Nether coordinates are 1:8 vs overworld. See `lib/tileCoords.ts`.
