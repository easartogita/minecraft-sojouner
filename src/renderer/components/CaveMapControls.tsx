import { useApp } from '../App'
import { caveZoomRange, effectiveCaveAnchorY } from '../hooks/overlaySlice'
import YRangeGauge from './YRangeGauge'

/**
 * Floating depth gauge for Chunk Data cave mode: thin wrapper around the
 * shared YRangeGauge, adding the cave zoom stepper and dispatching to the
 * cave scan-range/lock state.
 */
export default function CaveMapControls() {
  const { state, dispatch, mapRef } = useApp()

  if (!state.caveMode) return null

  const playerY = state.seedData?.playerY != null ? Math.floor(state.seedData.playerY) : null
  const anchorY = effectiveCaveAnchorY(state, playerY)
  if (anchorY == null) return null

  const { caveScanLow, caveScanHigh, zoom, caveLockedToPlayer: locked } = state

  const [caveMin, caveMax] = caveZoomRange(state, state.dimension)

  const setZoom = (z: number) => {
    const clamped = Math.max(caveMin, Math.min(caveMax, z))
    dispatch({ type: 'SET_ZOOM', zoom: clamped } as never)
    mapRef.current?.setZoom(clamped)
  }

  return (
    <div className="cave-map-controls" onMouseDown={e => e.stopPropagation()}>
      <YRangeGauge
        anchorY={anchorY} low={caveScanLow} high={caveScanHigh}
        playerY={playerY} locked={locked} snap={10}
        onRangeChange={(low, high) => dispatch({ type: 'SET_CAVE_SCAN_RANGE', low, high } as never)}
        onLockChange={(nextLocked, nextAnchorY) => dispatch({ type: 'SET_CAVE_LOCK', locked: nextLocked, anchorY: nextAnchorY } as never)}
        headerExtra={
          <div className="cmc-zoom">
            <button className="cmc-zoom-btn" onClick={() => setZoom(zoom - 1)}
              disabled={zoom <= caveMin} title="Zoom out">−</button>
            <span className="cmc-zoom-val" title="Zoom level">{zoom}</span>
            <button className="cmc-zoom-btn" onClick={() => setZoom(zoom + 1)}
              disabled={zoom >= caveMax} title="Zoom in">+</button>
          </div>
        }
      />
    </div>
  )
}
