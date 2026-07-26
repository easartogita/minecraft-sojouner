import L from 'leaflet'

// Coincident markers (same X/Z, different Y — e.g. the two stacked chests in an
// Abandoned Camp) all land on the identical map point, so the lower ones are
// buried. A MarkerSpider shows a single badge "anchor" at that point; clicking it
// fans the real markers out (each keeps its own icon/popup/context menu). While
// fanned, the rest of the map is dimmed and the fan renders in a pane above every
// other marker, so it reads as one focused group instead of colliding with them.

let openSpider: MarkerSpider | null = null

/** Collapse whatever spider is currently fanned out (map click / zoom / etc.). */
export function collapseOpenSpider(): void { openSpider?.collapse() }

// Panes: markerPane is z-index 600 and holds every normal marker; tooltipPane is
// 650. The dimmer sits just above the markers, the fan just above the dimmer.
export const SPIDER_PANE = 'spiderMarkers'
const BACKDROP_PANE = 'spiderBackdrop'

export function ensureSpiderPanes(map: L.Map): void {
  if (!map.getPane(BACKDROP_PANE)) map.createPane(BACKDROP_PANE).style.zIndex = '640'
  if (!map.getPane(SPIDER_PANE))   map.createPane(SPIDER_PANE).style.zIndex   = '646'
}

// Up to this many fan out as a single clean ring; beyond it, a ring's radius
// grows linearly with N and runs off-screen (a 122-stack needs a ~500px ring),
// so switch to an Archimedean spiral that packs markers into a compact 2-D area.
const CIRCLE_MAX = 9

export class MarkerSpider {
  private expanded = false
  private legs: L.Polyline[] = []
  private backdrop: L.Rectangle | null = null

  constructor(
    private map: L.Map,
    private group: L.LayerGroup,
    private anchor: L.Marker,
    private children: L.Marker[],
  ) {
    ensureSpiderPanes(map)
    anchor.on('click', () => this.toggle())
    // Pool eviction / clear removes the anchor from the group; tear the fan down
    // with it so orphaned children/legs/backdrop can't linger on a reload.
    anchor.on('remove', () => this.collapse())
  }

  /** Fan offsets (screen px, relative to the anchor). Ring for small stacks;
   *  spiral (à la Leaflet.markercluster) for large ones so nothing overruns the
   *  viewport. */
  private fanOffsets(): L.Point[] {
    const n = this.children.length
    const pts: L.Point[] = []
    if (n <= CIRCLE_MAX) {
      const radius = 16 + n * 4
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * i) / n - Math.PI / 2 // start at 12 o'clock
        pts.push(L.point(Math.cos(a) * radius, Math.sin(a) * radius))
      }
    } else {
      // Archimedean spiral, Leaflet.markercluster constants. legLength (the
      // radius) grows ~√i, so ~122 markers pack into ~150-200px, not a 500px ring.
      const separation = 28
      const lengthFactor = 2 * Math.PI * 5   // ≈ 31.4 — small on purpose; larger blows up fast
      let legLength = 11
      let angle = 0
      for (let i = 0; i < n; i++) {
        angle += separation / legLength + i * 0.0005
        pts.push(L.point(Math.cos(angle) * legLength, Math.sin(angle) * legLength))
        legLength += lengthFactor / angle
      }
    }
    return pts
  }

  private toggle(): void { this.expanded ? this.collapse() : this.expand() }

  expand(): void {
    if (this.expanded) return
    if (openSpider && openSpider !== this) openSpider.collapse()
    openSpider = this

    // Dim everything else so the fan doesn't blend into surrounding markers.
    // Clicking the dimmer collapses. Padded so a small pan stays covered.
    this.backdrop = L.rectangle(this.map.getBounds().pad(1), {
      pane: BACKDROP_PANE, stroke: false, fillColor: '#0b0f14', fillOpacity: 0.5, interactive: true,
    }).addTo(this.group)
    this.backdrop.on('click', () => this.collapse())

    const from = this.anchor.getLatLng()
    const center = this.map.latLngToLayerPoint(from)
    const offsets = this.fanOffsets()
    // Legs are readable for a ring but a starburst mess for a big spiral — skip them there.
    const drawLegs = this.children.length <= CIRCLE_MAX
    this.children.forEach((child, i) => {
      const ll = this.map.layerPointToLatLng(center.add(offsets[i]))
      child.setLatLng(ll)
      if (drawLegs) {
        const leg = L.polyline([from, ll], {
          pane: BACKDROP_PANE, weight: 1, opacity: 0.6, color: 'rgba(255,255,255,0.85)', interactive: false,
        })
        leg.addTo(this.group)
        this.legs.push(leg)
      }
      child.addTo(this.group) // child was built in SPIDER_PANE, so it renders above the dimmer
    })
    this.expanded = true
  }

  collapse(): void {
    if (!this.expanded) return
    if (this.backdrop) { this.group.removeLayer(this.backdrop); this.backdrop = null }
    for (const c of this.children) this.group.removeLayer(c)
    for (const l of this.legs) this.group.removeLayer(l)
    this.legs = []
    this.expanded = false
    if (openSpider === this) openSpider = null
  }
}
