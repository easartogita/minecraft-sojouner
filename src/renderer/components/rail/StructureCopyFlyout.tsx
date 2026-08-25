import { useState, useEffect } from 'react'
import { useApp } from '../../App'
import * as api from '../../lib/tauriAPI'
import type { CopyRegionsReport, CopyChunksReport, CopyBlocksReport, SavedTemplateInfo } from '../../lib/tauriAPI.types'

// "Custom Structures": region mode copies a whole .mca file at identical coordinates;
// chunk mode relocates at chunk granularity via structure_copy.rs's Anvil writer, with an
// optional section-aligned Y-trim that merges into (and requires) an existing destination
// chunk; box mode copies an arbitrary axis-aligned block box with Y/X/Z rotation and full
// blockstate property rotation, and overwrites the destination fully including air (not
// WorldEdit's air-transparent blend).
//
// Selection happens by clicking directly on the map (MapView.tsx's
// TOGGLE_STRUCTURE_COPY_REGION/_CHUNK, box-mode anchor clicks, StructureCopySelectionLayer)
// rather than a scrollable list — Chunk Data's forced outline/grid view is the visual
// affordance for "this is what's clickable." Y range and destination Y need manual entry
// since the map is 2D.
export default function StructureCopyFlyout() {
  const { state, dispatch } = useApp()

  // Forces the map's Chunk Data layer into region-outline or chunk-grid mode (depending
  // on structureCopyMode) for as long as this panel is mounted.
  useEffect(() => {
    dispatch({ type: 'SET_STRUCTURE_COPY_PANEL_OPEN', open: true })
    return () => {
      dispatch({ type: 'SET_STRUCTURE_COPY_PANEL_OPEN', open: false })
      dispatch({ type: 'SET_STRUCTURE_COPY_SELECTED_REGIONS', regions: [] })
      dispatch({ type: 'SET_STRUCTURE_COPY_SELECTED_CHUNKS', chunks: [] })
      dispatch({ type: 'SET_STRUCTURE_COPY_PLACING_DEST', placing: false })
      dispatch({ type: 'SET_STRUCTURE_COPY_DEST_CHUNK', dest: null })
      dispatch({ type: 'SET_STRUCTURE_COPY_BOX_ANCHOR', anchor: null })
      dispatch({ type: 'SET_STRUCTURE_COPY_BOX_SELECTION', selection: null })
      dispatch({ type: 'SET_STRUCTURE_COPY_PLACING_BOX_DEST', placing: false })
      dispatch({ type: 'SET_STRUCTURE_COPY_BOX_DEST', dest: null })
      dispatch({ type: 'SET_STRUCTURE_COPY_ROTATION', rotation: 0 })
      dispatch({ type: 'SET_STRUCTURE_COPY_MIRROR', mirror: null })
    }
  }, [dispatch])

  const [savesWorlds, setSavesWorlds] = useState<api.SavesWorldEntry[] | null>(null)
  useEffect(() => {
    api.listSavesWorlds().then(setSavesWorlds).catch(() => setSavesWorlds([]))
  }, [])

  const [dstLevelDatPath, setDstLevelDatPath] = useState<string>('')
  const [destXInput, setDestXInput] = useState('')
  const [destZInput, setDestZInput] = useState('')

  // Optional Y-range trim, chunk mode only — section-aligned server-side (rounds
  // outward to whole 16-block sections).
  const [yTrimEnabled, setYTrimEnabled] = useState(false)
  const [yMinInput, setYMinInput] = useState('')
  const [yMaxInput, setYMaxInput] = useState('')
  const yMinParsed = parseInt(yMinInput, 10)
  const yMaxParsed = parseInt(yMaxInput, 10)
  const yTrimValid = !yTrimEnabled || (!Number.isNaN(yMinParsed) && !Number.isNaN(yMaxParsed))

  // Box mode's Y range (can't be picked from the 2D map) and destination X/Y/Z — local,
  // only ever read by this component to build the copyBlocks call.
  const [boxYMinInput, setBoxYMinInput] = useState('')
  const [boxYMaxInput, setBoxYMaxInput] = useState('')
  const boxYMinParsed = parseInt(boxYMinInput, 10)
  const boxYMaxParsed = parseInt(boxYMaxInput, 10)
  const boxYRangeValid = !Number.isNaN(boxYMinParsed) && !Number.isNaN(boxYMaxParsed)
  const [boxDestXInput, setBoxDestXInput] = useState('')
  const [boxDestYInput, setBoxDestYInput] = useState('')
  const [boxDestZInput, setBoxDestZInput] = useState('')
  // Manual X/Z corner entry for the source box itself — click-to-select is
  // fine for eyeballing but useless for reproducing exact known coordinates
  // (e.g. copied off an F3 screen or noted down earlier).
  const [boxX0Input, setBoxX0Input] = useState('')
  const [boxX1Input, setBoxX1Input] = useState('')
  const [boxZ0Input, setBoxZ0Input] = useState('')
  const [boxZ1Input, setBoxZ1Input] = useState('')

  // A loaded template file as the paste source instead of a map-drawn box — mutually
  // exclusive with boxSelection. templateInfo is just for the "X×Y×Z, N blocks" summary;
  // the block data stays server-side until paste time.
  const [loadedTemplatePath, setLoadedTemplatePath] = useState<string | null>(null)
  const [templateInfo, setTemplateInfo] = useState<SavedTemplateInfo | null>(null)
  const [templateBusy, setTemplateBusy] = useState(false)
  const [templateError, setTemplateError] = useState<string | null>(null)

  const srcWorldDir = state.worldDir
  const srcEdition  = state.seedData?.edition ?? 'java'
  const dimension   = state.dimension
  const mode        = state.structureCopyMode
  const regions     = state.structureCopySelectedRegions
  const chunks      = state.structureCopySelectedChunks
  const placingDest = state.structureCopyPlacingDest
  const destChunk   = state.structureCopyDestChunk
  const boxAnchor    = state.structureCopyBoxAnchor
  const boxSelection = state.structureCopyBoxSelection
  const placingBoxDest = state.structureCopyPlacingBoxDest
  const boxDest       = state.structureCopyBoxDest
  const rotation       = state.structureCopyRotation
  const mirror         = state.structureCopyMirror

  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<CopyRegionsReport | CopyChunksReport | CopyBlocksReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Same-world is a valid destination (e.g. copying between dimensions of the
  // same world, or relocating within one world). A same-world + same-dimension
  // + unshifted copy is a harmless no-op (re-copies identical bytes onto
  // themselves); not worth blocking, just flagged below.
  const destinations = (savesWorlds ?? [])
    .filter(w => w.edition === 'java')
    .map(w => w.levelDatPath === state.levelDatPath ? { ...w, name: `${w.name} (this world)` } : w)

  const isSameWorld = dstLevelDatPath === state.levelDatPath

  const setMode = (m: 'region' | 'chunk' | 'box') => {
    dispatch({ type: 'SET_STRUCTURE_COPY_MODE', mode: m })
    setReport(null)
    setError(null)
  }

  const clearSelection = () => {
    if (mode === 'region') dispatch({ type: 'SET_STRUCTURE_COPY_SELECTED_REGIONS', regions: [] })
    else if (mode === 'chunk') dispatch({ type: 'SET_STRUCTURE_COPY_SELECTED_CHUNKS', chunks: [] })
    else {
      dispatch({ type: 'SET_STRUCTURE_COPY_BOX_ANCHOR', anchor: null })
      dispatch({ type: 'SET_STRUCTURE_COPY_BOX_SELECTION', selection: null })
      setLoadedTemplatePath(null)
      setTemplateInfo(null)
      setTemplateError(null)
    }
  }

  const saveTemplate = async () => {
    if (!state.levelDatPath || !boxSelection || !boxYRangeValid) return
    setTemplateError(null)
    const outPath = await api.selectTemplateSavePath('structure.nbt')
    if (!outPath) return
    setTemplateBusy(true)
    try {
      const info = await api.saveStructureTemplate(
        state.levelDatPath, dimension,
        [boxSelection.x0, boxYMinParsed, boxSelection.z0, boxSelection.x1, boxYMaxParsed, boxSelection.z1],
        outPath,
      )
      setError(null)
      // Reuse the report area to confirm success — a save has no
      // destination-side report of its own to show.
      setTemplateInfo(info)
    } catch (err) {
      setTemplateError(String(err))
    } finally {
      setTemplateBusy(false)
    }
  }

  const loadTemplate = async () => {
    const path = await api.selectTemplateFile()
    if (!path) return
    // Loading a template replaces a map-drawn box as this run's source —
    // the two are mutually exclusive (only one source feeds one paste).
    dispatch({ type: 'SET_STRUCTURE_COPY_BOX_ANCHOR', anchor: null })
    dispatch({ type: 'SET_STRUCTURE_COPY_BOX_SELECTION', selection: null })
    setLoadedTemplatePath(path)
    setTemplateInfo(null)
    setTemplateError(null)
  }

  const placeDestManually = () => {
    const x = parseInt(destXInput, 10)
    const z = parseInt(destZInput, 10)
    if (Number.isNaN(x) || Number.isNaN(z)) return
    dispatch({ type: 'SET_STRUCTURE_COPY_DEST_CHUNK', dest: [x >> 4, z >> 4] })
  }

  const setBoxSelectionManually = () => {
    const x0 = parseInt(boxX0Input, 10)
    const x1 = parseInt(boxX1Input, 10)
    const z0 = parseInt(boxZ0Input, 10)
    const z1 = parseInt(boxZ1Input, 10)
    if ([x0, x1, z0, z1].some(Number.isNaN)) return
    dispatch({
      type: 'SET_STRUCTURE_COPY_BOX_SELECTION',
      selection: { x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1) },
    })
  }

  // Y defaults to the source box's own Y min when left blank — "same height
  // as source" is the common case, only type something else to relocate
  // vertically.
  const placeBoxDestManually = () => {
    const x = parseInt(boxDestXInput, 10)
    const z = parseInt(boxDestZInput, 10)
    const yTyped = parseInt(boxDestYInput, 10)
    const y = Number.isNaN(yTyped) ? (boxYRangeValid ? Math.min(boxYMinParsed, boxYMaxParsed) : NaN) : yTyped
    if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) return
    dispatch({ type: 'SET_STRUCTURE_COPY_BOX_DEST', dest: { x, y, z } })
  }

  const runCopy = async () => {
    if (!state.levelDatPath || !dstLevelDatPath) return
    setBusy(true)
    setError(null)
    setReport(null)
    try {
      if (mode === 'region') {
        if (regions.length === 0) return
        setReport(await api.copyRegions(state.levelDatPath, dimension, dstLevelDatPath, dimension, regions))
      } else if (mode === 'chunk') {
        if (chunks.length === 0 || !destChunk) return
        const minCx = Math.min(...chunks.map(([cx]) => cx))
        const minCz = Math.min(...chunks.map(([, cz]) => cz))
        const dx = destChunk[0] - minCx
        const dz = destChunk[1] - minCz
        setReport(await api.copyChunks(
          state.levelDatPath, dimension, dstLevelDatPath, dimension, chunks, dx, dz,
          yTrimEnabled ? yMinParsed : undefined, yTrimEnabled ? yMaxParsed : undefined,
        ))
      } else if (loadedTemplatePath) {
        if (!boxDest) return
        setReport(await api.pasteStructureTemplate(
          loadedTemplatePath, dstLevelDatPath, dimension,
          [boxDest.x, boxDest.y, boxDest.z],
          rotation, mirror,
        ))
      } else {
        if (!boxSelection || !boxDest || !boxYRangeValid) return
        setReport(await api.copyBlocks(
          state.levelDatPath, dimension, dstLevelDatPath, dimension,
          [boxSelection.x0, boxYMinParsed, boxSelection.z0, boxSelection.x1, boxYMaxParsed, boxSelection.z1],
          [boxDest.x, boxDest.y, boxDest.z],
          rotation, mirror,
        ))
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  const boxWidth = boxSelection ? boxSelection.x1 - boxSelection.x0 + 1 : 0
  const boxDepth = boxSelection ? boxSelection.z1 - boxSelection.z0 + 1 : 0
  const boxHeight = boxYRangeValid ? Math.abs(boxYMaxParsed - boxYMinParsed) + 1 : 0
  const boxBlockCount = boxWidth * boxDepth * boxHeight
  const boxChunkCount = boxSelection
    ? (Math.floor((boxSelection.x1) / 16) - Math.floor(boxSelection.x0 / 16) + 1) *
      (Math.floor((boxSelection.z1) / 16) - Math.floor(boxSelection.z0 / 16) + 1)
    : 0

  const selectedCount = mode === 'region' ? regions.length : mode === 'chunk' ? chunks.length : (boxSelection || loadedTemplatePath ? 1 : 0)
  const canCopy = mode === 'region'
    ? !busy && !!dstLevelDatPath && regions.length > 0
    : mode === 'chunk'
    ? !busy && !!dstLevelDatPath && chunks.length > 0 && !!destChunk && yTrimValid
    : loadedTemplatePath
    ? !busy && !!dstLevelDatPath && !!boxDest
    : !busy && !!dstLevelDatPath && !!boxSelection && !!boxDest && boxYRangeValid

  return (
    <div className="flyout-panel">
      <div className="flyout-header">
        <span className="flyout-title">Structures (dev)</span>
      </div>

      <div className="flyout-body">
        {!srcWorldDir ? (
          <div className="mp-empty">Open a world to copy from it.</div>
        ) : srcEdition !== 'java' ? (
          <div className="mp-empty">Structure copy is Java Edition only.</div>
        ) : (<>
          <div className="mp-group-btns" style={{ marginBottom: 8 }}>
            <button className={`btn-sm${mode === 'region' ? ' active' : ''}`} onClick={() => setMode('region')}>Regions</button>
            <button className={`btn-sm${mode === 'chunk' ? ' active' : ''}`} onClick={() => setMode('chunk')}>Chunks</button>
            <button className={`btn-sm${mode === 'box' ? ' active' : ''}`} onClick={() => setMode('box')}>Box</button>
          </div>

          {mode === 'region' ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0 }}>
              Copies whole <code>.mca</code> region files (512×512 blocks each),
              at the same region coordinates — no relocation. Click regions on
              the map to select them; outlines show which have data.
            </p>
          ) : mode === 'chunk' ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0 }}>
              Copies individual 16×16 chunks and can relocate them — click
              chunks on the map (chunk grid shown for precision), then place a
              destination. Block entities (chests, spawners…) move with their
              chunk; entities and structure-piece data do not.
            </p>
          ) : (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0 }}>
              Copies an exact block box (not chunk/section-aligned) with
              90°/180°/270° rotation and X/Z mirroring — facing/axis/shape
              properties rotate too, not just position. Click two corners on
              the map for X/Z, set the Y range and destination manually, then
              place a destination. Overwrites the destination box completely,
              including air. Merges into existing destination terrain — the
              destination chunks must already be generated. Heightmaps and
              lighting aren't recomputed; entities and structure-piece data
              don't copy.
            </p>
          )}

          <label className="overlay-toggle" style={{ display: 'block', marginBottom: 8 }}>
            <span className="overlay-label">Destination world</span>
            <select value={dstLevelDatPath} onChange={e => setDstLevelDatPath(e.target.value)}>
              <option value="">Select a world…</option>
              {destinations.map(w => (
                <option key={w.levelDatPath} value={w.levelDatPath}>{w.name}</option>
              ))}
            </select>
          </label>

          {isSameWorld && mode === 'region' && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -4 }}>
              Copying within the same world — switch dimension tabs above the
              map, or this will just re-copy identical bytes onto themselves.
            </p>
          )}

          {mode !== 'box' && (<>
            <div className="mp-group-header">
              <span className="mp-group-label">Selected ({selectedCount})</span>
              <div className="mp-group-btns">
                <button className="btn-sm" disabled={selectedCount === 0} onClick={clearSelection}>Clear</button>
              </div>
            </div>
            {selectedCount === 0 ? (
              <div className="mp-empty">Click {mode === 'region' ? 'a region' : 'chunks'} on the map to select {mode === 'region' ? 'it' : 'them'}.</div>
            ) : (
              <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {mode === 'region'
                  ? regions.map(([rx, rz]) => `r.${rx}.${rz}`).join(', ')
                  : chunks.map(([cx, cz]) => `c.${cx}.${cz}`).join(', ')}
              </p>
            )}
          </>)}

          {mode === 'chunk' && (<>
            <div className="mp-group-header">
              <span className="mp-group-label">Destination</span>
            </div>
            {destChunk ? (
              <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Chunk {destChunk[0]}, {destChunk[1]} (block {destChunk[0] * 16}, {destChunk[1] * 16})
                {' '}
                <button className="btn-sm" onClick={() => dispatch({ type: 'SET_STRUCTURE_COPY_DEST_CHUNK', dest: null })}>Clear</button>
              </p>
            ) : (
              <div className="mp-empty">Not set.</div>
            )}
            <button className={`btn-sm${placingDest ? ' active' : ''}`} style={{ marginBottom: 6 }}
              disabled={chunks.length === 0}
              onClick={() => dispatch({ type: 'SET_STRUCTURE_COPY_PLACING_DEST', placing: !placingDest })}>
              {placingDest ? 'Click the map…' : 'Place destination on map'}
            </button>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
              <input type="number" placeholder="X" value={destXInput} onChange={e => setDestXInput(e.target.value)}
                style={{ width: 70 }} />
              <input type="number" placeholder="Z" value={destZInput} onChange={e => setDestZInput(e.target.value)}
                style={{ width: 70 }} />
              <button className="btn-sm" onClick={placeDestManually}>Set</button>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -4 }}>
              Manual X/Z is the only way to place a destination in a different
              world than the one currently on the map.
            </p>

            <label className="overlay-toggle" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <input type="checkbox" checked={yTrimEnabled} onChange={e => setYTrimEnabled(e.target.checked)} />
              <span className="overlay-label">Trim Y range</span>
            </label>
            {yTrimEnabled && (<>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, marginBottom: 4 }}>
                <input type="number" placeholder="Y min" value={yMinInput} onChange={e => setYMinInput(e.target.value)}
                  style={{ width: 70 }} />
                <input type="number" placeholder="Y max" value={yMaxInput} onChange={e => setYMaxInput(e.target.value)}
                  style={{ width: 70 }} />
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -4 }}>
                Rounds outward to whole 16-block sections. Merges into the
                destination chunk's existing terrain rather than replacing it —
                the destination chunk must already be generated. Heightmaps and
                lighting aren't recomputed; expect a stale seam until MC relights
                or resaves the chunk.
              </p>
            </>)}
          </>)}

          {mode === 'box' && (<>
            <div className="mp-group-header">
              <span className="mp-group-label">Selection</span>
              <div className="mp-group-btns">
                <button className="btn-sm" disabled={!boxAnchor && !boxSelection} onClick={clearSelection}>Clear</button>
              </div>
            </div>
            {loadedTemplatePath ? (
              <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Template: {loadedTemplatePath.split('/').pop()}
                {' '}
                <button className="btn-sm" onClick={clearSelection}>Clear</button>
              </p>
            ) : boxSelection ? (
              <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                X {boxSelection.x0}..{boxSelection.x1}, Z {boxSelection.z0}..{boxSelection.z1}
              </p>
            ) : boxAnchor ? (
              <div className="mp-empty">First corner at {boxAnchor[0]}, {boxAnchor[1]} — click the opposite corner.</div>
            ) : (
              <div className="mp-empty">Click a corner on the map, then the opposite corner, or load a saved template below.</div>
            )}

            {!loadedTemplatePath && (<>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, marginBottom: 4, flexWrap: 'wrap' }}>
                <input type="number" placeholder="X0" value={boxX0Input} onChange={e => setBoxX0Input(e.target.value)}
                  style={{ width: 60 }} />
                <input type="number" placeholder="X1" value={boxX1Input} onChange={e => setBoxX1Input(e.target.value)}
                  style={{ width: 60 }} />
                <input type="number" placeholder="Z0" value={boxZ0Input} onChange={e => setBoxZ0Input(e.target.value)}
                  style={{ width: 60 }} />
                <input type="number" placeholder="Z1" value={boxZ1Input} onChange={e => setBoxZ1Input(e.target.value)}
                  style={{ width: 60 }} />
                <button className="btn-sm" onClick={setBoxSelectionManually}>Set</button>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, marginBottom: 4 }}>
                <input type="number" placeholder="Y min" value={boxYMinInput} onChange={e => setBoxYMinInput(e.target.value)}
                  style={{ width: 70 }} />
                <input type="number" placeholder="Y max" value={boxYMaxInput} onChange={e => setBoxYMaxInput(e.target.value)}
                  style={{ width: 70 }} />
              </div>

              {boxSelection && boxYRangeValid && (
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -2 }}>
                  {boxWidth}×{boxHeight}×{boxDepth} blocks ({boxBlockCount.toLocaleString()} total,
                  {' '}~{boxChunkCount} chunk{boxChunkCount === 1 ? '' : 's'}).
                </p>
              )}

              <button className="btn-sm" style={{ marginTop: 4, marginBottom: 4 }}
                disabled={templateBusy || !boxSelection || !boxYRangeValid}
                onClick={saveTemplate}>
                {templateBusy ? 'Saving…' : 'Save as template…'}
              </button>
            </>)}
            <button className="btn-sm" style={{ marginTop: 4, marginBottom: 8, display: 'block' }}
              onClick={loadTemplate}>
              Load template…
            </button>
            {templateInfo && (
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -4 }}>
                Saved: {templateInfo.width}×{templateInfo.height}×{templateInfo.depth}
                {' '}({templateInfo.blockCount.toLocaleString()} blocks).
              </p>
            )}
            {templateError && <div className="mp-empty" style={{ color: 'var(--danger, #e55)' }}>{templateError}</div>}

            <div className="mp-group-header">
              <span className="mp-group-label">Rotate / mirror</span>
            </div>
            <div className="mp-group-btns" style={{ marginBottom: 6 }}>
              {([0, 90, 180, 270] as const).map(r => (
                <button key={r} className={`btn-sm${rotation === r ? ' active' : ''}`}
                  onClick={() => dispatch({ type: 'SET_STRUCTURE_COPY_ROTATION', rotation: r })}>{r}°</button>
              ))}
            </div>
            <div className="mp-group-btns" style={{ marginBottom: 8 }}>
              <button className={`btn-sm${mirror === null ? ' active' : ''}`}
                onClick={() => dispatch({ type: 'SET_STRUCTURE_COPY_MIRROR', mirror: null })}>No mirror</button>
              <button className={`btn-sm${mirror === 'x' ? ' active' : ''}`}
                onClick={() => dispatch({ type: 'SET_STRUCTURE_COPY_MIRROR', mirror: 'x' })}>Mirror X</button>
              <button className={`btn-sm${mirror === 'z' ? ' active' : ''}`}
                onClick={() => dispatch({ type: 'SET_STRUCTURE_COPY_MIRROR', mirror: 'z' })}>Mirror Z</button>
            </div>

            <div className="mp-group-header">
              <span className="mp-group-label">Destination</span>
            </div>
            {boxDest ? (
              <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {boxDest.x}, {boxDest.y}, {boxDest.z}
                {' '}
                <button className="btn-sm" onClick={() => dispatch({ type: 'SET_STRUCTURE_COPY_BOX_DEST', dest: null })}>Clear</button>
              </p>
            ) : (
              <div className="mp-empty">Not set.</div>
            )}
            <button className={`btn-sm${placingBoxDest ? ' active' : ''}`} style={{ marginBottom: 6 }}
              disabled={!boxSelection}
              onClick={() => dispatch({ type: 'SET_STRUCTURE_COPY_PLACING_BOX_DEST', placing: !placingBoxDest })}>
              {placingBoxDest ? 'Click the map for X/Z…' : 'Place destination X/Z on map'}
            </button>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
              <input type="number" placeholder="X" value={boxDestXInput} onChange={e => setBoxDestXInput(e.target.value)}
                style={{ width: 60 }} />
              <input type="number" placeholder="Y" value={boxDestYInput} onChange={e => setBoxDestYInput(e.target.value)}
                style={{ width: 60 }} />
              <input type="number" placeholder="Z" value={boxDestZInput} onChange={e => setBoxDestZInput(e.target.value)}
                style={{ width: 60 }} />
              <button className="btn-sm" onClick={placeBoxDestManually}>Set</button>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -4 }}>
              Clicking the map only sets X/Z; Y (and any manual override) is
              typed — left blank, Y defaults to the source box's own Y min.
              Manual entry is the only way to place a destination in a
              different world than the one on the map.
            </p>
          </>)}

          <button className="btn-sm" style={{ marginTop: 10 }}
            disabled={!canCopy}
            onClick={runCopy}>
            {busy ? 'Copying…' : mode === 'box' ? 'Copy box' : `Copy ${selectedCount || ''} ${mode === 'region' ? 'region' : 'chunk'}${selectedCount === 1 ? '' : 's'}`}
          </button>

          {error && <div className="mp-empty" style={{ color: 'var(--danger, #e55)' }}>{error}</div>}

          {report && 'blocksWritten' in report ? (
            <div style={{ fontSize: 12, marginTop: 10 }}>
              <div>Blocks written: {report.blocksWritten}</div>
              <div>Chunks touched: {report.chunksTouched.length}</div>
              <div>Backed up: {report.backedUp.length}</div>
              {report.sourceAirAssumed > 0 && (
                <div style={{ color: 'var(--text-muted)' }}>
                  {report.sourceAirAssumed} source block{report.sourceAirAssumed === 1 ? '' : 's'} read as air
                  (ungenerated or pre-1.18 source chunk).
                </div>
              )}
              {report.skipped.length > 0 && (
                <div style={{ color: 'var(--danger, #e55)' }}>
                  Skipped:
                  <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                    {report.skipped.map((s, i) => (
                      <li key={i}>c.{s.chunk[0]}.{s.chunk[1]}: {s.reason}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : report && (
            <div style={{ fontSize: 12, marginTop: 10 }}>
              <div>Copied: {report.copied.length}</div>
              <div>Backed up: {report.backedUp.length}</div>
              {report.skipped.length > 0 && (
                <div style={{ color: 'var(--danger, #e55)' }}>
                  Skipped:
                  <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                    {report.skipped.map((s, i) => (
                      <li key={i}>
                        {'region' in s ? `r.${s.region[0]}.${s.region[1]}` : `c.${s.chunk[0]}.${s.chunk[1]}`}: {s.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>)}
      </div>
    </div>
  )
}
