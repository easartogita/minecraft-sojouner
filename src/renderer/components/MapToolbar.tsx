import React, { useEffect } from 'react'
import L from 'leaflet'
import { useApp } from '../App'
import { DIMENSIONS, Dimension, MC_VERSIONS, MIN_ZOOM, MAX_ZOOM } from '../lib/constants'
import { minecraftToLeaflet } from '../lib/tileCoords'
import DayNightBar from './DayNightBar'
import { caveZoomRange } from '../hooks/overlaySlice'
import { IconCenter, IconFollow } from './icons'

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
  const { state, dispatch, mapRef } = useApp()
  const isBedrockWorld = state.seedData?.edition === 'bedrock'

  const panToPlayer = (switchDimension: boolean) => {
    const { playerX, playerZ, playerDimension } = state.seedData ?? {}
    if (playerX == null || playerZ == null || !mapRef.current) return

    const playerDim = playerDimension ? DIM_MAP[playerDimension] : 'overworld'

    if (switchDimension && playerDim && playerDim !== state.dimension) {
      dispatch({ type: 'SET_DIMENSION', dimension: playerDim } as never)
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

    const breakFollow = () => dispatch({ type: 'SET_FOLLOW_PLAYER', follow: false } as never)

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
            onClick={() => dispatch({ type: 'SET_DIMENSION', dimension: dim } as never)}
          >
            {DIM_LABELS[dim]}
          </button>
        ))}
      </div>

      <div className="map-toolbar-divider" />

      <div className="map-toolbar-toggles">
        {!isBedrockWorld && (
          <ToolbarToggle label="Biomes" title="Toggle biome map (B)"
            active={state.showBiomes} onClick={() => dispatch({ type: 'TOGGLE_BIOMES' } as never)}
            mode={state.showBiomes && state.dimension === 'overworld' && MC_VERSIONS[state.selectedVersion] >= MC_VERSIONS['MC_1_18']
              ? (state.biomeMode === 'surface' ? 'Surface' : state.biomeMode === 'underground' ? 'Cave' : 'Deep')
              : undefined} />
        )}
        {state.worldDir && (
          <ToolbarToggle label="Chunk Data" title="Toggle explored-world data: region outlines at low zoom, real block colors up close (D)"
            active={state.showChunkData} onClick={() => dispatch({ type: 'TOGGLE_CHUNK_DATA' } as never)} />
        )}
        {!isBedrockWorld && state.dimension === 'overworld' && (
          <ToolbarToggle label="Slime Chunks" title="Toggle slime chunks (S)"
            active={state.showSlimeChunks} onClick={() => dispatch({ type: 'TOGGLE_SLIME_CHUNKS' } as never)} />
        )}
        {!isBedrockWorld && state.dimension === 'overworld' && MC_VERSIONS[state.selectedVersion] >= MC_VERSIONS['MC_1_18'] && (
          <ToolbarToggle label="Ore Veins" title="Cycle ore vein overlay: Density → Footprint → off (V)"
            active={state.showOreVeins}
            mode={state.showOreVeins ? (state.oreVeinMode === 'density' ? 'Density' : 'Footprint') : undefined}
            onClick={() => {
              if (!state.showOreVeins) {
                dispatch({ type: 'TOGGLE_ORE_VEINS' } as never)
                dispatch({ type: 'SET_ORE_VEIN_MODE', mode: 'density' } as never)
              } else if (state.oreVeinMode === 'density') {
                dispatch({ type: 'SET_ORE_VEIN_MODE', mode: 'footprint' } as never)
              } else {
                dispatch({ type: 'TOGGLE_ORE_VEINS' } as never)
              }
            }} />
        )}
        <ToolbarToggle label="Routes" title="Plan multi-leg routes with travel times (R)"
          active={state.rulerActive} onClick={() => dispatch({ type: 'RULER_TOGGLE' } as never)} />
        <ToolbarToggle label="Grids" title="Cycle grid overlay: Region → Chunk → Region+Chunk → off"
          active={state.showChunkGrid || state.showRegionGrid}
          mode={state.showRegionGrid && state.showChunkGrid ? 'Region+Chunk'
            : state.showChunkGrid ? 'Chunk'
            : state.showRegionGrid ? 'Region'
            : undefined}
          onClick={() => {
            const { showRegionGrid, showChunkGrid } = state
            if (!showRegionGrid && !showChunkGrid) {
              dispatch({ type: 'TOGGLE_REGION_GRID' } as never)
            } else if (showRegionGrid && !showChunkGrid) {
              dispatch({ type: 'TOGGLE_REGION_GRID' } as never)
              dispatch({ type: 'TOGGLE_CHUNK_GRID' } as never)
            } else if (!showRegionGrid && showChunkGrid) {
              dispatch({ type: 'TOGGLE_REGION_GRID' } as never)
            } else {
              dispatch({ type: 'TOGGLE_REGION_GRID' } as never)
              dispatch({ type: 'TOGGLE_CHUNK_GRID' } as never)
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
                onClick={() => panToPlayer(false)}
                title={sameDim ? 'Center on player' : `Center on projected position (${playerDim === 'nether' ? '×8' : '÷8'})`}
              >
                <IconCenter />
              </button>
            )}
            {canProject && (
              <button
                className={`toolbar-icon-btn${state.followPlayer ? ' following' : ''}`}
                onClick={() => dispatch({ type: 'TOGGLE_FOLLOW_PLAYER' } as never)}
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
                  dispatch({ type: 'SET_FOLLOW_PLAYER', follow: false } as never)
                  panToPlayer(true)
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

      <ToolbarZoom />

      {state.seedData?.dayTime != null && (
        <div className="map-toolbar-daynight">
          <DayNightBar dayTime={state.seedData.dayTime} />
        </div>
      )}
    </div>
  )
}

function ToolbarToggle({ label, title, active, onClick, mode }: {
  label: string; title: string; active: boolean; onClick: () => void; mode?: string
}) {
  return (
    <button className={`toolbar-toggle${active ? ' active' : ''}`} onClick={onClick} title={title}>
      {label}
      {mode && <span className="toolbar-toggle-mode"> · {mode}</span>}
    </button>
  )
}

const ZOOM_LEVELS = Array.from({ length: MAX_ZOOM - MIN_ZOOM + 1 }, (_, i) => MIN_ZOOM + i)

function ToolbarZoom() {
  const { state, dispatch, mapRef } = useApp()

  const handleZoom = (zoom: number) => {
    dispatch({ type: 'SET_ZOOM', zoom } as never)
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
            />
          )
        })}
      </div>
      <span className="toolbar-zoom-value">{state.zoom > 0 ? `+${state.zoom}` : state.zoom}</span>
    </div>
  )
}
