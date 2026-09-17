import React from 'react'

// Every glyph is drawn on a strict 16×16 grid from integer-coordinate rects, matching
// the game's own texture discipline. Single color via currentColor; shading via opacity.

export interface IconProps {
  size?: number
  className?: string
}

function Px({ size = 16, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  )
}

/** Grass block, front face — uneven grass line over speckled dirt. */
export function IconWorld({ size, className }: IconProps) {
  return (
    <Px size={size} className={className}>
      {/* grass cap with drips */}
      <rect x={1} y={1} width={14} height={3} />
      <rect x={2} y={4} width={2} height={1} />
      <rect x={6} y={4} width={3} height={1} />
      <rect x={11} y={4} width={2} height={1} />
      {/* block outline */}
      <rect x={1} y={4} width={1} height={10} />
      <rect x={14} y={4} width={1} height={10} />
      <rect x={1} y={14} width={14} height={1} />
      {/* dirt speckles */}
      <g opacity={0.35}>
        <rect x={4} y={7} width={1} height={1} />
        <rect x={11} y={6} width={1} height={1} />
        <rect x={8} y={9} width={1} height={1} />
        <rect x={5} y={11} width={1} height={1} />
        <rect x={10} y={12} width={1} height={1} />
      </g>
    </Px>
  )
}

/** Three strata slabs fading with depth — Surface / Cave / Deep. */
export function IconLayers({ size, className }: IconProps) {
  return (
    <Px size={size} className={className}>
      <rect x={2} y={2} width={12} height={3} />
      <rect x={2} y={7} width={12} height={3} opacity={0.6} />
      <rect x={2} y={12} width={12} height={3} opacity={0.3} />
    </Px>
  )
}

/** Compass — chunky ring, stepped diagonal needle with fading tail. */
export function IconPlaces({ size, className }: IconProps) {
  return (
    <Px size={size} className={className}>
      {/* ring */}
      <rect x={5} y={1} width={6} height={1} />
      <rect x={3} y={2} width={2} height={1} />
      <rect x={11} y={2} width={2} height={1} />
      <rect x={2} y={3} width={1} height={2} />
      <rect x={13} y={3} width={1} height={2} />
      <rect x={1} y={5} width={1} height={6} />
      <rect x={14} y={5} width={1} height={6} />
      <rect x={2} y={11} width={1} height={2} />
      <rect x={13} y={11} width={1} height={2} />
      <rect x={3} y={13} width={2} height={1} />
      <rect x={11} y={13} width={2} height={1} />
      <rect x={5} y={14} width={6} height={1} />
      {/* needle NE, tail SW */}
      <rect x={9} y={4} width={2} height={2} />
      <rect x={7} y={6} width={2} height={2} />
      <g opacity={0.4}>
        <rect x={5} y={8} width={2} height={2} />
        <rect x={3} y={10} width={2} height={2} />
      </g>
    </Px>
  )
}

/** Chest, front face — lid seam and latch; the world's saved data. */
export function IconWorldData({ size, className }: IconProps) {
  return (
    <Px size={size} className={className}>
      {/* box outline */}
      <rect x={1} y={2} width={14} height={1} />
      <rect x={1} y={3} width={1} height={11} />
      <rect x={14} y={3} width={1} height={11} />
      <rect x={1} y={13} width={14} height={1} />
      {/* lid seam */}
      <rect x={2} y={6} width={5} height={1} opacity={0.6} />
      <rect x={9} y={6} width={5} height={1} opacity={0.6} />
      {/* latch */}
      <rect x={7} y={5} width={2} height={3} />
    </Px>
  )
}

/** Banner / swallowtail flag — the game's waypoint vernacular. */
export function IconSaved({ size, className }: IconProps) {
  return (
    <Px size={size} className={className}>
      <rect x={4} y={1} width={8} height={11} />
      <rect x={4} y={12} width={3} height={2} />
      <rect x={9} y={12} width={3} height={2} />
    </Px>
  )
}

/** Map pin — lollipop head, stem, ground shadow. */
export function IconPin({ size, className }: IconProps) {
  return (
    <Px size={size} className={className}>
      {/* head */}
      <rect x={6} y={1} width={4} height={1} />
      <rect x={5} y={2} width={6} height={4} />
      <rect x={6} y={6} width={4} height={1} />
      {/* stem */}
      <rect x={7} y={7} width={2} height={5} />
      {/* ground shadow */}
      <rect x={5} y={13} width={6} height={1} opacity={0.3} />
    </Px>
  )
}

/** Route — waypoint nodes joined by a stepped trail. */
export function IconRoute({ size, className }: IconProps) {
  return (
    <Px size={size} className={className}>
      {/* nodes */}
      <rect x={2} y={12} width={3} height={3} />
      <rect x={7} y={7} width={3} height={3} />
      <rect x={12} y={2} width={3} height={3} />
      {/* trail */}
      <g opacity={0.5}>
        <rect x={5} y={11} width={1} height={1} />
        <rect x={6} y={10} width={1} height={1} />
        <rect x={10} y={6} width={1} height={1} />
        <rect x={11} y={5} width={1} height={1} />
      </g>
    </Px>
  )
}

/** Folder with tab. */
export function IconFolder({ size, className }: IconProps) {
  return (
    <Px size={size} className={className}>
      <rect x={2} y={3} width={5} height={2} />
      <rect x={2} y={5} width={12} height={8} />
    </Px>
  )
}

/** Lightning bolt — stepped diagonal with a kink. */
export function IconBolt({ size, className }: IconProps) {
  return (
    <Px size={size} className={className}>
      <rect x={8} y={1} width={4} height={2} />
      <rect x={7} y={3} width={4} height={2} />
      <rect x={6} y={5} width={4} height={2} />
      <rect x={6} y={7} width={6} height={1} />
      <rect x={6} y={8} width={3} height={2} />
      <rect x={5} y={10} width={3} height={2} />
      <rect x={4} y={12} width={2} height={2} />
      <rect x={3} y={14} width={2} height={1} />
    </Px>
  )
}

/** Die, five face. */
export function IconDice({ size, className }: IconProps) {
  return (
    <Px size={size} className={className}>
      {/* outline */}
      <rect x={2} y={2} width={12} height={1} />
      <rect x={2} y={13} width={12} height={1} />
      <rect x={2} y={3} width={1} height={10} />
      <rect x={13} y={3} width={1} height={10} />
      {/* pips */}
      <rect x={4} y={4} width={2} height={2} />
      <rect x={10} y={4} width={2} height={2} />
      <rect x={7} y={7} width={2} height={2} />
      <rect x={4} y={10} width={2} height={2} />
      <rect x={10} y={10} width={2} height={2} />
    </Px>
  )
}

/** Two overlapping block outlines — duplicate/stamp motif for structure copy/paste. */
export function IconStructureCopy({ size, className }: IconProps) {
  return (
    <Px size={size} className={className}>
      <g opacity={0.45}>
        <rect x={1} y={1} width={9} height={1} />
        <rect x={1} y={1} width={1} height={9} />
        <rect x={9} y={1} width={1} height={9} />
        <rect x={1} y={9} width={9} height={1} />
      </g>
      <rect x={6} y={6} width={9} height={1} />
      <rect x={6} y={6} width={1} height={9} />
      <rect x={14} y={6} width={1} height={9} />
      <rect x={6} y={14} width={9} height={1} />
    </Px>
  )
}

/** Export — arrow dropping into a tray. */
export function IconExport({ size, className }: IconProps) {
  return (
    <Px size={size} className={className}>
      {/* arrow */}
      <rect x={7} y={1} width={2} height={6} />
      <rect x={5} y={7} width={6} height={1} />
      <rect x={6} y={8} width={4} height={1} />
      <rect x={7} y={9} width={2} height={1} />
      {/* tray */}
      <rect x={2} y={11} width={1} height={3} />
      <rect x={13} y={11} width={1} height={3} />
      <rect x={2} y={14} width={12} height={1} />
    </Px>
  )
}

/** Crosshair — ring, cardinal ticks, center dot. */
export function IconCenter({ size, className }: IconProps) {
  return (
    <Px size={size} className={className}>
      {/* ring */}
      <rect x={6} y={3} width={4} height={1} />
      <rect x={4} y={4} width={2} height={1} />
      <rect x={10} y={4} width={2} height={1} />
      <rect x={3} y={6} width={1} height={4} />
      <rect x={12} y={6} width={1} height={4} />
      <rect x={4} y={11} width={2} height={1} />
      <rect x={10} y={11} width={2} height={1} />
      <rect x={6} y={12} width={4} height={1} />
      {/* cardinal ticks */}
      <rect x={7} y={1} width={2} height={3} />
      <rect x={7} y={12} width={2} height={3} />
      <rect x={1} y={7} width={3} height={2} />
      <rect x={12} y={7} width={3} height={2} />
      {/* center dot */}
      <rect x={7} y={7} width={2} height={2} />
    </Px>
  )
}

/** Player locator — the vanilla map's notched arrow. */
export function IconFollow({ size, className }: IconProps) {
  return (
    <Px size={size} className={className}>
      <rect x={7} y={2} width={2} height={2} />
      <rect x={6} y={4} width={4} height={2} />
      <rect x={5} y={6} width={6} height={2} />
      <rect x={4} y={8} width={8} height={2} />
      {/* notched tail */}
      <rect x={4} y={10} width={3} height={3} />
      <rect x={9} y={10} width={3} height={3} />
    </Px>
  )
}

/** Closed padlock — body with keyhole, shackle attached both sides. */
export function IconLock({ size, className }: IconProps) {
  return (
    <Px size={size} className={className}>
      <rect x={5} y={2} width={6} height={1} />
      <rect x={4} y={3} width={1} height={4} />
      <rect x={11} y={3} width={1} height={4} />
      <path fillRule="evenodd" d="M3 7 H13 V14 H3 Z M7 9 H9 V12 H7 Z" />
    </Px>
  )
}

/** Open padlock — shackle swung up, gap on the left leg. */
export function IconLockOpen({ size, className }: IconProps) {
  return (
    <Px size={size} className={className}>
      <rect x={4} y={1} width={8} height={1} />
      <rect x={4} y={2} width={1} height={2} />
      <rect x={11} y={2} width={1} height={5} />
      <path fillRule="evenodd" d="M3 7 H13 V14 H3 Z M7 9 H9 V12 H7 Z" />
    </Px>
  )
}

/** Drafting compass — a cartography tool for a map viewer, not a mining tool.
 *  Brass hinge, two stainless-steel legs splayed from it, diamond tips. Each
 *  leg is the same straight template rotated outward from the hinge, same
 *  trick as the rest of this file uses for angled shapes — one shape, turned. */
export function IconCompass({ size, className }: IconProps) {
  return (
    <Px size={size} className={className}>
      {/* whole compass canted 15° CCW off the symmetric upright pose — less static */}
      <g transform="rotate(-15 8 8)">
        {/* left leg */}
        <g transform="rotate(-22 8 3)">
          <rect x={7} y={3} width={1} height={9} fill="#c8ced6" />
          <rect x={8} y={3} width={1} height={9} fill="#8b93a0" />
          <polygon points="7,12 8,12 8,15" fill="#8ff2e6" />
          <polygon points="8,12 9,12 8,15" fill="#2f9e93" />
        </g>
        {/* right leg */}
        <g transform="rotate(22 8 3)">
          <rect x={7} y={3} width={1} height={9} fill="#c8ced6" />
          <rect x={8} y={3} width={1} height={9} fill="#8b93a0" />
          <polygon points="7,12 8,12 8,15" fill="#8ff2e6" />
          <polygon points="8,12 9,12 8,15" fill="#2f9e93" />
        </g>
        {/* brass hinge */}
        <rect x={7} y={2} width={2} height={2} fill="#b8763f" />
        <rect x={7} y={2} width={1} height={1} fill="#e0b878" />
      </g>
    </Px>
  )
}

/** Pixel gear. */
export function IconSettings({ size, className }: IconProps) {
  return (
    <Px size={size} className={className}>
      {/* cardinal teeth */}
      <rect x={7} y={1} width={2} height={3} />
      <rect x={7} y={12} width={2} height={3} />
      <rect x={1} y={7} width={3} height={2} />
      <rect x={12} y={7} width={3} height={2} />
      {/* diagonal teeth */}
      <rect x={3} y={3} width={2} height={2} />
      <rect x={11} y={3} width={2} height={2} />
      <rect x={3} y={11} width={2} height={2} />
      <rect x={11} y={11} width={2} height={2} />
      {/* body ring with square hole */}
      <path
        fillRule="evenodd"
        d="M6 4 H10 L12 6 V10 L10 12 H6 L4 10 V6 Z M6 6 V10 H10 V6 Z"
      />
    </Px>
  )
}
