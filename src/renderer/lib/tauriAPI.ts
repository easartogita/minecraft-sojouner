import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

// ── Level.dat / seed ──────────────────────────────────────────────────────────

export function selectLevelDat(): Promise<string | null> {
  return invoke<string | null>('select_level_dat')
}

export function selectWorldDir(): Promise<string | null> {
  return invoke<string | null>('select_world_dir')
}

export interface SavesWorldEntry {
  name:          string
  levelDatPath:  string
  modifiedSecs:  number
  edition:       'java' | 'bedrock'
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

export function onRegionChanged(cb: (regions: [number, number][]) => void): () => void {
  let unlisten: UnlistenFn | undefined
  listen<[number, number][]>('region:changed', e => cb(e.payload)).then(fn => { unlisten = fn })
  return () => { unlisten?.() }
}

export function onMcaMetrics(cb: (m: McaMetrics) => void): () => void {
  let unlisten: UnlistenFn | undefined
  listen<McaMetrics>('metrics:mca', e => cb(e.payload)).then(fn => { unlisten = fn })
  return () => { unlisten?.() }
}

// ── Tile rendering ────────────────────────────────────────────────────────────

export function renderBiomeTile(
  slot: number, seed: bigint, mcVersion: number, dimension: string,
  tileX: number, tileY: number, zoom: number,
): Promise<string | null> {
  const { seedLow, seedHigh } = splitSeed(seed)
  return invoke<string | null>('render_biome_tile', {
    slot, seedLow, seedHigh, mcVersion, dimension, tileX, tileY, zoom,
  })
}

export function renderTile(
  worldDir: string, edition: string, dimension: string,
  tileX: number, tileY: number, zoom: number,
  hideWater: boolean, caveY: number | null,
  caveScanLow: number, caveScanHigh: number,
): Promise<string | null> {
  return invoke<string | null>('render_tile', {
    worldDir, edition, dimension, tileX, tileY, zoom,
    hideWater, caveY, caveScanLow, caveScanHigh,
  })
}

export interface ChunkInfo {
  blockName: string | null
  inhabitedTime: number | null
  specialMultiplier?: number
  regionalDifficulty?: number
  /** Surface Y of the queried block. Null when chunk isn't generated or the column is air. */
  blockY?: number | null
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

export function getCaveEntrances(
  worldDir: string, dimension: string,
  cx0: number, cz0: number, cx1: number, cz1: number,
): Promise<Int32Array> {
  return invoke<number[]>('get_cave_entrances', { worldDir, dimension, cx0, cz0, cx1, cz1 })
    .then(arr => new Int32Array(arr))
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

export interface ExportParams {
  worldDir: string
  edition: string
  dimension: string
  outputPath: string
  hideWater: boolean
  blocksPerPixel: number
  seed: bigint
  mcVersion: number
  worldFlags: number
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

export function getMcaMetrics(): Promise<{
  metrics: McaMetrics
  colorCacheSize: number
  memRssMb: number
  memHeapUsedMb: number
  memHeapTotalMb: number
}> {
  return invoke('get_mca_metrics')
}

export function resetMcaMetrics(): Promise<void> {
  return invoke('reset_mca_metrics')
}

// ── cubiomes / biome generation ───────────────────────────────────────────────

export interface StructurePos {
  x:            number
  z:            number
  flags:        number
  variantTag?:  string
  variantColor?: string
}

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

export function getBiomeRegion(
  slot: number, x: number, z: number, width: number, height: number, scale: number
): Promise<Int32Array> {
  return invoke<{ biomes: number[]; width: number; height: number } | null>(
    'cubiomes_get_biomes', { slot, x, z, width, height, scale }
  ).then(r => r ? new Int32Array(r.biomes) : new Int32Array(width * height).fill(1))
}

/** Like getBiomeRegion but queries at an explicit biome Y coordinate.
 *  y is in cubiomes biome space: Math.floor(minecraftBlockY / 4) for scale > 1. */
export function getBiomeRegionAt(
  slot: number, x: number, z: number, width: number, height: number, scale: number, y: number
): Promise<Int32Array> {
  return invoke<{ biomes: number[]; width: number; height: number } | null>(
    'cubiomes_get_biomes_at', { slot, x, z, width, height, scale, y }
  ).then(r => r ? new Int32Array(r.biomes) : new Int32Array(width * height).fill(1))
}

export function getHeightRegion(
  slot: number, x: number, z: number, w: number, h: number
): Promise<Float32Array> {
  return invoke<number[] | null>(
    'cubiomes_get_height_region', { slot, x, z, w, h }
  ).then(r => r ? new Float32Array(r) : new Float32Array(w * h).fill(0))
}

// Valid cubiomes biome query scales, largest first.
// Picking the largest scale ≤ blocksPerPixel keeps queryW ≈ tileSize (fast query, full coverage).
const CUBIOMES_SCALES = [256, 64, 16, 4, 1] as const
// cubiomes always samples height at 4-block resolution; not meaningful at low zoom.
const HEIGHT_SCALE = 4
const HEIGHT_MAX_BLOCKS_PER_PIXEL = 16

export interface BiomeTileData {
  biomes:     Int32Array
  queryW:     number
  queryH:     number
  biomeScale: number
}

/** Fetch biome data for a single tile, choosing the optimal cubiomes scale internally. */
export function getBiomesForTile(
  slot: number, blockX: number, blockZ: number,
  blocksPerPixel: number, tileSize: number,
): Promise<BiomeTileData> {
  const biomeScale = CUBIOMES_SCALES.find(s => s <= blocksPerPixel) ?? 4
  const queryW = Math.max(1, Math.ceil(tileSize * blocksPerPixel / biomeScale))
  const queryH = queryW
  return getBiomeRegion(
    slot, Math.floor(blockX / biomeScale), Math.floor(blockZ / biomeScale), queryW, queryH, biomeScale,
  ).then(biomes => ({ biomes, queryW, queryH, biomeScale }))
}

/** Fetch height data for a tile, or null if the dimension/zoom makes it irrelevant. */
export function getHeightsForTile(
  slot: number, blockX: number, blockZ: number,
  blocksPerPixel: number, tileSize: number, dimension: string,
): Promise<Float32Array | null> {
  if (dimension !== 'overworld' || blocksPerPixel > HEIGHT_MAX_BLOCKS_PER_PIXEL) return Promise.resolve(null)
  const queryW = Math.max(1, Math.ceil(tileSize * blocksPerPixel / HEIGHT_SCALE))
  return getHeightRegion(
    slot, Math.floor(blockX / HEIGHT_SCALE), Math.floor(blockZ / HEIGHT_SCALE), queryW, queryW,
  ).catch(() => null)
}

export interface StructureHit {
  struct_type:    string
  x:              number
  z:              number
  flags:          number
  variant_tag?:   string
  variant_color?: string
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

export function getSpawn(slot: number): Promise<StructurePos> {
  return invoke<[number, number]>('cubiomes_get_spawn', { slot })
    .then(([x, z]) => ({ x, z, flags: 0 }))
}

/** Returns [copper_y, copper_size, iron_y, iron_size].
 *  size: 0=no ore (tuff only), 1=small, 2=medium, 3=large. y is i32::MIN when size==0. */
export function getOreVeinsAt(
  seed: bigint, cx: number, cz: number
): Promise<{ copperY: number | null; copperSize: number; ironY: number | null; ironSize: number }> {
  const { seedLow, seedHigh } = splitSeed(seed)
  const INT_MIN = -2147483648
  return invoke<[number, number, number, number]>('cubiomes_get_ore_veins_at', { seedLow, seedHigh, cx, cz })
    .then(([copperY, copperSize, ironY, ironSize]) => ({
      copperY:   copperY   !== INT_MIN ? copperY   : null,
      copperSize,
      ironY:     ironY     !== INT_MIN ? ironY     : null,
      ironSize,
    }))
}

/** Returns a flat Int32Array [copper_y, copper_size, iron_y, iron_size, ...] per chunk.
 *  size: 0=no ore (tuff only), 1=small, 2=medium, 3=large. y is i32::MIN when size==0. */
export function getOreVeinsEx(
  seed: bigint, cx0: number, cz0: number, cx1: number, cz1: number
): Promise<Int32Array> {
  const { seedLow, seedHigh } = splitSeed(seed)
  return invoke<number[]>('cubiomes_get_ore_veins_ex', { seedLow, seedHigh, cx0, cz0, cx1, cz1 })
    .then(arr => new Int32Array(arr))
}

export function getBiomeAt(slot: number, x: number, z: number): Promise<number> {
  return getBiomeRegion(slot, x, z, 1, 1, 1).then(arr => arr[0] ?? 0)
}

/** Query biome at an explicit cubiomes Y (Math.floor(blockY / 4)) for 3D underground lookups. */
export function getBiomeAtY(slot: number, x: number, z: number, y: number): Promise<number> {
  return getBiomeRegionAt(slot, x, z, 1, 1, 1, y).then(arr => arr[0] ?? 0)
}

/**
 * Return the biome ID at (x, z) using the correct query for the given display mode.
 * "surface" uses the same 2D query as the tile renderer. "underground"/"deep" use
 * fixed Y depths and return -1 for non-cave biomes.
 */
export function getHoverBiome(slot: number, x: number, z: number, mode: string): Promise<number> {
  return invoke<number>('cubiomes_get_hover_biome', { slot, x, z, mode })
}
