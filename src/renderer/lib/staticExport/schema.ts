// Contract for the static-site export bundle: a self-contained folder of PNG
// tiles + JSON a plain Leaflet page (no Tauri backend) can render. Source of
// truth — static_export.rs writes this shape, tauriAPI.static.ts consumes it;
// keep in sync like BlockEntity/GameEntity are between src-tauri/src/*.rs and
// env.d.ts. Every vector shape is a JSON dump of an existing IPC response
// (see the cited command in tauriAPI.ts), not new data design.

import type { CaveRangePreset, LootItem, ChestSlot } from '../tauriAPI.types'
import type { CustomMarkerGroup } from '../markerFilters'
import type { OverlaySession } from '../../hooks/overlaySlice'

export type { CaveRangePreset }

export const EXPORT_FORMAT_VERSION = '1.0.0'

export type ExportEdition = 'java' | 'bedrock'
export type ExportDimension = 'overworld' | 'nether' | 'end' | string

// ── Tile (PNG, standard Leaflet slippy-map layout) layers ─────────────────────
// Files live at `{path}/{zoom}/{tx}_{ty}.png`, mirroring tile_renderer.rs's
// on-disk cache layout — export is a recursive copy of already-rendered zooms
// plus a forced render pass for zooms the user never panned to live.
export interface TileLayerManifest {
  path: string          // relative to bundle root, e.g. "tiles/overworld/chunk"
  minZoom: number
  maxZoom: number
  /** Actual PNG pixel size of this layer's tiles — not necessarily the same
   *  across layers in one export. See BUGS.md ("Static export: biome/
   *  underground/chunk tiles rendered at 128px..."). */
  tileSize: number
}

// Export bakes a fixed, named set of Y-scan windows in place of the live app's
// freely-draggable gauge, since a static bundle can't render on demand. One set
// per dimension — Overworld's -64..320 and Nether's 0..127 don't share a Y space.
export const DEFAULT_CAVE_RANGE_PRESETS_OVERWORLD: CaveRangePreset[] = [
  { id: 'above-ground', label: 'Above Ground (Y 48 to 320)', low: 48,  high: 320 },
  { id: 'near-surface', label: 'Near Surface (Y -16 to 48)', low: -16, high: 48 },
  { id: 'mid',          label: 'Mid (Y -48 to -16)',         low: -48, high: -16 },
  { id: 'deepslate',    label: 'Deepslate (Y -64 to -48)',   low: -64, high: -48 },
]

export const DEFAULT_CAVE_RANGE_PRESETS_NETHER: CaveRangePreset[] = [
  { id: 'upper-nether', label: 'Upper Nether (Y 96 to 127)', low: 96, high: 127 },
  { id: 'mid-nether',   label: 'Mid Nether (Y 32 to 95)',    low: 32, high: 95 },
  { id: 'lava-sea',     label: 'Lava Sea (Y 0 to 31)',       low: 0,  high: 31 },
]

/** Cave mode has no effect in the End (see CaveMapControls/caveZoomRange) —
 *  callers that need "does this dimension get cave presets at all" should
 *  check that themselves; this just picks which Y space applies. */
export function defaultCaveRangePresets(dimension: string): CaveRangePreset[] {
  return dimension === 'nether' ? DEFAULT_CAVE_RANGE_PRESETS_NETHER : DEFAULT_CAVE_RANGE_PRESETS_OVERWORLD
}

// ── Region-gridded data layers ─────────────────────────────────────────────────
// Every non-tile data layer (markers and per-chunk grids alike) is split into
// one file per grid tile instead of one flat array per dimension, so a
// fully-explored world's tens of thousands of block entities/entities don't
// have to download as one blob before a single marker renders. POI/block-
// entities/entities use one file per world region (512×512 blocks, matching
// .mca and listRegions), which also matches the live app's existing
// minCx/minCz/maxCx/maxCz windowing so overlayTileWorker.ts's client-side
// rendering is reused largely unchanged. Structures use a coarser tile (see
// STRUCTURE_TILE_BLOCK_SIZE) since their positions aren't tied to real chunk
// data and are sparse enough that region-sized files are mostly empty.
//
// An empty region file is simply not written; DimensionManifest.regions lists
// which (rx, rz) exist so the viewer never has to 404-probe.
export const REGION_BLOCK_SIZE = 512 // 32 chunks/axis, matches .mca region size

// Structures get their own coarser grid — see STRUCTURE_TILE_BLOCK_SIZE in
// static_export.rs for why. Files are still named "{rx}_{rz}.json", just with
// rx/rz measured in STRUCTURE_TILE_BLOCK_SIZE units instead of REGION_BLOCK_SIZE.
export const STRUCTURE_TILE_BLOCK_SIZE = REGION_BLOCK_SIZE * 16

export interface GridLayerManifest {
  path: string   // relative dir; files named "{rx}_{rz}.json"
  /** Raw payload shape per file, matching the IPC call/record type it stands in for. */
  format: 'poi' | 'block-entities' | 'entities' | 'structures'   // PoiRecord[] / BlockEntity[] / GameEntity[] / ExportedStructure[]
}

// ── Vector data layers ─────────────────────────────────────────────────────────

/** One entry of a 'structures' GridLayerManifest file — cubiomes_find_all_structures
 *  positions, each with its chest loot-table composition and (optionally) rolled loot. */
export interface ExportedStructure {
  structType:    string   // StructureHit.struct_type
  x:             number
  z:             number
  flags:         number
  variantTag?:   string
  variantColor?: string
  /** cubiomes_get_structure_chests — cheap, always included. */
  chests: ChestSlot[]
  /** cubiomes_get_structure_loot — rolled item drops. Opt-in per structure type
   *  at export time: rolling loot for every buried treasure on a large map isn't free. */
  loot?: LootItem[]
}

export interface DimensionManifest {
  dimension: ExportDimension
  /** Block-space bounds the export actually covers — the site is only
   *  "fully functional" inside this box; panning past it shows empty tiles. */
  bounds: { minBlockX: number; minBlockZ: number; maxBlockX: number; maxBlockZ: number }
  /** Region coords (rx, rz — REGION_BLOCK_SIZE each) that have at least one
   *  non-empty grid-layer file in this dimension, from `listRegions`. The
   *  viewer intersects this against the current view instead of probing. */
  regions: [number, number][]

  /** This dimension's own named Y-bands (see defaultCaveRangePresets) — not
   *  shared across dimensions, since Overworld and Nether don't share a Y
   *  space. Matched against the shared yFilterLow/High to resolve tiles.cave[id]. */
  caveRangePresets: CaveRangePreset[]

  tiles: {
    biome?:          TileLayerManifest   // renderBiomeTile
    underground?:    TileLayerManifest   // renderUndergroundBiomeTile
    chunk?:          TileLayerManifest   // renderTile, hideWater=false
    chunkHideWater?: TileLayerManifest   // renderTile, hideWater=true
    /** Keyed by this dimension's caveRangePresets[].id. renderTile with caveY set per preset. */
    cave?: Record<string, TileLayerManifest>
    // Baked to PNG at export time (server-side port of overlayTileWorker.ts's
    // pixel math) so the viewer just loads an image uniformly across every
    // layer. oreVeins is Overworld-only; carvers/oreFeatures skip the End;
    // localDifficulty needs real save data (java .mca only).
    oreVeins?:        TileLayerManifest
    oreFeatures?:     TileLayerManifest
    carvers?:         TileLayerManifest
    localDifficulty?: TileLayerManifest
  }

  // gatewayLinks/spawn stay as single flat files — at most 20 gateways and one
  // spawn point per dimension, splitting by region would be pure overhead.
  data: {
    poi?:            GridLayerManifest   // format: 'poi'
    blockEntities?:  GridLayerManifest   // format: 'block-entities' (ground truth incl. already-looted chests)
    entities?:       GridLayerManifest   // format: 'entities'
    structures?:     GridLayerManifest   // format: 'structures'
    gatewayLinks?:   string   // cubiomes_get_end_gateway_links -> GatewayLink[] (end only, flat)
    spawn?:          string   // cubiomes_get_spawn -> { x: number; z: number } (overworld only, flat)
    // Slime chunks are NOT exported — a pure function of (seed, cx, cz), cheap
    // enough for the static viewer to evaluate directly in JS (tauriAPI.static.ts).
  }
}

// ── Top-level manifest ─────────────────────────────────────────────────────────

export interface ExportManifest {
  formatVersion: typeof EXPORT_FORMAT_VERSION
  generatedAt: string   // ISO 8601
  generator: { app: 'sojourner'; appVersion: string }

  world: {
    levelName:     string
    seed:          string   // decimal string, not number — exceeds JS safe-integer range
    mcVersion:     number
    dataVersion:   number
    versionName:   string
    edition:       ExportEdition
    worldType:     WorldType
    difficulty:    number
    borderCenterX: number
    borderCenterZ: number
    borderSize:    number
    gameRules:     Record<string, string>
  }

  tileGrid: {
    baseBlocksPerPixel: number   // BASE_BLOCKS_PER_PIXEL, 16 today
    /** NOT authoritative per-layer — different tile layers can have different
     *  real pixel sizes in the same export. Use getTileSizes(dimension) from
     *  tauriAPI instead, which reads each layer's own TileLayerManifest.tileSize. */
    tileSize: number
    minZoom: number
    maxZoom: number
  }

  dimensions: DimensionManifest[]

  /** Baked starting values for the static viewer's settings panel — same
   *  shape the live app persists to `localStorage['mcmap:session']`, so the
   *  exported site seeds that key on first load and behaves identically
   *  from then on (including the user's own edits, which stay local to
   *  their browser and are never sent anywhere). */
  defaultSettings: OverlaySession
  markerGroups: CustomMarkerGroup[]

  // Pins and saved routes are NOT exported — purely client-side
  // (localStorage['mcmap:pins']/['mcmap:routes'], worldSlice.ts); the static
  // viewer reuses that code unchanged, starting empty.

  /** Reserved for a future update-service poll (e.g. HEAD on manifest.json) to
   *  detect a re-export landed. Not wired to anything yet. */
  updateToken?: string
}

// ── meta.json — a small sibling of manifest.json ─────────────────────────────
// Written alongside manifest.json (see static_export.rs::run_static_export),
// meant for something that just wants to *describe* the bundle — e.g. a
// worlds/ index page building version/size/layer-pills for several exports —
// without paying for manifest.json's full per-tile-layer paths and
// region-coordinate lists (hundreds of KB on a large world).

export interface ExportMeta {
  formatVersion: typeof EXPORT_FORMAT_VERSION
  generatedAt:   string   // ISO 8601
  levelName:     string
  versionName:   string
  edition:       ExportEdition
  dimensions:    ExportDimension[]
  /** Total region files across all exported dimensions. */
  regions:       number
  /** Mirrors the export dialog's toggleable options (StaticExportParams'
   *  `include_*` flags) — what was chosen, not whether it ended up non-empty
   *  for this particular world. */
  layers: {
    biome:           boolean
    underground:     boolean
    chunk:           boolean
    chunkHideWater:  boolean
    cave:            boolean
    oreVeins:        boolean
    carvers:         boolean
    localDifficulty: boolean
  }
}
