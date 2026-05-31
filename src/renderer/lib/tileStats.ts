// Module-level tile loading / performance stats store.
// Layer components (BiomeTileLayer, ChunkOverlayLayer) write here directly
// instead of dispatching to the global AppState reducer, so tile operations
// don't cause app-wide re-renders.
// Only TileLoadingHud and DebugOverlay subscribe.

export interface TileStats {
  mcaLoadingCount:    number
  mcaTilesLoaded:     number
  mcaCacheHits:       number
  mcaTotalMs:         number
  mcaPeakMs:          number
  pngDecodeCount:     number
  pngDecodeTotalMs:   number
  pngDecodePeakMs:    number
  biomeLoadingCount:  number
  biomeTilesLoaded:   number
  biomeTotalMs:       number
  biomePeakMs:        number
  mcaColorCacheHits:  number
  mcaColorCacheMisses:number
  mcaPngCacheHits:    number
}

const stats: TileStats = {
  mcaLoadingCount: 0,   mcaTilesLoaded: 0,    mcaCacheHits: 0,
  mcaTotalMs: 0,        mcaPeakMs: 0,
  pngDecodeCount: 0,    pngDecodeTotalMs: 0,  pngDecodePeakMs: 0,
  biomeLoadingCount: 0, biomeTilesLoaded: 0,
  biomeTotalMs: 0,      biomePeakMs: 0,
  mcaColorCacheHits: 0, mcaColorCacheMisses: 0, mcaPngCacheHits: 0,
}

const listeners = new Set<() => void>()

export function notify() {
  for (const l of listeners) l()
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getStats(): Readonly<TileStats> { return stats }

// ── MCA (chunk tile) operations ───────────────────────────────────────────────

export function mcaLoadingStart() {
  stats.mcaLoadingCount++
  notify()
}

export function mcaLoadingDone(ms: number) {
  stats.mcaLoadingCount = Math.max(0, stats.mcaLoadingCount - 1)
  stats.mcaTilesLoaded++
  stats.mcaTotalMs += ms
  if (ms > stats.mcaPeakMs) stats.mcaPeakMs = ms
  notify()
}

export function mcaCacheHit() {
  stats.mcaCacheHits++
  notify()
}

export function resetMcaLoading() {
  stats.mcaLoadingCount = 0
  stats.pngDecodeCount  = 0
  notify()
}

// ── PNG decode operations ─────────────────────────────────────────────────────

export function pngDecodeStart() {
  stats.pngDecodeCount++
  notify()
}

export function pngDecodeDone(ms: number) {
  stats.pngDecodeCount = Math.max(0, stats.pngDecodeCount - 1)
  stats.pngDecodeTotalMs += ms
  if (ms > stats.pngDecodePeakMs) stats.pngDecodePeakMs = ms
  notify()
}

// ── Biome tile operations ─────────────────────────────────────────────────────

export function biomeLoadingStart() {
  stats.biomeLoadingCount++
  notify()
}

export function biomeLoadingDone(ms: number) {
  stats.biomeLoadingCount = Math.max(0, stats.biomeLoadingCount - 1)
  stats.biomeTilesLoaded++
  stats.biomeTotalMs += ms
  if (ms > stats.biomePeakMs) stats.biomePeakMs = ms
  notify()
}

export function resetBiomeLoading() {
  stats.biomeLoadingCount = 0
  notify()
}

// ── Tauri push metrics (called from useSeed.ts event handler) ─────────────────
// No notify — DebugOverlay polls every 2 s and these don't affect ChunkDataOverlay.

export function updateMcaMetrics(m: {
  colorCacheHits: number; colorCacheMisses: number; pngCacheHits: number
}) {
  stats.mcaColorCacheHits   = m.colorCacheHits
  stats.mcaColorCacheMisses = m.colorCacheMisses
  stats.mcaPngCacheHits     = m.pngCacheHits
}

// ── Reset cumulative stats (DebugOverlay "Reset stats" button) ────────────────

export function resetAllStats() {
  stats.mcaTilesLoaded    = 0; stats.mcaCacheHits     = 0
  stats.mcaTotalMs        = 0; stats.mcaPeakMs        = 0
  stats.biomeTilesLoaded  = 0; stats.biomeTotalMs     = 0; stats.biomePeakMs = 0
  stats.pngDecodeTotalMs  = 0; stats.pngDecodePeakMs  = 0
  stats.mcaColorCacheHits = 0; stats.mcaColorCacheMisses = 0; stats.mcaPngCacheHits = 0
  notify()
}
