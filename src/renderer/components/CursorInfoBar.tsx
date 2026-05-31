import React, { useState } from 'react'

interface Props {
  coords: { x: number; z: number } | null
  biomeName?: string | null
  blockName?: string | null
  /** Surface Y from chunk data or cubiomes (normal mode). */
  terrainY?: number | null
  /** Player Y used as cave-scan centre (cave mode only). */
  caveY?: number | null
  /** true = slime chunk; null = layer is off */
  slimeChunk?: boolean | null
  /** null = layer is off */
  oreVeins?: { copperY: number | null; copperSize: number; ironY: number | null; ironSize: number } | null
  localDifficulty?: { specialMultiplier: number; regionalDifficulty: number } | null
}

export default function CursorInfoBar({
  coords, biomeName, blockName, terrainY, caveY, slimeChunk, oreVeins, localDifficulty,
}: Props) {
  const [copied, setCopied] = useState(false)

  if (!coords) return null

  // Y to display: cave mode → player depth; normal mode → surface terrain Y.
  const displayY = caveY ?? terrainY ?? null

  const handleClick = async () => {
    try {
      const text = displayY != null
        ? `${coords.x} ${displayY} ${coords.z}`
        : `${coords.x} ${coords.z}`
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch { /* ignore */ }
  }

  const desc = blockName ?? biomeName

  const chunkDetails: string[] = []
  if (slimeChunk === true) chunkDetails.push('Slime chunk · Y 0–39')
  const ORE_SIZE = ['', 'Small', 'Medium', 'Large']
  if (oreVeins?.copperY != null) chunkDetails.push(`Copper vein · Y ${oreVeins.copperY} · ${ORE_SIZE[oreVeins.copperSize] ?? ''}`)
  if (oreVeins?.ironY   != null) chunkDetails.push(`Iron vein · Y ${oreVeins.ironY} · ${ORE_SIZE[oreVeins.ironSize] ?? ''}`)
  if (localDifficulty != null) {
    const r = localDifficulty.regionalDifficulty.toFixed(2)
    const s = localDifficulty.specialMultiplier.toFixed(2)
    chunkDetails.push(`Difficulty: ${r} / ${s}`)
  }

  return (
    <div className="cursor-info-bar" onClick={handleClick} title="Click to copy coordinates">
      {copied ? (
        <span className="cursor-info-copied">Copied!</span>
      ) : (
        <span className="cursor-info-xyz">
          X: {coords.x}
          {displayY != null && (
            <span className="cursor-info-y">
              {'  '}Y: {displayY}
              {terrainY != null && caveY == null && <span className="cursor-info-y-src"> ↑</span>}
            </span>
          )}
          {'  '}Z: {coords.z}
        </span>
      )}
      {!copied && desc && (
        <span className="cursor-info-desc">{desc}</span>
      )}
      {!copied && chunkDetails.map((d, i) => (
        <span key={i} className="cursor-info-desc">{d}</span>
      ))}
    </div>
  )
}
