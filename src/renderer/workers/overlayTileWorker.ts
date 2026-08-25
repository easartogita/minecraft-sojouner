// Pixel-fill worker for overlay tile layers.
// Receives pre-computed data buffers from the main thread (transferred zero-copy),
// fills a pixel array, and transfers it back. No IPC or WASM here.
import { ORE_TYPE_COLOR } from '../lib/oreFeatures'
import { TILE_SIZE } from '../lib/constants'

const CHUNK_SIZE = 16

type InMsg =
  | { type: 'local-difficulty';  id: number; chunkColor: ArrayBuffer; chunkAlpha: ArrayBuffer; chunkValid: ArrayBuffer; cx0: number; cz0: number; width: number; originX: number; originZ: number; blocksPerPixel: number }
  | { type: 'ore-feature';       id: number; data: ArrayBuffer; originX: number; originZ: number; blocksPerPixel: number; yMin?: number; yMax?: number }
  | { type: 'carver';            id: number; data: ArrayBuffer; cx0: number; cz0: number; originX: number; originZ: number; blocksPerPixel: number }
  | { type: 'ore-vein-columns';  id: number; data: ArrayBuffer; cx0: number; cz0: number; originX: number; originZ: number; blocksPerPixel: number; doCopper: boolean; doIron: boolean }

self.onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data
  switch (msg.type) {
    case 'local-difficulty':  handleLocalDifficulty(msg);  break
    case 'ore-feature':       handleOreFeature(msg);       break
    case 'carver':            handleCarver(msg);           break
    case 'ore-vein-columns':  handleOreVeinColumns(msg);   break
  }
}

const CARVE_RGB: [number, number, number] = [56, 132, 156]

function handleCarver(msg: Extract<InMsg, { type: 'carver' }>) {
  const { id, data: buf, cx0, cz0, originX, originZ, blocksPerPixel } = msg
  const arr    = new Int32Array(buf)
  const nx     = arr[0], nz = arr[1]
  const pixels = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4)

  for (let py = 0; py < TILE_SIZE; py++) {
    for (let px = 0; px < TILE_SIZE; px++) {
      const bx = Math.floor(originX + (px + 0.5) * blocksPerPixel)
      const bz = Math.floor(originZ + (py + 0.5) * blocksPerPixel)
      const ci = Math.floor(bx / CHUNK_SIZE) - cx0
      const cj = Math.floor(bz / CHUNK_SIZE) - cz0
      if (ci < 0 || ci >= nx || cj < 0 || cj >= nz) continue
      const lx = ((bx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE
      const lz = ((bz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE
      const count = arr[2 + (cj * nx + ci) * 256 + lz * 16 + lx]
      if (count <= 0) continue
      const off = (py * TILE_SIZE + px) * 4
      pixels[off]     = CARVE_RGB[0]
      pixels[off + 1] = CARVE_RGB[1]
      pixels[off + 2] = CARVE_RGB[2]
      pixels[off + 3] = Math.min(70 + count * 10, 220)
    }
  }
  reply(id, pixels)
}

const COPPER_VEIN_RGB: [number, number, number] = [210, 120, 30]
const IRON_VEIN_RGB:   [number, number, number] = [165, 165, 170]

function handleOreVeinColumns(msg: Extract<InMsg, { type: 'ore-vein-columns' }>) {
  const { id, data: buf, cx0, cz0, originX, originZ, blocksPerPixel, doCopper, doIron } = msg
  const arr    = new Int32Array(buf)
  const nx     = arr[0], nz = arr[1]
  const pixels = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4)

  for (let py = 0; py < TILE_SIZE; py++) {
    for (let px = 0; px < TILE_SIZE; px++) {
      const bx = Math.floor(originX + (px + 0.5) * blocksPerPixel)
      const bz = Math.floor(originZ + (py + 0.5) * blocksPerPixel)
      const ci = Math.floor(bx / CHUNK_SIZE) - cx0
      const cj = Math.floor(bz / CHUNK_SIZE) - cz0
      if (ci < 0 || ci >= nx || cj < 0 || cj >= nz) continue
      const lx = ((bx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE
      const lz = ((bz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE
      const base   = 2 + ((cj * nx + ci) * 256 + lz * 16 + lx) * 2
      const copper = doCopper ? arr[base]     : 0
      const iron   = doIron   ? arr[base + 1] : 0
      if (copper === 0 && iron === 0) continue
      // Whichever ore has the thicker column at this point wins the pixel.
      const [rgb, count] = copper >= iron
        ? [COPPER_VEIN_RGB, copper] as const
        : [IRON_VEIN_RGB,   iron]   as const
      const off = (py * TILE_SIZE + px) * 4
      pixels[off]     = rgb[0]
      pixels[off + 1] = rgb[1]
      pixels[off + 2] = rgb[2]
      pixels[off + 3] = Math.min(80 + count * 14, 235)
    }
  }
  reply(id, pixels)
}

function handleOreFeature(msg: Extract<InMsg, { type: 'ore-feature' }>) {
  const { id, data: buf, originX, originZ, blocksPerPixel, yMin, yMax } = msg
  const data   = new Int32Array(buf)
  const pixels = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4)
  const r = blocksPerPixel <= 1 ? 1 : 0  // dot half-size in px (bigger when very zoomed in)
  const count = (data.length / 4) | 0

  for (let i = 0; i < count; i++) {
    const c = ORE_TYPE_COLOR[data[i * 4]]
    if (!c) continue
    // Cave-mode Y-window filter: only show deposits within the visible depth slice.
    const y = data[i * 4 + 2]
    if (yMin != null && y < yMin) continue
    if (yMax != null && y > yMax) continue
    const cpx = Math.floor((data[i * 4 + 1] - originX) / blocksPerPixel) // x
    const cpz = Math.floor((data[i * 4 + 3] - originZ) / blocksPerPixel) // z
    for (let dy = -r; dy <= r; dy++) {
      const py = cpz + dy
      if (py < 0 || py >= TILE_SIZE) continue
      for (let dx = -r; dx <= r; dx++) {
        const px = cpx + dx
        if (px < 0 || px >= TILE_SIZE) continue
        const off = (py * TILE_SIZE + px) * 4
        pixels[off] = c[0]; pixels[off + 1] = c[1]; pixels[off + 2] = c[2]; pixels[off + 3] = 255
      }
    }
  }
  reply(id, pixels)
}

function reply(id: number, pixels: Uint8ClampedArray) {
  self.postMessage({ id, pixels: pixels.buffer }, [pixels.buffer])
}

function handleLocalDifficulty(msg: Extract<InMsg, { type: 'local-difficulty' }>) {
  const { id, chunkColor: cc, chunkAlpha: ca, chunkValid: cv, cx0, cz0, width, originX, originZ, blocksPerPixel } = msg
  const chunkColor = new Uint8Array(cc)
  const chunkAlpha = new Uint8Array(ca)
  const chunkValid = new Uint8Array(cv)
  const pixels     = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4)

  for (let py = 0; py < TILE_SIZE; py++) {
    for (let px = 0; px < TILE_SIZE; px++) {
      const bx = originX + (px + 0.5) * blocksPerPixel
      const bz = originZ + (py + 0.5) * blocksPerPixel
      const ci = (Math.floor(bz / CHUNK_SIZE) - cz0) * width + (Math.floor(bx / CHUNK_SIZE) - cx0)
      if (!chunkValid[ci]) continue
      const off = (py * TILE_SIZE + px) * 4
      pixels[off    ] = chunkColor[ci * 3    ]
      pixels[off + 1] = chunkColor[ci * 3 + 1]
      pixels[off + 2] = chunkColor[ci * 3 + 2]
      pixels[off + 3] = chunkAlpha[ci]
    }
  }

  reply(id, pixels)
}

