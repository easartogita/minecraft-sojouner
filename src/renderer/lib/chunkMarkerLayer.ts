import { useCallback, useEffect, useRef } from 'react'
import L from 'leaflet'
import { BASE_BLOCKS_PER_PIXEL } from './constants'
import { setupDebouncedMapListeners } from './mapListeners'

// Active worldgen flushes many region files in quick succession, each firing a
// region:changed event. Coalesce that burst into a single reload: without it,
// each event kicks off a full-viewport .mca re-read that supersedes (aborts) the
// previous one before it can prune, so no load ever wins the race and stale
// markers linger on screen while the backend churns through doomed fetches.
const REGION_RELOAD_DEBOUNCE_MS = 600

// ── Tooltip helper ────────────────────────────────────────────────────────────

// Joins non-empty parts with ' · ' for use as a marker title attribute.
export function tooltipText(...parts: (string | null | undefined | false)[]): string {
  return (parts.filter(Boolean) as string[]).join(' · ')
}

// ── Y-filter bounds ───────────────────────────────────────────────────────────

/** Returns [yMin, yMax] for the marker Y-filter. `anchorY` is the resolved
 *  window anchor (effectiveMarkerAnchorY); null means no filtering. */
export function markerYBounds(
  anchorY: number | null,
  low: number,
  high: number,
): [number, number] {
  if (anchorY == null) return [-Infinity, Infinity]
  return [anchorY + low, anchorY + high]
}

// ── Shared stats ──────────────────────────────────────────────────────────────

export interface LayerStats {
  loadCount: number
  totalMs: number
  peakMs: number
  totalFetched: number
  lastCount: number
}

export function makeLayerStats(): LayerStats {
  return { loadCount: 0, totalMs: 0, peakMs: 0, totalFetched: 0, lastCount: 0 }
}

export function updateLayerStats(stats: LayerStats, elapsed: number, count: number): void {
  stats.loadCount++
  stats.totalMs += elapsed
  if (elapsed > stats.peakMs) stats.peakMs = elapsed
  stats.totalFetched += count
}

// ── Viewport → chunk bounds ───────────────────────────────────────────────────

export interface ChunkBounds {
  minCx: number
  maxCx: number
  minCz: number
  maxCz: number
}

export function viewportChunkBounds(map: L.Map, maxChunkSpan = 512): ChunkBounds | null {
  const b = map.getBounds()
  const f = BASE_BLOCKS_PER_PIXEL
  const minCx = Math.floor(Math.floor( b.getWest()  * f) / 16)
  const maxCx = Math.floor(Math.ceil ( b.getEast()  * f) / 16)
  const minCz = Math.floor(Math.floor(-b.getNorth() * f) / 16)
  const maxCz = Math.floor(Math.ceil (-b.getSouth() * f) / 16)
  if (maxCx - minCx > maxChunkSpan || maxCz - minCz > maxChunkSpan) return null
  return { minCx, maxCx, minCz, maxCz }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export type OnLoadFn = (
  pool: Map<string, L.Marker>,
  group: L.LayerGroup,
  bounds: ChunkBounds,
  isAborted: () => boolean,
) => Promise<void>

interface HookOpts {
  worldDir: string | null
  dimension: string
  enabled?: boolean          // default true; clears pool when false
  changedRegions?: unknown[] // triggers reload when non-empty
  minZoom?: number           // default 3
  maxChunkSpan?: number      // default derived from minZoom
  debounceMs?: number        // default 300
  onLoad: OnLoadFn
  onClear?: () => void       // called whenever the pool is cleared
}

// Returns a stable triggerLoad() for use in a second useEffect for filter deps.
export function useChunkMarkerLayer(map: L.Map, opts: HookOpts): () => void {
  const layerGroupRef = useRef<L.LayerGroup | null>(null)
  const poolRef       = useRef<Map<string, L.Marker>>(new Map())
  // Generation counter (same mechanism as StructureLayer's updateGenRef): each
  // load takes a generation; anything that should cancel in-flight loads bumps
  // it. A shared boolean can't do this — a newer load resetting the flag would
  // un-abort an older fetch still awaiting its response.
  const genRef        = useRef(0)
  const prevIdRef     = useRef('')
  const loadFnRef     = useRef<() => void>(() => {})
  const onLoadRef     = useRef(opts.onLoad)
  const onClearRef    = useRef(opts.onClear)

  // Update callback refs every render so the closures inside effects stay fresh.
  onLoadRef.current  = opts.onLoad
  onClearRef.current = opts.onClear

  const {
    worldDir, dimension,
    enabled      = true,
    changedRegions,
    minZoom      = 3,
    // Must fit a full-screen viewport at minZoom (a 4K screen at zoom z spans
    // 3840 / 2^z chunks) — otherwise viewportChunkBounds bails to null and the
    // layer silently renders nothing. E.g. minZoom 3 → 512 chunks.
    maxChunkSpan = Math.ceil(4096 / 2 ** minZoom),
    debounceMs   = 300,
  } = opts

  // Structural effect: pool lifecycle, identity reset, map listeners.
  useEffect(() => {
    if (!map) return

    if (!layerGroupRef.current) {
      layerGroupRef.current = L.layerGroup().addTo(map)
    }
    const group = layerGroupRef.current

    const clearPool = () => {
      const pool = poolRef.current
      pool.forEach(m => group.removeLayer(m))
      pool.clear()
      onClearRef.current?.()
    }

    const identity = `${worldDir ?? ''}:${dimension}`
    if (identity !== prevIdRef.current) {
      clearPool()
      prevIdRef.current = identity
    }

    if (!worldDir || !enabled) {
      clearPool()
      return
    }

    const load = async () => {
      // Starting a new load supersedes (aborts) any load still in flight.
      const gen = ++genRef.current

      if (map.getZoom() < minZoom) {
        clearPool()
        return
      }

      const bounds = viewportChunkBounds(map, maxChunkSpan)
      if (!bounds) return

      await onLoadRef.current(poolRef.current, group, bounds, () => gen !== genRef.current)
    }

    loadFnRef.current = load

    const cleanup = setupDebouncedMapListeners(map, () => { void load() }, debounceMs)
    void load()

    return () => {
      genRef.current++
      cleanup()
    }
    // debounceMs is constant; onLoad/onClear accessed via refs. minZoom is in
    // the deps because it's user-configurable at runtime (Settings stepper).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, worldDir, dimension, enabled, minZoom, maxChunkSpan])

  // Unmount-only: clear all markers when the component is removed from the tree.
  useEffect(() => {
    return () => {
      genRef.current++
      const group = layerGroupRef.current
      const pool  = poolRef.current
      pool.forEach(m => group?.removeLayer(m))
      pool.clear()
      onClearRef.current?.()
    }
  }, [])

  // Reload when watched regions change (block-edit hot-reload), debounced so a
  // burst of region:changed events coalesces into one viewport reload that can
  // actually run to completion and prune, instead of a storm of superseded reads.
  useEffect(() => {
    if (!changedRegions || changedRegions.length === 0) return
    const t = setTimeout(() => loadFnRef.current(), REGION_RELOAD_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [changedRegions])

  return useCallback(() => { loadFnRef.current() }, [])
}
