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
  oreOpacity: number
  showOreFeatures: boolean
  oreFeatureTypes: string[]
  showCarvers: boolean
  carverOpacity: number
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
  caveMode: boolean
  // Chunk rendering (behind caveMode) and markers (behind markerYFilterEnabled) are two
  // independent on/off switches over one shared Y window — same floor/ceiling either way,
  // just optionally applied to different things. "Cave mode" isn't a distinct rendering
  // path: the backend renders a plain top-down surface when this window's off and a Y-slice
  // when it's on, same pipeline either way (see region_reader.rs's cave_scan_low/high).
  /** Window offsets relative to yFilterAnchorY. */
  yFilterLow: number
  yFilterHigh: number
  /** true → window follows the live player Y; false → frozen at yFilterAnchorY. */
  yFilterLockedToPlayer: boolean
  /** Absolute Y captured at the moment of unlock; null while locked. */
  yFilterAnchorY: number | null
  caveZoomMinOverworld: number
  caveZoomMinNether: number
  showLocalDifficulty: boolean
  biomeMode: 'surface' | 'underground'
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
  /** Non-persisted: dev-only Structures panel mounted — forces chunk-data into
   *  low-zoom region-outline mode at every zoom (region copy doesn't need per-block render). */
  structureCopyPanelOpen: boolean
  /** Non-persisted: checked regions in the Structures panel, for StructureCopySelectionLayer. */
  structureCopySelectedRegions: [number, number][]
  /** Non-persisted: copy granularity — 'region' (v0, whole-.mca), 'chunk' (v1,
   *  relocatable + v2's Y-trim), or 'box' (v3, arbitrary box + rotation/mirror). */
  structureCopyMode: 'region' | 'chunk' | 'box'
  /** Non-persisted: selected chunk coords in chunk mode. */
  structureCopySelectedChunks: [number, number][]
  /** Non-persisted: armed to place the destination anchor on next map click. */
  structureCopyPlacingDest: boolean
  /** Non-persisted: destination anchor chunk (selection's bounding-box min corner) once placed. */
  structureCopyDestChunk: [number, number] | null
  /** Non-persisted, box mode: first-click X/Z corner pending the second. */
  structureCopyBoxAnchor: [number, number] | null
  /** Non-persisted, box mode: finalized X/Z footprint. No Y — can't be picked
   *  from the 2D map, so Y range is local state in StructureCopyFlyout instead. */
  structureCopyBoxSelection: { x0: number; z0: number; x1: number; z1: number } | null
  /** Non-persisted, box mode: armed to place the box destination X/Z on next click. */
  structureCopyPlacingBoxDest: boolean
  /** Non-persisted, box mode: rotated box's min corner, block-granularity
   *  (v3's paste position isn't chunk-aligned); Y set manually, same as above. */
  structureCopyBoxDest: { x: number; y: number; z: number } | null
  /** Non-persisted, box mode: rotation/mirror applied before pasting. */
  structureCopyRotation: 0 | 90 | 180 | 270
  structureCopyMirror: 'x' | 'z' | null
  /** Non-persisted: real block-color thumbnail of the finalized source
   *  selection (box/template/chunk — region mode has none), for the
   *  Preview step and StructureCopyGhostLayer's cursor-following stamp. */
  structureCopyPreview: { dataUrl: string; widthBlocks: number; depthBlocks: number } | null
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
  | { type: 'SET_ORE_OPACITY'; opacity: number }
  | { type: 'TOGGLE_ORE_FEATURES' }
  | { type: 'SET_ORE_FEATURE_TYPES'; ids: string[] }
  | { type: 'TOGGLE_CARVERS' }
  | { type: 'SET_CARVER_OPACITY'; opacity: number }
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
  | { type: 'TOGGLE_LOCAL_DIFFICULTY' }
  | { type: 'SET_BIOME_MODE'; mode: 'surface' | 'underground' }
  | { type: 'CLEAR_TILE_CACHE' }
  | { type: 'CLEAR_OVERLAY_CACHE' }
  | { type: 'CLEAR_STRUCTURE_CACHE' }
  | { type: 'TOGGLE_DEBUG_OVERLAY' }
  | { type: 'RESET_OVERLAYS' }
  | { type: 'SET_ZOOM'; zoom: number }
  | { type: 'APPLY_SHARE_LINK_FILTERS'; filters: Partial<OverlayState> }
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
  | { type: 'SET_STRUCTURE_COPY_PANEL_OPEN'; open: boolean }
  | { type: 'SET_STRUCTURE_COPY_SELECTED_REGIONS'; regions: [number, number][] }
  | { type: 'TOGGLE_STRUCTURE_COPY_REGION'; rx: number; rz: number }
  | { type: 'SET_STRUCTURE_COPY_MODE'; mode: 'region' | 'chunk' | 'box' }
  | { type: 'SET_STRUCTURE_COPY_SELECTED_CHUNKS'; chunks: [number, number][] }
  | { type: 'TOGGLE_STRUCTURE_COPY_CHUNK'; cx: number; cz: number }
  | { type: 'SET_STRUCTURE_COPY_PLACING_DEST'; placing: boolean }
  | { type: 'SET_STRUCTURE_COPY_DEST_CHUNK'; dest: [number, number] | null }
  | { type: 'SET_STRUCTURE_COPY_BOX_ANCHOR'; anchor: [number, number] | null }
  | { type: 'SET_STRUCTURE_COPY_BOX_SELECTION'; selection: { x0: number; z0: number; x1: number; z1: number } | null }
  | { type: 'SET_STRUCTURE_COPY_PLACING_BOX_DEST'; placing: boolean }
  | { type: 'SET_STRUCTURE_COPY_BOX_DEST'; dest: { x: number; y: number; z: number } | null }
  | { type: 'SET_STRUCTURE_COPY_BOX_DEST_XZ'; x: number; z: number }
  | { type: 'SET_STRUCTURE_COPY_ROTATION'; rotation: 0 | 90 | 180 | 270 }
  | { type: 'SET_STRUCTURE_COPY_MIRROR'; mirror: 'x' | 'z' | null }
  | { type: 'SET_STRUCTURE_COPY_PREVIEW'; preview: { dataUrl: string; widthBlocks: number; depthBlocks: number } | null }

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

// The Y the shared window is centred on, regardless of which consumer is asking.
// Locked → live player Y (the window follows them); unlocked → the anchor captured
// at unlock. Null when no position is known yet.
function effectiveYFilterAnchor(
  state: Pick<OverlayState, 'yFilterLockedToPlayer' | 'yFilterAnchorY'>,
  playerY: number | null | undefined,
): number | null {
  if (!state.yFilterLockedToPlayer && state.yFilterAnchorY != null) return state.yFilterAnchorY
  return playerY != null ? Math.floor(playerY) : null
}

// Marker-filter view of the shared Y window: null (no filtering) when markers
// haven't opted in, even if chunk rendering (cave mode) currently has it on.
export function effectiveMarkerAnchorY(
  state: Pick<OverlayState, 'markerYFilterEnabled' | 'yFilterLockedToPlayer' | 'yFilterAnchorY'>,
  playerY: number | null | undefined,
): number | null {
  if (!state.markerYFilterEnabled) return null
  return effectiveYFilterAnchor(state, playerY)
}

// Chunk-rendering (cave mode) view of the same shared Y window: null when cave
// mode hasn't opted in, even if markers currently have the window on.
export function effectiveCaveAnchorY(
  state: Pick<OverlayState, 'caveMode' | 'yFilterLockedToPlayer' | 'yFilterAnchorY'>,
  playerY: number | null | undefined,
): number | null {
  if (!state.caveMode) return null
  return effectiveYFilterAnchor(state, playerY)
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
  oreFeatureTypes?: string[]
  carverOpacity?: number
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
  yFilterLow?: number
  yFilterHigh?: number
  /** Deprecated (pre-unification per-marker fields) — read for migration, never written. */
  markerYLow?: number
  markerYHigh?: number
  /** Deprecated (pre-gauge symmetric radius) — read for migration, never written. */
  markerYFilterRadius?: number
  caveZoomMinOverworld?: number
  caveZoomMinNether?: number
  showLocalDifficulty?: boolean
  biomeMode?: 'surface' | 'underground'
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
    oreFeatureTypes:         state.oreFeatureTypes,
    carverOpacity:           state.carverOpacity,
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
    yFilterLow:              state.yFilterLow,
    yFilterHigh:             state.yFilterHigh,
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
    oreOpacity:              s.oreOpacity               ?? 1,
    showOreFeatures:         false,
    oreFeatureTypes:         s.oreFeatureTypes           ?? ALL_ORE_FEATURE_IDS,
    showCarvers:             false,
    carverOpacity:           s.carverOpacity             ?? 1,
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
      : new Set<string>(['villagers']),
    markerYFilterEnabled:    s.markerYFilterEnabled      ?? false,
    caveMode:                false,
    // Migration: old sessions stored this per-marker (markerYLow/High), and older
    // still as a symmetric radius around the player (markerYFilterRadius).
    yFilterLow:              s.yFilterLow ?? s.markerYLow  ?? (s.markerYFilterRadius != null ? -s.markerYFilterRadius : -40),
    yFilterHigh:             s.yFilterHigh ?? s.markerYHigh ?? (s.markerYFilterRadius != null ?  s.markerYFilterRadius :  40),
    yFilterLockedToPlayer:   true,
    yFilterAnchorY:          null,
    caveZoomMinOverworld:    s.caveZoomMinOverworld      ?? CAVE_MODE_MIN_ZOOM,
    caveZoomMinNether:       s.caveZoomMinNether         ?? CAVE_MODE_MIN_ZOOM,
    showLocalDifficulty:     s.showLocalDifficulty       ?? false,
    // Legacy persisted state may still say 'deep' (removed — Cave/Deep merged
    // into one Y-scanning 'underground' mode); fold it forward instead of
    // letting an old save silently drop into neither surface nor underground.
    biomeMode:               s.biomeMode == null ? 'surface' : s.biomeMode === 'surface' ? 'surface' : 'underground',
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
    structureCopyPanelOpen:      false,
    structureCopySelectedRegions: [],
    structureCopyMode:           'region',
    structureCopySelectedChunks: [],
    structureCopyPlacingDest:    false,
    structureCopyDestChunk:      null,
    structureCopyBoxAnchor:      null,
    structureCopyBoxSelection:   null,
    structureCopyPlacingBoxDest: false,
    structureCopyBoxDest:        null,
    structureCopyRotation:       0,
    structureCopyMirror:         null,
    structureCopyPreview:        null,
  }
}

// ── Reducer ───────────────────────────────────────────────────────────────────

const RESET: OverlayState = {
  showBiomes: true, biomeOpacity: 1, chunkOpacity: 1, slimeOpacity: 1, oreOpacity: 1,
  showChunkData: true, chunkDataMinZoom: DEFAULT_CHUNK_DATA_MIN_ZOOM,
  showSlimeChunks: false, showOreVeins: false, showCopperVeins: true, showIronVeins: true,
  showOreFeatures: false, oreFeatureTypes: ALL_ORE_FEATURE_IDS,
  showCarvers: false, carverOpacity: 1,
  hideWater: false, showChunkGrid: false, showRegionGrid: false, showSpawnRadius: false, showSpawnChunks: false,
  showWorldBorder: false,
  showStructures: true,
  showMarkers: false,
  markerMinZoom: DEFAULT_MARKER_MIN_ZOOM,
  markerGroupDefs: DEFAULT_MARKER_GROUPS,
  enabledMarkerGroups: new Set<string>(['villagers']),
  markerYFilterEnabled: false, caveMode: false,
  yFilterLow: -40, yFilterHigh: 40,
  yFilterLockedToPlayer: true, yFilterAnchorY: null,
  caveZoomMinOverworld: CAVE_MODE_MIN_ZOOM, caveZoomMinNether: CAVE_MODE_MIN_ZOOM,
  showLocalDifficulty: false,
  biomeMode: 'surface',
  tileCacheVersion: 0, overlayCacheVersion: 0, structureRevision: 0, debugOverlayOpen: false, zoom: 2, uiScale: 1,
  rulerActive: false, rulerPlacementMode: false, rulerWaypoints: [], rulerLegModes: [], rulerCurrentMode: 'walk', activeRouteId: null,
  boatMinSegmentBlocks: 32,
  structureCopyPanelOpen: false, structureCopySelectedRegions: [],
  structureCopyMode: 'region', structureCopySelectedChunks: [],
  structureCopyPlacingDest: false, structureCopyDestChunk: null,
  structureCopyBoxAnchor: null, structureCopyBoxSelection: null,
  structureCopyPlacingBoxDest: false, structureCopyBoxDest: null,
  structureCopyRotation: 0, structureCopyMirror: null,
  structureCopyPreview: null,
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
        enabledMarkerGroups: new Set<string>(['villagers']),
      }
    // Chunk (cave mode) and markers are two independent on/off switches over the one
    // shared yFilterLow/High/LockedToPlayer/AnchorY window below — either can adjust
    // it, both see the same result.
    case 'SET_MARKER_Y_FILTER': {
      const a = action as OverlayAction & { type: 'SET_MARKER_Y_FILTER' }
      // Enabling always starts from the predictable default: locked to the
      // player (mirrors TOGGLE_CAVE_MODE).
      const enabling = a.enabled === true && !state.markerYFilterEnabled
      return {
        ...state,
        markerYFilterEnabled: a.enabled ?? state.markerYFilterEnabled,
        yFilterLow:           a.low     ?? state.yFilterLow,
        yFilterHigh:          a.high    ?? state.yFilterHigh,
        ...(enabling ? { yFilterLockedToPlayer: true, yFilterAnchorY: null } : null),
      }
    }
    case 'SET_MARKER_Y_LOCK': {
      const a = action as OverlayAction & { type: 'SET_MARKER_Y_LOCK' }
      return { ...state, yFilterLockedToPlayer: a.locked, yFilterAnchorY: a.locked ? null : a.anchorY }
    }
    case 'TOGGLE_CAVE_MODE':
      // Entering/leaving cave mode always resets to the predictable default:
      // locked to the player.
      return { ...state, caveMode: !state.caveMode, yFilterLockedToPlayer: true, yFilterAnchorY: null }
    case 'SET_CAVE_SCAN_RANGE': {
      const a = action as OverlayAction & { type: 'SET_CAVE_SCAN_RANGE' }
      return { ...state, yFilterLow: a.low, yFilterHigh: a.high }
    }
    case 'SET_CAVE_LOCK': {
      const a = action as OverlayAction & { type: 'SET_CAVE_LOCK' }
      return { ...state, yFilterLockedToPlayer: a.locked, yFilterAnchorY: a.locked ? null : a.anchorY }
    }
    case 'SET_CAVE_ZOOM_MIN': {
      const a = action as OverlayAction & { type: 'SET_CAVE_ZOOM_MIN' }
      return a.dimension === 'nether'
        ? { ...state, caveZoomMinNether: a.min }
        : { ...state, caveZoomMinOverworld: a.min }
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
      return {
        ...state, ...RESET, tileCacheVersion: state.tileCacheVersion, overlayCacheVersion: state.overlayCacheVersion,
        debugOverlayOpen: state.debugOverlayOpen, zoom: state.zoom, uiScale: state.uiScale,
        structureCopyPanelOpen: state.structureCopyPanelOpen, structureCopySelectedRegions: state.structureCopySelectedRegions,
        structureCopyMode: state.structureCopyMode, structureCopySelectedChunks: state.structureCopySelectedChunks,
        structureCopyPlacingDest: state.structureCopyPlacingDest, structureCopyDestChunk: state.structureCopyDestChunk,
        structureCopyBoxAnchor: state.structureCopyBoxAnchor, structureCopyBoxSelection: state.structureCopyBoxSelection,
        structureCopyPlacingBoxDest: state.structureCopyPlacingBoxDest, structureCopyBoxDest: state.structureCopyBoxDest,
        structureCopyRotation: state.structureCopyRotation, structureCopyMirror: state.structureCopyMirror,
        structureCopyPreview: state.structureCopyPreview,
      }
    case 'SET_STRUCTURE_COPY_PANEL_OPEN': {
      const a = action as OverlayAction & { type: 'SET_STRUCTURE_COPY_PANEL_OPEN' }
      return { ...state, structureCopyPanelOpen: a.open }
    }
    case 'SET_STRUCTURE_COPY_SELECTED_REGIONS': {
      const a = action as OverlayAction & { type: 'SET_STRUCTURE_COPY_SELECTED_REGIONS' }
      return { ...state, structureCopySelectedRegions: a.regions }
    }
    case 'TOGGLE_STRUCTURE_COPY_REGION': {
      const a = action as OverlayAction & { type: 'TOGGLE_STRUCTURE_COPY_REGION' }
      const exists = state.structureCopySelectedRegions.some(([rx, rz]) => rx === a.rx && rz === a.rz)
      const next: [number, number][] = exists
        ? state.structureCopySelectedRegions.filter(([rx, rz]) => !(rx === a.rx && rz === a.rz))
        : [...state.structureCopySelectedRegions, [a.rx, a.rz]]
      return { ...state, structureCopySelectedRegions: next }
    }
    case 'SET_STRUCTURE_COPY_MODE': {
      const a = action as OverlayAction & { type: 'SET_STRUCTURE_COPY_MODE' }
      return { ...state, structureCopyMode: a.mode }
    }
    case 'SET_STRUCTURE_COPY_SELECTED_CHUNKS': {
      const a = action as OverlayAction & { type: 'SET_STRUCTURE_COPY_SELECTED_CHUNKS' }
      return { ...state, structureCopySelectedChunks: a.chunks }
    }
    case 'TOGGLE_STRUCTURE_COPY_CHUNK': {
      const a = action as OverlayAction & { type: 'TOGGLE_STRUCTURE_COPY_CHUNK' }
      const exists = state.structureCopySelectedChunks.some(([cx, cz]) => cx === a.cx && cz === a.cz)
      const next: [number, number][] = exists
        ? state.structureCopySelectedChunks.filter(([cx, cz]) => !(cx === a.cx && cz === a.cz))
        : [...state.structureCopySelectedChunks, [a.cx, a.cz]]
      return { ...state, structureCopySelectedChunks: next }
    }
    case 'SET_STRUCTURE_COPY_PLACING_DEST': {
      const a = action as OverlayAction & { type: 'SET_STRUCTURE_COPY_PLACING_DEST' }
      return { ...state, structureCopyPlacingDest: a.placing }
    }
    case 'SET_STRUCTURE_COPY_DEST_CHUNK': {
      const a = action as OverlayAction & { type: 'SET_STRUCTURE_COPY_DEST_CHUNK' }
      return { ...state, structureCopyDestChunk: a.dest, structureCopyPlacingDest: false }
    }
    case 'SET_STRUCTURE_COPY_BOX_ANCHOR': {
      const a = action as OverlayAction & { type: 'SET_STRUCTURE_COPY_BOX_ANCHOR' }
      return { ...state, structureCopyBoxAnchor: a.anchor }
    }
    case 'SET_STRUCTURE_COPY_BOX_SELECTION': {
      const a = action as OverlayAction & { type: 'SET_STRUCTURE_COPY_BOX_SELECTION' }
      return { ...state, structureCopyBoxSelection: a.selection, structureCopyBoxAnchor: null }
    }
    case 'SET_STRUCTURE_COPY_PLACING_BOX_DEST': {
      const a = action as OverlayAction & { type: 'SET_STRUCTURE_COPY_PLACING_BOX_DEST' }
      return { ...state, structureCopyPlacingBoxDest: a.placing }
    }
    case 'SET_STRUCTURE_COPY_BOX_DEST': {
      const a = action as OverlayAction & { type: 'SET_STRUCTURE_COPY_BOX_DEST' }
      return { ...state, structureCopyBoxDest: a.dest, structureCopyPlacingBoxDest: false }
    }
    case 'SET_STRUCTURE_COPY_BOX_DEST_XZ': {
      // Click-to-place only ever sets X/Z (Y can't be picked from a 2D map)
      // — reducer-side merge against whatever Y is already set (or 0) avoids
      // MapView's click handler needing a ref just to read it back.
      const a = action as OverlayAction & { type: 'SET_STRUCTURE_COPY_BOX_DEST_XZ' }
      const y = state.structureCopyBoxDest?.y ?? 0
      return { ...state, structureCopyBoxDest: { x: a.x, y, z: a.z }, structureCopyPlacingBoxDest: false }
    }
    case 'SET_STRUCTURE_COPY_ROTATION': {
      const a = action as OverlayAction & { type: 'SET_STRUCTURE_COPY_ROTATION' }
      return { ...state, structureCopyRotation: a.rotation }
    }
    case 'SET_STRUCTURE_COPY_MIRROR': {
      const a = action as OverlayAction & { type: 'SET_STRUCTURE_COPY_MIRROR' }
      return { ...state, structureCopyMirror: a.mirror }
    }
    case 'SET_STRUCTURE_COPY_PREVIEW': {
      const a = action as OverlayAction & { type: 'SET_STRUCTURE_COPY_PREVIEW' }
      return { ...state, structureCopyPreview: a.preview }
    }
    case 'SET_ZOOM': {
      const a = action as OverlayAction & { type: 'SET_ZOOM' }
      return { ...state, zoom: a.zoom }
    }
    case 'APPLY_SHARE_LINK_FILTERS': {
      const a = action as OverlayAction & { type: 'APPLY_SHARE_LINK_FILTERS' }
      return { ...state, ...a.filters }
    }
    case 'SET_UI_SCALE': {
      const a = action as OverlayAction & { type: 'SET_UI_SCALE' }
      return { ...state, uiScale: a.scale }
    }
    // A world/seed switch invalidates any in-progress route — its waypoints are
    // coordinates in the old world. Unlike Pins/SavedRoutes (already
    // world-scoped storage), the ruler route isn't, so it's cleared explicitly
    // here. rulerActive is left alone so an open panel stays open, just empty.
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
      // View-only by default — loading a route shouldn't also drop you into
      // "map clicks add a point" mode; see RULER_START_EDITING for that opt-in.
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
