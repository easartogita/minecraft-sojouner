# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Tauri 2 + React desktop app that renders an interactive Minecraft world map (Java and Bedrock). Rust backend does all the heavy lifting — reads world files directly and generates tiles; React/Leaflet frontend renders and interacts. cubiomes (native C, Java worldgen algorithms only) is linked into the Rust binary via FFI.

## Commands

```bash
npm install       # install deps (clone with --recurse-submodules first — see below)
npm run dev       # dev mode (Tauri + Vite hot reload)
npm run build     # production build → src-tauri/target/release/bundle/
```

There is no configured lint/test script; `cargo build` (run automatically by `npm run dev`/`build`) is the compile-time check for the Rust side, `tsc` (via `vite build`) for the frontend.

## Architecture surprises

**cubiomes is native, not WASM.** Linked directly into the Tauri binary via `build.rs` + `cubiomes_bridge.c`. All FFI goes through a single `CUBIOMES_LOCK` mutex in `src-tauri/src/cubiomes/mod.rs` — every call that touches the generator must hold it. Split by concern: `cubiomes/biomes.rs`, `structures.rs`, `ore_veins.rs`, `carvers.rs`.

**cubiomes submodule is `xpple/cubiomes`** (a fork), tracking branch `26.3` — not upstream `Cubitect/cubiomes`, which lacks current Java version support.

**Bedrock worlds are read via LevelDB, not `.mca`.** Two more C/C++ libs are statically linked alongside cubiomes: the Mojang `leveldb` fork and Google `snappy` (both git submodules — clone with `--recurse-submodules` or `git submodule update --init --recursive`). `src-tauri/src/bedrock/` mirrors the Java readers (`chunk_reader.rs`, `entity_reader.rs`, `block_entity_reader.rs`, `poi_reader.rs`) and parses **little-endian** NBT (`bedrock/le_nbt.rs` / `nbt_reader.rs`) vs Java's big-endian. Edition is auto-detected and carried as `WorldEdition`; readers dispatch on it. Because cubiomes only implements Java algorithms, Bedrock biome map and structure positions are *approximate/wrong* — block tiles, markers, entities, POI, ore veins, and slime chunks are all still accurate.

**Save-data readers come in Java/Bedrock pairs.** Entities, block entities, and POI each have a top-level Java reader (`entity_reader.rs`, `block_entity_reader.rs`, `poi_reader.rs`) and a `bedrock/` counterpart. Their output structs are `#[serde(rename_all = "camelCase")]` and must stay in sync with the matching TS interfaces in the frontend.

**App version is MC-aligned, not semver.** `package.json` is pinned to track the supported Minecraft version (currently `26.3.x`) — bumping it is a worldgen-support statement, not a release-cadence one.

**MC 1.21.5+ changed two things:** seed moved to `data/minecraft/world_gen_settings.dat`; region files moved under `dimensions/minecraft/<dim>/region/`. Both legacy and new paths are handled in `nbt_reader.rs` and `region_reader.rs`.

**Tile rendering has two modes:** biome colors (cubiomes, zoom < 3) and real block colors read from `.mca`/LevelDB (zoom ≥ 3), both cached to disk as PNGs and invalidated on world save. TIFF export re-renders straight from world files at export time — it does not use the tile cache.

**Leaflet coordinate space:** 1 Leaflet unit = `1 / BASE_BLOCKS_PER_PIXEL` blocks. The map flips Z: north is negative Z. Nether coordinates are 1:8 vs Overworld. See `src/renderer/lib/tileCoords.ts`.

**Frontend layout:** a left icon rail (`components/Rail.tsx`) with six flyout panels (`components/rail/*Flyout.tsx`: World, Layers, Seed, World Data, Saved, Settings) driving map overlay layers in `components/*Layer.tsx`. State lives in reducer-based slices under `hooks/*Slice.ts` (`worldSlice.ts`'s `worldReducer`, `overlaySlice.ts`), not a state-management library.

**Static export is a second frontend entry point, not a mode flag.** `npm run build:site` builds against `vite.site.config.ts`, which aliases `lib/tauriAPI` to `lib/tauriAPI.static.ts` — a parallel implementation of the same exported function names, reading a pre-baked `manifest.json` + tile/data files instead of invoking Tauri. Every component imports from `lib/tauriAPI` unmodified; which implementation it gets is decided at the build-config level. `src-tauri/src/static_export.rs` generates that bundle; `src-tauri/src/bin/export_cli.rs` runs the same export headlessly (no GUI/Tauri window) for scripted use.
