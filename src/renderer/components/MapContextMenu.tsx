import React, { useEffect, useLayoutEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
import type { Dimension } from '../lib/constants'
import * as api from '../lib/tauriAPI'

export interface ContextMenuState {
  screenX: number
  screenY: number
  blockX:  number
  blockZ:  number
  // Set when the right-click was on a specific marker rather than the background:
  blockY?:     number | null
  markerKind?: 'pin' | 'entity' | 'block_entity' | 'poi' | 'structure'
  pinId?:      string | null
  markerLabel?: string | null
}

interface Props extends ContextMenuState {
  dimension:         Dimension
  onAddPin:          (x: number, z: number) => void
  onDeletePin?:      (id: string)            => void
  onCenter:          (x: number, z: number)  => void
  onCopyLink?:       (x: number, z: number)  => void   // static export only
  onStartRoute:      (x: number, z: number)  => void
  onAddRoutePoint?:  () => void   // defined only when a route is active but not being edited
  onPinBestCopper?:  () => void   // defined only when copper veins are visible
  onPinBestIron?:    () => void   // defined only when iron veins are visible
  onClose:           () => void
}

export default function MapContextMenu({
  screenX, screenY, blockX, blockZ, blockY,
  markerKind, pinId, markerLabel,
  dimension,
  onAddPin, onDeletePin, onCenter, onCopyLink, onStartRoute, onAddRoutePoint,
  onPinBestCopper, onPinBestIron,
  onClose,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on outside click or Escape
  useEffect(() => {
    const onKey  = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const onDown = (e: MouseEvent)    => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('keydown',   onKey,  true)
    document.addEventListener('mousedown', onDown, true)
    return () => {
      document.removeEventListener('keydown',   onKey,  true)
      document.removeEventListener('mousedown', onDown, true)
    }
  }, [onClose])

  // Flip position so the menu stays inside the viewport
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const r   = el.getBoundingClientRect()
    let left  = screenX + 4
    let top   = screenY + 4
    if (left + r.width  > window.innerWidth)  left = screenX - r.width  - 4
    if (top  + r.height > window.innerHeight) top  = screenY - r.height - 4
    el.style.left       = `${Math.max(0, left)}px`
    el.style.top        = `${Math.max(0, top)}px`
    el.style.visibility = 'visible'
  }, [screenX, screenY])

  const copy = (text: string) => { navigator.clipboard.writeText(text); onClose() }

  // OW ↔ NT conversion — shown for background + pin menus when in OW/NT
  type OtherDim = { label: string; x: number; z: number }
  const other: OtherDim | null | false = (markerKind == null || markerKind === 'pin') && (
    dimension === 'overworld'
      ? { label: 'Nether', x: Math.floor(blockX / 8), z: Math.floor(blockZ / 8) }
      : dimension === 'nether'
      ? { label: 'Overworld', x: blockX * 8, z: blockZ * 8 }
      : null
  )

  // Y-aware /tp string — use actual Y for entities/BEs/POIs, tilde otherwise
  const yToken  = blockY != null ? String(Math.round(blockY)) : '~'
  const tpStr   = `/tp @s ${blockX} ${yToken} ${blockZ}`
  const coordStr = blockY != null
    ? `${blockX}, ${Math.round(blockY)}, ${blockZ}`
    : `${blockX}, ${blockZ}`

  // Human-readable kind label
  const kindLabel = markerKind === 'entity'       ? 'Entity'
    : markerKind === 'block_entity' ? 'Block Entity'
    : markerKind === 'poi'          ? 'Point of Interest'
    : markerKind === 'pin'          ? 'Pin'
    : markerKind === 'structure'    ? 'Structure'
    : null

  const isMarker     = markerKind != null
  const isBackground = !isMarker
  const isPin        = markerKind === 'pin'

  return ReactDOM.createPortal(
    <div
      ref={menuRef}
      className="ctx-menu"
      style={{ position: 'fixed', left: screenX, top: screenY, zIndex: 9999, visibility: 'hidden' }}
    >
      {isMarker ? (
        <div className="ctx-header">
          {kindLabel}{markerLabel ? `: ${markerLabel}` : ''}
          <div className="ctx-header-sub">{blockX}, {blockY != null ? `${Math.round(blockY)}, ` : ''}{blockZ}</div>
        </div>
      ) : (
        <div className="ctx-header">{blockX}, {blockZ}</div>
      )}
      <div className="ctx-sep" />

      {isBackground && (
        <button className="ctx-item" onClick={() => { onAddPin(blockX, blockZ); onClose() }}>
          <CtxIcon d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
          Add pin
        </button>
      )}

      {isBackground && (
        <button className="ctx-item" onClick={() => { onStartRoute(blockX, blockZ); onClose() }}>
          <CtxIcon d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z" />
          Start route here
        </button>
      )}

      {isBackground && onAddRoutePoint && (
        <button className="ctx-item" onClick={() => { onAddRoutePoint(); onClose() }}>
          <CtxIcon d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
          Add point to route
        </button>
      )}

      <button className="ctx-item" onClick={() => copy(coordStr)}>
        <CtxIcon d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
        Copy coords
        <span className="ctx-hint">{coordStr}</span>
      </button>

      <button className="ctx-item" onClick={() => copy(tpStr)}>
        <CtxIcon d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
        Copy <code className="ctx-code">/tp</code>
        <span className="ctx-hint">{blockX} {yToken} {blockZ}</span>
      </button>

      {api.IS_STATIC_SITE && onCopyLink && (
        <button className="ctx-item" onClick={() => { onCopyLink(blockX, blockZ); onClose() }}>
          <CtxIcon d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" />
          Copy link to here...
        </button>
      )}

      {other && (
        <button className="ctx-item" onClick={() => copy(`${other.x}, ${other.z}`)}>
          <CtxIcon d="M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z" />
          {other.label} coords
          <span className="ctx-hint">{other.x}, {other.z}</span>
        </button>
      )}

      {isBackground && (
        <>
          <div className="ctx-sep" />
          <button className="ctx-item" onClick={() => { onCenter(blockX, blockZ); onClose() }}>
            <CtxIcon d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3A8.994 8.994 0 0 0 13 3.06V1h-2v2.06A8.994 8.994 0 0 0 3.06 11H1v2h2.06A8.994 8.994 0 0 0 11 20.94V23h2v-2.06A8.994 8.994 0 0 0 20.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z" />
            Center here
          </button>
          {(onPinBestCopper || onPinBestIron) && (
            <>
              <div className="ctx-sep" />
              {onPinBestCopper && (
                <button className="ctx-item" onClick={() => { onPinBestCopper(); onClose() }}>
                  <CtxIcon d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" color="#b87333" />
                  <span style={{ color: '#b87333' }}>Pin best copper vein</span>
                  <span className="ctx-hint">nearby</span>
                </button>
              )}
              {onPinBestIron && (
                <button className="ctx-item" onClick={() => { onPinBestIron(); onClose() }}>
                  <CtxIcon d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" color="#a8a9ad" />
                  <span style={{ color: '#a8a9ad' }}>Pin best iron vein</span>
                  <span className="ctx-hint">nearby</span>
                </button>
              )}
            </>
          )}
        </>
      )}

      {isPin && pinId && onDeletePin && (
        <>
          <div className="ctx-sep" />
          <button className="ctx-item ctx-item--danger" onClick={() => { onDeletePin(pinId); onClose() }}>
            <CtxIcon d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
            Delete pin
          </button>
        </>
      )}
    </div>,
    document.body,
  )
}

function CtxIcon({ d, color }: { d: string; color?: string }) {
  return (
    <svg
      className="ctx-item-icon"
      viewBox="0 0 24 24"
      width="14" height="14"
      fill={color ?? 'currentColor'}
      style={{ flexShrink: 0 }}
    >
      <path d={d} />
    </svg>
  )
}
