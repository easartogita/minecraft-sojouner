# Sojourner

A desktop map viewer for Minecraft — except it doesn't stop at the map. Every chest and what's actually in it, every villager and their trades, every structure your seed will ever generate, real ore veins, real block colors — all read straight from the world files and laid out together. It's more of your own save, at once, than you've ever actually been able to see. Supports both **Java** and **Bedrock** editions. The map refreshes automatically whenever the world saves. Worlds can also be baked to a self-contained static website for sharing.

**[Download a build](https://sojourner.1048576.net/#get)** · **[Try it live, no install](https://sojourner.1048576.net/#demos)** · **[See how it compares](https://sojourner.1048576.net/comparison.html)** to other Minecraft map tools — all at [sojourner.1048576.net](https://sojourner.1048576.net). Prefer to build it yourself? Jump to [Building from source](#building-from-source).

> Sojourner is an unofficial, fan-made tool. It is **not** affiliated with, endorsed by, or associated with Mojang Studios or Microsoft. *Minecraft* is a trademark of Mojang Studios.

---

## Bedrock edition — what's different

Sojourner reads Bedrock worlds directly, and most of it is spot-on: real block colors, cave mode, block entities, entities, POI, ore veins, slime chunks, TIFF export, and the website export all work correctly. Two things don't, because the engine behind them only understands **Java Edition's** world generation:

- **Biome map** — at low zoom, the colored terrain map is generated with Java's algorithm. On a Bedrock world, treat it as an approximate guide to the terrain, not an exact match.
- **Structures** — predicted structure locations use Java's seed and placement rules. Bedrock uses different ones, so most predicted positions will be wrong.

(Local difficulty and the command-line export tool are Java-only for now; everything else works the same on both editions.)

---

## Interface

The left edge is an icon **rail** with six collapsible panels:

- **World** — open/recent worlds, dimension, version, world settings, TIFF export, static site export
- **Layers** — all map overlays, grouped into Surface and Underground, with per-layer opacity
- **Seed** — the seed value (click to copy), manual/seed-only world entry, and a distance-sorted "nearby" list of every predicted structure; click one to fly to it
- **World Data** — entities, block entities, and POI (from the save), custom marker groups, and the marker/cave depth Y-window
- **Saved** — dropped pins and saved routes
- **Settings** — appearance, UI scale, and behavior

The map itself has a right-click context menu (copy coords, copy `/tp`, cross-dimension coords, center here, drop a pin, start/extend a route, pin the best nearby copper/iron vein) and floating readouts: a cursor info bar, a day/night bar, and a vertical Y-range gauge.

Layers with a minimum render zoom (Markers, Ore Veins, Ore Deposits) show a small "zoom ≥ N" badge next to their toggle that reflects whether they're actually visible right now — muted when off, amber when enabled but too zoomed out to render anything, green once you're zoomed in enough.

---

## Features

### World support
- **Java Edition** — reads `.mca` region files directly
- **Bedrock Edition** — reads LevelDB (`db/`) with Snappy decompression; auto-detected from the world directory
- **Auto-load** — pass `--level-dat=<path>` on the command line to open a world at startup
- **Drag & drop** — drop a `level.dat` or world folder onto the window
- **Recent worlds** — quick-access list sorted by last modified
- **Seed-only mode** — enter a seed manually without opening a world file
- **World type support** — Default, Large Biomes, Amplified, Flat, Single Biome, Custom (auto-detected)

### Map rendering
- **Biome map** — colored terrain map at low zoom for Overworld, Nether, and End, with realistic hillshading from actual terrain noise (Overworld and End) *(Java accurate; Bedrock approximate — see above)*
- **Real block colors** — at zoom ≥ 3 by default (adjustable in Settings), reads the actual blocks from your world files, with hillshading and water depth tinting
- **Cave mode** — underground block colors at a configurable Y depth with adjustable scan window; zoom is restricted to a per-dimension range while active, and springs back to it if you scroll/pinch past the edge instead of hard-blocking
- **Underground biomes** — biome colors for a subsurface Y slice (a mode of the biome layer)
- **Tile cache** — rendered tiles cached to disk as PNGs; invalidated automatically on world save
- **Tile pre-generation** — pre-render all tiles for a configurable radius around spawn so subsequent viewport loads are near-instant

### Structures *(Java accurate; Bedrock approximate — see above)*
Every structure Sojourner can predict, with labels, loot summaries, and variant annotations:

**Overworld** — Village, Stronghold, Woodland Mansion, Ocean Monument, Witch Hut, Pillager Outpost, Desert Temple, Jungle Temple, Igloo, Shipwreck, Ruined Portal, Ancient City, Trial Chambers, Trail Ruins, Abandoned Camp, Ocean Ruins, Desert Well, Buried Treasure, Mineshaft, Amethyst Geode

**Nether** — Nether Fortress, Bastion Remnant, Ruined Portal

**End** — End City, End Gateway, End Island

The Seed panel lists them sorted by distance from the player (or origin), grouped by type with per-variant filtering; click any to fly to it.

All toggleable from the **Layers** panel, grouped Surface / Underground, each with adjustable opacity.

- **Slime chunks** — Overworld slime chunk grid
- **Ore veins** — copper and iron ore vein footprint per chunk (1.18+), real per-column generation at zoom ≥ 5
- **Ore deposits** — individual ore deposits (diamond, gold, redstone, and others) plotted from accurate worldgen; high zoom only, live app only
- **Caves & ravines** — carver footprints (cave and ravine columns) from worldgen
- **Local difficulty** — per-chunk special difficulty multiplier based on inhabited time, world time, and game difficulty
- **Chunk grid** — 16-block chunk boundary overlay
- **Region grid** — 512-block region (`.mca`) boundary overlay
- **Spawn radius** — 24-block no-spawn and 128-block despawn radius around the *player* (mob spawning/despawning, not the world spawn point)
- **Spawn chunks** — the always-loaded (2r+1)² chunk square around world spawn, from the `spawnChunkRadius` gamerule (Overworld only)
- **World border** — the save's configured world border, enforced identically in Overworld and Nether block coordinates; hidden when untouched from vanilla's default

The **Chunk Data** (block-color) layer also outlines which region files actually exist on disk — i.e. where the world has been explored.

### Markers

Read from the save (in the **World Data** panel):
- **Block entities** — chests (with loot tier badges), spawners, signs, beehives, beacons, banners, and more; visible at zoom ≥ 3 by default (adjustable in Settings)
- **Entities** — villagers (with trades), horses, pets, bosses, container entities, and any named mob; visible at zoom ≥ 3 by default (adjustable in Settings)
- **POI** — beds, workstations, bells, and other points of interest
- **Custom marker groups** — define named, color-coded groups of block-entity and entity types to toggle together
- **Y-window** — a vertical Y-range gauge scopes which save markers show by depth; can lock to live player Y or freeze at a chosen Y

Placed by you (in the **Saved** panel):
- **Pins** — drop custom markers with Ctrl+click or the right-click menu; labels editable; optional cross-dimensional OW↔Nether projection per pin
- **Saved routes** — name and store planned routes to reload later

Always on:
- **Player marker** — last known in-game position; updates on world save
- **Player respawn marker** — each player's bed/respawn-anchor point, when set, shown only in the dimension it's in
- **Spawn marker** — the world's actual spawn point (from `level.dat`, reflects `/setworldspawn`); also shows the seed's predicted default spawn as a second marker when it differs

### Static site export
- **Export as website** (World panel) — bakes a self-contained folder of PNG tiles + JSON that runs in any browser, no Sojourner backend required. Pick which dimensions and tile layers to include (biome, underground biome, block-color with/without water, cave mode with baked Y presets, ore veins, carvers, local difficulty); structures, block entities, entities, POI, and custom marker groups are always included. Every zoom level is pre-rendered ahead of time — nothing is generated live in the browser. Works for both Java and Bedrock worlds.
- **Headless export CLI** (`export_cli`) — runs the same export pipeline with no GUI, for scripted or CI exports. Java worlds only for now. From `src-tauri/`:
  ```bash
  cargo run --release --bin export_cli -- --world <name-or-path> --output <dir> [--dimensions overworld,nether,end] [--layers biome,chunk,...]
  ```
  Run with `--help` for the full flag list.

### Other
- **Dimensions** — Overworld, Nether, End; Nether coordinates shown at 1:8 scale
- **Route planner** — chain waypoints into a route and read per-leg and total block distance, nether-equivalent distance, and estimated travel time. Each leg has a travel mode (on foot, boat, mounted, elytra, spectator, nether highway); on-foot and boat legs are auto-split by biome so open water and frozen/snowy terrain are timed at their real speeds. Routes can be saved and reloaded.
- **Cave depth gauge** — floating vertical Y-range gauge controlling cave-mode scan depth and the marker Y-window, with a lock that follows the live player Y
- **Day/Night bar** — sky-color gradient showing the current in-game time of day
- **TIFF export** — full-resolution world map rendered directly from world files; configurable blocks-per-pixel
- **Cursor info bar** — block name, biome, Y coordinate, and local difficulty at the cursor

---

## Multiplayer proxy *(planned — not yet implemented)*

> **Not in the current build.** There's no proxy code, no panel for it, and no live multiplayer support yet. This is a roadmap item, documented ahead of time so the design (and the privacy/security thinking behind it) is out in the open.

The idea: a **Proxy** panel that lets Sojourner watch a live multiplayer session as it happens — chat, player positions, chunk data — by quietly sitting between your Minecraft client and the server you're connecting to, without touching or altering any of the traffic that passes through.

Some ground rules the design commits to, regardless of how it's eventually built:

- Your Minecraft client only ever talks to Sojourner on your own machine — that connection never leaves your computer.
- Sojourner passes every packet through unchanged; it reads along the way but never modifies anything, so the server can't tell it's there.
- Nothing about your session gets logged to disk or sent to any external service. There is no Sojourner-run server anywhere in the picture — everything happens locally on your machine.
- Sojourner never stores your Microsoft account password. Signing in (once implemented) happens through Microsoft's own login page in your browser; Sojourner only ever holds the short-lived token Microsoft hands back.

Offline-mode and LAN servers are the first target once this gets built; official (online-mode) servers will follow once the login/encryption handshake is implemented.

---

## Building from source

Most players don't need this section — grab a [prebuilt download](https://sojourner.1048576.net/#get) instead. This is for people who want to build Sojourner themselves, tinker with it, or run it on a platform without a prebuilt release.

### Prerequisites

#### Windows

1. **Visual Studio Build Tools 2022** — required to compile Rust and the bundled C/C++ libraries (cubiomes, LevelDB, Snappy). Download from [visualstudio.microsoft.com](https://visualstudio.microsoft.com/visual-cpp-build-tools/) and select the **Desktop development with C++** workload.
2. **Rust** — download and run `rustup-init.exe` from [rustup.rs](https://rustup.rs). Defaults to the MSVC toolchain, which is correct.
3. **Node.js 18+** — download the installer from [nodejs.org](https://nodejs.org).
4. **WebView2** — pre-installed on Windows 10 (1803+) and Windows 11. If missing, download from [Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/).

> WSL is **not** required. Everything builds natively on Windows.

#### macOS

1. **Xcode Command Line Tools** — provides the C/C++ compiler needed for the native libraries:
   ```bash
   xcode-select --install
   ```
2. **Rust**:
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```
3. **Node.js 18+** — download the macOS installer (`.pkg`) from [nodejs.org](https://nodejs.org).

> There's no signed/notarized build yet (that needs a paid Apple Developer account), so macOS will flag the `.app` you build as being from an unidentified developer the first time you open it. Right-click the app → **Open** → **Open** again on the warning dialog, or run `xattr -cr` on it, to get past that once.

#### Linux (Debian/Ubuntu)

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

### Installation

```bash
git clone --recurse-submodules https://github.com/easartogita/minecraft-sojouner.git
cd minecraft-sojouner
npm install
```

If already cloned without `--recurse-submodules`:
```bash
git submodule update --init --recursive
```

### Running

```bash
npm run dev      # development (Tauri + Vite hot reload)
npm run build    # production build → src-tauri/target/release/bundle/
```

**Blank map / no biomes after building?** The terrain-generation engine compiles as a native library during `cargo build` (triggered automatically by `npm run dev`/`build`). Check the Rust build output for C compilation errors.

---

## Controls

| Action | How |
|---|---|
| Pan | Click and drag |
| Zoom | Scroll wheel |
| Coordinates | Hover — shown bottom-right; click to copy X Z |
| Context menu | Right-click the map or a marker |
| Copy seed | Click the seed value in the Seed panel |
| Jump to player | Press `P` or click **Go to player** |
| Drop a pin | Ctrl+click on the map, or right-click → **Add pin** |
| Rename a pin | Click the pin label in the Saved panel |
| Jump to coordinates | Type X/Z in the Go to Coordinates panel and press Enter |
| Open world | Ctrl+O |
| Toggle biome map | `B` |
| Toggle hide water | `H` |
| Toggle slime chunks | `S` (Overworld only) |
| Toggle cave mode | `C` (requires open world with known player Y) |
| Toggle chunk data | `D` |
| Toggle ore veins | `V` (footprint mode; 1.18+ Overworld) |
| Toggle route planner | `R` |
| Focus coordinate input | `G` |

---

## Troubleshooting

**Map doesn't update after saving**
Verify the app is watching the correct world. The file watcher uses a short debounce to wait for the game to finish writing.

**Structures show wrong positions**
For Java worlds: ensure the Minecraft version in the World panel matches the world's actual version. For 1.21.5+ worlds, version detection is automatic. For Bedrock: expected — see the Bedrock limitations section above.

**Block entities / entities not showing**
Only visible at zoom level 3 or higher by default (configurable in Settings). Requires an open world file (not seed-only mode).

**Player marker not showing**
Player position is saved in `level.dat` only on session end or auto-save. The marker only appears when the map dimension matches the player's current dimension.

**Bedrock world not opening**
If you built Sojourner yourself, make sure you cloned with `--recurse-submodules` (see [Building from source](#building-from-source)) — Bedrock support needs the LevelDB and Snappy submodules.
