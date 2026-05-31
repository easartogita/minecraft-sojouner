import { useState, useEffect, useRef } from 'react'
import { MCVersionKey, Dimension, MC_VERSIONS, DIMENSION_IDS } from '../lib/constants'
import { WorldType } from './useSeed'
import * as api from '../lib/tauriAPI'

/**
 * Manages a cubiomes generator slot in the Rust backend.
 * Returns the slot number (0-3) once the generator is set up, or null if not ready.
 */
export function useGenerator(
  seed: string | null,
  version: MCVersionKey,
  dimension: Dimension,
  worldType: WorldType,
): number | null {
  const [slot, setSlot] = useState<number | null>(null)
  const pendingRef = useRef(false)

  useEffect(() => {
    setSlot(null);
    if (!seed) { return; }

    let cancelled = false
    pendingRef.current = true

    const mcVersion = MC_VERSIONS[version]
    const dimId = DIMENSION_IDS[dimension]
    const flags = worldType === 'large_biomes' ? 1 : 0

    const seedBig = BigInt(seed)

    api.setupGenerator(seedBig, mcVersion, dimId, flags)
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
  }, [seed, version, dimension, worldType])

  return slot
}
