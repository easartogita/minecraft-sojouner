import { useEffect, useRef, useState } from 'react'
import { getStats, subscribe, type TileStats } from '../lib/tileStats'

// Coalesces bursts of notify() (several overlay queues settling in the same
// tick) into one re-render per window instead of one per call, which was
// enough main-thread churn to jank map dragging. getStats() still reads live.
const THROTTLE_MS = 100

export function useTileStats(): Readonly<TileStats> {
  const [, forceUpdate] = useState(0)
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const unsubscribe = subscribe(() => {
      if (pendingRef.current) return
      pendingRef.current = setTimeout(() => {
        pendingRef.current = null
        forceUpdate(n => n + 1)
      }, THROTTLE_MS)
    })
    return () => {
      unsubscribe()
      if (pendingRef.current) clearTimeout(pendingRef.current)
    }
  }, [])
  return getStats()
}
