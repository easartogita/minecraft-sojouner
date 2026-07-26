export type TravelMode = 'walk' | 'boat' | 'mounted' | 'elytra' | 'spectator' | 'nether_highway' | 'swim' | 'ice' | 'snow'

export interface TravelModeDef {
  id: TravelMode
  label: string
  speed: number // blocks/second
  color: string
  netherEquivalent?: boolean // distance is leg-distance / 8 before applying speed (finished-tunnel model)
}

// Palette groups by terrain family, not just "make every mode different": land
// modes (walk, mounted) sit in warm earth tones, water modes (boat, swim, ice)
// sit in a blue family but spread from a clean saturated blue (boat, the "good"
// way to cross water) down through a murky slate blue (swim, struggling through
// open water) up to a near-white neon blue (ice, jarring on purpose — you should
// not be here). Elytra/spectator/nether-highway stay outside both families since
// they don't interact with terrain the same way.
export const TRAVEL_MODES: Record<TravelMode, TravelModeDef> = {
  // Label is "On Foot," not "Walk" — the id stays `walk` (load-bearing string
  // literal throughout the codebase), but the plain name undersold that this
  // mode adapts: it auto-splits into swim/ice/snow sub-segments wherever the
  // terrain isn't normal walkable ground, not just walk speed the whole leg.
  walk:           { id: 'walk',           label: 'On Foot',        speed: 4.317, color: '#7a4520' },
  // Same idea — "By Boat," not "Boat": adapts to walk/ice/snow on any dry-land
  // or icy stretch the straight leg happens to cross.
  boat:           { id: 'boat',           label: 'By Boat',        speed: 8,     color: '#1f6feb' },
  mounted:        { id: 'mounted',        label: 'Mounted',        speed: 9,     color: '#d29922' },
  elytra:         { id: 'elytra',         label: 'Elytra',         speed: 35,    color: '#a371f7' },
  spectator:      { id: 'spectator',      label: 'Spectator',      speed: 21.6,  color: '#8b949e' },
  nether_highway: { id: 'nether_highway', label: 'Nether Highway', speed: 4.317, color: '#f85149', netherEquivalent: true },
  // Not a selectable mode — auto-detected when a `walk` leg crosses open ocean
  // without a boat. Slower than walking and blended down further to account for
  // having to keep surfacing for air; the punitive speed + long dash are both
  // deliberate nudges toward switching that leg to Boat mode instead. Murky
  // slate blue — deliberately duller than Boat's clean blue, reads as "struggling."
  swim:           { id: 'swim',           label: 'Swim',           speed: 2.2,   color: '#3a6b7d' },
  // Also auto-only. Frozen ocean (icebergs, pack ice) is bad for both boat and
  // on-foot travel: a boat can't move through ice, and a walker is picking
  // across jagged iceberg terrain, not swimming — so it gets its own speed
  // regardless of whether the leg was tagged `boat` or `walk`. Faster than
  // swimming (solid footing) but slower than plain walking (treacherous terrain).
  // Near-white neon blue — deliberately jarring against the dark ocean background.
  ice:            { id: 'ice',            label: 'Frozen Ocean',   speed: 3.0,   color: '#c8faff' },
  // Also auto-only. Deep/powder snow on land (snowy plains/taiga/ice spikes,
  // the snow-capped mountain biomes) slows walking — same "looks like normal
  // terrain, isn't actually normal speed" problem as frozen ocean, just dry
  // instead of wet. Applies whether the leg was tagged `boat` or `walk`, since
  // either way you're on foot picking through snowdrifts. Deep saturated navy —
  // NOT pale like Ice: Ice needed to pop against dark ocean, but snow's own
  // background (snowy terrain) is pale, so a pale dash color washed out into
  // near-invisibility there instead of contrasting with it.
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
 * Leaflet dashArray string for a mode's line — longer dashes read as slower,
 * shorter/near-solid dashes read as faster. Purely a rendering aid (RulerLayer):
 * lets the boat/walk split in a biome-auto-split leg (and every other mode) read
 * without depending on color contrast alone, since some mode colors (walk vs. boat)
 * are close enough in hue to be hard to tell apart on a busy biome background.
 *
 * Floors are tied to the 4px line weight these render at (see RulerLayer.tsx) —
 * a gap smaller than the line's own width visually disappears, especially with
 * Leaflet's default round line-cap bleeding each dash past its nominal end.
 * Pair with `lineCap: 'butt'` on the polyline, or the floor alone won't be enough.
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
 * The complementary pattern + offset that exactly fills the gaps left by
 * `dashPatternForMode` — pair a polyline using this with one using the normal
 * pattern (same coordinates, drawn either order) to get a two-tone "candy-cane"
 * line where the gap is a solid color instead of showing whatever's underneath.
 * Makes the dash rhythm itself read clearly ("how long is this dash, really")
 * independent of the mode color or what biome is under the line.
 */
export function gapDashPatternForMode(mode: TravelMode): { dashArray: string; dashOffset: string } {
  const { dash, gap } = dashGapForMode(mode)
  return { dashArray: `${gap} ${dash}`, dashOffset: `${gap}` }
}

const DEFAULT_GAP_FILL_COLOR = '#e8e8e8' // light, crisp, neutral — reads as a clean rhythm marker

/**
 * Gap-fill color for `gapDashPatternForMode` — normally a fixed neutral gray so
 * the dash rhythm reads the same regardless of mode, but the "your travel time
 * here is not what you'd expect" modes (`ice`, `snow`) get blaze orange instead
 * (hunter-safety-vest orange): a visual alert layered on top of, not instead of,
 * the long-dash speed signal — on land or at sea, same alert either way. Amber
 * wasn't loud enough to actually grab the eye against a busy map — went more
 * aggressive on purpose.
 */
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
