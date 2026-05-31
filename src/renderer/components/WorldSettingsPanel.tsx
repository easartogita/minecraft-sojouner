import React, { useEffect, useRef, useState } from 'react'
import { useApp } from '../App'
import * as api from '../lib/tauriAPI'
import { MC_VERSIONS } from '../lib/constants'
import {
  PerWorldSettings, WorldPregenSettings,
  loadWorldSettings, saveWorldSettings,
  MAX_PREGEN_RADIUS, DEFAULT_PREGEN_RADIUS,
} from '../lib/worldSettings'
import { pregenTiles, estimatePregenTileCount, PregenProgress } from '../lib/pregenTiles'

interface Props {
  onClose: () => void
}

export default function WorldSettingsPanel({ onClose }: Props) {
  const { state, dispatch, generatorSlot } = useApp()
  const worldDir = state.worldDir!

  // ── Per-world settings state ────────────────────────────────────────────────

  const [settings, setSettings] = useState<PerWorldSettings>(() => loadWorldSettings(worldDir))

  // Keep state in sync if a different world is somehow opened while panel is open
  useEffect(() => { setSettings(loadWorldSettings(worldDir)) }, [worldDir])

  const updateSettings = (patch: Partial<PerWorldSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch }
      saveWorldSettings(worldDir, next)
      if ('unlimitedCache' in patch) {
        dispatch({ type: 'SET_UNLIMITED_CACHE', enabled: patch.unlimitedCache! } as never)
      }
      return next
    })
  }

  const updatePregen = (patch: Partial<WorldPregenSettings>) => {
    setSettings(prev => {
      const next = { ...prev, pregen: { ...prev.pregen, ...patch } }
      saveWorldSettings(worldDir, next)
      return next
    })
  }

  // ── Region count for estimate ────────────────────────────────────────────────

  const edition = state.seedData?.edition ?? 'java'
  const [regionCount, setRegionCount] = useState<number | null>(null)
  useEffect(() => {
    api.listRegions(worldDir, edition, 'overworld').then(r => setRegionCount(r.length)).catch(() => setRegionCount(0))
  }, [worldDir, edition])

  const estimatedTiles = regionCount != null
    ? estimatePregenTileCount(
        settings.pregen.radiusBlocks,
        settings.pregen.includeChunks,
        settings.pregen.includeBiomes,
        regionCount,
      )
    : null

  // ── Pre-generation state ─────────────────────────────────────────────────────

  const [progress, setProgress] = useState<PregenProgress | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const isRunning = progress != null && progress.phase !== 'done' && progress.phase !== 'cancelled'

  const handleStart = async () => {
    if (!state.seedData || generatorSlot == null) return
    abortRef.current = new AbortController()
    const { seed, spawnX, spawnZ } = state.seedData
    await pregenTiles(
      {
        worldDir,
        edition,
        seed: BigInt(seed),
        mcVersion: MC_VERSIONS[state.selectedVersion],
        generatorSlot,
        dimension: state.dimension,
        includeChunks: settings.pregen.includeChunks,
        includeBiomes: settings.pregen.includeBiomes,
        radiusBlocks: settings.pregen.radiusBlocks,
        spawnX,
        spawnZ,
        hideWater: state.hideWater,
      },
      setProgress,
      abortRef.current.signal,
    )
    // Mark completion time if not cancelled
    setSettings(prev => {
      if (abortRef.current?.signal.aborted) return prev
      const next = { ...prev, pregenCompletedAt: Date.now() }
      saveWorldSettings(worldDir, next)
      return next
    })
  }

  const handleCancel = () => {
    abortRef.current?.abort()
  }

  // Cleanup on unmount
  useEffect(() => () => { abortRef.current?.abort() }, [])

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const completedAt = settings.pregenCompletedAt
  const completedStr = completedAt
    ? new Date(completedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  const worldName = worldDir.replace(/\\/g, '/').split('/').pop() ?? worldDir

  const pct = progress && progress.total > 0
    ? Math.round(progress.done / progress.total * 100)
    : 0

  return (
    <div className="ws-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ws-dialog">

        {/* Header */}
        <div className="ws-header">
          <span className="ws-title">World Settings</span>
          <button className="ws-close" onClick={onClose} title="Close">✕</button>
        </div>

        {/* World info */}
        <div className="ws-section">
          <div className="ws-world-name">{state.seedData?.levelName ?? worldName}</div>
          <div className="ws-world-path">{worldDir}</div>
        </div>

        {/* Unlimited cache */}
        <div className="ws-section">
          <label className="ws-toggle-row">
            <span className="ws-label">Unlimited cache</span>
            <input
              type="checkbox"
              className="ws-checkbox"
              checked={settings.unlimitedCache}
              onChange={e => updateSettings({ unlimitedCache: e.target.checked })}
            />
          </label>
          <p className="ws-hint">
            When enabled, tile caches are never evicted and the disk PNG cache is
            preserved across world reloads. Combine with Pre-generate for instant
            pan and zoom everywhere.
          </p>
        </div>

        {/* Pre-generate */}
        <div className="ws-section">
          <div className="ws-section-title">Pre-generate tiles</div>

          {completedStr && !isRunning && (
            <div className="ws-completed-badge">Last run: {completedStr}</div>
          )}

          {/* Options */}
          <div className="ws-field-row">
            <span className="ws-field-label">Biome radius</span>
            <div className="ws-radius-input-row">
              <input
                type="number"
                className="ws-number-input"
                value={settings.pregen.radiusBlocks}
                min={1000}
                max={MAX_PREGEN_RADIUS}
                step={1000}
                disabled={isRunning}
                onChange={e => {
                  const v = Math.min(MAX_PREGEN_RADIUS, Math.max(1000, parseInt(e.target.value) || DEFAULT_PREGEN_RADIUS))
                  updatePregen({ radiusBlocks: v })
                }}
              />
              <span className="ws-field-unit">blocks</span>
            </div>
          </div>

          <div className="ws-check-row">
            <label className="ws-check-label">
              <input
                type="checkbox"
                checked={settings.pregen.includeChunks}
                disabled={isRunning}
                onChange={e => updatePregen({ includeChunks: e.target.checked })}
              />
              Chunk tiles (all loaded regions, zoom 3–4)
            </label>
          </div>
          <div className="ws-check-row">
            <label className="ws-check-label">
              <input
                type="checkbox"
                checked={settings.pregen.includeBiomes}
                disabled={isRunning}
                onChange={e => updatePregen({ includeBiomes: e.target.checked })}
              />
              Biome tiles (spawn ± radius, zoom 0–1)
            </label>
          </div>

          {estimatedTiles != null && !isRunning && progress == null && (
            <div className="ws-estimate">~{estimatedTiles.toLocaleString()} tiles</div>
          )}

          {/* Progress */}
          {progress != null && (
            <div className="ws-progress-wrap">
              <div className="ws-progress-bar">
                <div
                  className={`ws-progress-fill ws-progress-fill--${progress.phase}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="ws-progress-label">
                {progress.phase === 'done' && `Done — ${progress.total.toLocaleString()} tiles rendered`}
                {progress.phase === 'cancelled' && `Cancelled — ${progress.done.toLocaleString()} / ${progress.total.toLocaleString()} tiles`}
                {(progress.phase === 'biomes' || progress.phase === 'chunks') &&
                  `${progress.phase === 'biomes' ? 'Biomes' : 'Chunks'} — ${progress.done.toLocaleString()} / ${progress.total.toLocaleString()} (${pct}%)`}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="ws-btn-row">
            {!isRunning ? (
              <button
                className="btn-sm"
                onClick={handleStart}
                disabled={generatorSlot == null || !state.seedData || (!settings.pregen.includeChunks && !settings.pregen.includeBiomes)}
              >
                {progress?.phase === 'done' ? 'Re-generate' : progress?.phase === 'cancelled' ? 'Retry' : 'Start'}
              </button>
            ) : (
              <button className="btn-sm f3-btn-danger" onClick={handleCancel}>Cancel</button>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
