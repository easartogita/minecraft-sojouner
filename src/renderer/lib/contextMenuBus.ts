import L from 'leaflet'

/**
 * Module-level bus for marker right-clicks.
 *
 * Leaflet markers are created imperatively inside hook callbacks — they can't
 * easily accept a React prop for "open context menu".  Instead the marker's
 * contextmenu handler calls `emitMarkerMenu`, and MapView (which owns the
 * context-menu state) has registered a handler via `setMarkerMenuHandler`.
 *
 * Use `attachMarkerContextMenu` to bind the handler to a marker — it handles
 * preventDefault + stopPropagation automatically so callers only supply the
 * emit payload.
 */

export interface MarkerMenuEmit {
  screenX: number
  screenY: number
  blockX:  number
  blockZ:  number
  blockY:  number | null   // actual MC Y for entities / BEs / POIs; null otherwise
  kind:    'pin' | 'entity' | 'block_entity' | 'poi' | 'structure'
  label:   string | null   // display label (entity type, BE type, pin label, …)
  pinId:   string | null   // only for pins — enables Delete action
}

type Handler = (opts: MarkerMenuEmit) => void
let _handler: Handler | null = null

export function setMarkerMenuHandler(fn: Handler | null): void { _handler = fn }
export function emitMarkerMenu(opts: MarkerMenuEmit): void      { _handler?.(opts) }

/**
 * Attach a contextmenu listener to a Leaflet marker.
 * Handles preventDefault + stopPropagation; callers provide only the
 * emit payload (everything except screenX/screenY which are taken from the event).
 */
export function attachMarkerContextMenu(
  marker: L.Marker,
  getPayload: () => Omit<MarkerMenuEmit, 'screenX' | 'screenY'>,
): void {
  marker.on('contextmenu', (e: L.LeafletMouseEvent) => {
    e.originalEvent.preventDefault()
    L.DomEvent.stopPropagation(e)
    emitMarkerMenu({
      screenX: e.originalEvent.clientX,
      screenY: e.originalEvent.clientY,
      ...getPayload(),
    })
  })
}
