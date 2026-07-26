import { MCVersionKey, dataVersionToMCVersionKey, Dimension } from '../lib/constants'
import { StructureType, getStructuresForDimension, getDefaultStructures, structureVariantKey } from '../lib/structureConfig'
import { loadWorldSettings } from '../lib/worldSettings'
import { TravelMode } from '../lib/travelModes'

export type WorldType = 'default' | 'large_biomes' | 'amplified' | 'flat' | 'single_biome' | 'custom'

export interface Pin {
  id: string
  x: number
  z: number
  label: string
  dimension: Dimension
  crossDimensional: boolean
}

export interface SavedRoute {
  id: string
  name: string
  dimension: Dimension
  waypoints: { x: number; z: number }[]
  legModes: TravelMode[]
  createdAt: number
}

export interface WorldState {
  levelDatPath: string | null
  worldDir: string | null
  seedData: SeedData | null
  selectedVersion: MCVersionKey
  dimension: Dimension
  enabledStructures: Set<StructureType>
  structuresByDimension: Partial<Record<Dimension, StructureType[]>>
  /** Excluded structure variants, keys from structureVariantKey(). Empty set =
   *  all variants render. Global (not per-dimension): each StructureType
   *  already belongs to exactly one dimension, so keys are self-partitioned. */
  disabledStructureVariants: Set<string>
  /** Structure types currently filtered to "notable loot only" (e.g. End City
   *  → has a ship, Shipwreck → has a treasure chest). Unlike variants, this
   *  isn't known until the async per-instance chest fetch resolves — see
   *  NOTABLE_LOOT_CHECK in StructureLayer.tsx. */
  notableLootOnly: Set<StructureType>
  worldType: WorldType
  isWatching: boolean
  followPlayer: boolean
  worldLoadCount: number
  lastUpdate: number
  changedRegions: [number, number][]
  error: string | null
  pins: Pin[]
  savedRoutes: SavedRoute[]
  recentWorlds: string[]
  unlimitedCache: boolean
}

export type WorldAction =
  | { type: 'SET_SEED'; path: string; data: SeedData }
  | { type: 'SET_MANUAL_SEED'; seed: string; version: MCVersionKey; worldType?: WorldType }
  | { type: 'SET_VERSION'; version: MCVersionKey }
  | { type: 'SET_DIMENSION'; dimension: Dimension }
  | { type: 'TOGGLE_STRUCTURE'; structure: StructureType }
  | { type: 'TOGGLE_STRUCTURE_VARIANT'; structure: StructureType; tag: string | null }
  | { type: 'TOGGLE_NOTABLE_LOOT_ONLY'; structure: StructureType }
  | { type: 'SET_ALL_STRUCTURES'; structures: StructureType[]; enabled: boolean }
  | { type: 'TOGGLE_FOLLOW_PLAYER' }
  | { type: 'SET_FOLLOW_PLAYER'; follow: boolean }
  | { type: 'SET_WORLD_TYPE'; worldType: WorldType }
  | { type: 'SET_WATCHING'; watching: boolean }
  | { type: 'SEED_UPDATED'; data: SeedData }
  | { type: 'REGION_CHANGED'; dimension: string; regions: [number, number][] }
  | { type: 'SYNC_DAY_TIME'; dayTime: number }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'ADD_PIN'; pin: Pin }
  | { type: 'REMOVE_PIN'; id: string }
  | { type: 'UPDATE_PIN'; id: string; changes: Partial<Pick<Pin, 'label' | 'crossDimensional'>> }
  | { type: 'ADD_ROUTE'; route: SavedRoute }
  | { type: 'REMOVE_ROUTE'; id: string }
  | { type: 'UPDATE_ROUTE'; id: string; changes: Partial<Pick<SavedRoute, 'name' | 'waypoints' | 'legModes'>> }
  | { type: 'SET_UNLIMITED_CACHE'; enabled: boolean }

// ── Pin storage — world-scoped ────────────────────────────────────────────────

// Pins are user data, not a regenerable cache — their storage key must stay
// stable when a world is upgraded. So key on the save itself (level.dat path),
// never the worldgen version. The `version` param is kept only to recover pins
// written by older builds that baked it into the seed key (see migration below).
export function pinWorldKey(levelDatPath: string | null, seed: string | null, _version?: MCVersionKey): string | null {
  if (levelDatPath) return levelDatPath
  if (seed) return `seed:${seed}`
  return null
}

function loadAllPins(): Record<string, Pin[]> {
  try {
    const raw = localStorage.getItem('mcmap:pins')
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return {}   // old flat format — discard
    const all = parsed as Record<string, Pin[]>

    // Migrate legacy version-suffixed seed keys (`seed:<seed>:<MC_VERSION>`) to
    // the version-independent `seed:<seed>`, merging if several versions exist.
    let migrated = false
    for (const k of Object.keys(all)) {
      const m = /^(seed:-?\d+):[A-Z0-9_]+$/.exec(k)
      if (!m) continue
      const target = m[1]
      const existing = all[target] ?? []
      const seen = new Set(existing.map(p => `${p.x},${p.z},${p.dimension ?? 'overworld'}`))
      all[target] = existing.concat((all[k] ?? []).filter(p => !seen.has(`${p.x},${p.z},${p.dimension ?? 'overworld'}`)))
      delete all[k]
      migrated = true
    }
    if (migrated) localStorage.setItem('mcmap:pins', JSON.stringify(all))
    return all
  } catch { return {} }
}

export function loadPinsForWorld(key: string | null): Pin[] {
  if (!key) return []
  const all = loadAllPins()
  return (all[key] ?? []).map(p => ({
    ...p,
    dimension: p.dimension ?? 'overworld',
    crossDimensional: p.crossDimensional ?? false,
  }))
}

export function savePinsForWorld(key: string, pins: Pin[]): void {
  const all = loadAllPins()
  all[key] = pins
  localStorage.setItem('mcmap:pins', JSON.stringify(all))
}

// ── Saved route storage — world-scoped, same key as pins ─────────────────────

function loadAllRoutes(): Record<string, SavedRoute[]> {
  try {
    const raw = localStorage.getItem('mcmap:routes')
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return {}
    return parsed as Record<string, SavedRoute[]>
  } catch { return {} }
}

export function loadRoutesForWorld(key: string | null): SavedRoute[] {
  if (!key) return []
  const all = loadAllRoutes()
  return all[key] ?? []
}

export function saveRoutesForWorld(key: string, routes: SavedRoute[]): void {
  const all = loadAllRoutes()
  all[key] = routes
  localStorage.setItem('mcmap:routes', JSON.stringify(all))
}

// ── Recent worlds ─────────────────────────────────────────────────────────────

export function loadRecentWorlds(): string[] {
  try {
    const raw = localStorage.getItem('mcmap:recentWorlds')
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveRecentWorld(path: string, current: string[]): string[] {
  const next = [path, ...current.filter(p => p !== path)].slice(0, 5)
  localStorage.setItem('mcmap:recentWorlds', JSON.stringify(next))
  return next
}

// ── Initial state ─────────────────────────────────────────────────────────────

export function worldInitialState(session: {
  selectedVersion?: MCVersionKey
  dimension?: Dimension
  structuresByDimension?: Partial<Record<Dimension, StructureType[]>>
  disabledStructureVariants?: string[]
  notableLootOnly?: StructureType[]
}): WorldState {
  const dim = session.dimension ?? 'overworld'
  const structuresByDimension = session.structuresByDimension ?? {}
  return {
    levelDatPath: null,
    worldDir: null,
    seedData: null,
    selectedVersion: session.selectedVersion ?? 'MC_1_21',
    dimension: dim,
    structuresByDimension,
    enabledStructures: new Set(structuresByDimension[dim] ?? getDefaultStructures(dim)),
    disabledStructureVariants: new Set(session.disabledStructureVariants ?? []),
    notableLootOnly: new Set(session.notableLootOnly ?? []),
    worldType: 'default',
    isWatching: false,
    followPlayer: false,
    worldLoadCount: 0,
    lastUpdate: 0,
    changedRegions: [],
    error: null,
    pins: [],
    savedRoutes: [],
    recentWorlds: loadRecentWorlds(),
    unlimitedCache: false,
  }
}

// ── Reducer ───────────────────────────────────────────────────────────────────
// Accepts the full state object so it can spread it and return a complete state.
// Only handles WorldAction types; all other action types are returned unchanged.

export function worldReducer<S extends WorldState>(state: S, action: { type: string }): S {
  switch (action.type) {
    case 'SET_SEED': {
      const a = action as WorldAction & { type: 'SET_SEED' }
      const worldDir = a.path.replace(/[\\/][^\\/]+$/, '')
      const recentWorlds = saveRecentWorld(a.path, state.recentWorlds)
      const version = dataVersionToMCVersionKey(a.data.dataVersion)
      const worldSettings = loadWorldSettings(worldDir)
      return {
        ...state,
        levelDatPath: a.path,
        worldDir,
        seedData: a.data,
        selectedVersion: version,
        worldType: a.data.worldType,
        isWatching: true,
        followPlayer: false,
        lastUpdate: Date.now(),
        worldLoadCount: state.worldLoadCount + 1,
        error: null,
        recentWorlds,
        pins: loadPinsForWorld(pinWorldKey(a.path, null, version)),
        savedRoutes: loadRoutesForWorld(pinWorldKey(a.path, null, version)),
        unlimitedCache: worldSettings.unlimitedCache,
      }
    }
    case 'SET_MANUAL_SEED': {
      const a = action as WorldAction & { type: 'SET_MANUAL_SEED' }
      return {
        ...state,
        levelDatPath: null,
        worldDir: null,
        followPlayer: false,
        seedData: {
          seed: a.seed,
          dataVersion: 0,
          versionName: '',
          levelName: '',
          worldType: a.worldType ?? 'default',
          spawnX: 0,
          spawnZ: 0,
          spawnChunkRadius: null,
          playerX: null,
          playerY: null,
          playerZ: null,
          playerDimension: null,
          dayTime: null,
          difficulty: 2,
          worldTime: null,
          edition: 'java',
          players: [],
          serverBrands: [],
          borderCenterX: 0,
          borderCenterZ: 0,
          borderSize: 60_000_000,
          gameRules: {},
        },
        selectedVersion: a.version,
        worldType: a.worldType ?? 'default',
        isWatching: false,
        lastUpdate: Date.now(),
        error: null,
        pins: loadPinsForWorld(pinWorldKey(null, a.seed, a.version)),
        savedRoutes: loadRoutesForWorld(pinWorldKey(null, a.seed, a.version)),
      }
    }
    case 'SEED_UPDATED': {
      const a = action as WorldAction & { type: 'SEED_UPDATED' }
      return {
        ...state,
        seedData: a.data,
        selectedVersion: dataVersionToMCVersionKey(a.data.dataVersion),
        worldType: a.data.worldType,
        lastUpdate: Date.now(),
        error: null,
      }
    }
    case 'REGION_CHANGED': {
      const a = action as WorldAction & { type: 'REGION_CHANGED' }
      // Ignore writes to a dimension we're not currently viewing — otherwise a
      // Nether save would invalidate the identically-numbered Overworld region.
      // '*' means "dimension unknown" (Bedrock) → always apply to the active view.
      if (a.dimension !== '*' && a.dimension !== state.dimension) return state
      return { ...state, lastUpdate: Date.now(), changedRegions: a.regions }
    }
    case 'SYNC_DAY_TIME': {
      const a = action as WorldAction & { type: 'SYNC_DAY_TIME' }
      if (!state.seedData) return state
      return { ...state, seedData: { ...state.seedData, dayTime: a.dayTime } }
    }
    case 'SET_VERSION': {
      const a = action as WorldAction & { type: 'SET_VERSION' }
      return { ...state, selectedVersion: a.version }
    }
    case 'SET_DIMENSION': {
      const a = action as WorldAction & { type: 'SET_DIMENSION' }
      const structuresByDimension = { ...state.structuresByDimension, [state.dimension]: [...state.enabledStructures] }
      const saved = structuresByDimension[a.dimension]
      const enabledStructures = new Set(saved ?? getDefaultStructures(a.dimension))
      return { ...state, dimension: a.dimension, enabledStructures, structuresByDimension }
    }
    case 'TOGGLE_STRUCTURE': {
      const a = action as WorldAction & { type: 'TOGGLE_STRUCTURE' }
      const next = new Set(state.enabledStructures)
      if (next.has(a.structure)) next.delete(a.structure)
      else next.add(a.structure)
      return { ...state, enabledStructures: next, structuresByDimension: { ...state.structuresByDimension, [state.dimension]: [...next] } }
    }
    case 'TOGGLE_STRUCTURE_VARIANT': {
      const a = action as WorldAction & { type: 'TOGGLE_STRUCTURE_VARIANT' }
      const key = structureVariantKey(a.structure, a.tag)
      const next = new Set(state.disabledStructureVariants)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return { ...state, disabledStructureVariants: next }
    }
    case 'TOGGLE_NOTABLE_LOOT_ONLY': {
      const a = action as WorldAction & { type: 'TOGGLE_NOTABLE_LOOT_ONLY' }
      const next = new Set(state.notableLootOnly)
      if (next.has(a.structure)) next.delete(a.structure)
      else next.add(a.structure)
      return { ...state, notableLootOnly: next }
    }
    case 'SET_ALL_STRUCTURES': {
      const a = action as WorldAction & { type: 'SET_ALL_STRUCTURES' }
      const next = new Set(state.enabledStructures)
      a.structures.forEach(s => a.enabled ? next.add(s) : next.delete(s))
      return { ...state, enabledStructures: next, structuresByDimension: { ...state.structuresByDimension, [state.dimension]: [...next] } }
    }
    case 'TOGGLE_FOLLOW_PLAYER':
      return { ...state, followPlayer: !state.followPlayer }
    case 'SET_FOLLOW_PLAYER': {
      const a = action as WorldAction & { type: 'SET_FOLLOW_PLAYER' }
      return { ...state, followPlayer: a.follow }
    }
    case 'SET_WORLD_TYPE': {
      const a = action as WorldAction & { type: 'SET_WORLD_TYPE' }
      return { ...state, worldType: a.worldType }
    }
    case 'SET_WATCHING': {
      const a = action as WorldAction & { type: 'SET_WATCHING' }
      return { ...state, isWatching: a.watching }
    }
    case 'SET_ERROR': {
      const a = action as WorldAction & { type: 'SET_ERROR' }
      return { ...state, error: a.error }
    }
    case 'ADD_PIN': {
      const a = action as WorldAction & { type: 'ADD_PIN' }
      const pins = [...state.pins, a.pin]
      const key = pinWorldKey(state.levelDatPath, state.seedData?.seed ?? null, state.selectedVersion)
      if (key) savePinsForWorld(key, pins)
      return { ...state, pins }
    }
    case 'REMOVE_PIN': {
      const a = action as WorldAction & { type: 'REMOVE_PIN' }
      const pins = state.pins.filter(p => p.id !== a.id)
      const key = pinWorldKey(state.levelDatPath, state.seedData?.seed ?? null, state.selectedVersion)
      if (key) savePinsForWorld(key, pins)
      return { ...state, pins }
    }
    case 'UPDATE_PIN': {
      const a = action as WorldAction & { type: 'UPDATE_PIN' }
      const pins = state.pins.map(p => p.id === a.id ? { ...p, ...a.changes } : p)
      const key = pinWorldKey(state.levelDatPath, state.seedData?.seed ?? null, state.selectedVersion)
      if (key) savePinsForWorld(key, pins)
      return { ...state, pins }
    }
    case 'ADD_ROUTE': {
      const a = action as WorldAction & { type: 'ADD_ROUTE' }
      const savedRoutes = [...state.savedRoutes, a.route]
      const key = pinWorldKey(state.levelDatPath, state.seedData?.seed ?? null, state.selectedVersion)
      if (key) saveRoutesForWorld(key, savedRoutes)
      return { ...state, savedRoutes }
    }
    case 'REMOVE_ROUTE': {
      const a = action as WorldAction & { type: 'REMOVE_ROUTE' }
      const savedRoutes = state.savedRoutes.filter(r => r.id !== a.id)
      const key = pinWorldKey(state.levelDatPath, state.seedData?.seed ?? null, state.selectedVersion)
      if (key) saveRoutesForWorld(key, savedRoutes)
      return { ...state, savedRoutes }
    }
    case 'UPDATE_ROUTE': {
      const a = action as WorldAction & { type: 'UPDATE_ROUTE' }
      const savedRoutes = state.savedRoutes.map(r => r.id === a.id ? { ...r, ...a.changes } : r)
      const key = pinWorldKey(state.levelDatPath, state.seedData?.seed ?? null, state.selectedVersion)
      if (key) saveRoutesForWorld(key, savedRoutes)
      return { ...state, savedRoutes }
    }
    case 'SET_UNLIMITED_CACHE': {
      const a = action as WorldAction & { type: 'SET_UNLIMITED_CACHE' }
      return { ...state, unlimitedCache: a.enabled }
    }
    default:
      return state
  }
}
