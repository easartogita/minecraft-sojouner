# Minecraft Sojourner

A desktop app that renders a live, interactive map of your Minecraft world — biomes, structures, real block colors, cave mode, ore veins, block entities, entities, and more — read directly from your world files. Supports both **Java** and **Bedrock** editions. The map refreshes automatically whenever the world saves.

Built with Tauri 2 + Rust + React + Leaflet. cubiomes is compiled as a native static library and called via Rust FFI. Bedrock worlds are read via LevelDB (Mojang fork) with Snappy decompression.

---

## Bedrock edition — known limitations

Bedrock support is functional for block rendering and markers, but two major features rely on cubiomes which implements **Java Edition algorithms only**:

- **Biome map** — at low zoom, biome tiles are generated using Java Edition's world generation. For Bedrock worlds the colors will not match the actual world; treat them as approximate terrain guidance only.
- **Structures** — structure positions are predicted using Java Edition's placement logic. Bedrock uses different seeds and placement rules; most positions will be wrong.

Everything else — block color tiles, cave mode, block entities, entities, POI, ore veins, slime chunks, TIFF export — works correctly for Bedrock.

---

## Features

### World support
- **Java Edition** — reads `.mca` region files directly
- **Bedrock Edition** — reads LevelDB (`db/`) with Snappy decompression; auto-detected from the world directory
- **Auto-load** — pass `--level-dat=<path>` on the command line to open a world at startup
- **Drag & drop** — drop a `level.dat` or world folder onto the window
- **Recent worlds** — quick-access list sorted by last modified
- **Seed-only mode** — enter a seed manually without opening a world file
- **World type support** — Default, Large Biomes, Amplified, Flat, Single Biome (auto-detected)

### Map rendering
- **Biome map** — cubiomes-generated biome colors at low zoom; Overworld, Nether, and End *(Java accurate; Bedrock approximate — see above)*
- **Real block colors** — at zoom ≥ 3, reads actual surface blocks from `.mca` / LevelDB with hillshading and water depth tinting
- **Cave mode** — underground block colors at a configurable Y depth with adjustable scan window
- **Underground biomes** — biome colors for a subsurface Y slice
- **Tile cache** — rendered tiles cached to disk as PNGs; invalidated automatically on world save
- **Tile pre-generation** — pre-render all tiles for a configurable radius around spawn so subsequent viewport loads are near-instant

### Structures *(Java accurate; Bedrock approximate — see above)*
All cubiomes-supported structures with labels, loot summaries, and variant annotations:

**Overworld** — Village, Stronghold, Woodland Mansion, Ocean Monument, Witch Hut, Pillager Outpost, Desert Temple, Jungle Temple, Igloo, Shipwreck, Ruined Portal, Ancient City, Trial Chambers, Trail Ruins, Ocean Ruins, Desert Well, Buried Treasure, Mineshaft, Amethyst Geode

**Nether** — Nether Fortress, Bastion Remnant, Ruined Portal

**End** — End City, End Gateway, End Island

Structures are sorted by distance from the viewport center; click any to fly to it.

### Overlays
- **Slime chunks** — Overworld slime chunk grid
- **Ore veins** — copper and iron ore vein probability per chunk (1.18+)
- **Cave entrances** — marks chunk columns with significant cave openings
- **Local difficulty** — per-chunk special difficulty multiplier based on inhabited time, world time, and game difficulty
- **Chunk grid** — 16×16 chunk boundary overlay
- **Inhabited time** — color-coded per-chunk inhabited time

### Markers
- **Block entities** — chests (with loot tier badges), spawners, signs, beehives, beacons, banners, and more; visible at zoom ≥ 5
- **Entities** — villagers (with trades), horses, pets, bosses, container entities, and any named mob; visible at zoom ≥ 5
- **POI** — beds, workstations, bells, and other points of interest
- **Pins** — drop custom markers with Ctrl+click; labels editable; optional cross-dimensional OW↔Nether projection per pin
- **Player marker** — last known in-game position; updates on world save
- **Spawn marker** — world spawn point with optional spawn radius overlay

### Other
- **Dimensions** — Overworld, Nether, End; Nether coordinates shown at 1:8 scale
- **Ruler tool** — click two points to measure block distance
- **Day/Night bar** — sky-color gradient showing the current in-game time of day
- **TIFF export** — full-resolution world map rendered directly from world files; configurable blocks-per-pixel
- **Cursor info bar** — block name, biome, Y coordinate, and local difficulty at the cursor

---

## Prerequisites

### Windows

1. **Visual Studio Build Tools 2022** — required to compile Rust and the bundled C/C++ libraries (cubiomes, LevelDB, Snappy). Download from [visualstudio.microsoft.com](https://visualstudio.microsoft.com/visual-cpp-build-tools/) and select the **Desktop development with C++** workload.
2. **Rust** — download and run `rustup-init.exe` from [rustup.rs](https://rustup.rs). Defaults to the MSVC toolchain, which is correct.
3. **Node.js 18+** — download the installer from [nodejs.org](https://nodejs.org).
4. **WebView2** — pre-installed on Windows 10 (1803+) and Windows 11. If missing, download from [Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/).

> WSL is **not** required. Everything builds natively on Windows.

### macOS

1. **Xcode Command Line Tools** — provides the C/C++ compiler needed for the native libraries:
   ```bash
   xcode-select --install
   ```
2. **Rust**:
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```
3. **Node.js 18+** — download the macOS installer (`.pkg`) from [nodejs.org](https://nodejs.org).

### Linux (Debian/Ubuntu)

1. **Rust**:
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```
2. **Node.js 18+** — via your package manager or [nodejs.org](https://nodejs.org).
3. **Tauri system dependencies**:
   ```bash
   sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
   ```

For other distros see the [Tauri prerequisites guide](https://tauri.app/start/prerequisites/).

---

## Installation

```bash
git clone --recurse-submodules https://github.com/yourname/minecraft-sojourner.git
cd minecraft-sojourner
npm install
```

If already cloned without `--recurse-submodules`:
```bash
git submodule update --init --recursive
```

---

## Running

```bash
npm run dev      # development (Tauri + Vite hot reload)
npm run build    # production build → src-tauri/target/release/bundle/
```

---

## Controls

| Action | How |
|---|---|
| Pan | Click and drag |
| Zoom | Scroll wheel |
| Coordinates | Hover — shown bottom-right; click to copy X Z |
| Copy seed | Click the seed value in the sidebar |
| Jump to player | Press `P` or click **Go to player** |
| Drop a pin | Ctrl+click on the map |
| Rename a pin | Click the pin label in the Markers panel |
| Jump to coordinates | Type X/Z in the Go to Coordinates panel and press Enter |
| Open world | Ctrl+O |
| Toggle biome map | `B` |
| Toggle hide water | `H` |
| Toggle slime chunks | `S` (Overworld only) |
| Toggle cave mode | `C` (requires open world with known player Y) |
| Focus coordinate input | `G` |

---

## Troubleshooting

**Blank map / no biomes**
cubiomes is built via `build.rs` during `cargo build`. Check the Rust build output for C compilation errors.

**Map doesn't update after saving**
Verify the app is watching the correct world. The file watcher uses a short debounce to wait for the game to finish writing.

**Structures show wrong positions**
For Java worlds: ensure the Minecraft version in the sidebar matches the world's actual version. For 1.21.5+ worlds, version detection is automatic. For Bedrock: expected — see the Bedrock limitations section above.

**Block entities / entities not showing**
Only visible at zoom level 5 or higher. Requires an open world file (not seed-only mode).

**Player marker not showing**
Player position is saved in `level.dat` only on session end or auto-save. The marker only appears when the map dimension matches the player's current dimension.

**Bedrock world not opening**
Requires the LevelDB and Snappy submodules — clone with `--recurse-submodules`.
