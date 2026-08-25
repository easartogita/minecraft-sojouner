import { BASE_BLOCKS_PER_PIXEL, TILE_SIZE } from './constants'

const CHUNK_SIZE = 16

/** Blocks per pixel at `zoom` — halves every zoom level. Mirrors
 *  `blocks_per_pixel_at` in tile_renderer.rs. */
export function blocksPerPixelAt(zoom: number): number {
  return BASE_BLOCKS_PER_PIXEL / Math.pow(2, zoom)
}

/** Blocks covered by one tile edge at `zoom`, for a tile rendered at `tileSize` px. */
export function blocksPerTile(tileSize: number, zoom: number): number {
  return tileSize * blocksPerPixelAt(zoom)
}

/** Block-space origin (top-left, unfloored) of tile (tileX, tileY) at `zoom`. */
export function tileOriginBlocks(tileX: number, tileY: number, zoom: number, tileSize: number = TILE_SIZE) {
  const blocksPerPixel = blocksPerPixelAt(zoom)
  const totalBlocksW = tileSize * blocksPerPixel
  return { blocksPerPixel, originX: tileX * totalBlocksW, originZ: tileY * totalBlocksW }
}

export interface TileChunkRange {
  blocksPerPixel: number
  originX: number
  originZ: number
  cx0: number
  cx1: number
  cz0: number
  cz1: number
}

// Shared by every per-chunk overlay layer (ore veins, carvers, ore features, local difficulty).
export function tileChunkRange(coords: { x: number; y: number; z: number }, tileSize: number = TILE_SIZE): TileChunkRange {
  const { blocksPerPixel, originX, originZ } = tileOriginBlocks(coords.x, coords.y, coords.z, tileSize)
  const totalBlocksW = tileSize * blocksPerPixel
  return {
    blocksPerPixel, originX, originZ,
    cx0: Math.floor(originX / CHUNK_SIZE),
    cx1: Math.floor((originX + totalBlocksW - 1) / CHUNK_SIZE),
    cz0: Math.floor(originZ / CHUNK_SIZE),
    cz1: Math.floor((originZ + totalBlocksW - 1) / CHUNK_SIZE),
  }
}

export interface TileMinecraftRect {
  blockX: number
  blockZ: number
  widthBlocks: number
  heightBlocks: number
  blocksPerPixel: number
  scale: number   // cubiomes scale: 1=block, 4=chunk
}

/** Convert Leaflet tile coords to Minecraft block coords. Uses L.CRS.Simple with lat
 *  negated, since MC Z+ (south) maps to Leaflet lat-. */
export function tileToMinecraftRect(
  tileX: number,
  tileY: number,
  zoom: number
): TileMinecraftRect {
  const { blocksPerPixel, originX, originZ } = tileOriginBlocks(tileX, tileY, zoom)

  // tileY increases downward (south) = increasing Minecraft Z
  const blockX = Math.floor(originX)
  const blockZ = Math.floor(originZ)
  const widthBlocks = Math.ceil(TILE_SIZE * blocksPerPixel)
  const heightBlocks = widthBlocks

  // Use chunk scale (4) when zoomed out (< 4 pixels per block), block scale (1) when zoomed in
  const scale = blocksPerPixel >= 1 ? 4 : 1

  return { blockX, blockZ, widthBlocks, heightBlocks, blocksPerPixel, scale }
}

/** Convert Minecraft block coords to Leaflet LatLng-equivalent {x, y} point. */
export function minecraftToLeaflet(blockX: number, blockZ: number): { x: number; y: number } {
  return {
    x: blockX / BASE_BLOCKS_PER_PIXEL,
    y: -blockZ / BASE_BLOCKS_PER_PIXEL
  }
}

// Inverse of minecraftToLeaflet.
export function lngToBlockX(lng: number): number { return lng * BASE_BLOCKS_PER_PIXEL }
export function latToBlockZ(lat: number): number { return -lat * BASE_BLOCKS_PER_PIXEL }

export function leafletToMinecraft(lng: number, lat: number): { x: number; z: number } {
  return { x: lngToBlockX(lng), z: latToBlockZ(lat) }
}

/**
 * Parse a pasted coordinate string into { x, z } — for pasting things like
 * "123, -456", "123 -456", or a copied `/tp @s 123 64 -456` command straight
 * into the Go-to-coordinates field. Pulls every numeric token out of the
 * string: exactly 2 → (x, z); exactly 3 → treats the middle one as Y and
 * takes (first, third). Any other count returns null so the caller falls
 * back to a normal paste instead of guessing.
 */
export function parseCoordPaste(text: string): { x: number; z: number } | null {
  const tokens = text.match(/-?\d+(?:\.\d+)?/g)
  if (!tokens) return null
  if (tokens.length === 2) {
    return { x: parseFloat(tokens[0]), z: parseFloat(tokens[1]) }
  }
  if (tokens.length === 3) {
    return { x: parseFloat(tokens[0]), z: parseFloat(tokens[2]) }
  }
  return null
}
