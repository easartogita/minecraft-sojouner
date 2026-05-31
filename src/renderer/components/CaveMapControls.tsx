import React from 'react'
import { useApp } from '../App'
import { CAVE_MODE_MIN_ZOOM, CAVE_MODE_MAX_ZOOM } from '../lib/constants'

const WORLD_MIN_Y = -64
const WORLD_MAX_Y = 320
const STEP        =  10

export default function CaveMapControls() {
  const { state, dispatch, mapRef } = useApp()

  if (!state.caveMode) return null

  const playerY = state.seedData?.playerY != null ? Math.floor(state.seedData.playerY) : null
  const { caveScanLow, caveScanHigh, zoom } = state

  const ceilingY = playerY != null ? playerY + caveScanHigh : null
  const floorY   = playerY != null ? playerY + caveScanLow  : null

  const setZoom = (z: number) => {
    const clamped = Math.max(CAVE_MODE_MIN_ZOOM, Math.min(CAVE_MODE_MAX_ZOOM, z))
    dispatch({ type: 'SET_ZOOM', zoom: clamped } as never)
    mapRef.current?.setZoom(clamped)
  }

  const setRange = (low: number, high: number) =>
    dispatch({ type: 'SET_CAVE_SCAN_RANGE', low, high } as never)

  const scanHighMax = playerY != null ? WORLD_MAX_Y - playerY : WORLD_MAX_Y
  const scanLowMin  = playerY != null ? WORLD_MIN_Y - playerY : WORLD_MIN_Y

  const raiseCeiling = () => setRange(caveScanLow, Math.min(scanHighMax, caveScanHigh + STEP))
  const lowerCeiling = () => setRange(caveScanLow, Math.max(1, caveScanHigh - STEP))
  const raiseFloor   = () => setRange(Math.min(-1, caveScanLow + STEP), caveScanHigh)
  const lowerFloor   = () => setRange(Math.max(scanLowMin, caveScanLow - STEP), caveScanHigh)

  return (
    <div className="cave-map-controls" onMouseDown={e => e.stopPropagation()}>

      {/* ── Zoom ── */}
      <div className="cmc-zoom-row">
        <button
          className="cmc-btn"
          onClick={() => setZoom(zoom - 1)}
          disabled={zoom <= CAVE_MODE_MIN_ZOOM}
          title="Zoom out"
        >−</button>
        <span className="cmc-zoom-val" title="Zoom level">{zoom}</span>
        <button
          className="cmc-btn"
          onClick={() => setZoom(zoom + 1)}
          disabled={zoom >= CAVE_MODE_MAX_ZOOM}
          title="Zoom in"
        >+</button>
      </div>

      <div className="cmc-divider" />

      {/* ── Y range ── */}
      <div className="cmc-label">Scan range</div>

      {/* Ceiling row */}
      <div className="cmc-y-row cmc-y-row--ceiling">
        <span className="cmc-row-label">Ceiling</span>
        <span className="cmc-y-abs">
          {ceilingY != null ? `Y ${ceilingY}` : `+${caveScanHigh}`}
        </span>
        <div className="cmc-row-btns">
          <button className="cmc-btn cmc-btn--sm" onClick={raiseCeiling} disabled={caveScanHigh >= scanHighMax} title="Raise ceiling">▲</button>
          <button className="cmc-btn cmc-btn--sm" onClick={lowerCeiling} disabled={caveScanHigh <= 1} title="Lower ceiling">▼</button>
        </div>
      </div>

      {/* Player anchor */}
      <div className="cmc-y-row cmc-y-row--player">
        <span className="cmc-row-label">Player</span>
        <span className="cmc-y-abs">
          {playerY != null ? `Y ${playerY}` : '—'}
        </span>
      </div>

      {/* Floor row */}
      <div className="cmc-y-row cmc-y-row--floor">
        <span className="cmc-row-label">Floor</span>
        <span className="cmc-y-abs">
          {floorY != null ? `Y ${floorY}` : `${caveScanLow}`}
        </span>
        <div className="cmc-row-btns">
          <button className="cmc-btn cmc-btn--sm" onClick={raiseFloor} disabled={caveScanLow >= -1} title="Raise floor">▲</button>
          <button className="cmc-btn cmc-btn--sm" onClick={lowerFloor} disabled={caveScanLow <= scanLowMin} title="Lower floor">▼</button>
        </div>
      </div>

    </div>
  )
}
