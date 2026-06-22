import React from 'react'
import { useApp } from '../App'
import { useTileStats } from '../hooks/useTileStats'
import { getOverlays, overlayQueueSize } from '../lib/tileStats'
import { getBiomeQueue } from './BiomeTileLayer'
import { getChunkQueue } from './ChunkOverlayLayer'

export default function TileLoadingHud() {
  const { state } = useApp()
  const { pngDecodeCount } = useTileStats()
  const biomeQueueSize = getBiomeQueue().size
  const chunkQueueSize = getChunkQueue().size
  const overlays = getOverlays()
    .map(o => ({ o, size: overlayQueueSize(o) }))
    .filter(({ size }) => size > 0)
  const anyLoading = biomeQueueSize > 0 || chunkQueueSize > 0 || pngDecodeCount > 0 || overlays.length > 0

  // The debug panel (F3) shows per-layer queued counts already — avoid stacking
  // the HUD on top of it in the same corner.
  if (state.debugOverlayOpen || !anyLoading) return null

  return (
    <div className="f3-hud">
      {biomeQueueSize > 0 && <span className="f3-hud-dot f3-hud-dot--biome" />}
      {chunkQueueSize > 0 && <span className="f3-hud-dot f3-hud-dot--chunk" />}
      {pngDecodeCount > 0 && <span className="f3-hud-dot f3-hud-dot--png"   />}
      {overlays.map(({ o }) => (
        <span key={o.key} className={`f3-hud-dot f3-hud-dot--${o.className}`} />
      ))}
      <span className="f3-hud-label">
        {[
          biomeQueueSize > 0 && `${biomeQueueSize} biome`,
          chunkQueueSize > 0 && `${chunkQueueSize} chunk`,
          pngDecodeCount > 0 && `${pngDecodeCount} decode`,
          ...overlays.map(({ o, size }) => `${size} ${o.label.toLowerCase()}`),
        ].filter(Boolean).join(' · ')}
      </span>
    </div>
  )
}
