import { useEffect, useState } from 'react'
import { getStats, subscribe, type TileStats } from '../lib/tileStats'

export function useTileStats(): Readonly<TileStats> {
  const [, forceUpdate] = useState(0)
  useEffect(() => subscribe(() => forceUpdate(n => n + 1)), [])
  return getStats()
}
