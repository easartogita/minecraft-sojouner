import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../../App'
import * as api from '../../lib/tauriAPI'
import { MC_VERSIONS } from '../../lib/constants'
import {
  PerWorldSettings, WorldPregenSettings,
  loadWorldSettings, saveWorldSettings,
  MAX_PREGEN_RADIUS, DEFAULT_PREGEN_RADIUS,
} from '../../lib/worldSettings'
import { pregenTiles, estimatePregenTileCount, PregenProgress } from '../../lib/pregenTiles'
import { loadOverlaySession } from '../../hooks/overlaySlice'
import { DEFAULT_CAVE_RANGE_PRESETS_OVERWORLD, defaultCaveRangePresets } from '../../lib/staticExport/schema'
import type { CaveRangePreset } from '../../lib/tauriAPI.types'
import { IconFolder } from '../icons'
import { timeAgo } from '../../lib/timeAgo'

const SITE_EXPORT_DIMENSIONS = ['overworld', 'nether', 'end'] as const

type Resolution = 1 | 2 | 4

export default function WorldFlyout() {
  const { state, dispatch, loadWorld, generatorSlot } = useApp()

  const [showAllSaves, setShowAllSaves] = useState(false)
  const [savesWorlds, setSavesWorlds] = useState<api.SavesWorldEntry[] | null>(null)
  const [showGameRules, setShowGameRules] = useState(false)

  useEffect(() => {
    api.listSavesWorlds().then(setSavesWorlds).catch(() => setSavesWorlds([]))
  }, [])

  const openWorld = async (path: string) => {
    try { await loadWorld(path) } catch (err) {
      dispatch({ type: 'SET_ERROR', error: String(err) })
    }
  }

  const browseWorldFolder = async () => {
    const path = await api.selectWorldDir()
    if (path) await openWorld(path)
  }

  const fileName = state.levelDatPath
    ? state.levelDatPath.split('/').slice(-3).join('/')
    : null

  // "vanilla" is the standard singleplayer brand; anything else is worth flagging
  // since cubiomes predictions assume vanilla worldgen.
  const nonVanillaBrands = (state.seedData?.serverBrands ?? []).filter(b => b.toLowerCase() !== 'vanilla')
  const gameRuleEntries = Object.entries(state.seedData?.gameRules ?? {}).sort(([a], [b]) => a.localeCompare(b))

  // Per-world settings (unlimited cache + pre-generate) are inlined here rather than
  // behind a modal, since these are things you'd reach for right after opening a save.
  const worldDir = state.worldDir
  const edition  = state.seedData?.edition ?? 'java'

  const [wsSettings, setWsSettings] = useState<PerWorldSettings | null>(() => worldDir ? loadWorldSettings(worldDir) : null)
  useEffect(() => { setWsSettings(worldDir ? loadWorldSettings(worldDir) : null) }, [worldDir])

  const updateWsSettings = (patch: Partial<PerWorldSettings>) => {
    if (!worldDir) return
    setWsSettings(prev => {
      const base = prev ?? loadWorldSettings(worldDir)
      const next = { ...base, ...patch }
      saveWorldSettings(worldDir, next)
      if ('unlimitedCache' in patch) {
        dispatch({ type: 'SET_UNLIMITED_CACHE', enabled: patch.unlimitedCache! })
      }
      return next
    })
  }

  const updatePregen = (patch: Partial<WorldPregenSettings>) => {
    if (!worldDir) return
    setWsSettings(prev => {
      const base = prev ?? loadWorldSettings(worldDir)
      const next = { ...base, pregen: { ...base.pregen, ...patch } }
      saveWorldSettings(worldDir, next)
      return next
    })
  }

  const [regionCount, setRegionCount] = useState<number | null>(null)
  useEffect(() => {
    if (!worldDir) { setRegionCount(null); return }
    api.listRegions(worldDir, edition, 'overworld').then(r => setRegionCount(r.length)).catch(() => setRegionCount(0))
  }, [worldDir, edition])

  const estimatedTiles = (wsSettings && regionCount != null)
    ? estimatePregenTileCount(
        wsSettings.pregen.radiusBlocks,
        wsSettings.pregen.includeChunks,
        wsSettings.pregen.includeBiomes,
        regionCount,
      )
    : null

  const [pregenSectionOpen, setPregenSectionOpen] = useState(false)
  const [exportSectionOpen, setExportSectionOpen] = useState(false)

  const [pregenProgress, setPregenProgress] = useState<PregenProgress | null>(null)
  const pregenAbortRef = useRef<AbortController | null>(null)
  const pregenRunning = pregenProgress != null && pregenProgress.phase !== 'done' && pregenProgress.phase !== 'cancelled'

  const handlePregenStart = async () => {
    if (!worldDir || !wsSettings || !state.seedData || generatorSlot == null) return
    pregenAbortRef.current = new AbortController()
    const { seed, spawnX, spawnZ } = state.seedData
    await pregenTiles(
      {
        worldDir,
        edition,
        seed: BigInt(seed),
        mcVersion: MC_VERSIONS[state.selectedVersion],
        worldFlags: state.worldType === 'large_biomes' ? 1 : 0,
        generatorSlot,
        dimension: state.dimension,
        includeChunks: wsSettings.pregen.includeChunks,
        includeBiomes: wsSettings.pregen.includeBiomes,
        radiusBlocks: wsSettings.pregen.radiusBlocks,
        spawnX,
        spawnZ,
        hideWater: state.hideWater,
      },
      setPregenProgress,
      pregenAbortRef.current.signal,
    )
    setWsSettings(prev => {
      if (pregenAbortRef.current?.signal.aborted || !prev) return prev
      const next = { ...prev, pregenCompletedAt: Date.now() }
      saveWorldSettings(worldDir, next)
      return next
    })
  }

  const handlePregenCancel = () => { pregenAbortRef.current?.abort() }

  useEffect(() => () => { pregenAbortRef.current?.abort() }, [])

  const pregenCompletedStr = wsSettings?.pregenCompletedAt
    ? new Date(wsSettings.pregenCompletedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  const pregenPct = pregenProgress && pregenProgress.total > 0
    ? Math.round(pregenProgress.done / pregenProgress.total * 100)
    : 0

  const dimension = state.dimension
  const exportSeed = state.seedData?.seed != null ? BigInt(state.seedData.seed) : null
  const mcVersion = MC_VERSIONS[state.selectedVersion]
  const worldFlags = state.worldType === 'large_biomes' ? 1 : 0

  const [exportResolution, setExportResolution] = useState<Resolution>(1)
  const [exportRegions, setExportRegions] = useState<[number, number][] | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportDoneBiome, setExportDoneBiome] = useState(0)
  const [exportDoneChunk, setExportDoneChunk] = useState(0)
  const [exportTotal, setExportTotal] = useState(0)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportFinished, setExportFinished] = useState(false)
  const exportUnlistenRef = useRef<(() => void)[]>([])

  useEffect(() => {
    if (!worldDir) { setExportRegions(null); return }
    api.listRegions(worldDir, edition, dimension).then(r => setExportRegions(r)).catch(() => setExportRegions([]))
  }, [worldDir, edition, dimension])

  useEffect(() => () => { exportUnlistenRef.current.forEach(fn => fn()) }, [])

  const exportEstimate = useCallback(() => {
    if (exportRegions == null || exportRegions.length === 0) return null
    const rxs = exportRegions.map(([rx]) => rx)
    const rzs = exportRegions.map(([, rz]) => rz)
    const w = (Math.max(...rxs) - Math.min(...rxs) + 3) * Math.round(512 / exportResolution)
    const h = (Math.max(...rzs) - Math.min(...rzs) + 3) * Math.round(512 / exportResolution)
    const mb = Math.round(w * h * 4 / 1024 / 1024)
    return { w, h, mb }
  }, [exportRegions, exportResolution])

  const handleExport = useCallback(async () => {
    if (!worldDir || exportSeed == null) return
    setExportError(null)

    const name = worldDir.replace(/\\/g, '/').split('/').pop() ?? 'map'
    const ts = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-')
    const outputPath = await api.selectExportPath(`${name}_${ts}.tiff`)
    if (!outputPath) return

    setExporting(true)
    setExportDoneBiome(0)
    setExportDoneChunk(0)
    setExportTotal(0)
    setExportFinished(false)

    exportUnlistenRef.current.forEach(fn => fn())
    exportUnlistenRef.current = [
      api.onExportProgress((b, c, t) => { setExportDoneBiome(b); setExportDoneChunk(c); setExportTotal(t) }),
      api.onExportDone(() => { setExportFinished(true); setExporting(false) }),
      api.onExportError(msg => { setExportError(msg); setExporting(false) }),
    ]

    api.exportWorldMap({
      worldDir,
      edition,
      dimension,
      outputPath,
      hideWater: state.hideWater,
      blocksPerPixel: exportResolution,
      seed: exportSeed,
      mcVersion,
      worldFlags,
    }).catch(err => {
      setExportError(typeof err === 'string' ? err : String(err))
      setExporting(false)
    })
  }, [worldDir, dimension, exportSeed, mcVersion, worldFlags, exportResolution, state.hideWater, edition])

  const handleExportCancel = useCallback(async () => {
    if (exporting) await api.cancelExport().catch(() => {})
  }, [exporting])

  const exportEst = exportEstimate()

  const [siteSectionOpen, setSiteSectionOpen] = useState(false)
  const [siteDimensions, setSiteDimensions] = useState<Set<string>>(new Set(SITE_EXPORT_DIMENSIONS))
  const [siteIncludeBiome, setSiteIncludeBiome] = useState(true)
  const [siteIncludeUnderground, setSiteIncludeUnderground] = useState(false)
  const [siteIncludeChunk, setSiteIncludeChunk] = useState(true)
  const [siteIncludeChunkHideWater, setSiteIncludeChunkHideWater] = useState(false)
  const [siteIncludeCave, setSiteIncludeCave] = useState(false)
  const [siteIncludeOreVeins, setSiteIncludeOreVeins] = useState(false)
  const [siteIncludeCarvers, setSiteIncludeCarvers] = useState(false)
  const [siteIncludeLocalDifficulty, setSiteIncludeLocalDifficulty] = useState(false)
  const [siteOutputDir, setSiteOutputDir] = useState<string | null>(
    () => localStorage.getItem('sojourner.siteOutputDir')
  )
  const [siteExporting, setSiteExporting] = useState(false)
  const [siteProgress, setSiteProgress] = useState<api.StaticExportProgress | null>(null)
  const [siteError, setSiteError] = useState<string | null>(null)
  const [siteFinished, setSiteFinished] = useState(false)
  const [siteModalOpen, setSiteModalOpen] = useState(false)
  const siteUnlistenRef = useRef<(() => void)[]>([])

  useEffect(() => () => { siteUnlistenRef.current.forEach(fn => fn()) }, [])

  const toggleSiteDimension = (dim: string) => {
    setSiteDimensions(prev => {
      const next = new Set(prev)
      if (next.has(dim)) next.delete(dim); else next.add(dim)
      return next
    })
  }

  const handleChooseSiteOutputDir = async () => {
    const dir = await api.selectExportDir(siteOutputDir)
    if (dir) {
      setSiteOutputDir(dir)
      localStorage.setItem('sojourner.siteOutputDir', dir)
    }
  }

  const handleSiteExport = useCallback(async () => {
    if (!worldDir || exportSeed == null || !siteOutputDir || !state.seedData) return
    setSiteError(null)
    setSiteExporting(true)
    setSiteProgress(null)
    setSiteFinished(false)

    siteUnlistenRef.current.forEach(fn => fn())
    siteUnlistenRef.current = [
      api.onStaticExportProgress(p => setSiteProgress(p)),
      api.onStaticExportDone(() => { setSiteFinished(true); setSiteExporting(false) }),
      api.onStaticExportError(msg => { setSiteError(msg); setSiteExporting(false) }),
    ]

    const sd = state.seedData
    api.exportStaticSite({
      worldDir, edition, outputDir: siteOutputDir,
      seed: exportSeed, mcVersion, worldFlags,
      levelName: sd.levelName, dataVersion: sd.dataVersion, versionName: sd.versionName,
      worldType: state.worldType, difficulty: sd.difficulty, worldTime: sd.worldTime ?? 0,
      borderCenterX: sd.borderCenterX, borderCenterZ: sd.borderCenterZ, borderSize: sd.borderSize,
      gameRules: sd.gameRules,
      dimensions: Array.from(siteDimensions),
      includeBiomeTiles: siteIncludeBiome,
      includeUndergroundTiles: siteIncludeUnderground,
      includeChunkTiles: siteIncludeChunk,
      includeChunkHideWaterTiles: siteIncludeChunkHideWater,
      // End has no cave mode (see caveZoomRange) — no point baking presets
      // for it even if it's among the exported dimensions.
      caveRangePresets: siteIncludeCave
        ? Object.fromEntries(
            Array.from(siteDimensions)
              .filter(d => d !== 'end')
              .map((d): [string, CaveRangePreset[]] => [d, defaultCaveRangePresets(d)])
          )
        : {},
      includeOreVeins: siteIncludeOreVeins,
      includeCarvers: siteIncludeCarvers,
      includeLocalDifficulty: siteIncludeLocalDifficulty,
      rollLootFor: [],
      defaultSettings: loadOverlaySession(),
      markerGroups: state.markerGroupDefs,
    }).catch(err => {
      setSiteError(typeof err === 'string' ? err : String(err))
      setSiteExporting(false)
    })
  }, [
    worldDir, edition, exportSeed, mcVersion, worldFlags, siteOutputDir, state.seedData, state.worldType,
    state.markerGroupDefs, siteDimensions, siteIncludeBiome, siteIncludeUnderground, siteIncludeChunk,
    siteIncludeChunkHideWater, siteIncludeCave, siteIncludeOreVeins,
    siteIncludeCarvers, siteIncludeLocalDifficulty,
  ])

  const handleSiteExportCancel = useCallback(async () => {
    if (siteExporting) await api.cancelStaticExport().catch(() => {})
    setSiteModalOpen(false)
  }, [siteExporting])

  const handleSiteExportOpen = useCallback(() => {
    setSiteFinished(false)
    setSiteError(null)
    setSiteModalOpen(true)
  }, [])

  const handleSiteExportConfirm = useCallback(() => {
    handleSiteExport()
  }, [handleSiteExport])

  const handleSiteExportModalClose = useCallback(() => {
    // Only reachable once the run is finished/errored (see the modal's own
    // gating) — nothing to cancel, just dismiss.
    setSiteModalOpen(false)
  }, [])

  // Static-site build: world management (open/browse/pregen/TIFF/website
  // export) all assume a real filesystem behind Tauri, which a static bundle
  // never has — swap the whole panel for a read-only summary of the exported
  // world instead of trying to selectively hide a dozen live-only controls.
  if (api.IS_STATIC_SITE) {
    const sd = state.seedData
    return (
      <div className="flyout-panel">
        <div className="flyout-header">
          <span className="flyout-title">World</span>
        </div>
        <div className="flyout-body">
          {sd ? (
            <div className="ws-section">
              <div className="export-field"><span className="export-label">Name</span><span className="export-value">{sd.levelName || '—'}</span></div>
              <div className="export-field"><span className="export-label">Seed</span><span className="export-value">{sd.seed}</span></div>
              <div className="export-field"><span className="export-label">Version</span><span className="export-value">{sd.versionName}</span></div>
              <div className="export-field"><span className="export-label">Edition</span><span className="export-value">{sd.edition}</span></div>
              <div className="export-field"><span className="export-label">World type</span><span className="export-value">{sd.worldType}</span></div>
              <p className="ws-hint">Static export — read-only. World management, pre-generation, and TIFF/website export aren't available here.</p>
            </div>
          ) : (
            <p className="ws-hint">Loading…</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
    <div className="flyout-panel">
      <div className="flyout-header">
        <span className="flyout-title">World</span>
      </div>

      <div className="flyout-body">
        {state.seedData ? (
          <>
            {savesWorlds && savesWorlds.length > 0 && (
              <div className="recent-worlds" style={{ marginBottom: 8 }}>
                <div className="recent-worlds-title">My Worlds</div>
                {(showAllSaves ? savesWorlds : savesWorlds.slice(0, 5))
                  .filter(w => w.levelDatPath !== state.levelDatPath)
                  .map(w => (
                    <div key={w.levelDatPath} className="recent-world-item saves-world-row" onClick={() => openWorld(w.levelDatPath)} title={w.levelDatPath}>
                      <span>{w.name}</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {w.edition === 'bedrock' && <span className="edition-badge edition-badge--bedrock">Bedrock</span>}
                        <span className="saves-world-row-time">{timeAgo(w.modifiedSecs)}</span>
                      </span>
                    </div>
                  ))}
                {savesWorlds.length > 5 && (
                  <div className="recent-worlds-more" onClick={() => setShowAllSaves(v => !v)}>
                    {showAllSaves ? 'show less' : `${savesWorlds.length - 5} more…`}
                  </div>
                )}
                <div className="recent-worlds-more" onClick={browseWorldFolder}>Browse…</div>
              </div>
            )}
            {(!savesWorlds || savesWorlds.length === 0) && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                <button className="btn-sm" onClick={browseWorldFolder}>Change world</button>
              </div>
            )}

            {fileName && (
              <div className="seed-path" title={state.levelDatPath ?? ''} style={{ marginBottom: 8 }}>
                <IconFolder className="icon-inline" /> {fileName}
              </div>
            )}

            {nonVanillaBrands.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <span className="server-brand-badge"
                  title={`Server brand${nonVanillaBrands.length > 1 ? 's' : ''}: ${nonVanillaBrands.join(', ')} — cubiomes predictions assume vanilla worldgen and may not match a modded server`}>
                  ⚠ {nonVanillaBrands.join(', ')}
                </span>
              </div>
            )}

            {gameRuleEntries.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div className="game-rules-toggle" onClick={() => setShowGameRules(v => !v)}>
                  {showGameRules ? 'Hide game rules' : `Game rules (${gameRuleEntries.length})…`}
                </div>
                {showGameRules && (
                  <div className="game-rules-list">
                    {gameRuleEntries.map(([rule, value]) => (
                      <div key={rule} className="game-rules-row">
                        <span className="game-rules-name">{rule}</span>
                        <span className="game-rules-value">{value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {worldDir && wsSettings && (
              <div style={{ marginBottom: 8, border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
                <div className="ws-section">
                  <label className="ws-toggle-row">
                    <span className="ws-label">Unlimited cache</span>
                    <input
                      type="checkbox"
                      className="ws-checkbox"
                      checked={wsSettings.unlimitedCache}
                      onChange={e => updateWsSettings({ unlimitedCache: e.target.checked })}
                    />
                  </label>
                  <p className="ws-hint">
                    When enabled, tile caches are never evicted and the disk PNG cache is
                    preserved across world reloads. Combine with Pre-generate for instant
                    pan and zoom everywhere.
                  </p>
                </div>

                <div className="ws-section">
                  <div className="ws-section-title ws-section-title--clickable"
                    onClick={() => setPregenSectionOpen(v => !v)}>
                    <span>{pregenSectionOpen ? '▾' : '▸'} Pre-generate tiles</span>
                    {!pregenSectionOpen && pregenRunning && <span className="ws-section-title-hint">running…</span>}
                    {!pregenSectionOpen && pregenCompletedStr && !pregenRunning && (
                      <span className="ws-section-title-hint">last run {pregenCompletedStr}</span>
                    )}
                  </div>

                  {pregenSectionOpen && (
                  <>
                  {pregenCompletedStr && !pregenRunning && (
                    <div className="ws-completed-badge">Last run: {pregenCompletedStr}</div>
                  )}

                  <div className="ws-field-row">
                    <span className="ws-field-label">Biome radius</span>
                    <div className="ws-radius-input-row">
                      <input
                        type="number"
                        className="ws-number-input"
                        value={wsSettings.pregen.radiusBlocks}
                        min={1000}
                        max={MAX_PREGEN_RADIUS}
                        step={1000}
                        disabled={pregenRunning}
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
                        checked={wsSettings.pregen.includeChunks}
                        disabled={pregenRunning}
                        onChange={e => updatePregen({ includeChunks: e.target.checked })}
                      />
                      Chunk tiles (all loaded regions, zoom 3–4)
                    </label>
                  </div>
                  <div className="ws-check-row">
                    <label className="ws-check-label">
                      <input
                        type="checkbox"
                        checked={wsSettings.pregen.includeBiomes}
                        disabled={pregenRunning}
                        onChange={e => updatePregen({ includeBiomes: e.target.checked })}
                      />
                      Biome tiles (spawn ± radius, zoom 0–1)
                    </label>
                  </div>

                  {estimatedTiles != null && !pregenRunning && pregenProgress == null && (
                    <div className="ws-estimate">~{estimatedTiles.toLocaleString()} tiles</div>
                  )}

                  {pregenProgress != null && (
                    <div className="ws-progress-wrap">
                      <div className="ws-progress-bar">
                        <div
                          className={`ws-progress-fill ws-progress-fill--${pregenProgress.phase}`}
                          style={{ width: `${pregenPct}%` }}
                        />
                      </div>
                      <div className="ws-progress-label">
                        {pregenProgress.phase === 'done' && `Done — ${pregenProgress.total.toLocaleString()} tiles rendered`}
                        {pregenProgress.phase === 'cancelled' && `Cancelled — ${pregenProgress.done.toLocaleString()} / ${pregenProgress.total.toLocaleString()} tiles`}
                        {(pregenProgress.phase === 'biomes' || pregenProgress.phase === 'chunks') &&
                          `${pregenProgress.phase === 'biomes' ? 'Biomes' : 'Chunks'} — ${pregenProgress.done.toLocaleString()} / ${pregenProgress.total.toLocaleString()} (${pregenPct}%)`}
                      </div>
                    </div>
                  )}

                  <div className="ws-btn-row">
                    {!pregenRunning ? (
                      <button
                        className="btn-sm"
                        onClick={handlePregenStart}
                        disabled={generatorSlot == null || !state.seedData || (!wsSettings.pregen.includeChunks && !wsSettings.pregen.includeBiomes)}
                      >
                        {pregenProgress?.phase === 'done' ? 'Re-generate' : pregenProgress?.phase === 'cancelled' ? 'Retry' : 'Start'}
                      </button>
                    ) : (
                      <button className="btn-sm f3-btn-danger" onClick={handlePregenCancel}>Cancel</button>
                    )}
                  </div>
                  </>
                  )}
                </div>

                <div className="ws-section">
                  <div className="ws-section-title ws-section-title--clickable"
                    onClick={() => setExportSectionOpen(v => !v)}>
                    <span>{exportSectionOpen ? '▾' : '▸'} Export map as TIFF</span>
                    {!exportSectionOpen && exporting && <span className="ws-section-title-hint">exporting…</span>}
                    {!exportSectionOpen && exportFinished && !exporting && (
                      <span className="ws-section-title-hint">done</span>
                    )}
                  </div>

                  {exportSectionOpen && (
                  <>
                  <div className="export-field">
                    <span className="export-label">Dimension</span>
                    <span className="export-value">{dimension}</span>
                  </div>

                  <div className="export-field">
                    <span className="export-label">Regions found</span>
                    <span className="export-value">
                      {exportRegions == null ? '…' : `${exportRegions.length} region${exportRegions.length !== 1 ? 's' : ''}`}
                    </span>
                  </div>

                  <div className="export-field export-field--col">
                    <span className="export-label">Resolution</span>
                    <div className="export-radio-group">
                      {([1, 2, 4] as Resolution[]).map(r => (
                        <label key={r} className={`export-radio${exportResolution === r ? ' active' : ''}`}>
                          <input
                            type="radio"
                            name="export-resolution"
                            value={r}
                            checked={exportResolution === r}
                            onChange={() => setExportResolution(r)}
                            disabled={exporting}
                          />
                          {r === 1 ? '1px / block (full detail)' : `1px / ${r} blocks`}
                        </label>
                      ))}
                    </div>
                  </div>

                  {exportEst && (
                    <div className="export-estimate">
                      ~{exportEst.w.toLocaleString()}×{exportEst.h.toLocaleString()} px &nbsp;·&nbsp; ~{exportEst.mb.toLocaleString()} MB TIFF
                    </div>
                  )}

                  {exportError && <div className="export-error">{exportError}</div>}

                  {exporting && (
                    <div className="export-progress-wrap">
                      <div className="export-progress-bar">
                        <div className="export-progress-fill export-progress-fill--biome"
                          style={{ width: exportTotal > 0 ? `${exportDoneBiome / exportTotal * 100}%` : '0%' }}
                          title={`Biome fill: ${exportDoneBiome} regions`} />
                        <div className="export-progress-fill export-progress-fill--chunk"
                          style={{ width: exportTotal > 0 ? `${exportDoneChunk / exportTotal * 100}%` : '0%' }}
                          title={`Chunk data: ${exportDoneChunk} regions`} />
                      </div>
                      <span className="export-progress-label">
                        {exportTotal > 0 ? `${exportDoneBiome + exportDoneChunk} / ${exportTotal} regions` : 'Starting…'}
                      </span>
                    </div>
                  )}

                  {exportFinished && !exporting && (
                    <div className="export-done">Export complete.</div>
                  )}

                  <div className="ws-btn-row">
                    {!exporting && (
                      <button className="btn-sm" onClick={handleExport} disabled={exportRegions?.length === 0}>
                        Choose file & export…
                      </button>
                    )}
                    {exporting && (
                      <button className="btn-sm f3-btn-danger" onClick={handleExportCancel}>Cancel</button>
                    )}
                  </div>
                  </>
                  )}
                </div>

                <div className="ws-section">
                  <div className="ws-section-title ws-section-title--clickable"
                    onClick={() => setSiteSectionOpen(v => !v)}>
                    <span>{siteSectionOpen ? '▾' : '▸'} Export as website</span>
                    {!siteSectionOpen && siteExporting && <span className="ws-section-title-hint">exporting…</span>}
                    {!siteSectionOpen && siteFinished && !siteExporting && (
                      <span className="ws-section-title-hint">done</span>
                    )}
                  </div>

                  {siteSectionOpen && (
                  <>
                  <p className="ws-hint">
                    Bakes a self-contained folder of tiles + data that runs in any
                    browser with no Sojourner backend — every zoom, for the dimensions
                    and layers picked below. Can be slow for a large explored area.
                  </p>

                  <div className="export-field export-field--col">
                    <span className="export-label">Dimensions</span>
                    <div className="ws-check-row">
                      {SITE_EXPORT_DIMENSIONS.map(dim => (
                        <label key={dim} className="ws-check-label" style={{ marginRight: 12 }}>
                          <input
                            type="checkbox"
                            checked={siteDimensions.has(dim)}
                            disabled={siteExporting}
                            onChange={() => toggleSiteDimension(dim)}
                          />
                          {dim}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="export-field export-field--col">
                    <span className="export-label">Layers</span>
                    <div className="ws-check-row">
                      <label className="ws-check-label">
                        <input type="checkbox" checked={siteIncludeBiome} disabled={siteExporting}
                          onChange={e => setSiteIncludeBiome(e.target.checked)} />
                        Biome tiles
                      </label>
                    </div>
                    <div className="ws-check-row">
                      <label className="ws-check-label">
                        <input type="checkbox" checked={siteIncludeUnderground} disabled={siteExporting}
                          onChange={e => setSiteIncludeUnderground(e.target.checked)} />
                        Underground biome tiles (overworld only)
                      </label>
                    </div>
                    <div className="ws-check-row">
                      <label className="ws-check-label">
                        <input type="checkbox" checked={siteIncludeChunk} disabled={siteExporting}
                          onChange={e => setSiteIncludeChunk(e.target.checked)} />
                        Real block-color tiles
                      </label>
                    </div>
                    <div className="ws-check-row">
                      <label className="ws-check-label">
                        <input type="checkbox" checked={siteIncludeChunkHideWater} disabled={siteExporting}
                          onChange={e => setSiteIncludeChunkHideWater(e.target.checked)} />
                        Block-color tiles (water hidden)
                      </label>
                    </div>
                    <div className="ws-check-row">
                      <label className="ws-check-label">
                        <input type="checkbox" checked={siteIncludeCave} disabled={siteExporting}
                          onChange={e => setSiteIncludeCave(e.target.checked)} />
                        Cave-mode tiles ({DEFAULT_CAVE_RANGE_PRESETS_OVERWORLD.length} presets/dimension)
                      </label>
                    </div>
                    <div className="ws-check-row">
                      <label className="ws-check-label">
                        <input type="checkbox" checked={siteIncludeOreVeins} disabled={siteExporting}
                          onChange={e => setSiteIncludeOreVeins(e.target.checked)} />
                        Ore veins (overworld only)
                      </label>
                    </div>
                    <div className="ws-check-row">
                      <label className="ws-check-label">
                        <input type="checkbox" checked={siteIncludeCarvers} disabled={siteExporting}
                          onChange={e => setSiteIncludeCarvers(e.target.checked)} />
                        Carvers
                      </label>
                    </div>
                    <div className="ws-check-row">
                      <label className="ws-check-label">
                        <input type="checkbox" checked={siteIncludeLocalDifficulty} disabled={siteExporting}
                          onChange={e => setSiteIncludeLocalDifficulty(e.target.checked)} />
                        Local difficulty (java worlds only)
                      </label>
                    </div>
                  </div>

                  <p className="ws-hint">
                    Always included, regardless of the layers picked above: structures,
                    block entities, entities, POI, custom marker groups, the spawn
                    marker, and (End) gateway links.
                  </p>

                  <div className="export-field export-field--col">
                    <span className="export-label">Output folder</span>
                    <span className="export-value">
                      {siteOutputDir ?? 'not chosen'}
                    </span>
                  </div>

                  <div className="ws-btn-row">
                    <button className="btn-sm" onClick={handleChooseSiteOutputDir} disabled={siteExporting}>
                      Choose folder…
                    </button>
                    <button className="btn-sm" onClick={handleSiteExportOpen}
                      disabled={!siteOutputDir || siteDimensions.size === 0}>
                      Export
                    </button>
                  </div>
                  </>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            {savesWorlds && savesWorlds.length > 0 ? (
              <div className="recent-worlds" style={{ marginBottom: 8 }}>
                <div className="recent-worlds-title">My Worlds</div>
                {(showAllSaves ? savesWorlds : savesWorlds.slice(0, 5)).map(w => (
                  <div key={w.levelDatPath} className="recent-world-item saves-world-row" onClick={() => openWorld(w.levelDatPath)} title={w.levelDatPath}>
                    <span>{w.name}</span>
                    <span className="saves-world-row-time">{timeAgo(w.modifiedSecs)}</span>
                  </div>
                ))}
                {savesWorlds.length > 5 && (
                  <div className="recent-worlds-more" onClick={() => setShowAllSaves(v => !v)}>
                    {showAllSaves ? 'show less' : `${savesWorlds.length - 5} more…`}
                  </div>
                )}
                <div className="recent-worlds-more" onClick={browseWorldFolder}>Browse…</div>
              </div>
            ) : (
              <button className="btn-primary" onClick={browseWorldFolder} style={{ width: '100%', marginBottom: 10 }}>
                Open world folder
              </button>
            )}
          </>
        )}
      </div>
    </div>

    {siteModalOpen && (
      <div className="site-export-modal-backdrop" role="dialog" aria-modal="true" aria-label="Export as website">
        <div className="site-export-modal">
          {!siteExporting && !siteFinished && !siteError && (
            <>
              <h3>Export this world to a website?</h3>
              <p className="site-export-modal-summary">
                {Array.from(siteDimensions).join(', ') || 'no dimensions'} &middot; output to{' '}
                <span>{siteOutputDir}</span>
              </p>
              <p className="ws-hint">
                This is an atomic, potentially long-running operation — closing this
                dialog while it's running cancels it. The app stays responsive but
                slower while it works in the background.
              </p>
              <div className="ws-btn-row">
                <button className="btn-sm" onClick={() => setSiteModalOpen(false)}>Cancel</button>
                <button className="btn-sm btn-primary" onClick={handleSiteExportConfirm}>Do it</button>
              </div>
            </>
          )}

          {siteExporting && (
            <>
              <h3>Exporting…</h3>
              <div className="export-progress-wrap">
                <div className="export-progress-bar">
                  <div className="export-progress-fill export-progress-fill--biome"
                    style={{
                      width: siteProgress && siteProgress.total > 0
                        ? `${Math.min(100, siteProgress.done / siteProgress.total * 100)}%` : '0%',
                    }} />
                </div>
                <span className="export-progress-label">
                  {siteProgress
                    ? `${siteProgress.stage}${siteProgress.dimension ? ` — ${siteProgress.dimension}` : ''}` +
                      (siteProgress.total > 0 ? ` (${siteProgress.done} / ${siteProgress.total})` : siteProgress.done ? ` (${siteProgress.done})` : '')
                    : 'Starting…'}
                </span>
              </div>
              <div className="ws-btn-row">
                <button className="btn-sm f3-btn-danger" onClick={handleSiteExportCancel}>Cancel</button>
              </div>
            </>
          )}

          {siteError && !siteExporting && (
            <>
              <h3>Export failed</h3>
              <div className="export-error">{siteError}</div>
              <div className="ws-btn-row">
                <button className="btn-sm" onClick={handleSiteExportModalClose}>Close</button>
              </div>
            </>
          )}

          {siteFinished && !siteExporting && !siteError && (
            <>
              <h3>Export complete</h3>
              <div className="export-done">{siteOutputDir}</div>
              <div className="ws-btn-row">
                <button className="btn-sm" onClick={handleSiteExportModalClose}>Close</button>
              </div>
            </>
          )}
        </div>
      </div>
    )}
    </>
  )
}
