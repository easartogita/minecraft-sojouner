// Static-site counterpart to tauriAPI.ts — same exported function names/signatures
// (vite.site.config.ts aliases `lib/tauriAPI` here) so every layer component's
// import resolves unchanged. Reads the exported bundle (manifest.json + tiles/ +
// data/, see staticExport/schema.ts) instead of invoking Tauri.
//
// Calls with no static-data equivalent (raw cubiomes queries, world-loading,
// export, cache-management) return the live app's existing empty/fallback
// values, or are safe no-ops — the static shell never calls the no-op ones.

import type {
  SavesWorldEntry, RegionChange, RenderedTile, ChunkInfo, ExportParams,
  CaveRangePreset, StaticExportParams, StaticExportProgress, StructurePos, StructureHit,
  LootItem, ChestSlot, GatewayLink, McaMetricsExtended, OverlayTileKind, TileSizes,
  OreVeinColumn, CopyRegionsReport, CopyChunksReport, CopyBlocksReport, SavedTemplateInfo, PreviewImage,
} from './tauriAPI.types'
import type { ExportManifest, DimensionManifest } from './staticExport/schema'
import { STRUCTURE_TILE_BLOCK_SIZE } from './staticExport/schema'

export type {
  SavesWorldEntry, RegionChange, RenderedTile, ChunkInfo, ExportParams,
  CaveRangePreset, StaticExportParams, StaticExportProgress, StructurePos, StructureHit,
  EnchantmentInfo, LootItem, ChestSlot, GatewayLink, OverlayTileKind, TileSizes,
  OreVeinColumn, CopyRegionsReport, CopyChunksReport, CopyBlocksReport, SavedTemplateInfo, PreviewImage,
} from './tauriAPI.types'

export const IS_STATIC_SITE = true

/** Tile paths in the bundle are already relative URLs — nothing to convert. */
export function tileSrc(path: string): string {
  return path
}

export async function getAppVersion(): Promise<string> {
  const manifest = await ensureManifest()
  return manifest.generator.appVersion
}

/** Synthesizes a SeedData-shaped object from manifest.json so the App shell can
 *  boot via the same `SET_SEED` reducer action the live world-loading flow uses.
 *  `path` only needs to be non-empty — every other function here keys off
 *  `dimension`, not worldDir/edition. */
export async function getStaticWorldSeedData(): Promise<{ path: string; data: SeedData } | null> {
  const manifest = await ensureManifest()
  const spawn = await getSpawn(0, 0n, 0, 0, 0)
  const data: SeedData = {
    seed: manifest.world.seed,
    dataVersion: manifest.world.dataVersion,
    versionName: manifest.world.versionName,
    levelName: manifest.world.levelName,
    worldType: manifest.world.worldType as WorldType,
    spawnX: spawn?.x ?? 0,
    spawnZ: spawn?.z ?? 0,
    spawnChunkRadius: null,
    playerX: null, playerY: null, playerZ: null, playerDimension: null,
    dayTime: null,
    difficulty: manifest.world.difficulty,
    worldTime: null,
    edition: manifest.world.edition as 'java' | 'bedrock',
    players: [],
    serverBrands: [],
    borderCenterX: manifest.world.borderCenterX,
    borderCenterZ: manifest.world.borderCenterZ,
    borderSize: manifest.world.borderSize,
    gameRules: manifest.world.gameRules,
  }
  return { path: `${manifest.world.levelName || 'static-export'}/level.dat`, data }
}

/** Baked cave-depth presets, standing in for the live app's freely-draggable
 *  gauge (needs a live player Y this bundle doesn't have). Per-dimension because
 *  Overworld and Nether don't share a Y space. */
export async function getCaveRangePresets(dimension: string): Promise<CaveRangePreset[]> {
  const manifest = await ensureManifest()
  return findDimension(manifest, dimension)?.caveRangePresets ?? []
}

const NOOP_UNLISTEN = () => {}

// ── Manifest loading ─────────────────────────────────────────────────────────

let manifestPromise: Promise<ExportManifest> | null = null
let bundleGeneratedAtMs = 0
let cachedManifest: ExportManifest | null = null

function loadManifest(): Promise<ExportManifest> {
  if (!manifestPromise) {
    manifestPromise = fetch('manifest.json').then(r => {
      if (!r.ok) throw new Error(`manifest.json: HTTP ${r.status}`)
      return r.json()
    })
  }
  return manifestPromise
}

async function ensureManifest(): Promise<ExportManifest> {
  const m = await loadManifest()
  if (!bundleGeneratedAtMs) bundleGeneratedAtMs = Date.parse(m.generatedAt) || 0
  cachedManifest = m
  return m
}

/** Per-layer PNG tile sizes, read from each layer's own tileSize (the top-level
 *  manifest.tileGrid.tileSize is not authoritative — see BUGS.md). The
 *  empty-object fallback only matters if called before boot's ensureManifest(). */
export function getTileSizes(dimension: string): TileSizes {
  const dim = cachedManifest?.dimensions.find(d => d.dimension === dimension)
  if (!dim) return {}
  const t = dim.tiles
  return {
    biome: t.biome?.tileSize,
    underground: t.underground?.tileSize,
    chunk: t.chunk?.tileSize,
    chunkHideWater: t.chunkHideWater?.tileSize,
    cave: Object.values(t.cave ?? {})[0]?.tileSize,
    oreVeins: t.oreVeins?.tileSize,
    oreFeatures: t.oreFeatures?.tileSize,
    carvers: t.carvers?.tileSize,
    localDifficulty: t.localDifficulty?.tileSize,
  }
}

function findDimension(manifest: ExportManifest, dimension: string): DimensionManifest | undefined {
  return manifest.dimensions.find(d => d.dimension === dimension)
}

const DIM_ID_TO_NAME: Record<number, string> = { 0: 'overworld', [-1]: 'nether', 1: 'end' }

// ── Region-file fetching ─────────────────────────────────────────────────────

const REGION_BLOCK_SIZE = 512

function regionsForBlockRange(
  minX: number, minZ: number, maxX: number, maxZ: number, tileBlockSize = REGION_BLOCK_SIZE,
): [number, number][] {
  const rx0 = Math.floor(minX / tileBlockSize), rx1 = Math.floor(maxX / tileBlockSize)
  const rz0 = Math.floor(minZ / tileBlockSize), rz1 = Math.floor(maxZ / tileBlockSize)
  const out: [number, number][] = []
  for (let rz = rz0; rz <= rz1; rz++) for (let rx = rx0; rx <= rx1; rx++) out.push([rx, rz])
  return out
}

const regionJsonCache = new Map<string, Promise<unknown[]>>()

function fetchRegionJson<T>(layerPath: string, rx: number, rz: number): Promise<T[]> {
  const url = `${layerPath}/${rx}_${rz}.json`
  let p = regionJsonCache.get(url)
  if (!p) {
    p = fetch(url).then(r => r.ok ? r.json() : []).catch(() => [])
    regionJsonCache.set(url, p)
  }
  return p as Promise<T[]>
}

const flatJsonCache = new Map<string, Promise<unknown | null>>()

function fetchJsonOnce<T>(path: string): Promise<T | null> {
  let p = flatJsonCache.get(path)
  if (!p) {
    p = fetch(path).then(r => r.ok ? r.json() : null).catch(() => null)
    flatJsonCache.set(path, p)
  }
  return p as Promise<T | null>
}

/** POI/block-entities/entities are queried by chunk range; region JSON files
 *  hold every record whose x/z falls in that 512-block region, so results are
 *  filtered back down to the requested chunk window after fetching. */
async function fetchGridLayerRange<T extends { x: number; z: number }>(
  dimension: string,
  layerKey: 'poi' | 'blockEntities' | 'entities',
  minCx: number, minCz: number, maxCx: number, maxCz: number,
): Promise<T[]> {
  const manifest = await ensureManifest()
  const dim = findDimension(manifest, dimension)
  const layer = dim?.data[layerKey]
  if (!layer) return []
  const minBX = minCx * 16, maxBX = maxCx * 16 + 15
  const minBZ = minCz * 16, maxBZ = maxCz * 16 + 15
  const regions = regionsForBlockRange(minBX, minBZ, maxBX, maxBZ)
  const chunks = await Promise.all(regions.map(([rx, rz]) => fetchRegionJson<T>(layer.path, rx, rz)))
  return chunks.flat().filter(r => r.x >= minBX && r.x <= maxBX && r.z >= minBZ && r.z <= maxBZ)
}

// ── Tile resolution ───────────────────────────────────────────────────────────
// Coverage inside a layer's zoom range isn't guaranteed for every tile (e.g.
// underground/chunk/cave tiles only exist where the exporter actually found
// data). Hand back the URL and let the <img> load be the one request: success
// paints the tile, a 404 is the same "no tile here" as a probe would have
// found — downloading the file to ask "does it exist?" is the download.

async function resolveTile(
  layer: { path: string; minZoom: number; maxZoom: number } | undefined,
  tileX: number, tileY: number, zoom: number,
): Promise<RenderedTile | null> {
  if (!layer || zoom < layer.minZoom || zoom > layer.maxZoom) return null
  return { path: `${layer.path}/${zoom}/${tileX}_${tileY}.png`, mtime: bundleGeneratedAtMs }
}

export async function renderBiomeTile(
  _slot: number, _seed: bigint, _mcVersion: number, _worldFlags: number, dimension: string,
  tileX: number, tileY: number, zoom: number,
): Promise<RenderedTile | null> {
  const manifest = await ensureManifest()
  return resolveTile(findDimension(manifest, dimension)?.tiles.biome, tileX, tileY, zoom)
}

export async function renderUndergroundBiomeTile(
  _slot: number, _seed: bigint, _mcVersion: number, _worldFlags: number, dimension: string,
  tileX: number, tileY: number, zoom: number,
): Promise<RenderedTile | null> {
  const manifest = await ensureManifest()
  return resolveTile(findDimension(manifest, dimension)?.tiles.underground, tileX, tileY, zoom)
}

export async function renderTile(
  _worldDir: string, _edition: string, dimension: string,
  tileX: number, tileY: number, zoom: number,
  hideWater: boolean, caveY: number | null,
  caveScanLow: number, caveScanHigh: number,
): Promise<RenderedTile | null> {
  const manifest = await ensureManifest()
  const dim = findDimension(manifest, dimension)
  if (!dim) return null
  if (caveY == null) {
    return resolveTile(hideWater ? dim.tiles.chunkHideWater : dim.tiles.chunk, tileX, tileY, zoom)
  }
  const preset = dim.caveRangePresets.find(p => p.low === caveScanLow && p.high === caveScanHigh)
  if (!preset) return null
  return resolveTile(dim.tiles.cave?.[preset.id], tileX, tileY, zoom)
}

/** No live source to go stale against in an immutable bundle — a constant
 *  "always fresh" timestamp is the correct answer, not a guess. */
export async function tileSourceMtime(
  _worldDir: string, _edition: string, _dimension: string,
  _tileX: number, _tileY: number, _zoom: number,
): Promise<number> {
  await ensureManifest()
  return bundleGeneratedAtMs
}

/** Ore veins/ore features/carvers/cave entrances/local difficulty — baked to
 *  PNG at export time (static_export.rs) instead of the live app's raw-array
 *  + overlayTileWorker.ts rasterization, so the viewer just loads an image
 *  like every other tile layer. */
export async function renderOverlayTile(
  kind: OverlayTileKind, dimension: string, tileX: number, tileY: number, zoom: number,
): Promise<RenderedTile | null> {
  const manifest = await ensureManifest()
  return resolveTile(findDimension(manifest, dimension)?.tiles[kind], tileX, tileY, zoom)
}

// ── Slime chunks — pure client-side port, no export needed ──────────────────
// A pure function of (seed, cx, cz) — Java's 48-bit LCG, mirrors slime.rs's
// is_slime_chunk_impl exactly — cheap enough to evaluate directly.

const LCG_MULT = 0x5DEECE66Dn
const LCG_ADD  = 0xBn
const MASK48   = (1n << 48n) - 1n

// term1/term2/term4 wrap the multiply chain in i32 before widening; term3 wraps
// only cz*cz in i32, widens, then multiplies by 0x4307A7 in i64 — must match
// slime.rs's wrap points exactly or results diverge.
function isSlimeChunkPure(worldSeed: bigint, cx: number, cz: number): boolean {
  const term1 = BigInt(Math.imul(Math.imul(cx, cx), 0x4c1906))
  const term2 = BigInt(Math.imul(cx, 0x5ac0db))
  const term3 = BigInt.asIntN(64, BigInt(Math.imul(cz, cz)) * 0x4307a7n)
  const term4 = BigInt(Math.imul(cz, 0x5f24f))

  let s = BigInt.asIntN(64, worldSeed + term1 + term2 + term3 + term4)
  s = BigInt.asIntN(64, s ^ 0x3ad8025fn)
  s = (s ^ LCG_MULT) & MASK48
  s = (s * LCG_MULT + LCG_ADD) & MASK48
  return (s >> 17n) % 10n === 0n
}

export function isSlimeChunk(seed: bigint, cx: number, cz: number): Promise<boolean> {
  return Promise.resolve(isSlimeChunkPure(seed, cx, cz))
}

// ── Region/chunk queries with no static equivalent ───────────────────────────
// Nothing baked for these — see static_export.rs's module doc.

export function getBlockAt(
  _worldDir: string, _edition: string, _dimension: string,
  _hideWater: boolean, _caveY: number | null,
  _caveScanLow: number, _caveScanHigh: number,
  _blockX: number, _blockZ: number,
  _gameDifficulty?: number, _worldTime?: number,
): Promise<ChunkInfo | null> {
  return Promise.resolve(null)
}

export function getSlimeChunks(
  seed: bigint, cx0: number, cz0: number, cx1: number, cz1: number,
): Promise<boolean[]> {
  const out: boolean[] = []
  for (let cz = cz0; cz <= cz1; cz++) {
    for (let cx = cx0; cx <= cx1; cx++) out.push(isSlimeChunkPure(seed, cx, cz))
  }
  return Promise.resolve(out)
}

export function getLocalDifficulties(
  _worldDir: string, _dimension: string,
  cx0: number, cz0: number, cx1: number, cz1: number,
  _gameDifficulty: number, _worldTime: number,
): Promise<number[]> {
  return Promise.resolve(new Array(Math.max(0, (cx1 - cx0 + 1) * (cz1 - cz0 + 1))).fill(0))
}

export function getInhabitedTimes(
  _worldDir: string, _dimension: string,
  cx0: number, cz0: number, cx1: number, cz1: number,
): Promise<number[]> {
  return Promise.resolve(new Array(Math.max(0, (cx1 - cx0 + 1) * (cz1 - cz0 + 1))).fill(0))
}

// ── Region-gridded vector data ────────────────────────────────────────────────

export function getBlockEntities(
  _worldDir: string, _edition: string, dimension: string,
  minCx: number, minCz: number, maxCx: number, maxCz: number,
): Promise<BlockEntity[]> {
  return fetchGridLayerRange<BlockEntity>(dimension, 'blockEntities', minCx, minCz, maxCx, maxCz)
}

export function getEntities(
  _worldDir: string, _edition: string, dimension: string,
  minCx: number, minCz: number, maxCx: number, maxCz: number,
): Promise<GameEntity[]> {
  return fetchGridLayerRange<GameEntity>(dimension, 'entities', minCx, minCz, maxCx, maxCz)
}

export function getPoi(
  _worldDir: string, _edition: string, dimension: string,
  minCx: number, minCz: number, maxCx: number, maxCz: number,
): Promise<PoiRecord[]> {
  return fetchGridLayerRange<PoiRecord>(dimension, 'poi', minCx, minCz, maxCx, maxCz)
}

export async function listRegions(_worldDir: string, _edition: string, dimension: string): Promise<[number, number][]> {
  const manifest = await ensureManifest()
  return findDimension(manifest, dimension)?.regions ?? []
}

// ── Structures ────────────────────────────────────────────────────────────────
// Shape written by static_export.rs's ExportedStructure — camelCase,
// chests/loot already embedded per structure. findAllStructures populates
// structureCache as a side effect so the getStructureChests/getStructureLoot
// calls StructureLayer.tsx makes per-marker right after can resolve from
// memory instead of a second fetch.

interface ExportedStructureRecord {
  structType: string
  x: number
  z: number
  flags: number
  variantTag?: string
  variantColor?: string
  chests: ChestSlot[]
  loot?: LootItem[]
}

const structureCache = new Map<string, ExportedStructureRecord>()

export async function findAllStructures(
  _seed: bigint, _mcVersion: number, dimension: string, _worldFlags: number,
  bx0: number, bz0: number, bx1: number, bz1: number, enabled: string[],
): Promise<StructureHit[]> {
  const manifest = await ensureManifest()
  const layer = findDimension(manifest, dimension)?.data.structures
  if (!layer) return []
  const regions = regionsForBlockRange(bx0, bz0, bx1, bz1, STRUCTURE_TILE_BLOCK_SIZE)
  const chunks = await Promise.all(regions.map(([rx, rz]) => fetchRegionJson<ExportedStructureRecord>(layer.path, rx, rz)))
  const enabledSet = new Set(enabled)
  const out: StructureHit[] = []
  for (const rec of chunks.flat()) {
    structureCache.set(`${dimension}:${rec.x}:${rec.z}`, rec)
    if (!enabledSet.has(rec.structType)) continue
    if (rec.x < bx0 || rec.x > bx1 || rec.z < bz0 || rec.z > bz1) continue
    out.push({
      struct_type: rec.structType, x: rec.x, z: rec.z, flags: rec.flags,
      variant_tag: rec.variantTag, variant_color: rec.variantColor,
    })
  }
  return out
}

export async function getSpawn(
  _slot: number, _seed: bigint, dimension: number, _worldFlags: number, _mcVersion: number,
): Promise<StructurePos | null> {
  const manifest = await ensureManifest()
  const path = findDimension(manifest, DIM_ID_TO_NAME[dimension] ?? 'overworld')?.data.spawn
  if (!path) return null
  const spawn = await fetchJsonOnce<{ x: number; z: number }>(path)
  return spawn ? { x: spawn.x, z: spawn.z, flags: 0 } : null
}

export async function getStructureLoot(
  _slot: number, _seed: bigint, dimension: number, _worldFlags: number, _mcVersion: number,
  _structType: number, posX: number, posZ: number,
): Promise<LootItem[]> {
  await ensureManifest()
  return structureCache.get(`${DIM_ID_TO_NAME[dimension] ?? 'overworld'}:${posX}:${posZ}`)?.loot ?? []
}

export async function getStructureChests(
  _slot: number, _seed: bigint, dimension: number, _worldFlags: number, _mcVersion: number,
  _structType: number, posX: number, posZ: number,
): Promise<ChestSlot[]> {
  await ensureManifest()
  return structureCache.get(`${DIM_ID_TO_NAME[dimension] ?? 'overworld'}:${posX}:${posZ}`)?.chests ?? []
}

export async function getEndGatewayLinks(
  _slot: number, _seed: bigint, dimension: number, _worldFlags: number, _mcVersion: number,
): Promise<GatewayLink[]> {
  const manifest = await ensureManifest()
  const path = findDimension(manifest, DIM_ID_TO_NAME[dimension] ?? 'end')?.data.gatewayLinks
  if (!path) return []
  return (await fetchJsonOnce<GatewayLink[]>(path)) ?? []
}

// ── cubiomes live-generator queries — no static equivalent ────────────────────
// Same fallback values the live app returns on a generator-slot mismatch: biome
// id 1 (plains) as a neutral placeholder, -1 for "unknown".

// `slot` is ignored by every real query below (they key off manifest data
// instead), but layer components gate fetch effects on `slot >= 0` — a negative
// sentinel would wrongly block findAllStructures/chests/loot/overlays, so this
// returns 0 ("ready") rather than a real slot number.
export function setupGenerator(_seed: bigint, _mcVersion: number, _dimension: number, _flags: number): Promise<number> {
  return Promise.resolve(0)
}

export function getBiomeRegion(
  _slot: number, _seed: bigint, _dimension: number, _worldFlags: number, _mcVersion: number,
  _x: number, _z: number, width: number, height: number, _scale: number,
): Promise<Int32Array> {
  return Promise.resolve(new Int32Array(width * height).fill(1))
}

export function getBiomeRegionAt(
  _slot: number, _seed: bigint, _dimension: number, _worldFlags: number, _mcVersion: number,
  _x: number, _z: number, width: number, height: number, _scale: number, _y: number,
): Promise<Int32Array> {
  return Promise.resolve(new Int32Array(width * height).fill(1))
}

export function getHeightRegion(
  _slot: number, _seed: bigint, _dimension: number, _worldFlags: number, _mcVersion: number,
  _x: number, _z: number, w: number, h: number,
): Promise<Float32Array> {
  return Promise.resolve(new Float32Array(w * h).fill(0))
}

let reqCounter = 0
export function newRequestId(): number { return ++reqCounter }
export function cubiomesCancelRequest(_reqId: number): void {}

export function getOreVeinColumns(
  _slot: number, _seed: bigint, _dimension: number, _worldFlags: number, _mcVersion: number,
  _cx0: number, _cz0: number, _cx1: number, _cz1: number, _reqId = 0,
): Promise<Int32Array> {
  return Promise.resolve(new Int32Array(0))
}

// Hover-resolution vein detail needs a live cubiomes generator per mouse
// move — not something a static export can serve. The cursor-info stack
// treats null as "no data for this layer" and simply omits the row.
export function getOreVeinColumnAt(
  _slot: number, _seed: bigint, _dimension: number, _worldFlags: number, _mcVersion: number,
  _bx: number, _bz: number,
): Promise<OreVeinColumn | null> {
  return Promise.resolve(null)
}

export function generateOreFeatures(
  _slot: number, _seed: bigint, _dimension: number, _worldFlags: number, _mcVersion: number,
  _oreTypes: number[], _cx0: number, _cz0: number, _cx1: number, _cz1: number, _reqId = 0,
): Promise<Int32Array> {
  return Promise.resolve(new Int32Array(0))
}

export function getCarvedColumns(
  _slot: number, _seed: bigint, _dimension: number, _worldFlags: number, _mcVersion: number,
  _cx0: number, _cz0: number, _cx1: number, _cz1: number, _reqId = 0,
): Promise<Int32Array> {
  return Promise.resolve(new Int32Array(0))
}

export function getHoverBiome(
  _slot: number, _seed: bigint, _dimension: number, _worldFlags: number, _mcVersion: number,
  _x: number, _z: number, _mode: string,
): Promise<number> {
  return Promise.resolve(-1)
}

export function getBiomesAlongLine(
  _slot: number, _seed: bigint, _dimension: number, _worldFlags: number, _mcVersion: number,
  points: { x: number; z: number }[],
): Promise<Int32Array> {
  return Promise.resolve(new Int32Array(points.length).fill(-1))
}

// ── World loading / live-only — not meaningful in a static site ──────────────
// The static App shell boots from manifest.json, never calls these; kept as
// safe stand-ins so the module remains a drop-in replacement for tauriAPI.ts.

export function selectLevelDat(): Promise<string | null> { return Promise.resolve(null) }
export function selectWorldDir(): Promise<string | null> { return Promise.resolve(null) }
export function listSavesWorlds(): Promise<SavesWorldEntry[]> { return Promise.resolve([]) }
export function readSeed(_path: string): Promise<SeedData> {
  return Promise.reject(new Error('readSeed: not available in a static export'))
}
export function readDayTime(_path: string): Promise<number | null> { return Promise.resolve(null) }
export function watchLevelDat(_levelDatPath: string): Promise<void> { return Promise.resolve() }
export function getAutoLoadData(): Promise<[string, SeedData] | null> { return Promise.resolve(null) }

export function onSeedChanged(_cb: (data: SeedData) => void): () => void { return NOOP_UNLISTEN }
export function onSeedError(_cb: (error: string) => void): () => void { return NOOP_UNLISTEN }
export function onRegionChanged(_cb: (change: RegionChange) => void): () => void { return NOOP_UNLISTEN }
export function onMcaMetrics(_cb: (m: McaMetrics) => void): () => void { return NOOP_UNLISTEN }
export function onFileDrop(_cb: (paths: string[]) => void): () => void { return NOOP_UNLISTEN }

// ── Export — not meaningful in a static site (no filesystem write access) ────

export function selectExportPath(_defaultName: string): Promise<string | null> { return Promise.resolve(null) }
export function exportWorldMap(_p: ExportParams): Promise<void> {
  return Promise.reject(new Error('Export not available in a static site.'))
}
export function cancelExport(): Promise<void> { return Promise.resolve() }
export function onExportProgress(_cb: (doneBiome: number, doneChunk: number, total: number) => void): () => void { return NOOP_UNLISTEN }
export function onExportDone(_cb: () => void): () => void { return NOOP_UNLISTEN }
export function onExportError(_cb: (msg: string) => void): () => void { return NOOP_UNLISTEN }

// ── Structure copy — dev-only live-app feature, no static-site equivalent ───────

export function copyRegions(
  _srcLevelDatPath: string, _srcDimension: string,
  _dstLevelDatPath: string, _dstDimension: string,
  _regions: [number, number][],
  _overrideLiveLock = false,
): Promise<CopyRegionsReport> {
  return Promise.reject(new Error('copyRegions: not available in a static export'))
}

export function copyChunks(
  _srcLevelDatPath: string, _srcDimension: string,
  _dstLevelDatPath: string, _dstDimension: string,
  _chunks: [number, number][], _dx: number, _dz: number,
  _yMin?: number, _yMax?: number,
  _overrideLiveLock = false,
): Promise<CopyChunksReport> {
  return Promise.reject(new Error('copyChunks: not available in a static export'))
}

export function copyBlocks(
  _srcLevelDatPath: string, _srcDimension: string,
  _dstLevelDatPath: string, _dstDimension: string,
  _srcBox: [number, number, number, number, number, number],
  _dstOrigin: [number, number, number],
  _rotationDeg: 0 | 90 | 180 | 270,
  _mirror: 'x' | 'z' | null,
  _overrideLiveLock = false,
): Promise<CopyBlocksReport> {
  return Promise.reject(new Error('copyBlocks: not available in a static export'))
}

export function selectTemplateSavePath(_defaultName: string): Promise<string | null> {
  return Promise.resolve(null)
}

export function selectTemplateFile(): Promise<string | null> {
  return Promise.resolve(null)
}

export function saveStructureTemplate(
  _srcLevelDatPath: string, _srcDimension: string,
  _srcBox: [number, number, number, number, number, number],
  _outPath: string,
): Promise<SavedTemplateInfo> {
  return Promise.reject(new Error('saveStructureTemplate: not available in a static export'))
}

export function pasteStructureTemplate(
  _templatePath: string,
  _dstLevelDatPath: string, _dstDimension: string,
  _dstOrigin: [number, number, number],
  _rotationDeg: 0 | 90 | 180 | 270,
  _mirror: 'x' | 'z' | null,
  _overrideLiveLock = false,
): Promise<CopyBlocksReport> {
  return Promise.reject(new Error('pasteStructureTemplate: not available in a static export'))
}

export function previewBoxSelection(
  _srcLevelDatPath: string, _srcDimension: string,
  _srcBox: [number, number, number, number, number, number],
): Promise<PreviewImage> {
  return Promise.reject(new Error('previewBoxSelection: not available in a static export'))
}

export function previewTemplate(_templatePath: string): Promise<PreviewImage> {
  return Promise.reject(new Error('previewTemplate: not available in a static export'))
}

export function previewChunkSelection(
  _worldDir: string, _dimension: string, _chunks: [number, number][],
): Promise<PreviewImage> {
  return Promise.reject(new Error('previewChunkSelection: not available in a static export'))
}

export function selectExportDir(_defaultPath?: string | null): Promise<string | null> { return Promise.resolve(null) }
export function exportStaticSite(_p: StaticExportParams): Promise<void> {
  return Promise.reject(new Error('Nested export not available in a static site.'))
}
export function cancelStaticExport(): Promise<void> { return Promise.resolve() }
export function onStaticExportProgress(_cb: (p: StaticExportProgress) => void): () => void { return NOOP_UNLISTEN }
export function onStaticExportDone(_cb: () => void): () => void { return NOOP_UNLISTEN }
export function onStaticExportError(_cb: (msg: string) => void): () => void { return NOOP_UNLISTEN }

// ── Cache / metrics — nothing to clear/track in a static site ────────────────

export function clearTilePng(_worldDir: string): Promise<void> { return Promise.resolve() }
export function clearBiomeTilePng(_seed: bigint): Promise<void> { return Promise.resolve() }
export function clearStructureCache(_seed: bigint): Promise<void> { return Promise.resolve() }
export function invalidateChunks(_worldDir: string): Promise<void> { return Promise.resolve() }
export function invalidateMcaTiles(_worldDir: string, _regions: [number, number][]): Promise<void> { return Promise.resolve() }

const ZERO_METRICS: McaMetrics = {
  colorCacheHits: 0, colorCacheMisses: 0, diskCacheHits: 0, mcaReads: 0,
  parseErrors: 0, skippedChunks: 0, totalParseMs: 0, chunksParsed: 0,
  peakParseMs: 0, surfaceFindMs: 0, ioMs: 0, peakIoMs: 0,
  decompressMs: 0, peakDecompressMs: 0, nbtParseMs: 0, peakNbtParseMs: 0,
  peakSurfaceFindMs: 0, colorAssignMs: 0, peakColorAssignMs: 0,
  pngCacheHits: 0, pngCacheMisses: 0, tilesRendered: 0,
  tileAssemblyMs: 0, peakTileAssemblyMs: 0, pngEncodeMs: 0, peakPngEncodeMs: 0,
}

export function getMcaMetrics(): Promise<McaMetricsExtended> {
  return Promise.resolve({ metrics: ZERO_METRICS, colorCacheSize: 0, memRssMb: 0, memHeapUsedMb: 0, memHeapTotalMb: 0 })
}
export function resetMcaMetrics(): Promise<void> { return Promise.resolve() }
