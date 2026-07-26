import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import L, { Map as LeafletMap } from 'leaflet'
import { useAppState, AppState } from './hooks/useSeed'
import { minecraftToLeaflet } from './lib/tileCoords'
import { useGenerator } from './hooks/useGenerator'
import { MC_VERSION_LABELS, MC_VERSIONS, MCVersionKey } from './lib/constants'
import { WorldType } from './hooks/useSeed'
import * as api from './lib/tauriAPI'
import { listen } from '@tauri-apps/api/event'
import { getAllQueues } from './lib/tileJobQueue'
import MapView from './components/MapView'
import Rail from './components/Rail'
import { IconPickaxe, IconDice } from './components/icons'
import './styles/app.css'

// Contexts
interface AppContextValue {
  state: AppState
  dispatch: React.Dispatch<Parameters<typeof useAppState>[0] extends undefined ? never : never>
  loadWorld: (path: string) => Promise<void>
  openLevelDat: () => Promise<void>
  generatorSlot: number | null
  mapRef: React.MutableRefObject<LeafletMap | null>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const AppContext = createContext<AppContextValue>(null as any)
export const useApp = () => useContext(AppContext)

export default function App() {
  const { state, dispatch, loadWorld, openLevelDat } = useAppState()
  const generatorSlot = useGenerator(
    state.seedData?.seed ?? null,
    state.selectedVersion,
    state.dimension,
    state.worldType,
  )
  const mapRef = useRef<LeafletMap | null>(null)

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
          dispatch({ type: 'TOGGLE_BIOMES' } as never)
          break
        case 'h':
          dispatch({ type: 'TOGGLE_HIDE_WATER' } as never)
          break
        case 's':
          if (state.dimension === 'overworld')
            dispatch({ type: 'TOGGLE_SLIME_CHUNKS' } as never)
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
          if (state.worldDir && state.seedData?.playerY != null)
            dispatch({ type: 'TOGGLE_CAVE_MODE' } as never)
          break
        case 'd':
          if (state.worldDir)
            dispatch({ type: 'TOGGLE_CHUNK_DATA' } as never)
          break
        case 'v':
          if (state.dimension === 'overworld' && MC_VERSIONS[state.selectedVersion] >= MC_VERSIONS['MC_1_18']) {
            if (!state.showOreVeins) {
              dispatch({ type: 'TOGGLE_ORE_VEINS' } as never)
              dispatch({ type: 'SET_ORE_VEIN_MODE', mode: 'density' } as never)
            } else if (state.oreVeinMode === 'density') {
              dispatch({ type: 'SET_ORE_VEIN_MODE', mode: 'footprint' } as never)
            } else {
              dispatch({ type: 'TOGGLE_ORE_VEINS' } as never)
            }
          }
          break
        case 'r':
          dispatch({ type: 'RULER_TOGGLE' } as never)
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [dispatch, openLevelDat, state.dimension, state.worldDir, state.selectedVersion, state.seedData?.playerY, state.showOreVeins, state.oreVeinMode])

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
    let unlisten: (() => void) | undefined
    listen<string[]>('tauri://file-drop', async (event) => {
      const paths = event.payload
      const levelDat = paths.find(p => p.endsWith('level.dat') || p.endsWith('.dat'))
      if (levelDat) {
        try {
          await loadWorld(levelDat)
        } catch { /* ignore invalid drops */ }
      }
    }).then(fn => { unlisten = fn })
    return () => { unlisten?.() }
  }, [dispatch])

  return (
    <AppContext.Provider value={{ state, dispatch: dispatch as never, loadWorld, openLevelDat, generatorSlot, mapRef }}>
      <div className="app-layout">
        <Rail />
        <div className="map-area">
          {state.seedData ? (
            <MapView />
          ) : (
            <EmptyState onOpen={openLevelDat} onLoad={loadWorld} dispatch={dispatch as never} recentWorlds={state.recentWorlds} />
          )}
        </div>
      </div>
    </AppContext.Provider>
  )
}

function worldNameFromPath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  // level.dat is the last segment; world folder is one above it
  const idx = parts.lastIndexOf('level.dat')
  return idx > 0 ? parts[idx - 1] : parts[parts.length - 2] ?? path
}

function timeAgo(secs: number): string {
  const diff = Math.floor(Date.now() / 1000 - secs)
  if (diff < 60)         return 'just now'
  if (diff < 3600)       return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400)      return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 7)  return `${Math.floor(diff / 86400)}d ago`
  if (diff < 86400 * 30) return `${Math.floor(diff / 604800)}w ago`
  return `${Math.floor(diff / 2592000)}mo ago`
}

function EmptyState({ onOpen, onLoad, dispatch, recentWorlds }: {
  onOpen: () => void
  onLoad: (path: string) => Promise<void>
  dispatch: React.Dispatch<never>
  recentWorlds: string[]
}) {
  const [showSeedForm, setShowSeedForm] = useState(false)
  const [manualSeed, setManualSeed] = useState('')
  const [manualVersion, setManualVersion] = useState<MCVersionKey>('MC_1_21')
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
    } as never)
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
    } as never)
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
