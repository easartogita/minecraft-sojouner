// Pixel-fill worker for overlay tile layers.
// Receives pre-computed data buffers from the main thread (transferred zero-copy),
// fills a pixel array, and transfers it back. No IPC or WASM here.
import { biomeToRGB } from '../lib/biomeColors'
import { ORE_TYPE_COLOR } from '../lib/oreFeatures'

const TILE_SIZE  = 256
const CHUNK_SIZE = 16

// Cave entrance — delta is now max(chunk_OF_peak - col_OF), i.e. how far any
// solid-floor column dips below the chunk's own terrain peak.  Natural hill
// slopes (~5–10 blocks within a chunk) are filtered by the threshold below.
const CE_THRESHOLD   = 8
const CE_SATURATE_AT = 30

// Ore vein
const COPPER_Y_MIN = 0,    COPPER_Y_MAX = 50
const IRON_Y_MIN   = -60,  IRON_Y_MAX   = -8
const SIZE_ALPHA   = [0, 140, 200, 240]
const INT_MIN      = -2147483648

type InMsg =
  | { type: 'cave-entrance';     id: number; data: ArrayBuffer; cx0: number; cz0: number; width: number; originX: number; originZ: number; blocksPerPixel: number }
  | { type: 'local-difficulty';  id: number; chunkColor: ArrayBuffer; chunkAlpha: ArrayBuffer; chunkValid: ArrayBuffer; cx0: number; cz0: number; width: number; originX: number; originZ: number; blocksPerPixel: number }
  | { type: 'ore-vein';          id: number; data: ArrayBuffer; qx0: number; qz0: number; qw: number; cx0: number; cz0: number; originX: number; originZ: number; blocksPerPixel: number; doCopper: boolean; doIron: boolean }
  | { type: 'underground-biome'; id: number; ugBiomes: ArrayBuffer; surfBiomes: ArrayBuffer; queryW: number; queryH: number; blocksPerPixel: number; biomeScale: number }
  | { type: 'ore-feature';       id: number; data: ArrayBuffer; originX: number; originZ: number; blocksPerPixel: number; yMin?: number; yMax?: number }
  | { type: 'carver';            id: number; data: ArrayBuffer; cx0: number; cz0: number; originX: number; originZ: number; blocksPerPixel: number }
  | { type: 'ore-vein-columns';  id: number; data: ArrayBuffer; cx0: number; cz0: number; originX: number; originZ: number; blocksPerPixel: number; doCopper: boolean; doIron: boolean }
  | { type: 'terrain-shade';     id: number; heights: ArrayBuffer; gridW: number; samplesPerTile: number }

self.onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data
  switch (msg.type) {
    case 'cave-entrance':     handleCaveEntrance(msg);     break
    case 'local-difficulty':  handleLocalDifficulty(msg);  break
    case 'ore-vein':          handleOreVein(msg);          break
    case 'underground-biome': handleUndergroundBiome(msg); break
    case 'ore-feature':       handleOreFeature(msg);       break
    case 'carver':            handleCarver(msg);           break
    case 'ore-vein-columns':  handleOreVeinColumns(msg);   break
    case 'terrain-shade':     handleTerrain(msg);          break
  }
}

// ── Carver coverage (cave/ravine density, top-down) ───────────────────────────

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

// ── Ore-vein footprint (per-column, drawn like carved caves) ──────────────────

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

// ── Terrain hillshade (relief from real surface heights) ──────────────────────

function handleTerrain(msg: Extract<InMsg, { type: 'terrain-shade' }>) {
  const { id, heights: buf, gridW, samplesPerTile } = msg
  const H      = new Int32Array(buf)
  const pixels = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4)
  const scale  = samplesPerTile / TILE_SIZE   // tile px → coarse grid cell

  for (let py = 0; py < TILE_SIZE; py++) {
    const gz = Math.min(gridW - 2, Math.floor(py * scale))
    for (let px = 0; px < TILE_SIZE; px++) {
      const gx = Math.min(gridW - 2, Math.floor(px * scale))
      const i  = gz * gridW + gx
      const z0 = H[i]
      const slope = (H[i + 1] - z0) + (H[i + gridW] - z0)  // NW light → positive slope brightens
      const shade = Math.max(45, Math.min(235, 150 + slope * 4))
      const off   = (py * TILE_SIZE + px) * 4
      pixels[off] = shade; pixels[off + 1] = shade; pixels[off + 2] = shade; pixels[off + 3] = 150
    }
  }
  reply(id, pixels)
}

// ── Ore-feature placement (individual ore blocks, coloured per ore) ───────────

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

// ── Cave entrance ─────────────────────────────────────────────────────────────

function handleCaveEntrance(msg: Extract<InMsg, { type: 'cave-entrance' }>) {
  const { id, data: buf, cx0, cz0, width, originX, originZ, blocksPerPixel } = msg
  const data   = new Int32Array(buf)
  const pixels = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4)

  for (let py = 0; py < TILE_SIZE; py++) {
    for (let px = 0; px < TILE_SIZE; px++) {
      const bx    = originX + (px + 0.5) * blocksPerPixel
      const bz    = originZ + (py + 0.5) * blocksPerPixel
      const delta = data[(Math.floor(bz / CHUNK_SIZE) - cz0) * width + (Math.floor(bx / CHUNK_SIZE) - cx0)]
      if (delta < CE_THRESHOLD) continue
      const t   = Math.min(1, (delta - CE_THRESHOLD) / (CE_SATURATE_AT - CE_THRESHOLD))
      const off = (py * TILE_SIZE + px) * 4
      pixels[off    ] = 20
      pixels[off + 1] = Math.round(140 + t * 40)
      pixels[off + 2] = 220
      pixels[off + 3] = Math.round(60 + t * 140)
    }
  }

  reply(id, pixels)
}

// ── Local difficulty ──────────────────────────────────────────────────────────

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

// ── Ore vein ──────────────────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number) { return a + (b - a) * t }

function heightBrightness(y: number, yMin: number, yMax: number) {
  if (y === INT_MIN) return 0.75
  return 0.45 + 0.55 * Math.max(0, Math.min(1, (y - yMin) / (yMax - yMin)))
}

function handleOreVein(msg: Extract<InMsg, { type: 'ore-vein' }>) {
  const { id, data: buf, qx0, qz0, qw, originX, originZ, blocksPerPixel, doCopper, doIron } = msg
  const data   = new Int32Array(buf)
  const pixels = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4)

  const base    = (cx: number, cz: number) => ((cz - qz0) * qw + (cx - qx0)) * 4
  const copperY    = (cx: number, cz: number) => data[base(cx, cz)]
  const copperSize = (cx: number, cz: number) => data[base(cx, cz) + 1]
  const ironY      = (cx: number, cz: number) => data[base(cx, cz) + 2]
  const ironSize   = (cx: number, cz: number) => data[base(cx, cz) + 3]

  const interpY = (
    cx: number, cz: number, ncx: number, ncz: number, tx: number, tz: number,
    getY: (cx: number, cz: number) => number,
  ) => {
    const b = getY(cx, cz)
    const y10 = getY(ncx, cz), y01 = getY(cx, ncz), y11 = getY(ncx, ncz)
    return lerp(
      lerp(b,                              y10 !== INT_MIN ? y10 : b, tx),
      lerp(y01 !== INT_MIN ? y01 : b, y11 !== INT_MIN ? y11 : b, tx),
      tz,
    )
  }

  for (let py = 0; py < TILE_SIZE; py++) {
    for (let px = 0; px < TILE_SIZE; px++) {
      const bx = originX + (px + 0.5) * blocksPerPixel
      const bz = originZ + (py + 0.5) * blocksPerPixel
      const cx = Math.floor(bx / CHUNK_SIZE)
      const cz = Math.floor(bz / CHUNK_SIZE)

      const csz = doCopper ? copperSize(cx, cz) : 0
      const isz = doIron   ? ironSize(cx, cz)   : 0
      if (csz === 0 && isz === 0) continue

      const fx  = bx / CHUNK_SIZE - cx
      const fz  = bz / CHUNK_SIZE - cz
      const ncx = fx < 0.5 ? cx - 1 : cx + 1
      const ncz = fz < 0.5 ? cz - 1 : cz + 1
      const tx  = fx < 0.5 ? fx + 0.5 : fx - 0.5
      const tz  = fz < 0.5 ? fz + 0.5 : fz - 0.5

      const off = (py * TILE_SIZE + px) * 4
      if (csz > 0) {
        const br = heightBrightness(interpY(cx, cz, ncx, ncz, tx, tz, copperY), COPPER_Y_MIN, COPPER_Y_MAX)
        pixels[off    ] = 210 * br
        pixels[off + 1] = 120 * br
        pixels[off + 2] =  30 * br
        pixels[off + 3] = SIZE_ALPHA[csz] ?? 200
      } else {
        const br = heightBrightness(interpY(cx, cz, ncx, ncz, tx, tz, ironY), IRON_Y_MIN, IRON_Y_MAX)
        pixels[off    ] = 160 * br
        pixels[off + 1] = 160 * br
        pixels[off + 2] = 160 * br
        pixels[off + 3] = SIZE_ALPHA[isz] ?? 200
      }
    }
  }

  reply(id, pixels)
}

// ── Underground biome ─────────────────────────────────────────────────────────

const CAVE_BIOME_IDS = new Set([174, 175, 183, 187]) // dripstone_caves, lush_caves, deep_dark, sulfur_caves

function handleUndergroundBiome(msg: Extract<InMsg, { type: 'underground-biome' }>) {
  const { id, ugBiomes: ub, surfBiomes: sb, queryW, queryH, blocksPerPixel, biomeScale } = msg
  const ugBiomes   = new Int32Array(ub)
  const surfBiomes = new Int32Array(sb)
  const pixels     = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4)

  for (let py = 0; py < TILE_SIZE; py++) {
    for (let px = 0; px < TILE_SIZE; px++) {
      const bi = Math.min(Math.floor(py * blocksPerPixel / biomeScale), queryH - 1) * queryW
               + Math.min(Math.floor(px * blocksPerPixel / biomeScale), queryW  - 1)
      const ugId = ugBiomes[bi]
      if (!CAVE_BIOME_IDS.has(ugId) || ugId === surfBiomes[bi]) continue
      const [r, g, b] = biomeToRGB(ugId)
      const off = (py * TILE_SIZE + px) * 4
      pixels[off] = r; pixels[off + 1] = g; pixels[off + 2] = b; pixels[off + 3] = 220
    }
  }

  reply(id, pixels)
}
