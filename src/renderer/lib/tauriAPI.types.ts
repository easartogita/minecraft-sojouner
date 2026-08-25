// Shared types for tauriAPI.ts and tauriAPI.static.ts. Kept in a third file with
// zero runtime imports so neither has to import the other — the static build
// aliases `lib/tauriAPI` to this module's sibling, and a self-import would
// resolve back through that same alias.

export interface SavesWorldEntry {
  name:          string
  levelDatPath:  string
  modifiedSecs:  number
  edition:       'java' | 'bedrock'
}

/** A region-change notification: the affected dimension plus the changed region
 *  coords. `dimension` is 'overworld'/'nether'/'end', a custom dim name, or '*'
 *  (dimension unknown → full invalidation of the active view). */
export interface RegionChange { dimension: string; regions: [number, number][] }

/** A rendered tile: disk path plus a freshness mtime, appended as `?v=<mtime>`
 *  to the tileSrc() URL — biome tile paths are stable per seed/config, so
 *  WebKit's URL-keyed image cache would otherwise keep serving a stale decoded
 *  image after an in-place rewrite (palette fix, Clear Biome, etc). */
export interface RenderedTile { path: string; mtime: number }

export interface ChunkInfo {
  blockName: string | null
  inhabitedTime: number | null
  specialMultiplier?: number
  regionalDifficulty?: number
  /** Surface Y of the queried block. Null when chunk isn't generated or the column is air. */
  blockY?: number | null
}

/** Ore-vein detail for a single hovered column (getOreVeinColumnAt). Counts of
 *  vein-affected blocks and their Y range for copper/iron in that column;
 *  *Y fields are null when the corresponding count is 0. Overworld, 1.18+ only. */
export interface OreVeinColumn {
  copperCount: number
  copperMinY: number | null
  copperMaxY: number | null
  ironCount: number
  ironMinY: number | null
  ironMaxY: number | null
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

export interface CaveRangePreset { id: string; label: string; low: number; high: number }

export interface StaticExportParams {
  worldDir: string
  edition: string
  outputDir: string
  seed: bigint
  mcVersion: number
  worldFlags: number
  levelName: string
  dataVersion: number
  versionName: string
  worldType: string
  difficulty: number
  /** Total ticks elapsed — only used to rasterize the local-difficulty overlay. */
  worldTime: number
  borderCenterX: number
  borderCenterZ: number
  borderSize: number
  gameRules: Record<string, string>
  dimensions: string[]
  includeBiomeTiles: boolean
  includeUndergroundTiles: boolean
  includeChunkTiles: boolean
  includeChunkHideWaterTiles: boolean
  /** Keyed by dimension ('overworld'/'nether') — Overworld and Nether don't
   *  share a Y space, so each needs its own preset list. */
  caveRangePresets: Record<string, CaveRangePreset[]>
  /** Overworld-only regardless of this flag — vein fields don't exist elsewhere. */
  includeOreVeins: boolean
  /** Skipped for the End regardless — no carvers there. */
  includeCarvers: boolean
  includeLocalDifficulty: boolean
  /** Structure type names to roll full chest loot for; empty = loot-table names only. */
  rollLootFor: string[]
  /** Opaque — baked as the exported site's starting OverlaySession. */
  defaultSettings: unknown
  /** Opaque — baked as the exported site's CustomMarkerGroup[]. */
  markerGroups: unknown
}

export interface StaticExportProgress { stage: string; dimension: string | null; done: number; total: number }

export interface StructurePos {
  x:            number
  z:            number
  flags:        number
  variantTag?:  string
  variantColor?: string
}

export interface StructureHit {
  struct_type:    string
  x:              number
  z:              number
  flags:          number
  variant_tag?:   string
  variant_color?: string
}

export interface EnchantmentInfo { name: string; level: number }

export interface LootItem {
  chestX: number; chestZ: number; item: string; count: number
  /** e.g. "healing" — set when a set_potion loot function applied one. */
  potion?: string
  enchantments: EnchantmentInfo[]
}

export interface ChestSlot { chestX: number; chestZ: number; table: string; isShip: boolean }

export interface GatewayLink { srcX: number; srcZ: number; dstX: number; dstZ: number }

/** Rasterized overlay layers baked to PNG tiles at static-export time —
 *  matches DimensionManifest.tiles' field names in schema.ts. Live app has
 *  no equivalent (these render from raw per-chunk arrays instead); static
 *  viewer resolves them the same way biome/chunk tiles resolve. */
export type OverlayTileKind = 'oreVeins' | 'oreFeatures' | 'carvers' | 'localDifficulty'

/** Real PNG pixel size per tile layer for the current dimension — a struct
 *  rather than one flat number because different layers in the same static
 *  export can have different actual sizes (see BUGS.md). Undefined for a
 *  layer that wasn't exported, or on the live app where it's meaningless
 *  (each component already knows its own live tile size). `cave` covers all
 *  presets, which always share one size. */
export interface TileSizes {
  biome?: number
  underground?: number
  chunk?: number
  chunkHideWater?: number
  cave?: number
  oreVeins?: number
  oreFeatures?: number
  carvers?: number
  localDifficulty?: number
}

/** Result of a dev-only whole-region-file copy between two worlds (structure_copy.rs).
 *  `skipped` carries a reason per region that couldn't be copied (missing source,
 *  I/O failure) — one bad region doesn't abort the rest of the batch. */
export interface CopyRegionsReport {
  copied: [number, number][]
  backedUp: { region: [number, number]; backupPath: string }[]
  skipped: { region: [number, number]; reason: string }[]
}

/** Result of a dev-only relocatable chunk copy (structure_copy.rs::copy_chunks) —
 *  v1, built on top of copy_regions. `backedUp` is per destination *region*
 *  file touched (one backup even if several copied chunks land in it);
 *  `skipped` is per source *chunk* that couldn't be copied. */
export interface CopyChunksReport {
  copied: [number, number][]
  backedUp: { region: [number, number]; backupPath: string }[]
  skipped: { chunk: [number, number]; reason: string }[]
}

/** Result of a dev-only arbitrary block-box copy with rotation/mirror
 *  (structure_copy/blocks.rs::copy_blocks). Unit is a destination *chunk* the
 *  box's footprint touched, not a user-selected one. `sourceAirAssumed` counts
 *  box cells where the source chunk was missing/pre-1.18 (read as air). */
export interface CopyBlocksReport {
  blocksWritten: number
  sourceAirAssumed: number
  chunksTouched: [number, number][]
  backedUp: { region: [number, number]; backupPath: string }[]
  skipped: { chunk: [number, number]; reason: string }[]
}

/** Result of saving a block-box selection as a portable Structure Block
 *  .nbt file (structure_copy/templates.rs::save_structure_template). */
export interface SavedTemplateInfo {
  width: number
  height: number
  depth: number
  blockCount: number
}

export interface McaMetricsExtended {
  metrics: McaMetrics
  colorCacheSize: number
  memRssMb: number
  memHeapUsedMb: number
  memHeapTotalMb: number
}
