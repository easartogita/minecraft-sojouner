import React, { useEffect, useRef, useState } from 'react'
import { IconLock, IconLockOpen } from './icons'

// Trailing debounce for onRangeChange during a drag. The band itself tracks
// the pointer instantly via local drag state; only the (expensive) consumer
// updates — marker refetches, cave tile rescans — are held back.
const RANGE_DEBOUNCE_MS = 250

interface YRangeGaugeProps {
  /** Effective anchor (already resolved by the caller — live player Y when
   *  locked, frozen Y when not). */
  anchorY: number
  /** Window offsets relative to anchorY (low ≤ 0 ≤ high in practice). */
  low: number
  high: number
  /** Green notch; null hides it. */
  playerY: number | null
  locked: boolean
  onRangeChange: (low: number, high: number) => void
  onLockChange: (locked: boolean, anchorY: number | null) => void
  yMin?: number
  yMax?: number
  snap?: number
  height?: number
  /** Renders in the header row, left of the lock button. */
  headerExtra?: React.ReactNode
}

/**
 * Vertical Y-range gauge: a highlighted band on a Y scale with draggable
 * ceiling/floor handles (the band itself drags to shift the whole window) and
 * the player as a green notch.
 *
 * The lock toggles what the window is anchored to. Locked → live player Y
 * (the band follows them as they move). Unlocked → the anchor freezes at that
 * moment's Y, the band stays put, and the notch roams free.
 */
export default function YRangeGauge({
  anchorY, low, high, playerY, locked, onRangeChange, onLockChange,
  yMin = -64, yMax = 320, snap = 10, height = 240, headerExtra,
}: YRangeGaugeProps) {
  const yToPx = (y: number) => ((yMax - y) / (yMax - yMin)) * height

  // Live values while dragging; null when idle (render from props).
  const [dragRange, setDragRange] = useState<{ low: number; high: number } | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }, [])

  const effLow  = dragRange?.low  ?? low
  const effHigh = dragRange?.high ?? high
  const ceilingY = anchorY + effHigh
  const floorY   = anchorY + effLow

  const scaleMarks: number[] = []
  for (let y = yMax; y >= yMin; y -= 64) scaleMarks.push(y)

  const dragStart = (kind: 'ceiling' | 'floor' | 'band') => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startClientY = e.clientY
    const c0 = ceilingY, f0 = floorY
    const blocksPerPx = (yMax - yMin) / height
    let lastLow = low, lastHigh = high

    const onMove = (ev: PointerEvent) => {
      // Up on screen = +Y; snap to the step.
      const dBlocks = Math.round(((startClientY - ev.clientY) * blocksPerPx) / snap) * snap
      let c = c0, f = f0
      if (kind === 'band') {
        const size = c0 - f0
        c = Math.min(yMax, Math.max(yMin + size, c0 + dBlocks))
        f = c - size
      } else if (kind === 'ceiling') {
        c = Math.min(yMax, Math.max(f0 + snap, c0 + dBlocks))
      } else {
        f = Math.max(yMin, Math.min(c0 - snap, f0 + dBlocks))
      }
      const nextLow = f - anchorY, nextHigh = c - anchorY
      if (nextLow === lastLow && nextHigh === lastHigh) return
      lastLow = nextLow; lastHigh = nextHigh
      setDragRange({ low: nextLow, high: nextHigh })
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => onRangeChange(nextLow, nextHigh), RANGE_DEBOUNCE_MS)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      // Flush: the release position is final — don't leave it to the timer.
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (lastLow !== low || lastHigh !== high) onRangeChange(lastLow, lastHigh)
      setDragRange(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const toggleLock = () => onLockChange(!locked, locked ? anchorY : null)

  return (
    <>
      <div className="yg-header">
        {headerExtra}
        <button className={`yg-lock${locked ? ' yg-lock--locked' : ''}`} onClick={toggleLock}
          title={locked
            ? 'Following player — the window moves with them. Click to freeze it in place.'
            : 'Window frozen in place. Click to follow the player again.'}>
          {locked ? <IconLock /> : <IconLockOpen />}
        </button>
      </div>

      <div className="yg-gauge" style={{ height }}>
        <div className="yg-scale">
          {scaleMarks.map(y => (
            <span key={y} className="yg-scale-num" style={{ top: yToPx(y) }}>{y}</span>
          ))}
        </div>

        <div className="yg-track">
          <div className="yg-band"
            style={{ top: yToPx(ceilingY), height: yToPx(floorY) - yToPx(ceilingY) }}
            onPointerDown={dragStart('band')}
            title="Drag to shift the window">
            <div className="yg-handle yg-handle--ceiling"
              onPointerDown={dragStart('ceiling')} title="Drag the ceiling" />
            <div className="yg-handle yg-handle--floor"
              onPointerDown={dragStart('floor')} title="Drag the floor" />
          </div>
          {playerY != null && (
            <div className="yg-player" style={{ top: yToPx(playerY) }}
              title={`Player · Y ${playerY}`} />
          )}
        </div>

        <div className="yg-values">
          <span className="yg-val yg-val--ceiling" style={{ top: yToPx(ceilingY) }}>{ceilingY}</span>
          {playerY != null && (
            <span className="yg-val yg-val--player" style={{ top: yToPx(playerY) }}>{playerY}</span>
          )}
          <span className="yg-val yg-val--floor" style={{ top: yToPx(floorY) }}>{floorY}</span>
        </div>
      </div>
    </>
  )
}
