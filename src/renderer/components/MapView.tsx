import React, { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { useApp } from '../App'
import * as api from '../lib/tauriAPI'
import { BASE_BLOCKS_PER_PIXEL, MIN_ZOOM, MAX_ZOOM, CAVE_MODE_ZOOM, CAVE_MODE_MIN_ZOOM, CAVE_MODE_MAX_ZOOM } from '../lib/constants'
import { minecraftToLeaflet } from '../lib/tileCoords'
import { BIOME_NAMES } from '../lib/biomeColors'

import CursorInfoBar from './CursorInfoBar'
import MapContextMenu, { type ContextMenuState } from './MapContextMenu'
import { setMarkerMenuHandler } from '../lib/contextMenuBus'
import BiomeTileLayer from './BiomeTileLayer'
import GeneratedRegionsLayer from './GeneratedRegionsLayer'
import ChunkOverlayLayer from './ChunkOverlayLayer'
import ChunkGridLayer from './ChunkGridLayer'
import SlimeChunkLayer from './SlimeChunkLayer'
import OreVeinLayer from './OreVeinLayer'
import OreFeatureLayer from './OreFeatureLayer'
import CarverLayer from './CarverLayer'
import TerrainLayer from './TerrainLayer'
import CaveEntranceLayer from './CaveEntranceLayer'
import LocalDifficultyLayer from './LocalDifficultyLayer'
import StructureLayer from './StructureLayer'
import SpawnMarker from './SpawnMarker'
import PlayerMarker from './PlayerMarker'
import PinLayer from './PinLayer'
import RulerLayer from './RulerLayer'
import RulerPanel from './RulerPanel'
import TileLoadingHud from './TileLoadingHud'
import DebugOverlay from './DebugOverlay'
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

export default function MapView() {
  const { state, dispatch, generatorSlot, mapRef } = useApp()
  const containerRef = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<L.Map | null>(null)
  const [mouseCoords, setMouseCoords] = useState<{ x: number; z: number } | null>(null)
  const [biomeName, setBiomeName] = useState<string | null>(null)
  const [blockName, setBlockName] = useState<string | null>(null)
  const [terrainY, setTerrainY] = useState<number | null>(null)
  const [oreVeinData, setOreVeinData] = useState<{ copperY: number | null; copperSize: number; ironY: number | null; ironSize: number } | null>(null)
  const [localDifficulty, setLocalDifficulty] = useState<{ specialMultiplier: number; regionalDifficulty: number } | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const biomeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const blockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const heightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const oreVeinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dimensionRef = useRef(state.dimension)
  dimensionRef.current = state.dimension
  const rulerActiveRef = useRef(state.rulerActive)
  rulerActiveRef.current = state.rulerActive
  const pendingCoordsRef = useRef<{ x: number; z: number } | null>(null)
  const coordsRafRef = useRef<number | null>(null)

  // Error banner — local copy with auto-dismiss
  const [localError, setLocalError] = useState<string | null>(null)
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!state.error) return
    setLocalError(state.error)
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
    errorTimerRef.current = setTimeout(() => {
      setLocalError(null)
      dispatch({ type: 'SET_ERROR', error: null } as never)
    }, 8000)
    return () => { if (errorTimerRef.current) clearTimeout(errorTimerRef.current) }
  }, [state.error])

  const dismissError = () => {
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
    setLocalError(null)
    dispatch({ type: 'SET_ERROR', error: null } as never)
  }

  const isBedrockWorld = state.seedData?.edition === 'bedrock'
  const edition = state.seedData?.edition ?? 'java'

  // Debounced biome lookup on hover — uses biomeMode so surface/cave/deep each show their own biomes
  useEffect(() => {
    if (!mouseCoords || generatorSlot == null || isBedrockWorld) { setBiomeName(null); return }
    setBiomeName(null)
    if (biomeTimerRef.current) clearTimeout(biomeTimerRef.current)
    const slot = generatorSlot
    const mode = state.dimension === 'overworld' ? state.biomeMode : state.dimension
    biomeTimerRef.current = setTimeout(async () => {
      try {
        const id = await api.getHoverBiome(slot, mouseCoords.x, mouseCoords.z, mode)
        setBiomeName(BIOME_NAMES[id] ?? null)
      } catch { setBiomeName(null) }
    }, 80)
    return () => { if (biomeTimerRef.current) clearTimeout(biomeTimerRef.current) }
  }, [mouseCoords, generatorSlot, state.dimension, state.biomeMode])

  // Debounced ore vein lookup on hover
  useEffect(() => {
    if (oreVeinTimerRef.current) clearTimeout(oreVeinTimerRef.current)
    if (!mouseCoords || !state.showOreVeins || state.dimension !== 'overworld' || !state.seedData) {
      setOreVeinData(null); return
    }
    const seed = BigInt(state.seedData.seed)
    const cx = mouseCoords.x >> 4
    const cz = mouseCoords.z >> 4
    oreVeinTimerRef.current = setTimeout(async () => {
      try {
        const result = await api.getOreVeinsAt(seed, cx, cz)
        setOreVeinData(result)
      } catch { setOreVeinData(null) }
    }, 80)
    return () => { if (oreVeinTimerRef.current) clearTimeout(oreVeinTimerRef.current) }
  }, [mouseCoords, state.showOreVeins, state.dimension, state.seedData?.seed])

  // Debounced chunk lookup on hover.
  // Always fetches when worldDir is set: blockName (zoom > 6), terrainY (always), difficulty (when enabled).
  useEffect(() => {
    if (blockTimerRef.current) clearTimeout(blockTimerRef.current)
    if (!mouseCoords || !state.worldDir) {
      setBlockName(null)
      setTerrainY(null)
      setLocalDifficulty(null)
      return
    }
    const showBlockName  = state.zoom > 6
    const showDifficulty = state.showLocalDifficulty
    const caveY = state.caveMode && state.seedData?.playerY != null
      ? Math.floor(state.seedData.playerY) : null
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
        setTerrainY(info?.blockY ?? null)
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
  }, [mouseCoords, state.worldDir, state.dimension, state.hideWater, state.caveMode, state.seedData?.playerY, state.zoom, state.caveScanLow, state.caveScanHigh, state.seedData?.difficulty, state.seedData?.worldTime, state.showLocalDifficulty])

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
        const heights = await api.getHeightRegion(
          generatorSlot,
          Math.floor(mouseCoords.x / 4), Math.floor(mouseCoords.z / 4),
          1, 1,
        )
        const h = heights[0]
        setTerrainY((h != null && isFinite(h)) ? Math.round(h) : null)
      } catch { setTerrainY(null) }
    }, 100)
    return () => { if (heightTimerRef.current) clearTimeout(heightTimerRef.current) }
  }, [mouseCoords, state.worldDir, generatorSlot, state.dimension])

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
      attributionControl: true
    })

    // Mouse coordinate tracking — rAF-throttled so React re-renders at most once per frame
    leafletMap.on('mousemove', (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng
      pendingCoordsRef.current = {
        x: Math.round(lng * BASE_BLOCKS_PER_PIXEL),
        z: Math.round(-lat * BASE_BLOCKS_PER_PIXEL),
      }
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
      setMouseCoords(null); setBiomeName(null); setBlockName(null); setTerrainY(null); setLocalDifficulty(null)
    })

    leafletMap.on('zoomend', () => {
      dispatch({ type: 'SET_ZOOM', zoom: leafletMap.getZoom() } as never)
    })

    // Click: ruler waypoint when active, otherwise Ctrl+click drops a pin
    leafletMap.on('click', (e: L.LeafletMouseEvent) => {
      const rawX = Math.round(e.latlng.lng * BASE_BLOCKS_PER_PIXEL)
      const rawZ = Math.round(-e.latlng.lat * BASE_BLOCKS_PER_PIXEL)
      if (rulerActiveRef.current) {
        dispatch({ type: 'RULER_ADD_WAYPOINT', x: rawX, z: rawZ } as never)
        return
      }
      if (!e.originalEvent.ctrlKey) return
      dispatch({ type: 'ADD_PIN', pin: makePin(rawX, rawZ, dimensionRef.current) } as never)
    })

    // Right-click → context menu
    leafletMap.on('contextmenu', (e: L.LeafletMouseEvent) => {
      e.originalEvent.preventDefault()
      const blockX = Math.round(e.latlng.lng * BASE_BLOCKS_PER_PIXEL)
      const blockZ = Math.round(-e.latlng.lat * BASE_BLOCKS_PER_PIXEL)
      setContextMenu({
        screenX: e.originalEvent.clientX,
        screenY: e.originalEvent.clientY,
        blockX,
        blockZ,
      })
    })

    mapRef.current = leafletMap
    setMap(leafletMap)

    return () => {
      mapRef.current = null
      leafletMap.remove()
    }
  }, [])

  // Fit to 32×32 chunk view centered on spawn when seed changes
  useEffect(() => {
    if (!map || !state.seedData) return
    const { spawnX, spawnZ } = state.seedData
    const halfBlocks = 256  // 16 chunks on each side = 32 chunks total
    const toLL = (bx: number, bz: number) =>
      L.latLng(-bz / BASE_BLOCKS_PER_PIXEL, bx / BASE_BLOCKS_PER_PIXEL)
    const bounds = L.latLngBounds(
      toLL(spawnX - halfBlocks, spawnZ - halfBlocks),
      toLL(spawnX + halfBlocks, spawnZ + halfBlocks)
    )
    map.fitBounds(bounds, { animate: false, padding: [0, 0] })
  }, [state.seedData?.seed, map])

  // Cave mode: restrict zoom to CAVE_MODE_MIN_ZOOM..CAVE_MODE_MAX_ZOOM and fly to player
  useEffect(() => {
    if (!map) return
    if (state.caveMode) {
      map.setMinZoom(CAVE_MODE_MIN_ZOOM)
      map.setMaxZoom(CAVE_MODE_MAX_ZOOM)
      const currentZoom = map.getZoom()
      const targetZoom = (currentZoom < CAVE_MODE_MIN_ZOOM || currentZoom > CAVE_MODE_MAX_ZOOM)
        ? CAVE_MODE_ZOOM : currentZoom
      const { playerX, playerZ } = state.seedData ?? {}
      if (playerX != null && playerZ != null) {
        const { x: lng, y: lat } = minecraftToLeaflet(playerX, playerZ)
        map.flyTo(L.latLng(lat, lng), targetZoom)
      } else if (targetZoom !== currentZoom) {
        map.setZoom(targetZoom)
      }
    } else {
      map.setMinZoom(MIN_ZOOM)
      map.setMaxZoom(MAX_ZOOM)
    }
  }, [map, state.caveMode, state.seedData?.playerX, state.seedData?.playerZ])

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

  // Ruler mode: crosshair cursor
  useEffect(() => {
    if (!map) return
    const container = map.getContainer()
    if (state.rulerActive) {
      container.classList.add('ruler-mode-active')
    } else {
      container.classList.remove('ruler-mode-active')
    }
  }, [map, state.rulerActive])

  // Ruler mode: Escape undoes last waypoint, or closes ruler if empty
  useEffect(() => {
    if (!state.rulerActive) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      if (state.rulerWaypoints.length > 0) {
        dispatch({ type: 'RULER_UNDO' } as never)
      } else {
        dispatch({ type: 'RULER_TOGGLE' } as never)
      }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [state.rulerActive, state.rulerWaypoints.length])

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
          const caveY = state.caveMode && state.seedData?.playerY != null
            ? Math.floor(state.seedData.playerY) : null
          const info = await api.getBlockAt(
            state.worldDir, edition, state.dimension, state.hideWater, caveY,
            state.caveScanLow, state.caveScanHigh, blockX, blockZ,
          )
          y = info?.blockY ?? null
        } catch { /* ignore */ }
      } else if (generatorSlot != null && state.dimension === 'overworld') {
        // Fallback: cubiomes approximate height (4-block grid, overworld only)
        try {
          const heights = await api.getHeightRegion(generatorSlot, Math.floor(blockX / 4), Math.floor(blockZ / 4), 1, 1)
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
    dispatch({ type: 'ADD_PIN', pin: makePin(x, z, state.dimension) } as never)
  }

  const handleCtxCenter = (x: number, z: number) => {
    if (!map) return
    const { x: lng, y: lat } = minecraftToLeaflet(x, z)
    map.panTo(L.latLng(lat, lng))
  }

  const handleDeletePin = (id: string) => {
    dispatch({ type: 'REMOVE_PIN', id } as never)
  }

  // Ore-vein "pin best nearby" — searches a 9×9 chunk area (±4 from click)
  const handlePinBestVein = async (ore: 'copper' | 'iron', blockX: number, blockZ: number) => {
    if (!state.seedData) return
    const seed = BigInt(state.seedData.seed)
    const R  = 4
    const cx = blockX >> 4
    const cz = blockZ >> 4
    try {
      const data = await api.getOreVeinsEx(seed, cx - R, cz - R, cx + R, cz + R)
      const W = 2 * R + 1
      let bestSize = 0, bestX = cx * 16 + 8, bestZ = cz * 16 + 8, bestY = 0
      for (let dz = 0; dz < W; dz++) {
        for (let dx = 0; dx < W; dx++) {
          const i    = (dz * W + dx) * 4
          const size = ore === 'copper' ? data[i + 1] : data[i + 3]
          const y    = ore === 'copper' ? data[i]     : data[i + 2]
          if (size > bestSize) {
            bestSize = size
            bestX    = (cx - R + dx) * 16 + 8
            bestZ    = (cz - R + dz) * 16 + 8
            bestY    = y
          }
        }
      }
      if (bestSize === 0) return
      const sizeLabel = ['', 'small', 'medium', 'large'][bestSize] ?? ''
      const oreName   = ore === 'copper' ? 'Copper' : 'Iron'
      const pin = makePin(bestX, bestZ, state.dimension)
      dispatch({ type: 'ADD_PIN', pin: { ...pin, label: `${oreName} vein (${sizeLabel}) Y=${bestY}` } } as never)
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
            {state.worldDir && <GeneratedRegionsLayer map={map} />}
            {state.showChunkData && state.worldDir && (state.dimension === 'overworld' || (state.dimension === 'nether' && state.caveMode)) && <ChunkOverlayLayer map={map} unlimitedCache={state.unlimitedCache} />}
            {(state.showChunkGrid || state.showRegionGrid) && (
              <ChunkGridLayer
                map={map}
                showChunkGrid={state.showChunkGrid}
                showRegionGrid={state.showRegionGrid}
              />
            )}
            {state.showSlimeChunks && !isBedrockWorld && state.dimension === 'overworld' && (
              <SlimeChunkLayer map={map} />
            )}
            {state.showOreVeins && !isBedrockWorld && state.dimension === 'overworld' && generatorSlot != null && (
              <OreVeinLayer map={map} slot={generatorSlot} />
            )}
            {state.showOreFeatures && !isBedrockWorld && state.dimension === 'overworld' && generatorSlot != null && (
              <OreFeatureLayer map={map} slot={generatorSlot} />
            )}
            {state.showTerrain && !isBedrockWorld && state.dimension === 'overworld' && generatorSlot != null && (
              <TerrainLayer map={map} slot={generatorSlot} />
            )}
            {state.showCarvers && !isBedrockWorld && state.dimension === 'overworld' && generatorSlot != null && (
              <CarverLayer map={map} slot={generatorSlot} />
            )}
            {state.showCaveEntrances && !isBedrockWorld && state.worldDir && state.dimension === 'overworld' && (
              <CaveEntranceLayer map={map} />
            )}
            {state.showLocalDifficulty && state.worldDir && (
              <LocalDifficultyLayer map={map} />
            )}
            {!isBedrockWorld && <StructureLayer map={map} slot={generatorSlot} />}
            {state.showMarkers && state.worldDir && <BlockEntityLayer map={map} />}
            {state.showMarkers && state.worldDir && <EntityLayer map={map} />}
            {state.showMarkers && state.worldDir && <PoiLayer map={map} />}
            <SpawnMarker map={map} />
            <PlayerMarker map={map} />
            <PinLayer map={map} />
            {state.rulerActive && <RulerLayer map={map} mouseCoords={mouseCoords} />}
          </>
        )}
        <TileLoadingHud />
        <DebugOverlay />
        <RulerPanel />
        <CursorInfoBar
          coords={mouseCoords}
          biomeName={biomeName}
          blockName={blockName}
          terrainY={terrainY}
          caveY={state.caveMode && state.seedData?.playerY != null ? Math.floor(state.seedData.playerY) : null}
          slimeChunk={slimeChunkResult}
          oreVeins={oreVeinData}
          localDifficulty={localDifficulty}
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

      </div>
    </div>
  )
}
