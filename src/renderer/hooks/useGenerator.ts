import { useState, useEffect, useRef, useMemo } from 'react'
import { MCVersionKey, Dimension, MC_VERSIONS, DIMENSION_IDS } from '../lib/constants'
import { WorldType } from './useSeed'
import * as api from '../lib/tauriAPI'

/** The cubiomes-facing identity of the current generator config — the one place
 * that maps seed/version/dimension/worldType to what Rust/C actually wants,
 * so that knowledge doesn't leak into every tile/overlay layer. */
export interface GeneratorHandle {
  slot:       number | null
  seedBig:    bigint
  dimId:      number
  worldFlags: number
  mcVersion:  number
}

/** Manages a cubiomes generator slot in the Rust backend. `slot` is the handle
 * (0-3) once set up, else null; other fields are derived from inputs directly
 * so callers needing them for cache paths etc. don't have to wait on `slot`. */
export function useGenerator(
  seed: string | null,
  version: MCVersionKey,
  dimension: Dimension,
  worldType: WorldType,
): GeneratorHandle {
  const [slot, setSlot] = useState<number | null>(null)
  const pendingRef = useRef(false)

  const mcVersion  = MC_VERSIONS[version]
  const dimId      = DIMENSION_IDS[dimension]
  const worldFlags = worldType === 'large_biomes' ? 1 : 0
  const seedBig    = seed != null ? BigInt(seed) : 0n

  useEffect(() => {
    setSlot(null);
    if (!seed) { return; }

    let cancelled = false
    pendingRef.current = true

    api.setupGenerator(seedBig, mcVersion, dimId, worldFlags)
      .then(s => {
        if (!cancelled) {
          setSlot(s)
          pendingRef.current = false
        }
      })
      .catch(err => {
        console.error('cubiomes_setup_generator failed:', err)
        if (!cancelled) pendingRef.current = false
      })

    return () => { cancelled = true }
  }, [seed, version, dimension, worldType]) // eslint-disable-line react-hooks/exhaustive-deps

  return useMemo(
    () => ({ slot, seedBig, dimId, worldFlags, mcVersion }),
    [slot, seedBig, dimId, worldFlags, mcVersion],
  )
}
