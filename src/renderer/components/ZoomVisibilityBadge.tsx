import React from 'react'

interface ZoomVisibilityBadgeProps {
  checked: boolean
  currentZoom: number
  minZoom: number
  /** Dot-only form (no "zoom ≥ N" text, info moves to the title tooltip) for
   *  tight layouts. */
  compact?: boolean
}

/** Reactive counterpart to a static "zoom ≥ N" hint: reflects whether a
 *  toggle is off, on but below its render threshold at the current zoom
 *  (nothing is actually showing), or on and visible. */
export default function ZoomVisibilityBadge({ checked, currentZoom, minZoom, compact }: ZoomVisibilityBadgeProps) {
  const variant = !checked ? 'off' : currentZoom < minZoom ? 'blocked' : 'visible'
  const text = `zoom ≥ ${minZoom}`
  if (compact) {
    return <span className={`mp-zoom-hint mp-zoom-hint--dot mp-zoom-hint--${variant}`} title={text} role="img" aria-label={text} />
  }
  return <span className={`mp-zoom-hint mp-zoom-hint--${variant}`}>{text}</span>
}
