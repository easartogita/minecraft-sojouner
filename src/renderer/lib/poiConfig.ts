import L from 'leaflet'
import { PROFESSION_CONFIG } from './entityConfig'
import { tooltipText } from './chunkMarkerLayer'

export interface PoiConfig {
  color: string
  initial: string
  label: string
}

const POI_CONFIG: Record<string, PoiConfig> = {
  // Portals
  nether_portal: { color: '#9333ea', initial: 'P', label: 'Nether Portal' },
  // Utility blocks
  lodestone:     { color: '#6366f1', initial: 'L', label: 'Lodestone' },
  // Villager jobsites — shares colors with PROFESSION_CONFIG
  farmer:        { color: '#4caf50', initial: 'F', label: 'Farmer' },
  fisherman:     { color: '#0288d1', initial: 'F', label: 'Fisherman' },
  shepherd:      { color: '#a5d6a7', initial: 'S', label: 'Shepherd' },
  fletcher:      { color: '#8bc34a', initial: 'F', label: 'Fletcher' },
  cleric:        { color: '#7b1fa2', initial: 'C', label: 'Cleric' },
  weaponsmith:   { color: '#e64a19', initial: 'W', label: 'Weaponsmith' },
  armorer:       { color: '#b71c1c', initial: 'A', label: 'Armorer' },
  toolsmith:     { color: '#f57c00', initial: 'T', label: 'Toolsmith' },
  librarian:     { color: '#795548', initial: 'L', label: 'Librarian' },
  cartographer:  { color: '#00897b', initial: 'C', label: 'Cartographer' },
  leatherworker: { color: '#a1887f', initial: 'L', label: 'Leatherworker' },
  butcher:       { color: '#546e7a', initial: 'B', label: 'Butcher' },
  mason:         { color: '#78909c', initial: 'M', label: 'Mason' },
  nitwit:        { color: '#66bb6a', initial: 'N', label: 'Nitwit' },
  // Must match the 'bell' entry in blockEntityConfig.ts — this is the marker actually
  // rendered (see POI_SHADOWED_BE_TYPES in BlockEntityLayer.tsx).
  meeting_point: { color: '#4f46e5', initial: 'B', label: 'Bell' },
  home:          { color: '#e91e63', initial: 'Z', label: 'Bed' },
}

export function getPoiConfig(kind: string): PoiConfig {
  if (POI_CONFIG[kind]) return POI_CONFIG[kind]
  // Derive from profession config if available (POI kind matches profession key)
  if (PROFESSION_CONFIG[kind]) return PROFESSION_CONFIG[kind]
  const initial = kind.charAt(0).toUpperCase()
  const label   = kind.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  return { color: '#f97316', initial, label }
}

function netherPortalDetail(x: number, z: number, dimension: string): string {
  if (dimension === 'overworld') {
    const nx = Math.round(x / 8), nz = Math.round(z / 8)
    return `<div class="entity-detail">Est. Nether: <b>X: ${nx}, Z: ${nz}</b></div>`
  }
  if (dimension === 'nether') {
    return `<div class="entity-detail">Est. Overworld: <b>X: ${x * 8}, Z: ${z * 8}</b></div>`
  }
  return ''
}

function netherPortalTooltipSuffix(x: number, z: number, dimension: string): string | null {
  if (dimension === 'overworld') return `→ Nether ~${Math.round(x / 8)}, ~${Math.round(z / 8)}`
  if (dimension === 'nether')    return `→ Overworld ~${x * 8}, ~${z * 8}`
  return null
}

export function buildPopup(rec: PoiRecord, dimension = 'overworld'): string {
  const cfg = getPoiConfig(rec.kind)
  let body: string
  if (rec.kind === 'nether_portal') {
    body = netherPortalDetail(rec.x, rec.z, dimension)
  } else if (rec.kind === 'lodestone') {
    body = ''
  } else {
    body = rec.freeTickets === 0
      ? '<div class="entity-muted">Fully claimed</div>'
      : `<div class="entity-detail">${rec.freeTickets} free slot${rec.freeTickets !== 1 ? 's' : ''}</div>`
  }
  return `
    <div class="popup-content">
      <div class="popup-title">${cfg.label}</div>
      <div class="popup-coords">X: ${rec.x}, Y: ${rec.y}, Z: ${rec.z}</div>
      ${body}
    </div>`
}

export function buildTooltip(rec: PoiRecord, dimension = 'overworld'): string {
  const cfg    = getPoiConfig(rec.kind)
  let subtitle: string | null
  if (rec.kind === 'nether_portal') {
    subtitle = netherPortalTooltipSuffix(rec.x, rec.z, dimension) ?? cfg.label
  } else if (rec.kind === 'lodestone') {
    subtitle = null
  } else {
    subtitle = rec.freeTickets === 0
      ? 'Fully claimed'
      : `${rec.freeTickets} free slot${rec.freeTickets !== 1 ? 's' : ''}`
  }
  return tooltipText(cfg.label, subtitle)
}

export function createIcon(cfg: PoiConfig, tooltip: string): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div class="be-marker" style="background:${cfg.color}" title="${tooltip}" role="button" aria-label="${tooltip}">${cfg.initial}</div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  })
}
