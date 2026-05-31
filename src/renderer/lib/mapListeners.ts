import L from 'leaflet'

/**
 * Attaches debounced moveend + zoomend listeners to a Leaflet map.
 * Returns a cleanup function that removes the listeners and cancels any
 * pending timer — call it from a useEffect cleanup.
 */
export function setupDebouncedMapListeners(
  map: L.Map,
  callback: () => void,
  delayMs: number,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const debounced = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(callback, delayMs)
  }
  map.on('moveend', debounced)
  map.on('zoomend', debounced)
  return () => {
    map.off('moveend', debounced)
    map.off('zoomend', debounced)
    if (timer) clearTimeout(timer)
  }
}
