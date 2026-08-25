import React, { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { useApp } from '../App'
import { DIMENSIONS, Dimension, MC_VERSIONS, MIN_ZOOM, MAX_ZOOM } from '../lib/constants'
import { minecraftToLeaflet, parseCoordPaste } from '../lib/tileCoords'
import DayNightBar from './DayNightBar'
import { caveZoomRange } from '../hooks/overlaySlice'
import { IconCenter, IconFollow } from './icons'
import * as api from '../lib/tauriAPI'

const DIM_LABELS: Record<Dimension, string> = {
  overworld: 'Overworld',
  nether: 'Nether',
  end: 'The End',
}

const DIM_MAP: Record<string, Dimension> = {
  'minecraft:overworld': 'overworld',
  'minecraft:the_nether': 'nether',
  'minecraft:the_end': 'end',
}

export default function MapToolbar() {
  const { state, dispatch, mapRef, availableLayers } = useApp()
  const isBedrockWorld = state.seedData?.edition === 'bedrock'
  // Static export has no live player position at all — it drives Cave Mode
  // from baked presets (CaveMapControls) instead of a real player Y.
  const caveModeUnavailable = !api.IS_STATIC_SITE && state.seedData?.playerY == null
  // Not baked into this static export — always false live.
  const notBaked = (key: keyof NonNullable<typeof availableLayers>) =>
    availableLayers != null && availableLayers[key] == null

  const flyToPlayer = (switchDimension: boolean) => {
    const { playerX, playerZ, playerDimension } = state.seedData ?? {}
    if (playerX == null || playerZ == null || !mapRef.current) return

    const playerDim = playerDimension ? DIM_MAP[playerDimension] : 'overworld'

    if (switchDimension && playerDim && playerDim !== state.dimension) {
      dispatch({ type: 'SET_DIMENSION', dimension: playerDim })
      const { x: lng, y: lat } = minecraftToLeaflet(playerX, playerZ)
      mapRef.current.flyTo(L.latLng(lat, lng), mapRef.current.getZoom())
      return
    }

    let displayX = playerX, displayZ = playerZ
    if (!isBedrockWorld) {
      if (playerDim === 'nether' && state.dimension === 'overworld') { displayX *= 8; displayZ *= 8 }
      else if (playerDim === 'overworld' && state.dimension === 'nether') { displayX = Math.floor(displayX / 8); displayZ = Math.floor(displayZ / 8) }
    }

    const { x: lng, y: lat } = minecraftToLeaflet(displayX, displayZ)
    mapRef.current.flyTo(L.latLng(lat, lng), mapRef.current.getZoom())
  }

  // Follow player: re-center on projected position whenever player moves.
  // Never switches dimension — that's an explicit user action via "→ Dim".
  useEffect(() => {
    if (!state.followPlayer) return
    const { playerX, playerZ, playerDimension } = state.seedData ?? {}
    if (playerX == null || playerZ == null || !mapRef.current) return

    const playerDim = (playerDimension && DIM_MAP[playerDimension]) || 'overworld'
    let displayX = playerX, displayZ = playerZ
    if (!isBedrockWorld) {
      if (playerDim === 'nether' && state.dimension === 'overworld')      { displayX *= 8; displayZ *= 8 }
      else if (playerDim === 'overworld' && state.dimension === 'nether') { displayX = Math.floor(displayX / 8); displayZ = Math.floor(displayZ / 8) }
      else if (playerDim !== state.dimension)                             { return } // incompatible dims — don't move
    } else if (playerDim !== state.dimension) { return } // incompatible dims — don't move

    const { x: lng, y: lat } = minecraftToLeaflet(displayX, displayZ)
    mapRef.current.flyTo(L.latLng(lat, lng), mapRef.current.getZoom())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.followPlayer, state.seedData?.playerX, state.seedData?.playerZ, state.seedData?.playerDimension, state.dimension])

  // Break follow mode when the user manually pans or scroll-zooms
  useEffect(() => {
    if (!state.followPlayer) return
    const map = mapRef.current
    if (!map) return

    const breakFollow = () => dispatch({ type: 'SET_FOLLOW_PLAYER', follow: false })

    map.on('dragstart', breakFollow)
    map.getContainer().addEventListener('wheel', breakFollow, { passive: true })
    return () => {
      map.off('dragstart', breakFollow)
      map.getContainer().removeEventListener('wheel', breakFollow)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.followPlayer])

  const playerX    = state.seedData?.playerX
  const playerDim  = ((state.seedData?.playerDimension && DIM_MAP[state.seedData.playerDimension]) || 'overworld') as Dimension
  const sameDim    = playerDim === state.dimension
  const canProject = sameDim ||
    (playerDim === 'nether' && state.dimension === 'overworld') ||
    (playerDim === 'overworld' && state.dimension === 'nether')

  return (
    <div className="map-toolbar">
      <div className="map-toolbar-dims">
        {DIMENSIONS.map(dim => (
          <button
            key={dim}
            className={`toolbar-dim-btn${state.dimension === dim ? ' active' : ''}`}
            onClick={() => dispatch({ type: 'SET_DIMENSION', dimension: dim })}
          >
            {DIM_LABELS[dim]}
          </button>
        ))}
      </div>

      <div className="map-toolbar-divider" />

      <div className="map-toolbar-toggles">
        {!isBedrockWorld && (() => {
          const biomeModeAvailable = state.showBiomes && state.dimension === 'overworld'
            && MC_VERSIONS[state.selectedVersion] >= MC_VERSIONS['MC_1_18']
          const undergroundUnavailable = notBaked('underground')
          return (
            <ToolbarToggle label="Biomes" title="Toggle biome map (B)"
              active={state.showBiomes} onClick={() => {
                dispatch({ type: 'TOGGLE_BIOMES' })
                // The toggle always means "default view" — non-surface modes are
                // opt-in via the flyout each time, not remembered across a toggle.
                if (state.biomeMode !== 'surface') dispatch({ type: 'SET_BIOME_MODE', mode: 'surface' })
              }}
              mode={biomeModeAvailable ? (state.biomeMode === 'surface' ? 'Surface' : 'Underground') : undefined}
              flyout={biomeModeAvailable ? (
                <div className="biome-mode-radio">
                  {(['surface', 'underground'] as const).map(mode => {
                    const disabled = mode === 'underground' && undergroundUnavailable
                    return (
                      <label key={mode} className={`biome-mode-option${state.biomeMode === mode ? ' active' : ''}`}
                        title={disabled ? 'Not available in this export' : undefined}>
                        <input type="radio" name="biomeMode" value={mode} checked={state.biomeMode === mode}
                          disabled={disabled}
                          onChange={() => dispatch({ type: 'SET_BIOME_MODE', mode })} />
                        {mode === 'surface' ? 'Surface' : 'Underground'}
                      </label>
                    )
                  })}
                </div>
              ) : undefined} />
          )
        })()}
        {state.worldDir && (!api.IS_STATIC_SITE || availableLayers?.chunk != null || availableLayers?.chunkHideWater != null) && (
          <ToolbarToggle label="Chunk Data" title="Toggle explored-world data: region outlines at low zoom, real block colors up close (D)"
            active={state.showChunkData} onClick={() => {
              dispatch({ type: 'TOGGLE_CHUNK_DATA' })
              // Same "toggle always means default view" rule as Biomes above.
              if (state.caveMode) dispatch({ type: 'TOGGLE_CAVE_MODE' })
            }}
            mode={state.showChunkData && state.caveMode ? 'Cave Mode' : undefined}
            flyout={state.showChunkData ? (
              <label className={`chunk-mode-option${state.caveMode ? ' active' : ''}${caveModeUnavailable || notBaked('cave') ? ' disabled' : ''}`}
                title={caveModeUnavailable ? 'Open a world with a player position to use Cave Mode'
                  : notBaked('cave') ? 'Not available in this export' : undefined}>
                <input type="checkbox" checked={state.caveMode}
                  disabled={caveModeUnavailable || notBaked('cave')}
                  onChange={() => dispatch({ type: 'TOGGLE_CAVE_MODE' })} />
                Cave Mode <kbd className="shortcut-key" title="Toggle cave mode">C</kbd>
              </label>
            ) : undefined} />
        )}
        {!isBedrockWorld && state.dimension === 'overworld' && (
          <ToolbarToggle label="Slime Chunks" title="Toggle slime chunks (S)"
            active={state.showSlimeChunks} onClick={() => dispatch({ type: 'TOGGLE_SLIME_CHUNKS' })} />
        )}
        {!isBedrockWorld && state.dimension === 'overworld' && MC_VERSIONS[state.selectedVersion] >= MC_VERSIONS['MC_1_18'] && (
          <ToolbarToggle label="Ore Veins" title={notBaked('oreVeins') ? 'Not available in this export' : 'Toggle ore vein overlay (V)'}
            active={state.showOreVeins} disabled={notBaked('oreVeins')}
            onClick={() => dispatch({ type: 'TOGGLE_ORE_VEINS' })} />
        )}
        <ToolbarToggle label="Routes" title="Plan multi-leg routes with travel times (R)"
          active={state.rulerActive} onClick={() => dispatch({ type: 'RULER_TOGGLE' })} />
        <ToolbarToggle label="Grids" title="Cycle grid overlay: Region → Chunk → Region+Chunk → off"
          active={state.showChunkGrid || state.showRegionGrid}
          mode={state.showRegionGrid && state.showChunkGrid ? 'Region+Chunk'
            : state.showChunkGrid ? 'Chunk'
            : state.showRegionGrid ? 'Region'
            : undefined}
          onClick={() => {
            const { showRegionGrid, showChunkGrid } = state
            if (!showRegionGrid && !showChunkGrid) {
              dispatch({ type: 'TOGGLE_REGION_GRID' })
            } else if (showRegionGrid && !showChunkGrid) {
              dispatch({ type: 'TOGGLE_REGION_GRID' })
              dispatch({ type: 'TOGGLE_CHUNK_GRID' })
            } else if (!showRegionGrid && showChunkGrid) {
              dispatch({ type: 'TOGGLE_REGION_GRID' })
            } else {
              dispatch({ type: 'TOGGLE_REGION_GRID' })
              dispatch({ type: 'TOGGLE_CHUNK_GRID' })
            }
          }} />
      </div>

      {playerX != null && (
        <>
          <div className="map-toolbar-divider" />
          <div className="map-toolbar-player">
            {canProject && (
              <button
                className="toolbar-icon-btn"
                onClick={() => flyToPlayer(false)}
                title={sameDim ? 'Center on player' : `Center on projected position (${playerDim === 'nether' ? '×8' : '÷8'})`}
              >
                <IconCenter />
              </button>
            )}
            {canProject && (
              <button
                className={`toolbar-icon-btn${state.followPlayer ? ' following' : ''}`}
                onClick={() => dispatch({ type: 'TOGGLE_FOLLOW_PLAYER' })}
                title={state.followPlayer
                  ? 'Following — click to stop'
                  : sameDim ? 'Follow player' : `Follow projected position (${playerDim === 'nether' ? '×8' : '÷8'})`}
              >
                <IconFollow />
              </button>
            )}
            {!sameDim && (
              <button
                className="toolbar-player-btn"
                onClick={() => {
                  dispatch({ type: 'SET_FOLLOW_PLAYER', follow: false })
                  flyToPlayer(true)
                }}
                title={`Switch to ${DIM_LABELS[playerDim]} and center on player`}
              >
                → {DIM_LABELS[playerDim]}
              </button>
            )}
          </div>
        </>
      )}

      <div style={{ flex: 1 }} />

      <ToolbarNavigate />
      <div className="map-toolbar-divider" />
      <ToolbarZoom />

      {state.seedData?.dayTime != null && (
        <div className="map-toolbar-daynight">
          <DayNightBar dayTime={state.seedData.dayTime} />
        </div>
      )}
    </div>
  )
}

function ToolbarToggle({ label, title, active, onClick, mode, flyout, disabled }: {
  label: string; title: string; active: boolean; onClick: () => void; mode?: string
  /** Optional mode-switch popover, opened via a small caret next to the main toggle. */
  flyout?: React.ReactNode
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const groupRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (groupRef.current && !groupRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!flyout) {
    return (
      <button className={`toolbar-toggle${active ? ' active' : ''}`} onClick={onClick} title={title} disabled={disabled}>
        {label}
        {mode && <span className="toolbar-toggle-mode"> · {mode}</span>}
      </button>
    )
  }

  return (
    <div className="toolbar-toggle-group" ref={groupRef}>
      <button className={`toolbar-toggle${active ? ' active' : ''}`} onClick={onClick} title={title} disabled={disabled}>
        {label}
        {mode && <span className="toolbar-toggle-mode"> · {mode}</span>}
      </button>
      <button className={`toolbar-toggle-caret${open ? ' active' : ''}`}
        onClick={() => setOpen(o => !o)} title={`${label} mode`}>▾</button>
      {open && <div className="toolbar-toggle-flyout">{flyout}</div>}
    </div>
  )
}

function ToolbarNavigate() {
  const { state, dispatch, mapRef } = useApp()
  const [gotoX, setGotoX] = useState('')
  const [gotoZ, setGotoZ] = useState('')

  const flyToCoords = (x: number, z: number, dim?: Dimension) => {
    if (!mapRef.current) return
    if (dim && dim !== state.dimension) {
      dispatch({ type: 'SET_DIMENSION', dimension: dim })
    }
    const { x: lng, y: lat } = minecraftToLeaflet(x, z)
    mapRef.current.flyTo(L.latLng(lat, lng), Math.max(mapRef.current.getZoom(), 3))
  }

  const handleGo = () => {
    const x = parseInt(gotoX)
    const z = parseInt(gotoZ)
    if (isNaN(x) || isNaN(z)) return
    flyToCoords(x, z)
  }

  // Lets users paste "123, -456" or a copied `/tp @s 123 64 -456` straight in —
  // native number-input paste can't handle either (non-numeric text is just
  // rejected), so without this a command paste silently does nothing.
  const handleCoordPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const parsed = parseCoordPaste(e.clipboardData.getData('text'))
    if (!parsed) return
    e.preventDefault()
    setGotoX(String(parsed.x))
    setGotoZ(String(parsed.z))
  }

  const x = parseInt(gotoX)
  const z = parseInt(gotoZ)
  const hasCoords = !isNaN(x) && !isNaN(z)

  let equivDim: Dimension | null = null
  let equivLabel = ''
  let equivX = 0, equivZ = 0

  if (hasCoords && state.dimension === 'overworld') {
    equivDim = 'nether'; equivLabel = 'Nether'; equivX = Math.floor(x / 8); equivZ = Math.floor(z / 8)
  } else if (hasCoords && state.dimension === 'nether') {
    equivDim = 'overworld'; equivLabel = 'Overworld'; equivX = x * 8; equivZ = z * 8
  }

  return (
    <div className="toolbar-navigate" title="Jump to coordinates — paste &quot;X, Z&quot; or a /tp command">
      <input type="number" className="toolbar-navigate-input" placeholder="X"
        value={gotoX} onChange={e => setGotoX(e.target.value)}
        onPaste={handleCoordPaste}
        onKeyDown={e => e.key === 'Enter' && handleGo()} />
      <input type="number" className="toolbar-navigate-input" placeholder="Z"
        value={gotoZ} onChange={e => setGotoZ(e.target.value)}
        onPaste={handleCoordPaste}
        onKeyDown={e => e.key === 'Enter' && handleGo()} />
      <button className="toolbar-navigate-go" disabled={!hasCoords} onClick={handleGo}>Go</button>
      {equivDim && (
        <button className="toolbar-navigate-equiv" title={`Go to ${equivLabel} at ${equivX}, ${equivZ}`}
          onClick={() => flyToCoords(equivX, equivZ, equivDim!)}>
          → {equivLabel}
        </button>
      )}
    </div>
  )
}

const ZOOM_LEVELS = Array.from({ length: MAX_ZOOM - MIN_ZOOM + 1 }, (_, i) => MIN_ZOOM + i)

function ToolbarZoom() {
  const { state, dispatch, mapRef } = useApp()

  const handleZoom = (zoom: number) => {
    dispatch({ type: 'SET_ZOOM', zoom })
    mapRef.current?.setZoom(zoom)
  }

  const [caveMin, caveMax] = caveZoomRange(state, state.dimension)
  const effectiveMin = state.caveMode ? caveMin : MIN_ZOOM
  const effectiveMax = state.caveMode ? caveMax : MAX_ZOOM

  return (
    <div className="toolbar-zoom" title={state.caveMode
      ? `Cave mode: zoom ${caveMin}–${caveMax}`
      : `Biome colors below zoom ${state.chunkDataMinZoom}, chunk data at or above`}>
      <span className="toolbar-zoom-label">Zoom</span>
      <div className="toolbar-zoom-track">
        {ZOOM_LEVELS.map(z => {
          const disabled = z < effectiveMin || z > effectiveMax
          const zone = z >= caveMin ? 'cave'
            : z >= state.chunkDataMinZoom ? 'chunk'
            : 'biome'
          return (
            <button
              key={z}
              className={`toolbar-zoom-dot zone-${zone}${z === state.zoom ? ' active' : ''}${disabled ? ' disabled' : ''}`}
              onClick={() => handleZoom(z)}
              disabled={disabled}
              title={`Zoom ${z > 0 ? '+' : ''}${z}`}
              aria-label={`Zoom ${z > 0 ? '+' : ''}${z}`}
            />
          )
        })}
      </div>
      <span className="toolbar-zoom-value">{state.zoom > 0 ? `+${state.zoom}` : state.zoom}</span>
    </div>
  )
}
