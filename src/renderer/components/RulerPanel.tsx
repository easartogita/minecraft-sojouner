import React from 'react'
import { useApp } from '../App'
import { TRAVEL_MODE_ORDER, TRAVEL_MODES, TravelMode, legTravelTime } from '../lib/travelModes'
import { useBiomeSplitSegments } from '../hooks/useBiomeSplitSegments'
import { RouteSubSegment } from '../lib/biomeSplit'

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

function ModeSelect({ value, onChange, disabled }: {
  value: TravelMode; onChange: (mode: TravelMode) => void; disabled?: boolean
}) {
  return (
    <select
      className="ruler-panel-mode-select"
      value={value}
      disabled={disabled}
      style={{ color: TRAVEL_MODES[value].color }}
      onChange={e => onChange(e.target.value as TravelMode)}
    >
      {TRAVEL_MODE_ORDER.map(id => (
        <option key={id} value={id}>{TRAVEL_MODES[id].label}</option>
      ))}
    </select>
  )
}

function segmentsTime(segments: RouteSubSegment[]): number {
  return segments.reduce((s, seg) => s + legTravelTime(seg.distance, seg.mode), 0)
}

export default function RulerPanel() {
  const { state, dispatch, generatorConfig } = useApp()
  const {
    rulerActive, rulerPlacementMode, rulerWaypoints: wps, rulerLegModes,
    rulerCurrentMode, dimension, activeRouteId, savedRoutes,
  } = state
  const legSegments = useBiomeSplitSegments(generatorConfig, wps, rulerLegModes, state.boatMinSegmentBlocks)

  if (!rulerActive) return null

  const activeRoute = activeRouteId ? savedRoutes.find(r => r.id === activeRouteId) : null

  const legs = wps.length >= 2
    ? wps.slice(0, -1).map((a, i) => {
      const dist = legDist(a, wps[i + 1])
      const mode = rulerLegModes[i] ?? 'walk'
      const segments = legSegments[i]
      const isSplit = (mode === 'boat' || mode === 'walk') && segments && segments.length > 1
      return {
        dist, mode,
        time: segments ? segmentsTime(segments) : legTravelTime(dist, mode),
        isSplit,
      }
    })
    : []
  const total = legs.reduce((s, l) => s + l.dist, 0)
  const totalTime = legs.reduce((s, l) => s + l.time, 0)
  const netherEquiv = dimension === 'overworld' && total > 0 ? total / 8 : null

  return (
    <div className="ruler-panel">
      <div className="ruler-panel-header">
        <span className="ruler-panel-title">{activeRoute ? `Routes — ${activeRoute.name}` : 'Routes'}</span>
        <div className="ruler-panel-header-actions">
          {rulerPlacementMode ? (<>
            {legs.length > 0 && (
              <button className="ruler-panel-btn" title={activeRouteId ? 'Update this saved route' : 'Save as a named route'}
                onClick={() => {
                  if (activeRouteId) {
                    dispatch({
                      type: 'UPDATE_ROUTE', id: activeRouteId,
                      changes: { waypoints: wps, legModes: rulerLegModes },
                    })
                  } else {
                    const first = wps[0], last = wps[wps.length - 1]
                    const name = `${Math.round(first.x)},${Math.round(first.z)} → ${Math.round(last.x)},${Math.round(last.z)}`
                    const id = `route-${Date.now()}`
                    dispatch({
                      type: 'ADD_ROUTE',
                      route: { id, name, dimension, waypoints: wps, legModes: rulerLegModes, createdAt: Date.now() },
                    })
                    dispatch({ type: 'RULER_SET_ACTIVE_ROUTE', id })
                  }
                }}>
                {activeRouteId ? 'Update' : 'Save'}
              </button>
            )}
            {wps.length > 0 && (
              <button className="ruler-panel-btn" title="Undo last point (Escape)"
                onClick={() => dispatch({ type: 'RULER_UNDO' })}>
                ↩
              </button>
            )}
            {wps.length > 0 && (
              <button className="ruler-panel-btn" title="Clear all points"
                onClick={() => dispatch({ type: 'RULER_CLEAR' })}>
                Clear
              </button>
            )}
          </>) : (
            wps.length > 0 && (
              <button className="ruler-panel-btn" title="Click the map to extend this route"
                onClick={() => dispatch({ type: 'RULER_START_EDITING' })}>
                Edit
              </button>
            )
          )}
          <button className="ruler-panel-btn ruler-panel-close" title="Close routes panel (R)"
            onClick={() => dispatch({ type: 'RULER_TOGGLE' })}>
            ✕
          </button>
        </div>
      </div>

      {rulerPlacementMode && wps.length === 0 && (
        <div className="ruler-panel-hint">Click on the map to place waypoints</div>
      )}

      {rulerPlacementMode && wps.length === 1 && (
        <div className="ruler-panel-hint">Click again to measure distance</div>
      )}

      {!rulerPlacementMode && wps.length > 0 && (
        <div className="ruler-panel-hint">Viewing — click "Edit" or right-click the map to extend this route</div>
      )}

      {rulerPlacementMode && (
        <div className="ruler-panel-current-mode">
          <span>Next leg</span>
          <ModeSelect
            value={rulerCurrentMode}
            onChange={mode => dispatch({ type: 'RULER_SET_CURRENT_MODE', mode })}
          />
        </div>
      )}

      {legs.length > 0 && (
        <div className="ruler-panel-legs">
          {legs.map((leg, i) => (
            <div key={i} className="ruler-panel-leg">
              <div className="ruler-panel-leg-row">
                <span className="ruler-panel-leg-num">{i + 1} → {i + 2}</span>
                <span className="ruler-panel-leg-dist">{formatDist(leg.dist)} blocks</span>
                <span className="ruler-panel-leg-time">{formatTime(leg.time)}</span>
              </div>
              <ModeSelect
                value={leg.mode}
                disabled={!rulerPlacementMode}
                onChange={mode => dispatch({ type: 'RULER_SET_LEG_MODE', index: i, mode })}
              />
              {leg.isSplit && (
                <div className="ruler-panel-leg-split">
                  {legSegments[i].map((seg, si) => (
                    <span key={si} style={{ color: TRAVEL_MODES[seg.mode].color }}>
                      {formatDist(seg.distance)} {TRAVEL_MODES[seg.mode].label.toLowerCase()}
                    </span>
                  ))}
                </div>
              )}
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
            <span>Total time</span>
            <span>{formatTime(totalTime)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
