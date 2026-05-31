import { STRUCTURE_CONFIG, StructureType } from './structureConfig'
import * as api from './tauriAPI'

export interface StructureResult {
  structType: StructureType
  pos: api.StructurePos
}

export async function queryStructures(
  seed:       bigint,
  mcVersion:  number,
  dimension:  string,
  worldFlags: number,
  enabledStructures: Set<StructureType>,
  bx0: number, bz0: number,
  bx1: number, bz1: number,
): Promise<StructureResult[]> {
  const enabled = [...enabledStructures].filter(s => STRUCTURE_CONFIG[s].dimension === dimension)
  if (enabled.length === 0) return []

  const hits = await api.findAllStructures(seed, mcVersion, dimension, worldFlags, bx0, bz0, bx1, bz1, enabled)
  return hits.map(h => ({
    structType: h.struct_type as StructureType,
    pos: { x: h.x, z: h.z, flags: h.flags, variantTag: h.variant_tag, variantColor: h.variant_color },
  }))
}
