import React, { useState } from 'react'
import L from 'leaflet'
import { useApp } from '../../App'
import { minecraftToLeaflet, parseCoordPaste } from '../../lib/tileCoords'
import { Dimension, MIN_ZOOM, MAX_ZOOM } from '../../lib/constants'
import { STRUCTURE_CONFIG } from '../../lib/structureConfig'
import { caveZoomRange } from '../../hooks/overlaySlice'

const STRUCTURE_MIN_ZOOMS = Object.values(STRUCTURE_CONFIG).map(c => c.minZoom)
const STRUCTURE_ZOOM_LOW  = Math.min(...STRUCTURE_MIN_ZOOMS)
const STRUCTURE_ZOOM_HIGH = Math.max(...STRUCTURE_MIN_ZOOMS)

const ZOOM_LEVELS = Array.from({ length: MAX_ZOOM - MIN_ZOOM + 1 }, (_, i) => MIN_ZOOM + i)

function Stepper({ label, value, unit, min, max, step = 1, onChange }: {
  label: string; value: number; unit?: string
  min: number; max: number; step?: number; onChange: (v: number) => void
}) {
  return (
    <div className="settings-stepper-row">
      <span className="settings-stepper-label">{label}</span>
      <div className="settings-stepper">
        <button className="settings-stepper-btn" disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - step))}>−</button>
        <span className="settings-stepper-val">
          {value}{unit && <span className="settings-stepper-unit"> {unit}</span>}
        </span>
        <button className="settings-stepper-btn" disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + step))}>+</button>
      </div>
    </div>
  )
}

/** Live zoom ruler — same zone vocabulary as the toolbar tick-strip, and
 *  clickable the same way: each cell jumps the map to that zoom. Green =
 *  biome colors, amber = chunk data, purple = cave-mode range; boundaries
 *  move with the steppers below it. */
function ZoomRuler({ chunkMin, caveMin, current, effectiveMin, effectiveMax, onSelect }: {
  chunkMin: number; caveMin: number; current: number
  effectiveMin: number; effectiveMax: number; onSelect: (z: number) => void
}) {
  return (
    <div className="zoom-ruler"
      title="What renders at each zoom — click to jump there. The amber zone starts at your chunk-data threshold; purple is the cave-mode range.">
      <div className="zoom-ruler-track">
        {ZOOM_LEVELS.map(z => {
          const zone = z >= caveMin ? 'cave' : z >= chunkMin ? 'chunk' : 'biome'
          const disabled = z < effectiveMin || z > effectiveMax
          return (
            <button key={z} type="button"
              className={`zoom-ruler-cell zone-${zone}${z === current ? ' current' : ''}`}
              disabled={disabled}
              title={`Zoom ${z > 0 ? '+' : ''}${z}`}
              onClick={() => onSelect(z)} />
          )
        })}
      </div>
      <div className="zoom-ruler-scale">
        {ZOOM_LEVELS.map(z => (
          <span key={z}
            className={`zoom-ruler-num${z === chunkMin ? ' num-chunk' : ''}${z === caveMin ? ' num-cave' : ''}`}>
            {z}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function SettingsFlyout() {
  const { state, dispatch, mapRef } = useApp()
  const [gotoX, setGotoX] = useState('')
  const [gotoZ, setGotoZ] = useState('')

  const panTo = (x: number, z: number, dim?: Dimension) => {
    if (!mapRef.current) return
    if (dim && dim !== state.dimension) {
      dispatch({ type: 'SET_DIMENSION', dimension: dim } as never)
    }
    const { x: lng, y: lat } = minecraftToLeaflet(x, z)
    mapRef.current.flyTo(L.latLng(lat, lng), Math.max(mapRef.current.getZoom(), 3))
  }

  const handleGo = () => {
    const x = parseInt(gotoX)
    const z = parseInt(gotoZ)
    if (isNaN(x) || isNaN(z)) return
    panTo(x, z)
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

  const setCaveMin = (dimension: 'overworld' | 'nether', min: number) =>
    dispatch({ type: 'SET_CAVE_ZOOM_MIN', dimension, min } as never)

  const [activeCaveMin, activeCaveMax] = caveZoomRange(state, state.dimension)

  // Same clamping as the toolbar tick-strip: cave mode restricts the range.
  const effectiveMin = state.caveMode ? activeCaveMin : MIN_ZOOM
  const effectiveMax = state.caveMode ? activeCaveMax : MAX_ZOOM

  const jumpToZoom = (zoom: number) => {
    dispatch({ type: 'SET_ZOOM', zoom } as never)
    mapRef.current?.setZoom(zoom)
  }

  return (
    <div className="flyout-panel">
      <div className="flyout-header">
        <span className="flyout-title">Settings</span>
      </div>

      <div className="flyout-body">
        <div className="flyout-section">
          <div className="flyout-section-label">Navigate</div>
          <div className="goto-row">
            <input type="number" className="goto-input" placeholder="X"
              value={gotoX} onChange={e => setGotoX(e.target.value)}
              onPaste={handleCoordPaste}
              onKeyDown={e => e.key === 'Enter' && handleGo()} />
            <input type="number" className="goto-input" placeholder="Z"
              value={gotoZ} onChange={e => setGotoZ(e.target.value)}
              onPaste={handleCoordPaste}
              onKeyDown={e => e.key === 'Enter' && handleGo()} />
            <button className="btn-sm" onClick={handleGo}>Go</button>
          </div>
          {equivDim && (
            <div className="goto-equiv" title={`Go to ${equivLabel} at ${equivX}, ${equivZ}`}
              onClick={() => panTo(equivX, equivZ, equivDim!)}>
              {equivLabel}: {equivX}, {equivZ}
            </div>
          )}
        </div>

        <div className="flyout-section">
          <div className="flyout-section-label">Zoom &amp; Layers</div>

          <ZoomRuler chunkMin={state.chunkDataMinZoom}
            caveMin={activeCaveMin} current={state.zoom}
            effectiveMin={effectiveMin} effectiveMax={effectiveMax}
            onSelect={jumpToZoom} />

          <Stepper label="Chunk data from zoom" value={state.chunkDataMinZoom}
            min={MIN_ZOOM} max={MAX_ZOOM}
            onChange={v => dispatch({ type: 'SET_CHUNK_DATA_MIN_ZOOM', zoom: v } as never)} />
          <Stepper label="Markers from zoom" value={state.markerMinZoom}
            min={MIN_ZOOM} max={MAX_ZOOM}
            onChange={v => dispatch({ type: 'SET_MARKER_MIN_ZOOM', zoom: v } as never)} />
          <Stepper label="Cave mode from zoom (Overworld)" value={state.caveZoomMinOverworld}
            min={MIN_ZOOM} max={MAX_ZOOM - 1}
            onChange={v => setCaveMin('overworld', v)} />
          <Stepper label="Cave mode from zoom (Nether)" value={state.caveZoomMinNether}
            min={MIN_ZOOM} max={MAX_ZOOM - 1}
            onChange={v => setCaveMin('nether', v)} />

          <div className="settings-zoom-table">
            <div className="settings-zoom-table-row">
              <span className="settings-zoom-table-dot zone-biome" />
              <span className="settings-zoom-table-label">Biome colors</span>
              <span className="settings-zoom-table-range">&lt; {state.chunkDataMinZoom}</span>
            </div>
            <div className="settings-zoom-table-row">
              <span className="settings-zoom-table-dot zone-chunk" />
              <span className="settings-zoom-table-label">Chunk data (.mca)</span>
              <span className="settings-zoom-table-range">≥ {state.chunkDataMinZoom}</span>
            </div>
            <div className="settings-zoom-table-row">
              <span className="settings-zoom-table-dot zone-cave" />
              <span className="settings-zoom-table-label">Cave mode ({state.dimension === 'nether' ? 'Nether' : 'Overworld'})</span>
              <span className="settings-zoom-table-range">{activeCaveMin}–{activeCaveMax}</span>
            </div>
            <div className="settings-zoom-table-row">
              <span className="settings-zoom-table-dot zone-grid" />
              <span className="settings-zoom-table-label">Chunk grid lines</span>
              <span className="settings-zoom-table-range">≥ 1</span>
            </div>
            <div className="settings-zoom-table-row">
              <span className="settings-zoom-table-dot zone-grid" />
              <span className="settings-zoom-table-label">Structures</span>
              <span className="settings-zoom-table-range">{STRUCTURE_ZOOM_LOW}–{STRUCTURE_ZOOM_HIGH} per type</span>
            </div>
            <div className="settings-zoom-table-row">
              <span className="settings-zoom-table-dot zone-grid" />
              <span className="settings-zoom-table-label">Entities &amp; POI</span>
              <span className="settings-zoom-table-range">≥ {state.markerMinZoom}</span>
            </div>
            <div className="settings-zoom-table-row">
              <span className="settings-zoom-table-dot zone-grid" />
              <span className="settings-zoom-table-label">Block name labels</span>
              <span className="settings-zoom-table-range">&gt; 6</span>
            </div>
          </div>
        </div>

        <div className="flyout-section">
          <div className="flyout-section-label">Route Planner</div>
          <Stepper label="Min. terrain crossing" value={state.boatMinSegmentBlocks} unit="blk"
            min={0} max={200} step={8}
            onChange={v => dispatch({ type: 'SET_BOAT_MIN_SEGMENT', blocks: v } as never)} />
          <div className="settings-hint">
            Water and ice crossings shorter than this stay On Foot
            <span className="layer-info-badge"
              title="Ocean, frozen-ocean, and snowy-land stretches shorter than this fall back to plain On Foot speed — not worth switching mode, or flagging the alert, for a short crossing.">?</span>
          </div>
        </div>

        <div className="flyout-section">
          <div className="flyout-section-label">Interface</div>
          <div className="settings-scale-row">
            <span className="settings-stepper-label">UI scale</span>
            <div className="settings-scale-btns">
              {([0.8, 1.0, 1.25, 1.5] as const).map(scale => (
                <button key={scale}
                  className={`ui-scale-btn${state.uiScale === scale ? ' active' : ''}`}
                  onClick={() => dispatch({ type: 'SET_UI_SCALE', scale } as never)}>
                  {Math.round(scale * 100)}%
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
