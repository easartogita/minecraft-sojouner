import React, { useState } from 'react'
import type { OreVeinColumn } from '../lib/tauriAPI.types'

interface Props {
  coords: { x: number; z: number } | null
  biomeName?: string | null
  blockName?: string | null
  /** Y of the hovered block: surface Y in normal mode, cave-scan hit Y in cave mode. */
  terrainY?: number | null
  /** Cave-scan anchor Y (cave mode only) — fallback when no block Y is known. */
  caveY?: number | null
  /** true = slime chunk; null = layer is off */
  slimeChunk?: boolean | null
  localDifficulty?: { specialMultiplier: number; regionalDifficulty: number } | null
  /** null = layer off, pre-1.18 world, or no vein data for this column */
  oreVein?: OreVeinColumn | null
  /** Hovered chunk's own DataVersion (Java only). Dev-tools info — only
   *  ever rendered in dev builds, regardless of whether this is set. */
  dataVersion?: number | null
}

export default function CursorInfoBar({
  coords, biomeName, blockName, terrainY, caveY, slimeChunk, localDifficulty, oreVein, dataVersion,
}: Props) {
  const [copied, setCopied] = useState(false)

  if (!coords) return null

  // Y to display: the hovered block's Y when known (surface or cave-scan hit);
  // in cave mode fall back to the scan anchor over unexplored chunks.
  const displayY = terrainY ?? caveY ?? null

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

  // Each row appears only once its layer has data for this position — block/ore-vein
  // detail only resolves once zoomed in far enough to see individual blocks.
  const rows: string[] = []
  if (biomeName) rows.push(biomeName)
  if (blockName) rows.push(blockName)
  if (slimeChunk === true) rows.push('Slime chunk · Y 0–39')
  if (localDifficulty != null) {
    const r = localDifficulty.regionalDifficulty.toFixed(2)
    const s = localDifficulty.specialMultiplier.toFixed(2)
    rows.push(`Difficulty: ${r} / ${s}`)
  }
  if (oreVein?.copperCount) {
    rows.push(`Copper vein · Y ${oreVein.copperMinY}–${oreVein.copperMaxY} · ${oreVein.copperCount} blocks`)
  }
  if (oreVein?.ironCount) {
    rows.push(`Iron vein · Y ${oreVein.ironMinY}–${oreVein.ironMaxY} · ${oreVein.ironCount} blocks`)
  }
  // Dev-tools only — matches the "(DEV)" gating on the Structures rail panel
  // this value is most relevant to (per-chunk DataVersion mismatches).
  if (import.meta.env.DEV && dataVersion != null) {
    rows.push(`Chunk DataVersion: ${dataVersion}`)
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
      {!copied && rows.map((r, i) => (
        <span key={i} className="cursor-info-desc">{r}</span>
      ))}
    </div>
  )
}
