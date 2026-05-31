import React, { useEffect, useState, useCallback } from 'react'
import L from 'leaflet'
import { useApp } from '../../App'
import { STRUCTURE_CONFIG, StructureType, getStructuresForDimension } from '../../lib/structureConfig'
import { queryStructures } from '../../lib/structureQuery'
import { minecraftToLeaflet } from '../../lib/tileCoords'
import { CustomMarkerGroup } from '../../lib/markerFilters'

interface StructureEntry {
  structType: StructureType
  label: string
  color: string
  x: number
  z: number
  distance: number
  bearing: number
}

const SEARCH_RADIUS = 10000

export default function MarkersFlyout() {
  const { state, dispatch, generatorSlot, mapRef } = useApp()
  const { enabledStructures, dimension } = state
  const playerX   = state.seedData?.playerX ?? 0
  const playerZ   = state.seedData?.playerZ ?? 0
  const hasPlayer = state.seedData?.playerX != null
  const playerY   = state.seedData?.playerY ?? null

  // ── Structures ──────────────────────────────────────────────────────────────

  const [structures, setStructures] = useState<StructureEntry[]>([])

  useEffect(() => {
    if (!state.seedData) { setStructures([]); return }

    let cancelled = false
    const cx = hasPlayer ? playerX : 0
    const cz = hasPlayer ? playerZ : 0
    const seed = BigInt(state.seedData.seed)
    const mcVersion = state.selectedVersion
    const worldFlags = state.worldType === 'large_biomes' ? 1 : 0

    const fetchStructures = async () => {
      if (cancelled) return
      const raw = await queryStructures(
        seed, mcVersion, dimension, worldFlags, enabledStructures,
        cx - SEARCH_RADIUS, cz - SEARCH_RADIUS,
        cx + SEARCH_RADIUS, cz + SEARCH_RADIUS,
      )

      const entries: StructureEntry[] = []
      for (const { structType, pos } of raw) {
        if (cancelled) return
        const cfg = STRUCTURE_CONFIG[structType]
        const dx = pos.x - cx, dz = pos.z - cz
        const distance = Math.round(Math.sqrt(dx * dx + dz * dz))
        if (distance > SEARCH_RADIUS) continue
        const bearing = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360
        entries.push({
          structType,
          label: pos.variantTag ? `${cfg.label} (${pos.variantTag})` : cfg.label,
          color: pos.variantColor ?? cfg.color,
          x: pos.x, z: pos.z, distance, bearing,
        })
      }

      if (!cancelled) {
        entries.sort((a, b) => a.distance - b.distance)
        setStructures(entries)
      }
    }

    void fetchStructures()
    return () => { cancelled = true }
  }, [state.seedData, state.selectedVersion, state.worldType, enabledStructures, dimension])

  const flyTo = useCallback((x: number, z: number) => {
    if (!mapRef.current) return
    const { x: lng, y: lat } = minecraftToLeaflet(x, z)
    mapRef.current.setView(L.latLng(lat, lng), Math.max(mapRef.current.getZoom(), 3))
  }, [mapRef])

  const dimStructures = getStructuresForDimension(dimension)
  const allEnabled    = dimStructures.every(s => enabledStructures.has(s))
  const allDisabled   = dimStructures.every(s => !enabledStructures.has(s))
  const nearbyCount   = structures.length

  // ── Pins ────────────────────────────────────────────────────────────────────

  const [editingPinId, setEditingPinId] = useState<string | null>(null)
  const [editingLabel, setEditingLabel] = useState('')

  const goToPin = useCallback((x: number, z: number) => {
    if (!mapRef.current) return
    const { x: lng, y: lat } = minecraftToLeaflet(x, z)
    mapRef.current.setView(L.latLng(lat, lng), Math.max(mapRef.current.getZoom(), 3))
  }, [mapRef])

  // ── World data ───────────────────────────────────────────────────────────────

  const markerAllOn  = state.markerGroupDefs.every(g => state.enabledMarkerGroups.has(g.id))
  const markerAllOff = state.markerGroupDefs.every(g => !state.enabledMarkerGroups.has(g.id))

  return (
    <div className="flyout-panel">
      <div className="flyout-header">
        <span className="flyout-title">Markers</span>
      </div>

      <div className="flyout-body">

        {/* ── Structures ───────────────────────────────────────────────────── */}
        <div className="mp-section-header">
          <span className="mp-section-title">Structures</span>
          {nearbyCount > 0 && <span className="mp-count-badge">{nearbyCount}</span>}
        </div>

        {!state.seedData ? (
          <div className="mp-empty">Open a world to view structures.</div>
        ) : (<>
          <div className="mp-world-toggle-row">
            <label className="overlay-toggle">
              <input type="checkbox" checked={state.showStructures}
                onChange={() => dispatch({ type: 'TOGGLE_STRUCTURES' } as never)} />
              <span className="overlay-label">Show Structures</span>
            </label>
          </div>
          <div className="mp-struct-header">
            <span className="mp-struct-dim-label">{dimension[0].toUpperCase() + dimension.slice(1)}</span>
            <div className="mp-struct-header-btns">
              <button className="btn-sm" disabled={allEnabled}
                onClick={() => dimStructures.forEach(s => !enabledStructures.has(s) && dispatch({ type: 'TOGGLE_STRUCTURE', structure: s } as never))}>
                All
              </button>
              <button className="btn-sm" disabled={allDisabled}
                onClick={() => dimStructures.forEach(s => enabledStructures.has(s) && dispatch({ type: 'TOGGLE_STRUCTURE', structure: s } as never))}>
                None
              </button>
            </div>
          </div>
          <div className="mp-struct-grid">
            {dimStructures.map(s => {
              const cfg = STRUCTURE_CONFIG[s]
              const on  = enabledStructures.has(s)
              return (
                <label key={s} className={`mp-struct-check${on ? ' on' : ''}`} title={cfg.summary}
                  style={{ '--struct-color': cfg.color } as React.CSSProperties}>
                  <input type="checkbox" checked={on}
                    onChange={() => dispatch({ type: 'TOGGLE_STRUCTURE', structure: s } as never)} />
                  <span className="mp-struct-dot" style={{ background: cfg.color }} />
                  <span className="mp-struct-name">{cfg.label}</span>
                </label>
              )
            })}
          </div>

          {enabledStructures.size > 0 && (<>
            <div className="mp-nearby-header">
              Nearby <span className="mp-nearby-radius">(within {(SEARCH_RADIUS / 1000).toFixed(0)}k blocks)</span>
            </div>
            {structures.length === 0 ? (
              <div className="mp-empty">No structures found nearby.</div>
            ) : (
              <div className="struct-list">
                {structures.map((s, i) => {
                  const distLabel = s.distance >= 1000
                    ? `${(s.distance / 1000).toFixed(1)}k`
                    : `${s.distance}`
                  return (
                    <div key={i} className="struct-list-row" onClick={() => flyTo(s.x, s.z)}
                      title={`${s.label} — X: ${s.x}, Z: ${s.z} (${s.distance} blocks)`}
                      style={{ borderLeftColor: s.color }}>
                      <span className="struct-list-dot" style={{ background: s.color }} />
                      <span className="struct-list-name">{s.label}</span>
                      <span className="struct-list-coords">{s.x}, {s.z}</span>
                      <span className="struct-list-dist">
                        <span className="struct-dir-arrow"
                          style={{ transform: `rotate(${s.bearing}deg)` }}
                          aria-label={`Direction: ${Math.round(s.bearing)}°`}>↑</span>
                        {distLabel}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
            {!hasPlayer && (
              <div className="struct-list-note">Distances from world origin (no player position loaded)</div>
            )}
          </>)}
        </>)}

        {/* ── Pins ─────────────────────────────────────────────────────────── */}
        <div className="mp-section-header mp-section-header--ruled">
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
                            dispatch({ type: 'UPDATE_PIN', id: pin.id, changes: { label: editingLabel } } as never)
                            setEditingPinId(null)
                          } else if (e.key === 'Escape') {
                            setEditingPinId(null)
                          }
                        }}
                        onBlur={() => {
                          dispatch({ type: 'UPDATE_PIN', id: pin.id, changes: { label: editingLabel } } as never)
                          setEditingPinId(null)
                        }}
                        autoFocus />
                    ) : (
                      <span className="pin-label" title="Click to rename"
                        onClick={() => { setEditingPinId(pin.id); setEditingLabel(pin.label) }}>
                        📌 {pin.label}
                      </span>
                    )}
                    <div className="pin-actions">
                      <span className="pin-dim-badge" title={pin.dimension}>{dimLabel}</span>
                      <button className="btn-sm" style={{ padding: '2px 6px' }}
                        onClick={() => goToPin(pinGotoX, pinGotoZ)}
                        title={canGoTo ? 'Go to pin' : 'Pin is in another dimension'}
                        disabled={!canGoTo}>→</button>
                      <button className="btn-sm" style={{ padding: '2px 6px', color: '#c0392b', borderColor: '#c0392b' }}
                        onClick={() => dispatch({ type: 'REMOVE_PIN', id: pin.id } as never)}
                        title="Remove pin">✕</button>
                    </div>
                  </div>
                  <div className="pin-detail-row">
                    {isOWOrNether && (
                      <label className="pin-cross-toggle"
                        title="Show in both Overworld and Nether with converted coordinates">
                        <input type="checkbox" checked={pin.crossDimensional}
                          onChange={() => dispatch({ type: 'UPDATE_PIN', id: pin.id, changes: { crossDimensional: !pin.crossDimensional } } as never)} />
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

        {/* ── World Data ───────────────────────────────────────────────────── */}
        {state.worldDir && (<>
          <div className="mp-section-header mp-section-header--ruled">
            <span className="mp-section-title">World Data</span>
          </div>

          <div className="mp-world-toggle-row">
            <label className="overlay-toggle"
              title="Block entities (chests, spawners, signs…) and entities — requires zoom ≥ 5">
              <input type="checkbox" checked={state.showMarkers}
                onChange={() => dispatch({ type: 'TOGGLE_MARKERS' } as never)} />
              <span className="overlay-label">Show Markers</span>
            </label>
            <span className="mp-zoom-hint">zoom ≥ 5</span>
          </div>

          {playerY !== null && (
            <div className="mp-y-section">
              <div className="mp-y-header">
                <label className="mp-y-toggle">
                  <input type="checkbox" checked={state.markerYFilterEnabled}
                    onChange={() => dispatch({ type: 'SET_MARKER_Y_FILTER', enabled: !state.markerYFilterEnabled } as never)} />
                  <span>Y filter</span>
                </label>
                <span className="mp-y-center-badge">Y {Math.round(playerY)}</span>
              </div>
              {state.markerYFilterEnabled && (
                <div className="mp-y-slider-row">
                  <span className="mp-y-bound">{Math.round(playerY - state.markerYFilterRadius)}</span>
                  <input type="range" className="mp-y-slider" min={5} max={128} step={5}
                    value={state.markerYFilterRadius}
                    onChange={e => dispatch({ type: 'SET_MARKER_Y_FILTER', radius: Number(e.target.value) } as never)} />
                  <span className="mp-y-bound">{Math.round(playerY + state.markerYFilterRadius)}</span>
                </div>
              )}
            </div>
          )}

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
            <div className="mp-group-list">
              {(state.markerGroupDefs as CustomMarkerGroup[]).map(g => {
                const on = state.enabledMarkerGroups.has(g.id)
                return (
                  <label key={g.id} className="mp-group-row"
                    style={{ '--group-color': g.color } as React.CSSProperties}>
                    <input type="checkbox" checked={on}
                      onChange={() => dispatch({ type: 'SET_MARKER_GROUP', group: g.id, enabled: !on } as never)} />
                    <span className="mp-dot" style={{ background: g.color }} />
                    <span className="mp-group-name">{g.name}</span>
                  </label>
                )
              })}
            </div>
          </div>
        </>)}

      </div>
    </div>
  )
}
