import React, { useState, useRef, useEffect } from 'react'
import { useApp } from '../App'
import WorldFlyout from './rail/WorldFlyout'
import LayersFlyout from './rail/LayersFlyout'
import StructuresFlyout from './rail/StructuresFlyout'
import WorldDataFlyout from './rail/WorldDataFlyout'
import SavedFlyout from './rail/SavedFlyout'
import SettingsFlyout from './rail/SettingsFlyout'
import ExportMapDialog from './ExportMapDialog'
import WorldSettingsPanel from './WorldSettingsPanel'
import { IconWorld, IconLayers, IconPlaces, IconWorldData, IconSaved, IconSettings } from './icons'

type ActivePanel = 'world' | 'layers' | 'structures' | 'worldData' | 'saved' | 'settings' | null

const PANEL_MIN      = 200
const PANEL_MAX      = 600
const PANEL_DEFAULT  = 264
const STORAGE_KEY    = 'rail-panel-width'
const CLOSE_MS       = 200   // must match CSS transition duration

export default function Rail() {
  const { state } = useApp()
  // active drives the CSS width (0 or panelWidth).
  // renderTarget lags on close so content stays visible during the collapse.
  const [active,       setActive]       = useState<ActivePanel>(null)
  const [renderTarget, setRenderTarget] = useState<ActivePanel>(null)
  const [exportOpen,        setExportOpen]        = useState(false)
  const [worldSettingsOpen, setWorldSettingsOpen] = useState(false)

  const [panelWidth, setPanelWidth] = useState<number>(() => {
    const s = localStorage.getItem(STORAGE_KEY)
    return s ? Math.max(PANEL_MIN, Math.min(PANEL_MAX, parseInt(s, 10))) : PANEL_DEFAULT
  })
  const [isResizing, setIsResizing] = useState(false)

  const panelWidthRef  = useRef(panelWidth)
  panelWidthRef.current = panelWidth
  const closeTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
  }, [])

  const toggle = (id: ActivePanel) => {
    if (active === id) {
      // Collapse: animate width to 0, then unmount content
      setActive(null)
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
      closeTimerRef.current = setTimeout(() => setRenderTarget(null), CLOSE_MS)
    } else {
      // Open or switch panels
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
      setActive(id)
      setRenderTarget(id)
    }
  }

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX     = e.clientX
    const startWidth = panelWidthRef.current
    const scale      = state.uiScale   // capture so drag delta is in logical px
    setIsResizing(true)

    const onMove = (ev: MouseEvent) => {
      const newWidth = Math.max(
        PANEL_MIN,
        Math.min(PANEL_MAX, Math.round(startWidth + (ev.clientX - startX) / scale)),
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

  return (
    <div className="rail" style={{ zoom: state.uiScale }}>

      {/* ── Icon column ── */}
      <div className="rail-icon-col">
        <RailBtn icon={<IconWorld />}    label="World"    active={active === 'world'}    onClick={() => toggle('world')} />
        <RailBtn icon={<IconLayers />}   label="Layers"   active={active === 'layers'}   onClick={() => toggle('layers')} />
        <RailBtn icon={<IconPlaces />}   label="Structures" active={active === 'structures'} onClick={() => toggle('structures')} />
        <RailBtn icon={<IconWorldData />} label="World Data" active={active === 'worldData'} onClick={() => toggle('worldData')} />
        <RailBtn icon={<IconSaved />}    label="Saved"    active={active === 'saved'}    onClick={() => toggle('saved')} />
        <RailBtn icon={<IconSettings />} label="Settings" active={active === 'settings'} onClick={() => toggle('settings')} />
      </div>

      {/* ── Content panel (in-flow, pushes map canvas) ── */}
      <div
        className={`rail-panel${isResizing ? ' rail-panel--resizing' : ''}`}
        style={{ width: active ? panelWidth : 0 }}
      >
        <div className="rail-panel-inner" style={{ width: panelWidth }}>

          {renderTarget === 'world'    && (
            <WorldFlyout
              onExport={() => { setExportOpen(true); toggle('world') }}
              onWorldSettings={() => { setWorldSettingsOpen(true); toggle('world') }}
            />
          )}
          {renderTarget === 'layers'     && <LayersFlyout />}
          {renderTarget === 'structures' && <StructuresFlyout />}
          {renderTarget === 'worldData'  && <WorldDataFlyout />}
          {renderTarget === 'saved'      && <SavedFlyout />}
          {renderTarget === 'settings'   && <SettingsFlyout />}

          {/* Resize handle — only interactive when open */}
          {active && (
            <div className="rail-resize-handle" onMouseDown={startResize} />
          )}

        </div>
      </div>

      {exportOpen        && <ExportMapDialog    onClose={() => setExportOpen(false)} />}
      {worldSettingsOpen && state.worldDir && <WorldSettingsPanel onClose={() => setWorldSettingsOpen(false)} />}
    </div>
  )
}

function RailBtn({ icon, label, active, onClick, indicator }: {
  icon: React.ReactNode; label: string; active: boolean; onClick: () => void
  indicator?: 'green' | 'red'
}) {
  return (
    <button className={`rail-btn${active ? ' active' : ''}`} onClick={onClick} title={label}>
      <span className="rail-btn-icon">
        {icon}
        {indicator && <span className={`rail-btn-indicator rail-btn-indicator--${indicator}`} />}
      </span>
      <span className="rail-btn-label">{label}</span>
    </button>
  )
}
