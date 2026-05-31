import React from 'react'
import { useApp } from '../App'

function legDist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.z - a.z) ** 2)
}

function formatDist(blocks: number): string {
  if (blocks >= 10000) return `${(blocks / 1000).toFixed(1)}k`
  return `${Math.round(blocks).toLocaleString()}`
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}m ${s}s`
}

const WALK_SPEED = 4.317  // blocks/second

export default function RulerPanel() {
  const { state, dispatch } = useApp()
  const { rulerActive, rulerWaypoints: wps, dimension } = state

  if (!rulerActive) return null

  const legs = wps.length >= 2
    ? wps.slice(0, -1).map((a, i) => legDist(a, wps[i + 1]))
    : []
  const total = legs.reduce((s, d) => s + d, 0)
  const netherEquiv = dimension === 'overworld' && total > 0 ? total / 8 : null

  return (
    <div className="ruler-panel">
      <div className="ruler-panel-header">
        <span className="ruler-panel-title">Ruler</span>
        <div className="ruler-panel-header-actions">
          {wps.length > 0 && (
            <button className="ruler-panel-btn" title="Undo last point (Escape)"
              onClick={() => dispatch({ type: 'RULER_UNDO' } as never)}>
              ↩
            </button>
          )}
          {wps.length > 0 && (
            <button className="ruler-panel-btn" title="Clear all points"
              onClick={() => dispatch({ type: 'RULER_CLEAR' } as never)}>
              Clear
            </button>
          )}
          <button className="ruler-panel-btn ruler-panel-close" title="Close ruler (R)"
            onClick={() => dispatch({ type: 'RULER_TOGGLE' } as never)}>
            ✕
          </button>
        </div>
      </div>

      {wps.length === 0 && (
        <div className="ruler-panel-hint">Click on the map to place waypoints</div>
      )}

      {wps.length === 1 && (
        <div className="ruler-panel-hint">Click again to measure distance</div>
      )}

      {legs.length > 0 && (
        <div className="ruler-panel-legs">
          {legs.map((dist, i) => (
            <div key={i} className="ruler-panel-leg">
              <span className="ruler-panel-leg-num">{i + 1} → {i + 2}</span>
              <span className="ruler-panel-leg-dist">{formatDist(dist)} blocks</span>
            </div>
          ))}
        </div>
      )}

      {total > 0 && (
        <div className="ruler-panel-totals">
          {legs.length > 1 && (
            <div className="ruler-panel-total-row">
              <span>Total</span>
              <span>{formatDist(total)} blocks</span>
            </div>
          )}
          {netherEquiv != null && (
            <div className="ruler-panel-total-row ruler-panel-nether">
              <span>Nether equiv.</span>
              <span>{formatDist(netherEquiv)} blocks</span>
            </div>
          )}
          <div className="ruler-panel-total-row ruler-panel-time">
            <span>Walk time</span>
            <span>{formatTime(total / WALK_SPEED)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
