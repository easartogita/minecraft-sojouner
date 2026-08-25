import { useEffect, useState } from 'react'
import { splitLegByBiome, RouteSubSegment } from '../lib/biomeSplit'
import { TravelMode } from '../lib/travelModes'
import { GeneratorHandle } from './useGenerator'

function legDistance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.z - a.z) ** 2)
}

/**
 * Per-leg travel sub-segments. `boat` and `walk` legs get biome-split (by
 * sampling ocean/frozen-ocean/snowy-land, lib/biomeSplit.ts) into
 * boat/ice/snow/walk and walk/ice/snow/swim respectively, since a boat can't
 * cross land or ice, and open water on foot is swim-speed not walk-speed.
 * Other modes pass through as a single segment matching the leg.
 * Result[i] is the leg from waypoints[i] to waypoints[i+1].
 */
export function useBiomeSplitSegments(
  generatorConfig: GeneratorHandle,
  waypoints: { x: number; z: number }[],
  legModes: TravelMode[],
  minSpecialSegmentBlocks: number,
): RouteSubSegment[][] {
  const [segments, setSegments] = useState<RouteSubSegment[][]>([])
  const generatorSlot = generatorConfig.slot

  useEffect(() => {
    let cancelled = false
    const legs = waypoints.slice(0, -1).map((a, i) => ({ a, b: waypoints[i + 1], mode: legModes[i] ?? 'walk' }))

    async function compute() {
      const results = await Promise.all(legs.map(leg => {
        if (generatorSlot == null) {
          return [{ from: leg.a, to: leg.b, mode: leg.mode, distance: legDistance(leg.a, leg.b) }]
        }
        if (leg.mode === 'boat') {
          return splitLegByBiome(generatorConfig, leg.a, leg.b,
            { ocean: 'boat', frozen: 'ice', snow: 'snow', land: 'walk' }, minSpecialSegmentBlocks)
        }
        if (leg.mode === 'walk') {
          return splitLegByBiome(generatorConfig, leg.a, leg.b,
            { ocean: 'swim', frozen: 'ice', snow: 'snow', land: 'walk' }, minSpecialSegmentBlocks)
        }
        return [{ from: leg.a, to: leg.b, mode: leg.mode, distance: legDistance(leg.a, leg.b) }]
      }))
      if (!cancelled) setSegments(results)
    }
    void compute()
    return () => { cancelled = true }
  }, [generatorSlot, generatorConfig, waypoints, legModes, minSpecialSegmentBlocks])

  return segments
}
