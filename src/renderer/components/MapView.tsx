import React, { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { useApp } from '../App'
import * as api from '../lib/tauriAPI'
import { MIN_ZOOM, MAX_ZOOM, CAVE_MODE_ZOOM, MC_VERSIONS } from '../lib/constants'
import { minecraftToLeaflet, leafletToMinecraft } from '../lib/tileCoords'
import { BIOME_NAMES } from '../lib/biomeColors'
import type { OreVeinColumn } from '../lib/tauriAPI.types'
import { caveZoomRange, effectiveCaveAnchorY } from '../hooks/overlaySlice'

import CursorInfoBar from './CursorInfoBar'
import MapContextMenu, { type ContextMenuState } from './MapContextMenu'
import ShareLinkDialog from './ShareLinkDialog'
import { setMarkerMenuHandler } from '../lib/contextMenuBus'
import { parseShareLink, clearShareLinkFromUrl } from '../lib/shareLink'
import BiomeTileLayer from './BiomeTileLayer'
import GeneratedRegionsLayer from './GeneratedRegionsLayer'
import StructureCopySelectionLayer from './StructureCopySelectionLayer'
import StructureCopyGhostLayer from './StructureCopyGhostLayer'
import SpawnChunksLayer from './SpawnChunksLayer'
import WorldBorderLayer from './WorldBorderLayer'
import ChunkOverlayLayer from './ChunkOverlayLayer'
import ChunkGridLayer from './ChunkGridLayer'
import SlimeChunkLayer from './SlimeChunkLayer'
import OreVeinLayer from './OreVeinLayer'
import OreFeatureLayer from './OreFeatureLayer'
import CarverLayer from './CarverLayer'
import LocalDifficultyLayer from './LocalDifficultyLayer'
import StructureLayer from './StructureLayer'
import SpawnMarker from './SpawnMarker'
import PlayerRespawnMarker from './PlayerRespawnMarker'
import PlayerMarker from './PlayerMarker'
import PinLayer from './PinLayer'
import SavedRoutesLayer from './SavedRoutesLayer'
import RulerLayer from './RulerLayer'
import RulerPanel from './RulerPanel'
import TileLoadingHud from './TileLoadingHud'
import DebugOverlay from './DebugOverlay'
import CaveMapControls from './CaveMapControls'
import MapToolbar from './MapToolbar'
import BlockEntityLayer from './BlockEntityLayer'
import EntityLayer from './EntityLayer'
import PoiLayer from './PoiLayer'
import type { Pin } from '../hooks/useSeed'
import type { Dimension } from '../lib/constants'

/** Build a default pin at the given block coordinates. */
function makePin(x: number, z: number, dimension: Dimension): Pin {
  return { id: `pin-${Date.now()}`, x, z, label: `${x}, ${z}`, dimension, crossDimensional: false }
}

// How long a gesture-driven zoom must sit outside the cave range before it bounces back —
// long enough that a continuous scroll doesn't fight the animation, short enough to read
// as immediate feedback once the user stops.
const CAVE_BOUNCE_SETTLE_MS = 500

export default function MapView() {
  const { state, dispatch, generatorSlot, generatorConfig, mapRef } = useApp()
  const containerRef = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<L.Map | null>(null)
  const [mouseCoords, setMouseCoords] = useState<{ x: number; z: number } | null>(null)
  const [biomeName, setBiomeName] = useState<string | null>(null)
  const [blockName, setBlockName] = useState<string | null>(null)
  const [chunkDataVersion, setChunkDataVersion] = useState<number | null>(null)
  const [terrainY, setTerrainY] = useState<number | null>(null)
  const [localDifficulty, setLocalDifficulty] = useState<{ specialMultiplier: number; regionalDifficulty: number } | null>(null)
  const [oreVeinColumn, setOreVeinColumn] = useState<OreVeinColumn | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [shareLinkTarget, setShareLinkTarget] = useState<{ x: number; z: number } | null>(null)
  const biomeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const blockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const heightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const oreVeinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dimensionRef = useRef(state.dimension)
  dimensionRef.current = state.dimension
  const rulerPlacementModeRef = useRef(state.rulerPlacementMode)
  rulerPlacementModeRef.current = state.rulerPlacementMode
  const structureCopyPanelOpenRef = useRef(state.structureCopyPanelOpen)
  structureCopyPanelOpenRef.current = state.structureCopyPanelOpen
  const structureCopyModeRef = useRef(state.structureCopyMode)
  structureCopyModeRef.current = state.structureCopyMode
  const structureCopyPlacingDestRef = useRef(state.structureCopyPlacingDest)
  structureCopyPlacingDestRef.current = state.structureCopyPlacingDest
  const structureCopyBoxAnchorRef = useRef(state.structureCopyBoxAnchor)
  structureCopyBoxAnchorRef.current = state.structureCopyBoxAnchor
  const structureCopyPlacingBoxDestRef = useRef(state.structureCopyPlacingBoxDest)
  structureCopyPlacingBoxDestRef.current = state.structureCopyPlacingBoxDest
  const pendingCoordsRef = useRef<{ x: number; z: number } | null>(null)
  const coordsRafRef = useRef<number | null>(null)
  // Live anchor->cursor preview while box mode's second corner is pending —
  // local state (not dispatched) since mousemove fires far more often than
  // Redux-style state should churn; only StructureCopySelectionLayer reads it.
  const [boxHoverPos, setBoxHoverPos] = useState<[number, number] | null>(null)
  // Cursor position while placing a structure-copy destination (chunk-mode's
  // "Place destination on map" / box-and-template's "Place destination X/Z on
  // map") — local for the same reason as boxHoverPos. Feeds StructureCopyGhostLayer.
  const [destHoverPos, setDestHoverPos] = useState<[number, number] | null>(null)

  // Cave-mode elastic zoom: refs so the always-registered zoomend bounce
  // listener (below) can read current cave state without closing over stale
  // values or needing to re-register per state change.
  const caveModeRef = useRef(state.caveMode)
  const wasCaveModeRef = useRef(state.caveMode)
  const caveRangeRef = useRef<[number, number]>([MIN_ZOOM, MAX_ZOOM])
  const caveBounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearCaveBounceTimer = () => {
    if (caveBounceTimerRef.current != null) { clearTimeout(caveBounceTimerRef.current); caveBounceTimerRef.current = null }
  }

  // Error banner — local copy with auto-dismiss
  const [localError, setLocalError] = useState<string | null>(null)
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!state.error) return
    setLocalError(state.error)
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
    errorTimerRef.current = setTimeout(() => {
      setLocalError(null)
      dispatch({ type: 'SET_ERROR', error: null })
    }, 8000)
    return () => { if (errorTimerRef.current) clearTimeout(errorTimerRef.current) }
  }, [state.error])

  const dismissError = () => {
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
    setLocalError(null)
    dispatch({ type: 'SET_ERROR', error: null })
  }

  const isBedrockWorld = state.seedData?.edition === 'bedrock'
  const edition = state.seedData?.edition ?? 'java'
  // Structures panel, region mode: force Chunk Data's low-zoom outline view at
  // every zoom (see GeneratedRegionsLayer). Chunk and box mode instead want
  // full detail plus the chunk grid line overlay for click precision.
  const forceRegionOutline = state.structureCopyPanelOpen && state.structureCopyMode === 'region'
  const forceChunkGrid = state.structureCopyPanelOpen && (state.structureCopyMode === 'chunk' || state.structureCopyMode === 'box')

  // Debounced biome lookup on hover — uses biomeMode so surface/underground each show their own biomes
  useEffect(() => {
    if (!mouseCoords || generatorSlot == null || isBedrockWorld) { setBiomeName(null); return }
    setBiomeName(null)
    if (biomeTimerRef.current) clearTimeout(biomeTimerRef.current)
    const slot = generatorSlot
    const mode = state.dimension === 'overworld' ? state.biomeMode : state.dimension
    const { seedBig, dimId, worldFlags, mcVersion } = generatorConfig
    biomeTimerRef.current = setTimeout(async () => {
      try {
        const id = await api.getHoverBiome(slot, seedBig, dimId, worldFlags, mcVersion, mouseCoords.x, mouseCoords.z, mode)
        setBiomeName(BIOME_NAMES[id] ?? null)
      } catch { setBiomeName(null) }
    }, 80)
    return () => { if (biomeTimerRef.current) clearTimeout(biomeTimerRef.current) }
  }, [mouseCoords, generatorSlot, state.dimension, state.biomeMode, generatorConfig])

  // Debounced ore-vein hover lookup — a real per-block probe at the exact hovered column,
  // only meaningful at block-level zoom (same gate as real-block lookup). Overworld, 1.18+.
  useEffect(() => {
    if (oreVeinTimerRef.current) clearTimeout(oreVeinTimerRef.current)
    if (!mouseCoords || !state.showOreVeins || state.dimension !== 'overworld' || state.zoom <= 6
        || generatorSlot == null || generatorConfig.mcVersion < MC_VERSIONS['MC_1_18']) {
      setOreVeinColumn(null); return
    }
    const slot = generatorSlot
    const { x, z } = mouseCoords
    const { seedBig, dimId, worldFlags, mcVersion } = generatorConfig
    oreVeinTimerRef.current = setTimeout(async () => {
      try {
        const result = await api.getOreVeinColumnAt(slot, seedBig, dimId, worldFlags, mcVersion, x, z)
        setOreVeinColumn(result)
      } catch { setOreVeinColumn(null) }
    }, 80)
    return () => { if (oreVeinTimerRef.current) clearTimeout(oreVeinTimerRef.current) }
  }, [mouseCoords, state.showOreVeins, state.dimension, state.zoom, generatorSlot, generatorConfig])

  // Debounced chunk lookup on hover.
  // Always fetches when worldDir is set: blockName (zoom > 6), terrainY (always), difficulty (when enabled).
  useEffect(() => {
    if (blockTimerRef.current) clearTimeout(blockTimerRef.current)
    if (!mouseCoords || !state.worldDir) {
      setBlockName(null)
      setChunkDataVersion(null)
      setTerrainY(null)
      setLocalDifficulty(null)
      return
    }
    const showBlockName  = state.zoom > 6
    const showDifficulty = state.showLocalDifficulty
    const caveY = effectiveCaveAnchorY(state, state.seedData?.playerY)
    const seedData = state.seedData
    blockTimerRef.current = setTimeout(async () => {
      try {
        const info = await api.getBlockAt(
          state.worldDir!, edition, state.dimension, state.hideWater, caveY,
          state.caveScanLow, state.caveScanHigh,
          mouseCoords.x, mouseCoords.z,
          showDifficulty ? (seedData?.difficulty ?? undefined) : undefined,
          showDifficulty ? (seedData?.worldTime  ?? undefined) : undefined,
        )
        setBlockName(showBlockName ? (info?.blockName ?? null) : null)
        setChunkDataVersion(showBlockName ? (info?.dataVersion ?? null) : null)
        // Unexplored region → no chunk Y; fall back to the cubiomes height
        // estimate (Java overworld only — cubiomes heights are wrong for Bedrock).
        // Not in cave mode: a surface height is not the cave-scan Y.
        let y = info?.blockY ?? null
        if (y == null && caveY == null && !isBedrockWorld && state.dimension === 'overworld' && generatorSlot != null) {
          try {
            const { seedBig, dimId, worldFlags, mcVersion } = generatorConfig
            const heights = await api.getHeightRegion(
              generatorSlot, seedBig, dimId, worldFlags, mcVersion,
              Math.floor(mouseCoords.x / 4), Math.floor(mouseCoords.z / 4),
              1, 1,
            )
            const h = heights?.[0]
            y = (h != null && isFinite(h)) ? Math.round(h) : null
          } catch { /* keep null */ }
        }
        setTerrainY(y)
        if (showDifficulty && info?.specialMultiplier != null && info?.regionalDifficulty != null) {
          setLocalDifficulty({ specialMultiplier: info.specialMultiplier, regionalDifficulty: info.regionalDifficulty })
        } else {
          setLocalDifficulty(null)
        }
      } catch {
        setBlockName(null)
        setTerrainY(null)
        setLocalDifficulty(null)
      }
    }, 120)
    return () => { if (blockTimerRef.current) clearTimeout(blockTimerRef.current) }
  }, [mouseCoords, state.worldDir, state.dimension, state.hideWater, state.caveMode, state.caveLockedToPlayer, state.caveAnchorY, state.seedData?.playerY, state.zoom, state.caveScanLow, state.caveScanHigh, state.seedData?.difficulty, state.seedData?.worldTime, state.showLocalDifficulty, isBedrockWorld, generatorSlot, generatorConfig])

  // Cubiomes height fallback — used when no worldDir (seed-only mode), overworld only.
  useEffect(() => {
    if (heightTimerRef.current) clearTimeout(heightTimerRef.current)
    if (state.worldDir || !mouseCoords || generatorSlot == null || state.dimension !== 'overworld') {
      // If worldDir is set, the block-lookup effect handles terrainY above.
      // Only clear if we own the terrainY slot (no worldDir).
      if (!state.worldDir) setTerrainY(null)
      return
    }
    heightTimerRef.current = setTimeout(async () => {
      try {
        const { seedBig, dimId, worldFlags, mcVersion } = generatorConfig
        const heights = await api.getHeightRegion(
          generatorSlot, seedBig, dimId, worldFlags, mcVersion,
          Math.floor(mouseCoords.x / 4), Math.floor(mouseCoords.z / 4),
          1, 1,
        )
        const h = heights[0]
        setTerrainY((h != null && isFinite(h)) ? Math.round(h) : null)
      } catch { setTerrainY(null) }
    }, 100)
    return () => { if (heightTimerRef.current) clearTimeout(heightTimerRef.current) }
  }, [mouseCoords, state.worldDir, generatorSlot, state.dimension, generatorConfig])

  // Initialize Leaflet map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const leafletMap = L.map(containerRef.current, {
      crs: L.CRS.Simple,
      zoom: state.zoom,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      center: [0, 0],
      zoomControl: false,
      attributionControl: true,
      // Leaflet's default (40ms) only coalesces wheel ticks that land within one
      // frame of each other — a real scroll-wheel spin (or our own rapid-zoom
      // repro) spaces ticks wider than that, so each one still lands its own
      // zoomend and fetches a full viewport of tiles for a level abandoned a
      // moment later. A longer window coalesces a whole spin into the one zoom
      // level it actually settles on, instead of rendering-then-discarding every
      // level passed through on the way there.
      wheelDebounceTime: 200,
    })

    // Mouse coordinate tracking — rAF-throttled so React re-renders at most once per frame
    leafletMap.on('mousemove', (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng
      const { x, z } = leafletToMinecraft(lng, lat)
      // A block owns the continuous interval [n, n+1) — floor, not round, is
      // the correct "block under the cursor" (round shifts the reported
      // block to the right/down for the far half of every block's footprint,
      // invisible at low zoom but glaring once a block spans many pixels).
      pendingCoordsRef.current = { x: Math.floor(x), z: Math.floor(z) }
      if (coordsRafRef.current === null) {
        coordsRafRef.current = requestAnimationFrame(() => {
          coordsRafRef.current = null
          if (pendingCoordsRef.current) setMouseCoords(pendingCoordsRef.current)
        })
      }
    })

    leafletMap.on('mouseout', () => {
      if (coordsRafRef.current !== null) { cancelAnimationFrame(coordsRafRef.current); coordsRafRef.current = null }
      pendingCoordsRef.current = null
      setMouseCoords(null); setBiomeName(null); setBlockName(null); setTerrainY(null); setLocalDifficulty(null); setOreVeinColumn(null)
    })

    leafletMap.on('zoomend', () => {
      dispatch({ type: 'SET_ZOOM', zoom: leafletMap.getZoom() })
    })

    // Click: ruler waypoint when active, otherwise Ctrl+click drops a pin
    leafletMap.on('click', (e: L.LeafletMouseEvent) => {
      const { x: rawXf, z: rawZf } = leafletToMinecraft(e.latlng.lng, e.latlng.lat)
      const rawX = Math.floor(rawXf)
      const rawZ = Math.floor(rawZf)
      if (rulerPlacementModeRef.current) {
        dispatch({ type: 'RULER_ADD_WAYPOINT', x: rawX, z: rawZ })
        return
      }
      if (structureCopyPlacingDestRef.current) {
        dispatch({ type: 'SET_STRUCTURE_COPY_DEST_CHUNK', dest: [rawX >> 4, rawZ >> 4] })
        return
      }
      if (structureCopyPlacingBoxDestRef.current) {
        dispatch({ type: 'SET_STRUCTURE_COPY_BOX_DEST_XZ', x: rawX, z: rawZ })
        return
      }
      if (structureCopyPanelOpenRef.current) {
        if (structureCopyModeRef.current === 'chunk') {
          dispatch({ type: 'TOGGLE_STRUCTURE_COPY_CHUNK', cx: rawX >> 4, cz: rawZ >> 4 })
        } else if (structureCopyModeRef.current === 'box') {
          // Two-click box: first click drops the anchor corner, second
          // finalizes the selection (normalized so x0<=x1, z0<=z1) — avoids
          // fighting Leaflet's own pan/drag handling, matching this
          // codebase's click-based (not drag-based) selection style
          // everywhere else.
          const anchor = structureCopyBoxAnchorRef.current
          if (anchor == null) {
            dispatch({ type: 'SET_STRUCTURE_COPY_BOX_ANCHOR', anchor: [rawX, rawZ] })
          } else {
            const [ax, az] = anchor
            dispatch({
              type: 'SET_STRUCTURE_COPY_BOX_SELECTION',
              selection: { x0: Math.min(ax, rawX), z0: Math.min(az, rawZ), x1: Math.max(ax, rawX), z1: Math.max(az, rawZ) },
            })
            setBoxHoverPos(null)
          }
        } else {
          dispatch({ type: 'TOGGLE_STRUCTURE_COPY_REGION', rx: Math.floor(rawX / 512), rz: Math.floor(rawZ / 512) })
        }
        return
      }
      if (!e.originalEvent.ctrlKey) return
      dispatch({ type: 'ADD_PIN', pin: makePin(rawX, rawZ, dimensionRef.current) })
    })

    // Right-click → context menu
    leafletMap.on('contextmenu', (e: L.LeafletMouseEvent) => {
      e.originalEvent.preventDefault()
      const { x: blockXf, z: blockZf } = leafletToMinecraft(e.latlng.lng, e.latlng.lat)
      const blockX = Math.floor(blockXf)
      const blockZ = Math.floor(blockZf)
      setContextMenu({
        screenX: e.originalEvent.clientX,
        screenY: e.originalEvent.clientY,
        blockX,
        blockZ,
      })
    })

    mapRef.current = leafletMap
    setMap(leafletMap)

    // Leaflet caches its container size at init and never re-measures — a rail flyout or
    // window resize changes the container width, but growing leaves the newly-revealed
    // strip permanently blank since Leaflet never requests tiles for space it doesn't
    // know exists (shrinking is harmless: it just clips the already-rendered overflow).
    const resizeObserver = new ResizeObserver(() => { leafletMap.invalidateSize() })
    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
      mapRef.current = null
      leafletMap.remove()
    }
  }, [])

  // Box mode's live anchor->cursor preview rectangle: only listens while a box-mode
  // anchor is pending, torn down once the selection finalizes or the mode changes away.
  useEffect(() => {
    if (!map || !state.structureCopyBoxAnchor) {
      setBoxHoverPos(null)
      return
    }
    const onMove = (e: L.LeafletMouseEvent) => {
      const { x, z } = leafletToMinecraft(e.latlng.lng, e.latlng.lat)
      setBoxHoverPos([Math.floor(x), Math.floor(z)])
    }
    map.on('mousemove', onMove)
    return () => { map.off('mousemove', onMove) }
  }, [map, state.structureCopyBoxAnchor])

  // Destination-placement ghost cursor: chunk mode snaps to whole-chunk
  // boundaries (matches the click dispatch's `rawX >> 4` chunk-granularity),
  // box/template track the raw block position (matches `SET_STRUCTURE_COPY_BOX_DEST_XZ`).
  useEffect(() => {
    if (!map || (!state.structureCopyPlacingDest && !state.structureCopyPlacingBoxDest)) {
      setDestHoverPos(null)
      return
    }
    const chunkSnap = state.structureCopyPlacingDest
    const onMove = (e: L.LeafletMouseEvent) => {
      const { x, z } = leafletToMinecraft(e.latlng.lng, e.latlng.lat)
      const bx = Math.floor(x)
      const bz = Math.floor(z)
      setDestHoverPos(chunkSnap ? [(bx >> 4) << 4, (bz >> 4) << 4] : [bx, bz])
    }
    map.on('mousemove', onMove)
    return () => { map.off('mousemove', onMove) }
  }, [map, state.structureCopyPlacingDest, state.structureCopyPlacingBoxDest])

  // Fit to a 32×32 chunk view centered on spawn when seed changes — unless a static-export
  // share link (?x=&z=&zoom=&dim=&filters=, see shareLink.ts) asked for a specific view.
  useEffect(() => {
    if (!map || !state.seedData) return

    if (api.IS_STATIC_SITE) {
      const link = parseShareLink()
      if (link && (link.dimension === 'overworld' || link.dimension === 'nether' || link.dimension === 'end')) {
        if (link.dimension !== state.dimension) {
          dispatch({ type: 'SET_DIMENSION', dimension: link.dimension })
        }
        if (link.filters) {
          dispatch({ type: 'APPLY_SHARE_LINK_FILTERS', filters: link.filters })
        }
        const { x: lng, y: lat } = minecraftToLeaflet(link.x, link.z)
        map.setView(L.latLng(lat, lng), link.zoom, { animate: false })
        clearShareLinkFromUrl()
        return
      }
    }

    const { spawnX, spawnZ } = state.seedData
    const halfBlocks = 256  // 16 chunks on each side = 32 chunks total
    const toLL = (bx: number, bz: number) => {
      const { x, y } = minecraftToLeaflet(bx, bz)
      return L.latLng(y, x)
    }
    const bounds = L.latLngBounds(
      toLL(spawnX - halfBlocks, spawnZ - halfBlocks),
      toLL(spawnX + halfBlocks, spawnZ + halfBlocks)
    )
    map.fitBounds(bounds, { animate: false, padding: [0, 0] })
  }, [state.seedData?.seed, map])

  // Cave mode: track the dimension's cave zoom range, and snap immediately if entering
  // cave mode (a deliberate mode-entry action) leaves the zoom out of range. Leaflet's
  // own min/max stay at the global MIN_ZOOM/MAX_ZOOM — gesture-driven zoom is never
  // hard-blocked, only bounced back after it settles out of range (spring, not a wall).
  useEffect(() => {
    if (!map) return
    const range = caveZoomRange(state, state.dimension)
    caveRangeRef.current = range
    caveModeRef.current = state.caveMode
    clearCaveBounceTimer()
    if (!state.caveMode) { wasCaveModeRef.current = false; return }
    const justEntered = !wasCaveModeRef.current
    wasCaveModeRef.current = true
    const [caveMin, caveMax] = range
    const currentZoom = map.getZoom()
    const targetZoom = (currentZoom < caveMin || currentZoom > caveMax)
      ? Math.max(caveMin, Math.min(caveMax, CAVE_MODE_ZOOM)) : currentZoom
    // Only fly to the player on the false→true edge, so it doesn't fight the user's
    // manual pan on every later dimension/threshold change while already in cave mode.
    const { playerX, playerZ } = state.seedData ?? {}
    if (justEntered && playerX != null && playerZ != null) {
      const { x: lng, y: lat } = minecraftToLeaflet(playerX, playerZ)
      map.flyTo(L.latLng(lat, lng), targetZoom)
    } else if (targetZoom !== currentZoom) {
      map.setZoom(targetZoom)
    }
  }, [map, state.caveMode, state.dimension, state.caveZoomMinOverworld, state.caveZoomMinNether])

  // Cave mode: bounce back to the cave range once a gesture-driven zoom settles outside
  // it. Registered once for the map's lifetime (not per cave-mode toggle); reads current
  // cave state via the refs kept fresh by the effect above.
  useEffect(() => {
    if (!map) return
    const onZoomEnd = () => {
      clearCaveBounceTimer()
      if (!caveModeRef.current) return
      const [caveMin, caveMax] = caveRangeRef.current
      const z = map.getZoom()
      if (z >= caveMin && z <= caveMax) return
      caveBounceTimerRef.current = setTimeout(() => {
        caveBounceTimerRef.current = null
        if (!caveModeRef.current) return
        const [minNow, maxNow] = caveRangeRef.current
        const zNow = map.getZoom()
        if (zNow >= minNow && zNow <= maxNow) return
        map.setZoom(Math.max(minNow, Math.min(maxNow, zNow)), { animate: true })
      }, CAVE_BOUNCE_SETTLE_MS)
    }
    map.on('zoomend', onZoomEnd)
    return () => { map.off('zoomend', onZoomEnd); clearCaveBounceTimer() }
  }, [map])

  // Cave mode: pointer cursor for block identification
  useEffect(() => {
    if (!map) return
    const container = map.getContainer()
    if (state.caveMode) {
      container.classList.add('cave-mode-active')
    } else {
      container.classList.remove('cave-mode-active')
    }
  }, [map, state.caveMode])

  // Ruler placement mode: crosshair cursor — only while clicks actually add a point.
  // Viewing/selecting a route shouldn't visually invite a click that wouldn't do that.
  useEffect(() => {
    if (!map) return
    const container = map.getContainer()
    if (state.rulerPlacementMode) {
      container.classList.add('ruler-mode-active')
    } else {
      container.classList.remove('ruler-mode-active')
    }
  }, [map, state.rulerPlacementMode])

  // Ruler mode: Escape undoes last waypoint while actively placing, else closes the panel.
  useEffect(() => {
    if (!state.rulerActive) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      if (state.rulerPlacementMode && state.rulerWaypoints.length > 0) {
        dispatch({ type: 'RULER_UNDO' })
      } else {
        dispatch({ type: 'RULER_TOGGLE' })
      }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [state.rulerActive, state.rulerPlacementMode, state.rulerWaypoints.length])

  // Resolve terrain Y for a background context-menu click.
  // Runs whenever a new background menu opens (no markerKind, blockY still undefined).
  useEffect(() => {
    if (!contextMenu || contextMenu.markerKind != null || contextMenu.blockY !== undefined) return
    const { blockX, blockZ } = contextMenu
    let cancelled = false

    ;(async () => {
      let y: number | null = null
      if (state.worldDir) {
        // Primary: exact surface Y from MCA chunk data
        try {
          const caveY = effectiveCaveAnchorY(state, state.seedData?.playerY)
          const info = await api.getBlockAt(
            state.worldDir, edition, state.dimension, state.hideWater, caveY,
            state.caveScanLow, state.caveScanHigh, blockX, blockZ,
          )
          y = info?.blockY ?? null
        } catch { /* ignore */ }
      } else if (generatorSlot != null && state.dimension === 'overworld') {
        // Fallback: cubiomes approximate height (4-block grid, overworld only)
        try {
          const { seedBig, dimId, worldFlags, mcVersion } = generatorConfig
          const heights = await api.getHeightRegion(
            generatorSlot, seedBig, dimId, worldFlags, mcVersion,
            Math.floor(blockX / 4), Math.floor(blockZ / 4), 1, 1,
          )
          const h = heights[0]
          y = (h != null && isFinite(h)) ? Math.round(h) : null
        } catch { /* ignore */ }
      }
      if (!cancelled) {
        setContextMenu(prev =>
          prev && prev.blockX === blockX && prev.blockZ === blockZ && !prev.markerKind
            ? { ...prev, blockY: y }
            : prev
        )
      }
    })()

    return () => { cancelled = true }
  }, [contextMenu?.blockX, contextMenu?.blockZ, contextMenu?.markerKind])

  // Context-menu actions
  const handleCtxAddPin = (x: number, z: number) => {
    dispatch({ type: 'ADD_PIN', pin: makePin(x, z, state.dimension) })
  }

  const handleCtxCenter = (x: number, z: number) => {
    if (!map) return
    const { x: lng, y: lat } = minecraftToLeaflet(x, z)
    map.flyTo(L.latLng(lat, lng), map.getZoom())
  }

  const handleCtxCopyLink = (x: number, z: number) => {
    setShareLinkTarget({ x, z })
  }

  const handleCtxStartRoute = (x: number, z: number) => {
    dispatch({ type: 'RULER_NEW' })
    dispatch({ type: 'RULER_ADD_WAYPOINT', x, z })
  }

  const handleCtxAddRoutePoint = (x: number, z: number) => {
    dispatch({ type: 'RULER_START_EDITING' })
    dispatch({ type: 'RULER_ADD_WAYPOINT', x, z })
  }

  const handleDeletePin = (id: string) => {
    dispatch({ type: 'REMOVE_PIN', id })
  }

  // "Pin best nearby" — searches a 9×9 chunk area (±4 from click) for the column with the
  // most vein-affected blocks, using the same real per-column data the Footprint overlay
  // renders from, rather than a coarse density sample.
  const handlePinBestVein = async (ore: 'copper' | 'iron', blockX: number, blockZ: number) => {
    if (!state.seedData || generatorSlot == null) return
    const R   = 4
    const cx0 = (blockX >> 4) - R, cz0 = (blockZ >> 4) - R
    const cx1 = (blockX >> 4) + R, cz1 = (blockZ >> 4) + R
    const { seedBig, dimId, worldFlags, mcVersion } = generatorConfig
    try {
      const data = await api.getOreVeinColumns(generatorSlot, seedBig, dimId, worldFlags, mcVersion, cx0, cz0, cx1, cz1)
      const nx = data[0], nz = data[1]
      if (nx <= 0 || nz <= 0) return
      let best = 0, bestX = blockX, bestZ = blockZ
      for (let cz = 0; cz < nz; cz++) {
        for (let cx = 0; cx < nx; cx++) {
          const chunkBase = 2 + (cz * nx + cx) * 512
          for (let col = 0; col < 256; col++) {
            const count = ore === 'copper' ? data[chunkBase + col * 2] : data[chunkBase + col * 2 + 1]
            if (count > best) {
              best = count
              bestX = (cx0 + cx) * 16 + (col % 16)
              bestZ = (cz0 + cz) * 16 + Math.floor(col / 16)
            }
          }
        }
      }
      if (best === 0) return
      const oreName = ore === 'copper' ? 'Copper' : 'Iron'
      const pin = makePin(bestX, bestZ, state.dimension)
      dispatch({ type: 'ADD_PIN', pin: { ...pin, label: `${oreName} vein (${best} blocks)` } })
    } catch { /* ignore */ }
  }

  // Subscribe to marker contextmenu events emitted by layer components
  useEffect(() => {
    setMarkerMenuHandler((opts) => {
      setContextMenu({
        screenX:     opts.screenX,
        screenY:     opts.screenY,
        blockX:      opts.blockX,
        blockZ:      opts.blockZ,
        blockY:      opts.blockY,
        markerKind:  opts.kind,
        pinId:       opts.pinId,
        markerLabel: opts.label,
      })
    })
    return () => setMarkerMenuHandler(null)
  }, [])

  const chunkX = mouseCoords ? mouseCoords.x >> 4 : null
  const chunkZ = mouseCoords ? mouseCoords.z >> 4 : null
  const [slimeChunkResult, setSlimeChunkResult] = useState<boolean | null>(null)
  useEffect(() => {
    if (chunkX == null || chunkZ == null || !state.showSlimeChunks || state.dimension !== 'overworld' || !state.seedData) {
      setSlimeChunkResult(null)
      return
    }
    const seed = BigInt(state.seedData.seed)
    api.isSlimeChunk(seed, chunkX, chunkZ).then(setSlimeChunkResult).catch(() => setSlimeChunkResult(null))
  }, [chunkX, chunkZ, state.showSlimeChunks, state.dimension, state.seedData?.seed])

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <MapToolbar />
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
        {map && (
          <>
            {state.showBiomes && !isBedrockWorld && <BiomeTileLayer map={map} unlimitedCache={state.unlimitedCache} />}
            {/* Low-zoom face of the Chunk Data layer: ghosted bounding boxes of
                explored regions until the zoom threshold, real tiles after. */}
            {state.worldDir && state.showChunkData && <GeneratedRegionsLayer map={map} />}
            {state.showChunkData && state.worldDir && !forceRegionOutline && (state.dimension === 'overworld' || state.dimension === 'end' || (state.dimension === 'nether' && state.caveMode)) && <ChunkOverlayLayer map={map} unlimitedCache={state.unlimitedCache} />}
            {/* Structures (dev-only region/chunk-copy) panel: region mode forces
                full chunk detail off above (GeneratedRegionsLayer's outline view
                takes over at every zoom instead — see its own mode check), chunk
                mode instead wants full detail + the chunk grid (below) for click
                precision. Either way, the current selection gets a highlight. */}
            {state.worldDir && state.structureCopyPanelOpen &&
              ((state.structureCopyMode === 'region' && state.structureCopySelectedRegions.length > 0) ||
               (state.structureCopyMode === 'chunk' && state.structureCopySelectedChunks.length > 0) ||
               (state.structureCopyMode === 'box' && (state.structureCopyBoxAnchor != null || state.structureCopyBoxSelection != null))) &&
              <StructureCopySelectionLayer map={map} boxHoverPos={boxHoverPos} />}
            {state.structureCopyPreview && (state.structureCopyPlacingDest || state.structureCopyPlacingBoxDest) && (
              <StructureCopyGhostLayer
                map={map}
                preview={state.structureCopyPreview}
                anchor={destHoverPos}
                rotation={state.structureCopyRotation}
                mirror={state.structureCopyMirror}
              />
            )}
            {(state.showChunkGrid || state.showRegionGrid || forceChunkGrid) && (
              <ChunkGridLayer
                map={map}
                showChunkGrid={state.showChunkGrid || forceChunkGrid}
                showRegionGrid={state.showRegionGrid}
              />
            )}
            {state.showSpawnChunks && <SpawnChunksLayer map={map} />}
            {state.showWorldBorder && <WorldBorderLayer map={map} />}
            {state.showSlimeChunks && !isBedrockWorld && state.dimension === 'overworld' && (
              <SlimeChunkLayer map={map} />
            )}
            {state.showOreVeins && !isBedrockWorld && state.dimension === 'overworld' && generatorSlot != null && (
              <OreVeinLayer map={map} slot={generatorSlot} />
            )}
            {state.showOreFeatures && !isBedrockWorld && state.dimension !== 'end' && generatorSlot != null && (
              <OreFeatureLayer map={map} slot={generatorSlot} />
            )}
            {state.showCarvers && !isBedrockWorld && state.dimension !== 'end' && generatorSlot != null && (
              <CarverLayer map={map} slot={generatorSlot} />
            )}
            {state.showLocalDifficulty && state.worldDir && (
              <LocalDifficultyLayer map={map} />
            )}
            {!isBedrockWorld && <StructureLayer map={map} slot={generatorSlot} />}
            {state.showMarkers && state.worldDir && state.zoom >= state.markerMinZoom && <BlockEntityLayer map={map} />}
            {state.showMarkers && state.worldDir && state.zoom >= state.markerMinZoom && <EntityLayer map={map} />}
            {state.showMarkers && state.worldDir && state.zoom >= state.markerMinZoom && <PoiLayer map={map} />}
            <SpawnMarker map={map} />
            <PlayerRespawnMarker map={map} />
            <PlayerMarker map={map} />
            <PinLayer map={map} />
            <SavedRoutesLayer map={map} />
            {state.rulerActive && <RulerLayer map={map} mouseCoords={mouseCoords} />}
          </>
        )}
        <TileLoadingHud />
        <DebugOverlay />
        <RulerPanel />
        <CaveMapControls />
        <CursorInfoBar
          coords={mouseCoords}
          biomeName={biomeName}
          blockName={blockName}
          terrainY={terrainY}
          caveY={effectiveCaveAnchorY(state, state.seedData?.playerY)}
          slimeChunk={slimeChunkResult}
          localDifficulty={localDifficulty}
          oreVein={oreVeinColumn}
          dataVersion={chunkDataVersion}
        />
        {localError && (
          <div className="error-banner">
            <span>{localError}</span>
            <button className="error-dismiss" onClick={dismissError}>✕</button>
          </div>
        )}
        {contextMenu && (
          <MapContextMenu
            {...contextMenu}
            dimension={state.dimension}
            onAddPin={handleCtxAddPin}
            onDeletePin={handleDeletePin}
            onCenter={handleCtxCenter}
            onCopyLink={handleCtxCopyLink}
            onStartRoute={handleCtxStartRoute}
            onAddRoutePoint={
              !contextMenu.markerKind && state.rulerActive && !state.rulerPlacementMode && state.rulerWaypoints.length > 0
                ? () => handleCtxAddRoutePoint(contextMenu.blockX, contextMenu.blockZ)
                : undefined
            }
            onPinBestCopper={
              !contextMenu.markerKind && state.showOreVeins && state.showCopperVeins && state.seedData
                ? () => handlePinBestVein('copper', contextMenu.blockX, contextMenu.blockZ)
                : undefined
            }
            onPinBestIron={
              !contextMenu.markerKind && state.showOreVeins && state.showIronVeins && state.seedData
                ? () => handlePinBestVein('iron', contextMenu.blockX, contextMenu.blockZ)
                : undefined
            }
            onClose={() => setContextMenu(null)}
          />
        )}
        {shareLinkTarget && (
          <ShareLinkDialog
            x={shareLinkTarget.x}
            z={shareLinkTarget.z}
            dimension={state.dimension}
            zoom={state.zoom}
            onClose={() => setShareLinkTarget(null)}
          />
        )}

      </div>
    </div>
  )
}
