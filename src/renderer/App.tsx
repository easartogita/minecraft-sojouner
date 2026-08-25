import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import L, { Map as LeafletMap } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useAppState, AppState, Action, WorldType } from './hooks/useSeed'
import { minecraftToLeaflet } from './lib/tileCoords'
import { useGenerator, GeneratorHandle } from './hooks/useGenerator'
import { MC_VERSION_LABELS, MC_VERSIONS, MCVersionKey } from './lib/constants'
import * as api from './lib/tauriAPI'
import { timeAgo } from './lib/timeAgo'
import { getAllQueues } from './lib/tileJobQueue'
import MapView from './components/MapView'
import Rail from './components/Rail'
import RightRail from './components/RightRail'
import { IconPickaxe, IconDice } from './components/icons'
import './styles/app.css'

// Contexts
interface AppContextValue {
  state: AppState
  dispatch: React.Dispatch<Action>
  loadWorld: (path: string) => Promise<void>
  openLevelDat: () => Promise<void>
  generatorSlot: number | null
  // Layers that talk to cubiomes should consume this rather than re-deriving
  // seedBig/dimId/worldFlags/mcVersion from `state` themselves.
  generatorConfig: GeneratorHandle
  mapRef: React.MutableRefObject<LeafletMap | null>
  availableLayers: ReturnType<typeof api.getTileSizes> | null   // tile layers this build can actually serve, per dimension — null live
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const AppContext = createContext<AppContextValue>(null as any)
export const useApp = () => useContext(AppContext)

export default function App() {
  const { state, dispatch, loadWorld, openLevelDat } = useAppState()
  const generatorConfig = useGenerator(
    state.seedData?.seed ?? null,
    state.selectedVersion,
    state.dimension,
    state.worldType,
  )
  const generatorSlot = generatorConfig.slot
  const mapRef = useRef<LeafletMap | null>(null)
  const availableLayers = api.IS_STATIC_SITE ? api.getTileSizes(state.dimension) : null

  const [appVersion, setAppVersion] = useState<string | null>(null)
  useEffect(() => { api.getAppVersion().then(setAppVersion).catch(() => {}) }, [])

  // Static-site boot: no level.dat to read, so seed the same SET_SEED reducer
  // action the live open-world flow uses, from manifest.json instead.
  const [staticBootFailed, setStaticBootFailed] = useState(false)
  useEffect(() => {
    if (!api.IS_STATIC_SITE) return
    api.getStaticWorldSeedData()
      .then(result => {
        if (result) dispatch({ type: 'SET_SEED', path: result.path, data: result.data })
        else setStaticBootFailed(true)
      })
      .catch(() => setStaticBootFailed(true))
  }, [dispatch])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore when typing in an input/textarea
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'o' || e.key === 'O') {
          e.preventDefault()
          openLevelDat()
        }
        return
      }

      switch (e.key.toLowerCase()) {
        case 'b':
          dispatch({ type: 'TOGGLE_BIOMES' })
          break
        case 'h':
          dispatch({ type: 'TOGGLE_HIDE_WATER' })
          break
        case 's':
          if (state.dimension === 'overworld')
            dispatch({ type: 'TOGGLE_SLIME_CHUNKS' })
          break
        case 'g': {
          e.preventDefault()
          const input = document.getElementById('goto-x-input') as HTMLInputElement | null
          input?.focus()
          break
        }
        case 'p': {
          const { playerX, playerZ } = state.seedData ?? {}
          if (playerX != null && playerZ != null && mapRef.current) {
            const { x: lng, y: lat } = minecraftToLeaflet(playerX, playerZ)
            mapRef.current.flyTo(L.latLng(lat, lng), mapRef.current.getZoom())
          }
          break
        }
        case 'c':
          if (state.worldDir && (api.IS_STATIC_SITE || state.seedData?.playerY != null))
            dispatch({ type: 'TOGGLE_CAVE_MODE' })
          break
        case 'd':
          if (state.worldDir)
            dispatch({ type: 'TOGGLE_CHUNK_DATA' })
          break
        case 'v':
          if (state.dimension === 'overworld' && MC_VERSIONS[state.selectedVersion] >= MC_VERSIONS['MC_1_18']) {
            dispatch({ type: 'TOGGLE_ORE_VEINS' })
          }
          break
        case 'r':
          dispatch({ type: 'RULER_TOGGLE' })
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [dispatch, openLevelDat, state.dimension, state.worldDir, state.selectedVersion, state.seedData?.playerY])

  // Pause ALL tile queues while the window is hidden to prevent WebKit from
  // crashing when createImageBitmap / canvas ops fire while the renderer is
  // throttled. Enumerated from the registry so every layer's queue is covered,
  // not just biome + chunk (overlay queues were previously left running hidden).
  useEffect(() => {
    const update = () => {
      const hidden = document.hidden
      getAllQueues().forEach(q => hidden ? q.pause() : q.resume())
    }
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])

  // Global file-drop listener (tauri://file-drop)
  useEffect(() => {
    return api.onFileDrop(async paths => {
      const levelDat = paths.find(p => p.endsWith('level.dat') || p.endsWith('.dat'))
      if (levelDat) {
        try {
          await loadWorld(levelDat)
        } catch { /* ignore invalid drops */ }
      }
    })
  }, [dispatch])

  return (
    <AppContext.Provider value={{ state, dispatch, loadWorld, openLevelDat, generatorSlot, generatorConfig, mapRef, availableLayers }}>
      <div className="app-layout">
        <Rail />
        <div className="map-area">
          {state.seedData ? (
            <MapView />
          ) : api.IS_STATIC_SITE ? (
            <div className="empty-state">
              <div className="empty-icon"><IconPickaxe size={48} /></div>
              <h2 className="wordmark">Sojourner</h2>
              <p className="empty-desc">{staticBootFailed ? 'Could not load manifest.json.' : 'Loading map…'}</p>
            </div>
          ) : (
            <EmptyState onOpen={openLevelDat} onLoad={loadWorld} dispatch={dispatch} />
          )}
        </div>
        <RightRail />
      </div>
      {appVersion && (
        <div className="app-version-tag">
          v{appVersion}
          {import.meta.env.DEV && <span className="app-version-tag-dev"> · DEV</span>}
        </div>
      )}
    </AppContext.Provider>
  )
}

function EmptyState({ onOpen, onLoad, dispatch }: {
  onOpen: () => void
  onLoad: (path: string) => Promise<void>
  dispatch: React.Dispatch<Action>
}) {
  const [showSeedForm, setShowSeedForm] = useState(false)
  const [manualSeed, setManualSeed] = useState('')
  const [manualVersion, setManualVersion] = useState<MCVersionKey>(MC_VERSION_LABELS[0].key)
  const [manualWorldType, setManualWorldType] = useState<WorldType>('default')
  const [seedError, setSeedError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [savesWorlds, setSavesWorlds] = useState<api.SavesWorldEntry[] | null>(null)

  useEffect(() => {
    api.listSavesWorlds().then(setSavesWorlds).catch(() => setSavesWorlds([]))
  }, [])

  const openRecent = async (path: string) => {
    try { await onLoad(path) } catch { /* world may have been deleted or moved */ }
  }

  const openWorldFolder = async () => {
    const path = await api.selectWorldDir()
    if (!path) return
    try { await onLoad(path) } catch { /* ignore if level.dat is unreadable */ }
  }

  const handleManualSeed = () => {
    const trimmed = manualSeed.trim()
    if (!trimmed) return
    let seedNum: bigint
    try {
      seedNum = BigInt(trimmed)
    } catch {
      // hash string to number like Java does
      let h = 0
      for (let i = 0; i < trimmed.length; i++) {
        h = Math.imul(31, h) + trimmed.charCodeAt(i) | 0
      }
      seedNum = BigInt(h)
    }
    setSeedError(null)
    dispatch({
      type: 'SET_MANUAL_SEED',
      seed: seedNum.toString(),
      version: manualVersion,
      worldType: manualWorldType,
    })
  }

  // Same behavior as the World flyout's dice: fill the field and load immediately.
  const randomizeSeed = () => {
    const arr = new BigInt64Array(1)
    crypto.getRandomValues(arr)
    const seed = arr[0].toString()
    setManualSeed(seed)
    setSeedError(null)
    dispatch({
      type: 'SET_MANUAL_SEED',
      seed,
      version: manualVersion,
      worldType: manualWorldType,
    })
  }

  const WORLD_TYPE_OPTIONS: WorldType[] = ['default', 'large_biomes', 'amplified', 'flat', 'single_biome', 'custom']
  const WORLD_TYPE_LABELS: Record<WorldType, string> = {
    default: 'Default', large_biomes: 'Large Biomes', amplified: 'Amplified',
    flat: 'Flat', single_biome: 'Single Biome', custom: 'Custom',
  }

  return (
    <div
      className={`empty-state${dragging ? ' empty-state--drag' : ''}`}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => {
        e.preventDefault()
        setDragging(false)
        // HTML5 drop: try to get file names for feedback (actual paths come via tauri://file-drop)
      }}
    >
      <div className="empty-icon"><IconPickaxe size={48} /></div>
      <h2 className="wordmark">Sojourner</h2>

      {!showSeedForm ? (
        <>
          {savesWorlds && savesWorlds.length > 0 ? (
            <>
              <p className="empty-desc">Select a world or browse for one elsewhere.</p>
              <div className="saves-worlds">
                {savesWorlds.map(w => (
                  <button key={w.levelDatPath} className="saves-world-item" onClick={() => openRecent(w.levelDatPath)} title={w.levelDatPath}>
                    <span className="saves-world-name">{w.name}</span>
                    <span className="saves-world-time">{timeAgo(w.modifiedSecs)}</span>
                  </button>
                ))}
              </div>
              <div className="empty-actions empty-actions--secondary">
                <button className="btn-secondary" onClick={openWorldFolder}>Browse…</button>
                <button className="btn-ghost" onClick={() => setShowSeedForm(true)}>Enter Seed Only</button>
              </div>
            </>
          ) : (
            <>
              <p className="empty-desc">Open a world to explore its map, or enter a seed manually.</p>
              <div className="empty-actions">
                <button className="btn-primary" onClick={openWorldFolder}>Open World Folder</button>
                <button className="btn-secondary" onClick={onOpen}>Open level.dat</button>
                <button className="btn-ghost" onClick={() => setShowSeedForm(true)}>Enter Seed Only</button>
              </div>
            </>
          )}

          <div className="empty-drop-hint">
            {dragging ? 'Drop level.dat to open' : 'Or drag-and-drop a level.dat here'}
          </div>
        </>
      ) : (
        <div className="empty-seed-form">
          <div className="empty-seed-row">
            <input
              className="empty-seed-input"
              type="text"
              placeholder="Seed (number or text)"
              value={manualSeed}
              onChange={e => setManualSeed(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleManualSeed()}
              autoFocus
            />
            <button className="btn-sm btn-sm--icon" onClick={randomizeSeed} title="Random seed">
              <IconDice />
            </button>
          </div>
          <div className="empty-seed-options">
            <select
              className="version-select"
              value={manualVersion}
              onChange={e => setManualVersion(e.target.value as MCVersionKey)}
            >
              {MC_VERSION_LABELS.map(({ key, label }) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            <select
              className="version-select"
              value={manualWorldType}
              onChange={e => setManualWorldType(e.target.value as WorldType)}
            >
              {WORLD_TYPE_OPTIONS.map(t => (
                <option key={t} value={t}>{WORLD_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>
          {seedError && <div className="empty-seed-error">{seedError}</div>}
          <div className="empty-seed-btns">
            <button className="btn-primary" onClick={handleManualSeed}>View Map</button>
            <button className="btn-ghost" onClick={() => { setShowSeedForm(false); setSeedError(null) }}>Back</button>
          </div>
        </div>
      )}
    </div>
  )
}
