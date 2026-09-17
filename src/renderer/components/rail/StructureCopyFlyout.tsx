import { useState, useEffect, useRef } from 'react'
import { useApp } from '../../App'
import * as api from '../../lib/tauriAPI'
import type { CopyRegionsReport, CopyChunksReport, CopyBlocksReport, SavedTemplateInfo } from '../../lib/tauriAPI.types'
import LiveLockChallenge from './LiveLockChallenge'

// "Custom Structures": region mode copies a whole .mca file at identical coordinates;
// chunk mode relocates at chunk granularity via structure_copy.rs's Anvil writer, with an
// optional section-aligned Y-trim that merges into (and requires) an existing destination
// chunk; box mode copies an arbitrary axis-aligned block box with Y/X/Z rotation and full
// blockstate property rotation, and overwrites the destination fully including air (not
// WorldEdit's air-transparent blend).
//
// A small stepper (Source → Preview → Destination → Confirm; region mode skips Preview —
// it copies at identical coordinates, so there's no placement to preview) keeps the three
// concerns visually separate: figure out what's being copied, see a real thumbnail of it,
// then place it. Reopening an earlier step clears whatever downstream state depended on it
// (see goToStep) rather than hiding it — nothing here is destructive to redo.
//
// Selection happens by clicking directly on the map (MapView.tsx's
// TOGGLE_STRUCTURE_COPY_REGION/_CHUNK, box-mode anchor clicks, StructureCopySelectionLayer)
// rather than a scrollable list — Chunk Data's forced outline/grid view is the visual
// affordance for "this is what's clickable." Y range and destination Y need manual entry
// since the map is 2D. The Preview step's thumbnail (structure_copy/preview.rs) also feeds
// StructureCopyGhostLayer's cursor-following stamp during destination placement.
//
// Source vs. destination on the map: the app only ever has one world loaded at a time,
// so picking a destination different from the source swaps the map over to it (via
// `loadWorld`) so destination clicks land on real terrain instead of the source's. The
// actual source path/dir/edition are snapshotted into `srcSnapshot` the moment a
// non-source world loads, so copy calls keep targeting the right world regardless of
// which one is currently on screen. A "Map shows: Source/Destination" toggle lets the
// user flip back manually; placing a destination auto-flips forward, and finishing that
// placement (or closing the panel) auto-flips back to source.
export default function StructureCopyFlyout() {
  const { state, dispatch, loadWorld } = useApp()

  // The world actually open when this panel is doing its work — snapshotted (not read
  // live off `state`) because picking a destination in a different world swaps the map
  // over to it, which would otherwise make `state.worldDir`/`levelDatPath` look like the
  // destination is the source. Updated below whenever the map is showing the source.
  const [srcSnapshot, setSrcSnapshot] = useState<{
    levelDatPath: string; worldDir: string; edition: string; dataVersion: number; versionName: string
  } | null>(
    () => state.levelDatPath && state.worldDir && state.seedData
      ? {
          levelDatPath: state.levelDatPath, worldDir: state.worldDir, edition: state.seedData.edition,
          dataVersion: state.seedData.dataVersion, versionName: state.seedData.versionName,
        }
      : null
  )
  // Whether the map is currently showing the destination world instead of the source.
  const [viewingDest, setViewingDest] = useState(false)
  const [switchingWorld, setSwitchingWorld] = useState(false)
  const viewingDestRef = useRef(viewingDest)
  viewingDestRef.current = viewingDest
  const srcSnapshotRef = useRef(srcSnapshot)
  srcSnapshotRef.current = srcSnapshot
  // `loadWorld` is a fresh closure every render of the app (not memoized) — a ref
  // lets the mount/unmount effect below call the latest version without listing it
  // as a dependency, which would otherwise tear down and re-run that effect (and
  // wipe the in-progress selection via its cleanup) on essentially every render.
  const loadWorldRef = useRef(loadWorld)
  loadWorldRef.current = loadWorld

  useEffect(() => {
    if (!viewingDest && state.levelDatPath && state.worldDir && state.seedData) {
      setSrcSnapshot({
        levelDatPath: state.levelDatPath, worldDir: state.worldDir, edition: state.seedData.edition,
        dataVersion: state.seedData.dataVersion, versionName: state.seedData.versionName,
      })
    }
  }, [state.levelDatPath, state.worldDir, state.seedData, viewingDest])

  // Loads `path` onto the map and records whether that's now showing the source or the
  // destination world. `viewingDest` flips before the (async) load starts so the
  // src-snapshot effect above never mistakes an in-flight destination load for a new source.
  const switchToWorld = async (path: string | null | undefined, isDest: boolean) => {
    if (!path) return
    setSwitchingWorld(true)
    setError(null)
    setViewingDest(isDest)
    try {
      await loadWorld(path)
    } catch (err) {
      setError(String(err))
      setViewingDest(!isDest)
    } finally {
      setSwitchingWorld(false)
    }
  }

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
      dispatch({ type: 'SET_STRUCTURE_COPY_PREVIEW', preview: null })
      // Leaving the panel with the destination world on screen would strand the user
      // there with no obvious reason why — put the source world back.
      if (viewingDestRef.current && srcSnapshotRef.current) {
        loadWorldRef.current(srcSnapshotRef.current.levelDatPath).catch(() => {})
      }
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

  // Chunk mode's Y range for "Save as template" only (copyChunks itself has no
  // Y-range concept beyond the destination-merge Y-trim below) — a template is
  // always a solid block box, so saving one needs an explicit vertical extent
  // the same way box mode does.
  const [chunkTemplateYMinInput, setChunkTemplateYMinInput] = useState('')
  const [chunkTemplateYMaxInput, setChunkTemplateYMaxInput] = useState('')
  const chunkTemplateYMinParsed = parseInt(chunkTemplateYMinInput, 10)
  const chunkTemplateYMaxParsed = parseInt(chunkTemplateYMaxInput, 10)
  const chunkTemplateYRangeValid = !Number.isNaN(chunkTemplateYMinParsed) && !Number.isNaN(chunkTemplateYMaxParsed)

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

  const srcWorldDir    = srcSnapshot?.worldDir ?? null
  const srcLevelDatPath = srcSnapshot?.levelDatPath ?? null
  const srcEdition     = srcSnapshot?.edition ?? 'java'
  const srcWorldName  = (savesWorlds ?? []).find(w => w.levelDatPath === srcLevelDatPath)?.name
    ?? srcWorldDir?.split(/[\\/]/).pop()
    ?? null
  const dimension   = state.dimension
  const mode        = state.structureCopyMode
  const regions     = state.structureCopySelectedRegions
  const chunks      = state.structureCopySelectedChunks
  // Templates are a solid block box — "Save as template" only makes sense for a
  // gapless rectangular set of chunks, not an arbitrary/L-shaped multi-selection.
  const chunkSelectionIsRectangle = (() => {
    if (chunks.length === 0) return false
    const cxs = chunks.map(([cx]) => cx)
    const czs = chunks.map(([, cz]) => cz)
    const minCx = Math.min(...cxs), maxCx = Math.max(...cxs)
    const minCz = Math.min(...czs), maxCz = Math.max(...czs)
    if (chunks.length !== (maxCx - minCx + 1) * (maxCz - minCz + 1)) return false
    const have = new Set(chunks.map(([cx, cz]) => `${cx},${cz}`))
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        if (!have.has(`${cx},${cz}`)) return false
      }
    }
    return true
  })()
  const placingDest = state.structureCopyPlacingDest
  const destChunk   = state.structureCopyDestChunk
  const boxAnchor    = state.structureCopyBoxAnchor
  const boxSelection = state.structureCopyBoxSelection
  const boxX0Parsed = parseInt(boxX0Input, 10)
  const boxX1Parsed = parseInt(boxX1Input, 10)
  const boxZ0Parsed = parseInt(boxZ0Input, 10)
  const boxZ1Parsed = parseInt(boxZ1Input, 10)
  // Blocks Continue/Save whenever the manual X/Z fields have been typed into
  // but don't (yet, or anymore) match the applied boxSelection — editing a
  // field after clicking Set shouldn't silently keep the old selection live.
  // Untouched (still-empty) fields don't count — that's the map-click-selection
  // case, which never touches these inputs at all.
  const boxManualFieldsTouched = boxX0Input !== '' || boxX1Input !== '' || boxZ0Input !== '' || boxZ1Input !== ''
  const boxManualMatchesSelection = !!boxSelection &&
    ![boxX0Parsed, boxX1Parsed, boxZ0Parsed, boxZ1Parsed].some(Number.isNaN) &&
    Math.min(boxX0Parsed, boxX1Parsed) === boxSelection.x0 && Math.max(boxX0Parsed, boxX1Parsed) === boxSelection.x1 &&
    Math.min(boxZ0Parsed, boxZ1Parsed) === boxSelection.z0 && Math.max(boxZ0Parsed, boxZ1Parsed) === boxSelection.z1
  const boxSelectionStale = boxManualFieldsTouched && !boxManualMatchesSelection
  const placingBoxDest = state.structureCopyPlacingBoxDest
  const boxDest       = state.structureCopyBoxDest
  const rotation       = state.structureCopyRotation
  const mirror         = state.structureCopyMirror
  const preview        = state.structureCopyPreview

  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<CopyRegionsReport | CopyChunksReport | CopyBlocksReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  // ── Stepper ───────────────────────────────────────────────────────────────
  // Region mode has no Preview step: it copies at identical coordinates, so
  // there's no placement for a thumbnail to support.
  type Step = 'source' | 'preview' | 'destination' | 'confirm'
  const steps: Step[] = mode === 'region' ? ['source', 'destination', 'confirm'] : ['source', 'preview', 'destination', 'confirm']
  const STEP_LABELS: Record<Step, string> = { source: 'Source', preview: 'Preview', destination: 'Destination', confirm: 'Confirm' }
  const [step, setStep] = useState<Step>('source')
  const stepIndex = steps.indexOf(step)
  const [previewBusy, setPreviewBusy] = useState(false)

  // Reopening a completed step clears whatever downstream state depended on
  // it, rather than just hiding it — so redoing Source doesn't leave a
  // destination position sized for a footprint that no longer exists.
  const goToStep = (target: Step) => {
    const targetIndex = steps.indexOf(target)
    if (targetIndex > stepIndex) return // can't skip ahead
    if (target === 'source' && stepIndex > steps.indexOf('source')) {
      if (mode === 'chunk' && !loadedTemplatePath) dispatch({ type: 'SET_STRUCTURE_COPY_DEST_CHUNK', dest: null })
      else dispatch({ type: 'SET_STRUCTURE_COPY_BOX_DEST', dest: null })
      dispatch({ type: 'SET_STRUCTURE_COPY_PREVIEW', preview: null })
    }
    setError(null)
    setStep(target)
  }

  // Same-world is a valid destination (e.g. copying between dimensions of the
  // same world, or relocating within one world). A same-world + same-dimension
  // + unshifted copy is a harmless no-op (re-copies identical bytes onto
  // themselves); not worth blocking, just flagged below.
  const destinations = (savesWorlds ?? [])
    .filter(w => w.edition === 'java')
    .map(w => w.levelDatPath === srcLevelDatPath ? { ...w, name: `${w.name} (this world)` } : w)
  const dstWorldName = destinations.find(w => w.levelDatPath === dstLevelDatPath)?.name ?? null

  const isSameWorld = dstLevelDatPath === srcLevelDatPath

  // Checked as soon as a destination is picked — not deferred to the actual
  // copy call — so a version mismatch blocks progress at the Destination step
  // instead of after the user has already gone through Preview and placement.
  // A plain read_level_dat peek (api.readSeed), not loadWorld/switchToWorld: no
  // need to touch the map or app-wide seed state just to check a version.
  const [dstVersion, setDstVersion] = useState<{ dataVersion: number; versionName: string } | null>(null)
  const [dstVersionBusy, setDstVersionBusy] = useState(false)
  const versionMismatch = !!(srcSnapshot && dstVersion && dstVersion.dataVersion !== srcSnapshot.dataVersion)

  // Picking a destination different from the source swaps the map over to it so
  // clicking to place a destination lands on real terrain instead of the source's.
  const onSelectDestination = async (path: string) => {
    setDstLevelDatPath(path)
    setError(null)
    setReport(null)
    setDstVersion(null)
    if (viewingDest && (!path || path === srcLevelDatPath)) {
      switchToWorld(srcLevelDatPath, false)
    } else if (path && path !== srcLevelDatPath) {
      switchToWorld(path, true)
    }
    if (!path) return
    if (path === srcLevelDatPath) {
      if (srcSnapshot) setDstVersion({ dataVersion: srcSnapshot.dataVersion, versionName: srcSnapshot.versionName })
      return
    }
    setDstVersionBusy(true)
    try {
      const data = await api.readSeed(path)
      setDstVersion({ dataVersion: data.dataVersion, versionName: data.versionName })
    } catch {
      setDstVersion(null) // surfaced properly at copy time either way; not worth a second error banner here
    } finally {
      setDstVersionBusy(false)
    }
  }

  // Once a destination position lands (from a map click), flip the map back to the
  // source automatically — the user asked to see the destination to place it, not to
  // keep working there.
  useEffect(() => {
    if (viewingDest && destChunk && srcLevelDatPath) switchToWorld(srcLevelDatPath, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destChunk])
  useEffect(() => {
    if (viewingDest && boxDest && srcLevelDatPath) switchToWorld(srcLevelDatPath, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxDest])

  const setMode = (m: 'region' | 'chunk' | 'box') => {
    dispatch({ type: 'SET_STRUCTURE_COPY_MODE', mode: m })
    dispatch({ type: 'SET_STRUCTURE_COPY_PREVIEW', preview: null })
    setStep('source')
    setReport(null)
    setError(null)
  }

  const clearSelection = () => {
    if (mode === 'region') {
      dispatch({ type: 'SET_STRUCTURE_COPY_SELECTED_REGIONS', regions: [] })
    } else if (mode === 'chunk') {
      dispatch({ type: 'SET_STRUCTURE_COPY_SELECTED_CHUNKS', chunks: [] })
      setLoadedTemplatePath(null)
      setTemplateInfo(null)
      setTemplateError(null)
    } else {
      dispatch({ type: 'SET_STRUCTURE_COPY_BOX_ANCHOR', anchor: null })
      dispatch({ type: 'SET_STRUCTURE_COPY_BOX_SELECTION', selection: null })
      setLoadedTemplatePath(null)
      setTemplateInfo(null)
      setTemplateError(null)
    }
  }

  // Box mode saves its drawn box; chunk mode saves the bounding box of a solid
  // rectangular chunk selection (with its own Y range, since copyChunks has no
  // such concept) — both go through the same saveStructureTemplate call.
  const saveTemplate = async () => {
    if (!srcLevelDatPath) return
    let box: [number, number, number, number, number, number]
    if (mode === 'chunk') {
      if (!chunkSelectionIsRectangle || !chunkTemplateYRangeValid) return
      const cxs = chunks.map(([cx]) => cx)
      const czs = chunks.map(([, cz]) => cz)
      const minCx = Math.min(...cxs), maxCx = Math.max(...cxs)
      const minCz = Math.min(...czs), maxCz = Math.max(...czs)
      box = [minCx * 16, chunkTemplateYMinParsed, minCz * 16, maxCx * 16 + 15, chunkTemplateYMaxParsed, maxCz * 16 + 15]
    } else {
      if (!boxSelection || !boxYRangeValid || boxSelectionStale) return
      box = [boxSelection.x0, boxYMinParsed, boxSelection.z0, boxSelection.x1, boxYMaxParsed, boxSelection.z1]
    }
    setTemplateError(null)
    const outPath = await api.selectTemplateSavePath('structure.nbt')
    if (!outPath) return
    setTemplateBusy(true)
    try {
      const info = await api.saveStructureTemplate(srcLevelDatPath, dimension, box, outPath)
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
    // Loading a template replaces a map-drawn box or chunk selection as this
    // run's source — only one source feeds one paste.
    dispatch({ type: 'SET_STRUCTURE_COPY_BOX_ANCHOR', anchor: null })
    dispatch({ type: 'SET_STRUCTURE_COPY_BOX_SELECTION', selection: null })
    dispatch({ type: 'SET_STRUCTURE_COPY_SELECTED_CHUNKS', chunks: [] })
    setLoadedTemplatePath(path)
    setTemplateInfo(null)
    setTemplateError(null)
  }

  // A loaded template overrides whichever mode tab it was loaded from — it
  // always drives the box/paste pipeline (preview, rotate/mirror, arbitrary
  // placement), never the mode's own mechanism (chunk relocate, box merge).
  const usingTemplate = !!loadedTemplatePath
  const canContinueFromSource = usingTemplate
    ? true
    : mode === 'region'
    ? regions.length > 0
    : mode === 'chunk'
    ? chunks.length > 0
    : !!boxSelection && boxYRangeValid && !boxSelectionStale

  // Fetches the real block-color thumbnail for whatever's selected and
  // advances to the Preview step (region mode skips straight to Destination —
  // it has no placement step for a thumbnail to support).
  const continueFromSource = async () => {
    setError(null)
    if (!canContinueFromSource) return
    if (mode === 'region') { setStep('destination'); return }
    setPreviewBusy(true)
    try {
      if (loadedTemplatePath) {
        const img = await api.previewTemplate(loadedTemplatePath)
        dispatch({ type: 'SET_STRUCTURE_COPY_PREVIEW', preview: img })
      } else if (mode === 'chunk') {
        if (!srcWorldDir) return
        const img = await api.previewChunkSelection(srcWorldDir, dimension, chunks)
        dispatch({ type: 'SET_STRUCTURE_COPY_PREVIEW', preview: img })
      } else if (srcLevelDatPath && boxSelection && boxYRangeValid) {
        const img = await api.previewBoxSelection(
          srcLevelDatPath, dimension,
          [boxSelection.x0, boxYMinParsed, boxSelection.z0, boxSelection.x1, boxYMaxParsed, boxSelection.z1],
        )
        dispatch({ type: 'SET_STRUCTURE_COPY_PREVIEW', preview: img })
      } else {
        return
      }
      setStep('preview')
    } catch (err) {
      setError(String(err))
    } finally {
      setPreviewBusy(false)
    }
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

  // Set when a write comes back refused specifically because the destination
  // world's session.lock looks held by a live Minecraft client — shows
  // LiveLockChallenge instead of the plain error banner. Matched by a
  // substring of session_lock's WORLD_OPEN_MSG (structure_copy/mod.rs); if
  // that message's wording ever changes, update this too.
  const isLiveLockError = (err: unknown) => String(err).includes('session.lock is held')
  const [liveLockChallenge, setLiveLockChallenge] = useState(false)

  const runCopy = async (overrideLiveLock = false) => {
    if (!srcLevelDatPath || !dstLevelDatPath) return
    setBusy(true)
    setError(null)
    setLiveLockChallenge(false)
    setReport(null)
    try {
      if (mode === 'region') {
        if (regions.length === 0) return
        setReport(await api.copyRegions(srcLevelDatPath, dimension, dstLevelDatPath, dimension, regions, overrideLiveLock))
      } else if (loadedTemplatePath) {
        if (!boxDest) return
        setReport(await api.pasteStructureTemplate(
          loadedTemplatePath, dstLevelDatPath, dimension,
          [boxDest.x, boxDest.y, boxDest.z],
          rotation, mirror, overrideLiveLock,
        ))
      } else if (mode === 'chunk') {
        if (chunks.length === 0 || !destChunk) return
        const minCx = Math.min(...chunks.map(([cx]) => cx))
        const minCz = Math.min(...chunks.map(([, cz]) => cz))
        const dx = destChunk[0] - minCx
        const dz = destChunk[1] - minCz
        setReport(await api.copyChunks(
          srcLevelDatPath, dimension, dstLevelDatPath, dimension, chunks, dx, dz,
          yTrimEnabled ? yMinParsed : undefined, yTrimEnabled ? yMaxParsed : undefined,
          overrideLiveLock,
        ))
      } else {
        if (!boxSelection || !boxDest || !boxYRangeValid) return
        setReport(await api.copyBlocks(
          srcLevelDatPath, dimension, dstLevelDatPath, dimension,
          [boxSelection.x0, boxYMinParsed, boxSelection.z0, boxSelection.x1, boxYMaxParsed, boxSelection.z1],
          [boxDest.x, boxDest.y, boxDest.z],
          rotation, mirror, overrideLiveLock,
        ))
      }
    } catch (err) {
      if (!overrideLiveLock && isLiveLockError(err)) {
        setLiveLockChallenge(true)
      } else {
        setError(String(err))
      }
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

  const selectedCount = mode === 'region' ? regions.length
    : mode === 'chunk' ? (loadedTemplatePath ? 1 : chunks.length)
    : (boxSelection || loadedTemplatePath ? 1 : 0)
  const canContinueFromDestination = (mode === 'region'
    ? !!dstLevelDatPath
    : mode === 'chunk' && !loadedTemplatePath
    ? !!dstLevelDatPath && !!destChunk && yTrimValid
    : !!dstLevelDatPath && !!boxDest
  ) && !versionMismatch && !dstVersionBusy
  const canCopy = (mode === 'region'
    ? !!dstLevelDatPath && regions.length > 0
    : loadedTemplatePath
    ? !!dstLevelDatPath && !!boxDest
    : mode === 'chunk'
    ? !!dstLevelDatPath && chunks.length > 0 && !!destChunk && yTrimValid
    : !!dstLevelDatPath && !!boxSelection && !!boxDest && boxYRangeValid
  ) && !busy && !switchingWorld && !versionMismatch

  // Turning placement on switches the map to the destination world first (if it isn't
  // already showing it) so the click lands on real terrain instead of the source's.
  const togglePlacingDest = () => {
    if (!placingDest && dstLevelDatPath && !isSameWorld && !viewingDest) switchToWorld(dstLevelDatPath, true)
    dispatch({ type: 'SET_STRUCTURE_COPY_PLACING_DEST', placing: !placingDest })
  }
  const togglePlacingBoxDest = () => {
    if (!placingBoxDest && dstLevelDatPath && !isSameWorld && !viewingDest) switchToWorld(dstLevelDatPath, true)
    dispatch({ type: 'SET_STRUCTURE_COPY_PLACING_BOX_DEST', placing: !placingBoxDest })
  }

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
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 0, marginBottom: 8 }}>
            <span style={{ color: 'var(--text-muted)' }}>Source: </span>
            <strong>{srcWorldName ?? '—'}</strong>
          </p>

          <div className="mp-group-btns" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
            {steps.map((s, i) => (
              <button key={s} className={`btn-sm${s === step ? ' active' : ''}`}
                disabled={i > stepIndex}
                onClick={() => goToStep(s)}>
                {i + 1}. {STEP_LABELS[s]}
              </button>
            ))}
          </div>

          {step === 'source' && (<>
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
                chunks on the map (chunk grid shown for precision), or load a
                saved template. Block entities (chests, spawners…) move with
                their chunk; entities and structure-piece data do not. A solid
                rectangular selection can also be saved as a template.
              </p>
            ) : (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0 }}>
                Copies an exact block box (not chunk/section-aligned) with
                90°/180°/270° rotation and X/Z mirroring — facing/axis/shape
                properties rotate too, not just position. Click two corners on
                the map for X/Z and set the Y range, or load a saved template.
                Overwrites the destination box completely, including air.
                Merges into existing destination terrain — the destination
                chunks must already be generated. Heightmaps and lighting
                aren't recomputed; entities and structure-piece data don't copy.
              </p>
            )}

            {mode === 'region' && (<>
              <div className="mp-group-header">
                <span className="mp-group-label">Selected ({selectedCount})</span>
                <div className="mp-group-btns">
                  <button className="btn-sm" disabled={selectedCount === 0} onClick={clearSelection}>Clear</button>
                </div>
              </div>
              {selectedCount === 0 ? (
                <div className="mp-empty">Click a region on the map to select it.</div>
              ) : (
                <p style={{ fontSize: 12, color: 'var(--accent)' }}>
                  ✓ {regions.map(([rx, rz]) => `r.${rx}.${rz}`).join(', ')}
                </p>
              )}
            </>)}

            {mode === 'chunk' && (<>
              <div className="mp-group-header">
                <span className="mp-group-label">Selected ({selectedCount})</span>
                <div className="mp-group-btns">
                  <button className="btn-sm" disabled={selectedCount === 0} onClick={clearSelection}>Clear</button>
                </div>
              </div>
              {loadedTemplatePath ? (
                <p style={{ fontSize: 12, color: 'var(--accent)' }}>
                  ✓ Template: {loadedTemplatePath.split('/').pop()}
                </p>
              ) : chunks.length === 0 ? (
                <div className="mp-empty">Click chunks on the map to select them, or load a saved template below.</div>
              ) : (
                <p style={{ fontSize: 12, color: 'var(--accent)' }}>
                  ✓ {chunks.map(([cx, cz]) => `c.${cx}.${cz}`).join(', ')}
                </p>
              )}

              {!loadedTemplatePath && (<>
                {chunks.length > 0 && !chunkSelectionIsRectangle && (
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -2, marginBottom: 4 }}>
                    Not a solid rectangle — copies fine as-is, but "Save as
                    template" needs a gapless rectangular block of chunks.
                  </p>
                )}
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, marginBottom: 4 }}>
                  <input type="number" placeholder="Y min" value={chunkTemplateYMinInput} onChange={e => setChunkTemplateYMinInput(e.target.value)}
                    style={{ width: 70 }} />
                  <input type="number" placeholder="Y max" value={chunkTemplateYMaxInput} onChange={e => setChunkTemplateYMaxInput(e.target.value)}
                    style={{ width: 70 }} />
                </div>
                <button className="btn-sm" style={{ marginTop: 4, marginBottom: 4 }}
                  disabled={templateBusy || !chunkSelectionIsRectangle || !chunkTemplateYRangeValid}
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
            </>)}

            {mode === 'box' && (<>
              <div className="mp-group-header">
                <span className="mp-group-label">Selection</span>
                <div className="mp-group-btns">
                  <button className="btn-sm" disabled={!boxAnchor && !boxSelection} onClick={clearSelection}>Clear</button>
                </div>
              </div>
              {loadedTemplatePath ? (
                <p style={{ fontSize: 12, color: 'var(--accent)' }}>
                  ✓ Template: {loadedTemplatePath.split('/').pop()}
                  {' '}
                  <button className="btn-sm" onClick={clearSelection}>Clear</button>
                </p>
              ) : boxSelection ? (
                <p style={{ fontSize: 12, color: 'var(--accent)' }}>
                  ✓ X {boxSelection.x0}..{boxSelection.x1}, Z {boxSelection.z0}..{boxSelection.z1}
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
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, marginBottom: 4 }}>
                  <input type="number" placeholder="Y min" value={boxYMinInput} onChange={e => setBoxYMinInput(e.target.value)}
                    style={{ width: 70 }} />
                  <input type="number" placeholder="Y max" value={boxYMaxInput} onChange={e => setBoxYMaxInput(e.target.value)}
                    style={{ width: 70 }} />
                  <button className="btn-sm" onClick={setBoxSelectionManually}>Set</button>
                </div>

                {boxSelection && boxYRangeValid && (
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -2 }}>
                    {boxWidth}×{boxHeight}×{boxDepth} blocks ({boxBlockCount.toLocaleString()} total,
                    {' '}~{boxChunkCount} chunk{boxChunkCount === 1 ? '' : 's'}).
                  </p>
                )}

                <button className="btn-sm" style={{ marginTop: 4, marginBottom: 4 }}
                  disabled={templateBusy || !boxSelection || !boxYRangeValid || boxSelectionStale}
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
            </>)}

            <button className="btn-sm" style={{ marginTop: 10 }}
              disabled={!canContinueFromSource || previewBusy}
              onClick={continueFromSource}>
              {previewBusy ? 'Loading preview…' : mode === 'region' ? 'Continue →' : 'Continue → Preview'}
            </button>
          </>)}

          {step === 'preview' && preview && (<>
            <div className="mp-group-header">
              <span className="mp-group-label">Preview</span>
            </div>
            <div style={{
              border: '1px solid var(--border, #444)', borderRadius: 4, padding: 4,
              display: 'inline-block', marginBottom: 6, maxWidth: '100%',
            }}>
              <img src={preview.dataUrl} alt="Source preview"
                style={{
                  display: 'block', maxWidth: 220, maxHeight: 220,
                  width: 'auto', height: 'auto', imageRendering: 'pixelated',
                }} />
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 0, marginBottom: 10 }}>
              {preview.widthBlocks}×{preview.depthBlocks} block footprint (top-down, real block colors).
            </p>

            {(mode === 'box' || loadedTemplatePath) && (<>
              <div className="mp-group-header">
                <span className="mp-group-label">Rotate / mirror</span>
              </div>
              <div className="mp-group-btns" style={{ marginBottom: 6 }}>
                {([0, 90, 180, 270] as const).map(r => (
                  <button key={r} className={`btn-sm${rotation === r ? ' active' : ''}`}
                    onClick={() => dispatch({ type: 'SET_STRUCTURE_COPY_ROTATION', rotation: r })}>{r}°</button>
                ))}
              </div>
              <div className="mp-group-btns" style={{ marginBottom: 10 }}>
                <button className={`btn-sm${mirror === null ? ' active' : ''}`}
                  onClick={() => dispatch({ type: 'SET_STRUCTURE_COPY_MIRROR', mirror: null })}>No mirror</button>
                <button className={`btn-sm${mirror === 'x' ? ' active' : ''}`}
                  onClick={() => dispatch({ type: 'SET_STRUCTURE_COPY_MIRROR', mirror: 'x' })}>Mirror X</button>
                <button className={`btn-sm${mirror === 'z' ? ' active' : ''}`}
                  onClick={() => dispatch({ type: 'SET_STRUCTURE_COPY_MIRROR', mirror: 'z' })}>Mirror Z</button>
              </div>
            </>)}

            <div className="mp-group-btns">
              <button className="btn-sm" onClick={() => goToStep('source')}>← Change selection</button>
              <button className="btn-sm active" onClick={() => setStep('destination')}>Continue → Destination</button>
            </div>
          </>)}

          {step === 'destination' && (<>
            <label className="overlay-toggle" style={{ display: 'block', marginBottom: dstLevelDatPath ? 2 : 8 }}>
              <span className="overlay-label">Destination world</span>
              <select value={dstLevelDatPath} onChange={e => onSelectDestination(e.target.value)}>
                <option value="">Select a world…</option>
                {destinations.map(w => (
                  <option key={w.levelDatPath} value={w.levelDatPath}>{w.name}</option>
                ))}
              </select>
            </label>

            {dstLevelDatPath && (
              dstVersionBusy ? (
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 0, marginBottom: 8 }}>
                  Checking Minecraft version…
                </p>
              ) : versionMismatch ? (
                <p style={{ fontSize: 12, color: 'var(--danger, #e55)', marginTop: 0, marginBottom: 8 }}>
                  ⚠ Version mismatch: source is {srcSnapshot?.versionName ?? '?'}, destination
                  is {dstVersion?.versionName ?? '?'}. This app doesn't convert between versions —
                  open the older world in a Minecraft client to let it upgrade in place, or pick a
                  same-version destination.
                </p>
              ) : (
                <p style={{ fontSize: 11, color: 'var(--accent)', marginTop: 0, marginBottom: 8 }}>
                  ✓ Destination set{dstVersion ? ` (${dstVersion.versionName})` : ''}.
                </p>
              )
            )}

            {dstLevelDatPath && !isSameWorld && (
              <div className="mp-group-btns" style={{ marginBottom: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginRight: 2 }}>Map shows:</span>
                <button className={`btn-sm${!viewingDest ? ' active' : ''}`} disabled={switchingWorld}
                  onClick={() => switchToWorld(srcLevelDatPath, false)}>Source</button>
                <button className={`btn-sm${viewingDest ? ' active' : ''}`} disabled={switchingWorld}
                  onClick={() => switchToWorld(dstLevelDatPath, true)}>Destination</button>
                {switchingWorld && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Loading…</span>}
              </div>
            )}

            {isSameWorld && mode === 'region' && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -4 }}>
                Copying within the same world — switch dimension tabs above the
                map, or this will just re-copy identical bytes onto themselves.
              </p>
            )}

            {mode === 'chunk' && !loadedTemplatePath && (<>
              <div className="mp-group-header">
                <span className="mp-group-label">Destination position</span>
              </div>
              {destChunk ? (
                <p style={{ fontSize: 12, color: 'var(--accent)' }}>
                  ✓ Chunk {destChunk[0]}, {destChunk[1]} (block {destChunk[0] * 16}, {destChunk[1] * 16})
                  {' '}
                  <button className="btn-sm" onClick={() => dispatch({ type: 'SET_STRUCTURE_COPY_DEST_CHUNK', dest: null })}>Clear</button>
                </p>
              ) : (
                <div className="mp-empty">Not set.</div>
              )}
              <button className={`btn-sm${placingDest ? ' active' : ''}`} style={{ marginBottom: 6 }}
                disabled={chunks.length === 0 || switchingWorld}
                onClick={togglePlacingDest}>
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
                "Place destination on map" switches the map to the destination
                world and shows a ghosted preview of the chunks under the
                cursor; manual X/Z skips that and doesn't require switching.
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

            {(mode === 'box' || loadedTemplatePath) && (<>
              <div className="mp-group-header">
                <span className="mp-group-label">Destination position</span>
              </div>
              {boxDest ? (
                <p style={{ fontSize: 12, color: 'var(--accent)' }}>
                  ✓ {boxDest.x}, {boxDest.y}, {boxDest.z}
                  {' '}
                  <button className="btn-sm" onClick={() => dispatch({ type: 'SET_STRUCTURE_COPY_BOX_DEST', dest: null })}>Clear</button>
                </p>
              ) : (
                <div className="mp-empty">Not set.</div>
              )}
              <button className={`btn-sm${placingBoxDest ? ' active' : ''}`} style={{ marginBottom: 6 }}
                disabled={!boxSelection && !loadedTemplatePath || switchingWorld}
                onClick={togglePlacingBoxDest}>
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
                "Place destination X/Z on map" switches the map to the
                destination world and shows the preview thumbnail as a
                ghosted stamp under the cursor, rotated/mirrored as set above.
                Y (and any manual override) is always typed — left blank, Y
                defaults to the source box's own Y min.
              </p>
            </>)}

            <div className="mp-group-btns" style={{ marginTop: 6 }}>
              <button className="btn-sm" onClick={() => goToStep(mode === 'region' ? 'source' : 'preview')}>← Back</button>
              <button className="btn-sm active" disabled={!canContinueFromDestination}
                onClick={() => setStep('confirm')}>
                Continue → Confirm
              </button>
            </div>
          </>)}

          {step === 'confirm' && (<>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 0 }}>
              Copying from <strong>{srcWorldName ?? '—'}</strong> to <strong>{dstWorldName ?? '—'}</strong>.
            </p>

            <button className="btn-sm" style={{ marginTop: 4, marginBottom: 4 }}
              onClick={() => goToStep('destination')}>
              ← Back
            </button>

            <button className="btn-sm" style={{ marginTop: 6 }}
              disabled={!canCopy}
              onClick={() => runCopy()}>
              {busy ? 'Copying…'
                : loadedTemplatePath ? 'Paste template'
                : mode === 'box' ? 'Copy box'
                : `Copy ${selectedCount || ''} ${mode === 'region' ? 'region' : 'chunk'}${selectedCount === 1 ? '' : 's'}`}
            </button>

            {liveLockChallenge && (
              <LiveLockChallenge
                onConfirm={() => runCopy(true)}
                onCancel={() => setLiveLockChallenge(false)}
              />
            )}

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
                {report.relit.length > 0 && (
                  <div style={{ color: 'var(--text-muted)' }}>Neighbor chunks relit: {report.relit.length}</div>
                )}
                {report.relightWarning && (
                  <div style={{ color: 'var(--danger, #e55)' }}>{report.relightWarning}</div>
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
                {'relit' in report && report.relit.length > 0 && (
                  <div style={{ color: 'var(--text-muted)' }}>Neighbor chunks relit: {report.relit.length}</div>
                )}
                {'relightWarning' in report && report.relightWarning && (
                  <div style={{ color: 'var(--danger, #e55)' }}>{report.relightWarning}</div>
                )}
              </div>
            )}
          </>)}
        </>)}
      </div>
    </div>
  )
}
