// Pre-generation: enumerate and render all tiles for a world region, populating
// the Rust disk PNG cache so subsequent viewport loads are near-instant.

import { BIOME_TILE_SIZE, CHUNK_TILE_SIZE } from './constants'
import { Dimension } from './constants'
import { blocksPerTile } from './tileCoords'
import * as api from './tauriAPI'

const BIOME_ZOOMS  = [0, 1, 2] // biome tiles only render at these native zooms
const CHUNK_ZOOMS  = [3, 4]    // chunk tiles: zoom 4 is native; zoom 3 is also a native request
const PREGEN_CONCURRENCY = 4  // matches the Tauri semaphore permit count

export interface PregenOptions {
  worldDir:        string
  edition:         string
  seed:            bigint
  mcVersion:       number
  worldFlags:      number
  generatorSlot:   number
  dimension:       Dimension
  includeChunks:   boolean
  includeBiomes:   boolean
  radiusBlocks:    number   // biome tiles: radius around spawn in blocks
  spawnX:          number
  spawnZ:          number
  hideWater:       boolean
}

export interface PregenProgress {
  done:  number
  total: number
  phase: 'biomes' | 'chunks' | 'done' | 'cancelled'
}

// tile_coord = floor(blockCoord / blocksPerTile); blocksPerTile = tileSize * BASE_BLOCKS_PER_PIXEL / 2^zoom
function biomeBlocksPerTile(zoom: number) {
  return blocksPerTile(BIOME_TILE_SIZE, zoom)
}

function chunkBlocksPerTile(zoom: number) {
  return blocksPerTile(CHUNK_TILE_SIZE, zoom)
}

function tileRange(blockMin: number, blockMax: number, blocksPerTile: number): [number, number] {
  return [Math.floor(blockMin / blocksPerTile), Math.floor(blockMax / blocksPerTile)]
}

// Returns the [tx0, tx1, ty0, ty1] tile range for an MCA region at (rx, rz).
// Matches the div_euclid computation in tile_renderer.rs::invalidate_mca_tiles.
function chunkTilesForRegion(rx: number, rz: number, zoom: number): [number, number, number, number] {
  const bpt = chunkBlocksPerTile(zoom)
  const bx0 = rx * 512, bz0 = rz * 512
  return [
    Math.floor(bx0 / bpt),       Math.floor((bx0 + 511) / bpt),
    Math.floor(bz0 / bpt),       Math.floor((bz0 + 511) / bpt),
  ]
}

async function runPool(
  jobs: Array<() => Promise<void>>,
  concurrency: number,
  signal: AbortSignal,
  onEach: () => void,
): Promise<void> {
  let idx = 0
  let active = 0

  return new Promise<void>(resolve => {
    const schedule = () => {
      while (active < concurrency && idx < jobs.length) {
        if (signal.aborted) { resolve(); return }
        const job = jobs[idx++]
        active++
        job()
          .catch(() => {})
          .finally(() => {
            active--
            onEach()
            if (active === 0 && idx >= jobs.length) resolve()
            else schedule()
          })
      }
      if (active === 0) resolve()
    }
    schedule()
  })
}

export async function pregenTiles(
  options:    PregenOptions,
  onProgress: (p: PregenProgress) => void,
  signal:     AbortSignal,
): Promise<void> {
  const {
    worldDir, edition, seed, mcVersion, worldFlags, generatorSlot, dimension,
    includeChunks, includeBiomes, radiusBlocks, spawnX, spawnZ, hideWater,
  } = options

  const biomeJobs: Array<() => Promise<void>> = []

  if (includeBiomes) {
    for (const zoom of BIOME_ZOOMS) {
      const bpt = biomeBlocksPerTile(zoom)
      const [tx0, tx1] = tileRange(spawnX - radiusBlocks, spawnX + radiusBlocks, bpt)
      const [ty0, ty1] = tileRange(spawnZ - radiusBlocks, spawnZ + radiusBlocks, bpt)
      for (let tx = tx0; tx <= tx1; tx++) {
        for (let ty = ty0; ty <= ty1; ty++) {
          const x = tx, y = ty, z = zoom
          biomeJobs.push(() =>
            api.renderBiomeTile(generatorSlot, seed, mcVersion, worldFlags, dimension, x, y, z)
              .then(() => {})
          )
        }
      }
    }
  }

  const chunkJobs: Array<() => Promise<void>> = []

  if (includeChunks) {
    const regions = await api.listRegions(worldDir, edition, dimension)
    for (const [rx, rz] of regions) {
      for (const zoom of CHUNK_ZOOMS) {
        const [tx0, tx1, ty0, ty1] = chunkTilesForRegion(rx, rz, zoom)
        for (let tx = tx0; tx <= tx1; tx++) {
          for (let ty = ty0; ty <= ty1; ty++) {
            const x = tx, y = ty, z = zoom
            chunkJobs.push(() =>
              api.renderTile(worldDir, edition, dimension, x, y, z, hideWater, null, 0, 0)
                .then(() => {})
            )
          }
        }
      }
    }
  }

  if (signal.aborted) { onProgress({ done: 0, total: 0, phase: 'cancelled' }); return }

  const total = biomeJobs.length + chunkJobs.length
  let done = 0
  const tick = () => { done++; onProgress({ done, total, phase: done < biomeJobs.length ? 'biomes' : 'chunks' }) }

  onProgress({ done: 0, total, phase: 'biomes' })

  await runPool(biomeJobs, PREGEN_CONCURRENCY, signal, tick)

  if (!signal.aborted) {
    if (chunkJobs.length > 0) onProgress({ done, total, phase: 'chunks' })
    await runPool(chunkJobs, PREGEN_CONCURRENCY, signal, tick)
  }

  onProgress({ done, total, phase: signal.aborted ? 'cancelled' : 'done' })
}

export function estimatePregenTileCount(
  radiusBlocks: number,
  includeChunks: boolean,
  includeBiomes: boolean,
  regionCount: number,
): number {
  let count = 0
  if (includeBiomes) {
    for (const zoom of BIOME_ZOOMS) {
      const bpt = biomeBlocksPerTile(zoom)
      const span = Math.floor(radiusBlocks / bpt) * 2 + 2
      count += span * span
    }
  }
  if (includeChunks) {
    for (const zoom of CHUNK_ZOOMS) {
      const tilesPerRegion = zoom === 3 ? 4 : 16
      count += regionCount * tilesPerRegion
    }
  }
  return count
}
