// Cubiomes MC_VERSION enum values (from biomes.h)
// Verified against cubiomes submodule
export const MC_VERSIONS = {
  'MC_1_16': 20,     // MC_1_16_5
  'MC_1_17': 21,     // MC_1_17_1
  'MC_1_18': 22,     // MC_1_18_2
  'MC_1_19': 24,     // MC_1_19_4
  'MC_1_20': 25,     // MC_1_20_6
  'MC_1_21_1': 26,   // 1.21 – 1.21.1
  'MC_1_21_3': 27,   // 1.21.2 – 1.21.4
  'MC_1_21': 28,     // MC_1_21_WD / 1.21.5
  'MC_26_1': 33,     // 26.0 – 26.1
  'MC_26_2': 34,     // 26.2 (Chaos Cubed) — adds sulfur_caves
  'MC_26_3': 35,     // 26.3 — adds abandoned_camp + nether terrain (xpple 26.3 branch)
} as const

export type MCVersionKey = keyof typeof MC_VERSIONS

export const MC_VERSION_LABELS: { key: MCVersionKey; label: string; minDataVersion: number }[] = [
  { key: 'MC_26_3',   label: '26.3',              minDataVersion: 4998 },
  { key: 'MC_26_2',   label: '26.2 (Chaos Cubed)', minDataVersion: 4903 },
  { key: 'MC_26_1',   label: '26.0 – 26.1',     minDataVersion: 4787 },
  { key: 'MC_1_21',   label: '1.21.5',          minDataVersion: 4786 },
  { key: 'MC_1_21_3', label: '1.21.2 – 1.21.4', minDataVersion: 4080 },
  { key: 'MC_1_21_1', label: '1.21 – 1.21.1',   minDataVersion: 3953 },
  { key: 'MC_1_20',   label: '1.20',             minDataVersion: 3218 },
  { key: 'MC_1_19',   label: '1.19',             minDataVersion: 2860 },
  { key: 'MC_1_18',   label: '1.18',             minDataVersion: 2724 },
  { key: 'MC_1_17',   label: '1.17',             minDataVersion: 2724 },
  { key: 'MC_1_16',   label: '1.16',             minDataVersion: 2566 },
]

// Data version thresholds from VERSION_MAP in nbt_reader.rs.
// cubiomes (xpple fork, 26.3 branch) supports through 26.3 (MC_26_3);
// sulfur_caves (biome 187) requires MC_26_2. Older 26.x worlds use MC_26_1.
export function dataVersionToMCVersionKey(dataVersion: number): MCVersionKey {
  if (dataVersion >= 4998) return 'MC_26_3'    // 26.3 — abandoned_camp + nether terrain
  if (dataVersion >= 4903) return 'MC_26_2'    // 26.2 (Chaos Cubed) — sulfur caves
  if (dataVersion >= 4787) return 'MC_26_1'    // 26.0 – 26.1
  if (dataVersion >= 4786) return 'MC_1_21'    // 1.21.5 (WD)
  if (dataVersion >= 4080) return 'MC_1_21_3'  // 1.21.2 – 1.21.4
  if (dataVersion >= 3953) return 'MC_1_21_1'  // 1.21 – 1.21.1
  if (dataVersion >= 3218) return 'MC_1_20'
  if (dataVersion >= 2860) return 'MC_1_19'
  if (dataVersion >= 2724) return 'MC_1_18'
  if (dataVersion >= 2566) return 'MC_1_16'
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
