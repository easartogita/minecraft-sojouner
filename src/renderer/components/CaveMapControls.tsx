import { useEffect, useRef, useState } from 'react'
import { useApp } from '../App'
import { caveZoomRange, effectiveCaveAnchorY } from '../hooks/overlaySlice'
import * as api from '../lib/tauriAPI'
import type { CaveRangePreset } from '../lib/tauriAPI.types'
import { defaultCaveRangePresets } from '../lib/staticExport/schema'
import YRangeGauge from './YRangeGauge'

// Nether's valid Y range (0..127) doesn't share a space with Overworld's -64..320,
// so the gauge scale itself has to shift, not just the presets drawn on it.
function yRangeFor(dimension: string): [number, number] {
  return dimension === 'nether' ? [0, 127] : [-64, 320]
}

function ZoomStepper({ zoom, min, max, onChange }: { zoom: number; min: number; max: number; onChange: (z: number) => void }) {
  return (
    <div className="cmc-zoom">
      <button className="cmc-zoom-btn" onClick={() => onChange(zoom - 1)}
        disabled={zoom <= min} title="Zoom out">−</button>
      <span className="cmc-zoom-val" title="Zoom level">{zoom}</span>
      <button className="cmc-zoom-btn" onClick={() => onChange(zoom + 1)}
        disabled={zoom >= max} title="Zoom in">+</button>
    </div>
  )
}

// Floating depth gauge for Chunk Data cave mode.
//
// Live app: the shared YRangeGauge, whose window follows or freezes relative to a real
// player Y. Clicking a preset unlocks from the player (anchorY 0) and sets
// caveScanLow/High to its bounds directly, then the gauge is free to fine-tune from there.
//
// Static export: no live player position to lock to and no backend to render an arbitrary
// window, so this renders the same gauge (anchorY pinned to 0) with dragging switched off —
// only the preset swatches can move the window, over the fixed Y-ranges baked into the
// bundle for the current dimension (tauriAPI.static.ts's renderTile matches caveScanLow/High
// against a preset exactly; anything else resolves to a blank tile).
export default function CaveMapControls() {
  const { state, dispatch, mapRef } = useApp()

  // Static export reads the presets baked into this bundle for the current dimension;
  // live has no manifest, so it computes the same defaults the export dialog bakes.
  const [staticPresets, setStaticPresets] = useState<CaveRangePreset[]>([])
  useEffect(() => {
    if (!api.IS_STATIC_SITE) return
    let cancelled = false
    // Clear immediately, or the auto-bind effect below could fire with the previous
    // dimension's presets during the fetch's async gap.
    setStaticPresets([])
    api.getCaveRangePresets(state.dimension).then(p => { if (!cancelled) setStaticPresets(p) })
    return () => { cancelled = true }
  }, [state.dimension])
  const presets = api.IS_STATIC_SITE ? staticPresets : defaultCaveRangePresets(state.dimension)

  // Static export can never satisfy "locked to player", so as soon as cave mode turns on
  // (or the dimension changes while it's on) fall back to this dimension's first baked
  // preset — Overworld and Nether don't share a Y space, so a leftover Overworld band is
  // simply out of range in Nether and resolves to nothing. anchorY 0 keeps low/high
  // numerically equal to the preset's own bounds, matching what renderTile expects.
  //
  // Tracked via a ref, not derived from caveLockedToPlayer: once the user picks a
  // different preset within the same dimension, locked stays false and must not be
  // stomped back to preset[0] on every re-render — only an actual dimension change (or
  // fresh cave-mode enable) should force a re-snap.
  const lastBoundDimRef = useRef<string | null>(null)
  useEffect(() => {
    if (!api.IS_STATIC_SITE) return
    if (!state.caveMode) { lastBoundDimRef.current = null; return }
    if (presets.length === 0 || lastBoundDimRef.current === state.dimension) return
    lastBoundDimRef.current = state.dimension
    dispatch({ type: 'SET_CAVE_LOCK', locked: false, anchorY: 0 })
    dispatch({ type: 'SET_CAVE_SCAN_RANGE', low: presets[0].low, high: presets[0].high })
  }, [state.caveMode, state.dimension, presets, dispatch])

  if (!state.caveMode) return null

  const playerY = state.seedData?.playerY != null ? Math.floor(state.seedData.playerY) : null
  const anchorY = effectiveCaveAnchorY(state, playerY)
  if (anchorY == null) return null

  const { caveScanLow, caveScanHigh, zoom, caveLockedToPlayer: locked } = state
  const [caveMin, caveMax] = caveZoomRange(state, state.dimension)
  const [yMin, yMax] = yRangeFor(state.dimension)

  const setZoom = (z: number) => {
    const clamped = Math.max(caveMin, Math.min(caveMax, z))
    dispatch({ type: 'SET_ZOOM', zoom: clamped })
    mapRef.current?.setZoom(clamped)
  }

  if (api.IS_STATIC_SITE) {
    return (
      <div className="cave-map-controls" onMouseDown={e => e.stopPropagation()}>
        <YRangeGauge
          anchorY={anchorY} low={caveScanLow} high={caveScanHigh}
          playerY={playerY} draggable={false} snap={10}
          yMin={yMin} yMax={yMax}
          onRangeChange={() => {}}
          headerExtra={<ZoomStepper zoom={zoom} min={caveMin} max={caveMax} onChange={setZoom} />}
          presets={presets}
          onPresetSelect={p => dispatch({ type: 'SET_CAVE_SCAN_RANGE', low: p.low, high: p.high })}
        />
      </div>
    )
  }

  return (
    <div className="cave-map-controls" onMouseDown={e => e.stopPropagation()}>
      <YRangeGauge
        anchorY={anchorY} low={caveScanLow} high={caveScanHigh}
        playerY={playerY} locked={locked} snap={10}
        yMin={yMin} yMax={yMax}
        onRangeChange={(low, high) => dispatch({ type: 'SET_CAVE_SCAN_RANGE', low, high })}
        onLockChange={(nextLocked, nextAnchorY) => dispatch({ type: 'SET_CAVE_LOCK', locked: nextLocked, anchorY: nextAnchorY })}
        headerExtra={<ZoomStepper zoom={zoom} min={caveMin} max={caveMax} onChange={setZoom} />}
        presets={presets}
        onPresetSelect={p => {
          // anchorY 0 jumps to the fixed band and drops out of following the player,
          // leaving the gauge free to fine-tune from there.
          dispatch({ type: 'SET_CAVE_LOCK', locked: false, anchorY: 0 })
          dispatch({ type: 'SET_CAVE_SCAN_RANGE', low: p.low, high: p.high })
        }}
      />
    </div>
  )
}
