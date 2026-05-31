import { BASE_BLOCKS_PER_PIXEL, TILE_SIZE } from './constants'

export interface TileMinecraftRect {
  blockX: number
  blockZ: number
  widthBlocks: number
  heightBlocks: number
  blocksPerPixel: number
  scale: number   // cubiomes scale: 1=block, 4=chunk
}

/**
 * Convert Leaflet tile coordinates to Minecraft block coordinates.
 * We use L.CRS.Simple where:
 *   lng (x) = Minecraft X / PIXELS_PER_BLOCK
 *   lat (y) = -Minecraft Z / PIXELS_PER_BLOCK  (negated because MC Z+ is south = lat-)
 *
 * At zoom=0: 1 pixel = BASE_BLOCKS_PER_PIXEL blocks
 * Each zoom level doubles resolution (halves blocks per pixel).
 */
export function tileToMinecraftRect(
  tileX: number,
  tileY: number,
  zoom: number
): TileMinecraftRect {
  const blocksPerPixel = BASE_BLOCKS_PER_PIXEL / Math.pow(2, zoom)

  // Total blocks covered by this tile
  const widthBlocks = Math.ceil(TILE_SIZE * blocksPerPixel)
  const heightBlocks = Math.ceil(TILE_SIZE * blocksPerPixel)

  // Top-left corner in Minecraft block coords
  // tileY increases downward (south) = increasing Minecraft Z
  const blockX = Math.floor(tileX * TILE_SIZE * blocksPerPixel)
  const blockZ = Math.floor(tileY * TILE_SIZE * blocksPerPixel)

  // Use chunk scale (4) when zoomed out (< 4 pixels per block), block scale (1) when zoomed in
  const scale = blocksPerPixel >= 1 ? 4 : 1

  return { blockX, blockZ, widthBlocks, heightBlocks, blocksPerPixel, scale }
}

/**
 * Convert Minecraft block coords to Leaflet LatLng-equivalent pixel point.
 * Returns { x: lng-equivalent, y: lat-equivalent }
 */
export function minecraftToLeaflet(blockX: number, blockZ: number): { x: number; y: number } {
  return {
    x: blockX / BASE_BLOCKS_PER_PIXEL,
    y: -blockZ / BASE_BLOCKS_PER_PIXEL
  }
}
