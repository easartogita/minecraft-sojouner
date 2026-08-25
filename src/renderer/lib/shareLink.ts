import type { OverlayState } from '../hooks/overlaySlice'
import type { Dimension } from './constants'

// Static-export only (see App.tsx boot / MapContextMenu) — the live desktop app has
// no meaningfully shareable URL, so this module is dead weight there. Query-string
// based rather than a hash fragment: the exported bundle's static hosting needs no
// server-side routing support for either form, so query string is simplest.

// The subset of OverlayState that reads as "which layers/filters are on" — narrower
// than full session state (excludes per-dimension selections, cave/Y-window, route/ruler
// state, which read as "current activity" rather than "a view worth sharing").
const FILTER_KEYS = [
  'showBiomes', 'biomeOpacity',
  'showChunkData', 'chunkOpacity', 'hideWater',
  'showSlimeChunks', 'slimeOpacity',
  'showOreVeins', 'showCopperVeins', 'showIronVeins', 'oreOpacity',
  'showOreFeatures', 'oreFeatureTypes',
  'showCarvers', 'carverOpacity',
  'showChunkGrid', 'showRegionGrid', 'showSpawnRadius', 'showSpawnChunks', 'showWorldBorder',
  'showStructures',
  'showMarkers',
  'showLocalDifficulty',
  'biomeMode',
] as const satisfies readonly (keyof OverlayState)[]

export type ShareLinkFilters = Pick<OverlayState, (typeof FILTER_KEYS)[number]>

export function extractShareLinkFilters(state: OverlayState): ShareLinkFilters {
  const out = {} as ShareLinkFilters
  for (const key of FILTER_KEYS) (out as any)[key] = state[key]
  return out
}

export function buildShareLink(
  x: number, z: number, zoom: number, dimension: Dimension,
  filters: ShareLinkFilters | null,
): string {
  const params = new URLSearchParams()
  params.set('x', String(Math.round(x)))
  params.set('z', String(Math.round(z)))
  params.set('zoom', String(zoom))
  params.set('dim', dimension)
  if (filters) params.set('filters', JSON.stringify(filters))
  const url = new URL(window.location.href)
  url.hash = ''
  url.search = params.toString()
  return url.toString()
}

export interface ParsedShareLink {
  x: number
  z: number
  zoom: number
  dimension: string
  filters: Partial<ShareLinkFilters> | null
}

export function parseShareLink(): ParsedShareLink | null {
  const params = new URLSearchParams(window.location.search)
  const xStr = params.get('x')
  const zStr = params.get('z')
  if (xStr == null || zStr == null) return null
  const x = Number(xStr)
  const z = Number(zStr)
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null
  const zoomRaw = Number(params.get('zoom'))
  const zoom = Number.isFinite(zoomRaw) ? zoomRaw : 2
  const dimension = params.get('dim') ?? 'overworld'

  let filters: Partial<ShareLinkFilters> | null = null
  const rawFilters = params.get('filters')
  if (rawFilters) {
    try {
      const parsed = JSON.parse(rawFilters)
      if (parsed && typeof parsed === 'object') filters = parsed
    } catch { /* malformed filters param — ignore, fall back to defaults */ }
  }

  return { x, z, zoom, dimension, filters }
}

/** Strips the share-link query params from the address bar once applied, so
 *  a page refresh lands on the normal default view instead of re-snapping
 *  to the shared one every time. */
export function clearShareLinkFromUrl(): void {
  const url = new URL(window.location.href)
  url.search = ''
  window.history.replaceState(null, '', url.toString())
}
