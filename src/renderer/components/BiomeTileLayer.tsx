import { memo, useEffect } from 'react'
import L from 'leaflet'
import { useApp } from '../App'
import * as tileStats from '../lib/tileStats'
import { BIOME_TILE_SIZE, MC_VERSIONS, MIN_ZOOM } from '../lib/constants'
import { TileJobQueue } from '../lib/tileJobQueue'
import * as api from '../lib/tauriAPI'
import { useTileLayer } from '../hooks/useTileLayer'

const surfaceCache     = new Map<string, ImageData | string>()
const undergroundCache = new Map<string, ImageData | string>()
const MAX_SURFACE_CACHE = 1600
const MAX_UG_CACHE      = 1600 // disk-cached PNG path now, cheap enough to match surface's cache size

const surfaceQueue     = new TileJobQueue(16, () => tileStats.notify(), 'biome/surface')
const undergroundQueue = new TileJobQueue(8,  () => tileStats.notify(), 'biome/underground')

export function getBiomeCacheSize() { return surfaceCache.size + undergroundCache.size }
export function clearBiomeCache() { surfaceCache.clear(); undergroundCache.clear() }

const combinedBiomeQueue = {
  get size() { return surfaceQueue.size + undergroundQueue.size },
  pause()  { surfaceQueue.pause();  undergroundQueue.pause()  },
  resume() { surfaceQueue.resume(); undergroundQueue.resume() },
}
export function getBiomeQueue() { return combinedBiomeQueue }

function BiomeTileLayer({ map, unlimitedCache = false }: { map: L.Map; unlimitedCache?: boolean }) {
  const { state, dispatch, generatorSlot, generatorConfig, availableLayers } = useApp()

  const seed      = state.seedData?.seed ?? null
  const dimension = state.dimension
  const version   = state.selectedVersion
  const worldType = state.worldType
  const opacity   = state.biomeOpacity
  const biomeMode = state.biomeMode
  const slot      = generatorSlot
  const { seedBig, worldFlags, mcVersion } = generatorConfig

  const is1_18 = mcVersion >= MC_VERSIONS['MC_1_18']
  const showUg = dimension === 'overworld' && is1_18
  // A persisted 'underground' choice can outlive a static export that never baked it.
  const ugAvailable = !api.IS_STATIC_SITE || availableLayers?.underground != null
  // Underground only applies overworld/1.18+; fall back to surface so the biome
  // layer doesn't go blank elsewhere (e.g. Nether) or when unavailable.
  const showSurface = biomeMode === 'surface' || !showUg || !ugAvailable

  // Also correct persisted state itself, so the toolbar/Layers panel don't keep
  // claiming "Underground" while the map silently shows Surface.
  useEffect(() => {
    if (biomeMode === 'underground' && showUg && !ugAvailable) {
      dispatch({ type: 'SET_BIOME_MODE', mode: 'surface' })
    }
  }, [biomeMode, showUg, ugAvailable, dispatch])

  useTileLayer({
    map,
    queue: surfaceQueue,
    tileSize: api.IS_STATIC_SITE ? (api.getTileSizes(dimension).biome ?? BIOME_TILE_SIZE) : BIOME_TILE_SIZE,
    opacity,
    zIndex: 1,
    layerOptions: { updateWhenIdle: true, updateWhenZooming: false, minZoom: MIN_ZOOM, minNativeZoom: 0 },
    deps: [map, generatorSlot, seed, dimension, version, worldType, state.tileCacheVersion, biomeMode],
    // biomeMode doesn't affect the fetched tile, so it's not an epoch dep; worldType
    // (large_biomes etc.) does change the pixels for the same seed+coords, so it must
    // wipe the cache like seed/version — otherwise stale tiles leak across world types.
    cacheEpochDeps: [seed, version, worldType, state.tileCacheVersion],
    enabled: seed != null && slot != null && showSurface,
    cache: surfaceCache as Map<string, ImageData | string>,
    maxCache: unlimitedCache ? Infinity : MAX_SURFACE_CACHE,
    cacheKeyFn: (coords) => `B:${seed}:${version}:${worldType}:${dimension}:${coords.x}:${coords.y}:${coords.z}`,
    fetch: async (coords) => {
      tileStats.biomeLoadingStart()
      const t0 = performance.now()
      const tile = await api.renderBiomeTile(slot!, seedBig, mcVersion, worldFlags, dimension, coords.x, coords.y, coords.z)
      tileStats.biomeLoadingSettle()
      if (tile) tileStats.biomeLoadingDone(Math.round(performance.now() - t0))
      // ?v=mtime busts WebKit's URL-keyed image cache — see RenderedTile's doc comment.
      return tile ? `${api.tileSrc(tile.path)}?v=${tile.mtime}` : null
    },
    onCleanup: tileStats.resetBiomeLoading,
    nativeZoom: 2,
  })

  const undergroundLayerRef = useTileLayer({
    map,
    queue: undergroundQueue,
    tileSize: api.IS_STATIC_SITE ? (api.getTileSizes(dimension).underground ?? BIOME_TILE_SIZE) : BIOME_TILE_SIZE,
    opacity,
    zIndex: 1,
    layerOptions: { updateWhenIdle: true, updateWhenZooming: false, minZoom: MIN_ZOOM, minNativeZoom: 0 },
    deps: [map, slot, seed, version, worldType, state.tileCacheVersion, biomeMode],
    // biomeMode only gates `enabled`, not the fetched content — see surface layer above.
    cacheEpochDeps: [seed, version, worldType, state.tileCacheVersion],
    enabled: seed != null && slot != null && showUg && biomeMode === 'underground' && ugAvailable,
    cache: undergroundCache,
    maxCache: MAX_UG_CACHE,
    cacheKeyFn: (coords) => `UG:${seed}:${version}:${worldType}:${coords.x}:${coords.y}:${coords.z}`,
    fetch: async (coords) => {
      tileStats.biomeLoadingStart()
      const t0 = performance.now()
      const tile = await api.renderUndergroundBiomeTile(slot!, seedBig, mcVersion, worldFlags, dimension, coords.x, coords.y, coords.z)
      tileStats.biomeLoadingSettle()
      if (tile) tileStats.biomeLoadingDone(Math.round(performance.now() - t0))
      return tile ? `${api.tileSrc(tile.path)}?v=${tile.mtime}` : null
    },
    onCleanup: tileStats.resetBiomeLoading,
    nativeZoom: 2,
  })

  useEffect(() => { undergroundLayerRef.current?.redraw() }, [biomeMode]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}
export default memo(BiomeTileLayer)
