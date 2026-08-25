import { getBiomesAlongLine } from './tauriAPI'
import { TravelMode } from './travelModes'
import { GeneratorHandle } from '../hooks/useGenerator'

// Open-ocean biome IDs (cubiomes biomes.h). Frozen oceans are classified separately
// (icebergs are bad for both boating and walking). Rivers are excluded — narrow,
// current-bearing water is a different reliability case than open ocean.
const OPEN_OCEAN_BIOME_IDS = new Set([0, 24, 44, 45, 46, 47, 48, 49])
const FROZEN_OCEAN_BIOME_IDS = new Set([10, 50]) // frozen_ocean, deep_frozen_ocean

// Snowy land biomes slow walking, same problem as frozen ocean but dry instead of wet.
// `stony_peaks` (182) is excluded — it's the bare, non-snowy peak variant.
const SNOWY_LAND_BIOME_IDS = new Set([
  12, 13, 26,        // snowy_plains, snowy_mountains, snowy_beach
  30, 31, 158,        // snowy_taiga, snowy_taiga_hills, snowy_taiga_mountains
  140,                 // ice_spikes
  178, 179, 180, 181, // grove, snowy_slopes, jagged_peaks, frozen_peaks
])

const SAMPLE_INTERVAL_BLOCKS = 24

export interface RouteSubSegment {
  from: { x: number; z: number }
  to: { x: number; z: number }
  mode: TravelMode
  distance: number
}

export interface BiomeSplitModes {
  ocean: TravelMode  // open water
  frozen: TravelMode // frozen ocean / icebergs — bad for both boat and on-foot travel
  snow: TravelMode   // snowy land — bad for on-foot travel, boat is irrelevant (it's land)
  land: TravelMode
}

type Classification = 'ocean' | 'frozen' | 'snow' | 'land'

function dist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.z - a.z) ** 2)
}

function classify(id: number): Classification {
  if (FROZEN_OCEAN_BIOME_IDS.has(id)) return 'frozen'
  if (OPEN_OCEAN_BIOME_IDS.has(id)) return 'ocean'
  if (SNOWY_LAND_BIOME_IDS.has(id)) return 'snow'
  return 'land'
}

/**
 * Split a leg into contiguous ocean/frozen-ocean/snowy-land/land sub-segments by
 * sampling biome along the line, mapping each to the caller's mode for that class.
 * Runs shorter than `minSpecialBlocks` fold into `modes.land` — not worth switching
 * mode for a short crossing. Used for both `boat` legs (splits into boat/ice/walk/walk)
 * and `walk` legs (splits into walk/ice/snow/swim).
 */
export async function splitLegByBiome(
  generatorConfig: GeneratorHandle,
  a: { x: number; z: number },
  b: { x: number; z: number },
  modes: BiomeSplitModes,
  minSpecialBlocks: number,
): Promise<RouteSubSegment[]> {
  const { slot, seedBig, dimId, worldFlags, mcVersion } = generatorConfig
  const legDist = dist(a, b)
  const wholeLeg: RouteSubSegment[] = [{ from: a, to: b, mode: modes.ocean, distance: legDist }]
  if (legDist === 0) return wholeLeg

  const steps = Math.max(1, Math.round(legDist / SAMPLE_INTERVAL_BLOCKS))
  const points: { x: number; z: number }[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    points.push({ x: Math.round(a.x + (b.x - a.x) * t), z: Math.round(a.z + (b.z - a.z) * t) })
  }

  let ids: Int32Array
  try {
    ids = await getBiomesAlongLine(slot!, seedBig, dimId, worldFlags, mcVersion, points)
  } catch {
    return wholeLeg // sampling failed — fall back to treating the whole leg as the ocean mode
  }

  const classes = Array.from(ids).map(classify)

  // Merge consecutive same-classification samples into runs. A boundary segment
  // only counts as a special class if both endpoints agree on the same class —
  // a disagreement at a sample pair is treated as land (conservative at a
  // transition, and rare given the 24-block sample spacing).
  interface Run { startIdx: number; endIdx: number; cls: Classification }
  const runs: Run[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const cls = classes[i] === classes[i + 1] ? classes[i] : 'land'
    const last = runs[runs.length - 1]
    if (last && last.cls === cls) last.endIdx = i + 1
    else runs.push({ startIdx: i, endIdx: i + 1, cls })
  }

  // Fold short special-terrain runs (ocean, frozen, or snow) into land.
  for (const run of runs) {
    if (run.cls !== 'land' && dist(points[run.startIdx], points[run.endIdx]) < minSpecialBlocks) run.cls = 'land'
  }

  // Re-merge adjacent runs that now share a classification after folding.
  const merged: Run[] = []
  for (const run of runs) {
    const last = merged[merged.length - 1]
    if (last && last.cls === run.cls) last.endIdx = run.endIdx
    else merged.push({ ...run })
  }

  return merged.map(run => ({
    from: points[run.startIdx],
    to: points[run.endIdx],
    mode: modes[run.cls],
    distance: dist(points[run.startIdx], points[run.endIdx]),
  }))
}
