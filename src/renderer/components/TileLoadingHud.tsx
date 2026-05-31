import React from 'react'
import { useTileStats } from '../hooks/useTileStats'
import { getBiomeQueue } from './BiomeTileLayer'
import { getChunkQueue } from './ChunkOverlayLayer'

export default function TileLoadingHud() {
  const { pngDecodeCount } = useTileStats()
  const biomeQueueSize = getBiomeQueue().size
  const chunkQueueSize = getChunkQueue().size
  const anyLoading = biomeQueueSize > 0 || chunkQueueSize > 0 || pngDecodeCount > 0

  if (!anyLoading) return null

  return (
    <div className="f3-hud">
      {biomeQueueSize > 0 && <span className="f3-hud-dot f3-hud-dot--biome" />}
      {chunkQueueSize > 0 && <span className="f3-hud-dot f3-hud-dot--chunk" />}
      {pngDecodeCount > 0 && <span className="f3-hud-dot f3-hud-dot--png"   />}
      <span className="f3-hud-label">
        {[
          biomeQueueSize > 0 && `${biomeQueueSize} biome`,
          chunkQueueSize > 0 && `${chunkQueueSize} chunk`,
          pngDecodeCount > 0 && `${pngDecodeCount} decode`,
        ].filter(Boolean).join(' · ')}
      </span>
    </div>
  )
}
