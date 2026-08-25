import { useState, useCallback } from 'react'
import L from 'leaflet'
import { useApp } from '../../App'
import { minecraftToLeaflet } from '../../lib/tileCoords'
import { routeTotalDistance, routeTotalTime, TravelMode } from '../../lib/travelModes'
import { IconPin, IconRoute } from '../icons'

export default function SavedFlyout() {
  const { state, dispatch, mapRef } = useApp()

  // Pins

  const [editingPinId, setEditingPinId] = useState<string | null>(null)
  const [editingLabel, setEditingLabel] = useState('')

  const goToPin = useCallback((x: number, z: number) => {
    if (!mapRef.current) return
    const { x: lng, y: lat } = minecraftToLeaflet(x, z)
    mapRef.current.flyTo(L.latLng(lat, lng), Math.max(mapRef.current.getZoom(), 3))
  }, [mapRef])

  // Saved routes

  const [editingRouteId, setEditingRouteId] = useState<string | null>(null)
  const [editingRouteName, setEditingRouteName] = useState('')

  const loadRoute = useCallback((id: string, waypoints: { x: number; z: number }[], legModes: TravelMode[]) => {
    dispatch({ type: 'RULER_LOAD_ROUTE', id, waypoints, legModes })
    if (mapRef.current && waypoints.length > 0) {
      const bounds = L.latLngBounds(waypoints.map(w => {
        const { x: lng, y: lat } = minecraftToLeaflet(w.x, w.z)
        return L.latLng(lat, lng)
      }))
      mapRef.current.fitBounds(bounds, { padding: [60, 60] })
    }
  }, [dispatch, mapRef])

  const startNewRoute = useCallback(() => {
    dispatch({ type: 'RULER_NEW' })
  }, [dispatch])

  function formatRouteDist(blocks: number): string {
    if (blocks >= 10000) return `${(blocks / 1000).toFixed(1)}k`
    return `${Math.round(blocks).toLocaleString()}`
  }

  function formatRouteTime(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}s`
    const m = Math.floor(seconds / 60)
    const s = Math.round(seconds % 60)
    return `${m}m ${s}s`
  }

  return (
    <div className="flyout-panel">
      <div className="flyout-header">
        <span className="flyout-title">Saved</span>
      </div>

      <div className="flyout-body">

        {/* Pins */}
        <div className="mp-section-header">
          <span className="mp-section-title">Pins</span>
          {state.pins.length > 0 && <span className="mp-count-badge">{state.pins.length}</span>}
        </div>

        {state.pins.length === 0 ? (
          <div className="mp-empty">Ctrl+click on the map to add a pin.</div>
        ) : (<>
          <div className="pin-list">
            {state.pins.map(pin => {
              const dimLabel     = pin.dimension === 'overworld' ? 'OW' : pin.dimension === 'nether' ? 'NT' : 'End'
              const isOWOrNether = pin.dimension === 'overworld' || pin.dimension === 'nether'
              const inActiveDim  = pin.dimension === state.dimension
              const crossVisible = pin.crossDimensional && isOWOrNether
                && (state.dimension === 'overworld' || state.dimension === 'nether')
              const canGoTo = inActiveDim || crossVisible
              let pinGotoX = pin.x, pinGotoZ = pin.z
              if (!inActiveDim && crossVisible) {
                if (pin.dimension === 'overworld' && state.dimension === 'nether') {
                  pinGotoX = Math.floor(pin.x / 8); pinGotoZ = Math.floor(pin.z / 8)
                } else if (pin.dimension === 'nether' && state.dimension === 'overworld') {
                  pinGotoX = pin.x * 8; pinGotoZ = pin.z * 8
                }
              }
              const owX = pin.dimension === 'overworld' ? pin.x : pin.x * 8
              const owZ = pin.dimension === 'overworld' ? pin.z : pin.z * 8
              const ntX = pin.dimension === 'nether'    ? pin.x : Math.floor(pin.x / 8)
              const ntZ = pin.dimension === 'nether'    ? pin.z : Math.floor(pin.z / 8)

              return (
                <div key={pin.id} className="pin-item-wrap">
                  <div className="pin-item">
                    {editingPinId === pin.id ? (
                      <input className="pin-label-input" value={editingLabel}
                        onChange={e => setEditingLabel(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            dispatch({ type: 'UPDATE_PIN', id: pin.id, changes: { label: editingLabel } })
                            setEditingPinId(null)
                          } else if (e.key === 'Escape') {
                            setEditingPinId(null)
                          }
                        }}
                        onBlur={() => {
                          dispatch({ type: 'UPDATE_PIN', id: pin.id, changes: { label: editingLabel } })
                          setEditingPinId(null)
                        }}
                        autoFocus />
                    ) : (
                      <span className="pin-label" title="Click to rename"
                        onClick={() => { setEditingPinId(pin.id); setEditingLabel(pin.label) }}>
                        <IconPin className="icon-inline" /> {pin.label}
                      </span>
                    )}
                    <div className="pin-actions">
                      <span className="pin-dim-badge" title={pin.dimension}>{dimLabel}</span>
                      <button className="btn-sm" style={{ padding: '2px 6px' }}
                        onClick={() => goToPin(pinGotoX, pinGotoZ)}
                        title={canGoTo ? 'Go to pin' : 'Pin is in another dimension'}
                        disabled={!canGoTo}>→</button>
                      <button className="btn-sm" style={{ padding: '2px 6px', color: '#c0392b', borderColor: '#c0392b' }}
                        onClick={() => dispatch({ type: 'REMOVE_PIN', id: pin.id })}
                        title="Remove pin">✕</button>
                    </div>
                  </div>
                  <div className="pin-detail-row">
                    {isOWOrNether && (
                      <label className="pin-cross-toggle"
                        title="Show in both Overworld and Nether with converted coordinates">
                        <input type="checkbox" checked={pin.crossDimensional}
                          onChange={() => dispatch({ type: 'UPDATE_PIN', id: pin.id, changes: { crossDimensional: !pin.crossDimensional } })} />
                        <span>Cross-dim</span>
                      </label>
                    )}
                    {pin.crossDimensional && isOWOrNether ? (
                      <div className="pin-coords-cross">
                        <div className="pin-coord-row">
                          <span className="pin-coord-dim-label">OW</span>
                          <span className="pin-coord-nums">{owX}, {owZ}</span>
                        </div>
                        <div className="pin-coord-row">
                          <span className="pin-coord-dim-label">NT</span>
                          <span className="pin-coord-nums">{ntX}, {ntZ}</span>
                        </div>
                      </div>
                    ) : (
                      <span className="pin-coords-dual">{pin.x}, {pin.z}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
            Ctrl+click on the map to add a pin
          </div>
        </>)}

        {/* Saved Routes */}
        <div className="mp-section-header mp-section-header--ruled">
          <span className="mp-section-title">Saved Routes</span>
          {state.savedRoutes.length > 0 && <span className="mp-count-badge">{state.savedRoutes.length}</span>}
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={startNewRoute}>+ New</button>
        </div>

        {state.savedRoutes.length === 0 ? (
          <div className="mp-empty">Click "+ New" above, or right-click the map, to start a route.</div>
        ) : (
          <div className="pin-list">
            {state.savedRoutes.map(route => {
              const dimLabel = route.dimension === 'overworld' ? 'OW' : route.dimension === 'nether' ? 'NT' : 'End'
              const dist = routeTotalDistance(route.waypoints)
              const time = routeTotalTime(route.waypoints, route.legModes)
              const legCount = Math.max(route.waypoints.length - 1, 0)
              const isActive = route.id === state.activeRouteId

              return (
                <div key={route.id} className={`pin-item-wrap${isActive ? ' route-item-active' : ''}`}>
                  <div className="pin-item">
                    {editingRouteId === route.id ? (
                      <input className="pin-label-input" value={editingRouteName}
                        onChange={e => setEditingRouteName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            dispatch({ type: 'UPDATE_ROUTE', id: route.id, changes: { name: editingRouteName } })
                            setEditingRouteId(null)
                          } else if (e.key === 'Escape') {
                            setEditingRouteId(null)
                          }
                        }}
                        onBlur={() => {
                          dispatch({ type: 'UPDATE_ROUTE', id: route.id, changes: { name: editingRouteName } })
                          setEditingRouteId(null)
                        }}
                        autoFocus />
                    ) : (
                      <span className="route-label" title="Click to rename"
                        onClick={() => { setEditingRouteId(route.id); setEditingRouteName(route.name) }}>
                        <IconRoute className="icon-inline" /> {route.name}{isActive ? ' (active)' : ''}
                      </span>
                    )}
                    <div className="pin-actions">
                      <span className="pin-dim-badge" title={route.dimension}>{dimLabel}</span>
                      <button className="btn-sm" style={{ padding: '2px 6px' }}
                        onClick={() => loadRoute(route.id, route.waypoints, route.legModes)}
                        title="Make active and view on map">→</button>
                      <button className="btn-sm" style={{ padding: '2px 6px', color: '#c0392b', borderColor: '#c0392b' }}
                        onClick={() => dispatch({ type: 'REMOVE_ROUTE', id: route.id })}
                        title="Delete route">✕</button>
                    </div>
                  </div>
                  <div className="pin-detail-row">
                    <span className="route-summary">
                      {legCount} {legCount === 1 ? 'leg' : 'legs'} · {formatRouteDist(dist)} blocks · {formatRouteTime(time)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}

      </div>
    </div>
  )
}
