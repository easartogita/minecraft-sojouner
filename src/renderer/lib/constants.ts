// Cubiomes MC_VERSION enum values (biomes.h), trimmed to versions that actually change
// biome/world-gen output (a new biome-parameter tree that adds a biome, or an algorithm
// change) — versions sharing a tree with a neighbor were dropped as dead weight.
export const MC_VERSIONS = {
  'MC_1_16':   20,   // MC_1_16_5 — LayerStack biome-gen baseline (also covers 1.17 — no gen change)
  'MC_1_18':   22,   // MC_1_18_2 — switch to noise-based biome-gen; adds mountain biomes, enables cave biomes
  'MC_1_19':   24,   // MC_1_19_4 — adds deep_dark + mangrove_swamp
  'MC_1_20':   25,   // MC_1_20_6 — adds cherry_grove (also covers 1.21 – 1.21.3 — same tree, no gen change)
  'MC_1_21_4': 28,   // MC_1_21_WD (Winter Drop) — adds pale_garden (also covers 1.21.5 – 26.1 — same tree, no new biome)
  'MC_26_2':   34,   // 26.2 — adds sulfur_caves
  'MC_26_3':   35,   // 26.3 — adds abandoned_camp + dappled_forest
} as const

export type MCVersionKey = keyof typeof MC_VERSIONS

export const MC_VERSION_LABELS: { key: MCVersionKey; label: string; minDataVersion: number }[] = [
  { key: 'MC_26_3',   label: '26.3',           minDataVersion: 4998 },
  { key: 'MC_26_2',   label: '26.2',           minDataVersion: 4903 },
  { key: 'MC_1_21_4', label: '1.21.4 – 26.1',  minDataVersion: 4189 },
  { key: 'MC_1_20',   label: '1.20 – 1.21.3',  minDataVersion: 3218 },
  { key: 'MC_1_19',   label: '1.19',           minDataVersion: 2860 },
  { key: 'MC_1_18',   label: '1.18',           minDataVersion: 2724 },
  { key: 'MC_1_16',   label: '1.16 – 1.17',    minDataVersion: 2566 },
]

// Data version thresholds from VERSION_MAP in nbt_reader.rs, collapsed onto the
// trimmed MC_VERSIONS buckets above.
export function dataVersionToMCVersionKey(dataVersion: number): MCVersionKey {
  if (dataVersion >= 4998) return 'MC_26_3'
  if (dataVersion >= 4903) return 'MC_26_2'
  if (dataVersion >= 4189) return 'MC_1_21_4'  // 1.21.4 (Winter Drop) through 26.1 — pale garden
  if (dataVersion >= 3218) return 'MC_1_20'    // 1.20 through 1.21.3 — cherry grove
  if (dataVersion >= 2860) return 'MC_1_19'    // deep dark + mangrove swamp
  if (dataVersion >= 2724) return 'MC_1_18'    // noise-based biome-gen; mountain biomes
  if (dataVersion >= 2566) return 'MC_1_16'    // 1.16 through 1.17 — LayerStack baseline
  return 'MC_1_16'
}

export const DIMENSIONS = ['overworld', 'nether', 'end'] as const
export type Dimension = typeof DIMENSIONS[number]

export const DIMENSION_IDS: Record<Dimension, number> = {
  overworld: 0,
  nether: -1,
  end: 1,
}

// Tile size in pixels
export const TILE_SIZE = 256
// Smaller tile size used for chunk (MCA) overlay tiles — more tiles, finer fill-in
export const CHUNK_TILE_SIZE = 128
// Biome tile size — 128px so at maxNativeZoom=2 (bpp=4) each tile covers exactly 1 MCA region (512 blocks)
export const BIOME_TILE_SIZE = 128
// Blocks per pixel at zoom level 0
export const BASE_BLOCKS_PER_PIXEL = 16

// Leaflet zoom range (must match MapView.tsx)
export const MIN_ZOOM = -2
export const MAX_ZOOM = 8

// Zoom threshold at which real chunk data (region files) is used instead of
// procedural biome colours. Configurable at runtime via state.chunkDataMinZoom.
export const DEFAULT_CHUNK_DATA_MIN_ZOOM = 2

// Zoom threshold at which entity/block-entity/POI markers load.
// Configurable at runtime via state.markerMinZoom.
export const DEFAULT_MARKER_MIN_ZOOM = 3

// Default minimum zoom allowed while Cave Mode is active — configurable per
// dimension at runtime via state.caveZoomMinOverworld/caveZoomMinNether.
// The upper bound is always MAX_ZOOM; there's no reason to cap it below that.
export const CAVE_MODE_MIN_ZOOM = 4
export const CAVE_MODE_ZOOM = 7
