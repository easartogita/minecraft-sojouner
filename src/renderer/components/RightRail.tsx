import { useState, useRef, useEffect } from 'react'
import { useApp } from '../App'
import StructureCopyFlyout from './rail/StructureCopyFlyout'
import { IconStructureCopy } from './icons'

// Mirrors Rail.tsx's structure (icon column + collapsible content panel), but
// the panel sits to the left of its icon column so it opens toward the map,
// away from the screen edge — see RailBtn/toggle below for the same
// active/renderTarget-lag pattern Rail.tsx uses for the collapse animation.
type ActivePanel = 'structureCopy' | null

const PANEL_MIN     = 200
const PANEL_MAX     = 600
const PANEL_DEFAULT = 280
const STORAGE_KEY   = 'rail-right-panel-width'
const CLOSE_MS      = 200   // must match CSS transition duration

export default function RightRail() {
  const { state } = useApp()
  const [active,       setActive]       = useState<ActivePanel>(null)
  const [renderTarget, setRenderTarget] = useState<ActivePanel>(null)

  const [panelWidth, setPanelWidth] = useState<number>(() => {
    const s = localStorage.getItem(STORAGE_KEY)
    return s ? Math.max(PANEL_MIN, Math.min(PANEL_MAX, parseInt(s, 10))) : PANEL_DEFAULT
  })
  const [isResizing, setIsResizing] = useState(false)

  const panelWidthRef = useRef(panelWidth)
  panelWidthRef.current = panelWidth
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
  }, [])

  const toggle = (id: ActivePanel) => {
    if (active === id) {
      setActive(null)
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
      closeTimerRef.current = setTimeout(() => setRenderTarget(null), CLOSE_MS)
    } else {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
      setActive(id)
      setRenderTarget(id)
    }
  }

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX     = e.clientX
    const startWidth = panelWidthRef.current
    const scale      = state.uiScale
    setIsResizing(true)

    // Panel is on the left of its icon column here, so dragging right (positive
    // delta) should shrink it, not grow it — inverse of Rail.tsx's left-edge rail.
    const onMove = (ev: MouseEvent) => {
      const newWidth = Math.max(
        PANEL_MIN,
        Math.min(PANEL_MAX, Math.round(startWidth - (ev.clientX - startX) / scale)),
      )
      setPanelWidth(newWidth)
    }
    const onUp = () => {
      setIsResizing(false)
      localStorage.setItem(STORAGE_KEY, String(panelWidthRef.current))
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup',  onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
  }

  // v0: the only entry is the dev-only structure-copy tool, so there's nothing
  // for this rail to show in a release build. Once Route Planner migrates in
  // (see TODO.md), this early-return goes away.
  if (!import.meta.env.DEV) return null

  return (
    <div className="rail rail-right" style={{ zoom: state.uiScale }}>

      <div
        className={`rail-panel rail-panel-right${isResizing ? ' rail-panel--resizing' : ''}`}
        style={{ width: active ? panelWidth : 0 }}
      >
        <div className="rail-panel-inner" style={{ width: panelWidth }}>
          {renderTarget === 'structureCopy' && <StructureCopyFlyout />}
          {active && (
            <div className="rail-resize-handle rail-resize-handle-left" onMouseDown={startResize} />
          )}
        </div>
      </div>

      <div className="rail-icon-col rail-icon-col-right">
        <RailBtn icon={<IconStructureCopy />} label="Structures" active={active === 'structureCopy'}
          onClick={() => toggle('structureCopy')} />
      </div>

    </div>
  )
}

function RailBtn({ icon, label, active, onClick }: {
  icon: React.ReactNode; label: string; active: boolean; onClick: () => void
}) {
  return (
    <button className={`rail-btn${active ? ' active' : ''}`} onClick={onClick} title={label}>
      <span className="rail-btn-icon">{icon}</span>
      <span className="rail-btn-label">{label}</span>
    </button>
  )
}
