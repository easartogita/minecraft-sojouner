import { memo, useEffect, useRef } from 'react'
import L from 'leaflet'
import { convertFileSrc } from '@tauri-apps/api/core'
import { useApp } from '../App'
import * as tileStats from '../lib/tileStats'
import { BIOME_TILE_SIZE, TILE_SIZE, MC_VERSIONS, MIN_ZOOM } from '../lib/constants'
import { TileJobQueue } from '../lib/tileJobQueue'
import * as api from '../lib/tauriAPI'
import { useTileLayer } from '../hooks/useTileLayer'
import { postOverlay } from '../lib/overlayWorker'
import { tileToMinecraftRect } from '../lib/tileCoords'

// Block-Y levels for each underground mode (fixed, no slider)
const UNDERGROUND_BLOCK_Y = -32   // dripstone / lush caves
const DEEP_BLOCK_Y        = -52   // deep dark

const surfaceCache     = new Map<string, ImageData | string>()
const undergroundCache = new Map<string, ImageData>()
const deepCache        = new Map<string, ImageData>()
const MAX_SURFACE_CACHE = 1600
const MAX_UG_CACHE      = 800

const surfaceQueue     = new TileJobQueue(16, () => tileStats.notify(), 'biome/surface')
const undergroundQueue = new TileJobQueue(8,  () => tileStats.notify(), 'biome/underground')
const deepQueue        = new TileJobQueue(8,  () => tileStats.notify(), 'biome/deep')

const LOADING_GIFS = [
  '/loading/biome-loading-256-0.gif',
  '/loading/biome-loading-256-1.gif',
  '/loading/biome-loading-256-2.gif',
  '/loading/biome-loading-256-3.gif',
  '/loading/biome-loading-256-4.gif',
]

export function getBiomeCacheSize() { return surfaceCache.size + undergroundCache.size + deepCache.size }
export function clearBiomeCache() { surfaceCache.clear(); undergroundCache.clear(); deepCache.clear() }

const combinedBiomeQueue = {
  get size() { return surfaceQueue.size + undergroundQueue.size + deepQueue.size },
  pause()  { surfaceQueue.pause();  undergroundQueue.pause();  deepQueue.pause()  },
  resume() { surfaceQueue.resume(); undergroundQueue.resume(); deepQueue.resume() },
}
export function getBiomeQueue() { return combinedBiomeQueue }

function makeUndergroundFetch(
  slot: () => number,
  seed: () => number | null,
  version: () => string,
  blockY: number,
) {
  const cubiomesY = Math.floor(blockY / 4)
  return async (coords: L.Coords): Promise<ImageData | null> => {
    const { blockX, blockZ, blocksPerPixel } = tileToMinecraftRect(coords.x, coords.y, coords.z)
    const biomeScale = ([256, 64, 16, 4, 1] as const).find(s => s <= blocksPerPixel) ?? 4
    const queryW = Math.max(1, Math.ceil(TILE_SIZE * blocksPerPixel / biomeScale))
    const queryH = queryW
    const qx = Math.floor(blockX / biomeScale)
    const qz = Math.floor(blockZ / biomeScale)

    const [ugBiomes, surfBiomes] = await Promise.all([
      api.getBiomeRegionAt(slot(), qx, qz, queryW, queryH, biomeScale, cubiomesY),
      api.getBiomeRegion(slot(), qx, qz, queryW, queryH, biomeScale),
    ])
    const pixelsBuf = await postOverlay(
      { type: 'underground-biome', ugBiomes: ugBiomes.buffer, surfBiomes: surfBiomes.buffer, queryW, queryH, blocksPerPixel, biomeScale },
      [ugBiomes.buffer, surfBiomes.buffer],
    )
    if (!pixelsBuf) return null
    return new ImageData(new Uint8ClampedArray(pixelsBuf), TILE_SIZE, TILE_SIZE)
  }
}

function BiomeTileLayer({ map, unlimitedCache = false }: { map: L.Map; unlimitedCache?: boolean }) {
  const { state, generatorSlot } = useApp()

  const seed      = state.seedData?.seed ?? null
  const dimension = state.dimension
  const version   = state.selectedVersion
  const opacity   = state.biomeOpacity
  const biomeMode = state.biomeMode
  const slot      = generatorSlot
  const seedBig   = seed != null ? BigInt(seed) : 0n
  const mcVersion = MC_VERSIONS[version]

  const slotRef    = useRef(slot)
  const seedRef    = useRef(seed)
  const versionRef = useRef(version)
  slotRef.current    = slot
  seedRef.current    = seed
  versionRef.current = version

  const is1_18 = mcVersion >= MC_VERSIONS['MC_1_18']
  const showUg = dimension === 'overworld' && is1_18
  // Underground/deep are overworld-only cave modes. Outside the overworld (or
  // pre-1.18) they don't apply, so the surface layer must render regardless of
  // the persisted biomeMode — otherwise the biome layer goes blank in the Nether.
  const showSurface = biomeMode === 'surface' || !showUg

  // ── Surface ──────────────────────────────────────────────────────────────────

  useTileLayer({
    map,
    queue: surfaceQueue,
    tileSize: BIOME_TILE_SIZE,
    opacity,
    zIndex: 1,
    layerOptions: { updateWhenIdle: true, updateWhenZooming: false, minZoom: MIN_ZOOM, minNativeZoom: 0 },
    deps: [map, generatorSlot, seed, dimension, version, state.tileCacheVersion, biomeMode],
    // dimension is already in cacheKeyFn below; biomeMode doesn't affect the
    // fetched tile (renderBiomeTile doesn't take it) — only seed/version/an
    // explicit force-refresh should actually wipe the (possibly Infinity-sized,
    // see unlimitedCache) shared surface cache.
    cacheEpochDeps: [seed, version, state.tileCacheVersion],
    enabled: seed != null && slot != null && showSurface,
    cache: surfaceCache as Map<string, ImageData | string>,
    maxCache: unlimitedCache ? Infinity : MAX_SURFACE_CACHE,
    cacheKeyFn: (coords) => `B:${seed}:${version}:${dimension}:${coords.x}:${coords.y}:${coords.z}`,
    fetch: async (coords) => {
      tileStats.biomeLoadingStart()
      const t0 = performance.now()
      const path = await api.renderBiomeTile(slot!, seedBig, mcVersion, dimension, coords.x, coords.y, coords.z)
      tileStats.biomeLoadingDone(Math.round(performance.now() - t0))
      return path ? convertFileSrc(path) : null
    },
    onCleanup: tileStats.resetBiomeLoading,
    loadingGifs: LOADING_GIFS,
    nativeZoom: 2,
  })

  // ── Underground (Y −32) ───────────────────────────────────────────────────────

  const ugFetchRef = useRef(makeUndergroundFetch(
    () => slotRef.current!,
    () => seedRef.current,
    () => versionRef.current,
    UNDERGROUND_BLOCK_Y,
  ))

  const ugLayerRef = useTileLayer({
    map,
    queue: undergroundQueue,
    tileSize: TILE_SIZE,
    opacity,
    zIndex: 1,
    layerOptions: { updateWhenIdle: true, updateWhenZooming: false },
    deps: [map, slot, seed, version, biomeMode],
    // biomeMode only gates `enabled`, not the fetched content — see surface layer above.
    cacheEpochDeps: [seed, version],
    enabled: seed != null && slot != null && showUg && biomeMode === 'underground',
    cache: undergroundCache,
    maxCache: MAX_UG_CACHE,
    cacheKeyFn: (coords) => `UG:${seed}:${version}:${coords.x}:${coords.y}:${coords.z}`,
    loadingGifs: LOADING_GIFS,
    fetch: ugFetchRef.current,
  })

  useEffect(() => { ugLayerRef.current?.redraw() }, [biomeMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Deep (Y −52) ─────────────────────────────────────────────────────────────

  const deepFetchRef = useRef(makeUndergroundFetch(
    () => slotRef.current!,
    () => seedRef.current,
    () => versionRef.current,
    DEEP_BLOCK_Y,
  ))

  const deepLayerRef = useTileLayer({
    map,
    queue: deepQueue,
    tileSize: TILE_SIZE,
    opacity,
    zIndex: 1,
    layerOptions: { updateWhenIdle: true, updateWhenZooming: false },
    deps: [map, slot, seed, version, biomeMode],
    // biomeMode only gates `enabled`, not the fetched content — see surface layer above.
    cacheEpochDeps: [seed, version],
    enabled: seed != null && slot != null && showUg && biomeMode === 'deep',
    cache: deepCache,
    maxCache: MAX_UG_CACHE,
    cacheKeyFn: (coords) => `DEEP:${seed}:${version}:${coords.x}:${coords.y}:${coords.z}`,
    loadingGifs: LOADING_GIFS,
    fetch: deepFetchRef.current,
  })

  useEffect(() => { deepLayerRef.current?.redraw() }, [biomeMode]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}
export default memo(BiomeTileLayer)
