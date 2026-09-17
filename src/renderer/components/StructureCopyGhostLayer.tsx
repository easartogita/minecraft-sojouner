import { memo, useEffect, useRef } from 'react'
import L from 'leaflet'
import { minecraftToLeaflet } from '../lib/tileCoords'

const PANE_NAME = 'structureCopyGhost'

function toLayerPoint(map: L.Map, x: number, z: number): L.Point {
  const p = minecraftToLeaflet(x, z)
  return map.latLngToLayerPoint(L.latLng(p.y, p.x))
}

interface Props {
  map: L.Map
  preview: { dataUrl: string; widthBlocks: number; depthBlocks: number } | null
  /** Cursor's current block position — the min corner of the *rotated*
   *  output footprint, same convention as the click that will actually set
   *  structureCopyDestChunk/BoxDest. Null while not actively placing. */
  anchor: [number, number] | null
  rotation: 0 | 90 | 180 | 270
  mirror: 'x' | 'z' | null
}

// A raster "stamp" that follows the cursor while placing a structure-copy
// destination — a plain DOM <img>, manually positioned in its own pane rather
// than an L.ImageOverlay, so repositioning on every mousemove doesn't pay for
// Leaflet's lat/lng-bounds layer recompute. Rotation/mirror are pure CSS
// transforms around the image's own center — see preview.rs's doc comment on
// why that's exactly equivalent to the server's actual rotate/mirror.
function StructureCopyGhostLayer({ map, preview, anchor, rotation, mirror }: Props) {
  const imgRef = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    if (!map.getPane(PANE_NAME)) {
      const pane = map.createPane(PANE_NAME)
      pane.style.zIndex = '650'
      pane.style.pointerEvents = 'none'
    }
    const img = document.createElement('img')
    img.style.position = 'absolute'
    img.style.left = '0'
    img.style.top = '0'
    img.style.opacity = '0.72'
    img.style.imageRendering = 'pixelated'
    img.style.filter = 'drop-shadow(0 0 4px rgba(34,211,238,0.9))'
    img.style.display = 'none'
    map.getPane(PANE_NAME)!.appendChild(img)
    imgRef.current = img
    return () => { img.remove(); imgRef.current = null }
  }, [map])

  useEffect(() => {
    const img = imgRef.current
    if (!img) return

    const reposition = () => {
      if (!preview || !anchor) { img.style.display = 'none'; return }
      const [ax, az] = anchor
      const rotated = rotation === 90 || rotation === 270
      const outW = rotated ? preview.depthBlocks : preview.widthBlocks
      const outD = rotated ? preview.widthBlocks : preview.depthBlocks
      const centerX = ax + outW / 2
      const centerZ = az + outD / 2
      // Sized/positioned to the UNROTATED footprint, centered on the same
      // point the rotated output will occupy — CSS rotate() below then spins
      // it in place, so the visible (rotated) bounds land exactly on target.
      const halfW = preview.widthBlocks / 2
      const halfD = preview.depthBlocks / 2
      const p0 = toLayerPoint(map, centerX - halfW, centerZ - halfD)
      const p1 = toLayerPoint(map, centerX + halfW, centerZ + halfD)
      const left = Math.min(p0.x, p1.x)
      const top = Math.min(p0.y, p1.y)
      const width = Math.abs(p1.x - p0.x)
      const height = Math.abs(p1.y - p0.y)

      if (img.src !== preview.dataUrl) img.src = preview.dataUrl
      img.style.width = `${width}px`
      img.style.height = `${height}px`
      const flip = mirror === 'x' ? 'scaleX(-1)' : mirror === 'z' ? 'scaleY(-1)' : ''
      img.style.transform = `translate3d(${left}px, ${top}px, 0) rotate(${rotation}deg) ${flip}`
      img.style.transformOrigin = 'center center'
      img.style.display = 'block'
    }

    reposition()
    map.on('move zoom', reposition)
    return () => { map.off('move zoom', reposition) }
  }, [map, preview, anchor, rotation, mirror])

  return null
}

export default memo(StructureCopyGhostLayer)
