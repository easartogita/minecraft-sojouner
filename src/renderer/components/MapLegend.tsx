import React, { useEffect, useRef, useState, useCallback } from 'react'
import L from 'leaflet'
import { useApp } from '../App'
import { lngToBlockX, latToBlockZ } from '../lib/tileCoords'
import { BIOME_NAMES, biomeToRGB } from '../lib/biomeColors'
import * as api from '../lib/tauriAPI'

interface Props {
  map: L.Map
}

interface LegendBiome {
  id: number
  name: string
  color: string
}

export default function MapLegend({ map }: Props) {
  const { state, generatorSlot, generatorConfig } = useApp()
  const [visibleBiomes, setVisibleBiomes] = useState<LegendBiome[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sampleBiomes = useCallback(() => {
    if (generatorSlot == null || !state.showBiomes) { setVisibleBiomes([]); return }
    const slot = generatorSlot
    const bounds = map.getBounds()
    const blockMinX = Math.floor(lngToBlockX(bounds.getWest()))
    const blockMaxX = Math.ceil (lngToBlockX(bounds.getEast()))
    const blockMinZ = Math.floor(latToBlockZ(bounds.getNorth()))
    const blockMaxZ = Math.ceil (latToBlockZ(bounds.getSouth()))

    const SCALE = 64
    const qx = Math.floor(blockMinX / SCALE)
    const qz = Math.floor(blockMinZ / SCALE)
    const qw = Math.max(1, Math.ceil((blockMaxX - blockMinX) / SCALE) + 2)
    const qh = Math.max(1, Math.ceil((blockMaxZ - blockMinZ) / SCALE) + 2)

    if (qw * qh > 4096) { setVisibleBiomes([]); return }

    const { seedBig, dimId, worldFlags, mcVersion } = generatorConfig
    api.getBiomeRegion(slot, seedBig, dimId, worldFlags, mcVersion, qx, qz, qw, qh, SCALE)
      .then(biomes => {
        const seen = new Set<number>()
        for (let i = 0; i < biomes.length; i++) seen.add(biomes[i])
        const list: LegendBiome[] = []
        for (const id of seen) {
          const name = BIOME_NAMES[id]
          if (!name) continue
          const [r, g, b] = biomeToRGB(id)
          list.push({ id, name, color: `rgb(${r},${g},${b})` })
        }
        list.sort((a, b) => a.name.localeCompare(b.name))
        setVisibleBiomes(list)
      })
      .catch(() => setVisibleBiomes([]))
  }, [map, generatorSlot, state.showBiomes, state.dimension, generatorConfig])

  useEffect(() => {
    const schedule = () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(sampleBiomes, 300)
    }
    map.on('moveend', schedule)
    map.on('zoomend', schedule)
    sampleBiomes()
    return () => {
      map.off('moveend', schedule)
      map.off('zoomend', schedule)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [map, generatorSlot, state.showBiomes, state.dimension, generatorConfig])

  useEffect(() => { sampleBiomes() }, [sampleBiomes])

  const showCave   = state.caveMode
  const showBiomes = visibleBiomes.length > 0
  const showSlime  = state.showSlimeChunks && state.dimension === 'overworld'
  const hasContent = showBiomes || showCave || showSlime

  if (!hasContent) return null

  return (
    <div className="map-legend" style={state.caveMode ? { left: 185 } : undefined}>
      <div className="legend-title">Legend</div>

      {showCave && (
        <div className="legend-section">
          <div className="legend-item">
            <span className="legend-swatch" style={{ background: 'rgb(112,112,112)' }} />
            <span className="legend-label">Cave floor</span>
          </div>
          <div className="legend-item">
            <span className="legend-swatch" style={{ background: 'rgb(20,20,28)' }} />
            <span className="legend-label">Solid rock</span>
          </div>
        </div>
      )}

      {showBiomes && (
        <div className="legend-section">
          {visibleBiomes.map(b => (
            <div key={b.id} className="legend-item">
              <span className="legend-swatch" style={{ background: b.color }} />
              <span className="legend-label">{b.name}</span>
            </div>
          ))}
        </div>
      )}

      {showSlime && (
        <div className="legend-section">
          <div className="legend-item">
            <span className="legend-swatch" style={{ background: 'rgba(0,220,0,0.35)', border: '1px solid rgba(0,200,0,0.5)' }} />
            <span className="legend-label">Slime chunk</span>
          </div>
        </div>
      )}
    </div>
  )
}
