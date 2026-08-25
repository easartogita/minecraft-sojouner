import { useEffect, useReducer } from 'react'
import * as api from '../lib/tauriAPI'
import * as tileStats from '../lib/tileStats'
import { MCVersionKey, Dimension } from '../lib/constants'
import { StructureType } from '../lib/structureConfig'
import { WorldState, WorldAction, worldInitialState, worldReducer } from './worldSlice'
import {
  OverlayState, OverlayAction, overlayInitialState, overlayReducer,
  loadOverlaySession, saveOverlaySession,
} from './overlaySlice'

export type { WorldType, Pin } from './worldSlice'

// ── Types ─────────────────────────────────────────────────────────────────────

export type AppState = WorldState & OverlayState
export type Action   = WorldAction | OverlayAction

// ── Load world-related session fields ─────────────────────────────────────────

function loadWorldSession() {
  try {
    const raw = localStorage.getItem('mcmap:session')
    if (!raw) return {}
    const s = JSON.parse(raw)
    const dim: Dimension = s.dimension ?? 'overworld'
    // Migrate old flat enabledStructures array into per-dimension map.
    const structuresByDimension: Record<string, unknown> =
      s.structuresByDimension && typeof s.structuresByDimension === 'object' && !Array.isArray(s.structuresByDimension)
        ? s.structuresByDimension
        : Array.isArray(s.enabledStructures)
          ? { [dim]: s.enabledStructures }
          : {}
    return {
      selectedVersion: s.selectedVersion as MCVersionKey | undefined,
      dimension: dim,
      structuresByDimension,
      disabledStructureVariants: Array.isArray(s.disabledStructureVariants)
        ? s.disabledStructureVariants as string[]
        : undefined,
      notableLootOnly: Array.isArray(s.notableLootOnly)
        ? s.notableLootOnly as StructureType[]
        : undefined,
    }
  } catch { return {} }
}

// ── Composed initial state ────────────────────────────────────────────────────

function initialState(): AppState {
  const overlaySess = loadOverlaySession()
  const worldSess   = loadWorldSession()
  return {
    ...worldInitialState(worldSess as any),
    ...overlayInitialState(overlaySess),
  }
}

// ── Composed reducer ──────────────────────────────────────────────────────────

function reducer(state: AppState, action: Action): AppState {
  // Each slice reducer handles its own cases and returns state unchanged for others.
  let next = worldReducer(state, action)
  next = overlayReducer(next, action)

  // Cross-cutting: switching to the Nether auto-enables cave mode when player Y is known;
  // leaving the Nether clears it (it was auto-set, not user-set from overworld).
  if (action.type === 'SET_DIMENSION') {
    if (action.dimension === 'nether' && state.seedData?.playerY != null) {
      return { ...next, caveMode: true }
    }
    if (state.dimension === 'nether' && action.dimension !== 'nether') {
      return { ...next, caveMode: false }
    }
  }

  return next
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAppState() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState)

  // Persist all session settings to localStorage in one write.
  useEffect(() => {
    const structuresByDim = { ...state.structuresByDimension, [state.dimension]: [...state.enabledStructures] }
    saveOverlaySession(state, structuresByDim)
  }, [
    state.selectedVersion, state.dimension, state.enabledStructures, state.structuresByDimension,
    state.disabledStructureVariants, state.notableLootOnly,
    state.showBiomes, state.biomeOpacity, state.chunkOpacity, state.slimeOpacity, state.oreOpacity,
    state.hideWater, state.showSlimeChunks, state.showCopperVeins, state.showIronVeins,
    state.showChunkData, state.chunkDataMinZoom, state.showChunkGrid, state.showRegionGrid,
    state.showSpawnRadius, state.showMarkers, state.markerMinZoom, state.markerGroupDefs, state.enabledMarkerGroups,
    state.markerYFilterEnabled, state.markerYLow, state.markerYHigh,
    state.showLocalDifficulty, state.biomeMode,
    state.zoom, state.uiScale,
    state.rulerWaypoints, state.rulerLegModes, state.rulerCurrentMode, state.activeRouteId,
    state.boatMinSegmentBlocks, state.rulerPlacementMode,
  ])

  // Wire up IPC event listeners.
  useEffect(() => {
    const unsub       = api.onSeedChanged(data  => dispatch({ type: 'SEED_UPDATED', data }))
    const unsubErr    = api.onSeedError(error   => dispatch({ type: 'SET_ERROR', error }))
    const unsubRegion = api.onRegionChanged(change => dispatch({ type: 'REGION_CHANGED', dimension: change.dimension, regions: change.regions }))
    const unsubMetrics = api.onMcaMetrics(m => tileStats.updateMcaMetrics(m))

    api.getAutoLoadData().then(result => {
      if (result) {
        const [path, data] = result
        dispatch({ type: 'SET_SEED', path, data })
        api.watchLevelDat(path).catch(() => {})
      }
    })

    return () => { unsub(); unsubErr(); unsubRegion(); unsubMetrics() }
  }, [])

  // Re-register the file watcher on dimension changes so newly created region
  // directories (e.g. DIM-1/region/ appearing the first time a player enters
  // the Nether) get picked up without requiring a world reload.
  useEffect(() => {
    if (!state.levelDatPath || !state.isWatching) return
    api.watchLevelDat(state.levelDatPath).catch(() => {})
  }, [state.dimension])

  // Re-sync DayTime periodically — Minecraft pauses its clock when its window
  // loses focus, so the day/night bar drifts. Poll every 20 s to re-anchor.
  useEffect(() => {
    if (!state.levelDatPath || !state.isWatching) return
    const path = state.levelDatPath
    const id = setInterval(async () => {
      try {
        const dayTime = await api.readDayTime(path)
        if (dayTime != null) dispatch({ type: 'SYNC_DAY_TIME', dayTime })
      } catch { /* world may have been closed */ }
    }, 20_000)
    return () => clearInterval(id)
  }, [state.levelDatPath, state.isWatching])

  const loadWorld = async (path: string) => {
    const data = await api.readSeed(path)
    dispatch({ type: 'SET_SEED', path, data })
    await api.watchLevelDat(path)
  }

  const openLevelDat = async () => {
    const path = await api.selectLevelDat()
    if (!path) return
    try {
      await loadWorld(path)
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: String(err) })
    }
  }

  return { state, dispatch, loadWorld, openLevelDat }
}
