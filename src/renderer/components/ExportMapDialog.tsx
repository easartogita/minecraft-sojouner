import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../App'
import * as api from '../lib/tauriAPI'
import { MC_VERSIONS } from '../lib/constants'

type Resolution = 1 | 2 | 4

export default function ExportMapDialog({ onClose }: { onClose: () => void }) {
  const { state } = useApp()
  const [resolution, setResolution] = useState<Resolution>(1)
  const [regions, setRegions] = useState<[number, number][] | null>(null)
  const [exporting, setExporting] = useState(false)
  const [doneBiome, setDoneBiome] = useState(0)
  const [doneChunk, setDoneChunk] = useState(0)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [finished, setFinished] = useState(false)
  const unlistenRef = useRef<(() => void)[]>([])

  const worldDir  = state.worldDir
  const dimension = state.dimension
  const seed      = state.seedData?.seed != null ? BigInt(state.seedData.seed) : null
  const mcVersion = MC_VERSIONS[state.selectedVersion]
  const worldFlags = state.worldType === 'large_biomes' ? 1 : 0

  const edition = state.seedData?.edition ?? 'java'

  // Preflight: count regions
  useEffect(() => {
    if (!worldDir) return
    api.listRegions(worldDir, edition, dimension).then(r => setRegions(r)).catch(() => setRegions([]))
  }, [worldDir, edition, dimension])

  // Cleanup listeners on unmount
  useEffect(() => () => { unlistenRef.current.forEach(fn => fn()) }, [])

  const estimateSize = useCallback(() => {
    if (regions == null || regions.length === 0) return null
    const rxs = regions.map(([rx]) => rx)
    const rzs = regions.map(([, rz]) => rz)
    const w = (Math.max(...rxs) - Math.min(...rxs) + 3) * Math.round(512 / resolution)
    const h = (Math.max(...rzs) - Math.min(...rzs) + 3) * Math.round(512 / resolution)
    const mb = Math.round(w * h * 4 / 1024 / 1024)
    return { w, h, mb }
  }, [regions, resolution])

  const handleExport = useCallback(async () => {
    if (!worldDir || seed == null) return
    setError(null)

    const worldName = worldDir.replace(/\\/g, '/').split('/').pop() ?? 'map'
    const ts = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-')
    const outputPath = await api.selectExportPath(`${worldName}_${ts}.tiff`)
    if (!outputPath) return

    setExporting(true)
    setDoneBiome(0)
    setDoneChunk(0)
    setTotal(0)
    setFinished(false)

    // Wire up event listeners
    unlistenRef.current.forEach(fn => fn())
    unlistenRef.current = [
      api.onExportProgress((b, c, t) => { setDoneBiome(b); setDoneChunk(c); setTotal(t) }),
      api.onExportDone(() => { setFinished(true); setExporting(false) }),
      api.onExportError(msg => { setError(msg); setExporting(false) }),
    ]

    api.exportWorldMap({
      worldDir,
      edition,
      dimension,
      outputPath,
      hideWater: state.hideWater,
      blocksPerPixel: resolution,
      seed,
      mcVersion,
      worldFlags,
    }).catch(err => {
      setError(typeof err === 'string' ? err : String(err))
      setExporting(false)
    })
  }, [worldDir, dimension, seed, mcVersion, worldFlags, resolution, state.hideWater])

  const handleCancel = useCallback(async () => {
    if (exporting) {
      await api.cancelExport().catch(() => {})
    } else {
      onClose()
    }
  }, [exporting, onClose])

  const est = estimateSize()

  return (
    <div className="export-backdrop" onClick={e => { if (e.target === e.currentTarget && !exporting) onClose() }}>
      <div className="export-dialog">
        <div className="export-header">
          <span className="export-title">Export Map as TIFF</span>
          {!exporting && (
            <button className="export-close-btn" onClick={onClose} title="Close">✕</button>
          )}
        </div>

        <div className="export-body">
          {!worldDir ? (
            <p className="export-note">Open a world first to export its map.</p>
          ) : (
            <>
              <div className="export-field">
                <span className="export-label">Dimension</span>
                <span className="export-value">{dimension}</span>
              </div>

              <div className="export-field">
                <span className="export-label">Regions found</span>
                <span className="export-value">
                  {regions == null ? '…' : `${regions.length} region${regions.length !== 1 ? 's' : ''}`}
                </span>
              </div>

              <div className="export-field export-field--col">
                <span className="export-label">Resolution</span>
                <div className="export-radio-group">
                  {([1, 2, 4] as Resolution[]).map(r => (
                    <label key={r} className={`export-radio${resolution === r ? ' active' : ''}`}>
                      <input
                        type="radio"
                        name="resolution"
                        value={r}
                        checked={resolution === r}
                        onChange={() => setResolution(r)}
                        disabled={exporting}
                      />
                      {r === 1 ? '1px / block (full detail)' : `1px / ${r} blocks`}
                    </label>
                  ))}
                </div>
              </div>

              {est && (
                <div className="export-estimate">
                  ~{est.w.toLocaleString()}×{est.h.toLocaleString()} px &nbsp;·&nbsp; ~{est.mb.toLocaleString()} MB TIFF
                </div>
              )}

              {error && <div className="export-error">{error}</div>}

              {exporting && (
                <div className="export-progress-wrap">
                  <div className="export-progress-bar">
                    <div className="export-progress-fill export-progress-fill--biome"
                      style={{ width: total > 0 ? `${doneBiome / total * 100}%` : '0%' }}
                      title={`Biome fill: ${doneBiome} regions`} />
                    <div className="export-progress-fill export-progress-fill--chunk"
                      style={{ width: total > 0 ? `${doneChunk / total * 100}%` : '0%' }}
                      title={`Chunk data: ${doneChunk} regions`} />
                  </div>
                  <span className="export-progress-label">
                    {total > 0 ? `${doneBiome + doneChunk} / ${total} regions` : 'Starting…'}
                  </span>
                </div>
              )}

              {finished && !exporting && (
                <div className="export-done">Export complete.</div>
              )}
            </>
          )}
        </div>

        <div className="export-footer">
          {!exporting && !finished && worldDir && (
            <button className="export-btn-primary" onClick={handleExport} disabled={regions?.length === 0}>
              Choose file & export…
            </button>
          )}
          <button
            className="export-btn-secondary"
            onClick={handleCancel}
          >
            {exporting ? 'Cancel' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  )
}
