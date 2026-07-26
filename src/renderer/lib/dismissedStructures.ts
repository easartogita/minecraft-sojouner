import { StructureType } from './structureConfig'

export interface DismissedEntry {
  key: string
  structType: StructureType
  x: number
  z: number
}

export function dismissedStorageKey(seed: bigint): string {
  return `mcmap:dismissed:${seed.toString(16)}`
}

export function loadDismissed(seed: bigint): Set<string> {
  try {
    const raw = localStorage.getItem(dismissedStorageKey(seed))
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch { return new Set() }
}

export function saveDismissed(seed: bigint, dismissed: Set<string>): void {
  localStorage.setItem(dismissedStorageKey(seed), JSON.stringify([...dismissed]))
}

/** Parses `mark as useless` keys (`${structType}:${x}:${z}`) back into their
 *  parts for display — the raw key alone isn't human-readable. */
export function listDismissed(seed: bigint): DismissedEntry[] {
  return [...loadDismissed(seed)].map(key => {
    const [structType, x, z] = key.split(':')
    return { key, structType: structType as StructureType, x: Number(x), z: Number(z) }
  })
}

export function restoreDismissed(seed: bigint, key: string): void {
  const dismissed = loadDismissed(seed)
  dismissed.delete(key)
  saveDismissed(seed, dismissed)
}

export function clearAllDismissed(seed: bigint): void {
  localStorage.removeItem(dismissedStorageKey(seed))
}
