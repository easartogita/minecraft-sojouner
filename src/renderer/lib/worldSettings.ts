export interface WorldPregenSettings {
  radiusBlocks: number
  includeChunks: boolean
  includeBiomes: boolean
}

export interface PerWorldSettings {
  unlimitedCache: boolean
  pregen: WorldPregenSettings
  pregenCompletedAt: number | null
}

export const MAX_PREGEN_RADIUS    = 100_000
export const DEFAULT_PREGEN_RADIUS = 10_000

export const DEFAULT_WORLD_SETTINGS: PerWorldSettings = {
  unlimitedCache: false,
  pregen: {
    radiusBlocks: DEFAULT_PREGEN_RADIUS,
    includeChunks: true,
    includeBiomes: true,
  },
  pregenCompletedAt: null,
}

const STORAGE_KEY = 'mcmap:world-settings'

function loadAll(): Record<string, Partial<PerWorldSettings>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

export function loadWorldSettings(worldDir: string): PerWorldSettings {
  const all = loadAll()
  const stored = all[worldDir]
  if (!stored) return JSON.parse(JSON.stringify(DEFAULT_WORLD_SETTINGS))
  return {
    ...DEFAULT_WORLD_SETTINGS,
    ...stored,
    pregen: { ...DEFAULT_WORLD_SETTINGS.pregen, ...(stored.pregen ?? {}) },
  }
}

export function saveWorldSettings(worldDir: string, settings: PerWorldSettings): void {
  try {
    const all = loadAll()
    all[worldDir] = settings
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {}
}
