import { DEFAULT_CHUNK_DATA_MIN_ZOOM } from '../lib/constants'
import { CustomMarkerGroup, DEFAULT_MARKER_GROUPS } from '../lib/markerFilters'
import { ORE_FEATURE_DEFS } from '../lib/oreFeatures'

const ALL_ORE_FEATURE_IDS = ORE_FEATURE_DEFS.map(d => d.id)

export interface OverlayState {
  showBiomes: boolean
  biomeOpacity: number
  showChunkData: boolean
  chunkOpacity: number
  chunkDataMinZoom: number
  showSlimeChunks: boolean
  slimeOpacity: number
  showOreVeins: boolean
  showCopperVeins: boolean
  showIronVeins: boolean
  oreVeinMode: 'density' | 'footprint'
  oreOpacity: number
  showOreFeatures: boolean
  oreFeatureTypes: string[]
  showCarvers: boolean
  carverOpacity: number
  showTerrain: boolean
  terrainOpacity: number
  hideWater: boolean
  showChunkGrid: boolean
  showRegionGrid: boolean
  showSpawnRadius: boolean
  showStructures: boolean
  showMarkers: boolean
  markerGroupDefs: CustomMarkerGroup[]
  enabledMarkerGroups: Set<string>
  markerYFilterEnabled: boolean
  markerYFilterRadius: number
  caveMode: boolean
  caveScanLow: number
  caveScanHigh: number
  showCaveEntrances: boolean
  caveEntranceOpacity: number
  showLocalDifficulty: boolean
  biomeMode: 'surface' | 'underground' | 'deep'
  tileCacheVersion: number
  overlayCacheVersion: number
  structureRevision: number
  debugOverlayOpen: boolean
  zoom: number
  uiScale: number
  rulerActive: boolean
  rulerWaypoints: { x: number; z: number }[]
}

export type OverlayAction =
  | { type: 'TOGGLE_BIOMES' }
  | { type: 'SET_BIOME_OPACITY'; opacity: number }
  | { type: 'TOGGLE_CHUNK_DATA' }
  | { type: 'SET_CHUNK_OPACITY'; opacity: number }
  | { type: 'SET_CHUNK_DATA_MIN_ZOOM'; zoom: number }
  | { type: 'TOGGLE_SLIME_CHUNKS' }
  | { type: 'SET_SLIME_OPACITY'; opacity: number }
  | { type: 'TOGGLE_ORE_VEINS' }
  | { type: 'TOGGLE_COPPER_VEINS' }
  | { type: 'TOGGLE_IRON_VEINS' }
  | { type: 'SET_ORE_VEIN_MODE'; mode: 'density' | 'footprint' }
  | { type: 'SET_ORE_OPACITY'; opacity: number }
  | { type: 'TOGGLE_ORE_FEATURES' }
  | { type: 'SET_ORE_FEATURE_TYPES'; ids: string[] }
  | { type: 'TOGGLE_CARVERS' }
  | { type: 'SET_CARVER_OPACITY'; opacity: number }
  | { type: 'TOGGLE_TERRAIN' }
  | { type: 'SET_TERRAIN_OPACITY'; opacity: number }
  | { type: 'TOGGLE_HIDE_WATER' }
  | { type: 'TOGGLE_CHUNK_GRID' }
  | { type: 'TOGGLE_REGION_GRID' }
  | { type: 'TOGGLE_SPAWN_RADIUS' }
  | { type: 'TOGGLE_STRUCTURES' }
  | { type: 'TOGGLE_MARKERS' }
  | { type: 'SET_MARKER_GROUP'; group: string; enabled: boolean }
  | { type: 'SET_ALL_MARKER_GROUPS'; enabled: boolean }
  | { type: 'ADD_MARKER_GROUP'; group: CustomMarkerGroup }
  | { type: 'UPDATE_MARKER_GROUP'; id: string; changes: Partial<Omit<CustomMarkerGroup, 'id'>> }
  | { type: 'DELETE_MARKER_GROUP'; id: string }
  | { type: 'RESET_MARKER_GROUPS' }
  | { type: 'SET_MARKER_Y_FILTER'; enabled?: boolean; radius?: number }
  | { type: 'TOGGLE_CAVE_MODE' }
  | { type: 'SET_CAVE_SCAN_RANGE'; low: number; high: number }
  | { type: 'TOGGLE_CAVE_ENTRANCES' }
  | { type: 'SET_CAVE_ENTRANCE_OPACITY'; opacity: number }
  | { type: 'TOGGLE_LOCAL_DIFFICULTY' }
  | { type: 'SET_BIOME_MODE'; mode: 'surface' | 'underground' | 'deep' }
  | { type: 'CLEAR_TILE_CACHE' }
  | { type: 'CLEAR_OVERLAY_CACHE' }
  | { type: 'CLEAR_STRUCTURE_CACHE' }
  | { type: 'TOGGLE_DEBUG_OVERLAY' }
  | { type: 'RESET_OVERLAYS' }
  | { type: 'SET_ZOOM'; zoom: number }
  | { type: 'SET_UI_SCALE'; scale: number }
  | { type: 'RULER_TOGGLE' }
  | { type: 'RULER_ADD_WAYPOINT'; x: number; z: number }
  | { type: 'RULER_UNDO' }
  | { type: 'RULER_CLEAR' }

// ── Session persistence ───────────────────────────────────────────────────────

export interface OverlaySession {
  showBiomes?: boolean
  biomeOpacity?: number
  chunkOpacity?: number
  slimeOpacity?: number
  oreOpacity?: number
  hideWater?: boolean
  showSlimeChunks?: boolean
  showCopperVeins?: boolean
  showIronVeins?: boolean
  oreVeinMode?: 'density' | 'footprint'
  oreFeatureTypes?: string[]
  carverOpacity?: number
  terrainOpacity?: number
  showChunkData?: boolean
  chunkDataMinZoom?: number
  showChunkGrid?: boolean
  showRegionGrid?: boolean
  showSpawnRadius?: boolean
  showStructures?: boolean
  showMarkers?: boolean
  markerGroupDefs?: CustomMarkerGroup[]
  enabledMarkerGroups?: string[]
  markerYFilterEnabled?: boolean
  markerYFilterRadius?: number
  showCaveEntrances?: boolean
  caveEntranceOpacity?: number
  showLocalDifficulty?: boolean
  biomeMode?: 'surface' | 'underground' | 'deep'
  zoom?: number
  uiScale?: number
}

export function loadOverlaySession(): OverlaySession {
  try {
    const raw = localStorage.getItem('mcmap:session')
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

export function saveOverlaySession(
  state: OverlayState & { selectedVersion?: string; dimension?: string },
  structuresByDimension: unknown,
): void {
  const session = {
    selectedVersion:         state.selectedVersion,
    dimension:               state.dimension,
    structuresByDimension,
    showBiomes:              state.showBiomes,
    biomeOpacity:            state.biomeOpacity,
    chunkOpacity:            state.chunkOpacity,
    slimeOpacity:            state.slimeOpacity,
    oreOpacity:              state.oreOpacity,
    hideWater:               state.hideWater,
    showSlimeChunks:         state.showSlimeChunks,
    showCopperVeins:         state.showCopperVeins,
    showIronVeins:           state.showIronVeins,
    oreVeinMode:             state.oreVeinMode,
    oreFeatureTypes:         state.oreFeatureTypes,
    carverOpacity:           state.carverOpacity,
    terrainOpacity:          state.terrainOpacity,
    showChunkData:           state.showChunkData,
    chunkDataMinZoom:        state.chunkDataMinZoom,
    showChunkGrid:           state.showChunkGrid,
    showRegionGrid:          state.showRegionGrid,
    showSpawnRadius:         state.showSpawnRadius,
    showStructures:          state.showStructures,
    showMarkers:             state.showMarkers,
    markerGroupDefs:         state.markerGroupDefs,
    enabledMarkerGroups:     [...state.enabledMarkerGroups],
    markerYFilterEnabled:    state.markerYFilterEnabled,
    markerYFilterRadius:     state.markerYFilterRadius,
    showCaveEntrances:       state.showCaveEntrances,
    caveEntranceOpacity:     state.caveEntranceOpacity,
    showLocalDifficulty:     state.showLocalDifficulty,
    biomeMode:               state.biomeMode,
    zoom:                    state.zoom,
    uiScale:                 state.uiScale,
  }
  localStorage.setItem('mcmap:session', JSON.stringify(session))
}

// ── Initial state ─────────────────────────────────────────────────────────────

export function overlayInitialState(s: OverlaySession): OverlayState {
  return {
    showBiomes:              s.showBiomes              ?? true,
    biomeOpacity:            s.biomeOpacity             ?? 1,
    showChunkData:           s.showChunkData            ?? true,
    chunkOpacity:            s.chunkOpacity             ?? 1,
    chunkDataMinZoom:        s.chunkDataMinZoom          ?? DEFAULT_CHUNK_DATA_MIN_ZOOM,
    showSlimeChunks:         s.showSlimeChunks           ?? false,
    slimeOpacity:            s.slimeOpacity              ?? 1,
    showOreVeins:            false,
    showCopperVeins:         s.showCopperVeins           ?? true,
    showIronVeins:           s.showIronVeins             ?? true,
    oreVeinMode:             s.oreVeinMode               ?? 'density',
    oreOpacity:              s.oreOpacity               ?? 1,
    showOreFeatures:         false,
    oreFeatureTypes:         s.oreFeatureTypes           ?? ALL_ORE_FEATURE_IDS,
    showCarvers:             false,
    carverOpacity:           s.carverOpacity             ?? 1,
    showTerrain:             false,
    terrainOpacity:          s.terrainOpacity            ?? 0.6,
    hideWater:               s.hideWater                ?? false,
    showChunkGrid:           s.showChunkGrid             ?? false,
    showRegionGrid:          s.showRegionGrid            ?? false,
    showSpawnRadius:         s.showSpawnRadius           ?? false,
    showStructures:          s.showStructures             ?? true,
    showMarkers:             s.showMarkers               ?? false,
    markerGroupDefs:         Array.isArray(s.markerGroupDefs) && s.markerGroupDefs.length > 0
      ? s.markerGroupDefs
      : DEFAULT_MARKER_GROUPS,
    enabledMarkerGroups:     Array.isArray(s.enabledMarkerGroups) && s.enabledMarkerGroups.length > 0
      ? new Set(s.enabledMarkerGroups)
      : new Set(DEFAULT_MARKER_GROUPS.map(g => g.id)),
    markerYFilterEnabled:    s.markerYFilterEnabled      ?? false,
    markerYFilterRadius:     s.markerYFilterRadius       ?? 32,
    caveMode:                false,
    caveScanLow:             -40,
    caveScanHigh:            40,
    showCaveEntrances:       s.showCaveEntrances         ?? false,
    caveEntranceOpacity:     s.caveEntranceOpacity       ?? 0.7,
    showLocalDifficulty:     s.showLocalDifficulty       ?? false,
    biomeMode:               s.biomeMode                 ?? 'surface',
    tileCacheVersion:        0,
    overlayCacheVersion:     0,
    structureRevision:       0,
    debugOverlayOpen:        false,
    zoom:                    s.zoom                     ?? 2,
    uiScale:                 s.uiScale                  ?? 1,
    rulerActive:             false,
    rulerWaypoints:          [],
  }
}

// ── Reducer ───────────────────────────────────────────────────────────────────

const RESET: OverlayState = {
  showBiomes: true, biomeOpacity: 1, chunkOpacity: 1, slimeOpacity: 1, oreOpacity: 1,
  showChunkData: true, chunkDataMinZoom: DEFAULT_CHUNK_DATA_MIN_ZOOM,
  showSlimeChunks: false, showOreVeins: false, showCopperVeins: true, showIronVeins: true,
  oreVeinMode: 'density',
  showOreFeatures: false, oreFeatureTypes: ALL_ORE_FEATURE_IDS,
  showCarvers: false, carverOpacity: 1, showTerrain: false, terrainOpacity: 0.6,
  hideWater: false, showChunkGrid: false, showRegionGrid: false, showSpawnRadius: false,
  showStructures: true,
  showMarkers: false,
  markerGroupDefs: DEFAULT_MARKER_GROUPS,
  enabledMarkerGroups: new Set(DEFAULT_MARKER_GROUPS.map(g => g.id)),
  markerYFilterEnabled: false, markerYFilterRadius: 32,
  caveMode: false, caveScanLow: -40, caveScanHigh: 40,
  showCaveEntrances: false, caveEntranceOpacity: 0.7,
  showLocalDifficulty: false,
  biomeMode: 'surface',
  tileCacheVersion: 0, overlayCacheVersion: 0, structureRevision: 0, debugOverlayOpen: false, zoom: 2, uiScale: 1,
  rulerActive: false, rulerWaypoints: [],
}

export function overlayReducer<S extends OverlayState>(state: S, action: { type: string }): S {
  switch (action.type) {
    case 'TOGGLE_BIOMES':
      return { ...state, showBiomes: !state.showBiomes }
    case 'SET_BIOME_OPACITY': {
      const a = action as OverlayAction & { type: 'SET_BIOME_OPACITY' }
      return { ...state, biomeOpacity: a.opacity }
    }
    case 'TOGGLE_CHUNK_DATA':
      return { ...state, showChunkData: !state.showChunkData }
    case 'SET_CHUNK_OPACITY': {
      const a = action as OverlayAction & { type: 'SET_CHUNK_OPACITY' }
      return { ...state, chunkOpacity: a.opacity }
    }
    case 'SET_CHUNK_DATA_MIN_ZOOM': {
      const a = action as OverlayAction & { type: 'SET_CHUNK_DATA_MIN_ZOOM' }
      return { ...state, chunkDataMinZoom: a.zoom }
    }
    case 'TOGGLE_SLIME_CHUNKS':
      return { ...state, showSlimeChunks: !state.showSlimeChunks }
    case 'SET_SLIME_OPACITY': {
      const a = action as OverlayAction & { type: 'SET_SLIME_OPACITY' }
      return { ...state, slimeOpacity: a.opacity }
    }
    case 'TOGGLE_ORE_VEINS':
      return { ...state, showOreVeins: !state.showOreVeins }
    case 'TOGGLE_COPPER_VEINS':
      return { ...state, showCopperVeins: !state.showCopperVeins }
    case 'TOGGLE_IRON_VEINS':
      return { ...state, showIronVeins: !state.showIronVeins }
    case 'SET_ORE_VEIN_MODE': {
      const a = action as OverlayAction & { type: 'SET_ORE_VEIN_MODE' }
      return { ...state, oreVeinMode: a.mode }
    }
    case 'SET_ORE_OPACITY': {
      const a = action as OverlayAction & { type: 'SET_ORE_OPACITY' }
      return { ...state, oreOpacity: a.opacity }
    }
    case 'TOGGLE_ORE_FEATURES':
      return { ...state, showOreFeatures: !state.showOreFeatures }
    case 'SET_ORE_FEATURE_TYPES': {
      const a = action as OverlayAction & { type: 'SET_ORE_FEATURE_TYPES' }
      return { ...state, oreFeatureTypes: a.ids }
    }
    case 'TOGGLE_CARVERS':
      return { ...state, showCarvers: !state.showCarvers }
    case 'SET_CARVER_OPACITY': {
      const a = action as OverlayAction & { type: 'SET_CARVER_OPACITY' }
      return { ...state, carverOpacity: a.opacity }
    }
    case 'TOGGLE_TERRAIN':
      return { ...state, showTerrain: !state.showTerrain }
    case 'SET_TERRAIN_OPACITY': {
      const a = action as OverlayAction & { type: 'SET_TERRAIN_OPACITY' }
      return { ...state, terrainOpacity: a.opacity }
    }
    case 'TOGGLE_HIDE_WATER':
      return { ...state, hideWater: !state.hideWater }
    case 'TOGGLE_CHUNK_GRID':
      return { ...state, showChunkGrid: !state.showChunkGrid }
    case 'TOGGLE_REGION_GRID':
      return { ...state, showRegionGrid: !state.showRegionGrid }
    case 'TOGGLE_SPAWN_RADIUS':
      return { ...state, showSpawnRadius: !state.showSpawnRadius }
    case 'TOGGLE_STRUCTURES':
      return { ...state, showStructures: !state.showStructures }
    case 'TOGGLE_MARKERS':
      return { ...state, showMarkers: !state.showMarkers }
    case 'SET_MARKER_GROUP': {
      const a = action as OverlayAction & { type: 'SET_MARKER_GROUP' }
      const next = new Set(state.enabledMarkerGroups)
      a.enabled ? next.add(a.group) : next.delete(a.group)
      return { ...state, enabledMarkerGroups: next }
    }
    case 'SET_ALL_MARKER_GROUPS': {
      const a = action as OverlayAction & { type: 'SET_ALL_MARKER_GROUPS' }
      return { ...state, enabledMarkerGroups: a.enabled ? new Set(state.markerGroupDefs.map(g => g.id)) : new Set() }
    }
    case 'ADD_MARKER_GROUP': {
      const a = action as OverlayAction & { type: 'ADD_MARKER_GROUP' }
      const enabledMarkerGroups = new Set(state.enabledMarkerGroups)
      enabledMarkerGroups.add(a.group.id)
      return { ...state, markerGroupDefs: [...state.markerGroupDefs, a.group], enabledMarkerGroups }
    }
    case 'UPDATE_MARKER_GROUP': {
      const a = action as OverlayAction & { type: 'UPDATE_MARKER_GROUP' }
      return {
        ...state,
        markerGroupDefs: state.markerGroupDefs.map(g => g.id === a.id ? { ...g, ...a.changes } : g),
      }
    }
    case 'DELETE_MARKER_GROUP': {
      const a = action as OverlayAction & { type: 'DELETE_MARKER_GROUP' }
      const enabledMarkerGroups = new Set(state.enabledMarkerGroups)
      enabledMarkerGroups.delete(a.id)
      return {
        ...state,
        markerGroupDefs: state.markerGroupDefs.filter(g => g.id !== a.id),
        enabledMarkerGroups,
      }
    }
    case 'RESET_MARKER_GROUPS':
      return {
        ...state,
        markerGroupDefs: DEFAULT_MARKER_GROUPS,
        enabledMarkerGroups: new Set(DEFAULT_MARKER_GROUPS.map(g => g.id)),
      }
    case 'SET_MARKER_Y_FILTER': {
      const a = action as OverlayAction & { type: 'SET_MARKER_Y_FILTER' }
      return {
        ...state,
        markerYFilterEnabled: a.enabled ?? state.markerYFilterEnabled,
        markerYFilterRadius:  a.radius  ?? state.markerYFilterRadius,
      }
    }
    case 'TOGGLE_CAVE_MODE':
      return { ...state, caveMode: !state.caveMode }
    case 'SET_CAVE_SCAN_RANGE': {
      const a = action as OverlayAction & { type: 'SET_CAVE_SCAN_RANGE' }
      return { ...state, caveScanLow: a.low, caveScanHigh: a.high }
    }
    case 'TOGGLE_CAVE_ENTRANCES':
      return { ...state, showCaveEntrances: !state.showCaveEntrances }
    case 'SET_CAVE_ENTRANCE_OPACITY': {
      const a = action as OverlayAction & { type: 'SET_CAVE_ENTRANCE_OPACITY' }
      return { ...state, caveEntranceOpacity: a.opacity }
    }
    case 'TOGGLE_LOCAL_DIFFICULTY':
      return { ...state, showLocalDifficulty: !state.showLocalDifficulty }
    case 'SET_BIOME_MODE': {
      const a = action as OverlayAction & { type: 'SET_BIOME_MODE' }
      return { ...state, biomeMode: a.mode }
    }
    case 'CLEAR_TILE_CACHE':
      return { ...state, tileCacheVersion: state.tileCacheVersion + 1 }
    case 'CLEAR_OVERLAY_CACHE':
      return { ...state, overlayCacheVersion: state.overlayCacheVersion + 1 }
    case 'TOGGLE_DEBUG_OVERLAY':
      return { ...state, debugOverlayOpen: !state.debugOverlayOpen }
    case 'CLEAR_STRUCTURE_CACHE':
      return { ...state, structureRevision: state.structureRevision + 1 }
    case 'RESET_OVERLAYS':
      return { ...state, ...RESET, tileCacheVersion: state.tileCacheVersion, overlayCacheVersion: state.overlayCacheVersion, debugOverlayOpen: state.debugOverlayOpen, zoom: state.zoom, uiScale: state.uiScale }
    case 'SET_ZOOM': {
      const a = action as OverlayAction & { type: 'SET_ZOOM' }
      return { ...state, zoom: a.zoom }
    }
    case 'SET_UI_SCALE': {
      const a = action as OverlayAction & { type: 'SET_UI_SCALE' }
      return { ...state, uiScale: a.scale }
    }
    case 'RULER_TOGGLE':
      return { ...state, rulerActive: !state.rulerActive, rulerWaypoints: state.rulerActive ? [] : state.rulerWaypoints }
    case 'RULER_ADD_WAYPOINT': {
      const a = action as OverlayAction & { type: 'RULER_ADD_WAYPOINT' }
      return { ...state, rulerWaypoints: [...state.rulerWaypoints, { x: a.x, z: a.z }] }
    }
    case 'RULER_UNDO':
      return { ...state, rulerWaypoints: state.rulerWaypoints.slice(0, -1) }
    case 'RULER_CLEAR':
      return { ...state, rulerWaypoints: [] }
    default:
      return state
  }
}
