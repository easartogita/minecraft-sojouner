export type TravelMode = 'walk' | 'boat' | 'mounted' | 'elytra' | 'spectator' | 'nether_highway' | 'swim' | 'ice' | 'snow'

export interface TravelModeDef {
  id: TravelMode
  label: string
  speed: number // blocks/second
  color: string
  netherEquivalent?: boolean // distance is leg-distance / 8 before applying speed (finished-tunnel model)
}

// Palette groups by terrain family: land modes get warm earth tones, water modes
// (boat/swim/ice) share a blue family spread by how "safe" the mode is.
export const TRAVEL_MODES: Record<TravelMode, TravelModeDef> = {
  // id stays `walk` (used as a string literal elsewhere); label says "On Foot"
  // since this mode auto-splits into swim/ice/snow sub-segments as terrain demands.
  walk:           { id: 'walk',           label: 'On Foot',        speed: 4.317, color: '#7a4520' },
  boat:           { id: 'boat',           label: 'By Boat',        speed: 8,     color: '#1f6feb' },
  mounted:        { id: 'mounted',        label: 'Mounted',        speed: 9,     color: '#d29922' },
  elytra:         { id: 'elytra',         label: 'Elytra',         speed: 35,    color: '#a371f7' },
  spectator:      { id: 'spectator',      label: 'Spectator',      speed: 21.6,  color: '#8b949e' },
  nether_highway: { id: 'nether_highway', label: 'Nether Highway', speed: 4.317, color: '#f85149', netherEquivalent: true },
  // Auto-detected only (not selectable): a `walk` leg crossing open ocean without a boat.
  // Slow on purpose, nudging toward Boat instead.
  swim:           { id: 'swim',           label: 'Swim',           speed: 2.2,   color: '#3a6b7d' },
  // Auto-only: frozen ocean blocks boats and forces picking across ice, so it needs its
  // own speed regardless of whether the leg was tagged `boat` or `walk`.
  ice:            { id: 'ice',            label: 'Frozen Ocean',   speed: 3.0,   color: '#c8faff' },
  // Auto-only: deep/powder snow on land slows walking the same way frozen ocean does at sea.
  snow:           { id: 'snow',           label: 'Snowy Terrain',  speed: 3.5,   color: '#1e3a5f' },
}

// Selectable from the mode dropdown. `swim`, `ice`, and `snow` are auto-only — see their TRAVEL_MODES entries.
export const TRAVEL_MODE_ORDER: TravelMode[] = ['walk', 'boat', 'mounted', 'elytra', 'spectator', 'nether_highway']

export function legTravelTime(distanceBlocks: number, mode: TravelMode): number {
  const def = TRAVEL_MODES[mode]
  const effectiveDistance = def.netherEquivalent ? distanceBlocks / 8 : distanceBlocks
  return effectiveDistance / def.speed
}

/** Effective real-world speed — nether-highway legs cover 8x ground per block moved. */
function effectiveSpeed(mode: TravelMode): number {
  const def = TRAVEL_MODES[mode]
  return def.netherEquivalent ? def.speed * 8 : def.speed
}

/**
 * Leaflet dashArray for a mode's line — longer dashes read as slower. Lets speed
 * read without relying on color contrast alone (some mode colors are close in hue).
 * Min dash/gap sizes are tied to RulerLayer's 4px line weight; pair with
 * `lineCap: 'butt'` or Leaflet's round cap bleeds dashes past the floor.
 */
function dashGapForMode(mode: TravelMode): { dash: number; gap: number } {
  const speed = effectiveSpeed(mode)
  const dash = Math.max(4, Math.min(48, Math.round(100 / speed)))
  const gap = Math.max(4, Math.round(dash * 0.5))
  return { dash, gap }
}

export function dashPatternForMode(mode: TravelMode): string {
  const { dash, gap } = dashGapForMode(mode)
  return `${dash} ${gap}`
}

/**
 * Complementary pattern + offset that exactly fills the gaps from `dashPatternForMode`.
 * Draw both polylines on the same coordinates to get a two-tone "candy-cane" line
 * so the dash rhythm reads independent of the mode color or biome underneath.
 */
export function gapDashPatternForMode(mode: TravelMode): { dashArray: string; dashOffset: string } {
  const { dash, gap } = dashGapForMode(mode)
  return { dashArray: `${gap} ${dash}`, dashOffset: `${gap}` }
}

const DEFAULT_GAP_FILL_COLOR = '#e8e8e8' // light, crisp, neutral — reads as a clean rhythm marker

/** Gap-fill color: neutral gray by default; blaze orange for `ice`/`snow` as an extra alert
 *  that travel time here is slower than it looks, layered on top of the dash-length signal. */
export function gapFillColorForMode(mode: TravelMode): string {
  if (mode === 'ice' || mode === 'snow') return '#ff6700'
  return DEFAULT_GAP_FILL_COLOR
}

function legDistance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.z - a.z) ** 2)
}

export function routeTotalDistance(waypoints: { x: number; z: number }[]): number {
  let total = 0
  for (let i = 0; i < waypoints.length - 1; i++) total += legDistance(waypoints[i], waypoints[i + 1])
  return total
}

export function routeTotalTime(waypoints: { x: number; z: number }[], legModes: TravelMode[]): number {
  let total = 0
  for (let i = 0; i < waypoints.length - 1; i++) {
    total += legTravelTime(legDistance(waypoints[i], waypoints[i + 1]), legModes[i] ?? 'walk')
  }
  return total
}
