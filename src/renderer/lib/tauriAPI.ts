import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getVersion } from '@tauri-apps/api/app'
import type {
  SavesWorldEntry, RegionChange, RenderedTile, ChunkInfo, ExportParams,
  CaveRangePreset, StaticExportParams, StaticExportProgress, StructurePos, StructureHit,
  EnchantmentInfo, LootItem, ChestSlot, GatewayLink, McaMetricsExtended, OverlayTileKind, TileSizes,
  OreVeinColumn, CopyRegionsReport, CopyChunksReport, CopyBlocksReport, SavedTemplateInfo,
} from './tauriAPI.types'

export type {
  SavesWorldEntry, RegionChange, RenderedTile, ChunkInfo, ExportParams,
  CaveRangePreset, StaticExportParams, StaticExportProgress, StructurePos, StructureHit,
  EnchantmentInfo, LootItem, ChestSlot, GatewayLink, OverlayTileKind, TileSizes,
  OreVeinColumn, CopyRegionsReport, CopyChunksReport, CopyBlocksReport, SavedTemplateInfo,
} from './tauriAPI.types'

/** False here, true in tauriAPI.static.ts — the one flag distinguishing live-world
 *  mode from booted-from-manifest.json mode, kept in this seam instead of a
 *  separate build flag so there's exactly one thing to stay in sync. */
export const IS_STATIC_SITE = false

export function getAppVersion(): Promise<string> {
  return getVersion()
}

/** Static-site-only: booting from an exported bundle instead of a real
 *  world, so there's no level.dat to read — never called in the live app
 *  (gated by IS_STATIC_SITE), kept here only so the module shapes match. */
export function getStaticWorldSeedData(): Promise<{ path: string; data: SeedData } | null> {
  return Promise.resolve(null)
}

/** Static-site-only: the live app computes its presets directly from
 *  defaultCaveRangePresets(dimension) — no manifest to read them from —
 *  never called here, kept only so the module shapes match. */
export function getCaveRangePresets(_dimension: string): Promise<CaveRangePreset[]> {
  return Promise.resolve([])
}

/** Static-site-only: these overlays render from raw per-chunk arrays in the
 *  live app (getOreVeinColumns/generateOreFeatures/getCarvedColumns/
 *  getLocalDifficulties + overlayTileWorker.ts) — never called here, kept
 *  only so the module shapes match. */
export function renderOverlayTile(
  _kind: OverlayTileKind, _dimension: string, _tileX: number, _tileY: number, _zoom: number,
): Promise<RenderedTile | null> {
  return Promise.resolve(null)
}

/** Static-site-only: live components already know their own tile size (the
 *  BIOME_TILE_SIZE/TILE_SIZE constants in constants.ts) — never called here,
 *  kept only so the module shapes match. */
export function getTileSizes(_dimension: string): TileSizes {
  return {}
}

/** Turns a tile's on-disk path (as returned by renderTile/renderBiomeTile/etc.)
 *  into a URL the webview can load. The static-site build aliases this whole
 *  module to a counterpart that returns tile paths as-is (already relative
 *  URLs into the exported bundle) — every other Tauri touchpoint in the
 *  renderer funnels through this file for exactly that reason. */
export function tileSrc(path: string): string {
  return convertFileSrc(path)
}

// ── Level.dat / seed ──────────────────────────────────────────────────────────

export function selectLevelDat(): Promise<string | null> {
  return invoke<string | null>('select_level_dat')
}

export function selectWorldDir(): Promise<string | null> {
  return invoke<string | null>('select_world_dir')
}

export function listSavesWorlds(): Promise<SavesWorldEntry[]> {
  return invoke<SavesWorldEntry[]>('list_saves_worlds')
}

export function readSeed(path: string): Promise<SeedData> {
  return invoke<SeedData>('read_level_dat', { path })
}

export function readDayTime(path: string): Promise<number | null> {
  return invoke<SeedData>('read_level_dat', { path }).then(d => d.dayTime ?? null)
}

export function watchLevelDat(levelDatPath: string): Promise<void> {
  return invoke('watch_world', { levelDatPath })
}

/** Returns { path, data } if the app was launched with --level-dat=<path>, else null. */
export function getAutoLoadData(): Promise<[string, SeedData] | null> {
  return invoke<[string, SeedData] | null>('get_auto_load_data')
}

// ── Event listeners ───────────────────────────────────────────────────────────

export function onSeedChanged(cb: (data: SeedData) => void): () => void {
  let unlisten: UnlistenFn | undefined
  listen<SeedData>('seed:changed', e => cb(e.payload)).then(fn => { unlisten = fn })
  return () => { unlisten?.() }
}

export function onSeedError(cb: (error: string) => void): () => void {
  let unlisten: UnlistenFn | undefined
  listen<string>('seed:error', e => cb(e.payload)).then(fn => { unlisten = fn })
  return () => { unlisten?.() }
}

export function onRegionChanged(cb: (change: RegionChange) => void): () => void {
  let unlisten: UnlistenFn | undefined
  listen<RegionChange>('region:changed', e => cb(e.payload)).then(fn => { unlisten = fn })
  return () => { unlisten?.() }
}

export function onMcaMetrics(cb: (m: McaMetrics) => void): () => void {
  let unlisten: UnlistenFn | undefined
  listen<McaMetrics>('metrics:mca', e => cb(e.payload)).then(fn => { unlisten = fn })
  return () => { unlisten?.() }
}

/** OS-level file drop onto the window (dropping a level.dat/world folder to
 *  load it) — a native Tauri event, not a DOM 'drop' event. */
export function onFileDrop(cb: (paths: string[]) => void): () => void {
  let unlisten: UnlistenFn | undefined
  listen<string[]>('tauri://file-drop', e => cb(e.payload)).then(fn => { unlisten = fn })
  return () => { unlisten?.() }
}

// ── Tile rendering ────────────────────────────────────────────────────────────

export function renderBiomeTile(
  slot: number, seed: bigint, mcVersion: number, worldFlags: number, dimension: string,
  tileX: number, tileY: number, zoom: number,
): Promise<RenderedTile | null> {
  const { seedLow, seedHigh } = splitSeed(seed)
  return invoke<[string, number] | null>('render_biome_tile', {
    slot, seedLow, seedHigh, mcVersion, worldFlags, dimension, tileX, tileY, zoom,
  }).then(res => res ? { path: res[0], mtime: res[1] } : null)
}

/** Unified "underground" biome view — server-rendered and disk-cached like
 * renderBiomeTile, scanning multiple Y levels per column bounded by the real
 * terrain surface. Overworld-only; returns null for other dimensions. */
export function renderUndergroundBiomeTile(
  slot: number, seed: bigint, mcVersion: number, worldFlags: number, dimension: string,
  tileX: number, tileY: number, zoom: number,
): Promise<RenderedTile | null> {
  const { seedLow, seedHigh } = splitSeed(seed)
  return invoke<[string, number] | null>('render_underground_biome_tile', {
    slot, seedLow, seedHigh, mcVersion, worldFlags, dimension, tileX, tileY, zoom,
  }).then(res => res ? { path: res[0], mtime: res[1] } : null)
}

export function renderTile(
  worldDir: string, edition: string, dimension: string,
  tileX: number, tileY: number, zoom: number,
  hideWater: boolean, caveY: number | null,
  caveScanLow: number, caveScanHigh: number,
): Promise<RenderedTile | null> {
  // Backend returns a (path, mtime) tuple, serialised as a 2-element array.
  return invoke<[string, number] | null>('render_tile', {
    worldDir, edition, dimension, tileX, tileY, zoom,
    hideWater, caveY, caveScanLow, caveScanHigh,
  }).then(res => res ? { path: res[0], mtime: res[1] } : null)
}

/** Cheap probe: max mtime (epoch secs) of the source files feeding a tile.
 *  Used to revalidate in-memory cached tiles against live region rewrites. */
export function tileSourceMtime(
  worldDir: string, edition: string, dimension: string,
  tileX: number, tileY: number, zoom: number,
): Promise<number> {
  return invoke<number>('tile_source_mtime', {
    worldDir, edition, dimension, tileX, tileY, zoom,
  })
}

export function getBlockAt(
  worldDir: string, edition: string, dimension: string,
  hideWater: boolean, caveY: number | null,
  caveScanLow: number, caveScanHigh: number,
  blockX: number, blockZ: number,
  gameDifficulty?: number, worldTime?: number,
): Promise<ChunkInfo | null> {
  return invoke<ChunkInfo | null>('get_block_at', {
    worldDir, edition, dimension, hideWater, caveY, caveScanLow, caveScanHigh, blockX, blockZ,
    gameDifficulty: gameDifficulty ?? null,
    worldTime:      worldTime      ?? null,
  })
}

export function isSlimeChunk(seed: bigint, cx: number, cz: number): Promise<boolean> {
  const { seedLow, seedHigh } = splitSeed(seed)
  return invoke<boolean>('is_slime_chunk', { seedLow, seedHigh, cx, cz })
}

export function getSlimeChunks(
  seed: bigint,
  cx0: number, cz0: number, cx1: number, cz1: number,
): Promise<boolean[]> {
  const { seedLow, seedHigh } = splitSeed(seed)
  return invoke<boolean[]>('get_slime_chunks', { seedLow, seedHigh, cx0, cz0, cx1, cz1 })
}

export function getLocalDifficulties(
  worldDir: string, dimension: string,
  cx0: number, cz0: number, cx1: number, cz1: number,
  gameDifficulty: number, worldTime: number,
): Promise<number[]> {
  return invoke<number[]>('get_local_difficulties', {
    worldDir, dimension, cx0, cz0, cx1, cz1, gameDifficulty, worldTime,
  })
}

export function getInhabitedTimes(
  worldDir: string, dimension: string,
  cx0: number, cz0: number, cx1: number, cz1: number,
): Promise<number[]> {
  return invoke<number[]>('get_inhabited_times', { worldDir, dimension, cx0, cz0, cx1, cz1 })
}

export function getBlockEntities(
  worldDir: string, edition: string, dimension: string,
  minCx: number, minCz: number, maxCx: number, maxCz: number,
): Promise<BlockEntity[]> {
  return invoke<BlockEntity[]>('get_block_entities_cmd', {
    worldDir, edition, dimension, minCx, minCz, maxCx, maxCz,
  })
}

export function getEntities(
  worldDir: string, edition: string, dimension: string,
  minCx: number, minCz: number, maxCx: number, maxCz: number,
): Promise<GameEntity[]> {
  return invoke<GameEntity[]>('get_entities_cmd', {
    worldDir, edition, dimension, minCx, minCz, maxCx, maxCz,
  })
}

export function getPoi(
  worldDir: string, edition: string, dimension: string,
  minCx: number, minCz: number, maxCx: number, maxCz: number,
): Promise<PoiRecord[]> {
  return invoke<PoiRecord[]>('get_poi_cmd', {
    worldDir, edition, dimension, minCx, minCz, maxCx, maxCz,
  })
}

// ── Export ────────────────────────────────────────────────────────────────────

export function listRegions(worldDir: string, edition: string, dimension: string): Promise<[number, number][]> {
  return invoke<[number, number][]>('list_regions', { worldDir, edition, dimension })
}

export function selectExportPath(defaultName: string): Promise<string | null> {
  return invoke<string | null>('select_export_path', { defaultName })
}

// ── Structure copy (dev-only) ────────────────────────────────────────────────
// Rust command is #[cfg(debug_assertions)]'d out of release builds; the UI entry
// point is import.meta.env.DEV-gated so it's never actually reachable there.

export function copyRegions(
  srcLevelDatPath: string, srcDimension: string,
  dstLevelDatPath: string, dstDimension: string,
  regions: [number, number][],
): Promise<CopyRegionsReport> {
  return invoke<CopyRegionsReport>('copy_regions', {
    srcLevelDatPath, srcDimension, dstLevelDatPath, dstDimension, regions,
  })
}

export function copyChunks(
  srcLevelDatPath: string, srcDimension: string,
  dstLevelDatPath: string, dstDimension: string,
  chunks: [number, number][], dx: number, dz: number,
  // v2: section-aligned Y-range trim. Both set → merges only the sections
  // touching [yMin, yMax] into the *existing* destination chunk instead of
  // replacing it whole; either omitted → v1's full-column relocate.
  yMin?: number, yMax?: number,
): Promise<CopyChunksReport> {
  return invoke<CopyChunksReport>('copy_chunks', {
    srcLevelDatPath, srcDimension, dstLevelDatPath, dstDimension, chunks, dx, dz,
    yMin: yMin ?? null, yMax: yMax ?? null,
  })
}

export function copyBlocks(
  srcLevelDatPath: string, srcDimension: string,
  dstLevelDatPath: string, dstDimension: string,
  srcBox: [number, number, number, number, number, number], // x0,y0,z0,x1,y1,z1
  dstOrigin: [number, number, number],                      // x,y,z
  rotationDeg: 0 | 90 | 180 | 270,
  mirror: 'x' | 'z' | null,
): Promise<CopyBlocksReport> {
  return invoke<CopyBlocksReport>('copy_blocks', {
    srcLevelDatPath, srcDimension, dstLevelDatPath, dstDimension,
    srcBox, dstOrigin, rotationDeg, mirror,
  })
}

// ── Structure templates — save/load a box selection as a portable .nbt file.
// Dialog commands mirror select_export_path/select_level_dat's two-step shape.

export function selectTemplateSavePath(defaultName: string): Promise<string | null> {
  return invoke<string | null>('select_template_save_path', { defaultName })
}

export function selectTemplateFile(): Promise<string | null> {
  return invoke<string | null>('select_template_file')
}

export function saveStructureTemplate(
  srcLevelDatPath: string, srcDimension: string,
  srcBox: [number, number, number, number, number, number],
  outPath: string,
): Promise<SavedTemplateInfo> {
  return invoke<SavedTemplateInfo>('save_structure_template', {
    srcLevelDatPath, srcDimension, srcBox, outPath,
  })
}

export function pasteStructureTemplate(
  templatePath: string,
  dstLevelDatPath: string, dstDimension: string,
  dstOrigin: [number, number, number],
  rotationDeg: 0 | 90 | 180 | 270,
  mirror: 'x' | 'z' | null,
): Promise<CopyBlocksReport> {
  return invoke<CopyBlocksReport>('paste_structure_template', {
    templatePath, dstLevelDatPath, dstDimension, dstOrigin, rotationDeg, mirror,
  })
}

export function exportWorldMap(p: ExportParams): Promise<void> {
  const { seedLow, seedHigh } = splitSeed(p.seed)
  return invoke<void>('export_world_map', {
    worldDir: p.worldDir,
    edition: p.edition,
    dimension: p.dimension,
    outputPath: p.outputPath,
    hideWater: p.hideWater,
    blocksPerPixel: p.blocksPerPixel,
    seedLow,
    seedHigh,
    mcVersion: p.mcVersion,
    worldFlags: p.worldFlags,
  })
}

export function cancelExport(): Promise<void> {
  return invoke('cancel_export')
}

export function onExportProgress(cb: (doneBiome: number, doneChunk: number, total: number) => void): () => void {
  let unlisten: UnlistenFn | undefined
  listen<{ done_biome: number; done_chunk: number; total: number }>('export:progress', e =>
    cb(e.payload.done_biome, e.payload.done_chunk, e.payload.total))
    .then(fn => { unlisten = fn })
  return () => { unlisten?.() }
}

export function onExportDone(cb: () => void): () => void {
  let unlisten: UnlistenFn | undefined
  listen<void>('export:done', () => cb()).then(fn => { unlisten = fn })
  return () => { unlisten?.() }
}

export function onExportError(cb: (msg: string) => void): () => void {
  let unlisten: UnlistenFn | undefined
  listen<string>('export:error', e => cb(e.payload)).then(fn => { unlisten = fn })
  return () => { unlisten?.() }
}

// ── Static-site export ──────────────────────────────────────────────────────────
// See src/renderer/lib/staticExport/schema.ts for the bundle shape this
// produces, and src-tauri/src/static_export.rs for the writer.

export function selectExportDir(defaultPath?: string | null): Promise<string | null> {
  return invoke<string | null>('select_export_dir', { defaultPath: defaultPath ?? null })
}

export function exportStaticSite(p: StaticExportParams): Promise<void> {
  const { seedLow, seedHigh } = splitSeed(p.seed)
  return invoke<void>('export_static_site', {
    params: {
      worldDir: p.worldDir, edition: p.edition, outputDir: p.outputDir,
      seedLow, seedHigh, mcVersion: p.mcVersion, worldFlags: p.worldFlags,
      levelName: p.levelName, dataVersion: p.dataVersion, versionName: p.versionName,
      worldType: p.worldType, difficulty: p.difficulty, worldTime: p.worldTime,
      borderCenterX: p.borderCenterX, borderCenterZ: p.borderCenterZ, borderSize: p.borderSize,
      gameRules: p.gameRules, dimensions: p.dimensions,
      includeBiomeTiles: p.includeBiomeTiles, includeUndergroundTiles: p.includeUndergroundTiles,
      includeChunkTiles: p.includeChunkTiles, includeChunkHideWaterTiles: p.includeChunkHideWaterTiles,
      caveRangePresets: p.caveRangePresets,
      includeOreVeins: p.includeOreVeins,
      includeCarvers: p.includeCarvers,
      includeLocalDifficulty: p.includeLocalDifficulty,
      rollLootFor: p.rollLootFor,
      defaultSettings: p.defaultSettings, markerGroups: p.markerGroups,
    },
  })
}

export function cancelStaticExport(): Promise<void> {
  return invoke('cancel_static_export')
}

export function onStaticExportProgress(cb: (p: StaticExportProgress) => void): () => void {
  let unlisten: UnlistenFn | undefined
  listen<StaticExportProgress>('static-export:progress', e => cb(e.payload)).then(fn => { unlisten = fn })
  return () => { unlisten?.() }
}

export function onStaticExportDone(cb: () => void): () => void {
  let unlisten: UnlistenFn | undefined
  listen<void>('static-export:done', () => cb()).then(fn => { unlisten = fn })
  return () => { unlisten?.() }
}

export function onStaticExportError(cb: (msg: string) => void): () => void {
  let unlisten: UnlistenFn | undefined
  listen<string>('static-export:error', e => cb(e.payload)).then(fn => { unlisten = fn })
  return () => { unlisten?.() }
}

// ── Cache / metrics ───────────────────────────────────────────────────────────

export function clearTilePng(worldDir: string): Promise<void> {
  return invoke('delete_tile_cache', { worldDir })
}

export function clearBiomeTilePng(seed: bigint): Promise<void> {
  const seedLow  = Number(BigInt.asIntN(32, seed))
  const seedHigh = Number(BigInt.asIntN(32, seed >> 32n))
  return invoke('clear_biome_tile_cache', { seedLow, seedHigh })
}

export function clearStructureCache(seed: bigint): Promise<void> {
  const seedLow  = Number(BigInt.asIntN(32, seed))
  const seedHigh = Number(BigInt.asIntN(32, seed >> 32n))
  return invoke('clear_structure_cache', { seedLow, seedHigh })
}

export function invalidateChunks(worldDir: string): Promise<void> {
  return invoke('invalidate_tile_cache', { worldDir })
}

export function invalidateMcaTiles(worldDir: string, regions: [number, number][]): Promise<void> {
  return invoke('invalidate_mca_tiles', { worldDir, regions })
}

export function getMcaMetrics(): Promise<McaMetricsExtended> {
  return invoke('get_mca_metrics')
}

export function resetMcaMetrics(): Promise<void> {
  return invoke('reset_mca_metrics')
}

// ── cubiomes / biome generation ───────────────────────────────────────────────

/** Split a BigInt seed into two i32s as required by the cubiomes Rust commands. */
function toI32(u: bigint): number {
  // Reinterpret an unsigned 32-bit bigint value as a signed i32
  const n = Number(u & 0xFFFFFFFFn)
  return n >= 0x80000000 ? n - 0x100000000 : n
}

function splitSeed(seed: bigint): { seedLow: number; seedHigh: number } {
  return {
    seedLow:  toI32(seed),
    seedHigh: toI32(seed >> 32n),
  }
}

export function setupGenerator(
  seed: bigint, mcVersion: number, dimension: number, flags: number
): Promise<number> {
  const { seedLow, seedHigh } = splitSeed(seed)
  return invoke<number>('cubiomes_setup_generator', { seedLow, seedHigh, mcVersion, dimension, flags })
}

/** `seed`/`dimension`/`worldFlags`/`mcVersion` must match what `slot` is
 *  currently set up for — the backend verifies this under its lock and
 *  returns the empty/zero-filled fallback if a concurrent switch repointed
 *  the slot in between (see the Carver/Terrain layers' matching guard). */
export function getBiomeRegion(
  slot: number, seed: bigint, dimension: number, worldFlags: number, mcVersion: number,
  x: number, z: number, width: number, height: number, scale: number,
): Promise<Int32Array> {
  const { seedLow, seedHigh } = splitSeed(seed)
  return invoke<{ biomes: number[]; width: number; height: number } | null>(
    'cubiomes_get_biomes', { slot, seedLow, seedHigh, dimension, worldFlags, mcVersion, x, z, width, height, scale }
  ).then(r => r ? new Int32Array(r.biomes) : new Int32Array(width * height).fill(1))
}

/** Like getBiomeRegion but queries at an explicit biome Y coordinate.
 *  y is in cubiomes biome space: Math.floor(minecraftBlockY / 4) for scale > 1. */
export function getBiomeRegionAt(
  slot: number, seed: bigint, dimension: number, worldFlags: number, mcVersion: number,
  x: number, z: number, width: number, height: number, scale: number, y: number,
): Promise<Int32Array> {
  const { seedLow, seedHigh } = splitSeed(seed)
  return invoke<{ biomes: number[]; width: number; height: number } | null>(
    'cubiomes_get_biomes_at', { slot, seedLow, seedHigh, dimension, worldFlags, mcVersion, x, z, width, height, scale, y }
  ).then(r => r ? new Int32Array(r.biomes) : new Int32Array(width * height).fill(1))
}

export function getHeightRegion(
  slot: number, seed: bigint, dimension: number, worldFlags: number, mcVersion: number,
  x: number, z: number, w: number, h: number,
): Promise<Float32Array> {
  const { seedLow, seedHigh } = splitSeed(seed)
  return invoke<number[] | null>(
    'cubiomes_get_height_region', { slot, seedLow, seedHigh, dimension, worldFlags, mcVersion, x, z, w, h }
  ).then(r => r ? new Float32Array(r) : new Float32Array(w * h).fill(0))
}

export function findAllStructures(
  seed:      bigint,
  mcVersion: number,
  dimension: string,
  worldFlags: number,
  bx0: number, bz0: number,
  bx1: number, bz1: number,
  enabled: string[],
): Promise<StructureHit[]> {
  const { seedLow, seedHigh } = splitSeed(seed)
  return invoke<StructureHit[]>('cubiomes_find_all_structures', {
    seedLow, seedHigh, mcVersion, dimension, worldFlags,
    bx0, bz0, bx1, bz1, enabled,
  })
}

/** Returns null if `slot` doesn't currently match seed/dimension/worldFlags/mcVersion
 *  (a concurrent switch repointed it) — callers should treat that as "not known yet"
 *  rather than drawing a marker at a stale/wrong (0, 0). */
export function getSpawn(
  slot: number, seed: bigint, dimension: number, worldFlags: number, mcVersion: number,
): Promise<StructurePos | null> {
  const { seedLow, seedHigh } = splitSeed(seed)
  return invoke<[number, number] | null>(
    'cubiomes_get_spawn', { slot, seedLow, seedHigh, dimension, worldFlags, mcVersion }
  ).then(r => r ? { x: r[0], z: r[1], flags: 0 } : null)
}

// Monotonic ids tagging each heavy overlay tile fetch, so it can be cancelled
// (cubiomesCancelRequest) when its tile is scrolled out of view. 0 = no token.
let reqCounter = 0
export function newRequestId(): number { return ++reqCounter }

/** Cancel a heavy overlay computation tagged with `reqId`. The Rust side bails
 *  as soon as it acquires the cubiomes lock, so abandoned tiles stop starving
 *  the tiles still on screen. Fire-and-forget. */
export function cubiomesCancelRequest(reqId: number): void {
  invoke('cubiomes_cancel_request', { reqId }).catch(() => {})
}

/** Per-column ore-vein footprint for a chunk range, using generator `slot`.
 *  The cave-layer analogue of getCarvedColumns: resolves each vein's true 3-D
 *  shape. Returns [nx, nz, then nx*nz * 256 * 2 per-column (copper,iron) counts]. */
export function getOreVeinColumns(
  slot: number, seed: bigint, dimension: number, worldFlags: number, mcVersion: number,
  cx0: number, cz0: number, cx1: number, cz1: number, reqId = 0,
): Promise<Int32Array> {
  const { seedLow, seedHigh } = splitSeed(seed)
  return invoke<number[]>('cubiomes_get_ore_vein_columns', {
    slot, seedLow, seedHigh, dimension, worldFlags, mcVersion, cx0, cz0, cx1, cz1, reqId,
  }).then(arr => new Int32Array(arr))
}

/** Ore-vein detail for the single column under the cursor (bx, bz), using
 *  generator `slot`. The hover-resolution analogue of getOreVeinColumns —
 *  same real per-block probe, but keeps each vein's Y range instead of
 *  collapsing it to a footprint count. Null when the backend has nothing
 *  (pre-1.18, or a stale/mismatched slot). */
export function getOreVeinColumnAt(
  slot: number, seed: bigint, dimension: number, worldFlags: number, mcVersion: number,
  bx: number, bz: number,
): Promise<OreVeinColumn | null> {
  const { seedLow, seedHigh } = splitSeed(seed)
  return invoke<number[]>('cubiomes_get_ore_vein_column_at', {
    slot, seedLow, seedHigh, dimension, worldFlags, mcVersion, bx, bz,
  }).then(arr => {
    if (arr.length < 6) return null
    const NONE = -2147483648 // i32::MIN sentinel
    return {
      copperCount: arr[0],
      copperMinY: arr[1] === NONE ? null : arr[1],
      copperMaxY: arr[2] === NONE ? null : arr[2],
      ironCount: arr[3],
      ironMinY: arr[4] === NONE ? null : arr[4],
      ironMaxY: arr[5] === NONE ? null : arr[5],
    }
  })
}

/** Ore-feature placement (normal ore blobs) for `oreTypes` over a chunk range,
 *  using generator `slot`. `seed`/`dimension`/`worldFlags`/`mcVersion` must match
 *  what `slot` is currently configured for — the backend verifies this and
 *  returns empty if a queued render raced ahead of an async generator
 *  reconfigure (world-type or version switch etc.), rather than silently
 *  computing (and letting callers cache) values under the wrong generator
 *  state. Returns a flat Int32Array [oreType, x, y, z, ...]. */
export function generateOreFeatures(
  slot: number, seed: bigint, dimension: number, worldFlags: number, mcVersion: number,
  oreTypes: number[], cx0: number, cz0: number, cx1: number, cz1: number, reqId = 0,
): Promise<Int32Array> {
  const { seedLow, seedHigh } = splitSeed(seed)
  return invoke<number[]>('cubiomes_generate_ore_features', {
    slot, seedLow, seedHigh, dimension, worldFlags, mcVersion, oreTypes, cx0, cz0, cx1, cz1, reqId,
  }).then(arr => new Int32Array(arr))
}

/** Carver (cave/ravine/canyon) coverage for a chunk range, using generator `slot`.
 *  See generateOreFeatures for why seed/dimension/worldFlags/mcVersion are required.
 *  Returns [nx, nz, then nx*nz * 256 per-column carved-block counts]. */
export function getCarvedColumns(
  slot: number, seed: bigint, dimension: number, worldFlags: number, mcVersion: number,
  cx0: number, cz0: number, cx1: number, cz1: number, reqId = 0,
): Promise<Int32Array> {
  const { seedLow, seedHigh } = splitSeed(seed)
  return invoke<number[]>('cubiomes_get_carved_columns', {
    slot, seedLow, seedHigh, dimension, worldFlags, mcVersion, cx0, cz0, cx1, cz1, reqId,
  }).then(arr => new Int32Array(arr))
}

/** Rolled chest loot for a structure at (posX, posZ). */
export function getStructureLoot(
  slot: number, seed: bigint, dimension: number, worldFlags: number, mcVersion: number,
  structType: number, posX: number, posZ: number,
): Promise<LootItem[]> {
  const { seedLow, seedHigh } = splitSeed(seed)
  return invoke<{
    chest_x: number; chest_z: number; item: string; count: number
    potion?: string; enchantments: { name: string; level: number }[]
  }[]>(
    'cubiomes_get_structure_loot', { slot, seedLow, seedHigh, dimension, worldFlags, mcVersion, structType, posX, posZ },
  ).then(rows => rows.map(r => ({
    chestX: r.chest_x, chestZ: r.chest_z, item: r.item, count: r.count,
    potion: r.potion, enchantments: r.enchantments,
  })))
}

/** Chest composition (loot tables present) for a structure at (posX, posZ),
 *  without rolling the loot — cheap enough to call for every visible marker.
 *  `isShip` flags a chest on an End City's End Ship piece (better odds of an
 *  Elytra) — the tower chests share the same loot table name, so this can't
 *  be told apart from `table` alone. */
export function getStructureChests(
  slot: number, seed: bigint, dimension: number, worldFlags: number, mcVersion: number,
  structType: number, posX: number, posZ: number,
): Promise<ChestSlot[]> {
  const { seedLow, seedHigh } = splitSeed(seed)
  return invoke<{ chest_x: number; chest_z: number; table: string; is_ship: boolean }[]>(
    'cubiomes_get_structure_chests', { slot, seedLow, seedHigh, dimension, worldFlags, mcVersion, structType, posX, posZ },
  ).then(rows => rows.map(r => ({ chestX: r.chest_x, chestZ: r.chest_z, table: r.table, isShip: r.is_ship })))
}

/** The 20 End Gateways generated in a ring on the main End island the first
 *  time the Ender Dragon is defeated, paired with each one's outer linked
 *  destination — computed straight from the seed, so this is known even for
 *  gateways nobody has visited. Empty outside the End dimension or MC < 1.13. */
export function getEndGatewayLinks(
  slot: number, seed: bigint, dimension: number, worldFlags: number, mcVersion: number,
): Promise<GatewayLink[]> {
  const { seedLow, seedHigh } = splitSeed(seed)
  return invoke<{ src_x: number; src_z: number; dst_x: number; dst_z: number }[]>(
    'cubiomes_get_end_gateway_links', { slot, seedLow, seedHigh, dimension, worldFlags, mcVersion },
  ).then(rows => rows.map(r => ({ srcX: r.src_x, srcZ: r.src_z, dstX: r.dst_x, dstZ: r.dst_z })))
}

/**
 * Return the biome ID at (x, z) using the correct query for the given display mode.
 * "surface" uses the same 2D query as the tile renderer. "underground"/"deep" use
 * fixed Y depths and return -1 for non-cave biomes.
 */
export function getHoverBiome(
  slot: number, seed: bigint, dimension: number, worldFlags: number, mcVersion: number,
  x: number, z: number, mode: string,
): Promise<number> {
  const { seedLow, seedHigh } = splitSeed(seed)
  return invoke<number>('cubiomes_get_hover_biome', { slot, seedLow, seedHigh, dimension, worldFlags, mcVersion, x, z, mode })
}

/** Batched surface-biome sampling for many points in one call — one CUBIOMES_LOCK
 *  acquisition instead of one per point. Used to classify long map-drawn lines
 *  (Route Planner boat legs) without N separate IPC round-trips. */
export function getBiomesAlongLine(
  slot: number, seed: bigint, dimension: number, worldFlags: number, mcVersion: number,
  points: { x: number; z: number }[],
): Promise<Int32Array> {
  const { seedLow, seedHigh } = splitSeed(seed)
  return invoke<number[]>('cubiomes_get_biomes_along_line', { slot, seedLow, seedHigh, dimension, worldFlags, mcVersion, points })
    .then(ids => new Int32Array(ids))
}
