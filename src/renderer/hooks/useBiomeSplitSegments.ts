import { useEffect, useState } from 'react'
import { splitLegByBiome, RouteSubSegment } from '../lib/biomeSplit'
import { TravelMode } from '../lib/travelModes'

function legDistance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.z - a.z) ** 2)
}

/**
 * Per-leg travel sub-segments. Most modes pass through as a single segment
 * matching the leg; two modes get biome-split by sampling ocean/frozen-ocean/
 * snowy-land along the line (lib/biomeSplit.ts): `boat` splits into
 * boat/ice/snow/walk (no boat on dry land — snowy or not — and ice blocks a
 * boat same as land does), and `walk` splits into walk/ice/snow/swim (crossing
 * open water on foot is swim-speed, not walk-speed — a deliberate nudge toward
 * switching that leg to Boat mode; frozen ocean and snowy land are their own
 * cases either way, since both are bad for on-foot travel regardless of which
 * mode the leg started as).
 * Index i of the returned array corresponds to the leg from waypoints[i] to waypoints[i+1].
 */
export function useBiomeSplitSegments(
  generatorSlot: number | null,
  waypoints: { x: number; z: number }[],
  legModes: TravelMode[],
  minSpecialSegmentBlocks: number,
): RouteSubSegment[][] {
  const [segments, setSegments] = useState<RouteSubSegment[][]>([])

  useEffect(() => {
    let cancelled = false
    const legs = waypoints.slice(0, -1).map((a, i) => ({ a, b: waypoints[i + 1], mode: legModes[i] ?? 'walk' }))

    async function compute() {
      const results = await Promise.all(legs.map(leg => {
        if (generatorSlot == null) {
          return [{ from: leg.a, to: leg.b, mode: leg.mode, distance: legDistance(leg.a, leg.b) }]
        }
        if (leg.mode === 'boat') {
          return splitLegByBiome(generatorSlot, leg.a, leg.b,
            { ocean: 'boat', frozen: 'ice', snow: 'snow', land: 'walk' }, minSpecialSegmentBlocks)
        }
        if (leg.mode === 'walk') {
          return splitLegByBiome(generatorSlot, leg.a, leg.b,
            { ocean: 'swim', frozen: 'ice', snow: 'snow', land: 'walk' }, minSpecialSegmentBlocks)
        }
        return [{ from: leg.a, to: leg.b, mode: leg.mode, distance: legDistance(leg.a, leg.b) }]
      }))
      if (!cancelled) setSegments(results)
    }
    void compute()
    return () => { cancelled = true }
  }, [generatorSlot, waypoints, legModes, minSpecialSegmentBlocks])

  return segments
}
