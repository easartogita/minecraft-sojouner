# Bugs

_No open bugs._

---

## Fixed

### Marker layer doesn't unload below its zoom threshold

Markers (chests, entities, POI) loaded at ≥ z5 but never cleared when zooming back out,
cluttering wide views. The z5 gate was a *fetch*-only guard inside the layers; the Leaflet
markers themselves were never removed.

**Fixed:** the marker layers now mount on `state.zoom >= state.markerMinZoom`
(`MapView.tsx:523-525`), so they unmount and clear below threshold.

_Found 2026-06-23 during feature-screenshot capture._
