import React, { useState } from 'react'
import L from 'leaflet'
import { useApp } from '../../App'
import { minecraftToLeaflet } from '../../lib/tileCoords'
import { Dimension } from '../../lib/constants'

export default function SettingsFlyout({ onOpenMarkerEditor }: { onOpenMarkerEditor: () => void }) {
  const { state, dispatch, mapRef } = useApp()
  const [gotoX, setGotoX] = useState('')
  const [gotoZ, setGotoZ] = useState('')

  const panTo = (x: number, z: number, dim?: Dimension) => {
    if (!mapRef.current) return
    if (dim && dim !== state.dimension) {
      dispatch({ type: 'SET_DIMENSION', dimension: dim } as never)
    }
    const { x: lng, y: lat } = minecraftToLeaflet(x, z)
    mapRef.current.setView(L.latLng(lat, lng), Math.max(mapRef.current.getZoom(), 3))
  }

  const handleGo = () => {
    const x = parseInt(gotoX)
    const z = parseInt(gotoZ)
    if (isNaN(x) || isNaN(z)) return
    panTo(x, z)
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
              onKeyDown={e => e.key === 'Enter' && handleGo()} />
            <input type="number" className="goto-input" placeholder="Z"
              value={gotoZ} onChange={e => setGotoZ(e.target.value)}
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
          <div className="flyout-section-label">Markers</div>
          <button className="btn-sm settings-full-btn" onClick={onOpenMarkerEditor}>
            Customize Marker Groups…
          </button>
        </div>

        <div className="flyout-section">
          <div className="flyout-section-label">UI Scale</div>
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
  )
}
