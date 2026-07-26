import { DEFAULT_CHUNK_DATA_MIN_ZOOM, DEFAULT_MARKER_MIN_ZOOM, CAVE_MODE_MIN_ZOOM, MAX_ZOOM } from '../lib/constants'
import { CustomMarkerGroup, DEFAULT_MARKER_GROUPS } from '../lib/markerFilters'
import { ORE_FEATURE_DEFS } from '../lib/oreFeatures'
import { TravelMode } from '../lib/travelModes'

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
  showSpawnChunks: boolean
  showWorldBorder: boolean
  showStructures: boolean
  showMarkers: boolean
  markerMinZoom: number
  markerGroupDefs: CustomMarkerGroup[]
  enabledMarkerGroups: Set<string>
  markerYFilterEnabled: boolean
  /** Window offsets relative to the marker Y anchor (cave-gauge model). */
  markerYLow: number
  markerYHigh: number
  /** true → window follows the live player Y; false → frozen at markerYAnchorY. */
  markerYLockedToPlayer: boolean
  /** Absolute Y captured at the moment of unlock; null while locked. */
  markerYAnchorY: number | null
  caveMode: boolean
  caveScanLow: number
  caveScanHigh: number
  /** true → scan window follows the player (offsets track live player Y);
   *  false → window frozen at caveAnchorY, player indicator moves freely. */
  caveLockedToPlayer: boolean
  /** Absolute Y captured at the moment of unlock; null while locked. */
  caveAnchorY: number | null
  caveZoomMinOverworld: number
  caveZoomMinNether: number
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
  rulerPlacementMode: boolean
  rulerWaypoints: { x: number; z: number }[]
  rulerLegModes: TravelMode[]
  rulerCurrentMode: TravelMode
  activeRouteId: string | null
  boatMinSegmentBlocks: number
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
  | { type: 'TOGGLE_SPAWN_CHUNKS' }
  | { type: 'TOGGLE_SPAWN_RADIUS' }
  | { type: 'TOGGLE_WORLD_BORDER' }
  | { type: 'TOGGLE_STRUCTURES' }
  | { type: 'TOGGLE_MARKERS' }
  | { type: 'SET_MARKER_MIN_ZOOM'; zoom: number }
  | { type: 'SET_MARKER_GROUP'; group: string; enabled: boolean }
  | { type: 'SET_ALL_MARKER_GROUPS'; enabled: boolean }
  | { type: 'ADD_MARKER_GROUP'; group: CustomMarkerGroup }
  | { type: 'UPDATE_MARKER_GROUP'; id: string; changes: Partial<Omit<CustomMarkerGroup, 'id'>> }
  | { type: 'DELETE_MARKER_GROUP'; id: string }
  | { type: 'RESET_MARKER_GROUPS' }
  | { type: 'SET_MARKER_Y_FILTER'; enabled?: boolean; low?: number; high?: number }
  | { type: 'SET_MARKER_Y_LOCK'; locked: boolean; anchorY: number | null }
  | { type: 'TOGGLE_CAVE_MODE' }
  | { type: 'SET_CAVE_SCAN_RANGE'; low: number; high: number }
  | { type: 'SET_CAVE_ZOOM_MIN'; dimension: 'overworld' | 'nether'; min: number }
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
  | { type: 'RULER_SET_CURRENT_MODE'; mode: TravelMode }
  | { type: 'RULER_SET_LEG_MODE'; index: number; mode: TravelMode }
  | { type: 'RULER_LOAD_ROUTE'; id: string; waypoints: { x: number; z: number }[]; legModes: TravelMode[] }
  | { type: 'RULER_NEW' }
  | { type: 'RULER_SET_ACTIVE_ROUTE'; id: string | null }
  | { type: 'SET_BOAT_MIN_SEGMENT'; blocks: number }
  | { type: 'RULER_START_EDITING' }
  | { type: 'SET_CAVE_LOCK'; locked: boolean; anchorY: number | null }

// Effective cave-mode zoom range for a dimension. 'end' has no range of its own
// (cave mode has no effect there) and falls back to the overworld range.
// The upper bound is always MAX_ZOOM — there's no reason to cap it lower.
export function caveZoomRange(
  state: Pick<OverlayState, 'caveZoomMinOverworld' | 'caveZoomMinNether'>,
  dimension: string,
): [number, number] {
  return dimension === 'nether'
    ? [state.caveZoomMinNether, MAX_ZOOM]
    : [state.caveZoomMinOverworld, MAX_ZOOM]
}

// Marker-filter counterpart of effectiveCaveAnchorY below: the Y the marker
// window is centred on. Null when the filter is off or no position is known —
// markerYBounds treats null as "no filtering".
export function effectiveMarkerAnchorY(
  state: Pick<OverlayState, 'markerYFilterEnabled' | 'markerYLockedToPlayer' | 'markerYAnchorY'>,
  playerY: number | null | undefined,
): number | null {
  if (!state.markerYFilterEnabled) return null
  if (!state.markerYLockedToPlayer && state.markerYAnchorY != null) return state.markerYAnchorY
  return playerY != null ? Math.floor(playerY) : null
}

// The Y the cave-scan window is centred on. Locked → live player Y (the window
// follows them); unlocked → the anchor captured at unlock. Null when cave mode
// is off or no position is known — callers already treat null as "no cave render".
export function effectiveCaveAnchorY(
  state: Pick<OverlayState, 'caveMode' | 'caveLockedToPlayer' | 'caveAnchorY'>,
  playerY: number | null | undefined,
): number | null {
  if (!state.caveMode) return null
  if (!state.caveLockedToPlayer && state.caveAnchorY != null) return state.caveAnchorY
  return playerY != null ? Math.floor(playerY) : null
}

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
  showSpawnChunks?: boolean
  showSpawnRadius?: boolean
  showWorldBorder?: boolean
  showStructures?: boolean
  showMarkers?: boolean
  markerMinZoom?: number
  markerGroupDefs?: CustomMarkerGroup[]
  enabledMarkerGroups?: string[]
  markerYFilterEnabled?: boolean
  markerYLow?: number
  markerYHigh?: number
  /** Deprecated (pre-gauge symmetric radius) — read for migration, never written. */
  markerYFilterRadius?: number
  showCaveEntrances?: boolean
  caveEntranceOpacity?: number
  caveZoomMinOverworld?: number
  caveZoomMinNether?: number
  showLocalDifficulty?: boolean
  biomeMode?: 'surface' | 'underground' | 'deep'
  zoom?: number
  uiScale?: number
  rulerWaypoints?: { x: number; z: number }[]
  rulerLegModes?: TravelMode[]
  rulerCurrentMode?: TravelMode
  activeRouteId?: string | null
  boatMinSegmentBlocks?: number
  rulerPlacementMode?: boolean
}

export function loadOverlaySession(): OverlaySession {
  try {
    const raw = localStorage.getItem('mcmap:session')
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

export function saveOverlaySession(
  state: OverlayState & {
    selectedVersion?: string; dimension?: string
    disabledStructureVariants?: Set<string>; notableLootOnly?: Set<string>
  },
  structuresByDimension: unknown,
): void {
  const session = {
    selectedVersion:         state.selectedVersion,
    dimension:               state.dimension,
    structuresByDimension,
    disabledStructureVariants: [...(state.disabledStructureVariants ?? [])],
    notableLootOnly:         [...(state.notableLootOnly ?? [])],
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
    showSpawnChunks:         state.showSpawnChunks,
    showWorldBorder:         state.showWorldBorder,
    showStructures:          state.showStructures,
    showMarkers:             state.showMarkers,
    markerMinZoom:           state.markerMinZoom,
    markerGroupDefs:         state.markerGroupDefs,
    enabledMarkerGroups:     [...state.enabledMarkerGroups],
    markerYFilterEnabled:    state.markerYFilterEnabled,
    markerYLow:              state.markerYLow,
    markerYHigh:             state.markerYHigh,
    showCaveEntrances:       state.showCaveEntrances,
    caveEntranceOpacity:     state.caveEntranceOpacity,
    caveZoomMinOverworld:    state.caveZoomMinOverworld,
    caveZoomMinNether:       state.caveZoomMinNether,
    showLocalDifficulty:     state.showLocalDifficulty,
    biomeMode:               state.biomeMode,
    zoom:                    state.zoom,
    uiScale:                 state.uiScale,
    rulerWaypoints:          state.rulerWaypoints,
    rulerLegModes:           state.rulerLegModes,
    rulerCurrentMode:        state.rulerCurrentMode,
    activeRouteId:           state.activeRouteId,
    boatMinSegmentBlocks:    state.boatMinSegmentBlocks,
    rulerPlacementMode:      state.rulerPlacementMode,
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
    showSpawnChunks:         s.showSpawnChunks           ?? false,
    showWorldBorder:         s.showWorldBorder           ?? false,
    showStructures:          s.showStructures             ?? true,
    showMarkers:             s.showMarkers               ?? false,
    markerMinZoom:           s.markerMinZoom             ?? DEFAULT_MARKER_MIN_ZOOM,
    markerGroupDefs:         Array.isArray(s.markerGroupDefs) && s.markerGroupDefs.length > 0
      ? s.markerGroupDefs
      : DEFAULT_MARKER_GROUPS,
    enabledMarkerGroups:     Array.isArray(s.enabledMarkerGroups) && s.enabledMarkerGroups.length > 0
      ? new Set(s.enabledMarkerGroups)
      : new Set(DEFAULT_MARKER_GROUPS.map(g => g.id)),
    markerYFilterEnabled:    s.markerYFilterEnabled      ?? false,
    // Migration: old sessions stored a symmetric radius around the player.
    markerYLow:              s.markerYLow  ?? (s.markerYFilterRadius != null ? -s.markerYFilterRadius : -32),
    markerYHigh:             s.markerYHigh ?? (s.markerYFilterRadius != null ?  s.markerYFilterRadius :  32),
    markerYLockedToPlayer:   true,
    markerYAnchorY:          null,
    caveMode:                false,
    caveScanLow:             -40,
    caveScanHigh:            40,
    caveLockedToPlayer:      true,
    caveAnchorY:             null,
    caveZoomMinOverworld:    s.caveZoomMinOverworld      ?? CAVE_MODE_MIN_ZOOM,
    caveZoomMinNether:       s.caveZoomMinNether         ?? CAVE_MODE_MIN_ZOOM,
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
    rulerPlacementMode:      s.rulerPlacementMode ?? false,
    rulerWaypoints:          Array.isArray(s.rulerWaypoints) ? s.rulerWaypoints : [],
    rulerLegModes:           Array.isArray(s.rulerLegModes) ? s.rulerLegModes : [],
    rulerCurrentMode:        s.rulerCurrentMode ?? 'walk',
    activeRouteId:           s.activeRouteId ?? null,
    boatMinSegmentBlocks:    s.boatMinSegmentBlocks ?? 32,
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
  hideWater: false, showChunkGrid: false, showRegionGrid: false, showSpawnRadius: false, showSpawnChunks: false,
  showWorldBorder: false,
  showStructures: true,
  showMarkers: false,
  markerMinZoom: DEFAULT_MARKER_MIN_ZOOM,
  markerGroupDefs: DEFAULT_MARKER_GROUPS,
  enabledMarkerGroups: new Set(DEFAULT_MARKER_GROUPS.map(g => g.id)),
  markerYFilterEnabled: false, markerYLow: -32, markerYHigh: 32,
  markerYLockedToPlayer: true, markerYAnchorY: null,
  caveMode: false, caveScanLow: -40, caveScanHigh: 40,
  caveLockedToPlayer: true, caveAnchorY: null,
  caveZoomMinOverworld: CAVE_MODE_MIN_ZOOM, caveZoomMinNether: CAVE_MODE_MIN_ZOOM,
  showCaveEntrances: false, caveEntranceOpacity: 0.7,
  showLocalDifficulty: false,
  biomeMode: 'surface',
  tileCacheVersion: 0, overlayCacheVersion: 0, structureRevision: 0, debugOverlayOpen: false, zoom: 2, uiScale: 1,
  rulerActive: false, rulerPlacementMode: false, rulerWaypoints: [], rulerLegModes: [], rulerCurrentMode: 'walk', activeRouteId: null,
  boatMinSegmentBlocks: 32,
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
    case 'TOGGLE_SPAWN_CHUNKS':
      return { ...state, showSpawnChunks: !state.showSpawnChunks }
    case 'TOGGLE_WORLD_BORDER':
      return { ...state, showWorldBorder: !state.showWorldBorder }
    case 'TOGGLE_STRUCTURES':
      return { ...state, showStructures: !state.showStructures }
    case 'TOGGLE_MARKERS':
      return { ...state, showMarkers: !state.showMarkers }
    case 'SET_MARKER_MIN_ZOOM': {
      const a = action as OverlayAction & { type: 'SET_MARKER_MIN_ZOOM' }
      return { ...state, markerMinZoom: a.zoom }
    }
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
      // Enabling always starts from the predictable default: locked to the
      // player (mirrors TOGGLE_CAVE_MODE).
      const enabling = a.enabled === true && !state.markerYFilterEnabled
      return {
        ...state,
        markerYFilterEnabled: a.enabled ?? state.markerYFilterEnabled,
        markerYLow:           a.low     ?? state.markerYLow,
        markerYHigh:          a.high    ?? state.markerYHigh,
        ...(enabling ? { markerYLockedToPlayer: true, markerYAnchorY: null } : null),
      }
    }
    case 'SET_MARKER_Y_LOCK': {
      const a = action as OverlayAction & { type: 'SET_MARKER_Y_LOCK' }
      return { ...state, markerYLockedToPlayer: a.locked, markerYAnchorY: a.locked ? null : a.anchorY }
    }
    case 'TOGGLE_CAVE_MODE':
      // Entering/leaving cave mode always resets to the predictable default:
      // locked to the player.
      return { ...state, caveMode: !state.caveMode, caveLockedToPlayer: true, caveAnchorY: null }
    case 'SET_CAVE_SCAN_RANGE': {
      const a = action as OverlayAction & { type: 'SET_CAVE_SCAN_RANGE' }
      return { ...state, caveScanLow: a.low, caveScanHigh: a.high }
    }
    case 'SET_CAVE_LOCK': {
      const a = action as OverlayAction & { type: 'SET_CAVE_LOCK' }
      return { ...state, caveLockedToPlayer: a.locked, caveAnchorY: a.locked ? null : a.anchorY }
    }
    case 'SET_CAVE_ZOOM_MIN': {
      const a = action as OverlayAction & { type: 'SET_CAVE_ZOOM_MIN' }
      return a.dimension === 'nether'
        ? { ...state, caveZoomMinNether: a.min }
        : { ...state, caveZoomMinOverworld: a.min }
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
    // Cross-cutting: a world/seed switch invalidates any in-progress route — its
    // waypoints are coordinates in the *old* world, meaningless in the new one.
    // Pins/SavedRoutes are already world-scoped storage and reload correctly on
    // their own (worldSlice.ts); the active/in-progress ruler route isn't scoped
    // that way, so it has to be explicitly cleared here or it silently carries
    // over into whatever world loads next. Leaves rulerActive alone — if the
    // panel was open, it stays open, just empty and ready for a new route.
    case 'SET_SEED':
    case 'SET_MANUAL_SEED':
      return { ...state, rulerWaypoints: [], rulerLegModes: [], activeRouteId: null }
    case 'RULER_TOGGLE': {
      const active = !state.rulerActive
      // Toggling via toolbar/hotkey has always meant "I'm about to click points" —
      // keep that: turning the tool on enters placement mode, turning it off exits.
      return { ...state, rulerActive: active, rulerPlacementMode: active }
    }
    case 'RULER_ADD_WAYPOINT': {
      const a = action as OverlayAction & { type: 'RULER_ADD_WAYPOINT' }
      const rulerLegModes = state.rulerWaypoints.length > 0
        ? [...state.rulerLegModes, state.rulerCurrentMode]
        : state.rulerLegModes
      return { ...state, rulerWaypoints: [...state.rulerWaypoints, { x: a.x, z: a.z }], rulerLegModes }
    }
    case 'RULER_UNDO':
      return {
        ...state,
        rulerWaypoints: state.rulerWaypoints.slice(0, -1),
        rulerLegModes: state.rulerLegModes.slice(0, -1),
      }
    case 'RULER_CLEAR':
      return { ...state, rulerWaypoints: [], rulerLegModes: [], activeRouteId: null }
    case 'RULER_SET_CURRENT_MODE': {
      const a = action as OverlayAction & { type: 'RULER_SET_CURRENT_MODE' }
      return { ...state, rulerCurrentMode: a.mode }
    }
    case 'RULER_SET_LEG_MODE': {
      const a = action as OverlayAction & { type: 'RULER_SET_LEG_MODE' }
      return { ...state, rulerLegModes: state.rulerLegModes.map((m, i) => i === a.index ? a.mode : m) }
    }
    case 'RULER_LOAD_ROUTE': {
      const a = action as OverlayAction & { type: 'RULER_LOAD_ROUTE' }
      // View-only by default — promoting/selecting a route (map click on a thin
      // alternate, or the panel's Load button) should not also drop you into
      // "map clicks add a point" mode. See RULER_START_EDITING for the explicit
      // opt-in to actually extend the route.
      return {
        ...state, rulerActive: true, rulerPlacementMode: false,
        rulerWaypoints: a.waypoints, rulerLegModes: a.legModes, activeRouteId: a.id,
      }
    }
    case 'RULER_NEW':
      return { ...state, rulerActive: true, rulerPlacementMode: true, rulerWaypoints: [], rulerLegModes: [], activeRouteId: null }
    case 'RULER_START_EDITING':
      return { ...state, rulerPlacementMode: true }
    case 'RULER_SET_ACTIVE_ROUTE': {
      const a = action as OverlayAction & { type: 'RULER_SET_ACTIVE_ROUTE' }
      return { ...state, activeRouteId: a.id }
    }
    case 'SET_BOAT_MIN_SEGMENT': {
      const a = action as OverlayAction & { type: 'SET_BOAT_MIN_SEGMENT' }
      return { ...state, boatMinSegmentBlocks: a.blocks }
    }
    default:
      return state
  }
}
