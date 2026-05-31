// Pixel-fill worker for overlay tile layers.
// Receives pre-computed data buffers from the main thread (transferred zero-copy),
// fills a pixel array, and transfers it back. No IPC or WASM here.
import { biomeToRGB } from '../lib/biomeColors'

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

self.onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data
  switch (msg.type) {
    case 'cave-entrance':     handleCaveEntrance(msg);     break
    case 'local-difficulty':  handleLocalDifficulty(msg);  break
    case 'ore-vein':          handleOreVein(msg);          break
    case 'underground-biome': handleUndergroundBiome(msg); break
  }
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

const CAVE_BIOME_IDS = new Set([174, 175, 183]) // dripstone_caves, lush_caves, deep_dark

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
