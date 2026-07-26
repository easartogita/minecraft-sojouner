import { useState } from 'react'
import { useApp } from '../../App'
import { CustomMarkerGroup } from '../../lib/markerFilters'
import { effectiveMarkerAnchorY } from '../../hooks/overlaySlice'
import YRangeGauge from '../YRangeGauge'
import MarkerGroupRow, { PRESET_COLORS, randomId } from './MarkerGroupRow'

export default function WorldDataFlyout() {
  const { state, dispatch } = useApp()

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)

  const playerY = state.seedData?.playerY != null ? Math.floor(state.seedData.playerY) : null
  const yAnchor = effectiveMarkerAnchorY(state, playerY)

  const markerAllOn  = state.markerGroupDefs.every(g => state.enabledMarkerGroups.has(g.id))
  const markerAllOff = state.markerGroupDefs.every(g => !state.enabledMarkerGroups.has(g.id))

  const addGroup = () => {
    const id = randomId()
    const usedColors = new Set(state.markerGroupDefs.map(g => g.color))
    const color = PRESET_COLORS.find(c => !usedColors.has(c)) ?? PRESET_COLORS[0]
    const group: CustomMarkerGroup = { id, name: 'New Group', color, beTypes: [], entityTypes: [] }
    dispatch({ type: 'ADD_MARKER_GROUP', group } as never)
    setExpandedId(id)
  }

  const doReset = () => {
    dispatch({ type: 'RESET_MARKER_GROUPS' } as never)
    setConfirmReset(false)
    setExpandedId(null)
  }

  return (
    <div className="flyout-panel">
      <div className="flyout-header">
        <span className="flyout-title">World Data</span>
      </div>

      <div className="flyout-body">
        {!state.worldDir ? (
          <div className="mp-empty">Open a world to view its data.</div>
        ) : (<>
          <div className="mp-world-toggle-row">
            <label className="overlay-toggle"
              title={`Block entities (chests, spawners, signs…) and entities — requires zoom ≥ ${state.markerMinZoom}`}>
              <input type="checkbox" checked={state.showMarkers}
                onChange={() => dispatch({ type: 'TOGGLE_MARKERS' } as never)} />
              <span className="overlay-label">Show Markers</span>
              <span className="mp-zoom-hint">zoom ≥ {state.markerMinZoom}</span>
            </label>
          </div>

          <div className="mp-group-section">
            <div className="mp-group-header">
              <span className="mp-group-label">Marker Types</span>
              <div className="mp-group-btns">
                <button className="btn-sm" disabled={markerAllOn}
                  onClick={() => dispatch({ type: 'SET_ALL_MARKER_GROUPS', enabled: true } as never)}>All</button>
                <button className="btn-sm" disabled={markerAllOff}
                  onClick={() => dispatch({ type: 'SET_ALL_MARKER_GROUPS', enabled: false } as never)}>None</button>
              </div>
            </div>
            <div className="mgr-group-list">
              {(state.markerGroupDefs as CustomMarkerGroup[]).map(g => {
                const on = state.enabledMarkerGroups.has(g.id)
                return (
                  <MarkerGroupRow key={g.id} group={g} enabled={on}
                    expanded={expandedId === g.id}
                    onToggleEnabled={() => dispatch({ type: 'SET_MARKER_GROUP', group: g.id, enabled: !on } as never)}
                    onToggleExpanded={() => setExpandedId(expandedId === g.id ? null : g.id)} />
                )
              })}
            </div>
            <div className="mgr-footer">
              <button className="btn-sm" onClick={addGroup}>+ Add Group</button>
              {confirmReset ? (<>
                <span className="mgr-reset-confirm">Reset?</span>
                <button className="btn-sm mgr-btn-danger" onClick={doReset}>Yes</button>
                <button className="btn-sm" onClick={() => setConfirmReset(false)}>Cancel</button>
              </>) : (
                <button className="btn-sm" onClick={() => setConfirmReset(true)}>Reset to Defaults</button>
              )}
            </div>
          </div>

          {/* Y filter sits below the marker-type pills */}
          {(playerY !== null || state.markerYAnchorY != null) && (
            <div className="mp-y-section mp-y-section--below">
              <label className="overlay-toggle">
                <input type="checkbox" checked={state.markerYFilterEnabled}
                  onChange={() => dispatch({ type: 'SET_MARKER_Y_FILTER', enabled: !state.markerYFilterEnabled } as never)} />
                <span className="overlay-label">Y filter</span>
                {yAnchor != null && (
                  <span className="mp-y-center-badge"
                    title={state.markerYLockedToPlayer ? 'Window follows the player' : 'Window frozen at this Y'}>
                    Y {yAnchor}{!state.markerYLockedToPlayer && ' ❄'}
                  </span>
                )}
              </label>
              {state.markerYFilterEnabled && yAnchor != null && (
                <div className="mp-y-gauge-wrap">
                  <YRangeGauge
                    anchorY={yAnchor} low={state.markerYLow} high={state.markerYHigh}
                    playerY={playerY} locked={state.markerYLockedToPlayer} snap={5}
                    onRangeChange={(low, high) => dispatch({ type: 'SET_MARKER_Y_FILTER', low, high } as never)}
                    onLockChange={(locked, anchorY) => dispatch({ type: 'SET_MARKER_Y_LOCK', locked, anchorY } as never)}
                  />
                </div>
              )}
            </div>
          )}
        </>)}
      </div>
    </div>
  )
}
