# Web-serving architecture (speculation)

> Status: speculative design, not yet implemented. Captures the agreed direction for
> running Sojourner's engine alongside a live Minecraft server and serving the map to the
> public web, while keeping the desktop app working.
>
> Chosen direction: **public live map · co-located on the server host · shared core crate.**

## Context

Today Sojourner is a single-user Tauri desktop app: a Rust core does all world reading and
rendering, and a React/Leaflet frontend talks to it over Tauri IPC. The goal is running the
same engine **co-located with a live Minecraft server** and **serving the map to the public
web** (many concurrent viewers, like a live DynMap/Bloom), while keeping the desktop app.

### Why this is largely already feasible
- **Live reads are already safe.** `region_reader.rs` reads whole `.mca` regions as a
  snapshot and embeds the source `mca-mtime` into each cached PNG; stale tiles self-heal.
  Nothing assumes exclusive access to the save (`src-tauri/src/lib.rs:25-63`,
  `tile_renderer.rs` freshness check).
- **Live-update plumbing exists.** `file_watcher.rs` already watches `level.dat`,
  `playerdata/`, and region dirs, emitting `seed:changed` / `region:changed` (with
  `(rx,rz)` coords). The frontend already invalidates affected tiles via `changedRegions`.
- **One IPC seam.** Every backend call funnels through `src/renderer/lib/tauriAPI.ts`
  (~30 `invoke` commands + 7 `listen` events). Swapping transport is a single-file concern.
- **The core is modular.** Readers (`region_reader`, `bedrock/*`, `entity_reader`,
  `block_entity_reader`, `poi_reader`, `nbt_reader`, `slime`), `cubiomes/*`, and
  `tile_renderer` are already separable from Tauri glue.

## Recommended architecture

### 1. Cargo workspace with a shared core crate
- **`crates/sojourner-core`** — all heavy lifting, no Tauri types. Move the modules above
  plus the *pure* logic currently embedded in `lib.rs` commands (chunk-color compute, tile
  render + freshness, structure finding, slime, ore/carver/terrain queries). Core functions
  take plain args and return the existing `#[serde(rename_all = "camelCase")]` structs.
- **`src-tauri`** (existing binary) — thin `#[tauri::command]` wrappers that call core +
  own the Tauri-only concerns: file dialogs, `asset://` (`convertFileSrc`), event emission,
  managed state (`BedrockDbCache`, `WatchStateMutex`, `TileRenderSemaphore`, `ExportCancel`).
- **`crates/sojourner-web`** — new `axum` binary that depends on core.

The refactor is mostly mechanical: today's commands already delegate to module functions
(`lib.rs:710-765`). The work is separating "Tauri glue (State/AppHandle/emit)" from
"pure compute" and relocating the latter.

### 2. The web binary (`sojourner-web`, axum + tokio)
- **REST routes mirroring the command surface.** One handler per core function:
  `POST /api/structures`, `POST /api/entities`, `POST /api/block-entities`, `POST /api/poi`,
  `POST /api/slime`, `GET /api/seed`, etc. Reuse the same request/response structs.
- **Tile endpoints, render-on-demand, streamed bytes.**
  - `GET /tiles/biome/{seedHex}/{dim}/{y}/{z}/{x}.png`
  - `GET /tiles/block/{dim}/{z}/{x}/{y}.png?hideWater=&caveY=…`
  Reuse `tile_renderer` + the existing on-disk cache. Return `ETag`/`Last-Modified` from the
  embedded `mca-mtime` so a reverse proxy/CDN caches and revalidates cheaply.
- **Live push via SSE** (`GET /events`): fan the watcher's `seed:changed` / `region:changed`
  out to all connected browsers. Reuse `file_watcher` logic, replacing `app.emit(...)` with a
  `tokio::sync::broadcast` channel drained per SSE connection.
- **Static hosting**: serve the built React bundle from the same binary (or hand off to the
  reverse proxy).
- **Config**: the world directory to serve is set by config/env (not a file dialog).

### 3. Frontend: transport abstraction behind the existing seam
Introduce a `Transport` interface in `tauriAPI.ts` with two implementations:
- `tauriTransport` — current `invoke` / `listen` / `convertFileSrc`.
- `httpTransport` — `fetch` to REST routes, `EventSource` for `/events`, tile URLs point
  straight at `/tiles/...` (Leaflet `<img>` src, no `asset://`).

Select at runtime via `window.__TAURI__` presence (or a build flag). In web mode, file
dialogs / `tauri://file-drop` become no-ops; `EmptyState` either auto-loads the configured
world or offers seed-only manual entry. Leaflet, every overlay layer, and all TS interfaces
are reused untouched.

### 4. Public-scale hardening (the real work, driven by `CUBIOMES_LOCK`)
All cubiomes FFI is globally serialized (`cubiomes/mod.rs:6`). For many concurrent viewers:

- **Lean on immutability.** One shared world ⇒ one shared cache. Biome tiles and structure
  results are seed-deterministic and never change → render once, cache with a long/immutable
  TTL, front with a CDN. This removes cubiomes from the hot path for repeat views.
- **Request coalescing.** Dedupe identical in-flight tile renders so a thundering herd
  collapses to one cubiomes call (e.g. an in-flight `HashMap<TileKey, Shared<Future>>`).
- **Bounded queues + per-IP rate limiting** at the axum/proxy layer; keep the existing
  semaphore idea for `.mca` I/O.
- **Pre-warm** popular zooms and the explored footprint on startup and on `region:changed`,
  so block tiles are usually served warm.
- Block tiles (real `.mca`) change as the server autosaves; they're already keyed by
  world+mtime, so cache + SSE-driven invalidation (bump `?v=mtime`) keeps them fresh.

### 5. Deployment
`systemd` service on the MC host, read-only access to the world save dir; Caddy/nginx for
TLS + static + CDN-frontable `/tiles`. No server mod required.

## Critical files
- Extract → core: `src-tauri/src/{region_reader,nbt_reader,entity_reader,block_entity_reader,poi_reader,slime,tile_renderer,block_colors}.rs`, `src-tauri/src/cubiomes/*`, `src-tauri/src/bedrock/*`, and the pure bodies of commands in `src-tauri/src/lib.rs`.
- Reuse as-is for live push: `src-tauri/src/file_watcher.rs` (swap `app.emit` → broadcast channel).
- New: `crates/sojourner-web/` (axum routes, SSE, tile streaming, static serving, config).
- Frontend seam: `src/renderer/lib/tauriAPI.ts` (add `Transport` + `httpTransport`);
  touch points in `BiomeTileLayer.tsx` / `ChunkOverlayLayer.tsx` (tile URL source) and
  `useSeed.ts` (events → `EventSource`).

## Risks / open considerations
- **Bedrock LevelDB is single-writer.** A *running* Bedrock server holds the DB; a
  co-located reader (`bedrock/leveldb_ffi.rs`) may hit a lock. Java `.mca` has no such
  problem (concurrent reads fine). For live Bedrock, plan on read-only/snapshot open or
  accept reading only when the server isn't holding the lock. Flag before committing to
  Bedrock support on the public map.
- **Bedrock biome/structure data is approximate** (cubiomes implements Java algos only —
  see CLAUDE.md). A public Bedrock map shows wrong biomes/structures; set expectations or
  restrict the public map to Java worlds initially.
- **cubiomes version must match the server's MC version** for correct generation
  (submodule is `xpple/cubiomes`, pinned to 26.2).
- **Live player position** from save files lags to autosave cadence. If real-time player
  dots matter, source position from the server (RCON `/data get` or a small plugin) as an
  optional add-on — out of scope for the core web port.

## Verification (when built)
- Run `sojourner-web` against a copy of a live Java world dir; confirm `/tiles/...` renders
  match the desktop app for the same tiles.
- Start a Minecraft server on the same host, explore new chunks, confirm an SSE
  `region:changed` arrives and the browser repaints the affected tiles (compare `mca-mtime`).
- Load-test concurrent tile requests; confirm request coalescing keeps cubiomes calls
  bounded and the CDN serves immutable biome tiles without hitting the lock.
- Confirm the desktop Tauri app still builds and behaves identically after the core extraction
  (`npm run build` + smoke-test via the `run-app` skill).
