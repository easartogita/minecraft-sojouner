import { useCallback, useEffect, useRef } from 'react'
import L from 'leaflet'
import { BASE_BLOCKS_PER_PIXEL } from './constants'
import { setupDebouncedMapListeners } from './mapListeners'

// ── Tooltip helper ────────────────────────────────────────────────────────────

// Joins non-empty parts with ' · ' for use as a marker title attribute.
export function tooltipText(...parts: (string | null | undefined | false)[]): string {
  return (parts.filter(Boolean) as string[]).join(' · ')
}

// ── Y-filter bounds ───────────────────────────────────────────────────────────

/** Returns [yMin, yMax] for the marker Y-filter, or [-Infinity, Infinity] when disabled. */
export function markerYBounds(
  enabled: boolean,
  playerY: number | null,
  radius: number,
): [number, number] {
  if (enabled && playerY !== null) return [playerY - radius, playerY + radius]
  return [-Infinity, Infinity]
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

export function viewportChunkBounds(map: L.Map, maxChunkSpan = 96): ChunkBounds | null {
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
  minZoom?: number           // default 5
  maxChunkSpan?: number      // default 96
  debounceMs?: number        // default 300
  onLoad: OnLoadFn
  onClear?: () => void       // called whenever the pool is cleared
}

// Returns a stable triggerLoad() for use in a second useEffect for filter deps.
export function useChunkMarkerLayer(map: L.Map, opts: HookOpts): () => void {
  const layerGroupRef = useRef<L.LayerGroup | null>(null)
  const poolRef       = useRef<Map<string, L.Marker>>(new Map())
  const abortRef      = useRef(false)
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
    minZoom      = 5,
    maxChunkSpan = 96,
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
      abortRef.current = false

      if (map.getZoom() < minZoom) {
        clearPool()
        abortRef.current = true
        return
      }

      const bounds = viewportChunkBounds(map, maxChunkSpan)
      if (!bounds) return

      await onLoadRef.current(poolRef.current, group, bounds, () => abortRef.current)
    }

    loadFnRef.current = load

    const cleanup = setupDebouncedMapListeners(map, () => {
      abortRef.current = true
      void load()
    }, debounceMs)
    void load()

    return () => {
      abortRef.current = true
      cleanup()
    }
    // minZoom/maxChunkSpan/debounceMs are constants; onLoad/onClear accessed via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, worldDir, dimension, enabled])

  // Unmount-only: clear all markers when the component is removed from the tree.
  useEffect(() => {
    return () => {
      const group = layerGroupRef.current
      const pool  = poolRef.current
      pool.forEach(m => group?.removeLayer(m))
      pool.clear()
      onClearRef.current?.()
    }
  }, [])

  // Reload when watched regions change (block-edit hot-reload).
  useEffect(() => {
    if (changedRegions && changedRegions.length > 0) loadFnRef.current()
  }, [changedRegions])

  return useCallback(() => { loadFnRef.current() }, [])
}
