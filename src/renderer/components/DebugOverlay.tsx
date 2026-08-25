import React, { useEffect, useRef, useState } from 'react'
import { useApp } from '../App'
import { useTileStats } from '../hooks/useTileStats'
import { resetAllStats, getOverlays, overlayQueueSize, overlayCacheSize, clearOverlayCaches } from '../lib/tileStats'
import { getAllQueues } from '../lib/tileJobQueue'
import { getBiomeCacheSize, clearBiomeCache, getBiomeQueue } from './BiomeTileLayer'
import { getChunkCacheSize, clearChunkCache, getChunkQueue } from './ChunkOverlayLayer'
import { getBELayerStats, resetBELayerStats, type BELayerStats } from './BlockEntityLayer'
import { getEntityLayerStats, resetEntityLayerStats } from './EntityLayer'
import { getPoiLayerStats, resetPoiLayerStats } from './PoiLayer'
import { getStructureLayerStats, resetStructureLayerStats } from './StructureLayer'
import { makeLayerStats } from '../lib/chunkMarkerLayer'
import * as api from '../lib/tauriAPI'

type FlashKey = 'biome' | 'chunk' | 'world' | 'stats' | 'struct' | 'overlay' | 'all'

interface PollSnapshot {
  be:        BELayerStats
  entity:    ReturnType<typeof getEntityLayerStats>
  poi:       ReturnType<typeof getPoiLayerStats>
  structure: ReturnType<typeof getStructureLayerStats>
}

function ap(totalMs: number, count: number, peakMs: number) {
  if (count === 0) return '—'
  return `${(totalMs / count).toFixed(1)} / ${peakMs.toFixed(1)} ms`
}

function hitPct(hits: number, misses: number) {
  const total = hits + misses
  if (total === 0) return '—'
  return `${Math.round(hits / total * 100)}%`
}

export default function DebugOverlay() {
  const { state, dispatch } = useApp()
  const ts = useTileStats()
  const visible = state.debugOverlayOpen
  const [flash, setFlash] = useState<FlashKey | null>(null)
  const [poll, setPoll] = useState<PollSnapshot | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollTimer  = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'F3') { e.preventDefault(); dispatch({ type: 'TOGGLE_DEBUG_OVERLAY' }) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [dispatch])

  useEffect(() => {
    if (!visible) { clearInterval(pollTimer.current ?? undefined); return }
    const tick = () => {
      setPoll({
        be: getBELayerStats(), entity: getEntityLayerStats(),
        poi: getPoiLayerStats(), structure: getStructureLayerStats(),
      })
    }
    tick()
    pollTimer.current = setInterval(tick, 2000)
    return () => clearInterval(pollTimer.current ?? undefined)
  }, [visible])

  if (!visible) return null

  const {
    biomeLoadingCount, biomeTilesLoaded, biomeTotalMs, biomePeakMs,
    mcaLoadingCount, mcaTilesLoaded, mcaCacheHits, mcaTotalMs, mcaPeakMs,
    pngDecodeCount, pngDecodeTotalMs, pngDecodePeakMs,
  } = ts

  const biomeActive  = biomeTilesLoaded > 0 || biomeLoadingCount > 0
  const chunkMissed  = mcaTilesLoaded   > 0
  const be    = poll?.be
  const ent   = poll?.entity
  const poi   = poll?.poi
  const struc = poll?.structure
  const overlays = getOverlays()

  const doFlash = (key: FlashKey) => {
    setFlash(key)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), 1500)
  }
  const lbl = (key: FlashKey, label: string) =>
    flash === key || flash === 'all' ? '✓' : label

  const handleClearBiome = async () => {
    clearBiomeCache()
    if (state.seedData?.seed != null) await api.clearBiomeTilePng(BigInt(state.seedData.seed))
    dispatch({ type: 'CLEAR_TILE_CACHE' })
    doFlash('biome')
  }
  const handleClearChunk = async () => {
    clearChunkCache()
    if (state.worldDir) await api.clearTilePng(state.worldDir)
    dispatch({ type: 'CLEAR_TILE_CACHE' })
    doFlash('chunk')
  }
  const handleClearStructures = () => {
    if (state.seedData?.seed != null) api.clearStructureCache(BigInt(state.seedData.seed))
    dispatch({ type: 'CLEAR_STRUCTURE_CACHE' })
    doFlash('struct')
  }
  const handleClearOverlays = () => {
    clearOverlayCaches()
    dispatch({ type: 'CLEAR_OVERLAY_CACHE' })
    doFlash('overlay')
  }
  const handleReloadWorld = async () => {
    clearChunkCache()
    if (state.worldDir) {
      await api.invalidateChunks(state.worldDir)
      dispatch({ type: 'CLEAR_TILE_CACHE' })
    }
    doFlash('world')
  }
  const handleResetStats = () => {
    resetAllStats()
    resetBELayerStats(); resetEntityLayerStats(); resetPoiLayerStats(); resetStructureLayerStats()
    setPoll(p => p ? {
      be: makeLayerStats(), entity: makeLayerStats(), poi: makeLayerStats(), structure: makeLayerStats(),
    } : null)
    doFlash('stats')
  }
  const handleClearAll = async () => {
    clearBiomeCache(); clearChunkCache(); clearOverlayCaches()
    const clears: Promise<void>[] = []
    if (state.seedData?.seed != null) {
      const s = BigInt(state.seedData.seed)
      clears.push(api.clearBiomeTilePng(s))
      clears.push(api.clearStructureCache(s))
    }
    if (state.worldDir) clears.push(api.invalidateChunks(state.worldDir))
    await Promise.all(clears)
    dispatch({ type: 'CLEAR_TILE_CACHE' })
    dispatch({ type: 'CLEAR_OVERLAY_CACHE' })
    dispatch({ type: 'CLEAR_STRUCTURE_CACHE' })
    resetAllStats()
    resetBELayerStats(); resetEntityLayerStats(); resetPoiLayerStats(); resetStructureLayerStats()
    setPoll(p => p ? {
      be: makeLayerStats(), entity: makeLayerStats(), poi: makeLayerStats(), structure: makeLayerStats(),
    } : null)
    doFlash('all')
  }

  return (
    <div className="debug-overlay">
      <div className="debug-overlay-header">
        <span>Debug · z{state.zoom}</span>
        <span className="f3-key-hint">F3</span>
      </div>
      <div className="debug-sb-panel">

        {/* Biome tiles */}
        {biomeActive && (
          <div className="debug-sb-section">
            <div className="debug-sb-title debug-sb-title--biome">
              Biome tiles{biomeLoadingCount > 0 ? ` · ${getBiomeQueue().size} queued` : ''}
            </div>
            {biomeTilesLoaded > 0 ? (
              <>
                <div className="debug-sb-row"><span>Rendered</span><span>{biomeTilesLoaded}</span></div>
                <div className="debug-sb-row"><span>Avg / peak</span><span>{ap(biomeTotalMs, biomeTilesLoaded, biomePeakMs)}</span></div>
                <div className="debug-sb-row"><span>JS cache</span><span>{getBiomeCacheSize()} / 1600</span></div>
              </>
            ) : (
              <div className="debug-sb-empty">Rendering…</div>
            )}
          </div>
        )}

        {/* Chunk tiles */}
        <div className="debug-sb-section">
          <div className="debug-sb-title debug-sb-title--chunk">
            Chunk tiles{mcaLoadingCount > 0 ? ` · ${getChunkQueue().size} queued` : ''}
            {pngDecodeCount > 0 ? ` · ${pngDecodeCount} decoding` : ''}
          </div>
          {!state.worldDir ? (
            <div className="debug-sb-empty">No world open</div>
          ) : chunkMissed ? (
            <>
              <div className="debug-sb-row">
                <span>Rendered / cached</span>
                <span>{mcaTilesLoaded} / {mcaCacheHits} ({hitPct(mcaCacheHits, mcaTilesLoaded)})</span>
              </div>
              <div className="debug-sb-row"><span>Invoke avg / peak</span><span>{ap(mcaTotalMs, mcaTilesLoaded, mcaPeakMs)}</span></div>
              {mcaTilesLoaded > 0 && (
                <div className="debug-sb-row"><span>Decode avg / peak</span><span>{ap(pngDecodeTotalMs, mcaTilesLoaded, pngDecodePeakMs)}</span></div>
              )}
            </>
          ) : (
            <div className="debug-sb-empty">{mcaLoadingCount > 0 ? 'Loading…' : 'Zoom in to load'}</div>
          )}
        </div>

        {/* Markers — gated on worldDir alone, not showMarkers: POI has its own
            visibility toggles independent of the Show Markers switch, so a
            section gated on showMarkers would hide POI stats while POI was
            actively loading. */}
        {state.worldDir && (
          <div className="debug-sb-section">
            <div className="debug-sb-title">Markers</div>
            {be && be.loadCount > 0 ? (
              <>
                <div className="debug-sb-row"><span>Block entities</span><span>{be.lastCount} vis / {be.totalFetched} fetched</span></div>
                <div className="debug-sb-row"><span>Load avg / peak</span><span>{ap(be.totalMs, be.loadCount, be.peakMs)}</span></div>
              </>
            ) : state.showMarkers ? (
              <div className="debug-sb-empty">{state.zoom >= state.markerMinZoom ? 'None loaded' : `Zoom ≥ ${state.markerMinZoom >= 0 ? '+' : ''}${state.markerMinZoom} to load`}</div>
            ) : null}
            {ent && ent.loadCount > 0 && (
              <>
                <div className="debug-sb-row"><span>Entities</span><span>{ent.lastCount} vis / {ent.totalFetched} fetched</span></div>
                <div className="debug-sb-row"><span>Load avg / peak</span><span>{ap(ent.totalMs, ent.loadCount, ent.peakMs)}</span></div>
              </>
            )}
            {poi && poi.loadCount > 0 && (
              <>
                <div className="debug-sb-row"><span>POI</span><span>{poi.lastCount} vis / {poi.totalFetched} fetched</span></div>
                <div className="debug-sb-row"><span>Load avg / peak</span><span>{ap(poi.totalMs, poi.loadCount, poi.peakMs)}</span></div>
              </>
            )}
          </div>
        )}

        {/* Structures */}
        {state.showStructures && state.seedData && struc && struc.loadCount > 0 && (
          <div className="debug-sb-section">
            <div className="debug-sb-title debug-sb-title--structure">Structures</div>
            <div className="debug-sb-row"><span>Rendered</span><span>{struc.lastCount} vis / {struc.totalFetched} candidates</span></div>
            <div className="debug-sb-row"><span>Scan avg / peak</span><span>{ap(struc.totalMs, struc.loadCount, struc.peakMs)}</span></div>
          </div>
        )}

        {/* Overlays (ore veins, ore features, carvers, terrain) */}
        {overlays.map(o => {
          const queued = overlayQueueSize(o)
          if (queued === 0 && o.stat.tilesLoaded === 0) return null
          return (
            <div className="debug-sb-section" key={o.key}>
              <div className={`debug-sb-title debug-sb-title--${o.className}`}>
                {o.label}{queued > 0 ? ` · ${queued} queued` : ''}
              </div>
              {o.stat.tilesLoaded > 0 ? (
                <>
                  <div className="debug-sb-row"><span>Rendered</span><span>{o.stat.tilesLoaded}</span></div>
                  <div className="debug-sb-row"><span>Avg / peak</span><span>{ap(o.stat.totalMs, o.stat.tilesLoaded, o.stat.peakMs)}</span></div>
                </>
              ) : (
                <div className="debug-sb-empty">Rendering…</div>
              )}
            </div>
          )
        })}

        {/* Queues — every registered TileJobQueue, so a job that never cancels
            shows up as active/pending sitting above zero with nothing on screen,
            or `started` climbing while idle. */}
        {(() => {
          const snaps = getAllQueues().map(q => q.snapshot())
          const live = snaps.filter(s => s.active > 0 || s.pending > 0)
          const totalStarted = snaps.reduce((n, s) => n + s.started, 0)
          if (live.length === 0 && totalStarted === 0) return null
          return (
            <div className="debug-sb-section">
              <div className="debug-sb-title">Queues{live.length > 0 ? ` · ${live.length} active` : ''}</div>
              {snaps.filter(s => s.active > 0 || s.pending > 0 || s.started > 0).map(s => (
                <div className="debug-sb-row" key={s.name}>
                  <span>{s.name}{s.paused ? ' ⏸' : ''}</span>
                  <span>{s.active}▶ {s.pending}⏳ · {s.completed}/{s.started}{s.cancelled > 0 ? ` ·${s.cancelled}✕` : ''}</span>
                </div>
              ))}
            </div>
          )
        })()}

        {/* Memory */}
        <div className="debug-sb-section">
          <div className="debug-sb-title">Memory</div>
          <div className="debug-sb-row"><span>Biome cache</span><span>{getBiomeCacheSize()} / 1600</span></div>
          <div className="debug-sb-row"><span>Chunk cache</span><span>{getChunkCacheSize()} / 1600</span></div>
          {overlays.map(o => {
            const size = overlayCacheSize(o)
            if (size === 0) return null
            return <div className="debug-sb-row" key={o.key}><span>{o.label} cache</span><span>{size}</span></div>
          })}
        </div>

        {/* Actions */}
        <div className="debug-sb-actions">
          <button className="btn-sm" onClick={handleResetStats}>{lbl('stats', 'Reset stats')}</button>
          <button className="btn-sm" onClick={handleClearBiome}>{lbl('biome', 'Clear biome')}</button>
          <button className="btn-sm" onClick={handleClearChunk}>{lbl('chunk', 'Clear chunk')}</button>
          <button className="btn-sm" onClick={handleClearStructures}>{lbl('struct', 'Clear structs')}</button>
          <button className="btn-sm" onClick={handleClearOverlays}>{lbl('overlay', 'Clear overlays')}</button>
          {state.worldDir && <button className="btn-sm" onClick={handleReloadWorld}>{lbl('world', 'Reload world')}</button>}
          <button className="btn-sm f3-btn-danger" onClick={handleClearAll}>{lbl('all', 'Clear all')}</button>
        </div>
      </div>
    </div>
  )
}
