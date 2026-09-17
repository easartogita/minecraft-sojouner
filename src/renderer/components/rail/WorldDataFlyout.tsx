import { useState } from 'react'
import { useApp } from '../../App'
import { CustomMarkerGroup } from '../../lib/markerFilters'
import { effectiveMarkerAnchorY } from '../../hooks/overlaySlice'
import YRangeGauge from '../YRangeGauge'
import ZoomVisibilityBadge from '../ZoomVisibilityBadge'
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
    dispatch({ type: 'ADD_MARKER_GROUP', group })
    setExpandedId(id)
  }

  const doReset = () => {
    dispatch({ type: 'RESET_MARKER_GROUPS' })
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
                onChange={() => dispatch({ type: 'TOGGLE_MARKERS' })} />
              <span className="overlay-label">Show Markers</span>
              <ZoomVisibilityBadge checked={state.showMarkers} currentZoom={state.zoom} minZoom={state.markerMinZoom} />
            </label>
          </div>

          <div className={`mp-group-section${state.showMarkers ? '' : ' mp-group-section--disabled'}`}>
            <div className="mp-group-header">
              <span className="mp-group-label">Marker Types</span>
              <div className="mp-group-btns">
                <button className="btn-sm" disabled={markerAllOn}
                  onClick={() => dispatch({ type: 'SET_ALL_MARKER_GROUPS', enabled: true })}>All</button>
                <button className="btn-sm" disabled={markerAllOff}
                  onClick={() => dispatch({ type: 'SET_ALL_MARKER_GROUPS', enabled: false })}>None</button>
              </div>
            </div>
            <div className="mgr-group-list">
              {(state.markerGroupDefs as CustomMarkerGroup[]).map(g => {
                const on = state.enabledMarkerGroups.has(g.id)
                return (
                  <MarkerGroupRow key={g.id} group={g} enabled={on}
                    expanded={expandedId === g.id}
                    onToggleEnabled={() => dispatch({ type: 'SET_MARKER_GROUP', group: g.id, enabled: !on })}
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

          {/* Chunk (cave mode) and markers are two independent on/off switches over one
              shared Y window (see overlaySlice's yFilterLow/High) — enabling this filter
              here edits the exact same range Cave Mode uses, and vice versa. */}
          {(playerY !== null || state.yFilterAnchorY != null) && (
            <div className="mp-y-section mp-y-section--below">
              <label className="overlay-toggle">
                <input type="checkbox" checked={state.markerYFilterEnabled}
                  onChange={() => dispatch({ type: 'SET_MARKER_Y_FILTER', enabled: !state.markerYFilterEnabled })} />
                <span className="overlay-label">Y filter</span>
                {yAnchor != null && (
                  <span className="mp-y-center-badge"
                    title={state.yFilterLockedToPlayer ? 'Window follows the player' : 'Window frozen at this Y'}>
                    Y {yAnchor}{!state.yFilterLockedToPlayer && ' ❄'}
                  </span>
                )}
                {state.caveMode && (
                  <span className="mp-y-shared-badge" title="This is the same Y range Cave Mode is using for chunk rendering">
                    also filtering chunk data
                  </span>
                )}
              </label>
              {state.markerYFilterEnabled && yAnchor != null && (
                <div className="mp-y-gauge-wrap">
                  <YRangeGauge
                    anchorY={yAnchor} low={state.yFilterLow} high={state.yFilterHigh}
                    playerY={playerY} locked={state.yFilterLockedToPlayer} snap={5}
                    onRangeChange={(low, high) => dispatch({ type: 'SET_MARKER_Y_FILTER', low, high })}
                    onLockChange={(locked, anchorY) => dispatch({ type: 'SET_MARKER_Y_LOCK', locked, anchorY })}
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
