/// <reference types="vite/client" />

declare module '*?worker' {
  const WorkerFactory: new () => Worker
  export default WorkerFactory
}

type WorldType = 'default' | 'large_biomes' | 'amplified' | 'flat' | 'single_biome' | 'custom'

interface PlayerInfo {
  uuid:      string
  name:      string   // empty string if not in usercache.json
  x:         number
  y:         number
  z:         number
  dimension: string
  isHost:    boolean
  mountType?: string   // entity type the player is riding, if mounted
  mountName?: string   // the mount's custom name (name tag), if any
  /** Bed/respawn-anchor spawn point — absent until the player has actually
   *  slept in a bed or set a respawn anchor. Distinct from the world spawn. */
  respawnX?: number
  respawnY?: number
  respawnZ?: number
  respawnDimension?: string
}

interface SeedData {
  seed: string
  dataVersion: number
  versionName: string
  levelName: string
  worldType: WorldType
  spawnX: number
  spawnZ: number
  spawnChunkRadius: number | null
  playerX: number | null
  playerY: number | null
  playerZ: number | null
  playerDimension: string | null
  dayTime: number | null
  difficulty: number       // 0=Peaceful 1=Easy 2=Normal 3=Hard
  worldTime: number | null // total ticks elapsed (Data.Time)
  edition: 'java' | 'bedrock'
  players: PlayerInfo[]
  /** Non-vanilla server software (empty for vanilla singleplayer). */
  serverBrands: string[]
  borderCenterX: number
  borderCenterZ: number
  /** Vanilla default (60,000,000) when the world has no border set. */
  borderSize: number
  /** Every gamerule as its raw NBT string value (e.g. "true", "3"). */
  gameRules: Record<string, string>
}

interface McaMetrics {
  colorCacheHits:   number
  colorCacheMisses: number
  diskCacheHits:    number
  mcaReads:         number
  parseErrors:      number
  skippedChunks:    number
  totalParseMs:     number
  chunksParsed:     number
  peakParseMs:      number
  surfaceFindMs:    number
  ioMs:              number
  peakIoMs:          number
  decompressMs:      number
  peakDecompressMs:  number
  nbtParseMs:        number
  peakNbtParseMs:    number
  peakSurfaceFindMs: number
  colorAssignMs:     number
  peakColorAssignMs: number
  pngCacheHits:       number
  pngCacheMisses:     number
  tilesRendered:      number
  tileAssemblyMs:     number
  peakTileAssemblyMs: number
  pngEncodeMs:        number
  peakPngEncodeMs:    number
}

interface EntityItem {
  id: string
  count: number
  enchantment?: string
}

interface VillagerTrade {
  buy: EntityItem
  buyB?: EntityItem
  sell: EntityItem
  uses: number
  maxUses: number
}

interface GameEntity {
  type: string
  x: number
  y: number
  z: number
  customName?: string
  villagerProfession?: string
  villagerType?: string
  villagerLevel?: number
  trades?: VillagerTrade[]
  tamed?: boolean
  saddled?: boolean
  horseArmor?: string
  horseVariant?: string
  temper?: number
  chestItems?: EntityItem[]
  llamaStrength?: number
  llamaDecor?: string
  llamaVariant?: string
  paintingVariant?: string
  frameItem?: string
  frameItemEnchantment?: string
  frameRotation?: number
  armorItems?: EntityItem[]
  handItems?: EntityItem[]
  armorStandInvisible?: boolean
  dragonHealth?: number
  dragonPhase?: number
  witherHealth?: number
  lootTable?: string
  collarColor?: string
  petVariant?: string
  isScreaming?: boolean
  isPlayerCreated?: boolean
  oxidationLevel?: number
  isWaxed?: boolean
  conversionTime?: number
  isSitting?: boolean
  hasNectar?: boolean
  mobSize?: number
  beamTarget?: { x: number; y: number; z: number }
  speed?: number
  jumpHeight?: number
  isBaby?: boolean
}

interface BlockItem {
  slot: number
  id: string
  count: number
  /** e.g. "strong_healing" — read from the item's own NBT (Java only). */
  potion?: string
}

interface PoiRecord {
  kind: string
  x: number
  y: number
  z: number
  freeTickets: number
}

interface BlockEntity {
  type: string
  x: number
  y: number
  z: number
  items?: BlockItem[]
  spawnType?: string
  isOminous?: boolean
  frontText?: string[]
  backText?: string[]
  honeyLevel?: number
  beeCount?: number
  primaryEffect?: string
  secondaryEffect?: string
  discId?: string
  bookTitle?: string
  bookAuthor?: string
  ingredients?: BlockItem[]
  sherds?: string[]
  canSummon?: boolean
  cookingItem?: string
  cookingItems?: string[]
  lootTable?: string
  lootTier?: string
  exitPortal?: { x: number; y: number; z: number }
  suspiciousItem?: string
  bannerColor?: string
  bannerPatterns?: Array<{ pattern: string; color: string }>
  skullOwner?: string
}

