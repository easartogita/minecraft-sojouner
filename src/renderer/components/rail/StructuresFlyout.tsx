import React, { useEffect, useState, useCallback } from 'react'
import L from 'leaflet'
import { useApp } from '../../App'
import {
  STRUCTURE_CONFIG, StructureType, getStructuresForDimension,
  structureVariantKey, getVariantDef,
} from '../../lib/structureConfig'
import { queryStructures } from '../../lib/structureQuery'
import { minecraftToLeaflet } from '../../lib/tileCoords'
import { MC_VERSIONS } from '../../lib/constants'
import { DismissedEntry, listDismissed, restoreDismissed, clearAllDismissed } from '../../lib/dismissedStructures'

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

export default function StructuresFlyout() {
  const { state, dispatch, mapRef } = useApp()
  const { enabledStructures, disabledStructureVariants, notableLootOnly, dimension } = state
  const playerX   = state.seedData?.playerX ?? 0
  const playerZ   = state.seedData?.playerZ ?? 0
  const hasPlayer = state.seedData?.playerX != null

  const [structures, setStructures] = useState<StructureEntry[]>([])
  const [expandedTypes, setExpandedTypes] = useState<Set<StructureType>>(new Set())
  const [dismissed, setDismissed] = useState<DismissedEntry[]>([])
  const [dismissedExpanded, setDismissedExpanded] = useState(false)

  const seedBig = state.seedData ? BigInt(state.seedData.seed) : null

  useEffect(() => {
    setDismissed(seedBig != null ? listDismissed(seedBig) : [])
  }, [seedBig, state.structureRevision])

  const refreshMap = () => dispatch({ type: 'CLEAR_STRUCTURE_CACHE' } as never)

  const restoreOne = (key: string) => {
    if (seedBig == null) return
    restoreDismissed(seedBig, key)
    setDismissed(prev => prev.filter(d => d.key !== key))
    refreshMap()
  }

  const restoreAll = () => {
    if (seedBig == null) return
    clearAllDismissed(seedBig)
    setDismissed([])
    refreshMap()
  }

  useEffect(() => {
    if (!state.seedData) { setStructures([]); return }

    let cancelled = false
    // Round: player position is a float, and the query bounds cross the IPC
    // boundary as i32 — fractional bounds fail deserialization outright.
    const cx = Math.round(hasPlayer ? playerX : 0)
    const cz = Math.round(hasPlayer ? playerZ : 0)
    const seed = BigInt(state.seedData.seed)
    // The cubiomes enum value — the old Places panel passed the MCVersionKey
    // string here, which failed i32 deserialization on the Rust side and left
    // the Nearby list empty.
    const mcVersion = MC_VERSIONS[state.selectedVersion]
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
        if (disabledStructureVariants.has(structureVariantKey(structType, pos.variantTag ?? null))) continue
        const cfg = STRUCTURE_CONFIG[structType]
        const dx = pos.x - cx, dz = pos.z - cz
        const distance = Math.round(Math.sqrt(dx * dx + dz * dz))
        if (distance > SEARCH_RADIUS) continue
        const bearing = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360
        const variantLabel = pos.variantTag
          ? (getVariantDef(structType, pos.variantTag)?.label ?? pos.variantTag)
          : null
        entries.push({
          structType,
          label: variantLabel ? `${cfg.label} (${variantLabel})` : cfg.label,
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
  }, [state.seedData, state.selectedVersion, state.worldType, enabledStructures, disabledStructureVariants, dimension])

  const flyTo = useCallback((x: number, z: number) => {
    if (!mapRef.current) return
    const { x: lng, y: lat } = minecraftToLeaflet(x, z)
    mapRef.current.flyTo(L.latLng(lat, lng), Math.max(mapRef.current.getZoom(), 3))
  }, [mapRef])

  const toggleExpanded = (s: StructureType) => {
    setExpandedTypes(prev => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  }

  const dimStructures = getStructuresForDimension(dimension)
  const allEnabled    = dimStructures.every(s => enabledStructures.has(s))
  const allDisabled   = dimStructures.every(s => !enabledStructures.has(s))
  const nearbyCount   = structures.length

  return (
    <div className="flyout-panel">
      <div className="flyout-header">
        <span className="flyout-title">Structures</span>
        {nearbyCount > 0 && <span className="mp-count-badge">{nearbyCount}</span>}
      </div>

      <div className="flyout-body">
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

              if (!cfg.variants && !cfg.notableLoot) {
                return (
                  <label key={s} className={`mp-struct-check${on ? ' on' : ''}`} title={cfg.summary}
                    style={{ '--struct-color': cfg.color } as React.CSSProperties}>
                    <input type="checkbox" checked={on}
                      onChange={() => dispatch({ type: 'TOGGLE_STRUCTURE', structure: s } as never)} />
                    <span className="mp-struct-dot" style={{ background: cfg.color }} />
                    <span className="mp-struct-name">{cfg.label}</span>
                  </label>
                )
              }

              // Variant-capable type: base ("Standard") row plus one per variant.
              const rows: { key: string; tag: string | null; label: string; color: string; summary: string }[] =
                cfg.variants
                  ? [
                      { key: structureVariantKey(s, null), tag: null, label: 'Standard', color: cfg.color, summary: cfg.summary },
                      ...cfg.variants.map(v => ({
                        key: structureVariantKey(s, v.tag), tag: v.tag, label: v.label, color: v.color, summary: v.summary,
                      })),
                    ]
                  : []
              const excludedCount = rows.filter(r => disabledStructureVariants.has(r.key)).length
              const notableOn = notableLootOnly.has(s)
              const expanded = expandedTypes.has(s)

              return (
                <div key={s} className={`mp-struct-cell${expanded ? ' mp-struct-cell--expanded' : ''}`}>
                  <label className={`mp-struct-check${on ? ' on' : ''}`} title={cfg.summary}
                    style={{ '--struct-color': cfg.color } as React.CSSProperties}>
                    <input type="checkbox" checked={on}
                      onChange={() => dispatch({ type: 'TOGGLE_STRUCTURE', structure: s } as never)} />
                    <span className="mp-struct-dot" style={{ background: cfg.color }} />
                    <span className="mp-struct-name">{cfg.label}</span>
                    {excludedCount > 0 && (
                      <span className="mp-variant-chip"
                        title={`${rows.length - excludedCount} of ${rows.length} variants shown`}>
                        {rows.length - excludedCount}/{rows.length}
                      </span>
                    )}
                    {notableOn && (
                      <span className="mp-variant-chip mp-notable-chip" title={cfg.notableLoot?.label}>★</span>
                    )}
                    <button type="button" className="mp-variant-chevron"
                      title={expanded ? 'Hide options' : 'Show options'}
                      onClick={e => { e.preventDefault(); e.stopPropagation(); toggleExpanded(s) }}>
                      {expanded ? '▾' : '▸'}
                    </button>
                  </label>
                  {expanded && (
                    <div className={`mp-variant-list${on ? '' : ' mp-variant-list--muted'}`}>
                      {rows.map(r => {
                        const vOn = !disabledStructureVariants.has(r.key)
                        return (
                          <label key={r.key} className="mp-variant-row" title={r.summary}>
                            <input type="checkbox" checked={vOn}
                              onChange={() => dispatch({
                                type: 'TOGGLE_STRUCTURE_VARIANT', structure: s, tag: r.tag,
                              } as never)} />
                            <span className="mp-struct-dot" style={{ background: r.color }} />
                            <span className="mp-variant-name">{r.label}</span>
                          </label>
                        )
                      })}
                      {cfg.notableLoot && (
                        <label className="mp-variant-row mp-notable-row" title={cfg.notableLoot.summary}>
                          <input type="checkbox" checked={notableOn}
                            onChange={() => dispatch({ type: 'TOGGLE_NOTABLE_LOOT_ONLY', structure: s } as never)} />
                          <span className="mp-struct-dot" style={{ background: '#ffd700' }} />
                          <span className="mp-variant-name">Only: {cfg.notableLoot.label}</span>
                        </label>
                      )}
                    </div>
                  )}
                </div>
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

          <div className="mp-nearby-header mp-nearby-header--clickable"
            onClick={() => setDismissedExpanded(v => !v)}>
            <span style={{ marginRight: 4, fontSize: 10, flexShrink: 0 }}>
              {dismissedExpanded ? '▾' : '▸'}
            </span>
            Dismissed
            {dismissed.length > 0 && <span className="mp-count-badge">{dismissed.length}</span>}
            <button className="btn-sm" style={{ marginLeft: 'auto', textTransform: 'none' }}
              disabled={dismissed.length === 0}
              onClick={e => { e.stopPropagation(); restoreAll() }}>
              Restore all
            </button>
          </div>
          {dismissedExpanded && (
            dismissed.length === 0 ? (
              <div className="mp-empty">
                Nothing dismissed. "Mark as useless" on a structure popup hides it here.
              </div>
            ) : (
              <div className="struct-list">
                {dismissed.map(d => {
                  const cfg = STRUCTURE_CONFIG[d.structType]
                  return (
                    <div key={d.key} className="struct-list-row" onClick={() => flyTo(d.x, d.z)}
                      title={`${cfg?.label ?? d.structType} — X: ${d.x}, Z: ${d.z}`}
                      style={{ borderLeftColor: cfg?.color }}>
                      <span className="struct-list-name">{cfg?.label ?? d.structType}</span>
                      <span className="struct-list-coords">{d.x}, {d.z}</span>
                      <button type="button" className="btn-sm btn-sm--icon" title="Restore"
                        onClick={e => { e.stopPropagation(); restoreOne(d.key) }}>
                        ↺
                      </button>
                    </div>
                  )
                })}
              </div>
            )
          )}
        </>)}
      </div>
    </div>
  )
}
